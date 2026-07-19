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
    'build.md': ['build-opens', 'slice-opens'],
    'validate.md': ['validate-green', 'validate-red'],
    'report.md': ['report-opens'],
    'brainstorm.md': ['vision-compiled']
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

test('voice: grammar["banner.stage"] is the literal §0 frame — 36-column bars, brand line inside, quote foot outside', () => {
  const voice = JSON.parse(readFileSync(join(DATA, 'voice.json'), 'utf8'))
  const banner = voice.grammar['banner.stage']
  const lines = banner.split('\n')
  // The ratified §0 anatomy (display-system.md), pinned literally: FRAME bar,
  // BRAND LINE, the strip+unfold fill, FRAME bar — nothing else inside the frame.
  assert.equal(lines.length, 4, 'exactly four template lines — bar, brand line, {progress}, bar')
  assert.equal(lines[0], '━'.repeat(36), 'the opening heavy bar is the ratified 36-column run')
  assert.equal(lines[3], '━'.repeat(36), 'the closing heavy bar matches — the frame never resizes')
  assert.equal(lines[1], '**KILN** · *{name}*', 'the mandatory brand line rides INSIDE the frame — KILN bold, one italic context')
  assert.equal(lines[2], '{progress}', 'the strip + unfold fill is the third line, inside the frame')
  // The quote foot lives OUTSIDE the frame (panel.blocks.foot) — never in the banner.
  assert.ok(!banner.includes('{quote}') && !banner.includes('{source}'), 'no quote inside the frame — the foot composes below the card body')
  assert.ok(!banner.includes('{STAGE}'), 'the 34-column legacy stage marker line is gone — strips and title units carry the N2–N5 stage anchors')
  // The foot rule is the ratified 31-column light run (§0 FOOT).
  assert.equal(voice.grammar['rule.light'], '─'.repeat(31), 'the foot light rule is the ratified 31-column run')
})

// ── The joint-sitting kills and wires (branding + kills slice) ──────────────

test('voice: the beat key set is exact — every surviving key has a named consumer', () => {
  const voice = JSON.parse(readFileSync(join(DATA, 'voice.json'), 'utf8'))
  assert.deepEqual(Object.keys(voice.beats).sort(), [
    'bad-args', 'blocked', 'completion', 'completion.single-family',
    'completion.single-family.unmetered', 'completion.unmetered', 'degradation',
    'degradation.continue', 'gate-unreachable', 'greeting.brainstorm', 'greeting.direct',
    'idle', 'plan.gate', 'reopen', 'resume', 'review.fail', 'seal', 'slice.start',
    'stage.brainstorm', 'stage.law', 'stage.validate', 'transport-failure',
  ], 'exactly the 22 consumed beat keys — stage.build, stage.report, review.pass killed (S4); the two dead pre-root bad-args twins killed, the key re-scoped to the reachable unknown-stage site (S1)')
  assert.equal(voice.beats['bad-args'].length, 1, 'bad-args carries only the reachable unknown-stage entry')
  assert.equal(voice.beats['transport-failure'].length, 2, 'transport-failure keeps its review-call (0) and stage-worker (1) variants — the kernel indexes them')
})

test('voice: the grammar key set is exact — the display system wires or kills every key', () => {
  const voice = JSON.parse(readFileSync(join(DATA, 'voice.json'), 'utf8'))
  assert.deepEqual(Object.keys(voice.grammar).sort(),
    ['banner.stage', 'progress.form', 'progress.glyphs', 'rule.light'],
    'banner.streak (S5) and spawn, spawn.done, seal.mark, emit (S4) and the panel.checkpoint pair die; rule.light and the progress pair are wired through the panel encoding')
  assert.deepEqual(voice.grammar['progress.glyphs'], { done: '✓', active: '▶', opened: '◇', pending: '○' }, 'the strip glyph ladder carries ◇ opened (display-system strip law)')
})

test('voice: the panel section is the display-system encoding — blocks, compositions, recipes', () => {
  const voice = JSON.parse(readFileSync(join(DATA, 'voice.json'), 'utf8'))
  const p = voice.panel
  assert.deepEqual(Object.keys(p.blocks).sort(), [
    'brand_line', 'close', 'evidence_notch', 'fault_lens', 'foot', 'frame',
    'shadow', 'strip', 'title_unit', 'unfold', 'whisper',
  ], 'the eleven blocks — nine core plus the two absorbed (fault lens, evidence notch)')
  assert.deepEqual(Object.keys(p.compositions).sort(),
    ['ask', 'boundary_card', 'card', 'lane_header', 'meter', 'pulse'],
    'the six compositions')
  assert.equal(Object.keys(p.recipes).length, 10, 'the ten scenario recipes')
  assert.deepEqual(p.states.ladder, ['UNFIRED', 'RUNNING', 'SEALED', 'HELD'], 'the closed state ladder')
})

