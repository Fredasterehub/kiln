// GENERATED from workflows-src/architecture.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-architecture',
  description: 'Kiln architecture stage: foundation docs, then (for non-trivial scope) two anonymized plans (Claude ∥ Codex), divergence extraction, and chairman synthesis into master-plan.md, validated with a bounded fix loop. Right-sizes to a lite single-plan path for trivial scope. Tags every milestone with a build surface (ui/logic/mixed) so build routes models per slice, and requires acceptance criteria written as EXECUTABLE checks (validate exercises them literally).',
  phases: [
    { title: 'Laying Stone', detail: 'numerobis writes architecture/tech-stack/constraints docs from VISION + research' },
    { title: 'The Council', detail: 'two anonymized planners (Claude slot-a ∥ Codex slot-b) write plan-a.md / plan-b.md' },
    { title: 'The Lantern', detail: 'diogenes extracts consensus / divergences / unique insights' },
    { title: 'One From Many', detail: 'plato writes master-plan.md with confidence tiers + surfaces + executable acceptance criteria' },
    { title: 'Athena Weighs', detail: 'athena validates; plato revises (≤2 rounds) on FAIL' },
  ],
}

// ── args: { kilnDir, projectPath, mode, testingRigor, codexAvailable } ──
function normalizeArgs(args) {
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { return { __parse_error: true } }
  }
  return (args && typeof args === 'object') ? args : {}
}
const A = normalizeArgs(args)
const kilnDir = A.kilnDir
if (!kilnDir) throw new Error('architecture.js requires args.kilnDir (absolute path to .kiln). Received args of type ' + typeof args)
const codexAvailable = A.codexAvailable !== false // default true; conductor passes kiln-doctor's probe result
const testingRigor = A.testingRigor || 'standard'

const docsDir = `${kilnDir}/docs`
const plansDir = `${kilnDir}/plans`
const designDir = `${kilnDir}/design`
const visionFile = `${docsDir}/VISION.md`
const researchFile = `${docsDir}/research.md`
const masterPlanFile = `${kilnDir}/master-plan.md`
const handoffFile = `${kilnDir}/architecture-handoff.md`
const MAX_VALIDATION_ROUNDS = 2

const NO_WANDER = 'Read ONLY the files named in this brief (absolute paths). Do not search the filesystem or read other projects.'
const noWander = NO_WANDER

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')
// The wrapper TRANSLATES (Goal/Context/Constraints/Done-when); it never forwards a Claude brief verbatim.
const codexHowto = `Delegate authoring to GPT-5.5: TRANSLATE this brief into a 4-part Codex prompt — Goal (the deliverable in 1-2 sentences), Context (the file paths + summary; no full dumps), Constraints (the arch-constraints + "do X instead of Y"), Done-when (the file written + what it must contain) — write it to a fresh temp file ('TMP="$(mktemp /tmp/kiln-codex.XXXXXX.md)"'; a fixed path collides across concurrent runs) and pipe via stdin: 'codex exec -m gpt-5.5 -c model_reasoning_effort="high" --sandbox workspace-write --skip-git-repo-check < "$TMP"'. Do NOT forward this brief verbatim. If GPT-5.5 is unavailable retry with -m gpt-5.4; if codex errors or yields nothing usable, author the plan yourself.`
const SPIN = {
  foundation: ['Numerobis drafts the constraints', 'Laying the first stone', 'The geometry never lies'],
  council: ['The committee of geniuses is arguing', 'Confucius contemplates the path forward', 'Sun Tzu is flanking the requirements'],
  synth: ['Plato weaves the threads together', 'From discord, find harmony', 'One map of truth emerges'],
  validate: ['Athena weighs the plan on her scales', 'A plan is only as good as its weakest assumption', 'Athena checks the receipts'],
}
const spin = (k, i) => { const a = SPIN[k] || []; return a.length ? a[((i % a.length) + a.length) % a.length] : '' }

const FOUNDATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    architecture_file: { type: 'string' },
    tech_stack_file: { type: 'string' },
    arch_constraints_file: { type: 'string' },
    has_visual_direction: { type: 'boolean', description: 'true unless VISION section 12 is the decline string' },
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

