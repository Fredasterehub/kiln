// council.mjs — THE TWIN COUNCIL pure core (constitution twin-council.md; design sol-b34-design.md
// section "B3 — Debate state machine"). Everything a keystone council decision needs that must be a
// DETERMINISTIC SCRIPT rather than model prose: a pure-JS SHA-256 (workflow scripts have no
// node:crypto), canonical hashing, the deterministic seed/ID derivation, script-assigned finding
// canonicalization, disposition + reversal validation, the claim-scoped evidence partial order, the
// mechanical divergence-set construction (with the every-ID-accounted proof), decision bundles +
// blind-ratification validation + binding signatures, the 2x2 fresh-round machinery, reversibility
// sealing, the MEL exception record, checkpoint records + resume matching, and the four distinct
// terminal-outcome constructors. The authoritative artifact of a council is a STRUCTURED bundle, not
// synthesis — no model here selects between unresolved positions; the script does the accounting and
// the heads only rule.
//
// PURITY CONTRACT (workflow-determinism, sol-b34-design "State and checkpoint model"): no I/O, no
// node: imports, no ambient globals, and NO Date.now()/Math.random()/new Date() ANYWHERE — every
// protocol decision (IDs, fresh-round schedule, tie-break) derives exclusively from the spec's
// SHA-256 seed. The unhashed seed preimage AND the seed digest stay out of every peer-visible packet
// until terminalization (anonymity + tie-break-unpredictability rails).
//
// BUNDLER CONTRACT (scripts/bundle-workflows.mjs parseModule): every declaration is a top-level
// `export const` / `export function` block so architecture.js (batch 1b-ii) can inline any subset
// via the generic `// @inline:council:<name>[,<name>...]` marker with ZERO bundler changes. A block
// that calls another export (higher functions call sha256Hex / canonicalJson / deriveId / the phase
// tables / compareEvidence) must be inlined WITH the exports it names — list them together in one
// marker, exactly as build.js already inlines `@inline:spine:validateSlicePlan,runnerGate,...`. No
// non-export module-level helpers exist here on purpose: a stray helper between two exports would
// travel with only one of them under a single-name marker.

// COUNCIL_PROTOCOL_VERSION — bumped whenever any schema, ID rule, or aggregation changes; a bump
// invalidates every reusable phase cache (matchCheckpoint compares it), so a model-pin/template
// change can never silently reuse a phase judged under the old rules.
export const COUNCIL_PROTOCOL_VERSION = 'twin-council/3'

// COUNCIL_PHASES — the ordered barrier phases (sol-b34-design table). Each commits only after its
// entire SYMMETRIC barrier completes; NEGOTIATION_{SEALED,SKIPPED} are the two exits of the same
// slot (empty divergence set -> SKIPPED); ANSWER_EXCHANGE_SEALED is reached only when RATIFY_1 blocked.
export const COUNCIL_PHASES = Object.freeze([
  'DRAFTS_SEALED',
  'CRITIQUES_SEALED',
  'REVISIONS_SEALED',
  'DIVERGENCES_BUILT',
  'NEGOTIATION_SEALED',
  'NEGOTIATION_SKIPPED',
  'RATIFY_1_SEALED',
  'ANSWER_EXCHANGE_SEALED',
  'RATIFY_2_SEALED',
  'FRESH_CARDS_SEALED',
  'FRESH_CELLS_SETTLED',
  'REFERENCE_REDUCTION',
  'RUBRIC_CHECK',
])

// COUNCIL_TERMINALS — the four terminal states. Only RATIFIED is joint ratification;
// DEADLOCK_RESOLVED is exceptional authority; COUNCIL_DEADLOCK is an honest fail; DEGRADED is a
// missing/dead head. They are never interchangeable (constitution section 8) — see the terminal constructors.
export const COUNCIL_TERMINALS = Object.freeze(['RATIFIED', 'DEADLOCK_RESOLVED', 'COUNCIL_DEADLOCK', 'DEGRADED'])

// COUNCIL_PHASE_TRANSITIONS — the legal successor set for each barrier phase. DEGRADED is reachable
// from every non-terminal (a required head can die at any barrier). RATIFY_1 either ratifies (dual
// APPROVE) or opens the one answer exchange; RATIFY_2 either ratifies or enters the deadlock ladder.
// After the fresh round, BOTH routes — ambiguity (unstable / no_decision) AND structural (opposed) —
// must pass through reference-reduction and the rubric-indeterminacy check before ANY terminal other
// than RATIFIED or DEGRADED (constitution twin-council.md §5; fable-deadlock-design.md §4.1 steps 1–5).
// So FRESH_CELLS_SETTLED and REFERENCE_REDUCTION can only re-ratify (RATIFIED) or degrade before the
// cascade completes; DEADLOCK_RESOLVED / COUNCIL_DEADLOCK are reachable ONLY out of RUBRIC_CHECK
// (cascade steps 3–5: reversibility commit / tie-break / gated-or-auto-fail).
export const COUNCIL_PHASE_TRANSITIONS = Object.freeze({
  DRAFTS_SEALED: ['CRITIQUES_SEALED', 'DEGRADED'],
  CRITIQUES_SEALED: ['REVISIONS_SEALED', 'DEGRADED'],
  REVISIONS_SEALED: ['DIVERGENCES_BUILT', 'DEGRADED'],
  DIVERGENCES_BUILT: ['NEGOTIATION_SEALED', 'NEGOTIATION_SKIPPED', 'DEGRADED'],
  NEGOTIATION_SEALED: ['RATIFY_1_SEALED', 'DEGRADED'],
  NEGOTIATION_SKIPPED: ['RATIFY_1_SEALED', 'DEGRADED'],
  RATIFY_1_SEALED: ['RATIFIED', 'ANSWER_EXCHANGE_SEALED', 'DEGRADED'],
  ANSWER_EXCHANGE_SEALED: ['RATIFY_2_SEALED', 'DEGRADED'],
  RATIFY_2_SEALED: ['RATIFIED', 'FRESH_CARDS_SEALED', 'DEGRADED'],
  FRESH_CARDS_SEALED: ['FRESH_CELLS_SETTLED', 'DEGRADED'],
  FRESH_CELLS_SETTLED: ['RATIFIED', 'REFERENCE_REDUCTION', 'DEGRADED'],
  REFERENCE_REDUCTION: ['RUBRIC_CHECK', 'RATIFIED', 'DEGRADED'],
  RUBRIC_CHECK: ['RATIFIED', 'DEADLOCK_RESOLVED', 'COUNCIL_DEADLOCK', 'DEGRADED'],
})

// canTransition(from, to) — is `to` a legal successor of `from`? Terminals have no successors; an
// unknown `from` is never legal (fail closed). Inline WITH COUNCIL_PHASE_TRANSITIONS.
export function canTransition(from, to) {
  const succ = COUNCIL_PHASE_TRANSITIONS[from]
  return Array.isArray(succ) && succ.includes(to)
}

// sha256Hex(input) — a correct, pure-JS SHA-256 (FIPS 180-4) over a string (UTF-8 encoded here, no
// TextEncoder dependency) or a byte array / Uint8Array. Load-bearing: workflow scripts cannot import
// node:crypto, yet every council ID, packet hash, bundle hash, signature, and tie-break derives from
// SHA-256. Verified in the test suite against the published empty/"abc"/multi-block vectors AND
// cross-checked against node:crypto. All arithmetic is kept inside the 32-bit / safe-integer range.
export function sha256Hex(input) {
  let bytes
  if (typeof input === 'string') {
    // WHATWG/TextEncoder UTF-8: a high surrogate is a pair ONLY when the very next unit is a low
    // surrogate; every LONE surrogate (high with no trailing low, or a bare low) encodes as U+FFFD
    // (0xEF 0xBF 0xBD). Matching node:crypto/Buffer.from(str,'utf8') exactly.
    bytes = []
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i)
      if (c < 0x80) bytes.push(c)
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
      else if (c >= 0xd800 && c <= 0xdbff) {
        const c2 = i + 1 < input.length ? input.charCodeAt(i + 1) : 0
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff)
          i++
          bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
        } else bytes.push(0xef, 0xbf, 0xbd) // lone high surrogate -> U+FFFD
      } else if (c >= 0xdc00 && c <= 0xdfff) bytes.push(0xef, 0xbf, 0xbd) // lone low surrogate -> U+FFFD
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  } else if (input instanceof Uint8Array) bytes = Array.from(input)
  else if (Array.isArray(input)) bytes = input.map((b) => b & 0xff)
  else throw new Error('sha256Hex: input must be a string or byte array')

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19

  const bitLen = bytes.length * 8
  const hiLen = Math.floor(bytes.length / 0x20000000) // (len*8) >> 32
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  bytes.push((hiLen >>> 24) & 0xff, (hiLen >>> 16) & 0xff, (hiLen >>> 8) & 0xff, hiLen & 0xff)
  bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff)

  const w = new Array(64)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
}

// canonicalJson(value) — recursively KEY-SORTED serialization so a hash is key-order-insensitive
// (the kiln-codex-receipt.mjs idiom, mirrored not imported). Expects JSON-serializable input.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
}

// councilSeed(binding) — the spec's deterministic seed:
//   SHA256(protocol_version || runToken || initialSeq || keystoneId || decisionId || divergenceId || template_hash)
// The injective separator scheme is the canonical-JSON object serialization itself: fixed keys plus
// JSON string escaping make the field concatenation unambiguous (no value can forge a boundary), the
// same discipline kiln-codex-receipt.mjs uses for deriveInvocationId. Returns the hex digest — the
// hidden seed. Neither this digest NOR its preimage may appear in any peer-visible packet/prompt.
// Inline WITH sha256Hex, canonicalJson.
export function councilSeed(binding) {
  const b = binding || {}
  return sha256Hex(canonicalJson({
    protocol_version: b.protocolVersion != null ? b.protocolVersion : (b.protocol_version != null ? b.protocol_version : ''),
    run_token: b.runToken != null ? b.runToken : (b.run_token != null ? b.run_token : ''),
    initial_seq: b.initialSeq != null ? b.initialSeq : (b.initial_seq != null ? b.initial_seq : null),
    keystone_id: b.keystoneId != null ? b.keystoneId : (b.keystone_id != null ? b.keystone_id : ''),
    decision_id: b.decisionId != null ? b.decisionId : (b.decision_id != null ? b.decision_id : null),
    divergence_id: b.divergenceId != null ? b.divergenceId : (b.divergence_id != null ? b.divergence_id : null),
    template_hash: b.templateHash != null ? b.templateHash : (b.template_hash != null ? b.template_hash : ''),
  }))
}

