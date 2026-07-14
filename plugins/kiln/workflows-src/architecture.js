export const meta = {
  name: 'kiln-architecture',
  description: 'Kiln architecture stage: foundation docs, then (for non-trivial scope) two anonymized plans (Claude ∥ Codex), divergence extraction, and chairman synthesis into master-plan.md, validated with a bounded fix loop. Right-sizes to a lite single-plan path for trivial scope. Tags every milestone with a build surface (ui/logic/mixed) so build routes models per slice, and requires acceptance criteria written as EXECUTABLE checks (validate exercises them literally).',
  phases: [
    { title: 'Laying Stone', detail: 'numerobis writes architecture/tech-stack/constraints docs from VISION + research' },
    { title: 'The Council', detail: 'two anonymized planners (Claude slot-a ∥ Codex slot-b) write plan-a.md / plan-b.md' },
    { title: 'The Lantern', detail: 'diogenes extracts consensus / divergences / unique insights' },
    { title: 'One From Many', detail: 'plato writes master-plan.md with confidence tiers + surfaces + executable acceptance criteria' },
    { title: 'Athena Weighs', detail: 'athena validates; plato revises (≤2 rounds) on FAIL' },
    { title: 'The Law', detail: 'asimov compiles ONE executable check per SC (tests/acceptance/ + law.json); every check dry-runs pre-lock (athena rules honest-red vs broken-check over the executed transcript; asimov fixes broken checks AND his own schema-invalid law — typed violations route back, never dead-end); probe twins are checked embedded-vs-on-disk at dryrun and index; the lock leg pre-flights the git baseline (no .git ⇒ init + baseline commit — the disk decides, never the flag); kiln-law indexes; the gates lock in their own commit' },
  ],
}

// ── args: { kilnDir, projectPath, mode, testingRigor, codexAvailable, planning, validationRounds, lawModel, pluginRoot, runToken, capabilityTier } ──
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
const PAYLOAD_FIRST = 'Your ENTIRE final message is ONE StructuredOutput tool call — no prose before or after it. Emit the payload properties FIRST; reasoning is the LAST property, OPTIONAL, and under 50 words — put detail in the designated report file or field, never in reasoning. A long leading reasoning string is the observed death mode: the call truncates before the payload lands, the validator rejects it, each rejection burns one of five attempts, and five failures kill this leg.'
const kilnDir = A.kilnDir
if (!kilnDir) throw new Error('architecture.js requires args.kilnDir (absolute path to .kiln). Received args of type ' + typeof args)
const codexAvailable = A.codexAvailable !== false // default true; conductor passes kiln-doctor's probe result
const testingRigor = A.testingRigor || 'standard'
// projectPath is the project repo root — the Law's checks live there (tests/acceptance/ is
// project-native, the gates ship with the product) and the lock commit lands there. Absent ⇒ the
// Law cannot be compiled; the stage returns law_locked:false + reason (conductor escalates).
const projectPath = A.projectPath
// lawModel: the §8 slot for Asimov the Lawgiver (default 'opus' — the workhorse; the conductor
// may pass another slot per capability tier).
const lawModel = A.lawModel || 'opus'
// pluginRoot is the conductor-resolved absolute $CLAUDE_PLUGIN_ROOT (a launched Workflow cannot
// see the env var). It locates the kiln-law CLI for the index/lock step; absence degrades to
// law_locked:false + reason — never a silent proceed, never a stage crash.
const pluginRoot = A.pluginRoot
// planning is the Gauge's posture.planning (BLUEPRINT §3.2 planning row): 'dual' | 'single+redteam'
// | 'single', passed by the conductor. It decides whether The Council (two anonymized plans +
// divergence) runs or the single-plan chairman path is taken. Absent ⇒ null ⇒ the historical
// decider (foundation.scope === 'trivial') stands unchanged, so a run without a posture behaves
// exactly as before. 'dual' ⇒ run the council; 'single' ⇒ single-plan chairman path.
//
// SCOPE NOTE — 'single+redteam' routes like 'single' here, BY DESIGN, in P1. T3 is the minimal
// conductor-wiring task ("full skill rewrite is P6", tasks.md §T3); the cross-family red-team
// critique that the posture names is build-spine machinery scheduled by BLUEPRINT §16 for a later
// phase (P2/P6), not a P1 deliverable. The arg is recognised, carried, and routed to the correct
// (single-plan) base path now; the critique LANDS in its scheduled phase. Implementing an
// un-reviewed cross-family critique inside P1 would be re-architecting outside the task contract,
// which the operator mandate forbids — so the deferral is deliberate and recorded, not an omission.
const planning = (A.planning === 'dual' || A.planning === 'single+redteam' || A.planning === 'single') ? A.planning : null
// validationRounds is the Gauge's posture.plan_validation_rounds (BLUEPRINT §3.2 plan-validation
// row, `1 + (D2>=1) + (D8=2)`). The BLUEPRINT names it the count of Athena VALIDATION PASSES — NOT
// the revision count: posture rounds=1 means exactly ONE athena pass (zero plato revisions),
// rounds=2 means two passes (≤1 revision), etc. Absent ⇒ null ⇒ the historical pass count below
// (2 on the lite path, 3 otherwise, matching v2). A positive integer arg overrides it; garbage is
// ignored.
const validationRoundsArg = (Number.isInteger(A.validationRounds) && A.validationRounds > 0) ? A.validationRounds : null
// visualDirection (P4 T4 / r1 F6): the conductor threads vision.js's validator-parsed
// visual_direction. When boolean it IS has_visual_direction — the decline-byte check lives in the
// vision gate now, so the foundation agent is NOT consulted for it. Absent (pre-v3 VISION, harness
// runs, a resume without the return) ⇒ null ⇒ the foundation agent judges it as the fallback, given
// the EXACT decline bytes (src/vision.mjs DECLINE_LINE, quoted — a workflow cannot import it).
const visualDirection = (typeof A.visualDirection === 'boolean') ? A.visualDirection : null
// ── Twin Council args (v3.0.2 B4-1b-ii; FC-1 tier-gating). The council path REPLACES the v3.0.1
// draft/ratify machinery ONLY when the capability record promised BOTH heads (T4 = fable + codex)
// AND the conductor minted a runToken. Lite path and T1–T3 run the v3.0.1 machinery BYTE-IDENTICAL,
// capability-honestly labeled (never twin_ratified, never a council claim). A PROMISED council
// missing its runToken is NOT a clean v3.0.1 run — see councilPromised below. runToken is the
// conductor's per-run token (same recipe Build/Validate use); architecture uses it for the council
// SEED + the receipt-invocation binding, NEVER for browser kills. capabilityTier is T1|T2|T3|T4 from
// the freshest capability record (state.json.capability.tier); anything else ⇒ null. ──
const runToken = (typeof A.runToken === 'string' && A.runToken.length > 0) ? A.runToken : null
const capabilityTier = (A.capabilityTier === 'T1' || A.capabilityTier === 'T2' || A.capabilityTier === 'T3' || A.capabilityTier === 'T4') ? A.capabilityTier : null
// councilPromised = the capability record PROMISED both heads (T4 + codex); councilCapable adds the
// conductor-minted runToken. A PROMISED council missing its token is a MISCONFIGURED conductor — on
// the FULL path the council rules DEGRADED and the Law is BLOCKED (scope ruling item 6: a promised
// guarantee never silently downgrades to a clean v3.0.1 label); lite and sub-T4 routes are untouched.
const councilPromised = capabilityTier === 'T4' && codexAvailable
const councilCapable = councilPromised && typeof A.runToken === 'string' && A.runToken.length > 0
if (councilPromised && !runToken) {
  log('MISCONFIGURED CONDUCTOR — capability tier T4 with both heads reachable but NO runToken: the twin council cannot bind its receipts/seed. On the full path the council terminal is DEGRADED and the Law is BLOCKED (never a silent v3.0.1 downgrade). Relaunch with the per-run token to convene the council.')
}

const docsDir = `${kilnDir}/docs`
const plansDir = `${kilnDir}/plans`
const designDir = `${kilnDir}/design`
const visionFile = `${docsDir}/VISION.md`
const researchFile = `${docsDir}/research.md`
const masterPlanFile = `${kilnDir}/master-plan.md`
const handoffFile = `${kilnDir}/architecture-handoff.md`
// Historical Athena validation-PASS counts (BLUEPRINT §3.2 — a "round" is one validation pass,
// not one revision). v2 ran `round 0..2` on the full path (3 passes / ≤2 revisions) and `round 0..1`
// on the lite path (2 passes / ≤1 revision); these preserve that exactly when no posture arg is given.
const FULL_VALIDATION_PASSES = 3
const LITE_VALIDATION_PASSES = 2

// @inline:guards:NO_WANDER
const noWander = NO_WANDER

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
// @inline:voice:MODEL_VOICE,voice
// ── Codex model pins (CODEX_MODEL default + CODEX_FALLBACK, inlined from src/models.mjs) ──
// @models
// ── The single gateAgent (+ receipt attestation) — whole src/gate.mjs inlined verbatim (like build/
//    validate). The Twin Council's Sol seats are Sonnet wrappers over transport:'codex'; gateAgent
//    STRUCTURALLY validates the relayed receipt and fails a dead Sol seat closed to null. ──
// @gate
// ── Twin Council pure core (constitution twin-council.md; sol-b34-design §B3) — the deterministic
//    council machinery inlined from src/council.mjs. Every function that CALLS another travels WITH it
//    in ONE marker (buildDivergenceSet is B3, not inlined here). ──
// @inline:council:COUNCIL_PROTOCOL_VERSION,sha256Hex,canonicalJson,councilSeed,deriveId,claimTypeForClass,compareEvidence,validateReversal,buildDecisionBundle,bundleHash,validateRatification,councilSignature,verifySignature,buildCheckpoint,twinRatified,councilDeadlock,degraded
// The wrapper TRANSLATES (Goal/Context/Constraints/Done-when); it never forwards a Claude brief verbatim.
const codexHowto = `Delegate authoring to ${CODEX_MODEL}: TRANSLATE this brief into a 4-part Codex prompt — Goal (the deliverable in 1-2 sentences), Context (the file paths + summary; no full dumps), Constraints (the arch-constraints + "do X instead of Y"), Done-when (the file written + what it must contain) — write it to a fresh temp file ('TMP="$(mktemp /tmp/kiln-codex.XXXXXX.md)"'; a fixed path collides across concurrent runs) and pipe via stdin: 'codex exec -m ${CODEX_MODEL} -c model_reasoning_effort="high" --sandbox workspace-write --skip-git-repo-check < "$TMP"'. Do NOT forward this brief verbatim. If ${CODEX_MODEL} is unavailable retry with -m ${CODEX_FALLBACK}; if codex errors or yields nothing usable, author the plan yourself.`
// SPIN flattened per C1 §6 — dead single-shot entries removed and the best writing promoted into the
// beats below: 'The geometry never lies' → the foundation_laid beat, 'One map of truth emerges' →
// architecture.plan_synthesized, 'The gates lock before the first brick is laid' →
// architecture.law_locked. The council row keeps only the fallback-honest ternary (dead behind
// literal 0 before). Duplicate transition/phase-title and lore.json-fragment lines dropped.
const SPIN = {
  foundation: ['Numerobis drafts the constraints'],
  council: [codexAvailable ? 'Sun Tzu is flanking the requirements' : 'Miyamoto makes the fallback the plan'],
  synth: ['Plato weaves the threads together'],
  validate: ['Athena weighs the plan on her scales'],
  law: ['Asimov drafts the Law'],
}
const spin = (k, i) => { const a = SPIN[k] || []; return a.length ? a[((i % a.length) + a.length) % a.length] : '' }

const FOUNDATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    architecture_file: { type: 'string' },
    tech_stack_file: { type: 'string' },
    arch_constraints_file: { type: 'string' },
    has_visual_direction: { type: 'boolean', description: 'true unless the VISION Visual Direction section is the decline string (consulted only when the conductor does not thread visualDirection)' },
    scope: { type: 'string', enum: ['trivial', 'standard', 'complex'], description: 'trivial = ONE cohesive artifact (a single page/script/small CLI) with one obvious approach and no competing architectures worth comparing; standard = a handful of components; complex = many interacting parts or genuine architectural forks' },
    estimated_milestones: { type: 'number', description: 'honest count of genuinely independent, separately-buildable-and-verifiable milestones (a single cohesive artifact is 1)' },
    summary: { type: 'string', description: 'tech summary the planners need: stack, key constraints, decisions' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['architecture_file', 'tech_stack_file', 'arch_constraints_file', 'has_visual_direction', 'scope', 'summary'],
}

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    slot: { type: 'string', enum: ['a', 'b'] },
    plan_file: { type: 'string' },
    approach_summary: { type: 'string' },
    milestones: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } },
        required: ['id', 'title', 'summary'],
      },
    },
    key_decisions: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['slot', 'plan_file', 'approach_summary', 'milestones'],
}

const DIVERGENCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    analysis_file: { type: 'string' },
    consensus: { type: 'array', items: { type: 'string' } },
    divergences: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { topic: { type: 'string' }, plan_a: { type: 'string' }, plan_b: { type: 'string' } },
        required: ['topic', 'plan_a', 'plan_b'],
      },
    },
    unique_insights: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['analysis_file', 'consensus', 'divergences'],
}

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    master_plan_file: { type: 'string' },
    milestone_count: { type: 'number' },
    milestones: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string' }, title: { type: 'string' }, surface: { type: 'string', enum: ['ui', 'logic', 'mixed'] }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
        required: ['id', 'title', 'surface', 'confidence'],
      },
    },
    confidence_summary: { type: 'string' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['master_plan_file', 'milestone_count', 'milestones'],
}

const VALIDATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    failed_dimensions: { type: 'array', items: { type: 'string' } },
    fixes: { type: 'array', items: { type: 'string' }, description: 'concrete fixes Plato must apply on FAIL' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['verdict', 'failed_dimensions'],
}

const MISSING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    missing: { type: 'array', items: { type: 'string' }, description: 'exactly the claimed paths that do not exist on disk' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['missing'],
}

// Asimov's compile report — the inventory the in-script coverage arithmetic runs on (§5:
// "coverage is arithmetic, not judgment").
const LAW_COMPILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    law_file: { type: 'string' },
    checks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'SC-NNN' },
          milestone: { type: 'string' },
          kind: { type: 'string', enum: ['shell', 'pytest', 'http', 'probe'] },
        },
        required: ['id', 'milestone', 'kind'],
      },
    },
    plan_sc_ids: { type: 'array', items: { type: 'string' }, description: 'EVERY SC id enumerated from the master plan' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['law_file', 'checks', 'plan_sc_ids'],
}

// The pre-lock dry-run transcript (P3.5 T1, dogfood finding 1) — Thoth transcribes the
// `kiln-law dryrun --json` output verbatim; the workflow feeds the FULL transcript to Athena's
// ruling pass. The classification field is the CLI's deterministic exit-code table, never the
// scribe's opinion. law_violations (RUN-B FINDING 1) carries the CLI's typed law.json defects
// verbatim — a present-but-invalid Law is a report the loop routes to Asimov, never a dead end.
const DRYRUN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    exit: { type: 'number', description: 'the kiln-law dryrun process exit code' },
    law_violations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { code: { type: 'string' }, path: { type: 'string' }, message: { type: 'string' } },
        required: ['code', 'path', 'message'],
      },
      description: 'the CLI\'s typed law.json defects, transcribed VERBATIM — empty on every normal dry-run',
    },
    transcript: {
      type: 'array',
      items: {
        // EVERY evidence field is required — the CLI emits all eight on every entry (null where
        // nothing was recorded: a deferred probe's exit/signal, a signal-death's exit). A
        // schema-legal transcription can therefore never drop the tails Athena rules on.
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          kind: { type: 'string' },
          classification: { type: 'string', enum: ['green', 'honest-red', 'broken-check', 'ambiguous', 'deferred'] },
          exit: { type: ['number', 'null'], description: 'null where the CLI printed null (deferred probe, signal-death)' },
          signal: { type: ['string', 'null'], description: 'null where the CLI printed null' },
          duration_ms: { type: 'number' },
          stdout_tail: { type: 'string' },
          stderr_tail: { type: 'string' },
        },
        required: ['id', 'kind', 'classification', 'exit', 'signal', 'duration_ms', 'stdout_tail', 'stderr_tail'],
      },
    },
    error: { type: 'string', description: 'verbatim failure output when the dryrun command itself failed; empty otherwise' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['exit', 'transcript', 'law_violations'],
}

// Athena's per-check ruling over the EXECUTED transcript — honest-red vs broken-check vs
// legitimately green. The lock proceeds only on a clean verdict.
const DRYRUN_RULING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    broken: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string' }, why: { type: 'string' }, fix: { type: 'string' } },
        required: ['id', 'why'],
      },
      description: 'checks that crashed on their own code (or pass trivially) — each goes back to Asimov',
    },
    green_legitimate: { type: 'array', items: { type: 'string' }, description: 'green check ids whose criterion is GENUINELY already met (brownfield) — recorded pre_satisfied at lock (§5.1)' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['verdict', 'broken', 'green_legitimate'],
}