test('skill: every inlined conductor beat equals its voice.json entry byte-for-byte (S3)', () => {
  const voice = JSON.parse(readFileSync(join(DATA, 'voice.json'), 'utf8'))
  const skill = readFileSync(fileURLToPath(new URL('../skills/kiln-fire/SKILL.md', import.meta.url)), 'utf8')
  const CONDUCTOR_KEYS = ['greeting.direct', 'greeting.brainstorm', 'plan.gate',
    'degradation.continue', 'completion.unmetered', 'completion.single-family.unmetered', 'idle']
  for (const key of CONDUCTOR_KEYS) {
    for (const [i, entry] of voice.beats[key].entries()) {
      assert.ok(skill.includes(entry), `SKILL.md must carry beats["${key}"][${i}] verbatim: ${entry}`)
    }
  }
})

test('plugin.json: the zero-reader userConfig knobs are killed (S15)', () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)), 'utf8'))
  assert.ok(!('userConfig' in manifest), 'no userConfig — posture and theaterIntensity died with their v3 readers')
})

// ── S2/S3 structural pins: the cards COMPOSE the recipes, not merely cite them ──

test('cards: Law and Validate carry the truthful active-phase fraction, each bound to its named on-disk checklist', () => {
  const law = cardText('law.md')
  assert.ok(law.includes('▶ **Law** N/N'), 'the law strip carries the active-phase fraction — bare bold word, fraction outside the bold (N2)')
  assert.ok(law.includes('checklist `.kiln/slices.json`'), 'the law fraction is bound to the named slice checklist')
  const validate = cardText('validate.md')
  assert.ok(validate.includes('▶ **Validate** M/M'), 'the validate strip carries the active-phase fraction — bare bold word, fraction outside the bold (N4)')
  assert.ok(validate.includes('checklist `.kiln/LAW.md`'), 'the validate fraction is bound to the named Law checklist')
  const build = cardText('build.md')
  assert.ok(build.includes('▶ **Build** {s}/{t}'), 'the build strip keeps the kernel-filled fraction against .kiln/slices.json — bare bold word, fraction outside the bold (N3)')
})

test('cards: Report renders the FINAL all-sealed strip — every phase ✓, no fraction, no active marker, no unfold', () => {
  const report = cardText('report.md')
  assert.ok(report.includes('✓ *Law* · ✓ *Build* · ✓ *Validate* · ✓ *Report*'), 'the final strip seals every phase — the run is over')
  assert.ok(!report.includes('▶ **Report'), 'no active Report marker and no fraction — nothing is being counted any more')
  assert.ok(report.includes('NO unfold'), 'the unfold is omitted — no phase is active')
})

test('cards: every stage card pins its title unit and its N2–N5 bold-Stage anchor', () => {
  const anchors = {
    'law.md': ['`SEALED` **The Law is locked', '▶ **Law'],
    'build.md': ['`RUNNING` **<this slice at concept altitude', '▶ **Build'],
    'validate.md': ['`SEALED` **Validate — a hundred eyes found nothing wrong', '▶ **Validate'],
    'report.md': ['`SEALED` **Report** — the report stands', '✓ *Report*'],
  }
  for (const [name, pins] of Object.entries(anchors)) {
    const text = cardText(name)
    for (const pin of pins) {
      assert.ok(text.includes(pin), `${name} must carry the anchor: ${pin}`)
    }
  }
})

test('cards: composition order is literal per the recipes — and the repair card carries the FAULT LENS with no foot', () => {
  const order = (label, text, markers) => {
    let last = -1
    let prev = 'the start'
    for (const m of markers) {
      const at = text.indexOf(m)
      assert.ok(at !== -1, `${label}: ${m} must be composed`)
      assert.ok(at > last, `${label}: ${m} must come after ${prev}`)
      last = at
      prev = m
    }
  }
  order('law.md', cardText('law.md'),
    ['**FRAME**', '**TITLE UNIT**', '**WHISPER**', '**CLOSE**', '**FOOT**'])
  order('validate.md', cardText('validate.md'),
    ['**FRAME**', '**TITLE UNIT**', '**WHISPER**', '**FAULT LENS**', '**EVIDENCE NOTCH**', '**CLOSE**', '**FOOT**'])
  const report = cardText('report.md')
  order('report.md', report,
    ['**FRAME**', '**TITLE UNIT**', '**EVIDENCE NOTCH**', '**THE METER**', '**FOOT**'])
  assert.ok(report.includes('NO close'), 'report.md: no close — its absence is the ending')
  const build = cardText('build.md')
  order('build.md (build mode)', build,
    ['**FRAME**', '**TITLE UNIT**', '**WHISPER**', '**SHADOW**', '**CLOSE**', '**FOOT**'])
  const repairAt = build.indexOf('**Repair mode**')
  assert.ok(repairAt !== -1, 'build.md keeps its repair mode section')
  const repair = build.slice(repairAt)
  order('build.md (repair mode)', repair,
    ['**FRAME**', '**TITLE UNIT**', '**WHISPER**', '**FAULT LENS**', '**CLOSE**'])
  assert.ok(!repair.includes('**FOOT**'), 'no quote foot on the repair card — the repair moments stay unwired')
})