// ── Laying Stone: numerobis writes the technical docs the planners build on ──
phase('Laying Stone')
log(`${spin('foundation', 0)}`)
const foundation = await agent(
  voice('opus') +
  `You are the technical authority — decide the architecture, do not implement it.\n\n` +
  `<inputs>\n- Vision: ${visionFile}\n- Research: ${researchFile}\n</inputs>\n\n` +
  `<task>\nWrite three docs (Bash 'mkdir -p ${docsDir}' then your file tools):\n` +
  `- ${docsDir}/architecture.md — the chosen high-level architecture and component breakdown.\n` +
  `- ${docsDir}/tech-stack.md — concrete stack decisions, justified by the research findings.\n` +
  `- ${docsDir}/arch-constraints.md — invariants and constraints every plan must honor.\n` +
  `Ground every decision in the research (cite its conclusions). Then report a tight technical summary the planners will build on, and whether VISION section 12 contains real Visual Direction (has_visual_direction=false only if it is exactly the "No visual direction specified..." decline line). Finally, classify the deliverable's scope honestly: 'trivial' = ONE cohesive artifact (a single page, script, or small CLI) with one obvious approach and no competing architectures worth comparing; 'standard' = a handful of independent components; 'complex' = many interacting parts or genuine architectural forks. Give estimated_milestones = the count of genuinely independent, separately-buildable-and-verifiable milestones (a single cohesive artifact is 1). Report reasoning first.\n</task>`,
  { label: 'numerobis:foundation', phase: 'Laying Stone', model: 'opus', schema: FOUNDATION_SCHEMA }
)
log(`Foundation docs written; visual direction: ${foundation && foundation.has_visual_direction}`)

