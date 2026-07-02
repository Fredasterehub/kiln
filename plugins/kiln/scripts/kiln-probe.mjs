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
//   run <projectPath> <kilnDir> <SC-id> <runId> [--lease <token>]
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
//       mechanically: 0 pass · 1 assert-fail (or infra/usage error) · 77 LEASE_EXPIRED (a Tier-2
//       lease was in force and is absent/expired/token-mismatched — the capability deadline reached;
//       refused BEFORE any browser launches) · 78 unavailable (playwright absent — capability tier,
//       NEVER folded green) · 79 timeout (hard-killed at the deadline). A lease is enforced ONLY when
//       --lease/KILN_PROBE_LEASE demands it or a browser.lease already sits in this runId's dir, so
//       Tier-1 build probes (no lease) keep working unchanged.
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
//   lease <kilnDir> <runId> <token> <seconds>
//       TAKE the validate Tier-2 browser lease — the §7 CAPABILITY deadline (ORCHESTRATOR RULING).
//       A workflow cannot CANCEL a spawned agent, so the ≤10-min Tier-2 cap is enforced on the
//       capability: writes <kilnDir>/evidence/<runId>/browser.lease {token, expires_at, watchdog_pid}
//       and spawns a DETACHED, timeout-wrapped, self-terminating watchdog that at expiry sweeps the
//       kiln-pw-<token> namespace and deletes the lease (so a browser launched past the cap dies even
//       if the workflow never runs its own cleanup). The lease runId IS the lease token (the stage's
//       VALIDATE_RUN_TOKEN), so an evaluator probe under runId '<token>-…' is inside the leased
//       namespace by construction. Always exits 0.
//   lease-release <kilnDir> <runId>
//       RELEASE the lease at stage end: kill the watchdog (teardown is NOW, not at the deadline),
//       sweep kiln-pw-<token> immediately, delete the lease file. No-op when no lease is present.
//       Always exits 0 — release is cleanup, never a verdict.
//   mcp-sweep
//       The backstop for the ONE browser the kiln-pw- token cannot tag: a HOST-configured Playwright
//       MCP browser. Autonomous validate NO LONGER drives MCP (the ORCHESTRATOR RULING removed the
//       MCP traversal path — an MCP server is a persistent browser service §7 forbids in-loop), so
//       this is now a CAPABILITY for the operator's INTERACTIVE/manual visual QA: an interactive MCP
//       session (launched without our --isolated/--user-data-dir, PID unkillable by us, no kiln token
//       in its browser) is told to browser_close, but prompt text is not a teardown guarantee (#1311
//       strands a Chrome on a SingletonLock; codex#17832/claude-code#15861 orphan MCP browser
//       children). Run this by hand after such a session to reap a leaked orphan. This SIGKILLs an
//       orphaned MCP browser under a DOUBLE gate so it can never over-reach: a target must have BOTH
//       (a) a browser-binary arg0 (chrome / chromium / chrome-headless-shell / headless_shell) AND (b)
//       a --user-data-dir into the `ms-playwright/mcp-` profile namespace (rides every Playwright-MCP
//       browser's cmdline). The operator's own Chrome (a non-mcp profile) is spared by (b); a shell,
//       editor, grep, or our own command that merely NAMES an mcp- path is spared by (a) — so it is far
//       more targeted than a blanket `pkill -f` and can never reap a non-browser process. It does NOT
//       touch the @playwright/mcp SERVER node process (the host's shared service to reap; a later
//       correction-cycle evaluator may reuse it) — only the orphaned browser. No args. Always exits 0 —
//       cleanup never fails a stage.
//   leak-scan
//       STRICTLY READ-ONLY detection of a browser we do NOT own — the eye the sweeps lack (RUN-B
//       FINDING 3b: a tribunal analyst drove the host's Playwright-MCP browser mid-build, in a namespace
//       NO kiln sweep watches). Kills NOTHING, removes NOTHING, by construction — the operator's MCP
//       servers and browsers survive every scan (operator law). Two arms:
//       (a) process arm — pgrep candidates over the two FOREIGN namespaces (the Playwright temp-profile
//           family `playwright_<browser>dev_profile-`, which MUST cover `playwright_chromiumdev_profile-`,
//           the namespace the real leak used, AND `ms-playwright/mcp-`), each CONFIRMED by mcp-sweep's
//           two-factor discipline (a browser-binary arg0 AND a --user-data-dir into a watched namespace)
//           — read-only is no excuse to ledger a shell/editor/grep that merely NAMES a path. A cmdline
//           carrying `kiln-pw-` is EXCLUDED (owned — sweep's jurisdiction); self (this pid) is skipped.
//       (b) disk arm — /tmp entries in the Playwright temp-profile family, reported with mtime (a dead
//           leak's abandoned profile dir is still leak evidence). The `ms-playwright` cache tree is NOT
//           scanned on disk — the operator's legitimate MCP install lives there permanently.
//       Prints human summary lines + ONE machine line `LEAK_SCAN {json}` (the PROBE_RESULT idiom; parse
//       with /^LEAK_SCAN (.*)$/m) carrying { schema:1, suspects:[{pid, arg0, namespace, user_data_dir}],
//       profile_dirs:[{path, mtime}], counts:{suspects, profile_dirs} } — mtime is an ISO-8601 string.
//       Takes no args. ALWAYS exits 0 — a scan is a report; suspects are DATA, never a kill, never a fail.
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

