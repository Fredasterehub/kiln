#!/usr/bin/env node
// kiln-vision.mjs — the VISION v3 gate CLI. Zero dependencies, node ≥18.
//
// .kiln/docs/VISION.md is a DERIVED artifact: compiled from the append-only brainstorm session
// ledger (.kiln/docs/brainstorm-ledger.jsonl) by a fresh-context agent whose sole source is the
// ledger — traceability is structural, never a vibe. This CLI is the arithmetic under that
// arrangement: the gate is a validator's counting, never phase-completion theater.
//
//   validate <visionFile> [--json]
//       The POST-COMPILE gate. Frontmatter (the authoritative machine surface — a zero-dep YAML
//       subset: scalars + single-key JSON values, wrappable to the next top-level key) is
//       schema-validated field-for-field (validateVisionFrontmatter mirrors
//       schemas/vision.schema.json — no ajv). Body: every ## section title present exactly once
//       and no unknown sections (the section universe is closed — downstream stages key on
//       titles); countable families counted by LINE GRAMMAR inside their own section
//       (- **FR-N**: · - **SC-N**: · - **S-N (P1|P2|P3)**: · - **A-N**: · - **OQ-N**: — ids
//       unique per family) and each frontmatter count must EQUAL its body count (a lying count
//       is a broken artifact); '[NEEDS CLARIFICATION' markers counted body-wide and must equal
//       counts.unresolved_clarifications, with status gated|approved demanding ZERO; the
//       frontmatter open_questions id set must equal the body section's id set (the frontmatter
//       is authoritative — research parses priority/timing from it; the section is the human
//       mirror); visual_direction BOTH ways — false ⇔ the Visual Direction body is EXACTLY the
//       decline line, true ⇔ substantive (non-empty, not the decline line). HTML comments are
//       template scaffolding and are stripped before body analysis.
//   ledger-gate <ledgerFile> [--json]
//       The PRE-COMPILE floor vision.js runs FIRST — an incomplete ledger can never compile,
//       whoever invokes the workflow. The ledger parses line-by-line (each line a JSON object,
//       seq strictly increasing, type from the closed set below); it must END with a terminal
//       session_complete (da-vinci's last append before signaling); every REQUIRED-INTENT
//       section's LATEST section_intent must be approved (13 content sections — Open Questions,
//       Assumptions Ledger, and Elicitation Log are DERIVED: the compiler builds them from
//       clarification/assumption/elicitation events, no intent needed); a clarify_pass event
//       must exist and every clarification's latest event must be resolved or operator-
//       acknowledged; a floor event (met|waived) must exist; every idea must carry authorship
//       (by: operator|coach — the stance contract's audit trail).
//
// Both commands print one --json object on stdout whichever way the VERDICT goes (valid or
// violations); infra/usage errors (missing file, empty ledger, unknown flag) die to stderr with
// exit 1 and no JSON — the kiln-law idiom: a caller seeing nonzero-without-JSON knows the
// command itself failed, not the artifact.
// The verdict payload:
//   {schema: 1, valid, violations: [{code, path, message}], summary: {status, tier,
//    visual_direction, counts, unresolved}}   (ledger-gate's summary carries {events, ideas,
//    tier, express} instead) — vision.js reads tier/counts/visual_direction from the SUCCESS
// payload, so the shape is identical on both paths (the P3.6 law_violations idiom).
// Human mode prints one VISION_INVALID / LEDGER_INVALID line per violation + a summary line.
// Exit codes: 0 valid · 1 violations or usage/infra · 2 reserved. This CLI never writes.
//
// Usage:
//   kiln-vision.mjs validate    <visionFile> [--json]
//   kiln-vision.mjs ledger-gate <ledgerFile> [--json]

