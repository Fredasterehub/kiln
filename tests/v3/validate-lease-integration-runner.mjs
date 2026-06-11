// validate-lease-integration-runner.mjs — child executor that drives the SHIPPED workflows/validate.js
// with a REAL pluginRoot so leaseTake()/leaseRelease() run the actual kiln-probe CLI, proving the §7
// CAPABILITY deadline end-to-end (ORCHESTRATOR RULING): a workflow cannot cancel a spawned agent, so
// the Tier-2 ≤10-min cap is enforced on the TOOL — once the lease expires every kiln-probe run REFUSES
// (exit 77). Spawned by validate-lease-integration.test.mjs (never the test runner directly — no
// .test. in the name, index.js does not import it).
//
// It loads the generated validate.js exactly as the engine would (strip `export const meta`, wrap the
// body in an AsyncFunction over the workflow globals) and supplies an `agent` stub that:
//   • for the sentinel labels (sentinel:lease-take / sentinel:lease-release / sentinel:sweep:*) EXECUTES
//     the exact Bash command embedded in the prompt — so the lease is really taken, the watchdog really
//     spawned, the token really swept — the real lifecycle, not a mock;
//   • for the traversal evaluator (argus:traversal*) waits PAST the tiny lease window, then runs the
//     REAL `kiln-probe run … --lease <VALIDATE_RUN_TOKEN>` against the fixture project and captures its
//     exit code — the over-deadline probe attempt. It reports browser_result:'static-only' (the
//     evaluator honestly degrades when its probe is refused), and the captured probe exit is printed on
//     stdout as `PROBE_EXIT <code>` so the test can assert it was 77 (LEASE_EXPIRED);
//   • makes argus report a clean UI-scope deterministic floor so the verdict's only open question is the
//     browser path (which the refused-over-deadline traversal can only leave static-only → PARTIAL);
//   • resolves every other agent to a benign object.
//
// Exit contract: 0 + a `RESULT <json>` line + a `PROBE_EXIT <code>` line on a clean resolve; 1 +
// `{"name","message"}` on any throw.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [file, dir, pluginRoot, projectPath] = process.argv.slice(2)
if (!file || !dir || !pluginRoot || !projectPath) {
  process.stderr.write('usage: node validate-lease-integration-runner.mjs <generated-validate.js> <kiln-sandbox> <pluginRoot> <projectPath>\n')
  process.exit(2)
}

const kilnDir = join(dir, '.kiln')
mkdirSync(join(kilnDir, 'docs'), { recursive: true })
mkdirSync(join(kilnDir, 'design'), { recursive: true }) // a design/ dir forces uiScope true
writeFileSync(join(kilnDir, 'design', 'tokens.json'), '{}\n')
writeFileSync(join(kilnDir, 'docs', 'VISION.md'), '# VISION\n')
writeFileSync(join(kilnDir, 'master-plan.md'), '# master plan\n')
writeFileSync(join(kilnDir, 'law.json'), JSON.stringify({ schema: 1, lock_commit: null, checks: [] }) + '\n')

const argusResult = {
  reasoning: 'stub', report_file: join(kilnDir, 'validation', 'report.md'), product_type: 'web',
  install_ok: true, law_run_exit: 0, suite_cmd: 'true', suite_exit: 0, tests_passed: 1, tests_failed: 0,
  run_id: 'kval-stub', verification_class_full: true,
  criteria: [{ id: 'SC-1', met: true, critical: true, browser_only: true, note: 'ui' }],
  ui_scope: true, missing_creds: false, coverage_gaps: [], blocking_findings: [], correction_tasks: [],
}

// pull the exact `node …` command out of a fenced ``` block in a sentinel prompt and run it as Bash.
function runEmbeddedCommand(prompt) {
  const m = prompt.match(/```\n(node [^\n]+)\n```/)
  if (!m) return null
  return spawnSync('bash', ['-c', m[1]], { encoding: 'utf8' })
}

// the VALIDATE_RUN_TOKEN is minted inside the workflow; we recover it from the lease-take command line.
let validateToken = null
let probeExit = null
// the over-deadline probe runs in the background (the workflow's withDeadline discards a slow traversal
// agent at the cap, but the thunk keeps running — exactly like a real evaluator process that outlives
// the workflow's await). We expose its completion as a promise the runner AWAITS before reporting, so
// the assertion is deterministic, never racing process.exit.
let overDeadlineProbe = Promise.resolve()

