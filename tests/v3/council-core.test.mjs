// council-core.test.mjs — unit floor for src/council.mjs (Twin Council pure core; sol-b34-design
// section "B3 — Debate state machine"). These are the deterministic blocks architecture.js (batch
// 1b-ii) inlines: the pure-JS SHA-256 + canonical hashing, the seed/ID derivation, script-assigned
// finding canonicalization, disposition + reversal + evidence rules, the mechanical divergence set
// with its every-ID-accounted proof, decision bundles + blind-ratification + binding signatures, the
// 2x2 fresh-round machinery, reversibility sealing, the MEL record, checkpoint match/resume, and the
// four terminal-outcome constructors. Every hash is proven byte-stable and every ID/schedule/tie-break
// is proven clock-free (the module source carries no Date/Math.random primitive).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

import {
  COUNCIL_PROTOCOL_VERSION, COUNCIL_PHASES, COUNCIL_TERMINALS, COUNCIL_PHASE_TRANSITIONS, COUNCIL_HEADS,
  canTransition, sha256Hex, canonicalJson, councilSeed, deriveId, parityTieBreak,
  canonicalizeFindings, validateDispositions, claimTypeForClass, compareEvidence, validateReversal,
  buildDivergenceSet, buildDecisionBundle, bundleHash, validateRatification, councilSignature, verifySignature,
  FRESH_CELLS, freshRoundSchedule, normalizeCellVerdict, aggregateHead, aggregateCouncil,
  sealReversibility, buildMelRecord, buildCheckpoint, matchCheckpoint,
  twinRatified, twinDeadlockResolved, councilDeadlock, degraded,
} from '../../plugins/kiln/src/council.mjs'

const COUNCIL_SRC = readFileSync(new URL('../../plugins/kiln/src/council.mjs', import.meta.url), 'utf8')
const ncrypto = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex')

// buildDivergenceSet requires a run seed (the bound-ID rule is constitutional). `bds` injects a
// default seed for the tests that exercise the trigger/accounting logic; the seed-specific tests pass
// their own seed and the missing-seed test calls buildDivergenceSet directly.
const RUN_SEED = councilSeed({ runToken: 'rt', keystoneId: 'k', templateHash: 'th' })
const bds = (input) => buildDivergenceSet({ seed: RUN_SEED, ...input })

// ── sha256Hex — the pure-JS FIPS 180-4 core against published vectors AND node:crypto ───────────────
test('sha256Hex: the published empty-string and "abc" vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('sha256Hex: block-boundary and multibyte inputs cross-check node:crypto exactly', () => {
  // 55/56 straddle the single-block length field; 63/64/65 straddle the block size; 119/120 the next.
  for (const v of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(119), 'a'.repeat(120), 'a'.repeat(200), 'héllo wörld 你好 😀 multibyte']) {
    assert.equal(sha256Hex(v), ncrypto(v), `mismatch for length ${v.length}`)
  }
})

test('sha256Hex: malformed surrogates match WHATWG/TextEncoder (lone surrogate -> U+FFFD), like node:crypto', () => {
  // a high surrogate with no trailing low, a bare low surrogate, and a high-high pair are all lone
  // surrogates that must each encode as U+FFFD (0xEF 0xBF 0xBD) — the exact divergence Sol flagged.
  for (const v of ['\uD800', '\uDC00', '\uD800A', 'A\uDC00B', '\uD800\uD800', '\uDFFF', '\uD83D', '😀']) {
    assert.equal(sha256Hex(v), ncrypto(v), `malformed-surrogate mismatch for ${JSON.stringify(v)}`)
  }
})

test('sha256Hex: a byte array and a Uint8Array hash identically to the same bytes as a string', () => {
  assert.equal(sha256Hex([0x61, 0x62, 0x63]), sha256Hex('abc'))
  assert.equal(sha256Hex(new Uint8Array([0x61, 0x62, 0x63])), sha256Hex('abc'))
  assert.throws(() => sha256Hex(42), /must be a string or byte array/)
})

// ── canonicalJson — key-order-insensitive serialization ────────────────────────────────────────────
test('canonicalJson: object key order does not change the serialization', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }))
  assert.equal(canonicalJson({ a: 2, b: 1 }), '{"a":2,"b":1}')
  assert.equal(canonicalJson([3, { y: 1, x: 2 }]), '[3,{"x":2,"y":1}]')
})

// ── councilSeed / deriveId / parityTieBreak — deterministic, never clock/random ─────────────────────
test('councilSeed: identical bindings yield the identical hidden seed; a changed field changes it', () => {
  const base = { protocolVersion: COUNCIL_PROTOCOL_VERSION, runToken: 'rt', initialSeq: 7, keystoneId: 'master', decisionId: 'd1', divergenceId: 'DV-001', templateHash: 'th' }
  assert.equal(councilSeed(base), councilSeed({ ...base }))
  assert.notEqual(councilSeed(base), councilSeed({ ...base, runToken: 'other' }))
  assert.match(councilSeed(base), /^[0-9a-f]{64}$/)
})

test('deriveId + parityTieBreak: derivations are stable and parity is a deterministic 0/1', () => {
  const seed = councilSeed({ runToken: 'rt', keystoneId: 'k' })
  assert.equal(deriveId(seed, ['a', 1]), deriveId(seed, ['a', 1]))
  assert.notEqual(deriveId(seed, ['a', 1]), deriveId(seed, ['a', 2]))
  const p = parityTieBreak(seed)
  assert.ok(p === 0 || p === 1)
  assert.equal(parityTieBreak(seed), p)
})

// ── phase transitions / barriers ────────────────────────────────────────────────────────────────────
test('canTransition: the barrier graph — legal successors pass, illegal jumps fail, terminals are sinks', () => {
  assert.ok(canTransition('DRAFTS_SEALED', 'CRITIQUES_SEALED'))
  assert.ok(canTransition('RATIFY_1_SEALED', 'RATIFIED'))
  assert.ok(canTransition('RATIFY_1_SEALED', 'ANSWER_EXCHANGE_SEALED'))
  assert.ok(canTransition('RATIFY_2_SEALED', 'FRESH_CARDS_SEALED'))
  assert.ok(canTransition('DIVERGENCES_BUILT', 'NEGOTIATION_SKIPPED'))
  assert.equal(canTransition('DRAFTS_SEALED', 'RATIFIED'), false, 'no skipping the whole protocol')
  assert.equal(canTransition('RATIFIED', 'CRITIQUES_SEALED'), false, 'a terminal has no successors')
  assert.equal(canTransition('NOT_A_PHASE', 'CRITIQUES_SEALED'), false, 'unknown phase fails closed')
  for (const from of Object.keys(COUNCIL_PHASE_TRANSITIONS)) assert.ok(canTransition(from, 'DEGRADED'), `${from} can always DEGRADE`)
})

test('canTransition: the deadlock cascade cannot skip reference-reduction/rubric (constitution §5)', () => {
  // FRESH_CELLS_SETTLED and REFERENCE_REDUCTION may only re-ratify or degrade before the cascade
  // completes; DEADLOCK_RESOLVED / COUNCIL_DEADLOCK are reachable ONLY out of RUBRIC_CHECK.
  assert.equal(canTransition('FRESH_CELLS_SETTLED', 'COUNCIL_DEADLOCK'), false, 'no direct terminal from fresh cells')
  assert.equal(canTransition('FRESH_CELLS_SETTLED', 'DEADLOCK_RESOLVED'), false)
  assert.ok(canTransition('FRESH_CELLS_SETTLED', 'REFERENCE_REDUCTION'))
  assert.equal(canTransition('REFERENCE_REDUCTION', 'COUNCIL_DEADLOCK'), false, 'reference-reduction must reach the rubric first')
  assert.ok(canTransition('REFERENCE_REDUCTION', 'RUBRIC_CHECK'))
  assert.ok(canTransition('REFERENCE_REDUCTION', 'RATIFIED'), 'a discriminating check may re-ratify')
  assert.ok(canTransition('RUBRIC_CHECK', 'DEADLOCK_RESOLVED') && canTransition('RUBRIC_CHECK', 'COUNCIL_DEADLOCK'))
})

