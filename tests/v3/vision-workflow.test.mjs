// vision-workflow.test.mjs — P4 T2 acceptance: the vision-compile leg (BLUEPRINT §10 change 5).
// The GENERATED workflows/vision.js is driven with every agent MOCKED (the validate-workflow
// harness idiom). The contract under test: the MECHANICAL ledger-gate floor runs before any
// compiler spawn (an incomplete session can never compile); the compiler's typed-violation revise
// loop is bounded at ≤2 revisions; the run-ledger ordering is stage_started on every entry, then —
// ONLY on a validator-clean VISION — vision_compiled THEN stage_completed; exhausted revisions end
// vision_valid:false with the violations as the conductor's escalation payload and NEITHER seal
// event; the return threads visual_direction (the r1 F6 mechanical path).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKFLOW = fileURLToPath(new URL('../../plugins/kiln/workflows/vision.js', import.meta.url))
const AsyncFunction = (async () => {}).constructor
const wfBody = readFileSync(WORKFLOW, 'utf8').replace(/^export const meta\b/m, 'const meta')

async function runVision(args, respond) {
  const calls = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    calls.push({ label, prompt, schema: (opts && opts.schema) || null })
    return respond(label, prompt)
  }
  const stubs = {
    args, phase: () => {}, log: () => {}, agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async () => [], budget: undefined, workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, wfBody)
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, calls }
}

const baseArgs = { kilnDir: '/tmp/vis-x/.kiln', projectPath: '/tmp/vis-x', pluginRoot: '/plug' }
const labels = (calls) => calls.map((c) => c.label)
const ledgersOf = (calls, type) => calls.filter((c) => c.label === 'thoth:ledger' && c.prompt.includes(`"type":"${type}"`))

const gateClean = {
  reasoning: 'g', exit: 0, valid: true, violations: [], error: '',
  summary: JSON.stringify({ events: 20, ideas: 14, tier: 'standard', express: false }),
}
const validateClean = {
  reasoning: 'v', exit: 0, valid: true, violations: [], error: '',
  summary: JSON.stringify({ status: 'gated', tier: 'standard', visual_direction: true, counts: { frs: 2, scs: 2, stories: 1, assumptions: 1, open_questions: 1 }, unresolved: 0 }),
}
const validateBroken = {
  reasoning: 'v', exit: 1, valid: false, error: '',
  violations: [{ code: 'count_mismatch', path: 'frontmatter.counts.frs', message: 'counts.frs says 5 but the section carries 2 grammar line(s)' }],
  summary: JSON.stringify({ status: 'gated', tier: 'standard', visual_direction: true, counts: { frs: 2 }, unresolved: 0 }),
}
const compiledOk = { reasoning: 'c', written: true, counts: '{"frs":2}' }

const respond = (over = {}) => (label) => {
  if (label === 'thoth:ledger') return { ok: true }
  if (label === 'thoth:ledger-gate') return 'gate' in over ? over.gate : gateClean
  if (label === 'numerobis:compile') return 'compile' in over ? over.compile : compiledOk
  if (label.startsWith('numerobis:compile-revise')) return 'revise' in over ? over.revise : compiledOk
  if (label.startsWith('thoth:validate:r')) {
    const r = Number(label.slice('thoth:validate:r'.length))
    return typeof over.validate === 'function' ? over.validate(r) : ('validate' in over ? over.validate : validateClean)
  }
  if (label === 'thoth:verify') return 'verify' in over ? over.verify : { reasoning: 'ok', exists: true }
  return null
}

