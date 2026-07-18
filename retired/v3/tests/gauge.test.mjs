// gauge.test.mjs — unit floor for the Gauge pure core. Every
// mapping rule is hit from BOTH sides of its threshold; ANY-trigger non-compensation is proven;
// the Sentinel ratchet's monotonicity is property-tested — scrutiny only ever rises, no signal on
// any posture lowers a dial, and there is no de-escalation; the shipped gauge-config.json
// round-trips through posture() so no knob is shadowed by a hardcoded default. The table +
// normative block ARE the contract here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { validateProfile, posture, escalate } from '../../plugins/kiln/src/gauge.mjs'

const CONFIG = JSON.parse(readFileSync(new URL('../../plugins/kiln/gauge-config.json', import.meta.url), 'utf8'))

// profile builder: all dims 0 with nonempty evidence, selected dims overridden by score
const prof = (over = {}) => {
  const p = {}
  for (let i = 1; i <= 8; i++) p[`D${i}`] = { score: 0, evidence: `anchor quote for D${i}` }
  for (const [k, v] of Object.entries(over)) p[k] = { score: v, evidence: `anchor quote for ${k}` }
  return p
}

// ── validateProfile ──────────────────────────────────────────────────────────────────────────────
test('validateProfile: a clean 8-dim profile passes', () => {
  assert.deepEqual(validateProfile(prof()), { ok: true, errors: [] })
  assert.deepEqual(validateProfile(prof({ D1: 2, D4: 1, D8: 2 })), { ok: true, errors: [] })
})

test('validateProfile: non-object inputs fail typed as not_object', () => {
  for (const bad of [null, undefined, 'D1', 42, ['D1']]) {
    const out = validateProfile(bad)
    assert.equal(out.ok, false)
    assert.deepEqual(out.errors.map((e) => e.code), ['not_object'])
  }
})

test('validateProfile: a missing dimension is a typed missing_dimension error', () => {
  const p = prof(); delete p.D5
  const out = validateProfile(p)
  assert.equal(out.ok, false)
  assert.deepEqual(out.errors, [{ code: 'missing_dimension', dim: 'D5', message: 'D5 is missing' }])
})

test('validateProfile: scores 0|1|2 pass; 3, -1, 1.5, and the STRING "1" fail as invalid_score', () => {
  for (const ok of [0, 1, 2]) assert.equal(validateProfile(prof({ D3: ok })).ok, true)
  for (const bad of [3, -1, 1.5, '1', null, undefined]) {
    const p = prof(); p.D3 = { score: bad, evidence: 'quote' }
    const out = validateProfile(p)
    assert.equal(out.ok, false)
    assert.deepEqual(out.errors.map((e) => [e.code, e.dim]), [['invalid_score', 'D3']])
  }
})

test('validateProfile: evidence must be a nonempty string — empty, whitespace, missing, non-string fail', () => {
  for (const bad of ['', '   ', undefined, 7]) {
    const p = prof(); p.D7 = { score: 1, evidence: bad }
    const out = validateProfile(p)
    assert.equal(out.ok, false)
    assert.deepEqual(out.errors.map((e) => [e.code, e.dim]), [['missing_evidence', 'D7']])
  }
})

test('validateProfile: a dimension entry that is not { score, evidence } fails as invalid_dimension', () => {
  for (const bad of [null, 2, 'high', [0]]) {
    const p = prof(); p.D2 = bad
    const out = validateProfile(p)
    assert.equal(out.ok, false)
    assert.deepEqual(out.errors.map((e) => [e.code, e.dim]), [['invalid_dimension', 'D2']])
  }
})

test('validateProfile: extra keys are rejected — the profile holds exactly D1..D8', () => {
  const p = prof(); p.reasoning = 'leaked schema field'; p.D9 = { score: 1, evidence: 'q' }
  const out = validateProfile(p)
  assert.equal(out.ok, false)
  assert.deepEqual(out.errors.map((e) => [e.code, e.dim]).sort(), [['unknown_key', 'D9'], ['unknown_key', 'reasoning']])
})

