import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// W8-S2: the screening room's evidence discipline + the screen transport. The allocator
// under test is the EXACT snippet the capture recipe documents (extracted from
// references/screening-room.md, never re-typed here), run in mkdtemp sandboxes. The verb
// contracts run scripts/kiln-review with a fake codex on PATH standing in for the
// reviewer, so no live codex is ever launched — and every pre-spawn reject case carries
// a broken codex on PATH on purpose: if the gate ever wrongly reached the spawn, the
// exit would flip 20 → 21 and the test would fail loudly instead of dialing out.
const RECIPE = fileURLToPath(new URL('../references/screening-room.md', import.meta.url))
const REVIEW = fileURLToPath(new URL('../scripts/kiln-review', import.meta.url))
const recipe = readFileSync(RECIPE, 'utf8')

test('screening-room recipe: no-install probes, the fixed required set, the bounds, and the generation law are all documented', () => {
  assert.ok(recipe.includes('npx --no-install playwright --version'), 'the playwright probe is no-install')
  assert.ok(recipe.includes('ffmpeg -version'), 'the ffmpeg probe rides beside it')
  assert.ok(recipe.includes('never an install'), 'a failed probe is the honest missing-runtime outcome, never an install')
  assert.ok(recipe.includes('EXACTLY 2 required viewports'), 'exactly two viewports are required')
  assert.ok(recipe.includes('1280x800') && recipe.includes('viewport-desktop.png'), 'desktop is 1280x800 into viewport-desktop.png')
  assert.ok(recipe.includes('390x844') && recipe.includes('viewport-mobile.png'), 'mobile is 390x844 into viewport-mobile.png')
  assert.ok(recipe.includes('film.webm'), 'one interaction/scroll film')
  assert.ok(recipe.includes('kf-<label>.png'), 'labeled keyframes extracted with ffmpeg')
  assert.ok(recipe.includes('at least 1, at most 6'), 'keyframes are bounded at six')
  assert.ok(recipe.includes('at most 2'), 'reference images are bounded at two')
  assert.ok(recipe.includes('total image transport cap: 10'), 'the total image transport cap is ten')
  assert.ok(recipe.includes('published LAST via temp + rename'), 'the manifest publishes last, temp + rename')
  assert.ok(recipe.includes('CURRENT generation = the highest'), 'CURRENT is the highest generation with a valid manifest')
  assert.ok(recipe.includes('sha256 of this manifest'), 'the verdict binds the manifest digest')
  // The manifest schema names every class key the screen verbs enforce.
  for (const key of ['"meta"', '"dom"', '"console"', '"viewport_desktop"', '"viewport_mobile"', '"film"', '"keyframes"', '"references"', '"generation"', '"runtimes"', '"counts"']) {
    assert.ok(recipe.includes(key), `the manifest schema names ${key}`)
  }
})

// ── the allocator (Sol r3 rule, adopted verbatim) ────────────────────────────
// The snippet is extracted from the recipe doc so the tested bytes ARE the documented
// bytes — a drifted doc fails here, not in a live capture.
function allocatorCode() {
  const m = recipe.match(/GEN="\$\(node -e '([\s\S]*?)'\)"/)
  assert.ok(m, 'the recipe carries the allocator snippet verbatim')
  return m[1]
}

test('allocator: reserves max+1 over ALL gen entries — a manifest-less crash-residue dir still occupies its number (gen-7 published, gen-8 residue → reserve 9)', () => {
  const code = allocatorCode()
  const proj = mkdtempSync(join(tmpdir(), 'kiln-screen-alloc-'))
  const root = join(proj, '.kiln', 'evidence')
  mkdirSync(join(root, 'gen-7'), { recursive: true })
  writeFileSync(join(root, 'gen-7', 'manifest.json'), JSON.stringify({ generation: 7 }))
  mkdirSync(join(root, 'gen-8'), { recursive: true }) // crash residue: reserved, never published
  const r = spawnSync('node', ['-e', code], { cwd: proj, encoding: 'utf8' })
  assert.equal(r.status, 0, 'the allocation succeeds')
  assert.equal(r.stdout.trim(), '.kiln/evidence/gen-9', 'the reservation is max+1 over ALL entries — the residue occupies 8')
  assert.ok(existsSync(join(root, 'gen-9')), 'the reserved dir exists the moment the allocator returns — exclusive mkdir')
})

