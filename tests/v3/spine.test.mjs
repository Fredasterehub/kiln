// spine.test.mjs — unit floor for src/spine.mjs (P2 T2 acceptance: "slice-plan SC-coverage
// validation + tamper-gate + freshness-gate logic extracted into src/ and unit-tested"). These
// are the pure blocks build.js inlines: the §5 coverage arithmetic the batch slicer is validated
// against, the §5.1/§6 mechanical runner gate (tamper + HEAD-anchor/hash/timestamp freshness +
// the red lifecycle verdict where kiln-law's exit code IS the verdict) that decides whether a
// reviewer may even be spawned, the §3.2 milestone-gate judge-spawn decision with its
// goal-audit usability predicate (orchestrator ruling: the judge NEVER spawns on missing
// inputs), and the §3.3 Sentinel rejection classifier.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validateSlicePlan, runnerGate, gateOnlyRefusal, probeGate, rejectionClass, tribunalThreshold, gateDecision, goalAuditUsable, pipelineInvalidated, validateVerdict } from '../../plugins/kiln/src/spine.mjs'

// ── validateSlicePlan — §5 coverage is arithmetic, not judgment ─────────────────────────────────
const slice = (objective, scIds, extra = {}) => ({ objective, done_when: `${objective} works`, sc_ids: scIds, ...extra })
const codes = (v) => v.errors.map((e) => e.code)

test('validateSlicePlan: a perfect plan — every milestone SC in exactly one slice — is ok', () => {
  const v = validateSlicePlan(
    [slice('add', ['SC-001']), slice('list', ['SC-002', 'SC-003'])],
    ['SC-001', 'SC-002', 'SC-003'],
  )
  assert.deepEqual(v, { ok: true, errors: [] })
})

test('validateSlicePlan: a missing SC is uncovered_sc, named precisely', () => {
  const v = validateSlicePlan([slice('add', ['SC-001'])], ['SC-001', 'SC-002'])
  assert.equal(v.ok, false)
  assert.deepEqual(codes(v), ['uncovered_sc'])
  assert.match(v.errors[0].message, /SC-002/)
})

test('validateSlicePlan: the same SC twice is duplicate_sc — across slices AND within one slice', () => {
  const across = validateSlicePlan([slice('a', ['SC-001']), slice('b', ['SC-001'])], ['SC-001'])
  assert.deepEqual(codes(across), ['duplicate_sc'])
  const within = validateSlicePlan([slice('a', ['SC-001', 'SC-001'])], ['SC-001'])
  assert.deepEqual(codes(within), ['duplicate_sc'])
})

test('validateSlicePlan: an SC outside the milestone (another milestone\'s id) is unknown_sc AND leaves the real one uncovered', () => {
  const v = validateSlicePlan([slice('a', ['SC-009'])], ['SC-001'])
  assert.equal(v.ok, false)
  assert.deepEqual(codes(v).sort(), ['uncovered_sc', 'unknown_sc'])
})

test('validateSlicePlan: a slice flipping nothing is empty_slice (sc_ids [], missing, or non-strings)', () => {
  for (const bad of [[], undefined, [null, '']]) {
    const v = validateSlicePlan([slice('a', ['SC-001']), slice('b', bad)], ['SC-001'])
    assert.ok(codes(v).includes('empty_slice'), `sc_ids=${JSON.stringify(bad)} must flag empty_slice`)
  }
})

test('validateSlicePlan: malformed slices are invalid_slice (non-object, blank objective, blank done_when)', () => {
  const v = validateSlicePlan(
    [null, { objective: ' ', done_when: 'x', sc_ids: ['SC-001'] }, { objective: 'ok', done_when: '', sc_ids: ['SC-002'] }],
    ['SC-001', 'SC-002'],
  )
  assert.equal(v.ok, false)
  assert.ok(codes(v).every((c) => c === 'invalid_slice'))
  assert.equal(v.errors.length, 3)
})

test('validateSlicePlan: a non-array plan is not_array; an empty plan with SCs owed is empty_plan', () => {
  assert.deepEqual(codes(validateSlicePlan(null, ['SC-001'])), ['not_array'])
  assert.deepEqual(codes(validateSlicePlan('nope', ['SC-001'])), ['not_array'])
  const v = validateSlicePlan([], ['SC-001', 'SC-002'])
  assert.deepEqual(codes(v), ['empty_plan'])
  assert.match(v.errors[0].message, /SC-001, SC-002/)
})

test('validateSlicePlan: an empty plan with NOTHING left to cover is ok (the replan-remainder edge)', () => {
  assert.deepEqual(validateSlicePlan([], []), { ok: true, errors: [] })
})

// ── runnerGate — the §5.1 tamper arm + the §6 freshness arms (HEAD anchor, evidence hash,
//    timestamp) + the red lifecycle verdict (exit code is the verdict), fail-closed ──────────────
const runnerOk = { verify_exit: 0, tamper_paths: [], law_run_exit: 0, flip_unmet: [], regressed: [], run_id: 'RUN1', head: 'abc123' }
const probeOk = {
  results_jsonl_exists: true, head: 'abc123', head_committed_epoch: 1000,
  manifest_head: 'abc123', manifest_results_sha256: 'feed01', manifest_completed_epoch: 1000,
  results_sha256: 'feed01', manifest_verification_class: 'full',
}

test('runnerGate: clean runner + fresh probe → proceed, carrying the manifest verification_class', () => {
  assert.deepEqual(runnerGate(runnerOk, probeOk), { verdict: 'proceed', tamper_paths: [], reasons: [], verification_class: 'full' })
})

