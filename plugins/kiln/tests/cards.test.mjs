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

test('law card (W1-S4): exactly four numbered outputs, the card never seals lock.hash, and the beat digest is a DISPLAY sha256 of LAW.md', () => {
  const law = cardText('law.md')
  // Exactly four numbered card outputs, in order — parse the Outputs section and deep-equal,
  // so a fifth numbered output (or a reinstated lock.hash) fails, not just passes silently.
  const outputs = law.slice(law.indexOf('## Outputs'), law.indexOf('## Beat'))
  const numbered = [...outputs.matchAll(/^\d+\.\s+`([^`]+)`/gm)].map((m) => m[1])
  assert.deepEqual(numbered,
    ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md'],
    'exactly these four numbered outputs, in order — no fifth, and lock.hash is not among them')
  // Seal vs display is the real invariant: the card MAY compute a sha256 of LAW.md for the
  // beat digest, but it never writes/seals lock.hash — the kernel does that after ratify.
  assert.ok(!/>\s*`?\.kiln\/law\/lock\.hash/.test(law),
    'the card never redirects a write into lock.hash — the kernel seals it authoritatively')
  assert.ok(law.includes('the kernel seals'), 'the seal is re-attributed to the kernel post-ratify')
  assert.ok(law.includes('all four outputs'), 'the Return succeeds only on the four card-owned outputs')
  assert.ok(law.includes('reopen event, never') && law.includes('silent'), 'the reopen doctrine is preserved')
  // The TITLE UNIT digest is computed from the LAW.md the card just wrote — NOT read from
  // lock.hash, which the kernel has not sealed yet at beat-compose time (buffering delays
  // EMISSION, not composition; a compose-time read would embed an empty or stale digest).
  const titleUnit = law.slice(law.indexOf('**TITLE UNIT**'), law.indexOf('**WHISPER**'))
  assert.ok(titleUnit.includes('sha256sum .kiln/LAW.md'),
    'the beat digest is computed from the LAW.md bytes the card just wrote (display only)')
  assert.ok(!law.includes('digest from .kiln/law/lock.hash'),
    'the beat no longer reads the digest FROM lock.hash — that file is sealed later by the kernel')
})

