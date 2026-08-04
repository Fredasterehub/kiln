'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  assembleSuite,
  orderRun,
  startRun,
  recordRun,
  computeSuiteState,
  recordAffected,
  runJourney,
  digestSuite,
} = require('../src/verification.js');
const { readJson } = require('../src/atomic-json.js');
const { readRecords, appendRecord } = require('../src/stream.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verification-test-'));
}

function criteriaRegister(ids) {
  return {
    schema_version: 1,
    criteria: ids.map((id) => ({ id, text: `criterion ${id}`, source_ref: 'vision.md#1', journey_id: `journey-${id}` })),
  };
}

function journeysIndex(entries) {
  return { schema_version: 1, journeys: entries };
}

function journeyEntry(criterionId, overrides = {}) {
  return {
    journey_id: `journey-${criterionId}`,
    criterion_id: criterionId,
    script_path: `test/${criterionId}.test.js`,
    harness: 'node-test',
    added_in_milestone: 'M1',
    ...overrides,
  };
}

// A minimal assembled-suite fixture for tests exercising startRun/
// computeSuiteState/recordAffected directly, independent of assembleSuite's
// own register/journeysIndex plumbing.
function suiteOf(...journeyIds) {
  return journeyIds.map((id) => journeyEntry(id, { journey_id: id }));
}

function stampGateEvidence(ledgerPath, gateId, exitCode = 0) {
  appendRecord(ledgerPath, {
    kind: 'gate',
    payload: { gate_id: gateId, cmd: 'x', exit_code: exitCode },
    correlation_id: gateId,
  });
}

// ---------- assembleSuite ----------

test('assembleSuite succeeds when every criterion has exactly one journey', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1', 'c2']);
  const idx = journeysIndex([journeyEntry('c1'), journeyEntry('c2')]);

  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.journeys.length, 2);
  assert.deepEqual(
    result.journeys.map((j) => j.journey_id).sort(),
    ['journey-c1', 'journey-c2']
  );
});

test('assembleSuite fails closed when a criterion has no journey entry (missing)', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1', 'c2']);
  const idx = journeysIndex([journeyEntry('c1')]);

  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('criterion "c2" has no journey entry')));
});

test('assembleSuite fails closed when a criterion has two journey entries (duplicate)', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1']);
  const idx = journeysIndex([
    journeyEntry('c1', { journey_id: 'journey-c1-a' }),
    journeyEntry('c1', { journey_id: 'journey-c1-b' }),
  ]);

  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('criterion "c1" has 2 journey entries')));
});

test('assembleSuite fails closed when two journeys share a journey_id (duplicate journey_id)', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1', 'c2']);
  const idx = journeysIndex([
    journeyEntry('c1', { journey_id: 'same-id' }),
    journeyEntry('c2', { journey_id: 'same-id' }),
  ]);

  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('journey_id "same-id" is a duplicate')));
});

test('assembleSuite fails closed on an orphan journey (criterion_id not in the register)', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1']);
  const idx = journeysIndex([journeyEntry('c1'), journeyEntry('ghost')]);

  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('references unknown criterion "ghost"') && e.includes('orphan')));
});

test('assembleSuite fails closed on a journey entry with an empty script_path', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1']);
  const idx = journeysIndex([journeyEntry('c1', { script_path: '' })]);

  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('script_path must be a non-empty string')));
});

test('assembleSuite throws on a non-string treeRoot', () => {
  assert.throws(() => assembleSuite(null, criteriaRegister(['c1']), journeysIndex([journeyEntry('c1')])), /treeRoot must be a non-empty string/);
});

// --- P8 Sol review: criteria-register shape + script-path containment ---

test('assembleSuite fails closed when the criteria register itself is malformed (duplicate criterion id) — validators.validateCriteriaRegister is invoked', () => {
  const tmp = mkTmpDir();
  const reg = {
    schema_version: 1,
    criteria: [
      { id: 'c1', text: 'a', source_ref: 'v#1', journey_id: 'journey-a' },
      { id: 'c1', text: 'b', source_ref: 'v#1', journey_id: 'journey-b' },
    ],
  };
  const idx = journeysIndex([journeyEntry('c1')]);
  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('"c1" is a duplicate')));
});

test('assembleSuite fails closed on an empty criteria register', () => {
  const tmp = mkTmpDir();
  const reg = { schema_version: 1, criteria: [] };
  const idx = journeysIndex([]);
  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('non-empty array')));
});

