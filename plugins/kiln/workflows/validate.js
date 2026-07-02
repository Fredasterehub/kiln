// GENERATED from workflows-src/validate.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-validate',
  description: 'Kiln validate stage — the real L3 backstop (BLUEPRINT §3.2/§5/§7). A parallel fan-out: zoxea checks architecture drift + interface seams ∥ argus runs the DETERMINISTIC Law floor (fresh install per product type, then kiln-law verify = tamper gate, kiln-law run FULL over every SC incl. probes, kiln-law suite) and exercises each acceptance criterion by actually running the app ∥ hephaestus static design QA (self-detected from disk; advisory). For a UI scope, a Tier-2 BOUNDED browser traversal runs (the ban is repealed): ONE fresh cross-family evaluator walks every UI acceptance criterion against the served app via the scripted one-shot kiln-probe ONLY — each criterion is one launch→assert→close process, hard-killed at 90s, runId-tokened under the stage VALIDATE_RUN_TOKEN so the pre/post sweeps reap it, and LEASE-GATED so the ≤10-min cap is enforced on the CAPABILITY: the workflow takes a kiln-probe browser lease before spawning the evaluator and every probe refuses (exit 77) once the lease expires, so an evaluator alive past the deadline can do no further browser work (a workflow cannot cancel a spawned agent — the deadline lives on the tool, not the prose). A detached self-terminating watchdog sweeps the token + deletes the lease at expiry; the stage finally releases the lease (kill watchdog + immediate sweep). Playwright MCP is NOT driven by autonomous validate — an MCP server is a persistent browser service, which §7 forbids in-loop; it remains a doctor-detected capability for the operator\'s INTERACTIVE/manual visual QA only (named in the emitted visual_qa_checklist). Absence of the scripted oracle degrades honestly to PARTIAL_PASS_STATIC_ONLY (verification_class recorded end-to-end), never silently green. A goal-backward final audit works backward from the VISION success criteria over the WHOLE deliverable. The verdict is computed DETERMINISTICALLY FIRST (validateVerdict, a pure fn) over the evidence files — PASS requires the Law run + suite at exit 0 AND no blocking findings AND, for a UI scope, a clean Tier-2 traversal (a UI scope with only honestly-degraded static-only evidence is PARTIAL_PASS_STATIC_ONLY per §3.2, never PASS) — never a prose self-grade. The browser is a subprocess with a deadline, never a service; the D8=2 posture adds an adversarial probe pass + a second validator family.',
  phases: [
    { title: 'Measuring Drift', detail: 'zoxea ∥ argus ∥ hephaestus fan out — drift + seams, the deterministic Law floor, static design QA' },
    { title: 'The Traversal', detail: 'one fresh cross-family evaluator walks every UI criterion against the served app — bounded scripted kiln-probe under a lease-enforced 10-min cap, swept' },
    { title: 'Goal Backward', detail: 'the whole deliverable judged backward from the VISION success criteria' },
    { title: 'The Verdict', detail: 'PASS/PARTIAL/FAILED computed deterministically over the evidence' },
  ],
}

// ── args: { kilnDir, projectPath, testingRigor, codexAvailable, designPresent, posture, pluginRoot, runToken } ──
function normalizeArgs(args) {
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { return { __parse_error: true } }
  }
  return (args && typeof args === 'object') ? args : {}
}
const A = normalizeArgs(args)
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('validate.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
const codexAvailable = A.codexAvailable !== false
// designPresent is a conductor HINT; the workflow self-detects design/ from disk (§4 self-validation
// — solve, don't punt) so a wrong/absent hint never silently skips or runs the design-QA leg.
const designHint = A.designPresent === true
// NO Playwright MCP in autonomous validate (ORCHESTRATOR RULING, p3/tasks.md): an MCP server is a
// PERSISTENT browser service the workflow cannot bound or reap by token — §7 forbids it in-loop. The
// Tier-2 traversal drives the scripted, lease-gated, one-shot kiln-probe ONLY. MCP stays a
// doctor-detected capability for the operator's INTERACTIVE/manual visual QA (named in the emitted
// visual_qa_checklist), never driven by this workflow.
// pluginRoot is the conductor-resolved absolute $PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). LOAD-BEARING here: the kiln-law CLI (the §3.4 Law floor + the deterministic
// run/suite evidence) and kiln-probe (the Tier-2 scripted path + the token sweeps) and the kiln-state
// ledger all live under it. Its absence degrades the deterministic floor to the v2 static path —
// honestly, with verification_class recorded — never a silent skip.
const pluginRoot = A.pluginRoot

// ── VALIDATE_RUN_TOKEN (BLUEPRINT §7 / discipline-spec lifecycle step 3) — this validate stage's
//    own browser kill token. The Tier-2 traversal is the one place validate spawns browsers; every
//    scripted kiln-probe it fires runs under a runId prefixed with this token, so the pre/post
//    sweeps reap exactly this stage's survivors and nothing else (never a concurrent Kiln run's, let
//    alone the operator's own browser — blanket pkill -f chrome stays forbidden). Inert charset
//    (it becomes a pkill -f / readdir pattern). ──
//    Date.now()/Math.random are FORBIDDEN in workflow scripts (runtime determinism guard) — token
//    from args.runToken (conductor-minted) with a deterministic projectPath-hash fallback; see the
//    build.js token note for the uniqueness argument. ──
const valTokenHash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36) }
const VALIDATE_RUN_TOKEN = `kval-${String(A.runToken || valTokenHash(String(projectPath))).replace(/[^A-Za-z0-9._-]/g, '-')}`

// ── The Tier-2 traversal deadline (BLUEPRINT §7 / discipline-spec "≤10 min/Tier-2 session") — a
//    CAPABILITY-ENFORCED hard cap (ORCHESTRATOR RULING). A workflow cannot CANCEL a spawned agent, so
//    the cap lives on the TOOL: before the traversal the workflow takes a kiln-probe browser lease for
//    TRAVERSAL_DEADLINE_MS/1000 seconds keyed by VALIDATE_RUN_TOKEN, and every scripted probe the
//    evaluator fires refuses (exit 77 LEASE_EXPIRED) once that lease expires — an evaluator alive past
//    the deadline is harmless because it can do no further browser work, and a detached watchdog sweeps
//    its survivors at expiry. The withDeadline() timer below is the BELT to that suspenders: it stops
//    the workflow AWAITING a wedged evaluator (a stuck codex subprocess) so the stage resolves and folds
//    static-only, rather than blocking on it forever. The lease is the hard browser bound; withDeadline
//    is the await bound. The budget is shared across passes (adversarial = a 2nd pass must fit the same
//    session cap — and the SAME lease, so a 2nd pass past the cap is refused too).
//    KILN_VALIDATE_TRAVERSAL_MS is a harness escape hatch ONLY — never set it in a run. The Workflow
//    runtime exposes NO `process` global (DOGFOOD FINDING 7: a bare read crashed the stage at module
//    scope; probed surface 2026-06-12 — setTimeout/clearTimeout exist, process/Buffer/fetch do not),
//    so the escape hatch is typeof-guarded: harness plain-node reads it, the runtime falls through. ──
const TRAVERSAL_DEADLINE_MS = (() => {
  const v = (typeof process !== 'undefined' && process.env) ? Number(process.env.KILN_VALIDATE_TRAVERSAL_MS) : NaN
  return Number.isInteger(v) && v >= 1 ? v : 10 * 60 * 1000 // §7 hard bound: 10 min / Tier-2 session
})()
// withDeadline(thunk, ms): resolves to the thunk's value, or the sentinel { __kiln_timeout: true } if
// ms elapses first. Never rejects (a traversal timeout is a degradation, not a stage error); the timer
// is unref'd so a resolved race never keeps the event loop alive. The losing agent's work is discarded
// — the workflow does not trust an over-deadline result, and the stage sweep is its teardown.
const TRAVERSAL_TIMEOUT = { __kiln_timeout: true }
function withDeadline(thunk, ms) {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    const timer = setTimeout(() => done(TRAVERSAL_TIMEOUT), Math.max(1, ms))
    if (typeof timer.unref === 'function') timer.unref()
    Promise.resolve().then(thunk).then((v) => { clearTimeout(timer); done(v) }, () => { clearTimeout(timer); done(null) })
  })
}

