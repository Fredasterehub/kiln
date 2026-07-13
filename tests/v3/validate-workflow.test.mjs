// validate-workflow.test.mjs — P3.6 T4 acceptance for validate's stage brackets (RUN-B FINDING 2).
// The GENERATED workflows/validate.js is driven through its INLINED deterministic verdict
// (validateVerdict) with every agent MOCKED, over a NON-UI scope (so the Tier-2 traversal / lease /
// sweep legs are skipped and the path is the lean drift ∥ Law-floor ∥ goal-backward → verdict one).
// The contract under test: stage_started fires at stage entry; stage_completed fires ONLY on a clean
// VALIDATE_PASS verdict — a PARTIAL/FAILED verdict leaves the projection at 'validate' (accurate: the
// conductor loops corrections back to build).
//
// The workflow runs exactly as the runtime evaluates it (and as dry-run-runner.mjs does): the leading
// `export ` is stripped off `export const meta`, the body becomes an AsyncFunction whose parameters
// are the workflow globals, and stubs are passed positionally. `agent` is a programmable mock keyed
// off the call's `label`; every call records {label, prompt}.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKFLOW = fileURLToPath(new URL('../../plugins/kiln/workflows/validate.js', import.meta.url))
const AsyncFunction = (async () => {}).constructor
const wfBody = readFileSync(WORKFLOW, 'utf8').replace(/^export const meta\b/m, 'const meta')

async function runValidate(args, respond) {
  const calls = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    calls.push({ label, prompt })
    return respond(label, prompt)
  }
  const stubs = {
    args, phase: () => {}, log: () => {}, agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async () => [], budget: undefined, workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, wfBody)
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, calls }
}

const baseArgs = { kilnDir: '/tmp/val-x/.kiln', projectPath: '/tmp/val-x', codexAvailable: false, pluginRoot: '/plug' }
const ledgersOf = (calls, type) => calls.filter((c) => c.label === 'thoth:ledger' && c.prompt.includes(`"type":"${type}"`))

// A clean NON-UI (cli) validator report → VALIDATE_PASS: install ok, Law green, suite green, the one
// criterion met, no blocking, ui_scope false.
const argusPass = {
  reasoning: 'r', report_file: 'report.md', product_type: 'cli',
  install_ok: true, law_run_exit: 0, suite_cmd: 'pytest', suite_exit: 0,
  tests_passed: 5, tests_failed: 0, run_id: 'RUN1', verification_class_full: true,
  criteria: [{ id: 'SC-001', met: true, critical: true }],
  ui_scope: false, missing_creds: false, coverage_gaps: [], blocking_findings: [], correction_tasks: [],
}
const respondPass = (label) => {
  if (label === 'thoth:ledger') return { ok: true }
  if (label === 'hephaestus:detect') return { reasoning: 'r', design_present: false }
  if (label === 'zoxea:arch-check') return { reasoning: 'r', check_file: 'ac.md', summary: 's', drift: [], seam_issues: [], blocking: [] }
  if (label === 'argus:validate') return argusPass
  if (label === 'aristotle:goal-final') return { reasoning: 'r', overall: 'pass', findings: [] }
  return null
}

test('P3.6 T4 validate brackets: stage_started fires on entry; a clean VALIDATE_PASS emits exactly one stage_completed', async () => {
  const { result, calls } = await runValidate(baseArgs, respondPass)
  assert.equal(result.verdict, 'VALIDATE_PASS')
  const started = ledgersOf(calls, 'stage_started')
  const completed = ledgersOf(calls, 'stage_completed')
  assert.equal(started.length, 1, 'the entry bracket fires once at Measuring Drift')
  assert.match(started[0].prompt, /"stage":"validate"/)
  assert.equal(completed.length, 1, 'a clean VALIDATE_PASS completes the stage — projection bumps to report')
  assert.match(completed[0].prompt, /"stage":"validate"/)
  // ordering: stage_started precedes the deterministic validator; stage_completed follows the verdict
  const startedIdx = calls.indexOf(started[0])
  const argusIdx = calls.findIndex((c) => c.label === 'argus:validate')
  const verdictIdx = calls.findIndex((c) => c.label === 'thoth:ledger' && c.prompt.includes('"type":"validate_verdict"'))
  const completedIdx = calls.indexOf(completed[0])
  assert.ok(startedIdx > -1 && startedIdx < argusIdx, 'stage_started brackets the stage before the Law-floor validator')
  assert.ok(completedIdx > verdictIdx, 'stage_completed lands after the verdict is computed and ledgered')
})

