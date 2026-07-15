// GENERATED from workflows-src/vision.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-vision',
  description: 'Kiln vision-compile leg (BLUEPRINT §10, P4): the tail of the brainstorm stage. The append-only session ledger (.kiln/docs/brainstorm-ledger.jsonl) is the canonical artifact; this workflow gates it mechanically (kiln-vision ledger-gate — an incomplete session can never compile), then ONE fresh-context compiler agent whose SOLE source is the ledger writes .kiln/docs/VISION.md (traceability is structural: the compiler never saw the chat), then the deterministic post-compile gate (kiln-vision validate) rules — with a bounded revise loop (≤2) on typed violations. VISION.md is a DERIVED artifact: regenerable from the ledger at any time, never hand-edited; a re-run recompiles from scratch. On a validator-clean VISION the run ledger gets vision_compiled THEN stage_completed (brainstorm); on exhaustion, neither — vision_valid:false with the typed violations is the conductor\'s escalation payload.',
  phases: [
    { title: 'The Gate', detail: 'kiln-vision ledger-gate — the mechanical pre-compile floor: session_complete terminal, approved section intents, clarify pass, the idea floor' },
    { title: 'The Compilation', detail: 'one fresh-context compiler writes VISION.md from the ledger alone; the validator rules; typed violations drive a bounded revise loop (≤2)' },
    { title: 'The Seal', detail: 'existence verified; vision_compiled + stage_completed (brainstorm) ledgered — only on a validator-clean VISION' },
  ],
}

// ── args from the conductor: { kilnDir, projectPath, pluginRoot } ──
// args may arrive as an object or a JSON string depending on how the caller encoded it. Normalise both.
function normalizeArgs(args) {
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { return { __parse_error: true } }
  }
  return (args && typeof args === 'object') ? args : {}
}
const A = normalizeArgs(args)
const PAYLOAD_FIRST = 'Your ENTIRE final message is ONE StructuredOutput tool call — no prose before or after it. Emit the payload properties FIRST; reasoning is the LAST property, OPTIONAL, and under 50 words — put detail in the designated report file or field, never in reasoning. A long leading reasoning string is the observed death mode: the call truncates before the payload lands, the validator rejects it, each rejection burns one of five attempts, and five failures kill this leg.'
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('vision.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
// pluginRoot is the conductor-resolved absolute $CLAUDE_PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). LOAD-BEARING here — unlike an optional ledger append, the kiln-vision CLI
// IS this workflow's floor and verdict: without it there is no mechanical gate, and a compile
// without a gate would be exactly the self-graded homework §10 retires. Absence fails CLOSED with a
// named reason (the conductor escalates); it never degrades to a gateless compile.
const pluginRoot = A.pluginRoot

const docsDir = `${kilnDir}/docs`
const ledgerFile = `${docsDir}/brainstorm-ledger.jsonl`
const visionFile = `${docsDir}/VISION.md`

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')
// ── The single gateAgent (+ receipt attestation), whole src/gate.mjs inlined — the D4 fidelity pair's
//    Sol seat is a Sonnet wrapper over transport:'codex'; gateAgent STRUCTURALLY validates the receipt. ──
// gate.mjs — the single gateAgent for every gate/judgment leg (BLUEPRINT WS-B1). ONE source of
// truth: inlined verbatim into build/validate/report by the `// @gate` bundler marker, so the
// v3.0.1 drift (build's copy matched 'retry cap', validate's did not) can never recur again.
// Kept SEPARATE from spine.mjs on purpose — spine.mjs is pure-functions-only by its header
// contract; gateAgent awaits the ambient agent() and speaks through the ambient log(), so it does
// not belong in the pure module. Every gate-bearing workflow already carries both globals.
//
// A MUTE gate leg must DEGRADE, never detonate the run — but a MUTE seat is never a PASS. There are
// four SEAT-DEATH classes, and every one of them routes through the twoHeads policy below:
//   · structured_output_failure — the observed death: a truncated tool call rejected five times.
//   · null_result               — agent() returned null/undefined (a DEAD SEAT, never success). This
//                                 class is STRUCTURAL ONLY: set when the RETURN is null, never string-matched.
//   · timeout                   — the seat ran past its deadline.
//   · refusal                   — the seat declined to rule.
// A dead seat is NOT a silent success and NOT a stage-detonation: the policy converts it to a
// fail-closed null (or, in best_effort, one fresh re-dispatch first), and every gate call site folds
// that null through its EXISTING fail-closed path (rejection / QA_FAIL / re-ask / the unruled-gate
// PARTIAL ceiling). gateAgent wraps ONLY gate/judgment legs (reviewers, tribunal analysts, the judge,
// the goal-backward audit, the report closer); a builder, slicer, or scaffold leg stays on plain
// agent() — its failure is real work lost, not a mute voice.
//
// The narrow-regex doctrine is PRESERVED but scoped precisely: its ONLY job is to keep an UNRELATED
// exception (class 'other') from being swallowed into a silent degradation on a gate leg
// (DO-NOT-TOUCH) — so 'other' still RETHROWS and fails the stage, itself fail-closed. The seat-death
// classes are NOT unrelated errors; they are the very failure the gate is built to survive, so they
// degrade rather than rethrow. The regex is scoped to the OBSERVED platform phrasing ONLY — the real
// error "StructuredOutput retry cap (5) exceeded" matches 'StructuredOutput'; a bare 'retry cap' is
// deliberately NOT matched (it false-positives unrelated errors like an "HTTP retry cap exceeded").
//
// RECEIPT PROVENANCE (twin-council; sol-b34-design "Codex transport receipt"). A Sol council seat runs
// a Sonnet wrapper over `transport:'codex'`, and a Sonnet's WORD that it invoked Codex is worthless: the
// deterministic kiln-codex-receipt.mjs boundary owns process capture + hashing + verification. So a
// codex-transport wrapped agent() returns an ENVELOPE { payload, codex_receipt, raw_artifact_refs }, and
// gateAgent STRUCTURALLY validates the relayed receipt — all 14 receipt keys present and well-formed,
// exit 0, and reported_model === requested_model === the pinned transportModel. gate.mjs can NEVER hash
// (it validates shape + equality, never recomputes — the deterministic ledger cross-check is the call
// site's leg, batch 1b-ii). A valid receipt returns envelope.payload and records the transport
// attestation. `receiptRequired` + a missing/invalid receipt is a DEAD Sol seat: two_heads:required
// fails closed to null (Sonnet's own answer NEVER substitutes for Sol); best_effort may retain the
// wrapper answer as honest Sonnet provenance that can never later claim second-family verification. All
// of this fires ONLY on a codex leg — a non-codex leg's provenance is byte-for-byte the v3.0.1 shape.
const GATE_FAILURE_RE = /StructuredOutput|structured.?output/i
const isStructuredOutputFailure = (e) => GATE_FAILURE_RE.test(String((e && e.message) || e))

// classifyGateFailure — label a CAUGHT error for the provenance record AND the degrade decision.
// Structured-output is tested FIRST so its exact phrasing wins; then refusal (/refus/, but the
// TRANSPORT errors ECONNREFUSED / 'connection refused' are EXCLUDED — they are not a seat's refusal
// to rule); then timeout. Anything else is 'other' — an unrelated exception that RETHROWS.
// null_result is NEVER string-matched: a null/undefined RETURN (not a caught error) is classified
// 'null_result' STRUCTURALLY at the dispatch site, so a message that merely contains 'null'
// (e.g. "Cannot read properties of null") stays 'other' and RETHROWS.
function classifyGateFailure(e) {
  const s = String((e && e.message) || e)
  if (GATE_FAILURE_RE.test(s)) return 'structured_output_failure'
  if (/refus/i.test(s) && !/ECONNREFUSED|connection refused/i.test(s)) return 'refusal'
  if (/\btimed?[ -]?out\b|\bdeadline exceeded\b|ETIMEDOUT/i.test(s)) return 'timeout'
  return 'other'
}

// gateAgent(prompt, opts) — wrap a single gate/judgment leg. opts extends the agent() opts with
// gateAgent-only meta keys (stripped before agent() is called, never leaked to the platform):
//   opts.twoHeads   'required' | 'best_effort' (default 'best_effort' = the v3.0.1 behavior).
//                   'best_effort': on ANY seat-death class, one fresh re-dispatch on the SAME model
//                     (v3.0.1 semantics); if THAT also dies a seat-death and the requested model is
//                     'fable', ONE substitution dispatch on 'opus' (the twin-council degradation
//                     rail) — actual_model:'opus', fallback recorded; otherwise fail-closed null.
//                   'required': a council-seat leg that must NOT be silently substituted — on ANY
//                     seat-death class return the fail-closed null WITHOUT a re-dispatch. The caller's
//                     existing fail-closed path takes the null and the CONDUCTOR routes the block to
//                     a gated operator checkpoint (that routing is conductor-side, out of scope here
//                     — this function only refuses to substitute and records why).
//   opts.transport  'codex' marks a seat that shells out to GPT via codex. 'ultra' effort on such a
//                     seat THROWS at call time (never-ultra doctrine — codex has no ultra tier). On a
//                     codex leg the wrapped agent() returns an ENVELOPE (see the RECEIPT PROVENANCE note
//                     above); on any other leg agent() returns the result directly (v3.0.1 behavior).
//   opts.transportModel  the PINNED codex model the receipt must attest (e.g. the gpt-5.6-sol id). The
//                     receipt is valid only when reported_model === requested_model === transportModel,
//                     so CODEX_FALLBACK cannot sign a required Sol seat. Codex-only meta key.
//   opts.receiptRequired  true ⇒ a missing/malformed/model-mismatched receipt is a DEAD Sol seat (see
//                     the honest-failure paths below). THROWS at call time if set without transport:'codex'
//                     (a misconfigured seat is a programming error, not a degradation). Codex-only meta key.
//   opts.effort     reasoning effort, passed through to agent() (a real platform opt).
//   opts.provenance optional sink object. gateAgent writes {requested_model, actual_model,
//                     fallback_reason, classification} onto it so a caller that ALREADY ledgers can
//                     ride the record into its EXISTING note/evidence data payload — no new event
//                     type is minted (BLUEPRINT §B6/§10). actual_model is ALWAYS the model that
//                     actually produced the returned result — the requested model on a clean call or
//                     a same-model re-dispatch, 'opus' after a fable→opus substitution, and null on a
//                     fail-closed null. classification is the seat-death class that forced the
//                     degradation (null on a clean success). Absent sink ⇒ the record is dropped. On a
//                     CODEX leg the record additionally carries the transport-attestation block
//                     (wrapper_model, transport, requested_transport_model, actual_transport_model,
//                     receipt_verified, receipt_hash, session_id, tokens_used, prompt_hash, output_hash);
//                     these fields are ABSENT on every non-codex leg (the exact v3.0.1 shape).
//
// RECEIPT_KEYS — the 14 fields kiln-codex-receipt.mjs assembles; gateAgent checks all are present and
// well-formed (structural verification only — it never recomputes a hash). Mirrored, not imported.
const RECEIPT_KEYS = [
  'receipt_version', 'parser_version', 'transport', 'invocation_id', 'prompt_sha256', 'packet_sha256',
  'cli_version', 'requested_model', 'reported_model', 'session_id', 'exit_code', 'tokens_used',
  'output_sha256', 'stderr_sha256',
]
const RECEIPT_SHA_RE = /^[0-9a-f]{64}$/
// the exact constants the sealed validator pins (kiln-codex-receipt.mjs:24-31,354) — mirrored, not
// imported. A drifting receipt_version/parser_version/transport/session/cli is a fail-closed reject,
// never a silent downgrade: a receipt whose parser or transport we do not recognize is unverifiable.
const RECEIPT_VERSION = 1
const RECEIPT_PARSER_VERSION = 'kiln-codex-receipt/1'
const RECEIPT_TRANSPORT = 'codex_exec'
const RECEIPT_CLI_VERSION = '0.144.1' // the EXACT trusted CLI the sealed parser accepts (kiln-codex-receipt.mjs CLI_VERSION)
const RECEIPT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// validateCodexReceipt(env, transportModel) — STRUCTURALLY validate the receipt a codex-transport
// wrapper relayed inside its envelope. Returns { ok:true, receipt } or { ok:false, reason } where reason
// is 'transport_receipt_missing' (no codex_receipt object) or 'transport_receipt_invalid' (any structural
// or model failure). Every field is TYPE-checked before any regex — NO String()/coercion anywhere, so an
// object with a crafted toString() can never masquerade as a hash. The model gate is the pinned-seat
// rule: reported_model === requested_model === transportModel, so a CODEX_FALLBACK receipt (a different
// reported model) can never sign the seat; cli_version is pinned to the exact trusted release.
function validateCodexReceipt(env, transportModel) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return { ok: false, reason: 'transport_receipt_missing' }
  const r = env.codex_receipt
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, reason: 'transport_receipt_missing' }
  for (const k of RECEIPT_KEYS) if (!Object.prototype.hasOwnProperty.call(r, k)) return { ok: false, reason: 'transport_receipt_invalid' }
  for (const k of ['invocation_id', 'prompt_sha256', 'packet_sha256', 'output_sha256', 'stderr_sha256']) if (typeof r[k] !== 'string' || !RECEIPT_SHA_RE.test(r[k])) return { ok: false, reason: 'transport_receipt_invalid' }
  if (r.exit_code !== 0) return { ok: false, reason: 'transport_receipt_invalid' }
  for (const k of ['cli_version', 'parser_version', 'transport', 'session_id', 'reported_model', 'requested_model']) if (typeof r[k] !== 'string' || !r[k]) return { ok: false, reason: 'transport_receipt_invalid' }
  if (r.receipt_version !== RECEIPT_VERSION) return { ok: false, reason: 'transport_receipt_invalid' }
  if (r.parser_version !== RECEIPT_PARSER_VERSION) return { ok: false, reason: 'transport_receipt_invalid' }
  if (r.transport !== RECEIPT_TRANSPORT) return { ok: false, reason: 'transport_receipt_invalid' }
  if (!RECEIPT_UUID_RE.test(r.session_id)) return { ok: false, reason: 'transport_receipt_invalid' }
  if (r.cli_version !== RECEIPT_CLI_VERSION) return { ok: false, reason: 'transport_receipt_invalid' }
  if (!Number.isSafeInteger(r.tokens_used) || r.tokens_used < 0) return { ok: false, reason: 'transport_receipt_invalid' }
  if (!(r.reported_model === r.requested_model && r.requested_model === transportModel)) return { ok: false, reason: 'transport_receipt_invalid' }
  return { ok: true, receipt: r }
}

