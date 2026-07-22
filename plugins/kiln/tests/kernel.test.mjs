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
           LAW_CHECK_RECEIPT, MILESTONE_PROJECTION_CHECK, verdictExit, redSetIsFuture, gateReviewInvalid,
           validateTiers, resolveTier, routeBuilder, parseSliceEntry, milestoneSeamAfter,
           validatePosture, recoveryDecision, strictSubsetProgress, capFromDial, reconcileAudit }`)()
const {
  SPINE, parseArgs, resolveStage, nextStage, gateOutcome, reviewLoop,
  fillClosed, streakIndex, stateDoc, atomicWriteCmd, gateCmd,
  LAW_CHECK_RECEIPT, MILESTONE_PROJECTION_CHECK, verdictExit, redSetIsFuture, gateReviewInvalid,
  validateTiers, resolveTier, routeBuilder, parseSliceEntry, milestoneSeamAfter,
  validatePosture, recoveryDecision, strictSubsetProgress, capFromDial, reconcileAudit,
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
    // Wave 3: raised medium -> high — every role now sits on the HIGH-effort floor.
    'haiku-migration': { family: 'claude', alias: 'sonnet', effort: 'high' },
    'dev-sol': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
  },
}
async function runKernel(kargs, script) {
  const launch = (kargs && typeof kargs === 'object' && !Array.isArray(kargs))
    ? { plugin: PLUGIN, ...kargs }
    : kargs
  // W7-S2: every final slice is a milestone seam, so the audits.log grep-skip
  // consults on every build that reaches it; the harness answers already-logged
  // by default so pre-W7 scenarios stay on their own subject. Audit scenarios
  // override audit:check to open the seam gate.
  const full = { 'tiers:boot': TIERS_OK, 'audit:check': { exit: 0 }, ...script }
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
// Wave 3: the LAW input gate reads the onboarding outputs — the brief nonempty, then the
// posture as a valid {scope,novelty,reversibility} projection — before the law card plans.
// Every law scenario scripts these two passing legs; the gate's own fail paths override them.
const ONBOARDING_OK = {
  'onboarding:brief-check': { exit: 0 },
  'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar', reversibility: 'reversible' },
  // Wave 3 (brownfield arm): greenfield by default — no marker, so the map-check
  // short-circuits and never runs. Brownfield law scenarios override this leg.
  'onboarding:brownfield-check': { exit: 1 },
  // W5-S2 (W5-04): the Gauge WIDTH dial read rides the law happy path AFTER the input gate.
  // floor keeps the single act producer — the untouched pre-W5-S2 path — so every existing law
  // scenario stays on the floor unless it overrides width:read. Law-only: validate/report never
  // reach the width branch, so an unused floor mock is harmless where ONBOARDING_OK is spread there.
  // W6-F: recovery_cap 2 matches this reversible onboarding posture, so the LAW-ratify loop keeps
  // the two-repair cap the pre-W6 hardcoded bound gave it — one dial read now carries both.
  'width:read': { exit: 0, width: 'floor', recovery_cap: 2 },
}
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
  // W-01: exactly THREE JSON.parse calls — the sanctioned parse-and-hop args
  // adapter in the pure core (envelope mechanics), the gate-file mirror in the
  // workflow runtime (the kernel parses the raw candidate bytes it validates
  // and publishes), and the W7-S2 audit-verdict mirror (the kernel parses the
  // published audit bytes it rederives through reconcileAudit). All are
  // sanctioned envelope reads, never content parsing.
  assert.equal(code.split('JSON.parse').length - 1, 3, 'exactly three JSON.parse (the args adapter + the gate-file mirror + the audit-verdict mirror)')
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

test('review loop (W6-F): the repair edge is bounded by the injected reversibility-keyed cap — cap 2 allows two traversals, cap 1 one, both then block', async () => {
  // The pre-W6 hardcoded bound of 2 is now the keyed cap. The regenerate edge is traversable up
  // to the cap, then holds — parameterized on the two reachable caps (2 reversible, 1 otherwise).
  for (const cap of [2, 1]) {
    const calls = { gate: [], repair: [] }
    const exits = [10, 10, 10]
    const r = await reviewLoop({
      gate: async (mode) => { calls.gate.push(mode); return exits.shift() },
      repair: async (pass) => { calls.repair.push(pass); return true },
    }, cap)
    assert.deepEqual(r, { result: 'blocked', repairs: cap }, 'cap ' + cap + ': exactly cap edge traversals, then blocked')
    assert.equal(calls.repair.length, cap, 'cap ' + cap + ': the regenerate edge is traversed exactly cap times')
    assert.deepEqual(calls.gate, cap === 2 ? ['review', 'recheck', 'recheck'] : ['review', 'recheck'],
      'cap ' + cap + ': review then cap rechecks, never one more')
  }
})

test('core (W6-F): capFromDial keys the recovery cap on the dial — cap 2 only on exit 0 + recovery_cap exactly 2, else fail up to 1; width never enters', () => {
  assert.equal(capFromDial({ exit: 0, recovery_cap: 2 }), 2, 'exit 0 and recovery_cap 2 (the reversible profile) is the only cap-2 reading')
  assert.equal(capFromDial({ exit: 0, recovery_cap: 1 }), 1, 'recovery_cap 1 (risky/irreversible) keys cap 1')
  assert.equal(capFromDial({ exit: 0, width: 'wide', recovery_cap: 2 }), 2, 'a wide reading with recovery_cap 2 is still cap 2 — width never lowers it')
  assert.equal(capFromDial({ exit: 0, width: 'wide', recovery_cap: 1 }), 1, 'a wide reading with recovery_cap 1 is cap 1 — width never RAISES the cap')
  assert.equal(capFromDial({ exit: 0 }), 1, 'a missing recovery_cap fails up to 1')
  assert.equal(capFromDial({ exit: 20, recovery_cap: 2 }), 1, 'a transport failure fails up to 1 even when a cap value rode along')
  assert.equal(capFromDial({ exit: 0, recovery_cap: '2' }), 1, 'a string "2" is not the integer 2 — strict, fails up to 1')
  assert.equal(capFromDial({ exit: 0, recovery_cap: 3 }), 1, 'an out-of-range cap fails up to 1')
  assert.equal(capFromDial(undefined), 1, 'an absent leg fails up to 1, never throws')
})

test('review loop: clean accept seals with zero repairs; reject→accept seals after one', async () => {
  const mk = (exits) => ({ gate: async () => exits.shift(), repair: async () => true })
  assert.deepEqual(await reviewLoop(mk([0]), 2), { result: 'sealed', repairs: 0 })
  assert.deepEqual(await reviewLoop(mk([10, 0]), 2), { result: 'sealed', repairs: 1 })
})

test('review loop: an unconfirmed repair halts visibly — no recheck runs', async () => {
  const gates = []
  const r = await reviewLoop({
    gate: async (mode) => { gates.push(mode); return 10 },
    repair: async () => false,
  }, 2)
  assert.deepEqual(r, { result: 'repair-failed', repairs: 1 })
  assert.deepEqual(gates, ['review'], 'recheck must not run after a failed repair')
})

test('review loop: blocked, degradation, and transport failure short-circuit without repair', async () => {
  let repaired = false
  const mk = (exit) => ({ gate: async () => exit, repair: async () => { repaired = true; return true } })
  assert.equal((await reviewLoop(mk(11), 2)).result, 'blocked')
  assert.equal((await reviewLoop(mk(21), 2)).result, 'degraded')
  assert.equal((await reviewLoop(mk(20), 2)).result, 'transport-failure')
  assert.equal((await reviewLoop(mk(127), 2)).result, 'gate-unreachable')
  assert.equal((await reviewLoop(mk(126), 2)).result, 'gate-unreachable')
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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

test('runtime (W6-F/S3): the build-gate reviewLoop honors the dial-keyed cap over a STRICTLY-shrinking cohort — recovery_cap 2 allows two slice repairs, 1 one, both then held at the cap; one dial read per invocation', async () => {
  const build = (recoveryCap) => {
    // W6-S3: to spend a cap use each round the recheck cohort must strictly shrink; a non-shrinking
    // cohort holds on the first recheck. findings:fetch serves the cohort read (once per reject), the
    // repair-beat read (once per repair), and the blocked-beat read (once at the terminal held), so
    // the sequence pairs each round cohort with the read that follows it — the cohort reads (indices
    // 0,2,4) walk {F1,F2,F3} → {F1,F2} → {F1}. cap 2 walks all three; cap 1 holds after the first shrink.
    const findings = [['F1', 'F2', 'F3'], ['F1', 'F2', 'F3'], ['F1', 'F2'], ['F1', 'F2'], ['F1'], ['F1']]
    return {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: recoveryCap },
      'seal:check': { exit: 1 },
      'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
      'law:pre-seal': GREEN,
      'law:pre-recheck': GREEN,
      'degraded:check': { exit: 1 },
      'gate:review': { exit: 10 },
      'gate:recheck': { exit: 10 },
      'findings:fetch': () => ({ exit: 0, ids: findings.shift() }),
      'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repairing' },
      'delta:check': { exit: 0 },
      'state:write': GREEN,
    }
  }
  for (const [recoveryCap, repairs, gates] of [[2, 2, 3], [1, 1, 2]]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, build(recoveryCap))
    assert.equal(ret.status, 'blocked', 'recovery_cap ' + recoveryCap + ': a non-converging gate blocks at the cap')
    assert.equal(calls.filter(c => c.label === 'repair:s1').length, repairs, 'recovery_cap ' + recoveryCap + ': exactly cap regenerate-slice traversals')
    const gateRounds = calls.filter(c => c.label === 'gate:review' || c.label === 'gate:recheck').length
    assert.equal(gateRounds, gates, 'recovery_cap ' + recoveryCap + ': review plus cap rechecks, never one more')
    assert.equal(calls.filter(c => c.label === 'cap:read').length, 1, 'recovery_cap ' + recoveryCap + ': one dial read per build invocation, reused for the slice gate')
    assert.ok(calls.find(c => c.label === 'cap:read').prompt.includes('gauge-dial.mjs'), 'the cap is read from the gauge-dial projector')
  }
})

test('runtime (W6-07): the ui build gate takes the cwd-relative repo `.` — a whitespace project path never splits the gate argv', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/tmp/a project dir' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a whitespace project path reaches the accept path — the fixed-arity gate never splits into extra argv')
  const cmd = calls.find(c => c.label === 'gate:review').prompt.split('\n').pop() // the command line, after the "Run … in <projectDir>" cwd preamble
  assert.equal(cmd, gateCmd('review', { plugin: PLUGIN, repo: '.', request: '.kiln/review-request.json', gate: '.kiln/gate-review.json' }),
    'the review command equals exactly the fixed-arity gate — repo `.`, three whitespace-safe args, matching the ratify gate; any extra argv a bare project path would add breaks equality')
  assert.ok(!cmd.includes('/tmp/a project dir'), 'the project path never reaches the review command as a bare argv token')
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
  assert.deepEqual(resolveTier(TIERS_OK, 'haiku-migration'), { effort: 'high', model: 'sonnet' }, 'raised to the HIGH floor (Wave 3)')
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
  assert.deepEqual(parseSliceEntry('obj|hello-page|ui'), { id: 'hello-page', surface: 'ui', milestone: '', valid: true })
  assert.deepEqual(parseSliceEntry('obj|logic-core|logic'), { id: 'logic-core', surface: 'logic', milestone: '', valid: true })
  assert.deepEqual(parseSliceEntry('obj|m|mixed'), { id: 'm', surface: 'mixed', milestone: '', valid: true })
  assert.equal(parseSliceEntry('obj|s1|bogus').valid, false, 'an unknown object surface is invalid — never silently mixed')
  assert.equal(parseSliceEntry('obj|s1|').valid, false, 'a missing object surface is invalid')
  assert.equal(parseSliceEntry('obj||ui').valid, false, 'a missing object id is invalid')
  assert.deepEqual(parseSliceEntry('bare-legacy'), { id: 'bare-legacy', surface: 'mixed', milestone: '', valid: true }, 'a legacy bare string defaults to mixed')
  assert.equal(parseSliceEntry('').valid, false, 'an empty descriptor is invalid')
})

test('W7-S1: parseSliceEntry pins the ONE slice-id charset shared with append-audit — slash ids pass, whitespace, control and shell-active bytes halt at intake', () => {
  // The id rides an unquoted shell word at seal:append, the grep anchors over
  // seals.log/audits.log, and the audit argv — kernel-valid must equal publishable.
  assert.deepEqual(parseSliceEntry('obj|feature/ui|ui'), { id: 'feature/ui', surface: 'ui', milestone: '', valid: true }, 'a path-like slash id is inside the shared charset')
  assert.deepEqual(parseSliceEntry('feature/ui'), { id: 'feature/ui', surface: 'mixed', milestone: '', valid: true }, 'a legacy slash id stays valid')
  assert.equal(parseSliceEntry('obj|has space|ui').valid, false, 'whitespace in an id would split the unquoted seal append — rejected at intake')
  assert.equal(parseSliceEntry('has space').valid, false, 'a legacy bare id is charset-gated the same way')
  assert.equal(parseSliceEntry('obj|bad;id|ui').valid, false, 'a shell-active byte in an id never reaches an interpolation')
  assert.equal(parseSliceEntry('obj|bad\nid|ui').valid, false, 'a control byte in an id could forge or split a log line — rejected')
})

test('S1 (A9/W5-07): parseSliceEntry parses the optional four-slot milestone label — legacy forms stay valid, a smuggled separator or control char is rejected', () => {
  // 4-slot object: the trailing label is carried.
  assert.deepEqual(parseSliceEntry('obj|scaffold|logic|foundation'),
    { id: 'scaffold', surface: 'logic', milestone: 'foundation', valid: true }, 'the fourth slot is the milestone label')
  assert.deepEqual(parseSliceEntry('obj|home|ui|the shipping table'),
    { id: 'home', surface: 'ui', milestone: 'the shipping table', valid: true }, 'a label may carry spaces')
  // Legacy 3-slot object and bare string: an absent label normalizes to ''.
  assert.deepEqual(parseSliceEntry('obj|s1|ui'),
    { id: 's1', surface: 'ui', milestone: '', valid: true }, 'a legacy 3-slot object reads an absent label as ""')
  assert.equal(parseSliceEntry('bare').milestone, '', 'a legacy bare string carries an absent label')
  // Separator safety: a raw '|' in the label splits into a fifth slot — rejected, never guessed.
  assert.equal(parseSliceEntry('obj|s1|ui|a|b').valid, false, 'a | in the label smuggles the descriptor separator — rejected')
  // Control-char safety: a label cannot smuggle a char that breaks the descriptor transport.
  assert.equal(parseSliceEntry('obj|s1|ui|bad').valid, false, 'a control char in the label is rejected')
  assert.equal(parseSliceEntry('obj|s1|ui|bad\nlabel').valid, false, 'a newline in the label is rejected')
  // An empty fourth slot is a present-but-unlabeled slice — valid, milestone ''.
  assert.deepEqual(parseSliceEntry('obj|s1|ui|'),
    { id: 's1', surface: 'ui', milestone: '', valid: true }, 'an empty trailing slot is an unlabeled slice')
  // W5-S1-01: the label is trimmed to the SAME bytes MILESTONE_PROJECTION_CHECK compares, so a
  // padded cell that passes projection agreement cannot fabricate a spurious seam downstream.
  assert.deepEqual(parseSliceEntry('obj|s1|ui| alpha '),
    { id: 's1', surface: 'ui', milestone: 'alpha', valid: true }, 'a padded label is normalized to its trimmed bytes')
  // W5-S1-03: the control-free invariant covers C1 (U+0080–U+009F), which survives a whitespace trim.
  assert.equal(parseSliceEntry('obj|s1|ui|bad' + String.fromCharCode(0x9f)).valid, false, 'a C1 control char (U+009F) in the label is rejected')
  assert.equal(parseSliceEntry('obj|s1|ui|bad' + String.fromCharCode(0x80)).valid, false, 'a C1 control char (U+0080) in the label is rejected')
})

test('S1 (A9/W5-07): milestoneSeamAfter is the pure seam closed fact — final slice or a label change, never mid-run', () => {
  // Seam after the FINAL slice, always — the last milestone completes at the end.
  assert.equal(milestoneSeamAfter(['a', 'a'], 1), true, 'the final slice always closes a seam')
  assert.equal(milestoneSeamAfter(['solo'], 0), true, 'a single-slice run seams at its one slice')
  // Seam on an ADJACENT label change.
  assert.equal(milestoneSeamAfter(['a', 'b'], 0), true, 'a label change places the seam after the completing milestone')
  // NO seam mid-run of the same label.
  assert.equal(milestoneSeamAfter(['a', 'a', 'a'], 1), false, 'no seam inside a run of one label')
  // NO spurious seam after the first slice when the next slice shares the label.
  assert.equal(milestoneSeamAfter(['a', 'a'], 0), false, 'no seam after the first slice of a continuing milestone')
  // An unlabeled run ('' everywhere) is one whole-build seam at the final slice (A9 implicit final).
  assert.equal(milestoneSeamAfter(['', '', ''], 0), false, 'unlabeled: no early seam')
  assert.equal(milestoneSeamAfter(['', '', ''], 1), false, 'unlabeled: no mid seam')
  assert.equal(milestoneSeamAfter(['', '', ''], 2), true, 'unlabeled: the single whole-build seam is the final slice')
  // Out-of-range / non-array indices never fabricate a seam.
  assert.equal(milestoneSeamAfter(['a'], 5), false, 'an out-of-range index is no seam')
  assert.equal(milestoneSeamAfter(['a'], -1), false, 'a negative index is no seam')
  assert.equal(milestoneSeamAfter([], 0), false, 'an empty label list is no seam')
  assert.equal(milestoneSeamAfter(undefined, 0), false, 'a non-array is no seam')
})

test('S1 (A9/W5-03): MILESTONE_PROJECTION_CHECK is the deterministic agreement leg — matching table/projection pass, any divergence or missing table fails', () => {
  const run = (law, slices) => {
    const dir = mkdtempSync(join(tmpdir(), 'kiln-proj-'))
    mkdirSync(join(dir, '.kiln'))
    writeFileSync(join(dir, '.kiln', 'LAW.md'), law)
    writeFileSync(join(dir, '.kiln', 'slices.json'), JSON.stringify(slices))
    return spawnSync('bash', ['-c', MILESTONE_PROJECTION_CHECK], { cwd: dir }).status
  }
  const PLAN = '# LAW\nfoo · scaffold · runs\n\n## Plan\n| slice | milestone |\n| --- | --- |\n| scaffold | foundation |\n| render | foundation |\n| ship |  |\n'
  const MATCH = [{ id: 'scaffold', surface: 'mixed', milestone: 'foundation' }, { id: 'render', surface: 'ui', milestone: 'foundation' }, { id: 'ship', surface: 'logic' }]
  assert.equal(run(PLAN, MATCH), 0, 'the projection agrees with the authoritative table — proceed')
  // A label divergence halts.
  const badLabel = [{ id: 'scaffold', surface: 'mixed', milestone: 'foundation' }, { id: 'render', surface: 'ui', milestone: 'delivery' }, { id: 'ship', surface: 'logic' }]
  assert.equal(run(PLAN, badLabel), 1, 'a projected label that differs from the table halts')
  // An order/id divergence halts.
  const badOrder = [{ id: 'render', surface: 'ui', milestone: 'foundation' }, { id: 'scaffold', surface: 'mixed', milestone: 'foundation' }, { id: 'ship', surface: 'logic' }]
  assert.equal(run(PLAN, badOrder), 1, 'a projection out of table order halts')
  // A missing authoritative table halts — the projection has nothing to agree with.
  assert.equal(run('# LAW\nno plan table here\n', MATCH), 1, 'a missing plan table halts — the labels have no authority')
  // An all-unlabeled run agrees when both carry empty labels in order.
  const UNLABELED = '## Plan\n| slice | milestone |\n| --- | --- |\n| a |  |\n| b |  |\n'
  assert.equal(run(UNLABELED, [{ id: 'a', surface: 'ui' }, { id: 'b', surface: 'logic', milestone: '' }]), 0, 'an unlabeled table and projection agree')
  // W5-S1-02: the parser is anchored to `## Plan` — an otherwise-matching table with no `## Plan`
  // heading carries no authority and halts.
  const NO_HEADING = '# LAW\n| slice | milestone |\n| --- | --- |\n| a | x |\n'
  assert.equal(run(NO_HEADING, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a table not under `## Plan` has no authority — halt')
  // W5-S1-02: a missing GFM delimiter row halts — its first data row is not silently discarded.
  const NO_DELIM = '## Plan\n| slice | milestone |\n| a | x |\n'
  assert.equal(run(NO_DELIM, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a missing delimiter row is malformed — halt')
  // W5-S1-02: an extra data cell is malformed — the parser reads exactly two, never the first two.
  const EXTRA_CELL = '## Plan\n| slice | milestone |\n| --- | --- |\n| a | x | injected |\n'
  assert.equal(run(EXTRA_CELL, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a row with a third cell is malformed — halt, never truncated to two')
  // W5-S1-02: `##Plan` has no space after the hashes — not a GFM ATX heading, so it is prose and carries no authority.
  const TIGHT_HASH = '##Plan\n| slice | milestone |\n| --- | --- |\n| a | x |\n'
  assert.equal(run(TIGHT_HASH, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, '`##Plan` is prose not a heading — the anchor requires `## Plan`, halt')
  // W5-S1-02: an empty `## Plan` section does not bleed into a later `## Other` table — the section boundary holds.
  const SECTION_BLEED = '## Plan\n\n## Other\n| slice | milestone |\n| --- | --- |\n| a | x |\n'
  assert.equal(run(SECTION_BLEED, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a table under a later heading is outside the Plan section — halt')
  // W5-S1-02: a GFM delimiter needs at least three hyphens per cell — one- or two-hyphen rows are malformed.
  const THIN_DELIM_1 = '## Plan\n| slice | milestone |\n| - | - |\n| a | x |\n'
  assert.equal(run(THIN_DELIM_1, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a single-hyphen delimiter is malformed — halt')
  const THIN_DELIM_2 = '## Plan\n| slice | milestone |\n| -- | -- |\n| a | x |\n'
  assert.equal(run(THIN_DELIM_2, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a two-hyphen delimiter is malformed — halt')
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    ...ONBOARDING_OK, // law-only gate; validate/report never consume these
    'law:preflight': GREEN,
    ['stage:' + s]: { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'working' },
    // Wave 1: the law run now ratifies before advancing (accept, sealed); the
    // validate/report runs never reach these labels (the ratify gate is law-only).
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
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
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md', '.kiln/slices.json'], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
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

test('runtime (S1, A9/W5-03): the milestone projection is checked BEFORE the seal — it agrees, then the seal follows', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a ratified LAW whose projection agrees seals and advances')
  const proj = calls.find(c => c.label === 'law:milestone-projection')
  assert.ok(proj, 'the projection-agreement leg runs on the sealed branch')
  assert.ok(proj.prompt.includes('slices.json') && proj.prompt.includes('LAW.md'),
    'the leg compares slices.json against the LAW plan table')
  const gate = calls.find(c => c.label === 'ratify:gate')
  const seal = calls.find(c => c.label === 'law:seal')
  assert.ok(calls.indexOf(gate) < calls.indexOf(proj) && calls.indexOf(proj) < calls.indexOf(seal),
    'the projection is checked after the ratify accept and before the seal — a mismatched plan never locks')
})

test('runtime (S1, A9/W5-03): a milestone projection that disagrees with the LAW plan table holds — never a silent seal', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 1 }, // slices.json disagrees with the authoritative plan table
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'a projection mismatch is an honest hold — a reused status, no new beat')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never seals while the projection disagrees with its table')
  assert.ok(!ret.beat.includes('locked') && !ret.beat.toLowerCase().includes('sealed'),
    'no SEALED / locked narration on a projection-mismatch hold')
  const doc = lastStateDoc(calls)
  assert.ok(doc.includes('stage: law') && !doc.includes('stage=build'), 'the run holds at law — never advances to build')
})

test('runtime (Wave 1): a LAW ratify reject repairs the law, rechecks, and seals within the cap', async () => {
  const gateExits = [10, 0] // review reject, then recheck accept after one repair
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': () => ({ exit: gateExits.shift() }),
    // S3: the review reject establishes the cohort; the recheck then accepts (the empty subset).
    'ratify:cohort': { exit: 0, ids: ['f1'] },
    'ratify:repair': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law, revised' },
    'law:milestone-projection': { exit: 0 },
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

test('runtime (Wave 1/S3): a LAW that will not ratify holds after the repair cap over a strictly-shrinking cohort — never a silent advance', async () => {
  // S3: each recheck clears one finding (a strict shrink, so the edge earns a scoped-move), but the
  // cap (2, from the reversible onboarding posture) still exhausts before the cohort empties → held.
  const cohorts = [['f1', 'f2', 'f3'], ['f1', 'f2'], ['f1']]
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 10 }, // always changes_required
    'ratify:cohort': () => ({ exit: 0, ids: cohorts.shift() }),
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

test('runtime (W6-F): a risky posture keys the LAW-ratify cap to 1 — one repair then held; the dial sets the cap, the width never raises it', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    // A risky/irreversible posture keys recovery_cap 1. width stays floor so the single-act
    // producer runs (the WIDE dance is orthogonal) — the cap follows recovery_cap, never the width.
    'width:read': { exit: 0, width: 'floor', recovery_cap: 1 },
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 10 }, // always changes_required
    // S3: the recheck strictly shrinks (a scoped-move earned), but the cap of 1 exhausts after it.
    'ratify:cohort': (() => { const seq = [['f1', 'f2'], ['f1']]; return () => ({ exit: 0, ids: seq.shift() }) })(),
    'ratify:repair': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'revised' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'held', 'a non-converging LAW under a cap of 1 holds for the operator')
  assert.equal(calls.filter(c => c.label === 'ratify:repair').length, 1, 'exactly one repair pass — the keyed cap of 1, never the pre-W6 hardcoded two')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 2, 'review plus one recheck — the cap-1 bounded loop, never a third gate')
  assert.equal(calls.filter(c => c.label === 'width:read').length, 1, 'one dial read per LAW invocation carries both the width and the ratify cap — never re-read for the loop')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never locks unratified')
})

test('runtime (W6-S3 dogfood, LAW): a LAW recheck that clears nothing holds immediately — no strict progress, well under the cap, the law never locks', async () => {
  // The recheck re-grade reports the same cohort: nothing cleared, so recoveryDecision holds on the
  // first recheck even though the cap (2, the reversible posture) has an edge left. The edge was
  // still spent — one repair pass ran — but equality earns no credit and the LAW never seals.
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 10 }, // always changes_required
    'ratify:cohort': { exit: 0, ids: ['f1'] }, // constant — the recheck clears nothing
    'ratify:repair': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'revised' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'held', 'a non-shrinking LAW recheck holds the law for the operator')
  assert.equal(calls.filter(c => c.label === 'ratify:repair').length, 1, 'exactly one repair edge spent — the equality holds before the cap of 2')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 2, 'review plus one recheck, never the cap-2 third gate')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never locks over a stalled ratify')
})

test('runtime (W6-S3 dogfood, LAW): a recheck introducing a new finding id is rejected by the ratify-recheck transport and holds before the subset — the cohort is read only on the establishing review', async () => {
  // The establishing review pins cohort {f1}. A repaired LAW's recheck re-grade is checked against
  // that pinned cohort by the ratify-recheck verb (allowedFindingIds, scripts/kiln-review): a re-grade
  // finding id OUTSIDE {f1} is rejected closed (exit 20 — the tamper the verb enforces, proven in
  // kiln-review.test.mjs), a re-grade WITHIN it re-grades as an ordinary reject (exit 10). The mock
  // gate computes its recheck exit from that rule, so the exit is a function of the smuggled id, not
  // the recheck mode. Running both re-grades proves the causal link: the out-of-cohort id — the sole
  // difference between the two runs — is what turns the recheck into a terminal transport hold, and
  // the failed recheck holds before any second cohort read (the {f1,f2} escape is never reached).
  const establishingCohort = ['f1']
  const run = (regradeCohort) => {
    const escapes = regradeCohort.some(id => !establishingCohort.includes(id))
    return runKernel({ stage: 'law', projectDir: '/p' }, {
      ...VOICE,
      ...ONBOARDING_OK,
      'law:preflight': GREEN,
      'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
      'ratify:request': GREEN,
      'ratify:gate': (prompt) => ({ exit: prompt.includes('ratify-recheck') ? (escapes ? 20 : 10) : 10 }),
      'ratify:cohort': { exit: 0, ids: establishingCohort },
      'ratify:repair': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'revised' },
      'state:write': GREEN,
    })
  }
  // Smuggle: the re-grade introduces f2, an id outside {f1} → the ratify-recheck transport rejects.
  const { ret, calls } = await run(['f1', 'f2'])
  assert.equal(ret.status, 'transport-failure', 'the out-of-cohort recheck fails the transport — a visible terminal hold, never a seal')
  const recheck = calls.find(c => c.label === 'ratify:gate' && c.prompt.includes('ratify-recheck'))
  assert.ok(recheck, 'the recheck is routed through the cohort-enforcing ratify-recheck verb — the transport that rejects the escape')
  assert.equal(calls.filter(c => c.label === 'ratify:cohort').length, 1, 'the cohort is read only on the establishing review — the failed recheck holds before any subset eval')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never locks')
  // Control: an otherwise-identical re-grade confined to {f1} routes through the SAME ratify-recheck
  // verb yet never trips the transport — so the smuggled out-of-cohort id, not the recheck itself, is
  // what causes the terminal hold.
  const control = await run(['f1'])
  assert.ok(control.calls.some(c => c.label === 'ratify:gate' && c.prompt.includes('ratify-recheck')), 'the control still routes the re-grade through the ratify-recheck verb — the only difference from the smuggle run is the introduced id')
  assert.notEqual(control.ret.status, 'transport-failure', 'a within-cohort re-grade never trips the transport fault — the introduced id is the sole cause of the terminal hold')
  assert.ok(!control.calls.some(c => c.label === 'law:seal'), 'the within-cohort re-grade still never seals — it reads as an ordinary held')
})

test('runtime (Wave 1): codex unavailable at LAW ratify holds — never the build degraded single-family continue', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
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
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: LAW_SEALED_BEAT },
    'ratify:request': GREEN,
    'law:milestone-projection': { exit: 0 },
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
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
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

// ── W5-S2 (the WIDE table): the blind-dual planning branch — holds safely on mismatch ──

// The WIDE promote happy path, reused by the promote pin and the content-blind pin. It overrides
// the ONBOARDING_OK floor width with a WIDE reading and scripts the full blind-dual dance.
const WIDE_PROMOTE_RUN = {
  ...VOICE,
  ...ONBOARDING_OK,
  'law:preflight': GREEN,
  'width:read': { exit: 0, width: 'wide' }, // a non-floor width → the WIDE branch (overrides the ONBOARDING_OK floor)
  'wide:prep': { exit: 0 },
  'wide:draft-a': { facts: { status: 'ok', pointers: ['.kiln/.wide/a/LAW.md'], schema_valid: true }, narration_beat: 'draft a' },
  'wide:draft-b': { facts: { status: 'ok', pointers: ['.kiln/.wide/b/LAW.md'], schema_valid: true }, narration_beat: 'draft b' },
  'wide:adjust-a': { facts: { status: 'ok', pointers: ['.kiln/.wide/a-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'The law is locked — the wide plan converged.', converged: true },
  'wide:adjust-b': { facts: { status: 'ok', pointers: ['.kiln/.wide/b-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'adjusted b', converged: true },
  'wide:byte-equal': { exit: 0 }, // the two adjusted LAW.md are identical
  'wide:promote': { exit: 0 },
  'ratify:request': GREEN,
  'ratify:gate': { exit: 0 },
  'law:milestone-projection': { exit: 0 },
  'law:seal': { exit: 0 },
  'law:stage-end': GREEN,
  'state:write': GREEN,
}

// ── W5-S3 (the fresh Q-F adjudicator): a residual divergence is adjudicated, not held ──
// The adjudicate happy path (byte-mismatch → residual divergence), reused by the adjudicate pin and
// the content-blind pin. Both authors valid and converged, but the two adjusted LAW.md differ, so
// the cmp is nonzero: the fresh Q-F adjudicator authors the complete canonical LAW and the ordinary
// opposite-family ratify+seal still runs — replacing S2's temporary hold-on-mismatch.
const WIDE_ADJUDICATE_RUN = {
  ...VOICE,
  ...ONBOARDING_OK,
  'law:preflight': GREEN,
  'width:read': { exit: 0, width: 'wide' },
  'wide:prep': { exit: 0 },
  'wide:draft-a': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'a' },
  'wide:draft-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b' },
  'wide:adjust-a': { facts: { status: 'ok', pointers: ['.kiln/.wide/a-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'a2', converged: true },
  'wide:adjust-b': { facts: { status: 'ok', pointers: ['.kiln/.wide/b-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'b2', converged: true },
  'wide:byte-equal': { exit: 1 }, // the two adjusted LAW.md differ — a residual divergence
  'wide:adjudicate': { facts: { status: 'ok', pointers: ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md'], schema_valid: true }, narration_beat: 'The law is locked — the residual divergences were adjudicated.' },
  'wide:adjudicate-check': { exit: 0 }, // the four canonical outputs are all present and nonempty
  'ratify:request': GREEN,
  'ratify:gate': { exit: 0 },
  'law:milestone-projection': { exit: 0 },
  'law:seal': { exit: 0 },
  'law:stage-end': GREEN,
  'state:write': GREEN,
}

test('runtime (W5-S2, W5-04): the floor width keeps the single act producer — no WIDE legs, ratify+seal as ever', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK, // carries the floor width read — the untouched pre-W5-S2 path
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the floor path ratifies and seals exactly as before W5-S2')
  assert.ok(calls.some(c => c.label === 'stage:law'), 'the EXISTING single act producer runs on the floor')
  for (const l of ['wide:prep', 'wide:draft-a', 'wide:draft-b', 'wide:adjust-a', 'wide:adjust-b', 'wide:byte-equal', 'wide:promote']) {
    assert.ok(!calls.some(c => c.label === l), 'no WIDE leg fires on the floor: ' + l)
  }
  const width = calls.find(c => c.label === 'width:read')
  assert.ok(width && width.prompt.includes('gauge-dial.mjs'), 'width is read via the gauge-dial projector leg (mirroring research-sweep)')
  const si = calls.findIndex(c => c.label === 'stage:law')
  assert.ok(calls.indexOf(width) >= 0 && calls.indexOf(width) < si, 'the width read runs after the input gate, before the producer')
})

test('runtime (W5-S2, W5-01/04): a WIDE width runs two blind authors; both-converged + byte-equal promotes the complete four-output LAW → ratify+seal', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, WIDE_PROMOTE_RUN)
  assert.equal(ret.status, 'ok', 'a converged, byte-equal WIDE plan promotes, ratifies, seals, and advances')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'the single act producer is skipped on the WIDE path')
  for (const l of ['wide:draft-a', 'wide:draft-b', 'wide:adjust-a', 'wide:adjust-b', 'wide:byte-equal', 'wide:promote']) {
    assert.ok(calls.some(c => c.label === l), 'the WIDE leg ran: ' + l)
  }
  assert.ok(!calls.some(c => c.label === 'wide:adjudicate'), 'the byte-equal skip does NOT run the adjudicator (S3): a converged, byte-equal pair promotes without adjudication')
  // No role #13 (W5-05): the authors are fresh stage-law (fable) legs.
  for (const l of ['wide:draft-a', 'wide:draft-b', 'wide:adjust-a', 'wide:adjust-b']) {
    assert.equal(calls.find(c => c.label === l).opts.model, 'fable', l + ' is a fresh stage-law (fable) leg — no new tier role')
  }
  // Both IMMUTABLE drafts precede either adjustment (each author cross-reads the other's draft).
  const dA = calls.findIndex(c => c.label === 'wide:draft-a')
  const dB = calls.findIndex(c => c.label === 'wide:draft-b')
  const aA = calls.findIndex(c => c.label === 'wide:adjust-a')
  const aB = calls.findIndex(c => c.label === 'wide:adjust-b')
  assert.ok(dA < aA && dB < aA && dA < aB && dB < aB, 'both immutable drafts land before either cross-read adjustment')
  // The promote moves the COMPLETE four-output LAW to canonical, guarded by test -s, before ratify.
  const promote = calls.find(c => c.label === 'wide:promote')
  for (const out of ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md']) {
    assert.ok(promote.prompt.includes(out), 'the promote moves the complete four-output LAW: ' + out)
  }
  assert.ok(promote.prompt.includes('test -s'), 'the promote guards completeness with test -s — an incomplete WIDE result fails closed')
  const gate = calls.find(c => c.label === 'ratify:gate')
  const seal = calls.find(c => c.label === 'law:seal')
  assert.ok(calls.indexOf(promote) < calls.indexOf(gate), 'the promote precedes ratify — the ratify block is rejoined unchanged')
  assert.ok(calls.indexOf(gate) < calls.indexOf(seal), 'the seal follows the accept')
  assert.ok(ret.beat.includes('The law is locked'), 'the promoted candidate beat speaks only after ratify+seal')
  assert.ok(lastStateDoc(calls).includes('stage=build'), 'a promoted+ratified WIDE law advances to build')
})

test('runtime (W5-S3, W5-05): a WIDE byte-mismatch runs the fresh Q-F adjudicator → complete canonical LAW + ADRs → ratify+seal (no hold)', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, WIDE_ADJUDICATE_RUN)
  assert.equal(ret.status, 'ok', 'a residual divergence is adjudicated, ratified, sealed, and advances — S2\'s hold is gone')
  assert.ok(calls.some(c => c.label === 'wide:byte-equal'), 'the byte-equality cmp ran (both legs valid and converged)')
  assert.ok(!calls.some(c => c.label === 'wide:promote'), 'a residual divergence never promotes a candidate unchanged')
  const adj = calls.find(c => c.label === 'wide:adjudicate')
  assert.ok(adj, 'the fresh Q-F adjudicator runs on a residual divergence, replacing S2\'s hold-on-mismatch')
  // A fresh stage-law (fable) leg, labeled distinctly — NO role #13, no new tier role.
  assert.equal(adj.opts.model, 'fable', 'the adjudicator is a fresh stage-law (fable) leg — decorrelated by freshness, not a new tier role')
  for (const l of ['wide:draft-a', 'wide:draft-b', 'wide:adjust-a', 'wide:adjust-b'])
    assert.notEqual(adj.label, l, 'the adjudicator is labeled distinctly from the two author legs')
  // Residual-only: consolidate the agreed, rule ONLY the divergences, never a silent whole-new plan.
  assert.ok(/consolidat/i.test(adj.prompt) && /rule only the surviving divergences/i.test(adj.prompt),
    'the adjudicator scaffold binds consolidate-agreed + rule-only-residuals')
  assert.ok(/never synthesize a wholly new plan/i.test(adj.prompt),
    'the adjudicator is forbidden from silently synthesizing a wholly new plan (ADR A11)')
  // It authors the COMPLETE four-output canonical LAW and records adjudication ADRs in decisions.md.
  for (const out of ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md'])
    assert.ok(adj.prompt.includes(out), 'the adjudicator writes the complete canonical output: ' + out)
  assert.ok(/ADR/.test(adj.prompt) && adj.prompt.includes('.kiln/decisions.md'),
    'the adjudicator appends adjudication ADRs to decisions.md (card/agent-authored — the kernel never writes it)')
  // The ordinary opposite-family ratify STILL runs, rejoined unchanged, and the seal follows accept.
  const gate = calls.find(c => c.label === 'ratify:gate')
  const seal = calls.find(c => c.label === 'law:seal')
  assert.ok(gate && seal, 'the adjudicated LAW still takes the ordinary opposite-family ratify + seal')
  const req = calls.find(c => c.label === 'ratify:request')
  assert.ok(req.prompt.includes('gpt-5.6-sol'), 'the ratify request still names the opposite-family gpt reviewer — the ratify block is unchanged')
  assert.ok(calls.indexOf(adj) < calls.indexOf(gate) && calls.indexOf(gate) < calls.indexOf(seal),
    'adjudicate → ratify → seal: the ratify block is rejoined unchanged')
  // W5-S3-02: the kernel GATES the adjudicated canon before ratify — a test -s on each of the four
  // canonical outputs, mirroring WIDE_PROMOTE. A status-'ok' self-report alone never reaches ratify.
  const canon = calls.find(c => c.label === 'wide:adjudicate-check')
  assert.ok(canon, 'the adjudicated canon passes a completeness gate before ratify')
  for (const out of ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md'])
    assert.ok(canon.prompt.includes('test -s ' + out), 'the completeness gate tests the canonical output nonempty: ' + out)
  assert.ok(calls.indexOf(adj) < calls.indexOf(canon) && calls.indexOf(canon) < calls.indexOf(gate),
    'the completeness gate runs after adjudicate and before ratify — an incomplete adjudicated LAW never ratifies')
  assert.ok(ret.beat.includes('The law is locked'), 'the adjudicated candidate beat speaks only after ratify+seal')
  assert.ok(lastStateDoc(calls).includes('stage=build'), 'an adjudicated+ratified WIDE law advances to build')
})

test('runtime (W5-S3-02): an adjudicator that returns status ok but schema_valid false HOLDS — status ok alone never proves a valid canonical LAW', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...WIDE_ADJUDICATE_RUN,
    'wide:adjudicate': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: false }, narration_beat: 'x' },
  })
  assert.equal(ret.status, 'transport-failure', 'a status-ok but schema-invalid adjudication holds as a transport failure')
  assert.ok(!calls.some(c => c.label === 'wide:adjudicate-check'), 'the completeness gate is short-circuited when the adjudicator declares its own output invalid')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'an unsound adjudicated LAW never reaches ratify')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'an unsound adjudicated LAW never seals')
})

test('runtime (W5-S3-02): an adjudicated canon that is incomplete on disk FAILS CLOSED — the four test -s gate blocks ratify, mirroring WIDE_PROMOTE', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...WIDE_ADJUDICATE_RUN,
    'wide:adjudicate-check': { exit: 1 }, // a canonical output is missing or empty
  })
  assert.equal(ret.status, 'persist-failed', 'an incomplete adjudicated canon fails closed — the completeness floor WIDE_PROMOTE enforces on the skip path')
  assert.ok(calls.some(c => c.label === 'wide:adjudicate-check'), 'the completeness gate ran on a schema-valid adjudication')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'an incomplete adjudicated LAW never reaches ratify')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'an incomplete adjudicated LAW never seals')
})

