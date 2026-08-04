'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { project, projectFile } = require('../src/projection.js');
const { appendLine } = require('../src/jsonl.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'projection-test-'));
}

// --- project(records, spec) ---------------------------------------------

test('project: empty input returns zeroed envelope', () => {
  const result = project([], {});
  assert.deepEqual(result, { view: [], total: 0, kept: 0, dropped: 0 });
});

test('project: no spec clauses passes every record through untouched', () => {
  const records = [{ kind: 'a', v: 1 }, { kind: 'b', v: 2 }, { kind: 'a', v: 3 }];
  const result = project(records, {});
  assert.deepEqual(result.view, records);
  assert.equal(result.total, 3);
  assert.equal(result.kept, 3);
  assert.equal(result.dropped, 0);
});

test('project: kind filter keeps only records whose kind is included', () => {
  const records = [
    { kind: 'tool_call', v: 1 },
    { kind: 'message', v: 2 },
    { kind: 'tool_call', v: 3 },
    { kind: 'error', v: 4 },
  ];
  const result = project(records, { kinds: ['tool_call', 'error'] });
  assert.deepEqual(result.view, [
    { kind: 'tool_call', v: 1 },
    { kind: 'tool_call', v: 3 },
    { kind: 'error', v: 4 },
  ]);
  assert.equal(result.total, 4);
  assert.equal(result.kept, 3);
  assert.equal(result.dropped, 1);
});

test('project: kind filter with no matches yields empty view but preserves total', () => {
  const records = [{ kind: 'a' }, { kind: 'b' }];
  const result = project(records, { kinds: ['zzz'] });
  assert.deepEqual(result.view, []);
  assert.equal(result.total, 2);
  assert.equal(result.kept, 0);
  assert.equal(result.dropped, 2);
});

test('project: kinds absent keeps all records regardless of kind field', () => {
  const records = [{ kind: 'a' }, { no_kind_field: true }, { kind: 'b' }];
  const result = project(records, {});
  assert.equal(result.kept, 3);
});

test('project: lastN keeps only the final N records in chronological order', () => {
  const records = [
    { kind: 'e', seq: 1 },
    { kind: 'e', seq: 2 },
    { kind: 'e', seq: 3 },
    { kind: 'e', seq: 4 },
    { kind: 'e', seq: 5 },
  ];
  const result = project(records, { lastN: 2 });
  assert.deepEqual(result.view, [{ kind: 'e', seq: 4 }, { kind: 'e', seq: 5 }]);
  assert.equal(result.total, 5);
  assert.equal(result.kept, 2);
  assert.equal(result.dropped, 3);
});

test('project: lastN applies AFTER kind filter, not before', () => {
  const records = [
    { kind: 'keep', seq: 1 },
    { kind: 'drop', seq: 2 },
    { kind: 'keep', seq: 3 },
    { kind: 'drop', seq: 4 },
    { kind: 'keep', seq: 5 },
  ];
  // kind filter first -> [keep1, keep3, keep5]; lastN=2 -> [keep3, keep5]
  const result = project(records, { kinds: ['keep'], lastN: 2 });
  assert.deepEqual(result.view, [{ kind: 'keep', seq: 3 }, { kind: 'keep', seq: 5 }]);
  assert.equal(result.total, 5);
  assert.equal(result.kept, 2);
  assert.equal(result.dropped, 3);
});

test('project: lastN larger than the filtered set keeps everything, order intact', () => {
  const records = [{ kind: 'e', seq: 1 }, { kind: 'e', seq: 2 }];
  const result = project(records, { lastN: 100 });
  assert.deepEqual(result.view, records);
  assert.equal(result.kept, 2);
  assert.equal(result.dropped, 0);
});

test('project: lastN of 0 keeps nothing', () => {
  const records = [{ kind: 'e', seq: 1 }, { kind: 'e', seq: 2 }];
  const result = project(records, { lastN: 0 });
  assert.deepEqual(result.view, []);
  assert.equal(result.kept, 0);
  assert.equal(result.dropped, 2);
});

test('project: fields picks only the named fields, in the order given, per record', () => {
  const records = [
    { kind: 'a', v: 1, extra: 'x', nested: { z: 1 } },
    { kind: 'b', v: 2, extra: 'y', nested: { z: 2 } },
  ];
  const result = project(records, { fields: ['v', 'kind'] });
  assert.deepEqual(result.view, [
    { v: 1, kind: 'a' },
    { v: 2, kind: 'b' },
  ]);
  assert.equal(Object.keys(result.view[0]).join(','), 'v,kind');
});

