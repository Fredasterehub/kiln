#!/usr/bin/env node
// kiln-probe.mjs — the Tier-1 probe wrapper CLI (BLUEPRINT §7). Zero dependencies, plain node ≥18.
//
// THE LAW OF THIS PHASE: the browser is a subprocess with a deadline, never a service. This CLI
// owns the WHOLE lifecycle around one probe-template spawn — serve, deadline, evidence, teardown —
// so no browser process can outlive the check that spawned it: every spawn carries a unique kill
// token (`kiln-pw-<token>` in the chromium cmdline via --user-data-dir; the managed server's
// process group recorded in /tmp/<token>.server.pid — its own cmdline carries no token), the
// template runs under `timeout --kill-after=10 90` semantics (spawnSync timeout + SIGKILL), and
// the finally path ALWAYS kills the managed server group, sweeps the token namespace (pattern
// kill + pidfile group kill), and removes the profile dir — pass, fail, timeout, or crash alike.
// A wrapper SIGKILLed at the OUTER deadline never reaches that finally: the token-named pidfile
// is what lets the caller's `kiln-probe sweep <runId>` reap the orphaned server tree too. The
// builder NEVER gets a browser; agents call this CLI (or kiln-law run, which calls it per probe
// check) and read evidence files.
//
//   run <projectPath> <kilnDir> <SC-id> <runId>
//       Reads the probe spec from <kilnDir>/law.json (kind:'probe' entries carry `spec` — written
//       by Asimov at Law time; schema-validated here, TAMPER-anchored by kiln-law, which is the
//       gated path to this command). Serves the app: spec.serve_cmd under a managed PID with its
//       own deadline (`timeout --kill-after=10 <s>` around the command — the server has a
//       deadline even if this process dies), else kiln's built-in node:http static server (no
//       npx, no deps) rooted at projectPath[/serve_dir] on an ephemeral port. Executes
//       probe-template.mjs against the served base URL, then writes evidence into
//       <kilnDir>/evidence/<runId>/: probe-<SC>.spec.json (the exact spec executed),
//       probe-<SC>.log (template stdout+stderr), probe-<SC>.json (the result line: mapped
//       verdict + parsed PROBE_RESULT + hashes), screenshots (written by the template), and
//       probe-<SC>-server.log when a serve_cmd ran. Exit codes — the build spine keys on them
//       mechanically: 0 pass · 1 assert-fail (or infra/usage error) · 78 unavailable (playwright
//       absent — capability tier, NEVER folded green) · 79 timeout (hard-killed at the deadline).
//   sweep [token-prefix]
//       Stage-level pre/post sweep, THREE arms over the token namespace: (1) every
//       /tmp/kiln-pw-<prefix>*.server.pid file (written at serve_cmd spawn — the managed server
//       carries no token in its own cmdline, so it is killed by recorded process GROUP, with a
//       recycled-PID guard comparing the live leader's cmdline against the recorded command);
//       (2) SIGKILL every process whose cmdline carries `kiln-pw-<prefix>` (browsers + orphaned
//       templates — the token rides in their argv); (3) remove matching /tmp/kiln-pw-<prefix>*
//       profile dirs and pidfiles. Targeted by construction — the pattern always starts with the
//       kiln-pw- namespace, so the operator's own browser can never match (blanket `pkill -f
//       chrome` is forbidden). No prefix sweeps the whole kiln-pw- namespace (the pre-flight
//       defense against prior crashed runs). Always exits 0 — cleanup never fails a stage.
//
// KILN_PROBE_TIMEOUT_S overrides the 90 s probe deadline — harness escape hatch ONLY (the fixture
// fake-browser drills prove timeout-kill without waiting 90 real seconds); never set it in a run.

import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, statSync, openSync, closeSync } from 'node:fs'
import { join, resolve, normalize, extname, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

import { validateLaw } from '../src/law.mjs'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'probe-template.mjs')
const PROBE_TIMEOUT_S = (() => {
  const v = Number(process.env.KILN_PROBE_TIMEOUT_S)
  return Number.isInteger(v) && v >= 1 ? v : 90 // §7 hard bound: wall-clock 90 s/probe
})()
const SERVER_TIMEOUT_S = PROBE_TIMEOUT_S + 90 // the managed server's own deadline — outlives the probe, never the stage
const SERVER_READY_TIMEOUT_MS = (() => {
  const v = Number(process.env.KILN_PROBE_READY_TIMEOUT_MS) // harness escape hatch ONLY — never set in a run
  return Number.isInteger(v) && v >= 1 ? v : 15000
})()
const TOKEN_SAFE_RE = /^[A-Za-z0-9._-]*$/ // tokens/prefixes are pkill -f patterns — keep the charset inert

