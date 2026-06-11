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

import { validateSlicePlan, runnerGate, rejectionClass, tribunalThreshold, gateDecision, goalAuditUsable, pipelineInvalidated } from '../../plugins/kiln/src/spine.mjs'

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
  results_sha256: 'feed01',
}

test('runnerGate: clean runner + fresh probe → proceed', () => {
  assert.deepEqual(runnerGate(runnerOk, probeOk), { verdict: 'proceed', tamper_paths: [], reasons: [] })
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

test('runnerGate: every stale reason accumulates — one pass reports them all', () => {
  const v = runnerGate({ verify_exit: 1, tamper_paths: [] }, null)
  assert.equal(v.verdict, 'stale')
  assert.ok(v.reasons.length >= 4, `expected all gaps reported, got: ${JSON.stringify(v.reasons)}`)
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