// deriveId(seed, parts) — a stable id derived from the hidden seed and a structured parts vector.
// SHA256 of the seed hides the seed (an id never lets the seed be recovered). Inline WITH sha256Hex,
// canonicalJson.
export function deriveId(seed, parts) {
  return sha256Hex(canonicalJson({ seed: String(seed), parts: parts === undefined ? null : parts }))
}

// parityTieBreak(seed) — 0 or 1 from the hidden seed's low nibble. Deterministic yet unpredictable
// while the seed stays out of prompts (constitution deadlock ladder step 4 tie-break).
export function parityTieBreak(seed) {
  const s = String(seed)
  return parseInt(s.charAt(s.length - 1) || '0', 16) & 1
}

// canonicalizeFindings(critiques) — sol-b34-design section 2. Models never author authoritative
// finding IDs. Given the two critiques (each { target_slot, findings:[{target_decision_id, claim,
// required_change, severity, evidence}] }), the SCRIPT assigns stable IDs
//   F-<decision-seq>-<target-slot>-<NNN>
// keyed by (target slot, target decision id, normalized claim/required-change text, original array
// ordinal) — independent of completion order, model wording about identity, clocks, or randomness.
// decision-seq is the 1-based ordinal of the target decision among the sorted distinct decision ids
// WITHIN its slot; NNN counts findings against that (slot, decision) in canonical order. Slot and id
// stay separate through nested maps — no joined string key.
export function canonicalizeFindings(critiques) {
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const pad3 = (n) => String(n).padStart(3, '0')
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const items = []
  for (const c of (Array.isArray(critiques) ? critiques : [])) {
    const slot = c && c.target_slot != null ? String(c.target_slot) : ''
    const fs = c && Array.isArray(c.findings) ? c.findings : []
    fs.forEach((f, ordinal) => {
      items.push({
        target_slot: slot,
        target_decision_id: f && f.target_decision_id != null ? String(f.target_decision_id) : '',
        claim: f ? f.claim : undefined,
        required_change: f ? f.required_change : undefined,
        severity: f ? f.severity : undefined,
        evidence: f ? f.evidence : undefined,
        _ntext: norm(`${f && f.claim != null ? f.claim : ''} ${f && f.required_change != null ? f.required_change : ''}`),
        _ordinal: ordinal,
      })
    })
  }
  const seqBySlot = new Map()
  for (const it of items) {
    if (!seqBySlot.has(it.target_slot)) seqBySlot.set(it.target_slot, new Set())
    seqBySlot.get(it.target_slot).add(it.target_decision_id)
  }
  for (const [slot, set] of seqBySlot) {
    const ranked = new Map()
    ;[...set].sort(cmp).forEach((id, i) => ranked.set(id, i + 1))
    seqBySlot.set(slot, ranked)
  }
  const seqFor = (it) => seqBySlot.get(it.target_slot).get(it.target_decision_id)
  items.sort((a, b) =>
    cmp(a.target_slot, b.target_slot) ||
    (seqFor(a) - seqFor(b)) ||
    cmp(a._ntext, b._ntext) ||
    (a._ordinal - b._ordinal))
  const counterBySlot = new Map()
  return items.map((it) => {
    if (!counterBySlot.has(it.target_slot)) counterBySlot.set(it.target_slot, new Map())
    const cm = counterBySlot.get(it.target_slot)
    cm.set(it.target_decision_id, (cm.get(it.target_decision_id) || 0) + 1)
    return {
      id: `F-${pad3(seqFor(it))}-${it.target_slot}-${pad3(cm.get(it.target_decision_id))}`,
      target_slot: it.target_slot,
      target_decision_id: it.target_decision_id,
      claim: it.claim,
      required_change: it.required_change,
      severity: it.severity,
      evidence: it.evidence,
    }
  })
}

// validateDispositions(frozenFindings, dispositions) — sol-b34-design section 3. Each disposition is
// { finding_id, disposition: accepted|rejected_with_evidence|unresolved, evidence_refs,
// incorporated_at, reason }. Every frozen finding ID must appear EXACTLY once — unknown, duplicate,
// or missing IDs invalidate the whole response. accepted requires a mechanically detectable
// incorporated_at; rejected_with_evidence requires evidence_refs, and an UNEVIDENCED rejection is
// demoted to unresolved (never a silent retirement). Returns { valid, errors, dispositions } where
// dispositions is the normalized (demotion-applied) effective list.
export function validateDispositions(frozenFindings, dispositions) {
  const ENUM = ['accepted', 'rejected_with_evidence', 'unresolved']
  const ids = (Array.isArray(frozenFindings) ? frozenFindings : []).map((f) => (f && typeof f === 'object' ? f.id : f)).filter((x) => typeof x === 'string')
  const idSet = new Set(ids)
  const list = Array.isArray(dispositions) ? dispositions : []
  const errors = []
  const seen = new Map()
  const effective = []
  for (const d of list) {
    const fid = d && d.finding_id
    if (!idSet.has(fid)) { errors.push({ code: 'unknown_finding', at: fid, message: `disposition targets a non-frozen finding '${fid}'` }); continue }
    seen.set(fid, (seen.get(fid) || 0) + 1)
    if (seen.get(fid) > 1) { errors.push({ code: 'duplicate_finding', at: fid, message: `finding '${fid}' is disposed more than once` }); continue }
    let disposition = d.disposition
    if (!ENUM.includes(disposition)) { errors.push({ code: 'bad_disposition', at: fid, message: `disposition must be one of ${ENUM.join('|')}` }); continue }
    const evidenceRefs = Array.isArray(d.evidence_refs) ? d.evidence_refs.filter((x) => x != null) : []
    const incorporatedAt = Array.isArray(d.incorporated_at) ? d.incorporated_at.filter((s) => typeof s === 'string' && s) : []
    if (disposition === 'accepted' && !incorporatedAt.length) {
      errors.push({ code: 'accepted_without_incorporation', at: fid, message: 'accepted requires a mechanically detectable incorporated_at' })
      continue
    }
    if (disposition === 'rejected_with_evidence' && !evidenceRefs.length) disposition = 'unresolved' // unevidenced rejection demotes
    effective.push({ finding_id: fid, disposition, evidence_refs: evidenceRefs, incorporated_at: incorporatedAt })
  }
  for (const id of ids) if (!seen.has(id)) errors.push({ code: 'missing_finding', at: id, message: `frozen finding '${id}' has no disposition` })
  return { valid: errors.length === 0, errors, dispositions: effective }
}

// claimTypeForClass(evidenceClass) — the claim scope an evidence class belongs to (sol-b34-design
// section 4). Evidence is compared ONLY within a claim scope; an unrecognized class has no scope
// (-> incomparable).
export function claimTypeForClass(evidenceClass) {
  const c = String(evidenceClass || '')
  if (c === 'executed_check' || c === 'proposed_check') return 'executable'
  if (c === 'repo_state' || c === 'test_output') return 'repo'
  if (c === 'primary_source') return 'external'
  if (c === 'scenario') return 'risk'
  return null
}

// compareEvidence(a, b, claimType) — the claim-scoped evidence PARTIAL order (sol-b34-design section
// 4), NOT a universal score. Returns 'stronger' | 'equal' | 'weaker' | 'incomparable' for a relative
// to b. Ranks are scoped: executable claims rank executed_check above proposed_check; repo claims
// treat repo_state and test_output as comparable (equal); external claims compare primary_source;
// risk claims compare scenario. A class outside the claim's scope is INCOMPARABLE — and incomparable
// evidence can never retire a finding. Inline WITH claimTypeForClass when claimType is inferred.
export function compareEvidence(a, b, claimType) {
  const RANKS = {
    executable: { executed_check: 2, proposed_check: 1 },
    repo: { repo_state: 1, test_output: 1 },
    external: { primary_source: 1 },
    risk: { scenario: 1 },
  }
  const ct = claimType || claimTypeForClass(a && a.class) || claimTypeForClass(b && b.class)
  const table = RANKS[ct]
  if (!table) return 'incomparable'
  const ra = table[String(a && a.class)]
  const rb = table[String(b && b.class)]
  if (ra === undefined || rb === undefined) return 'incomparable'
  return ra > rb ? 'stronger' : ra < rb ? 'weaker' : 'equal'
}

// validateReversal(prior, reversal) — the constitution section 6 anti-capitulation
// signature-validity rule. An approval that reverses a standing block is a valid signature ONLY when
// its changed_evidence is present and at least as strong (claim-scoped) as the blocking evidence it
// retires. An invalid reversal leaves the prior block STANDING — a peer-pressure flip cannot supply
// the second signature. prior: { evidence, claim_type? }; reversal: { changed_evidence, claim_type? }.
// changed_evidence MUST be an ARRAY (the §6 ratification schema's changed_evidence[]): a bare object is
// invalid and is NEVER coerced — the reversal stands iff AT LEAST ONE array element is equal-or-stronger
// (claim-scoped). An absent, non-array, or empty changed_evidence leaves the block standing. Inline WITH
// compareEvidence, claimTypeForClass.
export function validateReversal(prior, reversal) {
  const p = prior || {}, r = reversal || {}
  if (r.changed_evidence == null) return { valid: false, block_stands: true, relation: 'incomparable', reason: 'changed_evidence_absent' }
  if (!Array.isArray(r.changed_evidence)) return { valid: false, block_stands: true, relation: 'incomparable', reason: 'changed_evidence_not_array' }
  const list = r.changed_evidence
  if (!list.length) return { valid: false, block_stands: true, relation: 'incomparable', reason: 'changed_evidence_absent' }
  const rank = { stronger: 3, equal: 2, weaker: 1, incomparable: 0 }
  let best = 'incomparable'
  for (const ev of list) {
    const ct = r.claim_type || p.claim_type || claimTypeForClass(ev && ev.class) || claimTypeForClass(p.evidence && p.evidence.class)
    const rel = compareEvidence(ev, p.evidence, ct)
    if (rank[rel] > rank[best]) best = rel
  }
  const ok = best === 'stronger' || best === 'equal'
  return { valid: ok, block_stands: !ok, relation: best, reason: ok ? null : `no changed_evidence element is equal-or-stronger (best: ${best}) — a concession cannot clear a block` }
}