test('project: fields omits keys absent from the source record instead of inserting undefined', () => {
  const records = [{ kind: 'a', v: 1 }, { kind: 'b' }];
  const result = project(records, { fields: ['kind', 'v'] });
  assert.deepEqual(result.view, [{ kind: 'a', v: 1 }, { kind: 'b' }]);
  assert.equal(Object.prototype.hasOwnProperty.call(result.view[1], 'v'), false);
});

test('project: fields absent returns whole records unchanged', () => {
  const records = [{ kind: 'a', v: 1, extra: 'x' }];
  const result = project(records, {});
  assert.deepEqual(result.view, records);
});

test('project: maxBytes evicts the OLDEST kept records first until the view fits', () => {
  // Each record serializes to the same size; force eviction by giving a
  // maxBytes budget that only fits the last 2 of 4 records.
  const records = [
    { kind: 'e', pad: 'a'.repeat(20) },
    { kind: 'e', pad: 'b'.repeat(20) },
    { kind: 'e', pad: 'c'.repeat(20) },
    { kind: 'e', pad: 'd'.repeat(20) },
  ];
  const fullBytes = Buffer.byteLength(JSON.stringify(records), 'utf8');
  // Budget for exactly the last two records plus brackets/commas.
  const budget = Buffer.byteLength(JSON.stringify(records.slice(2)), 'utf8');
  assert.ok(budget < fullBytes, 'test setup sanity: budget must be smaller than full size');
  const result = project(records, { maxBytes: budget });
  assert.deepEqual(result.view, records.slice(2));
  assert.equal(result.total, 4);
  assert.equal(result.kept, 2);
  assert.equal(result.dropped, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(result.view), 'utf8') <= budget);
});

test('project: maxBytes that already fits evicts nothing', () => {
  const records = [{ kind: 'e', v: 1 }, { kind: 'e', v: 2 }];
  const budget = Buffer.byteLength(JSON.stringify(records), 'utf8');
  const result = project(records, { maxBytes: budget });
  assert.deepEqual(result.view, records);
  assert.equal(result.dropped, 0);
});

test('project: maxBytes too small for even one record evicts down to an empty view', () => {
  const records = [{ kind: 'e', v: 1 }, { kind: 'e', v: 2 }];
  const result = project(records, { maxBytes: 1 });
  assert.deepEqual(result.view, []);
  assert.equal(result.total, 2);
  assert.equal(result.kept, 0);
  assert.equal(result.dropped, 2);
});

test('project: maxBytes eviction runs after kind filter, lastN, and field picking', () => {
  const records = [
    { kind: 'keep', v: 1, extra: 'a'.repeat(50) },
    { kind: 'drop', v: 2, extra: 'b'.repeat(50) },
    { kind: 'keep', v: 3, extra: 'c'.repeat(50) },
    { kind: 'keep', v: 4, extra: 'd'.repeat(50) },
  ];
  // kind filter -> [v1, v3, v4]; lastN=2 -> [v3, v4]; fields -> only 'v' kept,
  // which is tiny, so a modest maxBytes should NOT evict anything once
  // 'extra' has already been dropped by field picking.
  const result = project(records, {
    kinds: ['keep'],
    lastN: 2,
    fields: ['v'],
    maxBytes: 50,
  });
  assert.deepEqual(result.view, [{ v: 3 }, { v: 4 }]);
  assert.equal(result.dropped, 2);
});

test('project: maxBytes absent performs no eviction', () => {
  const records = new Array(50).fill(0).map((_, i) => ({ kind: 'e', v: i, pad: 'x'.repeat(500) }));
  const result = project(records, {});
  assert.equal(result.kept, 50);
});

test('project: is deterministic across repeated calls with identical input', () => {
  const records = [
    { kind: 'a', v: 1, extra: 'x'.repeat(30) },
    { kind: 'b', v: 2, extra: 'y'.repeat(30) },
    { kind: 'a', v: 3, extra: 'z'.repeat(30) },
  ];
  const spec = { kinds: ['a', 'b'], lastN: 2, fields: ['kind', 'v'], maxBytes: 40 };
  const first = project(records, spec);
  const second = project(records, spec);
  assert.deepEqual(first, second);
});

