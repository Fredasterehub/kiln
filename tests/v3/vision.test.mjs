// vision.test.mjs — P4 T1 acceptance: the VISION v3 format contract + the deterministic gate
// (BLUEPRINT §10 change 6 + the P4 contract review rulings). Two floors:
//   1. scripts/kiln-vision.mjs validate — the POST-COMPILE gate: frontmatter schema mirror,
//      closed section universe, line-grammar counts vs frontmatter counts (a lying count is a
//      broken artifact), marker arithmetic + the gated-status zero rule, frontmatter↔section OQ
//      id-set equality, and visual_direction BOTH ways (r1 F2). The shipped template validates
//      clean at draft — the template demonstrates its own contract.
//   2. scripts/kiln-vision.mjs ledger-gate — the PRE-COMPILE floor (r1 F3): session_complete
//      terminal, latest-intent approval for the 13 content sections, clarify-pass presence +
//      zero unresolved clarifications, the floor event, seq monotonicity, idea authorship.
// Both commands emit the SAME --json payload shape on success and failure (the r2 watch item —
// vision.js reads tier/counts/visual_direction from the success payload).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SECTION_TITLES, REQUIRED_INTENT_SECTIONS, DECLINE_LINE, LEDGER_TYPES } from '../../plugins/kiln/src/vision.mjs'

const CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-vision.mjs', import.meta.url))
const TEMPLATE = fileURLToPath(new URL('../../plugins/kiln/templates/VISION.md', import.meta.url))
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const jsonOf = (res) => JSON.parse(res.stdout)

// ── the filled-VISION fixture factory — a small, arithmetic-consistent v3 document ──────────────
function makeVision(over = {}) {
  const fm = {
    status: 'gated', tier: 'standard', visual_direction: true,
    session: { ideas: 14 },
    counts: { frs: 2, scs: 2, stories: 1, assumptions: 1, unresolved_clarifications: 0, open_questions: 1 },
    open_questions: [{ id: 'OQ-1', question: 'Which auth provider?', priority: 'high', timing: 'before-build', context: 'blocks the login slice' }],
    ...over.frontmatter,
  }
  const sections = {
    'Problem Statement': 'Bookmark rot.',
    'Target Users': 'Solo devs.',
    'Goals': '1. Ship it.',
    'Functional Requirements': '- **FR-1**: MUST store bookmarks.\n- **FR-2**: MUST list bookmarks.',
    'User Stories': '- **S-1 (P1)**: As a dev I save a link and find it later.',
    'Success Criteria': '- **SC-1**: `bm add` then `bm list` shows the entry.\n- **SC-2**: the store survives restart.',
    'Non-Goals': 'No sync.',
    'Key Entities': 'Bookmark.',
    'Constraints': 'Node only.',
    'Tech Stack': 'Let Kiln decide.',
    'Risks & Unknowns': 'Low.',
    'Open Questions': '- **OQ-1**: Which auth provider?',
    'Key Decisions': 'CLI-first.',
    'Assumptions Ledger': '- **A-1**: JSON file store — the operator never named one.',
    'Elicitation Log': 'first-principles; scamper.',
    'Visual Direction': 'Terminal aesthetic: dense, monospaced, calm colors.',
    ...over.sections,
  }
  const fmLines = [
    'schema: 1', `status: ${fm.status}`, `tier: ${fm.tier}`, `visual_direction: ${fm.visual_direction}`,
    `session: ${JSON.stringify(fm.session)}`, `counts: ${JSON.stringify(fm.counts)}`,
    `open_questions: ${JSON.stringify(fm.open_questions)}`,
  ]
  const body = SECTION_TITLES.filter((t) => sections[t] !== null)
    .map((t) => `## ${t}\n\n${sections[t]}\n`).join('\n')
  return `---\n${fmLines.join('\n')}\n---\n\n${body}`
}
function withVision(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-vision-test-'))
  const f = join(dir, 'VISION.md')
  writeFileSync(f, content)
  try { return fn(f) } finally { rmSync(dir, { recursive: true, force: true }) }
}
const codesOf = (res) => jsonOf(res).violations.map((v) => v.code)

// ── 1. validate — the post-compile gate ──────────────────────────────────────────────────────────
test('validate: the SHIPPED template is arithmetic-consistent — validates clean at draft (the template demonstrates its own contract)', () => {
  const res = cli('validate', TEMPLATE, '--json')
  assert.equal(res.status, 0, res.stdout + res.stderr)
  const out = jsonOf(res)
  assert.equal(out.valid, true)
  assert.deepEqual(out.violations, [])
  assert.equal(out.summary.status, 'draft')
  assert.equal(out.summary.visual_direction, false, 'the template declines visual direction — frontmatter and decline line agree')
  assert.equal(out.summary.unresolved, 3, 'the three example-entry markers are counted honestly')
})

