export const meta = {
  name: 'kiln-build',
  description: 'Kiln build stage — two nested loops. OUTER: each master-plan milestone in dependency order (sequential, cumulative commits). INNER: a just-in-time slice loop — the slicer scopes one vertical slice at a time from the live codebase state, a builder implements it (Opus builds ui/mixed, GPT-5.5/Codex builds logic), and a cross-FAMILY reviewer (always a different model family from the builder) rules on it with ≤3 fix cycles before commit. After the slices integrate, a single-pass milestone tribunal (Ken/Opus ∥ Ryu/Codex → deterministic reconcile → judge) gates the whole — SKIPPED for single-slice milestones, where the slice review is the milestone QA. The heavy end-to-end gate is validate, not per-slice ceremony.',
  phases: [
    { title: 'The Forge Heats', detail: 'rakim ensures the git repo + seeds codebase-state; parse the master plan into milestones' },
    { title: 'Scoring the Cut', detail: 'the slicer scopes the next vertical slice just-in-time, or calls the milestone done' },
    { title: 'Forging', detail: 'builder implements the slice (Opus for ui/mixed, GPT-5.5/Codex for logic) and commits it' },
    { title: 'The Trial', detail: 'a cross-family reviewer re-runs the slice and rules; ≤3 fix cycles' },
    { title: 'Judgment', detail: 'per-milestone tribunal over the integrated whole — skipped when a milestone is a single slice' },
  ],
}

// ── args: { kilnDir, projectPath, codexAvailable, testingRigor, milestoneLimit, uiBuild } ──
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = {} } }
A = A || {}
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('build.js requires args.kilnDir and args.projectPath')
const codexAvailable = A.codexAvailable !== false
const testingRigor = ['tdd', 'standard', 'minimal'].includes(String(A.testingRigor || '').toLowerCase()) ? String(A.testingRigor).toLowerCase() : 'standard'
const milestoneLimit = typeof A.milestoneLimit === 'number' ? A.milestoneLimit : Infinity
// uiBuild forces every milestone onto the ui surface (Opus builds, Codex reviews) — an optional override.
const uiBuild = A.uiBuild === true

// Bounds (the runaway/ceremony guards).
const MAX_SLICES_PER_MILESTONE = 12 // for-cap, not a while-true — bounds a slicer that never says done
const MAX_REVIEW_FIXES = 3          // per-slice cross-family review fix cycles
const MAX_TRIBUNAL_CORRECTION = 1   // single-pass tribunal: one corrective pass, then escalate to validate

const docsDir = `${kilnDir}/docs`
const qaDir = `${kilnDir}/tmp/qa`
const designDir = `${kilnDir}/design`
const masterPlanFile = `${kilnDir}/master-plan.md`
const handoffFile = `${kilnDir}/architecture-handoff.md`
const codebaseStateFile = `${docsDir}/codebase-state.md`
const codebaseMapFile = `${docsDir}/codebase-map.md`

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
// Canonical copy lives in data/duo-pool.json (conductor reads that); this inline copy is the
// workflow's display copy because workflow scripts cannot import JSON. Keep the two in sync.
const DUO_POOL = {
  default: [['codex', 'sphinx'], ['tintin', 'milou'], ['mario', 'luigi'], ['lucky', 'luke']],
  fallback: [['kaneda', 'tetsuo'], ['athos', 'porthos']],
  ui: [['clair', 'obscur'], ['yin', 'yang']],
}
const poolKey = (surf) => (surf === 'ui' || surf === 'mixed') ? 'ui' : (codexAvailable ? 'default' : 'fallback')
const pickDuo = (surf, mi) => { const p = DUO_POOL[poolKey(surf)]; return p[((mi % p.length) + p.length) % p.length] } // deterministic off milestone index
const loreLabel = (name, role, suffix) => `${name}:${role}${(suffix != null && suffix !== '') ? ':' + suffix : ''}`
const SPIN = {
  slice: ['KRS-One scores the next cut', 'Knowledge reigns — one slice at a time', 'KRS-One raises the bar', 'Thinkin\' of a master plan'],
  build: ['Codex is typing — don\'t interrupt', 'Clair paints', 'The forge takes the blow', 'Codex says \'trust me\' — famous last words'],
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
const SLICE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    rationale: { type: 'string' },
    done: { type: 'boolean', description: 'true when the milestone acceptance is fully covered by built slices' },
    slice: {
      type: 'object', additionalProperties: false,
      properties: {
        objective: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'string' },
        done_when: { type: 'string', description: 'a single runnable check that proves this slice' },
      },
      required: ['objective', 'done_when'],
    },
  },
  required: ['done'], // Appendix A: only `done` required (rationale stays first + reason-first via order; slice optional)
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
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    verdict: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
    tests_green: { type: 'boolean', description: 'green as the reviewer re-ran it (not as the builder reported)' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['reasoning', 'verdict', 'tests_green'],
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
  },
  required: ['reasoning', 'findings'],
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