const die = (msg, code = 1) => { console.error(`kiln-probe: ${msg}`); process.exit(code) }
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// ── sweep — targeted kill by token namespace, never blanket ─────────────────────────────────────
// leaderCmdline(pid) — the recycled-PID guard's eyes: the live cmdline of <pid>, NULs flattened
// to spaces ('' if the process is gone, a zombie, or unreadable). /proc first (Linux), `ps`
// fallback elsewhere — when NEITHER can see the process, the guard refuses to kill (fail-safe:
// never SIGKILL a group we cannot identify).
function leaderCmdline(pid) {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ') } catch { /* no /proc arm */ }
  try { return spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '' } catch { return '' }
}
function sweep(prefix) {
  const pattern = `kiln-pw-${prefix}`
  let names = []
  try { names = readdirSync('/tmp') } catch { /* no /tmp listing — nothing to remove */ }
  const matching = names.filter((n) => n.startsWith(pattern))
  // arm 1 — managed serve_cmd groups, killed by recorded PGID from the token-named pidfile: the
  // server's own cmdline carries NO token (its command is the user's, verbatim), so the pattern
  // arms below can never reach it. The wrapper records {pgid, cmd} at spawn; a wrapper SIGKILLed
  // at the OUTER deadline (kiln-law's timeout_s) never runs its finally — THIS arm is what reaps
  // its orphaned server tree (discipline-spec lifecycle step 4: the app server is torn down with
  // the check/stage, never left to its own deadline). Recycled-PID guard: kill ONLY when the
  // live group leader's cmdline still contains the recorded command.
  let serversKilled = 0
  for (const name of matching) {
    if (!name.endsWith('.server.pid')) continue
    try {
      const rec = JSON.parse(readFileSync(join('/tmp', name), 'utf8'))
      const pgid = Number(rec.pgid)
      if (Number.isInteger(pgid) && pgid > 1 && typeof rec.cmd === 'string' && rec.cmd && leaderCmdline(pgid).includes(rec.cmd)) {
        process.kill(-pgid, 'SIGKILL')
        serversKilled++
      }
    } catch { /* unreadable pidfile or dead group — nothing to kill; the rm arm drops the file */ }
  }
  // arm 2 — pgrep first (the leak detector), then SIGKILL survivors whose cmdline carries the
  // token (browsers via --user-data-dir, orphaned templates via argv) — pkill exits 1 on
  // "no match", which is the clean case, so exit codes are read, not trusted blindly.
  const found = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' })
  const pids = (found.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)
  if (pids.length) spawnSync('pkill', ['-9', '-f', pattern], { stdio: 'ignore' })
  // arm 3 — profile dirs AND pidfiles, removed AFTER both kill arms
  let removed = 0
  for (const name of matching) {
    try { rmSync(join('/tmp', name), { recursive: true, force: true }); removed++ } catch { /* in-use dir — the next sweep gets it */ }
  }
  console.log(`SWEEP pattern=${pattern} killed=${pids.length} server_groups_killed=${serversKilled} removed=${removed}`)
}

// ── the built-in static server — node:http, no npx, no deps ─────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.wasm': 'application/wasm',
}
function startStaticServer(rootDir) {
  const server = createServer((req, res) => {
    try {
      let p = normalize(join(rootDir, decodeURIComponent(new URL(req.url, 'http://probe').pathname)))
      if (p !== rootDir && !p.startsWith(rootDir + '/')) { res.writeHead(403); res.end('forbidden'); return }
      if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html')
      if (!existsSync(p)) { res.writeHead(404); res.end('not found'); return }
      res.writeHead(200, { 'content-type': MIME[extname(p).toLowerCase()] || 'application/octet-stream' })
      res.end(readFileSync(p))
    } catch { res.writeHead(500); res.end('error') }
  })
  return new Promise((resolveP, rejectP) => {
    server.once('error', rejectP)
    server.listen(0, '127.0.0.1', () => resolveP({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }))
  })
}

