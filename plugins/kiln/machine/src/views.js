'use strict';

// views.js — the tree's own bounded answers, written down.
//
// Everything a workflow or an operator needs to know about where a build
// stands is derivable today, but only by reading whole streams: `wake.js`
// renders it to stdout on demand and stores nothing. That is fine for a human
// asking once, and wrong for anything that needs the answer repeatedly or
// cheaply. `regenerate` writes the same answers to `<treeRoot>/views/` as
// small JSON files, so a reader gets them without touching a stream at all.
//
// A VIEW IS A VIEW. It is lossy by design and says so: every file carries its
// `total` and how many entries were `dropped` to stay under the cap. That is
// the opposite of the rule a canonical snapshot follows — there, truncating a
// fact would make it false, so an oversized one is refused. Here nothing
// masquerades as complete: a holds view naming eleven of two thousand holds,
// and saying it dropped 1989, is honest and useful, while refusing to answer
// would leave the reader with the stream they were trying to avoid.
//
// BOUNDEDNESS IS STRUCTURAL, NOT A HABIT. Every list view is built through
// `projection.js#project` selectors — kinds, then fields, then a byte cap —
// and never from a raw stream read. A record of a kind no selector names
// cannot reach a view file, and a field no selector names cannot either,
// whatever the record held on disk. That is what makes "a view never leaks"
// a property of the code rather than a promise about how carefully it was
// written.
//
// NOTHING CALLS THIS YET. Wiring regeneration after every transition belongs
// to the slice that owns the workflows; this module proves the mechanism and
// stops there.

const path = require('node:path');

const { project } = require('./projection.js');
const { readJson } = require('./atomic-json.js');
const { writeAtomicText } = require('./atomic-text.js');
const { rates, listOpenHolds, listDegradedRoutes, chunkCountsFor } = require('./friction.js');
const fs = require('node:fs');

const SCHEMA_VERSION = 1;

// Views are written compactly rather than through atomic-json's pretty
// printer, so that the bytes the selector budgets against and the bytes that
// land on disk are the same bytes. Indentation would inflate a projected view
// by half again and put a file the selector believed was inside its cap
// outside it. Same tmp-then-rename atomicity either way.
function serialize(view) {
  return `${JSON.stringify(view)}\n`;
}

// One cap per view file. Small on purpose: a view exists to be read cheaply
// and often, and anything that needs more than this wants the stream.
const MAX_VIEW_BYTES = 16384;

// How many entries a list view carries before the byte cap gets its say.
const MAX_VIEW_ENTRIES = 50;

// EVERY view is the same shape — {total, dropped, entries} — and every one is
// built by the same call. A view that is "just one object" is a one-entry
// list here rather than a special case, because the special case is exactly
// where a cap gets forgotten: `position` began life as a bare object and was
// the only file in the set with no byte enforcement at all.
const VIEW_NAMES = Object.freeze([
  'open-holds',
  'degraded-routes',
  'friction-rates',
  'friction-by-chunk',
  'friction-by-seat',
  'friction-by-transport',
  'position',
]);

// The selectors. A field not named here does not reach a view file, which is
// why `operator_note` on a hold — or any other field a future writer adds —
// stays in the stream where the full record lives.
const HOLD_FIELDS = Object.freeze(['seq', 'ts', 'hold_id', 'severity', 'summary', 'origin_ref']);
const DEGRADED_FIELDS = Object.freeze(['seq', 'ts', 'route_id', 'expected', 'actual', 'reason', 'scope_ref']);
const CHUNK_KEY_FIELDS = Object.freeze(['key', 'milestone', 'chunk', 'reviews', 'approve', 'revise', 'consults']);
const DISPATCH_KEY_FIELDS = Object.freeze(['key', 'dispatched', 'terminals', 'failed', 'timeout']);
const RATE_FIELDS = Object.freeze([
  'reviews_total',
  'reviews_approve',
  'reviews_revise',
  'reviews_revise_share',
  'consults_total',
  'consults_chunks_consulted',
  'consults_chunks_seen',
  'consults_per_chunk',
  'dispatches_dispatched',
  'dispatches_terminals',
  'dispatches_pending',
  'dispatches_failed',
  'dispatches_timeout',
  'dispatches_failure_share',
  'dispatches_timeout_share',
  'holds_opened',
  'holds_resolved',
  'holds_open',
]);
const POSITION_FIELDS = Object.freeze([
  'phase',
  'next_action',
  'milestone_id',
  'milestone_index',
  'milestone_total',
  'milestone_status',
  'chunks_recorded',
  'chunks_green',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireTreeRoot(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('views: treeRoot must be a non-empty string');
  }
}

function viewsDirOf(treeRoot) {
  return path.join(treeRoot, 'views');
}

function viewPathOf(treeRoot, name) {
  return path.join(viewsDirOf(treeRoot), `${name}.json`);
}

// A list view: projected, capped, and explicit about the difference between
// what it holds and what there was.
//
// The budget handed to the selector is the cap MINUS what the file's own
// wrapper costs, measured in the bytes this module actually writes. Capping
// only the entries would cap the biggest part and miss the file: a 16KB array
// inside a wrapper is a file over 16KB, and pretty-printing it would put it
// half again over. The placeholder below deliberately carries the LARGEST
// value `dropped` could take, so the wrapper it measures is never smaller
// than the wrapper that gets written.
function listView(records, { kinds, fields }, generatedAt) {
  const wrapper = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    total: records.length,
    dropped: records.length,
    entries: [],
  };
  const budget = MAX_VIEW_BYTES - Buffer.byteLength(serialize(wrapper), 'utf8');
  const spec = { fields, lastN: MAX_VIEW_ENTRIES, maxBytes: Math.max(0, budget) };
  // `kinds` is passed wherever the entries ARE ledger records, so the kind
  // filter is part of the selector rather than something a caller did
  // beforehand and this file merely trusts. Derived rows carry no `kind` and
  // name none.
  //
  // It cannot fail today — friction.js hands back records of exactly these
  // kinds, so the filter drops nothing — and that is the point: it is a SEAL,
  // not a live guard. If a future change to friction ever widened what comes
  // back, a view would narrow it here instead of quietly publishing it.
  if (kinds !== undefined) spec.kinds = kinds;
  const projected = project(records, spec);
  return {
    ...wrapper,
    dropped: records.length - projected.view.length,
    entries: projected.view,
  };
}