const scope = `Read ONLY the files named in this brief (absolute paths). Do not search the filesystem or read other projects.`
const repoRule = `Project repo: ${projectPath}. Work and commit there directly — this is a sequential cumulative build; do NOT create a detached git worktree (later slices and milestones must see your commits). Maintain a .gitignore for the stack and NEVER commit generated artifacts (Python: __pycache__/, *.pyc, *.egg-info/, build/, dist/, .pytest_cache/) — add them to .gitignore and 'git rm --cached' any that slipped in.`
// The wrapper TRANSLATES (Goal/Context/Constraints/Done-when) — it never forwards this brief verbatim.
const codexHowto = `You are a thin wrapper around GPT-5.5. TRANSLATE this brief into a 4-part Codex prompt and pipe it via stdin — Goal (the outcome in 1-2 sentences, a result not a procedure), Context (file paths + the slice spec; code/data last), Constraints (conventions + "do X instead of Y", each with its reason), Done-when (the exact test command + expected exit 0). Write the prompt to a file then: 'codex exec -m gpt-5.5 -c model_reasoning_effort="high" --sandbox workspace-write --skip-git-repo-check < /tmp/kiln-codex.md'. Do NOT forward this brief verbatim and do NOT put code blocks in Goal. If GPT-5.5 is unavailable, retry the same prompt with -m gpt-5.4; if codex still errors or exits 0 with no usable artifact, do the work directly.`

// ── Prompt builders (functional role+stance only; persona names live in labels, never here) ──
function slicerPrompt(m, surf, builtSlices) {
  const built = builtSlices.length
    ? builtSlices.map((s, i) => `  ${i + 1}. ${s.objective}${s.done_when ? ' — done-when: ' + s.done_when : ''}`).join('\n')
    : '  (none yet — this is the first slice)'
  return voice('opus') +
    `You are the slice planner. Scope the NEXT single vertical slice of this milestone — ONE distinct user-facing behavior that can be invoked and verified on its own by a single runnable check (a CLI subcommand, an API call, a rendered-and-exercised page, one pure function) — or declare the milestone objective fully covered.\n\n` +
    `<inputs>\n` +
    `- Milestone ${m.id} "${m.title}" [surface=${surf}] — acceptance: ${m.acceptance}\n` +
    `- Summary: ${m.summary || '(none)'}\n` +
    `- Already-built slices this milestone:\n${built}\n` +
    `- Read ${codebaseStateFile} and ${masterPlanFile} for what currently exists and what the milestone owes.\n` +
    `</inputs>\n\n` +
    `<constraints>\n` +
    `- ${scope}\n` +
    `- A slice = ONE distinct, independently-runnable user-facing behavior. Decompose the milestone by such behaviors and emit one slice each, in dependency order: a multi-command CLI gives a slice per command (add / list / done / rm), a CRUD resource a slice per operation. Each slice's done_when must be a runnable check that no built slice already covers. The milestone-count "right-size / don't-split-a-cohesive-artifact" rule is about how many MILESTONES exist, NOT how many slices a milestone holds — do not let it collapse you to one slice.\n` +
    `- Do NOT manufacture slices. If a candidate part has no runnable check distinct from another's, FOLD it. A single render artifact (one page — its hero, countdown, and rows share the one render check), one endpoint, or one pure function is ONE slice; a region that only renders within a page (including live/animated ones like a countdown) is never its own slice because in-loop verification here is the single check that exercises that behavior. Scaffolding, packaging, config, and shared storage are NEVER their own slice — they ride inside the FIRST behavior slice that needs them (e.g. the JSON store folds into add). Scope this ONE slice with a zero-ambiguity done_when; do not duplicate a built slice.\n` +
    `- If the milestone acceptance is already fully met by the built slices, set done=true and omit slice.\n` +
    `</constraints>\n\n` +
    `<task>Return rationale (why this slice next, or why done), done (true/false), and — only when done=false — slice {objective, files[], constraints, done_when}.</task>`
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
      `- ${scope} ${repoRule}\n` +
      `- Keep the solution minimal; add no abstraction the slice does not require.\n` +
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
    `- Done when: ${slice.done_when || 'the acceptance tests pass'}\n` +
    `- Master plan: ${masterPlanFile}. Codebase state: ${codebaseStateFile}.\n` +
    `</inputs>\n\n` +
    `<constraints>\n` +
    `- ${scope} ${repoRule}\n` +
    `- ${tdd}\n` +
    `- Keep the implementation minimal; add no abstraction the slice does not require; no stubs or mocks standing in for required behavior.\n` +
    (codexAvailable ? `- ${codexHowto}\n` : `- Codex is unavailable — implement directly with your file tools.\n`) +
    `</constraints>${fix}\n` +
    `<task>Implement the slice to green tests, then 'git add -A && git commit' with a clear message. Report reasoning, files_changed, tests_added, red_confirmed, tests_green (must be true), committed, the test_command you used, and the trimmed passing test output as evidence.</task>`
}