test('REGRESSION (P8 Sol probe): a script_path containing shell metacharacters is refused, never accepted into the assembled suite', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1']);
  const idx = journeysIndex([journeyEntry('c1', { script_path: 'definitely-missing.test.js; exit 0' })]);
  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('not a safe, contained relative path')));
});

test('REGRESSION (P8 Sol probe): a script_path traversing outside the repo via ".." is refused', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1']);
  const idx = journeysIndex([journeyEntry('c1', { script_path: '../../outside.test.js' })]);
  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('not a safe, contained relative path')));
});

test('REGRESSION (P8 Sol probe): an absolute script_path is refused', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1']);
  const idx = journeysIndex([journeyEntry('c1', { script_path: '/tmp/outside.test.js' })]);
  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('not a safe, contained relative path')));
});

test('assembleSuite accepts a script_path using only the safe charset (letters, digits, ".", "_", "-", "/")', () => {
  const tmp = mkTmpDir();
  const reg = criteriaRegister(['c1']);
  const idx = journeysIndex([journeyEntry('c1', { script_path: 'tests/journeys/j1-a_b.test.js' })]);
  const result = assembleSuite(tmp, reg, idx);
  assert.equal(result.ok, true);
});

// ---------- orderRun ----------

test('orderRun puts previously-failed journeys first, then affected, then the rest, stably', () => {
  const allJourneys = [
    { journey_id: 'a' },
    { journey_id: 'b' },
    { journey_id: 'c' },
    { journey_id: 'd' },
  ];
  const previousResults = [{ journey_id: 'c', status: 'fail', duration_ms: 1, gate_id: 'g1' }];
  const affectedMap = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [{ journey_id: 'a', affected_by: ['src/x.js'], status: 'pending' }],
  };

  const ordered = orderRun(previousResults, affectedMap, allJourneys);
  assert.deepEqual(ordered.map((j) => j.journey_id), ['c', 'a', 'b', 'd']);
});

test('orderRun is deterministic — same inputs, same order, every time', () => {
  const allJourneys = [{ journey_id: 'x' }, { journey_id: 'y' }, { journey_id: 'z' }];
  const previousResults = [{ journey_id: 'y', status: 'fail', duration_ms: 1, gate_id: 'g1' }];
  const affectedMap = { schema_version: 1, generated_at: new Date().toISOString(), entries: [] };

  const first = orderRun(previousResults, affectedMap, allJourneys);
  const second = orderRun(previousResults, affectedMap, allJourneys);
  assert.deepEqual(first, second);
});

test('orderRun treats an affected-map entry with an empty affected_by as not affected', () => {
  const allJourneys = [{ journey_id: 'a' }, { journey_id: 'b' }];
  const affectedMap = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [{ journey_id: 'a', affected_by: [], status: 'pending' }],
  };

  const ordered = orderRun([], affectedMap, allJourneys);
  assert.deepEqual(ordered.map((j) => j.journey_id), ['a', 'b']);
});

test('orderRun with no previous failures and no affected entries returns allJourneys unchanged', () => {
  const allJourneys = [{ journey_id: 'a' }, { journey_id: 'b' }, { journey_id: 'c' }];
  const ordered = orderRun([], { schema_version: 1, generated_at: new Date().toISOString(), entries: [] }, allJourneys);
  assert.deepEqual(ordered, allJourneys);
});

test('orderRun tolerates a null/undefined affectedMap as "no affected entries" (the very first pass, before the file exists)', () => {
  const allJourneys = [{ journey_id: 'a' }, { journey_id: 'b' }];
  assert.deepEqual(orderRun([], null, allJourneys).map((j) => j.journey_id), ['a', 'b']);
  assert.deepEqual(orderRun([], undefined, allJourneys).map((j) => j.journey_id), ['a', 'b']);
});

test('REGRESSION (P8 Sol probe): orderRun does not prioritize an affected-map entry whose status is not "pending" (e.g. already "green")', () => {
  const allJourneys = [{ journey_id: 'a' }, { journey_id: 'b' }];
  const affectedMap = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [{ journey_id: 'a', affected_by: ['src/x.js'], status: 'green' }],
  };
  const ordered = orderRun([], affectedMap, allJourneys);
  assert.deepEqual(ordered.map((j) => j.journey_id), ['a', 'b']);
});

