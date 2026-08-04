'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { spawnSync } = require('node:child_process');

const { assembleLastMile, renderFacts, checkDeliveryReady, recordPark } = require('../src/delivery.js');
const { readJson, writeAtomic } = require('../src/atomic-json.js');
const { appendRecord } = require('../src/stream.js');
const { startRun, recordRun, computeSuiteState } = require('../src/verification.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'delivery.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-test-'));
}

function stampGateEvidence(ledgerPath, gateId, exitCode = 0) {
  appendRecord(ledgerPath, {
    kind: 'gate',
    payload: { gate_id: gateId, cmd: 'x', exit_code: exitCode },
    correlation_id: gateId,
  });
}

// Drives a real green suite-state.json + runs-index.json into `tmp`, the
// same machinery verification.test.js itself uses — never a hand-rolled
// shortcut that could drift from the real writer's shape.
function makeGreenSuiteState(tmp, runId = 'run-1') {
  const suite = [{ journey_id: 'a', criterion_id: 'c1', script_path: 'test/c1.test.js', harness: 'node-test', added_in_milestone: 'M1' }];
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  startRun(tmp, runId, suite);
  stampGateEvidence(ledgerPath, 'gate-a');
  recordRun(tmp, runId, [{ journey_id: 'a', status: 'pass', duration_ms: 1, gate_id: 'gate-a' }], ledgerPath);
  return computeSuiteState(tmp, runId, { schema_version: 1, entries: [] }, suite);
}

// ---------- assembleLastMile ----------

test('assembleLastMile on an empty tree writes a well-formed empty document', () => {
  const tmp = mkTmpDir();
  const doc = assembleLastMile(tmp);

  assert.equal(doc.schema_version, 1);
  assert.equal(doc.generated_from_run, null);
  assert.deepEqual(doc.items, []);
  assert.deepEqual(doc.counts, {
    total: 0,
    last_mile_parks: 0,
    quarantine_entries: 0,
    fix_attempts_at_cap: 0,
    verification_reports: 0,
    milestones_not_green: 0,
  });

  const onDisk = readJson(path.join(tmp, 'delivery', 'last-mile.json'));
  assert.deepEqual(onDisk, doc);
});

test('assembleLastMile throws on a missing/invalid treeRoot', () => {
  assert.throws(() => assembleLastMile(''), TypeError);
  assert.throws(() => assembleLastMile(undefined), TypeError);
});

test('assembleLastMile surfaces last-mile.jsonl "park" records with a file+seq source pointer', () => {
  const tmp = mkTmpDir();
  const lastMilePath = path.join(tmp, 'last-mile.jsonl');
  appendRecord(lastMilePath, { kind: 'genesis', payload: {}, correlation_id: null });
  const seq = appendRecord(lastMilePath, {
    kind: 'park',
    payload: { summary: 'Deferred: rate-limit UI copy', severity: 'low', owner_phase: 'implementation' },
    correlation_id: null,
  });

  const doc = assembleLastMile(tmp);
  assert.equal(doc.items.length, 1);
  const item = doc.items[0];
  assert.deepEqual(item.source, { file: 'last-mile.jsonl', seq });
  assert.equal(item.id, `park-${seq}`);
  assert.equal(item.summary, 'Deferred: rate-limit UI copy');
  assert.equal(item.severity, 'low');
  assert.equal(item.owner_phase, 'implementation');
  assert.equal(doc.counts.last_mile_parks, 1);
  assert.equal(doc.counts.total, 1);
});

test('assembleLastMile ignores non-"park" kinds on last-mile.jsonl (genesis, or anything else)', () => {
  const tmp = mkTmpDir();
  const lastMilePath = path.join(tmp, 'last-mile.jsonl');
  appendRecord(lastMilePath, { kind: 'genesis', payload: {}, correlation_id: null });
  appendRecord(lastMilePath, { kind: 'something-else', payload: {}, correlation_id: null });

  const doc = assembleLastMile(tmp);
  assert.deepEqual(doc.items, []);
});