function reviewPrompt(m, surf, slice, sliceId, build) {
  const testCmd = (build && build.test_command) || 'the project tests'
  if (surf === 'ui' || surf === 'mixed') {
    return `You are the cross-model UI reviewer on slice ${sliceId} — a DIFFERENT model family from the Opus builder. Judge code and the static check ONLY; do not rule on aesthetic taste (that is judged separately from a live render, outside this loop). Read-only on source.\n\n` +
      `<inputs>\n` +
      `- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
      `- Slice objective: ${slice.objective}\n` +
      `- Inspect the committed work: 'git -C ${projectPath} show HEAD' / 'git -C ${projectPath} diff', and read the changed files.\n` +
      `- Design system + ban list: ${designDir}/creative-direction.md. Content source of truth: ${codebaseMapFile}.\n` +
      `</inputs>\n\n` +
      `<checks>\nApply EVERY check to EVERY interactive element/section, not just the first:\n` +
      `1. structural / responsive breakage; 2. dead or missing event handlers + JS correctness; 3. accessibility — AA contrast (compute it), prefers-reduced-motion honored, semantics; 4. ban-list adherence + design-token consistency; 5. content accuracy vs the map (no invented features/metrics/images).\n` +
      (surf === 'mixed' ? `Also RE-RUN the slice's behavior/smoke test for the non-visual logic and confirm it passes.\n` : ``) +
      `Re-run the STATIC check yourself (HTML parses, sections/ids present, 'node --check' the JS). Do NOT open a browser or Playwright.\n` +
      `</checks>\n\n` +
      (codexAvailable ? `<how>Delegate this review to GPT-5.5 via 'codex exec' — you are the thin wrapper and the cross-model check; if codex errors, review directly as the independent reviewer.</how>\n\n` : ``) +
      `<task>Set tests_green to whether the static check (and any mixed smoke test) passes. Verdict APPROVED only if the page is structurally sound, accessible, on-brief, and free of invented claims; else REJECTED with specific, actionable [file:line] issues. Report reasoning first.</task>`
  }
  return voice('opus') +
    `You are the cross-model code reviewer (Opus) on a GPT/Codex-built slice (${sliceId}). Separate what the builder REPORTED from what you INDEPENDENTLY re-ran. Read-only on source.\n\n` +
    `<inputs>\n` +
    `- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
    `- Slice objective: ${slice.objective}. Done when: ${slice.done_when || '(acceptance tests pass)'}\n` +
    `- Inspect the committed work: 'git -C ${projectPath} show HEAD' / 'git -C ${projectPath} diff', read the changed files.\n` +
    `</inputs>\n\n` +
    `<checks>\n` +
    `- RE-RUN the suite yourself (${testCmd}) and confirm it passes — do not trust the reported result.\n` +
    `- Verify the implementation is real: no stubs or mocks standing in for required behavior; the slice meets its objective and the milestone acceptance.\n` +
    `- Reject only on correctness / completeness / test failures — not on style preference.\n` +
    `</checks>\n\n` +
    `<task>Verdict APPROVED only if tests are green from YOUR run AND the implementation is real AND on-spec; else REJECTED with specific [file:line] issues. Set tests_green from your own run. Report reasoning first.</task>`
}

function kenPrompt(m) {
  return voice('opus') +
    `You are QA analyst A. Adversarially verify the INTEGRATED milestone — run the tests, confirm each acceptance criterion is genuinely met (not faked), and hunt integration gaps and edge cases across the slices.\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n- Inspect the repo at ${projectPath}: git log/diff, read the files, RUN the tests yourself.\n</inputs>\n\n` +
    `<task>Write findings to ${qaDir}/qa-report-a.md (mkdir -p first) and return report_file + findings[] (each {text, severity}). Quote specific evidence ([file:line] or test output). Apply scrutiny to EVERY acceptance criterion, not just the first. Report reasoning first.</task>`
}
function ryuPrompt(m) {
  return (codexAvailable
    ? `You are QA analyst B, delegating analysis to GPT-5.5 via 'codex exec' for a genuinely cross-model second perspective — run codex at model_reasoning_effort="xhigh"; if it errors, analyze directly.\n`
    : `You are QA analyst B — an independent second perspective.\n`) +
    `Run the tests yourself and probe DIFFERENT failure modes than a first pass would.\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n- Inspect the repo at ${projectPath}: git log/diff, read files, RUN the tests.\n</inputs>\n\n` +
    `<task>Write findings to ${qaDir}/qa-report-b.md (mkdir -p first) and return report_file + findings[] (each {text, severity}). Do NOT read analyst A's report — stay independent. Report reasoning first.</task>`
}
function judgePrompt(m, reconciled) {
  return voice('opus') +
    `You are the QA judge — final arbiter for this milestone. Binary verdict, no "PASS with caveats".\n\n` +
    `<inputs>\n- Milestone ${m.id} "${m.title}" — acceptance: ${m.acceptance}\n` +
    `- Reconciled findings (deduped, severity-ranked):\n${reconciled.summaryLines.map((l) => '  - ' + l).join('\n') || '  (none)'}\n` +
    `- The repo at ${projectPath}.\n</inputs>\n\n` +
    `<task>RUN the tests yourself at ${projectPath}. Issue QA_PASS only if the milestone genuinely meets its acceptance with green tests and no critical/high findings; else QA_FAIL with the blocking findings. Report reasoning first, then verdict, findings, severity.</task>`
}