// ── posture: shape pin ───────────────────────────────────────────────────────────────────────────
test('posture: the returned shape is EXACTLY the T1 contract (consistency gate absent — it is a floor)', () => {
  const p = posture(prof(), CONFIG)
  assert.deepEqual(Object.keys(p), [
    'scope_tier', 'research_topics_max', 'planning', 'plan_validation_rounds', 'slice_budget_hours',
    'review', 'milestone_gate', 'browser', 'validate', 'effort_bias',
  ])
  assert.deepEqual(Object.keys(p.review), ['ui_effort_base', 'escalate_on'])
  assert.deepEqual(Object.keys(p.milestone_gate), ['min_slices_for_tribunal', 'goal_backward'])
  assert.deepEqual(Object.keys(p.browser), ['tier2_per_milestone'])
  assert.deepEqual(Object.keys(p.validate), ['adversarial_pass', 'second_family'])
})

// ── posture: research row — cap = base + D3 + D5 ───────────────────────────────────────────
test('posture: research cap is base + D3 + D5 — each dimension moves it, others never do', () => {
  assert.equal(posture(prof(), CONFIG).research_topics_max, 2)
  assert.equal(posture(prof({ D3: 1 }), CONFIG).research_topics_max, 3)
  assert.equal(posture(prof({ D5: 2 }), CONFIG).research_topics_max, 4)
  assert.equal(posture(prof({ D3: 2, D5: 2 }), CONFIG).research_topics_max, 6)
  assert.equal(posture(prof({ D1: 2, D2: 2, D4: 2, D6: 2, D7: 2, D8: 2 }), CONFIG).research_topics_max, 2)
})

// ── posture: planning row — both sides of every trigger ─────────────────────────────────────
test('posture: planning — dual iff D4=2 OR (D3>=1 AND D1>=1)', () => {
  assert.equal(posture(prof({ D4: 2 }), CONFIG).planning, 'dual')             // D4 spike alone
  assert.equal(posture(prof({ D3: 1, D1: 1 }), CONFIG).planning, 'dual')      // conjunct met at 1/1
  assert.equal(posture(prof({ D3: 2, D1: 2 }), CONFIG).planning, 'dual')
  assert.equal(posture(prof({ D3: 1 }), CONFIG).planning, 'single')           // D1=0 — conjunct broken
  assert.equal(posture(prof({ D1: 2 }), CONFIG).planning, 'single')           // D3=0 — conjunct broken
})

test('posture: planning — single+redteam iff D4=1 OR D8>=1 (when dual does not trigger)', () => {
  assert.equal(posture(prof({ D4: 1 }), CONFIG).planning, 'single+redteam')
  assert.equal(posture(prof({ D8: 1 }), CONFIG).planning, 'single+redteam')
  assert.equal(posture(prof({ D8: 2 }), CONFIG).planning, 'single+redteam')
  assert.equal(posture(prof(), CONFIG).planning, 'single')                    // all-zero floor
})

test('posture: ANY-trigger non-compensation — D4=2 ALONE forces dual-plan despite seven zeros', () => {
  const p = prof({ D4: 2 }) // every other dimension is 0 — no average can dilute the spike
  assert.equal(posture(p, CONFIG).planning, 'dual')
})

// ── posture: plan-validation row — rounds = 1 + (D2>=1) + (D8=2) ───────────────────────────
test('posture: plan_validation_rounds — D2 adds at >=1, D8 adds only at 2', () => {
  assert.equal(posture(prof(), CONFIG).plan_validation_rounds, 1)
  assert.equal(posture(prof({ D2: 1 }), CONFIG).plan_validation_rounds, 2)
  assert.equal(posture(prof({ D2: 2 }), CONFIG).plan_validation_rounds, 2)    // ordinal, not additive
  assert.equal(posture(prof({ D8: 1 }), CONFIG).plan_validation_rounds, 1)    // below the D8 threshold
  assert.equal(posture(prof({ D8: 2 }), CONFIG).plan_validation_rounds, 2)
  assert.equal(posture(prof({ D2: 2, D8: 2 }), CONFIG).plan_validation_rounds, 3)
})

// ── posture: slice-budget row — h80 x discount, halved when D7>=1 ───────────────────────────
test('posture: slice_budget_hours — 2 x 0.5 = 1h baseline, halved to 0.5h when D7>=1', () => {
  assert.equal(posture(prof(), CONFIG).slice_budget_hours, 1)
  assert.equal(posture(prof({ D7: 1 }), CONFIG).slice_budget_hours, 0.5)
  assert.equal(posture(prof({ D7: 2 }), CONFIG).slice_budget_hours, 0.5)
})

