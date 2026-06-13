#!/usr/bin/env node
// probe-template.mjs — the canonical Tier-1 one-shot browser probe (BLUEPRINT §7; the discipline
// spec's launch→assert→close shape). Zero npm dependencies IN KILN: playwright is the USER'S
// capability — resolved from the project's node_modules, then the invoking cwd, then the global
// npm root; never installed, absence degrades honestly (exit 78). THE LAW OF THIS PHASE: the
// browser is a subprocess with a deadline, never a service — this script is that subprocess. It
// is spawned by kiln-probe.mjs under hard-kill timeout semantics, does ALL its work in a single
// process (launch → assert → close), and its `finally { browser.close() }` plus the wrapper's
// token sweep make leaks structurally impossible (every 2026 leak bug requires a long-lived
// holder process; there is none here).
//
// Usage (internal — kiln-probe.mjs is the caller):
//   probe-template.mjs <projectPath> <specFile> <baseUrl> <evidenceDir> <prefix> <token>
//
//   projectPath — playwright/axe-core resolution root (the USER's install)
//   specFile    — the §7 probe spec JSON (url, landmarks, interactions, viewports — written by
//                 kiln-probe from law.json's locked spec; this script never reads law.json)
//   baseUrl     — where the app is served (kiln-probe owns the server lifecycle, not this script)
//   evidenceDir — screenshots land here as <prefix>-<W>x<H>.png
//   token       — the unique kill token, already kiln-pw- namespaced (kiln-pw-<run>-<SC>-<rand>):
//                 chromium launches with --user-data-dir=/tmp/<token> so `pkill -f <token>` can
//                 sweep every browser process this spawn created, and ONLY those (never the
//                 operator's browser — blanket pkill is forbidden). The token also sits in THIS
//                 process's argv, so a template orphaned by the wrapper's hard kill matches the
//                 same sweep and dies with its browsers
//
// Assertion set, in the §7 priority order: doc loads <400 with no nav timeout → key roles
// visible (role+name, never CSS) → slice-specific interaction asserts → 0 console errors →
// 0 first-party 4xx/5xx → axe-core critical/serious = 0 (ONLY if axe-core is resolvable, else
// axe:"skipped" — honestly degraded, never silently green) → screenshot per viewport.
//
// Output: one machine-readable `PROBE_RESULT {json}` line on stdout (kiln-probe persists it
// into probe-<SC>.json), human-readable PASS/FAIL lines per assertion class around it.
// Exit codes: 0 every assertion passed · 1 any failure (assert or infra) · 78 PROBE_UNAVAILABLE
// (playwright not resolvable — the capability tier, not an error).

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const NAV_TIMEOUT_MS = 15000 // §7 hard bound: nav timeout 15 s
const ACTION_TIMEOUT_MS = 5000 // §7 hard bound: action timeout 5 s

const [projectPath, specFile, baseUrl, evidenceDir, prefix, token] = process.argv.slice(2)
if (!projectPath || !specFile || !baseUrl || !evidenceDir || !prefix || !token) {
  console.error('usage: probe-template.mjs <projectPath> <specFile> <baseUrl> <evidenceDir> <prefix> <token>')
  process.exit(1)
}

// resolveUser(name) — resolve one of the USER's packages: project node_modules first (the §7
// contract), then the invoking cwd, then the global npm root (best-effort — a missing npm binary
// just skips the global arm). Returns a require() bound to wherever it resolved, or null.
function resolveUser(name) {
  const bases = [join(projectPath, 'noop.js'), join(process.cwd(), 'noop.js')]
  try { bases.push(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 10000 }).trim(), 'noop.js')) } catch { /* no npm — global arm skipped */ }
  for (const base of bases) {
    try { const req = createRequire(base); req.resolve(name); return req } catch { /* next base */ }
  }
  return null
}

const pwRequire = resolveUser('playwright')
if (!pwRequire) {
  console.log('PROBE_UNAVAILABLE playwright is not resolvable from the project node_modules, cwd, or the global npm root — Tier-1 probe cannot run (capability tier, not an error)')
  process.exit(78)
}
const { chromium } = pwRequire('playwright')

let spec
try { spec = JSON.parse(readFileSync(specFile, 'utf8')) } catch (e) {
  console.error(`probe-template: cannot read spec ${specFile} — ${e.message}`)
  process.exit(1)
}
const viewports = (Array.isArray(spec.viewports) && spec.viewports.length) ? spec.viewports : [{ width: 1440, height: 900 }]
const landmarks = Array.isArray(spec.landmarks) ? spec.landmarks : []
const interactions = Array.isArray(spec.interactions) ? spec.interactions : []
const url = baseUrl.replace(/\/$/, '') + spec.url

const failures = [] // every entry is one human-readable failed assertion
const consoleErrors = []
const failedRequests = []
const screenshots = []
let landmarksChecked = 0
let interactionsRun = 0
let axe = 'skipped'