test('vision.js clean path: gate → ONE fresh compiler → validator clean → seal; vision_compiled THEN stage_completed; the return threads visual_direction', async () => {
  const { result, calls } = await runVision(baseArgs, respond())
  assert.equal(result.vision_valid, true)
  assert.equal(result.visual_direction, true, 'the conductor threads this into architecture args (r1 F6)')
  assert.equal(result.tier, 'standard')
  assert.equal(result.unresolved, 0)
  const l = labels(calls)
  assert.ok(l.indexOf('thoth:ledger-gate') < l.indexOf('numerobis:compile'), 'the mechanical floor precedes the compiler')
  assert.ok(l.indexOf('numerobis:compile') < l.indexOf('thoth:validate:r0'), 'the validator rules the compiled file')
  assert.ok(!l.some((x) => x.startsWith('numerobis:compile-revise')), 'no revision on a clean pass')
  // run-ledger ordering (r1 F5): stage_started first; vision_compiled then stage_completed last
  const started = ledgersOf(calls, 'stage_started')
  const sealed = ledgersOf(calls, 'vision_compiled')
  const completed = ledgersOf(calls, 'stage_completed')
  assert.equal(started.length, 1)
  assert.equal(sealed.length, 1)
  assert.equal(completed.length, 1)
  assert.ok(calls.indexOf(started[0]) < l.indexOf('thoth:ledger-gate'), 'stage_started precedes every other event this workflow appends')
  assert.ok(calls.indexOf(sealed[0]) < calls.indexOf(completed[0]), 'vision_compiled precedes stage_completed')
  assert.match(sealed[0].prompt, /"visual_direction":true/, 'the seal event carries the summary the ledger reconstructs from')
  assert.match(started[0].prompt, /"stage":"brainstorm"/)
  // the compiler brief is the traceability contract: ledger + template are the SOLE sources
  const brief = calls.find((c) => c.label === 'numerobis:compile').prompt
  assert.match(brief, /ONLY sources are the two/, 'fresh context, sole-source framing')
  assert.match(brief, /brainstorm-ledger\.jsonl/)
  assert.match(brief, /templates\/VISION\.md/)
  assert.doesNotMatch(brief, /conversation history|chat transcript/, 'no chat context reaches the compiler')
  // P4 T4 item 5 (T3 ruling 2): the Elicitation Log source is named concretely — the distinct
  // data.method fields across theme/decision/style_probe/clarify_pass events plus that trail.
  assert.match(brief, /DISTINCT data\.method fields across the theme\/decision\/style_probe\/clarify_pass events/, 'the compiler is told exactly where the Elicitation Log comes from')
})

test('vision.js ledger-gate refusal: an incomplete session NEVER spawns a compiler — the typed violations are the escalation payload', async () => {
  const refusing = {
    reasoning: 'g', exit: 1, valid: false, error: '',
    violations: [{ code: 'incomplete_session', path: 'ledger.session_complete', message: 'no session_complete event' }],
    summary: '',
  }
  const { result, calls } = await runVision(baseArgs, respond({ gate: refusing }))
  assert.equal(result.vision_valid, false)
  assert.match(result.reason, /incomplete_session/)
  assert.deepEqual(result.violations.map((v) => v.code), ['incomplete_session'])
  const l = labels(calls)
  assert.ok(!l.includes('numerobis:compile'), 'zero compiler spawns against an incomplete ledger')
  assert.equal(ledgersOf(calls, 'vision_compiled').length, 0)
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0)
  assert.equal(ledgersOf(calls, 'stage_started').length, 1, 'the entry bracket still fired — the leg WAS entered')
})

test('vision.js revise loop: violations on r0, clean on r1 — one revision, bounded; the revise brief carries the typed violations verbatim', async () => {
  const validate = (r) => (r === 0 ? validateBroken : validateClean)
  const { result, calls } = await runVision(baseArgs, respond({ validate }))
  assert.equal(result.vision_valid, true)
  const l = labels(calls)
  assert.ok(l.includes('numerobis:compile-revise:r1'))
  assert.ok(!l.includes('numerobis:compile-revise:r2'), 'one revision sufficed')
  assert.ok(l.indexOf('numerobis:compile-revise:r1') < l.indexOf('thoth:validate:r1'), 'the fix re-validates')
  const revise = calls.find((c) => c.label === 'numerobis:compile-revise:r1').prompt
  assert.match(revise, /\[count_mismatch\] frontmatter\.counts\.frs: counts\.frs says 5/, 'typed violation rides verbatim — code, path, message')
  assert.match(revise, /never bend the body to dodge a count/, 'the arithmetic is recomputed from the body, not gamed')
})

