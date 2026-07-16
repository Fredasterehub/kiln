export const meta = {
  name: 'kiln-architecture',
  description: 'Kiln architecture stage: foundation docs, then (for non-trivial scope) two anonymized plans (Claude ∥ Codex), divergence extraction, and chairman synthesis into master-plan.md, validated with a bounded fix loop. Right-sizes to a lite single-plan path for trivial scope. Tags every milestone with a build surface (ui/logic/mixed) so build routes models per slice, and requires acceptance criteria written as EXECUTABLE checks (validate exercises them literally).',
  phases: [
    { title: 'Laying Stone', detail: 'numerobis writes architecture/tech-stack/constraints docs from VISION + research' },
    { title: 'The Council', detail: 'two anonymized planners (Claude slot-a ∥ Codex slot-b) write plan-a.md / plan-b.md' },
    { title: 'The Lantern', detail: 'diogenes extracts consensus / divergences / unique insights' },
    { title: 'One From Many', detail: 'the renderer writes master-plan.md from the settled bundle on the T4-full path (plato authors on sub-T4/lite) — confidence tiers + surfaces + executable acceptance criteria' },
    { title: 'Athena Weighs', detail: 'athena validates the rendered plan; on FAIL, typed bundle amendments rerender (T4-full) or plato revises (≤2 rounds, sub-T4/lite)' },
    { title: 'The Law', detail: 'asimov compiles ONE executable check per SC (tests/acceptance/ + law.json); every check dry-runs pre-lock (athena rules honest-red vs broken-check over the executed transcript; asimov fixes broken checks AND his own schema-invalid law — typed violations route back, never dead-end); probe twins are checked embedded-vs-on-disk at dryrun and index; the lock leg pre-flights the git baseline (no .git ⇒ init + baseline commit — the disk decides, never the flag); kiln-law indexes; the gates lock in their own commit' },
  ],
}

// ── args: { kilnDir, projectPath, mode, testingRigor, codexAvailable, planning, validationRounds, lawModel, pluginRoot, runToken, capabilityTier } ──
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
// @inline:doctrine:PAYLOAD_FIRST
const kilnDir = A.kilnDir
if (!kilnDir) throw new Error('architecture.js requires args.kilnDir (absolute path to .kiln). Received args of type ' + typeof args)
const codexAvailable = A.codexAvailable !== false // default true; conductor passes kiln-doctor's probe result
const testingRigor = A.testingRigor || 'standard'
// projectPath is the project repo root — the Law's checks live there (tests/acceptance/ is
// project-native, the gates ship with the product) and the lock commit lands there. Absent ⇒ the
// Law cannot be compiled; the stage returns law_locked:false + reason (conductor escalates).
const projectPath = A.projectPath
// lawModel: Asimov the Lawgiver's model slot (default 'opus' — the workhorse; the conductor
// may pass another slot per capability tier).
const lawModel = A.lawModel || 'opus'
// pluginRoot is the conductor-resolved absolute $CLAUDE_PLUGIN_ROOT (a launched Workflow cannot
// see the env var). It locates the kiln-law CLI for the index/lock step; absence degrades to
// law_locked:false + reason — never a silent proceed, never a stage crash.
const pluginRoot = A.pluginRoot
// planning is the Gauge's posture.planning: 'dual' | 'single+redteam'
// | 'single', passed by the conductor. It decides whether The Council (two anonymized plans +
// divergence) runs or the single-plan chairman path is taken. Absent ⇒ null ⇒ the historical
// decider (foundation.scope === 'trivial') stands unchanged, so a run without a posture behaves
// exactly as before. 'dual' ⇒ run the council; 'single' ⇒ single-plan chairman path.
//
// SCOPE NOTE — 'single+redteam' currently routes like 'single', BY DESIGN. The arg is recognised,
// carried, and routed to the single-plan base path; the cross-family red-team critique the posture
// names is not yet wired in.
const planning = (A.planning === 'dual' || A.planning === 'single+redteam' || A.planning === 'single') ? A.planning : null
// validationRounds is the Gauge's posture.plan_validation_rounds (`1 + (D2>=1) + (D8=2)`). It is
// the count of Athena VALIDATION PASSES — NOT
// the revision count: posture rounds=1 means exactly ONE athena pass (zero plato revisions),
// rounds=2 means two passes (≤1 revision), etc. Absent ⇒ null ⇒ the historical pass count below
// (2 on the lite path, 3 otherwise, matching v2). A positive integer arg overrides it; garbage is
// ignored.
const validationRoundsArg = (Number.isInteger(A.validationRounds) && A.validationRounds > 0) ? A.validationRounds : null
// visualDirection: the conductor threads vision.js's validator-parsed
// visual_direction. When boolean it IS has_visual_direction — the decline-byte check lives in the
// vision gate now, so the foundation agent is NOT consulted for it. Absent (pre-v3 VISION, harness
// runs, a resume without the return) ⇒ null ⇒ the foundation agent judges it as the fallback, given
// the EXACT decline bytes (src/vision.mjs DECLINE_LINE, quoted — a workflow cannot import it).
const visualDirection = (typeof A.visualDirection === 'boolean') ? A.visualDirection : null
// ── Twin Council args. The council path REPLACES the v3.0.1
// draft/ratify machinery ONLY when the capability record promised BOTH heads (T4 = fable + codex)
// AND the conductor minted a runToken. Lite path and T1–T3 run the v3.0.1 machinery BYTE-IDENTICAL,
// capability-honestly labeled (never twin_ratified, never a council claim). A PROMISED council
// missing its runToken is NOT a clean v3.0.1 run — see councilPromised below. runToken is the
// conductor's per-run token (same recipe Build/Validate use); architecture uses it for the council
// SEED + the receipt-invocation binding, NEVER for browser kills. capabilityTier is T1|T2|T3|T4 from
// the freshest capability record (state.json.capability.tier); anything else ⇒ null. ──
const runToken = (typeof A.runToken === 'string' && A.runToken.length > 0) ? A.runToken : null
const capabilityTier = (A.capabilityTier === 'T1' || A.capabilityTier === 'T2' || A.capabilityTier === 'T3' || A.capabilityTier === 'T4') ? A.capabilityTier : null
// attended — is a human present to rule the gated operator checkpoint? Kiln runs UNATTENDED by default
// (the README doctrine), so the fresh-round ladder's ambiguity / both-one-way / cost-overflow rungs
// terminate as the honest COUNCIL_DEADLOCK; an operator-attended launch (A.attended === true) gets the
// gated checkpoint instead. It never changes a substantive verdict —
// only which HONEST no-adopt terminal (GATED_ESCALATION vs COUNCIL_DEADLOCK) records the operator hand-off.
const attended = A.attended === true
// freshRoundTier — the fresh-round sampling depth: 'base' = 1 sample/cell (8 calls per
// divergence), 'high' = 3 prompt-varied samples/cell (24 calls) for a per-posture instability hunt. Base
// unless the conductor pins high; garbage ⇒ base.
const freshRoundTier = A.freshRoundTier === 'high' ? 'high' : 'base'
// councilPromised = the capability record PROMISED both heads (T4 + codex); councilCapable adds the
// conductor-minted runToken. A PROMISED council missing its token is a MISCONFIGURED conductor — on
// the FULL path the council rules DEGRADED and the Law is BLOCKED (a promised
// guarantee never silently downgrades to a clean v3.0.1 label); lite and sub-T4 routes are untouched.
const councilPromised = capabilityTier === 'T4' && codexAvailable
const councilCapable = councilPromised && typeof A.runToken === 'string' && A.runToken.length > 0
if (councilPromised && !runToken) {
  log('MISCONFIGURED CONDUCTOR — capability tier T4 with both heads reachable but NO runToken: the twin council cannot bind its receipts/seed. On the twin-council path (full or lite) the council terminal is DEGRADED and the Law is BLOCKED (never a silent v3.0.1 downgrade). Relaunch with the per-run token to convene the council.')
}

const docsDir = `${kilnDir}/docs`
const plansDir = `${kilnDir}/plans`
const designDir = `${kilnDir}/design`
const visionFile = `${docsDir}/VISION.md`
const researchFile = `${docsDir}/research.md`
const masterPlanFile = `${kilnDir}/master-plan.md`
const handoffFile = `${kilnDir}/architecture-handoff.md`
// Athena validation-PASS counts (a "round" is one validation pass, not one revision): the full
// path runs 3 passes / ≤2 revisions, the lite path 2 passes / ≤1 revision; these hold exactly when
// no posture arg is given.
const FULL_VALIDATION_PASSES = 3
const LITE_VALIDATION_PASSES = 2

// @inline:guards:NO_WANDER
const noWander = NO_WANDER

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
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
  try { await runLedger('note', { kind: 'capability', event: 'claude_head_demoted', head: 'fable', claude_head: CLAUDE_HEAD_MODEL }, phaseName) } catch { /* best-effort beat */ }
}
// ── The single gateAgent (+ receipt attestation) — whole src/gate.mjs inlined verbatim (like build/
//    validate). The Twin Council's Sol seats are Sonnet wrappers over transport:'codex'; gateAgent
//    STRUCTURALLY validates the relayed receipt and fails a dead Sol seat closed to null. ──
// @gate
// ── Twin Council pure core — the deterministic council machinery inlined from src/council.mjs.
//    Every function that CALLS another travels WITH it in ONE marker (buildDivergenceSet is defined
//    locally, not inlined here). ──
// @inline:council:COUNCIL_PROTOCOL_VERSION,sha256Hex,canonicalJson,councilSeed,deriveId,parityTieBreak,claimTypeForClass,compareEvidence,validateReversal,canonicalizeFindings,canonicalizeRatifyFindings,validateDispositions,buildDivergenceSet,projectStructuredPlan,joinExactEquivalents,validatePlanClosure,buildDecisionBundle,bundleHash,renderMasterPlan,validateRatification,councilSignature,verifySignature,buildCheckpoint,matchCheckpoint,twinRatified,twinDeadlockResolved,councilDeadlock,degraded,FRESH_CELLS,freshRoundSchedule,normalizeCellVerdict,aggregateHead,aggregateCouncil,sealReversibility,buildMelRecord,SHA64_RE,RATIFY_SCHEMA,ANSWER_SCHEMA,envelopeSchema,CROSS_CHECK_SCHEMA,LEDGER_APPEND_SCHEMA,CANON_HASH_ONELINER,LEDGER_EXTRACT_ONELINER,councilTemplateHash,seatProv,solWrapperPlan,crossCheckOk,assembleRatifyCertificate,verdictShapeError
// The wrapper TRANSLATES (Goal/Context/Constraints/Done-when); it never forwards a Claude brief verbatim.
const codexHowto = `Delegate authoring to ${CODEX_MODEL}: TRANSLATE this brief into a 4-part Codex prompt — Goal (the deliverable in 1-2 sentences), Context (the file paths + summary; no full dumps), Constraints (the arch-constraints + "do X instead of Y"), Done-when (the file written + what it must contain) — write it to a fresh temp file ('TMP="$(mktemp /tmp/kiln-codex.XXXXXX.md)"'; a fixed path collides across concurrent runs) and pipe via stdin: 'codex exec -m ${CODEX_MODEL} -c model_reasoning_effort="high" --sandbox workspace-write --skip-git-repo-check < "$TMP"'. Do NOT forward this brief verbatim. If ${CODEX_MODEL} is unavailable retry with -m ${CODEX_FALLBACK}; if codex errors or yields nothing usable, author the plan yourself.`
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

// ── Structured authorship: the T4-FULL council path authors the milestone content the settlement
//    algebra projects: order/surface/confidence + acceptance rows with
//    Success-Criterion ids. Every field/collection is BOUNDED (packet-bound rail): title ≤120, summary
//    ≤600, criterion ≤400, executable_check ≤400, milestones ≤12, acceptance ≤8. additionalProperties
//    false throughout. PLAN_SCHEMA (above) stays byte-identical — sub-T4/lite planners share it. ──
const T4_MILESTONE_ITEM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' },
    title: { type: 'string', maxLength: 120 },
    summary: { type: 'string', maxLength: 600 },
    order: { type: 'integer' },
    surface: { type: 'string', enum: ['ui', 'logic', 'mixed'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    acceptance: {
      type: 'array', maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          sc_id: { type: 'string' },
          criterion: { type: 'string', maxLength: 400 },
          executable_check: { type: 'string', maxLength: 400 },
        },
        required: ['sc_id', 'criterion', 'executable_check'],
      },
    },
  },
  required: ['id', 'title', 'summary', 'order', 'surface', 'confidence', 'acceptance'],
}
const T4_MILESTONES_SCHEMA = { type: 'array', maxItems: 12, items: T4_MILESTONE_ITEM_SCHEMA }
// PLAN_SCHEMA_T4 — the fable T4-full DRAFT leg's schema ONLY (the sub-T4 planners keep PLAN_SCHEMA).
const PLAN_SCHEMA_T4 = {
  type: 'object', additionalProperties: false,
  properties: {
    slot: { type: 'string', enum: ['a', 'b'] },
    plan_file: { type: 'string' },
    approach_summary: { type: 'string' },
    milestones: T4_MILESTONES_SCHEMA,
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
// VALIDATION_SCHEMA_T4 — the T4-full Athena schema: the shared VALIDATION_SCHEMA plus
// the TYPED amendment channel. An Athena FAIL's accepted fixes carry structured amendment descriptors —
// { target_kind: 'settled_decision'|'trunk_field', key, replacement } — applied MECHANICALLY to the bundle
// (free-text `fixes` stay advisory on this path; the plato-revision arm is retired). Sub-T4/lite keep the
// byte-identical VALIDATION_SCHEMA above.
const VALIDATION_SCHEMA_T4 = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    failed_dimensions: { type: 'array', items: { type: 'string' } },
    fixes: { type: 'array', items: { type: 'string' }, description: 'advisory only on the T4-full path — apply structured amendments instead' },
    amendments: {
      type: 'array',
      description: 'the TYPED bundle amendments the accepted fixes reduce to (T4-full only)',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          target_kind: { type: 'string', enum: ['settled_decision', 'trunk_field'] },
          key: { type: 'string', description: 'an existing settled-decision topic or an amendable trunk field' },
          replacement: { description: 'the new value — must match the shape of the target\'s current value' },
        },
        required: ['target_kind', 'key', 'replacement'],
      },
    },
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

// Asimov's compile report — the inventory the in-script coverage arithmetic runs on
// (coverage is arithmetic, not judgment).
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

// The pre-lock dry-run transcript — Thoth transcribes the
// `kiln-law dryrun --json` output verbatim; the workflow feeds the FULL transcript to Athena's
// ruling pass. The classification field is the CLI's deterministic exit-code table, never the
// scribe's opinion. law_violations carries the CLI's typed law.json defects
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
    green_legitimate: { type: 'array', items: { type: 'string' }, description: 'green check ids whose criterion is GENUINELY already met (brownfield) — recorded pre_satisfied at lock' },
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
// ── TWIN COUNCIL scaffolding — all deterministic, script-side. Everything here is
//    INERT on the v3.0.1 paths (councilCapable === false): consts compute cheaply, functions are only
//    DEFINED, never called. It runs ONLY when councilCapable && !liteScope, so posture-args behavior
//    is byte-preserved. The debate middle (critiques → negotiation → divergence machine) and the
//    fresh-round re-adjudication ladder are defined further below.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const COUNCIL_TEMPLATE_VERSION = 'arch-council/1'
const RENDERER_VERSION = 'v301-plato/1'
const keystoneId = 'master_plan'
// Council artifacts under a per-run kilnDir with FIXED deterministic names (kilnDir is per-run, so
// fixed paths are collision-safe AND auditable — no mktemp for council artifacts). ONE receipt ledger
// per run: the receipt script's replay rejection then spans every council invocation of the run.
const councilDir = `${kilnDir}/council/master_plan`
const receiptsLedger = `${kilnDir}/council/receipts.jsonl`
// The sealed front-half decision bundle is persisted here (canonical bytes whose sha equals the
// barrier's decision_bundle_hash) so a resume rehydrates councilBundle/councilBundleHash/councilFrontHalf.
const decisionBundleFile = `${councilDir}/decision-bundle.json`
// The DEADLOCK_RESOLVED certificate is persisted here (canonical bytes whose sha equals the
// terminal row's bound certificate_hash) so build can RELOAD it and re-anchor the current plan against it
// before advancing — a stale row over a changed plan never authorizes.
const deadlockCertFile = `${councilDir}/deadlock-certificate.json`
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
  'evidence-free verdict is invalid. divergence_selections must cover EXACTLY the open divergences named ' +
  'in the binding — one selection (P0|P1|MERGED|NEITHER) per open card, none missing, none extra — and is ' +
  '[] if and only if the binding names no open divergences. ' +
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
// ── Debate task templates (critique / revision). Bound into templateHash so a debate-template
//    edit invalidates phase comparability (matchCheckpoint reuse doctrine). ──
const CRITIQUE_TASK =
  'Critique the OTHER head\'s anonymous implementation plan against the rubric — find the defects it hides, ' +
  'blind and independent. You do not know who authored it. Each finding: target_decision_id (the id of the ' +
  'decision/milestone in the plan you fault, verbatim as written), claim, required_change, severity ' +
  '(blocking|major|minor), and evidence{class (executed_check|proposed_check|repo_state|test_output|' +
  'primary_source|scenario — classify HONESTLY), refs[], executable_check (a bounded shell command, or null)}. ' +
  'Raise ONLY evidence-bound findings; an empty findings[] is the honest verdict when the plan is sound. ' +
  'Make no mention of authorship or of any peer.'
const REVISION_TASK =
  'Revise YOUR OWN anonymous plan in light of the frozen council findings raised against it. Dispose EVERY ' +
  'frozen finding EXACTLY once: accepted (fold the change into the plan and give incorporated_at — the ' +
  'section/decision ids where it landed), rejected_with_evidence (give evidence_refs AND evidence_class — ' +
  'a REJECTION is valid only when its rebuttal evidence is equal-or-stronger than the finding\'s), or ' +
  'unresolved. An unevidenced rejection is demoted to unresolved. Emit dispositions[] (one per finding_id), ' +
  'decisions[] (your revised decision registry: id, topic, value — the settled positions the divergence ' +
  'accounting reads), and the revised plan. Make no mention of authorship or of any peer.'
// ── T4-full authorship + negotiation templates. FIXED and PATH-FREE (no per-run
//    interpolation, so templateHash stays run-independent): the per-run file references are call-time
//    <inputs>, never baked in. T4_AUTHORSHIP_RULE is the structured-content template both heads' T4 draft
//    AND revision prompts carry (the original rightSizeRule/surfaceRule/executableAcRule consts below stay
//    UNTOUCHED — plato's sub-T4/lite paths keep consuming them verbatim). Binding both into templateHash
//    invalidates checkpoint comparability BY DESIGN (interrupted runs restart from frozen inputs). ──
const T4_AUTHORSHIP_RULE =
  `Right-size the milestone count to the deliverable's ACTUAL scope — a single small artifact is ONE ` +
  `milestone; reserve multiple milestones ONLY for genuinely independent, separately-buildable-and-verifiable ` +
  `components. Do NOT inflate the count or split one cohesive artifact into ceremony steps. Give every ` +
  `milestone an integer 'order' (1-based build order) and a 'surface': 'ui' = a front-facing surface and its ` +
  `tightly-coupled view logic; 'logic' = a separable backend concern behind an interface boundary; 'mixed' = ` +
  `ONLY when a milestone genuinely spans both. Cut slices by the interface SEAM, not by the screen. Give every ` +
  `milestone a 'confidence' tier (high|medium|low). Write EVERY acceptance criterion as an EXECUTABLE check, ` +
  `not prose — a shell command, a pytest invocation, an HTTP request with the expected response, or a ` +
  `Playwright step (validate exercises these literally). Give each acceptance row a Success Criterion id: ADOPT ` +
  `the VISION Success-Criteria ids VERBATIM where a criterion traces to one (read the Success Criteria section ` +
  `of the VISION doc named in your inputs), and MINT a new id only for a criterion the plan itself adds. Ids ` +
  `stay globally unique across ALL milestones (the Law compiles exactly ONE locked check per id).`
const NEGOTIATION_TASK =
  `Negotiate the open divergence cards, blind and independent. Each card carries two positions — position_0 ` +
  `and position_1 — where a position is a concrete plan value or the marker {absent:true} meaning "this ` +
  `decision does not belong in the plan". For EACH card return exactly one selection: 'P0' (adopt position_0), ` +
  `'P1' (adopt position_1), 'MERGED' (one reconciled value grounded in the cited evidence — supply it as ` +
  `merged_value), or 'NEITHER' (both readings are defective). Selecting an {absent:true} side rules the ` +
  `decision OUT. Introduce NO new decisions and respect the compatibility/requires constraints. Emit exactly ` +
  `one selection per divergence_id; make no mention of authorship or of any peer.`
// ── Fresh-context re-adjudication ladder task templates. FIXED + PATH-FREE (bound into
//    templateHash so a ladder-template edit invalidates FRESH_CARDS comparability, matchCheckpoint
//    doctrine). Each fresh cell is a CONTEXT-FREE adjudicator: it sees ONLY two options K/M, evidence,
//    the rubric — no debate history, no authorship, no peer, no seed. ──
const FRESH_CELL_TASK =
  'You are a fresh, independent adjudicator of ONE open plan divergence. You have NO prior context, no ' +
  'memory of any debate, and you do not know who authored either option or who else is ruling. Weigh the ' +
  'two options — K and M — against the rubric ONLY, on their merits. Return exactly one choice: "K" (option ' +
  'K is the sounder plan value), "M" (option M is sounder), "no_decision" (a deliberate abstention — the ' +
  'rubric does not distinguish them), or "NEITHER" (BOTH options are defective). A NEITHER MUST name at ' +
  'least one concrete blocking defect for EACH option in defects.K and defects.M. Judge on evidence, never ' +
  'on presentation order or which letter an option carries.'
const REFERENCE_REDUCTION_TASK =
  'A council divergence remains open after re-adjudication. Determine ONLY whether an EXISTING controlling ' +
  'reference — the VISION doc or the architecture constraints — already SETTLES which option is correct. Do ' +
  'not form a new opinion; report ONLY what the controlling reference dictates. Return settles=true with the ' +
  'settled side (P0 or P1) and the exact reference citation ONLY when a reference unambiguously rules; else ' +
  'settles=false. Where an executable check can demonstrate the reference constraint, supply it.'
const RUBRIC_AMEND_TASK =
  'A council divergence is deadlocked because the RUBRIC ITSELF is indeterminate on the axis in question. ' +
  'Propose whether ONE bounded rubric clarification would let the divergence be re-ruled. Return sign=true ' +
  'with the proposed clarification text ONLY if you genuinely judge the rubric under-specified here; else ' +
  'sign=false. Both heads must independently sign the SAME clarification for it to take effect — a rubric is ' +
  'never widened by one head alone. Make no mention of authorship or of any peer.'
const REVERSIBILITY_TASK =
  'A council divergence is deadlocked. Classify EACH option by REVERSIBILITY: "reversible" (adopting it now ' +
  'is a two-way door — cheaply undone later if wrong), "costly" (undoing it is expensive), or "irreversible" ' +
  '(a one-way door). Report P0 and P1 classifications HONESTLY; only options BOTH heads independently call ' +
  '"reversible" count as two-way doors. Make no mention of authorship or of any peer.'
// The Workflow host pins no temperature on agent(), so the high tier's "two
// low-temperature + one moderate probe" is realized as three samples per cell whose PROMPTS genuinely
// VARY — a FIXED per-sample framing text (bound into templateHash below) + the honest sample index. Sample
// 0/1 are independent low-variance reads; sample 2 is the deliberate moderate-variance instability probe.
// Any disagreement across samples is still instability (never majority-washed). The base tier uses only [0].
const FRESH_SAMPLE_FRAMINGS = [
  'Sampling mode: LOW variance (sample 0) — rule strictly on the evidence, taking the most defensible reading.',
  'Sampling mode: LOW variance (sample 1) — an INDEPENDENT re-read; anchor on no prior pass, weigh the evidence afresh.',
  'Sampling mode: MODERATE variance (sample 2) — an instability PROBE: consider the less-obvious reading and whether a defensible case flips the choice, then report your honest verdict.',
]
const templateHash = councilTemplateHash({ template_version: COUNCIL_TEMPLATE_VERSION, rubric: COUNCIL_RUBRIC, ratify_task: RATIFY_TASK, answer_task: ANSWER_TASK, draft_task: DRAFT_TASK, critique_task: CRITIQUE_TASK, revision_task: REVISION_TASK, authorship_rule: T4_AUTHORSHIP_RULE, negotiation_task: NEGOTIATION_TASK, fresh_cell_task: FRESH_CELL_TASK, fresh_sample_framings: FRESH_SAMPLE_FRAMINGS, reference_reduction_task: REFERENCE_REDUCTION_TASK, rubric_amend_task: RUBRIC_AMEND_TASK, reversibility_task: REVERSIBILITY_TASK })

// ── Council schemas ──
// SOL_DRAFT_PAYLOAD_SCHEMA — codex runs --sandbox read-only inside the receipt script, so it CANNOT
// write plan-b.md; the plan content rides the attested payload's plan_markdown.
const SOL_DRAFT_PAYLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 700 },
    approach_summary: { type: 'string' },
    milestones: T4_MILESTONES_SCHEMA,
    key_decisions: { type: 'array', items: { type: 'string' } },
    plan_markdown: { type: 'string' },
  },
  required: ['approach_summary', 'milestones', 'plan_markdown'],
}
// RATIFY_SCHEMA / ANSWER_SCHEMA / envelopeSchema / CROSS_CHECK_SCHEMA / LEDGER_APPEND_SCHEMA are the
// call-site-AGNOSTIC council schemas, LIFTED to src/council.mjs and inlined via the
// @inline:council marker above — this stage and build.js now share ONE copy (helpers, not copy-paste).
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
// SCRIBE_SCHEMA — the Thoth verbatim-bytes scribe reply: a workflow script cannot write files,
// so the renderer's markdown is written by a courier Thoth (the solByteOwnedPlan idiom). The reply is
// advisory — the SCRIPT's byte-compare (renderHash vs the file-read hash) is the real fidelity gate.
const SCRIBE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 300 }, written: { type: 'boolean' } },
  required: ['written'],
}
const EXEC_CHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, finding_id: { type: 'string' }, exit: { type: 'number' }, stdout_tail: { type: 'string' }, stderr_tail: { type: 'string' } },
  required: ['finding_id', 'exit', 'stdout_tail', 'stderr_tail'],
}
// ── Fresh-round ladder schemas. Each fresh cell returns ONE choice + (for a NEITHER) a named
//    blocking defect per option; the SCRIPT normalizes K/M back to canonical P0/P1 (normalizeCellVerdict)
//    and aggregates (aggregateHead — never majority-washed). ──
const FRESH_CELL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    choice: { type: 'string', enum: ['K', 'M', 'no_decision', 'NEITHER'] },
    defects: { type: 'object', additionalProperties: false, properties: { K: { type: 'array', items: { type: 'string' } }, M: { type: 'array', items: { type: 'string' } } } },
  },
  required: ['choice'],
}
const REFERENCE_REDUCTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    settles: { type: 'boolean' },
    adopt: { type: ['string', 'null'], enum: ['P0', 'P1', null] },
    reference: { type: ['string', 'null'] },
    executable_check: { type: ['string', 'null'] },
  },
  required: ['settles'],
}
const RUBRIC_AMEND_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, sign: { type: 'boolean' }, clarification: { type: ['string', 'null'] } },
  required: ['sign'],
}
const REVERSIBILITY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    P0: { type: 'string', enum: ['reversible', 'costly', 'irreversible'] },
    P1: { type: 'string', enum: ['reversible', 'costly', 'irreversible'] },
  },
  required: ['P0', 'P1'],
}