// ── The Gauge posture (BLUEPRINT §3.2 validate row) — passed by the conductor from state.json.
//    Accepts an object or a JSON string; anything else ⇒ null ⇒ every dial falls back to its v2
//    default, so a run without a posture behaves exactly like v2 plus the deterministic Law floor
//    (unconditional when pluginRoot is present). The validate dials (D8=2 extras): ──
//      validate.adversarial_pass — run a second adversarial probe/criterion pass (extra scrutiny).
//      validate.second_family    — spawn a second cross-family validator over the same evidence.
const postureArg = (() => {
  let p = A.posture
  if (typeof p === 'string') { try { p = JSON.parse(p) } catch (e) { return null } }
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null
})()
const PV = (postureArg && postureArg.validate && typeof postureArg.validate === 'object') ? postureArg.validate : {}
const posture = {
  adversarial_pass: PV.adversarial_pass === true,
  second_family: PV.second_family === true,
}

const docsDir = `${kilnDir}/docs`
const valDir = `${kilnDir}/validation`
const qaDir = `${kilnDir}/tmp/qa`
const masterPlanFile = `${kilnDir}/master-plan.md`
const visionFile = `${docsDir}/VISION.md`
const lawFile = `${kilnDir}/law.json`
const archCheckFile = `${valDir}/architecture-check.md`
const reportFile = `${valDir}/report.md`
const NO_WANDER = 'Read ONLY the files named in this brief (absolute paths). Do not search the filesystem or read other projects.'
const scope = `${NO_WANDER} Exception: the built project at ${projectPath} is also in scope.`

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')
const SPIN = {
  drift: ['Measuring the drift', 'Zoxea checks the seams', 'Intent versus reality'],
  validate: ['Argus watches with a hundred eyes', 'The Law runs fresh — confirmation, not discovery', 'Argus found an edge case. Of course.', 'Install, suite, every criterion — no shortcuts'],
  traverse: ['One evaluator, one browser, one deadline', 'The browser is a subprocess, never a service', 'Clicking through like a user would', 'The traversal sweeps its own ashes'],
  goal: ['Working backward from the promise', 'Does the whole thing deliver the goal?', 'The letter passes; does the spirit?'],
  verdict: ['The evidence rules — exit codes do not negotiate', 'One verdict over all the evidence', 'PASS, PARTIAL, or FAILED — no caveats'],
}
const spin = (k, i) => { const a = SPIN[k] || []; return a.length ? a[((i % a.length) + a.length) % a.length] : '' }

// The wrapper TRANSLATES a brief into a Codex-native prompt — never forwards it verbatim. The full
// discipline lives in references/codex-prompt-guide.md — point at it, don't duplicate it.
const codexGuide = pluginRoot ? `${pluginRoot}/references/codex-prompt-guide.md` : null
const codexGuideNote = codexGuide
  ? `Read ${codexGuide} first and follow it for the full codex-prompt discipline (per-role flags — run codex at the model_reasoning_effort this prompt specifies — the --output-schema/reasoning-first/flat-schema rules, the heredoc-to-stdin invocation, and the exit-0 and #15451 caveats). `
  : ``

// ── Schemas (additionalProperties:false; reasoning FIRST = reason-before-emit) ──
const ARCHCHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    check_file: { type: 'string' },
    drift: { type: 'array', items: { type: 'string' }, description: 'places the implementation diverges from architectural intent' },
    seam_issues: { type: 'array', items: { type: 'string' }, description: 'interface-boundary / cross-module contract mismatches (the regressions that hide under N commits)' },
    blocking: { type: 'array', items: { type: 'string' }, description: 'the drift/seam findings severe enough to block a PASS (a broken seam, a violated load-bearing constraint) — these gate the verdict' },
    summary: { type: 'string' },
  },
  required: ['reasoning', 'check_file', 'summary'],
}
// The §5/§3.2 deterministic-first evidence schema: argus ORCHESTRATES the install + the three
// kiln-law commands and the per-criterion exercise, and TRANSCRIBES what they printed. The verdict
// is computed from these fields (validateVerdict) — the agent does not self-grade PASS/PARTIAL/FAILED.
const VALIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    report_file: { type: 'string' },
    product_type: { type: 'string', enum: ['cli', 'api', 'web', 'extension', 'electron', 'library', 'mobile'] },
    install_ok: { type: 'boolean', description: 'the app installed/built cleanly (false ⇒ a build error — the verdict FAILS)' },
    law_run_exit: { type: 'number', description: 'the EXACT exit code of `kiln-law run` FULL (all SCs incl. probes) — the §5.1 Law floor; non-zero = the Law is red (-1 if you could not run it)' },
    suite_cmd: { type: 'string', description: 'the exact command kiln-law suite ran (incl. any install step)' },
    suite_exit: { type: 'number', description: 'the EXACT exit code of the project suite via `kiln-law suite` (-1 if not run)' },
    tests_passed: { type: 'number' }, tests_failed: { type: 'number' },
    run_id: { type: 'string', description: 'the kiln-law run id whose evidence dir holds results.jsonl + the probe artifacts' },
    verification_class_full: { type: 'boolean', description: 'the kiln-law run finalized verification_class:"full" (true) vs "static-only" (false — a probe deferred: playwright absent or an un-instantiated template)' },
    criteria: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          met: { type: 'boolean', description: 'the criterion was exercised and genuinely met (not just trusting the suite)' },
          critical: { type: 'boolean', description: 'a criterion whose failure is fatal — true unless the plan marks it optional/non-critical' },
          browser_only: { type: 'boolean', description: 'this criterion can ONLY be confirmed by driving the live UI in a browser (its met value is provisional until the Tier-2 traversal)' },
          note: { type: 'string' },
        },
        required: ['id', 'met'],
      },
    },
    ui_scope: { type: 'boolean', description: 'true iff the deliverable has UI/web behavioral criteria (web/extension/electron product, a design/ dir, or any browser_only criterion)' },
    missing_creds: { type: 'boolean', description: 'a credentials/env gap blocked some check — caps the verdict at PARTIAL, never FAILED on its own' },
    coverage_gaps: { type: 'array', items: { type: 'string' } },
    blocking_findings: { type: 'array', items: { type: 'string' }, description: 'any failure severe enough to block a PASS that is not already captured by an exit code or an unmet critical criterion' },
    correction_tasks: { type: 'array', items: { type: 'string' } },
  },
  // §5.1: exit codes are transcribed EXACTLY and the verdict rules over them — so the two Law-floor
  // exit codes are MANDATORY (a missing suite_exit folds to null and FAILS CLOSED in validateVerdict;
  // requiring it forces the honest transcription, -1 in the no-pluginRoot degraded branch). suite_cmd
  // is required alongside so the transcribed suite exit is always traceable to the command that produced it.
  required: ['reasoning', 'report_file', 'install_ok', 'law_run_exit', 'suite_exit', 'suite_cmd', 'criteria', 'ui_scope'],
}
const TRAVERSAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    tool: { type: 'string', enum: ['kiln-probe', 'none'], description: 'the browser path you actually used (kiln-probe = the scripted one-shot oracle, the ONLY autonomous path; none = no browser available — playwright absent)' },
    browser_result: { type: 'string', enum: ['full', 'failed', 'static-only'], description: 'full = every UI criterion exercised live and clean via the scripted oracle; failed = a real UI defect found; static-only = no browser path available OR the lease expired before all criteria were confirmed (honest degradation)' },
    criteria: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          met: { type: 'boolean', description: 'confirmed by actually driving the UI (or UNVERIFIED when no browser path — set verified:false)' },
          verified: { type: 'boolean', description: 'a browser actually exercised this criterion (false = UNVERIFIED, static-only)' },
          note: { type: 'string' },
        },
        required: ['id', 'met', 'verified'],
      },
    },
    findings: { type: 'array', items: { type: 'string' }, description: 'UI defects found by the live traversal (each one blocks a clean UI PASS)' },
    report_file: { type: 'string' },
  },
  required: ['reasoning', 'tool', 'browser_result', 'criteria', 'findings'],
}
const GOAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    overall: { type: 'string', enum: ['pass', 'fail'], description: 'does the WHOLE deliverable genuinely deliver the VISION success criteria? \'fail\' MUST be backed by at least one critical or high finding' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { text: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } },
        required: ['text', 'severity'],
      },
    },
    report_file: { type: 'string' },
  },
  required: ['reasoning', 'overall', 'findings'],
}
const DETECT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string' }, design_present: { type: 'boolean', description: 'true iff a non-empty design/ directory exists under .kiln' } },
  required: ['design_present'],
}