// buildDivergenceSet(input) — sol-b34-design section 4. Diogenes may NORMALIZE (alias topics, add
// incompatibility edges) but may never decide a finding away; the SCRIPT constructs the divergence
// set from the six triggers and PROVES every finding and decision id is accounted for exactly once.
// input:
//   findings:        frozen findings [{ id, target_slot, target_decision_id, claim_type?, evidence }]
//   dispositions:    effective dispositions [{ finding_id, disposition, evidence, incorporated }]
//                    (evidence = the rebuttal for rejected_with_evidence; incorporated: boolean for accepted)
//   decisions:       { <slot>: [{ id, topic, value_hash }] } revised registries
//   neither:         [{ topic, opposed_slot }] a valid position opposed by NEITHER
//   atomicConflicts: [{ topic_a, topic_b }] locally-agreed decisions that cannot coexist
//   normalizer:      optional { findingIds:[...], decisionIds:[...] } — MUST cover every original id
//   seed:            the hidden run seed (councilSeed) — MANDATORY. Divergence ids derive from it via
//                    deriveId, so DV ids are bound to run token / keystone / template / initial
//                    sequence (sol-b34-design §49). The bound-ID rule is constitutional: an
//                    absent/empty seed THROWS (fail closed — never a run-unbound ordinal).
// The six triggers: (1) unresolved finding; (2) rejected_with_evidence whose rebuttal is weaker/
// incomparable; (3) accepted-but-not-incorporated; (4) same normalized topic across >=2 slots with
// differing values; (5) NEITHER opposes a position; (6) atomic incompatibility. Throws on a missing
// seed, any unaccounted id, any normalizer-dropped id, and any DUPLICATE (slot,id) decision. Returns
// { divergences, accounting, hash, empty }. Decision identity is tracked by object reference (each
// { slot, id } entry), never a joined string. Inline WITH deriveId, compareEvidence, claimTypeForClass,
// canonicalJson, sha256Hex.
export function buildDivergenceSet(input) {
  const inp = input || {}
  if (typeof inp.seed !== 'string' || inp.seed === '') throw new Error('buildDivergenceSet: a non-empty run seed is required — divergence ids are constitutionally run-bound (sol-b34-design §49)')
  const findings = Array.isArray(inp.findings) ? inp.findings : []
  const dispositions = Array.isArray(inp.dispositions) ? inp.dispositions : []
  const decisions = inp.decisions && typeof inp.decisions === 'object' ? inp.decisions : {}
  const neither = Array.isArray(inp.neither) ? inp.neither : []
  const atomicConflicts = Array.isArray(inp.atomicConflicts) ? inp.atomicConflicts : []
  const normalizer = inp.normalizer && typeof inp.normalizer === 'object' ? inp.normalizer : null
  const seed = inp.seed

  const decisionEntries = []
  for (const slot of Object.keys(decisions)) {
    const seenInSlot = new Set()
    for (const dec of (Array.isArray(decisions[slot]) ? decisions[slot] : [])) {
      if (!dec || typeof dec.id !== 'string') continue
      if (seenInSlot.has(dec.id)) throw new Error(`buildDivergenceSet: duplicate decision id '${dec.id}' in slot '${slot}' — a slot's registry must be unique`)
      seenInSlot.add(dec.id)
      decisionEntries.push({ slot, id: dec.id, topic: String(dec.topic != null ? dec.topic : ''), value_hash: dec.value_hash != null ? dec.value_hash : null })
    }
  }
  const findingIds = findings.map((f) => f && f.id).filter((x) => typeof x === 'string')

  if (normalizer) {
    const nf = new Set(Array.isArray(normalizer.findingIds) ? normalizer.findingIds : [])
    const nd = new Set(Array.isArray(normalizer.decisionIds) ? normalizer.decisionIds : [])
    for (const id of findingIds) if (!nf.has(id)) throw new Error(`buildDivergenceSet: normalizer dropped finding id '${id}' — normalization may alias but never delete`)
    for (const e of decisionEntries) if (!nd.has(e.id)) throw new Error(`buildDivergenceSet: normalizer dropped decision id '${e.id}' — normalization may alias but never delete`)
  }

  const dispByFinding = new Map()
  for (const d of dispositions) if (d && typeof d.finding_id === 'string') dispByFinding.set(d.finding_id, d)

  const divergences = []
  const retiredFindings = []
  const divergentFindings = []
  const findingSeen = new Set()
  for (const f of findings) {
    if (!f || typeof f.id !== 'string') continue
    if (findingSeen.has(f.id)) throw new Error(`buildDivergenceSet: duplicate finding id '${f.id}'`)
    findingSeen.add(f.id)
    const d = dispByFinding.get(f.id)
    let trigger = null
    if (d == null || d.disposition === 'unresolved') trigger = 'unresolved_finding'
    else if (d.disposition === 'accepted') { if (d.incorporated === false) trigger = 'accepted_not_incorporated' }
    else if (d.disposition === 'rejected_with_evidence') {
      const ct = f.claim_type || claimTypeForClass(f.evidence && f.evidence.class)
      const rel = compareEvidence(d.evidence, f.evidence, ct)
      if (rel === 'weaker' || rel === 'incomparable') trigger = 'rejected_weak_evidence'
    }
    if (trigger) { divergentFindings.push(f.id); divergences.push({ divergence_id: '', trigger, finding_id: f.id, target_slot: f.target_slot != null ? f.target_slot : null, target_decision_id: f.target_decision_id != null ? f.target_decision_id : null }) }
    else retiredFindings.push(f.id)
  }

  const byTopic = new Map()
  for (const e of decisionEntries) {
    if (!byTopic.has(e.topic)) byTopic.set(e.topic, [])
    byTopic.get(e.topic).push(e)
  }
  const asRef = (e) => ({ slot: e.slot, id: e.id })
  const byRef = (u, v) => (u.slot < v.slot ? -1 : u.slot > v.slot ? 1 : (u.id < v.id ? -1 : u.id > v.id ? 1 : 0))
  const refs = (members) => members.map(asRef).sort(byRef) // card members are canonically ordered so the hash is input-order-independent
  const divergentDecisions = new Set() // entry objects — identity, never a string
  for (const [topic, members] of byTopic) {
    const slotsInvolved = new Set(members.map((m) => m.slot))
    const distinctValues = new Set(members.map((m) => canonicalJson(m.value_hash)))
    if (slotsInvolved.size >= 2 && distinctValues.size > 1) {
      for (const m of members) divergentDecisions.add(m)
      divergences.push({ divergence_id: '', trigger: 'incompatible_topic_values', topic, members: refs(members) })
    }
  }
  for (const n of neither) {
    const topic = String(n && n.topic != null ? n.topic : '')
    const members = byTopic.get(topic) || []
    for (const m of members) divergentDecisions.add(m)
    divergences.push({ divergence_id: '', trigger: 'neither_opposes_position', topic, opposed_slot: n && n.opposed_slot != null ? n.opposed_slot : null, members: refs(members) })
  }
  for (const a of atomicConflicts) {
    const members = []
    for (const field of ['topic_a', 'topic_b']) {
      const topic = String(a && a[field] != null ? a[field] : '')
      for (const m of (byTopic.get(topic) || [])) { divergentDecisions.add(m); members.push(m) }
    }
    divergences.push({ divergence_id: '', trigger: 'atomic_incompatibility', topics: [a && a.topic_a != null ? a.topic_a : null, a && a.topic_b != null ? a.topic_b : null], members: refs(members) })
  }

  // Both the sort key AND the id preimage are the ENTIRE card minus the id placeholder (every
  // discriminating field — trigger, finding_id, target_slot, target_decision_id, topic, opposed_slot,
  // topics, members). Using the FULL card as the sort key means two distinct cards can never tie (so
  // the output order — and thus the set hash — is input-order-independent), and it guarantees two
  // distinct divergences never share an id (e.g. a P0- vs P1-opposed NEITHER on the same topic). The id
  // is seed-bound (sol-b34-design §49): DV-<12 hex derived from the hidden seed and that same card.
  const cardKey = (dv) => { const d = { ...dv }; delete d.divergence_id; return canonicalJson(d) }
  divergences.sort((x, y) => { const kx = cardKey(x), ky = cardKey(y); return kx < ky ? -1 : kx > ky ? 1 : 0 })
  divergences.forEach((dv) => {
    const discriminator = { ...dv }
    delete discriminator.divergence_id
    dv.divergence_id = `DV-${deriveId(seed, ['divergence', discriminator]).slice(0, 12)}`
  })

  // proof: findings partition into retired XOR divergent; decision entries partition by identity.
  const accFindings = new Set([...retiredFindings, ...divergentFindings])
  if (accFindings.size !== retiredFindings.length + divergentFindings.length) throw new Error('buildDivergenceSet: a finding id is BOTH retired and divergent — accounting is not a partition')
  for (const id of findingIds) if (!accFindings.has(id)) throw new Error(`buildDivergenceSet: finding id '${id}' is unaccounted — every finding must be retired or divergent`)
  const settledEntries = decisionEntries.filter((e) => !divergentDecisions.has(e))
  const divergentEntries = decisionEntries.filter((e) => divergentDecisions.has(e))
  if (settledEntries.length + divergentEntries.length !== decisionEntries.length) throw new Error('buildDivergenceSet: a decision is unaccounted — settled/divergent is not a partition')

  const accounting = {
    findings: { retired: retiredFindings.slice().sort(), divergent: divergentFindings.slice().sort() },
    decisions: { settled: settledEntries.map(asRef).sort(byRef), divergent: divergentEntries.map(asRef).sort(byRef) },
  }
  return { divergences, accounting, hash: sha256Hex(canonicalJson({ divergences, accounting })), empty: divergences.length === 0 }
}

// buildDecisionBundle(parts) — sol-b34-design section 5. The authoritative post-negotiation object is
// a STRUCTURED bundle, never model synthesis. Each open divergence must carry
// { divergence_id, position_0, position_1, compatibility_edges, evidence_refs }. Returns
// { bundle, valid, errors, hash }. Inline WITH canonicalJson, sha256Hex.
export function buildDecisionBundle(parts) {
  const p = parts || {}
  const divs = Array.isArray(p.open_divergences) ? p.open_divergences : []
  const errors = []
  divs.forEach((d, i) => {
    for (const k of ['divergence_id', 'position_0', 'position_1', 'compatibility_edges', 'evidence_refs']) {
      if (!d || !Object.prototype.hasOwnProperty.call(d, k)) errors.push({ code: 'malformed_divergence', at: `open_divergences[${i}]`, message: `open divergence missing '${k}'` })
    }
  })
  const bundle = {
    common_trunk: p.common_trunk != null ? p.common_trunk : {},
    settled_decisions: p.settled_decisions != null ? p.settled_decisions : {},
    open_divergences: divs,
    renderer_version: p.renderer_version != null ? p.renderer_version : null,
    evidence_manifest_hash: p.evidence_manifest_hash != null ? p.evidence_manifest_hash : null,
  }
  return { bundle, valid: errors.length === 0, errors, hash: sha256Hex(canonicalJson(bundle)) }
}

