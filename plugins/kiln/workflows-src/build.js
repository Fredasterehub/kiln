export const meta = {
  name: 'kiln-build',
  description: 'Kiln build stage — two nested loops over the locked Law: the outer walks milestones, the inner builds each slice per law.json SC. Surface routes the builder — ui/mixed → Opus, logic → GPT builds, never the reviewer\'s family. kiln-law\'s exit code is the red/green verdict; tamper, stale evidence, or a failed flip auto-rejects, else a cross-family reviewer rules. Boundaries run goal-backward audit + tribunal; validate is the heavy end-to-end gate.',
  phases: [
    { title: 'The Forge Heats', detail: 'read the locked Law; rakim ensures the git repo + seeds codebase-state; parse the master plan into milestones' },
    { title: 'Scoring the Cut', detail: 'KRS-One plans the milestone\'s entire ordered slice list in ONE call, mapped to the Law\'s SC ids (reusing a valid pipelined plan from the prior gate when HEAD has not moved); a haiku confirm checks each slice against live state (proceed | replan)' },
    { title: 'Forging', detail: 'builder implements the slice (Opus for ui/mixed, Codex for logic) and commits it' },
    { title: 'The Trial', detail: 'the deterministic runner executes the Law — the exit code is the lifecycle verdict (declared flips + regressions) — and persists the project suite as hashed evidence; the workflow gates tamper + freshness + the flip plan mechanically; a cross-family reviewer re-runs the mapped checks and rules with classed findings; the Sentinel escalates on logical rejections' },
    { title: 'Judgment', detail: 'the milestone gate — goal-backward audit at EVERY boundary (split/abort included; an unusable audit is re-asked once, then fails closed); dual analysts + deterministic reconcile at the tribunal threshold, the judge spawned only on an ambiguous reconcile; below it, slice review + the audit IS the gate. The next milestone\'s slice plan is pipelined in parallel here, anchored on base_sha and invalidated by any corrective commit' },
  ],
}

// ── args: { kilnDir, projectPath, codexAvailable, testingRigor, milestoneLimit, uiBuild, pluginRoot, posture, runToken, capabilityTier, gateOnly } ──
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
// @inline:doctrine:PAYLOAD_FIRST
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('build.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
const codexAvailable = A.codexAvailable !== false
const testingRigor = ['tdd', 'standard', 'minimal'].includes(String(A.testingRigor || '').toLowerCase()) ? String(A.testingRigor).toLowerCase() : 'standard'
const milestoneLimit = typeof A.milestoneLimit === 'number' ? A.milestoneLimit : Infinity
// uiBuild forces every milestone onto the ui surface (Opus builds, Codex reviews) — an optional override.
const uiBuild = A.uiBuild === true
// gateOnly is the STARVED-GATE retry path: re-run a milestone gate
// that was starved (session death mid-Judgment) over an ALREADY-COMPLETED build, without the
// 40-minute full re-build the v3 slicer otherwise forces (validateSlicePlan rejects a zero-slice
// plan while SCs remain uncovered, so a completed build re-enters through builder/confirm churn it
// does not need). Under gateOnly, Scoring the Cut and Forging are SKIPPED entirely — no slicer, no
// confirm, no builders. Per milestone: the same floor gates, then ONE deterministic
// trial-shaped pass over ALL the milestone's SCs (kiln-law verify + run --only/--expect-green over
// every milestone SC — NO --flips: nothing is flipped, every SC must already be GREEN over the
// completed build) + the freshness probe + runnerGate. If the Law is not fully green the milestone
// REFUSES (QA_FAIL, reason gate-only-on-red — never a red gate, never a skipped build); if green it
// routes CONSERVATIVELY to the FULL tribunal (the historical slice count is unknown to a fresh
// session, so tribunalThreshold's fail-toward-scrutiny doctrine applies — gate-only never lowers
// the gate). The tribunal correction loop stays available and runs the NORMAL build+trial path.
const gateOnly = A.gateOnly === true
// pluginRoot is the conductor-resolved absolute $PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). In v3 it is LOAD-BEARING: the kiln-law CLI (the Law floor) and the
// kiln-state ledger live under it. Its absence is gated below — never a silent v2-style build.
const pluginRoot = A.pluginRoot

// ── BUILD_RUN_TOKEN — this build stage's own,
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

// ── The Gauge posture — passed by the conductor from state.json. Accepts an
//    object or a JSON-encoded string; anything else ⇒ null ⇒ every dial below falls back to its
//    v2-equivalent default, so a run without a posture behaves exactly like v2 plus the Law
//    floor (which is unconditional). ──
const postureArg = (() => {
  let p = A.posture
  if (typeof p === 'string') { try { p = JSON.parse(p) } catch (e) { return null } }
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null
})()
// ── The Gauge config (GAUGE_CONFIG, inlined from gauge-config.json by the bundler — workflow
//    scripts cannot import JSON; --check guards the inline copy against drift). The Sentinel
//    thresholds (rejections_to_feedback_escalation / rejections_to_split) live here. ──
// @gauge-config
// livePosture is the Sentinel's MUTABLE working copy: escalate() raises dials mid-milestone
// and NOTHING in this script ever lowers one — builder self-confidence included. Scrutiny is
// MONOTONIC within a run: it rises on repeated logical rejections and never falls — there is no
// de-escalation phase and no clean-window boundary move — so raised dials carry forward across
// milestones: strictly MORE scrutiny, never less.
// Defaults are v2-equivalent: review effort 'medium' baseline (D8 raises it via the posture arg),
// the slice budget, floor values everywhere else (the ratchet can only
// raise them). The milestone_gate dials are CONSUMED by the Judgment gate below:
// min_slices_for_tribunal decides dual-analysts-vs-slice-review-as-gate, and goal_backward
// (default ON) is the operator's only way to skip the boundary audit — a skip is ledgered.
const P0 = postureArg || {}
const PR = (P0.review && typeof P0.review === 'object') ? P0.review : {}
const PG = (P0.milestone_gate && typeof P0.milestone_gate === 'object') ? P0.milestone_gate : {}
const PB = (P0.browser && typeof P0.browser === 'object') ? P0.browser : {}
const PV = (P0.validate && typeof P0.validate === 'object') ? P0.validate : {}
let livePosture = {
  // The scope tier the trivial-tier levers key on. Fail-soft to 'standard' — an absent
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
// The architecture council persists the DEADLOCK_RESOLVED certificate here (canonical bytes whose
// sha equals the terminal row's certificate_hash) — build reloads it to re-anchor the CURRENT plan.
const deadlockCertFile = `${kilnDir}/council/master_plan/deadlock-certificate.json`
const handoffFile = `${kilnDir}/architecture-handoff.md`
const codebaseStateFile = `${docsDir}/codebase-state.md`
const codebaseMapFile = `${docsDir}/codebase-map.md`
const lawFile = `${kilnDir}/law.json`

// ── MODEL_VOICE — the thin model-tuned shell (Opus only; the Codex leg is shaped by the wrapper) ──
// @inline:voice:MODEL_VOICE,voice

// ── Codex model pins (CODEX_MODEL default + CODEX_FALLBACK, inlined from src/models.mjs) ──
// @models

// ── The Claude council head, resolved once per run. The conductor threads args.claudeHead from the
//    run's capability record; only the fallback engine id (CLAUDE_HEAD_FALLBACK) demotes the seat —
//    absent, 'fable', or any other value keeps the preferred head (CLAUDE_HEAD), byte-compatible with a
//    launch that threads no head. Every Claude-head SEAT model and the model field of each Claude-half
//    seat_provenance resolves through this ONE constant; the head LABELS (head:'fable', slot keys) are
//    seat names and never move — CLAUDE_HEAD_MODEL names the engine, 'fable' names the seat. ──
const CLAUDE_HEAD_MODEL = A.claudeHead === CLAUDE_HEAD_FALLBACK ? CLAUDE_HEAD_FALLBACK : CLAUDE_HEAD
// When the head is held by the fallback engine, record the succession ONCE at council convening so the
// demotion is never silent — the checkpoints carry the resolved model in seat_provenance; this is the
// human-readable ledger beat beside them. Best-effort: a failed append never blocks the council.
let claudeHeadSuccessionNoted = false
async function noteClaudeHeadSuccession(phaseName) {
  if (CLAUDE_HEAD_MODEL !== CLAUDE_HEAD_FALLBACK || claudeHeadSuccessionNoted) return
  claudeHeadSuccessionNoted = true
  try { await ledger('note', { kind: 'capability', event: 'claude_head_demoted', head: 'fable', claude_head: CLAUDE_HEAD_MODEL }, phaseName) } catch { /* best-effort beat */ }
}

// ── Twin Council pure core — the sealed call-site machinery, lifted to src/council.mjs
//    and inlined here through the SAME @inline:council bundler contract architecture.js uses (helpers,
//    never copy-paste). Every function that CALLS another travels WITH it in ONE marker (dependency
//    order: deps first). These power the build keystones' Sol evidence analyst, the milestone-close
//    ratification pair, and the correction council — INERT on every sub-T4 / no-codex / tokenless path
//    (councilCapable === false), so those routes are byte-preserved v3.0.1. ──
// @inline:council:COUNCIL_PROTOCOL_VERSION,sha256Hex,canonicalJson,claimTypeForClass,compareEvidence,validateReversal,councilSignature,verifySignature,validateRatification,twinRatified,buildCheckpoint,degraded,SHA64_RE,RATIFY_SCHEMA,envelopeSchema,CROSS_CHECK_SCHEMA,LEDGER_APPEND_SCHEMA,CANON_HASH_ONELINER,LEDGER_EXTRACT_ONELINER,councilTemplateHash,seatProv,solWrapperPlan,crossCheckOk,assembleRatifyCertificate,verdictShapeError

// ── Twin Council gating. The three build keystones —
//    the Sol evidence analyst (Ryu bump), the milestone-close ratification pair (Judge Dredd retired),
//    and the correction council — go council-grade ONLY when the capability record promised BOTH heads
//    (T4 = fable + codex) AND the conductor minted a runToken. Sub-T4 / no-codex runs keep the v3.0.1
//    prompt-delegated Ryu, single-Opus Judge Dredd, and unconditional corrective build BYTE-IDENTICAL,
//    capability-honestly labeled. A PROMISED council missing its runToken is NOT a clean v3.0.1 run:
//    the affected milestone ruling fails CLOSED (never a silent downgrade to Judge Dredd). runTokenRaw
//    is the RAW per-run token; it lives ONLY in the receipt-script argv
//    (a trusted process boundary), never in any head-visible prompt/packet. capabilityTier is
//    T1|T2|T3|T4 from the freshest capability record; anything else ⇒ null. ──
const runTokenRaw = (typeof A.runToken === 'string' && A.runToken.length > 0) ? A.runToken : null
const capabilityTier = (A.capabilityTier === 'T1' || A.capabilityTier === 'T2' || A.capabilityTier === 'T3' || A.capabilityTier === 'T4') ? A.capabilityTier : null
const councilPromised = capabilityTier === 'T4' && codexAvailable
const councilCapable = councilPromised && runTokenRaw != null
// councilMisconfigured — a PROMISED council (T4 + codex) launched WITHOUT the run token: the milestone
// gate cannot bind its receipts, so every ruling that WOULD have convened a council fails closed
// (DEGRADED), never a silent v3.0.1 Judge Dredd downgrade.
const councilMisconfigured = councilPromised && runTokenRaw == null
if (councilMisconfigured) {
  log('MISCONFIGURED CONDUCTOR — capability tier T4 with both heads reachable but NO runToken: the build councils cannot bind their receipts/seed. Every promised milestone-close/correction ruling fails CLOSED (QA_FAIL, terminal DEGRADED); the gate never silently downgrades to the v3.0.1 Judge Dredd / prompt-delegated seats. Relaunch with the per-run token to convene the councils.')
}
// ONE receipts ledger SHARED with architecture so the receipt script's replay
// rejection spans every council invocation of the run; build council artifacts live under
// ${councilRootDir}/<m.id>/. runTokenHash rides checkpoints only (never the raw token).
const councilRootDir = `${kilnDir}/council/build`
const receiptsLedger = `${kilnDir}/council/receipts.jsonl`
const runTokenHash = runTokenRaw != null ? sha256Hex(runTokenRaw) : null
const COUNCIL_RENDERER_CLOSE = 'b42-close/1'
// COUNCIL_TASK / RUBRIC for the close pair (fixed — NO per-run interpolation, so the template hash is
// run-independent). CORRECTION_TASK for the correction council. templateHash binds them.
const CLOSE_RUBRIC =
  'Rule the milestone CLOSE on whether the integrated milestone genuinely, verifiably meets its acceptance: ' +
  '(1) every acceptance criterion is met in SPIRIT, not just by a green check; (2) the reconciled analyst + ' +
  'goal-backward findings carry no unresolved defect; (3) the deterministic evidence (kiln-law exit codes, the ' +
  'persisted suite + probe artifacts) supports the pass. A council NEVER overturns a red gate — a deterministic ' +
  'QA_FAIL never reaches you; you rule only an agreed zero-blocking close where the analysts disagreed on the ' +
  'overall. Every finding MUST be evidence-bound (a file/line, an executable check, or a named evidence artifact).'
const CLOSE_RATIFY_TASK =
  'Render one blind verdict — APPROVE, BLOCK, or NEITHER — on the milestone close against the rubric. You do not ' +
  'know who else is ruling. divergence_selections is [] (no open divergences). Echo artifact_hash EXACTLY as given. ' +
  'A BLOCK or NEITHER MUST carry at least one evidence-bound finding (finding_id unique, nonempty evidence_refs or a ' +
  'real executable_check); an evidence-free verdict is invalid. changed_evidence is [] unless you reverse a prior block.'
const CORRECTION_TASK =
  'One corrective build cycle is available for this failed milestone gate. Rule the CORRECTION ROUTE: RETRY (the ' +
  'blocking findings are code defects a single corrective build can fix), ESCALATE (validate should backstop — the ' +
  'defect is beyond one corrective build, or needs a conductor decision), or REPLAN (the milestone plan itself is ' +
  'wrong — a conductor/operator re-plan is owed). Emit findings + reasons FIRST, then choice; echo artifact_hash.'
const councilTemplateHashBuild = councilTemplateHash({ close_rubric: CLOSE_RUBRIC, close_task: CLOSE_RATIFY_TASK, correction_task: CORRECTION_TASK, renderer: COUNCIL_RENDERER_CLOSE })
// ── Legacy-plan hook constants (fixed — NO per-run interpolation, run-independent
//    template hash). A run already past architecture whose master plan predates the twin council gets
//    ONE retrospective blind dual ratification of the UNCHANGED plan (the lite-pair idiom reused
//    at this second call site; renderer b3-legacy/1). The plan is NOT edited — the pair ratifies it as
//    sound or blocks it; a retrospective certificate is its OWN record, the plan stays legacy_authority. ──
const COUNCIL_RENDERER_LEGACY = 'b3-legacy/1'
const LEGACY_RUBRIC =
  'Rule the EXISTING master plan — unchanged, ratified retrospectively — on five axes: (1) VISION fidelity — ' +
  'every success criterion in the plan traces to a VISION goal, none invented, none dropped; (2) constraint ' +
  'adherence — no decision violates the architecture constraints; (3) milestone soundness — ordering and ' +
  'dependencies are buildable and separately verifiable; (4) SC/AC executability — every acceptance criterion ' +
  'is an executable check (shell/pytest/HTTP/probe), not prose; (5) feasibility risk — no milestone hides an ' +
  'unbounded unknown. This ruling NEVER edits the plan; you ratify it as sound or you block it. Every finding ' +
  'MUST be evidence-bound: a file/line, an executable check, a research fact, or a concrete failure scenario — ' +
  'never a taste assertion.'
const LEGACY_RATIFY_TASK =
  'Render one blind verdict — APPROVE, BLOCK, or NEITHER — on the UNCHANGED master plan against the rubric. You ' +
  'do not know how the plan was authored or who else is ruling. Each finding: finding_id, claim, required_change, ' +
  'evidence_refs, evidence_class, and executable_check (a bounded shell command returning EXIT 0 iff the defect ' +
  'is present, or null). A BLOCK or NEITHER MUST carry at least one finding, every finding_id unique, and every ' +
  'finding evidence-bound (nonempty evidence_refs or a real executable_check) — an evidence-free verdict is ' +
  'invalid. divergence_selections is [] (no open divergences — the plan is the single artifact). changed_evidence ' +
  'is [] unless you reverse a prior block. Echo artifact_hash EXACTLY as given.'
const councilTemplateHashLegacy = councilTemplateHash({ legacy_rubric: LEGACY_RUBRIC, legacy_task: LEGACY_RATIFY_TASK, renderer: COUNCIL_RENDERER_LEGACY })
const legacyVisionFile = `${docsDir}/VISION.md`
// SOL_QA_PAYLOAD_SCHEMA — the Sol evidence analyst (Ryu bump) payload: codex runs --sandbox read-only
// and CANNOT write qa-report-b.md, so the report content rides report_markdown (extracted by the wrapper
// via the extractTo pattern) alongside the findings[]/overall the deterministic reconcile reads.
const SOL_QA_PAYLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } }, required: ['text', 'severity'] } },
    overall: { type: 'string', enum: ['pass', 'fail'], description: 'your independent overall verdict — \'fail\' MUST be backed by at least one critical or high finding' },
    report_markdown: { type: 'string', description: 'the FULL qa-report-b content (the wrapper writes it to qa-report-b.md; codex runs read-only and cannot write files)' },
  },
  required: ['findings', 'overall', 'report_markdown'],
}
// CORRECTION_SCHEMA — payload-first: findings/reasons BEFORE the choice (evidence-before-commit).
const CORRECTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    artifact_hash: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } }, required: ['text', 'severity'] } },
    reasons: { type: 'array', items: { type: 'string' } },
    choice: { type: 'string', enum: ['RETRY', 'ESCALATE', 'REPLAN'] },
  },
  required: ['artifact_hash', 'findings', 'reasons', 'choice'],
}

// ── Lore display layer (NEVER enters a model prompt — labels + log lines only) ──
// Canonical copy lives in data/duo-pool.json (conductor reads that); the bundler's duo-pool step
// regenerates this inline display copy from that JSON (workflow scripts cannot import JSON), so
// the two can no longer drift.
// @duo-pool
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
    law_run_exit: { type: 'number', description: 'exit code of kiln-law run (step 2) — the lifecycle verdict the workflow gates on mechanically' },
    flip_unmet: { type: 'array', items: { type: 'string' }, description: 'every id from a FLIP_UNMET line of step 2, verbatim (empty if none or step 2 never ran)' },
    regressed: { type: 'array', items: { type: 'string' }, description: 'every id from a REGRESSION line of step 2, verbatim (empty if none or step 2 never ran)' },
    run_id: { type: 'string', description: 'verbatim from the RUN <runId> HEAD <head> line' },
    head: { type: 'string', description: 'verbatim HEAD sha from the RUN line' },
    suite_cmd: { type: 'string', description: 'the project suite command kiln-law suite ran (step 3)' },
    suite_exit: { type: 'number', description: 'the REAL suite exit from step 3\'s SUITE line (its output is persisted as suite.log + suite.jsonl in the evidence dir)' },
    // Failure-fingerprint signal: the per-check exits kiln-law recorded in
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
  // The freshness transcript: current HEAD (sha + commit epoch) and the evidence's OWN anchors
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
    // Judge-spawn condition input: the gate computes analyst DISAGREEMENT from this field —
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
// @inline:reconcile:SEV_RANK,norm,denzelReconcile

