// gauge.test.mjs — unit floor for the Gauge pure core (BLUEPRINT §3, task T1). Every §3.2
// mapping rule is hit from BOTH sides of its threshold; ANY-trigger non-compensation is proven;
// the Sentinel ratchet's monotonicity and the boundary-only de-escalation are property-tested;
// the shipped gauge-config.json round-trips through posture() so no knob is shadowed by a
// hardcoded default. The §3.2 table + §3.3 normative block ARE the contract here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { validateProfile, posture, escalate, deescalate } from '../../plugins/kiln/src/gauge.mjs'

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
    'research_topics_max', 'planning', 'plan_validation_rounds', 'slice_budget_hours',
    'review', 'milestone_gate', 'browser', 'validate', 'effort_bias',
  ])
  assert.deepEqual(Object.keys(p.review), ['ui_effort_base', 'escalate_on'])
  assert.deepEqual(Object.keys(p.milestone_gate), ['min_slices_for_tribunal', 'goal_backward'])
  assert.deepEqual(Object.keys(p.browser), ['tier2_per_milestone'])
  assert.deepEqual(Object.keys(p.validate), ['adversarial_pass', 'second_family'])
})

// ── posture: §3.2 research row — cap = base + D3 + D5 ───────────────────────────────────────────
test('posture: research cap is base + D3 + D5 — each dimension moves it, others never do', () => {
  assert.equal(posture(prof(), CONFIG).research_topics_max, 2)
  assert.equal(posture(prof({ D3: 1 }), CONFIG).research_topics_max, 3)
  assert.equal(posture(prof({ D5: 2 }), CONFIG).research_topics_max, 4)
  assert.equal(posture(prof({ D3: 2, D5: 2 }), CONFIG).research_topics_max, 6)
  assert.equal(posture(prof({ D1: 2, D2: 2, D4: 2, D6: 2, D7: 2, D8: 2 }), CONFIG).research_topics_max, 2)
})

// ── posture: §3.2 planning row — both sides of every trigger ─────────────────────────────────────
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

// ── posture: §3.2 plan-validation row — rounds = 1 + (D2>=1) + (D8=2) ───────────────────────────
test('posture: plan_validation_rounds — D2 adds at >=1, D8 adds only at 2', () => {
  assert.equal(posture(prof(), CONFIG).plan_validation_rounds, 1)
  assert.equal(posture(prof({ D2: 1 }), CONFIG).plan_validation_rounds, 2)
  assert.equal(posture(prof({ D2: 2 }), CONFIG).plan_validation_rounds, 2)    // ordinal, not additive
  assert.equal(posture(prof({ D8: 1 }), CONFIG).plan_validation_rounds, 1)    // below the D8 threshold
  assert.equal(posture(prof({ D8: 2 }), CONFIG).plan_validation_rounds, 2)
  assert.equal(posture(prof({ D2: 2, D8: 2 }), CONFIG).plan_validation_rounds, 3)
})

// ── posture: §3.2 slice-budget row — h80 x discount, halved when D7>=1 ───────────────────────────
test('posture: slice_budget_hours — 2 x 0.5 = 1h baseline, halved to 0.5h when D7>=1', () => {
  assert.equal(posture(prof(), CONFIG).slice_budget_hours, 1)
  assert.equal(posture(prof({ D7: 1 }), CONFIG).slice_budget_hours, 0.5)
  assert.equal(posture(prof({ D7: 2 }), CONFIG).slice_budget_hours, 0.5)
})

// ── posture: §3.2 slice-review row — ui effort medium baseline, high iff D8>=1 ───────────────────
test('posture: review — ui_effort_base flips medium->high at D8>=1; escalate_on names fix_cycle', () => {
  assert.deepEqual(posture(prof(), CONFIG).review, { ui_effort_base: 'medium', escalate_on: 'fix_cycle' })
  assert.equal(posture(prof({ D8: 1 }), CONFIG).review.ui_effort_base, 'high')
  assert.equal(posture(prof({ D8: 2 }), CONFIG).review.ui_effort_base, 'high')
})

// ── posture: §3.2 milestone-gate row — constants, any posture ────────────────────────────────────
test('posture: milestone_gate — goal-backward always true, tribunal at >=2 slices, profile-independent', () => {
  const expected = { min_slices_for_tribunal: 2, goal_backward: true }
  assert.deepEqual(posture(prof(), CONFIG).milestone_gate, expected)
  assert.deepEqual(posture(prof({ D1: 2, D2: 2, D3: 2, D4: 2, D5: 2, D6: 2, D7: 2, D8: 2 }), CONFIG).milestone_gate, expected)
})

// ── posture: §3.2 browser row — tier2 iff D7>=1 OR D8>=1 ─────────────────────────────────────────
test('posture: browser.tier2_per_milestone — off at D7=0,D8=0; either dimension at 1 turns it on', () => {
  assert.equal(posture(prof(), CONFIG).browser.tier2_per_milestone, false)
  assert.equal(posture(prof({ D7: 1 }), CONFIG).browser.tier2_per_milestone, true)
  assert.equal(posture(prof({ D8: 1 }), CONFIG).browser.tier2_per_milestone, true)
  assert.equal(posture(prof({ D7: 2, D8: 2 }), CONFIG).browser.tier2_per_milestone, true)
})