const agent = async (prompt, opts) => {
  const label = (opts && opts.label) || ''
  if (label === 'sentinel:lease-take') {
    const r = runEmbeddedCommand(prompt)
    const tm = (r && r.stdout || '').match(/^LEASE (\S+) /m)
    if (tm) validateToken = tm[1]
    return { reasoning: 'took lease', summary: (r && r.stdout) || '' }
  }
  if (label === 'sentinel:lease-release' || label.startsWith('sentinel:sweep')) {
    runEmbeddedCommand(prompt)
    return { reasoning: 'cleaned', summary: 'ok' }
  }
  if (label.startsWith('argus:traversal')) {
    // THE DRILL: the evaluator outlives the cap (sleeps past the lease window), then fires a REAL
    // kiln-probe run under the leased token. The lease has expired, so the probe must be REFUSED
    // (exit 77) — an over-deadline evaluator can do no further browser work. The workflow's
    // withDeadline races this and folds the pass static-only at the cap; this thunk keeps running in
    // the background just like the real (separate-process) evaluator would. We never block the
    // workflow on the probe — overDeadlineProbe resolves it for the runner to await afterward.
    overDeadlineProbe = (async () => {
      await new Promise((r) => setTimeout(r, Number(process.env.KILN_TEST_OVERRUN_MS) || 1500))
      const runId = `${validateToken}-late`
      const r = spawnSync(process.execPath, [
        join(pluginRoot, 'scripts', 'kiln-probe.mjs'), 'run', projectPath, kilnDir, 'SC-001', runId, '--lease', validateToken,
      ], { encoding: 'utf8', env: { ...process.env, KILN_FAKE_PW_MODE: 'pass' } })
      probeExit = r.status
    })()
    await overDeadlineProbe
    // the evaluator honestly degrades: its only browser path was refused, so nothing was confirmed live
    return { reasoning: 'probe refused — lease expired', tool: 'kiln-probe', browser_result: 'static-only', criteria: [], findings: [] }
  }
  if (label === 'hephaestus:detect') return { design_present: true }
  if (label === 'argus:validate') return argusResult
  if (label.startsWith('aristotle:goal')) return { reasoning: 'stub', overall: 'pass', findings: [], report_file: 'x' }
  if (label === 'zoxea:arch-check') return { reasoning: 'stub', check_file: 'x', drift: [], seam_issues: [], blocking: [], summary: 'ok' }
  if (label === 'thoth:ledger') return { reasoning: 'noop', summary: 'no events.jsonl — skipped' }
  return null
}

const stubs = {
  args: { kilnDir, projectPath, codexAvailable: false, testingRigor: 'standard', designPresent: true, pluginRoot },
  phase: () => {},
  log: () => {},
  agent,
  parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
  pipeline: async () => [],
  budget: undefined,
  workflow: async () => null,
}

const GLOBALS = Object.keys(stubs)
const body = readFileSync(file, 'utf8').replace(/^export const meta\b/m, 'const meta')
const AsyncFunction = (async () => {}).constructor

try {
  const run = new AsyncFunction(...GLOBALS, body)
  const result = await run(...GLOBALS.map((k) => stubs[k]))
  await overDeadlineProbe // ensure the background over-deadline probe attempt has completed before reporting
  process.stdout.write('RESULT ' + JSON.stringify(result || null) + '\n')
  process.stdout.write('PROBE_EXIT ' + (probeExit === null ? 'none' : probeExit) + '\n')
  // belt: never leak the lease watchdog or a fixture browser from the harness
  if (validateToken) spawnSync(process.execPath, [join(pluginRoot, 'scripts', 'kiln-probe.mjs'), 'lease-release', kilnDir, validateToken], { stdio: 'ignore' })
  process.exit(0)
} catch (e) {
  process.stdout.write(JSON.stringify({ name: (e && e.name) || 'unknown', message: (e && e.message) || String(e) }) + '\n')
  process.exit(1)
}