// ── posture: slice-review row — ui effort medium baseline, high iff D8>=1 ───────────────────
test('posture: review — ui_effort_base flips medium->high at D8>=1; escalate_on names fix_cycle', () => {
  assert.deepEqual(posture(prof(), CONFIG).review, { ui_effort_base: 'medium', escalate_on: 'fix_cycle' })
  assert.equal(posture(prof({ D8: 1 }), CONFIG).review.ui_effort_base, 'high')
  assert.equal(posture(prof({ D8: 2 }), CONFIG).review.ui_effort_base, 'high')
})

// ── posture: milestone-gate row + the trivial bump ─────────────────────────────────────
test('posture: milestone_gate — goal-backward ALWAYS true; tribunal threshold 3 at trivial tier, 2 at standard', () => {
  // trivial (all-zero profile): the bump raises the threshold 2->3; goal-backward untouched
  assert.deepEqual(posture(prof(), CONFIG).milestone_gate, { min_slices_for_tribunal: 3, goal_backward: true })
  // the soft dimension at 1 stays trivial => still the bumped 3
  assert.deepEqual(posture(prof({ D6: 1 }), CONFIG).milestone_gate, { min_slices_for_tribunal: 3, goal_backward: true })
  // any elevated NON-soft dimension => standard => the table's 2
  assert.deepEqual(posture(prof({ D1: 1 }), CONFIG).milestone_gate, { min_slices_for_tribunal: 2, goal_backward: true })
  assert.deepEqual(posture(prof({ D1: 2, D2: 2, D3: 2, D4: 2, D5: 2, D6: 2, D7: 2, D8: 2 }), CONFIG).milestone_gate, { min_slices_for_tribunal: 2, goal_backward: true })
  // the bump is a config knob
  assert.equal(posture(prof(), { ...CONFIG, tribunal_threshold_trivial_bump: 2 }).milestone_gate.min_slices_for_tribunal, 4)
})

// ── posture: the scope-tier predicate (the trivial-tier levers key on THIS, never effort) ───
test('posture: scope_tier — soft-dims predicate: D6 may sit at 1, everything else at 0', () => {
  assert.equal(posture(prof(), CONFIG).scope_tier, 'trivial')
  // the bench-a field profile: D6=1 alone (any persistent store) => TRIVIAL — the canonical case
  assert.equal(posture(prof({ D6: 1 }), CONFIG).scope_tier, 'trivial')
  // the soft ceiling is 1: migrations/concurrency-grade state (D6=2) is never trivial
  assert.equal(posture(prof({ D6: 2 }), CONFIG).scope_tier, 'standard')
  // every NON-soft dimension at 1 reads standard — seven, one by one (D4/D8 structurally banned)
  for (const d of ['D1', 'D2', 'D3', 'D4', 'D5', 'D7', 'D8']) {
    assert.equal(posture(prof({ [d]: 1 }), CONFIG).scope_tier, 'standard', `${d}=1 must read standard`)
  }
  // the r1 catch: a high-dims/effort-0 profile is NOT trivial (effort_bias is a reasoning dial)
  const highDims = posture(prof({ D1: 2, D2: 2, D5: 2, D6: 2, D7: 2 }), CONFIG)
  assert.equal(highDims.effort_bias, 0)
  assert.equal(highDims.scope_tier, 'standard')
  // Run B's field profile => standard (three non-soft dims elevated)
  assert.equal(posture(prof({ D1: 1, D2: 1, D6: 1, D7: 1 }), CONFIG).scope_tier, 'standard')
  // both knobs are config: widening the soft set admits a new benign dim; raising dim_max widens all
  assert.equal(posture(prof({ D3: 1, D6: 1 }), { ...CONFIG, trivial_tier_soft_dims: ['D3', 'D6'] }).scope_tier, 'trivial')
  assert.equal(posture(prof({ D1: 1, D2: 1, D6: 1, D7: 1 }), { ...CONFIG, trivial_tier_dim_max: 1 }).scope_tier, 'trivial')
})

// ── posture: browser row — tier2 iff D7>=1 OR D8>=1 ─────────────────────────────────────────
test('posture: browser.tier2_per_milestone — off at D7=0,D8=0; either dimension at 1 turns it on', () => {
  assert.equal(posture(prof(), CONFIG).browser.tier2_per_milestone, false)
  assert.equal(posture(prof({ D7: 1 }), CONFIG).browser.tier2_per_milestone, true)
  assert.equal(posture(prof({ D8: 1 }), CONFIG).browser.tier2_per_milestone, true)
  assert.equal(posture(prof({ D7: 2, D8: 2 }), CONFIG).browser.tier2_per_milestone, true)
})