test('law card (S1, A9/W5-03): the milestone label is authoritative in the LAW plan table, and slices.json is its checked projection', () => {
  const law = cardText('law.md')
  const outputs = law.slice(law.indexOf('## Outputs'), law.indexOf('## Beat'))
  const flat = outputs.replace(/\s+/g, ' ') // prose wraps across lines; flatten for phrase checks
  // Output 1 authors the AUTHORITATIVE plan table carrying the OPTIONAL milestone label.
  assert.ok(flat.includes('## Plan'), 'the LAW carries a `## Plan` table')
  assert.ok(flat.includes('| slice | milestone |'), 'the plan table columns are the slice and its milestone')
  assert.ok(flat.includes('OPTIONAL milestone label per slice'), 'the milestone label is optional, one per slice')
  assert.ok(flat.includes('AUTHORITATIVE plan table'), 'the plan table is the authoritative source of the labels')
  // The label wire safety is stated where the label is authored.
  assert.ok(flat.includes('a label carries no `|` and no control characters'),
    'a label carries no separator and no control characters')
  // Output 3 makes slices.json the CHECKED PROJECTION of the table, checked before the seal.
  assert.ok(flat.includes('"milestone": "<label>"'), 'slices.json carries the optional milestone field')
  assert.ok(flat.includes('checked projection'), 'slices.json is the table\'s checked projection')
  assert.ok(flat.includes('PROJECTED from the LAW plan table'), 'the slices milestone is projected from the authoritative table')
  assert.ok(flat.includes('the kernel refuses to seal unless the two agree') || flat.includes('the kernel checks agreement before it seals'),
    'the card states the kernel validates projection agreement before sealing')
  // The optional-label change adds no fifth numbered output — the four-output contract holds.
  const numbered = [...outputs.matchAll(/^\d+\.\s+`([^`]+)`/gm)].map((m) => m[1])
  assert.deepEqual(numbered,
    ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md'],
    'the milestone label rides outputs 1 and 3 — still exactly four numbered outputs, in order')
})

// ── Simple-fire: red-first TDD, JIT design, and the one-bash-call GPT coder ──

test('build card: red first, always — tests fail before the build; design is just-in-time inside the slice', () => {
  const build = cardText('build.md')
  assert.ok(build.includes('Red first, always'), 'the build opens with failing tests, before any implementation')
  assert.ok(build.includes('FAILING\n   before any implementation exists'), 'red precedes green — a test that never went red proves nothing')
  assert.ok(build.includes('just-in-time'), 'implementation design happens JIT inside the slice')
  assert.ok(build.includes('never\n   pre-planned beyond the cut'), 'law time fixed only the cut — never the HOW')
})

test('build card: the logic coder is ONE bash codex exec call — the proven recipe, stdin closed, verified by hand', () => {
  const build = cardText('build.md')
  assert.ok(build.includes('codex-prompt-guide.md'), 'the prompt is composed per the codex prompt guide')
  assert.ok(build.includes('Goal / Context / Constraints / Done-when'), 'the four-part prompt discipline rides the card')
  assert.ok(build.includes('codex exec -m <id>'), 'the mechanism is a bash codex exec call — no bridge, no protocol')
  assert.ok(build.includes('< "$TMP"'), 'stdin is fed and closed by the prompt redirect — an open stdin hangs codex')
  assert.ok(build.includes('resolver["gpt-sol"]'), 'the coder id resolves through data/tiers.json — the one place it is named')
  assert.ok(build.includes('No `--output-schema`'), 'the logic-builder row takes a free-text reply via -o')
  assert.ok(build.includes('at most twice\n   more'), 'the refine loop is bounded at two more calls')
  assert.ok(build.includes('the green run is the only proof'), 'the context-builder verifies with its own hands')
  assert.ok(build.includes('.kiln/check-receipt.txt'), 'the check-receipt contract rides the card')
})

test('build card (STRIKE 1): step 4 is order-aware — green through your own slice, later unbuilt reds never deadlock the builder', () => {
  const flat = cardText('build.md').replace(/\s+/g, ' ')
  // The bare full-green stop is gone: in a multi-slice milestone check.sh is red on
  // later unbuilt slices, so "return only when it exits 0" loops the builder forever.
  assert.ok(!flat.includes('return only when it exits `0`'),
    'the bare full-green stop is gone — it deadlocks a multi-slice check.sh red on later unbuilt slices')
  assert.ok(flat.includes('green THROUGH your own slice'),
    'the builder returns when its own slice criteria pass')
  assert.ok(flat.includes('a nonzero exit is acceptable ONLY when every remaining red is owned by a later, still-unbuilt planned slice'),
    'a nonzero exit is acceptable only when every remaining red is a later unbuilt planned slice')
  assert.ok(flat.includes("never return with your own or an earlier slice's criterion red"),
    'never return with your own or an earlier slice criterion red')
})

test('tiers: the logic and mixed surfaces route to the claude context-builder seat whose coder is GPT via one bash call', () => {
  const tiers = JSON.parse(readFileSync(join(DATA, 'tiers.json'), 'utf8'))
  assert.equal(tiers.surface_routing.logic, 'builder-logic', 'logic is routed again — the park is over')
  assert.equal(tiers.surface_routing.mixed, 'builder-logic', 'mixed is GPT-coded too — Claude builds only ui (the operator law)')
  const seat = tiers.roles['builder-logic']
  assert.equal(seat.family, 'claude', 'the seat is claude-family — the boot rule holds by design')
  assert.equal(seat.alias, 'sonnet')
  assert.equal(seat.effort, 'high', 'the wrapper effort is HIGH per the INTAKE-14b/Q1 default — a model-backed role defaults HIGH')
  assert.match(seat.note, /codex exec/, 'the note names the bash codex exec coder')
  assert.equal(tiers.resolver['gpt-sol'], 'gpt-5.6-sol', 'the resolver still names the concrete coder id')
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

// ── Wave 2 (the Carriers), T5: narration persists across the durable substrate ──
// ADR A2 (reuse-and-measure-first): the run's narration reconstructs from the
// artifacts already persisted on disk — no .kiln/narration.md log is added.

test('cards (T5): the report Inputs name the durable narration substrate — the run reconstructs from persisted artifacts alone', () => {
  const report = cardText('report.md')
  const inputs = report.slice(report.indexOf('## Inputs'), report.indexOf('## Method'))
  for (const artifact of ['.kiln/STATE.md', '.kiln/LAW.md', '.kiln/decisions.md', '.kiln/seals.log', '.kiln/validate.md', '.kiln/degraded']) {
    assert.ok(inputs.includes(artifact), `the report Inputs must name the durable substrate ${artifact}`)
  }
  assert.ok(report.includes('reconstruct from files') && report.includes('this stage proves the files suffice'),
    'the report states the T5 claim — the narration reconstructs from the persisted record, and the stage proves the files suffice')
})

test('cards (T5, ADR A2): no .kiln/narration.md is written or referenced in the kernel or any card — the substrate suffices', () => {
  const kernel = readFileSync(fileURLToPath(new URL('../workflows/kernel.js', import.meta.url)), 'utf8')
  assert.ok(!kernel.includes('narration.md'), 'kernel.js writes no narration log — narration persists in the existing durable artifacts')
  for (const name of readdirSync(CARDS)) {
    assert.ok(!cardText(name).includes('narration.md'), `${name} references no narration.md — ADR A2 adds no narration log, it reuses the substrate`)
  }
})

// ── Wave 3 (the Gauge foundation): the onboarding organ + the Gauge emit riding it ──

test('cards (Wave 3): the onboarding card is a LIGHT direct-path compiler — writes brief+posture, returns the envelope, NO quote foot', () => {
  const onb = cardText('onboarding.md')
  // It writes both onboarding artifacts, via the temp+rename card write idiom.
  assert.ok(onb.includes('.kiln/docs/project-brief.md'), 'the onboarding card writes the project brief')
  assert.ok(onb.includes('.kiln/posture.json'), 'the onboarding card writes the posture projection')
  assert.ok(onb.includes('temp + rename'), 'it writes via the temp + rename card idiom')
  // posture.json is EXACTLY the three frozen fields — the source of truth (dials are recomputed, never persisted).
  for (const field of ['scope', 'novelty', 'reversibility']) {
    assert.ok(onb.includes(field), `the posture names the frozen field ${field}`)
  }
  assert.ok(/dials?[^\n]*never[^\n]*persist|never persist/i.test(onb), 'the dials are not persisted — posture is the source of truth')
  // It returns the canonical envelope, 'ok' iff both files are written.
  assert.ok(onb.includes('facts.status') && onb.includes('narration_beat'), 'the card returns the canonical envelope')
  // LIGHT: a plain one-line announcement, never a Tier-1 quote foot / lore moment.
  assert.ok(!onb.includes('lore-quotes.json'), 'the light onboarding card reads no lore bank — no quote foot')
  assert.ok(!onb.includes('**FOOT**'), 'no FOOT block on the light onboarding card')
})

test('cards (Wave 3): the vision compiler ALSO emits the brief + posture — one leg, the earliest producer on the brainstorm path', () => {
  const b = cardText('brainstorm.md')
  assert.ok(b.includes('.kiln/docs/vision.md'), 'the compiler still writes the vision')
  assert.ok(b.includes('.kiln/docs/project-brief.md'), 'the same leg now also writes the project brief')
  assert.ok(b.includes('.kiln/posture.json'), 'the same leg now also writes the posture projection')
  for (const field of ['scope', 'novelty', 'reversibility']) {
    assert.ok(b.includes(field), `the brainstorm posture names the frozen field ${field}`)
  }
})

test('cards (Wave 3): onboarding ships as a light card exempt from the moment-key map — the 25-key lore bank is untouched', () => {
  const cards = readdirSync(CARDS).filter((n) => n.endsWith('.md'))
  assert.ok(cards.includes('onboarding.md'), 'onboarding.md is a card on disk')
  // The moment-keyed cards (the Tier-1 quote-foot composers) — onboarding is deliberately not
  // among them: a light card composes a plain announcement, so it needs no lore moment and
  // invents no quote. This is the exemption the moment-key assertion relies on above.
  const momentKeyed = new Set(['law.md', 'build.md', 'validate.md', 'report.md', 'brainstorm.md'])
  assert.ok(!momentKeyed.has('onboarding.md'), 'the light onboarding card is exempt from the moment-key map')
  const bank = JSON.parse(readFileSync(join(DATA, 'lore-quotes.json'), 'utf8'))
  assert.equal(Object.keys(bank.moments).length, 25, 'onboarding introduces no new lore moment — the bank stays at 25 keys')
})
