import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// W1-S2 (Defect B): the trusted kiln-review state-commit verb replaces the model-relayed
// STATE.md heredoc write. These tests drive the REAL CLI: a valid commit writes the exact
// eight-line ledger the former stateDoc emitted, and every invalid closed word fails closed
// with nothing written. kernel.js is asserted free of the retired heredoc machinery.
const CLI = fileURLToPath(new URL('../scripts/kiln-review', import.meta.url))
const KERNEL = fileURLToPath(new URL('../workflows/kernel.js', import.meta.url))

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
  // No temp survives the rename — the dir holds only the final file.
  assert.deepEqual(readdirSync(dir), ['STATE.md'], 'no .STATE.tmp residue after the atomic rename')
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

test('state-commit: the kernel dropped the heredoc ledger machinery entirely', () => {
  const kernel = readFileSync(KERNEL, 'utf8')
  for (const retired of ['stateDoc', 'atomicWriteCmd', 'sed -i']) {
    assert.ok(!kernel.includes(retired), `kernel.js no longer carries ${retired}`)
  }
})
