// probe.test.mjs — P3 T1 acceptance: Tier-1 probe infrastructure (BLUEPRINT §7; the discipline
// spec's RECOMMENDED DISCIPLINE SPEC is contract-grade). THE LAW OF THIS PHASE: the browser is a
// subprocess with a deadline, never a service. Four floors in one file:
//   1. The probe spec contract — validateLaw's `spec` arm (mirrors schemas/law.schema.json):
//      spec only on kind 'probe', url/landmarks/interactions/viewports/serve shapes, the
//      serve_cmd⇄base_url pairing, serve_dir rules.
//   2. kiln-probe lifecycle with a FAKE playwright — a fixture node module standing in for the
//      real package (resolved from the project's node_modules exactly like a user install), so
//      the harness needs no chromium. The fake spawns a REAL decoy OS process carrying the kill
//      token (simulating a leaked browser) and creates the profile dir from the launch args —
//      the drills prove launch-contract args, evidence writing, exit-code mapping (0/1/78/79),
//      timeout hard-kill, and that the token sweep ALWAYS reaps the decoy and the profile dir,
//      pass and fail and timeout alike. Leak-proof is asserted, not assumed.
//   3. kiln-law run integration — kind:'probe' checks execute via kiln-probe with the same
//      results.jsonl evidence contract; exit 78 folds DEFERRED (probe_unavailable — never
//      green); spec-less templates and --skip-probes still defer (probe_deferred); any deferral
//      marks verification_class: static-only in the finalized run.json (and a VERIFICATION_CLASS
//      stdout line); an outer-timeout-killed probe is swept by runId; stage-level sweeps bracket
//      every probe-executing run, each scoped BY TOKEN (BLUEPRINT §7: never blanket) — pre-flight
//      scoped to the stage's --run-prefix (else the run's own full runId) BEFORE any probe spawns,
//      runId-scoped end sweep on EVERY exit path (gate-failed exits included) — so a concurrent
//      Kiln run under a different prefix is NEVER reaped, and a run with no executable probe fires
//      no sweep at all.
//   4. Real-playwright integration smoke — SKIPPED cleanly when playwright is absent (detected,
//      logged via the skip message, never failed): the capability tier, not an error.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateLaw } from '../../plugins/kiln/src/law.mjs'

const PROBE_CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-probe.mjs', import.meta.url))
const LAW_CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-law.mjs', import.meta.url))

// ── 1. the probe spec contract (validateLaw mirrors schemas/law.schema.json) ────────────────────
const baseSpec = (over = {}) => ({ url: '/', landmarks: [{ role: 'heading', name: 'Hello Kiln' }], ...over })
const probeCheck = (over = {}) => ({
  id: 'SC-001', milestone: 'M1', kind: 'probe', cmd: '', files: ['tests/acceptance/sc-001.probe.json'],
  sha256: {}, expected: 'exit0', timeout_s: 120, spec: baseSpec(), ...over,
})
const lawOf = (...checks) => ({ schema: 1, lock_commit: null, checks })

test('probe spec: a minimal spec and a full spec (interactions, viewports, serve pair) both validate', () => {
  assert.deepEqual(validateLaw(lawOf(probeCheck())), { ok: true, errors: [] })
  const full = probeCheck({
    spec: baseSpec({
      interactions: [
        { action: 'click', role: 'button', name: 'Add' },
        { action: 'fill', role: 'textbox', name: 'Title', value: 'milk' },
        { action: 'press', key: 'Enter' },
        { action: 'expect', role: 'listitem', name: 'milk' },
      ],
      viewports: [{ width: 1440, height: 900 }, { width: 390, height: 844 }],
      serve_cmd: 'npm start', base_url: 'http://127.0.0.1:3000',
    }),
  })
  assert.deepEqual(validateLaw(lawOf(full)), { ok: true, errors: [] })
  // serve_dir is the static-server alternative to serve_cmd
  assert.equal(validateLaw(lawOf(probeCheck({ spec: baseSpec({ serve_dir: 'dist' }) }))).ok, true)
})

test('probe spec: spec is legal ONLY on kind probe; a spec-less probe stays a valid template', () => {
  const onShell = { ...probeCheck({ kind: 'shell', cmd: 'true', files: ['tests/acceptance/sc-001.sh'] }) }
  const res = validateLaw(lawOf(onShell))
  assert.equal(res.ok, false)
  assert.ok(res.errors.some((e) => /spec is legal only on kind 'probe'/.test(e.message)))
  const template = probeCheck()
  delete template.spec
  assert.equal(validateLaw(lawOf(template)).ok, true, 'an un-instantiated template (no spec) is legal — the runner defers it')
})

test('probe spec: url and landmarks are required and shaped — role+name, never CSS-ish emptiness', () => {
  const cases = [
    [baseSpec({ url: undefined }), 'missing url'],
    [baseSpec({ url: 'index.html' }), 'url without leading /'],
    [baseSpec({ landmarks: [] }), 'empty landmarks'],
    [baseSpec({ landmarks: [{ role: 'button' }] }), 'landmark missing name'],
    [baseSpec({ landmarks: [{ role: '', name: 'x' }] }), 'landmark empty role'],
    [baseSpec({ landmarks: [{ role: 'button', name: 'x', css: '#a' }] }), 'unknown landmark key'],
    [baseSpec({ bogus: 1 }), 'unknown spec key'],
    ['not-an-object', 'spec not an object'],
  ]
  for (const [spec, why] of cases) assert.equal(validateLaw(lawOf(probeCheck({ spec }))).ok, false, why)
})

test('probe spec: interaction steps carry action-specific requireds; viewports are positive integers', () => {
  const bad = [
    [[{ action: 'hover', role: 'button', name: 'x' }], 'unknown action'],
    [[{ action: 'click', role: 'button' }], 'click without name'],
    [[{ action: 'expect', name: 'x' }], 'expect without role'],
    [[{ action: 'fill', role: 'textbox', name: 'T' }], 'fill without value'],
    [[{ action: 'press' }], 'press without key'],
    [[{ action: 'click', role: 'button', name: 'x', selector: '#a' }], 'unknown interaction key'],
  ]
  for (const [interactions, why] of bad) assert.equal(validateLaw(lawOf(probeCheck({ spec: baseSpec({ interactions }) }))).ok, false, why)
  for (const viewports of [[], [{ width: 0, height: 900 }], [{ width: 1440 }], [{ width: 1440, height: 900, dpi: 2 }]]) {
    assert.equal(validateLaw(lawOf(probeCheck({ spec: baseSpec({ viewports }) }))).ok, false, JSON.stringify(viewports))
  }
})

test('probe spec: serve_cmd⇄base_url pair, and serve_dir only without serve_cmd', () => {
  const cases = [
    [baseSpec({ serve_cmd: 'npm start' }), 'serve_cmd without base_url'],
    [baseSpec({ base_url: 'http://127.0.0.1:3000' }), 'base_url without serve_cmd'],
    [baseSpec({ serve_cmd: 'npm start', base_url: 'ftp://x' }), 'non-http base_url'],
    [baseSpec({ serve_cmd: '', base_url: 'http://127.0.0.1:3000' }), 'empty serve_cmd'],
    [baseSpec({ serve_cmd: 'npm start', base_url: 'http://127.0.0.1:3000', serve_dir: 'dist' }), 'serve_dir with serve_cmd'],
    [baseSpec({ serve_dir: '/abs' }), 'absolute serve_dir'],
    [baseSpec({ serve_dir: '../out' }), 'escaping serve_dir'],
  ]
  for (const [spec, why] of cases) assert.equal(validateLaw(lawOf(probeCheck({ spec }))).ok, false, why)
})

