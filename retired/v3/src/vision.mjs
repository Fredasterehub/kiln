// vision.mjs — the VISION v3 pure core: the format constants and the
// frontmatter contract. Consumed by scripts/kiln-vision.mjs (the gate CLI) and importable by the
// harness; inlinable into workflows by scripts/bundle-workflows.mjs where a script needs the
// constants. Pure: no I/O, no clocks — workflow determinism rules apply here.
//
// Bundler discipline: each export is a self-contained block (no shared module-level helpers —
// they would not survive inlining). REQUIRED_INTENT_SECTIONS is therefore a literal, not a
// derivation from SECTION_TITLES; the harness asserts the relationship between them.

// The v2 decline bytes — architecture's foundation agent branches on them for pre-v3 VISIONs,
// and the v3 validator byte-checks them against visual_direction: false.
export const DECLINE_LINE = 'No visual direction specified. Build will proceed without design system generation.'

// The 16 stable section titles — the CLOSED section universe downstream stages key on.
export const SECTION_TITLES = [
  'Problem Statement', 'Target Users', 'Goals', 'Functional Requirements', 'User Stories',
  'Success Criteria', 'Non-Goals', 'Key Entities', 'Constraints', 'Tech Stack',
  'Risks & Unknowns', 'Open Questions', 'Key Decisions', 'Assumptions Ledger',
  'Elicitation Log', 'Visual Direction',
]

// The 13 CONTENT sections whose latest section_intent must be operator-approved in the
// brainstorm ledger before compile; Open Questions / Assumptions Ledger / Elicitation Log are
// DERIVED — the compiler builds them from clarification/assumption/elicitation events directly.
export const REQUIRED_INTENT_SECTIONS = [
  'Problem Statement', 'Target Users', 'Goals', 'Functional Requirements', 'User Stories',
  'Success Criteria', 'Non-Goals', 'Key Entities', 'Constraints', 'Tech Stack',
  'Risks & Unknowns', 'Key Decisions', 'Visual Direction',
]

// The brainstorm session ledger's closed event vocabulary (.kiln/docs/brainstorm-ledger.jsonl —
// append-only, one JSON object per line, seq strictly increasing; da-vinci appends, the
// fresh-context compiler consumes, kiln-vision ledger-gate arbitrates).
export const LEDGER_TYPES = [
  'session_meta', 'idea', 'theme', 'decision', 'assumption', 'clarification', 'section_intent',
  'style_probe', 'clarify_pass', 'floor', 'express_payload', 'session_complete',
]

// parseVisionFrontmatter(text, err) — the zero-dep frontmatter subset: the block sits between
// leading and terminating --- lines; top-level keys at column 0 (/^[a-z_]+:/); a structured
// value ({…}/[…]) is single-key JSON and may wrap onto following lines until the next top-level
// key; scalars coerce (integer, true/false, else the bare string). err is the typed collector
// ({code, path, message}); returns the parsed object or null when no block exists.
export function parseVisionFrontmatter(text, err) {
  if (!text.startsWith('---\n')) { err('missing_frontmatter', 'frontmatter', 'VISION must open with a --- frontmatter block (the authoritative machine surface)'); return null }
  // The terminator is a line that is EXACTLY --- ('\n---' alone would accept
  // '---not-a-terminator' as a closing fence).
  const all = text.slice(4).split('\n')
  const endIdx = all.findIndex((l) => l === '---')
  if (endIdx === -1) { err('missing_frontmatter', 'frontmatter', 'the frontmatter block never closes (no terminating --- line)'); return null }
  const lines = all.slice(0, endIdx)
  const fm = {}
  let key = null
  let buf = ''
  const commit = () => {
    if (key === null) return
    const raw = buf.trim()
    let value
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try { value = JSON.parse(raw) } catch (e) { err('invalid_frontmatter_json', `frontmatter.${key}`, `frontmatter.${key}: structured values are single-key JSON — ${e.message}`); key = null; buf = ''; return }
    } else if (/^-?\d+$/.test(raw)) value = Number(raw)
    else if (raw === 'true' || raw === 'false') value = raw === 'true'
    else value = raw
    fm[key] = value
    key = null
    buf = ''
  }
  for (const line of lines) {
    const m = line.match(/^([a-z_]+):(.*)$/)
    if (m) { commit(); key = m[1]; buf = m[2] } else if (key !== null) buf += '\n' + line
  }
  commit()
  return fm
}