test('runtime (W5-S3, W5-05): a non-converged WIDE report is adjudicated with the byte-equality cmp short-circuited — the kernel never guesses convergence', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...WIDE_ADJUDICATE_RUN,
    'wide:adjust-a': { facts: { status: 'ok', pointers: ['.kiln/.wide/a-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'a2', converged: false }, // one author still sees a divergence
  })
  assert.equal(ret.status, 'ok', 'a converged:false report is adjudicated regardless of byte-equality')
  assert.ok(!calls.some(c => c.label === 'wide:byte-equal'), 'the byte-equality cmp is short-circuited on a non-converged report — the kernel never guesses convergence')
  assert.ok(calls.some(c => c.label === 'wide:adjudicate'), 'the fresh adjudicator resolves the honest divergence instead of holding')
  assert.ok(calls.some(c => c.label === 'law:seal'), 'the adjudicated law still ratifies and seals')
})

test('runtime (W5-S3): a WIDE author that returns unsound work HOLDS — an invalid leg is never promoted OR adjudicated', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'width:read': { exit: 0, width: 'wide' },
    'wide:prep': { exit: 0 },
    'wide:draft-a': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'a' },
    'wide:draft-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b' },
    'wide:adjust-a': { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '', converged: false },
    'wide:adjust-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b2', converged: true },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'an invalid author leg holds as a transport failure — not a residual divergence to adjudicate')
  assert.ok(!calls.some(c => c.label === 'wide:byte-equal'), 'the cmp is short-circuited when a leg is invalid')
  assert.ok(!calls.some(c => c.label === 'wide:promote'), 'an invalid leg is never promoted')
  assert.ok(!calls.some(c => c.label === 'wide:adjudicate'), 'an invalid leg is never adjudicated — there is no valid candidate pair')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the law never seals on an invalid leg')
})