// ── run — one probe, full lifecycle ──────────────────────────────────────────────────────────────
async function cmdRun(projectPath, kilnDir, scId, runId) {
  let law
  try { law = JSON.parse(readFileSync(join(kilnDir, 'law.json'), 'utf8')) } catch (e) { die(`run: cannot read ${join(kilnDir, 'law.json')} — ${e.message}`) }
  const { ok, errors } = validateLaw(law)
  if (!ok) die(`run: law.json violates the schema:\n  ${errors.map((e) => e.message).join('\n  ')}`)
  const check = law.checks.find((c) => c.id === scId)
  if (!check) die(`run: no check '${scId}' in law.json`)
  if (check.kind !== 'probe') die(`run: check '${scId}' is kind '${check.kind}', not 'probe'`)
  if (!check.spec) die(`run: check '${scId}' is an un-instantiated probe template (no spec) — kiln-law run defers it; there is nothing to execute`)
  const spec = check.spec

  const runDir = join(kilnDir, 'evidence', runId)
  mkdirSync(runDir, { recursive: true })
  // the unique kill token, FULLY namespaced (kiln-pw-<runId>-<SC>-<entropy>): a stage/run sweep
  // by runId-prefix catches everything this spawn created, the entropy tail keeps SC retries
  // from colliding, and the token is passed VERBATIM into the template's argv — so even a
  // template orphaned by an outer SIGKILL of this wrapper matches the sweep pattern and dies.
  const token = `kiln-pw-${runId}-${scId}-${Date.now().toString(36)}`.replace(/[^A-Za-z0-9._-]/g, '-')
  const specFile = join(runDir, `probe-${scId}.spec.json`)
  writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n') // the exact spec executed is itself evidence

  let serverProc = null // managed serve_cmd PID (a detached process group)
  let staticServer = null // in-process node:http
  let baseUrl
  let serverLogFd = null
  const started = Date.now()
  let exit = 1
  let mapped = 'fail'
  let templateExit = null
  let timedOut = false
  let logContent = ''
  let result = null
  try {
    // 1. serve
    let serveFailed = false
    if (spec.serve_cmd) {
      baseUrl = spec.base_url
      serverLogFd = openSync(join(runDir, `probe-${scId}-server.log`), 'w')
      // the server gets ITS OWN deadline via coreutils timeout — bounded even if this process is
      // SIGKILLed mid-run — and a detached process group so teardown kills the whole tree.
      serverProc = spawn('timeout', ['--kill-after=10', String(SERVER_TIMEOUT_S), 'bash', '-c', spec.serve_cmd], {
        cwd: projectPath, detached: true, stdio: ['ignore', serverLogFd, serverLogFd],
      })
      serverProc.unref()
      // the token-named server pidfile — the server's OWN cmdline carries no token (it is the
      // user's command, verbatim), so a `pkill -f kiln-pw-…` sweep can never reach it. Recording
      // {pgid, cmd} under /tmp/<token>.server.pid puts the server tree INSIDE the token
      // namespace: if THIS wrapper is SIGKILLed at the outer deadline (kiln-law's timeout_s) and
      // the finally below never runs, the follow-up `kiln-probe sweep <runId>` reads this file
      // and kills the whole detached group — the server never outlives the check that spawned
      // it, deadline or not (the in-cmdline deadline above is the LAST resort, not the contract).
      try { writeFileSync(`/tmp/${token}.server.pid`, JSON.stringify({ pgid: serverProc.pid, cmd: spec.serve_cmd }) + '\n') } catch { /* unwritable /tmp — the group's own deadline still bounds it */ }
      // readiness: ANY http response counts (the probe itself asserts status) — a dead server
      // inside the window is the app failing its SC, reported as a probe failure, never a hang.
      const deadline = Date.now() + SERVER_READY_TIMEOUT_MS
      let ready = false
      while (Date.now() < deadline) {
        try { await fetch(baseUrl + spec.url, { signal: AbortSignal.timeout(2000) }); ready = true; break } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!ready) {
        logContent = `serve_cmd never answered at ${baseUrl} within ${SERVER_READY_TIMEOUT_MS}ms — see probe-${scId}-server.log\n`
        console.log(`FAIL ${logContent.trim()}`)
        exit = 1; mapped = 'fail'; serveFailed = true
      }
    } else {
      const root = spec.serve_dir ? resolve(projectPath, spec.serve_dir) : resolve(projectPath)
      const s = await startStaticServer(root)
      staticServer = s.server
      baseUrl = s.baseUrl
    }

    if (!serveFailed) {
      // 2. the one-shot probe under the hard deadline — timeout --kill-after=10 90 semantics:
      // spawnSync's timeout fires SIGKILL on the template; surviving browser children (SIGKILL
      // skips the template's finally) are exactly what the token sweep below is for.
      const res = spawnSync(process.execPath, [TEMPLATE, projectPath, specFile, baseUrl, runDir, `probe-${scId}`, token], {
        encoding: 'utf8', timeout: PROBE_TIMEOUT_S * 1000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
      })
      timedOut = res.signal === 'SIGKILL' || (res.error && res.error.code === 'ETIMEDOUT')
      templateExit = res.status
      logContent = `$ probe-template ${scId} → ${baseUrl}${spec.url}\n--- stdout ---\n${res.stdout || ''}\n--- stderr ---\n${res.stderr || ''}\n` +
        `--- template exit ${templateExit === null ? 'killed' : templateExit}${timedOut ? ` TIMEOUT after ${PROBE_TIMEOUT_S}s` : ''} ---\n`
      const m = (res.stdout || '').match(/^PROBE_RESULT (.*)$/m)
      if (m) { try { result = JSON.parse(m[1]) } catch { result = null } }
      if (timedOut) { exit = 79; mapped = 'timeout' } else if (templateExit === 0) { exit = 0; mapped = 'pass' } else if (templateExit === 78) { exit = 78; mapped = 'unavailable' } else { exit = 1; mapped = 'fail' }
    }
  } catch (e) {
    logContent += `infra: ${e.message}\n`
    exit = 1; mapped = 'fail'
  } finally {
    // 3. ALWAYS — pass, fail, timeout, crash: kill the server, sweep the token, drop the profile.
    if (serverProc) {
      try { process.kill(-serverProc.pid, 'SIGKILL') } catch { /* group already gone */ }
      try { serverProc.kill('SIGKILL') } catch { /* already gone */ }
    }
    if (serverLogFd !== null) { try { closeSync(serverLogFd) } catch { /* closed */ } }
    if (staticServer) { try { staticServer.close() } catch { /* closed */ } }
    sweep(token.slice('kiln-pw-'.length)) // sweep() namespaces its prefix — hand it the bare token tail

    // 4. evidence — written before exit so even a failed teardown leaves the record
    const logFile = join(runDir, `probe-${scId}.log`)
    writeFileSync(logFile, logContent)
    const screenshots = (result && Array.isArray(result.screenshots)) ? result.screenshots : []
    writeFileSync(join(runDir, `probe-${scId}.json`), JSON.stringify({
      schema: 1, sc_id: scId, run_id: runId, token, exit, mapped, template_exit: templateExit,
      duration_ms: Date.now() - started, base_url: baseUrl || null, served: spec.serve_cmd ? 'serve_cmd' : 'static',
      spec_file: specFile, result, screenshots, log_sha256: sha256(logContent),
    }, null, 2) + '\n')

    if (mapped === 'unavailable') console.log(`PROBE_UNAVAILABLE ${scId}`)
    if (mapped === 'timeout') console.log(`PROBE_TIMEOUT ${scId} — hard-killed at ${PROBE_TIMEOUT_S}s; survivors swept by token`)
    console.log(`PROBE ${scId} exit=${exit} mapped=${mapped} (${Date.now() - started}ms)`)
  }
  return exit
}

