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
// The audit tests capture the composed prompt to prove derived facts (spaced milestone
// labels among them) ride the prompt and never argv; unset elsewhere, a no-op.
if (process.env.FAKE_PROMPT_OUT) fs.writeFileSync(process.env.FAKE_PROMPT_OUT, prompt)
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

// ratify-recheck (W6-02): the cohort lineage the ratify verb previously lacked. A recheck
// reuses the prior review_id and constrains the reviewer to the prior finding cohort — the
// SAME allowedFindingIds + prior-changes_required discipline the build recheck enforces —
// while law_hash tracks the CURRENT (regenerated) artifact digest. The prior gate is written
// to disk and the fake codex echoes the recheck output, so the whole contract runs without
// a real bridge; the lineage and cohort guards halt before the spawn.
function ratifyFinding(id) {
  return { id, criterion: 'acceptance-testable', location: '.kiln/LAW.md:3', failure_mode: 'no observable pass condition', evidence: 'crit is vague', minimal_fix: 'state a checkable outcome' }
}
function priorRatifyGate(findings, { review_id = 'ratify-1', verdict = 'changes_required', law_hash = 'a'.repeat(64) } = {}) {
  return { review_id, law_hash, findings, blockers: verdict === 'blocked' ? ['x'] : [], verdict }
}
function ratifyRecheck({ artifact = 'the regenerated LAW\n', gate, prior, requestReviewId = 'ratify-1', rubric = RUBRIC, artifactPath = '.kiln/LAW.md' } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'kiln-ratify-recheck-'))
  const abs = join(repo, artifactPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, artifact)
  const req = { review_id: requestReviewId, reviewer_model: 'gpt-5.6-sol', artifact: artifactPath, rubric }
  const rf = join(repo, 'request.json')
  writeFileSync(rf, JSON.stringify(req))
  const priorFile = join(repo, 'prior-gate.json')
  writeFileSync(priorFile, JSON.stringify(prior))
  const env = { ...process.env }
  if (gate) {
    const fake = mkdtempSync(join(tmpdir(), 'kiln-fakecodex-'))
    writeFileSync(join(fake, 'codex'), FAKE_CODEX, { mode: 0o755 })
    env.PATH = `${fake}:${process.env.PATH}`
    env.FAKE_GATE = JSON.stringify(gate)
  }
  const r = spawnSync('node', [REVIEW, 'ratify-recheck', repo, rf, priorFile, join(repo, 'gate.json')], { encoding: 'utf8', env })
  return { repo, fact: (r.stdout || '').trim(), status: r.status, out: join(repo, 'gate.json') }
}

test('kiln-review: ratify-recheck passes a strict subset of the prior cohort — the reviewer reuses an allowed id (reject, exit 10)', () => {
  const artifact = 'the regenerated LAW\n'
  const prior = priorRatifyGate([ratifyFinding('f1'), ratifyFinding('f2')])
  const gate = { review_id: 'ratify-1', law_hash: digestOf(artifact), findings: [ratifyFinding('f1')], blockers: [], verdict: 'changes_required' }
  const r = ratifyRecheck({ artifact, prior, gate })
  assert.equal(r.fact, 'reject', 'a subset recheck publishes its changes_required verdict')
  assert.equal(r.status, 10)
  const published = JSON.parse(readFileSync(r.out, 'utf8'))
  assert.deepEqual(published.findings.map((f) => f.id), ['f1'], 'the published recheck reuses only the prior cohort id')
})

test('kiln-review: ratify-recheck passes when the reviewer clears every prior finding (accept, exit 0)', () => {
  const artifact = 'the fully repaired LAW\n'
  const prior = priorRatifyGate([ratifyFinding('f1'), ratifyFinding('f2')])
  const gate = { review_id: 'ratify-1', law_hash: digestOf(artifact), findings: [], blockers: [], verdict: 'accept' }
  const r = ratifyRecheck({ artifact, prior, gate })
  assert.equal(r.fact, 'accept', 'clearing every prior finding accepts')
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(readFileSync(r.out, 'utf8')).law_hash, digestOf(artifact), 'the accepted recheck seals the regenerated artifact digest')
})