test('project: does not mutate the input records array or its elements', () => {
  const records = [{ kind: 'a', v: 1, extra: 'x' }, { kind: 'b', v: 2, extra: 'y' }];
  const snapshot = JSON.parse(JSON.stringify(records));
  project(records, { kinds: ['a'], fields: ['v'], maxBytes: 5 });
  assert.deepEqual(records, snapshot);
});

// --- projectFile(file, spec) ---------------------------------------------

test('projectFile: reads a JSONL file via jsonl.readAll and applies project()', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  appendLine(file, { kind: 'a', v: 1 });
  appendLine(file, { kind: 'b', v: 2 });
  appendLine(file, { kind: 'a', v: 3 });

  const result = projectFile(file, { kinds: ['a'] });
  assert.deepEqual(result.view, [{ kind: 'a', v: 1 }, { kind: 'a', v: 3 }]);
  assert.equal(result.total, 3);
  assert.equal(result.kept, 2);
  assert.equal(result.dropped, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'readErrors'), false);
});

test('projectFile: matches project(records, spec) for an equivalent in-memory array', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const records = [{ kind: 'e', v: 1 }, { kind: 'e', v: 2 }, { kind: 'e', v: 3 }];
  for (const r of records) appendLine(file, r);

  const spec = { lastN: 2, fields: ['v'] };
  assert.deepEqual(projectFile(file, spec), project(records, spec));
});

test('projectFile: a nonexistent file reads as zero records, not an error', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'does-not-exist.jsonl');
  const result = projectFile(file, {});
  assert.deepEqual(result, { view: [], total: 0, kept: 0, dropped: 0 });
});

test('projectFile: readAll parse errors surface as the zeroed passthrough with a readErrors count', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'broken.jsonl');
  fs.writeFileSync(file, '{"kind":"a","v":1}\nnot json\n{"kind":"b","v":2}\nalso not json\n');

  const result = projectFile(file, { kinds: ['a'] });
  assert.deepEqual(result, { view: [], total: 0, kept: 0, dropped: 0, readErrors: 2 });
});

test('projectFile: empty file (zero records, zero errors) behaves like empty project()', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'empty.jsonl');
  fs.writeFileSync(file, '');
  const result = projectFile(file, {});
  assert.deepEqual(result, { view: [], total: 0, kept: 0, dropped: 0 });
});

// ---------- CLI: project-file (P11 convergence finding 3 — kept on this
// module, never a new transcript.js boundary) ----------

const { spawnSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'src', 'projection.js');

test('CLI: project-file reads its spec from stdin and matches projectFile()', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  appendLine(file, { kind: 'a', v: 1 });
  appendLine(file, { kind: 'b', v: 2 });
  appendLine(file, { kind: 'a', v: 3 });

  const proc = spawnSync(process.execPath, [CLI_PATH, 'project-file', file], {
    encoding: 'utf8',
    input: JSON.stringify({ kinds: ['a'] }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), projectFile(file, { kinds: ['a'] }));
});

test('CLI: project-file with an empty {} spec passes every record through', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  appendLine(file, { kind: 'a', v: 1 });
  appendLine(file, { kind: 'b', v: 2 });

  const proc = spawnSync(process.execPath, [CLI_PATH, 'project-file', file], { encoding: 'utf8', input: '{}' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(JSON.parse(proc.stdout).kept, 2);
});

test('CLI: project-file on a nonexistent file reads as zero records, not an error', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'does-not-exist.jsonl');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'project-file', file], { encoding: 'utf8', input: '{}' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), { view: [], total: 0, kept: 0, dropped: 0 });
});

test('CLI: project-file exits 1 on invalid JSON via stdin', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'project-file', file], { encoding: 'utf8', input: 'not json' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^projection\.js: /);
});

test('CLI: project-file exits 1 when a non-object spec is piped via stdin', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'project-file', file], { encoding: 'utf8', input: '[1,2,3]' });
  assert.equal(proc.status, 1);
});

test('CLI: missing file argument prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'project-file'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: projection\.js project-file/);
});

test('CLI: unknown command prints usage and exits 1', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'bogus', file], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: projection\.js project-file/);
});
