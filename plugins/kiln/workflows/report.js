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
//    ships a REPORT.md pointer instead of failing the pipeline's final step. ──
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
if (proof && proof.exists === true) {
  // report.signed (keystone): the final word is written.
  await lore('report.signed', `The final word is written — ${oneLine((res && res.headline) || 'delivery report complete', 80)}`, { headline: oneLine((res && res.headline) || 'delivery report complete', 80) }, 'The Final Word')
  await runLedger('stage_completed', {}, 'The Final Word')
} else {
  log('REPORT.md not found on disk — no stage_completed (a missing artifact is a failed report; the telegraph stays open for the notification to close it).')
}
return { report_file: reportFile, headline: res && res.headline, delivered: (res && res.delivered) || [], outstanding: (res && res.outstanding) || [], gate_provenance: omegaProv }
