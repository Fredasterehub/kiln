// law-greenfield.test.mjs — P3.5 T2 acceptance: the greenfield lock sequence OWNS its git
// baseline (dogfood finding 2: Run A's lock failed honestly on a bare greenfield dir because
// architecture runs before build's rakim git-init; the conductor recovered manually — that
// recovery is now the contract). Two floors:
//   1. scripts/kiln-law.mjs on fixtures — `index` refuses a projectPath with no git HEAD with a
//      NAMED reason (never the old misleading "tamper gate: git log failed" surface); the
//      greenfield drill executes the brief's EXACT pre-flight command (disk probe ⇒ init ⇒ local
//      identity only-where-unset ⇒ `git add -A` baseline commit) on a bare dir under a scrubbed
//      git identity, then the UNCHANGED §5 sequence on top — baseline + lock commits both land,
//      lock_commit anchors on the baseline, `kiln-law verify` exits clean, the locked runner
//      works; the brownfield drill proves an existing history gets NO init, NO baseline, and the
//      lock commit lands on top of it.
//   2. The GENERATED workflows/architecture.js lock leg, mock-driven — the thoth:law-lock brief
//      carries the pre-flight VERBATIM (the same command string floor 1 executes, so the drill
//      and the brief cannot drift apart), placed before the pre_satisfied edit and the index
//      step; the branch is decided by the disk probe, never by the mode flag (greenfield vs
//      brownfield args produce byte-identical briefs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-law.mjs', import.meta.url))
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })

// The brief's pre-flight, VERBATIM: one self-contained command (the same idiom as the §5
// lock-commit step — no cwd carry-over between agent Bash calls), with projectPath DOUBLE-QUOTED
// (review fix cycle: the unquoted interpolation broke mechanically on a path containing
// whitespace — `cd: too many arguments`). Floor 2 asserts the generated workflow quotes EXACTLY
// these strings, so the drills below execute what the brief instructs — the test and the prompt
// cannot drift apart.
const preFlightCmd = (proj) =>
  `cd "${proj}" && git init -q && (git config user.name >/dev/null || git config user.name "Kiln") && ` +
  `(git config user.email >/dev/null || git config user.email "kiln@localhost") && ` +
  `git add -A && git commit -m "chore: kiln build baseline"`
const lockCommitCmd = (proj) =>
  `cd ${proj} && git add tests/acceptance .kiln/law.json && git commit -m "test(law): lock acceptance gates"`

