// migration-inflight.test.mjs — the GENERIC v3.0.1 in-flight run resume/migration fixture.
// The invariant: resume under v3.0.2 must be explicitly safe or explicitly refused with
// guidance. A run authored under v3.0.1 is mid-build.
//
// The fixture is HISTORICALLY FAITHFUL to what a v3.0.1 run actually leaves on disk:
// · STATE.md — the conductor's control plane and the RESUME AUTHORITY (SKILL "Resume routing
//     keys off STATE.md"). The v3.0.1 conductor rewrote it at every transition; mid-build it records
//     stage: build, last_completed_stage: architecture — the human-facing progression.
//   · events.jsonl — the ledger's own projection surface, rebuilt as the EXACT sequence the v3.0.1
//     workflows emit (receipts by `git show v3.0.1:...`): run_init, then the brainstorm stage
//     bracketed via the vision-compile leg (stage_started{leg:'vision-compile'} → vision_compiled →
//     stage_completed, vision.js:93/222/223), then gauge bracketed with posture_set
//     (stage_started/posture_set/stage_completed, gauge.js:125/218/222). research and architecture
//     emitted NO stage brackets (those arrived in v3.0.2 — `git show v3.0.1:plugins/kiln/workflows-src/
//     {research,architecture}.js` carry no ledger append). build had STARTED (stage_started then the
//     pre-flight browser_sweep, build.js:974/764) with no completion. NO v3.0.1 workflow appends a
//     `commit` event, so there is no commit row. There is NO council_state checkpoint anywhere — the
//     twin council did not exist in v3.0.1.
//
// Resumed under v3.0.2, three behaviors must route it HONESTLY:
//   · the STATE.md routing contract — STATE.md is the resume authority; its stage: build routes the
//     conductor INTO build, and the completed architecture stage is never re-opened. The state.json
//     PROJECTION is the ledger's own view (stage build / last_completed_stage gauge — gauge is the
//     last stage that bracketed complete: brainstorm bracketed before it, research/architecture
//     emitted none); it is internally consistent and validates clean, but it is NOT the resume
//     signal, and it fabricates nothing v3.0.1 never emitted.
//   · build-detection — the legacy-plan hook's detection contract (build.js:1278: collect every note
//     event whose data.kind==='council_state' AND data.status==='sealed') yields [] over a real
//     v3.0.1 ledger ⇒ the plan is detected legacy_authority (fail TOWARD retrospective ratification,
//     never a silent v3.0.1-style advance). A v3.0.2-native ledger carrying a sealed master_plan
//     RATIFIED note yields a non-empty set ⇒ the hook does NOT fire (no false legacy detection).
//
// The fixture is a real .kiln directory written by the trusted kiln-state CLI exactly as agents drive
// it (spawnSync, exit codes included), plus a faithful STATE.md. detectSealedCouncil is the JS mirror
// of the thoth:council-legacy prose contract; build-spine.test.mjs imports writeInflightV301 +
// detectSealedCouncil + readEventsText and feeds the REAL fixture bytes through the mocked build
// harness to close the detection→hook loop end-to-end.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { posture as computePosture, validateProfile } from '../../plugins/kiln/src/gauge.mjs'

const CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-state.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
// The Gauge's ONE versioned config — the posture mapping's thresholds. Loaded from the canonical
// file (byte-identical to v3.0.1) so the fixture's posture_set is the deterministic producer output.
const GAUGE_CONFIG = JSON.parse(readFileSync(fileURLToPath(new URL('../../plugins/kiln/gauge-config.json', import.meta.url)), 'utf8'))
const readState = (kilnDir) => JSON.parse(readFileSync(join(kilnDir, 'state.json'), 'utf8'))
export const readEventsText = (kilnDir) => readFileSync(join(kilnDir, 'events.jsonl'), 'utf8')