// bundleHash(bundle) — the canonical hash of a decision bundle. Inline WITH canonicalJson, sha256Hex.
export function bundleHash(bundle) {
  return sha256Hex(canonicalJson(bundle))
}

// validateRatification(ratification, ctx) — sol-b34-design section 6 blind-ratification schema.
// verdict is APPROVE|BLOCK|NEITHER; divergence_selections must cover EXACTLY the open divergence ids
// (each P0|P1|MERGED|NEITHER, none unknown/duplicated/missing); artifact_hash must equal the bundle
// hash; every findings[] entry is shape-checked ({finding_id, claim, required_change, evidence_refs[],
// executable_check present}). ctx: { bundle_hash, open_divergence_ids, standing_blocks?,
// compatibility_edges? }. Constitution section 6: an APPROVE that reverses a standing block is INVALID
// unless its changed_evidence[] equal-or-stronger clears EACH block (the block stands otherwise).
// spec section 7: the selected combination is checked against compatibility_edges — an incompatible
// pair of adopted selections is rejected before the ratification validates. Returns { valid, errors }.
// Inline WITH validateReversal, compareEvidence, claimTypeForClass.
export function validateRatification(ratification, ctx) {
  const r = ratification || {}, c = ctx || {}
  const errors = []
  const VERDICTS = ['APPROVE', 'BLOCK', 'NEITHER']
  const SELECTIONS = ['P0', 'P1', 'MERGED', 'NEITHER']
  if (!VERDICTS.includes(r.verdict)) errors.push({ code: 'bad_verdict', message: `verdict must be one of ${VERDICTS.join('|')}` })
  if (c.bundle_hash != null && r.artifact_hash !== c.bundle_hash) errors.push({ code: 'artifact_hash_mismatch', message: 'ratification artifact_hash does not equal the bundle hash' })
  const open = Array.isArray(c.open_divergence_ids) ? c.open_divergence_ids.map(String) : []
  const sels = Array.isArray(r.divergence_selections) ? r.divergence_selections : []
  const seen = []
  const selectionOf = new Map()
  for (const s of sels) {
    const id = s && s.divergence_id != null ? String(s.divergence_id) : undefined
    if (!s || !SELECTIONS.includes(s.selection)) errors.push({ code: 'bad_selection', at: id, message: 'selection must be P0|P1|MERGED|NEITHER' })
    if (id === undefined || !open.includes(id)) errors.push({ code: 'unknown_divergence', at: id, message: 'selection targets an unknown divergence' })
    else if (seen.includes(id)) errors.push({ code: 'duplicate_divergence', at: id, message: 'divergence selected more than once' })
    else { seen.push(id); selectionOf.set(id, s.selection) }
  }
  for (const id of open) if (!seen.includes(id)) errors.push({ code: 'uncovered_divergence', at: id, message: `open divergence '${id}' has no selection` })

  // findings[] entry shape (§6 schema): finding_id, claim, required_change, evidence_refs[], executable_check
  // present. A PRESENT-but-non-array findings field is itself malformed — only ABSENT defaults to empty.
  let findings = []
  if (r.findings !== undefined) {
    if (!Array.isArray(r.findings)) errors.push({ code: 'malformed_findings', message: 'findings must be an array (the §6 schema) when present' })
    else findings = r.findings
  }
  findings.forEach((f, i) => {
    const at = `findings[${i}]`
    if (!f || typeof f !== 'object' || Array.isArray(f)) { errors.push({ code: 'malformed_finding', at, message: 'finding must be an object' }); return }
    if (typeof f.finding_id !== 'string' || !f.finding_id) errors.push({ code: 'malformed_finding', at, message: 'finding_id must be a nonempty string' })
    if (typeof f.claim !== 'string' || !f.claim) errors.push({ code: 'malformed_finding', at, message: 'claim must be a nonempty string' })
    if (typeof f.required_change !== 'string' || !f.required_change) errors.push({ code: 'malformed_finding', at, message: 'required_change must be a nonempty string' })
    if (!Array.isArray(f.evidence_refs)) errors.push({ code: 'malformed_finding', at, message: 'evidence_refs must be an array' })
    if (!Object.prototype.hasOwnProperty.call(f, 'executable_check')) errors.push({ code: 'malformed_finding', at, message: 'executable_check must be present (null allowed)' })
  })

  // anti-capitulation: an APPROVE reversing a standing block needs equal-or-stronger changed_evidence
  const standing = Array.isArray(c.standing_blocks) ? c.standing_blocks : []
  if (r.verdict === 'APPROVE' && standing.length) {
    for (const block of standing) {
      const rev = validateReversal(block, { changed_evidence: r.changed_evidence, claim_type: block && block.claim_type })
      if (!rev.valid) errors.push({ code: 'unevidenced_reversal', at: block && block.finding_id, message: 'APPROVE reverses a standing block without equal-or-stronger changed_evidence — the block stands' })
    }
  }

  // atomic compatibility: the adopted selection combination must satisfy every compatibility edge (§7).
  // Every edge is SHAPE-CHECKED first — exactly two members, each { divergence_id, selection } with a
  // legal selection; a malformed edge is a validation error (never silently skipped), and an edge whose
  // two members name the SAME divergence is a context programming error (self_edge).
  // a PRESENT-but-non-array compatibility_edges container is itself malformed (mirror the findings rule);
  // only an ABSENT container defaults to empty.
  let edges = []
  if (c.compatibility_edges !== undefined) {
    if (!Array.isArray(c.compatibility_edges)) errors.push({ code: 'malformed_edges_container', message: 'compatibility_edges must be an array when present' })
    else edges = c.compatibility_edges
  }
  edges.forEach((edge, i) => {
    const at = `compatibility_edges[${i}]`
    const pair = Array.isArray(edge) ? edge : [edge && edge.left, edge && edge.right]
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((m) => m && typeof m === 'object' && m.divergence_id != null && SELECTIONS.includes(m.selection))) {
      errors.push({ code: 'malformed_edge', at, message: 'a compatibility edge must have exactly two { divergence_id, selection } members with legal selections' })
      return
    }
    if (String(pair[0].divergence_id) === String(pair[1].divergence_id)) {
      errors.push({ code: 'self_edge', at, message: 'a compatibility edge cannot relate a divergence to itself' })
      return
    }
    if (pair.every((m) => selectionOf.get(String(m.divergence_id)) === m.selection)) {
      errors.push({ code: 'incompatible_selection', at, message: `the selected combination violates a compatibility edge: ${pair.map((m) => `${m.divergence_id}=${m.selection}`).join(' + ')}` })
    }
  })

  return { valid: errors.length === 0, errors }
}

// councilSignature(fields) — a head's binding signature. It binds the bundle hash, renderer version,
// resulting plan hash, evidence manifest hash, protocol version, and seat provenance; ANY
// post-signature revision to a bound field changes signature_hash, so verifySignature then fails
// (sol-b34-design section 6 "any post-signature revision invalidates both"). Inline WITH sha256Hex,
// canonicalJson.
export function councilSignature(fields) {
  const f = fields || {}
  const bound = {
    bundle_hash: f.bundle_hash != null ? f.bundle_hash : null,
    renderer_version: f.renderer_version != null ? f.renderer_version : null,
    plan_hash: f.plan_hash != null ? f.plan_hash : null,
    evidence_manifest_hash: f.evidence_manifest_hash != null ? f.evidence_manifest_hash : null,
    protocol_version: f.protocol_version != null ? f.protocol_version : null,
    seat_provenance: f.seat_provenance != null ? f.seat_provenance : null,
  }
  return { ...bound, signature_hash: sha256Hex(canonicalJson(bound)) }
}

// verifySignature(signature, currentContext) — two-layer verification. Layer 1 (always): the
// signature is internally intact — recomputing the bound hash from the signature's own fields matches
// signature_hash. Layer 2 (when currentContext is supplied): every bound field the context names must
// EQUAL the CURRENT value, so a signature made over a stale bundle/plan is rejected once the artifact
// changes (the finding: an old signature must NOT verify after the bundle hash moves). A caller that
// only wants integrity may omit currentContext; a caller that ratifies MUST pass it. Inline WITH
// sha256Hex, canonicalJson.
export function verifySignature(signature, currentContext) {
  if (!signature || typeof signature !== 'object') return false
  const bound = {
    bundle_hash: signature.bundle_hash != null ? signature.bundle_hash : null,
    renderer_version: signature.renderer_version != null ? signature.renderer_version : null,
    plan_hash: signature.plan_hash != null ? signature.plan_hash : null,
    evidence_manifest_hash: signature.evidence_manifest_hash != null ? signature.evidence_manifest_hash : null,
    protocol_version: signature.protocol_version != null ? signature.protocol_version : null,
    seat_provenance: signature.seat_provenance != null ? signature.seat_provenance : null,
  }
  if (signature.signature_hash !== sha256Hex(canonicalJson(bound))) return false
  if (currentContext != null && typeof currentContext === 'object') {
    for (const k of ['bundle_hash', 'renderer_version', 'plan_hash', 'evidence_manifest_hash', 'protocol_version']) {
      if (Object.prototype.hasOwnProperty.call(currentContext, k) && bound[k] !== currentContext[k]) return false
    }
    if (Object.prototype.hasOwnProperty.call(currentContext, 'seat_provenance') && canonicalJson(bound.seat_provenance) !== canonicalJson(currentContext.seat_provenance)) return false
  }
  return true
}

// FRESH_CELLS — the 2x2 order-by-label counterbalanced cell table (sol-b34-design section 7). Each
// position appears twice first / twice second and twice as K / twice as M. presentation_order fixes
// which candidate is shown first; label_mapping fixes K/M to P0/P1 (canonical: K=P0, M=P1; swapped:
// K=P1, M=P0).
export const FRESH_CELLS = Object.freeze([
  Object.freeze({ cell: 'C00', presentation_order: 'K_then_M', label_mapping: 'canonical' }),
  Object.freeze({ cell: 'C01', presentation_order: 'K_then_M', label_mapping: 'swapped' }),
  Object.freeze({ cell: 'C10', presentation_order: 'M_then_K', label_mapping: 'canonical' }),
  Object.freeze({ cell: 'C11', presentation_order: 'M_then_K', label_mapping: 'swapped' }),
])