// ── Debate schemas (critique / revision). A head never sees a slot label (anonymity): the
//    SCRIPT assigns target_slot when it canonicalizes the findings. ──
// Every card-bearing field and collection carries a deterministic bound (an
// over-limit payload gated-escalates or degrades WITHOUT truncation — never summarized by a model). The
// ceilings, stated for the record: findings/dispositions ≤ 24; decisions ≤ 32; evidence_refs/incorporated_at
// ≤ 24 items, each ≤ 400; claim/required_change/reason ≤ 600; target_decision_id/finding_id/id ≤ 200;
// topic ≤ 200; executable_check ≤ 400. Organic decision VALUEs are canonical-byte-capped at PROJECTION
// (registryFor — DECISION_VALUE_MAX_BYTES), the one bound a JSON-schema node cannot express.
const CRITIQUE_EVIDENCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    class: { type: 'string', enum: ['executed_check', 'proposed_check', 'repo_state', 'test_output', 'primary_source', 'scenario'] },
    refs: { type: 'array', maxItems: 24, items: { type: 'string', maxLength: 400 } },
    executable_check: { type: ['string', 'null'], maxLength: 400 },
  },
  required: ['class', 'refs'],
}
const CRITIQUE_PAYLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    findings: {
      type: 'array', maxItems: 24,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          target_decision_id: { type: 'string', maxLength: 200 },
          claim: { type: 'string', maxLength: 600 },
          required_change: { type: 'string', maxLength: 600 },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
          evidence: CRITIQUE_EVIDENCE_SCHEMA,
        },
        required: ['target_decision_id', 'claim', 'required_change', 'severity', 'evidence'],
      },
    },
  },
  required: ['findings'],
}
// The disposition + revised-registry payload. value is a free JSON node — the script hashes it into
// the registry's value_hash (buildDivergenceSet compares by canonical value, never by prose). fable
// writes its revised plan-a.md itself (file tools), so revised_plan_markdown is OPTIONAL here; the Sol
// variant below makes it REQUIRED (codex runs read-only, so the plan rides the attested payload).
const REVISION_PAYLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    dispositions: {
      type: 'array', maxItems: 24,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          finding_id: { type: 'string', maxLength: 200 },
          disposition: { type: 'string', enum: ['accepted', 'rejected_with_evidence', 'unresolved'] },
          evidence_refs: { type: 'array', maxItems: 24, items: { type: 'string', maxLength: 400 } },
          evidence_class: { type: 'string', enum: ['executed_check', 'proposed_check', 'repo_state', 'test_output', 'primary_source', 'scenario'] },
          incorporated_at: { type: 'array', maxItems: 24, items: { type: 'string', maxLength: 200 } },
          reason: { type: 'string', maxLength: 600 },
        },
        required: ['finding_id', 'disposition'],
      },
    },
    decisions: {
      type: 'array', maxItems: 32,
      items: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string', maxLength: 200 }, topic: { type: 'string', maxLength: 200 }, value: {} },
        required: ['id', 'topic'],
      },
    },
    // A T4 revision RE-EMITS the full revised structured milestone content — the
    // projection source is the REVISION payload, never the original draft.
    milestones: T4_MILESTONES_SCHEMA,
    revised_plan_markdown: { type: 'string' },
  },
  required: ['dispositions', 'decisions', 'milestones'],
}
const SOL_REVISION_PAYLOAD_SCHEMA = { ...REVISION_PAYLOAD_SCHEMA, required: ['dispositions', 'decisions', 'milestones', 'revised_plan_markdown'] }
// NEGOTIATION_PAYLOAD_SCHEMA — one selection per open divergence card. merged_value is
// a free JSON node (present when selection is MERGED). Bounded (≤24 selections — the card ceiling).
const NEGOTIATION_PAYLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    selections: {
      type: 'array', maxItems: 24,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          divergence_id: { type: 'string' },
          selection: { type: 'string', enum: ['P0', 'P1', 'MERGED', 'NEITHER'] },
          merged_value: {},
          rationale: { type: 'string', maxLength: 400 },
        },
        required: ['divergence_id', 'selection'],
      },
    },
  },
  required: ['selections'],
}
// VISION_SCIDS_SCHEMA — a haiku greps VISION's Success-Criteria ids; the SCRIPT re-extracts
// them from the raw grep output with the fixed deterministic regex (extractVisionScIds) so the id set is
// script-owned, never model-judged.
const VISION_SCIDS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, sc_text: { type: 'string' } },
  required: ['sc_text'],
}
// RESUME_SCHEMA — the prior SEALED council_state checkpoints a resume reads back. Permissive on
// each checkpoint (matchCheckpoint reads objects it canonicalizes), so a real ledgered checkpoint is
// never schema-rejected; only phase + status are demanded.
const RESUME_CHECKPOINT_SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    kind: { type: 'string' }, protocol_version: { type: ['string', 'null'] }, template_hash: { type: ['string', 'null'] },
    run_token_hash: { type: ['string', 'null'] }, initial_ledger_seq: { type: ['number', 'null'] }, keystone_id: { type: ['string', 'null'] },
    phase: { type: 'string' }, decision_bundle_hash: { type: ['string', 'null'] },
    input_artifact_hashes: { type: 'array', items: { type: 'string' } }, evidence_manifest_hash: { type: ['string', 'null'] },
    anonymous_seat_artifact_hashes: { type: 'object' }, seat_provenance: { type: 'object' },
    codex_receipt_hash: { type: ['string', 'null'] }, status: { type: 'string' },
  },
  required: ['phase', 'status'],
}
const RESUME_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, checkpoints: { type: 'array', items: RESUME_CHECKPOINT_SCHEMA } },
  required: ['checkpoints'],
}

// ── Council STATE (hoisted): the draft flow binds the evidence; the ratify flow, the Law gate, and
//    the return envelope read it. councilSeedDigest is the run-bound entropy (councilSeed) reserved
//    for divergence-id derivation; it NEVER appears in any prompt (anonymity + tie-break rails).
//    SHA64_RE is lifted to src/council.mjs and inlined via the @inline:council marker. ──
let councilTerminal = null           // 'RATIFIED' | 'DEADLOCK_RESOLVED' | 'COUNCIL_DEADLOCK' | 'GATED_ESCALATION' | 'BLOCKED' | 'DEGRADED' | null
let councilCertificate = null        // twinRatified output or null
let councilTerminalRecord = null     // the degraded()/councilDeadlock() constructor record (null when RATIFIED — the certificate IS that record)
let councilBlockedReason = null      // human string on DEGRADED/DEADLOCK, else null
const councilReceipts = []           // [{ leg, invocation_id, receipt_verified, ledger_verified, session_id, tokens_used }]
let councilCheckpointCount = 0
let evidenceManifestHash = null
let evidenceInputHashes = []
let councilInitialSeq = null
let councilSeedDigest = null
// The sealed front-half decision bundle (settled_decisions array + open_divergences + hash).
// It is the DISCLOSED intermediate — NON-authoritative this freeze (plato/Athena/ratify run unchanged);
// the authority swap consumes it. Null off the T4 full path / before the front-half seals.
let councilFrontHalf = null
// The AUTHORITATIVE decision bundle consumed by the renderer/ratify swap (T4 full path only).
// councilBundle/councilBundleHash are the CURRENT bundle + hash (mutated by every accepted amendment —
// Athena's typed amendments and the ratify agreed-selection resolutions rebuild them); renderManifest is
// the SC-id→final-milestone-id map of the last render (the manifest-vs-Law comparison reads it);
// renderMilestones is the ordered milestone records (the return envelope populates from it — no sort
// replication). All null off the T4-full path / before the front-half seals (councilFrontHalf remains the
// pre-swap disclosed record).
let councilBundle = null, councilBundleHash = null, renderManifest = null, renderMilestones = null
// The anonymous P0/P1 slots are assigned by SCRIPT from the hidden seed parity (run-bound,
// deterministic, never in a prompt) AFTER the draft receipts freeze — NOT by seat identity. The plan
// files stay seat-bound (plan-a = fable, plan-b = sol); ONLY the SLOT LABELS decouple. Provenance still
// records head-per-slot (audit, not exposure). fableSlot/solSlot are assigned AFTER both required heads
// and the Sol receipt/cross-check validate — before the first slot-keyed checkpoint (DRAFTS_SEALED full /
// LITE_RATIFY_SEALED lite) or consumer — never at the bare seed mint. slotOf(head) is the ONE mapping
// every consumer — critique targets, disposition filters, canonicalize target_slots, projection slot args,
// checkpoint seat hashes + provenance, R-key bySlot keys, the negotiation/fresh-cell position_0/1 sides
// (via the P0/P1-ordered registries), and the certificate pairing — threads through. Null until assigned
// (off the council path, or before both legs validate).
let fableSlot = null, solSlot = null
const slotOf = (head) => head === 'fable' ? fableSlot : solSlot

// The pinned cross-check one-liners (CANON_HASH_ONELINER / LEDGER_EXTRACT_ONELINER) and seatProv are
// lifted to src/council.mjs and inlined via the @inline:council marker — this stage and
// build.js share ONE copy of the cross-check transcription strings + the per-head provenance snapshot.

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
  // Count ONLY confirmed appends — the return's checkpoint count is an audit figure, and an
  // unconfirmed append must not inflate it. Degrade-to-log, never a stage failure.
  if (res && res.appended === true) councilCheckpointCount++
  else log(`council checkpoint ${fields.phase} append NOT confirmed — not counted (scribe ${res ? 'reported failure' : 'was mute'})`)
}

// degradeCouncil — a promised head died / a receipt failed (Degradation, NOT deadlock):
// mark DEGRADED, ledger the terminal checkpoint, log loudly. The Law is BLOCKED and the stage still
// returns. Idempotent: a first terminal wins.
const degradeCouncil = async (missing, reason, phaseName) => {
  // First terminal wins; the constructor record is RETAINED into the return — an audit
  // consumer gets the structured twin_degraded record, not just a string.
  const firstDegrade = councilTerminal === null
  if (firstDegrade) { councilTerminal = 'DEGRADED'; councilBlockedReason = reason; councilTerminalRecord = degraded({ missing, reason }) }
  log(`TWIN COUNCIL DEGRADED — missing '${missing}' head (${reason}); the master plan cannot advance as council-ratified. The Law is BLOCKED; the conductor must escalate (gated operator checkpoint).`)
  // architecture.council_degraded (keystone): a promised head is missing — the Law stays blocked.
  if (firstDegrade) await lore('architecture.council_degraded', `TWIN COUNCIL DEGRADED — the ${missing} head is missing (${oneLine(reason, 80)}); the Law stays blocked for the operator`, { missing, reason: oneLine(reason, 80) }, phaseName)
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing, reason }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
}

// deadlockCouncil — persistent disagreement after two valid receipt-complete rounds:
// an HONEST fail. The fresh-context re-adjudication ladder rules DIVERGENCES
// between RATIFY_2 and this terminal; a CARD-LESS verdict deadlock, or the ladder's own unattended
// exhaustion, lands HERE — the existing deadlock honesty is now the TERMINAL rung, not the only rung.
// Never synthesize, never pick a winner, never demote to v3.0.1. `reason` overrides the default wording
// when the ladder terminates here (unattended ambiguity / both-one-way).
const deadlockCouncil = async (divergences, phaseName, reason) => {
  // First terminal wins; the structured councilDeadlock record (the disagreement cards) is RETAINED
  // into the return — the operator rules from the full artifact, not a log line.
  if (councilTerminal === null) {
    councilTerminal = 'COUNCIL_DEADLOCK'
    councilBlockedReason = reason != null ? reason : 'twin council deadlock — persistent disagreement survived the ratification rounds; the operator resolves with the full structured disagreement artifact'
    councilTerminalRecord = councilDeadlock({ divergences, last_ratified_hash: null })
  }
  log(`TWIN COUNCIL DEADLOCK — ${reason != null ? oneLine(reason, 120) : 'persistent disagreement survived RATIFY_2'}; the Law is BLOCKED, last ratified state preserved, NO stage_completed. Operator resolution required.`)
  // architecture.council_deadlock (keystone): disagreement survived re-ratification — the operator rules.
  await lore('architecture.council_deadlock', `TWIN COUNCIL DEADLOCK — disagreement survived re-ratification; the Law stays blocked, the operator rules`, null, phaseName)
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'COUNCIL_DEADLOCK', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
}

// blockCouncil — a LIVE, valid head returned a BLOCK/NEITHER on the single lite plan. The
// lite form runs ONE blind round (no answer exchange, no re-adjudication ladder), so this is neither a
// DEGRADED (no head died) nor a COUNCIL_DEADLOCK (nothing survived RATIFY_2 — the lite path has no
// RATIFY_2): it is an HONEST block. Mark BLOCKED, retain the blocking findings, ledger the terminal,
// log loudly. The Law is BLOCKED and the stage still returns. Idempotent: a first terminal wins.
const blockCouncil = async (findings, reason, phaseName) => {
  const firstTerminal = councilTerminal === null
  if (firstTerminal) {
    councilTerminal = 'BLOCKED'
    councilBlockedReason = reason
    councilTerminalRecord = { terminal: 'BLOCKED', label: 'council_blocked', findings: (Array.isArray(findings) ? findings : []).map((f) => ({ finding_id: f.finding_id, claim: f.claim, required_change: f.required_change })), reason }
  }
  log(`TWIN COUNCIL BLOCKED — ${reason}; the lite master plan cannot advance as council-ratified. The Law is BLOCKED; the conductor must escalate (gated operator checkpoint).`)
  // architecture.council_blocked (keystone): a live head blocked the lite plan — the Law stays blocked.
  if (firstTerminal) await lore('architecture.council_blocked', `TWIN COUNCIL BLOCKED — the lite plan drew a block (${oneLine(reason, 80)}); the Law stays blocked for the operator`, { reason: oneLine(reason, 80) }, phaseName)
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'BLOCKED', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
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
// The sealed decision-bundle bytes are PERSISTED at the front-half barrier so a resume can
// REHYDRATE the structured authority (not merely log). scribeBytesPrompt writes a JSON string's literal
// text verbatim to a file (hash-checked); readBundlePrompt reads it back (content + sha) for verify + parse.
const scribeBytesPrompt = (file, text) =>
  `You are Thoth, the scribe — BYTES ONLY. You author nothing and reformat nothing.\n\n` +
  `<task>Write ${file} (file tools): decode the JSON string below to its literal text and write THAT text VERBATIM — do not edit, reword, reformat, wrap, or "improve" anything; the bytes are hash-checked.\n` +
  `${JSON.stringify(text)}\n` +
  `Report written = true iff you wrote the file.</task>`
const READ_BUNDLE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, content: { type: 'string' }, sha256: { type: ['string', 'null'] } },
  required: ['content'],
}
const readBundlePrompt = (file) =>
  `You are Thoth, the ledger reader — transcribe, never judge, never fix.\n\n` +
  `<task>Run (Bash): 'cat ${file} 2>/dev/null' and 'sha256sum ${file} 2>/dev/null'. Report content = the cat output's raw bytes VERBATIM (empty string if the file does not exist) and sha256 = the sha256sum digest (lowercase hex, or null if absent). Do not write or fix anything.</task>`
// Pinned commands carry every path argument SHELL-QUOTED — a space or glob
// char in a per-run path must never split or expand an EXACT command.
const crossCheckPrompt = (outFile, outputSha, sessionId) =>
  `You are Thoth, the receipt cross-checker — transcribe, never compose, never judge. Run these three EXACT commands (Bash) and transcribe their output.\n\n` +
  `<task>\n` +
  `1. run EXACTLY: sha256sum "${outFile}" — output_sha256_disk = the 64-hex digest (the first field only).\n` +
  `2. run EXACTLY: node -e '${CANON_HASH_ONELINER}' "${outFile}" — output_canonical_sha256 = its stdout (a 64-hex digest).\n` +
  `3. run EXACTLY: node -e '${LEDGER_EXTRACT_ONELINER}' "${receiptsLedger}" "${outputSha}" "${sessionId}" — ledger = the { verified, reservation } JSON it prints (this leg's verified row + its reservation; nulls where unmatched).\n` +
  `Emit output_sha256_disk, output_canonical_sha256, and the ledger object. Do not read the files for content, do not write or fix anything.</task>`
// execCheckPrompt: the check text is written VERBATIM to a script file, then ONE timeout
// boundary wraps the WHOLE file — a shell compound (`cmd; other`) can no longer escape the bound.
const execCheckPrompt = (finding, checkFile) =>
  `You are the bounded check executor — run ONE proposed check and transcribe its result; never fix, never judge, never edit any product file.\n\n` +
  `<task>\n` +
  `1. Bash 'mkdir -p "${councilDir}"', then WRITE the check text between the check tags below to ${checkFile} VERBATIM (file tools) — do not edit, reorder, or reinterpret it:\n` +
  `<check>\n${finding.executable_check}\n</check>\n` +
  `2. Run EXACTLY (Bash): cd "${projectPath}" && timeout 120 bash "${checkFile}"\n` +
  `   (ONE timeout boundary around the whole check — compounds included.)\n` +
  `Report finding_id "${finding.id != null ? finding.id : finding.finding_id}" verbatim, exit = the command's exit code (124 on timeout), and the last lines of its stdout in stdout_tail and stderr in stderr_tail. Do not edit or fix anything — the check is DATA, you only run it.</task>`
// fableDraftPrompt — the T4-full fable DRAFT leg (councilCapable path only). The structured-authorship
// template rides here so the draft carries order/surface/confidence + acceptance-row SC ids.
const fableDraftPrompt = (planBrief) =>
  `You are the slot-A planner (deep reasoning). Write your plan to ${plansDir}/plan-a.md.\n${planBrief}\n\n` +
  `<authorship>\n${T4_AUTHORSHIP_RULE}\nEmit milestones[] as the structured list — each {id, title, summary, ` +
  `order, surface, confidence, acceptance:[{sc_id, criterion, executable_check}]}.\n</authorship>`

// solWrapperPrompt(opts) — the SONNET wrapper for a Sol codex leg. THIN adapter over the lifted pure
// core solWrapperPlan: it injects this stage's run-scoped bindings (councilDir, pluginRoot,
// receiptsLedger, runToken, keystone, transportModel) and returns { files, prompt } for the existing
// call sites — behavior-identical to the pre-lift local builder. opts:
//   { phaseTag, attempt, effort ('high'|'xhigh'), payloadSchema, taskText, briefBody, packetObj, extractTo }
const solWrapperPrompt = (opts) => solWrapperPlan({ councilDir, pluginRoot, receiptsLedger, runToken, keystone: keystoneId, transportModel: CODEX_MODEL, ...opts })

// runSolCrossCheck — the structural→LEDGER-VERIFIED upgrade, INVOCATION-EXACT. gate.mjs
// validated the receipt STRUCTURE via the provenance sink; this deterministic haiku leg extracts the
// verified ledger row matching THIS leg's output hash + session id AND its 'started' reservation, and
// the pure predicate crossCheckOk (lifted) binds the whole chain: reservation ↔ verified,
// reservation ↔ THIS seat, verified ↔ sink, payload ↔ canonical hash. Any miss is a DEAD Sol seat. A
// mute/garbled leg gets ONE re-dispatch, then fails closed.
const runSolCrossCheck = async (legLabel, phaseTag, outFile, sink, payload, phaseName) => {
  const canon = sha256Hex(canonicalJson(payload))
  const relayed = sink && sink.output_hash
  const dispatch = () => agent(crossCheckPrompt(outFile, relayed, sink && sink.session_id), { label: `thoth:receipt-check:${legLabel}`, phase: phaseName, model: 'haiku', schema: CROSS_CHECK_SCHEMA })
  let cc = await dispatch()
  if (!(cc && cc.ledger)) cc = await dispatch()
  if (!(cc && cc.ledger)) return { ledger_verified: false, reason: 'cross-check leg produced no ledger extract' }
  const res = crossCheckOk(cc, { relayedOutputHash: relayed, canonicalHash: canon, sink, keystone: keystoneId, phaseTag, seat: 'sol', attempt: 1, runToken })
  return res.ok
    ? { ledger_verified: true, codex_receipt_hash: res.codex_receipt_hash, invocation_id: res.invocation_id }
    : { ledger_verified: false, invocation_id: res.invocation_id, reason: res.reason }
}

// sealRatified — both heads APPROVE and valid: bind two DISTINCT-head signatures into the twinRatified
// certificate over the (possibly amended) bundle (via the lifted assembleRatifyCertificate),
// then ledger the RATIFY_*_SEALED barrier + the RATIFIED terminal. assembleRatifyCertificate returns
// ok:false on any binding defect (a blocked ratification, never a ratified one) → DEGRADED (fail-closed).
const sealRatified = async (rF, rS, sinkF, sinkS, bH, pH, solCross, ckptPhase, phaseName, rendererVersion) => {
  const provF = seatProv(sinkF, 'fable'), provS = seatProv(sinkS, 'sol')
  const res = assembleRatifyCertificate({ rF, rS, provF, provS, context: { bundle_hash: bH, renderer_version: rendererVersion != null ? rendererVersion : RENDERER_VERSION, plan_hash: pH, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null } })
  if (!res.ok) {
    await degradeCouncil('both', `certificate could not seal: ${res.reason}`, phaseName)
    return
  }
  councilCertificate = res.certificate
  councilTerminal = 'RATIFIED'
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: ckptPhase, decision_bundle_hash: bH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { [slotOf('fable')]: sha256Hex(canonicalJson(rF)), [slotOf('sol')]: sha256Hex(canonicalJson(rS)) }, seat_provenance: { [slotOf('fable')]: seatProv(sinkF, 'fable'), [slotOf('sol')]: seatProv(sinkS, 'sol') }, codex_receipt_hash: solCross && solCross.codex_receipt_hash ? solCross.codex_receipt_hash : null, status: 'sealed' }, phaseName)
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'RATIFIED', decision_bundle_hash: bH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
  log(`TWIN COUNCIL RATIFIED — the master plan carries two valid head signatures (bundle ${String(bH).slice(0, 12)}…); the Law may lock a council-ratified plan.`)
  // architecture.council_ratified (keystone): both heads signed — the master plan is sealed.
  await lore('architecture.council_ratified', `The council rules as one — two signatures seal the master plan (bundle ${String(bH).slice(0, 12)}…)`, { bundle: String(bH).slice(0, 12) }, phaseName)
}

// ── The run ledger: stage brackets land in events.jsonl via the kiln-state CLI —
//    the vision.js runLedger idiom (appendCouncilCheckpoint above is the council's specialized twin).
//    Thoth appends; gated on pluginRoot and degrades to a log line — an append failure never fails
//    the stage. stage_completed fires ONLY on the genuine-success path: lawLocked === true. An
//    unlocked Law or blocked council is an ESCALATION, not a completion — no event, per the
//    telegraph's failed-stages-emit-nothing rule. report.js and mapping.js bracket their runs the
//    same way now. ──
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

// ── Lore beats: a drafting/council/law dispatch at the moment a fact becomes true,
//    carried by runLedger to the operator's transcript between the banners (note{kind:'lore'};
//    deterministic <stage>.<beat> key; args short scalars capped at 80 by the caller; text ≤ 160).
//    PRESENTATION, null-keep: pluginRoot absent ⇒ a plain log() line, never a stage failure. Rides
//    runLedger (the general run ledger), NOT appendCouncilCheckpoint (the receipt-attested twin). ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE: every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? runLedger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── The debate front-half (critique · revision · mechanical divergence) + its byte-owned
//    Sol transport and resume machinery. All of it is DEFINED here but runs ONLY on
//    the T4 FULL path (councilCapable && !liteScope) after DRAFTS_SEALED with both drafts alive; sub-T4
//    and lite never reach it. INERT on every v3.0.1 path. ──
// ════════════════════════════════════════════════════════════════════════════════════════════════

// solByteOwnedPlan(cfg) — the BYTE-OWNED Sol codex leg for the debate phases. Unlike
// solWrapperPlan (whose wrapper TRANSLATES a brief into the codex prompt), here the SCRIPT renders the
// COMPLETE codex prompt/packet/schema BYTES; the wrapper writes them VERBATIM and runs the argv
// (invocation + relay only, no authorship). The returned promptSha/packetSha are sha256Hex of the
// script's OWN bytes; the call site (runSolByteOwnedCrossCheck) then REQUIRES the ledger reservation's
// prompt_sha256/packet_sha256 to equal them — a courier that altered ONE byte recorded a different file
// hash and the seat dies. cfg: { phaseTag, attempt, effort, codexPrompt, packetObj, payloadSchema,
// extractTo, extractField, extractLabel }. Pure (no I/O).
const solByteOwnedPlan = (cfg) => {
  const attempt = cfg.attempt || 1
  const base = `${councilDir}/${cfg.phaseTag}-sol-a${attempt}`
  const files = { prompt: `${base}.prompt`, packet: `${base}.packet`, schema: `${base}.schema`, out: `${base}.out`, stderr: `${base}.stderr` }
  const argv = `node ${pluginRoot}/scripts/kiln-codex-receipt.mjs ${files.prompt} ${CODEX_MODEL} ${cfg.effort} ${files.packet} ${files.schema} ${files.out} ${files.stderr} ${receiptsLedger} ${runToken} ${keystoneId} ${cfg.phaseTag} sol ${attempt}`
  const packetStr = JSON.stringify(cfg.packetObj)
  const schemaStr = JSON.stringify(cfg.payloadSchema)
  const codexPrompt = cfg.codexPrompt
  const promptSha = sha256Hex(codexPrompt)
  const packetSha = sha256Hex(packetStr)
  const label = cfg.extractLabel || 'result'
  const field = cfg.extractField
  const extractStep = cfg.extractTo
    ? `3. Extract the ${label} MECHANICALLY from the ATTESTED output — run this EXACT command, verbatim (never retype content; the path arguments stay quoted):\n   node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],p.${field})' "${files.out}" "${cfg.extractTo}"\n`
    : `3. (No extraction — the attested payload IS the deliverable.)\n`
  const prompt =
    `You are the Sol transport COURIER — BYTES ONLY. You author NOTHING and translate NOTHING: you write three files with the EXACT bytes given, run the receipt-bearing transport, and relay the attested result. You do not know the peer seat's identity.\n\n` +
    `<task>\n` +
    `1. Bash 'mkdir -p ${councilDir}'. Then WRITE three files (file tools) — for EACH, decode the JSON string that follows to its literal text and write THAT text VERBATIM (do not edit, reword, reformat, wrap, or "improve" anything; the bytes are hash-checked):\n` +
    `   - ${files.prompt} — the JSON-decoded text of: ${JSON.stringify(codexPrompt)}\n` +
    `   - ${files.packet} — the JSON-decoded text of: ${JSON.stringify(packetStr)}\n` +
    `   - ${files.schema} — the JSON-decoded text of: ${JSON.stringify(schemaStr)}\n` +
    `2. Run EXACTLY (Bash, foreground, generous timeout) — the raw run token belongs ONLY in this argv (a trusted process boundary), NEVER edited into a file:\n   ${argv}\n   Exit 0 ⇒ its stdout IS the verified receipt JSON.\n` +
    extractStep +
    `4. Emit the envelope (StructuredOutput): payload = the ${files.out} JSON verbatim, codex_receipt = the transport's stdout receipt verbatim, raw_artifact_refs = { "stderr": "${files.stderr}", "output": "${files.out}" }. On ANY failure (nonzero exit, missing files), report the failure honestly with NO codex_receipt key — a dead Sol seat is never faked.\n` +
    `</task>`
  return { files, argv, prompt, promptSha, packetSha }
}