test('orderRun throws on a malformed affectedMap instead of silently ignoring it', () => {
  const allJourneys = [{ journey_id: 'a' }];
  const badMap = { schema_version: 1, generated_at: 'not-a-date', entries: [] };
  assert.throws(() => orderRun([], badMap, allJourneys), /malformed affectedMap/);
});

// ---------- startRun ----------

test('startRun writes a run-start record and appends an entry to runs-index.json', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a', 'b');
  const { runId, seq, suiteDigest, runPath } = startRun(tmp, 'run-1', suite);
  assert.equal(runId, 'run-1');
  assert.equal(seq, 0);
  assert.ok(suiteDigest.startsWith('sha256:'));

  const { records } = readRecords(runPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'run-start');
  assert.equal(records[0].suite_digest, suiteDigest);

  const index = readJson(path.join(tmp, 'verification', 'runs-index.json'));
  assert.equal(index.schema_version, 1);
  assert.equal(index.runs.length, 1);
  assert.equal(index.runs[0].run_id, 'run-1');
  assert.equal(index.runs[0].seq, 0);
  assert.equal(index.runs[0].suite_digest, suiteDigest);
});

test('startRun assigns monotonically increasing seq numbers across successive runs', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a');
  assert.equal(startRun(tmp, 'run-1', suite).seq, 0);
  assert.equal(startRun(tmp, 'run-2', suite).seq, 1);
  assert.equal(startRun(tmp, 'run-3', suite).seq, 2);
});

test('startRun refuses (throws) a runId already present in runs-index.json — run identity is monotonic', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a');
  startRun(tmp, 'run-1', suite);
  assert.throws(() => startRun(tmp, 'run-1', suite), /already exists in .*runs-index\.json/);
});

test('startRun refuses (throws) a runId whose own run file already carries records', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a');
  appendRecord(path.join(tmp, 'verification', 'runs', 'run-1.jsonl'), {
    kind: 'journey-result',
    payload: { journey_id: 'a', status: 'pass', duration_ms: 1, gate_id: 'g1', unverified: true },
  });
  assert.throws(() => startRun(tmp, 'run-1', suite), /already carries records/);
});

test('digestSuite is order-independent — the same journeys in a different array order produce the same digest', () => {
  const a = suiteOf('a', 'b', 'c');
  const b = [a[2], a[0], a[1]];
  assert.equal(digestSuite(a), digestSuite(b));
});

test('digestSuite differs when the suite\'s own journeys differ', () => {
  assert.notEqual(digestSuite(suiteOf('a', 'b')), digestSuite(suiteOf('a', 'c')));
});

// ---------- recordRun ----------

test('recordRun appends one journey-result record per result, each carrying its gate_id and unverified:false when ledger evidence backs it', () => {
  const tmp = mkTmpDir();
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  stampGateEvidence(ledgerPath, 'gate-a');
  stampGateEvidence(ledgerPath, 'gate-b');
  const results = [
    { journey_id: 'a', status: 'pass', duration_ms: 120, gate_id: 'gate-a' },
    { journey_id: 'b', status: 'fail', duration_ms: 80, gate_id: 'gate-b' },
  ];

  const { runPath, seqs } = recordRun(tmp, 'run-1', results, ledgerPath);
  assert.equal(runPath, path.join(tmp, 'verification', 'runs', 'run-1.jsonl'));
  assert.deepEqual(seqs, [0, 1]);

  const { records } = readRecords(runPath);
  assert.equal(records.length, 2);
  assert.equal(records[0].kind, 'journey-result');
  assert.equal(records[0].journey_id, 'a');
  assert.equal(records[0].status, 'pass');
  assert.equal(records[0].gate_id, 'gate-a');
  assert.equal(records[0].unverified, false);
  assert.equal(records[1].journey_id, 'b');
  assert.equal(records[1].status, 'fail');
});

test('recordRun refuses (throws) a result with no gate_id — execution evidence law', () => {
  const tmp = mkTmpDir();
  const results = [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: '' }];
  assert.throws(() => recordRun(tmp, 'run-1', results, null, { unverifiedImport: true }), /gate_id must be a non-empty string/);
});

test('recordRun refuses (throws) a result with an invalid status', () => {
  const tmp = mkTmpDir();
  const results = [{ journey_id: 'a', status: 'flaky', duration_ms: 10, gate_id: 'g1' }];
  assert.throws(() => recordRun(tmp, 'run-1', results, null, { unverifiedImport: true }), /status must be one of/);
});