test('phase enum shape: the ordered barriers and the four terminals are exactly as specified', () => {
  assert.deepEqual(COUNCIL_TERMINALS, ['RATIFIED', 'DEADLOCK_RESOLVED', 'COUNCIL_DEADLOCK', 'DEGRADED'])
  assert.equal(COUNCIL_PHASES[0], 'DRAFTS_SEALED')
  assert.equal(COUNCIL_PHASES[COUNCIL_PHASES.length - 1], 'RUBRIC_CHECK')
  assert.ok(COUNCIL_PHASES.includes('NEGOTIATION_SKIPPED') && COUNCIL_PHASES.includes('NEGOTIATION_SEALED'))
  assert.deepEqual(COUNCIL_HEADS, ['fable', 'sol'])
})

// ── canonicalizeFindings — stable script IDs, completion-order independent ───────────────────────────
const critA = { target_slot: 'P0', findings: [
  { target_decision_id: 'D004', claim: 'unsafe path', required_change: 'sanitize', severity: 'blocking', evidence: { class: 'executed_check' } },
  { target_decision_id: 'D001', claim: 'naming', required_change: 'rename', severity: 'minor', evidence: { class: 'repo_state' } },
] }
const critB = { target_slot: 'P1', findings: [
  { target_decision_id: 'D002', claim: 'leak', required_change: 'close', severity: 'blocking', evidence: { class: 'scenario' } },
] }

test('canonicalizeFindings: IDs are F-<decision-seq>-<slot>-<NNN> and independent of completion order', () => {
  const f1 = canonicalizeFindings([critA, critB])
  const f2 = canonicalizeFindings([critB, { ...critA, findings: [...critA.findings].reverse() }])
  assert.deepEqual(f1, f2, 'the frozen finding list is identical regardless of arrival order')
  assert.deepEqual(f1.map((x) => x.id), ['F-001-P0-001', 'F-002-P0-001', 'F-001-P1-001'])
  // decision-seq reflects the SORTED distinct decision id within the slot: D001 -> 001, D004 -> 002
  const d001 = f1.find((x) => x.target_decision_id === 'D001')
  const d004 = f1.find((x) => x.target_decision_id === 'D004')
  assert.equal(d001.id, 'F-001-P0-001')
  assert.equal(d004.id, 'F-002-P0-001')
})

test('canonicalizeFindings: two findings against the same decision get distinct NNN in canonical order', () => {
  const c = { target_slot: 'P0', findings: [
    { target_decision_id: 'D1', claim: 'zeta', required_change: 'z' },
    { target_decision_id: 'D1', claim: 'alpha', required_change: 'a' },
  ] }
  const ids = canonicalizeFindings([c]).map((x) => x.id)
  assert.deepEqual(ids, ['F-001-P0-001', 'F-001-P0-002'])
})

// ── validateDispositions — exact coverage, all invalidation cases, the unevidenced demotion ─────────
const frozen = [{ id: 'F-1' }, { id: 'F-2' }, { id: 'F-3' }]

test('validateDispositions: exact coverage with each disposition kind is valid', () => {
  const v = validateDispositions(frozen, [
    { finding_id: 'F-1', disposition: 'accepted', incorporated_at: ['sec-1'] },
    { finding_id: 'F-2', disposition: 'rejected_with_evidence', evidence_refs: ['r1'] },
    { finding_id: 'F-3', disposition: 'unresolved' },
  ])
  assert.ok(v.valid)
  assert.equal(v.errors.length, 0)
})

test('validateDispositions: unknown / duplicate / missing IDs each invalidate the whole response', () => {
  assert.equal(validateDispositions([{ id: 'F-1' }], [{ finding_id: 'X', disposition: 'unresolved' }, { finding_id: 'F-1', disposition: 'unresolved' }]).valid, false)
  assert.equal(validateDispositions([{ id: 'F-1' }], [{ finding_id: 'F-1', disposition: 'unresolved' }, { finding_id: 'F-1', disposition: 'unresolved' }]).valid, false)
  assert.equal(validateDispositions([{ id: 'F-1' }, { id: 'F-2' }], [{ finding_id: 'F-1', disposition: 'unresolved' }]).valid, false)
  const codes = validateDispositions([{ id: 'F-1' }, { id: 'F-2' }], [{ finding_id: 'F-1', disposition: 'unresolved' }]).errors.map((e) => e.code)
  assert.ok(codes.includes('missing_finding'))
})

test('validateDispositions: accepted without incorporated_at is invalid; unknown disposition enum is invalid', () => {
  assert.equal(validateDispositions([{ id: 'F-1' }], [{ finding_id: 'F-1', disposition: 'accepted', incorporated_at: [] }]).valid, false)
  assert.equal(validateDispositions([{ id: 'F-1' }], [{ finding_id: 'F-1', disposition: 'maybe' }]).valid, false)
})

test('validateDispositions: an unevidenced rejection is DEMOTED to unresolved (never a silent retirement)', () => {
  const v = validateDispositions([{ id: 'F-1' }], [{ finding_id: 'F-1', disposition: 'rejected_with_evidence', evidence_refs: [] }])
  assert.ok(v.valid)
  assert.equal(v.dispositions[0].disposition, 'unresolved')
})

// ── compareEvidence — the claim-scoped partial order ────────────────────────────────────────────────
test('compareEvidence: executed_check outranks proposed_check for an executable claim (both directions + equal)', () => {
  assert.equal(compareEvidence({ class: 'executed_check' }, { class: 'proposed_check' }, 'executable'), 'stronger')
  assert.equal(compareEvidence({ class: 'proposed_check' }, { class: 'executed_check' }, 'executable'), 'weaker')
  assert.equal(compareEvidence({ class: 'executed_check' }, { class: 'executed_check' }, 'executable'), 'equal')
})

test('compareEvidence: repo_state and test_output are comparable (equal) for a repo claim; external/risk scoped', () => {
  assert.equal(compareEvidence({ class: 'repo_state' }, { class: 'test_output' }, 'repo'), 'equal')
  assert.equal(compareEvidence({ class: 'primary_source' }, { class: 'primary_source' }, 'external'), 'equal')
  assert.equal(compareEvidence({ class: 'scenario' }, { class: 'scenario' }, 'risk'), 'equal')
})

test('compareEvidence: a class outside the claim scope is incomparable — it can never retire a finding', () => {
  assert.equal(compareEvidence({ class: 'executed_check' }, { class: 'scenario' }, 'repo'), 'incomparable')
  assert.equal(compareEvidence({ class: 'scenario' }, { class: 'executed_check' }, 'executable'), 'incomparable')
  assert.equal(claimTypeForClass('executed_check'), 'executable')
  assert.equal(claimTypeForClass('mystery'), null)
})

// ── validateReversal — the anti-capitulation signature-validity rule ────────────────────────────────
test('validateReversal: a weaker/absent/non-array changed_evidence leaves the prior block STANDING', () => {
  assert.equal(validateReversal({ evidence: { class: 'executed_check' }, claim_type: 'executable' }, { changed_evidence: [{ class: 'proposed_check' }] }).block_stands, true)
  assert.equal(validateReversal({ evidence: { class: 'executed_check' } }, {}).block_stands, true, 'absent changed_evidence never clears a block')
  // the §6 schema is an ARRAY — a bare object is invalid and is NEVER coerced
  const bare = validateReversal({ evidence: { class: 'executed_check' }, claim_type: 'executable' }, { changed_evidence: { class: 'executed_check' } })
  assert.equal(bare.block_stands, true)
  assert.equal(bare.reason, 'changed_evidence_not_array')
})