// COUNCIL_HEADS — the two co-equal heads. Fresh-round calls fan out across both.
export const COUNCIL_HEADS = Object.freeze(['fable', 'sol'])

// freshRoundSchedule({ seed, divergenceId, tier }) — sol-b34-design section 7 scheduling. Base tier:
// one T=0 sample per cell -> 8 calls per divergence across both heads. High tier: three samples per
// cell (two low-temperature probes + one moderate-temperature ambiguity probe) -> 24 calls. Per-cell
// card ids derive deterministically from the hidden seed. Inline WITH FRESH_CELLS, deriveId
// (+ sha256Hex, canonicalJson).
export function freshRoundSchedule(opts) {
  const o = opts || {}
  const high = o.tier === 'high'
  const samples = high ? 3 : 1
  const temps = high ? [0, 0, 0.7] : [0]
  const calls = []
  for (const head of ['fable', 'sol']) {
    for (const c of FRESH_CELLS) {
      for (let s = 0; s < samples; s++) {
        calls.push({
          head,
          cell: c.cell,
          presentation_order: c.presentation_order,
          label_mapping: c.label_mapping,
          sample: s,
          temperature: temps[s],
          card_id: `FC-${deriveId(o.seed, ['fresh', String(o.divergenceId), head, c.cell, s]).slice(0, 24)}`,
        })
      }
    }
  }
  return { tier: high ? 'high' : 'base', samples_per_cell: samples, call_count: calls.length, calls }
}

// normalizeCellVerdict(choice, labelMapping) — map a fresh instance's K/M choice back to canonical
// P0/P1 per the cell's label mapping BEFORE aggregation (sol-b34-design section 7). The constitution's
// verdict enum (twin-council.md:40) is position_1 | position_2 | no_decision | NEITHER, so `no_decision`
// is a DELIBERATE ABSTENTION — a legal verdict that maps to NO_DECISION. `INSUFFICIENT_EVIDENCE` is a
// FAILURE TO RULE (sol-deadlock-design:214) — never a verdict; it passes through so aggregateHead can
// route it to instability. Any unknown choice becomes INVALID (never a silent vote).
export function normalizeCellVerdict(choice, labelMapping) {
  const c = String(choice)
  if (c === 'K') return labelMapping === 'swapped' ? 'P1' : 'P0'
  if (c === 'M') return labelMapping === 'swapped' ? 'P0' : 'P1'
  if (c === 'NEITHER') return 'NEITHER'
  if (c === 'no_decision' || c === 'NO_DECISION') return 'NO_DECISION'
  if (c === 'INSUFFICIENT_EVIDENCE') return 'INSUFFICIENT_EVIDENCE'
  return 'INVALID'
}

// aggregateHead(instances, opts) — collapse one head's fresh cell instances into a single aggregate
// (sol-b34-design section 7 / sol-deadlock-design section 3). instances is [{ cell, outcome, defects? }]
// where outcome is ALREADY normalized (via normalizeCellVerdict) and defects (for a NEITHER) is
// { P0:[...], P1:[...] }. COMPLETENESS is proven against the schedule FIRST: base tier = 4 distinct
// cells x1 sample; high tier = 12 instances (4 cells x 3). A missing, duplicated, or unknown cell is
// instability, never a vote — a head cannot be decisive off an incomplete round. A NEITHER without a
// named blocking defect for EACH position is INVALID (sol-deadlock-design:212). A head is DECISIVE
// only if every valid instance selects the same P0/P1/NEITHER; a unanimous deliberate NO_DECISION is a
// stable abstention; ANY INSUFFICIENT_EVIDENCE (even unanimous), any INVALID, or any split is UNSTABLE.
export function aggregateHead(instances, opts) {
  const o = opts || {}
  const tier = o.tier === 'high' ? 'high' : 'base'
  const list = Array.isArray(instances) ? instances : []
  const CELLS = ['C00', 'C01', 'C10', 'C11']
  const perCell = tier === 'high' ? 3 : 1
  const byCell = new Map()
  for (const it of list) {
    const cell = it && it.cell
    if (!CELLS.includes(cell)) return { aggregate: 'UNSTABLE', reason: 'unknown_cell' }
    byCell.set(cell, (byCell.get(cell) || 0) + 1)
  }
  for (const cell of CELLS) if ((byCell.get(cell) || 0) !== perCell) return { aggregate: 'UNSTABLE', reason: 'incomplete_schedule' }
  if (list.length !== CELLS.length * perCell) return { aggregate: 'UNSTABLE', reason: 'incomplete_schedule' }
  // a valid NEITHER names a specific blocking defect for BOTH P0 AND P1 (the pinned keys — wrong keys
  // like { foo, bar } are not defects for the two positions). A "named defect" is a NON-BLANK STRING
  // after trim: a blank ('   '), null, or non-string entry does not count (an unnamed defect is no defect).
  const namedDefect = (arr) => Array.isArray(arr) && arr.some((x) => typeof x === 'string' && x.trim() !== '')
  const namedDefectsForBoth = (d) => d && typeof d === 'object' && !Array.isArray(d) && namedDefect(d.P0) && namedDefect(d.P1)
  const outcomes = list.map((it) => {
    const out = it && it.outcome
    if (out === 'NEITHER') return namedDefectsForBoth(it.defects) ? 'NEITHER' : 'INVALID'
    return out
  })
  const first = outcomes[0]
  if (!outcomes.every((x) => x === first)) return { aggregate: 'UNSTABLE', reason: 'split' }
  if (first === 'P0' || first === 'P1') return { aggregate: 'DECISIVE', outcome: first }
  if (first === 'NEITHER') {
    // a decisive NEITHER also requires the defect sets to be CONSISTENT across instances
    // (sol-deadlock-design:240 — inconsistent NEITHER defects are instability, not a shared verdict).
    const canon = canonicalJson(list[0].defects)
    if (!list.every((it) => canonicalJson(it.defects) === canon)) return { aggregate: 'UNSTABLE', reason: 'inconsistent_defects' }
    return { aggregate: 'DECISIVE', outcome: 'NEITHER' }
  }
  if (first === 'NO_DECISION') return { aggregate: 'NO_DECISION' }
  if (first === 'INSUFFICIENT_EVIDENCE') return { aggregate: 'UNSTABLE', reason: 'insufficient_evidence' }
  return { aggregate: 'UNSTABLE', reason: 'invalid' }
}

// aggregateCouncil(fableAgg, solAgg) — the joint classification (sol-b34-design section 7 /
// sol-deadlock-design section 3). Route: 'agreement' (both decisive on the same position), 'ambiguity'
// (any instability, decisive-vs-no_decision, or both-abstain — never a unilateral adoption),
// 'structural' (stable opposition, stable NEITHER on one side, or two NEITHERs), or 'degraded' (a
// missing/invalid head aggregate — required-mode failure, not deadlock). `class` carries the
// telemetry label.
export function aggregateCouncil(fableAgg, solAgg) {
  const F = fableAgg || {}, S = solAgg || {}
  const known = (a) => a && (a.aggregate === 'DECISIVE' || a.aggregate === 'NO_DECISION' || a.aggregate === 'UNSTABLE')
  if (!known(F) || !known(S)) return { route: 'degraded', class: 'degraded' }
  if (F.aggregate === 'UNSTABLE' || S.aggregate === 'UNSTABLE') return { route: 'ambiguity', class: 'sampling_or_framing_sensitive' }
  const dec = (a) => a.aggregate === 'DECISIVE'
  if (F.aggregate === 'NO_DECISION' || S.aggregate === 'NO_DECISION') return { route: 'ambiguity', class: 'sampling_or_framing_sensitive' }
  const fo = F.outcome, so = S.outcome
  if (fo === 'NEITHER' && so === 'NEITHER') return { route: 'structural', class: 'joint_structural_rejection' }
  if (fo === 'NEITHER' || so === 'NEITHER') return { route: 'structural', class: 'structural_adequacy_split' }
  if (dec(F) && dec(S) && fo === so) return { route: 'agreement', class: 'fresh_dual_agreement', position: fo }
  return { route: 'structural', class: 'structural_split' }
}

// sealReversibility(fableCard, solCard, seed) — deadlock ladder step 6. ONLY identical
// classifications from both heads' sealed cards count: an option is a two-way door iff BOTH heads
// classified it 'reversible' identically. Missing / 'costly' / 'irreversible' / differing = one-way.
// Exactly one two-way door -> provisional adoption of that option. Both two-way -> deterministic
// parity tie-break from the hidden seed. Both one-way (or any failed guard) -> gated (auto ->
// COUNCIL_DEADLOCK). Cards may carry either { P0: 'reversible', P1: 'costly' } or
// { P0: { class: 'reversible' }, ... }. Inline WITH parityTieBreak.
export function sealReversibility(fableCard, solCard, seed) {
  const cls = (card, opt) => {
    const v = card && card[opt]
    if (typeof v === 'string') return v
    if (v && typeof v === 'object' && typeof v.class === 'string') return v.class
    return null
  }
  const twoWay = (opt) => {
    const a = cls(fableCard, opt), b = cls(solCard, opt)
    return a != null && a === b && a === 'reversible'
  }
  const doors = ['P0', 'P1'].filter(twoWay)
  if (doors.length === 1) return { resolution: 'reversibility_rule', adopt: doors[0], door: 'single_two_way', mel_required: true }
  if (doors.length === 2) return { resolution: 'reversibility_rule', adopt: parityTieBreak(seed) === 0 ? 'P0' : 'P1', door: 'parity_tie_break', mel_required: true }
  return { resolution: 'gated', adopt: null, door: 'both_one_way', mel_required: false }
}

