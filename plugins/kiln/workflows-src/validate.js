export const meta = {
  name: 'kiln-validate',
  description: 'Kiln validate stage — the real L3 backstop. Architecture-drift + seam check, then detect the product type, install the app correctly (venv + editable install for src-layout, never bare pytest), run the FULL suite, and exercise EVERY acceptance criterion by actually running the app (CLI commands, HTTP requests, exports — executable checks, not prose). One single judge over all evidence rules PASS/PARTIAL/FAIL. UI behavioral verification is specified as a precise out-of-loop browser checklist (this workflow never launches a browser); a clean PASS is never emitted for UI behavior from static review alone.',
  phases: [
    { title: 'Measuring Drift', detail: 'zoxea compares the implementation against architectural intent + checks interface seams' },
    { title: 'A Hundred Eyes', detail: 'argus detects the product type, installs, runs the full suite, exercises every acceptance criterion' },
    { title: 'The Critique', detail: 'hephaestus static design review (only when .kiln/design exists; advisory)' },
  ],
}

// ── args: { kilnDir, projectPath, testingRigor, codexAvailable, designPresent } ──
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('validate.js requires args.kilnDir and args.projectPath')
const designPresent = A.designPresent === true

const docsDir = `${kilnDir}/docs`
const valDir = `${kilnDir}/validation`
const masterPlanFile = `${kilnDir}/master-plan.md`
const archCheckFile = `${valDir}/architecture-check.md`
const reportFile = `${valDir}/report.md`
// @inline:guards:NO_WANDER
const scope = `${NO_WANDER} Exception: the built project at ${projectPath} is also in scope.`

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
// @inline:voice:MODEL_VOICE,voice
const SPIN = {
  drift: ['Measuring the drift', 'Zoxea checks the seams', 'Intent versus reality'],
  validate: ['Argus watches with a hundred eyes', 'Testing the real thing, not the dream', 'Argus found an edge case. Of course.', 'End-to-end — no shortcuts allowed'],
}
const spin = (k, i) => { const a = SPIN[k] || []; return a.length ? a[((i % a.length) + a.length) % a.length] : '' }

const ARCHCHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    check_file: { type: 'string' },
    drift: { type: 'array', items: { type: 'string' }, description: 'places the implementation diverges from architectural intent' },
    seam_issues: { type: 'array', items: { type: 'string' }, description: 'interface-boundary / cross-module contract mismatches (the regressions that hide under N commits)' },
    summary: { type: 'string' },
  },
  required: ['reasoning', 'check_file', 'summary'],
}
const VALIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    verdict: { type: 'string', enum: ['VALIDATE_PASS', 'VALIDATE_PARTIAL', 'VALIDATE_FAILED'] },
    report_file: { type: 'string' },
    product_type: { type: 'string', enum: ['cli', 'api', 'web', 'extension', 'electron', 'library', 'mobile'] },
    test_command: { type: 'string', description: 'the exact command that runs the suite (incl. any install step)' },
    tests_passed: { type: 'number' }, tests_failed: { type: 'number' },
    criteria: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string' }, met: { type: 'boolean' }, note: { type: 'string' } },
        required: ['id', 'met'],
      },
    },
    browser_verdict: { type: 'string', enum: ['NOT_APPLICABLE', 'FULL_BROWSER_VALIDATION', 'PARTIAL_PASS_STATIC_ONLY', 'BLOCKED_BROWSER_VALIDATION_MISSING', 'FAIL_BROWSER_EVIDENCE_MISSING'], description: 'for UI/web scopes; this workflow runs no browser, so the best it can self-assign is PARTIAL_PASS_STATIC_ONLY pending the out-of-loop pass' },
    visual_qa_checklist: { type: 'array', items: { type: 'string' }, description: 'the exact out-of-loop browser steps the conductor/operator must run to upgrade a UI scope to a real PASS' },
    correction_tasks: { type: 'array', items: { type: 'string' } },
    coverage_gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['reasoning', 'verdict', 'report_file', 'criteria'],
}

