'use strict';

// spine.js — what happens next in the implementation phase, derived from disk
// and from nothing else.
//
// THE DIVISION THIS MODULE EXISTS TO MAKE. `workflows/implementation.js` runs
// one durable transition per invocation and holds no policy at all: it asks
// here what to do, does exactly that one thing, and returns. Every question
// with an answer worth arguing about — which milestone is active, whether a
// chunk may be sealed, whether a red gate blocks the next step — is decided
// here, where a test can build the tree state and read the answer without
// running an agent, a child process, or a workflow. If the script ever needs
// a branch, the branch belongs in this file.
//
// PURE OVER DISK. `nextTransition` reads canonical files and returns a
// descriptor. It writes nothing, spawns nothing, and remembers nothing: the
// same tree state gives the same answer in a fresh process, which is what
// makes "kill the session anywhere and re-run" a property rather than a hope.
// A run cache would be a second source of truth for facts the tree already
// holds, and the first crash would put the two out of step.
//
// A TRANSITION MUST LEAVE DURABLE EVIDENCE, OR IT IS NOT A TRANSITION. This
// is the disk-authority law biting rather than a preference, and it forces
// three shapes in this module that a reader might otherwise take for taste:
// the reviewer SELECTION is folded into the review transition (the family it
// chose is evidenced by the chunk-review record, so a separate invocation
// would leave nothing and be resolved forever), the chunk decomposition is
// promoted as DATA beside spec.md (prose cannot be asked which chunks exist),
// and the milestone review lands as a verdict ARTIFACT (there is no chunk
// record for a milestone-level review). In each case the alternative is a
// resolver that asks for the same work again on the next invocation.
//
// EVERY TRANSITION LEAVES EVIDENCE. The resolver never says "do X" twice for
// the same X: each transition's completion is a durable record or a canonical
// artifact that the next resolution reads, so progress is derived rather than
// counted. That is also why a step with no durable evidence of its own — the
// reviewer SELECTION, for instance — is not a transition here: the seat it
// chose is evidenced by the `chunk-review` record that carries the family, and
// an invocation that left nothing behind would be resolved again forever.
//
// ANONYMOUS PROMOTION, DELIBERATELY. `architecture-txn.js#promoteStaged` can
// attribute a promotion to a seated mind, and that attribution RATCHETS: once
// a marker carries one, every later promotion on that tree must carry one too.
// This slice seats no minds, so every promotion the spine makes is
// unattributed and the ratchet is never engaged. The first slice that seats a
// mind has to attribute every promotion from that point on, and this comment
// is where its author should learn that it is a one-way door.
//
// THE ARCHITECTURE IT READS. `architecture/milestones.json` at the tree root,
// which is where today's writers put it. Resolving the live revision through
// `architecture-txn.js#readCurrent` is the sanctioned read once the promoted
// layout goes live, and that cutover belongs to the slice that owns it — doing
// it here would make this module the first consumer of a layout nothing else
// reads yet.

const fs = require('node:fs');
const path = require('node:path');

const { readJson } = require('./atomic-json.js');
const { readRecords } = require('./stream.js');
const { SEAT_AGENTS } = require('./validators.js');
// Read-only, and that is why the resolver may call it: it answers "is there a
// lawful reviewer for this chunk" out of the same disk this module already
// reads, and writes nothing.
const { reviewerAvailability } = require('./family-evidence.js');

// The transition vocabulary, closed. A name that is not in here is not a
// thing the workflow can be asked to do.
const TRANSITIONS = Object.freeze({
  OPEN_MILESTONE: 'open-milestone',
  TOOLCHAIN_PREFLIGHT: 'toolchain-preflight',
  SPEC: 'spec',
  NEXT_CHUNK_BRIEF: 'next-chunk-brief',
  DISPATCH_IMPLEMENTER: 'dispatch-implementer',
  RECOVER_DISPATCH: 'recover-dispatch',
  RECORD_BUILT: 'record-built',
  REVIEW: 'review',
  REVISE: 'revise',
  CHUNK_GATE: 'chunk-gate',
  SEAL: 'seal',
  POST_SEAL: 'post-seal',
  MILESTONE_REVIEW: 'milestone-review',
  REGRESSION_FLOOR: 'regression-floor',
  CLOSE: 'close',
  PHASE_ADVANCE: 'phase-advance',
  APPLY_STEER: 'apply-steer',
  CONSULT: 'consult',
  OPERATOR_NEEDED: 'operator-needed',
  BLOCKED: 'blocked',
});

// A scope id becomes a path segment in three different modules — capsule.js
// builds a worktree directory out of it, promotion.js builds a staging and a
// canonical path, and the gate ids below join it with `:` and `/`. All three
// refuse anything else, but they refuse it three rungs into the build, after a
// spec and a brief have already been written. Refusing here is the same rule
// applied where it costs nothing, and it is also what makes every joined
// identity in this file injective: an id that cannot contain `/` or `:` cannot
// move a separator across a boundary.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// How many times a chunk may come back from review before the loop stops
// being progress. Owned by code rather than by a seat's judgment, so the
// count is the same in every run and visible to the operator when it is hit.
const REVISE_CAP = 3;

