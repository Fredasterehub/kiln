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

// ── args: { kilnDir, projectPath, mode, testingRigor, codexAvailable, planning, validationRounds, lawModel, pluginRoot } ──
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
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
// The wrapper TRANSLATES (Goal/Context/Constraints/Done-when); it never forwards a Claude brief verbatim.
const codexHowto = `Delegate authoring to GPT-5.5: TRANSLATE this brief into a 4-part Codex prompt — Goal (the deliverable in 1-2 sentences), Context (the file paths + summary; no full dumps), Constraints (the arch-constraints + "do X instead of Y"), Done-when (the file written + what it must contain) — write it to a fresh temp file ('TMP="$(mktemp /tmp/kiln-codex.XXXXXX.md)"'; a fixed path collides across concurrent runs) and pipe via stdin: 'codex exec -m gpt-5.5 -c model_reasoning_effort="high" --sandbox workspace-write --skip-git-repo-check < "$TMP"'. Do NOT forward this brief verbatim. If GPT-5.5 is unavailable retry with -m gpt-5.4; if codex errors or yields nothing usable, author the plan yourself.`
const SPIN = {
  foundation: ['Numerobis drafts the constraints', 'Laying the first stone', 'The geometry never lies'],
  council: ['The committee of geniuses is arguing', 'Confucius contemplates the path forward', codexAvailable ? 'Sun Tzu is flanking the requirements' : 'Miyamoto makes the fallback the plan'],
  synth: ['Plato weaves the threads together', 'From discord, find harmony', 'One map of truth emerges'],
  validate: ['Athena weighs the plan on her scales', 'A plan is only as good as its weakest assumption', 'Athena checks the receipts'],
  law: ['Asimov drafts the Law', 'One check per criterion — coverage is arithmetic', 'The gates lock before the first brick is laid'],
}
const spin = (k, i) => { const a = SPIN[k] || []; return a.length ? a[((i % a.length) + a.length) % a.length] : '' }

const FOUNDATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    architecture_file: { type: 'string' },
    tech_stack_file: { type: 'string' },
    arch_constraints_file: { type: 'string' },
    has_visual_direction: { type: 'boolean', description: 'true unless the VISION Visual Direction section is the decline string (consulted only when the conductor does not thread visualDirection)' },
    scope: { type: 'string', enum: ['trivial', 'standard', 'complex'], description: 'trivial = ONE cohesive artifact (a single page/script/small CLI) with one obvious approach and no competing architectures worth comparing; standard = a handful of components; complex = many interacting parts or genuine architectural forks' },
    estimated_milestones: { type: 'number', description: 'honest count of genuinely independent, separately-buildable-and-verifiable milestones (a single cohesive artifact is 1)' },
    summary: { type: 'string', description: 'tech summary the planners need: stack, key constraints, decisions' },
  },
  required: ['reasoning', 'architecture_file', 'tech_stack_file', 'arch_constraints_file', 'has_visual_direction', 'scope', 'summary'],
}

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
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
  },
  required: ['slot', 'plan_file', 'approach_summary', 'milestones'],
}

const DIVERGENCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
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
  },
  required: ['analysis_file', 'consensus', 'divergences'],
}

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
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
  },
  required: ['master_plan_file', 'milestone_count', 'milestones'],
}

const VALIDATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    failed_dimensions: { type: 'array', items: { type: 'string' } },
    fixes: { type: 'array', items: { type: 'string' }, description: 'concrete fixes Plato must apply on FAIL' },
  },
  required: ['reasoning', 'verdict', 'failed_dimensions'],
}

const MISSING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' }, description: 'exactly the claimed paths that do not exist on disk' },
  },
  required: ['missing'],
}

// Asimov's compile report — the inventory the in-script coverage arithmetic runs on (§5:
// "coverage is arithmetic, not judgment").
const LAW_COMPILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
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
    reasoning: { type: 'string' },
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
  },
  required: ['exit', 'transcript', 'law_violations'],
}

// Athena's per-check ruling over the EXECUTED transcript — honest-red vs broken-check vs
// legitimately green. The lock proceeds only on a clean verdict.
const DRYRUN_RULING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
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
  },
  required: ['verdict', 'broken', 'green_legitimate'],
}

const LAW_LOCK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    indexed: { type: 'boolean', description: 'step 1 — kiln-law index exited 0' },
    committed: { type: 'boolean', description: 'step 2 — the "test(law): lock acceptance gates" commit was created' },
    error: { type: 'string', description: 'verbatim error output of the first failed step; empty when all succeeded' },
  },
  required: ['indexed', 'committed'],
}

