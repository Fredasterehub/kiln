// spine.mjs — THE BUILD SPINE pure core (BLUEPRINT §5.1/§6/§3.2/§3.3): the batch slice-plan
// SC-coverage arithmetic, the mechanical runner gate (tamper + evidence freshness) that decides
// whether a reviewer may even be spawned, the §3.2 milestone-gate decision (judge spawned ONLY
// on an ambiguous reconcile), and the Sentinel rejection classifier. Inlined into build.js by
// scripts/bundle-workflows.mjs (// @inline:spine:validateSlicePlan,runnerGate,rejectionClass,
// gateDecision). Pure functions only: no I/O, no Date.now/Math.random — workflow determinism
// rules apply here.
//
// Bundler discipline: each export is a self-contained block (no shared module-level helpers —
// they would not survive inlining).

// validateSlicePlan(slices, milestoneScIds) — §5 "coverage is arithmetic, not judgment": the
// batch slicer's plan for ONE milestone must map every one of the milestone's law.json SC ids
// into EXACTLY ONE slice's sc_ids (none missing, none twice), and every slice must flip at least
// one. An empty plan is legal only when nothing is left to cover (the replan-remainder edge).
// Returns { ok, errors } with typed errors ({ code, at, message }) so the workflow can re-ask the
// slicer with precise corrections, then escalate — never build against broken coverage.
export function validateSlicePlan(slices, milestoneScIds) {
  // codes: not_array | empty_plan | invalid_slice | empty_slice | unknown_sc | duplicate_sc | uncovered_sc
  const expected = Array.isArray(milestoneScIds) ? milestoneScIds.filter((id) => typeof id === 'string' && id) : []
  const errors = []
  const err = (code, at, message) => errors.push({ code, at, message })
  if (!Array.isArray(slices)) {
    return { ok: false, errors: [{ code: 'not_array', at: 'slices', message: 'the slice plan must be an array of slices' }] }
  }
  if (!slices.length) {
    if (expected.length) err('empty_plan', 'slices', `the plan is empty but ${expected.length} Law check(s) need covering: ${expected.join(', ')}`)
    return { ok: errors.length === 0, errors }
  }
  const seen = []
  slices.forEach((s, i) => {
    const at = `slices[${i}]`
    if (!s || typeof s !== 'object' || Array.isArray(s)) { err('invalid_slice', at, `${at} must be an object`); return }
    if (typeof s.objective !== 'string' || !s.objective.trim()) err('invalid_slice', `${at}.objective`, `${at}: objective must be a nonempty string`)
    if (typeof s.done_when !== 'string' || !s.done_when.trim()) err('invalid_slice', `${at}.done_when`, `${at}: done_when must be a nonempty string`)
    const ids = Array.isArray(s.sc_ids) ? s.sc_ids.filter((id) => typeof id === 'string' && id) : []
    if (!ids.length) { err('empty_slice', `${at}.sc_ids`, `${at}: every slice must flip at least one Law check (sc_ids is empty)`); return }
    for (const id of ids) {
      if (!expected.includes(id)) err('unknown_sc', `${at}.sc_ids`, `${at}: '${id}' is not a Law check of this milestone`)
      else if (seen.includes(id)) err('duplicate_sc', `${at}.sc_ids`, `${at}: '${id}' is already covered by an earlier slice — every SC in EXACTLY one slice`)
      else seen.push(id)
    }
  })
  for (const id of expected) if (!seen.includes(id)) err('uncovered_sc', id, `Law check '${id}' is not covered by any slice`)
  return { ok: errors.length === 0, errors }
}