test('assembleLastMile surfaces quarantine.json entries, both pending and decided, with a file+path source pointer', () => {
  const tmp = mkTmpDir();
  writeAtomic(path.join(tmp, 'verification', 'quarantine.json'), {
    schema_version: 1,
    entries: [
      { journey_id: 'j-pending', since_run: 'run-1', reason: 'intermittent timeout', history: [{ outcome: 'fail', run_id: 'run-1' }] },
      {
        journey_id: 'j-decided',
        since_run: 'run-1',
        reason: null,
        history: [
          { outcome: 'fail', run_id: 'run-1' },
          { outcome: 'pass', run_id: 'run-2' },
        ],
      },
    ],
  });

  const doc = assembleLastMile(tmp);
  assert.equal(doc.items.length, 2);
  assert.equal(doc.counts.quarantine_entries, 2);

  const pending = doc.items.find((i) => i.id === 'quarantine-j-pending');
  assert.deepEqual(pending.source, { file: path.join('verification', 'quarantine.json'), path: 'j-pending' });
  assert.equal(pending.severity, 'pending');
  assert.match(pending.summary, /intermittent timeout/);

  const decided = doc.items.find((i) => i.id === 'quarantine-j-decided');
  assert.equal(decided.severity, 'quarantined');
});

test('assembleLastMile surfaces fix-attempts.jsonl problem_keys that reached the fix-loop cap, and no others', () => {
  const tmp = mkTmpDir();
  const attemptsPath = path.join(tmp, 'verification', 'fix-attempts.jsonl');
  appendRecord(attemptsPath, { kind: 'fix-attempt', payload: { problem_key: 'flaky-login' }, correlation_id: 'flaky-login' });
  const secondSeq = appendRecord(attemptsPath, { kind: 'fix-attempt', payload: { problem_key: 'flaky-login' }, correlation_id: 'flaky-login' });
  appendRecord(attemptsPath, { kind: 'fix-attempt', payload: { problem_key: 'under-cap' }, correlation_id: 'under-cap' });

  const doc = assembleLastMile(tmp);
  assert.equal(doc.counts.fix_attempts_at_cap, 1);
  const item = doc.items.find((i) => i.id === 'fix-cap-flaky-login');
  assert.ok(item);
  assert.deepEqual(item.source, { file: path.join('verification', 'fix-attempts.jsonl'), seq: secondSeq });
  assert.equal(item.severity, 'blocking');
  assert.ok(!doc.items.some((i) => i.id === 'fix-cap-under-cap'));
});

test('assembleLastMile presence-references verification/*.md files without parsing their content', () => {
  const tmp = mkTmpDir();
  fs.mkdirSync(path.join(tmp, 'verification'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'verification', 'security-scan-2026-07-27.md'),
    '# Security scan\n\nCRITICAL: fabricated-for-test finding that must never be echoed verbatim.'
  );

  const doc = assembleLastMile(tmp);
  assert.equal(doc.counts.verification_reports, 1);
  const item = doc.items.find((i) => i.id === 'verification-report-security-scan-2026-07-27.md');
  assert.ok(item);
  assert.deepEqual(item.source, { file: path.join('verification', 'security-scan-2026-07-27.md') });
  assert.ok(!item.summary.includes('fabricated-for-test'));
});

test('assembleLastMile surfaces milestones/index.json entries not status "green", and excludes green ones', () => {
  const tmp = mkTmpDir();
  writeAtomic(path.join(tmp, 'milestones', 'index.json'), {
    schema_version: 1,
    milestones: [
      { id: 'M1', title: 'One', designer_family: 'claude', toolchain_profile: null, status: 'green' },
      { id: 'M2', title: 'Two', designer_family: 'claude', toolchain_profile: null, status: 'open' },
    ],
  });

  const doc = assembleLastMile(tmp);
  assert.equal(doc.counts.milestones_not_green, 1);
  const item = doc.items.find((i) => i.id === 'milestone-M2');
  assert.ok(item);
  assert.deepEqual(item.source, { file: path.join('milestones', 'index.json'), path: 'M2' });
  assert.ok(!doc.items.some((i) => i.id === 'milestone-M1'));
});

test('assembleLastMile stamps generated_from_run from verification/suite-state.json when present', () => {
  const tmp = mkTmpDir();
  makeGreenSuiteState(tmp, 'run-42');

  const doc = assembleLastMile(tmp);
  assert.equal(doc.generated_from_run, 'run-42');
});

