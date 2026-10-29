'use strict';

// verification-spine.js — what happens next in the verification phase's GREEN
// PATH, derived from disk and from nothing else.
//
// THE SIBLING, NOT THE EXTENSION. `spine.js` answers this question for the
// implementation phase; this module answers the same question for the hundred
// eyes, over its own tree (`verification/`) and its own machine
// (`verification.js`). They share a law and no code path: a resolver that
// reached into the other's ladder would make one phase's state a hidden input
// to the other's answer.
//
// PURE OVER DISK. `nextTransition` reads canonical files and returns a
// descriptor. It writes nothing, starts no process, and remembers nothing: the
// same tree state gives the same answer in a fresh process, which is what makes
// "kill the pass anywhere and re-run" a property rather than a hope. It calls
// only the pure halves of `verification.js` — the assembler, the ordering, the
// suite digest — so the one law for "does this catalog assemble" and the one
// law for "which journey runs next" have exactly one implementation each. Every
// operation that WRITES or EXECUTES stays with the callers the machine already
// sanctions; this module names them and their arguments' sources, and performs
// none of them.
//
// A TRANSITION MUST LEAVE DURABLE EVIDENCE, OR IT IS NOT A TRANSITION. That is
// why the walk has three rungs and not five. Assembling the suite writes
// nothing anyone can read back, so it is not a transition of its own: it is
// folded into the run that binds its digest, and the `run-start` record IS the
// evidence that a suite was assembled and bound. Ordering writes nothing
// either, so it is folded into the per-journey rung: the durable evidence that
// a journey ran is its own `journey-result` record, and the order is derived
// again from disk on every invocation rather than remembered between them.
//
//   start-run            the assembled suite has no current run
//                        -> evidence: the run's own run-start record and its
//                           entry in verification/runs-index.json
//   run-journey          one journey of the current run, the first the
//                        failing-first order still owes
//                        -> evidence: that journey's journey-result record in
//                           verification/runs/<run-id>.jsonl
//   compute-suite-state  every journey of the current run is recorded
//                        -> evidence: verification/suite-state.json, bound to
//                           the run id and the suite digest
//
// WHAT THIS MODULE DOES NOT OWN, AND WILL NOT IMPROVISE. The verdict's two
// outcomes both leave this walk. A red verdict belongs to the red ladder — the
// one flake re-run, the quarantine decision, the capped fix loop — and a green
// one belongs to the post-green lane and this phase's own exit checks. Neither
// is built on this tree yet, so both states resolve to a stop that NAMES the
// vocabulary it is waiting on rather than to an arm that guesses at it. A
// resolver that improvised either would be deciding, in a chunk that owns
// neither, what a failing suite means.
//
// THE STREAM IT WILL NOT GUESS FROM. `spine.js` refuses to resolve from a
// stream it cannot fully parse, because deciding "that step never happened" out
// of a partial read is how a step gets performed twice — and here that would be
// a journey run twice under one run id, which is the duplicate-result the
// verdict already refuses. So an unreadable run stream is never answered with
// another journey: it goes straight to the verdict, which is the one operation
// with a designed, fail-closed answer for exactly that state.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { readRecords } = require('./stream.js');
// The pure half of the phase's own machine, and the only half a resolver may
// touch: the assembler is fail-closed over two documents, the ordering is a
// stable reordering of an array, and the digest is a hash. None of the three
// reads or writes anything.
const { assembleSuite, orderRun, digestSuite } = require('./verification.js');

// The transition vocabulary, closed. A name that is not in here is not a thing
// the workflow can be asked to do on this phase's green path.
const TRANSITIONS = Object.freeze({
  START_RUN: 'start-run',
  RUN_JOURNEY: 'run-journey',
  COMPUTE_SUITE_STATE: 'compute-suite-state',
  BLOCKED: 'blocked',
});

