'use strict';

// research/index.json — synthesis §2 ("topic → {file, date, status};
// cache-first discipline") and the ruled law ("research artifacts are the
// cache — dated at retrieval; agents read the cache before any
// re-research; re-verification fires on staleness or load-bearing
// decisions, never as reflex token-burning"). This module is the ONE place
// that shape and the cache-first gate live; workers cite
// requireFreshOrExplain rather than re-deriving staleness logic themselves.
//
// Entry shape (P5 build instruction): { topic, path, date, sources }, where
// topic is the upsert key, date is an ISO YYYY-MM-DD retrieval date, and
// sources is a non-empty array of { url, fetched_ts }.

const fs = require('node:fs');

const { readJson, writeAtomic } = require('./atomic-json.js');
const { appendRecord } = require('./stream.js');

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Sources' fetched_ts must be a full ISO-8601 date-time (date-only, e.g.
// "2026-07-20", is a "date" field's shape, not a "when did I fetch this"
// timestamp) — UTC 'Z' or a numeric offset are both accepted since a
// worker's fetch may legitimately come stamped either way, unlike
// stream.js's own header ts which this module does not write.
const ISO_8601_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const MISSING_INDEX = Symbol('research-cache.missing-index');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Real calendar-date check (P5 Sol review MAJOR #1): DATE_RE only proves the
// string is four-digits-dash-two-digits-dash-two-digits; JS's own Date
// silently NORMALIZES an out-of-range month/day (2026-02-30 rolls forward to
// March), so a Date.parse-succeeded check alone accepts impossible dates.
// This constructs the UTC date from its parts and compares the parts back
// out — a normalized date never round-trips.
function isValidCalendarDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

function isValidHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function isValidIsoTimestamp(value) {
  return isNonEmptyString(value) && ISO_8601_TIMESTAMP_RE.test(value) && !Number.isNaN(Date.parse(value));
}

// Validates one entry's field shape (topic/path/date/sources), independent
// of where it lives (a fresh upsertEntry call or an entry already on disk
// inside a loaded index). Returns an array of human-readable error strings;
// empty means valid.
function validateEntryShape(entry) {
  if (!isPlainObject(entry)) {
    return ['entry must be a JSON object'];
  }

  const errors = [];

  if (!isNonEmptyString(entry.topic)) {
    errors.push('entry field "topic" must be a non-empty string');
  }
  if (!isNonEmptyString(entry.path)) {
    errors.push('entry field "path" must be a non-empty string');
  }

  if (!isNonEmptyString(entry.date) || !DATE_RE.test(entry.date)) {
    errors.push('entry field "date" must be an ISO YYYY-MM-DD string');
  } else if (!isValidCalendarDate(entry.date)) {
    errors.push(`entry field "date" ("${entry.date}") is not a valid calendar date`);
  }

  if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
    errors.push('entry field "sources" must be a non-empty array of {url, fetched_ts}');
  } else {
    entry.sources.forEach((source, index) => {
      if (!isPlainObject(source)) {
        errors.push(`entry field "sources[${index}]" must be an object`);
        return;
      }
      if (!isNonEmptyString(source.url)) {
        errors.push(`entry field "sources[${index}].url" must be a non-empty string`);
      } else if (!isValidHttpUrl(source.url)) {
        errors.push(`entry field "sources[${index}].url" must be a valid http(s) URL`);
      }
      if (!isNonEmptyString(source.fetched_ts)) {
        errors.push(`entry field "sources[${index}].fetched_ts" must be a non-empty string`);
      } else if (!isValidIsoTimestamp(source.fetched_ts)) {
        errors.push(`entry field "sources[${index}].fetched_ts" must be an ISO-8601 timestamp`);
      }
    });
  }

  return errors;
}