import { readFileSync, existsSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'

const die = (msg, code = 1) => { console.error(`kiln-vision: ${msg}`); process.exit(code) }

import { DECLINE_LINE, SECTION_TITLES, REQUIRED_INTENT_SECTIONS, LEDGER_TYPES, parseVisionFrontmatter, validateVisionFrontmatter } from '../src/vision.mjs'

// ── the countable line grammars (CLI-local: the gate is the only consumer) ──────────────────────
// One entry per line, ids unique per family, counted ONLY inside the family's own section.
// \d+ is the contract; zero-padding is style.
const GRAMMARS = {
  frs: { section: 'Functional Requirements', re: /^- \*\*FR-(\d+)\*\*: /, family: 'FR' },
  scs: { section: 'Success Criteria', re: /^- \*\*SC-(\d+)\*\*: /, family: 'SC' },
  stories: { section: 'User Stories', re: /^- \*\*S-(\d+) \(P[123]\)\*\*: /, family: 'S' },
  assumptions: { section: 'Assumptions Ledger', re: /^- \*\*A-(\d+)\*\*: /, family: 'A' },
  open_questions: { section: 'Open Questions', re: /^- \*\*OQ-(\d+)\*\*: /, family: 'OQ' },
}
const MARKER = '[NEEDS CLARIFICATION'

// ── validate — the post-compile gate ─────────────────────────────────────────────────────────────
function cmdValidate(visionFile, flags) {
  const violations = []
  const err = (code, path, message) => violations.push({ code, path, message })
  if (!existsSync(visionFile)) die(`no VISION at ${visionFile} — the compiler has not written it`)
  const raw = readFileSync(visionFile, 'utf8')
  const fm = parseVisionFrontmatter(raw, err)
  if (fm) validateVisionFrontmatter(fm, err)

  // Body analysis — comments are template scaffolding, stripped before anything counts. The
  // frontmatter terminator is a line that is EXACTLY --- (matching parseVisionFrontmatter).
  let body = raw
  if (raw.startsWith('---\n')) {
    const all = raw.slice(4).split('\n')
    const endIdx = all.findIndex((l) => l === '---')
    if (endIdx !== -1) body = all.slice(endIdx + 1).join('\n')
  }
  body = body.replace(/<!--[\s\S]*?-->/g, '')
  const found = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
  for (const t of SECTION_TITLES) {
    const n = found.filter((x) => x === t).length
    if (n === 0) err('missing_section', `section.${t}`, `missing section '## ${t}' — downstream stages key on the exact title`)
    else if (n > 1) err('duplicate_section', `section.${t}`, `section '## ${t}' appears ${n} times — exactly once`)
  }
  for (const t of found) if (!SECTION_TITLES.includes(t)) err('unknown_section', `section.${t}`, `unknown section '## ${t}' — the section universe is closed (machine-first artifact)`)

  // Slice the body into named sections (first occurrence wins; duplicates already flagged).
  const sections = {}
  const parts = body.split(/^## /m).slice(1)
  for (const p of parts) {
    const nl = p.indexOf('\n')
    const title = (nl === -1 ? p : p.slice(0, nl)).trim()
    if (!(title in sections)) sections[title] = nl === -1 ? '' : p.slice(nl + 1)
  }

  // Line-grammar counts + per-family id uniqueness, INSIDE the family's own section only.
  const counts = {}
  for (const [key, g] of Object.entries(GRAMMARS)) {
    const text = sections[g.section] || ''
    const ids = []
    for (const line of text.split('\n')) {
      const m = line.match(g.re)
      if (m) ids.push(`${g.family}-${m[1]}`)
    }
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    for (const d of [...new Set(dupes)]) err('duplicate_id', `section.${g.section}.${d}`, `duplicate id '${d}' in '${g.section}' — ids are unique per family`)
    counts[key] = ids.length
    if (fm && fm.counts && Number.isInteger(fm.counts[key]) && fm.counts[key] !== ids.length) {
      err('count_mismatch', `frontmatter.counts.${key}`, `counts.${key} says ${fm.counts[key]} but the '${g.section}' section carries ${ids.length} grammar line(s) — a lying count is a broken artifact`)
    }
    if (key === 'open_questions' && fm && Array.isArray(fm.open_questions)) {
      const fmIds = fm.open_questions.map((q) => q && q.id).filter(Boolean).sort()
      const bodyIds = [...new Set(ids)].sort()
      if (JSON.stringify(fmIds) !== JSON.stringify(bodyIds)) {
        err('oq_mismatch', 'frontmatter.open_questions', `frontmatter OQ ids [${fmIds.join(', ')}] ≠ body section ids [${bodyIds.join(', ')}] — the frontmatter is authoritative and the section is its mirror`)
      }
    }
  }

  // Markers: body-wide count must match the frontmatter, and a gated/approved VISION carries none.
  const unresolved = body.split(MARKER).length - 1
  if (fm && fm.counts && Number.isInteger(fm.counts.unresolved_clarifications) && fm.counts.unresolved_clarifications !== unresolved) {
    err('count_mismatch', 'frontmatter.counts.unresolved_clarifications', `counts.unresolved_clarifications says ${fm.counts.unresolved_clarifications} but the body carries ${unresolved} '${MARKER}' marker(s)`)
  }
  if (fm && (fm.status === 'gated' || fm.status === 'approved') && unresolved > 0) {
    err('gate_blocked', 'frontmatter.status', `status '${fm.status}' demands zero unresolved clarifications — the body carries ${unresolved} (resolve them, or the operator acknowledges each into the Assumptions Ledger)`)
  }

  // visual_direction, BOTH ways: the boolean is authoritative and may not lie.
  const vd = (sections['Visual Direction'] || '').trim()
  if (fm && fm.visual_direction === false && vd !== DECLINE_LINE) {
    err('visual_direction_mismatch', 'frontmatter.visual_direction', `visual_direction: false requires the Visual Direction section to be exactly the decline line — it is not`)
  }
  if (fm && fm.visual_direction === true && (vd === '' || vd === DECLINE_LINE)) {
    err('visual_direction_mismatch', 'frontmatter.visual_direction', `visual_direction: true requires a substantive Visual Direction section — it is ${vd === '' ? 'empty' : 'the decline line'}`)
  }

  const summary = {
    status: fm ? fm.status ?? null : null,
    tier: fm ? fm.tier ?? null : null,
    visual_direction: fm ? fm.visual_direction ?? null : null,
    counts,
    unresolved,
  }
  report('VISION', violations, summary, flags)
}

// ── ledger-gate — the pre-compile floor ──────────────────────────────────────────────────────────
function cmdLedgerGate(ledgerFile, flags) {
  const violations = []
  const err = (code, path, message) => violations.push({ code, path, message })
  if (!existsSync(ledgerFile)) die(`no ledger at ${ledgerFile} — the brainstorm session never wrote one`)
  // Every PHYSICAL line must parse — an interior blank line is corruption evidence in an
  // append-only JSONL; only the single trailing newline is legal.
  const rawLines = readFileSync(ledgerFile, 'utf8').split('\n')
  if (rawLines[rawLines.length - 1] === '') rawLines.pop()
  const lines = rawLines
  if (!lines.length) die(`the ledger at ${ledgerFile} is empty — nothing to gate`)
  const events = []
  let lastSeq = 0
  lines.forEach((line, i) => {
    if (line === '') { err('invalid_line', `ledger[${i + 1}]`, `line ${i + 1} is blank — an append-only ledger has no interior blank lines`); return }
    let ev
    try { ev = JSON.parse(line) } catch (e) { err('invalid_line', `ledger[${i + 1}]`, `line ${i + 1} is not JSON — ${e.message}`); return }
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) { err('invalid_line', `ledger[${i + 1}]`, `line ${i + 1} must be a JSON object`); return }
    if (!Number.isInteger(ev.seq) || ev.seq <= lastSeq) err('seq_order', `ledger[${i + 1}].seq`, `line ${i + 1}: seq must be a strictly increasing integer (got ${JSON.stringify(ev.seq)} after ${lastSeq}) — the ledger is append-only, never edited or reordered`)
    else lastSeq = ev.seq
    if (!LEDGER_TYPES.includes(ev.type)) err('unknown_type', `ledger[${i + 1}].type`, `line ${i + 1}: unknown event type '${ev.type}' — the vocabulary is closed (${LEDGER_TYPES.join(', ')})`)
    if (ev.type === 'idea' && !(ev.data && ['operator', 'coach'].includes(ev.data.by))) {
      err('missing_authorship', `ledger[${i + 1}].data.by`, `line ${i + 1}: every idea carries authorship by: operator|coach — the stance contract's audit trail`)
    }
    if (ev.type === 'clarification' && !(ev.data && typeof ev.data.marker === 'string' && ev.data.marker !== '')) {
      err('invalid_value', `ledger[${i + 1}].data.marker`, `line ${i + 1}: every clarification carries a nonempty marker string — a marker-less clarification would evade the resolved-or-acknowledged rule`)
    }
    events.push(ev)
  })

  // Terminal: session_complete is da-vinci's LAST append before signaling.
  const completeIdx = events.findIndex((e) => e.type === 'session_complete')
  if (completeIdx === -1) err('incomplete_session', 'ledger.session_complete', `no session_complete event — the session never finished; an incomplete ledger can never compile`)
  else if (completeIdx !== events.length - 1) err('incomplete_session', 'ledger.session_complete', `session_complete must be the ledger's LAST event (found at position ${completeIdx + 1} of ${events.length})`)

  // Required-intent sections: the LATEST section_intent per content section must be approved.
  const latestIntent = {}
  for (const e of events) if (e.type === 'section_intent' && e.data && typeof e.data.section === 'string') latestIntent[e.data.section] = e
  for (const s of REQUIRED_INTENT_SECTIONS) {
    const it = latestIntent[s]
    if (!it) err('missing_intent', `ledger.section_intent.${s}`, `no section_intent for '${s}' — every content section is drafted from the ledger and operator-approved before compile`)
    else if (it.data.approved !== true) err('unapproved_intent', `ledger.section_intent.${s}`, `the latest section_intent for '${s}' is not approved — the operator's approval is the compile license`)
  }

  // Clarify pass ran, and every clarification's LATEST event is resolved or operator-acknowledged.
  if (!events.some((e) => e.type === 'clarify_pass')) err('missing_clarify_pass', 'ledger.clarify_pass', `no clarify_pass event — the pass that walks markers + assumptions with the operator is a hard MUST`)
  const latestClar = {}
  for (const e of events) if (e.type === 'clarification' && e.data && typeof e.data.marker === 'string') latestClar[e.data.marker] = e
  for (const [marker, e] of Object.entries(latestClar)) {
    if (e.data.resolved !== true && e.data.acknowledged !== true) {
      err('unresolved_clarification', 'ledger.clarification', `clarification '${marker}' is neither resolved nor operator-acknowledged — the gate demands zero unresolved`)
    }
  }

  // The floor: met or explicitly waived — silent drift below it is the failure mode.
  const floor = events.filter((e) => e.type === 'floor').pop()
  if (!floor) err('missing_floor', 'ledger.floor', `no floor event — the tier's idea floor must be met or explicitly waived, never silently drifted under`)
  else if (!(floor.data && ['met', 'waived'].includes(floor.data.state))) err('invalid_value', 'ledger.floor.state', `floor.state must be met|waived (got ${JSON.stringify(floor.data && floor.data.state)})`)

  const meta = events.find((e) => e.type === 'session_meta')
  const summary = {
    events: events.length,
    ideas: events.filter((e) => e.type === 'idea').length,
    tier: (meta && meta.data && meta.data.tier) || null,
    express: events.some((e) => e.type === 'express_payload'),
  }
  report('LEDGER', violations, summary, flags)
}

// ── shared verdict reporting — one payload shape whichever way it goes ───────────────────────────
function report(kind, violations, summary, flags) {
  const valid = violations.length === 0
  if (flags.json) {
    console.log(JSON.stringify({ schema: 1, valid, violations, summary }))
  } else {
    for (const v of violations) console.log(`${kind}_INVALID ${v.path}: ${v.message}`)
    console.log(`${kind}_RESULT valid=${valid} violations=${violations.length} ${Object.entries(summary).map(([k, v]) => `${k}=${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join(' ')}`)
  }
  process.exit(valid ? 0 : 1)
}

// ── dispatch ─────────────────────────────────────────────────────────────────────────────────────
const USAGE = `usage: kiln-vision.mjs <validate|ledger-gate> <file> [--json]`
const [cmd, file, ...rest] = process.argv.slice(2)
const flags = {}
for (const a of rest) {
  if (a === '--json') flags.json = true
  else die(`unknown flag ${a}\n${USAGE}`)
}
if (!cmd || !file) die(USAGE)
const abs = isAbsolute(file) ? file : resolve(file)
try {
  if (cmd === 'validate') cmdValidate(abs, flags)
  else if (cmd === 'ledger-gate') cmdLedgerGate(abs, flags)
  else die(USAGE)
} catch (e) {
  die(e.message)
}
