// strict-schemas.test.mjs — the strict-safe council-schema net (design-strict-schemas rev 3, T1–T7).
//
// Every codex-bound council payload schema is now STRICT structured-output safe (codex 0.144.x): every
// node has an explicit type (R1), every object carries additionalProperties:false (R2), every property is
// required (R3), optionality rides as nullability (R4), only the allowlisted keywords appear (R5). The
// legacy consumer view is restored AFTER the raw-wire receipt/cross-check by normalizeStrictPayload driven
// by each schema's co-located descriptor { schema, stripNullPaths, jsonPaths }. This file locks that net:
//   T1  strict-lint (R1–R5 + allowlist + nullable-path classification) over the codex-bound set.
//   T2  normalizeStrictPayload BOTH directions (strip amendment triple / reasoning; RETAIN executable_check)
//       + absent-vs-null consumer identity (same R-keys, same canonical semantic hashes).
//   T3  round-trip for EVERY encoded wire field (replacement_json/value_json/merged_value_json) + the
//       unparsable-string shape-error rail + the multibyte byte-rail (maxLength is only a wire ceiling).
//   T4  the existing council/ratify/amendment suites stay green (asserted structurally: the strict schemas
//       preserve the consumer-view shape the other suites drive).
//   T5  LIVE receipts: one `codex exec --output-schema` acceptance run per codex-bound schema (captured to
//       .kiln-dev/v302/receipts-strict/<name>.log). Verified here when present; skipped where absent.
//   T6  MECHANICAL enumeration: every payloadSchema reaching solWrapperPrompt/solWrapperPlan/solByteOwnedPlan
//       (across workflows-src + council.mjs) is exactly the strict-linted Sol-leg set.
//   T7  BOUNDARY ORDER: a wire payload with nulls + encoded fields verifies on its RAW form (the hash the
//       receipt/cross-check binds), and the normalized consumer view drops the nulls / decodes the fields.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  RATIFY_SCHEMA, RATIFY_DESCRIPTOR, ANSWER_SCHEMA, ANSWER_DESCRIPTOR,
  normalizeStrictPayload, strictLintSchema, canonicalJson, sha256Hex, canonicalizeRatifyFindings, crossCheckOk,
} from '../../plugins/kiln/src/council.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WFSRC = `${ROOT}plugins/kiln/workflows-src`
const COUNCIL = `${ROOT}plugins/kiln/src/council.mjs`

// ── source extraction: pull named schema/descriptor consts out of a workflow-src file (they are pure
//    data referencing only sibling schema consts, so a source-order eval block resolves every cross-ref). ──
function extractConstText(src, name) {
  const re = new RegExp(`(^|\\n)const ${name.replace(/\$/g, '\\$')} = `)
  const m = re.exec(src)
  if (!m) throw new Error(`const ${name} not found`)
  const declStart = m.index + m[1].length
  let i = src.indexOf('=', declStart) + 1
  let depth = 0, inStr = null, started = false
  for (; i < src.length; i++) {
    const ch = src[i]
    if (inStr) { if (ch === '\\') { i++; continue } if (ch === inStr) inStr = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; started = true; continue }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; if (started && depth === 0) { i++; break } continue }
    if (!started && (ch === ';' || ch === '\n')) { i++; break }
  }
  return src.slice(declStart, i)
}
function loadConsts(file, names) {
  const src = readFileSync(file, 'utf8')
  const body = names.map((n) => extractConstText(src, n)).join('\n') + `\nreturn { ${names.join(', ')} };`
  // eslint-disable-next-line no-new-func
  return new Function(body)()
}

// ── the codex-bound descriptor registry: co-located schema+descriptor pairs, resolved to objects. Each
//    is a Sol leg's --output-schema (isSolLeg:true) except REVISION_PAYLOAD, the Fable head of the revision
//    pair (strict + normalized for pair symmetry, but never serialized into files.schema). ──
const ARCH = loadConsts(`${WFSRC}/architecture.js`, [
  'T4_MILESTONE_ITEM_SCHEMA', 'T4_MILESTONES_SCHEMA',
  'SOL_DRAFT_PAYLOAD_SCHEMA', 'SOL_DRAFT_PAYLOAD_DESCRIPTOR',
  'FRESH_CELL_SCHEMA', 'FRESH_CELL_DESCRIPTOR',
  'RUBRIC_AMEND_SCHEMA', 'RUBRIC_AMEND_DESCRIPTOR',
  'REVERSIBILITY_SCHEMA', 'REVERSIBILITY_DESCRIPTOR',
  'CRITIQUE_EVIDENCE_SCHEMA', 'CRITIQUE_PAYLOAD_SCHEMA', 'CRITIQUE_PAYLOAD_DESCRIPTOR',
  'REVISION_PAYLOAD_SCHEMA', 'REVISION_PAYLOAD_DESCRIPTOR',
  'SOL_REVISION_PAYLOAD_SCHEMA', 'SOL_REVISION_PAYLOAD_DESCRIPTOR',
  'NEGOTIATION_PAYLOAD_SCHEMA', 'NEGOTIATION_PAYLOAD_DESCRIPTOR',
])
const BUILD = loadConsts(`${WFSRC}/build.js`, ['SOL_QA_PAYLOAD_SCHEMA', 'SOL_QA_PAYLOAD_DESCRIPTOR', 'CORRECTION_SCHEMA', 'CORRECTION_DESCRIPTOR'])
const VALIDATE = loadConsts(`${WFSRC}/validate.js`, ['GOAL_SECOND_PAYLOAD_SCHEMA', 'GOAL_SECOND_PAYLOAD_DESCRIPTOR'])

// REGISTRY — every strict codex-bound descriptor. schemaConst = the const name a Sol leg passes as
// payloadSchema (T6 anchors on these). isSolLeg=false ⇒ a Fable pair-partner (strict but not codex-serialized).
const REGISTRY = [
  { name: 'RATIFY_SCHEMA', descriptor: RATIFY_DESCRIPTOR, isSolLeg: true },
  { name: 'ANSWER_SCHEMA', descriptor: ANSWER_DESCRIPTOR, isSolLeg: true },
  { name: 'CRITIQUE_PAYLOAD_SCHEMA', descriptor: ARCH.CRITIQUE_PAYLOAD_DESCRIPTOR, isSolLeg: true },
  { name: 'SOL_REVISION_PAYLOAD_SCHEMA', descriptor: ARCH.SOL_REVISION_PAYLOAD_DESCRIPTOR, isSolLeg: true },
  { name: 'REVISION_PAYLOAD_SCHEMA', descriptor: ARCH.REVISION_PAYLOAD_DESCRIPTOR, isSolLeg: false },
  { name: 'NEGOTIATION_PAYLOAD_SCHEMA', descriptor: ARCH.NEGOTIATION_PAYLOAD_DESCRIPTOR, isSolLeg: true },
  { name: 'SOL_DRAFT_PAYLOAD_SCHEMA', descriptor: ARCH.SOL_DRAFT_PAYLOAD_DESCRIPTOR, isSolLeg: true },
  { name: 'FRESH_CELL_SCHEMA', descriptor: ARCH.FRESH_CELL_DESCRIPTOR, isSolLeg: true },
  { name: 'REVERSIBILITY_SCHEMA', descriptor: ARCH.REVERSIBILITY_DESCRIPTOR, isSolLeg: true },
  { name: 'RUBRIC_AMEND_SCHEMA', descriptor: ARCH.RUBRIC_AMEND_DESCRIPTOR, isSolLeg: true },
  { name: 'CORRECTION_SCHEMA', descriptor: BUILD.CORRECTION_DESCRIPTOR, isSolLeg: true },
  { name: 'SOL_QA_PAYLOAD_SCHEMA', descriptor: BUILD.SOL_QA_PAYLOAD_DESCRIPTOR, isSolLeg: true },
  { name: 'GOAL_SECOND_PAYLOAD_SCHEMA', descriptor: VALIDATE.GOAL_SECOND_PAYLOAD_DESCRIPTOR, isSolLeg: true },
]

