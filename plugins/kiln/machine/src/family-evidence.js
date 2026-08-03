'use strict';

// family-evidence.js — who actually built a chunk, and therefore who may
// review it.
//
// The cross-family review law has always been enforced against
// `chunk-start.implementer_family`, which is the family the routing INTENDED
// to use. Intent and outcome part company exactly when it matters most: a Sol
// dispatch that times out and is finished by a Claude fallback leaves a chunk
// whose record says gpt and whose code was written by Claude, and the "cross
// family" reviewer chosen from that record is the same family that wrote it.
// The whole decorrelation the law exists for is gone, and nothing in the tree
// says so.
//
// So this module reads the outcome instead. Every field of a `chunk-built`
// record comes off C1's `dispatch-terminal` — the family from the proven
// builder, the concrete model from the terminal's own attestation, the result
// digest from the same place — and none of it from the caller. A caller
// supplies one thing: which dispatch it is talking about. If that dispatch
// never terminated, failed, or succeeded without proving who built it, there
// is no record and therefore no reviewer: the attempt is discarded while it
// is still an attempt, rather than becoming a chunk somebody must review.
//
// THE FAMILY MAP IS THE EVIDENCE MAP. `builder` on a terminal is a proof
// vocabulary — `sol` means a codex session banner was actually in the
// transcript, `claude-fallback` means a native Agent step returned a real
// artifact under a named model, `null` means the machine cannot say. Those
// map to the two families this tree knows and to nothing else; an unproven
// builder has no family, which is not the same as having an unknown one.
//
// CHUNK IDS ARE MILESTONE-LOCAL. Every read here is scoped by the milestone
// whose stream it opens — `milestones/<id>/chunks.jsonl` — and no lookup ever
// keys on a chunk id alone. Two milestones each with a `C1` built by
// different families is the ordinary case, and a reviewer chosen from the
// wrong one is a same-family review that every downstream check would pass.
//
// WHAT THIS MODULE DOES NOT DO: it never chooses a seat's model out of its
// own head. Which model sits in which seat is `routing/`'s dated record, read
// through routing.js, digest and all; this module decides only which SEAT the
// evidence calls for. And it never seals anything: the seal's own cross-family
// check lives at the write boundary that accepts a `chunk-green`, in
// milestones.js, which reads the `chunk-built` record's actual family
// directly. `verifyReviewFamily` below is a standalone form of the same
// question, currently with no caller — its removal or re-homing is carried to
// a later slice rather than done here.

const path = require('node:path');

const { readRecords } = require('./stream.js');
const { readJson } = require('./atomic-json.js');
const { recordChunk } = require('./milestones.js');
const { stagedDiffDigest } = require('./implementation.js');
const { SEAT_AGENTS, FAMILY_OF_MODEL } = require('./validators.js');
const { loadRouting } = require('./routing.js');
const { DESIGNER_FAMILIES, FAMILY_OF_BUILDER } = require('./validators.js');

const LEDGER_FILENAME = 'ledger.jsonl';
const ROUTING_DIRNAME = 'routing';
const STATE_FILENAME = 'state.json';


// Which seat reviews work of a given family — the cross-family pairing, one
// entry per family, named the way the routing config names them.
const CHUNK_REVIEW_SEAT = Object.freeze({
  gpt: 'chunk_review_of_gpt_work',
  claude: 'chunk_review_of_claude_work',
});

const MILESTONE_REVIEW_SEAT = 'milestone_review';

// Which family a model belongs to. A closed map for the same reason the
// builder map is closed: a model this tree cannot place has no family, and
// guessing one would put an unknown mind on either side of a law about minds
// being different.
const DEGRADED_MODE = 'degraded-claude-only';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireTreeRoot(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('family-evidence: treeRoot must be a non-empty string');
  }
}

function requireScope(treeRoot, milestoneId, chunkId) {
  requireTreeRoot(treeRoot);
  if (!isNonEmptyString(milestoneId)) {
    throw new TypeError('family-evidence: milestoneId must be a non-empty string');
  }
  if (chunkId !== undefined && !isNonEmptyString(chunkId)) {
    throw new TypeError('family-evidence: chunkId must be a non-empty string');
  }
}

function requireFamily(family, what) {
  if (!DESIGNER_FAMILIES.has(family)) {
    throw new TypeError(
      `family-evidence: ${what} must be one of ${[...DESIGNER_FAMILIES].join(', ')} (got ${JSON.stringify(family)})`
    );
  }
}

// ---------- reading the two streams ----------