// ── The build-spine mechanical core + the Sentinel ratchet —
//    inlined pure logic, unit-tested in src/spine.mjs and src/gauge.mjs. The coverage arithmetic,
//    the tamper/freshness gate, the milestone-gate judge-spawn decision, and the escalation
//    policy run IN THE SCRIPT, never in an agent. ──
// @inline:spine:validateSlicePlan,runnerGate,gateOnlyRefusal,probeGate,rejectionClass,failureFingerprint,admitRetry,tribunalThreshold,gateDecision,goalAuditUsable,pipelineInvalidated,admitSpeculation
// @inline:gauge:escalate

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
// reviewLeg(surf, escalated) — feedback-source escalation: after
// rejections_to_feedback_escalation LOGICAL rejections, the feedback source changes. T1..T4 name
// the CAPABILITY-LADDER tiers (T1 Sonnet-only / T2 +Opus / T3 +Codex / T4 +Fable), and
// codexAvailable is the one observable tier discriminant this workflow receives (doctor
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
// Codex review effort: 'medium' baseline; 'high' iff the posture says so
// (D8≥1 → ui_effort_base 'high', and the Sentinel ratchet can raise it mid-run) OR fix-cycle>0
// (posture.review.escalate_on) OR the feedback source was escalated.
const reviewEffort = (fix, escalated) => (livePosture.review.ui_effort_base === 'high' || fix > 0 || escalated) ? 'high' : 'medium'

// The deterministic runner EXECUTES kiln-law and TRANSCRIBES
// its output — the gate arithmetic is downstream and deterministic (kiln-law exit codes + evidence
// hashes), so a weaker transcription seat cannot weaken the gate; it can only fail more visibly,
// which the fail-closed tamper/stale/red paths already catch. At trivial scope the seat downshifts
// to haiku; at standard it stays sonnet. Keyed on scope_tier ONLY — the effort dial is a per-call
// reasoning signal, never a scope signal. Both trial call sites route through it.
const runnerModel = livePosture.scope_tier === 'trivial' ? 'haiku' : 'sonnet'

// Review verdict helpers. approvedOf is the ONE approval predicate: verdict, the reviewer's own
// suite re-run, AND the reviewer's own kiln-law re-run (independent-rerun floor) must all hold.
const approvedOf = (rev) => !!(rev && rev.verdict === 'APPROVED' && rev.tests_green !== false && rev.law_green !== false)
const findingLines = (rev) => ((rev && rev.findings) || []).map((f) => f && f.text).filter(Boolean)
// fpOrNull — normalize a tagged fingerprint: only a REAL signature counts (the truthy
// NULL-fingerprint object must never leak '' into telemetry or the router's prev slot).
const fpOrNull = (fp) => (fp && typeof fp === 'object' && !Array.isArray(fp) && typeof fp.signature === 'string' && fp.signature) ? fp : null
// autoReject — the workflow's own REJECTED verdict (commit-before-review, tamper, stale evidence).
// Always 'mechanical': these are process failures, not defect signals — they must not push the
// Sentinel toward feedback escalation or a split (the ratchet keys on logical findings only).
const autoReject = (texts) => ({ verdict: 'REJECTED', law_green: false, tests_green: false, findings: texts.map((t) => ({ text: t, finding_class: 'mechanical' })) })
// lawRedReject — the workflow's REJECTED verdict for a RED lifecycle gate (kiln-law run --flips
// exited non-zero: a declared flip did not go RED→GREEN, or a previously-GREEN check regressed).
// Classed 'logical' deliberately, in contrast with autoReject: a failed check is the finding
// taxonomy's own definition of logical ("wrong behavior, failed check") and a GENUINE defect
// signal — a slice that repeatedly cannot flip its Law should march the ratchet toward
// split_required exactly like reviewer-caught wrong behavior (scrutiny may only rise).
const lawRedReject = (texts) => ({ verdict: 'REJECTED', law_green: false, tests_green: false, findings: texts.map((t) => ({ text: t, finding_class: 'logical' })) })
// A goal-backward audit still unusable after its ONE re-ask fails the milestone boundary closed.
const GOAL_AUDIT_FAILURE = `[goal-audit-failure] the goal-backward audit returned no usable report after one re-ask — the boundary fails closed (QA_FAIL)`

// ── Gate hardening: the single gateAgent (+ isStructuredOutputFailure / classifyGateFailure),
//    inlined from src/gate.mjs — a mute gate leg DEGRADES to null, never detonates the run. ──
// @gate

// @inline:guards:NO_WANDER,repoRule
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
// The Law block every builder receives: outcome-phrased (done = the SC checks pass), with the
// immutability warning — the tamper gate auto-rejects mechanically, so the warning is real.
// The builder's kiln-law run is stage-tokened (--run-prefix BUILD_RUN_TOKEN) so the stage-end sweep
// can reap a hard-killed builder's probe tree — kiln-law's per-run bracket covers normal exits only.
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
    // At trivial tier the slice BUDGET rules the grouping (the per-slice fixed cost is where
    // the trivial tier bleeds). At standard, the standard text rides byte-identical.
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
  // The lifecycle invocation (the exit code IS the verdict): --flips declares
  // the slice's expected RED→GREEN set, --only also re-runs every SC this milestone already
  // turned green (so regressions are OBSERVED, not assumed), and --before anchors statusBefore in
  // the recorded evidence of the previous complete run — kiln-law computes the flip plan itself
  // (src/law.mjs flipPlan); no agent arithmetic, no prose state.
  //   The gateOnly variant re-runs a STARVED gate over an
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
    `3. 'cat ${dir}/run.json' — the manifest kiln-law itself wrote into the evidence: manifest_head = its "head", manifest_results_sha256 = its "results_sha256", manifest_completed_epoch = its "completed_at", manifest_verification_class = its "verification_class" (sentinels '' / '' / -1 / '' when the file or a field is missing — an unfinalized manifest means the run never completed; verification_class is the degradation record: 'full' = every probe executed, 'static-only' = some probe deferred).\n` +
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
    // Screenshot rule: the reviewer judges the probe SCREENSHOT by a BINARY
    // RUBRIC only — pass/fail visibility questions ("is the nav visible? is text clipped? does it
    // match the stated design language?") — NEVER a free-form aesthetic score. VLMs rank reliably
    // and SCORE unreliably; numeric taste scores are out of scope and
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

// The analyst overall-verdict rule: the gate computes judge-spawn from analyst
// DISAGREEMENT, and the deterministic reconcile blocks on critical|high findings only — so an
// overall 'fail' carrying no such finding is structurally noise. Stated in both analyst prompts.
const overallRule = `Also return overall — your independent verdict on the whole milestone ('pass' | 'fail'); a 'fail' MUST be backed by at least one critical or high finding, or the deterministic reconcile reads it as noise.`
// THE BROWSER LAW for the gate legs: the tribunal analyst and the judge are browser-capable prompts
// that MUST carry the browser-law line — without it an analyst can drive the Playwright-MCP browser_*
// tools and leak an MCP chrome the token sweep structurally cannot reap (an MCP browser is a
// persistent SERVICE that in-loop browser discipline forbids). The law names all three channels and
// re-channels the analyst's hunger to the probe evidence — the value is redirected, not lost.
const browserLaw = `NEVER launch a browser, NEVER drive Playwright yourself, and NEVER use Playwright-MCP browser_* tools (an MCP browser is a persistent service outside this stage's kill-token sweep — the exact leak class in-loop discipline forbids). Every browser observation you need already exists as probe evidence under ${kilnDir}/evidence/ (screenshots, console/net logs, probe-<SC>.json results) — judge UI behavior from that evidence and static inspection; live UI verification beyond it belongs to validate's bounded Tier-2 traversal, not to you.`
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
// goalBackwardPrompt — the boundary auditor: works BACKWARD from the milestone goal (GSD
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

// ── Ledger: every posture move and slice-plan event lands in events.jsonl via
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

// ── Lore beats: a forge/anvil dispatch at the moment a fact becomes true, carried by
//    the ledger to the operator's transcript between the banners (note{kind:'lore'}; deterministic
//    <stage>.<beat> key; args short scalars capped at 80 by the caller; text ≤ 160). PRESENTATION,
//    null-keep: pluginRoot absent ⇒ a plain log() line, never a stage failure (build only reaches a
//    beat past the floor gate, so pluginRoot is always present here — the guard is belt). ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE: every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? ledger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

// ── Stage-level browser sweeps —
//    the OUTER bracket around the whole build stage. The browser is a subprocess with a deadline,
//    never a service: kiln-law already brackets each probe-EXECUTING run with its own per-run
//    `kiln-probe sweep <runId>` (registered on process 'exit' + on timeout SIGKILL), but a
//    kiln-law wrapper that is itself SIGKILLed by an OUTER deadline never runs its exit handler,
//    leaving an orphaned chrome-headless-shell / managed server tree behind. THIS stage bracket is
//    the backstop for that — a PRE-FLIGHT sweep at build start and an UNCONDITIONAL sweep at build
//    end (the latter in the finally below, so any throw still reaps).
//    Scope is RUN-TOKEN, not the whole namespace (post-check cleanup is run-token scoped):
//    both sweeps target THIS build's BUILD_RUN_TOKEN —
//    every probe this stage spawned runs under a runId prefixed with it (--run-prefix on each
//    kiln-law run), so `kiln-probe sweep <BUILD_RUN_TOKEN>` reaps exactly this stage's survivors
//    and CANNOT touch a concurrent Kiln run (a validate Tier-2 traversal, a parallel build) — let
//    alone the operator's own browser (blanket `pkill -f chrome` stays forbidden). The old
//    whole-namespace pre-flight "stale-SingletonLock" defense is unnecessary here: that
//    failure mode requires a REUSED --user-data-dir, and Kiln gives every probe a unique
//    /tmp/kiln-pw-<token> profile dir (kiln-probe.mjs), so a prior crashed run's stale lock lives
//    in a dir this build never reuses and can never block it. Both sweeps are ledgered and
//    the sweep CLI always exits 0 so cleanup never fails a stage. Only called past the pluginRoot
//    floor gate (the CLI is locatable) via a haiku leg — a mechanical `pkill`/`rm` cleanup. ──
// SWEEP_SCAN_SCHEMA — the sweep leg now runs TWO commands (sweep, then the READ-ONLY leak-scan) and
// reports both: the SWEEP line (owned-namespace cleanup, as before) and the LEAK_SCAN json (a foreign
// browser we do not own). leak_suspects rides the baseline
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
  // Baseline proof for BOTH arms on every bracket: leak_suspects AND
  // leak_profile_dirs ride browser_sweep, so the ledger records that disk evidence existed
  // even when no foreign browser is alive. The detail event stays gated on LIVE suspects —
  // stale /tmp profile dirs from unrelated work would make a dirs-only alarm cry wolf; their
  // detail rides whenever the alarm fires, and the LEAK_SCAN line is in the transcript anyway.
  await ledger('browser_sweep', { stage: 'build', when, token: BUILD_RUN_TOKEN, leak_suspects: leakSuspects, leak_profile_dirs: profileDirs.length }, 'The Forge Heats')
  if (leakSuspects > 0) {
    await ledger('browser_leak_suspect', { stage: 'build', when, token: BUILD_RUN_TOKEN, suspects, profile_dirs: profileDirs }, 'The Forge Heats')
  }
}

// ── The status anchor: statusBefore lives in the EVIDENCE —
//    the anchored run's results.jsonl, folded by kiln-law itself via --before — never in prose.
//    The workflow carries only this run-id pointer, advanced on every COMPLETE freshness-verified
//    run (green OR red: a red run's fold is the truthful current status for the next fix cycle's
//    flip plan; tamper/stale runs never anchor — their evidence is untrusted by definition). ──
let lastRunId = null

// ── HEAD carry (the pipelining base-SHA anchor): NO dedicated probe — the freshness leg already
//    runs 'git rev-parse HEAD' on every trial (freshPrompt step 4 → FRESHNESS_SCHEMA.head), and
//    runnerGate cross-checks that head against the runner's own anchor, so on any proceed/red verdict
//    fresh.head IS the actual repo HEAD. lastHead mirrors it: advanced by EVERY freshness probe that
//    reports a non-empty head, REGARDLESS of gate verdict — intentionally UNLIKE lastRunId's
//    trust-gated (proceed/red) advance, because HEAD is a repo FACT, not an evidence-trust judgment.
//    The '' default is fail-closed: pipelineInvalidated re-slices on a blank base and the `if
//    (base_sha)` guard skips speculation. DO NOT harmonize noteHead to the verdict-gated form — a
//    lagging lastHead would let a speculative plan reuse against a pre-correction codebase (a real
//    correctness bug: the next milestone built against a stale slice plan). noteHead is FAIL-CLOSED
//    on a blank/unreadable reported head: it CLEARS lastHead rather than retaining the pre-correction
//    SHA, so a freshness leg that cannot read HEAD after a corrective commit forces the NEXT consumer
//    to invalidate (re-slice against an unproven HEAD) instead of reusing a plan cut against a
//    codebase that has since moved. A missing report (no run_id ⇒ no probe) is unreadable too. ──
let lastHead = ''
const noteHead = (fresh) => { lastHead = (fresh && typeof fresh.head === 'string') ? fresh.head.trim() : '' }

// ── planMilestone(targetM, targetSurf, targetScs) — the batch slice plan for ONE milestone,
//    parameterized so it can run for the CURRENT milestone synchronously OR for the NEXT milestone
//    SPECULATIVELY (pipelining). ONE batch krs-one:slice-plan call, coverage
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

// ── The pipeline carry: a speculative slice plan launched DURING the previous
//    milestone's gate, against the HEAD it was cut at (base_sha). { milestoneId, base_sha, promise }.
//    Consumed at the head of the next milestone iteration: a corrective commit on the prior
//    milestone (tribunal correction / validate loop) that moved HEAD off base_sha invalidates it
//    (pipelineInvalidated) — then the milestone re-slices against the real HEAD. Carrying only one
//    plan keeps the speculation bounded (the next milestone only). ──
let pipelinedPlan = null

// ── runTrialLegs — the shared trial preamble: dispatch the deterministic runner, run the
//    freshness probe iff the runner returned a run_id, and apply runnerGate. Returns { runner,
//    gate } for the caller to route. This helper is DELIBERATELY inert past the gate — it carries
//    NO lastRunId advance, NO degrade ledgering, NO tamper/stale/red routing — because the
//    evidenced and gate-only paths diverge there on purpose. `tag` is the shared label suffix. ──
async function runTrialLegs(build, lawCtx, priorRunId, tag) {
  const runner = await agent(runnerPrompt(build, lawCtx, priorRunId), { label: loreLabel('asimov', 'runner', tag), phase: 'The Trial', model: runnerModel, schema: RUNNER_SCHEMA })
  let fresh = null
  if (runner && typeof runner.run_id === 'string' && runner.run_id) {
    fresh = await agent(freshPrompt(runner.run_id), { label: loreLabel('thoth', 'freshness', tag), phase: 'The Trial', model: 'haiku', schema: FRESHNESS_SCHEMA })
  }
  // The freshness leg is also the pipelining HEAD source — transcribe its head into lastHead so
  // pipelineInvalidated compares a speculative plan's base_sha against the real repo HEAD (both
  // trial callers route through here, so this one call covers the slice and gate-only paths).
  noteHead(fresh)
  return { runner, gate: runnerGate(runner, fresh) }
}

