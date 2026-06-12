// ledger-vocabulary.test.mjs — the event-vocabulary drift guard (P3.5 T4, DOGFOOD FINDING 5).
//
// Run A froze events.jsonl at seq 2: kiln-state's closed EVENT_TYPES enum rejected the workflow
// event types Thoth tried to append, every append died exit 1 in his hands, and the ledger-
// completeness measure failed — Run A could not be reconstructed from events.jsonl alone. The fix
// widened the enum; THIS test is the compile-time defense that keeps it honest. A new workflow
// `ledger('<type>')` call without a matching enum entry is now a RED harness, never a silent hole.
//
// Three sources of truth, asserted to agree exactly:
//   1. The types the WORKFLOWS emit — every `ledger('<type>'` literal in workflows-src/*.js AND the
//      generated workflows/*.js (regex over file contents, matching the harness house style).
//   2. The types kiln-state ITSELF emits — run_init, minted by `init`.
//   3. EVENT_TYPES (parsed from the kiln-state.mjs source) and the schemas/event.schema.json enum,
//      which must be byte-order identical to each other and a SUPERSET of (1) ∪ (2).
// Plus a negative self-test: the extractor provably finds a planted unknown literal in a fixture
// string, so the guard's mechanism is proven, not merely its happy path.
//
// Round-trip: `kiln-state append` accepts each widened type and the ledger still validates/projects.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const CLI = join(root, 'plugins/kiln/scripts/kiln-state.mjs')
const SRC_DIR = join(root, 'plugins/kiln/workflows-src')
const GEN_DIR = join(root, 'plugins/kiln/workflows')
const STATE_SRC = join(root, 'plugins/kiln/scripts/kiln-state.mjs')
const SCHEMA = join(root, 'plugins/kiln/schemas/event.schema.json')

const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })

// ── The extractor: every `ledger('<type>'` literal in a body of JS text. Single source of the
//    extraction mechanism — the negative self-test below feeds it a fixture string, the live tests
//    feed it the real workflow files, so the SAME code proves both the catch and the agreement. ──
const LEDGER_RE = /ledger\('([a-z0-9_]+)'/g
function extractLedgerTypes(text) {
  const out = new Set()
  let m
  while ((m = LEDGER_RE.exec(text)) !== null) out.add(m[1])
  return out
}

function workflowTypes(dir) {
  const types = new Set()
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js')) continue
    for (const t of extractLedgerTypes(readFileSync(join(dir, f), 'utf8'))) types.add(t)
  }
  return types
}

