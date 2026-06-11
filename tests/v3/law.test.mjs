// law.test.mjs — T1 acceptance: THE LAW (BLUEPRINT §5/§5.1). Three floors in one file:
//   1. src/law.mjs pure fns — validateLaw (mirrors schemas/law.schema.json), flipPlan (the
//      red/green lifecycle arithmetic), lawSummary.
//   2. scripts/kiln-law.mjs end-to-end in a tmp GIT REPO fixture — the §5 lock sequence (index,
//      THEN the single "test(law): lock acceptance gates" commit) and the tamper drill exactly
//      as specified: index → lock commit → verify clean → tamper a locked file → verify exits 2
//      with TAMPER lines → run a trivially-green + a red check (+ an inert probe) → status folds
//      correctly. The trust root is exercised hard: once the Law is committed, the COMMITTED
//      version is canonical and the live law.json is never trusted — the laundering drill
//      (tamper + update the recorded hash, even committed), the anchor-move drill (launder AND
//      move lock_commit to the tamper commit — review cycle 2's attack), the unlock drill
//      (reset/delete the live law), run's tamper gate firing pre-execution AND re-firing before
//      EACH check (§5.1: before EVERY check run — the mid-run tamper drill, cycle 3), and the
//      --flips/--before red/green lifecycle gates.
//   3. The GENERATED workflows/architecture.js Law phase, mock-driven — Asimov after Athena
//      PASS and before handoff, in-script SC↔check coverage arithmetic, fail-closed
//      law_locked:false + reason on every failure path (the conductor escalates, never a silent
//      proceed).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateLaw, flipPlan, lawSummary } from '../../plugins/kiln/src/law.mjs'

// ── shared law fixtures ──────────────────────────────────────────────────────────────────────────
const check = (over = {}) => ({
  id: 'SC-001', milestone: 'M1', kind: 'shell', cmd: 'bash tests/acceptance/sc-001.sh',
  files: ['tests/acceptance/sc-001.sh'], sha256: {}, expected: 'exit0', timeout_s: 10, ...over,
})
const preLockLaw = (checks) => ({ schema: 1, lock_commit: null, checks })
const HEX64 = 'a'.repeat(64)

// ── 1a. validateLaw ──────────────────────────────────────────────────────────────────────────────
test('validateLaw: a valid pre-lock law and a valid locked law both pass', () => {
  assert.equal(validateLaw(preLockLaw([check()])).ok, true)
  const locked = {
    schema: 1, lock_commit: 'ab12cd34ef',
    checks: [check({ sha256: { 'tests/acceptance/sc-001.sh': HEX64 } }), check({ id: 'SC-002', kind: 'probe', cmd: '', files: ['tests/acceptance/sc-002.probe.md'], sha256: { 'tests/acceptance/sc-002.probe.md': HEX64 }, pre_satisfied: false })],
  }
  const res = validateLaw(locked)
  assert.deepEqual(res, { ok: true, errors: [] })
})

test('validateLaw: rejects non-objects, unknown/missing top-level keys, bad schema, bad lock_commit', () => {
  for (const bad of [null, 42, 'law', []]) assert.equal(validateLaw(bad).ok, false)
  assert.ok(validateLaw({ schema: 1, lock_commit: null, checks: [check()], extra: 1 }).errors.some((e) => e.code === 'unknown_key'))
  assert.ok(validateLaw({ schema: 1, checks: [check()] }).errors.some((e) => e.code === 'missing_key' && e.path === 'lock_commit'))
  assert.ok(validateLaw({ ...preLockLaw([check()]), schema: 2 }).errors.some((e) => e.path === 'schema'))
  for (const lc of ['XYZ', 'abc', '', 'g'.repeat(40)]) {
    assert.equal(validateLaw({ schema: 1, lock_commit: lc, checks: [check({ sha256: { 'tests/acceptance/sc-001.sh': HEX64 } })] }).ok, false, `lock_commit ${JSON.stringify(lc)}`)
  }
})

test('validateLaw: checks must be a non-empty array of well-formed entries', () => {
  assert.equal(validateLaw({ schema: 1, lock_commit: null, checks: [] }).ok, false)
  const cases = [
    [check({ id: 'SC1' }), 'id pattern'],
    [check({ id: 'sc-001' }), 'id case'],
    [check({ milestone: '' }), 'empty milestone'],
    [check({ kind: 'browser' }), 'unknown kind'],
    [check({ cmd: '' }), 'empty cmd on shell'],
    [check({ files: [] }), 'empty files'],
    [check({ files: ['/abs/path.sh'] }), 'absolute locked path'],
    [check({ files: ['../escape.sh'] }), 'dotdot locked path'],
    [check({ expected: 'exit1' }), 'expected enum'],
    [check({ timeout_s: 0 }), 'timeout 0'],
    [check({ timeout_s: 1.5 }), 'timeout fraction'],
    [check({ pre_satisfied: 'yes' }), 'pre_satisfied type'],
    [check({ extra: true }), 'unknown check key'],
  ]
  for (const [c, why] of cases) assert.equal(validateLaw(preLockLaw([c])).ok, false, why)
  // an empty cmd is legal ONLY for probe templates
  assert.equal(validateLaw(preLockLaw([check({ kind: 'probe', cmd: '' })])).ok, true)
})

test('validateLaw: duplicate check ids are rejected — every SC has exactly ONE entry', () => {
  const res = validateLaw(preLockLaw([check(), check()]))
  assert.ok(res.errors.some((e) => e.code === 'duplicate_id'))
})

test('validateLaw: the two legal lock states — pre-lock sha256 EMPTY; locked sha256 covers exactly files', () => {
  // pre-lock with a hash → lock_state violation
  assert.ok(validateLaw(preLockLaw([check({ sha256: { 'tests/acceptance/sc-001.sh': HEX64 } })])).errors.some((e) => e.code === 'lock_state'))
  // locked with a missing hash → lock_state violation
  assert.ok(validateLaw({ schema: 1, lock_commit: 'ab12cd3', checks: [check()] }).errors.some((e) => e.code === 'lock_state'))
  // sha256 key outside files, and a non-hex digest, both rejected
  assert.equal(validateLaw(preLockLaw([check({ sha256: { 'other.sh': HEX64 } })])).ok, false)
  assert.equal(validateLaw({ schema: 1, lock_commit: 'ab12cd3', checks: [check({ sha256: { 'tests/acceptance/sc-001.sh': 'nothex' } })] }).ok, false)
})

// ── 1b. flipPlan ─────────────────────────────────────────────────────────────────────────────────
const flipLaw = () => preLockLaw([
  check({ id: 'SC-001' }),
  check({ id: 'SC-002', files: ['tests/acceptance/sc-002.sh'] }),
  check({ id: 'SC-003', milestone: 'M2', files: ['tests/acceptance/sc-003.sh'] }),
  check({ id: 'SC-004', milestone: 'M2', kind: 'probe', cmd: '', files: ['tests/acceptance/sc-004.probe.md'] }),
])

