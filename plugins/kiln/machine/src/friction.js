'use strict';

// friction.js — how much the process is costing, derived from what the tree
// already recorded.
//
// DERIVE, NEVER DOUBLE-WRITE. Every number here comes out of records some
// other module already writes for its own reasons: chunk reviews and consults
// off the milestone streams, dispatch outcomes and holds off the C1 record
// vocabulary in the ledger. This module adds no event kind of its own and
// writes nothing at all. A second stream recording "friction events" beside
// the streams that already hold the same facts would be a second version of
// the truth, and the two would disagree the first time one of them missed a
// write.
//
// It is also NOT telemetry. `telemetry.js` is opt-in, consent-gated, local
// usage counting; this is process friction derived on demand from the tree
// itself, with nothing to consent to because nothing leaves the tree and
// nothing is stored.
//
// RATES ONLY — no thresholds, no verdicts. Whether a 60% revise share is
// tolerable is a decision, and decisions belong where they can be argued
// with. The cold-mind promotion gates that will read these numbers live in a
// later slice; giving them an opinion here would put the decision in the
// place hardest to see and hardest to change.
//
// FOR THE DELIVERY SLICE: `listOpenHolds` is the read side of C1's
// writer-enforced hold pairs, and delivery is its consumer. The law it exists
// for — an unresolved hold at delivery MUST be itemized into the last-mile
// report, never quietly dropped — is enforced there, not here. This module
// only answers which holds are still open.

const path = require('node:path');

const { readJson } = require('./atomic-json.js');
const { readRecords } = require('./stream.js');

const SCHEMA_VERSION = 1;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireTreeRoot(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('friction: treeRoot must be a non-empty string');
  }
}

// The milestone layout, derived the same way `milestones.js` lays it out and
// `wake.js` and `implementation.js` each read it back.
function milestoneIndexPathOf(treeRoot) {
  return path.join(treeRoot, 'milestones', 'index.json');
}

function chunksPathOf(treeRoot, milestoneId) {
  return path.join(treeRoot, 'milestones', milestoneId, 'chunks.jsonl');
}

// A rate computed from the part of a stream that happened to parse is a number
// nobody can act on, and it looks exactly like a real one. So a stream that
// does not read whole is a refusal, not a smaller sample.
// No missing-file check: `stream.js#readRecords` already answers an absent
// stream with no records and no errors, which is the right answer — a tree
// that has not dispatched anything yet has no dispatch history, and that is
// not a failure.
function readStreamOrThrow(file) {
  const { records, errors, headerViolations } = readRecords(file);
  if (errors.length > 0) {
    const detail = errors.map((e) => `line ${e.lineNo}: ${e.reason}`).join('; ');
    throw new Error(`friction: ${file} has malformed record(s) — refusing to rate part of a stream: ${detail}`);
  }
  if (headerViolations.length > 0) {
    const detail = headerViolations.map((v) => `record[${v.index}]: ${v.errors.join(', ')}`).join('; ');
    throw new Error(
      `friction: ${file} has record(s) violating the common JSONL header — refusing to rate part of a stream: ${detail}`
    );
  }
  return records;
}

function ledgerRecords(treeRoot) {
  return readStreamOrThrow(path.join(treeRoot, 'ledger.jsonl'));
}

// Every milestone the INDEX names, each with its own records. A directory the
// index does not list is not part of the record — the index is what says which
// milestones exist, and a stray directory is not evidence of anything.
//
// The milestone id travels WITH its records and is never flattened away. A
// chunk id is milestone-local — every milestone starts again at C1 — so a
// chunk is identified by the pair, and code that keys on the chunk id alone
// silently merges one milestone's C1 with another's. That is the same trap
// that has now appeared three times in this slice: a durable identity built
// from a scoped id must carry its scope.
function chunkStreams(treeRoot) {
  const index = readJson(milestoneIndexPathOf(treeRoot), null);
  if (!isPlainObject(index) || !Array.isArray(index.milestones)) return [];
  const out = [];
  for (const entry of index.milestones) {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.id)) continue;
    out.push({ milestoneId: entry.id, records: readStreamOrThrow(chunksPathOf(treeRoot, entry.id)) });
  }
  return out;
}

