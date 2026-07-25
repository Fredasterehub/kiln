import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// W1-S2 (Defect B): the trusted kiln-review state-commit verb replaces the model-relayed
// STATE.md heredoc write. These tests drive the REAL CLI: a valid commit writes the exact
// eight-line ledger the former stateDoc emitted, and every invalid closed word fails closed
// with nothing written. kernel.js is asserted free of the retired heredoc machinery.
const CLI = fileURLToPath(new URL('../scripts/kiln-review', import.meta.url))
const KERNEL = fileURLToPath(new URL('../workflows/kernel.js', import.meta.url))

// W2-S10: run-lock acquire probes codex before it mints, and the probe asks only for a version —
// so a stub that exits 0 IS a codex here, prepended so it answers ahead of any real one. The single
// acquire in this file states its availability that way instead of inheriting the host machine.
const CODEX_DIR = mkdtempSync(join(tmpdir(), 'kiln-statecodex-'))
writeFileSync(join(CODEX_DIR, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
const withCodex = { ...process.env, PATH: `${CODEX_DIR}:${process.env.PATH}` }

function commit(args) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-state-'))
  const run = spawnSync('node', [CLI, 'state-commit', dir, ...args], { encoding: 'utf8' })
  return { dir, run, state: join(dir, 'STATE.md') }
}

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

test('state-commit: a valid advance writes the eight-line ledger atomically, clock stamped', () => {
  const { dir, run, state } = commit(['advance', 'build', 's1', 'relaunch-validate', 'broad', '.kiln/STATE.md', '.kiln/LAW.md'])
  assert.equal(run.status, 0, run.stderr)
  assert.ok(existsSync(state), 'STATE.md exists')
  // No temp survives either rename — the dir holds exactly the two committed artifacts,
  // the rendered STATE.md and the canonical state.json (W2-S2). 'S' sorts before 's'.
  assert.deepEqual(readdirSync(dir).sort(), ['STATE.md', 'state.json'], 'no .tmp residue after the atomic renames')
  const lines = readFileSync(state, 'utf8').split('\n')
  assert.equal(lines.length, 9, 'eight lines plus the trailing newline')
  assert.equal(lines[8], '', 'trailing newline, exactly as the former heredoc wrote')
  assert.match(lines[7], /^updated_at: /)
  assert.ok(TS.test(lines[7].slice('updated_at: '.length)), 'updated_at is a real UTC stamp, no milliseconds')
})

test('state-commit: the eight-line byte format matches the former stateDoc exactly', () => {
  // (d): pin every line for known closed inputs — the format the former stateDoc produced.
  const { run, state } = commit(['advance', 'build', 's1', 'relaunch-validate', 'broad', '.kiln/STATE.md', '.kiln/LAW.md'])
  assert.equal(run.status, 0, run.stderr)
  const lines = readFileSync(state, 'utf8').split('\n')
  assert.deepEqual(lines.slice(0, 7), [
    '# STATE',
    'stage: build',
    'active_slice: s1',
    'next_action: Relaunch the kernel workflow with stage=validate',
    'density: broad',
    'pointers: .kiln/STATE.md .kiln/LAW.md',
    'seals: .kiln/seals.log',
  ], 'the seven fixed lines are byte-for-byte the former stateDoc format')
})

test('state-commit: the next-action key table resolves each hint with stage and slice filled', () => {
  const nextAction = (args) => {
    const { run, state } = commit(args)
    assert.equal(run.status, 0, run.stderr)
    return readFileSync(state, 'utf8').split('\n')[3]
  }
  assert.equal(nextAction(['boundary', 'build', 's1', 'reopen-slice', 'broad']),
    'next_action: Reopen slice s1: LAW is red — relaunch stage build')
  assert.equal(nextAction(['hold', 'build', 's2', 'operator-ruling', 'engineer']),
    'next_action: Operator ruling: the run is blocked for slice s2 — rule, then relaunch stage build')
  assert.equal(nextAction(['hold', 'validate', 'none', 'operator-ruling', 'broad']),
    'next_action: Operator ruling: the run is blocked — rule, then relaunch stage validate')
  assert.equal(nextAction(['degrade', 'build', 's1', 'restore-codex', 'broad']),
    'next_action: Restore codex, then relaunch stage build — the second family is needed')
  assert.equal(nextAction(['degrade', 'build', 's1', 'acknowledge-degrade', 'broad']),
    'next_action: Acknowledge single-family degradation, then relaunch stage build')
  assert.equal(nextAction(['advance', 'report', 'none', 'run-complete', 'broad']),
    'next_action: Run complete')
  assert.equal(nextAction(['boundary', 'law', 'none', 'rerun-onboarding', 'broad']),
    'next_action: Rerun onboarding, then relaunch stage law')
  // B2: the rerun-<target> keys name their own stage, so a build that must return to LAW
  // renders "Rerun stage law" even though the current stage arg is build.
  assert.equal(nextAction(['boundary', 'build', 'none', 'rerun-law', 'broad']),
    'next_action: Rerun stage law')
  assert.equal(nextAction(['boundary', 'build', 's1', 'rerun-build', 'broad']),
    'next_action: Rerun stage build')
})

test('state-commit: token and next_action_key must agree on direction (A1)', () => {
  // A forward token may carry only a forward key, and a stop token only a stop key. The
  // kernel never emits a contradiction; the trusted verb enforces its own contract so a
  // bypassed or tampered call fails closed.
  const forwardStop = commit(['advance', 'build', 's1', 'operator-ruling', 'broad'])
  assert.notEqual(forwardStop.run.status, 0, 'advance + a stop key is rejected')
  assert.ok(!existsSync(forwardStop.state), 'nothing written on a direction mismatch')
  const stopForward = commit(['hold', 'build', 's1', 'run-complete', 'broad'])
  assert.notEqual(stopForward.run.status, 0, 'hold + a forward key is rejected')
  assert.ok(!existsSync(stopForward.state), 'nothing written on the reverse mismatch')
})

test('state-commit: an injection or parent-escape pointer fails closed, nothing written (B1)', () => {
  for (const bad of ['.kiln/LAW.md; echo INJECTED', '.kiln/x\nY', '../etc/passwd', '.kiln/a b']) {
    const { run, state } = commit(['advance', 'build', 's1', 'relaunch-validate', 'broad', bad])
    assert.notEqual(run.status, 0, `a pointer of ${JSON.stringify(bad)} is rejected`)
    assert.ok(!existsSync(state), 'no STATE.md is written on a malformed pointer')
  }
  // A grammar-clean pointer still commits.
  const ok = commit(['advance', 'build', 's1', 'relaunch-validate', 'broad', '.kiln/evidence/gen-2/manifest.json'])
  assert.equal(ok.run.status, 0, ok.run.stderr)
  assert.match(readFileSync(ok.state, 'utf8'), /^pointers: \.kiln\/evidence\/gen-2\/manifest\.json$/m)
})

test('state-commit: an unknown token fails closed, nothing written', () => {
  const { run, state } = commit(['forge', 'build', 's1', 'relaunch-validate', 'broad'])
  assert.notEqual(run.status, 0, 'nonzero exit on an unknown transition token')
  assert.equal(run.stdout.trim(), 'transport_failure', 'the machine fact is transport_failure')
  assert.ok(!existsSync(state), 'no STATE.md is written on a rejected transition')
})

test('state-commit: a bad stage or density fails closed, nothing written', () => {
  const badStage = commit(['advance', 'deploy', 's1', 'relaunch-validate', 'broad'])
  assert.notEqual(badStage.run.status, 0, 'nonzero exit on an unknown stage')
  assert.ok(!existsSync(badStage.state), 'no STATE.md on a bad stage')

  const badDensity = commit(['advance', 'build', 's1', 'relaunch-validate', 'loud'])
  assert.notEqual(badDensity.run.status, 0, 'nonzero exit on an unknown density')
  assert.ok(!existsSync(badDensity.state), 'no STATE.md on a bad density')

  const badKey = commit(['advance', 'build', 's1', 'teleport', 'broad'])
  assert.notEqual(badKey.run.status, 0, 'nonzero exit on an unknown next-action key')
  assert.ok(!existsSync(badKey.state), 'no STATE.md on a bad key')

  // B4 TAMPER GUARD (not the live path): the kernel never ships a malformed slice — it
  // records active_slice=none when no valid slice exists. But if a bypassed or tampered
  // call hands the verb a malformed NON-none slice id, the verb rejects it.
  const badSlice = commit(['advance', 'build', 'bad slice', 'relaunch-validate', 'broad'])
  assert.notEqual(badSlice.run.status, 0, 'a malformed non-none slice id is rejected as a tamper guard')
  assert.ok(!existsSync(badSlice.state), 'no STATE.md on a malformed slice id')
})

// ── W2-S2 (H6 / B02): the crash-consistent canonical state.json ──────────────
// state-commit now composes a typed .kiln/state.json (the canonical truth) and renders STATE.md
// from it. state.json is written and renamed BEFORE STATE.md, and every commit reconciles the
// rendered view against the record's render_digest first, so a crash between the two renames
// self-heals at the next trusted write.
const record = (dir) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
const digestOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const commitInto = (dir, args) => spawnSync('node', [CLI, 'state-commit', dir, ...args], { encoding: 'utf8' })

test('state-commit: composes the typed canonical state.json alongside the rendered STATE.md', () => {
  const { dir, run, state } = commit(['advance', 'build', 's1', 'relaunch-validate', 'broad', '.kiln/STATE.md', '.kiln/LAW.md'])
  assert.equal(run.status, 0, run.stderr)
  const rec = record(dir)
  assert.equal(rec.revision, 1, 'a first write starts the revision counter at 1')
  assert.equal(rec.stage, 'build')
  assert.equal(rec.active_slice, 's1')
  assert.equal(rec.next_action_key, 'relaunch-validate', 'the closed key is the machine-canonical field')
  assert.equal(rec.next_action, 'Relaunch the kernel workflow with stage=validate', 'the rendered hint rides alongside the key')
  assert.equal(rec.density, 'broad')
  assert.deepEqual(rec.pointers, ['.kiln/STATE.md', '.kiln/LAW.md'])
  assert.equal(rec.seals, '.kiln/seals.log')
  assert.equal(rec.run_id, null, 'no run.lock beside the dir means run_id is honestly null')
  assert.ok(TS.test(rec.updated_at), 'updated_at is a real UTC stamp, no milliseconds')
  // render_digest is the sha256 of the exact STATE.md bytes, and the doc carries the same stamp.
  assert.equal(rec.render_digest, digestOf(state), 'render_digest hashes the exact rendered STATE.md bytes')
  assert.match(readFileSync(state, 'utf8'), new RegExp(`^updated_at: ${rec.updated_at}$`, 'm'), 'the record stamp equals the doc stamp')
})

test('state-commit: the revision counter advances monotonically across commits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-rev-'))
  for (let n = 1; n <= 3; n++) {
    const run = commitInto(dir, ['advance', 'build', 's1', 'relaunch-validate', 'broad'])
    assert.equal(run.status, 0, run.stderr)
    assert.equal(record(dir).revision, n, `commit ${n} records revision ${n}`)
  }
})