// ── posture: validate row — adversarial + second family only at D8=2 ────────────────────────
test('posture: validate — D8=1 stays floor-only; D8=2 switches on adversarial pass AND second family', () => {
  assert.deepEqual(posture(prof({ D8: 1 }), CONFIG).validate, { adversarial_pass: false, second_family: false })
  assert.deepEqual(posture(prof({ D8: 2 }), CONFIG).validate, { adversarial_pass: true, second_family: true })
})

// ── posture: model/effort row — effort_bias = max(D3, D4, D8) ───────────────────────────────
test('posture: effort_bias is max(D3,D4,D8) — non-compensatory, other dimensions never move it', () => {
  assert.equal(posture(prof(), CONFIG).effort_bias, 0)
  assert.equal(posture(prof({ D4: 1 }), CONFIG).effort_bias, 1)
  assert.equal(posture(prof({ D3: 1, D4: 2, D8: 0 }), CONFIG).effort_bias, 2)
  assert.equal(posture(prof({ D8: 2 }), CONFIG).effort_bias, 2)
  assert.equal(posture(prof({ D1: 2, D2: 2, D5: 2, D6: 2, D7: 2 }), CONFIG).effort_bias, 0)
})

// ── escalate: threshold semantics (signal 1, the master signal) ─────────────────────────────
test('escalate: logical rejections — below threshold no-op, at 2 escalate_feedback_source, at 3 split_and_rebuild', () => {
  const base = posture(prof(), CONFIG)
  const r1 = escalate(base, { type: 'review_rejection', finding_class: 'logical', rejections: 1 }, CONFIG)
  assert.equal(r1.reason.action, 'none')
  assert.deepEqual(r1.reason.changes, [])
  assert.deepEqual(r1.posture, base)
  const r2 = escalate(base, { type: 'review_rejection', finding_class: 'logical', rejections: 2 }, CONFIG)
  assert.equal(r2.reason.action, 'escalate_feedback_source')
  assert.equal(r2.posture.review.ui_effort_base, 'high')
  const r3 = escalate(base, { type: 'review_rejection', finding_class: 'logical', rejections: 3 }, CONFIG)
  assert.equal(r3.reason.action, 'split_and_rebuild')
  assert.equal(r3.posture.review.ui_effort_base, 'high')
  assert.equal(r3.posture.effort_bias, 1)
})

test('escalate: MECHANICAL rejections never move the ratchet, at any count', () => {
  const base = posture(prof(), CONFIG)
  const out = escalate(base, { type: 'review_rejection', finding_class: 'mechanical', rejections: 5 }, CONFIG)
  assert.equal(out.reason.action, 'none')
  assert.deepEqual(out.posture, base)
})

test('escalate: test churn — 1 flip is noise, churn_flips_threshold (2) flips raise scrutiny', () => {
  const base = posture(prof(), CONFIG)
  assert.equal(escalate(base, { type: 'test_churn', flips: 1 }, CONFIG).reason.action, 'none')
  const hot = escalate(base, { type: 'test_churn', flips: 2 }, CONFIG)
  assert.equal(hot.reason.action, 'raise_scrutiny')
  assert.equal(hot.posture.review.ui_effort_base, 'high')
  assert.equal(hot.posture.effort_bias, 1)
})

test('escalate: builder self-confidence may only RAISE scrutiny — low raises, high is a no-op', () => {
  const base = posture(prof(), CONFIG)
  const low = escalate(base, { type: 'builder_confidence', level: 'low' }, CONFIG)
  assert.equal(low.posture.review.ui_effort_base, 'high')
  const high = escalate(low.posture, { type: 'builder_confidence', level: 'high' }, CONFIG)
  assert.equal(high.reason.action, 'none')
  assert.deepEqual(high.posture, low.posture) // confidence never lowers a dial
})

test('escalate: validate_coverage_gap retroactively raises tier2 + adversarial + bias', () => {
  const base = posture(prof(), CONFIG)
  const out = escalate(base, { type: 'validate_coverage_gap' }, CONFIG)
  assert.equal(out.posture.browser.tier2_per_milestone, true)
  assert.equal(out.posture.validate.adversarial_pass, true)
  assert.equal(out.posture.effort_bias, 1)
})

