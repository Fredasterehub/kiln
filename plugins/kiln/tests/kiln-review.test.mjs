import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

// ratify reviews a READABLE ARTIFACT against a RUBRIC — the reusable path whose first
// consumer is the not-yet-sealed LAW. It reuses review-schema.json and validateShape,
// but never the slice's locked-LAW equality: there is no locked LAW yet. Instead it
// asserts the reviewer's echoed law_hash against the artifact's OWN candidate digest.
// A fake `codex` on PATH writes a canned gate to the CLI's -o file, so the whole path
// — output validation, candidate-digest equality, verdict→exit mapping — runs without
// ever launching real codex. Bad-request and missing-input cases halt before the spawn.
const RUBRIC = fileURLToPath(new URL('../data/law-rubric.json', import.meta.url))
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const prompt = fs.readFileSync(0, 'utf8')
const gate = JSON.parse(process.env.FAKE_GATE)
// The CLI mints a fresh review_id for the slice path; a gate can echo it back with
// the __ECHO__ sentinel so the review_id check passes and later checks are reachable.
if (gate.review_id === '__ECHO__') gate.review_id = (prompt.match(/"review_id":\\s*"([^"]+)"/) || [])[1]
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(gate))
`

// A fake codex that cannot complete the review — the reviewer bridge is down. It exits 127
// (the not-executable code) and writes no gate, so runGate classifies it codex_unavailable.
const UNAVAILABLE_CODEX = `#!/usr/bin/env node
process.exit(127)
`

// artifactPath places the ratified artifact anywhere under the repo (default the LAW), so the
// same helper covers both the LAW and a .kiln/docs/feasibility.md candidate. brokenCodex swaps
// the canned reviewer for one that cannot run, standing in for a downed bridge.
function ratify({ artifact = 'crit-1 · slice-a · behaviour · cmd · outcome\n', gate, effort, drop, rubric = RUBRIC, artifactPath = '.kiln/LAW.md', brokenCodex } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'kiln-ratify-'))
  const abs = join(repo, artifactPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, artifact)
  const req = { review_id: 'ratify-1', reviewer_model: 'gpt-5.6-sol', artifact: artifactPath, rubric }
  if (effort !== undefined) req.reviewer_effort = effort
  if (drop) delete req[drop]
  const rf = join(repo, 'request.json')
  writeFileSync(rf, JSON.stringify(req))
  const env = { ...process.env }
  if (gate || brokenCodex) {
    const fake = mkdtempSync(join(tmpdir(), 'kiln-fakecodex-'))
    writeFileSync(join(fake, 'codex'), brokenCodex ? UNAVAILABLE_CODEX : FAKE_CODEX, { mode: 0o755 })
    env.PATH = `${fake}:${process.env.PATH}`
    if (gate) env.FAKE_GATE = JSON.stringify(gate)
  }
  const r = spawnSync('node', [REVIEW, 'ratify', repo, rf, join(repo, 'gate.json')], { encoding: 'utf8', env })
  return { repo, fact: (r.stdout || '').trim(), status: r.status, out: join(repo, 'gate.json') }
}

function digestOf(artifact) {
  return createHash('sha256').update(Buffer.from(artifact)).digest('hex')
}

function ratifyGate(verdict, law_hash) {
  if (verdict === 'accept') return { review_id: 'ratify-1', law_hash, findings: [], blockers: [], verdict }
  if (verdict === 'changes_required') {
    const finding = { id: 'f1', criterion: 'acceptance-testable', location: '.kiln/LAW.md:3', failure_mode: 'no observable pass condition', evidence: 'crit is vague', minimal_fix: 'state a checkable outcome' }
    return { review_id: 'ratify-1', law_hash, findings: [finding], blockers: [], verdict }
  }
  return { review_id: 'ratify-1', law_hash, findings: [], blockers: ['artifact unreadable by the reviewer'], verdict }
}

test('kiln-review: the shipped law-rubric.json parses and every criterion carries id, requirement, pass and fail anchors', () => {
  const rubric = JSON.parse(readFileSync(RUBRIC, 'utf8'))
  assert.ok(Array.isArray(rubric.criteria) && rubric.criteria.length >= 4, 'the rubric grades against several criteria')
  for (const c of rubric.criteria) {
    for (const key of ['id', 'requirement', 'pass', 'fail']) {
      assert.equal(typeof c[key], 'string', `criterion ${c.id} carries a nonempty ${key}`)
      assert.ok(c[key].trim() !== '', `criterion ${c.id} ${key} is not blank`)
    }
  }
})

test('kiln-review: a well-formed ratify accept seals with the artifact candidate digest and needs no locked LAW (exit 0)', () => {
  const artifact = 'a testable, coherent, self-consistent LAW\n'
  const r = ratify({ artifact, gate: ratifyGate('accept', digestOf(artifact)) })
  assert.equal(r.fact, 'accept', 'a matching-digest accept rides stdout as accept')
  assert.equal(r.status, 0, 'accept maps to exit 0')
  // No lock.hash was ever written or consulted: ratify grades the artifact itself.
  assert.ok(!existsSync(join(r.repo, '.kiln', 'law', 'lock.hash')), 'ratify requires no already-locked LAW')
  const gate = JSON.parse(readFileSync(r.out, 'utf8'))
  assert.equal(gate.law_hash, digestOf(artifact), 'the published gate echoes the candidate digest')
})

test('kiln-review: ratify maps every verdict to the slice exit codes — accept 0, changes_required 10, blocked 11', () => {
  const artifact = 'the LAW under ratification\n'
  const digest = digestOf(artifact)
  const cases = [['accept', 'accept', 0], ['changes_required', 'reject', 10], ['blocked', 'blocked', 11]]
  for (const [verdict, fact, code] of cases) {
    const r = ratify({ artifact, gate: ratifyGate(verdict, digest) })
    assert.equal(r.fact, fact, `${verdict} rides stdout as ${fact}`)
    assert.equal(r.status, code, `${verdict} maps to exit ${code}`)
  }
})

test('kiln-review: the candidate digest is sha256 of the artifact bytes — a mismatched echoed law_hash is rejected transport_failure (exit 20)', () => {
  const artifact = 'bytes whose sha256 is the only accepted law_hash\n'
  // The reviewer echoes a valid-shaped but WRONG digest; only sha256(artifact) is accepted.
  const wrong = 'b'.repeat(64)
  assert.notEqual(wrong, digestOf(artifact))
  const r = ratify({ artifact, gate: ratifyGate('accept', wrong) })
  assert.equal(r.fact, 'transport_failure', 'a law_hash that is not the candidate digest is a transport failure')
  assert.equal(r.status, 20)
  assert.ok(!existsSync(join(r.repo, 'gate.json')), 'a rejected gate is never published')
})

test('kiln-review: the ratify candidate digest is byte-identical to what seal-law would lock for the same artifact', () => {
  const artifact = 'crit-1 · slice-a · behaviour · cmd · outcome\n'
  const sealDir = mkdtempSync(join(tmpdir(), 'kiln-seallaw-'))
  writeFileSync(join(sealDir, 'LAW.md'), artifact)
  assert.equal(spawnSync('node', [REVIEW, 'seal-law', sealDir], { encoding: 'utf8' }).status, 0)
  const locked = readFileSync(join(sealDir, 'law', 'lock.hash'), 'utf8').trim()
  // ratify accepts iff the reviewer echoes the SAME digest seal-law persisted.
  const accepted = ratify({ artifact, gate: ratifyGate('accept', locked) })
  assert.equal(accepted.status, 0, 'ratify accepts the digest seal-law would lock')
  const flipped = ratify({ artifact, gate: ratifyGate('accept', 'c'.repeat(64)) })
  assert.equal(flipped.status, 20, 'ratify rejects any other digest')
})

test('kiln-review: a ratify request with a bad reviewer_effort is rejected before codex with reviewer_effort_invalid (exit 20)', () => {
  const r = ratify({ effort: 'ultra' })
  assert.equal(r.fact, 'reviewer_effort_invalid')
  assert.equal(r.status, 20)
})

test('kiln-review: a ratify request missing artifact or rubric halts transport_failure before codex (exit 20)', () => {
  for (const field of ['artifact', 'rubric', 'review_id', 'reviewer_model']) {
    const r = ratify({ drop: field })
    assert.equal(r.fact, 'transport_failure', `a request missing ${field} is a transport failure`)
    assert.equal(r.status, 20)
  }
})

test('kiln-review: ratify halts transport_failure when the named artifact file does not exist', () => {
  const repo = mkdtempSync(join(tmpdir(), 'kiln-ratify-'))
  const req = { review_id: 'ratify-1', reviewer_model: 'gpt-5.6-sol', artifact: '.kiln/LAW.md', rubric: RUBRIC }
  const rf = join(repo, 'request.json')
  writeFileSync(rf, JSON.stringify(req))
  const r = spawnSync('node', [REVIEW, 'ratify', repo, rf, join(repo, 'gate.json')], { encoding: 'utf8' })
  assert.equal((r.stdout || '').trim(), 'transport_failure', 'a missing artifact is an honest transport failure')
  assert.equal(r.status, 20)
})

test('kiln-review: the slice path enforces locked-LAW equality at its baseline precedence — a wrong law_hash beats malformed findings', () => {
  // Regression guard for the ratify refactor: sharing the validator with ratify must
  // NOT reorder the slice checks. A gate that echoes the issued review_id but a
  // valid-format WRONG law_hash AND malformed findings must report the law_hash
  // mismatch first — exactly as the pre-ratify baseline did — never the findings shape.
  const repo = mkdtempSync(join(tmpdir(), 'kiln-review-order-'))
  mkdirSync(join(repo, '.kiln'), { recursive: true })
  writeFileSync(join(repo, '.kiln', 'check-receipt.txt'), 'checks ok\n')
  const req = { reviewer_model: 'gpt-5.6-sol', law_hash: HASH, criteria: 'x', paths: [], failures: [], commands: [] }
  const rf = join(repo, 'request.json')
  writeFileSync(rf, JSON.stringify(req))
  const gate = { review_id: '__ECHO__', law_hash: 'b'.repeat(64), findings: 42, blockers: [], verdict: 'accept' }
  const fake = mkdtempSync(join(tmpdir(), 'kiln-fakecodex-'))
  writeFileSync(join(fake, 'codex'), FAKE_CODEX, { mode: 0o755 })
  const env = { ...process.env, PATH: `${fake}:${process.env.PATH}`, FAKE_GATE: JSON.stringify(gate) }
  const r = spawnSync('node', [REVIEW, 'review', repo, rf, join(repo, 'gate.json')], { encoding: 'utf8', env })
  assert.equal((r.stdout || '').trim(), 'transport_failure')
  assert.equal(r.status, 20)
  assert.ok((r.stderr || '').includes('law_hash does not match the locked LAW'),
    'the locked-LAW equality is reported before any findings-shape complaint')
  assert.ok(!(r.stderr || '').includes('findings and blockers must be arrays'),
    'the equality check short-circuits — the findings-shape check never runs')
})

// Feasibility ratify coverage — the same generic verb, a different artifact and rubric. This
// proves ratify is artifact-agnostic: it grades a .kiln/docs/feasibility.md candidate against
// data/feasibility-rubric.json exactly as it grades the LAW against law-rubric.json. The
// research-sweep workflow (S2) reuses this verb unchanged; the fake codex stands in for the
// reviewer here, so no real bridge is crossed.
const FEASIBILITY_RUBRIC = fileURLToPath(new URL('../data/feasibility-rubric.json', import.meta.url))
const FEASIBILITY_ARTIFACT = `# Feasibility