// Both readers fail closed on a stream that does not parse whole, for the
// same reason every other module in this tree does: an answer derived from
// the part that happened to parse is indistinguishable from a real one.
// "This dispatch has no terminal" read off a damaged ledger records a failed
// attempt as a build.
function readStreamOrThrow(file) {
  const { records, errors, headerViolations } = readRecords(file);
  if (errors.length > 0) {
    const detail = errors.map((e) => `line ${e.lineNo}: ${e.reason}`).join('; ');
    throw new Error(`family-evidence: ${file} has malformed record(s) — refusing to trust this stream: ${detail}`);
  }
  if (headerViolations.length > 0) {
    const detail = headerViolations.map((v) => `record[${v.index}]: ${v.errors.join(', ')}`).join('; ');
    throw new Error(
      `family-evidence: ${file} has record(s) violating the common JSONL header — refusing to trust this stream: ${detail}`
    );
  }
  return records;
}

function ledgerRecords(treeRoot) {
  return readStreamOrThrow(path.join(treeRoot, LEDGER_FILENAME));
}

// The chunk stream of ONE milestone. The milestone scope is the path itself,
// which is what keeps a chunk id from meaning anything outside it.
function chunkRecords(treeRoot, milestoneId) {
  return readStreamOrThrow(path.join(treeRoot, 'milestones', milestoneId, 'chunks.jsonl'));
}

function latestOfKind(records, kind, chunkId) {
  let latest = null;
  for (const record of records) {
    if (record.kind !== kind) continue;
    if (chunkId !== undefined && record.chunk_id !== chunkId) continue;
    if (latest === null || record.seq > latest.seq) latest = record;
  }
  return latest;
}

// builtRecordOf(treeRoot, milestoneId, chunkId) — the chunk's build evidence,
// or a refusal naming what is missing. Every question this module answers
// after a build starts here, so the "there is no evidence yet" refusal is
// written once.
function builtRecordOf(records, milestoneId, chunkId) {
  const built = latestOfKind(records, 'chunk-built', chunkId);
  if (built === null) {
    throw new Error(
      `family-evidence: chunk "${chunkId}" of milestone "${milestoneId}" has no "chunk-built" record — nothing has proved who built it`
    );
  }
  return built;
}

// ---------- the evidence a terminal carries ----------

// What the dispatch actually produced, or why this attempt is not a build.
// Each refusal is separate on purpose: "never dispatched", "still running",
// "failed", and "succeeded anonymously" are four different situations, and a
// caller reading one message should not have to guess which it hit.
function evidenceOfDispatch(ledger, dispatchId) {
  const terminal = ledger.find(
    (record) => record.kind === 'dispatch-terminal' && record.dispatch_id === dispatchId
  );
  if (terminal === undefined) {
    throw new Error(
      `family-evidence: dispatch ${JSON.stringify(dispatchId)} has no terminal record — there is no outcome to compose a build out of`
    );
  }
  return {
    // `?? null` rather than a refusal: whether this terminal proves a family
    // is the WRITE BOUNDARY's question, and asking it here too would be the
    // same law in two places — protecting only the callers who came through
    // composition, which were never the ones at risk. What composition owes is
    // a faithful record of what the terminal says; milestones.js decides
    // whether the tree accepts it.
    actual_family: FAMILY_OF_BUILDER[terminal.builder] ?? null,
    model_id: terminal.model_id,
    result_digest: terminal.result_digest,
    dispatch_ref: `ledger:${terminal.seq}`,
  };
}

// ---------- recordBuilt ----------

