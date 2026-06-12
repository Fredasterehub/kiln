#!/usr/bin/env node
// kiln-law.mjs — the Kiln Law CLI (BLUEPRINT §5/§5.1). Zero dependencies, plain node ≥18.
//
// .kiln/law.json is the locked acceptance-check index — the test-lock spine. Asimov writes it
// pre-lock (lock_commit null, sha256 maps empty); this CLI locks, guards, and executes it.
// The §5 lock sequence is: `kiln-law index`, THEN one commit —
// `git add tests/acceptance .kiln/law.json && git commit -m "test(law): lock acceptance gates"`.
//   index  — sha256 every file in checks[].files (on disk — the gates are typically still
//            uncommitted at this point) + record lock_commit (current HEAD, the last pre-gate
//            commit) into law.json. Git's content-addressing means law.json can never carry the
//            sha of the commit that contains it, so the locked content lands in lock_commit's
//            FIRST DESCENDANT that touches it (the lock commit) — verify anchors its git arm
//            there. Refuses to re-index when the live law is locked OR a committed locked Law
//            already exists — the Law is immutable after lock (§5.1); nulling the live
//            lock_commit cannot re-open it. Refuses a projectPath with no HEAD to record (not a
//            git repo, or a repo with no commits) with a NAMED reason — creating the greenfield
//            baseline ("chore: kiln build baseline") is the architecture lock sequence's
//            pre-flight (P3.5 T2), never this CLI's job.
//   verify — the tamper gate. TRUST ROOT (§5.1 immutable-Law model): the live .kiln/law.json is
//            mutable by anything with disk access — a tamperer can launder a hash AND move
//            lock_commit in one edit — so once a locked law.json exists in git history (oldest
//            locked, schema-valid version wins; by §5 construction that is the lock commit's),
//            the gate anchors EVERYTHING on that COMMITTED Law and never trusts the live file
//            again. Three arms, ANY offender → exit 2 with one machine-readable `TAMPER: <path>`
//            line per offender; exit 0 clean:
//              0. the Law itself — the live law.json must byte-equal the committed canonical
//                 (a laundered hash map, a moved/nulled lock_commit, a deleted live file all
//                 diverge and flag `TAMPER: <law.json path>`);
//              1. re-hash — every locked path vs the canonical sha256 map (worktree edits);
//              2. git-diff — every locked path vs the commit that locked it (lock_commit itself
//                 for paths already in it; the first descendant commit that introduced the gates
//                 otherwise) — catches committed tampers even when arm 1 was laundered.
//            In the window between index and the lock commit no committed Law exists yet: the
//            gate falls back to the live (schema-validated) law.json, where the re-hash arm
//            alone guards the still-untracked gates. The workflow closes that window immediately
//            with the lock commit, and the build spine never runs inside it (architecture's
//            verifier requires the lock commit to exist before law_locked is true).
//   run    — the deterministic runner (§5.1). The tamper gate (same three arms as verify) fires
//            before EVERY check run (§5.1 tamper model), twice over:
//              · once up front, before flags are even resolved against the Law — offenders print
//                their TAMPER lines and exit 2 with NOTHING executed and no evidence written;
//              · again before EACH selected check — a check's own cmd can tamper a locked path
//                mid-batch (SC-001 rewrites locked SC-002, then SC-002 would run green against
//                tampered content). Any offender aborts the run before the next check executes:
//                TAMPER lines + exit 2; the aborted run's partial evidence is never trusted
//                (the build spine keys on exit 2 mechanically and reads nothing else).
//            Then: execute checks with cwd=projectPath
//            and the per-check timeout_s, capture stdout+stderr to
//            .kiln/evidence/<runId>/checks/<SC>.log, append {id, exit, duration_ms, log_sha256}
//            per check to .kiln/evidence/<runId>/results.jsonl, print one summary line per
//            check. The run also writes .kiln/evidence/<runId>/run.json — the §6 freshness
//            anchor, CLI-written (never agent-transcribed): {schema, run_id, head, started_at}
//            up front, plus {results_sha256, completed_at} ONLY when the run completes — the
//            build spine's freshness gate compares these against the current HEAD before any
//            reviewer spawns, and an aborted run's unfinalized manifest fails closed as stale.
//            Default is report-only (exit 0 regardless of red checks); two gates change
//            that:
//              --expect-green SC-001,SC-002 — those checks must be green NOW (hard greenness; a
//                deferred probe never satisfies it).
//              --flips SC-001,SC-002 — the §5.1 red/green LIFECYCLE gate: the declared slice
//                flips must go RED→GREEN from the recorded prior status, and every
//                previously-GREEN check that ran must STAY green (regression → exit 1 with a
//                `REGRESSION <id>` line). Prior status comes from --before <runId> (the folded
//                results of a recorded earlier run) or, absent that, the lock-time record —
//                every check expected RED at lock except `pre_satisfied: true` (brownfield
//                GREEN-at-lock, excluded from flip accounting, guarded as a regression instead).
//                Regression is asserted over the checks that actually ran — run without --only
//                for full coverage. A flip whose check folds 'deferred' (a spec-less probe
//                template, --skip-probes, or playwright absent) is exempt from flip accounting —
//                deferred is honest degradation, NEVER green.
//            P3 probe stance (BLUEPRINT §7): kind:"probe" checks with a `spec` EXECUTE via
//            kiln-probe.mjs — one bounded subprocess per probe (the browser is a subprocess with
//            a deadline, never a service; kiln-probe owns serve/deadline/sweep/evidence). The
//            probe's stdout lands in checks/<SC>.log and its exit maps mechanically:
//              0  → GREEN (results line {id, exit:0, …} like any check)
//              78 → PROBE_UNAVAILABLE — playwright absent: folds {id, deferred:
//                   "probe_unavailable"} — capability-degraded, NEVER green
//              79 → RED (probe assert deadline hit — recorded exit 79)
//              other → RED with that exit
//            Spec-less probe templates and --skip-probes still defer with a PROBE_DEFERRED line
//            and {id, deferred:"probe_deferred"}. When ANY probe deferred in a run (either
//            reason), the finalized run.json marks verification_class: "static-only" and the run
//            prints a VERIFICATION_CLASS line — degraded paths are recorded end-to-end, never
//            silently green; otherwise verification_class is "full". A probe child killed by
//            ANY signal (the outer timeout_s SIGKILL included) gets a `kiln-probe sweep <runId>`
//            fired behind it — the dead wrapper cannot sweep its own token, and the sweep reaps
//            BOTH the token-cmdline survivors (browser/template) and the managed serve_cmd
//            process group via the wrapper's /tmp/kiln-pw-<runId>-….server.pid record (the
//            server's own cmdline carries no token — lifecycle step 4: no server outlives the
//            check that spawned it).
//            STAGE-LEVEL SWEEPS (discipline-spec lifecycle step 3) bracket every probe-executing
//            run, each scoped BY TOKEN (BLUEPRINT §7: "pre- and post-stage sweeps by token, never
//            blanket pkill"): a pre-flight `kiln-probe sweep <runPrefix||runId>` fires before the
//            first check runs (it reaps THIS stage's own prior crashed runs — a sibling run under
//            the same --run-prefix that died leaving stale profiles/SingletonLocks/orphaned trees;
//            an unprefixed direct run scopes to its own unique runId, a near-no-op by construction
//            — never the whole kiln-pw- namespace, which would reap a CONCURRENT Kiln run's
//            in-flight browser), and a run-end `kiln-probe sweep <runId>` is registered on process
//            'exit' so it fires UNCONDITIONALLY on every path out — clean completion, unmet
//            expectation/flip gates (exit 1), and the mid-run tamper abort (exit 2) alike (die()
//            is process.exit, which skips finally blocks but never 'exit' handlers; sweep spawning
//            is synchronous, exit-handler-safe). The brackets exist exactly when the selection
//            contains an executable probe (spec'd, not --skip-probes): a run that launches no
//            browser HAS no browser stage to sweep. The workflow-boundary pair (build start
//            pre-flight + build-end cleanup, both ledgered, both scoped to the build's own
//            BUILD_RUN_TOKEN) is build.js's own (P3 T2), layered above these.
//   dryrun — the PRE-LOCK check executor (P3.5 T1, dogfood finding 1): checks are code; they
//            execute before we trust them — reading is not executing. Legal PRE-LOCK by design:
//            reads the LIVE law.json (schema-validated), requires NO lock_commit, fires NO
//            tamper gate, touches NO git. Executes every check with cwd=projectPath and the
//            per-check timeout_s (probes stay DEFERRED — never executed here; §7's exit-78
//            semantics belong to the locked runner and are untouched), captures a ~25-line
//            stdout/stderr tail per check, and classifies deterministically where the exit code
//            carries it (classifyDryrun, ../src/law.mjs): pytest 1 = honest-red; pytest 2/3/4/5
//            = broken-check (pytest's own taxonomy); exit 126/127 = broken-check (not
//            executable / command not found); timeout or signal-death = broken-check; exit 0 =
//            green (pre-satisfied candidate); any other nonzero = ambiguous (transcribed,
//            judged downstream — the architecture stage feeds the transcript to Athena).
//            A dry-run is a TRANSCRIPT, never a run record: no evidence dir, no run.json, no
//            results.jsonl — zero disk residue. Default output: one readable line per check +
//            one DRYRUN_RESULT summary line; --json: one JSON object {schema, transcript,
//            summary} on stdout. Exits 0 whenever the dry-run executed (the classifications ARE
//            the report — gating is the architecture stage's job); 1 only on usage/infra errors.
//   status — fold one run's results.jsonl → {green, red, deferred} JSON on stdout (green = exit
//            matched the check's expected 'exit0'; last line wins per id; law.json check order).
//   suite  — persist the PROJECT suite as hashed evidence beside a recorded Law run (§6): the
//            same tamper gate fires first (offenders → TAMPER lines + exit 2, nothing executed),
//            then --cmd runs with cwd=projectPath under --timeout-s (default 600), stdout+stderr
//            captured to .kiln/evidence/<runId>/suite.log and one
//            {cmd, exit, duration_ms, log_sha256} line appended to
//            .kiln/evidence/<runId>/suite.jsonl. suite.jsonl is a SIBLING of results.jsonl on
//            purpose: run.json finalizes sha256(results.jsonl) when the Law run completes, so
//            suite evidence appended afterwards must never touch the hashed file (the §6 hash
//            arm would read it as altered evidence). Prints `SUITE <runId> exit=<n> …` with the
//            suite's REAL exit code; the CLI itself exits 0 (suite green) / 1 (suite red or
//            infra error) — exit 2 stays reserved for tamper.
//
// law.json is validated against plugins/kiln/schemas/law.schema.json on EVERY command —
// validateLaw (../src/law.mjs) mirrors that schema field-for-field (no ajv, no deps). Which
// copy gets validated follows the trust root: index/status (and verify/run before the Law is
// committed) validate the LIVE file; once a committed Law exists, verify/run validate the
// CANONICAL committed version and byte-compare the live file against it (a diverged live law —
// including a schema-corrupted one — is TAMPER, exit 2, not a schema error).
//
// Usage:
//   kiln-law.mjs index  <projectPath> <kilnDir>
//   kiln-law.mjs verify <projectPath> <kilnDir>
//   kiln-law.mjs run    <projectPath> <kilnDir> [--only SC-001,SC-002] [--skip-probes]
//                       [--expect-green SC-001,SC-002] [--flips SC-001,SC-002] [--before <runId>]
//                       [--run-prefix <token>]   (prepended to runId so every probe this run
//                                                  spawns falls under <token>; both this run's
//                                                  pre-flight and run-end sweeps scope to that
//                                                  token, so they reap only this stage's browsers,
//                                                  never a concurrent run's)
//   kiln-law.mjs dryrun <projectPath> <kilnDir> [--json]
//   kiln-law.mjs status <kilnDir> <runId>
//   kiln-law.mjs suite  <projectPath> <kilnDir> <runId> --cmd '<command>' [--timeout-s N]
// Exit codes: 0 ok · 1 error (usage, invalid law.json, missing files, unmet --expect-green,
// unmet flip, regression, red suite) · 2 TAMPER — reserved EXCLUSIVELY for tamper-gate
// mismatches (verify, run's pre-execution gate, suite's pre-execution gate) so the build spine
// can key on it mechanically (exit 2 ⇒ slice auto-REJECTED, no reviewer spawned).

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync, existsSync } from 'node:fs'
import { join, relative, resolve, isAbsolute, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateLaw, flipPlan, classifyDryrun } from '../src/law.mjs'