// runSolByteOwnedCrossCheck — runSolCrossCheck's byte-owned sibling. It binds the whole invocation-exact
// chain via crossCheckOk (reservation ↔ verified ↔ sink ↔ payload) AND then byte-ownership:
// the ledger reservation's prompt/packet hash MUST equal the SCRIPT-rendered promptSha/packetSha, or a
// courier disowned the bytes and the seat dies. A mute/garbled cross-check leg gets ONE re-dispatch.
const runSolByteOwnedCrossCheck = async (legLabel, phaseTag, attempt, outFile, sink, payload, promptSha, packetSha, phaseName) => {
  const canon = sha256Hex(canonicalJson(payload))
  const relayed = sink && sink.output_hash
  const dispatch = () => agent(crossCheckPrompt(outFile, relayed, sink && sink.session_id), { label: `thoth:receipt-check:${legLabel}`, phase: phaseName, model: 'haiku', schema: CROSS_CHECK_SCHEMA })
  let cc = await dispatch()
  if (!(cc && cc.ledger)) cc = await dispatch()
  if (!(cc && cc.ledger)) return { ledger_verified: false, reason: 'cross-check leg produced no ledger extract' }
  const res = crossCheckOk(cc, { relayedOutputHash: relayed, canonicalHash: canon, sink, keystone: keystoneId, phaseTag, seat: 'sol', attempt, runToken })
  if (!res.ok) return { ledger_verified: false, invocation_id: res.invocation_id, reason: res.reason }
  const R = (cc.ledger && cc.ledger.reservation) || {}
  if (R.prompt_sha256 !== promptSha || R.packet_sha256 !== packetSha) {
    return { ledger_verified: false, invocation_id: res.invocation_id, reason: 'byte-ownership mismatch — the ledger reservation prompt/packet hash disagrees with the SCRIPT-rendered bytes (a wrapper altered a byte)' }
  }
  return { ledger_verified: true, codex_receipt_hash: res.codex_receipt_hash, invocation_id: res.invocation_id }
}

// readCouncilCheckpoints — a haiku Thoth reads events.jsonl and returns the prior SEALED
// council_state checkpoints (the matchCheckpoint-comparable records). Gated on pluginRoot; absence or a
// mute leg ⇒ [] (nothing to reuse, the whole front-half reruns — fail toward rerun, never a false reuse).
const readCouncilCheckpoints = async (phaseName) => {
  if (!pluginRoot) return []
  const res = await agent(
    `You are Thoth, the ledger reader — transcribe, never judge, never fix.\n\n` +
    `<task>Read ${kilnDir}/events.jsonl (Bash: 'cat ${kilnDir}/events.jsonl 2>/dev/null'). If it does not exist or is empty, report checkpoints: []. Otherwise each line is a JSON event: collect EVERY event whose type is "note" AND data.kind is "council_state" AND data.status is "sealed", and return checkpoints = the array of those data objects VERBATIM (each full council_state payload). Do not write or fix anything.</task>`,
    { label: 'thoth:council-resume', phase: phaseName, model: 'haiku', schema: RESUME_SCHEMA }
  )
  return (res && Array.isArray(res.checkpoints)) ? res.checkpoints : []
}
// priorInitialSeq — the FROZEN initial ledger seq: the earliest prior council checkpoint's value (a
// capability refresh appends events but must NOT reschedule; the seed + every checkpoint stay bound to
// the ORIGINAL anchor's seq). undefined ⇒ a fresh run (no prior checkpoint), keep the anchor's value.
const priorInitialSeq = (checkpoints) => {
  for (const c of (Array.isArray(checkpoints) ? checkpoints : [])) if (c && Number.isInteger(c.initial_ledger_seq)) return c.initial_ledger_seq
  return undefined
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── Front-half machinery — VISION SC-id extraction, the
//    negotiation-card topic-join, negotiation-set validation, the settlement, the gated-escalation
//    terminal, and a pure UTF-8 byte counter (the sandbox has no Buffer). All DEFINED here; called ONLY
//    on the T4 FULL path inside runDebateFrontHalf. ──
// ════════════════════════════════════════════════════════════════════════════════════════════════
// The negotiation-packet ceiling: 24 cards / 96 KiB canonical.
const NEG_MAX_CARDS = 24
const NEG_MAX_BYTES = 98304
// The per-organic-decision-value canonical-bytes cap validated at projection (registryFor) — the
// one card-bearing bound a JSON-schema `value: {}` node cannot express. 8 KiB per value (the per-card idiom).
const DECISION_VALUE_MAX_BYTES = 8192
// utf8ByteLength(s) — WHATWG UTF-8 byte count without Buffer/TextEncoder (workflow scripts cannot import
// node deps): a surrogate pair is 4 bytes, a lone surrogate is 3 (U+FFFD), matching sha256Hex's encoding.
const utf8ByteLength = (s) => {
  const str = String(s); let n = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length && (str.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++ }
    else n += 3
  }
  return n
}
// extractVisionScIds(text) — the FIXED deterministic regex over VISION's bytes (executed-before-written,
// rule 3). A haiku greps VISION; the script re-extracts from that raw output so the id set is script-owned.
const extractVisionScIds = (text) => { const m = String(text == null ? '' : text).match(/SC-\d+/g); return m ? Array.from(new Set(m)) : [] }

// escalateCouncil — the honest gated-escalation terminal (NOT a missing head, NOT a deadlock): an
// over-limit negotiation packet is escalated WHOLE, never truncated or summarized by any model. The Law is
// BLOCKED (any non-RATIFIED terminal blocks it) and the stage returns. Idempotent: a first terminal wins.
const escalateCouncil = async (reason, phaseName) => {
  const first = councilTerminal === null
  if (first) { councilTerminal = 'GATED_ESCALATION'; councilBlockedReason = reason; councilTerminalRecord = { terminal: 'GATED_ESCALATION', label: 'council_gated_escalation', reason } }
  log(`TWIN COUNCIL GATED ESCALATION — ${reason}; the Law is BLOCKED, operator resolution required (the packet is never truncated or summarized).`)
  if (first) await lore('architecture.council_gated', `The negotiation packet overflows its ceiling — escalated whole, never truncated; the Law stays blocked`, { reason: oneLine(reason, 80) }, phaseName)
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'GATED_ESCALATION', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: { reason: oneLine(reason, 80) }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
}

// buildNegotiationCards(divSet, fullP0, fullP1, findingsById, seed) — the cards derive FROM the
// AUTHORITATIVE mechanical divergence set (divSet.divergences), NOT a second independent registry-only
// algebra. CORRESPONDENCE RULE: a card corresponds to a divSet POSITION divergence — finding-based
// (unresolved / accepted-not-incorporated / rejected-weak-evidence), incompatible_topic_values, or
// neither_opposes_position — and carries THAT divergence's divergence_id VERBATIM (never re-minted).
// (1) EVERY position divergence yields its OWN card — there is NO topic-level suppression: two distinct
// divergences on one topic (e.g. two unresolved findings against one decision) surface as TWO cards with
// their two divSet ids and their own evidence refs (the authoritative divergence can never DISAPPEAR).
// Positions read from the two FULL registries by the divergence's decision refs (a finding-based one maps
// its target_decision_id to the holder slot's registry entry; a target absent from a registry renders the
// {absent:true} marker); evidence_refs read from the frozen finding behind it. (1b) An atomic_incompat-
// ibility divergence is a CONSTRAINT, not a position card: it carries the authoritative compatibility edge
// (from buildDivergenceSet's atomic edge inputs) threaded onto the topic_a/topic_b cards — its FULL topics
// are preserved (never reduced to the first). (2) The one-sided topic-join entries (a topic held by only
// one slot — an {absent:true} card) and agreements SUPPLEMENT the set for ONLY the topics
// divSet does not cover (never replacing a divSet card); their card ids are seed-derived. Each card carries
// a private _ordinal for provenance.
const buildNegotiationCards = (divSet, fullP0, fullP1, findingsById, seed) => {
  const p0ByTopic = new Map(); for (const e of fullP0) if (!p0ByTopic.has(e.topic)) p0ByTopic.set(e.topic, e)
  const p1ByTopic = new Map(); for (const e of fullP1) if (!p1ByTopic.has(e.topic)) p1ByTopic.set(e.topic, e)
  const valOf = (m, topic) => m.has(topic) ? m.get(topic).value : { absent: true }
  const agreed = []; const cards = []
  const cardedTopics = new Set()  // the topics divSet COVERS — step (2) supplements only the rest
  const cardByTopic = new Map()   // topic → its first card (the atomic edges attach here)
  const atomicPairs = []          // [{ topic_a, topic_b }] from atomic_incompatibility divergences (constraints)
  const atomicTopics = new Set()  // topics named by an atomic constraint — forced to be cards (edge endpoints)
  let ord = 0
  const ownTopic = (topic, card) => { cardedTopics.add(topic); if (!cardByTopic.has(topic)) cardByTopic.set(topic, card) }
  // (1) one card per AUTHORITATIVE divSet POSITION divergence; atomic divergences are constraint-only.
  for (const dv of (Array.isArray(divSet && divSet.divergences) ? divSet.divergences : [])) {
    if (dv.trigger === 'atomic_incompatibility') {
      const ts = Array.isArray(dv.topics) ? dv.topics.filter((t) => t != null).map(String) : []
      for (const t of ts) atomicTopics.add(t)
      if (ts.length === 2) atomicPairs.push({ topic_a: ts[0], topic_b: ts[1] })
      continue // NOT a position card — its constraint is threaded as a compatibility edge below (full topics kept)
    }
    let topic, position_0, position_1, evidence_refs = []
    if (dv.finding_id != null && dv.topic == null) {
      const f = (findingsById && findingsById.get(dv.finding_id)) || {}
      const tdid = dv.target_decision_id != null ? String(dv.target_decision_id) : ''
      const holderReg = dv.target_slot === 'P0' ? fullP0 : (dv.target_slot === 'P1' ? fullP1 : [])
      const hit = holderReg.find((e) => e.id === tdid || String(e.topic) === tdid || String(e.topic).endsWith(':' + tdid))
      topic = hit ? String(hit.topic) : `finding:${dv.target_slot != null ? dv.target_slot : '?'}:${tdid}`
      const holderVal = hit ? hit.value : { absent: true }
      const otherVal = valOf(dv.target_slot === 'P0' ? p1ByTopic : p0ByTopic, topic)
      position_0 = dv.target_slot === 'P0' ? holderVal : otherVal
      position_1 = dv.target_slot === 'P0' ? otherVal : holderVal
      evidence_refs = Array.isArray(f.evidence && f.evidence.refs) ? f.evidence.refs : []
    } else {
      topic = dv.topic != null ? String(dv.topic) : ''
      position_0 = valOf(p0ByTopic, topic); position_1 = valOf(p1ByTopic, topic)
    }
    // NO topic suppression: every position divergence surfaces its own card (its divSet id, verbatim).
    const card = { divergence_id: dv.divergence_id, topic, position_0, position_1, compatibility_edges: [], evidence_refs, _ordinal: ord++ }
    cards.push(card)
    ownTopic(topic, card)
  }
  // (2) the one-sided entries + agreements over every registry topic divSet does NOT cover. An
  //     atomic-constraint topic is FORCED to a card (an edge endpoint must exist) even when it would agree.
  const allTopics = [...new Set([...p0ByTopic.keys(), ...p1ByTopic.keys()])].sort()
  for (const topic of allTopics) {
    if (cardedTopics.has(topic)) continue
    const p0 = p0ByTopic.get(topic), p1 = p1ByTopic.get(topic)
    const mk = (position_0, position_1) => { const c = { divergence_id: `DV-${deriveId(seed, ['negotiation', { topic, position_0, position_1 }]).slice(0, 12)}`, topic, position_0, position_1, compatibility_edges: [], evidence_refs: [], _ordinal: ord++ }; cards.push(c); ownTopic(topic, c); return c }
    if (p0 && p1) {
      if (p0.value_hash === p1.value_hash && !atomicTopics.has(topic)) agreed.push({ topic, value: p0.value, slot: 'P0P1', ordinal: ord++ })
      else mk(p0.value, p1.value)
    } else if (p0) mk(p0.value, { absent: true })
    else mk({ absent: true }, p1.value)
  }
  // (1b/3) thread each atomic constraint onto its two cards as the authoritative compatibility edge — the
  // "both adopted" (present-side) combination that cannot coexist. An edge whose topic has no card (nothing
  // to constrain) is dropped. The edge rides BOTH cards so validateRatification sees it from either.
  const presentSideOf = (card) => (card.position_0 && typeof card.position_0 === 'object' && card.position_0.absent === true) ? 'P1' : 'P0'
  for (const { topic_a, topic_b } of atomicPairs) {
    const ca = cardByTopic.get(topic_a), cb = cardByTopic.get(topic_b)
    if (!ca || !cb || ca === cb) continue
    const edge = [{ divergence_id: ca.divergence_id, selection: presentSideOf(ca) }, { divergence_id: cb.divergence_id, selection: presentSideOf(cb) }]
    ca.compatibility_edges.push(edge); cb.compatibility_edges.push(edge)
  }
  return { agreed, cards }
}
// settleAllPresent(cards) — the NEGOTIATION_SKIPPED path settles each card's PRESENT side (a converged run
// carries only one-sided cards — a shared-topic conflict would have made the divergence set non-empty).
const settleAllPresent = (cards) => cards.map((card) => {
  const p0Absent = card.position_0 && typeof card.position_0 === 'object' && card.position_0.absent === true
  return p0Absent ? { topic: card.topic, value: card.position_1, slot: 'P1', ordinal: card._ordinal } : { topic: card.topic, value: card.position_0, slot: 'P0', ordinal: card._ordinal }
})
// negotiationSetError(cards, payload) — a head's selections must cover EXACTLY the open card ids: one per
// card, none unknown/duplicated/missing, MERGED carrying a merged_value. Returns null (valid) or a string.
const negotiationSetError = (cards, payload) => {
  const ids = cards.map((c) => c.divergence_id)
  const list = payload && Array.isArray(payload.selections) ? payload.selections : null
  if (!list) return 'no selections array'
  const seen = new Set()
  for (const s of list) {
    const id = s && s.divergence_id != null ? String(s.divergence_id) : undefined
    if (id === undefined || !ids.includes(id)) return `selection targets an unknown divergence '${id}'`
    if (seen.has(id)) return `duplicate selection for '${id}'`
    seen.add(id)
    if (s.selection === 'MERGED' && !Object.prototype.hasOwnProperty.call(s, 'merged_value')) return `MERGED selection for '${id}' carries no merged_value`
  }
  for (const id of ids) if (!seen.has(id)) return `divergence '${id}' left unselected`
  return null
}
// settleNegotiation(cards, fableSel, solSel) — the SCRIPT settles what BOTH heads' selections AGREE on:
// same side ⇒ settle that value (an agreed {absent:true} side ⇒ the entry LEAVES the plan, settling
// nothing); MERGED needs canonically-IDENTICAL merged_values; NEITHER ⇒ leaves; a disagreement stays open.
const settleNegotiation = (cards, fableSel, solSel) => {
  const isAbsent = (v) => v && typeof v === 'object' && v.absent === true
  const settled = []; const open = []
  for (const card of cards) {
    const a = fableSel.get(card.divergence_id) || null, b = solSel.get(card.divergence_id) || null
    const sa = a && a.selection, sb = b && b.selection
    if (sa && sa === sb) {
      // An agreed NEITHER means BOTH readings are defective — the card stays OPEN (it rides
      // open_divergences to ratification / the deadlock ladder), never a silent deletion. ONLY an agreed
      // explicit {absent:true} selection (below) rules an entry out of the plan.
      if (sa === 'NEITHER') { open.push(card); continue }
      if (sa === 'MERGED') {
        if (canonicalJson(a.merged_value) !== canonicalJson(b.merged_value)) { open.push(card); continue }
        settled.push({ topic: card.topic, value: a.merged_value, slot: 'merged', ordinal: card._ordinal }); continue
      }
      const v = sa === 'P0' ? card.position_0 : card.position_1
      if (isAbsent(v)) continue
      settled.push({ topic: card.topic, value: v, slot: sa, ordinal: card._ordinal })
    } else open.push(card)
  }
  return { settled, open }
}