// liftReceiptHash(env) — lift the ledger's receipt_sha256 if the envelope RELAYED it (top-level or under
// raw_artifact_refs); else null. NEVER computed here — gate.mjs cannot hash.
function liftReceiptHash(env) {
  const direct = env && env.receipt_sha256
  if (typeof direct === 'string' && RECEIPT_SHA_RE.test(direct)) return direct
  const nested = env && env.raw_artifact_refs && env.raw_artifact_refs.receipt_sha256
  if (typeof nested === 'string' && RECEIPT_SHA_RE.test(nested)) return nested
  return null
}

async function gateAgent(prompt, opts) {
  const o = opts || {}
  if (o.effort === 'ultra' && o.transport === 'codex') {
    throw new Error(`gateAgent(${o.label || 'gate'}): 'ultra' effort is forbidden on a codex-transport seat — never-ultra doctrine`)
  }
  if (o.receiptRequired && o.transport !== 'codex') {
    throw new Error(`gateAgent(${o.label || 'gate'}): receiptRequired demands transport:'codex' — a misconfigured seat is a programming error, not a degradation`)
  }
  const { twoHeads, transport, transportModel, receiptRequired, provenance, ...agentOpts } = o // meta keys never reach agent()
  const requested = o.model != null ? o.model : null
  const required = twoHeads === 'required'
  const label = o.label || 'gate'
  const isCodex = transport === 'codex'
  // codex-static provenance — present on EVERY codex leg. wrapper_model is the platform seat that relayed
  // codex (opts.model, e.g. sonnet); requested_transport_model is the pinned codex model the receipt must attest.
  const codexStatic = () => ({ wrapper_model: requested, transport: 'codex', requested_transport_model: transportModel != null ? transportModel : null })
  // truthful provenance: actual_model is whatever model produced the RETURNED result (null on a
  // fail-closed null); classification is the seat-death class that forced any degradation. A codex leg
  // additionally carries the transport-attestation block, receipt-derived fields NULLED (a seat-death or a
  // dead-receipt Sol seat never invents attestation); a non-codex leg keeps the exact v3.0.1 four fields.
  const record = (actual_model, fallback_reason, classification) => {
    if (!(provenance && typeof provenance === 'object')) return
    Object.assign(provenance, { requested_model: requested, actual_model, fallback_reason, classification })
    if (isCodex) Object.assign(provenance, codexStatic(), { actual_transport_model: null, receipt_verified: false, receipt_hash: null, session_id: null, tokens_used: null, prompt_hash: null, output_hash: null })
  }
  // one dispatch attempt → { ok, value, cls, error }. A null/undefined RETURN is a DEAD SEAT
  // (cls 'null_result'), never a usable result; a caught error is classified; a usable result is ok.
  const dispatch = async (agentO) => {
    try {
      const r = await agent(prompt, agentO)
      if (r == null) return { ok: false, value: null, cls: 'null_result' }
      return { ok: true, value: r }
    } catch (e) {
      return { ok: false, value: null, cls: classifyGateFailure(e), error: e }
    }
  }
  // settleCodex(env, history) — a codex dispatch returned a usable envelope. STRUCTURALLY validate the
  // relayed receipt (gate.mjs never hashes; the deterministic ledger cross-check is the 1b-ii call-site
  // leg). A verified receipt requires a NON-NULL payload (a receipt with no answer is not a verification —
  // provenance never lies); it returns envelope.payload + the full attestation, carrying the dispatch
  // history (fallback_reason/classification of the path that led here, e.g. a best-effort redispatch after
  // a refusal — never erased to null/null). A missing/invalid receipt OR a payload-less envelope is a DEAD
  // Sol seat: required ⇒ fail-closed null (Sonnet's own answer NEVER substitutes for Sol); best_effort ⇒
  // retain the wrapper answer as honest Sonnet provenance (receipt_verified:false — never second-family).
  const settleCodex = (env, history) => {
    const h = history || {}
    const hasPayload = env && typeof env === 'object' && 'payload' in env
    const v = validateCodexReceipt(env, transportModel)
    if (v.ok && hasPayload && env.payload != null) {
      if (provenance && typeof provenance === 'object') Object.assign(provenance, {
        requested_model: requested, actual_model: requested,
        fallback_reason: h.fallback_reason != null ? h.fallback_reason : null,
        classification: h.classification != null ? h.classification : null,
        ...codexStatic(),
        actual_transport_model: v.receipt.reported_model, receipt_verified: true, receipt_hash: liftReceiptHash(env),
        session_id: v.receipt.session_id, tokens_used: v.receipt.tokens_used, prompt_hash: v.receipt.prompt_sha256, output_hash: v.receipt.output_sha256,
      })
      return env.payload
    }
    const reason = v.ok ? 'transport_receipt_invalid' : v.reason // a verified receipt with no payload is invalid
    if (required) { log(`${label}: ${reason} — two_heads:required, a dead Sol seat → null (fail-closed to a gated operator checkpoint)`); record(null, reason, h.classification != null ? h.classification : null); return null }
    log(`${label}: ${reason} — best_effort, retaining the Sonnet wrapper answer with honest provenance (never second-family)`)
    record(requested, reason, h.classification != null ? h.classification : null) // actual_model = the wrapper model; codexStatic() fields nulled by record()
    return hasPayload ? env.payload : env
  }
  const first = await dispatch(agentOpts)
  if (first.ok) {
    if (isCodex) return settleCodex(first.value, { fallback_reason: null, classification: null })
    record(requested, null, null); return first.value // clean seat — actual == requested
  }
  if (first.cls === 'other') { record(null, 'rethrow', 'other'); throw first.error } // unrelated exception — never swallowed
  // a seat-death class. In required mode a council seat is never silently substituted.
  if (required) {
    log(`${label}: ${first.cls} — two_heads:required, no substitution → null (fail-closed to a gated operator checkpoint)`)
    record(null, 'required_no_substitution', first.cls)
    return null
  }
  // best_effort: ONE fresh re-dispatch on the SAME model (v3.0.1 semantics).
  log(`${label}: ${first.cls} — re-dispatching one fresh agent (same model)`)
  const second = await dispatch({ ...agentOpts, label: label + ':redispatch' })
  if (second.ok) {
    if (isCodex) return settleCodex(second.value, { fallback_reason: 'redispatch', classification: first.cls })
    record(requested, 'redispatch', first.cls); return second.value
  }
  if (second.cls === 'other') { record(null, 'redispatch_rethrow', 'other'); throw second.error }
  // the same-model retry also died a seat-death. The twin-council degradation rail: if the requested
  // model was 'fable', ONE substitution dispatch on 'opus' — recorded as such, never claimed as fable.
  if (requested === 'fable') {
    log(`${label}: re-dispatch failed too — substituting opus for fable (twin-council degradation rail)`)
    const sub = await dispatch({ ...agentOpts, model: 'opus', label: label + ':opus-sub' })
    if (sub.ok) { record('opus', 'fable_substituted_opus', second.cls); return sub.value }
    if (sub.cls === 'other') { record(null, 'opus_sub_rethrow', 'other'); throw sub.error }
    log(`${label}: opus substitution failed too — degrading to null (fail-closed)`)
    record(null, 'redispatch_exhausted', sub.cls)
    return null
  }
  log(`${label}: re-dispatch failed too — degrading to null (fail-closed)`)
  record(null, 'redispatch_exhausted', second.cls)
  return null
}