test('P3.6 T4 validate brackets: a non-PASS verdict (red Law) emits stage_started but NO stage_completed — the stage stays current', async () => {
  const { result, calls } = await runValidate(baseArgs, (label) => {
    if (label === 'argus:validate') return { ...argusPass, law_run_exit: 1 } // the Law is RED → VALIDATE_FAILED
    return respondPass(label)
  })
  assert.notEqual(result.verdict, 'VALIDATE_PASS')
  assert.equal(ledgersOf(calls, 'stage_started').length, 1, 'the entry bracket still fires — the stage was entered')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'a non-PASS verdict never completes the stage')
})

test('P3.6 T4 validate brackets: a PARTIAL verdict (missing creds) also withholds stage_completed', async () => {
  const { result, calls } = await runValidate(baseArgs, (label) => {
    if (label === 'argus:validate') return { ...argusPass, missing_creds: true } // caps at PARTIAL
    return respondPass(label)
  })
  assert.equal(result.verdict, 'VALIDATE_PARTIAL')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'PARTIAL is not completion — the conductor still owns the next move')
})

// ── D2: a UI-traversal defect's correction task inherits the traversal's on-disk probe artifacts ──
// A UI scope whose Tier-2 traversal finds a defect ([ui-traversal] finding) — the correction task
// that rides back to a build re-entry must NAME the probe evidence paths so the builder reads the
// real DOM/console/screenshot state before re-attempting (reading artifacts is not browser authority).
const argusUi = {
  reasoning: 'r', report_file: 'report.md', product_type: 'web',
  install_ok: true, law_run_exit: 0, suite_cmd: 'npm test', suite_exit: 0,
  tests_passed: 3, tests_failed: 0, run_id: 'RUN1', verification_class_full: true,
  criteria: [{ id: 'SC-UI-1', met: true, critical: true, browser_only: true }],
  ui_scope: true, missing_creds: false, coverage_gaps: [], blocking_findings: [], correction_tasks: [],
}
const traversalFail = { reasoning: 'r', tool: 'kiln-probe', browser_result: 'failed', criteria: [{ id: 'SC-UI-1', met: false, verified: true }], findings: ['the primary nav is clipped below 400px'] }

test('D2 validate (Sol r1-2): a [ui-traversal] correction task carries CONCRETE probe artifact paths — the traversal run id is SCRIPT-ASSIGNED, and no placeholder survives into the build re-entry brief', async () => {
  const { result, calls } = await runValidate(baseArgs, (label) => {
    if (label === 'thoth:ledger') return { ok: true }
    if (label === 'hephaestus:detect') return { reasoning: 'r', design_present: false }
    if (label === 'zoxea:arch-check') return { reasoning: 'r', check_file: 'ac.md', summary: 's', drift: [], seam_issues: [], blocking: [] }
    if (label === 'argus:validate') return argusUi
    if (label.startsWith('argus:traversal')) return traversalFail
    if (label === 'aristotle:goal-final') return { reasoning: 'r', overall: 'pass', findings: [] }
    return null // sentinel lease/sweep legs degrade gracefully
  })
  assert.equal(result.verdict, 'VALIDATE_FAILED', 'a live UI defect fails the verdict')
  // the traversal PROMPT carries the script-assigned run id — the evaluator is never allowed to invent one
  const tp = calls.find((c) => c.label === 'argus:traversal')
  assert.ok(tp, 'the traversal evaluator spawned')
  assert.match(tp.prompt, /run \/tmp\/val-x \/tmp\/val-x\/\.kiln <SC-id> kval-[A-Za-z0-9._-]+-traversal --lease/, 'the probe invocation names the concrete script-assigned runId')
  assert.match(tp.prompt, /script-assigned, never your own/)
  const uiTask = result.correction_tasks.find((t) => t.includes('[ui-traversal]'))
  assert.ok(uiTask, 'the traversal defect became a correction task')
  assert.doesNotMatch(uiTask, /<runId>|<SC>/, 'a placeholder path is useless to a build re-entry — every path must be concrete (Sol r1-2)')
  assert.match(uiTask, /\/tmp\/val-x\/\.kiln\/evidence\/kval-[A-Za-z0-9._-]+-traversal\/probe-SC-UI-1\.json/, 'the per-SC result path is fully resolved: evidence dir + script-assigned runId + SC id')
  assert.match(uiTask, /probe-SC-UI-1\.log/, 'the console/stderr log path is fully resolved too')
  assert.match(uiTask, /screenshot/)
  assert.match(uiTask, /not browser authority/, 'reading artifacts is not browser authority')
})