// ── Measuring Drift — architecture-drift + seam/regression check (zoxea) ──
phase('Measuring Drift')
log(`${spin('drift', 0)}`)
const arch = await agent(
  voice('sonnet') + // sonnet leg gets no prose voice header (the shell is Opus-only)
  `You are the architecture-drift verifier. ${scope}\n\n` +
  `<inputs>\n- Architectural intent: ${docsDir}/architecture.md, ${docsDir}/arch-constraints.md\n- What was built: ${docsDir}/codebase-state.md and the actual source under ${projectPath}\n</inputs>\n\n` +
  `<task>Compare what was BUILT against the architectural intent and constraints. Then check the interface SEAMS — where modules meet, do the contracts (signatures, shapes, events, shared state) actually line up, or did a later slice break an earlier one's interface? Write ${archCheckFile} (mkdir -p first): list any drift (constraint violations, structural divergence, missing seams) and any seam/regression issues, or confirm alignment. Be concrete and file-specific. Report reasoning first.</task>`,
  { label: 'zoxea:arch-check', phase: 'Measuring Drift', model: 'sonnet', schema: ARCHCHECK_SCHEMA }
)
log(`Arch-check: ${(arch && arch.drift || []).length} drift, ${(arch && arch.seam_issues || []).length} seam issue(s)`)

// ── A Hundred Eyes — product-typed install + full suite + executable acceptance checks (argus) ──
phase('A Hundred Eyes')
log(`${spin('validate', 0)}`)
const verdict = await agent(
  voice('opus') +
  `You are the end-to-end validator — the real backstop. Determine one thing: does this software actually work as specified? Verdict is VALIDATE_PASS, VALIDATE_PARTIAL, or VALIDATE_FAILED. No "PASS with caveats".\n\n` +
  `<inputs>\n- Architecture check: ${archCheckFile}\n- Master plan (acceptance criteria — SC-xx and per-milestone — live here): ${masterPlanFile}\n- The built application at ${projectPath}\n</inputs>\n\n` +
  `<procedure>\n` +
  `1. DETECT THE PRODUCT TYPE from the project root, then validate per type:\n` +
  `   - cli: run the commands with real inputs; check stdout/stderr and exit codes.\n` +
  `   - api: start it in the background, send real HTTP requests, check status codes + response shapes; then stop it.\n` +
  `   - web: install/build; verify structure statically (routes, rendered HTML, asset wiring) — see the UI rule below.\n` +
  `   - extension: validate manifest.json schema, permission declarations, content-script patterns, storage usage (Grep).\n` +
  `   - electron: verify the build output + main/preload/renderer structure + IPC handlers (Grep).\n` +
  `   - library: verify exports, run type checks, exercise entry points ('node -e "require(\\'.\\')"' or import).\n` +
  `   - mobile: run unit/logic tests, verify build config, check API connectivity.\n` +
  `2. INSTALL CORRECTLY FIRST. If it is a Python package (pyproject.toml/setup.py, likely a src/ layout), create a venv and 'pip install -e .[dev]' (or '.') BEFORE testing — do NOT run a bare 'pytest' from the root (it fails ModuleNotFound on src-layout). Use the build's recorded test_command if one exists. Capture build stdout/stderr/exit code; on build failure, record it and still attempt unit tests.\n` +
  `3. RUN THE FULL SUITE; record tests_passed / tests_failed and the exact test_command.\n` +
  `4. EXERCISE EVERY ACCEPTANCE CRITERION by actually running the app (executable checks, not prose, not just trusting tests). Mark each criterion met/unmet with concrete evidence.\n` +
  `5. Missing credentials/env: write ${valDir}/missing_credentials.md, note it, continue — NEVER FAIL solely for missing creds (downgrade to PARTIAL).\n` +
  `</procedure>\n\n` +
  `<ui_rule>\n` +
  `Autonomous stages NEVER launch a browser or Playwright (they leak processes and once OOM'd the box). So for web/UI behavioral criteria you do NOT run a browser here. Instead:\n` +
  `- Verify everything statically you can (structure, wired handlers in source, asset references, a11y attributes in markup).\n` +
  `- Mark every browser-only criterion UNVERIFIED, set browser_verdict = PARTIAL_PASS_STATIC_ONLY (or BLOCKED_BROWSER_VALIDATION_MISSING / FAIL_BROWSER_EVIDENCE_MISSING if browser evidence is explicitly required and cannot be substituted), and NEVER emit VALIDATE_PASS for UI behavior from static review alone.\n` +
  `- Emit visual_qa_checklist: the EXACT steps for the single out-of-loop browser pass the conductor/operator runs — serve over http (NOT file://), click every wired interaction, traverse states (empty/loading/error/success), capture console errors, run axe-core a11y, screenshot >=2 viewports, and scroll-and-capture each scroll-reveal section (a fullPage headless shot renders IntersectionObserver sections as a blank void — force them visible or scroll first).\n` +
  `For NON-UI products there is no browser gap — run the app fully and judge on real evidence.\n` +
  `</ui_rule>\n\n` +
  `<verdict_rules>\n` +
  `Single verdict over ALL evidence:\n- VALIDATE_PASS only if every acceptance criterion is met with a green suite (and UI criteria have real browser evidence — which this pass cannot produce, so a pure-UI deliverable maxes at PARTIAL here pending the out-of-loop pass).\n- VALIDATE_PARTIAL for: missing creds, non-critical criteria unmet, deployment issues, or a built scope that passes but is incomplete vs the full plan, or UI behavior pending the out-of-loop pass.\n- VALIDATE_FAILED for: a build error, >50% test failures, or any CRITICAL acceptance criterion unmet.\nWrite ${reportFile} (mkdir -p first): product type, build result, test summary, per-criterion results with evidence, browser_verdict + visual_qa_checklist for UI, coverage_gaps, and a prioritized correction_tasks list (one per distinct failure: failure, evidence, affected files, suggested fix). Be honest — a partial build is PARTIAL, not PASS. Report reasoning first.\n` +
  `</verdict_rules>`,
  { label: 'argus:validate', phase: 'A Hundred Eyes', model: 'opus', schema: VALIDATE_SCHEMA }
)
log(`Validate: ${verdict && verdict.verdict} [${verdict && verdict.product_type}] (${verdict && verdict.tests_passed} passed / ${verdict && verdict.tests_failed} failed)${verdict && verdict.browser_verdict && verdict.browser_verdict !== 'NOT_APPLICABLE' ? ' · browser: ' + verdict.browser_verdict : ''}`)