// What the workflow returns to the fire for each transition. `beat` is the
// ordinary "something happened, say a line, call again"; the others end the
// invocation differently.
const RETURNS = Object.freeze({
  BEAT: 'beat',
  PHASE_COMPLETE: 'phase_complete',
  OPERATOR_NEEDED: 'operator_needed',
  NEEDS_CONSULT: 'needs_consult',
  BLOCKED: 'blocked',
});

const GATE_KIND = 'gate';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireTreeRoot(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('spine: treeRoot must be a non-empty string');
  }
}

// ---------- the streams this resolver reads ----------

function ledgerPathOf(treeRoot) {
  return path.join(treeRoot, 'ledger.jsonl');
}

// A stream this module cannot fully parse is not a stream it will resolve
// from: deciding "that step never happened" out of a partial read is how a
// transition gets performed twice.
function readStreamOrThrow(file) {
  const { records, errors, headerViolations } = readRecords(file);
  if (errors.length > 0) {
    const detail = errors.map((e) => `line ${e.lineNo}: ${e.reason}`).join('; ');
    throw new Error(`spine: ${file} has malformed record(s) — refusing to resolve from a stream it cannot read: ${detail}`);
  }
  if (headerViolations.length > 0) {
    const detail = headerViolations.map((v) => `record[${v.index}]: ${v.errors.join(', ')}`).join('; ');
    throw new Error(
      `spine: ${file} has record(s) violating the common JSONL header — refusing to resolve from a stream it cannot read: ${detail}`
    );
  }
  return records;
}

function ledgerRecords(treeRoot) {
  return fs.existsSync(ledgerPathOf(treeRoot)) ? readStreamOrThrow(ledgerPathOf(treeRoot)) : [];
}

// The LAST gate record for a gate id is the one that counts: a gate re-run
// after remediation is the whole remediation story, and reading anything but
// the latest would keep a fixed tree blocked on a failure it has already
// answered.
function latestGate(records, gateId) {
  let latest = null;
  for (const record of records) {
    if (record.kind === GATE_KIND && record.gate_id === gateId) latest = record;
  }
  return latest;
}

function preflightGateId(milestoneId) {
  return `toolchain-preflight:${milestoneId}`;
}

function regressionGateId(milestoneId) {
  return `regression-floor:${milestoneId}`;
}

// THE COMPLETION HALF OF A TRANSITION THAT LEAVES NO LEDGER RECORD. Some
// transitions land their whole result as canonical files and a git commit —
// the post-seal repair, opening a milestone, closing one — and their durable
// record is a deterministic envelope rather than a ledger kind: the machine
// already has a record for "one unit of work, and what came of it", and
// inventing a kind for each of them would be complexity that has to earn
// itself.
//
// That makes each of them a PAIR — the transaction, then the envelope — with a
// crash point between the two, and the first live fire fell into exactly it:
// `open-milestone` committed and the session died before the envelope, so the
// milestone was open on disk with no completion record, this resolver answered
// the rung after it, and nothing was ever going to write one. So whether the
// transition is owed is derived from BOTH halves, for all three of them: the
// canonical result AND the envelope. Every one of these transactions answers a
// replay from what it already wrote, which is what makes re-resolving the same
// transition the whole repair — no reconciliation transition, no new receipt
// kind, and no second way to do one thing.
function envelopePath(treeRoot, envelopeId) {
  return path.join(treeRoot, 'envelopes', 'implementation', `${envelopeId}.json`);
}

function openEnvelopeId(milestoneId) {
  return `open.${milestoneId}`;
}

function closeEnvelopeId(milestoneId) {
  return `close.${milestoneId}`;
}

function postSealEnvelopeId(milestoneId, chunkId) {
  return `postseal.${milestoneId}.${chunkId}`;
}

function chunkGateId(milestoneId, chunkId) {
  return `chunk:${milestoneId}:${chunkId}`;
}

// ---------- dispatch attempts ----------

// WHY ATTEMPTS ARE COUNTED FROM DISPATCH RECEIPTS AND NOT FROM THE LIFECYCLE.
// `milestones.js` allows exactly one `chunk-start` per chunk — its precedence
// check requires the prior record to be `chunk-spec` — so the lifecycle has no
// way to say "this chunk was built twice". That is not an oversight: the
// chunk-start records the chunk's INTENT once, and C2's own reasoning about
// intended-versus-actual family describes several attempts underneath it (a
// Sol dispatch that failed, then a native rebuild). So the attempts live where
// they actually happened, on the ledger, and the resolver counts them there.
//
// The scope ref is what makes an attempt this chunk's rather than another's.
// It is carried on the dispatch's `prompt_ref`, joined with `/` — a separator
// no id can contain, because ids are checked as single path segments — so two
// chunks can never share a scope.
function buildScopeRef(milestoneId, chunkId) {
  return `implementation/build/${milestoneId}/${chunkId}`;
}

