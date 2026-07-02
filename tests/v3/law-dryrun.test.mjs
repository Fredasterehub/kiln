// law-dryrun.test.mjs — P3.5 T1 acceptance: the pre-lock Law check dry-run gate (dogfood
// finding 1: Athena caught argv-KeyError crashes, a broken marker assert, and a broken exit-code
// chain INSIDE check code by READING it — checks are code; they execute before we trust them).
// Three floors:
//   1. src/law.mjs classifyDryrun — the deterministic exit-code table (pytest 1 = honest-red;
//      pytest 2-5 / exit 126-127 / timeout / signal = broken-check; 0 = green; rest = ambiguous).
//   2. scripts/kiln-law.mjs dryrun — end-to-end on fixtures: legal PRE-LOCK (no git repo at all,
//      lock_commit null, no tamper gate), the contract's five classification fixtures (argv-crash
//      class, command-not-found 127, pytest usage error, honest-red, pre-satisfied green) plus
//      the deferred probe, ~25-line tails, --json machine output, ZERO evidence residue, and the
//      back-compat drill (the lock path is unaffected whether dryrun ran or was skipped — dryrun
//      is the architecture stage's gate, not a kiln-law run dependency).
//   3. The GENERATED workflows/architecture.js dry-run gate, mock-driven — the leg runs after
//      Asimov compiles and BEFORE the lock; the FULL transcript feeds Athena's ruling pass; a
//      broken check is BLOCKED from lock (the drill); the bounded Asimov check-revision cycle
//      re-dryruns; the deterministic floor overrides a sloppy PASS; legitimately-green checks
//      are recorded pre_satisfied at lock; every degraded leg fails CLOSED.
// P3.6 T2 (RUN-B FINDING 1) extends all three floors: a PRESENT-but-schema-invalid law.json is
// a TRANSCRIPT (exit 0, typed law_violations), never a crash — the workflow routes it to an
// asimov:law-revise pass (Athena skipped: validator output needs no judge) through the same
// bounded cycle; a MISSING law.json still dies. And the probe TWINS (embedded spec — the copy
// kiln-probe executes — vs on-disk tests/acceptance/<id>.probe.json — the copy the lock
// attests) are checked at dryrun (desync = broken-check, routed to the author) and at index
// (desync = refusal: the Law is immutable after lock, so a desynced pair must never lock).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classifyDryrun, probeTwinRel, probeTwinIssues } from '../../plugins/kiln/src/law.mjs'

// ── 1. classifyDryrun — the deterministic table, row by row ─────────────────────────────────────
test('classifyDryrun: pytest taxonomy — 1 honest-red; 2/3/4/5 broken-check; other nonzero ambiguous', () => {
  assert.equal(classifyDryrun('pytest', 1, null, false), 'honest-red')
  for (const exit of [2, 3, 4, 5]) assert.equal(classifyDryrun('pytest', exit, null, false), 'broken-check', `pytest exit ${exit}`)
  assert.equal(classifyDryrun('pytest', 6, null, false), 'ambiguous')
})

test('classifyDryrun: exit 126/127 is broken-check for EVERY kind — every cmd runs through bash', () => {
  for (const kind of ['shell', 'pytest', 'http']) {
    assert.equal(classifyDryrun(kind, 126, null, false), 'broken-check', `${kind} 126`)
    assert.equal(classifyDryrun(kind, 127, null, false), 'broken-check', `${kind} 127`)
  }
})

test('classifyDryrun: timeout and signal-death are broken-check — no verdict was produced', () => {
  assert.equal(classifyDryrun('shell', null, 'SIGKILL', true), 'broken-check')
  assert.equal(classifyDryrun('shell', null, 'SIGTERM', false), 'broken-check')
  assert.equal(classifyDryrun('pytest', 1, null, true), 'broken-check', 'timeout outranks the exit code')
  assert.equal(classifyDryrun('shell', null, null, false), 'broken-check', 'neither exit nor signal recorded — broken, never silently ambiguous')
})

// ── 1b. probeTwinRel / probeTwinIssues — the twin-sync pure core (P3.6 T2, RUN-B F1 tail) ───────
test('probeTwinRel: the on-disk twin convention — tests/acceptance/<id lowercase>.probe.json', () => {
  assert.equal(probeTwinRel({ id: 'SC-006' }), 'tests/acceptance/sc-006.probe.json')
  assert.equal(probeTwinRel({}), 'tests/acceptance/.probe.json', 'a malformed check degrades, never throws')
})

test('probeTwinIssues: deep-equal semantics — key order irrelevant, array order significant, values strict', () => {
  const check = { id: 'SC-001', files: ['tests/acceptance/sc-001.probe.json'], spec: { url: '/', landmarks: [{ role: 'list', name: 'Bookmarks' }] } }
  assert.deepEqual(probeTwinIssues(check, '{"landmarks": [{"name": "Bookmarks", "role": "list"}], "url": "/"}'), [], 'shuffled keys ARE the same spec — semantics, not bytes')
  assert.equal(probeTwinIssues(check, '{"url": "/", "landmarks": [{"role": "list", "name": "OldWeakName"}]}').length, 1, 'a differing value is a desync')
  const two = { ...check, spec: { url: '/', landmarks: [{ role: 'list', name: 'A' }, { role: 'button', name: 'B' }] } }
  assert.equal(probeTwinIssues(two, '{"url": "/", "landmarks": [{"role": "button", "name": "B"}, {"role": "list", "name": "A"}]}').length, 1, 'array order is significant — landmarks are ordered assertions')
})

