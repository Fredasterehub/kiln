import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The workflow runtime evaluates kernel.js as an async function body (top-level
// return, injected globals) — it is not an importable ESM module. The tests
// evaluate the marked pure-core region directly and execute the full body
// under a mocked runtime, exactly the way the runtime wraps it.
const src = readFileSync(
  fileURLToPath(new URL('../workflows/kernel.js', import.meta.url)), 'utf8',
)
const srcLines = src.split('\n')
const coreSrc = srcLines.slice(
  srcLines.findIndex(l => l.includes('KERNEL_CORE_BEGIN')) + 1,
  srcLines.findIndex(l => l.includes('KERNEL_CORE_END')),
).join('\n')
const core = new Function(coreSrc + `
  return { SPINE, resolveStage, nextStage, gateOutcome, reviewLoop,
           fillClosed, streakIndex, stateDoc, atomicWriteCmd, gateCmd, LAW_CHECK, LAW_GUARD }`)()
const {
  SPINE, resolveStage, nextStage, gateOutcome, reviewLoop,
  fillClosed, streakIndex, stateDoc, atomicWriteCmd, gateCmd,
} = core

// ── Mocked runtime: run the whole kernel body with scripted agents ──────────
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
async function runKernel(kargs, script) {
  const calls = []
  const agentMock = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, prompt })
    const h = script[opts.label]
    if (h === undefined) throw new Error('unmocked label: ' + opts.label)
    return typeof h === 'function' ? h(prompt, calls) : h
  }
  const body = src.replace('export const meta', 'const meta')
  const fn = new AsyncFunction('agent', 'pipeline', 'parallel', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const ret = await fn(agentMock, null, null, () => {}, () => {}, kargs, null, null)
  return { ret, calls }
}
const lastStateDoc = (calls) => {
  const w = calls.filter(c => c.label === 'state:write')
  return w.length ? w[w.length - 1].prompt : ''
}
const GREEN = { exit: 0, ids: [] }
const LADDER = { exit: 0, ids: ['first-blood', 'spark-of-life', 'signal-fire'] }

test('workflow body: parses as an async function body with the runtime globals', () => {
  const body = src.replace('export const meta', 'const meta')
  assert.doesNotThrow(() => new AsyncFunction(
    'agent', 'pipeline', 'parallel', 'log', 'phase', 'args', 'budget', 'workflow', body,
  ))
})

test('content-blind: no filesystem, clock, randomness, or content parsing in the kernel', () => {
  // Command strings handed to mechanical agents are data (the lawful
  // closed-facts fetch); the scan targets kernel CODE, so string literals
  // are blanked before scanning.
  const code = src.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""')
  for (const banned of [
    'node:fs', 'readFile', 'writeFile', "require(", 'child_process',
    'Date.now', 'Math.random', 'new Date',
    'JSON.parse', '.match(', '.exec(', 'marked', 'frontmatter',
  ]) {
    assert.ok(!code.includes(banned), `kernel code must not contain "${banned}"`)
  }
})

test('topology: spine order, direct mode skips brainstorm, resume passthrough', () => {
  assert.deepEqual(SPINE, ['law', 'build', 'validate', 'report'])
  assert.equal(resolveStage({ idea: 'a site' }), 'law')
  assert.equal(resolveStage({}), 'needs-brainstorm')
  assert.equal(resolveStage({ stage: 'validate' }), 'validate')
  assert.equal(resolveStage({ stage: 'nonsense' }), null)
  assert.equal(nextStage('law'), 'build')
  assert.equal(nextStage('report'), null)
})

test('gate wiring: the transport exit table maps to closed outcomes, unknown fails closed', () => {
  assert.equal(gateOutcome(0), 'accept')
  assert.equal(gateOutcome(10), 'reject')
  assert.equal(gateOutcome(11), 'blocked')
  assert.equal(gateOutcome(21), 'codex_unavailable')
  assert.equal(gateOutcome(20), 'transport_failure')
  assert.equal(gateOutcome(1), 'transport_failure')
  assert.equal(gateOutcome(139), 'transport_failure')
})

test('review loop: bounded at two repair passes, then blocked — never a third', async () => {
  const calls = { gate: [], repair: [] }
  const exits = [10, 10, 10]
  const r = await reviewLoop({
    gate: async (mode) => { calls.gate.push(mode); return exits.shift() },
    repair: async (pass) => { calls.repair.push(pass); return true },
  })
  assert.deepEqual(r, { result: 'blocked', repairs: 2 })
  assert.equal(calls.repair.length, 2)
  assert.deepEqual(calls.gate, ['review', 'recheck', 'recheck'])
})

