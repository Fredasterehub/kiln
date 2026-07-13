// state-concurrency.test.mjs — the inter-process append lock for plugins/kiln/scripts/kiln-state.mjs
// (WS-C, Sol finding 8). cmdAppend reads the tail, derives next seq, heals, appends, and projects;
// with many workflow agents (and the lore beats) firing at once, an unlocked critical section
// duplicates seqs or loses the heal-rewrite. These spawn the REAL CLI concurrently and prove the
// mkdir lock serializes them. There is NO steal in the hot path (Sol rejected it twice): a wedged
// lock is cleared out-of-band by `unlock`, which refuses while the holder is alive.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-state.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const sandbox = () => mkdtempSync(join(tmpdir(), 'kiln-state-conc-'))
const init = (kilnDir) => run('init', kilnDir, '--project-path', '/srv/demo', '--name', 'demo', '--type', 'node')
const readEvents = (kilnDir) => readFileSync(join(kilnDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const readState = (kilnDir) => JSON.parse(readFileSync(join(kilnDir, 'state.json'), 'utf8'))

// the CLI's 5s acquire deadline (mirrors LOCK_DEADLINE_MS in kiln-state.mjs)
const LOCK_DEADLINE_MS = 5000

// one detached append process → { code, stderr }
const appendAsync = (kilnDir, json) => new Promise((resolve) => {
  const p = spawn(process.execPath, [CLI, 'append', kilnDir, json])
  let stderr = ''
  p.stderr.on('data', (d) => { stderr += d })
  p.on('close', (code) => resolve({ code, stderr }))
})

test('concurrent appends: 20 racing writers all land, seqs are unique + contiguous + monotonic, projection stays in sync', async () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(init(kilnDir).status, 0)
    const N = 20
    const results = await Promise.all(Array.from({ length: N }, () => appendAsync(kilnDir, '{"type":"note","stage":"build"}')))
    for (const r of results) assert.equal(r.code, 0, r.stderr)

    const events = readEvents(kilnDir)
    const seqs = events.map((e) => e.seq)
    assert.equal(seqs.length, N + 1) // the run_init seed + 20 appends
    // written under the lock, so file order IS seq order: 1..21, no dup, no gap
    assert.deepEqual(seqs, Array.from({ length: N + 1 }, (_, i) => i + 1))

    // the ledger terminates with a newline (no glued/truncated tail survived the race)
    assert.ok(readFileSync(join(kilnDir, 'events.jsonl'), 'utf8').endsWith('\n'))

    // projection matches the ledger: last_event_seq tracks the tail and validate is green
    assert.equal(readState(kilnDir).last_event_seq, N + 1)
    assert.equal(run('validate', kilnDir).status, 0)

    // the lock is released — the run dir holds only the two real surfaces
    assert.ok(!existsSync(join(kilnDir, '.state.lock')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// (a) Wedged lock: a lock owned by a DEAD pid is NOT stolen by append — it burns the deadline and
// dies with a diagnostic that names the lock path, the dead holder's pid, and the `unlock` recovery
// hint. Out-of-band `unlock` then clears it (holder not alive), and the next append lands clean.
test('wedged lock: a DEAD-pid lock blocks append until `unlock` clears it out-of-band', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(init(kilnDir).status, 0)
    const lockDir = join(kilnDir, '.state.lock')
    mkdirSync(lockDir)
    // a provably-dead pid: spawn a node that exits, then reuse its pid (recycling in-window is
    // astronomically unlikely and would only make the holder LOOK alive → a stricter assertion)
    const deadPid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: deadPid, ts: new Date().toISOString(), token: 'dead-holder' }))

    const started = Date.now()
    const blocked = run('append', kilnDir, '{"type":"note","stage":"build"}')
    const waited = Date.now() - started
    assert.equal(blocked.status, 1, blocked.stdout) // died, did not steal
    assert.ok(waited >= LOCK_DEADLINE_MS - 500, `must hold the full deadline, waited ${waited}ms`)
    assert.match(blocked.stderr, /could not acquire/)
    assert.match(blocked.stderr, new RegExp(`pid ${deadPid}`))
    assert.match(blocked.stderr, /kiln-state unlock/)
    // the ledger was untouched: the blocked append never wrote a seq 2
    assert.deepEqual(readEvents(kilnDir).map((e) => e.seq), [1])

    // out-of-band recovery: the holder is not alive, so unlock clears the lock
    const unlocked = run('unlock', kilnDir)
    assert.equal(unlocked.status, 0, unlocked.stderr)
    assert.ok(!existsSync(lockDir))

    // now the append lands
    const ok = run('append', kilnDir, '{"type":"note","stage":"build"}')
    assert.equal(ok.status, 0, ok.stderr)
    assert.equal(JSON.parse(ok.stdout).seq, 2)
    assert.deepEqual(readEvents(kilnDir).map((e) => e.seq), [1, 2])
    assert.equal(run('validate', kilnDir).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// (b) unlock refuses a LIVE holder: a lock owned by this (alive) test process must NOT be cleared —
// unlock exits nonzero and leaves the lock in place. This is the guard that keeps recovery from
// ever pulling a running writer's lock.
test('unlock refuses a live holder: a lock owned by an alive pid is left untouched, exit nonzero', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(init(kilnDir).status, 0)
    const lockDir = join(kilnDir, '.state.lock')
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), token: 'live-holder' }))

    const res = run('unlock', kilnDir)
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /LIVE process/)
    assert.ok(existsSync(lockDir)) // refused → lock untouched
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// (c) Write fence — cmdAppend re-reads owner.json and re-checks OUR token immediately before the
// ledger append AND before writeState, dying WITHOUT writing on a mismatch (see `lockStillOurs` +
// the two `lockStillOurs(lockDir, token)` guards in kiln-state.mjs cmdAppend). Deterministically
// swapping owner.json mid-write from a black-box CLI race is not achievable, and `lockStillOurs` is
// not exported for a unit test — so there is no honest end-to-end assertion to make. Kept as an
// explicit SKIP rather than a flaky or faked test; the fence is covered by code inspection.
test('fence: append re-verifies the token before each write', { skip: 'lockStillOurs not exported; a CLI race cannot deterministically swap owner.json mid-write' }, () => {})