test('escalate: unknown or malformed signals are a recorded no-op, never a throw', () => {
  const base = posture(prof(), CONFIG)
  for (const sig of [{ type: 'mystery' }, {}, null, undefined]) {
    const out = escalate(base, sig, CONFIG)
    assert.equal(out.reason.action, 'none')
    assert.equal(out.reason.signal, (sig && sig.type) || 'unknown')
    assert.deepEqual(out.posture, base)
  }
})

test('escalate: reason is ledger-ready — event name, signal, action, and from/to per changed dial', () => {
  const base = posture(prof(), CONFIG)
  const out = escalate(base, { type: 'diff_size_exceeded' }, CONFIG)
  assert.equal(out.reason.event, 'posture_escalate')
  assert.deepEqual(out.reason.changes, [{ dial: 'review.ui_effort_base', from: 'medium', to: 'high' }])
})

// ── escalate: the monotonicity PROPERTY — no signal, on no posture, ever lowers a dial ───────────
const EFFORT_RANK = { medium: 1, high: 2 }
const dialRanks = (p) => [
  EFFORT_RANK[p.review.ui_effort_base],
  p.effort_bias,
  p.browser.tier2_per_milestone ? 1 : 0,
  p.validate.adversarial_pass ? 1 : 0,
  p.validate.second_family ? 1 : 0,
]
const ALL_SIGNALS = [
  { type: 'review_rejection', finding_class: 'logical', rejections: 1 },
  { type: 'review_rejection', finding_class: 'logical', rejections: 2 },
  { type: 'review_rejection', finding_class: 'logical', rejections: 3 },
  { type: 'review_rejection', finding_class: 'mechanical', rejections: 9 },
  { type: 'test_churn', flips: 1 },
  { type: 'test_churn', flips: 2 },
  { type: 'diff_size_exceeded' },
  { type: 'slice_growth' },
  { type: 'analyst_disagreement' },
  { type: 'validate_coverage_gap' },
  { type: 'builder_confidence', level: 'low' },
  { type: 'builder_confidence', level: 'high' },
  { type: 'mystery' },
  null,
]

test('escalate: monotonic over every signal type on both calm and maxed postures', () => {
  const calm = posture(prof(), CONFIG)
  const maxed = posture(prof({ D1: 2, D2: 2, D3: 2, D4: 2, D5: 2, D6: 2, D7: 2, D8: 2 }), CONFIG)
  for (const start of [calm, maxed]) {
    for (const sig of ALL_SIGNALS) {
      const before = dialRanks(start)
      const out = escalate(start, sig, CONFIG)
      const after = dialRanks(out.posture)
      for (let i = 0; i < before.length; i++) {
        assert.ok(after[i] >= before[i], `signal ${JSON.stringify(sig)} lowered dial index ${i}`)
      }
    }
  }
})

test('escalate: effort_bias is capped at 2 and plan-time dials never move at runtime', () => {
  const maxed = posture(prof({ D3: 2, D4: 2, D8: 2 }), CONFIG)
  for (const sig of ALL_SIGNALS) {
    const out = escalate(maxed, sig, CONFIG)
    assert.equal(out.posture.effort_bias, 2) // already at ceiling — never exceeds it
    assert.equal(out.posture.planning, maxed.planning)
    assert.equal(out.posture.plan_validation_rounds, maxed.plan_validation_rounds)
    assert.equal(out.posture.slice_budget_hours, maxed.slice_budget_hours)
    assert.equal(out.posture.research_topics_max, maxed.research_topics_max)
    assert.deepEqual(out.posture.milestone_gate, maxed.milestone_gate)
  }
})