// withDeadline(thunk, ms, onLate) — the await-bound for a Tier-2 traversal leg (BLUEPRINT §7). Lives
// here (one implementation, imported by the unit tests, inlined into validate by the @gate marker) so
// the tested wrapper and the shipped wrapper can never drift. Resolves to the thunk's value, the
// sentinel TRAVERSAL_TIMEOUT ({ __kiln_timeout: true }) if ms elapses first, or the sentinel
// { __kiln_rejected: true, error } if the thunk REJECTS before the deadline. Never itself rejects — a
// traversal leg's failure is a DEGRADATION, not a stage error. This is the DESIGNED EXCEPTION to
// gateAgent's 'other' rethrow rule (see validate's traversal loop): the outer contract ABSORBS a
// rejected traversal leg to static-only so a Tier-2 failure can never kill validate, yet the caller
// still receives the error so provenance NEVER lies (it records the real class + a bounded message).
// The timer is unref'd so a resolved race never keeps the event loop alive. onLate, when the thunk
// settles AFTER the deadline already fired, lets the caller APPEND a late-completion provenance record
// rather than mutate the timeout record it already wrote — the append-only sink guard against a late
// writer. DO-NOT-TOUCH: sentinel absorb, onLate, unref, and the never-rejects contract are load-bearing.
const TRAVERSAL_TIMEOUT = { __kiln_timeout: true }
function withDeadline(thunk, ms, onLate) {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    const timer = setTimeout(() => done(TRAVERSAL_TIMEOUT), Math.max(1, ms))
    if (typeof timer.unref === 'function') timer.unref()
    Promise.resolve().then(thunk).then(
      (v) => { clearTimeout(timer); if (settled) { if (typeof onLate === 'function') onLate(null, v) } else done(v) },
      (e) => { clearTimeout(timer); if (settled) { if (typeof onLate === 'function') onLate(e) } else done({ __kiln_rejected: true, error: e }) }
    )
  })
}
// ── Codex model pins (CODEX_MODEL default + CODEX_FALLBACK, inlined from src/models.mjs) ──
// models.mjs — the codex model pins, single source of truth (BLUEPRINT WS-B2). Inlined verbatim
// into every GPT-pinning workflow by the `// @models` bundler marker (like @gate pulls the whole
// module), so the model id can never drift across build/gauge/architecture/validate.
// DOCTRINE (references/codex-prompt-guide.md): the fallback is RECORDED when used, never silent — a
// leg that drops to CODEX_FALLBACK must capture the chosen model in its archived output, never
// downgrade invisibly.
const CODEX_MODEL = 'gpt-5.6-sol' // GPT-5.6 Sol, GA 2026-07-09 — the codex CLI model id
const CODEX_FALLBACK = 'gpt-5.5'  // recorded rollout fallback (5.4 dropped — two rungs suffice)
// ── Twin Council pure core (B4-3 D1/D4) — the SEALED b42 call-site machinery, lifted to src/council.mjs
//    and inlined through the SAME @inline:council bundler contract build/validate use (helpers, never
//    copy-paste). Powers vision's T4 keystone: the fidelity pair between the mechanical checks and the
//    seal events. INERT on every sub-T4 / no-codex / tokenless path (councilCapable === false). ──
const COUNCIL_PROTOCOL_VERSION = 'twin-council/3'
function sha256Hex(input) {
  let bytes
  if (typeof input === 'string') {
    // WHATWG/TextEncoder UTF-8: a high surrogate is a pair ONLY when the very next unit is a low
    // surrogate; every LONE surrogate (high with no trailing low, or a bare low) encodes as U+FFFD
    // (0xEF 0xBF 0xBD). Matching node:crypto/Buffer.from(str,'utf8') exactly.
    bytes = []
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i)
      if (c < 0x80) bytes.push(c)
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
      else if (c >= 0xd800 && c <= 0xdbff) {
        const c2 = i + 1 < input.length ? input.charCodeAt(i + 1) : 0
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff)
          i++
          bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
        } else bytes.push(0xef, 0xbf, 0xbd) // lone high surrogate -> U+FFFD
      } else if (c >= 0xdc00 && c <= 0xdfff) bytes.push(0xef, 0xbf, 0xbd) // lone low surrogate -> U+FFFD
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  } else if (input instanceof Uint8Array) bytes = Array.from(input)
  else if (Array.isArray(input)) bytes = input.map((b) => b & 0xff)
  else throw new Error('sha256Hex: input must be a string or byte array')

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19

  const bitLen = bytes.length * 8
  const hiLen = Math.floor(bytes.length / 0x20000000) // (len*8) >> 32
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  bytes.push((hiLen >>> 24) & 0xff, (hiLen >>> 16) & 0xff, (hiLen >>> 8) & 0xff, hiLen & 0xff)
  bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff)

  const w = new Array(64)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
}
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
}
function claimTypeForClass(evidenceClass) {
  const c = String(evidenceClass || '')
  if (c === 'executed_check' || c === 'proposed_check') return 'executable'
  if (c === 'repo_state' || c === 'test_output') return 'repo'
  if (c === 'primary_source') return 'external'
  if (c === 'scenario') return 'risk'
  return null
}
function compareEvidence(a, b, claimType) {
  const RANKS = {
    executable: { executed_check: 2, proposed_check: 1 },
    repo: { repo_state: 1, test_output: 1 },
    external: { primary_source: 1 },
    risk: { scenario: 1 },
  }
  const ct = claimType || claimTypeForClass(a && a.class) || claimTypeForClass(b && b.class)
  const table = RANKS[ct]
  if (!table) return 'incomparable'
  const ra = table[String(a && a.class)]
  const rb = table[String(b && b.class)]
  if (ra === undefined || rb === undefined) return 'incomparable'
  return ra > rb ? 'stronger' : ra < rb ? 'weaker' : 'equal'
}
function validateReversal(prior, reversal) {
  const p = prior || {}, r = reversal || {}
  if (r.changed_evidence == null) return { valid: false, block_stands: true, relation: 'incomparable', reason: 'changed_evidence_absent' }
  if (!Array.isArray(r.changed_evidence)) return { valid: false, block_stands: true, relation: 'incomparable', reason: 'changed_evidence_not_array' }
  const list = r.changed_evidence
  if (!list.length) return { valid: false, block_stands: true, relation: 'incomparable', reason: 'changed_evidence_absent' }
  const rank = { stronger: 3, equal: 2, weaker: 1, incomparable: 0 }
  let best = 'incomparable'
  for (const ev of list) {
    const ct = r.claim_type || p.claim_type || claimTypeForClass(ev && ev.class) || claimTypeForClass(p.evidence && p.evidence.class)
    const rel = compareEvidence(ev, p.evidence, ct)
    if (rank[rel] > rank[best]) best = rel
  }
  const ok = best === 'stronger' || best === 'equal'
  return { valid: ok, block_stands: !ok, relation: best, reason: ok ? null : `no changed_evidence element is equal-or-stronger (best: ${best}) — a concession cannot clear a block` }
}
function councilSignature(fields) {
  const f = fields || {}
  const bound = {
    bundle_hash: f.bundle_hash != null ? f.bundle_hash : null,
    renderer_version: f.renderer_version != null ? f.renderer_version : null,
    plan_hash: f.plan_hash != null ? f.plan_hash : null,
    evidence_manifest_hash: f.evidence_manifest_hash != null ? f.evidence_manifest_hash : null,
    protocol_version: f.protocol_version != null ? f.protocol_version : null,
    seat_provenance: f.seat_provenance != null ? f.seat_provenance : null,
  }
  return { ...bound, signature_hash: sha256Hex(canonicalJson(bound)) }
}
function verifySignature(signature, currentContext) {
  if (!signature || typeof signature !== 'object') return false
  const bound = {
    bundle_hash: signature.bundle_hash != null ? signature.bundle_hash : null,
    renderer_version: signature.renderer_version != null ? signature.renderer_version : null,
    plan_hash: signature.plan_hash != null ? signature.plan_hash : null,
    evidence_manifest_hash: signature.evidence_manifest_hash != null ? signature.evidence_manifest_hash : null,
    protocol_version: signature.protocol_version != null ? signature.protocol_version : null,
    seat_provenance: signature.seat_provenance != null ? signature.seat_provenance : null,
  }
  if (signature.signature_hash !== sha256Hex(canonicalJson(bound))) return false
  if (currentContext != null && typeof currentContext === 'object') {
    for (const k of ['bundle_hash', 'renderer_version', 'plan_hash', 'evidence_manifest_hash', 'protocol_version']) {
      if (Object.prototype.hasOwnProperty.call(currentContext, k) && bound[k] !== currentContext[k]) return false
    }
    if (Object.prototype.hasOwnProperty.call(currentContext, 'seat_provenance') && canonicalJson(bound.seat_provenance) !== canonicalJson(currentContext.seat_provenance)) return false
  }
  return true
}
function validateRatification(ratification, ctx) {
  const r = ratification || {}, c = ctx || {}
  const errors = []
  const VERDICTS = ['APPROVE', 'BLOCK', 'NEITHER']
  const SELECTIONS = ['P0', 'P1', 'MERGED', 'NEITHER']
  if (!VERDICTS.includes(r.verdict)) errors.push({ code: 'bad_verdict', message: `verdict must be one of ${VERDICTS.join('|')}` })
  if (c.bundle_hash != null && r.artifact_hash !== c.bundle_hash) errors.push({ code: 'artifact_hash_mismatch', message: 'ratification artifact_hash does not equal the bundle hash' })
  const open = Array.isArray(c.open_divergence_ids) ? c.open_divergence_ids.map(String) : []
  const sels = Array.isArray(r.divergence_selections) ? r.divergence_selections : []
  const seen = []
  const selectionOf = new Map()
  for (const s of sels) {
    const id = s && s.divergence_id != null ? String(s.divergence_id) : undefined
    if (!s || !SELECTIONS.includes(s.selection)) errors.push({ code: 'bad_selection', at: id, message: 'selection must be P0|P1|MERGED|NEITHER' })
    if (id === undefined || !open.includes(id)) errors.push({ code: 'unknown_divergence', at: id, message: 'selection targets an unknown divergence' })
    else if (seen.includes(id)) errors.push({ code: 'duplicate_divergence', at: id, message: 'divergence selected more than once' })
    else { seen.push(id); selectionOf.set(id, s.selection) }
  }
  for (const id of open) if (!seen.includes(id)) errors.push({ code: 'uncovered_divergence', at: id, message: `open divergence '${id}' has no selection` })

  // findings[] entry shape (§6 schema): finding_id, claim, required_change, evidence_refs[], executable_check
  // present. A PRESENT-but-non-array findings field is itself malformed — only ABSENT defaults to empty.
  let findings = []
  if (r.findings !== undefined) {
    if (!Array.isArray(r.findings)) errors.push({ code: 'malformed_findings', message: 'findings must be an array (the §6 schema) when present' })
    else findings = r.findings
  }
  findings.forEach((f, i) => {
    const at = `findings[${i}]`
    if (!f || typeof f !== 'object' || Array.isArray(f)) { errors.push({ code: 'malformed_finding', at, message: 'finding must be an object' }); return }
    if (typeof f.finding_id !== 'string' || !f.finding_id) errors.push({ code: 'malformed_finding', at, message: 'finding_id must be a nonempty string' })
    if (typeof f.claim !== 'string' || !f.claim) errors.push({ code: 'malformed_finding', at, message: 'claim must be a nonempty string' })
    if (typeof f.required_change !== 'string' || !f.required_change) errors.push({ code: 'malformed_finding', at, message: 'required_change must be a nonempty string' })
    if (!Array.isArray(f.evidence_refs)) errors.push({ code: 'malformed_finding', at, message: 'evidence_refs must be an array' })
    if (!Object.prototype.hasOwnProperty.call(f, 'executable_check')) errors.push({ code: 'malformed_finding', at, message: 'executable_check must be present (null allowed)' })
  })

  // anti-capitulation (I9 one-finding-key rail): an APPROVE reversing a standing block needs
  // equal-or-stronger changed_evidence KEYED to that block's finding_id. changed_evidence is filtered
  // per block by finding_id BEFORE validateReversal, so one evidence item can never clear two blocks —
  // an item with no finding_id (or a non-matching one) contributes to no block's reversal.
  const standing = Array.isArray(c.standing_blocks) ? c.standing_blocks : []
  if (r.verdict === 'APPROVE' && standing.length) {
    const allEvidence = Array.isArray(r.changed_evidence) ? r.changed_evidence : []
    for (const block of standing) {
      const keyed = allEvidence.filter((ev) => ev && ev.finding_id === (block && block.finding_id))
      const rev = validateReversal(block, { changed_evidence: keyed, claim_type: block && block.claim_type })
      if (!rev.valid) errors.push({ code: 'unevidenced_reversal', at: block && block.finding_id, message: 'APPROVE reverses a standing block without equal-or-stronger changed_evidence keyed to its finding_id — the block stands' })
    }
  }

  // atomic compatibility: the adopted selection combination must satisfy every compatibility edge (§7).
  // Every edge is SHAPE-CHECKED first — exactly two members, each { divergence_id, selection } with a
  // legal selection; a malformed edge is a validation error (never silently skipped), and an edge whose
  // two members name the SAME divergence is a context programming error (self_edge).
  // a PRESENT-but-non-array compatibility_edges container is itself malformed (mirror the findings rule);
  // only an ABSENT container defaults to empty.
  let edges = []
  if (c.compatibility_edges !== undefined) {
    if (!Array.isArray(c.compatibility_edges)) errors.push({ code: 'malformed_edges_container', message: 'compatibility_edges must be an array when present' })
    else edges = c.compatibility_edges
  }
  edges.forEach((edge, i) => {
    const at = `compatibility_edges[${i}]`
    const pair = Array.isArray(edge) ? edge : [edge && edge.left, edge && edge.right]
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((m) => m && typeof m === 'object' && m.divergence_id != null && SELECTIONS.includes(m.selection))) {
      errors.push({ code: 'malformed_edge', at, message: 'a compatibility edge must have exactly two { divergence_id, selection } members with legal selections' })
      return
    }
    if (String(pair[0].divergence_id) === String(pair[1].divergence_id)) {
      errors.push({ code: 'self_edge', at, message: 'a compatibility edge cannot relate a divergence to itself' })
      return
    }
    if (pair.every((m) => selectionOf.get(String(m.divergence_id)) === m.selection)) {
      errors.push({ code: 'incompatible_selection', at, message: `the selected combination violates a compatibility edge: ${pair.map((m) => `${m.divergence_id}=${m.selection}`).join(' + ')}` })
    }
  })

  return { valid: errors.length === 0, errors }
}
function twinRatified(parts) {
  const p = parts || {}
  const sigs = Array.isArray(p.signatures) ? p.signatures : null
  if (!sigs || sigs.length !== 2) throw new Error('twinRatified: exactly two head signatures are required (constitution §8)')
  const ctx = p.context != null ? p.context : (p.current_context != null ? p.current_context : null)
  if (ctx == null || typeof ctx !== 'object') throw new Error('twinRatified: a current context is required to bind both signatures')
  for (const k of ['bundle_hash', 'renderer_version', 'plan_hash', 'evidence_manifest_hash', 'protocol_version', 'seat_provenance']) {
    if (!Object.prototype.hasOwnProperty.call(ctx, k)) throw new Error(`twinRatified: the current context is incomplete (missing '${k}') — a partial context cannot bind a ratification`)
  }
  for (const k of ['bundle_hash', 'protocol_version', 'evidence_manifest_hash']) {
    if (ctx[k] == null) throw new Error(`twinRatified: the current context binds '${k}' to null — a certificate bound to nulls is no binding at all`)
  }
  for (const s of sigs) if (!verifySignature(s, { ...ctx, seat_provenance: s && s.seat_provenance })) throw new Error('twinRatified: a signature does not verify against the current context — cannot ratify')
  const seatKey = (s) => canonicalJson(s && s.seat_provenance != null ? s.seat_provenance : null)
  if (sigs[0].seat_provenance == null || sigs[1].seat_provenance == null || seatKey(sigs[0]) === seatKey(sigs[1])) {
    throw new Error('twinRatified: the two signatures must come from DISTINCT heads (distinct, non-null seat_provenance)')
  }
  const rats = Array.isArray(p.ratifications) ? p.ratifications : null
  if (!rats || rats.length !== 2) throw new Error('twinRatified: exactly two ratifications are required to confirm matching selections and verdicts')
  const isApprove = (v) => (typeof v === 'string' ? v : (v && v.verdict)) === 'APPROVE'
  if (!isApprove(rats[0].verdict) || !isApprove(rats[1].verdict)) throw new Error('twinRatified: both head verdicts must be APPROVE')
  if (!Array.isArray(p.open_divergence_ids)) throw new Error('twinRatified: open_divergence_ids is required — pass [] for a bundle with no open divergences')
  const openIds = p.open_divergence_ids.map(String)
  // ONLY a legal selection counts as coverage — an entry with an illegal or absent selection is a bad
  // selection (a blocked ratification), never silent coverage of the divergence it names.
  const SELECTIONS = ['P0', 'P1', 'MERGED', 'NEITHER']
  const selMap = (rat) => {
    const m = new Map()
    for (const s of (Array.isArray(rat.divergence_selections) ? rat.divergence_selections : [])) {
      if (!s || s.divergence_id == null) continue
      if (!SELECTIONS.includes(s.selection)) throw new Error(`twinRatified: a ratification selects divergence '${s.divergence_id}' with an illegal or absent selection — a bad selection is a blocked ratification`)
      m.set(String(s.divergence_id), s.selection)
    }
    return m
  }
  const m0 = selMap(rats[0]), m1 = selMap(rats[1])
  for (const id of openIds) {
    if (!m0.has(id) || !m1.has(id)) throw new Error(`twinRatified: open divergence '${id}' is not covered by both ratifications — an uncovered divergence is a blocked ratification`)
  }
  for (const id of new Set([...openIds, ...m0.keys(), ...m1.keys()])) {
    if (m0.get(id) !== m1.get(id)) throw new Error(`twinRatified: the two ratifications disagree on divergence '${id}' — matching selections are required to settle the bundle`)
  }
  return {
    terminal: 'RATIFIED',
    label: 'twin_ratified',
    signatures: sigs,
    verdicts: [rats[0].verdict, rats[1].verdict],
    ratifications: rats,
    artifact_hash: p.artifact_hash != null ? p.artifact_hash : (ctx.bundle_hash != null ? ctx.bundle_hash : null),
    decision_bundle_hash: p.decision_bundle_hash != null ? p.decision_bundle_hash : (ctx.bundle_hash != null ? ctx.bundle_hash : null),
    plan_hash: p.plan_hash != null ? p.plan_hash : (ctx.plan_hash != null ? ctx.plan_hash : null),
  }
}
function buildCheckpoint(fields) {
  const x = fields || {}
  return {
    kind: 'council_state',
    protocol_version: x.protocol_version != null ? x.protocol_version : null,
    template_hash: x.template_hash != null ? x.template_hash : null,
    run_token_hash: x.run_token_hash != null ? x.run_token_hash : null,
    initial_ledger_seq: x.initial_ledger_seq != null ? x.initial_ledger_seq : null,
    keystone_id: x.keystone_id != null ? x.keystone_id : null,
    phase: x.phase != null ? x.phase : null,
    decision_bundle_hash: x.decision_bundle_hash != null ? x.decision_bundle_hash : null,
    input_artifact_hashes: Array.isArray(x.input_artifact_hashes) ? x.input_artifact_hashes.slice() : [],
    evidence_manifest_hash: x.evidence_manifest_hash != null ? x.evidence_manifest_hash : null,
    anonymous_seat_artifact_hashes: x.anonymous_seat_artifact_hashes && typeof x.anonymous_seat_artifact_hashes === 'object' ? { ...x.anonymous_seat_artifact_hashes } : {},
    seat_provenance: x.seat_provenance && typeof x.seat_provenance === 'object' ? { ...x.seat_provenance } : {},
    codex_receipt_hash: x.codex_receipt_hash != null ? x.codex_receipt_hash : null,
    status: x.status != null ? x.status : null,
  }
}
const SHA64_RE = /^[0-9a-f]{64}$/
const RATIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400, description: 'optional, ≤50 words' },
    artifact_hash: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          finding_id: { type: 'string' }, claim: { type: 'string' }, required_change: { type: 'string' },
          evidence_refs: { type: 'array', items: { type: 'string' } },
          evidence_class: { type: 'string', enum: ['executed_check', 'proposed_check', 'repo_state', 'test_output', 'primary_source', 'scenario'], description: 'the HONEST class of this finding\'s evidence — the claim-scoped partial order rules reversals by it' },
          executable_check: { type: ['string', 'null'], description: 'a bounded shell command (EXIT 0 iff the defect is present) or null' },
          target_kind: { type: 'string', enum: ['settled_decision', 'trunk_field'], description: 'OPTIONAL (AMB-CLOSER-1.iii): the STRUCTURAL correction descriptor — an ACCEPTED BLOCK finding carrying { target_kind, key, replacement } amends the bundle mechanically; an ACCEPTED finding WITHOUT one is a gated escalation (no free rewrite)' },
          key: { type: 'string', description: 'OPTIONAL: an existing settled-decision topic or an amendable trunk field (present iff target_kind is)' },
          replacement: { description: 'OPTIONAL: the new value — must match the shape of the target\'s current value (present iff target_kind is)' },
        },
        required: ['finding_id', 'claim', 'required_change', 'evidence_refs', 'evidence_class', 'executable_check'],
      },
    },
    changed_evidence: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { finding_id: { type: 'string', description: 'the standing block this evidence retires — I9 one-finding-key rail: one evidence item can never clear two blocks' }, class: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } }, required: ['finding_id', 'class'] } },
    divergence_selections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { divergence_id: { type: 'string' }, selection: { type: 'string', enum: ['P0', 'P1', 'MERGED', 'NEITHER'] }, evidence_refs: { type: 'array', items: { type: 'string' } } }, required: ['divergence_id', 'selection'] } },
    verdict: { type: 'string', enum: ['APPROVE', 'BLOCK', 'NEITHER'] },
  },
  required: ['artifact_hash', 'verdict', 'divergence_selections', 'findings', 'changed_evidence'],
}
const envelopeSchema = (payload) => ({
  type: 'object',
  properties: { payload, codex_receipt: { type: 'object' }, raw_artifact_refs: { type: 'object' } },
  required: ['payload', 'codex_receipt'],
  additionalProperties: true,
})
const CROSS_CHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    output_sha256_disk: { type: 'string' },
    output_canonical_sha256: { type: 'string' },
    ledger: {
      type: 'object', additionalProperties: false,
      properties: {
        verified: {
          type: ['object', 'null'], additionalProperties: false,
          properties: {
            status: { type: ['string', 'null'] }, invocation_id: { type: ['string', 'null'] }, receipt_sha256: { type: ['string', 'null'] },
            output_sha256: { type: ['string', 'null'] }, session_id: { type: ['string', 'null'] }, reported_model: { type: ['string', 'null'] },
            tokens_used: { type: ['number', 'null'] }, exit_code: { type: ['number', 'null'] }, receipt_verified: { type: ['boolean', 'null'] },
          },
          required: ['status', 'invocation_id', 'receipt_sha256', 'output_sha256', 'session_id', 'reported_model', 'tokens_used', 'exit_code', 'receipt_verified'],
        },
        reservation: {
          type: ['object', 'null'], additionalProperties: false,
          properties: {
            invocation_id: { type: ['string', 'null'] }, keystone: { type: ['string', 'null'] }, phase: { type: ['string', 'null'] },
            seat: { type: ['string', 'null'] }, attempt: { type: ['number', 'null'] }, run_token: { type: ['string', 'null'] },
            prompt_sha256: { type: ['string', 'null'] }, packet_sha256: { type: ['string', 'null'] },
          },
          required: ['invocation_id', 'keystone', 'phase', 'seat', 'attempt', 'run_token', 'prompt_sha256', 'packet_sha256'],
        },
      },
      required: ['verified', 'reservation'],
    },
  },
  required: ['output_sha256_disk', 'output_canonical_sha256', 'ledger'],
}
const LEDGER_APPEND_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, appended: { type: 'boolean', description: 'true iff the append command exited 0' } },
  required: ['appended'],
}
const CANON_HASH_ONELINER = `const fs=require("fs"),crypto=require("crypto");const c=v=>v===null||typeof v!=="object"?JSON.stringify(v===undefined?null:v):Array.isArray(v)?"["+v.map(c).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+c(v[k])).join(",")+"}";const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(crypto.createHash("sha256").update(Buffer.from(c(p),"utf8")).digest("hex"))`
const LEDGER_EXTRACT_ONELINER = `const fs=require("fs");let L=[];try{L=fs.readFileSync(process.argv[1],"utf8").split("\\n").filter(Boolean).map(s=>JSON.parse(s))}catch(e){}const O=process.argv[2],S=process.argv[3];const pick=(o,ks)=>{const x={};for(const k of ks)x[k]=(o&&o[k]!==undefined)?o[k]:null;return x};const vs=L.filter(e=>e&&e.status==="verified"&&e.output_sha256===O&&e.session_id===S);const v=vs.length?vs[vs.length-1]:null;const rs=v?L.filter(e=>e&&e.status==="started"&&e.invocation_id===v.invocation_id):[];const r=rs.length?rs[rs.length-1]:null;process.stdout.write(JSON.stringify({verified:v?pick(v,["status","invocation_id","receipt_sha256","output_sha256","session_id","reported_model","tokens_used","exit_code","receipt_verified"]):null,reservation:r?pick(r,["invocation_id","keystone","phase","seat","attempt","run_token","prompt_sha256","packet_sha256"]):null}))`
function councilTemplateHash(parts) {
  return sha256Hex(canonicalJson(parts))
}
const seatProv = (sink, head) => ({
  head,
  requested_model: sink && sink.requested_model != null ? sink.requested_model : null,
  actual_model: sink && sink.actual_model != null ? sink.actual_model : null,
  receipt_verified: !!(sink && sink.receipt_verified),
  actual_transport_model: sink && sink.actual_transport_model != null ? sink.actual_transport_model : null,
  session_id: sink && sink.session_id != null ? sink.session_id : null,
})
function solWrapperPlan(cfg) {
  const c = cfg || {}
  const attempt = c.attempt || 1
  const base = `${c.councilDir}/${c.phaseTag}-sol-a${attempt}`
  const files = { prompt: `${base}.prompt`, packet: `${base}.packet`, schema: `${base}.schema`, out: `${base}.out`, stderr: `${base}.stderr` }
  const argv = `node ${c.pluginRoot}/scripts/kiln-codex-receipt.mjs ${files.prompt} ${c.transportModel} ${c.effort} ${files.packet} ${files.schema} ${files.out} ${files.stderr} ${c.receiptsLedger} ${c.runToken} ${c.keystone} ${c.phaseTag} sol ${attempt}`
  const label = c.extractLabel || 'plan'
  const field = c.extractField || 'plan_markdown'
  const extractStep = c.extractTo
    ? `3. Extract the ${label} MECHANICALLY from the ATTESTED output — run this EXACT command, verbatim (never retype ${label} content; the path arguments stay quoted):\n   node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],p.${field})' "${files.out}" "${c.extractTo}"\n`
    : `3. (No extraction — the attested payload IS the deliverable.)\n`
  const prompt =
    `You are the Sol transport wrapper — MECHANICS ONLY. You never author plan content or a verdict; you TRANSLATE a fixed brief into a codex prompt (per the codex-guide 4-part shape), run the receipt-bearing transport, and relay the attested result. You do not know the peer seat's identity.\n\n` +
    `<task>\n` +
    `1. Bash 'mkdir -p ${c.councilDir}'. Then WRITE three files (file tools):\n` +
    `   - ${files.prompt} — the codex prompt: TRANSLATE the fixed brief below into Goal / Context / Constraints / Done-when, instruction-first, plain markdown, no persona padding, reasoning-first per the schema. Demand the final message be ONE JSON object matching the schema. Include NONE of: a run token, a seed, a session id, the peer seat's identity — codex sees ONLY this prompt + packet.\n` +
    `   - ${files.packet} — this JSON, verbatim: ${JSON.stringify(c.packetObj)}\n` +
    `   - ${files.schema} — this payload schema, verbatim: ${JSON.stringify(c.payloadSchema)}\n` +
    `2. Run EXACTLY (Bash, foreground, generous timeout) — the raw run token belongs ONLY in this argv (a trusted process boundary), NEVER in a prompt or packet:\n   ${argv}\n   Exit 0 ⇒ its stdout IS the verified receipt JSON.\n` +
    extractStep +
    `4. Emit the envelope (StructuredOutput): payload = the ${files.out} JSON verbatim, codex_receipt = the transport's stdout receipt verbatim, raw_artifact_refs = { "stderr": "${files.stderr}", "output": "${files.out}" }. On ANY failure (nonzero exit, missing files), report the failure honestly with NO codex_receipt key — a dead Sol seat is never faked.\n` +
    `</task>\n\n` +
    `<fixed-brief>\n${c.taskText}\n\n${c.briefBody || ''}\n</fixed-brief>`
  return { files, argv, prompt }
}
function crossCheckOk(cc, binding) {
  const b = binding || {}
  const relayed = b.relayedOutputHash
  const canon = b.canonicalHash
  const sink = b.sink || {}
  const V = cc && cc.ledger ? cc.ledger.verified : null
  const R = cc && cc.ledger ? cc.ledger.reservation : null
  const ok =
    cc && cc.output_sha256_disk === relayed &&
    cc.output_canonical_sha256 === canon &&
    V && R &&
    V.status === 'verified' && V.receipt_verified === true &&
    V.output_sha256 === relayed &&
    V.session_id === (sink && sink.session_id) &&
    V.reported_model === (sink && sink.actual_transport_model) &&
    V.tokens_used === (sink && sink.tokens_used) &&
    V.exit_code === 0 &&
    typeof V.invocation_id === 'string' && SHA64_RE.test(V.invocation_id) &&
    typeof V.receipt_sha256 === 'string' && SHA64_RE.test(V.receipt_sha256) &&
    V.invocation_id === R.invocation_id &&
    R.keystone === b.keystone &&
    R.phase === b.phaseTag &&
    R.seat === b.seat &&
    R.attempt === b.attempt &&
    R.run_token === b.runToken &&
    R.prompt_sha256 === (sink && sink.prompt_hash)
  return ok
    ? { ok: true, codex_receipt_hash: V.receipt_sha256, invocation_id: V.invocation_id }
    : { ok: false, invocation_id: V && typeof V.invocation_id === 'string' && SHA64_RE.test(V.invocation_id) ? V.invocation_id : null, reason: 'invocation-exact cross-check mismatch — the ledger reservation/verified chain disagrees with this seat, the relayed receipt, or the payload' }
}
function assembleRatifyCertificate(parts) {
  const p = parts || {}
  const ctx = p.context || {}
  const bound = {
    bundle_hash: ctx.bundle_hash != null ? ctx.bundle_hash : null,
    renderer_version: ctx.renderer_version != null ? ctx.renderer_version : null,
    plan_hash: ctx.plan_hash != null ? ctx.plan_hash : null,
    evidence_manifest_hash: ctx.evidence_manifest_hash != null ? ctx.evidence_manifest_hash : null,
    protocol_version: ctx.protocol_version != null ? ctx.protocol_version : null,
  }
  const sigF = councilSignature({ ...bound, seat_provenance: p.provF })
  const sigS = councilSignature({ ...bound, seat_provenance: p.provS })
  try {
    const certificate = twinRatified({ signatures: [sigF, sigS], context: { ...bound, seat_provenance: null }, ratifications: [p.rF, p.rS], open_divergence_ids: [] })
    return { ok: true, certificate }
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : String(e) }
  }
}
function verdictShapeError(r) {
  if (!(r && (r.verdict === 'BLOCK' || r.verdict === 'NEITHER'))) return null
  const fs = Array.isArray(r.findings) ? r.findings : []
  if (!fs.length) return `${r.verdict} with no findings`
  const seen = new Set()
  for (const f of fs) {
    if (!f || typeof f.finding_id !== 'string' || !f.finding_id) return 'a finding without a finding_id'
    if (seen.has(f.finding_id)) return `duplicate finding_id '${f.finding_id}'`
    seen.add(f.finding_id)
    const hasRefs = Array.isArray(f.evidence_refs) && f.evidence_refs.length > 0
    const hasCheck = typeof f.executable_check === 'string' && f.executable_check.trim() !== ''
    if (!hasRefs && !hasCheck) return `finding '${f.finding_id}' is evidence-free (no refs, no check)`
  }
  return null
}