// kiln-probe.mjs lives beside this CLI — the §7 Tier-1 probe wrapper kind:'probe' checks run through
const KILN_PROBE = join(dirname(fileURLToPath(import.meta.url)), 'kiln-probe.mjs')

const die = (msg, code = 1) => { console.error(`kiln-law: ${msg}`); process.exit(code) }
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const git = (projectPath, args) => execFileSync('git', ['-C', projectPath, ...args], { encoding: 'utf8' })
// boolean git probe — exit 0 ⇒ true; any failure ⇒ false (callers treat false fail-closed)
const gitOk = (projectPath, args) => { try { execFileSync('git', ['-C', projectPath, ...args], { stdio: 'ignore' }); return true } catch { return false } }

// ── law.json I/O — validated against the schema on EVERY command ─────────────────────────────────
function readLaw(kilnDir) {
  const file = join(kilnDir, 'law.json')
  if (!existsSync(file)) throw new Error(`no law.json in ${kilnDir} — Asimov has not written the Law`)
  let law
  try { law = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { throw new Error(`law.json is not valid JSON — ${e.message}`) }
  const { ok, errors } = validateLaw(law)
  if (!ok) throw new Error(`law.json violates the schema:\n  ${errors.map((e) => e.message).join('\n  ')}`)
  return { file, law }
}

// law.json writes are atomic: write a tmp file in the same dir, then rename over the target.
function writeLaw(file, law) {
  writeFileSync(file + '.tmp', JSON.stringify(law, null, 2) + '\n')
  renameSync(file + '.tmp', file)
}

const allFiles = (law) => {
  const out = []
  for (const c of law.checks) for (const p of c.files) if (!out.includes(p)) out.push(p)
  return out
}

// foldResults(resultsFile) — fold a run's results.jsonl into id → 'green'|'red'|'deferred'
// (last line wins per id, first-appearance order kept). Shared by status and run --before.
function foldResults(resultsFile) {
  const byId = {}
  const order = []
  readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).forEach((line, i) => {
    let r
    try { r = JSON.parse(line) } catch (e) { throw new Error(`results.jsonl line ${i + 1} is corrupt — ${e.message}`) }
    if (!r || typeof r.id !== 'string') throw new Error(`results.jsonl line ${i + 1} has no id`)
    if (!(r.id in byId)) order.push(r.id)
    byId[r.id] = r.deferred ? 'deferred' : (r.exit === 0 ? 'green' : 'red') // expected is 'exit0'
  })
  return { byId, order }
}