// ── The Trial, mechanized: commit gate → deterministic runner → freshness probe →
//    in-script runnerGate → reviewer ONLY on 'proceed'. lawCtx = { flips, only }: the SC ids this
//    trial must flip RED→GREEN, and the run scope (the flips plus every SC the milestone already
//    turned green, so regressions are observed, not assumed). Returns the review verdict object
//    (the workflow's own autoReject/lawRedReject for tamper/stale/red/uncommitted — no reviewer
//    call is spent on those). ──
async function evidencedReview(m, surf, slice, sliceId, build, fix, escalated, reviewerName, lawCtx, prov, beatGuard) {
  // Commit-before-review (unchanged from v2): an uncommitted slice would anchor evidence and
  // review to a stale HEAD. Auto-reject without spending runner or review calls.
  if (build && build.committed === false) {
    log(`${m.id} ${sliceId}: builder did not commit — auto-reject (mechanical), no runner, no reviewer`)
    return autoReject([`Slice was not committed — run 'git add -A && git commit' before the trial (evidence and review anchor to HEAD).`])
  }
  phase('The Trial')
  log(`${spin('law', fix)} — ${m.id} ${sliceId} f${fix}`)
  const { runner, gate } = await runTrialLegs(build, lawCtx, lastRunId, `${sliceId}:f${fix}`)
  // Fingerprint THIS trial's failure and ride it out on the returned verdict so the
  // retry loop can route the NEXT admission (failureFingerprint emits only on a 'red' gate — a
  // check-level lifecycle failure; everything else is the NULL fingerprint, admitted as v3.0.1). The
  // run id rides too, so a reject brief can name that run's on-disk probe artifacts. tag() is
  // additive — every return object gains .fingerprint + .run_id without changing its verdict shape.
  const fp = failureFingerprint(runner && runner.check_results, gate)
  const runId = (runner && typeof runner.run_id === 'string') ? runner.run_id : null
  const tag = (rev) => { if (rev && typeof rev === 'object' && !Array.isArray(rev)) { rev.fingerprint = fp; rev.run_id = runId } return rev }
  // Advance the status anchor on every complete, fresh run — 'proceed' AND 'red' both carry a
  // finalized manifest the probe just verified; the next trial's --before folds this run.
  if (gate.verdict === 'proceed' || gate.verdict === 'red') lastRunId = runner.run_id
  // Verification honesty: a static-only run (a mapped probe deferred — playwright absent →
  // exit 78, an un-instantiated template, or --skip-probes) folds to law_run_exit 0, so the
  // degradation must be LEDGERED the moment the gate sees it — recorded end-to-end, never silently
  // green. The probeGate pure predicate (src/spine.mjs) makes the decision surface-aware: a
  // ui/mixed slice that lost its browser-probe evidence ledgers 'probe_unavailable' (the
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
    // Tamper model: the slice is auto-REJECTED by the WORKFLOW (not an agent judgment), the
    // event is LEDGERED, and the fix brief names exactly which locked path was touched.
    log(`${m.id} ${sliceId}: TAMPER — ${gate.reasons.join('; ')} — auto-reject, no reviewer spawned`)
    await ledger('tamper_auto_reject', { milestone: m.id, slice: sliceId, fix, tamper_paths: gate.tamper_paths, reasons: gate.reasons }, 'The Trial')
    // build.tamper (keystone): the lock does not match the Law — auto-reject, mechanical, no reviewer.
    // Latched to ONE beat per slice via beatGuard (beats fire per OUTCOME, never
    // per attempt) — the per-attempt tamper_auto_reject LEDGER above still fires every time, so the
    // audit trail stays complete; only the operator-facing beat coalesces to the slice.
    if (!(beatGuard && beatGuard.tamperFired)) {
      if (beatGuard) beatGuard.tamperFired = true
      await lore('build.tamper', `TAMPER — the lock does not match the Law [${oneLine(gate.reasons.join('; '), 80)}]; auto-reject, no reviewer seated`, { slice: sliceId, reasons: oneLine(gate.reasons.join('; '), 80) }, 'The Trial')
    }
    const named = gate.tamper_paths.length ? gate.tamper_paths : ['(kiln-law exited 2 without naming paths — run verify manually to identify the lock)']
    return tag(autoReject(named.map((p) => `Locked Law path touched: ${p} — the Law is immutable after lock. Revert every change to locked paths and rebuild without touching them; ADD new tests elsewhere instead.`)))
  }
  if (gate.verdict === 'stale') {
    // Stale or missing evidence is structurally impossible to approve — no reviewer spawned.
    log(`${m.id} ${sliceId}: evidence gate failed [${gate.reasons.join('; ')}] — auto-reject, no reviewer spawned`)
    return tag(autoReject(gate.reasons.map((r) => `Evidence gate failed — ${r}. Ensure the work is committed at HEAD and the checks can execute; the runner re-fires on the next cycle.`)))
  }
  if (gate.verdict === 'red') {
    // The exit code IS the verdict. A red lifecycle gate (flip unmet / regression)
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

// ── gateOnlyTrial — the STARVED-GATE deterministic Law check over an
//    already-completed build. SAME trial legs as evidencedReview (the deterministic runner → the
//    freshness probe → the in-script runnerGate), but in gateOnly law context — verify + run
//    --only/--expect-green over ALL the milestone's SCs, NO --flips, NO --before — and it spawns NO
//    builder, NO reviewer: a starved gate is re-run, never re-built. The degradation channel is
//    preserved (a static-only run is ledgered, never silently green). Returns the runnerGate
//    verdict object so the caller applies the pure gateOnlyRefusal predicate: any verdict but
//    'proceed' refuses the milestone with gate-only-on-red; a clean 'proceed' routes to Judgment. ──
async function gateOnlyTrial(m, surf, mScIds) {
  phase('The Trial')
  // SPIN rotates on the milestone index: milestoneIndex is a module-scope counter set by the
  // OUTER loop before this call, so the `law` array (which genuinely rotates at the slice trial) does
  // not sit dead on 0 here either.
  log(`${spin('law', milestoneIndex)} — ${m.id} gate-only Law check over ${mScIds.length} SC(s) [${mScIds.join(', ')}]`)
  const lawCtx = { gateOnly: true, flips: [], only: mScIds }
  const { runner, gate } = await runTrialLegs(null, lawCtx, null, `${m.id}:gate-only`)
  // Advance the status anchor on a trustworthy verdict (proceed) — the gate-only run is a complete,
  // fresh, finalized run, so a subsequent tribunal-correction trial can fold it via --before and
  // expect the milestone's SCs to STAY green (regression guard) rather than re-flip from the lock.
  if (gate.verdict === 'proceed') lastRunId = runner.run_id
  // Verification honesty: a static-only run (a mapped probe deferred) must be LEDGERED the moment the gate
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

// ── gateOnlyPregate — the STARVED-GATE retry pre-gate arm, extracted whole (item 19 Tier A).
//    Runs ONE deterministic trial over ALL the milestone's SCs (gateOnlyTrial), applies the pure
//    gateOnlyRefusal predicate, and does its OWN log/ledger/lore. Returns { refused:true, result }
//    (the QA_FAIL row the caller pushes) on any verdict but a clean 'proceed'; { refused:false } on a
//    green Law — the caller then flips gateOnlyGreen/forceTribunal. It NEVER touches `results` or the
//    milestone-scope flags itself, so the guard-early caller keeps the !gateOnly arm byte-identical. ──
async function gateOnlyPregate(m, surf, mScIds) {
  log(`${m.id}: GATE-ONLY retry — Scoring + Forging SKIPPED; re-running the milestone gate over the completed build`)
  const gate = await gateOnlyTrial(m, surf, mScIds)
  const refusal = gateOnlyRefusal(gate)
  if (refusal.refuse) {
    log(`${m.id}: gate-only REFUSES — ${refusal.detail}`)
    await ledger('gate_only_refused', { milestone: m.id, sc_ids: mScIds, verdict: gate && gate.verdict, reason: refusal.reason, detail: refusal.detail }, 'The Trial')
    return { refused: true, result: { id: m.id, title: m.title, surface: surf, slices: 0, sc_ids: mScIds, tests_green: false, qa: 'QA_FAIL', findings: [`[${refusal.reason}] ${refusal.detail}`], split_required: [], replanned: false, gate_only: true } }
  }
  log(`${m.id}: gate-only Law GREEN over the completed build — routing to the FULL tribunal (conservative; prior slice count unknown to a fresh session)`)
  // build.gate_only (volume): a starved gate re-ran green over the completed build.
  await lore('build.gate_only', `${m.id} — gate-only Law green over the completed build; routing to the full tribunal`, { milestone: m.id }, 'The Trial')
  return { refused: false }
}

// ── The Forge Heats — the floor gates, then git baseline + codebase-state + milestone parse ──
phase('The Forge Heats')
log('The kiln grows hotter')
// Floor gate 1: without pluginRoot the kiln-law CLI is unlocatable — the tamper gate and the
// deterministic check runs (the floor gates) cannot execute. Building anyway would be a
// silent v2 regression; the conductor must relaunch with pluginRoot.
if (!pluginRoot) {
  log('BUILD CANNOT START — pluginRoot absent: the kiln-law CLI cannot be located, so the Law floor (tamper gate + deterministic check runs) cannot execute. Fix: relaunch with args.pluginRoot = the absolute $PLUGIN_ROOT the conductor resolved at onboarding (${CLAUDE_PLUGIN_ROOT} is unset inside a launched Workflow). Never start an ungated build.')
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
// build.law_read (volume): the locked Law is loaded — the contract every slice is judged against.
await lore('build.law_read', `The Law is read — ${lawChecks.length} locked check(s) across ${[...new Set(lawChecks.map((c) => c.milestone))].length} milestone(s)`, { checks: lawChecks.length, milestones: [...new Set(lawChecks.map((c) => c.milestone))].length }, 'The Forge Heats')
// The probe-kind SC ids from the locked Law manifest — a failed probe left real
// DOM/console/screenshot evidence on disk, and its reject brief names those deterministic paths.
const probeScIds = new Set(lawChecks.filter((c) => c.kind === 'probe').map((c) => c.id))
// probeArtifactBrief(runId, failedIds) — the appendix: for each FAILED probe id, the script-
// assembled artifact paths under the run's evidence dir (never model-recalled). Reading these is
// NOT browser authority — the builder still never spawns a browser. Empty
// string when there is no run id or no failed probe among the ids (fail toward the plain brief).
const probeArtifactBrief = (runId, failedIds) => {
  if (typeof runId !== 'string' || !runId.trim()) return ''
  const probes = (Array.isArray(failedIds) ? failedIds : []).filter((id) => typeof id === 'string' && probeScIds.has(id))
  if (!probes.length) return ''
  const dir = `${kilnDir}/evidence/${runId}`
  const lines = probes.map((id) => `  - ${id}: ${dir}/probe-${id}.json (the result), ${dir}/probe-${id}.log (console/stderr), and the screenshot(s) it names in "screenshots" (under ${dir}/)`).join('\n')
  return `\nA probe check FAILED — READ its captured evidence before you change a line (this is the real DOM/console/screenshot state the live probe recorded; reading artifacts is NOT browser authority — never launch a browser or Playwright yourself):\n${lines}\n`
}
// The NAMED per-milestone/cycle evidence artifacts, derived SCRIPT-SIDE from the last
// trial's run id (never model-recalled). trialEvidencePaths = the run-dir results.jsonl/run.json,
// PLUS suite.log/suite.jsonl IFF the build recorded a project suite: those two
// files exist only when the runner ran step 3 — the build.js `suite = build.test_command` skip branch.
// A genuinely suite-less product must not name absent artifacts and spuriously DEGRADE
// the close; the suiteRecorded flag reuses THAT recorded state (never a file-existence probe by an
// agent). probeEvidencePaths = the milestone's probe artifacts where a UI probe ran. The close record
// BINDS these to their sha256; the Sol evidence analyst packet NAMES them.
const trialEvidencePaths = (runId, suiteRecorded) => (typeof runId === 'string' && runId.trim())
  ? [`${kilnDir}/evidence/${runId}/results.jsonl`]
      .concat(suiteRecorded ? [`${kilnDir}/evidence/${runId}/suite.log`, `${kilnDir}/evidence/${runId}/suite.jsonl`] : [])
      .concat([`${kilnDir}/evidence/${runId}/run.json`])
  : []
const probeEvidencePaths = (runId, scIds) => (typeof runId === 'string' && runId.trim())
  ? (Array.isArray(scIds) ? scIds : []).filter((id) => typeof id === 'string' && probeScIds.has(id)).flatMap((id) => [`${kilnDir}/evidence/${runId}/probe-${id}.json`, `${kilnDir}/evidence/${runId}/probe-${id}.log`])
  : []
// PROBE_EXECUTED_ONELINER — the SC ids whose probe check EXECUTED, derived from the
// runner's RECORDED results.jsonl, NEVER from the Law's probe list. kiln-law records an executed check
// (probe OR shell) as { id, exit, duration_ms, log_sha256 } and a deferred/unavailable
// probe as { id, deferred: 'probe_deferred'|'probe_unavailable', … } with NO exit.
// So a row with a numeric exit RAN (green or red); a row carrying `deferred` did NOT — a deferred/spec-less
// probe leaves no probe-<SC>.json/.log and must be named NOWHERE (a false packet otherwise). This prints
// (JSON array) the ids of the RAN rows; the SCRIPT intersects with probeScIds to keep only the executed
// PROBE ids (results.jsonl carries no `kind`). Pattern: the sealed LEDGER_EXTRACT_ONELINER discipline —
// double-quotes only (NO single quote), so it rides safely inside node -e '…'. Executed once against a
// fixture results.jsonl before landing (rule 3): green+red rows in, deferred/unavailable dropped, [] on a
// missing file.
const PROBE_EXECUTED_ONELINER = `const fs=require("fs");let L=[];try{L=fs.readFileSync(process.argv[1],"utf8").split("\\n").filter(Boolean).map(s=>JSON.parse(s))}catch(e){}const ids=[];for(const e of L){if(e&&typeof e.id==="string"&&e.deferred===undefined&&typeof e.exit==="number")ids.push(e.id)}process.stdout.write(JSON.stringify(ids))`
const PROBE_EXEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 200 }, executed_ids: { type: 'array', items: { type: 'string' } } },
  required: ['executed_ids'],
}
// probeExecPrompt (thoth:probe-exec) — the ONE Thoth transcription leg that runs PROBE_EXECUTED_ONELINER
// over a trial's results.jsonl and transcribes the printed array VERBATIM. Its derived id set (∩ probeScIds,
// SCRIPT-side) is the SINGLE derivation feeding BOTH consumers — the Sol analyst's named evidence_artifacts
// AND the close anchor's hashed manifest — so the two named lists can never disagree.
const probeExecPrompt = (resultsPath) =>
  `You are Thoth, the scribe — run ONE command and transcribe its output, never judge, never fix.\n\n` +
  `<task>Run EXACTLY (Bash): node -e '${PROBE_EXECUTED_ONELINER}' "${resultsPath}" — it prints a JSON array of SC ids. Transcribe that array VERBATIM into executed_ids (the empty array if it printed [] or the file is absent). Do not add or drop ids, do not read anything else, do not write or fix.</task>`
// EVIDENCE_ANCHOR_SCHEMA / evidenceAnchorPrompt — the Thoth transcription leg that hashes the
// named close-evidence artifacts into a {path, sha256} manifest (the architecture anchor pattern).
// A dead/garbled/partial anchor ⇒ the close council DEGRADES (fail-closed) — the
// certificate must never bind unhashed names.
const EVIDENCE_ANCHOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, sha256: { type: 'string' } }, required: ['path', 'sha256'] } } },
  required: ['files'],
}
const evidenceAnchorPrompt = (inputs) =>
  `You are Thoth, the scribe — transcribe hashes, never judge, never fix.\n\n` +
  `<task>Run (Bash): 'sha256sum ${inputs.join(' ')}'. Transcribe each input file's sha256 into files[] as {path, sha256} (VERBATIM, lowercase hex, the path exactly as given). Do not read file contents, do not write or fix anything.</task>`

// Read a persisted council JSON file back (content + sha) for the DEADLOCK_RESOLVED certificate
// reload — the same cat+sha idiom architecture uses to rehydrate its persisted bundle.
const READ_COUNCIL_FILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, content: { type: 'string' }, sha256: { type: ['string', 'null'] } },
  required: ['content'],
}
const readCouncilFilePrompt = (file) =>
  `You are Thoth, the ledger reader — transcribe, never judge, never fix.\n\n` +
  `<task>Run (Bash): 'cat ${file} 2>/dev/null' and 'sha256sum ${file} 2>/dev/null'. Report content = the cat output's raw bytes VERBATIM (empty string if the file does not exist) and sha256 = the sha256sum digest (lowercase hex, or null if absent). Do not write or fix anything.</task>`

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── The build keystones' Twin Council legs. Every leg dispatches through the sealed
//    machinery lifted to src/council.mjs: a receipt-attested Sol codex seat + an
//    invocation-exact ledger cross-check, blind Fable/Sol RATIFY_SCHEMA verdicts, and the twinRatified
//    certificate. Failure is FAIL-CLOSED EVIDENCE: a dead/receiptless Sol seat, a failed cross-check,
//    a split verdict ⇒ the honest degraded route (never a fabricated claim, never a crash). These are
//    DEFINED unconditionally but CALLED only on the councilCapable path — sub-T4 stays byte-preserved. ──
// ════════════════════════════════════════════════════════════════════════════════════════════════

// crossCheckPromptB — the receipt-ledger cross-check transcription (thoth:receipt-check); mirrors
// architecture's crossCheckPrompt. Every path argument is SHELL-QUOTED; neither one-liner carries a
// single quote, so each rides safely inside node -e '...'.
const crossCheckPromptB = (outFile, outputSha, sessionId) =>
  `You are Thoth, the receipt cross-checker — transcribe, never compose, never judge. Run these three EXACT commands (Bash) and transcribe their output.\n\n` +
  `<task>\n` +
  `1. run EXACTLY: sha256sum "${outFile}" — output_sha256_disk = the 64-hex digest (the first field only).\n` +
  `2. run EXACTLY: node -e '${CANON_HASH_ONELINER}' "${outFile}" — output_canonical_sha256 = its stdout (a 64-hex digest).\n` +
  `3. run EXACTLY: node -e '${LEDGER_EXTRACT_ONELINER}' "${receiptsLedger}" "${outputSha}" "${sessionId}" — ledger = the { verified, reservation } JSON it prints (this leg's verified row + its reservation; nulls where unmatched).\n` +
  `Emit output_sha256_disk, output_canonical_sha256, and the ledger object. Do not read the files for content, do not write or fix anything.</task>`

// runSolCrossCheckB — the structural→LEDGER-VERIFIED upgrade, parameterized by keystone/phase.
// A mute/garbled leg gets ONE re-dispatch, then fails closed; crossCheckOk binds the whole chain.
const runSolCrossCheckB = async (legLabel, keystone, phaseTag, outFile, sink, payload, phaseName) => {
  const canon = sha256Hex(canonicalJson(payload))
  const relayed = sink && sink.output_hash
  const dispatch = () => agent(crossCheckPromptB(outFile, relayed, sink && sink.session_id), { label: `thoth:receipt-check:${legLabel}`, phase: phaseName, model: 'haiku', schema: CROSS_CHECK_SCHEMA })
  let cc = await dispatch()
  if (!(cc && cc.ledger)) cc = await dispatch()
  if (!(cc && cc.ledger)) return { ledger_verified: false, reason: 'cross-check leg produced no ledger extract' }
  const res = crossCheckOk(cc, { relayedOutputHash: relayed, canonicalHash: canon, sink, keystone, phaseTag, seat: 'sol', attempt: 1, runToken: runTokenRaw })
  return res.ok
    ? { ledger_verified: true, codex_receipt_hash: res.codex_receipt_hash, invocation_id: res.invocation_id }
    : { ledger_verified: false, invocation_id: res.invocation_id, reason: res.reason }
}

