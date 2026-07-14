// gate.test.mjs — unit test for plugins/kiln/src/gate.mjs (WS-B1, Sol findings F1/F2). gateAgent is
// the single gate/judgment wrapper the bundler inlines into build/validate/report; this suite drives
// the MODULE directly. gate.mjs speaks through the ambient `agent()` / `log()` globals (it is inlined
// into workflows that already carry both), so each test installs globalThis.agent / globalThis.log
// mocks and imports the module FRESH (cache-busted query) before exercising it.
//
// Contract under test:
//   · a clean success records classification:null and actual_model == requested_model;
//   · the FOUR seat-death classes (structured_output_failure, null_result, timeout, refusal) — and a
//     bare null/undefined RETURN — all route through the twoHeads policy, never a silent success;
//   · class 'other' (an unrelated exception) RETHROWS, never swallowed;
//   · two_heads:required returns a fail-closed null WITHOUT re-dispatch;
//   · two_heads:best_effort re-dispatches once on the SAME model, then (only when the requested model
//     is 'fable') substitutes ONE dispatch on 'opus', recorded truthfully as actual_model:'opus';
//   · provenance's actual_model is ALWAYS the model that produced the returned result (null on a
//     fail-closed null);
//   · 'ultra' effort on a codex-transport seat throws at call time (never-ultra doctrine).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const GATE_URL = new URL('../../plugins/kiln/src/gate.mjs', import.meta.url).href
const BUILD_SRC = readFileSync(new URL('../../plugins/kiln/workflows-src/build.js', import.meta.url), 'utf8')
const VALIDATE_SRC = readFileSync(new URL('../../plugins/kiln/workflows-src/validate.js', import.meta.url), 'utf8')

let bust = 0
// install the ambient globals gate.mjs resolves at call time, then import a FRESH module instance.
async function loadGate(agentImpl) {
  globalThis.agent = agentImpl
  globalThis.log = () => {}
  return import(`${GATE_URL}?t=${bust++}`)
}

// an agent() mock driven by a queue of per-call behaviors: { return: value } | { throw: message }.
// Records every call's { prompt, opts } so the tests can assert the dispatch count and substituted model.
function queuedAgent(behaviors) {
  const calls = []
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts })
    const b = behaviors[calls.length - 1]
    if (!b) throw new Error(`queuedAgent: no behavior for call #${calls.length}`)
    if ('throw' in b) throw new Error(b.throw)
    return b.return
  }
  agent.calls = calls
  return agent
}

// The executed provenance tests below drive the REAL withDeadline + TRAVERSAL_TIMEOUT imported from
// src/gate.mjs (the very code the @gate marker inlines into validate) — no replica, no drift. gate.mjs is
// a normal ESM module (only the WORKFLOW output is un-importable), so loadGate returns withDeadline and the
// TRAVERSAL_TIMEOUT sentinel from the SAME fresh instance, keeping `t === TRAVERSAL_TIMEOUT` identity valid.
// Only the loop's append-only discipline (fresh per-pass sink, timeout/late/unsettled bookkeeping) is
// replicated inline here, matching validate.js's traversal loop and its verdict-close record.