test('review loop: clean accept seals with zero repairs; reject→accept seals after one', async () => {
  const mk = (exits) => ({ gate: async () => exits.shift(), repair: async () => true })
  assert.deepEqual(await reviewLoop(mk([0])), { result: 'sealed', repairs: 0 })
  assert.deepEqual(await reviewLoop(mk([10, 0])), { result: 'sealed', repairs: 1 })
})

test('review loop: an unconfirmed repair halts visibly — no recheck runs', async () => {
  const gates = []
  const r = await reviewLoop({
    gate: async (mode) => { gates.push(mode); return 10 },
    repair: async () => false,
  })
  assert.deepEqual(r, { result: 'repair-failed', repairs: 1 })
  assert.deepEqual(gates, ['review'], 'recheck must not run after a failed repair')
})

test('review loop: blocked, degradation, and transport failure short-circuit without repair', async () => {
  let repaired = false
  const mk = (exit) => ({ gate: async () => exit, repair: async () => { repaired = true; return true } })
  assert.equal((await reviewLoop(mk(11))).result, 'blocked')
  assert.equal((await reviewLoop(mk(21))).result, 'degraded')
  assert.equal((await reviewLoop(mk(20))).result, 'transport-failure')
  assert.equal(repaired, false)
})

test('slots: every kernel-owned slot from the sealed map fills; semantic slots pass through', () => {
  const beat = '{STAGE} {i}/{n} slice {slice} [{label}] {s}/{t} {streak}|{STREAK} p{passes} c{count} [{ids}] d{driver} — {quote} {title_row}'
  const out = fillClosed(beat, {
    STAGE: 'BUILD', i: 2, n: 4, slice: 's1', label: 'dual', s: 1, t: 3,
    streak: 'first-blood', STREAK: 'FIRST-BLOOD', passes: 1, count: 2, ids: 'F1, F2', driver: 812,
  })
  assert.equal(out, 'BUILD 2/4 slice s1 [dual] 1/3 first-blood|FIRST-BLOOD p1 c2 [F1, F2] d812 — {quote} {title_row}')
  assert.equal(fillClosed('{STAGE}', {}), '{STAGE}', 'missing facts leave the slot for the owner')
})

test('streak arithmetic: the sealed formula, clamped and wrapping', () => {
  assert.equal(streakIndex(1, 0), 0)
  assert.equal(streakIndex(0, 0), 0, 'max(…,1) clamps')
  assert.equal(streakIndex(2, 3), 4)
  assert.equal(streakIndex(41, 0), 0, 'wraps at 40')
  assert.equal(streakIndex(3, 0, 3), 2, 'wraps at the ladder length')
})

test('STATE doc: all six locked fields present, shell stamps the clock', () => {
  const doc = stateDoc({ stage: 'build', active_slice: 's1', next_action: 'Relaunch the kernel workflow with stage=validate', pointers: ['.kiln/STATE.md'] })
  for (const f of ['stage:', 'active_slice:', 'next_action:', 'pointers:', 'seals:', 'updated_at:']) {
    assert.ok(doc.includes(f), `missing field ${f}`)
  }
  assert.ok(doc.includes('{updated_at}'), 'clock is stamped at write time, never in-script')
})

test('atomic write: executed — final exists, temp gone, timestamp replaced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-floor-'))
  execSync(atomicWriteCmd(stateDoc({ stage: 'law', next_action: 'Relaunch the kernel workflow with stage=build' })), { cwd: dir, shell: '/bin/bash' })
  assert.ok(existsSync(join(dir, '.kiln/STATE.md')), 'STATE.md exists')
  assert.ok(!existsSync(join(dir, '.kiln/.STATE.tmp')), 'temp file is gone')
  const out = readFileSync(join(dir, '.kiln/STATE.md'), 'utf8')
  assert.ok(/updated_at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(out), 'timestamp replaced')
  assert.ok(!out.includes('{updated_at}'), 'no placeholder survives')
})

test('gate command: review and recheck route paths per the sealed transport contract', () => {
  const p = { plugin: 'plugins/kiln', repo: '/p', request: '.kiln/review-request.json', gate: '.kiln/gate-review.json', priorGate: '.kiln/gate-review.json', delta: '.kiln/repair-delta.md' }
  assert.equal(gateCmd('review', p), 'plugins/kiln/scripts/kiln-review review /p .kiln/review-request.json .kiln/gate-review.json')
  assert.equal(gateCmd('recheck', p), 'plugins/kiln/scripts/kiln-review recheck /p .kiln/review-request.json .kiln/gate-review.json .kiln/repair-delta.md .kiln/gate-review.json')
})

// ── K-09: the mocked-runtime suite — LAW beats, owner reopening, persistence ─