test('state-commit: crash window B — neither file landed yields a clean first write at revision 1', () => {
  const { dir, run, state } = commit(['advance', 'law', 'none', 'relaunch-build', 'broad'])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(record(dir).revision, 1, 'a fresh run with no prior state.json starts at revision 1')
  assert.equal(record(dir).render_digest, digestOf(state), 'the first write is already in render parity')
})

test('state-commit: crash window A — state.json ahead of a stale STATE.md heals, then advances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-wina-'))
  assert.equal(commitInto(dir, ['advance', 'build', 's1', 'relaunch-validate', 'broad']).status, 0)
  const staleDoc = readFileSync(join(dir, 'STATE.md'))
  assert.equal(commitInto(dir, ['advance', 'build', 's2', 'relaunch-validate', 'broad']).status, 0)
  assert.equal(record(dir).revision, 2)
  // Model the crash between the renames: state.json is at revision 2, but STATE.md still holds the
  // revision-1 render because the rename that would advance the view never happened.
  writeFileSync(join(dir, 'STATE.md'), staleDoc)
  const run3 = commitInto(dir, ['advance', 'build', 's3', 'relaunch-validate', 'broad'])
  assert.equal(run3.status, 0, run3.stderr)
  const rec = record(dir)
  assert.equal(rec.revision, 3, 'the commit read the ahead state.json and advanced — never reset to 1')
  assert.equal(rec.active_slice, 's3')
  assert.equal(rec.render_digest, digestOf(join(dir, 'STATE.md')), 'STATE.md is re-rendered in parity with the advanced record')
})