// ── the committed Law — the §5.1 trust root ──────────────────────────────────────────────────────
// The live .kiln/law.json is mutable by anything with disk access: one edit can launder a hash
// AND move lock_commit to the tamper commit, blinding any gate that reads it. The Law that
// counts is therefore the COMMITTED one — the oldest locked, schema-valid version of law.json
// in git history, which by construction of the §5 sequence (index, then ONE lock commit) is the
// lock commit's. Pre-lock versions (lock_commit null), deleted blobs, and unparseable/invalid
// candidates never qualify. History rewriting is outside the threat model: builders make
// ordinary commits; the workflow owns the repo.
function lawRelPath(projectPath, kilnDir) {
  const rel = relative(projectPath, join(kilnDir, 'law.json'))
  if (isAbsolute(rel) || rel.startsWith('..')) throw new Error(`tamper gate: ${join(kilnDir, 'law.json')} is outside projectPath ${projectPath} — the Law cannot be git-anchored`)
  return rel
}

function findCommittedLaw(projectPath, lawRel) {
  let log
  try { log = git(projectPath, ['log', '--reverse', '--format=%H', '--', lawRel]) } catch (e) { throw new Error(`tamper gate: git log for ${lawRel} failed — ${e.message}`) }
  for (const sha of log.split('\n').map((s) => s.trim()).filter(Boolean)) {
    let raw
    try { raw = git(projectPath, ['show', `${sha}:./${lawRel}`]) } catch { continue } // this commit deleted it
    let law
    try { law = JSON.parse(raw) } catch { continue }
    if (!law || law.lock_commit === null) continue // a committed PRE-lock law is not a lock
    if (!validateLaw(law).ok) continue
    return { law, raw, lockedBy: sha }
  }
  return null
}

// ── the §5.1 tamper-gate arms 1+2 — driven by tamperGate, NEVER by the live law directly ────────
// Arm 1: re-hash every locked path against the recorded sha256 — catches worktree edits/deletes.
// Arm 2 (anti-laundering): git-diff each locked path against the commit that LOCKED it. The §5
// sequence (index, THEN one "test(law): lock acceptance gates" commit) means lock_commit is the
// last PRE-gate commit: paths already in lock_commit anchor there (brownfield); paths the lock
// commit introduced anchor on the FIRST commit after lock_commit that touches them — which is
// the legit lock commit by construction, so any later tamper commit (even one that launders
// law.json's hashes) still diffs against the locked content and shows. A split-across-commits
// lock (flow violation) shows as TAMPER — fail closed.
function tamperOffenders(projectPath, law) {
  const offenders = new Set()
  for (const c of law.checks) {
    for (const p of c.files) {
      const abs = resolve(projectPath, p)
      if (!existsSync(abs) || sha256(readFileSync(abs)) !== c.sha256[p]) offenders.add(p)
    }
  }
  // --relative keeps diff output projectPath-relative so it matches law.json paths even when
  // projectPath is a repo subdirectory; the ':./' rev syntax resolves cwd-relative the same way.
  const diffNames = (anchor, paths) => {
    let out
    try { out = git(projectPath, ['diff', '--name-only', '--relative', anchor, '--', ...paths]) } catch (e) { throw new Error(`tamper gate: git diff against ${anchor} failed — ${e.message}`) }
    for (const p of out.split('\n')) if (p.trim()) offenders.add(p.trim())
  }
  const files = allFiles(law)
  const inLock = files.filter((p) => gitOk(projectPath, ['cat-file', '-e', `${law.lock_commit}:./${p}`]))
  const added = files.filter((p) => !inLock.includes(p))
  if (inLock.length) diffNames(law.lock_commit, inLock)
  if (added.length) {
    let anchor
    try { anchor = git(projectPath, ['log', '--reverse', '--format=%H', `${law.lock_commit}..HEAD`, '--', ...added]).split('\n')[0].trim() } catch (e) { throw new Error(`tamper gate: git log after lock_commit ${law.lock_commit} failed — ${e.message}`) }
    // No descendant commit touches the added gates yet (the index→lock-commit window): they are
    // untracked, git has no anchor — the re-hash arm alone guards until the lock commit lands.
    if (anchor) diffNames(anchor, added)
  }
  return [...offenders].sort()
}