// runnerGate(runner, probe) — the §5.1/§6 MECHANICAL gate the workflow applies before spawning
// any reviewer. `runner` is the runner agent's schema-forced report ({ verify_exit, tamper_paths,
// law_run_exit, flip_unmet, regressed, run_id, head, … }); `probe` is the independent freshness
// probe's report — a fresh pair of eyes over the evidence ON DISK ({ results_jsonl_exists, head,
// head_committed_epoch, manifest_head, manifest_results_sha256, manifest_completed_epoch,
// results_sha256 }), never the runner's own claims. The manifest fields come from the run.json
// kiln-law ITSELF writes inside the evidence dir (and finalizes only on a complete run) — the
// evidence carries its own anchors; the agents only transcribe them. Returns
// { verdict: 'tamper' | 'stale' | 'red' | 'proceed', tamper_paths, reasons }:
//   tamper  — kiln-law exited 2 anywhere or TAMPER paths were reported: a locked Law path was
//             touched. The slice is auto-REJECTED by the WORKFLOW (no agent judgment, no reviewer
//             spawned) and the fix brief names the touched lock(s). Checked FIRST — tamper
//             outranks every other concern, including a missing probe.
//   stale   — the evidence cannot be trusted fresh (§6: "the workflow compares evidence
//             timestamps/hashes against HEAD and auto-rejects mismatches before any reviewer is
//             spawned" — stale evidence is structurally impossible to approve):
//               · missing/malformed runner or probe report, kiln-law verify not cleanly exit 0,
//                 kiln-law run's exit unreported, no run id / no HEAD anchor, results.jsonl
//                 absent;
//               · HEAD-anchor arm — the manifest HEAD inside the evidence (CLI-written) and the
//                 runner-reported HEAD must BOTH equal the current HEAD;
//               · hash arm — results.jsonl re-hashed by the probe must equal the sha256 the
//                 manifest recorded at completion (altered or partial evidence diverges; an
//                 aborted run never finalizes its manifest and fails here);
//               · timestamp arm — the manifest completion epoch must not predate the HEAD commit
//                 epoch (evidence produced before the commit it claims to verify is stale).
//             Auto-REJECT, no reviewer spawned. Staleness outranks 'red': a red verdict is only
//             trustworthy over evidence proven complete and fresh.
//   red     — the §5.1 red/green LIFECYCLE verdict, mechanical (T2-fix ruling: "the exit code is
//             the verdict"): the evidence is tamper-clean, complete, and fresh, but `kiln-law run
//             --flips` exited non-zero — a declared RED→GREEN flip did not flip, or a
//             previously-GREEN check regressed. Auto-REJECT, no reviewer spawned (a reviewer
//             cannot soften an exit code); reasons name the FLIP_UNMET/REGRESSION ids the runner
//             transcribed, and flip_unmet/regressed are surfaced for the fix brief.
//   proceed — evidence is tamper-clean and fresh AND the lifecycle gate is green; the reviewer
//             may be spawned.
// Fail closed: every absent or malformed field lands in 'stale', never in 'proceed'. The probe's
// absence sentinels are '' (strings) and -1 (epochs) — sentinels never match, so they fail closed.
export function runnerGate(runner, probe) {
  const r = (runner && typeof runner === 'object' && !Array.isArray(runner)) ? runner : null
  const tamperPaths = (r && Array.isArray(r.tamper_paths)) ? r.tamper_paths.filter((p) => typeof p === 'string' && p) : []
  if (r && (r.verify_exit === 2 || r.law_run_exit === 2 || tamperPaths.length)) {
    return {
      verdict: 'tamper', tamper_paths: tamperPaths,
      reasons: [tamperPaths.length ? `locked path(s) touched: ${tamperPaths.join(', ')}` : 'kiln-law exited 2 (tamper) without naming paths'],
    }
  }
  const reasons = []
  if (!r) reasons.push('the runner produced no report')
  else {
    if (r.verify_exit !== 0) reasons.push(`kiln-law verify did not exit 0 (got ${JSON.stringify(r.verify_exit)})`)
    if (typeof r.law_run_exit !== 'number' || !Number.isFinite(r.law_run_exit)) reasons.push(`kiln-law run reported no exit code (got ${JSON.stringify(r && r.law_run_exit)})`)
    if (typeof r.run_id !== 'string' || !r.run_id.trim()) reasons.push('the runner reported no run_id — there is no evidence directory to anchor')
    if (typeof r.head !== 'string' || !r.head.trim()) reasons.push('the runner reported no HEAD anchor')
  }
  const p = (probe && typeof probe === 'object' && !Array.isArray(probe)) ? probe : null
  if (!p) reasons.push('the freshness probe produced no report')
  else {
    const str = (v) => (typeof v === 'string' ? v.trim() : '')
    const cur = str(p.head)
    if (p.results_jsonl_exists !== true) reasons.push('results.jsonl does not exist in the evidence dir')
    if (!cur) reasons.push('the probe reported no HEAD')
    else if (r && str(r.head) && cur !== str(r.head)) {
      reasons.push(`HEAD moved since the runner anchored its evidence (runner ${str(r.head)}, current ${cur})`)
    }
    // §6 HEAD-anchor arm: run.json's head is written by kiln-law itself at run time — the
    // evidence names the commit it was produced at, and that commit must BE the current HEAD.
    const manifestHead = str(p.manifest_head)
    if (!manifestHead) reasons.push('the evidence carries no manifest HEAD anchor (run.json missing or unfinalized)')
    else if (cur && manifestHead !== cur) reasons.push(`the evidence was produced at HEAD ${manifestHead}, not the current HEAD ${cur} — stale by commit`)
    // §6 hash arm: a COMPLETE run records sha256(results.jsonl) in its manifest; the probe
    // re-hashes the file. Divergence ⇒ altered or partial evidence; absence ⇒ never finalized.
    const recorded = str(p.manifest_results_sha256)
    const rehashed = str(p.results_sha256)
    if (!recorded || !rehashed) reasons.push('the evidence hash cannot be verified (manifest results_sha256 or the probe rehash is missing — an aborted run never finalizes)')
    else if (recorded !== rehashed) reasons.push(`results.jsonl re-hashes to ${rehashed} but the manifest recorded ${recorded} — the evidence was altered or partially written`)
    // §6 timestamp arm: evidence must postdate the commit it claims to verify.
    const completed = (typeof p.manifest_completed_epoch === 'number' && Number.isFinite(p.manifest_completed_epoch)) ? p.manifest_completed_epoch : -1
    const committed = (typeof p.head_committed_epoch === 'number' && Number.isFinite(p.head_committed_epoch)) ? p.head_committed_epoch : -1
    if (completed < 0 || committed < 0) reasons.push('the evidence/HEAD timestamps are unavailable — freshness cannot be proven')
    else if (completed < committed) reasons.push(`the evidence completed at epoch ${completed}, before HEAD was committed at epoch ${committed} — stale by time`)
  }
  if (reasons.length) return { verdict: 'stale', tamper_paths: [], reasons }
  // The lifecycle verdict (T2-fix ruling, §5.1 red/green): the evidence is complete and fresh —
  // kiln-law finalizes run.json BEFORE its expectation gates, so a flip/regression failure still
  // carries trustworthy evidence — and the exit code IS the verdict. Non-zero ⇒ 'red', mechanical.
  if (r.law_run_exit !== 0) {
    const ids = (v) => Array.isArray(v) ? v.filter((id) => typeof id === 'string' && id) : []
    const unmet = ids(r.flip_unmet)
    const regressed = ids(r.regressed)
    const why = []
    if (unmet.length) why.push(`declared RED→GREEN flip(s) still not green: ${unmet.join(', ')}`)
    if (regressed.length) why.push(`previously-GREEN check(s) regressed: ${regressed.join(', ')}`)
    if (!why.length) why.push(`kiln-law run exited ${r.law_run_exit} — the lifecycle gate failed without transcribed FLIP_UNMET/REGRESSION ids; read the evidence logs under the run's checks/ dir`)
    return { verdict: 'red', tamper_paths: [], reasons: why, flip_unmet: unmet, regressed }
  }
  return { verdict: 'proceed', tamper_paths: [], reasons: [] }
}