// buildMelRecord(parts) — the mandated exception ledger (fable-deadlock-design section 4.2, the
// MEL-adapted risk ledger): dissent VERBATIM, the operating limitation, a TIME-BOXED re-review trigger,
// and the open issues in the affected subsystem. openIssues are [{ subsystem, ... }]; the operator is
// auto-summoned ONLY when >=2 OPEN dissents touch the SAME subsystem (the compounding guard — two
// entries in different subsystems do NOT summon). The re-review trigger must be present and time-boxed
// (a next-milestone gate, named evidence, an expiry, or a bounded delay) to be valid; a null or
// open-ended trigger makes the record invalid (every deferral is time-boxed).
export function buildMelRecord(parts) {
  const p = parts || {}
  const issues = Array.isArray(p.openIssues) ? p.openIssues.slice() : []
  const bySubsystem = new Map()
  for (const it of issues) {
    const sub = it && typeof it === 'object' ? it.subsystem : undefined
    if (sub != null) bySubsystem.set(String(sub), (bySubsystem.get(String(sub)) || 0) + 1)
  }
  const autoSummon = [...bySubsystem.values()].some((n) => n >= 2)
  // a valid trigger is genuinely bounded: a numeric delay must be finite AND strictly positive
  // (after_days:-1 / 0 are not deferrals); a string trigger must be non-blank after trim (' ' is empty).
  const rt = p.reviewTrigger
  const posNum = (x) => Number.isFinite(x) && x > 0
  const nonBlank = (x) => typeof x === 'string' && x.trim() !== ''
  const timeBoxed = !!(rt && typeof rt === 'object' && !Array.isArray(rt) && (
    posNum(rt.after_days) || posNum(rt.after_hours) ||
    nonBlank(rt.deadline) || nonBlank(rt.at_milestone) || nonBlank(rt.on_evidence)
  ))
  return {
    kind: 'council_mel',
    dissent_verbatim: p.dissent == null ? null : String(p.dissent),
    operating_limitation: p.limitation == null ? null : String(p.limitation),
    review_trigger: timeBoxed ? rt : null,
    open_issues: issues,
    auto_summon_operator: autoSummon,
    valid: timeBoxed,
  }
}

// buildCheckpoint(fields) — the exact checkpoint field list shaped as a note{kind:'council_state'}
// data payload (sol-b34-design "State and checkpoint model"). The event enum is untouched — this is
// the DATA of an existing `note` event. Large packets stay immutable artifacts; the checkpoint holds
// paths and hashes. status marks whether the paired barrier is 'sealed'.
export function buildCheckpoint(fields) {
  const x = fields || {}
  return {
    kind: 'council_state',
    protocol_version: x.protocol_version != null ? x.protocol_version : null,
    template_hash: x.template_hash != null ? x.template_hash : null,
    run_token_hash: x.run_token_hash != null ? x.run_token_hash : null,
    initial_ledger_seq: x.initial_ledger_seq != null ? x.initial_ledger_seq : null,
    keystone_id: x.keystone_id != null ? x.keystone_id : null,
    phase: x.phase != null ? x.phase : null,
    decision_bundle_hash: x.decision_bundle_hash != null ? x.decision_bundle_hash : null,
    input_artifact_hashes: Array.isArray(x.input_artifact_hashes) ? x.input_artifact_hashes.slice() : [],
    evidence_manifest_hash: x.evidence_manifest_hash != null ? x.evidence_manifest_hash : null,
    anonymous_seat_artifact_hashes: x.anonymous_seat_artifact_hashes && typeof x.anonymous_seat_artifact_hashes === 'object' ? { ...x.anonymous_seat_artifact_hashes } : {},
    seat_provenance: x.seat_provenance && typeof x.seat_provenance === 'object' ? { ...x.seat_provenance } : {},
    codex_receipt_hash: x.codex_receipt_hash != null ? x.codex_receipt_hash : null,
    status: x.status != null ? x.status : null,
  }
}

// matchCheckpoint(prev, cur) — sol-b34-design "State and checkpoint model": on restart, reuse a
// phase ONLY when protocol, template (which binds the response schema), input, evidence, artifact,
// provenance, and receipt hashes ALL match — otherwise the whole paired phase reruns. Seat expectations
// are PHASE-AWARE: a PAIRED barrier (both heads seal an anonymous artifact) requires EXACTLY two seat
// hashes, so a lone half-pair AND a zero-seat "sealed" paired checkpoint are both non-reusable; a
// script-only phase (e.g. DIVERGENCES_BUILT) legitimately carries zero seat hashes. Only a 'sealed'
// prior checkpoint is reusable at all. Inline WITH canonicalJson.
export function matchCheckpoint(prev, cur) {
  if (!prev || !cur) return false
  // Seat classification of every barrier phase (2 = both heads seal an anonymous artifact; 0 = the
  // script alone produces the phase artifact):
  //   DRAFTS_SEALED 2 · CRITIQUES_SEALED 2 · REVISIONS_SEALED 2 · DIVERGENCES_BUILT 0 (script builds it)
  //   NEGOTIATION_SEALED 2 · NEGOTIATION_SKIPPED 0 (empty divergence set) · RATIFY_1_SEALED 2
  //   ANSWER_EXCHANGE_SEALED 2 · RATIFY_2_SEALED 2 · FRESH_CARDS_SEALED 2 (both heads' frozen position
  //   cards are a paired barrier) · FRESH_CELLS_SETTLED 0 (script aggregates the fresh verdicts)
  //   REFERENCE_REDUCTION 0 (a deterministic discriminating check) · RUBRIC_CHECK 0 (the script cascade
  //   — reversibility sealing + tie-break; an optional rubric amendment is signed separately, not a
  //   paired draft in this checkpoint).
  const PAIRED_PHASES = new Set(['DRAFTS_SEALED', 'CRITIQUES_SEALED', 'REVISIONS_SEALED', 'NEGOTIATION_SEALED', 'RATIFY_1_SEALED', 'ANSWER_EXCHANGE_SEALED', 'RATIFY_2_SEALED', 'FRESH_CARDS_SEALED'])
  const seatCount = (cp) => (cp.anonymous_seat_artifact_hashes && typeof cp.anonymous_seat_artifact_hashes === 'object') ? Object.keys(cp.anonymous_seat_artifact_hashes).length : 0
  const expectedSeats = PAIRED_PHASES.has(prev.phase) ? 2 : 0
  if (seatCount(prev) !== expectedSeats) return false // wrong seat count for the phase class — never reusable
  if (prev.status !== 'sealed') return false
  const eq = (a, b) => canonicalJson(a) === canonicalJson(b)
  return (
    prev.protocol_version === cur.protocol_version &&
    prev.template_hash === cur.template_hash &&
    prev.run_token_hash === cur.run_token_hash &&
    prev.initial_ledger_seq === cur.initial_ledger_seq &&
    prev.keystone_id === cur.keystone_id &&
    prev.phase === cur.phase &&
    prev.decision_bundle_hash === cur.decision_bundle_hash &&
    eq(prev.input_artifact_hashes, cur.input_artifact_hashes) &&
    prev.evidence_manifest_hash === cur.evidence_manifest_hash &&
    eq(prev.anonymous_seat_artifact_hashes, cur.anonymous_seat_artifact_hashes) &&
    eq(prev.seat_provenance, cur.seat_provenance) &&
    (prev.codex_receipt_hash != null ? prev.codex_receipt_hash : null) === (cur.codex_receipt_hash != null ? cur.codex_receipt_hash : null)
  )
}

// twinRatified({ signatures, context, ratifications, open_divergence_ids }) — the ONLY jointly-ratified
// terminal (constitution section 8). It throws (a blocked ratification, never a ratified one) unless ALL:
//   · exactly TWO head signatures, each verifying against the current context;
//   · the context is COMPLETE — all six bound keys present AND its binding hashes (bundle_hash,
//     protocol_version, evidence_manifest_hash) are NON-NULL (a certificate bound to nulls is no
//     binding at all; a null-bound signature therefore also fails verification against a real context);
//   · the two signatures come from DISTINCT heads (distinct, non-null seat_provenance — the same
//     signature twice can never supply the second signature);
//   · exactly TWO ratifications, both verdict APPROVE, that COVER every open divergence id with a LEGAL
//     selection (P0|P1|MERGED|NEITHER) and AGREE on every one (sol-b34-design:240 — "matching selections
//     plus dual APPROVE settle the bundle"; an uncovered, illegally-selected, OR mismatched divergence is
//     a blocked ratification — a mapped-but-illegal selection is NOT coverage);
//   · open_divergence_ids is MANDATORY (pass [] for a bundle with no open divergences) — an absent set is
//     indistinguishable from an empty one and would silently lose coverage enforcement.
// Each signature verifies against the shared context with ITS OWN seat_provenance (seat is per-head).
// Inline WITH verifySignature, sha256Hex, canonicalJson.
export function twinRatified(parts) {
  const p = parts || {}
  const sigs = Array.isArray(p.signatures) ? p.signatures : null
  if (!sigs || sigs.length !== 2) throw new Error('twinRatified: exactly two head signatures are required (constitution §8)')
  const ctx = p.context != null ? p.context : (p.current_context != null ? p.current_context : null)
  if (ctx == null || typeof ctx !== 'object') throw new Error('twinRatified: a current context is required to bind both signatures')
  for (const k of ['bundle_hash', 'renderer_version', 'plan_hash', 'evidence_manifest_hash', 'protocol_version', 'seat_provenance']) {
    if (!Object.prototype.hasOwnProperty.call(ctx, k)) throw new Error(`twinRatified: the current context is incomplete (missing '${k}') — a partial context cannot bind a ratification`)
  }
  for (const k of ['bundle_hash', 'protocol_version', 'evidence_manifest_hash']) {
    if (ctx[k] == null) throw new Error(`twinRatified: the current context binds '${k}' to null — a certificate bound to nulls is no binding at all`)
  }
  for (const s of sigs) if (!verifySignature(s, { ...ctx, seat_provenance: s && s.seat_provenance })) throw new Error('twinRatified: a signature does not verify against the current context — cannot ratify')
  const seatKey = (s) => canonicalJson(s && s.seat_provenance != null ? s.seat_provenance : null)
  if (sigs[0].seat_provenance == null || sigs[1].seat_provenance == null || seatKey(sigs[0]) === seatKey(sigs[1])) {
    throw new Error('twinRatified: the two signatures must come from DISTINCT heads (distinct, non-null seat_provenance)')
  }
  const rats = Array.isArray(p.ratifications) ? p.ratifications : null
  if (!rats || rats.length !== 2) throw new Error('twinRatified: exactly two ratifications are required to confirm matching selections and verdicts')
  const isApprove = (v) => (typeof v === 'string' ? v : (v && v.verdict)) === 'APPROVE'
  if (!isApprove(rats[0].verdict) || !isApprove(rats[1].verdict)) throw new Error('twinRatified: both head verdicts must be APPROVE')
  if (!Array.isArray(p.open_divergence_ids)) throw new Error('twinRatified: open_divergence_ids is required — pass [] for a bundle with no open divergences')
  const openIds = p.open_divergence_ids.map(String)
  // ONLY a legal selection counts as coverage — an entry with an illegal or absent selection is a bad
  // selection (a blocked ratification), never silent coverage of the divergence it names.
  const SELECTIONS = ['P0', 'P1', 'MERGED', 'NEITHER']
  const selMap = (rat) => {
    const m = new Map()
    for (const s of (Array.isArray(rat.divergence_selections) ? rat.divergence_selections : [])) {
      if (!s || s.divergence_id == null) continue
      if (!SELECTIONS.includes(s.selection)) throw new Error(`twinRatified: a ratification selects divergence '${s.divergence_id}' with an illegal or absent selection — a bad selection is a blocked ratification`)
      m.set(String(s.divergence_id), s.selection)
    }
    return m
  }
  const m0 = selMap(rats[0]), m1 = selMap(rats[1])
  for (const id of openIds) {
    if (!m0.has(id) || !m1.has(id)) throw new Error(`twinRatified: open divergence '${id}' is not covered by both ratifications — an uncovered divergence is a blocked ratification`)
  }
  for (const id of new Set([...openIds, ...m0.keys(), ...m1.keys()])) {
    if (m0.get(id) !== m1.get(id)) throw new Error(`twinRatified: the two ratifications disagree on divergence '${id}' — matching selections are required to settle the bundle`)
  }
  return {
    terminal: 'RATIFIED',
    label: 'twin_ratified',
    signatures: sigs,
    verdicts: [rats[0].verdict, rats[1].verdict],
    ratifications: rats,
    artifact_hash: p.artifact_hash != null ? p.artifact_hash : (ctx.bundle_hash != null ? ctx.bundle_hash : null),
    decision_bundle_hash: p.decision_bundle_hash != null ? p.decision_bundle_hash : (ctx.bundle_hash != null ? ctx.bundle_hash : null),
    plan_hash: p.plan_hash != null ? p.plan_hash : (ctx.plan_hash != null ? ctx.plan_hash : null),
  }
}