// runDebateFrontHalf(planAFile, planBFile, evidenceDocs, phaseName) — critique → revision → mechanical
// divergence. P0 = fable's draft (plan-a.md), P1 = sol's draft (plan-b.md); each head critiques the OTHER
// draft, then revises its OWN against the frozen findings raised on it. A dead/invalid required head ⇒
// DEGRADED naming it (returns null); an empty mechanical divergence set early-stops to NEGOTIATION_SKIPPED.
// Returns { divSet, frozenFindings, dispositions, revisedRegistries } on a sealed front-half — the
// negotiation, decision bundle, and renderer consume it. The divergence set is BUILT + ledgered here
// (note{kind:'divergence'}), so buildDivergenceSet is the source of truth for it; diogenes still writes
// divergence-analysis.md for the chairman.
const runDebateFrontHalf = async (planAFile, planBFile, evidenceDocs, phaseName) => {
  const evLine = evidenceDocs.join(', ')
  // ── The blind critique exchange. Fable critiques P1 (plan-b.md); byte-owned Sol critiques
  //    P0 (plan-a.md). Each sees ONLY the other draft + the evidence + the frozen rubric — no identity. ──
  await lore('architecture.debate_convened', `The debate opens — each head critiques the other's plan blind; findings are script-keyed`, null, phaseName)
  const fableCritiquePrompt =
    `You are a council critic — find the defects in the OTHER head's plan, blind and independent. You do not know who authored it.\n\n` +
    `<inputs>\n- The plan to critique: ${planBFile}\n- Evidence docs: ${evLine}\n</inputs>\n\n<rubric>\n${COUNCIL_RUBRIC}\n</rubric>\n\n` +
    `<task>${CRITIQUE_TASK}\nEmit findings first; reasoning optional, last, ≤50 words. ${PAYLOAD_FIRST}</task>`
  const solCritiqueCodexPrompt =
    `# Goal\nCritique the anonymous implementation plan at ${planAFile} against the rubric, as ONE JSON object matching the output schema.\n\n` +
    `# Context\nPlan to critique: ${planAFile} (read it). Evidence docs: ${evLine}. Evidence manifest hash: ${evidenceManifestHash}.\n\n` +
    `# Rubric\n${COUNCIL_RUBRIC}\n\n# Constraints\n${CRITIQUE_TASK}\n\n` +
    `# Done-when\nThe final message is ONE JSON object matching the output schema: findings[] (each target_decision_id, claim, required_change, severity, evidence{class,refs,executable_check}); reasoning optional, last, ≤50 words.`
  const solCrit = solByteOwnedPlan({ phaseTag: 'CRITIQUE', attempt: 1, effort: 'xhigh', codexPrompt: solCritiqueCodexPrompt, packetObj: { plan: planAFile, evidence: evidenceDocs, evidence_manifest_hash: evidenceManifestHash }, payloadSchema: CRITIQUE_PAYLOAD_SCHEMA })
  const sinkFC = {}, sinkSC = {}
  const [fableCritique, solCritEnv] = await parallel([
    () => gateAgent(fableCritiquePrompt, { label: 'fable:critique', phase: phaseName, model: CLAUDE_HEAD_MODEL, effort: 'xhigh', twoHeads: 'required', schema: CRITIQUE_PAYLOAD_SCHEMA, provenance: sinkFC }),
    () => gateAgent(solCrit.prompt, { label: 'sol:critique', phase: phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(CRITIQUE_PAYLOAD_SCHEMA), provenance: sinkSC }),
  ])
  let solCritCross = { ledger_verified: false }
  if (solCritEnv != null && sinkSC.receipt_verified === true) solCritCross = await runSolByteOwnedCrossCheck('sol:critique', 'CRITIQUE', 1, solCrit.files.out, sinkSC, solCritEnv, solCrit.promptSha, solCrit.packetSha, phaseName)
  pushSolReceipt('sol:critique', sinkSC, solCritCross)
  const fCritAlive = fableCritique != null
  const sCritAlive = solCritEnv != null && sinkSC.receipt_verified === true && solCritCross.ledger_verified === true
  if (!fCritAlive || !sCritAlive) {
    await degradeCouncil(!fCritAlive && !sCritAlive ? 'both' : (!fCritAlive ? 'fable' : 'sol'), `head death at CRITIQUE (${!fCritAlive && !sCritAlive ? 'both' : (!fCritAlive ? 'fable' : 'sol')})`, phaseName)
    return null
  }
  // The SCRIPT assigns the target slot (anonymity: neither head ever saw a slot label) and canonicalizes
  // — model finding ids are non-authoritative. The target slot is the OTHER head's
  // seed-assigned slot (fable critiqued plan-b = sol's draft ⇒ target slotOf('sol'); sol critiqued plan-a
  // = fable's draft ⇒ target slotOf('fable')). The seat artifact hash belongs to the AUTHOR head's slot.
  const frozenFindings = canonicalizeFindings([
    { target_slot: slotOf('sol'), findings: Array.isArray(fableCritique.findings) ? fableCritique.findings : [] },
    { target_slot: slotOf('fable'), findings: Array.isArray(solCritEnv.findings) ? solCritEnv.findings : [] },
  ])
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'CRITIQUES_SEALED', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { [slotOf('fable')]: sha256Hex(canonicalJson(fableCritique)), [slotOf('sol')]: sha256Hex(canonicalJson(solCritEnv)) }, seat_provenance: { [slotOf('fable')]: { head: 'fable', model: CLAUDE_HEAD_MODEL }, [slotOf('sol')]: seatProv(sinkSC, 'sol') }, codex_receipt_hash: solCritCross.codex_receipt_hash, status: 'sealed' }, phaseName)

  // ── Self-revision with exact dispositions. Each head sees ITS OWN draft + ONLY the frozen
  //    findings against it. validateDispositions enforces exact coverage; invalid ⇒ DEGRADED. Fable
  //    rewrites plan-a.md itself; byte-owned Sol's revised_plan_markdown is extracted to plan-b.md. ──
  const findingsForP0 = frozenFindings.filter((f) => f.target_slot === slotOf('fable')) // sol's critique of fable's draft
  const findingsForP1 = frozenFindings.filter((f) => f.target_slot === slotOf('sol')) // fable's critique of sol's draft
  const findingLine = (fs) => fs.map((f) => `- ${f.id}: ${f.claim} → required_change: ${f.required_change}`).join('\n') || '(none — the plan drew no findings; dispositions[] is empty)'
  // The revision RE-EMITS the full revised structured milestones[] (the projection source) — the
  // path-free T4_AUTHORSHIP_RULE rides both heads' revision prompts, paths as inputs.
  const fableRevisePrompt =
    `You are revising YOUR OWN plan (${planAFile}) in light of the council's frozen findings against it, blind and independent.\n\n` +
    `<inputs>\n- Your plan: ${planAFile}\n- VISION (for Success-Criteria ids): ${visionFile}\n- The frozen findings against it:\n${findingLine(findingsForP0)}\n</inputs>\n\n` +
    `<authorship>\n${T4_AUTHORSHIP_RULE}\n</authorship>\n\n` +
    `<task>${REVISION_TASK} Rewrite ${planAFile} to fold in every accepted change (keep it a complete plan). Emit dispositions[] (one per finding_id above — none ⇒ []), decisions[], and milestones[] (the FULL revised structured list — each {id, title, summary, order, surface, confidence, acceptance:[{sc_id, criterion, executable_check}]}) first; reasoning optional, last, ≤50 words. ${PAYLOAD_FIRST}</task>`
  const solReviseCodexPrompt =
    `# Goal\nRevise your own anonymous plan at ${planBFile} in light of the frozen findings against it, as ONE JSON object matching the output schema.\n\n` +
    `# Context\nYour plan: ${planBFile} (read it). VISION (for Success-Criteria ids): ${visionFile}. Frozen findings against it:\n${findingLine(findingsForP1)}\n\n` +
    `# Authorship\n${T4_AUTHORSHIP_RULE}\n\n` +
    `# Constraints\n${REVISION_TASK}\n\n` +
    `# Done-when\nONE JSON object matching the output schema: dispositions[] (one per finding_id above — none ⇒ []), decisions[] (id, topic, value), milestones[] (the FULL revised structured list — each {id, title, summary, order, surface, confidence, acceptance:[{sc_id, criterion, executable_check}]}), revised_plan_markdown (the FULL revised plan); reasoning optional, last, ≤50 words.`
  const solRev = solByteOwnedPlan({ phaseTag: 'REVISION', attempt: 1, effort: 'xhigh', codexPrompt: solReviseCodexPrompt, packetObj: { plan: planBFile, findings: findingsForP1, evidence_manifest_hash: evidenceManifestHash }, payloadSchema: SOL_REVISION_PAYLOAD_SCHEMA, extractTo: planBFile, extractField: 'revised_plan_markdown', extractLabel: 'revised plan' })
  const sinkSR = {}
  const [fableRevision, solRevEnv] = await parallel([
    () => gateAgent(fableRevisePrompt, { label: 'fable:revise', phase: phaseName, model: CLAUDE_HEAD_MODEL, effort: 'xhigh', twoHeads: 'required', schema: REVISION_PAYLOAD_SCHEMA, provenance: {} }),
    () => gateAgent(solRev.prompt, { label: 'sol:revise', phase: phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(SOL_REVISION_PAYLOAD_SCHEMA), provenance: sinkSR }),
  ])
  let solRevCross = { ledger_verified: false }
  if (solRevEnv != null && sinkSR.receipt_verified === true) solRevCross = await runSolByteOwnedCrossCheck('sol:revise', 'REVISION', 1, solRev.files.out, sinkSR, solRevEnv, solRev.promptSha, solRev.packetSha, phaseName)
  pushSolReceipt('sol:revise', sinkSR, solRevCross)
  const fRevAlive = fableRevision != null
  const sRevAlive = solRevEnv != null && sinkSR.receipt_verified === true && solRevCross.ledger_verified === true
  if (!fRevAlive || !sRevAlive) {
    await degradeCouncil(!fRevAlive && !sRevAlive ? 'both' : (!fRevAlive ? 'fable' : 'sol'), `head death at REVISION (${!fRevAlive && !sRevAlive ? 'both' : (!fRevAlive ? 'fable' : 'sol')})`, phaseName)
    return null
  }
  // Exact coverage: each head disposes EXACTLY the frozen findings against its OWN draft. An invalid
  // set is a failed revision duty by that head (a missing head) ⇒ DEGRADED naming it.
  const vFable = validateDispositions(findingsForP0, Array.isArray(fableRevision.dispositions) ? fableRevision.dispositions : [])
  const vSol = validateDispositions(findingsForP1, Array.isArray(solRevEnv.dispositions) ? solRevEnv.dispositions : [])
  if (!vFable.valid || !vSol.valid) {
    const detail = [!vFable.valid ? `fable: ${vFable.errors.map((e) => e.code).join('/')}` : null, !vSol.valid ? `sol: ${vSol.errors.map((e) => e.code).join('/')}` : null].filter(Boolean).join('; ')
    await degradeCouncil(!vFable.valid && !vSol.valid ? 'both' : (!vFable.valid ? 'fable' : 'sol'), `invalid disposition set at REVISION (${detail})`, phaseName)
    return null
  }
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'REVISIONS_SEALED', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { [slotOf('fable')]: sha256Hex(canonicalJson(fableRevision)), [slotOf('sol')]: sha256Hex(canonicalJson(solRevEnv)) }, seat_provenance: { [slotOf('fable')]: { head: 'fable', model: CLAUDE_HEAD_MODEL }, [slotOf('sol')]: seatProv(sinkSR, 'sol') }, codex_receipt_hash: solRevCross.codex_receipt_hash, status: 'sealed' }, phaseName)

  // ── The mechanical divergence set + projection/join → negotiation → settlement →
  //    bundle. buildDivergenceSet PROVES every finding + decision is
  //    accounted for exactly once, seeded by the RESERVED councilSeedDigest (never in any prompt). A head's
  //    malformed registry / a projection typed-throw ⇒ DEGRADED naming the head (deterministic script leg —
  //    never a crash, never a silent skip). Empty set ⇒ NEGOTIATION_SKIPPED; a non-empty set runs ONE
  //    negotiation. The populated bundle rides the return; the renderer authors master-plan.md from it and
  //    ratify binds it. ──
  const classByFinding = new Map()
  for (const d of [...(Array.isArray(fableRevision.dispositions) ? fableRevision.dispositions : []), ...(Array.isArray(solRevEnv.dispositions) ? solRevEnv.dispositions : [])]) {
    if (d && typeof d.finding_id === 'string') classByFinding.set(d.finding_id, d.evidence_class)
  }
  const bdFindings = frozenFindings.map((f) => ({ id: f.id, target_slot: f.target_slot, target_decision_id: f.target_decision_id, claim_type: claimTypeForClass(f.evidence && f.evidence.class), evidence: f.evidence }))
  const bdDispositions = [...vFable.dispositions, ...vSol.dispositions].map((d) => ({
    finding_id: d.finding_id,
    disposition: d.disposition,
    evidence: d.disposition === 'rejected_with_evidence' ? { class: classByFinding.get(d.finding_id) } : undefined,
    incorporated: d.disposition === 'accepted' ? (Array.isArray(d.incorporated_at) && d.incorporated_at.length > 0) : undefined,
  }))
  // registryFor keeps the ORGANIC decision VALUE alongside its hash — the projection consumes it to reject
  // reserved-prefix ids + detect projected-topic collisions; positions render from the value.
  // It VALIDATES the raw revised registry and THROWS (typed) on a duplicate organic decision id —
  // the T4 path then DEGRADES the emitting head (the same locus as projectStructuredPlan's throws), never
  // the silent seen-skip dedupe that let a duplicate slip past projection + divergence.
  const registryFor = (rev) => {
    const seen = new Set(); const out = []
    for (const d of (Array.isArray(rev.decisions) ? rev.decisions : [])) {
      if (!d || typeof d.id !== 'string') continue
      if (seen.has(d.id)) throw new Error(`duplicate organic decision id '${d.id}' — a head's revised decision ids must be unique (the T4 path never silently dedupes)`)
      seen.add(d.id)
      const value = d.value != null ? d.value : null
      // Cap the organic decision VALUE's canonical bytes at projection (never truncated/summarized).
      const valueBytes = utf8ByteLength(canonicalJson(value))
      if (valueBytes > DECISION_VALUE_MAX_BYTES) throw new Error(`organic decision '${d.id}' value is ${valueBytes} canonical bytes, over the ${DECISION_VALUE_MAX_BYTES}-byte per-value ceiling (never truncated)`)
      out.push({ id: d.id, topic: String(d.topic != null ? d.topic : ''), value, value_hash: sha256Hex(canonicalJson(value)) })
    }
    return out
  }
  let regFable, regSol
  try { regFable = registryFor(fableRevision) } catch (e) { await degradeCouncil('fable', `revised registry invalid: ${e && e.message ? e.message : String(e)}`, phaseName); return null }
  try { regSol = registryFor(solRevEnv) } catch (e) { await degradeCouncil('sol', `revised registry invalid: ${e && e.message ? e.message : String(e)}`, phaseName); return null }
  // The VISION Success-Criteria id set — a haiku greps VISION, the SCRIPT re-extracts with the
  // fixed regex (adoption-vs-minted namespacing is script-owned). A mute leg ⇒ [] (minted-only, no false join).
  const scidsRes = await agent(
    `You are Thoth, the scribe — transcribe, never judge, never fix.\n\n` +
    `<task>Run (Bash): grep -oE 'SC-[0-9]+' "${visionFile}" 2>/dev/null; true\n` +
    `Report sc_text = the command's raw stdout VERBATIM (the matched ids, one per line; empty when none match). Do not write or fix anything.</task>`,
    { label: 'thoth:vision-scids', phase: phaseName, model: 'haiku', schema: VISION_SCIDS_SCHEMA }
  )
  const visionScIds = extractVisionScIds(scidsRes && scidsRes.sc_text)
  // The projection source is the REVISED structured milestones. A typed
  // throw (duplicate id, reserved prefix, projected-topic collision, degenerate value class) ⇒ DEGRADED
  // naming the head — a per-head validation, before any cross-head interaction.
  // Each head projects under ITS seed-assigned slot (slotOf('fable')/slotOf('sol')); the
  // settlement algebra is then keyed by P0/P1, so a P0/P1-ORDERED view routes the head registries onto the
  // slot the seed chose — position_0 in every card is the P0-slot head's value (never seat identity).
  let projFable, projSol
  try { projFable = projectStructuredPlan({ slot: slotOf('fable'), milestones: fableRevision.milestones, decisions: regFable, visionScIds }) }
  catch (e) { await degradeCouncil('fable', `structured-plan projection failed: ${e && e.message ? e.message : String(e)}`, phaseName); return null }
  try { projSol = projectStructuredPlan({ slot: slotOf('sol'), milestones: solRevEnv.milestones, decisions: regSol, visionScIds }) }
  catch (e) { await degradeCouncil('sol', `structured-plan projection failed: ${e && e.message ? e.message : String(e)}`, phaseName); return null }
  const projP0 = fableSlot === 'P0' ? projFable : projSol
  const projP1 = fableSlot === 'P0' ? projSol : projFable
  const orgP0 = fableSlot === 'P0' ? regFable : regSol
  const orgP1 = fableSlot === 'P0' ? regSol : regFable
  const joined = joinExactEquivalents(projP0, projP1)
  // The ONE algebra: buildDivergenceSet AND the negotiation cards both cover projected (milestones/SCs) AND
  // organic decisions uniformly (reserved prefixes were already rejected at projection).
  const fullP0 = [...joined.regP0, ...orgP0]
  const fullP1 = [...joined.regP1, ...orgP1]
  let divSet
  try {
    divSet = buildDivergenceSet({ findings: bdFindings, dispositions: bdDispositions, decisions: { P0: fullP0, P1: fullP1 }, seed: councilSeedDigest })
  } catch (e) {
    await degradeCouncil('both', `divergence construction failed a postcondition: ${e && e.message ? e.message : String(e)}`, phaseName)
    return null
  }
  await runLedger('note', { kind: 'divergence', hash: divSet.hash, empty: divSet.empty, count: divSet.divergences.length, divergences: divSet.divergences, accounting: divSet.accounting, join_accounting: joined.accounting }, phaseName)

  // The negotiation cards derive FROM the authoritative divSet (finding-based + topic-based
  // divergences) with the one-sided topic entries joining them + the agreements. findingsById supplies
  // each finding-based card's evidence_refs.
  const findingsById = new Map(frozenFindings.map((f) => [f.id, f]))
  const { agreed, cards } = buildNegotiationCards(divSet, fullP0, fullP1, findingsById, councilSeedDigest)
  // finalizeFrontHalf — closure over settled ∪ open, then the bundle, then the front-half barrier
  // (carrying decision_bundle_hash). A closure violation or an invalid bundle ⇒ DEGRADED loud. Returns
  // { bundle, hash } (rides the return) or null on a degrade.
  const finalizeFrontHalf = async (settled, open, ckpt) => {
    const cmpKey = (e) => canonicalJson({ t: e.topic, v: e.value })
    const settledSorted = settled.slice().sort((a, b) => { const ka = cmpKey(a), kb = cmpKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0 })
    // Closure derives its requires from the SETTLED SC entries' own milestone_key (the renderer's
    // authority) — the joined.requires list carries UNSETTLED-card rows too, which could conflict on a
    // two-sided SC and is not the closure's concern. Parent = the settled SC value's milestone_key.
    const closureRequires = settledSorted.filter((e) => e && typeof e.topic === 'string' && e.topic.startsWith('sc:') && e.value && e.value.milestone_key != null).map((e) => ({ sc_topic: e.topic, milestone_topic: String(e.value.milestone_key) }))
    const closure = validatePlanClosure({ settled: settledSorted, requires: closureRequires })
    if (!closure.ok) { await degradeCouncil('both', `plan closure violated after settlement: ${closure.violations.map((v) => `${v.kind}@${v.topic}`).join(', ')}`, phaseName); return null }
    const openClean = open.map(({ _ordinal, ...c }) => c)
    // common_trunk carries { vision_sc_ids } so the bundle HASH binds
    // the renderer's allocator input — a downstream renderer reads the SC-id set out of the bundle, never
    // an outer variable, and the re-render byte-compare derives from the hashed bundle ALONE.
    const bd = buildDecisionBundle({ common_trunk: { vision_sc_ids: visionScIds }, settled_decisions: settledSorted, open_divergences: openClean, renderer_version: 'b3-bundle/1', evidence_manifest_hash: evidenceManifestHash })
    if (!bd.valid) { await degradeCouncil('both', `decision bundle invalid: ${bd.errors.map((e) => e.code).join(', ')}`, phaseName); return null }
    // PERSIST the sealed bundle bytes (canonicalJson, whose sha equals bd.hash) BEFORE the barrier
    // seals — a Thoth verbatim-bytes scribe writes them, the SCRIPT hashes the file and verifies it equals
    // the bundle hash (the render idiom). A scribe-write mismatch is a persist failure ⇒ DEGRADED loud (a
    // barrier a resume could not rehydrate must never seal as reusable).
    const bundleBytes = canonicalJson(bd.bundle)
    await agent(scribeBytesPrompt(decisionBundleFile, bundleBytes), { label: 'thoth:bundle-scribe', phase: phaseName, model: 'haiku', schema: SCRIBE_SCHEMA })
    const persisted = await agent(planHashPrompt(decisionBundleFile), { label: 'thoth:bundle-persist-hash', phase: phaseName, model: 'haiku', schema: PLAN_HASH_SCHEMA })
    const persistedHash = persisted && typeof persisted.plan_sha256 === 'string' && SHA64_RE.test(persisted.plan_sha256) ? persisted.plan_sha256 : null
    if (persistedHash !== bd.hash) { await degradeCouncil('both', `front-half bundle persist failure — the sealed bundle file (${persistedHash ? String(persistedHash).slice(0, 12) + '…' : 'no valid hash'}) does not match the bundle hash (${String(bd.hash).slice(0, 12)}…); a barrier a resume cannot rehydrate never seals`, phaseName); return null }
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: ckpt.phase, decision_bundle_hash: bd.hash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: ckpt.anonymous_seat_artifact_hashes || {}, seat_provenance: ckpt.seat_provenance || {}, codex_receipt_hash: ckpt.codex_receipt_hash || null, status: 'sealed' }, phaseName)
    return { bundle: bd.bundle, hash: bd.hash }
  }
  // runNegotiation — the ONE negotiation (NEGOTIATION_SEALED). Packet preflighted against the ceiling
  // BEFORE dispatch (over-limit ⇒ gated escalation, never truncated). Fable ∥ byte-owned Sol; a dead
  // seat / invalid selection set ⇒ DEGRADED naming the head. Returns { bundle, hash } or null.
  const runNegotiation = async () => {
    const cardsForPacket = cards.map(({ _ordinal, ...c }) => c)
    const packet = { common_trunk: agreed, cards: cardsForPacket, requires: joined.requires, budgets: { max_cards: NEG_MAX_CARDS, max_canonical_bytes: NEG_MAX_BYTES } }
    const packetBytes = utf8ByteLength(canonicalJson(packet))
    if (cardsForPacket.length > NEG_MAX_CARDS || packetBytes > NEG_MAX_BYTES) {
      await escalateCouncil(`negotiation packet over the ceiling (${cardsForPacket.length} cards / ${packetBytes} canonical bytes; ceiling ${NEG_MAX_CARDS} cards / ${NEG_MAX_BYTES} bytes)`, phaseName)
      return null
    }
    await lore('architecture.negotiation_convened', `The heads negotiate ${cardsForPacket.length} divergence card(s) blind — one negotiation, no loop`, { cards: cardsForPacket.length }, phaseName)
    const cardsJson = JSON.stringify(cardsForPacket), requiresJson = JSON.stringify(joined.requires), trunkJson = JSON.stringify(agreed)
    const fableNegotiatePrompt =
      `You are a council negotiator — reconcile the open divergences, blind and independent. You do not know who authored either position.\n\n` +
      `<common-trunk>\n${trunkJson}\n</common-trunk>\n<cards>\n${cardsJson}\n</cards>\n<requires>\n${requiresJson}\n</requires>\n\n` +
      `<task>${NEGOTIATION_TASK}\nEmit selections[] FIRST (one per divergence_id above); reasoning optional, last, ≤50 words. ${PAYLOAD_FIRST}</task>`
    const solNegotiateCodexPrompt =
      `# Goal\nNegotiate the open divergence cards as ONE JSON object matching the output schema.\n\n` +
      `# Context\nCommon trunk (both heads already agreed): ${trunkJson}\nOpen divergence cards: ${cardsJson}\nCompatibility/requires constraints: ${requiresJson}\n\n` +
      `# Constraints\n${NEGOTIATION_TASK}\n\n` +
      `# Done-when\nONE JSON object matching the output schema: selections[] (one per divergence_id); reasoning optional, last, ≤50 words.`
    const solNeg = solByteOwnedPlan({ phaseTag: 'NEGOTIATION', attempt: 1, effort: 'xhigh', codexPrompt: solNegotiateCodexPrompt, packetObj: { common_trunk: agreed, cards: cardsForPacket, requires: joined.requires }, payloadSchema: NEGOTIATION_PAYLOAD_SCHEMA })
    const sinkFN = {}, sinkSN = {}
    const [fableNeg, solNegEnv] = await parallel([
      () => gateAgent(fableNegotiatePrompt, { label: 'fable:negotiate', phase: phaseName, model: CLAUDE_HEAD_MODEL, effort: 'xhigh', twoHeads: 'required', schema: NEGOTIATION_PAYLOAD_SCHEMA, provenance: sinkFN }),
      () => gateAgent(solNeg.prompt, { label: 'sol:negotiate', phase: phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(NEGOTIATION_PAYLOAD_SCHEMA), provenance: sinkSN }),
    ])
    let solNegCross = { ledger_verified: false }
    if (solNegEnv != null && sinkSN.receipt_verified === true) solNegCross = await runSolByteOwnedCrossCheck('sol:negotiate', 'NEGOTIATION', 1, solNeg.files.out, sinkSN, solNegEnv, solNeg.promptSha, solNeg.packetSha, phaseName)
    pushSolReceipt('sol:negotiate', sinkSN, solNegCross)
    const fNegAlive = fableNeg != null
    const sNegAlive = solNegEnv != null && sinkSN.receipt_verified === true && solNegCross.ledger_verified === true
    if (!fNegAlive || !sNegAlive) {
      await degradeCouncil(!fNegAlive && !sNegAlive ? 'both' : (!fNegAlive ? 'fable' : 'sol'), `head death at NEGOTIATION (${!fNegAlive && !sNegAlive ? 'both' : (!fNegAlive ? 'fable' : 'sol')})`, phaseName)
      return null
    }
    const eF = negotiationSetError(cardsForPacket, fableNeg), eS = negotiationSetError(cardsForPacket, solNegEnv)
    if (eF || eS) { await degradeCouncil(eF && eS ? 'both' : (eF ? 'fable' : 'sol'), `invalid negotiation selection set (${[eF ? `fable: ${eF}` : null, eS ? `sol: ${eS}` : null].filter(Boolean).join('; ')})`, phaseName); return null }
    const fableSel = new Map(), solSel = new Map()
    for (const s of fableNeg.selections) fableSel.set(String(s.divergence_id), s)
    for (const s of solNegEnv.selections) solSel.set(String(s.divergence_id), s)
    const { settled, open } = settleNegotiation(cards, fableSel, solSel)
    const seatHashes = { [slotOf('fable')]: sha256Hex(canonicalJson(fableNeg)), [slotOf('sol')]: sha256Hex(canonicalJson(solNegEnv)) }
    return await finalizeFrontHalf([...agreed, ...settled], open, { phase: 'NEGOTIATION_SEALED', anonymous_seat_artifact_hashes: seatHashes, seat_provenance: { [slotOf('fable')]: { head: 'fable', model: CLAUDE_HEAD_MODEL }, [slotOf('sol')]: seatProv(sinkSN, 'sol') }, codex_receipt_hash: solNegCross.codex_receipt_hash })
  }

  let frontBundle = null
  if (divSet.empty) {
    log('mechanical divergence set is EMPTY — negotiation skipped; the revised drafts feed synthesis directly')
    await lore('architecture.divergences_none', `The debate converges — zero mechanical divergences; negotiation skipped`, null, phaseName)
    frontBundle = await finalizeFrontHalf([...agreed, ...settleAllPresent(cards)], [], { phase: 'NEGOTIATION_SKIPPED', seat_provenance: { divergence_hash: divSet.hash } })
    if (frontBundle === null) return null
  } else {
    log(`mechanical divergence set has ${divSet.divergences.length} card(s) [${divSet.divergences.map((d) => d.divergence_id).join(', ')}] — carried to the negotiation`)
    await lore('architecture.divergences_built', `Diogenes yields to the ledger — ${divSet.divergences.length} mechanical divergence(s) built and sealed`, { divergences: divSet.divergences.length }, phaseName)
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'DIVERGENCES_BUILT', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: { divergence_hash: divSet.hash }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    frontBundle = await runNegotiation()
    if (frontBundle === null) return null // a degrade / gated-escalation terminal is already set
  }
  // Surface the sealed front-half — the divergence
  // set, the frozen findings, the dispositions, the revised registries WITH values, the requires/join
  // accounting, the projections, and the populated bundle + hash ride the return so the renderer/ratify
  // consume the populated bundle.
  return { divSet, frozenFindings, dispositions: [...vFable.dispositions, ...vSol.dispositions], revisedRegistries: { P0: orgP0, P1: orgP1 }, requires: joined.requires, accounting: joined.accounting, projections: { P0: projP0, P1: projP1 }, bundle: frontBundle && frontBundle.bundle, bundle_hash: frontBundle && frontBundle.hash }
}

// ── Laying Stone: numerobis writes the technical docs the planners build on ──
phase('Laying Stone')
// Stage bracket: stage_started on every entry — a re-run is the stage still in progress.
await runLedger('stage_started', {}, 'Laying Stone')
// research.md is OPTIONAL on a normative path: research can scope to zero topics
// (no high-priority before-build OQs), in which case the research stage writes NO research.md and
// returns research_file: null. Architecture must not point its agents at a phantom file. Per the
// self-validation discipline (workflows verify their own inputs exist — "validate.js detects
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
// Visual-direction authority: the conductor threads vision.js's visual_direction as the
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
// The authoritative visual-direction boolean: the conductor-threaded arg wins; else the
// foundation agent's judgment (the pre-v3 fallback). Everything downstream reads THIS, not the
// raw foundation field, so a threaded arg short-circuits mechanically in the SCRIPT.
const hasVisualDirection = (typeof visualDirection === 'boolean') ? visualDirection : !!(foundation && foundation.has_visual_direction)
log(`Foundation docs written; visual direction: ${hasVisualDirection}${visualDirection === null ? '' : ' (conductor-threaded)'}`)
// architecture.foundation_laid (volume): the technical foundation is set.
await lore('architecture.foundation_laid', `The geometry never lies — the foundation is set, visual direction ${hasVisualDirection ? 'present' : 'none'}`, { visual_direction: hasVisualDirection ? 'present' : 'none' }, 'Laying Stone')

// ── Design tokens (conditional — only when VISION has real Visual Direction) ──
// Design tokens run in PARALLEL with The Council. Their only inputs are
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
  // architecture.tokens_parallel (volume): the design system is drawn alongside the plan.
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
  `milestones: the Law compiles exactly ONE locked check per SC, so coverage stays ` +
  `arithmetic, never judgment.`

// The single-vs-dual fork. The Gauge posture (planning) is the authoritative upstream decider when
// present: 'dual' runs The Council, 'single'/'single+redteam' take the lite single-plan path.
// Absent (planning === null) ⇒ the historical decider stands: trivial scope ⇒ lite path. Either
// way liteScope means "skip the dual-plan council + divergence; Plato authors directly".
const liteScope = planning !== null
  ? planning !== 'dual'
  : !!(foundation && foundation.scope === 'trivial')
// Validation-pass count: the number of Athena passes to run (plan_validation_rounds
// IS a pass count, not a revision count). The posture arg overrides when present; else the historical
// default expressed directly as passes — 2 on the lite path, 3 on the full path. The number of plato
// revisions is validationPasses - 1 (a revision happens only between two passes).
const validationPasses = validationRoundsArg !== null ? validationRoundsArg : (liteScope ? LITE_VALIDATION_PASSES : FULL_VALIDATION_PASSES)

// On the LITE path, Plato folds the build-stage handoff INTO its
// synthesis output — one Opus call writes both master-plan.md and architecture-handoff.md — and
// the dedicated numerobis:handoff agent is skipped. The fold rides EVERY Plato write (synthesis
// AND each revision) so the handoff always matches the FINAL plan, never a pre-revision stale one.
// Standard/complex keep the separate handoff agent: a non-trivial handoff is its own deliverable
// worth a dedicated pass. The clause is empty off the lite path.
const handoffFoldClause = liteScope
  ? ` Then ALSO write ${handoffFile}: a concise build-stage handoff — the ordered milestone list, the tech stack, the non-negotiable constraints, and any low-confidence areas the build should watch (this is what the build stage reads first). Rewrite it whenever you rewrite the plan so the two never drift.`
  : ``