// goalAuditUsable(report) — the milestone gate's usability predicate for the goal-backward
// audit report (ORCHESTRATOR RULING, p2/tasks.md "Gate failure semantics"): the §3.2 judge-spawn
// condition is exhaustive over USABLE inputs, and the judge NEVER spawns on missing ones — a
// null/unusable report is re-asked once by the workflow, then fails the boundary closed
// (QA_FAIL, blocking finding 'goal-audit-failure'). Usable = a plain object carrying a binary
// overall verdict ('pass'|'fail') and a findings array (the QA_FINDINGS shape the reconcile
// folds). Anything else — a dead agent (null), a wrong type, a missing/unknown overall, missing
// findings — is unusable; absent evidence is fail-closed, mirroring the P0 Athena ruling.
export function goalAuditUsable(report) {
  return !!(report && typeof report === 'object' && !Array.isArray(report)
    && (report.overall === 'pass' || report.overall === 'fail')
    && Array.isArray(report.findings))
}

// tribunalThreshold(sliceCount, minSlices) — the §3.2 milestone-gate ROUTING predicate (the row's
// "multi-slice → dual analysts ∥ … judge" vs "single-slice → slice review + goal-backward IS the
// gate", tasks.md T3.1: "slices_built ≥ min_slices_for_tribunal"), computed IN-SCRIPT (never an
// agent). Returns true ⇒ the milestone runs the dual-analyst tribunal; false ⇒ the slice review +
// goal-backward audit IS the gate (the tribunal redundancy skip, proven safe class
// [R:adaptive-orchestration §4]). The boundary is inclusive: at EXACTLY the threshold the tribunal
// fires. Fail toward scrutiny (§3.3 "scrutiny may only rise"): a non-positive sliceCount can never
// reach a positive threshold (false — caught upstream by the "no slices built" branch), and an
// absent/non-finite/non-positive minSlices is treated as the most conservative threshold of 1, so
// every built milestone runs the tribunal rather than silently downgrading to the lighter gate.
export function tribunalThreshold(sliceCount, minSlices) {
  const n = (typeof sliceCount === 'number' && Number.isFinite(sliceCount)) ? sliceCount : 0
  const min = (typeof minSlices === 'number' && Number.isFinite(minSlices) && minSlices >= 1) ? minSlices : 1
  return n >= min
}