test('every assembleLastMile item carries a source pointer naming a file', () => {
  const tmp = mkTmpDir();
  appendRecord(path.join(tmp, 'last-mile.jsonl'), { kind: 'park', payload: { summary: 'x', severity: 'low' }, correlation_id: null });
  writeAtomic(path.join(tmp, 'verification', 'quarantine.json'), {
    schema_version: 1,
    entries: [{ journey_id: 'j1', since_run: 'r1', reason: null, history: [{ outcome: 'fail', run_id: 'r1' }] }],
  });
  writeAtomic(path.join(tmp, 'milestones', 'index.json'), {
    schema_version: 1,
    milestones: [{ id: 'M1', title: 'One', designer_family: 'claude', toolchain_profile: null, status: 'open' }],
  });

  const doc = assembleLastMile(tmp);
  assert.ok(doc.items.length >= 3);
  for (const item of doc.items) {
    assert.ok(typeof item.source === 'object' && item.source !== null);
    assert.ok(typeof item.source.file === 'string' && item.source.file.length > 0);
  }
});

// ---------- renderFacts ----------

test('renderFacts throws when delivery/last-mile.json does not exist yet', () => {
  const tmp = mkTmpDir();
  assert.throws(() => renderFacts(tmp), /last-mile\.json/);
});

test('renderFacts throws on a missing/invalid treeRoot', () => {
  assert.throws(() => renderFacts(''), TypeError);
});

test('renderFacts writes DATA-only facts: phase-transitions, suite-state, milestones, last-mile-counts, each with source provenance', () => {
  const tmp = mkTmpDir();
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  const seq1 = appendRecord(ledgerPath, { kind: 'phase-transition', payload: { from: 'implementation', to: 'verification' }, correlation_id: 'verification' });
  const seq2 = appendRecord(ledgerPath, { kind: 'phase-transition', payload: { from: 'verification', to: 'delivery' }, correlation_id: 'delivery' });
  const suiteState = makeGreenSuiteState(tmp);
  writeAtomic(path.join(tmp, 'milestones', 'index.json'), {
    schema_version: 1,
    milestones: [{ id: 'M1', title: 'One', designer_family: 'claude', toolchain_profile: null, status: 'green' }],
  });
  assembleLastMile(tmp);

  const doc = renderFacts(tmp);
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.generated_from_run, 'run-1');
  assert.ok(Array.isArray(doc.facts));

  const transitions = doc.facts.filter((f) => f.kind === 'phase-transition');
  assert.equal(transitions.length, 2);
  assert.deepEqual(
    transitions.map((f) => [f.from, f.to]),
    [
      ['implementation', 'verification'],
      ['verification', 'delivery'],
    ]
  );
  assert.deepEqual(transitions[0].source, { file: 'ledger.jsonl', seq: seq1 });
  assert.deepEqual(transitions[1].source, { file: 'ledger.jsonl', seq: seq2 });
  for (const f of transitions) {
    assert.equal(typeof f.ts, 'string');
  }

  // Every fact carries {file, ...} source provenance, no exceptions.
  for (const f of doc.facts) {
    assert.equal(typeof f.kind, 'string');
    assert.ok(typeof f.source === 'object' && f.source !== null);
    assert.ok(typeof f.source.file === 'string' && f.source.file.length > 0);
    assert.ok(f.ts === null || typeof f.ts === 'string');
  }

  const suiteFacts = doc.facts.filter((f) => f.kind === 'suite-state');
  assert.equal(suiteFacts.length, 1);
  assert.equal(suiteFacts[0].status, 'green');
  assert.equal(suiteFacts[0].run_id, 'run-1');
  assert.deepEqual(suiteFacts[0].source, { file: path.join('verification', 'suite-state.json') });
  // computeSuiteState stamps its own "ts" — cited verbatim, never re-derived.
  assert.equal(suiteFacts[0].ts, suiteState.ts);

  const milestoneFacts = doc.facts.filter((f) => f.kind === 'milestone');
  assert.equal(milestoneFacts.length, 1);
  assert.equal(milestoneFacts[0].id, 'M1');
  assert.equal(milestoneFacts[0].status, 'green');
  assert.deepEqual(milestoneFacts[0].source, { file: path.join('milestones', 'index.json'), path: 'M1' });
  // milestones/index.json entries carry no recorded timestamp field
  // (createMilestone/closeMilestone never stamp one) — ts must be honestly
  // null, never a render-time substitute.
  assert.equal(milestoneFacts[0].ts, null);

  const countsFacts = doc.facts.filter((f) => f.kind === 'last-mile-counts');
  assert.equal(countsFacts.length, 1);
  assert.deepEqual(countsFacts[0].counts, readJson(path.join(tmp, 'delivery', 'last-mile.json')).counts);
  assert.deepEqual(countsFacts[0].source, { file: path.join('delivery', 'last-mile.json') });
  // last-mile.json carries no timestamp field either — same law.
  assert.equal(countsFacts[0].ts, null);

  const onDisk = readJson(path.join(tmp, 'delivery', 'facts.json'));
  assert.deepEqual(onDisk, doc);
});

