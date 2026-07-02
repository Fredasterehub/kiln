// roster.test.mjs — P5 T1 acceptance: the Reserved Seven return (BLUEPRINT §11 item 6).
// The counting fragility gets a harness guard: the roster is 34, the seven rehired personas
// carry their v3 seat in the role string, lore.json counts 34 wherever it counts personas,
// and the engine labels the lore event credits actually exist in the shipped bundles
// (every name a user sees is a name the engine really runs — no ghost credits).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGIN = join(ROOT, 'plugins', 'kiln')
const agents = JSON.parse(readFileSync(join(PLUGIN, 'data', 'agents.json'), 'utf8'))
const lore = readFileSync(join(PLUGIN, 'data', 'lore.json'), 'utf8')

test('the roster is 34 entries', () => {
  assert.equal(Object.keys(agents).length, 34)
})

test('the Reserved Seven are seated — alias present, v3 seat named in the role', () => {
  const seats = {
    Alpha: /Assessor/,
    Asimov: /Lawgiver/,
    Thoth: /Scribe/,
    Sentinel: /Observer/,
    Denzel: /mathematics/,
    Aristotle: /systematizer/,
    Miyamoto: /graceful degradation/,
  }
  const byAlias = Object.fromEntries(Object.values(agents).map((a) => [a.alias, a]))
  for (const [alias, seatRe] of Object.entries(seats)) {
    assert.ok(byAlias[alias], `${alias} missing from the roster`)
    assert.match(byAlias[alias].role, seatRe, `${alias}'s role does not name the v3 seat`)
  }
})

test('lore.json counts 34 personas — the 27 era is over', () => {
  assert.ok(!/\b27\s+(specialized\s+)?personas\b/.test(lore), 'a stale 27-persona count survives in lore.json')
  assert.ok(/\b34\s+(specialized\s+)?personas\b/.test(lore), 'no 34-persona count found in lore.json')
})

test('the lore-event labels are real engine seats in the shipped bundles', () => {
  const vision = readFileSync(join(PLUGIN, 'workflows', 'vision.js'), 'utf8')
  assert.ok(vision.includes("'aristotle:compile'"), 'aristotle:compile not in vision bundle')
  assert.ok(vision.includes('aristotle:compile-revise'), 'aristotle:compile-revise not in vision bundle')
  assert.ok(!vision.includes('numerobis:compile'), 'numerobis still credited for the compile seat')
  const arch = readFileSync(join(PLUGIN, 'workflows', 'architecture.js'), 'utf8')
  assert.ok(arch.includes("codexAvailable ? 'sun-tzu:plan' : 'miyamoto:plan'"), 'the slot-B label does not name the seat that runs')
  assert.ok(arch.includes("'numerobis:foundation'"), 'Numerobis lost his architecture seat — he keeps it')
  const build = readFileSync(join(PLUGIN, 'workflows', 'build.js'), 'utf8')
  assert.ok(build.includes('Denzel reconciles'), 'the tribunal log line does not credit Denzel')
})
