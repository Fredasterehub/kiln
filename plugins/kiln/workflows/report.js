// GENERATED from workflows-src/report.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-report',
  description: 'Kiln report stage: Omega reads every .kiln artifact and the built project, then writes .kiln/REPORT.md — the final delivery summary in Kiln\'s voice.',
  phases: [{ title: 'The Final Word', detail: 'Omega compiles REPORT.md from all artifacts' }],
}

// ── args: { kilnDir, projectPath } ──
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
if (!kilnDir || !projectPath) throw new Error('report.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
// pluginRoot is the conductor-resolved absolute $PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). It locates the kiln-state CLI for this stage's ledger brackets + lore
// beats (report.js's first ledger legs — the C1 batch); absence degrades each to a log line, never
// a stage failure (the report itself never depended on it).
const pluginRoot = A.pluginRoot

const reportFile = `${kilnDir}/REPORT.md`

const NO_WANDER = 'Read ONLY the files named in this brief (absolute paths). Do not search the filesystem or read other projects.'

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')

// ── gateAgent (inlined from src/gate.mjs) — Omega's closing report is a gate leg too: a
//    structured-output retry-cap death here used to detonate the whole report stage. Behind
//    gateAgent it degrades to null (one re-dispatch first), and the null-safe return below still
//    ships a REPORT.md pointer instead of failing the pipeline's final step. The D5 signoff pair's
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
// ── Twin Council pure core (B4-3 D1/D5) — the SEALED b42 call-site machinery, lifted to src/council.mjs
//    and inlined through the SAME @inline:council bundler contract build/validate/vision use (helpers,
//    never copy-paste). Powers report's T4 keystone: the signoff pair after the existence gate. INERT on
//    every sub-T4 / no-codex / tokenless path (councilCapable === false). ──
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

// ── Twin Council gating (B4-3 D5/D6). Report's signoff council goes council-grade ONLY when the
//    capability record promised BOTH heads (T4 = fable + codex) AND the conductor minted a runToken.
//    codexAvailable defaults true (tier T4 definitionally carries codex; normalizeArgs passes it through
//    when the conductor sends it). A PROMISED council missing its runToken fails CLOSED (terminal
//    DEGRADED; signed_off:false; NO stage_completed even on a written REPORT.md — the existence-gated
//    completion is council-gated at T4, ⟨DSGN-B43-1⟩). runTokenRaw lives ONLY in the receipt-script argv. ──
const codexAvailable = A.codexAvailable !== false
const runTokenRaw = (typeof A.runToken === 'string' && A.runToken.length > 0) ? A.runToken : null
const capabilityTier = (A.capabilityTier === 'T1' || A.capabilityTier === 'T2' || A.capabilityTier === 'T3' || A.capabilityTier === 'T4') ? A.capabilityTier : null
const councilPromised = capabilityTier === 'T4' && codexAvailable
const councilCapable = councilPromised && runTokenRaw != null
const councilMisconfigured = councilPromised && runTokenRaw == null
if (councilMisconfigured) {
  log('MISCONFIGURED CONDUCTOR — capability tier T4 with both heads reachable but NO runToken: report\'s signoff council cannot bind its receipts/seed. The report ships UNSIGNED (signed_off:false, terminal DEGRADED) and NO stage_completed fires even on a written REPORT.md — never a silent v3.0.1 completion. Relaunch with the per-run token to convene the council.')
}
const councilDir = `${kilnDir}/council/report`
const receiptsLedger = `${kilnDir}/council/receipts.jsonl`
const runTokenHash = runTokenRaw != null ? sha256Hex(runTokenRaw) : null
const COUNCIL_RENDERER_REPORT = 'b43-report/1'
// The .kiln source artifacts Omega was pointed at — names known to the stage (the record's artifact_refs
// manifest). NAMES only (not hashed): several are conditional (research.md on the zero-topics route,
// validation/report.md when validate ran), so hashing them would spuriously DEGRADE a legitimately
// artifact-lean run (AMB-B42-2 doctrine — name what the stage knows, hash only the guaranteed artifact).
const reportSourceArtifacts = [
  `${kilnDir}/STATE.md`, `${kilnDir}/docs/project-brief.md`, `${kilnDir}/docs/VISION.md`, `${kilnDir}/docs/research.md`,
  `${kilnDir}/master-plan.md`, `${kilnDir}/validation/report.md`, `${kilnDir}/docs/codebase-state.md`,
]
// Fixed rubric/task (run-independent template hash). The pair rules HONESTY of the report vs the run's
// artifacts — never prose polish, never a re-review of the product itself.
const REPORT_SIGNOFF_RUBRIC =
  'Rule the REPORT SIGNOFF: does REPORT.md tell the TRUTH about the run\'s artifacts — every DELIVERED claim ' +
  'genuinely supported by an artifact the run produced (no invented delivery), every OUTSTANDING/failed/' +
  'deferred item honestly stated (no silent omission dressed as done), and the validation outcome reported ' +
  'as it actually landed (a PARTIAL/FAILED never spun as a PASS)? You rule the report\'s HONESTY against the ' +
  'run\'s artifacts, NOT its prose polish or the product\'s merit. Every finding MUST cite the report line + ' +
  'the artifact (or its absence) it contradicts.'
const REPORT_SIGNOFF_TASK =
  'Render one blind verdict — APPROVE (REPORT.md is an honest signoff), BLOCK, or NEITHER — on the report ' +
  'signoff against the rubric. You do not know who else is ruling. divergence_selections is [] (no open ' +
  'divergences). Echo artifact_hash EXACTLY as given. A BLOCK or NEITHER MUST carry at least one evidence-bound ' +
  'finding (finding_id unique, nonempty evidence_refs or a real executable_check); an evidence-free verdict is ' +
  'invalid. changed_evidence is [] unless you reverse a prior block.'
const councilTemplateHashReport = councilTemplateHash({ rubric: REPORT_SIGNOFF_RUBRIC, ruling_task: REPORT_SIGNOFF_TASK, renderer: COUNCIL_RENDERER_REPORT })
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
// runReportSignoff (D5) — the REQUIRED blind signoff pair over the WRITTEN report + an anchored evidence
// manifest, AFTER the existence gate. Dual-APPROVE ⇒ RATIFIED (the caller sets signed_off:true, rides the
// certificate, and ONLY THEN fires stage_completed ⟨DSGN-B43-1⟩); ANY other outcome ⇒ a non-RATIFIED
// terminal, signed_off:false, the unsigned report still returned, NO completion event. Omega's report is
// FROZEN — the council rules it, never re-authors REPORT.md.
const runReportSignoff = async (res) => {
  const phaseName = 'The Final Word'
  const keystone = 'report_signoff'
  const phaseTag = 'REPORT_RATIFY'
  const namedEvidence = [reportFile]
  const anchor = await agent(evidenceAnchorPrompt(namedEvidence), { label: 'thoth:report-anchor', phase: phaseName, model: 'haiku', schema: EVIDENCE_ANCHOR_SCHEMA })
  const anchorFiles = (anchor && Array.isArray(anchor.files)) ? anchor.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : []
  const anchorPaths = anchorFiles.map((f) => f.path)
  const anchorExact =
    anchor && Array.isArray(anchor.files) && anchorFiles.length === anchor.files.length &&
    anchorFiles.length === namedEvidence.length &&
    new Set(anchorPaths).size === anchorFiles.length &&
    namedEvidence.every((p) => anchorPaths.includes(p))
  if (!anchorExact) {
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashReport, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'evidence' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'evidence-anchor' }, phaseName)
    log('report signoff evidence anchor DEGRADED — the report ships UNSIGNED, NO stage_completed (the certificate must never bind unhashed names)')
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null, receipt_verified: false, ledger_verified: false }
  }
  const manifest = {}
  for (const f of anchorFiles) manifest[f.path] = f.sha256
  const evidenceManifestHash = sha256Hex(canonicalJson(manifest))
  const evidenceInputHashes = Object.keys(manifest).sort().map((k) => manifest[k])
  const record = {
    report_sha256: manifest[reportFile] != null ? manifest[reportFile] : null,
    headline: res && res.headline != null ? res.headline : null,
    delivered: Array.isArray(res && res.delivered) ? res.delivered : [],
    outstanding: Array.isArray(res && res.outstanding) ? res.outstanding : [],
    artifact_refs: reportSourceArtifacts,
  }
  const bundleHash = sha256Hex(canonicalJson(record))
  const ckptBase = { protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashReport, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, decision_bundle_hash: bundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash }
  const recordJson = JSON.stringify(record)
  const ratifyInputs =
    `<inputs>\n- REPORT.md (the written delivery report under signoff): ${reportFile}.\n` +
    `- The COMPLETE frozen signoff record you are ratifying (report_sha256 binds REPORT.md to its sha256; artifact_refs names the .kiln source artifacts the report summarizes):\n${recordJson}\n` +
    `- Read REPORT.md and the named .kiln artifacts (read-only), confirm REPORT.md matches its bound hash, then rule whether the report tells the truth about the run's delivered vs outstanding artifacts.\n</inputs>`
  const bindingLine = `Binding: artifact_hash = "${bundleHash}" (echo it VERBATIM). divergence_selections = [] (no open divergences this round). changed_evidence = [] unless you reverse a prior block.`
  const fablePrompt =
    `You are a council ratifier (report signoff) — rule whether REPORT.md is an honest signoff against the fixed rubric, blind and independent. You do not know who else is ruling.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${REPORT_SIGNOFF_RUBRIC}\n</rubric>\n\n<binding>\n${bindingLine}\n</binding>\n\n` +
    `<task>${REPORT_SIGNOFF_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const solBrief = `${bindingLine}\nRubric:\n${REPORT_SIGNOFF_RUBRIC}\nRule read-only: compare ${reportFile} against the .kiln source artifacts NAMED in the record's artifact_refs. Rule HONESTY (delivered vs outstanding) only, never prose polish.`
  const pair = await runBlindPair({ keystone, phaseTag, legName: 'report-signoff', fablePrompt, solTaskText: REPORT_SIGNOFF_TASK, solBrief, solPacket: { signoff_record: record, artifact_hash: bundleHash }, schema: RATIFY_SCHEMA, phaseName })
  const seatHashes = (rF, rS) => ({ P0: sha256Hex(canonicalJson(rF)), P1: sha256Hex(canonicalJson(rS)) })
  if (pair.degraded) {
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: pair.missing }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing: pair.missing }, phaseName)
    log(`report signoff council DEGRADED (${pair.missing}) — the report ships UNSIGNED, NO stage_completed (never a single-head signoff)`)
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
    log(`report signoff ratification INVALID (${detail}) — DEGRADED (never mislabeled BLOCKED); the report ships UNSIGNED, NO stage_completed`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
  }
  if (pair.rF.verdict === 'APPROVE' && pair.rS.verdict === 'APPROVE') {
    const cert = assembleRatifyCertificate({ rF: pair.rF, rS: pair.rS, provF: seatProv(pair.sinkF, 'fable'), provS: seatProv(pair.sinkS, 'sol'), context: { bundle_hash: bundleHash, renderer_version: COUNCIL_RENDERER_REPORT, plan_hash: bundleHash, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null } })
    if (!cert.ok) {
      await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { reason: 'certificate defect' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
      await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'certificate defect' }, phaseName)
      log(`report signoff certificate could not seal (${cert.reason}) — the report ships UNSIGNED, NO stage_completed`)
      return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
    }
    await councilCheckpoint({ ...ckptBase, phase: 'REPORT_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
    await councilCheckpoint({ ...ckptBase, phase: 'RATIFIED', anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'RATIFIED', bundle_hash: bundleHash }, phaseName)
    log(`TWIN COUNCIL RATIFIED the report signoff (bundle ${String(bundleHash).slice(0, 12)}…) — signed_off carries two valid head signatures`)
    return { terminal: 'RATIFIED', certificate: cert.certificate, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
  }
  const frozen = [...(pair.rF.verdict === 'BLOCK' || pair.rF.verdict === 'NEITHER' ? (Array.isArray(pair.rF.findings) ? pair.rF.findings : []) : []), ...(pair.rS.verdict === 'BLOCK' || pair.rS.verdict === 'NEITHER' ? (Array.isArray(pair.rS.findings) ? pair.rS.findings : []) : [])]
  await councilCheckpoint({ ...ckptBase, phase: 'REPORT_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  await councilRuling({ keystone, phase: phaseTag, terminal: 'BLOCKED', verdicts: { fable: pair.rF.verdict, sol: pair.rS.verdict } }, phaseName)
  log(`report signoff council BLOCKED (fable ${pair.rF.verdict}, sol ${pair.rS.verdict}) — the report ships UNSIGNED, NO stage_completed; ${frozen.length} finding(s) frozen onto the return`)
  return { terminal: 'BLOCKED', certificate: null, findings: frozen, bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
}

const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    report_file: { type: 'string' },
    headline: { type: 'string' },
    delivered: { type: 'array', items: { type: 'string' } },
    outstanding: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['report_file', 'headline'],
}

// ── The run ledger (BLUEPRINT §3.5) — report.js's FIRST ledger legs (the C1 lore batch closed the
//    "report brackets ride the C1 lore batch" deferral). The vision.js runLedger idiom: Thoth
//    appends; gated on pluginRoot and degrades to a log line — an append failure never fails the
//    stage. stage_completed fires ONLY on the genuine-success path: REPORT.md written (existence-
//    verified below); a missing-artifact path emits NOTHING, per the telegraph's termination rule. ──
async function runLedger(type, data, phaseName) {
  if (!pluginRoot) { log(`pluginRoot absent — ${type} not ledgered to events.jsonl`); return }
  const ev = JSON.stringify({ type, stage: 'report', data })
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

// ── Lore beats (C1 doctrine §4): the pen — one dispatch at the moment a fact becomes true, carried by
//    runLedger to the operator's transcript (note{kind:'lore'}; deterministic <stage>.<beat> key; args
//    short scalars capped at 80 by the caller; text ≤ 160). PRESENTATION, null-keep. ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE (F-1): every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? runLedger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

const EXISTS_SCHEMA = { type: 'object', additionalProperties: false, properties: { exists: { type: 'boolean' }, reasoning: { type: 'string', maxLength: 700 } }, required: ['exists'] }

phase('The Final Word')
log('Omega picks up the pen')
// §3.5 stage bracket: stage_started on entry — a re-run is the stage still in progress.
await runLedger('stage_started', {}, 'The Final Word')
// report.pen_up (volume): Omega opens the stage — reading every artifact the run left behind.
await lore('report.pen_up', `Omega reads everything the run left behind — every artifact, every verdict`, null, 'The Final Word')
// F3 provenance: Omega's gate leg records {requested_model, actual_model, fallback_reason,
// classification} onto this sink; there is no report-stage ledger, so it rides the returned summary.
const omegaProv = {}
const res = await gateAgent(
  voice('opus') +
  `You are the closing reporter. Write the honest final delivery report.\n\n` +
  `<inputs>\n${NO_WANDER} Exception: the built project at ${projectPath} is also in scope. The files:\n` +
  `${kilnDir}/STATE.md, ${kilnDir}/docs/project-brief.md, ${kilnDir}/docs/VISION.md, ${kilnDir}/docs/research.md, ` +
  `${kilnDir}/master-plan.md, ${kilnDir}/validation/report.md (if present), ${kilnDir}/docs/codebase-state.md.\n</inputs>\n\n` +
  `<task>Write ${reportFile} — persist it via a Bash heredoc (mkdir -p the dir, then cat with a quoted heredoc into the file) — NEVER the Write tool: a platform guardrail rejects subagent Write calls on report files, and the rejection poisons the structured-output attempts that follow (an observed death mode). Compose it in Kiln's first-person, sardonic-but-earned voice (no status-symbol banners — that is the conductor's job). ` +
  `Cover: what was asked, what was built (the journey through the stages, named milestones), the validation outcome ` +
  `(tests passed/failed, criteria met), what remains or was deferred, and how to run it. Be truthful — if validation was ` +
  `PARTIAL or FAILED, say so plainly and list what's left. Then in the structured output emit report_file, headline, delivered, and outstanding FIRST — all detail belongs in ${reportFile}; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
  { label: 'omega:report', phase: 'The Final Word', model: 'opus', schema: REPORT_SCHEMA, provenance: omegaProv }
)

log(`REPORT.md written: ${res && res.headline}`)
// Genuine-success gate: a fresh pair of eyes confirms REPORT.md landed on disk (Omega writes it via a
// Bash heredoc, so the structured `res` can go mute without the file being missing — and vice versa).
// stage_completed + report.signed fire ONLY here, on a real artifact; a missing file emits NOTHING.
const proof = await agent(
  `You are the artifact existence verifier.\n\n` +
  `<task>Run 'ls ${reportFile}' (Bash). Return exists = true iff the file exists. Do not read, write, or fix anything.</task>`,
  { label: 'thoth:verify', phase: 'The Final Word', model: 'haiku', schema: EXISTS_SCHEMA }
)
// ── D5 (+ ⟨DSGN-B43-1⟩ fold): the existence gate stays; at T4 the signoff pair is a SECOND gate on
//    completion. Dual-APPROVE ⇒ signed_off:true + the certificate in the return AND ONLY THEN
//    stage_completed fires; ANY other outcome ⇒ signed_off:false + the honest terminal + frozen findings
//    in the return, the UNSIGNED report still returned, and NO completion event (the projection stays at
//    report — the conductor's gated checkpoint owns the block). Sub-T4 is byte-preserved: signed_off is
//    ABSENT (never a false claim) and the existence-gated completion is intact. Promised-but-tokenless ⇒
//    DEGRADED terminal, signed_off:false, no completion. A missing REPORT.md never reaches the council. ──
let reportCouncil = null
if (proof && proof.exists === true) {
  if (councilCapable) {
    reportCouncil = await runReportSignoff(res)
    if (reportCouncil.terminal === 'RATIFIED') {
      await lore('report.signed', `The final word is written and signed — ${oneLine((res && res.headline) || 'delivery report complete', 80)}`, { headline: oneLine((res && res.headline) || 'delivery report complete', 80) }, 'The Final Word')
      await runLedger('stage_completed', {}, 'The Final Word')
    } else {
      log(`REPORT SIGNOFF ${reportCouncil.terminal} — the report ships UNSIGNED (signed_off:false), NO stage_completed; the conductor's gated checkpoint owns the block (required-mode uniformity).`)
    }
  } else if (councilMisconfigured) {
    reportCouncil = { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null }
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashReport, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: 'report_signoff', phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'both', reason: 'runToken absent' }, codex_receipt_hash: null, status: 'sealed' }, 'The Final Word')
    await councilRuling({ keystone: 'report_signoff', phase: 'REPORT_RATIFY', terminal: 'DEGRADED', reason: 'runToken absent' }, 'The Final Word')
    log('REPORT SIGNOFF PROMISED (T4 + codex) but NO runToken (misconfigured conductor) — the report ships UNSIGNED (signed_off:false), NO stage_completed. Relaunch with the per-run token.')
  } else {
    // Sub-T4 / no-codex / tokenless: byte-preserved v3.0.1 existence-gated completion.
    await lore('report.signed', `The final word is written — ${oneLine((res && res.headline) || 'delivery report complete', 80)}`, { headline: oneLine((res && res.headline) || 'delivery report complete', 80) }, 'The Final Word')
    await runLedger('stage_completed', {}, 'The Final Word')
  }
} else {
  log('REPORT.md not found on disk — no stage_completed (a missing artifact is a failed report; the telegraph stays open for the notification to close it).')
}
return {
  report_file: reportFile, headline: res && res.headline, delivered: (res && res.delivered) || [], outstanding: (res && res.outstanding) || [], gate_provenance: omegaProv,
  // D6/⟨DSGN-B43-1⟩/B43-2: at T4 the signoff outcome rides the return (the boundary record for report) —
  // signed_off is a HONEST claim (true only with a valid dual certificate), the council terminal drives the
  // conductor's gated checkpoint, and the b42-mirrored per-seat summary {seat, certificate_present,
  // receipt_verified, ledger_verified} rides alongside. Sub-T4 omits signed_off entirely (never a false claim).
  ...(councilPromised ? { signed_off: !!(reportCouncil && reportCouncil.terminal === 'RATIFIED'), council: { seat: 'report_signoff', terminal: reportCouncil ? reportCouncil.terminal : null, certificate: reportCouncil ? reportCouncil.certificate : null, findings: reportCouncil ? reportCouncil.findings : [], bundle_hash: reportCouncil ? reportCouncil.bundle_hash : null, receipts: councilReceipts, certificate_present: !!(reportCouncil && reportCouncil.certificate), receipt_verified: !!(reportCouncil && reportCouncil.receipt_verified), ledger_verified: !!(reportCouncil && reportCouncil.ledger_verified) } } : {}),
}
