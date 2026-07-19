// kill-streaks.test.mjs — guard: the scripted kill-streak selector.
// The arithmetic + 40-row table lookup now live in `kiln-state killstreak` (the conductor no longer
// hand-computes the modulo). This guards: (1) kill-streaks.md still names the exact arithmetic
// verbatim (the human/product doc + the CLI's data source), and the kiln-fire SKILL now delegates to
// the CLI selector instead of re-naming the formulas; (2) the ladder parses to exactly 40 names; and
// (3) the REAL CLI emits the right name across fresh/pending/climb/wrap/unknown-flag cases.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGIN = join(ROOT, 'plugins', 'kiln')
const KS = readFileSync(join(PLUGIN, 'references', 'kill-streaks.md'), 'utf8')
const SKILL = readFileSync(join(PLUGIN, 'skills', 'kiln-fire', 'SKILL.md'), 'utf8')
const CLI = join(PLUGIN, 'scripts', 'kiln-state.mjs')

// The two verbatim formula lines. kill-streaks.md must still carry both (the doc + the CLI's source).
const POSITION = 'max(build_iteration + correction_cycle, 1)'
const INDEX = '(ladder_position - 1) % 40'

test('kill-streaks.md names the arithmetic verbatim; the SKILL delegates to the CLI selector', () => {
  assert.ok(KS.includes(POSITION), 'kill-streaks.md does not name the ladder-position formula verbatim')
  assert.ok(KS.includes(INDEX), 'kill-streaks.md does not name the index formula verbatim')
  // the SKILL no longer hand-names the formulas — it calls the emitter
  assert.ok(SKILL.includes('kiln-state.mjs killstreak'), 'the SKILL must invoke the kiln-state killstreak emitter')
  assert.ok(SKILL.includes('killstreak --build-iteration'), 'the SKILL must show the killstreak flag form')
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

// EXEC the real CLI — the harness guards the actual emitter, not a parallel re-implementation.
const streak = (...args) => {
  const r = spawnSync(process.execPath, [CLI, 'killstreak', ...args], { encoding: 'utf8' })
  return { out: r.stdout.trim(), code: r.status }
}

test('scripted selector: fresh/pending/missing counters fail soft to first-blood', () => {
  assert.equal(streak('--build-iteration', '0', '--correction-cycle', '0').out, 'first-blood', '(0,0) → first-blood')
  assert.equal(streak().out, 'first-blood', 'no flags at all → default 0/0 → first-blood')
  assert.equal(streak('--build-iteration', 'pending', '--correction-cycle', '0').out, 'first-blood', 'pending build ⇒ 0')
  assert.equal(streak('--build-iteration', '2', '--correction-cycle', 'pending').out, ladder[1], 'pending correction ⇒ 0, build 2 → position 2')
})

test('scripted selector: corrections climb the ladder and the sequence wraps past 40', () => {
  assert.equal(streak('--build-iteration', '3', '--correction-cycle', '2').out, ladder[4], 'build 3 + correction 2 = position 5 → killing-spree')
  assert.equal(streak('--build-iteration', '40', '--correction-cycle', '0').out, 'gg-wp', 'position 40 → the last name')
  assert.equal(streak('--build-iteration', '39', '--correction-cycle', '2').out, 'first-blood', 'position 41 wraps to first-blood')
})

test('scripted selector: an unknown flag is a usage error (exit 2) — flag discipline parity with init/since', () => {
  const r = streak('--foo', '1')
  assert.equal(r.code, 2, 'an unknown flag exits 2')
})

// The dispatch tail was restructured so killstreak stands without a kilnDir positional — confirm the
// other subcommands still behave: a bare invocation is still a usage error (exit 2).
test('dispatch regression: a bare invocation with no subcommand is still a usage error (exit 2)', () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' })
  assert.equal(r.status, 2, 'no subcommand → USAGE exit 2, unchanged by the dispatch restructure')
})