// tamperGate(projectPath, kilnDir) — resolve the authoritative Law and collect ALL offenders in
// one pass. Returns { locked: false } when no Law is locked anywhere; otherwise { locked: true,
// law, lockedBy, offenders } where law is the COMMITTED canonical when one exists (lockedBy its
// commit) and the live file otherwise (lockedBy null — the index→lock-commit window).
function tamperGate(projectPath, kilnDir) {
  const lawRel = lawRelPath(projectPath, kilnDir)
  const committed = findCommittedLaw(projectPath, lawRel)
  if (committed === null) {
    // No committed Law yet: the live law.json is the only reference (schema-validated by
    // readLaw). This is the §5 index→lock-commit window — the re-hash arm guards the untracked
    // gates alone, the workflow closes the window immediately, and the build spine never runs
    // here (architecture's verifier requires the lock commit before law_locked is true).
    const { law } = readLaw(kilnDir)
    if (law.lock_commit === null) return { locked: false }
    return { locked: true, law, lockedBy: null, offenders: tamperOffenders(projectPath, law) }
  }
  const offenders = new Set(tamperOffenders(projectPath, committed.law))
  // Arm 0 — the Law itself: the live file must byte-equal the committed canonical. A laundered
  // hash map, a moved/nulled lock_commit, a schema-corrupted or deleted live file all diverge.
  let liveRaw = null
  try { liveRaw = readFileSync(join(kilnDir, 'law.json'), 'utf8') } catch { /* deleted — diverges below */ }
  if (liveRaw !== committed.raw) offenders.add(lawRel)
  return { locked: true, law: committed.law, lockedBy: committed.lockedBy, offenders: [...offenders].sort() }
}

// ── index — lock the Law: hash every listed file, record HEAD as lock_commit ────────────────────
function cmdIndex(projectPath, kilnDir) {
  const { file, law } = readLaw(kilnDir)
  if (law.lock_commit !== null) die(`index: law.json is already locked (lock_commit ${law.lock_commit}) — the Law is immutable after lock`)
  // P3.5 T2 (dogfood finding 2): index NEEDS a HEAD — it records lock_commit = HEAD. A repo-less
  // projectPath (greenfield before the lock sequence's pre-flight ran) or an unborn HEAD used to
  // die deep inside findCommittedLaw with a misleading "tamper gate: git log failed"; refuse with
  // the REAL reason and the remedy instead — the named reason flows verbatim into the lock leg's
  // error report and the conductor's law_reason escalation. Creating the baseline is the
  // architecture lock sequence's pre-flight, never this CLI's.
  if (!gitOk(projectPath, ['rev-parse', '--verify', 'HEAD'])) {
    die(`index: ${projectPath} has no git HEAD to record as lock_commit (not a git repository, or a repo with no commits) — the Law anchors in git; the lock sequence's greenfield pre-flight creates the baseline first (git init -q, then git add -A && git commit -m "chore: kiln build baseline")`)
  }
  const committed = findCommittedLaw(projectPath, lawRelPath(projectPath, kilnDir))
  if (committed) die(`index: the Law is already locked and committed (${committed.lockedBy}) — immutable after lock (§5.1); a pre-lock live law.json cannot re-open it`)
  const files = allFiles(law)
  const missing = files.filter((p) => !existsSync(resolve(projectPath, p)))
  if (missing.length) die(`index: locked file(s) missing on disk:\n  ${missing.join('\n  ')}`)
  for (const c of law.checks) {
    c.sha256 = {}
    for (const p of c.files) c.sha256[p] = sha256(readFileSync(resolve(projectPath, p)))
  }
  let head
  try { head = git(projectPath, ['rev-parse', 'HEAD']).trim() } catch (e) { die(`index: git failed in ${projectPath} — ${e.message}`) }
  law.lock_commit = head
  writeLaw(file, law)
  console.log(`kiln-law: locked ${law.checks.length} check(s), ${files.length} file(s) @ ${law.lock_commit}`)
  console.log(`kiln-law: now commit the gates — git add tests/acceptance .kiln/law.json && git commit -m "test(law): lock acceptance gates"`)
}

// ── verify — the tamper gate: the committed Law is canonical; three arms, ANY offender → 2 ──────
function cmdVerify(projectPath, kilnDir) {
  const gate = tamperGate(projectPath, kilnDir)
  if (!gate.locked) die(`verify: law.json is not locked — run 'index' first`)
  if (gate.offenders.length) {
    for (const p of gate.offenders) console.log(`TAMPER: ${p}`)
    process.exit(2)
  }
  console.log(`kiln-law: verify clean — ${allFiles(gate.law).length} locked file(s) @ ${gate.law.lock_commit}${gate.lockedBy ? ` (Law committed in ${gate.lockedBy.slice(0, 7)})` : ' (lock commit pending)'}`)
}

