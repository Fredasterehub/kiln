'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadIndex,
  upsertEntry,
  isFresh,
  listStale,
  requireFreshOrExplain,
  recordGateCheck,
} = require('../src/research-cache.js');
const { readRecords } = require('../src/stream.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'research-cache-test-'));
}

function sourceOf(overrides = {}) {
  return { url: 'https://example.com/doc', fetched_ts: '2026-07-20T10:00:00Z', ...overrides };
}

function entryOf(overrides = {}) {
  return {
    topic: 'chief-researcher-pattern',
    path: 'research/chief-researcher-pattern-2026-07-20.md',
    date: '2026-07-20',
    sources: [sourceOf()],
    ...overrides,
  };
}

// --- loadIndex: missing-index genesis ---

test('loadIndex returns the schema_version:1 empty-entries default when the index file does not exist', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  const index = loadIndex(indexPath);
  assert.deepEqual(index, { schema_version: 1, entries: [] });
});

test('loadIndex does not create the index file on disk merely by being called on a missing path', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  loadIndex(indexPath);
  assert.equal(fs.existsSync(indexPath), false);
});

// --- loadIndex: malformed -> throw with path ---

test('loadIndex throws an error naming the path when the file is not valid JSON', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  fs.writeFileSync(indexPath, '{not valid json');
  assert.throws(() => loadIndex(indexPath), (err) => {
    assert.match(err.message, new RegExp(indexPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return true;
  });
});

test('loadIndex throws an error naming the path when the parsed JSON is not an object', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify([1, 2, 3]));
  assert.throws(() => loadIndex(indexPath), /index.json.*object/);
});

test('loadIndex throws when schema_version does not match', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify({ schema_version: 2, entries: [] }));
  assert.throws(() => loadIndex(indexPath), /schema_version/);
});

test('loadIndex throws when an entry inside a well-formed index is malformed', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify({ schema_version: 1, entries: [{ topic: 'x' }] }));
  assert.throws(() => loadIndex(indexPath), (err) => {
    assert.match(err.message, new RegExp(indexPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return true;
  });
});

test('loadIndex throws when the index on disk contains duplicate topics', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  fs.writeFileSync(
    indexPath,
    JSON.stringify({
      schema_version: 1,
      entries: [entryOf({ topic: 'dupe', date: '2026-07-01' }), entryOf({ topic: 'dupe', date: '2026-07-20' })],
    })
  );
  assert.throws(() => loadIndex(indexPath), /duplicate topic/);
});

test('loadIndex round-trips a well-formed index written by upsertEntry', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  upsertEntry(indexPath, entryOf());
  const index = loadIndex(indexPath);
  assert.equal(index.schema_version, 1);
  assert.equal(index.entries.length, 1);
  assert.equal(index.entries[0].topic, 'chief-researcher-pattern');
});

// --- upsertEntry: shape rejections ---

test('upsertEntry rejects an entry with an empty topic', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(() => upsertEntry(indexPath, entryOf({ topic: '' })), /topic/);
});

test('upsertEntry rejects an entry with a missing path', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  const bad = entryOf();
  delete bad.path;
  assert.throws(() => upsertEntry(indexPath, bad), /path/);
});

test('upsertEntry rejects a non-ISO date', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(() => upsertEntry(indexPath, entryOf({ date: '07/20/2026' })), /date/);
});

test('upsertEntry rejects a syntactically ISO-shaped but impossible calendar date', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(() => upsertEntry(indexPath, entryOf({ date: '2026-13-40' })), /date/);
});

test('upsertEntry rejects Feb 30 as an impossible calendar date (real calendar check, not Date.parse normalization)', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(() => upsertEntry(indexPath, entryOf({ date: '2026-02-30' })), /calendar date/);
});

test('upsertEntry rejects Apr 31 as an impossible calendar date', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(() => upsertEntry(indexPath, entryOf({ date: '2026-04-31' })), /calendar date/);
});

test('upsertEntry rejects Feb 29 in a non-leap year', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(() => upsertEntry(indexPath, entryOf({ date: '2026-02-29' })), /calendar date/);
});

test('upsertEntry accepts Feb 29 in a leap year', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  const result = upsertEntry(indexPath, entryOf({ date: '2024-02-29' }), { nowIso: '2024-03-01T00:00:00Z' });
  assert.equal(result.entries[0].date, '2024-02-29');
});

test('upsertEntry rejects an empty sources array', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(() => upsertEntry(indexPath, entryOf({ sources: [] })), /sources/);
});