// recordBuilt(treeRoot, milestoneId, chunkId, {dispatch_id}, opts) — turn a
// finished dispatch into the chunk's build evidence.
//
// opts: {repoRoot = <treeRoot>/..}, the same default implementation.js uses,
// because the diff digest is a fact about the repository the chunk was built
// in and nobody has told this module a different one.
function recordBuilt(treeRoot, milestoneId, chunkId, attempt, opts = {}) {
  requireScope(treeRoot, milestoneId, chunkId);
  if (!isPlainObject(attempt) || !isNonEmptyString(attempt.dispatch_id)) {
    throw new TypeError('family-evidence: recordBuilt requires a non-empty "dispatch_id"');
  }
  const dispatchId = attempt.dispatch_id;
  const repoRoot = isNonEmptyString(opts.repoRoot) ? opts.repoRoot : path.join(treeRoot, '..');

  const records = chunkRecords(treeRoot, milestoneId);
  const evidence = evidenceOfDispatch(ledgerRecords(treeRoot), dispatchId);
  const diffDigest = stagedDiffDigest(repoRoot);

  // The intent is the CHUNK's, read off its own milestone-scoped chunk-start,
  // not the dispatch's. On the sequence this record exists to expose — a Sol
  // dispatch that failed, then a native Claude rebuild — the successful
  // dispatch is itself a claude one, so taking intent from it would record
  // intended === actual and erase exactly the divergence being recorded.
  const started = latestOfKind(records, 'chunk-start', chunkId);
  if (started === null) {
    throw new Error(
      `family-evidence: chunk "${chunkId}" of milestone "${milestoneId}" has no "chunk-start" record — nothing says what this chunk went out intending`
    );
  }
  evidence.intended_family = started.implementer_family;

  // Already recorded: the receipt is the record on disk — but only once every
  // input this call carries is the input that was actually recorded. The
  // evidence itself is immutable (it comes off a terminal, and a terminal is
  // written once), so the input that can have moved is the diff: a second
  // call over a different staged diff is a different build wearing a recorded
  // chunk's identity.
  const existing = latestOfKind(records, 'chunk-built', chunkId);
  if (existing !== null) {
    if (existing.dispatch_ref !== evidence.dispatch_ref || existing.diff_digest !== diffDigest) {
      throw new Error(
        `family-evidence: chunk "${chunkId}" of milestone "${milestoneId}" already recorded a different build (dispatch ${JSON.stringify(existing.dispatch_ref)}, diff ${existing.diff_digest}) — refusing to record it twice`
      );
    }
    return { seq: existing.seq, record: existing };
  }

  const { seq } = recordChunk(
    treeRoot,
    milestoneId,
    {
      kind: 'chunk-built',
      chunk_id: chunkId,
      actual_family: evidence.actual_family,
      intended_family: evidence.intended_family,
      model_id: evidence.model_id,
      dispatch_ref: evidence.dispatch_ref,
      result_digest: evidence.result_digest,
      diff_digest: diffDigest,
    },
    // The same repository the digest above was taken from: the boundary
    // recomputes it and compares, so both must be looking at one repo.
    { repoRoot }
  );

  const written = chunkRecords(treeRoot, milestoneId).find((record) => record.seq === seq);
  return { seq, record: written };
}

// An INJECTIVE key over the (milestone, chunk) pair. Neither id is shape-
// constrained — `milestones.js` asks only for a non-empty string — so joining
// them with a separator is not a key: "a-b"/"c" and "a"/"b-c" would collide,
// and a collision here silently merges two chunks' degraded routes into one
// record. JSON of the pair cannot collide, because the encoding is reversible.
function scopeKey(milestoneId, chunkId) {
  return JSON.stringify([milestoneId, chunkId]);
}

// ---------- the routing table ----------

function routingOf(treeRoot) {
  return loadRouting(path.join(treeRoot, ROUTING_DIRNAME)).config;
}

// The milestone-review seat is declared as a bare string ("cross-family")
// rather than a model pairing, because which family reviews is computed from
// the milestone's own build evidence rather than pinned in the table. What the
// table still owes is the DECLARATION: a config that does not name the seat is
// one this milestone cannot be reviewed through.
function milestoneReviewSeat(config) {
  const entry = config.seats[MILESTONE_REVIEW_SEAT];
  if (entry !== 'cross-family') {
    throw new Error(
      `family-evidence: the active routing config declares "${MILESTONE_REVIEW_SEAT}" as ${JSON.stringify(entry)}, not "cross-family" — a milestone review has no seat to be held in`
    );
  }
  return entry;
}

function seatEntry(config, seat) {
  const entry = config.seats[seat];
  if (!isPlainObject(entry)) {
    throw new Error(
      `family-evidence: the active routing config has no seat "${seat}" to name a reviewer from`
    );
  }
  return entry;
}

// The family a seat's model belongs to, refusing a model the tree cannot
// place rather than assuming which side of the law it falls on.
function familyOfModel(model, where) {
  const family = FAMILY_OF_MODEL[model];
  if (family === undefined) {
    throw new Error(
      `family-evidence: ${where} names model ${JSON.stringify(model)}, which this tree cannot place in a family — refusing to guess which side of the cross-family law it sits on`
    );
  }
  return family;
}

function preflightMode(treeRoot) {
  const state = readJson(path.join(treeRoot, STATE_FILENAME), null);
  if (!isPlainObject(state) || !isPlainObject(state.preflight)) return null;
  return state.preflight.mode;
}