// The chunk key: milestone and chunk together, and readable as one string so
// a per-key breakdown can be scanned by eye.
function chunkKeyOf(milestoneId, chunkId) {
  return `${milestoneId}/${chunkId}`;
}

// chunkCountsFor(treeRoot, milestoneId) — distinct chunks recorded, and
// distinct chunks green, for one milestone. Same two numbers `wake.js`
// reports in its own position digest, computed the same way, so a caller
// composing a position view does not have to read the chunk stream itself.
function chunkCountsFor(treeRoot, milestoneId) {
  requireTreeRoot(treeRoot);
  if (!isNonEmptyString(milestoneId)) return { recorded: 0, green: 0 };
  const records = readStreamOrThrow(chunksPathOf(treeRoot, milestoneId));
  const recorded = new Set();
  const green = new Set();
  for (const entry of records) {
    if (!isNonEmptyString(entry.chunk_id)) continue;
    recorded.add(entry.chunk_id);
    if (entry.kind === 'chunk-green') green.add(entry.chunk_id);
  }
  return { recorded: recorded.size, green: green.size };
}

// A keyed tally, returned as an ARRAY of records rather than an object map:
// a per-key breakdown grows with the tree, and an array is what a projection
// can select, order and cap. Keys come back sorted, so two runs over the same
// tree produce byte-identical output.
function tallyRows(tally) {
  return [...tally.keys()].sort().map((key) => tally.get(key));
}

// A share of nothing is zero, not NaN and not an exception: "no reviews yet"
// is an ordinary state of a young tree, and the caller should read a number.
function share(part, whole) {
  return whole === 0 ? 0 : part / whole;
}

// listOpenHolds(treeRoot) — the holds C1's writers opened and nothing has
// closed, oldest first. Both exits close a hold: `delivered` means it reached
// the operator in the last-mile report, which is a resolution, not a lapse.
function listOpenHolds(treeRoot) {
  requireTreeRoot(treeRoot);
  const records = ledgerRecords(treeRoot);
  const resolved = new Set(
    records.filter((record) => record.kind === 'hold-resolve').map((record) => record.hold_id)
  );
  return records.filter((record) => record.kind === 'hold-open' && !resolved.has(record.hold_id));
}

// listDegradedRoutes(treeRoot) — the mid-build capability substitutions C1
// records. Ledger derivation lives here with the rest of it, so there is one
// reader of this stream and one place that decides what a damaged one means.
function listDegradedRoutes(treeRoot) {
  requireTreeRoot(treeRoot);
  return ledgerRecords(treeRoot).filter((record) => record.kind === 'degraded-route');
}