test('upsertEntry rejects sources entries missing a url', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(
    () => upsertEntry(indexPath, entryOf({ sources: [sourceOf({ url: '' })] })),
    /url/
  );
});

test('upsertEntry rejects sources entries missing a fetched_ts', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(
    () => upsertEntry(indexPath, entryOf({ sources: [sourceOf({ fetched_ts: '' })] })),
    /fetched_ts/
  );
});

test('upsertEntry rejects a source url that does not parse as a URL at all', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(
    () => upsertEntry(indexPath, entryOf({ sources: [sourceOf({ url: 'not a url' })] })),
    /url/
  );
});

test('upsertEntry rejects a source url with a non-http(s) scheme', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(
    () => upsertEntry(indexPath, entryOf({ sources: [sourceOf({ url: 'ftp://example.com/doc' })] })),
    /url/
  );
});

test('upsertEntry accepts a well-formed https source url', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  const result = upsertEntry(indexPath, entryOf({ sources: [sourceOf({ url: 'https://example.com/doc' })] }));
  assert.equal(result.entries[0].sources[0].url, 'https://example.com/doc');
});

test('upsertEntry rejects a source fetched_ts that is not ISO-8601 parseable', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(
    () => upsertEntry(indexPath, entryOf({ sources: [sourceOf({ fetched_ts: 'not-a-timestamp' })] })),
    /fetched_ts/
  );
});

test('upsertEntry rejects a source fetched_ts that has no time component', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(
    () => upsertEntry(indexPath, entryOf({ sources: [sourceOf({ fetched_ts: '2026-07-20' })] })),
    /fetched_ts/
  );
});

test('upsertEntry rejection leaves no file behind on a brand-new path', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(() => upsertEntry(indexPath, entryOf({ topic: '' })));
  assert.equal(fs.existsSync(indexPath), false);
});

// --- upsertEntry: future-dated entries are rejected (opts.nowIso) ---

test('upsertEntry rejects an entry dated in the future relative to opts.nowIso', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(
    () => upsertEntry(indexPath, entryOf({ date: '2026-08-01' }), { nowIso: '2026-07-27T12:00:00Z' }),
    /future/
  );
});

test('upsertEntry accepts an entry dated exactly today relative to opts.nowIso', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  const result = upsertEntry(indexPath, entryOf({ date: '2026-07-27' }), { nowIso: '2026-07-27T23:59:00Z' });
  assert.equal(result.entries[0].date, '2026-07-27');
});

test('upsertEntry leaves no file behind when rejecting a future-dated entry on a brand-new path', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  assert.throws(() => upsertEntry(indexPath, entryOf({ date: '2026-08-01' }), { nowIso: '2026-07-27T12:00:00Z' }));
  assert.equal(fs.existsSync(indexPath), false);
});

// --- upsertEntry: atomic upsert (insert vs update) ---

test('upsertEntry inserts a new entry into a fresh index', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  const result = upsertEntry(indexPath, entryOf());
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].topic, 'chief-researcher-pattern');
  const onDisk = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.deepEqual(onDisk, result);
});

test('upsertEntry inserts a second, distinct topic alongside the first', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  upsertEntry(indexPath, entryOf({ topic: 'topic-a' }));
  const result = upsertEntry(indexPath, entryOf({ topic: 'topic-b' }));
  assert.equal(result.entries.length, 2);
  assert.deepEqual(
    result.entries.map((e) => e.topic).sort(),
    ['topic-a', 'topic-b']
  );
});

test('upsertEntry updates the existing entry in place when the topic already exists (topic is the key)', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  upsertEntry(indexPath, entryOf({ topic: 'dupe', date: '2026-07-01', path: 'research/dupe-2026-07-01.md' }));
  const result = upsertEntry(
    indexPath,
    entryOf({ topic: 'dupe', date: '2026-07-20', path: 'research/dupe-2026-07-20.md' })
  );
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].date, '2026-07-20');
  assert.equal(result.entries[0].path, 'research/dupe-2026-07-20.md');
});

test('upsertEntry preserves unrelated existing entries when updating one topic', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  upsertEntry(indexPath, entryOf({ topic: 'keep-me' }));
  upsertEntry(indexPath, entryOf({ topic: 'update-me', date: '2026-07-01' }));
  const result = upsertEntry(indexPath, entryOf({ topic: 'update-me', date: '2026-07-20' }));
  assert.equal(result.entries.length, 2);
  const kept = result.entries.find((e) => e.topic === 'keep-me');
  assert.ok(kept);
  assert.equal(kept.date, entryOf().date, 'unrelated entry must be untouched by the update');
});

