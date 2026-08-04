'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { decideFlake, recordOutcome, release, capTracker, FIX_LOOP_CAP } = require('../src/quarantine.js');
const { readJson, writeAtomic } = require('../src/atomic-json.js');
const { startRun, computeSuiteState } = require('../src/verification.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quarantine-test-'));
}

function quarantinePathIn(dir) {
  return path.join(dir, 'verification', 'quarantine.json');
}

function suiteStatePathIn(dir) {
  return path.join(dir, 'verification', 'suite-state.json');
}

// ---------- decideFlake ----------

test('decideFlake returns "fix-task" when both outcomes, across two distinct runs, are failing', () => {
  assert.equal(
    decideFlake([
      { outcome: 'fail', run_id: 'run-1' },
      { outcome: 'fail', run_id: 'run-2' },
    ]),
    'fix-task'
  );
});

test('decideFlake returns "quarantine" on a fail-then-pass inconsistency', () => {
  assert.equal(
    decideFlake([
      { outcome: 'fail', run_id: 'run-1' },
      { outcome: 'pass', run_id: 'run-2' },
    ]),
    'quarantine'
  );
});

test('decideFlake returns "quarantine" on a pass-then-fail inconsistency', () => {
  assert.equal(
    decideFlake([
      { outcome: 'pass', run_id: 'run-1' },
      { outcome: 'fail', run_id: 'run-2' },
    ]),
    'quarantine'
  );
});

test('decideFlake returns "clear" when both outcomes, across two distinct runs, are passing', () => {
  assert.equal(
    decideFlake([
      { outcome: 'pass', run_id: 'run-1' },
      { outcome: 'pass', run_id: 'run-2' },
    ]),
    'clear'
  );
});

test('decideFlake throws on anything other than exactly 2 outcomes', () => {
  assert.throws(() => decideFlake([{ outcome: 'fail', run_id: 'run-1' }]), /EXACTLY 2 outcomes/);
  assert.throws(() => decideFlake([]), /EXACTLY 2 outcomes/);
  assert.throws(
    () =>
      decideFlake([
        { outcome: 'fail', run_id: 'run-1' },
        { outcome: 'fail', run_id: 'run-2' },
        { outcome: 'pass', run_id: 'run-3' },
      ]),
    /EXACTLY 2 outcomes/
  );
});

test('decideFlake throws on an outcome outside {pass, fail}', () => {
  assert.throws(
    () =>
      decideFlake([
        { outcome: 'fail', run_id: 'run-1' },
        { outcome: 'flaky', run_id: 'run-2' },
      ]),
    /outcome: "pass"\|"fail"/
  );
});

test('REGRESSION (P8 required revision #5): decideFlake refuses two outcomes carrying the SAME run_id — not a genuine re-run', () => {
  assert.throws(
    () =>
      decideFlake([
        { outcome: 'fail', run_id: 'run-1' },
        { outcome: 'pass', run_id: 'run-1' },
      ]),
    /DISTINCT run_id values/
  );
});

// ---------- recordOutcome ----------

test('recordOutcome does nothing (no entry created) for a lone passing outcome', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  const { doc, verdict } = recordOutcome(qPath, 'journey-a', 'pass', { runId: 'run-1' });
  assert.equal(verdict, 'clear');
  assert.deepEqual(doc.entries, []);
  assert.equal(fs.existsSync(qPath), false);
});

test('recordOutcome requires a non-empty opts.runId', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  assert.throws(() => recordOutcome(qPath, 'journey-a', 'fail'), /requires a non-empty opts\.runId/);
  assert.throws(() => recordOutcome(qPath, 'journey-a', 'fail', {}), /requires a non-empty opts\.runId/);
});

test('recordOutcome creates a PENDING tracking entry on a first failure, verdict null (not enough evidence yet)', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  const { doc, verdict } = recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-1' });
  assert.equal(verdict, null);
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.entries[0].journey_id, 'journey-a');
  assert.deepEqual(doc.entries[0].history, [{ outcome: 'fail', run_id: 'run-1' }]);
  assert.equal(doc.entries[0].since_run, 'run-1');
  assert.equal(doc.entries[0].reason, null);

  const onDisk = readJson(qPath);
  assert.deepEqual(onDisk, doc);
});