// rates(treeRoot) — plain data: counts and shares, nothing derived from a
// judgment.
function rates(treeRoot) {
  requireTreeRoot(treeRoot);
  const ledger = ledgerRecords(treeRoot);

  // Per chunk, scoped by milestone, accumulated as the streams are walked so
  // the global totals and the breakdown can never disagree about a record.
  const byChunk = new Map();
  const chunksSeen = new Set();
  const chunksConsulted = new Set();
  let reviewTotal = 0;
  let approveTotal = 0;
  let reviseTotal = 0;
  let consultTotal = 0;

  for (const { milestoneId, records } of chunkStreams(treeRoot)) {
    for (const entry of records) {
      if (!isNonEmptyString(entry.chunk_id)) continue;
      const key = chunkKeyOf(milestoneId, entry.chunk_id);
      chunksSeen.add(key);
      if (!byChunk.has(key)) {
        byChunk.set(key, {
          key,
          milestone: milestoneId,
          chunk: entry.chunk_id,
          reviews: 0,
          approve: 0,
          revise: 0,
          consults: 0,
        });
      }
      const row = byChunk.get(key);
      if (entry.kind === 'chunk-review') {
        reviewTotal += 1;
        row.reviews += 1;
        const verdict = isPlainObject(entry.review) ? entry.review.verdict : null;
        if (verdict === 'approve') {
          approveTotal += 1;
          row.approve += 1;
        } else if (verdict === 'revise') {
          reviseTotal += 1;
          row.revise += 1;
        }
      } else if (entry.kind === 'chunk-consult') {
        consultTotal += 1;
        chunksConsulted.add(key);
        row.consults += 1;
      }
    }
  }

  const dispatched = ledger.filter((record) => record.kind === 'dispatch');
  const terminals = ledger.filter((record) => record.kind === 'dispatch-terminal');
  const failed = terminals.filter((record) => record.status === 'failed');
  const timeout = failed.filter((record) => record.reason === 'timeout');

  // Seat and transport live on the DISPATCH record; the terminal carries only
  // the dispatch_id, so an outcome is attributed by joining back to the
  // dispatch that opened it.
  const bySeat = new Map();
  const byTransport = new Map();
  const dispatchById = new Map(dispatched.map((record) => [record.dispatch_id, record]));
  const tallyDispatch = (tally, key) => {
    if (!tally.has(key)) tally.set(key, { key, dispatched: 0, terminals: 0, failed: 0, timeout: 0 });
    return tally.get(key);
  };
  for (const record of dispatched) {
    tallyDispatch(bySeat, isNonEmptyString(record.seat) ? record.seat : 'unattributed').dispatched += 1;
    tallyDispatch(byTransport, isNonEmptyString(record.transport) ? record.transport : 'unattributed').dispatched += 1;
  }
  for (const terminal of terminals) {
    const opened = dispatchById.get(terminal.dispatch_id);
    const seat = isPlainObject(opened) && isNonEmptyString(opened.seat) ? opened.seat : 'unattributed';
    const transport =
      isPlainObject(opened) && isNonEmptyString(opened.transport) ? opened.transport : 'unattributed';
    for (const [tally, key] of [
      [bySeat, seat],
      [byTransport, transport],
    ]) {
      const row = tallyDispatch(tally, key);
      row.terminals += 1;
      if (terminal.status === 'failed') {
        row.failed += 1;
        if (terminal.reason === 'timeout') row.timeout += 1;
      }
    }
  }

  const opened = ledger.filter((record) => record.kind === 'hold-open');
  const resolvedHolds = ledger.filter((record) => record.kind === 'hold-resolve');

  return {
    schema_version: SCHEMA_VERSION,
    reviews: {
      total: reviewTotal,
      approve: approveTotal,
      revise: reviseTotal,
      revise_share: share(reviseTotal, reviewTotal),
    },
    consults: {
      total: consultTotal,
      chunks_consulted: chunksConsulted.size,
      chunks_seen: chunksSeen.size,
      per_chunk: share(consultTotal, chunksSeen.size),
    },
    dispatches: {
      dispatched: dispatched.length,
      terminals: terminals.length,
      // A dispatch with no terminal has not succeeded and has not failed. It
      // is counted on its own so it cannot dilute a failure share into
      // looking better than the run actually went.
      pending: dispatched.length - terminals.length,
      failed: failed.length,
      timeout: timeout.length,
      failure_share: share(failed.length, terminals.length),
      timeout_share: share(timeout.length, terminals.length),
    },
    holds: {
      opened: opened.length,
      resolved: resolvedHolds.length,
      open: opened.length - resolvedHolds.length,
    },
    // Which key produced the friction, not only how much of it there was. A
    // 60% revise share spread evenly across twelve chunks and the same share
    // caused entirely by one are different situations, and only the breakdown
    // tells them apart.
    per_key: {
      chunks: tallyRows(byChunk),
      seats: tallyRows(bySeat),
      transports: tallyRows(byTransport),
    },
  };
}

module.exports = {
  rates,
  listOpenHolds,
  listDegradedRoutes,
  chunkCountsFor,
};