// ── The deterministic verdict (BLUEPRINT §3.2/§5.1) + reconcile blocking arithmetic — inlined pure
//    logic, unit-tested in src/spine.mjs and src/reconcile.mjs. The PASS/PARTIAL/FAILED ruling runs
//    IN THE SCRIPT over the evidence files, never in an agent. ──
function validateVerdict(ev) {
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

// ── Ledger (BLUEPRINT §3.5): posture + sweep + verdict events into events.jsonl via the kiln-state
//    CLI. Only called when pluginRoot is known (the CLI path is resolvable); absence degrades the
//    append to a no-op log line, never a thrown stage. ──
async function ledger(type, data) {
  if (!pluginRoot) { log(`(ledger skipped — pluginRoot absent) ${type}`); return }
  const ev = JSON.stringify({ type, stage: 'validate', data })
  await agent(
    `You are Thoth, the scribe — "write it down or it never happened". Append ONE event to the Kiln run ledger.\n\n` +
    `<task>Run this exact command (Bash), substituting the JSON verbatim — do not edit it:\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-state.mjs append ${kilnDir} '${ev.replace(/'/g, `'\\''`)}'\n` +
    '```\n' +
    `If it exits non-zero (e.g. no events.jsonl yet — the run was not initialised), report the error in your summary; do NOT create or repair any file. Report only whether the append succeeded.</task>`,
    { label: 'thoth:ledger', phase: 'The Verdict', model: 'haiku' }
  )
}

// ── Stage-level browser sweep (BLUEPRINT §7 / discipline-spec lifecycle step 3) — the OUTER bracket
//    around the Tier-2 traversal. The browser is a subprocess with a deadline, never a service:
//    kiln-probe brackets its own per-run sweep, but a wrapper SIGKILLed at an OUTER deadline never
//    runs its exit handler. THIS stage bracket is the backstop, ONE arm now (the MCP arm is gone —
//    autonomous validate no longer drives Playwright MCP per the ruling, so no host browser exists to
//    reap): `kiln-probe sweep VALIDATE_RUN_TOKEN` — RUN-TOKEN scoped to the scripted oracle's own
//    `kiln-pw-<token>` trees (never the whole namespace, never the operator's browser; blanket
//    pkill -f chrome stays forbidden). Used pre-flight before the first traversal probe (defends
//    against a prior crashed run's orphans). The stage-END teardown is leaseRelease() below, which
//    kills the watchdog AND sweeps the same token in one shot. Ledgered; the sweep CLI always exits 0
//    so cleanup never fails a stage. ──
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
  if (!pluginRoot) { log(`(browser sweep skipped — pluginRoot absent) ${when}`); return }
  const r = await agent(
    `You are the browser-leak sweeper — the stage-level bracket of the bounded-browser discipline (the browser is a subprocess with a deadline, never a service). You run TWO commands and report what they found; you never launch a browser, never edit, never judge, and never kill anything yourself.\n\n` +
    `<task>Run these TWO exact commands in order (Bash):\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-probe.mjs sweep ${VALIDATE_RUN_TOKEN}\n` +
    `node ${pluginRoot}/scripts/kiln-probe.mjs leak-scan\n` +
    '```\n' +
    `The FIRST sweeps THIS validate stage's own scripted-probe browser trees ONLY — the prefix '${VALIDATE_RUN_TOKEN}' can never touch a concurrent Kiln run or the operator's own browser; blanket 'pkill -f chrome' is forbidden. It ALWAYS exits 0.\n` +
    `The SECOND is a STRICTLY READ-ONLY scan for a FOREIGN browser we do not own (a stray Playwright temp-profile or Playwright-MCP browser) — it kills NOTHING, removes NOTHING, and ALWAYS exits 0. It prints ONE 'LEAK_SCAN {json}' line.\n` +
    `Report: sweep_line = the 'SWEEP …' line verbatim; leak_scan_line = the 'LEAK_SCAN …' line verbatim; leak_suspects = the LEAK_SCAN json's counts.suspects; suspects = its suspects array ([] when none); profile_dirs = its profile_dirs array ([] when none). Do not run anything else.</task>`,
    { label: `sentinel:sweep:${when}`, phase: 'The Traversal', model: 'haiku', schema: SWEEP_SCAN_SCHEMA }
  )
  const leakSuspects = (r && Number.isInteger(r.leak_suspects)) ? r.leak_suspects : 0
  const suspects = (r && Array.isArray(r.suspects)) ? r.suspects : []
  const profileDirs = (r && Array.isArray(r.profile_dirs)) ? r.profile_dirs : []
  // Baseline proof for BOTH arms on every bracket (T3 review r1 ruling): leak_suspects AND
  // leak_profile_dirs ride browser_sweep, so the ledger records that disk evidence existed
  // even when no foreign browser is alive. The detail event stays gated on LIVE suspects —
  // stale /tmp profile dirs from unrelated work would make a dirs-only alarm cry wolf; their
  // detail rides whenever the alarm fires, and the LEAK_SCAN line is in the transcript anyway.
  await ledger('browser_sweep', { stage: 'validate', when, token: VALIDATE_RUN_TOKEN, leak_suspects: leakSuspects, leak_profile_dirs: profileDirs.length })
  if (leakSuspects > 0) {
    await ledger('browser_leak_suspect', { stage: 'validate', when, token: VALIDATE_RUN_TOKEN, suspects, profile_dirs: profileDirs })
  }
}

