// gauge.mjs — THE GAUGE pure core (BLUEPRINT §3): profile validation, the deterministic
// non-compensatory posture mapping, and the Sentinel ratchet (escalate / de-escalate).
// validateProfile + posture are inlined into gauge.js by scripts/bundle-workflows.mjs
// (// @inline:gauge:validateProfile,posture). Pure functions only: no I/O, no
// Date.now/Math.random. Every threshold arrives via the config param — the parsed
// plugins/kiln/gauge-config.json — never hardcoded here.
//
// Bundler discipline: each export is a self-contained block (no shared module-level helpers —
// they would not survive inlining). ONE exception: deescalate calls posture to recompute the
// baseline; any future @inline of deescalate must inline posture alongside it.

// validateProfile(profile) — the 8-dimension profile contract (BLUEPRINT §3.1): keys D1..D8,
// each { score: 0|1|2, evidence: nonempty string }. Returns { ok, errors } with typed errors
// ({ code, dim, message }) so the gauge workflow can re-ask Alpha with precise corrections.
export function validateProfile(profile) {
  // codes: not_object | unknown_key | missing_dimension | invalid_dimension | invalid_score | missing_evidence
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { ok: false, errors: [{ code: 'not_object', dim: null, message: 'profile must be an object keyed D1..D8' }] }
  }
  const DIMS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']
  const errors = []
  for (const k of Object.keys(profile)) {
    // strict: schema-forced output must hand over a CLEAN profile (reasoning lives outside it)
    if (!DIMS.includes(k)) errors.push({ code: 'unknown_key', dim: k, message: `unknown key '${k}' — the profile holds exactly D1..D8` })
  }
  for (const d of DIMS) {
    const e = profile[d]
    if (e === undefined) { errors.push({ code: 'missing_dimension', dim: d, message: `${d} is missing` }); continue }
    if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push({ code: 'invalid_dimension', dim: d, message: `${d} must be { score, evidence }` }); continue }
    // score is the NUMBER 0|1|2 — '1', 1.5, -1, 3 all fail; ordinals never arrive as strings
    if (![0, 1, 2].includes(e.score)) errors.push({ code: 'invalid_score', dim: d, message: `${d}.score must be 0, 1 or 2 (got ${JSON.stringify(e.score)})` })
    // the mandatory one-line evidence quote (counters anchoring on the vision's self-framing)
    if (typeof e.evidence !== 'string' || e.evidence.trim() === '') errors.push({ code: 'missing_evidence', dim: d, message: `${d}.evidence must be a nonempty quote from VISION/codebase-map` })
  }
  return { ok: errors.length === 0, errors }
}