// ── mcp-sweep — the backstop for the ONE browser the workflow cannot token-tag ───────────────────
// The scripted kiln-probe path above is leak-proof by construction: every browser it spawns rides a
// unique `kiln-pw-<token>` and is reaped by sweep(). Playwright MCP, when HOST-configured, is the one
// exception — its server is the session host's (Claude Code's) shared stdio child, launched without
// our flags, so we can neither pass it --isolated/--user-data-dir nor kill its PID (it belongs to the
// session running Kiln itself) nor ride a kiln token into its browser. Autonomous validate NO LONGER
// drives MCP (the ORCHESTRATOR RULING removed the MCP traversal path: an MCP server is a persistent
// browser service §7 forbids in-loop). MCP is now a CAPABILITY for the operator's INTERACTIVE/manual
// visual QA — an interactive session is told to browser_close, but prompt text is not a teardown
// guarantee (microsoft/playwright-mcp#1311: a client that dies without browser_close strands a Chrome
// holding a SingletonLock; codex#17832 / claude-code#15861: hosts demonstrably orphan MCP browser
// children). THIS is the process-level backstop the operator runs by hand after an interactive session.
//
// What it reaps — ONLY MCP-managed browser processes, by their PROFILE NAMESPACE, never blanket: a
// Playwright-MCP browser always carries `--user-data-dir=<…>/ms-playwright/mcp-<channel>-<hash>` in
// its cmdline (deepwiki.com/microsoft/playwright-mcp; verified on box: ~/.cache/ms-playwright/mcp-…).
// The operator's own interactive Chrome lives under ~/.config/google-chrome (or the OS default), NEVER
// under `ms-playwright/mcp-`, so this pattern is as targeted as the `kiln-pw-` namespace and can no
// more reap a neighbor than sweep() can — blanket `pkill -f chrome` stays forbidden. It deliberately
// does NOT touch the `@playwright/mcp` SERVER node process: that is the host's shared service to reap
// (discipline-spec: a stdio MCP server inherits its host's process reaping), and the operator may
// legitimately reuse it in a later interactive session. We reap the orphaned BROWSER, not the server.
//
// The shared browser-identity gates — the two-factor discipline mcp-sweep and leak-scan both apply to a
// pgrep candidate before acting on it (KILL for mcp-sweep, REPORT for leak-scan): a real target has a
// browser-binary arg0 AND a --user-data-dir into a watched profile namespace. PW_TMP_PROFILE is the
// extra Playwright temp-profile family leak-scan watches (the namespace Run B's real leak rode).
const BROWSER_BIN = /(?:^|\/)(?:chrom(?:e|ium)(?:-headless-shell)?|headless_shell)\b/i // the documented browser set ONLY (chrome / chromium / chrome-headless-shell / headless_shell) — NOT chrome_crashpad_handler (the crash-reporter helper, not a browser; killing it would not reap a browser and widens the gate past the stated arg0 set)
const MCP_PROFILE = /--user-data-dir=\S*ms-playwright\/mcp-/ // the Playwright-MCP profile-namespace half of the two-factor gate
const PW_TMP_PROFILE = /playwright_[a-z]+dev_profile-/ // the Playwright temp-profile family (chromium/firefox/webkit) — leak-scan's disk-arm dir-name gate and the profile half of its process two-factor
function mcpSweep() {
  const pattern = 'ms-playwright/mcp-' // candidate gate: the Playwright-MCP profile namespace (no leading dash)
  // Find candidates whose cmdline carries the ms-playwright/mcp- profile namespace, then CONFIRM each is
  // genuinely an MCP-managed BROWSER before SIGKILL — never a shell, editor, grep, or log tail that
  // merely mentions the path. A real match has BOTH (a) a browser-binary arg0 (chromium / chrome /
  // chrome-headless-shell / headless_shell) AND (b) a --user-data-dir pointing into ms-playwright/mcp-.
  // This is the recycled-PID-guard discipline applied to the MCP path: kill only what we can positively
  // identify as the orphaned browser, so the pattern can never reap the operator's own Chrome (a non-mcp
  // profile, spared by (b)), nor any non-browser process (spared by (a)), nor our own sweep command.
  const found = spawnSync('pgrep', ['-f', '--', pattern], { encoding: 'utf8' }) // '--' so pgrep never parses pattern as an option
  const candidates = (found.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)
  let killed = 0
  for (const pid of candidates) {
    if (pid === String(process.pid)) continue // never sweep ourselves
    const cmd = leaderCmdline(pid)
    if (!cmd) continue // gone / unreadable — never kill what we cannot identify (fail-safe)
    if (!MCP_PROFILE.test(cmd)) continue // not an MCP profile browser (names the path without the --user-data-dir flag)
    if (!BROWSER_BIN.test(cmd.split(/\s+/)[0] || '')) continue // arg0 is not a browser binary (a shell/editor mentioning the path)
    try { process.kill(Number(pid), 'SIGKILL'); killed++ } catch { /* already gone */ }
  }
  console.log(`MCP_SWEEP pattern=${pattern} killed=${killed}`)
}