// ════════════════════════════════════ shared test machinery ════════════════════════════════════
// (generators, a real JSON-schema instance validator, static source parsers, and the extracted
//  PRODUCTION byte rail — the r2 fix folds these in so T2/T3/T6/T7 lock what the code does, not a proxy.)

// mulberry32(seed) — a seeded deterministic PRNG. NO Math.random: every generated case derives from a
// FIXED seed, so a failure is byte-reproducible. Math.imul is deterministic 32-bit arithmetic.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// scanBalanced(src, openIdx) — a comment- AND string-aware delimiter balancer. openIdx points at an
// opening '(' or '{'; returns the index just after the matching close. Strings (' " `) are opaque
// (escape-aware) and // + /* */ comments are skipped — a comment apostrophe (e.g. `VALUE's` inside
// registryFor) must NOT open a phantom string that swallows a real brace. Template ${} rides opaquely
// with its backtick (these sources never put a backtick inside a ${} expression). This is the ONE
// primitive the T3 registry extractor, the T6 enumeration, and the T7 seam pin all balance with.
function scanBalanced(src, openIdx) {
  const open = src[openIdx], close = open === '(' ? ')' : '}'
  let depth = 0, inStr = null
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (inStr) { if (ch === '\\') { i++; continue } if (ch === inStr) inStr = null; continue }
    if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); if (nl < 0) return src.length; i = nl; continue }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return src.length; i = e + 1; continue }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
    if (ch === open) depth++
    else if (ch === close) { depth--; if (depth === 0) return i + 1 }
  }
  throw new Error('scanBalanced: unbalanced delimiter')
}
const balancedInner = (src, openIdx) => src.slice(openIdx + 1, scanBalanced(src, openIdx) - 1)

// commentRanges(src) — the [start,end) spans that are // line- or /* */ block-comments, using the SAME
// string/comment rules scanBalanced already balances these sources with (backtick/quote strings opaque and
// escape-aware). T6 uses it to discard a wrapper token that is only a COMMENT MENTION (e.g. the
// `// solWrapperPlan(cfg) …` doc line) — a mention is not a call site, so it must be excluded, never flagged.
function commentRanges(src) {
  const ranges = []
  let inStr = null
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inStr) { if (ch === '\\') { i++; continue } if (ch === inStr) inStr = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
    if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); const end = nl < 0 ? src.length : nl; ranges.push([i, end]); i = end; continue }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; ranges.push([i, end]); i = end - 1; continue }
  }
  return ranges
}