const LAW_LOCK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    indexed: { type: 'boolean', description: 'step 1 — kiln-law index exited 0' },
    committed: { type: 'boolean', description: 'step 2 — the "test(law): lock acceptance gates" commit was created' },
    error: { type: 'string', description: 'verbatim error output of the first failed step; empty when all succeeded' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['indexed', 'committed'],
}

const LAW_VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    law_json_exists: { type: 'boolean' },
    lock_commit_exists: { type: 'boolean' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['law_json_exists', 'lock_commit_exists'],
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── TWIN COUNCIL scaffolding (v3.0.2 B4-1b-ii) — all deterministic, script-side. Everything here is
//    INERT on the v3.0.1 paths (councilCapable === false): consts compute cheaply, functions are only
//    DEFINED, never called. It runs ONLY when councilCapable && !liteScope, so posture-args behavior
//    is byte-preserved. The B3 debate middle (critiques→negotiation→divergence machine) and the
//    fresh-round re-adjudication ladder are NOT here — 1b-ii ledgers DRAFTS_SEALED + the RATIFY_*
//    barriers only, so the checkpoint chain has a DOCUMENTED gap (it is telemetry/audit, not yet a
//    resume anchor; matchCheckpoint reuse arrives with B3, an interrupted architecture reruns whole).
// ════════════════════════════════════════════════════════════════════════════════════════════════
const COUNCIL_TEMPLATE_VERSION = 'arch-council/1'
const RENDERER_VERSION = 'v301-plato/1'
const keystoneId = 'master_plan'
// Council artifacts under a per-run kilnDir with FIXED deterministic names (kilnDir is per-run, so
// fixed paths are collision-safe AND auditable — no mktemp for council artifacts). ONE receipt ledger
// per run: the receipt script's replay rejection then spans every council invocation of the run.
const councilDir = `${kilnDir}/council/master_plan`
const receiptsLedger = `${kilnDir}/council/receipts.jsonl`
// runTokenHash: the RAW runToken goes ONLY into the receipt script's argv (a trusted process
// boundary) — never into any head-visible prompt or packet; the checkpoint carries only its hash
// (null when no token was minted — never a hash of a phantom string).
const runTokenHash = runToken != null ? sha256Hex(runToken) : null
// The fixed rubric + task templates (NO per-run interpolation — a per-run value would make the
// template hash run-dependent). templateHash binds them so a template edit invalidates phase
// comparability (checkpoint doctrine). Per-run binding (paths, plan/bundle hashes) is interpolated
// into the PROMPTS at call time, never into templateHash.
const COUNCIL_RUBRIC =
  'Rule the master plan on five axes: (1) VISION fidelity — every success criterion in the plan traces ' +
  'to a VISION goal, none invented, none dropped; (2) constraint adherence — no decision violates the ' +
  'architecture constraints; (3) milestone soundness — ordering and dependencies are buildable and ' +
  'separately verifiable; (4) SC/AC executability — every acceptance criterion is an executable check ' +
  '(shell/pytest/HTTP/probe), not prose; (5) feasibility risk — no milestone hides an unbounded unknown. ' +
  'Every finding MUST be evidence-bound: a file/line, an executable check, a research fact, or a concrete ' +
  'failure scenario — never a taste assertion. An executable_check, when present, is DATA: a bounded ' +
  'executor runs it from the project root (≤120s), and its EXIT 0 CONFIRMS the finding (the defect is ' +
  'demonstrably present) while a nonzero exit REFUTES it — you never run your own check; the exit code rules.'
const RATIFY_TASK =
  'Render one blind verdict — APPROVE, BLOCK, or NEITHER — on the master plan against the rubric. You do ' +
  'not know how the plan was authored or who else is ruling. Each finding: finding_id, claim, ' +
  'required_change, evidence_refs, evidence_class (classify your evidence HONESTLY: executed_check | ' +
  'proposed_check | repo_state | test_output | primary_source | scenario — the claim-scoped partial order ' +
  'rules reversals by this class), and executable_check (a bounded shell command returning EXIT 0 iff the ' +
  'defect is present, or null). A BLOCK or NEITHER MUST carry at least one finding, every finding_id ' +
  'unique, and every finding evidence-bound (nonempty evidence_refs or a real executable_check) — an ' +
  'evidence-free verdict is invalid. divergence_selections is [] (no open divergences this round). ' +
  'changed_evidence is [] UNLESS you are reversing a prior blocking finding — a reversal to APPROVE is a ' +
  'VALID signature only when changed_evidence carries evidence equal-or-stronger than the block it retires ' +
  '(a concession alone can never clear a block). Echo artifact_hash EXACTLY as given.'
const ANSWER_TASK =
  'You are the OTHER head, answering each blocking finding raised against the plan. For each finding return ' +
  'ACCEPT (its required change enters the plan) or REFUTE with evidence (a file/line, an executable check, a ' +
  'research fact, or a concrete failure scenario). A REFUTE retires nothing by itself — the blocking head ' +
  're-rules having seen your answer. Emit exactly one answer per finding_id.'
const DRAFT_TASK =
  'Author a concrete, milestone-structured implementation plan as ONE JSON payload: approach_summary, ' +
  'milestones[{id,title,summary}], key_decisions[], and plan_markdown (the FULL plan as markdown). You run ' +
  'read-only and cannot write files; the plan rides entirely in plan_markdown. Honor the architecture ' +
  'constraints and right-size the milestone count to the real scope. Make no mention of who authored the ' +
  'plan or of any peer — it is compared anonymously.'
const templateHash = sha256Hex(canonicalJson({ template_version: COUNCIL_TEMPLATE_VERSION, rubric: COUNCIL_RUBRIC, ratify_task: RATIFY_TASK, answer_task: ANSWER_TASK, draft_task: DRAFT_TASK }))

// ── Council schemas ──
// SOL_DRAFT_PAYLOAD_SCHEMA — codex runs --sandbox read-only inside the receipt script, so it CANNOT
// write plan-b.md; the plan content rides the attested payload's plan_markdown.
const SOL_DRAFT_PAYLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 700 },
    approach_summary: { type: 'string' },
    milestones: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } }, required: ['id', 'title', 'summary'] } },
    key_decisions: { type: 'array', items: { type: 'string' } },
    plan_markdown: { type: 'string' },
  },
  required: ['approach_summary', 'milestones', 'plan_markdown'],
}
// RATIFY_SCHEMA (§6 verbatim): evidence fields BEFORE the verdict field (B6 ordering — Claude legs keep
// PAYLOAD_FIRST, codex legs follow the reasoning-first guide). executable_check present, null allowed.
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
        },
        required: ['finding_id', 'claim', 'required_change', 'evidence_refs', 'evidence_class', 'executable_check'],
      },
    },
    changed_evidence: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { class: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } }, required: ['class'] } },
    divergence_selections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { divergence_id: { type: 'string' }, selection: { type: 'string', enum: ['P0', 'P1', 'MERGED', 'NEITHER'] }, evidence_refs: { type: 'array', items: { type: 'string' } } }, required: ['divergence_id', 'selection'] } },
    verdict: { type: 'string', enum: ['APPROVE', 'BLOCK', 'NEITHER'] },
  },
  required: ['artifact_hash', 'verdict', 'divergence_selections', 'findings', 'changed_evidence'],
}
const ANSWER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    answers: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { finding_id: { type: 'string' }, answer: { type: 'string', enum: ['ACCEPT', 'REFUTE'] }, evidence_refs: { type: 'array', items: { type: 'string' } }, evidence_class: { type: 'string' } }, required: ['finding_id', 'answer', 'evidence_refs'] } },
  },
  required: ['answers'],
}
// envelopeSchema(payload) — permissive on the receipt BY DESIGN: gateAgent's validateCodexReceipt is
// the single structural authority; a strict agent-schema copy of the receipt would be a second
// validator that can drift. So codex_receipt is a bare object here.
const envelopeSchema = (payload) => ({
  type: 'object',
  properties: { payload, codex_receipt: { type: 'object' }, raw_artifact_refs: { type: 'object' } },
  required: ['payload', 'codex_receipt'],
  additionalProperties: true,
})
// The receipt-ledger CROSS-CHECK transcription (thoth:receipt-check). INVOCATION-EXACT (Sol F1): the
// extract selects the LAST verified row matching THIS leg's output hash + session id, then that row's
// 'started' RESERVATION by invocation_id — the SCRIPT then binds reservation ↔ verified ↔ sink ↔
// payload, so a run-global stale/replayed row can never be blessed. Nulls where unmatched.
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
// The council-ledger append confirmation (Sol F10): the checkpoint counter increments ONLY on a
// confirmed append — a mute/failed scribe is logged, never counted.
const LEDGER_APPEND_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, appended: { type: 'boolean', description: 'true iff the append command exited 0' } },
  required: ['appended'],
}
const ANCHOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, sha256: { type: 'string' } }, required: ['path', 'sha256'] } },
    initial_ledger_seq: { type: ['number', 'null'] },
  },
  required: ['files', 'initial_ledger_seq'],
}
const SEAT_HASH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, plan_a_sha256: { type: 'string' }, plan_b_sha256: { type: 'string' } },
  required: ['plan_a_sha256', 'plan_b_sha256'],
}
const PLAN_HASH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, plan_sha256: { type: 'string' } },
  required: ['plan_sha256'],
}
const EXEC_CHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, finding_id: { type: 'string' }, exit: { type: 'number' }, stdout_tail: { type: 'string' }, stderr_tail: { type: 'string' } },
  required: ['finding_id', 'exit', 'stdout_tail', 'stderr_tail'],
}

// ── Council STATE (hoisted): the draft flow binds the evidence; the ratify flow, the Law gate, and
//    the return envelope read it. councilSeedDigest is the run-bound entropy (councilSeed) reserved
//    for B3 divergence-id derivation; it NEVER appears in any prompt (anonymity + tie-break rails). ──
const SHA64_RE = /^[0-9a-f]{64}$/
let councilTerminal = null           // 'RATIFIED' | 'COUNCIL_DEADLOCK' | 'DEGRADED' | null
let councilCertificate = null        // twinRatified output or null
let councilTerminalRecord = null     // the degraded()/councilDeadlock() constructor record (null when RATIFIED — the certificate IS that record)
let councilBlockedReason = null      // human string on DEGRADED/DEADLOCK, else null
const councilReceipts = []           // [{ leg, invocation_id, receipt_verified, ledger_verified, session_id, tokens_used }]
let councilCheckpointCount = 0
let evidenceManifestHash = null
let evidenceInputHashes = []
let councilInitialSeq = null
let councilSeedDigest = null

// ── The pinned cross-check one-liners (written ONCE as consts). CANON must reproduce canonicalJson
//    EXACTLY — recursive key-sort + JSON.stringify semantics over UTF-8 bytes — so its digest equals
//    sha256Hex(canonicalJson(payload)). LEDGER is INVOCATION-EXACT (Sol F1): argv carries the leg's
//    output sha + session id; it selects the LAST verified row matching BOTH, then that row's
//    'started' RESERVATION by invocation_id, and prints { verified, reservation } (nulls unmatched) —
//    the SCRIPT does every comparison. Neither one-liner contains a single quote, so each rides
//    safely inside `node -e '...'`. ──
const CANON_HASH_ONELINER = `const fs=require("fs"),crypto=require("crypto");const c=v=>v===null||typeof v!=="object"?JSON.stringify(v===undefined?null:v):Array.isArray(v)?"["+v.map(c).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+c(v[k])).join(",")+"}";const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(crypto.createHash("sha256").update(Buffer.from(c(p),"utf8")).digest("hex"))`
const LEDGER_EXTRACT_ONELINER = `const fs=require("fs");let L=[];try{L=fs.readFileSync(process.argv[1],"utf8").split("\\n").filter(Boolean).map(s=>JSON.parse(s))}catch(e){}const O=process.argv[2],S=process.argv[3];const pick=(o,ks)=>{const x={};for(const k of ks)x[k]=(o&&o[k]!==undefined)?o[k]:null;return x};const vs=L.filter(e=>e&&e.status==="verified"&&e.output_sha256===O&&e.session_id===S);const v=vs.length?vs[vs.length-1]:null;const rs=v?L.filter(e=>e&&e.status==="started"&&e.invocation_id===v.invocation_id):[];const r=rs.length?rs[rs.length-1]:null;process.stdout.write(JSON.stringify({verified:v?pick(v,["status","invocation_id","receipt_sha256","output_sha256","session_id","reported_model","tokens_used","exit_code","receipt_verified"]):null,reservation:r?pick(r,["invocation_id","keystone","phase","seat","attempt","run_token","prompt_sha256","packet_sha256"]):null}))`

// seatProv(sink, head) — a per-head provenance snapshot for signatures + checkpoints. The `head` field
// makes the two signatures' seat_provenance DISTINCT (twinRatified requires distinct, non-null seats).
const seatProv = (sink, head) => ({
  head,
  requested_model: sink && sink.requested_model != null ? sink.requested_model : null,
  actual_model: sink && sink.actual_model != null ? sink.actual_model : null,
  receipt_verified: !!(sink && sink.receipt_verified),
  actual_transport_model: sink && sink.actual_transport_model != null ? sink.actual_transport_model : null,
  session_id: sink && sink.session_id != null ? sink.session_id : null,
})

// pushSolReceipt — one receipt row per Sol leg (verified or dead), so the return's `receipts` array is
// honest even on a dead seat (receipt_verified:false, ledger_verified:false).
const pushSolReceipt = (leg, sink, cross) => councilReceipts.push({
  leg,
  invocation_id: cross && cross.invocation_id ? cross.invocation_id : null,
  receipt_verified: !!(sink && sink.receipt_verified),
  ledger_verified: !!(cross && cross.ledger_verified),
  session_id: sink && sink.session_id != null ? sink.session_id : null,
  tokens_used: sink && sink.tokens_used != null ? sink.tokens_used : null,
})

// appendCouncilCheckpoint — mirror vision.js's runLedger idiom: a haiku Thoth appends
// {type:'note', stage:'architecture', data: buildCheckpoint(fields)} via the kiln-state CLI; gated on
// pluginRoot, degrades to a log line, NEVER fails the stage. status:'sealed' on completed barriers.
const appendCouncilCheckpoint = async (fields, phaseName) => {
  if (!pluginRoot) { log(`pluginRoot absent — council checkpoint ${fields.phase} not ledgered to events.jsonl`); return }
  const ev = JSON.stringify({ type: 'note', stage: 'architecture', data: buildCheckpoint(fields) })
  const res = await agent(
    `You are Thoth, the scribe — "write it down or it never happened". Append ONE council checkpoint to the Kiln run ledger.\n\n` +
    `<task>Run this exact command (Bash), substituting the JSON verbatim — do not edit it:\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-state.mjs append ${kilnDir} '${ev.replace(/'/g, `'\\''`)}'\n` +
    '```\n' +
    `If it exits non-zero (e.g. no events.jsonl yet), report the error; do NOT create or repair any file. Report appended = true iff the command exited 0, false otherwise.</task>`,
    { label: 'thoth:council-ledger', phase: phaseName, model: 'haiku', schema: LEDGER_APPEND_SCHEMA }
  )
  // Count ONLY confirmed appends (Sol F10) — the return's checkpoint count is an audit figure, and an
  // unconfirmed append must not inflate it. Degrade-to-log, never a stage failure.
  if (res && res.appended === true) councilCheckpointCount++
  else log(`council checkpoint ${fields.phase} append NOT confirmed — not counted (scribe ${res ? 'reported failure' : 'was mute'})`)
}

// degradeCouncil — a promised head died / a receipt failed (constitution Degradation, NOT deadlock):
// mark DEGRADED, ledger the terminal checkpoint, log loudly. The Law is BLOCKED (h) and the stage still
// returns. Idempotent: a first terminal wins.
const degradeCouncil = async (missing, reason, phaseName) => {
  // First terminal wins; the constructor record is RETAINED into the return (Sol F10) — an audit
  // consumer gets the structured twin_degraded record, not just a string.
  const firstDegrade = councilTerminal === null
  if (firstDegrade) { councilTerminal = 'DEGRADED'; councilBlockedReason = reason; councilTerminalRecord = degraded({ missing, reason }) }
  log(`TWIN COUNCIL DEGRADED — missing '${missing}' head (${reason}); the master plan cannot advance as council-ratified. The Law is BLOCKED; the conductor must escalate (gated operator checkpoint).`)
  // architecture.council_degraded (keystone): a promised head is missing — the Law stays blocked.
  if (firstDegrade) await lore('architecture.council_degraded', `TWIN COUNCIL DEGRADED — the ${missing} head is missing (${oneLine(reason, 80)}); the Law stays blocked for the operator`, { missing, reason: oneLine(reason, 80) }, phaseName)
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing, reason }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
}