test('allocator: an empty evidence root reserves gen-1 and creates the root itself', () => {
  const proj = mkdtempSync(join(tmpdir(), 'kiln-screen-alloc-'))
  const r = spawnSync('node', ['-e', allocatorCode()], { cwd: proj, encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), '.kiln/evidence/gen-1', 'the first generation is gen-1')
  assert.ok(existsSync(join(proj, '.kiln', 'evidence', 'gen-1')))
})

test('allocator: concurrent reservations land DISTINCT generations — the exclusive mkdir with EEXIST-only retry', async () => {
  const code = allocatorCode()
  // The retry is EEXIST-only: a collision rescans, every other failure throws honestly.
  assert.ok(code.includes('"EEXIST"') && code.includes('throw'), 'the snippet retries only on EEXIST and throws on anything else')
  assert.ok(/fs\.mkdirSync\(dir\)/.test(code), 'the reservation mkdir is non-recursive — recursive would swallow the collision')
  const proj = mkdtempSync(join(tmpdir(), 'kiln-screen-alloc-'))
  const runs = await Promise.all([...Array(6)].map(() => new Promise((done) => {
    const p = spawn('node', ['-e', code], { cwd: proj })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.on('close', (status) => done({ status, out: out.trim() }))
  })))
  for (const r of runs) assert.equal(r.status, 0, 'every concurrent reservation succeeds')
  assert.equal(new Set(runs.map((r) => r.out)).size, 6, 'six concurrent passes reserve six distinct generation dirs')
})

// ── the screen verbs (transport contracts, no live codex) ────────────────────

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const prompt = fs.readFileSync(0, 'utf8')
const gate = JSON.parse(process.env.FAKE_GATE)
if (gate.review_id === '__ECHO__') gate.review_id = (prompt.match(/"review_id":\\s*"([^"]+)"/) || [])[1]
if (process.env.FAKE_PROMPT_OUT) fs.writeFileSync(process.env.FAKE_PROMPT_OUT, prompt)
if (process.env.FAKE_ARGS_OUT) fs.writeFileSync(process.env.FAKE_ARGS_OUT, JSON.stringify(args))
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(gate))
`

const UNAVAILABLE_CODEX = `#!/usr/bin/env node
process.exit(127)
`

function digestOf(text) {
  return createHash('sha256').update(Buffer.from(text)).digest('hex')
}

// A sealed LAW whose Perceptual table carries four rows over four distinct dims — one
// proxy holds a GFM-escaped pipe, so the verb's unescape discipline is exercised live.
const LAW = `# LAW

crit-1 · slice-a · behaviour · test -f index.html · exit 0

## Plan

| slice | milestone |
| --- | --- |
| slice-a | |

## Perceptual