// What the workflow returns to the fire for each transition. The vocabulary is
// `receipts.js`'s own WORKFLOW_RETURNS, which is what refuses a return this
// machine does not know; named here the same way `spine.js` names it, so a
// descriptor carries its return rather than leaving the script to decide one.
const RETURNS = Object.freeze({
  BEAT: 'beat',
  PHASE_COMPLETE: 'phase_complete',
  OPERATOR_NEEDED: 'operator_needed',
  NEEDS_CONSULT: 'needs_consult',
  BLOCKED: 'blocked',
});

// A run id becomes a file name (`verification/runs/<run-id>.jsonl`) and half of
// every journey's gate id. The phase's own machine takes any non-empty string
// for it, so an id that walks out of the runs directory is producible through
// the CLI; refusing it here costs nothing and is the same rule `spine.js`
// applies to milestone and chunk ids. It is also what makes the gate id
// injective: a run id drawn from this charset AND generated as `r<n>` carries
// no dash, so `journey-<journey-id>-<run-id>` splits at exactly one place.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const RUNS_DIR = 'verification/runs';
const CATALOG = 'verification/journeys.json';
const REGISTER = 'architecture/criteria-register.json';
const RUNS_INDEX = 'verification/runs-index.json';
const AFFECTED_MAP = 'verification/affected-map.json';
const SUITE_STATE = 'verification/suite-state.json';
const QUARANTINE = 'verification/quarantine.json';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireTreeRoot(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('verification-spine: treeRoot must be a non-empty string');
  }
}

