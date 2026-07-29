'use strict';

const { appendEvent, readAll } = require('./jsonl.js');

const SCHEMA_VERSION = 1;

// The common JSONL record header (synthesis §2: "Common JSONL record header",
// shared by every stream in the tree). appendRecord owns these fields;
// callers supply kind/payload/correlation_id only, never the header itself.
const RESERVED_KEYS = ['schema_version', 'seq', 'kind', 'ts', 'correlation_id'];

// UTC only ('Z' suffix) — synthesis §2's header sketch shows `ts: "RFC3339
// UTC"`, and §10's format law never sanctions a numeric-offset alternative.
// A numeric offset (+02:00) is still valid ISO-8601 but not UTC, and would
// let two producers disagree on wall-clock ordering while both "look" ISO.
const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Product-stream wrapper over ./jsonl: stamps the common header
// (schema_version, seq, kind, ts, optional correlation_id) around a
// stream-specific payload, and delegates seq allocation + the single-writer
// lock to jsonl.appendEvent so every stream in the tree gets that guarantee
// for free.
function appendRecord(file, { kind, payload, correlation_id } = {}) {
  if (typeof kind !== 'string' || kind === '') {
    throw new TypeError('stream: kind must be a non-empty string');
  }
  if (payload !== undefined && !isPlainObject(payload)) {
    throw new TypeError('stream: payload must be a plain object when provided');
  }
  const body = payload || {};
  for (const reserved of RESERVED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, reserved)) {
      throw new TypeError(`stream: payload must not redefine reserved header field "${reserved}"`);
    }
  }

  // correlation_id is present-and-nullable per synthesis §2's header sketch
  // ("correlation_id: chunk_C03 | consult-id | topic-id | null") — always
  // stamped, defaulting to null, never simply omitted when the caller has no
  // correlator to attach.
  const evt = {
    schema_version: SCHEMA_VERSION,
    kind,
    ts: new Date().toISOString(),
    correlation_id: correlation_id !== undefined ? correlation_id : null,
    ...body,
  };
  return appendEvent(file, evt);
}

// Validates the common JSONL record header only (schema_version/seq/kind/ts);
// stream-specific payload fields are out of scope here.
function validateRecordHeader(rec) {
  if (!isPlainObject(rec)) {
    return { ok: false, errors: ['record must be a JSON object'] };
  }

  const errors = [];

  if (!Object.prototype.hasOwnProperty.call(rec, 'schema_version')) {
    errors.push('missing schema_version');
  } else if (rec.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'seq')) {
    errors.push('missing seq');
  } else if (!(Number.isSafeInteger(rec.seq) && rec.seq >= 0)) {
    errors.push('seq must be a nonnegative safe integer');
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'kind')) {
    errors.push('missing kind');
  } else if (typeof rec.kind !== 'string' || rec.kind === '') {
    errors.push('kind must be a non-empty string');
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'ts')) {
    errors.push('missing ts');
  } else if (typeof rec.ts !== 'string' || !ISO_8601_UTC_RE.test(rec.ts) || Number.isNaN(Date.parse(rec.ts))) {
    errors.push('ts must be an ISO-8601 UTC ("Z") timestamp string');
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'correlation_id')) {
    errors.push('missing correlation_id');
  } else if (rec.correlation_id !== null && (typeof rec.correlation_id !== 'string' || rec.correlation_id === '')) {
    errors.push('correlation_id must be a non-empty string or null');
  }

  return { ok: errors.length === 0, errors };
}

// readAll() plus a per-record header validation report, so callers get both
// jsonl-level parse errors (malformed lines) and header-shape violations
// (well-formed JSON that doesn't carry a valid common header) in one pass.
function readRecords(file) {
  const { records, errors } = readAll(file);
  const headerViolations = [];
  records.forEach((rec, index) => {
    const { ok, errors: recErrors } = validateRecordHeader(rec);
    if (!ok) {
      headerViolations.push({ index, errors: recErrors });
    }
  });
  return { records, errors, headerViolations };
}

module.exports = { appendRecord, validateRecordHeader, readRecords, ISO_8601_UTC_RE };