test('validateReversal: an equal-or-stronger changed_evidence ARRAY is a valid reversal', () => {
  assert.ok(validateReversal({ evidence: { class: 'proposed_check' }, claim_type: 'executable' }, { changed_evidence: [{ class: 'executed_check' }] }).valid)
  assert.ok(validateReversal({ evidence: { class: 'executed_check' }, claim_type: 'executable' }, { changed_evidence: [{ class: 'executed_check' }] }).valid)
})

// ── buildDivergenceSet — the six triggers, the accounting proof, the normalizer guard ───────────────
test('buildDivergenceSet: trigger 1 — an unresolved finding becomes a divergence', () => {
  const dv = bds({ findings: [{ id: 'F-1', evidence: { class: 'executed_check' } }], dispositions: [{ finding_id: 'F-1', disposition: 'unresolved' }] })
  assert.deepEqual(dv.divergences.map((d) => d.trigger), ['unresolved_finding'])
  assert.deepEqual(dv.accounting.findings, { retired: [], divergent: ['F-1'] })
})

test('buildDivergenceSet: trigger 2 — rejected_with_evidence whose rebuttal is weaker/incomparable diverges', () => {
  const weak = bds({ findings: [{ id: 'F-1', evidence: { class: 'executed_check' } }], dispositions: [{ finding_id: 'F-1', disposition: 'rejected_with_evidence', evidence: { class: 'proposed_check' } }] })
  assert.deepEqual(weak.divergences.map((d) => d.trigger), ['rejected_weak_evidence'])
  const strong = bds({ findings: [{ id: 'F-1', evidence: { class: 'proposed_check' } }], dispositions: [{ finding_id: 'F-1', disposition: 'rejected_with_evidence', evidence: { class: 'executed_check' } }] })
  assert.deepEqual(strong.accounting.findings, { retired: ['F-1'], divergent: [] }, 'a stronger rebuttal RETIRES the finding')
})

test('buildDivergenceSet: trigger 3 — accepted-but-not-incorporated diverges; incorporated retires', () => {
  const notInc = bds({ findings: [{ id: 'F-1' }], dispositions: [{ finding_id: 'F-1', disposition: 'accepted', incorporated: false }] })
  assert.deepEqual(notInc.divergences.map((d) => d.trigger), ['accepted_not_incorporated'])
  const inc = bds({ findings: [{ id: 'F-1' }], dispositions: [{ finding_id: 'F-1', disposition: 'accepted', incorporated: true }] })
  assert.equal(inc.empty, true)
})

test('buildDivergenceSet: trigger 4 — the same topic across two slots with differing values diverges', () => {
  const dv = bds({ decisions: { P0: [{ id: 'D1', topic: 't', value_hash: 'a' }], P1: [{ id: 'D1', topic: 't', value_hash: 'b' }] } })
  assert.deepEqual(dv.divergences.map((d) => d.trigger), ['incompatible_topic_values'])
  assert.deepEqual(dv.accounting.decisions.divergent, [{ slot: 'P0', id: 'D1' }, { slot: 'P1', id: 'D1' }])
  // identical values across the two slots are NOT a divergence (they agree)
  const agree = bds({ decisions: { P0: [{ id: 'D1', topic: 't', value_hash: 'a' }], P1: [{ id: 'D1', topic: 't', value_hash: 'a' }] } })
  assert.equal(agree.empty, true)
  assert.deepEqual(agree.accounting.decisions.settled, [{ slot: 'P0', id: 'D1' }, { slot: 'P1', id: 'D1' }])
})

test('buildDivergenceSet: trigger 5 — a NEITHER opposing a position diverges', () => {
  const dv = bds({ decisions: { P0: [{ id: 'D1', topic: 't', value_hash: 'a' }] }, neither: [{ topic: 't', opposed_slot: 'P0' }] })
  assert.deepEqual(dv.divergences.map((d) => d.trigger), ['neither_opposes_position'])
  assert.deepEqual(dv.accounting.decisions.divergent, [{ slot: 'P0', id: 'D1' }])
})

test('buildDivergenceSet: trigger 6 — atomic incompatibility of otherwise-agreed decisions diverges', () => {
  const dv = bds({ decisions: { P0: [{ id: 'DA', topic: 'a', value_hash: 'x' }, { id: 'DB', topic: 'b', value_hash: 'y' }] }, atomicConflicts: [{ topic_a: 'a', topic_b: 'b' }] })
  assert.deepEqual(dv.divergences.map((d) => d.trigger), ['atomic_incompatibility'])
  assert.deepEqual(dv.accounting.decisions.divergent, [{ slot: 'P0', id: 'DA' }, { slot: 'P0', id: 'DB' }])
})

test('buildDivergenceSet: every finding and decision id is accounted for exactly once (the proof)', () => {
  const dv = bds({
    findings: [{ id: 'F-1', evidence: { class: 'executed_check' } }, { id: 'F-2' }, { id: 'F-3', evidence: { class: 'scenario' } }],
    dispositions: [{ finding_id: 'F-1', disposition: 'unresolved' }, { finding_id: 'F-2', disposition: 'accepted', incorporated: true }, { finding_id: 'F-3', disposition: 'rejected_with_evidence', evidence: { class: 'scenario' } }],
    decisions: { P0: [{ id: 'D1', topic: 't', value_hash: 'a' }], P1: [{ id: 'D1', topic: 't', value_hash: 'b' }] },
  })
  const allFindings = [...dv.accounting.findings.retired, ...dv.accounting.findings.divergent].sort()
  assert.deepEqual(allFindings, ['F-1', 'F-2', 'F-3'])
  const allDecisions = [...dv.accounting.decisions.settled, ...dv.accounting.decisions.divergent]
  assert.equal(allDecisions.length, 2, 'both decision entries are accounted, none twice')
})

test('buildDivergenceSet: the normalizer may alias but a DROPPED id throws (it can never delete)', () => {
  assert.throws(() => bds({ findings: [{ id: 'F-1' }], dispositions: [{ finding_id: 'F-1', disposition: 'unresolved' }], normalizer: { findingIds: [], decisionIds: [] } }), /normalizer dropped finding id/)
  assert.throws(() => bds({ decisions: { P0: [{ id: 'D1', topic: 't', value_hash: 'a' }] }, normalizer: { findingIds: [], decisionIds: [] } }), /normalizer dropped decision id/)
  // a normalizer that lists every id (bare) does NOT throw
  assert.doesNotThrow(() => bds({ findings: [{ id: 'F-1' }], dispositions: [{ finding_id: 'F-1', disposition: 'unresolved' }], decisions: { P0: [{ id: 'D1', topic: 't', value_hash: 'a' }] }, normalizer: { findingIds: ['F-1'], decisionIds: ['D1'] } }))
})

test('buildDivergenceSet: a duplicate frozen finding id throws (the frozen set must be unique)', () => {
  assert.throws(() => bds({ findings: [{ id: 'F-1' }, { id: 'F-1' }], dispositions: [{ finding_id: 'F-1', disposition: 'unresolved' }] }), /duplicate finding id/)
})

test('buildDivergenceSet: a duplicate (slot,id) decision throws (a slot registry must be unique)', () => {
  assert.throws(() => bds({ decisions: { P0: [{ id: 'D1', topic: 't' }, { id: 'D1', topic: 't' }] } }), /duplicate decision id/)
  // the same id in DIFFERENT slots is fine (P0.D1 and P1.D1 are distinct decisions)
  assert.doesNotThrow(() => bds({ decisions: { P0: [{ id: 'D1', topic: 't', value_hash: 'a' }], P1: [{ id: 'D1', topic: 't', value_hash: 'a' }] } }))
})

test('buildDivergenceSet: an absent or empty seed THROWS (the bound-ID rule is constitutional)', () => {
  assert.throws(() => buildDivergenceSet({ findings: [{ id: 'F-1' }], dispositions: [{ finding_id: 'F-1', disposition: 'unresolved' }] }), /run seed is required/)
  assert.throws(() => buildDivergenceSet({ seed: '', findings: [] }), /run seed is required/)
})