test('kiln-review: ratify-recheck rejects a new or renamed finding id outside the prior cohort (transport_failure, exit 20)', () => {
  const artifact = 'the regenerated LAW\n'
  const prior = priorRatifyGate([ratifyFinding('f1'), ratifyFinding('f2')])
  const gate = { review_id: 'ratify-1', law_hash: digestOf(artifact), findings: [ratifyFinding('f3')], blockers: [], verdict: 'changes_required' }
  const r = ratifyRecheck({ artifact, prior, gate })
  assert.equal(r.fact, 'transport_failure', 'an out-of-cohort finding id is a transport failure')
  assert.equal(r.status, 20)
  assert.ok(!existsSync(r.out), 'a rejected recheck publishes no gate')
})

test('kiln-review: ratify-recheck requires the prior review_id — a request id unlinked from the prior review halts before codex (exit 20)', () => {
  const prior = priorRatifyGate([ratifyFinding('f1')], { review_id: 'ratify-1' })
  const r = ratifyRecheck({ prior, requestReviewId: 'ratify-2' })
  assert.equal(r.fact, 'transport_failure', 'a request review_id that differs from the prior review is rejected')
  assert.equal(r.status, 20)
})

test('kiln-review: ratify-recheck requires a prior changes_required verdict — a prior accept is rejected before codex (exit 20)', () => {
  const prior = priorRatifyGate([], { verdict: 'accept' })
  const r = ratifyRecheck({ prior })
  assert.equal(r.fact, 'transport_failure', 'only a prior changes_required gate can be rechecked')
  assert.equal(r.status, 20)
})

test('kiln-review: ratify-recheck rejects a recheck output that abandons the reused review_id (transport_failure, exit 20)', () => {
  const artifact = 'the regenerated LAW\n'
  const prior = priorRatifyGate([ratifyFinding('f1')])
  const gate = { review_id: 'a-fresh-id', law_hash: digestOf(artifact), findings: [ratifyFinding('f1')], blockers: [], verdict: 'changes_required' }
  const r = ratifyRecheck({ artifact, prior, gate })
  assert.equal(r.fact, 'transport_failure', 'a recheck output with a fresh review_id breaks the lineage and is rejected')
  assert.equal(r.status, 20)
})

// ── the audit family (W7-A1/A2/02) ──────────────────────────────────────────
// The audit verbs carry closed facts only on argv: the CLI reads .kiln/slices.json
// itself, derives the closing milestone block and the cumulative sealed prefix, binds
// law_hash to the sealed law/lock.hash, and requires the kernel-run check receipt
// exactly as review does. Milestone labels may contain spaces — they ride only inside
// the composed prompt (captured here via FAKE_PROMPT_OUT), never argv, never a log
// line. Verb-level rules layered on the shared validateShape: every blocker must equal
// a finding id, and a blocked verdict with empty findings never publishes — enforced on
// the initial audit, on every CURRENT recheck output, and on the recheck PRIOR, so an
// artifact invalid for the audit family never seeds a cohort. Every no-fake-codex case
// below halts BEFORE the spawn, so real codex is never launched.

const AUDIT_SLICES = [
  { id: 's1', surface: 'mixed', milestone: 'ground work' },
  { id: 's2', surface: 'ui', milestone: 'first light' },
  { id: 's3', surface: 'logic', milestone: 'first light' },
]

function auditRepo({ slices = AUDIT_SLICES, law = 'crit-m1 · milestone · behaviour\n', receipt = 'checks ok\n', lock } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'kiln-audit-'))
  const kiln = join(repo, '.kiln')
  mkdirSync(join(kiln, 'law'), { recursive: true })
  writeFileSync(join(kiln, 'slices.json'), JSON.stringify(slices))
  writeFileSync(join(kiln, 'LAW.md'), law)
  const digest = digestOf(law)
  if (lock !== null) writeFileSync(join(kiln, 'law', 'lock.hash'), `${lock ?? digest}\n`)
  if (receipt !== null) writeFileSync(join(kiln, 'check-receipt.txt'), receipt)
  return { repo, kiln, digest }
}