let synthBrief
let synthLead
if (liteScope) {
  log(`${planning !== null ? `Posture planning='${planning}'` : `Scope='trivial' (${foundation && foundation.estimated_milestones} est. milestone(s))`} — lite architecture path: Plato authors the single plan directly (no draft pair, no divergence set); at T4 the blind required ratification pair still convenes.`)
  // architecture.lite_path (volume): right-sized to one authored plan — no draft pair to compare; the
  // T4 ratification pair still rules. The lite fork skips the DRAFTS/divergence machinery, not the council.
  await lore('architecture.lite_path', `Lite path — ${(foundation && foundation.estimated_milestones) ?? '?'} est. milestone(s); Plato drafts the single plan alone, no draft pair to compare (the T4 ratification pair still rules)`, { est_milestones: (foundation && foundation.estimated_milestones) ?? null }, 'Laying Stone')
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
    await noteClaudeHeadSuccession('The Council')
    // ═══ Twin Council draft pair (T4, FULL path): Fable drafts plan-a itself; the receipt-attested Sol
    //     wrapper drafts plan-b (codex read-only, plan rides the attested payload). Both see the SAME
    //     frozen evidence + rubric; neither sees the peer's identity, model, receipt, or the run
    //     token/seed. A promised head that dies at DRAFTS ⇒ the promised-head rule: DEGRADED, but we
    //     still produce a DRAFT master plan from the survivor (the v3.0.1 single-plan guard) — the plan
    //     exists for the operator yet never advances as authoritative (Law BLOCKED, council terminal
    //     DEGRADED). No fable→opus substitution, no sonnet stand-in for Sol (twoHeads:'required'). ═══
    const frozenInputs = [visionFile, `${docsDir}/architecture.md`, `${docsDir}/tech-stack.md`, `${docsDir}/arch-constraints.md`].concat(researchPresent ? [researchFile] : [])
    const anchor = await agent(anchorPrompt(frozenInputs), { label: 'thoth:council-anchor', phase: 'The Council', model: 'haiku', schema: ANCHOR_SCHEMA })
    // EXACT coverage: every frozen input present exactly once with a real 64-hex digest and NO
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
      // ── Resume: read prior SEALED council checkpoints; FREEZE the initial ledger seq from the
      //    ORIGINAL anchor across a capability refresh (a refresh appends events but must NEVER
      //    reschedule — the seed + every checkpoint stay bound to the original seq). A fresh run has no
      //    prior checkpoint ⇒ the anchor's own seq stands. ──
      const priorCheckpoints = await readCouncilCheckpoints('The Council')
      const frozenSeq = priorInitialSeq(priorCheckpoints)
      if (frozenSeq !== undefined) { councilInitialSeq = frozenSeq; log(`resume: initial ledger seq FROZEN at ${frozenSeq} from a prior council checkpoint (a capability refresh never reschedules)`) }
      // seed — run-bound entropy (councilSeed). Reserved for divergence-id derivation; it NEVER
      // appears in any prompt (anonymity + tie-break-unpredictability rails). Bound here so the
      // checkpoint chain and the blindness rails bind against the REAL seed.
      councilSeedDigest = councilSeed({ protocolVersion: COUNCIL_PROTOCOL_VERSION, runToken, initialSeq: councilInitialSeq, keystoneId, templateHash })
      // The P0/P1 parity is NOT assigned here — it fires only AFTER both drafts return alive AND
      // the Sol receipt/cross-check validate (below), before the first slot-keyed checkpoint (DRAFTS_SEALED).
      const solDraft = solWrapperPrompt({ phaseTag: 'DRAFTS', attempt: 1, effort: 'high', payloadSchema: SOL_DRAFT_PAYLOAD_SCHEMA, taskText: DRAFT_TASK, briefBody: `${planBrief}\n\nAuthorship:\n${T4_AUTHORSHIP_RULE}\nEmit milestones[] as the structured list — each {id, title, summary, order, surface, confidence, acceptance:[{sc_id, criterion, executable_check}]}.`, packetObj: { inputs: frozenInputs, foundation_summary: foundation && foundation.summary, testing_rigor: testingRigor }, extractTo: `${plansDir}/plan-b.md` })
      const sinkS = {}
      // architecture.council_convened (keystone): the T4 draft pair spawns — two heads draft blind.
      await lore('architecture.council_convened', `The Twin Council convenes — two heads draft blind; neither sees the other's hand`, null, 'The Council')
      const [fablePlan, solPayload] = await parallel([
        () => agent(fableDraftPrompt(planBrief), { label: 'fable:draft', phase: 'The Council', model: CLAUDE_HEAD_MODEL, effort: 'high', schema: PLAN_SCHEMA_T4 }),
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
        // Draft-death SYMMETRY: the Sol plan is UNTRUSTED on any Sol-seat death,
        // but a FABLE death with a fully-verified Sol (payload + structural receipt + ledger-verified
        // cross-check) keeps the ATTESTED plan-b as the single-plan survivor — the terminal is still
        // DEGRADED and the Law still blocks; only the DRAFT source material changes.
        plans = []
        if (fableAlive) plans.push({ ...fablePlan, slot: 'a' })
        else if (solAlive) plans.push({ slot: 'b', plan_file: `${plansDir}/plan-b.md`, approach_summary: solPayload.approach_summary, milestones: solPayload.milestones })
      } else {
        // Assign the P0/P1 slots from the hidden seed parity HERE — after BOTH drafts returned
        // alive AND the Sol receipt + invocation-exact cross-check validated (the checks just above), and
        // BEFORE the first slot-keyed checkpoint (DRAFTS_SEALED) or consumer. Seed parity is run-bound,
        // deterministic, never seat identity, never a prompt; the plan files stay seat-bound (the SLOT
        // labels decouple here, and everything downstream routes through slotOf()).
        fableSlot = (parseInt(councilSeedDigest.slice(0, 8), 16) % 2 === 0) ? 'P0' : 'P1'
        solSlot = fableSlot === 'P0' ? 'P1' : 'P0'
        const seatHashes = await agent(seatHashPrompt(`${plansDir}/plan-a.md`, `${plansDir}/plan-b.md`), { label: 'thoth:seat-hashes', phase: 'The Council', model: 'haiku', schema: SEAT_HASH_SCHEMA })
        // Seat hashes + provenance are keyed by the seed-assigned slot (plan-a = fable's, plan-b
        // = sol's — the plan files stay seat-bound; the SLOT labels route through slotOf). Provenance still
        // records head-per-slot (audit).
        await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'DRAFTS_SEALED', decision_bundle_hash: null, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { [slotOf('fable')]: seatHashes && seatHashes.plan_a_sha256 ? seatHashes.plan_a_sha256 : null, [slotOf('sol')]: seatHashes && seatHashes.plan_b_sha256 ? seatHashes.plan_b_sha256 : null }, seat_provenance: { [slotOf('fable')]: { head: 'fable', model: CLAUDE_HEAD_MODEL }, [slotOf('sol')]: seatProv(sinkS, 'sol') }, codex_receipt_hash: solCross.codex_receipt_hash, status: 'sealed' }, 'The Council')
        // The plans shim: the payload carries approach_summary/milestones; the lantern/plato read
        // plan-a.md / plan-b.md from disk (both written), UNCHANGED — anonymity preserved (no receipt/
        // model/token leaks in any lantern or plato prompt).
        plans = [
          { ...fablePlan, slot: 'a' },
          { slot: 'b', plan_file: `${plansDir}/plan-b.md`, approach_summary: solPayload.approach_summary, milestones: solPayload.milestones },
        ]
        // ── The debate front-half (critique · revision · divergence → negotiation →
        //    settlement → bundle) with resume reuse. Both drafts sealed and alive ⇒ the heads
        //    critique/revise/diverge/negotiate; the populated bundle feeds the renderer/ratify. The
        //    front-half TERMINAL barrier is NEGOTIATION_SEALED (negotiated) or NEGOTIATION_SKIPPED
        //    (converged) — DIVERGENCES_BUILT is an INTERMEDIATE (negotiation follows it), so a run that
        //    crashed after DIVERGENCES_BUILT but before the negotiation seal has no reusable terminal and
        //    the WHOLE front-half reruns (a half-pair has no partial-output authority). A template/pin
        //    change also fails the match. A debate degrade sets councilTerminal and leaves the plans as
        //    the operator's DRAFT (Law blocks; the rest skipped). ──
        if (councilTerminal === null) {
          const priorFrontHalf = priorCheckpoints.find((c) => c && (c.phase === 'NEGOTIATION_SEALED' || c.phase === 'NEGOTIATION_SKIPPED') && c.status === 'sealed')
          const frontHalfReusable = !!(priorFrontHalf && matchCheckpoint(buildCheckpoint(priorFrontHalf), buildCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: priorFrontHalf.phase, decision_bundle_hash: priorFrontHalf.decision_bundle_hash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: priorFrontHalf.anonymous_seat_artifact_hashes, seat_provenance: priorFrontHalf.seat_provenance, codex_receipt_hash: priorFrontHalf.codex_receipt_hash, status: 'sealed' })))
          // A sealed matching front-half barrier is REUSED only if its persisted bundle bytes
          // REHYDRATE the structured authority. Reload decision-bundle.json, verify its sha equals the
          // barrier's decision_bundle_hash AND re-canonicalizing the parsed bundle reproduces that hash
          // (the checkpoint binding), then hydrate councilFrontHalf/councilBundle/councilBundleHash — so the
          // T4 render path stays ACTIVE after reuse (the renderer authors, ratify binds the populated
          // bundle). ANY mismatch (missing file, sha drift, parse failure, hash disagreement) ⇒ rerun the
          // whole front half (never advance on an unrehydratable barrier).
          let rehydrated = false
          if (frontHalfReusable) {
            const priorHash = priorFrontHalf.decision_bundle_hash
            const rd = await agent(readBundlePrompt(decisionBundleFile), { label: 'thoth:bundle-reload', phase: 'The Council', model: 'haiku', schema: READ_BUNDLE_SCHEMA })
            const content = rd && typeof rd.content === 'string' ? rd.content : null
            const fileSha = rd && typeof rd.sha256 === 'string' && SHA64_RE.test(rd.sha256) ? rd.sha256 : null
            if (content && fileSha === priorHash && sha256Hex(content) === priorHash) {
              let parsed = null
              try { parsed = JSON.parse(content) } catch { parsed = null }
              if (parsed && typeof parsed === 'object' && sha256Hex(canonicalJson(parsed)) === priorHash) {
                councilFrontHalf = { bundle_hash: priorHash, settled_decisions: parsed.settled_decisions, open_divergences: parsed.open_divergences }
                councilBundle = parsed
                councilBundleHash = priorHash
                rehydrated = true
                log(`resume: a sealed matching ${priorFrontHalf.phase} barrier stands and its persisted bundle REHYDRATED (${String(priorHash).slice(0, 12)}…) — the debate front-half is REUSED, the render path stays ACTIVE`)
                await lore('architecture.debate_reused', `The debate barrier holds — the sealed front-half bundle is rehydrated and reused, not re-run`, null, 'The Council')
              }
            }
            if (!rehydrated) log(`resume: the matching ${priorFrontHalf.phase} barrier's persisted bundle did NOT rehydrate (missing/sha-drift/parse/hash mismatch) — rerunning the whole front half`)
          }
          if (!rehydrated) {
            const fh = await runDebateFrontHalf(`${plansDir}/plan-a.md`, `${plansDir}/plan-b.md`, frozenInputs, 'The Council')
            if (fh && fh.bundle) {
              councilFrontHalf = { bundle_hash: fh.bundle_hash, settled_decisions: fh.bundle.settled_decisions, open_divergences: fh.bundle.open_divergences }
              // The sealed front-half bundle becomes the AUTHORITATIVE artifact the renderer,
              // Athena amendments, and ratification consume (councilFrontHalf stays the pre-swap record).
              councilBundle = fh.bundle
              councilBundleHash = fh.bundle_hash
            }
          }
        }
      }
    }
  } else {
    // A PROMISED council (T4 + codex) launched without the run token reaches
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── THE AUTHORITY SWAP: on the T4 FULL path the deterministic renderer (renderMasterPlan)
//    AUTHORS master-plan.md from the settled bundle — plato is retired from the authoritative flow.
//    A workflow script cannot write files, so a Thoth VERBATIM-BYTES scribe writes
//    the rendered markdown (the solByteOwnedPlan courier idiom) and the SCRIPT byte-compares
//    (in-script sha of the rendered bytes vs the file-read sha) — a mismatch is a "scribe-write failure",
//    DEGRADED loud. Sub-T4 and lite keep plato byte-identical. ──
// ════════════════════════════════════════════════════════════════════════════════════════════════
// t4RenderPath — the swap predicate, RE-EVALUATED at every site (councilTerminal can transition mid-stage).
const t4RenderPath = () => councilCapable && !liteScope && councilBundle !== null && councilTerminal === null
// requiresFromSettled — the closure `requires` rows reconstructed from the settled SC entries' own
// milestone_key (the parent relationship lives in the bundle — closure derives from the bundle alone). An
// SC whose parent is unsettled emits no row, so validatePlanClosure reports it as an orphan_sc.
const requiresFromSettled = (settled) => settled
  .filter((e) => e && typeof e.topic === 'string' && e.topic.startsWith('sc:') && e.value && e.value.milestone_key != null)
  .map((e) => ({ sc_topic: e.topic, milestone_topic: String(e.value.milestone_key) }))
// shapeOf/sameShape — an amendment's replacement must match the SHAPE of the target's current value.
// Shape = null | array | object (identical key set, recursively) | the primitive
// typeof. Arrays: count is free, but each replacement element must match the target's element ARCHETYPE
// (the first element's recursive shape) when the target array is NON-EMPTY (an empty target is element-
// free) — this closes the garbage-element hole. A replacement that changes the structural class, an
// object's key set, or an element archetype is illegal.
const shapeOf = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : (typeof v === 'object' ? 'object:' + Object.keys(v).sort().join(',') : typeof v)
const sameShape = (a, b) => {
  if (shapeOf(a) !== shapeOf(b)) return false
  if (a !== null && typeof a === 'object' && !Array.isArray(a)) { for (const k of Object.keys(a)) if (!sameShape(a[k], b[k])) return false }
  if (Array.isArray(a) && a.length) { for (const el of b) if (!sameShape(a[0], el)) return false }
  return true
}
// scribePlanPrompt — the Thoth verbatim-bytes courier: it decodes ONE JSON string to its literal text and
// writes THAT text to master-plan.md (never authors, never reformats; the bytes are hash-checked).
const scribePlanPrompt = (markdown) =>
  `You are Thoth, the scribe — BYTES ONLY. You author nothing and reformat nothing.\n\n` +
  `<task>Write ${masterPlanFile} (file tools): decode the JSON string below to its literal text and write THAT text VERBATIM — do not edit, reword, reformat, wrap, or "improve" anything; the bytes are hash-checked.\n` +
  `${JSON.stringify(markdown)}\n` +
  `Report written = true iff you wrote the file.</task>`
// renderScribeCompare — render the CURRENT councilBundle, scribe-write master-plan.md, byte-compare
// (scribe fidelity gate). Sets renderManifest + renderMilestones on success; a mismatch ⇒ DEGRADED loud
// ("scribe-write failure"). Returns { plan_hash: renderHash } or null (a terminal is already set).
const renderScribeCompare = async (phaseName) => {
  const view = { ...councilBundle, settled: councilBundle.settled_decisions }
  const rendered = renderMasterPlan(view, { visionScIds: (councilBundle.common_trunk && councilBundle.common_trunk.vision_sc_ids) || [] })
  const renderHash = sha256Hex(rendered.markdown)
  await agent(scribePlanPrompt(rendered.markdown), { label: 'thoth:render-scribe', phase: phaseName, model: 'haiku', schema: SCRIBE_SCHEMA })
  const rd = await agent(planHashPrompt(masterPlanFile), { label: 'thoth:render-hash', phase: phaseName, model: 'haiku', schema: PLAN_HASH_SCHEMA })
  const fileHash = rd && typeof rd.plan_sha256 === 'string' && SHA64_RE.test(rd.plan_sha256) ? rd.plan_sha256 : null
  if (renderHash !== fileHash) {
    await degradeCouncil('both', `scribe-write failure — the rendered master plan (${String(renderHash).slice(0, 12)}…) does not match the file on disk (${fileHash ? String(fileHash).slice(0, 12) + '…' : 'no valid hash'}); the scribe transcribes, it never authors`, phaseName)
    return null
  }
  renderManifest = rendered.manifest
  renderMilestones = rendered.milestones
  return { plan_hash: renderHash }
}
// synthFromRender — the return/log view of the rendered milestones (id = the assigned final id).
const synthFromRender = () => ({ master_plan_file: masterPlanFile, milestone_count: (renderMilestones || []).length, milestones: (renderMilestones || []).map((m) => ({ id: m.final_id, title: m.title, surface: m.surface, confidence: m.confidence })) })
// NON_AMENDABLE_TRUNK — the trunk fields a typed amendment may NEVER touch (they bind the renderer/hash
// identity): renderer_version / evidence_manifest_hash are bundle identity, vision_sc_ids is the allocator input.
const NON_AMENDABLE_TRUNK = new Set(['renderer_version', 'evidence_manifest_hash', 'vision_sc_ids'])
// applyAmendmentsToBundle — validate + apply the TYPED amendments structurally to councilBundle, then
// closure → rebuild bundle → rerender + scribe-write + byte-compare. ANY non-descriptor / unknown-key /
// illegal-shape / conflicting-duplicate / closure violation ⇒ GATED_ESCALATION (never a free rewrite).
// Returns { plan_hash } (bundle + hash mutated) or null (a terminal is set).
const applyAmendmentsToBundle = async (amendments, phaseName) => {
  const list = Array.isArray(amendments) ? amendments : []
  const byTarget = new Map()
  for (const am of list) {
    if (!am || (am.target_kind !== 'settled_decision' && am.target_kind !== 'trunk_field') || typeof am.key !== 'string' || !Object.prototype.hasOwnProperty.call(am, 'replacement')) {
      await escalateCouncil('an Athena amendment is not a valid typed descriptor { target_kind, key, replacement }', phaseName); return null
    }
    const tk = `${am.target_kind}|${am.key}`
    const rk = canonicalJson(am.replacement)
    if (byTarget.has(tk)) { if (byTarget.get(tk).rk !== rk) { await escalateCouncil(`conflicting duplicate amendment for ${tk} — duplicate targets must carry canonically identical replacements`, phaseName); return null } continue }
    byTarget.set(tk, { am, rk })
  }
  const settled = councilBundle.settled_decisions.map((e) => ({ ...e }))
  const trunk = { ...councilBundle.common_trunk }
  const topicIndex = new Map(); settled.forEach((e, i) => topicIndex.set(String(e.topic), i))
  for (const { am } of byTarget.values()) {
    if (am.target_kind === 'settled_decision') {
      if (!topicIndex.has(am.key)) { await escalateCouncil(`Athena amendment targets unknown settled decision '${am.key}'`, phaseName); return null }
      const i = topicIndex.get(am.key)
      if (!sameShape(settled[i].value, am.replacement)) { await escalateCouncil(`Athena amendment for '${am.key}' has an illegal replacement shape`, phaseName); return null }
      settled[i] = { ...settled[i], value: am.replacement }
    } else {
      if (NON_AMENDABLE_TRUNK.has(am.key) || !Object.prototype.hasOwnProperty.call(trunk, am.key)) { await escalateCouncil(`Athena amendment targets a non-amendable or unknown trunk field '${am.key}'`, phaseName); return null }
      if (!sameShape(trunk[am.key], am.replacement)) { await escalateCouncil(`Athena trunk amendment for '${am.key}' has an illegal replacement shape`, phaseName); return null }
      trunk[am.key] = am.replacement
    }
  }
  const closure = validatePlanClosure({ settled, requires: requiresFromSettled(settled) })
  if (!closure.ok) { await escalateCouncil(`amended plan violates closure: ${closure.violations.map((v) => `${v.kind}@${v.topic}`).join(', ')}`, phaseName); return null }
  settled.sort((a, b) => { const ka = canonicalJson({ t: a.topic, v: a.value }), kb = canonicalJson({ t: b.topic, v: b.value }); return ka < kb ? -1 : ka > kb ? 1 : 0 })
  const bd = buildDecisionBundle({ common_trunk: trunk, settled_decisions: settled, open_divergences: councilBundle.open_divergences, renderer_version: councilBundle.renderer_version, evidence_manifest_hash: councilBundle.evidence_manifest_hash })
  if (!bd.valid) { await escalateCouncil(`amended bundle invalid: ${bd.errors.map((e) => e.code).join(', ')}`, phaseName); return null }
  councilBundle = bd.bundle; councilBundleHash = bd.hash
  return await renderScribeCompare(phaseName)
}

// ── One From Many: the renderer (T4-full) or plato (sub-T4/lite) writes master-plan.md ──
phase('One From Many')
log(`${spin('synth', 0)}`)
let synth
if (t4RenderPath()) {
  // The deterministic renderer AUTHORS master-plan.md from the settled bundle. NO plato call,
  // NO companion artifact on this branch. renderScribeCompare sets renderManifest/renderMilestones; a
  // scribe byte-mismatch degrades (the return still carries the shaped rendered milestones).
  log('One From Many: the renderer authors master-plan.md from the settled bundle (Plato retired on the T4-full path)')
  await renderScribeCompare('One From Many')
  synth = synthFromRender()
  log(`master-plan.md: ${synth.milestone_count} milestone(s) [${synth.milestones.map((m) => m.id + ':' + m.surface).join(', ')}] (rendered from the settled bundle)`)
  // architecture.plan_synthesized (keystone): the master plan is rendered from the council's settled bundle.
  await lore('architecture.plan_synthesized', `One map of truth — master-plan.md rendered from the settled bundle: ${synth.milestone_count} milestone(s) [${oneLine(synth.milestones.map((m) => m.id).join(', '), 80)}]`, { milestones: synth.milestone_count }, 'One From Many')
} else {
  synth = await agent(
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
}

// ── Athena Weighs: validator with a bounded plato-revision loop ──
phase('Athena Weighs')
log(`${spin('validate', 0)}`)
let verdict = null
// validationPasses is the number of Athena validation passes to run (NOT a revision
// count). The loop runs exactly validationPasses passes (round 0..validationPasses-1) and at most
// validationPasses-1 plato revisions (a revision happens only between two passes, after a non-final
// FAIL). So posture rounds=1 ⇒ one pass / zero revisions; rounds=3 ⇒ three passes / ≤2 revisions.
for (let round = 0; round < validationPasses; round++) {
  // On the T4-full path Athena validates the RENDERED snapshot and her accepted fixes apply
  // as MECHANICAL bundle amendments (VALIDATION_SCHEMA_T4); the plato-revision arm survives ONLY on
  // sub-T4/lite (byte-identical). t4 is re-read each round — an amendment escalation flips councilTerminal.
  const t4 = t4RenderPath()
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
    `else FAIL with the failed dimensions and concrete fixes.${t4 ? ` This plan is deterministically RENDERED from a settled decision bundle — express each accepted fix as a TYPED amendment { target_kind: 'settled_decision'|'trunk_field', key, replacement } in amendments[] (a fix that cannot be expressed as a bundle amendment is a gated escalation, not a free rewrite; free-text fixes are advisory).` : ''} Emit verdict, failed_dimensions, and fixes first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
    { label: `athena:validate:r${round}`, phase: 'Athena Weighs', model: 'opus', schema: t4 ? VALIDATION_SCHEMA_T4 : VALIDATION_SCHEMA }
  )) || { verdict: 'FAIL', failed_dimensions: ['validator-failure'], fixes: [] }
  verdict = val
  // architecture.athena_pass (volume): the plan validator passed it.
  if (val.verdict === 'PASS') { log(`Athena: PASS (pass ${round + 1}/${validationPasses})`); await lore('architecture.athena_pass', `Athena nods — PASS, pass ${round + 1}/${validationPasses}`, { pass: round + 1, passes: validationPasses }, 'Athena Weighs'); break }
  // architecture.athena_fail (volume): the plan failed every validation pass — escalating.
  if (round === validationPasses - 1) { log(`Athena still FAIL after ${validationPasses} pass(es) — escalating`); await lore('architecture.athena_fail', `Athena weighs FAIL — after ${validationPasses} pass(es) [${oneLine((val.failed_dimensions || []).join(', '), 80)}]; escalating`, { passes: validationPasses }, 'Athena Weighs'); break }
  if (t4) {
    // Apply the typed amendments to the bundle, rerender, re-validate next pass. A FAIL
    // with no typed amendment cannot be expressed structurally ⇒ GATED_ESCALATION (never a free rewrite).
    const amendments = Array.isArray(val.amendments) ? val.amendments : []
    if (!amendments.length) { log(`Athena FAIL [${(val.failed_dimensions || []).join(', ')}] — no typed bundle amendment; gated escalation`); await escalateCouncil('Athena FAIL carries no typed bundle amendment — the fix cannot be expressed structurally (free-text fixes are advisory on the T4-full path)', 'Athena Weighs'); break }
    log(`Athena FAIL [${(val.failed_dimensions || []).join(', ')}] — applying ${amendments.length} typed amendment(s), rerender round ${round + 1}`)
    const r = await applyAmendmentsToBundle(amendments, 'Athena Weighs')
    if (!r) break // a gated escalation / scribe-write degrade is already set
    synth = synthFromRender()
    continue
  }
  // sub-T4/lite: Plato revises (byte-identical). Null-keep: a crashed reviser must not wipe the last good synthesis.
  log(`Athena FAIL [${(val.failed_dimensions || []).join(', ')}] — Plato revision round ${round + 1}`)
  synth = (await agent(
    voice('opus') +
    `You are the plan chairman, revising ${masterPlanFile}.\n\n` +
    `<inputs>\nAthena failed it on: ${(val.failed_dimensions || []).join(', ')}.\nApply these fixes: ${(val.fixes || []).join(' | ')}\n${synthBrief}\n</inputs>\n\n` +
    `<task>Apply the fixes and rewrite the file (keep surfaces + executable acceptance criteria).${handoffFoldClause} Emit master_plan_file, the updated milestone_count, and milestone list first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
    { label: `plato:revise:r${round + 1}`, phase: 'One From Many', model: 'opus', schema: SYNTH_SCHEMA }
  )) || synth
}

