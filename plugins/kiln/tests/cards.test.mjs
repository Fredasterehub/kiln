import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Static pins for the cards/conductor rewire (release-path slice 1): the four stage-card
// banner quotes read data/lore-quotes.json moments — the verified great-minds bank — and
// the retired data/lore.json card reads can never return silently. Zero run cost: every
// pin is a read of bytes on disk.
const CARDS = fileURLToPath(new URL('../cards', import.meta.url))
const DATA = fileURLToPath(new URL('../data', import.meta.url))

const cardText = (name) => readFileSync(join(CARDS, name), 'utf8')

test('cards: no file under cards/ references lore.json', () => {
  for (const name of readdirSync(CARDS)) {
    const text = readFileSync(join(CARDS, name), 'utf8')
    assert.ok(!text.includes('lore.json'), `${name} must not reference lore.json (the retired transitions bank)`)
  }
})

test('cards: each stage card names its mapped lore-quotes moment key', () => {
  const mapping = {
    'law.md': ['law-opens'],
    'build.md': ['build-opens'],
    'validate.md': ['validate-green', 'validate-red'],
    'report.md': ['report-opens']
  }
  for (const [name, moments] of Object.entries(mapping)) {
    const text = cardText(name)
    assert.ok(text.includes('lore-quotes.json'), `${name} must read data/lore-quotes.json`)
    for (const moment of moments) {
      assert.ok(text.includes(moment), `${name} must name moment ${moment}`)
    }
  }
})

test('lore-quotes: the bank parses, carries exactly 25 moment keys, every entry receipted', () => {
  const bank = JSON.parse(readFileSync(join(DATA, 'lore-quotes.json'), 'utf8'))
  const keys = Object.keys(bank.moments)
  assert.equal(keys.length, 25, 'exactly 25 moment keys')
  for (const key of keys) {
    const entries = bank.moments[key]
    assert.ok(Array.isArray(entries) && entries.length > 0, `${key} carries entries`)
    for (const [i, entry] of entries.entries()) {
      for (const field of ['text', 'source', 'receipt']) {
        assert.ok(typeof entry[field] === 'string' && entry[field].length > 0, `${key}[${i}].${field} nonempty`)
      }
    }
  }
})

test('voice: data/voice.json no longer references lore.json anywhere', () => {
  const text = readFileSync(join(DATA, 'voice.json'), 'utf8')
  assert.ok(!text.includes('lore.json'), 'voice.json must not reference lore.json (re-keyed to the moments bank)')
})

test('voice: grammar["banner.stage"] keeps the stage frame and de-styles the quote foot', () => {
  const voice = JSON.parse(readFileSync(join(DATA, 'voice.json'), 'utf8'))
  const banner = voice.grammar['banner.stage']
  // the quote foot renders plain — the single accent lives in the code span embedded in each bank entry, never in the grammar
  assert.ok(banner.includes('"{quote}" — {source}'), 'banner.stage must render the quote foot plain: "{quote}" — {source}')
  assert.ok(!banner.includes('`"{quote}"`'), 'no code-span wrapper around the quote')
  assert.ok(!banner.includes('`{quote}`'), 'no code-span wrapper around the quote')
  assert.ok(!banner.includes('*{source}*'), '{source} is plain, never italicized')
  // the stage frame is law-required (BEHAVIOR-SCENARIOS N2–N5): the bold active marker and progress strip survive
  assert.ok(banner.includes('**{STAGE}**'), 'the bold {STAGE} active marker must be preserved')
  assert.ok(banner.includes('{progress}'), 'the {progress} strip must be preserved')
})