test('runnerGate: tamper on ANY arm — verify exit 2, run exit 2, or named TAMPER paths', () => {
  const v1 = runnerGate({ verify_exit: 2, tamper_paths: ['tests/acceptance/sc-001.sh'] }, null)
  assert.equal(v1.verdict, 'tamper')
  assert.deepEqual(v1.tamper_paths, ['tests/acceptance/sc-001.sh'])
  assert.match(v1.reasons[0], /tests\/acceptance\/sc-001\.sh/)
  const v2 = runnerGate({ ...runnerOk, law_run_exit: 2 }, probeOk)
  assert.equal(v2.verdict, 'tamper')
  const v3 = runnerGate({ ...runnerOk, tamper_paths: ['.kiln/law.json'] }, probeOk)
  assert.equal(v3.verdict, 'tamper')
  assert.deepEqual(v3.tamper_paths, ['.kiln/law.json'])
})

test('runnerGate: tamper outranks staleness — exit 2 with no probe at all is still tamper, with a reason even when no path was named', () => {
  const v = runnerGate({ verify_exit: 2, tamper_paths: [] }, null)
  assert.equal(v.verdict, 'tamper')
  assert.match(v.reasons[0], /without naming paths/)
})

test('runnerGate: a missing runner report is stale, never proceed', () => {
  for (const r of [null, undefined, 'oops', ['x']]) {
    const v = runnerGate(r, probeOk)
    assert.equal(v.verdict, 'stale')
    assert.match(v.reasons.join(' '), /runner produced no report/)
  }
})

test('runnerGate: kiln-law verify nonzero, or kiln-law run\'s exit UNREPORTED, is stale — never red, never proceed', () => {
  const v1 = runnerGate({ ...runnerOk, verify_exit: 1 }, probeOk)
  assert.equal(v1.verdict, 'stale')
  assert.match(v1.reasons.join(' '), /verify did not exit 0/)
  for (const missing of [undefined, null, 'one', NaN]) {
    const v2 = runnerGate({ verify_exit: 0, tamper_paths: [], law_run_exit: missing, flip_unmet: [], regressed: [], run_id: 'RUN1', head: 'abc123' }, probeOk)
    assert.equal(v2.verdict, 'stale', `law_run_exit=${String(missing)} must be stale`)
    assert.match(v2.reasons.join(' '), /run reported no exit code/)
  }
})

