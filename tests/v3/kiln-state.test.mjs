// kiln-state.test.mjs — end-to-end floor for plugins/kiln/scripts/kiln-state.mjs.
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

// ── onboard: init + the capability note in ONE atomic birth leg (situation-map §6 item 13, NARROW) ──
const onboard = (kilnDir, ...extra) => run('onboard', kilnDir, '--project-path', '/srv/demo', '--name', 'demo', '--type', 'node', '--tier', 'T4', '--verification-class', 'full', '--probes', '{"codex":true,"playwright":true}', ...extra)

test('onboard: writes seq 1 run_init + seq 2 capability note atomically and projects the capability (incl. claude_head)', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(onboard(kilnDir, '--claude-head', 'fable').status, 0)
    const events = readEvents(kilnDir)
    assert.equal(events.length, 2)
    assert.equal(events[0].seq, 1); assert.equal(events[0].type, 'run_init'); assert.equal(events[0].stage, 'onboarding')
    assert.deepEqual(events[0].data.project, { name: 'demo', path: '/srv/demo', type: 'node', greenfield: true })
    assert.equal(events[1].seq, 2); assert.equal(events[1].type, 'note'); assert.equal(events[1].stage, 'onboarding')
    assert.equal(events[1].data.kind, 'capability')
    assert.deepEqual(events[1].data.capability, { tier: 'T4', verification_class: 'full', probes: { codex: true, playwright: true }, claude_head: 'fable' })
    const st = readState(kilnDir)
    assert.deepEqual(st.project, { name: 'demo', path: '/srv/demo', type: 'node', greenfield: true })
    assert.deepEqual(st.capability, { tier: 'T4', verification_class: 'full', probes: { codex: true, playwright: true }, claude_head: 'fable' })
    assert.equal(st.last_event_seq, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('onboard: --claude-head OMITTED ⇒ the capability note carries NO claude_head key and the ledger still validates (byte-compat)', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(onboard(kilnDir).status, 0)
    const cap = readEvents(kilnDir)[1].data.capability
    assert.ok(!('claude_head' in cap), 'no claude_head key when the flag is absent')
    assert.deepEqual(cap, { tier: 'T4', verification_class: 'full', probes: { codex: true, playwright: true } })
    assert.equal(run('validate', kilnDir).status, 0)
    assert.equal(readState(kilnDir).capability.claude_head, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('onboard: the ledger passes validate (seq contiguity 1..2, projection in sync)', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(onboard(kilnDir, '--claude-head', 'opus').status, 0)
    const res = run('validate', kilnDir)
    assert.equal(res.status, 0)
    assert.match(res.stdout, /seq 1\.\.2/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('onboard: refuses over a live events.jsonl (exit 1); usage errors on relative/missing project-path and malformed --probes (exit 2); unknown flag (exit 2)', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(onboard(kilnDir).status, 0)
    const again = onboard(kilnDir)
    assert.equal(again.status, 1, 'a second onboard over a live ledger refuses')
    assert.match(again.stderr, /refusing to onboard over a live ledger/)
    const d2 = sandbox()
    assert.equal(run('onboard', join(d2, '.kiln'), '--project-path', 'rel/path').status, 2, 'relative project-path is a usage error')
    assert.equal(run('onboard', join(d2, '.kiln')).status, 2, 'missing project-path is a usage error')
    assert.equal(run('onboard', join(d2, '.kiln'), '--project-path', '/srv/x', '--probes', '{bad').status, 2, 'malformed --probes is a usage error')
    assert.equal(run('onboard', join(d2, '.kiln'), '--project-path', '/srv/x', '--claude-head', 'gpt').status, 2, '--claude-head takes fable|opus only')
    assert.equal(run('onboard', join(d2, '.kiln'), '--project-path', '/srv/x', '--bogus', '1').status, 2, 'an unknown flag is a usage error')
    rmSync(d2, { recursive: true, force: true })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('onboard GOLDEN: the seq-2 note AND stdout are BYTE-SHAPE identical to running init + append separately (observable-contract parity; resume/succession consistency)', () => {
  const a = sandbox(); const b = sandbox()
  const aKiln = join(a, '.kiln'); const bKiln = join(b, '.kiln')
  try {
    // onboard's atomic leg
    const onb = run('onboard', aKiln, '--project-path', '/srv/demo', '--name', 'demo', '--type', 'node', '--greenfield', 'true', '--tier', 'T4', '--verification-class', 'full', '--probes', '{"codex":true,"playwright":true}', '--claude-head', 'fable')
    assert.equal(onb.status, 0)
    // the SKILL's documented hand path: init, then append the literal capability JSON the SKILL:71/:381 write
    const ini = run('init', bKiln, '--project-path', '/srv/demo', '--name', 'demo', '--type', 'node', '--greenfield', 'true')
    assert.equal(ini.status, 0)
    const app = run('append', bKiln, '{"type":"note","stage":"onboarding","data":{"kind":"capability","capability":{"tier":"T4","verification_class":"full","probes":{"codex":true,"playwright":true},"claude_head":"fable"}}}')
    assert.equal(app.status, 0)
    const onboardData = readEvents(aKiln)[1].data
    const skillData = readEvents(bKiln)[1].data
    assert.equal(JSON.stringify(onboardData), JSON.stringify(skillData), 'the folded onboard note must be byte-identical to the SKILL hand-written note — the latest-wins projection folds them interchangeably')
    // STDOUT parity: onboard emits EXACTLY init's confirmation line + append's echoed event JSON — no
    // novel 'onboarded' line. Normalize the kilnDir path (line 1) and the self-assigned ts (line 2),
    // then the folded and unfolded stdout must be byte-identical.
    const onbLines = onb.stdout.split('\n').filter(Boolean)
    assert.equal(onbLines.length, 2, 'onboard emits two lines — the init confirmation and the append event JSON')
    const stripTs = (s) => s.replace(/"ts":"[^"]*"/, '"ts":"TS"')
    const stripDir = (s, dir) => s.split(dir).join('KILN')
    assert.equal(stripDir(onbLines[0], aKiln), stripDir(ini.stdout.trim(), bKiln), 'onboard line 1 is init\'s initialized-confirmation line verbatim (byte-shape parity)')
    assert.equal(stripTs(onbLines[1]), stripTs(app.stdout.trim()), 'onboard line 2 is append\'s assigned-event JSON verbatim (byte-shape parity)')
    assert.doesNotMatch(onb.stdout, /onboarded/, 'no novel "onboarded" line — the folded legs preserve the unfolded observable contract')
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }) }
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

test('append: the workflow stage brackets fold per the order table — gauge→research, build→validate, validate→report', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    // gauge bracket: stage_started sets the stage, stage_completed bumps to the next entry
    run('append', kilnDir, '{"type":"stage_started","stage":"gauge"}')
    assert.equal(readState(kilnDir).stage, 'gauge')
    run('append', kilnDir, '{"type":"stage_completed","stage":"gauge"}')
    let st = readState(kilnDir)
    assert.equal(st.last_completed_stage, 'gauge')
    assert.equal(st.stage, 'research')
    // build bracket: started sets 'build', completed bumps to 'validate' (the flagged consumer fold)
    run('append', kilnDir, '{"type":"stage_started","stage":"build"}')
    assert.equal(readState(kilnDir).stage, 'build')
    run('append', kilnDir, '{"type":"stage_completed","stage":"build"}')
    st = readState(kilnDir)
    assert.equal(st.last_completed_stage, 'build')
    assert.equal(st.stage, 'validate')
    // validate bracket: started sets 'validate', completed bumps to 'report'
    run('append', kilnDir, '{"type":"stage_started","stage":"validate"}')
    assert.equal(readState(kilnDir).stage, 'validate')
    run('append', kilnDir, '{"type":"stage_completed","stage":"validate"}')
    st = readState(kilnDir)
    assert.equal(st.last_completed_stage, 'validate')
    assert.equal(st.stage, 'report')
    assert.equal(run('validate', kilnDir).status, 0)
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

test('capability.claude_head: persists and projects latest-wins when the note carries it; validate accepts it', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"note","stage":"onboarding","data":{"kind":"capability","capability":{"tier":"T4","verification_class":"full","probes":{"codex":true},"claude_head":"opus"}}}')
    assert.deepEqual(readState(kilnDir).capability, { tier: 'T4', verification_class: 'full', probes: { codex: true }, claude_head: 'opus' })
    // latest-wins: a fresh capability note supersedes the head
    run('append', kilnDir, '{"type":"note","stage":"gauge","data":{"kind":"capability","capability":{"tier":"T4","verification_class":"full","probes":{"codex":true},"claude_head":"fable"}}}')
    assert.equal(readState(kilnDir).capability.claude_head, 'fable')
    assert.equal(run('validate', kilnDir).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('capability.claude_head: a record WITHOUT it stays valid and adds no key (byte-compatible with every pre-succession ledger)', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"note","stage":"onboarding","data":{"kind":"capability","capability":{"tier":"T3","verification_class":"full","probes":{"codex":true}}}}')
    const cap = readState(kilnDir).capability
    assert.deepEqual(cap, { tier: 'T3', verification_class: 'full', probes: { codex: true } })
    assert.equal('claude_head' in cap, false)
    assert.equal(run('validate', kilnDir).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('capability.claude_head: an illegal value is rejected by validate (exit 1, named)', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"note","stage":"onboarding","data":{"kind":"capability","capability":{"tier":"T4","verification_class":"full","probes":{},"claude_head":"sonnet"}}}')
    const res = run('validate', kilnDir)
    assert.equal(res.status, 1)
    assert.match(res.stderr, /capability\.claude_head must be 'fable' or 'opus'/)
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

// ── since: the read-only story-telegraph tail ────────────────────────────────────────

test('since: missing events.jsonl ⇒ exit 0 with {events:[],last_seq:null,truncated:false}, no write', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    const res = run('since', kilnDir, '0') // kilnDir never created
    assert.equal(res.status, 0)
    assert.deepEqual(JSON.parse(res.stdout), { events: [], last_seq: null, truncated: false })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('since: no events after the cursor ⇒ empty batch, last_seq is the ledger tail', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir) // seq 1 only
    const out = JSON.parse(run('since', kilnDir, '1').stdout)
    assert.deepEqual(out.events, [])
    assert.equal(out.last_seq, 1) // tail — the cursor advances even with nothing new
    assert.equal(out.truncated, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('since: returns only events after the cursor, in seq order, last_seq = tail', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"stage_started","stage":"brainstorm"}') // seq 2
    run('append', kilnDir, '{"type":"note","stage":"brainstorm","data":{"kind":"lore","message":"beat"}}') // seq 3
    const after1 = JSON.parse(run('since', kilnDir, '1').stdout)
    assert.deepEqual(after1.events.map((e) => e.seq), [2, 3])
    assert.equal(after1.last_seq, 3)
    assert.equal(after1.truncated, false)
    const after3 = JSON.parse(run('since', kilnDir, '3').stdout)
    assert.deepEqual(after3.events, [])
    const fromZero = JSON.parse(run('since', kilnDir, '0').stdout)
    assert.deepEqual(fromZero.events.map((e) => e.seq), [1, 2, 3]) // run_init included
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('since --kind: filters note events by data.kind; structural (non-note) events always pass', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"note","stage":"build","data":{"kind":"lore","message":"forged"}}') // seq 2
    run('append', kilnDir, '{"type":"note","stage":"build","data":{"kind":"divergence","message":"noise"}}') // seq 3
    run('append', kilnDir, '{"type":"stage_completed","stage":"build"}') // seq 4 — lifecycle, not a kind
    const lore = JSON.parse(run('since', kilnDir, '1', '--kind', 'lore').stdout)
    assert.deepEqual(lore.events.map((e) => e.seq), [2, 4]) // lore note + stage_completed pass; divergence dropped
    assert.equal(lore.events[0].data.kind, 'lore')
    assert.ok(lore.events.some((e) => e.type === 'stage_completed'), 'stage_completed must survive the kind filter')
    assert.ok(!lore.events.some((e) => e.data && e.data.kind === 'divergence'), 'a non-matching note kind is filtered out')
    // multi-kind: both note kinds return (plus the structural event)
    const multi = JSON.parse(run('since', kilnDir, '1', '--kind', 'lore,divergence').stdout)
    assert.deepEqual(multi.events.map((e) => e.seq), [2, 3, 4])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('since --limit: caps the batch and reports truncated with a resumable last_seq', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    for (let i = 0; i < 4; i++) run('append', kilnDir, '{"type":"note","stage":"build","data":{"kind":"lore"}}') // seq 2..5
    const first = JSON.parse(run('since', kilnDir, '1', '--kind', 'lore', '--limit', '2').stdout)
    assert.deepEqual(first.events.map((e) => e.seq), [2, 3])
    assert.equal(first.truncated, true)
    assert.equal(first.last_seq, 3) // resume from the last DELIVERED event, not the tail
    const rest = JSON.parse(run('since', kilnDir, String(first.last_seq), '--kind', 'lore', '--limit', '2').stdout)
    assert.deepEqual(rest.events.map((e) => e.seq), [4, 5])
    assert.equal(rest.truncated, false)
    assert.equal(rest.last_seq, 5)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('since: a torn (unterminated) final line is skipped, never errors, and nothing is written', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    run('append', kilnDir, '{"type":"note","stage":"build","data":{"kind":"lore"}}') // seq 2
    appendFileSync(join(kilnDir, 'events.jsonl'), '{"seq":3,"ts":"2026-06-1') // interrupted append, no newline
    const res = run('since', kilnDir, '0')
    assert.equal(res.status, 0)
    assert.deepEqual(JSON.parse(res.stdout).events.map((e) => e.seq), [1, 2]) // torn tail dropped
    assert.ok(!readdirSync(kilnDir).includes('.state.lock'), 'since must take no lock')
    // read-only: the torn bytes are still on disk (since heals nothing)
    assert.match(readFileSync(join(kilnDir, 'events.jsonl'), 'utf8'), /\{"seq":3,"ts":"2026-06-1$/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('since: bad usage — missing afterSeq, non-integer cursor, unknown flag, bad --limit exit 2', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    assert.equal(run('since', kilnDir).status, 2)
    assert.equal(run('since', kilnDir, 'abc').status, 2)
    assert.equal(run('since', kilnDir, '1', '--nope', 'x').status, 2)
    assert.equal(run('since', kilnDir, '1', '--limit', '0').status, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── since tail: the cursor-bootstrap form ───────────────────────────────────────

test('since tail: delivers nothing and returns the TRUE ledger tail — never a truncated first seq', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    for (let i = 0; i < 4; i++) run('append', kilnDir, '{"type":"note","stage":"build","data":{"kind":"lore"}}') // seq 2..5
    const res = run('since', kilnDir, 'tail')
    assert.equal(res.status, 0)
    assert.deepEqual(JSON.parse(res.stdout), { events: [], last_seq: 5, truncated: false })
    // the contrast that motivated the form: a capped numeric query stops at its first delivered seq
    assert.equal(JSON.parse(run('since', kilnDir, '0', '--limit', '1').stdout).last_seq, 1)
    // missing file: same null shape as the numeric form
    assert.deepEqual(JSON.parse(run('since', join(dir, 'nowhere'), 'tail').stdout), { events: [], last_seq: null, truncated: false })
    // no flags on the tail form
    assert.equal(run('since', kilnDir, 'tail', '--limit', '1').status, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('cursor bootstrap: fresh-v3 (cursor 0) and v2-resume (absent) capture the tail and replay NOTHING', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    // a multi-event historical ledger — the replay hazard both first-use paths shared
    for (let i = 0; i < 5; i++) run('append', kilnDir, '{"type":"note","stage":"build","data":{"kind":"lore","message":"old beat"}}') // seq 2..6
    run('append', kilnDir, '{"type":"stage_completed","stage":"build"}') // seq 7
    // the SKILL recipe: 0 / absent / non-integer are ALL uncaptured ⇒ resolve via the tail form
    const cursor = JSON.parse(run('since', kilnDir, 'tail').stdout).last_seq
    assert.equal(cursor, 7)
    // first wake from the captured cursor: zero historical events replayed
    assert.deepEqual(JSON.parse(run('since', kilnDir, String(cursor), '--kind', 'lore').stdout).events, [])
    // new beats after capture are delivered exactly once
    run('append', kilnDir, '{"type":"note","stage":"validate","data":{"kind":"lore","message":"new beat"}}') // seq 8
    const wake = JSON.parse(run('since', kilnDir, String(cursor), '--kind', 'lore').stdout)
    assert.deepEqual(wake.events.map((e) => e.seq), [8])
    assert.equal(wake.last_seq, 8)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('since: an empty or fully-torn ledger degrades to the missing-file shape, exit 0 (fail-soft)', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    const file = join(kilnDir, 'events.jsonl')
    // empty file — readLedger would refuse; since degrades
    writeFileSync(file, '')
    let res = run('since', kilnDir, '0')
    assert.equal(res.status, 0)
    assert.deepEqual(JSON.parse(res.stdout), { events: [], last_seq: null, truncated: false })
    // fully-torn: a single unterminated partial line, nothing valid survives
    writeFileSync(file, '{"seq":1,"ts":"2026-06-1')
    res = run('since', kilnDir, '0')
    assert.equal(res.status, 0)
    assert.deepEqual(JSON.parse(res.stdout), { events: [], last_seq: null, truncated: false })
    // the tail form degrades identically
    res = run('since', kilnDir, 'tail')
    assert.equal(res.status, 0)
    assert.deepEqual(JSON.parse(res.stdout), { events: [], last_seq: null, truncated: false })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('notification-first closure across consecutive stages: the final drain isolates the stages', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    // research runs; the tail's cursor sits at seq 1 when the completion notification arrives FIRST
    run('append', kilnDir, '{"type":"note","stage":"research","data":{"kind":"lore","message":"field work"}}') // seq 2
    run('append', kilnDir, '{"type":"stage_completed","stage":"research"}') // seq 3
    // the close-out drain at notification close (one fetch suffices here — the under-limit case;
    // the >limit drain-LOOP boundary is the next test): leftovers rendered, cursor advanced past
    // the completed stage's events — INCLUDING its stage_completed
    const drain = JSON.parse(run('since', kilnDir, '1', '--kind', 'lore').stdout)
    assert.deepEqual(drain.events.map((e) => e.seq), [2, 3])
    assert.equal(drain.events[1].type, 'stage_completed')
    assert.equal(drain.events[1].stage, 'research') // the match rule: terminate only on the ACTIVE stage's completion
    const cursor = drain.last_seq
    assert.equal(cursor, 3)
    // architecture launches from the drained cursor: the prior stage's completion event is BEHIND
    // the cursor, so the new telegraph can neither close on it nor misattribute research's beats
    run('append', kilnDir, '{"type":"note","stage":"architecture","data":{"kind":"lore","message":"laying stone"}}') // seq 4
    const next = JSON.parse(run('since', kilnDir, String(cursor), '--kind', 'lore').stdout)
    assert.deepEqual(next.events.map((e) => e.seq), [4])
    assert.ok(!next.events.some((e) => e.type === 'stage_completed'), 'the prior stage_completed must not reappear')
    assert.ok(next.events.every((e) => e.stage === 'architecture'), 'no prior-stage beats misattributed')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('drain-loop boundary (r3): more unread events than --limit — loop while truncated + completion unconsumed, then the stages stay isolated', () => {
  const dir = sandbox(); const kilnDir = join(dir, '.kiln')
  try {
    init(kilnDir)
    // 7 research beats + the completion = 8 unread events, drained with --limit 3 — Sol's r2 hazard:
    // a single capped fetch strands a prior-stage beat AND the completion for the next telegraph
    for (let i = 0; i < 7; i++) run('append', kilnDir, `{"type":"note","stage":"research","data":{"kind":"lore","message":"beat ${i}"}}`) // seq 2..8
    run('append', kilnDir, '{"type":"stage_completed","stage":"research"}') // seq 9
    // the SKILL close-out loop: REPEAT since WHILE truncated AND the active completion is unconsumed
    let cursor = 1
    let fetches = 0
    let consumedCompletion = false
    for (;;) {
      const batch = JSON.parse(run('since', kilnDir, String(cursor), '--kind', 'lore', '--limit', '3').stdout)
      fetches++
      assert.ok(batch.events.every((e) => e.stage === 'research'), 'every drained event belongs to the completed stage')
      if (batch.events.some((e) => e.type === 'stage_completed' && e.stage === 'research')) consumedCompletion = true
      cursor = batch.last_seq
      if (!(batch.truncated && !consumedCompletion)) break
    }
    assert.equal(consumedCompletion, true, 'the drain must consume the active stage_completed')
    assert.equal(cursor, 9, 'the cursor persists only at the ledger tail — past the completion')
    assert.equal(fetches, 3, '8 events at limit 3 ⇒ exactly three close-out fetches')
    // the next stage's telegraph starts from the drained cursor: nothing of research remains ahead
    run('append', kilnDir, '{"type":"note","stage":"architecture","data":{"kind":"lore","message":"laying stone"}}') // seq 10
    const next = JSON.parse(run('since', kilnDir, String(cursor), '--kind', 'lore').stdout)
    assert.deepEqual(next.events.map((e) => e.seq), [10])
    assert.ok(next.events.every((e) => e.stage === 'architecture'), 'no prior-stage beat renders under the next stage')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('usage: missing or unknown commands exit 2', () => {
  assert.equal(run().status, 2)
  assert.equal(run('frobnicate', '/tmp/nowhere').status, 2)
})
