'use strict';

// journeys.js — the sole writer of `verification/journeys.json`, and of the
// `chunk-journeys` record that is its audit trail.
//
// THE GAP THIS CLOSES. The catalog is what `verification.js#assembleSuite`
// reads, and assembleSuite is fail-closed on it: a missing, malformed or
// incomplete catalog stops the verification phase at its entry rather than
// letting a suite run over an unknown set of journeys. Until this module, the
// catalog had NO writer at all. It used to be appended by the milestone
// designer by hand, during the manual chunk step; that step is gone, nothing
// replaced the write, and `product/doctrine.md` and
// `product/implementation/flow.md` both carried the gap as a named hole.
//
// ONE ACTION WRITES BOTH RECORDS, which is `product/verification/flow.md`'s own
// prescription and not a convenience: the audit trail (`chunks.jsonl`'s
// `chunk-journeys`) and the assemblable entry (`journeys.json`) are two views of
// a single fact, and two disconnected writers of one fact is how they come
// apart. Whichever of the two a crash interrupts, re-entry writes only what is
// missing — each half is idempotent on its own content.
//
// WHERE THE ENTRY'S FIELDS COME FROM, AND WHY NONE OF THEM IS INVENTED HERE:
//
//   journey_id   the chunk plan's nomination — the designer's decision about
//                which journey this chunk closes, promoted as DATA beside
//                spec.md for exactly the reason the chunk list is: prose cannot
//                be asked which journey a chunk closes.
//   criterion_id DERIVED from `architecture/criteria-register.json`, which is
//                frozen at the plan gate and internally 1:1. Nobody downstream
//                gets to say which criterion a journey answers; the register
//                already said, and a journey_id the register does not carry is
//                refused rather than catalogued.
//   script_path  the nomination's, and VERIFIED against the sealed commit: the
//                entry is only written once git can show the file at HEAD. A
//                catalogued path pointing at nothing is a suite that cannot
//                run, discovered a whole phase later.
//   harness      the nomination's, checked against verification.js's own closed
//                set — the consumer's vocabulary, never a second copy of it.
//   added_in_milestone
//                the milestone the chunk belongs to. Not a claim anyone makes.
//
// A REFUSAL WRITES NOTHING. Every check above runs before the first mutation,
// so a nomination naming an unknown journey, an unsafe path, an unknown harness
// or a file the seal did not commit leaves the catalog and the chunk stream
// exactly as they were.

const path = require('node:path');

const { readJson, writeAtomic } = require('./atomic-json.js');
const { validateCriteriaRegister } = require('./validators.js');
const { HARNESSES, isContainedScriptPath } = require('./verification.js');
const { recordChunk } = require('./milestones.js');
const { git } = require('./staged-diff.js');

const CATALOG_SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// nominationProblem(journey) -> string | null. The shape of a chunk plan's
// journey nomination, owned here because this module is what will later have to
// write it: `promotion.js` refuses a plan carrying a malformed one at the
// promotion boundary using this same function, so a designer hears about it
// while it can still be fixed rather than a milestone later.
function nominationProblem(journey) {
  if (!isPlainObject(journey)) {
    return 'a journey nomination must be an object {journey_id, script_path, harness}';
  }
  if (!isNonEmptyString(journey.journey_id)) {
    return 'a journey nomination requires a non-empty "journey_id" — the one the criteria register already minted';
  }
  if (!isContainedScriptPath(journey.script_path)) {
    return `a journey nomination requires a "script_path" that is a safe, contained relative path (got ${JSON.stringify(journey.script_path)})`;
  }
  if (!HARNESSES.has(journey.harness)) {
    return `a journey nomination requires a "harness" that is one of ${[...HARNESSES].join(', ')} (got ${JSON.stringify(journey.harness)})`;
  }
  const extra = Object.keys(journey).filter((key) => !['journey_id', 'script_path', 'harness'].includes(key));
  if (extra.length > 0) {
    return `a journey nomination carries unexpected key(s): ${extra.join(', ')}`;
  }
  return null;
}

function catalogPathOf(treeRoot) {
  return path.join(treeRoot, 'verification', 'journeys.json');
}

// The catalog as it stands, or the empty one this build starts from. The file
// legitimately does not exist until the first journey is authored, and a writer
// that refused an absent catalog would make the first journey unwritable.
function readCatalog(treeRoot) {
  const file = catalogPathOf(treeRoot);
  const existing = readJson(file, null);
  if (existing === null) return { schema_version: CATALOG_SCHEMA_VERSION, journeys: [] };
  if (!isPlainObject(existing) || existing.schema_version !== CATALOG_SCHEMA_VERSION || !Array.isArray(existing.journeys)) {
    throw new Error(
      `journeys: ${file} is not a journey catalog {schema_version: ${CATALOG_SCHEMA_VERSION}, journeys: [...]} — refusing to append to a file this module cannot read`
    );
  }
  return existing;
}