test('runtime (W5-S3, content-blind): the adjudication is the AGENT\'s call recorded in ADRs — the kernel branches only on the width, converged, and byte-equality closed facts', async () => {
  const { calls } = await runKernel({ stage: 'law', projectDir: '/p' }, WIDE_ADJUDICATE_RUN)
  // The kernel's only reads around the divergence are closed facts, never plan content: the width
  // dial and the byte-equality cmp -s. The adjudicator (an agent stage leg) rules and records ADRs.
  const cmp = calls.find(c => c.label === 'wide:byte-equal')
  assert.ok(cmp.prompt.includes('cmp -s') && cmp.prompt.includes('/LAW.md'), 'the divergence signal is a closed cmp -s fact — the kernel never opens the plan to decide')
  // W5-S3-01: the byte gate compares the COMPLETE four-output set — equal LAW.md with a divergent
  // check.sh/slices.json/decisions.md is a residual divergence that adjudicates, never a silent skip.
  for (const out of ['LAW.md', 'law/check.sh', 'slices.json', 'decisions.md'])
    assert.ok(cmp.prompt.includes('.kiln/.wide/a-adjusted/' + out) && cmp.prompt.includes('.kiln/.wide/b-adjusted/' + out),
      'the byte gate compares the full canonical set across both adjusted candidates: ' + out)
  const adj = calls.find(c => c.label === 'wide:adjudicate')
  assert.ok(adj.opts.schema && adj.opts.schema.properties && adj.opts.schema.properties.facts,
    'adjudication is dispatched as an agent stage leg (the kernel reads no plan content to adjudicate)')
  assert.ok(adj.prompt.includes('.kiln/decisions.md') && /ADR/.test(adj.prompt),
    'the residual calls are recorded in decisions.md by the agent — never a kernel content-read')
  // No orchestration family/persona/model token rides the adjudicator scaffold (prompt-level anonymity).
  for (const token of ['fable', 'gpt', 'opus', 'sonnet', 'codex', 'sol'])
    assert.ok(!new RegExp('\\b' + token + '\\b', 'i').test(adj.prompt), 'no orchestration token "' + token + '" in the adjudicator scaffold')
})

