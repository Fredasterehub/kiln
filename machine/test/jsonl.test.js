'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { LINE_CEILING, appendLine, readAll, appendEvent } = require('../src/jsonl.js');
const JSONL_MODULE_PATH = path.join(__dirname, '..', 'src', 'jsonl.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-test-'));
}

// Builds an object whose JSON.stringify(obj) + '\n' has an exact byte length,
// using a padding field of ASCII 'x' characters (1 byte each) so char length
// and byte length coincide for the padding portion.
function objOfExactLineByteLength(byteLength) {
  const skeleton = { pad: '' };
  const skeletonLen = Buffer.byteLength(JSON.stringify(skeleton) + '\n', 'utf8');
  const padLen = byteLength - skeletonLen;
  assert.ok(padLen >= 0, 'requested byteLength too small for skeleton');
  skeleton.pad = 'x'.repeat(padLen);
  const actual = Buffer.byteLength(JSON.stringify(skeleton) + '\n', 'utf8');
  assert.equal(actual, byteLength, 'helper failed to hit exact byte length');
  return skeleton;
}

test('LINE_CEILING is exported as 8192', () => {
  assert.equal(LINE_CEILING, 8192);
});

test('appendLine accepts a line at exactly the ceiling (8192 bytes)', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const obj = objOfExactLineByteLength(8192);
  assert.doesNotThrow(() => appendLine(file, obj));
  const { records, errors } = readAll(file);
  assert.equal(errors.length, 0);
  assert.equal(records.length, 1);
  assert.equal(records[0].pad, obj.pad);
});

test('appendLine rejects a line one byte over the ceiling (8193 bytes) and writes nothing', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const obj = objOfExactLineByteLength(8193);
  assert.throws(() => appendLine(file, obj), RangeError);
  assert.equal(fs.existsSync(file), false);
});

test('appendLine rejects a line far over the ceiling', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const obj = { big: 'y'.repeat(50000) };
  assert.throws(() => appendLine(file, obj), RangeError);
});

test('appendLine throws TypeError for undefined', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  assert.throws(() => appendLine(file, undefined), TypeError);
});

test('appendLine throws TypeError for a function (JSON.stringify -> undefined)', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  assert.throws(() => appendLine(file, function foo() {}), TypeError);
});

test('appendLine throws TypeError for a circular object (JSON.stringify throws)', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const circular = { a: 1 };
  circular.self = circular;
  assert.throws(() => appendLine(file, circular), TypeError);
});

test('appendLine throws TypeError for a BigInt-bearing object (JSON.stringify throws)', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  assert.throws(() => appendLine(file, { n: 10n }), TypeError);
});

test('appendLine creates missing parent directories', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'nested', 'deeper', 'stream.jsonl');
  assert.equal(fs.existsSync(path.dirname(file)), false);
  appendLine(file, { hello: 'world' });
  assert.equal(fs.existsSync(file), true);
  const { records } = readAll(file);
  assert.deepEqual(records, [{ hello: 'world' }]);
});

test('appendLine performs a single append write per call (no truncation of prior lines)', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  appendLine(file, { i: 1 });
  appendLine(file, { i: 2 });
  appendLine(file, { i: 3 });
  const { records, errors } = readAll(file);
  assert.equal(errors.length, 0);
  assert.deepEqual(records.map((r) => r.i), [1, 2, 3]);
});

test('readAll on a missing file returns empty records and errors', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'does-not-exist.jsonl');
  const result = readAll(file);
  assert.deepEqual(result, { records: [], errors: [] });
});

test('readAll tolerates malformed lines and reports lineNo/reason without throwing', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const content = [
    JSON.stringify({ ok: 1 }),
    '{not valid json',
    JSON.stringify({ ok: 2 }),
    'also not json at all',
    '',
    JSON.stringify({ ok: 3 }),
    '',
  ].join('\n');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, content);

  const { records, errors } = readAll(file);
  assert.deepEqual(records, [{ ok: 1 }, { ok: 2 }, { ok: 3 }]);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].lineNo, 2);
  assert.equal(typeof errors[0].reason, 'string');
  assert.ok(errors[0].reason.length > 0);
  assert.equal(errors[1].lineNo, 4);
  assert.equal(typeof errors[1].reason, 'string');
});