function seatScopeRef(transitionName, milestoneId, chunkId) {
  return chunkId === undefined || chunkId === null
    ? `implementation/${transitionName}/${milestoneId}`
    : `implementation/${transitionName}/${milestoneId}/${chunkId}`;
}

function dispatchRecords(records) {
  return records.filter((record) => record.kind === 'dispatch');
}

function terminalOf(records, dispatchId) {
  return records.find((record) => record.kind === 'dispatch-terminal' && record.dispatch_id === dispatchId) || null;
}

// The first dispatch this tree opened and never closed. A record like that is
// a predecessor that died mid-step, and until it has a terminal nothing about
// what did or did not happen is knowable — so it is answered before the ladder
// is consulted at all.
function unterminatedDispatch(records) {
  return dispatchRecords(records).find((record) => terminalOf(records, record.dispatch_id) === null) || null;
}

// The next dispatch id, derived from how many this tree has already opened.
// A spent id is still a dispatch record, so the count moves past it and the
// next id is always free — which is C1's "a relaunch is a NEW dispatch_id,
// never a reuse" satisfied by construction rather than by remembering to.
function nextDispatchId(records) {
  return `d${dispatchRecords(records).length + 1}`;
}

// Every try, and the ones that produced something. Both numbers are needed and
// they answer different questions: how many times this chunk has been sent out
// (which is what an attempt ORDINAL means, and a failed try is still a try),
// and how many times it came back with work (which is what decides whether
// there is anything to review).
function attemptsFor(records, scopeRef) {
  return dispatchRecords(records).filter((record) => record.prompt_ref === scopeRef);
}

function successfulAttempts(records, scopeRef) {
  return attemptsFor(records, scopeRef).filter((record) => {
    const terminal = terminalOf(records, record.dispatch_id);
    return terminal !== null && terminal.status === 'ok';
  });
}

// ---------- steering ----------

// The operator's steer, read at the START of every resolution. Pending is
// derived from the pair exactly as an open hold is — a steer-raise with no
// steer-apply — so nothing rewrites a status and a crash cannot lose the fact
// that a steer is owed. A steer pre-empts the ladder deliberately: it is the
// operator changing what should happen next, and applying it after one more
// transition would be applying it to a build that has already moved.
function pendingSteer(records) {
  const applied = new Set(
    records.filter((record) => record.kind === 'steer-apply').map((record) => record.steer_id)
  );
  return (
    records.find((record) => record.kind === 'steer-raise' && !applied.has(record.steer_id)) || null
  );
}

// A steer's exit, decided rather than left open. `applied` and `operator` are
// the whole vocabulary, and the honest line between them is what this phase is
// able to act on: a steer aimed at the milestone being built right now changes
// what the next transition does, so it can be applied here; a steer aimed at a
// milestone that is finished, not started, or not in the architecture at all
// cannot be acted on by this phase whatever it says, and belongs to the
// operator. The rule reads only disk, so the same steer resolves the same way
// in any process.
function steerExit(scope, activeMilestoneId) {
  if (scope === 'implementation') return 'applied';
  if (activeMilestoneId !== null && scope === `milestones/${activeMilestoneId}`) return 'applied';
  return 'operator';
}

// ---------- consults ----------

// A worker's question, and whether it has been answered. Pending is DERIVED
// from the pair — a staged request with no canonical answer beside it — the
// same way an open hold and an unanswered steer are, so nothing rewrites a
// status and a crash cannot lose the fact that an answer is owed.
function consultRequestsDir(treeRoot, milestoneId) {
  return path.join(treeRoot, 'staging', 'consult-request', milestoneId);
}

function pendingConsult(treeRoot, milestoneId) {
  const dir = consultRequestsDir(treeRoot, milestoneId);
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const request = readJson(path.join(dir, name), null);
    if (!isPlainObject(request) || !isNonEmptyString(request.consult_id)) continue;
    const answered = path.join(treeRoot, 'milestones', milestoneId, 'consults', `${request.consult_id}.json`);
    if (!fs.existsSync(answered)) return request;
  }
  return null;
}

// ---------- the architecture and the index ----------

function plannedMilestones(treeRoot) {
  const planned = readJson(path.join(treeRoot, 'architecture', 'milestones.json'), null);
  if (!isPlainObject(planned) || !Array.isArray(planned.milestones)) return [];
  return planned.milestones
    .filter((entry) => isPlainObject(entry) && isNonEmptyString(entry.id))
    .slice()
    .sort((a, b) => {
      const left = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
      return left === right ? String(a.id).localeCompare(String(b.id)) : left - right;
    });
}

function indexEntries(treeRoot) {
  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'), null);
  if (!isPlainObject(index) || !Array.isArray(index.milestones)) return [];
  return index.milestones.filter(isPlainObject);
}

// ---------- the milestone's own state ----------

function chunksPathOf(treeRoot, milestoneId) {
  return path.join(treeRoot, 'milestones', milestoneId, 'chunks.jsonl');
}

function chunkRecords(treeRoot, milestoneId) {
  const file = chunksPathOf(treeRoot, milestoneId);
  return fs.existsSync(file) ? readStreamOrThrow(file) : [];
}