test('runtime (W5-S2, W5-06): the two WIDE author scaffolds are isomorphic modulo the A/B paths — cross-read carries no author metadata, no orchestration family token', async () => {
  const { calls } = await runKernel({ stage: 'law', projectDir: '/p', idea: 'a broad reader-facing catalog with many pages' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'width:read': { exit: 0, width: 'wide' },
    'wide:prep': { exit: 0 },
    'wide:draft-a': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'a' },
    'wide:draft-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b' },
    'wide:adjust-a': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'a2', converged: false },
    'wide:adjust-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b2', converged: false },
    // A non-converged pair now runs the adjudicator (S3); this test only inspects the two author
    // scaffolds already captured above, so a held adjudicator leg suffices — no ratify/seal needed.
    'wide:adjudicate': { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '' },
    'state:write': GREEN,
  })
  // Normalize ONLY the neutral A/B candidate paths; scaffolds that differ solely there are isomorphic.
  const norm = (s) => s
    .split('.kiln/.wide/a-adjusted').join('WIDE_ADJ')
    .split('.kiln/.wide/b-adjusted').join('WIDE_ADJ')
    .split('.kiln/.wide/a').join('WIDE_DIR')
    .split('.kiln/.wide/b').join('WIDE_DIR')
  const dA = calls.find(c => c.label === 'wide:draft-a').prompt
  const dB = calls.find(c => c.label === 'wide:draft-b').prompt
  assert.equal(norm(dA), norm(dB), 'the two draft scaffolds are isomorphic modulo the A/B candidate dir')
  const aA = calls.find(c => c.label === 'wide:adjust-a').prompt
  const aB = calls.find(c => c.label === 'wide:adjust-b').prompt
  assert.equal(norm(aA), norm(aB), 'the two adjust scaffolds are isomorphic modulo the A/B candidate dirs')
  // Each adjust cross-reads ONLY the OTHER draft, with no author identity supplied.
  assert.ok(aA.includes('.kiln/.wide/b') && aA.includes('no author identity'), 'adjust-a cross-reads the b draft with no provenance')
  assert.ok(aB.includes('.kiln/.wide/a') && aB.includes('no author identity'), 'adjust-b cross-reads the a draft with no provenance')
  // No orchestration family/persona/model token rides either author scaffold (prompt-level anonymity).
  for (const p of [dA, dB, aA, aB]) {
    for (const token of ['fable', 'gpt', 'opus', 'sonnet', 'codex', 'sol']) {
      assert.ok(!new RegExp('\\b' + token + '\\b', 'i').test(p), 'no orchestration token "' + token + '" in a WIDE author scaffold')
    }
  }
})

test('runtime (W5-S2, content-blind): the WIDE branch decides on width + converged + byte-equality closed facts — cmp -s on the two adjusted LAW.md, never a plan read', async () => {
  const { calls } = await runKernel({ stage: 'law', projectDir: '/p' }, WIDE_PROMOTE_RUN)
  const cmp = calls.find(c => c.label === 'wide:byte-equal')
  assert.ok(cmp.prompt.includes('cmp -s') && cmp.prompt.includes('/LAW.md'), 'byte-equality is a closed cmp -s fact on the two adjusted LAW.md — the kernel never opens the plan')
  assert.ok(cmp.prompt.includes('.kiln/.wide/a-adjusted/LAW.md') && cmp.prompt.includes('.kiln/.wide/b-adjusted/LAW.md'), 'the cmp compares the two isolated adjusted candidates')
  const width = calls.find(c => c.label === 'width:read')
  assert.ok(width.prompt.includes('the value of the "width" field'), 'the width read is a closed dial projection, never a posture parse in the kernel body')
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    // The kernel snapshots the prior gate before the recheck judges: review_id r1, cohort {F1}.
    'recheck:cohort': { exit: 0, ids: ['r1', 'F1'] },
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

test('runtime (W6-S3 dogfood, build): a recheck that clears nothing holds immediately — no strict progress, the edge spent, well under the cap, never a seal', async () => {
  // The review and the recheck report the SAME cohort {F1}: the repair edge was spent but nothing
  // cleared, so recoveryDecision holds on the first recheck even though the cap (2) has an edge
  // left. Equality is no progress — the loop never walks to the cap, and nothing seals over a stall.
  const finding = { id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }
  const reject = { review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required', findings: [finding] }
  const reads = [reject, reject] // the recheck clears nothing — an equal cohort
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 1 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'degraded:check': { exit: 1 },
    'request:hash': HASH_OK,
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate-claude:recheck': OK_ACK,
    'recheck:cohort': { exit: 0, ids: ['r1', 'F1'] },
    'gate:read': () => readCandidate(reads.shift()),
    'gate:publish': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'blocked', 'a non-shrinking recheck is an operator-ruling hold, not a transport fault')
  assert.equal(calls.filter(c => c.label === 'repair:s1').length, 1, 'exactly one repair edge spent — the equality holds before the cap of 2')
  assert.equal(calls.filter(c => c.label === 'gate:publish').length, 2, 'the review and the one recheck each published; no third gate ran')
  assert.ok(!calls.some(c => c.label === 'seal:append'), 'nothing seals over a stalled gate')
})

test('runtime (W6-XF-01): the claude recheck is bound to the snapshotted prior cohort — a renamed review_id or a new finding fails closed, never publishes, never seals', async () => {
  const finding = (id) => ({ id, criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' })
  const reject = { review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required', findings: [finding('F1')] }
  // The recheck reuses the issued review_id but SMUGGLES a finding id outside the
  // snapshotted prior cohort {F1} — the same tamper scripts/kiln-review rejects.
  const outOfCohort = { ...reject, findings: [finding('F1'), finding('F2')] }
  // The recheck RENAMES the issued review_id — a fresh lineage the kernel rejects.
  const renamedId = { ...reject, review_id: 'r2' }
  const build = (recheckVerdict) => {
    const reads = [reject, recheckVerdict]
    return {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: 2 },
      'seal:check': { exit: 1 },
      'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
      'law:pre-seal': GREEN,
      'law:pre-recheck': GREEN,
      'degraded:check': { exit: 1 },
      'request:hash': HASH_OK,
      'gate:invalidate': { exit: 0 },
      'gate-claude:review': OK_ACK,
      'gate-claude:recheck': OK_ACK,
      // The prior published gate the kernel snapshots before the recheck judges.
      'recheck:cohort': { exit: 0, ids: ['r1', 'F1'] },
      'gate:read': () => readCandidate(reads.shift()),
      'gate:publish': { exit: 0 },
      'findings:fetch': { exit: 0, ids: ['F1'] },
      'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
      'delta:check': { exit: 0 },
      'seal:append': { exit: 0 },
      'state:write': GREEN,
    }
  }
  for (const [name, verdict] of [['a new out-of-cohort finding', outOfCohort], ['a renamed review_id', renamedId]]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, build(verdict))
    const cohort = calls.find(c => c.label === 'recheck:cohort')
    assert.ok(cohort && cohort.prompt.includes('.kiln/gate-review.json'),
      name + ': the kernel snapshots the prior gate before the recheck judges')
    assert.equal(ret.status, 'transport-failure', name + ' fails the recheck closed, exactly as the codex transport rejects it')
    assert.equal(calls.filter(c => c.label === 'gate:publish').length, 1,
      name + ': only the first review published — the tainted recheck never promotes')
    assert.ok(!calls.some(c => c.label === 'seal:append'), name + ': nothing seals')
    assert.ok(!ret.beat.includes('sealed'), name + ': never a seal')
  }
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'recheck:cohort': { exit: 0, ids: ['r1', 'F1'] },
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

// ── W6 (S1): the recovery-decision core + the OPTIONAL gate cohort ───────────

test('core (W6-B): strictSubsetProgress is true only for a STRICT shrink — equality, superset, and empty-prior are all false', () => {
  assert.equal(strictSubsetProgress(['f1', 'f2', 'f3'], ['f1', 'f2']), true, 'a strict subset (one cleared) is progress')
  assert.equal(strictSubsetProgress(['f1', 'f2'], []), true, 'clearing every finding is the empty strict subset (accept upstream)')
  assert.equal(strictSubsetProgress(['f1', 'f2'], ['f1', 'f2']), false, 'equality clears nothing — no progress')
  assert.equal(strictSubsetProgress(['f1'], ['f1', 'f2']), false, 'a superset (a new id appeared) is not progress')
  assert.equal(strictSubsetProgress(['f1', 'f2'], ['f1', 'f3']), false, 'a renamed id (same size, one not in prior) is not progress')
  assert.equal(strictSubsetProgress([], []), false, 'an empty prior can never shrink')
  assert.equal(strictSubsetProgress([], ['f1']), false, 'no cohort to shrink from')
  assert.equal(strictSubsetProgress('nope', ['f1']), false, 'a non-array prior fails to false, never throws')
  assert.equal(strictSubsetProgress(['f1'], null), false, 'a non-array curr fails to false, never throws')
})

test('core (W6-01/S3): recoveryDecision is the single transition policy — advance, scoped-move, establishment, a missing oracle, and every held path', () => {
  // cohortEstablished true = a measured recheck (a prior cohort is pinned): the base subset case.
  const base = { edgeUses: 0, cap: 2, cohortEstablished: true, priorBlockingIds: ['f1', 'f2'], currBlockingIds: ['f1'], schemaValid: true, transport: true }
  // a machine fault rules first, before the subset is even considered — even on an accept.
  assert.deepEqual(recoveryDecision({ ...base, transport: false, gateOutcome: 'accept' }), { action: 'held', reason: 'transport-failure' }, 'a downed transport holds before any progress read')
  assert.deepEqual(recoveryDecision({ ...base, schemaValid: false, gateOutcome: 'accept' }), { action: 'held', reason: 'schema-invalid' }, 'a malformed verdict holds before the subset eval')
  // accept advances.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'accept' }), { action: 'advance', reason: 'accept' }, 'accept advances')
  // reject (the gateOutcome return for exit 10) with strict progress and an edge left is a scoped-move.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject' }), { action: 'scoped-move', reason: 'strict-subset-progress' }, 'a shrinking cohort within cap is a scoped-move')
  // equality / no strict progress holds regardless of cap.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject', currBlockingIds: ['f1', 'f2'] }), { action: 'held', reason: 'no-strict-progress' }, 'equality (cleared nothing) holds')
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject', currBlockingIds: ['f1', 'f3'] }), { action: 'held', reason: 'no-strict-progress' }, 'a renamed id (no strict shrink) holds')
  // strict progress but the cap is exhausted holds.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject', edgeUses: 2 }), { action: 'held', reason: 'cap-exhausted' }, 'progress with no edge left holds')
  // S3: the establishing reject (no prior cohort pinned) has nothing to disprove — progress by
  // definition, a scoped-move up to the cap with its own reason; the cohort arrays are not consulted.
  assert.deepEqual(recoveryDecision({ ...base, cohortEstablished: false, gateOutcome: 'reject' }), { action: 'scoped-move', reason: 'establishing' }, 'a reject with no prior cohort establishes — a scoped-move, never a subset test')
  assert.deepEqual(recoveryDecision({ ...base, cohortEstablished: false, gateOutcome: 'reject', edgeUses: 2 }), { action: 'held', reason: 'cap-exhausted' }, 'an establishing reject with no edge left holds at the cap')
  // S3: a wired oracle that read no cohort is a missing verdict — held before any subset eval.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject', oracleMissing: true }), { action: 'held', reason: 'oracle-missing' }, 'a missing cohort oracle holds before the subset is weighed')
  // blocked and any unrecognized outcome fall to the held floor.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'blocked' }), { action: 'held', reason: 'blocked' }, 'a block holds')
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'transport_failure' }), { action: 'held', reason: 'blocked' }, 'an unrecognized outcome falls to the held floor')
})

test('core (W6-03): gateReviewInvalid enforces the OPTIONAL cohort — expected review_id and the allowed-id set, agreeing with the transport', () => {
  const LAW = 'a'.repeat(64)
  const finding = (id) => ({ id, criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' })
  const reject = (findings) => ({ review_id: 'cohort-1', law_hash: LAW, blockers: [], verdict: 'changes_required', findings })
  const accept = { review_id: 'cohort-1', law_hash: LAW, findings: [], blockers: [], verdict: 'accept' }
  // Absent cohort inputs: the pre-cohort behavior is unchanged — any review_id, any id passes.
  assert.equal(gateReviewInvalid({ ...accept, review_id: 'anything' }, LAW), null, 'no expected id → any review_id passes')
  assert.equal(gateReviewInvalid(reject([finding('brand-new')]), LAW), null, 'no allowed set → any finding id passes')
  // expectedReviewId present: the review_id must equal the issued id.
  assert.equal(gateReviewInvalid(accept, LAW, 'cohort-1'), null, 'a matching review_id passes the lineage check')
  assert.equal(gateReviewInvalid({ ...accept, review_id: 'other' }, LAW, 'cohort-1'), 'review-id-mismatch', 'a mismatched review_id fails closed')
  // allowedFindingIds present: an in-cohort subset passes; an out-of-cohort id fails — the
  // SAME rule scripts/kiln-review validateShape enforces, so kernel and transport agree.
  const cohort = new Set(['f1', 'f2'])
  assert.equal(gateReviewInvalid(reject([finding('f1')]), LAW, 'cohort-1', cohort), null, 'an in-cohort subset passes')
  assert.equal(gateReviewInvalid(accept, LAW, 'cohort-1', cohort), null, 'clearing every finding (accept) passes the cohort')
  assert.equal(gateReviewInvalid(reject([finding('f1'), finding('f3')]), LAW, 'cohort-1', cohort), 'finding-id-out-of-cohort', 'a new/renamed id outside the cohort fails closed')
  // the existing unique-id check still fires ahead of the cohort check.
  assert.equal(gateReviewInvalid(reject([finding('f1'), finding('f1')]), LAW, 'cohort-1', cohort), 'finding-id-duplicate', 'a duplicate id is caught before the cohort check')
})

test('core (W7-01): reconcileAudit derives the audit verdict from the closed arrays — blockers dominant, then findings, else accept', () => {
  assert.deepEqual(reconcileAudit([], []), { verdict: 'accept', blockerIds: [], findingIds: [] }, 'no findings and no blockers is accept')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }, { id: 'f2' }], []),
    { verdict: 'changes_required', blockerIds: [], findingIds: ['f1', 'f2'] }, 'findings with no blockers is changes_required')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }, { id: 'f2' }], ['f2']),
    { verdict: 'blocked', blockerIds: ['f2'], findingIds: ['f1', 'f2'] }, 'any blocker dominates — the verdict is blocked')
})

