'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Design ceiling for a single JSONL line / envelope, in bytes, INCLUDING the
// trailing newline. Proven in the dev record (8KB is where
// POSIX O_APPEND atomicity is no longer guaranteed on the target
// filesystems) and adopted as the product's enforced line-size ceiling.
const LINE_CEILING = 8192;

function serializeLine(obj) {
  let json;
  try {
    json = JSON.stringify(obj);
  } catch (err) {
    throw new TypeError(`jsonl: value is not JSON-serializable: ${err.message}`);
  }
  if (json === undefined) {
    throw new TypeError('jsonl: value serializes to undefined and cannot be written');
  }
  return json + '\n';
}

function appendLine(file, obj) {
  const line = serializeLine(obj);
  const byteLength = Buffer.byteLength(line, 'utf8');
  if (byteLength > LINE_CEILING) {
    throw new RangeError(
      `jsonl: serialized line is ${byteLength} bytes, exceeding LINE_CEILING of ${LINE_CEILING} bytes`
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line);
}

function readAll(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { records: [], errors: [] };
    }
    throw err;
  }

  const records = [];
  const errors = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue; // trailing newline / blank lines produce no entry
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      errors.push({ lineNo: i + 1, reason: err.message });
    }
  }
  return { records, errors };
}

const LOCK_RETRY_DELAY_MS = 5;
const LOCK_TIMEOUT_MS = 5000;
// A lock older than this is assumed to be abandoned by a dead holder rather
// than actively held, and is reclaimed instead of blocking forever.
const LOCK_STALE_MS = 30000;
// The lockfile's own name, derived here so a caller that must reason about
// what a lock leaves on disk reads the suffix from the module that writes it.
const LOCK_SUFFIX = '.lock';
// A machine-readable code on the timeout, so a caller can translate it into
// its own operator-facing refusal without matching on this module's prose.
const LOCK_TIMEOUT_CODE = 'ELOCKTIMEOUT';

// Node has no synchronous sleep primitive; blocking on a private
// SharedArrayBuffer via Atomics.wait is the standard zero-dependency way to
// get one for a short, bounded retry backoff.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// appendEvent's seq allocation is read-scan-then-append, which is not atomic
// on its own: two writers can read the same max seq and pick the same next
// value. A single-writer lockfile (exclusive create, not append-based)
// serializes the whole read+append transaction across processes.
//
// Exported (P11 convergence finding 21) so atomic-json.js's updateJson can
// take the SAME per-file lock discipline for a JSON read-modify-write —
// one native mechanism per constraint, never a second locking
// layer invented for JSON files alongside this one for JSONL streams.
function withLock(file, fn) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const lockFile = file + LOCK_SUFFIX;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockFile, 'wx'));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lockFile, { force: true });
          continue;
        }
      } catch {
        continue; // lock vanished between the failed open and this stat; retry now
      }
      if (Date.now() >= deadline) {
        const timedOut = new Error(`jsonl: timed out waiting for the append lock on ${file}`);
        timedOut.code = LOCK_TIMEOUT_CODE;
        throw timedOut;
      }
      sleepSync(LOCK_RETRY_DELAY_MS);
    }
  }

  try {
    return fn();
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}

function appendEvent(file, evt) {
  return withLock(file, () => {
    const { records } = readAll(file);
    let maxSeq = -1;
    for (const record of records) {
      if (
        record !== null &&
        typeof record === 'object' &&
        typeof record.seq === 'number' &&
        Number.isFinite(record.seq) &&
        record.seq > maxSeq
      ) {
        maxSeq = record.seq;
      }
    }
    const seq = maxSeq + 1;
    appendLine(file, { ...evt, seq });
    return seq;
  });
}

module.exports = {
  LINE_CEILING,
  LOCK_STALE_MS,
  LOCK_SUFFIX,
  LOCK_TIMEOUT_CODE,
  appendLine,
  readAll,
  appendEvent,
  withLock,
};
