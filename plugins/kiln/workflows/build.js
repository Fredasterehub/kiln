// GENERATED from workflows-src/build.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-build',
  description: 'Kiln build stage — two nested loops over the locked Law. OUTER: each master-plan milestone in dependency order (sequential, cumulative commits). INNER: the batch slice spine — KRS-One plans the milestone\'s ENTIRE ordered slice list in ONE call, mapped 1:1 to law.json SC ids (coverage is arithmetic, validated in-script); a haiku confirm checks each slice against live state before its build; a builder implements the slice (Opus builds ui/mixed, GPT-5.5/Codex builds logic) and commits it; the deterministic runner then executes kiln-law (verify = tamper gate; run --only/--flips = the §5.1 red/green lifecycle where the EXIT CODE is the verdict — expected flips computed from the recorded prior status via --before, previously-GREEN regressions fatal) and persists the project suite as hashed evidence (kiln-law suite → suite.log + suite.jsonl in the evidence dir), and the workflow gates tamper + evidence freshness + the lifecycle exit MECHANICALLY — a touched lock, stale evidence, or a failed flip auto-REJECTS with no reviewer spawned. A cross-FAMILY reviewer rules on diff + evidence with mechanical|logical finding classes and must re-run the mapped checks itself; the Sentinel escalates the feedback source after repeated logical rejections and stops a slice as split_required at the split threshold (a conductor/operator decision, never silent). After the slices integrate, the §3.2 milestone gate rules: Aristotle\'s goal-backward audit hunts "checks pass but the goal is broken" at EVERY milestone boundary — split/plan-abort failures included, where its findings merge into the failure record — and an unusable audit is re-asked ONCE, then fails the boundary closed (QA_FAIL, blocking finding goal-audit-failure; the judge NEVER spawns on missing inputs); milestones at the tribunal threshold add dual analysts (Ken/Opus ∥ Ryu/Codex) whose findings the deterministic reconcile folds with the audit\'s, and the judge is spawned ONLY on an ambiguous reconcile (zero blocking findings AND the analysts\' overall verdicts disagree) — otherwise the verdict is computed; below the threshold the slice review + the audit IS the gate. Velocity lever 3 (§9): the next milestone\'s slice plan is cut SPECULATIVELY in parallel with the current milestone\'s gate, anchored on its base_sha — any corrective commit on the current milestone (tribunal correction / validate loop) moves HEAD and invalidates it (ledgered slice_plan_invalidated), forcing a re-slice against the new HEAD. The heavy end-to-end gate is validate, not per-slice ceremony.',
  phases: [
    { title: 'The Forge Heats', detail: 'read the locked Law; rakim ensures the git repo + seeds codebase-state; parse the master plan into milestones' },
    { title: 'Scoring the Cut', detail: 'KRS-One plans the milestone\'s entire ordered slice list in ONE call, mapped to the Law\'s SC ids (reusing a valid pipelined plan from the prior gate when HEAD has not moved); a haiku confirm checks each slice against live state (proceed | replan)' },
    { title: 'Forging', detail: 'builder implements the slice (Opus for ui/mixed, GPT-5.5/Codex for logic) and commits it' },
    { title: 'The Trial', detail: 'the deterministic runner executes the Law — the exit code is the lifecycle verdict (declared flips + regressions) — and persists the project suite as hashed evidence; the workflow gates tamper + freshness + the flip plan mechanically; a cross-family reviewer re-runs the mapped checks and rules with classed findings; the Sentinel escalates on logical rejections' },
    { title: 'Judgment', detail: 'the §3.2 milestone gate — goal-backward audit at EVERY boundary (split/abort included; an unusable audit is re-asked once, then fails closed); dual analysts + deterministic reconcile at the tribunal threshold, the judge spawned only on an ambiguous reconcile; below it, slice review + the audit IS the gate. The next milestone\'s slice plan is pipelined in parallel here, anchored on base_sha and invalidated by any corrective commit' },
  ],
}

// ── args: { kilnDir, projectPath, codexAvailable, testingRigor, milestoneLimit, uiBuild, pluginRoot, posture, runToken, gateOnly } ──
function normalizeArgs(args) {
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { return { __parse_error: true } }
  }
  return (args && typeof args === 'object') ? args : {}
}
const A = normalizeArgs(args)
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('build.js requires args.kilnDir and args.projectPath')
const codexAvailable = A.codexAvailable !== false
const testingRigor = ['tdd', 'standard', 'minimal'].includes(String(A.testingRigor || '').toLowerCase()) ? String(A.testingRigor).toLowerCase() : 'standard'
const milestoneLimit = typeof A.milestoneLimit === 'number' ? A.milestoneLimit : Infinity
// uiBuild forces every milestone onto the ui surface (Opus builds, Codex reviews) — an optional override.
const uiBuild = A.uiBuild === true
// gateOnly is the P3.5 T3 (dogfood finding 4) STARVED-GATE retry path: re-run a milestone gate
// that was starved (session death mid-Judgment) over an ALREADY-COMPLETED build, without the
// 40-minute full re-build the v3 slicer otherwise forces (validateSlicePlan rejects a zero-slice
// plan while SCs remain uncovered, so a completed build re-enters through builder/confirm churn it
// does not need). Under gateOnly, Scoring the Cut and Forging are SKIPPED entirely — no slicer, no
// confirm, no builders. Per milestone: the same §3.4 floor gates, then ONE deterministic
// trial-shaped pass over ALL the milestone's SCs (kiln-law verify + run --only/--expect-green over
// every milestone SC — NO --flips: nothing is flipped, every SC must already be GREEN over the
// completed build) + the freshness probe + runnerGate. If the Law is not fully green the milestone
// REFUSES (QA_FAIL, reason gate-only-on-red — never a red gate, never a skipped build); if green it
// routes CONSERVATIVELY to the FULL tribunal (the historical slice count is unknown to a fresh
// session, so tribunalThreshold's fail-toward-scrutiny doctrine applies — gate-only never lowers
// the gate). The tribunal correction loop stays available and runs the NORMAL build+trial path.
const gateOnly = A.gateOnly === true
// pluginRoot is the conductor-resolved absolute $PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). In v3 it is LOAD-BEARING: the kiln-law CLI (the §3.4 Law floor) and the
// kiln-state ledger live under it. Its absence is gated below — never a silent v2-style build.
const pluginRoot = A.pluginRoot

// ── BUILD_RUN_TOKEN (BLUEPRINT §7 / discipline-spec lifecycle step 3) — this build stage's own,
//    stage-scoped browser kill token. The discipline-spec post-check cleanup is RUN-TOKEN scoped:
//    a sweep must reap only THIS stage's browser survivors, never a concurrent Kiln run's (a
//    validate-stage Tier-2 traversal, a parallel build in another project). So the stage mints one
//    token here and threads it as the kiln-law `--run-prefix` into EVERY check run — every probe
//    kiln-law spawns is named kiln-pw-<runId>-<SC>-<entropy> and its runId now begins with this
//    token, so `kiln-probe sweep <BUILD_RUN_TOKEN>` matches exactly this build's probe trees and
//    nothing else. Charset is the inert token charset (it becomes a pkill -f / readdir pattern).
//    Date.now()/Math.random are FORBIDDEN in workflow scripts (runtime determinism guard — breaks
//    resume), so the token comes from args.runToken (the conductor mints one per run via
//    kiln-state, which runs in agents where clocks are legal) with a deterministic projectPath-hash
//    fallback: cross-run uniqueness is the conductor's job, and concurrent runs of ONE project are
//    unsupported by the state contract anyway. The reviewer's independent rerun threads the same prefix. ──
const tokenHash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36) }
const BUILD_RUN_TOKEN = `kbuild-${String(A.runToken || tokenHash(String(projectPath))).replace(/[^A-Za-z0-9._-]/g, '-')}`

// ── The Gauge posture (BLUEPRINT §3.2/§3.3) — passed by the conductor from state.json. Accepts an
//    object or a JSON-encoded string; anything else ⇒ null ⇒ every dial below falls back to its
//    v2-equivalent default, so a run without a posture behaves exactly like v2 plus the §3.4 Law
//    floor (which is unconditional). ──
const postureArg = (() => {
  let p = A.posture
  if (typeof p === 'string') { try { p = JSON.parse(p) } catch (e) { return null } }
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null
})()
// ── The Gauge config (GAUGE_CONFIG, inlined from gauge-config.json by the bundler — workflow
//    scripts cannot import JSON; --check guards the inline copy against drift). The Sentinel
//    thresholds (rejections_to_feedback_escalation / rejections_to_split) live here. ──
const GAUGE_CONFIG = {"h80_human_hours":2,"messiness_discount":0.5,"churn_flips_threshold":2,"rejections_to_feedback_escalation":2,"rejections_to_split":3,"deescalation_clean_window":1,"research_topics_base":2,"planning_dual_d4_min":2,"planning_dual_d3_min":1,"planning_dual_d1_min":1,"planning_redteam_d4_min":1,"planning_redteam_d8_min":1,"plan_validation_rounds_base":1,"plan_validation_d2_min":1,"plan_validation_d8_min":2,"slice_budget_d7_min":1,"d7_slice_budget_factor":0.5,"review_high_d8_min":1,"min_slices_for_tribunal":2,"trivial_tier_dim_max":0,"tribunal_threshold_trivial_bump":1,"browser_tier2_d7_min":1,"browser_tier2_d8_min":1,"validate_adversarial_d8_min":2,"validate_second_family_d8_min":2,"effort_bias_dims":["D3","D4","D8"]}
// livePosture is the Sentinel's MUTABLE working copy (§3.3): escalate() raises dials mid-milestone
// and NOTHING in this script ever lowers one — builder self-confidence included. De-escalation
// needs the profile + clean-window evidence (a boundary move owned by the conductor in a later
// phase), so raised dials carry forward across milestones: strictly MORE scrutiny, never less.
// Defaults are v2-equivalent: review effort 'medium' baseline (the §3.2 row's base — D8 raises it
// via the posture arg), the §3.3 slice budget, floor values everywhere else (the ratchet can only
// raise them). The milestone_gate dials are CONSUMED by the Judgment gate below:
// min_slices_for_tribunal decides dual-analysts-vs-slice-review-as-gate, and goal_backward
// (default ON) is the operator's only way to skip the boundary audit — a skip is ledgered (§3.5).
const P0 = postureArg || {}
const PR = (P0.review && typeof P0.review === 'object') ? P0.review : {}
const PG = (P0.milestone_gate && typeof P0.milestone_gate === 'object') ? P0.milestone_gate : {}
const PB = (P0.browser && typeof P0.browser === 'object') ? P0.browser : {}
const PV = (P0.validate && typeof P0.validate === 'object') ? P0.validate : {}
let livePosture = {
  research_topics_max: typeof P0.research_topics_max === 'number' ? P0.research_topics_max : GAUGE_CONFIG.research_topics_base,
  planning: typeof P0.planning === 'string' ? P0.planning : 'single',
  plan_validation_rounds: typeof P0.plan_validation_rounds === 'number' ? P0.plan_validation_rounds : 1,
  slice_budget_hours: typeof P0.slice_budget_hours === 'number' ? P0.slice_budget_hours : GAUGE_CONFIG.h80_human_hours * GAUGE_CONFIG.messiness_discount,
  review: { ui_effort_base: PR.ui_effort_base === 'high' ? 'high' : 'medium', escalate_on: 'fix_cycle' },
  milestone_gate: { min_slices_for_tribunal: typeof PG.min_slices_for_tribunal === 'number' ? PG.min_slices_for_tribunal : GAUGE_CONFIG.min_slices_for_tribunal, goal_backward: PG.goal_backward !== false },
  browser: { tier2_per_milestone: PB.tier2_per_milestone === true },
  validate: { adversarial_pass: PV.adversarial_pass === true, second_family: PV.second_family === true },
  effort_bias: typeof P0.effort_bias === 'number' ? P0.effort_bias : 0,
}

// Bounds (the runaway/ceremony guards).
const MAX_SLICES_PER_MILESTONE = 12 // guard on the batch plan + replan splice — bounds a runaway slicer
const MAX_REVIEW_FIXES = 3          // per-slice cross-family review fix cycles (the Sentinel's split threshold usually fires first on logical findings)
const MAX_TRIBUNAL_CORRECTION = 1   // single-pass tribunal: one corrective pass, then escalate to validate

const docsDir = `${kilnDir}/docs`
const qaDir = `${kilnDir}/tmp/qa`
const designDir = `${kilnDir}/design`
const masterPlanFile = `${kilnDir}/master-plan.md`
const handoffFile = `${kilnDir}/architecture-handoff.md`
const codebaseStateFile = `${docsDir}/codebase-state.md`
const codebaseMapFile = `${docsDir}/codebase-map.md`
const lawFile = `${kilnDir}/law.json`

// ── MODEL_VOICE — the thin model-tuned shell (Opus only; the Codex leg is shaped by the wrapper) ──
const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')

// ── Lore display layer (NEVER enters a model prompt — labels + log lines only) ──
// Canonical copy lives in data/duo-pool.json (conductor reads that); the bundler's duo-pool step
// regenerates this inline display copy from that JSON (workflow scripts cannot import JSON), so
// the two can no longer drift.
const DUO_POOL = {
  default: [['codex', 'sphinx'], ['tintin', 'milou'], ['mario', 'luigi'], ['lucky', 'luke']],
  fallback: [['kaneda', 'tetsuo'], ['athos', 'porthos']],
  ui: [['clair', 'obscur'], ['yin', 'yang']],
}
const poolKey = (surf) => (surf === 'ui' || surf === 'mixed') ? 'ui' : (codexAvailable ? 'default' : 'fallback')
const pickDuo = (surf, mi) => { const p = DUO_POOL[poolKey(surf)]; return p[((mi % p.length) + p.length) % p.length] } // deterministic off milestone index
const loreLabel = (name, role, suffix) => `${name}:${role}${(suffix != null && suffix !== '') ? ':' + suffix : ''}`
const SPIN = {
  slice: ['KRS-One scores the whole record in one take', 'Knowledge reigns — the ledger before the blade', 'KRS-One raises the bar', 'Thinkin\' of a master plan'],
  build: ['Codex is typing — don\'t interrupt', 'Clair paints', 'The forge takes the blow', 'Codex says \'trust me\' — famous last words'],
  law: ['The Law runs — exit codes do not negotiate', 'Asimov reads the receipts', 'Evidence first, judgment second', 'The tamper gate never blinks'],
  review: ['Sphinx inspects every single line', 'Sphinx found something. Sphinx always finds something', 'Obscur holds the work to the light', 'The code stands trial'],
  qa: ['Ken and Ryu circle the build', 'Two reports walk in, one truth walks out', 'Judge Dredd reads the evidence', 'Denzel finds the signal'],
}
const spin = (k, i) => { const a = SPIN[k] || []; return a.length ? a[((i % a.length) + a.length) % a.length] : '' }