// ── The Forge Heats — git baseline + seed codebase-state + parse milestones ──
phase('The Forge Heats')
log('The kiln grows hotter')
await agent(
  `You are the codebase-state authority. ${scope} ${repoRule}\n\n` +
  `<task>\n1. If ${projectPath} is not a git repo (no .git), initialize it: set a local user.name/email if unset, then 'git -C ${projectPath} init -q && git -C ${projectPath} add -A && git -C ${projectPath} commit -q -m "chore: kiln build baseline"'.\n` +
  `2. Read ${masterPlanFile} and ${handoffFile}, then write ${codebaseStateFile} (mkdir -p ${docsDir} first): a short TL;DR of the intended architecture and the current (likely empty) state, for the slicer and builders to read each milestone.\n</task>`,
  { label: loreLabel('rakim', 'setup'), phase: 'The Forge Heats', model: 'sonnet' }
)
const planRes = await agent(
  `You are the build planner. ${scope}\n\n<inputs>\nRead ${masterPlanFile}.\n</inputs>\n\n` +
  `<task>Return the milestones in build order — id, title, summary, acceptance, surface (copy the plan's ui|logic|mixed tag; if absent, infer: a visible/front-facing deliverable is 'ui', a non-visual backend/CLI/logic deliverable is 'logic'), and confidence. Extract exactly what the plan defines — do not invent milestones. Report reasoning first.</task>`,
  { label: loreLabel('confucius', 'parse'), phase: 'The Forge Heats', model: 'sonnet', schema: MILESTONES_SCHEMA }
)
let milestones = (planRes && planRes.milestones) || []
if (Number.isFinite(milestoneLimit)) milestones = milestones.slice(0, milestoneLimit)
log(`Building ${milestones.length} milestone(s): ${milestones.map((m) => `${m.id}[${surfaceOf(m)}]`).join(', ')}`)