function fakeCodexEnv({ gate, brokenCodex, promptOut } = {}) {
  const env = { ...process.env }
  if (gate || brokenCodex) {
    const fake = mkdtempSync(join(tmpdir(), 'kiln-fakecodex-'))
    writeFileSync(join(fake, 'codex'), brokenCodex ? UNAVAILABLE_CODEX : FAKE_CODEX, { mode: 0o755 })
    env.PATH = `${fake}:${process.env.PATH}`
    if (gate) env.FAKE_GATE = JSON.stringify(gate)
  }
  if (promptOut) env.FAKE_PROMPT_OUT = promptOut
  return env
}

function runAudit(fixture, { seam = 's3', model = 'gpt-5.6-sol', effort = 'high', gate, brokenCodex, promptOut } = {}) {
  const out = join(fixture.repo, 'audit-gate.json')
  const env = fakeCodexEnv({ gate, brokenCodex, promptOut })
  const r = spawnSync('node', [REVIEW, 'audit', fixture.repo, fixture.kiln, seam, model, effort, out], { encoding: 'utf8', env })
  return { fact: (r.stdout || '').trim(), status: r.status, stderr: r.stderr || '', out }
}

function auditFinding(id) {
  return { id, criterion: 'crit-m1', location: 'src/app.js:12', failure_mode: 'goal unreachable', evidence: 'the milestone flow dead-ends', minimal_fix: 'wire the handoff' }
}

function capturedPacket(promptFile) {
  const prompt = readFileSync(promptFile, 'utf8')
  const anchor = 'Audit packet:\n'
  return { prompt, packet: JSON.parse(prompt.slice(prompt.indexOf(anchor) + anchor.length)) }
}

test('kiln-review: audit maps every verdict to the closed exits — accept 0, changes_required 10, blocked 11 — and publishes the schema gate', () => {
  const cases = [
    [{ findings: [], blockers: [], verdict: 'accept' }, 'accept', 0],
    [{ findings: [auditFinding('m1')], blockers: [], verdict: 'changes_required' }, 'reject', 10],
    [{ findings: [auditFinding('m1')], blockers: ['m1'], verdict: 'blocked' }, 'blocked', 11],
  ]
  for (const [shape, fact, code] of cases) {
    const fx = auditRepo()
    const r = runAudit(fx, { gate: { review_id: '__ECHO__', law_hash: fx.digest, ...shape } })
    assert.equal(r.fact, fact, `${shape.verdict} rides stdout as ${fact}`)
    assert.equal(r.status, code, `${shape.verdict} maps to exit ${code}`)
    const published = JSON.parse(readFileSync(r.out, 'utf8'))
    assert.equal(published.law_hash, fx.digest, 'the published audit binds the sealed lock.hash digest')
    assert.ok(/^[0-9a-f-]{36}$/.test(published.review_id), 'the CLI minted the review_id (randomUUID) and the reviewer echoed it')
  }
})

test('kiln-review: audit derives the closing block and cumulative prefix from slices.json — the spaced label rides the prompt only, never argv, never a log line', () => {
  const fx = auditRepo()
  const promptOut = join(fx.repo, 'captured-prompt.txt')
  const r = runAudit(fx, { gate: { review_id: '__ECHO__', law_hash: fx.digest, findings: [], blockers: [], verdict: 'accept' }, promptOut })
  assert.equal(r.status, 0)
  const { prompt, packet } = capturedPacket(promptOut)
  assert.equal(packet.milestone, 'first light', 'the spaced milestone label rides inside the prompt packet')
  assert.deepEqual(packet.closing_block, ['s2', 's3'], 'the closing block is the maximal contiguous same-label run ending at the seam')
  assert.deepEqual(packet.sealed_prefix, ['s1', 's2', 's3'], 'the cumulative prefix reaches back to the first slice')
  assert.equal(packet.seam_slice, 's3')
  assert.equal(packet.check_receipt, 'checks ok\n', 'the kernel-side receipt rides the packet verbatim')
  assert.ok(prompt.includes('Execute nothing'), 'the audit prompt keeps the receipt doctrine — the reviewer executes nothing')
  assert.ok(!r.stderr.includes('first light') && !r.fact.includes('first light'), 'the label never rides a log line')
  // A seam inside an earlier milestone closes ITS own block — the prefix stays cumulative.
  const fx2 = auditRepo()
  const promptOut2 = join(fx2.repo, 'captured-prompt.txt')
  const r2 = runAudit(fx2, { seam: 's1', gate: { review_id: '__ECHO__', law_hash: fx2.digest, findings: [], blockers: [], verdict: 'accept' }, promptOut: promptOut2 })
  assert.equal(r2.status, 0)
  const first = capturedPacket(promptOut2).packet
  assert.deepEqual(first.closing_block, ['s1'], 'a first-milestone seam closes a one-slice block')
  assert.deepEqual(first.sealed_prefix, ['s1'], 'the cumulative prefix at the first seam is that slice alone')
  assert.equal(first.milestone, 'ground work')
})