// gateDecision(reconciled, overallA, overallB) — the §3.2 milestone-gate judge-spawn condition,
// computed IN-SCRIPT (never an agent): the judge is spawned ONLY on an AMBIGUOUS reconcile —
// zero blocking findings AND the two analysts' overall verdicts disagree. Everything else is
// COMPUTED (§3.2: "else verdict is computed" — hasBlocking → QA_FAIL, else QA_PASS):
//   · blocking findings → QA_FAIL, no judge — the deterministic reconcile decides and a judge
//     could only soften it away;
//   · a missing/unreadable analyst verdict → QA_FAIL, no judge. The §3.2 judge-spawn condition is
//     EXHAUSTIVE over usable inputs ("the two analysts' overall verdicts disagree" presupposes two
//     readable verdicts), and the operator ruling (p2/tasks.md "Gate failure semantics") is
//     explicit: "The judge NEVER spawns on missing inputs … absent evidence is fail-closed,
//     mirroring the P0 Athena ruling." An absent analyst verdict is not "two disagreeing verdicts";
//     it is missing evidence, so the boundary fails closed. (The judge can only SOFTEN a gate, so
//     spawning it on a missing input would lower scrutiny, not raise it — §3.3.)
//   · zero blocking + BOTH verdicts readable AND they agree → QA_PASS, no judge. This holds even
//     for an agreed 'fail': an overall 'fail' unbacked by any critical|high finding is noise to the
//     deterministic reconcile (the analyst prompts demand a fail be backed by one) — the §3.2
//     computed rule is exact, and an agreed verdict is by definition not ambiguous;
//   · zero blocking + BOTH verdicts readable AND they disagree → the judge rules (the sole §3.2
//     ambiguous reconcile).
// Returns { judge, verdict, reason }: judge=true ⇒ verdict null (the judge rules);
// judge=false ⇒ verdict is the computed 'QA_PASS' | 'QA_FAIL'.
export function gateDecision(reconciled, overallA, overallB) {
  if (reconciled && reconciled.hasBlocking === true) {
    return { judge: false, verdict: 'QA_FAIL', reason: 'blocking findings — the verdict is computed (hasBlocking → QA_FAIL); no judge can soften a deterministic gate' }
  }
  const known = (v) => v === 'pass' || v === 'fail'
  if (!known(overallA) || !known(overallB)) {
    const a = known(overallA) ? overallA : 'unreadable'
    const b = known(overallB) ? overallB : 'unreadable'
    return { judge: false, verdict: 'QA_FAIL', reason: `an analyst overall verdict is missing/unreadable (A: ${a}, B: ${b}) — the §3.2 judge-spawn condition needs two readable, disagreeing verdicts; missing evidence fails the boundary closed (QA_FAIL), the judge never spawns on missing inputs` }
  }
  if (overallA === overallB) {
    return {
      judge: false, verdict: 'QA_PASS',
      reason: overallA === 'pass'
        ? 'zero blocking findings and the analysts agree (pass) — the verdict is computed; no judge'
        : 'the analysts agree (fail) yet produced zero blocking findings — an unbacked fail is noise to the deterministic reconcile; the §3.2 computed rule (no blocking ⇒ QA_PASS) applies and an agreed verdict is not ambiguous, so no judge',
    }
  }
  return { judge: true, verdict: null, reason: `zero blocking findings and the analyst overall verdicts disagree (A: ${overallA}, B: ${overallB}) — ambiguous reconcile, the judge rules` }
}

