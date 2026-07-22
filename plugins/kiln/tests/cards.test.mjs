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

test('cards: Report renders the FINAL all-sealed strip on a sealed run — and the held-run variant refuses it (W8-S4)', () => {
  const report = cardText('report.md')
  assert.ok(report.includes('✓ *Law* · ✓ *Build* · ✓ *Validate* · ✓ *Report*'), 'the final strip seals every phase — the sealed-run composition')
  assert.ok(!report.includes('▶ **Report'), 'no active Report marker and no fraction — nothing is being counted any more')
  assert.ok(report.includes('NO unfold'), 'the unfold is omitted — no phase is active')
  // Variant-aware: the all-sealed strip and the SEALED title belong to the sealed run
  // ONLY — the held-run variant substitutes the honest held strip and the HELD title.
  assert.ok(report.includes('✓ *Law* · ✓ *Build* · ▶ **Validate** ·'), 'the held strip: the run stands AT validate, nothing past it sealed')
  assert.ok(report.includes('NO all-sealed strip'), 'the held variant refuses the all-sealed strip by name')
  assert.ok(report.includes('NEVER `SEALED`'), 'the held variant refuses the SEALED title by name')
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

test('law card (W8-S1/A): the Perceptual table — full lawful criteria whose subjective residue is graded, authored on a declared visual deliverable', () => {
  const law = cardText('law.md')
  const flatAll = law.replace(/\s+/g, ' ')
  // The doctrine STANDS and gains its one sentence: the proxy is the law, the residue is graded.
  assert.ok(flatAll.includes('If it cannot run, it is not law'), 'the executable-law doctrine stands untouched')
  assert.ok(flatAll.includes('A perceptual criterion is lawful because its proxy runs; its subjective residue is graded, not executed'),
    'the perceptual doctrine sentence rides the Method')
  assert.ok(flatAll.includes("the proxy command runs in `check.sh`'s every-criterion loop"),
    'the proxy joins the every-criterion loop — proxy red is law red, owning slice ids printed as ever')
  // Output 1 authors the table under its own heading, mirroring how the Plan table is specified.
  const outputs = law.slice(law.indexOf('## Outputs'), law.indexOf('## Beat'))
  const flat = outputs.replace(/\s+/g, ' ')
  assert.ok(flat.includes('## Perceptual'), 'the table rides INSIDE LAW.md under a `## Perceptual` heading')
  assert.ok(flat.includes('| criterion id | owning slice | dim | requirement | proxy command | expected | reference |'),
    'the seven-column table spec, verbatim')
  assert.ok(flat.includes('(reference optional)'), 'the reference cell is the one optional cell')
  assert.ok(flat.includes('whenever the project brief declares a visual deliverable'),
    'the authoring rule keys on the brief declaring a visual deliverable')
  assert.ok(flat.includes('4–6 DISTINCT dims') && flat.includes('data/perceptual-rubric.json'),
    'dims select 4-6 distinct dimensions from the shipped rubric')
  assert.ok(flat.includes('every `ui` or `mixed` slice owns at least one row'),
    'the coverage rule is stated where the table is authored')
  assert.ok(flat.includes('the table — validity, coverage, consistency — before it seals'),
    'the card states the kernel checks the table before the seal')
  // No fifth numbered output — the Perceptual table rides output 1 like the Plan table.
  const numbered = [...outputs.matchAll(/^\d+\.\s+`([^`]+)`/gm)].map((m) => m[1])
  assert.deepEqual(numbered,
    ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md'],
    'the Perceptual table rides output 1 — still exactly four numbered outputs, in order')
})

test('validate card (W8-S2/E): the conditional capture step — the screening-room recipe, a complete manifest or an honest not-ok, never an install', () => {
  const validate = cardText('validate.md')
  const flat = validate.replace(/\s+/g, ' ')
  // The step is CONDITIONAL on the sealed LAW carrying the Perceptual table — a run
  // with no table skips it entirely and validate behaves as it always did.
  assert.ok(flat.includes('only when the sealed `.kiln/LAW.md` carries a `## Perceptual` table'),
    'the capture step keys on the sealed LAW carrying the Perceptual table')
  assert.ok(flat.includes('references/screening-room.md'), 'the step executes the screening-room recipe, never an ad-hoc capture')
  // No-install is the law of the recipe and the card repeats it at both ends.
  assert.ok(flat.includes('npx --no-install playwright --version'), 'the runtime probe is no-install')
  assert.ok(flat.includes('a failed probe is your honest not-ok, never an install'),
    'a missing runtime is the honest act failure, never an install')
  // The evidence discipline: reserved generation, manifest-last, temp + rename.
  assert.ok(flat.includes('reserve a fresh evidence generation under `.kiln/evidence/`'),
    'the step reserves its generation with the recipe allocator')
  assert.ok(flat.includes('publish its `manifest.json` LAST via temp + rename'), 'manifest-last rides the card')
  // The contract is binary: a COMPLETE manifest or an honest not-ok — one bounded retry.
  assert.ok(flat.includes('CONTRACT is a COMPLETE manifest'), 'the contract is a complete manifest')
  assert.ok(flat.includes('Retry ONCE with a fresh generation'), 'one bounded internal retry on incompleteness')
  assert.ok(flat.includes('Never a partial manifest passed off as done, never an install'),
    'no partial manifest ever passes as done')
  // The Return contract carries the capture condition — and only that addition.
  assert.ok(flat.includes('when step 4 was live, its COMPLETE manifest is published'),
    'facts.status ok requires the published complete manifest when the capture was live')
})

test('validate card (W8-S3/I): the Perceptual addendum section — kernel-launched only, PASS/PARTIAL grades only, the truthful re-emitted beat', () => {
  const validate = cardText('validate.md')
  const flat = validate.replace(/\s+/g, ' ')
  assert.ok(validate.includes('## Perceptual addendum'), 'the addendum section exists as act 2')
  assert.ok(flat.includes('only when the kernel launches it'), 'act 2 is kernel-launched, never self-started')
  assert.ok(flat.includes('.kiln/screen-review.json'), 'it reads the published perceptual verdict')
  assert.ok(flat.includes('`PASS` and `PARTIAL` ONLY'), 'grades are the closed pair')
  assert.ok(flat.includes('`FAIL` belongs to the deterministic proxies'), 'FAIL stays with check.sh and the law-red door')
  assert.ok(flat.includes('Re-emit the truthful stage beat'), 'the addendum re-emits the stage beat truthfully')
  assert.ok(flat.includes('never `SEALED`'), 'a held run never wears the sealed title')
})

test('report card (W8-S4/I): the held-run variant — marker-selected, the honest held banner, the disclosure from the record, unchanged when absent', () => {
  const report = cardText('report.md')
  const flat = report.replace(/\s+/g, ' ')
  // The marker is a named INPUT, the .kiln/degraded precedent — one closed presence fact.
  const inputs = report.slice(report.indexOf('## Inputs'), report.indexOf('## Method')).replace(/\s+/g, ' ')
  assert.ok(inputs.includes('`.kiln/perceptual-partial` (presence = a semantic perceptual hold stands'),
    'the marker rides Inputs as a presence fact')
  assert.ok(inputs.includes('`.kiln/screen-escalation.txt`') && inputs.includes('read only when the marker is present'),
    'the escalation record is an input read only on the held variant')
  // The held banner: HELD title, never SEALED; the meter reflects the hold; no quote foot.
  assert.ok(flat.includes('`HELD` **Report — the run stands held at validate'), 'the held title unit names the hold')
  assert.ok(flat.includes('the meter reflects the hold'), 'the meter block tells the hold before the measured line')
  assert.ok(flat.includes('`{driver}` untouched'), '{driver} stays DRIVER-filled on both variants')
  assert.ok(flat.includes('a HELD card omits the quote foot'), 'the sealed foot law: no foot on the held variant')
  // The disclosure derives from the record alone: the validate.md rows and the record line.
  assert.ok(flat.includes("THE SCREEN'S DOUBT"), 'the disclosure block exists on the held variant')
  assert.ok(flat.includes('criterion id · dim · proxy exit · grade verbatim'),
    'the rows ride verbatim from .kiln/validate.md — all four fields of the canonical producer shape, the proxy exit included')
  assert.ok(flat.includes('CORROBORATED') && flat.includes('CONTESTED'), 'the corroborated/contested line rides when the record carries it')
  // Absent marker: the card is unchanged.
  assert.ok(flat.includes('When the marker is absent this section does not exist and the report is unchanged'),
    'no marker, no variant — the sealed composition stands untouched')
})

test('tiers (W8-S1/J): the remits gain the screening-room duties — models, efforts, and the twelve roles unchanged', () => {
  const tiers = JSON.parse(readFileSync(join(DATA, 'tiers.json'), 'utf8'))
  assert.equal(Object.keys(tiers.roles).length, 12, 'TIER_ROLES stays twelve — the screening room adds duties, never a seat')
  const gate = tiers.roles['reviewer-gate']
  assert.equal(gate.family, 'gpt'); assert.equal(gate.alias, 'gpt-sol'); assert.equal(gate.effort, 'high')
  assert.match(gate.note, /at the BUILD gate/, 'the taste exclusion is rescoped to the build-gate context')
  assert.match(gate.note, /out of the build-gate remit/, 'taste stays the builder\'s at the build gate — never a build finding')
  assert.match(gate.note, /SCREENING ROOM \(W8\)/, 'the seat gains the screening-room perceptual-grading duty')
  assert.match(gate.note, /perceptual-rubric\.json/, 'it grades against the shipped instrument')
  assert.match(gate.note, /does not reach the screening room/, 'the exclusion is scoped, not extended — graded residue is the duty there')
  const fb = tiers.roles['fallback-reviewer']
  assert.equal(fb.family, 'claude'); assert.equal(fb.alias, 'opus'); assert.equal(fb.effort, 'high')
  assert.match(fb.note, /SECOND grader/, 'the claude seat is the perceptual second grader on escalation')
  assert.match(fb.note, /PRIMARY grader when every perceptual owner is GPT-coded/, 'and the primary for GPT-coded surfaces — the fresh-mind family rule')
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
  for (const artifact of ['.kiln/STATE.md', '.kiln/LAW.md', '.kiln/decisions.md', '.kiln/seals.log', '.kiln/validate.md', '.kiln/degraded', '.kiln/perceptual-partial', '.kiln/screen-escalation.txt']) {
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