test('upsertEntry writes valid JSON that survives a process-restart-style re-read (atomic write)', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'index.json');
  for (let i = 0; i < 10; i++) {
    upsertEntry(indexPath, entryOf({ topic: `topic-${i}`, path: `research/topic-${i}.md` }));
  }
  const onDisk = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(onDisk.entries.length, 10);
  assert.equal(fs.readdirSync(dir).length, 1, 'no stray temp files should remain');
});

// --- isFresh: pure, staleness boundary (exactly 7 days) ---

test('isFresh is true for an entry dated today', () => {
  const entry = entryOf({ date: '2026-07-27' });
  assert.equal(isFresh(entry, '2026-07-27T12:00:00Z'), true);
});

test('isFresh is true at exactly the 7-day boundary (default maxDays)', () => {
  const entry = entryOf({ date: '2026-07-20' });
  assert.equal(isFresh(entry, '2026-07-27T00:00:00Z', 7), true);
});

test('isFresh is false one day past the 7-day boundary', () => {
  const entry = entryOf({ date: '2026-07-19' });
  assert.equal(isFresh(entry, '2026-07-27T00:00:00Z', 7), false);
});

test('isFresh respects a custom maxDays', () => {
  const entry = entryOf({ date: '2026-07-25' });
  assert.equal(isFresh(entry, '2026-07-27T00:00:00Z', 1), false);
  assert.equal(isFresh(entry, '2026-07-27T00:00:00Z', 2), true);
});

test('isFresh does not mutate its inputs (pure)', () => {
  const entry = entryOf({ date: '2026-07-20' });
  const snapshot = JSON.parse(JSON.stringify(entry));
  isFresh(entry, '2026-07-27T00:00:00Z', 7);
  assert.deepEqual(entry, snapshot);
});

test('isFresh is false for a future-dated entry (negative age is never fresh)', () => {
  const entry = entryOf({ date: '2026-08-01' });
  assert.equal(isFresh(entry, '2026-07-27T12:00:00Z'), false);
});

// --- listStale: pure ---

test('listStale returns only the entries past maxDays', () => {
  const index = {
    schema_version: 1,
    entries: [
      entryOf({ topic: 'fresh', date: '2026-07-27' }),
      entryOf({ topic: 'stale', date: '2026-07-01' }),
    ],
  };
  const stale = listStale(index, '2026-07-27T00:00:00Z', 7);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].topic, 'stale');
});

test('listStale returns an empty array when nothing is stale', () => {
  const index = { schema_version: 1, entries: [entryOf({ date: '2026-07-27' })] };
  assert.deepEqual(listStale(index, '2026-07-27T00:00:00Z', 7), []);
});

test('listStale does not mutate the index it reads (pure)', () => {
  const index = { schema_version: 1, entries: [entryOf({ date: '2026-07-01' })] };
  const snapshot = JSON.parse(JSON.stringify(index));
  listStale(index, '2026-07-27T00:00:00Z', 7);
  assert.deepEqual(index, snapshot);
});

// --- requireFreshOrExplain: the cache-first gate ---