// ── Twin Council gating (B4-3 D4/D6). Vision's fidelity council goes council-grade ONLY when the
//    capability record promised BOTH heads (T4 = fable + codex) AND the conductor minted a runToken.
//    codexAvailable defaults true (tier T4 definitionally carries codex; normalizeArgs passes it through
//    when the conductor sends it). A PROMISED council missing its runToken fails CLOSED (terminal DEGRADED;
//    NEITHER seal event — never a silent v3.0.1 compile). runTokenRaw lives ONLY in the receipt-script argv. ──
const codexAvailable = A.codexAvailable !== false
const runTokenRaw = (typeof A.runToken === 'string' && A.runToken.length > 0) ? A.runToken : null
const capabilityTier = (A.capabilityTier === 'T1' || A.capabilityTier === 'T2' || A.capabilityTier === 'T3' || A.capabilityTier === 'T4') ? A.capabilityTier : null
const councilPromised = capabilityTier === 'T4' && codexAvailable
const councilCapable = councilPromised && runTokenRaw != null
const councilMisconfigured = councilPromised && runTokenRaw == null
if (councilMisconfigured) {
  log('MISCONFIGURED CONDUCTOR — capability tier T4 with both heads reachable but NO runToken: vision\'s fidelity council cannot bind its receipts/seed. The compile fidelity seal fails CLOSED (terminal DEGRADED; NEITHER vision_compiled nor stage_completed — never a silent v3.0.1 compile). Relaunch with the per-run token to convene the council.')
}
const councilDir = `${kilnDir}/council/vision`
const receiptsLedger = `${kilnDir}/council/receipts.jsonl`
const runTokenHash = runTokenRaw != null ? sha256Hex(runTokenRaw) : null
const COUNCIL_RENDERER_VISION = 'b43-vision/1'
// Fixed rubric/task (run-independent template hash). The pair rules COMPILE FIDELITY — never a quality
// re-review of the product idea.
const VISION_FIDELITY_RUBRIC =
  'Rule VISION FIDELITY: is VISION.md a FAITHFUL compile of the brainstorm session ledger — nothing ' +
  'INVENTED (no requirement, success criterion, or claim that is absent from the ledger), nothing DROPPED ' +
  '(every operator-attributed idea/theme/decision the ledger carries is represented), operator meaning ' +
  'preserved? This is the COMPILE-FIDELITY question ONLY — NOT a quality/ambition re-review of the product ' +
  'idea; you rule the compile, not the vision\'s merit. Every finding MUST cite the ledger entry (or the ' +
  'exact invented line) it turns on.'