// The chunk decomposition, as data. `spec.md` is prose for the seats that
// read it; this is the same decision in the form the machine can act on, and
// the spec transition promotes both. Without it there is no disk answer to
// "is there another chunk after this one", and the resolver would be
// inferring the shape of the milestone from the records it happens to find —
// which cannot tell an unstarted chunk from a chunk nobody planned.
function plannedChunkEntries(treeRoot, milestoneId) {
  const plan = readJson(path.join(treeRoot, 'milestones', milestoneId, 'chunk-plan.json'), null);
  if (!isPlainObject(plan) || !Array.isArray(plan.chunks)) return null;
  return plan.chunks.filter((entry) => isPlainObject(entry) && isNonEmptyString(entry.id));
}

function plannedChunks(treeRoot, milestoneId) {
  const entries = plannedChunkEntries(treeRoot, milestoneId);
  return entries === null ? null : entries.map((entry) => entry.id);
}

// The journey a chunk's plan entry nominated, or null. Read here rather than by
// the workflow for the same reason every other fact is: the script holds no
// policy, and "does this chunk owe the catalog an entry" is a question about
// disk that a test can ask without running anything.
function nominatedJourney(treeRoot, milestoneId, chunkId) {
  const entries = plannedChunkEntries(treeRoot, milestoneId);
  if (entries === null) return null;
  const entry = entries.find((candidate) => candidate.id === chunkId);
  return entry !== undefined && isPlainObject(entry.journey) ? entry.journey : null;
}

// The last STRICT lifecycle record for a chunk. The designer's side-channel
// kinds (consult, journeys) are deliberately not read here: milestones.js
// keeps them out of its own precedence check for the same reason, and a
// consult answer arriving mid-review must not read as progress through the
// lifecycle.
const LIFECYCLE_KINDS = ['chunk-spec', 'chunk-start', 'chunk-built', 'chunk-review', 'chunk-green'];

function latestLifecycle(records, chunkId) {
  let latest = null;
  for (const record of records) {
    if (record.chunk_id === chunkId && LIFECYCLE_KINDS.includes(record.kind)) latest = record;
  }
  return latest;
}

function countOfKind(records, chunkId, kind) {
  return records.filter((record) => record.chunk_id === chunkId && record.kind === kind).length;
}

// ---------- descriptors ----------

function transition(name, fields = {}) {
  return Object.assign({ transition: name, return: RETURNS.BEAT }, fields);
}

function blocked(reason, fields = {}) {
  return Object.assign({ transition: TRANSITIONS.BLOCKED, return: RETURNS.BLOCKED, reason }, fields);
}

// The open transition, built from the architecture's own entry. Two rungs
// return it and they return the SAME descriptor: a milestone the index does not
// carry yet, and one whose transaction committed without its envelope.
// `openMilestoneTxn` answers a replay from the index entry it already wrote, so
// the second is the first re-run, and only the reason differs.
function openMilestone(milestone, reason) {
  return transition(TRANSITIONS.OPEN_MILESTONE, {
    milestone_id: milestone.id,
    // The architecture's own description, carried through. Dropping it is
    // how a milestone reached the chunk ladder with no toolchain profile and
    // bypassed its preflight entirely.
    envelope_id: openEnvelopeId(milestone.id),
    title: isNonEmptyString(milestone.title) ? milestone.title : milestone.id,
    designer_family: milestone.designer_family,
    toolchain_profile: milestone.toolchain_profile === undefined ? null : milestone.toolchain_profile,
    reason,
  });
}

// ---------- nextTransition ----------