test('requireFreshOrExplain reports fresh:true with the entry and a reason when cache is fresh', () => {
  const index = { schema_version: 1, entries: [entryOf({ topic: 'topic-a', date: '2026-07-27' })] };
  const result = requireFreshOrExplain(index, 'topic-a', '2026-07-27T00:00:00Z');
  assert.equal(result.fresh, true);
  assert.equal(result.entry.topic, 'topic-a');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('requireFreshOrExplain reports fresh:false with the entry and a reason when cache is stale', () => {
  const index = { schema_version: 1, entries: [entryOf({ topic: 'topic-a', date: '2026-07-01' })] };
  const result = requireFreshOrExplain(index, 'topic-a', '2026-07-27T00:00:00Z');
  assert.equal(result.fresh, false);
  assert.equal(result.entry.topic, 'topic-a');
  assert.match(result.reason, /stale|re-verify|exceed/i);
});

test('requireFreshOrExplain reports fresh:false with entry:null when no cache entry exists for the topic', () => {
  const index = { schema_version: 1, entries: [] };
  const result = requireFreshOrExplain(index, 'never-researched', '2026-07-27T00:00:00Z');
  assert.equal(result.fresh, false);
  assert.equal(result.entry, null);
  assert.match(result.reason, /no cache entry|not found/i);
});

test('requireFreshOrExplain is exactly fresh at the 7-day boundary', () => {
  const index = { schema_version: 1, entries: [entryOf({ topic: 'topic-a', date: '2026-07-20' })] };
  const result = requireFreshOrExplain(index, 'topic-a', '2026-07-27T00:00:00Z');
  assert.equal(result.fresh, true);
});

test('requireFreshOrExplain reports fresh:false with a future-date reason when the entry date is in the future', () => {
  const index = { schema_version: 1, entries: [entryOf({ topic: 'topic-a', date: '2026-08-01' })] };
  const result = requireFreshOrExplain(index, 'topic-a', '2026-07-27T12:00:00Z');
  assert.equal(result.fresh, false);
  assert.equal(result.entry.topic, 'topic-a');
  assert.match(result.reason, /future/i);
});

// --- requireFreshOrExplain: opts.loadBearing always wins (vision §10) ---

test('opts.loadBearing:true overrides a fresh entry — always fresh:false with the load-bearing reason', () => {
  const index = { schema_version: 1, entries: [entryOf({ topic: 'topic-a', date: '2026-07-27' })] };
  const result = requireFreshOrExplain(index, 'topic-a', '2026-07-27T12:00:00Z', { loadBearing: true });
  assert.equal(result.fresh, false);
  assert.equal(result.entry.topic, 'topic-a');
  assert.equal(result.reason, 'load-bearing re-verification');
});

test('opts.loadBearing:true overrides a stale entry — still fresh:false with the load-bearing reason', () => {
  const index = { schema_version: 1, entries: [entryOf({ topic: 'topic-a', date: '2026-07-01' })] };
  const result = requireFreshOrExplain(index, 'topic-a', '2026-07-27T12:00:00Z', { loadBearing: true });
  assert.equal(result.fresh, false);
  assert.equal(result.reason, 'load-bearing re-verification');
});

test('opts.loadBearing:true with no cache entry returns entry:null and the load-bearing reason, not the missing-entry reason', () => {
  const index = { schema_version: 1, entries: [] };
  const result = requireFreshOrExplain(index, 'never-researched', '2026-07-27T12:00:00Z', { loadBearing: true });
  assert.equal(result.fresh, false);
  assert.equal(result.entry, null);
  assert.equal(result.reason, 'load-bearing re-verification');
});

test('opts.loadBearing:false (or omitted) leaves the ordinary freshness result untouched', () => {
  const index = { schema_version: 1, entries: [entryOf({ topic: 'topic-a', date: '2026-07-27' })] };
  const result = requireFreshOrExplain(index, 'topic-a', '2026-07-27T12:00:00Z', { loadBearing: false });
  assert.equal(result.fresh, true);
});

// --- recordGateCheck: the auditable freshness-gate record ---

function mkScratchpad() {
  const dir = mkTmpDir();
  return path.join(dir, 'scratchpad.jsonl');
}

test('recordGateCheck appends a kind:"freshness_gate" record carrying topic/fresh/reason/load_bearing', () => {
  const scratchpadPath = mkScratchpad();
  recordGateCheck(scratchpadPath, {
    topic: 'topic-a',
    fresh: true,
    reason: 'cache entry for topic "topic-a" is 0d old (<= 7d ceiling) — cache-first, do not re-research',
    load_bearing: false,
  });
  const { records } = readRecords(scratchpadPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'freshness_gate');
  assert.equal(records[0].topic, 'topic-a');
  assert.equal(records[0].fresh, true);
  assert.equal(records[0].load_bearing, false);
  assert.equal(records[0].correlation_id, 'topic-a');
  assert.match(records[0].reason, /cache-first/);
});

test('recordGateCheck records a load-bearing gate check with fresh:false and load_bearing:true', () => {
  const scratchpadPath = mkScratchpad();
  recordGateCheck(scratchpadPath, {
    topic: 'topic-b',
    fresh: false,
    reason: 'load-bearing re-verification',
    load_bearing: true,
  });
  const { records } = readRecords(scratchpadPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'freshness_gate');
  assert.equal(records[0].fresh, false);
  assert.equal(records[0].load_bearing, true);
});

test('recordGateCheck appends onto an existing scratchpad without disturbing prior records', () => {
  const scratchpadPath = mkScratchpad();
  recordGateCheck(scratchpadPath, { topic: 'topic-a', fresh: true, reason: 'r1', load_bearing: false });
  recordGateCheck(scratchpadPath, { topic: 'topic-b', fresh: false, reason: 'r2', load_bearing: false });
  const { records } = readRecords(scratchpadPath);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.topic), ['topic-a', 'topic-b']);
});

test('recordGateCheck rejects a missing topic', () => {
  const scratchpadPath = mkScratchpad();
  assert.throws(
    () => recordGateCheck(scratchpadPath, { topic: '', fresh: true, reason: 'r', load_bearing: false }),
    /topic/
  );
});