test('probeTwinIssues: unlisted, missing, and unparseable twins are each named issues — the attestation contract', () => {
  const spec = { url: '/', landmarks: [{ role: 'list', name: 'Bookmarks' }] }
  const listed = { id: 'SC-001', files: ['tests/acceptance/sc-001.probe.json'], spec }
  const unlisted = { id: 'SC-001', files: ['tests/acceptance/other.sh'], spec }
  assert.match(probeTwinIssues(unlisted, JSON.stringify(spec))[0], /not listed in the check's files/, 'an unlisted twin is un-attested — the lock would never hash it')
  assert.match(probeTwinIssues(listed, null)[0], /missing on disk/, 'null twinRaw = unreadable file')
  assert.match(probeTwinIssues(listed, '{nope')[0], /not valid JSON/)
  const both = probeTwinIssues(unlisted, null)
  assert.equal(both.length, 2, 'unlisted AND missing accumulate — the author sees every defect at once')
})

test('classifyDryrun: exit 0 is green (pre-satisfied candidate); shell/http nonzero is ambiguous — judged downstream', () => {
  for (const kind of ['shell', 'pytest', 'http']) assert.equal(classifyDryrun(kind, 0, null, false), 'green', kind)
  assert.equal(classifyDryrun('shell', 1, null, false), 'ambiguous')
  assert.equal(classifyDryrun('http', 7, null, false), 'ambiguous')
})

// ── 2. kiln-law dryrun — end-to-end on fixtures ──────────────────────────────────────────────────
const CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-law.mjs', import.meta.url))
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const NODE = JSON.stringify(process.execPath) // quoted for the bash -c cmd line

// The contract's five classification fixtures + the deferred probe. NO git repo is created —
// pre-lock legality is the point (greenfield: the lock sequence owns the baseline, not dryrun).
const dryFixtureLaw = () => ({
  schema: 1, lock_commit: null,
  checks: [
    // the dogfood finding-1 crash class: a config/argv lookup crashes before any assertion runs
    { id: 'SC-001', milestone: 'M1', kind: 'shell', cmd: `${NODE} tests/acceptance/sc-001-crash.cjs`, files: ['tests/acceptance/sc-001-crash.cjs'], sha256: {}, expected: 'exit0', timeout_s: 30 },
    { id: 'SC-002', milestone: 'M1', kind: 'shell', cmd: 'kiln-no-such-command-t1-drill --flag', files: ['tests/acceptance/sc-002.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
    { id: 'SC-003', milestone: 'M1', kind: 'pytest', cmd: 'bash tests/acceptance/sc-003-usage.sh', files: ['tests/acceptance/sc-003-usage.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
    { id: 'SC-004', milestone: 'M2', kind: 'pytest', cmd: 'bash tests/acceptance/sc-004-red.sh', files: ['tests/acceptance/sc-004-red.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
    { id: 'SC-005', milestone: 'M2', kind: 'shell', cmd: 'grep -q hello app.txt', files: ['tests/acceptance/sc-005.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
    { id: 'SC-006', milestone: 'M2', kind: 'probe', cmd: '', files: ['tests/acceptance/sc-006.probe.json'], sha256: {}, expected: 'exit0', timeout_s: 120 },
  ],
})

function makeDryFixture(law = dryFixtureLaw()) {
  const proj = mkdtempSync(join(tmpdir(), 'kiln-dryrun-test-'))
  const kiln = join(proj, '.kiln')
  mkdirSync(join(proj, 'tests/acceptance'), { recursive: true })
  mkdirSync(kiln, { recursive: true })
  writeFileSync(join(proj, 'app.txt'), 'hello world\n')
  writeFileSync(join(proj, 'tests/acceptance/sc-001-crash.cjs'),
    `const argv = {}\nconsole.log('check starting: verifying the export feature')\nconst out = argv['--output'].trim()\nconsole.log('unreachable', out)\n`)
  writeFileSync(join(proj, 'tests/acceptance/sc-003-usage.sh'), `echo 'ERROR: usage: pytest [options] [file_or_dir]' >&2\nexit 4\n`)
  writeFileSync(join(proj, 'tests/acceptance/sc-004-red.sh'), `echo 'FAILED tests/test_export.py::test_export - feature not built'\necho '1 failed in 0.02s'\nexit 1\n`)
  writeFileSync(join(kiln, 'law.json'), JSON.stringify(law, null, 2) + '\n')
  return { proj, kiln }
}

test('CLI dryrun: legal PRE-LOCK with NO git repo — executes every check, classifies deterministically, leaves ZERO evidence residue', () => {
  const { proj, kiln } = makeDryFixture()
  try {
    assert.ok(!existsSync(join(proj, '.git')), 'fixture precondition: no git repo — dryrun needs none')
    const res = cli('dryrun', proj, kiln)
    assert.equal(res.status, 0, `dryrun is a transcript, never a gate: ${res.stderr}`)
    assert.match(res.stdout, /^DRYRUN SC-001 shell ambiguous exit=1 \(\d+ms\)$/m, 'the argv-crash class: shell exit 1 carries no verdict — ambiguous, judged downstream')
    assert.match(res.stdout, /^DRYRUN SC-002 shell broken-check exit=127 \(\d+ms\)$/m, 'command not found')
    assert.match(res.stdout, /^DRYRUN SC-003 pytest broken-check exit=4 \(\d+ms\)$/m, 'pytest usage error')
    assert.match(res.stdout, /^DRYRUN SC-004 pytest honest-red exit=1 \(\d+ms\)$/m, 'tests ran and failed on the missing feature')
    assert.match(res.stdout, /^DRYRUN SC-005 shell green exit=0 \(\d+ms\)$/m, 'pre-satisfied candidate')
    assert.match(res.stdout, /^DRYRUN SC-006 probe deferred$/m, 'probes stay deferred — never executed pre-lock')
    assert.match(res.stdout, /^DRYRUN_RESULT checks=6 green=1 honest-red=1 broken-check=2 ambiguous=1 deferred=1$/m)
    // zero residue: no evidence dir, no run.json, no results.jsonl — the .kiln dir holds ONLY the law
    assert.ok(!existsSync(join(kiln, 'evidence')), 'a dry-run must never create an evidence dir')
    assert.deepEqual(readdirSync(kiln), ['law.json'], 'a dry-run writes nothing — a transcript, never a run record')
    assert.deepEqual(readLawNow(kiln), dryFixtureLaw(), 'the live law.json is untouched (still pre-lock, sha256 maps empty)')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})
const readLawNow = (kiln) => JSON.parse(readFileSync(join(kiln, 'law.json'), 'utf8'))

test('CLI dryrun --json: one machine object — full transcript with tails carrying the crash evidence, summary fold', () => {
  const { proj, kiln } = makeDryFixture()
  try {
    const res = cli('dryrun', proj, kiln, '--json')
    assert.equal(res.status, 0, res.stderr)
    const out = JSON.parse(res.stdout)
    assert.equal(out.schema, 1)
    assert.equal(out.transcript.length, 6)
    const byId = Object.fromEntries(out.transcript.map((t) => [t.id, t]))
    // every executed entry carries the full transcript shape
    for (const t of out.transcript) {
      assert.deepEqual(Object.keys(t).sort(), ['classification', 'duration_ms', 'exit', 'id', 'kind', 'signal', 'stdout_tail', 'stderr_tail'].sort(), t.id)
    }
    assert.equal(byId['SC-001'].classification, 'ambiguous')
    assert.equal(byId['SC-001'].exit, 1)
    assert.match(byId['SC-001'].stderr_tail, /TypeError: Cannot read properties of undefined/, 'the tail carries the traceback the downstream judge rules on')
    assert.match(byId['SC-001'].stdout_tail, /check starting/, 'stdout tail captured too')
    assert.deepEqual({ id: byId['SC-002'].id, classification: byId['SC-002'].classification, exit: byId['SC-002'].exit }, { id: 'SC-002', classification: 'broken-check', exit: 127 })
    assert.equal(byId['SC-003'].classification, 'broken-check')
    assert.match(byId['SC-003'].stderr_tail, /usage: pytest/)
    assert.equal(byId['SC-004'].classification, 'honest-red')
    assert.equal(byId['SC-005'].classification, 'green')
    assert.deepEqual(byId['SC-006'], { id: 'SC-006', kind: 'probe', classification: 'deferred', exit: null, signal: null, duration_ms: 0, stdout_tail: '', stderr_tail: '' })
    assert.deepEqual(out.summary, { green: 1, 'honest-red': 1, 'broken-check': 2, ambiguous: 1, deferred: 1 })
    assert.deepEqual(out.law_violations, [], 'law_violations is ALWAYS present in --json — empty on a normal dry-run (one fixed shape for the scribe)')
    assert.ok(!existsSync(join(kiln, 'evidence')), 'zero residue in --json mode too')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI dryrun: stdout/stderr tails are capped at 25 lines (the last 25)', () => {
  const law = dryFixtureLaw()
  law.checks = [{ id: 'SC-001', milestone: 'M1', kind: 'shell', cmd: 'seq 1 100; exit 1', files: ['tests/acceptance/sc-001-crash.cjs'], sha256: {}, expected: 'exit0', timeout_s: 10 }]
  const { proj, kiln } = makeDryFixture(law)
  try {
    const out = JSON.parse(cli('dryrun', proj, kiln, '--json').stdout)
    const lines = out.transcript[0].stdout_tail.split('\n')
    assert.equal(lines.length, 25, 'exactly the last 25 lines — the terminal newline is not a line')
    assert.equal(lines[0], '76')
    assert.equal(lines[24], '100')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI dryrun: a hung check is SIGKILLed at timeout_s and classified broken-check', () => {
  const law = dryFixtureLaw()
  law.checks = [{ id: 'SC-001', milestone: 'M1', kind: 'shell', cmd: 'sleep 5', files: ['tests/acceptance/sc-001-crash.cjs'], sha256: {}, expected: 'exit0', timeout_s: 1 }]
  const { proj, kiln } = makeDryFixture(law)
  try {
    const res = cli('dryrun', proj, kiln)
    assert.equal(res.status, 0)
    assert.match(res.stdout, /^DRYRUN SC-001 shell broken-check signal=SIGKILL timeout \(\d+ms\)$/m)
    assert.match(res.stdout, /^DRYRUN_RESULT checks=1 green=0 honest-red=0 broken-check=1 ambiguous=0 deferred=0$/m)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

// ── git-anchored drills: no tamper gate at dryrun; the lock path is independent of dryrun ────────
const gitIn = (dir, ...args) => {
  const res = spawnSync('git', ['-C', dir, '-c', 'user.email=kiln@test', '-c', 'user.name=kiln', ...args], { encoding: 'utf8' })
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`)
  return res.stdout.trim()
}
// the law.test.mjs lock-drill fixture shape: one green + one red shell check, committed product file
const lockableLaw = () => ({
  schema: 1, lock_commit: null,
  checks: [
    { id: 'SC-001', milestone: 'M1', kind: 'shell', cmd: 'grep -q hello app.txt', files: ['tests/acceptance/sc-001.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
    { id: 'SC-002', milestone: 'M1', kind: 'shell', cmd: 'bash tests/acceptance/sc-002.sh', files: ['tests/acceptance/sc-002.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
  ],
})
function makeGitFixture() {
  const proj = mkdtempSync(join(tmpdir(), 'kiln-dryrun-git-test-'))
  const kiln = join(proj, '.kiln')
  mkdirSync(join(proj, 'tests/acceptance'), { recursive: true })
  mkdirSync(kiln, { recursive: true })
  writeFileSync(join(proj, 'app.txt'), 'hello world\n')
  gitIn(proj, 'init', '-q')
  gitIn(proj, 'add', '-A')
  gitIn(proj, 'commit', '-qm', 'initial product commit')
  writeFileSync(join(proj, 'tests/acceptance/sc-001.sh'), 'grep -q hello app.txt\n')
  writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), 'exit 1\n')
  writeFileSync(join(kiln, 'law.json'), JSON.stringify(lockableLaw(), null, 2) + '\n')
  return { proj, kiln }
}
const lockNow = (proj, kiln) => {
  assert.equal(cli('index', proj, kiln).status, 0)
  gitIn(proj, 'add', 'tests/acceptance', '.kiln/law.json')
  gitIn(proj, 'commit', '-qm', 'test(law): lock acceptance gates')
}

test('CLI dryrun: NO tamper gate — a locked Law with a tampered locked file still dry-runs and reports reality (verify/run keep the gate)', () => {
  const { proj, kiln } = makeGitFixture()
  try {
    lockNow(proj, kiln)
    writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), 'exit 0\n') // the tamper
    const res = cli('dryrun', proj, kiln)
    assert.equal(res.status, 0, 'dryrun never exits 2 — it gates nothing')
    assert.doesNotMatch(res.stdout, /TAMPER/, 'no tamper arm fires at dry-run')
    assert.match(res.stdout, /^DRYRUN SC-002 shell green exit=0/m, 'the transcript reports what actually executed')
    // the GATES are unchanged: verify still flags the tamper with exit 2
    const ver = cli('verify', proj, kiln)
    assert.equal(ver.status, 2)
    assert.match(ver.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI back-compat: the lock path is unaffected by dryrun — skipped entirely OR run pre-lock, index/verify/run behave identically', () => {
  // (a) dryrun never invoked: the §5 sequence works as before — dryrun is the architecture
  // stage's gate, not a kiln-law run dependency.
  const a = makeGitFixture()
  try {
    lockNow(a.proj, a.kiln)
    assert.equal(cli('verify', a.proj, a.kiln).status, 0)
    const run = cli('run', a.proj, a.kiln)
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /^RESULT \S+ green=1 red=1 deferred=0$/m)
  } finally { rmSync(a.proj, { recursive: true, force: true }) }
  // (b) dryrun ran pre-lock: zero residue means the identical lock sequence follows.
  const b = makeGitFixture()
  try {
    assert.equal(cli('dryrun', b.proj, b.kiln).status, 0, 'pre-lock dryrun is legal (lock_commit null)')
    assert.ok(!existsSync(join(b.kiln, 'evidence')))
    lockNow(b.proj, b.kiln)
    assert.equal(cli('verify', b.proj, b.kiln).status, 0, 'the dry-run left nothing that disturbs the lock')
    assert.equal(cli('run', b.proj, b.kiln).status, 0)
  } finally { rmSync(b.proj, { recursive: true, force: true }) }
})

test('CLI dryrun usage: relative projectPath, missing kilnDir, unknown flag, MISSING law.json all die exit 1 — a defect needs an artifact to revise', () => {
  assert.equal(cli('dryrun', 'relative/path', '/tmp/x/.kiln').status, 1)
  assert.equal(cli('dryrun', '/tmp/x').status, 1)
  const { proj, kiln } = makeDryFixture()
  try {
    assert.equal(cli('dryrun', proj, kiln, '--nope').status, 1, 'a value-less unknown flag dies on usage')
    const flag = cli('dryrun', proj, kiln, '--nope', 'x')
    assert.equal(flag.status, 1)
    assert.match(flag.stderr, /unknown flag --nope/)
    rmSync(join(kiln, 'law.json'))
    const gone = cli('dryrun', proj, kiln)
    assert.equal(gone.status, 1, 'a MISSING law.json stays fail-closed — Asimov wrote nothing; there is nothing to route')
    assert.match(gone.stderr, /no law\.json/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

// ── RUN-B FINDING 1 (P3.6 T2): a defective Law is a TRANSCRIPT, not a crash — dryrun only ────────
test('CLI dryrun: a PRESENT but schema-invalid law.json transcribes — exit 0, typed law_violations verbatim, zero checks executed, zero residue', () => {
  const law = dryFixtureLaw()
  // the FIELD shape: Run B's Asimov emitted probe landmarks {role:"list", name:""} — six of them
  law.checks[5].spec = { url: '/', landmarks: [{ role: 'list', name: '' }] }
  const { proj, kiln } = makeDryFixture(law)
  try {
    const res = cli('dryrun', proj, kiln, '--json')
    assert.equal(res.status, 0, `a defective Law is a report, never a crash: ${res.stderr}`)
    const out = JSON.parse(res.stdout)
    assert.equal(out.schema, 1)
    assert.deepEqual(out.transcript, [], 'no check executes against an invalid Law')
    assert.deepEqual(out.summary, { green: 0, 'honest-red': 0, 'broken-check': 0, ambiguous: 0, deferred: 0 })
    assert.ok(out.law_violations.length >= 1)
    const v = out.law_violations.find((x) => x.path.includes('landmarks'))
    assert.ok(v, 'the violation names the landmark path')
    assert.equal(v.code, 'invalid_value')
    assert.match(v.message, /role and name must be nonempty strings/, 'validateLaw\'s typed error passes through VERBATIM — the revise loop feeds on it')
    assert.ok(!existsSync(join(kiln, 'evidence')), 'zero residue on the violations path too')
    // human mode: one DRYRUN_LAW_INVALID line per violation + the summary line
    const human = cli('dryrun', proj, kiln)
    assert.equal(human.status, 0)
    assert.match(human.stdout, /^DRYRUN_LAW_INVALID .*landmarks.*role and name must be nonempty strings/m)
    assert.match(human.stdout, /^DRYRUN_RESULT checks=0 law_violations=1$/m)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI dryrun: a law.json that is not JSON at all transcribes as invalid_json — same routing, same exit 0', () => {
  const { proj, kiln } = makeDryFixture()
  try {
    writeFileSync(join(kiln, 'law.json'), '{"schema": 1, "lock_commit": null, "checks": [')
    const out = JSON.parse(cli('dryrun', proj, kiln, '--json').stdout)
    assert.equal(out.law_violations.length, 1)
    assert.equal(out.law_violations[0].code, 'invalid_json')
    assert.match(out.law_violations[0].message, /not valid JSON/)
    assert.deepEqual(out.transcript, [])
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI dryrun: every OTHER command keeps the fail-closed die on an invalid Law — the routing is dryrun\'s alone', () => {
  const law = dryFixtureLaw()
  law.checks.push(law.checks[0]) // duplicate id — schema violation
  const { proj, kiln } = makeDryFixture(law)
  try {
    // a git baseline so verify/run reach the schema validation (their tamper gate needs git and,
    // with no committed Law yet, falls back to the live file — schema-validated)
    gitIn(proj, 'init', '-q')
    gitIn(proj, 'add', '-A')
    gitIn(proj, 'commit', '-qm', 'baseline')
    for (const args of [['index', proj, kiln], ['verify', proj, kiln], ['run', proj, kiln]]) {
      const res = cli(...args)
      assert.equal(res.status, 1, `${args[0]} must die on a schema-invalid Law`)
      assert.match(res.stderr, /violates the schema/, args[0])
    }
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

// ── RUN-B F1 tail (P3.6 T2): the probe twins — embedded executes, on-disk attests, both in sync ──
const twinSpec = () => ({ url: '/', landmarks: [{ role: 'list', name: 'Bookmarks' }] })
const twinLaw = (spec = twinSpec()) => ({
  schema: 1, lock_commit: null,
  checks: [{ id: 'SC-006', milestone: 'M2', kind: 'probe', cmd: '', files: ['tests/acceptance/sc-006.probe.json'], sha256: {}, expected: 'exit0', timeout_s: 120, spec }],
})

test('CLI dryrun twin arm: desynced / missing / unlisted / unparseable twins are broken-check with the reason in stderr_tail; a synced twin defers', () => {
  const { proj, kiln } = makeDryFixture(twinLaw())
  try {
    const dry = () => JSON.parse(cli('dryrun', proj, kiln, '--json').stdout).transcript[0]
    // missing twin
    let t = dry()
    assert.equal(t.classification, 'broken-check')
    assert.match(t.stderr_tail, /missing on disk/)
    // desynced twin (the Run-B manual-recovery shape: embedded strengthened, on-disk stale)
    writeFileSync(join(proj, 'tests/acceptance/sc-006.probe.json'), JSON.stringify({ url: '/', landmarks: [{ role: 'list', name: 'OldWeakName' }] }))
    t = dry()
    assert.equal(t.classification, 'broken-check')
    assert.match(t.stderr_tail, /does not deep-equal the embedded spec/)
    // unparseable twin
    writeFileSync(join(proj, 'tests/acceptance/sc-006.probe.json'), '{nope')
    t = dry()
    assert.equal(t.classification, 'broken-check')
    assert.match(t.stderr_tail, /not valid JSON/)
    // synced twin, keys shuffled — deep-equal, not byte-equal → deferred exactly as before
    writeFileSync(join(proj, 'tests/acceptance/sc-006.probe.json'), '{"landmarks": [{"name": "Bookmarks", "role": "list"}], "url": "/"}')
    t = dry()
    assert.equal(t.classification, 'deferred', 'an in-sync spec\'d probe defers — no browser at dry-run, semantics unchanged')
    // unlisted twin: on disk and equal, but not in files — un-attested
    const law = twinLaw()
    law.checks[0].files = ['tests/acceptance/other.txt']
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(law, null, 2) + '\n')
    writeFileSync(join(proj, 'tests/acceptance/other.txt'), 'x\n')
    t = dry()
    assert.equal(t.classification, 'broken-check')
    assert.match(t.stderr_tail, /not listed in the check's files/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI dryrun twin arm: a spec-less probe TEMPLATE still defers untouched — un-instantiated is not desynced', () => {
  const law = twinLaw()
  delete law.checks[0].spec
  const { proj, kiln } = makeDryFixture(law)
  try {
    const t = JSON.parse(cli('dryrun', proj, kiln, '--json').stdout).transcript[0]
    assert.deepEqual(t, { id: 'SC-006', kind: 'probe', classification: 'deferred', exit: null, signal: null, duration_ms: 0, stdout_tail: '', stderr_tail: '' })
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI index twin floor: a desynced twin can NEVER lock (named id, exit 1); a synced twin locks — the Law is immutable after lock', () => {
  const proj = mkdtempSync(join(tmpdir(), 'kiln-dryrun-twin-git-'))
  const kiln = join(proj, '.kiln')
  try {
    mkdirSync(join(proj, 'tests/acceptance'), { recursive: true })
    mkdirSync(kiln, { recursive: true })
    writeFileSync(join(proj, 'app.txt'), 'hello\n')
    gitIn(proj, 'init', '-q')
    gitIn(proj, 'add', '-A')
    gitIn(proj, 'commit', '-qm', 'baseline')
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(twinLaw(), null, 2) + '\n')
    // listed-but-MISSING twin: the NAMED twin refusal fires, never the generic missing-file
    // message — the twin diagnostic teaches the regenerate-to-deep-equal fix
    const gone = cli('index', proj, kiln)
    assert.equal(gone.status, 1)
    assert.match(gone.stderr, /probe twin desync/, 'the twin floor outranks the generic missing-file guard')
    assert.match(gone.stderr, /SC-006: tests\/acceptance\/sc-006\.probe\.json is missing on disk/)
    assert.doesNotMatch(gone.stderr, /locked file\(s\) missing on disk/)
    writeFileSync(join(proj, 'tests/acceptance/sc-006.probe.json'), JSON.stringify({ url: '/', landmarks: [{ role: 'list', name: 'OldWeakName' }] }))
    const bad = cli('index', proj, kiln)
    assert.equal(bad.status, 1, 'a desynced pair locks PERMANENTLY desynced — index must refuse')
    assert.match(bad.stderr, /probe twin desync/)
    assert.match(bad.stderr, /SC-006/)
    assert.equal(JSON.parse(readFileSync(join(kiln, 'law.json'), 'utf8')).lock_commit, null, 'the refusal left the Law untouched')
    // sync (shuffled keys — deep-equal is the contract) → the identical sequence locks
    writeFileSync(join(proj, 'tests/acceptance/sc-006.probe.json'), '{"landmarks": [{"name": "Bookmarks", "role": "list"}], "url": "/"}')
    const good = cli('index', proj, kiln)
    assert.equal(good.status, 0, good.stderr)
    assert.match(good.stdout, /locked 1 check\(s\)/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

// ── 3. The GENERATED workflows/architecture.js dry-run gate, mock-driven ─────────────────────────
const ARCHITECTURE = fileURLToPath(new URL('../../plugins/kiln/workflows/architecture.js', import.meta.url))
const AsyncFunction = (async () => {}).constructor
const archBody = readFileSync(ARCHITECTURE, 'utf8').replace(/^export const meta\b/m, 'const meta')

async function runArch(args, respond) {
  const calls = []
  const stubs = {
    args,
    phase: () => {},
    log: () => {},
    agent: async (prompt, opts) => {
      const label = (opts && opts.label) || ''
      calls.push({ label, prompt, schema: (opts && opts.schema) || null })
      return respond(label, prompt)
    },
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async () => [],
    budget: undefined,
    workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, archBody)
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, calls }
}

const lawArgs = { kilnDir: '/tmp/nonexistent-kiln/.kiln', projectPath: '/tmp/nonexistent-kiln', codexAvailable: false, pluginRoot: '/opt/kiln-plugin' }
const foundationResult = {
  reasoning: 'f', architecture_file: '/x/architecture.md', tech_stack_file: '/x/tech-stack.md',
  arch_constraints_file: '/x/arch-constraints.md', has_visual_direction: false, scope: 'trivial',
  estimated_milestones: 1, summary: 'sum',
}
const synthResult = { reasoning: 's', master_plan_file: '/x/master-plan.md', milestone_count: 1, milestones: [{ id: 'M1', title: 'T', surface: 'logic', confidence: 'high' }], confidence_summary: 'c' }
const asimovResult = {
  reasoning: 'a', law_file: '/tmp/nonexistent-kiln/.kiln/law.json',
  checks: [{ id: 'SC-001', milestone: 'M1', kind: 'shell' }, { id: 'SC-002', milestone: 'M1', kind: 'probe' }],
  plan_sc_ids: ['SC-001', 'SC-002'],
}
// schema-faithful mock: every entry carries all EIGHT evidence fields, nulls included — exactly
// what the CLI emits and what DRYRUN_SCHEMA requires (a legal scribe cannot drop the tails).
// law_violations rides on every dry-run report since P3.6 T2 (empty on the normal path).
const cleanDry = {
  reasoning: 'd', exit: 0, error: '', law_violations: [],
  transcript: [
    { id: 'SC-001', kind: 'shell', classification: 'ambiguous', exit: 1, signal: null, duration_ms: 7, stdout_tail: 'check starting', stderr_tail: "TypeError: Cannot read properties of undefined (reading 'trim')" },
    { id: 'SC-002', kind: 'probe', classification: 'deferred', exit: null, signal: null, duration_ms: 0, stdout_tail: '', stderr_tail: '' },
  ],
}
const passRuling = { reasoning: 'r', verdict: 'PASS', broken: [], green_legitimate: [] }

// respond(over) — drive the lite path through the Law with PASS everywhere; `over.dryrun` /
// `over.ruling` swap the dry-run legs (a value, or a per-round function for stateful drills).
const respond = (over = {}) => (label) => {
  if (label === 'thoth:research-check') return { reasoning: 'ls', missing: [] }
  if (label === 'numerobis:foundation') return foundationResult
  if (label === 'plato:synthesis' || label.startsWith('plato:revise')) return synthResult
  if (label.startsWith('athena:validate')) return { reasoning: 'v', verdict: 'PASS', failed_dimensions: [], fixes: [] }
  if (label === 'asimov:law') return asimovResult
  if (label.startsWith('thoth:dryrun:r')) {
    const r = Number(label.slice('thoth:dryrun:r'.length))
    return typeof over.dryrun === 'function' ? over.dryrun(r) : ('dryrun' in over ? over.dryrun : cleanDry)
  }
  if (label.startsWith('athena:dryrun:r')) {
    const r = Number(label.slice('athena:dryrun:r'.length))
    return typeof over.ruling === 'function' ? over.ruling(r) : ('ruling' in over ? over.ruling : passRuling)
  }
  if (label.startsWith('asimov:check-revise')) return null
  if (label === 'thoth:law-lock') return { reasoning: 'l', indexed: true, committed: true, error: '' }
  if (label === 'thoth:law-verify') return { reasoning: 'v', law_json_exists: true, lock_commit_exists: true }
  if (label === 'thoth:verify') return { reasoning: 'ok', missing: [] }
  return null
}
const labels = (calls) => calls.map((c) => c.label)

test('arch dry-run gate: runs after Asimov compiles, BEFORE the lock; the FULL transcript feeds Athena\'s ruling pass', async () => {
  const { result, calls } = await runArch(lawArgs, respond())
  assert.equal(result.law_locked, true, 'an honest-red Law locks')
  const l = labels(calls)
  assert.ok(l.indexOf('asimov:law') < l.indexOf('thoth:dryrun:r0'), 'dry-run after the compile')
  assert.ok(l.indexOf('thoth:dryrun:r0') < l.indexOf('athena:dryrun:r0'), 'transcript before the ruling')
  assert.ok(l.indexOf('athena:dryrun:r0') < l.indexOf('thoth:law-lock'), 'ruling before the lock — the gate is pre-lock')
  // the scribe runs the new CLI command, --json, pre-lock
  const scribe = calls.find((c) => c.label === 'thoth:dryrun:r0').prompt
  assert.match(scribe, /\/opt\/kiln-plugin\/scripts\/kiln-law\.mjs dryrun \/tmp\/nonexistent-kiln \/tmp\/nonexistent-kiln\/\.kiln --json/)
  assert.match(scribe, /VERBATIM/)
  // Athena receives the EXECUTED evidence — the verbatim transcript with its tails — and the
  // per-check honest-red vs broken-check ruling duty, not a static-reading brief
  const ruling = calls.find((c) => c.label === 'athena:dryrun:r0').prompt
  assert.match(ruling, /EXECUTED evidence, not static reading/)
  assert.match(ruling, /TypeError: Cannot read properties of undefined/, 'the transcript tails are in the prompt')
  assert.match(ruling, /"classification": "ambiguous"/, 'the deterministic classification rides along')
  assert.match(ruling, /honest-red: the check RAN and failed because the feature is unbuilt/)
  assert.match(ruling, /broken-check: the check crashed on ITS OWN code/)
  assert.match(ruling, /legitimately green/)
})

test('arch dry-run drill: a crashing check is BLOCKED from lock — fix cycles exhaust, law_locked:false, the lock never runs', async () => {
  const brokenRuling = { reasoning: 'r', verdict: 'FAIL', broken: [{ id: 'SC-001', why: 'KeyError-class crash: argv lookup before any assertion', fix: 'read argv defensively' }], green_legitimate: [] }
  const { result, calls } = await runArch(lawArgs, respond({ ruling: brokenRuling }))
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /dry-run gate failed — broken check\(s\) after 3 dry-run pass\(es\): SC-001/)
  assert.match(result.law_reason, /checks are code: they execute before we trust them/)
  const l = labels(calls)
  assert.ok(!l.includes('thoth:law-lock'), 'a broken check must NEVER reach the lock')
  // the bounded cycle: 3 dry-run passes, 2 Asimov check revisions, re-dryrun after each fix
  for (const lbl of ['thoth:dryrun:r0', 'athena:dryrun:r0', 'asimov:check-revise:r1', 'thoth:dryrun:r1', 'athena:dryrun:r1', 'asimov:check-revise:r2', 'thoth:dryrun:r2', 'athena:dryrun:r2']) {
    assert.ok(l.includes(lbl), `expected ${lbl} in the cycle`)
  }
  // the revision brief targets CHECK CODE, never the product
  const revise = calls.find((c) => c.label === 'asimov:check-revise:r1').prompt
  assert.match(revise, /SC-001: KeyError-class crash/)
  assert.match(revise, /never touch product code/)
  assert.match(revise, /keep lock_commit\s+null and every sha256 map EMPTY/)
  // P3.6 T2: the revise brief carries the twin-sync duty — a spec edit regenerates the on-disk twin
  assert.match(revise, /regenerate the on-disk twin/)
  assert.match(revise, /<sc-id>\.probe\.json/)
})

test('arch dry-run fix cycle: broken on pass 1, clean on pass 2 — revision then re-dryrun then lock', async () => {
  const ruling = (r) => r === 0
    ? { reasoning: 'r', verdict: 'FAIL', broken: [{ id: 'SC-001', why: 'usage error' }], green_legitimate: [] }
    : passRuling
  const { result, calls } = await runArch(lawArgs, respond({ ruling }))
  assert.equal(result.law_locked, true)
  const l = labels(calls)
  assert.ok(l.includes('asimov:check-revise:r1'), 'one revision')
  assert.ok(!l.includes('asimov:check-revise:r2'), 'no second revision needed')
  assert.ok(l.indexOf('asimov:check-revise:r1') < l.indexOf('thoth:dryrun:r1'), 'the fix re-dryruns')
  assert.ok(l.indexOf('athena:dryrun:r1') < l.indexOf('thoth:law-lock'), 'lock only after the clean pass')
})

test('arch dry-run deterministic floor: a mechanical broken-check overrides a sloppy Athena PASS', async () => {
  const dry = {
    reasoning: 'd', exit: 0, error: '',
    transcript: [{ id: 'SC-001', kind: 'shell', classification: 'broken-check', exit: 127, signal: null, duration_ms: 2, stdout_tail: '', stderr_tail: 'bash: nope: command not found' }],
  }
  const { result, calls } = await runArch(lawArgs, respond({ dryrun: dry })) // ruling stays PASS/empty
  assert.equal(result.law_locked, false, 'PASS over a deterministic broken-check must not stand')
  assert.match(result.law_reason, /SC-001/)
  assert.ok(!labels(calls).includes('thoth:law-lock'))
  assert.ok(labels(calls).includes('asimov:check-revise:r1'), 'the floor routes into the same fix cycle')
})

test('arch dry-run green handling: ruled-legitimate green is recorded pre_satisfied in the lock brief; unruled green blocks', async () => {
  const greenDry = {
    reasoning: 'd', exit: 0, error: '',
    transcript: [{ id: 'SC-001', kind: 'shell', classification: 'green', exit: 0, signal: null, duration_ms: 3, stdout_tail: '', stderr_tail: '' }],
  }
  // brownfield: Athena rules the green legitimate → lock proceeds and records pre_satisfied
  const legit = await runArch(lawArgs, respond({ dryrun: greenDry, ruling: { reasoning: 'r', verdict: 'PASS', broken: [], green_legitimate: ['SC-001'] } }))
  assert.equal(legit.result.law_locked, true)
  const lockPrompt = legit.calls.find((c) => c.label === 'thoth:law-lock').prompt
  assert.match(lockPrompt, /"pre_satisfied": true/, 'the lock brief records the brownfield green')
  assert.match(lockPrompt, /SC-001/)
  assert.ok(lockPrompt.indexOf('pre_satisfied') < lockPrompt.indexOf('kiln-law.mjs index'), 'the pre_satisfied edit lands BEFORE index hashes the Law')
  // greenfield: the same green unruled is a trivially-passing check — blocked
  const unruled = await runArch(lawArgs, respond({ dryrun: greenDry })) // PASS, green_legitimate []
  assert.equal(unruled.result.law_locked, false)
  assert.match(unruled.result.law_reason, /SC-001/)
  // and the default (no greens anywhere) lock brief carries NO pre_satisfied step
  const plain = await runArch(lawArgs, respond())
  assert.doesNotMatch(plain.calls.find((c) => c.label === 'thoth:law-lock').prompt, /pre_satisfied/)
})

test('arch DRYRUN_SCHEMA: every transcript-entry evidence field is REQUIRED — a schema-legal scribe cannot drop the tails Athena rules on', async () => {
  const { calls } = await runArch(lawArgs, respond())
  const schema = calls.find((c) => c.label === 'thoth:dryrun:r0').schema
  assert.ok(schema, 'the scribe leg carries its schema')
  const entry = schema.properties.transcript.items
  assert.deepEqual(
    [...entry.required].sort(),
    ['classification', 'duration_ms', 'exit', 'id', 'kind', 'signal', 'stderr_tail', 'stdout_tail'],
    'all eight evidence fields are required — dropping stdout_tail/stderr_tail (or exit/signal/duration) is schema-illegal'
  )
  // the CLI legitimately emits null for a deferred probe's exit/signal and a signal-death's exit
  assert.deepEqual(entry.properties.exit.type, ['number', 'null'])
  assert.deepEqual(entry.properties.signal.type, ['string', 'null'])
  assert.equal(entry.additionalProperties, false)
  // P3.6 T2: law_violations is REQUIRED top-level (empty on the normal path) with the typed shape
  assert.deepEqual([...schema.required].sort(), ['exit', 'law_violations', 'transcript'])
  const viol = schema.properties.law_violations.items
  assert.deepEqual([...viol.required].sort(), ['code', 'message', 'path'], 'the typed validator error passes through whole')
  assert.equal(viol.additionalProperties, false)
  // and the ruling leg still demands the verdict triple
  const rulingSchema = calls.find((c) => c.label === 'athena:dryrun:r0').schema
  assert.deepEqual([...rulingSchema.required].sort(), ['broken', 'green_legitimate', 'verdict'])
})

test('arch dry-run ruling soundness: green_legitimate naming a non-green id is an UNSOUND ruling — fail closed with the named offender, never filter, never lock', async () => {
  const redDry = {
    reasoning: 'd', exit: 0, error: '',
    transcript: [
      { id: 'SC-001', kind: 'pytest', classification: 'honest-red', exit: 1, signal: null, duration_ms: 5, stdout_tail: '1 failed in 0.02s', stderr_tail: '' },
      { id: 'SC-002', kind: 'probe', classification: 'deferred', exit: null, signal: null, duration_ms: 0, stdout_tail: '', stderr_tail: '' },
    ],
  }
  // the sloppy ruling: PASS, nothing broken, but an honest-red id (and a phantom id) marked
  // legitimately green — locking on it would forge a pre_satisfied record with no executed green
  const sloppy = { reasoning: 'r', verdict: 'PASS', broken: [], green_legitimate: ['SC-001', 'SC-999'] }
  const { result, calls } = await runArch(lawArgs, respond({ dryrun: redDry, ruling: sloppy }))
  assert.equal(result.law_locked, false, 'an unsound ruling must never lock')
  assert.match(result.law_reason, /ruling unsound — green_legitimate names id\(s\) the executed transcript does not classify green/)
  assert.match(result.law_reason, /SC-001 \(honest-red\)/, 'the offender is named with its executed classification')
  assert.match(result.law_reason, /SC-999 \(not in transcript\)/, 'an id that never ran is named too')
  assert.match(result.law_reason, /a pre_satisfied record must trace to an executed green/)
  const l = labels(calls)
  assert.ok(!l.includes('thoth:law-lock'), 'never silently filter the id and lock anyway')
  assert.ok(!l.includes('asimov:check-revise:r1'), 'the check code is not the defect — no Asimov cycle over a sound check')
})

test('arch dry-run gate fails CLOSED: dead scribe, failed dryrun command, dead ruling agent — all block the lock with a reason', async () => {
  const dead = await runArch(lawArgs, respond({ dryrun: null }))
  assert.equal(dead.result.law_locked, false)
  assert.match(dead.result.law_reason, /dry-run produced no transcript — the scribe produced no report/)
  assert.ok(!labels(dead.calls).includes('thoth:law-lock'))

  // an INFRA-failed command (nonzero exit, no violations reported) is not routable — plain break
  const failedCmd = await runArch(lawArgs, respond({ dryrun: { reasoning: 'd', exit: 127, transcript: [], law_violations: [], error: 'bash: node: command not found' } }))
  assert.equal(failedCmd.result.law_locked, false)
  assert.match(failedCmd.result.law_reason, /command not found/)
  assert.ok(!labels(failedCmd.calls).includes('asimov:law-revise:r1'), 'an infra failure is NOT a law defect — no author to route to')

  const noRuling = await runArch(lawArgs, respond({ ruling: null }))
  assert.equal(noRuling.result.law_locked, false, 'a dead ruling agent is a FAIL, never a shrug')
  assert.ok(!labels(noRuling.calls).includes('thoth:law-lock'))
})

// ── RUN-B FINDING 1 (P3.6 T2): the law-revise routing — the author fixes his own Law ────────────
const violationsDry = {
  reasoning: 'd', exit: 0, error: '', transcript: [],
  law_violations: [{ code: 'invalid_value', path: 'checks[1].spec.landmarks[0]', message: 'checks[1].spec.landmarks[0]: role and name must be nonempty strings (selectors by role+name, never CSS)' }],
}

test('arch law-revise drill: a schema-invalid law routes to asimov:law-revise (Athena skipped — validator output needs no judge), a valid second round locks', async () => {
  const dryrun = (r) => (r === 0 ? violationsDry : cleanDry)
  const { result, calls } = await runArch(lawArgs, respond({ dryrun }))
  assert.equal(result.law_locked, true, 'one law revision, then the normal gate — the field fixture is lockable after the fix')
  const l = labels(calls)
  assert.ok(l.includes('asimov:law-revise:r1'), 'the violations route to the LAW author')
  assert.ok(!l.includes('athena:dryrun:r0'), 'no Athena on the violations round — deterministic validator output')
  assert.ok(l.includes('athena:dryrun:r1'), 'the revised Law goes through the normal executed-transcript ruling')
  assert.ok(l.indexOf('asimov:law-revise:r1') < l.indexOf('thoth:dryrun:r1'), 'the fix re-dryruns')
  assert.ok(l.indexOf('athena:dryrun:r1') < l.indexOf('thoth:law-lock'), 'lock only after the clean pass')
  // the revise brief: violations verbatim, the twin-sync duty, the landmark rule, product untouchable
  const revise = calls.find((c) => c.label === 'asimov:law-revise:r1').prompt
  assert.match(revise, /\[invalid_value\] checks\[1\]\.spec\.landmarks\[0\]: checks\[1\]\.spec\.landmarks\[0\]: role and name must be nonempty strings/, 'the typed violation rides verbatim — code, path, AND message (invalid_json vs invalid_value tells Asimov rewrite-vs-surgical; validateLaw messages embed the path, so it renders twice — verbatim means verbatim)')
  assert.match(revise, /regenerate the matching on-disk twin/)
  assert.match(revise, /ACCESSIBLE NAME — role AND name, both nonempty/)
  assert.match(revise, /derive a stable user-visible name from the SC text/)
  assert.match(revise, /never touch product code/)
  assert.match(revise, /Keep lock_commit null and every sha256 map EMPTY/)
})

test('arch law-revise drill: violations on EVERY round exhaust the bounded cycle — law_locked:false, the lock never runs, Athena never called', async () => {
  const { result, calls } = await runArch(lawArgs, respond({ dryrun: violationsDry }))
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /law\.json still schema-invalid after 3 dry-run pass\(es\)/)
  assert.match(result.law_reason, /checks\[1\]\.spec\.landmarks\[0\]/, 'the reason names the violation path for the conductor')
  const l = labels(calls)
  assert.ok(l.includes('asimov:law-revise:r1') && l.includes('asimov:law-revise:r2'), 'two revisions in three passes — the same bound as the check cycle')
  assert.ok(!l.includes('asimov:law-revise:r3'), 'the bound holds')
  assert.ok(!l.some((x) => x.startsWith('athena:dryrun')), 'nothing to judge on any round')
  assert.ok(!l.includes('thoth:law-lock'), 'exhausted revisions still end blocked — fail-closed survives the routing')
})

test('arch law-revise drill: a scribe reporting violations WITH a transcript routes on the transcript — executed evidence outranks a mixed report', async () => {
  // belt-and-suspenders: the CLI never emits both, but a confused scribe might — the executed
  // transcript path (Athena + deterministic floor) must win over the violations branch.
  const mixed = { ...cleanDry, law_violations: violationsDry.law_violations }
  const { result, calls } = await runArch(lawArgs, respond({ dryrun: mixed }))
  assert.equal(result.law_locked, true, 'the normal gate ran')
  assert.ok(labels(calls).includes('athena:dryrun:r0'), 'Athena rules the executed transcript')
  assert.ok(!labels(calls).some((x) => x.startsWith('asimov:law-revise')), 'no law-revise when checks actually executed')
})