// ── The browser lease (ORCHESTRATOR RULING, p3/tasks.md) — the §7 CAPABILITY deadline. A workflow
//    cannot CANCEL a spawned agent, so the ≤10-min Tier-2 cap lives on the TOOL: leaseTake() writes
//    a kiln-probe lease keyed by VALIDATE_RUN_TOKEN for the traversal budget (seconds), spawning a
//    detached self-terminating watchdog (PID recorded) that sweeps + deletes the lease at expiry; every
//    scripted probe the evaluator fires carries `--lease VALIDATE_RUN_TOKEN` and so REFUSES (exit 77)
//    once the lease expires — an evaluator alive past the deadline can do no further browser work.
//    leaseRelease() is the stage-END teardown: it kills the watchdog (teardown is NOW, not at the cap)
//    and sweeps the token immediately, then deletes the lease so it can never block a later run. Both
//    ledgered; both CLIs always exit 0 so the lease bracket never fails a stage. Skipped (with an
//    honest log line) when pluginRoot is absent — there is no scripted oracle then, so nothing to
//    lease; the verdict degrades to static-only. The seconds budget is ceil(ms/1000), floored at 1. ──
async function leaseTake() {
  if (!pluginRoot) { log('(browser lease skipped — pluginRoot absent; no scripted oracle to lease)'); return }
  const seconds = Math.max(1, Math.ceil(TRAVERSAL_DEADLINE_MS / 1000))
  await agent(
    `You are the lease-taker — you authorize the Tier-2 browser capability for a bounded window, then report. You never launch a browser, never edit, never judge.\n\n` +
    `<task>Run this exact command (Bash):\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-probe.mjs lease ${kilnDir} ${VALIDATE_RUN_TOKEN} ${VALIDATE_RUN_TOKEN} ${seconds}\n` +
    '```\n' +
    `It writes the browser lease (token '${VALIDATE_RUN_TOKEN}', a ${seconds}s expiry) and spawns a detached self-terminating watchdog that sweeps the token + deletes the lease at expiry. The Tier-2 evaluator's scripted probes run with '--lease ${VALIDATE_RUN_TOKEN}' and refuse (exit 77) once it expires — that is how the ≤10-min cap is enforced on the capability. It ALWAYS exits 0. Transcribe the 'LEASE …' line it prints. Do not run anything else.</task>`,
    { label: 'sentinel:lease-take', phase: 'The Traversal', model: 'haiku' }
  )
  await ledger('browser_lease', { stage: 'validate', action: 'take', token: VALIDATE_RUN_TOKEN, seconds })
}
async function leaseRelease() {
  if (!pluginRoot) { log('(browser lease-release skipped — pluginRoot absent)'); return }
  await agent(
    `You are the lease-releaser — the stage-end teardown of the bounded-browser capability. You run the cleanup command below and report; you never launch a browser, never edit, never judge.\n\n` +
    `<task>Run this exact command (Bash):\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-probe.mjs lease-release ${kilnDir} ${VALIDATE_RUN_TOKEN}\n` +
    '```\n' +
    `It kills the lease watchdog (teardown is now, not at the deadline), sweeps the '${VALIDATE_RUN_TOKEN}' browser trees, and deletes the lease file — so no Tier-2 browser outlives this stage and no stale lease blocks a later run. It ALWAYS exits 0. Transcribe the 'LEASE_RELEASE …' line it prints. Do not run anything else.</task>`,
    { label: 'sentinel:lease-release', phase: 'The Traversal', model: 'haiku' }
  )
  await ledger('browser_lease', { stage: 'validate', action: 'release', token: VALIDATE_RUN_TOKEN })
}

// ── Prompt builders ──
function driftPrompt() {
  return voice('sonnet') +
    `You are the architecture-drift verifier. ${scope}\n\n` +
    `<inputs>\n- Architectural intent: ${docsDir}/architecture.md, ${docsDir}/arch-constraints.md\n- What was built: ${docsDir}/codebase-state.md and the actual source under ${projectPath}\n</inputs>\n\n` +
    `<task>Compare what was BUILT against the architectural intent and constraints. Then check the interface SEAMS — where modules meet, do the contracts (signatures, shapes, events, shared state) actually line up, or did a later slice break an earlier one's interface? Write ${archCheckFile} (mkdir -p first): list any drift (constraint violations, structural divergence, missing seams), any seam/regression issues, and a BLOCKING subset — only the findings severe enough to block a PASS (a broken seam, a violated load-bearing constraint). Be concrete and file-specific. Report reasoning first.</task>`
}