// nextTransition(treeRoot) — the one question this module answers: given what
// is on disk right now, what is the single next thing to do?
//
// The order below is the ladder, and it is deliberately read top to bottom:
// a milestone must exist before it can preflight, preflight must be green
// before anything is specified, and so on. Each rung asks only about durable
// state, so the same tree resolves to the same rung however many times it is
// asked and whichever process asks.
function nextTransition(treeRoot) {
  requireTreeRoot(treeRoot);

  const records = ledgerRecords(treeRoot);
  const planned = plannedMilestones(treeRoot);
  const index = indexEntries(treeRoot);
  const statusOf = (id) => {
    const entry = index.find((candidate) => candidate.id === id);
    return entry === undefined ? null : entry.status;
  };
  const active = planned.find((milestone) => statusOf(milestone.id) !== 'green');
  const activeId = active === undefined ? null : active.id;

  // The steer is read first and pre-empts the ladder, deliberately: it is the
  // operator changing what should happen next, and applying it one transition
  // later would be applying it to a build that has already moved.
  const steer = pendingSteer(records);
  if (steer !== null) {
    const exit = steerExit(steer.scope, activeId);
    return Object.assign(
      transition(TRANSITIONS.APPLY_STEER, {
        steer_id: steer.steer_id,
        scope: steer.scope,
        instruction: steer.instruction,
        exit,
        record_ref: `ledger:${steer.seq}`,
        reason:
          exit === 'applied'
            ? `the operator steered ${steer.scope}, which is what this phase is building now`
            : `the operator steered ${steer.scope}, which this phase is not building — what happens to it is the operator's call`,
      }),
      { return: exit === 'applied' ? RETURNS.BEAT : RETURNS.OPERATOR_NEEDED }
    );
  }

  // A dispatch with no terminal is a predecessor that died mid-step. Nothing
  // downstream of it can be reasoned about honestly — whether the step ran is
  // exactly what is unknown — so the record is settled before the ladder is
  // consulted. C1's recovery is idempotent and answers every open dispatch in
  // the tree at once, so this rung is reached at most once per crash.
  const open = unterminatedDispatch(records);
  if (open !== null) {
    return transition(TRANSITIONS.RECOVER_DISPATCH, {
      dispatch_id: open.dispatch_id,
      record_ref: `ledger:${open.seq}`,
      reason: `dispatch ${open.dispatch_id} was opened and never closed — its outcome has to be settled before anything else is decided`,
    });
  }

  if (planned.length === 0) {
    return blocked(
      'the architecture names no milestones — there is nothing for the implementation phase to build',
      { block_id: 'implementation:no-milestones' }
    );
  }

  for (const milestone of planned) {
    if (!SAFE_ID_RE.test(String(milestone.id))) {
      return blocked(
        `the architecture names a milestone id ${JSON.stringify(milestone.id)} that is not one path segment of letters, digits, dot, dash or underscore — this id becomes a worktree directory, a staging path and a gate id, and none of them can carry it`,
        { block_id: `implementation:unsafe-milestone-id:${String(milestone.id)}` }
      );
    }
  }

  // A CLOSE THAT TORE. The green index entry is the close transaction's own
  // receipt; the envelope is the transition's completion record. Asked here —
  // ahead of the active milestone's ladder and ahead of the phase advance —
  // because both of those walk past a green milestone, and a milestone the
  // ladder has walked past is one nothing will ever come back to.
  for (const milestone of planned) {
    const entry = index.find((candidate) => candidate.id === milestone.id);
    if (!isPlainObject(entry) || entry.status !== 'green') continue;
    if (fs.existsSync(envelopePath(treeRoot, closeEnvelopeId(milestone.id)))) continue;
    return transition(TRANSITIONS.CLOSE, {
      milestone_id: milestone.id,
      envelope_id: closeEnvelopeId(milestone.id),
      // FROM THE GREEN ENTRY, NOT FROM `review.json`. The entry is where the
      // close durably bound the evidence it closed under, and
      // `closeMilestoneTxn` compares a re-call's evidence against exactly that
      // — a replay citing the review artifact instead would fail closed the
      // moment the artifact and the entry disagreed, which is the one case
      // this rung exists to survive.
      review_evidence: entry.review_evidence,
      reason: `milestone ${milestone.id} is closed on disk and has no close envelope — the transition tore between its transaction and its record`,
    });
  }

  if (active === undefined) {
    return Object.assign(
      transition(TRANSITIONS.PHASE_ADVANCE, {
        reason: 'every milestone the architecture planned is green',
      }),
      { return: RETURNS.PHASE_COMPLETE }
    );
  }

  if (statusOf(active.id) === null) {
    return openMilestone(active, `milestone ${active.id} is next in the architecture and has not been opened`);
  }

  // AN OPEN THAT TORE — the same question at the other end of the milestone's
  // life, and the one the first live fire actually hit.
  if (!fs.existsSync(envelopePath(treeRoot, openEnvelopeId(active.id)))) {
    return openMilestone(
      active,
      `milestone ${active.id} is open on disk and has no open envelope — the transition tore between its transaction and its record`
    );
  }

  const indexEntry = index.find((candidate) => candidate.id === active.id);
  const profileId = isPlainObject(indexEntry) ? indexEntry.toolchain_profile : null;

  // `toolchain_profile: null` is LAWFUL — `milestones.js` defines it as "this
  // milestone needs nothing beyond what is already installed", and a resolver
  // that turned a lawful value into a permanent blocker would be redefining
  // the milestone boundary from underneath it. So nothing is refused here.
  // What is true is that a null-profile milestone has no suite command this
  // machine can name, and that becomes a problem only at a rung that needs
  // one — the chunk gate and the regression floor, where it blocks citing
  // exactly what it needs. The wall goes where the wall actually is.
  if (!isNonEmptyString(profileId)) {
    const chunks = plannedChunks(treeRoot, active.id);
    return chunks === null
      ? transition(TRANSITIONS.SPEC, {
          milestone_id: active.id,
          dispatch_id: nextDispatchId(records),
          scope_ref: seatScopeRef('spec', active.id),
          task_class: 'review',
          reason: `milestone ${active.id} is open, needs no toolchain, and has no chunk decomposition on disk`,
        })
      : chunkLadder(treeRoot, active.id, chunks, records, null, active.designer_family);
  }

  const preflight = latestGate(records, preflightGateId(active.id));
  if (preflight === null) {
    return transition(TRANSITIONS.TOOLCHAIN_PREFLIGHT, {
      milestone_id: active.id,
      profile_id: profileId,
      gate_id: preflightGateId(active.id),
      reason: `milestone ${active.id} declares the "${profileId}" toolchain and has no preflight gate on record`,
    });
  }
  if (preflight.exit_code !== 0) {
    return blocked(
      `the toolchain preflight for milestone ${active.id} last exited ${preflight.exit_code} — nothing after it is reachable until a green preflight gate is on record`,
      { milestone_id: active.id, record_ref: `ledger:${preflight.seq}` }
    );
  }

  // A worker is waiting on an answer. Nothing else it was doing can proceed,
  // so the question is answered before the ladder resumes.
  const consult = pendingConsult(treeRoot, active.id);
  if (consult !== null) {
    return Object.assign(
      transition(TRANSITIONS.CONSULT, {
        milestone_id: active.id,
        chunk_id: consult.chunk_id,
        consult_id: consult.consult_id,
        asker: consult.asker,
        question: consult.question,
        dispatch_id: nextDispatchId(records),
        scope_ref: seatScopeRef('consult', active.id, consult.consult_id),
        task_class: 'mind_consult',
        reason: `consult ${consult.consult_id} on milestone ${active.id} has been asked and not answered`,
      }),
      { return: RETURNS.NEEDS_CONSULT }
    );
  }

  const chunks = plannedChunks(treeRoot, active.id);
  if (chunks === null) {
    return transition(TRANSITIONS.SPEC, {
      milestone_id: active.id,
      dispatch_id: nextDispatchId(records),
      scope_ref: seatScopeRef('spec', active.id),
      task_class: 'review',
      reason: `milestone ${active.id} is open and has no chunk decomposition on disk`,
    });
  }

  return chunkLadder(treeRoot, active.id, chunks, records, profileId, active.designer_family);
}