const VISION_FIDELITY_TASK =
  'Render one blind verdict — APPROVE (VISION.md is a faithful compile of the ledger), BLOCK, or NEITHER — ' +
  'on the vision fidelity against the rubric. You do not know who else is ruling. divergence_selections is ' +
  '[] (no open divergences). Echo artifact_hash EXACTLY as given. A BLOCK or NEITHER MUST carry at least one ' +
  'evidence-bound finding (finding_id unique, nonempty evidence_refs or a real executable_check); an ' +
  'evidence-free verdict is invalid. changed_evidence is [] unless you reverse a prior block.'
const councilTemplateHashVision = councilTemplateHash({ rubric: VISION_FIDELITY_RUBRIC, ruling_task: VISION_FIDELITY_TASK, renderer: COUNCIL_RENDERER_VISION })
// EVIDENCE_ANCHOR_SCHEMA / evidenceAnchorPrompt — the b42 anchor: hash the NAMED artifacts into a
// {path, sha256} manifest; a dead/partial anchor ⇒ DEGRADED (the certificate never binds unhashed names).
const EVIDENCE_ANCHOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, sha256: { type: 'string' } }, required: ['path', 'sha256'] } } },
  required: ['files'],
}
const evidenceAnchorPrompt = (inputs) =>
  `You are Thoth, the scribe — transcribe hashes, never judge, never fix.\n\n` +
  `<task>Run (Bash): 'sha256sum ${inputs.join(' ')}'. Transcribe each input file's sha256 into files[] as {path, sha256} (VERBATIM, lowercase hex, the path exactly as given). Do not read file contents, do not write or fix anything.</task>`
