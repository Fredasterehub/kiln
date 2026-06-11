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
// results_sha256, manifest_verification_class }), never the runner's own claims. The manifest
// fields come from the run.json kiln-law ITSELF writes inside the evidence dir (and finalizes
// only on a complete run) — the evidence carries its own anchors; the agents only transcribe
// them. Returns { verdict: 'tamper' | 'stale' | 'red' | 'proceed', tamper_paths, reasons }, and
// on the trustworthy-evidence verdicts ('red' | 'proceed') also verification_class
// ('full' | 'static-only', from the finalized manifest) — the §7 honesty channel: a
// probe-deferred run (uninstantiated template, --skip-probes, playwright absent) can exit 0,
// so the GATE must carry the degradation mechanically or a static-only run proceeds silently
// green. A finalized manifest whose verification_class is missing or unreadable is foreign or
// pre-contract evidence — 'stale', fail-closed, like every other absent anchor.
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
  let verificationClass = ''
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
    // §7 honesty arm: every finalized run.json carries verification_class ('full' when every
    // selected probe EXECUTED, 'static-only' the moment any probe deferred — uninstantiated
    // template, --skip-probes, or playwright absent). A deferred probe folds into a law_run_exit
    // of 0, so the exit code alone CANNOT distinguish a fully-verified run from a degraded one —
    // the gate must read the class from the evidence itself or a static-only run proceeds
    // silently green. Missing/unreadable ⇒ foreign or pre-contract evidence ⇒ stale, fail-closed.
    verificationClass = str(p.manifest_verification_class)
    if (verificationClass !== 'full' && verificationClass !== 'static-only') {
      reasons.push(`the evidence carries no readable verification_class (run.json reports ${JSON.stringify(p.manifest_verification_class)}) — whether probe verification was degraded cannot be proven`)
    }
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
    return { verdict: 'red', tamper_paths: [], reasons: why, flip_unmet: unmet, regressed, verification_class: verificationClass }
  }
  return { verdict: 'proceed', tamper_paths: [], reasons: [], verification_class: verificationClass }
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