// A faithful v3.0.1 STATE.md (schema_version 2) for a run stopped mid-build. The conductor rewrites
// STATE.md at every transition, so mid-build it records stage: build with last_completed_stage:
// architecture — the human-facing progression the resume authority reads. Byte-shaped as the v3.0.1
// `templates/STATE.md` the conductor filled (field names + markdown bullet format machine-read).
const STATE_MD_INFLIGHT = `# Kiln State

This file is the Kiln control plane — the conductor reads it on every invocation to
resume, and rewrites it on every stage transition. It is the single source of truth;
the operator session holds no durable pipeline state.
Every field below is required and machine-read.
Keep the field names and markdown bullet format unchanged.

## Schema

- **schema_version**: 2
- **stage**: build
- **mode**: interactive
- **plan_approval**: gated
- **testing_rigor**: standard
- **last_completed_stage**: architecture
- **next_action**: Resume the build stage — continue from the last committed milestone slice.
- **started_at**: 2026-06-20T10:00:00.000Z
- **updated_at**: 2026-06-20T12:30:00.000Z

## Project

- **project_name**: inflight
- **project_path**: /srv/inflight
- **project_type**: node
- **greenfield**: true

## Execution

- **build_iteration**: 1
- **correction_cycle**: 0
- **milestone_count**: 3
- **milestones_complete**: 0
- **current_milestone**: M1
- **validation_routing_target**: build
- **last_approval_checkpoint**: architecture
- **posture**: standard build; cross-family review

## Required Artifacts

- **state_file**: .kiln/STATE.md
- **resume_file**: .kiln/resume.md
- **project_brief_file**: .kiln/docs/project-brief.md
- **vision_file**: .kiln/docs/VISION.md
- **research_file**: .kiln/docs/research.md
- **architecture_file**: .kiln/docs/architecture.md
- **master_plan_file**: .kiln/master-plan.md
- **architecture_handoff_file**: .kiln/architecture-handoff.md
- **build_plan_file**: .kiln/build-plan.md
- **validation_report_file**: .kiln/validation/report.md
- **report_file**: .kiln/REPORT.md

## Supporting Artifacts

- **open_questions_file**: .kiln/docs/open-questions.md
- **decisions_file**: .kiln/docs/decisions.md
- **brainstorm_ledger_file**: .kiln/docs/brainstorm-ledger.jsonl
- **codebase_map_file**: .kiln/docs/codebase-map.md
- **correction_tasks_file**: .kiln/validation/correction-tasks.md
- **runtime_dir**: .kiln/runtime

## Step Timing

- **step_onboarding_started_at**: 2026-06-20T10:00:00.000Z
- **step_onboarding_completed_at**: 2026-06-20T10:05:00.000Z
- **step_brainstorm_started_at**: 2026-06-20T10:05:00.000Z
- **step_brainstorm_completed_at**: 2026-06-20T10:40:00.000Z
- **step_gauge_started_at**: 2026-06-20T10:40:00.000Z
- **step_gauge_completed_at**: 2026-06-20T10:50:00.000Z
- **step_research_started_at**: 2026-06-20T10:50:00.000Z
- **step_research_completed_at**: 2026-06-20T11:20:00.000Z
- **step_architecture_started_at**: 2026-06-20T11:20:00.000Z
- **step_architecture_completed_at**: 2026-06-20T12:00:00.000Z
- **step_build_started_at**: 2026-06-20T12:00:00.000Z
- **step_build_completed_at**: pending
- **step_validate_started_at**: pending
- **step_validate_completed_at**: pending
- **step_report_started_at**: pending
- **step_report_completed_at**: pending
`

// parseStateField — read one machine-read bullet from a STATE.md (the conductor's field format).
export const parseStateField = (md, field) => {
  const m = md.match(new RegExp(`^- \\*\\*${field}\\*\\*: (.+)$`, 'm'))
  return m ? m[1].trim() : null
}
// the STATE.md routing contract (SKILL): resume routing keys off STATE.md — the conductor resumes
// INTO the stage STATE.md names; a completed stage is never re-opened, so the resume target IS `stage`.
export const resumeTargetFromStateMd = (md) => parseStateField(md, 'stage')

// detectSealedCouncil — the JS mirror of the thoth:council-legacy detection contract (build.js:1278):
// each line is a JSON event; collect EVERY note event with data.kind==='council_state' AND
// data.status==='sealed', returning the data objects verbatim. This is exactly what the mocked
// build harness receives as `checkpoints`; an empty result is the legacy trigger.
export const detectSealedCouncil = (eventsText) =>
  eventsText
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === 'note' && e.data && e.data.kind === 'council_state' && e.data.status === 'sealed')
    .map((e) => e.data)