// ── leak-scan — READ-ONLY: name the foreign browser, never kill it (RUN-B FINDING 3b) ─────────────
// The one gap the sweeps above cannot see. sweep() reaps only the OWNED `kiln-pw-` namespace; mcp-sweep
// is the operator's MANUAL kill of an orphaned MCP browser. Neither is an EYE the autonomous path can
// use to say "a browser I do not own is alive right now" — which is exactly what Run B needed when a
// tribunal analyst drove the host's Playwright-MCP browser mid-build, in the `playwright_chromiumdev_
// profile-*` / `ms-playwright/mcp-` namespaces no sweep watches. leak-scan is that eye and ONLY an eye:
// it NEVER kills, NEVER removes — the operator's MCP servers and browsers survive every scan by
// construction (operator law). It applies the SAME two-factor discipline mcp-sweep uses (browser arg0 +
// watched-namespace --user-data-dir) so read-only never becomes false-positive: a shell/editor/grep
// that merely mentions a watched path is not a suspect, and the ledger never carries one.
function leakScan() {
  // process arm — one pgrep per foreign namespace family; a candidate is only a NARROWING, every one is
  // two-factor CONFIRMED below before it is named. Read-only does not excuse a false positive: a shell
  // or log-tail that merely mentions a watched path must never land in the ledger as a live browser.
  const suspects = []
  const seen = new Set()
  for (const nsPattern of ['playwright_', 'ms-playwright/mcp-']) {
    const found = spawnSync('pgrep', ['-f', '--', nsPattern], { encoding: 'utf8' }) // '--' so pgrep never parses the pattern as an option
    for (const pid of (found.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (pid === String(process.pid) || seen.has(pid)) continue // never scan ourselves; a browser can match both pgreps
      const cmd = leaderCmdline(pid)
      if (!cmd) continue // gone / unreadable — never name what we cannot read (fail-safe)
      if (cmd.includes('kiln-pw-')) continue // the OWNED namespace — sweep's jurisdiction, never a foreign suspect
      if (!BROWSER_BIN.test(cmd.split(/\s+/)[0] || '')) continue // arg0 is not a browser binary (a shell/editor naming the path)
      const udd = (cmd.match(/--user-data-dir=(\S+)/) || [])[1]
      if (!udd) continue // no --user-data-dir flag — the path is only named in other args, not the two-factor gate
      let namespace = null
      const pw = udd.match(PW_TMP_PROFILE)
      if (pw) namespace = pw[0] // e.g. 'playwright_chromiumdev_profile-'
      else if (MCP_PROFILE.test(cmd)) namespace = 'ms-playwright/mcp-'
      if (!namespace) continue // the --user-data-dir points at neither WATCHED namespace
      seen.add(pid)
      suspects.push({ pid: Number(pid), arg0: cmd.split(/\s+/)[0], namespace, user_data_dir: udd })
    }
  }
  // disk arm — /tmp entries in the Playwright temp-profile family, with mtime: a dead leak's abandoned
  // profile dir is still leak evidence. ms-playwright/ is NEVER scanned on disk — the operator's
  // legitimate MCP install lives there permanently, and a scan is no place to second-guess it.
  const profileDirs = []
  let names = []
  try { names = readdirSync('/tmp') } catch { /* no /tmp listing — nothing to report */ }
  for (const name of names) {
    if (!name.startsWith('playwright_') || !PW_TMP_PROFILE.test(name)) continue // the family, anchored at the name start
    const path = join('/tmp', name)
    try { profileDirs.push({ path, mtime: statSync(path).mtime.toISOString() }) } catch { /* vanished mid-scan — not evidence */ }
  }
  const result = { schema: 1, suspects, profile_dirs: profileDirs, counts: { suspects: suspects.length, profile_dirs: profileDirs.length } }
  console.log(`LEAK_SCAN_SUSPECTS ${suspects.length}${suspects.length ? ' — ' + suspects.map((s) => `pid ${s.pid} [${s.namespace}]`).join(', ') : ' — no foreign browser alive'}`)
  console.log(`LEAK_SCAN_PROFILE_DIRS ${profileDirs.length} — abandoned Playwright temp profiles under /tmp`)
  console.log(`LEAK_SCAN ${JSON.stringify(result)}`)
}

// ── the browser lease — the §7 CAPABILITY deadline (ORCHESTRATOR RULING, p3/tasks.md) ────────────
// A workflow script cannot CANCEL a spawned agent, so the Tier-2 deadline is enforced on the
// CAPABILITY, not the agent: an evaluator alive past the cap is harmless because every browser
// action it can take goes through a one-shot `kiln-probe run`, and `run` REFUSES once the lease has
// expired. The lease file lives at <kilnDir>/evidence/<leaseRunId>/browser.lease and carries
// { token, expires_at (unix s), watchdog_pid }. The lease's runId IS the lease token (the validate
// stage's VALIDATE_RUN_TOKEN), so an evaluator probe under runId '<token>-<suffix>' is INSIDE the
// leased namespace by construction — the token-match is the namespace prefix, no extra secret to pass.
//
// `run` enforces the lease ONLY when it is DEMANDED (the --lease <token> flag, or KILN_PROBE_LEASE
// env) OR when a browser.lease already sits in the probe's OWN runId dir. Tier-1 build probes
// (kiln-law run → kiln-probe run, their own outer timeout_s the bound) demand no lease and write
// none, so they keep working UNCHANGED — the lease is purely the Tier-2 traversal gate.
const leaseFile = (kilnDir, leaseRunId) => join(kilnDir, 'evidence', leaseRunId, 'browser.lease')
function readLease(kilnDir, leaseRunId) {
  try {
    const l = JSON.parse(readFileSync(leaseFile(kilnDir, leaseRunId), 'utf8'))
    if (l && typeof l === 'object' && typeof l.token === 'string' && Number.isFinite(Number(l.expires_at))) return l
  } catch { /* absent or malformed — the caller treats it as no usable lease */ }
  return null
}
// leaseStatus(kilnDir, leaseToken, runId) — the run-time gate verdict over a DEMANDED lease.
// Returns { ok:true } or { ok:false, why } (why → the exit-77 message). A lease is honored ONLY when
// the file exists, its token equals the demanded token, the runId is inside that token's namespace
// (runId === token OR runId starts with '<token>-'), and now() has not passed expires_at. Anything
// else fails CLOSED (no browser): absent / malformed / token-mismatch / out-of-namespace / expired.
function leaseStatus(kilnDir, leaseToken, runId) {
  const l = readLease(kilnDir, leaseToken)
  if (!l) return { ok: false, why: `LEASE_EXPIRED no usable lease at ${leaseFile(kilnDir, leaseToken)} for token '${leaseToken}'` }
  if (l.token !== leaseToken) return { ok: false, why: `LEASE_EXPIRED lease token '${l.token}' does not match the demanded token '${leaseToken}'` }
  if (runId !== leaseToken && !runId.startsWith(`${leaseToken}-`)) {
    return { ok: false, why: `LEASE_EXPIRED runId '${runId}' is not inside the leased token namespace '${leaseToken}-' — a probe must run under the lease that authorized it` }
  }
  if (Math.floor(Date.now() / 1000) > Number(l.expires_at)) {
    return { ok: false, why: `LEASE_EXPIRED the browser lease for '${leaseToken}' expired at ${new Date(Number(l.expires_at) * 1000).toISOString()} — the Tier-2 deadline cap is reached; no further browser work is authorized` }
  }
  return { ok: true }
}

// cmdLease(kilnDir, leaseRunId, token, seconds) — TAKE a browser lease for the validate Tier-2
// traversal. Writes the lease file, then spawns the DETACHED self-terminating watchdog: a
// timeout-wrapped child that sleeps `seconds`, then sweeps the kiln-pw-<token> namespace and deletes
// the lease — so a browser the evaluator launched past the cap dies at the deadline even if the
// workflow never reaches its own cleanup. The watchdog PID is recorded back into the lease so
// stage cleanup / lease-release can SIGKILL it (and a clean release sweeps immediately). Always
// exits 0 — taking a lease never fails a stage (a write failure degrades to no-enforcement honestly).
function cmdLease(kilnDir, leaseRunId, token, seconds) {
  const dir = join(kilnDir, 'evidence', leaseRunId)
  const expiresAt = Math.floor(Date.now() / 1000) + seconds
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(leaseFile(kilnDir, leaseRunId), JSON.stringify({ token, expires_at: expiresAt, watchdog_pid: null }) + '\n')
  } catch (e) {
    console.log(`LEASE_TAKE_FAILED ${token} — ${e.message} (no enforcement; the stage deadline degrades to the workflow timer)`)
    return
  }
  // the watchdog: `timeout <seconds> bash -c '<sleep then sweep+delete>'`, detached + unref'd so it
  // outlives this short-lived `lease` invocation. At expiry it calls THIS CLI's own sweep (the
  // kiln-pw-<token> namespace — same targeted kill the run/stage sweeps use, never blanket) and rm's
  // the lease file. timeout is the self-terminating bound: the watchdog can never outlive the cap.
  const self = fileURLToPath(import.meta.url)
  const sweepCmd = `node ${JSON.stringify(self)} sweep ${JSON.stringify(token)}; rm -f ${JSON.stringify(leaseFile(kilnDir, leaseRunId))}`
  let watchdogPid = null
  try {
    const wd = spawn('timeout', ['--kill-after=10', String(seconds + 5), 'bash', '-c', `sleep ${seconds}; ${sweepCmd}`], {
      detached: true, stdio: 'ignore',
    })
    wd.unref()
    watchdogPid = wd.pid
    writeFileSync(leaseFile(kilnDir, leaseRunId), JSON.stringify({ token, expires_at: expiresAt, watchdog_pid: watchdogPid }) + '\n')
  } catch (e) {
    console.log(`LEASE_WATCHDOG_FAILED ${token} — ${e.message} (the lease still gates run; the workflow timer + stage sweep remain the backstop)`)
  }
  console.log(`LEASE ${token} expires_at=${expiresAt} watchdog_pid=${watchdogPid === null ? 'none' : watchdogPid}`)
}