test('flipPlan: red slice ids flip; green non-slice ids are the regression set', () => {
  const out = flipPlan(flipLaw(), ['SC-002', 'SC-003'], { 'SC-001': 'green', 'SC-002': 'red' })
  assert.deepEqual(out.flip, ['SC-002', 'SC-003']) // SC-003 unrun ⇒ reads as red
  assert.deepEqual(out.regression, ['SC-001'])
  assert.deepEqual(out.pre_satisfied, [])
  assert.deepEqual(out.unknown, [])
})

test('flipPlan: already-green and pre_satisfied slice ids are excluded from flip accounting and guarded as regressions (§5.1)', () => {
  const law = flipLaw()
  law.checks[2].pre_satisfied = true // SC-003 GREEN at lock (brownfield)
  const out = flipPlan(law, ['SC-001', 'SC-002', 'SC-003'], { 'SC-001': 'green', 'SC-002': 'red' })
  assert.deepEqual(out.flip, ['SC-002'])
  assert.deepEqual(out.pre_satisfied, ['SC-001', 'SC-003'])
  assert.deepEqual(out.regression, ['SC-001', 'SC-003'])
})

test('flipPlan: deferred slice ids (P2 probes) land in deferred — neither flip nor regression', () => {
  const out = flipPlan(flipLaw(), ['SC-002', 'SC-004'], { 'SC-004': 'deferred' })
  assert.deepEqual(out.flip, ['SC-002'])
  assert.deepEqual(out.deferred, ['SC-004'])
  assert.deepEqual(out.regression, [])
})

test('flipPlan: unknown slice ids are returned, never thrown — coverage is arithmetic, the caller escalates', () => {
  const out = flipPlan(flipLaw(), ['SC-002', 'SC-099', 'SC-002'], {})
  assert.deepEqual(out.unknown, ['SC-099'])
  assert.deepEqual(out.flip, ['SC-002']) // input deduped
})

test('flipPlan: malformed inputs yield empty sets, never a throw', () => {
  assert.deepEqual(flipPlan(null, null, null), { flip: [], regression: [], pre_satisfied: [], deferred: [], unknown: [] })
  assert.deepEqual(flipPlan({}, 'SC-001', []).flip, [])
})

// ── 1c. lawSummary ───────────────────────────────────────────────────────────────────────────────
test('lawSummary: folds counts by kind and milestone, unique files, lock state, and renders a line', () => {
  const law = flipLaw()
  const s = lawSummary(law)
  assert.equal(s.checks, 4)
  assert.equal(s.files, 4)
  assert.deepEqual(s.by_kind, { shell: 3, probe: 1 })
  assert.deepEqual(s.by_milestone, { M1: 2, M2: 2 })
  assert.equal(s.locked, false)
  assert.match(s.line, /4 check\(s\) \(3 shell, 1 probe\) across 2 milestone\(s\), 4 locked file\(s\) — UNLOCKED/)
  law.lock_commit = 'ab12cd34ef567890'
  const s2 = lawSummary(law)
  assert.equal(s2.locked, true)
  assert.match(s2.line, /locked @ ab12cd3/)
  assert.deepEqual(lawSummary(null), { checks: 0, files: 0, by_kind: {}, by_milestone: {}, locked: false, lock_commit: null, line: '0 check(s) across 0 milestone(s), 0 locked file(s) — UNLOCKED' })
})

// ── 2. kiln-law CLI — end-to-end in a tmp git repo ───────────────────────────────────────────────
const CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-law.mjs', import.meta.url))
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