// councilCheckpoint — a buildCheckpoint row via the existing ledger() helper (note{kind:'council_state'});
// FAIL-OPEN telemetry (an append failure never fails the stage — architecture appendCouncilCheckpoint
// doctrine). councilRuling emits a note{kind:'council_ruling'} row (an EXISTING kind).
const councilCheckpoint = async (fields, phaseName) => {
  try { await ledger('note', buildCheckpoint(fields), phaseName) }
  catch (e) { log(`council checkpoint ${fields && fields.phase} not ledgered (non-fatal): ${e && e.message ? e.message : e}`) }
}
const councilRuling = async (data, phaseName) => {
  try { await ledger('note', { kind: 'council_ruling', ...data }, phaseName) }
  catch (e) { log(`council ruling not ledgered (non-fatal): ${e && e.message ? e.message : e}`) }
}
// ── Legacy-plan detection reader — a haiku Thoth reads events.jsonl and returns the prior SEALED
//    council_state checkpoints: the SAME ledger surface architecture's council appends (buildCheckpoint
//    → note{kind:'council_state', status:'sealed'}) and the SAME surface
//    build's own close/correction councils write here. Detection = the ABSENCE of a RATIFIED/DEADLOCK_
//    RESOLVED master_plan row (the deterministic signal; a missing row is a FACT). Gated on pluginRoot;
//    absence/mute ⇒ [] ⇒ a legacy plan is detected (fail TOWARD re-ratification, never a false advance). ──
const LEGACY_CHECKPOINT_SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: { kind: { type: 'string' }, keystone_id: { type: ['string', 'null'] }, phase: { type: 'string' }, status: { type: 'string' } },
  required: ['phase', 'status'],
}
const LEGACY_RESUME_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, checkpoints: { type: 'array', items: LEGACY_CHECKPOINT_SCHEMA } },
  required: ['checkpoints'],
}
const readCouncilCheckpointsB = async (phaseName) => {
  if (!pluginRoot) return []
  const res = await agent(
    `You are Thoth, the ledger reader — transcribe, never judge, never fix.\n\n` +
    `<task>Read ${kilnDir}/events.jsonl (Bash: 'cat ${kilnDir}/events.jsonl 2>/dev/null'). If it does not exist or is empty, report checkpoints: []. Otherwise each line is a JSON event: collect EVERY event whose type is "note" AND data.kind is "council_state" AND data.status is "sealed", and return checkpoints = the array of those data objects VERBATIM (each full council_state payload). Do not write or fix anything.</task>`,
    { label: 'thoth:council-legacy', phase: phaseName, model: 'haiku', schema: LEGACY_RESUME_SCHEMA }
  )
  return (res && Array.isArray(res.checkpoints)) ? res.checkpoints : []
}
// pushCouncilReceipt — one honest receipt row per Sol leg (verified or dead) into a per-milestone bucket.
const pushCouncilReceipt = (bucket, leg, sink, cross) => bucket.push({
  leg, invocation_id: cross && cross.invocation_id ? cross.invocation_id : null,
  receipt_verified: !!(sink && sink.receipt_verified), ledger_verified: !!(cross && cross.ledger_verified),
  session_id: sink && sink.session_id != null ? sink.session_id : null, tokens_used: sink && sink.tokens_used != null ? sink.tokens_used : null,
})
// verdictShapeError — LIFTED to src/council.mjs and inlined via the @inline:council
// marker above; build's close pair, the correction council, architecture, and the keystones share
// the one copy (the prior local verdictShapeErrorB is retired — same null-safe semantics).
// closeFindingsOf — FREEZE a blocking verdict's findings as the structured close_council_findings record
// (the RATIFY_SCHEMA finding shape verbatim: finding_id, claim, required_change, evidence_refs,
// evidence_class) so the SOLE correction is never spent blind to what blocked the close.
const closeFindingsOf = (r) => (r && (r.verdict === 'BLOCK' || r.verdict === 'NEITHER') && Array.isArray(r.findings) ? r.findings : []).map((f) => ({
  finding_id: f && f.finding_id != null ? f.finding_id : null,
  claim: f && f.claim != null ? f.claim : null,
  required_change: f && f.required_change != null ? f.required_change : null,
  evidence_refs: Array.isArray(f && f.evidence_refs) ? f.evidence_refs : [],
  evidence_class: f && f.evidence_class != null ? f.evidence_class : null,
}))
// closeFindingLine — render one frozen finding into a boundary/fixNote line (verbatim IDs + refs).
const closeFindingLine = (f) => `[close_council] ${f.finding_id || '(no-id)'}: ${f.claim || '(no claim)'} → required_change: ${f.required_change || '(none)'}${f.evidence_refs && f.evidence_refs.length ? ` [evidence: ${f.evidence_refs.join(', ')}]` : ''}`
// correctionRulingLines — render the correction heads' RETAINED findings + reasons verbatim
// into boundary lines; they are never discarded and ride qaFindings on ESCALATE/REPLAN.
const correctionRulingLines = (corr) => [
  ...((corr && Array.isArray(corr.findings)) ? corr.findings : []).map((f) => `[correction_council] finding: ${f && f.text ? f.text : '(none)'}${f && f.severity ? ` [${f.severity}]` : ''}`),
  ...((corr && Array.isArray(corr.reasons)) ? corr.reasons : []).map((r) => `[correction_council] reason: ${r}`),
]

// runBuildBlindPair — the sealed-before-exposed pair: Fable and receipt-attested Sol rule blind, in
// parallel, over a given schema. Sol death / invalid receipt / failed cross-check ⇒ degraded (a missing
// head is degradation). Blindness rails: the fable prompt never mentions codex/receipt/session/Sol; the
// sol packet never mentions fable or the run token. Returns { degraded, missing, rF, rS, sinkF, sinkS, solCross }.
const runBuildBlindPair = async (cfg) => {
  await noteClaudeHeadSuccession(cfg.phaseName)
  const sinkF = {}, sinkS = {}
  const plan = solWrapperPlan({ councilDir: cfg.mCouncilDir, pluginRoot, receiptsLedger, runToken: runTokenRaw, keystone: cfg.keystone, transportModel: CODEX_MODEL, phaseTag: cfg.phaseTag, attempt: 1, effort: 'xhigh', payloadSchema: cfg.schema, taskText: cfg.solTaskText, briefBody: cfg.solBrief, packetObj: cfg.solPacket })
  const [rF, rS] = await parallel([
    () => gateAgent(cfg.fablePrompt, { label: `fable:${cfg.legName}:${cfg.m.id}:c${cfg.c}`, phase: cfg.phaseName, model: CLAUDE_HEAD_MODEL, effort: 'xhigh', twoHeads: 'required', schema: cfg.schema, provenance: sinkF }),
    () => gateAgent(plan.prompt, { label: `sol:${cfg.legName}:${cfg.m.id}:c${cfg.c}`, phase: cfg.phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(cfg.schema), provenance: sinkS }),
  ])
  let solCross = { ledger_verified: false }
  if (rS != null && sinkS.receipt_verified === true) solCross = await runSolCrossCheckB(`sol:${cfg.legName}:${cfg.m.id}:c${cfg.c}`, cfg.keystone, cfg.phaseTag, plan.files.out, sinkS, rS, cfg.phaseName)
  pushCouncilReceipt(cfg.receiptsBucket, `sol:${cfg.legName}:${cfg.m.id}:c${cfg.c}`, sinkS, solCross)
  cfg.gateProv.push({ gate: `${cfg.legName}-fable`, cycle: cfg.c, ...sinkF }, { gate: `${cfg.legName}-sol`, cycle: cfg.c, ...sinkS })
  const solOk = rS != null && sinkS.receipt_verified === true && solCross.ledger_verified === true
  if (rF == null || !solOk) {
    const missing = rF == null && !solOk ? 'both' : (rF == null ? 'fable' : 'sol')
    return { degraded: true, missing, rF, rS, sinkF, sinkS, solCross }
  }
  return { degraded: false, rF, rS, sinkF, sinkS, solCross }
}