// twinDeadlockResolved({ resolution, certificate, artifact_hash }) — the EXCEPTIONAL authority
// terminal (constitution section 8), NEVER relabeled as joint ratification. resolution must be
// 'operator' or 'reversibility_rule'; a certificate is mandatory.
export function twinDeadlockResolved(parts) {
  const p = parts || {}
  if (p.resolution !== 'operator' && p.resolution !== 'reversibility_rule') throw new Error(`twinDeadlockResolved: resolution must be 'operator' or 'reversibility_rule', got '${p.resolution}'`)
  if (p.certificate == null) throw new Error('twinDeadlockResolved: a certificate is mandatory')
  return { terminal: 'DEADLOCK_RESOLVED', label: 'twin_deadlock_resolved', resolution: p.resolution, certificate: p.certificate, artifact_hash: p.artifact_hash != null ? p.artifact_hash : null }
}

// councilDeadlock(parts) — the honest auto-mode fail (constitution section 8 / sol-deadlock-design
// section 4): fail the keystone, preserve the last ratified state, emit NO stage_completed, adopt
// neither position.
export function councilDeadlock(parts) {
  const p = parts || {}
  return {
    terminal: 'COUNCIL_DEADLOCK',
    label: 'council_deadlock',
    divergences: Array.isArray(p.divergences) ? p.divergences.slice() : [],
    last_ratified_hash: p.last_ratified_hash != null ? p.last_ratified_hash : null,
    stage_completed: false,
  }
}

// degraded(parts) — a missing/dead required head (constitution Degradation): NOT a deadlock. Blocks
// the keystone -> gated operator checkpoint; never a single-head ruling.
export function degraded(parts) {
  const p = parts || {}
  return { terminal: 'DEGRADED', label: 'twin_degraded', missing: p.missing != null ? p.missing : null, reason: p.reason != null ? p.reason : null }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── B4-1b-ii CALL-SITE CORE, lifted to pure exports (B4-2 D1). The sealed 1b-ii ratification
//    machinery had a call-site-AGNOSTIC core living inside architecture.js; B4-2 lifts it here as
//    dependency-closed pure exports so build.js reuses it through the SAME `@inline:council` bundler
//    contract — helpers, never copy-paste (the T4-lite carry-forward). Semantics are VERBATIM the
//    architecture.js originals (design note §D1 receipts); the only change is parameterization over
//    the per-keystone binding (councilDir/keystone/phaseTag/seat/attempt/runToken) the caller supplies.
//    The raw runToken appears ONLY in the rendered argv (architecture.js:344-346 trusted-boundary
//    doctrine); no head-visible string here carries it. ──
// ════════════════════════════════════════════════════════════════════════════════════════════════

// SHA64_RE — the lowercase-hex-64 shape gate every ledger-promoted receipt/invocation hash passes.
export const SHA64_RE = /^[0-9a-f]{64}$/

// RATIFY_SCHEMA (§6 verbatim): evidence fields BEFORE the verdict field (B6 ordering — Claude legs keep
// PAYLOAD_FIRST, codex legs follow the reasoning-first guide). executable_check present, null allowed.
export const RATIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400, description: 'optional, ≤50 words' },
    artifact_hash: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          finding_id: { type: 'string' }, claim: { type: 'string' }, required_change: { type: 'string' },
          evidence_refs: { type: 'array', items: { type: 'string' } },
          evidence_class: { type: 'string', enum: ['executed_check', 'proposed_check', 'repo_state', 'test_output', 'primary_source', 'scenario'], description: 'the HONEST class of this finding\'s evidence — the claim-scoped partial order rules reversals by it' },
          executable_check: { type: ['string', 'null'], description: 'a bounded shell command (EXIT 0 iff the defect is present) or null' },
        },
        required: ['finding_id', 'claim', 'required_change', 'evidence_refs', 'evidence_class', 'executable_check'],
      },
    },
    changed_evidence: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { class: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } }, required: ['class'] } },
    divergence_selections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { divergence_id: { type: 'string' }, selection: { type: 'string', enum: ['P0', 'P1', 'MERGED', 'NEITHER'] }, evidence_refs: { type: 'array', items: { type: 'string' } } }, required: ['divergence_id', 'selection'] } },
    verdict: { type: 'string', enum: ['APPROVE', 'BLOCK', 'NEITHER'] },
  },
  required: ['artifact_hash', 'verdict', 'divergence_selections', 'findings', 'changed_evidence'],
}

// ANSWER_SCHEMA — the §3 answer-exchange payload (one ACCEPT/REFUTE per finding).
export const ANSWER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    answers: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { finding_id: { type: 'string' }, answer: { type: 'string', enum: ['ACCEPT', 'REFUTE'] }, evidence_refs: { type: 'array', items: { type: 'string' } }, evidence_class: { type: 'string' } }, required: ['finding_id', 'answer', 'evidence_refs'] } },
  },
  required: ['answers'],
}

// envelopeSchema(payload) — permissive on the receipt BY DESIGN: gateAgent's validateCodexReceipt is
// the single structural authority; a strict agent-schema copy of the receipt would be a second
// validator that can drift. So codex_receipt is a bare object here.
export const envelopeSchema = (payload) => ({
  type: 'object',
  properties: { payload, codex_receipt: { type: 'object' }, raw_artifact_refs: { type: 'object' } },
  required: ['payload', 'codex_receipt'],
  additionalProperties: true,
})

// CROSS_CHECK_SCHEMA — the receipt-ledger CROSS-CHECK transcription (thoth:receipt-check). INVOCATION-
// EXACT (Sol F1): the extract selects the LAST verified row matching THIS leg's output hash + session
// id, then that row's 'started' RESERVATION by invocation_id — the SCRIPT (crossCheckOk) then binds
// reservation ↔ verified ↔ sink ↔ payload, so a run-global stale/replayed row can never be blessed.
export const CROSS_CHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    output_sha256_disk: { type: 'string' },
    output_canonical_sha256: { type: 'string' },
    ledger: {
      type: 'object', additionalProperties: false,
      properties: {
        verified: {
          type: ['object', 'null'], additionalProperties: false,
          properties: {
            status: { type: ['string', 'null'] }, invocation_id: { type: ['string', 'null'] }, receipt_sha256: { type: ['string', 'null'] },
            output_sha256: { type: ['string', 'null'] }, session_id: { type: ['string', 'null'] }, reported_model: { type: ['string', 'null'] },
            tokens_used: { type: ['number', 'null'] }, exit_code: { type: ['number', 'null'] }, receipt_verified: { type: ['boolean', 'null'] },
          },
          required: ['status', 'invocation_id', 'receipt_sha256', 'output_sha256', 'session_id', 'reported_model', 'tokens_used', 'exit_code', 'receipt_verified'],
        },
        reservation: {
          type: ['object', 'null'], additionalProperties: false,
          properties: {
            invocation_id: { type: ['string', 'null'] }, keystone: { type: ['string', 'null'] }, phase: { type: ['string', 'null'] },
            seat: { type: ['string', 'null'] }, attempt: { type: ['number', 'null'] }, run_token: { type: ['string', 'null'] },
            prompt_sha256: { type: ['string', 'null'] }, packet_sha256: { type: ['string', 'null'] },
          },
          required: ['invocation_id', 'keystone', 'phase', 'seat', 'attempt', 'run_token', 'prompt_sha256', 'packet_sha256'],
        },
      },
      required: ['verified', 'reservation'],
    },
  },
  required: ['output_sha256_disk', 'output_canonical_sha256', 'ledger'],
}

// LEDGER_APPEND_SCHEMA — the council-ledger append confirmation (Sol F10): the checkpoint counter
// increments ONLY on a confirmed append — a mute/failed scribe is logged, never counted.
export const LEDGER_APPEND_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, appended: { type: 'boolean', description: 'true iff the append command exited 0' } },
  required: ['appended'],
}