test('gate: a clean success records classification:null and actual_model == requested_model', async () => {
  const agent = queuedAgent([{ return: { verdict: 'QA_PASS' } }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', { label: 'g', model: 'opus', provenance: prov })
  assert.deepEqual(r, { verdict: 'QA_PASS' })
  assert.equal(agent.calls.length, 1)
  assert.deepEqual(prov, { requested_model: 'opus', actual_model: 'opus', fallback_reason: null, classification: null })
})

test('gate: a null RETURN is a dead seat — best_effort re-dispatches once, then fails closed to null', async () => {
  const agent = queuedAgent([{ return: null }, { return: undefined }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', { label: 'g', model: 'sonnet', provenance: prov })
  assert.equal(r, null)
  assert.equal(agent.calls.length, 2, 'one same-model re-dispatch, then null — never returned as success')
  assert.deepEqual(prov, { requested_model: 'sonnet', actual_model: null, fallback_reason: 'redispatch_exhausted', classification: 'null_result' })
})

test('gate: a refusal error is a seat-death class — handled (re-dispatched), not thrown', async () => {
  const agent = queuedAgent([{ throw: 'the model refused to rule' }, { return: { verdict: 'QA_FAIL' } }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', { label: 'g', model: 'opus', provenance: prov })
  assert.deepEqual(r, { verdict: 'QA_FAIL' })
  assert.equal(agent.calls.length, 2)
  assert.deepEqual(prov, { requested_model: 'opus', actual_model: 'opus', fallback_reason: 'redispatch', classification: 'refusal' })
})

test('gate: a timeout error is a seat-death class — handled, degrades to null when the re-dispatch also times out', async () => {
  const agent = queuedAgent([{ throw: 'operation timed out after 90s' }, { throw: 'deadline exceeded' }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', { label: 'g', model: 'opus', provenance: prov })
  assert.equal(r, null)
  assert.equal(agent.calls.length, 2)
  assert.deepEqual(prov, { requested_model: 'opus', actual_model: null, fallback_reason: 'redispatch_exhausted', classification: 'timeout' })
})

test('gate: an unrelated (other) exception RETHROWS — never swallowed into a silent degradation', async () => {
  const agent = queuedAgent([{ throw: 'ENOENT: the disk is on fire' }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  await assert.rejects(() => gateAgent('p', { label: 'g', model: 'opus', provenance: prov }), /disk is on fire/)
  assert.equal(agent.calls.length, 1, 'an unrelated error is never re-dispatched')
  assert.deepEqual(prov, { requested_model: 'opus', actual_model: null, fallback_reason: 'rethrow', classification: 'other' })
})

test('gate: two_heads:required refuses substitution — one dispatch, fail-closed null, provenance records the class', async () => {
  const agent = queuedAgent([{ throw: 'StructuredOutput retry cap exceeded' }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', { label: 'g', model: 'fable', twoHeads: 'required', provenance: prov })
  assert.equal(r, null)
  assert.equal(agent.calls.length, 1, 'required NEVER re-dispatches')
  assert.deepEqual(prov, { requested_model: 'fable', actual_model: null, fallback_reason: 'required_no_substitution', classification: 'structured_output_failure' })
})

test('gate: best_effort fable — same-model retry then a fable→opus substitution, recorded truthfully', async () => {
  const agent = queuedAgent([
    { throw: 'StructuredOutput validation failed' }, // fable, first dispatch
    { throw: 'structured output retry cap' },         // fable, same-model re-dispatch
    { return: { verdict: 'QA_PASS' } },               // opus substitution succeeds
  ])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', { label: 'g', model: 'fable', provenance: prov })
  assert.deepEqual(r, { verdict: 'QA_PASS' })
  assert.equal(agent.calls.length, 3)
  assert.equal(agent.calls[0].opts.model, 'fable')
  assert.equal(agent.calls[1].opts.model, 'fable', 'the first retry is the SAME model (v3.0.1 semantics)')
  assert.equal(agent.calls[2].opts.model, 'opus', 'the substitution runs on opus, not fable')
  assert.deepEqual(prov, { requested_model: 'fable', actual_model: 'opus', fallback_reason: 'fable_substituted_opus', classification: 'structured_output_failure' })
})

test('gate: best_effort non-fable exhausts to null — no substitution when the requested model is not fable', async () => {
  const agent = queuedAgent([{ throw: 'StructuredOutput failed' }, { throw: 'StructuredOutput cap exceeded' }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', { label: 'g', model: 'opus', provenance: prov })
  assert.equal(r, null)
  assert.equal(agent.calls.length, 2, 'no opus substitution when the requested model is already opus')
  assert.deepEqual(prov, { requested_model: 'opus', actual_model: null, fallback_reason: 'redispatch_exhausted', classification: 'structured_output_failure' })
})

test('gate: ultra effort on a codex-transport seat throws at call time (never-ultra doctrine)', async () => {
  const agent = queuedAgent([{ return: { ok: true } }])
  const { gateAgent } = await loadGate(agent)
  await assert.rejects(() => gateAgent('p', { label: 'g', model: 'sonnet', effort: 'ultra', transport: 'codex' }), /never-ultra/)
  assert.equal(agent.calls.length, 0, 'the guard throws BEFORE any dispatch')
})

// ── Codex transport receipt provenance (sol-b34-design "Codex transport receipt"). A Sol council seat is
// a Sonnet wrapper over transport:'codex' whose wrapped agent() returns an ENVELOPE
// { payload, codex_receipt, raw_artifact_refs }; gateAgent STRUCTURALLY validates the relayed receipt
// (never hashes) and records the transport attestation. A missing/invalid/model-mismatched receipt is a
// DEAD Sol seat — required fails closed to null, best_effort retains the wrapper answer honestly. ────────
const PSHA = '1'.repeat(64), OSHA = '2'.repeat(64), HSHA = '3'.repeat(64), RSHA = '4'.repeat(64)
const SESSION = '019f5a46-fc83-7181-8303-f516494485ac'
const validReceipt = (over = {}) => ({
  receipt_version: 1, parser_version: 'kiln-codex-receipt/1', transport: 'codex_exec', invocation_id: HSHA,
  prompt_sha256: PSHA, packet_sha256: HSHA, cli_version: '0.144.1', requested_model: 'gpt-5.6-sol',
  reported_model: 'gpt-5.6-sol', session_id: SESSION, exit_code: 0, tokens_used: 18747, output_sha256: OSHA,
  stderr_sha256: HSHA, ...over,
})
const envelope = (receipt, over = {}) => ({ payload: { verdict: 'APPROVE' }, codex_receipt: receipt, raw_artifact_refs: { stderr: 's', output: 'o' }, ...over })
const solSeat = (extra = {}) => ({ label: 'sol', model: 'sonnet', transport: 'codex', transportModel: 'gpt-5.6-sol', receiptRequired: true, ...extra })

test('gate/codex: a clean verified receipt returns the payload and records the full transport attestation', async () => {
  const agent = queuedAgent([{ return: envelope(validReceipt(), { receipt_sha256: RSHA }) }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
  assert.deepEqual(r, { verdict: 'APPROVE' }, 'the call site keeps receiving the payload, not the envelope')
  assert.deepEqual(prov, {
    requested_model: 'sonnet', actual_model: 'sonnet', fallback_reason: null, classification: null,
    wrapper_model: 'sonnet', transport: 'codex', requested_transport_model: 'gpt-5.6-sol',
    actual_transport_model: 'gpt-5.6-sol', receipt_verified: true, receipt_hash: RSHA, session_id: SESSION,
    tokens_used: 18747, prompt_hash: PSHA, output_hash: OSHA,
  })
})

test('gate/codex: receipt_hash is null when the envelope does not relay the ledger receipt_sha256 (never computed here)', async () => {
  const agent = queuedAgent([{ return: envelope(validReceipt()) }]) // no receipt_sha256 relayed
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
  assert.deepEqual(r, { verdict: 'APPROVE' })
  assert.equal(prov.receipt_verified, true)
  assert.equal(prov.receipt_hash, null, 'gate.mjs never fabricates a receipt hash')
})

test('gate/codex: a wrong reported_model is invalid — required fails closed to null, wrapper answer never returned', async () => {
  const agent = queuedAgent([{ return: envelope(validReceipt({ reported_model: 'gpt-5.5' })) }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
  assert.equal(r, null, 'a required Sol seat with an invalid receipt returns null, NOT the Sonnet payload')
  assert.equal(prov.fallback_reason, 'transport_receipt_invalid')
  assert.equal(prov.receipt_verified, false)
  assert.equal(prov.actual_model, null)
  assert.equal(prov.actual_transport_model, null)
})

test('gate/codex: a fallback-model receipt cannot sign a pinned Sol seat (gpt-5.5 != gpt-5.6-sol)', async () => {
  const agent = queuedAgent([{ return: envelope(validReceipt({ requested_model: 'gpt-5.5', reported_model: 'gpt-5.5' })) }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
  assert.equal(r, null)
  assert.equal(prov.fallback_reason, 'transport_receipt_invalid')
})

test('gate/codex: a missing codex_receipt is transport_receipt_missing (required -> null)', async () => {
  const agent = queuedAgent([{ return: { payload: { verdict: 'APPROVE' }, raw_artifact_refs: {} } }]) // no codex_receipt key
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
  assert.equal(r, null)
  assert.equal(prov.fallback_reason, 'transport_receipt_missing')
  assert.equal(prov.receipt_verified, false)
})

test('gate/codex: a malformed receipt — a bad hash shape and a nonzero exit — is invalid', async () => {
  for (const bad of [{ prompt_sha256: 'not-a-sha' }, { exit_code: 1 }, { tokens_used: -5 }]) {
    const agent = queuedAgent([{ return: envelope(validReceipt(bad)) }])
    const { gateAgent } = await loadGate(agent)
    const prov = {}
    const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
    assert.equal(r, null, `receipt override ${JSON.stringify(bad)} must be invalid`)
    assert.equal(prov.fallback_reason, 'transport_receipt_invalid')
  }
})

test('gate/codex: best_effort retains the wrapper answer as HONEST Sonnet provenance (never second-family)', async () => {
  const agent = queuedAgent([{ return: envelope(validReceipt({ reported_model: 'gpt-5.5' })) }]) // invalid receipt
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', solSeat({ twoHeads: 'best_effort', provenance: prov }))
  assert.deepEqual(r, { verdict: 'APPROVE' }, 'best_effort MAY keep the wrapper answer')
  assert.equal(prov.actual_model, 'sonnet', 'recorded as the wrapper model, not Sol')
  assert.equal(prov.actual_transport_model, null)
  assert.equal(prov.receipt_verified, false, 'this answer can never claim second-family verification')
  assert.equal(prov.fallback_reason, 'transport_receipt_invalid')
})

test('gate/codex: receiptRequired without transport:codex throws at call time (a misconfigured seat is a bug)', async () => {
  const agent = queuedAgent([{ return: { verdict: 'APPROVE' } }])
  const { gateAgent } = await loadGate(agent)
  await assert.rejects(() => gateAgent('p', { label: 'g', model: 'sonnet', receiptRequired: true }), /receiptRequired demands transport/)
  assert.equal(agent.calls.length, 0, 'the guard throws BEFORE any dispatch')
})

test('gate/codex: a NON-codex leg keeps the exact v3.0.1 provenance shape — no transport-attestation fields leak', async () => {
  const agent = queuedAgent([{ return: { verdict: 'QA_PASS' } }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  await gateAgent('p', { label: 'g', model: 'opus', provenance: prov })
  assert.deepEqual(Object.keys(prov).sort(), ['actual_model', 'classification', 'fallback_reason', 'requested_model'])
  for (const k of ['wrapper_model', 'transport', 'receipt_verified', 'actual_transport_model']) assert.equal(k in prov, false, `${k} must be absent on a non-codex leg`)
})

test('gate/codex: a drifting receipt_version / parser_version / transport / session_id / cli_version is rejected (pinned like the sealed script)', async () => {
  for (const bad of [{ receipt_version: 2 }, { receipt_version: 1.5 }, { parser_version: 'attacker/999' }, { transport: 'not_codex' }, { cli_version: 'garbage' }, { session_id: 'x' }]) {
    const agent = queuedAgent([{ return: envelope(validReceipt(bad)) }])
    const { gateAgent } = await loadGate(agent)
    const prov = {}
    const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
    assert.equal(r, null, `receipt drift ${JSON.stringify(bad)} must NOT verify`)
    assert.equal(prov.receipt_verified, false)
    assert.equal(prov.fallback_reason, 'transport_receipt_invalid')
  }
})

test('gate/codex: cli_version is pinned to the EXACT trusted release — a well-formed-but-wrong semver is rejected', async () => {
  for (const cli of ['9.9.9', '0.144.2', '0.143.1']) {
    const agent = queuedAgent([{ return: envelope(validReceipt({ cli_version: cli })) }])
    const { gateAgent } = await loadGate(agent)
    const prov = {}
    const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
    assert.equal(r, null, `cli_version ${cli} is not the trusted release`)
    assert.equal(prov.receipt_verified, false)
  }
})

test('gate/codex: a hash field is TYPE-checked before the regex — a crafted toString() object is never accepted', async () => {
  const evil = { toString: () => '1'.repeat(64) } // a valid-looking sha only after coercion
  const agent = queuedAgent([{ return: envelope(validReceipt({ prompt_sha256: evil })) }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
  assert.equal(r, null, 'an object-valued hash is not a string hash — no String() coercion in the validator')
  assert.equal(prov.receipt_verified, false)
  assert.equal(prov.fallback_reason, 'transport_receipt_invalid')
})

test('gate/codex: a verified-looking receipt with NO payload is transport_receipt_invalid (provenance never lies)', async () => {
  for (const env of [{ codex_receipt: validReceipt(), raw_artifact_refs: {} }, { payload: null, codex_receipt: validReceipt(), raw_artifact_refs: {} }]) {
    const agent = queuedAgent([{ return: env }])
    const { gateAgent } = await loadGate(agent)
    const prov = {}
    const r = await gateAgent('p', solSeat({ twoHeads: 'required', provenance: prov }))
    assert.equal(r, null, 'a receipt with no answer is not a verification')
    assert.equal(prov.receipt_verified, false)
    assert.equal(prov.fallback_reason, 'transport_receipt_invalid')
  }
})

test('gate/codex: a successful best-effort redispatch after a refusal carries the dispatch history into the verified provenance', async () => {
  // the refusal degrades once (same-model redispatch), the redispatch returns a clean verified envelope —
  // the verified record must PRESERVE fallback_reason:'redispatch' + classification:'refusal', not erase them.
  const agent = queuedAgent([{ throw: 'the model refused to rule' }, { return: envelope(validReceipt(), { receipt_sha256: RSHA }) }])
  const { gateAgent } = await loadGate(agent)
  const prov = {}
  const r = await gateAgent('p', solSeat({ twoHeads: 'best_effort', provenance: prov }))
  assert.deepEqual(r, { verdict: 'APPROVE' })
  assert.equal(agent.calls.length, 2, 'one refusal, one successful redispatch')
  assert.equal(prov.receipt_verified, true)
  assert.equal(prov.fallback_reason, 'redispatch', 'the redispatch history is preserved, not erased to null')
  assert.equal(prov.classification, 'refusal')
  assert.equal(prov.actual_transport_model, 'gpt-5.6-sol')
})

// ── R1 classifier precision (Sol finding 4): the narrow 'other' boundary rethrows unrelated errors ──
// Each of these is a REAL error that must NOT be mistaken for a seat-death: an "HTTP retry cap" is not
// the platform's StructuredOutput cap; ECONNREFUSED contains the substring 'refus' but is a transport
// error, not a seat refusal; "Cannot read properties of null" contains 'null' but null_result is
// STRUCTURAL only. All three classify as 'other' → RETHROW, never a silent degradation.
for (const [name, msg] of [
  ['an "HTTP retry cap exceeded" is not the StructuredOutput cap', 'HTTP retry cap exceeded'],
  ['ECONNREFUSED is a transport error, not a seat refusal', 'connect ECONNREFUSED 127.0.0.1:8080'],
  ['a "connection refused" is a transport error, not a seat refusal', 'connection refused by peer'],
  ['"Cannot read properties of null" is not a null_result (structural only)', "Cannot read properties of null (reading 'overall')"],
]) {
  test(`gate: ${name} — classifies 'other' and RETHROWS`, async () => {
    const agent = queuedAgent([{ throw: msg }])
    const { gateAgent, classifyGateFailure } = await loadGate(agent)
    assert.equal(classifyGateFailure(new Error(msg)), 'other')
    const prov = {}
    await assert.rejects(() => gateAgent('p', { label: 'g', model: 'opus', provenance: prov }), new RegExp(msg.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.equal(agent.calls.length, 1, 'an unrelated error is never re-dispatched')
    assert.equal(prov.classification, 'other')
  })
}

test("gate: null_result is STRUCTURAL only — a caught error is never classified null_result by string", async () => {
  const { classifyGateFailure } = await loadGate(queuedAgent([]))
  assert.equal(classifyGateFailure(new Error('the result was null and empty')), 'other')
  assert.equal(classifyGateFailure(new Error('no usable result')), 'other')
})

// ── R4 production-path source assertions: the fix must be wired into the REAL call sites, not only the
// unit-mocked module. These grep the workflows-src (the bundler's source of truth) exactly like the
// packaging tests, proving build's goal-audit + validate's traversal ride gateAgent and that the
// second-family verification claim carries the three-condition honesty guard. ────────────────────────
test('R4: build.js goal-audit leg rides gateAgent (not raw agent) — a gate leg on the policy', () => {
  assert.match(BUILD_SRC, /const goalAudit = \(suffix, prov\) => gateAgent\(goalBackwardPrompt\(m\)/,
    'the goal-backward audit must be a gateAgent leg carrying a provenance sink')
  assert.doesNotMatch(BUILD_SRC, /const goalAudit = \(suffix\) => agent\(goalBackwardPrompt/,
    'the raw-agent + hand-written catch shape must be gone')
})

test('R4: validate.js traversal leg rides gateAgent with a per-pass provenance sink under the external deadline', () => {
  assert.match(VALIDATE_SRC, /gateAgent\(traversalPrompt\(uiScs\), \{[\s\S]*?provenance: passProv/,
    'the traversal gate leg must carry a fresh per-pass provenance sink')
  assert.match(VALIDATE_SRC, /traversalProvLog\.map\(\(p\) => \(\{ gate: 'traversal', \.\.\.p \}\)\)/,
    'the append-only traversal provenance array must feed validate_verdict.gate_provenance (every pass, no collapse)')
})

test('R4 (B4-3 D3): validate.js second_family_verified is RECEIPT-BASED — the model guard AND receipt/ledger attestation', () => {
  // B4-3 D3 replaces the outer-model provenance check with receipt attestation. The verification now
  // gates on attestSecond (posture.second_family && codexAvailable && a runToken) and requires the codex
  // receipt to be BOTH structurally verified and invocation-exact ledger-verified, on top of the model checks.
  assert.match(VALIDATE_SRC, /const attestSecond = posture\.second_family && codexAvailable && runTokenRaw != null/,
    'the attestation seat gates on codex + a runToken (a single-seat attestation, not the tier gate)')
  assert.match(VALIDATE_SRC, /const secondFamilyVerified = attestSecond &&/,
    'verification requires the attested seat (codex + token) — never an unattested claim')
  assert.match(VALIDATE_SRC, /goalSecondProv\.actual_model === goalSecondProv\.requested_model/,
    'verification still requires actual === requested')
  assert.match(VALIDATE_SRC, /goalSecondProv\.fallback_reason == null/,
    'verification still requires no fallback')
  assert.match(VALIDATE_SRC, /goalSecondProv\.classification == null/,
    'verification still requires no seat-death classification')
  assert.match(VALIDATE_SRC, /goalSecondProv\.receipt_verified === true/,
    'verification requires a STRUCTURALLY verified codex receipt')
  assert.match(VALIDATE_SRC, /secondFamilyLedgerVerified === true/,
    'verification requires the invocation-exact ledger cross-check to pass')
  assert.match(VALIDATE_SRC, /second_family_verified: secondFamilyVerified/,
    'the ledgered flag must be the guarded value, not the naive equality check')
  assert.match(VALIDATE_SRC, /no_run_token_no_attestation/,
    'codex-but-tokenless degrades honestly with the distinct no-attestation reason (never an unattested claim)')
})

// ── N2/N3/N4 executed coverage: the traversal provenance sink is APPEND-ONLY, gateAgent's 'other' rethrow
// composes with the absorbing wrapper into a TRUTHFULLY-classified record, and a timed-out pass whose late
// completion NEVER arrives is booked unsettled_at_verdict. These EXECUTE the REAL withDeadline (imported
// from src/gate.mjs) around the real gateAgent, replicating only validate.js's per-pass loop discipline. ──
test('N2: the traversal provenance sink is APPEND-ONLY — a clean pass, then a deadline-timeout pass that LATE-completes, yield three distinct records with no overwrite', async () => {
  // agent() mock keyed by the pass label: the primary leg returns clean immediately; the adversarial leg
  // HANGS past the tiny deadline (a setTimeout-backed promise — a macrotask await, exactly like wedged I/O)
  // then resolves LATE. gateAgent is the REAL inner leg; the loop below replicates validate.js's per-pass
  // fresh-sink + append discipline, driving the REAL withDeadline/TRAVERSAL_TIMEOUT from src/gate.mjs.
  const agent = async (prompt, opts) => {
    if (opts.label === 'argus:traversal') return { browser_result: 'full', tool: 'kiln-probe' } // primary: clean
    return new Promise((res) => setTimeout(() => res({ browser_result: 'full', tool: 'kiln-probe' }), 60)) // adversarial: late
  }
  const { gateAgent, withDeadline, TRAVERSAL_TIMEOUT } = await loadGate(agent)
  const traversalProvLog = []
  const traversalUnsettled = new Map()
  let lateFired
  const lateDone = new Promise((r) => { lateFired = r })
  for (const sfx of ['', ':adversarial']) {
    const pass = sfx || 'primary'
    const passProv = {}
    const t = await withDeadline(
      () => gateAgent('p', { label: `argus:traversal${sfx}`, model: 'opus', provenance: passProv }),
      20,
      (lateErr) => { traversalUnsettled.delete(pass); traversalProvLog.push({ pass, late: true, ...passProv, ...(lateErr ? { error: String((lateErr && lateErr.message) || lateErr).slice(0, 200) } : {}) }); lateFired() }
    )
    if (t === TRAVERSAL_TIMEOUT) {
      traversalUnsettled.set(pass, true)
      traversalProvLog.push({ pass, requested_model: 'opus', actual_model: null, fallback_reason: 'deadline', classification: 'timeout' })
      break
    }
    if (t && t.__kiln_rejected === true) { traversalProvLog.push({ pass, ...passProv, error: String((t.error && t.error.message) || t.error).slice(0, 200) }); continue }
    traversalProvLog.push({ pass, ...passProv })
  }
  // after the loop broke on the adversarial timeout, capture a snapshot of the timeout record, then wait
  // for the hung leg to LATE-complete and append its own record — the timeout record must NOT change.
  assert.equal(traversalProvLog.length, 2, 'the clean primary + the adversarial timeout are recorded before the late completion')
  const timeoutSnapshot = { ...traversalProvLog[1] }
  await lateDone
  assert.equal(traversalProvLog.length, 3, 'the LATE completion APPENDS a third record — it does not overwrite')
  assert.equal(traversalUnsettled.size, 0, 'the late arrival cleared the settled-flag — the pass is no longer unsettled')
  assert.deepEqual(traversalProvLog[0], { pass: 'primary', requested_model: 'opus', actual_model: 'opus', fallback_reason: null, classification: null })
  assert.deepEqual(traversalProvLog[1], timeoutSnapshot, 'the timeout record is UNTOUCHED by the late writer (append-only, never mutate)')
  assert.equal(traversalProvLog[1].classification, 'timeout')
  assert.deepEqual(traversalProvLog[2], { pass: ':adversarial', late: true, requested_model: 'opus', actual_model: 'opus', fallback_reason: null, classification: null })
})

test("N4: a timed-out pass unsettled at the verdict snapshot is booked unsettled_at_verdict — and a completion arriving AFTER the verdict never rewrites the emitted record", async () => {
  // the leg hangs past the deadline AND past the verdict snapshot (the exact Sol HIGH scenario: a late
  // completion landing after both ledger writes). We close the book while it is still in flight, then let it
  // land — the emitted verdict must already read unsettled_at_verdict and must not change retroactively.
  const agent = async () => new Promise((res) => setTimeout(() => res({ browser_result: 'full', tool: 'kiln-probe' }), 60))
  const { gateAgent, withDeadline, TRAVERSAL_TIMEOUT } = await loadGate(agent)
  const traversalProvLog = []
  const traversalUnsettled = new Map()
  const pass = 'primary'
  const passProv = {}
  let lateFired
  const lateDone = new Promise((r) => { lateFired = r })
  const t = await withDeadline(
    () => gateAgent('p', { label: 'argus:traversal', model: 'opus', provenance: passProv }),
    20,
    (lateErr) => { traversalUnsettled.delete(pass); traversalProvLog.push({ pass, late: true, ...passProv, ...(lateErr ? { error: String((lateErr && lateErr.message) || lateErr).slice(0, 200) } : {}) }); lateFired() }
  )
  assert.equal(t, TRAVERSAL_TIMEOUT, 'the leg times out — the deadline fires before the completion lands')
  traversalUnsettled.set(pass, true)
  traversalProvLog.push({ pass, requested_model: 'opus', actual_model: null, fallback_reason: 'deadline', classification: 'timeout' })
  // the verdict-close snapshot: the leg is still in flight, so it is booked unsettled_at_verdict.
  const verdictProvenance = [
    ...traversalProvLog.map((p) => ({ gate: 'traversal', ...p })),
    ...Array.from(traversalUnsettled.keys()).map((p) => ({ gate: 'traversal', pass: p, late_status: 'unsettled_at_verdict' })),
  ]
  assert.deepEqual(verdictProvenance, [
    { gate: 'traversal', pass: 'primary', requested_model: 'opus', actual_model: null, fallback_reason: 'deadline', classification: 'timeout' },
    { gate: 'traversal', pass: 'primary', late_status: 'unsettled_at_verdict' },
  ], 'the timeout record AND its unsettled_at_verdict closer both ride the verdict — no pass goes unledgered')
  // the completion lands AFTER the verdict. It appends its own in-memory late record and clears the flag,
  // but the verdict was already emitted — the closing record is immutable, exactly as a real ledger write is.
  await lateDone
  assert.equal(traversalUnsettled.size, 0, 'the late arrival cleared the flag (post-verdict, in-memory only)')
  assert.equal(verdictProvenance.length, 2, 'the already-emitted verdict record is UNCHANGED by the post-verdict completion')
  assert.equal(verdictProvenance[1].late_status, 'unsettled_at_verdict', 'the verdict still honestly reads unsettled_at_verdict')
})

test("N3: gateAgent 'other' rethrow composes with the absorbing withDeadline wrapper — the traversal ABSORBS to a truthfully-classified provenance record, never propagating", async () => {
  const agent = queuedAgent([{ throw: 'ENOENT: the disk is on fire while reading law.json' }])
  const { gateAgent, withDeadline } = await loadGate(agent)
  const traversalProvLog = []
  const pass = 'primary'
  const passProv = {}
  // the shipped wrapper never lets a traversal-leg rejection escape the stage: it resolves to the rejected
  // sentinel (the DESIGNED EXCEPTION to gateAgent's 'other' rethrow rule). A deadline far larger than the
  // synchronous throw guarantees the rejection path (not the timeout path) is what we exercise.
  const t = await withDeadline(
    () => gateAgent('p', { label: 'argus:traversal', model: 'opus', provenance: passProv }),
    5000,
    () => { throw new Error('onLate must not fire on a pre-deadline rejection') }
  )
  assert.ok(t && t.__kiln_rejected === true, 'the wrapper ABSORBS the rethrow to a rejected sentinel — a Tier-2 failure never kills validate')
  // the loop's absorb branch — append the truthful record with a bounded (first-200-char) message.
  traversalProvLog.push({ pass, ...passProv, error: String((t.error && t.error.message) || t.error).slice(0, 200) })
  assert.equal(agent.calls.length, 1, "an 'other' error is never re-dispatched")
  assert.equal(traversalProvLog.length, 1)
  assert.equal(traversalProvLog[0].classification, 'other', 'provenance records the TRUE class — never a fabricated seat-death')
  assert.equal(traversalProvLog[0].fallback_reason, 'rethrow')
  assert.equal(traversalProvLog[0].actual_model, null)
  assert.equal(traversalProvLog[0].requested_model, 'opus')
  assert.match(traversalProvLog[0].error, /disk is on fire/)
  assert.ok(traversalProvLog[0].error.length <= 200, 'the error message is bounded to the first 200 chars')
})