test('renderFacts on a tree with no recorded timestamps fabricates none — every fact is ts:null or a value read verbatim from a recorded field', () => {
  const tmp = mkTmpDir();
  // No ledger.jsonl, no verification/suite-state.json, no milestones — only
  // the one input renderFacts requires (last-mile.json, itself carrying no
  // timestamp field).
  assembleLastMile(tmp);

  const doc = renderFacts(tmp);
  assert.equal(doc.generated_from_run, null);
  assert.ok(doc.facts.length >= 1);
  for (const f of doc.facts) {
    assert.ok(f.ts === null || typeof f.ts === 'string');
    assert.ok(typeof f.source === 'object' && f.source !== null);
    assert.ok(typeof f.source.file === 'string' && f.source.file.length > 0);
  }
  const countsFacts = doc.facts.filter((f) => f.kind === 'last-mile-counts');
  assert.equal(countsFacts.length, 1);
  assert.equal(countsFacts[0].ts, null);
});

test('renderFacts bounds the phase-transition view (never the raw ledger stream)', () => {
  const tmp = mkTmpDir();
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  for (let i = 0; i < 150; i++) {
    appendRecord(ledgerPath, { kind: 'phase-transition', payload: { from: `p${i}`, to: `p${i + 1}` }, correlation_id: null });
  }
  writeAtomic(path.join(tmp, 'delivery', 'last-mile.json'), { schema_version: 1, generated_from_run: null, items: [], counts: { total: 0 } });

  const doc = renderFacts(tmp);
  const transitions = doc.facts.filter((f) => f.kind === 'phase-transition');
  assert.ok(transitions.length < 150);
  assert.equal(transitions[transitions.length - 1].to, 'p150');
});

// ---------- checkDeliveryReady ----------

test('checkDeliveryReady reports not-ok with named gaps on a bare tree', () => {
  const tmp = mkTmpDir();
  const { ok, missing } = checkDeliveryReady(tmp);
  assert.equal(ok, false);
  assert.ok(missing.length >= 3);
});

test('checkDeliveryReady reports ok once suite is green+current and both delivery JSON artifacts exist', () => {
  const tmp = mkTmpDir();
  makeGreenSuiteState(tmp);
  assembleLastMile(tmp);
  renderFacts(tmp);

  const { ok, missing } = checkDeliveryReady(tmp);
  assert.equal(ok, true);
  assert.deepEqual(missing, []);
});

test('checkDeliveryReady fails closed on a stale (superseded) suite-state green — run-currency, not just status', () => {
  const tmp = mkTmpDir();
  makeGreenSuiteState(tmp, 'run-1');
  assembleLastMile(tmp);
  renderFacts(tmp);
  // A second, later run starts (and is never computed to green) — the
  // persisted suite-state.json from run-1 is now stale.
  startRun(tmp, 'run-2', [{ journey_id: 'a', criterion_id: 'c1', script_path: 'test/c1.test.js', harness: 'node-test', added_in_milestone: 'M1' }]);

  const { ok, missing } = checkDeliveryReady(tmp);
  assert.equal(ok, false);
  assert.ok(missing.some((m) => /suite-state-green/.test(m)));
});

test('checkDeliveryReady throws on a missing/invalid treeRoot', () => {
  assert.throws(() => checkDeliveryReady(''), TypeError);
});