test('buildDivergenceSet: divergence ids are SEED-BOUND (DV-<derived>), run-bound yet input-order-independent', () => {
  const mk = (seed, order) => bds({
    seed,
    findings: order === 'ab' ? [{ id: 'F-1', evidence: { class: 'executed_check' } }, { id: 'F-2', evidence: { class: 'scenario' } }] : [{ id: 'F-2', evidence: { class: 'scenario' } }, { id: 'F-1', evidence: { class: 'executed_check' } }],
    dispositions: [{ finding_id: 'F-1', disposition: 'unresolved' }, { finding_id: 'F-2', disposition: 'unresolved' }],
  })
  const a = mk('SEED-A', 'ab'), b = mk('SEED-B', 'ab'), aReordered = mk('SEED-A', 'ba')
  assert.match(a.divergences[0].divergence_id, /^DV-[0-9a-f]{12}$/, 'ids are DV-<12 hex>, not a bare ordinal')
  assert.notDeepEqual(a.divergences.map((d) => d.divergence_id), b.divergences.map((d) => d.divergence_id), 'a different run seed yields different ids')
  assert.deepEqual(a.divergences.map((d) => d.divergence_id).sort(), aReordered.divergences.map((d) => d.divergence_id).sort(), 'the same seed + content yields the same ids regardless of input order')
})

test('buildDivergenceSet: two divergences differing ONLY in a trigger-discriminating field get distinct ids (no collision)', () => {
  // a P0-opposed and a P1-opposed NEITHER on the same topic must not share an id (opposed_slot is in the preimage)
  const dv = bds({ decisions: { P0: [{ id: 'DA', topic: 't', value_hash: 'a' }], P1: [{ id: 'DB', topic: 't', value_hash: 'a' }] }, neither: [{ topic: 't', opposed_slot: 'P0' }, { topic: 't', opposed_slot: 'P1' }] })
  const ids = dv.divergences.filter((d) => d.trigger === 'neither_opposes_position').map((d) => d.divergence_id)
  assert.equal(ids.length, 2)
  assert.notEqual(ids[0], ids[1], 'opposed_slot discriminates the ids')
  // and the set hash is input-order-independent even for cards that differ ONLY in opposed_slot
  // (the sort key is the full card, so two distinct cards never tie into an order-dependent output)
  const dvRev = bds({ decisions: { P0: [{ id: 'DA', topic: 't', value_hash: 'a' }], P1: [{ id: 'DB', topic: 't', value_hash: 'a' }] }, neither: [{ topic: 't', opposed_slot: 'P1' }, { topic: 't', opposed_slot: 'P0' }] })
  assert.equal(dv.hash, dvRev.hash, 'reversing two equivalent NEITHER cards does not change the set hash')
})

test('buildDivergenceSet: the hash and DV ids are input-order-independent (canonical)', () => {
  const inA = {
    findings: [{ id: 'F-1', evidence: { class: 'executed_check' } }, { id: 'F-2', evidence: { class: 'scenario' } }],
    dispositions: [{ finding_id: 'F-1', disposition: 'unresolved' }, { finding_id: 'F-2', disposition: 'unresolved' }],
    decisions: { P0: [{ id: 'D1', topic: 't', value_hash: 'a' }], P1: [{ id: 'D1', topic: 't', value_hash: 'b' }] },
  }
  const inB = {
    findings: [{ id: 'F-2', evidence: { class: 'scenario' } }, { id: 'F-1', evidence: { class: 'executed_check' } }],
    dispositions: [{ finding_id: 'F-2', disposition: 'unresolved' }, { finding_id: 'F-1', disposition: 'unresolved' }],
    decisions: { P1: [{ id: 'D1', topic: 't', value_hash: 'b' }], P0: [{ id: 'D1', topic: 't', value_hash: 'a' }] },
  }
  assert.equal(bds(inA).hash, bds(inB).hash)
})

// ── decision bundle + ratification + signatures ─────────────────────────────────────────────────────
test('buildDecisionBundle: a well-formed bundle validates and hashes stably; a malformed divergence is caught', () => {
  const good = buildDecisionBundle({ common_trunk: { a: 1 }, settled_decisions: {}, open_divergences: [{ divergence_id: 'DV-001', position_0: {}, position_1: {}, compatibility_edges: [], evidence_refs: [] }], renderer_version: 'r/1', evidence_manifest_hash: 'eh' })
  assert.ok(good.valid)
  assert.equal(good.hash, bundleHash(good.bundle))
  const bad = buildDecisionBundle({ open_divergences: [{ divergence_id: 'DV-001' }] })
  assert.equal(bad.valid, false)
  assert.ok(bad.errors.some((e) => e.code === 'malformed_divergence'))
})

test('validateRatification: covers exactly the open divergences; bad verdict/hash/coverage are caught', () => {
  const ctx = { bundle_hash: 'BH', open_divergence_ids: ['DV-001', 'DV-002'] }
  const ok = validateRatification({ verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: [{ divergence_id: 'DV-001', selection: 'P0' }, { divergence_id: 'DV-002', selection: 'MERGED' }] }, ctx)
  assert.ok(ok.valid)
  const codes = (r) => validateRatification(r, ctx).errors.map((e) => e.code)
  assert.ok(codes({ verdict: 'MAYBE', artifact_hash: 'BH', divergence_selections: [{ divergence_id: 'DV-001', selection: 'P0' }, { divergence_id: 'DV-002', selection: 'P1' }] }).includes('bad_verdict'))
  assert.ok(codes({ verdict: 'APPROVE', artifact_hash: 'WRONG', divergence_selections: [{ divergence_id: 'DV-001', selection: 'P0' }, { divergence_id: 'DV-002', selection: 'P1' }] }).includes('artifact_hash_mismatch'))
  assert.ok(codes({ verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: [{ divergence_id: 'DV-001', selection: 'P0' }] }).includes('uncovered_divergence'))
  assert.ok(codes({ verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: [{ divergence_id: 'DV-001', selection: 'P0' }, { divergence_id: 'DV-003', selection: 'P1' }] }).includes('unknown_divergence'))
  assert.ok(codes({ verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: [{ divergence_id: 'DV-001', selection: 'BAD' }, { divergence_id: 'DV-002', selection: 'P1' }] }).includes('bad_selection'))
})

test('validateRatification: findings[] entries are shape-checked (finding_id/claim/required_change/evidence_refs/executable_check)', () => {
  const ctx = { bundle_hash: 'BH', open_divergence_ids: [] }
  const base = { verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: [] }
  const good = { ...base, findings: [{ finding_id: 'F-1', claim: 'c', required_change: 'r', evidence_refs: [], executable_check: null }] }
  assert.ok(validateRatification(good, ctx).valid)
  assert.ok(validateRatification({ ...base, findings: [{ finding_id: 'F-1' }] }, ctx).errors.some((e) => e.code === 'malformed_finding'))
  assert.ok(validateRatification({ ...base, findings: [{ finding_id: 'F-1', claim: 'c', required_change: 'r', evidence_refs: [] }] }, ctx).errors.some((e) => e.code === 'malformed_finding'), 'a missing executable_check key is malformed')
  // a PRESENT-but-non-array findings container is itself malformed (only absent defaults to empty)
  assert.ok(validateRatification({ ...base, findings: {} }, ctx).errors.some((e) => e.code === 'malformed_findings'), 'findings:{} is a malformed container')
})

