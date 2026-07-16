// kill-streaks.test.mjs — guard: the re-keyed kill-streak selector.
// The selection is prose-driven (the conductor reads the ladder + the arithmetic from markdown),
// so this guards two things: (1) kill-streaks.md AND the kiln-fire SKILL both name the exact
// arithmetic verbatim — they must not drift apart; (2) a faithful reference implementation of
// that arithmetic, reading the byte-stable STATE.md bullets with the fail-soft rule, lands on the
// right ladder name (fresh/pending STATE fails soft to first-blood; corrections climb the ladder).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGIN = join(ROOT, 'plugins', 'kiln')
const KS = readFileSync(join(PLUGIN, 'references', 'kill-streaks.md'), 'utf8')
const SKILL = readFileSync(join(PLUGIN, 'skills', 'kiln-fire', 'SKILL.md'), 'utf8')

// The two verbatim formula lines. Both surfaces must carry both, byte-identical.
const POSITION = 'max(build_iteration + correction_cycle, 1)'
const INDEX = '(ladder_position - 1) % 40'

test('the arithmetic is named verbatim in BOTH kill-streaks.md and the kiln-fire SKILL', () => {
  for (const [name, src] of [['kill-streaks.md', KS], ['SKILL.md', SKILL]]) {
    assert.ok(src.includes(POSITION), `${name} does not name the ladder-position formula verbatim`)
    assert.ok(src.includes(INDEX), `${name} does not name the index formula verbatim`)
  }
})

// The 40-name ladder, parsed from the markdown tables in order.
const ladder = [...KS.matchAll(/^\|\s*(\d+)\s*\|\s*([a-z0-9-]+)\s*\|/gm)]
  .map((m) => [Number(m[1]), m[2]])
  .sort((a, b) => a[0] - b[0])
  .map((r) => r[1])

test('the ladder is exactly 40 names, first-blood first, gg-wp last', () => {
  assert.equal(ladder.length, 40)
  assert.equal(ladder[0], 'first-blood')
  assert.equal(ladder[39], 'gg-wp')
})

// Reference implementation of the documented selector: read the byte-stable bullet, fail-soft any
// missing / `pending` / non-integer field to 0, then apply the arithmetic.
const field = (state, name) => {
  const m = state.match(new RegExp(`^- \\*\\*${name}\\*\\*: (.+)$`, 'm'))
  if (!m) return 0
  const raw = m[1].trim()
  return /^-?\d+$/.test(raw) ? Number(raw) : 0
}
const streak = (state) => {
  const pos = Math.max(field(state, 'build_iteration') + field(state, 'correction_cycle'), 1)
  return ladder[(pos - 1) % 40]
}

test('a fresh STATE (both fields 0) fails soft to first-blood', () => {
  assert.equal(streak('- **build_iteration**: 0\n- **correction_cycle**: 0'), 'first-blood')
})

test('a missing field reads as 0 — never a crash', () => {
  assert.equal(streak('- **milestone_count**: 3'), 'first-blood')
})

test('a `pending` / non-integer field fails soft to 0', () => {
  assert.equal(streak('- **build_iteration**: pending\n- **correction_cycle**: 0'), 'first-blood')
  assert.equal(streak('- **build_iteration**: 2\n- **correction_cycle**: pending'), ladder[1])
})

test('correction cycles climb the ladder — build 3 + correction 2 = position 5', () => {
  assert.equal(streak('- **build_iteration**: 3\n- **correction_cycle**: 2'), ladder[4])
})

test('position 40 lands on the last name; position 41 wraps to first-blood', () => {
  assert.equal(streak('- **build_iteration**: 40\n- **correction_cycle**: 0'), 'gg-wp')
  assert.equal(streak('- **build_iteration**: 39\n- **correction_cycle**: 2'), 'first-blood')
})
