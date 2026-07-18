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
  return { SPINE, parseArgs, resolveStage, nextStage, gateOutcome, reviewLoop,
           fillClosed, streakIndex, stateDoc, atomicWriteCmd, gateCmd, LAW_CHECK, LAW_GUARD,
           validateTiers, resolveTier, routeBuilder, parseSliceEntry }`)()
const {
  SPINE, parseArgs, resolveStage, nextStage, gateOutcome, reviewLoop,
  fillClosed, streakIndex, stateDoc, atomicWriteCmd, gateCmd,
  validateTiers, resolveTier, routeBuilder, parseSliceEntry,
} = core

// ── Mocked runtime: run the whole kernel body with scripted agents ──────────
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
// Every real conductor launch carries an absolute plugin root; the harness
// supplies one by default so object scenarios model the real launch envelope.
// A scenario overrides it — to a relative or explicitly-undefined value — by
// naming `plugin` in its own launch args; that is how the plugin-guard cases
// force the missing/relative paths. String launches pass through untouched.
const PLUGIN = '/abs/plugins/kiln'
// The boot leg fires on every valid launch; the harness supplies a valid projected
// tier config by default (the node -p projection shape the kernel validates), so a
// scenario only names 'tiers:boot' when it is testing the fail-closed path.
const TIERS_OK = {
  exit: 0, doctrine: true,
  resolver: { 'gpt-sol': 'gpt-5.6-sol' },
  surface_routing: { ui: 'builder-ui', logic: 'builder-logic', mixed: 'builder-ui' },
  roles: {
    'driver': { family: 'claude', alias: 'inherit', effort: 'high' },
    'kernel-leg': { family: 'claude', alias: 'inherit', effort: 'high' },
    'stage-card': { family: 'claude', alias: 'inherit', effort: 'high' },
    'builder-ui': { family: 'claude', alias: 'opus', effort: 'high' },
    'builder-logic': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
    'reviewer-gate': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
    'brainstorm-facilitator': { family: 'claude', alias: 'inherit', effort: 'high' },
    'haiku-migration': { family: 'claude', alias: 'sonnet', effort: 'medium' },
    'dev-sol': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
  },
}
async function runKernel(kargs, script) {
  const launch = (kargs && typeof kargs === 'object' && !Array.isArray(kargs))
    ? { plugin: PLUGIN, ...kargs }
    : kargs
  const full = { 'tiers:boot': TIERS_OK, ...script }
  const calls = []
  const agentMock = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, prompt, opts })
    const h = full[opts.label]
    if (h === undefined) throw new Error('unmocked label: ' + opts.label)
    return typeof h === 'function' ? h(prompt, calls) : h
  }
  const body = src.replace('export const meta', 'const meta')
  const fn = new AsyncFunction('agent', 'pipeline', 'parallel', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const ret = await fn(agentMock, null, null, () => {}, () => {}, launch, null, null)
  // W-03: every kernel return carries a real beat — asserted on every scenario.
  assert.ok(typeof ret.beat === 'string' && ret.beat.length > 0,
    `W-03: empty beat on status "${ret.status}"`)
  return { ret, calls }
}
const lastStateDoc = (calls) => {
  const w = calls.filter(c => c.label === 'state:write')
  return w.length ? w[w.length - 1].prompt : ''
}
const GREEN = { exit: 0, ids: [] }
const LADDER = { exit: 0, ids: ['first-blood', 'spark-of-life', 'signal-fire'] }
const VOICE = {
  'voice:resume': { exit: 0, ids: ['The fire never went out. Kiln again — the ledger holds the next step, and I am already taking it.'] },
  'voice:reopen': { exit: 0, ids: ['Slice {slice} reopened — a law check went red. A seal is evidence-bound, not sacred.'] },
  'voice:blocked': { exit: 0, ids: ['The gate held after {passes} repair passes. Findings {ids} are on the table; the ruling is yours.'] },
  'voice:degradation': { exit: 0, ids: ['Codex is not answering the door. Say `continue` and I proceed.'] },
  'voice:stage.brainstorm': { exit: 0, ids: ['Da Vinci takes the window. Speak freely — he sees what you meant, not just what you said.'] },
}

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
    '.match(', '.exec(', 'marked', 'frontmatter',
  ]) {
    assert.ok(!code.includes(banned), `kernel code must not contain "${banned}"`)
  }
  // W-01: exactly ONE JSON.parse — the sanctioned parse-and-hop args adapter
  // (envelope mechanics, not content), and it lives in the pure core.
  assert.equal(code.split('JSON.parse').length - 1, 1, 'exactly one JSON.parse (the args adapter)')
  assert.ok(coreSrc.includes('Parse-and-hop'), 'the adapter is the marked parse-and-hop region')
})

test('parse-and-hop: args accepted in both shapes; malformed input never takes the bare path', () => {
  assert.deepEqual(parseArgs({ stage: 'law' }), { ok: true, value: { stage: 'law' } })
  assert.deepEqual(parseArgs(undefined), { ok: true, value: {} })
  assert.deepEqual(parseArgs(null), { ok: true, value: {} })
  const hop = parseArgs(JSON.stringify({ stage: 'build', projectDir: '/p', idea: 'x' }))
  assert.equal(hop.ok, true)
  assert.deepEqual(hop.value, { stage: 'build', projectDir: '/p', idea: 'x' })
  assert.equal(parseArgs('not json').ok, false)
  assert.equal(parseArgs('"a bare string"').ok, false)
  assert.equal(parseArgs('[1,2]').ok, false)
  assert.equal(parseArgs(42).ok, false)
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
  // 126/127 name the gate tool itself as unreachable — not a transport failure.
  assert.equal(gateOutcome(127), 'gate_unreachable', 'not found → the tool is unreachable')
  assert.equal(gateOutcome(126), 'gate_unreachable', 'not executable → the tool is unreachable')
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
  assert.equal((await reviewLoop(mk(127))).result, 'gate-unreachable')
  assert.equal((await reviewLoop(mk(126))).result, 'gate-unreachable')
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

// ── K-09/W-01/W-03: the mocked-runtime suite ────────────────────────────────

test('runtime (W-01): string-encoded args parse and run — the walker case', async () => {
  const { ret } = await runKernel(JSON.stringify({ stage: 'validate', projectDir: '/p', plugin: PLUGIN }), {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { ok: true, beat: 'validating', pointers: [] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'stringified args behave exactly like object args')
})

test('runtime (W-01): malformed string args are a closed-fact error, never the bare path', async () => {
  const { ret, calls } = await runKernel('this is not json', {})
  assert.equal(ret.status, 'bad-args')
  assert.notEqual(ret.status, 'needs-brainstorm', 'malformed input must not read as a bare launch')
  assert.equal(calls.length, 0, 'no agent runs on malformed args')
})

test('runtime: a missing plugin root halts honestly — no relative fallback, no work', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p', plugin: undefined }, {})
  assert.equal(ret.status, 'bad-args')
  assert.ok(ret.beat.includes('absolute'), 'the halt names the absolute-path contract')
  assert.ok(ret.beat.includes('plugin root'), 'and names exactly what is wrong')
  assert.equal(calls.length, 0, 'nothing runs without a plugin root — no silent relative fallback')
})

test('runtime: a relative plugin root halts the same way — a relative root is never guessed at', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p', plugin: 'plugins/kiln' }, {})
  assert.equal(ret.status, 'bad-args')
  assert.ok(ret.beat.includes('absolute'))
  assert.equal(calls.length, 0)
})

test('runtime: an absolute plugin root proceeds — existing behavior preserved', async () => {
  const { ret } = await runKernel({ stage: 'validate', projectDir: '/p', plugin: '/opt/kiln/plugins/kiln' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { ok: true, beat: 'validating', pointers: [] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a valid absolute root runs exactly as before')
})

test('runtime: an unreachable gate tool halts distinctly — names the tool path, not the transport', async () => {
  const { ret } = await runKernel({ stage: 'build', projectDir: '/p', plugin: '/opt/kiln/plugins/kiln' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { ok: true, beat: 'forging', pointers: [] },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 127 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'gate-unreachable')
  assert.ok(ret.beat.includes('/opt/kiln/plugins/kiln/scripts/kiln-review'), 'the halt names the gate tool at its path')
  assert.ok(ret.beat.includes('unreachable'), 'and calls it unreachable')
  assert.ok(!ret.beat.toLowerCase().includes('transport failed'), 'distinct from the transport-failure wording')
})

test('runtime (W-03): a genuine bare launch returns needs-brainstorm with a real beat', async () => {
  const { ret } = await runKernel({ projectDir: '/p' }, { ...VOICE })
  assert.equal(ret.status, 'needs-brainstorm')
  assert.ok(ret.beat.includes('Da Vinci'), 'the sealed brainstorm template arrives')
})

test('runtime (W-04): preflight red on a SEALED owner reopens it, owner persisted', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': { exit: 1, ids: ['s7'] },
    'seal:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red')
  assert.ok(ret.beat.includes('Slice s7 reopened'), 'the sealed reopen template arrives filled')
  const doc = lastStateDoc(calls)
  assert.ok(doc.includes('active_slice: s7'), 'owner persisted as active_slice')
  assert.ok(doc.includes('Reopen slice s7'), 'next_action names the owner')
})

test('runtime (W-04): preflight red on an UNSEALED slice is pre-build state — build dispatches', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': { exit: 1, ids: ['s1'] },
    'seal:check': { exit: 1 },
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'slice:s1': { ok: true, beat: 'forging', pointers: [] },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the expected pre-build red never reopens')
  assert.ok(calls.some(c => c.label === 'slice:s1'), 'the active slice build dispatches')
  assert.ok(ret.beat.includes('sealed — dual · slice s1'), 'the slice seals normally')
})

test('runtime: ANY pre-seal red blocks the seal unless a sealed owner reopens', async () => {
  const base = (preSeal) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { ok: true, beat: '{streak}. Slice `{slice}` takes the anvil.', pointers: ['.kiln/build-notes.md'] },
    'law:pre-seal': preSeal,
    'state:write': GREEN,
  })
  // Unowned red — fail-closed.
  const unowned = await runKernel({ stage: 'build', projectDir: '/p' }, base({ exit: 1, ids: [] }))
  assert.equal(unowned.ret.status, 'law-red')
  assert.ok(lastStateDoc(unowned.calls).includes('active_slice: s1'))
  assert.ok(!unowned.ret.beat.includes('sealed —'), 'no seal under an unowned red')
  // Red owned by ANOTHER unsealed slice — blocks all the same (full LAW green
  // at every slice boundary, per Sol's boundary ruling).
  const otherOwned = await runKernel({ stage: 'build', projectDir: '/p' }, base({ exit: 1, ids: ['s2'] }))
  assert.equal(otherOwned.ret.status, 'law-red')
  assert.ok(lastStateDoc(otherOwned.calls).includes('active_slice: s1'))
  assert.ok(!otherOwned.ret.beat.includes('sealed —'), 'no seal under any red at the boundary')
})

test('runtime: stage-end red on a sealed owner reopens it', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { ok: true, beat: 'validating', pointers: [] },
    'law:stage-end': { exit: 1, ids: ['s2'] },
    'seal:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red')
  assert.ok(lastStateDoc(calls).includes('active_slice: s2'))
})

test('runtime: a failed STATE write surfaces as persist-failed, never a success status', async () => {
  const { ret } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
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
    ...VOICE,
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
    ...VOICE,
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
  assert.ok(good.ret.beat.includes('Codex is not answering'), 'the sealed degradation template arrives')
})

test('runtime: stage pointers merge into STATE and the return (never discarded)', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
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
    ...VOICE,
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
  assert.ok(ret.beat.includes('Findings F1, F3'), 'the sealed blocked template arrives filled')
})

test('runtime (W-03 residue): an all-sealed build relaunch still speaks', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1', 's2'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  assert.ok(ret.beat.includes('the ledger holds the next step'), 'the sealed resume template arrives')
  assert.equal(calls.filter(c => c.label && c.label.startsWith('slice:')).length, 0, 'no slice work re-runs')
})

test('runtime (K-10): no beat leaves the kernel with an unfilled slot', async () => {
  const gateExits = [10, 0]
  const { ret } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
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

// ── Tiering seam: the pure resolvers, fail-closed boot, and surface routing ──

// A full valid config (all consumer roles + all routes), cloned so each negative
// mutates exactly one thing. exit is dropped — validateTiers ignores it.
const cfg = () => { const c = JSON.parse(JSON.stringify(TIERS_OK)); delete c.exit; return c }

test('tiers: validateTiers requires the full consumer role set, all three routes, and resolvable gpt aliases', () => {
  assert.equal(validateTiers(cfg()), true)
  assert.equal(validateTiers(null), false)
  const d = cfg(); d.doctrine = undefined; assert.equal(validateTiers(d), false, 'doctrine presence required')
  const e = cfg(); e.roles['kernel-leg'].effort = 'ultra'; assert.equal(validateTiers(e), false, 'ultra rejected by name')
  const f = cfg(); f.roles['builder-ui'].family = 'grok'; assert.equal(validateTiers(f), false, 'family must be claude|gpt')
  const a = cfg(); a.roles['stage-card'].alias = ''; assert.equal(validateTiers(a), false, 'alias must be a nonempty string')
  const mk = cfg(); delete mk.roles['kernel-leg']; assert.equal(validateTiers(mk), false, 'a missing consumer role halts at boot')
  const ms = cfg(); delete ms.roles['stage-card']; assert.equal(validateTiers(ms), false, 'missing stage-card halts at boot')
  const mr = cfg(); delete mr.surface_routing.mixed; assert.equal(validateTiers(mr), false, 'all three routes required')
  const dr = cfg(); dr.surface_routing.ui = 'ghost'; assert.equal(validateTiers(dr), false, 'route targets must be real role keys')
  const gr = cfg(); delete gr.resolver['gpt-sol']; assert.equal(validateTiers(gr), false, 'a gpt alias with no resolver mapping halts at boot')
  const gi = cfg(); gi.roles['builder-logic'].alias = 'inherit'; assert.equal(validateTiers(gi), false, 'a gpt role needs a concrete resolvable alias, not inherit')
})

test('tiers: resolveTier is family-aware — claude passes through, gpt resolves, resolver never rewrites claude', () => {
  assert.deepEqual(resolveTier(TIERS_OK, 'kernel-leg'), { effort: 'high' }, 'inherit omits the model key')
  assert.deepEqual(resolveTier(TIERS_OK, 'stage-card'), { effort: 'high' })
  assert.deepEqual(resolveTier(TIERS_OK, 'builder-ui'), { effort: 'high', model: 'opus' }, 'a claude alias passes through unresolved')
  assert.deepEqual(resolveTier(TIERS_OK, 'builder-logic'), { effort: 'high', model: 'gpt-5.6-sol' }, 'a gpt alias resolves to the concrete id')
  assert.deepEqual(resolveTier(TIERS_OK, 'haiku-migration'), { effort: 'medium', model: 'sonnet' })
  const c = cfg(); c.resolver['opus'] = 'sneaky-rewrite'
  assert.deepEqual(resolveTier(c, 'builder-ui'), { effort: 'high', model: 'opus' }, 'a resolver entry cannot rewrite a claude alias')
})

test('tiers: routeBuilder maps each validated surface to its builder opts', () => {
  assert.deepEqual(routeBuilder(TIERS_OK, 'ui'), { effort: 'high', model: 'opus' })
  assert.deepEqual(routeBuilder(TIERS_OK, 'logic'), { effort: 'high', model: 'gpt-5.6-sol' })
  assert.deepEqual(routeBuilder(TIERS_OK, 'mixed'), { effort: 'high', model: 'opus' })
})

test('tiers: parseSliceEntry validates the object form; only legacy bare strings default to mixed', () => {
  assert.deepEqual(parseSliceEntry('obj|hello-page|ui'), { id: 'hello-page', surface: 'ui', valid: true })
  assert.deepEqual(parseSliceEntry('obj|logic-core|logic'), { id: 'logic-core', surface: 'logic', valid: true })
  assert.deepEqual(parseSliceEntry('obj|m|mixed'), { id: 'm', surface: 'mixed', valid: true })
  assert.equal(parseSliceEntry('obj|s1|bogus').valid, false, 'an unknown object surface is invalid — never silently mixed')
  assert.equal(parseSliceEntry('obj|s1|').valid, false, 'a missing object surface is invalid')
  assert.equal(parseSliceEntry('obj||ui').valid, false, 'a missing object id is invalid')
  assert.deepEqual(parseSliceEntry('bare-legacy'), { id: 'bare-legacy', surface: 'mixed', valid: true }, 'a legacy bare string defaults to mixed')
  assert.equal(parseSliceEntry('').valid, false, 'an empty descriptor is invalid')
})

test('runtime (T-02): a nonzero tiers boot fails the run closed — no stage work runs', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, { 'tiers:boot': { exit: 20 } })
  assert.equal(ret.status, 'tiers-config-invalid')
  assert.ok(ret.beat.includes('tier file'), 'the halt names the tier file')
  assert.deepEqual(calls.map(c => c.label), ['tiers:boot'], 'nothing runs after a failed boot')
})

test('runtime (T-02): a malformed tier shape fails closed AT BOOT — the boot is the only call', async () => {
  const mut = {
    'ultra effort': (c) => { c.roles['kernel-leg'].effort = 'ultra' },
    'unknown family': (c) => { c.roles['builder-ui'].family = 'grok' },
    'missing kernel-leg role': (c) => { delete c.roles['kernel-leg'] },
    'missing stage-card role': (c) => { delete c.roles['stage-card'] },
    'missing mixed route': (c) => { delete c.surface_routing.mixed },
    'unresolved gpt alias': (c) => { delete c.resolver['gpt-sol'] },
    'no doctrine': (c) => { c.doctrine = undefined },
  }
  for (const [name, mutate] of Object.entries(mut)) {
    const boot = JSON.parse(JSON.stringify(TIERS_OK)); mutate(boot)
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, { 'tiers:boot': boot })
    assert.equal(ret.status, 'tiers-config-invalid', name + ' must fail closed')
    assert.deepEqual(calls.map(c => c.label), ['tiers:boot'], name + ': no work after the boot')
  }
})

test('runtime (T-03): the builder leg is surface-routed — ui→builder-ui, logic→builder-logic, bare→mixed', async () => {
  const build = (entry) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: [entry] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { ok: true, beat: 'forging', pointers: [] },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  const builderOpts = (calls) => calls.find(c => c.label === 'slice:s1').opts
  const ui = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|ui'))
  assert.equal(ui.ret.status, 'ok')
  assert.equal(builderOpts(ui.calls).model, 'opus', 'ui routes to builder-ui (opus)')
  assert.equal(builderOpts(ui.calls).effort, 'high')
  const logic = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|logic'))
  assert.equal(builderOpts(logic.calls).model, 'gpt-5.6-sol', 'logic routes to builder-logic (resolved gpt id)')
  const bare = await runKernel({ stage: 'build', projectDir: '/p' }, build('s1'))
  assert.equal(builderOpts(bare.calls).model, 'opus', 'a legacy bare-string slice defaults to mixed → builder-ui')
})

test('runtime (T-03): an object slice with an unknown or missing surface halts before any builder dispatch', async () => {
  for (const entry of ['obj|s1|bogus', 'obj|s1|', 'obj||ui']) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
      ...VOICE, 'law:preflight': GREEN, 'slices:fetch': { exit: 0, ids: [entry] }, 'ladder:fetch': LADDER, 'state:write': GREEN,
    })
    assert.equal(ret.status, 'slices-invalid', entry + ' must halt closed')
    assert.ok(!calls.some(c => c.label && c.label.startsWith('slice:')), entry + ': no builder leg dispatches')
  }
})

test('tier-keys-only: no compiled model id or alias literal lives in the kernel source', () => {
  for (const v of ['gpt-5.6-sol', "'opus'", "'sonnet'", "'gpt-sol'"]) {
    assert.ok(!src.includes(v), `no compiled tier value ${v} in kernel source — models live only in tiers.json`)
  }
})