test('recordRun validates the whole batch before writing anything (no partial write on a later bad entry)', () => {
  const tmp = mkTmpDir();
  const results = [
    { journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'g1' },
    { journey_id: 'b', status: 'pass', duration_ms: 10, gate_id: '' },
  ];
  assert.throws(() => recordRun(tmp, 'run-1', results, null, { unverifiedImport: true }));
  const runPath = path.join(tmp, 'verification', 'runs', 'run-1.jsonl');
  assert.equal(fs.existsSync(runPath), false);
});

test('recordRun requires a non-empty ledgerPath unless opts.unverifiedImport is set', () => {
  const tmp = mkTmpDir();
  const results = [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'g1' }];
  assert.throws(() => recordRun(tmp, 'run-1', results), /ledgerPath must be a non-empty string/);
});

test('REGRESSION (P8 Sol probe): recordRun refuses (throws) a gate_id with no matching ledger record — evidence binding', () => {
  const tmp = mkTmpDir();
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  const results = [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'invented-no-ledger' }];
  assert.throws(() => recordRun(tmp, 'run-1', results, ledgerPath), /has no matching ledger record/);
  assert.equal(fs.existsSync(path.join(tmp, 'verification', 'runs', 'run-1.jsonl')), false);
});

test('recordRun refuses a gate_id whose ledger record carries no exit_code', () => {
  const tmp = mkTmpDir();
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'g1', cmd: 'x' }, correlation_id: 'g1' });
  const results = [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'g1' }];
  assert.throws(() => recordRun(tmp, 'run-1', results, ledgerPath), /has no matching ledger record/);
});

test('recordRun opts.unverifiedImport bypasses the ledger check and stamps unverified:true (scenario/mock use only)', () => {
  const tmp = mkTmpDir();
  const results = [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'no-ledger-needed' }];
  const { runPath } = recordRun(tmp, 'run-1', results, null, { unverifiedImport: true });
  const { records } = readRecords(runPath);
  assert.equal(records[0].unverified, true);
});

// ---------- computeSuiteState ----------

test('computeSuiteState is green when every suite journey has a verified passing record in this run', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a', 'b');
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  startRun(tmp, 'run-1', suite);
  stampGateEvidence(ledgerPath, 'gate-a');
  stampGateEvidence(ledgerPath, 'gate-b');
  recordRun(
    tmp,
    'run-1',
    [
      { journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'gate-a' },
      { journey_id: 'b', status: 'pass', duration_ms: 10, gate_id: 'gate-b' },
    ],
    ledgerPath
  );

  const suiteState = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suite);
  assert.equal(suiteState.status, 'green');
  assert.equal(suiteState.run_id, 'run-1');
  assert.equal(suiteState.run_seq, 0);
  assert.equal(suiteState.suite_digest, digestSuite(suite));
  assert.deepEqual(suiteState.passing.sort(), ['a', 'b']);
  assert.deepEqual(suiteState.failing, []);
  assert.deepEqual(suiteState.quarantined, []);
  assert.deepEqual(suiteState.reasons, {});

  const onDisk = readJson(path.join(tmp, 'verification', 'suite-state.json'));
  assert.deepEqual(onDisk, suiteState);
});

test('computeSuiteState is red when any suite journey failed, with reason "failed"', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a', 'b');
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  startRun(tmp, 'run-1', suite);
  stampGateEvidence(ledgerPath, 'gate-a');
  stampGateEvidence(ledgerPath, 'gate-b');
  recordRun(
    tmp,
    'run-1',
    [
      { journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'gate-a' },
      { journey_id: 'b', status: 'fail', duration_ms: 10, gate_id: 'gate-b' },
    ],
    ledgerPath
  );

  const suiteState = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suite);
  assert.equal(suiteState.status, 'red');
  assert.deepEqual(suiteState.failing, ['b']);
  assert.equal(suiteState.reasons.b, 'failed');
});

test('REGRESSION (P8 Sol probe "never-ran green"): computeSuiteState refuses (throws) for a run that was never started', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a', 'b');
  assert.throws(() => computeSuiteState(tmp, 'never-ran', { schema_version: 1, entries: [] }, suite), /was never started/);
});