test('recordOutcome stamps reason when supplied on first entry into tracking', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  const { doc } = recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-7', reason: 'selector drift' });
  assert.equal(doc.entries[0].since_run, 'run-7');
  assert.equal(doc.entries[0].reason, 'selector drift');
});

test('recordOutcome: fail then fail again (distinct runs) yields "fix-task" and removes the entry (a real bug must keep voting red)', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-1' });
  const { doc, verdict } = recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-2' });
  assert.equal(verdict, 'fix-task');
  assert.deepEqual(doc.entries, []);
});

test('recordOutcome: fail then pass under a new runId (re-run-once) yields "quarantine" and keeps the entry, DECIDED', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-1' });
  const { doc, verdict } = recordOutcome(qPath, 'journey-a', 'pass', { runId: 'run-2' });
  assert.equal(verdict, 'quarantine');
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.entries[0].journey_id, 'journey-a');
  assert.deepEqual(doc.entries[0].history, [
    { outcome: 'fail', run_id: 'run-1' },
    { outcome: 'pass', run_id: 'run-2' },
  ]);
});

test('REGRESSION (P8 required revision #5): a re-run under the SAME runId as the original failure is refused', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-1' });
  assert.throws(() => recordOutcome(qPath, 'journey-a', 'pass', { runId: 'run-1' }), /distinct from the original failure/);
});

test('REGRESSION (P8 required revision #5): a DECIDED quarantine entry refuses a third outcome — release() is the only reopen path', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-1' });
  recordOutcome(qPath, 'journey-a', 'pass', { runId: 'run-2' }); // -> quarantine, decided
  assert.throws(
    () => recordOutcome(qPath, 'journey-a', 'pass', { runId: 'run-3' }),
    /already carries a decided quarantine verdict/
  );
  assert.throws(
    () => recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-3' }),
    /already carries a decided quarantine verdict/
  );
});

test('recordOutcome tracks multiple journeys independently', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-1' });
  recordOutcome(qPath, 'journey-b', 'fail', { runId: 'run-1' });
  const { doc } = recordOutcome(qPath, 'journey-b', 'fail', { runId: 'run-2' });
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.entries[0].journey_id, 'journey-a');
});

test('recordOutcome throws on an invalid outcome', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  assert.throws(() => recordOutcome(qPath, 'journey-a', 'flaky', { runId: 'run-1' }), /outcome must be "pass" or "fail"/);
});

// --- P8 required revision #5: recordOutcome marks a persisted suite-state.json stale ---

test('REGRESSION (P8 required revision #5): recordOutcome marks an existing suite-state.json "stale" so a pre-mutation green cannot be consumed', () => {
  const tmp = mkTmpDir();
  const suite = [{ journey_id: 'journey-a' }];
  startRun(tmp, 'run-1', suite);
  writeAtomic(suiteStatePathIn(tmp), {
    schema_version: 1,
    run_id: 'run-1',
    run_seq: 0,
    suite_digest: 'sha256:whatever',
    status: 'green',
    passing: ['journey-a'],
    failing: [],
    reasons: {},
    quarantined: [],
    ts: new Date().toISOString(),
  });

  recordOutcome(quarantinePathIn(tmp), 'journey-a', 'fail', { runId: 'run-2' });

  const staleState = readJson(suiteStatePathIn(tmp));
  assert.equal(staleState.status, 'stale');
});

test('recordOutcome is a no-op on suite-state.json when there is nothing to mark stale (lone passing outcome, nothing written)', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  recordOutcome(qPath, 'journey-a', 'pass', { runId: 'run-1' });
  assert.equal(fs.existsSync(suiteStatePathIn(tmp)), false);
});

// ---------- release ----------