function argusPrompt() {
  const lawNote = pluginRoot
    ? `<deterministic_floor>\nThe Law is your ORACLE — run it, do not re-derive it. The exact commands (Bash, cwd anywhere; they take absolute paths):\n` +
      `1. node ${pluginRoot}/scripts/kiln-law.mjs verify ${projectPath} ${kilnDir} — the TAMPER gate. If it exits 2, locked Law paths were touched: record that as a blocking finding and note it; the build should never have shipped tampered locks.\n` +
      `2. node ${pluginRoot}/scripts/kiln-law.mjs run ${projectPath} ${kilnDir} --run-prefix ${VALIDATE_RUN_TOKEN} — the FULL Law run: EVERY SC incl. probe checks (instantiated probes EXECUTE here — one bounded browser subprocess each, swept under this stage's token). law_run_exit = its EXACT exit code (0 = every check green; non-zero = the Law is red). From its 'RUN <runId> HEAD <head>' line report run_id. A 'VERIFICATION_CLASS static-only' line means a probe deferred (playwright absent / un-instantiated template) — set verification_class_full=false; otherwise true.\n` +
      `3. node ${pluginRoot}/scripts/kiln-law.mjs suite ${projectPath} ${kilnDir} <run_id> --cmd '<the project test command>' — persists the project suite as hashed evidence. suite_exit = its 'SUITE <runId> exit=<n>' value; suite_cmd = the command; tests_passed/tests_failed from the suite output.\n` +
      `These three commands produce the deterministic evidence the verdict is computed from — transcribe their exit codes EXACTLY (a wrong exit code is the one error that cannot be caught downstream). Then EXERCISE every acceptance criterion beyond what the checks express.\n</deterministic_floor>\n\n`
    : `<deterministic_floor>\nThe kiln-law CLI is unavailable in this run (pluginRoot absent), so the deterministic Law floor cannot run. Set law_run_exit=-1 and suite_exit=-1 (both are REQUIRED — -1 is the agreed sentinel meaning 'not run because the oracle was structurally unavailable', distinct from a dropped exit; the verdict reads it as an HONEST degradation and caps this run at PARTIAL — never a silent PASS, and never a hard FAILED on the missing floor alone), set suite_cmd to the suite command you ran yourself (or '(unavailable)' if you could not run one), install/run the suite yourself the best you can, and report install_ok + tests_passed/tests_failed honestly.\n</deterministic_floor>\n\n`
  return voice('opus') +
    `You are the end-to-end validator — the real backstop. Your job is to ORCHESTRATE the deterministic Law floor and then exercise what it cannot express; you do NOT self-grade the final verdict (that is computed mechanically from your transcribed evidence). ${scope}\n\n` +
    `<inputs>\n- Master plan (acceptance criteria — SC-xx and per-milestone): ${masterPlanFile}\n- The Law index: ${lawFile}\n- The built application at ${projectPath}\n</inputs>\n\n` +
    `<procedure>\n` +
    `1. DETECT THE PRODUCT TYPE, then INSTALL CORRECTLY FIRST. If it is a Python package (pyproject.toml/setup.py, likely src/ layout), create a venv and 'pip install -e .[dev]' (or '.') BEFORE testing — never a bare 'pytest' from root (it fails ModuleNotFound on src-layout). Use the build's recorded test_command if one exists. install_ok=false on a build failure (still attempt the rest).\n` +
    `2. Run the DETERMINISTIC LAW FLOOR (below) and transcribe its exit codes EXACTLY.\n` +
    `3. EXERCISE EVERY ACCEPTANCE CRITERION by actually running the app (cli: run commands with real inputs; api: start it, send real HTTP, check shapes, stop it; library: exercise entry points). Mark each met/unmet with concrete evidence, and class it: critical (failure is fatal) unless the plan marks it optional; browser_only (can ONLY be confirmed by driving the live UI — its met is provisional until the Tier-2 traversal).\n` +
    `4. Set ui_scope=true iff there are UI/web behavioral criteria (a web/extension/electron product, a design/ dir, or any browser_only criterion). For UI behavioral criteria you do NOT launch a browser here — the bounded Tier-2 traversal owns that (a separate phase). Verify everything statically you can (structure, wired handlers, asset wiring, a11y attributes in markup).\n` +
    `5. Missing credentials/env: set missing_creds=true, note it, continue — NEVER FAIL solely for missing creds.\n` +
    `</procedure>\n\n` +
    lawNote +
    `<output>Persist the full prose report to ${reportFile} via Bash — mkdir -p first, then a heredoc (cat <<'EOF' > file); do NOT use the Write tool for it (the platform may nudge-reject subagent Write calls for report files — observed in the field 2026-07-01; Bash writes are the engine's normal artifact channel). The report carries: product type, install result, the three Law exit codes + run_id, suite summary, per-criterion results with full evidence, coverage_gaps, blocking_findings (any failure that blocks a PASS not already an exit code or unmet critical criterion), and a prioritized correction_tasks list (one per distinct failure: failure, evidence, affected files, suggested fix).\n` +
    `STRUCTURED-OUTPUT DISCIPLINE (a failed schema is a failed stage — the verdict computes from these fields): the criteria array is REQUIRED and must carry EVERY criterion you exercised as {id, met, critical} with note ≤ 1 line — the full prose evidence lives in the report file, never in the schema; omitting the array (or flooding notes until the output truncates) IS the observed death mode. Reasoning ≤ a short paragraph. Report reasoning first, then the transcribed fields.</output>`
}

function hephaestusPrompt() {
  return `You are the design-QA reviewer. ${scope}\n\n` +
    `<inputs>\n- Design system: ${kilnDir}/design/ artifacts\n- The built UI source under ${projectPath}\n</inputs>\n\n` +
    `<task>Do a 5-axis design review (visual hierarchy, consistency/tokens, spacing/rhythm, typography, polish) by reading the code STATICALLY — do NOT launch a browser (the bounded Tier-2 traversal owns live rendering). Note any check that genuinely needs a render as an explicit coverage gap for the traversal. Write ${valDir}/design-review.md. Scores are ADVISORY — never the sole cause of a FAIL.</task>`
}