test('validate: a filled, consistent v3 VISION passes gated with zero unresolved — and the --json payload carries what vision.js threads onward', () => {
  withVision(makeVision(), (f) => {
    const res = cli('validate', f, '--json')
    assert.equal(res.status, 0, res.stdout + res.stderr)
    const out = jsonOf(res)
    assert.equal(out.valid, true)
    assert.equal(out.summary.tier, 'standard')
    assert.equal(out.summary.visual_direction, true, 'the conductor threads this into architecture args (r1 F6)')
    assert.deepEqual(out.summary.counts, { frs: 2, scs: 2, stories: 1, assumptions: 1, open_questions: 1 })
    assert.equal(out.summary.unresolved, 0)
  })
})

test('validate: a missing section and an unknown section are both violations — the section universe is CLOSED', () => {
  withVision(makeVision({ sections: { 'Non-Goals': null } }), (f) => {
    const res = cli('validate', f, '--json')
    assert.equal(res.status, 1)
    assert.ok(codesOf(res).includes('missing_section'))
  })
  withVision(makeVision() + '\n## Bonus Thoughts\n\nnope\n', (f) => {
    const res = cli('validate', f, '--json')
    assert.equal(res.status, 1)
    assert.ok(codesOf(res).includes('unknown_section'))
  })
  withVision(makeVision() + '\n## Goals\n\nagain\n', (f) => {
    assert.ok(codesOf(cli('validate', f, '--json')).includes('duplicate_section'), 'a duplicated title is a defect — exactly once')
  })
})

test('validate: the frontmatter terminator is a line that is EXACTLY --- (r1: a ---suffix line is not a fence)', () => {
  const broken = makeVision().replace(/\n---\n/, '\n---not-a-terminator\n')
  withVision(broken, (f) => {
    assert.ok(codesOf(cli('validate', f, '--json')).includes('missing_frontmatter'))
  })
})

test('validate: a lying count and a duplicate id are violations — counts are arithmetic over line grammars', () => {
  const lying = makeVision({ frontmatter: { counts: { frs: 5, scs: 2, stories: 1, assumptions: 1, unresolved_clarifications: 0, open_questions: 1 } } })
  withVision(lying, (f) => {
    const res = cli('validate', f, '--json')
    assert.equal(res.status, 1)
    const v = jsonOf(res).violations.find((x) => x.code === 'count_mismatch')
    assert.ok(v, 'count_mismatch raised')
    assert.match(v.message, /counts\.frs says 5 but .* 2 grammar line\(s\)/)
  })
  const dup = makeVision({ sections: { 'Functional Requirements': '- **FR-1**: MUST a.\n- **FR-1**: MUST b.' } })
  withVision(dup, (f) => {
    const res = cli('validate', f, '--json')
    assert.equal(res.status, 1)
    assert.ok(codesOf(res).includes('duplicate_id'))
  })
})

test('validate: an unresolved marker at gated status blocks — and the marker count must match the frontmatter', () => {
  const marked = makeVision({
    sections: { 'Constraints': 'Node only. [NEEDS CLARIFICATION: which node floor?]' },
    frontmatter: { counts: { frs: 2, scs: 2, stories: 1, assumptions: 1, unresolved_clarifications: 1, open_questions: 1 } },
  })
  withVision(marked, (f) => {
    const res = cli('validate', f, '--json')
    assert.equal(res.status, 1, 'gated + a marker = blocked')
    const codes = codesOf(res)
    assert.ok(codes.includes('gate_blocked'))
    assert.ok(!codes.includes('count_mismatch'), 'the count itself is honest — only the gate rule fires')
  })
  // same marker but the frontmatter lies about it
  const lying = makeVision({ sections: { 'Constraints': 'Node only. [NEEDS CLARIFICATION: which node floor?]' } })
  withVision(lying, (f) => {
    assert.ok(codesOf(cli('validate', f, '--json')).includes('count_mismatch'))
  })
})

test('validate: frontmatter OQ ids must equal the body section ids — the frontmatter is authoritative, the section is its mirror', () => {
  const drift = makeVision({ sections: { 'Open Questions': '- **OQ-2**: Something else?' } })
  withVision(drift, (f) => {
    const res = cli('validate', f, '--json')
    assert.equal(res.status, 1)
    const v = jsonOf(res).violations.find((x) => x.code === 'oq_mismatch')
    assert.ok(v)
    assert.match(v.message, /\[OQ-1\] ≠ body section ids \[OQ-2\]/)
  })
})

