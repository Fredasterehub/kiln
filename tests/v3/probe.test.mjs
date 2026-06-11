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
//      every probe-executing run (pre-flight namespace-wide BEFORE any probe spawns, runId-scoped
//      end sweep on EVERY exit path — gate-failed exits included), and a run with no executable
//      probe fires none.
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

// The FAKE playwright — a CJS module the probe-template resolves from the project's
// node_modules exactly like a user install. Modes via KILN_FAKE_PW_MODE:
//   pass      — every assertion succeeds; screenshot writes a stub file
//   fail-role — locator.waitFor throws (landmark invisible)
//   hang      — launch() never resolves (the timeout-kill drill)
// Every launch ALWAYS: records the launch options to KILN_FAKE_PW_LOG (when set), creates the
// real profile dir named by --user-data-dir, and spawns a detached REAL decoy process whose
// cmdline carries the launch args (and so the kiln-pw token) — a stand-in for a leaked browser
// process that ONLY the token sweep can reap. The decoy is a node sleeper with the args as a
// trailing argv entry: real chromium keeps its args in its cmdline, and so must the stand-in
// (bash -c would exec-optimize and DROP them — verified).
const FAKE_PLAYWRIGHT = `'use strict'
const { spawn } = require('child_process')
const { writeFileSync, mkdirSync } = require('fs')
const MODE = process.env.KILN_FAKE_PW_MODE || 'pass'
module.exports = {
  chromium: {
    async launch(opts) {
      const args = (opts && opts.args) || []
      if (process.env.KILN_FAKE_PW_LOG) writeFileSync(process.env.KILN_FAKE_PW_LOG, JSON.stringify(opts))
      const udd = args.find((a) => a.startsWith('--user-data-dir='))
      if (udd) mkdirSync(udd.slice('--user-data-dir='.length), { recursive: true })
      const decoy = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', args.join(' ')], { detached: true, stdio: 'ignore' })
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
      const context = { async newPage() { return page }, async close() {} }
      return { async newContext() { return context }, async close() {} }
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
    // the §7 launch contract, recorded by the fake from the real call
    const opts = JSON.parse(readFileSync(pwLog, 'utf8'))
    assert.equal(opts.headless, true)
    for (const a of ['--disable-dev-shm-usage', '--disable-gpu', '--mute-audio', '--no-first-run']) assert.ok(opts.args.includes(a), a)
    assert.ok(opts.args.includes(`--user-data-dir=/tmp/${ev.token}`), 'the kill token rides in the chromium cmdline')
    // lifecycle: the leaked decoy is DEAD and the profile dir is GONE — swept by token
    assert.deepEqual(pgrepf(ev.token), [], 'no process carrying the token survives the run')
    assert.ok(!existsSync(`/tmp/${ev.token}`), 'the profile dir is removed')
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
    assert.ok(!existsSync(`/tmp/${ev.token}`))
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
    assert.ok(!existsSync(`/tmp/${ev.token}`), 'the profile dir is removed after a timeout kill')
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
    probeCheck({ id: 'SC-002', files: ['tests/acceptance/sc-001.probe.json'], timeout_s: probeTimeoutS, spec }),
    template,
  )
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

test('kiln-law run stage-level sweeps: a probe-executing run is BRACKETED — pre-flight sweep of the WHOLE kiln-pw- namespace reaps a prior crashed run\'s litter BEFORE any probe spawns; a runId end sweep fires after all probes finish', async () => {
  const { proj, kiln } = makeLawFixture()
  // the prior crashed run: a live orphan whose cmdline carries a token THIS run cannot know,
  // plus its stale profile dir (#1311's stale-SingletonLock class) — only a namespace-wide
  // pre-flight sweep can reach either.
  const staleTag = `stale${process.pid}${Date.now().toString(36)}`
  const orphan = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)', '--', `--user-data-dir=/tmp/kiln-pw-${staleTag}`], { detached: true, stdio: 'ignore' })
  orphan.unref()
  mkdirSync(`/tmp/kiln-pw-${staleTag}`, { recursive: true })
  try {
    const deadline = Date.now() + 5000
    while (pgrepf(`kiln-pw-${staleTag}`).length !== 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.equal(pgrepf(`kiln-pw-${staleTag}`).length, 1, 'the prior-run orphan is alive before the run')
    const res = lawCli(['run', proj, kiln, '--only', 'SC-001,SC-002'], { KILN_FAKE_PW_MODE: 'pass' })
    assert.equal(res.status, 0, res.stderr + res.stdout)
    // pre-flight: whole-namespace, and BEFORE the probe executed — stale litter cannot poison the launch
    const pre = res.stdout.match(/^SWEEP pattern=kiln-pw- killed=\d+.*$/m)
    assert.ok(pre, 'the pre-flight sweep line is namespace-wide (bare kiln-pw- pattern)')
    assert.ok(res.stdout.indexOf(pre[0]) < res.stdout.indexOf('GREEN SC-002'), 'pre-flight fires BEFORE any probe runs')
    assert.deepEqual(pgrepf(`kiln-pw-${staleTag}`), [], 'the prior-run orphan is dead — reaped by the pre-flight sweep')
    assert.ok(!existsSync(`/tmp/kiln-pw-${staleTag}`), 'its stale profile dir is removed')
    // run-end: this run's token prefix, AFTER all checks finished
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    const post = res.stdout.match(new RegExp(`^SWEEP pattern=kiln-pw-${runId} .*$`, 'm'))
    assert.ok(post, 'the run-end sweep is scoped to THIS run\'s token prefix')
    assert.ok(res.stdout.indexOf(post[0]) > res.stdout.indexOf('RESULT '), 'the end sweep fires after all probes finish')
  } finally {
    spawnSync('pkill', ['-9', '-f', `kiln-pw-${staleTag}`], { stdio: 'ignore' })
    rmSync(`/tmp/kiln-pw-${staleTag}`, { recursive: true, force: true })
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