// ── OUTER milestone loop (sequential — each depends on the previous one's commits) ──
const results = []
let milestoneIndex = -1
for (const m of milestones) {
  milestoneIndex++
  if (typeof budget !== 'undefined' && budget && budget.total && budget.remaining() <= 0) {
    log(`Budget exhausted — stopping before ${m.id} (per-slice commits are a coherent partial; validate backstops).`)
    break
  }
  const surf = surfaceOf(m)
  const { buildModel: bModel, reviewModel: rModel } = routing(surf)
  const [builderName, reviewerName] = pickDuo(surf, milestoneIndex)
  log(`━━ Milestone ${m.id}: ${m.title} [surface=${surf}] — \`${builderName}\` builds, \`${reviewerName}\` reviews ━━`)

  // ── INNER JIT-slice loop ──
  const slices = []
  let mBuild = null
  let mReview = null
  let cappedOut = true
  for (let si = 0; si < MAX_SLICES_PER_MILESTONE; si++) {
    phase('Scoring the Cut')
    log(`${spin('slice', si)} — ${m.id} slice ${si + 1}`)
    const plan = await agent(slicerPrompt(m, surf, slices), { label: loreLabel('krs-one', 'slice', `${m.id}:s${si}`), phase: 'Scoring the Cut', model: 'opus', schema: SLICE_SCHEMA })
    // Guards: check done BEFORE touching slice; not-done-with-null and done-with-stray-slice both exit cleanly.
    if (!plan || plan.done === true || !(plan.slice && plan.slice.objective)) { cappedOut = false; break }
    const slice = plan.slice
    const sliceId = `${m.id}:s${si}`

    // Phase-6 speed fix: pre-process heavy assets ONCE on the first slice of a ui/mixed milestone.
    if ((surf === 'ui' || surf === 'mixed') && si === 0) {
      phase('Forging')
      await agent(assetPrepPrompt(m), { label: loreLabel(builderName, 'prep', m.id), phase: 'Forging', model: 'sonnet' })
    }

    phase('Forging')
    log(`${spin('build', si)} — ${m.id} ${sliceId}`)
    mBuild = await agent(buildPrompt(m, surf, slice, sliceId), { label: loreLabel(builderName, 'build', sliceId), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })

    // Cross-family review with a bounded fix loop (reviewer re-runs tests on HEAD).
    for (let fix = 0; fix <= MAX_REVIEW_FIXES; fix++) {
      if (mBuild && mBuild.committed === false) {
        // Commit-before-review (Appendix A): an uncommitted slice would make the reviewer judge a stale HEAD.
        // Auto-reject without spending a review call; the fix build below re-commits.
        mReview = { verdict: 'REJECTED', tests_green: false, issues: ['Slice was not committed — run \'git add -A && git commit\' before review (the reviewer inspects HEAD).'] }
        log(`${m.id} ${sliceId}: builder did not commit — auto-reject, fix ${fix + 1}`)
      } else {
        phase('The Trial')
        log(`${spin('review', fix)} — ${m.id} ${sliceId} f${fix}`)
        mReview = await agent(reviewPrompt(m, surf, slice, sliceId, mBuild), { label: loreLabel(reviewerName, 'review', `${sliceId}:f${fix}`), phase: 'The Trial', model: rModel, schema: REVIEW_SCHEMA })
      }
      if (mReview && mReview.verdict === 'APPROVED' && mReview.tests_green !== false) break
      if (fix === MAX_REVIEW_FIXES) { log(`${m.id} ${sliceId}: still REJECTED after ${fix} fix(es) — recording and moving on (validate backstops)`); break }
      log(`${m.id} ${sliceId} REJECTED [${(mReview && mReview.issues || []).join('; ')}] — fix ${fix + 1}`)
      phase('Forging')
      mBuild = await agent(buildPrompt(m, surf, slice, sliceId, `Reviewer REJECTED the prior attempt: ${(mReview && mReview.issues || []).join(' | ')}. Fix these specifically.`), { label: loreLabel(builderName, 'build', `${sliceId}:fix${fix + 1}`), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })
    }
    slices.push({ id: sliceId, objective: slice.objective, files: slice.files || [], constraints: slice.constraints || '', done_when: slice.done_when || '', tests_green: mBuild && mBuild.tests_green, review: mReview && mReview.verdict })
  }
  if (cappedOut) log(`${m.id}: hit the ${MAX_SLICES_PER_MILESTONE}-slice cap — building stopped; validate.js backstops the remainder.`)

  // ── Judgment — per-milestone tribunal, SKIPPED for single-slice milestones ──
  phase('Judgment')
  let qa = 'QA_PASS'
  let qaFindings = []
  if (slices.length > 1) {
    for (let c = 0; c <= MAX_TRIBUNAL_CORRECTION; c++) {
      const reports = await parallel([
        () => agent(kenPrompt(m), { label: loreLabel('ken', 'qa', `${m.id}:c${c}`), phase: 'Judgment', model: 'opus', schema: QA_FINDINGS_SCHEMA }),
        () => agent(ryuPrompt(m), { label: loreLabel('ryu', 'qa', `${m.id}:c${c}`), phase: 'Judgment', model: 'sonnet', schema: QA_FINDINGS_SCHEMA }),
      ])
      const reconciled = denzelReconcile(reports[0], reports[1])
      qaFindings = reconciled.summaryLines
      log(`${spin('qa', c)} — ${m.id}: ${reconciled.findings.length} finding(s), ${reconciled.blocking.length} blocking`)
      const verdict = await agent(judgePrompt(m, reconciled), { label: loreLabel('judge-dredd', 'verdict', `${m.id}:c${c}`), phase: 'Judgment', model: 'opus', schema: VERDICT_SCHEMA })
      let v = (verdict && verdict.verdict) || 'QA_FAIL'
      if (reconciled.hasBlocking) v = 'QA_FAIL' // deterministic blocking gate overrides a soft PASS
      if (v === 'QA_PASS') { qa = 'QA_PASS'; log(`${m.id}: QA_PASS (tribunal, cycle ${c})`); break }
      if (c === MAX_TRIBUNAL_CORRECTION) { qa = 'QA_FAIL'; log(`${m.id}: QA_FAIL after ${c} correction(s) — escalating to validate`); break }
      // One corrective build + cross-family review, then re-judge once.
      const fixNote = `Milestone tribunal QA_FAIL. Fix every blocking finding, keep tests green, recommit:\n${reconciled.summaryLines.join('\n')}`
      const lastSlice = slices[slices.length - 1] || { objective: m.title, files: [], done_when: m.acceptance }
      phase('Forging')
      log(`${spin('build', 99)} — ${m.id} tribunal correction ${c + 1}`)
      mBuild = await agent(buildPrompt(m, surf, lastSlice, `${m.id}:correct${c + 1}`, fixNote), { label: loreLabel(builderName, 'build', `${m.id}:correct${c + 1}`), phase: 'Forging', model: bModel, schema: BUILD_SCHEMA })
      phase('The Trial')
      mReview = await agent(reviewPrompt(m, surf, lastSlice, `${m.id}:correct${c + 1}`, mBuild), { label: loreLabel(reviewerName, 'review', `${m.id}:correct${c + 1}`), phase: 'The Trial', model: rModel, schema: REVIEW_SCHEMA }) || mReview
      phase('Judgment')
    }
  } else if (slices.length === 1) {
    qa = (mReview && mReview.verdict === 'APPROVED' && mReview.tests_green !== false) ? 'QA_PASS' : 'QA_FAIL'
    log(`${m.id}: single slice — the cross-family review IS the milestone QA (${qa})`)
  } else {
    qa = 'QA_PASS'
    log(`${m.id}: no slices produced — no-op QA_PASS`)
  }

  // Update living docs so the next milestone's slicer/builder has current context.
  phase('The Forge Heats')
  await agent(
    `You are the codebase-state authority. ${scope} ${repoRule}\n\n` +
    `<task>Milestone ${m.id} ("${m.title}") was just built. Update ${codebaseStateFile}: what now exists (modules, public surface) so the next milestone's slicer and builder have accurate context. Read 'git -C ${projectPath} log --oneline -8' and 'git -C ${projectPath} show --stat HEAD' for what changed.</task>`,
    { label: loreLabel('rakim', 'state', m.id), phase: 'The Forge Heats', model: 'sonnet' }
  )

  results.push({
    id: m.id, title: m.title, surface: surf,
    slices: slices.length,
    tests_green: slices.length === 0 ? true : slices.every((s) => s.tests_green !== false),
    qa, findings: qaFindings,
  })
}

const passed = results.filter((r) => r.qa === 'QA_PASS' && r.tests_green)
log(`The orchestra takes a bow — ${passed.length}/${results.length} milestone(s) passed QA`)
return { built: results, passed: passed.map((r) => r.id), all_passed: passed.length === results.length && results.length > 0 }
