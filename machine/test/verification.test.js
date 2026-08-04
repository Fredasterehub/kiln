'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { execFileSync } = require('node:child_process');

const {
  assembleSuite,
  orderRun,
  startRun,
  recordRun,
  computeSuiteState,
  recordAffected,
  recordChunkAffected,
  runJourney,
  digestSuite,
} = require('../src/verification.js');
const { validateAffectedMap } = require('../src/validators.js');
const { readJson, writeAtomic } = require('../src/atomic-json.js');
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

// ---------- recordChunkAffected ----------

// The per-chunk feeder: which catalogued journeys a sealed chunk's own commit
// touched, merged into the map recordAffected owns. Every fixture here is a
// REAL repository with a REAL commit, because the derivation reads the commit —
// a fixture that only put files on disk would never reach it.
const AFFECTED_MAP_PATH = (treeRoot) => path.join(treeRoot, 'verification', 'affected-map.json');

const J0 = { journey_id: 'J-0', criterion_id: 'ACR-0', script_path: 'test/j0.test.js', harness: 'node-test', added_in_milestone: 'M0' };
const J1 = { journey_id: 'J-1', criterion_id: 'ACR-1', script_path: 'test/j1.test.js', harness: 'node-test', added_in_milestone: 'M1' };

// Bytes, inode and mtime together: identical content cannot tell a rewrite from
// a read, and "left the map alone" is a claim about writes.
function stampOf(file) {
  if (!fs.existsSync(file)) return `${file} ABSENT`;
  const stat = fs.statSync(file);
  return `${file} ino=${stat.ino} mtime=${stat.mtimeMs} ${fs.readFileSync(file, 'utf8')}`;
}