// rejectionClass(review) — the §3.3 master-signal classifier: Sentinel escalation keys on
// LOGICAL findings only (genesis 3.3 semantics — a required mechanical|logical enum on every
// reviewer finding). Classification of one REJECTED verdict:
//   · null/absent review (the agent died) → 'mechanical' — an infrastructure failure carries no
//     defect signal; it must not push the slice toward feedback escalation or a split.
//   · any finding classed 'logical' → 'logical'.
//   · a real REJECTED verdict carrying NO findings at all → 'logical' — an uncategorized judgment
//     errs toward scrutiny (the ratchet may only raise; vagueness never lowers it).
//   · otherwise (every finding mechanical) → 'mechanical'.
export function rejectionClass(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) return 'mechanical'
  const findings = Array.isArray(review.findings) ? review.findings : []
  if (findings.some((f) => f && f.finding_class === 'logical')) return 'logical'
  return findings.length ? 'mechanical' : 'logical'
}

// pipelineInvalidated(baseSha, headSha) — the §9 next-milestone pipelining invalidation predicate
// (review finding #8, BLUEPRINT §9). Velocity lever 3 launches M(i+1)'s slice-plan IN PARALLEL with
// M(i)'s milestone gate, against the HEAD that existed when the pipeline launched (its recorded
// `base_sha`). But M(i)'s gate may mutate that HEAD: a tribunal correction commit (and later a
// validate-loop fix) lands new work on M(i), so a slice plan computed against the pre-correction
// codebase is now stale — it may re-cut work the correction already did, or miss state the
// correction introduced. The rule (normative §9): "the pipelined slice plan records its base
// commit SHA; any corrective commit on the current milestone (tribunal correction, validate loop)
// invalidates it and forces a re-slice against the new HEAD."
//
// This is the pure decision: given the SHA HEAD pointed at when the speculative plan launched
// (baseSha) and the SHA HEAD points at when the gate completes (headSha), is the plan still good?
// It is good ONLY when both are non-empty strings AND equal — HEAD never moved, so no corrective
// commit landed, so the plan was computed against exactly the codebase that the next milestone
// inherits. ANY of: HEAD advanced (a corrective commit), a missing/blank base anchor (the launch
// never recorded where it ran), or a missing/blank current HEAD (HEAD is unreadable, so freshness
// cannot be PROVEN) ⇒ invalidate. Fail-closed: an unproven plan is never trusted — re-slicing
// against the real HEAD is always safe; trusting a stale plan is not. Returns
// { invalidated: boolean, reason }; reason is ledger-ready (drops into the events.jsonl
// slice_plan_invalidated `data`), and is the empty string when the plan stands.
export function pipelineInvalidated(baseSha, headShaArg) {
  const base = typeof baseSha === 'string' ? baseSha.trim() : ''
  const head = typeof headShaArg === 'string' ? headShaArg.trim() : ''
  if (!base) return { invalidated: true, reason: 'the pipelined plan recorded no base_sha — its launch HEAD is unknown, so freshness cannot be proven; re-slice against the current HEAD' }
  if (!head) return { invalidated: true, reason: 'the current HEAD is unreadable — freshness cannot be proven; re-slice against the current HEAD' }
  if (base !== head) return { invalidated: true, reason: `a corrective commit moved the milestone HEAD since the pipelined plan was cut (base_sha ${base}, current HEAD ${head}) — the speculative plan is stale; re-slice against the new HEAD` }
  return { invalidated: false, reason: '' }
}