test('state-commit: reconciliation heals a deleted STATE.md at the next commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-del-'))
  assert.equal(commitInto(dir, ['advance', 'build', 's1', 'relaunch-validate', 'broad']).status, 0)
  rmSync(join(dir, 'STATE.md'))
  const run2 = commitInto(dir, ['advance', 'build', 's2', 'relaunch-validate', 'broad'])
  assert.equal(run2.status, 0, run2.stderr)
  const rec = record(dir)
  assert.equal(rec.revision, 2, 'a missing rendered view never resets the canonical counter')
  assert.ok(existsSync(join(dir, 'STATE.md')), 'STATE.md is restored by the commit')
  assert.equal(rec.render_digest, digestOf(join(dir, 'STATE.md')), 'the restored view is in render parity')
})

// A torn, non-object, or invalid-revision state.json is transport-class: the commit stops with
// EXACTLY transport_failure and touches NEITHER artifact. Because the stop precedes any heal or
// write, a pre-planted state.json AND STATE.md both survive byte-identically — a regression that
// overwrites the planted bytes and then exits nonzero would fail this pin.
function assertStopUntouched(planted) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-stop-'))
  const priorDoc = '# STATE\nstage: build\nactive_slice: PRIOR\n'
  writeFileSync(join(dir, 'state.json'), planted)
  writeFileSync(join(dir, 'STATE.md'), priorDoc)
  const run = commitInto(dir, ['advance', 'build', 's1', 'relaunch-validate', 'broad'])
  assert.notEqual(run.status, 0, `${planted} must halt the commit`)
  assert.equal(run.stdout.trim(), 'transport_failure', `${planted} halts with exactly transport_failure`)
  assert.equal(readFileSync(join(dir, 'state.json'), 'utf8'), planted, `${planted}: state.json left byte-untouched`)
  assert.equal(readFileSync(join(dir, 'STATE.md'), 'utf8'), priorDoc, `${planted}: STATE.md left byte-untouched — the stop precedes any heal`)
}