function makeSealedProject({ catalog = [J0, J1] } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'tree/\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n');
  fs.mkdirSync(path.join(repoRoot, 'test'));
  for (const entry of [J0, J1]) fs.writeFileSync(path.join(repoRoot, entry.script_path), 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');

  const treeRoot = path.join(repoRoot, 'tree');
  if (catalog !== null) {
    writeAtomic(path.join(treeRoot, 'verification', 'journeys.json'), { schema_version: 1, journeys: catalog });
  }
  // A chunk's commit: it touches the paths it was given, and README besides —
  // the ordinary case is a diff that is mostly NOT journey scripts.
  const seal = (paths, message) => {
    fs.appendFileSync(path.join(repoRoot, 'README.md'), `${message}\n`);
    for (const rel of paths) fs.appendFileSync(path.join(repoRoot, rel), `${message}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  return { repoRoot, treeRoot, seal, git };
}

test('recordChunkAffected records the catalogued journeys the sealed commit touched, and nothing else', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  const commit = seal([J1.script_path], 'C1 changes the second journey');

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit);

  assert.equal(result.state, 'recorded');
  assert.deepEqual(result.journey_ids, [J1.journey_id]);
  const map = readJson(AFFECTED_MAP_PATH(treeRoot), null);
  assert.deepEqual(validateAffectedMap(map).errors, []);
  assert.deepEqual(map.entries, [{ journey_id: J1.journey_id, affected_by: ['M1/C1'], status: 'pending' }]);
});

test('a commit touching no catalogued journey script never creates the map', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  const commit = seal([], 'C1 changes nothing a journey covers');

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit);

  assert.equal(result.state, 'unaffected');
  assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false, 'an unaffecting chunk wrote a map');
});

test('a chunk that affects nothing leaves an existing map byte-identical', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1'));
  const before = stampOf(AFFECTED_MAP_PATH(treeRoot));

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C2', seal([], 'C2'));

  assert.equal(result.state, 'unaffected');
  assert.equal(stampOf(AFFECTED_MAP_PATH(treeRoot)), before);
});

test('re-driving the same chunk-green leaves the map byte-identical, generated_at included', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  const commit = seal([J1.script_path], 'C1');
  recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit);
  const before = stampOf(AFFECTED_MAP_PATH(treeRoot));

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit);

  assert.equal(result.state, 'already-recorded');
  assert.equal(stampOf(AFFECTED_MAP_PATH(treeRoot)), before, 'the replay rewrote the map');
});

// THE WRONG ANSWER IS A DIFFERENT ANSWER: a chunk id is unique only inside its
// milestone, so two milestones both holding a C1 are two affecters. Recorded
// unscoped, the second collapses into the first and the map loses it silently.
test('two milestones holding the same chunk id are two different affecters', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'M1 C1'));
  recordChunkAffected(treeRoot, repoRoot, 'M2', 'C1', seal([J1.script_path], 'M2 C1'));

  const map = readJson(AFFECTED_MAP_PATH(treeRoot), null);
  assert.deepEqual(map.entries, [{ journey_id: J1.journey_id, affected_by: ['M1/C1', 'M2/C1'], status: 'pending' }]);
});

test('a journey the map already marks resolved goes back to pending when a new chunk touches it', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  // The shape a completed verification pass leaves behind, written by the one
  // sanctioned writer rather than assembled by hand.
  recordAffected(treeRoot, [{ journey_id: J1.journey_id, affected_by: ['M1/C1'], status: 'green' }]);

  recordChunkAffected(treeRoot, repoRoot, 'M1', 'C2', seal([J1.script_path], 'C2'));

  const map = readJson(AFFECTED_MAP_PATH(treeRoot), null);
  assert.deepEqual(map.entries, [
    { journey_id: J1.journey_id, affected_by: ['M1/C1', 'M1/C2'], status: 'pending' },
  ]);
});

test('a journey the commit did not touch keeps its own entry untouched', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  recordAffected(treeRoot, [{ journey_id: J0.journey_id, affected_by: ['M0/C9'], status: 'green' }]);

  recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1'));

  const map = readJson(AFFECTED_MAP_PATH(treeRoot), null);
  assert.deepEqual(map.entries, [
    { journey_id: J0.journey_id, affected_by: ['M0/C9'], status: 'green' },
    { journey_id: J1.journey_id, affected_by: ['M1/C1'], status: 'pending' },
  ]);
});

test('a build with no catalog yet records nothing rather than refusing', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject({ catalog: null });

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1'));

  assert.equal(result.state, 'no-catalog');
  assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false);
});

test('recordChunkAffected refuses a catalog it cannot read, and writes nothing', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  writeAtomic(path.join(treeRoot, 'verification', 'journeys.json'), { schema_version: 2, journeys: [] });

  assert.throws(
    () => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1')),
    /not a journey catalog/
  );
  assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false);
});

test('recordChunkAffected refuses a malformed existing map rather than overwriting it', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  fs.mkdirSync(path.join(treeRoot, 'verification'), { recursive: true });
  fs.writeFileSync(AFFECTED_MAP_PATH(treeRoot), JSON.stringify({ schema_version: 1, entries: 'nope' }));
  const before = stampOf(AFFECTED_MAP_PATH(treeRoot));

  assert.throws(
    () => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1')),
    /refuses a malformed affected-map/
  );
  assert.equal(stampOf(AFFECTED_MAP_PATH(treeRoot)), before);
});

// A `commit` that names something git can show but that is not a commit is the
// silent-falsy case: `git diff-tree` on a blob prints nothing and exits 0, so an
// unguarded derivation would report "this chunk affected nothing" about a chunk
// whose diff it never read.
test('recordChunkAffected refuses a commit id that is not a commit', () => {
  const { repoRoot, treeRoot, seal, git } = makeSealedProject();
  seal([J1.script_path], 'C1');
  const blob = git('rev-parse', 'HEAD:README.md').trim();

  assert.throws(() => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', blob), /is not a commit/);
  assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false);
});

test('recordChunkAffected refuses a commit the repository does not carry', () => {
  const { repoRoot, treeRoot } = makeSealedProject();
  assert.throws(() => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', 'deadbee'), /carries no object "deadbee"/);
});

// A chunk sealed as the repository's FIRST commit has no parent to diff
// against, and `git diff-tree` prints nothing at all for one unless it is asked
// to treat it as a root — silently, exit 0, which would read as "this chunk
// affected nothing".
test('a chunk sealed as the root commit still yields its affected journeys', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-root-'));
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(repoRoot, 'test'));
  fs.writeFileSync(path.join(repoRoot, J1.script_path), 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'the first chunk');
  const treeRoot = path.join(repoRoot, 'tree');
  writeAtomic(path.join(treeRoot, 'verification', 'journeys.json'), { schema_version: 1, journeys: [J1] });

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', git('rev-parse', 'HEAD').trim());

  assert.deepEqual(result.journey_ids, [J1.journey_id]);
  assert.deepEqual(readJson(AFFECTED_MAP_PATH(treeRoot), null).entries, [
    { journey_id: J1.journey_id, affected_by: ['M1/C1'], status: 'pending' },
  ]);
});

test('recordChunkAffected refuses an empty milestone, chunk or commit', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  const commit = seal([J1.script_path], 'C1');
  assert.throws(() => recordChunkAffected(treeRoot, repoRoot, '', 'C1', commit), /milestoneId must be a non-empty string/);
  assert.throws(() => recordChunkAffected(treeRoot, repoRoot, 'M1', '', commit), /chunkId must be a non-empty string/);
  assert.throws(() => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', ''), /commit must be a non-empty string/);
  assert.throws(() => recordChunkAffected('', repoRoot, 'M1', 'C1', commit), /treeRoot must be a non-empty string/);
  assert.throws(() => recordChunkAffected(treeRoot, '', 'M1', 'C1', commit), /repoRoot must be a non-empty string/);
});

// ONLY A GENUINELY NEW AFFECTER REOPENS. A replay of a chunk-green whose
// affecter the map already carries is bookkeeping that already happened, and
// re-driving it must not undo a verdict some later verification pass reached:
// resetting the status would rewrite the file, move `generated_at`, and put
// resolved work back at the front of `orderRun`'s queue. The pair that makes
// this discriminating is the test just above — a DIFFERENT chunk touching the
// same resolved journey still reopens it.
test('a replayed affecter never reopens a journey the map has since resolved', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  const commit = seal([J1.script_path], 'C1');
  recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit);
  // The verdict a later verification pass reached, written by the one
  // sanctioned writer rather than assembled by hand.
  const resolved = readJson(AFFECTED_MAP_PATH(treeRoot), null).entries.map((entry) => ({ ...entry, status: 'green' }));
  recordAffected(treeRoot, resolved);
  const before = stampOf(AFFECTED_MAP_PATH(treeRoot));

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit);

  assert.equal(result.state, 'already-recorded');
  assert.equal(stampOf(AFFECTED_MAP_PATH(treeRoot)), before, 'the replay reopened work that was already resolved');
  assert.equal(readJson(AFFECTED_MAP_PATH(treeRoot), null).entries[0].status, 'green');
});

test('a replayed affecter never reopens a journey the map has quarantined', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  const commit = seal([J1.script_path], 'C1');
  recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit);
  recordAffected(treeRoot, [{ journey_id: J1.journey_id, affected_by: ['M1/C1'], status: 'quarantined' }]);
  const before = stampOf(AFFECTED_MAP_PATH(treeRoot));

  recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit);

  assert.equal(stampOf(AFFECTED_MAP_PATH(treeRoot)), before, 'the replay reopened a quarantined journey');
});

// A MALFORMED ENTRY FAILS CLOSED, which an absent catalog deliberately does
// not. An entry whose `script_path` is missing or empty matches no changed path
// and would otherwise read as "this journey was not affected" — the same
// silent-falsy class the blob-commit guard exists for, one level further in.
test('a catalog ENTRY this module cannot read is refused, never skipped as unaffected', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject({
    catalog: [J1, { journey_id: 'J-2', criterion_id: 'ACR-2', harness: 'node-test', added_in_milestone: 'M1' }],
  });

  assert.throws(
    () => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1')),
    /catalog entry/
  );
  assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false, 'a refused catalog still wrote a map');
});

test('a catalog entry with no journey_id, or none at all, is refused the same way', () => {
  const withoutId = makeSealedProject({
    catalog: [{ script_path: J1.script_path, criterion_id: 'ACR-1', harness: 'node-test', added_in_milestone: 'M1' }],
  });
  assert.throws(
    () => recordChunkAffected(withoutId.treeRoot, withoutId.repoRoot, 'M1', 'C1', withoutId.seal([J1.script_path], 'C1')),
    /catalog entry/
  );

  const notAnObject = makeSealedProject({ catalog: [J1, 'J-2'] });
  assert.throws(
    () => recordChunkAffected(notAnObject.treeRoot, notAnObject.repoRoot, 'M1', 'C1', notAnObject.seal([J1.script_path], 'C1')),
    /catalog entry/
  );
});

// THE FLOOR IS THE CATALOG'S OWN FLOOR, FIELD FOR FIELD. "Readable" is not
// "has two of its five fields": `assembleSuite` is what will later run this
// catalog, and an entry it would refuse is an entry this rung must not settle
// on. Every field class below is DISCRIMINATING — the entry names a script the
// commit never changed, so a guard that lets it through reports the rung
// "unaffected" and exits 0.
test('a catalog entry whose script_path is unsafe or uncontained is refused, not read as unaffected', () => {
  for (const scriptPath of ['../outside/j2.test.js', '/tmp/j2.test.js', 'test/j2.test.js; exit 0', 'test/jé.test.js']) {
    const { repoRoot, treeRoot, seal } = makeSealedProject({
      catalog: [J1, { journey_id: 'J-2', criterion_id: 'ACR-2', script_path: scriptPath, harness: 'node-test', added_in_milestone: 'M1' }],
    });
    assert.throws(
      () => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1')),
      /catalog entry/,
      `an entry with script_path ${JSON.stringify(scriptPath)} settled the rung`
    );
    assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false, 'a refused catalog still wrote a map');
  }
});

test('a catalog entry whose harness is missing or outside the closed set is refused', () => {
  for (const harness of [undefined, 'bash', '', 7]) {
    const entry = { journey_id: 'J-2', criterion_id: 'ACR-2', script_path: 'test/j2.test.js', added_in_milestone: 'M1' };
    if (harness !== undefined) entry.harness = harness;
    const { repoRoot, treeRoot, seal } = makeSealedProject({ catalog: [J1, entry] });
    assert.throws(
      () => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1')),
      /catalog entry/,
      `an entry with harness ${JSON.stringify(harness)} settled the rung`
    );
    assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false, 'a refused catalog still wrote a map');
  }
});

test('a catalog entry with no criterion_id, or no added_in_milestone, is refused', () => {
  const noCriterion = makeSealedProject({
    catalog: [J1, { journey_id: 'J-2', script_path: 'test/j2.test.js', harness: 'node-test', added_in_milestone: 'M1' }],
  });
  assert.throws(
    () => recordChunkAffected(noCriterion.treeRoot, noCriterion.repoRoot, 'M1', 'C1', noCriterion.seal([J1.script_path], 'C1')),
    /catalog entry/
  );
  assert.equal(fs.existsSync(AFFECTED_MAP_PATH(noCriterion.treeRoot)), false, 'a refused catalog still wrote a map');

  const noMilestone = makeSealedProject({
    catalog: [J1, { journey_id: 'J-2', criterion_id: 'ACR-2', script_path: 'test/j2.test.js', harness: 'node-test' }],
  });
  assert.throws(
    () => recordChunkAffected(noMilestone.treeRoot, noMilestone.repoRoot, 'M1', 'C1', noMilestone.seal([J1.script_path], 'C1')),
    /catalog entry/
  );
  assert.equal(fs.existsSync(AFFECTED_MAP_PATH(noMilestone.treeRoot)), false, 'a refused catalog still wrote a map');
});

// THE SELF-AUTHORED JOURNEY, AND WHY IT CANNOT COME FROM THE CATALOG. This
// write happens at chunk-green, and the catalog entry for a journey the chunk
// itself authored is not written until the post-seal rung that follows. The
// chunk plan's own nomination — the same durable record `journeys.js` later
// catalogues from — is what makes it knowable here.
test("a chunk's own nominated journey is affected before its catalog entry exists", () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject({ catalog: [J0] });
  const nomination = { journey_id: J1.journey_id, script_path: J1.script_path, harness: 'node-test' };

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1'), nomination);

  assert.equal(result.state, 'recorded');
  assert.deepEqual(result.journey_ids, [J1.journey_id]);
  assert.deepEqual(readJson(AFFECTED_MAP_PATH(treeRoot), null).entries, [
    { journey_id: J1.journey_id, affected_by: ['M1/C1'], status: 'pending' },
  ]);
});

test('the very first journey in a build is affected by its own chunk, with no catalog on disk yet', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject({ catalog: null });
  const nomination = { journey_id: J1.journey_id, script_path: J1.script_path, harness: 'node-test' };

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1'), nomination);

  assert.equal(result.state, 'recorded');
  assert.deepEqual(readJson(AFFECTED_MAP_PATH(treeRoot), null).entries, [
    { journey_id: J1.journey_id, affected_by: ['M1/C1'], status: 'pending' },
  ]);
});

// The nomination is held to the SAME rule as a catalogued entry rather than
// trusted: what a chunk affected is what its commit touched, and a nominated
// script this commit never changed is not this chunk's doing.
test('a nominated journey whose script this commit did not touch is not affected by it', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject({ catalog: [J0] });
  const nomination = { journey_id: J1.journey_id, script_path: J1.script_path, harness: 'node-test' };

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([], 'C1 touched nothing'), nomination);

  assert.equal(result.state, 'unaffected');
  assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false);
});

test('a nomination already carried by the catalog yields one entry, not two', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  const nomination = { journey_id: J1.journey_id, script_path: J1.script_path, harness: 'node-test' };

  const result = recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1'), nomination);

  assert.deepEqual(result.journey_ids, [J1.journey_id]);
  assert.deepEqual(readJson(AFFECTED_MAP_PATH(treeRoot), null).entries, [
    { journey_id: J1.journey_id, affected_by: ['M1/C1'], status: 'pending' },
  ]);
});

test('a nomination this module cannot read is refused, like a catalog entry', () => {
  const { repoRoot, treeRoot, seal } = makeSealedProject();
  const commit = seal([J1.script_path], 'C1');

  assert.throws(
    () => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit, { journey_id: 'J-1' }),
    /journey nomination/
  );
  assert.throws(
    () => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', commit, { script_path: J1.script_path }),
    /journey nomination/
  );
  assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false);
});

// THE NOMINATION IS HELD TO THE SHAPE ITS OWN WRITER ENFORCES. `journeys.js`
// will refuse exactly these nominations one rung later, and `promotion.js`
// refuses them at the plan gate — a nomination this rung waves through is one
// that settles "unaffected" now and blocks the catalog write afterwards, with
// the rung that decided it already sealed.
test('a nomination whose script_path is unsafe or uncontained is refused, not read as unaffected', () => {
  for (const scriptPath of ['../outside/j1.test.js', '/tmp/j1.test.js', 'test/j1.test.js; exit 0', 'test/j1é.test.js']) {
    const { repoRoot, treeRoot, seal } = makeSealedProject({ catalog: [J0] });
    assert.throws(
      () => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1'), {
        journey_id: J1.journey_id,
        script_path: scriptPath,
        harness: 'node-test',
      }),
      /journey nomination/,
      `a nomination with script_path ${JSON.stringify(scriptPath)} settled the rung`
    );
    assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false, 'a refused nomination still wrote a map');
  }
});

test('a nomination whose harness is missing or outside the closed set is refused', () => {
  for (const harness of [undefined, 'bash', '', 7]) {
    const { repoRoot, treeRoot, seal } = makeSealedProject({ catalog: [J0] });
    const nomination = { journey_id: J1.journey_id, script_path: J1.script_path };
    if (harness !== undefined) nomination.harness = harness;
    assert.throws(
      () => recordChunkAffected(treeRoot, repoRoot, 'M1', 'C1', seal([J1.script_path], 'C1'), nomination),
      /journey nomination/,
      `a nomination with harness ${JSON.stringify(harness)} settled the rung`
    );
    assert.equal(fs.existsSync(AFFECTED_MAP_PATH(treeRoot)), false, 'a refused nomination still wrote a map');
  }
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