test('core (W7-01): reconcileAudit dedups by id in first-seen input order, and a duplicated id with any blocker instance stays a blocker (max severity)', () => {
  assert.deepEqual(reconcileAudit([{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a', 'c']),
    { verdict: 'blocked', blockerIds: ['c', 'a'], findingIds: ['b', 'a', 'c'] }, 'both arrays dedup preserving first-seen input order')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }, { id: 'f1' }], ['f1']),
    { verdict: 'blocked', blockerIds: ['f1'], findingIds: ['f1'] }, 'a duplicated finding id named by a blocker collapses to one blocker — max severity, blockers dominant')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }, { id: 'f1' }], []),
    { verdict: 'changes_required', blockerIds: [], findingIds: ['f1'] }, 'a duplicated finding id with no blocker collapses to one finding')
})

test('core (W7-01): reconcileAudit rules invalid on the referential breach, malformed inputs, and adversarial shapes — never throws', () => {
  const INVALID = { verdict: 'invalid', blockerIds: [], findingIds: [] }
  assert.deepEqual(reconcileAudit([{ id: 'f1' }], ['f2']), INVALID, 'a blocker naming no finding id is the referential breach')
  assert.deepEqual(reconcileAudit([], ['b1']), INVALID, 'a blocked shape with empty findings has nothing behind its blockers — invalid')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }], ['']), INVALID, 'an empty-string blocker is invalid')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }], [7]), INVALID, 'a non-string blocker is invalid')
  assert.deepEqual(reconcileAudit('nope', []), INVALID, 'a non-array findings input is invalid')
  assert.deepEqual(reconcileAudit([], 'nope'), INVALID, 'a non-array blockers input is invalid')
  assert.deepEqual(reconcileAudit(undefined, undefined), INVALID, 'absent inputs are invalid, never a throw')
  assert.deepEqual(reconcileAudit([{}], []), INVALID, 'a finding without an id is invalid')
  assert.deepEqual(reconcileAudit([{ id: '' }], []), INVALID, 'an empty-string finding id is invalid')
  assert.deepEqual(reconcileAudit([{ id: '   ' }], []), INVALID, 'a whitespace-only finding id is invalid')
  assert.deepEqual(reconcileAudit([{ id: 7 }], []), INVALID, 'a non-string finding id is invalid')
  assert.deepEqual(reconcileAudit(['f1'], []), INVALID, 'a bare-string finding entry is invalid')
  assert.deepEqual(reconcileAudit([null], []), INVALID, 'a null finding entry is invalid')
  assert.deepEqual(reconcileAudit([['f1']], []), INVALID, 'an array finding entry is invalid')
})

test('runtime (S1): a claude verdict failing the semantic mirror never publishes and never seals', async () => {
  const script = (verdict) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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
    'cap:read': { exit: 0, recovery_cap: 2 },
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

// ── Wave 3 (the Gauge foundation): the LAW input gate. postureToDials (the dial PROJECTOR)
// moved to scripts/gauge-dial.mjs in W4 — its tests live in tests/gauge-dial.test.mjs, and the
// enum-agreement test there pins the kernel's frozen enums against the projector's copy. The
// kernel keeps validatePosture and those frozen enums for the LAW input gate ────

test('core (Wave 3): validatePosture accepts exactly {scope,novelty,reversibility} over the frozen enums', () => {
  assert.equal(validatePosture({ scope: 'small', novelty: 'familiar', reversibility: 'reversible' }), true)
  assert.equal(validatePosture({ scope: 'large', novelty: 'novel', reversibility: 'irreversible' }), true)
  assert.equal(validatePosture({ scope: 'small', novelty: 'novel', reversibility: 'risky' }), true)
})

test('core (Wave 3): validatePosture rejects a malformed or out-of-enum posture — reuses the frozen enums, never throws', () => {
  const good = { scope: 'small', novelty: 'familiar', reversibility: 'reversible' }
  assert.equal(validatePosture(undefined), false, 'a missing posture is rejected')
  assert.equal(validatePosture(null), false)
  assert.equal(validatePosture('small'), false, 'a non-object is rejected')
  assert.equal(validatePosture(['small', 'familiar', 'reversible']), false, 'an array is rejected')
  assert.equal(validatePosture({ scope: 'small', novelty: 'familiar' }), false, 'a missing field is rejected')
  assert.equal(validatePosture({ ...good, extra: 1 }), false, 'an extra field is rejected (exact-field guard)')
  assert.equal(validatePosture({ ...good, scope: 'medium' }), false, 'an unknown scope is rejected')
  assert.equal(validatePosture({ ...good, novelty: 'weird' }), false, 'an unknown novelty is rejected')
  assert.equal(validatePosture({ ...good, reversibility: 'maybe' }), false, 'an unknown reversibility is rejected')
  const ownKeysBomb = new Proxy({}, { ownKeys() { throw new Error('boom') } })
  assert.doesNotThrow(() => validatePosture(ownKeysBomb))
  assert.equal(validatePosture(ownKeysBomb), false, 'a throwing ownKeys trap fails to false, never throws')
})

// ── Wave 3 (the Gauge foundation): the LAW input gate — the deterministic post-producer
// check on the onboarding outputs (brief + posture) before the law card plans ──────────

test('runtime (Wave 3): a present brief and a valid posture pass the LAW input gate BEFORE planning', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'large', novelty: 'novel', reversibility: 'irreversible' },
    'onboarding:brownfield-check': { exit: 1 }, // greenfield — no map required
    'width:read': { exit: 0, width: 'floor' }, // W5-S2: the input gate passes, then the floor width keeps the single act
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the gate passes and the law stage plans, ratifies, and seals')
  const brief = calls.findIndex(c => c.label === 'onboarding:brief-check')
  const posture = calls.findIndex(c => c.label === 'onboarding:posture')
  const plan = calls.findIndex(c => c.label === 'stage:law')
  assert.ok(brief >= 0 && posture >= 0, 'both input checks ran')
  assert.ok(brief < plan && posture < plan, 'the input gate runs BEFORE the law card plans')
  const postureCall = calls.find(c => c.label === 'onboarding:posture')
  assert.ok(postureCall.prompt.includes('posture.json') && postureCall.prompt.includes('node -p'),
    'posture is read via a boot-style node -p projection leg — never a raw parse in the kernel body')
  assert.ok(!postureCall.prompt.includes('scope:p.scope'),
    'the projection carries every on-disk key faithfully — never a hand-picked three-field triple, which would silently strip a persisted dial or effort past the gate')
  assert.equal(postureCall.opts.model, undefined, 'the posture leg carries the kernel-leg tier (inherit → no model option)')
  assert.equal(postureCall.opts.effort, 'high')
})

test('runtime (Wave 3): a missing/empty brief halts the LAW stage — reused transport-failure, never a silent plan', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 1 }, // brief empty or missing
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'a missing brief holds the run')
  assert.ok(!calls.some(c => c.label === 'onboarding:posture'), 'the posture is never read once the brief fails')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'the law stage never plans without its inputs')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'never reaches ratify')
  const doc = lastStateDoc(calls)
  assert.ok(doc.includes('Rerun onboarding'), 'next_action names a rerun of onboarding')
  assert.ok(!doc.includes('stage=build'), 'never advances to build')
})

test('runtime (Wave 3): an unreadable posture.json halts the LAW stage — reused transport-failure', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 1 }, // posture.json missing or unreadable
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'no planning on an unreadable posture')
  assert.ok(lastStateDoc(calls).includes('Rerun onboarding'))
})

test('runtime (Wave 3): an out-of-enum posture halts the LAW stage — validatePosture rejects, transport-failure', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'medium', novelty: 'novel', reversibility: 'reversible' }, // scope not in enum
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'an invalid posture holds the run')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'an invalid posture never reaches planning')
})

test('runtime (Wave 3): a posture missing a field halts the LAW stage — the exact-field guard rejects', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar' }, // reversibility dropped by the projection
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'a partial posture never reaches planning')
})

test('runtime (Wave 3): an EXTRA posture field halts the LAW stage — the faithful projection carries it, the exact-field guard rejects a persisted dial or effort', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    // A valid three-field posture with an effort/dial persisted alongside: the faithful
    // {...p} projection carries the extra own key through instead of cherry-picking the
    // three it recognizes, so validatePosture's exact-field guard rejects it. This is the
    // on-disk-extras case the projection used to erase before validatePosture ever ran.
    'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar', reversibility: 'reversible', effort: 'high' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'an over-specified posture holds the run — no persisted dials or effort admitted')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'an extra-field posture never reaches planning')
})

test('runtime (Wave 3, brownfield): a present .kiln/brownfield marker with a nonempty codebase-map passes the gate — the LAW plans', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'large', novelty: 'familiar', reversibility: 'reversible' },
    'onboarding:brownfield-check': { exit: 0 }, // the marker is present — a brownfield run
    'onboarding:map-check': { exit: 0 },         // the codebase map is nonempty
    'width:read': { exit: 0, width: 'floor' }, // W5-S2: the input gate passes, then the floor width keeps the single act
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a brownfield run with a map plans, ratifies, and seals')
  const map = calls.findIndex(c => c.label === 'onboarding:map-check')
  const plan = calls.findIndex(c => c.label === 'stage:law')
  assert.ok(map >= 0 && map < plan, 'the map check runs BEFORE the law card plans')
  const marker = calls.find(c => c.label === 'onboarding:brownfield-check')
  assert.ok(marker.prompt.includes('test -e .kiln/brownfield'), 'the marker is read as a closed fact (test -e), never parsed')
  const mapCheck = calls.find(c => c.label === 'onboarding:map-check')
  assert.ok(mapCheck.prompt.includes('test -s .kiln/docs/codebase-map.md'), 'the map is required nonempty (test -s), content-blind')
})