test('appendEvent assigns seq 0 to the first event in a fresh stream', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'events.jsonl');
  const seq = appendEvent(file, { type: 'start' });
  assert.equal(seq, 0);
  const { records } = readAll(file);
  assert.deepEqual(records, [{ type: 'start', seq: 0 }]);
});

test('appendEvent seq is monotonically increasing across sequential calls', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'events.jsonl');
  const seqs = [];
  for (let i = 0; i < 5; i++) {
    seqs.push(appendEvent(file, { type: 'tick', i }));
  }
  assert.deepEqual(seqs, [0, 1, 2, 3, 4]);
  const { records } = readAll(file);
  assert.deepEqual(
    records.map((r) => r.seq),
    [0, 1, 2, 3, 4]
  );
});

test('appendEvent resumes seq correctly from a pre-existing file, ignoring non-numeric/missing seq', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'events.jsonl');
  appendLine(file, { type: 'legacy-no-seq' });
  appendLine(file, { type: 'weird', seq: 'not-a-number' });
  appendLine(file, { type: 'real', seq: 7 });
  const seq = appendEvent(file, { type: 'new' });
  assert.equal(seq, 8);
});

test('appendEvent throws RangeError when the resulting line exceeds the ceiling', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'events.jsonl');
  assert.throws(() => appendEvent(file, { big: 'z'.repeat(50000) }), RangeError);
});

test('appendEvent throws TypeError on unserializable payloads', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'events.jsonl');
  const circular = {};
  circular.self = circular;
  assert.throws(() => appendEvent(file, circular), TypeError);
});

test('unicode payloads: byte length, not char length, governs the ceiling', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');

  // A 4000-character string of a 3-byte-in-UTF-8 character ('あ') yields a
  // line whose char length is well under 8192 but whose byte length is not.
  const wide = 'あ'.repeat(4000); // 'あ' x4000 -> 12000 bytes alone
  assert.ok(wide.length < LINE_CEILING, 'char length should be under ceiling');
  assert.ok(Buffer.byteLength(wide, 'utf8') > LINE_CEILING, 'byte length should be over ceiling');
  assert.throws(() => appendLine(file, { wide }), RangeError);
  assert.equal(fs.existsSync(file), false);
});

test('unicode payloads: multi-byte content round-trips exactly through append and readAll', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const payload = { text: 'héllo wörld 🎉 日本語 emoji: 🚀🔥', n: 42 };
  appendLine(file, payload);
  const seq = appendEvent(file, { text: 'unicode事件🌟', kind: 'event' });
  assert.equal(seq, 0);
  const { records, errors } = readAll(file);
  assert.equal(errors.length, 0);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], payload);
  assert.deepEqual(records[1], { text: 'unicode事件🌟', kind: 'event', seq: 0 });
});

test('appendEvent is race-free under real concurrent writers from separate processes (MAJOR-2)', async () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'events.jsonl');
  const workerScript = path.join(dir, 'worker.js');
  fs.writeFileSync(
    workerScript,
    [
      `const { appendEvent } = require(${JSON.stringify(JSONL_MODULE_PATH)});`,
      `appendEvent(${JSON.stringify(file)}, { from: process.pid });`,
    ].join('\n')
  );

  const WORKER_COUNT = 12;
  const runs = Array.from(
    { length: WORKER_COUNT },
    () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [workerScript]);
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`worker exited with code ${code}: ${stderr}`));
        });
        child.on('error', reject);
      })
  );

  await Promise.all(runs);

  const { records, errors } = readAll(file);
  assert.equal(errors.length, 0);
  assert.equal(records.length, WORKER_COUNT);
  const seqs = records.map((r) => r.seq).sort((a, b) => a - b);
  assert.equal(new Set(seqs).size, WORKER_COUNT);
  assert.deepEqual(
    seqs,
    Array.from({ length: WORKER_COUNT }, (_, i) => i)
  );
});

test('appendLine accepts a unicode line that stays within the byte ceiling', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'stream.jsonl');
  const wide = 'あ'.repeat(100); // well within ceiling in bytes
  assert.doesNotThrow(() => appendLine(file, { wide }));
  const { records } = readAll(file);
  assert.equal(records[0].wide, wide);
});