const crossCheckPrompt = (outFile, outputSha, sessionId) =>
  `You are Thoth, the receipt cross-checker — transcribe, never compose, never judge. Run these three EXACT commands (Bash) and transcribe their output.\n\n` +
  `<task>\n` +
  `1. run EXACTLY: sha256sum "${outFile}" — output_sha256_disk = the 64-hex digest (the first field only).\n` +
  `2. run EXACTLY: node -e '${CANON_HASH_ONELINER}' "${outFile}" — output_canonical_sha256 = its stdout (a 64-hex digest).\n` +
  `3. run EXACTLY: node -e '${LEDGER_EXTRACT_ONELINER}' "${receiptsLedger}" "${outputSha}" "${sessionId}" — ledger = the { verified, reservation } JSON it prints.\n` +
  `Emit output_sha256_disk, output_canonical_sha256, and the ledger object. Do not read the files for content, do not write or fix anything.</task>`
const runSolCrossCheck = async (legLabel, keystone, phaseTag, outFile, sink, payload, phaseName) => {
  const canon = sha256Hex(canonicalJson(payload))
  const relayed = sink && sink.output_hash
  const dispatch = () => agent(crossCheckPrompt(outFile, relayed, sink && sink.session_id), { label: `thoth:receipt-check:${legLabel}`, phase: phaseName, model: 'haiku', schema: CROSS_CHECK_SCHEMA })
  let cc = await dispatch()
  if (!(cc && cc.ledger)) cc = await dispatch()
  if (!(cc && cc.ledger)) return { ledger_verified: false, reason: 'cross-check leg produced no ledger extract' }
  const res = crossCheckOk(cc, { relayedOutputHash: relayed, canonicalHash: canon, sink, keystone, phaseTag, seat: 'sol', attempt: 1, runToken: runTokenRaw })
  return res.ok
    ? { ledger_verified: true, codex_receipt_hash: res.codex_receipt_hash, invocation_id: res.invocation_id }
    : { ledger_verified: false, invocation_id: res.invocation_id, reason: res.reason }
}
const councilReceipts = []
const pushCouncilReceipt = (bucket, leg, sink, cross) => bucket.push({
  leg, invocation_id: cross && cross.invocation_id ? cross.invocation_id : null,
  receipt_verified: !!(sink && sink.receipt_verified), ledger_verified: !!(cross && cross.ledger_verified),
  session_id: sink && sink.session_id != null ? sink.session_id : null, tokens_used: sink && sink.tokens_used != null ? sink.tokens_used : null,
})
const councilCheckpoint = async (fields, phaseName) => {
  try { await runLedger('note', buildCheckpoint(fields), phaseName) }
  catch (e) { log(`council checkpoint ${fields && fields.phase} not ledgered (non-fatal): ${e && e.message ? e.message : e}`) }
}
const councilRuling = async (data, phaseName) => {
  try { await runLedger('note', { kind: 'council_ruling', ...data }, phaseName) }
  catch (e) { log(`council ruling not ledgered (non-fatal): ${e && e.message ? e.message : e}`) }
}
// runBlindPair — Fable ∥ receipt-attested Sol rule blind over a schema (xhigh, council-grade — D6).
const runBlindPair = async (cfg) => {
  const sinkF = {}, sinkS = {}
  const plan = solWrapperPlan({ councilDir, pluginRoot, receiptsLedger, runToken: runTokenRaw, keystone: cfg.keystone, transportModel: CODEX_MODEL, phaseTag: cfg.phaseTag, attempt: 1, effort: 'xhigh', payloadSchema: cfg.schema, taskText: cfg.solTaskText, briefBody: cfg.solBrief, packetObj: cfg.solPacket })
  const [rF, rS] = await parallel([
    () => gateAgent(cfg.fablePrompt, { label: `fable:${cfg.legName}`, phase: cfg.phaseName, model: 'fable', effort: 'xhigh', twoHeads: 'required', schema: cfg.schema, provenance: sinkF }),
    () => gateAgent(plan.prompt, { label: `sol:${cfg.legName}`, phase: cfg.phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(cfg.schema), provenance: sinkS }),
  ])
  let solCross = { ledger_verified: false }
  if (rS != null && sinkS.receipt_verified === true) solCross = await runSolCrossCheck(`sol:${cfg.legName}`, cfg.keystone, cfg.phaseTag, plan.files.out, sinkS, rS, cfg.phaseName)
  pushCouncilReceipt(councilReceipts, `sol:${cfg.legName}`, sinkS, solCross)
  const solOk = rS != null && sinkS.receipt_verified === true && solCross.ledger_verified === true
  if (rF == null || !solOk) {
    const missing = rF == null && !solOk ? 'both' : (rF == null ? 'fable' : 'sol')
    return { degraded: true, missing, rF, rS, sinkF, sinkS, solCross }
  }
  return { degraded: false, rF, rS, sinkF, sinkS, solCross }
}
// runVisionFidelity (D4) — the REQUIRED blind fidelity pair over {VISION.md hash, ledger hash, validator
// verdict}. Dual-APPROVE ⇒ RATIFIED (the caller fires both seal events + rides the certificate); ANY other
// outcome ⇒ a non-RATIFIED terminal and the caller fires NEITHER seal event (the existing invalid-VISION
// escalation shape). The compile is FROZEN — the council rules it, never re-authors VISION.md.
const runVisionFidelity = async (vSummary) => {
  const phaseName = 'The Seal'
  const keystone = 'vision_fidelity'
  const phaseTag = 'VISION_RATIFY'
  const namedEvidence = [visionFile, ledgerFile]
  const anchor = await agent(evidenceAnchorPrompt(namedEvidence), { label: 'thoth:vision-anchor', phase: phaseName, model: 'haiku', schema: EVIDENCE_ANCHOR_SCHEMA })
  const anchorFiles = (anchor && Array.isArray(anchor.files)) ? anchor.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : []
  const anchorPaths = anchorFiles.map((f) => f.path)
  const anchorExact =
    anchor && Array.isArray(anchor.files) && anchorFiles.length === anchor.files.length &&
    anchorFiles.length === namedEvidence.length &&
    new Set(anchorPaths).size === anchorFiles.length &&
    namedEvidence.every((p) => anchorPaths.includes(p))
  if (!anchorExact) {
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashVision, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'evidence' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'evidence-anchor' }, phaseName)
    log('vision fidelity evidence anchor DEGRADED — NEITHER seal event fires (the certificate must never bind unhashed names)')
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null, receipt_verified: false, ledger_verified: false }
  }
  const manifest = {}
  for (const f of anchorFiles) manifest[f.path] = f.sha256
  const evidenceRefs = Object.keys(manifest).sort().map((p) => ({ path: p, sha256: manifest[p] }))
  const evidenceManifestHash = sha256Hex(canonicalJson(manifest))
  const evidenceInputHashes = Object.keys(manifest).sort().map((k) => manifest[k])
  const s = vSummary || {}
  const record = {
    vision_sha256: manifest[visionFile] != null ? manifest[visionFile] : null,
    ledger_sha256: manifest[ledgerFile] != null ? manifest[ledgerFile] : null,
    validator: { tier: s.tier != null ? s.tier : null, counts: s.counts != null ? s.counts : null, unresolved: s.unresolved != null ? s.unresolved : null },
    evidence_refs: evidenceRefs,
  }
  const bundleHash = sha256Hex(canonicalJson(record))
  const ckptBase = { protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashVision, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, decision_bundle_hash: bundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash }
  const recordJson = JSON.stringify(record)
  const ratifyInputs =
    `<inputs>\n- VISION.md (the compiled artifact under fidelity ruling): ${visionFile}.\n` +
    `- The brainstorm session ledger (the SOLE source VISION.md must faithfully compile): ${ledgerFile}.\n` +
    `- The COMPLETE frozen fidelity record you are ratifying (evidence_refs bind VISION.md + the ledger to their sha256):\n${recordJson}\n` +
    `- Read both files (read-only), confirm each evidence_refs path matches its bound hash, then rule whether VISION.md is a faithful compile of the ledger.\n</inputs>`
  const bindingLine = `Binding: artifact_hash = "${bundleHash}" (echo it VERBATIM). divergence_selections = [] (no open divergences this round). changed_evidence = [] unless you reverse a prior block.`
  const fablePrompt =
    `You are a council ratifier (vision fidelity) — rule whether VISION.md faithfully compiles the session ledger against the fixed rubric, blind and independent. You do not know who else is ruling.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${VISION_FIDELITY_RUBRIC}\n</rubric>\n\n<binding>\n${bindingLine}\n</binding>\n\n` +
    `<task>${VISION_FIDELITY_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const solBrief = `${bindingLine}\nRubric:\n${VISION_FIDELITY_RUBRIC}\nRule read-only: compare ${visionFile} against the session ledger NAMED in the record's evidence_refs (each bound to its sha256). Rule COMPILE FIDELITY only, never the product's merit.`
  const pair = await runBlindPair({ keystone, phaseTag, legName: 'vision-fidelity', fablePrompt, solTaskText: VISION_FIDELITY_TASK, solBrief, solPacket: { fidelity_record: record, artifact_hash: bundleHash }, schema: RATIFY_SCHEMA, phaseName })
  const seatHashes = (rF, rS) => ({ P0: sha256Hex(canonicalJson(rF)), P1: sha256Hex(canonicalJson(rS)) })
  if (pair.degraded) {
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: pair.missing }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing: pair.missing }, phaseName)
    log(`vision fidelity council DEGRADED (${pair.missing}) — NEITHER seal event fires (never a single-head ruling)`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, receipt_verified: !!(pair.sinkS && pair.sinkS.receipt_verified), ledger_verified: !!(pair.solCross && pair.solCross.ledger_verified) }
  }
  const vF = validateRatification(pair.rF, { bundle_hash: bundleHash, open_divergence_ids: [] })
  const vS = validateRatification(pair.rS, { bundle_hash: bundleHash, open_divergence_ids: [] })
  const shapeF = verdictShapeError(pair.rF), shapeS = verdictShapeError(pair.rS)
  const fBad = !vF.valid || !!shapeF, sBad = !vS.valid || !!shapeS
  if (fBad || sBad) {
    const missing = fBad && sBad ? 'both' : (fBad ? 'fable' : 'sol')
    const detail = [fBad ? `fable${shapeF ? `: ${shapeF}` : ''}` : null, sBad ? `sol${shapeS ? `: ${shapeS}` : ''}` : null].filter(Boolean).join('; ')
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing, reason: 'invalid ratification' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing, invalid: { fable: fBad, sol: sBad } }, phaseName)
    log(`vision fidelity ratification INVALID (${detail}) — DEGRADED (never mislabeled BLOCKED); NEITHER seal event fires`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
  }
  if (pair.rF.verdict === 'APPROVE' && pair.rS.verdict === 'APPROVE') {
    const cert = assembleRatifyCertificate({ rF: pair.rF, rS: pair.rS, provF: seatProv(pair.sinkF, 'fable'), provS: seatProv(pair.sinkS, 'sol'), context: { bundle_hash: bundleHash, renderer_version: COUNCIL_RENDERER_VISION, plan_hash: bundleHash, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null } })
    if (!cert.ok) {
      await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { reason: 'certificate defect' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
      await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'certificate defect' }, phaseName)
      log(`vision fidelity certificate could not seal (${cert.reason}) — DEGRADED; NEITHER seal event fires`)
      return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
    }
    await councilCheckpoint({ ...ckptBase, phase: 'VISION_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
    await councilCheckpoint({ ...ckptBase, phase: 'RATIFIED', anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'RATIFIED', bundle_hash: bundleHash }, phaseName)
    log(`TWIN COUNCIL RATIFIED the vision fidelity (bundle ${String(bundleHash).slice(0, 12)}…) — the compile carries two valid head signatures`)
    return { terminal: 'RATIFIED', certificate: cert.certificate, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
  }
  const frozen = [...(pair.rF.verdict === 'BLOCK' || pair.rF.verdict === 'NEITHER' ? (Array.isArray(pair.rF.findings) ? pair.rF.findings : []) : []), ...(pair.rS.verdict === 'BLOCK' || pair.rS.verdict === 'NEITHER' ? (Array.isArray(pair.rS.findings) ? pair.rS.findings : []) : [])]
  await councilCheckpoint({ ...ckptBase, phase: 'VISION_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  await councilRuling({ keystone, phase: phaseTag, terminal: 'BLOCKED', verdicts: { fable: pair.rF.verdict, sol: pair.rS.verdict } }, phaseName)
  log(`vision fidelity council BLOCKED (fable ${pair.rF.verdict}, sol ${pair.rS.verdict}) — NEITHER seal event fires; ${frozen.length} finding(s) frozen onto the records`)
  return { terminal: 'BLOCKED', certificate: null, findings: frozen, bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
}

// SPIN flattened to the two staged worker-tree lines (C1 §6, called 0/1): 'The ledger holds every
// word' is promoted to the vision.gate_clean beat and 'A vision is counted before it is trusted' to
// the vision.sealed keystone's texture, so neither rots behind a dead index.
const SPIN = ['Nothing enters the vision that the operator did not say', 'The compiler reads the session, never the chat']
const spin = (i) => SPIN[((i % SPIN.length) + SPIN.length) % SPIN.length]

// ── The run ledger (BLUEPRINT §3.5): stage brackets + vision_compiled land in events.jsonl via
//    the kiln-state CLI. Thoth appends; gated on pluginRoot and degrades to a log line — an
//    append failure never fails the stage (unlike the VISION gate itself, which is load-bearing). ──
async function runLedger(type, data, phaseName) {
  if (!pluginRoot) { log(`pluginRoot absent — ${type} not ledgered to events.jsonl`); return }
  const ev = JSON.stringify({ type, stage: 'brainstorm', data })
  await agent(
    `You are Thoth, the scribe — "write it down or it never happened". Append ONE event to the Kiln run ledger.\n\n` +
    `<task>Run this exact command (Bash), substituting the JSON verbatim — do not edit it:\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-state.mjs append ${kilnDir} '${ev.replace(/'/g, `'\\''`)}'\n` +
    '```\n' +
    `If it exits non-zero (e.g. no events.jsonl yet — the run was not initialised), report the error in your summary; do NOT create or repair any file. Report only whether the append succeeded.</task>`,
    { label: 'thoth:ledger', phase: phaseName, model: 'haiku' }
  )
}