test('REGRESSION (P8 Sol probe "partial run"): a run missing a suite journey\'s record is red, with reason "no-result", never vacuously green', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a', 'b', 'c');
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  startRun(tmp, 'run-1', suite);
  stampGateEvidence(ledgerPath, 'gate-a');
  recordRun(tmp, 'run-1', [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'gate-a' }], ledgerPath);

  const suiteState = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suite);
  assert.equal(suiteState.status, 'red');
  assert.deepEqual(suiteState.failing.sort(), ['b', 'c']);
  assert.equal(suiteState.reasons.b, 'no-result');
  assert.equal(suiteState.reasons.c, 'no-result');
});

test('REGRESSION (P8 Sol probe "invented gate id, no ledger"): a caller-attested pass with no matching ledger record is refused at recordRun and never reaches a green suite state', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a');
  startRun(tmp, 'run-1', suite);
  assert.throws(
    () => recordRun(tmp, 'run-1', [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'invented-no-ledger' }], path.join(tmp, 'ledger.jsonl')),
    /has no matching ledger record/
  );

  const suiteState = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suite);
  assert.equal(suiteState.status, 'red');
  assert.equal(suiteState.reasons.a, 'no-result');
});

test('computeSuiteState is red on duplicate records for the same journey within one run (ambiguous outcome)', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a');
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  startRun(tmp, 'run-1', suite);
  stampGateEvidence(ledgerPath, 'gate-a-1');
  stampGateEvidence(ledgerPath, 'gate-a-2');
  recordRun(tmp, 'run-1', [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'gate-a-1' }], ledgerPath);
  recordRun(tmp, 'run-1', [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'gate-a-2' }], ledgerPath);

  const suiteState = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suite);
  assert.equal(suiteState.status, 'red');
  assert.equal(suiteState.reasons.a, 'duplicate-result');
});

test('computeSuiteState is red, fail-closed, when the run stream itself is malformed (a JSON parse error)', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a');
  startRun(tmp, 'run-1', suite);
  fs.appendFileSync(path.join(tmp, 'verification', 'runs', 'run-1.jsonl'), 'not-json\n');

  const suiteState = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suite);
  assert.equal(suiteState.status, 'red');
  assert.equal(suiteState.reasons.a, 'malformed-run-stream');
});

test('REGRESSION (P8 Sol probe "old-green vs current-red"): an old, still-green run remains honestly computable, and a newer run over the same suite correctly computes red', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a', 'b');
  const ledgerPath = path.join(tmp, 'ledger.jsonl');

  startRun(tmp, 'old-green', suite);
  stampGateEvidence(ledgerPath, 'gate-old-a');
  stampGateEvidence(ledgerPath, 'gate-old-b');
  recordRun(
    tmp,
    'old-green',
    [
      { journey_id: 'a', status: 'pass', duration_ms: 1, gate_id: 'gate-old-a' },
      { journey_id: 'b', status: 'pass', duration_ms: 1, gate_id: 'gate-old-b' },
    ],
    ledgerPath
  );
  const oldState = computeSuiteState(tmp, 'old-green', { schema_version: 1, entries: [] }, suite);
  assert.equal(oldState.status, 'green');

  startRun(tmp, 'current-red', suite);
  stampGateEvidence(ledgerPath, 'gate-cur-a');
  stampGateEvidence(ledgerPath, 'gate-cur-b');
  recordRun(
    tmp,
    'current-red',
    [
      { journey_id: 'a', status: 'pass', duration_ms: 1, gate_id: 'gate-cur-a' },
      { journey_id: 'b', status: 'fail', duration_ms: 1, gate_id: 'gate-cur-b' },
    ],
    ledgerPath
  );
  const currentState = computeSuiteState(tmp, 'current-red', { schema_version: 1, entries: [] }, suite);
  assert.equal(currentState.status, 'red');

  // Recomputing the OLD run still (honestly) answers for THAT run — it is
  // the phase-exit check's own run-currency comparison against
  // runs-index.json's latest entry (phases.test.js) that refuses to accept
  // it as the CURRENT answer, not computeSuiteState, which always answers
  // truthfully for the specific run it is asked about.
  const recomputedOld = computeSuiteState(tmp, 'old-green', { schema_version: 1, entries: [] }, suite);
  assert.equal(recomputedOld.status, 'green');
});