// Reads research/index.json. Missing file -> the schema_version:1
// empty-entries genesis shape (never written to disk by this read — the
// index starts existing only once something is cached). Present-but-
// unparseable JSON throws via atomic-json's own readJson, whose error
// already names the path. Present-but-wrong-shape (bad schema_version, non-
// array entries, any entry failing validateEntryShape, or duplicate topics
// across entries — P5 Sol review MAJOR #1) throws here, with indexPath
// always named in the message.
function loadIndex(indexPath) {
  const raw = readJson(indexPath, MISSING_INDEX);
  if (raw === MISSING_INDEX) {
    return { schema_version: SCHEMA_VERSION, entries: [] };
  }

  if (!isPlainObject(raw)) {
    throw new Error(`research-cache: index at ${indexPath} must be a JSON object`);
  }
  if (raw.schema_version !== SCHEMA_VERSION) {
    throw new Error(`research-cache: index at ${indexPath} must declare schema_version ${SCHEMA_VERSION}`);
  }
  if (!Array.isArray(raw.entries)) {
    throw new Error(`research-cache: index at ${indexPath} field "entries" must be an array`);
  }

  raw.entries.forEach((entry, index) => {
    const errors = validateEntryShape(entry);
    if (errors.length > 0) {
      throw new Error(`research-cache: index at ${indexPath} entries[${index}] invalid: ${errors.join('; ')}`);
    }
  });

  const seenTopics = new Set();
  const duplicateTopics = new Set();
  for (const entry of raw.entries) {
    if (seenTopics.has(entry.topic)) {
      duplicateTopics.add(entry.topic);
    }
    seenTopics.add(entry.topic);
  }
  if (duplicateTopics.size > 0) {
    throw new Error(
      `research-cache: index at ${indexPath} contains duplicate topic(s): ${[...duplicateTopics].join(', ')} — topic must be unique (it is the upsert key)`
    );
  }

  return raw;
}