test('state-commit: a malformed or non-object state.json is transport-class — stop, both artifacts untouched (B05)', () => {
  assertStopUntouched('{ not valid json')
  assertStopUntouched('[]')
  // The absent-STATE.md variant: a torn ledger with no prior view writes no STATE.md at all.
  const dir = mkdtempSync(join(tmpdir(), 'kiln-torn-abs-'))
  writeFileSync(join(dir, 'state.json'), '{ not valid json')
  const run = commitInto(dir, ['advance', 'build', 's1', 'relaunch-validate', 'broad'])
  assert.equal(run.stdout.trim(), 'transport_failure', 'the machine fact is exactly transport_failure')
  assert.ok(!existsSync(join(dir, 'STATE.md')), 'an absent STATE.md stays absent on a torn ledger')
})

test('state-commit: a present record with a missing or non-positive revision stops — never resets to 1 (B01)', () => {
  // A parseable object whose counter is absent, non-numeric, non-integer, or non-positive is a
  // DAMAGED typed record; resetting it to 1 would erase monotonic history, so the commit stops
  // transport-class with nothing written. Only a truly absent state.json starts fresh at 1.
  for (const planted of ['{}', '{"revision":"7"}', '{"revision":0}', '{"revision":-3}', '{"revision":1.5}']) {
    assertStopUntouched(planted)
  }
})