// ── Schemas (additionalProperties:false; reasoning/rationale FIRST = reason-before-emit) ──
const MILESTONES_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    milestones: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' }, title: { type: 'string' },
          summary: { type: 'string' }, acceptance: { type: 'string' },
          surface: { type: 'string', enum: ['ui', 'logic', 'mixed'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['id', 'title', 'summary', 'acceptance', 'surface', 'confidence'],
      },
    },
  },
  required: ['reasoning', 'milestones'],
}
const LAW_READ_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    locked: { type: 'boolean', description: 'true iff lock_commit is a non-null string' },
    checks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string' }, milestone: { type: 'string' }, kind: { type: 'string', enum: ['shell', 'pytest', 'http', 'probe'] } },
        required: ['id', 'milestone', 'kind'],
      },
    },
  },
  required: ['locked', 'checks'],
}
const SLICE_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    slices: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          objective: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          constraints: { type: 'string' },
          done_when: { type: 'string', description: 'a single runnable check that proves this slice' },
          sc_ids: { type: 'array', items: { type: 'string' }, description: 'the law.json SC ids this slice flips RED→GREEN — every milestone SC in EXACTLY one slice' },
        },
        required: ['objective', 'done_when', 'sc_ids'],
      },
    },
  },
  required: ['reasoning', 'slices'],
}
const CONFIRM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    decision: { type: 'string', enum: ['proceed', 'replan'] },
    reason: { type: 'string', description: 'the concrete contradiction with codebase-state (replan only)' },
  },
  required: ['reasoning', 'decision'],
}
const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    slice_id: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    tests_added: { type: 'array', items: { type: 'string' } },
    red_confirmed: { type: 'boolean', description: 'tests were observed failing before implementation (false is fine for a static page)' },
    tests_green: { type: 'boolean', description: 'the check/suite passes after implementation' },
    committed: { type: 'boolean' },
    test_command: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['reasoning', 'tests_green', 'committed', 'evidence'],
}
const RUNNER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    verify_exit: { type: 'number', description: 'exit code of kiln-law verify (step 1)' },
    tamper_paths: { type: 'array', items: { type: 'string' }, description: 'every path from a TAMPER: line, any step (empty if none)' },
    law_run_exit: { type: 'number', description: 'exit code of kiln-law run (step 2) — the §5.1 lifecycle verdict the workflow gates on mechanically' },
    flip_unmet: { type: 'array', items: { type: 'string' }, description: 'every id from a FLIP_UNMET line of step 2, verbatim (empty if none or step 2 never ran)' },
    regressed: { type: 'array', items: { type: 'string' }, description: 'every id from a REGRESSION line of step 2, verbatim (empty if none or step 2 never ran)' },
    run_id: { type: 'string', description: 'verbatim from the RUN <runId> HEAD <head> line' },
    head: { type: 'string', description: 'verbatim HEAD sha from the RUN line' },
    suite_cmd: { type: 'string', description: 'the project suite command kiln-law suite ran (step 3)' },
    suite_exit: { type: 'number', description: 'the REAL suite exit from step 3\'s SUITE line (its output is persisted as suite.log + suite.jsonl in the evidence dir)' },
  },
  required: ['reasoning', 'verify_exit', 'tamper_paths', 'flip_unmet', 'regressed'],
}
const FRESHNESS_SCHEMA = {
  // The §6 freshness transcript: current HEAD (sha + commit epoch) and the evidence's OWN anchors
  // (run.json, written by kiln-law itself) + a re-hash of results.jsonl. Absence sentinels are ''
  // (strings) and -1 (epochs) — runnerGate fails closed on them; transcribe, never infer.
  type: 'object', additionalProperties: false,
  properties: {
    results_jsonl_exists: { type: 'boolean' },
    head: { type: 'string', description: 'git rev-parse HEAD — the full sha' },
    head_committed_epoch: { type: 'number', description: 'git show -s --format=%ct HEAD — the commit epoch seconds (-1 if git failed)' },
    manifest_head: { type: 'string', description: 'the "head" field of the evidence dir\'s run.json, verbatim ("" if the file or field is missing)' },
    manifest_results_sha256: { type: 'string', description: 'the "results_sha256" field of run.json, verbatim ("" if missing — an unfinalized/aborted run has none)' },
    manifest_completed_epoch: { type: 'number', description: 'the "completed_at" field of run.json (-1 if missing)' },
    results_sha256: { type: 'string', description: 'sha256 of results.jsonl as YOU computed it ("" if the file is missing)' },
    manifest_verification_class: { type: 'string', description: 'the "verification_class" field of run.json, verbatim ("" if missing) — "full" when every probe executed, "static-only" when any probe deferred' },
  },
  required: ['results_jsonl_exists', 'head', 'head_committed_epoch', 'manifest_head', 'manifest_results_sha256', 'manifest_completed_epoch', 'results_sha256', 'manifest_verification_class'],
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    verdict: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
    law_green: { type: 'boolean', description: 'the slice\'s mapped SC checks pass as YOU re-ran them via kiln-law (instantiated probes EXECUTE in the rerun; PROBE_DEFERRED/PROBE_UNAVAILABLE lines are honest deferrals — neither red nor green)' },
    tests_green: { type: 'boolean', description: 'green as the reviewer re-ran it (not as the builder reported)' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          text: { type: 'string', description: 'specific and actionable, [file:line] where possible' },
          finding_class: { type: 'string', enum: ['mechanical', 'logical'], description: 'mechanical = hygiene/formatting/missing-file/simple slip; logical = wrong behavior, failed check, broken contract or design' },
        },
        required: ['text', 'finding_class'],
      },
    },
  },
  required: ['reasoning', 'verdict', 'law_green', 'tests_green', 'findings'],
}
const QA_FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    report_file: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { text: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } },
        required: ['text', 'severity'],
      },
    },
    // §3.2 judge-spawn condition input: the gate computes analyst DISAGREEMENT from this field —
    // a 'fail' MUST be backed by at least one critical|high finding, or the deterministic
    // reconcile (blocking = any critical|high) reads it as noise.
    overall: { type: 'string', enum: ['pass', 'fail'], description: 'your independent overall verdict on the milestone — \'fail\' MUST be backed by at least one critical or high finding' },
  },
  required: ['reasoning', 'findings', 'overall'],
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    verdict: { type: 'string', enum: ['QA_PASS', 'QA_FAIL'] },
    findings: { type: 'array', items: { type: 'string' } },
    severity: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
  },
  required: ['reasoning', 'verdict', 'findings'],
}

// ── denzelReconcile — PURE function, no agent call. Dedupe by normalized text, max-severity wins,
//    blocking = any critical|high. A deterministic blocking gate the judge cannot soften away. ──
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 }
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
function denzelReconcile(repA, repB) {
  const all = [...((repA && repA.findings) || []), ...((repB && repB.findings) || [])]
  const byKey = new Map()
  for (const f of all) {
    if (!f || !f.text) continue
    const k = norm(f.text); const sev = SEV_RANK[f.severity] || 1
    const prev = byKey.get(k)
    if (!prev || sev > prev.rank) byKey.set(k, { text: f.text, severity: f.severity, rank: sev })
  }
  const merged = [...byKey.values()].sort((x, y) => y.rank - x.rank)
  const blocking = merged.filter((f) => f.rank >= SEV_RANK.high)
  return { findings: merged, blocking, hasBlocking: blocking.length > 0, summaryLines: merged.map((f) => `[${f.severity}] ${f.text}`) }
}