test('validate: visual_direction is checked BOTH ways (r1 F2) — false demands exactly the decline line, true demands substance', () => {
  const falseLying = makeVision({ frontmatter: { visual_direction: false } }) // body has real content
  withVision(falseLying, (f) => {
    assert.ok(codesOf(cli('validate', f, '--json')).includes('visual_direction_mismatch'))
  })
  const trueLying = makeVision({ sections: { 'Visual Direction': DECLINE_LINE } }) // fm says true
  withVision(trueLying, (f) => {
    assert.ok(codesOf(cli('validate', f, '--json')).includes('visual_direction_mismatch'))
  })
  const declined = makeVision({ frontmatter: { visual_direction: false }, sections: { 'Visual Direction': DECLINE_LINE } })
  withVision(declined, (f) => {
    assert.equal(cli('validate', f, '--json').status, 0, 'an honest decline passes')
  })
})

test('validate: frontmatter defects are typed — missing block, bad JSON value, unknown key, bad enum', () => {
  withVision('no frontmatter at all\n', (f) => {
    assert.ok(codesOf(cli('validate', f, '--json')).includes('missing_frontmatter'))
  })
  withVision(makeVision().replace(/^session: .*$/m, 'session: {nope}'), (f) => {
    assert.ok(codesOf(cli('validate', f, '--json')).includes('invalid_frontmatter_json'))
  })
  withVision(makeVision().replace('tier: standard', 'tier: standard\nbanana: 7'), (f) => {
    assert.ok(codesOf(cli('validate', f, '--json')).includes('unknown_key'))
  })
  withVision(makeVision().replace('status: gated', 'status: shipped'), (f) => {
    assert.ok(codesOf(cli('validate', f, '--json')).includes('invalid_value'))
  })
})

test('validate: usage — missing file dies exit 1; the CLI never writes', () => {
  const res = cli('validate', '/tmp/kiln-vision-nonexistent/VISION.md')
  assert.equal(res.status, 1)
  assert.match(res.stderr, /no VISION at/)
})