test('state-commit: run_id is trusted only from a CLI-minted run.lock, null otherwise (B04)', () => {
  const bare = commit(['advance', 'build', 's1', 'relaunch-validate', 'broad'])
  assert.equal(bare.run.status, 0, bare.run.stderr)
  assert.equal(record(bare.dir).run_id, null, 'no run.lock -> run_id honestly null')
  // A semantically non-conforming lock — a model-authorable object that is NOT the CLI-minted W2-S1
  // shape (owner is a number here, not a LOCK_TOKEN string) — is not trusted: run_id records as
  // null, the same honest absence as no lock, never the forged identity string.
  const forged = mkdtempSync(join(tmpdir(), 'kiln-forged-'))
  writeFileSync(join(forged, 'run.lock'), JSON.stringify({ run_id: 'model-authored', owner: 17 }))
  const forgedRun = commitInto(forged, ['advance', 'build', 's1', 'relaunch-validate', 'broad'])
  assert.equal(forgedRun.status, 0, forgedRun.stderr)
  assert.equal(record(forged).run_id, null, 'a non-conforming lock yields run_id null, never the forged string')
  // With a real lock the CLI itself acquired, the commit reads run_id from run.lock — no argv relay.
  // W2-S10: acquire now probes codex before it mints, so this spawn STATES its availability with a
  // stub prepended to PATH rather than depending on what the host machine happens to have.
  const dir = mkdtempSync(join(tmpdir(), 'kiln-run-'))
  const acq = spawnSync('node', [CLI, 'run-lock', 'acquire', dir, 'follow-ladders', String(process.pid)], { encoding: 'utf8', env: withCodex })
  assert.equal(acq.status, 0, acq.stderr)
  const lockedRunId = acq.stdout.trim().split(' ')[0]
  const run = commitInto(dir, ['advance', 'build', 's1', 'relaunch-validate', 'broad'])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(record(dir).run_id, lockedRunId, 'the commit records the CLI-minted run.lock run_id verbatim')
})

// ── W2-S2 (B02): reconcileStateDoc pinned DIRECTLY ───────────────────────────
// The crash-window end-state tests above pin revision monotonicity, but they cannot pin the heal
// itself: every commit unconditionally re-renders STATE.md AFTER the reconcile, so the final write
// masks whether reconcile ever ran (a neutered reconcile passes them byte-identically). B02's
// guarantee — the heal keeps STATE.md consistent with the un-advanced record BEFORE the advance —
// is pinned here by evaluating the helper source directly against a mock fs (the repo drift-pin
// extraction idiom, as the W2-S1 lock pins do). The fs ops ride in as PARAMETERS so the write and
// rename are observable; the shipped CLI stays byte-clean of any test seam.
// Since the layer split the CLI is six files, and this file extracts from two of them — the state
// helpers from their module and the dispatch block from the entry — so the corpus is the whole CLI.
const cliSrc = [CLI, ...['core', 'authority', 'run', 'attestation', 'gate']
  .map((m) => fileURLToPath(new URL(`../scripts/lib/${m}.js`, import.meta.url)))]
  .map((f) => readFileSync(f, 'utf8')).join('\n')