const gitIn = (dir, ...args) => {
  const res = spawnSync('git', ['-C', dir, '-c', 'user.email=kiln@test', '-c', 'user.name=kiln', ...args], { encoding: 'utf8' })
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`)
  return res.stdout.trim()
}

const fixtureLaw = () => ({
  schema: 1, lock_commit: null,
  checks: [
    { id: 'SC-001', milestone: 'M1', kind: 'shell', cmd: 'bash tests/acceptance/sc-001.sh', files: ['tests/acceptance/sc-001.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
    { id: 'SC-002', milestone: 'M1', kind: 'shell', cmd: 'bash tests/acceptance/sc-002.sh', files: ['tests/acceptance/sc-002.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
    { id: 'SC-003', milestone: 'M2', kind: 'probe', cmd: '', files: ['tests/acceptance/sc-003.probe.md'], sha256: {}, expected: 'exit0', timeout_s: 30 },
  ],
})

// makeFixture — a tmp git repo at the §5 starting point: one committed product file (the
// pre-gate HEAD that index records as lock_commit), plus the gates — one trivially-green shell
// check, one red, one inert probe template — and the pre-lock law.json on disk, UNCOMMITTED.
// The contract sequence is index FIRST, then the single lock commit (lockFixture).
function makeFixture(law = fixtureLaw()) {
  const proj = mkdtempSync(join(tmpdir(), 'kiln-law-test-'))
  const kiln = join(proj, '.kiln')
  mkdirSync(join(proj, 'tests/acceptance'), { recursive: true })
  mkdirSync(kiln, { recursive: true })
  writeFileSync(join(proj, 'app.txt'), 'hello world\n')
  gitIn(proj, 'init', '-q')
  gitIn(proj, 'add', '-A')
  gitIn(proj, 'commit', '-qm', 'initial product commit')
  writeFileSync(join(proj, 'tests/acceptance/sc-001.sh'), 'grep -q hello app.txt\n')
  writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), 'exit 1\n')
  writeFileSync(join(proj, 'tests/acceptance/sc-003.probe.md'), '# probe template SC-003: landing page shows button role=button name="Add"\n')
  writeFileSync(join(kiln, 'law.json'), JSON.stringify(law, null, 2) + '\n')
  return { proj, kiln }
}
// lockFixture — the EXACT §5 sequence the workflow's locksmith runs: kiln-law index, then ONE
// "test(law): lock acceptance gates" commit carrying the gates + the indexed law.json.
function lockFixture(proj, kiln) {
  const res = cli('index', proj, kiln)
  assert.equal(res.status, 0, res.stderr)
  gitIn(proj, 'add', 'tests/acceptance', '.kiln/law.json')
  gitIn(proj, 'commit', '-qm', 'test(law): lock acceptance gates')
  return res
}
const readLawFile = (kiln) => JSON.parse(readFileSync(join(kiln, 'law.json'), 'utf8'))

test('CLI index: hashes the on-disk (still uncommitted) gates, records HEAD as lock_commit, and refuses to re-lock', () => {
  const { proj, kiln } = makeFixture()
  try {
    const preGateHead = gitIn(proj, 'rev-parse', 'HEAD')
    const res = cli('index', proj, kiln)
    assert.equal(res.status, 0, res.stderr)
    assert.match(res.stdout, /locked 3 check\(s\), 3 file\(s\) @ [0-9a-f]{40}/)
    assert.match(res.stdout, /git add tests\/acceptance \.kiln\/law\.json && git commit -m "test\(law\): lock acceptance gates"/, 'index hands the agent the exact §5 lock-commit command')
    const law = readLawFile(kiln)
    // lock_commit is the last PRE-gate commit — the gates were uncommitted at index time
    // (the §5 sequence: index, THEN the single lock commit; git content-addressing means
    // law.json can never carry the sha of the commit that contains it).
    assert.equal(law.lock_commit, preGateHead)
    assert.equal(law.checks[0].sha256['tests/acceptance/sc-001.sh'], sha256('grep -q hello app.txt\n'))
    assert.equal(law.checks[2].sha256['tests/acceptance/sc-003.probe.md'].length, 64)
    // immutable after lock
    const again = cli('index', proj, kiln)
    assert.equal(again.status, 1)
    assert.match(again.stderr, /already locked/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI verify: the index→lock-commit window — re-hash arm guards alone; the lock commit closes it cleanly', () => {
  const { proj, kiln } = makeFixture()
  try {
    assert.equal(cli('index', proj, kiln).status, 0, 'index alone — the lock commit comes later in this drill')
    // in the window the gates are untracked (no git anchor yet) — verify is clean…
    assert.equal(cli('verify', proj, kiln).status, 0)
    // …and a worktree tamper is still caught by the re-hash arm
    writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), 'exit 0\n')
    const tampered = cli('verify', proj, kiln)
    assert.equal(tampered.status, 2)
    assert.match(tampered.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m)
    // restore, then close the window with the single §5 lock commit → clean
    writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), 'exit 1\n')
    gitIn(proj, 'add', 'tests/acceptance', '.kiln/law.json')
    gitIn(proj, 'commit', '-qm', 'test(law): lock acceptance gates')
    assert.equal(cli('verify', proj, kiln).status, 0)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI index: a locked file missing on disk fails with its name', () => {
  const { proj, kiln } = makeFixture()
  try {
    rmSync(join(proj, 'tests/acceptance/sc-002.sh'))
    const res = cli('index', proj, kiln)
    assert.equal(res.status, 1)
    assert.match(res.stderr, /missing on disk[\s\S]*tests\/acceptance\/sc-002\.sh/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI tamper drill: index → lock commit → verify clean → tamper a locked file → verify exits 2 with a TAMPER line → restore → clean', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    const clean = cli('verify', proj, kiln)
    assert.equal(clean.status, 0, clean.stderr)
    assert.match(clean.stdout, /verify clean — 3 locked file\(s\)/)
    // the drill: a builder edits a locked check
    writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), 'exit 0\n')
    const tampered = cli('verify', proj, kiln)
    assert.equal(tampered.status, 2, 'ANY mismatch must exit 2')
    assert.match(tampered.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m)
    assert.doesNotMatch(tampered.stdout, /TAMPER: tests\/acceptance\/sc-001\.sh/)
    // restore → clean again
    gitIn(proj, 'checkout', '--', 'tests/acceptance/sc-002.sh')
    assert.equal(cli('verify', proj, kiln).status, 0)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI laundering drill: tamper a file AND update its recorded hash — the live law.json is not trusted (the committed Law is canonical); even a COMMITTED tamper cannot launder', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    const evil = 'exit 0\n'
    writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), evil)
    const law = readLawFile(kiln)
    law.checks[1].sha256['tests/acceptance/sc-002.sh'] = sha256(evil) // launder the hash map
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(law, null, 2) + '\n')
    const res = cli('verify', proj, kiln)
    assert.equal(res.status, 2, 'a laundered hash must not pass — the canonical hashes live in the lock commit')
    assert.match(res.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m)
    assert.match(res.stdout, /^TAMPER: \.kiln\/law\.json$/m, 'the edited Law itself is an offender')
    // escalation: the tamperer COMMITS the tampered gate + laundered law.json — the canonical
    // Law is still the FIRST locked version in history (the legit lock commit), so both the
    // laundered content and the diverged law.json keep showing.
    gitIn(proj, 'add', '-A')
    gitIn(proj, 'commit', '-qm', 'feat: totally legitimate work')
    const committed = cli('verify', proj, kiln)
    assert.equal(committed.status, 2, 'a committed tamper must not move the anchor')
    assert.match(committed.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m)
    assert.match(committed.stdout, /^TAMPER: \.kiln\/law\.json$/m)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI anchor-move drill (review cycle 2): tamper + launder the hash + COMMIT + move lock_commit to the tamper commit — the COMMITTED Law is canonical, verify and run still exit 2', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    // the proven attack: tamper a locked red check green, recompute its hash into the live
    // law.json, commit everything, then point the live lock_commit at the tamper commit so BOTH
    // gate arms read attacker-controlled data.
    const evil = 'exit 0\n'
    writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), evil)
    const law = readLawFile(kiln)
    law.checks[1].sha256['tests/acceptance/sc-002.sh'] = sha256(evil)
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(law, null, 2) + '\n')
    gitIn(proj, 'add', '-A')
    gitIn(proj, 'commit', '-qm', 'feat: totally legitimate work')
    law.lock_commit = gitIn(proj, 'rev-parse', 'HEAD') // re-anchor the live Law on the tamper
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(law, null, 2) + '\n')
    const res = cli('verify', proj, kiln)
    assert.equal(res.status, 2, 'a moved lock_commit must not move the anchor — the committed Law is canonical')
    assert.match(res.stdout, /^TAMPER: \.kiln\/law\.json$/m, 'the re-anchored Law itself is an offender')
    assert.match(res.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m, 'the tampered gate shows against the canonical hashes')
    // freshness side: run refuses identically — nothing executes, no evidence lands
    const run = cli('run', proj, kiln, '--only', 'SC-002', '--expect-green', 'SC-002')
    assert.equal(run.status, 2)
    assert.match(run.stdout, /^TAMPER: \.kiln\/law\.json$/m)
    assert.doesNotMatch(run.stdout, /^RUN /m, 'no run starts against a re-anchored Law')
    assert.ok(!existsSync(join(kiln, 'evidence')), 'no evidence dir for a refused run')
    // escalation: COMMIT the re-anchored law.json too — live now equals A committed version,
    // just never the FIRST locked one. The canonical anchor still wins.
    gitIn(proj, 'add', '-A')
    gitIn(proj, 'commit', '-qm', 'chore: bookkeeping')
    const buried = cli('verify', proj, kiln)
    assert.equal(buried.status, 2, 'committing the moved anchor must not legitimize it')
    assert.match(buried.stdout, /^TAMPER: \.kiln\/law\.json$/m)
    assert.match(buried.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI unlock drill: resetting the live law.json to pre-lock (or deleting it) cannot re-open a committed Law — index refuses, verify exits 2', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    // reset the live Law to its pre-lock shape (lock_commit null, empty hash maps) hoping to
    // re-index at a friendlier HEAD
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(fixtureLaw(), null, 2) + '\n')
    const idx = cli('index', proj, kiln)
    assert.equal(idx.status, 1, 'index must refuse to re-lock over a committed Law')
    assert.match(idx.stderr, /already locked and committed/)
    const ver = cli('verify', proj, kiln)
    assert.equal(ver.status, 2, 'an un-locked live law over a committed Law is tamper')
    assert.match(ver.stdout, /^TAMPER: \.kiln\/law\.json$/m)
    // deleting the live Law is tamper, not absence
    rmSync(join(kiln, 'law.json'))
    const gone = cli('verify', proj, kiln)
    assert.equal(gone.status, 2)
    assert.match(gone.stdout, /^TAMPER: \.kiln\/law\.json$/m)
    assert.equal(cli('run', proj, kiln).status, 2)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI verify brownfield: a locked path already IN lock_commit anchors on lock_commit itself', () => {
  const law = fixtureLaw()
  law.checks[0].files = ['tests/acceptance/sc-001.sh', 'app.txt'] // app.txt predates the gates
  const { proj, kiln } = makeFixture(law)
  try {
    lockFixture(proj, kiln)
    assert.equal(cli('verify', proj, kiln).status, 0)
    const evil = 'tampered product file\n'
    writeFileSync(join(proj, 'app.txt'), evil)
    const tampered = cli('verify', proj, kiln)
    assert.equal(tampered.status, 2)
    assert.match(tampered.stdout, /^TAMPER: app\.txt$/m)
    // laundered too (hash updated) — the lock_commit diff arm still catches it
    const l = readLawFile(kiln)
    l.checks[0].sha256['app.txt'] = sha256(evil)
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(l, null, 2) + '\n')
    const laundered = cli('verify', proj, kiln)
    assert.equal(laundered.status, 2)
    assert.match(laundered.stdout, /^TAMPER: app\.txt$/m)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run: the §5.1 tamper gate runs BEFORE any check — a tampered lock exits 2 with TAMPER lines, nothing executed, no evidence written', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    // the reviewer drill: tamper a locked red check to `exit 0`, then try to run it green
    writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), 'exit 0\n')
    const res = cli('run', proj, kiln, '--only', 'SC-002', '--expect-green', 'SC-002')
    assert.equal(res.status, 2, 'run must enforce the tamper gate before executing checks')
    assert.match(res.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m)
    assert.doesNotMatch(res.stdout, /^RUN /m, 'no run starts against a tampered Law')
    assert.doesNotMatch(res.stdout, /GREEN SC-002/, 'the tampered check must never report GREEN')
    assert.match(res.stderr, /no check was executed/)
    assert.ok(!existsSync(join(kiln, 'evidence')), 'no evidence dir for a refused run')
    // default (report-only) mode is gated identically
    assert.equal(cli('run', proj, kiln).status, 2)
    // restore → run proceeds again
    gitIn(proj, 'checkout', '--', 'tests/acceptance/sc-002.sh')
    assert.equal(cli('run', proj, kiln).status, 0)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run mid-run tamper drill (review cycle 3): the gate re-fires before EVERY check — a check whose cmd rewrites another locked file aborts the run with exit 2 before the tampered check executes', () => {
  const { proj, kiln } = makeFixture()
  try {
    // the cycle-3 attack: locked SC-001 itself rewrites locked SC-002 red→green, then exits 0;
    // a batch-level gate sees a clean worktree up front and folds BOTH green.
    writeFileSync(join(proj, 'tests/acceptance/sc-001.sh'), 'echo "exit 0" > tests/acceptance/sc-002.sh\n')
    lockFixture(proj, kiln)
    const res = cli('run', proj, kiln, '--only', 'SC-001,SC-002', '--expect-green', 'SC-001,SC-002')
    assert.equal(res.status, 2, 'a mid-batch tamper must exit 2, never fold green')
    assert.match(res.stdout, /^GREEN SC-001/m, 'the tampering check itself ran — its tamper is only observable after it')
    assert.match(res.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m)
    assert.doesNotMatch(res.stdout, /GREEN SC-002|RED SC-002/, 'the tampered check must never execute')
    assert.doesNotMatch(res.stdout, /^RESULT /m, 'an aborted run prints no RESULT summary')
    assert.match(res.stderr, /tamper gate failed before SC-002/)
    assert.match(res.stderr, /evidence is partial and untrusted/)
    // evidence: SC-001 executed and landed; SC-002 left nothing
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    const lines = readFileSync(join(kiln, 'evidence', runId, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    assert.deepEqual(lines.map((l) => l.id), ['SC-001'])
    assert.ok(!existsSync(join(kiln, 'evidence', runId, 'checks', 'SC-002.log')), 'no log for a never-executed check')
    // §6 fail-closed: the aborted run never finalizes its manifest — no results_sha256, no
    // completed_at — so the build spine's freshness gate reads the partial evidence as stale.
    const manifest = JSON.parse(readFileSync(join(kiln, 'evidence', runId, 'run.json'), 'utf8'))
    assert.equal(manifest.results_sha256, undefined, 'an aborted run must NOT finalize results_sha256')
    assert.equal(manifest.completed_at, undefined, 'an aborted run must NOT record completed_at')
    assert.equal(typeof manifest.head, 'string', 'the unfinalized manifest still anchors head/started_at')
    // and a follow-up verify reports the tamper exactly as the drill expects
    const ver = cli('verify', proj, kiln)
    assert.equal(ver.status, 2)
    assert.match(ver.stdout, /^TAMPER: tests\/acceptance\/sc-002\.sh$/m)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run mid-run tamper drill: a check that un-locks the live law.json mid-run is the Law tampering itself — exit 2, TAMPER on the Law', () => {
  const law = fixtureLaw()
  const { proj, kiln } = makeFixture(law)
  try {
    // locked SC-001 resets the live Law to its pre-lock shape mid-batch
    writeFileSync(join(proj, 'tests/acceptance/sc-001.sh'), `cat > .kiln/law.json <<'EOF'\n${JSON.stringify(law, null, 2)}\nEOF\n`)
    lockFixture(proj, kiln)
    const res = cli('run', proj, kiln)
    assert.equal(res.status, 2)
    assert.match(res.stdout, /^TAMPER: \.kiln\/law\.json$/m)
    assert.match(res.stderr, /tamper gate failed before SC-002/)
    assert.doesNotMatch(res.stdout, /SC-002 exit|GREEN SC-002|RED SC-002/, 'nothing executes after the Law diverges')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run mid-run tamper drill, index→lock-commit window: un-locking the live Law mid-run (no committed canonical yet) still aborts — exit 2, TAMPER on the Law', () => {
  const law = fixtureLaw()
  const { proj, kiln } = makeFixture(law)
  try {
    writeFileSync(join(proj, 'tests/acceptance/sc-001.sh'), `cat > .kiln/law.json <<'EOF'\n${JSON.stringify(law, null, 2)}\nEOF\n`)
    assert.equal(cli('index', proj, kiln).status, 0, 'index only — the lock commit never lands in this drill')
    const res = cli('run', proj, kiln)
    assert.equal(res.status, 2, 'a live Law reset to pre-lock mid-run must read as tamper, not as "run index first"')
    assert.match(res.stdout, /^TAMPER: \.kiln\/law\.json$/m)
    assert.match(res.stderr, /tamper gate failed before SC-002/)
    assert.doesNotMatch(res.stdout, /GREEN SC-002|RED SC-002/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

// ── run --flips/--before — the §5.1 red/green lifecycle gates ────────────────────────────────────
const lifecycleLaw = () => {
  const law = fixtureLaw()
  law.checks[0].pre_satisfied = true // SC-001 GREEN at lock (brownfield)
  law.checks[1].cmd = 'bash tests/acceptance/sc-002.sh'
  return law
}

test('CLI run --flips: declared flips must go RED→GREEN from the lock-time record; pre_satisfied is excluded from flip accounting and guarded as a regression', () => {
  const { proj, kiln } = makeFixture(lifecycleLaw())
  try {
    writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), 'test -f done.txt\n') // red until built
    lockFixture(proj, kiln)
    // flip declared but the check is still red → exit 1, with the machine-readable FLIP_UNMET
    // line the build spine's runner transcribes (one per unmet id, mirroring REGRESSION)
    const unmet = cli('run', proj, kiln, '--flips', 'SC-002')
    assert.equal(unmet.status, 1)
    assert.match(unmet.stdout, /^PLAN flip=SC-002 regression=SC-001 pre_satisfied= deferred= \(before: lock\)$/m)
    assert.match(unmet.stdout, /^FLIP_UNMET SC-002$/m)
    assert.match(unmet.stderr, /flip unmet — declared RED→GREEN, still not green: SC-002/)
    // the builder does the work (a product file, NOT a locked path) → flip satisfied
    writeFileSync(join(proj, 'done.txt'), 'done\n')
    const flipped = cli('run', proj, kiln, '--flips', 'SC-002')
    assert.equal(flipped.status, 0, flipped.stderr)
    assert.match(flipped.stdout, /GREEN SC-002/)
    // a pre_satisfied id declared as a flip demands nothing (it was never RED — §5.1)
    const pre = cli('run', proj, kiln, '--flips', 'SC-001')
    assert.equal(pre.status, 0, pre.stderr)
    assert.match(pre.stdout, /^PLAN flip= regression=SC-001 pre_satisfied=SC-001 deferred= \(before: lock\)$/m)
    // a product edit (no lock tamper) breaks SC-001 → previously-GREEN regression, exit 1 not 2
    writeFileSync(join(proj, 'app.txt'), 'bye\n')
    const regressed = cli('run', proj, kiln, '--flips', 'SC-002')
    assert.equal(regressed.status, 1)
    assert.match(regressed.stdout, /^REGRESSION SC-001$/m)
    assert.match(regressed.stderr, /regression — previously-GREEN check\(s\) went red: SC-001/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run --flips --before: prior status comes from a recorded run — unmet flip AND regression both reported; a missing before-run dies', () => {
  const { proj, kiln } = makeFixture() // no pre_satisfied: regression knowledge comes from the recorded run
  try {
    lockFixture(proj, kiln)
    const runA = cli('run', proj, kiln) // SC-001 green, SC-002 red, SC-003 deferred — recorded
    assert.equal(runA.status, 0)
    const runIdA = runA.stdout.match(/^RUN (\S+) /m)[1]
    writeFileSync(join(proj, 'app.txt'), 'bye\n') // breaks SC-001 (green in runA)
    const res = cli('run', proj, kiln, '--flips', 'SC-002', '--before', runIdA)
    assert.equal(res.status, 1)
    assert.ok(res.stdout.includes(`(before: ${runIdA})`), 'the PLAN line names the before-run')
    assert.match(res.stdout, /^REGRESSION SC-001$/m)
    assert.match(res.stderr, /flip unmet — declared RED→GREEN, still not green: SC-002/)
    assert.match(res.stderr, /regression — previously-GREEN check\(s\) went red: SC-001/)
    const missing = cli('run', proj, kiln, '--flips', 'SC-002', '--before', 'no-such-run')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /--before run 'no-such-run' has no results\.jsonl/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI suite: persists the project suite as hashed evidence beside a recorded Law run — suite.log + sha256\'d suite.jsonl line, real exit on the SUITE line; exit 0 green / 1 red / 2 tamper; anchors only to a recorded run', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    const runA = cli('run', proj, kiln)
    assert.equal(runA.status, 0)
    const runId = runA.stdout.match(/^RUN (\S+) /m)[1]
    const runDir = join(kiln, 'evidence', runId)
    // green suite → exit 0, log + jsonl evidence with a verifiable hash
    const green = cli('suite', proj, kiln, runId, '--cmd', 'echo suite-ok && grep -q hello app.txt')
    assert.equal(green.status, 0, green.stderr)
    assert.match(green.stdout, new RegExp(`^SUITE ${runId} exit=0 .*log_sha256=[0-9a-f]{64}$`, 'm'))
    const log1 = readFileSync(join(runDir, 'suite.log'), 'utf8')
    assert.match(log1, /suite-ok/)
    const lines1 = readFileSync(join(runDir, 'suite.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    assert.equal(lines1.length, 1)
    assert.equal(lines1[0].exit, 0)
    assert.equal(lines1[0].cmd, 'echo suite-ok && grep -q hello app.txt')
    assert.equal(lines1[0].log_sha256, sha256(log1), 'the jsonl line hashes the exact persisted log')
    assert.equal(typeof lines1[0].duration_ms, 'number')
    // red suite → CLI exit 1 (exit 2 stays tamper-only), REAL exit on the SUITE line + in the evidence
    const red = cli('suite', proj, kiln, runId, '--cmd', 'exit 3')
    assert.equal(red.status, 1)
    assert.match(red.stdout, new RegExp(`^SUITE ${runId} exit=3 `, 'm'))
    assert.match(red.stderr, /project suite exited 3/)
    const lines2 = readFileSync(join(runDir, 'suite.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    assert.equal(lines2.length, 2, 'suite evidence appends — every attempt stays on the record')
    assert.equal(lines2[1].exit, 3)
    // suite.jsonl is a SIBLING of results.jsonl: the finalized run.json hash must still verify
    const manifest = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'))
    assert.equal(manifest.results_sha256, sha256(readFileSync(join(runDir, 'results.jsonl'), 'utf8')), 'suite evidence never touches the hash-finalized results.jsonl')
    // an unrecorded run id refuses (suite evidence anchors to a recorded Law run)
    const orphan = cli('suite', proj, kiln, 'no-such-run', '--cmd', 'echo x')
    assert.equal(orphan.status, 1)
    assert.match(orphan.stderr, /no results\.jsonl/)
    // --cmd is mandatory
    assert.equal(cli('suite', proj, kiln, runId).status, 1)
    // tamper gate fires BEFORE the suite executes — exit 2, nothing run, no new evidence line
    writeFileSync(join(proj, 'tests/acceptance/sc-001.sh'), 'exit 0\n')
    const tampered = cli('suite', proj, kiln, runId, '--cmd', 'echo never > tampered-ran.txt')
    assert.equal(tampered.status, 2)
    assert.match(tampered.stdout, /^TAMPER: tests\/acceptance\/sc-001\.sh$/m)
    assert.match(tampered.stderr, /the suite was not executed/)
    assert.ok(!existsSync(join(proj, 'tampered-ran.txt')), 'the suite command must never execute against a tampered Law')
    assert.equal(readFileSync(join(runDir, 'suite.jsonl'), 'utf8').split('\n').filter(Boolean).length, 2, 'no evidence line for a refused suite')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run --flips: a P2 probe flip is exempt (deferred, ledgered PROBE_DEFERRED); unknown or --only-excluded flip ids die', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    const probe = cli('run', proj, kiln, '--only', 'SC-003', '--flips', 'SC-003')
    assert.equal(probe.status, 0, 'an inert probe must not fail the lifecycle gate in P2')
    assert.match(probe.stdout, /^PROBE_DEFERRED SC-003$/m)
    const unknown = cli('run', proj, kiln, '--flips', 'SC-999')
    assert.equal(unknown.status, 1)
    assert.match(unknown.stderr, /--flips names unknown check id\(s\): SC-999/)
    const excluded = cli('run', proj, kiln, '--only', 'SC-001', '--flips', 'SC-002')
    assert.equal(excluded.status, 1)
    assert.match(excluded.stderr, /--flips names check\(s\) excluded by --only: SC-002/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run: report-only — green + red + PROBE_DEFERRED summary lines, hashed evidence, exit 0', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    const res = cli('run', proj, kiln)
    assert.equal(res.status, 0, `default is report-only even with a red check: ${res.stderr}`)
    const runId = res.stdout.match(/^RUN (\S+) HEAD ([0-9a-f]{40})$/m)
    assert.ok(runId, `run must print its runId + HEAD: ${res.stdout}`)
    assert.equal(runId[2], gitIn(proj, 'rev-parse', 'HEAD'))
    assert.match(res.stdout, /^GREEN SC-001 \(\d+ms\)$/m)
    assert.match(res.stdout, /^RED SC-002 exit 1 \(\d+ms\)$/m)
    assert.match(res.stdout, /^PROBE_DEFERRED SC-003$/m)
    assert.match(res.stdout, /^RESULT \S+ green=1 red=1 deferred=1$/m)
    // evidence contract (§5.1): per-check log + {id, exit, duration_ms, log_sha256} lines
    const runDir = join(kiln, 'evidence', runId[1])
    const lines = readFileSync(join(runDir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    assert.equal(lines.length, 3)
    const r1 = lines.find((l) => l.id === 'SC-001')
    assert.deepEqual(Object.keys(r1).sort(), ['duration_ms', 'exit', 'id', 'log_sha256'])
    assert.equal(r1.exit, 0)
    const logContent = readFileSync(join(runDir, 'checks', 'SC-001.log'), 'utf8')
    assert.equal(r1.log_sha256, sha256(logContent), 'log_sha256 must hash the log file content')
    assert.deepEqual(lines.find((l) => l.id === 'SC-003'), { id: 'SC-003', deferred: 'probe_deferred' })
    assert.ok(!existsSync(join(runDir, 'checks', 'SC-003.log')), 'a deferred probe executes nothing and logs nothing')
    // run.json — the §6 freshness anchor, CLI-written and FINALIZED on a complete run: head +
    // sha256(results.jsonl) + epochs are what the build spine's gate compares against HEAD.
    const manifest = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'))
    assert.equal(manifest.schema, 1)
    assert.equal(manifest.run_id, runId[1])
    assert.equal(manifest.head, gitIn(proj, 'rev-parse', 'HEAD'))
    assert.equal(manifest.results_sha256, sha256(readFileSync(join(runDir, 'results.jsonl'))), 'the manifest records the hash of the COMPLETE results.jsonl')
    const headEpoch = Number(gitIn(proj, 'show', '-s', '--format=%ct', 'HEAD'))
    assert.ok(Number.isInteger(manifest.started_at) && manifest.started_at >= headEpoch, 'evidence starts at or after the HEAD commit epoch')
    assert.ok(Number.isInteger(manifest.completed_at) && manifest.completed_at >= manifest.started_at, 'completed_at closes the run')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run: --only filters the check set; unknown ids die', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    const res = cli('run', proj, kiln, '--only', 'SC-001')
    assert.equal(res.status, 0)
    assert.match(res.stdout, /GREEN SC-001/)
    assert.doesNotMatch(res.stdout, /SC-002|SC-003/)
    const bad = cli('run', proj, kiln, '--only', 'SC-001,SC-999')
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /unknown check id\(s\): SC-999/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run: --run-prefix prepends the caller\'s stage token to the runId (so probes fall under it for a run-token-scoped sweep); a malformed prefix dies; absent ⇒ the bare runId format', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    // with --run-prefix: runId = <prefix>-<ISO>-<pid>; the evidence dir is named after it, and
    // the run.json manifest records the same prefixed id (so a sweep by <prefix> reaps this run).
    const tok = 'kbuild-abc-123'
    const res = cli('run', proj, kiln, '--only', 'SC-001', '--run-prefix', tok)
    assert.equal(res.status, 0, res.stderr)
    const runId = res.stdout.match(/^RUN (\S+) HEAD [0-9a-f]{40}$/m)[1]
    assert.ok(runId.startsWith(`${tok}-`), `the runId must begin with the prefix: ${runId}`)
    assert.match(runId, new RegExp(`^${tok}-\\d{8}T\\d{6}Z-\\d+$`), 'prefix + compact-ISO + pid')
    assert.equal(JSON.parse(readFileSync(join(kiln, 'evidence', runId, 'run.json'), 'utf8')).run_id, runId)
    // absent ⇒ the prior bare format (backward compatible — no leading prefix segment)
    const bare = cli('run', proj, kiln, '--only', 'SC-001').stdout.match(/^RUN (\S+) /m)[1]
    assert.match(bare, /^\d{8}T\d{6}Z-\d+$/, 'no --run-prefix ⇒ the unchanged <ISO>-<pid> runId')
    // a malformed prefix (a pkill -f / readdir pattern) is rejected — never an injection vector
    const bad = cli('run', proj, kiln, '--only', 'SC-001', '--run-prefix', 'has space;rm')
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /--run-prefix may only contain \[A-Za-z0-9._-\]/)
    const empty = cli('run', proj, kiln, '--only', 'SC-001', '--run-prefix', '')
    assert.equal(empty.status, 1, 'an empty prefix is rejected (would be a no-op leading dash)')
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run: --expect-green gates the exit — green passes, red fails, a P2 probe can never satisfy it', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    assert.equal(cli('run', proj, kiln, '--only', 'SC-001', '--expect-green', 'SC-001').status, 0)
    const red = cli('run', proj, kiln, '--only', 'SC-002', '--expect-green', 'SC-002')
    assert.equal(red.status, 1)
    assert.match(red.stderr, /expectation unmet — not green: SC-002/)
    const probe = cli('run', proj, kiln, '--only', 'SC-003', '--expect-green', 'SC-003')
    assert.equal(probe.status, 1, 'a deferred probe is not green')
    // --expect-green outside the --only selection is a caller error
    const outside = cli('run', proj, kiln, '--only', 'SC-001', '--expect-green', 'SC-002')
    assert.equal(outside.status, 1)
    assert.match(outside.stderr, /excluded by --only/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI run: a check overrunning timeout_s is SIGKILLed and recorded RED with exit 124', () => {
  const law = fixtureLaw()
  law.checks[1] = { id: 'SC-002', milestone: 'M1', kind: 'shell', cmd: 'sleep 5', files: ['tests/acceptance/sc-002.sh'], sha256: {}, expected: 'exit0', timeout_s: 1 }
  const { proj, kiln } = makeFixture(law)
  try {
    lockFixture(proj, kiln)
    const res = cli('run', proj, kiln, '--only', 'SC-002')
    assert.equal(res.status, 0) // report-only
    assert.match(res.stdout, /^RED SC-002 exit 124 \(timeout\)/m)
    const runId = res.stdout.match(/^RUN (\S+) /m)[1]
    const line = JSON.parse(readFileSync(join(kiln, 'evidence', runId, 'results.jsonl'), 'utf8').trim())
    assert.equal(line.exit, 124)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI status: folds results.jsonl → {green, red, deferred} in law order; a missing run dies', () => {
  const { proj, kiln } = makeFixture()
  try {
    lockFixture(proj, kiln)
    const run = cli('run', proj, kiln)
    const runId = run.stdout.match(/^RUN (\S+) /m)[1]
    const res = cli('status', kiln, runId)
    assert.equal(res.status, 0, res.stderr)
    assert.deepEqual(JSON.parse(res.stdout), { green: ['SC-001'], red: ['SC-002'], deferred: ['SC-003'] })
    const missing = cli('status', kiln, 'no-such-run')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /no results\.jsonl/)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI: a corrupted live law.json is a schema refusal where the live file is the reference (index/status, pre-lock verify) and TAMPER where the committed Law is canonical (verify/run)', () => {
  const { proj, kiln } = makeFixture()
  try {
    // pre-commit: the live file IS the reference — schema refusal, exit 1
    const preLockBad = { ...fixtureLaw(), checks: [fixtureLaw().checks[0], fixtureLaw().checks[0]] } // duplicate ids
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(preLockBad, null, 2) + '\n')
    const pre = cli('verify', proj, kiln)
    assert.equal(pre.status, 1)
    assert.match(pre.stderr, /violates the schema/)
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(fixtureLaw(), null, 2) + '\n')
    lockFixture(proj, kiln)
    const run = cli('run', proj, kiln, '--only', 'SC-001')
    const runId = run.stdout.match(/^RUN (\S+) /m)[1]
    // corrupt the live law: duplicate ids violate the §5.1 one-check-per-SC contract
    const law = readLawFile(kiln)
    law.checks[1].id = 'SC-001'
    writeFileSync(join(kiln, 'law.json'), JSON.stringify(law, null, 2) + '\n')
    // index and status read the live file → schema refusal, exit 1
    for (const args of [['index', proj, kiln], ['status', kiln, runId]]) {
      const res = cli(...args)
      assert.equal(res.status, 1, `${args[0]} must refuse an invalid law.json`)
      assert.match(res.stderr, /violates the schema/, args[0])
    }
    // verify and run anchor on the COMMITTED Law → a diverged live law.json is tamper, exit 2
    for (const args of [['verify', proj, kiln], ['run', proj, kiln]]) {
      const res = cli(...args)
      assert.equal(res.status, 2, `${args[0]} must treat a diverged live law.json as tamper, not a schema error`)
      assert.match(res.stdout, /^TAMPER: \.kiln\/law\.json$/m, args[0])
    }
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI usage: missing/unknown commands and relative projectPath exit non-zero', () => {
  assert.equal(cli().status, 1)
  assert.equal(cli('frobnicate', '/tmp/x', '/tmp/x/.kiln').status, 1)
  assert.equal(cli('index', 'relative/path', '/tmp/x/.kiln').status, 1)
  assert.equal(cli('status', '/tmp/x/.kiln').status, 1)
})

// ── 3. The GENERATED workflows/architecture.js Law phase, mock-driven ───────────────────────────
// Run exactly as the runtime evaluates it (the posture-args/gauge-workflow idiom): strip the
// `export ` off `export const meta`, wrap the body in an AsyncFunction over the workflow globals,
// drive `agent` with a label-keyed mock.
const ARCHITECTURE = fileURLToPath(new URL('../../plugins/kiln/workflows/architecture.js', import.meta.url))
const AsyncFunction = (async () => {}).constructor
const archBody = readFileSync(ARCHITECTURE, 'utf8').replace(/^export const meta\b/m, 'const meta')

async function runArch(args, respond) {
  const log = []
  const calls = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    calls.push({ label, prompt })
    return respond(label, prompt)
  }
  const stubs = {
    args,
    phase: () => {},
    log: (s) => log.push(String(s)),
    agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async () => [],
    budget: undefined,
    workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, archBody)
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, log, calls }
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
const lockResult = { reasoning: 'l', indexed: true, committed: true, error: '' }
const lawProofResult = { reasoning: 'v', law_json_exists: true, lock_commit_exists: true }

// lawRespond — drive the lite (trivial-scope) path with Athena PASS; `over` swaps any Law leg.
const lawRespond = (over = {}) => (label) => {
  if (label === 'thoth:research-check') return { reasoning: 'ls', missing: [] }
  if (label === 'numerobis:foundation') return foundationResult
  if (label === 'plato:synthesis' || label.startsWith('plato:revise')) return synthResult
  if (label.startsWith('athena:validate')) return { reasoning: 'v', verdict: 'athena' in over ? over.athena : 'PASS', failed_dimensions: [], fixes: [] }
  if (label === 'asimov:law') return 'asimov' in over ? over.asimov : asimovResult
  if (label === 'thoth:law-lock') return 'lock' in over ? over.lock : lockResult
  if (label === 'thoth:law-verify') return 'proof' in over ? over.proof : lawProofResult
  if (label === 'thoth:verify') return { reasoning: 'ok', missing: [] }
  return null
}
const labels = (calls) => calls.map((c) => c.label)

test('T1 Law phase: happy path — Asimov runs after Athena PASS, before handoff; lock + verify ⇒ law_locked:true', async () => {
  const { result, calls } = await runArch(lawArgs, lawRespond())
  assert.equal(result.law_locked, true)
  assert.equal(result.law_reason, null)
  assert.equal(result.law_file, '/tmp/nonexistent-kiln/.kiln/law.json')
  assert.equal(result.law_check_count, 2)
  const l = labels(calls)
  assert.ok(l.indexOf('asimov:law') > l.lastIndexOf('athena:validate:r0'), 'the Law compiles only after Athena PASS')
  // Lever 5 (lite path, the trivial-scope fixture): the dedicated numerobis:handoff agent is
  // skipped — Plato folds the handoff into its synthesis — and the Law sits before the existence
  // verifier (the stage's final convergence point).
  assert.ok(!l.includes('numerobis:handoff'), 'lite path: no separate handoff agent (folded into Plato\'s synthesis)')
  assert.ok(l.indexOf('asimov:law') < l.indexOf('thoth:verify'), 'the Law phase sits BEFORE the stage\'s existence verifier')
  const synthHandoff = calls.find((c) => c.label === 'plato:synthesis').prompt
  assert.match(synthHandoff, /architecture-handoff\.md/, 'lite path: Plato\'s synthesis brief folds in the handoff')
  assert.ok(l.indexOf('thoth:law-lock') < l.indexOf('thoth:law-verify'), 'lock before the existence verifier')
  // Asimov's brief: project-native checks, probes as inert templates, no browser code
  const asimovPrompt = calls.find((c) => c.label === 'asimov:law').prompt
  assert.match(asimovPrompt, /tests\/acceptance/)
  assert.match(asimovPrompt, /NO browser code/)
  assert.match(asimovPrompt, /"lock_commit": null/)
  // the lock brief is the EXACT T1/§5 sequence: kiln-law index FIRST, then the ONE lock commit
  const lockPrompt = calls.find((c) => c.label === 'thoth:law-lock').prompt
  assert.match(lockPrompt, /git add tests\/acceptance \.kiln\/law\.json && git commit -m "test\(law\): lock acceptance gates"/)
  assert.ok(lockPrompt.indexOf('kiln-law.mjs index') < lockPrompt.indexOf('git commit -m "test(law): lock acceptance gates"'), 'index-then-commit: the §5 sequence is index first, then the single lock commit')
  assert.match(lockPrompt, /\/opt\/kiln-plugin\/scripts\/kiln-law\.mjs index/)
  assert.doesNotMatch(lockPrompt, /index the lock/, 'no second commit — the lock is ONE commit')
})

test('T1 Law phase: Athena never PASSes ⇒ the Law does not compile — law_locked:false, Asimov not spawned', async () => {
  const { result, calls } = await runArch(lawArgs, lawRespond({ athena: 'FAIL' }))
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /Athena PASS/)
  assert.ok(!labels(calls).includes('asimov:law'), 'no Law from an unvalidated plan')
})

test('T1 Law phase: SC↔check coverage is arithmetic — gaps, orphans, and duplicates block the lock', async () => {
  const cases = [
    [{ ...asimovResult, plan_sc_ids: ['SC-001', 'SC-002', 'SC-003'] }, /SCs with no check: SC-003/],
    [{ ...asimovResult, checks: [...asimovResult.checks, { id: 'SC-009', milestone: 'M1', kind: 'shell' }] }, /checks with no plan SC: SC-009/],
    [{ ...asimovResult, checks: [asimovResult.checks[0], asimovResult.checks[0]] }, /duplicate check ids: SC-001/],
  ]
  for (const [asimov, reasonRe] of cases) {
    const { result, calls } = await runArch(lawArgs, lawRespond({ asimov }))
    assert.equal(result.law_locked, false)
    assert.match(result.law_reason, reasonRe)
    assert.ok(!labels(calls).includes('thoth:law-lock'), 'a coverage gap must never reach the lock step')
  }
})

test('T1 Law phase: every degraded leg fails CLOSED with a reason — null Asimov, absent pluginRoot/projectPath, failed lock, failed proof', async () => {
  const nullAsimov = await runArch(lawArgs, lawRespond({ asimov: null }))
  assert.equal(nullAsimov.result.law_locked, false)
  assert.match(nullAsimov.result.law_reason, /no check manifest/)

  const noRoot = await runArch({ ...lawArgs, pluginRoot: undefined }, lawRespond())
  assert.equal(noRoot.result.law_locked, false)
  assert.match(noRoot.result.law_reason, /pluginRoot absent/)
  assert.ok(!labels(noRoot.calls).includes('thoth:law-lock'))

  const noProject = await runArch({ ...lawArgs, projectPath: undefined }, lawRespond())
  assert.equal(noProject.result.law_locked, false)
  assert.match(noProject.result.law_reason, /projectPath absent/)
  assert.ok(!labels(noProject.calls).includes('asimov:law'))

  const lockFail = await runArch(lawArgs, lawRespond({ lock: { reasoning: 'l', indexed: false, committed: false, error: 'index: locked file(s) missing on disk' } }))
  assert.equal(lockFail.result.law_locked, false)
  assert.match(lockFail.result.law_reason, /lock sequence failed — index: locked file\(s\) missing/)
  assert.ok(!labels(lockFail.calls).includes('thoth:law-verify'), 'a failed lock never reaches the verifier')

  const commitFail = await runArch(lawArgs, lawRespond({ lock: { reasoning: 'l', indexed: true, committed: false, error: '' } }))
  assert.equal(commitFail.result.law_locked, false)
  assert.match(commitFail.result.law_reason, /lock sequence failed — indexed=true committed=false/)

  const proofFail = await runArch(lawArgs, lawRespond({ proof: { reasoning: 'v', law_json_exists: true, lock_commit_exists: false } }))
  assert.equal(proofFail.result.law_locked, false)
  assert.match(proofFail.result.law_reason, /lock verification failed — law\.json exists: true, lock commit exists: false/)
})

test('T1 Law phase: Athena gains the SC-to-Law dimension; Plato is told to number SCs', async () => {
  const { calls } = await runArch(lawArgs, lawRespond())
  const athenaPrompt = calls.find((c) => c.label === 'athena:validate:r0').prompt
  assert.match(athenaPrompt, /every SC has exactly one law\.json check entry/)
  const platoPrompt = calls.find((c) => c.label === 'plato:synthesis').prompt
  assert.match(platoPrompt, /globally unique SC id \(SC-001, SC-002/)
})