// ── run — the deterministic runner (§5.1): tamper gate before EVERY check, fixed cwd, per-check
//    timeout, hashed evidence, then the expectation + red/green lifecycle gates ──────────────────
function cmdRun(projectPath, kilnDir, flags) {
  for (const k of Object.keys(flags)) if (!['only', 'skip-probes', 'expect-green', 'flips', 'before', 'run-prefix'].includes(k)) die(`run: unknown flag --${k}`)
  const gate = tamperGate(projectPath, kilnDir)
  if (!gate.locked) die(`run: law.json is not locked — evidence must anchor to a locked Law; run 'index' first`)
  // §5.1 tamper model: "before EVERY check run … the runner re-hashes the locked paths against
  // law.json and diffs them against lock_commit." This first firing happens before flags are even
  // resolved against the Law — offenders ⇒ exit 2, NOTHING executed, no evidence written; the
  // build spine keys on exit 2 mechanically (slice auto-REJECTED). The gate then RE-FIRES before
  // each selected check inside the loop (assertGateBefore) — one full gate pass per check run.
  if (gate.offenders.length) {
    for (const p of gate.offenders) console.log(`TAMPER: ${p}`)
    die(`run: tamper gate failed — locked path(s) changed since lock; no check was executed`, 2)
  }
  const law = gate.law // the COMMITTED canonical once the Law is committed — never the live file
  const ids = law.checks.map((c) => c.id)
  const parseIds = (flag) => {
    if (flags[flag] === undefined) return null
    const list = String(flags[flag]).split(',').map((s) => s.trim()).filter(Boolean)
    if (!list.length) die(`run: --${flag} needs a comma-separated SC list`)
    const bad = list.filter((id) => !ids.includes(id))
    if (bad.length) die(`run: --${flag} names unknown check id(s): ${bad.join(', ')}`)
    return list
  }
  const only = parseIds('only')
  const expectGreen = parseIds('expect-green') || []
  const flips = parseIds('flips') || []
  const selected = law.checks.filter((c) => !only || only.includes(c.id))
  for (const [flag, list] of [['expect-green', expectGreen], ['flips', flips]]) {
    const outside = list.filter((id) => !selected.some((c) => c.id === id))
    if (outside.length) die(`run: --${flag} names check(s) excluded by --only: ${outside.join(', ')}`)
  }

  // statusBefore for the lifecycle gate: a recorded prior run (--before <runId>) or the
  // lock-time record (every check RED at lock; pre_satisfied carries GREEN-at-lock in law.json).
  let statusBefore = {}
  let beforeSrc = 'lock'
  if (flags.before !== undefined) {
    const f = join(kilnDir, 'evidence', String(flags.before), 'results.jsonl')
    if (!existsSync(f)) die(`run: --before run '${flags.before}' has no results.jsonl under ${kilnDir}/evidence`)
    statusBefore = foldResults(f).byId
    beforeSrc = String(flags.before)
  }
  const plan = flips.length ? flipPlan(law, flips, statusBefore) : null

  let head
  try { head = git(projectPath, ['rev-parse', 'HEAD']).trim() } catch (e) { die(`run: git failed in ${projectPath} — ${e.message}`) }
  // runId: sortable timestamp + pid — unique per invocation; the RUN line hands it (and HEAD,
  // which the build spine's freshness gate compares) to the calling agent. An optional
  // --run-prefix (the CALLER's stage-owned token) is PREPENDED so every probe this run spawns —
  // its token is kiln-pw-<runId>-<SC>-<entropy> (kiln-probe.mjs) — falls under <prefix>: a
  // stage-level `kiln-probe sweep <prefix>` then reaps ONLY this stage's survivors, never a
  // concurrent run's browsers (discipline-spec post-check cleanup is run-token scoped). The
  // prefix is a pkill -f / readdir pattern, so it shares the inert token charset; runId stays a
  // safe evidence-path segment + sweep prefix either way. Absent ⇒ the prior bare format.
  let runPrefix = ''
  if (flags['run-prefix'] !== undefined) {
    runPrefix = String(flags['run-prefix'])
    if (runPrefix === '' || !/^[A-Za-z0-9._-]+$/.test(runPrefix)) die(`run: --run-prefix may only contain [A-Za-z0-9._-] and must be non-empty — it becomes a runId/sweep prefix`)
  }
  const runId = `${runPrefix ? `${runPrefix}-` : ''}${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${process.pid}`
  const runDir = join(kilnDir, 'evidence', runId)
  mkdirSync(join(runDir, 'checks'), { recursive: true })
  const resultsFile = join(runDir, 'results.jsonl')
  // run.json — the §6 freshness anchor the build spine's gate keys on, written by THIS CLI so
  // the evidence carries its own HEAD/hash/timestamp anchors (agents only transcribe them).
  // Written unfinalized up front (head + started_at), finalized with sha256(results.jsonl) +
  // completed_at only when every selected check ran — a mid-run abort (tamper, crash) leaves no
  // results_sha256, and the freshness gate fails closed on it. Atomic like writeLaw. The
  // timestamp threat model is staleness (HEAD drift, evidence from an earlier commit), not a
  // local adversary — an actor who could forge run.json could forge results.jsonl itself; the
  // LAW's integrity is what the tamper gate anchors in git.
  const startedAt = Math.floor(Date.now() / 1000)
  const manifestFile = join(runDir, 'run.json')
  const writeManifest = (extra) => {
    writeFileSync(manifestFile + '.tmp', JSON.stringify({ schema: 1, run_id: runId, head, started_at: startedAt, ...extra }, null, 2) + '\n')
    renameSync(manifestFile + '.tmp', manifestFile)
  }
  writeFileSync(resultsFile, '') // evidence exists from t0 — a zero-check run still leaves a (finalizable) trace
  writeManifest({})
  console.log(`RUN ${runId} HEAD ${head}`)
  if (plan) console.log(`PLAN flip=${plan.flip.join(',')} regression=${plan.regression.join(',')} pre_satisfied=${plan.pre_satisfied.join(',')} deferred=${plan.deferred.join(',')} (before: ${beforeSrc})`)

  // assertGateBefore — the §5.1 "before EVERY check run" re-fire. A check's own cmd can tamper a
  // locked path mid-batch (the cycle-3 reviewer attack: SC-001 rewrites locked SC-002, then
  // SC-002 runs green against tampered content), so the SAME three-arm gate resolves fresh
  // before each check. Offenders ⇒ TAMPER lines + exit 2 with the next check never executed;
  // the run's partial evidence is abandoned mid-write (no RESULT line) — the build spine keys on
  // exit 2 and reads nothing else. A live Law un-locked mid-run is the Law tampering itself.
  const assertGateBefore = (id) => {
    const mid = tamperGate(projectPath, kilnDir)
    const offenders = mid.locked ? mid.offenders : [lawRelPath(projectPath, kilnDir)]
    if (!offenders.length) return
    for (const p of offenders) console.log(`TAMPER: ${p}`)
    die(`run: tamper gate failed before ${id} — locked path(s) changed mid-run; run ${runId} aborted, its evidence is partial and untrusted`, 2)
  }

  // §7 stage-level sweeps (discipline-spec lifecycle step 3): when this run will EXECUTE any
  // probe — a spec'd kind:'probe' in the selection, not opted out by --skip-probes — the
  // browser-verification stage exists and gets BOTH brackets, each scoped BY TOKEN (BLUEPRINT §7:
  // "pre- and post-stage sweeps by token, never blanket pkill"). A whole-kiln-pw- namespace sweep
  // is forbidden HERE: this run cannot tell its own prior litter from a CONCURRENT Kiln run's
  // in-flight browsers (a parallel build, a validate Tier-2 traversal), and reaping the latter is
  // exactly the cross-run kill the discipline spec bans. Both brackets therefore scope to this
  // run's spawn namespace. Pre-flight: the runId PREFIX (the --run-prefix the stage owns when one
  // is threaded, else the full runId) — fired before any probe spawns, it reaps THIS stage's own
  // prior crashed runs (#1311's stale SingletonLock / orphaned trees: a sibling run sharing the
  // stage prefix), never a concurrent run under a different prefix. The stage that owns a token is
  // the right place for any broader sweep, and the build stage does exactly that via its own
  // BUILD_RUN_TOKEN pre-flight bracket. An unprefixed direct run scopes pre-flight to its full
  // runId (unique per invocation) — a near-no-op by construction: an unprefixed run cannot claim
  // ownership of shared-namespace litter, so it honestly sweeps only what it will spawn. The
  // belt-and-suspenders truth (per build.js): every probe gets a UNIQUE /tmp/kiln-pw-<token>
  // profile dir, so the reused-user-data-dir failure #1311 needs cannot reproduce across runs
  // anyway — the pre-flight is defense-in-depth, not a correctness load-bearer. Run-end: this
  // run's full token prefix (runId), registered on process 'exit' so it fires on EVERY path out —
  // clean completion, unmet gates (exit 1), the mid-run tamper abort (exit 2) — die() is
  // process.exit, which skips finally blocks but never 'exit' handlers, and spawnSync is
  // exit-handler-safe. A run with no executable probe launches no browser: no browser stage, no
  // sweep. Per-probe sweeps (kiln-probe's finally + the kill-path sweep below) stay targeted
  // inside these brackets. Sweeps are cleanup, never verdicts — kiln-probe sweep always exits 0
  // and gates nothing.
  if (selected.some((c) => c.kind === 'probe' && c.spec && !flags['skip-probes'])) {
    spawnSync(process.execPath, [KILN_PROBE, 'sweep', runPrefix || runId], { stdio: 'inherit' })
    process.on('exit', () => spawnSync(process.execPath, [KILN_PROBE, 'sweep', runId], { stdio: 'inherit' }))
  }

  let green = 0; let red = 0; let deferredN = 0
  let anyProbeDeferred = false // any probe deferral (no spec, --skip-probes, playwright absent) degrades the run to static-only
  const byId = {}
  for (const c of selected) {
    assertGateBefore(c.id)
    if (c.kind === 'probe' && (flags['skip-probes'] || !c.spec)) {
      // a spec-less probe is an un-instantiated template; --skip-probes is the explicit opt-out —
      // both defer honestly (deferred is NEVER green), and the run degrades to static-only.
      console.log(`PROBE_DEFERRED ${c.id}`)
      appendFileSync(resultsFile, JSON.stringify({ id: c.id, deferred: 'probe_deferred' }) + '\n')
      byId[c.id] = 'deferred'; deferredN++; anyProbeDeferred = true
      continue
    }
    const started = Date.now()
    // §7: a probe check executes via kiln-probe — one bounded browser subprocess with its own
    // serve/deadline/sweep/evidence lifecycle; every other kind runs its exact locked cmd.
    const res = c.kind === 'probe'
      ? spawnSync(process.execPath, [KILN_PROBE, 'run', projectPath, kilnDir, c.id, runId], {
          encoding: 'utf8', timeout: c.timeout_s * 1000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
        })
      : spawnSync('bash', ['-c', c.cmd], {
          cwd: projectPath, encoding: 'utf8',
          timeout: c.timeout_s * 1000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
        })
    const durationMs = Date.now() - started
    const timedOut = res.signal === 'SIGKILL' || (res.error && res.error.code === 'ETIMEDOUT')
    // a kiln-probe child killed by ANY signal (the outer timeout's SIGKILL included) never ran
    // its own finally-sweep — fire one by the run's token prefix so its survivors die NOW, not
    // at the stage-end sweep. The sweep's pidfile arm is what reaps the managed serve_cmd group:
    // the server's cmdline carries no token, so pattern-kill alone would leave it running.
    if (c.kind === 'probe' && (timedOut || res.signal)) spawnSync(process.execPath, [KILN_PROBE, 'sweep', runId], { stdio: 'ignore' })
    // exit code IS the verdict; a timed-out check records 124 (the coreutils timeout convention),
    // any other signal-death records 1 — never a fake 0.
    const exit = res.status !== null ? res.status : (timedOut ? 124 : 1)
    const logContent =
      `$ ${c.kind === 'probe' ? `kiln-probe run ${c.id} (run ${runId})` : c.cmd}\n--- stdout ---\n${res.stdout || ''}\n--- stderr ---\n${res.stderr || ''}\n` +
      `--- exit ${exit} (${durationMs}ms)${timedOut ? ' TIMEOUT' : ''} ---\n`
    writeFileSync(join(runDir, 'checks', `${c.id}.log`), logContent)
    if (c.kind === 'probe' && exit === 78) {
      // playwright absent — the capability tier, not an error: folds DEFERRED, never green; the
      // run is honestly degraded (verification_class below) and the build spine ledgers it.
      console.log(`PROBE_UNAVAILABLE ${c.id} (${durationMs}ms)`)
      appendFileSync(resultsFile, JSON.stringify({ id: c.id, deferred: 'probe_unavailable', log_sha256: sha256(logContent) }) + '\n')
      byId[c.id] = 'deferred'; deferredN++; anyProbeDeferred = true
      continue
    }
    appendFileSync(resultsFile, JSON.stringify({ id: c.id, exit, duration_ms: durationMs, log_sha256: sha256(logContent) }) + '\n')
    if (exit === 0) { console.log(`GREEN ${c.id} (${durationMs}ms)`); byId[c.id] = 'green'; green++ }
    else { console.log(`RED ${c.id} exit ${exit}${timedOut ? ' (timeout)' : ''} (${durationMs}ms)`); byId[c.id] = 'red'; red++ }
  }
  // Every selected check ran — finalize the manifest BEFORE the expectation gates (an unmet
  // expectation is a verdict about the work, not about the evidence: the evidence is complete).
  // verification_class is part of the finalized evidence: 'static-only' the moment ANY probe
  // deferred in THIS run (spec-less template, --skip-probes, or playwright absent) — degraded
  // verification is recorded in the §6 anchor itself, never inferred from prose.
  const verificationClass = anyProbeDeferred ? 'static-only' : 'full'
  writeManifest({ results_sha256: sha256(readFileSync(resultsFile)), completed_at: Math.floor(Date.now() / 1000), verification_class: verificationClass })
  console.log(`RESULT ${runId} green=${green} red=${red} deferred=${deferredN}`)
  if (anyProbeDeferred) console.log(`VERIFICATION_CLASS static-only — probe evidence deferred for: ${selected.filter((c) => byId[c.id] === 'deferred').map((c) => c.id).join(',')}`)

  // The gates, evaluated together so every failure is reported in one pass:
  // --expect-green is hard greenness (a deferred probe can never satisfy it); --flips is the
  // §5.1 lifecycle — declared flips must be green NOW (RED→GREEN from statusBefore; deferred
  // probes exempt), and no previously-GREEN check that ran may have gone red.
  const failures = []
  const unmetExpect = expectGreen.filter((id) => byId[id] !== 'green')
  if (unmetExpect.length) failures.push(`expectation unmet — not green: ${unmetExpect.join(', ')}`)
  if (plan) {
    const unmetFlip = plan.flip.filter((id) => byId[id] !== 'green' && byId[id] !== 'deferred')
    if (unmetFlip.length) {
      // one machine-readable line per unmet flip (mirrors REGRESSION below) — the build spine's
      // runner agent transcribes these ids into its report; the workflow gates on them, no prose.
      for (const id of unmetFlip) console.log(`FLIP_UNMET ${id}`)
      failures.push(`flip unmet — declared RED→GREEN, still not green: ${unmetFlip.join(', ')}`)
    }
    const regressed = plan.regression.filter((id) => byId[id] === 'red')
    if (regressed.length) {
      for (const id of regressed) console.log(`REGRESSION ${id}`)
      failures.push(`regression — previously-GREEN check(s) went red: ${regressed.join(', ')}`)
    }
  }
  if (failures.length) die(`run: ${failures.join('; ')}`)
}