// validateInstance(schema, value) — a real JSON-schema INSTANCE validator over the R1–R5 subset the
// codex-bound schemas actually use (type unions incl. null, required, additionalProperties:false, enum,
// maxLength/maxItems, array items, nested objects). Returns the (possibly empty) violation list. T3
// validates the WHOLE encoded payload with this BEFORE normalizing, so a regression in instance shape
// (a missing required sibling, a bad enum, an over-long wire field) turns the round-trip red.
function validateInstance(schema, value, path = '$') {
  const errs = []
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (value === null) { if (!types.includes('null')) errs.push(`${path}: null not permitted (type ${types.join('|')})`); return errs }
  const jsType = Array.isArray(value) ? 'array' : typeof value
  const okType =
    (jsType === 'object' && types.includes('object')) ||
    (jsType === 'array' && types.includes('array')) ||
    (jsType === 'string' && types.includes('string')) ||
    (jsType === 'boolean' && types.includes('boolean')) ||
    (jsType === 'number' && (types.includes('number') || (types.includes('integer') && Number.isInteger(value))))
  if (!okType) { errs.push(`${path}: type ${jsType} not in ${types.join('|')}`); return errs }
  if (jsType === 'string') {
    if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: '${value}' not in enum`)
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errs.push(`${path}: exceeds maxLength ${schema.maxLength}`)
  }
  if (jsType === 'array') {
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errs.push(`${path}: exceeds maxItems ${schema.maxItems}`)
    if (schema.items) value.forEach((el, i) => errs.push(...validateInstance(schema.items, el, `${path}[${i}]`)))
  }
  if (jsType === 'object') {
    const props = schema.properties || {}, req = Array.isArray(schema.required) ? schema.required : []
    if (schema.additionalProperties === false) for (const k of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(props, k)) errs.push(`${path}.${k}: additionalProperty forbidden`)
    for (const r of req) if (!Object.prototype.hasOwnProperty.call(value, r)) errs.push(`${path}: missing required '${r}'`)
    for (const k of Object.keys(props)) if (Object.prototype.hasOwnProperty.call(value, k)) errs.push(...validateInstance(props[k], value[k], `${path}.${k}`))
  }
  return errs
}
// defaultFor(schema) — a MINIMAL valid instance for a strict schema node (nullable→null, object→required
// props filled, array→[], string→'' or first non-null enum, number/integer→0, boolean→false).
function defaultFor(schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types.includes('null')) return null
  if (types.includes('object')) { const o = {}; const props = schema.properties || {}; for (const r of (schema.required || [])) o[r] = defaultFor(props[r]); return o }
  if (types.includes('array')) return []
  if (types.includes('string')) return schema.enum ? schema.enum.find((e) => e !== null) : ''
  if (types.includes('integer') || types.includes('number')) return 0
  if (types.includes('boolean')) return false
  return null
}
// buildValidWire(schema, encPath, encodedStr) — a COMPLETE schema-valid wire payload (every required
// sibling present via defaultFor, one array element materialized along encPath) carrying encodedStr at
// the terminal encoded field. Fixes the r1 gap: buildWireWith omitted required siblings + never validated.
function buildValidWire(schema, encPath, encodedStr) {
  const root = defaultFor(schema)
  const segs = encPath.split('.')
  let node = root, sch = schema
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i], isArr = seg.endsWith('[]'), nm = isArr ? seg.slice(0, -2) : seg
    const propSchema = sch.properties[nm]
    if (i === segs.length - 1) { node[nm] = encodedStr; break }
    if (isArr) { const el = defaultFor(propSchema.items); node[nm] = [el]; node = el; sch = propSchema.items }
    else { const child = defaultFor(propSchema); node[nm] = child; node = child; sch = propSchema }
  }
  return root
}
const readDecodedPath = (obj, encPath) => {
  const segs = encPath.split('.'); segs[segs.length - 1] = segs[segs.length - 1].replace(/_json$/, '')
  let node = obj
  for (const seg of segs) { const isArr = seg.endsWith('[]'), nm = isArr ? seg.slice(0, -2) : seg; node = node && node[nm]; if (isArr) node = node && node[0]; if (node == null) return node }
  return node
}

// The PRODUCTION registry byte rail, EXTRACTED from architecture.js (not reimplemented): registryFor is
// a nested closure over utf8ByteLength + DECISION_VALUE_MAX_BYTES + canonicalJson/sha256Hex. We slice the
// three production declarations verbatim and eval them with the imported canonicalJson/sha256Hex so T3's
// multibyte case exercises the REAL rejection, per NF-001 ("the utf8-byte registry rail remains the authority").
function extractArrowConst(src, name) {
  const start = src.indexOf(`const ${name} = `)
  if (start < 0) throw new Error(`extractArrowConst: ${name} not found`)
  return src.slice(start, scanBalanced(src, src.indexOf('{', src.indexOf('=>', start))))
}
const ARCH_SRC = readFileSync(`${WFSRC}/architecture.js`, 'utf8')
const DVMB_START = ARCH_SRC.indexOf('const DECISION_VALUE_MAX_BYTES = ')
const PROD = new Function('canonicalJson', 'sha256Hex', [
  ARCH_SRC.slice(DVMB_START, ARCH_SRC.indexOf('\n', DVMB_START)),
  extractArrowConst(ARCH_SRC, 'utf8ByteLength'),
  extractArrowConst(ARCH_SRC, 'registryFor'),
  'return { registryFor, utf8ByteLength, DECISION_VALUE_MAX_BYTES };',
].join('\n'))(canonicalJson, sha256Hex)

// resolveSolLegSchemas(sources) — the T6 mechanical enumeration. It visits EVERY solWrapperPrompt/
// solWrapperPlan/solByteOwnedPlan token and FIRST discards the two non-call forms: a comment mention (the
// token sits inside a commentRanges span) and the wrapper's OWN `function NAME(cfg)` declaration. Neither is
// a call site, so neither carries a payloadSchema. EVERY surviving token is a REAL call and MUST land in
// `resolved` or `unresolved` — no argument shape is silently skipped (SS-R1-T6-ENUMERATION fix: the old
// `inner[0] !== '{'` skip let an identifier-held or computed cfg — solWrapperPlan(opts),
// solByteOwnedPlan(makeCfg(X)) — evade BOTH sets). Resolution of a real call:
//   (i) direct `payloadSchema: NAME`;
//   (ii) `payloadSchema: cfg.schema|cfg.payloadSchema` pass-through ⇒ chase the enclosing `(cfg)` helper's
//        CALLERS and collect each literal `schema:` argument (property-order-independent);
//   (iii) an OBJECT-LITERAL arg spreading `...opts`/`...cfg` with NO explicit payloadSchema ⇒ a wrapper-
//        adapter forward (its schemas are counted at the adapter's own wrapper call sites) — legal ONLY when
//        the enclosing decl is itself a wrapper name whose param is that spread identifier.
// Anything else — a bare identifier arg, a computed-cfg call, an object with an unresolvable binding — is
// pushed to `unresolved` and the test FAILS LOUD (never a silent skip).
const SOL_WRAPPERS = ['solWrapperPrompt', 'solWrapperPlan', 'solByteOwnedPlan']
function resolveSolLegSchemas(sources) {
  const resolved = new Set(), unresolved = [], adapters = new Set()
  for (const { name, src } of sources) {
    const comments = commentRanges(src)
    const inComment = (idx) => comments.some(([s, e]) => idx >= s && idx < e)
    const cfgHelpers = [...src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*\(\s*cfg\s*\)\s*=>/g)].map((m) => ({ helper: m[1], idx: m.index }))
    const wrapAdapters = [...src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)].map((m) => ({ nm: m[1], param: m[2], idx: m.index }))
    const wrapRe = new RegExp(`(?<![\\w$])(${SOL_WRAPPERS.join('|')})\\s*\\(`, 'g')
    let m
    while ((m = wrapRe.exec(src)) !== null) {
      if (inComment(m.index)) continue // a comment mention (e.g. `// solWrapperPlan(cfg) …`) is not a call site
      if (/(?<![\w$])function\s+$/.test(src.slice(0, m.index))) continue // the `function NAME(cfg)` declaration itself
      const openIdx = m.index + m[0].length - 1
      let inner
      try { inner = balancedInner(src, openIdx) } catch { unresolved.push(`${name}: unbalanced wrapper call @${m.index}`); continue }
      const arg = inner.trim()
      const pm = /(?<![\w$])payloadSchema:\s*([A-Za-z_$][\w$.]*)/.exec(inner)
      if (!pm) {
        // no explicit payloadSchema: the ONLY legal shape is an object-literal adapter forward `{ …, ...param }`
        // inside a wrapper decl whose param is that spread identifier. A bare identifier / computed cfg is not an
        // object literal (arg[0] !== '{') so it can never reach the adapter arm — it FAILS LOUD below.
        const sp = arg[0] === '{' ? /\.\.\.([A-Za-z_$][\w$]*)/.exec(inner) : null
        const encl = sp && wrapAdapters.filter((a) => a.idx < m.index).sort((a, b) => b.idx - a.idx)[0]
        if (encl && SOL_WRAPPERS.includes(encl.nm) && encl.param === sp[1]) { adapters.add(`${name}:${encl.nm}`); continue }
        unresolved.push(`${name}: wrapper call @${m.index} has neither payloadSchema nor a recognized adapter spread (arg: ${arg.slice(0, 40)})`)
        continue
      }
      const binding = pm[1]
      if (/^cfg\.(schema|payloadSchema)$/.test(binding)) {
        const helper = cfgHelpers.filter((h) => h.idx < m.index).sort((a, b) => b.idx - a.idx)[0]
        if (!helper) { unresolved.push(`${name}: cfg pass-through @${m.index} with no enclosing (cfg) helper`); continue }
        const callerRe = new RegExp(`(?<![\\w$])${helper.helper}\\s*\\(`, 'g')
        let cm, found = 0
        while ((cm = callerRe.exec(src)) !== null) {
          let ci
          try { ci = balancedInner(src, cm.index + cm[0].length - 1) } catch { continue }
          if (ci.trim()[0] !== '{') continue
          const sm = /(?<![\w$])schema:\s*([A-Za-z_$][\w$]*)/.exec(ci)
          if (sm) { resolved.add(sm[1]); found++ }
        }
        if (!found) unresolved.push(`${name}: cfg helper '${helper.helper}' has no caller with a literal schema:`)
      } else if (/^[A-Za-z_$][\w$]*$/.test(binding)) {
        resolved.add(binding)
      } else {
        unresolved.push(`${name}: unresolvable payloadSchema binding '${binding}' @${m.index}`)
      }
    }
  }
  return { resolved, unresolved, adapters }
}