test('kiln-review: audit requires the kernel-run check receipt exactly as review does — a missing receipt halts before any spawn (exit 20)', () => {
  const r = runAudit(auditRepo({ receipt: null }))
  assert.equal(r.fact, 'transport_failure')
  assert.equal(r.status, 20)
  assert.ok(r.stderr.includes('check receipt unreadable'), 'the broken receipt contract is named')
  assert.ok(!existsSync(r.out), 'no gate is published')
})

test('kiln-review: the audit argv contract — bad effort halts by name, a wrong arg count is usage, an unknown seam or missing lock.hash halts before any spawn', () => {
  const badEffort = runAudit(auditRepo(), { effort: 'ultra' })
  assert.equal(badEffort.fact, 'reviewer_effort_invalid', 'ultra is rejected by name at the effort gate')
  assert.equal(badEffort.status, 20)
  const fx = auditRepo()
  const short = spawnSync('node', [REVIEW, 'audit', fx.repo, fx.kiln, 's3', 'gpt-5.6-sol', 'high'], { encoding: 'utf8' })
  assert.equal((short.stdout || '').trim(), 'transport_failure', 'a wrong arg count is the usage failure')
  assert.equal(short.status, 20)
  const unknownSeam = runAudit(auditRepo(), { seam: 'nope' })
  assert.equal(unknownSeam.fact, 'transport_failure', 'a seam slice absent from slices.json halts')
  assert.equal(unknownSeam.status, 20)
  const noLock = runAudit(auditRepo({ lock: null }))
  assert.equal(noLock.fact, 'transport_failure', 'a missing law/lock.hash halts — the audit requires the sealed digest')
  assert.equal(noLock.status, 20)
})

test('kiln-review: the audit verb-level shape rules — an out-of-findings blocker or a blocked verdict with empty findings is exit 20, never published', () => {
  const orphan = auditRepo()
  const r1 = runAudit(orphan, { gate: { review_id: '__ECHO__', law_hash: orphan.digest, findings: [auditFinding('m1')], blockers: ['m2'], verdict: 'blocked' } })
  assert.equal(r1.fact, 'transport_failure', 'a blocker that equals no finding id fails the audit shape')
  assert.equal(r1.status, 20)
  assert.ok(!existsSync(r1.out), 'the referential breach never publishes')
  const empty = auditRepo()
  const r2 = runAudit(empty, { gate: { review_id: '__ECHO__', law_hash: empty.digest, findings: [], blockers: ['b1'], verdict: 'blocked' } })
  assert.equal(r2.fact, 'transport_failure', 'a blocked verdict with empty findings is invalid for the audit verbs')
  assert.equal(r2.status, 20)
  assert.ok(!existsSync(r2.out), 'the empty-findings block never publishes')
})

test('kiln-review: audit binds law_hash to the sealed lock.hash — a valid-format wrong digest echoed by the reviewer is exit 20, never published', () => {
  const fx = auditRepo()
  const wrong = 'b'.repeat(64)
  assert.notEqual(wrong, fx.digest)
  const r = runAudit(fx, { gate: { review_id: '__ECHO__', law_hash: wrong, findings: [], blockers: [], verdict: 'accept' } })
  assert.equal(r.fact, 'transport_failure')
  assert.equal(r.status, 20)
  assert.ok(!existsSync(r.out))
})

