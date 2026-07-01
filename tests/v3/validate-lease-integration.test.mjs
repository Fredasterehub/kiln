// validate-lease-integration.test.mjs — the §7 CAPABILITY-deadline integration drill (ORCHESTRATOR
// RULING, p3/tasks.md): the extended validate deadline drill proving an OVER-DEADLINE evaluator's
// subsequent kiln-probe attempt is REFUSED. The reviewer's MAJOR on T3: withDeadline() resolves a
// timeout sentinel but cannot CANCEL the live evaluator, so over-deadline browser work could outlive
// the stage. The fix enforces the deadline on the CAPABILITY: the workflow takes a real kiln-probe
// browser lease before the traversal, and every probe REFUSES (exit 77) once the lease expires.
//
// Method: a child runner drives the SHIPPED workflows/validate.js with a REAL pluginRoot (so
// leaseTake/leaseRelease run the actual kiln-probe CLI) over a fake-playwright fixture. Its traversal
// stub OUTLIVES the cap (sleeps past the lease window) and then fires a real `kiln-probe run --lease
// <VALIDATE_RUN_TOKEN>` — exactly the over-deadline browser attempt the reviewer flagged. The lease has
// expired, so the probe is REFUSED with exit 77, which the runner prints as `PROBE_EXIT 77`. The
// workflow's withDeadline still folds the pass static-only at the cap, so the verdict caps at PARTIAL.
// This is the end-to-end proof that the capability deadline — not prompt goodwill, not an un-cancelable
// agent — bounds the browser. (The probe-level lease lifecycle is unit-drilled in probe.test.mjs.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const GENERATED = join(root, 'plugins/kiln/workflows/validate.js')
const PLUGIN_ROOT = join(root, 'plugins/kiln')
const RUNNER = fileURLToPath(new URL('./validate-lease-integration-runner.mjs', import.meta.url))

// the fake playwright (mirrors probe.test.mjs) so the fixture probe could launch IF it were allowed —
// the point is that the LEASE refuses it before it ever launches, not that playwright is absent.
// Mirrors the real contract (probe-template post-0f09fbd): launchPersistentContext(dir, opts).
const FAKE_PLAYWRIGHT = `'use strict'
const { writeFileSync, mkdirSync } = require('fs')
module.exports = { chromium: { async launchPersistentContext(dir, opts) {
  mkdirSync(dir, { recursive: true })
  const locator = { first(){return this}, async waitFor(){}, async click(){}, async fill(){}, async press(){} }
  const page = { setDefaultTimeout(){}, on(){}, async goto(){return {status:()=>200}}, getByRole(){return locator}, keyboard:{async press(){}}, async addScriptTag(){}, async evaluate(){return []}, async screenshot({path}){writeFileSync(path,'FAKEPNG')} }
  return { pages(){return [page]}, async newPage(){return page}, async close(){} }
} } }
`

function makeProject() {
  const proj = mkdtempSync(join(tmpdir(), 'kiln-lease-int-'))
  mkdirSync(join(proj, 'tests/acceptance'), { recursive: true })
  writeFileSync(join(proj, 'index.html'), '<!doctype html><html><body><h1>Hello Kiln</h1></body></html>\n')
  const spec = { url: '/', landmarks: [{ role: 'heading', name: 'Hello Kiln' }] }
  writeFileSync(join(proj, 'tests/acceptance/sc-001.probe.json'), JSON.stringify(spec, null, 2) + '\n')
  const pwDir = join(proj, 'node_modules', 'playwright')
  mkdirSync(pwDir, { recursive: true })
  writeFileSync(join(pwDir, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0-kiln-fake', main: 'index.js' }) + '\n')
  writeFileSync(join(pwDir, 'index.js'), FAKE_PLAYWRIGHT)
  return proj
}

test('validate.js Tier-2 capability deadline: a real lease is taken; an OVER-DEADLINE evaluator\'s kiln-probe attempt is REFUSED (exit 77 LEASE_EXPIRED), the verdict caps at PARTIAL/static-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-lease-int-kiln-'))
  const proj = makeProject()
  try {
    // lease window 1s (KILN_VALIDATE_TRAVERSAL_MS=1000 ⇒ ceil → 1s); the traversal stub overruns to 2s,
    // so its probe fires AFTER the lease has expired. Parent SIGKILL net at 30s.
    const res = spawnSync(process.execPath, [RUNNER, GENERATED, dir, PLUGIN_ROOT, proj], {
      encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
      env: { ...process.env, KILN_VALIDATE_TRAVERSAL_MS: '1000', KILN_TEST_OVERRUN_MS: '2000', KILN_FAKE_PW_MODE: 'pass' },
    })
    const timedOut = (res.error && res.error.code === 'ETIMEDOUT') || res.signal === 'SIGKILL'
    assert.ok(!timedOut, `the workflow must resolve, not hang: ${res.stdout}\n${res.stderr}`)
    assert.equal(res.status, 0, `the workflow must resolve cleanly: ${res.stdout}\n${res.stderr}`)
    const lines = (res.stdout || '').split('\n').filter(Boolean)
    const probeLine = lines.find((l) => l.startsWith('PROBE_EXIT '))
    assert.ok(probeLine, `expected a PROBE_EXIT line, got: ${res.stdout}`)
    assert.equal(probeLine, 'PROBE_EXIT 77',
      `the over-deadline kiln-probe attempt MUST be refused with exit 77 (LEASE_EXPIRED) — the capability deadline, not an un-cancelable agent. Got: ${probeLine}`)
    const resultLine = lines.find((l) => l.startsWith('RESULT '))
    assert.ok(resultLine, `expected a RESULT line, got: ${res.stdout}`)
    const verdict = JSON.parse(resultLine.slice('RESULT '.length))
    assert.equal(verdict.verdict, 'VALIDATE_PARTIAL',
      `a UI scope whose traversal could not establish a clean browser pass caps at PARTIAL: ${JSON.stringify(verdict)}`)
    assert.equal(verdict.verification_class, 'static-only', 'verification_class is static-only end-to-end')
    assert.equal(verdict.browser_verdict, 'PARTIAL_PASS_STATIC_ONLY', 'browser_verdict reflects the honest degradation')
  } finally {
    // belt: never leak a lease watchdog or fixture browser from the harness
    spawnSync('pkill', ['-9', '-f', 'kiln-pw-kval'], { stdio: 'ignore' })
    rmSync(dir, { recursive: true, force: true })
    rmSync(proj, { recursive: true, force: true })
  }
})
