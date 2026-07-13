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
export const GATE_FAILURE_RE = /StructuredOutput|structured.?output/i
export const isStructuredOutputFailure = (e) => GATE_FAILURE_RE.test(String((e && e.message) || e))

// classifyGateFailure — label a CAUGHT error for the provenance record AND the degrade decision.
// Structured-output is tested FIRST so its exact phrasing wins; then refusal (/refus/, but the
// TRANSPORT errors ECONNREFUSED / 'connection refused' are EXCLUDED — they are not a seat's refusal
// to rule); then timeout. Anything else is 'other' — an unrelated exception that RETHROWS.
// null_result is NEVER string-matched: a null/undefined RETURN (not a caught error) is classified
// 'null_result' STRUCTURALLY at the dispatch site, so a message that merely contains 'null'
// (e.g. "Cannot read properties of null") stays 'other' and RETHROWS.
export function classifyGateFailure(e) {
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
//                     seat THROWS at call time (never-ultra doctrine — codex has no ultra tier).
//   opts.effort     reasoning effort, passed through to agent() (a real platform opt).
//   opts.provenance optional sink object. gateAgent writes {requested_model, actual_model,
//                     fallback_reason, classification} onto it so a caller that ALREADY ledgers can
//                     ride the record into its EXISTING note/evidence data payload — no new event
//                     type is minted (BLUEPRINT §B6/§10). actual_model is ALWAYS the model that
//                     actually produced the returned result — the requested model on a clean call or
//                     a same-model re-dispatch, 'opus' after a fable→opus substitution, and null on a
//                     fail-closed null. classification is the seat-death class that forced the
//                     degradation (null on a clean success). Absent sink ⇒ the record is dropped.
export async function gateAgent(prompt, opts) {
  const o = opts || {}
  if (o.effort === 'ultra' && o.transport === 'codex') {
    throw new Error(`gateAgent(${o.label || 'gate'}): 'ultra' effort is forbidden on a codex-transport seat — never-ultra doctrine`)
  }
  const { twoHeads, transport, provenance, ...agentOpts } = o // meta keys never reach agent()
  const requested = o.model != null ? o.model : null
  const required = twoHeads === 'required'
  const label = o.label || 'gate'
  // truthful provenance: actual_model is whatever model produced the RETURNED result (null on a
  // fail-closed null); classification is the seat-death class that forced any degradation.
  const record = (actual_model, fallback_reason, classification) => {
    if (provenance && typeof provenance === 'object') {
      Object.assign(provenance, { requested_model: requested, actual_model, fallback_reason, classification })
    }
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
  const first = await dispatch(agentOpts)
  if (first.ok) { record(requested, null, null); return first.value } // clean seat — actual == requested
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
  if (second.ok) { record(requested, 'redispatch', first.cls); return second.value }
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
export const TRAVERSAL_TIMEOUT = { __kiln_timeout: true }
export function withDeadline(thunk, ms, onLate) {
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
