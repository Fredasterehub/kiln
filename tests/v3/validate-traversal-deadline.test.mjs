// validate-traversal-deadline.test.mjs — proves the Tier-2 traversal ≤10-min cap is a
// WORKFLOW-ENFORCED deadline (a real in-process timer in the SHIPPED workflows/validate.js), not the
// prompt's goodwill. The reviewer's high finding: the traversal ran as a plain `await agent(...)` so a
// hung evaluator (a wedged MCP retry-loop, a stuck codex subprocess) could run past the cap with only
// prose to stop it. The fix wraps each pass in withDeadline(); this test exercises the real path.
//
// Method: a child runner loads the generated validate.js and supplies an `agent` stub that HANGS
// FOREVER on the traversal leg (a setTimeout-backed promise — a macrotask await, exactly like real
// wedged I/O, so the in-process timer is the only thing that can end it) while reporting a clean UI-scope
// deterministic floor. KILN_VALIDATE_TRAVERSAL_MS is set tiny. A correctly-wired deadline fires
// in-process, the pass folds static-only, and the workflow RESOLVES with a PARTIAL/static-only verdict.
// The parent imposes a hard SIGKILL deadline far longer than the in-process one — if the workflow
// deadline were prompt-text only, the hung traversal would never return and the child would be SIGKILLed,
// which the test reads as a FAILURE (timedOut). So this test fails both ways: a missing deadline hangs
// (parent SIGKILL), and a deadline that wrongly poisoned the verdict (e.g. logged a blocking finding →
// FAILED instead of PARTIAL) shows up in the asserted verdict.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const GENERATED = join(root, 'plugins/kiln/workflows/validate.js')
const RUNNER = fileURLToPath(new URL('./validate-traversal-deadline-runner.mjs', import.meta.url))

test('validate.js Tier-2 traversal: a hung evaluator is hard-stopped by the WORKFLOW deadline (not prompt text) — the workflow resolves, the pass folds static-only, the verdict caps at PARTIAL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-traversal-deadline-'))
  try {
    // In-process deadline 300ms; parent SIGKILL net at 15s. If the workflow honors its own timer the
    // child resolves in well under a second; only a MISSING workflow deadline reaches the parent kill.
    const res = spawnSync(process.execPath, [RUNNER, GENERATED, dir], {
      encoding: 'utf8', timeout: 15_000, killSignal: 'SIGKILL',
      env: { ...process.env, KILN_VALIDATE_TRAVERSAL_MS: '300' },
    })
    const timedOut = (res.error && res.error.code === 'ETIMEDOUT') || res.signal === 'SIGKILL'
    assert.ok(!timedOut,
      'the hung traversal must be ended by the IN-PROCESS workflow deadline — a parent SIGKILL means the cap was prompt-text only (the exact REJECT finding)')
    assert.equal(res.status, 0, `the workflow must resolve cleanly: ${res.stdout}\n${res.stderr}`)
    const line = (res.stdout || '').split('\n').filter(Boolean).find((l) => l.startsWith('RESULT '))
    assert.ok(line, `expected a RESULT line, got: ${res.stdout}`)
    const verdict = JSON.parse(line.slice('RESULT '.length))
    assert.ok(verdict && typeof verdict === 'object', 'the workflow returned a verdict object')
    // a UI scope whose only browser evidence is a deadlined (→ static-only) traversal caps at PARTIAL —
    // honestly degraded, never PASS, and (critically) never FAILED: a deadline is unproven, not broken.
    assert.equal(verdict.verdict, 'VALIDATE_PARTIAL',
      `a deadlined UI traversal must cap at PARTIAL (static-only), got ${verdict.verdict}: ${JSON.stringify(verdict)}`)
    assert.equal(verdict.verification_class, 'static-only', 'verification_class is recorded as static-only end-to-end')
    assert.equal(verdict.browser_verdict, 'PARTIAL_PASS_STATIC_ONLY', 'browser_verdict reflects the honest degradation')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