// ── posture: §3.2 validate row — adversarial + second family only at D8=2 ────────────────────────
test('posture: validate — D8=1 stays floor-only; D8=2 switches on adversarial pass AND second family', () => {
  assert.deepEqual(posture(prof({ D8: 1 }), CONFIG).validate, { adversarial_pass: false, second_family: false })
  assert.deepEqual(posture(prof({ D8: 2 }), CONFIG).validate, { adversarial_pass: true, second_family: true })
})

// ── posture: §3.2 model/effort row — effort_bias = max(D3, D4, D8) ───────────────────────────────
test('posture: effort_bias is max(D3,D4,D8) — non-compensatory, other dimensions never move it', () => {
  assert.equal(posture(prof(), CONFIG).effort_bias, 0)
  assert.equal(posture(prof({ D4: 1 }), CONFIG).effort_bias, 1)
  assert.equal(posture(prof({ D3: 1, D4: 2, D8: 0 }), CONFIG).effort_bias, 2)
  assert.equal(posture(prof({ D8: 2 }), CONFIG).effort_bias, 2)
  assert.equal(posture(prof({ D1: 2, D2: 2, D5: 2, D6: 2, D7: 2 }), CONFIG).effort_bias, 0)
})

// ── escalate: threshold semantics (§3.3 signal 1, the master signal) ─────────────────────────────
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

// ── deescalate: boundary-only, baseline-exact, never below ───────────────────────────────────────
const CLEAN = { rejections: 0, first_pass_green: true }

test('deescalate: a clean unit restores the recomputed Gauge baseline EXACTLY', () => {
  const profile = prof({ D8: 1 }) // baseline already carries review=high — restore must keep it
  const baseline = posture(profile, CONFIG)
  let cur = escalate(baseline, { type: 'validate_coverage_gap' }, CONFIG).posture
  cur = escalate(cur, { type: 'slice_growth' }, CONFIG).posture
  const out = deescalate(cur, { profile, ...CLEAN }, CONFIG)
  assert.equal(out.reason.event, 'posture_deescalate')
  assert.deepEqual(out.posture, baseline)
  // the ledger records exactly the dials that came back down — tier2 is absent because D8=1
  // already had it on at BASELINE (the gap signal's raise was a no-op there, never re-lowered)
  assert.deepEqual(out.reason.changes.map((c) => c.dial).sort(), ['effort_bias', 'validate.adversarial_pass'])
})

test('deescalate: a dirty unit holds the escalated posture — rejections>0 or a non-first-pass gate', () => {
  const profile = prof()
  const cur = escalate(posture(profile, CONFIG), { type: 'analyst_disagreement' }, CONFIG).posture
  for (const outcome of [
    { profile, rejections: 1, first_pass_green: true },
    { profile, rejections: 0, first_pass_green: false },
  ]) {
    const out = deescalate(cur, outcome, CONFIG)
    assert.equal(out.reason.event, 'posture_hold')
    assert.deepEqual(out.posture, cur)
    assert.deepEqual(out.reason.changes, [])
  }
})

test('deescalate: never below baseline — de-escalating an unescalated posture is an exact no-op', () => {
  const profile = prof({ D7: 1, D8: 2 })
  const baseline = posture(profile, CONFIG)
  const out = deescalate(baseline, { profile, ...CLEAN }, CONFIG)
  assert.deepEqual(out.posture, baseline)
  assert.deepEqual(out.reason.changes, [])
})

test('deescalate: clean_streak must reach deescalation_clean_window before the reset fires', () => {
  const profile = prof()
  const wide = { ...CONFIG, deescalation_clean_window: 2 }
  const cur = escalate(posture(profile, wide), { type: 'diff_size_exceeded' }, wide).posture
  const held = deescalate(cur, { profile, ...CLEAN, clean_streak: 1 }, wide)
  assert.equal(held.reason.event, 'posture_hold')
  assert.deepEqual(held.posture, cur)
  const reset = deescalate(cur, { profile, ...CLEAN, clean_streak: 2 }, wide)
  assert.equal(reset.reason.event, 'posture_deescalate')
  assert.deepEqual(reset.posture, posture(profile, wide))
})

// ── gauge-config.json: the §3.3 normative block round-trips through the mapping ──────────────────
test('gauge-config.json: every §3.3 normative constant ships at its normative value', () => {
  const normative = {
    h80_human_hours: 2, messiness_discount: 0.5, churn_flips_threshold: 2,
    rejections_to_feedback_escalation: 2, rejections_to_split: 3, deescalation_clean_window: 1,
  }
  for (const [k, v] of Object.entries(normative)) assert.equal(CONFIG[k], v, k)
  // the §3.2 mapping thresholds live in the same ONE file, at the table's default values
  const mapping = {
    research_topics_base: 2,
    planning_dual_d4_min: 2, planning_dual_d3_min: 1, planning_dual_d1_min: 1,
    planning_redteam_d4_min: 1, planning_redteam_d8_min: 1,
    plan_validation_rounds_base: 1, plan_validation_d2_min: 1, plan_validation_d8_min: 2,
    slice_budget_d7_min: 1, d7_slice_budget_factor: 0.5,
    review_high_d8_min: 1, min_slices_for_tribunal: 2,
    browser_tier2_d7_min: 1, browser_tier2_d8_min: 1,
    validate_adversarial_d8_min: 2, validate_second_family_d8_min: 2,
  }
  for (const [k, v] of Object.entries(mapping)) assert.equal(CONFIG[k], v, k)
  assert.deepEqual(CONFIG.effort_bias_dims, ['D3', 'D4', 'D8'])
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
  // outcome for the same profile (proving the comparison reads config, not a hardcoded §3.2 value)
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