// The per-chunk rungs, in the order a chunk actually travels. The FIRST chunk
// that is not green decides the whole answer: chunks are sequential within a
// milestone, so a later chunk's state can never be the next thing to do.
function chunkLadder(treeRoot, milestoneId, planned, ledger, profileId, designerFamily) {
  const records = chunkRecords(treeRoot, milestoneId);

  for (const chunkId of planned) {
    if (!SAFE_ID_RE.test(String(chunkId))) {
      return blocked(
        `milestone ${milestoneId} plans a chunk id ${JSON.stringify(chunkId)} that is not one path segment of letters, digits, dot, dash or underscore — this id becomes a worktree directory, a staging path and a gate id`,
        { milestone_id: milestoneId, block_id: `implementation:unsafe-chunk-id:${milestoneId}:${String(chunkId)}` }
      );
    }
    const latest = latestLifecycle(records, chunkId);
    const at = (name, fields = {}) =>
      transition(name, Object.assign({ milestone_id: milestoneId, chunk_id: chunkId }, fields));

    if (latest === null) {
      return at(TRANSITIONS.NEXT_CHUNK_BRIEF, {
        dispatch_id: nextDispatchId(ledger),
        scope_ref: seatScopeRef('brief', milestoneId, chunkId),
        task_class: 'review',
        reason: `chunk ${chunkId} is planned and has no brief yet`,
      });
    }

    const implementerFamily = designerFamily === 'claude' ? 'claude' : 'gpt';
    const implementerSeat = SEAT_AGENTS.implementer[implementerFamily];
    const reviews = countOfKind(records, chunkId, 'chunk-review');
    const scopeRef = buildScopeRef(milestoneId, chunkId);
    const tries = attemptsFor(ledger, scopeRef);
    const attempts = successfulAttempts(ledger, scopeRef);

    // ONE RULE ANSWERS BOTH THE FIRST BUILD AND EVERY REVISE. A chunk is
    // ready to be looked at when it has more successful attempts than
    // reviews; short of that, an implementer has to run. That is what lets
    // the revise loop work at all: a revise cannot write another
    // `chunk-start` (the lifecycle allows exactly one), so its own durable
    // evidence is the attempt it dispatches, and the lifecycle pointer
    // legitimately stays on the revising review until a new one lands.
    const owed = reviews + 1;
    const build = (name, needsChunkStart) =>
      at(name, {
        attempt: tries.length + 1,
        dispatch_id: nextDispatchId(ledger),
        scope_ref: scopeRef,
        task_class: 'chunk_implementation',
        // THE SEAT COMES FROM THE ROUTING LAW, not from what was convenient
        // to attest. Sol implements ordinary chunks and Opus owns UI/creative
        // work, and `architecture/milestones.json` marks which a milestone is
        // through its `designer_family`. Routing every chunk to Opus to dodge
        // the attestation problem deleted that law from the decision; the
        // attestation problem is solved where it lives instead, by the
        // `sol-hosted` builder a Sol-hosting seat's dispatch now attests.
        implementer_seat: implementerSeat,
        implementer_family: implementerFamily,
        needs_chunk_start: needsChunkStart,
        // The review being answered. A revise dispatched without it is a fresh
        // attempt wearing a revise's name. The session that BUILT what the
        // review rejected is deliberately not carried: an attempt runs in a
        // session of its own, and a resumed one would attest the same hosted
        // session id on two dispatch terminals.
        //
        // SPREAD RATHER THAN SET-TO-UNDEFINED. A key whose value is `undefined`
        // survives an in-process comparison and vanishes through JSON, so a
        // descriptor carrying one answers differently in a fresh process than
        // in this one — which is the exact property this resolver exists to
        // have. The re-entrancy test caught it.
        ...(name === TRANSITIONS.REVISE && latest.kind === 'chunk-review'
          ? { review_ref: latest.review.ref }
          : {}),
        reason:
          name === TRANSITIONS.REVISE
            ? `chunk ${chunkId}'s review asked for changes, and no attempt has answered it yet`
            : `chunk ${chunkId} has a brief and no successful build behind it`,
      });

    switch (latest.kind) {
      case 'chunk-spec':
        return build(TRANSITIONS.DISPATCH_IMPLEMENTER, true);
      case 'chunk-start':
        if (attempts.length < owed) return build(TRANSITIONS.DISPATCH_IMPLEMENTER, false);
        return at(TRANSITIONS.RECORD_BUILT, {
          // The attempt the build is recorded FROM. Without it `recordBuilt`
          // has no receipt to verify the claim against and cannot succeed —
          // which is exactly what a bare `chunk-start` advancing straight to
          // this rung used to produce.
          dispatch_id: attempts[attempts.length - 1].dispatch_id,
          reason: `chunk ${chunkId} was built and the build is not recorded`,
        });
      case 'chunk-built': {
        // ASKED BEFORE A REVIEWER IS PAID FOR. When only one family is
        // reachable and this chunk was built by it, there is no lawful
        // reviewer: a same-family review is the one pairing the seal refuses,
        // so seating one would buy a review the chunk could never be sealed
        // under. The stop is declared here instead, and the descriptor carries
        // the route the caller records — no operator decision is pending, only
        // a capability that is not there, which is what `blocked` means.
        const availability = reviewerAvailability(treeRoot, milestoneId, chunkId);
        if (availability.available !== true) {
          return blocked(availability.route.reason, {
            milestone_id: milestoneId,
            chunk_id: chunkId,
            block_id: `implementation:no-cross-family-reviewer:${milestoneId}:${chunkId}`,
            degraded_route: availability.route,
          });
        }
        return at(TRANSITIONS.REVIEW, {
          dispatch_id: nextDispatchId(ledger),
          scope_ref: seatScopeRef('review', milestoneId, chunkId),
          task_class: 'review',
          review_round: `r${reviews + 1}`,
          reason: `chunk ${chunkId} is built and unreviewed`,
        });
      }
      case 'chunk-review': {
        if (latest.review.verdict === 'approve') {
          const gate = latestGate(ledger, chunkGateId(milestoneId, chunkId));
          if (profileId === null) {
            return blocked(
              `chunk ${chunkId} of milestone ${milestoneId} passed review and needs its suite run before it can seal, but the milestone declares no toolchain profile — this machine has no way to name the command. Give the milestone a toolchain profile, or seal it by a route that does not need one.`,
              {
                milestone_id: milestoneId,
                chunk_id: chunkId,
                block_id: `implementation:no-suite-command:${milestoneId}:${chunkId}`,
              }
            );
          }
          if (gate === null) {
            return at(TRANSITIONS.CHUNK_GATE, {
              gate_id: chunkGateId(milestoneId, chunkId),
              profile_id: profileId,
              reason: `chunk ${chunkId} passed review and has no gate on record — a chunk cannot seal without evidence its suite passed`,
            });
          }
          if (gate.exit_code !== 0) {
            return blocked(
              `the gate for chunk ${chunkId} of milestone ${milestoneId} last exited ${gate.exit_code} — an approved chunk that does not pass its own suite does not seal`,
              { milestone_id: milestoneId, chunk_id: chunkId, record_ref: `ledger:${gate.seq}` }
            );
          }
          return at(TRANSITIONS.SEAL, {
            // Everything `sealChunk` requires, derived rather than invented:
            // the review it acted on is the chunk's own latest, and the gate
            // is the record that just went green. The staged diff digest is
            // deliberately NOT here — it is a fact about a git index this
            // resolver never touches, so the workflow asks the machine for it
            // at seal time rather than citing one that a revise has since
            // made stale.
            review_ref: latest.review.ref,
            review_family: latest.review.family,
            gate_ref: `ledger:${gate.seq}`,
            gate_id: gate.gate_id,
            reason: `chunk ${chunkId} passed review, its gate is green, and it is not sealed`,
          });
        }
        if (reviews >= REVISE_CAP) {
          return Object.assign(
            at(TRANSITIONS.OPERATOR_NEEDED, {
              block_id: `implementation:revise-cap:${milestoneId}:${chunkId}`,
              reason: `chunk ${chunkId} has come back from review ${reviews} times, which is the cap — the loop is not converging and the operator decides what happens next`,
            }),
            { return: RETURNS.OPERATOR_NEEDED }
          );
        }
        if (attempts.length < owed) return build(TRANSITIONS.REVISE, false);
        return at(TRANSITIONS.REVIEW, {
          dispatch_id: nextDispatchId(ledger),
          scope_ref: seatScopeRef('review', milestoneId, chunkId),
          task_class: 'review',
          review_round: `r${reviews + 1}`,
          reason: `chunk ${chunkId}'s revise attempt landed and has not been reviewed`,
        });
      }
      case 'chunk-green': {
        // The seal commits from the index, which leaves the working tree one
        // revision behind HEAD and the capsule still open. Both are repaired
        // by their own rung, and whether that rung is owed is derived from the
        // pair — the green record, and the envelope the repair writes — so a
        // crash between them is visible rather than skipped forever.
        if (!fs.existsSync(envelopePath(treeRoot, postSealEnvelopeId(milestoneId, chunkId)))) {
          // The journey this chunk's plan nominated, carried to the rung that
          // records it. The catalog entry waits for the seal deliberately: the
          // script is authored inside the capsule and reviewed with the chunk,
          // so until the seal commits it there is nothing trustworthy to
          // catalogue — and a catalogued journey whose chunk was later revised
          // away would be a suite entry nobody approved.
          const journey = nominatedJourney(treeRoot, milestoneId, chunkId);
          return at(TRANSITIONS.POST_SEAL, {
            envelope_id: postSealEnvelopeId(milestoneId, chunkId),
            ...(journey === null ? {} : { journey }),
            reason: `chunk ${chunkId} is sealed and its worktree and capsule have not been settled`,
          });
        }
        continue;
      }
      default:
        return blocked(
          `chunk ${chunkId} of milestone ${milestoneId} is at "${latest.kind}", which is not a lifecycle state this resolver knows`,
          { milestone_id: milestoneId, chunk_id: chunkId, block_id: `implementation:unknown-lifecycle:${milestoneId}:${chunkId}` }
        );
    }
  }

  return closeLadder(treeRoot, milestoneId, ledger, profileId);
}

