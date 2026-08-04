'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { appendRecord, validateRecordHeader, readRecords } = require('../src/stream.js');
const { appendLine } = require('../src/jsonl.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stream-test-'));
}

const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// ---------- appendRecord ----------

test('appendRecord writes a full header plus payload fields, seq 0 for the first record', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'ledger.jsonl');

  const seq = appendRecord(file, { kind: 'gate', payload: { gate_id: 'unit-tests', exit_code: 0 } });
  assert.equal(seq, 0);

  const { records } = readRecords(file);
  assert.equal(records.length, 1);
  const rec = records[0];
  assert.equal(rec.schema_version, 1);
  assert.equal(rec.seq, 0);
  assert.equal(rec.kind, 'gate');
  assert.equal(typeof rec.ts, 'string');
  assert.match(rec.ts, ISO_8601_UTC_RE);
  assert.equal(rec.gate_id, 'unit-tests');
  assert.equal(rec.exit_code, 0);
  assert.equal(rec.correlation_id, null);
});

test('appendRecord includes correlation_id when provided', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'ledger.jsonl');

  appendRecord(file, { kind: 'chunk_review', payload: { verdict: 'pass' }, correlation_id: 'chunk_C03' });

  const { records } = readRecords(file);
  assert.equal(records[0].correlation_id, 'chunk_C03');
});

test('appendRecord auto-increments seq across calls on the same stream via jsonl.appendEvent', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'ledger.jsonl');

  const first = appendRecord(file, { kind: 'a' });
  const second = appendRecord(file, { kind: 'b' });
  assert.equal(first, 0);
  assert.equal(second, 1);
});

test('appendRecord defaults payload to {} when omitted, correlation_id defaults to null', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'ledger.jsonl');

  appendRecord(file, { kind: 'note' });
  const { records } = readRecords(file);
  assert.deepEqual(Object.keys(records[0]).sort(), ['correlation_id', 'kind', 'schema_version', 'seq', 'ts']);
  assert.equal(records[0].correlation_id, null);
});

test('appendRecord throws TypeError for a missing or empty kind', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'ledger.jsonl');
  assert.throws(() => appendRecord(file, {}), TypeError);
  assert.throws(() => appendRecord(file, { kind: '' }), TypeError);
  assert.throws(() => appendRecord(file, { kind: 42 }), TypeError);
});

test('appendRecord throws TypeError when payload is not a plain object', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'ledger.jsonl');
  assert.throws(() => appendRecord(file, { kind: 'note', payload: 'nope' }), TypeError);
  assert.throws(() => appendRecord(file, { kind: 'note', payload: [1, 2] }), TypeError);
});

test('appendRecord throws TypeError when payload attempts to redefine a reserved header field', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'ledger.jsonl');
  assert.throws(() => appendRecord(file, { kind: 'note', payload: { seq: 99 } }), TypeError);
  assert.throws(() => appendRecord(file, { kind: 'note', payload: { schema_version: 2 } }), TypeError);
  assert.throws(() => appendRecord(file, { kind: 'note', payload: { ts: 'x' } }), TypeError);
  assert.throws(() => appendRecord(file, { kind: 'note', payload: { kind: 'other' } }), TypeError);
});

// ---------- validateRecordHeader ----------

test('validateRecordHeader accepts a well-formed header', () => {
  const result = validateRecordHeader({
    schema_version: 1,
    seq: 0,
    kind: 'gate',
    ts: '2026-07-27T12:00:00.000Z',
    correlation_id: null,
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('validateRecordHeader rejects a non-object record', () => {
  assert.equal(validateRecordHeader(null).ok, false);
  assert.equal(validateRecordHeader('nope').ok, false);
  assert.equal(validateRecordHeader([1, 2]).ok, false);
});

test('validateRecordHeader reports missing schema_version', () => {
  const result = validateRecordHeader({ seq: 0, kind: 'gate', ts: '2026-07-27T12:00:00Z' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('schema_version')));
});

test('validateRecordHeader reports missing seq', () => {
  const result = validateRecordHeader({ schema_version: 1, kind: 'gate', ts: '2026-07-27T12:00:00Z' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('seq')));
});

test('validateRecordHeader reports a non-integer or negative seq', () => {
  const negative = validateRecordHeader({ schema_version: 1, seq: -1, kind: 'gate', ts: '2026-07-27T12:00:00Z' });
  assert.equal(negative.ok, false);
  const fractional = validateRecordHeader({ schema_version: 1, seq: 1.5, kind: 'gate', ts: '2026-07-27T12:00:00Z' });
  assert.equal(fractional.ok, false);
});

test('validateRecordHeader reports a missing or empty kind', () => {
  const missing = validateRecordHeader({ schema_version: 1, seq: 0, ts: '2026-07-27T12:00:00Z' });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes('kind')));
  const empty = validateRecordHeader({ schema_version: 1, seq: 0, kind: '', ts: '2026-07-27T12:00:00Z' });
  assert.equal(empty.ok, false);
});

test('validateRecordHeader reports a missing or non-ISO-8601 ts', () => {
  const missing = validateRecordHeader({ schema_version: 1, seq: 0, kind: 'gate' });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes('ts')));
  const bad = validateRecordHeader({ schema_version: 1, seq: 0, kind: 'gate', ts: 'not-a-date' });
  assert.equal(bad.ok, false);
  const notObviouslyIso = validateRecordHeader({ schema_version: 1, seq: 0, kind: 'gate', ts: '07/27/2026' });
  assert.equal(notObviouslyIso.ok, false);
});