// seamCheck(src, fname) — the T7 seam-order drift pin. For every runSol*CrossCheck(...) call (incl.
// runSolCrossCheckB / runSolByteOwnedCrossCheck) it recovers the seam's RAW payload identifier — the one
// normCouncilPayload(...) first-arg that also appears as a token in the cross-check args — then asserts,
// per identifier, EQUAL cross-check/normalize counts and cross-check@i < normalize@i. A reorder that moves
// a normalize before its cross-check turns a pin red.
function seamCheck(src, fname) {
  const norms = [...src.matchAll(/(?<![\w$])normCouncilPayload\s*\(/g)].map((m) => ({ ident: balancedInner(src, m.index + m[0].length - 1).split(',')[0].trim(), off: m.index }))
  const crosses = [...src.matchAll(/(?<![\w$])runSol[A-Za-z]*CrossCheck[A-Za-z]*\s*\(/g)].map((m) => {
    const inner = balancedInner(src, m.index + m[0].length - 1)
    let ident = null
    for (const n of norms) { const esc = n.ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (new RegExp(`(?<![\\w$])${esc}(?![\\w$])`).test(inner)) { ident = n.ident; break } }
    return { ident, off: m.index }
  })
  const errs = []
  const crossByIdent = new Map(), normByIdent = new Map()
  for (const c of crosses) {
    if (c.ident == null) { errs.push(`${fname}: a runSol*CrossCheck @${c.off} references no normalized identifier`); continue }
    if (!crossByIdent.has(c.ident)) crossByIdent.set(c.ident, []); crossByIdent.get(c.ident).push(c.off)
  }
  for (const n of norms) { if (!normByIdent.has(n.ident)) normByIdent.set(n.ident, []); normByIdent.get(n.ident).push(n.off) }
  let pins = 0
  for (const [ident, cOffs] of crossByIdent) {
    const cs = cOffs.slice().sort((a, b) => a - b)
    const ns = (normByIdent.get(ident) || []).slice().sort((a, b) => a - b)
    if (cs.length !== ns.length) { errs.push(`${fname}: seam '${ident}' — ${cs.length} cross-check(s) vs ${ns.length} normalize(s) (unpaired)`); continue }
    for (let i = 0; i < cs.length; i++) { pins++; if (!(cs[i] < ns[i])) errs.push(`${fname}: seam '${ident}' pair ${i} — cross-check@${cs[i]} does not precede normalize@${ns[i]}`) }
  }
  return { errs, pins }
}

// ════════════════════════════════════ T1 — strict lint ════════════════════════════════════
test('T1: every codex-bound descriptor passes the R1–R5 strict lint (allowlist + additionalProperties:false + all-required + root-object)', () => {
  for (const { name, descriptor } of REGISTRY) {
    const errs = strictLintSchema(descriptor)
    assert.deepEqual(errs, [], `${name}: ${errs.join(' | ')}`)
  }
})

test('T1: the lint FAILS on an unclassified/stale descriptor path and on non-allowlisted keywords', () => {
  // a nullable path removed from schema but left in stripNullPaths ⇒ stale-descriptor failure
  const stale = { schema: RATIFY_SCHEMA, stripNullPaths: [...RATIFY_DESCRIPTOR.stripNullPaths, 'findings[].not_a_field'], jsonPaths: RATIFY_DESCRIPTOR.jsonPaths }
  assert.ok(strictLintSchema(stale).some((e) => /not_a_field/.test(e)), 'a stale stripNullPaths entry is flagged')
  // a disallowed keyword (pattern) ⇒ R5 failure
  const badKw = { schema: { type: 'object', additionalProperties: false, properties: { x: { type: 'string', pattern: '^a$' } }, required: ['x'] }, stripNullPaths: [], jsonPaths: [] }
  assert.ok(strictLintSchema(badKw).some((e) => /disallowed keyword 'pattern'/.test(e)), 'a non-allowlisted keyword is flagged')
  // a bare {} annotation-only node ⇒ R1 failure
  const noType = { schema: { type: 'object', additionalProperties: false, properties: { x: {} }, required: ['x'] }, stripNullPaths: [], jsonPaths: [] }
  assert.ok(strictLintSchema(noType).some((e) => /missing 'type'/.test(e)), 'a typeless node is flagged (R1)')
  // an object missing additionalProperties:false ⇒ R2 failure
  const openObj = { schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] }, stripNullPaths: [], jsonPaths: [] }
  assert.ok(strictLintSchema(openObj).some((e) => /additionalProperties:false/.test(e)), 'an open object is flagged (R2)')
  // a property missing from required ⇒ R3 failure
  const notReq = { schema: { type: 'object', additionalProperties: false, properties: { x: { type: 'string' }, y: { type: 'string' } }, required: ['x'] }, stripNullPaths: [], jsonPaths: [] }
  assert.ok(strictLintSchema(notReq).some((e) => /not in required/.test(e)), 'an unrequired property is flagged (R3)')
})

test('T1: descriptor path maps are pinned (drift guard) — stripNullPaths/jsonPaths golden per RATIFY/REVISION/NEGOTIATION', () => {
  assert.deepEqual(RATIFY_DESCRIPTOR.jsonPaths, ['findings[].replacement_json'])
  assert.deepEqual(RATIFY_DESCRIPTOR.stripNullPaths, ['reasoning', 'findings[].target_kind', 'findings[].key', 'findings[].replacement_json', 'changed_evidence[].refs', 'divergence_selections[].evidence_refs'])
  // executable_check is the ONE retained-null (validateRatification requires it present even when null)
  assert.ok(!RATIFY_DESCRIPTOR.stripNullPaths.includes('findings[].executable_check'))
  assert.deepEqual(ARCH.REVISION_PAYLOAD_DESCRIPTOR.jsonPaths, ['decisions[].value_json'])
  assert.deepEqual(ARCH.NEGOTIATION_PAYLOAD_DESCRIPTOR.jsonPaths, ['selections[].merged_value_json'])
  assert.deepEqual(ARCH.SOL_REVISION_PAYLOAD_DESCRIPTOR.jsonPaths, ['decisions[].value_json'])
})

// ════════════════════════════════════ T2 — normalizer both directions ════════════════════════════════════
test('T2: normalizeStrictPayload strips the amendment triple + reasoning (legacy-absent) and RETAINS executable_check (legacy-required-nullable)', () => {
  const wire = {
    reasoning: null, artifact_hash: 'h', verdict: 'BLOCK',
    findings: [{
      finding_id: 'f1', claim: 'c', required_change: 'r', evidence_refs: ['e'], evidence_class: 'repo_state',
      executable_check: null, target_kind: null, key: null, replacement_json: null,
    }],
    changed_evidence: [], divergence_selections: [],
  }
  const view = normalizeStrictPayload(wire, RATIFY_DESCRIPTOR)
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'reasoning'), false, 'reasoning null stripped')
  const f = view.findings[0]
  assert.equal(f.target_kind, undefined, 'target_kind null → absent')
  assert.equal(f.key, undefined, 'key null → absent')
  assert.equal(f.replacement, undefined, 'replacement_json null → replacement absent')
  assert.equal(Object.prototype.hasOwnProperty.call(f, 'replacement_json'), false, 'the encoded key is consumed')
  assert.ok(Object.prototype.hasOwnProperty.call(f, 'executable_check') && f.executable_check === null, 'executable_check RETAINED as present-null')
  // raw is never mutated (the cross-check hash it bound stays valid)
  assert.equal(wire.findings[0].target_kind, null)
})