// ── Dispatch ─────────────────────────────────────────────────────────────────────────────────────
const USAGE = `usage: kiln-probe.mjs run <projectPath> <kilnDir> <SC-id> <runId> | kiln-probe.mjs sweep [token-prefix]`
const [cmd, ...rest] = process.argv.slice(2)
try {
  if (cmd === 'run') {
    const [projectPath, kilnDir, scId, runId] = rest
    if (!projectPath || !kilnDir || !scId || !runId || rest.length !== 4 || !isAbsolute(projectPath)) die(USAGE)
    // runId becomes an evidence path segment AND a sweep-prefix — keep it in the inert charset
    if (!TOKEN_SAFE_RE.test(runId) || runId === '') die(`run: runId may only contain [A-Za-z0-9._-]`)
    process.exit(await cmdRun(resolve(projectPath), resolve(kilnDir), scId, runId))
  } else if (cmd === 'sweep') {
    const [prefix] = rest
    if (rest.length > 1) die(USAGE)
    const p = prefix === undefined ? '' : prefix
    if (!TOKEN_SAFE_RE.test(p)) die(`sweep: token-prefix may only contain [A-Za-z0-9._-] — it is a pkill -f pattern`)
    sweep(p)
    process.exit(0)
  } else die(USAGE)
} catch (e) { die(e.message) }