// posture(profile, config) — the deterministic, NON-COMPENSATORY §3.2 mapping. ANY-trigger
// logic: a single dimension spike flips a mechanism on; a scalar average would mask it
// [R:complexity-assessment §6]. Runs in workflow JS, never in an agent. Expects a
// validateProfile-clean profile (the workflow enforces that first). Every dimension threshold
// is a config min-threshold (fires at score >= value): on the 0|1|2 ordinal domain '>= 2' IS
// the table's '=2', and a lowered override behaves sanely (the rule fires earlier).
export function posture(profile, config) {
  const D = (k) => profile[k].score
  // P5.5 scope-tier predicate: trivial iff EVERY dimension <= trivial_tier_dim_max (default 0).
  // Non-compensatory like everything else here — and deliberately NOT the effort dial:
  // effort_bias is max(D3,D4,D8), a reasoning dial, so a large/ambiguous/stateful profile
  // (D1:2,D2:2,D5:2,D6:2,D7:2) still dials effort 0 while being nothing like trivial scope.
  const scope_tier = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'].every((k) => D(k) <= config.trivial_tier_dim_max) ? 'trivial' : 'standard'
  return {
    // P5.5: the tier the trivial-tier levers key on (slice consolidation, runner seat,
    // tribunal bump) — never re-derived inline in workflow code.
    scope_tier,
    // §3.2 research row — the CAP only: base + D3 (novelty) + D5 (integration surface). The
    // research stage applies min(OQ-count, cap) and drops to 0 when no high-priority
    // before-build OQs exist — OQ data is runtime input, not a profile dimension.
    research_topics_max: config.research_topics_base + D('D3') + D('D5'),
    // §3.2 planning row — dual-plan + chairman iff D4=2 OR (D3>=1 AND D1>=1); else single plan
    // + cross-family red-team critique iff D4=1 OR D8>=1; else a single, self-checked plan.
    // The red-team D4 check runs only after dual declined, so '>= 1' is exactly the table's '=1'.
    planning: (D('D4') >= config.planning_dual_d4_min || (D('D3') >= config.planning_dual_d3_min && D('D1') >= config.planning_dual_d1_min)) ? 'dual'
      : (D('D4') >= config.planning_redteam_d4_min || D('D8') >= config.planning_redteam_d8_min) ? 'single+redteam'
        : 'single',
    // §3.2 plan-validation row — rounds = base + 1 when ambiguity present (D2>=1) + 1 at
    // maximum failure penalty (D8=2).
    plan_validation_rounds: config.plan_validation_rounds_base
      + (D('D2') >= config.plan_validation_d2_min ? 1 : 0)
      + (D('D8') >= config.plan_validation_d8_min ? 1 : 0),
    // §3.2 slice-budget row (§3.3 definition) — horizon-anchored: h80_human_hours x
    // messiness_discount human-equivalent per slice, x d7_slice_budget_factor (halved) when
    // verifiability is weak (D7>=1).
    slice_budget_hours: config.h80_human_hours * config.messiness_discount * (D('D7') >= config.slice_budget_d7_min ? config.d7_slice_budget_factor : 1),
    // §3.2 slice-review row — logic slices are ALWAYS cross-family on evidence (a floor, not a
    // dial; nothing to encode). ui: Tier-1 probe always; codex review effort 'high' iff D8>=1,
    // else 'medium' baseline. escalate_on names the runtime trigger that raises a 'medium'
    // review to 'high' (fix-cycle > 0) — build.js keys on posture, not on a hardcoded rule.
    review: { ui_effort_base: D('D8') >= config.review_high_d8_min ? 'high' : 'medium', escalate_on: 'fix_cycle' },
    // §3.2 milestone-gate row — the goal-backward audit runs at EVERY milestone boundary
    // regardless of slice count; the dual-analyst tribunal only when the milestone has >=
    // min_slices_for_tribunal slices (single-slice: slice review + goal-backward IS the gate).
    // P5.5: at trivial tier the threshold gains tribunal_threshold_trivial_bump (2->3 at
    // defaults) — Run A's tribunal was marginal at trivial scope; goal_backward never moves.
    milestone_gate: { min_slices_for_tribunal: config.min_slices_for_tribunal + (scope_tier === 'trivial' ? config.tribunal_threshold_trivial_bump : 0), goal_backward: true },
    // §3.2 browser row — Tier-2 traversal per ui milestone iff D7>=1 OR D8>=1; else matrix-only.
    browser: { tier2_per_milestone: D('D7') >= config.browser_tier2_d7_min || D('D8') >= config.browser_tier2_d8_min },
    // §3.2 validate row — the validate floor always runs (§3.4); the adversarial probe pass and
    // a second validator family both switch on only at maximum failure penalty (D8=2).
    validate: { adversarial_pass: D('D8') >= config.validate_adversarial_d8_min, second_family: D('D8') >= config.validate_second_family_d8_min },
    // §3.2 model/effort row — the effort dial scales with max over effort_bias_dims (default
    // D3, D4, D8) per call class (§8).
    effort_bias: Math.max(...config.effort_bias_dims.map(D)),
    // §3.2 consistency-gate row (Aristotle) is deliberately ABSENT: it always runs (a floor,
    // §3.4) — adaptivity only modulates above the floor.
  }
}