// The criterion this journey answers, according to the register and nothing
// else. The register is digest-frozen at the plan gate and internally 1:1, so
// this is a lookup rather than a judgment — and a journey_id it does not carry
// is an invented one.
function criterionFor(treeRoot, journeyId) {
  const file = path.join(treeRoot, 'architecture', 'criteria-register.json');
  const register = readJson(file, null);
  const { ok, errors } = validateCriteriaRegister(register);
  if (!ok) {
    throw new Error(`journeys: ${file} is not a usable criteria register — ${errors.join('; ')}`);
  }
  const entry = register.criteria.find((candidate) => candidate.journey_id === journeyId);
  if (entry === undefined) {
    throw new Error(
      `journeys: the criteria register names no journey ${JSON.stringify(journeyId)} — a journey the architecture never minted has no criterion to answer, and the register is frozen`
    );
  }
  return entry.id;
}

// The script has to be in the COMMIT, not merely on disk. The seal is what
// makes a chunk's work real, and the working tree is a copy of it that anything
// could have touched since.
function requireScriptSealed(repoRoot, scriptPath) {
  const shown = git(repoRoot, ['cat-file', '-e', `HEAD:${scriptPath}`]);
  if (shown.status !== 0) {
    throw new Error(
      `journeys: the sealed commit in ${repoRoot} carries no ${JSON.stringify(scriptPath)} — a catalogued journey whose script is not there is a suite that cannot run`
    );
  }
}

// THE ORDER OF THE TWO WRITES IS THE WHOLE SAFETY ARGUMENT, and it is settled
// by which of them can be replayed rather than by which is more important.
//
// The catalog is a file and the audit record is a stream; nothing makes the pair
// atomic. So every refusal either side can raise runs BEFORE either is written —
// the catalog's conflicting-entry check reads and validates without mutating,
// and `recordChunk` owns the rest (the milestone must exist and not be green,
// the stream must parse under the common header, the chunk must already have a
// lifecycle record, and the serialized line must fit `jsonl.js`'s byte ceiling).
// Then the RECORD goes down first and the catalog second.
//
// That order, and not the reverse, because only the record has a replay:
// `milestones.js#recordChunk` returns the existing receipt for an identical
// `chunk-journeys` payload. A crash between the two therefore leaves a trail
// entry with no catalog line, and re-entry adopts that entry and finishes the
// catalog — the two converge. Inverted, the same crash would leave a catalogued
// journey no trail accounts for, and re-entry would append a second record.
//
// An earlier version of this module pre-scanned `recordChunk`'s refusals here
// so the catalog could safely be written first. That was a second copy of
// another module's law, kept in step by hand, and it is gone: the ordering does
// the work instead.

// recordAuthoredJourney(treeRoot, repoRoot, milestoneId, chunkId, nomination)
// — the catalog entry and its audit record, written once.
//
// Idempotent on content, which is what "replay byte-stable" costs: an entry
// already in the catalog with exactly these fields is left alone (the file is
// not rewritten, so its bytes, mtime and inode all hold still), and one
// carrying the same journey_id with anything else is refused rather than
// silently replaced — the same replay law every durable writer in this tree
// holds to.
function recordAuthoredJourney(treeRoot, repoRoot, milestoneId, chunkId, nomination) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('journeys: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(repoRoot)) {
    throw new TypeError('journeys: repoRoot must be a non-empty string');
  }
  if (!isNonEmptyString(milestoneId)) {
    throw new TypeError('journeys: milestoneId must be a non-empty string');
  }
  if (!isNonEmptyString(chunkId)) {
    throw new TypeError('journeys: chunkId must be a non-empty string');
  }
  const problem = nominationProblem(nomination);
  if (problem !== null) throw new TypeError(`journeys: ${problem}`);

  const entry = {
    journey_id: nomination.journey_id,
    criterion_id: criterionFor(treeRoot, nomination.journey_id),
    script_path: nomination.script_path,
    harness: nomination.harness,
    added_in_milestone: milestoneId,
  };
  requireScriptSealed(repoRoot, entry.script_path);

  // The catalog is READ and validated here, and not written: a conflicting
  // entry is a refusal, and it has to be raised before anything is recorded.
  const catalog = readCatalog(treeRoot);
  const already = catalog.journeys.find(
    (candidate) => isPlainObject(candidate) && candidate.journey_id === entry.journey_id
  );
  if (already !== undefined && JSON.stringify(already) !== JSON.stringify(entry)) {
    throw new Error(
      `journeys: the catalog already carries ${JSON.stringify(entry.journey_id)} describing something else (${JSON.stringify(already)}) — refusing to write a conflicting duplicate`
    );
  }

  // The record first — it is the half with a replay, so it is the half a crash
  // may safely land on. Every refusal it owns fires here, before any catalog
  // byte moves.
  recordChunk(treeRoot, milestoneId, { kind: 'chunk-journeys', chunk_id: chunkId, journey_ids: [entry.journey_id] });

  if (already === undefined) {
    writeAtomic(catalogPathOf(treeRoot), { ...catalog, journeys: [...catalog.journeys, entry] });
  }

  return {
    catalog_path: catalogPathOf(treeRoot),
    entry,
    state: already === undefined ? 'catalogued' : 'already-catalogued',
  };
}

module.exports = { recordAuthoredJourney, nominationProblem, CATALOG_SCHEMA_VERSION };
