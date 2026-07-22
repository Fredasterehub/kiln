import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A truthfulness anchor for references/recipe-shelf.md — NOT a prose lock. The shelf is the
// list-of-record for the three recipes and how each launches. Existence is asserted only for
// what ships now: ratify-artifact's verb in kiln-review. research-sweep (S2) and screening-room
// (W8) are held to not-yet-shipped through the shelf's own status markers, never by probing for
// their not-yet-existing files. Zero run cost: bytes on disk.
const SHELF = fileURLToPath(new URL('../references/recipe-shelf.md', import.meta.url))
const REVIEW = fileURLToPath(new URL('../scripts/kiln-review', import.meta.url))
const shelf = readFileSync(SHELF, 'utf8')
const RECIPES = ['research-sweep', 'ratify-artifact', 'screening-room']

function statusOf(recipe) {
  const m = shelf.match(new RegExp(`##\\s+${recipe}\\b[^\\n]*status:\\s*([^\\n(]+)`, 'i'))
  return m ? m[1].trim().toLowerCase() : null
}

test('recipe-shelf: names all three recipes of the fixed shelf', () => {
  for (const recipe of RECIPES) assert.ok(shelf.includes(recipe), `the shelf names ${recipe}`)
})

test('recipe-shelf: states the by-path launch reality — the manifest has no workflows key', () => {
  assert.ok(/by[ -]path/i.test(shelf), 'the shelf says recipes launch by path')
  assert.ok(shelf.includes('`workflows`'), 'the shelf explains the manifest has no workflows key')
})

test('recipe-shelf: gives every recipe a parseable status', () => {
  for (const recipe of RECIPES) assert.ok(statusOf(recipe), `the shelf gives ${recipe} a status`)
})

test('recipe-shelf: ratify-artifact is marked SHIPPED and its kiln-review verb is present', () => {
  assert.ok(statusOf('ratify-artifact').startsWith('shipped'), 'the shelf marks ratify-artifact shipped')
  assert.ok(readFileSync(REVIEW, 'utf8').includes(`mode === 'ratify'`), 'the ratify verb ships in kiln-review')
})

test('recipe-shelf: research-sweep and screening-room stay unshipped until their wave', () => {
  for (const recipe of ['research-sweep', 'screening-room']) {
    assert.ok(!statusOf(recipe).startsWith('shipped'), `${recipe} is not yet marked SHIPPED`)
  }
})