test('computeSuiteState is red, with reason "suite-digest-mismatch", when the suite passed differs from the one the run started against', () => {
  const tmp = mkTmpDir();
  const suiteA = suiteOf('a', 'b');
  const suiteB = suiteOf('a', 'b', 'c');
  startRun(tmp, 'run-1', suiteA);

  const suiteState = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suiteB);
  assert.equal(suiteState.status, 'red');
  assert.equal(suiteState.reasons.a, 'suite-digest-mismatch');
  assert.equal(suiteState.reasons.b, 'suite-digest-mismatch');
  assert.equal(suiteState.reasons.c, 'suite-digest-mismatch');
});

test('computeSuiteState treats an unverified record as a failure unless opts.allowUnverified is set (scenario-only escape)', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a');
  startRun(tmp, 'run-1', suite);
  recordRun(tmp, 'run-1', [{ journey_id: 'a', status: 'pass', duration_ms: 10, gate_id: 'g1' }], null, { unverifiedImport: true });

  const strict = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suite);
  assert.equal(strict.status, 'red');
  assert.equal(strict.reasons.a, 'unverified-result');

  const lenient = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suite, { allowUnverified: true });
  assert.equal(lenient.status, 'green');
});

test('computeSuiteState — a PENDING quarantine entry (1 outcome) still votes: a failing journey with only one tracked outcome keeps the suite red', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a', 'b');
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  startRun(tmp, 'run-1', suite);
  stampGateEvidence(ledgerPath, 'gate-a');
  stampGateEvidence(ledgerPath, 'gate-b');
  recordRun(
    tmp,
    'run-1',
    [
      { journey_id: 'a', status: 'pass', duration_ms: 1, gate_id: 'gate-a' },
      { journey_id: 'b', status: 'fail', duration_ms: 1, gate_id: 'gate-b' },
    ],
    ledgerPath
  );

  const pendingQuarantine = {
    schema_version: 1,
    entries: [{ journey_id: 'b', since_run: 'run-1', reason: null, history: [{ outcome: 'fail', run_id: 'run-1' }] }],
  };
  const suiteState = computeSuiteState(tmp, 'run-1', pendingQuarantine, suite);
  assert.equal(suiteState.status, 'red');
  assert.deepEqual(suiteState.failing, ['b']);
  assert.deepEqual(suiteState.quarantined, []);
});

test('a DECIDED quarantine entry (2 outcomes) loses its vote: a failing decided-quarantined journey does not turn the suite red', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a', 'b');
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  startRun(tmp, 'run-1', suite);
  stampGateEvidence(ledgerPath, 'gate-a');
  stampGateEvidence(ledgerPath, 'gate-b');
  recordRun(
    tmp,
    'run-1',
    [
      { journey_id: 'a', status: 'pass', duration_ms: 1, gate_id: 'gate-a' },
      { journey_id: 'b', status: 'fail', duration_ms: 1, gate_id: 'gate-b' },
    ],
    ledgerPath
  );

  const decidedQuarantine = {
    schema_version: 1,
    entries: [
      {
        journey_id: 'b',
        since_run: 'run-0',
        reason: 'flaky',
        history: [
          { outcome: 'fail', run_id: 'run-0' },
          { outcome: 'pass', run_id: 'run-0b' },
        ],
      },
    ],
  };
  const suiteState = computeSuiteState(tmp, 'run-1', decidedQuarantine, suite);
  assert.equal(suiteState.status, 'green');
  assert.deepEqual(suiteState.passing, ['a']);
  assert.deepEqual(suiteState.failing, []);
  assert.deepEqual(suiteState.quarantined, ['b']);
});

test('computeSuiteState reports a decided-quarantined journey outside the current suite too', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a');
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  startRun(tmp, 'run-1', suite);
  stampGateEvidence(ledgerPath, 'gate-a');
  recordRun(tmp, 'run-1', [{ journey_id: 'a', status: 'pass', duration_ms: 1, gate_id: 'gate-a' }], ledgerPath);

  const decidedQuarantine = {
    schema_version: 1,
    entries: [
      {
        journey_id: 'c',
        since_run: 'run-0',
        reason: 'flaky',
        history: [
          { outcome: 'fail', run_id: 'run-0' },
          { outcome: 'pass', run_id: 'run-0b' },
        ],
      },
    ],
  };
  const suiteState = computeSuiteState(tmp, 'run-1', decidedQuarantine, suite);
  assert.equal(suiteState.status, 'green');
  assert.deepEqual(suiteState.quarantined, ['c']);
});