test('REGRESSION (P9 required revision #1): checkDeliveryReady fails closed on stale delivery projections after a newer run goes green, and re-running assemble+render restores readiness', () => {
  const tmp = mkTmpDir();
  makeGreenSuiteState(tmp, 'run-1');
  assembleLastMile(tmp);
  renderFacts(tmp);
  assert.equal(checkDeliveryReady(tmp).ok, true);

  // A second run starts and is recomputed green — the live suite is now
  // current on run-2, but last-mile.json/facts.json still name run-1.
  makeGreenSuiteState(tmp, 'run-2');
  const stale = checkDeliveryReady(tmp);
  assert.equal(stale.ok, false);
  assert.ok(stale.missing.some((m) => /run-bound.*last-mile\.json/.test(m)));
  assert.ok(stale.missing.some((m) => /run-bound.*facts\.json/.test(m)));

  // Re-generating both projections against the now-current run restores
  // readiness — the fix, not merely the failure, must be provable.
  assembleLastMile(tmp);
  renderFacts(tmp);
  const fresh = checkDeliveryReady(tmp);
  assert.equal(fresh.ok, true);
  assert.deepEqual(fresh.missing, []);
});

// ---------- recordPark (P11 finding F4) ----------

test('recordPark appends a well-formed park record that assembleLastMile then surfaces', () => {
  const tmp = mkTmpDir();
  const { seq, park } = recordPark(tmp, { summary: 'Deferred: rate-limit copy', severity: 'S3' });
  assert.deepEqual(park, { summary: 'Deferred: rate-limit copy', severity: 'S3' });

  const doc = assembleLastMile(tmp);
  assert.equal(doc.items.length, 1);
  assert.deepEqual(doc.items[0].source, { file: 'last-mile.jsonl', seq });
  assert.equal(doc.items[0].summary, 'Deferred: rate-limit copy');
  assert.equal(doc.items[0].severity, 'S3');
});

test('recordPark carries an optional ownerPhase through to owner_phase', () => {
  const tmp = mkTmpDir();
  recordPark(tmp, { summary: 'x', severity: 'S2', ownerPhase: 'implementation' });
  const doc = assembleLastMile(tmp);
  assert.equal(doc.items[0].owner_phase, 'implementation');
});

test('recordPark throws a TypeError and writes nothing for a malformed park', () => {
  const tmp = mkTmpDir();
  assert.throws(() => recordPark(tmp, { summary: '', severity: 'S2' }), TypeError);
  assert.equal(fs.existsSync(path.join(tmp, 'last-mile.jsonl')), false);
});

test('recordPark throws a TypeError for a missing/invalid treeRoot', () => {
  assert.throws(() => recordPark('', { summary: 'x', severity: 'S2' }), TypeError);
  assert.throws(() => recordPark(undefined, { summary: 'x', severity: 'S2' }), TypeError);
});

// ---------- CLI: park (P11 finding F4 — the blocker ladder's S2/S3 outcome
// named last-mile.jsonl but no mechanism ever wrote it) ----------

test('CLI: park reads the park JSON from stdin and appends it', () => {
  const tmp = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'park', tmp], {
    encoding: 'utf8',
    input: JSON.stringify({ summary: 'Deferred: x', severity: 'S2', owner_phase: 'verification' }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.deepEqual(printed.park, { summary: 'Deferred: x', severity: 'S2', owner_phase: 'verification' });

  const doc = assembleLastMile(tmp);
  assert.equal(doc.items.length, 1);
  assert.equal(doc.items[0].owner_phase, 'verification');
});

test('CLI: park exits 1 and writes nothing for a malformed park', () => {
  const tmp = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'park', tmp], {
    encoding: 'utf8',
    input: JSON.stringify({ summary: '' }),
  });
  assert.equal(proc.status, 1);
  assert.equal(fs.existsSync(path.join(tmp, 'last-mile.jsonl')), false);
});

// CLI adapter parity (P11 Sol review finding 5): recordPark itself only ever
// reconstructs {summary, severity, owner_phase} from the parsed stdin
// object, so an extra key on the raw input silently never reached
// validatePark's own extra-key check at all — the adapter, not the library,
// must validate the parsed object's actual key set before writing.
test('CLI: park exits 1 and writes nothing for a park carrying an unexpected extra key', () => {
  const tmp = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'park', tmp], {
    encoding: 'utf8',
    input: JSON.stringify({ summary: 'Deferred: x', severity: 'S2', unexpected: 'smuggled-field' }),
  });
  assert.equal(proc.status, 1);
  assert.equal(fs.existsSync(path.join(tmp, 'last-mile.jsonl')), false);
});

test('CLI: park exits 1 on invalid JSON via stdin', () => {
  const tmp = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'park', tmp], { encoding: 'utf8', input: 'not json' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /delivery\.js/);
});

test('CLI: unknown command exits 1 and names "park" among the expected commands', () => {
  const tmp = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'delete', tmp], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /park/);
});