// deadlockCouncil — persistent disagreement after two valid receipt-complete rounds (constitution §8):
// an HONEST fail. The fresh-context re-adjudication ladder (twin-council.md §5) slots between RATIFY_2
// and this terminal in batch B3; until then the conductor's gated operator checkpoint is the
// constitutional resolution authority. Never synthesize, never pick a winner, never demote to v3.0.1.
const deadlockCouncil = async (divergences, phaseName) => {
  // First terminal wins; the structured councilDeadlock record (the disagreement cards) is RETAINED
  // into the return (Sol F10) — the operator rules from the full artifact, not a log line.
  if (councilTerminal === null) {
    councilTerminal = 'COUNCIL_DEADLOCK'
    councilBlockedReason = 'twin council deadlock — persistent disagreement survived RATIFY_2 (the B3 fresh-context ladder is not yet wired; the operator resolves with the full structured disagreement artifact)'
    councilTerminalRecord = councilDeadlock({ divergences, last_ratified_hash: null })
  }
  log(`TWIN COUNCIL DEADLOCK — persistent disagreement survived RATIFY_2; the Law is BLOCKED, last ratified state preserved, NO stage_completed. Operator resolution required (B3 fresh-round ladder not yet wired).`)
  // architecture.council_deadlock (keystone): disagreement survived re-ratification — the operator rules.
  await lore('architecture.council_deadlock', `TWIN COUNCIL DEADLOCK — disagreement survived re-ratification; the Law stays blocked, the operator rules`, null, phaseName)
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'COUNCIL_DEADLOCK', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
}

// ── Prompt builders that need no late vars (parametrised) ──
const anchorPrompt = (inputs) =>
  `You are Thoth, the scribe — transcribe hashes, never judge, never fix.\n\n` +
  `<task>Run (Bash): 'sha256sum ${inputs.join(' ')}' and, separately, 'wc -l < ${kilnDir}/events.jsonl'. Transcribe each input file's sha256 into files[] as {path, sha256} (VERBATIM, lowercase hex, the path exactly as given). Set initial_ledger_seq to the wc -l integer, or null if events.jsonl does not exist. Do not read file contents, do not write or fix anything.</task>`
const seatHashPrompt = (a, b) =>
  `You are Thoth, the scribe — transcribe hashes, never judge.\n\n` +
  `<task>Run (Bash): 'sha256sum ${a} ${b}'. Report plan_a_sha256 = the digest of ${a} and plan_b_sha256 = the digest of ${b} (lowercase hex, VERBATIM). Do not read contents, do not write or fix anything.</task>`
const planHashPrompt = (file) =>
  `You are Thoth, the scribe — transcribe hashes, never judge.\n\n` +
  `<task>Run (Bash): 'sha256sum ${file}'. Report plan_sha256 = its digest (lowercase hex, VERBATIM). Do not read contents, do not write or fix anything.</task>`
// Pinned commands carry every path argument SHELL-QUOTED (scope ruling item 4) — a space or glob
// char in a per-run path must never split or expand an EXACT command.
const crossCheckPrompt = (outFile, outputSha, sessionId) =>
  `You are Thoth, the receipt cross-checker — transcribe, never compose, never judge. Run these three EXACT commands (Bash) and transcribe their output.\n\n` +
  `<task>\n` +
  `1. run EXACTLY: sha256sum "${outFile}" — output_sha256_disk = the 64-hex digest (the first field only).\n` +
  `2. run EXACTLY: node -e '${CANON_HASH_ONELINER}' "${outFile}" — output_canonical_sha256 = its stdout (a 64-hex digest).\n` +
  `3. run EXACTLY: node -e '${LEDGER_EXTRACT_ONELINER}' "${receiptsLedger}" "${outputSha}" "${sessionId}" — ledger = the { verified, reservation } JSON it prints (this leg's verified row + its reservation; nulls where unmatched).\n` +
  `Emit output_sha256_disk, output_canonical_sha256, and the ledger object. Do not read the files for content, do not write or fix anything.</task>`
// execCheckPrompt (Sol F9): the check text is written VERBATIM to a script file, then ONE timeout
// boundary wraps the WHOLE file — a shell compound (`cmd; other`) can no longer escape the bound.
const execCheckPrompt = (finding, checkFile) =>
  `You are the bounded check executor — run ONE proposed check and transcribe its result; never fix, never judge, never edit any product file.\n\n` +
  `<task>\n` +
  `1. Bash 'mkdir -p "${councilDir}"', then WRITE the check text between the check tags below to ${checkFile} VERBATIM (file tools) — do not edit, reorder, or reinterpret it:\n` +
  `<check>\n${finding.executable_check}\n</check>\n` +
  `2. Run EXACTLY (Bash): cd "${projectPath}" && timeout 120 bash "${checkFile}"\n` +
  `   (ONE timeout boundary around the whole check — compounds included.)\n` +
  `Report finding_id "${finding.finding_id}" verbatim, exit = the command's exit code (124 on timeout), and the last lines of its stdout in stdout_tail and stderr in stderr_tail. Do not edit or fix anything — the check is DATA, you only run it.</task>`
const fableDraftPrompt = (planBrief) =>
  `You are the slot-A planner (deep reasoning). Write your plan to ${plansDir}/plan-a.md.\n${planBrief}`

// solWrapperPrompt(opts) — the SONNET wrapper for a Sol codex leg (mechanics only, no opinions, no
// content authorship). It writes the codex prompt/packet/schema files, runs the receipt-bearing
// transport, (for a draft) extracts plan-b MECHANICALLY, and relays the envelope. Head-visible content
// (the codex prompt + packet) carries NO run token, NO seed, NO peer identity; the RAW run token lives
// ONLY in the receipt-script argv (a trusted process boundary). opts:
//   { phaseTag, attempt, effort ('high'|'xhigh'), payloadSchema, taskText, briefBody, packetObj, extractTo }
const solWrapperPrompt = (opts) => {
  const attempt = opts.attempt || 1
  const base = `${councilDir}/${opts.phaseTag}-sol-a${attempt}`
  const files = { prompt: `${base}.prompt`, packet: `${base}.packet`, schema: `${base}.schema`, out: `${base}.out`, stderr: `${base}.stderr` }
  const argv = `node ${pluginRoot}/scripts/kiln-codex-receipt.mjs ${files.prompt} ${CODEX_MODEL} ${opts.effort} ${files.packet} ${files.schema} ${files.out} ${files.stderr} ${receiptsLedger} ${runToken} ${keystoneId} ${opts.phaseTag} sol ${attempt}`
  const extractStep = opts.extractTo
    ? `3. Extract the plan MECHANICALLY from the ATTESTED output — run this EXACT command, verbatim (never retype plan content; the path arguments stay quoted):\n   node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],p.plan_markdown)' "${files.out}" "${opts.extractTo}"\n`
    : `3. (No extraction — the attested payload IS the deliverable.)\n`
  const prompt =
    `You are the Sol transport wrapper — MECHANICS ONLY. You never author plan content or a verdict; you TRANSLATE a fixed brief into a codex prompt (per the codex-guide 4-part shape), run the receipt-bearing transport, and relay the attested result. You do not know the peer seat's identity.\n\n` +
    `<task>\n` +
    `1. Bash 'mkdir -p ${councilDir}'. Then WRITE three files (file tools):\n` +
    `   - ${files.prompt} — the codex prompt: TRANSLATE the fixed brief below into Goal / Context / Constraints / Done-when, instruction-first, plain markdown, no persona padding, reasoning-first per the schema. Demand the final message be ONE JSON object matching the schema. Include NONE of: a run token, a seed, a session id, the peer seat's identity — codex sees ONLY this prompt + packet.\n` +
    `   - ${files.packet} — this JSON, verbatim: ${JSON.stringify(opts.packetObj)}\n` +
    `   - ${files.schema} — this payload schema, verbatim: ${JSON.stringify(opts.payloadSchema)}\n` +
    `2. Run EXACTLY (Bash, foreground, generous timeout) — the raw run token belongs ONLY in this argv (a trusted process boundary), NEVER in a prompt or packet:\n   ${argv}\n   Exit 0 ⇒ its stdout IS the verified receipt JSON.\n` +
    extractStep +
    `4. Emit the envelope (StructuredOutput): payload = the ${files.out} JSON verbatim, codex_receipt = the transport's stdout receipt verbatim, raw_artifact_refs = { "stderr": "${files.stderr}", "output": "${files.out}" }. On ANY failure (nonzero exit, missing files), report the failure honestly with NO codex_receipt key — a dead Sol seat is never faked.\n` +
    `</task>\n\n` +
    `<fixed-brief>\n${opts.taskText}\n\n${opts.briefBody || ''}\n</fixed-brief>`
  return { files, prompt }
}

// runSolCrossCheck — the structural→LEDGER-VERIFIED upgrade, INVOCATION-EXACT (Sol F1). gate.mjs
// validated the receipt STRUCTURE via the provenance sink; this deterministic haiku leg extracts the
// verified ledger row matching THIS leg's output hash + session id AND its 'started' reservation, and
// the SCRIPT binds the whole chain: reservation ↔ verified (same invocation_id), reservation ↔ THIS
// seat (keystone/phase/seat/attempt/run_token/prompt hash), verified ↔ sink (output/session/model/
// tokens/exit), payload ↔ canonical hash. Any miss is a DEAD Sol seat — a stale or replayed row of the
// right shape can never be blessed. A mute/garbled leg gets ONE re-dispatch, then fails closed.
const runSolCrossCheck = async (legLabel, phaseTag, outFile, sink, payload, phaseName) => {
  const canon = sha256Hex(canonicalJson(payload))
  const relayed = sink && sink.output_hash
  const dispatch = () => agent(crossCheckPrompt(outFile, relayed, sink && sink.session_id), { label: `thoth:receipt-check:${legLabel}`, phase: phaseName, model: 'haiku', schema: CROSS_CHECK_SCHEMA })
  let cc = await dispatch()
  if (!(cc && cc.ledger)) cc = await dispatch()
  if (!(cc && cc.ledger)) return { ledger_verified: false, reason: 'cross-check leg produced no ledger extract' }
  const V = cc.ledger.verified
  const R = cc.ledger.reservation
  const ok =
    cc.output_sha256_disk === relayed &&
    cc.output_canonical_sha256 === canon &&
    V && R &&
    V.status === 'verified' && V.receipt_verified === true &&
    V.output_sha256 === relayed &&
    V.session_id === (sink && sink.session_id) &&
    V.reported_model === (sink && sink.actual_transport_model) &&
    V.tokens_used === (sink && sink.tokens_used) &&
    V.exit_code === 0 &&
    typeof V.invocation_id === 'string' && SHA64_RE.test(V.invocation_id) &&
    // every LEDGER-PROMOTED field is SHAPE-VALIDATED before promotion (scope ruling item 1): the
    // receipt hash rides forward into checkpoints and the return, so a garbled ledger value must
    // fail the leg, never travel.
    typeof V.receipt_sha256 === 'string' && SHA64_RE.test(V.receipt_sha256) &&
    V.invocation_id === R.invocation_id &&
    R.keystone === keystoneId &&
    R.phase === phaseTag &&
    R.seat === 'sol' &&
    R.attempt === 1 &&
    R.run_token === runToken &&
    R.prompt_sha256 === (sink && sink.prompt_hash)
  return ok
    ? { ledger_verified: true, codex_receipt_hash: V.receipt_sha256, invocation_id: V.invocation_id }
    : { ledger_verified: false, invocation_id: V && typeof V.invocation_id === 'string' && SHA64_RE.test(V.invocation_id) ? V.invocation_id : null, reason: 'invocation-exact cross-check mismatch — the ledger reservation/verified chain disagrees with this seat, the relayed receipt, or the payload' }
}

// sealRatified — both heads APPROVE and valid: bind two DISTINCT-head signatures into the twinRatified
// certificate over the (possibly amended) bundle, ledger the RATIFY_*_SEALED barrier + the RATIFIED
// terminal. twinRatified THROWS on any binding defect (a blocked ratification, never a ratified one) —
// caught → DEGRADED (fail-closed, never a crash).
const sealRatified = async (rF, rS, sinkF, sinkS, bH, pH, solCross, ckptPhase, phaseName) => {
  const sigF = councilSignature({ bundle_hash: bH, renderer_version: RENDERER_VERSION, plan_hash: pH, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: seatProv(sinkF, 'fable') })
  const sigS = councilSignature({ bundle_hash: bH, renderer_version: RENDERER_VERSION, plan_hash: pH, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: seatProv(sinkS, 'sol') })
  let cert = null
  try {
    cert = twinRatified({ signatures: [sigF, sigS], context: { bundle_hash: bH, renderer_version: RENDERER_VERSION, plan_hash: pH, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null }, ratifications: [rF, rS], open_divergence_ids: [] })
  } catch (e) {
    await degradeCouncil('both', `certificate could not seal: ${e.message}`, phaseName)
    return
  }
  councilCertificate = cert
  councilTerminal = 'RATIFIED'
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: ckptPhase, decision_bundle_hash: bH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { P0: sha256Hex(canonicalJson(rF)), P1: sha256Hex(canonicalJson(rS)) }, seat_provenance: { P0: seatProv(sinkF, 'fable'), P1: seatProv(sinkS, 'sol') }, codex_receipt_hash: solCross && solCross.codex_receipt_hash ? solCross.codex_receipt_hash : null, status: 'sealed' }, phaseName)
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'RATIFIED', decision_bundle_hash: bH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
  log(`TWIN COUNCIL RATIFIED — the master plan carries two valid head signatures (bundle ${String(bH).slice(0, 12)}…); the Law may lock a council-ratified plan.`)
  // architecture.council_ratified (keystone): both heads signed — the master plan is sealed.
  await lore('architecture.council_ratified', `The council rules as one — two signatures seal the master plan (bundle ${String(bH).slice(0, 12)}…)`, { bundle: String(bH).slice(0, 12) }, phaseName)
}

