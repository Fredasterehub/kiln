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
import { createHash } from 'node:crypto'
import { sha256Hex, canonicalJson } from '../../plugins/kiln/src/council.mjs'

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
  if (label === 'aristotle:compile') return 'compile' in over ? over.compile : compiledOk
  if (label.startsWith('aristotle:compile-revise')) return 'revise' in over ? over.revise : compiledOk
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
  assert.ok(l.indexOf('thoth:ledger-gate') < l.indexOf('aristotle:compile'), 'the mechanical floor precedes the compiler')
  assert.ok(l.indexOf('aristotle:compile') < l.indexOf('thoth:validate:r0'), 'the validator rules the compiled file')
  assert.ok(!l.some((x) => x.startsWith('aristotle:compile-revise')), 'no revision on a clean pass')
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
  const brief = calls.find((c) => c.label === 'aristotle:compile').prompt
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
  assert.ok(!l.includes('aristotle:compile'), 'zero compiler spawns against an incomplete ledger')
  assert.equal(ledgersOf(calls, 'vision_compiled').length, 0)
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0)
  assert.equal(ledgersOf(calls, 'stage_started').length, 1, 'the entry bracket still fired — the leg WAS entered')
})

test('vision.js revise loop: violations on r0, clean on r1 — one revision, bounded; the revise brief carries the typed violations verbatim', async () => {
  const validate = (r) => (r === 0 ? validateBroken : validateClean)
  const { result, calls } = await runVision(baseArgs, respond({ validate }))
  assert.equal(result.vision_valid, true)
  const l = labels(calls)
  assert.ok(l.includes('aristotle:compile-revise:r1'))
  assert.ok(!l.includes('aristotle:compile-revise:r2'), 'one revision sufficed')
  assert.ok(l.indexOf('aristotle:compile-revise:r1') < l.indexOf('thoth:validate:r1'), 'the fix re-validates')
  const revise = calls.find((c) => c.label === 'aristotle:compile-revise:r1').prompt
  assert.match(revise, /\[count_mismatch\] frontmatter\.counts\.frs: counts\.frs says 5/, 'typed violation rides verbatim — code, path, message')
  assert.match(revise, /never bend the body to dodge a count/, 'the arithmetic is recomputed from the body, not gamed')
})

test('vision.js exhausted revisions: vision_valid:false with the violations named — NEITHER vision_compiled nor stage_completed', async () => {
  const { result, calls } = await runVision(baseArgs, respond({ validate: validateBroken }))
  assert.equal(result.vision_valid, false)
  assert.match(result.reason, /invalid after 3 passes/)
  assert.deepEqual(result.violations.map((v) => v.code), ['count_mismatch'])
  const l = labels(calls)
  assert.ok(l.includes('aristotle:compile-revise:r1') && l.includes('aristotle:compile-revise:r2'), 'two revisions in three passes — the bound')
  assert.ok(!l.includes('aristotle:compile-revise:r3'))
  assert.equal(ledgersOf(calls, 'vision_compiled').length, 0, 'no seal on exhaustion')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'the stage stays current — the truthful projection')
})

test('vision.js fails CLOSED: dead gate scribe, dead compiler, dead validate scribe, vanished artifact — every degraded leg blocks with a reason', async () => {
  const deadGate = await runVision(baseArgs, respond({ gate: null }))
  assert.equal(deadGate.result.vision_valid, false)
  assert.match(deadGate.result.reason, /gate scribe produced no report/)
  assert.ok(!labels(deadGate.calls).includes('aristotle:compile'))

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
  assert.ok(!labels(infra.calls).some((x) => x.startsWith('aristotle:compile-revise')), 'an infra failure is never a revise trigger — revising against no violations is wasted work')
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
  assert.ok(!l.includes('thoth:ledger-gate') && !l.includes('aristotle:compile'), 'nothing runs without the gate')
})