// escalate(posture, signal, config) — the Sentinel ratchet (BLUEPRINT §3.3): runtime signals
// RAISE posture dials within a slice/milestone unit; nothing here ever lowers one (monotonic —
// de-escalation is a separate, boundary-only move). Returns { posture, reason } with a
// ledger-ready reason (drops straight into an events.jsonl `data` field). Plan-time dials
// (research_topics_max, planning, plan_validation_rounds, slice_budget_hours, milestone_gate)
// never move at runtime — only the dials governing work still ahead: review effort, browser
// Tier-2, validate passes, effort_bias.
export function escalate(posture, signal, config) {
  // §3.3 signal shapes, ranked by evidence strength:
  //   { type: 'review_rejection', finding_class: 'logical'|'mechanical', rejections: n }
  //     the master signal; escalation keys on LOGICAL findings only. At
  //     rejections_to_feedback_escalation: escalate the FEEDBACK SOURCE (stronger or
  //     different-family reviewer), not the retry count. At rejections_to_split:
  //     split-and-rebuild (genesis 3.4).
  //   { type: 'test_churn', flips: n }      — same check flipping pass<->fail across fix cycles
  //   { type: 'diff_size_exceeded' }        — diff size beyond the slicer estimate
  //   { type: 'slice_growth' }              — slice count grows beyond the estimate
  //   { type: 'analyst_disagreement' }      — the tribunal analysts disagree
  //   { type: 'validate_coverage_gap' }     — retroactively raises remaining milestones' posture
  //   { type: 'builder_confidence', level: 'low'|'high' } — may only RAISE scrutiny ('low');
  //     'high' is a no-op, never a downgrade.
  // Unknown/malformed signals are a recorded no-op — the ratchet never throws mid-pipeline.
  const next = {
    scope_tier: posture.scope_tier,
    research_topics_max: posture.research_topics_max,
    planning: posture.planning,
    plan_validation_rounds: posture.plan_validation_rounds,
    slice_budget_hours: posture.slice_budget_hours,
    review: { ...posture.review },
    milestone_gate: { ...posture.milestone_gate },
    browser: { ...posture.browser },
    validate: { ...posture.validate },
    effort_bias: posture.effort_bias,
  }
  const changes = []
  const set = (dial, obj, key, value) => {
    if (obj[key] === value) return // already at or above — the ratchet only records real moves
    changes.push({ dial, from: obj[key], to: value })
    obj[key] = value
  }
  // every raise is one-directional: medium->high, false->true, effort_bias capped at 2
  const raiseReview = () => set('review.ui_effort_base', next.review, 'ui_effort_base', 'high')
  const raiseBias = () => set('effort_bias', next, 'effort_bias', Math.min(2, next.effort_bias + 1))
  const raiseTier2 = () => set('browser.tier2_per_milestone', next.browser, 'tier2_per_milestone', true)
  const raiseAdversarial = () => set('validate.adversarial_pass', next.validate, 'adversarial_pass', true)
  let action = 'none'
  const t = (signal && signal.type) || 'unknown'
  if (t === 'review_rejection' && signal.finding_class === 'logical') {
    if (signal.rejections >= config.rejections_to_split) { action = 'split_and_rebuild'; raiseReview(); raiseBias() }
    else if (signal.rejections >= config.rejections_to_feedback_escalation) { action = 'escalate_feedback_source'; raiseReview() }
  } else if (t === 'test_churn' && signal.flips >= config.churn_flips_threshold) {
    action = 'raise_scrutiny'; raiseReview(); raiseBias()
  } else if (t === 'diff_size_exceeded') {
    action = 'raise_scrutiny'; raiseReview()
  } else if (t === 'slice_growth') {
    action = 'raise_scrutiny'; raiseBias()
  } else if (t === 'analyst_disagreement') {
    action = 'raise_scrutiny'; raiseReview(); raiseBias()
  } else if (t === 'validate_coverage_gap') {
    action = 'raise_scrutiny'; raiseTier2(); raiseAdversarial(); raiseBias()
  } else if (t === 'builder_confidence' && signal.level === 'low') {
    action = 'raise_scrutiny'; raiseReview()
  }
  return { posture: next, reason: { event: 'posture_escalate', signal: t, action, changes } }
}

// deescalate(current, unitOutcome, config) — the hysteresis half of §3.3: escalation is
// monotonic WITHIN a unit; de-escalation happens ONLY at a unit (milestone) boundary, and only
// back to the Gauge baseline — never below it. Returns { posture, reason }, reason ledger-ready.
export function deescalate(current, unitOutcome, config) {
  // First param is the contract's `posture` (renamed: it must not shadow posture(), which this
  // function calls — the baseline is RECOMPUTED from the profile, never cached, so there is one
  // source of truth and config changes propagate). unitOutcome carries the boundary evidence:
  //   { profile, rejections, first_pass_green, clean_streak? }
  // §3.3 definition: a unit is clean iff it closed with ZERO rejections AND a first-pass green
  // gate; the streak of consecutive clean units (this one included — defaults to 1 when clean)
  // must reach deescalation_clean_window before the reset fires.
  const clean = unitOutcome.rejections === 0 && unitOutcome.first_pass_green === true
  const streak = clean ? (unitOutcome.clean_streak === undefined ? 1 : unitOutcome.clean_streak) : 0
  if (streak < config.deescalation_clean_window) {
    return { posture: current, reason: { event: 'posture_hold', clean, streak, changes: [] } }
  }
  const baseline = posture(unitOutcome.profile, config)
  // diff the dials for the ledger — restoring an unescalated posture records zero changes
  const flat = (p) => ({
    scope_tier: p.scope_tier,
    research_topics_max: p.research_topics_max,
    planning: p.planning,
    plan_validation_rounds: p.plan_validation_rounds,
    slice_budget_hours: p.slice_budget_hours,
    'review.ui_effort_base': p.review.ui_effort_base,
    'review.escalate_on': p.review.escalate_on,
    'milestone_gate.min_slices_for_tribunal': p.milestone_gate.min_slices_for_tribunal,
    'milestone_gate.goal_backward': p.milestone_gate.goal_backward,
    'browser.tier2_per_milestone': p.browser.tier2_per_milestone,
    'validate.adversarial_pass': p.validate.adversarial_pass,
    'validate.second_family': p.validate.second_family,
    effort_bias: p.effort_bias,
  })
  const cur = flat(current)
  const base = flat(baseline)
  const changes = Object.keys(base).filter((k) => cur[k] !== base[k]).map((k) => ({ dial: k, from: cur[k], to: base[k] }))
  return { posture: baseline, reason: { event: 'posture_deescalate', clean, streak, changes } }
}