// GENERATED absent-vs-null consumer identity (SS-R1-T2-IDENTITY fix): a seeded deterministic generator
// (no Math.random) produces N≥50 finding-set cases spanning the absent-vs-null optional triple, raw
// `replacement` vs encoded `replacement_json` (encoded with SHUFFLED key order), present/absent reasoning,
// evidence-ref variants, and changed_evidence/divergence_selections null-strip variants. Each case is
// built in BOTH wire forms; for every case the test asserts (a) canonicalizeRatifyFindings R-keys are
// identical across the legacy and strict forms AND (b) sha256Hex(canonicalJson(view)) — the canonical
// SEMANTIC hash of the normalized consumer view — is identical across both. A regression in the
// normalizer's decode/strip or in canonical value-identity turns a specific seeded case red.
const genRatifyCase = (rnd, n) => {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  const chance = (p) => rnd() < p
  const EV = ['executed_check', 'proposed_check', 'repo_state', 'test_output', 'primary_source', 'scenario']
  const nFind = 1 + Math.floor(rnd() * 4)
  const legacyF = [], strictF = []
  for (let i = 0; i < nFind; i++) {
    const base = {
      finding_id: `f${n}_${i}`, claim: `claim ${n}-${i}`, required_change: `rc ${n}-${i}`,
      evidence_refs: chance(0.5) ? [] : Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, k) => `e${n}_${i}_${k}`),
      evidence_class: pick(EV),
      executable_check: chance(0.5) ? null : `exit ${i}`, // legacy-required-nullable — present (null|string) in BOTH forms
    }
    const legacy = { ...base }, strict = { ...base }
    if (chance(0.5)) { // amendment PRESENT: raw replacement (legacy) vs encoded replacement_json (strict, shuffled keys)
      const val = { alpha: n + i, beta: [i, n], gamma: { deep: chance(0.5) } }
      legacy.target_kind = 'settled_decision'; legacy.key = `topic:${n}:${i}`; legacy.replacement = val
      strict.target_kind = 'settled_decision'; strict.key = `topic:${n}:${i}`; strict.replacement_json = JSON.stringify({ gamma: val.gamma, beta: val.beta, alpha: val.alpha })
    } else { // amendment ABSENT: legacy OMITS the triple; strict carries nulls (normalizer strips → absent)
      strict.target_kind = null; strict.key = null; strict.replacement_json = null
    }
    legacyF.push(legacy); strictF.push(strict)
  }
  const verdict = pick(['APPROVE', 'BLOCK', 'NEITHER']), reasoning = chance(0.5) ? `because ${n}` : null
  const legacy = { verdict, artifact_hash: `h${n}`, findings: legacyF, changed_evidence: [], divergence_selections: [] }
  const strict = { reasoning, verdict, artifact_hash: `h${n}`, findings: strictF, changed_evidence: [], divergence_selections: [] }
  if (reasoning !== null) legacy.reasoning = reasoning
  if (chance(0.4)) { legacy.changed_evidence = [{ finding_id: `f${n}_0`, class: 'repo_state' }]; strict.changed_evidence = [{ finding_id: `f${n}_0`, class: 'repo_state', refs: null }] }
  if (chance(0.4)) { legacy.divergence_selections = [{ divergence_id: `DV-${n}`, selection: 'P0' }]; strict.divergence_selections = [{ divergence_id: `DV-${n}`, selection: 'P0', evidence_refs: null }] }
  return { legacy, strict }
}
test('T2: GENERATED absent-vs-null identity — N seeded cases: same canonicalizeRatifyFindings R-keys AND same canonical semantic hash across legacy(absent/raw) and strict(null/encoded) forms', () => {
  const rnd = mulberry32(0x5eed1234)
  const N = 64
  // SS-R1-T2-IDENTITY fix: a per-class coverage counter for EVERY generated variant class — BOTH sides of
  // each dichotomy — so no class can silently disappear from the generator while T2 stays green. Every
  // counter is asserted > 0 after the run; if a class ever stops firing, its counter drops to 0 and fails.
  const cov = {
    amendment_present: 0, amendment_absent: 0,
    reasoning_present: 0, reasoning_null: 0,
    evidence_refs_empty: 0, evidence_refs_nonempty: 0,
    changed_evidence_strip_fired: 0, changed_evidence_strip_not_fired: 0,
    divergence_strip_fired: 0, divergence_strip_not_fired: 0,
    raw_replacement: 0, encoded_replacement_json: 0,
  }
  for (let n = 0; n < N; n++) {
    const { legacy, strict } = genRatifyCase(rnd, n)
    const legacyView = normalizeStrictPayload(legacy, RATIFY_DESCRIPTOR) // tolerant: an already-consumer-shape payload passes through
    const strictView = normalizeStrictPayload(strict, RATIFY_DESCRIPTOR) // the strict wire is decoded + null-stripped
    // the strict WIRE must be schema-valid before it is normalized (the generator produces legal strict payloads)
    assert.deepEqual(validateInstance(RATIFY_SCHEMA, strict), [], `case ${n}: generated strict wire is schema-valid`)
    // (a) R-keys identical across both forms
    const kL = canonicalizeRatifyFindings('1', { P0: legacyView.findings }).map((f) => f.id)
    const kS = canonicalizeRatifyFindings('1', { P0: strictView.findings }).map((f) => f.id)
    assert.deepEqual(kS, kL, `case ${n}: R-keys identical — canonical value identity survives the encode→decode boundary`)
    // (b) canonical SEMANTIC hash of the normalized consumer view identical across both forms
    assert.equal(sha256Hex(canonicalJson(strictView)), sha256Hex(canonicalJson(legacyView)), `case ${n}: consumer-view semantic hash identical across absent/raw vs null/encoded`)
    // per-class coverage tally — BOTH sides of every dichotomy, read off the generated wire objects
    for (let i = 0; i < strict.findings.length; i++) {
      const lf = legacy.findings[i], sf = strict.findings[i]
      // amendment present ⇔ strict carries a non-null encoded replacement_json (and legacy a raw replacement);
      // amendment absent ⇔ strict carries replacement_json: null and legacy OMITS the triple
      if (typeof sf.replacement_json === 'string') cov.amendment_present++; else cov.amendment_absent++
      if (Object.prototype.hasOwnProperty.call(lf, 'replacement')) cov.raw_replacement++ // legacy raw-`replacement` form fired
      if (typeof sf.replacement_json === 'string') cov.encoded_replacement_json++         // strict encoded-`replacement_json` form fired
      if (lf.evidence_refs.length === 0) cov.evidence_refs_empty++; else cov.evidence_refs_nonempty++
    }
    if (strict.reasoning === null) cov.reasoning_null++; else cov.reasoning_present++
    // changed_evidence / divergence_selections null-strip fired ⇔ the strict wire carried a row whose
    // nullable path (refs / evidence_refs) is null (the normalizer strips it); not-fired ⇔ the array is empty
    if (strict.changed_evidence.some((r) => Object.prototype.hasOwnProperty.call(r, 'refs') && r.refs === null)) cov.changed_evidence_strip_fired++; else cov.changed_evidence_strip_not_fired++
    if (strict.divergence_selections.some((r) => Object.prototype.hasOwnProperty.call(r, 'evidence_refs') && r.evidence_refs === null)) cov.divergence_strip_fired++; else cov.divergence_strip_not_fired++
  }
  // EVERY variant class must have fired — both sides of each dichotomy — or the generator has silently
  // stopped exercising it (the SS-R1-T2-IDENTITY hole). A zero counter fails LOUD, naming the dead class.
  for (const [cls, count] of Object.entries(cov)) {
    assert.ok(count > 0, `coverage class '${cls}' never fired across N=${N} seeded cases — the generator no longer exercises it (SS-R1-T2-IDENTITY)`)
  }
})