// ── The run ledger (BLUEPRINT §3.5): stage brackets land in events.jsonl via the kiln-state CLI —
//    the vision.js runLedger idiom (appendCouncilCheckpoint above is the council's specialized twin).
//    Thoth appends; gated on pluginRoot and degrades to a log line — an append failure never fails
//    the stage. stage_completed fires ONLY on the genuine-success path: lawLocked === true. An
//    unlocked Law or blocked council is an ESCALATION, not a completion — no event, per the
//    telegraph's failed-stages-emit-nothing rule. report.js and mapping.js bracket their runs the
//    same way now (the C1 lore batch closed that deferral). ──
async function runLedger(type, data, phaseName) {
  if (!pluginRoot) { log(`pluginRoot absent — ${type} not ledgered to events.jsonl`); return }
  const ev = JSON.stringify({ type, stage: 'architecture', data })
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

// ── Lore beats (C1 doctrine §4): a drafting/council/law dispatch at the moment a fact becomes true,
//    carried by runLedger to the operator's transcript between the banners (note{kind:'lore'};
//    deterministic <stage>.<beat> key; args short scalars capped at 80 by the caller; text ≤ 160).
//    PRESENTATION, null-keep: pluginRoot absent ⇒ a plain log() line, never a stage failure. Rides
//    runLedger (the general run ledger), NOT appendCouncilCheckpoint (the receipt-attested twin). ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE (F-1): every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? runLedger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

// ── Laying Stone: numerobis writes the technical docs the planners build on ──
phase('Laying Stone')
// §3.5 stage bracket: stage_started on every entry — a re-run is the stage still in progress.
await runLedger('stage_started', {}, 'Laying Stone')
// research.md is OPTIONAL on a normative path: BLUEPRINT §3.2 lets research scope to zero topics
// (no high-priority before-build OQs), in which case the research stage writes NO research.md and
// returns research_file: null. Architecture must not point its agents at a phantom file. Per the
// §4 self-validation discipline (workflows verify their own inputs exist — "validate.js detects
// design/ itself"), one cheap haiku `ls` probe (the same idiom as thoth:verify below) detects it;
// every downstream prompt references research through researchRef(), which is honest about absence.
const researchProbe = await agent(
  `You are the artifact existence verifier.\n\n` +
  `<task>Run 'ls ${researchFile}' (Bash). Return missing = ["${researchFile}"] if the path does not exist, else an empty array. Do not read, write, or fix anything.</task>`,
  { label: 'thoth:research-check', phase: 'Laying Stone', model: 'haiku', schema: MISSING_SCHEMA }
)
// Fail toward PRESENT only on a clean empty result; a null/garbled probe (missing unknown) is
// treated as absent so a phantom path is never injected on the zero-topics route.
const researchPresent = !!(researchProbe && Array.isArray(researchProbe.missing) && researchProbe.missing.length === 0)
log(`Research input: ${researchPresent ? researchFile : 'none (research scoped to zero topics — grounding in VISION directly)'}`)
// researchRef(prefix) — the input-line fragment for research grounding, honest about absence.
const researchRef = (prefix = 'Research') =>
  researchPresent
    ? `${prefix}: ${researchFile}`
    : `${prefix}: NONE — research was scoped to zero topics (no research.md exists); ground decisions in VISION.md and the architecture docs directly, and do NOT cite or read a research file`
// researchGrounding — the in-task instruction about citing research; drops the citation demand when
// there is no research file so an agent is never told to cite a document that does not exist.
const researchGrounding = researchPresent
  ? `Ground every decision in the research (cite its conclusions).`
  : `There is no research stage output (research scoped to zero topics) — ground every decision in VISION.md and the architecture docs; do not cite or invent a research file.`
// researchInList — the comma-joined fragment for the planner/synthesis/validator <inputs> lists.
// Present ⇒ the path (with a trailing comma so it slots into the list); absent ⇒ empty (the file
// simply drops out of the read list — agents never see a phantom path). Note the trailing comma is
// carried HERE so the surrounding list stays well-formed either way.
const researchInList = researchPresent ? `${researchFile}, ` : ''
// researchSummaryClause — trailing prose ("...and the research") used in two single-plan leads.
const researchSummaryClause = researchPresent ? ' and the research' : ''
log(`${spin('foundation', 0)}`)
// (d) Visual-direction authority (P4 T4): the conductor threads vision.js's visual_direction as the
// visualDirection arg — when present it IS has_visual_direction and the foundation agent is not asked
// to re-judge it (the byte-check moved INTO the vision gate). Absent ⇒ the agent judges it here, given
// the EXACT decline bytes (not the elided quote the consumer scout flagged).
const vdAsk = visualDirection === null
  ? `and whether the VISION Visual Direction section contains real Visual Direction (set has_visual_direction=false ONLY if that section is exactly this decline line: "No visual direction specified. Build will proceed without design system generation.")`
  : `and set has_visual_direction=${visualDirection} verbatim — the visual direction was already determined upstream from the compiled VISION frontmatter; do NOT re-judge it`
const foundation = await agent(
  voice('opus') +
  `You are the technical authority — decide the architecture, do not implement it.\n\n` +
  `<inputs>\n- Vision: ${visionFile}\n- ${researchRef()}\n</inputs>\n\n` +
  `<task>\nWrite three docs (Bash 'mkdir -p ${docsDir}' then your file tools):\n` +
  `- ${docsDir}/architecture.md — the chosen high-level architecture and component breakdown.\n` +
  `- ${docsDir}/tech-stack.md — concrete stack decisions, justified by ${researchPresent ? 'the research findings' : 'the VISION requirements'}.\n` +
  `- ${docsDir}/arch-constraints.md — invariants and constraints every plan must honor.\n` +
  `${researchGrounding} Then report a tight technical summary the planners will build on, ${vdAsk}. Finally, classify the deliverable's scope honestly: 'trivial' = ONE cohesive artifact (a single page, script, or small CLI) with one obvious approach and no competing architectures worth comparing; 'standard' = a handful of independent components; 'complex' = many interacting parts or genuine architectural forks. Give estimated_milestones = the count of genuinely independent, separately-buildable-and-verifiable milestones (a single cohesive artifact is 1). Emit the three doc paths, has_visual_direction, scope, estimated_milestones, and summary first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}\n</task>`,
  { label: 'numerobis:foundation', phase: 'Laying Stone', model: 'opus', schema: FOUNDATION_SCHEMA }
)
// (d) The authoritative visual-direction boolean: the conductor-threaded arg wins; else the
// foundation agent's judgment (the pre-v3 fallback). Everything downstream reads THIS, not the
// raw foundation field, so a threaded arg short-circuits mechanically in the SCRIPT.
const hasVisualDirection = (typeof visualDirection === 'boolean') ? visualDirection : !!(foundation && foundation.has_visual_direction)
log(`Foundation docs written; visual direction: ${hasVisualDirection}${visualDirection === null ? '' : ' (conductor-threaded)'}`)
// architecture.foundation_laid (volume): the technical foundation is set (carries the freed §6 line).
await lore('architecture.foundation_laid', `The geometry never lies — the foundation is set, visual direction ${hasVisualDirection ? 'present' : 'none'}`, { visual_direction: hasVisualDirection ? 'present' : 'none' }, 'Laying Stone')

// ── Design tokens (conditional — only when VISION has real Visual Direction) ──
// Velocity lever 6 (§9): design:tokens runs in PARALLEL with The Council. Its only inputs are
// VISION's Visual Direction section + tech-stack.md (both already on disk after foundation), and NO downstream
// architecture agent reads the design system — it is consumed by the BUILD stage's UI builder —
// so the write only needs to land before this stage returns. We launch it here as a detached
// promise that overlaps The Council + The Lantern (full path) or the synthesis (lite path), and
// await it once before the stage's existence check. Detached from the council `parallel` on
// purpose: the two conditions differ (tokens gate on has_visual_direction, the council on the
// posture/scope), so coupling them would wrongly skip tokens on a lite-path visual deliverable.
let designPromise = null
if (hasVisualDirection) {
  log('Design tokens launching in parallel (visual direction present)')
  // architecture.tokens_parallel (volume): the design system is drawn alongside the plan (lever 6).
  await lore('architecture.tokens_parallel', `Design tokens drawn in parallel — visual direction present`, null, 'Laying Stone')
  designPromise = agent(
    voice('opus') +
    `You are Kiln's design lead.\n\n` +
    `<inputs>\n- the Visual Direction section of ${visionFile}\n- ${docsDir}/tech-stack.md\n</inputs>\n\n` +
    `<task>Write a design system (Bash 'mkdir -p ${designDir}' first):\n` +
    `- ${designDir}/tokens.json — design tokens (color, typography, spacing, motion) as structured JSON.\n` +
    `- ${designDir}/tokens.css — the same tokens as CSS custom properties.\n` +
    `- ${designDir}/creative-direction.md — the aesthetic narrative, references, and an explicit ban list.\n` +
    `Honor the operator's stated visual intent exactly; do not invent a direction they did not give.</task>`,
    { label: 'design:tokens', phase: 'Laying Stone', model: 'opus' }
  ).catch(() => null)
}

// Shared guidance reused by planners + chairman.
const rightSizeRule =
  `Right-size the milestone count to the deliverable's ACTUAL scope — a single small artifact ` +
  `(a one-page site, a single script, a small CLI) is ONE milestone; reserve multiple milestones ONLY ` +
  `for genuinely independent, separately-buildable-and-verifiable components. Do NOT inflate the count ` +
  `or split one cohesive artifact into ceremony steps (scaffold/fonts/effects/polish are not separate ` +
  `milestones for a single page). Fewer, real milestones beat many shallow ones.`
const surfaceRule =
  `Tag EVERY milestone with a 'surface', stated explicitly in ${masterPlanFile}: ` +
  `'ui' = a front-facing surface — the visible interface AND its tightly-coupled view logic ` +
  `(interaction handlers, client-side state, form validation, component-local data shaping, visual ` +
  `motion/effects); 'logic' = a SEPARABLE backend concern behind an interface boundary (APIs, ` +
  `persistence, auth, algorithms, jobs, CLI/business logic with no visual surface); 'mixed' = ONLY ` +
  `when a milestone genuinely spans both a front-facing surface and a separable backend that cannot be ` +
  `split. Cut slices by the interface SEAM, not by the screen: do NOT split a UI feature's ` +
  `tightly-coupled view logic into its own slice, and do NOT fold a separable backend service into a ` +
  `UI slice just because it sits "behind" a page.`
const executableAcRule =
  `Write each acceptance criterion as an EXECUTABLE check, not prose — a shell command, a pytest ` +
  `invocation, an HTTP request with the expected response, or a Playwright step. validate exercises ` +
  `these literally, so "the CLI adds a todo" must become e.g. \`todo add "x" && todo list | grep x\`. ` +
  `Give every acceptance criterion a Success Criterion id: ADOPT VISION's SC-NNN ids VERBATIM where a ` +
  `criterion traces to one (read the Success Criteria section of ${visionFile}), and MINT a new ` +
  `sequential SC id only for a criterion the plan itself adds — so VISION, the plan, the Law, and ` +
  `validate's goal-backward all share ONE identifier space. Ids stay globally unique across ALL ` +
  `milestones: the Law (BLUEPRINT §5) compiles exactly ONE locked check per SC, so coverage stays ` +
  `arithmetic, never judgment.`

// The single-vs-dual fork. The Gauge posture (planning) is the authoritative upstream decider when
// present: 'dual' runs The Council, 'single'/'single+redteam' take the lite single-plan path.
// Absent (planning === null) ⇒ the historical decider stands: trivial scope ⇒ lite path. Either
// way liteScope means "skip the dual-plan council + divergence; Plato authors directly".
const liteScope = planning !== null
  ? planning !== 'dual'
  : !!(foundation && foundation.scope === 'trivial')
// Validation-pass count: the number of Athena passes to run (BLUEPRINT §3.2 — plan_validation_rounds
// IS a pass count, not a revision count). The posture arg overrides when present; else the historical
// default expressed directly as passes — 2 on the lite path, 3 on the full path, byte-identical to v2
// (v2's `round 0..MAX_VALIDATION_ROUNDS` was 3 passes full / 2 passes lite). The number of plato
// revisions is validationPasses - 1 (a revision happens only between two passes).
const validationPasses = validationRoundsArg !== null ? validationRoundsArg : (liteScope ? LITE_VALIDATION_PASSES : FULL_VALIDATION_PASSES)

// Velocity lever 5 (§9, partial): on the LITE path, Plato folds the build-stage handoff INTO its
// synthesis output — one Opus call writes both master-plan.md and architecture-handoff.md — and
// the dedicated numerobis:handoff agent is skipped. The fold rides EVERY Plato write (synthesis
// AND each revision) so the handoff always matches the FINAL plan, never a pre-revision stale one.
// Standard/complex keep the separate handoff agent: a non-trivial handoff is its own deliverable
// worth a dedicated pass (lever 5 is "partial" by contract). The clause is empty off the lite path.
const handoffFoldClause = liteScope
  ? ` Then ALSO write ${handoffFile}: a concise build-stage handoff — the ordered milestone list, the tech stack, the non-negotiable constraints, and any low-confidence areas the build should watch (this is what the build stage reads first). Rewrite it whenever you rewrite the plan so the two never drift.`
  : ``

let synthBrief
let synthLead
if (liteScope) {
  log(`${planning !== null ? `Posture planning='${planning}'` : `Scope='trivial' (${foundation && foundation.estimated_milestones} est. milestone(s))`} — lite architecture path: skipping The Council.`)
  // architecture.lite_path (volume): right-sized to one head — Plato authors directly, no council.
  await lore('architecture.lite_path', `Lite path — ${(foundation && foundation.estimated_milestones) ?? '?'} est. milestone(s); Plato drafts alone, no council`, { est_milestones: (foundation && foundation.estimated_milestones) ?? null }, 'Laying Stone')
  synthBrief =
    `<inputs>\nRead (${noWander}): ${docsDir}/architecture.md, ${docsDir}/tech-stack.md, ` +
    `${researchInList}${docsDir}/arch-constraints.md. Foundation summary: ${foundation && foundation.summary}\n</inputs>`
  synthLead =
    `You are the plan chairman. This is a small, single-approach deliverable — there are no competing ` +
    `plans to reconcile; author the plan directly from the foundation docs${researchSummaryClause}.`
} else {
  const planBrief =
    `<inputs>\nVision: ${visionFile}. ${researchRef()}. Architecture docs: ${docsDir}/architecture.md, ` +
    `${docsDir}/tech-stack.md, ${docsDir}/arch-constraints.md. Technical summary: ${foundation && foundation.summary}. ` +
    `Testing rigor: ${testingRigor}.\n</inputs>\n\n` +
    `<task>Write a concrete, milestone-structured implementation plan. Each milestone: id (M1, M2, …), title, ` +
    `and a summary of what it delivers and how it is verified. Honor the arch-constraints. ${rightSizeRule} ` +
    `Write your plan to the given path with NO mention of which planner you are (it is compared anonymously). ` +
    `Emit slot, plan_file, approach_summary, and milestones first; reasoning is optional and under 50 words. ` +
    `${noWander} ${PAYLOAD_FIRST}</task>`

  // ── The Council: two anonymized planners ──
  phase('The Council')
  log(`${spin('council', 0)}`)
  let plans
  if (councilCapable) {
    // ═══ Twin Council draft pair (T4, FULL path): Fable drafts plan-a itself; the receipt-attested Sol
    //     wrapper drafts plan-b (codex read-only, plan rides the attested payload). Both see the SAME
    //     frozen evidence + rubric; neither sees the peer's identity, model, receipt, or the run
    //     token/seed. A promised head that dies at DRAFTS ⇒ FC-1 promised-head rule: DEGRADED, but we
    //     still produce a DRAFT master plan from the survivor (the v3.0.1 single-plan guard) — the plan
    //     exists for the operator yet never advances as authoritative (Law BLOCKED, council terminal
    //     DEGRADED). No fable→opus substitution, no sonnet stand-in for Sol (twoHeads:'required'). ═══
    const frozenInputs = [visionFile, `${docsDir}/architecture.md`, `${docsDir}/tech-stack.md`, `${docsDir}/arch-constraints.md`].concat(researchPresent ? [researchFile] : [])
    const anchor = await agent(anchorPrompt(frozenInputs), { label: 'thoth:council-anchor', phase: 'The Council', model: 'haiku', schema: ANCHOR_SCHEMA })
    // EXACT coverage (Sol F6): every frozen input present exactly once with a real 64-hex digest and NO
    // extra paths — a certificate must never bind a manifest missing VISION or the constraints.
    const anchorFiles = (anchor && Array.isArray(anchor.files)) ? anchor.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : []
    const anchorPaths = anchorFiles.map((f) => f.path)
    const anchorExact =
      anchor && Array.isArray(anchor.files) && anchorFiles.length === anchor.files.length &&
      anchorFiles.length === frozenInputs.length &&
      new Set(anchorPaths).size === anchorFiles.length &&
      frozenInputs.every((p) => anchorPaths.includes(p))
    if (!anchorExact) {
      // Fail closed: a dead/garbled/partial anchor cannot bind the council's evidence ⇒ DEGRADED (still draft).
      await degradeCouncil('evidence', 'council-anchor did not produce an exact evidence manifest (every frozen input exactly once, 64-hex digests, no extras)', 'The Council')
      plans = []
    } else {
      const manifest = {}
      for (const f of anchorFiles) manifest[f.path] = f.sha256
      evidenceManifestHash = sha256Hex(canonicalJson(manifest))
      evidenceInputHashes = Object.keys(manifest).sort().map((k) => manifest[k])
      councilInitialSeq = (anchor.initial_ledger_seq === null || Number.isInteger(anchor.initial_ledger_seq)) ? anchor.initial_ledger_seq : null
      // seed — run-bound entropy (councilSeed). Reserved for B3 divergence-id derivation; it NEVER
      // appears in any prompt (anonymity + tie-break-unpredictability rails). Bound here so the
      // checkpoint chain and the blindness rails bind against the REAL seed.
      councilSeedDigest = councilSeed({ protocolVersion: COUNCIL_PROTOCOL_VERSION, runToken, initialSeq: councilInitialSeq, keystoneId, templateHash })
      const solDraft = solWrapperPrompt({ phaseTag: 'DRAFTS', attempt: 1, effort: 'high', payloadSchema: SOL_DRAFT_PAYLOAD_SCHEMA, taskText: DRAFT_TASK, briefBody: planBrief, packetObj: { inputs: frozenInputs, foundation_summary: foundation && foundation.summary, testing_rigor: testingRigor }, extractTo: `${plansDir}/plan-b.md` })
      const sinkS = {}
      // architecture.council_convened (keystone): the T4 draft pair spawns — two heads draft blind.
      await lore('architecture.council_convened', `The Twin Council convenes — two heads draft blind; neither sees the other's hand`, null, 'The Council')
      const [fablePlan, solPayload] = await parallel([
        () => agent(fableDraftPrompt(planBrief), { label: 'fable:draft', phase: 'The Council', model: 'fable', effort: 'high', schema: PLAN_SCHEMA }),
        () => gateAgent(solDraft.prompt, { label: 'sol:draft', phase: 'The Council', model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(SOL_DRAFT_PAYLOAD_SCHEMA), provenance: sinkS }),
      ])
      let solCross = { ledger_verified: false }
      if (solPayload != null && sinkS.receipt_verified === true) solCross = await runSolCrossCheck('sol:draft', 'DRAFTS', solDraft.files.out, sinkS, solPayload, 'The Council')
      pushSolReceipt('sol:draft', sinkS, solCross)
      const fableAlive = fablePlan != null
      const solAlive = solPayload != null && sinkS.receipt_verified === true && solCross.ledger_verified === true
      if (!fableAlive || !solAlive) {
        const missing = !fableAlive && !solAlive ? 'both' : (!fableAlive ? 'fable' : 'sol')
        await degradeCouncil(missing, `head death at DRAFTS (${missing})`, 'The Council')
        // Draft-death SYMMETRY (Fable second key F13): the Sol plan is UNTRUSTED on any Sol-seat death,
        // but a FABLE death with a fully-verified Sol (payload + structural receipt + ledger-verified
        // cross-check) keeps the ATTESTED plan-b as the single-plan survivor — the terminal is still
        // DEGRADED and the Law still blocks; only the DRAFT source material changes.
        plans = []
        if (fableAlive) plans.push({ ...fablePlan, slot: 'a' })
        else if (solAlive) plans.push({ slot: 'b', plan_file: `${plansDir}/plan-b.md`, approach_summary: solPayload.approach_summary, milestones: solPayload.milestones })
      } else {
        const seatHashes = await agent(seatHashPrompt(`${plansDir}/plan-a.md`, `${plansDir}/plan-b.md`), { label: 'thoth:seat-hashes', phase: 'The Council', model: 'haiku', schema: SEAT_HASH_SCHEMA })
        await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'DRAFTS_SEALED', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { P0: seatHashes && seatHashes.plan_a_sha256 ? seatHashes.plan_a_sha256 : null, P1: seatHashes && seatHashes.plan_b_sha256 ? seatHashes.plan_b_sha256 : null }, seat_provenance: { P0: { head: 'fable', model: 'fable' }, P1: seatProv(sinkS, 'sol') }, codex_receipt_hash: solCross.codex_receipt_hash, status: 'sealed' }, 'The Council')
        // The plans shim: the payload carries approach_summary/milestones; the lantern/plato read
        // plan-a.md / plan-b.md from disk (both written), UNCHANGED — anonymity preserved (no receipt/
        // model/token leaks in any lantern or plato prompt).
        plans = [
          { ...fablePlan, slot: 'a' },
          { slot: 'b', plan_file: `${plansDir}/plan-b.md`, approach_summary: solPayload.approach_summary, milestones: solPayload.milestones },
        ]
      }
    }
  } else {
    // Scope ruling item 6: a PROMISED council (T4 + codex) launched without the run token reaches
    // here (councilCapable false) on the FULL path — the promise never silently downgrades to a
    // clean v3.0.1 label. The v3.0.1 pair still drafts (a DRAFT plan for the operator), but the
    // council terminal is DEGRADED and the Law is BLOCKED. Lite and sub-T4 routes are untouched.
    if (councilPromised) await degradeCouncil('both', 'runToken absent — a T4 launch missing the conductor-minted run token cannot bind council receipts or the seed', 'The Council')
    const planners = [
      () => agent(
        voice('opus') +
        `You are the slot-A planner (Claude-side, deep reasoning). Write your plan to ${plansDir}/plan-a.md.\n${planBrief}`,
        { label: 'confucius:plan', phase: 'The Council', model: 'opus', schema: PLAN_SCHEMA }
      ),
      () => agent(
        codexAvailable
          ? `You are the slot-B planner (Codex-side). ${codexHowto} Write the plan to ${plansDir}/plan-b.md.\n${planBrief}`
          : `You are the slot-B planner (independent Sonnet reasoning — Codex unavailable). Write your plan to ` +
            `${plansDir}/plan-b.md, taking a deliberately different architectural angle so the comparison is meaningful.\n${planBrief}`,
        // Sun Tzu is the Codex seat; on the no-codex branch the Sonnet fallback is Miyamoto's
        // (a label must name the seat that actually runs — never a ghost credit).
        { label: codexAvailable ? 'sun-tzu:plan' : 'miyamoto:plan', phase: 'The Council', model: 'sonnet', schema: PLAN_SCHEMA }
      ),
    ]
    plans = (await parallel(planners)).filter(Boolean)
  }
  log(`${plans.length}/2 plans written (${plans.map((p) => p.slot).join(', ')})`)
  // architecture.plans_drafted (volume): the anonymized plan pair is on the table.
  await lore('architecture.plans_drafted', `${plans.length}/2 plans drafted (${plans.map((p) => p.slot).join(', ')})`, { plans: plans.length }, 'The Council')

  if (plans.length < 2) {
    // Council guard: a dead planner would leave diogenes a nonexistent plan file to read — skip
    // The Lantern and route to a single-plan synthesis brief instead.
    log(`Council guard: only ${plans.length}/2 plan(s) survived — skipping divergence; single-plan synthesis.`)
    const survivorFile = plans.length === 1 && plans[0].slot ? `${plansDir}/plan-${plans[0].slot}.md` : null
    synthBrief =
      `<inputs>\nRead (${noWander}): ${survivorFile ? `${survivorFile}, ` : ''}${docsDir}/architecture.md, ` +
      `${docsDir}/tech-stack.md, ${researchInList}${docsDir}/arch-constraints.md. Foundation summary: ${foundation && foundation.summary}\n</inputs>`
    synthLead = survivorFile
      ? `You are the plan chairman. Only one council plan survived — there is nothing to reconcile; author the ` +
        `plan from the surviving plan, the foundation docs${researchSummaryClause}.`
      : `You are the plan chairman. No council plan survived — author the plan directly from the foundation docs${researchSummaryClause}.`
  } else {
    // ── The Lantern: diogenes compares the two anonymized plans ──
    phase('The Lantern')
    const divergence = await agent(
      `You are the divergence extractor. ${noWander}\n\n` +
      `<inputs>\nThe two anonymized plans: ${plansDir}/plan-a.md and ${plansDir}/plan-b.md.\n</inputs>\n\n` +
      `<task>Write ${plansDir}/divergence-analysis.md and report: consensus (where both agree), divergences ` +
      `(point-by-point: what plan A says vs plan B), and unique insights each surfaced. Be neutral — do not pick a ` +
      `winner; surface the real decision points the chairman must resolve. Put the detail in the analysis file; ` +
      `emit analysis_file, consensus, divergences, and unique_insights first — reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
      { label: 'diogenes:divergence', phase: 'The Lantern', model: 'sonnet', schema: DIVERGENCE_SCHEMA }
    )
    log(`Divergence: ${(divergence && divergence.divergences || []).length} decision points`)
    // architecture.heads_agree / architecture.divergence_cut (keystones): the divergence set is read.
    const nDivergences = (divergence && divergence.divergences || []).length
    if (nDivergences === 0) await lore('architecture.heads_agree', `The heads drew the same map — zero divergences; ratification goes to the vote clean`, null, 'The Lantern')
    else await lore('architecture.divergence_cut', `Diogenes cuts the divergence set — ${nDivergences} decision point(s) divide the heads`, { divergences: nDivergences }, 'The Lantern')

    synthBrief =
      `<inputs>\nRead (${noWander}): ${plansDir}/plan-a.md, ${plansDir}/plan-b.md, ` +
      `${plansDir}/divergence-analysis.md, ${researchInList}${docsDir}/arch-constraints.md.\n</inputs>`
    synthLead =
      `You are the plan chairman. Synthesize the best of both plans, resolving each divergence with a rationale.`
  }
}

// ── One From Many: plato writes master-plan.md with confidence tiers + surfaces + executable ACs ──
phase('One From Many')
log(`${spin('synth', 0)}`)
let synth = await agent(
  voice('opus') +
  `${synthLead}\n${synthBrief}\n\n` +
  `<task>Write a single ${masterPlanFile}. Structure it as ordered milestones (M1, M2, …), each with ` +
  `acceptance criteria and a confidence tier (high/medium/low). Mark low-confidence milestones explicitly so ` +
  `build treats them carefully. ${rightSizeRule} ${surfaceRule} ${executableAcRule}${handoffFoldClause}\n` +
  `Write the file, then emit master_plan_file, milestone_count, and the milestone list (id, title, surface, confidence) first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
  { label: 'plato:synthesis', phase: 'One From Many', model: 'opus', schema: SYNTH_SCHEMA }
)
log(`master-plan.md: ${synth && synth.milestone_count} milestone(s) [${(synth && synth.milestones || []).map((m) => m.id + ':' + m.surface).join(', ')}]`)
// architecture.plan_synthesized (keystone): one master plan, written from the council's work.
await lore('architecture.plan_synthesized', `One map of truth — master-plan.md: ${synth && synth.milestone_count} milestone(s) [${oneLine((synth && synth.milestones || []).map((m) => m.id).join(', '), 80)}]`, { milestones: synth && synth.milestone_count }, 'One From Many')

// ── Athena Weighs: validator with a bounded plato-revision loop ──
phase('Athena Weighs')
log(`${spin('validate', 0)}`)
let verdict = null
// validationPasses is the number of Athena validation passes to run (BLUEPRINT §3.2 — NOT a revision
// count). The loop runs exactly validationPasses passes (round 0..validationPasses-1) and at most
// validationPasses-1 plato revisions (a revision happens only between two passes, after a non-final
// FAIL). So posture rounds=1 ⇒ one pass / zero revisions; rounds=3 ⇒ three passes / ≤2 revisions.
for (let round = 0; round < validationPasses; round++) {
  // Fail CLOSED: a null/crashed validator is a FAIL, never a silent PASS (the v2 fail-open
  // shipped an unvalidated plan under a green "Athena: PASS" log line).
  const val = (await agent(
    voice('opus') +
    `You are the plan validator — your sole job is to find holes, not to propose the solution.\n\n` +
    `<inputs>\n${masterPlanFile} (and ${visionFile}, ${docsDir}/arch-constraints.md${researchPresent ? `, ${researchFile}` : ''} for grounding). ${noWander}\n</inputs>\n\n` +
    `<task>Validate the plan on EVERY dimension: completeness vs VISION goals, milestone ordering/dependencies, ` +
    `testability (acceptance criteria PRESENT and written as EXECUTABLE checks — shell/pytest/HTTP/Playwright — not prose; ` +
    `fits "${testingRigor}" rigor), constraint adherence, ${researchPresent ? `research-grounding (no decision contradicts research), ` : ``}` +
    `feasibility, plan purity (no leftover dual-plan/identity cruft), surface tagging (every milestone tagged ` +
    `ui/logic/mixed, cut by the interface seam not the screen), SC-to-Law coverage (every SC has exactly one ` +
    `law.json check entry — so every acceptance criterion must carry a globally unique SC-NNN id; a missing or ` +
    `duplicate id makes the 1:1 compilation impossible and blocks the lock), and risk coverage. Return PASS only if ALL hold; ` +
    `else FAIL with the failed dimensions and concrete fixes. Emit verdict, failed_dimensions, and fixes first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
    { label: `athena:validate:r${round}`, phase: 'Athena Weighs', model: 'opus', schema: VALIDATION_SCHEMA }
  )) || { verdict: 'FAIL', failed_dimensions: ['validator-failure'], fixes: [] }
  verdict = val
  // architecture.athena_pass (volume): the plan validator passed it.
  if (val.verdict === 'PASS') { log(`Athena: PASS (pass ${round + 1}/${validationPasses})`); await lore('architecture.athena_pass', `Athena nods — PASS, pass ${round + 1}/${validationPasses}`, { pass: round + 1, passes: validationPasses }, 'Athena Weighs'); break }
  // architecture.athena_fail (volume): the plan failed every validation pass — escalating.
  if (round === validationPasses - 1) { log(`Athena still FAIL after ${validationPasses} pass(es) — escalating`); await lore('architecture.athena_fail', `Athena weighs FAIL — after ${validationPasses} pass(es) [${oneLine((val.failed_dimensions || []).join(', '), 80)}]; escalating`, { passes: validationPasses }, 'Athena Weighs'); break }
  log(`Athena FAIL [${(val.failed_dimensions || []).join(', ')}] — Plato revision round ${round + 1}`)
  // Null-keep: a crashed reviser must not wipe the last good synthesis.
  synth = (await agent(
    voice('opus') +
    `You are the plan chairman, revising ${masterPlanFile}.\n\n` +
    `<inputs>\nAthena failed it on: ${(val.failed_dimensions || []).join(', ')}.\nApply these fixes: ${(val.fixes || []).join(' | ')}\n${synthBrief}\n</inputs>\n\n` +
    `<task>Apply the fixes and rewrite the file (keep surfaces + executable acceptance criteria).${handoffFoldClause} Emit master_plan_file, the updated milestone_count, and milestone list first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
    { label: `plato:revise:r${round + 1}`, phase: 'One From Many', model: 'opus', schema: SYNTH_SCHEMA }
  )) || synth
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── The Twin Council: blind dual ratification of the master plan (constitution §1–4; sol-b34-design
//    §6). Runs at T4 on the FULL path once Athena PASSes and the draft pair sealed (no prior degrade).
//    Blind simultaneous verdicts → one bounded answer exchange on any BLOCK (executable checks settled
//    by exit code) → one blind re-verdict → an HONEST terminal (RATIFIED certificate / COUNCIL_DEADLOCK
//    / DEGRADED). The B3 fresh-context re-adjudication ladder slots between RATIFY_2 and the deadlock
//    terminal; until then the conductor's gated operator checkpoint is the resolution authority. ──
// ════════════════════════════════════════════════════════════════════════════════════════════════
const runTwinCouncilRatify = async () => {
  const phaseName = 'Athena Weighs'
  // The evidence docs a ratifier reads (anonymous — never named by authorship path).
  const evidenceDocs = [masterPlanFile, `${docsDir}/architecture.md`, `${docsDir}/tech-stack.md`, `${docsDir}/arch-constraints.md`, visionFile].concat(researchPresent ? [researchFile] : [])
  const ratifyInputs = `<inputs>\n- The master plan: ${masterPlanFile}\n- Evidence docs: ${evidenceDocs.join(', ')}\n</inputs>`
  const bindingLine = (bH, pH) => `Binding: artifact_hash = "${bH}" (echo it VERBATIM). plan_sha256 = ${pH}. evidence_manifest_hash = ${evidenceManifestHash}. divergence_selections = [] (no open divergences this round).`
  // F7: the round-two prompt carries THAT head's exchange evidence — the other head's answers to its
  // OWN standing findings, the executable-check transcripts where one ran, and the changes Plato
  // already applied. Attribution is only ever "the other head" — no identity, receipt, model, or
  // token rides in (the blindness rails extend here, test-asserted).
  const exchangeBlock = (exchange) => exchange
    ? `\n<exchange-evidence>\nAnswers from the other head to YOUR prior blocking findings (ACCEPT = the change is already applied to the plan; REFUTE = their evidence against it), the executable-check transcripts where one ran (the exit code already ruled), and the applied changes. The plan file is the AMENDED artifact.\n${JSON.stringify(exchange)}\n</exchange-evidence>\n`
    : ''
  const fableRatifyPrompt = (suffix, bH, pH, exchange) =>
    `You are a council ratifier (${suffix}) — rule the master plan against the fixed rubric, blind and independent.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${COUNCIL_RUBRIC}\n</rubric>\n\n` +
    `<binding>\n${bindingLine(bH, pH)}\n</binding>\n` +
    exchangeBlock(exchange) +
    `\n<task>${RATIFY_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const fableAnswerPrompt = (findings) =>
    `You are the OTHER head, answering blocking findings raised against the master plan, blind and independent.\n\n` +
    `${ratifyInputs}\n\n<findings-to-answer>\n${findings.map((f) => `- ${f.finding_id}: ${f.claim} → required_change: ${f.required_change}`).join('\n')}\n</findings-to-answer>\n\n` +
    `<task>${ANSWER_TASK} Emit answers first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
  const platoRevisePrompt = (changes) =>
    voice('opus') +
    `You are the plan chairman, revising ${masterPlanFile} to fold in the council-accepted corrections.\n\n` +
    `<inputs>\nAccepted required-changes (apply each):\n${changes.map((c) => `- ${c}`).join('\n')}\n</inputs>\n\n` +
    `<task>Apply the accepted changes and rewrite the file (keep surfaces + executable acceptance criteria + every SC id).${handoffFoldClause} Emit master_plan_file, the updated milestone_count, and milestone list first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
  // F2: an empty/duplicate/evidence-free BLOCK or NEITHER is an INVALID verdict — a head that fails to
  // seal a valid verdict is a missing head (constitution §8) ⇒ DEGRADED, never a silent standing-free
  // block that a bare round-two APPROVE could clear. Returns null (valid) or the defect string.
  const verdictShapeError = (r) => {
    if (!(r.verdict === 'BLOCK' || r.verdict === 'NEITHER')) return null
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
  // F8: an answer set is RELATIONALLY validated — exactly one answer per requested finding, no unknown
  // or duplicate ids, enum-legal, a REFUTE evidence-bound. An invalid set is a failed exchange duty by
  // the ANSWERING head ⇒ DEGRADED naming it (a schema-valid-but-empty set no longer sails through).
  const answerSetError = (requested, ans) => {
    const ids = requested.map((f) => f.finding_id)
    const list = ans && Array.isArray(ans.answers) ? ans.answers : null
    if (!list) return 'no answers array'
    const seen = new Set()
    for (const a of list) {
      if (!a || !ids.includes(a.finding_id)) return `answer targets an unknown finding '${a && a.finding_id}'`
      if (seen.has(a.finding_id)) return `duplicate answer for '${a.finding_id}'`
      seen.add(a.finding_id)
      if (a.answer !== 'ACCEPT' && a.answer !== 'REFUTE') return `answer for '${a.finding_id}' outside ACCEPT|REFUTE`
      if (a.answer === 'REFUTE' && !(Array.isArray(a.evidence_refs) && a.evidence_refs.length > 0)) return `REFUTE of '${a.finding_id}' carries no evidence`
    }
    for (const id of ids) if (!seen.has(id)) return `finding '${id}' left unanswered`
    return null
  }
  // runBlindVerdict — the sealed-before-exposed pair: Fable and receipt-attested Sol rule blind, in
  // parallel. Sol death / invalid receipt / failed cross-check ⇒ DEGRADED (constitution §8: a missing
  // head is degradation, not deadlock). BLINDNESS RAILS: the fable prompt never mentions
  // codex/receipt/session/Sol; the sol packet never mentions fable; neither reveals the plan's
  // authorship path or the run token/seed.
  const runBlindVerdict = async (phaseTag, suffix, bH, pH, exchange) => {
    const sinkF = {}, sinkS = {}
    const ex = exchange || {}
    // Sol-side exchange evidence (F7) rides the packet + one briefBody line; the fable-side rides the
    // <exchange-evidence> prompt block. Both carry ONLY that head's own-finding answers/transcripts.
    const solBrief = `${bindingLine(bH, pH)}\nRubric:\n${COUNCIL_RUBRIC}` +
      (ex.sol ? `\nExchange evidence for YOUR prior blocking findings (the other head's answers, the executable-check transcripts, the applied changes) rides in the packet's exchange field; the plan file is the AMENDED artifact.` : '')
    const solR = solWrapperPrompt({ phaseTag, attempt: 1, effort: 'xhigh', payloadSchema: RATIFY_SCHEMA, taskText: RATIFY_TASK, briefBody: solBrief, packetObj: { master_plan: masterPlanFile, evidence: evidenceDocs, artifact_hash: bH, plan_sha256: pH, evidence_manifest_hash: evidenceManifestHash, exchange: ex.sol != null ? ex.sol : null } })
    const [rF, rS] = await parallel([
      () => gateAgent(fableRatifyPrompt(suffix, bH, pH, ex.fable != null ? ex.fable : null), { label: `fable:ratify:${suffix}`, phase: phaseName, model: 'fable', effort: 'xhigh', twoHeads: 'required', schema: RATIFY_SCHEMA, provenance: sinkF }),
      () => gateAgent(solR.prompt, { label: `sol:ratify:${suffix}`, phase: phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(RATIFY_SCHEMA), provenance: sinkS }),
    ])
    let solCross = { ledger_verified: false }
    if (rS != null && sinkS.receipt_verified === true) solCross = await runSolCrossCheck(`sol:ratify:${suffix}`, phaseTag, solR.files.out, sinkS, rS, phaseName)
    pushSolReceipt(`sol:ratify:${suffix}`, sinkS, solCross)
    const solOk = rS != null && sinkS.receipt_verified === true && solCross.ledger_verified === true
    if (rF == null || !solOk) {
      const missing = rF == null && !solOk ? 'both' : (rF == null ? 'fable' : 'sol')
      await degradeCouncil(missing, `seat death at ${phaseTag} (${missing})`, phaseName)
      return { degraded: true }
    }
    return { degraded: false, rF, rS, sinkF, sinkS, solCross }
  }
  // runSolAnswerLeg — the Sol side of the answer exchange (receipt-attested, phase ANSWER_EXCHANGE).
  // Returns sink + cross so the ANSWER_EXCHANGE_SEALED checkpoint can carry provenance + receipt (F10).
  const runSolAnswerLeg = async (findings) => {
    const sink = {}
    const sol = solWrapperPrompt({ phaseTag: 'ANSWER_EXCHANGE', attempt: 1, effort: 'high', payloadSchema: ANSWER_SCHEMA, taskText: ANSWER_TASK, briefBody: `Findings to answer:\n${findings.map((f) => `- ${f.finding_id}: ${f.claim} → required_change: ${f.required_change}`).join('\n')}`, packetObj: { master_plan: masterPlanFile, evidence: evidenceDocs, findings } })
    const payload = await gateAgent(sol.prompt, { label: 'sol:answer', phase: phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(ANSWER_SCHEMA), provenance: sink })
    let cross = { ledger_verified: false }
    if (payload != null && sink.receipt_verified === true) cross = await runSolCrossCheck('sol:answer', 'ANSWER_EXCHANGE', sol.files.out, sink, payload, phaseName)
    pushSolReceipt('sol:answer', sink, cross)
    if (!(payload != null && sink.receipt_verified === true && cross.ledger_verified === true)) { await degradeCouncil('sol', 'Sol seat death during the answer exchange', phaseName); return { degraded: true } }
    return { degraded: false, payload, sink, cross }
  }

  // ── ratify-anchor r1: hash the (possibly Plato-revised) master plan — the binding plan_sha256.
  //    F3: ONLY a real 64-hex digest binds; anything else degrades — never a guessed/stale hash. ──
  const ra = await agent(planHashPrompt(masterPlanFile), { label: 'thoth:ratify-anchor:r1', phase: phaseName, model: 'haiku', schema: PLAN_HASH_SCHEMA })
  const planHash = ra && typeof ra.plan_sha256 === 'string' && SHA64_RE.test(ra.plan_sha256) ? ra.plan_sha256 : null
  if (!planHash) { await degradeCouncil('evidence', 'ratify-anchor produced no valid plan hash', phaseName); return }
  // The 1b-ii decision bundle: an EMPTY open-divergence set is the HONEST bundle — the mechanical
  // divergence machine is B3. common_trunk carries the plan + its hash + milestones.
  const bundleH = buildDecisionBundle({ common_trunk: { master_plan_file: masterPlanFile, plan_sha256: planHash, milestones: (synth && synth.milestones) || [] }, settled_decisions: {}, open_divergences: [], renderer_version: RENDERER_VERSION, evidence_manifest_hash: evidenceManifestHash }).hash

  // ── RATIFY_1: blind simultaneous verdicts ──
  const r1 = await runBlindVerdict('RATIFY_1', 'r1', bundleH, planHash, null)
  if (r1.degraded) return
  const vF1 = validateRatification(r1.rF, { bundle_hash: bundleH, open_divergence_ids: [] })
  const vS1 = validateRatification(r1.rS, { bundle_hash: bundleH, open_divergence_ids: [] })
  // F2 rail: an empty, duplicate-id, or evidence-free BLOCK/NEITHER is ALSO an invalid verdict — a
  // standing-free block would otherwise be clearable by a bare round-two APPROVE.
  const shapeF1 = verdictShapeError(r1.rF), shapeS1 = verdictShapeError(r1.rS)
  if (!vF1.valid || !vS1.valid || shapeF1 || shapeS1) {
    // A head that failed to seal a VALID verdict (bad echo / malformed / evidence-free findings) is a
    // missing head (constitution §8: a missing head is degradation, not deadlock) — fail closed.
    const fBad = !vF1.valid || !!shapeF1, sBad = !vS1.valid || !!shapeS1
    await degradeCouncil(fBad && sBad ? 'both' : (fBad ? 'fable' : 'sol'), `invalid ratification at RATIFY_1 (${[fBad ? `fable${shapeF1 ? `: ${shapeF1}` : ''}` : null, sBad ? `sol${shapeS1 ? `: ${shapeS1}` : ''}` : null].filter(Boolean).join('; ')})`, phaseName)
    return
  }
  if (r1.rF.verdict === 'APPROVE' && r1.rS.verdict === 'APPROVE') { await sealRatified(r1.rF, r1.rS, r1.sinkF, r1.sinkS, bundleH, planHash, r1.solCross, 'RATIFY_1_SEALED', phaseName); return }

  // ── Any BLOCK/NEITHER ⇒ exactly ONE answer exchange (constitution §3). A NEITHER is a legal verdict
  //    (§7): its findings name the defects, so it is treated like a BLOCK for the exchange. ──
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'RATIFY_1_SEALED', decision_bundle_hash: bundleH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { P0: sha256Hex(canonicalJson(r1.rF)), P1: sha256Hex(canonicalJson(r1.rS)) }, seat_provenance: { P0: seatProv(r1.sinkF, 'fable'), P1: seatProv(r1.sinkS, 'sol') }, codex_receipt_hash: r1.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  const standingFindings = (r) => (r.verdict === 'BLOCK' || r.verdict === 'NEITHER') ? (Array.isArray(r.findings) ? r.findings : []) : []
  const fableBlocks = standingFindings(r1.rF)
  const solBlocks = standingFindings(r1.rS)
  // ── Executable-check floor FIRST: a check is DATA until the bounded executor runs it — never let a
  //    head run its own check. Identity is SEAT-SCOPED (F4: `head|finding_id` — a same-string id from
  //    the other head can never alias; the scoping lives in the SCRIPT's keys, never in a prompt).
  //    Execution is FILE-BOUND (F9): the check text lands verbatim in a script file and ONE timeout
  //    wraps the whole thing. Three states: 'confirmed' (exit 0, id-matched — the defect is
  //    demonstrably present, class executed_check), 'refuted' (clean nonzero, id-matched — retired
  //    MECHANICALLY), 'unrun' (no projectPath / mute / garbled / id-mismatched transcript, OR the
  //    infrastructure exits 124/126/127 — timeout / not-executable / not-found mean the check never
  //    truly RAN, so it can neither confirm nor refute; the block STANDS as proposed_check. Scope
  //    ruling item 2 — the residual misclassification risk of a dependency failure deep in a compound
  //    is ACCEPTED and recorded; the blocking head re-rules at RATIFY_2 with the state visible). ──
  const seatKey = (head, id) => `${head}|${id}`
  const checkState = new Map() // seatKey → 'confirmed' | 'refuted' | 'unrun'
  const checkExit = new Map()  // seatKey → the id-matched exit code (null when the check never ran) — the TYPED evidence heads see
  if (!projectPath) log('TWIN COUNCIL: projectPath absent — executable checks are NOT run; every checked finding stands as proposed_check (fail-closed)')
  const INFRA_EXITS = [124, 126, 127] // timeout / found-but-not-executable / command-not-found
  const runChecksFor = async (head, findings) => {
    for (const f of findings) {
      if (!(f && typeof f.executable_check === 'string' && f.executable_check.trim() !== '')) continue
      const key = seatKey(head, f.finding_id)
      if (!projectPath) { checkState.set(key, 'unrun'); continue }
      const checkFile = `${councilDir}/check-${key.replace(/[^A-Za-z0-9._-]/g, '-')}.check.sh`
      const res = await agent(execCheckPrompt(f, checkFile), { label: `thoth:exec-check:${f.finding_id}`, phase: phaseName, model: 'sonnet', schema: EXEC_CHECK_SCHEMA })
      if (res && res.finding_id === f.finding_id && Number.isInteger(res.exit)) {
        checkExit.set(key, res.exit)
        checkState.set(key, res.exit === 0 ? 'confirmed' : (INFRA_EXITS.includes(res.exit) ? 'unrun' : 'refuted'))
      } else checkState.set(key, 'unrun')
    }
  }
  await runChecksFor('fable', fableBlocks)
  await runChecksFor('sol', solBlocks)
  const remainingFable = fableBlocks.filter((f) => f && f.finding_id && checkState.get(seatKey('fable', f.finding_id)) !== 'refuted') // answered by SOL
  const remainingSol = solBlocks.filter((f) => f && f.finding_id && checkState.get(seatKey('sol', f.finding_id)) !== 'refuted')      // answered by FABLE
  let solAnswers = { answers: [] }, fableAnswers = { answers: [] }
  let solAnswerSink = null, solAnswerCross = null, fableAnswerSink = null
  if (remainingFable.length) {
    const ans = await runSolAnswerLeg(remainingFable)
    if (ans.degraded) return
    // F8: relational validation — a schema-valid-but-incomplete answer set is a FAILED exchange duty
    // by the ANSWERING head (here Sol) ⇒ DEGRADED naming it.
    const err = answerSetError(remainingFable, ans.payload)
    if (err) { await degradeCouncil('sol', `invalid answer set from the Sol head (${err})`, phaseName); return }
    solAnswers = ans.payload
    solAnswerSink = ans.sink
    solAnswerCross = ans.cross
  }
  if (remainingSol.length) {
    fableAnswerSink = {}
    const fa = await gateAgent(fableAnswerPrompt(remainingSol), { label: 'fable:answer', phase: phaseName, model: 'fable', effort: 'high', twoHeads: 'required', schema: ANSWER_SCHEMA, provenance: fableAnswerSink })
    if (fa == null) { await degradeCouncil('fable', 'Fable seat death during the answer exchange', phaseName); return }
    const err = answerSetError(remainingSol, fa)
    if (err) { await degradeCouncil('fable', `invalid answer set from the Fable head (${err})`, phaseName); return }
    fableAnswers = fa
  }
  // ── Seal the exchange barrier FIRST (scope ruling item 3): ANSWER_EXCHANGE_SEALED is bound to
  //    bundle₁ — the artifact the answers were RENDERED AGAINST — and lands BEFORE Plato consumes the
  //    answers and BEFORE the rehash, so the sealed record can never absorb a post-hoc amendment.
  //    It carries the paired answer artifacts + both answer-leg provenances + the Sol answer leg's
  //    receipt hash (F10) — an unanswered side hashes its empty {answers:[]} honestly. ──
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'ANSWER_EXCHANGE_SEALED', decision_bundle_hash: bundleH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { P0: sha256Hex(canonicalJson(fableAnswers)), P1: sha256Hex(canonicalJson(solAnswers)) }, seat_provenance: { P0: fableAnswerSink ? seatProv(fableAnswerSink, 'fable') : null, P1: solAnswerSink ? seatProv(solAnswerSink, 'sol') : null }, codex_receipt_hash: solAnswerCross && solAnswerCross.codex_receipt_hash ? solAnswerCross.codex_receipt_hash : null, status: 'sealed' }, phaseName)
  // ACCEPTED findings' required_change texts → ONE plato revision. Acceptance is SEAT-SCOPED (F4):
  // Sol answers fable-raised findings, Fable answers sol-raised ones — a same-string id across heads
  // never aliases. REFUTE answers retire NOTHING by themselves — the blocking head re-rules having
  // seen them (peer refutation is re-verdict input, never a script-side retirement).
  const acceptedKeys = new Set()
  for (const a of (Array.isArray(solAnswers.answers) ? solAnswers.answers : [])) if (a && a.answer === 'ACCEPT') acceptedKeys.add(seatKey('fable', a.finding_id))
  for (const a of (Array.isArray(fableAnswers.answers) ? fableAnswers.answers : [])) if (a && a.answer === 'ACCEPT') acceptedKeys.add(seatKey('sol', a.finding_id))
  const acceptedChanges = [
    ...remainingFable.filter((f) => acceptedKeys.has(seatKey('fable', f.finding_id))),
    ...remainingSol.filter((f) => acceptedKeys.has(seatKey('sol', f.finding_id))),
  ].map((f) => f.required_change)
  if (acceptedChanges.length) {
    synth = (await agent(platoRevisePrompt(acceptedChanges), { label: 'plato:revise:council', phase: 'One From Many', model: 'opus', schema: SYNTH_SCHEMA })) || synth
  }
  // ── re-hash the amended plan + rebuild the bundle (bundleH2, planHash2). F3: a mute/invalid SECOND
  //    anchor ALSO degrades — the certificate must NEVER bind the stale pre-revision hash while the
  //    Law would compile the changed file. ──
  const ra2 = await agent(planHashPrompt(masterPlanFile), { label: 'thoth:ratify-anchor:r2', phase: phaseName, model: 'haiku', schema: PLAN_HASH_SCHEMA })
  const planHash2 = ra2 && typeof ra2.plan_sha256 === 'string' && SHA64_RE.test(ra2.plan_sha256) ? ra2.plan_sha256 : null
  if (!planHash2) { await degradeCouncil('evidence', 'post-revision rehash failed — the amended plan has no valid hash (never binding the stale pre-revision hash)', phaseName); return }
  const bundleH2 = buildDecisionBundle({ common_trunk: { master_plan_file: masterPlanFile, plan_sha256: planHash2, milestones: (synth && synth.milestones) || [] }, settled_decisions: {}, open_divergences: [], renderer_version: RENDERER_VERSION, evidence_manifest_hash: evidenceManifestHash }).hash
  // Standing blocks per head (own prior blocking findings minus the check-refuted), with HONEST
  // evidence classes (F5): a runner-CONFIRMED check is executed_check (a real execution happened); a
  // checked-but-unrun finding is proposed_check; an unchecked finding keeps its DECLARED class with
  // claim_type derived via claimTypeForClass — an unrecognized class stays as-is so compareEvidence
  // rules it INCOMPARABLE and the block stands (fail-closed; never coerce to scenario). At RATIFY_2
  // that head's APPROVE must carry changed_evidence equal-or-stronger, or the block STANDS
  // (validateRatification enforces the anti-capitulation rail via validateReversal).
  const standingBlockOf = (head) => (f) => {
    const hasCheck = typeof f.executable_check === 'string' && f.executable_check.trim() !== ''
    if (hasCheck) {
      const cls = checkState.get(seatKey(head, f.finding_id)) === 'confirmed' ? 'executed_check' : 'proposed_check'
      return { finding_id: f.finding_id, evidence: { class: cls }, claim_type: 'executable' }
    }
    return { finding_id: f.finding_id, evidence: { class: f.evidence_class }, claim_type: claimTypeForClass(f.evidence_class) }
  }
  const fableStanding = remainingFable.map(standingBlockOf('fable'))
  const solStanding = remainingSol.map(standingBlockOf('sol'))
  // F7 as bounded by scope ruling item 5: each round-two head sees, for its OWN standing findings
  // only — the finding itself (claim, required_change, evidence_refs, evidence_class), the other
  // head's answer (attributed ONLY as "the other head"), and the TYPED check state (state + exit
  // code ONLY — raw stdout/stderr tails NEVER enter any head prompt; they live on disk and in the
  // runner leg's transcript). No identity, receipt, session, model, or token count rides in.
  const exchangeFor = (head, own, peerAnswers) => {
    if (!own.length) return null
    const answersList = Array.isArray(peerAnswers.answers) ? peerAnswers.answers : []
    return {
      findings: own.map((f) => {
        const key = seatKey(head, f.finding_id)
        const a = answersList.find((x) => x && x.finding_id === f.finding_id) || null
        const hasCheck = typeof f.executable_check === 'string' && f.executable_check.trim() !== ''
        return {
          finding_id: f.finding_id,
          claim: f.claim,
          required_change: f.required_change,
          evidence_refs: Array.isArray(f.evidence_refs) ? f.evidence_refs : [],
          evidence_class: f.evidence_class != null ? f.evidence_class : null,
          other_head_answer: a ? { answer: a.answer, evidence_refs: a.evidence_refs, evidence_class: a.evidence_class != null ? a.evidence_class : null } : null,
          check: hasCheck ? { state: checkState.get(key) || 'unrun', exit: checkExit.has(key) ? checkExit.get(key) : null } : null,
        }
      }),
      applied_changes: acceptedChanges,
    }
  }
  const exchange = { fable: exchangeFor('fable', remainingFable, solAnswers), sol: exchangeFor('sol', remainingSol, fableAnswers) }

  // ── RATIFY_2: blind re-verdict over the amended bundle ──
  const r2 = await runBlindVerdict('RATIFY_2', 'r2', bundleH2, planHash2, exchange)
  if (r2.degraded) return
  const vF2 = validateRatification(r2.rF, { bundle_hash: bundleH2, open_divergence_ids: [], standing_blocks: fableStanding })
  const vS2 = validateRatification(r2.rS, { bundle_hash: bundleH2, open_divergence_ids: [], standing_blocks: solStanding })
  // A STRUCTURAL invalidity (bad echo / malformed / evidence-free findings — the F2 rail again) is a
  // missing head ⇒ DEGRADED; an unevidenced reversal is NOT structural — it leaves the prior block
  // standing (the anti-capitulation rail), which is persistent disagreement ⇒ COUNCIL_DEADLOCK below.
  const structuralErr = (v) => v.errors.some((e) => e.code !== 'unevidenced_reversal')
  const shapeF2 = verdictShapeError(r2.rF), shapeS2 = verdictShapeError(r2.rS)
  const fBad2 = structuralErr(vF2) || !!shapeF2, sBad2 = structuralErr(vS2) || !!shapeS2
  if (fBad2 || sBad2) { await degradeCouncil(fBad2 && sBad2 ? 'both' : (fBad2 ? 'fable' : 'sol'), `invalid ratification at RATIFY_2${shapeF2 ? ` (fable: ${shapeF2})` : ''}${shapeS2 ? ` (sol: ${shapeS2})` : ''}`, phaseName); return }
  if (r2.rF.verdict === 'APPROVE' && r2.rS.verdict === 'APPROVE' && vF2.valid && vS2.valid) {
    await sealRatified(r2.rF, r2.rS, r2.sinkF, r2.sinkS, bundleH2, planHash2, r2.solCross, 'RATIFY_2_SEALED', phaseName)
    return
  }
  // Persistent disagreement after RATIFY_2 (any surviving BLOCK/NEITHER, incl. dual NEITHER, or an
  // unevidenced-reversal block that STANDS). F10: round two is a completed paired barrier — seal
  // RATIFY_2_SEALED (verdict hashes + provenance + receipt) BEFORE the honest COUNCIL_DEADLOCK
  // terminal. Never synthesize, never pick a winner, never demote to a v3.0.1 label.
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'RATIFY_2_SEALED', decision_bundle_hash: bundleH2, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { P0: sha256Hex(canonicalJson(r2.rF)), P1: sha256Hex(canonicalJson(r2.rS)) }, seat_provenance: { P0: seatProv(r2.sinkF, 'fable'), P1: seatProv(r2.sinkS, 'sol') }, codex_receipt_hash: r2.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  const cards = [...standingFindings(r2.rF), ...standingFindings(r2.rS), ...fableStanding.filter(() => !vF2.valid && r2.rF.verdict === 'APPROVE'), ...solStanding.filter(() => !vS2.valid && r2.rS.verdict === 'APPROVE')].map((f) => ({ finding_id: f.finding_id, claim: f.claim || 'standing block (unevidenced reversal)', required_change: f.required_change || 'operator resolution' }))
  await deadlockCouncil(cards.length ? cards : [{ finding_id: 'ratify-2', claim: 'persistent disagreement', required_change: 'operator resolution' }], phaseName)
}
if (councilCapable && !liteScope && verdict && verdict.verdict === 'PASS' && councilTerminal === null) {
  await runTwinCouncilRatify()
}

// ── The Law: Asimov compiles the locked acceptance gates (BLUEPRINT §5/§5.1) ──
// A §3.4 FLOOR: the Law compiles + locks at ANY posture, lite path included. Runs only after
// Athena PASS (locking gates compiled from an unvalidated plan would lock the wrong law); every
// failure path returns law_locked:false + reason so the conductor escalates — never a silent
// proceed, never an unguarded build.
phase('The Law')
log(`${spin('law', 0)}`)
const lawFile = `${kilnDir}/law.json`
let lawLocked = false
let lawReason = null
let lawChecks = [] // hoisted: the return derives law_check_count from it on every path
if (!(verdict && verdict.verdict === 'PASS')) {
  lawReason = 'master plan never reached Athena PASS — the Law locks only a validated plan'
} else if (councilPromised && !liteScope && councilTerminal !== 'RATIFIED') {
  // On the twin-council path (PROMISED — a missing runToken cannot buy the way out; scope ruling
  // item 6) the Law's precondition is Athena PASS AND a valid certificate: a DEGRADED,
  // COUNCIL_DEADLOCK, or absent terminal locks nothing. Every OTHER path keeps the v3.0.1 precondition.
  lawReason = `master plan not council-ratified (${councilTerminal || 'no certificate'}) — on the twin-council path the Law locks only a ratified plan`
} else if (!projectPath) {
  lawReason = 'projectPath absent — acceptance checks are project-native (tests/acceptance/) and cannot be written'
} else {
  const lawVoice = lawModel === 'opus' ? voice('opus') : ''
  const asimov = await agent(
    lawVoice +
    `You are Asimov, the Lawgiver (BLUEPRINT §5). You compile the validated master plan's acceptance criteria ` +
    `into THE LAW: one locked, executable check per SC — the gates every build slice is judged against. ` +
    `You write checks only; you never implement the product.\n\n` +
    `<inputs>\nRead (${noWander}): ${masterPlanFile}, ${docsDir}/architecture.md, ${docsDir}/tech-stack.md, ` +
    `${docsDir}/arch-constraints.md.\n</inputs>\n\n` +
    `<task>\n` +
    `1. Enumerate EVERY acceptance criterion in the master plan as an SC id (SC-001, SC-002, …) — ADOPT the ` +
    `plan's ids VERBATIM where present (they carry VISION's Success Criterion ids forward — one identifier ` +
    `space VISION→plan→Law), assign sequential ones only where the plan left a criterion un-numbered; ids ` +
    `are globally unique across milestones.\n` +
    `2. For EACH SC write exactly ONE executable check under ${projectPath}/tests/acceptance/ (Bash ` +
    `'mkdir -p ${projectPath}/tests/acceptance' first) — project-native, the checks ship with the product. ` +
    `Choose the kind by the milestone's stack: 'shell' (a script exiting 0 on pass), 'pytest' (a test file), ` +
    `or 'http' (a script driving the running app's HTTP surface). Every check must FAIL right now (the product ` +
    `is unbuilt — checks are expected RED at lock) and pass only when its criterion is genuinely met; never ` +
    `write a check that trivially passes.\n` +
    `3. ui-surface SCs get kind 'probe' — a DECLARATIVE probe spec the kiln-probe engine executes as a ` +
    `bounded browser subprocess; builders never write, edit, or run probes. Write NO browser code of any ` +
    `kind — no Playwright scripts, no test runners; the spec is pure JSON authored from the SC text: ` +
    `{"url": <path to load, starting with '/'>, "landmarks": [{"role", "name"}, …] — the SC's key UI ` +
    `elements by role+name (never CSS selectors); EVERY landmark needs an ACCESSIBLE NAME — role AND name, ` +
    `both nonempty: use the plan's name verbatim where it names the element, and where it does not, derive ` +
    `a stable user-visible name from the SC text (the named landmark becomes part of the locked contract ` +
    `the build must expose — an unnamed landmark is a schema violation that blocks the lock), "interactions": ` +
    `[{"action": "click|fill|press|expect", "role", "name", "value", "key"}, …] in user order ONLY when ` +
    `the SC declares a behavior (click/expect need role+name; fill adds value; press needs key), optional ` +
    `"viewports": [{"width", "height"}] (default 1440×900), and ONLY when the stack needs its own server: ` +
    `"serve_cmd" (the exact serve command) + "base_url" (where it listens) — static deliverables omit ` +
    `both (kiln serves them itself; add "serve_dir" only if the served root is a subdirectory). Write the ` +
    `spec to ${projectPath}/tests/acceptance/<sc-id>.probe.json (lowercase id; the locked, project-native ` +
    `artifact — list it in the check's files) AND verbatim as the check's "spec" field in law.json. A ` +
    `probe's cmd stays empty (""); give probes timeout_s 120 (server start + a hard-killed 90s probe).\n` +
    `4. Write ${lawFile} matching law schema 1 EXACTLY: {"schema": 1, "lock_commit": null, "checks": [{"id", ` +
    `"milestone", "kind": "shell|pytest|http|probe", "cmd": <exact command run from the project root>, ` +
    `"files": [<this check's file paths, relative to the project root>], "sha256": {}, "expected": "exit0", ` +
    `"timeout_s": <integer seconds>, "spec": <the probe spec — kind 'probe' only, omitted otherwise>}]} — ` +
    `exactly ONE entry per SC. Leave every sha256 map EMPTY and ` +
    `lock_commit null; kiln-law index fills them (do NOT run it yourself, and do NOT commit).\n` +
    `Emit law_file, checks (the inventory: id, milestone, kind), and plan_sc_ids (every SC id you enumerated ` +
    `from the plan) first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}\n</task>`,
    { label: 'asimov:law', phase: 'The Law', model: lawModel, schema: LAW_COMPILE_SCHEMA }
  )
  lawChecks = (asimov && Array.isArray(asimov.checks)) ? asimov.checks : []
  const planScIds = (asimov && Array.isArray(asimov.plan_sc_ids)) ? asimov.plan_sc_ids : []
  if (!lawChecks.length) {
    lawReason = 'Asimov produced no check manifest'
  } else {
    // §5 coverage is ARITHMETIC, not judgment: every SC exactly one check entry. Duplicates,
    // uncovered SCs, and orphan checks all block the lock — locking a partial law would gate the
    // build against the wrong contract.
    const checkIds = lawChecks.map((c) => c.id)
    const dupes = checkIds.filter((id, i) => checkIds.indexOf(id) !== i).filter((id, i, a) => a.indexOf(id) === i)
    const uncovered = planScIds.filter((id) => !checkIds.includes(id))
    const orphans = checkIds.filter((id) => !planScIds.includes(id))
    const gaps = []
    if (dupes.length) gaps.push(`duplicate check ids: ${dupes.join(', ')}`)
    if (uncovered.length) gaps.push(`SCs with no check: ${uncovered.join(', ')}`)
    if (orphans.length) gaps.push(`checks with no plan SC: ${orphans.join(', ')}`)
    if (gaps.length) {
      lawReason = `SC↔check coverage failed — ${gaps.join('; ')}`
    } else if (!pluginRoot) {
      lawReason = 'pluginRoot absent — the kiln-law CLI cannot be located; the gates were written but never indexed/locked'
    } else {
      log(`Asimov compiled ${lawChecks.length} check(s) (${lawChecks.filter((c) => c.kind === 'probe').length} probe spec(s)) covering ${planScIds.length} SC(s) — dry-run gate before lock`)
      // architecture.law_compiled (volume): the gates are compiled — one check per SC, dry-run next.
      await lore('architecture.law_compiled', `Asimov compiles ${lawChecks.length} check(s) over ${planScIds.length} SC(s) — dry-run before the lock`, { checks: lawChecks.length, scs: planScIds.length }, 'The Law')
      // ── The dry-run gate (P3.5 T1, dogfood finding 1): checks are code; they execute before
      // we trust them — reading is not executing. `kiln-law dryrun` is legal PRE-LOCK (no
      // lock_commit, no tamper gate, no git) and leaves ZERO evidence residue: a dry-run is a
      // transcript, never a run record; probes stay deferred (§7's exit-78 semantics untouched).
      // Athena's testability duty moves onto EXECUTED evidence: per check she rules honest-red
      // (ran, failed on the missing feature — the greenfield expectation) vs broken-check
      // (crashed on its own code: traceback class, usage error, missing interpreter) vs
      // legitimately green (brownfield pre-satisfaction, recorded pre_satisfied at lock — §5.1).
      // Where the exit code carries the verdict the CLI's classification is mechanical and
      // non-relitigable — the deterministic floor below enforces it past any sloppy PASS;
      // Athena judges only what the code cannot (ambiguous tails, green legitimacy). Broken
      // checks go back to Asimov — the check-revision fix cycle, the same bounded shape as the
      // plato loop — and the dry-run re-runs. The lock proceeds ONLY when every executed check
      // is honest-red or legitimately green.
      const DRYRUN_PASSES = 3 // bounded like the plan loop: 3 dry-run passes / ≤2 Asimov check revisions
      let dryrunReason = null
      let greenLegit = []
      for (let round = 0; round < DRYRUN_PASSES; round++) {
        const dry = await agent(
          `You are Thoth, the scribe — transcribe, never judge, never fix.\n\n` +
          `<task>Run (Bash): node ${pluginRoot}/scripts/kiln-law.mjs dryrun ${projectPath} ${kilnDir} --json\n` +
          `It executes every compiled check pre-lock (probes defer) and prints ONE JSON object ` +
          `{schema, transcript, law_violations, summary}. Transcribe transcript AND law_violations VERBATIM ` +
          `into the schema — every entry, every field, nulls included (transcribe null as null — every field ` +
          `is required), and the full stdout_tail/stderr_tail strings — and report exit = the command's exit ` +
          `code. law_violations is usually empty; when the CLI reports typed law.json defects there, carry ` +
          `them verbatim. If the command itself fails, report its nonzero exit, an empty transcript, empty ` +
          `law_violations, and its output verbatim in error. Do not edit or fix anything.</task>`,
          { label: `thoth:dryrun:r${round}`, phase: 'The Law', model: 'sonnet', schema: DRYRUN_SCHEMA }
        )
        // Fail CLOSED: a dead scribe or a failed dry-run is a blocked lock, never a shrug.
        const transcript = (dry && dry.exit === 0 && Array.isArray(dry.transcript)) ? dry.transcript : []
        // RUN-B FINDING 1: a present-but-schema-invalid law.json is Asimov's OWN compilation
        // defect — the CLI transcribes it (exit 0, typed law_violations, empty transcript)
        // instead of dying, and THIS branch routes it to its author through the same bounded
        // revise cycle as a broken check. Athena is skipped for the round: the violations are
        // deterministic validator output — there is nothing to judge. The revision consumes a
        // DRYRUN_PASSES round like any other; exhausted rounds still end law_locked:false.
        const lawViolations = (dry && dry.exit === 0 && Array.isArray(dry.law_violations)) ? dry.law_violations : []
        if (!transcript.length && lawViolations.length) {
          if (round === DRYRUN_PASSES - 1) {
            dryrunReason = `law.json still schema-invalid after ${DRYRUN_PASSES} dry-run pass(es): ${lawViolations.map((v) => v.path).join(', ')}`
            break
          }
          log(`Dry-run gate: law.json is schema-invalid (${lawViolations.length} violation(s)) — Asimov law revision ${round + 1}`)
          await agent(
            lawVoice +
            `You are Asimov, the Lawgiver — revising THE LAW FILE itself. The pre-lock dry-run refused to ` +
            `execute: ${lawFile} violates law schema 1 — your own compilation defect, and yours to fix; the ` +
            `product is unbuilt by design and is NOT yours to touch.\n\n` +
            `<inputs>\nSchema violations (typed, verbatim from kiln-law):\n` +
            lawViolations.map((v) => `- [${v.code}] ${v.path}: ${v.message}`).join('\n') + `\n` +
            `The Law: ${lawFile}. Check code and probe twins live under ${projectPath}/tests/acceptance/.\n</inputs>\n\n` +
            `<task>Fix EXACTLY the named defects in ${lawFile} so it satisfies law schema 1. When a fix ` +
            `changes a probe's embedded "spec", regenerate the matching on-disk twin ` +
            `${projectPath}/tests/acceptance/<sc-id>.probe.json (lowercase id) so the two deep-equal — ` +
            `kiln-probe executes the embedded spec, the lock attests the twin; they must never diverge. ` +
            `Every probe landmark needs an ACCESSIBLE NAME — role AND name, both nonempty: use the plan's ` +
            `name verbatim where it names the element; where it does not, derive a stable user-visible name ` +
            `from the SC text (the named landmark becomes part of the locked contract the build must ` +
            `expose). Keep lock_commit null and every sha256 map EMPTY (do NOT run kiln-law index, do NOT ` +
            `commit). Never weaken a check to dodge a defect; never touch product code.</task>`,
            { label: `asimov:law-revise:r${round + 1}`, phase: 'The Law', model: lawModel }
          )
          continue
        }
        if (!transcript.length) {
          dryrunReason = `dry-run produced no transcript${dry && dry.error ? ` — ${dry.error}` : (dry ? ` (dryrun exit ${dry.exit})` : ' — the scribe produced no report')}`
          break
        }
        const ruling = (await agent(
          voice('opus') +
          `You are Athena — ruling testability over EXECUTED evidence, not static reading. Every compiled ` +
          `acceptance check just ran pre-lock (kiln-law dryrun); the full per-check transcript is below. The ` +
          `classification field is the CLI's deterministic exit-code table (pytest 1 = honest-red; pytest ` +
          `2-5, exit 126/127, timeout/signal = broken-check; exit 0 = green; any other nonzero = ambiguous; ` +
          `probes defer — exempt here).\n\n` +
          `<transcript>\n${JSON.stringify(transcript, null, 2)}\n</transcript>\n\n` +
          `<task>Rule PER CHECK from the transcript — the tails are the evidence:\n` +
          `- honest-red: the check RAN and failed because the feature is unbuilt — exactly what a pre-lock ` +
          `check must do. Rule an ambiguous entry honest-red only when its tail shows an honest ` +
          `assertion/expectation failure.\n` +
          `- broken-check: the check crashed on ITS OWN code — a traceback class (KeyError, argv handling), ` +
          `a usage error, a missing interpreter or command. Every deterministic broken-check entry STAYS ` +
          `broken; rule an ambiguous entry broken when its tail shows the check's own defect.\n` +
          `- legitimately green: exit 0 because the criterion is ALREADY met (brownfield) — list it in ` +
          `green_legitimate (recorded pre_satisfied at lock). A green check for an UNBUILT feature is a ` +
          `trivially-passing check — that is broken (it can gate nothing), never legitimate.\n` +
          `Verdict PASS only when every executed check is honest-red or legitimately green; else FAIL with ` +
          `the broken list (id, why, concrete fix). Emit verdict, broken, and green_legitimate first; ` +
          `reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
          { label: `athena:dryrun:r${round}`, phase: 'The Law', model: 'opus', schema: DRYRUN_RULING_SCHEMA }
        )) || { verdict: 'FAIL', broken: [{ id: '(ruling)', why: 'the ruling agent produced no verdict' }], green_legitimate: [] }
        // Deterministic floor under the ruling: a mechanical broken-check stays broken, and a
        // green check Athena did not rule legitimate has no lawful pre-lock state (the greenfield
        // expectation is RED) — both force the fix cycle even past a sloppy PASS. Arithmetic, not
        // judgment.
        const ruledLegit = Array.isArray(ruling.green_legitimate) ? ruling.green_legitimate : []
        const broken = (Array.isArray(ruling.broken) ? ruling.broken : []).slice()
        for (const t of transcript) {
          if (t.classification === 'broken-check' && !broken.some((b) => b.id === t.id)) broken.push({ id: t.id, why: 'deterministic broken-check (exit-code class)' })
          if (t.classification === 'green' && !ruledLegit.includes(t.id) && !broken.some((b) => b.id === t.id)) broken.push({ id: t.id, why: 'green but not ruled legitimately green — a check that passes against the unbuilt feature gates nothing' })
        }
        if (ruling.verdict === 'PASS' && !broken.length) {
          // Ruling-soundness guard: a pre_satisfied record must trace to an EXECUTED green. An id
          // ruled green_legitimate whose transcript classification is not 'green' (or which never
          // ran) is evidence the RULING itself is unsound — not the check broken, so the Asimov
          // fix cycle is the wrong remedy. Fail the gate CLOSED with the named offender(s); never
          // silently filter the id, never lock on an unsound ruling.
          const unsound = ruledLegit.filter((id) => !transcript.some((t) => t.id === id && t.classification === 'green'))
          if (unsound.length) {
            dryrunReason = `ruling unsound — green_legitimate names id(s) the executed transcript does not classify green: ${unsound.map((id) => { const t = transcript.find((x) => x.id === id); return `${id} (${t ? t.classification : 'not in transcript'})` }).join(', ')}; a pre_satisfied record must trace to an executed green`
            break
          }
          greenLegit = ruledLegit
          log(`Dry-run gate clean (pass ${round + 1}/${DRYRUN_PASSES}): every executed check honest-red or legitimately green${greenLegit.length ? ` (pre-satisfied: ${greenLegit.join(', ')})` : ''}`)
          break
        }
        if (round === DRYRUN_PASSES - 1) {
          dryrunReason = `broken check(s) after ${DRYRUN_PASSES} dry-run pass(es): ${broken.map((b) => b.id).join(', ')}`
          break
        }
        log(`Dry-run gate: ${broken.length} broken check(s) [${broken.map((b) => b.id).join(', ')}] — Asimov check revision ${round + 1}`)
        await agent(
          lawVoice +
          `You are Asimov, the Lawgiver — revising broken CHECK CODE. These checks crashed on their own ` +
          `defects at the pre-lock dry-run (Athena's ruling over the executed transcript, below); the ` +
          `product is unbuilt by design and is NOT yours to touch.\n\n` +
          `<inputs>\nBroken checks:\n${broken.map((b) => `- ${b.id}: ${b.why}${b.fix ? ` — fix: ${b.fix}` : ''}`).join('\n')}\n` +
          `The Law: ${lawFile}. The check code lives under ${projectPath}/tests/acceptance/.\n</inputs>\n\n` +
          `<task>Fix EXACTLY the named checks' own code so each one RUNS and fails honestly on the missing ` +
          `feature (or passes only when its criterion is genuinely met — never trivially). Update the ` +
          `matching law.json entries (cmd/files/timeout_s/spec) when the fix changes them — keep lock_commit ` +
          `null and every sha256 map EMPTY (do NOT run kiln-law index, do NOT commit). When an embedded ` +
          `probe "spec" changes (or the check was flagged for twin desync), regenerate the on-disk twin ` +
          `${projectPath}/tests/acceptance/<sc-id>.probe.json (lowercase id) so the two deep-equal — ` +
          `kiln-probe executes the embedded spec, the lock attests the twin; they must never diverge. ` +
          `Never weaken a check to dodge its defect; never touch product code or any other check.</task>`,
          { label: `asimov:check-revise:r${round + 1}`, phase: 'The Law', model: lawModel }
        )
      }
      if (dryrunReason) {
        lawReason = `dry-run gate failed — ${dryrunReason}; the lock is blocked (checks are code: they execute before we trust them)`
      } else {
        log(`Dry-run gate passed — locking`)
        // architecture.dryrun (volume): the checks ran clean pre-lock (they execute before we trust them).
        await lore('architecture.dryrun', `The gates run clean pre-lock — ${lawChecks.length} check(s) honest-red${greenLegit.length ? `, ${greenLegit.length} pre-satisfied` : ''}; the Law may lock`, { checks: lawChecks.length, pre_satisfied: greenLegit.length }, 'The Law')
        // Index BEFORE the single lock commit (the §5 sequence): kiln-law index hashes the on-disk
        // gates and records lock_commit = HEAD (the last pre-gate commit — git content-addressing
        // means law.json can never carry the sha of the commit that contains it). The one
        // "test(law): lock acceptance gates" commit that follows carries the gates + the indexed
        // law.json; the tamper gate's git arm anchors on that commit (lock_commit's first
        // descendant touching the locked paths), so laundering is caught from the moment the
        // gates land in history. Checks the dry-run gate ruled legitimately green are recorded
        // pre_satisfied IN the Law before index hashes it (§5.1 brownfield GREEN-at-lock — the
        // flip arithmetic excludes them and guards them as regressions instead).
        // Greenfield pre-flight (P3.5 T2, dogfood finding 2): architecture runs BEFORE build's
        // rakim git-init, so a greenfield projectPath has no repo when this leg fires — Run A's
        // lock failed honestly on exactly that and the conductor recovered by hand. The recovery
        // is now the contract: the lock sequence OWNS its git baseline. The branch is decided
        // MECHANICALLY from disk (one `ls .git` probe at run time) — the greenfield flag
        // describes intent, the disk states fact — so a brownfield repo is untouched
        // byte-for-byte and build's rakim init (already idempotent: "if not a git repo") never
        // creates a second baseline. The pre-flight is ONE self-contained command (the step-2
        // idiom — no cwd carry-over between agent Bash calls); identity is set LOCALLY and only
        // where none resolves. A skipped or botched pre-flight still fails closed at step 1:
        // kiln-law index refuses a HEAD-less repo with a named reason, never a deep-gate error.
        const preFlightStep =
          `PRE-FLIGHT, before any numbered step — the repo baseline. Decide MECHANICALLY from the disk, ` +
          `never from any flag (a flag describes intent; the disk states fact): run ` +
          `'ls -d "${projectPath}/.git"' (Bash). If it EXISTS, the repo is brownfield — change NOTHING ` +
          `about the repo (no init, no baseline commit, no identity edits); go straight to the numbered ` +
          `steps. If it does NOT exist (greenfield — the lock sequence owns its baseline), run exactly:\n` +
          `   cd "${projectPath}" && git init -q && (git config user.name >/dev/null || git config user.name "Kiln") && ` +
          `(git config user.email >/dev/null || git config user.email "kiln@localhost") && ` +
          `git add -A && git commit -m "chore: kiln build baseline"\n` +
          `(the config pairs set a LOCAL identity only where none resolves — never overwrite an existing ` +
          `one; the baseline commit is created here exactly once, never on an existing repo.)\n`
        const preSatStep = greenLegit.length
          ? `0. FIRST edit ${lawFile} (file tools): set "pre_satisfied": true on exactly the check entr${greenLegit.length === 1 ? 'y' : 'ies'} ${greenLegit.join(', ')} — ruled legitimately green at the pre-lock dry-run (brownfield, §5.1). Change NOTHING else in the file.\n`
          : ''
        const lock = await agent(
          `You are Thoth, the scribe — a law is only law once indexed and committed.\n\n` +
          `<task>Run these commands (Bash) IN THIS ORDER and report honestly. Index comes FIRST; the single ` +
          `lock commit that follows carries the gates AND the indexed law.json:\n` +
          preFlightStep +
          preSatStep +
          `1. node ${pluginRoot}/scripts/kiln-law.mjs index ${projectPath} ${kilnDir}\n` +
          `2. cd ${projectPath} && git add tests/acceptance .kiln/law.json && git commit -m "test(law): lock acceptance gates"\n` +
          `If a step fails (the pre-flight included), STOP — do not improvise a fix, do not amend, do not edit any ${greenLegit.length ? 'other ' : ''}file; report the ` +
          `failure verbatim in error. Report indexed (step 1 exited 0) and committed (step 2 succeeded).</task>`,
          { label: 'thoth:law-lock', phase: 'The Law', model: 'sonnet', schema: LAW_LOCK_SCHEMA }
        )
        // Fail CLOSED: a null/partial lock report is a failed lock, never a shrug.
        if (!(lock && lock.indexed === true && lock.committed === true)) {
          lawReason = `lock sequence failed${lock && lock.error ? ` — ${lock.error}` : (lock ? ` — indexed=${lock.indexed} committed=${lock.committed}` : ' — the locksmith produced no report')}`
        } else {
          // The contract's verifier: law.json + the lock commit EXIST — checked by a fresh pair of
          // eyes, not taken from the locksmith's own report.
          const lawProof = await agent(
            `You are the lock verifier.\n\n` +
            `<task>Run (Bash):\n` +
            `1. 'ls ${lawFile}' — law_json_exists = true iff the file exists.\n` +
            `2. 'git -C ${projectPath} log --format=%s -n 5' — lock_commit_exists = true iff one subject line is ` +
            `exactly "test(law): lock acceptance gates".\n` +
            `Do not read, write, or fix anything. Report the two booleans.</task>`,
            { label: 'thoth:law-verify', phase: 'The Law', model: 'haiku', schema: LAW_VERIFY_SCHEMA }
          )
          if (lawProof && lawProof.law_json_exists === true && lawProof.lock_commit_exists === true) {
            lawLocked = true
            log(`The Law is locked: ${lawChecks.length} check(s) committed as "test(law): lock acceptance gates"`)
            // architecture.law_locked (keystone): the gates lock before the first brick is laid.
            await lore('architecture.law_locked', `The gates lock before the first brick — ${lawChecks.length} check(s) committed as the Law`, { checks: lawChecks.length }, 'The Law')
          } else {
            lawReason = `lock verification failed — law.json exists: ${!!(lawProof && lawProof.law_json_exists)}, lock commit exists: ${!!(lawProof && lawProof.lock_commit_exists)}`
          }
        }
      }
    }
  }
}
if (!lawLocked) log(`THE LAW IS NOT LOCKED — ${lawReason}. The conductor must escalate; build must not start without locked gates.`)

// Await the parallel design:tokens leg (lever 6) before the stage closes — no architecture agent
// reads the design system, so this is the convergence point; the existence check below then sees
// the landed writes. Null on a crashed leg (already caught) — the existence verifier surfaces a
// genuinely missing artifact in the return value, never a phantom green.
if (designPromise) { await designPromise; log('Design tokens generated (visual direction present)') }

// ── Handoff doc for the build stage ──
// Lever 5: on the LITE path Plato already folded the handoff into its synthesis (no separate
// agent). Standard/complex keep the dedicated handoff pass — a non-trivial handoff earns its own.
if (!liteScope) {
  await agent(
    `You are the technical authority. ${noWander}\n\n` +
    `<inputs>\n${masterPlanFile}\n</inputs>\n\n` +
    `<task>Write ${handoffFile}: a concise build-stage handoff — the ordered milestone list, the tech stack, the ` +
    `non-negotiable constraints, and any low-confidence areas the build should watch. This is what the build stage reads first.</task>`,
    { label: 'numerobis:handoff', phase: 'The Law', model: 'sonnet' }
  )
} else {
  log('Handoff folded into Plato\'s synthesis (lever 5, lite path) — no separate handoff pass')
}

// Artifact existence check: v2 returned constructed paths without confirming the writes landed.
// One cheap haiku verifier ls-es the claimed files; misses surface in the log + return value.
const claimed = [`${docsDir}/architecture.md`, `${docsDir}/tech-stack.md`, `${docsDir}/arch-constraints.md`, masterPlanFile, handoffFile]
const existence = await agent(
  `You are the artifact existence verifier.\n\n` +
  `<task>For each path below, run 'ls <path>' (Bash). Return missing = exactly the paths that do not exist (an empty array if all exist). Do not read, write, or fix anything.\n` +
  claimed.map((p) => `- ${p}`).join('\n') + `\n</task>`,
  { label: 'thoth:verify', phase: 'The Law', model: 'haiku', schema: MISSING_SCHEMA }
)
const missing = (existence && existence.missing) || []
if (missing.length) log(`MISSING claimed artifact(s): ${missing.join(', ')}`)

// The council path label + honest reason (a consumer can NEVER derive twin_ratified or second-family
// verification from a non-council run). The PROMISED full path is 'twin_council' even when the
// runToken was missing (scope ruling item 6 — that run carries terminal DEGRADED, reason
// 'runToken absent', never a clean v301 label). Lite and sub-T4 stay 'v301'.
let councilPathReason = null
if (councilPromised && !liteScope) councilPathReason = councilCapable ? null : 'runToken absent'
else if (councilPromised && liteScope) councilPathReason = 'lite path'
else councilPathReason = 'sub-T4 tier'

// §3.5 stage bracket: stage_completed ONLY when the Law locked — the stage's one genuine-success
// criterion. law_locked:false (unlocked Law, blocked council, missing pluginRoot) is the conductor's
// escalation signal, never a completion: no event.
if (lawLocked) await runLedger('stage_completed', {}, 'The Law')

return {
  master_plan_file: masterPlanFile,
  milestone_count: synth && synth.milestone_count,
  validation: verdict && verdict.verdict,
  failed_dimensions: (verdict && verdict.failed_dimensions) || [],
  has_visual_direction: hasVisualDirection,
  scope: foundation && foundation.scope,
  lite_path: liteScope,
  surfaces: (synth && synth.milestones || []).map((m) => ({ id: m.id, surface: m.surface })),
  // The Law (§5): law_locked:false + law_reason is the conductor's escalation signal — the
  // build stage must never start against unlocked gates.
  law_locked: lawLocked,
  law_reason: lawLocked ? null : lawReason,
  law_file: lawFile,
  law_check_count: lawChecks.length,
  missing,
  // Twin Council (v3.0.2 B4-1b-ii) — ONE additive field. On every v3.0.1 route path:'v301' with an
  // honest reason; on the council path the terminal + certificate + receipts tell the true story.
  council: {
    eligible: councilPromised && !liteScope,
    tier: capabilityTier,
    path: (councilPromised && !liteScope) ? 'twin_council' : 'v301',
    terminal: councilTerminal,
    certificate: councilCertificate,
    // the RETAINED constructor record (F10): twin_degraded / council_deadlock (with its disagreement
    // cards) — null when RATIFIED (the certificate IS that record) and on every v3.0.1 route.
    terminal_record: councilTerminalRecord,
    blocked_reason: councilBlockedReason,
    receipts: councilReceipts,
    checkpoints: councilCheckpointCount,
    reason: councilPathReason,
  },
}
