// GENERATED from workflows-src/build.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-build',
  description: 'Kiln build stage — two nested loops over the locked Law. OUTER: each master-plan milestone in dependency order (sequential, cumulative commits). INNER: the batch slice spine — KRS-One plans the milestone\'s ENTIRE ordered slice list in ONE call, mapped 1:1 to law.json SC ids (coverage is arithmetic, validated in-script); a haiku confirm checks each slice against live state before its build; a builder implements the slice (Opus builds ui/mixed, Codex builds logic) and commits it; the deterministic runner then executes kiln-law (verify = tamper gate; run --only/--flips = the §5.1 red/green lifecycle where the EXIT CODE is the verdict — expected flips computed from the recorded prior status via --before, previously-GREEN regressions fatal) and persists the project suite as hashed evidence (kiln-law suite → suite.log + suite.jsonl in the evidence dir), and the workflow gates tamper + evidence freshness + the lifecycle exit MECHANICALLY — a touched lock, stale evidence, or a failed flip auto-REJECTS with no reviewer spawned. A cross-FAMILY reviewer rules on diff + evidence with mechanical|logical finding classes and must re-run the mapped checks itself; the Sentinel escalates the feedback source after repeated logical rejections and stops a slice as split_required at the split threshold (a conductor/operator decision, never silent). After the slices integrate, the §3.2 milestone gate rules: Aristotle\'s goal-backward audit hunts "checks pass but the goal is broken" at EVERY milestone boundary — split/plan-abort failures included, where its findings merge into the failure record — and an unusable audit is re-asked ONCE, then fails the boundary closed (QA_FAIL, blocking finding goal-audit-failure; the judge NEVER spawns on missing inputs); milestones at the tribunal threshold add dual analysts (Ken/Opus ∥ Ryu/Codex) whose findings the deterministic reconcile folds with the audit\'s, and the judge is spawned ONLY on an ambiguous reconcile (zero blocking findings AND the analysts\' overall verdicts disagree) — otherwise the verdict is computed; below the threshold the slice review + the audit IS the gate. Velocity lever 3 (§9): the next milestone\'s slice plan is cut SPECULATIVELY in parallel with the current milestone\'s gate, anchored on its base_sha — any corrective commit on the current milestone (tribunal correction / validate loop) moves HEAD and invalidates it (ledgered slice_plan_invalidated), forcing a re-slice against the new HEAD. The heavy end-to-end gate is validate, not per-slice ceremony.',
  phases: [
    { title: 'The Forge Heats', detail: 'read the locked Law; rakim ensures the git repo + seeds codebase-state; parse the master plan into milestones' },
    { title: 'Scoring the Cut', detail: 'KRS-One plans the milestone\'s entire ordered slice list in ONE call, mapped to the Law\'s SC ids (reusing a valid pipelined plan from the prior gate when HEAD has not moved); a haiku confirm checks each slice against live state (proceed | replan)' },
    { title: 'Forging', detail: 'builder implements the slice (Opus for ui/mixed, Codex for logic) and commits it' },
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
const PAYLOAD_FIRST = 'Your ENTIRE final message is ONE StructuredOutput tool call — no prose before or after it. Emit the payload properties FIRST; reasoning is the LAST property, OPTIONAL, and under 50 words — put detail in the designated report file or field, never in reasoning. A long leading reasoning string is the observed death mode: the call truncates before the payload lands, the validator rejects it, each rejection burns one of five attempts, and five failures kill this leg.'
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('build.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
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
const GAUGE_CONFIG = {"h80_human_hours":2,"messiness_discount":0.5,"churn_flips_threshold":2,"rejections_to_feedback_escalation":2,"rejections_to_split":3,"deescalation_clean_window":1,"research_topics_base":2,"planning_dual_d4_min":2,"planning_dual_d3_min":1,"planning_dual_d1_min":1,"planning_redteam_d4_min":1,"planning_redteam_d8_min":1,"plan_validation_rounds_base":1,"plan_validation_d2_min":1,"plan_validation_d8_min":2,"slice_budget_d7_min":1,"d7_slice_budget_factor":0.5,"review_high_d8_min":1,"min_slices_for_tribunal":2,"trivial_tier_dim_max":0,"trivial_tier_soft_dims":["D6"],"trivial_tier_soft_dim_max":1,"tribunal_threshold_trivial_bump":1,"browser_tier2_d7_min":1,"browser_tier2_d8_min":1,"validate_adversarial_d8_min":2,"validate_second_family_d8_min":2,"effort_bias_dims":["D3","D4","D8"]}
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
  // P5.5: the scope tier the trivial-tier levers key on. Fail-soft to 'standard' — an absent
  // or unknown tier means NO lever fires (false-standard costs minutes, false-trivial costs gates).
  scope_tier: P0.scope_tier === 'trivial' ? 'trivial' : 'standard',
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

// ── Codex model pins (CODEX_MODEL default + CODEX_FALLBACK, inlined from src/models.mjs) ──
// models.mjs — the codex model pins, single source of truth (BLUEPRINT WS-B2). Inlined verbatim
// into every GPT-pinning workflow by the `// @models` bundler marker (like @gate pulls the whole
// module), so the model id can never drift across build/gauge/architecture/validate.
// DOCTRINE (references/codex-prompt-guide.md): the fallback is RECORDED when used, never silent — a
// leg that drops to CODEX_FALLBACK must capture the chosen model in its archived output, never
// downgrade invisibly.
const CODEX_MODEL = 'gpt-5.6-sol' // GPT-5.6 Sol, GA 2026-07-09 — the codex CLI model id
const CODEX_FALLBACK = 'gpt-5.5'  // recorded rollout fallback (5.4 dropped — two rungs suffice)

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

// ── Schemas (additionalProperties:false; payload fields FIRST, reasoning LAST + optional + capped — a long leading reasoning string truncated tool calls before the payload landed and blew the 5-attempt retry cap) ──
const MILESTONES_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
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
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['milestones'],
}
const LAW_READ_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    locked: { type: 'boolean', description: 'true iff lock_commit is a non-null string' },
    checks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string' }, milestone: { type: 'string' }, kind: { type: 'string', enum: ['shell', 'pytest', 'http', 'probe'] } },
        required: ['id', 'milestone', 'kind'],
      },
    },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['locked', 'checks'],
}
const SLICE_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
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
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['slices'],
}
const CONFIRM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['proceed', 'replan'] },
    reason: { type: 'string', description: 'the concrete contradiction with codebase-state (replan only)' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['decision'],
}
const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    tests_green: { type: 'boolean', description: 'the check/suite passes after implementation' },
    committed: { type: 'boolean' },
    evidence: { type: 'string' },
    slice_id: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    tests_added: { type: 'array', items: { type: 'string' } },
    red_confirmed: { type: 'boolean', description: 'tests were observed failing before implementation (false is fine for a static page)' },
    test_command: { type: 'string' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['tests_green', 'committed', 'evidence'],
}
const RUNNER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verify_exit: { type: 'number', description: 'exit code of kiln-law verify (step 1)' },
    tamper_paths: { type: 'array', items: { type: 'string' }, description: 'every path from a TAMPER: line, any step (empty if none)' },
    law_run_exit: { type: 'number', description: 'exit code of kiln-law run (step 2) — the §5.1 lifecycle verdict the workflow gates on mechanically' },
    flip_unmet: { type: 'array', items: { type: 'string' }, description: 'every id from a FLIP_UNMET line of step 2, verbatim (empty if none or step 2 never ran)' },
    regressed: { type: 'array', items: { type: 'string' }, description: 'every id from a REGRESSION line of step 2, verbatim (empty if none or step 2 never ran)' },
    run_id: { type: 'string', description: 'verbatim from the RUN <runId> HEAD <head> line' },
    head: { type: 'string', description: 'verbatim HEAD sha from the RUN line' },
    suite_cmd: { type: 'string', description: 'the project suite command kiln-law suite ran (step 3)' },
    suite_exit: { type: 'number', description: 'the REAL suite exit from step 3\'s SUITE line (its output is persisted as suite.log + suite.jsonl in the evidence dir)' },
    // D1 failure-fingerprint signal (§9 velocity): the per-check exits kiln-law recorded in
    // evidence/<runId>/results.jsonl, transcribed VERBATIM — the infra-vs-assertion split the retry
    // router keys on. OPTIONAL by design: an absent/garbled array yields NO fingerprint, so the
    // admission behaves exactly as v3.0.1 (the Sentinel alone). Never inferred — only transcribed.
    check_results: {
      type: 'array',
      description: 'every line of evidence/<runId>/results.jsonl as { id, exit, timeout } — id verbatim, exit the recorded exit code, timeout true iff exit is 124 or 79 (empty if the file is absent or step 2 never ran)',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          exit: { type: 'number' },
          timeout: { type: 'boolean' },
        },
        required: ['id', 'exit', 'timeout'],
      },
    },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['verify_exit', 'tamper_paths', 'flip_unmet', 'regressed'],
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
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['verdict', 'law_green', 'tests_green', 'findings'],
}
const QA_FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
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
    report_file: { type: 'string' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['findings', 'overall'],
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['QA_PASS', 'QA_FAIL'] },
    findings: { type: 'array', items: { type: 'string' } },
    severity: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['verdict', 'findings'],
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
function failureFingerprint(checkResults, gate) {
  const NULL_FP = { class: null, failed: [], signature: '' }
  const g = (gate && typeof gate === 'object' && !Array.isArray(gate)) ? gate : null
  if (!g || g.verdict !== 'red') return NULL_FP
  if (!Array.isArray(checkResults) || !checkResults.length) return NULL_FP
  const INFRA_EXITS = [124, 77, 78, 79, 126, 127]
  const failed = []
  for (const row of checkResults) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return NULL_FP
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!id) return NULL_FP
    if (typeof row.exit !== 'number' || !Number.isFinite(row.exit)) return NULL_FP
    if (typeof row.timeout !== 'boolean') return NULL_FP
    if (!row.timeout && row.exit === 0) continue // a green check is not a failure
    const cls = (row.timeout || INFRA_EXITS.includes(row.exit) || row.exit < 0) ? 'infra' : 'assertion'
    failed.push({ id, cls })
  }
  if (!failed.length) return NULL_FP
  failed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const anyInfra = failed.some((f) => f.cls === 'infra')
  const anyAssertion = failed.some((f) => f.cls === 'assertion')
  const klass = (anyInfra && anyAssertion) ? 'mixed' : (anyInfra ? 'infra' : 'assertion')
  return { class: klass, failed: failed.map((f) => f.id), signature: `${klass}|${failed.map((f) => `${f.id}:${f.cls}`).join(',')}` }
}
function admitRetry(prevFp, curFp) {
  const norm = (fp) => (fp && typeof fp === 'object' && !Array.isArray(fp)
    && (fp.class === 'infra' || fp.class === 'assertion' || fp.class === 'mixed')
    && typeof fp.signature === 'string' && fp.signature) ? fp : null
  const cur = norm(curFp)
  if (!cur) return { admit: true, reason: 'no_fingerprint' }
  const prev = norm(prevFp)
  if (!prev) return { admit: true, reason: 'first' }
  if (prev.signature !== cur.signature) return { admit: true, reason: 'progress' }
  if (cur.class === 'infra' || cur.class === 'mixed') return { admit: false, reason: 'environment_repeat' }
  return { admit: true, escalate_diagnosis: true, reason: 'assertion_repeat' }
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
  // The 'sonnet' model on a build/review leg is the thin Codex wrapper (delegates to the codex model via codex exec).
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

// P5.5 lever 2 (§9, run-a-report.md): the deterministic runner EXECUTES kiln-law and TRANSCRIBES
// its output — the gate arithmetic is downstream and deterministic (kiln-law exit codes + evidence
// hashes), so a weaker transcription seat cannot weaken the gate; it can only fail more visibly,
// which the fail-closed tamper/stale/red paths already catch. At trivial scope the seat downshifts
// to haiku; at standard it stays sonnet. Keyed on scope_tier ONLY — the effort dial is a per-call
// reasoning signal, never a scope signal (the r1 finding). Both trial call sites route through it.
const runnerModel = livePosture.scope_tier === 'trivial' ? 'haiku' : 'sonnet'

// Review verdict helpers. approvedOf is the ONE approval predicate: verdict, the reviewer's own
// suite re-run, AND the reviewer's own kiln-law re-run (§6 independent-rerun floor) must all hold.
const approvedOf = (rev) => !!(rev && rev.verdict === 'APPROVED' && rev.tests_green !== false && rev.law_green !== false)
const findingLines = (rev) => ((rev && rev.findings) || []).map((f) => f && f.text).filter(Boolean)
// fpOrNull — normalize a tagged fingerprint: only a REAL signature counts (Sol WSD-r1 finding 4 —
// the truthy NULL-fingerprint object must never leak '' into telemetry or the router's prev slot).
const fpOrNull = (fp) => (fp && typeof fp === 'object' && !Array.isArray(fp) && typeof fp.signature === 'string' && fp.signature) ? fp : null
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

// ── Gate hardening: the single gateAgent (+ isStructuredOutputFailure / classifyGateFailure),
//    inlined from src/gate.mjs — a mute gate leg DEGRADES to null, never detonates the run. ──
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

const NO_WANDER = 'Read ONLY the files named in this brief (absolute paths). Do not search the filesystem or read other projects.'
const repoRule = (projectPath) => `Project repo: ${projectPath}. Work and commit there directly — this is a sequential cumulative build; do NOT create a detached git worktree (later slices and milestones must see your commits). Maintain a .gitignore for the stack and NEVER commit generated artifacts (Python: __pycache__/, *.pyc, *.egg-info/, build/, dist/, .pytest_cache/) — add them to .gitignore and 'git rm --cached' any that slipped in.`
const scope = NO_WANDER
const repoRuleLine = repoRule(projectPath)
// The wrapper TRANSLATES the brief into a 4-part Codex prompt — it never forwards it verbatim.
// The full discipline (per-role flags, --output-schema/reasoning-first/flat-schema, heredoc-to-stdin,
// the codex #15451 caveat) lives in references/codex-prompt-guide.md — point at it, don't duplicate it.
const codexGuide = pluginRoot ? `${pluginRoot}/references/codex-prompt-guide.md` : null
const codexHowto = codexGuide
  ? `You shell out to ${CODEX_MODEL} via 'codex exec'. Read ${codexGuide} and follow it — it is the single source of truth for the codex-prompt discipline (TRANSLATE the brief, never forward it; per-role flags; --output-schema/reasoning-first/flat-schema; the heredoc-to-stdin invocation; the exit-0 and #15451 caveats). If ${CODEX_MODEL} is unavailable retry with -m ${CODEX_FALLBACK}; if codex still produces no usable artifact, do the work directly.`
  : `You shell out to ${CODEX_MODEL} via 'codex exec': TRANSLATE this brief into a Codex-native prompt (do not forward it verbatim), pipe it via stdin, and close the verify loop on the test command. If ${CODEX_MODEL} is unavailable retry with -m ${CODEX_FALLBACK}; if codex still produces no usable artifact, implement directly with your file tools.`

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
    `- A slice = ONE distinct, independently-runnable user-facing behavior that can be invoked and verified on its own by a single runnable check (a CLI subcommand, an API call, a rendered-and-exercised page, one pure function). ` +
    // P5.5 lever 1: at trivial tier the slice BUDGET rules the grouping (Run A: 16 SCs went into
    // 5 slices where 2-3 carried identical verification value — the per-slice fixed cost is where
    // the trivial tier bleeds). At standard, the pre-P5.5 text rides byte-identical.
    (livePosture.scope_tier === 'trivial'
      ? `Decompose the milestone by such behaviors in dependency order — then GROUP toward the budget: at trivial scope (the Gauge's ruling) the slice budget is the sizing authority, not behavior count. Group ADJACENT behaviors on the same seam (same file cluster, same runnable check family) into one slice up to the budget — the trial runs the cumulative SC set and regressions are observed per-trial, so grouping loses no verification value; a multi-command CLI is two or three grouped slices, not one per command.\n`
      : `Decompose the milestone by such behaviors, in dependency order: a multi-command CLI gives a slice per command (add / list / done / rm), a CRUD resource a slice per operation.\n`) +
    `- Do NOT manufacture slices. If a candidate part has no runnable check distinct from another's, FOLD it. A single render artifact (one page — its hero, countdown, and rows share the one render check), one endpoint, or one pure function is ONE slice; a region that only renders within a page is never its own slice. Scaffolding, packaging, config, and shared storage are NEVER their own slice — they ride inside the FIRST behavior slice that needs them (e.g. the JSON store folds into add).\n` +
    `- SC coverage is ARITHMETIC, not judgment: every Law check id listed above must appear in EXACTLY ONE slice's sc_ids (none missing, none twice), and every slice must flip at least one. 'probe'-kind checks are deferred templates this phase — still assign each to the slice that builds its surface.\n` +
    `- Slice budget (the Gauge): size each slice at roughly ≤ ${livePosture.slice_budget_hours}h human-equivalent of work; smaller, verifiable slices beat bloated ones. Emit at most ${MAX_SLICES_PER_MILESTONE} slices.\n` +
    `</constraints>\n\n` +
    (note ? `<correction>\n${note}\n</correction>\n\n` : '') +
    `<task>Return the ordered slice list: each {objective, files[], constraints, done_when, sc_ids[]} with a zero-ambiguity done_when. Emit slices first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
}

function confirmPrompt(m, slice) {
  return `You are the slice confirmer — a cheap pre-build drift check, not a reviewer.\n\n` +
    `<inputs>\n` +
    `- Next planned slice for milestone ${m.id}: ${slice.objective}\n` +
    `- Files in scope: ${(slice.files || []).join(', ') || '(builder decides)'}\n` +
    `- Done when: ${slice.done_when}. Flips: ${slice.sc_ids.join(', ')}\n` +
    `- Read ${codebaseStateFile} (the live codebase state). ${scope}\n` +
    `</inputs>\n\n` +
    `<task>Decide 'proceed' (the slice still matches the live state) or 'replan' ONLY on a concrete contradiction: the objective is already built, its files were restructured away, or its done_when is impossible as scoped. Doubt is not drift — when unsure, proceed. On replan, state the contradiction in reason. Emit decision (and reason) first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
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
      `<task>Build the slice, run the static check, then 'git add -A && git commit' with a clear message. Report tests_green (the static/smoke check passed), committed, and concrete evidence of what you observed FIRST, then files_changed, tests_added (smoke), red_confirmed (false is fine for a page), and the check command; reasoning is optional and under 50 words. Structured-output discipline (a platform guardrail killed a builder at the retry cap here): your work product lives in the COMMIT, never in the final message — the final message is ONLY the StructuredOutput tool call carrying EVERY required field (evidence = the few decisive lines, trimmed; reasoning LAST, optional, under 50 words); a reasoning-heavy or missing-field attempt burns one of five retries, and five failures kill the slice.</task>`
  }
  // logic slice — Codex builds (cross-family vs the Opus reviewer)
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
    `<task>Implement the slice to green tests, then 'git add -A && git commit' with a clear message. Report tests_green (must be true), committed, and the trimmed passing test output as evidence FIRST, then files_changed, tests_added, red_confirmed, and the test_command you used; reasoning is optional and under 50 words. Structured-output discipline (a platform guardrail killed a builder at the retry cap here): your work product lives in the COMMIT, never in the final message — the final message is ONLY the StructuredOutput tool call carrying EVERY required field (evidence = the few decisive lines, trimmed; reasoning LAST, optional, under 50 words); a reasoning-heavy or missing-field attempt burns one of five retries, and five failures kill the slice.</task>`
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
    `   law_run_exit = its exit code — the lifecycle VERDICT the workflow gates on mechanically ${lawVerdictNote}. From its 'RUN <runId> HEAD <head>' line report run_id and head VERBATIM. Collect every 'FLIP_UNMET <id>' line's id into flip_unmet and every 'REGRESSION <id>' line's id into regressed (empty arrays if none). Add any TAMPER paths to tamper_paths. RED/GREEN/PROBE_DEFERRED check lines are EVIDENCE — transcribe, never fix.\n` +
    `   Then TRANSCRIBE the per-check evidence: 'cat ${kilnDir}/evidence/<runId>/results.jsonl' (substitute <runId> from the RUN line) and report check_results = one { id, exit, timeout } per line VERBATIM — id and exit as the JSON records them, timeout = true iff exit is 124 or 79 (a deferred line records no exit — skip that line entirely). Report [] if the file is absent or step 2 never ran. Do not infer; only transcribe. This transcription happens on EVERY run that reached step 2 — a red law_run_exit skips only the suite, never this.\n` +
    `   If law_run_exit is not 0, STOP after that transcription — skip step 3.\n` +
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
      ? `<how>${codexGuideNote}Delegate this review to ${CODEX_MODEL} via 'codex exec' at model_reasoning_effort="${effort}" — you are the thin wrapper and the cross-model check; if codex errors, review directly as the independent reviewer.</how>\n\n`
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
      `<task>Set law_green from YOUR kiln-law re-run and tests_green from the static/smoke check you re-ran. Verdict APPROVED only if the mapped checks pass and the page is structurally sound, accessible, on-brief, and free of invented claims; else REJECTED with specific, actionable findings. ${classRule} Emit verdict, law_green, tests_green, and findings first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
  }
  const how = leg.viaCodex
    ? `<how>${codexGuideNote}Delegate this review to ${CODEX_MODEL} via 'codex exec' at model_reasoning_effort="${effort}" — a genuinely cross-family second judgment; if codex errors, review directly as the independent reviewer.</how>\n\n`
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
    `<task>Verdict APPROVED only if the mapped checks and the suite are green from YOUR OWN runs AND the implementation is real AND on-spec; else REJECTED with specific [file:line] findings. Set law_green and tests_green from your own runs. ${classRule} Emit verdict, law_green, tests_green, and findings first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
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
    `<task>Write findings to ${qaDir}/qa-report-a.md — persist it via a Bash heredoc (mkdir -p the dir, then cat with a quoted heredoc into the file) — NEVER the Write tool: a platform guardrail rejects subagent Write calls on report files, and the rejection poisons the structured-output attempts that follow (an observed death mode). Return findings[] (each {text, severity}) and overall FIRST, then report_file. ${overallRule} Quote specific evidence ([file:line] or test output). Apply scrutiny to EVERY acceptance criterion, not just the first. Put ALL detail in the report file; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
}
function ryuPrompt(m) {
  return (codexAvailable
    ? `You are QA analyst B, delegating analysis to ${CODEX_MODEL} via 'codex exec' for a genuinely cross-model second perspective — run codex at model_reasoning_effort="high". ${codexGuideNote}If it errors, analyze directly.\n`
    : `You are QA analyst B — an independent second perspective.\n`) +
    `Run the tests yourself and probe DIFFERENT failure modes than a first pass would.\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n- Inspect the repo at ${projectPath}: git log/diff, read files, RUN the tests.\n</inputs>\n\n` +
    `<task>Write findings to ${qaDir}/qa-report-b.md — persist it via a Bash heredoc (mkdir -p the dir, then cat with a quoted heredoc into the file) — NEVER the Write tool: a platform guardrail rejects subagent Write calls on report files, and the rejection poisons the structured-output attempts that follow (an observed death mode). Return findings[] (each {text, severity}) and overall FIRST, then report_file. ${overallRule} Do NOT read analyst A's report — stay independent. Put ALL detail in the report file; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
}
// goalBackwardPrompt — the §3.2 boundary auditor: works BACKWARD from the milestone goal (GSD
// discipline), explicitly hunting "all checks pass but the goal is broken" before validate.
function goalBackwardPrompt(m) {
  return voice('opus') +
    `You are the goal-backward auditor at the milestone boundary. Your one question: does the INTEGRATED milestone genuinely deliver its GOAL? Work BACKWARD from the goal — never forward from the checks (they all pass; that comfort is exactly what you distrust).\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n- Summary: ${m.summary || '(none)'}\n- The live repo at ${projectPath}: git log/diff, read the files, and EXERCISE the product the way a user would (run the CLI, call the API, render the page statically — no browser).\n</inputs>\n\n` +
    `<task>Hunt the "checks pass, goal broken" class specifically: acceptance met by the letter but broken in spirit, slices that pass alone but never connect, features that exist but cannot be reached from the product's entry points, hardcoded or stub behavior hiding behind a green check. Write your report to ${qaDir}/goal-backward-${m.id}.md — persist it via a Bash heredoc (mkdir -p the dir, then cat with a quoted heredoc into the file) — NEVER the Write tool: a platform guardrail rejects subagent Write calls on report files, and the rejection poisons the structured-output attempts that follow (an observed death mode). Return findings[] (each {text, severity}) and overall ('pass' = the goal is genuinely delivered; 'fail' MUST be backed by at least one critical or high finding) FIRST, then report_file. Put ALL detail in the report file; reasoning is optional and under 50 words. Read-only on source. ${PAYLOAD_FIRST}</task>`
}
function judgePrompt(m, reconciled) {
  return voice('opus') +
    `You are the QA judge — final arbiter for this milestone. Binary verdict, no "PASS with caveats".\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
    `- Reconciled findings (deduped, severity-ranked):\n${reconciled.summaryLines.map((l) => '  - ' + l).join('\n') || '  (none)'}\n` +
    `- The repo at ${projectPath}.\n</inputs>\n\n` +
    `<constraints>\n- ${browserLaw}\n</constraints>\n\n` +
    `<task>RUN the tests yourself at ${projectPath}. Issue QA_PASS only if the milestone genuinely meets its acceptance with green tests and no critical/high findings; else QA_FAIL with the blocking findings. Emit verdict FIRST, then findings and severity as their own properties; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
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
    reasoning: { type: 'string', maxLength: 700 },
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
  properties: { head: { type: 'string', description: 'git rev-parse HEAD — the full sha, or "" if git failed' }, reasoning: { type: 'string', maxLength: 700 } },
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
async function evidencedReview(m, surf, slice, sliceId, build, fix, escalated, reviewerName, lawCtx, prov) {
  // Commit-before-review (unchanged from v2): an uncommitted slice would anchor evidence and
  // review to a stale HEAD. Auto-reject without spending runner or review calls.
  if (build && build.committed === false) {
    log(`${m.id} ${sliceId}: builder did not commit — auto-reject (mechanical), no runner, no reviewer`)
    return autoReject([`Slice was not committed — run 'git add -A && git commit' before the trial (evidence and review anchor to HEAD).`])
  }
  phase('The Trial')
  log(`${spin('law', fix)} — ${m.id} ${sliceId} f${fix}`)
  const runner = await agent(runnerPrompt(build, lawCtx, lastRunId), { label: loreLabel('asimov', 'runner', `${sliceId}:f${fix}`), phase: 'The Trial', model: runnerModel, schema: RUNNER_SCHEMA })
  let fresh = null
  if (runner && typeof runner.run_id === 'string' && runner.run_id) {
    fresh = await agent(freshPrompt(runner.run_id), { label: loreLabel('thoth', 'freshness', `${sliceId}:f${fix}`), phase: 'The Trial', model: 'haiku', schema: FRESHNESS_SCHEMA })
  }
  const gate = runnerGate(runner, fresh)
  // D1 (§9 velocity): fingerprint THIS trial's failure and ride it out on the returned verdict so the
  // retry loop can route the NEXT admission (failureFingerprint emits only on a 'red' gate — a
  // check-level lifecycle failure; everything else is the NULL fingerprint, admitted as v3.0.1). The
  // run id rides too, so a reject brief can name that run's on-disk probe artifacts (D2). tag() is
  // additive — every return object gains .fingerprint + .run_id without changing its verdict shape.
  const fp = failureFingerprint(runner && runner.check_results, gate)
  const runId = (runner && typeof runner.run_id === 'string') ? runner.run_id : null
  const tag = (rev) => { if (rev && typeof rev === 'object' && !Array.isArray(rev)) { rev.fingerprint = fp; rev.run_id = runId } return rev }
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
    return tag(autoReject(named.map((p) => `Locked Law path touched: ${p} — the Law is immutable after lock (§5.1). Revert every change to locked paths and rebuild without touching them; ADD new tests elsewhere instead.`)))
  }
  if (gate.verdict === 'stale') {
    // §6: stale or missing evidence is structurally impossible to approve — no reviewer spawned.
    log(`${m.id} ${sliceId}: evidence gate failed [${gate.reasons.join('; ')}] — auto-reject, no reviewer spawned`)
    return tag(autoReject(gate.reasons.map((r) => `Evidence gate failed — ${r}. Ensure the work is committed at HEAD and the checks can execute; the runner re-fires on the next cycle.`)))
  }
  if (gate.verdict === 'red') {
    // T2-fix ruling: the exit code IS the verdict. A red lifecycle gate (flip unmet / regression)
    // is REJECTED by the WORKFLOW — no reviewer is spent on a slice that mechanically failed its
    // Law; the fix brief names the exact ids. Classed 'logical' (see lawRedReject): a failed
    // check is a genuine defect signal the Sentinel must see.
    log(`${m.id} ${sliceId}: THE LAW IS RED [${gate.reasons.join('; ')}] — exit code is the verdict; auto-reject, no reviewer spawned`)
    await ledger('law_red_auto_reject', { milestone: m.id, slice: sliceId, fix, flip_unmet: gate.flip_unmet, regressed: gate.regressed, reasons: gate.reasons }, 'The Trial')
    return tag(lawRedReject(gate.reasons.map((r) => `The Law's lifecycle gate failed — ${r}. The slice is DONE only when its declared flips are GREEN and nothing previously-GREEN regresses: fix the BEHAVIOR (never the locked checks), recommit, and the runner re-fires.`)))
  }
  const leg = reviewLeg(surf, escalated)
  const effort = reviewEffort(fix, escalated)
  log(`${spin('review', fix)} — ${m.id} ${sliceId} f${fix}${leg.escalated ? ' (escalated feedback source)' : ''}`)
  // gateAgent: a mute reviewer degrades to null — approvedOf(null) rejects, rejectionClass(null)
  // reads 'mechanical', findingLines(null) is empty. Fail-closed, never a silent pass.
  return tag(await gateAgent(reviewPrompt(m, surf, slice, sliceId, build, runner, leg, effort, gate.verification_class), { label: loreLabel(reviewerName, 'review', `${sliceId}:f${fix}${leg.escalated ? ':esc' : ''}`), phase: 'The Trial', model: leg.model, schema: REVIEW_SCHEMA, provenance: prov }))
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
  const runner = await agent(runnerPrompt(null, lawCtx, null), { label: loreLabel('asimov', 'runner', `${m.id}:gate-only`), phase: 'The Trial', model: runnerModel, schema: RUNNER_SCHEMA })
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
  log('BUILD CANNOT START — pluginRoot absent: the kiln-law CLI cannot be located, so the §3.4 Law floor (tamper gate + deterministic check runs) cannot execute. Fix: relaunch with args.pluginRoot = the absolute $PLUGIN_ROOT the conductor resolved at onboarding (${CLAUDE_PLUGIN_ROOT} is unset inside a launched Workflow). Never start an ungated build.')
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
// D2 (§9 velocity): the probe-kind SC ids from the locked Law manifest — a failed probe left real
// DOM/console/screenshot evidence on disk, and its reject brief names those deterministic paths.
const probeScIds = new Set(lawChecks.filter((c) => c.kind === 'probe').map((c) => c.id))
// probeArtifactBrief(runId, failedIds) — the D2 appendix: for each FAILED probe id, the script-
// assembled artifact paths under the run's evidence dir (never model-recalled). Reading these is
// NOT browser authority — the builder still never spawns a browser (amendment 7 intact). Empty
// string when there is no run id or no failed probe among the ids (fail toward the plain brief).
const probeArtifactBrief = (runId, failedIds) => {
  if (typeof runId !== 'string' || !runId.trim()) return ''
  const probes = (Array.isArray(failedIds) ? failedIds : []).filter((id) => typeof id === 'string' && probeScIds.has(id))
  if (!probes.length) return ''
  const dir = `${kilnDir}/evidence/${runId}`
  const lines = probes.map((id) => `  - ${id}: ${dir}/probe-${id}.json (the result), ${dir}/probe-${id}.log (console/stderr), and the screenshot(s) it names in "screenshots" (under ${dir}/)`).join('\n')
  return `\nA probe check FAILED — READ its captured evidence before you change a line (this is the real DOM/console/screenshot state the live probe recorded; reading artifacts is NOT browser authority — never launch a browser or Playwright yourself):\n${lines}\n`
}

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
    `<task>Return the milestones in build order — id, title, summary, acceptance, surface (copy the plan's ui|logic|mixed tag; if absent, infer: a visible/front-facing deliverable is 'ui', a non-visual backend/CLI/logic deliverable is 'logic'), and confidence. Extract exactly what the plan defines — do not invent milestones. Emit milestones first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
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
  // F3 provenance collector: every gate leg in this milestone (slice reviews, the tribunal analysts,
  // the judge, the goal-backward audit) records {requested_model, actual_model, fallback_reason,
  // classification} into a fresh sink; they collect here and ride the EXISTING gate_decision ledger
  // append at the milestone close (no new event type — §B6/§10).
  const gateProv = []

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
    let environmentBlocked = false   // D1: the same infra-bearing failure reproduced with no code change
    let environmentClass = null      // 'infra' | 'mixed' when blocked — Sol WSD-r1 f5: mixed is honest about its assertions
    let environmentAssertions = []   // the unresolved product-assertion SCs inside a mixed block
    let prevFingerprint = null       // D1: the prior attempt's failure fingerprint (router state)
    let repairCapExtension = false   // Sol WSD-r2 f2: one-shot cap stretch — a moved repair at the cap still admits its ONE promised correction
    let attempts = 1                 // D5 telemetry: build attempts spent (the initial build is #1)
    let firstPassGreen = false
    const rejectionClasses = []      // D5 telemetry: the class of each rejection, in order
    const sliceReviewProv = {} // the DECISIVE (last) review's provenance for this slice
    for (let fix = 0; fix <= MAX_REVIEW_FIXES + (repairCapExtension ? 1 : 0); fix++) {
      mReview = await evidencedReview(m, surf, slice, sliceId, mBuild, fix, escalated, reviewerName, lawCtx, sliceReviewProv)
      if (approvedOf(mReview)) { if (fix === 0) firstPassGreen = true; break }
      // The master signal (§3.3): only LOGICAL rejections move the ratchet; mechanical/process
      // failures (tamper, stale evidence, uncommitted, hygiene findings) never escalate, and the
      // builder's own confidence never lowers anything (escalate() encodes both).
      let cls = rejectionClass(mReview)
      if (cls === 'logical') logicalRejections++
      rejectionClasses.push(cls)
      // ── D1 fingerprint router (§9 velocity): decide the NEXT builder attempt's admission BEFORE
      //    spending it. Fail toward v3.0.1 — a null/first/changed fingerprint admits exactly as the
      //    old unconditional respawn; only an IDENTICAL repeat diverts. ──
      const curFingerprint = fpOrNull(mReview && mReview.fingerprint)
      const admission = admitRetry(prevFingerprint, curFingerprint)
      prevFingerprint = curFingerprint
      // Sol WSD-r1 f1 + WSD-r2 f1: the environment-repair trial is an OBSERVATION, not a builder
      // rejection. When its fingerprint MOVES (or the Law clears but the reviewer rejects), its
      // outcome is never counted toward logicalRejections and never reclassifies cls — no builder
      // attempt was spent, so the ratchet has no NEW rejection to record. The GENUINE outer
      // rejection that triggered the repair (already counted above) still walks the Sentinel
      // section at its incremented count, so feedback escalation fires on schedule and the
      // admitted correction is reviewed by the ESCALATED source. repairObserved marks the cycle
      // only so the fix cap can honor the router's promised ONE correction (WSD-r2 f2).
      let repairObserved = false
      if (admission.reason === 'environment_repeat') {
        // The exact same INFRA-bearing failure twice — splitting or re-building an unchanged broken
        // environment just makes two failing slices (plan D1). STOP builder retries: re-run the
        // trial ONCE over the SAME commit (no builder change) — an environment-repair probe.
        const repeatKind = curFingerprint.class === 'mixed' ? 'mixed (infra+assertion)' : 'infra'
        log(`${m.id} ${sliceId}: identical ${repeatKind} failure twice [${curFingerprint.signature}] — environment repeat; re-running the trial ONCE with NO builder change (repairing the environment, never burning a builder attempt into an unchanged broken environment)`)
        await ledger('posture_escalated', { milestone: m.id, slice: sliceId, signal: 'environment_repeat', action: 'environment_repair', changes: [], fingerprint: curFingerprint.signature, fingerprint_class: curFingerprint.class, rejections: logicalRejections }, 'The Trial')
        mReview = await evidencedReview(m, surf, slice, sliceId, mBuild, fix, escalated, reviewerName, lawCtx, sliceReviewProv)
        if (approvedOf(mReview)) break // the repeat CLEARED with no code change — it WAS environmental noise
        const repairFp = fpOrNull(mReview && mReview.fingerprint)
        prevFingerprint = repairFp
        if (repairFp && repairFp.signature === curFingerprint.signature) {
          // Reproduced identically with no code change. Honesty per class (Sol WSD-r1 finding 5):
          // a PURE-infra repeat means the ENVIRONMENT is broken, not the code; a MIXED repeat may
          // NOT say that — it carries product assertion(s) that remain unresolved and still need
          // code work after the environment is repaired.
          environmentBlocked = true
          environmentClass = curFingerprint.class
          environmentAssertions = curFingerprint.class === 'mixed'
            ? curFingerprint.signature.split('|')[1].split(',').filter((p) => p.endsWith(':assertion')).map((p) => p.slice(0, -':assertion'.length))
            : []
          if (environmentClass === 'mixed') {
            log(`${m.id} ${sliceId}: the environment-repair trial reproduced the identical MIXED failure — closing the slice BLOCKED (class mixed): the infra fault needs environment repair AND product assertion(s) remain unresolved (${environmentAssertions.join(', ') || 'unnamed'}); code work is still owed after the repair`)
          } else {
            log(`${m.id} ${sliceId}: the environment-repair trial reproduced the identical infra failure — closing the slice BLOCKED (class environment); the conductor/operator repairs the ENVIRONMENT, not the code`)
          }
          await ledger('posture_escalated', { milestone: m.id, slice: sliceId, signal: 'environment_repeat', action: 'environment_blocked', changes: [], fingerprint: curFingerprint.signature, fingerprint_class: environmentClass, unresolved_assertions: environmentAssertions, rejections: logicalRejections }, 'The Trial')
          break
        }
        // The fingerprint MOVED (or the Law cleared and the reviewer rejected on fresh grounds) —
        // the repeat was environmental noise, and the repair run is an OBSERVATION: admit ONE
        // normal correction off its findings without touching the ratchet (Sol WSD-r1 finding 1).
        repairObserved = true
        log(`${m.id} ${sliceId}: the environment-repair trial ${repairFp ? `moved the failure [${repairFp.signature}]` : 'cleared the Law (the reviewer rejected on fresh grounds)'} — environmental noise; admitting ONE normal correction (the repair observation never counts as a builder rejection)`)
      } else if (admission.escalate_diagnosis) {
        // identical ASSERTION failure twice — the retry is admitted, but the Sentinel signal
        // strengthens (+1 logical rejection) so escalation/split arrive one cycle sooner (plan D1).
        logicalRejections++
        log(`${m.id} ${sliceId}: identical assertion failure twice [${curFingerprint.signature}] — escalating diagnosis (+1 logical rejection; the Sentinel reaches escalation/split one cycle sooner)`)
      }
      // The Sentinel section processes the GENUINE outer rejection — on a repair-observed cycle
      // cls/logicalRejections still describe that outer rejection, untouched by the observation
      // (Sol WSD-r2 f1: suppressing this call left the admitted correction reviewed by the
      // un-escalated source).
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
      // The fix cap — with the WSD-r2 f2 exception: a moved repair observation at the cap still
      // admits its ONE promised correction (the observation consumed no builder attempt, so the
      // router's admission takes precedence over the cap for exactly this case). The extension is
      // one-shot: the loop bound stretches by exactly one cycle, never again.
      if (fix === MAX_REVIEW_FIXES + (repairCapExtension ? 1 : 0)) {
        if (repairObserved && !repairCapExtension) {
          repairCapExtension = true
          log(`${m.id} ${sliceId}: at the fix cap, but the moved repair's ONE promised correction is still admitted (the observation spent no builder attempt) — one extension, never more`)
        } else {
          log(`${m.id} ${sliceId}: still REJECTED after ${fix} fix(es) — recording and moving on (validate backstops)`)
          break
        }
      }
      log(`${m.id} ${sliceId} REJECTED [${findingLines(mReview).join('; ')}] — fix ${fix + 1}`)
      phase('Forging')
      // D2: a failed probe left real artifacts on disk — the reject brief NAMES them (script-assembled
      // from the trial's run id + failed ids) so the builder READS the DOM/console/screenshot evidence
      // before re-attempting (reading artifacts is not browser authority — amendment 7 intact).
      const fixBrief = `Reviewer REJECTED the prior attempt: ${findingLines(mReview).join(' | ') || '(no findings reported — re-verify the mapped checks, recommit, and report honestly)'}. Fix these specifically.${probeArtifactBrief(mReview && mReview.run_id, mReview && mReview.fingerprint && mReview.fingerprint.failed)}`
      mBuild = await agent(buildPrompt(m, surf, slice, sliceId, fixBrief), { label: loreLabel(builderName, 'build', `${sliceId}:fix${fix + 1}`), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })
      attempts++
    }
    gateProv.push({ gate: 'review', slice: sliceId, ...sliceReviewProv })
    if (splitRequired) splitLedger.push({ milestone: m.id, slice: sliceId, sc_ids: slice.sc_ids })
    // D1: a blocked slice rides the splitLedger too, with a DISTINCT class marker (Sol WSD-r1 f5):
    // 'environment' = pure infra, the conductor repairs the ENVIRONMENT, not the code;
    // 'mixed' = an infra fault PLUS unresolved product assertion(s) — code work is still owed
    // after the repair (unresolved_assertions names them). Never a plain builder-fixable defect.
    if (environmentBlocked) splitLedger.push({ milestone: m.id, slice: sliceId, sc_ids: slice.sc_ids, class: environmentClass === 'mixed' ? 'mixed' : 'environment', ...(environmentAssertions.length ? { unresolved_assertions: environmentAssertions } : {}) })
    if (approvedOf(mReview)) greenScIds.push(...slice.sc_ids.filter((id) => !greenScIds.includes(id)))
    slices.push({ id: sliceId, objective: slice.objective, sc_ids: slice.sc_ids, files: slice.files || [], done_when: slice.done_when || '', tests_green: mBuild && mBuild.tests_green, review: mReview && mReview.verdict, approved: approvedOf(mReview), split_required: splitRequired, environment_blocked: environmentBlocked, environment_class: environmentClass, environment_assertions: environmentAssertions, logical_rejections: logicalRejections })
    // D5 slice telemetry (§9, note.data.kind — no new event type): DETERMINISTIC fields only. NO
    // elapsed/tokens (Date.now/clocks are forbidden by the runtime determinism guard — timing derives
    // post-hoc from the ledger's own append timestamps). fingerprint = the last attempt's signature.
    await ledger('note', {
      kind: 'slice_telemetry', slice_id: sliceId, surface: surf, builder_model: bModel,
      reviewer_escalated: escalated, attempts, rejection_classes: rejectionClasses,
      fingerprint: prevFingerprint ? prevFingerprint.signature : null,
      first_pass_green: firstPassGreen, environment_blocked: environmentBlocked, split: splitRequired,
    }, 'The Trial')
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
  // D1: an environment-blocked slice is a mechanical QA_FAIL exactly like a split — the milestone
  // cannot pass with an untrustworthy slice, and it must never spend the tribunal on a broken
  // environment. It fails toward v3.0.1: with no fingerprints no slice is ever environment_blocked.
  const envBlockedSlices = slices.filter((s) => s.environment_blocked)
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
  // The goal-backward audit IS a gate leg, so it rides gateAgent: a seat-death degrades to a
  // fail-closed null (never rethrown), an unrelated 'other' error still rethrows, and every attempt
  // is classified into a provenance sink. The hand-written structured-output catch is gone. twoHeads
  // is 'required' — ONE attempt per call, no substitution: the SINGLE re-ask this ruling preserves is
  // owned by auditOrNull below (keeping the ':retry' provenance AND the transient-unusable recovery
  // that a policy re-dispatch cannot express), so gateAgent must not add a second same-model dispatch.
  const goalAudit = (suffix, prov) => gateAgent(goalBackwardPrompt(m), { label: loreLabel('aristotle', 'goal-backward', suffix), phase: 'Judgment', model: 'opus', schema: QA_FINDINGS_SCHEMA, twoHeads: 'required', provenance: prov })
  // auditOrNull — returns a USABLE report, or null (ledgered goal_audit_failure); the caller fails the
  // boundary closed on null. The ONE re-ask fires when the first attempt is unusable (a null seat-death
  // OR a non-binary report). A RECOVERED first failure records the first attempt's class + recovered:true,
  // NEVER classification:null (finding 3) — an unusable-but-non-seat-death first attempt proxies to
  // 'null_result' (there is no usable report to trust either way).
  const auditOrNull = async (suffix, first, firstProv) => {
    const p1 = firstProv || {}
    let g = first === undefined ? await goalAudit(suffix, p1) : first
    let retried = false
    let p = p1
    if (!goalAuditUsable(g)) {
      log(`${m.id}: the goal-backward audit returned no usable report — re-asking ONCE (orchestrator ruling)`)
      const p2 = {}
      g = await goalAudit(`${suffix}:retry`, p2)
      retried = true
      p = p2
    }
    if (goalAuditUsable(g)) {
      const firstClass = p1.classification != null ? p1.classification : 'null_result' // the first attempt's death class (proxy 'null_result' for an unusable-but-non-seat-death report)
      gateProv.push({ gate: 'goal-backward', at: suffix, requested_model: 'opus', actual_model: p.actual_model != null ? p.actual_model : 'opus', fallback_reason: retried ? 'reask' : null, classification: retried ? firstClass : null, recovered: retried })
      return g
    }
    gateProv.push({ gate: 'goal-backward', at: suffix, requested_model: 'opus', actual_model: null, fallback_reason: 'audit_unusable', classification: p.classification != null ? p.classification : 'null_result', recovered: false })
    await ledger('goal_audit_failure', { milestone: m.id, at: suffix, retried: true }, 'Judgment')
    return null
  }
  const skipAudit = async () => {
    log(`${m.id}: goal-backward audit SKIPPED — posture milestone_gate.goal_backward=false (operator override); ledgered.`)
    await ledger('gate_skipped', { milestone: m.id, gate: 'goal_backward', reason: 'posture milestone_gate.goal_backward=false (operator override)' }, 'Judgment')
  }
  if (splitSlices.length || envBlockedSlices.length || planAborted) {
    qa = 'QA_FAIL'
    qaFindings = [
      ...splitSlices.map((s) => `[split_required] ${s.id} "${s.objective}" stopped after ${s.logical_rejections} logical rejections — split-and-rebuild is a conductor/operator decision (SCs not trustworthy: ${s.sc_ids.join(', ')})`),
      // Sol WSD-r1 f5 honesty: only a PURE-infra block may claim "not the code"; a MIXED block names
      // its unresolved product assertions — code work is still owed after the environment repair.
      ...envBlockedSlices.map((s) => s.environment_class === 'mixed'
        ? `[environment_blocked] ${s.id} "${s.objective}" — a MIXED failure reproduced identically with no code change: the infra fault needs ENVIRONMENT repair, and product assertion(s) remain UNRESOLVED beneath it${s.environment_assertions && s.environment_assertions.length ? ` (${s.environment_assertions.join(', ')})` : ''} — code work is still owed after the repair (SCs not trustworthy: ${s.sc_ids.join(', ')}) — a conductor/operator decision`
        : `[environment_blocked] ${s.id} "${s.objective}" — the same infrastructure/timeout failure reproduced with no code change; repair the ENVIRONMENT, not the code (SCs not trustworthy: ${s.sc_ids.join(', ')}) — a conductor/operator decision`),
      ...(planAborted ? ['[slice_plan] the replanned remainder failed SC coverage — the milestone is incomplete'] : []),
    ]
    log(`${m.id}: QA_FAIL determined mechanically (${splitSlices.length} split-required slice(s)${envBlockedSlices.length ? `, ${envBlockedSlices.length} environment-blocked slice(s)` : ''}${planAborted ? ', aborted slice plan' : ''}) — no tribunal spend (nothing on this branch can pass); the conductor decides.`)
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
      // gateAgent: a mute analyst degrades to null — denzelReconcile is null-safe and gateDecision
      // reads an unreadable overall as QA_FAIL (fail-closed), never a silent pass.
      const kenProv = {}, ryuProv = {}
      const legs = [
        () => gateAgent(kenPrompt(m), { label: loreLabel('ken', 'qa', `${m.id}:c${c}`), phase: 'Judgment', model: 'opus', schema: QA_FINDINGS_SCHEMA, provenance: kenProv }),
        () => gateAgent(ryuPrompt(m), { label: loreLabel('ryu', 'qa', `${m.id}:c${c}`), phase: 'Judgment', model: 'sonnet', schema: QA_FINDINGS_SCHEMA, provenance: ryuProv }),
      ]
      const goalProvC = {}
      if (goalOn) legs.push(() => goalAudit(`${m.id}:c${c}`, goalProvC))
      const reports = await parallel(legs)
      gateProv.push({ gate: 'ken', cycle: c, ...kenProv }, { gate: 'ryu', cycle: c, ...ryuProv })
      // Goal-audit failure semantics (ORCHESTRATOR RULING): an unusable audit leg is re-asked
      // ONCE; still unusable → QA_FAIL with the blocking 'goal-audit-failure' finding — the
      // judge NEVER spawns on missing inputs, and the correction loop ends (an infrastructure
      // failure is not a code defect a corrective build can fix).
      let goal = null
      if (goalOn) {
        goal = await auditOrNull(`${m.id}:c${c}`, reports[2], goalProvC)
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
        const judgeProv = {}
        const verdict = await gateAgent(judgePrompt(m, reconciled), { label: loreLabel('judge-dredd', 'verdict', `${m.id}:c${c}`), phase: 'Judgment', model: 'opus', schema: VERDICT_SCHEMA, provenance: judgeProv })
        gateProv.push({ gate: 'judge', cycle: c, ...judgeProv })
        v = (verdict && verdict.verdict === 'QA_PASS') ? 'QA_PASS' : 'QA_FAIL' // a dead/mute judge fails closed
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
      // D2: a milestone-gate correction over probe-covered SCs inherits the last complete trial's
      // on-disk probe artifacts (script-assembled, never model-recalled), so the correction builder
      // reads the real DOM/console/screenshot evidence before re-attempting. Scope (r1 advisory):
      // when the decisive trial's failure set is KNOWN (mReview carries a real fingerprint), name
      // only its FAILED probe SCs; fall back to the milestone's full probe-SC set only when it isn't.
      const lastFp = fpOrNull(mReview && mReview.fingerprint)
      const lastTrialRunId = (mReview && typeof mReview.run_id === 'string' && mReview.run_id) ? mReview.run_id : lastRunId
      const fixNote = `Milestone gate QA_FAIL. Fix every blocking finding, keep tests green, recommit:\n${reconciled.summaryLines.join('\n')}${probeArtifactBrief(lastTrialRunId, lastFp ? lastFp.failed : mScIds)}`
      const correctionSlice = { objective: `Milestone-gate correction for ${m.id} — fix every blocking finding`, files: [], constraints: '', done_when: m.acceptance, sc_ids: mScIds }
      phase('Forging')
      log(`${spin('build', 99)} — ${m.id} gate correction ${c + 1}`)
      mBuild = await agent(buildPrompt(m, surf, correctionSlice, `${m.id}:correct${c + 1}`, fixNote), { label: loreLabel(builderName, 'build', `${m.id}:correct${c + 1}`), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })
      const correctReviewProv = {}
      mReview = (await evidencedReview(m, surf, correctionSlice, `${m.id}:correct${c + 1}`, mBuild, 0, false, reviewerName, { flips: mScIds, only: mScIds }, correctReviewProv)) || mReview
      gateProv.push({ gate: 'review', slice: `${m.id}:correct${c + 1}`, ...correctReviewProv })
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

  // F3: the milestone's gate-leg provenance rides the EXISTING gate_decision ledger type (in the
  // enum, previously unemitted by a workflow — no new type minted) so every degradation/substitution
  // on a review, tribunal analyst, judge, or goal-backward leg is recorded durably at the boundary.
  if (gateProv.length) await ledger('gate_decision', { milestone: m.id, qa, gate_provenance: gateProv }, 'Judgment')

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
  // Sol WSD-r1 f5: the closing bow distinguishes the three splitLedger classes — a code split awaits
  // an operator SPLIT decision; a pure-infra block awaits ENVIRONMENT repair (not code); a mixed
  // block awaits both (environment repair + the unresolved assertions still need code work).
  const codeSplits = splitLedger.filter((e) => !e.class)
  const envBlocks = splitLedger.filter((e) => e.class === 'environment')
  const mixedBlocks = splitLedger.filter((e) => e.class === 'mixed')
  log(`The orchestra takes a bow — ${passed.length}/${results.length} milestone(s) passed QA${codeSplits.length ? ` · ${codeSplits.length} slice(s) await an operator split decision` : ''}${envBlocks.length ? ` · ${envBlocks.length} slice(s) blocked on ENVIRONMENT repair (not code)` : ''}${mixedBlocks.length ? ` · ${mixedBlocks.length} slice(s) blocked MIXED (environment repair + unresolved assertions still owed code work)` : ''}`)
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