test('T2: REVISION value_json decodes to value for the registry consumer; a null encoded value is legacy-absent', () => {
  const wire = { reasoning: null, dispositions: [], milestones: [], revised_plan_markdown: null, decisions: [
    { id: 'd1', topic: 't1', value_json: JSON.stringify({ pick: 'A' }) },
    { id: 'd2', topic: 't2', value_json: null },
  ] }
  const view = normalizeStrictPayload(wire, ARCH.REVISION_PAYLOAD_DESCRIPTOR)
  assert.deepEqual(view.decisions[0].value, { pick: 'A' }, 'value_json decoded to value')
  assert.equal(Object.prototype.hasOwnProperty.call(view.decisions[0], 'value_json'), false)
  assert.equal(view.decisions[1].value, undefined, 'null value_json → value absent (registryFor reads null)')
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'revised_plan_markdown'), false, 'Fable revised_plan_markdown null → absent')
})

// ════════════════════════════════════ T3 — encoded round-trips + byte rail ════════════════════════════════════
// SS-R1-T3-VALIDATORS fix: the round-trip builds a COMPLETE wire payload (every required sibling present,
// via buildValidWire/defaultFor) and SCHEMA-VALIDATES the whole payload with the real instance validator
// (validateInstance) BEFORE normalizing — the r1 helper omitted required siblings and never validated, so
// an instance-shape regression stayed green. The multibyte case exercises the PRODUCTION registryFor
// rejection (extracted from architecture.js), not a local Buffer.byteLength reimplementation.
const roundTripValidated = (value, descriptor, encodedPath) => {
  const wire = buildValidWire(descriptor.schema, encodedPath, JSON.stringify(value))
  const errs = validateInstance(descriptor.schema, wire)
  assert.deepEqual(errs, [], `${encodedPath}: the full encoded payload validates against the schema (${errs.join(' | ')})`)
  const view = normalizeStrictPayload(wire, descriptor)
  return readDecodedPath(view, encodedPath)
}

test('T3: every encoded wire field round-trips value → encode → SCHEMA-VALIDATE(full payload) → normalize(decode) → canonical-equal', () => {
  const cases = [
    { desc: RATIFY_DESCRIPTOR, path: 'findings[].replacement_json', value: { a: 1, b: [2, 3], c: { d: true } } },
    { desc: ARCH.REVISION_PAYLOAD_DESCRIPTOR, path: 'decisions[].value_json', value: ['x', 1, null, { k: 'v' }] },
    { desc: ARCH.SOL_REVISION_PAYLOAD_DESCRIPTOR, path: 'decisions[].value_json', value: 42 },
    { desc: ARCH.NEGOTIATION_PAYLOAD_DESCRIPTOR, path: 'selections[].merged_value_json', value: { reconciled: 'both', order: [3, 2, 1] } },
  ]
  for (const { desc, path, value } of cases) {
    const back = roundTripValidated(value, desc, path)
    assert.equal(canonicalJson(back), canonicalJson(value), `${path}: decoded value is canonical-equal`)
  }
})

test('T3: the instance validator has teeth — it REJECTS a payload with a missing required sibling / bad enum / over-long wire field / additionalProperty', () => {
  // sanity that validateInstance is not vacuous (so the round-trip validation above is meaningful)
  const good = buildValidWire(RATIFY_SCHEMA, 'findings[].replacement_json', JSON.stringify({ a: 1 }))
  assert.deepEqual(validateInstance(RATIFY_SCHEMA, good), [])
  const missingReq = JSON.parse(JSON.stringify(good)); delete missingReq.findings[0].executable_check
  assert.ok(validateInstance(RATIFY_SCHEMA, missingReq).some((e) => /missing required 'executable_check'/.test(e)))
  const badEnum = JSON.parse(JSON.stringify(good)); badEnum.findings[0].evidence_class = 'not_a_class'
  assert.ok(validateInstance(RATIFY_SCHEMA, badEnum).some((e) => /not in enum/.test(e)))
  const overLong = JSON.parse(JSON.stringify(good)); overLong.reasoning = 'x'.repeat(401)
  assert.ok(validateInstance(RATIFY_SCHEMA, overLong).some((e) => /exceeds maxLength/.test(e)))
  const extra = JSON.parse(JSON.stringify(good)); extra.findings[0].sneaky = true
  assert.ok(validateInstance(RATIFY_SCHEMA, extra).some((e) => /additionalProperty forbidden/.test(e)))
})

test('T3: an unparsable encoded string is a SHAPE ERROR (throws), never a silent null', () => {
  const wire = buildValidWire(RATIFY_DESCRIPTOR.schema, 'findings[].replacement_json', '{not valid json')
  assert.throws(() => normalizeStrictPayload(wire, RATIFY_DESCRIPTOR), /unparsable JSON/)
})

test('T3: the PRODUCTION byte rail (registryFor) — not the wire maxLength — rules a MULTIBYTE value: it REFUSES a value whose UTF-8 bytes exceed the ceiling while its char length is under it, and ACCEPTS the boundary', () => {
  const { registryFor, utf8ByteLength, DECISION_VALUE_MAX_BYTES } = PROD
  // canonicalJson of a bare string is "…" (2 ASCII quotes + the chars); '€' is 3 UTF-8 bytes and 1 char.
  // n euros ⇒ canonical bytes = 2 + 3n, char length = 2 + n. Choose n so bytes land EXACTLY on the ceiling.
  const nAccept = (DECISION_VALUE_MAX_BYTES - 2) / 3
  assert.ok(Number.isInteger(nAccept), 'boundary math lands on an integer euro count')
  const acceptVal = '€'.repeat(nAccept)       // canonical bytes == ceiling  → accepted (check is `> MAX`)
  const rejectVal = '€'.repeat(nAccept + 1)   // canonical bytes == ceiling+3 → refused; STILL multibyte, char length << ceiling
  // both values' canonical CHARACTER length is under the ceiling — only the UTF-8 BYTE count differs
  assert.ok(canonicalJson(acceptVal).length < DECISION_VALUE_MAX_BYTES && canonicalJson(rejectVal).length < DECISION_VALUE_MAX_BYTES, 'char length is under the ceiling for both (maxLength ≠ bytes)')
  assert.equal(utf8ByteLength(canonicalJson(acceptVal)), DECISION_VALUE_MAX_BYTES, 'accept value canonical UTF-8 bytes sit exactly on the ceiling')
  assert.ok(utf8ByteLength(canonicalJson(rejectVal)) > DECISION_VALUE_MAX_BYTES, 'reject value canonical UTF-8 bytes exceed the ceiling')
  // the PRODUCTION registry rail is the authority: it ACCEPTS the boundary and REFUSES the over-ceiling value
  assert.doesNotThrow(() => registryFor({ decisions: [{ id: 'd', topic: 't', value: acceptVal }] }), 'registryFor accepts the boundary value')
  assert.throws(() => registryFor({ decisions: [{ id: 'd', topic: 't', value: rejectVal }] }), /over the 8192-byte per-value ceiling/, 'registryFor refuses the multibyte over-ceiling value (the byte rail, not the wire maxLength)')
  // the wire ceiling is only a coarse character-count guard, safely ABOVE the byte rail (never the authority)
  assert.ok(JSON.stringify(rejectVal).length < 65536, 'the over-byte-ceiling value still fits the coarse wire maxLength — proving maxLength cannot be the value authority')
})

