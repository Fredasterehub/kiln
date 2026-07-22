import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
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
           LAW_CHECK_RECEIPT, verdictExit, redSetIsFuture, gateReviewInvalid,
           validateTiers, resolveTier, routeBuilder, parseSliceEntry }`)()
const {
  SPINE, parseArgs, resolveStage, nextStage, gateOutcome, reviewLoop,
  fillClosed, streakIndex, stateDoc, atomicWriteCmd, gateCmd,
  LAW_CHECK_RECEIPT, verdictExit, redSetIsFuture, gateReviewInvalid,
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
  surface_routing: { ui: 'builder-ui', logic: 'builder-logic', mixed: 'builder-logic' },
  roles: {
    'driver': { family: 'claude', alias: 'inherit', effort: 'high' },
    'kernel-leg': { family: 'claude', alias: 'inherit', effort: 'high' },
    'stage-card': { family: 'claude', alias: 'inherit', effort: 'high' },
    // INTAKE-19: the LAW stage is a thinking seat — slice creation runs on fable;
    // builder-ui is donkey work — opus implements ui from the locked plan.
    'stage-law': { family: 'claude', alias: 'fable', effort: 'high' },
    'builder-ui': { family: 'claude', alias: 'opus', effort: 'high' },
    // simple-fire: the logic seat is a claude context-builder whose CODER is
    // GPT-5.6 via one bash codex exec call (cards/build.md); the claude-family
    // route-target boot rule holds BY DESIGN. Wrapper effort HIGH per the
    // INTAKE-14b/Q1 default (a model-backed role defaults HIGH — medium was drift).
    'builder-logic': { family: 'claude', alias: 'sonnet', effort: 'high' },
    'reviewer-gate': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
    // The codex-absent fallback reviewer (duo-pool.json:7 logic_fallback restored):
    // a boot-required consumer role, consumed on the degraded logic/mixed gate — opus
    // reviews the sonnet-built slice, the best split without a second family.
    'fallback-reviewer': { family: 'claude', alias: 'opus', effort: 'high' },
    // Wave 1 (the Second Key): the always-on cross-family LAW-ratify gate — a
    // gpt reviewer, opposite-family to the claude/fable stage-law producer; a
    // boot-required consumer role the kernel resolves at the law stage.
    'ratify-reviewer': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
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
// The claude gate returns the schema-forced review-schema.json object; the kernel
// publishes it by hand and maps the verdict onto the closed exit table.
const GATE_ACCEPT = { review_id: 'r1', law_hash: 'a'.repeat(64), findings: [], blockers: [], verdict: 'accept' }
// S1: the claude gate fetches the locked law hash from the review request as a
// closed machine fact before validating any verdict against it.
const HASH_OK = { exit: 0, ids: ['a'.repeat(64)] }
// Producer-self-publish (INTAKE-27): the claude reviewer WRITES its verdict to the
// candidate file and returns only this light {ok} ack; the kernel reads the written
// bytes back raw (gate:read) and validates them. The mock models the written
// candidate as the raw file read — a one-element array holding the file contents.
const OK_ACK = { ok: true }
const readCandidate = (verdict) => ({ exit: 0, ids: [JSON.stringify(verdict)] })
const VOICE = {
  'voice:resume': { exit: 0, ids: ['The fire never went out. Kiln again — the ledger holds the next step, and I am already taking it.'] },
  'voice:reopen': { exit: 0, ids: ['Slice {slice} reopened — a law check went red. A seal is evidence-bound, not sacred.'] },
  'voice:blocked': { exit: 0, ids: ['The gate held after {passes} repair passes. Findings {ids} are on the table; the ruling is yours.'] },
  'voice:degradation': { exit: 0, ids: ['Codex is not answering the door. Say `continue` and I proceed.'] },
  'voice:stage.brainstorm': { exit: 0, ids: ['Da Vinci takes the window. Speak freely — he sees what you meant, not just what you said.'] },
  // S1 joint ruling: the reachable kernel twin sites read these sealed keys.
  'voice:seal': { exit: 0, ids: ['Slice {slice} sealed — {label}. The evidence holds.'] },
  'voice:bad-args': { exit: 0, ids: ['Unknown stage in the launch args — the spine knows law, build, validate, report.'] },
  'voice:gate-unreachable': { exit: 0, ids: ['The gate tool would not run — not found or not executable where it lives, so codex was never reached and no verdict exists. Nothing seals on a guess; restore the gate and relaunch.'] },
  'voice:transport-failure': { exit: 0, ids: [
    'The review call went out and came back with no verdict — the gate could not finish the round-trip, so the slice cannot seal. The run holds until the transport is sound; I never turn a failed call into a pass.',
    'The stage worker returned no usable result — its report did not hold, so nothing seals and the run cannot advance. A clean rerun of that stage puts it back in motion.',
  ] },
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
  // W-01: exactly TWO JSON.parse calls — the sanctioned parse-and-hop args
  // adapter in the pure core (envelope mechanics), and the gate-file mirror in
  // the workflow runtime (the kernel parses the raw candidate bytes it validates
  // and publishes). Both are sanctioned envelope reads, never content parsing.
  assert.equal(code.split('JSON.parse').length - 1, 2, 'exactly two JSON.parse (the args adapter + the gate-file mirror)')
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
  // S2 joint ruling: {driver} is NOT kernel-owned — it is DRIVER-filled at
  // completion, so fillClosed leaves it even when a stray fact names it.
  const beat = '{STAGE} {i}/{n} slice {slice} [{label}] {s}/{t} {streak}|{STREAK} p{passes} c{count} [{ids}] d{driver} — {quote} {title_row}'
  const out = fillClosed(beat, {
    STAGE: 'BUILD', i: 2, n: 4, slice: 's1', label: 'dual', s: 1, t: 3,
    streak: 'first-blood', STREAK: 'FIRST-BLOOD', passes: 1, count: 2, ids: 'F1, F2', driver: 812,
  })
  assert.equal(out, 'BUILD 2/4 slice s1 [dual] 1/3 first-blood|FIRST-BLOOD p1 c2 [F1, F2] d{driver} — {quote} {title_row}')
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
    'stage:validate': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'validating' },
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
    'stage:validate': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'validating' },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a valid absolute root runs exactly as before')
})

test('runtime: an unreachable gate tool halts distinctly — sealed beat, tool path in next_action', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p', plugin: '/opt/kiln/plugins/kiln' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 127 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'gate-unreachable')
  // S1 wiring: the beat is the sealed gate-unreachable template; the tool
  // path lives in the persisted next_action, not the sealed line.
  assert.ok(ret.beat.includes('The gate tool would not run'), 'the sealed gate-unreachable template arrives')
  assert.ok(!ret.beat.toLowerCase().includes('transport failed'), 'distinct from the transport-failure wording')
  assert.ok(lastStateDoc(calls).includes('/opt/kiln/plugins/kiln/scripts/kiln-review'), 'next_action names the gate tool at its path')
})

test('runtime (S1): an unknown stage speaks the sealed bad-args template — the site voice-reads post-root', async () => {
  const { ret, calls } = await runKernel({ stage: 'nonsense', projectDir: '/p' }, { ...VOICE })
  assert.equal(ret.status, 'bad-args')
  assert.ok(ret.beat.includes('Unknown stage in the launch args — the spine knows law, build, validate, report.'), 'the sealed bad-args template arrives')
  assert.ok(calls.some(c => c.label === 'voice:bad-args'), 'the beat came through the voice fetch, not a hardcoded line')
})

test('runtime (S1): a failed stage worker speaks the sealed stage-worker transport variant', async () => {
  const { ret } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { facts: { status: 'failed', pointers: [], schema_valid: false }, narration_beat: '' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(ret.beat.includes('The stage worker returned no usable result'), 'the sealed stage-worker variant (entry 1) arrives')
})

test('runtime (S1): a review transport failure speaks the sealed review-call variant', async () => {
  const { ret } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 20 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(ret.beat.includes('The review call went out and came back with no verdict'), 'the sealed review-call variant (entry 0) arrives')
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
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the expected pre-build red never reopens')
  assert.ok(calls.some(c => c.label === 'slice:s1'), 'the active slice build dispatches')
  assert.ok(ret.beat.includes('Slice s1 sealed — dual. The evidence holds.'), 'the sealed seal template arrives filled')
  // STRIKE 3: the seal leg passes the cwd-relative `.kiln` dir — never an unquoted
  // absolute projectDir, which a whitespace path would split into extra args.
  const sealLeg = calls.find(c => c.label === 'seal:append')
  assert.ok(sealLeg.prompt.includes('append-seal .kiln '), 'the seal leg passes the cwd-relative .kiln dir')
  assert.ok(!sealLeg.prompt.includes('/p/.kiln'), 'never the interpolated absolute projectDir path')
})

test('runtime: ANY pre-seal red blocks the seal unless a sealed owner reopens', async () => {
  const base = (preSeal) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: ['.kiln/build-notes.md'], schema_valid: true }, narration_beat: '{streak}. Slice `{slice}` takes the anvil.' },
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
    'stage:validate': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'validating' },
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
    'stage:validate': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'validating' },
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
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
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
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
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
    'stage:validate': { facts: { status: 'ok', pointers: ['.kiln/validate-report.md'], schema_valid: true }, narration_beat: 'validating' },
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
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
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
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: '{streak}. Slice `{slice}` takes the anvil — {s}/{t}, iteration {i}.' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': () => ({ exit: gateExits.shift() }),
    'gate:recheck': () => ({ exit: gateExits.shift() }),
    'findings:fetch': { exit: 0, ids: ['F1', 'F2'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'The reviewer blocks the gate — {count} findings ({ids}), pass {passes}. Back to the forge.' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  assert.ok(ret.beat.includes('first-blood. Slice `s1` takes the anvil'), 'streak and slice filled')
  assert.ok(ret.beat.includes('2 findings (F1, F2), pass 1'), 'count, ids, passes filled')
  assert.ok(ret.beat.includes('Slice s1 sealed — dual. The evidence holds.'), 'seal line filled from the sealed template')
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
  const ml = cfg(); delete ml.roles['stage-law']; assert.equal(validateTiers(ml), false, 'missing stage-law halts at boot (INTAKE-19)')
  const mf = cfg(); delete mf.roles['fallback-reviewer']; assert.equal(validateTiers(mf), false, 'missing fallback-reviewer halts at boot — the degraded logic/mixed gate consumes it, so a lacking file must fail closed, never throw mid-run')
  const mrr = cfg(); delete mrr.roles['ratify-reviewer']; assert.equal(validateTiers(mrr), false, 'missing ratify-reviewer halts at boot (Wave 1) — the law-stage ratify gate consumes it, so a tiers.json lacking it fails closed, never throws mid-run')
  const mr = cfg(); delete mr.surface_routing.mixed; assert.equal(validateTiers(mr), false, 'all three routes required')
  const dr = cfg(); dr.surface_routing.ui = 'ghost'; assert.equal(validateTiers(dr), false, 'route targets must be real role keys')
  const gr = cfg(); delete gr.resolver['gpt-sol']; assert.equal(validateTiers(gr), false, 'a gpt alias with no resolver mapping halts at boot')
  const gi = cfg(); gi.roles['reviewer-gate'].alias = 'inherit'; assert.equal(validateTiers(gi), false, 'a gpt role needs a concrete resolvable alias, not inherit')
  // The 48e5fed builder-leg defect shape: a surface routed to a gpt-family role.
  // The agent() spawner is Anthropic-only, so this must halt at boot, never 404 mid-build.
  // Since simple-fire the shipped builder-logic seat is claude (the codex call rides
  // bash inside the card), so the defect shape is recreated by flipping the family back.
  const gp = cfg(); gp.roles['builder-logic'] = { family: 'gpt', alias: 'gpt-sol', effort: 'high' }
  assert.equal(validateTiers(gp), false, 'a gpt-family surface-route target has no agent transport — rejected at boot')
})

test('tiers: resolveTier is family-aware — claude passes through, gpt resolves, resolver never rewrites claude', () => {
  assert.deepEqual(resolveTier(TIERS_OK, 'kernel-leg'), { effort: 'high' }, 'inherit omits the model key')
  assert.deepEqual(resolveTier(TIERS_OK, 'stage-card'), { effort: 'high' })
  assert.deepEqual(resolveTier(TIERS_OK, 'stage-law'), { effort: 'high', model: 'fable' }, 'the thinking seat carries the fable alias (INTAKE-19)')
  assert.deepEqual(resolveTier(TIERS_OK, 'builder-ui'), { effort: 'high', model: 'opus' }, 'a claude alias passes through unresolved — opus implements ui from the locked plan')
  assert.deepEqual(resolveTier(TIERS_OK, 'reviewer-gate'), { effort: 'high', model: 'gpt-5.6-sol' }, 'a gpt alias resolves to the concrete id')
  assert.deepEqual(resolveTier(TIERS_OK, 'builder-logic'), { effort: 'high', model: 'sonnet' }, 'the logic seat is the claude context-builder — HIGH wrapper effort (INTAKE-14b/Q1); its coder rides a bash call, never this option')
  assert.deepEqual(resolveTier(TIERS_OK, 'fallback-reviewer'), { effort: 'high', model: 'opus' }, 'the codex-absent fallback reviewer resolves to opus — a model different from the sonnet builder (duo-pool.json:7 logic_fallback)')
  assert.deepEqual(resolveTier(TIERS_OK, 'ratify-reviewer'), { effort: 'high', model: 'gpt-5.6-sol' }, 'the LAW-ratify reviewer resolves to the concrete codex id — opposite-family to the claude/fable stage-law producer (Wave 1)')
  assert.deepEqual(resolveTier(TIERS_OK, 'haiku-migration'), { effort: 'medium', model: 'sonnet' })
  const c = cfg(); c.resolver['fable'] = 'sneaky-rewrite'
  assert.deepEqual(resolveTier(c, 'stage-law'), { effort: 'high', model: 'fable' }, 'a resolver entry cannot rewrite a claude alias')
})

test('tiers: routeBuilder maps each validated surface to its builder opts', () => {
  assert.deepEqual(routeBuilder(TIERS_OK, 'ui'), { effort: 'high', model: 'opus' })
  assert.deepEqual(routeBuilder(TIERS_OK, 'logic'), { effort: 'high', model: 'sonnet' }, 'logic routes to the claude context-builder seat — HIGH wrapper effort; GPT codes through its bash call')
  assert.deepEqual(routeBuilder(TIERS_OK, 'mixed'), { effort: 'high', model: 'sonnet' }, 'mixed routes to builder-logic too — GPT codes everything but ui (the operator law)')
  // Builder-leg 404 pin (48e5fed): routeBuilder feeds agent() directly, and the
  // agent spawner is Anthropic-only — no routed surface may ever emit the
  // resolver-concrete codex id as the agent model option.
  for (const s of ['ui', 'logic', 'mixed']) {
    assert.notEqual(routeBuilder(TIERS_OK, s).model, 'gpt-5.6-sol', s + ': the concrete codex id must never reach an agent() dispatch')
  }
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
    'missing stage-law role': (c) => { delete c.roles['stage-law'] },
    'missing fallback-reviewer role': (c) => { delete c.roles['fallback-reviewer'] },
    'missing ratify-reviewer role': (c) => { delete c.roles['ratify-reviewer'] },
    'missing mixed route': (c) => { delete c.surface_routing.mixed },
    'unresolved gpt alias': (c) => { delete c.resolver['gpt-sol'] },
    'gpt-routed surface': (c) => { c.roles['builder-logic'] = { family: 'gpt', alias: 'gpt-sol', effort: 'high' } },
    'no doctrine': (c) => { c.doctrine = undefined },
  }
  for (const [name, mutate] of Object.entries(mut)) {
    const boot = JSON.parse(JSON.stringify(TIERS_OK)); mutate(boot)
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, { 'tiers:boot': boot })
    assert.equal(ret.status, 'tiers-config-invalid', name + ' must fail closed')
    assert.deepEqual(calls.map(c => c.label), ['tiers:boot'], name + ': no work after the boot')
  }
})

test('runtime (T-03): the builder leg is surface-routed — ui→builder-ui, logic/mixed→builder-logic, bare→mixed', async () => {
  const build = (entry) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: [entry] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'request:hash': HASH_OK,
    'gate:review': { exit: 0 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(GATE_ACCEPT),
    'gate:publish': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  const builderOpts = (calls) => calls.find(c => c.label === 'slice:s1').opts
  const ui = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|ui'))
  assert.equal(ui.ret.status, 'ok')
  assert.equal(builderOpts(ui.calls).model, 'opus', 'ui routes to builder-ui (opus — INTAKE-19 donkey work)')
  assert.equal(builderOpts(ui.calls).effort, 'high')
  const logic = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|logic'))
  assert.equal(builderOpts(logic.calls).model, 'sonnet', 'logic routes to builder-logic — the claude context-builder seat')
  assert.equal(builderOpts(logic.calls).effort, 'high')
  assert.ok(logic.calls.find(c => c.label === 'slice:s1').prompt.includes('(surface logic)'), 'the build prompt carries the closed surface fact for the card')
  const mixed = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|mixed'))
  assert.equal(builderOpts(mixed.calls).model, 'sonnet', 'mixed routes to builder-logic — GPT codes mixed (the operator law)')
  assert.equal(builderOpts(mixed.calls).effort, 'high')
  const bare = await runKernel({ stage: 'build', projectDir: '/p' }, build('s1'))
  assert.equal(builderOpts(bare.calls).model, 'sonnet', 'a legacy bare-string slice defaults to mixed → builder-logic')
  // Builder-leg 404 pin (48e5fed): across every dispatch of every surface run,
  // the resolver-concrete codex id never appears as an agent model option —
  // the agent spawner has no codex transport.
  for (const run of [ui, logic, mixed, bare]) {
    for (const c of run.calls) {
      assert.notEqual(c.opts && c.opts.model, 'gpt-5.6-sol', (c.label || '?') + ': the concrete codex id must never reach agent()')
    }
  }
})

test('runtime (INTAKE-19): the LAW leg spawns on stage-law (fable) — validate and report stay on stage-card', async () => {
  const stageRun = (s) => runKernel({ stage: s, projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    ['stage:' + s]: { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'working' },
    // Wave 1: the law run now ratifies before advancing (accept, sealed); the
    // validate/report runs never reach these labels (the ratify gate is law-only).
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    // Wave 2: the report run reaches the completion existence gate (law/validate never do).
    'report:check': { exit: 0 },
    'state:write': GREEN,
  })
  const law = await stageRun('law')
  const lawLeg = law.calls.find(c => c.label === 'stage:law')
  assert.equal(lawLeg.opts.model, 'fable', 'slice creation is a thinking seat — the law leg carries the fable alias')
  assert.equal(lawLeg.opts.effort, 'high')
  for (const s of ['validate', 'report']) {
    const run = await stageRun(s)
    const leg = run.calls.find(c => c.label === 'stage:' + s)
    assert.equal(leg.opts.model, undefined, s + ' stays on stage-card — inherit carries no model option')
    assert.equal(leg.opts.effort, 'high')
  }
})

// ── Wave 1 (the Second Key): the always-on cross-family LAW-ratify gate ──────

test('runtime (Wave 1): the LAW ratifies, seal-law locks it, and the run advances to build', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md', '.kiln/slices.json'], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a ratified LAW advances')
  // The kernel writes the ratify request itself (content-blind), naming the
  // opposite-family reviewer and the absolute rubric.
  const req = calls.find(c => c.label === 'ratify:request')
  assert.ok(req, 'the kernel writes the ratify request')
  assert.ok(req.prompt.includes('ratify-request.json'), 'the request lands at the ratify-request path')
  assert.ok(req.prompt.includes('law-rubric.json'), 'the request names the law rubric')
  assert.ok(req.prompt.includes('gpt-5.6-sol'), 'the reviewer is the opposite-family ratify-reviewer (codex id)')
  assert.ok(req.prompt.includes('law-ratify'), 'the review_id is kernel-issued')
  // The gate rides the kiln-review ratify verb.
  const gate = calls.find(c => c.label === 'ratify:gate')
  assert.ok(gate && gate.prompt.includes('kiln-review ratify . '), 'the gate rides the kiln-review ratify verb with the cwd-relative repo arg')
  // seal-law is the sealer on the kernel side, and it runs only after accept.
  const seal = calls.find(c => c.label === 'law:seal')
  assert.ok(seal && seal.prompt.includes('seal-law .kiln'), 'seal-law locks the ratified LAW on the cwd-relative kiln dir')
  assert.ok(calls.indexOf(gate) < calls.indexOf(seal), 'the seal follows the accept, never precedes it')
  assert.ok(lastStateDoc(calls).includes('Relaunch the kernel workflow with stage=build'), 'next_action advances to build')
})

test('runtime (Wave 1): a LAW ratify reject repairs the law, rechecks, and seals within the cap', async () => {
  const gateExits = [10, 0] // review reject, then recheck accept after one repair
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': () => ({ exit: gateExits.shift() }),
    'ratify:repair': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law, revised' },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'reject then a repaired recheck advances')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 2, 'the gate ran twice — review then recheck')
  assert.equal(calls.filter(c => c.label === 'ratify:repair').length, 1, 'exactly one repair pass landed')
  const repair = calls.find(c => c.label === 'ratify:repair')
  assert.equal(repair.opts.model, 'fable', 'the repair re-runs the LAW card on the stage-law thinking seat')
  assert.ok(repair.prompt.includes('.kiln/gate-review.json'), 'the repair reads the findings from the gate file')
  assert.ok(repair.prompt.includes('.kiln/LAW.md'), 'the repair regenerates the LAW artifact')
  assert.ok(calls.some(c => c.label === 'law:seal'), 'seal-law locks the ratified LAW')
})

test('runtime (Wave 1): a LAW that will not ratify holds after the repair cap — never a silent advance', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 10 }, // always changes_required
    'ratify:repair': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'revised' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'held', 'a non-converging LAW holds for the operator')
  assert.equal(calls.filter(c => c.label === 'ratify:repair').length, 2, 'exactly two repair passes, never a third')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 3, 'review plus two rechecks — the bounded loop')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never locks unratified')
  assert.ok(!ret.beat.includes('revised'), 'buffered repair-round beats never leak into a held transcript')
  const doc = lastStateDoc(calls)
  assert.ok(doc.includes('stage: law'), 'the run holds at the law stage')
  assert.ok(!doc.includes('stage=build'), 'never advances to build on a held LAW')
})

test('runtime (Wave 1): codex unavailable at LAW ratify holds — never the build degraded single-family continue', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 21 }, // codex unavailable
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'held', 'codex-down at law ratify is a hold, not a degraded single-family continue')
  assert.ok(!calls.some(c => c.label === 'ratify:repair'), 'no repair on codex-unavailable')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never locks without a second family')
  assert.ok(!calls.some(c => c.label === 'degraded:mark'), 'never the build degraded-continue path — the law does not lock single-family')
  assert.ok(ret.beat.toLowerCase().includes('codex'), 'the held beat is honest about the missing second family')
  assert.ok(!ret.beat.includes('sealed'), 'the law never seals')
})

test('runtime (Wave 1, A2): the SEALED-claiming LAW card beat speaks only after ratify+seal — never on a held transcript', async () => {
  // The real cards/law.md beat asserts the law is locked and build starts; on a HELD
  // that beat above the honest hold line is a self-contradicting record. The kernel
  // buffers it and emits it only after a successful ratify AND seal.
  const LAW_SEALED_BEAT = 'The law is locked. Asimov pinned your acceptance criteria into executable Law — sealed before build begins; the forge starts next.'
  const base = {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: LAW_SEALED_BEAT },
    'ratify:request': GREEN,
    'state:write': GREEN,
  }
  // HELD (codex down): the sealed narration is ABSENT — only the honest hold line.
  const held = await runKernel({ stage: 'law', projectDir: '/p' }, { ...base, 'ratify:gate': { exit: 21 } })
  assert.equal(held.ret.status, 'held')
  assert.ok(!held.ret.beat.includes('locked') && !held.ret.beat.includes('build begins') && !held.ret.beat.includes('forge starts'),
    'no SEALED / build-starts narration on a held transcript — an unratified plan never reads as sealed')
  assert.ok(held.ret.beat.toLowerCase().includes('codex'), 'only the honest hold line speaks')
  // Accept: the sealed beat appears (past ratify AND seal).
  const accept = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...base, 'ratify:gate': { exit: 0 }, 'law:seal': { exit: 0 }, 'law:stage-end': GREEN,
  })
  assert.equal(accept.ret.status, 'ok')
  assert.ok(accept.ret.beat.includes('The law is locked'), 'the sealed card beat speaks on a genuine accept')
  // Ordering proof: the beat is gated on the seal. A failed seal emits none of it.
  const sealFail = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...base, 'ratify:gate': { exit: 0 }, 'law:seal': { exit: 1 },
  })
  assert.equal(sealFail.ret.status, 'persist-failed')
  assert.ok(!sealFail.ret.beat.includes('locked'), 'the card beat is buffered until the seal lands — a failed seal emits none of it')
})

test('runtime (Wave 1, A9): a project path with a space ratifies — the mandatory gate never interpolates projectDir', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/tmp/a project dir' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a whitespace project path reaches the accept path — the 3-arg gate never splits into extra argv')
  const gate = calls.find(c => c.label === 'ratify:gate')
  const cmd = gate.prompt.split('\n').pop() // the command line, after the "Run … in <projectDir>" cwd preamble
  assert.ok(cmd.includes('kiln-review ratify . .kiln/ratify-request.json .kiln/gate-review.json'),
    'the <repo> arg is the cwd-relative `.` — exactly three whitespace-safe args')
  assert.ok(!cmd.includes('/tmp/a project dir'), 'the project path never reaches the ratify command as a bare argv token')
})

test('runtime (builder-leg 404 pin): a gpt-routed surface fails closed at boot — the codex id never reaches an agent dispatch', async () => {
  // The exact 48e5fed defect shape: surface_routing.logic -> builder-logic with the
  // seat gpt-family. Under the defective kernel this config booted, the slice leg
  // dispatched with model gpt-5.6-sol, and the Anthropic API answered 404
  // model_not_found (cleanroom receipt req_011CdBugiPWMovjbvkCV1L9c) — converted to
  // transport-failure twice, then hard-stop 3. The repaired kernel halts at boot
  // with the named configuration fact; the full build script below stands ready
  // so a regression would run it and trip the assertions. Since simple-fire the
  // SHIPPED builder-logic seat is claude (GPT codes through a bash call in the
  // card), so the defect shape is recreated by flipping the family back to gpt.
  const boot = JSON.parse(JSON.stringify(TIERS_OK))
  boot.surface_routing.logic = 'builder-logic'
  boot.roles['builder-logic'] = { family: 'gpt', alias: 'gpt-sol', effort: 'high' }
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    'tiers:boot': boot,
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'tiers-config-invalid', 'the gpt-routed surface halts at boot, never mid-build')
  assert.deepEqual(calls.map(c => c.label), ['tiers:boot'], 'nothing dispatches after the failed boot')
  for (const c of calls) {
    assert.notEqual(c.opts && c.opts.model, 'gpt-5.6-sol', 'the resolver-concrete codex id must never be an agent model option')
  }
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

// ── Simple-fire: the check receipt and the surface-branched gate ────────────

test('core (simple-fire): verdictExit maps claude gate verdicts onto the closed exit table, unknown fails closed', () => {
  assert.equal(verdictExit('accept'), 0)
  assert.equal(verdictExit('changes_required'), 10)
  assert.equal(verdictExit('blocked'), 11)
  assert.equal(verdictExit('maybe'), 20, 'an unrecognized verdict is a transport failure')
  assert.equal(verdictExit(undefined), 20)
})

test('core (simple-fire): LAW_CHECK_RECEIPT captures the full check output verbatim — stdout and exit code survive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-receipt-'))
  mkdirSync(join(dir, '.kiln/law'), { recursive: true })
  writeFileSync(join(dir, '.kiln/law/check.sh'), 'echo s1\necho boom >&2\nexit 3\n')
  const r = spawnSync('bash', ['-c', LAW_CHECK_RECEIPT], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 3, 'the check exit code survives the capture')
  assert.equal(r.stdout, 's1\nboom\n', 'the full output still reaches stdout for the ids fetch')
  assert.equal(readFileSync(join(dir, '.kiln/check-receipt.txt'), 'utf8'), 's1\nboom\n',
    'the receipt holds the full output verbatim — the evidence the reviewer judges instead of executing')
})

test('runtime (simple-fire): the gate branches on the surface — logic and mixed take the claude gate, ui alone keeps codex', async () => {
  const build = (entry, extra) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: [entry] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    ...extra,
  })
  const logic = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|logic', {
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(GATE_ACCEPT),
    'gate:publish': { exit: 0 },
  }))
  assert.equal(logic.ret.status, 'ok')
  assert.ok(!logic.calls.some(c => c.label === 'gate:review' || c.label === 'gate:recheck'),
    'codex never dispatches for a GPT-coded slice — cross-family law')
  const claude = logic.calls.find(c => c.label === 'gate-claude:review')
  assert.ok(claude, 'the claude gate dispatches for the logic surface')
  assert.ok(claude.prompt.includes('.kiln/check-receipt.txt'), 'the claude gate names the kernel-side check receipt')
  assert.ok(claude.prompt.includes('Execute nothing'), 'the reviewer is told to execute nothing')
  assert.ok(claude.prompt.includes('review-schema.json'), 'the strict verdict schema is named')
  assert.ok(claude.prompt.includes('.kiln/.gate-review.reviewer.tmp'),
    'the reviewer is told to write its verdict to the candidate file as the final act of its turn')
  assert.deepEqual(claude.opts.schema, {
    type: 'object', additionalProperties: false,
    properties: { ok: { type: 'boolean' } }, required: ['ok'],
  }, 'the reviewer return is the light {ok} ack — verdict authority lives in the file it writes')
  const invalidate = logic.calls.find(c => c.label === 'gate:invalidate')
  assert.ok(invalidate && invalidate.prompt.includes('rm -f') && invalidate.prompt.includes('.kiln/.gate-review.reviewer.tmp'),
    'the kernel invalidates the candidate before the reviewer runs — stale-candidate prevention')
  assert.ok(logic.calls.findIndex(c => c.label === 'gate:invalidate') < logic.calls.findIndex(c => c.label === 'gate-claude:review'),
    'the invalidation lands before the reviewer is invoked')
  const read = logic.calls.find(c => c.label === 'gate:read')
  assert.ok(read && read.prompt.includes('cat ') && read.prompt.includes('.kiln/.gate-review.reviewer.tmp'),
    'the kernel reads the candidate back as raw bytes — never require()+JSON.stringify')
  const publish = logic.calls.find(c => c.label === 'gate:publish')
  assert.ok(publish && publish.prompt.includes('mv -f') && publish.prompt.includes('.kiln/.gate-review.reviewer.tmp') && publish.prompt.includes('.kiln/gate-review.json'),
    'the kernel promotes the reviewer-written candidate content-free — mv tmp → gate file')
  const preSeal = logic.calls.find(c => c.label === 'law:pre-seal')
  assert.ok(preSeal.prompt.includes(LAW_CHECK_RECEIPT), 'the pre-seal leg runs the receipt-capturing check verbatim')
  assert.ok(logic.ret.beat.includes('Slice s1 sealed — dual'), 'a claude-gated logic slice seals dual')
  const mixed = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|mixed', {
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(GATE_ACCEPT),
    'gate:publish': { exit: 0 },
  }))
  assert.equal(mixed.ret.status, 'ok')
  assert.ok(mixed.calls.some(c => c.label === 'gate-claude:review'), 'the claude gate dispatches for the mixed surface too — GPT codes mixed')
  assert.ok(!mixed.calls.some(c => c.label === 'gate:review' || c.label === 'gate:recheck'),
    'codex never dispatches for a GPT-coded mixed slice — cross-family law')
  const ui = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|ui', { 'gate:review': { exit: 0 } }))
  assert.equal(ui.ret.status, 'ok')
  assert.ok(ui.calls.some(c => c.label === 'gate:review'), 'ui keeps the codex gate through scripts/kiln-review')
  assert.ok(!ui.calls.some(c => c.label && c.label.startsWith('gate-claude')), 'no claude gate on the ui surface')
})

test('runtime (simple-fire): a claude gate reject walks the same repair loop — recheck rides the claude gate too', async () => {
  const reject = {
    review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required',
    findings: [{ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }],
  }
  const reads = [reject, GATE_ACCEPT]
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate-claude:recheck': OK_ACK,
    'gate:read': () => readCandidate(reads.shift()),
    'gate:publish': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'reject then repaired recheck seals')
  const recheck = calls.find(c => c.label === 'gate-claude:recheck')
  assert.ok(recheck, 'the recheck rides the claude gate too')
  assert.ok(recheck.prompt.includes('.kiln/repair-delta.md'), 'the recheck reads the repair delta')
  // S2: the receipt is rerun fresh before the recheck round — never a stale
  // pre-repair receipt under any gate family.
  const labels = calls.map(c => c.label)
  assert.ok(labels.indexOf('law:pre-recheck') >= 0, 'the pre-recheck receipt rerun dispatches')
  assert.ok(labels.indexOf('law:pre-recheck') > labels.indexOf('repair:s1'), 'the rerun lands after the repair')
  assert.ok(labels.indexOf('law:pre-recheck') < labels.indexOf('gate-claude:recheck'), 'and before the recheck judges')
  assert.equal(calls.filter(c => c.label === 'gate:publish').length, 2, 'both verdicts published to the gate file')
  assert.ok(!calls.some(c => c.label === 'gate:review' || c.label === 'gate:recheck'), 'codex never dispatches')
  assert.ok(calls.find(c => c.label === 'repair:s1').prompt.includes('(surface logic)'),
    'the repair prompt carries the closed surface fact for the card')
})

test('runtime (S2/S3): a codex-dead logic slice stops for acknowledgment, then convenes the opus fallback gate and seals single-family, never dual', async () => {
  // The builder lost codex at build time, created .kiln/degraded per the build
  // card, and built the slice itself. S3: the kernel discovers the marker
  // pre-gate WITHOUT the acknowledgment record and takes the same degraded
  // hard-stop the exit-21 path takes — never a silent ok seal.
  const base = {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  }
  const stopped = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...base,
    'degraded-ack:check': { exit: 1 },
    'degraded:mark': { exit: 0 },
  })
  assert.equal(stopped.ret.status, 'degraded', 'a builder-marked degradation stops for acknowledgment')
  assert.ok(stopped.ret.beat.includes('Codex is not answering'), 'the sealed degradation template arrives')
  assert.ok(!stopped.calls.some(c => c.label && c.label.startsWith('gate')), 'no gate dispatches on the stop')
  assert.ok(!stopped.calls.some(c => c.label === 'seal:append'), 'nothing seals before acknowledgment')
  assert.ok(!stopped.ret.beat.includes('sealed'), 'never an ok seal over an unacknowledged marker')
  // After acknowledgment (the relaunch) the codex-absent fallback is RESTORED
  // (v3 duo-pool.json:7 logic_fallback): the sonnet-built logic slice STILL faces
  // a gate — a fresh OPUS mind, a different model than the sonnet builder, the
  // best split without a second family. The seal still reads the marker, so it
  // speaks single-family; the codex gate never dispatches (codex is gone).
  const acked = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...base,
    'degraded-ack:check': { exit: 0 },
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(GATE_ACCEPT),
    'gate:publish': { exit: 0 },
  })
  assert.equal(acked.ret.status, 'ok')
  assert.ok(acked.ret.beat.includes('Slice s1 sealed — single-family'), 'the seal speaks single-family')
  assert.ok(!acked.ret.beat.includes('dual'), 'never dual on a codex-dead run')
  const fallbackGate = acked.calls.find(c => c.label === 'gate-claude:review')
  assert.ok(fallbackGate, 'the degraded logic slice convenes the claude gate — review is not skipped')
  assert.equal(fallbackGate.opts.model, 'opus', 'the fallback reviewer is opus — a different model than the sonnet builder (the best split)')
  assert.equal(fallbackGate.opts.effort, 'high', 'the fallback gate runs at the fallback-reviewer effort')
  assert.ok(!acked.calls.some(c => c.label === 'gate:review' || c.label === 'gate:recheck'), 'the codex gate never dispatches — codex is gone, the fallback is a fresh claude mind')
  // A ui slice during a degraded, acknowledged run keeps its honest shape: a
  // cross-family codex gate is impossible without codex and a same-family gate
  // would review claude-built ui with claude, so it skips the gate entirely.
  const ackedUi = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...base,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'degraded-ack:check': { exit: 0 },
  })
  assert.equal(ackedUi.ret.status, 'ok')
  assert.ok(ackedUi.ret.beat.includes('Slice s1 sealed — single-family'), 'the ui degraded seal speaks single-family')
  assert.ok(!ackedUi.calls.some(c => c.label && c.label.startsWith('gate')), 'no gate dispatches on the degraded ui path — review is impossible cross-family without codex')
  // Any gate path: codex died during a repair pass, the builder marked
  // .kiln/degraded and repaired the slice itself, and the claude gate accepted
  // the recheck — the label still reads the marker at seal time.
  const reject = {
    review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required',
    findings: [{ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }],
  }
  const degradedChecks = [1, 0] // absent before the gate, present at seal time
  const midReads = [reject, GATE_ACCEPT]
  const midRun = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': () => ({ exit: degradedChecks.shift() }),
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate-claude:recheck': OK_ACK,
    'gate:read': () => readCandidate(midReads.shift()),
    'gate:publish': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(midRun.ret.status, 'ok')
  assert.ok(midRun.calls.some(c => c.label === 'gate-claude:recheck'), 'a gate ran on this path')
  assert.equal(midRun.calls.find(c => c.label === 'gate-claude:review').opts.model, undefined,
    'the marker appeared AFTER the gate decision, so the normal stage-card (inherit) gate ran, not the opus fallback')
  assert.ok(midRun.ret.beat.includes('Slice s1 sealed — single-family'), 'the marker rules the label even when a gate ran')
  assert.ok(!midRun.ret.beat.includes('— dual'), 'never a dual label over a same-family repair')
})

// ── S1/S2 repairs: the claude-gate semantic mirror and the fresh-receipt law ─

test('core (S1): gateReviewInvalid mirrors the kiln-review semantic law — every named violation', () => {
  const LAW = 'a'.repeat(64)
  const ok = { review_id: 'r1', law_hash: LAW, findings: [], blockers: [], verdict: 'accept' }
  const finding = { id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }
  assert.equal(gateReviewInvalid(ok, LAW), null, 'a sound accept passes')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'changes_required', findings: [finding] }, LAW), null, 'a sound reject passes')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'blocked', blockers: ['no repo access'] }, LAW), null, 'a sound block passes')
  assert.equal(gateReviewInvalid(null, LAW), 'not-an-object')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'maybe' }, LAW), 'verdict-unrecognized', 'the verdict enum is closed')
  assert.equal(gateReviewInvalid({ ...ok, law_hash: 'b'.repeat(64) }, LAW), 'law-hash-mismatch', 'a wrong law hash never passes')
  assert.equal(gateReviewInvalid({ ...ok, law_hash: '' }, LAW), 'law-hash-mismatch')
  assert.equal(gateReviewInvalid({ ...ok, findings: [finding] }, LAW), 'accept-with-findings', 'accept demands empty findings')
  assert.equal(gateReviewInvalid({ ...ok, blockers: ['b'] }, LAW), 'accept-with-findings', 'accept demands empty blockers')
  assert.equal(gateReviewInvalid({ ...ok, blockers: [' '], verdict: 'blocked' }, LAW), 'blockers-shape', 'blockers must be nonempty strings')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'changes_required' }, LAW), 'changes-required-shape', 'changes_required demands findings')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'blocked' }, LAW), 'blocked-without-blockers')
})

test('core (S1 residual): gateReviewInvalid mirrors validateGate review_id, law_hash format, and per-finding checks', () => {
  const LAW = 'a'.repeat(64)
  const ok = { review_id: 'r1', law_hash: LAW, findings: [], blockers: [], verdict: 'accept' }
  const finding = () => ({ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' })
  const reject = (findings) => ({ review_id: 'r1', law_hash: LAW, blockers: [], verdict: 'changes_required', findings })
  // review_id must be a nonempty string, exactly as the codex path demands.
  assert.equal(gateReviewInvalid({ ...ok, review_id: '' }, LAW), 'review-id-empty', 'an empty review_id fails closed')
  assert.equal(gateReviewInvalid({ ...ok, review_id: '   ' }, LAW), 'review-id-empty', 'a whitespace review_id fails closed')
  assert.equal(gateReviewInvalid({ ...ok, review_id: 7 }, LAW), 'review-id-empty', 'a non-string review_id fails closed')
  // the field set is exactly the five schema keys — nothing missing, nothing extra.
  const missing = { review_id: 'r1', law_hash: LAW, findings: [], blockers: [] }
  assert.equal(gateReviewInvalid(missing, LAW), 'fields-mismatch', 'a missing schema field fails closed')
  assert.equal(gateReviewInvalid({ ...ok, extra: 1 }, LAW), 'fields-mismatch', 'an extra field fails closed')
  // law_hash must match the lowercase 64-hex digest shape before the equality check.
  assert.equal(gateReviewInvalid({ ...ok, law_hash: 'A'.repeat(64) }, LAW), 'law-hash-mismatch', 'an uppercase digest fails the format gate')
  assert.equal(gateReviewInvalid({ ...ok, law_hash: 'a'.repeat(63) }, LAW), 'law-hash-mismatch', 'a short digest fails the format gate')
  // each finding is an object of exactly the six schema fields, all nonempty
  // strings, with a path:line location and a unique id.
  assert.equal(gateReviewInvalid(reject(['nope']), LAW), 'finding-not-an-object', 'a non-object finding fails closed')
  const shortFinding = { id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e' }
  assert.equal(gateReviewInvalid(reject([shortFinding]), LAW), 'finding-fields-mismatch', 'a finding missing a field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), extra: 'x' }]), LAW), 'finding-fields-mismatch', 'a finding with an extra field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), evidence: '' }]), LAW), 'finding-fields-empty', 'an empty finding field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), criterion: '  ' }]), LAW), 'finding-fields-empty', 'a whitespace finding field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), id: 5 }]), LAW), 'finding-fields-empty', 'a non-string finding field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), location: 'x.mjs' }]), LAW), 'finding-location-shape', 'a location with no line number fails closed')
  assert.equal(gateReviewInvalid(reject([finding(), finding()]), LAW), 'finding-id-duplicate', 'a duplicate finding id fails closed')
  // a well-formed finding still passes — including the path:line:col form.
  assert.equal(gateReviewInvalid(reject([{ ...finding(), location: 'src/a.mjs:12:4' }]), LAW), null, 'a path:line:col location passes')
})

test('runtime (S1): a claude verdict failing the semantic mirror never publishes and never seals', async () => {
  const script = (verdict) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(verdict),
    'state:write': GREEN,
  })
  const wrongHash = await runKernel({ stage: 'build', projectDir: '/p' },
    script({ ...GATE_ACCEPT, law_hash: 'b'.repeat(64) }))
  assert.equal(wrongHash.ret.status, 'transport-failure', 'a wrong law hash is transport-failure exit semantics')
  assert.ok(!wrongHash.calls.some(c => c.label === 'gate:publish'), 'a failing verdict never reaches the gate file')
  assert.ok(!wrongHash.ret.beat.includes('sealed'), 'never a seal')
  const acceptWithFindings = await runKernel({ stage: 'build', projectDir: '/p' },
    script({ ...GATE_ACCEPT, findings: [{ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }] }))
  assert.equal(acceptWithFindings.ret.status, 'transport-failure', 'accept-with-findings is rejected, exactly as the codex path rejects it')
  assert.ok(!acceptWithFindings.calls.some(c => c.label === 'gate:publish'), 'nothing publishes')
})

test('runtime (S1 residual): an empty review_id and a malformed finding each fail the claude gate closed — no publish, no seal', async () => {
  const script = (verdict) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(verdict),
    'state:write': GREEN,
  })
  const emptyId = await runKernel({ stage: 'build', projectDir: '/p' },
    script({ ...GATE_ACCEPT, review_id: '' }))
  assert.equal(emptyId.ret.status, 'transport-failure', 'an empty review_id is transport-failure exit semantics')
  assert.ok(!emptyId.calls.some(c => c.label === 'gate:publish'), 'an empty review_id never reaches the gate file')
  assert.ok(!emptyId.ret.beat.includes('sealed'), 'never a seal')
  const badFinding = await runKernel({ stage: 'build', projectDir: '/p' },
    script({
      review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required',
      findings: [{ id: 'F1', criterion: 'c', location: 'no-line-here', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }],
    }))
  assert.equal(badFinding.ret.status, 'transport-failure', 'a malformed finding location is rejected exactly as the codex path rejects it')
  assert.ok(!badFinding.calls.some(c => c.label === 'gate:publish'), 'nothing publishes on a malformed finding')
  assert.ok(!badFinding.ret.beat.includes('sealed'), 'never a seal')
})

test('runtime (S1): an unreadable review request fails the claude gate closed — the codex-path contract', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'request:hash': { exit: 1, ids: [] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(!calls.some(c => c.label === 'gate-claude:review'), 'no reviewer dispatches without the locked hash')
})

test('runtime (S2): the codex recheck also judges a fresh receipt — the rerun lands between repair and recheck', async () => {
  const gateExits = [10, 0]
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': () => ({ exit: gateExits.shift() }),
    'gate:recheck': () => ({ exit: gateExits.shift() }),
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  const labels = calls.map(c => c.label)
  assert.ok(labels.indexOf('law:pre-recheck') > labels.indexOf('repair:s1'), 'the receipt rerun lands after the repair')
  assert.ok(labels.indexOf('law:pre-recheck') < labels.indexOf('gate:recheck'), 'and before the codex recheck judges')
  const rerun = calls.find(c => c.label === 'law:pre-recheck')
  assert.ok(rerun.prompt.includes(LAW_CHECK_RECEIPT), 'the rerun is the receipt-capturing check verbatim')
})

test('runtime (S2): a red pre-recheck rerun halts law-red — no gate ever judges a stale pre-repair receipt', async () => {
  const reject = {
    review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required',
    findings: [{ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }],
  }
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': { exit: 1, ids: [] },
    'degraded:check': { exit: 1 },
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(reject),
    'gate:publish': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red', 'a red rerun takes the law door, not the transport door')
  assert.ok(!calls.some(c => c.label === 'gate-claude:recheck'), 'no recheck judges over a red law')
  assert.ok(!ret.beat.includes('sealed'), 'never a seal')
})

test('tier-keys-only: no compiled model id or alias literal lives in the kernel source', () => {
  for (const v of ['gpt-5.6-sol', "'fable'", "'opus'", "'sonnet'", "'gpt-sol'"]) {
    assert.ok(!src.includes(v), `no compiled tier value ${v} in kernel source — models live only in tiers.json`)
  }
})

// ── INTAKE-26: the order-aware boundary predicate (multi-new-slice deadlock) ──

test('core (deadlock, INTAKE-26): redSetIsFuture tolerates only unique strictly-later planned owners', () => {
  const plan = ['s1', 's2', 's3']
  // future-only: every red owner maps to a UNIQUE strictly-later slice → tolerate.
  assert.equal(redSetIsFuture(['s2'], 's1', plan), true)
  assert.equal(redSetIsFuture(['s2', 's3'], 's1', plan), true)
  assert.equal(redSetIsFuture(['s3'], 's2', plan), true)
  // unowned (empty / non-array ids) never tolerates.
  assert.equal(redSetIsFuture([], 's1', plan), false, 'an unowned red never tolerates')
  assert.equal(redSetIsFuture(undefined, 's1', plan), false, 'a non-array red never tolerates')
  // the current slice owning the red halts.
  assert.equal(redSetIsFuture(['s1'], 's1', plan), false, 'the current slice owning the red halts')
  // an earlier owner halts.
  assert.equal(redSetIsFuture(['s1'], 's2', plan), false, 'an earlier owner halts')
  assert.equal(redSetIsFuture(['s2'], 's3', plan), false)
  // an out-of-plan owner halts.
  assert.equal(redSetIsFuture(['s9'], 's1', plan), false, 'an out-of-plan owner halts')
  // a mixed valid/invalid set halts (future+current, future+out-of-plan).
  assert.equal(redSetIsFuture(['s2', 's1'], 's1', plan), false, 'a mixed future+current set halts')
  assert.equal(redSetIsFuture(['s3', 's9'], 's1', plan), false, 'a mixed future+out-of-plan set halts')
  // an ambiguous owner — one that appears more than once in the plan — halts.
  assert.equal(redSetIsFuture(['s2'], 's1', ['s1', 's2', 's2']), false, 'an ambiguous plan owner halts')
  // the current slice absent from the plan halts (defensive).
  assert.equal(redSetIsFuture(['s2'], 'sX', plan), false, 'a current slice absent from the plan halts')
})

test('runtime (deadlock, INTAKE-26): a later-planned pre-seal red is expected pre-build state — both slices seal', async () => {
  // s1 seals while the LAW is still red on the unbuilt later slice s2 (the W-04
  // pre-build state); s2 then builds and its pre-seal is green. The deadlock fix.
  const preSeals = [{ exit: 1, ids: ['s2'] }, GREEN]
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging s1' },
    'slice:s2': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging s2' },
    'law:pre-seal': () => preSeals.shift(),
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the later-planned red tolerates; s1 seals, then s2 seals green')
  assert.ok(calls.some(c => c.label === 'slice:s1') && calls.some(c => c.label === 'slice:s2'), 'both slices build')
  assert.equal(calls.filter(c => c.label === 'seal:append').length, 2, 'both slices seal')
  assert.ok(ret.beat.includes('Slice s2 sealed — dual'), 'the last slice seals dual')
})

test('runtime (deadlock, INTAKE-26): a non-future pre-seal red halts law-red — current, out-of-plan, and mixed sets never seal', async () => {
  const run = (preSealIds) => runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': { exit: 1, ids: preSealIds },
    'state:write': GREEN,
  })
  const current = await run(['s1'])
  assert.equal(current.ret.status, 'law-red', 'the current slice owning the red never seals')
  assert.ok(!current.ret.beat.includes('sealed —'), 'no seal under a current-owner red')
  assert.ok(lastStateDoc(current.calls).includes('active_slice: s1'), 'the current slice is held')
  const outOfPlan = await run(['s9'])
  assert.equal(outOfPlan.ret.status, 'law-red', 'an out-of-plan owner never seals')
  const mixed = await run(['s2', 's1'])
  assert.equal(mixed.ret.status, 'law-red', 'a mixed future+current set never seals')
})

test('runtime (deadlock, INTAKE-26): a later-planned pre-recheck red tolerates — the recheck judges and the slice seals', async () => {
  const reviewExits = [10, 0]   // s1 review reject, s2 review accept
  const recheckExits = [0]      // s1 recheck accept
  const preRecheck = [{ exit: 1, ids: ['s2'] }] // the fresh receipt before s1's recheck reds on the unbuilt s2
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'slice:s2': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': () => preRecheck.shift(),
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': () => ({ exit: reviewExits.shift() }),
    'gate:recheck': () => ({ exit: recheckExits.shift() }),
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the later-planned pre-recheck red tolerates; the recheck judges and both slices seal')
  assert.ok(calls.some(c => c.label === 'gate:recheck'), 'the recheck ran over the tolerated later-planned red')
  assert.equal(calls.filter(c => c.label === 'seal:append').length, 2, 'both slices seal')
})

test('runtime (STRIKE 2): a pre-recheck red owned by an already-SEALED later slice reopens it — future-tolerance never masks a sealed regression', async () => {
  // s1 is on the anvil and reject→repairs; the fresh pre-recheck receipt goes red
  // owned by s2 — a LATER planned slice that is already SEALED (a regression). The
  // pre-recheck must mirror the pre-seal gate: firstSealed is consulted FIRST, so
  // the sealed owner reopens and the recheck never judges a masked regression.
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    // s2 is sealed on disk, s1 is not — the per-id grep is routed on the command.
    'seal:check': (prompt) => ({ exit: prompt.includes('^s2 ') ? 0 : 1 }),
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': { exit: 1, ids: ['s2'] },
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 10 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red', 'the sealed later owner reopens instead of being tolerated')
  assert.ok(ret.beat.includes('Slice s2 reopened'), 'the sealed owner s2 is reopened, not masked')
  const doc = lastStateDoc(calls)
  assert.ok(doc.includes('active_slice: s2'), 'the reopened sealed owner is persisted as active_slice')
  assert.ok(doc.includes('Reopen slice s2'), 'next_action names the reopened owner')
  assert.ok(!calls.some(c => c.label === 'gate:recheck'), 'the recheck never runs over the masked-then-reopened red')
})

// ── INTAKE-27: producer-self-publish — invalid / stale / missing candidate ──

test('runtime (INTAKE-27): an unparseable candidate halts the claude gate — nothing promotes, nothing seals', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': { exit: 0, ids: ['this is not json at all'] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'an unparseable candidate is transport-failure exit semantics')
  assert.ok(!calls.some(c => c.label === 'gate:publish'), 'nothing promotes when the candidate will not parse')
  assert.ok(!ret.beat.includes('sealed'), 'never a seal')
})

test('runtime (INTAKE-27): a stale or missing candidate never promotes — the {ok} ack alone cannot seal', async () => {
  const base = {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'state:write': GREEN,
  }
  // (a) the reviewer returns a false ack — the kernel never reads a candidate.
  const falseAck = await runKernel({ stage: 'build', projectDir: '/p' }, { ...base, 'gate-claude:review': { ok: false } })
  assert.equal(falseAck.ret.status, 'transport-failure', 'a false ack seals nothing')
  assert.ok(!falseAck.calls.some(c => c.label === 'gate:read'), 'a false ack short-circuits before the raw read')
  assert.ok(!falseAck.calls.some(c => c.label === 'gate:publish'), 'nothing promotes on a false ack')
  // (b) the reviewer acks ok but wrote no candidate — the invalidated file cannot
  // be read back, so no stale verdict survives to promote.
  const missing = await runKernel({ stage: 'build', projectDir: '/p' }, { ...base, 'gate-claude:review': OK_ACK, 'gate:read': { exit: 1, ids: [] } })
  assert.equal(missing.ret.status, 'transport-failure', 'a missing candidate seals nothing')
  assert.ok(!missing.calls.some(c => c.label === 'gate:publish'), 'nothing promotes over a missing candidate')
  assert.ok(!missing.ret.beat.includes('sealed'), 'never a seal')
})

// ── Wave 2 (the Carriers): the report-stage completion existence gate ────────

test('runtime (Wave 2): report status ok AND .kiln/report.md non-empty seals the run done', async () => {
  const { ret, calls } = await runKernel({ stage: 'report', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:report': { facts: { status: 'ok', pointers: ['.kiln/report.md'], schema_valid: true }, narration_beat: 'the report stands' },
    'law:stage-end': GREEN,
    'report:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'done', 'a written report seals the run done')
  assert.ok(ret.beat.includes('the report stands'), 'the report card beat speaks on a genuine completion')
  const check = calls.find(c => c.label === 'report:check')
  assert.ok(check && check.prompt.includes('test -s .kiln/report.md'),
    'the gate is a mechanical content-blind test -s on the report path — no content read')
  const doc = lastStateDoc(calls)
  assert.ok(doc.includes('stage: report'), 'STATE records the report stage')
  assert.ok(doc.includes('Run complete'), 'next_action is the terminal Run complete')
})

test('runtime (Wave 2): report status ok BUT .kiln/report.md empty or missing never seals done — transport-failure holds', async () => {
  // The report card claims facts.status ok yet the artifact is absent — from the
  // content-blind kernel that is the report stage failing to deliver sound work, the
  // SAME failure class as a bad return, so it reuses transport-failure: no new status,
  // no false done. The SEALED-claiming report beat must never read above the hold.
  const REPORT_SEALED_BEAT = '`SEALED` **Report** — the report stands'
  const { ret, calls } = await runKernel({ stage: 'report', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:report': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: REPORT_SEALED_BEAT },
    'law:stage-end': GREEN,
    'report:check': { exit: 1 },
    'state:write': GREEN,
  })
  assert.notEqual(ret.status, 'done', 'an empty report never seals a false done')
  assert.equal(ret.status, 'transport-failure', 'the missing artifact reuses transport-failure — the same class as a bad return, no new status')
  assert.ok(ret.beat.includes('The stage worker returned no usable result'),
    'the sealed stage-worker transport variant (entry 1) speaks — the reused beat key, no new voice beat')
  assert.ok(!ret.beat.includes('the report stands'),
    'the SEALED-claiming report beat never reads above the honest hold line (gated before the beat push)')
  assert.equal(ret.pointers.report, '.kiln/report.md', 'the return points at the empty report artifact')
  const doc = lastStateDoc(calls)
  assert.ok(doc.includes('Rerun stage report'), 'next_action names the report-specific rerun')
  assert.ok(doc.includes('.kiln/report.md is empty or missing'), 'and says exactly what is wrong')
})