// cmdLeaseRelease(kilnDir, leaseRunId) — RELEASE the lease at stage end: kill the watchdog (it is no
// longer needed — the stage is tearing down NOW, not at the deadline), sweep the kiln-pw-<token>
// namespace immediately, and delete the lease file (so a stale lease never blocks a later run). A
// no-op when no lease is present. Always exits 0 — release is cleanup, never a verdict.
function cmdLeaseRelease(kilnDir, leaseRunId) {
  const l = readLease(kilnDir, leaseRunId)
  if (!l) { console.log(`LEASE_RELEASE ${leaseRunId} — no lease present (no-op)`); return }
  const wd = Number(l.watchdog_pid)
  if (Number.isInteger(wd) && wd > 1) { try { process.kill(wd, 'SIGKILL') } catch { /* watchdog already self-terminated at expiry */ } }
  // sweep() builds the kill pattern as `kiln-pw-<arg>`; the lease token IS the bare runId prefix the
  // evaluator's probes namespaced their browsers under (kiln-pw-<token>-<SC>-…), so the token passes
  // straight through as the sweep prefix — reaping exactly this lease's browser trees, never blanket.
  if (typeof l.token === 'string' && TOKEN_SAFE_RE.test(l.token)) sweep(l.token)
  try { rmSync(leaseFile(kilnDir, leaseRunId), { force: true }) } catch { /* already gone */ }
  console.log(`LEASE_RELEASE ${leaseRunId} token=${l.token} watchdog_pid=${Number.isInteger(wd) ? wd : 'none'} swept`)
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
// leaseDemand: the explicit --lease <token> / KILN_PROBE_LEASE token, or null. When null, the lease
// is enforced ONLY if a browser.lease already sits in this probe's OWN runId dir (the §7 ruling's "a
// lease file exists for the runId" trigger); otherwise this is an UNLEASED probe (a Tier-1 build
// probe) and runs unchanged. When a lease IS in force and it is absent/expired/token-mismatched/
// out-of-namespace, run REFUSES with exit 77 LEASE_EXPIRED — the capability deadline, not the agent.
async function cmdRun(projectPath, kilnDir, scId, runId, leaseDemand = null) {
  const leaseToken = leaseDemand || (existsSync(leaseFile(kilnDir, runId)) ? runId : null)
  if (leaseToken) {
    const ls = leaseStatus(kilnDir, leaseToken, runId)
    if (!ls.ok) { console.error(`kiln-probe: ${ls.why}`); process.exit(77) }
  }
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
const USAGE = `usage: kiln-probe.mjs run <projectPath> <kilnDir> <SC-id> <runId> [--lease <token>] | kiln-probe.mjs sweep [token-prefix] | kiln-probe.mjs leak-scan | kiln-probe.mjs mcp-sweep | kiln-probe.mjs lease <kilnDir> <runId> <token> <seconds> | kiln-probe.mjs lease-release <kilnDir> <runId>`
const [cmd, ...rest] = process.argv.slice(2)
try {
  if (cmd === 'run') {
    // run takes the 4 positionals and an OPTIONAL trailing --lease <token>; KILN_PROBE_LEASE is the
    // env-form demand (the §7 ruling's "an env/flag demands it"). The Tier-2 evaluator passes the
    // VALIDATE_RUN_TOKEN as the lease so its probes refuse once the stage deadline has expired; a
    // Tier-1 build probe passes neither and writes none, so it runs unchanged.
    let leaseDemand = process.env.KILN_PROBE_LEASE ? String(process.env.KILN_PROBE_LEASE) : null
    const args = []
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--lease') { leaseDemand = rest[++i]; continue }
      args.push(rest[i])
    }
    const [projectPath, kilnDir, scId, runId] = args
    if (!projectPath || !kilnDir || !scId || !runId || args.length !== 4 || !isAbsolute(projectPath)) die(USAGE)
    // runId becomes an evidence path segment AND a sweep-prefix — keep it in the inert charset
    if (!TOKEN_SAFE_RE.test(runId) || runId === '') die(`run: runId may only contain [A-Za-z0-9._-]`)
    if (leaseDemand !== null && (leaseDemand === '' || !TOKEN_SAFE_RE.test(leaseDemand))) die(`run: --lease token may only contain [A-Za-z0-9._-] and must be non-empty`)
    process.exit(await cmdRun(resolve(projectPath), resolve(kilnDir), scId, runId, leaseDemand))
  } else if (cmd === 'sweep') {
    const [prefix] = rest
    if (rest.length > 1) die(USAGE)
    const p = prefix === undefined ? '' : prefix
    if (!TOKEN_SAFE_RE.test(p)) die(`sweep: token-prefix may only contain [A-Za-z0-9._-] — it is a pkill -f pattern`)
    sweep(p)
    process.exit(0)
  } else if (cmd === 'mcp-sweep') {
    if (rest.length) die(USAGE) // no args — the pattern is the fixed ms-playwright/mcp- namespace
    mcpSweep()
    process.exit(0)
  } else if (cmd === 'leak-scan') {
    if (rest.length) die(USAGE) // no args — the two watched namespaces are fixed; a scan reports, it does not target
    leakScan()
    process.exit(0)
  } else if (cmd === 'lease') {
    const [kilnDir, runId, token, secondsArg] = rest
    if (!kilnDir || !runId || !token || !secondsArg || rest.length !== 4) die(USAGE)
    if (!TOKEN_SAFE_RE.test(runId) || runId === '') die(`lease: runId may only contain [A-Za-z0-9._-]`)
    if (!TOKEN_SAFE_RE.test(token) || token === '') die(`lease: token may only contain [A-Za-z0-9._-] (it is a kiln-pw- sweep prefix)`)
    const seconds = Number(secondsArg)
    if (!Number.isInteger(seconds) || seconds < 1) die(`lease: seconds must be a positive integer`)
    cmdLease(resolve(kilnDir), runId, token, seconds)
    process.exit(0)
  } else if (cmd === 'lease-release') {
    const [kilnDir, runId] = rest
    if (!kilnDir || !runId || rest.length !== 2) die(USAGE)
    if (!TOKEN_SAFE_RE.test(runId) || runId === '') die(`lease-release: runId may only contain [A-Za-z0-9._-]`)
    cmdLeaseRelease(resolve(kilnDir), runId)
    process.exit(0)
  } else die(USAGE)
} catch (e) { die(e.message) }