// ── Design tokens (conditional — only when VISION has real Visual Direction) ──
if (foundation && foundation.has_visual_direction) {
  await agent(
    voice('opus') +
    `You are Kiln's design lead.\n\n` +
    `<inputs>\n- Visual Direction (section 12) of ${visionFile}\n- ${docsDir}/tech-stack.md\n</inputs>\n\n` +
    `<task>Write a design system (Bash 'mkdir -p ${designDir}' first):\n` +
    `- ${designDir}/tokens.json — design tokens (color, typography, spacing, motion) as structured JSON.\n` +
    `- ${designDir}/tokens.css — the same tokens as CSS custom properties.\n` +
    `- ${designDir}/creative-direction.md — the aesthetic narrative, references, and an explicit ban list.\n` +
    `Honor the operator's stated visual intent exactly; do not invent a direction they did not give.</task>`,
    { label: 'design:tokens', phase: 'Laying Stone', model: 'opus' }
  )
  log('Design tokens generated (visual direction present)')
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
  `these literally, so "the CLI adds a todo" must become e.g. \`todo add "x" && todo list | grep x\`.`

// Trivial scope takes a LITE path: skip the dual-plan tribunal + divergence; Plato authors directly.
const liteScope = !!(foundation && foundation.scope === 'trivial')
const validationRounds = liteScope ? 1 : MAX_VALIDATION_ROUNDS

let synthBrief
let synthLead
if (liteScope) {
  log(`Scope='trivial' (${foundation && foundation.estimated_milestones} est. milestone(s)) — lite architecture path: skipping The Council.`)
  synthBrief =
    `<inputs>\nRead (${noWander}): ${docsDir}/architecture.md, ${docsDir}/tech-stack.md, ` +
    `${docsDir}/arch-constraints.md, ${researchFile}. Foundation summary: ${foundation && foundation.summary}\n</inputs>`
  synthLead =
    `You are the plan chairman. This is a small, single-approach deliverable — there are no competing ` +
    `plans to reconcile; author the plan directly from the foundation docs and research.`
} else {
  const planBrief =
    `<inputs>\nVision: ${visionFile}. Research: ${researchFile}. Architecture docs: ${docsDir}/architecture.md, ` +
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
      { label: 'sun-tzu:plan', phase: 'The Council', model: 'sonnet', schema: PLAN_SCHEMA }
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
      `${docsDir}/tech-stack.md, ${docsDir}/arch-constraints.md, ${researchFile}. Foundation summary: ${foundation && foundation.summary}\n</inputs>`
    synthLead = survivorFile
      ? `You are the plan chairman. Only one council plan survived — there is nothing to reconcile; author the ` +
        `plan from the surviving plan, the foundation docs, and the research.`
      : `You are the plan chairman. No council plan survived — author the plan directly from the foundation docs and the research.`
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
      `${plansDir}/divergence-analysis.md, ${docsDir}/arch-constraints.md, ${researchFile}.\n</inputs>`
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
  `build treats them carefully. ${rightSizeRule} ${surfaceRule} ${executableAcRule}\n` +
  `Write the file, then report milestone_count and the milestone list (id, title, surface, confidence). Report reasoning first.</task>`,
  { label: 'plato:synthesis', phase: 'One From Many', model: 'opus', schema: SYNTH_SCHEMA }
)
log(`master-plan.md: ${synth && synth.milestone_count} milestone(s) [${(synth && synth.milestones || []).map((m) => m.id + ':' + m.surface).join(', ')}]`)

// ── Athena Weighs: validator with a bounded plato-revision loop ──
phase('Athena Weighs')
log(`${spin('validate', 0)}`)
let verdict = null
// validationRounds counts revisions, not loop iterations: the inclusive `<=` runs up to validationRounds+1 athena passes / validationRounds plato revisions.
for (let round = 0; round <= validationRounds; round++) {
  // Fail CLOSED: a null/crashed validator is a FAIL, never a silent PASS (the v2 fail-open
  // shipped an unvalidated plan under a green "Athena: PASS" log line).
  const val = (await agent(
    voice('opus') +
    `You are the plan validator — your sole job is to find holes, not to propose the solution.\n\n` +
    `<inputs>\n${masterPlanFile} (and ${docsDir}/arch-constraints.md, ${researchFile} for grounding). ${noWander}\n</inputs>\n\n` +
    `<task>Validate the plan on EVERY dimension: completeness vs VISION goals, milestone ordering/dependencies, ` +
    `testability (acceptance criteria PRESENT and written as EXECUTABLE checks — shell/pytest/HTTP/Playwright — not prose; ` +
    `fits "${testingRigor}" rigor), constraint adherence, research-grounding (no decision contradicts research), ` +
    `feasibility, plan purity (no leftover dual-plan/identity cruft), surface tagging (every milestone tagged ` +
    `ui/logic/mixed, cut by the interface seam not the screen), and risk coverage. Return PASS only if ALL hold; ` +
    `else FAIL with the failed dimensions and concrete fixes. Report reasoning first.</task>`,
    { label: `athena:validate:r${round}`, phase: 'Athena Weighs', model: 'opus', schema: VALIDATION_SCHEMA }
  )) || { verdict: 'FAIL', failed_dimensions: ['validator-failure'], fixes: [] }
  verdict = val
  if (val.verdict === 'PASS') { log(`Athena: PASS (round ${round})`); break }
  if (round === validationRounds) { log(`Athena still FAIL after ${round} revision(s) — escalating`); break }
  log(`Athena FAIL [${(val.failed_dimensions || []).join(', ')}] — Plato revision round ${round + 1}`)
  // Null-keep: a crashed reviser must not wipe the last good synthesis.
  synth = (await agent(
    voice('opus') +
    `You are the plan chairman, revising ${masterPlanFile}.\n\n` +
    `<inputs>\nAthena failed it on: ${(val.failed_dimensions || []).join(', ')}.\nApply these fixes: ${(val.fixes || []).join(' | ')}\n${synthBrief}\n</inputs>\n\n` +
    `<task>Apply the fixes and rewrite the file (keep surfaces + executable acceptance criteria). Report the updated milestone_count and milestone list. Report reasoning first.</task>`,
    { label: `plato:revise:r${round + 1}`, phase: 'One From Many', model: 'opus', schema: SYNTH_SCHEMA }
  )) || synth
}

// ── Handoff doc for the build stage ──
await agent(
  `You are the technical authority. ${noWander}\n\n` +
  `<inputs>\n${masterPlanFile}\n</inputs>\n\n` +
  `<task>Write ${handoffFile}: a concise build-stage handoff — the ordered milestone list, the tech stack, the ` +
  `non-negotiable constraints, and any low-confidence areas the build should watch. This is what the build stage reads first.</task>`,
  { label: 'numerobis:handoff', phase: 'Athena Weighs', model: 'sonnet' }
)

// Artifact existence check: v2 returned constructed paths without confirming the writes landed.
// One cheap haiku verifier ls-es the claimed files; misses surface in the log + return value.
const claimed = [`${docsDir}/architecture.md`, `${docsDir}/tech-stack.md`, `${docsDir}/arch-constraints.md`, masterPlanFile, handoffFile]
const existence = await agent(
  `You are the artifact existence verifier.\n\n` +
  `<task>For each path below, run 'ls <path>' (Bash). Return missing = exactly the paths that do not exist (an empty array if all exist). Do not read, write, or fix anything.\n` +
  claimed.map((p) => `- ${p}`).join('\n') + `\n</task>`,
  { label: 'thoth:verify', phase: 'Athena Weighs', model: 'haiku', schema: MISSING_SCHEMA }
)
const missing = (existence && existence.missing) || []
if (missing.length) log(`MISSING claimed artifact(s): ${missing.join(', ')}`)

return {
  master_plan_file: masterPlanFile,
  milestone_count: synth && synth.milestone_count,
  validation: verdict && verdict.verdict,
  failed_dimensions: (verdict && verdict.failed_dimensions) || [],
  has_visual_direction: foundation && foundation.has_visual_direction,
  scope: foundation && foundation.scope,
  lite_path: liteScope,
  surfaces: (synth && synth.milestones || []).map((m) => ({ id: m.id, surface: m.surface })),
  missing,
}