## external APIs
Assumption: the vendor ships a REST endpoint for batch export.
Evidence: confirmed in their published v2 API reference.
Reversibility: swapping vendors is a config-only change — low cost.
`

function feasibilityRatify(overrides = {}) {
  return ratify({ artifact: FEASIBILITY_ARTIFACT, rubric: FEASIBILITY_RUBRIC, artifactPath: '.kiln/docs/feasibility.md', ...overrides })
}

function feasibilityGate(verdict, law_hash) {
  if (verdict === 'accept') return { review_id: 'ratify-1', law_hash, findings: [], blockers: [], verdict }
  const finding = { id: 'f1', criterion: 'area-coverage', location: '.kiln/docs/feasibility.md:1', failure_mode: 'five canonical areas omitted with no not-applicable marker', evidence: 'only external APIs is addressed; platform, licensing, migrations, integrations and performance/security are neither investigated nor marked n/a', minimal_fix: 'address each remaining canonical area or mark it not-applicable with a reason' }
  return { review_id: 'ratify-1', law_hash, findings: [finding], blockers: [], verdict }
}

test('kiln-review: the shipped feasibility-rubric.json parses and every criterion carries id, requirement, pass and fail anchors', () => {
  const rubric = JSON.parse(readFileSync(FEASIBILITY_RUBRIC, 'utf8'))
  assert.ok(Array.isArray(rubric.criteria) && rubric.criteria.length >= 4, 'the rubric grades against several criteria')
  for (const c of rubric.criteria) {
    for (const key of ['id', 'requirement', 'pass', 'fail']) {
      assert.equal(typeof c[key], 'string', `criterion ${c.id} carries a ${key}`)
      assert.ok(c[key].trim() !== '', `criterion ${c.id} ${key} is not blank`)
    }
  }
})

test('kiln-review: the generic ratify verb accepts a feasibility artifact against feasibility-rubric.json (exit 0)', () => {
  const r = feasibilityRatify({ gate: feasibilityGate('accept', digestOf(FEASIBILITY_ARTIFACT)) })
  assert.equal(r.fact, 'accept', 'a matching-digest accept over the feasibility rubric rides stdout as accept')
  assert.equal(r.status, 0, 'accept maps to exit 0')
  const gate = JSON.parse(readFileSync(r.out, 'utf8'))
  assert.equal(gate.law_hash, digestOf(FEASIBILITY_ARTIFACT), 'the published gate echoes the feasibility candidate digest')
})

test('kiln-review: ratify returns changes_required with findings for a deficient feasibility artifact (reject, exit 10)', () => {
  const r = feasibilityRatify({ gate: feasibilityGate('changes_required', digestOf(FEASIBILITY_ARTIFACT)) })
  assert.equal(r.fact, 'reject', 'a changes_required verdict over the feasibility rubric rides stdout as reject')
  assert.equal(r.status, 10, 'changes_required maps to exit 10')
  const gate = JSON.parse(readFileSync(r.out, 'utf8'))
  assert.equal(gate.findings.length, 1, 'the published gate carries the reviewer finding')
  assert.equal(gate.findings[0].criterion, 'area-coverage', 'the finding names the failed feasibility criterion')
})

test('kiln-review: a bridge-down reviewer over the feasibility ratify path halts codex_unavailable (exit 21) and publishes no gate', () => {
  const r = feasibilityRatify({ brokenCodex: true })
  assert.equal(r.fact, 'codex_unavailable', 'an unreachable reviewer is the honest codex_unavailable fact')
  assert.equal(r.status, 21, 'codex_unavailable maps to exit 21')
  assert.ok(!existsSync(r.out), 'a bridge-down run publishes no gate')
})