// traversalPrompt — the §7 Tier-2 bounded browser traversal. ONE fresh evaluator (cross-family from
// the build's Opus UI builder when codexAvailable — translate per the codex guide; else fresh
// context). It walks EVERY UI acceptance criterion against the SERVED app.
//
// THE BOUNDED-BROWSER LAW (§7 / discipline-spec step 1-3): the browser is a subprocess with a
// deadline, never a service. The ONLY browser path in autonomous validate is the scripted kiln-probe
// BOUNDED ORACLE: each criterion is ONE one-shot launch→assert→close process under a hard
// 'timeout 90 --kill-after=10', running under a runId prefixed with VALIDATE_RUN_TOKEN, so the stage
// pre/post sweeps mechanically SIGKILL any survivor and rm its /tmp/kiln-pw-<token> profile. Every
// probe carries '--lease VALIDATE_RUN_TOKEN' (the workflow took the lease before this agent spawned),
// so the ≤10-min cap is enforced on the CAPABILITY: once the lease expires the probe REFUSES (exit 77)
// and an evaluator alive past the deadline can do no further browser work. A clean UI PASS
// (browser_result='full') is establishable ONLY through this swept, leased, scripted path.
//
// Playwright MCP is REMOVED from autonomous validate (ORCHESTRATOR RULING, p3/tasks.md): an MCP server
// is a PERSISTENT browser service the workflow can neither lease-bound nor reap by token — §7 forbids
// it in-loop. The evaluator NEVER drives MCP here. MCP stays a doctor-detected capability for the
// operator's INTERACTIVE/manual visual QA only, named in the emitted visual_qa_checklist as the manual
// alternative — it is not a path this agent may take. The withDeadline() timer the workflow wraps this
// agent in is the await-bound belt to the lease's capability-bound suspenders: it stops the workflow
// blocking on a wedged evaluator, while the lease guarantees no browser the evaluator launches outlives
// the cap. No persistent browser/MCP service backs a green verdict; nothing the evaluator spawns
// outlives the stage.
function traversalPrompt(scsForProbe) {
  const probePath = pluginRoot ? `${pluginRoot}/scripts/kiln-probe.mjs` : null
  // The scripted oracle is the ONLY browser path. It exists whenever pluginRoot is known.
  const probeArm = probePath
    ? `- SCRIPTED BOUNDED ORACLE (the ONLY browser path — run it for EVERY UI criterion): 'node ${probePath} run ${projectPath} ${kilnDir} <SC-id> <runId> --lease ${VALIDATE_RUN_TOKEN}' where <runId> begins with '${VALIDATE_RUN_TOKEN}-' (MANDATORY — the stage pre/post sweeps reap exactly these runIds, the wrapper hard-kills each probe at a 90s deadline). The '--lease ${VALIDATE_RUN_TOKEN}' is MANDATORY too: it is the browser lease the workflow took for you, and it expires at the ≤10-min Tier-2 cap — a probe fired after the cap REFUSES with exit 77 LEASE_EXPIRED (the capability deadline), so do NOT loop or re-launch. Each call is one launch→assert→close OS process; it writes evidence (probe-<SC>.json + screenshot + log) into ${kilnDir}/evidence/<runId>/ and exits 0 pass · 1 assert-fail · 77 lease-expired (the cap was reached) · 78 unavailable (playwright absent) · 79 timeout. The Law's probe checks already carry specs (kind:'probe' in ${lawFile}); these SCs map to UI criteria: ${scsForProbe.length ? scsForProbe.join(', ') : '(none in law.json — author a minimal spec inline only if a criterion truly needs one)'}. If a 78 (PROBE_UNAVAILABLE) comes back, playwright is absent — there is NO browser path: stop, set browser_result='static-only', mark every UI criterion verified:false (UNVERIFIED). If a 77 (LEASE_EXPIRED) comes back you have hit the cap — stop immediately and report what you confirmed so far (criteria you did NOT confirm live stay verified:false).\n`
    : `- The kiln-probe CLI is unavailable (pluginRoot absent) — there is NO browser path. Set tool='none', browser_result='static-only', mark every UI criterion verified:false (UNVERIFIED) — honest degradation, never a clean UI pass invented from static review.\n`
  const how = codexAvailable
    ? `<how>${codexGuideNote}You are a CROSS-FAMILY evaluator — translate this brief into a Codex-native prompt and delegate the analysis to GPT-5.5 via 'codex exec' at model_reasoning_effort="high" (the build's UI builder is Opus, so a different family genuinely re-checks the work). The scripted kiln-probe calls run as Bash either way; if codex errors, evaluate directly.</how>\n\n`
    : ''
  return voice('opus') +
    `You are the Tier-2 bounded browser evaluator — a FRESH context, the only agent in this pipeline that drives a real browser, and you do it under a hard deadline. THE LAW: the browser is a subprocess with a deadline, never a service; one one-shot process per check; nothing you spawn may outlive you. You do NOT use Playwright MCP or any persistent browser tool — only the scripted one-shot kiln-probe below. "Out of the box, Claude is a poor QA agent" — do NOT talk yourself into approving superficially-tested work.\n\n` +
    `<inputs>\n- Master plan (acceptance criteria): ${masterPlanFile}. VISION: ${visionFile}.\n- The Law index (probe specs): ${lawFile}. The built app at ${projectPath}.\n- The deterministic validator's report: ${reportFile} (read its ui criteria — these are what you confirm LIVE).\n</inputs>\n\n` +
    `<procedure>\n` +
    `1. The scripted probe serves the app for you per its spec (http, never file://) — you do not start a server yourself.\n` +
    probeArm +
    `2. Walk EVERY UI acceptance criterion via the scripted probe: navigate, exercise the literal action (click the button → assert the state change), traverse states (empty/loading/error/success), capture console errors (zero expected), capture failed first-party requests (4xx/5xx), screenshot ≥2 viewports (1440×900 + 390×844). Judge each screenshot by a BINARY RUBRIC only — is the key content/nav visible? is text clipped/overlapping? does it match the stated design language? — NEVER a numeric/aesthetic score (VLMs rank reliably but score unreliably).\n` +
    `3. browser_result: 'full' iff EVERY UI criterion was exercised LIVE and clean THROUGH THE SCRIPTED ORACLE (no console errors, no failed first-party requests, no failed rubric, no broken interaction); 'failed' iff the scripted traversal found a real UI defect (list it in findings — a defect blocks a clean UI PASS); 'static-only' iff no scripted oracle was available OR the lease expired before every criterion was confirmed (mark the unconfirmed criteria verified:false). Set tool to 'kiln-probe' when the scripted oracle ran, else 'none' if no browser ran at all.\n` +
    `4. THE DEADLINE (capability-enforced, not goodwill): each scripted probe is hard-killed at 90s, and the lease expires at the ≤10-minute Tier-2 cap — a probe after the cap is REFUSED (exit 77), and the workflow also stops awaiting you at the cap and folds this pass static-only (UI criteria UNVERIFIED). So work efficiently and do NOT loop or re-launch. When done, let scripted probes exit cleanly (the stage sweeps and releases their kiln-pw- token / lease).\n` +
    `</procedure>\n\n` +
    how +
    `<task>Write ${valDir}/traversal.md (mkdir -p first) and return tool, browser_result, per-criterion {id, met, verified, note}, findings (live UI defects), and report_file. Report reasoning first.</task>`
}

// goalBody — the shared audit body (no role line, no voice header) so the first auditor and the
// D8=2 second-family auditor share identical inputs/task and only differ in their role preamble.
const goalBody = (reportName) =>
  `<inputs>\n- VISION success criteria (SC-xx, the promise): ${visionFile}. Master plan: ${masterPlanFile}.\n- The live repo at ${projectPath}: git log/diff, read the files, and EXERCISE the product the way a user would (run the CLI, call the API, render the page statically — no browser; the Tier-2 traversal owns live UI).\n</inputs>\n\n` +
  `<task>Hunt the "checks pass, goal broken" class across the whole product: success criteria met by the letter but broken in spirit, features that exist but cannot be reached from the entry points, slices that pass alone but never connect, hardcoded/stub behavior behind green checks. Write ${qaDir}/${reportName} (mkdir -p first) and return overall ('pass' = the deliverable genuinely delivers the VISION; 'fail' MUST be backed by at least one critical or high finding), findings (each {text, severity}), and report_file. Read-only on source. Report reasoning first.</task>`
function goalPrompt() {
  return voice('opus') +
    `You are the goal-backward final auditor over the WHOLE deliverable. Your one question: does the finished product genuinely deliver the VISION success criteria? Work BACKWARD from the goal — never forward from the checks (they pass; that comfort is exactly what you distrust). This runs over the entire deliverable, not one milestone (per-milestone goal-backward already ran in build).\n\n` +
    goalBody('goal-backward-final.md')
}

// ── Measuring Drift — the parallel fan-out (lever 9): zoxea ∥ argus ∥ hephaestus ─────────────────
phase('Measuring Drift')
log(`${spin('drift', 0)} — drift ∥ the Law floor ∥ design QA fan out`)
// §3.5 stage bracket (P3.6 T4): the validate stage is entered. ledger() gates on pluginRoot itself
// and degrades to a log line when the CLI is absent — never a stage failure.
await ledger('stage_started', { stage: 'validate' })

// hephaestus runs iff design/ exists on disk (§4 self-validation — the conductor's designPresent is
// only a hint; a cheap detect probe is authoritative). A no-pluginRoot run still detects via the
// agent's own ls. We resolve it via a cheap haiku probe so a wrong hint never silently mis-routes.
const detect = await agent(
  `You are the design-dir detector — one fact, no edits.\n\n` +
  `<task>Run 'ls -A ${kilnDir}/design 2>/dev/null' (Bash). Report design_present = true iff the directory exists AND lists at least one entry; false otherwise (a missing dir prints nothing — that is false). Do not read or write anything else.</task>`,
  { label: 'hephaestus:detect', phase: 'Measuring Drift', model: 'haiku', schema: DETECT_SCHEMA }
)
const designPresent = detect ? detect.design_present === true : designHint

const fanLegs = [
  () => agent(driftPrompt(), { label: 'zoxea:arch-check', phase: 'Measuring Drift', model: 'sonnet', schema: ARCHCHECK_SCHEMA }),
  () => agent(argusPrompt(), { label: 'argus:validate', phase: 'Measuring Drift', model: 'opus', schema: VALIDATE_SCHEMA }),
]
if (designPresent) fanLegs.push(() => agent(hephaestusPrompt(), { label: 'hephaestus:design-qa', phase: 'Measuring Drift', model: 'sonnet' }))
const fan = await parallel(fanLegs)
const arch = fan[0]
const argus = fan[1]
log(`Arch-check: ${(arch && arch.drift || []).length} drift, ${(arch && arch.seam_issues || []).length} seam(s), ${(arch && arch.blocking || []).length} blocking`)
log(`${spin('validate', 1)} — law_run_exit=${argus && argus.law_run_exit} · suite_exit=${argus && argus.suite_exit} · ${(argus && argus.criteria || []).length} criterion(s) exercised`)
if (designPresent) log('Design QA complete (advisory)')