// Inserts or updates one entry, keyed on topic, and writes the whole index
// back atomically via atomic-json.writeAtomic (temp-file + rename, same
// torn-write protection every other JSON snapshot in the tree gets — see
// routing.js's setActive for the same read-then-writeAtomic shape). Rejects
// (throws) BEFORE any read or write if the incoming entry fails shape
// validation OR is dated in the future relative to opts.nowIso (P5 Sol
// review MAJOR #1 — a cache entry claiming a retrieval date that hasn't
// happened yet is invalid data, not merely "very fresh"), so a bad call
// never touches the file on disk. opts.nowIso defaults to the real current
// time; callers that need determinism (tests, a chief steering off a fixed
// clock) pass it explicitly, the same DI shape ageDaysOf/isFresh/
// requireFreshOrExplain already use for "now".
function upsertEntry(indexPath, entryInput, opts = {}) {
  const errors = validateEntryShape(entryInput);
  if (errors.length > 0) {
    throw new Error(`research-cache: upsertEntry rejected entry: ${errors.join('; ')}`);
  }

  const nowIso = isNonEmptyString(opts.nowIso) ? opts.nowIso : new Date().toISOString();
  if (Number.isNaN(Date.parse(nowIso))) {
    throw new TypeError(`research-cache: opts.nowIso "${nowIso}" is not a valid ISO timestamp`);
  }
  const entryDayMs = Date.parse(`${entryInput.date}T00:00:00Z`);
  const nowDayMs = Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`);
  if (entryDayMs > nowDayMs) {
    throw new Error(
      `research-cache: upsertEntry rejected entry: entry field "date" ("${entryInput.date}") is in the future relative to now (${nowIso})`
    );
  }

  const index = loadIndex(indexPath);
  const newEntry = {
    topic: entryInput.topic,
    path: entryInput.path,
    date: entryInput.date,
    sources: entryInput.sources.map((source) => ({ url: source.url, fetched_ts: source.fetched_ts })),
  };

  const nextEntries = index.entries.slice();
  const existingIndex = nextEntries.findIndex((entry) => entry.topic === newEntry.topic);
  if (existingIndex === -1) {
    nextEntries.push(newEntry);
  } else {
    nextEntries[existingIndex] = newEntry;
  }

  const nextIndex = { schema_version: SCHEMA_VERSION, entries: nextEntries };
  writeAtomic(indexPath, nextIndex);
  return nextIndex;
}

// Calendar-day age of a date-only entry.date against an ISO instant nowIso,
// floor-divided so an entry is still exactly N days old for the whole of
// day N (only rolls to N+1 once a full day has elapsed past N). Can be
// negative when entry.date is after nowIso's own day (a future-dated entry)
// — callers (isFresh, requireFreshOrExplain) treat negative age as never
// fresh rather than rejecting it here, since ageDaysOf's own job is the
// arithmetic, not the freshness policy.
function ageDaysOf(entry, nowIso) {
  if (!isPlainObject(entry) || !isNonEmptyString(entry.date) || !DATE_RE.test(entry.date)) {
    throw new TypeError('research-cache: entry must have a valid ISO YYYY-MM-DD "date" field');
  }
  const entryMs = Date.parse(`${entry.date}T00:00:00Z`);
  if (Number.isNaN(entryMs)) {
    throw new TypeError(`research-cache: entry date "${entry.date}" is not a valid calendar date`);
  }
  if (typeof nowIso !== 'string' || Number.isNaN(Date.parse(nowIso))) {
    throw new TypeError(`research-cache: nowIso "${nowIso}" is not a valid ISO timestamp`);
  }
  const nowMs = Date.parse(nowIso);
  return Math.floor((nowMs - entryMs) / DAY_MS);
}

// Pure: an entry is fresh through and including its maxDays-th day
// (inclusive boundary — a 7-day-old entry with maxDays=7 is still fresh;
// day 8 is the first stale day). A negative age (a future-dated entry) is
// never fresh (P5 Sol review MAJOR #1) — the re-verify-on-staleness
// rule needs exactly one such boundary, defined once here.
function isFresh(entry, nowIso, maxDays = DEFAULT_MAX_DAYS) {
  const age = ageDaysOf(entry, nowIso);
  return age >= 0 && age <= maxDays;
}

// Pure: entries whose age exceeds maxDays, in index order.
function listStale(index, nowIso, maxDays = DEFAULT_MAX_DAYS) {
  if (!isPlainObject(index) || !Array.isArray(index.entries)) {
    throw new TypeError('research-cache: index must be an object with an "entries" array');
  }
  return index.entries.filter((entry) => !isFresh(entry, nowIso, maxDays));
}

// The cache-first gate (synthesis §2): workers call this before
// re-researching a topic. opts.loadBearing (P5 fix pass, resolving Sol
// review MAJOR #2's fresh-vs-load-bearing ambiguity) is the ONE rule that
// decides precedence between the chief's two branches: consume the cache
// only when fresh AND NOT load-bearing; a load-bearing decision ALWAYS
// re-verifies, regardless of the entry's age or even whether an entry
// exists at all. When opts.loadBearing is true, every other outcome below is
// short-circuited — entry is still looked up and returned (so a caller can
// still see what's on record), but fresh is unconditionally false and the
// reason names the load-bearing rule itself, not the entry's age.
//
// Absent opts.loadBearing: no entry -> fresh:false, entry:null, reason names
// the topic. Entry present -> fresh reflects the default 7-day ceiling (a
// future-dated entry is never fresh, same rule isFresh enforces); entry is
// always returned alongside so a fresh hit can be used directly and a stale
// hit still shows what's on record.
function requireFreshOrExplain(index, topic, nowIso, opts = {}) {
  if (!isPlainObject(index) || !Array.isArray(index.entries)) {
    throw new TypeError('research-cache: index must be an object with an "entries" array');
  }
  if (!isNonEmptyString(topic)) {
    throw new TypeError('research-cache: topic must be a non-empty string');
  }

  const entry = index.entries.find((candidate) => candidate.topic === topic) || null;

  if (opts.loadBearing === true) {
    return {
      fresh: false,
      entry,
      reason: 'load-bearing re-verification',
    };
  }

  if (entry === null) {
    return {
      fresh: false,
      entry: null,
      reason: `no cache entry for topic "${topic}" — research required`,
    };
  }

  const age = ageDaysOf(entry, nowIso);
  if (age >= 0 && age <= DEFAULT_MAX_DAYS) {
    return {
      fresh: true,
      entry,
      reason: `cache entry for topic "${topic}" is ${age}d old (<= ${DEFAULT_MAX_DAYS}d ceiling) — cache-first, do not re-research`,
    };
  }
  if (age < 0) {
    return {
      fresh: false,
      entry,
      reason: `cache entry for topic "${topic}" has a future retrieval date (invalid) — treat as stale, re-verify`,
    };
  }
  return {
    fresh: false,
    entry,
    reason: `cache entry for topic "${topic}" is ${age}d old (> ${DEFAULT_MAX_DAYS}d ceiling) — stale, re-verify before load-bearing use`,
  };
}

// Appends one "freshness_gate" record to research/scratchpad.jsonl (P5 fix
// pass — Sol review's auditability finding: cache-first and the
// load-bearing exception were prompt law but left no machine-checkable
// trace that the gate ever ran before a brief). The chief calls this once
// per brief decision, right after requireFreshOrExplain, with that call's
// own outcome — never a re-derived or paraphrased version of it. Written via
// stream.appendRecord, the same single-writer/header-stamped path every
// other scratchpad record uses (research-chief.md's own "decomposition" /
// "brief_issued" / "envelope_consumed" / "steer" / "synthesis" kinds).
function recordGateCheck(scratchpadPath, { topic, fresh, reason, load_bearing } = {}) {
  if (!isNonEmptyString(topic)) {
    throw new TypeError('research-cache: recordGateCheck requires a non-empty "topic"');
  }
  if (typeof fresh !== 'boolean') {
    throw new TypeError('research-cache: recordGateCheck requires a boolean "fresh"');
  }
  if (!isNonEmptyString(reason)) {
    throw new TypeError('research-cache: recordGateCheck requires a non-empty "reason"');
  }
  if (typeof load_bearing !== 'boolean') {
    throw new TypeError('research-cache: recordGateCheck requires a boolean "load_bearing"');
  }
  return appendRecord(scratchpadPath, {
    kind: 'freshness_gate',
    payload: { topic, fresh, reason, load_bearing },
    correlation_id: topic,
  });
}

// CLI entrypoint (P11 convergence finding 3/8: agents/research-chief.md's own
// cache-first law and synthesis calls — requireFreshOrExplain,
// recordGateCheck, upsertEntry — had no executable form for a Bash-only
// worker). All three read their structured input from stdin, matching this
// tree's stdin-JSON convention; `require-fresh-or-explain`/`upsert-entry`
// load `research/index.json` internally via loadIndex rather than trusting
// a caller-supplied index object.
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readStdinJson(label) {
  const text = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} JSON via stdin is not valid JSON: ${err.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${label} JSON via stdin must be a JSON object`);
  }
  return parsed;
}