// verdictShapeError(r) — LIFTED to src/council.mjs and inlined via the @inline:council
// marker above; the full ratify AND the lite ratify share the one copy the build keystones use.

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── The Twin Council: blind dual ratification of the master plan.
//    Runs at T4 on the FULL path once Athena PASSes and the draft pair sealed (no prior degrade).
//    Blind simultaneous verdicts → one bounded answer exchange on any BLOCK (executable checks settled
//    by exit code) → one blind re-verdict → an HONEST terminal (RATIFIED certificate / COUNCIL_DEADLOCK
//    / DEGRADED). The fresh-context re-adjudication ladder slots between RATIFY_2 and the deadlock
//    terminal; until then the conductor's gated operator checkpoint is the resolution authority. ──
// ════════════════════════════════════════════════════════════════════════════════════════════════
const runTwinCouncilRatify = async () => {
  const phaseName = 'Athena Weighs'
  // The heads ratify the POPULATED front-half bundle. The open divergences are
  // the cards each head must resolve with one divergence_selection; matching selections + dual APPROVE
  // SETTLE the bundle deterministically (the script renders the FINAL plan, the certificate binds the
  // resulting plan hash). A fully-settled bundle carries no open cards ⇒ selections = []. When councilBundle
  // is null (resume-REUSE or any non-render path where plato synthesized the plan) the ratify binds the
  // legacy empty bundle over the synthesized plan — the render swap is a T4-full property, not universal.
  const renderPath = councilBundle !== null
  const rendererVer = renderPath ? councilBundle.renderer_version : RENDERER_VERSION
  const openCardsAt = () => renderPath ? councilBundle.open_divergences.map(({ _ordinal, ...c }) => c) : []
  const openIdsOf = (cards) => cards.map((d) => String(d.divergence_id))
  const edgesOf = (cards) => cards.flatMap((c) => Array.isArray(c.compatibility_edges) ? c.compatibility_edges : [])
  const selMapOf = (r) => { const m = new Map(); for (const s of (Array.isArray(r.divergence_selections) ? r.divergence_selections : [])) if (s && s.divergence_id != null) m.set(String(s.divergence_id), s.selection); return m }
  // The evidence docs a ratifier reads (anonymous — never named by authorship path).
  const evidenceDocs = [masterPlanFile, `${docsDir}/architecture.md`, `${docsDir}/tech-stack.md`, `${docsDir}/arch-constraints.md`, visionFile].concat(researchPresent ? [researchFile] : [])
  const ratifyInputs = `<inputs>\n- The master plan: ${masterPlanFile}\n- Evidence docs: ${evidenceDocs.join(', ')}\n</inputs>`
  const bindingLine = (bH, pH, cards) => `Binding: artifact_hash = "${bH}" (echo it VERBATIM). plan_sha256 = ${pH}. evidence_manifest_hash = ${evidenceManifestHash}. ` +
    ((cards && cards.length) ? `Resolve EACH open divergence with one divergence_selection (P0|P1|MERGED|NEITHER) — the open cards:\n${JSON.stringify(cards)}` : `divergence_selections = [] (the bundle is fully settled — no open divergences remain).`)
  // The round-two prompt carries THAT head's exchange evidence — the other head's answers to its
  // OWN standing findings, the executable-check transcripts where one ran, and the changes Plato
  // already applied. Attribution is only ever "the other head" — no identity, receipt, model, or
  // token rides in (the blindness rails extend here, test-asserted).
  const exchangeBlock = (exchange) => exchange
    ? `\n<exchange-evidence>\nAnswers from the other head to YOUR prior blocking findings (ACCEPT = the change is already applied to the plan; REFUTE = their evidence against it), the executable-check transcripts where one ran (the exit code already ruled), and the applied changes. The plan file is the AMENDED artifact.\n${JSON.stringify(exchange)}\n</exchange-evidence>\n`
    : ''
  const fableRatifyPrompt = (suffix, bH, pH, exchange, cards) =>
    `You are a council ratifier (${suffix}) — rule the master plan against the fixed rubric, blind and independent.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${COUNCIL_RUBRIC}\n</rubric>\n\n` +
    `<binding>\n${bindingLine(bH, pH, cards)}\n</binding>\n` +
    exchangeBlock(exchange) +
    `\n<task>${RATIFY_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const fableAnswerPrompt = (findings) =>
    `You are the OTHER head, answering blocking findings raised against the master plan, blind and independent.\n\n` +
    `${ratifyInputs}\n\n<findings-to-answer>\n${findings.map((f) => `- ${f.id}: ${f.claim} → required_change: ${f.required_change}`).join('\n')}\n</findings-to-answer>\n\n` +
    `<task>${ANSWER_TASK} Emit answers first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
  // An answer set is RELATIONALLY validated — exactly one answer per requested finding, no unknown
  // or duplicate ids, enum-legal, a REFUTE evidence-bound. An invalid set is a failed exchange duty by
  // the ANSWERING head ⇒ DEGRADED naming it (a schema-valid-but-empty set no longer sails through).
  // Identity is the SCRIPT-assigned R-key (canonicalizeRatifyFindings) — the model's finding_id is a label.
  const answerSetError = (requested, ans) => {
    const ids = requested.map((f) => f.id)
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
  // parallel. Sol death / invalid receipt / failed cross-check ⇒ DEGRADED (a missing
  // head is degradation, not deadlock). BLINDNESS RAILS: the fable prompt never mentions
  // codex/receipt/session/Sol; the sol packet never mentions fable; neither reveals the plan's
  // authorship path or the run token/seed.
  const runBlindVerdict = async (phaseTag, suffix, bH, pH, exchange, cards) => {
    const sinkF = {}, sinkS = {}
    const ex = exchange || {}
    // Sol-side exchange evidence rides the packet + one briefBody line; the fable-side rides the
    // <exchange-evidence> prompt block. Both carry ONLY that head's own-finding answers/transcripts.
    const solBrief = `${bindingLine(bH, pH, cards)}\nRubric:\n${COUNCIL_RUBRIC}` +
      (ex.sol ? `\nExchange evidence for YOUR prior blocking findings (the other head's answers, the executable-check transcripts, the applied changes) rides in the packet's exchange field; the plan file is the AMENDED artifact.` : '')
    const solR = solWrapperPrompt({ phaseTag, attempt: 1, effort: 'xhigh', payloadSchema: RATIFY_SCHEMA, taskText: RATIFY_TASK, briefBody: solBrief, packetObj: { master_plan: masterPlanFile, evidence: evidenceDocs, artifact_hash: bH, plan_sha256: pH, evidence_manifest_hash: evidenceManifestHash, open_divergences: cards || [], exchange: ex.sol != null ? ex.sol : null } })
    const [rF, rS] = await parallel([
      () => gateAgent(fableRatifyPrompt(suffix, bH, pH, ex.fable != null ? ex.fable : null, cards), { label: `fable:ratify:${suffix}`, phase: phaseName, model: CLAUDE_HEAD_MODEL, effort: 'xhigh', twoHeads: 'required', schema: RATIFY_SCHEMA, provenance: sinkF }),
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
  // Returns sink + cross so the ANSWER_EXCHANGE_SEALED checkpoint can carry provenance + receipt.
  const runSolAnswerLeg = async (findings) => {
    const sink = {}
    const sol = solWrapperPrompt({ phaseTag: 'ANSWER_EXCHANGE', attempt: 1, effort: 'high', payloadSchema: ANSWER_SCHEMA, taskText: ANSWER_TASK, briefBody: `Findings to answer:\n${findings.map((f) => `- ${f.id}: ${f.claim} → required_change: ${f.required_change}`).join('\n')}`, packetObj: { master_plan: masterPlanFile, evidence: evidenceDocs, findings } })
    const payload = await gateAgent(sol.prompt, { label: 'sol:answer', phase: phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(ANSWER_SCHEMA), provenance: sink })
    let cross = { ledger_verified: false }
    if (payload != null && sink.receipt_verified === true) cross = await runSolCrossCheck('sol:answer', 'ANSWER_EXCHANGE', sol.files.out, sink, payload, phaseName)
    pushSolReceipt('sol:answer', sink, cross)
    if (!(payload != null && sink.receipt_verified === true && cross.ledger_verified === true)) { await degradeCouncil('sol', 'Sol seat death during the answer exchange', phaseName); return { degraded: true } }
    return { degraded: false, payload, sink, cross }
  }

  // ── ratify-anchor r1: hash the (possibly Plato-revised) master plan — the binding plan_sha256.
  //    ONLY a real 64-hex digest binds; anything else degrades — never a guessed/stale hash. ──
  const ra = await agent(planHashPrompt(masterPlanFile), { label: 'thoth:ratify-anchor:r1', phase: phaseName, model: 'haiku', schema: PLAN_HASH_SCHEMA })
  const planHash = ra && typeof ra.plan_sha256 === 'string' && SHA64_RE.test(ra.plan_sha256) ? ra.plan_sha256 : null
  if (!planHash) { await degradeCouncil('evidence', 'ratify-anchor produced no valid plan hash', phaseName); return }
  // On the render path bundleH is the REAL councilBundleHash (the bundle the signatures bind);
  // off it (councilBundle null) the legacy empty bundle binds the plato-synthesized plan (resume-reuse).
  const bundleH = renderPath ? councilBundleHash : buildDecisionBundle({ common_trunk: { master_plan_file: masterPlanFile, plan_sha256: planHash, milestones: (synth && synth.milestones) || [] }, settled_decisions: {}, open_divergences: [], renderer_version: RENDERER_VERSION, evidence_manifest_hash: evidenceManifestHash }).hash
  const r1Cards = openCardsAt()

  // sealFromSelections — dual APPROVE: SETTLE the bundle from the AGREED divergence_selections (the
  // settleNegotiation idiom; agreed-absent leaves; agreed MERGED ⇒ gated escalation, no value channel;
  // a selection disagreement is persistent divergence ⇒ deadlock), rebuild + FINAL render, then bind the
  // certificate to { input bundle hash, renderer_version, RESULTING plan hash }. A
  // fully-settled bundle (no open cards) seals directly over the already-rendered plan.
  const sealFromSelections = async (rv, bH, pH, cards, ckptPhase, ph, laddered) => {
    const mF = selMapOf(rv.rF), mS = selMapOf(rv.rS)
    const adds = []
    const agreedSel = [] // the ratify-agreed cards' SELECTION IDENTITIES (id + chosen side) — part
    const disagreed = [] //           of the final selection map, threaded whole into the ladder so the atomic
    for (const card of cards) { //     combination check spans agreed AND laddered selections against ALL edges.
      const a = mF.get(String(card.divergence_id)), b = mS.get(String(card.divergence_id))
      if (a !== b) { disagreed.push(card); continue } // a still-open divergence the heads resolved differently
      if (a === 'MERGED') { await escalateCouncil(`an agreed MERGED selection at ratify has no value channel (the negotiation was the merging venue) — '${card.divergence_id}'`, ph); return }
      agreedSel.push({ divergence_id: String(card.divergence_id), selection: a }) // EVERY agreed card's identity joins the final selection map — before the value-specific continues (NEITHER + agreed-absent), so the ladder's atomic check spans the COMPLETE agreed selection set against all edges.
      if (a === 'NEITHER') continue
      const v = a === 'P0' ? card.position_0 : card.position_1
      if (v && typeof v === 'object' && v.absent === true) continue
      adds.push({ topic: card.topic, value: v, slot: a, ordinal: null })
    }
    // A still-open-divergence disagreement is NOT a certificate and NOT (yet) a deadlock — the
    // fresh-context re-adjudication ladder rules the opposed DIVERGENCES. A disagreement that survives a
    // fresh round (laddered) IS the honest COUNCIL_DEADLOCK terminal (the ladder never runs twice).
    if (disagreed.length) {
      if (laddered) { await deadlockCouncil(disagreed.map((c) => ({ finding_id: 'ratify-selection', claim: `the heads re-approved but chose divergent resolutions for '${c.divergence_id}' after the fresh round`, required_change: 'operator resolution' })), ph, 'the fresh-context re-adjudication ladder ran and the heads STILL resolved the divergence differently — an honest deadlock, operator resolution required'); return }
      await runFreshRoundLadder(disagreed, adds, agreedSel, edgesOf(cards), ph)
      return
    }
    let resultingPlanHash = pH
    // Whenever cards EXISTED this round and the selections agree, ALWAYS rebuild the bundle with
    // open_divergences:[] and RE-RENDER — even with zero adds (every selection NEITHER/absent) — so the
    // certified plan is the deterministic FINAL plan with NO OPEN blocks. Off-card rounds (cards.length 0)
    // seal directly over the already-rendered plan.
    if (cards.length) {
      const settled = [...councilBundle.settled_decisions.map((e) => ({ ...e })), ...adds]
      const closure = validatePlanClosure({ settled, requires: requiresFromSettled(settled) })
      if (!closure.ok) { await escalateCouncil(`the ratified selection settlement violates closure: ${closure.violations.map((cv) => `${cv.kind}@${cv.topic}`).join(', ')}`, ph); return }
      settled.sort((x, y) => { const kx = canonicalJson({ t: x.topic, v: x.value }), ky = canonicalJson({ t: y.topic, v: y.value }); return kx < ky ? -1 : kx > ky ? 1 : 0 })
      const bd = buildDecisionBundle({ common_trunk: councilBundle.common_trunk, settled_decisions: settled, open_divergences: [], renderer_version: councilBundle.renderer_version, evidence_manifest_hash: councilBundle.evidence_manifest_hash })
      if (!bd.valid) { await escalateCouncil(`the settled bundle is invalid: ${bd.errors.map((e) => e.code).join(', ')}`, ph); return }
      councilBundle = bd.bundle; councilBundleHash = bd.hash
      const rr = await renderScribeCompare(ph)
      if (!rr) return // a scribe-write degrade is already set
      resultingPlanHash = rr.plan_hash
    }
    await sealRatified(rv.rF, rv.rS, rv.sinkF, rv.sinkS, bH, resultingPlanHash, rv.solCross, ckptPhase, ph, rendererVer)
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // ── The fresh-context re-adjudication ladder. It fires ONLY on a receipt-
  //    complete dual-APPROVE whose divergence_selections OPPOSE on still-open cards — a card-less verdict
  //    deadlock stays COUNCIL_DEADLOCK (the ladder rules DIVERGENCES only). For each opposed divergence it
  //    runs the 2×2 counterbalanced fresh cells (freshRoundSchedule → normalizeCellVerdict → aggregateHead
  //    → aggregateCouncil, never majority-washed). Outcomes: dual-decisive-agreement ⇒ adopt as a bundle
  //    amendment → a FRESH RATIFY round (never a direct certificate); instability / decisive-vs-no_decision
  //    ⇒ the honest ambiguity terminal (no fresh drafting cycle); stable opposition ⇒
  //    the cascade (reference reduction → one dual-signed rubric amendment + rerule → sealReversibility ⇒
  //    provisional adoption + MEL ⇒ twin_deadlock_resolved, or the gated/deadlock terminal). ──
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const FRESH_MAX_DIVERGENCES = 4
  const FRESH_CARD_MAX_BYTES = 8192 // the canonical-packet bound idiom, per-card
  // gatedOrDeadlock — the mode-honest no-adopt terminal: an operator-attended run gets the gated
  // checkpoint (GATED_ESCALATION), an unattended run the honest COUNCIL_DEADLOCK (NO stage_completed,
  // last ratified artifact preserved). Neither changes a substantive verdict; both keep the Law blocked.
  const gatedOrDeadlock = async (reason, divergences, ph) => {
    if (attended) await escalateCouncil(reason, ph)
    else await deadlockCouncil(divergences, ph, reason)
  }
  // freshCellPacket — the FROZEN anonymous packet for one 2×2 cell: options K/M mapped per the cell's
  // label_mapping and ordered per presentation_order, plus evidence, compatibility constraints, the rubric,
  // and the deterministic card id. NO identity/receipt/transport metadata; the seed NEVER appears.
  const freshCellPacket = (call, card, clarification) => {
    const byLetter = call.label_mapping === 'swapped' ? { K: card.position_1, M: card.position_0 } : { K: card.position_0, M: card.position_1 }
    const order = call.presentation_order === 'M_then_K' ? ['M', 'K'] : ['K', 'M']
    // The sample index + its FIXED probe framing ride the FROZEN packet, so the three high-tier
    // samples of a cell are genuinely distinct (and the FRESH_CARDS_SEALED seat hash BINDS the sample
    // indexes). temperature is recorded honestly (the host does not apply it; the framing carries the intent).
    // A dual-signed rubric clarification (rerule ONLY) rides the FROZEN packet so every rerule cell
    // rules under COUNCIL_RUBRIC + the identical signed clarification (null on a normal round).
    return {
      card_id: call.card_id,
      sample: call.sample,
      temperature: call.temperature,
      probe_framing: FRESH_SAMPLE_FRAMINGS[call.sample] != null ? FRESH_SAMPLE_FRAMINGS[call.sample] : FRESH_SAMPLE_FRAMINGS[0],
      rubric_clarification: clarification != null ? clarification : null,
      question: `Which option is the sounder plan value for the decision '${card.topic}'?`,
      options: order.map((l) => ({ label: l, value: byLetter[l] })),
      evidence_refs: Array.isArray(card.evidence_refs) ? card.evidence_refs : [],
      compatibility_constraints: Array.isArray(card.compatibility_edges) ? card.compatibility_edges : [],
    }
  }
  const freshCellPrompt = (packet) =>
    `You are a fresh, independent adjudicator of ONE open plan divergence.\n\n` +
    `<sampling>\n${packet.probe_framing}\n</sampling>\n\n` +
    `<options>\n${packet.options.map((o) => `Option ${o.label}: ${JSON.stringify(o.value)}`).join('\n')}\n</options>\n\n` +
    `<evidence>\n${JSON.stringify(packet.evidence_refs)}\n</evidence>\n\n<constraints>\n${JSON.stringify(packet.compatibility_constraints)}\n</constraints>\n\n` +
    `<rubric>\n${COUNCIL_RUBRIC}${packet.rubric_clarification ? `\n\nDual-signed clarification (both heads signed the SAME text):\n${packet.rubric_clarification}` : ''}\n</rubric>\n\n` +
    `<task>${FRESH_CELL_TASK}\nEmit choice FIRST (and, for a NEITHER, defects.K + defects.M); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  // normFreshInstance — normalize a cell payload (choice + K/M defects) back to canonical P0/P1 for
  // aggregateHead (a NEITHER's defects ride as {P0,P1}). The seed/mapping never leave the script.
  const normFreshInstance = (call, payload) => {
    const d = payload && payload.defects
    const K = d && Array.isArray(d.K) ? d.K : []
    const M = d && Array.isArray(d.M) ? d.M : []
    const defects = call.label_mapping === 'swapped' ? { P0: M, P1: K } : { P0: K, P1: M }
    return { cell: call.cell, outcome: normalizeCellVerdict(payload && payload.choice, call.label_mapping), defects }
  }
  // dispatchFreshCell — one FRESH context. A fable cell is gateAgent(model:'fable', twoHeads:'required');
  // a sol cell is BYTE-OWNED (solByteOwnedPlan + invocation-exact cross-check, every new leg born
  // byte-owned). A dead/receiptless cell FOLDS (returns null) — degradation of THAT cell, folded by
  // aggregateHead's honesty, never a council seat-death.
  const dispatchFreshCell = async (call, card, ph, clarification) => {
    const packet = freshCellPacket(call, card, clarification)
    const prompt = freshCellPrompt(packet)
    if (call.head === 'fable') {
      const sink = {}
      const r = await gateAgent(prompt, { label: `fable:fresh:${call.card_id}`, phase: ph, model: CLAUDE_HEAD_MODEL, effort: 'high', twoHeads: 'required', schema: FRESH_CELL_SCHEMA, provenance: sink })
      if (r == null) return null
      return normFreshInstance(call, r)
    }
    const phaseTag = `FRESH-${call.cell}-s${call.sample}-${card.divergence_id}`
    const plan = solByteOwnedPlan({ phaseTag, attempt: 1, effort: 'high', codexPrompt: prompt, packetObj: packet, payloadSchema: FRESH_CELL_SCHEMA })
    const sink = {}
    const payload = await gateAgent(plan.prompt, { label: `sol:fresh:${call.card_id}`, phase: ph, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(FRESH_CELL_SCHEMA), provenance: sink })
    let cross = { ledger_verified: false }
    if (payload != null && sink.receipt_verified === true) cross = await runSolByteOwnedCrossCheck(`sol:fresh:${call.card_id}`, phaseTag, 1, plan.files.out, sink, payload, plan.promptSha, plan.packetSha, ph)
    pushSolReceipt(`sol:fresh:${call.card_id}`, sink, cross)
    if (!(payload != null && sink.receipt_verified === true && cross.ledger_verified === true)) return null // a folded sol cell — not a seat death
    return normFreshInstance(call, payload)
  }
  // freshPlanFor — the FROZEN 2×2 schedule + the two head-side frozen packet sets for one divergence
  // (pure, built BEFORE any dispatch so FRESH_CARDS_SEALED commits sealed-before-exposure).
  const freshPlanFor = (card, clarification) => {
    const schedule = freshRoundSchedule({ seed: councilSeedDigest, divergenceId: card.divergence_id, tier: freshRoundTier })
    const packetsByHead = { fable: [], sol: [] }
    for (const call of schedule.calls) packetsByHead[call.head].push({ card_id: call.card_id, packet: freshCellPacket(call, card, clarification) })
    return { card, schedule, packetsByHead, clarification: clarification != null ? clarification : null }
  }
  // executeFreshRound — dispatch every cell of a FROZEN plan, normalize, and aggregate (never
  // majority-washed). A folded cell drops from its head's schedule ⇒ aggregateHead sees it as
  // schedule-incomplete (no decisive head), never a council seat-death.
  const executeFreshRound = async (plan, ph) => {
    const instByHead = { fable: [], sol: [] }
    for (const call of plan.schedule.calls) {
      const inst = await dispatchFreshCell(call, plan.card, ph, plan.clarification)
      if (inst) instByHead[call.head].push(inst)
    }
    const fableAgg = aggregateHead(instByHead.fable, { tier: freshRoundTier })
    const solAgg = aggregateHead(instByHead.sol, { tier: freshRoundTier })
    return { council: aggregateCouncil(fableAgg, solAgg), fableAgg, solAgg }
  }
  // runFreshRound — the full ONE-divergence round (plan → execute); the rubric rerule reuses it, passing
  // the dual-signed clarification so every rerule cell rules under COUNCIL_RUBRIC + the identical text.
  const runFreshRound = async (card, ph, clarification) => executeFreshRound(freshPlanFor(card, clarification), ph)
  // adoptAddFor — the settled entry a decisive/ref/reversibility adoption of `side` (P0|P1) contributes
  // for `card` (an {absent:true} side or a NEITHER contributes nothing). Null ⇒ nothing to add.
  const adoptAddFor = (card, side) => {
    if (side !== 'P0' && side !== 'P1') return null
    const v = side === 'P0' ? card.position_0 : card.position_1
    if (v && typeof v === 'object' && v.absent === true) return null
    return { topic: card.topic, value: v, slot: side, ordinal: null }
  }
  // freshReRatify — the FRESH RATIFY round over the amended bundle: settle the adopted + agreed sides,
  // clear the open divergences, rerender/scribe, then a blind dual verdict. Dual-APPROVE ⇒ the certificate
  // (twin_ratified stays reachable ONLY through this ratify round); anything else ⇒ the honest terminal.
  const freshReRatify = async (extraAdds, ph) => {
    const settled = [...councilBundle.settled_decisions.map((e) => ({ ...e })), ...extraAdds]
    const closure = validatePlanClosure({ settled, requires: requiresFromSettled(settled) })
    if (!closure.ok) { await escalateCouncil(`the fresh-round adoption violates closure: ${closure.violations.map((v) => `${v.kind}@${v.topic}`).join(', ')}`, ph); return }
    settled.sort((x, y) => { const kx = canonicalJson({ t: x.topic, v: x.value }), ky = canonicalJson({ t: y.topic, v: y.value }); return kx < ky ? -1 : kx > ky ? 1 : 0 })
    const bd = buildDecisionBundle({ common_trunk: councilBundle.common_trunk, settled_decisions: settled, open_divergences: [], renderer_version: councilBundle.renderer_version, evidence_manifest_hash: councilBundle.evidence_manifest_hash })
    if (!bd.valid) { await escalateCouncil(`the fresh-round adopted bundle is invalid: ${bd.errors.map((e) => e.code).join(', ')}`, ph); return }
    councilBundle = bd.bundle; councilBundleHash = bd.hash
    const rr = await renderScribeCompare(ph)
    if (!rr) return
    const rv = await runBlindVerdict('RATIFY_FRESH', 'rFresh', councilBundleHash, rr.plan_hash, null, [])
    if (rv.degraded) return
    // The RATIFY_FRESH verdicts pass the SAME ratification rails as RATIFY_1/2 —
    // validateRatification over the current ctx, the verdict-shape rail, the artifact-hash echo, and the
    // dual-APPROVE gate. A malformed/wrong-hash verdict is a missing head ⇒ DEGRADED; a VALID substantive
    // BLOCK/NEITHER is a live block ⇒ the honest COUNCIL_DEADLOCK terminal (never 'certificate degradation').
    const ctx = { bundle_hash: councilBundleHash, open_divergence_ids: [], compatibility_edges: [] }
    const vF = validateRatification(rv.rF, ctx), vS = validateRatification(rv.rS, ctx)
    const shF = verdictShapeError(rv.rF), shS = verdictShapeError(rv.rS)
    if (!vF.valid || !vS.valid || shF || shS) {
      const fBad = !vF.valid || !!shF, sBad = !vS.valid || !!shS
      await degradeCouncil(fBad && sBad ? 'both' : (fBad ? 'fable' : 'sol'), `invalid ratification at RATIFY_FRESH (${[fBad ? `fable${shF ? `: ${shF}` : ''}` : null, sBad ? `sol${shS ? `: ${shS}` : ''}` : null].filter(Boolean).join('; ')})`, ph)
      return
    }
    if (rv.rF.verdict === 'APPROVE' && rv.rS.verdict === 'APPROVE') {
      await sealFromSelections(rv, councilBundleHash, rr.plan_hash, [], 'RATIFY_2_SEALED', ph, true)
      return
    }
    const blk = (r) => (r.verdict === 'BLOCK' || r.verdict === 'NEITHER') && Array.isArray(r.findings) ? r.findings : []
    const freshCards = [...blk(rv.rF), ...blk(rv.rS)].map((f) => ({ finding_id: f.finding_id, claim: f.claim, required_change: f.required_change }))
    await deadlockCouncil(freshCards.length ? freshCards : [{ finding_id: 'ratify-fresh', claim: 'the fresh ratify round did not dual-APPROVE', required_change: 'operator resolution' }], ph, 'the fresh-round adoption re-entered ratification and drew a live BLOCK/NEITHER from a valid seat — an honest deadlock, operator resolution required (a live block is never certificate degradation)')
  }
  // sealProvisional — ONE twin_deadlock_resolved terminal over the FULL accumulated settlement
  // (settled adds + EVERY provisionally-adopted two-way door). The open divergences clear only because every
  // card reached a resolution (settled or provisional); a combined MEL NAMES every provisional adoption. It
  // exposes the canonical certificate and seals the DEADLOCK_RESOLVED master_plan row build reads.
  // NEVER twin_ratified.
  const sealProvisional = async (adds, provisionalList, ph) => {
    const provAdds = provisionalList.map((p) => p.add).filter(Boolean)
    const settled = [...councilBundle.settled_decisions.map((e) => ({ ...e })), ...adds, ...provAdds]
    const closure = validatePlanClosure({ settled, requires: requiresFromSettled(settled) })
    if (!closure.ok) { await escalateCouncil(`the provisional (reversibility) adoption violates closure: ${closure.violations.map((v) => `${v.kind}@${v.topic}`).join(', ')}`, ph); return }
    settled.sort((x, y) => { const kx = canonicalJson({ t: x.topic, v: x.value }), ky = canonicalJson({ t: y.topic, v: y.value }); return kx < ky ? -1 : kx > ky ? 1 : 0 })
    const bd = buildDecisionBundle({ common_trunk: councilBundle.common_trunk, settled_decisions: settled, open_divergences: [], renderer_version: councilBundle.renderer_version, evidence_manifest_hash: councilBundle.evidence_manifest_hash })
    if (!bd.valid) { await escalateCouncil(`the provisional bundle is invalid: ${bd.errors.map((e) => e.code).join(', ')}`, ph); return }
    councilBundle = bd.bundle; councilBundleHash = bd.hash
    const rr = await renderScribeCompare(ph)
    if (!rr) return
    if (councilTerminal !== null) return
    const primary = provisionalList[0]
    const mel = provisionalList.length === 1
      ? primary.mel
      : buildMelRecord({ dissent: provisionalList.map((p) => `'${p.card.topic}' adopted ${p.side} by the reversibility rule`).join('; '), limitation: `${provisionalList.length} decisions adopted PROVISIONALLY (reversible two-way doors) — revisit if any assumption breaks`, reviewTrigger: { at_milestone: 'the milestone(s) that consume these decisions' }, openIssues: provisionalList.flatMap((p) => [{ subsystem: p.card.topic, note: 'provisional reversibility adoption — validate the choice in build' }, { subsystem: p.card.topic, note: 'the losing side remains a viable fallback' }]) })
    // The certificate binds template_hash + run_token_hash (alongside bundle_hash + plan_hash) so
    // the single certificate hash pins ALL FIVE bindings build re-verifies before it trusts this terminal.
    const certificate = { renderer_version: rendererVer, bundle_hash: councilBundleHash, plan_hash: rr.plan_hash, template_hash: templateHash, run_token_hash: runTokenHash, adopted_divergence: primary.card.divergence_id, adopted_side: primary.side, door: primary.door, adopted: provisionalList.map((p) => ({ divergence_id: p.card.divergence_id, side: p.side, door: p.door })), mel }
    // PERSIST the certificate reloadably (the scribe+hash idiom) — a councilDir file whose
    // sha equals the certificate_hash bound into the terminal row. Build RELOADS it, re-anchors the CURRENT
    // plan, and verifies plan/bundle/certificate/template/run-token before advancing; a terminal build
    // cannot rehydrate must never seal, so a persist mismatch is a gated escalation (never a stale advance).
    const certBytes = canonicalJson(certificate)
    const certificateHash = sha256Hex(certBytes)
    await agent(scribeBytesPrompt(deadlockCertFile, certBytes), { label: 'thoth:deadlock-cert-scribe', phase: ph, model: 'haiku', schema: SCRIBE_SCHEMA })
    const certPersisted = await agent(planHashPrompt(deadlockCertFile), { label: 'thoth:deadlock-cert-persist-hash', phase: ph, model: 'haiku', schema: PLAN_HASH_SCHEMA })
    const certPersistedHash = certPersisted && typeof certPersisted.plan_sha256 === 'string' && SHA64_RE.test(certPersisted.plan_sha256) ? certPersisted.plan_sha256 : null
    if (certPersistedHash !== certificateHash) { await escalateCouncil(`the DEADLOCK_RESOLVED certificate did not persist reloadably — the sealed file (${certPersistedHash ? String(certPersistedHash).slice(0, 12) + '…' : 'no valid hash'}) does not match the certificate hash (${String(certificateHash).slice(0, 12)}…); a terminal build cannot rehydrate never seals`, ph); return }
    const rec = twinDeadlockResolved({ resolution: 'reversibility_rule', certificate, artifact_hash: councilBundleHash })
    councilTerminal = 'DEADLOCK_RESOLVED'
    councilTerminalRecord = rec
    councilCertificate = certificate
    councilBlockedReason = `provisional adoption under the reversibility rule — twin_deadlock_resolved, NOT twin_ratified; the MEL time-boxes an operator review`
    log(`TWIN COUNCIL DEADLOCK RESOLVED — reversibility rule adopted ${provisionalList.length} two-way door(s) [${provisionalList.map((p) => p.card.divergence_id + '=' + p.side).join(', ')}]; a provisional twin_deadlock_resolved with an MEL (auto-summon: ${mel.auto_summon_operator}). NEVER twin_ratified.`)
    await lore('architecture.council_deadlock_resolved', `The reversibility rule breaks the deadlock — ${provisionalList.length} two-way door(s) adopted provisionally (twin_deadlock_resolved, an MEL time-boxes the review)`, { doors: provisionalList.length }, ph)
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'RUBRIC_CHECK', decision_bundle_hash: councilBundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: { resolution: 'reversibility_rule', doors: provisionalList.map((p) => p.door) }, codex_receipt_hash: null, status: 'sealed' }, ph)
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'DEADLOCK_RESOLVED', decision_bundle_hash: councilBundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: { resolution: 'reversibility_rule', adopted: certificate.adopted, plan_hash: rr.plan_hash, certificate_hash: certificateHash, mel }, codex_receipt_hash: null, status: 'sealed' }, ph)
  }
  // resolveReversibility — classify ONE opposed card's reversibility (blind pair, byte-owned Sol). Returns
  // { provisional: {card, side, mel, door, add, sel} } (a two-way door) or { gated: true } (both one-way / a
  // dead classification seat). It NEVER terminates — the ladder aggregates and seals once.
  const resolveReversibility = async (card, ph) => {
    const fSink = {}
    const revPrompt =
      `A council divergence over the decision '${card.topic}' is deadlocked. Two options:\n` +
      `- P0: ${JSON.stringify(card.position_0)}\n- P1: ${JSON.stringify(card.position_1)}\n\n<task>${REVERSIBILITY_TASK} ${PAYLOAD_FIRST}</task>`
    const solPlan = solByteOwnedPlan({ phaseTag: `REVERSIBILITY-${card.divergence_id}`, attempt: 1, effort: 'high', codexPrompt: revPrompt, packetObj: { divergence_id: card.divergence_id, topic: card.topic, position_0: card.position_0, position_1: card.position_1 }, payloadSchema: REVERSIBILITY_SCHEMA })
    const sSink = {}
    const [fRev, sRevEnv] = await parallel([
      () => gateAgent(revPrompt, { label: `fable:reversibility:${card.divergence_id}`, phase: ph, model: CLAUDE_HEAD_MODEL, effort: 'high', twoHeads: 'required', schema: REVERSIBILITY_SCHEMA, provenance: fSink }),
      () => gateAgent(solPlan.prompt, { label: `sol:reversibility:${card.divergence_id}`, phase: ph, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(REVERSIBILITY_SCHEMA), provenance: sSink }),
    ])
    let sCross = { ledger_verified: false }
    if (sRevEnv != null && sSink.receipt_verified === true) sCross = await runSolByteOwnedCrossCheck(`sol:reversibility:${card.divergence_id}`, `REVERSIBILITY-${card.divergence_id}`, 1, solPlan.files.out, sSink, sRevEnv, solPlan.promptSha, solPlan.packetSha, ph)
    pushSolReceipt(`sol:reversibility:${card.divergence_id}`, sSink, sCross)
    const solOk = sRevEnv != null && sSink.receipt_verified === true && sCross.ledger_verified === true
    // a missing/dead classification card is a one-way door for that option (never a silent two-way adopt)
    const seal = sealReversibility(fRev || {}, solOk ? sRevEnv : {}, councilSeedDigest)
    if (seal.resolution === 'gated') return { gated: true }
    const mel = buildMelRecord({ dissent: `the council could not agree on '${card.topic}'; the reversibility rule adopts the two-way door ${seal.adopt}`, limitation: `'${card.topic}' is adopted PROVISIONALLY (${seal.door}) — it is a reversible choice, revisit if the assumption breaks`, reviewTrigger: { at_milestone: 'the milestone that consumes this decision' }, openIssues: [{ subsystem: card.topic, note: 'provisional reversibility adoption — validate the choice in build' }, { subsystem: card.topic, note: 'the losing side remains a viable fallback' }] })
    return { provisional: { card, side: seal.adopt, mel, door: seal.door, add: adoptAddFor(card, seal.adopt), sel: { divergence_id: String(card.divergence_id), selection: seal.adopt } } }
  }
  // resolveRubricThenReversibility — ONE reference-unsettled card through the rubric rung (dual-signed
  // clarification + rerule) then reversibility. Returns { settled:{add,sel} } | { provisional } |
  // { ambiguity } | { gated }. It NEVER terminates the ladder (the ladder aggregates + seals once).
  const resolveRubricThenReversibility = async (card, ph) => {
    const rubricPrompt =
      `A council divergence over the decision '${card.topic}' is deadlocked and the RUBRIC may be indeterminate.\n` +
      `- P0: ${JSON.stringify(card.position_0)}\n- P1: ${JSON.stringify(card.position_1)}\n\n<rubric>\n${COUNCIL_RUBRIC}\n</rubric>\n\n<task>${RUBRIC_AMEND_TASK} ${PAYLOAD_FIRST}</task>`
    const rSink = {}
    const rubricSol = solByteOwnedPlan({ phaseTag: `RUBRIC-${card.divergence_id}`, attempt: 1, effort: 'high', codexPrompt: rubricPrompt, packetObj: { divergence_id: card.divergence_id, topic: card.topic, position_0: card.position_0, position_1: card.position_1 }, payloadSchema: RUBRIC_AMEND_SCHEMA })
    const [fRub, sRubEnv] = await parallel([
      () => gateAgent(rubricPrompt, { label: `fable:rubric-amend:${card.divergence_id}`, phase: ph, model: CLAUDE_HEAD_MODEL, effort: 'high', twoHeads: 'required', schema: RUBRIC_AMEND_SCHEMA, provenance: {} }),
      () => gateAgent(rubricSol.prompt, { label: `sol:rubric-amend:${card.divergence_id}`, phase: ph, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(RUBRIC_AMEND_SCHEMA), provenance: rSink })
    ])
    // The Sol rubric leg is BYTE-OWNED — the invocation-exact cross-check must ledger_verify it.
    let sRubCross = { ledger_verified: false }
    if (sRubEnv != null && rSink.receipt_verified === true) sRubCross = await runSolByteOwnedCrossCheck(`sol:rubric-amend:${card.divergence_id}`, `RUBRIC-${card.divergence_id}`, 1, rubricSol.files.out, rSink, sRubEnv, rubricSol.promptSha, rubricSol.packetSha, ph)
    pushSolReceipt(`sol:rubric-amend:${card.divergence_id}`, rSink, sRubCross)
    const solRub = (sRubEnv != null && rSink.receipt_verified === true && sRubCross.ledger_verified === true) ? sRubEnv : null
    // Dual-sign requires EXACT byte equality of the two clarification strings — NO normalization
    // (no lowercase, no whitespace collapse). 'Use P0' and 'use   p0' are DIFFERENT bytes ⇒ NOT dual-signed.
    // (The trim()!=='' guard only rejects an empty/whitespace-only clarification; it is not part of the
    // equality comparison — both sides are already byte-identical when it runs.)
    const exactClar = !!(fRub && solRub && typeof fRub.clarification === 'string' && typeof solRub.clarification === 'string' && fRub.clarification === solRub.clarification && fRub.clarification.trim() !== '')
    const bothSign = !!(fRub && solRub && fRub.sign === true && solRub.sign === true && exactClar)
    // FREEZE the EXACT dual-signed clarification bytes — sha256 of the raw string bytes (not
    // canonicalJson) into the RUBRIC_CHECK checkpoint — and supply ONLY these exact bytes to the rerule so
    // every rerule cell rules under COUNCIL_RUBRIC + the identical text BOTH heads signed.
    const signedClarification = bothSign ? String(fRub.clarification) : null
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'RUBRIC_CHECK', decision_bundle_hash: councilBundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: { dual_signed: !!bothSign, clarification_hash: signedClarification != null ? sha256Hex(signedClarification) : null, divergence_id: String(card.divergence_id) }, codex_receipt_hash: sRubCross.codex_receipt_hash || null, status: 'sealed' }, ph)
    if (bothSign) {
      log(`FRESH ROUND: the rubric was dual-signed indeterminate — one rerule of the 2×2 for '${card.divergence_id}' under the frozen clarification`)
      const reround = await runFreshRound(card, ph, signedClarification)
      if (councilTerminal !== null) return { terminal: true }
      if (reround.council.route === 'agreement') { const add = adoptAddFor(card, reround.council.position); return { settled: { add, sel: { divergence_id: String(card.divergence_id), selection: reround.council.position } } } }
      if (reround.council.route === 'ambiguity') return { ambiguity: true }
      // still structural ⇒ fall through to reversibility on this card
    }
    return await resolveReversibility(card, ph)
  }
  // runFreshRoundLadder — the ladder over the opposed still-open divergence cards (+ the already-AGREED
  // adds the seal round settled). Cost ceilings BEFORE dispatch; then the 2×2 rounds, the checkpoints,
  // atomic compatibility, and the outcome routing. agreedSel = the ratify-agreed cards' selection
  // identities (id + side) and allEdges = the compatibility edges of the COMPLETE open-card partition
  // (agreed + disagreed) — both threaded whole so the final atomic-combination check validates the ENTIRE
  // final selection map (agreed AND laddered) against ALL edges before the single seal, never just the
  // disagreed subset (an incompatibility joining an agreed selection to a ladder-resolved one is caught).
  const runFreshRoundLadder = async (cards, agreedAdds, agreedSel, allEdges, ph) => {
    // Cost ceilings BEFORE any dispatch (a flood/oversize is a DECISION, never summarized).
    if (cards.length > FRESH_MAX_DIVERGENCES) { await escalateCouncil(`the fresh-round ladder would carry ${cards.length} still-open divergences, over the cap of ${FRESH_MAX_DIVERGENCES} — a divergence flood is a gated operator checkpoint, never a budget explosion`, ph); return }
    for (const card of cards) {
      const bytes = utf8ByteLength(canonicalJson({ position_0: card.position_0, position_1: card.position_1, evidence_refs: card.evidence_refs || [], compatibility_edges: card.compatibility_edges || [] }))
      if (bytes > FRESH_CARD_MAX_BYTES) { await escalateCouncil(`fresh-round card '${card.divergence_id}' is ${bytes} canonical bytes, over the ${FRESH_CARD_MAX_BYTES}-byte per-card ceiling — an oversize card is REJECTED before dispatch, never summarized by any model`, ph); return }
    }
    // FRESH_CARDS_SEALED — the paired barrier: both heads' frozen 2×2 position-card sets, FROZEN and
    // sealed BEFORE exposure (a half-settled cell set is never exposed; matchCheckpoint reruns the paired
    // phase on mismatch). The plans are pure — every cell packet is fixed before the first dispatch.
    const plans = cards.map((card) => freshPlanFor(card))
    const fableCards = plans.flatMap((p) => p.packetsByHead.fable)
    const solCards = plans.flatMap((p) => p.packetsByHead.sol)
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'FRESH_CARDS_SEALED', decision_bundle_hash: councilBundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { [slotOf('fable')]: sha256Hex(canonicalJson(fableCards)), [slotOf('sol')]: sha256Hex(canonicalJson(solCards)) }, seat_provenance: { [slotOf('fable')]: { head: 'fable' }, [slotOf('sol')]: { head: 'sol' } }, codex_receipt_hash: null, status: 'sealed' }, ph)
    const rounds = []
    for (const plan of plans) rounds.push(await executeFreshRound(plan, ph))
    if (councilTerminal !== null) return // a terminal set mid-round
    const routes = rounds.map((r) => r.council)
    // FRESH_CELLS_SETTLED — the script-only aggregation barrier (0 seats).
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'FRESH_CELLS_SETTLED', decision_bundle_hash: councilBundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: { routes: routes.map((c, i) => ({ divergence_id: cards[i].divergence_id, route: c.route, class: c.class })) }, codex_receipt_hash: null, status: 'sealed' }, ph)
    log(`FRESH ROUND: ${cards.length} divergence(s) re-adjudicated — ${routes.map((c, i) => `${cards[i].divergence_id}:${c.route}`).join(', ')}`)
    // Outcome routing (aggregation rules).
    if (routes.some((c) => c.route === 'ambiguity')) {
      const amb = routes.map((c, i) => `${cards[i].divergence_id}:${c.class}`).join(', ')
      await gatedOrDeadlock(`the fresh round is AMBIGUOUS (${amb}) — instability or a decisive-vs-no_decision split; the council records the ambiguity and terminates honestly (a fresh drafting cycle is v3.1 scope, never a silent adoption)`, cards, ph)
      return
    }
    // EXPLICIT settled/open partition — thread EVERY card to a resolution. Agreement cards settle;
    // structural cards flow reference → rubric → reversibility (a LOOP over ALL of them, never just [0]);
    // fresh agreements + reference resolutions + rerule agreements accumulate as adds; provisional (two-way
    // door) adoptions accumulate; an unresolved card reaches a terminal that NAMES it. The final combination
    // validates atomically (compatibility edges) before ONE freshReRatify / sealProvisional, and the open set
    // clears only for entries actually settled — nothing is silently dropped.
    const adds = [...agreedAdds]
    // The combination selection map STARTS with the ratify-agreed selection identities so the final
    // atomic check spans agreed AND laddered selections (a value-only add carries no selection identity).
    const comboSel = [...(Array.isArray(agreedSel) ? agreedSel : [])] // { divergence_id, selection }
    const structural = []
    for (let i = 0; i < cards.length; i++) {
      if (routes[i].route === 'agreement') { const a = adoptAddFor(cards[i], routes[i].position); if (a) adds.push(a); comboSel.push({ divergence_id: String(cards[i].divergence_id), selection: routes[i].position }) }
      else structural.push(cards[i])
    }
    // (a) reference reduction — ONE bounded check leg per structural divergence (every card, accumulating).
    const refUnsettled = []
    for (const card of structural) {
      const ref = await agent(
        `You are a reference-reduction check — cite ONLY what a controlling reference dictates, never a new opinion.\n\n` +
        `<inputs>\n${visionFile}, ${docsDir}/arch-constraints.md (${noWander})\n</inputs>\n\n` +
        `<divergence>\nDecision '${card.topic}':\n- P0: ${JSON.stringify(card.position_0)}\n- P1: ${JSON.stringify(card.position_1)}\n</divergence>\n\n` +
        `<task>${REFERENCE_REDUCTION_TASK} ${PAYLOAD_FIRST}</task>`,
        { label: `thoth:reference-reduction:${card.divergence_id}`, phase: ph, model: 'haiku', schema: REFERENCE_REDUCTION_SCHEMA }
      )
      if (ref && ref.settles === true && (ref.adopt === 'P0' || ref.adopt === 'P1')) { const add = adoptAddFor(card, ref.adopt); if (add) adds.push(add); comboSel.push({ divergence_id: String(card.divergence_id), selection: ref.adopt }) }
      else refUnsettled.push(card)
    }
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'REFERENCE_REDUCTION', decision_bundle_hash: councilBundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: { settled: structural.length - refUnsettled.length, unsettled: refUnsettled.length }, codex_receipt_hash: null, status: 'sealed' }, ph)
    // (b)+(c) EVERY reference-unsettled card proceeds through the rubric rung then reversibility (a LOOP).
    const provisionalList = []
    for (const card of refUnsettled) {
      const res = await resolveRubricThenReversibility(card, ph)
      if (councilTerminal !== null) return
      if (res.terminal) return
      if (res.ambiguity) { await gatedOrDeadlock(`the rubric rerule for '${card.divergence_id}' is AMBIGUOUS — the stage records it and terminates honestly`, [card], ph); return }
      if (res.gated) { await gatedOrDeadlock(`the fresh-round cascade found NO two-way door for '${card.divergence_id}' (both options one-way, or a reversibility seat died) — reference reduction and the rubric amendment did not settle it either`, [card], ph); return }
      if (res.settled) { if (res.settled.add) adds.push(res.settled.add); comboSel.push(res.settled.sel) }
      else if (res.provisional) { provisionalList.push(res.provisional); comboSel.push(res.provisional.sel) }
    }
    // (d) the FINAL combination validates atomically (compatibility edges) before the ONE seal — an
    // incompatible combination is never adopted.
    const selOf = new Map(comboSel.map((s) => [s.divergence_id, s.selection]))
    // Check against ALL edges of the complete open-card partition (agreed + disagreed), not just
    // the disagreed subset — an edge joining an agreed selection to a ladder-resolved one is now detectable.
    const edges = Array.isArray(allEdges) ? allEdges : []
    const incompatible = edges.some((edge) => { const pair = Array.isArray(edge) ? edge : [edge && edge.left, edge && edge.right]; return Array.isArray(pair) && pair.length === 2 && pair.every((m) => m && selOf.get(String(m.divergence_id)) === m.selection) })
    if (incompatible) { await gatedOrDeadlock(`the fresh-round resolution COMBINATION violates a compatibility edge — an incompatible combination is never adopted`, cards, ph); return }
    if (provisionalList.length) { log(`FRESH ROUND: ${provisionalList.length} divergence(s) adopted PROVISIONALLY (reversibility rule) + ${adds.length - agreedAdds.length} settled — twin_deadlock_resolved over the full combination`); await sealProvisional(adds, provisionalList, ph); return }
    log(`FRESH ROUND: every divergence resolved (agreement/reference/rerule) — adopting the full combination + re-entering ratification (never a direct certificate)`)
    await freshReRatify(adds, ph)
  }

  // ── RATIFY_1: blind simultaneous verdicts over the populated bundle ──
  const r1 = await runBlindVerdict('RATIFY_1', 'r1', bundleH, planHash, null, r1Cards)
  if (r1.degraded) return
  const r1Ctx = { bundle_hash: bundleH, open_divergence_ids: openIdsOf(r1Cards), compatibility_edges: edgesOf(r1Cards) }
  const vF1 = validateRatification(r1.rF, r1Ctx)
  const vS1 = validateRatification(r1.rS, r1Ctx)
  // The verdict-shape rail: an empty, duplicate-id, or evidence-free BLOCK/NEITHER is ALSO an invalid verdict — a
  // standing-free block would otherwise be clearable by a bare round-two APPROVE.
  const shapeF1 = verdictShapeError(r1.rF), shapeS1 = verdictShapeError(r1.rS)
  if (!vF1.valid || !vS1.valid || shapeF1 || shapeS1) {
    // A head that failed to seal a VALID verdict (bad echo / malformed / evidence-free findings / a
    // selection that misses or over-covers the open set) is a missing head — fail closed.
    const fBad = !vF1.valid || !!shapeF1, sBad = !vS1.valid || !!shapeS1
    await degradeCouncil(fBad && sBad ? 'both' : (fBad ? 'fable' : 'sol'), `invalid ratification at RATIFY_1 (${[fBad ? `fable${shapeF1 ? `: ${shapeF1}` : ''}` : null, sBad ? `sol${shapeS1 ? `: ${shapeS1}` : ''}` : null].filter(Boolean).join('; ')})`, phaseName)
    return
  }
  if (r1.rF.verdict === 'APPROVE' && r1.rS.verdict === 'APPROVE') { await sealFromSelections(r1, bundleH, planHash, r1Cards, 'RATIFY_1_SEALED', phaseName); return }

  // ── Any BLOCK/NEITHER ⇒ exactly ONE answer exchange. A NEITHER is a legal verdict:
  //    its findings name the defects, so it is treated like a BLOCK for the exchange. ──
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'RATIFY_1_SEALED', decision_bundle_hash: bundleH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { [slotOf('fable')]: sha256Hex(canonicalJson(r1.rF)), [slotOf('sol')]: sha256Hex(canonicalJson(r1.rS)) }, seat_provenance: { [slotOf('fable')]: seatProv(r1.sinkF, 'fable'), [slotOf('sol')]: seatProv(r1.sinkS, 'sol') }, codex_receipt_hash: r1.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  const standingFindings = (r) => (r.verdict === 'BLOCK' || r.verdict === 'NEITHER') ? (Array.isArray(r.findings) ? r.findings : []) : []
  // After RATIFY_1 freezes, the SCRIPT assigns canonical R-<round>-<slot>-<nnn> keys
  // (canonicalizeRatifyFindings) — the identity through the ENTIRE answer-exchange / exec-check /
  // standing-block / RATIFY_2 section. The model's finding_id is a NON-authoritative label; a model-order
  // swap can never move a key. Each head's blocks key under ITS seed-assigned slot (slotOf).
  const fableBlocks = canonicalizeRatifyFindings('1', { [slotOf('fable')]: standingFindings(r1.rF) })
  const solBlocks = canonicalizeRatifyFindings('1', { [slotOf('sol')]: standingFindings(r1.rS) })
  // ── Executable-check floor FIRST: a check is DATA until the bounded executor runs it — never let a
  //    head run its own check. Identity is SEAT-SCOPED (`head|finding_id` — a same-string id from
  //    the other head can never alias; the scoping lives in the SCRIPT's keys, never in a prompt).
  //    Execution is FILE-BOUND: the check text lands verbatim in a script file and ONE timeout
  //    wraps the whole thing. Three states: 'confirmed' (exit 0, id-matched — the defect is
  //    demonstrably present, class executed_check), 'refuted' (clean nonzero, id-matched — retired
  //    MECHANICALLY), 'unrun' (no projectPath / mute / garbled / id-mismatched transcript, OR the
  //    infrastructure exits 124/126/127 — timeout / not-executable / not-found mean the check never
  //    truly RAN, so it can neither confirm nor refute; the block STANDS as proposed_check. The
  //    residual misclassification risk of a dependency failure deep in a compound is ACCEPTED and
  //    recorded; the blocking head re-rules at RATIFY_2 with the state visible). ──
  const seatKey = (head, id) => `${head}|${id}`
  const checkState = new Map() // seatKey → 'confirmed' | 'refuted' | 'unrun'
  const checkExit = new Map()  // seatKey → the id-matched exit code (null when the check never ran) — the TYPED evidence heads see
  if (!projectPath) log('TWIN COUNCIL: projectPath absent — executable checks are NOT run; every checked finding stands as proposed_check (fail-closed)')
  const INFRA_EXITS = [124, 126, 127] // timeout / found-but-not-executable / command-not-found
  const runChecksFor = async (head, findings) => {
    for (const f of findings) {
      if (!(f && typeof f.executable_check === 'string' && f.executable_check.trim() !== '')) continue
      const key = seatKey(head, f.id)
      if (!projectPath) { checkState.set(key, 'unrun'); continue }
      const checkFile = `${councilDir}/check-${key.replace(/[^A-Za-z0-9._-]/g, '-')}.check.sh`
      const res = await agent(execCheckPrompt(f, checkFile), { label: `thoth:exec-check:${f.id}`, phase: phaseName, model: 'sonnet', schema: EXEC_CHECK_SCHEMA })
      if (res && res.finding_id === f.id && Number.isInteger(res.exit)) {
        checkExit.set(key, res.exit)
        checkState.set(key, res.exit === 0 ? 'confirmed' : (INFRA_EXITS.includes(res.exit) ? 'unrun' : 'refuted'))
      } else checkState.set(key, 'unrun')
    }
  }
  await runChecksFor('fable', fableBlocks)
  await runChecksFor('sol', solBlocks)
  const remainingFable = fableBlocks.filter((f) => f && f.id && checkState.get(seatKey('fable', f.id)) !== 'refuted') // answered by SOL
  const remainingSol = solBlocks.filter((f) => f && f.id && checkState.get(seatKey('sol', f.id)) !== 'refuted')      // answered by FABLE
  let solAnswers = { answers: [] }, fableAnswers = { answers: [] }
  let solAnswerSink = null, solAnswerCross = null, fableAnswerSink = null
  if (remainingFable.length) {
    const ans = await runSolAnswerLeg(remainingFable)
    if (ans.degraded) return
    // Relational validation — a schema-valid-but-incomplete answer set is a FAILED exchange duty
    // by the ANSWERING head (here Sol) ⇒ DEGRADED naming it.
    const err = answerSetError(remainingFable, ans.payload)
    if (err) { await degradeCouncil('sol', `invalid answer set from the Sol head (${err})`, phaseName); return }
    solAnswers = ans.payload
    solAnswerSink = ans.sink
    solAnswerCross = ans.cross
  }
  if (remainingSol.length) {
    fableAnswerSink = {}
    const fa = await gateAgent(fableAnswerPrompt(remainingSol), { label: 'fable:answer', phase: phaseName, model: CLAUDE_HEAD_MODEL, effort: 'high', twoHeads: 'required', schema: ANSWER_SCHEMA, provenance: fableAnswerSink })
    if (fa == null) { await degradeCouncil('fable', 'Fable seat death during the answer exchange', phaseName); return }
    const err = answerSetError(remainingSol, fa)
    if (err) { await degradeCouncil('fable', `invalid answer set from the Fable head (${err})`, phaseName); return }
    fableAnswers = fa
  }
  // ── Seal the exchange barrier FIRST: ANSWER_EXCHANGE_SEALED is bound to
  //    bundle₁ — the artifact the answers were RENDERED AGAINST — and lands BEFORE Plato consumes the
  //    answers and BEFORE the rehash, so the sealed record can never absorb a post-hoc amendment.
  //    It carries the paired answer artifacts + both answer-leg provenances + the Sol answer leg's
  //    receipt hash — an unanswered side hashes its empty {answers:[]} honestly. ──
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'ANSWER_EXCHANGE_SEALED', decision_bundle_hash: bundleH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { [slotOf('fable')]: sha256Hex(canonicalJson(fableAnswers)), [slotOf('sol')]: sha256Hex(canonicalJson(solAnswers)) }, seat_provenance: { [slotOf('fable')]: fableAnswerSink ? seatProv(fableAnswerSink, 'fable') : null, [slotOf('sol')]: solAnswerSink ? seatProv(solAnswerSink, 'sol') : null }, codex_receipt_hash: solAnswerCross && solAnswerCross.codex_receipt_hash ? solAnswerCross.codex_receipt_hash : null, status: 'sealed' }, phaseName)
  // ACCEPTED findings amend the BUNDLE structurally. Acceptance is SEAT-SCOPED:
  // Sol answers fable-raised findings, Fable answers sol-raised ones (a same-string R-key across heads
  // never aliases — the seat prefix scopes it). REFUTE answers retire NOTHING by themselves — the blocking
  // head re-rules having seen them (peer refutation is re-verdict input, never a script-side retirement).
  const acceptedKeys = new Set()
  for (const a of (Array.isArray(solAnswers.answers) ? solAnswers.answers : [])) if (a && a.answer === 'ACCEPT') acceptedKeys.add(seatKey('fable', a.finding_id))
  for (const a of (Array.isArray(fableAnswers.answers) ? fableAnswers.answers : [])) if (a && a.answer === 'ACCEPT') acceptedKeys.add(seatKey('sol', a.finding_id))
  const acceptedFindings = [
    ...remainingFable.filter((f) => acceptedKeys.has(seatKey('fable', f.id))),
    ...remainingSol.filter((f) => acceptedKeys.has(seatKey('sol', f.id))),
  ]
  const appliedChanges = acceptedFindings.map((f) => f.required_change)
  // ── The BLOCK path: jointly-compatible ACCEPTED corrections apply ONCE as STRUCTURAL
  //    bundle amendments (each finding's typed { target_kind, key, replacement } descriptor; an ACCEPTED
  //    finding WITHOUT one ⇒ GATED_ESCALATION — no free rewrite, plato is retired) → closure → rebuild
  //    → rerender+scribe → rehash. The FINAL blind re-verdict (RATIFY_2) rules over the NEW hashes; when
  //    nothing was accepted the bundle is unchanged and RATIFY_2 rules over the SAME hashes. ──
  let bundleH2 = bundleH, planHash2 = planHash
  const acceptedAmendments = []
  for (const f of acceptedFindings) {
    if (f.target_kind === undefined && f.key === undefined && f.replacement === undefined) {
      await escalateCouncil(`an ACCEPTED ratify-exchange correction ('${f.id}') carries no typed { target_kind, key, replacement } descriptor — a structural bundle amendment is required (free-text corrections are advisory on the T4-full path)`, phaseName); return
    }
    acceptedAmendments.push({ target_kind: f.target_kind, key: f.key, replacement: f.replacement })
  }
  if (acceptedAmendments.length) {
    if (!renderPath) { await escalateCouncil('an ACCEPTED ratify-exchange correction carries a structural descriptor but no rendered bundle exists to amend (a non-render / resume-reuse path) — operator resolution', phaseName); return }
    const amRes = await applyAmendmentsToBundle(acceptedAmendments, phaseName)
    if (!amRes) return // a gated escalation / scribe-write degrade is already set
    bundleH2 = councilBundleHash
    planHash2 = amRes.plan_hash
    synth = synthFromRender()
  }
  // Standing blocks per head (own prior blocking findings minus the check-refuted), with HONEST
  // evidence classes: a runner-CONFIRMED check is executed_check (a real execution happened); a
  // checked-but-unrun finding is proposed_check; an unchecked finding keeps its DECLARED class with
  // claim_type derived via claimTypeForClass — an unrecognized class stays as-is so compareEvidence
  // rules it INCOMPARABLE and the block stands (fail-closed; never coerce to scenario). At RATIFY_2
  // that head's APPROVE must carry changed_evidence equal-or-stronger, or the block STANDS
  // (validateRatification enforces the anti-capitulation rail via validateReversal).
  const standingBlockOf = (head) => (f) => {
    const hasCheck = typeof f.executable_check === 'string' && f.executable_check.trim() !== ''
    if (hasCheck) {
      const cls = checkState.get(seatKey(head, f.id)) === 'confirmed' ? 'executed_check' : 'proposed_check'
      return { finding_id: f.id, evidence: { class: cls }, claim_type: 'executable' }
    }
    return { finding_id: f.id, evidence: { class: f.evidence_class }, claim_type: claimTypeForClass(f.evidence_class) }
  }
  const fableStanding = remainingFable.map(standingBlockOf('fable'))
  const solStanding = remainingSol.map(standingBlockOf('sol'))
  // Each round-two head sees, for its OWN standing findings
  // only — the finding itself (claim, required_change, evidence_refs, evidence_class), the other
  // head's answer (attributed ONLY as "the other head"), and the TYPED check state (state + exit
  // code ONLY — raw stdout/stderr tails NEVER enter any head prompt; they live on disk and in the
  // runner leg's transcript). No identity, receipt, session, model, or token count rides in.
  const exchangeFor = (head, own, peerAnswers) => {
    if (!own.length) return null
    const answersList = Array.isArray(peerAnswers.answers) ? peerAnswers.answers : []
    return {
      findings: own.map((f) => {
        const key = seatKey(head, f.id)
        const a = answersList.find((x) => x && x.finding_id === f.id) || null
        const hasCheck = typeof f.executable_check === 'string' && f.executable_check.trim() !== ''
        return {
          finding_id: f.id,
          claim: f.claim,
          required_change: f.required_change,
          evidence_refs: Array.isArray(f.evidence_refs) ? f.evidence_refs : [],
          evidence_class: f.evidence_class != null ? f.evidence_class : null,
          other_head_answer: a ? { answer: a.answer, evidence_refs: a.evidence_refs, evidence_class: a.evidence_class != null ? a.evidence_class : null } : null,
          check: hasCheck ? { state: checkState.get(key) || 'unrun', exit: checkExit.has(key) ? checkExit.get(key) : null } : null,
        }
      }),
      applied_changes: appliedChanges,
    }
  }
  const exchange = { fable: exchangeFor('fable', remainingFable, solAnswers), sol: exchangeFor('sol', remainingSol, fableAnswers) }

  // ── RATIFY_2: blind re-verdict over the amended bundle ──
  const r2Cards = openCardsAt()
  const r2 = await runBlindVerdict('RATIFY_2', 'r2', bundleH2, planHash2, exchange, r2Cards)
  if (r2.degraded) return
  const r2Ctx = (standing) => ({ bundle_hash: bundleH2, open_divergence_ids: openIdsOf(r2Cards), compatibility_edges: edgesOf(r2Cards), standing_blocks: standing })
  const vF2 = validateRatification(r2.rF, r2Ctx(fableStanding))
  const vS2 = validateRatification(r2.rS, r2Ctx(solStanding))
  // A STRUCTURAL invalidity (bad echo / malformed / evidence-free findings — the verdict-shape rail again) is a
  // missing head ⇒ DEGRADED; an unevidenced reversal is NOT structural — it leaves the prior block
  // standing (the anti-capitulation rail), which is persistent disagreement ⇒ COUNCIL_DEADLOCK below.
  const structuralErr = (v) => v.errors.some((e) => e.code !== 'unevidenced_reversal')
  const shapeF2 = verdictShapeError(r2.rF), shapeS2 = verdictShapeError(r2.rS)
  const fBad2 = structuralErr(vF2) || !!shapeF2, sBad2 = structuralErr(vS2) || !!shapeS2
  if (fBad2 || sBad2) { await degradeCouncil(fBad2 && sBad2 ? 'both' : (fBad2 ? 'fable' : 'sol'), `invalid ratification at RATIFY_2${shapeF2 ? ` (fable: ${shapeF2})` : ''}${shapeS2 ? ` (sol: ${shapeS2})` : ''}`, phaseName); return }
  if (r2.rF.verdict === 'APPROVE' && r2.rS.verdict === 'APPROVE' && vF2.valid && vS2.valid) {
    await sealFromSelections(r2, bundleH2, planHash2, r2Cards, 'RATIFY_2_SEALED', phaseName)
    return
  }
  // Persistent disagreement after RATIFY_2 (any surviving BLOCK/NEITHER, incl. dual NEITHER, or an
  // unevidenced-reversal block that STANDS). Round two is a completed paired barrier — seal
  // RATIFY_2_SEALED (verdict hashes + provenance + receipt) BEFORE the honest COUNCIL_DEADLOCK
  // terminal. Never synthesize, never pick a winner, never demote to a v3.0.1 label.
  await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'RATIFY_2_SEALED', decision_bundle_hash: bundleH2, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { [slotOf('fable')]: sha256Hex(canonicalJson(r2.rF)), [slotOf('sol')]: sha256Hex(canonicalJson(r2.rS)) }, seat_provenance: { [slotOf('fable')]: seatProv(r2.sinkF, 'fable'), [slotOf('sol')]: seatProv(r2.sinkS, 'sol') }, codex_receipt_hash: r2.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  const cards = [...standingFindings(r2.rF), ...standingFindings(r2.rS), ...fableStanding.filter(() => !vF2.valid && r2.rF.verdict === 'APPROVE'), ...solStanding.filter(() => !vS2.valid && r2.rS.verdict === 'APPROVE')].map((f) => ({ finding_id: f.finding_id, claim: f.claim || 'standing block (unevidenced reversal)', required_change: f.required_change || 'operator resolution' }))
  await deadlockCouncil(cards.length ? cards : [{ finding_id: 'ratify-2', claim: 'persistent disagreement', required_change: 'operator resolution' }], phaseName)
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── The Twin Council, LITE FORM: blind dual ratification of the SINGLE lite master plan.
//    Runs at T4 on the LITE path once Athena PASSes. No drafts,
//    no divergence set, no answer exchange — the lite plan IS the artifact (no decision bundle exists):
//    ONE blind required round, both heads at xhigh, Sol receipt-attested through the SAME lifted
//    machinery (solWrapperPlan + invocation-exact cross-check). Dual-APPROVE ⇒ a lite twin_ratified
//    certificate (renderer b42-lite/1). A BLOCK/NEITHER from a live valid seat ⇒ BLOCKED; a dead/
//    receiptless/cross-check-failed seat or a shape-invalid/hash-mismatched verdict ⇒ DEGRADED (a
//    missing head). Any non-RATIFIED terminal keeps the Law BLOCKED — the plan never advances as
//    council-ratified (required-mode uniformity). The full path's degrade idiom mirrored:
//    honest labels, never a silent v3.0.1 downgrade. ──
// ════════════════════════════════════════════════════════════════════════════════════════════════
const runLiteCouncilRatify = async () => {
  const phaseName = 'Athena Weighs'
  await noteClaudeHeadSuccession(phaseName)
  // Evidence manifest — computed EXACTLY as the full path's evidenceManifestHash: a haiku anchor over
  // the frozen inputs (VISION + the arch docs + research when present). A dead/garbled/partial anchor
  // cannot bind the council's evidence ⇒ DEGRADED (never a certificate missing VISION/constraints).
  const frozenInputs = [visionFile, `${docsDir}/architecture.md`, `${docsDir}/tech-stack.md`, `${docsDir}/arch-constraints.md`].concat(researchPresent ? [researchFile] : [])
  const anchor = await agent(anchorPrompt(frozenInputs), { label: 'thoth:lite-council-anchor', phase: phaseName, model: 'haiku', schema: ANCHOR_SCHEMA })
  const anchorFiles = (anchor && Array.isArray(anchor.files)) ? anchor.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : []
  const anchorPaths = anchorFiles.map((f) => f.path)
  const anchorExact =
    anchor && Array.isArray(anchor.files) && anchorFiles.length === anchor.files.length &&
    anchorFiles.length === frozenInputs.length &&
    new Set(anchorPaths).size === anchorFiles.length &&
    frozenInputs.every((p) => anchorPaths.includes(p))
  if (!anchorExact) { await degradeCouncil('evidence', 'lite council-anchor did not produce an exact evidence manifest (every frozen input exactly once, 64-hex digests, no extras)', phaseName); return }
  const manifest = {}
  for (const f of anchorFiles) manifest[f.path] = f.sha256
  evidenceManifestHash = sha256Hex(canonicalJson(manifest))
  evidenceInputHashes = Object.keys(manifest).sort().map((k) => manifest[k])
  councilInitialSeq = (anchor.initial_ledger_seq === null || Number.isInteger(anchor.initial_ledger_seq)) ? anchor.initial_ledger_seq : null
  // seed — run-bound entropy, reserved for divergence-id derivation; NEVER interpolated into a prompt.
  councilSeedDigest = councilSeed({ protocolVersion: COUNCIL_PROTOCOL_VERSION, runToken, initialSeq: councilInitialSeq, keystoneId, templateHash })
  // The lite ratify pair also carries seed-assigned slots, but the parity is assigned only AFTER
  // the pair validates (below), before the first slot-keyed checkpoint (LITE_RATIFY_SEALED).

  // The lite plan artifact IS the bundle (no decision bundle exists on lite): bundle_hash = plan_hash =
  // sha256 of the master-plan.md bytes. Only a real 64-hex digest binds; a mute/invalid anchor
  // degrades — never a guessed or stale hash.
  const ra = await agent(planHashPrompt(masterPlanFile), { label: 'thoth:lite-ratify-anchor', phase: phaseName, model: 'haiku', schema: PLAN_HASH_SCHEMA })
  const planHash = ra && typeof ra.plan_sha256 === 'string' && SHA64_RE.test(ra.plan_sha256) ? ra.plan_sha256 : null
  if (!planHash) { await degradeCouncil('evidence', 'lite ratify-anchor produced no valid plan hash', phaseName); return }
  const bundleH = planHash

  // The blind lite pair (no exchange): both heads rule the single plan at xhigh, Sol receipt-attested.
  // BLINDNESS RAILS: the fable prompt never mentions codex/receipt/session/Sol; the sol packet never
  // names the peer; neither reveals the run token/seed (the raw token rides ONLY the receipt-script argv).
  const evidenceDocs = [masterPlanFile, `${docsDir}/architecture.md`, `${docsDir}/tech-stack.md`, `${docsDir}/arch-constraints.md`, visionFile].concat(researchPresent ? [researchFile] : [])
  const ratifyInputs = `<inputs>\n- The master plan: ${masterPlanFile}\n- Evidence docs: ${evidenceDocs.join(', ')}\n</inputs>`
  const bindingLine = `Binding: artifact_hash = "${bundleH}" (echo it VERBATIM). plan_sha256 = ${planHash}. evidence_manifest_hash = ${evidenceManifestHash}. divergence_selections = [] (no open divergences — the lite plan is the single artifact).`
  const fableRatifyPrompt =
    `You are a council ratifier — rule the lite master plan against the fixed rubric, blind and independent. You do not know how the plan was authored or who else is ruling.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${COUNCIL_RUBRIC}\n</rubric>\n\n` +
    `<binding>\n${bindingLine}\n</binding>\n` +
    `\n<task>${RATIFY_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const solBrief = `${bindingLine}\nRubric:\n${COUNCIL_RUBRIC}`
  const solR = solWrapperPrompt({ phaseTag: 'LITE_RATIFY', attempt: 1, effort: 'xhigh', payloadSchema: RATIFY_SCHEMA, taskText: RATIFY_TASK, briefBody: solBrief, packetObj: { master_plan: masterPlanFile, evidence: evidenceDocs, artifact_hash: bundleH, plan_sha256: planHash, evidence_manifest_hash: evidenceManifestHash } })
  const sinkF = {}, sinkS = {}
  // architecture.council_convened (keystone): the T4-lite pair spawns — two heads rule blind, no drafts.
  await lore('architecture.council_convened', `The Twin Council convenes on the lite plan — two heads rule blind, no drafts to compare`, null, phaseName)
  const [rF, rS] = await parallel([
    () => gateAgent(fableRatifyPrompt, { label: 'fable:ratify:lite', phase: phaseName, model: CLAUDE_HEAD_MODEL, effort: 'xhigh', twoHeads: 'required', schema: RATIFY_SCHEMA, provenance: sinkF }),
    () => gateAgent(solR.prompt, { label: 'sol:ratify:lite', phase: phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(RATIFY_SCHEMA), provenance: sinkS }),
  ])
  let solCross = { ledger_verified: false }
  if (rS != null && sinkS.receipt_verified === true) solCross = await runSolCrossCheck('sol:ratify:lite', 'LITE_RATIFY', solR.files.out, sinkS, rS, phaseName)
  pushSolReceipt('sol:ratify:lite', sinkS, solCross)
  const solOk = rS != null && sinkS.receipt_verified === true && solCross.ledger_verified === true
  if (rF == null || !solOk) {
    const missing = rF == null && !solOk ? 'both' : (rF == null ? 'fable' : 'sol')
    await degradeCouncil(missing, `seat death at LITE_RATIFY (${missing})`, phaseName)
    return
  }
  const vF = validateRatification(rF, { bundle_hash: bundleH, open_divergence_ids: [] })
  const vS = validateRatification(rS, { bundle_hash: bundleH, open_divergence_ids: [] })
  const shapeF = verdictShapeError(rF), shapeS = verdictShapeError(rS)
  // A shape-invalid or hash-mismatched verdict is a missing head ⇒ DEGRADED (fail
  // closed) — a malformed/standing-free block can never advance and is never a silent v3.0.1 label.
  const fBad = !vF.valid || !!shapeF, sBad = !vS.valid || !!shapeS
  if (fBad || sBad) {
    await degradeCouncil(fBad && sBad ? 'both' : (fBad ? 'fable' : 'sol'), `invalid ratification at LITE_RATIFY (${[fBad ? `fable${shapeF ? `: ${shapeF}` : ''}` : null, sBad ? `sol${shapeS ? `: ${shapeS}` : ''}` : null].filter(Boolean).join('; ')})`, phaseName)
    return
  }
  // Assign the P0/P1 parity HERE — after BOTH heads returned alive AND the Sol receipt/cross-check
  // validated AND both verdicts passed the ratification rails (the checks just above), before the first
  // slot-keyed checkpoint (LITE_RATIFY_SEALED). Seed parity is run-bound, never seat identity, never a prompt.
  fableSlot = (parseInt(councilSeedDigest.slice(0, 8), 16) % 2 === 0) ? 'P0' : 'P1'
  solSlot = fableSlot === 'P0' ? 'P1' : 'P0'
  if (rF.verdict === 'APPROVE' && rS.verdict === 'APPROVE') {
    // Both heads APPROVE and valid: seal the lite twin_ratified certificate over the plan-as-bundle,
    // renderer b42-lite/1, each SIGNATURE carrying its own head's seatProv (the sealed idiom); the
    // shared context's seat_provenance is null. A binding defect degrades (never a fabricated council claim).
    const provF = seatProv(sinkF, 'fable'), provS = seatProv(sinkS, 'sol')
    const res = assembleRatifyCertificate({ rF, rS, provF, provS, context: { bundle_hash: bundleH, renderer_version: 'b42-lite/1', plan_hash: planHash, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null } })
    if (!res.ok) { await degradeCouncil('both', `lite certificate could not seal: ${res.reason}`, phaseName); return }
    councilCertificate = res.certificate
    councilTerminal = 'RATIFIED'
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'LITE_RATIFY_SEALED', decision_bundle_hash: bundleH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: { [slotOf('fable')]: sha256Hex(canonicalJson(rF)), [slotOf('sol')]: sha256Hex(canonicalJson(rS)) }, seat_provenance: { [slotOf('fable')]: seatProv(sinkF, 'fable'), [slotOf('sol')]: seatProv(sinkS, 'sol') }, codex_receipt_hash: solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
    await appendCouncilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: templateHash, run_token_hash: runTokenHash, initial_ledger_seq: councilInitialSeq, keystone_id: keystoneId, phase: 'RATIFIED', decision_bundle_hash: bundleH, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash, anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    log(`TWIN COUNCIL RATIFIED (lite) — the lite master plan carries two valid head signatures (bundle ${String(bundleH).slice(0, 12)}…); the Law may lock a council-ratified plan.`)
    // architecture.council_ratified (keystone): both heads signed the lite plan — the master plan is sealed.
    await lore('architecture.council_ratified', `The council rules as one — two signatures seal the lite master plan (bundle ${String(bundleH).slice(0, 12)}…)`, { bundle: String(bundleH).slice(0, 12) }, phaseName)
    return
  }
  // Both verdicts valid but not dual-APPROVE ⇒ a live, valid seat BLOCKED the lite plan (no answer
  // exchange in the lite form) ⇒ honest BLOCKED terminal; the plan does not advance as council-ratified.
  const standing = (r) => (r.verdict === 'BLOCK' || r.verdict === 'NEITHER') ? (Array.isArray(r.findings) ? r.findings : []) : []
  await blockCouncil([...standing(rF), ...standing(rS)], 'the lite plan drew a BLOCK/NEITHER verdict from a live, valid seat (no answer exchange in the lite form) — it cannot advance as council-ratified', phaseName)
}

if (councilCapable && !liteScope && verdict && verdict.verdict === 'PASS' && councilTerminal === null) {
  await runTwinCouncilRatify()
}
// The T4-lite architecture ratification pair. At T4 on the LITE path the single lite plan
// gains the SAME blind required pair. A PROMISED-but-tokenless conductor fails closed DEGRADED (the
// misconfigured doctrine — never a silent v3.0.1 label, mirroring the full path's councilMisconfigured
// branch); a token-bearing run ratifies once Athena PASSes.
if (councilPromised && liteScope && councilTerminal === null) {
  if (!councilCapable) {
    await degradeCouncil('both', 'runToken absent — a T4-lite launch missing the conductor-minted run token cannot bind council receipts or the seed', 'Athena Weighs')
  } else if (verdict && verdict.verdict === 'PASS') {
    await runLiteCouncilRatify()
  }
}

// ── The Law: Asimov compiles the locked acceptance gates ──
// A FLOOR: the Law compiles + locks at ANY posture, lite path included. Runs only after
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
} else if (councilPromised && councilTerminal !== 'RATIFIED' && councilTerminal !== 'DEADLOCK_RESOLVED') {
  // On the twin-council path — FULL or LITE, PROMISED — a missing runToken cannot buy the way
  // out: the Law's precondition is Athena PASS AND either a RATIFIED certificate OR
  // a twin_deadlock_resolved provisional adoption (the reversibility rule's exceptional authority — an
  // MEL time-boxes its review); a DEGRADED, COUNCIL_DEADLOCK, GATED_ESCALATION, BLOCKED, or absent
  // terminal locks nothing. Sub-T4 keeps the v3.0.1 precondition.
  lawReason = `master plan not council-ratified (${councilTerminal || 'no certificate'}) — on the twin-council path the Law locks only a ratified or deadlock-resolved plan`
} else if (!projectPath) {
  lawReason = 'projectPath absent — acceptance checks are project-native (tests/acceptance/) and cannot be written'
} else {
  const lawVoice = lawModel === 'opus' ? voice('opus') : ''
  const asimov = await agent(
    lawVoice +
    `You are Asimov, the Lawgiver. You compile the validated master plan's acceptance criteria ` +
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
  // ── On the T4-full RENDERED path the plan's SC/milestone identity is
  //    the renderer's manifest — the Law is compiled FROM it and may neither MINT nor OMIT. (a) closure(b):
  //    re-validate the FINAL adopted settled set (a violation ⇒ GATED_ESCALATION, loud). (b) manifest-vs-Law:
  //    Asimov's reported plan_sc_ids AND the compiled check ids must match the rendered manifest EXACTLY
  //    (ids + multiplicity + parents) ⇒ a mismatch DEGRADES loud, BEFORE the lock. Guarded on renderManifest
  //    (null off the T4-full path — sub-T4/lite are byte-untouched). ──
  let renderGate = null
  if (renderManifest !== null) {
    const closureB = validatePlanClosure({ settled: councilBundle.settled_decisions, requires: requiresFromSettled(councilBundle.settled_decisions) })
    if (!closureB.ok) {
      const detail = closureB.violations.map((v) => `${v.kind}@${v.topic}`).join(', ')
      await escalateCouncil(`closure(b) — the adopted plan violates closure before the Law lock: ${detail}`, 'The Law')
      renderGate = `closure(b) violated before the lock — ${detail}`
    } else if (lawChecks.length) {
      const multiset = (a) => { const m = {}; for (const x of a) m[String(x)] = (m[String(x)] || 0) + 1; return canonicalJson(m) }
      const manifestMs = multiset(Object.keys(renderManifest))
      const checkIds = lawChecks.map((c) => c.id)
      const idMis = []
      if (multiset(planScIds) !== manifestMs) idMis.push('Asimov plan_sc_ids ≠ rendered manifest')
      if (multiset(checkIds) !== manifestMs) idMis.push('law check ids ≠ rendered manifest')
      const parentMis = lawChecks.filter((c) => Object.prototype.hasOwnProperty.call(renderManifest, c.id) && String(c.milestone) !== String(renderManifest[c.id])).map((c) => `${c.id}@${c.milestone}≠${renderManifest[c.id]}`)
      if (idMis.length || parentMis.length) {
        const detail = [...idMis, ...(parentMis.length ? [`parent mismatch: ${parentMis.join(', ')}`] : [])].join('; ')
        log(`The Law is BLOCKED — the Lawgiver's inventory does not match the rendered manifest (${detail}); Asimov may neither mint nor omit an SC. The lock never proceeds.`)
        renderGate = `manifest-vs-Law mismatch (Asimov minted or omitted) — ${detail}`
      }
    }
  }
  if (renderGate) {
    lawReason = renderGate
  } else if (!lawChecks.length) {
    lawReason = 'Asimov produced no check manifest'
  } else {
    // Coverage is ARITHMETIC, not judgment: every SC exactly one check entry. Duplicates,
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
      // ── The dry-run gate: checks are code; they execute before
      // we trust them — reading is not executing. `kiln-law dryrun` is legal PRE-LOCK (no
      // lock_commit, no tamper gate, no git) and leaves ZERO evidence residue: a dry-run is a
      // transcript, never a run record; probes stay deferred (exit-78 semantics untouched).
      // Athena's testability duty moves onto EXECUTED evidence: per check she rules honest-red
      // (ran, failed on the missing feature — the greenfield expectation) vs broken-check
      // (crashed on its own code: traceback class, usage error, missing interpreter) vs
      // legitimately green (brownfield pre-satisfaction, recorded pre_satisfied at lock).
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
        // A present-but-schema-invalid law.json is Asimov's OWN compilation
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
        // Index BEFORE the single lock commit: kiln-law index hashes the on-disk
        // gates and records lock_commit = HEAD (the last pre-gate commit — git content-addressing
        // means law.json can never carry the sha of the commit that contains it). The one
        // "test(law): lock acceptance gates" commit that follows carries the gates + the indexed
        // law.json; the tamper gate's git arm anchors on that commit (lock_commit's first
        // descendant touching the locked paths), so laundering is caught from the moment the
        // gates land in history. Checks the dry-run gate ruled legitimately green are recorded
        // pre_satisfied IN the Law before index hashes it (brownfield GREEN-at-lock — the
        // flip arithmetic excludes them and guards them as regressions instead).
        // Greenfield pre-flight: architecture runs BEFORE build's
        // rakim git-init, so a greenfield projectPath has no repo when this leg fires. The
        // lock sequence OWNS its git baseline. The branch is decided
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
          ? `0. FIRST edit ${lawFile} (file tools): set "pre_satisfied": true on exactly the check entr${greenLegit.length === 1 ? 'y' : 'ies'} ${greenLegit.join(', ')} — ruled legitimately green at the pre-lock dry-run (brownfield). Change NOTHING else in the file.\n`
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

// Await the parallel design:tokens leg before the stage closes — no architecture agent
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
  log('Handoff folded into Plato\'s synthesis (lite path) — no separate handoff pass')
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
// verification from a non-council run). The PROMISED path — FULL or LITE — is 'twin_council'
// even when the runToken was missing (that run carries terminal DEGRADED, reason
// 'runToken absent', never a clean v301 label). Only sub-T4 (including sub-T4 lite) stays 'v301'.
let councilPathReason = null
if (councilPromised) councilPathReason = councilCapable ? null : 'runToken absent'
else councilPathReason = 'sub-T4 tier'

// Stage bracket: stage_completed ONLY when the Law locked — the stage's one genuine-success
// criterion. law_locked:false (unlocked Law, blocked council, missing pluginRoot) is the conductor's
// escalation signal, never a completion: no event.
if (lawLocked) await runLedger('stage_completed', {}, 'The Law')

return {
  master_plan_file: masterPlanFile,
  // On the T4-full path the milestone_count / surfaces / milestone list populate from
  // renderMilestones (the renderer's ordered records — no sort replication); every
  // other path reads plato's synth. renderMilestones records carry final_id (the assigned M-id).
  milestone_count: renderMilestones !== null ? renderMilestones.length : (synth && synth.milestone_count),
  validation: verdict && verdict.verdict,
  failed_dimensions: (verdict && verdict.failed_dimensions) || [],
  has_visual_direction: hasVisualDirection,
  scope: foundation && foundation.scope,
  lite_path: liteScope,
  surfaces: renderMilestones !== null ? renderMilestones.map((m) => ({ id: m.final_id, surface: m.surface })) : (synth && synth.milestones || []).map((m) => ({ id: m.id, surface: m.surface })),
  // The Law: law_locked:false + law_reason is the conductor's escalation signal — the
  // build stage must never start against unlocked gates.
  law_locked: lawLocked,
  law_reason: lawLocked ? null : lawReason,
  law_file: lawFile,
  law_check_count: lawChecks.length,
  missing,
  // Twin Council — ONE additive field. On every v3.0.1 route path:'v301' with an
  // honest reason; on the council path the terminal + certificate + receipts tell the true story.
  council: {
    eligible: councilPromised,
    tier: capabilityTier,
    path: councilPromised ? 'twin_council' : 'v301',
    terminal: councilTerminal,
    certificate: councilCertificate,
    // the RETAINED constructor record: twin_degraded / council_deadlock (with its disagreement
    // cards) — null when RATIFIED (the certificate IS that record) and on every v3.0.1 route.
    terminal_record: councilTerminalRecord,
    // The failed-Claude-head discriminator, extracted from the
    // retained terminal_record for conductor uniformity with the four other council workflows —
    // 'fable' | 'sol' | null (a 'both'/evidence/deadlock DEGRADED is no single head death, folds to null).
    council_missing_head: (councilTerminalRecord && (councilTerminalRecord.missing === 'fable' || councilTerminalRecord.missing === 'sol')) ? councilTerminalRecord.missing : null,
    blocked_reason: councilBlockedReason,
    receipts: councilReceipts,
    checkpoints: councilCheckpointCount,
    reason: councilPathReason,
    // The disclosed intermediate: the sealed front-half decision bundle (settled_decisions array +
    // open_divergences + hash), or null. NON-authoritative — the authority swap consumes it.
    front_half: councilFrontHalf,
  },
}