// ── Lore beats (C1 doctrine §4): a dispatch from inside the fire — one line at the moment a fact
//    becomes true, carried by runLedger to the operator's transcript between the banners (note{kind:
//    'lore'}; deterministic <stage>.<beat> key; args are short scalars capped at 80 by the caller;
//    text ≤ 160). PRESENTATION, null-keep: pluginRoot absent ⇒ a plain log() line, never a failure. ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE (F-1): every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? runLedger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

// ── the kiln-vision transcript schema — Thoth transcribes the CLI's --json verdict VERBATIM ──────
// One shape for BOTH commands (the CLI prints the same payload family); every field required so a
// schema-legal scribe can never drop the violations the revise loop feeds on (the P3.6 discipline).
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    exit: { type: 'number', description: 'the kiln-vision process exit code' },
    valid: { type: 'boolean', description: "the payload's valid field (false when the command died without JSON)" },
    violations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { code: { type: 'string' }, path: { type: 'string' }, message: { type: 'string' } },
        required: ['code', 'path', 'message'],
      },
      description: 'the typed violations, transcribed VERBATIM — empty when valid (or when the command itself died)',
    },
    summary: { type: 'string', description: "the payload's summary object as a JSON string, verbatim; '' when the command died" },
    error: { type: 'string', description: 'verbatim stderr when the command itself failed (nonzero without JSON); empty otherwise' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['exit', 'valid', 'violations', 'summary', 'error'],
}
const gatePrompt = (cmd, file) =>
  `You are Thoth, the scribe — transcribe, never judge, never fix.\n\n` +
  `<task>Run (Bash): node ${pluginRoot}/scripts/kiln-vision.mjs ${cmd} ${file} --json\n` +
  `It prints ONE JSON object {schema, valid, violations, summary} on stdout whichever way the ` +
  `verdict goes (an infra failure dies to stderr with no JSON instead). Transcribe valid and ` +
  `violations VERBATIM, summary as the JSON string of the summary object, and exit = the process ` +
  `exit code. If the command itself failed (nonzero, no JSON), report exit, valid=false, empty ` +
  `violations, empty summary, and its stderr verbatim in error. Do not edit or fix anything.</task>`
const parseSummary = (r) => { try { return JSON.parse(r.summary) } catch { return null } }

// ═══════════════════════════════════════ The Gate ═══════════════════════════════════════════════
phase('The Gate')
log(spin(0))

// stage_started on EVERY entry — re-entry is accurate (the compile leg is the brainstorm stage's
// tail; a re-run after a failed gate is the stage still in progress). Ordering (P4 r1 F5): this
// bracket precedes every other event this workflow appends.
await runLedger('stage_started', { leg: 'vision-compile' }, 'The Gate')

if (!pluginRoot) {
  log('VISION CANNOT COMPILE — pluginRoot absent, the kiln-vision gate CLI cannot be located. Fix: relaunch with args.pluginRoot = the absolute $PLUGIN_ROOT the conductor resolved at onboarding (${CLAUDE_PLUGIN_ROOT} is unset inside a launched Workflow). A gateless compile is self-graded homework.')
  return { vision_valid: false, vision_file: visionFile, reason: 'pluginRoot absent — the kiln-vision gate CLI is load-bearing for this leg', violations: [] }
}

const gate = await agent(gatePrompt('ledger-gate', ledgerFile), { label: 'thoth:ledger-gate', phase: 'The Gate', model: 'sonnet', schema: GATE_SCHEMA })
// Fail CLOSED: a dead scribe, a dead command, or a refusing gate all block the compile. The typed
// violations ride the return — the conductor's escalation payload names exactly what the session
// still owes (an incomplete ledger can never compile, whoever launched this workflow).
if (!(gate && gate.exit === 0 && gate.valid === true)) {
  const why = gate
    ? (gate.violations.length ? `the session ledger is incomplete: ${gate.violations.map((v) => v.code).join(', ')}` : `ledger-gate failed — ${gate.error || `exit ${gate.exit}`}`)
    : 'the gate scribe produced no report'
  log(`THE LEDGER GATE REFUSED — ${why}. No compiler spawns against an incomplete session.`)
  await lore('vision.gate_refused', `The ledger gate refused — ${oneLine(why, 80)}; no compiler spawns against an incomplete session`, { reason: oneLine(why, 80) }, 'The Gate')
  return { vision_valid: false, vision_file: visionFile, reason: why, violations: (gate && gate.violations) || [] }
}
const gateSummary = parseSummary(gate) || {}
log(`Ledger gate clean: ${gateSummary.events ?? '?'} events, ${gateSummary.ideas ?? '?'} idea(s), tier ${gateSummary.tier ?? 'unknown'}${gateSummary.express ? ' (express)' : ''}`)
// vision.gate_clean (promoted §6): the ledger held — the mechanical pre-compile floor is clean.
await lore('vision.gate_clean', `The ledger holds every word — ${gateSummary.events ?? '?'} events, ${gateSummary.ideas ?? '?'} idea(s), tier ${gateSummary.tier ?? 'unknown'}`, { events: gateSummary.events ?? null, ideas: gateSummary.ideas ?? null, tier: gateSummary.tier ?? null }, 'The Gate')

// ═══════════════════════════════════ The Compilation ════════════════════════════════════════════
phase('The Compilation')
log(spin(1))