| criterion id | owning slice | dim | requirement | proxy command | expected | reference |
| --- | --- | --- | --- | --- | --- | --- |
| perc-hero | slice-a | composition-hierarchy | the hero dominates first glance | test -f index.html | exit 0 | |
| perc-type | slice-a | typography | the scale reads at both viewports | grep -c "h1" index.html \\| head -1 | 1 | |
| perc-color | slice-a | color-contrast | text stays readable | test -f style.css | exit 0 | |
| perc-motion | slice-a | motion-continuity | the scroll flows | test -f app.js | exit 0 | |
`

function screenRepo({ gen = 3, keyframes = ['keyframes/kf-load.png', 'keyframes/kf-scroll.png'], references = [], mutate, evidence = true, residueOnly = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'kiln-screen-'))
  const kiln = join(repo, '.kiln')
  mkdirSync(join(kiln, 'law'), { recursive: true })
  writeFileSync(join(kiln, 'LAW.md'), LAW)
  writeFileSync(join(kiln, 'law', 'lock.hash'), `${digestOf(LAW)}\n`)
  if (!evidence) return { repo, kiln }
  const genDir = join(kiln, 'evidence', `gen-${gen}`)
  mkdirSync(genDir, { recursive: true })
  if (residueOnly) return { repo, kiln, gen: genDir }
  writeFileSync(join(genDir, 'meta.json'), JSON.stringify({ url: 'http://127.0.0.1:4173/', status: 200, title: 'Under Test', runtimes: { playwright: '1.44.0', ffmpeg: '7.0' } }))
  writeFileSync(join(genDir, 'dom.html'), '<html><body><h1>hero</h1></body></html>')
  writeFileSync(join(genDir, 'console.log'), 'log: ready\n')
  for (const image of ['viewport-desktop.png', 'viewport-mobile.png', 'film.webm', ...keyframes, ...references]) {
    const abs = join(genDir, image)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, 'px')
  }
  const manifest = {
    generation: gen,
    runtimes: { playwright: '1.44.0', ffmpeg: '7.0' },
    files: {
      meta: 'meta.json',
      dom: 'dom.html',
      console: 'console.log',
      viewport_desktop: 'viewport-desktop.png',
      viewport_mobile: 'viewport-mobile.png',
      film: 'film.webm',
      keyframes,
      references,
    },
    counts: { keyframes: keyframes.length, references: references.length, images: 2 + keyframes.length + references.length },
  }
  if (mutate) mutate(manifest)
  const bytes = JSON.stringify(manifest)
  writeFileSync(join(genDir, 'manifest.json'), bytes)
  return { repo, kiln, gen: genDir, digest: digestOf(bytes) }
}

function fakeEnv({ gate, brokenCodex, promptOut, argsOut } = {}) {
  const env = { ...process.env }
  if (gate || brokenCodex) {
    const fake = mkdtempSync(join(tmpdir(), 'kiln-fakecodex-'))
    writeFileSync(join(fake, 'codex'), brokenCodex ? UNAVAILABLE_CODEX : FAKE_CODEX, { mode: 0o755 })
    env.PATH = `${fake}:${process.env.PATH}`
    if (gate) env.FAKE_GATE = JSON.stringify(gate)
  }
  if (promptOut) env.FAKE_PROMPT_OUT = promptOut
  if (argsOut) env.FAKE_ARGS_OUT = argsOut
  return env
}

function runScreen(fx, { model = 'gpt-5.6-sol', effort = 'high', gate, brokenCodex, promptOut, argsOut } = {}) {
  const out = join(fx.repo, 'screen-gate.json')
  const r = spawnSync('node', [REVIEW, 'screen', fx.repo, fx.kiln, model, effort, out],
    { encoding: 'utf8', env: fakeEnv({ gate, brokenCodex, promptOut, argsOut }) })
  return { fact: (r.stdout || '').trim(), status: r.status, stderr: r.stderr || '', out }
}

function runScreenRecheck(fx, { model = 'gpt-5.6-sol', effort = 'high', prior, delta, gate, brokenCodex } = {}) {
  const priorFile = join(fx.repo, 'prior-screen.json')
  writeFileSync(priorFile, JSON.stringify(prior))
  const deltaFile = delta === undefined ? join(fx.gen, 'manifest.json') : delta
  const out = join(fx.repo, 'screen-recheck-gate.json')
  const r = spawnSync('node', [REVIEW, 'screen-recheck', fx.repo, fx.kiln, model, effort, priorFile, deltaFile, out],
    { encoding: 'utf8', env: fakeEnv({ gate, brokenCodex }) })
  return { fact: (r.stdout || '').trim(), status: r.status, stderr: r.stderr || '', out }
}

function screenFinding(id, { criterion = 'perc-hero', location = 'viewport-desktop.png' } = {}) {
  return { id, criterion, location, failure_mode: 'two blocks fight over the fold', evidence: 'the desktop capture shows twin heroes', minimal_fix: 'demote the secondary block' }
}

function capturedPacket(promptFile) {
  const prompt = readFileSync(promptFile, 'utf8')
  const anchor = 'Evidence packet:\n'
  return { prompt, packet: JSON.parse(prompt.slice(prompt.indexOf(anchor) + anchor.length)) }
}

test('screen: accept binds law_hash = sha256 of the CURRENT manifest, attaches the bounded images via -i in manifest order, and derives the LAW rows itself', () => {
  const fx = screenRepo({ references: ['ref-mockup.png'] })
  const promptOut = join(fx.repo, 'captured-prompt.txt')
  const argsOut = join(fx.repo, 'captured-args.json')
  const r = runScreen(fx, { gate: { review_id: '__ECHO__', law_hash: fx.digest, findings: [], blockers: [], verdict: 'accept' }, promptOut, argsOut })
  assert.equal(r.fact, 'accept')
  assert.equal(r.status, 0, 'accept maps to exit 0')
  const published = JSON.parse(readFileSync(r.out, 'utf8'))
  assert.equal(published.law_hash, fx.digest, 'the verdict binds the graded generation manifest digest — atomic, in-schema')
  const args = JSON.parse(readFileSync(argsOut, 'utf8'))
  const images = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []))
  assert.deepEqual(images.map((p) => p.split('gen-3/')[1]),
    ['viewport-desktop.png', 'viewport-mobile.png', 'keyframes/kf-load.png', 'keyframes/kf-scroll.png', 'ref-mockup.png'],
    'the 2 required viewports + listed keyframes + references ride -i, in manifest order')
  const { prompt, packet } = capturedPacket(promptOut)
  assert.equal(packet.generation, 3, 'the graded generation number rides the packet')
  assert.equal(packet.law_lock_hash, digestOf(LAW), 'the sealed LAW lock.hash rides the packet as text')
  assert.deepEqual(packet.perceptual_criteria.map((row) => row.criterion),
    ['perc-hero', 'perc-type', 'perc-color', 'perc-motion'], 'the verb derives the Perceptual table rows from LAW.md itself')
  assert.equal(packet.perceptual_criteria[1].proxy, 'grep -c "h1" index.html | head -1', 'an escaped GFM pipe unescapes to the real operator')
  assert.equal(packet.rubric.length, 6, 'the shipped instrument rides whole — the rows dims select from it')
  assert.deepEqual(packet.reference_images, ['ref-mockup.png'], 'the reference naming rides as text beside the attached pixels')
  assert.ok(packet.dom_excerpt.includes('<h1>hero</h1>'), 'the DOM rides as a bounded text excerpt')
  assert.equal(packet.console_log, 'log: ready\n', 'the console rides verbatim')
  assert.ok(typeof packet.meta === 'string' && packet.meta.includes('"status":200'), 'meta.json rides as text')
  assert.ok(prompt.includes('Insufficient evidence on a dim is a finding'), 'insufficient evidence is instructed as a finding, never a blocker')
  assert.ok(prompt.includes('an evidence path with an optional :frame'), 'the location instruction pins evidence paths')
})

test('screen: changes_required publishes as reject (exit 10) — evidence-path locations with and without a :frame both pass the screen shape', () => {
  const fx = screenRepo()
  const gate = {
    review_id: '__ECHO__', law_hash: fx.digest, blockers: [], verdict: 'changes_required',
    findings: [
      screenFinding('p1', { criterion: 'perc-hero', location: 'viewport-desktop.png' }),
      screenFinding('p2', { criterion: 'perc-motion', location: 'film.webm:4' }),
    ],
  }
  const r = runScreen(fx, { gate })
  assert.equal(r.fact, 'reject')
  assert.equal(r.status, 10, 'changes_required maps to exit 10')
  const published = JSON.parse(readFileSync(r.out, 'utf8'))
  assert.deepEqual(published.findings.map((f) => f.id), ['p1', 'p2'], 'the criterion findings publish')
})

test('screen: a blocked verdict or any blocker is invalid for the screen family — exit 20, never published (hard failure belongs to the proxies)', () => {
  const fx = screenRepo()
  const r = runScreen(fx, { gate: { review_id: '__ECHO__', law_hash: fx.digest, findings: [], blockers: ['cannot see the page'], verdict: 'blocked' } })
  assert.equal(r.fact, 'transport_failure')
  assert.equal(r.status, 20)
  assert.ok(r.stderr.includes('hard failure belongs to the law proxies'), 'the screen rule is named')
  assert.ok(!existsSync(r.out), 'the blocked verdict never publishes')
})

test('screen: every findings[].criterion must be a LAW perceptual criterion id — an off-table criterion is exit 20, never published', () => {
  const fx = screenRepo()
  const gate = { review_id: '__ECHO__', law_hash: fx.digest, blockers: [], verdict: 'changes_required', findings: [screenFinding('p1', { criterion: 'crit-1' })] }
  const r = runScreen(fx, { gate })
  assert.equal(r.fact, 'transport_failure', 'a build-law criterion id is not a perceptual criterion id')
  assert.equal(r.status, 20)
  assert.ok(r.stderr.includes('is not a LAW perceptual criterion id'), 'the membership rule is named')
  assert.ok(!existsSync(r.out))
})

test('screen: the digest binding is the manifest sha256 — a reviewer echoing the LAW lock.hash instead is exit 20, never published', () => {
  const fx = screenRepo()
  assert.notEqual(digestOf(LAW), fx.digest)
  const r = runScreen(fx, { gate: { review_id: '__ECHO__', law_hash: digestOf(LAW), findings: [], blockers: [], verdict: 'accept' } })
  assert.equal(r.fact, 'transport_failure')
  assert.equal(r.status, 20)
  assert.ok(r.stderr.includes('graded generation manifest digest'), 'the binding names the manifest digest, not the LAW lock')
  assert.ok(!existsSync(r.out))
})

test('screen: pre-spawn rejects — no CURRENT generation, a missing required class, an exceeded bound, misdescribed metadata, a missing or escaping file — exit 20, NOTHING published, codex never spawns', () => {
  // A symlink inside the gen dir pointing out: lexically inside, physically outside.
  const escape = screenRepo({ mutate: (m) => { m.files.viewport_desktop = 'escape.png' } })
  writeFileSync(join(escape.repo, 'outside.png'), 'px')
  symlinkSync(join(escape.repo, 'outside.png'), join(escape.gen, 'escape.png'))
  const cases = [
    [screenRepo({ evidence: false }), 'no evidence root at all'],
    [screenRepo({ residueOnly: true }), 'a manifest-less residue dir is not a CURRENT generation'],
    [screenRepo({ mutate: (m) => { delete m.files.viewport_mobile } }), 'a manifest missing a required viewport class'],
    [screenRepo({ mutate: (m) => { m.files.keyframes = [] } }), 'a manifest with zero keyframes misses the class'],
    [screenRepo({ keyframes: [1, 2, 3, 4, 5, 6, 7].map((n) => `keyframes/kf-${n}.png`) }), 'seven keyframes exceed the bound'],
    [screenRepo({ references: ['r1.png', 'r2.png', 'r3.png'] }), 'three references exceed the bound'],
    [screenRepo({ mutate: (m) => { m.generation = 99 } }), 'a manifest whose gen number contradicts its dir'],
    [screenRepo({ mutate: (m) => { delete m.runtimes.ffmpeg } }), 'a manifest without a recorded runtime version'],
    [screenRepo({ mutate: (m) => { m.counts.images = 99 } }), 'a manifest whose counts contradict its named files'],
    [screenRepo({ mutate: (m) => { m.files.film = 'ghost.webm' } }), 'a manifest naming a film that is not on disk'],
    [escape, 'a manifest file that is a symlink physically escaping the generation dir'],
  ]
  for (const [fx, why] of cases) {
    // A broken codex rides PATH on purpose: if the reject wrongly reached the spawn,
    // the exit would be 21, and this assertion would name the leak.
    const r = runScreen(fx, { brokenCodex: true })
    assert.equal(r.fact, 'transport_failure', `${why} is a transport failure`)
    assert.equal(r.status, 20, `${why} halts before any spawn`)
    assert.ok(!existsSync(r.out), `${why} publishes nothing`)
  }
})

test('screen: CURRENT is the highest generation WITH a valid manifest — residue and garbage above it stay invisible (gen-7 grades, the manifest-last law)', () => {
  const fx = screenRepo({ gen: 7 })
  mkdirSync(join(fx.kiln, 'evidence', 'gen-8'), { recursive: true }) // crash residue: no manifest
  mkdirSync(join(fx.kiln, 'evidence', 'gen-9'), { recursive: true })
  writeFileSync(join(fx.kiln, 'evidence', 'gen-9', 'manifest.json'), 'not json {{{') // torn write: invalid manifest
  const promptOut = join(fx.repo, 'captured-prompt.txt')
  const r = runScreen(fx, { gate: { review_id: '__ECHO__', law_hash: fx.digest, findings: [], blockers: [], verdict: 'accept' }, promptOut })
  assert.equal(r.status, 0, 'the screen grades the highest generation with a valid manifest')
  const { packet } = capturedPacket(promptOut)
  assert.equal(packet.generation, 7, 'gen-8 residue and gen-9 garbage are invisible — CURRENT is 7')
  assert.equal(JSON.parse(readFileSync(r.out, 'utf8')).law_hash, fx.digest, 'the binding is gen-7 manifest digest')
})

test('screen: the argv contract — a bad effort halts by name, a wrong arg count is usage, a bridge-down reviewer is codex_unavailable (exit 21)', () => {
  const badEffort = runScreen(screenRepo(), { effort: 'ultra', brokenCodex: true })
  assert.equal(badEffort.fact, 'reviewer_effort_invalid', 'ultra is rejected by name at the effort gate')
  assert.equal(badEffort.status, 20)
  const fx = screenRepo()
  const short = spawnSync('node', [REVIEW, 'screen', fx.repo, fx.kiln, 'gpt-5.6-sol', 'high'], { encoding: 'utf8' })
  assert.equal((short.stdout || '').trim(), 'transport_failure', 'a wrong arg count is the usage failure')
  assert.equal(short.status, 20)
  const down = runScreen(screenRepo(), { brokenCodex: true })
  assert.equal(down.fact, 'codex_unavailable', 'a complete fixture with a downed bridge reaches the spawn and halts honestly')
  assert.equal(down.status, 21)
  assert.ok(!existsSync(down.out), 'a bridge-down run publishes no gate')
})

// ── screen-recheck: lineage, cohort, and evidence freshness ──────────────────

function priorScreenGate(findings, { review_id = 'screen-1', law_hash = 'e'.repeat(64), verdict = 'changes_required', blockers = [] } = {}) {
  return { review_id, law_hash, findings, blockers, verdict }
}

test('screen-recheck: FRESHNESS — a CURRENT manifest digest equal to the prior verdict law_hash halts before any spawn (exit 20)', () => {
  const fx = screenRepo()
  const prior = priorScreenGate([screenFinding('p1')], { law_hash: fx.digest })
  const r = runScreenRecheck(fx, { prior, brokenCodex: true })
  assert.equal(r.fact, 'transport_failure', 'regrading the very evidence that failed is refused')
  assert.equal(r.status, 20)
  assert.ok(r.stderr.includes('fresh evidence'), 'the freshness rule is named')
  assert.ok(!existsSync(r.out))
})

test('screen-recheck: a cohort subset publishes (reject, exit 10) and a cleared cohort accepts (exit 0) — law_hash tracks the FRESH manifest', () => {
  const subset = screenRepo()
  const prior = priorScreenGate([screenFinding('p1'), screenFinding('p2', { criterion: 'perc-type' })])
  const r1 = runScreenRecheck(subset, { prior, gate: { review_id: 'screen-1', law_hash: subset.digest, findings: [screenFinding('p1')], blockers: [], verdict: 'changes_required' } })
  assert.equal(r1.fact, 'reject')
  assert.equal(r1.status, 10)
  assert.deepEqual(JSON.parse(readFileSync(r1.out, 'utf8')).findings.map((f) => f.id), ['p1'], 'the published recheck reuses only prior cohort ids')
  const cleared = screenRepo()
  const r2 = runScreenRecheck(cleared, { prior, gate: { review_id: 'screen-1', law_hash: cleared.digest, findings: [], blockers: [], verdict: 'accept' } })
  assert.equal(r2.fact, 'accept', 'clearing every prior finding accepts')
  assert.equal(r2.status, 0)
  assert.equal(JSON.parse(readFileSync(r2.out, 'utf8')).law_hash, cleared.digest, 'the accepted recheck binds the fresh generation manifest digest')
})

test('screen-recheck: the cohort is reuse-or-clear — a new or renamed finding id is exit 20, never published', () => {
  const fx = screenRepo()
  const prior = priorScreenGate([screenFinding('p1'), screenFinding('p2', { criterion: 'perc-type' })])
  const r = runScreenRecheck(fx, { prior, gate: { review_id: 'screen-1', law_hash: fx.digest, findings: [screenFinding('p3')], blockers: [], verdict: 'changes_required' } })
  assert.equal(r.fact, 'transport_failure', 'an out-of-cohort finding id is a transport failure')
  assert.equal(r.status, 20)
  assert.ok(!existsSync(r.out))
})

test('screen-recheck: the SAME review_id rides the lineage — an output that abandons it is exit 20, never published', () => {
  const fx = screenRepo()
  const prior = priorScreenGate([screenFinding('p1')])
  const r = runScreenRecheck(fx, { prior, gate: { review_id: 'a-fresh-id', law_hash: fx.digest, findings: [screenFinding('p1')], blockers: [], verdict: 'changes_required' } })
  assert.equal(r.fact, 'transport_failure', 'a fresh review_id breaks the lineage')
  assert.equal(r.status, 20)
  assert.ok(!existsSync(r.out))
})

test('screen-recheck: only a prior changes_required establishes lineage — a prior accept, a prior blocked, or an off-table prior criterion halts before any spawn', () => {
  const accepted = screenRepo()
  const r1 = runScreenRecheck(accepted, { prior: priorScreenGate([], { verdict: 'accept' }), brokenCodex: true })
  assert.equal(r1.fact, 'transport_failure', 'a prior accept has nothing to recheck')
  assert.equal(r1.status, 20)
  const blocked = screenRepo()
  const r2 = runScreenRecheck(blocked, { prior: priorScreenGate([], { verdict: 'blocked', blockers: ['b1'] }), brokenCodex: true })
  assert.equal(r2.fact, 'transport_failure', 'a blocked prior was never a publishable screen verdict — no lineage')
  assert.equal(r2.status, 20)
  assert.ok(r2.stderr.includes('hard failure belongs to the law proxies'), 'the screen family shape gates the prior too')
  const offTable = screenRepo()
  const r3 = runScreenRecheck(offTable, { prior: priorScreenGate([screenFinding('p1', { criterion: 'not-a-row' })]), brokenCodex: true })
  assert.equal(r3.fact, 'transport_failure', 'a prior finding off the Perceptual table is not a valid screen artifact')
  assert.equal(r3.status, 20)
  assert.ok(r3.stderr.includes('is not a LAW perceptual criterion id'))
})

test('screen-recheck: delta is PATH-BOUND to the fresh CURRENT manifest — a missing, blank, or copied-elsewhere delta halts before any spawn (exit 20)', () => {
  const missing = screenRepo()
  const r1 = runScreenRecheck(missing, { prior: priorScreenGate([screenFinding('p1')]), delta: join(missing.repo, 'no-such-manifest.json'), brokenCodex: true })
  assert.equal(r1.fact, 'transport_failure', 'a delta that is not the CURRENT manifest path halts')
  assert.equal(r1.status, 20)
  const blankFile = screenRepo()
  const blankPath = join(blankFile.repo, 'blank-delta.json')
  writeFileSync(blankPath, '   \n')
  const r2 = runScreenRecheck(blankFile, { prior: priorScreenGate([screenFinding('p1')]), delta: blankPath, brokenCodex: true })
  assert.equal(r2.fact, 'transport_failure', 'a readable non-manifest file transports nothing')
  assert.equal(r2.status, 20)
  // Even byte-identical bytes at another path are not the CURRENT manifest — the
  // binding is the path, not just the content.
  const copied = screenRepo()
  const copyPath = join(copied.repo, 'copied-manifest.json')
  writeFileSync(copyPath, readFileSync(join(copied.gen, 'manifest.json')))
  const r3 = runScreenRecheck(copied, { prior: priorScreenGate([screenFinding('p1')]), delta: copyPath, brokenCodex: true })
  assert.equal(r3.fact, 'transport_failure', 'a byte-identical copy at another path is refused')
  assert.equal(r3.status, 20)
  assert.ok(r3.stderr.includes('CURRENT generation manifest path'), 'the path binding is named')
})