// ONE READ IS ONE FACT, AND THE DIGEST IS A FACT ABOUT THE SAME BYTES. Every
// document this resolver answers from is read exactly once, parsed from the
// bytes it just read, and cited by a digest of those same bytes — so a
// descriptor's evidence can never describe a file revision the answer was not
// derived from. A document that exists and cannot be parsed stops the resolver
// rather than reading as an absent one: "the catalog is not there" and "the
// catalog is unreadable" are different states with different repairs.
function snapshot(treeRoot, relPath) {
  const file = path.join(treeRoot, relPath);
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let json;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new Error(
      `verification-spine: ${relPath} is not readable JSON — refusing to resolve from a document it cannot read: ${err.message}`
    );
  }
  return { path: relPath, digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`, json };
}

function refOf(shot) {
  return { path: shot.path, digest: shot.digest };
}

// The refs an arm actually derived from, in a stable order, absent documents
// dropped. Evidence is a claim about disk, so a null snapshot cites nothing
// rather than citing a path with no digest behind it.
function evidenceOf(...shots) {
  return shots.filter((shot) => shot !== null && shot !== undefined).map(refOf);
}

// ---------- descriptors ----------

function transition(name, fields) {
  return Object.assign({ transition: name, return: RETURNS.BEAT }, fields);
}

function blocked(reason, fields) {
  return Object.assign({ transition: TRANSITIONS.BLOCKED, return: RETURNS.BLOCKED, reason }, fields);
}

// ---------- the runs index ----------

function runsIndexEntries(shot) {
  if (shot === null) return [];
  if (!isPlainObject(shot.json) || !Array.isArray(shot.json.runs)) {
    throw new Error(
      `verification-spine: ${RUNS_INDEX} must be an object with a "runs" array — refusing to resolve from an index it cannot read`
    );
  }
  return shot.json.runs.filter(isPlainObject);
}

function runStreamPath(runId) {
  return `${RUNS_DIR}/${runId}.jsonl`;
}

// The next run id, derived rather than remembered. `start-run` refuses a run id
// the index already carries AND one whose own stream already holds records, so
// both refusals are answered here: the id this resolver names is one that can
// actually be started. The second half is not hypothetical — the run stream is
// appended to BEFORE the index is written, so a crash between the two halves
// leaves an id that is spent and invisible to the index, and a resolver that
// counted index entries alone would name it forever.
function nextRunId(treeRoot, entries) {
  const taken = new Set(entries.map((entry) => entry.run_id));
  for (let n = entries.length + 1; ; n++) {
    const candidate = `r${n}`;
    if (taken.has(candidate)) continue;
    if (fs.existsSync(path.join(treeRoot, runStreamPath(candidate)))) continue;
    return candidate;
  }
}

// ---------- the run's own stream ----------

// The current run's records, read once, with the parse verdict alongside them.
// The verdict travels because it decides the arm: a stream with a torn line is
// not a stream this resolver will count journeys out of.
function runStream(treeRoot, runId) {
  const file = path.join(treeRoot, runStreamPath(runId));
  const { records, errors, headerViolations } = readRecords(file);
  return { records, malformed: errors.length > 0 || headerViolations.length > 0 };
}

// ---------- the failing-first order ----------

// The previous pass's failures, in the shape `orderRun` reads them, taken from
// the verdict artifact rather than from anyone's memory of it. This is
// `product/verification/flow.md`'s own step (b): the prior suite-state's
// `failing` list is what puts a journey at the front of the next pass.
function previousResults(suiteStateShot) {
  if (suiteStateShot === null || !isPlainObject(suiteStateShot.json) || !Array.isArray(suiteStateShot.json.failing)) {
    return [];
  }
  return suiteStateShot.json.failing
    .filter(isNonEmptyString)
    .map((journeyId) => ({ journey_id: journeyId, status: 'fail', duration_ms: 0, gate_id: 'prior' }));
}

// ---------- nextTransition ----------

// nextTransition(treeRoot) — the one question this module answers: given what
// is on disk right now, what is the single next thing to do on the verification
// phase's green path?
//
// The order below is the walk, read top to bottom: a suite must assemble before
// a run can bind it, a run must exist before a journey can be recorded into it,
// and every journey must be recorded before the verdict means anything. Each
// rung asks only about durable state, so the same tree resolves to the same rung
// however many times it is asked and whichever process asks.
function nextTransition(treeRoot) {
  requireTreeRoot(treeRoot);

  // ONE SNAPSHOT PER RESOLVE. Every arm below answers from these six reads and
  // never goes back to disk for a second opinion — two reads of one file are two
  // facts, and an arm that re-read one could answer about a tree that no longer
  // matches the evidence it cites.
  const register = snapshot(treeRoot, REGISTER);
  const catalog = snapshot(treeRoot, CATALOG);
  const index = snapshot(treeRoot, RUNS_INDEX);
  const affected = snapshot(treeRoot, AFFECTED_MAP);
  const suiteState = snapshot(treeRoot, SUITE_STATE);
  const quarantine = snapshot(treeRoot, QUARANTINE);

  const missing = [];
  if (catalog === null) missing.push(CATALOG);
  if (register === null) missing.push(REGISTER);
  if (missing.length > 0) {
    return blocked(
      `this phase assembles its suite from ${REGISTER} and ${CATALOG}, and ${missing.join(' and ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not on this tree — the architecture phase emits the register, and the catalog is written one entry at a time as each chunk's journey is authored, so an absent one means the pass before this one has nothing to hand over`,
      {
        block_id: catalog === null ? 'verification:no-catalog' : 'verification:no-criteria-register',
        evidence: evidenceOf(register, catalog),
        missing,
      }
    );
  }

  // THE FAIL-CLOSED ENTRY, AND ITS ERRORS CARRIED WHOLE. The assembler is the
  // one authority on whether the architecture's promise and the shipped suite
  // still agree; a summary of its verdict here would be a second answer to its
  // question, and the blocker ladder needs the specific drift, not "it did not
  // assemble".
  const assembled = assembleSuite(treeRoot, register.json, catalog.json);
  if (!assembled.ok) {
    return blocked(
      `the assembled suite is refused: the criteria register and the journey catalog have structurally drifted apart, and nothing runs until they agree`,
      {
        block_id: 'verification:suite-does-not-assemble',
        errors: assembled.errors,
        evidence: evidenceOf(register, catalog),
      }
    );
  }

  const suite = assembled.journeys;
  const suiteDigest = digestSuite(suite);
  const entries = runsIndexEntries(index);
  const current = entries.length === 0 ? null : entries[entries.length - 1];

  const startFresh = (reason) =>
    transition(TRANSITIONS.START_RUN, {
      run_id: nextRunId(treeRoot, entries),
      suite,
      suite_digest: suiteDigest,
      evidence: evidenceOf(register, catalog, index),
      reason,
    });

  if (current === null) {
    return startFresh(
      `the suite assembles to ${suite.length} journey${suite.length === 1 ? '' : 's'} and this tree has no run at all — a run has to be bound to the suite's digest before any journey executes`
    );
  }

  if (!isNonEmptyString(current.run_id) || !SAFE_ID_RE.test(current.run_id)) {
    return blocked(
      `the newest entry in ${RUNS_INDEX} names a run id ${JSON.stringify(current.run_id)} that is not one path segment of letters, digits, dot, dash or underscore — that id is a file name under ${RUNS_DIR} and half of every journey's gate id, and neither can carry it`,
      { block_id: 'verification:unsafe-run-id', evidence: evidenceOf(index) }
    );
  }

  const runId = current.run_id;
  const stream = runStream(treeRoot, runId);

  // An unreadable stream never becomes "these journeys have not run yet". The
  // verdict is the one operation that has a designed answer for it, and it fails
  // closed on every non-quarantined journey at once.
  if (stream.malformed) {
    return transition(TRANSITIONS.COMPUTE_SUITE_STATE, {
      run_id: runId,
      suite,
      suite_digest: suiteDigest,
      quarantine_ref: quarantine === null ? null : refOf(quarantine),
      run_stream: runStreamPath(runId),
      evidence: evidenceOf(register, catalog, index, quarantine, suiteState),
      reason: `run ${runId}'s own stream cannot be read whole — a malformed run stream is a verdict this phase already knows how to reach, and never a reason to run a journey again under the same run id`,
    });
  }

  const startRecord = stream.records.find((record) => isPlainObject(record) && record.kind === 'run-start') || null;

  // THE DRIFT ARM, AND WHY IT IS A NEW RUN RATHER THAN A RECOMPUTE. The verdict
  // binds a run to the digest that run started against; when the assembled suite
  // has moved since, the sanctioned recovery named by this phase's own flow is a
  // fresh run against the CURRENT suite, never a forced recompute against the
  // stale one. A missing run-start record is the same state arrived at from the
  // other side: a run bound to nothing at all.
  if (startRecord === null || startRecord.suite_digest !== suiteDigest) {
    return startFresh(
      startRecord === null
        ? `run ${runId} carries no run-start record, so it is bound to no suite at all — the pass this tree can honestly continue is a new one, bound to the suite as it is now`
        : `the suite assembled from disk digests ${suiteDigest}, and run ${runId} was started against ${startRecord.suite_digest} — the suite has drifted under the running pass, and a fresh run against the current suite is what this phase's own recovery names`
    );
  }

  const recorded = new Set(
    stream.records
      .filter((record) => isPlainObject(record) && record.kind === 'journey-result' && isNonEmptyString(record.journey_id))
      .map((record) => record.journey_id)
  );

  // The order is derived here and nowhere else, from the same two documents the
  // phase's own flow names: the previous verdict's failures first, then the
  // map's pending entries, then the rest. Owed-ness is scoped to THIS run's own
  // stream — a journey recorded under an earlier run id has not run under this
  // one, and treating it as done would compute a verdict over records that never
  // existed for this pass.
  const owed = orderRun(previousResults(suiteState), affected === null ? null : affected.json, suite).filter(
    (journey) => !recorded.has(journey.journey_id)
  );

  if (owed.length > 0) {
    const journey = owed[0];
    return transition(TRANSITIONS.RUN_JOURNEY, {
      run_id: runId,
      journey_id: journey.journey_id,
      criterion_id: journey.criterion_id,
      script_path: journey.script_path,
      harness: journey.harness,
      // The gate id the per-journey execute-and-record call derives for itself,
      // named here so the descriptor says which ledger record will evidence this
      // rung before it happens. It carries the run because a journey's second
      // pass under a later run must not collide with its first.
      gate_id: `journey-${journey.journey_id}-${runId}`,
      remaining: owed.length,
      record_ref: `run:${runId}:${startRecord.seq}`,
      evidence: evidenceOf(register, catalog, index, affected, suiteState),
      reason: `run ${runId} still owes ${owed.length} journey${owed.length === 1 ? '' : 's'}, and ${journey.journey_id} is the first of them in the failing-first order`,
    });
  }

  const verdict = suiteState !== null && isPlainObject(suiteState.json) ? suiteState.json : null;
  const compute = (reason) =>
    transition(TRANSITIONS.COMPUTE_SUITE_STATE, {
      run_id: runId,
      suite,
      suite_digest: suiteDigest,
      quarantine_ref: quarantine === null ? null : refOf(quarantine),
      run_stream: runStreamPath(runId),
      record_ref: `run:${runId}:${startRecord.seq}`,
      evidence: evidenceOf(register, catalog, index, quarantine, suiteState),
      reason,
    });

  if (verdict === null || verdict.run_id !== runId || verdict.suite_digest !== suiteDigest) {
    return compute(
      `every journey of run ${runId} is recorded and ${
        verdict === null ? `${SUITE_STATE} does not exist` : `${SUITE_STATE} still answers for run ${JSON.stringify(verdict.run_id)} against digest ${JSON.stringify(verdict.suite_digest)}`
      } — the run has no verdict of its own yet`
    );
  }

  if (verdict.status === 'green') {
    return blocked(
      `run ${runId}'s verdict is green, and what follows a durable green is not resolved by any rung here: the post-green lane (the discovery pass and the security scan, in parallel, neither gating) and this phase's own exit checks belong to a later chunk and are ABSENT from this tree — no rung here opens them, and none improvises one`,
      {
        block_id: `verification:post-green-absent:${runId}`,
        run_id: runId,
        evidence: evidenceOf(register, catalog, index, suiteState),
      }
    );
  }

  if (verdict.status === 'red') {
    return blocked(
      `run ${runId}'s verdict is red on ${Array.isArray(verdict.failing) ? verdict.failing.length : 0} journey${
        Array.isArray(verdict.failing) && verdict.failing.length === 1 ? '' : 's'
      }, and the red ladder is not resolved by any rung here: the single flake re-run, the quarantine decision it feeds, and the capped fix loop behind it belong to a later chunk and are ABSENT from this tree — no rung here reruns a failure, and none improvises a verdict about one`,
      {
        block_id: `verification:red-ladder-absent:${runId}`,
        run_id: runId,
        failing: Array.isArray(verdict.failing) ? verdict.failing.filter(isNonEmptyString) : [],
        reasons: isPlainObject(verdict.reasons) ? verdict.reasons : {},
        evidence: evidenceOf(register, catalog, index, suiteState),
      }
    );
  }

  // A verdict this walk has never heard of — `stale`, the marker a quarantine
  // mutation writes over a green snapshot, is the one that actually happens —
  // is not read as a shade of red and is not interpreted at all. The verdict is
  // computed again for the same run, which is this rung's own operation and the
  // only thing that turns a marker back into an answer: it writes green or red
  // and never `stale`, so the walk moves whatever the marker meant.
  return compute(
    `run ${runId}'s verdict on disk reads ${JSON.stringify(verdict.status)} rather than a computed one — a stale marker is not a verdict, and this rung recomputes rather than reading a meaning into it`
  );
}

module.exports = {
  nextTransition,
  TRANSITIONS,
  RETURNS,
};