// validateVisionFrontmatter(fm, err) — the schemas/vision.schema.json mirror, field-for-field
// (no ajv, no deps — the validateLaw pattern). err collects typed {code, path, message}.
export function validateVisionFrontmatter(fm, err) {
  const KEYS = ['schema', 'status', 'tier', 'visual_direction', 'session', 'counts', 'open_questions']
  for (const k of Object.keys(fm)) if (!KEYS.includes(k)) err('unknown_key', `frontmatter.${k}`, `frontmatter: unknown key '${k}'`)
  for (const k of KEYS) if (!(k in fm)) err('missing_key', `frontmatter.${k}`, `frontmatter: missing key '${k}'`)
  if ('schema' in fm && fm.schema !== 1) err('invalid_value', 'frontmatter.schema', 'frontmatter.schema must be 1')
  if ('status' in fm && !['draft', 'gated', 'approved'].includes(fm.status)) err('invalid_value', 'frontmatter.status', `frontmatter.status must be draft|gated|approved (got ${JSON.stringify(fm.status)})`)
  if ('tier' in fm && !['light', 'standard', 'deep', 'express'].includes(fm.tier)) err('invalid_value', 'frontmatter.tier', `frontmatter.tier must be light|standard|deep|express (got ${JSON.stringify(fm.tier)})`)
  if ('visual_direction' in fm && typeof fm.visual_direction !== 'boolean') err('invalid_value', 'frontmatter.visual_direction', 'frontmatter.visual_direction must be a boolean (the authoritative surface architecture threads on)')
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
  if ('session' in fm) {
    if (!isObj(fm.session)) err('invalid_value', 'frontmatter.session', 'frontmatter.session must be an object {ideas}')
    else {
      for (const k of Object.keys(fm.session)) if (k !== 'ideas') err('unknown_key', `frontmatter.session.${k}`, `frontmatter.session: unknown key '${k}'`)
      if (!Number.isInteger(fm.session.ideas) || fm.session.ideas < 0) err('invalid_value', 'frontmatter.session.ideas', 'frontmatter.session.ideas must be an integer ≥ 0 (ledger provenance — type-checked only)')
    }
  }
  if ('counts' in fm) {
    const CK = ['frs', 'scs', 'stories', 'assumptions', 'unresolved_clarifications', 'open_questions']
    if (!isObj(fm.counts)) err('invalid_value', 'frontmatter.counts', 'frontmatter.counts must be an object')
    else {
      for (const k of Object.keys(fm.counts)) if (!CK.includes(k)) err('unknown_key', `frontmatter.counts.${k}`, `frontmatter.counts: unknown key '${k}'`)
      for (const k of CK) if (!(k in fm.counts)) err('missing_key', `frontmatter.counts.${k}`, `frontmatter.counts: missing key '${k}'`)
      for (const [k, v] of Object.entries(fm.counts)) if (!Number.isInteger(v) || v < 0) err('invalid_value', `frontmatter.counts.${k}`, `frontmatter.counts.${k} must be an integer ≥ 0`)
    }
  }
  if ('open_questions' in fm) {
    if (!Array.isArray(fm.open_questions)) err('invalid_value', 'frontmatter.open_questions', 'frontmatter.open_questions must be an array (the authoritative OQ list)')
    else fm.open_questions.forEach((q, i) => {
      const at = `frontmatter.open_questions[${i}]`
      if (!q || typeof q !== 'object' || Array.isArray(q)) { err('invalid_value', at, `${at} must be an object {id, question, priority, timing, context?}`); return }
      for (const k of Object.keys(q)) if (!['id', 'question', 'priority', 'timing', 'context'].includes(k)) err('unknown_key', `${at}.${k}`, `${at}: unknown key '${k}'`)
      if (typeof q.id !== 'string' || !/^OQ-\d+$/.test(q.id)) err('invalid_value', `${at}.id`, `${at}.id must match OQ-<digits>`)
      if (typeof q.question !== 'string' || q.question === '') err('invalid_value', `${at}.question`, `${at}.question must be a nonempty string`)
      if (!['high', 'medium', 'low'].includes(q.priority)) err('invalid_value', `${at}.priority`, `${at}.priority must be high|medium|low`)
      if (!['before-build', 'during-build', 'post-launch'].includes(q.timing)) err('invalid_value', `${at}.timing`, `${at}.timing must be before-build|during-build|post-launch`)
      if ('context' in q && typeof q.context !== 'string') err('invalid_value', `${at}.context`, `${at}.context must be a string when present`)
    })
  }
}