// Per-viewport persistent context: the user-data-dir is a reserved Playwright concern, so it is
// passed as the launchPersistentContext() positional arg (NOT a --user-data-dir launch flag, which
// modern Playwright rejects). The token still lands in the chromium process cmdline via that dir
// path, so the sweep keys on it — targeted, never blanket. One dir per viewport (a profile cannot be
// shared by two live contexts), token-prefixed so every spawned browser dies with `pkill -f <token>`.
const contexts = []
try {
  for (const [vi, vp] of viewports.entries()) {
    const tag = `${vp.width}x${vp.height}`
    const context = await chromium.launchPersistentContext(`/tmp/${token}-${vi}`, {
      headless: true,
      viewport: { width: vp.width, height: vp.height },
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--mute-audio', '--no-first-run'],
    })
    contexts.push(context)
    const page = context.pages()[0] ?? await context.newPage()
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${tag}] ${msg.text()}`) })
    page.on('response', (res) => {
      // first-party only: the served app's own resources — third-party noise is not the slice's failure
      if (res.status() >= 400 && res.url().startsWith(baseUrl)) failedRequests.push(`[${tag}] ${res.status()} ${res.url()}`)
    })

    // 1. doc loads <400, no nav timeout
    let navOk = false
    try {
      const resp = await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'load' })
      if (!resp) failures.push(`[${tag}] nav: no response from ${url}`)
      else if (resp.status() >= 400) failures.push(`[${tag}] nav: ${url} answered ${resp.status()}`)
      else navOk = true
    } catch (e) { failures.push(`[${tag}] nav: ${url} failed — ${e.message.split('\n')[0]}`) }

    if (navOk) {
      // 2. key roles visible — role+name from the SC text, never CSS
      for (const lm of landmarks) {
        landmarksChecked++
        try { await page.getByRole(lm.role, { name: lm.name }).first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }) } catch {
          failures.push(`[${tag}] landmark not visible: role=${lm.role} name=${JSON.stringify(lm.name)}`)
        }
      }
      // 3. slice-specific interaction asserts, in user order
      for (const [si, step] of interactions.entries()) {
        interactionsRun++
        const what = `interaction ${si + 1} (${step.action}${step.name ? ` ${JSON.stringify(step.name)}` : step.key ? ` ${step.key}` : ''})`
        try {
          if (step.action === 'click') await page.getByRole(step.role, { name: step.name }).first().click({ timeout: ACTION_TIMEOUT_MS })
          else if (step.action === 'fill') await page.getByRole(step.role, { name: step.name }).first().fill(step.value, { timeout: ACTION_TIMEOUT_MS })
          else if (step.action === 'press') {
            if (step.role && step.name) await page.getByRole(step.role, { name: step.name }).first().press(step.key, { timeout: ACTION_TIMEOUT_MS })
            else await page.keyboard.press(step.key)
          } else if (step.action === 'expect') await page.getByRole(step.role, { name: step.name }).first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
          else failures.push(`[${tag}] ${what}: unknown action`)
        } catch (e) { failures.push(`[${tag}] ${what} failed — ${e.message.split('\n')[0]}`) }
      }
      // 6. axe-core critical/serious — ONLY if the user has axe-core; degraded is 'skipped', never green
      if (vi === 0) {
        const axeRequire = resolveUser('axe-core')
        if (axeRequire) {
          try {
            await page.addScriptTag({ content: readFileSync(axeRequire.resolve('axe-core'), 'utf8') })
            const violations = await page.evaluate(async () => {
              const r = await window.axe.run(document, { resultTypes: ['violations'] })
              return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.impact})`)
            })
            if (violations.length) { axe = 'failed'; failures.push(`[${tag}] axe-core critical/serious violations: ${violations.join(', ')}`) } else axe = 'passed'
          } catch (e) { axe = 'skipped'; console.log(`AXE skipped — injection failed: ${e.message.split('\n')[0]}`) }
        }
      }
      // 7. screenshot evidence, one per viewport
      const shot = join(evidenceDir, `${prefix}-${tag}.png`)
      try { await page.screenshot({ path: shot, fullPage: false }); screenshots.push(shot) } catch (e) {
        failures.push(`[${tag}] screenshot failed — ${e.message.split('\n')[0]}`)
      }
    }
    await context.close()
  }
} catch (e) {
  failures.push(`infra: ${e.message.split('\n')[0]}`)
} finally {
  // the discipline-spec lifecycle: the browser NEVER outlives the check that spawned it
  for (const context of contexts) { try { await context.close() } catch { /* the wrapper's token sweep is the backstop */ } }
}

// 4 + 5. zero console errors, zero first-party 4xx/5xx — collected across all viewports
for (const c of consoleErrors) failures.push(`console error: ${c}`)
for (const r of failedRequests) failures.push(`first-party request failed: ${r}`)

for (const f of failures) console.log(`FAIL ${f}`)
console.log(`PROBE_RESULT ${JSON.stringify({
  ok: failures.length === 0,
  failures,
  console_errors: consoleErrors.length,
  failed_requests: failedRequests.length,
  landmarks_checked: landmarksChecked,
  interactions_run: interactionsRun,
  axe,
  screenshots,
  viewports: viewports.map((v) => `${v.width}x${v.height}`),
})}`)
process.exit(failures.length ? 1 : 0)