test('validateRatification: an APPROVE reversing a standing block without equal-or-stronger changed_evidence is INVALID', () => {
  const block = { finding_id: 'F-9', evidence: { class: 'executed_check' }, claim_type: 'executable' }
  const ctx = { bundle_hash: 'BH', open_divergence_ids: [], standing_blocks: [block] }
  const weak = { verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: [], changed_evidence: [{ class: 'proposed_check' }] }
  assert.ok(validateRatification(weak, ctx).errors.some((e) => e.code === 'unevidenced_reversal'), 'a concession cannot clear the block')
  const strong = { verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: [], changed_evidence: [{ class: 'executed_check' }] }
  assert.ok(validateRatification(strong, ctx).valid, 'equal-or-stronger changed_evidence clears the standing block')
})

test('validateRatification: an incompatible selection combination is rejected (atomic compatibility, spec §7)', () => {
  const ctx = { bundle_hash: 'BH', open_divergence_ids: ['DV-a', 'DV-b'], compatibility_edges: [[{ divergence_id: 'DV-a', selection: 'P0' }, { divergence_id: 'DV-b', selection: 'P0' }]] }
  const bad = validateRatification({ verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: [{ divergence_id: 'DV-a', selection: 'P0' }, { divergence_id: 'DV-b', selection: 'P0' }] }, ctx)
  assert.ok(bad.errors.some((e) => e.code === 'incompatible_selection'), 'two mutually-incompatible P0 selections must not validate')
  const okCombo = validateRatification({ verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: [{ divergence_id: 'DV-a', selection: 'P0' }, { divergence_id: 'DV-b', selection: 'P1' }] }, ctx)
  assert.ok(okCombo.valid, 'a compatible combination validates')
})

test('validateRatification: a malformed compatibility edge is a validation ERROR, never silently skipped; a self-edge is rejected', () => {
  const sel = [{ divergence_id: 'DV-a', selection: 'P0' }, { divergence_id: 'DV-b', selection: 'P1' }]
  const rat = { verdict: 'APPROVE', artifact_hash: 'BH', divergence_selections: sel }
  const withEdges = (edges) => validateRatification(rat, { bundle_hash: 'BH', open_divergence_ids: ['DV-a', 'DV-b'], compatibility_edges: edges })
  assert.ok(withEdges([[{ divergence_id: 'DV-a' }]]).errors.some((e) => e.code === 'malformed_edge'), 'a one-member edge is malformed')
  assert.ok(withEdges([[{ divergence_id: 'DV-a', selection: 'BOGUS' }, { divergence_id: 'DV-b', selection: 'P1' }]]).errors.some((e) => e.code === 'malformed_edge'), 'an illegal selection is malformed')
  assert.ok(withEdges([[{ divergence_id: 'DV-a', selection: 'P0' }, { divergence_id: 'DV-a', selection: 'P1' }]]).errors.some((e) => e.code === 'self_edge'), 'an edge relating a divergence to itself is a self_edge')
  // a PRESENT-but-non-array compatibility_edges container is itself malformed (only absent defaults to empty)
  assert.ok(withEdges({}).errors.some((e) => e.code === 'malformed_edges_container'), 'compatibility_edges:{} is a malformed container')
})

test('validateReversal: changed_evidence may be a schema-shaped ARRAY — the reversal stands on any equal-or-stronger element', () => {
  const prior = { evidence: { class: 'executed_check' }, claim_type: 'executable' }
  assert.ok(validateReversal(prior, { changed_evidence: [{ class: 'scenario' }, { class: 'executed_check' }] }).valid, 'one strong element among weak/incomparable ones suffices')
  assert.equal(validateReversal(prior, { changed_evidence: [{ class: 'proposed_check' }, { class: 'scenario' }] }).block_stands, true, 'all-weak/incomparable leaves the block standing')
  assert.equal(validateReversal(prior, { changed_evidence: [] }).block_stands, true, 'an empty array is no evidence')
})

test('councilSignature / verifySignature: a valid signature verifies; tamper AND a stale-artifact context both invalidate it', () => {
  const bound = { bundle_hash: 'BH', renderer_version: 'r/1', plan_hash: 'PH', evidence_manifest_hash: 'EH', protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: { seat: 'anon' } }
  const sig = councilSignature(bound)
  assert.ok(verifySignature(sig), 'integrity-only (no context) verifies')
  assert.equal(verifySignature({ ...sig, plan_hash: 'TAMPERED' }), false, 'a revised bound field breaks the self-hash')
  assert.equal(verifySignature({ ...sig, signature_hash: 'deadbeef' }), false)
  // the finding: after the bundle hash moves, the OLD signature must NOT verify against the new context.
  assert.ok(verifySignature(sig, { bundle_hash: 'BH' }), 'it verifies against the matching current context')
  assert.equal(verifySignature(sig, { bundle_hash: 'NEWHASH' }), false, 'a stale signature never verifies against a revised bundle')
})

// ── fresh-round machinery — cell table, call counts, card ids, normalization, aggregation ───────────
test('FRESH_CELLS: the 2x2 counterbalance — each position twice-first/twice-second and twice-as-K/twice-as-M', () => {
  assert.equal(FRESH_CELLS.length, 4)
  // K side by label mapping: canonical -> K=P0, swapped -> K=P1; each position is K exactly twice.
  const kIsP0 = FRESH_CELLS.filter((c) => c.label_mapping === 'canonical').length
  const kIsP1 = FRESH_CELLS.filter((c) => c.label_mapping === 'swapped').length
  assert.equal(kIsP0, 2)
  assert.equal(kIsP1, 2)
  const firstK = FRESH_CELLS.filter((c) => c.presentation_order === 'K_then_M').length
  const firstM = FRESH_CELLS.filter((c) => c.presentation_order === 'M_then_K').length
  assert.equal(firstK, 2)
  assert.equal(firstM, 2)
})

test('freshRoundSchedule: base tier is 8 calls, high tier is 24, with the moderate probe at sample 2', () => {
  const seed = councilSeed({ runToken: 'rt', keystoneId: 'k', divergenceId: 'DV-001' })
  const base = freshRoundSchedule({ seed, divergenceId: 'DV-001', tier: 'base' })
  const high = freshRoundSchedule({ seed, divergenceId: 'DV-001', tier: 'high' })
  assert.equal(base.call_count, 8)
  assert.equal(base.calls.every((c) => c.temperature === 0), true, 'base tier is entirely T=0')
  assert.equal(high.call_count, 24)
  const highSamples = high.calls.filter((c) => c.head === 'fable' && c.cell === 'C00').map((c) => c.temperature)
  assert.deepEqual(highSamples, [0, 0, 0.7], 'two low-T probes + one moderate-T probe per cell')
  // the schedule is deterministic (card ids are seed-derived, not random)
  assert.deepEqual(freshRoundSchedule({ seed, divergenceId: 'DV-001', tier: 'base' }).calls.map((c) => c.card_id), base.calls.map((c) => c.card_id))
})

test('normalizeCellVerdict: K/M map back to canonical P0/P1; no_decision and insufficient-evidence are distinct', () => {
  assert.equal(normalizeCellVerdict('K', 'canonical'), 'P0')
  assert.equal(normalizeCellVerdict('M', 'canonical'), 'P1')
  assert.equal(normalizeCellVerdict('K', 'swapped'), 'P1')
  assert.equal(normalizeCellVerdict('M', 'swapped'), 'P0')
  assert.equal(normalizeCellVerdict('NEITHER', 'canonical'), 'NEITHER')
  assert.equal(normalizeCellVerdict('no_decision', 'canonical'), 'NO_DECISION', 'deliberate abstention is a legal verdict')
  assert.equal(normalizeCellVerdict('INSUFFICIENT_EVIDENCE', 'swapped'), 'INSUFFICIENT_EVIDENCE', 'a failure to rule is not a verdict')
  assert.equal(normalizeCellVerdict('garbage', 'canonical'), 'INVALID', 'an unknown choice is never a silent vote')
})