test('runtime (Wave 3, brownfield): a present marker with a missing/empty codebase-map halts — reused transport-failure, never a blind plan', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar', reversibility: 'reversible' },
    'onboarding:brownfield-check': { exit: 0 }, // brownfield
    'onboarding:map-check': { exit: 1 },         // but the map is missing or empty
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'a brownfield run with no map holds')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'the law stage never plans over an unmapped codebase')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'never reaches ratify')
  const doc = lastStateDoc(calls)
  assert.ok(doc.includes('Rerun onboarding'), 'next_action names a rerun of onboarding')
  assert.ok(!doc.includes('stage=build'), 'never advances to build')
})

test('runtime (Wave 3, greenfield): no marker means no map is required — the map check never runs, the LAW plans', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar', reversibility: 'reversible' },
    'onboarding:brownfield-check': { exit: 1 }, // no marker — a greenfield run
    'width:read': { exit: 0, width: 'floor' }, // W5-S2: the input gate passes, then the floor width keeps the single act
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a greenfield run plans without a codebase map')
  assert.ok(!calls.some(c => c.label === 'onboarding:map-check'), 'the map check never runs when no marker is present — short-circuit, no map required')
})

test('runtime (Wave 3): the LAW input gate is law-only — validate and report never read the onboarding inputs', async () => {
  const run = (s) => runKernel({ stage: s, projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    ['stage:' + s]: { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'working' },
    'law:stage-end': GREEN,
    'report:check': { exit: 0 },
    'state:write': GREEN,
  })
  for (const s of ['validate', 'report']) {
    const { calls } = await run(s)
    assert.ok(!calls.some(c => c.label === 'onboarding:brief-check'), s + ' never runs the brief check')
    assert.ok(!calls.some(c => c.label === 'onboarding:posture'), s + ' never reads posture')
    assert.ok(!calls.some(c => c.label === 'onboarding:brownfield-check'), s + ' never runs the brownfield check')
  }
})

test('tiers (Wave 3): validateTiers enforces the HIGH-effort floor — a sub-HIGH role fails, the all-HIGH config passes', () => {
  assert.equal(validateTiers(cfg()), true, 'the sealed all-HIGH config passes (haiku-migration raised to high)')
  for (const role of ['haiku-migration', 'kernel-leg', 'driver']) {
    for (const sub of ['low', 'medium']) {
      const c = cfg(); c.roles[role].effort = sub
      assert.equal(validateTiers(c), false, role + ' at ' + sub + ' fails the HIGH floor closed — no effort-down route')
    }
  }
  const x = cfg(); x.roles['driver'].effort = 'xhigh'
  assert.equal(validateTiers(x), true, 'xhigh is on the floor — permitted')
  assert.ok(Object.values(cfg().roles).every(r => r.effort === 'high' || r.effort === 'xhigh'),
    'the shipped tier data is now all HIGH/XHIGH')
  // The floor binds route targets too, not just the manual TIER_ROLES list: an
  // ADDITIONAL claude role at a sub-HIGH tier, reached through a surface route, is
  // the same effort-down bypass and must fail closed (else routeBuilder emits a
  // sub-HIGH leg). This role is absent from TIER_ROLES, so only the route check catches it.
  const rt = cfg()
  rt.roles['sub-high-route'] = { family: 'claude', alias: 'sonnet', effort: 'medium' }
  rt.surface_routing.ui = 'sub-high-route'
  assert.equal(validateTiers(rt), false, 'a surface route targeting a sub-HIGH extra role fails the floor — no effort-down route past the manual role list')
  assert.deepEqual(routeBuilder(cfg(), 'ui'), { effort: 'high', model: 'opus' }, 'the sealed ui route stays on the HIGH floor')
})

// ── W7-S2: the seam gate — the milestone audit seated in the build loop ──────
const AUDIT = '.kiln/audit-review.json'
const auditFinding = (id) => ({ id, criterion: 'C-1', location: 'src/app.mjs:12', failure_mode: 'broken', evidence: 'secret-audit-prose', minimal_fix: 'mend it' })
const auditVerdict = (verdict, findings = [], blockers = []) => ({ review_id: 'aud-1', law_hash: 'a'.repeat(64), findings, blockers, verdict })
const readAudit = (v) => ({ exit: 0, ids: [JSON.stringify(v)] })
const auditSlice = () => ({ facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' })
// The open-seam happy path: unlogged seam, green receipt, an accepting auditor,
// and the trusted promotion leg.
const AUDIT_OK = {
  'audit:check': { exit: 1 },
  'law:pre-audit': GREEN,
  'audit:review': { exit: 0 },
  'audit:read': readAudit(auditVerdict('accept')),
  'audit:append': { exit: 0 },
}

test('runtime (W7-S2): the seam gate fires at the mid-plan label change and the final slice — each seam audits once through closed argv and promotes through append-audit', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core', 'obj|s2|ui|core', 'obj|s3|ui|polish'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 1 },
    'slice:s1': auditSlice(), 'slice:s2': auditSlice(), 'slice:s3': auditSlice(),
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    ...AUDIT_OK,
  })
  assert.equal(ret.status, 'ok')
  const audits = calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 2, 'exactly two seams audit — the label change after s2 and the final s3; s1 never audits')
  assert.ok(audits[0].prompt.includes('kiln-review audit . .kiln s2 gpt-5.6-sol high ' + AUDIT),
    'closed argv only — repo `.`, the cwd-relative kiln dir, the seam slice id, the reviewer-gate model and effort, the artifact path')
  assert.ok(audits[1].prompt.includes('kiln-review audit . .kiln s3 gpt-5.6-sol high ' + AUDIT), 'the final slice is always a seam — the implicit whole-build milestone')
  assert.ok(calls.findIndex(c => c.label === 'audit:review') > calls.findIndex(c => c.label === 'seal:append'), 'the audit fires only after the seam slice sealed')
  const appends = calls.filter(c => c.label === 'audit:append')
  assert.equal(appends.length, 2, 'each accepted seam promotes exactly once')
  assert.ok(appends[0].prompt.includes('append-audit .kiln s2'), 'promotion rides the trusted CLI verb, never a bare append')
  assert.ok(appends[1].prompt.includes('append-audit .kiln s3'))
})

test('runtime (W7-S2): an unlabeled plan pays exactly ONE final audit — the implicit whole-build seam at the last slice', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 1 },
    'slice:s1': auditSlice(), 'slice:s2': auditSlice(),
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    ...AUDIT_OK,
  })
  assert.equal(ret.status, 'ok')
  const audits = calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 1, 'one whole-build audit — never zero, never per-slice')
  assert.ok(audits[0].prompt.includes('kiln-review audit . .kiln s2 '), 'the final slice is the seam slice')
})

test('runtime (W7-S2): a logged seam skips before any receipt; a sealed-but-unaudited seam re-fires on the all-sealed resume with the receipt refreshed first', async () => {
  // Logged: the audits.log grep answers 0 — no receipt, no audit, no append.
  const logged = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 1 },
    'slice:s1': auditSlice(),
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    'audit:check': { exit: 0 },
  })
  assert.equal(logged.ret.status, 'ok')
  const check = logged.calls.find(c => c.label === 'audit:check')
  assert.ok(check && check.prompt.includes('grep -q "^s1 " .kiln/audits.log'), 'the grep-skip anchors the seam slice id over audits.log, mirroring the seal-skip')
  assert.ok(!logged.calls.some(c => c.label === 'law:pre-audit' || c.label === 'audit:review'), 'a logged seam neither refreshes the receipt nor audits again')
  // Resume: every slice already sealed, the final seam unaudited — the audit fires on the skip path.
  const resumed = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core', 'obj|s2|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    ...AUDIT_OK,
  })
  assert.equal(resumed.ret.status, 'ok')
  assert.equal(resumed.calls.filter(c => c.label && c.label.startsWith('slice:')).length, 0, 'no slice work re-runs on the all-sealed resume')
  assert.equal(resumed.calls.filter(c => c.label === 'audit:review').length, 1, 'the unaudited seam re-fires on the seal-skip path')
  const receiptAt = resumed.calls.findIndex(c => c.label === 'law:pre-audit')
  const auditAt = resumed.calls.findIndex(c => c.label === 'audit:review')
  assert.ok(receiptAt >= 0 && receiptAt < auditAt, 'the LAW check receipt refreshes on the skip path BEFORE the audit')
  assert.ok(resumed.calls[receiptAt].prompt.includes('check-receipt.txt'), 'the refresh is the receipt-writing check run, verbatim evidence for the auditor')
  assert.ok(resumed.calls.some(c => c.label === 'audit:append'), 'the accepted resume audit still promotes')
})

test('runtime (W7-S2): a red receipt at the seam takes the law-red door — no audit over a red law', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 1 },
    'slice:s1': auditSlice(),
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    'audit:check': { exit: 1 },
    'law:pre-audit': { exit: 1, ids: [] },
  })
  assert.equal(ret.status, 'law-red')
  assert.ok(!calls.some(c => c.label === 'audit:review'), 'no audit runs over a red law')
  assert.ok(!calls.some(c => c.label === 'audit:append'), 'nothing promotes')
  assert.ok(lastStateDoc(calls).includes('the LAW is red at the milestone audit of slice s1'), 'the static law-red next_action names the seam slice')
})

test('runtime (W7-S2): the audit adapter maps the closed exits — 20 transport-failure, 21 the degraded hard-stop, 127 gate-unreachable; none repair, none promote', async () => {
  const base = (exit) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 1 },
    'slice:s1': auditSlice(),
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    'audit:check': { exit: 1 },
    'law:pre-audit': GREEN,
    'audit:review': { exit },
    'degraded:mark': { exit: 0 },
  })
  const transport = await runKernel({ stage: 'build', projectDir: '/p' }, base(20))
  assert.equal(transport.ret.status, 'transport-failure')
  const degraded = await runKernel({ stage: 'build', projectDir: '/p' }, base(21))
  assert.equal(degraded.ret.status, 'degraded')
  assert.ok(degraded.calls.some(c => c.label === 'degraded:mark'), 'the degraded stop marks for acknowledgment as the slice gates do')
  assert.ok(lastStateDoc(degraded.calls).includes('Restore codex, then relaunch stage build: the milestone audit of slice s1'), 'the static degraded next_action names only the seam slice')
  const unreachable = await runKernel({ stage: 'build', projectDir: '/p' }, base(127))
  assert.equal(unreachable.ret.status, 'gate-unreachable')
  for (const r of [transport, degraded, unreachable]) {
    assert.ok(!r.calls.some(c => c.label === 'audit:repair'), 'no repair edge is spent on a non-verdict class')
    assert.ok(!r.calls.some(c => c.label === 'audit:append'), 'no promotion without an accept')
  }
})

test('runtime (W7-S2): changes_required and blocked both drive the Claude repair + audit-recheck cycle — 11 lands on the reject class and recovers within the cap', async () => {
  for (const [wireExit, verdict] of [
    [10, auditVerdict('changes_required', [auditFinding('F1')])],
    [11, auditVerdict('blocked', [auditFinding('F1')], ['F1'])],
  ]) {
    const reads = [readAudit(verdict), readAudit(auditVerdict('accept'))]
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: 2 },
      'seal:check': { exit: 1 },
      'slice:s1': auditSlice(),
      'law:pre-seal': GREEN,
      'law:stage-end': GREEN,
      'degraded:check': { exit: 1 },
      'gate:review': { exit: 0 },
      'seal:append': { exit: 0 },
      'state:write': GREEN,
      'audit:check': { exit: 1 },
      'law:pre-audit': GREEN,
      'law:pre-audit-recheck': GREEN,
      'audit:review': { exit: wireExit },
      'audit:recheck': { exit: 0 },
      'audit:read': () => reads.shift(),
      'audit:findings': { exit: 0, ids: ['F1'] },
      'audit:repair': OK_ACK,
      'delta:check': { exit: 0 },
      'audit:append': { exit: 0 },
    })
    assert.equal(ret.status, 'ok', 'exit ' + wireExit + ': the seam recovers and the run advances')
    assert.equal(calls.filter(c => c.label === 'audit:repair').length, 1, 'exit ' + wireExit + ': exactly one repair edge spent')
    const recheck = calls.find(c => c.label === 'audit:recheck')
    assert.ok(recheck.prompt.includes('kiln-review audit-recheck . .kiln s1 gpt-5.6-sol high ' + AUDIT + ' .kiln/repair-delta.md ' + AUDIT),
      'exit ' + wireExit + ': the recheck hands the published prior verdict as its pre-recheck snapshot plus the repair-delta path')
    const receiptAt = calls.findIndex(c => c.label === 'law:pre-audit-recheck')
    const recheckAt = calls.findIndex(c => c.label === 'audit:recheck')
    assert.ok(receiptAt >= 0 && receiptAt < recheckAt, 'exit ' + wireExit + ': the recheck judges a fresh receipt')
    assert.equal(calls.filter(c => c.label === 'audit:append').length, 1, 'exit ' + wireExit + ': promotion only after the accepted recheck')
    const repair = calls.find(c => c.label === 'audit:repair')
    assert.ok(repair.prompt.includes(AUDIT) && repair.prompt.includes('.kiln/LAW.md') && repair.prompt.includes('.kiln/repair-delta.md'),
      'exit ' + wireExit + ': the STATIC repair prompt carries only closed-safe paths — the leg reads the audit JSON and LAW.md itself')
    assert.ok(!repair.prompt.includes('secret-audit-prose') && !repair.prompt.includes('F1'), 'exit ' + wireExit + ': no finding content rides the prompt')
    assert.equal(repair.opts.model, 'opus', 'exit ' + wireExit + ': the repair leg is the opposite-family Claude builder-ui seat')
  }
})

