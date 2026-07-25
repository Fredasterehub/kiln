import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// W1-S1 (INTAKE-29 / driver Defect A): the phantom-screening-room cure. Before the fix a
// legacy resume with a missing or malformed .kiln/posture.json fell up to perceptual:'on'
// UNCONDITIONALLY, overriding an explicit --visual false, so the validate screening block
// woke on a NON-visual project and looped on a manifest that cannot exist. The cure has two
// independent guards, each covered here:
//   1. gauge-dial fail-up perceptual now DERIVES from the visual flag (dormant on --visual
//      false), asserted against the real script via child_process below.
//   2. the kernel gates screening on `perceptual && visualTable` (the sealed LAW carries a
//      ## Perceptual table) — a second ceiling that stays shut even if a relay drop makes the
//      dial read live. That gate lives in the WORKFLOW RUNTIME (the async Workflow body), not
//      the pure KERNEL_CORE region kernel.test.mjs imports, so it is not directly callable
//      here; kernel.test.mjs exercises it end-to-end (live scenarios pin presence exit 0,
//      dormant scenarios exit 1). We pin the WIRING with a source assertion so a refactor that
//      drops the ceiling fails a focused test.
// Regression catches (would FAIL pre-fix): case (a) — pre-fix printed perceptual:'on' on a
// missing posture at --visual false — and both kernel source guards (pre-fix gated on
// `perceptual` alone and read the dial through the shared DIAL schema).

const SCRIPT = fileURLToPath(new URL('../scripts/gauge-dial.mjs', import.meta.url))
const KERNEL = fileURLToPath(new URL('../workflows/kernel.js', import.meta.url))

function runScript(posture, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-perceptual-'))
  if (posture !== undefined) {
    mkdirSync(join(dir, '.kiln'), { recursive: true })
    writeFileSync(join(dir, '.kiln/posture.json'), typeof posture === 'string' ? posture : JSON.stringify(posture))
  }
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, 'the projector always exits 0 — it never fails the caller closed')
  return JSON.parse(r.stdout)
}

test('perceptual-dial (INTAKE-29): a MISSING posture at --visual false prints perceptual dormant, not on', () => {
  // The core bug: a missing posture fails up, and pre-fix that fail-up hardcoded perceptual on,
  // overriding the explicit --visual false a non-visual validate supplies. Now it stays dormant.
  const dials = runScript(undefined, ['--visual', 'false'])
  assert.equal(dials.perceptual, 'dormant', 'a missing posture does not override --visual false')
})

test('perceptual-dial: a MISSING posture at --visual true prints perceptual on — a real visual project still fails up', () => {
  const dials = runScript(undefined, ['--visual', 'true'])
  assert.equal(dials.perceptual, 'on', 'a genuine visual project still wakes the dial on fail-up')
})

test('perceptual-dial: a VALID dormant posture at --visual false prints perceptual dormant', () => {
  const dials = runScript({ scope: 'small', novelty: 'familiar', reversibility: 'reversible' }, ['--visual', 'false'])
  assert.equal(dials.perceptual, 'dormant', 'a trustworthy non-visual posture reads dormant')
})

test('perceptual-dial: the fail-up still HARDENS the other two dials regardless of the visual flag', () => {
  // Only perceptual moved. research and recovery_cap still fail up to max
  // scrutiny on an untrustworthy posture, with or without the flag.
  for (const args of [['--visual', 'false'], ['--visual', 'true']]) {
    const d = runScript('not json', args)
    assert.equal(d.research, 'on', 'research fails up regardless of the flag')
    assert.equal(d.recovery_cap, 1, 'recovery_cap fails up to 1 regardless of the flag')
  }
})

test('perceptual-dial: the kernel screening block is wired to the activation CEILING (perceptual AND visualTable)', () => {
  // Source guard for the runtime ceiling. Pre-fix the block gated on `perceptual` alone, so a
  // dial fail-up phantom-woke it on a non-visual project. It must now require visualTable — the
  // closed fact that the sealed LAW carries a ## Perceptual table.
  const src = readFileSync(KERNEL, 'utf8')
  assert.ok(src.includes("if (stage === 'validate' && perceptual && visualTable)"),
    'the screening block requires perceptual AND visualTable — the non-visual phantom stays shut')
  assert.ok(src.includes('visualTable = visual'),
    'visualTable is the sealed-LAW table-presence fact (the same read that feeds --visual)')
})

test('perceptual-dial: the kernel reads the perceptual dial through the closed PERCEPTUAL_DIAL schema, not the open DIAL', () => {
  // Source guard for the relay-integrity fix. The shared cap-read schema DIAL allows
  // additionalProperties, so a relayed perceptual field could drop and read as live. The dial leg
  // must use PERCEPTUAL_DIAL (all three fields required) and carry an honest error fallback so a
  // null return fails up truthfully, never via an omitted field.
  const src = readFileSync(KERNEL, 'utf8')
  assert.ok(src.includes("label: 'perceptual:dial', ...tier('kernel-leg'), schema: PERCEPTUAL_DIAL"),
    'the perceptual dial leg rides the closed PERCEPTUAL_DIAL schema')
  assert.ok(src.includes("required: ['exit', 'perceptual', 'recovery_cap']"),
    'PERCEPTUAL_DIAL requires all three fields — a dropped perceptual cannot validate')
  assert.ok(src.includes("(x ?? { exit: 20, perceptual: 'error', recovery_cap: 1 })"),
    'a null dial return fails up with an explicit error field, never an omitted one')
})