test('kiln-review: a bridge-down reviewer over the audit path halts codex_unavailable (exit 21) and publishes no gate', () => {
  const r = runAudit(auditRepo(), { brokenCodex: true })
  assert.equal(r.fact, 'codex_unavailable')
  assert.equal(r.status, 21)
  assert.ok(!existsSync(r.out))
})

function priorAuditGate(findings, { verdict = 'changes_required', law_hash, review_id = 'audit-1', blockers } = {}) {
  return { review_id, law_hash, findings, blockers: blockers ?? (verdict === 'blocked' ? [findings[0].id] : []), verdict }
}

function runAuditRecheck(fixture, { seam = 's3', model = 'gpt-5.6-sol', effort = 'high', prior, delta = 'rewired the milestone handoff\n', gate, brokenCodex } = {}) {
  const priorFile = join(fixture.repo, 'prior-audit.json')
  writeFileSync(priorFile, JSON.stringify(prior))
  const deltaFile = join(fixture.repo, 'repair-delta.md')
  writeFileSync(deltaFile, delta)
  const out = join(fixture.repo, 'audit-recheck-gate.json')
  const env = fakeCodexEnv({ gate, brokenCodex })
  const r = spawnSync('node', [REVIEW, 'audit-recheck', fixture.repo, fixture.kiln, seam, model, effort, priorFile, deltaFile, out], { encoding: 'utf8', env })
  return { fact: (r.stdout || '').trim(), status: r.status, stderr: r.stderr || '', out }
}

test('kiln-review: audit-recheck accepts a prior changes_required AND a prior blocked — deliberately wider than the build recheck — but never a prior accept', () => {
  const changed = auditRepo()
  const priorChanged = priorAuditGate([auditFinding('m1'), auditFinding('m2')], { law_hash: changed.digest })
  const r1 = runAuditRecheck(changed, { prior: priorChanged, gate: { review_id: 'audit-1', law_hash: changed.digest, findings: [auditFinding('m1')], blockers: [], verdict: 'changes_required' } })
  assert.equal(r1.fact, 'reject', 'a prior changes_required rechecks — the cohort subset publishes')
  assert.equal(r1.status, 10)
  assert.deepEqual(JSON.parse(readFileSync(r1.out, 'utf8')).findings.map((f) => f.id), ['m1'], 'the published recheck reuses only prior cohort ids')
  const blocked = auditRepo()
  const priorBlocked = priorAuditGate([auditFinding('m1')], { verdict: 'blocked', law_hash: blocked.digest })
  const r2 = runAuditRecheck(blocked, { prior: priorBlocked, gate: { review_id: 'audit-1', law_hash: blocked.digest, findings: [], blockers: [], verdict: 'accept' } })
  assert.equal(r2.fact, 'accept', 'a prior blocked is recoverable at this gate — a cleared cohort accepts')
  assert.equal(r2.status, 0)
  const accepted = auditRepo()
  const priorAccept = { review_id: 'audit-1', law_hash: accepted.digest, findings: [], blockers: [], verdict: 'accept' }
  const r3 = runAuditRecheck(accepted, { prior: priorAccept })
  assert.equal(r3.fact, 'transport_failure', 'a prior accept has nothing to recheck — halts before any spawn')
  assert.equal(r3.status, 20)
})

test('kiln-review: audit-recheck pins the prior finding cohort — a new or renamed id is exit 20, never published', () => {
  const fx = auditRepo()
  const prior = priorAuditGate([auditFinding('m1'), auditFinding('m2')], { law_hash: fx.digest })
  const r = runAuditRecheck(fx, { prior, gate: { review_id: 'audit-1', law_hash: fx.digest, findings: [auditFinding('m3')], blockers: [], verdict: 'changes_required' } })
  assert.equal(r.fact, 'transport_failure', 'an out-of-cohort finding id is a transport failure')
  assert.equal(r.status, 20)
  assert.ok(!existsSync(r.out), 'a rejected recheck publishes no gate')
})

