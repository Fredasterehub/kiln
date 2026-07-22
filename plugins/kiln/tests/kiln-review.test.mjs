import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// kiln-review is an argv-driven CLI, not a module. These unit tests exercise the
// reviewer_effort request validator by invoking the script with a pointed-at repo
// that does not exist, so the run always halts BEFORE any codex spawn: a bad
// effort halts at the effort gate with the stable fact `reviewer_effort_invalid`;
// a valid or absent effort passes that gate and only then fails on the missing
// repository (`transport_failure`). No codex process is ever launched. Live codex
// acceptance of low|high|xhigh is a separate receipt (V4), not a unit test.
const REVIEW = fileURLToPath(new URL('../scripts/kiln-review', import.meta.url))
const NO_REPO = '/no/such/repo/kiln-review-unit-xyz'
const HASH = 'a'.repeat(64)

function runReview(effort) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-review-'))
  const req = { reviewer_model: 'gpt-5.6-sol', law_hash: HASH, criteria: 'x', paths: [], failures: [], commands: [] }
  if (effort !== undefined) req.reviewer_effort = effort
  const rf = join(dir, 'request.json')
  writeFileSync(rf, JSON.stringify(req))
  const r = spawnSync('node', [REVIEW, 'review', NO_REPO, rf, join(dir, 'gate.json')], { encoding: 'utf8' })
  return { fact: (r.stdout || '').trim(), status: r.status }
}

test('kiln-review: ultra effort is rejected before codex with reviewer_effort_invalid (exit 20)', () => {
  const r = runReview('ultra')
  assert.equal(r.fact, 'reviewer_effort_invalid')
  assert.equal(r.status, 20)
})

test('kiln-review: every unknown effort value is rejected the same way', () => {
  for (const bad of ['turbo', '', 'HIGH', 'high ', 'lowest', '1']) {
    const r = runReview(bad)
    assert.equal(r.fact, 'reviewer_effort_invalid', `${JSON.stringify(bad)} must be rejected by name`)
    assert.equal(r.status, 20)
  }
})

test('kiln-review: each valid effort passes the effort gate — the request proceeds past validation', () => {
  for (const ok of ['low', 'medium', 'high', 'xhigh']) {
    const r = runReview(ok)
    assert.notEqual(r.fact, 'reviewer_effort_invalid', `${ok} must not be rejected by the effort validator`)
    assert.equal(r.fact, 'transport_failure', `${ok} proceeds to repository resolution, then halts on the missing repo`)
  }
})

test('kiln-review: an absent effort defaults to high and is accepted (not rejected)', () => {
  const r = runReview(undefined)
  assert.notEqual(r.fact, 'reviewer_effort_invalid')
  assert.equal(r.fact, 'transport_failure', 'absent effort defaults to high, then halts on the missing repo')
})

test('kiln-review: the reviewer never executes — the instructions attach the kernel-side receipt instead', () => {
  const src = readFileSync(REVIEW, 'utf8')
  assert.ok(src.includes('Execute nothing'), 'the instructions forbid execution outright')
  assert.ok(src.includes('check_receipt as the only execution evidence'), 'the receipt is the only execution evidence')
  assert.ok(!src.includes('Run the supplied commands'), 'the old execute-the-commands instruction is gone')
  assert.ok(src.includes(`'.kiln', 'check-receipt.txt'`), 'the transport reads the receipt from the reviewed repo')
  assert.ok(src.includes('packet.check_receipt'), 'the receipt rides the evidence packet verbatim')
})

test('kiln-review: append-seal writes a valid seal line, is append-only, and rejects a bad label or empty slice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-seal-'))
  const seals = join(dir, 'seals.log')
  // A valid dual seal creates the log and lands exactly "<slice> <label>\n".
  const first = spawnSync('node', [REVIEW, 'append-seal', dir, 's1', 'dual'], { encoding: 'utf8' })
  assert.equal(first.status, 0, 'a valid dual append exits 0')
  assert.equal(readFileSync(seals, 'utf8'), 's1 dual\n', 'the log is created with the exact line')
  // A second valid append is append-only — the prior line survives.
  const second = spawnSync('node', [REVIEW, 'append-seal', dir, 's2', 'single-family'], { encoding: 'utf8' })
  assert.equal(second.status, 0, 'a valid single-family append exits 0')
  assert.equal(readFileSync(seals, 'utf8'), 's1 dual\ns2 single-family\n', 'the append is append-only')
  // A bad label is rejected non-zero and appends nothing.
  const badLabel = spawnSync('node', [REVIEW, 'append-seal', dir, 's3', 'triple'], { encoding: 'utf8' })
  assert.notEqual(badLabel.status, 0, 'a label outside {dual, single-family} is rejected')
  // An empty slice id is rejected non-zero and appends nothing.
  const emptySlice = spawnSync('node', [REVIEW, 'append-seal', dir, '', 'dual'], { encoding: 'utf8' })
  assert.notEqual(emptySlice.status, 0, 'an empty slice id is rejected')
  assert.equal(readFileSync(seals, 'utf8'), 's1 dual\ns2 single-family\n', 'no rejected call ever appended')
})