// ui_scope: argus's own determination, OR (fail toward scrutiny) a design/ dir, OR any browser_only
// criterion — a UI deliverable is never silently treated as logic-only.
const argusCriteria = (argus && Array.isArray(argus.criteria)) ? argus.criteria : []
const uiScope = (argus && argus.ui_scope === true) || designPresent || argusCriteria.some((c) => c && c.browser_only === true)

// ── The Traversal — the §7 Tier-2 bounded browser pass (ui scope only) ───────────────────────────
let traversal = null
let traversalRan = false
const traversalSuffixes = posture.adversarial_pass ? ['', ':adversarial'] : [''] // D8=2: a second adversarial pass
try {
  if (uiScope) {
    phase('The Traversal')
    log(`${spin('traverse', 0)} — UI scope: one bounded evaluator walks every UI criterion (${pluginRoot ? 'scripted kiln-probe oracle, lease-gated' : 'no browser path — pluginRoot absent'})`)
    await stageSweep('pre-flight') // discipline-spec lifecycle step 3: defend against a prior crashed run's orphans
    await leaseTake() // §7 capability deadline: take the browser lease BEFORE the evaluator spawns — its probes refuse (exit 77) once it expires
    const uiScs = (() => {
      // the probe-kind SCs argus saw map to the live UI criteria the scripted path drives. We pass
      // the law.json probe ids argus did not contradict; the evaluator reads law.json itself for specs.
      const ids = argusCriteria.filter((c) => c && c.browser_only === true && typeof c.id === 'string').map((c) => c.id)
      return Array.from(new Set(ids))
    })()
    // The §7 ≤10-min session cap, enforced per pass by the WORKFLOW deadline race — cumulative
    // wall-clock tracking is impossible in-script (Date.now is forbidden by the runtime determinism
    // guard), so the CUMULATIVE enforcer is the browser LEASE: its watchdog kills every browser at
    // lease expiry no matter how many passes are in flight. A timed-out pass is discarded as a
    // sentinel → folds 'static-only' and we stop launching further passes; the sweep reaps survivors.
    const passes = []
    let deadlineHit = false
    for (const sfx of traversalSuffixes) {
      const t = await withDeadline(
        () => agent(traversalPrompt(uiScs), { label: `argus:traversal${sfx}`, phase: 'The Traversal', model: 'opus', schema: TRAVERSAL_SCHEMA }),
        TRAVERSAL_DEADLINE_MS
      )
      if (t === TRAVERSAL_TIMEOUT) {
        // A deadline is a DEGRADATION (static-only ceiling → PARTIAL), never a UI DEFECT (→ FAILED):
        // the work is unproven, not proven-broken. So the sentinel folds 'static-only' with NO finding
        // (findings are blocking and would wrongly force FAILED) — the verdict caps at PARTIAL exactly
        // as an absent browser path does, honestly degraded, never silently green.
        deadlineHit = true
        log(`Traversal pass '${sfx || 'primary'}' hit the ${Math.round(TRAVERSAL_DEADLINE_MS / 1000)}s Tier-2 deadline — discarded (folds static-only, PARTIAL ceiling); the stage sweep reaps its browser`)
        passes.push({ browser_result: 'static-only', tool: 'none', criteria: [], findings: [] })
        break // the session cap is hit; no further passes
      }
      passes.push(t)
    }
    traversalRan = true
    // MECHANICAL bounded-browser guard (§7): a clean 'full' is only believable through the swept,
    // leased scripted oracle — the one browser path the workflow spawns under a deadline and reaps by
    // VALIDATE_RUN_TOKEN. A pass that claims 'full' WITHOUT the scripted oracle (tool!='kiln-probe') is
    // downgraded to 'static-only' here, in the workflow, not left to the agent's word — the deterministic
    // teeth behind the prompt's "the scripted oracle is the ONLY browser path". Scrutiny only rises.
    const resultOf = (t) => {
      const r = (t && (t.browser_result === 'full' || t.browser_result === 'failed' || t.browser_result === 'static-only')) ? t.browser_result : 'static-only'
      if (r === 'full' && !(t && t.tool === 'kiln-probe')) return 'static-only' // a 'full' not proven by the scripted oracle is unprovable → degrade honestly
      return r
    }
    // fold the passes: the WORST result wins (failed > static-only > full — scrutiny only rises),
    // findings union. A null pass (dead agent) folds as static-only (no proof of a clean traversal).
    const worst = passes.reduce((acc, t) => {
      const r = resultOf(t)
      if (acc === 'failed' || r === 'failed') return 'failed'
      if (acc === 'static-only' || r === 'static-only') return 'static-only'
      return 'full'
    }, 'full')
    const findings = Array.from(new Set(passes.flatMap((t) => (t && Array.isArray(t.findings)) ? t.findings.filter((f) => typeof f === 'string' && f.trim()) : [])))
    traversal = { browser_result: worst, findings, tool: passes[0] && passes[0].tool, criteria: passes.flatMap((t) => (t && Array.isArray(t.criteria)) ? t.criteria : []) }
    log(`Traversal: ${traversal.browser_result}${traversal.tool ? ` via ${traversal.tool}` : ''} — ${findings.length} UI finding(s)${deadlineHit ? ` (deadline hit — ${Math.round(TRAVERSAL_DEADLINE_MS / 1000)}s cap)` : ''}`)
    await ledger('tier2_traversal', { ui_scope: true, tool: traversal.tool || null, browser_result: traversal.browser_result, findings: findings.length, passes_run: passes.length, passes_planned: traversalSuffixes.length, deadline_hit: deadlineHit, deadline_ms: TRAVERSAL_DEADLINE_MS })
  }

  // ── Goal Backward — the whole-deliverable audit vs the VISION success criteria ─────────────────
  phase('Goal Backward')
  log(`${spin('goal', 0)} — judging the whole deliverable backward from the VISION`)
  const goalLegs = [() => agent(goalPrompt(), { label: 'aristotle:goal-final', phase: 'Goal Backward', model: 'opus', schema: GOAL_SCHEMA })]
  // D8=2 second_family: a second cross-family auditor over the same deliverable (codex when present).
  if (posture.second_family) {
    goalLegs.push(() => agent(
      (codexAvailable
        ? `You are the SECOND-FAMILY goal-backward auditor over the WHOLE deliverable, delegating to GPT-5.5 via 'codex exec' for a genuinely cross-family second judgment — run codex at model_reasoning_effort="high". ${codexGuideNote}If it errors, audit directly. Work BACKWARD from the VISION success criteria; do NOT read the first auditor's report — stay independent.\n\n`
        : `You are the SECOND goal-backward auditor over the WHOLE deliverable — an independent second perspective. Work BACKWARD from the VISION success criteria; do NOT read the first auditor's report — stay independent.\n\n`) +
      goalBody('goal-backward-final-second.md'),
      { label: 'aristotle:goal-final:second-family', phase: 'Goal Backward', model: codexAvailable ? 'sonnet' : 'opus', schema: GOAL_SCHEMA }
    ))
  }
  const goalReports = await parallel(goalLegs)
  const goal = goalReports[0]
  const goalSecond = goalReports[1] || null
  // the goal audit's findings join the blocking arithmetic via the same deterministic reconcile the
  // milestone gate uses (dedupe by normalized text, max severity wins, blocking = any critical|high).
  const goalRec = denzelReconcile(goal, goalSecond)
  log(`${spin('goal', 1)} — goal-backward: ${(goal && goal.overall) || 'no report'}${goalSecond ? ` ∥ ${(goalSecond && goalSecond.overall) || 'no report'}` : ''}, ${goalRec.findings.length} finding(s), ${goalRec.blocking.length} blocking`)

  // ── The Verdict — computed DETERMINISTICALLY (validateVerdict) over all the evidence ───────────
  phase('The Verdict')
  log(`${spin('verdict', 0)}`)
  // browser_path for the verdict: the traversal's folded result when it ran; '' (⇒ static-only for a
  // UI scope) when it did not. A non-UI scope has no browser gap.
  const browserPath = traversalRan ? traversal.browser_result : (uiScope ? 'static-only' : '')
  // blocking findings the verdict gates on: arch-check blocking ∪ argus blocking_findings ∪ the
  // goal-backward critical|high reconcile ∪ the live UI traversal's defects (a UI defect is fatal —
  // browserPath==='failed' also gates, but the finding text is what the report shows).
  const blockingFindings = [
    ...((arch && Array.isArray(arch.blocking)) ? arch.blocking : []),
    ...((argus && Array.isArray(argus.blocking_findings)) ? argus.blocking_findings : []),
    ...goalRec.blocking.map((f) => `[goal-backward] ${f.text}`),
    ...((traversal && Array.isArray(traversal.findings)) ? traversal.findings.map((f) => `[ui-traversal] ${f}`) : []),
  ].filter((s) => typeof s === 'string' && s.trim())

  const verdictInput = {
    install_ok: argus ? argus.install_ok === true : false,
    law_run_exit: (argus && typeof argus.law_run_exit === 'number') ? argus.law_run_exit : null,
    suite_exit: (argus && typeof argus.suite_exit === 'number') ? argus.suite_exit : null,
    tests_passed: (argus && typeof argus.tests_passed === 'number') ? argus.tests_passed : null,
    tests_failed: (argus && typeof argus.tests_failed === 'number') ? argus.tests_failed : null,
    criteria: argusCriteria.map((c) => ({ id: c.id, met: c.met === true, critical: c.critical !== false, note: c.note })),
    blocking_findings: blockingFindings,
    ui_scope: uiScope,
    browser_path: browserPath,
    missing_creds: argus ? argus.missing_creds === true : false,
  }
  const v = validateVerdict(verdictInput)
  log(`VERDICT: ${v.verdict} · verification_class=${v.verification_class} · browser=${v.browser_verdict}${v.blocking.length ? ` · ${v.blocking.length} blocking` : ''}`)

  // The out-of-loop visual checklist still ships (v2 semantics preserved) — it is the one-shot
  // operator pass that upgrades a static-only UI verdict, AND a record even when Tier-2 ran (an
  // independent human re-check of the live render). MCP is named HERE (and only here) as the
  // interactive/manual tool for this human pass — autonomous validate never drives it (the ruling).
  // The correction tasks join argus's.
  const visual_qa_checklist = uiScope
    ? [
        'Serve over http (NEVER file://) and open the app — interactively, e.g. via Playwright MCP (browser_* tools) if you have it configured, or any browser. This is the MANUAL re-check; the autonomous Tier-2 traversal used scripted one-shot probes only.',
        'Click every wired interaction; traverse empty / loading / error / success states.',
        'Capture console errors (expect zero) and failed first-party network requests (4xx/5xx).',
        'Run axe-core a11y; gate on critical/serious violations.',
        'Screenshot ≥2 viewports (1440×900 desktop + 390×844 mobile).',
        'Scroll-and-capture each scroll-reveal section (a fullPage headless shot renders IntersectionObserver sections as a blank void — force them visible or scroll first).',
        'If you used Playwright MCP: browser_close when done — leave no browser session alive.',
      ]
    : []
  const correction_tasks = Array.from(new Set([
    ...((argus && Array.isArray(argus.correction_tasks)) ? argus.correction_tasks : []),
    ...v.reasons,
  ]))

  await ledger('validate_verdict', {
    verdict: v.verdict,
    verification_class: v.verification_class,
    browser_verdict: v.browser_verdict,
    ui_scope: uiScope,
    law_run_exit: verdictInput.law_run_exit,
    suite_exit: verdictInput.suite_exit,
    blocking: v.blocking.length,
    adversarial_pass: posture.adversarial_pass,
    second_family: posture.second_family,
  })

  // §3.5 stage bracket (P3.6 T4): validate COMPLETES only on a clean VALIDATE_PASS — a PARTIAL/FAILED
  // verdict leaves the projection at 'validate' (accurate: the conductor loops corrections back to
  // build, or escalates). stage_completed bumps the projection to 'report' (STAGE_ORDER).
  if (v.verdict === 'VALIDATE_PASS') await ledger('stage_completed', { stage: 'validate' })

  return {
    verdict: v.verdict,
    verification_class: v.verification_class,
    browser_verdict: v.browser_verdict,
    report_file: reportFile,
    product_type: argus && argus.product_type,
    tests_passed: verdictInput.tests_passed,
    tests_failed: verdictInput.tests_failed,
    law_run_exit: verdictInput.law_run_exit,
    suite_exit: verdictInput.suite_exit,
    criteria: verdictInput.criteria,
    visual_qa_checklist,
    correction_tasks,
    blocking: v.blocking,
    coverage_gaps: (argus && argus.coverage_gaps) || [],
    drift: (arch && arch.drift) || [],
    seam_issues: (arch && arch.seam_issues) || [],
    goal_backward: goal && goal.overall,
  }
} finally {
  // §7 / discipline-spec lifecycle step 3 + the ORCHESTRATOR RULING: UNCONDITIONAL stage-end teardown
  // on EVERY exit path. TWO arms, both run-token scoped to VALIDATE_RUN_TOKEN, each try/guarded so a
  // cleanup failure can never mask a real error propagating out:
  //   (1) leaseRelease() — kill the lease watchdog (teardown is NOW, not at the deadline), sweep the
  //       token, delete the lease file. This is the lease's symmetric close: a watchdog left running
  //       would needlessly re-sweep at expiry, and a stale lease could block a later run.
  //   (2) stageSweep('stage-end') — the belt to lease-release's suspenders: reaps any survivor (an
  //       outer-deadline SIGKILL of a probe wrapper, a crash mid-traversal) even if the lease was
  //       never taken (lease-take agent failed) or already self-released at expiry.
  if (uiScope) {
    try { await leaseRelease() } catch (e) { log(`stage-end lease-release failed (non-fatal): ${e && e.message ? e.message : e}`) }
    try { await stageSweep('stage-end') } catch (e) { log(`stage-end browser sweep failed (non-fatal): ${e && e.message ? e.message : e}`) }
  }
}