test('vision.js exhausted revisions: vision_valid:false with the violations named — NEITHER vision_compiled nor stage_completed', async () => {
  const { result, calls } = await runVision(baseArgs, respond({ validate: validateBroken }))
  assert.equal(result.vision_valid, false)
  assert.match(result.reason, /invalid after 3 passes/)
  assert.deepEqual(result.violations.map((v) => v.code), ['count_mismatch'])
  const l = labels(calls)
  assert.ok(l.includes('numerobis:compile-revise:r1') && l.includes('numerobis:compile-revise:r2'), 'two revisions in three passes — the bound')
  assert.ok(!l.includes('numerobis:compile-revise:r3'))
  assert.equal(ledgersOf(calls, 'vision_compiled').length, 0, 'no seal on exhaustion')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'the stage stays current — the truthful projection')
})

test('vision.js fails CLOSED: dead gate scribe, dead compiler, dead validate scribe, vanished artifact — every degraded leg blocks with a reason', async () => {
  const deadGate = await runVision(baseArgs, respond({ gate: null }))
  assert.equal(deadGate.result.vision_valid, false)
  assert.match(deadGate.result.reason, /gate scribe produced no report/)
  assert.ok(!labels(deadGate.calls).includes('numerobis:compile'))

  const deadCompiler = await runVision(baseArgs, respond({ compile: null }))
  assert.equal(deadCompiler.result.vision_valid, false)
  assert.match(deadCompiler.result.reason, /compiler produced no file/)

  const deadValidate = await runVision(baseArgs, respond({ validate: null }))
  assert.equal(deadValidate.result.vision_valid, false)
  assert.match(deadValidate.result.reason, /validate scribe produced no report/)

  // r1 HIGH: the OBJECT-SHAPED infra failure (the command died — nonzero exit, NO typed
  // violations, stderr in error) must fail closed immediately, never spawn a revision
  const infraDead = { reasoning: 'v', exit: 127, valid: false, violations: [], summary: '', error: 'bash: node: command not found' }
  const infra = await runVision(baseArgs, respond({ validate: infraDead }))
  assert.equal(infra.result.vision_valid, false)
  assert.match(infra.result.reason, /validate command failed — bash: node: command not found/)
  assert.ok(!labels(infra.calls).some((x) => x.startsWith('numerobis:compile-revise')), 'an infra failure is never a revise trigger — revising against no violations is wasted work')
  assert.equal(ledgersOf(infra.calls, 'stage_completed').length, 0)

  const vanished = await runVision(baseArgs, respond({ verify: { reasoning: 'r', exists: false } }))
  assert.equal(vanished.result.vision_valid, false)
  assert.match(vanished.result.reason, /missing on disk/)
  assert.equal(ledgersOf(vanished.calls, 'stage_completed').length, 0)
})

test('vision.js pluginRoot absent: fails CLOSED with a named reason — the gate CLI is load-bearing, never a gateless compile', async () => {
  const { result, calls } = await runVision({ ...baseArgs, pluginRoot: undefined }, respond())
  assert.equal(result.vision_valid, false)
  assert.match(result.reason, /pluginRoot absent/)
  const l = labels(calls)
  assert.ok(!l.includes('thoth:ledger-gate') && !l.includes('numerobis:compile'), 'nothing runs without the gate')
})

test('vision.js GATE_SCHEMA discipline: every evidence field REQUIRED — a schema-legal scribe cannot drop the violations the revise loop feeds on', async () => {
  const { calls } = await runVision(baseArgs, respond())
  const schema = calls.find((c) => c.label === 'thoth:ledger-gate').schema
  assert.deepEqual([...schema.required].sort(), ['error', 'exit', 'summary', 'valid', 'violations'])
  assert.deepEqual([...schema.properties.violations.items.required].sort(), ['code', 'message', 'path'])
  assert.equal(schema.additionalProperties, false)
})