const fnText = (name) => {
  const start = cliSrc.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} still exists as a named helper in kiln-review`)
  return cliSrc.slice(start, cliSrc.indexOf('\n}\n', start) + 2)
}
// reconcileText is a seam ONLY for the discrimination evidence (a neutered body); production tests
// take the default extracted source. reconcileStateDoc calls renderStateDoc, so both are evaluated.
const stateHelpers = (fs, reconcileText = fnText('reconcileStateDoc')) => new Function(
  'readFileSync', 'writeFileSync', 'renameSync', 'mkdirSync', 'createHash', 'join', 'randomUUID',
  `${fnText('renderStateDoc')}\n${reconcileText}\nreturn { renderStateDoc, reconcileStateDoc }`,
)(fs.readFileSync, fs.writeFileSync, fs.renameSync, fs.mkdirSync, createHash, join, randomUUID)

const KDIR = '/kiln'
function mockFs() {
  const store = new Map()
  const writes = []
  const renames = []
  const fs = {
    readFileSync: (p) => {
      if (!store.has(p)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e }
      return store.get(p)
    },
    writeFileSync: (p, data) => { store.set(p, data); writes.push({ path: p, data }) },
    renameSync: (from, to) => {
      if (!store.has(from)) { const e = new Error(`ENOENT: ${from}`); e.code = 'ENOENT'; throw e }
      store.set(to, store.get(from)); store.delete(from); renames.push({ from, to })
    },
    mkdirSync: () => {},
  }
  return { fs, store, writes, renames }
}
const priorRecord = () => ({
  stage: 'build', active_slice: 's1', next_action: 'Relaunch the kernel workflow with stage=validate',
  density: 'broad', pointers: ['.kiln/STATE.md'], seals: '.kiln/seals.log', updated_at: '2026-07-24T00:00:00Z',
})

test('reconcileStateDoc (B02): a STATE.md that mismatches render_digest is re-rendered via temp+rename', () => {
  const m = mockFs()
  const { renderStateDoc, reconcileStateDoc } = stateHelpers(m.fs)
  const rec = priorRecord()
  rec.render_digest = createHash('sha256').update(renderStateDoc(rec)).digest('hex')
  // Plant a STATE.md whose bytes do NOT hash to render_digest — the crash-between-renames state.
  m.store.set(join(KDIR, 'STATE.md'), '# STATE\nstage: build\nactive_slice: STALE\n')
  reconcileStateDoc(KDIR, rec)
  assert.equal(m.writes.length, 1, 'the heal writes exactly one temp file')
  assert.equal(m.renames.length, 1, 'the heal renames it into place — atomic, never edited in place')
  assert.match(m.renames[0].from, /\/\.STATE\.tmp-/, 'the write lands on a UUID temp path')
  assert.equal(m.renames[0].to, join(KDIR, 'STATE.md'), 'the rename target is STATE.md')
  const healed = m.store.get(join(KDIR, 'STATE.md'))
  assert.equal(createHash('sha256').update(healed).digest('hex'), rec.render_digest,
    'the re-rendered STATE.md hashes to the record render_digest — the view is back in parity')
})

test('reconcileStateDoc (B02): a STATE.md already in render parity is left untouched — no write', () => {
  const m = mockFs()
  const { renderStateDoc, reconcileStateDoc } = stateHelpers(m.fs)
  const rec = priorRecord()
  const canonical = renderStateDoc(rec)
  rec.render_digest = createHash('sha256').update(canonical).digest('hex')
  // Plant the canonical render itself: STATE.md already hashes to render_digest.
  m.store.set(join(KDIR, 'STATE.md'), canonical)
  reconcileStateDoc(KDIR, rec)
  assert.equal(m.writes.length, 0, 'no write when the view already matches render_digest')
  assert.equal(m.renames.length, 0, 'no rename when the view already matches render_digest')
})

// ── W2-S2 (B02 + B03): the PRODUCTION wiring, pinned by source text ───────────
// The direct helper pins above prove reconcileStateDoc works, but not that the verb still CALLS it
// once, before it composes — nor that state.json is renamed before STATE.md. Sol proved a deleted
// call and a reversed rename order both stayed green through the behavioral tests. These source-text
// pins (the repo idiom) close the loop on the shipped wiring itself.
const verbBody = (() => {
  const start = cliSrc.indexOf("mode === 'state-commit'")
  assert.notEqual(start, -1, 'the state-commit dispatch still exists')
  const end = cliSrc.indexOf("mode === 'run-lock'", start)
  assert.notEqual(end, -1, 'the run-lock dispatch still bounds the state-commit block')
  return cliSrc.slice(start, end)
})()

test('state-commit (B02): the verb calls reconcileStateDoc exactly once, BEFORE it composes the record', () => {
  const calls = verbBody.split('reconcileStateDoc(').length - 1
  assert.equal(calls, 1, 'exactly one reconcileStateDoc call survives in the production verb')
  const reconcileAt = verbBody.indexOf('reconcileStateDoc(')
  const composeAt = verbBody.indexOf('renderStateDoc(record)')
  assert.notEqual(composeAt, -1, 'renderStateDoc(record) is the stable compose anchor')
  assert.ok(reconcileAt < composeAt, 'reconcile heals BEFORE the record is composed and rendered — not after')
})

test('state-commit (B03): state.json is renamed into place BEFORE STATE.md — the crash rule', () => {
  const stateRenameAt = verbBody.indexOf('renameSync(stateTmp, statePath)')
  const docRenameAt = verbBody.indexOf("renameSync(docTmp, join(kilnDir, 'STATE.md'))")
  assert.notEqual(stateRenameAt, -1, 'the state.json rename anchor is present')
  assert.notEqual(docRenameAt, -1, 'the STATE.md rename anchor is present')
  assert.ok(stateRenameAt < docRenameAt, 'the canonical state.json rename precedes the STATE.md projection rename')
})

test('state-commit: the kernel dropped the heredoc ledger machinery entirely', () => {
  const kernel = readFileSync(KERNEL, 'utf8')
  for (const retired of ['stateDoc', 'atomicWriteCmd', 'sed -i']) {
    assert.ok(!kernel.includes(retired), `kernel.js no longer carries ${retired}`)
  }
})