test('kiln-review: append-seal resolves .kiln/seals.log against cwd when given the relative kilnDir the kernel passes', () => {
  // The kernel runs the seal leg with cwd = projectDir and passes the cwd-relative
  // `.kiln` (never an unquoted absolute projectDir, which a whitespace path would
  // split into extra args). The CLI must resolve `.kiln/seals.log` against cwd.
  const proj = mkdtempSync(join(tmpdir(), 'kiln-proj dir-')) // a space in the path, on purpose
  mkdirSync(join(proj, '.kiln'), { recursive: true })
  const r = spawnSync('node', [REVIEW, 'append-seal', '.kiln', 's1', 'dual'], { cwd: proj, encoding: 'utf8' })
  assert.equal(r.status, 0, 'a relative .kiln resolves against the process cwd, even when projectDir has a space')
  assert.equal(readFileSync(join(proj, '.kiln', 'seals.log'), 'utf8'), 's1 dual\n', 'the seal lands at projectDir/.kiln/seals.log')
})

test('kiln-review: seal-law persists the LAW digest to law/lock.hash byte-for-byte like sha256sum | cut (64-hex + one trailing newline), exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-seallaw-'))
  const law = 'crit-1 · slice-a · behaviour · cmd · outcome\n'
  writeFileSync(join(dir, 'LAW.md'), law)
  const digest = createHash('sha256').update(Buffer.from(law)).digest('hex')
  const r = spawnSync('node', [REVIEW, 'seal-law', dir], { encoding: 'utf8' })
  assert.equal(r.status, 0, 'a readable LAW.md seals with exit 0')
  const written = readFileSync(join(dir, 'law', 'lock.hash'), 'utf8')
  assert.equal(written, `${digest}\n`, 'lock.hash is the sha256 digest plus one trailing newline — identical to the shell pipeline')
  assert.ok(/^[0-9a-f]{64}\n$/.test(written), 'the persisted lock is exactly 64 lowercase hex chars then a newline')
})

test('kiln-review: seal-law halts transport_failure (exit 20) when LAW.md is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-seallaw-'))
  const r = spawnSync('node', [REVIEW, 'seal-law', dir], { encoding: 'utf8' })
  assert.equal(r.status, 20, 'a missing LAW.md is a transport failure')
  assert.equal((r.stdout || '').trim(), 'transport_failure', 'the honest fact rides stdout')
})

test('kiln-review: seal-law is content-addressed — different LAW bytes reseal a different digest into law/lock.hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-seallaw-'))
  writeFileSync(join(dir, 'LAW.md'), 'first law\n')
  assert.equal(spawnSync('node', [REVIEW, 'seal-law', dir], { encoding: 'utf8' }).status, 0)
  const first = readFileSync(join(dir, 'law', 'lock.hash'), 'utf8')
  writeFileSync(join(dir, 'LAW.md'), 'second, different law\n')
  assert.equal(spawnSync('node', [REVIEW, 'seal-law', dir], { encoding: 'utf8' }).status, 0)
  const second = readFileSync(join(dir, 'law', 'lock.hash'), 'utf8')
  assert.notEqual(first, second, 'a changed LAW reseals a different digest')
  assert.equal(second, `${createHash('sha256').update(Buffer.from('second, different law\n')).digest('hex')}\n`,
    'the reseal overwrites law/lock.hash with the new digest, same byte format')
})

test('kiln-review: the ui reviewer rules on correctness only — creative direction and taste are out of remit', () => {
  // Since the rework routes only ui slices to the codex gate (logic and mixed take
  // the fresh claude gate in the kernel), this reviewer prompt is exclusively the
  // GPT reviewer of an Opus-built ui slice. Opus owns the creative direction and
  // taste (v3 duo-pool ui pool — la-peintresse builds, the-curator reviews static
  // correctness); GPT rules on correctness against the locked criteria and has no
  // say in aesthetics.
  const src = readFileSync(REVIEW, 'utf8')
  assert.ok(src.includes('Creative direction, visual taste, and aesthetic choices belong to the builder'),
    'the carve-out names creative direction, visual taste, and aesthetic choices as the builder\'s')
  assert.ok(src.includes('never raise them as a finding and never let them color a verdict'),
    'taste is never a finding and never colors the verdict')
  assert.ok(src.includes('you rule on correctness against the locked criteria alone'),
    'the reviewer rules on correctness against the locked criteria alone')
})