test('recordGateCheck rejects a non-boolean fresh', () => {
  const scratchpadPath = mkScratchpad();
  assert.throws(
    () => recordGateCheck(scratchpadPath, { topic: 't', fresh: 'yes', reason: 'r', load_bearing: false }),
    /fresh/
  );
});

test('recordGateCheck rejects a missing reason', () => {
  const scratchpadPath = mkScratchpad();
  assert.throws(
    () => recordGateCheck(scratchpadPath, { topic: 't', fresh: true, reason: '', load_bearing: false }),
    /reason/
  );
});

test('recordGateCheck rejects a non-boolean load_bearing', () => {
  const scratchpadPath = mkScratchpad();
  assert.throws(
    () => recordGateCheck(scratchpadPath, { topic: 't', fresh: true, reason: 'r', load_bearing: 'no' }),
    /load_bearing/
  );
});

// ---------- CLI (P11 convergence finding 3/8: research-chief.md's own
// requireFreshOrExplain/recordGateCheck/upsertEntry calls had no executable
// form) ----------

const { spawnSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'src', 'research-cache.js');

test('CLI: upsert-entry writes the entry and prints the whole index', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  const entry = entryOf();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'upsert-entry', indexPath], {
    encoding: 'utf8',
    input: JSON.stringify({ entry }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), loadIndex(indexPath));
  assert.deepEqual(loadIndex(indexPath).entries, [entry]);
});

test('CLI: upsert-entry rejects a future-dated entry (using the caller-supplied nowIso)', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'upsert-entry', indexPath], {
    encoding: 'utf8',
    input: JSON.stringify({ entry: entryOf({ date: '2026-08-01' }), nowIso: '2026-07-20T00:00:00Z' }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /future/);
});

test('CLI: upsert-entry exits 1 for a malformed entry', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'upsert-entry', indexPath], {
    encoding: 'utf8',
    input: JSON.stringify({ entry: { topic: '' } }),
  });
  assert.equal(proc.status, 1);
});

test('CLI: require-fresh-or-explain reports fresh:true for a recent, non-load-bearing entry', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  upsertEntry(indexPath, entryOf({ date: '2026-07-20' }));
  const proc = spawnSync(process.execPath, [CLI_PATH, 'require-fresh-or-explain', indexPath, 'chief-researcher-pattern'], {
    encoding: 'utf8',
    input: JSON.stringify({ nowIso: '2026-07-22T00:00:00Z' }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.fresh, true);
});

test('CLI: require-fresh-or-explain reports fresh:false when opts.loadBearing is true, regardless of age', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  upsertEntry(indexPath, entryOf({ date: '2026-07-20' }));
  const proc = spawnSync(process.execPath, [CLI_PATH, 'require-fresh-or-explain', indexPath, 'chief-researcher-pattern'], {
    encoding: 'utf8',
    input: JSON.stringify({ nowIso: '2026-07-20T12:00:00Z', loadBearing: true }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.fresh, false);
  assert.match(printed.reason, /load-bearing/);
});

test('CLI: require-fresh-or-explain reports the missing-entry reason for an unknown topic', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'require-fresh-or-explain', indexPath, 'never-researched'], {
    encoding: 'utf8',
    input: '{}',
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.fresh, false);
  assert.equal(printed.entry, null);
});

test('CLI: record-gate-check appends a freshness_gate record and prints its seq', () => {
  const scratchpadPath = mkScratchpad();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record-gate-check', scratchpadPath], {
    encoding: 'utf8',
    input: JSON.stringify({ topic: 't', fresh: true, reason: 'r', load_bearing: false }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(typeof printed.seq, 'number');
  const { records } = readRecords(scratchpadPath);
  const gateRecords = records.filter((r) => r.kind === 'freshness_gate');
  assert.equal(gateRecords.length, 1);
  assert.equal(gateRecords[0].topic, 't');
});

test('CLI: record-gate-check exits 1 for a malformed body', () => {
  const scratchpadPath = mkScratchpad();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record-gate-check', scratchpadPath], {
    encoding: 'utf8',
    input: JSON.stringify({ topic: 't' }),
  });
  assert.equal(proc.status, 1);
});

test('CLI: exits 1 on invalid JSON via stdin', () => {
  const dir = mkTmpDir();
  const indexPath = path.join(dir, 'research', 'index.json');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'upsert-entry', indexPath], { encoding: 'utf8', input: 'not json' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^research-cache\.js: /);
});

test('CLI: unknown command exits 1 naming the expected commands', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'bogus'], { encoding: 'utf8', input: '{}' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /require-fresh-or-explain/);
});