test('runtime (W7-S2): the audit cycle holds at the existing edges — cap exhaustion and a non-shrinking recheck both land the blocked shape with content-blind STATE', async () => {
  const build = (recoveryCap, cohorts, reads) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: recoveryCap },
    'seal:check': { exit: 1 },
    'slice:s1': auditSlice(),
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    'audit:check': { exit: 1 },
    'law:pre-audit': GREEN,
    'law:pre-audit-recheck': GREEN,
    'audit:review': { exit: 10 },
    'audit:recheck': { exit: 10 },
    'audit:read': () => reads.shift(),
    'audit:findings': () => ({ exit: 0, ids: cohorts.shift() }),
    'audit:repair': OK_ACK,
    'delta:check': { exit: 0 },
  })
  // cap 1: the recheck strictly shrinks {F1,F2} to {F1} but the edge budget is spent — held at the cap.
  const capReads = [
    readAudit(auditVerdict('changes_required', [auditFinding('F1'), auditFinding('F2')])),
    readAudit(auditVerdict('changes_required', [auditFinding('F1')])),
  ]
  const exhausted = await runKernel({ stage: 'build', projectDir: '/p' }, build(1, [['F1', 'F2'], ['F1'], ['F1']], capReads))
  assert.equal(exhausted.ret.status, 'blocked', 'cap exhaustion is the operator-ruling hold')
  assert.equal(exhausted.ret.pointers.passes, 1)
  assert.deepEqual(exhausted.ret.pointers.finding_ids, ['F1'], 'the blocked shape carries the closed finding ids')
  assert.equal(exhausted.ret.pointers.gate, AUDIT, 'the blocked shape points at the audit artifact')
  // no-strict-progress under cap 2: the recheck clears nothing — held after one spent edge.
  const stallReads = [
    readAudit(auditVerdict('changes_required', [auditFinding('F1')])),
    readAudit(auditVerdict('changes_required', [auditFinding('F1')])),
  ]
  const stalled = await runKernel({ stage: 'build', projectDir: '/p' }, build(2, [['F1'], ['F1'], ['F1']], stallReads))
  assert.equal(stalled.ret.status, 'blocked', 'equality clears nothing — held well under the cap')
  assert.equal(stalled.ret.pointers.passes, 1)
  for (const r of [exhausted, stalled]) {
    assert.ok(!r.calls.some(c => c.label === 'audit:append'), 'a held seam never promotes')
    const doc = lastStateDoc(r.calls)
    assert.ok(doc.includes('Operator ruling: the milestone audit held for slice s1 after 1 repair passes — the verdict is at ' + AUDIT),
      'the static next_action interpolates only the seam slice, the pass count, and the audit path')
    assert.ok(!doc.includes('secret-audit-prose') && !doc.includes('C-1'), 'no verdict prose enters STATE — heredoc-safe closed facts only')
  }
})

test('runtime (W7-S2): the kernel branches on its OWN derivation — a wire verdict the closed arrays do not support, or an invalid artifact, is the transport-class hold', async () => {
  for (const [name, wireExit, read] of [
    ['a recompute mismatch (wire accept over nonempty findings)', 0, readAudit(auditVerdict('accept', [auditFinding('F1')]))],
    ['an invalid artifact (blockers behind no findings)', 11, readAudit(auditVerdict('blocked', [], ['ghost']))],
    // W7S2-03: JSON `null` parses clean — the adapter must stay total, never throw.
    ['a null artifact (valid JSON, not an object)', 0, readAudit(null)],
    // W7S2-04: derived accept agrees with exit 0, but the published verdict STRING
    // disagrees — the string is the third party to the agreement, not a bystander.
    ['a wire-string disagreement (a blocked string over empty arrays at exit 0)', 0, readAudit(auditVerdict('blocked'))],
  ]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: 2 },
      'seal:check': { exit: 1 },
      'slice:s1': auditSlice(),
      'law:pre-seal': GREEN,
      'degraded:check': { exit: 1 },
      'gate:review': { exit: 0 },
      'seal:append': { exit: 0 },
      'state:write': GREEN,
      'audit:check': { exit: 1 },
      'law:pre-audit': GREEN,
      'audit:review': { exit: wireExit },
      'audit:read': read,
    })
    assert.equal(ret.status, 'transport-failure', name + ' holds transport-class — the invalid-artifact wire law')
    assert.ok(!calls.some(c => c.label === 'audit:append'), name + ': never promotes')
    assert.ok(!calls.some(c => c.label === 'audit:repair'), name + ': never spends a repair edge on a fiction')
  }
})

test('runtime (W7-S2): the audits.log membership check is EXACT — a dotted seam id escapes its dots, and a missing log reads as proven absence, never grep\'s 2', async () => {
  // W7S2-01: SLICE_ID admits dots; against `axb accept` a raw BRE `^a.b ` anchor
  // exits 0 and falsely suppresses the legal seam a.b. The kernel escapes each dot.
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|a.b|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 1 },
    'slice:a.b': auditSlice(),
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    ...AUDIT_OK,
  })
  assert.equal(ret.status, 'ok')
  const check = calls.find(c => c.label === 'audit:check')
  assert.ok(check.prompt.includes('grep -q "^a\\.b " .kiln/audits.log'), 'each dot in the seam id is BRE-escaped — an exact first-field anchor')
  // The EXACT issued command against a real filesystem: the collision line reads
  // as absence, the genuine line as logged, the missing log as normalized absence.
  const cmd = check.prompt.split('\n').pop()
  const dir = mkdtempSync(join(tmpdir(), 'kiln-audit-exact-'))
  mkdirSync(join(dir, '.kiln'))
  assert.equal(spawnSync('sh', ['-c', cmd], { cwd: dir }).status, 1, 'a missing audits.log normalizes to proven absence (1) — never grep exit 2')
  writeFileSync(join(dir, '.kiln', 'audits.log'), 'axb accept\n')
  assert.equal(spawnSync('sh', ['-c', cmd], { cwd: dir }).status, 1, 'the logged axb collision line reads as ABSENCE — the legal seam a.b still audits')
  writeFileSync(join(dir, '.kiln', 'audits.log'), 'a.b accept\n')
  assert.equal(spawnSync('sh', ['-c', cmd], { cwd: dir }).status, 0, 'the genuinely logged a.b reads as LOGGED')
})

test('runtime (W7-S2): an untrusted audits.log answer holds transport-class — an unreadable log (2) and a hands transport failure (20) never read as absence', async () => {
  // W7S2-02: only a PROVEN absence (exit 1) may re-audit — an unread log could
  // hide an already-logged seam, and a re-audit would re-append it.
  for (const exit of [2, 20]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: 2 },
      'seal:check': { exit: 1 },
      'slice:s1': auditSlice(),
      'law:pre-seal': GREEN,
      'degraded:check': { exit: 1 },
      'gate:review': { exit: 0 },
      'seal:append': { exit: 0 },
      'state:write': GREEN,
      'audit:check': { exit },
    })
    assert.equal(ret.status, 'transport-failure', 'exit ' + exit + ': an untrusted membership answer is a hold, never absence')
    assert.ok(!calls.some(c => c.label === 'law:pre-audit' || c.label === 'audit:review'), 'exit ' + exit + ': no audit over an unread log')
    assert.ok(!calls.some(c => c.label === 'audit:append'), 'exit ' + exit + ': nothing re-appends')
    assert.ok(lastStateDoc(calls).includes('the audits.log membership check for slice s1 did not answer'), 'exit ' + exit + ': the static next_action names the failed check')
  }
})

test('runtime (W7-S2): the audit repair edge confirms its delta — an {ok:true} ACK without a nonempty repair-delta.md is repair-failed, never a recheck over nothing', async () => {
  // W7S2-05: the reviewLoop contract demands repair result AND delta confirmation,
  // the same `test -s` the slice-gate repair edge performs.
  const reads = [readAudit(auditVerdict('changes_required', [auditFinding('F1')]))]
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:check': { exit: 1 },
    'slice:s1': auditSlice(),
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    'audit:check': { exit: 1 },
    'law:pre-audit': GREEN,
    'audit:review': { exit: 10 },
    'audit:read': () => reads.shift(),
    'audit:findings': { exit: 0, ids: ['F1'] },
    'audit:repair': OK_ACK,
    'delta:check': { exit: 1 },
  })
  assert.equal(ret.status, 'repair-failed', 'an unconfirmed repair is repair-failed — not the transport class an empty delta would draw at the recheck')
  const dc = calls.find(c => c.label === 'delta:check')
  assert.ok(dc && dc.prompt.includes('test -s .kiln/repair-delta.md'), 'the same test -s confirmation the slice-gate repair edge performs')
  assert.ok(!calls.some(c => c.label === 'audit:recheck'), 'no recheck judges an unconfirmed repair')
  assert.ok(!calls.some(c => c.label === 'audit:append'), 'nothing promotes')
  assert.ok(lastStateDoc(calls).includes('the milestone audit repair pass did not land for slice s1'), 'the static repair-failed next_action names the seam slice')
})

// ── W7-S3: dogfood — the wave proven whole, the audit fact on real disk ──────
// Cross-gate integration: full build-branch scenarios on the mocked runtime with
// the audits.log legs executing for REAL. The launch names the actual repo
// plugin root, and the audit:check / audit:append handlers run their exact
// issued commands — the trusted append-audit CLI verb included — inside a real
// temp project dir. The audits.log each run leaves behind is asserted
// byte-exact: the durable fact the wave ships, produced only by the machinery
// that ships it, with every other leg scripted as the scenarios above script it.
const REAL_PLUGIN = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const runReal = (prompt, dir) => ({ exit: spawnSync('sh', ['-c', prompt.split('\n').pop()], { cwd: dir }).status })
const realAuditDisk = (dir) => ({
  'audit:check': (p) => runReal(p, dir),
  'audit:append': (p) => runReal(p, dir),
})
const auditsLog = (dir) => existsSync(join(dir, '.kiln/audits.log')) ? readFileSync(join(dir, '.kiln/audits.log'), 'utf8') : ''
const mkProject = () => { const dir = mkdtempSync(join(tmpdir(), 'kiln-dogfood-')); mkdirSync(join(dir, '.kiln')); return dir }
// The all-passing build scaffold every dogfood scenario starts from; scenarios
// override the legs their subject exercises.
const dogfoodBase = (dir) => ({
  ...VOICE,
  'law:preflight': GREEN,
  'ladder:fetch': LADDER,
  'cap:read': { exit: 0, recovery_cap: 2 },
  'seal:check': { exit: 1 },
  'law:pre-seal': GREEN,
  'law:stage-end': GREEN,
  'degraded:check': { exit: 1 },
  'gate:review': { exit: 0 },
  'seal:append': { exit: 0 },
  'state:write': GREEN,
  'law:pre-audit': GREEN,
  ...realAuditDisk(dir),
})

test('dogfood (W7-S3): a labeled two-milestone plan runs the whole build branch — per-slice gates pass, both seams audit in order, and the real audits.log carries exactly the two seam ids', async () => {
  const dir = mkProject()
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    // Spaced labels are legal — they live in slices.json and the prompt file,
    // never argv, never a log line.
    'slices:fetch': { exit: 0, ids: ['obj|c1|ui|core engine', 'obj|c2|ui|core engine', 'obj|p1|ui|polish pass', 'obj|p2|ui|polish pass'] },
    'slice:c1': auditSlice(), 'slice:c2': auditSlice(), 'slice:p1': auditSlice(), 'slice:p2': auditSlice(),
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(ret.status, 'ok', 'the labeled plan builds, gates, audits, and advances')
  assert.equal(calls.filter(c => c.label === 'gate:review').length, 4, 'every slice still takes its per-slice gate — the audit adds a seam gate, never replaces one')
  const audits = calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 2, 'exactly two seams audit — the label change after c2 and the final p2')
  assert.ok(audits[0].prompt.includes('kiln-review audit . .kiln c2 gpt-5.6-sol high ' + AUDIT), 'the first seam is c2, closed argv only')
  assert.ok(audits[1].prompt.includes('kiln-review audit . .kiln p2 gpt-5.6-sol high ' + AUDIT), 'the second seam is the final p2')
  for (const a of audits) {
    assert.ok(!a.prompt.includes('core engine') && !a.prompt.includes('polish pass'),
      'the spaced labels never ride the audit argv — the CLI derives the closing block from slices.json')
  }
  const c2seal = calls.findIndex(c => c.label === 'seal:append' && c.prompt.includes('append-seal .kiln c2'))
  assert.ok(c2seal >= 0 && c2seal < calls.indexOf(audits[0]), 'the mid-plan seam audits only after its slice sealed')
  assert.ok(calls.indexOf(audits[0]) < calls.findIndex(c => c.label === 'slice:p1'), 'the seam gate rules mid-loop — p1 builds only past the accepted c2 audit')
  assert.equal(auditsLog(dir), 'c2 accept\np2 accept\n',
    'the on-disk audits.log carries exactly the two seam slice ids, one line per seam, written only by append-audit')
  assert.ok(ret.beat.includes('Slice c2 sealed — dual') && ret.beat.includes('Slice p2 sealed — dual'), 'the seal beats speak for the seam slices')
  assert.ok(lastStateDoc(calls).includes('Relaunch the kernel workflow with stage=validate'), 'the stage returns ok and advances to validate')
})