// ── 2. ledger-gate — the pre-compile floor (r1 F3) ───────────────────────────────────────────────
function makeLedger(mutate = (evs) => evs) {
  let seq = 0
  const ev = (type, data = {}) => ({ seq: ++seq, type, data })
  let evs = [
    ev('session_meta', { tier: 'light' }),
    ev('idea', { text: 'a bookmarks CLI', by: 'operator' }),
    ev('idea', { text: 'tag search', by: 'operator' }),
    ...REQUIRED_INTENT_SECTIONS.map((s) => ev('section_intent', { section: s, content: '…', approved: true })),
    ev('clarification', { marker: 'which auth?', resolved: false, acknowledged: true }),
    ev('clarify_pass', { unresolved: 0 }),
    ev('floor', { state: 'met', count: 12 }),
    ev('session_complete', { sections_approved: REQUIRED_INTENT_SECTIONS.length }),
  ]
  evs = mutate(evs)
  return evs.map((e) => JSON.stringify(e)).join('\n') + '\n'
}
function withLedger(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-vision-ledger-test-'))
  const f = join(dir, 'brainstorm-ledger.jsonl')
  writeFileSync(f, content)
  try { return fn(f) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('ledger-gate: a complete session passes — and the summary carries the tier + idea provenance vision.js reads', () => {
  withLedger(makeLedger(), (f) => {
    const res = cli('ledger-gate', f, '--json')
    assert.equal(res.status, 0, res.stdout + res.stderr)
    const out = jsonOf(res)
    assert.equal(out.valid, true)
    // 1 session_meta + 2 ideas + 13 intents + 1 clarification + clarify_pass + floor + session_complete
    assert.deepEqual(out.summary, { events: 7 + REQUIRED_INTENT_SECTIONS.length, ideas: 2, tier: 'light', express: false })
  })
})

test('ledger-gate: an incomplete ledger can NEVER compile — each missing leg is a typed refusal', () => {
  const drills = [
    [(evs) => evs.filter((e) => e.type !== 'session_complete'), 'incomplete_session'],
    [(evs) => evs.map((e) => (e.type === 'section_intent' && e.data.section === 'Goals' ? { ...e, data: { ...e.data, approved: false } } : e)), 'unapproved_intent'],
    [(evs) => evs.filter((e) => !(e.type === 'section_intent' && e.data.section === 'Goals')), 'missing_intent'],
    [(evs) => evs.filter((e) => e.type !== 'clarify_pass'), 'missing_clarify_pass'],
    [(evs) => evs.filter((e) => e.type !== 'floor'), 'missing_floor'],
    [(evs) => evs.map((e) => (e.type === 'clarification' ? { ...e, data: { marker: 'which auth?', resolved: false, acknowledged: false } } : e)), 'unresolved_clarification'],
  ]
  for (const [mutate, code] of drills) {
    withLedger(makeLedger(mutate), (f) => {
      const res = cli('ledger-gate', f, '--json')
      assert.equal(res.status, 1, `${code}: must refuse`)
      assert.ok(codesOf(res).includes(code), `${code} raised — got [${codesOf(res).join(', ')}]`)
    })
  }
})

test('ledger-gate: session_complete must be the LAST event — a mid-ledger terminal is a defect, not a completion', () => {
  withLedger(makeLedger((evs) => {
    const done = evs.find((e) => e.type === 'session_complete')
    const rest = evs.filter((e) => e !== done)
    return [...rest.slice(0, 3), done, ...rest.slice(3)]
  }), (f) => {
    const res = cli('ledger-gate', f, '--json')
    assert.equal(res.status, 1)
    const v = jsonOf(res).violations.find((x) => x.code === 'incomplete_session')
    assert.match(v.message, /must be the ledger's LAST event/)
  })
})

test('ledger-gate: append-only discipline — seq must strictly increase, lines must be JSON objects, the type vocabulary is closed, ideas carry authorship', () => {
  withLedger(makeLedger((evs) => evs.map((e, i) => (i === 4 ? { ...e, seq: 2 } : e))), (f) => {
    assert.ok(codesOf(cli('ledger-gate', f, '--json')).includes('seq_order'))
  })
  withLedger('{"seq":1,"type":"session_meta","data":{}}\nnot json\n', (f) => {
    assert.ok(codesOf(cli('ledger-gate', f, '--json')).includes('invalid_line'))
  })
  withLedger(makeLedger((evs) => [...evs.slice(0, -1), { seq: 98, type: 'vibe', data: {} }, { seq: 99, type: 'session_complete', data: {} }]), (f) => {
    assert.ok(codesOf(cli('ledger-gate', f, '--json')).includes('unknown_type'))
  })
  withLedger(makeLedger((evs) => evs.map((e) => (e.type === 'idea' ? { ...e, data: { text: e.data.text } } : e))), (f) => {
    assert.ok(codesOf(cli('ledger-gate', f, '--json')).includes('missing_authorship'))
  })
  // r1: an interior blank line is corruption evidence; only the trailing newline is legal
  withLedger(makeLedger().replace('\n{"seq":2', '\n\n{"seq":2'), (f) => {
    const codes = codesOf(cli('ledger-gate', f, '--json'))
    assert.ok(codes.includes('invalid_line'), 'interior blank line flagged')
  })
  withLedger(makeLedger(), (f) => {
    assert.equal(cli('ledger-gate', f, '--json').status, 0, 'the single trailing newline stays legal')
  })
  // r1: a marker-less clarification cannot evade the resolved-or-acknowledged rule
  withLedger(makeLedger((evs) => evs.map((e) => (e.type === 'clarification' ? { ...e, data: { resolved: false, acknowledged: false } } : e))), (f) => {
    const codes = codesOf(cli('ledger-gate', f, '--json'))
    assert.ok(codes.includes('invalid_value'), `a clarification without a marker is itself a typed defect — got [${codes.join(', ')}]`)
  })
})

test('ledger-gate: usage — a missing or empty ledger dies exit 1 (nothing to gate)', () => {
  assert.match(cli('ledger-gate', '/tmp/kiln-vision-nonexistent/ledger.jsonl').stderr, /no ledger at/)
  withLedger('', (f) => {
    const res = cli('ledger-gate', f)
    assert.equal(res.status, 1)
    assert.match(res.stderr, /is empty/)
  })
})

// ── 3. the exported constants ARE the contract other surfaces import ─────────────────────────────
test('contract constants: 16 stable section titles, 13 required-intent sections, the closed ledger vocabulary', () => {
  assert.equal(SECTION_TITLES.length, 16)
  assert.equal(REQUIRED_INTENT_SECTIONS.length, 13)
  for (const derived of ['Open Questions', 'Assumptions Ledger', 'Elicitation Log']) {
    assert.ok(SECTION_TITLES.includes(derived) && !REQUIRED_INTENT_SECTIONS.includes(derived), `${derived} is a DERIVED section — compiled from ledger events, no intent needed`)
  }
  assert.equal(DECLINE_LINE, 'No visual direction specified. Build will proceed without design system generation.', 'the v2 decline bytes survive — architecture branches on them for pre-v3 VISIONs')
  assert.equal(LEDGER_TYPES.length, 12)
  assert.ok(LEDGER_TYPES.includes('session_complete') && LEDGER_TYPES.includes('clarify_pass') && LEDGER_TYPES.includes('floor'), 'the r1 F3 completion events are first-class vocabulary')
})