// The seat, and the model/effort/scope the dated config pairs with it. Only
// the keys the config actually declares travel back — a caller spawning the
// seat should see the same table a reader of routing/ would.
// A selection names the INSTALLED seat, not the routing key it was chosen by.
// The key stays here, as `routing_key`, because the config is indexed on it and
// the degraded table has to be looked up by it — but nothing downstream ever
// dispatches a key, because a key binds no agent.
function seatSelection(seat, entry) {
  const family = familyOfModel(entry.model, `seat "${seat}"`);
  const agent = SEAT_AGENTS.chunk_review[family];
  if (agent === undefined) {
    throw new Error(
      `family-evidence: no installed chunk-review seat for the ${family} family — a routing key that reaches an agentType binds nothing`
    );
  }
  const selection = { seat: agent, routing_key: seat, model: entry.model, family };
  if (isNonEmptyString(entry.effort)) selection.effort = entry.effort;
  if (isNonEmptyString(entry.scope)) selection.scope = entry.scope;
  return selection;
}

// ---------- reviewerAvailability ----------

// reviewerAvailability(treeRoot, milestoneId, chunkId) — is there a LAWFUL
// reviewer for this chunk at all? A pure read: it decides nothing about who
// reviews and it writes nothing, so the resolver can ask it before any seat is
// dispatched and get the same answer in a fresh process.
//
// THERE IS NO SAME-FAMILY SUBSTITUTE. Degraded mode used to seat a second
// Claude mind on a Claude-built chunk and record that it had. Two things are
// wrong with that and the second is fatal: the cross-family decorrelation the
// review exists for is not merely reduced, it is gone — one family's blind
// spots reviewing that same family's work — and the seal REFUSES exactly this
// pairing (`milestones.js` checks a review's family against the family that
// actually built), so the substitution could only ever produce a chunk that
// was reviewed and could never be sealed. Work that cannot be sealed is not
// work that continued under a substitute; it is a stop, and the honest move is
// to declare it as one before a reviewer is paid for.
//
// The route this returns is the DESCRIPTION of that stop, not a record: the
// caller that turns a stop into something durable writes it, and the identity
// is scoped to the chunk so a relaunch reuses that record rather than adding a
// second one.
function reviewerAvailability(treeRoot, milestoneId, chunkId) {
  requireScope(treeRoot, milestoneId, chunkId);
  // Asked FIRST, and cheaply. In full operation there is nothing to declare,
  // and this question must not become the thing that makes a tree
  // unresolvable: reading the routing table to answer "is a reviewer
  // available" on every single review would turn a missing or unreadable
  // config into a resolver that throws where it used to answer. Full operation
  // keeps exactly the path it had, and the table is consulted only where the
  // answer can differ.
  if (preflightMode(treeRoot) !== DEGRADED_MODE) return { available: true };

  const built = builtRecordOf(chunkRecords(treeRoot, milestoneId), milestoneId, chunkId);
  const seat = CHUNK_REVIEW_SEAT[built.actual_family];
  const selection = seatSelection(seat, seatEntry(routingOf(treeRoot), seat));

  // Degraded mode is a statement about what is REACHABLE, not about what the
  // table says: `degraded-claude-only` means no gpt model can be run at all,
  // so a chunk whose lawful reviewer resolves to one has no reviewer, however
  // lawful the pairing looks on paper. A chunk the gpt family built is
  // untouched — its reviewer was already a Claude one.
  if (selection.family !== 'gpt') return { available: true };

  return {
    available: false,
    route: {
      route_id: `chunk-review ${scopeKey(milestoneId, chunkId)}`,
      expected: 'gpt',
      actual: 'none',
      reason: `degraded-claude-only: no gpt reviewer is reachable for chunk "${chunkId}" of milestone "${milestoneId}", and a claude review of claude-built work is the one pairing the seal refuses`,
      scope_ref: `milestones/${milestoneId}/${chunkId}`,
    },
  };
}

// ---------- selectReviewer ----------

// selectReviewer(treeRoot, milestoneId, chunkId) — which seat reviews this
// chunk, decided from who actually built it.
function selectReviewer(treeRoot, milestoneId, chunkId) {
  const availability = reviewerAvailability(treeRoot, milestoneId, chunkId);
  if (availability.available !== true) {
    // The resolver asks the same question before it dispatches anything, so
    // reaching here in this state means a caller went around it. Fail closed
    // rather than seating the pairing the seal will refuse.
    throw new Error(`family-evidence: ${availability.route.reason} — there is no reviewer to select`);
  }

  const built = builtRecordOf(chunkRecords(treeRoot, milestoneId), milestoneId, chunkId);
  const seat = CHUNK_REVIEW_SEAT[built.actual_family];
  const selection = seatSelection(seat, seatEntry(routingOf(treeRoot), seat));

  // The pairing in the config is cross-family in full operation; this check
  // is here because that is a property of a table, and a table is a dated bet
  // somebody can edit. A same-family pairing is a routing defect, not a state
  // to review through.
  if (selection.family === built.actual_family) {
    throw new Error(
      `family-evidence: seat "${seat}" reviews chunk "${chunkId}" with a ${selection.family} model, the same family that built it — the routing config does not pair this chunk with a cross-family reviewer`
    );
  }
  return { ...selection, actual_family: built.actual_family, degraded: false };
}

