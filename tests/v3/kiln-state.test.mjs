// kiln-state.test.mjs — end-to-end floor for plugins/kiln/scripts/kiln-state.mjs (BLUEPRINT §4, §13).
// Spawns the real CLI against throwaway dirs: the contract under test is the command surface —
// exit codes included — exactly as agents drive it via Bash. Covers init/append/project/validate/
// summary, truncated-final-line recovery, corruption detection, and projection determinism.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-state.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })

// Every test gets a fresh sandbox; kilnDir does not pre-exist (init creates it).
const sandbox = () => mkdtempSync(join(tmpdir(), 'kiln-state-test-'))
const init = (kilnDir) => run('init', kilnDir, '--project-path', '/srv/demo', '--name', 'demo', '--type', 'node')
const readState = (kilnDir) => JSON.parse(readFileSync(join(kilnDir, 'state.json'), 'utf8'))
const readEvents = (kilnDir) => readFileSync(join(kilnDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('init: seeds events.jsonl with run_init seq 1 and projects state.json', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(init(kilnDir).status, 0)
    const events = readEvents(kilnDir)
    assert.equal(events.length, 1)
    assert.equal(events[0].seq, 1)
    assert.equal(events[0].type, 'run_init')
    assert.equal(events[0].stage, 'onboarding')
    assert.equal(events[0].git, null)
    const st = readState(kilnDir)
    assert.equal(st.schema, 3)
    assert.equal(st.stage, 'onboarding')
    assert.deepEqual(st.project, { name: 'demo', path: '/srv/demo', type: 'node', greenfield: true })
    assert.equal(st.last_event_seq, 1)
    assert.equal(st.started_at, events[0].ts)
    assert.equal(st.updated_at, events[0].ts)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('init: name defaults to the project-path basename; --greenfield false is honored', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(run('init', kilnDir, '--project-path', '/srv/legacy-app', '--greenfield', 'false').status, 0)
    const st = readState(kilnDir)
    assert.equal(st.project.name, 'legacy-app')
    assert.equal(st.project.greenfield, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('init: rejects a relative --project-path (usage, exit 2) and refuses to re-init a live ledger', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(run('init', kilnDir, '--project-path', 'relative/path').status, 2)
    assert.equal(init(kilnDir).status, 0)
    const res = init(kilnDir)
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /refusing to re-init/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('append: assigns seq + ts, echoes the event, and the projection folds it', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    const res = run('append', kilnDir, '{"type":"stage_started","stage":"brainstorm"}')
    assert.equal(res.status, 0)
    const ev = JSON.parse(res.stdout)
    assert.equal(ev.seq, 2)
    assert.match(ev.ts, /^\d{4}-\d{2}-\d{2}T/)
    assert.deepEqual(ev.data, {})
    assert.equal(ev.git, null)
    assert.equal(readState(kilnDir).stage, 'brainstorm')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('append: stage_completed sets last_completed_stage and bumps stage per the order table — the final stage never bumps', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"stage_completed","stage":"brainstorm"}')
    let st = readState(kilnDir)
    assert.equal(st.last_completed_stage, 'brainstorm')
    assert.equal(st.stage, 'gauge')
    run('append', kilnDir, '{"type":"stage_started","stage":"report"}')
    run('append', kilnDir, '{"type":"stage_completed","stage":"report"}')
    st = readState(kilnDir)
    assert.equal(st.last_completed_stage, 'report')
    assert.equal(st.stage, 'report') // final table entry — completing it bumps nothing
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('append: rejects caller-supplied seq/ts, unknown types, unknown keys, and non-JSON — ledger untouched', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    const bad = [
      '{"type":"note","stage":"build","seq":9}',
      '{"type":"note","stage":"build","ts":"2026-06-11T00:00:00Z"}',
      '{"type":"made_up_type","stage":"build"}',
      '{"type":"note","stage":"build","extra":1}',
      '{nope',
    ]
    for (const json of bad) assert.notEqual(run('append', kilnDir, json).status, 0, json)
    assert.equal(readEvents(kilnDir).length, 1) // nothing landed
    assert.equal(run('validate', kilnDir).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('projection: posture_set replaces, posture_escalated shallow-merges', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"posture_set","stage":"gauge","data":{"posture":{"rigor":"standard","browser":false}}}')
    assert.deepEqual(readState(kilnDir).posture, { rigor: 'standard', browser: false })
    run('append', kilnDir, '{"type":"posture_escalated","stage":"build","data":{"posture":{"rigor":"maximum"}}}')
    assert.deepEqual(readState(kilnDir).posture, { rigor: 'maximum', browser: false })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('projection: generic folds — capability replaces; milestones/counters merge known keys; paths shallow-merge', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"note","stage":"build","data":{"capability":{"tier":"full","verification_class":"browser","probes":{"node":true}},"milestones":{"count":4,"current":"m1"},"counters":{"build_iteration":2},"paths":{"plan":"/srv/demo/.kiln/master-plan.md"}}}')
    const st = readState(kilnDir)
    assert.deepEqual(st.capability, { tier: 'full', verification_class: 'browser', probes: { node: true } })
    assert.deepEqual(st.milestones, { count: 4, complete: 0, current: 'm1' })
    assert.deepEqual(st.counters, { correction_cycle: 0, build_iteration: 2 })
    assert.deepEqual(st.paths, { plan: '/srv/demo/.kiln/master-plan.md' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('project: deterministic — projecting twice yields byte-identical state.json', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"stage_completed","stage":"brainstorm"}')
    run('append', kilnDir, '{"type":"commit","stage":"build","git":"abc1234"}')
    assert.equal(run('project', kilnDir).status, 0)
    const first = readFileSync(join(kilnDir, 'state.json'), 'utf8')
    assert.equal(run('project', kilnDir).status, 0)
    assert.equal(readFileSync(join(kilnDir, 'state.json'), 'utf8'), first)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('truncated final line: project drops it with a warning; append heals the ledger before writing', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"stage_started","stage":"brainstorm"}')
    appendFileSync(join(kilnDir, 'events.jsonl'), '{"seq":3,"ts":"2026-06-1') // interrupted write
    const res = run('project', kilnDir)
    assert.equal(res.status, 0)
    assert.match(res.stderr, /truncated final line/)
    assert.equal(readState(kilnDir).last_event_seq, 2) // projected from the surviving prefix
    // append heals: the partial line is rewritten away, the new event takes seq 3
    const ap = run('append', kilnDir, '{"type":"note","stage":"brainstorm"}')
    assert.equal(ap.status, 0)
    assert.equal(JSON.parse(ap.stdout).seq, 3)
    assert.deepEqual(readEvents(kilnDir).map((e) => e.seq), [1, 2, 3])
    assert.equal(run('validate', kilnDir).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('unterminated final line that still parses: append restores the newline instead of gluing events', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    const file = join(kilnDir, 'events.jsonl')
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\n$/, '')) // write cut exactly before its '\n'
    const ap = run('append', kilnDir, '{"type":"note","stage":"onboarding"}')
    assert.equal(ap.status, 0)
    assert.deepEqual(readEvents(kilnDir).map((e) => e.seq), [1, 2]) // two lines — not one glued line
    assert.equal(run('validate', kilnDir).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a COMPLETE garbage final line is corruption, not truncation: project and validate refuse', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    appendFileSync(join(kilnDir, 'events.jsonl'), 'GARBAGE LINE\n') // newline-terminated: fully written
    const pr = run('project', kilnDir)
    assert.notEqual(pr.status, 0)
    assert.match(pr.stderr, /manual repair/)
    const val = run('validate', kilnDir)
    assert.notEqual(val.status, 0)
    assert.match(val.stderr, /manual repair/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('mid-ledger corruption (not the final line) is fatal, never guessed past', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"stage_started","stage":"brainstorm"}')
    const file = join(kilnDir, 'events.jsonl')
    const [first, second] = readFileSync(file, 'utf8').split('\n')
    writeFileSync(file, `${first}\nGARBAGE LINE\n${second}\n`)
    const res = run('project', kilnDir)
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /manual repair/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('validate: catches a seq gap in the ledger', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"stage_started","stage":"brainstorm"}')
    const file = join(kilnDir, 'events.jsonl')
    writeFileSync(file, readFileSync(file, 'utf8').replace('"seq":2', '"seq":3'))
    const res = run('validate', kilnDir)
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /breaks contiguity/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('validate: catches a hand-corrupted state.json — both schema violations and projection drift', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    const file = join(kilnDir, 'state.json')
    const pristine = readFileSync(file, 'utf8')
    // schema violation
    writeFileSync(file, pristine.replace('"schema": 3', '"schema": 2'))
    let res = run('validate', kilnDir)
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /schema must be 3/)
    // schema-valid but drifted from the projection — the ledger wins
    writeFileSync(file, pristine.replace('"stage": "onboarding"', '"stage": "report"'))
    res = run('validate', kilnDir)
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /does not match the projection/)
    // project rebuilds it green
    assert.equal(run('project', kilnDir).status, 0)
    assert.equal(run('validate', kilnDir).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('summary: renders the human view to stdout and writes NO file', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"stage_completed","stage":"brainstorm"}')
    const res = run('summary', kilnDir)
    assert.equal(res.status, 0)
    assert.match(res.stdout, /^# Kiln — demo/)
    assert.match(res.stdout, /\*\*Stage:\*\* gauge \(3\/8\)/)
    assert.match(res.stdout, /\*\*Posture:\*\* not yet gauged/)
    assert.deepEqual(readdirSync(kilnDir).sort(), ['events.jsonl', 'state.json'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('usage: missing or unknown commands exit 2', () => {
  assert.equal(run().status, 2)
  assert.equal(run('frobnicate', '/tmp/nowhere').status, 2)
})
