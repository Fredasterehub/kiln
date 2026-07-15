// validate-traversal-deadline-runner.mjs — child executor that drives the SHIPPED workflows/validate.js
// to prove the §7 Tier-2 traversal deadline is WORKFLOW-ENFORCED (a real in-process timer), not prompt
// text. Spawned by validate-traversal-deadline.test.mjs (never the test runner directly — no .test. in
// the name, and index.js does not import it). It loads the generated validate.js exactly as the Workflow
// engine would (strip `export const meta`, wrap the body in an AsyncFunction whose params are the
// workflow globals) and supplies stubs that:
//   • make argus return a UI-scope result (ui_scope:true) so The Traversal phase runs;
//   • make the traversal agent (label argus:traversal*) HANG FOREVER on a setTimeout-backed promise —
//     a macrotask await, exactly like a real wedged MCP/codex traversal (NOT a microtask spin), so the
//     in-process withDeadline timer is the ONLY thing that can end it;
//   • resolve every other agent to a benign object.
// With KILN_VALIDATE_TRAVERSAL_MS tiny, a correctly-wired workflow deadline fires, the pass folds
// static-only, and the script RESOLVES with a verdict. If the deadline were prompt-text only, the hung
// traversal would never return and this child would have to be SIGKILLed by the parent — which the test
// reads as a failure. The returned verdict object is printed as one JSON line on stdout (RESULT <json>).
//
// Exit contract: 0 + a `RESULT <json>` line on a clean resolve; 1 + `{"name","message"}` on any throw.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [file, dir] = process.argv.slice(2)
if (!file || !dir) { process.stderr.write('usage: node validate-traversal-deadline-runner.mjs <generated-validate.js> <sandbox-dir>\n'); process.exit(2) }

const kilnDir = join(dir, '.kiln')
mkdirSync(join(kilnDir, 'docs'), { recursive: true })
mkdirSync(join(kilnDir, 'design'), { recursive: true }) // a design/ dir forces uiScope true belt-and-suspenders
writeFileSync(join(kilnDir, 'design', 'tokens.json'), '{}\n')
writeFileSync(join(kilnDir, 'docs', 'VISION.md'), '# VISION\n')
writeFileSync(join(kilnDir, 'master-plan.md'), '# master plan\n')
writeFileSync(join(kilnDir, 'law.json'), JSON.stringify({ schema: 1, lock_commit: 'x', checks: [] }) + '\n')

const HANG = new Promise(() => { setInterval(() => {}, 60_000) }) // macrotask-backed, never resolves

// argus must report a UI scope + a clean deterministic floor so the verdict's only open question is the
// browser path — which the hung-then-deadlined traversal can only leave static-only.
const argusResult = {
  reasoning: 'stub', report_file: join(kilnDir, 'validation', 'report.md'), product_type: 'web',
  install_ok: true, law_run_exit: 0, suite_cmd: 'true', suite_exit: 0, tests_passed: 1, tests_failed: 0,
  run_id: 'kval-stub', verification_class_full: true,
  criteria: [{ id: 'SC-1', met: true, critical: true, browser_only: true, note: 'ui' }],
  ui_scope: true, missing_creds: false, coverage_gaps: [], blocking_findings: [], correction_tasks: [],
}

function makeStubs() {
  return {
    args: { kilnDir, projectPath: dir, codexAvailable: false, testingRigor: 'standard', designPresent: true, pluginRoot: null },
    phase: () => {},
    log: () => {},
    agent: async (_prompt, opts) => {
      const label = (opts && opts.label) || ''
      if (label.startsWith('argus:traversal')) return HANG // the traversal evaluator wedges
      if (label === 'hephaestus:detect') return { design_present: true }
      if (label === 'argus:validate') return argusResult
      if (label.startsWith('aristotle:goal')) return { reasoning: 'stub', overall: 'pass', findings: [], report_file: 'x' }
      if (label === 'zoxea:arch-check') return { reasoning: 'stub', check_file: 'x', drift: [], seam_issues: [], blocking: [], summary: 'ok' }
      return null
    },
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async () => [],
    budget: undefined,
    workflow: async () => null,
  }
}

const stubs = makeStubs()
const GLOBALS = Object.keys(stubs)
const body = readFileSync(file, 'utf8').replace(/^export const meta\b/m, 'const meta')
const AsyncFunction = (async () => {}).constructor

try {
  const run = new AsyncFunction(...GLOBALS, body)
  const result = await run(...GLOBALS.map((k) => stubs[k]))
  process.stdout.write('RESULT ' + JSON.stringify(result || null) + '\n')
  process.exit(0)
} catch (e) {
  process.stdout.write(JSON.stringify({ name: (e && e.name) || 'unknown', message: (e && e.message) || String(e) }) + '\n')
  process.exit(1)
}