// a fresh-round head produces 4 cells (base) or 12 instances (high). Helpers build a complete schedule.
const CELLS = ['C00', 'C01', 'C10', 'C11']
const baseCells = (outcome, defects) => CELLS.map((cell) => ({ cell, outcome, defects }))
const highCells = (outcome, defects) => CELLS.flatMap((cell) => [0, 1, 2].map(() => ({ cell, outcome, defects })))

test('aggregateHead: DECISIVE requires a complete unanimous schedule; abstention and failure-to-rule differ', () => {
  assert.deepEqual(aggregateHead(baseCells('P0'), { tier: 'base' }), { aggregate: 'DECISIVE', outcome: 'P0' })
  assert.deepEqual(aggregateHead(baseCells('NEITHER', { P0: ['d'], P1: ['e'] }), { tier: 'base' }), { aggregate: 'DECISIVE', outcome: 'NEITHER' })
  assert.deepEqual(aggregateHead(baseCells('NO_DECISION'), { tier: 'base' }), { aggregate: 'NO_DECISION' }, 'unanimous deliberate abstention is a stable NO_DECISION')
  assert.equal(aggregateHead(baseCells('INSUFFICIENT_EVIDENCE'), { tier: 'base' }).aggregate, 'UNSTABLE', 'even unanimous insufficient-evidence is instability, never a verdict')
  assert.deepEqual(aggregateHead(highCells('P0'), { tier: 'high' }), { aggregate: 'DECISIVE', outcome: 'P0' })
})

test('aggregateHead: an incomplete or duplicated schedule is instability, never a vote (completeness proof)', () => {
  assert.equal(aggregateHead([{ cell: 'C00', outcome: 'P0' }], { tier: 'base' }).aggregate, 'UNSTABLE', 'one cell is not four')
  assert.equal(aggregateHead([...baseCells('P0'), { cell: 'C00', outcome: 'P0' }], { tier: 'base' }).aggregate, 'UNSTABLE', 'a duplicated cell')
  assert.equal(aggregateHead(highCells('P0'), { tier: 'base' }).aggregate, 'UNSTABLE', '12 instances under the base tier is not the schedule')
  assert.equal(aggregateHead(baseCells('P0'), { tier: 'high' }).aggregate, 'UNSTABLE', '4 instances under the high tier is not the schedule')
  assert.equal(aggregateHead([{ cell: 'X', outcome: 'P0' }, ...baseCells('P0').slice(1)], { tier: 'base' }).aggregate, 'UNSTABLE', 'an unknown cell')
})

test('aggregateHead: a NEITHER needs named P0 AND P1 defects (pinned keys); wrong keys and inconsistent sets are instability', () => {
  assert.equal(aggregateHead(baseCells('NEITHER'), { tier: 'base' }).aggregate, 'UNSTABLE', 'no defects at all')
  assert.equal(aggregateHead(baseCells('NEITHER', { P0: ['d'] }), { tier: 'base' }).aggregate, 'UNSTABLE', 'a defect for only one position')
  assert.equal(aggregateHead(baseCells('NEITHER', { foo: ['d'], bar: ['e'] }), { tier: 'base' }).aggregate, 'UNSTABLE', 'wrong keys are not P0/P1 defects')
  // a named defect is a NON-BLANK STRING after trim — blank/null/non-string entries do not count
  assert.equal(aggregateHead(baseCells('NEITHER', { P0: ['   '], P1: [null] }), { tier: 'base' }).aggregate, 'UNSTABLE', 'a blank/null defect is not a named defect')
  assert.equal(aggregateHead(baseCells('NEITHER', { P0: ['d'], P1: ['e'] }), { tier: 'base' }).outcome, 'NEITHER', 'a defect for both pinned positions is valid')
  // all-NEITHER but the defect SETS differ across cells -> instability, not a shared verdict
  const inconsistent = CELLS.map((cell, i) => ({ cell, outcome: 'NEITHER', defects: { P0: [`p${i}`], P1: ['q'] } }))
  assert.equal(aggregateHead(inconsistent, { tier: 'base' }).aggregate, 'UNSTABLE', 'inconsistent NEITHER defects are instability')
})

test('aggregateHead: any within-cell dissent (incl. the moderate probe) makes the head UNSTABLE', () => {
  const split = CELLS.flatMap((cell) => cell === 'C00' ? [{ cell, outcome: 'P0' }, { cell, outcome: 'P0' }, { cell, outcome: 'P1' }] : [0, 1, 2].map(() => ({ cell, outcome: 'P0' })))
  assert.equal(aggregateHead(split, { tier: 'high' }).aggregate, 'UNSTABLE', 'a moderate-probe dissent is never majority-washed')
})

test('aggregateCouncil: agreement / structural-split / joint-NEITHER / adequacy-split / ambiguity / degraded', () => {
  const D = (o) => ({ aggregate: 'DECISIVE', outcome: o })
  assert.deepEqual(aggregateCouncil(D('P0'), D('P0')), { route: 'agreement', class: 'fresh_dual_agreement', position: 'P0' })
  assert.equal(aggregateCouncil(D('P0'), D('P1')).route, 'structural')
  assert.equal(aggregateCouncil(D('P0'), D('P1')).class, 'structural_split')
  assert.equal(aggregateCouncil(D('NEITHER'), D('NEITHER')).class, 'joint_structural_rejection')
  assert.equal(aggregateCouncil(D('NEITHER'), D('P0')).class, 'structural_adequacy_split')
  assert.equal(aggregateCouncil({ aggregate: 'UNSTABLE' }, D('P0')).route, 'ambiguity')
  assert.equal(aggregateCouncil(D('P0'), { aggregate: 'NO_DECISION' }).route, 'ambiguity', 'decisive vs no_decision is ambiguity, never unilateral')
  assert.equal(aggregateCouncil(D('P0'), { aggregate: 'MISSING' }).route, 'degraded', 'a missing head aggregate is degradation, not deadlock')
})

// ── reversibility sealing ───────────────────────────────────────────────────────────────────────────
test('sealReversibility: only identical reversible classifications count as a two-way door', () => {
  const seed = councilSeed({ runToken: 'rt', keystoneId: 'k' })
  // exactly one two-way door -> provisional adoption of it
  assert.deepEqual(sealReversibility({ P0: 'reversible', P1: 'costly' }, { P0: 'reversible', P1: 'irreversible' }, seed), { resolution: 'reversibility_rule', adopt: 'P0', door: 'single_two_way', mel_required: true })
  // differing classifications for the same option = one-way -> both one-way -> gated
  assert.equal(sealReversibility({ P0: 'reversible', P1: 'x' }, { P0: 'costly', P1: 'x' }, seed).door, 'both_one_way')
  assert.equal(sealReversibility({ P0: 'costly', P1: 'costly' }, { P0: 'costly', P1: 'costly' }, seed).resolution, 'gated')
  // a missing classification is one-way
  assert.equal(sealReversibility({ P0: 'reversible' }, { P1: 'reversible' }, seed).door, 'both_one_way')
})

test('sealReversibility: both two-way doors resolve by a DETERMINISTIC parity tie-break from the hidden seed', () => {
  const seed = councilSeed({ runToken: 'rt', keystoneId: 'k' })
  const r1 = sealReversibility({ P0: 'reversible', P1: 'reversible' }, { P0: 'reversible', P1: 'reversible' }, seed)
  const r2 = sealReversibility({ P0: 'reversible', P1: 'reversible' }, { P0: 'reversible', P1: 'reversible' }, seed)
  assert.equal(r1.door, 'parity_tie_break')
  assert.deepEqual(r1, r2, 'the tie-break is deterministic for a fixed seed')
  assert.equal(r1.adopt, parityTieBreak(seed) === 0 ? 'P0' : 'P1')
})