// EVENT_TYPES parsed from the kiln-state.mjs SOURCE (not imported) — the guard must read what ships.
function parseEventTypes() {
  const m = readFileSync(STATE_SRC, 'utf8').match(/const EVENT_TYPES = (\[[^\]]*\])/)
  assert.ok(m, 'EVENT_TYPES array not found in kiln-state.mjs source')
  return JSON.parse(m[1].replace(/'/g, '"'))
}

const schemaEnum = () => JSON.parse(readFileSync(SCHEMA, 'utf8')).properties.type.enum

// run_init is the one type kiln-state emits itself (from `init`); no other CLI command mints a type.
const KILN_STATE_EMITTED = ['run_init']

test('drift guard: EVENT_TYPES and the schema enum are byte-order identical', () => {
  assert.deepEqual(parseEventTypes(), schemaEnum())
  // deepEqual on arrays is order-sensitive, so this IS the byte-order assertion; stringify to be loud.
  assert.equal(JSON.stringify(parseEventTypes()), JSON.stringify(schemaEnum()))
})

test('drift guard: every type the workflows emit is in the closed EVENT_TYPES enum', () => {
  const enumSet = new Set(parseEventTypes())
  const emitted = new Set([...workflowTypes(SRC_DIR), ...workflowTypes(GEN_DIR), ...KILN_STATE_EMITTED])
  const missing = [...emitted].filter((t) => !enumSet.has(t)).sort()
  assert.deepEqual(missing, [], `workflow/kiln-state event types absent from EVENT_TYPES: ${missing.join(', ')}`)
})

test('drift guard: src and generated workflows emit the SAME ledger vocabulary (no bundler skew)', () => {
  assert.deepEqual([...workflowTypes(SRC_DIR)].sort(), [...workflowTypes(GEN_DIR)].sort())
})

test('drift guard: at least one workflow ledger type is actually present (the extractor is not vacuously empty)', () => {
  const emitted = workflowTypes(SRC_DIR)
  assert.ok(emitted.size >= 12, `expected ≥12 workflow ledger types, extractor found ${emitted.size}`)
})

// ── Negative self-test: prove the MECHANISM catches a type the enum does not carry. A fixture body
//    plants `ledger('totally_made_up_type')`; the extractor must surface it, and it must NOT be in
//    EVENT_TYPES — exactly the shape of the Run-A hole. This is the guard catching drift, on demand. ──
test('drift guard NEGATIVE self-test: the extractor surfaces a planted unknown type the enum rejects', () => {
  const fixture = [
    "// fixture workflow body — exercises the extractor",
    "await ledger('browser_sweep', { stage: 'build' })   // known: in the enum",
    "await ledger('totally_made_up_type', { x: 1 })       // planted: NOT in the enum",
  ].join('\n')
  const found = extractLedgerTypes(fixture)
  assert.ok(found.has('totally_made_up_type'), 'extractor failed to find the planted literal')
  assert.ok(found.has('browser_sweep'), 'extractor failed to find the known literal beside it')
  // The planted type is exactly what a real new workflow event would look like before its enum entry.
  assert.ok(!new Set(parseEventTypes()).has('totally_made_up_type'), 'planted type must not be in the enum')
  // And the agreement assertion the live guard runs WOULD fail on this set — prove that predicate.
  const enumSet = new Set(parseEventTypes())
  const missing = [...found].filter((t) => !enumSet.has(t))
  assert.deepEqual(missing, ['totally_made_up_type'], 'the guard predicate must flag exactly the planted hole')
})

// ── Round-trip: kiln-state append accepts every workflow event type, then validate + project pass. ──
// gate_only_refused joined in P3.5 T3 (the gateOnly refuse path) — the guard caught its absence
// the same session it shipped; this fixture updates CONSCIOUSLY with every vocabulary change.
const WORKFLOW_TYPES = [
  'browser_lease', 'browser_sweep', 'gate_only_refused', 'gate_skipped', 'goal_audit_failure',
  'law_red_auto_reject', 'probe_unavailable', 'slice_plan_invalid', 'slice_plan_invalidated',
  'slice_plan_replanned', 'tamper_auto_reject', 'tier2_traversal', 'validate_verdict',
  'verification_degraded',
]

test('round-trip: append accepts each widened workflow type; validate + project exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-ledger-vocab-'))
  const kilnDir = join(dir, '.kiln')
  try {
    assert.equal(run('init', kilnDir, '--project-path', '/srv/demo', '--name', 'demo', '--type', 'node').status, 0)
    let seq = 1
    for (const type of WORKFLOW_TYPES) {
      const res = run('append', kilnDir, JSON.stringify({ type, stage: 'build', data: { token: type } }))
      assert.equal(res.status, 0, `append rejected '${type}': ${res.stderr}`)
      const ev = JSON.parse(res.stdout)
      assert.equal(ev.type, type)
      assert.equal(ev.seq, ++seq)
    }
    assert.equal(run('validate', kilnDir).status, 0, 'validate must be green on a ledger carrying all widened types')
    assert.equal(run('project', kilnDir).status, 0, 'project must be green on a ledger carrying all widened types')
    // The widened types fold into nothing (no per-type rule) but advance bookkeeping — last seq tracks.
    const st = JSON.parse(readFileSync(join(kilnDir, 'state.json'), 'utf8'))
    assert.equal(st.last_event_seq, seq)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('round-trip: every WORKFLOW_TYPES entry is one of the widened workflow types (no stale fixture drift)', () => {
  // Guards the fixture itself: the round-trip list must equal exactly the enum minus the pre-existing
  // core lifecycle types, so this test cannot silently rot if the enum widens again without updating it.
  const CORE = ['run_init', 'stage_started', 'stage_completed', 'gate_decision', 'posture_set', 'posture_escalated', 'check_result', 'commit', 'evidence', 'escalation', 'note']
  const widened = parseEventTypes().filter((t) => !CORE.includes(t))
  assert.deepEqual([...WORKFLOW_TYPES].sort(), widened.sort())
})