// ── gauge-config.json: the normative block round-trips through the mapping ──────────────────
test('gauge-config.json: every normative constant ships at its normative value', () => {
  const normative = {
    h80_human_hours: 2, messiness_discount: 0.5, churn_flips_threshold: 2,
    rejections_to_feedback_escalation: 2, rejections_to_split: 3,
  }
  for (const [k, v] of Object.entries(normative)) assert.equal(CONFIG[k], v, k)
  // the mapping thresholds live in the same ONE file, at the table's default values
  const mapping = {
    research_topics_base: 2,
    planning_dual_d4_min: 2, planning_dual_d3_min: 1, planning_dual_d1_min: 1,
    planning_redteam_d4_min: 1, planning_redteam_d8_min: 1,
    plan_validation_rounds_base: 1, plan_validation_d2_min: 1, plan_validation_d8_min: 2,
    slice_budget_d7_min: 1, d7_slice_budget_factor: 0.5,
    review_high_d8_min: 1, min_slices_for_tribunal: 2,
    trivial_tier_dim_max: 0, tribunal_threshold_trivial_bump: 1, trivial_tier_soft_dim_max: 1,
    browser_tier2_d7_min: 1, browser_tier2_d8_min: 1,
    validate_adversarial_d8_min: 2, validate_second_family_d8_min: 2,
  }
  for (const [k, v] of Object.entries(mapping)) assert.equal(CONFIG[k], v, k)
  assert.deepEqual(CONFIG.effort_bias_dims, ['D3', 'D4', 'D8'])
  assert.deepEqual(CONFIG.trivial_tier_soft_dims, ['D6'])
})

test('gauge-config.json: every functional key carries a sibling _doc_ comment key', () => {
  const fn = Object.keys(CONFIG).filter((k) => !k.startsWith('_doc'))
  for (const k of fn) assert.equal(typeof CONFIG[`_doc_${k}`], 'string', `_doc_${k}`)
})

test('gauge-config.json: knobs are LIVE — changing a config value changes the posture (no shadowing)', () => {
  const p = prof({ D7: 1 })
  const tweaked = { ...CONFIG, research_topics_base: 5, plan_validation_rounds_base: 2, min_slices_for_tribunal: 3, h80_human_hours: 4, messiness_discount: 1, d7_slice_budget_factor: 0.25 }
  const out = posture(p, tweaked)
  assert.equal(out.research_topics_max, 5)
  assert.equal(out.plan_validation_rounds, 2)
  assert.equal(out.milestone_gate.min_slices_for_tribunal, 3)
  assert.equal(out.slice_budget_hours, 1) // 4 x 1 x 0.25
})

test('gauge-config.json: mapping THRESHOLD knobs are LIVE — moving each one flips its rule vs the default', () => {
  // each case tweaks exactly ONE threshold; the asserted posture differs from the shipped-config
  // outcome for the same profile (proving the comparison reads config, not a hardcoded value)
  assert.equal(posture(prof({ D4: 1 }), { ...CONFIG, planning_dual_d4_min: 1 }).planning, 'dual')
  assert.equal(posture(prof({ D3: 1, D1: 1 }), { ...CONFIG, planning_dual_d3_min: 2 }).planning, 'single')
  assert.equal(posture(prof({ D3: 1, D1: 1 }), { ...CONFIG, planning_dual_d1_min: 2 }).planning, 'single')
  assert.equal(posture(prof({ D4: 1 }), { ...CONFIG, planning_redteam_d4_min: 2 }).planning, 'single')
  assert.equal(posture(prof({ D8: 1 }), { ...CONFIG, planning_redteam_d8_min: 2 }).planning, 'single')
  assert.equal(posture(prof({ D2: 1 }), { ...CONFIG, plan_validation_d2_min: 2 }).plan_validation_rounds, 1)
  assert.equal(posture(prof({ D8: 1 }), { ...CONFIG, plan_validation_d8_min: 1 }).plan_validation_rounds, 2)
  assert.equal(posture(prof({ D7: 1 }), { ...CONFIG, slice_budget_d7_min: 2 }).slice_budget_hours, 1) // full budget kept
  assert.equal(posture(prof({ D8: 1 }), { ...CONFIG, review_high_d8_min: 2 }).review.ui_effort_base, 'medium')
  assert.equal(posture(prof({ D7: 1 }), { ...CONFIG, browser_tier2_d7_min: 2 }).browser.tier2_per_milestone, false)
  assert.equal(posture(prof({ D8: 1 }), { ...CONFIG, browser_tier2_d8_min: 2 }).browser.tier2_per_milestone, false)
  assert.equal(posture(prof({ D8: 1 }), { ...CONFIG, validate_adversarial_d8_min: 1 }).validate.adversarial_pass, true)
  assert.equal(posture(prof({ D8: 1 }), { ...CONFIG, validate_second_family_d8_min: 1 }).validate.second_family, true)
  assert.equal(posture(prof({ D6: 2 }), { ...CONFIG, effort_bias_dims: ['D6'] }).effort_bias, 2)
})