// ── MEL record ──────────────────────────────────────────────────────────────────────────────────────
test('buildMelRecord: dissent verbatim; auto-summon needs TWO open issues in the SAME subsystem; trigger must be time-boxed', () => {
  const one = buildMelRecord({ dissent: 'I still object', limitation: 'scoped to auth', reviewTrigger: { after_days: 30 }, openIssues: [{ subsystem: 'auth' }] })
  assert.equal(one.dissent_verbatim, 'I still object')
  assert.equal(one.auto_summon_operator, false)
  assert.equal(one.valid, true, 'a bounded after_days trigger is time-boxed')
  // two dissents in DIFFERENT subsystems do NOT summon (the compounding guard is per-subsystem)
  assert.equal(buildMelRecord({ dissent: 'd', reviewTrigger: { at_milestone: 'M2' }, openIssues: [{ subsystem: 'auth' }, { subsystem: 'db' }] }).auto_summon_operator, false)
  // two dissents in the SAME subsystem DO summon
  assert.equal(buildMelRecord({ dissent: 'd', reviewTrigger: { at_milestone: 'M2' }, openIssues: [{ subsystem: 'auth' }, { subsystem: 'auth' }] }).auto_summon_operator, true)
  // a null / non-time-boxed trigger makes the record invalid
  assert.equal(buildMelRecord({ dissent: 'd', openIssues: [] }).valid, false)
  assert.equal(buildMelRecord({ dissent: 'd', reviewTrigger: { note: 'someday' }, openIssues: [] }).valid, false, 'an open-ended trigger is not time-boxed')
})

test('buildMelRecord: the trigger boundaries — nonfinite/nonpositive numerics and blank strings are all invalid', () => {
  for (const bad of [{ after_days: NaN }, { after_days: Infinity }, { after_days: 0 }, { after_days: -1 }, { after_hours: 0 }, { after_hours: -3 }, { deadline: '' }, { deadline: '   ' }, { at_milestone: '  ' }]) {
    assert.equal(buildMelRecord({ dissent: 'd', reviewTrigger: bad, openIssues: [] }).valid, false, `reviewTrigger ${JSON.stringify(bad)} must not be time-boxed`)
  }
  for (const good of [{ after_days: 1 }, { after_hours: 12 }, { deadline: '2026-08-01' }, { at_milestone: 'M3' }, { on_evidence: 'perf-bench' }]) {
    assert.equal(buildMelRecord({ dissent: 'd', reviewTrigger: good, openIssues: [] }).valid, true, `reviewTrigger ${JSON.stringify(good)} is time-boxed`)
  }
})

// ── checkpoint match / mismatch / half-pair ─────────────────────────────────────────────────────────
const cpFields = {
  protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: 'th', run_token_hash: 'rth', initial_ledger_seq: 7,
  keystone_id: 'master', phase: 'DRAFTS_SEALED', decision_bundle_hash: 'bh', input_artifact_hashes: ['i1', 'i2'],
  evidence_manifest_hash: 'eh', anonymous_seat_artifact_hashes: { P0: 'h0', P1: 'h1' }, seat_provenance: { x: 1 },
  codex_receipt_hash: 'ch', status: 'sealed',
}

test('matchCheckpoint: identical sealed checkpoints match; each mismatching hash class forces a rerun', () => {
  assert.equal(matchCheckpoint(buildCheckpoint(cpFields), buildCheckpoint(cpFields)), true)
  for (const [field, changed] of [
    ['protocol_version', 'twin-council/OTHER'], ['template_hash', 'X'], ['run_token_hash', 'X'], ['initial_ledger_seq', 8],
    ['keystone_id', 'X'], ['phase', 'CRITIQUES_SEALED'], ['decision_bundle_hash', 'X'], ['input_artifact_hashes', ['i1']],
    ['evidence_manifest_hash', 'X'], ['anonymous_seat_artifact_hashes', { P0: 'h0', P1: 'DIFF' }], ['seat_provenance', { x: 2 }], ['codex_receipt_hash', 'X'],
  ]) {
    assert.equal(matchCheckpoint(buildCheckpoint(cpFields), buildCheckpoint({ ...cpFields, [field]: changed })), false, `a changed ${field} must force a rerun`)
  }
})

test('matchCheckpoint: seat expectations are PHASE-AWARE — half-pair, zero-seat-paired, and non-sealed are all non-reusable', () => {
  assert.equal(matchCheckpoint(buildCheckpoint({ ...cpFields, anonymous_seat_artifact_hashes: { P0: 'h0' } }), buildCheckpoint(cpFields)), false, 'half-pair never reused')
  assert.equal(matchCheckpoint(buildCheckpoint({ ...cpFields, status: 'pending' }), buildCheckpoint(cpFields)), false, 'a non-sealed prior never reused')
  // a PAIRED barrier (DRAFTS_SEALED) sealed with ZERO seat artifacts is malformed — never reusable
  const zeroSeat = { ...cpFields, anonymous_seat_artifact_hashes: {} }
  assert.equal(matchCheckpoint(buildCheckpoint(zeroSeat), buildCheckpoint(zeroSeat)), false, 'a zero-seat sealed paired checkpoint is not reusable')
  // a SCRIPT-ONLY phase (DIVERGENCES_BUILT) legitimately carries zero seat artifacts — reusable
  const script = { ...cpFields, phase: 'DIVERGENCES_BUILT', anonymous_seat_artifact_hashes: {} }
  assert.equal(matchCheckpoint(buildCheckpoint(script), buildCheckpoint(script)), true, 'a script phase with zero seats reuses cleanly')
  // FRESH_CARDS_SEALED is a PAIRED barrier (both heads' frozen cards) — a zero-seat one is not reusable
  const freshZero = { ...cpFields, phase: 'FRESH_CARDS_SEALED', anonymous_seat_artifact_hashes: {} }
  assert.equal(matchCheckpoint(buildCheckpoint(freshZero), buildCheckpoint(freshZero)), false, 'zero-seat FRESH_CARDS_SEALED is not reusable')
  const freshPair = { ...cpFields, phase: 'FRESH_CARDS_SEALED', anonymous_seat_artifact_hashes: { fable: 'a', sol: 'b' } }
  assert.equal(matchCheckpoint(buildCheckpoint(freshPair), buildCheckpoint(freshPair)), true, 'a two-seat FRESH_CARDS_SEALED reuses cleanly')
})

test('buildCheckpoint: emits exactly the council_state field list as a note data payload', () => {
  const cp = buildCheckpoint(cpFields)
  assert.equal(cp.kind, 'council_state')
  assert.deepEqual(Object.keys(cp).sort(), [
    'anonymous_seat_artifact_hashes', 'codex_receipt_hash', 'decision_bundle_hash', 'evidence_manifest_hash',
    'initial_ledger_seq', 'input_artifact_hashes', 'keystone_id', 'kind', 'phase', 'protocol_version',
    'run_token_hash', 'seat_provenance', 'status', 'template_hash',
  ])
})

// a COMPLETE current context (all six bound keys) and two DISTINCT-head signatures build a ratification.
const CTX6 = { bundle_hash: 'BH', renderer_version: 'r/1', plan_hash: 'PH', evidence_manifest_hash: 'EH', protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: { seat: 'shared' } }
const sigFable = councilSignature({ ...CTX6, seat_provenance: { head: 'fable' } })
const sigSol = councilSignature({ ...CTX6, seat_provenance: { head: 'sol' } })
const ratA = { verdict: 'APPROVE', divergence_selections: [{ divergence_id: 'DV-1', selection: 'P0' }] }
const ratB = { verdict: 'APPROVE', divergence_selections: [{ divergence_id: 'DV-1', selection: 'P0' }] }