// ── The Critique — static design QA (conditional, advisory) ──
if (designPresent) {
  phase('The Critique')
  await agent(
    `You are the design-QA reviewer. ${scope}\n\n` +
    `<inputs>\n- Design system: ${kilnDir}/design/ artifacts\n- The built UI source under ${projectPath}\n</inputs>\n\n` +
    `<task>Do a 5-axis design review (visual hierarchy, consistency/tokens, spacing/rhythm, typography, polish) by reading the code STATICALLY — do NOT launch a browser or Playwright (autonomous stages never spawn browsers). Note any check that genuinely needs a render as an explicit coverage gap for the single out-of-loop visual pass. Write ${valDir}/design-review.md. Scores are ADVISORY — never the sole cause of a FAIL.</task>`,
    { label: 'hephaestus:design-qa', phase: 'The Critique', model: 'sonnet' }
  )
  log('Design QA complete (advisory)')
}

return {
  verdict: verdict && verdict.verdict,
  report_file: reportFile,
  product_type: verdict && verdict.product_type,
  tests_passed: verdict && verdict.tests_passed,
  tests_failed: verdict && verdict.tests_failed,
  browser_verdict: verdict && verdict.browser_verdict,
  visual_qa_checklist: (verdict && verdict.visual_qa_checklist) || [],
  correction_tasks: (verdict && verdict.correction_tasks) || [],
  drift: (arch && arch.drift) || [],
  seam_issues: (arch && arch.seam_issues) || [],
}