// ════════════════════════════════════ T4 — consumer-view shape preservation ════════════════════════════════════
test('T4: the strict schemas preserve the consumer-view shape the existing suites drive (old-shape payloads pass through the tolerant normalizer unchanged)', () => {
  // The other v3 suites craft OLD-shape (pre-strict) council payloads; the normalizer is TOLERANT — a payload
  // that never carried the encoded/nullable wire shape passes through byte-identical, so those suites stay green.
  const oldShape = { verdict: 'APPROVE', artifact_hash: 'h', findings: [
    { finding_id: 'f', claim: 'c', required_change: 'r', evidence_refs: [], evidence_class: 'repo_state', executable_check: null, target_kind: 'settled_decision', key: 'k', replacement: { z: 9 } },
  ], changed_evidence: [], divergence_selections: [] }
  const view = normalizeStrictPayload(oldShape, RATIFY_DESCRIPTOR)
  assert.deepEqual(view, oldShape, 'a legacy-shape payload is unchanged by the tolerant normalizer')
  assert.equal(sha256Hex(canonicalJson(view)), sha256Hex(canonicalJson(oldShape)), 'checkpoint/seat hashes over a legacy payload are unchanged')
})

// ════════════════════════════════════ T5 — live codex acceptance receipts ════════════════════════════════════
test('T5: every codex-bound schema has a LIVE codex --output-schema acceptance receipt (ACCEPTED, no invalid_json_schema)', (t) => {
  const dir = `${ROOT}.kiln-dev/v302/receipts-strict`
  if (!existsSync(dir)) { t.skip('receipts-strict/ absent (live-run evidence not present in this checkout)'); return }
  const logs = readdirSync(dir).filter((f) => f.endsWith('.log'))
  if (!logs.length) { t.skip('no receipt logs present'); return }
  for (const { name, isSolLeg } of REGISTRY) {
    if (!isSolLeg) continue
    const f = `${dir}/${name}.log`
    assert.ok(existsSync(f), `${name}: acceptance receipt log present`)
    const body = readFileSync(f, 'utf8')
    assert.ok(!/invalid_json_schema/.test(body), `${name}: no invalid_json_schema error`)
    assert.ok(/ACCEPTED/.test(body), `${name}: ACCEPTED marker present`)
  }
})

// ════════════════════════════════════ T6 — mechanical enumeration ════════════════════════════════════
// SS-R1-T6-ENUMERATION fix: resolveSolLegSchemas parses EVERY solWrapperPrompt/solWrapperPlan/
// solByteOwnedPlan invocation and resolves its payloadSchema binding through direct `payloadSchema: NAME`,
// property-order-INDEPENDENT `schema:` on the cfg-helper callers (runBlindPair/runBuildBlindPair), the
// solWrapperPrompt→solWrapperPlan spread adapter, and FAILS LOUD on any binding it cannot resolve — no
// syntax-fragile `schema: X, descriptor: Y` adjacency, no `payloadSchema: cfg.schema` skip.
const SOL_ENUM_FILES = ['architecture.js', 'build.js', 'validate.js', 'vision.js', 'report.js'].map((f) => ({ name: f, src: readFileSync(`${WFSRC}/${f}`, 'utf8') })).concat([{ name: 'council.mjs', src: readFileSync(COUNCIL, 'utf8') }])

test('T6: EVERY payloadSchema reaching solWrapperPrompt/solWrapperPlan/solByteOwnedPlan resolves (fail-loud) to EXACTLY the strict-linted Sol-leg set', () => {
  const { resolved, unresolved } = resolveSolLegSchemas(SOL_ENUM_FILES)
  assert.deepEqual(unresolved, [], `every Sol-leg schema binding must resolve statically — unresolved: ${unresolved.join(' ; ')}`)
  const expected = new Set(REGISTRY.filter((r) => r.isSolLeg).map((r) => r.name))
  assert.deepEqual([...resolved].sort(), [...expected].sort(), `enumerated Sol-leg schemas (${[...resolved].sort().join(', ')}) must equal the strict-linted set`)
})

test('T6: the parser has teeth — a planted evasive Sol-leg call (non-adjacent schema:, reversed order, cfg pass-through, shorthand payloadSchema) is CAUGHT, never evaded', () => {
  // three evasive shapes the r1 regexes let slip, planted here as DATA. Each EVIL_* schema must be caught.
  const planted = [{ name: 'planted.js', src: `
const runBuildBlindPair = async (cfg) => { const plan = solWrapperPlan({ effort: 'x', payloadSchema: cfg.schema, taskText: 't' }); return plan }
const a = solByteOwnedPlan({ effort: 'high', descriptor: EVIL_DESCRIPTOR, phaseName, schema: SHOULD_NOT_MATCH, payloadSchema: EVIL_DIRECT })
const b = runBuildBlindPair({ m, descriptor: X_DESCRIPTOR, phaseName, schema: EVIL_VIA_CALLER })
` }]
  const { resolved, unresolved } = resolveSolLegSchemas(planted)
  assert.deepEqual(unresolved, [], 'the planted fixture resolves cleanly (no false unresolved)')
  assert.ok(resolved.has('EVIL_DIRECT'), 'a direct shorthand payloadSchema: NAME is caught')
  assert.ok(resolved.has('EVIL_VIA_CALLER'), 'a cfg pass-through schema resolved through the helper caller is caught')
  // and an UNRESOLVABLE binding fails loud (never a silent skip)
  const broken = [{ name: 'broken.js', src: `const c = solWrapperPlan({ effort: 'x', payloadSchema: mystery.dynamic, taskText: 't' })` }]
  assert.ok(resolveSolLegSchemas(broken).unresolved.length > 0, 'an unresolvable payloadSchema binding fails loud')
})