test('computeSuiteState carries no judgment field — schema is exactly the declared keys', () => {
  const tmp = mkTmpDir();
  const suite = suiteOf('a');
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  startRun(tmp, 'run-1', suite);
  stampGateEvidence(ledgerPath, 'gate-a');
  recordRun(tmp, 'run-1', [{ journey_id: 'a', status: 'pass', duration_ms: 1, gate_id: 'gate-a' }], ledgerPath);
  const suiteState = computeSuiteState(tmp, 'run-1', { schema_version: 1, entries: [] }, suite);
  assert.deepEqual(Object.keys(suiteState).sort(), [
    'failing',
    'passing',
    'quarantined',
    'reasons',
    'run_id',
    'run_seq',
    'schema_version',
    'status',
    'suite_digest',
    'ts',
  ]);
});

// ---------- recordAffected ----------

test('recordAffected writes a valid affected-map.json and stamps generated_at', () => {
  const tmp = mkTmpDir();
  const entries = [{ journey_id: 'a', affected_by: ['src/x.js'], status: 'pending' }];
  const result = recordAffected(tmp, entries);
  assert.equal(result.schema_version, 1);
  assert.equal(typeof result.generated_at, 'string');
  assert.deepEqual(result.entries, entries);

  const onDisk = readJson(path.join(tmp, 'verification', 'affected-map.json'));
  assert.deepEqual(onDisk, result);
});

test('recordAffected refuses (throws) an entry with an invalid status', () => {
  const tmp = mkTmpDir();
  assert.throws(() => recordAffected(tmp, [{ journey_id: 'a', affected_by: [], status: 'bogus' }]), /malformed affected-map/);
});

test('recordAffected refuses (throws) an entry missing journey_id', () => {
  const tmp = mkTmpDir();
  assert.throws(() => recordAffected(tmp, [{ affected_by: [], status: 'pending' }]), /malformed affected-map/);
});

// ---------- runJourney ----------

test('runJourney records a "pass" via runGate\'s real exit code and a deterministic gate_id', () => {
  const tmp = mkTmpDir();
  const ledgerPath = path.join(tmp, 'ledger.jsonl');

  const result = runJourney(tmp, 'run-1', 'journey-a', 'exit 0', ledgerPath);
  assert.equal(result.journey_id, 'journey-a');
  assert.equal(result.status, 'pass');
  assert.equal(result.gate_id, 'journey-journey-a-run-1');
  assert.ok(Number.isFinite(result.duration_ms) && result.duration_ms >= 0);

  const { records } = readRecords(path.join(tmp, 'verification', 'runs', 'run-1.jsonl'));
  assert.equal(records.length, 1);
  assert.equal(records[0].journey_id, 'journey-a');
  assert.equal(records[0].status, 'pass');
  assert.equal(records[0].gate_id, 'journey-journey-a-run-1');
  assert.equal(records[0].unverified, false);

  const { records: ledgerRecords } = readRecords(ledgerPath);
  const gateRecord = ledgerRecords.find((r) => r.kind === 'gate');
  assert.equal(gateRecord.gate_id, 'journey-journey-a-run-1');
  assert.equal(gateRecord.cmd, 'exit 0');
  assert.equal(gateRecord.exit_code, 0);
});

test('runJourney records "fail" when the reporter-flagged command exits non-zero', () => {
  const tmp = mkTmpDir();
  const ledgerPath = path.join(tmp, 'ledger.jsonl');

  const result = runJourney(tmp, 'run-1', 'journey-b', 'exit 1', ledgerPath);
  assert.equal(result.status, 'fail');

  const { records } = readRecords(path.join(tmp, 'verification', 'runs', 'run-1.jsonl'));
  assert.equal(records[0].status, 'fail');
});

test('runJourney produces a distinct gate_id for the same journey re-run under a new runId (the flake protocol\'s own re-run-once)', () => {
  const tmp = mkTmpDir();
  const ledgerPath = path.join(tmp, 'ledger.jsonl');

  const first = runJourney(tmp, 'run-1', 'journey-a', 'exit 1', ledgerPath);
  const second = runJourney(tmp, 'run-2', 'journey-a', 'exit 0', ledgerPath);
  assert.notEqual(first.gate_id, second.gate_id);
  assert.equal(first.status, 'fail');
  assert.equal(second.status, 'pass');
});

test('runJourney throws on a non-string cmd', () => {
  const tmp = mkTmpDir();
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  assert.throws(() => runJourney(tmp, 'run-1', 'journey-a', '', ledgerPath), /cmd must be a non-empty string/);
});