// ── The build-spine mechanical core (BLUEPRINT §5.1/§6/§3.2) + the Sentinel ratchet (§3.3) —
//    inlined pure logic, unit-tested in src/spine.mjs and src/gauge.mjs. The coverage arithmetic,
//    the tamper/freshness gate, the milestone-gate judge-spawn decision, and the escalation
//    policy run IN THE SCRIPT, never in an agent. ──
function validateSlicePlan(slices, milestoneScIds) {
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
function runnerGate(runner, probe) {
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
function gateOnlyRefusal(gate) {
  const g = (gate && typeof gate === 'object' && !Array.isArray(gate)) ? gate : null
  if (g && g.verdict === 'proceed') return { refuse: false, reason: '', detail: '' }
  const verdict = g && typeof g.verdict === 'string' ? g.verdict : 'no-gate'
  const reasons = (g && Array.isArray(g.reasons)) ? g.reasons.filter((r) => typeof r === 'string' && r) : []
  const why = reasons.length ? reasons.join('; ') : (g ? `the gate returned '${verdict}' without naming reasons` : 'the trial produced no gate verdict')
  return {
    refuse: true,
    reason: 'gate-only-on-red',
    detail: `gate-only refused — the Law is not fully green over the completed build (trial verdict '${verdict}': ${why}). gate-only re-runs a starved gate over a completed build; it never gates a red Law and never skips building.`,
  }
}
function probeGate(surface, gate) {
  const surf = (surface === 'ui' || surface === 'mixed') ? surface : 'logic'
  const vc = (gate && typeof gate === 'object' && typeof gate.verification_class === 'string') ? gate.verification_class : ''
  if (surf === 'logic') return { action: 'pass', verification_class: vc || 'full', reason: '' }
  if (vc === 'full') return { action: 'pass', verification_class: 'full', reason: '' }
  if (vc === 'static-only') {
    return { action: 'degrade', verification_class: 'static-only', reason: 'a mapped probe was deferred (playwright absent → exit 78, an un-instantiated template, or --skip-probes) — no browser-probe evidence for this ui slice; the review falls back to the static checks, ledgered probe_unavailable, verification_class static-only (honest degradation, never silently green)' }
  }
  return { action: 'reject', verification_class: vc, reason: `the ui slice carries no readable verification_class (${JSON.stringify(vc)}) — whether probe verification was degraded cannot be proven; fail closed rather than pass a ui gate as fully verified` }
}
function rejectionClass(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) return 'mechanical'
  const findings = Array.isArray(review.findings) ? review.findings : []
  if (findings.some((f) => f && f.finding_class === 'logical')) return 'logical'
  return findings.length ? 'mechanical' : 'logical'
}
function tribunalThreshold(sliceCount, minSlices) {
  const n = (typeof sliceCount === 'number' && Number.isFinite(sliceCount)) ? sliceCount : 0
  const min = (typeof minSlices === 'number' && Number.isFinite(minSlices) && minSlices >= 1) ? minSlices : 1
  return n >= min
}
function gateDecision(reconciled, overallA, overallB) {
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
function goalAuditUsable(report) {
  return !!(report && typeof report === 'object' && !Array.isArray(report)
    && (report.overall === 'pass' || report.overall === 'fail')
    && Array.isArray(report.findings))
}
function pipelineInvalidated(baseSha, headShaArg) {
  const base = typeof baseSha === 'string' ? baseSha.trim() : ''
  const head = typeof headShaArg === 'string' ? headShaArg.trim() : ''
  if (!base) return { invalidated: true, reason: 'the pipelined plan recorded no base_sha — its launch HEAD is unknown, so freshness cannot be proven; re-slice against the current HEAD' }
  if (!head) return { invalidated: true, reason: 'the current HEAD is unreadable — freshness cannot be proven; re-slice against the current HEAD' }
  if (base !== head) return { invalidated: true, reason: `a corrective commit moved the milestone HEAD since the pipelined plan was cut (base_sha ${base}, current HEAD ${head}) — the speculative plan is stale; re-slice against the new HEAD` }
  return { invalidated: false, reason: '' }
}
function escalate(posture, signal, config) {
  // §3.3 signal shapes, ranked by evidence strength:
  //   { type: 'review_rejection', finding_class: 'logical'|'mechanical', rejections: n }
  //     the master signal; escalation keys on LOGICAL findings only. At
  //     rejections_to_feedback_escalation: escalate the FEEDBACK SOURCE (stronger or
  //     different-family reviewer), not the retry count. At rejections_to_split:
  //     split-and-rebuild (genesis 3.4).
  //   { type: 'test_churn', flips: n }      — same check flipping pass<->fail across fix cycles
  //   { type: 'diff_size_exceeded' }        — diff size beyond the slicer estimate
  //   { type: 'slice_growth' }              — slice count grows beyond the estimate
  //   { type: 'analyst_disagreement' }      — the tribunal analysts disagree
  //   { type: 'validate_coverage_gap' }     — retroactively raises remaining milestones' posture
  //   { type: 'builder_confidence', level: 'low'|'high' } — may only RAISE scrutiny ('low');
  //     'high' is a no-op, never a downgrade.
  // Unknown/malformed signals are a recorded no-op — the ratchet never throws mid-pipeline.
  const next = {
    scope_tier: posture.scope_tier,
    research_topics_max: posture.research_topics_max,
    planning: posture.planning,
    plan_validation_rounds: posture.plan_validation_rounds,
    slice_budget_hours: posture.slice_budget_hours,
    review: { ...posture.review },
    milestone_gate: { ...posture.milestone_gate },
    browser: { ...posture.browser },
    validate: { ...posture.validate },
    effort_bias: posture.effort_bias,
  }
  const changes = []
  const set = (dial, obj, key, value) => {
    if (obj[key] === value) return // already at or above — the ratchet only records real moves
    changes.push({ dial, from: obj[key], to: value })
    obj[key] = value
  }
  // every raise is one-directional: medium->high, false->true, effort_bias capped at 2
  const raiseReview = () => set('review.ui_effort_base', next.review, 'ui_effort_base', 'high')
  const raiseBias = () => set('effort_bias', next, 'effort_bias', Math.min(2, next.effort_bias + 1))
  const raiseTier2 = () => set('browser.tier2_per_milestone', next.browser, 'tier2_per_milestone', true)
  const raiseAdversarial = () => set('validate.adversarial_pass', next.validate, 'adversarial_pass', true)
  let action = 'none'
  const t = (signal && signal.type) || 'unknown'
  if (t === 'review_rejection' && signal.finding_class === 'logical') {
    if (signal.rejections >= config.rejections_to_split) { action = 'split_and_rebuild'; raiseReview(); raiseBias() }
    else if (signal.rejections >= config.rejections_to_feedback_escalation) { action = 'escalate_feedback_source'; raiseReview() }
  } else if (t === 'test_churn' && signal.flips >= config.churn_flips_threshold) {
    action = 'raise_scrutiny'; raiseReview(); raiseBias()
  } else if (t === 'diff_size_exceeded') {
    action = 'raise_scrutiny'; raiseReview()
  } else if (t === 'slice_growth') {
    action = 'raise_scrutiny'; raiseBias()
  } else if (t === 'analyst_disagreement') {
    action = 'raise_scrutiny'; raiseReview(); raiseBias()
  } else if (t === 'validate_coverage_gap') {
    action = 'raise_scrutiny'; raiseTier2(); raiseAdversarial(); raiseBias()
  } else if (t === 'builder_confidence' && signal.level === 'low') {
    action = 'raise_scrutiny'; raiseReview()
  }
  return { posture: next, reason: { event: 'posture_escalate', signal: t, action, changes } }
}

// ── Routing: builder family != reviewer family, derived in ONE place ──
// ui/mixed → Opus builds, GPT/Codex reviews · logic → GPT/Codex builds, Opus reviews.
function surfaceOf(m) {
  if (uiBuild) return 'ui'
  const s = String((m && m.surface) || '').toLowerCase()
  return (s === 'ui' || s === 'mixed') ? s : 'logic'
}
function routing(surf) {
  // The 'sonnet' model on a build/review leg is the thin Codex wrapper (delegates to GPT-5.5 via codex exec).
  return (surf === 'ui' || surf === 'mixed')
    ? { buildModel: 'opus', reviewModel: 'sonnet' }   // Opus builds, Codex reviews
    : { buildModel: 'sonnet', reviewModel: 'opus' }   // Codex builds, Opus reviews
}
// reviewLeg(surf, escalated) — §3.3 feedback-source escalation: after
// rejections_to_feedback_escalation LOGICAL rejections, the feedback source changes. T1..T4 name
// the §8 CAPABILITY-LADDER tiers (T1 Sonnet-only / T2 +Opus / T3 +Codex / T4 +Fable), and
// codexAvailable is the one observable tier discriminant this workflow receives (§12 doctor
// probe): true ⟺ T3+. T3+ swaps the reviewer FAMILY — the stuck loop gets genuinely different
// eyes, and codex is the only second family on board. T1/T2 has NO second family, so escalation
// is a fresh-context stronger-effort reviewer instead (Opus, the strongest seat available;
// reviewEffort forces 'high' on escalated legs). viaCodex says whether this leg shells out to codex.
function reviewLeg(surf, escalated) {
  const base = routing(surf).reviewModel
  if (!escalated) return { model: base, viaCodex: codexAvailable && base === 'sonnet', escalated: false }
  if (codexAvailable) {
    const swapped = base === 'opus' ? 'sonnet' : 'opus'
    return { model: swapped, viaCodex: swapped === 'sonnet', escalated: true }
  }
  return { model: 'opus', viaCodex: false, escalated: true }
}
// Codex review effort (§3.2 slice-review row): 'medium' baseline; 'high' iff the posture says so
// (D8≥1 → ui_effort_base 'high', and the Sentinel ratchet can raise it mid-run) OR fix-cycle>0
// (posture.review.escalate_on) OR the feedback source was escalated.
const reviewEffort = (fix, escalated) => (livePosture.review.ui_effort_base === 'high' || fix > 0 || escalated) ? 'high' : 'medium'

// Review verdict helpers. approvedOf is the ONE approval predicate: verdict, the reviewer's own
// suite re-run, AND the reviewer's own kiln-law re-run (§6 independent-rerun floor) must all hold.
const approvedOf = (rev) => !!(rev && rev.verdict === 'APPROVED' && rev.tests_green !== false && rev.law_green !== false)
const findingLines = (rev) => ((rev && rev.findings) || []).map((f) => f && f.text).filter(Boolean)
// autoReject — the workflow's own REJECTED verdict (commit-before-review, tamper, stale evidence).
// Always 'mechanical': these are process failures, not defect signals — they must not push the
// Sentinel toward feedback escalation or a split (§3.3 keys on logical findings only).
const autoReject = (texts) => ({ verdict: 'REJECTED', law_green: false, tests_green: false, findings: texts.map((t) => ({ text: t, finding_class: 'mechanical' })) })
// lawRedReject — the workflow's REJECTED verdict for a RED lifecycle gate (kiln-law run --flips
// exited non-zero: a declared flip did not go RED→GREEN, or a previously-GREEN check regressed).
// Classed 'logical' deliberately, in contrast with autoReject: a failed check is the finding
// taxonomy's own definition of logical ("wrong behavior, failed check") and a GENUINE defect
// signal — a slice that repeatedly cannot flip its Law should march the §3.3 ratchet toward
// split_required exactly like reviewer-caught wrong behavior (scrutiny may only rise).
const lawRedReject = (texts) => ({ verdict: 'REJECTED', law_green: false, tests_green: false, findings: texts.map((t) => ({ text: t, finding_class: 'logical' })) })
// The ORCHESTRATOR RULING's blocking finding (p2/tasks.md "Gate failure semantics"): a
// goal-backward audit still unusable after its ONE re-ask fails the milestone boundary closed.
const GOAL_AUDIT_FAILURE = `[goal-audit-failure] the goal-backward audit returned no usable report after one re-ask — the boundary fails closed (QA_FAIL; orchestrator ruling 2026-06-11)`

const NO_WANDER = 'Read ONLY the files named in this brief (absolute paths). Do not search the filesystem or read other projects.'
const repoRule = (projectPath) => `Project repo: ${projectPath}. Work and commit there directly — this is a sequential cumulative build; do NOT create a detached git worktree (later slices and milestones must see your commits). Maintain a .gitignore for the stack and NEVER commit generated artifacts (Python: __pycache__/, *.pyc, *.egg-info/, build/, dist/, .pytest_cache/) — add them to .gitignore and 'git rm --cached' any that slipped in.`
const scope = NO_WANDER
const repoRuleLine = repoRule(projectPath)
// The wrapper TRANSLATES the brief into a 4-part Codex prompt — it never forwards it verbatim.
// The full discipline (per-role flags, --output-schema/reasoning-first/flat-schema, heredoc-to-stdin,
// the codex #15451 caveat) lives in references/codex-prompt-guide.md — point at it, don't duplicate it.
const codexGuide = pluginRoot ? `${pluginRoot}/references/codex-prompt-guide.md` : null
const codexHowto = codexGuide
  ? `You shell out to GPT-5.5 via 'codex exec'. Read ${codexGuide} and follow it — it is the single source of truth for the codex-prompt discipline (TRANSLATE the brief, never forward it; per-role flags; --output-schema/reasoning-first/flat-schema; the heredoc-to-stdin invocation; the exit-0 and #15451 caveats). If GPT-5.5 is unavailable retry with -m gpt-5.4; if codex still produces no usable artifact, do the work directly.`
  : `You shell out to GPT-5.5 via 'codex exec': TRANSLATE this brief into a Codex-native prompt (do not forward it verbatim), pipe it via stdin, and close the verify loop on the test command. If GPT-5.5 is unavailable retry with -m gpt-5.4; if codex still produces no usable artifact, implement directly with your file tools.`

// Shipped design references the UI builder consults for visual/design decisions — injected only when
// pluginRoot is known (a launched Workflow can't resolve plugin paths on its own; absence degrades out).
const designRefsNote = pluginRoot
  ? `- Read the design references at ${pluginRoot}/references/design/design-system.md (token architecture) and ${pluginRoot}/references/design/design-patterns.md (modern-CSS techniques) by absolute path and follow them for visual/design decisions.\n`
  : ``

// One-line pointer for the other codex-shelling legs (reviewers, Ryu QA) — the logic builder gets it
// via codexHowto. Same single source of truth; gated on pluginRoot so absence degrades gracefully.
const codexGuideNote = codexGuide
  ? `Read ${codexGuide} first and follow it for the full codex-prompt discipline (per-role flags — run codex at the model_reasoning_effort this prompt specifies — the --output-schema/reasoning-first/flat-schema rules, the heredoc-to-stdin invocation, and the exit-0 and #15451 caveats). `
  : ``

// ── Prompt builders (functional role+stance only; persona names live in labels, never here) ──
// The §5 Law block every builder receives: outcome-phrased (done = the SC checks pass), with the
// immutability warning — the tamper gate auto-rejects mechanically, so the warning is real.
// The builder's kiln-law run is stage-tokened (--run-prefix BUILD_RUN_TOKEN) so the stage-end sweep
// can reap a hard-killed builder's probe tree — kiln-law's per-run bracket covers normal exits only (DOGFOOD FINDING 6).
function lawLines(slice) {
  const ids = slice.sc_ids.join(',')
  return `- THE LAW (locked acceptance gates): this slice is DONE only when its mapped checks pass — ${slice.sc_ids.join(', ')}. ` +
    `Execute them any time with 'node ${pluginRoot}/scripts/kiln-law.mjs run ${projectPath} ${kilnDir} --only ${ids} --run-prefix ${BUILD_RUN_TOKEN}' (PROBE_DEFERRED lines are deferred probe templates — fine; their evidence arrives in a later phase).\n` +
    `- The gate files under tests/acceptance/ and ${lawFile} are LOCKED — NEVER edit, move, or delete them: the tamper gate re-hashes them against the lock commit and a touched lock auto-rejects the slice with no reviewer and no appeal. ADD new tests anywhere else freely.\n`
}

function slicePlanPrompt(m, surf, scs, built, note) {
  const scLines = scs.map((c) => `  - ${c.id} [${c.kind}]`).join('\n')
  const builtLines = built.length
    ? built.map((s, i) => `  ${i + 1}. ${s.objective} — flipped: ${(s.sc_ids || []).join(', ') || '(none)'}`).join('\n')
    : '  (none yet)'
  return voice('opus') +
    `You are the batch slice planner: in ONE call, plan this milestone's ENTIRE remaining slice list — every vertical slice in dependency order, each mapped to the locked Law checks it flips RED→GREEN.\n\n` +
    `<inputs>\n` +
    `- Milestone ${m.id} "${m.title}" [surface=${surf}] — acceptance: ${m.acceptance}\n` +
    `- Summary: ${m.summary || '(none)'}\n` +
    `- THE LAW for this milestone — the locked checks that define done (id [kind]):\n${scLines}\n` +
    `- Slices already built this milestone:\n${builtLines}\n` +
    `- Read ${codebaseStateFile} and ${masterPlanFile} for what currently exists and what the milestone owes.\n` +
    `</inputs>\n\n` +
    `<constraints>\n` +
    `- ${scope}\n` +
    `- A slice = ONE distinct, independently-runnable user-facing behavior that can be invoked and verified on its own by a single runnable check (a CLI subcommand, an API call, a rendered-and-exercised page, one pure function). Decompose the milestone by such behaviors, in dependency order: a multi-command CLI gives a slice per command (add / list / done / rm), a CRUD resource a slice per operation.\n` +
    `- Do NOT manufacture slices. If a candidate part has no runnable check distinct from another's, FOLD it. A single render artifact (one page — its hero, countdown, and rows share the one render check), one endpoint, or one pure function is ONE slice; a region that only renders within a page is never its own slice. Scaffolding, packaging, config, and shared storage are NEVER their own slice — they ride inside the FIRST behavior slice that needs them (e.g. the JSON store folds into add).\n` +
    `- SC coverage is ARITHMETIC, not judgment: every Law check id listed above must appear in EXACTLY ONE slice's sc_ids (none missing, none twice), and every slice must flip at least one. 'probe'-kind checks are deferred templates this phase — still assign each to the slice that builds its surface.\n` +
    `- Slice budget (the Gauge): size each slice at roughly ≤ ${livePosture.slice_budget_hours}h human-equivalent of work; smaller, verifiable slices beat bloated ones. Emit at most ${MAX_SLICES_PER_MILESTONE} slices.\n` +
    `</constraints>\n\n` +
    (note ? `<correction>\n${note}\n</correction>\n\n` : '') +
    `<task>Return the ordered slice list: each {objective, files[], constraints, done_when, sc_ids[]} with a zero-ambiguity done_when. Report reasoning first.</task>`
}

function confirmPrompt(m, slice) {
  return `You are the slice confirmer — a cheap pre-build drift check, not a reviewer.\n\n` +
    `<inputs>\n` +
    `- Next planned slice for milestone ${m.id}: ${slice.objective}\n` +
    `- Files in scope: ${(slice.files || []).join(', ') || '(builder decides)'}\n` +
    `- Done when: ${slice.done_when}. Flips: ${slice.sc_ids.join(', ')}\n` +
    `- Read ${codebaseStateFile} (the live codebase state). ${scope}\n` +
    `</inputs>\n\n` +
    `<task>Decide 'proceed' (the slice still matches the live state) or 'replan' ONLY on a concrete contradiction: the objective is already built, its files were restructured away, or its done_when is impossible as scoped. Doubt is not drift — when unsure, proceed. On replan, state the contradiction in reason. Report reasoning first.</task>`
}

function assetPrepPrompt(m) {
  return `You are the asset pre-processor for milestone ${m.id}. ${scope}\n\n` +
    `<task>Before the UI build, optimize heavy static assets ONCE so the builder spends effort on design, not tooling (this was the root cause of a 32-minute one-page build). Look for source images and fonts referenced by ${codebaseMapFile} or already present under ${projectPath}. If heavy assets exist AND the tools are already installed, recompress images (pngquant / oxipng / cwebp) and subset fonts (pyftsubset / fonttools) into ${designDir}/assets/ (mkdir -p first). If there are no heavy assets, or the tools are not installed, no-op and say so plainly — do NOT fail and do NOT install global packages.</task>`
}

function buildPrompt(m, surf, slice, sliceId, fixNote) {
  const fix = fixNote ? `\n<fix_required>\n${fixNote}\n</fix_required>\n` : ''
  const files = (slice.files || []).join(', ') || '(decide minimally)'
  if (surf === 'ui' || surf === 'mixed') {
    return voice('opus') +
      `You are the UI builder (Opus, design-led): implement vertical slice ${sliceId} as production-grade, self-contained vanilla HTML/CSS/JS (no framework, no CDN), then commit it.\n\n` +
      `<inputs>\n` +
      `- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
      `- Slice objective: ${slice.objective}\n` +
      `- Files in scope: ${files}\n` +
      `- Slice constraints: ${slice.constraints || '(none beyond the design system)'}\n` +
      `- Done when: ${slice.done_when || 'the slice objective is met and the static check passes'}\n` +
      `- Design system (read and obey): ${designDir}/tokens.css, ${designDir}/tokens.json, ${designDir}/creative-direction.md — consume the tokens, honor the creative direction AND its ban list.\n` +
      `- Content source: ${codebaseMapFile} and ${docsDir}/VISION.md — present ONLY what the map substantiates; invent no features, metrics, or images.\n` +
      `- Optimized assets, if present: ${designDir}/assets/ — already recompressed/subset; inline them as data-URIs and do NOT re-run image/font tooling.\n` +
      `</inputs>\n\n` +
      `<constraints>\n` +
      `- ${scope} ${repoRuleLine}\n` +
      lawLines(slice) +
      `- Keep the solution minimal; add no abstraction the slice does not require.\n` +
      designRefsNote +
      `- Craft any motion/effects at 60fps, gated by prefers-reduced-motion; never let an effect touch text contrast (keep AA).\n` +
      `- If the acceptance contract is "opens by double-click via file://", emit ONE inlined index.html (CSS and JS inlined) — Chrome blocks sibling file:// loads cross-origin. If it deploys over http instead, sibling files are fine; do not force-inline there.\n` +
      (surf === 'mixed' ? `- This is a MIXED slice — it also carries tightly-coupled non-visual logic: implement that cleanly and add a behavior/smoke test you run green, IN ADDITION to the static page check.\n` : ``) +
      `- Verify STATICALLY — do NOT launch a browser or Playwright (autonomous stages never spawn browsers; they leak memory). Confirm the HTML parses and required sections/ids exist, 'node --check' the JS, and assets/fonts are inlined. Live visual QA is a separate one-shot step outside this loop.\n` +
      `</constraints>${fix}\n` +
      `<task>Build the slice, run the static check, then 'git add -A && git commit' with a clear message. Report reasoning, files_changed, tests_added (smoke), red_confirmed (false is fine for a page), tests_green (the static/smoke check passed), committed, the check command, and concrete evidence of what you observed.</task>`
  }
  // logic slice — GPT-5.5/Codex builds (cross-family vs the Opus reviewer)
  const tdd = testingRigor === 'minimal'
    ? 'Write at least a smoke test and run it green.'
    : testingRigor === 'tdd'
      ? 'Strict TDD: write the acceptance tests FIRST, run them and CONFIRM THEY FAIL (red), then implement until green.'
      : 'Write the acceptance tests alongside the implementation and run the full suite green before finishing.'
  return `You are the slice builder for this logic milestone (slice ${sliceId}).\n\n` +
    `<inputs>\n` +
    `- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
    `- Slice objective: ${slice.objective}\n` +
    `- Files in scope: ${files}\n` +
    `- Slice constraints: ${slice.constraints || '(none)'}\n` +
    `- Done when: ${slice.done_when || 'the mapped Law checks pass'}\n` +
    `- Master plan: ${masterPlanFile}. Codebase state: ${codebaseStateFile}.\n` +
    `</inputs>\n\n` +
    `<constraints>\n` +
    `- ${scope} ${repoRuleLine}\n` +
    lawLines(slice) +
    `- ${tdd}\n` +
    `- Keep the implementation minimal; add no abstraction the slice does not require; no stubs or mocks standing in for required behavior.\n` +
    (codexAvailable ? `- ${codexHowto}\n` : `- Codex is unavailable — implement directly with your file tools.\n`) +
    `</constraints>${fix}\n` +
    `<task>Implement the slice to green tests, then 'git add -A && git commit' with a clear message. Report reasoning, files_changed, tests_added, red_confirmed, tests_green (must be true), committed, the test_command you used, and the trimmed passing test output as evidence.</task>`
}

function runnerPrompt(build, lawCtx, beforeRunId) {
  // The §5.1 lifecycle invocation (T2-fix ruling: the exit code IS the verdict): --flips declares
  // the slice's expected RED→GREEN set, --only also re-runs every SC this milestone already
  // turned green (so regressions are OBSERVED, not assumed), and --before anchors statusBefore in
  // the recorded evidence of the previous complete run — kiln-law computes the flip plan itself
  // (src/law.mjs flipPlan); no agent arithmetic, no prose state.
  //   The gateOnly variant (P3.5 T3, dogfood finding 4) re-runs a STARVED gate over an
  //   already-completed build: it asserts every milestone SC is GREEN NOW (--expect-green over the
  //   full --only scope, kiln-law's hard-greenness gate) and declares NO --flips — nothing is being
  //   flipped, so there is no RED→GREEN lifecycle and no statusBefore to anchor (--before is
  //   omitted). The exit code is still the verdict: any SC not green ⇒ non-zero ⇒ runnerGate 'red'
  //   ⇒ gateOnlyRefusal fires (gate-only-on-red). It never gates a red Law and never skips building.
  const only = lawCtx.only.join(',')
  const flips = lawCtx.flips.join(',')
  const lawArgs = lawCtx.gateOnly
    ? `--only ${only} --expect-green ${only}`
    : `--only ${only} --flips ${flips}${beforeRunId ? ` --before ${beforeRunId}` : ''}`
  const lawVerdictNote = lawCtx.gateOnly
    ? `(0 = every milestone SC is GREEN now over the completed build; non-zero = an SC is not green or a check regressed — the Law is red, gate-only refuses)`
    : `(0 = every declared flip went RED→GREEN and nothing previously-GREEN regressed; non-zero = the slice failed its Law)`
  const suite = (build && build.test_command) ? build.test_command : null
  return `You are the deterministic check runner — you execute and report; you never fix, never edit, never judge.\n\n` +
    `<task>Run these commands (Bash) IN THIS ORDER and report EXACTLY what you observe:\n` +
    `1. node ${pluginRoot}/scripts/kiln-law.mjs verify ${projectPath} ${kilnDir}\n` +
    `   verify_exit = its exit code. Collect every 'TAMPER: <path>' line's path into tamper_paths (empty array if none). If verify_exit is not 0, STOP — skip steps 2-3 and report what you have.\n` +
    `2. node ${pluginRoot}/scripts/kiln-law.mjs run ${projectPath} ${kilnDir} ${lawArgs} --run-prefix ${BUILD_RUN_TOKEN}\n` +
    `   law_run_exit = its exit code — the lifecycle VERDICT the workflow gates on mechanically ${lawVerdictNote}. From its 'RUN <runId> HEAD <head>' line report run_id and head VERBATIM. Collect every 'FLIP_UNMET <id>' line's id into flip_unmet and every 'REGRESSION <id>' line's id into regressed (empty arrays if none). Add any TAMPER paths to tamper_paths. RED/GREEN/PROBE_DEFERRED check lines are EVIDENCE — transcribe, never fix. If law_run_exit is not 0, STOP — skip step 3.\n` +
    (suite
      ? `3. node ${pluginRoot}/scripts/kiln-law.mjs suite ${projectPath} ${kilnDir} <runId> --cmd '${suite}'\n   Substitute <runId> with the run_id from step 2's RUN line. This runs the project suite and persists its output INTO the evidence dir (suite.log + a sha256'd result line in suite.jsonl). From its 'SUITE <runId> exit=<n> …' line report suite_exit = that <n>, verbatim; suite_cmd = the suite command itself.\n`
      : `3. No project suite command was recorded for this slice — skip this step (omit suite_cmd and suite_exit).\n`) +
    `Do not edit any file, do not commit, do not re-run with fixes — report the first observation honestly.</task>`
}

function freshPrompt(runId) {
  const dir = `${kilnDir}/evidence/${runId}`
  return `You are the evidence freshness probe — a fresh pair of eyes; trust nothing the runner reported. You TRANSCRIBE what the commands print — never infer, never repair (a missing file or field is a finding for the gate, not your problem to fix; report it with the absence sentinel '' or -1).\n\n` +
    `<task>Run (Bash) and transcribe EXACTLY:\n` +
    `1. 'ls ${dir}/results.jsonl' — results_jsonl_exists = true iff the file exists.\n` +
    `2. 'sha256sum ${dir}/results.jsonl' (or 'shasum -a 256' where sha256sum is unavailable) — results_sha256 = the hex digest, '' if the file is missing.\n` +
    `3. 'cat ${dir}/run.json' — the manifest kiln-law itself wrote into the evidence: manifest_head = its "head", manifest_results_sha256 = its "results_sha256", manifest_completed_epoch = its "completed_at", manifest_verification_class = its "verification_class" (sentinels '' / '' / -1 / '' when the file or a field is missing — an unfinalized manifest means the run never completed; verification_class is the §7 degradation record: 'full' = every probe executed, 'static-only' = some probe deferred).\n` +
    `4. 'git -C ${projectPath} rev-parse HEAD' — head = the full sha.\n` +
    `5. 'git -C ${projectPath} show -s --format=%ct HEAD' — head_committed_epoch = the number (-1 if git failed).\n` +
    `Do not read anything else, do not write or fix anything. Report the seven fields.</task>`
}

function reviewPrompt(m, surf, slice, sliceId, build, runner, leg, effort, vclass) {
  const ids = slice.sc_ids.join(',')
  const evidenceDir = `${kilnDir}/evidence/${runner.run_id}`
  const evidenceBlock =
    `- SC mapping: this slice claims ${slice.sc_ids.join(', ')}.\n` +
    `- Hashed evidence from the deterministic runner (tamper-gated, freshness-verified at HEAD ${runner.head}): ${evidenceDir}/results.jsonl + per-check logs under ${evidenceDir}/checks/.` +
    (typeof runner.suite_exit === 'number' ? ` Project suite ('${runner.suite_cmd || ''}') exited ${runner.suite_exit} — its full output is persisted at ${evidenceDir}/suite.log (sha256'd result line in ${evidenceDir}/suite.jsonl).` : '') + `\n` +
    (vclass === 'static-only'
      ? `- VERIFICATION DEGRADED (verification_class: static-only): one or more probe checks were honestly DEFERRED in this run (uninstantiated template, --skip-probes, or playwright absent) — there is NO browser-probe evidence for them. A deferral is never green: judge those criteria from the static evidence only and weigh your verdict accordingly.\n`
      : `- This run's verification_class is 'full': every mapped probe EXECUTED — its evidence (probe-<SC>.json result + screenshot(s) + probe-<SC>.log) sits in ${evidenceDir}/ beside the check logs; read it before ruling.\n`) +
    `- Independent-rerun floor (non-negotiable): re-run the slice's mapped checks YOURSELF — 'node ${pluginRoot}/scripts/kiln-law.mjs run ${projectPath} ${kilnDir} --only ${ids} --run-prefix ${BUILD_RUN_TOKEN}' — and set law_green from YOUR run. Instantiated probe checks EXECUTE in that rerun (one bounded browser subprocess each, evidence written under the new run id, swept under this build's stage token); PROBE_DEFERRED/PROBE_UNAVAILABLE lines are honest deferrals — neither red nor green, never proof. Read the runner's evidence for everything broader instead of re-deriving it; re-run broader scopes only on concrete doubt.\n`
  const escNote = leg.escalated
    ? `\n<escalated>You are the ESCALATED feedback source: prior review cycles rejected this slice on logical findings and the loop is stuck. Fresh eyes, full depth — verify the prior findings were genuinely addressed AND hunt what the earlier reviews missed.</escalated>\n`
    : ''
  const classRule = `Class EVERY finding: 'mechanical' (hygiene, formatting, missing file, simple slip — a one-step fix) or 'logical' (wrong behavior, failed check, broken contract, real design flaw). The Sentinel escalates on logical findings — class honestly, never inflate or soften.`
  if (surf === 'ui' || surf === 'mixed') {
    const how = leg.viaCodex
      ? `<how>${codexGuideNote}Delegate this review to GPT-5.5 via 'codex exec' at model_reasoning_effort="${effort}" — you are the thin wrapper and the cross-model check; if codex errors, review directly as the independent reviewer.</how>\n\n`
      : ''
    // §7 screenshot rule (tasks.md T2.2): the reviewer judges the probe SCREENSHOT by a BINARY
    // RUBRIC only — pass/fail visibility questions ("is the nav visible? is text clipped? does it
    // match the stated design language?") — NEVER a free-form aesthetic score. VLMs rank reliably
    // and SCORE unreliably [R:playwright-discipline §4]; numeric taste scores are out of scope and
    // judged separately from a live render at validate. When the run is static-only there is no
    // screenshot to judge — that arm is gated below.
    const screenshotRubric = vclass === 'static-only'
      ? `6. Screenshot rubric: SKIPPED this run — verification_class is static-only, so no probe screenshot was captured (judge the visual criteria from the static evidence only; never infer a clean render you cannot see).\n`
      : `6. Screenshot rubric (binary ONLY): the probe captured screenshot(s) under ${evidenceDir}/ (named in probe-<SC>.json's "screenshots"). View them and answer ONLY binary visibility questions — is the key content/nav visible? is any text clipped or overlapping? does the layout match the stated design language and ban list? NEVER assign a numeric or aesthetic score (VLMs rank reliably but score unreliably; taste is judged separately from a live render at validate). A failed binary rubric question is a finding.\n`
    return (leg.model === 'opus' ? voice('opus') : '') +
      `You are the ${leg.escalated ? 'escalated ' : ''}cross-model UI reviewer on slice ${sliceId} — a DIFFERENT context from the builder. Judge code and executable evidence ONLY; rule on the screenshot by BINARY RUBRIC (visibility/clipping/on-brief), never a free-form aesthetic score (taste is judged separately from a live render, outside this loop). Read-only on source.\n\n` +
      `<inputs>\n` +
      `- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
      `- Slice objective: ${slice.objective}\n` +
      `- Inspect the committed work: 'git -C ${projectPath} show HEAD' / 'git -C ${projectPath} diff', and read the changed files.\n` +
      evidenceBlock +
      `- Design system + ban list: ${designDir}/creative-direction.md. Content source of truth: ${codebaseMapFile}.\n` +
      `</inputs>\n\n` +
      `<checks>\nApply EVERY check to EVERY interactive element/section, not just the first:\n` +
      `1. structural / responsive breakage; 2. dead or missing event handlers + JS correctness; 3. accessibility — AA contrast (compute it), prefers-reduced-motion honored, semantics; 4. ban-list adherence + design-token consistency; 5. content accuracy vs the map (no invented features/metrics/images).\n` +
      screenshotRubric +
      (surf === 'mixed' ? `Also RE-RUN the slice's behavior/smoke test for the non-visual logic and confirm it passes.\n` : ``) +
      `Re-run the STATIC check yourself (HTML parses, sections/ids present, 'node --check' the JS). RE-RUN the slice's mapped probe SCs via the kiln-law rerun above (each probe is one bounded, token-swept subprocess — the browser is a subprocess with a deadline, never a service); NEVER open a browser or drive Playwright yourself — every browser observation comes through that rerun's evidence.\n` +
      `</checks>\n${escNote}\n` +
      how +
      `<task>Set law_green from YOUR kiln-law re-run and tests_green from the static/smoke check you re-ran. Verdict APPROVED only if the mapped checks pass and the page is structurally sound, accessible, on-brief, and free of invented claims; else REJECTED with specific, actionable findings. ${classRule} Report reasoning first.</task>`
  }
  const how = leg.viaCodex
    ? `<how>${codexGuideNote}Delegate this review to GPT-5.5 via 'codex exec' at model_reasoning_effort="${effort}" — a genuinely cross-family second judgment; if codex errors, review directly as the independent reviewer.</how>\n\n`
    : ''
  const testCmd = (build && build.test_command) || 'the project tests'
  return (leg.model === 'opus' ? voice('opus') : '') +
    `You are the ${leg.escalated ? 'escalated ' : ''}cross-model code reviewer on slice ${sliceId}. Separate what the builder REPORTED from what you INDEPENDENTLY re-ran. Read-only on source.\n\n` +
    `<inputs>\n` +
    `- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
    `- Slice objective: ${slice.objective}. Done when: ${slice.done_when || '(the mapped checks pass)'}\n` +
    `- Inspect the committed work: 'git -C ${projectPath} show HEAD' / 'git -C ${projectPath} diff', read the changed files.\n` +
    evidenceBlock +
    `</inputs>\n\n` +
    `<checks>\n` +
    `- RE-RUN the suite yourself (${testCmd}) and confirm it passes — do not trust the reported result.\n` +
    `- Verify the implementation is real: no stubs or mocks standing in for required behavior; the slice meets its objective and its mapped checks.\n` +
    `- Reject only on correctness / completeness / failed checks — not on style preference.\n` +
    `</checks>\n${escNote}\n` +
    how +
    `<task>Verdict APPROVED only if the mapped checks and the suite are green from YOUR OWN runs AND the implementation is real AND on-spec; else REJECTED with specific [file:line] findings. Set law_green and tests_green from your own runs. ${classRule} Report reasoning first.</task>`
}

// The analyst overall-verdict rule (§3.2): the gate computes judge-spawn from analyst
// DISAGREEMENT, and the deterministic reconcile blocks on critical|high findings only — so an
// overall 'fail' carrying no such finding is structurally noise. Stated in both analyst prompts.
const overallRule = `Also return overall — your independent verdict on the whole milestone ('pass' | 'fail'); a 'fail' MUST be backed by at least one critical or high finding, or the deterministic reconcile reads it as noise.`
// THE BROWSER LAW for the gate legs (RUN-B F3 ruling, 2026-06-13): the tribunal analyst and the
// judge were the ONLY browser-capable prompts WITHOUT a browser-law line, and the field run proved
// it — Ken drove the Playwright-MCP browser_* tools on two milestone gates (superb adversarial QA
// through a forbidden channel) and leaked an MCP chrome the token sweep structurally cannot reap
// (an MCP browser is a persistent SERVICE, the exact class §7 forbids in-loop). Every prompt that
// carried any browser-law line held; the two without it did not. The law names all three channels
// and re-channels the analyst's hunger to the probe evidence — the value is redirected, not lost.
const browserLaw = `NEVER launch a browser, NEVER drive Playwright yourself, and NEVER use Playwright-MCP browser_* tools (an MCP browser is a persistent service outside this stage's kill-token sweep — the exact leak class §7 forbids). Every browser observation you need already exists as probe evidence under ${kilnDir}/evidence/ (screenshots, console/net logs, probe-<SC>.json results) — judge UI behavior from that evidence and static inspection; live UI verification beyond it belongs to validate's bounded Tier-2 traversal, not to you.`
function kenPrompt(m) {
  return voice('opus') +
    `You are QA analyst A. Adversarially verify the INTEGRATED milestone — run the tests, confirm each acceptance criterion is genuinely met (not faked), and hunt integration gaps and edge cases across the slices.\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n- Inspect the repo at ${projectPath}: git log/diff, read the files, RUN the tests yourself.\n</inputs>\n\n` +
    `<constraints>\n- ${browserLaw}\n</constraints>\n\n` +
    `<task>Write findings to ${qaDir}/qa-report-a.md (mkdir -p first) and return report_file + findings[] (each {text, severity}). ${overallRule} Quote specific evidence ([file:line] or test output). Apply scrutiny to EVERY acceptance criterion, not just the first. Report reasoning first.</task>`
}
function ryuPrompt(m) {
  return (codexAvailable
    ? `You are QA analyst B, delegating analysis to GPT-5.5 via 'codex exec' for a genuinely cross-model second perspective — run codex at model_reasoning_effort="high". ${codexGuideNote}If it errors, analyze directly.\n`
    : `You are QA analyst B — an independent second perspective.\n`) +
    `Run the tests yourself and probe DIFFERENT failure modes than a first pass would.\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n- Inspect the repo at ${projectPath}: git log/diff, read files, RUN the tests.\n</inputs>\n\n` +
    `<task>Write findings to ${qaDir}/qa-report-b.md (mkdir -p first) and return report_file + findings[] (each {text, severity}). ${overallRule} Do NOT read analyst A's report — stay independent. Report reasoning first.</task>`
}
// goalBackwardPrompt — the §3.2 boundary auditor: works BACKWARD from the milestone goal (GSD
// discipline), explicitly hunting "all checks pass but the goal is broken" before validate.
function goalBackwardPrompt(m) {
  return voice('opus') +
    `You are the goal-backward auditor at the milestone boundary. Your one question: does the INTEGRATED milestone genuinely deliver its GOAL? Work BACKWARD from the goal — never forward from the checks (they all pass; that comfort is exactly what you distrust).\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n- Summary: ${m.summary || '(none)'}\n- The live repo at ${projectPath}: git log/diff, read the files, and EXERCISE the product the way a user would (run the CLI, call the API, render the page statically — no browser).\n</inputs>\n\n` +
    `<task>Hunt the "checks pass, goal broken" class specifically: acceptance met by the letter but broken in spirit, slices that pass alone but never connect, features that exist but cannot be reached from the product's entry points, hardcoded or stub behavior hiding behind a green check. Write your report to ${qaDir}/goal-backward-${m.id}.md (mkdir -p first) and return report_file + findings[] (each {text, severity}) + overall ('pass' = the goal is genuinely delivered; 'fail' MUST be backed by at least one critical or high finding). Read-only on source. Report reasoning first.</task>`
}
function judgePrompt(m, reconciled) {
  return voice('opus') +
    `You are the QA judge — final arbiter for this milestone. Binary verdict, no "PASS with caveats".\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
    `- Reconciled findings (deduped, severity-ranked):\n${reconciled.summaryLines.map((l) => '  - ' + l).join('\n') || '  (none)'}\n` +
    `- The repo at ${projectPath}.\n</inputs>\n\n` +
    `<constraints>\n- ${browserLaw}\n</constraints>\n\n` +
    `<task>RUN the tests yourself at ${projectPath}. Issue QA_PASS only if the milestone genuinely meets its acceptance with green tests and no critical/high findings; else QA_FAIL with the blocking findings. Report reasoning first, then verdict, findings, severity.</task>`
}

// ── Ledger (BLUEPRINT §3.5): every posture move and slice-plan event lands in events.jsonl via
//    the kiln-state CLI — silent posture changes are a documented operator-trust killer. Only
//    called past the pluginRoot floor gate, so the CLI path is always resolvable. ──
async function ledger(type, data, phaseName) {
  const ev = JSON.stringify({ type, stage: 'build', data })
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

// ── Stage-level browser sweeps (BLUEPRINT §7 / discipline-spec lifecycle step 3, tasks.md T2.3) —
//    the OUTER bracket around the whole build stage. The browser is a subprocess with a deadline,
//    never a service: kiln-law already brackets each probe-EXECUTING run with its own per-run
//    `kiln-probe sweep <runId>` (registered on process 'exit' + on timeout SIGKILL), but a
//    kiln-law wrapper that is itself SIGKILLed by an OUTER deadline never runs its exit handler,
//    leaving an orphaned chrome-headless-shell / managed server tree behind. THIS stage bracket is
//    the backstop for that — a PRE-FLIGHT sweep at build start and an UNCONDITIONAL sweep at build
//    end (the latter in the finally below, so any throw still reaps).
//    Scope is RUN-TOKEN, not the whole namespace (the reviewer's MAJOR / the discipline-spec
//    "post-check cleanup is run-token scoped"): both sweeps target THIS build's BUILD_RUN_TOKEN —
//    every probe this stage spawned runs under a runId prefixed with it (--run-prefix on each
//    kiln-law run), so `kiln-probe sweep <BUILD_RUN_TOKEN>` reaps exactly this stage's survivors
//    and CANNOT touch a concurrent Kiln run (a validate Tier-2 traversal, a parallel build) — let
//    alone the operator's own browser (blanket `pkill -f chrome` stays forbidden). The old
//    whole-namespace pre-flight "stale-SingletonLock" defense (#1311) is unnecessary here: that
//    failure mode requires a REUSED --user-data-dir, and Kiln gives every probe a unique
//    /tmp/kiln-pw-<token> profile dir (kiln-probe.mjs), so a prior crashed run's stale lock lives
//    in a dir this build never reuses and can never block it. Both sweeps are ledgered (§3.5) and
//    the sweep CLI always exits 0 so cleanup never fails a stage. Only called past the pluginRoot
//    floor gate (the CLI is locatable) via a haiku leg — a mechanical `pkill`/`rm` cleanup. ──
// SWEEP_SCAN_SCHEMA — the sweep leg now runs TWO commands (sweep, then the READ-ONLY leak-scan) and
// reports both: the SWEEP line (owned-namespace cleanup, as before) and the LEAK_SCAN json (a foreign
// browser we do not own — the eye Run B lacked, RUN-B FINDING 3b). leak_suspects rides the baseline
// browser_sweep event on EVERY bracket; the suspect/profile-dir detail rides a separate
// browser_leak_suspect event ONLY when count>0 (a lean ledger — zero-suspect scans ride the count).
const SWEEP_SCAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    sweep_line: { type: 'string', description: 'the SWEEP … line the sweep command printed, verbatim' },
    leak_scan_line: { type: 'string', description: 'the LEAK_SCAN {json} line leak-scan printed, verbatim' },
    leak_suspects: { type: 'integer', description: "the LEAK_SCAN json's counts.suspects — foreign browsers alive (0 when none)" },
    suspects: {
      type: 'array', description: "the LEAK_SCAN json's suspects array ([] when none)",
      items: {
        type: 'object', additionalProperties: false,
        properties: { pid: { type: 'integer' }, arg0: { type: 'string' }, namespace: { type: 'string' }, user_data_dir: { type: 'string' } },
        required: ['pid', 'arg0', 'namespace', 'user_data_dir'],
      },
    },
    profile_dirs: {
      type: 'array', description: "the LEAK_SCAN json's profile_dirs array — abandoned temp profiles ([] when none)",
      items: {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string' }, mtime: { type: 'string' } },
        required: ['path', 'mtime'],
      },
    },
  },
  required: ['sweep_line', 'leak_scan_line', 'leak_suspects', 'suspects', 'profile_dirs'],
}
async function stageSweep(when) {
  const r = await agent(
    `You are the browser-leak sweeper — the stage-level bracket of the bounded-browser discipline (the browser is a subprocess with a deadline, never a service). You run TWO commands and report what they found; you never launch a browser, never edit, never judge, and never kill anything yourself.\n\n` +
    `<task>Run these TWO exact commands in order (Bash):\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-probe.mjs sweep ${BUILD_RUN_TOKEN}\n` +
    `node ${pluginRoot}/scripts/kiln-probe.mjs leak-scan\n` +
    '```\n' +
    `The FIRST sweeps THIS build's own browser trees ONLY — the prefix '${BUILD_RUN_TOKEN}' can never touch a concurrent Kiln run or the operator's own browser; blanket 'pkill -f chrome' is forbidden. It ALWAYS exits 0.\n` +
    `The SECOND is a STRICTLY READ-ONLY scan for a FOREIGN browser we do not own (a stray Playwright temp-profile or Playwright-MCP browser) — it kills NOTHING, removes NOTHING, and ALWAYS exits 0. It prints ONE 'LEAK_SCAN {json}' line.\n` +
    `Report: sweep_line = the 'SWEEP …' line verbatim; leak_scan_line = the 'LEAK_SCAN …' line verbatim; leak_suspects = the LEAK_SCAN json's counts.suspects; suspects = its suspects array ([] when none); profile_dirs = its profile_dirs array ([] when none). Do not run anything else.</task>`,
    { label: loreLabel('sentinel', 'sweep', when), phase: 'The Forge Heats', model: 'haiku', schema: SWEEP_SCAN_SCHEMA }
  )
  const leakSuspects = (r && Number.isInteger(r.leak_suspects)) ? r.leak_suspects : 0
  const suspects = (r && Array.isArray(r.suspects)) ? r.suspects : []
  const profileDirs = (r && Array.isArray(r.profile_dirs)) ? r.profile_dirs : []
  // Baseline proof for BOTH arms on every bracket (T3 review r1 ruling): leak_suspects AND
  // leak_profile_dirs ride browser_sweep, so the ledger records that disk evidence existed
  // even when no foreign browser is alive. The detail event stays gated on LIVE suspects —
  // stale /tmp profile dirs from unrelated work would make a dirs-only alarm cry wolf; their
  // detail rides whenever the alarm fires, and the LEAK_SCAN line is in the transcript anyway.
  await ledger('browser_sweep', { stage: 'build', when, token: BUILD_RUN_TOKEN, leak_suspects: leakSuspects, leak_profile_dirs: profileDirs.length }, 'The Forge Heats')
  if (leakSuspects > 0) {
    await ledger('browser_leak_suspect', { stage: 'build', when, token: BUILD_RUN_TOKEN, suspects, profile_dirs: profileDirs }, 'The Forge Heats')
  }
}

// ── The status anchor (§5.1 statusBefore, T2-fix ruling): statusBefore lives in the EVIDENCE —
//    the anchored run's results.jsonl, folded by kiln-law itself via --before — never in prose.
//    The workflow carries only this run-id pointer, advanced on every COMPLETE freshness-verified
//    run (green OR red: a red run's fold is the truthful current status for the next fix cycle's
//    flip plan; tamper/stale runs never anchor — their evidence is untrusted by definition). ──
let lastRunId = null

// ── HEAD probe (the §9 pipelining base-SHA anchor): one cheap haiku reads the project HEAD so the
//    in-script pipelineInvalidated predicate can compare the SHA a speculative slice plan was cut
//    against (its base_sha) with the SHA after the milestone gate completes. Returns '' on any
//    failure — pipelineInvalidated fails closed on a blank HEAD (an unreadable HEAD forces a
//    re-slice, never a stale-plan reuse). ──
const HEAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string' }, head: { type: 'string', description: 'git rev-parse HEAD — the full sha, or "" if git failed' } },
  required: ['head'],
}
async function headSha(suffix) {
  const r = await agent(
    `You are the HEAD probe — you read one git fact and report it; you never write or fix anything.\n\n` +
    `<task>Run 'git -C ${projectPath} rev-parse HEAD' (Bash). Report head = the full sha it prints, or "" if the command fails. Do not read anything else.</task>`,
    { label: loreLabel('thoth', 'head', suffix), phase: 'Scoring the Cut', model: 'haiku', schema: HEAD_SCHEMA }
  )
  return (r && typeof r.head === 'string') ? r.head.trim() : ''
}

// ── planMilestone(targetM, targetSurf, targetScs) — the §5 batch slice plan for ONE milestone,
//    parameterized so it can run for the CURRENT milestone synchronously OR for the NEXT milestone
//    SPECULATIVELY (velocity lever 3, §9 pipelining). ONE batch krs-one:slice-plan call, coverage
//    validated in-script, ONE re-ask on gaps. Returns { ok, planned, errors }. The pipelined call
//    runs against an EMPTY built-list (nothing of the next milestone exists yet) — exactly the cold
//    plan the synchronous path computes; if the gate's corrective commit moves HEAD, the speculative
//    plan is discarded and re-cut (pipelineInvalidated). The `note`/`built` params keep the replan
//    path (a mid-milestone state-drift re-slice for the remainder) working unchanged. ──
async function planMilestone(targetM, targetSurf, scs, built = [], note = null, labelSuffix = null) {
  const ids = scs.map((c) => c.id)
  const ls = labelSuffix || targetM.id
  const askPlan = async (n, sfx) => {
    const res = await agent(slicePlanPrompt(targetM, targetSurf, scs, built, n), { label: loreLabel('krs-one', 'slice-plan', sfx), phase: 'Scoring the Cut', model: 'opus', schema: SLICE_PLAN_SCHEMA })
    return (res && Array.isArray(res.slices)) ? res.slices : []
  }
  let planned = await askPlan(note, ls)
  let v = validateSlicePlan(planned, ids)
  if (!v.ok) {
    const errText = v.errors.map((e) => e.message).join('; ')
    log(`${targetM.id}: slice plan failed the coverage arithmetic [${errText}] — one re-ask`)
    planned = await askPlan(`${note ? note + '\n' : ''}Your previous plan was REJECTED by the coverage arithmetic: ${errText}. Fix EXACTLY these gaps — every listed Law check id in exactly one slice's sc_ids, every slice flipping at least one.`, `${ls}:retry`)
    v = validateSlicePlan(planned, ids)
  }
  return { planned, ok: v.ok, errors: v.errors }
}

// ── The pipeline carry (§9 lever 3): a speculative slice plan launched DURING the previous
//    milestone's gate, against the HEAD it was cut at (base_sha). { milestoneId, base_sha, promise }.
//    Consumed at the head of the next milestone iteration: a corrective commit on the prior
//    milestone (tribunal correction / validate loop) that moved HEAD off base_sha invalidates it
//    (pipelineInvalidated) — then the milestone re-slices against the real HEAD. Carrying only one
//    plan keeps the speculation bounded (the next milestone only). ──
let pipelinedPlan = null

// ── The Trial, mechanized (§5.1/§6): commit gate → deterministic runner → freshness probe →
//    in-script runnerGate → reviewer ONLY on 'proceed'. lawCtx = { flips, only }: the SC ids this
//    trial must flip RED→GREEN, and the run scope (the flips plus every SC the milestone already
//    turned green, so regressions are observed, not assumed). Returns the review verdict object
//    (the workflow's own autoReject/lawRedReject for tamper/stale/red/uncommitted — no reviewer
//    call is spent on those). ──
async function evidencedReview(m, surf, slice, sliceId, build, fix, escalated, reviewerName, lawCtx) {
  // Commit-before-review (unchanged from v2): an uncommitted slice would anchor evidence and
  // review to a stale HEAD. Auto-reject without spending runner or review calls.
  if (build && build.committed === false) {
    log(`${m.id} ${sliceId}: builder did not commit — auto-reject (mechanical), no runner, no reviewer`)
    return autoReject([`Slice was not committed — run 'git add -A && git commit' before the trial (evidence and review anchor to HEAD).`])
  }
  phase('The Trial')
  log(`${spin('law', fix)} — ${m.id} ${sliceId} f${fix}`)
  const runner = await agent(runnerPrompt(build, lawCtx, lastRunId), { label: loreLabel('asimov', 'runner', `${sliceId}:f${fix}`), phase: 'The Trial', model: 'sonnet', schema: RUNNER_SCHEMA })
  let fresh = null
  if (runner && typeof runner.run_id === 'string' && runner.run_id) {
    fresh = await agent(freshPrompt(runner.run_id), { label: loreLabel('thoth', 'freshness', `${sliceId}:f${fix}`), phase: 'The Trial', model: 'haiku', schema: FRESHNESS_SCHEMA })
  }
  const gate = runnerGate(runner, fresh)
  // Advance the status anchor on every complete, fresh run — 'proceed' AND 'red' both carry a
  // finalized manifest the probe just verified; the next trial's --before folds this run.
  if (gate.verdict === 'proceed' || gate.verdict === 'red') lastRunId = runner.run_id
  // §7 honesty (tasks.md T2.1): a static-only run (a mapped probe deferred — playwright absent →
  // exit 78, an un-instantiated template, or --skip-probes) folds to law_run_exit 0, so the
  // degradation must be LEDGERED the moment the gate sees it — recorded end-to-end, never silently
  // green. The probeGate pure predicate (src/spine.mjs) makes the decision surface-aware: a
  // ui/mixed slice that lost its browser-probe evidence ledgers 'probe_unavailable' (the §7
  // capability-tier event) and the ui review falls back to the v2 static checks; a logic slice has
  // no browser path so probeGate passes it through (a static-only class there means a mapped probe
  // SC the slicer attached to logic-adjacent work — still surfaced as the generic degradation so
  // the reviewer is never told a full verification it did not get). The run proceeds honestly
  // degraded (a capability tier, not an error); the reviewer prompt below names it either way.
  if (gate.verdict === 'proceed' || gate.verdict === 'red') {
    const pg = probeGate(surf, gate)
    if (pg.action === 'degrade') {
      log(`${m.id} ${sliceId}: VERIFICATION DEGRADED — run ${runner.run_id} is static-only (${pg.reason}); ledgered probe_unavailable, the ui review falls back to the static checks, never folded green`)
      await ledger('probe_unavailable', { milestone: m.id, slice: sliceId, surface: surf, fix, run_id: runner.run_id, verification_class: 'static-only' }, 'The Trial')
    } else if (gate.verification_class === 'static-only') {
      // logic surface (probeGate passes it) but the run is still static-only — surface the generic
      // degradation so a non-ui reviewer is never handed a "full" verification it did not receive.
      log(`${m.id} ${sliceId}: VERIFICATION DEGRADED — run ${runner.run_id} is static-only (probe evidence deferred on a non-ui slice); ledgered, surfaced to the reviewer, never folded green`)
      await ledger('verification_degraded', { milestone: m.id, slice: sliceId, surface: surf, fix, run_id: runner.run_id, verification_class: 'static-only' }, 'The Trial')
    }
  }
  if (gate.verdict === 'tamper') {
    // §5.1 tamper model: the slice is auto-REJECTED by the WORKFLOW (not an agent judgment), the
    // event is LEDGERED, and the fix brief names exactly which locked path was touched.
    log(`${m.id} ${sliceId}: TAMPER — ${gate.reasons.join('; ')} — auto-reject, no reviewer spawned`)
    await ledger('tamper_auto_reject', { milestone: m.id, slice: sliceId, fix, tamper_paths: gate.tamper_paths, reasons: gate.reasons }, 'The Trial')
    const named = gate.tamper_paths.length ? gate.tamper_paths : ['(kiln-law exited 2 without naming paths — run verify manually to identify the lock)']
    return autoReject(named.map((p) => `Locked Law path touched: ${p} — the Law is immutable after lock (§5.1). Revert every change to locked paths and rebuild without touching them; ADD new tests elsewhere instead.`))
  }
  if (gate.verdict === 'stale') {
    // §6: stale or missing evidence is structurally impossible to approve — no reviewer spawned.
    log(`${m.id} ${sliceId}: evidence gate failed [${gate.reasons.join('; ')}] — auto-reject, no reviewer spawned`)
    return autoReject(gate.reasons.map((r) => `Evidence gate failed — ${r}. Ensure the work is committed at HEAD and the checks can execute; the runner re-fires on the next cycle.`))
  }
  if (gate.verdict === 'red') {
    // T2-fix ruling: the exit code IS the verdict. A red lifecycle gate (flip unmet / regression)
    // is REJECTED by the WORKFLOW — no reviewer is spent on a slice that mechanically failed its
    // Law; the fix brief names the exact ids. Classed 'logical' (see lawRedReject): a failed
    // check is a genuine defect signal the Sentinel must see.
    log(`${m.id} ${sliceId}: THE LAW IS RED [${gate.reasons.join('; ')}] — exit code is the verdict; auto-reject, no reviewer spawned`)
    await ledger('law_red_auto_reject', { milestone: m.id, slice: sliceId, fix, flip_unmet: gate.flip_unmet, regressed: gate.regressed, reasons: gate.reasons }, 'The Trial')
    return lawRedReject(gate.reasons.map((r) => `The Law's lifecycle gate failed — ${r}. The slice is DONE only when its declared flips are GREEN and nothing previously-GREEN regresses: fix the BEHAVIOR (never the locked checks), recommit, and the runner re-fires.`))
  }
  const leg = reviewLeg(surf, escalated)
  const effort = reviewEffort(fix, escalated)
  log(`${spin('review', fix)} — ${m.id} ${sliceId} f${fix}${leg.escalated ? ' (escalated feedback source)' : ''}`)
  return await agent(reviewPrompt(m, surf, slice, sliceId, build, runner, leg, effort, gate.verification_class), { label: loreLabel(reviewerName, 'review', `${sliceId}:f${fix}${leg.escalated ? ':esc' : ''}`), phase: 'The Trial', model: leg.model, schema: REVIEW_SCHEMA })
}

// ── gateOnlyTrial (P3.5 T3, dogfood finding 4) — the STARVED-GATE deterministic Law check over an
//    already-completed build. SAME trial legs as evidencedReview (the deterministic runner → the
//    freshness probe → the in-script runnerGate), but in gateOnly law context — verify + run
//    --only/--expect-green over ALL the milestone's SCs, NO --flips, NO --before — and it spawns NO
//    builder, NO reviewer: a starved gate is re-run, never re-built. The §7 degradation channel is
//    preserved (a static-only run is ledgered, never silently green). Returns the runnerGate
//    verdict object so the caller applies the pure gateOnlyRefusal predicate: any verdict but
//    'proceed' refuses the milestone with gate-only-on-red; a clean 'proceed' routes to Judgment. ──
async function gateOnlyTrial(m, surf, mScIds) {
  phase('The Trial')
  log(`${spin('law', 0)} — ${m.id} gate-only Law check over ${mScIds.length} SC(s) [${mScIds.join(', ')}]`)
  const lawCtx = { gateOnly: true, flips: [], only: mScIds }
  const runner = await agent(runnerPrompt(null, lawCtx, null), { label: loreLabel('asimov', 'runner', `${m.id}:gate-only`), phase: 'The Trial', model: 'sonnet', schema: RUNNER_SCHEMA })
  let fresh = null
  if (runner && typeof runner.run_id === 'string' && runner.run_id) {
    fresh = await agent(freshPrompt(runner.run_id), { label: loreLabel('thoth', 'freshness', `${m.id}:gate-only`), phase: 'The Trial', model: 'haiku', schema: FRESHNESS_SCHEMA })
  }
  const gate = runnerGate(runner, fresh)
  // Advance the status anchor on a trustworthy verdict (proceed) — the gate-only run is a complete,
  // fresh, finalized run, so a subsequent tribunal-correction trial can fold it via --before and
  // expect the milestone's SCs to STAY green (regression guard) rather than re-flip from the lock.
  if (gate.verdict === 'proceed') lastRunId = runner.run_id
  // §7 honesty: a static-only run (a mapped probe deferred) must be LEDGERED the moment the gate
  // sees it — recorded end-to-end, never silently green — exactly as the slice trial does.
  if (gate.verdict === 'proceed') {
    const pg = probeGate(surf, gate)
    if (pg.action === 'degrade') {
      log(`${m.id}: gate-only VERIFICATION DEGRADED — run ${runner.run_id} is static-only (${pg.reason}); ledgered probe_unavailable`)
      await ledger('probe_unavailable', { milestone: m.id, slice: `${m.id}:gate-only`, surface: surf, fix: 0, run_id: runner.run_id, verification_class: 'static-only' }, 'The Trial')
    } else if (gate.verification_class === 'static-only') {
      log(`${m.id}: gate-only VERIFICATION DEGRADED — run ${runner.run_id} is static-only (probe evidence deferred on a non-ui slice); ledgered`)
      await ledger('verification_degraded', { milestone: m.id, slice: `${m.id}:gate-only`, surface: surf, fix: 0, run_id: runner.run_id, verification_class: 'static-only' }, 'The Trial')
    }
  }
  return gate
}

// ── The Forge Heats — the §3.4 floor gates, then git baseline + codebase-state + milestone parse ──
phase('The Forge Heats')
log('The kiln grows hotter')
// Floor gate 1: without pluginRoot the kiln-law CLI is unlocatable — the tamper gate and the
// deterministic check runs (BLUEPRINT §3.4 floors) cannot execute. Building anyway would be a
// silent v2 regression; the conductor must relaunch with pluginRoot.
if (!pluginRoot) {
  log('BUILD CANNOT START — pluginRoot absent: the kiln-law CLI cannot be located, so the §3.4 Law floor (tamper gate + deterministic check runs) cannot execute. The conductor must escalate, never start an ungated build.')
  return { built: [], passed: [], all_passed: false, law_gated: false, split_required: [], reason: 'pluginRoot absent — the kiln-law CLI cannot be located' }
}
// Floor gate 2: the Law must be locked. One haiku reads law.json and transcribes the check index;
// the SC↔milestone mapping below is pure arithmetic on this transcript.
const lawRead = await agent(
  `You are the Law reader.\n\n` +
  `<task>Run 'cat ${lawFile}' (Bash). Report locked = true iff lock_commit is a non-null string, and checks = EVERY entry of the checks array as {id, milestone, kind}, transcribed exactly and in order. If the file does not exist or is not valid JSON, report locked=false and checks=[]. Do not read anything else; do not write or fix anything.</task>`,
  { label: loreLabel('asimov', 'law-read'), phase: 'The Forge Heats', model: 'haiku', schema: LAW_READ_SCHEMA }
)
const lawChecks = (lawRead && lawRead.locked === true && Array.isArray(lawRead.checks)) ? lawRead.checks.filter((c) => c && typeof c.id === 'string' && typeof c.milestone === 'string') : []
if (!lawChecks.length) {
  log('BUILD CANNOT START — the Law is not locked (no readable law.json with a lock_commit and checks). Architecture must lock the gates first; the conductor must escalate, never start a build against unlocked gates.')
  return { built: [], passed: [], all_passed: false, law_gated: false, split_required: [], reason: 'law.json missing or unlocked — the build spine never runs against unlocked gates' }
}
log(`The Law: ${lawChecks.length} locked check(s) across ${[...new Set(lawChecks.map((c) => c.milestone))].length} milestone(s)`)

// §3.5 stage bracket (P3.6 T4): the build stage is entered — past both §3.4 floor gates, so the
// ledger CLI is locatable, and BEFORE any other build-stage ledger activity (the pre-flight sweep
// below appends browser_sweep at stage:'build'; a projection read must never see build events
// while stage still reads the prior projection — T4 review r1). gateOnly re-enters the stage too
// (accurate), so this fires either way; stage_completed only lands on the genuine
// all-milestones-passed return below (a QA_FAIL/refusal leaves the projection at 'build', which
// is the truthful state for the correction loop).
await ledger('stage_started', { stage: 'build', gate_only: gateOnly }, 'The Forge Heats')

// §7 / T2.3 pre-flight sweep: clear any orphaned browser tree from a prior crashed run BEFORE the
// first probe could spawn (the discipline-spec defense against #1311's stale SingletonLock). Past
// the floor gates, so pluginRoot + the ledger are usable.
await stageSweep('pre-flight')

// Velocity lever 3 (§9): rakim:setup ∥ confucius:parse — independent legs run in PARALLEL. rakim
// initializes the git baseline + writes codebase-state.md (the slicer/builders read it); confucius
// parses the already-written master-plan.md into the milestone list. Neither reads the other's
// output, so concurrency is free. Both downshift to haiku: a git-init + TL;DR doc, and a
// schema-forced extraction against an existing plan, are mechanical legs — not reasoning tasks.
const [, planRes] = await parallel([
  () => agent(
    `You are the codebase-state authority. ${scope} ${repoRuleLine}\n\n` +
    `<task>\n1. If ${projectPath} is not a git repo (no .git), initialize it: set a local user.name/email if unset, then 'git -C ${projectPath} init -q && git -C ${projectPath} add -A && git -C ${projectPath} commit -q -m "chore: kiln build baseline"'.\n` +
    `2. Read ${masterPlanFile} and ${handoffFile}, then write ${codebaseStateFile} (mkdir -p ${docsDir} first): a short TL;DR of the intended architecture and the current (likely empty) state, for the slicer and builders to read each milestone.\n</task>`,
    { label: loreLabel('rakim', 'setup'), phase: 'The Forge Heats', model: 'haiku' }
  ),
  () => agent(
    `You are the build planner. ${scope}\n\n<inputs>\nRead ${masterPlanFile}.\n</inputs>\n\n` +
    `<task>Return the milestones in build order — id, title, summary, acceptance, surface (copy the plan's ui|logic|mixed tag; if absent, infer: a visible/front-facing deliverable is 'ui', a non-visual backend/CLI/logic deliverable is 'logic'), and confidence. Extract exactly what the plan defines — do not invent milestones. Report reasoning first.</task>`,
    { label: loreLabel('confucius', 'parse'), phase: 'The Forge Heats', model: 'haiku', schema: MILESTONES_SCHEMA }
  ),
])
let milestones = (planRes && planRes.milestones) || []
if (Number.isFinite(milestoneLimit)) milestones = milestones.slice(0, milestoneLimit)
log(`Building ${milestones.length} milestone(s): ${milestones.map((m) => `${m.id}[${surfaceOf(m)}]`).join(', ')}`)

// ── OUTER milestone loop (sequential — each depends on the previous one's commits) ──
const results = []
const splitLedger = [] // top-level surfacing: split-and-rebuild is a conductor/operator decision
let milestoneIndex = -1
// §7 / T2.3: the milestone loop + return live inside a try whose finally runs the UNCONDITIONAL
// stage-end sweep. The browser is a subprocess with a deadline, never a service — so the stage's
// closing bracket must reap this build's browser survivors on EVERY exit path, a thrown
// agent()/parse error included (a crash mid-probe is exactly when leaks must be swept). The sweep
// sits in finally, not after the loop, so no throw can skip it.
try {
for (const m of milestones) {
  milestoneIndex++
  if (typeof budget !== 'undefined' && budget && budget.total && budget.remaining() <= 0) {
    log(`Budget exhausted — stopping before ${m.id} (per-slice commits are a coherent partial; validate backstops).`)
    break
  }
  const surf = surfaceOf(m)
  const { buildModel: bModel } = routing(surf)
  const [builderName, reviewerName] = pickDuo(surf, milestoneIndex)
  log(`━━ Milestone ${m.id}: ${m.title} [surface=${surf}] — \`${builderName}\` builds, \`${reviewerName}\` reviews ━━`)

  // The milestone's slice of the Law — the contract the batch plan must cover arithmetically.
  const mScs = lawChecks.filter((c) => c.milestone === m.id)
  const mScIds = mScs.map((c) => c.id)
  if (!mScIds.length) {
    log(`${m.id}: NO Law checks map to this milestone — the spine cannot gate it. Recording QA_FAIL and skipping the build (Athena's SC-coverage dimension should have blocked this; the conductor escalates).`)
    results.push({ id: m.id, title: m.title, surface: surf, slices: 0, sc_ids: [], tests_green: false, qa: 'QA_FAIL', findings: ['no law.json checks map to this milestone — ungatable'], split_required: [], replanned: false, slice_plan_failed: true })
    pipelinedPlan = null // a skipped milestone never consumes a pipelined plan — discard the speculation
    continue
  }

  // ── Milestone-scoped state read by Judgment below — hoisted because gateOnly (P3.5 T3) bypasses
  //    Scoring + Forging entirely and the gate must still see them. Under gateOnly the slice list is
  //    EMPTY (nothing was sliced or built — a starved gate is re-run, never re-built), there is no
  //    replan/plan-abort/cap, and forceTribunal routes the gate to the FULL tribunal regardless of
  //    the (unknown) historical slice count. mBuild/mReview are seeded by the inner loop normally
  //    and re-used by the tribunal CORRECTION path (which runs the normal build+trial under gateOnly
  //    too — a real fix, never a skipped build). ──
  const slices = []
  let mBuild = null
  let mReview = null
  let replanned = false
  let planAborted = false
  let cappedOut = false
  let forceTribunal = false
  let gateOnlyGreen = false

  if (gateOnly) {
    // ── P3.5 T3 (dogfood finding 4) STARVED-GATE retry: skip Scoring + Forging entirely. ONE
    //    deterministic trial-shaped pass over ALL the milestone's SCs (verify + run
    //    --only/--expect-green, NO --flips) + freshness + runnerGate. The pure gateOnlyRefusal
    //    predicate rules: any verdict but a clean 'proceed' REFUSES the milestone (QA_FAIL, reason
    //    gate-only-on-red — never gating a red Law, never skipping a build); a green Law routes to
    //    the FULL tribunal (forceTribunal — fail toward scrutiny: the prior slice count is unknown). ──
    log(`${m.id}: GATE-ONLY retry — Scoring + Forging SKIPPED; re-running the milestone gate over the completed build`)
    const gate = await gateOnlyTrial(m, surf, mScIds)
    const refusal = gateOnlyRefusal(gate)
    if (refusal.refuse) {
      log(`${m.id}: gate-only REFUSES — ${refusal.detail}`)
      await ledger('gate_only_refused', { milestone: m.id, sc_ids: mScIds, verdict: gate && gate.verdict, reason: refusal.reason, detail: refusal.detail }, 'The Trial')
      results.push({ id: m.id, title: m.title, surface: surf, slices: 0, sc_ids: mScIds, tests_green: false, qa: 'QA_FAIL', findings: [`[${refusal.reason}] ${refusal.detail}`], split_required: [], replanned: false, gate_only: true })
      continue
    }
    log(`${m.id}: gate-only Law GREEN over the completed build — routing to the FULL tribunal (conservative; prior slice count unknown to a fresh session)`)
    gateOnlyGreen = true
    forceTribunal = true
  } else {

  // ── Scoring the Cut: the §5 batch slice plan (velocity lever 1) — but lever 3 (§9 pipelining)
  //    may have ALREADY cut this milestone's plan speculatively during the previous milestone's
  //    gate. Consume that plan iff it survives the invalidation predicate: its base_sha (the HEAD
  //    it was cut at) must still equal the current HEAD — any corrective commit on the prior
  //    milestone (tribunal correction / validate loop) moved HEAD and forces a re-slice
  //    (pipelineInvalidated, ledgered slice_plan_invalidated). Otherwise plan synchronously now.
  //    Either path: ONE batch call, coverage validated in-script, ONE re-ask on gaps, then escalate
  //    — never build against broken coverage. ──
  phase('Scoring the Cut')
  let firstPlan = null
  let usedPipeline = false
  if (pipelinedPlan && pipelinedPlan.milestoneId === m.id) {
    const speculative = await pipelinedPlan.promise // resolve the plan launched during the prior gate
    const curHead = await headSha(`${m.id}:pipeline-check`)
    const inval = pipelineInvalidated(pipelinedPlan.base_sha, curHead)
    if (!inval.invalidated && speculative && speculative.ok) {
      firstPlan = speculative
      usedPipeline = true
      log(`${spin('slice', milestoneIndex)} — ${m.id}: reusing the PIPELINED slice plan (cut during ${pipelinedPlan.cutDuring}'s gate; HEAD unchanged at ${curHead})`)
    } else {
      const why = inval.invalidated ? inval.reason : 'the speculative plan failed coverage'
      log(`${spin('slice', milestoneIndex)} — ${m.id}: PIPELINED plan invalidated [${why}] — re-slicing against the current HEAD`)
      await ledger('slice_plan_invalidated', { milestone: m.id, base_sha: pipelinedPlan.base_sha, current_head: curHead, reason: why }, 'Scoring the Cut')
    }
  }
  pipelinedPlan = null // consumed (or never matched) — clear before this milestone's gate may set the next
  if (!firstPlan) {
    log(`${spin('slice', milestoneIndex)} — ${m.id}: batch slice plan`)
    firstPlan = await planMilestone(m, surf, mScs)
  }
  if (!firstPlan.ok) {
    const errText = firstPlan.errors.map((e) => e.message).join('; ')
    log(`${m.id}: slice plan STILL fails coverage after the re-ask [${errText}] — escalating; this milestone is not built (the conductor decides, validate backstops).`)
    await ledger('slice_plan_invalid', { milestone: m.id, errors: firstPlan.errors }, 'Scoring the Cut')
    results.push({ id: m.id, title: m.title, surface: surf, slices: 0, sc_ids: mScIds, tests_green: false, qa: 'QA_FAIL', findings: [`slice plan failed SC coverage after one re-ask: ${errText}`], split_required: [], replanned: false, slice_plan_failed: true })
    continue
  }
  let queue = firstPlan.planned
  log(`${m.id}: ${queue.length} slice(s) planned${usedPipeline ? ' (pipelined)' : ''} — [${queue.map((s) => s.sc_ids.join('+')).join(' | ')}]`)

  // ── INNER loop over the planned queue (slices/mBuild/mReview/replanned/planAborted/cappedOut are
  //    the hoisted milestone-scope state; greenScIds + qi are local to this Forging branch) ──
  const greenScIds = [] // SCs this milestone has turned green — each later trial re-runs them so regressions are observed
  let qi = 0
  while (qi < queue.length) {
    if (slices.length >= MAX_SLICES_PER_MILESTONE) { cappedOut = true; break }
    let slice = queue[qi]
    const sliceId = `${m.id}:s${qi}`

    // krs-one:confirm — the haiku pre-build drift check (proceed | replan). Null reads as proceed
    // (the confirm is advisory; the trial gates correctness either way).
    phase('Scoring the Cut')
    const conf = await agent(confirmPrompt(m, slice), { label: loreLabel('krs-one', 'confirm', `${m.id}:s${qi}`), phase: 'Scoring the Cut', model: 'haiku', schema: CONFIRM_SCHEMA })
    if (conf && conf.decision === 'replan') {
      if (!replanned) {
        // ONE fresh slice-plan call for the remainder (ledgered) — the milestone's single replan.
        replanned = true
        log(`${m.id} s${qi}: confirm says REPLAN (${conf.reason || 'state drift'}) — ONE fresh slice plan for the remainder`)
        const flipped = slices.flatMap((s) => s.sc_ids)
        const remainingScs = mScs.filter((c) => !flipped.includes(c.id))
        await ledger('slice_plan_replanned', { milestone: m.id, at_slice: qi, reason: conf.reason || 'state drift', remaining_sc_ids: remainingScs.map((c) => c.id) }, 'Scoring the Cut')
        const rePlan = await planMilestone(m, surf, remainingScs, slices, `The codebase state has DRIFTED from the original plan (${conf.reason || 'unspecified'}). Plan ONLY the remainder: the slices that flip the remaining checks listed above.`, `${m.id}:replan`)
        if (!rePlan.ok) {
          log(`${m.id}: the replanned remainder STILL fails coverage [${rePlan.errors.map((e) => e.message).join('; ')}] — escalating; the remaining slices are not built.`)
          await ledger('slice_plan_invalid', { milestone: m.id, errors: rePlan.errors, replan: true }, 'Scoring the Cut')
          planAborted = true
          break
        }
        queue = queue.slice(0, qi).concat(rePlan.planned)
        if (qi >= queue.length) break
        continue // re-confirm the fresh head slice; a second replan verdict hits the spent-guard below
      }
      log(`${m.id} s${qi}: confirm says replan again — the one fresh plan per milestone is spent; proceeding with the planned slice (the trial gates correctness).`)
    }

    // Phase-6 speed fix: pre-process heavy assets ONCE before the first ui/mixed slice builds.
    // Velocity lever 3 (§9): a haiku probe — recompress-if-present-else-no-op is mechanical leg
    // work, not a reasoning task; the build leg downstream owns the design effort.
    if ((surf === 'ui' || surf === 'mixed') && slices.length === 0) {
      phase('Forging')
      await agent(assetPrepPrompt(m), { label: loreLabel(builderName, 'prep', m.id), phase: 'Forging', model: 'haiku' })
    }

    phase('Forging')
    log(`${spin('build', qi)} — ${m.id} ${sliceId} [flips ${slice.sc_ids.join(', ')}]`)
    mBuild = await agent(buildPrompt(m, surf, slice, sliceId), { label: loreLabel(builderName, 'build', sliceId), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })

    // ── The Trial: evidence-first review with a bounded fix loop; the Sentinel watches (§3.3) ──
    // The trial's Law scope: this slice's declared flips, run together with every SC the
    // milestone already turned green (regressions observed, not assumed — §5.1).
    const lawCtx = { flips: slice.sc_ids, only: [...new Set([...greenScIds, ...slice.sc_ids])] }
    let logicalRejections = 0
    let escalated = false
    let splitRequired = false
    for (let fix = 0; fix <= MAX_REVIEW_FIXES; fix++) {
      mReview = await evidencedReview(m, surf, slice, sliceId, mBuild, fix, escalated, reviewerName, lawCtx)
      if (approvedOf(mReview)) break
      // The master signal (§3.3): only LOGICAL rejections move the ratchet; mechanical/process
      // failures (tamper, stale evidence, uncommitted, hygiene findings) never escalate, and the
      // builder's own confidence never lowers anything (escalate() encodes both).
      const cls = rejectionClass(mReview)
      if (cls === 'logical') logicalRejections++
      const esc = escalate(livePosture, { type: 'review_rejection', finding_class: cls, rejections: logicalRejections }, GAUGE_CONFIG)
      livePosture = esc.posture
      if (esc.reason.action === 'split_and_rebuild') {
        // STOP the slice — split-and-rebuild is a conductor/operator decision, never a silent retry.
        splitRequired = true
        log(`${m.id} ${sliceId}: ${logicalRejections} logical rejection(s) — SPLIT REQUIRED; stopping this slice and moving on (the conductor/operator decides the split).`)
        await ledger('posture_escalated', { milestone: m.id, slice: sliceId, signal: esc.reason.signal, action: esc.reason.action, changes: esc.reason.changes, rejections: logicalRejections }, 'The Trial')
        break
      }
      if (esc.reason.action === 'escalate_feedback_source' && !escalated) {
        escalated = true
        log(`${m.id} ${sliceId}: ${logicalRejections} logical rejection(s) — escalating the FEEDBACK SOURCE (${codexAvailable ? 'reviewer family swap' : 'fresh-context stronger effort'}), not the retry count`)
        await ledger('posture_escalated', { milestone: m.id, slice: sliceId, signal: esc.reason.signal, action: esc.reason.action, changes: esc.reason.changes, rejections: logicalRejections }, 'The Trial')
      }
      if (fix === MAX_REVIEW_FIXES) { log(`${m.id} ${sliceId}: still REJECTED after ${fix} fix(es) — recording and moving on (validate backstops)`); break }
      log(`${m.id} ${sliceId} REJECTED [${findingLines(mReview).join('; ')}] — fix ${fix + 1}`)
      phase('Forging')
      mBuild = await agent(buildPrompt(m, surf, slice, sliceId, `Reviewer REJECTED the prior attempt: ${findingLines(mReview).join(' | ') || '(no findings reported — re-verify the mapped checks, recommit, and report honestly)'}. Fix these specifically.`), { label: loreLabel(builderName, 'build', `${sliceId}:fix${fix + 1}`), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })
    }
    if (splitRequired) splitLedger.push({ milestone: m.id, slice: sliceId, sc_ids: slice.sc_ids })
    if (approvedOf(mReview)) greenScIds.push(...slice.sc_ids.filter((id) => !greenScIds.includes(id)))
    slices.push({ id: sliceId, objective: slice.objective, sc_ids: slice.sc_ids, files: slice.files || [], done_when: slice.done_when || '', tests_green: mBuild && mBuild.tests_green, review: mReview && mReview.verdict, approved: approvedOf(mReview), split_required: splitRequired, logical_rejections: logicalRejections })
    qi++
  }
  if (cappedOut) log(`${m.id}: hit the ${MAX_SLICES_PER_MILESTONE}-slice cap — building stopped; validate.js backstops the remainder.`)
  } // end !gateOnly Scoring + Forging

  // ── Judgment — the §3.2 milestone gate, exact. Aristotle's goal-backward audit runs at EVERY
  //    milestone boundary (T2-fix ruling) — split/plan-abort branches included, where the verdict
  //    is already mechanical QA_FAIL (the gate must not silently absorb a split the operator
  //    owns) but the audit's findings still MERGE into the failure record, so the conductor's
  //    split/replan decision starts from the full goal picture, not just process state:
  //      · at the tribunal threshold (min_slices_for_tribunal, posture) — dual analysts ∥ the
  //        audit; the audit's findings JOIN the deterministic reconcile; the judge is spawned
  //        ONLY on an ambiguous reconcile (zero blocking findings AND the analysts' overall
  //        verdicts disagree — gateDecision), else the verdict is COMPUTED (hasBlocking →
  //        QA_FAIL, else QA_PASS). Correction-loop semantics kept (≤ MAX_TRIBUNAL_CORRECTION),
  //        with the audit re-run each cycle — a corrective commit moves the boundary it audits.
  //      · below the threshold (the single-slice row) — slice review + goal-backward IS the gate.
  //    Goal-audit failure semantics (ORCHESTRATOR RULING, p2/tasks.md): a null/unusable audit is
  //    re-asked ONCE; still unusable → the boundary verdict is QA_FAIL with the blocking finding
  //    'goal-audit-failure' (ledgered) — the judge NEVER spawns on missing inputs, and no
  //    corrective build is spent on an infrastructure failure (nothing in the CODE was found
  //    wrong; the conductor sees the ledger + finding and decides).
  //    The goal_backward posture dial defaults ON; an operator-forced skip is LEDGERED (§3.5). ──
  phase('Judgment')
  let qa = 'QA_PASS'
  let qaFindings = []
  const splitSlices = slices.filter((s) => s.split_required)
  const goalOn = livePosture.milestone_gate.goal_backward !== false

  // ── Velocity lever 3 (§9 pipelining): launch the NEXT milestone's slice-plan IN PARALLEL with
  //    THIS milestone's gate. The gate is expensive (dual analysts + goal-backward + maybe a judge
  //    + a correction loop) and its agent calls are I/O-bound — the speculative slice-plan call
  //    overlaps that wall-clock for free. We anchor it on base_sha = the HEAD it is cut against;
  //    if the gate then commits a correction, the next milestone's consumer detects the moved HEAD
  //    (pipelineInvalidated) and re-slices. We speculate only when the next milestone exists and
  //    owns Law checks (a no-SC milestone is skipped before it would consume a plan). The launched
  //    promise resolves to planMilestone's { ok, planned, errors }; per-item fault isolation keeps
  //    a thrown speculation from breaking the gate (the consumer falls back to a fresh plan).
  //    NEVER under gateOnly (P3.5 T3): the gate-only path slices NO milestone, so nothing would
  //    ever consume a speculative plan — launching one would burn a krs-one call for nothing. ──
  const nextM = milestones[milestoneIndex + 1]
  if (!gateOnly && nextM) {
    const nextScs = lawChecks.filter((c) => c.milestone === nextM.id)
    if (nextScs.length) {
      const base_sha = await headSha(`${m.id}:pipeline-base`)
      if (base_sha) {
        const nextSurf = surfaceOf(nextM)
        log(`Pipelining ${nextM.id}'s slice plan in parallel with ${m.id}'s gate (base_sha ${base_sha})`)
        pipelinedPlan = {
          milestoneId: nextM.id,
          base_sha,
          cutDuring: m.id,
          promise: planMilestone(nextM, nextSurf, nextScs).catch(() => null),
        }
      }
    }
  }
  const goalAudit = (suffix) => agent(goalBackwardPrompt(m), { label: loreLabel('aristotle', 'goal-backward', suffix), phase: 'Judgment', model: 'opus', schema: QA_FINDINGS_SCHEMA })
  // auditOrNull — the ruling's retry shape: returns a USABLE report, or null after the ONE
  // re-ask (ledgered goal_audit_failure); the caller fails the boundary closed on null.
  const auditOrNull = async (suffix, first) => {
    let g = first === undefined ? await goalAudit(suffix) : first
    if (!goalAuditUsable(g)) {
      log(`${m.id}: the goal-backward audit returned no usable report — re-asking ONCE (orchestrator ruling)`)
      g = await goalAudit(`${suffix}:retry`)
    }
    if (goalAuditUsable(g)) return g
    await ledger('goal_audit_failure', { milestone: m.id, at: suffix, retried: true }, 'Judgment')
    return null
  }
  const skipAudit = async () => {
    log(`${m.id}: goal-backward audit SKIPPED — posture milestone_gate.goal_backward=false (operator override); ledgered.`)
    await ledger('gate_skipped', { milestone: m.id, gate: 'goal_backward', reason: 'posture milestone_gate.goal_backward=false (operator override)' }, 'Judgment')
  }
  if (splitSlices.length || planAborted) {
    qa = 'QA_FAIL'
    qaFindings = [
      ...splitSlices.map((s) => `[split_required] ${s.id} "${s.objective}" stopped after ${s.logical_rejections} logical rejections — split-and-rebuild is a conductor/operator decision (SCs not trustworthy: ${s.sc_ids.join(', ')})`),
      ...(planAborted ? ['[slice_plan] the replanned remainder failed SC coverage — the milestone is incomplete'] : []),
    ]
    log(`${m.id}: QA_FAIL determined mechanically (${splitSlices.length} split-required slice(s)${planAborted ? ', aborted slice plan' : ''}) — no tribunal spend (nothing on this branch can pass); the conductor decides.`)
    // T2-fix ruling: the boundary audit still runs on this failed boundary — its findings merge
    // into the failure record (the verdict stays the mechanical QA_FAIL above).
    if (goalOn) {
      const goal = await auditOrNull(`${m.id}:failed`)
      if (goal) qaFindings.push(...denzelReconcile(goal, null).summaryLines)
      else qaFindings.push(GOAL_AUDIT_FAILURE)
    } else await skipAudit()
  } else if (forceTribunal || tribunalThreshold(slices.length, livePosture.milestone_gate.min_slices_for_tribunal)) {
    // forceTribunal (gateOnly, P3.5 T3): the historical slice count is unknown to a fresh session,
    // so route CONSERVATIVELY to the FULL tribunal regardless of min_slices_for_tribunal — fail
    // toward scrutiny, gate-only never lowers the gate.
    if (!goalOn) await skipAudit()
    for (let c = 0; c <= MAX_TRIBUNAL_CORRECTION; c++) {
      const legs = [
        () => agent(kenPrompt(m), { label: loreLabel('ken', 'qa', `${m.id}:c${c}`), phase: 'Judgment', model: 'opus', schema: QA_FINDINGS_SCHEMA }),
        () => agent(ryuPrompt(m), { label: loreLabel('ryu', 'qa', `${m.id}:c${c}`), phase: 'Judgment', model: 'sonnet', schema: QA_FINDINGS_SCHEMA }),
      ]
      if (goalOn) legs.push(() => goalAudit(`${m.id}:c${c}`))
      const reports = await parallel(legs)
      // Goal-audit failure semantics (ORCHESTRATOR RULING): an unusable audit leg is re-asked
      // ONCE; still unusable → QA_FAIL with the blocking 'goal-audit-failure' finding — the
      // judge NEVER spawns on missing inputs, and the correction loop ends (an infrastructure
      // failure is not a code defect a corrective build can fix).
      let goal = null
      if (goalOn) {
        goal = await auditOrNull(`${m.id}:c${c}`, reports[2])
        if (!goal) {
          qa = 'QA_FAIL'
          qaFindings = [GOAL_AUDIT_FAILURE, ...denzelReconcile(reports[0], reports[1]).summaryLines]
          log(`${m.id}: QA_FAIL — ${GOAL_AUDIT_FAILURE}`)
          break
        }
      }
      // The audit's findings JOIN the reconcile (§3.2) — denzelReconcile is a pure associative
      // merge (dedupe by normalized text, max severity wins), so folding the third report
      // through a second pass is exact, not approximate.
      const reconciled = denzelReconcile(denzelReconcile(reports[0], reports[1]), goal)
      qaFindings = reconciled.summaryLines
      log(`${spin('qa', c)} — ${m.id}: Denzel reconciles — ${reconciled.findings.length} finding(s), ${reconciled.blocking.length} blocking${goalOn ? ' (goal-backward joined the reconcile)' : ''}`)
      // §3.2 judge-spawn condition, computed in-script (gateDecision) over USABLE inputs only —
      // the unusable-audit branch above already failed closed without reaching here.
      const decision = gateDecision(reconciled, reports[0] && reports[0].overall, reports[1] && reports[1].overall)
      let v
      if (decision.judge) {
        log(`${m.id}: ${decision.reason} — Judge Dredd is spawned`)
        const verdict = await agent(judgePrompt(m, reconciled), { label: loreLabel('judge-dredd', 'verdict', `${m.id}:c${c}`), phase: 'Judgment', model: 'opus', schema: VERDICT_SCHEMA })
        v = (verdict && verdict.verdict === 'QA_PASS') ? 'QA_PASS' : 'QA_FAIL' // a dead judge fails closed
      } else {
        v = decision.verdict
        log(`${m.id}: ${decision.reason}`)
      }
      if (v === 'QA_PASS') { qa = 'QA_PASS'; log(`${m.id}: QA_PASS (milestone gate, cycle ${c})`); break }
      if (c === MAX_TRIBUNAL_CORRECTION) { qa = 'QA_FAIL'; log(`${m.id}: QA_FAIL after ${c} correction(s) — escalating to validate`); break }
      // One corrective build + the SAME evidence-first trial (runner → gates → cross-family review),
      // then re-gate once. The correction is milestone-wide, so it maps to ALL milestone SCs —
      // and its trial's flip plan covers them all (already-green SCs fold into the regression
      // guard, red ones into the expected flips; statusBefore is the recorded last run).
      const fixNote = `Milestone gate QA_FAIL. Fix every blocking finding, keep tests green, recommit:\n${reconciled.summaryLines.join('\n')}`
      const correctionSlice = { objective: `Milestone-gate correction for ${m.id} — fix every blocking finding`, files: [], constraints: '', done_when: m.acceptance, sc_ids: mScIds }
      phase('Forging')
      log(`${spin('build', 99)} — ${m.id} gate correction ${c + 1}`)
      mBuild = await agent(buildPrompt(m, surf, correctionSlice, `${m.id}:correct${c + 1}`, fixNote), { label: loreLabel(builderName, 'build', `${m.id}:correct${c + 1}`), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })
      mReview = (await evidencedReview(m, surf, correctionSlice, `${m.id}:correct${c + 1}`, mBuild, 0, false, reviewerName, { flips: mScIds, only: mScIds })) || mReview
      phase('Judgment')
    }
  } else if (slices.length >= 1) {
    // §3.2 single-slice row (and any posture-raised threshold): the cross-family slice review +
    // the goal-backward audit IS the gate — tribunal redundancy skip, never an unaudited pass.
    // Fail closed per the orchestrator ruling: an unusable audit is re-asked ONCE, then the gate
    // is QA_FAIL with the blocking 'goal-audit-failure' finding (validate backstops; the
    // conductor sees why). An operator-forced skip is ledgered and gates on the slice review alone.
    let goal = null
    let goalDead = false
    if (goalOn) {
      goal = await auditOrNull(m.id)
      goalDead = !goal
    } else await skipAudit()
    const sliceOk = slices.every((s) => s.approved)
    const goalRec = denzelReconcile(goal, null) // same blocking arithmetic as the tribunal reconcile
    const goalOk = !goalOn || (!goalDead && !goalRec.hasBlocking)
    qa = (sliceOk && goalOk) ? 'QA_PASS' : 'QA_FAIL'
    qaFindings = [
      ...slices.filter((s) => !s.approved).map((s) => `[slice] ${s.id} "${s.objective}" was not approved by the cross-family review`),
      ...(goalDead ? [GOAL_AUDIT_FAILURE] : []),
      ...goalRec.summaryLines,
    ]
    log(`${m.id}: ${slices.length} slice(s), below the tribunal threshold (${livePosture.milestone_gate.min_slices_for_tribunal}) — slice review + goal-backward IS the gate (${qa})`)
  } else {
    qa = 'QA_FAIL'
    qaFindings = ['no slice was built']
    log(`${m.id}: no slices built — QA_FAIL`)
  }

  // Update living docs so the next milestone's slicer/builder has current context. SKIPPED under
  // gateOnly (P3.5 T3): nothing was sliced or built — "was just built" would be a lie, and there is
  // no next-milestone slicer to feed (gate-only re-runs a gate over an already-complete build).
  if (!gateOnly) {
    phase('The Forge Heats')
    await agent(
      `You are the codebase-state authority. ${scope} ${repoRuleLine}\n\n` +
      `<task>Milestone ${m.id} ("${m.title}") was just built. Update ${codebaseStateFile}: what now exists (modules, public surface) so the next milestone's slicer and builder have accurate context. Read 'git -C ${projectPath} log --oneline -8' and 'git -C ${projectPath} show --stat HEAD' for what changed.</task>`,
      { label: loreLabel('rakim', 'state', m.id), phase: 'The Forge Heats', model: 'haiku' }
    )
  }

  results.push({
    id: m.id, title: m.title, surface: surf,
    slices: slices.length,
    sc_ids: mScIds,
    // gateOnly green ⇒ the Law is green over the completed build (the trial proved it); the empty
    // slice list must NOT read as "no tests green" or the milestone would drop out of `passed`.
    tests_green: gateOnlyGreen ? true : (slices.length === 0 ? false : slices.every((s) => s.tests_green !== false)),
    qa, findings: qaFindings,
    split_required: splitSlices.map((s) => s.id),
    replanned,
    ...(gateOnly ? { gate_only: true } : {}),
  })
}

  const passed = results.filter((r) => r.qa === 'QA_PASS' && r.tests_green)
  const allPassed = passed.length === results.length && results.length > 0
  log(`The orchestra takes a bow — ${passed.length}/${results.length} milestone(s) passed QA${splitLedger.length ? ` · ${splitLedger.length} slice(s) await an operator split decision` : ''}`)
  // §3.5 stage bracket (P3.6 T4): the build stage COMPLETES only when every milestone passed its
  // gate. A QA_FAIL / refusal / gate-only-on-red leaves the projection at 'build' (accurate — the
  // conductor re-enters via the correction loop or a gate-only retry). Fail-open like every ledger leg.
  if (allPassed) await ledger('stage_completed', { stage: 'build', milestones: results.length, passed: passed.length }, 'Judgment')
  return { built: results, passed: passed.map((r) => r.id), all_passed: allPassed, law_gated: true, split_required: splitLedger }
} finally {
  // §7 / T2.3 stage-end sweep: UNCONDITIONAL at build end — reaps THIS build's browser survivors
  // (an outer-deadline SIGKILL of a probe wrapper, a crashed run mid-probe) before the stage hands
  // off. kiln-law's per-run brackets are the inner defense; this is the OUTER one, run-token
  // scoped to BUILD_RUN_TOKEN. The sweep is itself try/guarded so a cleanup failure can never mask
  // a real build error propagating out of the try.
  try { await stageSweep('stage-end') } catch (e) { log(`stage-end browser sweep failed (non-fatal): ${e && e.message ? e.message : e}`) }
}
