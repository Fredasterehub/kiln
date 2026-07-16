// succession-head.test.mjs — the product Claude-head succession floor: the model pins, and the
// bundle-level proofs that every Claude-head council seat + Claude-half provenance resolves its engine
// through the run-resolved CLAUDE_HEAD_MODEL constant, so no hardcoded model:'fable' survives (Opus 4.8
// succeeds Fable 5 in the seat, recorded, never silent). Companion to the kiln-state.test.mjs
// capability.claude_head round-trips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAUDE_HEAD, CLAUDE_HEAD_FALLBACK } from '../../plugins/kiln/src/models.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const wfSrcDir = join(root, 'plugins/kiln/workflows-src')
const wfOutDir = join(root, 'plugins/kiln/workflows')
const COUNCIL_WORKFLOWS = ['architecture.js', 'build.js', 'validate.js', 'vision.js', 'report.js']
const srcFiles = () => readdirSync(wfSrcDir).filter((n) => n.endsWith('.js'))

test('models pins: CLAUDE_HEAD is fable (the preferred Claude head), CLAUDE_HEAD_FALLBACK is opus (the recorded succession)', () => {
  assert.equal(CLAUDE_HEAD, 'fable')
  assert.equal(CLAUDE_HEAD_FALLBACK, 'opus')
})

test("(a) grep proof: zero hardcoded model: 'fable' literals remain in any workflows-src file", () => {
  for (const f of srcFiles()) {
    assert.equal(readFileSync(join(wfSrcDir, f), 'utf8').includes("model: 'fable'"), false,
      `${f} still hardcodes a model: 'fable' literal — resolve every Claude-head seat through CLAUDE_HEAD_MODEL`)
  }
})

test('(b) grep proof: each of the five council workflows defines CLAUDE_HEAD_MODEL from the pins and consumes it', () => {
  for (const f of COUNCIL_WORKFLOWS) {
    const src = readFileSync(join(wfSrcDir, f), 'utf8')
    assert.match(src, /const CLAUDE_HEAD_MODEL = A\.claudeHead === CLAUDE_HEAD_FALLBACK \? CLAUDE_HEAD_FALLBACK : CLAUDE_HEAD/,
      `${f} must define CLAUDE_HEAD_MODEL by consuming the CLAUDE_HEAD / CLAUDE_HEAD_FALLBACK pins`)
    assert.match(src, /model: CLAUDE_HEAD_MODEL/,
      `${f} must resolve at least one Claude-head seat model through CLAUDE_HEAD_MODEL`)
  }
})

test("(c) grep proof: zero Claude-half seat_provenance still hardcodes model: 'fable' (never label fable what opus produced)", () => {
  for (const f of srcFiles()) {
    assert.equal(/head: 'fable',\s*model: 'fable'/.test(readFileSync(join(wfSrcDir, f), 'utf8')), false,
      `${f} still carries a { head: 'fable', model: 'fable' } provenance literal`)
  }
})

test('the shipped mirrors inline the pins and carry no model: \'fable\' (the bytes the sandbox runs)', () => {
  for (const f of COUNCIL_WORKFLOWS) {
    const out = readFileSync(join(wfOutDir, f), 'utf8')
    assert.equal(out.includes("model: 'fable'"), false, `generated ${f} still hardcodes model: 'fable'`)
    assert.match(out, /const CLAUDE_HEAD = 'fable'/, `generated ${f} must inline the CLAUDE_HEAD pin`)
    assert.match(out, /const CLAUDE_HEAD_FALLBACK = 'opus'/, `generated ${f} must inline the CLAUDE_HEAD_FALLBACK pin`)
    assert.match(out, /const CLAUDE_HEAD_MODEL = /, `generated ${f} must carry the resolved CLAUDE_HEAD_MODEL`)
  }
})

test('the head LABELS are preserved: every council workflow still names the fable SEAT (seat name, not engine)', () => {
  for (const f of COUNCIL_WORKFLOWS) {
    const src = readFileSync(join(wfSrcDir, f), 'utf8')
    assert.match(src, /head: 'fable'|slotOf\('fable'\)/,
      `${f} must keep the fable head/slot LABEL (A12: 'fable' names the seat, CLAUDE_HEAD_MODEL names the engine)`)
  }
})