test('release removes a journey entry from quarantine.json', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-1' });
  recordOutcome(qPath, 'journey-a', 'pass', { runId: 'run-2' }); // -> quarantine, entry present

  const doc = release(qPath, 'journey-a');
  assert.deepEqual(doc.entries, []);
  assert.deepEqual(readJson(qPath), doc);
});

test('release on a journey with no entry is a no-op that still writes a well-formed document', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  const doc = release(qPath, 'never-tracked');
  assert.deepEqual(doc, { schema_version: 1, entries: [] });
});

test('release reopens a DECIDED entry — a subsequent recordOutcome for the same journey is accepted again', () => {
  const tmp = mkTmpDir();
  const qPath = quarantinePathIn(tmp);
  recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-1' });
  recordOutcome(qPath, 'journey-a', 'pass', { runId: 'run-2' }); // -> quarantine, decided
  release(qPath, 'journey-a');

  const { doc, verdict } = recordOutcome(qPath, 'journey-a', 'fail', { runId: 'run-3' });
  assert.equal(verdict, null);
  assert.deepEqual(doc.entries[0].history, [{ outcome: 'fail', run_id: 'run-3' }]);
});

// ---------- capTracker (fix-loop cap) ----------

test('capTracker.atCap is false below the cap and true at the cap', () => {
  const tmp = mkTmpDir();
  const tracker = capTracker(tmp);
  assert.equal(tracker.atCap('problem-1'), false);
  tracker.recordAttempt('problem-1');
  assert.equal(tracker.atCap('problem-1'), false);
  tracker.recordAttempt('problem-1');
  assert.equal(tracker.atCap('problem-1'), true);
  assert.equal(FIX_LOOP_CAP, 2);
});

test('capTracker tracks attempts per problemKey independently', () => {
  const tmp = mkTmpDir();
  const tracker = capTracker(tmp);
  tracker.recordAttempt('problem-1');
  tracker.recordAttempt('problem-1');
  tracker.recordAttempt('problem-2');
  assert.equal(tracker.atCap('problem-1'), true);
  assert.equal(tracker.atCap('problem-2'), false);
  assert.equal(tracker.countFor('problem-1'), 2);
  assert.equal(tracker.countFor('problem-2'), 1);
});

test('capTracker appends fix-attempt records to verification/fix-attempts.jsonl', () => {
  const tmp = mkTmpDir();
  const tracker = capTracker(tmp);
  tracker.recordAttempt('problem-1');
  assert.equal(tracker.attemptsPath, path.join(tmp, 'verification', 'fix-attempts.jsonl'));
  assert.equal(fs.existsSync(tracker.attemptsPath), true);
});

// --- P8 required revision #6: checkAndRecord, the atomic combined op ---

test('REGRESSION (P8 Sol probe "third attempt recorded after cap reached"): checkAndRecord refuses at the cap BEFORE recording a third attempt', () => {
  const tmp = mkTmpDir();
  const tracker = capTracker(tmp);

  const first = tracker.checkAndRecord('problem-1');
  assert.equal(first.allowed, true);
  assert.equal(first.agreement_pass_required, false);

  const second = tracker.checkAndRecord('problem-1');
  assert.equal(second.allowed, true);
  assert.equal(tracker.countFor('problem-1'), 2);

  const third = tracker.checkAndRecord('problem-1');
  assert.equal(third.allowed, false);
  assert.equal(third.agreement_pass_required, true);
  assert.equal(tracker.countFor('problem-1'), 2); // unchanged — the third attempt was never recorded
});

test('checkAndRecord tracks problemKeys independently, same as recordAttempt/atCap', () => {
  const tmp = mkTmpDir();
  const tracker = capTracker(tmp);
  tracker.checkAndRecord('problem-1');
  tracker.checkAndRecord('problem-1');
  const stillOpen = tracker.checkAndRecord('problem-2');
  assert.equal(stillOpen.allowed, true);
  assert.equal(tracker.atCap('problem-1'), true);
  assert.equal(tracker.atCap('problem-2'), false);
});