const LAW_VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    law_json_exists: { type: 'boolean' },
    lock_commit_exists: { type: 'boolean' },
  },
  required: ['law_json_exists', 'lock_commit_exists'],
}

// ── Laying Stone: numerobis writes the technical docs the planners build on ──
phase('Laying Stone')
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
  `${researchGrounding} Then report a tight technical summary the planners will build on, ${vdAsk}. Finally, classify the deliverable's scope honestly: 'trivial' = ONE cohesive artifact (a single page, script, or small CLI) with one obvious approach and no competing architectures worth comparing; 'standard' = a handful of independent components; 'complex' = many interacting parts or genuine architectural forks. Give estimated_milestones = the count of genuinely independent, separately-buildable-and-verifiable milestones (a single cohesive artifact is 1). Report reasoning first.\n</task>`,
  { label: 'numerobis:foundation', phase: 'Laying Stone', model: 'opus', schema: FOUNDATION_SCHEMA }
)
// (d) The authoritative visual-direction boolean: the conductor-threaded arg wins; else the
// foundation agent's judgment (the pre-v3 fallback). Everything downstream reads THIS, not the
// raw foundation field, so a threaded arg short-circuits mechanically in the SCRIPT.
const hasVisualDirection = (typeof visualDirection === 'boolean') ? visualDirection : !!(foundation && foundation.has_visual_direction)
log(`Foundation docs written; visual direction: ${hasVisualDirection}${visualDirection === null ? '' : ' (conductor-threaded)'}`)

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
    `${noWander} Report reasoning first.</task>`

  // ── The Council: two anonymized planners in parallel (slot a = Claude, slot b = Codex) ──
  phase('The Council')
  log(`${spin('council', 0)}`)
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
  const plans = (await parallel(planners)).filter(Boolean)
  log(`${plans.length}/2 plans written (${plans.map((p) => p.slot).join(', ')})`)

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
      `winner; surface the real decision points the chairman must resolve. Report reasoning first.</task>`,
      { label: 'diogenes:divergence', phase: 'The Lantern', model: 'sonnet', schema: DIVERGENCE_SCHEMA }
    )
    log(`Divergence: ${(divergence && divergence.divergences || []).length} decision points`)

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
  `Write the file, then report milestone_count and the milestone list (id, title, surface, confidence). Report reasoning first.</task>`,
  { label: 'plato:synthesis', phase: 'One From Many', model: 'opus', schema: SYNTH_SCHEMA }
)
log(`master-plan.md: ${synth && synth.milestone_count} milestone(s) [${(synth && synth.milestones || []).map((m) => m.id + ':' + m.surface).join(', ')}]`)

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
    `else FAIL with the failed dimensions and concrete fixes. Report reasoning first.</task>`,
    { label: `athena:validate:r${round}`, phase: 'Athena Weighs', model: 'opus', schema: VALIDATION_SCHEMA }
  )) || { verdict: 'FAIL', failed_dimensions: ['validator-failure'], fixes: [] }
  verdict = val
  if (val.verdict === 'PASS') { log(`Athena: PASS (pass ${round + 1}/${validationPasses})`); break }
  if (round === validationPasses - 1) { log(`Athena still FAIL after ${validationPasses} pass(es) — escalating`); break }
  log(`Athena FAIL [${(val.failed_dimensions || []).join(', ')}] — Plato revision round ${round + 1}`)
  // Null-keep: a crashed reviser must not wipe the last good synthesis.
  synth = (await agent(
    voice('opus') +
    `You are the plan chairman, revising ${masterPlanFile}.\n\n` +
    `<inputs>\nAthena failed it on: ${(val.failed_dimensions || []).join(', ')}.\nApply these fixes: ${(val.fixes || []).join(' | ')}\n${synthBrief}\n</inputs>\n\n` +
    `<task>Apply the fixes and rewrite the file (keep surfaces + executable acceptance criteria).${handoffFoldClause} Report the updated milestone_count and milestone list. Report reasoning first.</task>`,
    { label: `plato:revise:r${round + 1}`, phase: 'One From Many', model: 'opus', schema: SYNTH_SCHEMA }
  )) || synth
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
    `Report the check inventory (id, milestone, kind) and plan_sc_ids = every SC id you enumerated from the ` +
    `plan. Report reasoning first.\n</task>`,
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
          `the broken list (id, why, concrete fix). Report reasoning first.</task>`,
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
}