// ── R2 F2 (R1-RETRY-CAUSE-NOT-EXPOSED): every council workflow threads the failed-Claude-head
//    discriminator `council_missing_head` onto its DEGRADED boundary return, so the conductor's
//    succession retry keys on the return shape, never a prose scan of missing/reason. ──
test('(F2) boundary discriminator: each of the five council workflows exposes council_missing_head on its DEGRADED return path', () => {
  for (const f of COUNCIL_WORKFLOWS) {
    const src = readFileSync(join(wfSrcDir, f), 'utf8')
    assert.match(src, /council_missing_head:/,
      `${f} must thread council_missing_head onto its DEGRADED boundary return (the conductor's succession-retry key)`)
    // the discriminator is normalized to the {fable, sol, null} domain the retry rule keys on — a
    // 'both'/evidence/certificate DEGRADED is no single head death, so it folds to null.
    assert.match(src, /=== 'fable' \|\| [^)]*=== 'sol'/,
      `${f} must normalize council_missing_head to the 'fable' | 'sol' | null domain`)
  }
})

test('(F2) the shipped mirrors carry council_missing_head (the bytes the sandbox runs)', () => {
  for (const f of COUNCIL_WORKFLOWS) {
    assert.match(readFileSync(join(wfOutDir, f), 'utf8'), /council_missing_head:/,
      `generated ${f} must carry council_missing_head`)
  }
})

// ── R2 F1/F2/F3: the SKILL.md Claude-head succession-retry rule. The conductor keys the retry on the
//    boundary discriminator, appends the demotion BEFORE relaunch, and mints a FRESH runToken (the dead
//    convening's token replay-collides with its already-verified Sol legs). ──
const skillPath = join(root, 'plugins/kiln/skills/kiln-fire/SKILL.md')
test('(F2) SKILL retry rule keys on council_missing_head === \'fable\' AND capability.claude_head === \'fable\'', () => {
  const skill = readFileSync(skillPath, 'utf8')
  assert.match(skill, /council_missing_head === 'fable'/,
    'the succession-retry rule must key its trigger on the boundary discriminator council_missing_head === \'fable\'')
  assert.match(skill, /capability\.claude_head === 'fable'/,
    'the succession-retry rule must also require this run resolved to the fable head')
})

test('(F1) SKILL retry rule mints a FRESH runToken with the replay-collision rationale', () => {
  const skill = readFileSync(skillPath, 'utf8')
  assert.match(skill, /Mint a FRESH `runToken`/,
    'the relaunch must mint a FRESH runToken (a newly bound convening)')
  assert.match(skill, /replay-collide/,
    'the rule must state WHY: reusing the dead convening\'s token replay-collides with its already-verified Sol legs')
})

test('(F3) SKILL retry rule appends the nested claude_head:"opus" capability note BEFORE the relaunch', () => {
  const skill = readFileSync(skillPath, 'utf8')
  assert.match(skill, /"data":\{"kind":"capability","capability":\{/,
    'the demotion append must nest the capability record under data.capability (mirroring the onboarding append)')
  assert.match(skill, /"claude_head":"opus"/,
    'the demotion append must carry claude_head:"opus" (the recorded succession the projection folds)')
  const appendIdx = skill.indexOf('"claude_head":"opus"')
  const relaunchIdx = skill.indexOf('Relaunch that ONE stage once')
  assert.ok(appendIdx > -1 && relaunchIdx > -1 && appendIdx < relaunchIdx,
    'the capability demotion append must come BEFORE the relaunch (probe → append → mint fresh runToken → relaunch)')
})

// ── R2 F4 (R1-PUBLISHED-STATE-SCHEMA-DRIFT): the published state schema documents the OPTIONAL
//    claude_head field — the validator↔schema contract. capability is a oneOf(null | object), so the
//    object branch is where the property lives (the brief's properties.capability.properties path). ──
test('(F4) state.schema.json capability object documents claude_head as an OPTIONAL {fable, opus} enum', () => {
  const schema = JSON.parse(readFileSync(join(root, 'plugins/kiln/schemas/state.schema.json'), 'utf8'))
  const capObject = schema.properties.capability.oneOf.find((s) => s.type === 'object')
  assert.ok(capObject, 'capability oneOf must carry an object branch')
  assert.deepEqual(capObject.properties.claude_head.enum, ['fable', 'opus'],
    'capability.claude_head must be an enum of exactly ["fable","opus"]')
  assert.equal(capObject.required.includes('claude_head'), false,
    'claude_head must NOT be in required — it is optional (every pre-succession ledger omits it)')
  assert.equal(capObject.additionalProperties, false,
    'additionalProperties:false stays — the schema now admits claude_head as a named property, not by widening')
})