// The pinned cross-check one-liners (written ONCE as consts). CANON reproduces canonicalJson EXACTLY —
// recursive key-sort + JSON.stringify semantics over UTF-8 bytes — so its digest equals
// sha256Hex(canonicalJson(payload)). LEDGER is INVOCATION-EXACT (Sol F1): argv carries the leg's output
// sha + session id; it selects the LAST verified row matching BOTH, then that row's 'started'
// RESERVATION by invocation_id, and prints { verified, reservation } (nulls unmatched) — the SCRIPT
// (crossCheckOk) does every comparison. Neither one-liner contains a single quote, so each rides safely
// inside `node -e '...'`.
export const CANON_HASH_ONELINER = `const fs=require("fs"),crypto=require("crypto");const c=v=>v===null||typeof v!=="object"?JSON.stringify(v===undefined?null:v):Array.isArray(v)?"["+v.map(c).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+c(v[k])).join(",")+"}";const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(crypto.createHash("sha256").update(Buffer.from(c(p),"utf8")).digest("hex"))`
export const LEDGER_EXTRACT_ONELINER = `const fs=require("fs");let L=[];try{L=fs.readFileSync(process.argv[1],"utf8").split("\\n").filter(Boolean).map(s=>JSON.parse(s))}catch(e){}const O=process.argv[2],S=process.argv[3];const pick=(o,ks)=>{const x={};for(const k of ks)x[k]=(o&&o[k]!==undefined)?o[k]:null;return x};const vs=L.filter(e=>e&&e.status==="verified"&&e.output_sha256===O&&e.session_id===S);const v=vs.length?vs[vs.length-1]:null;const rs=v?L.filter(e=>e&&e.status==="started"&&e.invocation_id===v.invocation_id):[];const r=rs.length?rs[rs.length-1]:null;process.stdout.write(JSON.stringify({verified:v?pick(v,["status","invocation_id","receipt_sha256","output_sha256","session_id","reported_model","tokens_used","exit_code","receipt_verified"]):null,reservation:r?pick(r,["invocation_id","keystone","phase","seat","attempt","run_token","prompt_sha256","packet_sha256"]):null}))`

// councilTemplateHash(parts) — pins the recipe sha256Hex(canonicalJson(parts)) (architecture.js:385) so
// a keystone's template hash cannot drift in construction. Inline WITH sha256Hex, canonicalJson.
export function councilTemplateHash(parts) {
  return sha256Hex(canonicalJson(parts))
}

// seatProv(sink, head) — a per-head provenance snapshot for signatures + checkpoints. The `head` field
// makes the two signatures' seat_provenance DISTINCT (twinRatified requires distinct, non-null seats).
export const seatProv = (sink, head) => ({
  head,
  requested_model: sink && sink.requested_model != null ? sink.requested_model : null,
  actual_model: sink && sink.actual_model != null ? sink.actual_model : null,
  receipt_verified: !!(sink && sink.receipt_verified),
  actual_transport_model: sink && sink.actual_transport_model != null ? sink.actual_transport_model : null,
  session_id: sink && sink.session_id != null ? sink.session_id : null,
})

// solWrapperPlan(cfg) — the pure planning core of the SONNET wrapper for a Sol codex leg (mechanics
// only, no opinions, no content authorship). Renders the codex prompt/packet/schema file paths, the
// receipt-bearing transport argv, and the wrapper prompt. Head-visible content (the codex prompt +
// packet) carries NO run token, NO seed, NO peer identity; the RAW run token lives ONLY in the argv
// (a trusted process boundary — the caller runs it, never a head). cfg:
//   { councilDir, pluginRoot, receiptsLedger, runToken, keystone, transportModel,
//     phaseTag, attempt, effort ('high'|'xhigh'), payloadSchema, taskText, briefBody, packetObj, extractTo }
// → { files, argv, prompt }. Pure: no I/O, no ambient globals (workflow-determinism).
export function solWrapperPlan(cfg) {
  const c = cfg || {}
  const attempt = c.attempt || 1
  const base = `${c.councilDir}/${c.phaseTag}-sol-a${attempt}`
  const files = { prompt: `${base}.prompt`, packet: `${base}.packet`, schema: `${base}.schema`, out: `${base}.out`, stderr: `${base}.stderr` }
  const argv = `node ${c.pluginRoot}/scripts/kiln-codex-receipt.mjs ${files.prompt} ${c.transportModel} ${c.effort} ${files.packet} ${files.schema} ${files.out} ${files.stderr} ${c.receiptsLedger} ${c.runToken} ${c.keystone} ${c.phaseTag} sol ${attempt}`
  const label = c.extractLabel || 'plan'
  const field = c.extractField || 'plan_markdown'
  const extractStep = c.extractTo
    ? `3. Extract the ${label} MECHANICALLY from the ATTESTED output — run this EXACT command, verbatim (never retype ${label} content; the path arguments stay quoted):\n   node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],p.${field})' "${files.out}" "${c.extractTo}"\n`
    : `3. (No extraction — the attested payload IS the deliverable.)\n`
  const prompt =
    `You are the Sol transport wrapper — MECHANICS ONLY. You never author plan content or a verdict; you TRANSLATE a fixed brief into a codex prompt (per the codex-guide 4-part shape), run the receipt-bearing transport, and relay the attested result. You do not know the peer seat's identity.\n\n` +
    `<task>\n` +
    `1. Bash 'mkdir -p ${c.councilDir}'. Then WRITE three files (file tools):\n` +
    `   - ${files.prompt} — the codex prompt: TRANSLATE the fixed brief below into Goal / Context / Constraints / Done-when, instruction-first, plain markdown, no persona padding, reasoning-first per the schema. Demand the final message be ONE JSON object matching the schema. Include NONE of: a run token, a seed, a session id, the peer seat's identity — codex sees ONLY this prompt + packet.\n` +
    `   - ${files.packet} — this JSON, verbatim: ${JSON.stringify(c.packetObj)}\n` +
    `   - ${files.schema} — this payload schema, verbatim: ${JSON.stringify(c.payloadSchema)}\n` +
    `2. Run EXACTLY (Bash, foreground, generous timeout) — the raw run token belongs ONLY in this argv (a trusted process boundary), NEVER in a prompt or packet:\n   ${argv}\n   Exit 0 ⇒ its stdout IS the verified receipt JSON.\n` +
    extractStep +
    `4. Emit the envelope (StructuredOutput): payload = the ${files.out} JSON verbatim, codex_receipt = the transport's stdout receipt verbatim, raw_artifact_refs = { "stderr": "${files.stderr}", "output": "${files.out}" }. On ANY failure (nonzero exit, missing files), report the failure honestly with NO codex_receipt key — a dead Sol seat is never faked.\n` +
    `</task>\n\n` +
    `<fixed-brief>\n${c.taskText}\n\n${c.briefBody || ''}\n</fixed-brief>`
  return { files, argv, prompt }
}

// crossCheckOk(cc, binding) — the pure verification predicate inside runSolCrossCheck: gate.mjs
// validated the receipt STRUCTURE via the provenance sink; this binds the whole INVOCATION-EXACT chain
// (Sol F1): reservation ↔ verified (same invocation_id), reservation ↔ THIS seat (keystone/phase/seat/
// attempt/run_token/prompt hash), verified ↔ sink (output/session/model/tokens/exit), payload ↔
// canonical hash. Any miss is a DEAD Sol seat — a stale or replayed row of the right shape can never be
// blessed. Every LEDGER-PROMOTED field is SHAPE-VALIDATED before promotion (the receipt hash rides
// forward into checkpoints and the return). binding: { relayedOutputHash, canonicalHash, sink, keystone,
// phaseTag, seat, attempt, runToken } → { ok, codex_receipt_hash, invocation_id, reason }. Inline WITH SHA64_RE.
export function crossCheckOk(cc, binding) {
  const b = binding || {}
  const relayed = b.relayedOutputHash
  const canon = b.canonicalHash
  const sink = b.sink || {}
  const V = cc && cc.ledger ? cc.ledger.verified : null
  const R = cc && cc.ledger ? cc.ledger.reservation : null
  const ok =
    cc && cc.output_sha256_disk === relayed &&
    cc.output_canonical_sha256 === canon &&
    V && R &&
    V.status === 'verified' && V.receipt_verified === true &&
    V.output_sha256 === relayed &&
    V.session_id === (sink && sink.session_id) &&
    V.reported_model === (sink && sink.actual_transport_model) &&
    V.tokens_used === (sink && sink.tokens_used) &&
    V.exit_code === 0 &&
    typeof V.invocation_id === 'string' && SHA64_RE.test(V.invocation_id) &&
    typeof V.receipt_sha256 === 'string' && SHA64_RE.test(V.receipt_sha256) &&
    V.invocation_id === R.invocation_id &&
    R.keystone === b.keystone &&
    R.phase === b.phaseTag &&
    R.seat === b.seat &&
    R.attempt === b.attempt &&
    R.run_token === b.runToken &&
    R.prompt_sha256 === (sink && sink.prompt_hash)
  return ok
    ? { ok: true, codex_receipt_hash: V.receipt_sha256, invocation_id: V.invocation_id }
    : { ok: false, invocation_id: V && typeof V.invocation_id === 'string' && SHA64_RE.test(V.invocation_id) ? V.invocation_id : null, reason: 'invocation-exact cross-check mismatch — the ledger reservation/verified chain disagrees with this seat, the relayed receipt, or the payload' }
}

// assembleRatifyCertificate({ rF, rS, provF, provS, context }) — the pure part of sealRatified: build
// the two head signatures via councilSignature, EACH carrying its own head's seat_provenance (provF /
// provS), then twinRatified over the SHARED context whose seat_provenance is null (the sealed idiom,
// architecture.js:726; twinRatified verifies each signature against { ...ctx, seat_provenance:
// s.seat_provenance }). context carries the five bound fields (bundle_hash, renderer_version, plan_hash,
// evidence_manifest_hash, protocol_version); the six-keys-present / three-non-null contract is
// twinRatified's (council.mjs:935-940). Returns { ok:true, certificate } | { ok:false, reason } — a
// binding defect DEGRADES, never crashes. Inline WITH councilSignature, twinRatified (+ verifySignature,
// sha256Hex, canonicalJson).
export function assembleRatifyCertificate(parts) {
  const p = parts || {}
  const ctx = p.context || {}
  const bound = {
    bundle_hash: ctx.bundle_hash != null ? ctx.bundle_hash : null,
    renderer_version: ctx.renderer_version != null ? ctx.renderer_version : null,
    plan_hash: ctx.plan_hash != null ? ctx.plan_hash : null,
    evidence_manifest_hash: ctx.evidence_manifest_hash != null ? ctx.evidence_manifest_hash : null,
    protocol_version: ctx.protocol_version != null ? ctx.protocol_version : null,
  }
  const sigF = councilSignature({ ...bound, seat_provenance: p.provF })
  const sigS = councilSignature({ ...bound, seat_provenance: p.provS })
  try {
    const certificate = twinRatified({ signatures: [sigF, sigS], context: { ...bound, seat_provenance: null }, ratifications: [p.rF, p.rS], open_divergence_ids: [] })
    return { ok: true, certificate }
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : String(e) }
  }
}