test('runnerGate red verdict (T2-fix: the exit code IS the verdict): fresh, complete evidence + kiln-law run exit 1 → red, naming the transcribed FLIP_UNMET/REGRESSION ids', () => {
  const v = runnerGate({ ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-002'], regressed: ['SC-001'] }, probeOk)
  assert.equal(v.verdict, 'red')
  assert.match(v.reasons.join(' '), /declared RED→GREEN flip\(s\) still not green: SC-002/)
  assert.match(v.reasons.join(' '), /previously-GREEN check\(s\) regressed: SC-001/)
  assert.deepEqual(v.flip_unmet, ['SC-002'])
  assert.deepEqual(v.regressed, ['SC-001'])
  assert.deepEqual(v.tamper_paths, [])
})

test('runnerGate red verdict: exit nonzero with NO transcribed ids still goes red (generic reason pointing at the evidence logs) — never proceed', () => {
  const v = runnerGate({ ...runnerOk, law_run_exit: 1 }, probeOk)
  assert.equal(v.verdict, 'red')
  assert.match(v.reasons.join(' '), /exited 1.*lifecycle gate failed without transcribed/)
  // malformed id arrays are filtered, not trusted
  const v2 = runnerGate({ ...runnerOk, law_run_exit: 1, flip_unmet: [null, '', 42], regressed: 'SC-001' }, probeOk)
  assert.equal(v2.verdict, 'red')
  assert.deepEqual(v2.flip_unmet, [])
  assert.deepEqual(v2.regressed, [])
})

test('runnerGate: staleness outranks red — a nonzero run exit with untrusted evidence is stale (a red verdict is only trustworthy over proven-fresh evidence); exit 2 stays tamper', () => {
  const stale = runnerGate({ ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-002'] }, { ...probeOk, manifest_results_sha256: '' })
  assert.equal(stale.verdict, 'stale')
  const tamper = runnerGate({ ...runnerOk, law_run_exit: 2, flip_unmet: ['SC-002'] }, probeOk)
  assert.equal(tamper.verdict, 'tamper')
})

test('runnerGate: no run_id or no HEAD anchor is stale', () => {
  const v1 = runnerGate({ ...runnerOk, run_id: ' ' }, probeOk)
  assert.match(v1.reasons.join(' '), /no run_id/)
  const v2 = runnerGate({ ...runnerOk, head: undefined }, probeOk)
  assert.match(v2.reasons.join(' '), /no HEAD anchor/)
  for (const v of [v1, v2]) assert.equal(v.verdict, 'stale')
})

test('runnerGate: a missing/failed probe or absent results.jsonl is stale (fresh eyes are mandatory)', () => {
  const v1 = runnerGate(runnerOk, null)
  assert.match(v1.reasons.join(' '), /probe produced no report/)
  const v2 = runnerGate(runnerOk, { ...probeOk, results_jsonl_exists: false })
  assert.match(v2.reasons.join(' '), /results\.jsonl does not exist/)
  const v3 = runnerGate(runnerOk, { ...probeOk, head: '' })
  assert.match(v3.reasons.join(' '), /probe reported no HEAD/)
  for (const v of [v1, v2, v3]) assert.equal(v.verdict, 'stale')
})

test('runnerGate: HEAD moved between the runner and the probe is stale, naming both shas (§6: stale evidence is unapprovable)', () => {
  const v = runnerGate(runnerOk, { ...probeOk, head: 'def456' })
  assert.equal(v.verdict, 'stale')
  assert.match(v.reasons.join(' '), /HEAD moved.*runner abc123.*current def456/)
  // and the evidence's OWN anchor flags independently: the manifest names the commit it ran at
  assert.match(v.reasons.join(' '), /produced at HEAD abc123, not the current HEAD def456/)
})

test('runnerGate §6 HEAD-anchor arm: a missing or mismatched manifest head is stale — the evidence must name the CURRENT commit itself', () => {
  const missing = runnerGate(runnerOk, { ...probeOk, manifest_head: '' })
  assert.equal(missing.verdict, 'stale')
  assert.match(missing.reasons.join(' '), /no manifest HEAD anchor.*run\.json missing or unfinalized/)
  // runner transcribed the current HEAD (so the old HEAD-compare passes) but the evidence dir is
  // from an older run — exactly the hole the manifest arm closes
  const recycled = runnerGate(runnerOk, { ...probeOk, manifest_head: 'old999' })
  assert.equal(recycled.verdict, 'stale')
  assert.match(recycled.reasons.join(' '), /produced at HEAD old999, not the current HEAD abc123 — stale by commit/)
})

test('runnerGate §6 hash arm: results.jsonl must re-hash to the manifest\'s recorded sha256 — altered/partial evidence and unfinalized runs are stale', () => {
  const altered = runnerGate(runnerOk, { ...probeOk, results_sha256: 'beef02' })
  assert.equal(altered.verdict, 'stale')
  assert.match(altered.reasons.join(' '), /re-hashes to beef02 but the manifest recorded feed01/)
  const unfinalized = runnerGate(runnerOk, { ...probeOk, manifest_results_sha256: '' })
  assert.equal(unfinalized.verdict, 'stale')
  assert.match(unfinalized.reasons.join(' '), /hash cannot be verified.*aborted run never finalizes/)
  const noRehash = runnerGate(runnerOk, { ...probeOk, results_sha256: '' })
  assert.equal(noRehash.verdict, 'stale')
})

test('runnerGate §6 timestamp arm: evidence completed before HEAD was committed is stale; missing epochs fail closed', () => {
  const old = runnerGate(runnerOk, { ...probeOk, manifest_completed_epoch: 999 })
  assert.equal(old.verdict, 'stale')
  assert.match(old.reasons.join(' '), /completed at epoch 999, before HEAD was committed at epoch 1000 — stale by time/)
  // same second is fine (builder commits, runner runs within the second)
  assert.equal(runnerGate(runnerOk, { ...probeOk, manifest_completed_epoch: 1000 }).verdict, 'proceed')
  for (const miss of [{ manifest_completed_epoch: -1 }, { head_committed_epoch: -1 }, { manifest_completed_epoch: 'x' }, { head_committed_epoch: NaN }]) {
    const v = runnerGate(runnerOk, { ...probeOk, ...miss })
    assert.equal(v.verdict, 'stale')
    assert.match(v.reasons.join(' '), /timestamps are unavailable/)
  }
})

test('runnerGate §7 honesty arm: a static-only manifest still proceeds, but the gate CARRIES the degradation — never silently green', () => {
  const v = runnerGate(runnerOk, { ...probeOk, manifest_verification_class: 'static-only' })
  assert.equal(v.verdict, 'proceed', 'degradation is the capability tier, not an error — the run proceeds')
  assert.equal(v.verification_class, 'static-only', 'the gate transcribes the degradation mechanically — the workflow ledgers it and the reviewer sees it')
})

test('runnerGate §7 honesty arm: the red verdict carries verification_class too — a degraded red is still a fully-recorded red', () => {
  const v = runnerGate({ ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-002'] }, { ...probeOk, manifest_verification_class: 'static-only' })
  assert.equal(v.verdict, 'red')
  assert.equal(v.verification_class, 'static-only')
  assert.equal(runnerGate({ ...runnerOk, law_run_exit: 1 }, probeOk).verification_class, 'full')
})

test('runnerGate §7 honesty arm: a missing/unreadable verification_class is STALE, fail-closed — a probe_unavailable deferral exits 0, so an evidence manifest that cannot prove its class could proceed silently green', () => {
  for (const bad of [{ manifest_verification_class: '' }, { manifest_verification_class: 'partial' }, { manifest_verification_class: 42 }, { manifest_verification_class: undefined }]) {
    const v = runnerGate(runnerOk, { ...probeOk, ...bad })
    assert.equal(v.verdict, 'stale', `verification_class=${JSON.stringify(bad.manifest_verification_class)} must be stale`)
    assert.match(v.reasons.join(' '), /no readable verification_class/)
    assert.equal(v.verification_class, undefined, 'an untrusted manifest contributes no class')
  }
})

test('runnerGate: every stale reason accumulates — one pass reports them all', () => {
  const v = runnerGate({ verify_exit: 1, tamper_paths: [] }, null)
  assert.equal(v.verdict, 'stale')
  assert.ok(v.reasons.length >= 4, `expected all gaps reported, got: ${JSON.stringify(v.reasons)}`)
})

// ── gateOnlyRefusal — the P3.5 T3 refuse-on-red predicate (dogfood finding 4): gate-only re-runs
//    a STARVED milestone gate over an already-COMPLETED build and may proceed ONLY when the Law is
//    fully green over tamper-clean, fresh, complete evidence. Every other runnerGate verdict
//    refuses with the single contract reason `gate-only-on-red`. ───────────────────────────────────

test('gateOnlyRefusal: a clean proceed does NOT refuse (the Law is fully green over the completed build)', () => {
  const r = gateOnlyRefusal({ verdict: 'proceed', reasons: [], verification_class: 'full' })
  assert.deepEqual(r, { refuse: false, reason: '', detail: '' })
})

test('gateOnlyRefusal: a red gate refuses with gate-only-on-red, carrying the gate reasons (an SC is not green over the completed build)', () => {
  const r = gateOnlyRefusal({ verdict: 'red', reasons: ['declared RED→GREEN flip(s) still not green: SC-002'] })
  assert.equal(r.refuse, true)
  assert.equal(r.reason, 'gate-only-on-red')
  assert.match(r.detail, /not fully green/)
  assert.match(r.detail, /SC-002/)
  assert.match(r.detail, /never gates a red Law/)
})

test('gateOnlyRefusal: stale and tamper verdicts BOTH refuse (gate-only never gates over untrusted or tampered evidence) — fail-closed, the single reason tag throughout', () => {
  const stale = gateOnlyRefusal({ verdict: 'stale', reasons: ['results.jsonl does not exist in the evidence dir'] })
  assert.equal(stale.refuse, true)
  assert.equal(stale.reason, 'gate-only-on-red')
  assert.match(stale.detail, /results\.jsonl/)
  const tamper = gateOnlyRefusal({ verdict: 'tamper', tamper_paths: ['.kiln/law.json'], reasons: ['locked path(s) touched: .kiln/law.json'] })
  assert.equal(tamper.refuse, true)
  assert.equal(tamper.reason, 'gate-only-on-red')
  assert.match(tamper.detail, /law\.json/)
})

test('gateOnlyRefusal: a malformed/absent gate refuses fail-closed (no verdict ⇒ never a silent green)', () => {
  for (const bad of [null, undefined, {}, [], 'proceed', { verdict: 'unknown' }, { verdict: 'red' }]) {
    const r = gateOnlyRefusal(bad)
    assert.equal(r.refuse, true, `${JSON.stringify(bad)} must refuse`)
    assert.equal(r.reason, 'gate-only-on-red')
    assert.ok(typeof r.detail === 'string' && r.detail, 'a refusal always carries a ledger-ready detail')
  }
  // only the EXACT 'proceed' string is non-refusing
  assert.equal(gateOnlyRefusal({ verdict: 'proceed' }).refuse, false)
})

// ── tribunalThreshold — the §3.2 milestone-gate ROUTING predicate (multi-slice tribunal vs ──────
//    single-slice slice-review-as-gate; the inclusive `slices_built ≥ min_slices_for_tribunal` row)
test('tribunalThreshold: inclusive boundary — the tribunal fires AT and ABOVE the threshold, the single-slice gate is below it', () => {
  assert.equal(tribunalThreshold(1, 2), false, '1 slice, threshold 2 → below → slice-review-as-gate')
  assert.equal(tribunalThreshold(2, 2), true, 'EXACTLY at the threshold → tribunal (inclusive ≥)')
  assert.equal(tribunalThreshold(5, 2), true, 'above the threshold → tribunal')
  assert.equal(tribunalThreshold(1, 1), true, 'a threshold of 1 means every built milestone gets the tribunal')
})

test('tribunalThreshold: fails toward scrutiny — an absent/non-finite/non-positive minSlices defaults to 1 (never silently downgrades the gate)', () => {
  for (const bad of [undefined, null, 0, -3, NaN, Infinity, '2', {}]) {
    assert.equal(tribunalThreshold(1, bad), true, `minSlices=${String(bad)} must default to the conservative threshold of 1 → tribunal`)
  }
})

test('tribunalThreshold: a non-positive or non-finite sliceCount never reaches a positive threshold (the no-slices guard is upstream)', () => {
  for (const n of [0, -1, undefined, null, NaN]) {
    assert.equal(tribunalThreshold(n, 2), false, `sliceCount=${String(n)} cannot reach threshold 2`)
  }
})

// ── gateDecision — the §3.2 judge-spawn condition (judge ONLY on ambiguous reconcile) ───────────
const rec = (hasBlocking) => ({ hasBlocking, findings: [], blocking: [], summaryLines: [] })

test('gateDecision: blocking findings → computed QA_FAIL, NO judge — the deterministic gate cannot be softened', () => {
  for (const overalls of [['pass', 'pass'], ['pass', 'fail'], ['fail', 'fail'], [undefined, 'pass']]) {
    const d = gateDecision(rec(true), ...overalls)
    assert.deepEqual({ judge: d.judge, verdict: d.verdict }, { judge: false, verdict: 'QA_FAIL' }, `overalls=${overalls}`)
  }
})

test('gateDecision: zero blocking + analysts agree (pass) → computed QA_PASS, NO judge', () => {
  const d = gateDecision(rec(false), 'pass', 'pass')
  assert.deepEqual({ judge: d.judge, verdict: d.verdict }, { judge: false, verdict: 'QA_PASS' })
})

test('gateDecision: zero blocking + analysts agree (fail) is NOT ambiguous — the §3.2 computed rule applies (an unbacked fail is noise to the reconcile)', () => {
  const d = gateDecision(rec(false), 'fail', 'fail')
  assert.equal(d.judge, false)
  assert.equal(d.verdict, 'QA_PASS')
  assert.match(d.reason, /unbacked fail is noise/)
})

test('gateDecision: zero blocking + verdicts DISAGREE → the judge is spawned (ambiguous reconcile), verdict null', () => {
  for (const [a, b] of [['pass', 'fail'], ['fail', 'pass']]) {
    const d = gateDecision(rec(false), a, b)
    assert.deepEqual({ judge: d.judge, verdict: d.verdict }, { judge: true, verdict: null })
    assert.match(d.reason, /disagree/)
  }
})

test('gateDecision: a missing/unreadable analyst verdict fails the boundary closed (QA_FAIL), the judge NEVER spawns on missing inputs — §3.2 + operator ruling', () => {
  for (const [a, b] of [[undefined, 'pass'], ['fail', null], ['PASS', 'pass'], [undefined, undefined], [null, null], ['pass', 'crash']]) {
    const d = gateDecision(rec(false), a, b)
    assert.deepEqual({ judge: d.judge, verdict: d.verdict }, { judge: false, verdict: 'QA_FAIL' }, `overalls=${JSON.stringify([a, b])} must fail closed without a judge`)
    assert.match(d.reason, /missing\/unreadable|never spawns on missing/)
  }
})

test('gateDecision: the §3.2 judge-spawn predicate over ALL FOUR input combinations — the judge spawns ONLY at (zero blocking ∧ disagree)', () => {
  const matrix = [
    // [hasBlocking, overallA, overallB, judge, verdict]
    [true, 'pass', 'pass', false, 'QA_FAIL'],  // blocking ∧ agree    → computed QA_FAIL
    [true, 'pass', 'fail', false, 'QA_FAIL'],  // blocking ∧ disagree → computed QA_FAIL (no judge can soften)
    [false, 'pass', 'pass', false, 'QA_PASS'], // clean ∧ agree       → computed QA_PASS
    [false, 'pass', 'fail', true, null],       // clean ∧ disagree    → the ONE ambiguous cell: judge
  ]
  for (const [blocking, a, b, judge, verdict] of matrix) {
    const d = gateDecision(rec(blocking), a, b)
    assert.deepEqual({ judge: d.judge, verdict: d.verdict }, { judge, verdict }, `blocking=${blocking} overalls=${a}/${b}`)
  }
})

// ── goalAuditUsable — the orchestrator ruling's usability predicate (the judge NEVER spawns on
//    missing inputs; an unusable audit is re-asked once, then the boundary fails closed) ─────────
test('goalAuditUsable: a schema-shaped report (binary overall + findings array) is usable, pass or fail, findings empty or not', () => {
  assert.equal(goalAuditUsable({ reasoning: 'r', overall: 'pass', findings: [] }), true)
  assert.equal(goalAuditUsable({ overall: 'fail', findings: [{ text: 'x', severity: 'critical' }] }), true)
})

test('goalAuditUsable: null/dead agents, wrong types, missing or non-binary overall, and missing findings are ALL unusable — absent evidence fails closed', () => {
  const unusable = [
    null, undefined, 'crash', 42, ['x'],
    {}, { overall: 'pass' },                       // no findings array
    { findings: [] },                              // no overall
    { overall: 'maybe', findings: [] },            // non-binary overall
    { overall: 'PASS', findings: [] },             // case matters — transcription, not inference
    { overall: 'pass', findings: 'none' },         // findings not an array
  ]
  for (const r of unusable) assert.equal(goalAuditUsable(r), false, `must be unusable: ${JSON.stringify(r)}`)
})

// ── rejectionClass — the §3.3 master-signal classifier ──────────────────────────────────────────
test('rejectionClass: any logical finding makes the rejection logical', () => {
  assert.equal(rejectionClass({ verdict: 'REJECTED', findings: [{ text: 'x', finding_class: 'mechanical' }, { text: 'y', finding_class: 'logical' }] }), 'logical')
})

test('rejectionClass: all-mechanical findings stay mechanical (process noise never moves the ratchet)', () => {
  assert.equal(rejectionClass({ verdict: 'REJECTED', findings: [{ text: 'x', finding_class: 'mechanical' }] }), 'mechanical')
})

test('rejectionClass: a dead reviewer (null/non-object) is mechanical — infrastructure failure carries no defect signal', () => {
  for (const r of [null, undefined, 'crash', [1]]) assert.equal(rejectionClass(r), 'mechanical')
})

test('rejectionClass: a real verdict with NO findings errs toward scrutiny — logical', () => {
  assert.equal(rejectionClass({ verdict: 'REJECTED', findings: [] }), 'logical')
  assert.equal(rejectionClass({ verdict: 'REJECTED' }), 'logical')
})

// ── pipelineInvalidated — the §9 next-milestone pipelining invalidation predicate (finding #8) ───
test('pipelineInvalidated: HEAD unchanged since the pipelined plan launched → still good, no re-slice', () => {
  const v = pipelineInvalidated('abc123', 'abc123')
  assert.deepEqual(v, { invalidated: false, reason: '' })
})

test('pipelineInvalidated: a corrective commit advanced HEAD → invalidated, naming both shas (the §9 rule)', () => {
  const v = pipelineInvalidated('abc123', 'def456')
  assert.equal(v.invalidated, true)
  assert.match(v.reason, /base_sha abc123, current HEAD def456/)
  assert.match(v.reason, /re-slice against the new HEAD/)
})

test('pipelineInvalidated: a missing/blank base_sha is fail-closed (launch HEAD unknown → re-slice)', () => {
  for (const base of ['', '   ', null, undefined, 42, {}]) {
    const v = pipelineInvalidated(base, 'def456')
    assert.equal(v.invalidated, true, `base=${JSON.stringify(base)} must invalidate`)
    assert.match(v.reason, /no base_sha/)
  }
})

test('pipelineInvalidated: an unreadable current HEAD is fail-closed (freshness cannot be proven → re-slice)', () => {
  for (const head of ['', '  ', null, undefined, NaN, []]) {
    const v = pipelineInvalidated('abc123', head)
    assert.equal(v.invalidated, true, `head=${JSON.stringify(head)} must invalidate`)
    assert.match(v.reason, /current HEAD is unreadable/)
  }
})

test('pipelineInvalidated: trimming — surrounding whitespace never makes equal shas look different', () => {
  assert.equal(pipelineInvalidated('  abc123  ', 'abc123').invalidated, false)
})

// ── probeGate — the §7 ui-slice probe gating predicate (tasks.md T2.1: probe exit → reject /
//    degrade / pass). It runs on the TRUSTWORTHY runnerGate verdicts only (reject/stale/tamper are
//    disposed mechanically upstream), so its input is { verification_class } off a proceed/red gate.
const gateFull = { verdict: 'proceed', verification_class: 'full' }
const gateStatic = { verdict: 'proceed', verification_class: 'static-only' }

test('probeGate: ui + full verification → pass (every mapped probe EXECUTED — full-strength review)', () => {
  for (const surf of ['ui', 'mixed']) {
    assert.deepEqual(probeGate(surf, gateFull), { action: 'pass', verification_class: 'full', reason: '' }, `${surf} full`)
  }
})

test('probeGate: ui + static-only → degrade (probe deferred — exit 78 / un-instantiated / --skip-probes; honest degradation, ledger probe_unavailable, static fallback)', () => {
  for (const surf of ['ui', 'mixed']) {
    const v = probeGate(surf, gateStatic)
    assert.equal(v.action, 'degrade', `${surf} static-only must degrade`)
    assert.equal(v.verification_class, 'static-only')
    assert.match(v.reason, /probe was deferred/)
    assert.match(v.reason, /never silently green/)
  }
})

test('probeGate: a logic slice has NO browser path — always pass, verification_class irrelevant (a probe never maps to logic)', () => {
  assert.deepEqual(probeGate('logic', gateFull), { action: 'pass', verification_class: 'full', reason: '' })
  assert.deepEqual(probeGate('logic', gateStatic), { action: 'pass', verification_class: 'static-only', reason: '' })
  // an unknown surface normalizes to logic (fail-safe: never treat an unknown surface as ui)
  assert.equal(probeGate('something-else', gateStatic).action, 'pass')
})

test('probeGate: ui with an unreadable/absent verification_class → reject (fail-closed; a ui gate is never passed as "full" when degradation cannot be PROVEN)', () => {
  for (const gate of [{ verdict: 'proceed' }, { verdict: 'proceed', verification_class: '' }, { verdict: 'proceed', verification_class: 'bogus' }, {}, null]) {
    const v = probeGate('ui', gate)
    assert.equal(v.action, 'reject', `gate=${JSON.stringify(gate)} must reject`)
    assert.match(v.reason, /no readable verification_class/)
    assert.match(v.reason, /fail closed/)
  }
})

test('probeGate: the predicate is total and PURE — same input, same output; the red verdict carries verification_class too (a red ui run that degraded is still classed honestly)', () => {
  const redStatic = { verdict: 'red', verification_class: 'static-only' }
  const a = probeGate('ui', redStatic)
  const b = probeGate('ui', redStatic)
  assert.deepEqual(a, b)
  assert.equal(a.action, 'degrade')
})

// ── validateVerdict — §3.2/§5 deterministic-first validate verdict (tasks.md T3.5) ──────────────
// A green non-UI floor: install ok, Law run + suite exit 0, every criterion met, zero blocking.
const greenLogic = {
  install_ok: true, law_run_exit: 0, suite_exit: 0, tests_passed: 12, tests_failed: 0,
  criteria: [{ id: 'SC-001', met: true }, { id: 'SC-002', met: true }],
  blocking_findings: [], ui_scope: false,
}

test('validateVerdict: a clean non-UI run is VALIDATE_PASS, full, browser NOT_APPLICABLE', () => {
  const v = validateVerdict(greenLogic)
  assert.equal(v.verdict, 'VALIDATE_PASS')
  assert.equal(v.verification_class, 'full')
  assert.equal(v.browser_verdict, 'NOT_APPLICABLE')
  assert.deepEqual(v.blocking, [])
  assert.deepEqual(v.reasons, [])
})

test('validateVerdict: install/build failure → VALIDATE_FAILED (the v2 build-error class)', () => {
  const v = validateVerdict({ ...greenLogic, install_ok: false })
  assert.equal(v.verdict, 'VALIDATE_FAILED')
  assert.ok(v.reasons.some((r) => /install\/build failed/.test(r)))
})

test('validateVerdict: a RED Law run is VALIDATE_FAILED — the exit code is the verdict, no softening', () => {
  const v = validateVerdict({ ...greenLogic, law_run_exit: 1 })
  assert.equal(v.verdict, 'VALIDATE_FAILED')
  assert.ok(v.reasons.some((r) => /Law run is RED/.test(r) && /exited 1/.test(r)))
})

test('validateVerdict: a missing/un-transcribed Law run exit fails CLOSED (FAILED, not PASS)', () => {
  const v = validateVerdict({ ...greenLogic, law_run_exit: undefined })
  assert.equal(v.verdict, 'VALIDATE_FAILED')
  assert.ok(v.reasons.some((r) => /Law run is RED/.test(r) && /was not run/.test(r)))
})

test('validateVerdict: >50% suite failures → VALIDATE_FAILED; ≤50% → VALIDATE_PARTIAL (the v2 boundary)', () => {
  const majority = validateVerdict({ ...greenLogic, suite_exit: 1, tests_passed: 4, tests_failed: 6 })
  assert.equal(majority.verdict, 'VALIDATE_FAILED')
  assert.ok(majority.reasons.some((r) => /majority/.test(r)))
  const minority = validateVerdict({ ...greenLogic, suite_exit: 1, tests_passed: 9, tests_failed: 1 })
  assert.equal(minority.verdict, 'VALIDATE_PARTIAL')
  assert.ok(minority.reasons.some((r) => /suite is red/.test(r) && /≤50%/.test(r)))
})

test('validateVerdict: a red suite at EXACTLY 50% is PARTIAL — >50% is strict (5/10 failed is not a majority)', () => {
  const v = validateVerdict({ ...greenLogic, suite_exit: 1, tests_passed: 5, tests_failed: 5 })
  assert.equal(v.verdict, 'VALIDATE_PARTIAL')
})

test('validateVerdict: a red suite with no counts is PARTIAL (counts unavailable — never a silent PASS)', () => {
  const v = validateVerdict({ ...greenLogic, suite_exit: 2, tests_passed: undefined, tests_failed: undefined })
  assert.equal(v.verdict, 'VALIDATE_PARTIAL')
  assert.ok(v.reasons.some((r) => /counts unavailable/.test(r)))
})

test('validateVerdict: a MISSING/un-transcribed suite exit FAILS CLOSED — never falls through to PASS (§3.2/§5.1)', () => {
  for (const missing of [undefined, null, 'x', NaN]) {
    const v = validateVerdict({ ...greenLogic, suite_exit: missing })
    assert.equal(v.verdict, 'VALIDATE_FAILED', `suite_exit=${JSON.stringify(missing)} must fail closed, never PASS`)
    assert.ok(v.reasons.some((r) => /suite exit was not run or not transcribed/.test(r)))
  }
})

test('validateVerdict: a degraded suite_exit=-1 (no-pluginRoot path) is PARTIAL, not FAILED — honest degradation, never a silent PASS', () => {
  // -1 is a transcribed number meaning "not run" in the degraded floor; it is red-but-ran ⇒ PARTIAL.
  const v = validateVerdict({ ...greenLogic, suite_exit: -1, tests_passed: undefined, tests_failed: undefined })
  assert.equal(v.verdict, 'VALIDATE_PARTIAL')
  assert.ok(v.reasons.some((r) => /suite is red/.test(r) && /counts unavailable/.test(r)))
})

test('validateVerdict: the FULL no-pluginRoot path (law_run_exit=-1 AND suite_exit=-1) is PARTIAL, not FAILED — the degraded floor degrades honestly (review cycle 3, finding 1: -1 must NOT collapse to VALIDATE_FAILED)', () => {
  // The actual no-pluginRoot branch (validate.js argusPrompt) transcribes BOTH as -1: the kiln-law CLI
  // lives under pluginRoot, so its absence makes the deterministic floor un-runnable. -1 is the agreed
  // "not run because the oracle was unavailable" sentinel — symmetric with the suite arm, it caps the
  // verdict at PARTIAL (honest degradation to the v2 static path), NEVER a hard FAILED on the missing
  // floor alone. Before the fix this returned VALIDATE_FAILED (lawExit -1 ≠ 0), contradicting the
  // prompt's documented degraded fallback.
  const v = validateVerdict({ ...greenLogic, law_run_exit: -1, suite_exit: -1, tests_passed: undefined, tests_failed: undefined })
  assert.equal(v.verdict, 'VALIDATE_PARTIAL', 'no_plugin_root_sentinels must degrade to PARTIAL, not FAILED')
  assert.ok(v.reasons.some((r) => /deterministic Law floor did not run/.test(r) && /never a silent PASS/.test(r)))
  assert.ok(!v.reasons.some((r) => /Law run is RED/.test(r)), 'a -1 degraded floor is NOT framed as a RED Law (that is null / a genuine non-zero)')
})

test('validateVerdict: law_run_exit=-1 caps at PARTIAL even when the agent ran its OWN suite clean (suite_exit=0) — the missing floor never earns a silent PASS', () => {
  // The load-bearing case: pluginRoot absent (law=-1) but the agent installed + ran the project suite
  // itself to a clean exit 0. Without the explicit degraded-floor PARTIAL arm this would fall through to
  // VALIDATE_PASS — a green the deterministic floor never proved. It must cap at PARTIAL.
  const v = validateVerdict({ ...greenLogic, law_run_exit: -1, suite_exit: 0, tests_passed: 12, tests_failed: 0 })
  assert.equal(v.verdict, 'VALIDATE_PARTIAL', 'a clean self-run suite cannot lift a no-floor run to PASS')
  assert.ok(v.reasons.some((r) => /deterministic Law floor did not run/.test(r)))
})

test('validateVerdict: a mute gate (unruled_gates) caps at PARTIAL, never PASS and never FAILED — epistemic absence is not proven breakage (the 2026-07-04 cross-family ruling)', () => {
  // The gate agent and its one fresh re-dispatch both died on the structured-output retry cap: its
  // coverage is UNKNOWN. The Law-floor doctrine applies — PASS impossible, but a dead reporter proves
  // nothing about the product, so it must NOT ride blocking_findings into VALIDATE_FAILED (which would
  // route the conductor into a product-correction loop with nothing to fix).
  const v = validateVerdict({ ...greenLogic, unruled_gates: ['the goal-backward gate (aristotle:goal-final and its re-dispatch died on the structured-output retry cap) — VISION delivery UNKNOWN'] })
  assert.equal(v.verdict, 'VALIDATE_PARTIAL', 'a mute gate is a PARTIAL ceiling, not FAILED and never PASS')
  assert.deepEqual(v.unruled_gates.length, 1)
  assert.ok(v.reasons.some((r) => /never ruled/.test(r) && /re-running validate/.test(r)))
})

test('validateVerdict: unruled gates NEVER soften a real failure — FAILED reasons still rule, and the mute gate stays visible in the payload', () => {
  const v = validateVerdict({ ...greenLogic, law_run_exit: 1, unruled_gates: ['the arch-check gate — drift/seam status UNKNOWN'] })
  assert.equal(v.verdict, 'VALIDATE_FAILED')
  assert.equal(v.unruled_gates.length, 1, 'the unruled gate must survive into the FAILED payload for the report')
})

test('validateVerdict: a clean run carries unruled_gates: [] — stable payload shape across all three verdicts', () => {
  const v = validateVerdict(greenLogic)
  assert.equal(v.verdict, 'VALIDATE_PASS')
  assert.deepEqual(v.unruled_gates, [])
})

test('validateVerdict: a GENUINE red/un-transcribed Law run still FAILS — only -1 is the degraded sentinel (the fix is surgical, not a softening of real failures)', () => {
  // A genuinely red Law (exit 1/2) or an un-transcribed one (null/undefined/NaN/non-number) stays a hard
  // FAILED — the -1 carve-out is for the structural-unavailability sentinel ONLY, never a general softener.
  for (const red of [1, 2, 127]) {
    const v = validateVerdict({ ...greenLogic, law_run_exit: red })
    assert.equal(v.verdict, 'VALIDATE_FAILED', `law_run_exit=${red} (a genuinely red Law) must FAIL`)
    assert.ok(v.reasons.some((r) => /Law run is RED/.test(r) && new RegExp(`exited ${red}`).test(r)))
  }
  for (const missing of [undefined, null, 'x', NaN]) {
    const v = validateVerdict({ ...greenLogic, law_run_exit: missing })
    assert.equal(v.verdict, 'VALIDATE_FAILED', `law_run_exit=${JSON.stringify(missing)} (un-transcribed) must fail closed`)
    assert.ok(v.reasons.some((r) => /Law run is RED/.test(r) && /was not run/.test(r)))
  }
})

test('validateVerdict: a CRITICAL criterion unmet → VALIDATE_FAILED; a non-critical unmet → VALIDATE_PARTIAL', () => {
  const crit = validateVerdict({ ...greenLogic, criteria: [{ id: 'SC-001', met: false, critical: true, note: 'export broken' }] })
  assert.equal(crit.verdict, 'VALIDATE_FAILED')
  assert.ok(crit.reasons.some((r) => /CRITICAL acceptance criterion is unmet: SC-001/.test(r) && /export broken/.test(r)))
  const noncrit = validateVerdict({ ...greenLogic, criteria: [{ id: 'SC-001', met: true }, { id: 'SC-009', met: false, critical: false }] })
  assert.equal(noncrit.verdict, 'VALIDATE_PARTIAL')
  assert.ok(noncrit.reasons.some((r) => /non-critical acceptance criterion is unmet: SC-009/.test(r)))
})

test('validateVerdict: an UNCATEGORIZED unmet criterion is treated as CRITICAL — scrutiny only rises', () => {
  const v = validateVerdict({ ...greenLogic, criteria: [{ id: 'SC-007', met: false }] })
  assert.equal(v.verdict, 'VALIDATE_FAILED')
  assert.ok(v.reasons.some((r) => /CRITICAL acceptance criterion is unmet: SC-007/.test(r)))
})

test('validateVerdict: any blocking finding (drift/seam/goal-backward) → VALIDATE_FAILED, deduped', () => {
  const v = validateVerdict({ ...greenLogic, blocking_findings: ['goal broken: cart never persists', 'goal broken: cart never persists', 'seam mismatch: API returns 422'] })
  assert.equal(v.verdict, 'VALIDATE_FAILED')
  assert.deepEqual(v.blocking, ['goal broken: cart never persists', 'seam mismatch: API returns 422'])
  assert.equal(v.reasons.filter((r) => /cart never persists/.test(r)).length, 1)
})

test('validateVerdict: missing creds caps at VALIDATE_PARTIAL — never FAILED on its own (v2 rule)', () => {
  const v = validateVerdict({ ...greenLogic, missing_creds: true })
  assert.equal(v.verdict, 'VALIDATE_PARTIAL')
  assert.ok(v.reasons.some((r) => /missing credentials/.test(r)))
})

// ── UI scope + the browser path (§3.2: a UI scope maxes at PARTIAL unless Tier-2 is clean) ──
const greenUi = { ...greenLogic, ui_scope: true }

test('validateVerdict: UI scope + a CLEAN Tier-2 traversal → VALIDATE_PASS, full, FULL_BROWSER_VALIDATION', () => {
  const v = validateVerdict({ ...greenUi, browser_path: 'full' })
  assert.equal(v.verdict, 'VALIDATE_PASS')
  assert.equal(v.verification_class, 'full')
  assert.equal(v.browser_verdict, 'FULL_BROWSER_VALIDATION')
})

test('validateVerdict: UI scope + no browser path (static-only) → VALIDATE_PARTIAL, static-only, PARTIAL_PASS_STATIC_ONLY — the v2 ceiling, honestly degraded', () => {
  const v = validateVerdict({ ...greenUi, browser_path: 'static-only' })
  assert.equal(v.verdict, 'VALIDATE_PARTIAL')
  assert.equal(v.verification_class, 'static-only')
  assert.equal(v.browser_verdict, 'PARTIAL_PASS_STATIC_ONLY')
  assert.ok(v.reasons.some((r) => /no clean browser path/.test(r) && /never silently green/.test(r)))
})

test('validateVerdict: UI scope with an UNKNOWN/absent browser_path defaults to static-only — a UI scope never claims a clean browser pass it cannot prove', () => {
  for (const bp of [undefined, '', 'bogus']) {
    const v = validateVerdict({ ...greenUi, browser_path: bp })
    assert.equal(v.verdict, 'VALIDATE_PARTIAL', `browser_path=${JSON.stringify(bp)}`)
    assert.equal(v.verification_class, 'static-only')
    assert.equal(v.browser_verdict, 'PARTIAL_PASS_STATIC_ONLY')
  }
})

test('validateVerdict: UI scope + a FAILED Tier-2 traversal (a real UI defect) → VALIDATE_FAILED, FAIL_BROWSER_EVIDENCE_MISSING', () => {
  const v = validateVerdict({ ...greenUi, browser_path: 'failed' })
  assert.equal(v.verdict, 'VALIDATE_FAILED')
  assert.equal(v.browser_verdict, 'FAIL_BROWSER_EVIDENCE_MISSING')
  assert.ok(v.reasons.some((r) => /Tier-2 browser traversal ran and found a UI defect/.test(r)))
})

test('validateVerdict: non-compensatory — a FAILED arm beats a PARTIAL arm (a red Law outranks static-only degradation)', () => {
  const v = validateVerdict({ ...greenUi, law_run_exit: 1, browser_path: 'static-only', missing_creds: true })
  assert.equal(v.verdict, 'VALIDATE_FAILED')
  // verification_class still records the honest UI degradation even on a FAILED verdict
  assert.equal(v.verification_class, 'static-only')
})

test('validateVerdict: total + fail-closed — garbage/empty input never passes a gate', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}]) {
    const v = validateVerdict(bad)
    assert.equal(v.verdict, 'VALIDATE_FAILED', `input=${JSON.stringify(bad)} must fail closed`)
    // {} has install_ok≠true and law_run_exit not 0 ⇒ FAILED; never a silent PASS
  }
})

test('validateVerdict: PURE — same input, same output', () => {
  const input = { ...greenUi, browser_path: 'static-only', criteria: [{ id: 'SC-001', met: false, critical: false }] }
  assert.deepEqual(validateVerdict(input), validateVerdict(input))
})