// The compiler brief is the traceability contract (§10 change 5): SOLE source = the session
// ledger + the format template. It never sees the conversation — an idea absent from the ledger
// cannot reach the vision, which turns "every idea traces to the operator" from a vibe into a
// structural property. Opus seat: the VISION is the cross-stage contract every downstream stage
// plans against; compilation fidelity is worth the workhorse.
const compileBrief =
  voice('opus') +
  `You are the vision compiler — a fresh context, deliberately: your ONLY sources are the two ` +
  `files below. You compile; you never invent. An entry absent from the ledger does not exist.\n\n` +
  `<inputs>\n` +
  `- The brainstorm session ledger (append-only JSONL, the canonical record): ${ledgerFile}\n` +
  `- The VISION v3 format template (structure + line grammars + frontmatter shape): ${pluginRoot}/templates/VISION.md\n` +
  `</inputs>\n\n` +
  `<task>Write ${visionFile} (the Write tool, whole file) — the VISION v3 document compiled from ` +
  `the ledger:\n` +
  `1. Every section's content comes from its approved section_intent entries plus the ideas/` +
  `themes/decisions the ledger attributes to the operator. The three DERIVED sections compile ` +
  `directly from events: Open Questions from unresolved-but-acknowledged clarifications and any ` +
  `question-shaped decisions (each an OQ entry in BOTH the frontmatter list — with priority/` +
  `timing/context — and the body mirror), Assumptions Ledger from assumption events (- **A-N**: ` +
  `entries), Elicitation Log from the DISTINCT data.method fields across the theme/decision/` +
  `style_probe/clarify_pass events plus the style_probe/clarify_pass trail (T3 ruling 2 — the ` +
  `methods the session actually used; an unlogged method never happened).\n` +
  `2. The frontmatter is arithmetic you compute from what you write: status: gated (the ledger ` +
  `passed its gate; zero [NEEDS CLARIFICATION markers may remain — acknowledged unknowns are ` +
  `assumptions or OQs now), tier from session_meta, session.ideas = the ledger's idea count, ` +
  `visual_direction true only when the Visual Direction intent carries real content (a declined ` +
  `probe compiles to the exact decline line the template shows, with visual_direction: false), ` +
  `every counts.* equal to the grammar lines you actually wrote.\n` +
  `3. Follow the template's line grammars EXACTLY (- **FR-N**:, - **SC-N**:, - **S-N (P1)**:, ` +
  `- **A-N**:, - **OQ-N**:) — a validator counts them mechanically. All 16 section titles, ` +
  `byte-stable, each exactly once. No HTML comments in your output — those are template ` +
  `scaffolding.\n` +
  `Emit written and counts (the counts you wrote) FIRST; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
const COMPILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    written: { type: 'boolean', description: 'VISION.md was written to disk' },
    counts: { type: 'string', description: 'the counts object you wrote into the frontmatter, as a JSON string' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['written', 'counts'],
}

// Bounded like the Law's revise loop: 3 validator passes / ≤2 compiler revisions. VISION.md is
// DERIVED (r1 F5): a re-run recompiles from scratch; a partial or invalid file left on disk is
// harmless — the next pass overwrites it, and nothing downstream reads an ungated VISION.
const COMPILE_PASSES = 3
let verdict = null
let compiled = await agent(compileBrief, { label: 'aristotle:compile', phase: 'The Compilation', model: 'opus', schema: COMPILE_SCHEMA })
for (let round = 0; round < COMPILE_PASSES; round++) {
  if (!(compiled && compiled.written === true)) {
    log('THE COMPILER PRODUCED NO FILE — vision_valid:false; the conductor must escalate.')
    return { vision_valid: false, vision_file: visionFile, reason: 'the compiler produced no file', violations: [] }
  }
  verdict = await agent(gatePrompt('validate', visionFile), { label: `thoth:validate:r${round}`, phase: 'The Compilation', model: 'sonnet', schema: GATE_SCHEMA })
  if (!verdict) {
    log('THE VALIDATE SCRIBE PRODUCED NO REPORT — vision_valid:false (a dead gate is a blocked gate, never a shrug).')
    return { vision_valid: false, vision_file: visionFile, reason: 'the validate scribe produced no report', violations: [] }
  }
  // An INFRA-failed validate (the command died: nonzero exit, NO typed violations) is not a
  // fixable artifact defect — revising against no violations is wasted work and a lying reason
  // (T2 review r1). A genuine invalid artifact always carries typed violations at exit 1; a dead
  // command carries none. Fail CLOSED with the command's own error.
  if (verdict.exit !== 0 && verdict.violations.length === 0) {
    log(`THE VALIDATE COMMAND ITSELF FAILED — ${verdict.error || `exit ${verdict.exit}`}; vision_valid:false (an infra failure is never a revise trigger).`)
    return { vision_valid: false, vision_file: visionFile, reason: `validate command failed — ${verdict.error || `exit ${verdict.exit}`}`, violations: [] }
  }
  if (verdict.exit === 0 && verdict.valid === true) break
  if (round === COMPILE_PASSES - 1) {
    log(`VISION STILL INVALID after ${COMPILE_PASSES} validator pass(es): ${verdict.violations.map((v) => v.code).join(', ') || verdict.error || `exit ${verdict.exit}`}. Neither vision_compiled nor stage_completed is ledgered — the conductor escalates with the typed violations.`)
    return { vision_valid: false, vision_file: visionFile, reason: `invalid after ${COMPILE_PASSES} passes`, violations: verdict.violations }
  }
  log(`Validator: ${verdict.violations.length} violation(s) [${verdict.violations.map((v) => v.code).join(', ')}] — compiler revision ${round + 1}`)
  await lore('vision.violations', `Vision invalid — ${verdict.violations.length} violation(s) [${oneLine(verdict.violations.map((v) => v.code).join(', '), 80)}]; compiler revision ${round + 1}`, { violations: verdict.violations.length, round: round + 1 }, 'The Compilation')
  compiled = await agent(
    voice('opus') +
    `You are the vision compiler — revising YOUR OWN output. The validator refused ${visionFile}; ` +
    `its typed violations are below. Your sources are unchanged: the ledger + the template — you ` +
    `still never invent content.\n\n` +
    `<inputs>\nViolations (typed, verbatim from kiln-vision):\n` +
    verdict.violations.map((v) => `- [${v.code}] ${v.path}: ${v.message}`).join('\n') + `\n` +
    `The ledger: ${ledgerFile}. The template: ${pluginRoot}/templates/VISION.md. The file to fix: ${visionFile}.\n</inputs>\n\n` +
    `<task>Fix EXACTLY the named violations in ${visionFile} — recompute the frontmatter ` +
    `arithmetic from what the body actually carries, never bend the body to dodge a count. ` +
    `Emit written and the corrected counts FIRST; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
    { label: `aristotle:compile-revise:r${round + 1}`, phase: 'The Compilation', model: 'opus', schema: COMPILE_SCHEMA }
  )
}

// ═══════════════════════════════════════ The Seal ═══════════════════════════════════════════════
phase('The Seal')
const vSummary = parseSummary(verdict) || {}
// The existence/status belt: the validator already read the file, but the verdict that leaves
// this workflow is checked by a fresh pair of eyes, never taken from the transcript alone.
const proof = await agent(
  `You are the artifact existence verifier.\n\n` +
  `<task>Run 'ls ${visionFile}' (Bash). Return exists = true iff the file exists. Do not read, write, or fix anything.</task>`,
  { label: 'thoth:verify', phase: 'The Seal', model: 'haiku', schema: { type: 'object', additionalProperties: false, properties: { exists: { type: 'boolean' }, reasoning: { type: 'string', maxLength: 700 } }, required: ['exists'] } }
)
if (!(proof && proof.exists === true)) {
  log('THE SEAL FAILED — the validated VISION is not on disk (a vanished artifact is a failed compile).')
  return { vision_valid: false, vision_file: visionFile, reason: 'validated but missing on disk', violations: [] }
}

// ── D4: the T4 fidelity pair — between the mechanical existence/validator checks and the seal events.
//    Dual-APPROVE ⇒ vision_compiled THEN stage_completed fire (order preserved) + the certificate rides
//    the return; ANY other outcome ⇒ NEITHER event (the existing invalid-VISION escalation shape — the
//    conductor escalates with the honest terminal). Sub-T4 / no-codex / tokenless: byte-preserved (no
//    council convened). Promised-but-tokenless: fail-closed DEGRADED, NEITHER seal event. ──
let visionCouncilTerminal = null, visionCouncilCertificate = null, visionCouncilBundleHash = null, visionCouncilReceiptVerified = false, visionCouncilLedgerVerified = false
if (councilCapable) {
  const cr = await runVisionFidelity(vSummary)
  visionCouncilTerminal = cr.terminal; visionCouncilCertificate = cr.certificate; visionCouncilBundleHash = cr.bundle_hash
  visionCouncilReceiptVerified = cr.receipt_verified; visionCouncilLedgerVerified = cr.ledger_verified
  if (cr.terminal !== 'RATIFIED') {
    log(`VISION FIDELITY ${cr.terminal} — neither vision_compiled nor stage_completed is ledgered; the conductor escalates with the honest terminal (required-mode uniformity).`)
    await lore('vision.violations', `Vision fidelity ${cr.terminal} — the compile is not sealed as faithful; ${cr.findings.length} finding(s), the conductor escalates`, { terminal: cr.terminal, findings: cr.findings.length }, 'The Seal')
    // B43-2: the return IS the boundary record for vision — the b42-mirrored per-seat summary rides it
    // alongside the terminal/certificate/findings fields (build.js councilSeats precedent).
    return { vision_valid: false, vision_file: visionFile, reason: `vision fidelity council ${cr.terminal}`, violations: [], council: { seat: 'vision_fidelity', terminal: cr.terminal, certificate: null, findings: cr.findings, bundle_hash: cr.bundle_hash, receipts: councilReceipts, certificate_present: false, receipt_verified: cr.receipt_verified, ledger_verified: cr.ledger_verified } }
  }
} else if (councilMisconfigured) {
  visionCouncilTerminal = 'DEGRADED'
  await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashVision, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: 'vision_fidelity', phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'both', reason: 'runToken absent' }, codex_receipt_hash: null, status: 'sealed' }, 'The Seal')
  await councilRuling({ keystone: 'vision_fidelity', phase: 'VISION_RATIFY', terminal: 'DEGRADED', reason: 'runToken absent' }, 'The Seal')
  log('VISION FIDELITY PROMISED (T4 + codex) but NO runToken (misconfigured conductor) — fail-closed DEGRADED; NEITHER vision_compiled nor stage_completed. Relaunch with the per-run token.')
  await lore('vision.violations', 'Vision fidelity DEGRADED — promised council with no runToken; the compile is not sealed, the conductor escalates', { terminal: 'DEGRADED', findings: 0 }, 'The Seal')
  return { vision_valid: false, vision_file: visionFile, reason: 'vision fidelity council PROMISED but no runToken — fail-closed DEGRADED', violations: [], council: { seat: 'vision_fidelity', terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null, receipts: councilReceipts, certificate_present: false, receipt_verified: false, ledger_verified: false } }
}

// Ordering (r1 F5): vision_compiled THEN stage_completed — and ONLY here, on the clean (T4: RATIFIED) path.
await runLedger('vision_compiled', { tier: vSummary.tier ?? null, counts: vSummary.counts ?? null, visual_direction: vSummary.visual_direction ?? null, unresolved: vSummary.unresolved ?? null }, 'The Seal')
// vision.sealed (keystone): the seal succeeded — the vision is counted before it is trusted. Emit
// BEFORE stage_completed so the beat renders before the telegraph's terminating completion event.
await lore('vision.sealed', `Counted before trusted — the vision seals at tier ${vSummary.tier ?? 'unknown'}, visual direction ${vSummary.visual_direction === true ? 'present' : 'declined'}`, { tier: vSummary.tier ?? null, visual_direction: vSummary.visual_direction === true ? 'present' : 'declined' }, 'The Seal')
await runLedger('stage_completed', {}, 'The Seal')
log(`The vision is compiled and gated: tier ${vSummary.tier ?? 'unknown'}, visual direction ${vSummary.visual_direction === true ? 'present' : 'declined'} — the brainstorm stage completes`)

return {
  vision_valid: true,
  vision_file: visionFile,
  tier: vSummary.tier ?? null,
  counts: vSummary.counts ?? null,
  unresolved: vSummary.unresolved ?? 0,
  // The conductor threads this into the architecture launch args (P4 r1 F6) — the mechanical
  // visual-direction path end-to-end; the foundation agent's judgment is only the pre-v3 fallback.
  visual_direction: vSummary.visual_direction ?? null,
  // D6/B43-2: the additive council field — the T4 fidelity terminal + certificate (twin_ratified only with
  // a cert) PLUS the b42-mirrored per-seat summary {seat, certificate_present, receipt_verified, ledger_verified}.
  ...(councilPromised ? { council: { seat: 'vision_fidelity', terminal: visionCouncilTerminal, certificate: visionCouncilCertificate, findings: [], bundle_hash: visionCouncilBundleHash, receipts: councilReceipts, certificate_present: visionCouncilCertificate != null, receipt_verified: visionCouncilReceiptVerified, ledger_verified: visionCouncilLedgerVerified } } : {}),
}