function parseArgv(argv) {
  const [command, ...rest] = argv;
  return { command, rest };
}

function main(argv) {
  const { command, rest } = parseArgv(argv);
  try {
    let result;
    if (command === 'require-fresh-or-explain') {
      const [indexPath, topic] = rest;
      if (typeof indexPath !== 'string' || indexPath === '' || typeof topic !== 'string' || topic === '') {
        throw new Error('require-fresh-or-explain requires <indexPath> <topic>');
      }
      const body = readStdinJson('require-fresh-or-explain');
      const index = loadIndex(indexPath);
      const nowIso = typeof body.nowIso === 'string' ? body.nowIso : new Date().toISOString();
      const opts = {};
      if (Object.prototype.hasOwnProperty.call(body, 'loadBearing')) opts.loadBearing = body.loadBearing;
      result = requireFreshOrExplain(index, topic, nowIso, opts);
    } else if (command === 'upsert-entry') {
      const [indexPath] = rest;
      if (typeof indexPath !== 'string' || indexPath === '') {
        throw new Error('upsert-entry requires <indexPath>');
      }
      const body = readStdinJson('upsert-entry');
      if (!isPlainObject(body.entry)) {
        throw new Error('upsert-entry: stdin JSON must carry an "entry" object');
      }
      const opts = typeof body.nowIso === 'string' ? { nowIso: body.nowIso } : {};
      result = upsertEntry(indexPath, body.entry, opts);
    } else if (command === 'record-gate-check') {
      const [scratchpadPath] = rest;
      if (typeof scratchpadPath !== 'string' || scratchpadPath === '') {
        throw new Error('record-gate-check requires <scratchpadPath>');
      }
      const body = readStdinJson('record-gate-check');
      const seq = recordGateCheck(scratchpadPath, body);
      result = { seq };
    } else {
      throw new Error(
        `unknown command "${command}" (expected require-fresh-or-explain, upsert-entry, or record-gate-check)`
      );
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`research-cache.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_MAX_DAYS,
  loadIndex,
  upsertEntry,
  isFresh,
  listStale,
  requireFreshOrExplain,
  recordGateCheck,
};