// Where the build stands, as ONE row: the phase state.json claims, and the
// milestone the index is at with its own chunk counts.
//
// This is the position contract `wake.js` already speaks — same fields, same
// "first milestone that is not green" rule, same two chunk counts. It is
// re-derived rather than called because wake.js exposes only prose renderers
// (`wakeDigest`/`wakePulse`); its `gather` and `readPosition` are private to
// it, and this chunk may call that module but not change it. Lifting the
// selector into somewhere both can call is the right repair and belongs to
// whoever next has cause to edit wake.js. The chunk counts at least come from
// one place: friction.js reads the chunk streams for everything else here.
function positionRow(treeRoot) {
  const state = readJson(path.join(treeRoot, 'state.json'), null);
  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'), null);

  let milestone = null;
  if (isPlainObject(index) && Array.isArray(index.milestones)) {
    const entries = index.milestones.filter(isPlainObject);
    if (entries.length > 0) {
      const openAt = entries.findIndex((entry) => entry.status !== 'green');
      const at = openAt === -1 ? entries.length - 1 : openAt;
      milestone = { at, total: entries.length, entry: entries[at] };
    }
  }

  const id = milestone !== null && isNonEmptyString(milestone.entry.id) ? milestone.entry.id : null;
  const counts = chunkCountsFor(treeRoot, id);

  return {
    phase: isPlainObject(state) && isNonEmptyString(state.phase) ? state.phase : null,
    next_action: isPlainObject(state) && isNonEmptyString(state.next_action) ? state.next_action : null,
    milestone_id: id,
    milestone_index: milestone === null ? null : milestone.at + 1,
    milestone_total: milestone === null ? null : milestone.total,
    milestone_status:
      milestone !== null && isNonEmptyString(milestone.entry.status) ? milestone.entry.status : null,
    chunks_recorded: counts.recorded,
    chunks_green: counts.green,
  };
}

// The global aggregates, flattened to one row so they go through the same
// selector and the same cap as everything else.
function ratesRow(figures) {
  return {
    reviews_total: figures.reviews.total,
    reviews_approve: figures.reviews.approve,
    reviews_revise: figures.reviews.revise,
    reviews_revise_share: figures.reviews.revise_share,
    consults_total: figures.consults.total,
    consults_chunks_consulted: figures.consults.chunks_consulted,
    consults_chunks_seen: figures.consults.chunks_seen,
    consults_per_chunk: figures.consults.per_chunk,
    dispatches_dispatched: figures.dispatches.dispatched,
    dispatches_terminals: figures.dispatches.terminals,
    dispatches_pending: figures.dispatches.pending,
    dispatches_failed: figures.dispatches.failed,
    dispatches_timeout: figures.dispatches.timeout,
    dispatches_failure_share: figures.dispatches.failure_share,
    dispatches_timeout_share: figures.dispatches.timeout_share,
    holds_opened: figures.holds.opened,
    holds_resolved: figures.holds.resolved,
    holds_open: figures.holds.open,
  };
}

// regenerate(treeRoot) — rebuild every view from the tree as it stands now.
//
// Every view is derived BEFORE any of them is written, so a stream that does
// not read whole refuses the whole regeneration rather than leaving a
// half-current set on disk — a view that says "no open holds" because a
// stream failed to parse is worse than no view at all. Each file is then
// written atomically, so a crash between two of them leaves every file that
// landed complete and readable, and the next run finishes the rest.
function regenerate(treeRoot) {
  requireTreeRoot(treeRoot);
  const generatedAt = new Date().toISOString();

  const figures = rates(treeRoot);
  const built = {
    'open-holds': listView(listOpenHolds(treeRoot), { kinds: ['hold-open'], fields: HOLD_FIELDS }, generatedAt),
    'degraded-routes': listView(
      listDegradedRoutes(treeRoot),
      { kinds: ['degraded-route'], fields: DEGRADED_FIELDS },
      generatedAt
    ),
    'friction-rates': listView([ratesRow(figures)], { fields: RATE_FIELDS }, generatedAt),
    'friction-by-chunk': listView(figures.per_key.chunks, { fields: CHUNK_KEY_FIELDS }, generatedAt),
    'friction-by-seat': listView(figures.per_key.seats, { fields: DISPATCH_KEY_FIELDS }, generatedAt),
    'friction-by-transport': listView(figures.per_key.transports, { fields: DISPATCH_KEY_FIELDS }, generatedAt),
    position: listView([positionRow(treeRoot)], { fields: POSITION_FIELDS }, generatedAt),
  };

  const views = [];
  for (const name of VIEW_NAMES) {
    const file = viewPathOf(treeRoot, name);
    writeAtomicText(file, serialize(built[name]));
    views.push({ name, path: file, bytes: fs.statSync(file).size, dropped: built[name].dropped });
  }

  return { schema_version: SCHEMA_VERSION, generated_at: generatedAt, views };
}

module.exports = {
  regenerate,
  VIEW_NAMES,
  MAX_VIEW_BYTES,
  MAX_VIEW_ENTRIES,
};