test('vision.js GATE_SCHEMA discipline: every evidence field REQUIRED — a schema-legal scribe cannot drop the violations the revise loop feeds on', async () => {
  const { calls } = await runVision(baseArgs, respond())
  const schema = calls.find((c) => c.label === 'thoth:ledger-gate').schema
  assert.deepEqual([...schema.required].sort(), ['error', 'exit', 'summary', 'valid', 'violations'])
  assert.deepEqual([...schema.properties.violations.items.required].sort(), ['code', 'message', 'path'])
  assert.equal(schema.additionalProperties, false)
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// ── B4-3 D4: vision at capability tier T4 — the fidelity pair between the mechanical checks and the
//    seal events. Dual-APPROVE ⇒ vision_compiled THEN stage_completed (order preserved) + certificate;
//    ANY other outcome ⇒ NEITHER seal event (the existing invalid-VISION escalation shape). Every Sol
//    leg rides a receipt-attested codex envelope + an invocation-exact ledger cross-check.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const CODEX_MODEL = 'gpt-5.6-sol'
const T4TOKEN = 'VIS-RUNTOKEN-xyz'
const t4args = (extra = {}) => ({ ...baseArgs, codexAvailable: true, capabilityTier: 'T4', runToken: T4TOKEN, ...extra })
const shaB = (buf) => createHash('sha256').update(buf).digest('hex')
const oshaOf = (p) => shaB(Buffer.from(JSON.stringify(p)))
const rshaOf = (r) => shaB(Buffer.from(JSON.stringify(r)))
const SESSION = '019f5a46-fc83-7181-8303-f516494485ac', INV = '3'.repeat(64), PSHA = '1'.repeat(64), XSHA = '5'.repeat(64)
const validReceipt = (payload, over = {}) => ({
  receipt_version: 1, parser_version: 'kiln-codex-receipt/1', transport: 'codex_exec', invocation_id: INV,
  prompt_sha256: PSHA, packet_sha256: XSHA, cli_version: '0.144.1', requested_model: CODEX_MODEL,
  reported_model: CODEX_MODEL, session_id: SESSION, exit_code: 0, tokens_used: 18747,
  output_sha256: oshaOf(payload), stderr_sha256: XSHA, ...over,
})
const solEnv = (payload, rOver) => ({ payload, codex_receipt: validReceipt(payload, rOver || {}), raw_artifact_refs: { stderr: 's', output: 'o' } })
const crossOk = (payload, keystone, phaseTag, over = {}) => ({
  output_sha256_disk: over.disk !== undefined ? over.disk : oshaOf(payload),
  output_canonical_sha256: over.canon !== undefined ? over.canon : sha256Hex(canonicalJson(payload)),
  ledger: {
    verified: over.verified === null ? null : { status: 'verified', invocation_id: INV, receipt_sha256: rshaOf(validReceipt(payload)), output_sha256: oshaOf(payload), session_id: SESSION, reported_model: CODEX_MODEL, tokens_used: 18747, exit_code: 0, receipt_verified: true, ...(over.verified || {}) },
    reservation: over.reservation === null ? null : { invocation_id: INV, keystone, phase: phaseTag, seat: 'sol', attempt: 1, run_token: T4TOKEN, prompt_sha256: PSHA, packet_sha256: XSHA, ...(over.reservation || {}) },
  },
})
const rat = (h, over = {}) => ({ reasoning: 'r', artifact_hash: h, verdict: 'APPROVE', divergence_selections: [], findings: [], changed_evidence: [], ...over })
const FID_FINDING = { finding_id: 'VF-1', claim: 'VISION.md invented a requirement absent from the ledger', required_change: 'drop the invented FR', evidence_refs: ['brainstorm-ledger.jsonl'], evidence_class: 'repo_state', executable_check: null }
const anchorFilesFromPrompt = (prompt) => { const m = prompt.match(/sha256sum ([^\n']+)/); const paths = m ? m[1].trim().split(/\s+/).filter(Boolean) : []; return paths.map((p) => ({ path: p, sha256: sha256Hex(p) })) }

// t4Respond layers the fidelity legs over the clean-compile respond().
function t4Respond(cfg = {}, over = {}) {
  const base = respond(over)
  let fidHash = null
  return (label, prompt) => {
    if (label === 'thoth:vision-anchor') return cfg.anchor !== undefined ? cfg.anchor : { reasoning: 'a', files: anchorFilesFromPrompt(prompt) }
    if (label === 'fable:vision-fidelity') { const m = prompt.match(/artifact_hash = "([0-9a-f]{64})"/); if (m) fidHash = m[1]; return cfg.fableFid ? cfg.fableFid(fidHash) : rat(fidHash) }
    if (label === 'sol:vision-fidelity') { const m = prompt.match(/"artifact_hash":"([0-9a-f]{64})"/); if (m) fidHash = m[1]; if (cfg.solFid === 'dead') return {}; return cfg.solFid ? solEnv(cfg.solFid(fidHash)) : solEnv(rat(fidHash)) }
    if (label === 'thoth:receipt-check:sol:vision-fidelity') return crossOk(cfg.solFid && cfg.solFid !== 'dead' ? cfg.solFid(fidHash) : rat(fidHash), 'vision_fidelity', 'VISION_RATIFY')
    return base(label, prompt)
  }
}

test('B4-3 D4 vision fidelity: at T4 a clean compile convenes the blind Fable/Sol fidelity pair; dual-APPROVE ⇒ vision_compiled THEN stage_completed + a b43-vision/1 certificate', async () => {
  const { result, calls } = await runVision(t4args(), t4Respond())
  assert.equal(result.vision_valid, true)
  assert.equal(calls.filter((c) => c.label === 'fable:vision-fidelity').length, 1)
  assert.equal(calls.filter((c) => c.label === 'sol:vision-fidelity').length, 1)
  assert.equal(calls.filter((c) => c.label === 'thoth:receipt-check:sol:vision-fidelity').length, 1)
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.seat, 'vision_fidelity', 'B43-2: the b42-mirrored per-seat summary rides the return (the boundary record for vision)')
  assert.equal(result.council.certificate.label, 'twin_ratified')
  assert.equal(result.council.certificate.signatures[0].renderer_version, 'b43-vision/1')
  const sealed = ledgersOf(calls, 'vision_compiled'), completed = ledgersOf(calls, 'stage_completed')
  assert.equal(sealed.length, 1); assert.equal(completed.length, 1)
  assert.ok(calls.indexOf(sealed[0]) < calls.indexOf(completed[0]), 'vision_compiled precedes stage_completed (order preserved)')
  const l = labels(calls)
  assert.ok(l.indexOf('thoth:validate:r0') < l.indexOf('fable:vision-fidelity'), 'the fidelity pair runs AFTER the mechanical validator')
  assert.ok(l.indexOf('fable:vision-fidelity') < calls.indexOf(sealed[0]), 'the fidelity pair runs BEFORE the seal events')
})

test('B4-3 D4 vision fidelity: a BLOCK ⇒ NEITHER seal event, vision_valid:false, honest BLOCKED terminal (required-mode uniformity)', async () => {
  const { result, calls } = await runVision(t4args(), t4Respond({ fableFid: (h) => ({ ...rat(h), verdict: 'BLOCK', findings: [FID_FINDING] }) }))
  assert.equal(result.vision_valid, false)
  assert.equal(result.council.terminal, 'BLOCKED')
  assert.match(result.reason, /vision fidelity council BLOCKED/)
  assert.equal(ledgersOf(calls, 'vision_compiled').length, 0, 'NEITHER seal event fires on a BLOCK')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0)
})

test('B4-3 D4 vision fidelity: a DEAD Sol seat (no receipt) ⇒ DEGRADED, NEITHER seal event (never a single-head ruling)', async () => {
  const { result, calls } = await runVision(t4args(), t4Respond({ solFid: 'dead' }))
  assert.equal(result.vision_valid, false)
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(ledgersOf(calls, 'vision_compiled').length, 0)
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0)
})

test('B4-3 D4 vision fidelity promised-but-tokenless: T4 + codex but NO runToken ⇒ DEGRADED, NO pair, NEITHER seal event (never a silent v3.0.1 compile)', async () => {
  const { result, calls } = await runVision({ ...baseArgs, codexAvailable: true, capabilityTier: 'T4' }, t4Respond())
  assert.equal(result.vision_valid, false)
  assert.equal(calls.filter((c) => c.label === 'fable:vision-fidelity').length, 0, 'no council convenes without a runToken')
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(ledgersOf(calls, 'vision_compiled').length, 0)
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0)
})

test('B4-3 D4 vision fidelity sub-T4 byte-preservation: at T3 (no council) a clean compile seals normally with NO fidelity pair and NO council field', async () => {
  const { result, calls } = await runVision({ ...baseArgs, codexAvailable: true, capabilityTier: 'T3' }, t4Respond())
  assert.equal(result.vision_valid, true)
  assert.equal(calls.filter((c) => c.label === 'fable:vision-fidelity').length, 0)
  assert.equal(result.council, undefined, 'sub-T4 adds no council field (byte-preserved)')
  assert.equal(ledgersOf(calls, 'vision_compiled').length, 1)
  assert.equal(ledgersOf(calls, 'stage_completed').length, 1)
})