// ── dryrun — the PRE-LOCK check executor (P3.5 T1, dogfood finding 1): checks are code; they
//    execute before we trust them. A dry-run is a transcript, never a run record ───────────────────
// Legality is the point: pre-lock there is nothing locked to tamper and often no git history to
// anchor (greenfield — the lock sequence itself owns the baseline, T2), so this command reads the
// LIVE law.json (schema-validated by readLaw), requires no lock_commit, fires no tamper gate, and
// runs no git command at all. It also writes NOTHING: no evidence dir, no run.json, no
// results.jsonl — folding a pre-lock execution into evidence would let an unlocked, unanchored
// run masquerade as a freshness-gated record. The output IS the deliverable: a per-check
// transcript {id, kind, classification, exit, signal, duration_ms, stdout_tail, stderr_tail}
// with the deterministic exit-code classification (classifyDryrun) applied where the code
// carries the verdict; ambiguous entries ship their tails for the downstream judge.
function cmdDryrun(projectPath, kilnDir, flags) {
  for (const k of Object.keys(flags)) if (k !== 'json') die(`dryrun: unknown flag --${k}`)
  const { law } = readLaw(kilnDir) // the LIVE file — pre-lock legal; a locked law dry-runs identically
  const TAIL_LINES = 25
  const tail = (s) => {
    const lines = String(s || '').split('\n')
    if (lines.length && lines[lines.length - 1] === '') lines.pop() // the terminal newline, not a line
    return (lines.length <= TAIL_LINES ? lines : lines.slice(-TAIL_LINES)).join('\n')
  }
  const transcript = []
  for (const c of law.checks) {
    if (c.kind === 'probe') {
      // probes stay deferred at dry-run: there is no built product to probe pre-lock, and the
      // §7 probe lifecycle (exit 78/79, sweeps, evidence) belongs to the locked runner — a
      // dry-run executes no browser and leaves those semantics untouched.
      transcript.push({ id: c.id, kind: c.kind, classification: 'deferred', exit: null, signal: null, duration_ms: 0, stdout_tail: '', stderr_tail: '' })
      if (!flags.json) console.log(`DRYRUN ${c.id} probe deferred`)
      continue
    }
    const started = Date.now()
    const res = spawnSync('bash', ['-c', c.cmd], {
      cwd: projectPath, encoding: 'utf8',
      timeout: c.timeout_s * 1000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
    })
    const durationMs = Date.now() - started
    const timedOut = res.signal === 'SIGKILL' || (res.error && res.error.code === 'ETIMEDOUT')
    const exit = res.status // null on signal-death — preserved verbatim; classification carries the verdict
    const signal = res.signal || null
    const classification = classifyDryrun(c.kind, exit, signal, timedOut)
    transcript.push({ id: c.id, kind: c.kind, classification, exit, signal, duration_ms: durationMs, stdout_tail: tail(res.stdout), stderr_tail: tail(res.stderr) })
    if (!flags.json) console.log(`DRYRUN ${c.id} ${c.kind} ${classification}${exit !== null ? ` exit=${exit}` : ''}${signal ? ` signal=${signal}` : ''}${timedOut ? ' timeout' : ''} (${durationMs}ms)`)
  }
  const summary = { green: 0, 'honest-red': 0, 'broken-check': 0, ambiguous: 0, deferred: 0 }
  for (const t of transcript) summary[t.classification]++
  if (flags.json) console.log(JSON.stringify({ schema: 1, transcript, summary }))
  else console.log(`DRYRUN_RESULT checks=${transcript.length} green=${summary.green} honest-red=${summary['honest-red']} broken-check=${summary['broken-check']} ambiguous=${summary.ambiguous} deferred=${summary.deferred}`)
}