// runCloseCouncil — the milestone-close ratification pair that RETIRES Judge Dredd at T4, on the
// EXACT gateDecision(...).judge branch (zero blocking findings AND disagreeing analyst overalls — red
// monotonicity is STRUCTURAL: a deterministic QA_FAIL never reaches here). The frozen close record IS
// the rendered artifact — no second render, so bundle_hash = plan_hash. Both APPROVE + valid ⇒ QA_PASS +
// a twin_ratified certificate; ANY other outcome ⇒ QA_FAIL fail-closed with an honest terminal and the
// blocking findings FROZEN into close_council_findings (carried into qaFindings, the correction packet,
// and the corrective fixNote). NO answer exchange in the lite form.
const runCloseCouncil = async (m, reconciled, overallA, overallB, goalOverall, c, gateProv, mCouncilDir, receiptsBucket, lastTrialRunId, suiteRecorded, executedProbeIds) => {
  const phaseName = 'Judgment'
  const keystone = `milestone_close:${m.id}`
  const phaseTag = `CLOSE_RATIFY_C${c}`
  // The close certificate BINDS its evidence by hash, never by bare name. A Thoth transcription
  // leg hashes the NAMED artifacts (law.json + the last trial's results/suite files) into a {path,
  // sha256} manifest (the architecture anchor pattern). A dead/garbled/partial anchor ⇒ the close
  // council DEGRADES fail-closed — the certificate must NEVER bind unhashed names. The anchor gates
  // BEFORE the record is frozen; evidence_refs then carry {path, sha256}, never raw path strings.
  // The suite files are named IFF the build recorded a project suite (suiteRecorded), so a
  // genuinely suite-less product does not name absent artifacts and spuriously DEGRADE. The
  // executed-probe artifacts (probe-<SC>.json/.log) are named for EXACTLY the ids the single derivation
  // leg found EXECUTED (executedProbeIds, already ∩ probeScIds) — a deferred probe is named NOWHERE and
  // never enters this manifest, so the certificate binds only artifacts the trial actually recorded.
  const closeProbeIds = Array.isArray(executedProbeIds) ? executedProbeIds : []
  const namedEvidence = [lawFile].concat(trialEvidencePaths(lastTrialRunId, suiteRecorded)).concat(probeEvidencePaths(lastTrialRunId, closeProbeIds))
  const anchor = await agent(evidenceAnchorPrompt(namedEvidence), { label: `thoth:close-anchor:${m.id}:c${c}`, phase: phaseName, model: 'haiku', schema: EVIDENCE_ANCHOR_SCHEMA })
  const anchorFiles = (anchor && Array.isArray(anchor.files)) ? anchor.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : []
  const anchorPaths = anchorFiles.map((f) => f.path)
  const anchorExact =
    anchor && Array.isArray(anchor.files) && anchorFiles.length === anchor.files.length &&
    anchorFiles.length === namedEvidence.length &&
    new Set(anchorPaths).size === anchorFiles.length &&
    namedEvidence.every((p) => anchorPaths.includes(p))
  if (!anchorExact) {
    const rec = degraded({ missing: 'evidence', reason: 'close-anchor did not produce an exact evidence manifest (law.json + the last trial results/run files + the suite files when a project suite was recorded + the executed-probe artifacts, each hashed once, 64-hex) — a named-but-unhashed artifact DEGRADES the close' })
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashBuild, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'evidence' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, cycle: c, terminal: 'DEGRADED', reason: 'evidence-anchor' }, phaseName)
    log(`${m.id}: milestone-close evidence anchor DEGRADED — QA_FAIL fail-closed; the certificate must never bind unhashed names`)
    return { qa: 'QA_FAIL', terminal: 'DEGRADED', certificate: null, terminal_record: rec, findings: [], bundle_hash: null, receipt_verified: false, ledger_verified: false }
  }
  const manifest = {}
  for (const f of anchorFiles) manifest[f.path] = f.sha256
  const evidenceRefs = Object.keys(manifest).sort().map((p) => ({ path: p, sha256: manifest[p] }))
  const evidenceManifestHash = sha256Hex(canonicalJson(manifest))
  const evidenceInputHashes = Object.keys(manifest).sort().map((k) => manifest[k])
  const closeRecord = {
    milestone: { id: m.id, title: m.title, acceptance: m.acceptance },
    reconciled: { summaryLines: reconciled.summaryLines, blocking: reconciled.blocking.length },
    analyst_overalls: { a: overallA != null ? overallA : null, b: overallB != null ? overallB : null },
    goal_audit_overall: goalOverall != null ? goalOverall : null,
    suite_recorded: !!suiteRecorded,
    // The transcribed executed-probe id set the close binds (the single derivation's output),
    // so the frozen record HONESTLY states which probe artifacts its evidence_refs cover — a deferred probe
    // is absent here and from evidence_refs alike.
    executed_probe_ids: [...closeProbeIds].sort(),
    evidence_refs: evidenceRefs,
  }
  const bundleHash = sha256Hex(canonicalJson(closeRecord))
  const ckptBase = { protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashBuild, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, decision_bundle_hash: bundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash }
  // BOTH ratification packets carry the COMPLETE frozen closeRecord verbatim: the fable prompt
  // in its inputs, the sol packet as its packetObj — each head ratifies the exact record it signs.
  const closeRecordJson = JSON.stringify(closeRecord)
  const ratifyInputs =
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
    `- The reconciled analyst + goal-backward findings (deduped, severity-ranked):\n${reconciled.summaryLines.map((l) => '  - ' + l).join('\n') || '  (none)'}\n` +
    `- The COMPLETE frozen close record you are ratifying (evidence_refs bind each NAMED artifact to its sha256):\n${closeRecordJson}\n` +
    `- The live repo at ${projectPath}; read each evidence_refs path and confirm it matches its bound hash.\n</inputs>`
  const bindingLine = `Binding: artifact_hash = "${bundleHash}" (echo it VERBATIM). divergence_selections = [] (no open divergences this round). changed_evidence = [] unless you reverse a prior block.`
  const fablePrompt =
    `You are a council ratifier (close:${m.id}) — rule the milestone CLOSE against the fixed rubric, blind and independent. You do not know who else is ruling.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${CLOSE_RUBRIC}\n</rubric>\n\n<binding>\n${bindingLine}\n</binding>\n<constraints>\n- ${browserLaw}\n</constraints>\n\n` +
    `<task>${CLOSE_RATIFY_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const solBrief = `${bindingLine}\nRubric:\n${CLOSE_RUBRIC}\nRule read-only from the repo + the persisted deterministic evidence NAMED in the close record's evidence_refs (each bound to its sha256); NEVER launch a browser.`
  const pair = await runBuildBlindPair({ m, mCouncilDir, keystone, phaseTag, c, legName: 'close', fablePrompt, solTaskText: CLOSE_RATIFY_TASK, solBrief, solPacket: { close_record: closeRecord, artifact_hash: bundleHash }, schema: RATIFY_SCHEMA, phaseName, gateProv, receiptsBucket })
  const seatHashes = (rF, rS) => ({ P0: sha256Hex(canonicalJson(rF)), P1: sha256Hex(canonicalJson(rS)) })
  if (pair.degraded) {
    const rec = degraded({ missing: pair.missing, reason: `seat death at ${phaseTag} (${pair.missing})` })
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: pair.missing }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, cycle: c, terminal: 'DEGRADED', missing: pair.missing }, phaseName)
    log(`${m.id}: milestone-close council DEGRADED (${pair.missing}) — QA_FAIL fail-closed, never a judge fallback at T4`)
    return { qa: 'QA_FAIL', terminal: 'DEGRADED', certificate: null, terminal_record: rec, findings: [], bundle_hash: bundleHash, receipt_verified: !!(pair.sinkS && pair.sinkS.receipt_verified), ledger_verified: !!(pair.solCross && pair.solCross.ledger_verified) }
  }
  // Mirror the architecture LITE path's validity logic EXACTLY — compute vF/vS + shapeF/shapeS
  // FIRST; ANY invalid/shape-bad ratification (e.g. a dual-APPROVE echoing a wrong artifact_hash) ⇒
  // DEGRADED naming the head(s) + defect (never BLOCKED, never a frozen-findings carry from an invalid
  // verdict); ONLY live, VALID BLOCK/NEITHER verdicts ⇒ BLOCKED with frozen findings.
  const vF = validateRatification(pair.rF, { bundle_hash: bundleHash, open_divergence_ids: [] })
  const vS = validateRatification(pair.rS, { bundle_hash: bundleHash, open_divergence_ids: [] })
  const shapeF = verdictShapeError(pair.rF), shapeS = verdictShapeError(pair.rS)
  const fBad = !vF.valid || !!shapeF, sBad = !vS.valid || !!shapeS
  if (fBad || sBad) {
    const missing = fBad && sBad ? 'both' : (fBad ? 'fable' : 'sol')
    const detail = [fBad ? `fable${shapeF ? `: ${shapeF}` : ''}` : null, sBad ? `sol${shapeS ? `: ${shapeS}` : ''}` : null].filter(Boolean).join('; ')
    const rec = degraded({ missing, reason: `invalid ratification at ${phaseTag} (${detail})` })
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing, reason: 'invalid ratification' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, cycle: c, terminal: 'DEGRADED', missing, invalid: { fable: fBad, sol: sBad } }, phaseName)
    log(`${m.id}: milestone-close ratification INVALID (${detail}) — QA_FAIL fail-closed DEGRADED (never mislabeled BLOCKED; an invalid verdict carries no standing findings)`)
    return { qa: 'QA_FAIL', terminal: 'DEGRADED', certificate: null, terminal_record: rec, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
  }
  if (pair.rF.verdict === 'APPROVE' && pair.rS.verdict === 'APPROVE') {
    const cert = assembleRatifyCertificate({ rF: pair.rF, rS: pair.rS, provF: seatProv(pair.sinkF, 'fable'), provS: seatProv(pair.sinkS, 'sol'), context: { bundle_hash: bundleHash, renderer_version: COUNCIL_RENDERER_CLOSE, plan_hash: bundleHash, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null } })
    if (!cert.ok) {
      const rec = degraded({ missing: 'both', reason: `certificate could not seal: ${cert.reason}` })
      await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { reason: 'certificate defect' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
      await councilRuling({ keystone, phase: phaseTag, cycle: c, terminal: 'DEGRADED', reason: 'certificate defect' }, phaseName)
      log(`${m.id}: milestone-close certificate could not seal (${cert.reason}) — QA_FAIL fail-closed`)
      return { qa: 'QA_FAIL', terminal: 'DEGRADED', certificate: null, terminal_record: rec, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
    }
    await councilCheckpoint({ ...ckptBase, phase: 'CLOSE_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
    await councilCheckpoint({ ...ckptBase, phase: 'RATIFIED', anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, cycle: c, terminal: 'RATIFIED', bundle_hash: bundleHash }, phaseName)
    log(`${m.id}: TWIN COUNCIL RATIFIED the milestone close (bundle ${String(bundleHash).slice(0, 12)}…) — QA_PASS carries two valid head signatures`)
    return { qa: 'QA_PASS', terminal: 'RATIFIED', certificate: cert.certificate, terminal_record: null, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
  }
  // Both valid but not dual-APPROVE ⇒ a live, VALID BLOCK/NEITHER ⇒ honest BLOCKED; FREEZE the findings.
  const frozen = [...closeFindingsOf(pair.rF), ...closeFindingsOf(pair.rS)]
  await councilCheckpoint({ ...ckptBase, phase: 'CLOSE_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  await councilRuling({ keystone, phase: phaseTag, cycle: c, terminal: 'BLOCKED', verdicts: { fable: pair.rF.verdict, sol: pair.rS.verdict } }, phaseName)
  log(`${m.id}: milestone-close council BLOCKED (fable ${pair.rF.verdict}, sol ${pair.rS.verdict}) — QA_FAIL fail-closed; ${frozen.length} finding(s) frozen into the correction`)
  return { qa: 'QA_FAIL', terminal: 'BLOCKED', certificate: null, terminal_record: null, findings: frozen, bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
}

// runCorrectionCouncil — the REQUIRED blind council over retry | escalate | replan BEFORE the sole
// corrective build. council_findings carries the frozen close_council_findings when the close pair
// blocked this cycle (IDs + refs verbatim). Matching choices settle; split/dead/invalid ⇒ fail-closed
// ESCALATE (never a builder attempt spent on a split council, never a silent RETRY).
const runCorrectionCouncil = async (m, reconciled, closeFindings, sliceTelemetry, c, gateProv, mCouncilDir, receiptsBucket) => {
  const phaseName = 'Judgment'
  const keystone = `correction:${m.id}`
  const phaseTag = `CORRECTION_C${c}`
  const correctionRecord = {
    milestone: { id: m.id, title: m.title, acceptance: m.acceptance },
    cycle: c, cap: MAX_TRIBUNAL_CORRECTION,
    reconciled_summary: reconciled.summaryLines,
    council_findings: Array.isArray(closeFindings) ? closeFindings : [],
    slice_telemetry: sliceTelemetry,
    evidence_refs: [lawFile, `${kilnDir}/evidence/`],
  }
  const artifactHash = sha256Hex(canonicalJson(correctionRecord))
  const ckptBase = { protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashBuild, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, decision_bundle_hash: artifactHash, input_artifact_hashes: [], evidence_manifest_hash: sha256Hex(canonicalJson(correctionRecord.evidence_refs)) }
  const councilFindingsBlock = (correctionRecord.council_findings.length)
    ? `\n<close-council-findings>\nThe milestone-close pair BLOCKED this cycle on these frozen findings (fix the ROUTE for them):\n${correctionRecord.council_findings.map(closeFindingLine).join('\n')}\n</close-council-findings>\n`
    : ''
  const inputs =
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
    `- This is correction cycle ${c} of a cap of ${MAX_TRIBUNAL_CORRECTION}: exactly ONE corrective build remains.\n` +
    `- Reconciled blocking findings:\n${reconciled.summaryLines.map((l) => '  - ' + l).join('\n') || '  (none)'}\n` +
    `- Slice telemetry: ${JSON.stringify(sliceTelemetry)}\n</inputs>${councilFindingsBlock}`
  const bindingLine = `Binding: artifact_hash = "${artifactHash}" (echo it VERBATIM).`
  const fablePrompt =
    `You are a correction-route council member (${m.id}) — rule the correction ROUTE blind and independent. You do not know who else is ruling.\n\n` +
    `${inputs}\n\n<binding>\n${bindingLine}\n</binding>\n\n<task>${CORRECTION_TASK}\nEmit findings + reasons FIRST, then choice; reasoning optional, last, under 50 words. ${PAYLOAD_FIRST}</task>`
  const solBrief = `${bindingLine}\n${councilFindingsBlock}\nRule the correction ROUTE (RETRY | ESCALATE | REPLAN) from the reconciled findings + slice telemetry, read-only.`
  const pair = await runBuildBlindPair({ m, mCouncilDir, keystone, phaseTag, c, legName: 'correction', fablePrompt, solTaskText: CORRECTION_TASK, solBrief, solPacket: { milestone: correctionRecord.milestone, cycle: c, cap: MAX_TRIBUNAL_CORRECTION, reconciled_summary: reconciled.summaryLines, council_findings: correctionRecord.council_findings, slice_telemetry: sliceTelemetry, artifact_hash: artifactHash }, schema: CORRECTION_SCHEMA, phaseName, gateProv, receiptsBucket })
  if (pair.degraded) {
    // A dead-seat pair still carries the SURVIVING live head's findings + reasons (never
    // discarded). runBuildBlindPair marks missing='sol' when only Fable survived (pair.rF) and
    // missing='fable' when only Sol survived (pair.rS); a both-dead pair carries nothing. Harvest
    // defensively — arrays only when schema-shaped — into the return, the ruling note, and (via the
    // call site's correctionRulingLines) the ESCALATE qaFindings.
    const survivor = pair.missing === 'sol' ? pair.rF : (pair.missing === 'fable' ? pair.rS : null)
    const survFindings = survivor && Array.isArray(survivor.findings) ? survivor.findings : []
    const survReasons = survivor && Array.isArray(survivor.reasons) ? survivor.reasons : []
    await councilCheckpoint({ ...ckptBase, phase: 'CORRECTION_COUNCIL_SEALED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: pair.missing }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, cycle: c, ruling: 'ESCALATE', terminal: 'DEGRADED', missing: pair.missing, findings: survFindings, reasons: survReasons }, phaseName)
    log(`${m.id}: correction council DEGRADED (${pair.missing}) — fail-closed ESCALATE (never a builder attempt spent on a split council); ${survFindings.length} surviving-head finding(s) carried`)
    return { choice: 'ESCALATE', degraded: true, missing: pair.missing, terminal: 'DEGRADED', findings: survFindings, reasons: survReasons, bundle_hash: artifactHash, receipt_verified: !!(pair.sinkS && pair.sinkS.receipt_verified), ledger_verified: !!(pair.solCross && pair.solCross.ledger_verified) }
  }
  // RETAIN both heads' findings + reasons (never discarded — they ride qaFindings on
  // ESCALATE/REPLAN AND the council_ruling note). Honest terminal: an invalid echo / illegal payload ⇒
  // DEGRADED (a head that fails its duty is a missing head — the missing-head idiom); a LIVE legal SPLIT ⇒
  // BLOCKED; matched choices ⇒ RULED. Split/invalid still route the CHOICE fail-closed to ESCALATE.
  const echoOk = pair.rF.artifact_hash === artifactHash && pair.rS.artifact_hash === artifactHash
  const legal = (v) => v === 'RETRY' || v === 'ESCALATE' || v === 'REPLAN'
  const bothLegal = legal(pair.rF.choice) && legal(pair.rS.choice)
  const invalid = !echoOk || !bothLegal
  const match = !invalid && pair.rF.choice === pair.rS.choice
  const choice = match ? pair.rF.choice : 'ESCALATE'
  const terminal = invalid ? 'DEGRADED' : (match ? 'RULED' : 'BLOCKED')
  const findings = [...(Array.isArray(pair.rF.findings) ? pair.rF.findings : []), ...(Array.isArray(pair.rS.findings) ? pair.rS.findings : [])]
  const reasons = [...(Array.isArray(pair.rF.reasons) ? pair.rF.reasons : []), ...(Array.isArray(pair.rS.reasons) ? pair.rS.reasons : [])]
  await councilCheckpoint({ ...ckptBase, phase: 'CORRECTION_COUNCIL_SEALED', anonymous_seat_artifact_hashes: { P0: sha256Hex(canonicalJson(pair.rF)), P1: sha256Hex(canonicalJson(pair.rS)) }, seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  await councilRuling({ keystone, phase: phaseTag, cycle: c, ruling: choice, terminal, matched: match, choices: { fable: pair.rF.choice, sol: pair.rS.choice }, findings, reasons }, phaseName)
  if (invalid) log(`${m.id}: correction council INVALID (fable ${pair.rF.choice}, sol ${pair.rS.choice}${echoOk ? '' : ', artifact_hash mismatch'}) — fail-closed ESCALATE, terminal DEGRADED`)
  else if (!match) log(`${m.id}: correction council SPLIT (fable ${pair.rF.choice}, sol ${pair.rS.choice}) — a live legal split, fail-closed ESCALATE, terminal BLOCKED`)
  else log(`${m.id}: correction council rules ${choice} (both heads agree) — terminal RULED`)
  return { choice, degraded: false, matched: match, terminal, findings, reasons, bundle_hash: artifactHash, receipt_verified: !!(pair.sinkS && pair.sinkS.receipt_verified), ledger_verified: !!(pair.solCross && pair.solCross.ledger_verified) }
}

// runLegacyPlanRatify — ONE retrospective blind dual ratification of the UNCHANGED
// master plan (the lite-pair idiom reused: the plan IS the artifact, no decision bundle exists,
// so bundle_hash = plan_hash = the master plan's own sha256). A Thoth anchor hashes the plan + the
// architecture evidence into a {path, sha256} manifest — a dead/garbled/partial anchor ⇒ DEGRADED (the
// certificate must never bind unhashed names). Then the blind Fable ∥ receipt-attested Sol pair rules
// once over the plan bytes (runBuildBlindPair, RATIFY_SCHEMA). Dual-APPROVE + valid ⇒ a retrospective
// twin_ratified certificate (renderer b3-legacy/1, each signature its own seatProv); a live valid
// BLOCK/NEITHER ⇒ BLOCKED (frozen findings); a dead seat / invalid-or-shape-bad verdict / certificate
// defect ⇒ DEGRADED (never twin_ratified, never a silent v3.0.1 advance). The plan is never edited —
// the retrospective certificate is its OWN record; the plan stays legacy_authority in provenance.
const runLegacyPlanRatify = async (gateProv, receiptsBucket) => {
  const phaseName = 'The Forge Heats'
  const keystone = 'master_plan_legacy'
  const phaseTag = 'LEGACY_RATIFY'
  const legacyCouncilDir = `${councilRootDir}/legacy`
  const m = { id: 'master_plan' } // synthetic — runBuildBlindPair labels off m.id (fable/sol:legacy-ratify:master_plan:c0)
  const namedEvidence = [masterPlanFile, `${docsDir}/architecture.md`, `${docsDir}/tech-stack.md`, `${docsDir}/arch-constraints.md`, legacyVisionFile]
  const anchor = await agent(evidenceAnchorPrompt(namedEvidence), { label: 'thoth:legacy-anchor', phase: phaseName, model: 'haiku', schema: EVIDENCE_ANCHOR_SCHEMA })
  const anchorFiles = (anchor && Array.isArray(anchor.files)) ? anchor.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : []
  const anchorPaths = anchorFiles.map((f) => f.path)
  const anchorExact =
    anchor && Array.isArray(anchor.files) && anchorFiles.length === anchor.files.length &&
    anchorFiles.length === namedEvidence.length &&
    new Set(anchorPaths).size === anchorFiles.length &&
    namedEvidence.every((p) => anchorPaths.includes(p))
  const legacyCkptBase = (bundleHash, evidenceManifestHash, evidenceInputHashes) => ({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashLegacy, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, decision_bundle_hash: bundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash })
  if (!anchorExact) {
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashLegacy, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'evidence' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'evidence-anchor' }, phaseName)
    log('legacy-plan evidence anchor DEGRADED — the retrospective certificate must never bind unhashed names (fail-closed)')
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null, receipt_verified: false, ledger_verified: false }
  }
  const manifest = {}
  for (const f of anchorFiles) manifest[f.path] = f.sha256
  const evidenceManifestHash = sha256Hex(canonicalJson(manifest))
  const evidenceInputHashes = Object.keys(manifest).sort().map((k) => manifest[k])
  // The plan IS the artifact: bundle_hash = plan_hash = the master plan's OWN sha256 (its manifest entry).
  const planHash = manifest[masterPlanFile]
  const bundleH = planHash
  const ckptBase = legacyCkptBase(bundleH, evidenceManifestHash, evidenceInputHashes)
  const bindingLine = `Binding: artifact_hash = "${bundleH}" (echo it VERBATIM). plan_sha256 = ${planHash}. evidence_manifest_hash = ${evidenceManifestHash}. divergence_selections = [] (no open divergences — the plan is the single artifact). changed_evidence = [] unless you reverse a prior block.`
  const ratifyInputs =
    `<inputs>\n- The UNCHANGED master plan: ${masterPlanFile} (bound to its sha256 in the binding line).\n` +
    `- Evidence docs: ${namedEvidence.join(', ')}.\n- The live repo at ${projectPath}.\n</inputs>`
  const fablePrompt =
    `You are a council ratifier (legacy master plan) — rule the UNCHANGED master plan against the fixed rubric, blind and independent. You do not know how the plan was authored or who else is ruling.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${LEGACY_RUBRIC}\n</rubric>\n\n<binding>\n${bindingLine}\n</binding>\n<constraints>\n- ${browserLaw}\n</constraints>\n\n` +
    `<task>${LEGACY_RATIFY_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const solBrief = `${bindingLine}\nRubric:\n${LEGACY_RUBRIC}\nRule the UNCHANGED master plan read-only from the plan + the evidence docs; NEVER launch a browser.`
  const pair = await runBuildBlindPair({ m, mCouncilDir: legacyCouncilDir, keystone, phaseTag, c: 0, legName: 'legacy-ratify', fablePrompt, solTaskText: LEGACY_RATIFY_TASK, solBrief, solPacket: { master_plan: masterPlanFile, evidence: namedEvidence, artifact_hash: bundleH, plan_sha256: planHash, evidence_manifest_hash: evidenceManifestHash }, schema: RATIFY_SCHEMA, phaseName, gateProv, receiptsBucket })
  const seatHashes = (rF, rS) => ({ P0: sha256Hex(canonicalJson(rF)), P1: sha256Hex(canonicalJson(rS)) })
  if (pair.degraded) {
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: pair.missing }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing: pair.missing }, phaseName)
    log(`legacy-plan retrospective ratification DEGRADED (${pair.missing}) — a dead seat is a missing head, never twin_ratified`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleH, missing: pair.missing, receipt_verified: !!(pair.sinkS && pair.sinkS.receipt_verified), ledger_verified: !!(pair.solCross && pair.solCross.ledger_verified) }
  }
  const vF = validateRatification(pair.rF, { bundle_hash: bundleH, open_divergence_ids: [] })
  const vS = validateRatification(pair.rS, { bundle_hash: bundleH, open_divergence_ids: [] })
  const shapeF = verdictShapeError(pair.rF), shapeS = verdictShapeError(pair.rS)
  const fBad = !vF.valid || !!shapeF, sBad = !vS.valid || !!shapeS
  if (fBad || sBad) {
    const missing = fBad && sBad ? 'both' : (fBad ? 'fable' : 'sol')
    const detail = [fBad ? `fable${shapeF ? `: ${shapeF}` : ''}` : null, sBad ? `sol${shapeS ? `: ${shapeS}` : ''}` : null].filter(Boolean).join('; ')
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing, reason: 'invalid ratification' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing, invalid: { fable: fBad, sol: sBad } }, phaseName)
    log(`legacy-plan retrospective ratification INVALID (${detail}) — DEGRADED (an invalid verdict carries no standing findings; never mislabeled BLOCKED)`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleH, missing, receipt_verified: true, ledger_verified: true }
  }
  if (pair.rF.verdict === 'APPROVE' && pair.rS.verdict === 'APPROVE') {
    const cert = assembleRatifyCertificate({ rF: pair.rF, rS: pair.rS, provF: seatProv(pair.sinkF, 'fable'), provS: seatProv(pair.sinkS, 'sol'), context: { bundle_hash: bundleH, renderer_version: COUNCIL_RENDERER_LEGACY, plan_hash: bundleH, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null } })
    if (!cert.ok) {
      await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { reason: 'certificate defect' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
      await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'certificate defect' }, phaseName)
      log(`legacy-plan retrospective certificate could not seal (${cert.reason}) — DEGRADED`)
      return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleH, receipt_verified: true, ledger_verified: true }
    }
    await councilCheckpoint({ ...ckptBase, phase: 'LEGACY_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
    await councilCheckpoint({ ...ckptBase, phase: 'RATIFIED', anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'RATIFIED', bundle_hash: bundleH }, phaseName)
    log(`legacy master plan RETROSPECTIVELY RATIFIED (bundle ${String(bundleH).slice(0, 12)}…) — two valid head signatures over the UNCHANGED plan; the plan advances with a retrospective certificate`)
    return { terminal: 'RATIFIED', certificate: cert.certificate, findings: [], bundle_hash: bundleH, receipt_verified: true, ledger_verified: true }
  }
  // Both valid but not dual-APPROVE ⇒ a live, VALID BLOCK/NEITHER ⇒ honest BLOCKED; freeze the findings.
  const frozen = [...closeFindingsOf(pair.rF), ...closeFindingsOf(pair.rS)]
  await councilCheckpoint({ ...ckptBase, phase: 'LEGACY_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  await councilRuling({ keystone, phase: phaseTag, terminal: 'BLOCKED', verdicts: { fable: pair.rF.verdict, sol: pair.rS.verdict } }, phaseName)
  log(`legacy master plan BLOCKED (fable ${pair.rF.verdict}, sol ${pair.rS.verdict}) — a live valid BLOCK/NEITHER; ${frozen.length} finding(s) frozen, the build is gated`)
  return { terminal: 'BLOCKED', certificate: null, findings: frozen, bundle_hash: bundleH, receipt_verified: true, ledger_verified: true }
}

// Stage bracket: the build stage is entered — past both floor gates, so the
// ledger CLI is locatable, and BEFORE any other build-stage ledger activity (the pre-flight sweep
// below appends browser_sweep at stage:'build'; a projection read must never see build events
// while stage still reads the prior projection). gateOnly re-enters the stage too
// (accurate), so this fires either way; stage_completed only lands on the genuine
// all-milestones-passed return below (a QA_FAIL/refusal leaves the projection at 'build', which
// is the truthful state for the correction loop).
await ledger('stage_started', { stage: 'build', gate_only: gateOnly }, 'The Forge Heats')

// Pre-flight sweep: clear any orphaned browser tree from a prior crashed run BEFORE the
// first probe could spawn (defense against a prior run's stale SingletonLock). Past
// the floor gates, so pluginRoot + the ledger are usable.
await stageSweep('pre-flight')

// rakim:setup ∥ confucius:parse — independent legs run in PARALLEL. rakim
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
// The milestone loop + return live inside a try whose finally runs the UNCONDITIONAL
// stage-end sweep. The browser is a subprocess with a deadline, never a service — so the stage's
// closing bracket must reap this build's browser survivors on EVERY exit path, a thrown
// agent()/parse error included (a crash mid-probe is exactly when leaks must be swept). The sweep
// sits in finally, not after the loop, so no throw can skip it.
try {

// ── THE LEGACY-PLAN HOOK — runs ONCE, BEFORE the first milestone's close council, ONLY
//    where build's council rails are live (councilCapable = T4 + codex + runToken). Sub-T4 / no-codex /
//    tokenless runs keep their EXISTING byte-preserved behavior — no hook, no detection read, no new
//    labels: a legacy plan there advances exactly as in v3.0.1. A run whose master plan carries a
//    RATIFIED / DEADLOCK_RESOLVED master_plan council checkpoint (the COMMON case — a plan the twin
//    council already ratified) skips the hook entirely. ──
let legacyCouncil = null
if (councilCapable) {
  const checkpoints = await readCouncilCheckpointsB('The Forge Heats')
  const hasTerminal = (kid, ...phases) => checkpoints.some((c) => c && c.keystone_id === kid && c.status === 'sealed' && phases.includes(c.phase))
  // Detection: the ABSENCE of a RATIFIED / DEADLOCK_RESOLVED master_plan checkpoint — the
  // terminal rows a completed architecture council leaves behind (RATIFIED / DEADLOCK_RESOLVED,
  // appended via buildCheckpoint → note{kind:'council_state'}). A missing row
  // is a FACT, deterministic — never a guess.
  // A DEADLOCK_RESOLVED master_plan row is NOT trusted on its label alone — the provisional seal
  // could predate a CHANGED master-plan.md. Its certificate is reloaded and the CURRENT plan re-anchored;
  // only when the row's plan/bundle/certificate/template/run-token bindings ALL match does it authorize the
  // advance. Any mismatch ⇒ the row is void here and the legacy re-ratification path runs over the current
  // plan (never a stale advance). A plain RATIFIED master_plan row keeps its existing authority.
  const deadlockRow = checkpoints.find((c) => c && c.keystone_id === 'master_plan' && c.status === 'sealed' && c.phase === 'DEADLOCK_RESOLVED')
  const verifyDeadlockResolvedRow = async (row, phaseName) => {
    const prov = row && row.seat_provenance && typeof row.seat_provenance === 'object' ? row.seat_provenance : {}
    const rowPlan = prov.plan_hash, rowCert = prov.certificate_hash, rowBundle = row.decision_bundle_hash
    const rowTemplate = row.template_hash, rowToken = row.run_token_hash
    if (!(SHA64_RE.test(String(rowPlan)) && SHA64_RE.test(String(rowCert)) && SHA64_RE.test(String(rowBundle)) && SHA64_RE.test(String(rowTemplate)))) { log('the DEADLOCK_RESOLVED row lacks the plan/certificate/bundle/template bindings — the row is VOID (re-ratifying the current plan)'); return false }
    if (rowToken !== runTokenHash) { log('the DEADLOCK_RESOLVED row binds a different run-token hash — the row is VOID (re-ratifying the current plan)'); return false }
    const anchor = await agent(evidenceAnchorPrompt([masterPlanFile]), { label: 'thoth:deadlock-plan-anchor', phase: phaseName, model: 'haiku', schema: EVIDENCE_ANCHOR_SCHEMA })
    const af = (anchor && Array.isArray(anchor.files)) ? anchor.files.find((f) => f && f.path === masterPlanFile && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : null
    const currentPlanHash = af ? af.sha256 : null
    if (currentPlanHash == null || currentPlanHash !== rowPlan) { log(`the CURRENT master-plan.md hash (${currentPlanHash ? String(currentPlanHash).slice(0, 12) + '…' : 'unreadable'}) does not match the row's bound plan hash — the plan CHANGED after provisional sealing; the row is VOID (re-ratifying the current plan)`); return false }
    const rd = await agent(readCouncilFilePrompt(deadlockCertFile), { label: 'thoth:deadlock-cert-reload', phase: phaseName, model: 'haiku', schema: READ_COUNCIL_FILE_SCHEMA })
    const content = rd && typeof rd.content === 'string' ? rd.content : null
    const fileSha = rd && typeof rd.sha256 === 'string' && SHA64_RE.test(rd.sha256) ? rd.sha256 : null
    if (!(content && fileSha === rowCert && sha256Hex(content) === rowCert)) { log('the persisted DEADLOCK_RESOLVED certificate did not reload (missing/sha-drift) — the row is VOID (re-ratifying the current plan)'); return false }
    let cert = null
    try { cert = JSON.parse(content) } catch { cert = null }
    if (!(cert && typeof cert === 'object' && sha256Hex(canonicalJson(cert)) === rowCert)) { log('the reloaded certificate does not re-canonicalize to the bound hash — the row is VOID (re-ratifying the current plan)'); return false }
    if (!(cert.plan_hash === rowPlan && cert.bundle_hash === rowBundle && cert.template_hash === rowTemplate && cert.run_token_hash === rowToken)) { log('the reloaded certificate\'s bindings disagree with the row — the row is VOID (re-ratifying the current plan)'); return false }
    log(`the DEADLOCK_RESOLVED master_plan row VERIFIED — the CURRENT plan, bundle, certificate, template, and run-token bindings all match; the twin_deadlock_resolved terminal advances`)
    return true
  }
  const deadlockVerified = deadlockRow ? await verifyDeadlockResolvedRow(deadlockRow, 'The Forge Heats') : false
  const masterRatified = hasTerminal('master_plan', 'RATIFIED') || deadlockVerified
  // A prior master_plan_legacy RATIFIED row is NOT a licence to advance — its certificate is not
  // ledgered reloadably, and the master plan may have CHANGED since it was signed. So a resume NEVER trusts
  // the stale label (the old certificate:null fast-advance); it re-anchors + RE-RATIFIES over the CURRENT
  // plan bytes (the heads sign the ACTUAL content, a fresh real certificate is minted) and verifies the
  // prior binding (template hash, run-token hash, and the recorded plan hash EQUAL to the current plan's
  // sha) for the audit record — a changed plan / template / token drift never advances under the old row.
  const priorLegacyRow = checkpoints.find((c) => c && c.keystone_id === 'master_plan_legacy' && c.status === 'sealed' && c.phase === 'RATIFIED')
  if (!masterRatified) {
    // The plan predates the council: mark legacy_authority (never relabeled twin_ratified, no historical
    // event rewritten — the marking is a NEW note, not an edit of any prior row).
    await councilRuling({ keystone: 'master_plan_legacy', phase: 'DETECT', marking: 'legacy_authority', reason: 'no RATIFIED/DEADLOCK_RESOLVED master_plan council checkpoint in the run ledger — the master plan predates the twin council' }, 'The Forge Heats')
    if (priorLegacyRow) log('a prior master_plan_legacy RATIFIED row exists — RE-anchoring + RE-verifying it against the CURRENT plan (never a stale certificate:null advance)')
    else log('LEGACY MASTER PLAN detected (no council certificate in the run ledger) — marked legacy_authority; running ONE retrospective blind dual ratification of the UNCHANGED plan before the first milestone close')
    const legacyProv = []
    const legacyReceipts = []
    const lr = await runLegacyPlanRatify(legacyProv, legacyReceipts)
    const priorBindingVerified = !!(priorLegacyRow && priorLegacyRow.template_hash === councilTemplateHashLegacy && priorLegacyRow.run_token_hash === runTokenHash && lr.bundle_hash != null && priorLegacyRow.decision_bundle_hash === lr.bundle_hash)
    legacyCouncil = { authority: 'legacy_authority', terminal: lr.terminal, certificate: lr.certificate, bundle_hash: lr.bundle_hash, ...(priorLegacyRow ? { prior_binding_verified: priorBindingVerified } : {}), receipt_verified: lr.receipt_verified, ledger_verified: lr.ledger_verified, council_missing_head: (lr.missing === 'fable' || lr.missing === 'sol') ? lr.missing : null, ...(legacyReceipts.length ? { receipts: legacyReceipts } : {}) }
    if (lr.terminal !== 'RATIFIED') {
      // Non-APPROVE ⇒ the honest BLOCKED/DEGRADED terminal GATES the keystone: the build never proceeds
      // to the first milestone under an unratified legacy plan (build's EXISTING council-rail honesty —
      // reuse, don't invent). No milestone close convenes; validate/the conductor sees the terminal.
      const legacyFindings = (Array.isArray(lr.findings) ? lr.findings : []).map(closeFindingLine)
      await ledger('gate_decision', { milestone: null, qa: 'QA_FAIL', legacy_council: legacyCouncil, ...(legacyProv.length ? { gate_provenance: legacyProv } : {}), ...(legacyReceipts.length ? { council_receipts: legacyReceipts } : {}) }, 'The Forge Heats')
      log(`legacy master plan ${lr.terminal} — the retrospective ratification did not dual-APPROVE; the build is GATED before the first milestone (no milestone close convenes)`)
      return { built: [], passed: [], all_passed: false, law_gated: true, split_required: [], council: legacyCouncil, findings: legacyFindings }
    }
    log(`legacy master plan RATIFIED retrospectively${priorLegacyRow ? ` (prior binding ${priorBindingVerified ? 'verified — plan unchanged' : 'DID NOT match — the prior row is void; a fresh certificate now signs the CURRENT plan'})` : ''} — the plan advances with a real certificate; the build proceeds to the milestones`)
  }
}

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
  // build.anvil (keystone): the milestone opens — the duo takes the forge.
  await lore('build.anvil', `${m.id} takes the anvil — \`${builderName}\` strikes, \`${reviewerName}\` judges`, { milestone: m.id, builder: builderName, reviewer: reviewerName }, 'The Forge Heats')
  // Provenance collector: every gate leg in this milestone (slice reviews, the tribunal analysts,
  // the judge, the goal-backward audit) records {requested_model, actual_model, fallback_reason,
  // classification} into a fresh sink; they collect here and ride the EXISTING gate_decision ledger
  // append at the milestone close (no new event type).
  const gateProv = []
  // ── Twin Council per-milestone state. mCouncilDir holds this milestone's council
  //    artifacts under the shared per-run tree; the receipts bucket + terminals ride the boundary
  //    records. All inert on the sub-T4 / no-codex / tokenless paths (councilCapable false). ──
  const mCouncilDir = `${councilRootDir}/${m.id}`
  const mCouncilReceipts = []
  let mCloseTerminal = null      // 'RATIFIED' | 'BLOCKED' | 'DEGRADED' | null (null off the council-judged branch)
  let mCloseCertificate = null
  let mCloseFindings = []        // the frozen close_council_findings (carried into correction packet + fixNote)
  let mCloseBundleHash = null    // the COMPUTED close record hash (present for BLOCKED/DEGRADED too — never from the certificate)
  let mCloseReceiptVerified = false // from the close Sol leg's sink
  let mCloseLedgerVerified = false  // from the close Sol leg's cross-check
  let mCloseSeatConvened = false    // the milestone_close seat convened or failed closed this gate
  let mCorrectionRuling = null   // 'RETRY' | 'ESCALATE' | 'REPLAN' | null
  let mCorrectionTerminal = null // 'RULED' | 'BLOCKED' | 'DEGRADED' | null
  let mCorrectionBundleHash = null  // the COMPUTED correction record hash
  let mCorrectionReceiptVerified = false // from the correction Sol leg's sink
  let mCorrectionLedgerVerified = false  // from the correction Sol leg's cross-check
  let mCorrectionSeatConvened = false    // the correction seat convened or failed closed this gate
  // The failed-Claude-head discriminator this milestone's councils
  // surface — 'fable' | 'sol' | null. Set on a close/correction DEGRADED that names a single head (a
  // 'both'/evidence DEGRADED folds to null); once a real head death is booked it is not overwritten by a
  // later clean council. Rides the milestone result's council field so the conductor's succession retry keys on it.
  let mCouncilMissingHead = null
  let mReplanRequired = false

  // The milestone's slice of the Law — the contract the batch plan must cover arithmetically.
  const mScs = lawChecks.filter((c) => c.milestone === m.id)
  const mScIds = mScs.map((c) => c.id)
  if (!mScIds.length) {
    log(`${m.id}: NO Law checks map to this milestone — the spine cannot gate it. Recording QA_FAIL and skipping the build (Athena's SC-coverage dimension should have blocked this; the conductor escalates).`)
    results.push({ id: m.id, title: m.title, surface: surf, slices: 0, sc_ids: [], tests_green: false, qa: 'QA_FAIL', findings: ['no law.json checks map to this milestone — ungatable'], split_required: [], replanned: false, slice_plan_failed: true })
    pipelinedPlan = null // a skipped milestone never consumes a pipelined plan — discard the speculation
    continue
  }

  // ── Milestone-scoped state read by Judgment below — hoisted because gateOnly bypasses
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
    // ── STARVED-GATE retry: skip Scoring + Forging entirely (item 19 Tier A — the pre-gate arm is
    //    gateOnlyPregate, extracted whole). ONE deterministic trial-shaped pass over ALL the
    //    milestone's SCs (verify + run --only/--expect-green, NO --flips) + freshness + runnerGate;
    //    the pure gateOnlyRefusal predicate rules: any verdict but a clean 'proceed' REFUSES the
    //    milestone (QA_FAIL, reason gate-only-on-red — never gating a red Law, never skipping a
    //    build); a green Law routes to the FULL tribunal (forceTribunal — fail toward scrutiny: the
    //    prior slice count is unknown). The guard-early caller owns results/flags. ──
    const pg = await gateOnlyPregate(m, surf, mScIds)
    if (pg.refused) { results.push(pg.result); continue }
    gateOnlyGreen = true
    forceTribunal = true
  } else {

  // ── Scoring the Cut: the batch slice plan — but pipelining
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
    const curHead = lastHead
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
  // build.cut_scored (volume): the milestone's whole slice list is planned in one take.
  await lore('build.cut_scored', `${m.id}: the cut is scored — ${queue.length} slice(s)${usedPipeline ? ' (pipelined)' : ''} [${oneLine(queue.map((s) => s.sc_ids.join('+')).join(' | '), 80)}]`, { milestone: m.id, slices: queue.length }, 'Scoring the Cut')

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
        // build.replan (volume): live state drifted from the plan — one fresh cut of the remainder.
        await lore('build.replan', `${m.id} s${qi} — state drift (${oneLine(conf.reason || 'unspecified', 80)}); one fresh slice plan for the remainder`, { milestone: m.id, slice: `${m.id}:s${qi}` }, 'Scoring the Cut')
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

    // Pre-process heavy assets ONCE before the first ui/mixed slice builds. A haiku probe —
    // recompress-if-present-else-no-op is mechanical leg
    // work, not a reasoning task; the build leg downstream owns the design effort.
    if ((surf === 'ui' || surf === 'mixed') && slices.length === 0) {
      phase('Forging')
      await agent(assetPrepPrompt(m), { label: loreLabel(builderName, 'prep', m.id), phase: 'Forging', model: 'haiku' })
    }

    phase('Forging')
    log(`${spin('build', qi)} — ${m.id} ${sliceId} [flips ${slice.sc_ids.join(', ')}]`)
    mBuild = await agent(buildPrompt(m, surf, slice, sliceId), { label: loreLabel(builderName, 'build', sliceId), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })

    // ── The Trial: evidence-first review with a bounded fix loop; the Sentinel watches ──
    // The trial's Law scope: this slice's declared flips, run together with every SC the
    // milestone already turned green (regressions observed, not assumed).
    const lawCtx = { flips: slice.sc_ids, only: [...new Set([...greenScIds, ...slice.sc_ids])] }
    let logicalRejections = 0
    let escalated = false
    let splitRequired = false
    let environmentBlocked = false   // the same infra-bearing failure reproduced with no code change
    let environmentClass = null      // 'infra' | 'mixed' when blocked — mixed is honest about its assertions
    let environmentAssertions = []   // the unresolved product-assertion SCs inside a mixed block
    let prevFingerprint = null       // the prior attempt's failure fingerprint (router state)
    let repairCapExtension = false   // one-shot cap stretch — a moved repair at the cap still admits its ONE promised correction
    let attempts = 1                 // telemetry: build attempts spent (the initial build is #1)
    let firstPassGreen = false
    const rejectionClasses = []      // telemetry: the class of each rejection, in order
    const sliceReviewProv = {} // the DECISIVE (last) review's provenance for this slice
    const tamperGuard = { tamperFired: false } // latch build.tamper to ONE beat per slice across all fix attempts + the repair re-trial
    for (let fix = 0; fix <= MAX_REVIEW_FIXES + (repairCapExtension ? 1 : 0); fix++) {
      mReview = await evidencedReview(m, surf, slice, sliceId, mBuild, fix, escalated, reviewerName, lawCtx, sliceReviewProv, tamperGuard)
      if (approvedOf(mReview)) { if (fix === 0) firstPassGreen = true; break }
      // The master signal: only LOGICAL rejections move the ratchet; mechanical/process
      // failures (tamper, stale evidence, uncommitted, hygiene findings) never escalate, and the
      // builder's own confidence never lowers anything (escalate() encodes both).
      let cls = rejectionClass(mReview)
      if (cls === 'logical') logicalRejections++
      rejectionClasses.push(cls)
      // ── Fingerprint router: decide the NEXT builder attempt's admission BEFORE
      //    spending it. Fail toward v3.0.1 — a null/first/changed fingerprint admits exactly as the
      //    old unconditional respawn; only an IDENTICAL repeat diverts. ──
      const curFingerprint = fpOrNull(mReview && mReview.fingerprint)
      const admission = admitRetry(prevFingerprint, curFingerprint)
      prevFingerprint = curFingerprint
      // The environment-repair trial is an OBSERVATION, not a builder
      // rejection. When its fingerprint MOVES (or the Law clears but the reviewer rejects), its
      // outcome is never counted toward logicalRejections and never reclassifies cls — no builder
      // attempt was spent, so the ratchet has no NEW rejection to record. The GENUINE outer
      // rejection that triggered the repair (already counted above) still walks the Sentinel
      // section at its incremented count, so feedback escalation fires on schedule and the
      // admitted correction is reviewed by the ESCALATED source. repairObserved marks the cycle
      // only so the fix cap can honor the router's promised ONE correction.
      let repairObserved = false
      if (admission.reason === 'environment_repeat') {
        // The exact same INFRA-bearing failure twice — splitting or re-building an unchanged broken
        // environment just makes two failing slices. STOP builder retries: re-run the
        // trial ONCE over the SAME commit (no builder change) — an environment-repair probe.
        const repeatKind = curFingerprint.class === 'mixed' ? 'mixed (infra+assertion)' : 'infra'
        log(`${m.id} ${sliceId}: identical ${repeatKind} failure twice [${curFingerprint.signature}] — environment repeat; re-running the trial ONCE with NO builder change (repairing the environment, never burning a builder attempt into an unchanged broken environment)`)
        await ledger('posture_escalated', { milestone: m.id, slice: sliceId, signal: 'environment_repeat', action: 'environment_repair', changes: [], fingerprint: curFingerprint.signature, fingerprint_class: curFingerprint.class, rejections: logicalRejections }, 'The Trial')
        mReview = await evidencedReview(m, surf, slice, sliceId, mBuild, fix, escalated, reviewerName, lawCtx, sliceReviewProv, tamperGuard)
        if (approvedOf(mReview)) break // the repeat CLEARED with no code change — it WAS environmental noise
        const repairFp = fpOrNull(mReview && mReview.fingerprint)
        prevFingerprint = repairFp
        if (repairFp && repairFp.signature === curFingerprint.signature) {
          // Reproduced identically with no code change. Honesty per class:
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
          // build.slice_blocked (keystone): an environment/mixed failure reproduced with no code change.
          await lore('build.slice_blocked', environmentClass === 'mixed'
            ? `${m.id} s${qi} BLOCKED (class=mixed) — environment repair owed AND assertions unresolved; code work remains`
            : `${m.id} s${qi} BLOCKED (class=environment) — repair the environment, not the code`,
            { slice: sliceId, class: environmentClass === 'mixed' ? 'mixed' : 'environment' }, 'The Trial')
          break
        }
        // The fingerprint MOVED (or the Law cleared and the reviewer rejected on fresh grounds) —
        // the repeat was environmental noise, and the repair run is an OBSERVATION: admit ONE
        // normal correction off its findings without touching the ratchet.
        repairObserved = true
        log(`${m.id} ${sliceId}: the environment-repair trial ${repairFp ? `moved the failure [${repairFp.signature}]` : 'cleared the Law (the reviewer rejected on fresh grounds)'} — environmental noise; admitting ONE normal correction (the repair observation never counts as a builder rejection)`)
      } else if (admission.escalate_diagnosis) {
        // identical ASSERTION failure twice — the retry is admitted, but the Sentinel signal
        // strengthens (+1 logical rejection) so escalation/split arrive one cycle sooner.
        logicalRejections++
        log(`${m.id} ${sliceId}: identical assertion failure twice [${curFingerprint.signature}] — escalating diagnosis (+1 logical rejection; the Sentinel reaches escalation/split one cycle sooner)`)
      }
      // The Sentinel section processes the GENUINE outer rejection — on a repair-observed cycle
      // cls/logicalRejections still describe that outer rejection, untouched by the observation
      // (suppressing this call left the admitted correction reviewed by the
      // un-escalated source).
      const esc = escalate(livePosture, { type: 'review_rejection', finding_class: cls, rejections: logicalRejections }, GAUGE_CONFIG)
      livePosture = esc.posture
      if (esc.reason.action === 'split_and_rebuild') {
        // STOP the slice — split-and-rebuild is a conductor/operator decision, never a silent retry.
        splitRequired = true
        log(`${m.id} ${sliceId}: ${logicalRejections} logical rejection(s) — SPLIT REQUIRED; stopping this slice and moving on (the conductor/operator decides the split).`)
        await ledger('posture_escalated', { milestone: m.id, slice: sliceId, signal: esc.reason.signal, action: esc.reason.action, changes: esc.reason.changes, rejections: logicalRejections }, 'The Trial')
        // build.split_required (keystone): the split threshold — an operator decision, never silent.
        await lore('build.split_required', `${m.id} s${qi} stops — ${logicalRejections} logical rejections; SPLIT REQUIRED, the operator decides`, { slice: sliceId, rejections: logicalRejections }, 'The Trial')
        break
      }
      if (esc.reason.action === 'escalate_feedback_source' && !escalated) {
        escalated = true
        log(`${m.id} ${sliceId}: ${logicalRejections} logical rejection(s) — escalating the FEEDBACK SOURCE (${codexAvailable ? 'reviewer family swap' : 'fresh-context stronger effort'}), not the retry count`)
        await ledger('posture_escalated', { milestone: m.id, slice: sliceId, signal: esc.reason.signal, action: esc.reason.action, changes: esc.reason.changes, rejections: logicalRejections }, 'The Trial')
        // build.escalated (volume): the stuck loop gets different eyes — the feedback source escalates.
        await lore('build.escalated', `${m.id} s${qi} — ${logicalRejections} logical rejection(s); escalating the feedback source (${codexAvailable ? 'family swap' : 'stronger effort'})`, { slice: sliceId, rejections: logicalRejections }, 'The Trial')
      }
      // The fix cap — with one exception: a moved repair observation at the cap still
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
      // A failed probe left real artifacts on disk — the reject brief NAMES them (script-assembled
      // from the trial's run id + failed ids) so the builder READS the DOM/console/screenshot evidence
      // before re-attempting (reading artifacts is not browser authority).
      const fixBrief = `Reviewer REJECTED the prior attempt: ${findingLines(mReview).join(' | ') || '(no findings reported — re-verify the mapped checks, recommit, and report honestly)'}. Fix these specifically.${probeArtifactBrief(mReview && mReview.run_id, mReview && mReview.fingerprint && mReview.fingerprint.failed)}`
      mBuild = await agent(buildPrompt(m, surf, slice, sliceId, fixBrief), { label: loreLabel(builderName, 'build', `${sliceId}:fix${fix + 1}`), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })
      attempts++
    }
    gateProv.push({ gate: 'review', slice: sliceId, ...sliceReviewProv })
    if (splitRequired) splitLedger.push({ milestone: m.id, slice: sliceId, sc_ids: slice.sc_ids })
    // A blocked slice rides the splitLedger too, with a DISTINCT class marker:
    // 'environment' = pure infra, the conductor repairs the ENVIRONMENT, not the code;
    // 'mixed' = an infra fault PLUS unresolved product assertion(s) — code work is still owed
    // after the repair (unresolved_assertions names them). Never a plain builder-fixable defect.
    if (environmentBlocked) splitLedger.push({ milestone: m.id, slice: sliceId, sc_ids: slice.sc_ids, class: environmentClass === 'mixed' ? 'mixed' : 'environment', ...(environmentAssertions.length ? { unresolved_assertions: environmentAssertions } : {}) })
    if (approvedOf(mReview)) greenScIds.push(...slice.sc_ids.filter((id) => !greenScIds.includes(id)))
    // The retained fingerprint is the LAST attempt's state that sliceTelemetry forwards to the
    // correction council. An APPROVED slice's decisive trial was GREEN — no failure signature — so it
    // records null; only a rejected/blocked/split slice keeps its last (overcome-or-standing) signature.
    // The loop breaks on approval BEFORE prevFingerprint is cleared, so read approval directly here.
    slices.push({ id: sliceId, objective: slice.objective, sc_ids: slice.sc_ids, files: slice.files || [], done_when: slice.done_when || '', tests_green: mBuild && mBuild.tests_green, review: mReview && mReview.verdict, approved: approvedOf(mReview), split_required: splitRequired, environment_blocked: environmentBlocked, environment_class: environmentClass, environment_assertions: environmentAssertions, logical_rejections: logicalRejections, fingerprint: approvedOf(mReview) ? null : (prevFingerprint ? prevFingerprint.signature : null), attempts })
    // Slice telemetry (note.data.kind — no new event type): DETERMINISTIC fields only. NO
    // elapsed/tokens (Date.now/clocks are forbidden by the runtime determinism guard — timing derives
    // post-hoc from the ledger's own append timestamps). fingerprint = the last attempt's signature.
    await ledger('note', {
      kind: 'slice_telemetry', slice_id: sliceId, surface: surf, builder_model: bModel,
      reviewer_escalated: escalated, attempts, rejection_classes: rejectionClasses,
      fingerprint: prevFingerprint ? prevFingerprint.signature : null,
      first_pass_green: firstPassGreen, environment_blocked: environmentBlocked, split: splitRequired,
    }, 'The Trial')
    // build.slice_sealed (keystone — the heartbeat): the slice committed, gate green, review approved.
    if (approvedOf(mReview)) await lore('build.slice_sealed', `${m.id} s${qi} sealed — flips [${oneLine(slice.sc_ids.join(', '), 80)}] · ${firstPassGreen ? 'first strike true' : `${attempts - 1} fix(es)`}`, { slice: sliceId, flips: oneLine(slice.sc_ids.join(', '), 80), first_pass: firstPassGreen }, 'The Trial')
    qi++
  }
  if (cappedOut) log(`${m.id}: hit the ${MAX_SLICES_PER_MILESTONE}-slice cap — building stopped; validate.js backstops the remainder.`)
  } // end !gateOnly Scoring + Forging

  // ── Judgment — the milestone gate, exact. Aristotle's goal-backward audit runs at EVERY
  //    milestone boundary — split/plan-abort branches included, where the verdict
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
  //    Goal-audit failure semantics: a null/unusable audit is
  //    re-asked ONCE; still unusable → the boundary verdict is QA_FAIL with the blocking finding
  //    'goal-audit-failure' (ledgered) — the judge NEVER spawns on missing inputs, and no
  //    corrective build is spent on an infrastructure failure (nothing in the CODE was found
  //    wrong; the conductor sees the ledger + finding and decides).
  //    The goal_backward posture dial defaults ON; an operator-forced skip is LEDGERED. ──
  phase('Judgment')
  let qa = 'QA_PASS'
  let qaFindings = []
  let qaCycle = 0 // the correction cycle the gate resolved on (tribunal path); 0 on the single-slice/gate-only path — feeds the milestone-close beats

  const splitSlices = slices.filter((s) => s.split_required)
  // An environment-blocked slice is a mechanical QA_FAIL exactly like a split — the milestone
  // cannot pass with an untrustworthy slice, and it must never spend the tribunal on a broken
  // environment. It fails toward v3.0.1: with no fingerprints no slice is ever environment_blocked.
  const envBlockedSlices = slices.filter((s) => s.environment_blocked)
  const goalOn = livePosture.milestone_gate.goal_backward !== false

  // ── Pipelining: launch the NEXT milestone's slice-plan IN PARALLEL with
  //    THIS milestone's gate. The gate is expensive (dual analysts + goal-backward + maybe a judge
  //    + a correction loop) and its agent calls are I/O-bound — the speculative slice-plan call
  //    overlaps that wall-clock for free. We anchor it on base_sha = the HEAD it is cut against;
  //    if the gate then commits a correction, the next milestone's consumer detects the moved HEAD
  //    (pipelineInvalidated) and re-slices. We speculate only when the next milestone exists and
  //    owns Law checks (a no-SC milestone is skipped before it would consume a plan). The launched
  //    promise resolves to planMilestone's { ok, planned, errors }; per-item fault isolation keeps
  //    a thrown speculation from breaking the gate (the consumer falls back to a fresh plan).
  //    NEVER under gateOnly: the gate-only path slices NO milestone, so nothing would
  //    ever consume a speculative plan — launching one would burn a krs-one call for nothing. ──
  const nextM = milestones[milestoneIndex + 1]
  if (!gateOnly && nextM) {
    const nextScs = lawChecks.filter((c) => c.milestone === nextM.id)
    if (nextScs.length) {
      // Churn-aware speculation. If THIS milestone ran hot, its gate will likely
      // commit corrections, move HEAD, and pipelineInvalidated would discard a speculative plan
      // anyway — so hold the next cut instead of burning a krs-one call for nothing. Waste-avoidance
      // ONLY: pipelineInvalidated stays the correctness rail. Re-enables automatically — a calm
      // milestone recomputes admitSpeculation over ITS slices and speculates again with no machinery.
      const spec = admitSpeculation(slices)
      if (!spec.admit) {
        log(`Holding ${nextM.id}'s speculative slice plan — ${m.id} ran hot (${spec.reason}: ${spec.corrections} correction(s) across ${spec.slices} slice(s)); the gate would likely invalidate it`)
        await ledger('note', { kind: 'speculation_disabled', milestone: m.id, next_milestone: nextM.id, reason: spec.reason, corrections: spec.corrections, slices: spec.slices }, 'Judgment')
        // build.speculation_held (Fable-authored, verbatim): the next blade waits for a settled anvil.
        await lore('build.speculation_held', `The forge holds ${nextM.id}'s blade — ${m.id} ran hot (${spec.corrections} correction${spec.corrections === 1 ? '' : 's'} across ${spec.slices} slice${spec.slices === 1 ? '' : 's'}); the next cut waits for a settled anvil.`, { milestone: m.id, next: nextM.id, reason: spec.reason }, 'Judgment')
      } else {
        const base_sha = lastHead
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
  // NEVER classification:null — an unusable-but-non-seat-death first attempt proxies to
  // 'null_result' (there is no usable report to trust either way).
  const auditOrNull = async (suffix, first, firstProv) => {
    const p1 = firstProv || {}
    let g = first === undefined ? await goalAudit(suffix, p1) : first
    let retried = false
    let p = p1
    if (!goalAuditUsable(g)) {
      log(`${m.id}: the goal-backward audit returned no usable report — re-asking ONCE`)
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
      // Honesty: only a PURE-infra block may claim "not the code"; a MIXED block names
      // its unresolved product assertions — code work is still owed after the environment repair.
      ...envBlockedSlices.map((s) => s.environment_class === 'mixed'
        ? `[environment_blocked] ${s.id} "${s.objective}" — a MIXED failure reproduced identically with no code change: the infra fault needs ENVIRONMENT repair, and product assertion(s) remain UNRESOLVED beneath it${s.environment_assertions && s.environment_assertions.length ? ` (${s.environment_assertions.join(', ')})` : ''} — code work is still owed after the repair (SCs not trustworthy: ${s.sc_ids.join(', ')}) — a conductor/operator decision`
        : `[environment_blocked] ${s.id} "${s.objective}" — the same infrastructure/timeout failure reproduced with no code change; repair the ENVIRONMENT, not the code (SCs not trustworthy: ${s.sc_ids.join(', ')}) — a conductor/operator decision`),
      ...(planAborted ? ['[slice_plan] the replanned remainder failed SC coverage — the milestone is incomplete'] : []),
    ]
    log(`${m.id}: QA_FAIL determined mechanically (${splitSlices.length} split-required slice(s)${envBlockedSlices.length ? `, ${envBlockedSlices.length} environment-blocked slice(s)` : ''}${planAborted ? ', aborted slice plan' : ''}) — no tribunal spend (nothing on this branch can pass); the conductor decides.`)
    // The boundary audit still runs on this failed boundary — its findings merge
    // into the failure record (the verdict stays the mechanical QA_FAIL above).
    if (goalOn) {
      const goal = await auditOrNull(`${m.id}:failed`)
      if (goal) qaFindings.push(...denzelReconcile(goal, null).summaryLines)
      else qaFindings.push(GOAL_AUDIT_FAILURE)
    } else await skipAudit()
  } else if (forceTribunal || tribunalThreshold(slices.length, livePosture.milestone_gate.min_slices_for_tribunal)) {
    // forceTribunal (gateOnly): the historical slice count is unknown to a fresh session,
    // so route CONSERVATIVELY to the FULL tribunal regardless of min_slices_for_tribunal — fail
    // toward scrutiny, gate-only never lowers the gate.
    if (!goalOn) await skipAudit()
    for (let c = 0; c <= MAX_TRIBUNAL_CORRECTION; c++) {
      // gateAgent: a mute analyst degrades to null — denzelReconcile is null-safe and gateDecision
      // reads an unreadable overall as QA_FAIL (fail-closed), never a silent pass.
      const kenProv = {}, ryuProv = {}
      // At T4 the receipt-attested Sol evidence analyst REPLACES the prompt-delegated Ryu leg
      // (analyst B) — xhigh, read-only, judging from repo reads + the runner's PERSISTED hashed
      // evidence (the packet names NO analyst-A artifact — blind independence holds). Sub-T4 keeps the
      // byte-identical prompt-delegated sonnet Ryu.
      // The Sol evidence analyst judges the NAMED per-milestone/cycle artifacts (derived
      // SCRIPT-SIDE from the last trial's run id + this milestone's probe SCs — never model-recalled):
      // law.json, the run dir's results/suite files, and the probe artifacts where a UI probe ran. The
      // evidence-dir root alone is not a packet — stale or unrelated evidence must not be selectable.
      // suite.log/suite.jsonl are named IFF the build recorded a project suite — the exact
      // `suite = build.test_command` skip-branch state (mBuild is the trial's build config),
      // reused SCRIPT-SIDE so the analyst's named list and the close anchor's named list never disagree.
      const suiteRecorded = !!(mBuild && mBuild.test_command)
      // Recorded-probe derivation: ONE Thoth transcription leg runs PROBE_EXECUTED_ONELINER
      // over this milestone's last trial results.jsonl; the SCRIPT intersects the printed ids with the
      // milestone's probe SCs. This is the SINGLE derivation of the executed-probe id set — it feeds BOTH
      // the Sol analyst's named evidence_artifacts (below) AND the close anchor's hashed manifest (passed to
      // runCloseCouncil), so the two named lists are the SAME variable and can never disagree. A
      // deferred/spec-less probe left no artifacts and is named NOWHERE (its results.jsonl row carries
      // `deferred`, not an exit). Gated on councilCapable + real milestone probe
      // SCs, so logic-only milestones and sub-T4 dispatch NO leg (byte-preserved). Fail-closed: a
      // dead/garbled leg ⇒ [] ⇒ nothing extra named or bound (the honest under-naming direction).
      const mProbeScIds = mScIds.filter((id) => probeScIds.has(id))
      let executedProbeIds = []
      if (councilCapable && mProbeScIds.length && typeof lastRunId === 'string' && lastRunId.trim()) {
        const probeExec = await agent(probeExecPrompt(`${kilnDir}/evidence/${lastRunId}/results.jsonl`), { label: `thoth:probe-exec:${m.id}:c${c}`, phase: 'Judgment', model: 'haiku', schema: PROBE_EXEC_SCHEMA })
        const ran = probeExec && Array.isArray(probeExec.executed_ids) ? probeExec.executed_ids : []
        executedProbeIds = ran.filter((id) => typeof id === 'string' && probeScIds.has(id))
      }
      const analystEvidence = [lawFile].concat(trialEvidencePaths(lastRunId, suiteRecorded)).concat(probeEvidencePaths(lastRunId, executedProbeIds))
      const solAnalyst = councilCapable ? solWrapperPlan({
        councilDir: mCouncilDir, pluginRoot, receiptsLedger, runToken: runTokenRaw, keystone: `milestone_close:${m.id}`, transportModel: CODEX_MODEL,
        phaseTag: `QA_EVIDENCE_C${c}`, attempt: 1, effort: 'xhigh', payloadSchema: SOL_QA_PAYLOAD_SCHEMA,
        taskText: 'You are QA analyst B — an independent, read-only second perspective ruling from the persisted evidence.',
        briefBody: `Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}.\nJudge from (a) repo reads at ${projectPath} (git log/diff, read the files; you run READ-ONLY and cannot run the suite) and (b) the deterministic runner's PERSISTED hashed evidence — the NAMED artifacts for THIS milestone's last trial (read EXACTLY these; do not select stale or unrelated evidence):\n${analystEvidence.map((p) => `  - ${p}`).join('\n')}\nThat is law.json + the last trial's results.jsonl/run.json (plus suite.log/suite.jsonl when a project suite was recorded) + the probe-<SC>.json/.log where a UI probe ran. Hunt "checks pass, goal broken": acceptance met by the letter but broken in spirit, slices that pass alone but never connect, hardcoded/stub behavior behind a green check. Return findings[] (each {text, severity}) and overall ('fail' MUST carry at least one critical|high finding), and report_markdown = the FULL qa-report-b content.`,
        packetObj: { milestone: { id: m.id, title: m.title, acceptance: m.acceptance }, evidence_artifacts: analystEvidence, project: projectPath },
        extractTo: `${qaDir}/qa-report-b.md`, extractField: 'report_markdown', extractLabel: 'report',
      }) : null
      const legs = [
        () => gateAgent(kenPrompt(m), { label: loreLabel('ken', 'qa', `${m.id}:c${c}`), phase: 'Judgment', model: 'opus', schema: QA_FINDINGS_SCHEMA, provenance: kenProv }),
        councilCapable
          ? () => gateAgent(solAnalyst.prompt, { label: loreLabel('ryu', 'qa', `${m.id}:c${c}`), phase: 'Judgment', model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(SOL_QA_PAYLOAD_SCHEMA), provenance: ryuProv })
          : councilMisconfigured
            // The fail-open catch: promised-but-tokenless ⇒ analyst B is a DEAD SEAT. NEVER
            // dispatch the legacy receiptless Ryu — reports[1] stays null so the reconcile arithmetic
            // fails the boundary CLOSED (unreadable overall ⇒ QA_FAIL) BEFORE any computed pass.
            ? () => null
            : () => gateAgent(ryuPrompt(m), { label: loreLabel('ryu', 'qa', `${m.id}:c${c}`), phase: 'Judgment', model: 'sonnet', schema: QA_FINDINGS_SCHEMA, provenance: ryuProv }),
      ]
      const goalProvC = {}
      if (goalOn) legs.push(() => goalAudit(`${m.id}:c${c}`, goalProvC))
      const reports = await parallel(legs)
      // Cross-check: the Sol analyst's structural receipt gets the invocation-exact ledger upgrade;
      // a dead/receiptless seat or a failed cross-check ⇒ null report (fail-closed EVIDENCE — the
      // null-safe reconcile then reads an unreadable overall as QA_FAIL, never a silent pass).
      if (councilCapable) {
        let cross = { ledger_verified: false }
        if (reports[1] != null && ryuProv.receipt_verified === true) cross = await runSolCrossCheckB(`ryu:${m.id}:c${c}`, `milestone_close:${m.id}`, `QA_EVIDENCE_C${c}`, solAnalyst.files.out, ryuProv, reports[1], 'Judgment')
        pushCouncilReceipt(mCouncilReceipts, `ryu:${m.id}:c${c}`, ryuProv, cross)
        if (!(reports[1] != null && ryuProv.receipt_verified === true && cross.ledger_verified === true)) {
          log(`${m.id}: Sol evidence analyst seat DEAD (receipt/cross-check) — analyst B report is null; the gate fails closed via the reconcile arithmetic`)
          reports[1] = null
        }
      } else if (councilMisconfigured) {
        // Analyst B was NOT dispatched (dead seat). Force reports[1] null, mark an honest gateProv
        // row + the milestone_close seat DEGRADED, and log the misconfiguration. The reconcile then reads
        // an unreadable overall ⇒ QA_FAIL (fail-closed) BEFORE any computed pass — with ZERO legacy Ryu calls.
        reports[1] = null
        mCloseTerminal = 'DEGRADED'
        mCloseSeatConvened = true
        Object.assign(ryuProv, { requested_model: 'sonnet', actual_model: null, fallback_reason: 'council_misconfigured_no_token', classification: 'dead_seat' })
        log(`${m.id}: Sol evidence analyst seat DEAD — councilPromised (T4 + codex) but NO runToken (misconfigured conductor); analyst B is a dead seat (NO legacy Ryu dispatched), the gate fails CLOSED via the reconcile arithmetic`)
      }
      gateProv.push({ gate: 'ken', cycle: c, ...kenProv }, { gate: 'ryu', cycle: c, ...ryuProv })
      // Goal-audit failure semantics: an unusable audit leg is re-asked
      // ONCE; still unusable → QA_FAIL with the blocking 'goal-audit-failure' finding — the
      // judge NEVER spawns on missing inputs, and the correction loop ends (an infrastructure
      // failure is not a code defect a corrective build can fix).
      let goal = null
      if (goalOn) {
        goal = await auditOrNull(`${m.id}:c${c}`, reports[2], goalProvC)
        if (!goal) {
          qa = 'QA_FAIL'
          qaCycle = c
          qaFindings = [GOAL_AUDIT_FAILURE, ...denzelReconcile(reports[0], reports[1]).summaryLines]
          log(`${m.id}: QA_FAIL — ${GOAL_AUDIT_FAILURE}`)
          break
        }
      }
      // The audit's findings JOIN the reconcile — denzelReconcile is a pure associative
      // merge (dedupe by normalized text, max severity wins), so folding the third report
      // through a second pass is exact, not approximate.
      const reconciled = denzelReconcile(denzelReconcile(reports[0], reports[1]), goal)
      qaFindings = reconciled.summaryLines
      log(`${spin('qa', c)} — ${m.id}: Denzel reconciles — ${reconciled.findings.length} finding(s), ${reconciled.blocking.length} blocking${goalOn ? ' (goal-backward joined the reconcile)' : ''}`)
      // Judge-spawn condition, computed in-script (gateDecision) over USABLE inputs only —
      // the unusable-audit branch above already failed closed without reaching here.
      const decision = gateDecision(reconciled, reports[0] && reports[0].overall, reports[1] && reports[1].overall)
      let v
      if (decision.judge) {
        if (councilCapable) {
          // The milestone-close ratification pair RETIRES Judge Dredd at T4 on this exact ambiguous
          // branch (zero blocking + disagreeing analyst overalls). Red monotonicity is STRUCTURAL — a
          // deterministic QA_FAIL never reaches here, so a council cannot green a red gate.
          const goalOverall = goal && goal.overall != null ? goal.overall : null
          const close = await runCloseCouncil(m, reconciled, reports[0] && reports[0].overall, reports[1] && reports[1].overall, goalOverall, c, gateProv, mCouncilDir, mCouncilReceipts, lastRunId, suiteRecorded, executedProbeIds)
          v = close.qa
          mCloseTerminal = close.terminal
          mCloseCertificate = close.certificate
          mCloseFindings = close.terminal === 'BLOCKED' ? close.findings : []
          mCloseBundleHash = close.bundle_hash
          mCloseReceiptVerified = close.receipt_verified
          mCloseLedgerVerified = close.ledger_verified
          mCloseSeatConvened = true
          if (close.terminal === 'DEGRADED' && close.terminal_record && (close.terminal_record.missing === 'fable' || close.terminal_record.missing === 'sol')) mCouncilMissingHead = close.terminal_record.missing
          if (v === 'QA_FAIL') qaFindings = [...reconciled.summaryLines, ...mCloseFindings.map(closeFindingLine), ...(close.terminal === 'DEGRADED' ? [`[close_council] milestone-close council DEGRADED (${close.terminal_record && close.terminal_record.missing}) — fail-closed, no judge fallback at T4`] : [])]
        } else if (councilMisconfigured) {
          // Promised-but-tokenless — the judgment SEAT fails closed (never a silent Judge Dredd
          // downgrade).
          v = 'QA_FAIL'
          mCloseTerminal = 'DEGRADED'
          qaFindings = [...reconciled.summaryLines, '[close_council] milestone-close council PROMISED (T4 + codex) but the conductor minted no runToken — the ruling fails closed (QA_FAIL, DEGRADED); relaunch with the per-run token']
          log(`${m.id}: milestone-close judgment seat fails CLOSED — councilPromised but no runToken (misconfigured conductor); no Judge Dredd downgrade`)
        } else {
          // Sub-T4 / no-codex: the v3.0.1 single-Opus Judge Dredd, byte-identical.
          log(`${m.id}: ${decision.reason} — Judge Dredd is spawned`)
          const judgeProv = {}
          const verdict = await gateAgent(judgePrompt(m, reconciled), { label: loreLabel('judge-dredd', 'verdict', `${m.id}:c${c}`), phase: 'Judgment', model: 'opus', schema: VERDICT_SCHEMA, provenance: judgeProv })
          gateProv.push({ gate: 'judge', cycle: c, ...judgeProv })
          v = (verdict && verdict.verdict === 'QA_PASS') ? 'QA_PASS' : 'QA_FAIL' // a dead/mute judge fails closed
        }
      } else {
        v = decision.verdict
        log(`${m.id}: ${decision.reason}`)
      }
      if (v === 'QA_PASS') { qa = 'QA_PASS'; qaCycle = c; log(`${m.id}: QA_PASS (milestone gate, cycle ${c})`); break }
      if (c === MAX_TRIBUNAL_CORRECTION) { qa = 'QA_FAIL'; qaCycle = c; log(`${m.id}: QA_FAIL after ${c} correction(s) — escalating to validate`); break }
      // The REQUIRED correction council over retry | escalate | replan runs BEFORE the sole
      // corrective build — the routing decision is a council ruling, not an unconditional build. The
      // frozen close_council_findings ride the packet. Split/dead/invalid ⇒ fail-closed
      // ESCALATE. Sub-T4 keeps the v3.0.1 unconditional corrective build byte-identical.
      if (councilCapable) {
        // The correction packet carries per-slice fingerprints + attempts (retained on the slice
        // records at their push) alongside logical_rejections/splits/env — the telemetry the route needs.
        const sliceTelemetry = slices.map((s) => ({ id: s.id, logical_rejections: s.logical_rejections, fingerprint: s.fingerprint != null ? s.fingerprint : null, attempts: s.attempts != null ? s.attempts : null, split_required: !!s.split_required, environment_blocked: !!s.environment_blocked, tests_green: s.tests_green !== false }))
        const corr = await runCorrectionCouncil(m, reconciled, mCloseFindings, sliceTelemetry, c, gateProv, mCouncilDir, mCouncilReceipts)
        mCorrectionRuling = corr.choice
        mCorrectionTerminal = corr.terminal
        mCorrectionBundleHash = corr.bundle_hash
        mCorrectionReceiptVerified = corr.receipt_verified
        mCorrectionLedgerVerified = corr.ledger_verified
        mCorrectionSeatConvened = true
        if (corr.degraded && (corr.missing === 'fable' || corr.missing === 'sol')) mCouncilMissingHead = corr.missing
        // The correction heads' RETAINED findings + reasons ride qaFindings verbatim on ESCALATE/REPLAN.
        if (corr.choice === 'ESCALATE') { qa = 'QA_FAIL'; qaCycle = c; qaFindings = [...reconciled.summaryLines, ...mCloseFindings.map(closeFindingLine), ...correctionRulingLines(corr), `[correction_council] the correction council ruled ESCALATE${corr.degraded ? ` (fail-closed: ${corr.missing} seat dead — DEGRADED)` : (corr.terminal === 'BLOCKED' ? ' (fail-closed: a live legal split — BLOCKED)' : '')} — validate backstops; the conductor sees the ruling`]; log(`${m.id}: correction council ESCALATE (terminal ${corr.terminal}) — QA_FAIL stands, validate backstops`); break }
        if (corr.choice === 'REPLAN') { qa = 'QA_FAIL'; qaCycle = c; mReplanRequired = true; qaFindings = [...reconciled.summaryLines, ...mCloseFindings.map(closeFindingLine), ...correctionRulingLines(corr), '[correction_council] the correction council ruled REPLAN — the milestone plan itself is wrong; a conductor/operator re-plan is owed (replan_required)']; log(`${m.id}: correction council REPLAN — QA_FAIL + replan_required marker (never silent)`); break }
        log(`${m.id}: correction council RETRY — proceeding to the sole corrective build`)
      } else if (councilMisconfigured) {
        // Promised-but-tokenless — the correction ROUTING fails closed to ESCALATE (never a
        // corrective build spent under a council that could not convene); the seat is honestly DEGRADED.
        qa = 'QA_FAIL'; qaCycle = c; mCorrectionRuling = 'ESCALATE'; mCorrectionTerminal = 'DEGRADED'; mCorrectionSeatConvened = true
        qaFindings = [...reconciled.summaryLines, '[correction_council] correction council PROMISED (T4 + codex) but no runToken — fail-closed ESCALATE; relaunch with the per-run token']
        log(`${m.id}: correction council fails CLOSED (misconfigured conductor) — ESCALATE, no corrective build`)
        break
      }
      // One corrective build + the SAME evidence-first trial (runner → gates → cross-family review),
      // then re-gate once. The correction is milestone-wide, so it maps to ALL milestone SCs —
      // and its trial's flip plan covers them all (already-green SCs fold into the regression
      // guard, red ones into the expected flips; statusBefore is the recorded last run).
      // A milestone-gate correction over probe-covered SCs inherits the last complete trial's
      // on-disk probe artifacts (script-assembled, never model-recalled), so the correction builder
      // reads the real DOM/console/screenshot evidence before re-attempting. Scope:
      // when the decisive trial's failure set is KNOWN (mReview carries a real fingerprint), name
      // only its FAILED probe SCs; fall back to the milestone's full probe-SC set only when it isn't.
      const lastFp = fpOrNull(mReview && mReview.fingerprint)
      const lastTrialRunId = (mReview && typeof mReview.run_id === 'string' && mReview.run_id) ? mReview.run_id : lastRunId
      // The sole corrective build's fixNote carries the frozen close_council_findings
      // (IDs + refs verbatim) alongside the reconciled summary — never spent blind to what blocked the close.
      const fixNote = `Milestone gate QA_FAIL. Fix every blocking finding, keep tests green, recommit:\n${[...reconciled.summaryLines, ...mCloseFindings.map(closeFindingLine)].join('\n')}${probeArtifactBrief(lastTrialRunId, lastFp ? lastFp.failed : mScIds)}`
      const correctionSlice = { objective: `Milestone-gate correction for ${m.id} — fix every blocking finding`, files: [], constraints: '', done_when: m.acceptance, sc_ids: mScIds }
      phase('Forging')
      log(`${spin('build', c)} — ${m.id} gate correction ${c + 1}`)
      mBuild = await agent(buildPrompt(m, surf, correctionSlice, `${m.id}:correct${c + 1}`, fixNote), { label: loreLabel(builderName, 'build', `${m.id}:correct${c + 1}`), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })
      const correctReviewProv = {}
      mReview = (await evidencedReview(m, surf, correctionSlice, `${m.id}:correct${c + 1}`, mBuild, 0, false, reviewerName, { flips: mScIds, only: mScIds }, correctReviewProv, { tamperFired: false })) || mReview
      gateProv.push({ gate: 'review', slice: `${m.id}:correct${c + 1}`, ...correctReviewProv })
      phase('Judgment')
    }
  } else if (slices.length >= 1) {
    // Single-slice row (and any posture-raised threshold): the cross-family slice review +
    // the goal-backward audit IS the gate — tribunal redundancy skip, never an unaudited pass.
    // Fail closed: an unusable audit is re-asked ONCE, then the gate
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
  // gateOnly: nothing was sliced or built — "was just built" would be a lie, and there is
  // no next-milestone slicer to feed (gate-only re-runs a gate over an already-complete build).
  if (!gateOnly) {
    phase('The Forge Heats')
    await agent(
      `You are the codebase-state authority. ${scope} ${repoRuleLine}\n\n` +
      `<task>Milestone ${m.id} ("${m.title}") was just built. Update ${codebaseStateFile}: what now exists (modules, public surface) so the next milestone's slicer and builder have accurate context. Read 'git -C ${projectPath} log --oneline -8' and 'git -C ${projectPath} show --stat HEAD' for what changed.</task>`,
      { label: loreLabel('rakim', 'state', m.id), phase: 'The Forge Heats', model: 'haiku' }
    )
  }

  // The milestone's gate-leg provenance rides the EXISTING gate_decision ledger type (in the
  // enum, previously unemitted by a workflow — no new type minted) so every degradation/substitution
  // on a review, tribunal analyst, judge, or goal-backward leg is recorded durably at the boundary.
  // A council SUMMARY rides the same event on the T4 path (honest terminals for the
  // conductor's blocked/degraded hard stop) — omitted entirely off the council path (byte-preserved).
  // The gate_decision council field is an ARRAY of per-seat summaries (one per convened OR
  // failed-closed seat — milestone_close and correction), each EXACTLY {seat, terminal, bundle_hash,
  // certificate_present, receipt_verified, ledger_verified}. bundle_hash is the COMPUTED record hash
  // (present for BLOCKED/DEGRADED rulings too — never derived from the certificate). The receipts list
  // rides gate_decision as a SEPARATE council_receipts key.
  const councilSeats = []
  if (mCloseSeatConvened) councilSeats.push({ seat: 'milestone_close', terminal: mCloseTerminal, bundle_hash: mCloseBundleHash, certificate_present: !!mCloseCertificate, receipt_verified: mCloseReceiptVerified, ledger_verified: mCloseLedgerVerified })
  if (mCorrectionSeatConvened) councilSeats.push({ seat: 'correction', terminal: mCorrectionTerminal, bundle_hash: mCorrectionBundleHash, certificate_present: false, receipt_verified: mCorrectionReceiptVerified, ledger_verified: mCorrectionLedgerVerified })
  if (gateProv.length) await ledger('gate_decision', { milestone: m.id, qa, gate_provenance: gateProv, ...(councilPromised && councilSeats.length ? { council: councilSeats } : {}), ...(councilPromised && mCouncilReceipts.length ? { council_receipts: mCouncilReceipts } : {}) }, 'Judgment')

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
    // The council terminals ride the milestone result so the workflow return + conductor's
    // blocked/degraded hard stop see honest terminals. Present only on the council-promised path.
    ...(councilPromised ? { council: { close_terminal: mCloseTerminal, correction_terminal: mCorrectionTerminal, correction_ruling: mCorrectionRuling, replan_required: mReplanRequired, certificate: mCloseCertificate, council_missing_head: mCouncilMissingHead } } : {}),
  })
  // build.milestone_sealed / build.milestone_fail (keystones): the boundary verdict.
  const remainingMilestones = milestones.length - 1 - milestoneIndex
  if (qa === 'QA_PASS') await lore('build.milestone_sealed', `${m.id} falls — QA_PASS, cycle ${qaCycle}; ${remainingMilestones} milestone(s) stand`, { milestone: m.id, cycle: qaCycle, remaining: remainingMilestones }, 'Judgment')
  else await lore('build.milestone_fail', `${m.id} holds the gate — QA_FAIL after ${qaCycle} correction(s); validate backstops`, { milestone: m.id, cycle: qaCycle }, 'Judgment')
}

  const passed = results.filter((r) => r.qa === 'QA_PASS' && r.tests_green)
  const allPassed = passed.length === results.length && results.length > 0
  // The closing bow distinguishes the three splitLedger classes — a code split awaits
  // an operator SPLIT decision; a pure-infra block awaits ENVIRONMENT repair (not code); a mixed
  // block awaits both (environment repair + the unresolved assertions still need code work).
  const codeSplits = splitLedger.filter((e) => !e.class)
  const envBlocks = splitLedger.filter((e) => e.class === 'environment')
  const mixedBlocks = splitLedger.filter((e) => e.class === 'mixed')
  log(`The orchestra takes a bow — ${passed.length}/${results.length} milestone(s) passed QA${codeSplits.length ? ` · ${codeSplits.length} slice(s) await an operator split decision` : ''}${envBlocks.length ? ` · ${envBlocks.length} slice(s) blocked on ENVIRONMENT repair (not code)` : ''}${mixedBlocks.length ? ` · ${mixedBlocks.length} slice(s) blocked MIXED (environment repair + unresolved assertions still owed code work)` : ''}`)
  // build.bow (keystone): the forge stage closes — the honest tally, with straight tails.
  await lore('build.bow', `The orchestra takes a bow — ${passed.length}/${results.length} milestone(s) passed QA${codeSplits.length ? ` · ${codeSplits.length} split(s) await the operator` : ''}${envBlocks.length ? ` · ${envBlocks.length} env-blocked` : ''}${mixedBlocks.length ? ` · ${mixedBlocks.length} mixed-blocked` : ''}`, { passed: passed.length, total: results.length, splits: codeSplits.length, env_blocked: envBlocks.length, mixed_blocked: mixedBlocks.length }, 'Judgment')
  // Stage bracket: the build stage COMPLETES only when every milestone passed its
  // gate. A QA_FAIL / refusal / gate-only-on-red leaves the projection at 'build' (accurate — the
  // conductor re-enters via the correction loop or a gate-only retry). Fail-open like every ledger leg.
  if (allPassed) await ledger('stage_completed', { stage: 'build', milestones: results.length, passed: passed.length }, 'Judgment')
  // A dual-APPROVE legacy retrospective ratification rides the build return's council
  // field (the retrospective certificate + the legacy_authority marking) — the plan advanced BECAUSE the
  // council ratified it; the conductor sees the honest terminal. Absent off the legacy path.
  return { built: results, passed: passed.map((r) => r.id), all_passed: allPassed, law_gated: true, split_required: splitLedger, ...(legacyCouncil ? { council: legacyCouncil } : {}) }
} finally {
  // Stage-end sweep: UNCONDITIONAL at build end — reaps THIS build's browser survivors
  // (an outer-deadline SIGKILL of a probe wrapper, a crashed run mid-probe) before the stage hands
  // off. kiln-law's per-run brackets are the inner defense; this is the OUTER one, run-token
  // scoped to BUILD_RUN_TOKEN. The sweep is itself try/guarded so a cleanup failure can never mask
  // a real build error propagating out of the try.
  try { await stageSweep('stage-end') } catch (e) { log(`stage-end browser sweep failed (non-fatal): ${e && e.message ? e.message : e}`) }
}