// ── terminal-outcome constructors — distinct labels, never interchangeable ──────────────────────────
test('terminal constructors: the four labels are distinct and never confusable', () => {
  const ratified = twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [ratA, ratB], open_divergence_ids: ['DV-1'] })
  assert.equal(ratified.label, 'twin_ratified')
  assert.equal(ratified.terminal, 'RATIFIED')
  assert.equal(twinDeadlockResolved({ resolution: 'operator', certificate: { c: 1 } }).label, 'twin_deadlock_resolved')
  assert.equal(councilDeadlock({}).label, 'council_deadlock')
  assert.equal(councilDeadlock({}).stage_completed, false, 'COUNCIL_DEADLOCK never emits stage_completed')
  assert.equal(degraded({ missing: 'sol', reason: 'timeout' }).label, 'twin_degraded')
  const labels = new Set([ratified.label, twinDeadlockResolved({ resolution: 'operator', certificate: {} }).label, councilDeadlock({}).label, degraded({}).label])
  assert.equal(labels.size, 4)
})

test('twinRatified: requires two DISTINCT-head signatures, a COMPLETE context, APPROVE, and MATCHING selections', () => {
  assert.throws(() => twinRatified({}), /two head signatures/, 'zero signatures cannot ratify (constitution §8)')
  assert.throws(() => twinRatified({ signatures: [sigFable], context: CTX6, ratifications: [ratA, ratB] }), /two head signatures/)
  // an empty/partial context is an error, not a skip — it cannot bind signatures over another artifact
  assert.throws(() => twinRatified({ signatures: [sigFable, sigSol], context: {}, ratifications: [ratA, ratB] }), /incomplete/)
  assert.throws(() => twinRatified({ signatures: [sigFable, sigSol], context: { bundle_hash: 'BH' }, ratifications: [ratA, ratB] }), /incomplete/)
  // the SAME signature twice can never supply the second signature (distinct seat_provenance required)
  assert.throws(() => twinRatified({ signatures: [sigFable, sigFable], context: CTX6, ratifications: [ratA, ratB] }), /DISTINCT heads/)
  // a BLOCK verdict cannot ratify
  assert.throws(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [ratA, { verdict: 'BLOCK', divergence_selections: [{ divergence_id: 'DV-1', selection: 'P0' }] }] }), /APPROVE/)
  // matching selections are mandatory — two APPROVE verdicts choosing opposing positions are BLOCKED (N1)
  assert.throws(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [ratA, { verdict: 'APPROVE', divergence_selections: [{ divergence_id: 'DV-1', selection: 'P1' }] }], open_divergence_ids: ['DV-1'] }), /matching selections/)
  // a signature over a STALE bundle cannot ratify the current one
  const stale = councilSignature({ ...CTX6, bundle_hash: 'OLD', seat_provenance: { head: 'fable' } })
  assert.throws(() => twinRatified({ signatures: [stale, sigSol], context: CTX6, ratifications: [ratA, ratB] }), /does not verify/)
  assert.doesNotThrow(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [ratA, ratB], open_divergence_ids: ['DV-1'] }))
})

test('twinRatified: a context bound entirely to nulls is no binding — null-bound signatures cannot ratify', () => {
  const ctxNull = { bundle_hash: null, renderer_version: null, plan_hash: null, evidence_manifest_hash: null, protocol_version: null, seat_provenance: null }
  const nA = councilSignature({ ...ctxNull, seat_provenance: { head: 'fable' } })
  const nB = councilSignature({ ...ctxNull, seat_provenance: { head: 'sol' } })
  const rat = { verdict: 'APPROVE', divergence_selections: [] }
  assert.throws(() => twinRatified({ signatures: [nA, nB], context: ctxNull, ratifications: [rat, rat] }), /bound '.*' to null|no binding/, 'a null-bound certificate cannot ratify')
})

test('twinRatified: BOTH ratifications must COVER every open divergence — an omitted open id is a blocked ratification (N1)', () => {
  const rat = { verdict: 'APPROVE', divergence_selections: [] }
  assert.throws(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [rat, rat], open_divergence_ids: ['DV-OPEN'] }), /not covered|uncovered/, 'both omitting DV-OPEN cannot ratify')
  const covered = { verdict: 'APPROVE', divergence_selections: [{ divergence_id: 'DV-OPEN', selection: 'P0' }] }
  assert.doesNotThrow(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [covered, covered], open_divergence_ids: ['DV-OPEN'] }))
  // one covers, one omits -> blocked
  assert.throws(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [covered, rat], open_divergence_ids: ['DV-OPEN'] }), /not covered|uncovered/)
})

test('twinRatified: an ILLEGAL or absent selection is not coverage — DV-OPEN selected BAD (or with no selection) is blocked', () => {
  const bad = { verdict: 'APPROVE', divergence_selections: [{ divergence_id: 'DV-OPEN', selection: 'BAD' }] }
  const noSel = { verdict: 'APPROVE', divergence_selections: [{ divergence_id: 'DV-OPEN' }] }
  assert.throws(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [bad, bad], open_divergence_ids: ['DV-OPEN'] }), /illegal or absent|bad selection/, 'selection:BAD is not coverage')
  assert.throws(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [noSel, noSel], open_divergence_ids: ['DV-OPEN'] }), /illegal or absent/, 'an absent selection is not coverage')
})

test('twinRatified: open_divergence_ids is MANDATORY — an omitted set throws; an explicit [] with clean inputs ratifies', () => {
  assert.throws(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [ratA, ratB] }), /open_divergence_ids is required/, 'a missing set silently loses coverage enforcement')
  const clean = { verdict: 'APPROVE', divergence_selections: [] }
  assert.doesNotThrow(() => twinRatified({ signatures: [sigFable, sigSol], context: CTX6, ratifications: [clean, clean], open_divergence_ids: [] }))
})

test('twinDeadlockResolved: rejects an invalid resolution and a missing certificate (exceptional authority only)', () => {
  assert.throws(() => twinDeadlockResolved({ resolution: 'hash_chair', certificate: {} }), /resolution must be/)
  assert.throws(() => twinDeadlockResolved({ resolution: 'operator' }), /certificate is mandatory/)
  assert.doesNotThrow(() => twinDeadlockResolved({ resolution: 'reversibility_rule', certificate: { c: 1 } }))
})

// ── determinism sweep — byte-identical outputs, and no clock/random primitive in the source ─────────
test('determinism: repeated calls with identical inputs produce byte-identical serializations (broad sweep)', () => {
  const seed = councilSeed({ runToken: 'rt', keystoneId: 'k', divergenceId: 'DV-001', templateHash: 'th', initialSeq: 3 })
  const twice = (fn) => assert.equal(canonicalJson(fn()), canonicalJson(fn()))
  twice(() => councilSeed({ runToken: 'rt', keystoneId: 'k', divergenceId: 'DV-001', templateHash: 'th', initialSeq: 3 }))
  twice(() => freshRoundSchedule({ seed, divergenceId: 'DV-001', tier: 'high' }))
  const dvInput = { seed, findings: [{ id: 'F-1', evidence: { class: 'executed_check' } }], dispositions: [{ finding_id: 'F-1', disposition: 'unresolved' }], decisions: { P0: [{ id: 'D1', topic: 't', value_hash: 'a' }], P1: [{ id: 'D1', topic: 't', value_hash: 'b' }] } }
  twice(() => bds(dvInput))
  twice(() => buildDecisionBundle({ common_trunk: { a: 1 }, open_divergences: [], renderer_version: 'r/1', evidence_manifest_hash: 'eh' }))
  twice(() => councilSignature({ bundle_hash: 'BH', plan_hash: 'PH', protocol_version: COUNCIL_PROTOCOL_VERSION }))
  twice(() => canonicalizeFindings([critA, critB]))
  twice(() => aggregateHead(baseCells('P0'), { tier: 'base' }))
  twice(() => sealReversibility({ P0: 'reversible', P1: 'reversible' }, { P0: 'reversible', P1: 'reversible' }, seed))
  twice(() => buildCheckpoint(cpFields))
})

test('determinism: the module source uses no Date.now / Math.random / new Date primitive (comments aside)', () => {
  const code = COUNCIL_SRC.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  assert.doesNotMatch(code, /Date\.now|Math\.random|new Date/, 'protocol decisions must derive from the SHA-256 seed alone')
})