test('T6: non-literal evasion is CAUGHT — identifier-held solWrapperPlan(opts), a real cfg call solWrapperPrompt(cfg), and a computed cfg solByteOwnedPlan(makeCfg(X)) all land in unresolved; the `function NAME(cfg)` declaration and comment mentions are excluded (SS-R1-T6-ENUMERATION — no silent skip)', () => {
  // Sol's exact evasive shapes, planted as DATA. Under the r2 code these returned resolved:[] / unresolved:[]
  // (the `inner[0] !== '{'` skip swallowed them). Now each REAL non-literal call MUST fail loud, while the
  // wrapper's own declaration and a comment mention are the ONLY tokens excluded.
  const evasive = [{ name: 'evasive.js', src: `
// a comment mention is not a call: solWrapperPlan(ghostCfg)
function solWrapperPlan(cfg) { return cfg }
const p = solWrapperPlan(opts)
const q = solWrapperPrompt(cfg)
const r = solByteOwnedPlan(makeCfg(EVIL_CALL))
` }]
  const { resolved, unresolved } = resolveSolLegSchemas(evasive)
  assert.equal(resolved.size, 0, 'no schema is resolved from a non-literal argument')
  // EXACTLY the three evasive calls fail loud — length 3 proves the declaration AND the comment mention were
  // excluded (not counted), never treated as call sites.
  assert.equal(unresolved.length, 3, `exactly the 3 non-literal calls are caught (declaration + comment excluded) — got ${unresolved.length}: ${unresolved.join(' ; ')}`)
  assert.ok(unresolved.some((u) => /arg: opts/.test(u)), 'solWrapperPlan(opts) — identifier-held config — is caught')
  assert.ok(unresolved.some((u) => /arg: cfg\b/.test(u)), 'solWrapperPrompt(cfg) — a REAL cfg call, not the declaration — is caught')
  assert.ok(unresolved.some((u) => /arg: makeCfg\(EVIL_CALL\)/.test(u)), 'solByteOwnedPlan(makeCfg(EVIL_CALL)) — computed cfg — is caught')
})

// ════════════════════════════════════ T7 — boundary order ════════════════════════════════════
// SS-R1-T7-SEAM fix: the order is locked through the REAL machinery. crossCheckOk (council.mjs) is driven
// with a synthetic verified-row/reservation/sink fixture whose canonical hash matches the RAW wire; it
// PASSES against the raw canonical hash and FAILS against the normalized-view hash — proving verification
// must SEE the raw wire. A moving-normalization-before-verification edit would feed crossCheckOk the view
// hash and the seat would die. The companion seam pin (seamCheck) statically asserts, for every seam in
// workflows-src, that the runSol*CrossCheck call precedes its normCouncilPayload for the same raw identifier.
test('T7: crossCheckOk (real machinery) binds the RAW wire — it PASSES over the raw canonical hash and FAILS over the normalized-view hash (verification must precede normalization)', () => {
  // the RAW wire payload — nulls present, replacement encoded (exactly what codex writes to the .out file)
  const wire = { reasoning: null, artifact_hash: 'h'.repeat(64), verdict: 'BLOCK',
    findings: [{ finding_id: 'f1', claim: 'c', required_change: 'r', evidence_refs: ['e'], evidence_class: 'repo_state', executable_check: null, target_kind: 'settled_decision', key: 'topic:x', replacement_json: JSON.stringify({ v: 1 }) }],
    changed_evidence: [], divergence_selections: [] }
  const rawCanon = sha256Hex(canonicalJson(wire))
  const view = normalizeStrictPayload(wire, RATIFY_DESCRIPTOR)
  const viewCanon = sha256Hex(canonicalJson(view))
  assert.notEqual(rawCanon, viewCanon, 'the raw-wire hash differs from the normalized view (the boundary changed the shape)')
  // a synthetic invocation-exact ledger row + provenance sink so the WHOLE crossCheckOk chain binds — the
  // ONLY payload variable is binding.canonicalHash (raw vs view). Everything else is a self-consistent match.
  const invId = sha256Hex('inv'), receiptSha = sha256Hex('rcpt'), diskHash = sha256Hex(JSON.stringify(wire))
  const sink = { session_id: 'S', actual_transport_model: 'gpt-x', tokens_used: 42, prompt_hash: sha256Hex('prompt') }
  const cc = {
    output_sha256_disk: diskHash, output_canonical_sha256: rawCanon, // the ledger's canonical hash of what codex wrote = the RAW wire
    ledger: {
      verified: { status: 'verified', invocation_id: invId, receipt_sha256: receiptSha, output_sha256: diskHash, session_id: 'S', reported_model: 'gpt-x', tokens_used: 42, exit_code: 0, receipt_verified: true },
      reservation: { invocation_id: invId, keystone: 'K', phase: 'RATIFY', seat: 'sol', attempt: 1, run_token: 'RT', prompt_sha256: sink.prompt_hash },
    },
  }
  const binding = { relayedOutputHash: diskHash, canonicalHash: rawCanon, sink, keystone: 'K', phaseTag: 'RATIFY', seat: 'sol', attempt: 1, runToken: 'RT' }
  const rawRes = crossCheckOk(cc, binding)
  assert.equal(rawRes.ok, true, 'crossCheckOk PASSES when the bound canonicalHash is over the RAW wire — verification sees the attested bytes')
  assert.equal(rawRes.codex_receipt_hash, receiptSha, 'the raw pass promotes the receipt hash forward')
  const viewRes = crossCheckOk(cc, { ...binding, canonicalHash: viewCanon })
  assert.equal(viewRes.ok, false, 'crossCheckOk FAILS when the bound canonicalHash is over the NORMALIZED view — a normalize-before-verify edit kills the seat')
  // and the consumer view is legacy-stable (decoded amendment, dropped nulls) while the wire is never mutated
  assert.deepEqual(view.findings[0].replacement, { v: 1 })
  assert.equal(view.findings[0].target_kind, 'settled_decision')
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'reasoning'), false)
  assert.equal(sha256Hex(canonicalJson(wire)), rawCanon, 'the wire object is never mutated by normalization — its bound hash stays valid')
})

test('T7: seam-shape drift pin — in EVERY workflows-src seam, the runSol*CrossCheck call precedes its normCouncilPayload for the same raw identifier (a reorder turns a pin red)', () => {
  let totalPins = 0
  for (const f of ['architecture.js', 'build.js', 'validate.js', 'vision.js', 'report.js']) {
    const { errs, pins } = seamCheck(readFileSync(`${WFSRC}/${f}`, 'utf8'), f)
    assert.deepEqual(errs, [], `${f}: every cross-check precedes its normalize (${errs.join(' ; ')})`)
    totalPins += pins
  }
  assert.ok(totalPins >= 14, `every Sol seam is pinned (expected the full seam set, found ${totalPins})`)
  // the pin has teeth: a reordered seam (normalize BEFORE its cross-check) turns red
  const reordered = `\nconst rS = normCouncilPayload(rSraw, RATIFY_DESCRIPTOR)\nif (x) solCross = await runSolCrossCheck('sol:ratify', phaseTag, out, sink, rSraw, phaseName)\n`
  assert.ok(seamCheck(reordered, 'reordered').errs.length > 0, 'a normalize-before-cross-check reorder is caught')
})