// writeInflightV301 — a HISTORICALLY FAITHFUL .kiln for a v3.0.1 run stopped mid-build, built as the
// EXACT ordered sequence the v3.0.1 tag's workflows emit (receipts by `git show v3.0.1:...`):
//   1. run_init                                         — kiln-state init (seq 1)
//   2. stage_started brainstorm {leg:'vision-compile'}  — vision.js:93 (the compile leg brackets the
//   3. vision_compiled brainstorm {tier,counts,…}       —   brainstorm stage; vision.js:222 emits
//   4. stage_completed brainstorm                       —   vision_compiled THEN the bracket, vision.js:223
//   5. stage_started gauge                              — gauge.js:125
//   6. posture_set gauge {posture,profile,…}            — gauge.js:218
//   7. stage_completed gauge                            — gauge.js:222
//   ── research + architecture emit NO ledger events in v3.0.1 (their brackets arrived in v3.0.2) ──
//   8. stage_started build {stage,gate_only}            — build.js:974
//   9. browser_sweep build {when:'pre-flight',token,…}  — build.js:764 via stageSweep('pre-flight'),
//                                                          immediately after the bracket (build.js:979)
// The build never finished (no stage_completed build), and NO v3.0.1 workflow appends a `commit`
// event — so there is no commit row. There is NO council_state note (the twin council did not exist
// in v3.0.1). A faithful STATE.md (the resume authority) is written alongside. Returns the sandbox
// root (caller removes it), the kilnDir, and the STATE.md text.
export function writeInflightV301(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-mig-'))
  const kilnDir = join(dir, '.kiln')
  assert.equal(run('init', kilnDir, '--project-path', '/srv/inflight', '--name', 'inflight', '--type', 'node').status, 0, 'v3.0.1 fixture init (run_init seq 1)')
  // brainstorm — the vision-compile leg brackets the brainstorm stage and emits vision_compiled on
  // the clean path: stage_started(leg vision-compile) → vision_compiled → stage_completed (vision.js:93/222/223).
  // The vision_compiled data is producer-faithful (vision.js:222 threads it from the kiln-vision
  // validate SUCCESS summary, kiln-vision.mjs:149-155): counts holds the line-grammar family keys
  // (frs/scs/stories/assumptions/open_questions), each a NUMBER; visual_direction is boolean|null
  // (kiln-vision.mjs:152 — false ⇔ the Visual Direction decline line); unresolved is the NUMBER of
  // body clarification markers (kiln-vision.mjs:132/154 — zero on a gated VISION).
  assert.equal(run('append', kilnDir, JSON.stringify({ type: 'stage_started', stage: 'brainstorm', data: { leg: 'vision-compile' } })).status, 0, 'brainstorm stage_started (vision-compile leg)')
  assert.equal(run('append', kilnDir, JSON.stringify({ type: 'vision_compiled', stage: 'brainstorm', data: { tier: 'standard', counts: { frs: 5, scs: 6, stories: 4, assumptions: 3, open_questions: 2 }, visual_direction: false, unresolved: 0 } })).status, 0, 'vision_compiled')
  assert.equal(run('append', kilnDir, JSON.stringify({ type: 'stage_completed', stage: 'brainstorm', data: {} })).status, 0, 'brainstorm stage_completed')
  // gauge — Thoth brackets the stage and appends posture_set (gauge.js:125/218/222). research and
  // architecture wrote NO ledger events (their stage brackets arrived in v3.0.2).
  const profile = {}
  for (const k of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']) profile[k] = { score: 1, evidence: `${k} scored mid (1) from VISION` }
  assert.ok(validateProfile(profile).ok, 'the all-mid gauge profile is a legal input to posture()')
  // The posture is COMPUTED by the v3.0.1 mapping itself (src/gauge.mjs posture() + gauge-config.json,
  // both byte-for-byte identical to the v3.0.1 tag) — nothing hand-invented. The all-mid profile
  // deterministically yields the posture: scope_tier 'standard', planning 'dual' (D3>=1 AND
  // D1>=1), research_topics_max 4 (2+D3+D5), plan_validation_rounds 2 (1 + D2>=1), slice_budget_hours
  // 0.5 (2·0.5·0.5, D7>=1 halves it), review.ui_effort_base 'high' (D8>=1), browser Tier-2 enabled
  // (D7>=1), with milestone_gate and validate present. gauge.js:217 wraps it as the posture_set data.
  const postureData = { posture: computePosture(profile, GAUGE_CONFIG), profile, override_applied: null, source: 'single_scorer' }
  assert.equal(run('append', kilnDir, JSON.stringify({ type: 'stage_started', stage: 'gauge', data: {} })).status, 0, 'gauge stage_started')
  assert.equal(run('append', kilnDir, JSON.stringify({ type: 'posture_set', stage: 'gauge', data: postureData })).status, 0, 'gauge posture_set')
  assert.equal(run('append', kilnDir, JSON.stringify({ type: 'stage_completed', stage: 'gauge', data: {} })).status, 0, 'gauge stage_completed')
  // build STARTED — stage_started (build.js:974) then the pre-flight browser_sweep immediately after
  // the bracket (build.js:764/979). NO stage_completed build (the run stopped mid-build); NO commit row.
  assert.equal(run('append', kilnDir, JSON.stringify({ type: 'stage_started', stage: 'build', data: { stage: 'build', gate_only: false } })).status, 0, 'build stage_started')
  assert.equal(run('append', kilnDir, JSON.stringify({ type: 'browser_sweep', stage: 'build', data: { stage: 'build', when: 'pre-flight', token: 'kbuild-inflight', leak_suspects: 0, leak_profile_dirs: 0 } })).status, 0, 'build pre-flight browser_sweep')
  if (over.sealCouncil) {
    assert.equal(run('append', kilnDir, JSON.stringify({ type: 'note', stage: 'build', data: { kind: 'council_state', keystone_id: 'master_plan', phase: 'RATIFIED', status: 'sealed' } })).status, 0, 'v3.0.2-native council seal')
  }
  writeFileSync(join(kilnDir, 'STATE.md'), STATE_MD_INFLIGHT)
  return { dir, kilnDir, stateMd: STATE_MD_INFLIGHT }
}

// ── the STATE.md routing contract: STATE.md is the resume authority; stage build ⇒ resume into build ──
test('v3.0.1 in-flight migration — the STATE.md routing contract: STATE.md (SKILL resume authority) records stage: build, so the v3.0.2 conductor resumes INTO build and never re-opens the completed architecture stage; the AUTHENTIC v3.0.1 ledger validates clean under v3.0.2', () => {
  const { dir, kilnDir, stateMd } = writeInflightV301()
  try {
    // the resume authority is STATE.md — the conductor register — not the state.json projection
    assert.equal(parseStateField(stateMd, 'stage'), 'build', 'STATE.md records stage: build')
    assert.equal(parseStateField(stateMd, 'last_completed_stage'), 'architecture', 'STATE.md carries the human-facing progression: architecture completed before build began')
    assert.equal(resumeTargetFromStateMd(stateMd), 'build', 'the STATE.md routing contract resumes INTO build — the completed architecture stage is never re-opened')
    // the kiln-state validate floor: the AUTHENTIC v3.0.1 ledger is internally consistent under v3.0.2
    const v = run('validate', kilnDir)
    assert.equal(v.status, 0, `a v3.0.1 in-flight ledger validates clean under the v3.0.2 kiln-state: ${v.stdout}${v.stderr}`)
    // the ledger's OWN projection is honest about what v3.0.1 actually bracketed: brainstorm and
    // gauge did, research and architecture did NOT (no fabricated completion events), build started —
    // so state.json rests at stage build / last_completed_stage gauge. state.json is the ledger's
    // view, NOT the resume signal; STATE.md (last_completed_stage architecture) is.
    const st = readState(kilnDir)
    assert.equal(st.schema, 3, 'the v3.0.1 ledger already carries the schema-3 state shape (no state migration needed)')
    assert.equal(st.stage, 'build', 'the build stage_started projects stage: build')
    assert.equal(st.last_completed_stage, 'gauge', 'gauge is the last stage that bracketed complete in v3.0.1 (brainstorm bracketed before it; research/architecture emitted no completion events), so the ledger projection rests at gauge (honest, not fabricated)')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── build-detection: the legacy-plan hook's detection contract sees NO council checkpoint ──
test('v3.0.1 in-flight migration: the thoth:council-legacy detection contract over the REAL v3.0.1 ledger BYTES yields [] ⇒ the plan is detected legacy_authority (never a silent v3.0.1-style advance)', () => {
  const { dir, kilnDir } = writeInflightV301()
  try {
    const events = readEventsText(kilnDir)
    assert.ok(!/"kind":"council_state"/.test(events), 'the v3.0.1 ledger carries NO council_state note anywhere (the pre-council shape)')
    const checkpoints = detectSealedCouncil(events)
    assert.deepEqual(checkpoints, [], 'the detection contract returns the empty set ⇒ build detects legacy_authority')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── the discriminator: a v3.0.2-native ledger with a sealed master_plan seal is NOT mis-detected ──
test('v3.0.2-native discriminator: the SAME detection contract over the FIXTURE BYTES of a ledger carrying a sealed master_plan RATIFIED note yields a non-empty set ⇒ the legacy hook does NOT fire (no false legacy detection)', () => {
  const { dir, kilnDir } = writeInflightV301({ sealCouncil: true })
  try {
    const checkpoints = detectSealedCouncil(readEventsText(kilnDir))
    assert.equal(checkpoints.length, 1, 'the sealed council_state note is collected verbatim')
    assert.equal(checkpoints[0].keystone_id, 'master_plan', 'the master_plan checkpoint is the one that satisfies detection')
    assert.equal(checkpoints[0].phase, 'RATIFIED', 'the RATIFIED phase is the non-legacy authority')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