// ── shared fixture machinery ─────────────────────────────────────────────────────────────────────
const probeCli = (args, env = {}) => spawnSync(process.execPath, [PROBE_CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
const lawCli = (args, env = {}) => spawnSync(process.execPath, [LAW_CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
const pgrepf = (pattern) => (spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean)
// leaderCmdlineLive(pid) — truthy iff <pid> is a live process (readable, non-empty /proc cmdline; a
// dead/zombie process has neither). Per-PID liveness for the mcp-sweep drill, where several decoys share
// argv0/path shapes and only their exact PIDs distinguish them.
const leaderCmdlineLive = (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+$/, '') !== '' } catch { return false } }

// The FAKE playwright — a CJS module the probe-template resolves from the project's
// node_modules exactly like a user install. Modes via KILN_FAKE_PW_MODE:
//   pass      — every assertion succeeds; screenshot writes a stub file
//   fail-role — locator.waitFor throws (landmark invisible)
//   hang      — launchPersistentContext() never resolves (the timeout-kill drill)
// Mirrors the REAL call contract (probe-template post-0f09fbd, Playwright ≥1.59):
// launchPersistentContext(dir, opts) — the user-data-dir is the POSITIONAL arg, never a
// --user-data-dir launch flag (modern Playwright rejects the flag; the operator's field fix).
// Every launch ALWAYS: records {dir, ...opts} to KILN_FAKE_PW_LOG (when set), creates the real
// profile dir, and spawns a detached REAL decoy process whose cmdline carries the dir path (and
// so the kiln-pw token — exactly as real chromium's cmdline carries the profile path) — a
// stand-in for a leaked browser process that ONLY the token sweep can reap. The decoy is a node
// sleeper with dir+args as a trailing argv entry (bash -c would exec-optimize and DROP them —
// verified).
const FAKE_PLAYWRIGHT = `'use strict'
const { spawn } = require('child_process')
const { writeFileSync, mkdirSync } = require('fs')
const MODE = process.env.KILN_FAKE_PW_MODE || 'pass'
module.exports = {
  chromium: {
    async launchPersistentContext(dir, opts) {
      const args = (opts && opts.args) || []
      if (process.env.KILN_FAKE_PW_LOG) writeFileSync(process.env.KILN_FAKE_PW_LOG, JSON.stringify({ dir, ...opts }))
      mkdirSync(dir, { recursive: true })
      const decoy = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', dir + ' ' + args.join(' ')], { detached: true, stdio: 'ignore' })
      decoy.unref()
      // hang: never resolve, with a live handle so the process cannot fall off the event loop
      // and exit on its own — only the wrapper's deadline kill ends it (the timeout drill).
      if (MODE === 'hang') await new Promise(() => { setInterval(() => {}, 60000) })
      const locator = {
        first() { return this },
        async waitFor() { if (MODE === 'fail-role') throw new Error('fake: role not visible') },
        async click() {},
        async fill() {},
        async press() {},
      }
      const page = {
        setDefaultTimeout() {},
        on() {},
        async goto() { return { status: () => 200 } },
        getByRole() { return locator },
        keyboard: { async press() {} },
        async addScriptTag() {},
        async evaluate() { return [] },
        async screenshot({ path }) { writeFileSync(path, 'FAKEPNG') },
      }
      // launchPersistentContext returns a BrowserContext: pages() may already hold the initial page.
      return { pages() { return [page] }, async newPage() { return page }, async close() {} }
    },
  },
}
`

// makeProbeFixture — a tmp project with an index.html, a probe-carrying law.json (pre-lock is
// schema-valid — kiln-probe run does not require a lock; the TAMPER anchoring lives in kiln-law,
// the gated path), the locked-artifact spec file, and (by default) the fake playwright installed
// in the project's node_modules exactly where a user install would sit.
function makeProbeFixture({ fakePw = true, spec = baseSpec(), git = false } = {}) {
  const proj = mkdtempSync(join(tmpdir(), 'kiln-probe-test-'))
  const kiln = join(proj, '.kiln')
  mkdirSync(join(proj, 'tests/acceptance'), { recursive: true })
  mkdirSync(kiln, { recursive: true })
  writeFileSync(join(proj, 'index.html'), '<!doctype html><html><body><h1>Hello Kiln</h1><button>Add</button></body></html>\n')
  writeFileSync(join(proj, 'tests/acceptance/sc-001.probe.json'), JSON.stringify(spec, null, 2) + '\n')
  writeFileSync(join(kiln, 'law.json'), JSON.stringify(lawOf(probeCheck({ spec })), null, 2) + '\n')
  if (fakePw) {
    const pwDir = join(proj, 'node_modules', 'playwright')
    mkdirSync(pwDir, { recursive: true })
    writeFileSync(join(pwDir, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0-kiln-fake', main: 'index.js' }) + '\n')
    writeFileSync(join(pwDir, 'index.js'), FAKE_PLAYWRIGHT)
  }
  if (git) {
    writeFileSync(join(proj, '.gitignore'), 'node_modules/\n')
    const gitIn = (...args) => {
      const res = spawnSync('git', ['-C', proj, '-c', 'user.email=kiln@test', '-c', 'user.name=kiln', ...args], { encoding: 'utf8' })
      assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`)
    }
    gitIn('init', '-q'); gitIn('add', '-A'); gitIn('commit', '-qm', 'initial product commit')
  }
  return { proj, kiln }
}
const probeEvidence = (kiln, runId, sc = 'SC-001') => JSON.parse(readFileSync(join(kiln, 'evidence', runId, `probe-${sc}.json`), 'utf8'))

// detectRealPlaywright — the same non-project resolution arms probe-template falls back to
// (cwd, then the global npm root). Drives which integration tests run on this box: the smoke
// runs only WITH a real playwright; the unavailability drill only WITHOUT one.
function detectRealPlaywright() {
  const bases = [join(process.cwd(), 'noop.js')]
  try { bases.push(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 10000 }).trim(), 'noop.js')) } catch { /* no npm */ }
  for (const base of bases) { try { createRequire(base).resolve('playwright'); return true } catch { /* next */ } }
  return false
}
const realPw = detectRealPlaywright()

// ── 2. kiln-probe lifecycle with the FAKE playwright ────────────────────────────────────────────
test('kiln-probe run (pass): exit 0, §7 launch contract honored, full evidence written, decoy + profile dir swept — leaks reaped even on the happy path', () => {
  const { proj, kiln } = makeProbeFixture()
  const pwLog = join(proj, 'launch-opts.json')
  try {
    const res = probeCli(['run', proj, kiln, 'SC-001', 'run1'], { KILN_FAKE_PW_MODE: 'pass', KILN_FAKE_PW_LOG: pwLog })
    assert.equal(res.status, 0, res.stderr + res.stdout)
    assert.match(res.stdout, /^PROBE SC-001 exit=0 mapped=pass \(\d+ms\)$/m)
    assert.match(res.stdout, /^SWEEP pattern=kiln-pw-/m, 'the per-spawn token sweep ALWAYS runs')
    // evidence: the §7 contract files in .kiln/evidence/<runId>/
    const ev = probeEvidence(kiln, 'run1')
    assert.equal(ev.schema, 1)
    assert.equal(ev.mapped, 'pass')
    assert.equal(ev.exit, 0)
    assert.equal(ev.template_exit, 0)
    assert.equal(ev.served, 'static')
    assert.match(ev.base_url, /^http:\/\/127\.0\.0\.1:\d+$/, 'statics served via built-in node:http — no npx')
    assert.ok(ev.token.startsWith('kiln-pw-run1-SC-001-'), `token is namespaced and run/SC-scoped: ${ev.token}`)
    assert.equal(ev.result.ok, true)
    assert.equal(ev.result.landmarks_checked, 1)
    assert.equal(ev.result.axe, 'skipped', 'axe-core not resolvable in the fixture — honestly skipped, never silently green')
    const specEcho = JSON.parse(readFileSync(join(kiln, 'evidence', 'run1', 'probe-SC-001.spec.json'), 'utf8'))
    assert.deepEqual(specEcho, baseSpec(), 'the exact spec executed is itself evidence')
    assert.ok(existsSync(join(kiln, 'evidence', 'run1', 'probe-SC-001.log')))
    const shot = join(kiln, 'evidence', 'run1', 'probe-SC-001-1440x900.png')
    assert.ok(existsSync(shot), 'screenshot evidence at the default 1440x900 viewport')
    assert.equal(readFileSync(shot, 'utf8'), 'FAKEPNG')
    // the §7 launch contract, recorded by the fake from the real call (launchPersistentContext:
    // the user-data-dir is the POSITIONAL dir — token-prefixed, one per viewport — never a flag)
    const opts = JSON.parse(readFileSync(pwLog, 'utf8'))
    assert.equal(opts.headless, true)
    for (const a of ['--disable-dev-shm-usage', '--disable-gpu', '--mute-audio', '--no-first-run']) assert.ok(opts.args.includes(a), a)
    assert.equal(opts.dir, `/tmp/${ev.token}-0`, 'the kill token rides in the per-viewport profile dir path (and so the chromium cmdline)')
    // lifecycle: the leaked decoy is DEAD and the profile dir is GONE — swept by token prefix
    assert.deepEqual(pgrepf(ev.token), [], 'no process carrying the token survives the run')
    assert.ok(!existsSync(`/tmp/${ev.token}-0`), 'the per-viewport profile dir is removed')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-probe run (fail-role): exit 1, mapped fail, the failed assertion lands in the evidence — and the sweep still reaps', () => {
  const { proj, kiln } = makeProbeFixture()
  try {
    const res = probeCli(['run', proj, kiln, 'SC-001', 'run1'], { KILN_FAKE_PW_MODE: 'fail-role' })
    assert.equal(res.status, 1)
    assert.match(res.stdout, /^PROBE SC-001 exit=1 mapped=fail/m)
    const ev = probeEvidence(kiln, 'run1')
    assert.equal(ev.mapped, 'fail')
    assert.equal(ev.result.ok, false)
    assert.ok(ev.result.failures.some((f) => /landmark not visible: role=heading/.test(f)), JSON.stringify(ev.result.failures))
    assert.deepEqual(pgrepf(ev.token), [], 'fail path sweeps too')
    assert.ok(!existsSync(`/tmp/${ev.token}-0`))
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-probe run (hang): the deadline hard-kills the template — exit 79, mapped timeout, decoy and profile dir swept', () => {
  const { proj, kiln } = makeProbeFixture()
  try {
    const t0 = Date.now()
    const res = probeCli(['run', proj, kiln, 'SC-001', 'run1'], { KILN_FAKE_PW_MODE: 'hang', KILN_PROBE_TIMEOUT_S: '2' })
    assert.equal(res.status, 79, `a hung browser must map to 79, got ${res.status}: ${res.stdout}${res.stderr}`)
    assert.ok(Date.now() - t0 < 30000, 'the kill is the deadline, not a hang')
    assert.match(res.stdout, /^PROBE_TIMEOUT SC-001 — hard-killed at 2s/m)
    assert.match(res.stdout, /^PROBE SC-001 exit=79 mapped=timeout/m)
    const ev = probeEvidence(kiln, 'run1')
    assert.equal(ev.mapped, 'timeout')
    assert.equal(ev.template_exit, null, 'SIGKILL leaves no exit status — recorded honestly')
    // THE drill: SIGKILL skipped the template's finally{close()} — the orphaned decoy (the
    // leaked browser stand-in) dies to the token sweep, not to luck.
    assert.deepEqual(pgrepf(ev.token), [], 'timeout survivors are swept by token')
    assert.ok(!existsSync(`/tmp/${ev.token}-0`), 'the per-viewport profile dir is removed after a timeout kill')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-probe run (no playwright anywhere): exit 78 PROBE_UNAVAILABLE — the capability tier, not an error', { skip: realPw && 'a real playwright is installed on this box — the unavailability drill cannot run' }, () => {
  const { proj, kiln } = makeProbeFixture({ fakePw: false })
  try {
    const res = probeCli(['run', proj, kiln, 'SC-001', 'run1'])
    assert.equal(res.status, 78, res.stdout + res.stderr)
    assert.match(res.stdout, /^PROBE_UNAVAILABLE SC-001$/m)
    assert.match(res.stdout, /^PROBE SC-001 exit=78 mapped=unavailable/m)
    const ev = probeEvidence(kiln, 'run1')
    assert.equal(ev.mapped, 'unavailable')
    assert.equal(ev.template_exit, 78)
    assert.match(readFileSync(join(kiln, 'evidence', 'run1', 'probe-SC-001.log'), 'utf8'), /PROBE_UNAVAILABLE playwright is not resolvable/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-probe run (serve_cmd): managed server under its own deadline — readiness-polled, used, then ALWAYS killed', () => {
  const port = 21000 + (process.pid % 9000)
  const tag = `kiln-test-serve-${process.pid}-${Date.now().toString(36)}`
  const spec = baseSpec({
    serve_cmd: `node -e "require('http').createServer((q,s)=>s.end('<h1>ok</h1>')).listen(${port}) // ${tag}"`,
    base_url: `http://127.0.0.1:${port}`,
  })
  const { proj, kiln } = makeProbeFixture({ spec })
  try {
    const res = probeCli(['run', proj, kiln, 'SC-001', 'run1'], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(res.status, 0, res.stdout + res.stderr)
    const ev = probeEvidence(kiln, 'run1')
    assert.equal(ev.served, 'serve_cmd')
    assert.equal(ev.base_url, `http://127.0.0.1:${port}`)
    assert.ok(existsSync(join(kiln, 'evidence', 'run1', 'probe-SC-001-server.log')), 'the managed server logs into the evidence dir')
    assert.deepEqual(pgrepf(tag), [], 'the serve_cmd process group is killed in the finally path — the server never outlives the check')
    assert.ok(!existsSync(`/tmp/${ev.token}.server.pid`), 'the token-named server pidfile is consumed by the finally sweep')
  } finally {
    spawnSync('pkill', ['-9', '-f', tag], { stdio: 'ignore' }) // belt: never leak a test server
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-probe run (serve_cmd never ready): bounded readiness window, mapped fail, server killed — a dead app is a red probe, never a hang', () => {
  const port = 21000 + ((process.pid + 1) % 9000)
  const tag = `kiln-test-noserve-${process.pid}-${Date.now().toString(36)}`
  // a node sleeper (never listens) keeps the tag in its OWN argv — bash would exec-optimize a
  // plain `sleep` and drop the tag from the cmdline, blinding the post-kill pgrep assertion
  const spec = baseSpec({ serve_cmd: `node -e "setTimeout(()=>{},60000) // ${tag}"`, base_url: `http://127.0.0.1:${port}` })
  const { proj, kiln } = makeProbeFixture({ spec })
  try {
    const t0 = Date.now()
    const res = probeCli(['run', proj, kiln, 'SC-001', 'run1'], { KILN_FAKE_PW_MODE: 'pass', KILN_PROBE_READY_TIMEOUT_MS: '1000' })
    assert.equal(res.status, 1)
    assert.ok(Date.now() - t0 < 30000, 'readiness is a bounded window')
    assert.match(res.stdout, /^FAIL serve_cmd never answered/m)
    assert.equal(probeEvidence(kiln, 'run1').mapped, 'fail')
    assert.deepEqual(pgrepf(tag), [], 'the unready server is killed all the same')
  } finally {
    spawnSync('pkill', ['-9', '-f', tag], { stdio: 'ignore' })
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-probe run: usage and spec errors die with exit 1 — unknown SC, non-probe SC, spec-less template, relative projectPath', () => {
  const { proj, kiln } = makeProbeFixture()
  try {
    const law = lawOf(
      probeCheck(),
      { id: 'SC-002', milestone: 'M1', kind: 'shell', cmd: 'true', files: ['tests/acceptance/sc-001.probe.json'], sha256: {}, expected: 'exit0', timeout_s: 10 },
      (() => { const t = probeCheck({ id: 'SC-003' }); delete t.spec; return t })(),
    )
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(law, null, 2) + '\n')
    const unknown = probeCli(['run', proj, kiln, 'SC-099', 'run1'])
    assert.equal(unknown.status, 1)
    assert.match(unknown.stderr, /no check 'SC-099'/)
    const shell = probeCli(['run', proj, kiln, 'SC-002', 'run1'])
    assert.equal(shell.status, 1)
    assert.match(shell.stderr, /kind 'shell', not 'probe'/)
    const template = probeCli(['run', proj, kiln, 'SC-003', 'run1'])
    assert.equal(template.status, 1)
    assert.match(template.stderr, /un-instantiated probe template \(no spec\)/)
    assert.equal(probeCli(['run', 'relative/path', kiln, 'SC-001', 'run1']).status, 1)
    assert.equal(probeCli(['frobnicate']).status, 1)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-probe sweep: targeted by token namespace — kills and removes ONLY the named prefix, never its neighbors', async () => {
  const tagA = `swA${process.pid}${Date.now().toString(36)}`
  const tagB = `swB${process.pid}${Date.now().toString(36)}`
  const decoy = (tag) => { const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', `--user-data-dir=/tmp/kiln-pw-${tag}`], { detached: true, stdio: 'ignore' }); c.unref(); return c }
  decoy(tagA); decoy(tagB)
  mkdirSync(`/tmp/kiln-pw-${tagA}`, { recursive: true })
  try {
    // spawn is async — poll until both decoys have exec'd and their cmdlines carry the tokens
    const deadline = Date.now() + 5000
    while ((pgrepf(`kiln-pw-${tagA}`).length !== 1 || pgrepf(`kiln-pw-${tagB}`).length !== 1) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.equal(pgrepf(`kiln-pw-${tagA}`).length, 1, 'decoy A is alive before the sweep')
    const res = probeCli(['sweep', tagA])
    assert.equal(res.status, 0, 'sweep always exits 0 — cleanup never fails a stage')
    assert.match(res.stdout, new RegExp(`^SWEEP pattern=kiln-pw-${tagA} killed=1 server_groups_killed=0 removed=1$`, 'm'))
    assert.deepEqual(pgrepf(`kiln-pw-${tagA}`), [], 'the named token is dead')
    assert.ok(!existsSync(`/tmp/kiln-pw-${tagA}`), 'its profile dir is removed')
    assert.equal(pgrepf(`kiln-pw-${tagB}`).length, 1, 'the OTHER token survives — sweeps are targeted, never blanket')
    // a clean re-sweep is a no-op, still exit 0
    const again = probeCli(['sweep', tagA])
    assert.equal(again.status, 0)
    assert.match(again.stdout, /killed=0 server_groups_killed=0 removed=0/)
    // a prefix that could escape the pkill pattern charset is refused
    const evil = probeCli(['sweep', 'a|b'])
    assert.equal(evil.status, 1)
    assert.match(evil.stderr, /token-prefix may only contain/)
  } finally {
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${tagB}`], { stdio: 'ignore' })
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${tagA}`], { stdio: 'ignore' })
    rmSync(`/tmp/kiln-pw-${tagA}`, { recursive: true, force: true })
  }
})

test('kiln-probe mcp-sweep: reaps ONLY the orphaned MCP browser (browser-binary arg0 + ms-playwright/mcp- profile) — never the operator\'s own Chrome, never the kiln-pw- oracle, never a shell that merely names the path; exits 0 idempotently, takes no args', async () => {
  // The host-configured Playwright MCP browser is the one path the kiln-pw- token sweep cannot reach:
  // its profile lives under ~/.cache/ms-playwright/mcp-<channel>-<hash> (verified on box), not a kiln
  // token. mcp-sweep is the process-level backstop behind the evaluator's browser_close. It must be
  // DOUBLY gated — kill only a process whose arg0 is a browser binary AND whose --user-data-dir points
  // into ms-playwright/mcp-, so it can never reap the operator's shell, an editor, or our own command.
  const tag = `${process.pid}${Date.now().toString(36)}`
  // Decoys are node sleepers. argv0 spoofs /proc/<pid>/cmdline[0] (verified) so a decoy can present as a
  // real `chrome-headless-shell` exactly as @playwright/mcp launches it; the --user-data-dir rides in
  // argv exactly as a real browser keeps it. browser:true → arg0 is a browser binary; browser:false →
  // arg0 is plain node (a stand-in for a shell/editor/grep that merely mentions the path in its args).
  const decoy = (udd, { browser, arg0 } = {}) => {
    const opts = { detached: true, stdio: 'ignore' }
    if (arg0) opts.argv0 = arg0 // spoof an arbitrary arg0 (e.g. the crashpad helper)
    else if (browser) opts.argv0 = '/opt/ms-playwright/chrome-headless-shell' // arg0 looks like the real binary
    const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', `--user-data-dir=${udd}`], opts)
    c.unref(); return c
  }
  // (a) the orphaned MCP browser — browser arg0 + ms-playwright/mcp- profile → the ONLY thing reaped.
  // (b) the operator's own Chrome — a browser, but a NON-mcp profile → spared (the profile gate).
  // (c) a kiln-pw- scripted-oracle browser — a different namespace, the token sweep's job → spared.
  // (d) a non-browser process whose ARGS mention an ms-playwright/mcp- path (a shell/log-tail) → spared
  //     (the arg0 gate — this is exactly the over-reach a naive `pkill -f ms-playwright/mcp-` would cause).
  // (e) chrome_crashpad_handler under the mcp- profile — the crash-reporter HELPER, NOT a browser, so it
  //     is NOT in the documented browser set (chrome / chromium / chrome-headless-shell / headless_shell)
  //     → spared (review cycle 3, finding 2: the arg0 gate must not be widened past the stated set).
  const mcpProfile = `/tmp/ms-playwright/mcp-${tag}`
  const operatorProfile = `/tmp/kiln-test-operator-chrome-${tag}`
  const oracleProfile = `/tmp/kiln-pw-mcptest-${tag}`
  const decoyMcp = decoy(mcpProfile, { browser: true })
  const decoyOperator = decoy(operatorProfile, { browser: true })
  const decoyOracle = decoy(oracleProfile, { browser: true })
  const decoyShell = decoy(`/tmp/ms-playwright/mcp-${tag}-shell-noise`, { browser: false }) // names the path, NOT a browser
  const decoyCrashpad = decoy(`/tmp/ms-playwright/mcp-${tag}-crash`, { arg0: '/opt/ms-playwright/chrome_crashpad_handler' }) // helper, NOT a browser
  try {
    const deadline = Date.now() + 5000
    const allUp = () => [decoyMcp, decoyOperator, decoyOracle, decoyShell, decoyCrashpad].every((c) => leaderCmdlineLive(c.pid))
    while (!allUp() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.ok(leaderCmdlineLive(decoyMcp.pid), 'the MCP browser stand-in is alive before the sweep')
    assert.ok(leaderCmdlineLive(decoyShell.pid), 'the path-naming non-browser stand-in is alive before the sweep')
    assert.ok(leaderCmdlineLive(decoyCrashpad.pid), 'the crashpad-handler stand-in is alive before the sweep')

    const res = probeCli(['mcp-sweep'])
    assert.equal(res.status, 0, 'mcp-sweep always exits 0 — cleanup never fails a stage')
    assert.match(res.stdout, /^MCP_SWEEP pattern=ms-playwright\/mcp- killed=\d+$/m, 'reports what the namespace sweep reaped')

    const gone = Date.now() + 5000
    while (leaderCmdlineLive(decoyMcp.pid) && Date.now() < gone) await new Promise((r) => setTimeout(r, 100))
    assert.ok(!leaderCmdlineLive(decoyMcp.pid), 'the orphaned MCP browser (browser arg0 + mcp- profile) is reaped')
    assert.ok(leaderCmdlineLive(decoyOperator.pid), "the operator's own Chrome (non-mcp profile) is UNTOUCHED — never a blanket chrome kill")
    assert.ok(leaderCmdlineLive(decoyOracle.pid), "the kiln-pw- scripted oracle is UNTOUCHED — that namespace is the token sweep's job")
    assert.ok(leaderCmdlineLive(decoyShell.pid), 'the non-browser process that merely NAMES the mcp- path is UNTOUCHED — the arg0 gate prevents the naive-pkill over-reach')
    assert.ok(leaderCmdlineLive(decoyCrashpad.pid), 'chrome_crashpad_handler under the mcp- profile is UNTOUCHED — the crash-reporter helper is NOT in the documented browser set (finding 2: the gate is not widened past chrome/chromium/chrome-headless-shell/headless_shell)')

    // idempotent: with the one browser gone, a clean re-sweep is a no-op, still exit 0
    const again = probeCli(['mcp-sweep'])
    assert.equal(again.status, 0)
    assert.match(again.stdout, /^MCP_SWEEP pattern=ms-playwright\/mcp- killed=0$/m)

    // takes NO args — the pattern is fixed and inert; a stray arg is a usage error
    const withArg = probeCli(['mcp-sweep', 'anything'])
    assert.equal(withArg.status, 1)
    assert.match(withArg.stderr, /usage:/)
  } finally {
    for (const c of [decoyMcp, decoyOperator, decoyOracle, decoyShell, decoyCrashpad]) { try { process.kill(c.pid, 'SIGKILL') } catch { /* gone */ } }
    rmSync(`/tmp/ms-playwright`, { recursive: true, force: true })
  }
})

test('kiln-probe sweep: the server-pidfile arm — kills the recorded process GROUP only when the live leader still matches the recorded cmd (recycled-PID guard), and always consumes the pidfile', async () => {
  // the managed server's cmdline carries NO kiln-pw token (it is the user's command, verbatim) —
  // exactly the cycle-1 leak: pattern-kill can never reach it, ONLY the pidfile group-kill can.
  const tag = `swS${process.pid}${Date.now().toString(36)}`
  const mark = `kiln-test-pidfile-${process.pid}-${Date.now().toString(36)}`
  const pidfile = `/tmp/kiln-pw-${tag}.server.pid`
  const grp = spawn(process.execPath, ['-e', `setTimeout(()=>{},300000) // ${mark}`], { detached: true, stdio: 'ignore' })
  grp.unref()
  try {
    const deadline = Date.now() + 5000
    while (pgrepf(mark).length !== 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.equal(pgrepf(mark).length, 1, 'the detached group leader is alive before the sweep')
    // recycled-PID guard: the recorded cmd does not match the live leader → NEVER killed (the
    // pgid could belong to an innocent recycled process), but the stale pidfile is consumed.
    writeFileSync(pidfile, JSON.stringify({ pgid: grp.pid, cmd: 'an-entirely-different-command' }) + '\n')
    const guarded = probeCli(['sweep', tag])
    assert.equal(guarded.status, 0)
    assert.match(guarded.stdout, new RegExp(`^SWEEP pattern=kiln-pw-${tag} killed=0 server_groups_killed=0 removed=1$`, 'm'))
    assert.equal(pgrepf(mark).length, 1, 'a mismatched leader survives — sweeps never kill what they cannot identify')
    assert.ok(!existsSync(pidfile), 'the stale pidfile is consumed all the same')
    // matching record → the whole detached group dies, by group kill, not by token pattern
    writeFileSync(pidfile, JSON.stringify({ pgid: grp.pid, cmd: mark }) + '\n')
    const killed = probeCli(['sweep', tag])
    assert.equal(killed.status, 0)
    assert.match(killed.stdout, new RegExp(`^SWEEP pattern=kiln-pw-${tag} killed=0 server_groups_killed=1 removed=1$`, 'm'))
    const gone = Date.now() + 5000
    while (pgrepf(mark).length !== 0 && Date.now() < gone) await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(pgrepf(mark), [], 'the recorded server group is dead')
    assert.ok(!existsSync(pidfile))
  } finally {
    spawnSync('pkill', ['-9', '-f', mark], { stdio: 'ignore' })
    rmSync(pidfile, { force: true })
  }
})

// ── 2b. the browser LEASE — the §7 CAPABILITY deadline (ORCHESTRATOR RULING, p3/tasks.md) ─────────
// A workflow cannot CANCEL a spawned agent, so the Tier-2 ≤10-min cap is enforced on the CAPABILITY:
// `kiln-probe lease` writes a token-keyed lease + a detached self-terminating watchdog; `kiln-probe
// run --lease <token>` REFUSES (exit 77) once the lease is absent/expired/mismatched; `lease-release`
// kills the watchdog + sweeps. The Tier-1 build probe path (no lease) is UNCHANGED. These drills use
// the fake browser so the harness needs no chromium. The whole point: an evaluator alive past the
// deadline can do no further browser work — the lease gate, not goodwill, is the enforcement.
const leaseOf = (kiln, runId) => JSON.parse(readFileSync(join(kiln, 'evidence', runId, 'browser.lease'), 'utf8'))
const leaseAlive = (pid) => { try { return Number.isInteger(pid) && pid > 1 && (process.kill(pid, 0), true) } catch { return false } }

test('kiln-probe lease: writes the {token, expires_at, watchdog_pid} lease + a live detached watchdog; lease-release kills the watchdog, sweeps the token namespace, deletes the lease', async () => {
  const { proj, kiln } = makeProbeFixture()
  const tok = `kvalA${process.pid}${Date.now().toString(36)}`
  try {
    const take = probeCli(['lease', kiln, tok, tok, '600'])
    assert.equal(take.status, 0, take.stderr)
    assert.match(take.stdout, new RegExp(`^LEASE ${tok} expires_at=\\d+ watchdog_pid=\\d+$`, 'm'))
    const l = leaseOf(kiln, tok)
    assert.equal(l.token, tok)
    assert.ok(l.expires_at > Math.floor(Date.now() / 1000), 'expires_at is in the future')
    assert.ok(Number.isInteger(l.watchdog_pid) && l.watchdog_pid > 1, 'the watchdog pid is recorded')
    const deadline = Date.now() + 5000
    while (!leaseAlive(l.watchdog_pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    assert.ok(leaseAlive(l.watchdog_pid), 'the detached watchdog is alive while the lease holds')
    // a decoy "leaked browser" carrying the lease token — lease-release must sweep it
    const decoy = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', `--user-data-dir=/tmp/kiln-pw-${tok}-decoy`], { detached: true, stdio: 'ignore' })
    decoy.unref(); mkdirSync(`/tmp/kiln-pw-${tok}-decoy`, { recursive: true })
    const up = Date.now() + 5000
    while (pgrepf(`kiln-pw-${tok}`).length !== 1 && Date.now() < up) await new Promise((r) => setTimeout(r, 50))
    assert.equal(pgrepf(`kiln-pw-${tok}`).length, 1, 'the leaked-browser decoy is alive before release')

    const rel = probeCli(['lease-release', kiln, tok])
    assert.equal(rel.status, 0, rel.stderr)
    assert.match(rel.stdout, new RegExp(`^LEASE_RELEASE ${tok} token=${tok} watchdog_pid=\\d+ swept$`, 'm'))
    const gone = Date.now() + 5000
    while ((leaseAlive(l.watchdog_pid) || pgrepf(`kiln-pw-${tok}`).length) && Date.now() < gone) await new Promise((r) => setTimeout(r, 50))
    assert.ok(!leaseAlive(l.watchdog_pid), 'lease-release kills the watchdog — teardown is now, not at the deadline')
    assert.deepEqual(pgrepf(`kiln-pw-${tok}`), [], 'lease-release sweeps the leaked browser by token')
    assert.ok(!existsSync(join(kiln, 'evidence', tok, 'browser.lease')), 'lease-release deletes the lease file — no stale lease blocks a later run')
    assert.ok(!existsSync(`/tmp/kiln-pw-${tok}-decoy`), 'the profile dir is removed')
    // lease-release on a fixture with no lease is a clean no-op, still exit 0
    const noop = probeCli(['lease-release', kiln, `nolease${tok}`])
    assert.equal(noop.status, 0)
    assert.match(noop.stdout, /no lease present \(no-op\)/)
  } finally {
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${tok}`], { stdio: 'ignore' })
    rmSync(`/tmp/kiln-pw-${tok}-decoy`, { recursive: true, force: true })
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-probe run --lease: a VALID lease lets the leased probe run (exit 0); an ABSENT/MISMATCHED lease REFUSES with exit 77 LEASE_EXPIRED — no browser is launched', () => {
  const { proj, kiln } = makeProbeFixture()
  const tok = `kvalB${process.pid}${Date.now().toString(36)}`
  try {
    const take = probeCli(['lease', kiln, tok, tok, '600'])
    assert.equal(take.status, 0, take.stderr)
    // a probe under a child runId of the leased token, WITH a valid lease → runs (exit 0)
    const ok = probeCli(['run', proj, kiln, 'SC-001', `${tok}-eval1`, '--lease', tok], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(ok.status, 0, `a probe under a valid lease must run: ${ok.stderr}${ok.stdout}`)
    assert.match(ok.stdout, /^PROBE SC-001 exit=0 mapped=pass/m)
    // a probe demanding a lease token that has no lease file → REFUSED, exit 77, no probe evidence
    const noLease = probeCli(['run', proj, kiln, 'SC-001', 'kvalNoLease-eval1', '--lease', 'kvalNoLease'])
    assert.equal(noLease.status, 77, `an absent lease must refuse with 77: ${noLease.stdout}`)
    assert.match(noLease.stderr, /LEASE_EXPIRED no usable lease/)
    assert.ok(!existsSync(join(kiln, 'evidence', 'kvalNoLease-eval1', 'probe-SC-001.json')), 'a refused probe launches no browser and writes no evidence')
    // a probe whose runId is OUTSIDE the leased token namespace → token-mismatch, exit 77
    const outOfNs = probeCli(['run', proj, kiln, 'SC-001', 'someOtherRun-eval1', '--lease', tok], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(outOfNs.status, 77, 'a runId outside the leased token namespace is refused')
    assert.match(outOfNs.stderr, /not inside the leased token namespace/)
    // KILN_PROBE_LEASE env is the alternative demand form — same refusal on an absent lease
    const envDemand = probeCli(['run', proj, kiln, 'SC-001', 'kvalEnv-eval1'], { KILN_PROBE_LEASE: 'kvalEnv' })
    assert.equal(envDemand.status, 77, 'KILN_PROBE_LEASE env demands the lease too')
    assert.match(envDemand.stderr, /LEASE_EXPIRED/)
  } finally {
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${tok}`], { stdio: 'ignore' })
    probeCli(['lease-release', kiln, tok])
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-probe run --lease: an EXPIRED lease REFUSES — an over-deadline evaluator can do no further browser work (the capability deadline); the watchdog self-terminates and sweeps at expiry', async () => {
  const { proj, kiln } = makeProbeFixture()
  const tok = `kvalC${process.pid}${Date.now().toString(36)}`
  try {
    // a 1s lease; spawn a decoy "leaked browser" under the token BEFORE expiry — the watchdog must reap it
    const take = probeCli(['lease', kiln, tok, tok, '1'])
    assert.equal(take.status, 0, take.stderr)
    const wd = leaseOf(kiln, tok).watchdog_pid
    const decoy = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', `--user-data-dir=/tmp/kiln-pw-${tok}-decoy`], { detached: true, stdio: 'ignore' })
    decoy.unref(); mkdirSync(`/tmp/kiln-pw-${tok}-decoy`, { recursive: true })
    const up = Date.now() + 5000
    while (pgrepf(`kiln-pw-${tok}`).length !== 1 && Date.now() < up) await new Promise((r) => setTimeout(r, 50))
    assert.equal(pgrepf(`kiln-pw-${tok}`).length, 1, 'the leaked-browser decoy is alive before expiry')
    // wait out the lease + the watchdog's sweep
    const swept = Date.now() + 8000
    while ((pgrepf(`kiln-pw-${tok}`).length || existsSync(join(kiln, 'evidence', tok, 'browser.lease')) || leaseAlive(wd)) && Date.now() < swept) await new Promise((r) => setTimeout(r, 100))
    // THE DRILL: a probe fired AFTER the cap is REFUSED (exit 77) — no further browser work is authorized
    const refused = probeCli(['run', proj, kiln, 'SC-001', `${tok}-late`, '--lease', tok], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(refused.status, 77, `an over-deadline probe must be REFUSED: ${refused.stdout}${refused.stderr}`)
    assert.match(refused.stderr, /LEASE_EXPIRED/)
    assert.ok(!existsSync(join(kiln, 'evidence', `${tok}-late`, 'probe-SC-001.json')), 'the refused over-deadline probe launches no browser')
    // the self-terminating watchdog swept its survivors + deleted the lease at expiry, on its own
    assert.deepEqual(pgrepf(`kiln-pw-${tok}`), [], 'the watchdog swept the leaked browser at expiry — survivors die at the cap, not by luck')
    assert.ok(!leaseAlive(wd), 'the watchdog self-terminated at expiry (timeout-bounded)')
    assert.ok(!existsSync(join(kiln, 'evidence', tok, 'browser.lease')), 'the watchdog deleted the lease at expiry')
  } finally {
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${tok}`], { stdio: 'ignore' })
    rmSync(`/tmp/kiln-pw-${tok}-decoy`, { recursive: true, force: true })
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-probe run: the Tier-1 build path (NO lease demanded, no lease file) is UNCHANGED — a probe runs without any lease, exactly as before', () => {
  const { proj, kiln } = makeProbeFixture()
  try {
    // no --lease, no KILN_PROBE_LEASE, no browser.lease in the runId dir → unleased, runs as Tier-1 does
    const res = probeCli(['run', proj, kiln, 'SC-001', 'tier1run'], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(res.status, 0, `the unleased Tier-1 probe must run unchanged: ${res.stderr}${res.stdout}`)
    assert.match(res.stdout, /^PROBE SC-001 exit=0 mapped=pass/m)
    assert.equal(probeEvidence(kiln, 'tier1run').mapped, 'pass')
  } finally {
    spawnSync('pkill', ['-9', '-f', 'kiln-pw-tier1run'], { stdio: 'ignore' })
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-probe run: the "lease file exists for the runId" trigger — a browser.lease in the probe\'s OWN runId dir enforces the lease even without --lease/env', () => {
  const { proj, kiln } = makeProbeFixture()
  const tok = `kvalD${process.pid}${Date.now().toString(36)}`
  let origWatchdog = null // captured before the hand-overwrite so the finally never orphans it
  try {
    // take a SHORT lease keyed by the exact runId the probe will use — no --lease flag passed to run
    const take = probeCli(['lease', kiln, tok, tok, '3'])
    assert.equal(take.status, 0, take.stderr)
    origWatchdog = leaseOf(kiln, tok).watchdog_pid
    const ok = probeCli(['run', proj, kiln, 'SC-001', tok], { KILN_FAKE_PW_MODE: 'pass' }) // runId === leaseRunId, no --lease
    assert.equal(ok.status, 0, `a probe under its own valid lease runs: ${ok.stderr}${ok.stdout}`)
    // now expire it by hand-writing a past expiry, then run again under the same runId → refused, no flag.
    // (the original watchdog is killed in the finally so this deterministic overwrite leaks nothing.)
    writeFileSync(join(kiln, 'evidence', tok, 'browser.lease'), JSON.stringify({ token: tok, expires_at: 1, watchdog_pid: null }) + '\n')
    const refused = probeCli(['run', proj, kiln, 'SC-001', tok], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(refused.status, 77, 'an in-dir lease that has expired refuses without any flag')
    assert.match(refused.stderr, /LEASE_EXPIRED/)
  } finally {
    if (Number.isInteger(origWatchdog) && origWatchdog > 1) { try { process.kill(origWatchdog, 'SIGKILL') } catch { /* already gone */ } }
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${tok}`], { stdio: 'ignore' })
    probeCli(['lease-release', kiln, tok])
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-probe lease/lease-release: usage + charset validation — the token/runId are kiln-pw- sweep prefixes, kept inert; seconds is a positive integer', () => {
  const { proj, kiln } = makeProbeFixture()
  try {
    assert.equal(probeCli(['lease', kiln, 'ok', 'ok']).status, 1, 'lease needs 4 args')
    assert.match(probeCli(['lease', kiln, 'a|b', 'tok', '60']).stderr, /runId may only contain/)
    assert.match(probeCli(['lease', kiln, 'run', 'a|b', '60']).stderr, /token may only contain/)
    assert.match(probeCli(['lease', kiln, 'run', 'tok', '0']).stderr, /seconds must be a positive integer/)
    assert.match(probeCli(['lease', kiln, 'run', 'tok', 'x']).stderr, /seconds must be a positive integer/)
    assert.equal(probeCli(['lease-release', kiln]).status, 1, 'lease-release needs runId')
    assert.match(probeCli(['run', proj, kiln, 'SC-001', 'r', '--lease', 'a|b']).stderr, /--lease token may only contain/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

// ── 3. kiln-law run — probes execute through kiln-probe with the same evidence contract ─────────
// A git-locked fixture (the §5 sequence) with one green shell check, one spec-carrying probe,
// and one spec-less template — the three probe postures a real Law can hold at once.
function makeLawFixture({ fakePw = true, probeTimeoutS = 120, spec = baseSpec() } = {}) {
  const { proj, kiln } = makeProbeFixture({ fakePw, git: false })
  writeFileSync(join(proj, 'tests/acceptance/sc-001.sh'), 'grep -q "Hello Kiln" index.html\n')
  const template = probeCheck({ id: 'SC-003', files: ['tests/acceptance/sc-003.probe.md'] })
  delete template.spec
  writeFileSync(join(proj, 'tests/acceptance/sc-003.probe.md'), '# template SC-003 — not yet instantiated\n')
  const law = lawOf(
    { id: 'SC-001', milestone: 'M1', kind: 'shell', cmd: 'bash tests/acceptance/sc-001.sh', files: ['tests/acceptance/sc-001.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
    probeCheck({ id: 'SC-002', files: ['tests/acceptance/sc-002.probe.json'], timeout_s: probeTimeoutS, spec }),
    template,
  )
  // P3.6 T2 twin contract: a spec'd probe locks ONLY with its on-disk twin listed and deep-equal
  // (kiln-law index refuses a desynced pair) — the fixture follows the §5 shape Asimov writes.
  writeFileSync(join(proj, 'tests/acceptance/sc-002.probe.json'), JSON.stringify(spec, null, 2) + '\n')
  writeFileSync(join(kiln, 'law.json'), JSON.stringify(law, null, 2) + '\n')
  writeFileSync(join(proj, '.gitignore'), 'node_modules/\n')
  const gitIn = (...args) => {
    const res = spawnSync('git', ['-C', proj, '-c', 'user.email=kiln@test', '-c', 'user.name=kiln', ...args], { encoding: 'utf8' })
    assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`)
    return res.stdout.trim()
  }
  gitIn('init', '-q'); gitIn('add', '-A'); gitIn('commit', '-qm', 'initial product commit')
  assert.equal(lawCli(['index', proj, kiln]).status, 0)
  gitIn('add', 'tests/acceptance', '.kiln/law.json'); gitIn('commit', '-qm', 'test(law): lock acceptance gates')
  return { proj, kiln, law }
}
const manifestOf = (kiln, runId) => JSON.parse(readFileSync(join(kiln, 'evidence', runId, 'run.json'), 'utf8'))
const resultsOf = (kiln, runId) => readFileSync(join(kiln, 'evidence', runId, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('kiln-law run: a spec-carrying probe EXECUTES via kiln-probe — GREEN results line, probe evidence beside it; the spec-less template still defers; any deferral ⇒ verification_class static-only', () => {
  const { proj, kiln } = makeLawFixture()
  try {
    const res = lawCli(['run', proj, kiln], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(res.status, 0, res.stderr + res.stdout)
    assert.match(res.stdout, /^GREEN SC-001/m)
    assert.match(res.stdout, /^GREEN SC-002/m, 'the probe ran and went green — no PROBE_DEFERRED for an instantiated spec')
    assert.match(res.stdout, /^PROBE_DEFERRED SC-003$/m, 'the un-instantiated template still defers')
    assert.match(res.stdout, /^RESULT \S+ green=2 red=0 deferred=1$/m)
    assert.match(res.stdout, /^VERIFICATION_CLASS static-only — probe evidence deferred for: SC-003$/m)
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    const lines = resultsOf(kiln, runId)
    const probeLine = lines.find((l) => l.id === 'SC-002')
    assert.equal(probeLine.exit, 0, 'the same results.jsonl evidence contract as every check')
    assert.equal(typeof probeLine.duration_ms, 'number')
    assert.equal(typeof probeLine.log_sha256, 'string')
    assert.deepEqual(lines.find((l) => l.id === 'SC-003'), { id: 'SC-003', deferred: 'probe_deferred' })
    // probe artifacts land in the SAME run dir, manifest finalized with the verification class
    assert.equal(probeEvidence(kiln, runId, 'SC-002').mapped, 'pass')
    assert.ok(existsSync(join(kiln, 'evidence', runId, 'checks', 'SC-002.log')))
    assert.equal(manifestOf(kiln, runId).verification_class, 'static-only')
    // status folds the executed probe green, the template deferred
    const status = lawCli(['status', kiln, runId])
    assert.deepEqual(JSON.parse(status.stdout), { green: ['SC-001', 'SC-002'], red: [], deferred: ['SC-003'] })
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-law run: zero deferrals ⇒ verification_class full, no VERIFICATION_CLASS line; --skip-probes defers even an instantiated spec', () => {
  const { proj, kiln } = makeLawFixture()
  try {
    const full = lawCli(['run', proj, kiln, '--only', 'SC-001,SC-002'], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(full.status, 0, full.stderr)
    assert.doesNotMatch(full.stdout, /VERIFICATION_CLASS/, 'a fully-executed selection is not degraded')
    assert.equal(manifestOf(kiln, full.stdout.match(/^RUN (\S+) /m)[1]).verification_class, 'full')
    const skipped = lawCli(['run', proj, kiln, '--skip-probes'], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(skipped.status, 0, skipped.stderr)
    assert.match(skipped.stdout, /^PROBE_DEFERRED SC-002$/m, '--skip-probes is the explicit opt-out')
    assert.match(skipped.stdout, /^RESULT \S+ green=1 red=0 deferred=2$/m)
    assert.match(skipped.stdout, /^VERIFICATION_CLASS static-only — probe evidence deferred for: SC-002,SC-003$/m)
    assert.equal(manifestOf(kiln, skipped.stdout.match(/^RUN (\S+) /m)[1]).verification_class, 'static-only')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-law run: a red probe is a RED check — exit 1 evidence, --expect-green fails on it', () => {
  const { proj, kiln } = makeLawFixture()
  try {
    const res = lawCli(['run', proj, kiln, '--only', 'SC-002'], { KILN_FAKE_PW_MODE: 'fail-role' })
    assert.equal(res.status, 0, 'default is report-only')
    assert.match(res.stdout, /^RED SC-002 exit 1/m)
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    assert.equal(resultsOf(kiln, runId).find((l) => l.id === 'SC-002').exit, 1)
    assert.equal(manifestOf(kiln, runId).verification_class, 'full', 'a RED probe EXECUTED — red is not deferred, the run is not degraded')
    const gated = lawCli(['run', proj, kiln, '--only', 'SC-002', '--expect-green', 'SC-002'], { KILN_FAKE_PW_MODE: 'fail-role' })
    assert.equal(gated.status, 1)
    assert.match(gated.stderr, /expectation unmet — not green: SC-002/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-law run: playwright absent ⇒ PROBE_UNAVAILABLE folds deferred (probe_unavailable) — NEVER green, exempt from --flips, fails --expect-green, run marked static-only', { skip: realPw && 'a real playwright is installed on this box — the unavailability drill cannot run' }, () => {
  const { proj, kiln } = makeLawFixture({ fakePw: false })
  try {
    const res = lawCli(['run', proj, kiln])
    assert.equal(res.status, 0, res.stderr)
    assert.match(res.stdout, /^PROBE_UNAVAILABLE SC-002 \(\d+ms\)$/m)
    assert.match(res.stdout, /^RESULT \S+ green=1 red=0 deferred=2$/m)
    assert.match(res.stdout, /^VERIFICATION_CLASS static-only — probe evidence deferred for: SC-002,SC-003$/m)
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    const line = resultsOf(kiln, runId).find((l) => l.id === 'SC-002')
    assert.equal(line.deferred, 'probe_unavailable')
    assert.equal(line.exit, undefined, 'deferred carries no exit — it can never read as green')
    assert.equal(manifestOf(kiln, runId).verification_class, 'static-only')
    assert.deepEqual(JSON.parse(lawCli(['status', kiln, runId]).stdout).deferred, ['SC-002', 'SC-003'])
    // capability-degraded honesty in the gates: never green, but never a false red either
    const expectG = lawCli(['run', proj, kiln, '--only', 'SC-002', '--expect-green', 'SC-002'])
    assert.equal(expectG.status, 1, 'an unavailable probe can NEVER satisfy --expect-green')
    const flips = lawCli(['run', proj, kiln, '--flips', 'SC-002'])
    assert.equal(flips.status, 0, 'a capability-deferred flip is exempt — the T2 ledger handles the degradation')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-law run: a probe overrunning the outer timeout_s is hard-killed, recorded RED 124, and its token namespace is swept by runId — the dead wrapper cannot sweep its own token, so kiln-law does', () => {
  // the locked law gives SC-002 timeout_s 2 (the OUTER bound); the inner template deadline is
  // pushed long so the OUTER kill is the one that fires — SIGKILLing kiln-probe mid-flight,
  // exactly the case where its finally-sweep never runs.
  const { proj, kiln } = makeLawFixture({ probeTimeoutS: 2 })
  try {
    const t0 = Date.now()
    const res = lawCli(['run', proj, kiln, '--only', 'SC-002'], { KILN_FAKE_PW_MODE: 'hang', KILN_PROBE_TIMEOUT_S: '300' })
    assert.equal(res.status, 0, `report-only run: ${res.stderr}`)
    assert.ok(Date.now() - t0 < 60000, 'the outer deadline is a deadline')
    assert.match(res.stdout, /^RED SC-002 exit 124 \(timeout\)/m, 'the coreutils timeout convention, never a fake 0')
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    const line = resultsOf(kiln, runId).find((l) => l.id === 'SC-002')
    assert.equal(line.exit, 124)
    assert.equal(manifestOf(kiln, runId).verification_class, 'full', 'a timed-out probe EXECUTED red — red is a verdict, not a deferral')
    // the lifecycle floor: kiln-law fired `kiln-probe sweep <runId>` behind the kill — the hung
    // template (its argv carries the namespaced token) and the fake's leaked decoy are both dead.
    assert.deepEqual(pgrepf(`kiln-pw-${runId}`), [], 'no process in the run token namespace survives the outer kill')
  } finally {
    spawnSync('pkill', ['-9', '-f', 'kiln-pw-'], { stdio: 'ignore' }) // belt for a failed assertion — never leak from the harness
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-law run: an outer-timeout kill cannot leak the managed serve_cmd either — the runId sweep reaps the server process GROUP via the token-named pidfile (the server cmdline carries no token)', () => {
  // THE cycle-1 reviewer exploit, verbatim: outer timeout_s SIGKILLs kiln-probe mid-flight (its
  // finally never runs), and the serve_cmd tree — spawned WITHOUT any kiln-pw token in its own
  // cmdline — survived the token-pattern sweep. Lifecycle step 4 demands the app server is torn
  // down with the check; the pidfile group-kill arm is what enforces it.
  const port = 21000 + ((process.pid + 2) % 9000)
  const tag = `kiln-test-outersrv-${process.pid}-${Date.now().toString(36)}`
  const spec = baseSpec({
    serve_cmd: `node -e "require('http').createServer((q,s)=>s.end('<h1>ok</h1>')).listen(${port}) // ${tag}"`,
    base_url: `http://127.0.0.1:${port}`,
  })
  const { proj, kiln } = makeLawFixture({ probeTimeoutS: 3, spec })
  try {
    const t0 = Date.now()
    const res = lawCli(['run', proj, kiln, '--only', 'SC-002'], { KILN_FAKE_PW_MODE: 'hang', KILN_PROBE_TIMEOUT_S: '300' })
    assert.equal(res.status, 0, `report-only run: ${res.stderr}`)
    assert.ok(Date.now() - t0 < 60000, 'the outer deadline is a deadline')
    assert.match(res.stdout, /^RED SC-002 exit 124 \(timeout\)/m)
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    assert.deepEqual(pgrepf(tag), [], 'NO serve_cmd process survives the outer kill — the server is torn down with the check, not left to its own deadline')
    assert.deepEqual(pgrepf(`kiln-pw-${runId}`), [], 'no token-cmdline process survives either')
    const pidfiles = readdirSync('/tmp').filter((n) => n.startsWith(`kiln-pw-${runId}`) && n.endsWith('.server.pid'))
    assert.deepEqual(pidfiles, [], 'the server pidfile is consumed by the sweep')
  } finally {
    spawnSync('pkill', ['-9', '-f', tag], { stdio: 'ignore' })
    spawnSync('pkill', ['-9', '-f', 'kiln-pw-'], { stdio: 'ignore' })
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-law run stage-level sweeps: a probe-executing run is BRACKETED — pre-flight sweep is SCOPED to the stage\'s --run-prefix (reaps THIS stage\'s prior crashed run, NEVER a concurrent run under a different prefix); a runId end sweep fires after all probes finish', async () => {
  const { proj, kiln } = makeLawFixture()
  const stageTok = `stg${process.pid}${Date.now().toString(36)}`
  // (a) THIS stage's own prior crashed run: a live orphan + stale profile dir under the stage
  // prefix (sibling runId from an earlier --run-prefix=stageTok run that died). The prefix-scoped
  // pre-flight MUST reap it (#1311's stale-SingletonLock class, owned by this stage).
  const mineTag = `${stageTok}-prior${Date.now().toString(36)}`
  const mine = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', `--user-data-dir=/tmp/kiln-pw-${mineTag}`], { detached: true, stdio: 'ignore' })
  mine.unref()
  mkdirSync(`/tmp/kiln-pw-${mineTag}`, { recursive: true })
  // (b) a CONCURRENT Kiln run's in-flight browser, under a DIFFERENT prefix — a parallel build or
  // a validate Tier-2 traversal. The discipline-spec ban: this run's sweep must NEVER reap it.
  const otherTag = `other${process.pid}${Date.now().toString(36)}`
  const other = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', `--user-data-dir=/tmp/kiln-pw-${otherTag}`], { detached: true, stdio: 'ignore' })
  other.unref()
  mkdirSync(`/tmp/kiln-pw-${otherTag}`, { recursive: true })
  try {
    const deadline = Date.now() + 5000
    while ((pgrepf(`kiln-pw-${mineTag}`).length !== 1 || pgrepf(`kiln-pw-${otherTag}`).length !== 1) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.equal(pgrepf(`kiln-pw-${mineTag}`).length, 1, 'this stage\'s prior-run orphan is alive before the run')
    assert.equal(pgrepf(`kiln-pw-${otherTag}`).length, 1, 'the concurrent run\'s browser is alive before the run')
    const res = lawCli(['run', proj, kiln, '--only', 'SC-001,SC-002', '--run-prefix', stageTok], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(res.status, 0, res.stderr + res.stdout)
    // pre-flight: SCOPED to the stage prefix (never bare kiln-pw-), and BEFORE the probe executed
    const pre = res.stdout.match(new RegExp(`^SWEEP pattern=kiln-pw-${stageTok} killed=\\d+.*$`, 'm'))
    assert.ok(pre, 'the pre-flight sweep is scoped to the --run-prefix, NOT the whole kiln-pw- namespace')
    assert.doesNotMatch(res.stdout, /^SWEEP pattern=kiln-pw- killed=/m, 'no bare-namespace sweep line is emitted')
    assert.ok(res.stdout.indexOf(pre[0]) < res.stdout.indexOf('GREEN SC-002'), 'pre-flight fires BEFORE any probe runs')
    assert.deepEqual(pgrepf(`kiln-pw-${mineTag}`), [], 'this stage\'s prior-run orphan is dead — reaped by the prefix-scoped pre-flight')
    assert.ok(!existsSync(`/tmp/kiln-pw-${mineTag}`), 'its stale profile dir is removed')
    assert.equal(pgrepf(`kiln-pw-${otherTag}`).length, 1, 'the CONCURRENT run\'s browser SURVIVES — a different prefix is never reaped (the discipline-spec cross-run ban)')
    assert.ok(existsSync(`/tmp/kiln-pw-${otherTag}`), 'the concurrent run\'s profile dir is untouched')
    // run-end: this run's full runId prefix (which begins with the stage prefix), AFTER all checks
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    assert.ok(runId.startsWith(`${stageTok}-`), 'the runId is prefixed with the stage token')
    const post = res.stdout.match(new RegExp(`^SWEEP pattern=kiln-pw-${runId} .*$`, 'm'))
    assert.ok(post, 'the run-end sweep is scoped to THIS run\'s full token prefix')
    assert.ok(res.stdout.indexOf(post[0]) > res.stdout.indexOf('RESULT '), 'the end sweep fires after all probes finish')
  } finally {
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${mineTag}`], { stdio: 'ignore' })
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${otherTag}`], { stdio: 'ignore' })
    rmSync(`/tmp/kiln-pw-${mineTag}`, { recursive: true, force: true })
    rmSync(`/tmp/kiln-pw-${otherTag}`, { recursive: true, force: true })
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-law run stage-level sweeps: an UNPREFIXED probe run scopes its pre-flight to its own full runId (never the whole namespace) — a concurrent run under any other token is never reaped', async () => {
  const { proj, kiln } = makeLawFixture()
  // a concurrent run's in-flight browser; an unprefixed run cannot claim it and must not reap it.
  const otherTag = `other${process.pid}${Date.now().toString(36)}`
  const other = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', `--user-data-dir=/tmp/kiln-pw-${otherTag}`], { detached: true, stdio: 'ignore' })
  other.unref()
  mkdirSync(`/tmp/kiln-pw-${otherTag}`, { recursive: true })
  try {
    const deadline = Date.now() + 5000
    while (pgrepf(`kiln-pw-${otherTag}`).length !== 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.equal(pgrepf(`kiln-pw-${otherTag}`).length, 1, 'the concurrent run\'s browser is alive before the run')
    const res = lawCli(['run', proj, kiln, '--only', 'SC-001,SC-002'], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(res.status, 0, res.stderr + res.stdout)
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    assert.doesNotMatch(res.stdout, /^SWEEP pattern=kiln-pw- killed=/m, 'no whole-namespace pre-flight from an unprefixed run')
    assert.ok(res.stdout.match(new RegExp(`^SWEEP pattern=kiln-pw-${runId} `, 'm')), 'the pre-flight is scoped to the run\'s own full runId')
    assert.equal(pgrepf(`kiln-pw-${otherTag}`).length, 1, 'the concurrent run\'s browser SURVIVES the unprefixed run\'s sweeps')
    assert.ok(existsSync(`/tmp/kiln-pw-${otherTag}`), 'and its profile dir is untouched')
  } finally {
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${otherTag}`], { stdio: 'ignore' })
    rmSync(`/tmp/kiln-pw-${otherTag}`, { recursive: true, force: true })
    rmSync(proj, { recursive: true, force: true })
  }
})

test('kiln-law run stage-level sweeps: the end sweep is UNCONDITIONAL across exit paths — it fires even when the run exits 1 through an unmet gate', () => {
  const { proj, kiln } = makeLawFixture()
  try {
    // die(1) is process.exit(1): finally blocks are skipped, the 'exit'-registered sweep is not
    const res = lawCli(['run', proj, kiln, '--only', 'SC-002', '--expect-green', 'SC-002'], { KILN_FAKE_PW_MODE: 'fail-role' })
    assert.equal(res.status, 1)
    assert.match(res.stderr, /expectation unmet — not green: SC-002/)
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    assert.match(res.stdout, new RegExp(`^SWEEP pattern=kiln-pw-${runId} `, 'm'), 'the gate-failed exit path still sweeps the run token namespace')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('kiln-law run stage-level sweeps: a run with NO executable probe launches no browser and fires NO stage sweeps — logic-only and --skip-probes runs stay sweep-silent (named-token discipline, never blanket)', () => {
  const { proj, kiln } = makeLawFixture()
  try {
    const logicOnly = lawCli(['run', proj, kiln, '--only', 'SC-001'])
    assert.equal(logicOnly.status, 0, logicOnly.stderr)
    assert.doesNotMatch(logicOnly.stdout, /^SWEEP /m, 'no browser stage ⇒ no sweep — a namespace-wide sweep here could kill a concurrent legitimate session')
    const skipped = lawCli(['run', proj, kiln, '--skip-probes'])
    assert.equal(skipped.status, 0, skipped.stderr)
    assert.doesNotMatch(skipped.stdout, /^SWEEP /m, '--skip-probes executes no probe ⇒ no browser stage to bracket')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

// ── 4. integration smoke — REAL playwright, skipped cleanly when absent ─────────────────────────
test('integration smoke: kiln-probe drives a real chromium over the built-in static server', { skip: !realPw && 'playwright not installed — integration smoke skipped (capability tier, not a failure)' }, () => {
  const spec = baseSpec({
    landmarks: [{ role: 'heading', name: 'Hello Kiln' }, { role: 'button', name: 'Add' }],
    interactions: [{ action: 'click', role: 'button', name: 'Add' }],
  })
  const { proj, kiln } = makeProbeFixture({ fakePw: false, spec })
  try {
    const res = probeCli(['run', proj, kiln, 'SC-001', 'run1'])
    assert.equal(res.status, 0, res.stdout + res.stderr)
    const ev = probeEvidence(kiln, 'run1')
    assert.equal(ev.mapped, 'pass')
    assert.equal(ev.result.ok, true)
    assert.equal(ev.result.landmarks_checked, 2)
    assert.equal(ev.result.interactions_run, 1)
    const shot = join(kiln, 'evidence', 'run1', 'probe-SC-001-1440x900.png')
    assert.ok(existsSync(shot) && statSync(shot).size > 1000, 'a real screenshot, not a stub')
    assert.deepEqual(pgrepf(ev.token), [], 'no real browser process outlives the check')
    assert.ok(!existsSync(`/tmp/${ev.token}`))
  } finally { rmSync(proj, { recursive: true, force: true }) }
})