// probeGate(surface, gate) — the §7 ui-slice probe gating predicate (tasks.md T2.1), a PURE
// classifier the build spine consults AFTER the mechanical runnerGate has already disposed of the
// reject paths a probe shares with every other check. The browser is a subprocess with a deadline,
// never a service, and "the builder NEVER gets a browser" — so probe outcomes reach the spine ONLY
// as the runnerGate verdict + the finalized run.json verification_class the freshness probe
// transcribed. This fn names the surface-aware decision the contract demands (probe exit → reject /
// degrade / pass) in ONE tested place, instead of leaving it implicit across kiln-law's exit-code
// folding and runnerGate's verdict.
//
// The exit-code mapping is already MECHANICAL upstream and must not be second-guessed here
// (re-deriving it from prose would be exactly the v2 mistake this phase repeals):
//   · probe exit 1 (assert-fail) or 79 (timeout) → kiln-law folds the check 'red' → its declared
//     flip is UNMET → kiln-law run exits non-zero → runnerGate returns 'red' → the spine
//     auto-REJECTS before any reviewer (lawRedReject). probeGate is never consulted on 'red'.
//   · missing/stale probe evidence → the §6 freshness arms fail → runnerGate returns 'stale' → the
//     spine auto-REJECTS before any reviewer. probeGate is never consulted on 'stale'/'tamper'.
//   · probe exit 78 (playwright absent) → kiln-law folds the check 'deferred' (exempt from flip
//     accounting — deferred is NEVER green), the run can exit 0, and run.json is finalized
//     verification_class:'static-only'. THIS is the honest-degradation case probeGate names.
//   · every mapped probe executed → verification_class:'full'.
//
// So probeGate runs on the TRUSTWORTHY verdicts only ('proceed'|'red' carry verification_class; the
// spine calls it on the proceed path) and returns { action, verification_class, reason }:
//   · logic surface → { action:'pass' } unconditionally — a logic slice has no browser path, a probe
//     never mapped to it, and verification_class is irrelevant. The browser law applies to ui/mixed.
//   · ui/mixed + verification_class 'full' → { action:'pass' } — every mapped probe EXECUTED; the
//     ui review is full-strength and reads the probe evidence (screenshot + console/net/axe logs).
//   · ui/mixed + verification_class 'static-only' → { action:'degrade' } — a probe was honestly
//     deferred (playwright absent → exit 78, an un-instantiated template, or --skip-probes). The
//     run proceeds HONESTLY DEGRADED: the spine ledgers 'probe_unavailable', the ui review falls
//     back to the v2 static checks, and verification_class is recorded end-to-end. A capability
//     tier, NEVER an error, and NEVER silently green (the §7 honesty law).
//   · ui/mixed + an unreadable/absent verification_class → { action:'reject' } — fail-closed: a
//     trustworthy-looking run whose degradation cannot be PROVEN must not pass a ui gate as 'full'.
//     (runnerGate already routes a missing class to 'stale', so the spine never reaches probeGate
//     with one; this arm makes the predicate total and is unit-tested directly.)
// reason is ledger-/brief-ready and empty on 'pass'.
export function probeGate(surface, gate) {
  const surf = (surface === 'ui' || surface === 'mixed') ? surface : 'logic'
  const vc = (gate && typeof gate === 'object' && typeof gate.verification_class === 'string') ? gate.verification_class : ''
  if (surf === 'logic') return { action: 'pass', verification_class: vc || 'full', reason: '' }
  if (vc === 'full') return { action: 'pass', verification_class: 'full', reason: '' }
  if (vc === 'static-only') {
    return { action: 'degrade', verification_class: 'static-only', reason: 'a mapped probe was deferred (playwright absent → exit 78, an un-instantiated template, or --skip-probes) — no browser-probe evidence for this ui slice; the review falls back to the static checks, ledgered probe_unavailable, verification_class static-only (honest degradation, never silently green)' }
  }
  return { action: 'reject', verification_class: vc, reason: `the ui slice carries no readable verification_class (${JSON.stringify(vc)}) — whether probe verification was degraded cannot be proven; fail closed rather than pass a ui gate as fully verified` }
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

// validateVerdict(ev) — the §3.2/§5 validate-stage verdict, computed DETERMINISTICALLY FIRST
// (tasks.md T3.5: "Verdict computation deterministic-first") instead of trusting an agent's
// self-assigned verdict. The validate stage is the real L3 backstop, so its PASS/PARTIAL/FAILED
// ruling is mechanical over the EVIDENCE FILES — the deterministic Law floor (kiln-law verify +
// run FULL + suite), the per-criterion results, the Tier-2 browser path, and the goal-backward
// audit — never a prose self-grade. The agent ORCHESTRATES those commands and reports what they
// printed; this function rules. A reviewer cannot soften an exit code, and a missing input never
// passes a gate. Inlined into validate.js by the bundler (// @inline:spine:validateVerdict).
//
// `ev` is the validate stage's assembled evidence (every field fail-closed on absence):
//   { law_run_exit, suite_exit         — the §5.1 Law floor exit codes (numbers; non-0 = the Law
//                                         is red / the project suite failed; non-number ⇒ null =
//                                         the command was not run or its exit was not transcribed,
//                                         which FAILS CLOSED — a PASS requires BOTH at exit 0, so a
//                                         missing exit code is fatal, never softened to PASS. The
//                                         ONE exception: -1 is the no-pluginRoot DEGRADED sentinel
//                                         (the kiln-law CLI lives under pluginRoot, so its absence
//                                         makes the deterministic floor structurally un-runnable —
//                                         validate.js argusPrompt transcribes -1 for both). -1 is an
//                                         HONEST "not run because the oracle was unavailable" — it
//                                         caps the verdict at PARTIAL, never PASS, never a hard
//                                         FAILED on this alone, per the §1.6/§7 honest-degradation
//                                         contract. null vs -1 is the load-bearing distinction:
//                                         null = oracle present, exit dropped ⇒ FAILED; -1 = oracle
//                                         absent, honestly marked ⇒ degraded PARTIAL.)
//     install_ok                        — false ⇒ a build/install error (the v2 VALIDATE_FAILED
//                                         "build error" class); a non-true value fails closed
//     criteria: [{ id, met, critical }] — every acceptance criterion the agent exercised; `met`
//                                         is the agent's per-criterion observation, `critical`
//                                         flags an SC whose failure is fatal (default true on a
//                                         non-false value — an uncategorized criterion is treated
//                                         as critical: scrutiny may only rise)
//     tests_passed, tests_failed        — suite counts, for the v2 ">50% test failures" FAILED arm
//     blocking_findings: [string]       — the drift/seam/goal-backward findings the workflow has
//                                         already classed BLOCKING (critical|high), deduped — any
//                                         one is fatal (the deterministic reconcile's blocking arm)
//     ui_scope                          — true iff the deliverable has UI/web behavioral criteria
//                                         (designPresent OR a product_type of web/extension/electron
//                                         OR any criterion the agent marked browser-only)
//     browser_path                      — 'full' (Tier-2 traversal ran clean), 'failed' (traversal
//                                         ran and found a UI defect), 'static-only' (no browser
//                                         path available — playwright/MCP absent, honest
//                                         degradation), or '' / anything else (unknown ⇒ treated
//                                         as static-only: a UI scope never claims a clean browser
//                                         pass it cannot prove)
//     missing_creds                     — true ⇒ a credentials/env gap (the v2 "NEVER fail solely
//                                         for missing creds" rule — caps the verdict at PARTIAL,
//                                         never FAILED on this alone) }
//
// Returns { verdict, verification_class, browser_verdict, blocking, reasons }:
//   · verdict ∈ 'VALIDATE_PASS' | 'VALIDATE_PARTIAL' | 'VALIDATE_FAILED'
//   · verification_class ∈ 'full' | 'static-only' — the §1.6/§7 honesty channel, recorded
//     end-to-end: 'static-only' the moment a UI scope ran without a browser path (degraded but
//     honest), else 'full'. A non-UI deliverable is always 'full' (no browser gap exists).
//   · browser_verdict — the v2 enum, preserved: NOT_APPLICABLE (no UI scope) ·
//     FULL_BROWSER_VALIDATION (Tier-2 clean) · FAIL_BROWSER_EVIDENCE_MISSING (Tier-2 found a UI
//     defect — blocking) · PARTIAL_PASS_STATIC_ONLY (UI scope, no browser path — the v2 ceiling).
//   · blocking — the deduped blocking-reason list that forced a non-PASS (empty on PASS).
//   · reasons — every rule that fired, ledger-/report-ready.
//
// The matrix, fail-closed and non-compensatory (any FAILED arm wins, then any PARTIAL arm, else
// PASS — scrutiny only rises):
//   FAILED iff  install failed · the Law run is red OR un-transcribed (law_run_exit ≠ 0, null
//               included — EXCEPT the -1 degraded-floor sentinel, which is PARTIAL below) · the
//               suite exit is MISSING/un-transcribed (suite_exit = null — a PASS requires the suite
//               at exit 0 per §3.2/§5.1, so an unproven suite fails closed exactly like an
//               un-transcribed Law run; suite_exit=-1 is likewise the degraded sentinel, PARTIAL) ·
//               the suite ran red AND >50% of its tests failed · any CRITICAL criterion unmet · any
//               blocking finding · the Tier-2 traversal ran and FAILED (a real UI defect). These
//               are the v2 VALIDATE_FAILED classes plus the new Law/suite-transcription/goal-
//               backward/browser-defect gates.
//   PARTIAL iff (not FAILED and) the deterministic Law floor was unavailable (law_run_exit=-1 — the
//               no-pluginRoot honest degradation, never a silent PASS) · the suite is red but ≤50%
//               failed (incl. suite_exit=-1) · any NON-critical criterion unmet · missing creds · a
//               UI scope with no clean browser path (static-only — the v2 "UI behavior pending the
//               out-of-loop pass" ceiling, now satisfiable in-loop only by a clean Tier-2
//               traversal). The §3.2 rule: a UI scope maxes at PARTIAL unless its browser traversal
//               is clean.
//   PASS    otherwise: install ok, Law run + suite both exit 0, every critical criterion met,
//               zero blocking findings, and (no UI scope OR the Tier-2 traversal ran clean).
export function validateVerdict(ev) {
  const e = (ev && typeof ev === 'object' && !Array.isArray(ev)) ? ev : {}
  const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null
  const lawExit = num(e.law_run_exit)
  const suiteExit = num(e.suite_exit)
  const passed = num(e.tests_passed)
  const failed = num(e.tests_failed)
  const installOk = e.install_ok === true
  const missingCreds = e.missing_creds === true
  const uiScope = e.ui_scope === true
  const browserPath = (e.browser_path === 'full' || e.browser_path === 'failed' || e.browser_path === 'static-only') ? e.browser_path : (uiScope ? 'static-only' : '')
  const criteria = Array.isArray(e.criteria) ? e.criteria.filter((c) => c && typeof c === 'object' && !Array.isArray(c)) : []
  // a criterion is critical unless EXPLICITLY flagged non-critical; uncategorized ⇒ critical.
  const isCritical = (c) => c.critical !== false
  const unmet = criteria.filter((c) => c.met !== true)
  const criticalUnmet = unmet.filter(isCritical)
  const nonCriticalUnmet = unmet.filter((c) => !isCritical(c))
  const blocking = Array.from(new Set((Array.isArray(e.blocking_findings) ? e.blocking_findings : []).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())))

  // The degraded-floor sentinel (no-pluginRoot path): the kiln-law CLI lives under pluginRoot, so when
  // pluginRoot is absent the deterministic floor cannot run and Argus is told (validate.js argusPrompt)
  // to transcribe law_run_exit=-1 / suite_exit=-1 — an HONEST "not run because the oracle was
  // structurally unavailable", distinct from null ("the oracle was available but its exit was dropped").
  // §1.6/§7 + the validate.js L30-31 contract: pluginRoot absence DEGRADES to the v2 static path —
  // honestly, never a silent skip and never a clean green. So -1 is a degradation (→ PARTIAL ceiling
  // below), not a hard FAILED: it can never PASS (the floor never proved exit 0), but the run is honestly
  // degraded, not declared broken. It is symmetric with the suite arm, where -1 already lands in PARTIAL.
  // A null or any OTHER non-zero Law exit is still a hard FAILED (un-transcribed, or a genuinely red Law).
  const lawFloorUnavailable = lawExit === -1
  const failedReasons = []
  if (!installOk) failedReasons.push('install/build failed — the app could not be installed or built (the runner reported install_ok ≠ true)')
  if (lawExit !== 0 && !lawFloorUnavailable) failedReasons.push(`the Law run is RED — kiln-law run (FULL) ${lawExit === null ? 'was not run or its exit was not transcribed' : `exited ${lawExit}`}; the verdict is mechanical (no agent softens an exit code)`)
  // suite: a MISSING/un-transcribed exit fails CLOSED (§5.1 — exit codes are transcribed exactly and
  // the verdict rules over them; §3.2 — PASS requires the suite at exit 0, so an unproven suite is
  // never PASS, exactly as the Law run above). >50% failed is FAILED; a red suite that RAN with ≤50%
  // failed (or ran red with counts unavailable) is the softer PARTIAL arm below. null ⇒ FAILED here.
  if (suiteExit === null) failedReasons.push('the project suite exit was not run or not transcribed — kiln-law suite produced no exit code; a PASS requires the suite at exit 0 (§5.1/§3.2), so a missing suite oracle fails closed (no agent softens a missing exit code)')
  let suiteMajorityFailed = false
  if (suiteExit !== null && suiteExit !== 0 && passed !== null && failed !== null && (passed + failed) > 0) {
    suiteMajorityFailed = failed > (passed + failed) / 2
  }
  if (suiteMajorityFailed) failedReasons.push(`the project suite failed the majority of its tests (${failed} failed / ${passed + failed} total)`)
  for (const c of criticalUnmet) failedReasons.push(`a CRITICAL acceptance criterion is unmet: ${c.id || '(unnamed)'}${c.note ? ` — ${c.note}` : ''}`)
  for (const b of blocking) failedReasons.push(`blocking finding: ${b}`)
  if (uiScope && browserPath === 'failed') failedReasons.push('the Tier-2 browser traversal ran and found a UI defect — a clean PASS is never emitted for broken UI behavior')

  const partialReasons = []
  // the degraded-floor sentinel caps at PARTIAL: the deterministic Law floor never ran (pluginRoot
  // absent), so a clean green can never be PROVEN — but the run is honestly degraded, not FAILED. This
  // is the load-bearing arm when Argus ran its own suite to a clean exit 0: without it the verdict would
  // fall through to a silent PASS the missing floor never earned (the mandate's "never silently green").
  if (lawFloorUnavailable) partialReasons.push('the deterministic Law floor did not run — kiln-law was unavailable (pluginRoot absent), so law_run_exit=-1; the run is honestly degraded to the v2 static path (the floor never proved a clean exit 0), capped at PARTIAL, never a silent PASS (§1.6/§7)')
  // a red suite that did NOT fail the majority (or whose counts are unavailable) is PARTIAL, not PASS.
  if (suiteExit !== null && suiteExit !== 0 && !suiteMajorityFailed) partialReasons.push(`the project suite is red (exit ${suiteExit}) but ≤50% of tests failed${passed !== null && failed !== null ? ` (${failed}/${passed + failed})` : ' (counts unavailable)'}`)
  for (const c of nonCriticalUnmet) partialReasons.push(`a non-critical acceptance criterion is unmet: ${c.id || '(unnamed)'}${c.note ? ` — ${c.note}` : ''}`)
  if (missingCreds) partialReasons.push('missing credentials/env — never a FAILED on its own (v2 rule), capped at PARTIAL')
  if (uiScope && browserPath === 'static-only') partialReasons.push('UI scope with no clean browser path — static-only (playwright/MCP absent or the traversal did not run clean); the §3.2 ceiling is PARTIAL until a clean Tier-2 traversal, honestly degraded, never silently green')

  const verification_class = (uiScope && browserPath !== 'full') ? 'static-only' : 'full'
  const browser_verdict = !uiScope ? 'NOT_APPLICABLE'
    : browserPath === 'full' ? 'FULL_BROWSER_VALIDATION'
      : browserPath === 'failed' ? 'FAIL_BROWSER_EVIDENCE_MISSING'
        : 'PARTIAL_PASS_STATIC_ONLY'

  if (failedReasons.length) return { verdict: 'VALIDATE_FAILED', verification_class, browser_verdict, blocking, reasons: failedReasons }
  if (partialReasons.length) return { verdict: 'VALIDATE_PARTIAL', verification_class, browser_verdict, blocking, reasons: partialReasons }
  return { verdict: 'VALIDATE_PASS', verification_class, browser_verdict, blocking: [], reasons: [] }
}