// ── suite — persist the project suite as hashed evidence beside a recorded Law run (§6) ─────────
// The suite command is the project's own (recorded by the builder); its output is evidence the
// reviewer reads, so it lands in the SAME evidence dir as the Law run it accompanies — log +
// sha256'd result line, never prose. Written to suite.jsonl, a sibling of results.jsonl: the
// run.json manifest finalized sha256(results.jsonl) when the Law run completed, and appending
// here would make every suite-carrying run read as altered evidence at the freshness gate.
function cmdSuite(projectPath, kilnDir, runId, flags) {
  for (const k of Object.keys(flags)) if (!['cmd', 'timeout-s'].includes(k)) die(`suite: unknown flag --${k}`)
  if (typeof flags.cmd !== 'string' || !flags.cmd.trim()) die(`suite: --cmd '<project suite command>' is required`)
  const timeoutS = flags['timeout-s'] === undefined ? 600 : Number(flags['timeout-s'])
  if (!Number.isInteger(timeoutS) || timeoutS < 1) die(`suite: --timeout-s must be an integer ≥ 1`)
  // Same trust stance as run: the tamper gate fires before the suite executes — suite evidence
  // is never produced against a tampered Law (exit 2, nothing executed, exit 2 stays tamper-only).
  const gate = tamperGate(projectPath, kilnDir)
  if (!gate.locked) die(`suite: law.json is not locked — suite evidence must anchor to a locked Law; run 'index' first`)
  if (gate.offenders.length) {
    for (const p of gate.offenders) console.log(`TAMPER: ${p}`)
    die(`suite: tamper gate failed — locked path(s) changed since lock; the suite was not executed`, 2)
  }
  const runDir = join(kilnDir, 'evidence', runId)
  if (!existsSync(join(runDir, 'results.jsonl'))) die(`suite: run '${runId}' has no results.jsonl under ${kilnDir}/evidence — suite evidence anchors to a recorded Law run`)
  const started = Date.now()
  const res = spawnSync('bash', ['-c', flags.cmd], {
    cwd: projectPath, encoding: 'utf8',
    timeout: timeoutS * 1000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
  })
  const durationMs = Date.now() - started
  const timedOut = res.signal === 'SIGKILL' || (res.error && res.error.code === 'ETIMEDOUT')
  // exit code IS the verdict — same conventions as the check runner (124 timeout, never a fake 0)
  const exit = res.status !== null ? res.status : (timedOut ? 124 : 1)
  const logContent =
    `$ ${flags.cmd}\n--- stdout ---\n${res.stdout || ''}\n--- stderr ---\n${res.stderr || ''}\n` +
    `--- exit ${exit} (${durationMs}ms)${timedOut ? ' TIMEOUT' : ''} ---\n`
  writeFileSync(join(runDir, 'suite.log'), logContent)
  appendFileSync(join(runDir, 'suite.jsonl'), JSON.stringify({ cmd: flags.cmd, exit, duration_ms: durationMs, log_sha256: sha256(logContent) }) + '\n')
  console.log(`SUITE ${runId} exit=${exit}${timedOut ? ' (timeout)' : ''} (${durationMs}ms) log_sha256=${sha256(logContent)}`)
  if (exit !== 0) die(`suite: project suite exited ${exit} — evidence at ${join(runDir, 'suite.log')}`)
}