// scrubbedEnv — the bare-greenfield host reality: NO git identity resolves anywhere, so the
// brief's `git config user.name || git config user.name "Kiln"` arm MUST fire for the baseline
// commit to land at all.
function scrubbedEnv(home) {
  const env = {
    ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.xdg'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  }
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete env[k]
  return env
}

const fixtureLaw = () => ({
  schema: 1, lock_commit: null,
  checks: [
    { id: 'SC-001', milestone: 'M1', kind: 'shell', cmd: 'grep -q hello app.txt', files: ['tests/acceptance/sc-001.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
    { id: 'SC-002', milestone: 'M1', kind: 'shell', cmd: 'bash tests/acceptance/sc-002.sh', files: ['tests/acceptance/sc-002.sh'], sha256: {}, expected: 'exit0', timeout_s: 10 },
  ],
})

// makeBareFixture — the Run A shape: gates + pre-lock law.json on disk, NO git repo at all.
// Asimov has compiled (he runs no git); the lock leg is the first git touch of the stage.
function makeBareFixture(prefix = 'kiln-greenfield-test-') {
  const proj = mkdtempSync(join(tmpdir(), prefix))
  const kiln = join(proj, '.kiln')
  mkdirSync(join(proj, 'tests/acceptance'), { recursive: true })
  mkdirSync(kiln, { recursive: true })
  writeFileSync(join(proj, 'app.txt'), 'hello world\n')
  writeFileSync(join(proj, 'tests/acceptance/sc-001.sh'), 'grep -q hello app.txt\n')
  writeFileSync(join(proj, 'tests/acceptance/sc-002.sh'), 'exit 1\n')
  writeFileSync(join(kiln, 'law.json'), JSON.stringify(fixtureLaw(), null, 2) + '\n')
  return { proj, kiln }
}
const readLawNow = (kiln) => JSON.parse(readFileSync(join(kiln, 'law.json'), 'utf8'))
const gitIn = (dir, ...args) => {
  const res = spawnSync('git', ['-C', dir, '-c', 'user.email=kiln@test', '-c', 'user.name=kiln', ...args], { encoding: 'utf8' })
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`)
  return res.stdout.trim()
}

// ── 1. kiln-law on fixtures ──────────────────────────────────────────────────────────────────────
test('CLI index: a projectPath with no git HEAD refuses with the NAMED reason — never a misleading deep-gate error; law.json untouched', () => {
  const { proj, kiln } = makeBareFixture()
  try {
    // no .git at all — the Run A failure shape, pre-flight skipped
    const bare = cli('index', proj, kiln)
    assert.equal(bare.status, 1)
    assert.match(bare.stderr, /index: .* has no git HEAD to record as lock_commit/)
    assert.match(bare.stderr, /chore: kiln build baseline/, 'the named reason carries the remedy — the greenfield pre-flight recipe')
    assert.doesNotMatch(bare.stderr, /tamper gate/, 'the old surface was a misleading "tamper gate: git log failed"')
    assert.deepEqual(readLawNow(kiln), fixtureLaw(), 'a refused index writes nothing')
    // .git exists but HEAD is unborn (init, zero commits): brownfield stays exactly today's
    // behavior — no init, no baseline, an honest refusal, now with the same named reason
    assert.equal(spawnSync('git', ['-C', proj, 'init', '-q']).status, 0)
    const unborn = cli('index', proj, kiln)
    assert.equal(unborn.status, 1)
    assert.match(unborn.stderr, /has no git HEAD to record as lock_commit/)
    assert.deepEqual(readLawNow(kiln), fixtureLaw())
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

test('CLI greenfield lock drill: bare dir → the brief\'s exact pre-flight (scrubbed identity) → index → lock commit — both commits land, lock_commit anchors the baseline, verify clean, the runner works', () => {
  const { proj, kiln } = makeBareFixture()
  const home = mkdtempSync(join(tmpdir(), 'kiln-home-'))
  try {
    const env = scrubbedEnv(home)
    // the mechanical probe decides greenfield — the disk states fact
    assert.notEqual(spawnSync('bash', ['-c', `ls -d "${proj}/.git"`]).status, 0, 'probe: no .git — greenfield')
    const pf = spawnSync('bash', ['-c', preFlightCmd(proj)], { encoding: 'utf8', env })
    assert.equal(pf.status, 0, `pre-flight failed: ${pf.stderr}`)
    assert.equal(spawnSync('bash', ['-c', `ls -d "${proj}/.git"`]).status, 0, 'the probe flips: .git exists now')
    const gitOut = (...a) => { const r = spawnSync('git', ['-C', proj, ...a], { encoding: 'utf8', env }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
    assert.equal(gitOut('config', '--local', 'user.name'), 'Kiln', 'no identity resolved in this env — the if-unset arm set a LOCAL one')
    assert.deepEqual(gitOut('log', '--format=%s').split('\n'), ['chore: kiln build baseline'])
    const baseline = gitOut('rev-parse', 'HEAD')
    // `git add -A` swept EVERYTHING into the baseline: product, gates, the pre-lock law
    const inBaseline = gitOut('show', '--name-only', '--format=', 'HEAD').split('\n')
    for (const p of ['app.txt', 'tests/acceptance/sc-001.sh', 'tests/acceptance/sc-002.sh', '.kiln/law.json']) {
      assert.ok(inBaseline.includes(p), `${p} must be in the baseline commit`)
    }
    // the UNCHANGED §5 sequence on top — no manual recovery anywhere
    const idx = cli('index', proj, kiln)
    assert.equal(idx.status, 0, idx.stderr)
    assert.equal(readLawNow(kiln).lock_commit, baseline, 'lock_commit anchors on the baseline — the last pre-gate commit')
    const lc = spawnSync('bash', ['-c', lockCommitCmd(proj)], { encoding: 'utf8', env })
    assert.equal(lc.status, 0, `lock commit failed: ${lc.stderr}`)
    assert.deepEqual(gitOut('log', '--format=%s').split('\n'),
      ['test(law): lock acceptance gates', 'chore: kiln build baseline'],
      'baseline commit AND lock commit both present, in §5 order')
    const ver = cli('verify', proj, kiln)
    assert.equal(ver.status, 0, `verify must be clean on a self-baselined greenfield lock: ${ver.stdout}${ver.stderr}`)
    assert.match(ver.stdout, /verify clean/)
    // the locked runner works end-to-end on the self-baselined repo
    const run = cli('run', proj, kiln)
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /^GREEN SC-001/m)
    assert.match(run.stdout, /^RED SC-002 exit 1/m)
  } finally { rmSync(proj, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) }
})

test('CLI greenfield pre-flight: an identity that already resolves is NEVER overwritten — no local entry written, the baseline carries the existing author', () => {
  const { proj, kiln } = makeBareFixture()
  const home = mkdtempSync(join(tmpdir(), 'kiln-home-'))
  try {
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Existing Human\n\temail = human@example.com\n')
    const env = scrubbedEnv(home)
    delete env.GIT_CONFIG_GLOBAL // the fake HOME's .gitconfig IS the resolving identity here
    const pf = spawnSync('bash', ['-c', preFlightCmd(proj)], { encoding: 'utf8', env })
    assert.equal(pf.status, 0, pf.stderr)
    const local = spawnSync('git', ['-C', proj, 'config', '--local', 'user.name'], { encoding: 'utf8', env })
    assert.notEqual(local.status, 0, 'an identity that resolves must not gain a local override')
    const author = spawnSync('git', ['-C', proj, 'log', '--format=%an <%ae>'], { encoding: 'utf8', env })
    assert.equal(author.stdout.trim(), 'Existing Human <human@example.com>')
    assert.equal(cli('index', proj, kiln).status, 0, 'the sequence proceeds identically')
  } finally { rmSync(proj, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) }
})

test('CLI greenfield pre-flight: whitespace-safe — a projectPath containing spaces probes and baselines cleanly (the review repro)', () => {
  const { proj, kiln } = makeBareFixture('kiln greenfield ws test-')
  const home = mkdtempSync(join(tmpdir(), 'kiln-home-'))
  try {
    assert.ok(/\s/.test(proj), 'fixture precondition: the path carries whitespace')
    const env = scrubbedEnv(home)
    // the quoted probe decides greenfield — never `cd`/`ls: too many arguments`
    assert.notEqual(spawnSync('bash', ['-c', `ls -d "${proj}/.git"`]).status, 0, 'probe: no .git — greenfield')
    const pf = spawnSync('bash', ['-c', preFlightCmd(proj)], { encoding: 'utf8', env })
    assert.equal(pf.status, 0, `the quoted pre-flight must survive whitespace: ${pf.stderr}`)
    assert.equal(spawnSync('bash', ['-c', `ls -d "${proj}/.git"`]).status, 0, 'the probe flips: .git exists now')
    const log = spawnSync('git', ['-C', proj, 'log', '--format=%s'], { encoding: 'utf8', env })
    assert.equal(log.stdout.trim(), 'chore: kiln build baseline')
    // kiln-law itself is execFile-based (no shell): index anchors the spaced path's baseline
    const idx = cli('index', proj, kiln)
    assert.equal(idx.status, 0, idx.stderr)
    const head = spawnSync('git', ['-C', proj, 'rev-parse', 'HEAD'], { encoding: 'utf8', env }).stdout.trim()
    assert.equal(readLawNow(kiln).lock_commit, head)
  } finally { rmSync(proj, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) }
})

test('CLI brownfield lock drill: an existing history gets NO init and NO baseline — the lock commit lands on top, verify clean', () => {
  const { proj, kiln } = makeBareFixture()
  try {
    // brownfield: real history predates the Law (two product commits)
    gitIn(proj, 'init', '-q')
    gitIn(proj, 'add', 'app.txt')
    gitIn(proj, 'commit', '-qm', 'initial product commit')
    writeFileSync(join(proj, 'app.txt'), 'hello brownfield world\n')
    gitIn(proj, 'add', 'app.txt')
    gitIn(proj, 'commit', '-qm', 'feat: more product work')
    const rootBefore = gitIn(proj, 'rev-list', '--max-parents=0', 'HEAD')
    const headBefore = gitIn(proj, 'rev-parse', 'HEAD')
    // the mechanical probe decides brownfield — the pre-flight branch is NOT taken
    assert.equal(spawnSync('bash', ['-c', `ls -d "${proj}/.git"`]).status, 0, 'probe: .git exists — brownfield')
    const idx = cli('index', proj, kiln)
    assert.equal(idx.status, 0, idx.stderr)
    assert.equal(readLawNow(kiln).lock_commit, headBefore, 'lock_commit anchors the EXISTING history tip')
    gitIn(proj, 'add', 'tests/acceptance', '.kiln/law.json')
    gitIn(proj, 'commit', '-qm', 'test(law): lock acceptance gates')
    const subjects = gitIn(proj, 'log', '--format=%s').split('\n')
    assert.deepEqual(subjects, ['test(law): lock acceptance gates', 'feat: more product work', 'initial product commit'],
      'exactly ONE new commit, on top of the untouched history')
    assert.ok(!subjects.includes('chore: kiln build baseline'), 'no second baseline — ever (build\'s rakim init is already idempotent)')
    assert.equal(gitIn(proj, 'rev-list', '--max-parents=0', 'HEAD'), rootBefore, 'the history root is untouched — no re-init')
    assert.equal(gitIn(proj, 'rev-parse', 'HEAD~1'), headBefore, 'the lock commit\'s parent is the pre-lock tip')
    assert.equal(cli('verify', proj, kiln).status, 0)
  } finally { rmSync(proj, { recursive: true, force: true }) }
})

// ── 2. The GENERATED workflows/architecture.js lock leg, mock-driven ─────────────────────────────
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
      calls.push({ label, prompt })
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
const cleanDry = {
  reasoning: 'd', exit: 0, error: '',
  transcript: [
    { id: 'SC-001', kind: 'shell', classification: 'ambiguous', exit: 1, signal: null, duration_ms: 4, stdout_tail: '', stderr_tail: 'AssertionError: feature missing' },
    { id: 'SC-002', kind: 'probe', classification: 'deferred', exit: null, signal: null, duration_ms: 0, stdout_tail: '', stderr_tail: '' },
  ],
}
const passRuling = { reasoning: 'r', verdict: 'PASS', broken: [], green_legitimate: [] }

const respond = (over = {}) => (label) => {
  if (label === 'thoth:research-check') return { reasoning: 'ls', missing: [] }
  if (label === 'numerobis:foundation') return foundationResult
  if (label === 'plato:synthesis' || label.startsWith('plato:revise')) return synthResult
  if (label.startsWith('athena:validate')) return { reasoning: 'v', verdict: 'PASS', failed_dimensions: [], fixes: [] }
  if (label === 'asimov:law') return asimovResult
  if (label.startsWith('thoth:dryrun')) return 'dryrun' in over ? over.dryrun : cleanDry
  if (label.startsWith('athena:dryrun')) return 'ruling' in over ? over.ruling : passRuling
  if (label.startsWith('asimov:check-revise')) return null
  if (label === 'thoth:law-lock') return { reasoning: 'l', indexed: true, committed: true, error: '' }
  if (label === 'thoth:law-verify') return { reasoning: 'v', law_json_exists: true, lock_commit_exists: true }
  if (label === 'thoth:verify') return { reasoning: 'ok', missing: [] }
  return null
}
const lockPromptOf = (calls) => calls.find((c) => c.label === 'thoth:law-lock').prompt

test('arch lock brief: carries the greenfield pre-flight VERBATIM — the probe + the exact command floor 1 executed — before the index step; brownfield is told hands-off', async () => {
  const { result, calls } = await runArch(lawArgs, respond())
  assert.equal(result.law_locked, true)
  const p = lockPromptOf(calls)
  assert.match(p, /PRE-FLIGHT, before any numbered step/)
  assert.ok(p.includes(`ls -d "/tmp/nonexistent-kiln/.git"`), 'the mechanical disk probe, projectPath double-quoted (whitespace-safe)')
  assert.ok(p.includes(preFlightCmd('/tmp/nonexistent-kiln')), 'the EXACT pre-flight command the CLI drills executed — brief and drill cannot drift')
  assert.match(p, /Decide MECHANICALLY from the disk/)
  assert.match(p, /never from any flag/, 'the flag describes intent; the disk states fact')
  assert.match(p, /change NOTHING about the repo/, 'brownfield: untouched, exactly today\'s behavior')
  assert.match(p, /LOCAL identity only where none resolves/)
  assert.match(p, /never on an existing repo/)
  assert.ok(p.indexOf('PRE-FLIGHT') < p.indexOf('kiln-law.mjs index'), 'baseline before index — index records lock_commit = HEAD')
  assert.match(p, /If a step fails \(the pre-flight included\), STOP/, 'a failed pre-flight reports verbatim in error — fail closed')
  // the §5 sequence itself is byte-unchanged
  assert.match(p, /git add tests\/acceptance \.kiln\/law\.json && git commit -m "test\(law\): lock acceptance gates"/)
})

test('arch lock brief: the disk decides, never the flag — greenfield and brownfield mode args produce byte-identical briefs', async () => {
  const g = await runArch({ ...lawArgs, mode: 'greenfield' }, respond())
  const b = await runArch({ ...lawArgs, mode: 'brownfield' }, respond())
  assert.equal(lockPromptOf(g.calls), lockPromptOf(b.calls),
    'the greenfield flag describes intent; the lock leg probes the disk at run time')
  assert.equal(g.result.law_locked, true)
  assert.equal(b.result.law_locked, true)
})

test('arch lock brief: the pre-flight precedes the pre_satisfied edit (repo baseline before any law edit), which precedes index', async () => {
  const greenDry = {
    reasoning: 'd', exit: 0, error: '',
    transcript: [{ id: 'SC-001', kind: 'shell', classification: 'green', exit: 0, signal: null, duration_ms: 3, stdout_tail: '', stderr_tail: '' }],
  }
  const legit = { reasoning: 'r', verdict: 'PASS', broken: [], green_legitimate: ['SC-001'] }
  const { result, calls } = await runArch(lawArgs, respond({ dryrun: greenDry, ruling: legit }))
  assert.equal(result.law_locked, true)
  const p = lockPromptOf(calls)
  assert.ok(p.indexOf('PRE-FLIGHT') < p.indexOf('pre_satisfied'), 'baseline before the pre_satisfied edit')
  assert.ok(p.indexOf('pre_satisfied') < p.indexOf('kiln-law.mjs index'), 'the T1 ordering is unchanged')
})