test('kiln-review: audit-recheck reuses the prior review_id and the sealed law binding — a fresh output id or a prior hash off lock.hash is exit 20', () => {
  const fx = auditRepo()
  const prior = priorAuditGate([auditFinding('m1')], { law_hash: fx.digest })
  const fresh = runAuditRecheck(fx, { prior, gate: { review_id: 'a-fresh-id', law_hash: fx.digest, findings: [auditFinding('m1')], blockers: [], verdict: 'changes_required' } })
  assert.equal(fresh.fact, 'transport_failure', 'an output that abandons the prior review_id breaks the lineage')
  assert.equal(fresh.status, 20)
  const off = auditRepo()
  const priorOff = priorAuditGate([auditFinding('m1')], { law_hash: 'c'.repeat(64) })
  const r2 = runAuditRecheck(off, { prior: priorOff })
  assert.equal(r2.fact, 'transport_failure', 'a prior audit not bound to the sealed lock.hash halts before any spawn')
  assert.equal(r2.status, 20)
})

test('kiln-review: audit-recheck mirrors the recheck delta contract — a blank repair delta halts before any spawn (exit 20)', () => {
  const fx = auditRepo()
  const prior = priorAuditGate([auditFinding('m1')], { law_hash: fx.digest })
  const r = runAuditRecheck(fx, { prior, delta: '   \n' })
  assert.equal(r.fact, 'transport_failure', 'an empty repair delta halts')
  assert.equal(r.status, 20)
})

test('kiln-review: the audit verb-level shape rules gate the CURRENT recheck output — an orphan blocker or a blocked verdict with empty findings is exit 20, never published', () => {
  // The orphan blocker here is COHORT-legal (m2 is a prior finding id), so only the
  // audit shape rule — blockers must equal CURRENT finding ids — can catch it.
  const orphan = auditRepo()
  const priorOrphan = priorAuditGate([auditFinding('m1'), auditFinding('m2')], { law_hash: orphan.digest })
  const r1 = runAuditRecheck(orphan, { prior: priorOrphan, gate: { review_id: 'audit-1', law_hash: orphan.digest, findings: [auditFinding('m1')], blockers: ['m2'], verdict: 'blocked' } })
  assert.equal(r1.fact, 'transport_failure', 'a recheck blocker that no current finding carries fails the audit shape')
  assert.equal(r1.status, 20)
  assert.ok(r1.stderr.includes('does not equal any finding id'), 'the referential rule names the orphan')
  assert.ok(!existsSync(r1.out), 'the referential breach never publishes')
  const empty = auditRepo()
  const priorEmpty = priorAuditGate([auditFinding('m1')], { law_hash: empty.digest })
  const r2 = runAuditRecheck(empty, { prior: priorEmpty, gate: { review_id: 'audit-1', law_hash: empty.digest, findings: [], blockers: ['m1'], verdict: 'blocked' } })
  assert.equal(r2.fact, 'transport_failure', 'a blocked recheck output with empty findings is invalid for the audit verbs')
  assert.equal(r2.status, 20)
  assert.ok(r2.stderr.includes('requires findings carrying its blocker ids'), 'the empty-findings block is named')
  assert.ok(!existsSync(r2.out), 'the empty-findings block never publishes')
})

test('kiln-review: a prior artifact invalid for the audit family establishes no recheck lineage — blocked with empty findings or an orphan blocker halts before any spawn (exit 20)', () => {
  // Both priors pass the shared validateShape (blocked only needs nonempty blockers
  // there), so this pins the audit verb-level rules running against the PRIOR too.
  const empty = auditRepo()
  const priorEmpty = { review_id: 'audit-1', law_hash: empty.digest, findings: [], blockers: ['b1'], verdict: 'blocked' }
  const r1 = runAuditRecheck(empty, { prior: priorEmpty })
  assert.equal(r1.fact, 'transport_failure', 'a blocked prior with empty findings carries no cohort worth rechecking')
  assert.equal(r1.status, 20)
  assert.ok(r1.stderr.includes('requires findings carrying its blocker ids'), 'the halt names the audit shape rule, before any spawn')
  assert.ok(!existsSync(r1.out), 'no gate is published')
  const orphan = auditRepo()
  const priorOrphan = { review_id: 'audit-1', law_hash: orphan.digest, findings: [auditFinding('m1')], blockers: ['zz'], verdict: 'blocked' }
  const r2 = runAuditRecheck(orphan, { prior: priorOrphan })
  assert.equal(r2.fact, 'transport_failure', 'a prior blocker that equals no prior finding id is not a valid audit artifact')
  assert.equal(r2.status, 20)
  assert.ok(r2.stderr.includes('does not equal any finding id'), 'the halt names the orphan, before any spawn')
  assert.ok(!existsSync(r2.out), 'no gate is published')
})