test('runtime: preflight red at resume reopens the owning slice from the check output', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    'law:preflight': { exit: 1, ids: ['s7'] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red')
  const doc = lastStateDoc(calls)
  assert.ok(doc.includes('active_slice: s7'), 'owner persisted as active_slice')
  assert.ok(doc.includes('Reopen slice s7'), 'next_action names the owner')
})

test('runtime: pre-seal red reopens the slice in play when the check names no owner', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { ok: true, beat: '{streak}. Slice `{slice}` takes the anvil.', pointers: ['.kiln/build-notes.md'] },
    'law:pre-seal': { exit: 1, ids: [] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red')
  assert.ok(lastStateDoc(calls).includes('active_slice: s1'))
})

test('runtime: stage-end red carries the owner the check printed', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    'law:preflight': GREEN,
    'stage:validate': { ok: true, beat: 'validating', pointers: [] },
    'law:stage-end': { exit: 1, ids: ['s2'] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red')
  assert.ok(lastStateDoc(calls).includes('active_slice: s2'))
})

test('runtime: a failed STATE write surfaces as persist-failed, never a success status', async () => {
  const { ret } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    'law:preflight': GREEN,
    'stage:validate': { ok: true, beat: 'validating', pointers: [] },
    'law:stage-end': GREEN,
    'state:write': { exit: 1 },
  })
  assert.equal(ret.status, 'persist-failed')
  assert.equal(ret.pointers.failed, 'state-write')
})

test('runtime: a failed seal append halts before the seal beat or STATE advance', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { ok: true, beat: 'forging', pointers: [] },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 1 },
  })
  assert.equal(ret.status, 'persist-failed')
  assert.equal(ret.pointers.failed, 'seal-append')
  assert.ok(!ret.beat.includes('sealed'), 'no seal beat after a failed append')
  assert.equal(calls.filter(c => c.label === 'state:write').length, 0, 'no STATE advance after a failed append')
})

test('runtime: degradation is sticky only when the mark lands; a failed mark surfaces', async () => {
  const base = {
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { ok: true, beat: 'forging', pointers: [] },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 21 },
  }
  const bad = await runKernel({ stage: 'build', projectDir: '/p' }, { ...base, 'degraded:mark': { exit: 1 } })
  assert.equal(bad.ret.status, 'persist-failed')
  assert.equal(bad.ret.pointers.failed, 'degraded-mark')
  const good = await runKernel({ stage: 'build', projectDir: '/p' }, { ...base, 'degraded:mark': { exit: 0 }, 'state:write': GREEN })
  assert.equal(good.ret.status, 'degraded')
})

test('runtime: stage pointers merge into STATE and the return (never discarded)', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    'law:preflight': GREEN,
    'stage:validate': { ok: true, beat: 'validating', pointers: ['.kiln/validate-report.md'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  assert.ok(ret.pointers.routes.includes('.kiln/validate-report.md'), 'return carries the route')
  assert.ok(lastStateDoc(calls).includes('.kiln/validate-report.md'), 'STATE carries the route')
})

test('runtime: a blocked gate stops with the finding ids as closed facts', async () => {
  const { ret } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { ok: true, beat: 'forging', pointers: [] },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 11 },
    'findings:fetch': { exit: 0, ids: ['F1', 'F3'] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'blocked')
  assert.deepEqual(ret.pointers.finding_ids, ['F1', 'F3'], 'the ruling arrives with its finding ids')
  assert.equal(ret.pointers.gate, '.kiln/gate-review.json')
})

test('runtime (K-10): no beat leaves the kernel with an unfilled slot', async () => {
  const gateExits = [10, 0]
  const { ret } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { ok: true, beat: '{streak}. Slice `{slice}` takes the anvil — {s}/{t}, iteration {i}.', pointers: [] },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': () => ({ exit: gateExits.shift() }),
    'gate:recheck': () => ({ exit: gateExits.shift() }),
    'findings:fetch': { exit: 0, ids: ['F1', 'F2'] },
    'repair:s1': { ok: true, beat: 'The reviewer blocks the gate — {count} findings ({ids}), pass {passes}. Back to the forge.', pointers: [] },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  assert.ok(ret.beat.includes('first-blood. Slice `s1` takes the anvil'), 'streak and slice filled')
  assert.ok(ret.beat.includes('2 findings (F1, F2), pass 1'), 'count, ids, passes filled')
  assert.ok(ret.beat.includes('sealed — dual · slice s1'), 'seal line filled')
  assert.ok(!/\{[A-Za-z_]+\}/.test(ret.beat), 'no unfilled slot of any kind reaches the driver')
})