// ---------- selectMilestoneReviewer ----------

// selectMilestoneReviewer(treeRoot, milestoneId) — the same law one level up,
// computed rather than left to the reviewing agent's own read of the stream.
// No model chooses its own reviewer.
//
// The dominant family is the one that built the most chunks. An EVEN split has
// no dominant family and no fully decorrelated reviewer, and the mirror rule
// settles it by CONSERVATISM rather than by accident: the tie takes the
// Sol-hosted path. Anything derived from build ORDER — the freshest chunk, the
// last writer — makes the reviewing family depend on which chunk happened to
// finish last, which is not a property of the work and would flip a milestone's
// reviewer on a rerun that finished in a different order.
function selectMilestoneReviewer(treeRoot, milestoneId) {
  requireScope(treeRoot, milestoneId);
  const records = chunkRecords(treeRoot, milestoneId);
  // Read before anything is decided: the seat this returns is the routing
  // table's to declare, and a table that does not declare it cannot be
  // reviewed through.
  milestoneReviewSeat(routingOf(treeRoot));

  const counts = { gpt: 0, claude: 0 };
  let seen = false;
  for (const record of records) {
    if (record.kind !== 'chunk-built') continue;
    // milestones.js refuses an unreadable family on the way in, so this can
    // only be a stream that acquired one some other way. Skipping the record
    // would compute a dominance over the records it happened to understand —
    // a number nobody can act on that looks exactly like a real one.
    if (!DESIGNER_FAMILIES.has(record.actual_family)) {
      throw new Error(
        `family-evidence: chunk "${record.chunk_id}" of milestone "${milestoneId}" carries ${JSON.stringify(record.actual_family)}, which cannot be read as a family — refusing to tally a stream this module does not understand`
      );
    }
    counts[record.actual_family] += 1;
    seen = true;
  }
  if (!seen) {
    throw new Error(
      `family-evidence: milestone "${milestoneId}" has no "chunk-built" records — nothing has proved who built it`
    );
  }

  const selection = { seat: SEAT_AGENTS.milestone_review, routing_key: MILESTONE_REVIEW_SEAT, counts };
  if (counts.gpt === counts.claude) {
    selection.dominant_family = null;
    selection.review_family = 'gpt';
    selection.tie_broken_by = 'conservative';
  } else {
    selection.dominant_family = counts.gpt > counts.claude ? 'gpt' : 'claude';
    selection.review_family = selection.dominant_family === 'gpt' ? 'claude' : 'gpt';
  }
  return selection;
}

// ---------- verifyReviewFamily ----------

// verifyReviewFamily(treeRoot, milestoneId, chunkId, reviewFamily) — the
// cross-family law asked against ACTUAL authorship, as a standalone check.
//
// NOTHING CALLS THIS TODAY, and the reason is worth stating where the next
// reader meets it. It was written when `milestones.js` compared a review's
// family against `chunk-start.implementer_family` — the INTENT — and this was
// to be the stronger check a sealer ran beside it. That comparison was the
// defect: intent and outcome part company exactly at a fallback, where it
// accepted a same-family review and refused the lawful cross-family one, so
// the boundary now reads `chunk-built.actual_family` itself and there is no
// second question left for a caller to ask. It cannot be called from the seal
// path in any case — `implementation.js` owns sealing and this module already
// imports it, so the dependency only runs one way. Retiring or re-homing it is
// carried to a later slice; it is left here rather than deleted mid-cutover.
function verifyReviewFamily(treeRoot, milestoneId, chunkId, reviewFamily) {
  requireScope(treeRoot, milestoneId, chunkId);
  requireFamily(reviewFamily, 'reviewFamily');
  const built = builtRecordOf(chunkRecords(treeRoot, milestoneId), milestoneId, chunkId);

  if (built.actual_family === reviewFamily) {
    throw new Error(
      `family-evidence: chunk "${chunkId}" of milestone "${milestoneId}" was built by the ${built.actual_family} family and reviewed by it too — cross-family review law, against who actually built it rather than who was meant to`
    );
  }
  return { actual_family: built.actual_family, review_family: reviewFamily };
}

module.exports = {
  recordBuilt,
  reviewerAvailability,
  selectReviewer,
  selectMilestoneReviewer,
  verifyReviewFamily,
};