test('kiln-review: audit reads the kernel slice contract — a legacy bare string entry and a slash id derive their seam facts (no stricter shape than parseSliceEntry)', () => {
  const fx = auditRepo({ slices: [{ id: 's1', surface: 'mixed', milestone: 'ground work' }, 'feature/ui'] })
  const promptOut = join(fx.repo, 'captured-prompt.txt')
  const r = runAudit(fx, { seam: 'feature/ui', gate: { review_id: '__ECHO__', law_hash: fx.digest, findings: [], blockers: [], verdict: 'accept' }, promptOut })
  assert.equal(r.status, 0, 'a slices.json mixing object and legacy bare string entries audits')
  const { packet } = capturedPacket(promptOut)
  assert.equal(packet.seam_slice, 'feature/ui', 'the slash id the kernel accepts is the seam')
  assert.equal(packet.milestone, '', 'a legacy bare string carries an absent label')
  assert.deepEqual(packet.closing_block, ['feature/ui'], 'the unlabeled entry closes its own block against the labeled one')
  assert.deepEqual(packet.sealed_prefix, ['s1', 'feature/ui'], 'the cumulative prefix spans both entry forms')
})

test('kiln-review: append-audit is the only audits.log writer — exact line format, append-only, charset-gated seam id, usage on a wrong arg count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-audits-'))
  const log = join(dir, 'audits.log')
  const first = spawnSync('node', [REVIEW, 'append-audit', dir, 's3'], { encoding: 'utf8' })
  assert.equal(first.status, 0, 'a valid append exits 0')
  assert.equal(readFileSync(log, 'utf8'), 's3 accept\n', 'the log is created with exactly `<seamSliceId> accept`')
  const second = spawnSync('node', [REVIEW, 'append-audit', dir, 'phase-2.final'], { encoding: 'utf8' })
  assert.equal(second.status, 0, 'dot, digit, underscore and hyphen ids are within the safe charset')
  assert.equal(readFileSync(log, 'utf8'), 's3 accept\nphase-2.final accept\n', 'the append is append-only — the prior line survives')
  // The charset is the kernel slice-id contract (parseSliceEntry SLICE_ID) verbatim:
  // slash ids the kernel builds and seals must publish here too.
  const slash = spawnSync('node', [REVIEW, 'append-audit', dir, 'feature/ui'], { encoding: 'utf8' })
  assert.equal(slash.status, 0, 'a path-like slash id is inside the shared charset')
  assert.equal(readFileSync(log, 'utf8'), 's3 accept\nphase-2.final accept\nfeature/ui accept\n', 'the slash id lands its exact line')
  // The seam id becomes the grep anchor `^<id> ` — whitespace and control bytes are rejected.
  for (const bad of ['', 'has space', 'line\nbreak', 'tab\tchar']) {
    const r = spawnSync('node', [REVIEW, 'append-audit', dir, bad], { encoding: 'utf8' })
    assert.notEqual(r.status, 0, `${JSON.stringify(bad)} is rejected`)
  }
  assert.equal(readFileSync(log, 'utf8'), 's3 accept\nphase-2.final accept\nfeature/ui accept\n', 'no rejected call ever appended')
  const usage = spawnSync('node', [REVIEW, 'append-audit', dir], { encoding: 'utf8' })
  assert.equal(usage.status, 20, 'a wrong arg count is the usage failure')
})