// ── status — fold one run's results.jsonl → {green, red, deferred} ──────────────────────────────
function cmdStatus(kilnDir, runId) {
  const { law } = readLaw(kilnDir)
  const resultsFile = join(kilnDir, 'evidence', runId, 'results.jsonl')
  if (!existsSync(resultsFile)) die(`status: no results.jsonl for run '${runId}' under ${kilnDir}/evidence`)
  let folded
  try { folded = foldResults(resultsFile) } catch (e) { die(`status: ${e.message}`) }
  const { byId, order } = folded
  // law.json check order first (deterministic), then any id the law no longer carries.
  const lawOrder = law.checks.map((c) => c.id).filter((id) => id in byId)
  const extras = order.filter((id) => !lawOrder.includes(id))
  const fold = { green: [], red: [], deferred: [] }
  for (const id of [...lawOrder, ...extras]) fold[byId[id]].push(id)
  console.log(JSON.stringify(fold))
}

// ── Dispatch ─────────────────────────────────────────────────────────────────────────────────────
const USAGE = `usage: kiln-law.mjs <index|verify|run|dryrun|status|suite> …   (header comment has the full forms)`
function parseFlags(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) die(USAGE)
    const k = argv[i].slice(2)
    if (k === 'skip-probes' || k === 'json') { flags[k] = true; continue }
    if (argv[i + 1] === undefined) die(USAGE)
    flags[k] = argv[++i]
  }
  return flags
}

const [cmd, ...rest] = process.argv.slice(2)
try {
  if (cmd === 'index' || cmd === 'verify' || cmd === 'run' || cmd === 'dryrun') {
    const [projectPath, kilnDir] = rest
    if (!projectPath || !kilnDir || !isAbsolute(projectPath)) die(USAGE)
    if ((cmd === 'index' || cmd === 'verify') && rest.length !== 2) die(USAGE)
    if (cmd === 'index') cmdIndex(resolve(projectPath), resolve(kilnDir))
    else if (cmd === 'verify') cmdVerify(resolve(projectPath), resolve(kilnDir))
    else if (cmd === 'dryrun') cmdDryrun(resolve(projectPath), resolve(kilnDir), parseFlags(rest.slice(2)))
    else cmdRun(resolve(projectPath), resolve(kilnDir), parseFlags(rest.slice(2)))
  } else if (cmd === 'status') {
    const [kilnDir, runId] = rest
    if (!kilnDir || !runId || rest.length !== 2) die(USAGE)
    cmdStatus(resolve(kilnDir), runId)
  } else if (cmd === 'suite') {
    const [projectPath, kilnDir, runId] = rest
    if (!projectPath || !kilnDir || !runId || runId.startsWith('--') || !isAbsolute(projectPath)) die(USAGE)
    cmdSuite(resolve(projectPath), resolve(kilnDir), runId, parseFlags(rest.slice(3)))
  } else die(USAGE)
} catch (e) { die(e.message) }