// Every chunk is green; what remains is the milestone's own gate sequence.
// Review first, because a slice that does not compose to its goal should not
// spend a full regression run; then the floor, because a green slice that
// breaks the project is not closeable; then the close transaction.
function closeLadder(treeRoot, milestoneId, ledger, profileId) {
  const review = readJson(path.join(treeRoot, 'milestones', milestoneId, 'review.json'), null);
  if (!isPlainObject(review) || !isNonEmptyString(review.verdict)) {
    return transition(TRANSITIONS.MILESTONE_REVIEW, {
      milestone_id: milestoneId,
      dispatch_id: nextDispatchId(ledger),
      scope_ref: seatScopeRef('milestone-review', milestoneId),
      task_class: 'review',
      reason: `every planned chunk of milestone ${milestoneId} is green and the slice has not been reviewed as a whole`,
    });
  }
  if (review.verdict !== 'approve') {
    return Object.assign(
      transition(TRANSITIONS.OPERATOR_NEEDED, {
        milestone_id: milestoneId,
        block_id: `implementation:milestone-revise:${milestoneId}`,
        reason: `the review of milestone ${milestoneId} asked for changes to a slice whose chunks are all sealed — what happens to a sealed slice is the operator's call, not this resolver's`,
      }),
      { return: RETURNS.OPERATOR_NEEDED }
    );
  }

  if (profileId === null) {
    return blocked(
      `milestone ${milestoneId} is reviewed and needs its regression floor run before it can close, but it declares no toolchain profile — this machine has no way to name the suite command.`,
      { milestone_id: milestoneId, block_id: `implementation:no-suite-command:${milestoneId}` }
    );
  }
  const gate = latestGate(ledger, regressionGateId(milestoneId));
  if (gate === null) {
    return transition(TRANSITIONS.REGRESSION_FLOOR, {
      milestone_id: milestoneId,
      gate_id: regressionGateId(milestoneId),
      // The floor runs the TARGET PROJECT's own full suite, and which command
      // that is comes from the milestone's toolchain profile. Naming the
      // profile rather than a command keeps this resolver disk-pure: composing
      // the command has to probe the project for its package manager, which is
      // a machine call, not a read.
      profile_id: profileId,
      reason: `milestone ${milestoneId} is reviewed and has no regression floor on record`,
    });
  }
  if (gate.exit_code !== 0) {
    return blocked(
      `the regression floor for milestone ${milestoneId} last exited ${gate.exit_code} — a slice that breaks the project does not close`,
      { milestone_id: milestoneId, record_ref: `ledger:${gate.seq}` }
    );
  }

  return transition(TRANSITIONS.CLOSE, {
    milestone_id: milestoneId,
    envelope_id: `close.${milestoneId}`,
    review_evidence: review.evidence,
    reason: `milestone ${milestoneId} is reviewed, its floor is green, and it is not closed`,
  });
}

module.exports = {
  nextTransition,
  TRANSITIONS,
  RETURNS,
  REVISE_CAP,
};