test('validateRecordHeader rejects a ts with a numeric offset instead of "Z" (not UTC)', () => {
  const result = validateRecordHeader({
    schema_version: 1,
    seq: 0,
    kind: 'gate',
    ts: '2026-07-27T12:00:00+02:00',
    correlation_id: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('ts')));
});

test('validateRecordHeader rejects a non-1 schema_version', () => {
  const result = validateRecordHeader({
    schema_version: 2,
    seq: 0,
    kind: 'gate',
    ts: '2026-07-27T12:00:00Z',
    correlation_id: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('schema_version')));
});

test('validateRecordHeader rejects a seq beyond Number.MAX_SAFE_INTEGER', () => {
  const result = validateRecordHeader({
    schema_version: 1,
    seq: Number.MAX_SAFE_INTEGER + 2,
    kind: 'gate',
    ts: '2026-07-27T12:00:00Z',
    correlation_id: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('seq')));
});

test('validateRecordHeader reports a missing correlation_id', () => {
  const result = validateRecordHeader({ schema_version: 1, seq: 0, kind: 'gate', ts: '2026-07-27T12:00:00Z' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('correlation_id')));
});

test('validateRecordHeader accepts a null correlation_id and a non-empty string correlation_id', () => {
  const withNull = validateRecordHeader({
    schema_version: 1,
    seq: 0,
    kind: 'gate',
    ts: '2026-07-27T12:00:00Z',
    correlation_id: null,
  });
  assert.equal(withNull.ok, true);
  const withString = validateRecordHeader({
    schema_version: 1,
    seq: 0,
    kind: 'gate',
    ts: '2026-07-27T12:00:00Z',
    correlation_id: 'chunk_C03',
  });
  assert.equal(withString.ok, true);
});

test('validateRecordHeader rejects an empty-string correlation_id', () => {
  const result = validateRecordHeader({
    schema_version: 1,
    seq: 0,
    kind: 'gate',
    ts: '2026-07-27T12:00:00Z',
    correlation_id: '',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('correlation_id')));
});

test('validateRecordHeader accumulates multiple errors at once', () => {
  const result = validateRecordHeader({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 5);
});

// ---------- readRecords ----------

test('readRecords reports per-record header violations alongside jsonl parse errors', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');

  appendLine(file, { schema_version: 1, seq: 0, kind: 'good', ts: '2026-07-27T12:00:00Z', correlation_id: null });
  appendLine(file, { schema_version: 1, seq: 1, ts: '2026-07-27T12:00:01Z', correlation_id: null }); // missing kind
  fs.appendFileSync(file, '{not valid json\n');
  appendLine(file, { schema_version: 1, seq: 2, kind: 'also-good', ts: '2026-07-27T12:00:02Z', correlation_id: null });

  const { records, errors, headerViolations } = readRecords(file);
  assert.equal(records.length, 3);
  assert.equal(errors.length, 1);
  assert.equal(headerViolations.length, 1);
  assert.equal(headerViolations[0].index, 1);
  assert.ok(headerViolations[0].errors.some((e) => e.includes('kind')));
});

test('readRecords on a nonexistent file returns empty records/errors/headerViolations', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'missing.jsonl');
  const result = readRecords(file);
  assert.deepEqual(result, { records: [], errors: [], headerViolations: [] });
});