test('dogfood (W7-S3): a changes_required audit drives repair → recheck-accept → append-audit → advance — cohort lineage, delta pointer, and receipt refresh in strict order', async () => {
  const dir = mkProject()
  const reads = [readAudit(auditVerdict('changes_required', [auditFinding('F1'), auditFinding('F2')])), readAudit(auditVerdict('accept'))]
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|m one'] },
    'slice:s1': auditSlice(),
    'law:pre-audit-recheck': GREEN,
    'audit:review': { exit: 10 },
    'audit:recheck': { exit: 0 },
    'audit:read': () => reads.shift(),
    'audit:findings': { exit: 0, ids: ['F1', 'F2'] },
    'audit:repair': OK_ACK,
    'delta:check': { exit: 0 },
  })
  assert.equal(ret.status, 'ok', 'the repaired seam advances')
  // The whole recovery cycle, strictly ordered on the wire.
  const at = (label) => calls.findIndex(c => c.label === label)
  const seq = ['law:pre-audit', 'audit:review', 'audit:findings', 'audit:repair', 'delta:check', 'law:pre-audit-recheck', 'audit:recheck', 'audit:append']
  for (let i = 1; i < seq.length; i++) {
    assert.ok(at(seq[i - 1]) >= 0 && at(seq[i - 1]) < at(seq[i]), seq[i - 1] + ' precedes ' + seq[i])
  }
  // Cohort lineage: the pinned prior is read from the published verdict, and the
  // recheck argv hands that same file as its pre-recheck snapshot plus the delta.
  assert.ok(calls[at('audit:findings')].prompt.includes(AUDIT), 'the cohort is read from the published audit verdict')
  assert.ok(calls[at('audit:recheck')].prompt.includes('kiln-review audit-recheck . .kiln s1 gpt-5.6-sol high ' + AUDIT + ' .kiln/repair-delta.md ' + AUDIT),
    'the recheck carries prior + delta + output — the lineage the CLI cohort rule enforces')
  assert.ok(calls[at('delta:check')].prompt.includes('test -s .kiln/repair-delta.md'), 'the delta pointer is confirmed on disk before any recheck')
  assert.ok(calls[at('law:pre-audit-recheck')].prompt.includes('check-receipt.txt'), 'the recheck judges a refreshed receipt')
  assert.equal(auditsLog(dir), 's1 accept\n', 'the recovered seam leaves its one-line outcome fact on disk')
})

test('dogfood (W7-S3): a blocked audit reopens through the repair cycle and recovers — and a cap-exhausted seam holds on the existing blocked shape with a static next_action', async () => {
  // Blocked is the reopen edge: referential blockers ride their findings, the
  // Claude leg repairs the owning slices, the recheck accepts.
  const recovered = mkProject()
  const reads = [readAudit(auditVerdict('blocked', [auditFinding('F1'), auditFinding('F2')], ['F1', 'F2'])), readAudit(auditVerdict('accept'))]
  const ok = await runKernel({ stage: 'build', projectDir: recovered, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(recovered),
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|m1'] },
    'slice:s1': auditSlice(),
    'law:pre-audit-recheck': GREEN,
    'audit:review': { exit: 11 },
    'audit:recheck': { exit: 0 },
    'audit:read': () => reads.shift(),
    'audit:findings': { exit: 0, ids: ['F1', 'F2'] },
    'audit:repair': OK_ACK,
    'delta:check': { exit: 0 },
  })
  assert.equal(ok.ret.status, 'ok', 'blockers reopen their owning slices and the repaired seam advances')
  assert.equal(ok.calls.filter(c => c.label === 'audit:repair').length, 1, 'one repair edge spent on the blocked verdict')
  assert.equal(auditsLog(recovered), 's1 accept\n', 'the recovered blocked seam still promotes exactly one line')
  // The cap-exhausted variant: cap 1, the recheck still blocked over a strictly
  // shrunk cohort — genuine progress, but the budget is spent, so the seam holds.
  const held = mkProject()
  const heldReads = [
    readAudit(auditVerdict('blocked', [auditFinding('F1'), auditFinding('F2')], ['F1', 'F2'])),
    readAudit(auditVerdict('blocked', [auditFinding('F1')], ['F1'])),
  ]
  const cohorts = [['F1', 'F2'], ['F1'], ['F1']]
  const blocked = await runKernel({ stage: 'build', projectDir: held, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(held),
    'cap:read': { exit: 0, recovery_cap: 1 },
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|m1'] },
    'slice:s1': auditSlice(),
    'law:pre-audit-recheck': GREEN,
    'audit:review': { exit: 11 },
    'audit:recheck': { exit: 11 },
    'audit:read': () => heldReads.shift(),
    'audit:findings': () => ({ exit: 0, ids: cohorts.shift() }),
    'audit:repair': OK_ACK,
    'delta:check': { exit: 0 },
  })
  assert.equal(blocked.ret.status, 'blocked', 'cap exhaustion is the existing operator-ruling hold')
  assert.equal(blocked.ret.pointers.passes, 1)
  assert.deepEqual(blocked.ret.pointers.finding_ids, ['F1'], 'the blocked shape carries the closed finding ids')
  assert.equal(blocked.ret.pointers.gate, AUDIT, 'the blocked shape points at the audit artifact')
  assert.ok(blocked.ret.beat.includes('The gate held after 1 repair passes. Findings F1 are on the table'), 'the sealed blocked beat speaks with the closed facts filled')
  assert.ok(lastStateDoc(blocked.calls).includes('Operator ruling: the milestone audit held for slice s1 after 1 repair passes — the verdict is at ' + AUDIT),
    'the static next_action interpolates only the seam id, the pass count, and the audit path')
  assert.equal(auditsLog(held), '', 'a held seam leaves NO on-disk audit fact — audits.log stays unwritten')
})

test('dogfood (W7-S3): a run interrupted between the seam seal and its audit resumes on the skip path — the receipt refreshes, the audit re-fires, and audits.log completes', async () => {
  const dir = mkProject()
  const plan = { exit: 0, ids: ['obj|s1|ui|alpha', 'obj|s2|ui|beta'] }
  // Run 1: s1 seals and audits clean; s2 seals, then its audit transport dies —
  // the interrupt lands exactly after the seal, before the audit fact.
  const first = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'slices:fetch': plan,
    'slice:s1': auditSlice(), 'slice:s2': auditSlice(),
    'audit:review': (p) => ({ exit: p.includes(' s1 ') ? 0 : 20 }),
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(first.ret.status, 'transport-failure', 'the dead audit transport holds the run honestly')
  const s2seal = first.calls.findIndex(c => c.label === 'seal:append' && c.prompt.includes('append-seal .kiln s2'))
  const s2audit = first.calls.findIndex(c => c.label === 'audit:review' && c.prompt.includes(' s2 '))
  assert.ok(s2seal >= 0 && s2seal < s2audit, 'the seam slice sealed BEFORE its audit was attempted — the re-fire window')
  assert.equal(auditsLog(dir), 's1 accept\n', 'only the accepted seam left its outcome fact — the interrupted one still owes its audit')
  // Run 2 (resume): every slice sealed; the REAL grep-skip consults the same
  // disk — s1 is logged and skips, s2 re-fires with the receipt refreshed first.
  const resumed = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'slices:fetch': plan,
    'seal:check': { exit: 0 },
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(resumed.ret.status, 'ok', 'the resume completes the wave')
  assert.equal(resumed.calls.filter(c => c.label && c.label.startsWith('slice:')).length, 0, 'no slice rebuilds on the resume')
  const audits = resumed.calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 1, 'only the owed seam re-audits — the logged one skips on the real grep')
  assert.ok(audits[0].prompt.includes(' s2 '), 'the re-fire targets the interrupted seam')
  const receiptAt = resumed.calls.findIndex(c => c.label === 'law:pre-audit')
  assert.ok(receiptAt >= 0 && receiptAt < resumed.calls.indexOf(audits[0]) && resumed.calls[receiptAt].prompt.includes('check-receipt.txt'),
    'the LAW receipt refreshes on the skip path before the re-fired audit')
  assert.equal(auditsLog(dir), 's1 accept\ns2 accept\n', 'audits.log completes — one outcome fact per seam, in seam order')
  assert.ok(lastStateDoc(resumed.calls).includes('Relaunch the kernel workflow with stage=validate'), 'the completed build advances to validate')
})

test('dogfood (W7-S3): non-contiguous repeated labels are legal — a|b|a raises three seams, and the two a-seams each audit their own closing block', async () => {
  const dir = mkProject()
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|a', 'obj|s2|ui|b', 'obj|s3|ui|a'] },
    'slice:s1': auditSlice(), 'slice:s2': auditSlice(), 'slice:s3': auditSlice(),
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(ret.status, 'ok')
  const audits = calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 3, 'every adjacency change is a seam — a|b, b|a, and the final')
  assert.ok(audits[0].prompt.includes('.kiln s1 '), 'the first a-block closes at s1 and audits itself')
  assert.ok(audits[1].prompt.includes('.kiln s2 '), 'the b block closes at s2')
  assert.ok(audits[2].prompt.includes('.kiln s3 '), 'the second a-block closes at s3 — its own audit, never merged with s1')
  assert.equal(auditsLog(dir), 's1 accept\ns2 accept\ns3 accept\n', 'both a-seams are logged, each under its own closing slice id')
})

test('dogfood (W7-S3): an unlabeled plan pays one final audit on disk — and an all-sealed resume missing that final audit fires it', async () => {
  const fresh = mkProject()
  const plan = { exit: 0, ids: ['obj|u1|ui', 'obj|u2|ui'] }
  const built = await runKernel({ stage: 'build', projectDir: fresh, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(fresh),
    'slices:fetch': plan,
    'slice:u1': auditSlice(), 'slice:u2': auditSlice(),
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(built.ret.status, 'ok')
  assert.equal(built.calls.filter(c => c.label === 'audit:review').length, 1, 'exactly one audit — the implicit whole-build seam')
  assert.equal(auditsLog(fresh), 'u2 accept\n', 'the single final-slice fact on disk')
  // The all-sealed resume with that final audit missing: every seal in place,
  // an empty audits.log — the final audit fires on the skip path and writes it.
  const resumeDir = mkProject()
  const resumed = await runKernel({ stage: 'build', projectDir: resumeDir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(resumeDir),
    'slices:fetch': plan,
    'seal:check': { exit: 0 },
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(resumed.ret.status, 'ok')
  const audits = resumed.calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 1, 'the missing final audit fires on the all-sealed resume')
  assert.ok(audits[0].prompt.includes(' u2 '), 'it targets the final slice')
  assert.equal(auditsLog(resumeDir), 'u2 accept\n', 'the resume leaves the same one-line fact')
})

test('dogfood (W7-S3): ratify, build, and audit gates coexist across one project run — the audit consumes the SAME one-read cap as the build gate, and the recovery machinery elsewhere is untouched', async () => {
  // One project, two sequential launches over the SAME directory — the law
  // stage seals it, then the build stage takes it: the relaunch handoff the
  // STATE next_action names. The law launch first: the unchanged ratify loop
  // rejects once, repairs, rechecks, and seals — recoveryDecision as W6 left it.
  const dir = mkProject()
  const ratifyExits = [10, 0]
  const law = await runKernel({ stage: 'law', projectDir: dir }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'width:read': { exit: 0, width: 'floor', recovery_cap: 1 },
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': () => ({ exit: ratifyExits.shift() }),
    'ratify:cohort': { exit: 0, ids: ['R1'] },
    'ratify:repair': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law, revised' },
    'law:milestone-projection': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(law.ret.status, 'ok', 'the ratify gate is unperturbed — reject, one repair, recheck, seal')
  assert.equal(law.calls.filter(c => c.label === 'ratify:repair').length, 1)
  assert.ok(law.ret.beat.includes('the law, revised'), 'the buffered repaired-candidate beat speaks only after ratify AND seal')
  assert.ok(lastStateDoc(law.calls).includes('Relaunch the kernel workflow with stage=build'),
    'the sealed law hands THIS project to the build launch that follows — the cross-stage transition')
  // The build launch over the same project: ONE dial read (cap 1) serves the
  // slice gate and the seam audit alike. The slice gate spends its one edge and
  // seals — untouched; the audit spends ITS one edge on genuine strict progress
  // and still holds at the same cap, proving both gates drink from the same reading.
  const auditReads = [
    readAudit(auditVerdict('changes_required', [auditFinding('F1'), auditFinding('F2')])),
    readAudit(auditVerdict('changes_required', [auditFinding('F1')])),
  ]
  const auditCohorts = [['F1', 'F2'], ['F1'], ['F1']]
  const run = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'cap:read': { exit: 0, recovery_cap: 1 },
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|m1'] },
    'slice:s1': auditSlice(),
    'gate:review': { exit: 10 },
    'law:pre-recheck': GREEN,
    'gate:recheck': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['G1', 'G2'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'mended' },
    'delta:check': { exit: 0 },
    'law:pre-audit-recheck': GREEN,
    'audit:review': { exit: 10 },
    'audit:recheck': { exit: 10 },
    'audit:read': () => auditReads.shift(),
    'audit:findings': () => ({ exit: 0, ids: auditCohorts.shift() }),
    'audit:repair': OK_ACK,
  })
  assert.equal(run.calls.filter(c => c.label === 'cap:read').length, 1, 'ONE dial read per build invocation — both gates consume it')
  assert.ok(!run.calls.some(c => c.label === 'width:read'), 'the build branch never takes a second dial read')
  // The slice gate, untouched W6 behavior: one repair edge under cap 1, then the seal.
  assert.equal(run.calls.filter(c => c.label === 'repair:s1').length, 1, 'the slice gate spent its one edge and recovered')
  const recheckAt = run.calls.findIndex(c => c.label === 'gate:recheck')
  const sealAt = run.calls.findIndex(c => c.label === 'seal:append')
  assert.ok(recheckAt >= 0 && recheckAt < sealAt, 'recheck-accept preceded the seal — the W6 cycle exactly')
  assert.ok(run.calls[sealAt].prompt.includes('append-seal .kiln s1'), 'the repaired slice sealed as ever')
  // The audit gate at the same cap: one repair edge, strict progress, held anyway.
  assert.equal(run.ret.status, 'blocked', 'the audit holds at the same cap value the slice gate ran under')
  assert.equal(run.ret.pointers.passes, 1, 'exactly the one edge the dial granted')
  assert.deepEqual(run.ret.pointers.finding_ids, ['F1'], 'held over genuine strict progress — the cap ruled, not the cohort')
  assert.equal(run.calls.filter(c => c.label === 'audit:repair').length, 1)
  assert.equal(auditsLog(dir), '', 'a held audit never reaches audits.log')
  assert.ok(lastStateDoc(run.calls).includes('Operator ruling: the milestone audit held for slice s1 after 1 repair passes — the verdict is at ' + AUDIT))
})
