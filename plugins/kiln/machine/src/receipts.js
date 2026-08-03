'use strict';

// receipts.js — the sole sanctioned writer of the eight realignment record
// kinds, all of them on `<treeRoot>/ledger.jsonl`, plus the envelope files
// the workflows persist beside them:
//
//   dispatch          — a unit was sent out, written BEFORE any outcome
//   dispatch-terminal — that same unit's one and only outcome, carrying the
//                       evidence of what built it and what it produced when
//                       that outcome was a success
//   workflow-return   — a workflow handed control back, citing a durable record
//   hold-open         — a blocker was raised
//   hold-resolve      — that same hold's one and only exit
//   degraded-route    — a capability was substituted mid-build
//   mind-open         — a mind was seated over a scope, at a generation
//   mind-retire       — that same generation's one and only exit
//   steer-raise       — the operator steered the build mid-flight
//   steer-apply       — that same steer's one and only exit
//
// Pending vs terminal is derivable from the dispatch/terminal pair alone (a
// dispatch with no terminal is pending), and open vs resolved from the
// hold-open/hold-resolve pair — no status field anywhere is ever updated in
// place, because nothing in this tree rewrites a stream. A mind's live
// generation is derivable the same way, from the open/retire pair.
//
// REF GRAMMAR. A record is cited by exactly one of two forms, and
// `resolveRef` is their single decoder:
//   ledger:<seq>                     — one record on <treeRoot>/ledger.jsonl,
//                                      by the seq stream.js allocated for it
//   envelope:<phase>/<dispatch_id>   — one envelope file at
//                                      <treeRoot>/envelopes/<phase>/<dispatch_id>.json
// Every writer returns `{ref, record}` (or `{ref, envelope}`) so a caller
// that must cite what it just wrote never re-derives this grammar.
//
// THE RE-ENTRY LAW. Every writer here takes caller identity plus the full
// payload and distinguishes an identical replay from a conflicting duplicate:
// when a record of the same kind already carries the same identity, an
// identical payload RETURNS THAT RECORD as the receipt (idempotent success,
// so a crash between the append and the return reaches the same next
// transition on re-entry), and a differing payload fails closed. Identities:
// dispatch/dispatch-terminal = dispatch_id, hold-open/hold-resolve = hold_id,
// steer-raise/steer-apply = steer_id, degraded-route = route_id,
// workflow-return = (workflow, run_ref),
// mind-open/mind-retire = (mind, scope, generation), envelope = (phase,
// dispatch_id). A hold_id is therefore single-use for the lifetime of the
// tree, live or resolved; a genuine recurrence is a NEW hold_id whose
// origin_ref cites the prior hold.
//
// A MIND IS THE PAIR, NEVER THE NAME. `mind` alone does not identify anything
// on this ledger: the same mind name is seated over several scopes and each
// seating counts its own generations, so an identity built from the name
// without its scope would collide two independent minds into one. Both the
// re-entry identity and the correlation_id are therefore built from the pair.
//
// GENERATIONS DO NOT SKIP, AND ONLY ONE IS LIVE. Generation 1 opens freely;
// generation N > 1 opens only once generation N-1 has been opened AND
// retired. Those two conditions are the whole guard: they make a second seat
// at a live generation a refusal (the duplicate-launch case), a jump past an
// unopened generation a refusal, and "which generation is live" a question
// answered from the stream rather than from anyone's memory.
//
// A SUPERSEDE IS TWO RECORDS UNDER ONE LOCK HOLD, AND THE TWO HALVES OF THAT
// SENTENCE ARE DOING DIFFERENT WORK. `supersedeMind` retires generation N and
// opens N+1 without releasing the lifecycle lock in between, because between
// those two records the seat is EMPTY, and an empty seat is exactly when a
// second launch looks lawful to anyone else writing. Two standalone writers
// each take and release the lock, so another writer can land in that gap with
// no crash involved at all. One hold removes the gap for as long as this
// process lives, and `writeMindRetire` refuses the "supersede" reason
// outright so the atomic path is the only path — a handover cannot be
// assembled from halves that do not exist separately.
//
// What one hold does NOT do is make the two appends one write. A kill between
// them leaves the retire durable and the open missing, and no lock has ever
// survived a kill. That state is finished by RE-ENTRY: the retire replays
// onto its own receipt and the ladder leaves exactly one lawful next move.
// The lock buys exclusion while the process lives; re-entry buys completion
// after it dies. Both are load-bearing and neither substitutes for the other.
//
// A close and a timeout stay writable on their own, because they END a seat
// rather than hand it over — nothing is owed after them, so there is no gap
// to hold shut. The reason is a description of why a seat ended, never a
// precondition on the next open: a mind retired with "close" or "timeout" can
// be seated again at N+1 exactly the same way.
//
// The read-check-append sequence runs under jsonl.js's own single-writer
// lockfile, taken on this module's own path rather than on ledger.jsonl:
// stream.appendRecord already takes the ledger's lock to allocate seq, and a
// second, outer lock on the same file would deadlock against it. These eight
// kinds have exactly one writer — this module — so a module-scoped lock
// serializes every identity check that matters. The generation guard is
// checked under that same lock, which is what makes "is this generation
// live?" and "append this open" one indivisible step for concurrent writers.

const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const { withLock } = require('./jsonl.js');
const { appendRecord, readRecords } = require('./stream.js');
const { writeAtomic, readJson } = require('./atomic-json.js');
const { validateEnvelope } = require('./validators.js');

const LEDGER_FILENAME = 'ledger.jsonl';
const ENVELOPES_DIRNAME = 'envelopes';
// withLock(file) creates and removes `<file>.lock`; the base path itself is
// never written, so this names a lock, not a file in the tree.
const RECEIPTS_LOCK_BASE = 'receipts';

// A dispatch_id names its own envelope file and a phase names that file's
// directory, so those two — and only those two — must survive as path
// segments. The ledger-only identities (hold_id, route_id) are never used to
// build a path or a ref, so they carry no syntax rule beyond being a
// non-empty string: their contract is caller-supplied uniqueness, not shape.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const LEDGER_REF_RE = /^ledger:(0|[1-9]\d*)$/;
const ENVELOPE_REF_RE = /^envelope:([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const REF_GRAMMAR = '"ledger:<seq>" or "envelope:<phase>/<dispatch_id>"';

const TRANSPORTS = ['native', 'codex'];
const TERMINAL_STATUSES = ['ok', 'failed'];
// A digest is a digest. The same form implementation.js signs a commit with,
// checked here so a terminal cannot attest a result with a sentence.
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
// What a SUCCESSFUL terminal must prove about its own result: which concrete
// model produced it, and what the artifact it produced actually contained. On
// the record rather than in a caller's return value, because a crash between
// this terminal and whatever consumes it would otherwise lose the evidence for
// good — and because a digest recomputed later reads whatever the file says
// NOW, so an artifact rewritten under the same result_ref would pass for a
// replay instead of failing as the conflict it is.
const RESULT_EVIDENCE_FIELDS = ['model_id', 'result_digest'];
// The one reason with a status of its own attached to it by law.
const TIMEOUT_REASON = 'timeout';
// Evidence, never intent: who actually built it. A timeout is not a status of
// its own — it is `status: "failed", reason: "timeout"`.
// `sol-hosted` is the word the vocabulary was missing: a NATIVE dispatch whose
// seat ran Sol through the Codex CLI inside itself. Its lawful transport is
// native (the machine spawned an Agent step, not a codex child) and its family
// is gpt (that is who did the work), so every existing law reads it correctly
// without being changed.
const BUILDERS = ['sol', 'sol-hosted', 'claude-fallback', null];
const WORKFLOW_RETURNS = ['beat', 'phase_complete', 'operator_needed', 'needs_consult', 'blocked'];
const HOLD_SEVERITIES = ['S2', 'S3'];
const HOLD_EXITS = ['resolved', 'delivered'];
// A steer is either folded into the run or handed to the operator. There is
// no third exit, and in particular no "ignored": a steer that goes nowhere
// still has to say so on the record.
const STEER_EXITS = ['applied', 'operator'];
// Why a seat ended: it finished, it ran out of time, or a fresh generation
// took it over.
const RETIRE_REASONS = ['close', 'timeout', 'supersede'];
// The one reason that is half of a two-record act rather than a whole one.
const SUPERSEDE_REASON = 'supersede';
const FIRST_GENERATION = 1;

// Process/session identity, uniform on a dispatch and its terminal. There is
// no separate session field on either record: session identity lives here and
// nowhere else.
const TRANSPORT_REF_FIELDS = Object.freeze({
  codex: Object.freeze(['pid', 'pgid', 'session']),
  native: Object.freeze(['task_ref']),
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// ---------- the field vocabulary ----------
// Each check answers "what is wrong with this value", as the clause that
// completes `"<kind>" field "<name>" ...`, or null when nothing is.

function nonEmptyText(value) {
  return isNonEmptyString(value) ? null : 'must be a non-empty string';
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value)
    ? null
    : 'must be an identifier of letters, digits, dot, dash or underscore, starting with a letter or digit';
}

function inSet(values) {
  const set = new Set(values);
  const rendered = values.map((value) => JSON.stringify(value)).join(', ');
  return (value) => (set.has(value) ? null : `must be one of ${rendered}`);
}

function digestText(value) {
  return typeof value === 'string' && DIGEST_RE.test(value)
    ? null
    : 'must be a digest of the form sha256:<64 lowercase hex>';
}

function refText(value) {
  return typeof value === 'string' && (LEDGER_REF_RE.test(value) || ENVELOPE_REF_RE.test(value))
    ? null
    : `must be a ref of the form ${REF_GRAMMAR}`;
}

function isProcessId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function generationNumber(value) {
  return Number.isSafeInteger(value) && value >= FIRST_GENERATION
    ? null
    : `must be an integer >= ${FIRST_GENERATION}`;
}

// Which of the two lawful transport_ref shapes this object's key set is, or
// null when it is neither.
function transportRefShape(value) {
  const keys = Object.keys(value).sort();
  for (const transport of Object.keys(TRANSPORT_REF_FIELDS)) {
    const expected = [...TRANSPORT_REF_FIELDS[transport]].sort();
    if (keys.length === expected.length && keys.every((key, i) => key === expected[i])) {
      return transport;
    }
  }
  return null;
}

function transportRef(value) {
  if (!isPlainObject(value)) return 'must be a plain object';
  const shape = transportRefShape(value);
  if (shape === null) {
    return `must carry exactly {${TRANSPORT_REF_FIELDS.codex.join(', ')}} for codex or {${TRANSPORT_REF_FIELDS.native.join(', ')}} for native`;
  }
  if (shape === 'codex') {
    if (!isProcessId(value.pid)) return 'must carry a positive integer "pid"';
    if (!isProcessId(value.pgid)) return 'must carry a positive integer "pgid"';
    if (!isNonEmptyString(value.session)) return 'must carry a non-empty string "session"';
    return null;
  }
  return isNonEmptyString(value.task_ref) ? null : 'must carry a non-empty string "task_ref"';
}

// Every field name this module knows, with its one check. The kind table
// below says WHICH fields a kind carries; this says what each one must be.
const FIELD_CHECKS = Object.freeze({
  dispatch_id: safeId,
  hold_id: nonEmptyText,
  route_id: nonEmptyText,
  seat: nonEmptyText,
  transport: inSet(TRANSPORTS),
  intended_family: nonEmptyText,
  // WHICH MODE THIS RUN TOOK, declared by the dispatch that opened it. A seat
  // that CAN host is not a run that DID: `milestone-reviewer` is native Sonnet
  // on a gpt-dominant milestone and hosted Sol on a claude-dominant one, and
  // binding the hosted claim to the seat's capability made the lawful native
  // route impossible to complete honestly.
  execution_mode: inSet(['native', 'hosted']),
  task_class: nonEmptyText,
  prompt_ref: nonEmptyText,
  transport_ref: transportRef,
  status: inSet(TERMINAL_STATUSES),
  builder: inSet(BUILDERS),
  reason: nonEmptyText,
  result_ref: nonEmptyText,
  model_id: nonEmptyText,
  result_digest: digestText,
  // The evidence a `sol-hosted` attestation RESTS on. Constitutive, not
  // corroborating — it is why the record says gpt — so it lives on the record
  // rather than in a return value a crash would lose.
  hosted_session: safeId,
  workflow: nonEmptyText,
  run_ref: nonEmptyText,
  return: inSet(WORKFLOW_RETURNS),
  record_ref: refText,
  severity: inSet(HOLD_SEVERITIES),
  summary: nonEmptyText,
  origin_ref: nonEmptyText,
  // Two kinds carry an "exit" and they do not share a vocabulary, so the
  // field table admits both and the kind laws below narrow each to its own —
  // the same split `reason` already needs.
  exit: inSet([...HOLD_EXITS, ...STEER_EXITS]),
  resolution_ref: nonEmptyText,
  expected: nonEmptyText,
  actual: nonEmptyText,
  scope_ref: nonEmptyText,
  // Neither a mind nor a scope is ever used to build a path or a ref — they
  // compose into a correlation_id through JSON.stringify, which is injective
  // over any strings — so, like hold_id and route_id, their only contract is
  // non-emptiness.
  steer_id: nonEmptyText,
  instruction: nonEmptyText,
  origin: nonEmptyText,
  mind: nonEmptyText,
  scope: nonEmptyText,
  // What the transport can be resumed through, and what this machine
  // addresses the seated mind by. Two facts, kept as two fields.
  session: nonEmptyText,
  handle: nonEmptyText,
  generation: generationNumber,
});

// A mind's correlation key. The pair rendered through JSON.stringify rather
// than joined with a separator, because a separator is only injective until a
// scope contains it — and a scope is a path-shaped string nobody promised
// anything about.
function mindKey(payload) {
  return `mind ${JSON.stringify([payload.mind, payload.scope])}`;
}

// The eight kinds, closed. `identity` is the record-kind-scoped identity the
// re-entry law compares on; its most specific component doubles as the
// record's correlation_id, the way chunk_id does on the chunk streams — or,
// for a kind whose identity is a composite that no single field carries, the
// `correlation` function says what to correlate on instead.
const KIND_SPECS = Object.freeze({
  dispatch: Object.freeze({
    identity: Object.freeze(['dispatch_id']),
    required: Object.freeze([
      'dispatch_id',
      'seat',
      'transport',
      'intended_family',
      'task_class',
      'prompt_ref',
      'transport_ref',
    ]),
    optional: Object.freeze(['execution_mode']),
  }),
  'dispatch-terminal': Object.freeze({
    identity: Object.freeze(['dispatch_id']),
    required: Object.freeze(['dispatch_id', 'status', 'builder', 'transport_ref']),
    optional: Object.freeze(['reason', 'result_ref', 'hosted_session', ...RESULT_EVIDENCE_FIELDS]),
  }),
  'workflow-return': Object.freeze({
    identity: Object.freeze(['workflow', 'run_ref']),
    required: Object.freeze(['workflow', 'run_ref', 'return', 'record_ref']),
    optional: Object.freeze([]),
  }),
  'hold-open': Object.freeze({
    identity: Object.freeze(['hold_id']),
    required: Object.freeze(['hold_id', 'severity', 'summary', 'origin_ref']),
    optional: Object.freeze([]),
  }),
  'hold-resolve': Object.freeze({
    identity: Object.freeze(['hold_id']),
    required: Object.freeze(['hold_id', 'exit', 'resolution_ref']),
    optional: Object.freeze([]),
  }),
  'degraded-route': Object.freeze({
    identity: Object.freeze(['route_id']),
    required: Object.freeze(['route_id', 'expected', 'actual', 'reason', 'scope_ref']),
    optional: Object.freeze([]),
  }),
  // A STEER IS A HOLD IN EVERY SHAPE THAT MATTERS. It is raised outside the
  // workflow, read at the next invocation's start, single-use for the life of
  // the tree, and it exits exactly once. That is the hold lifecycle already
  // built and hardened here, so steering reuses it rather than inventing a
  // second mechanism with the same shape — pending is "raised with no apply",
  // derived from the pair, never a status field anything rewrites.
  'steer-raise': Object.freeze({
    identity: Object.freeze(['steer_id']),
    required: Object.freeze(['steer_id', 'scope', 'instruction', 'origin']),
    optional: Object.freeze([]),
  }),
  'steer-apply': Object.freeze({
    identity: Object.freeze(['steer_id']),
    required: Object.freeze(['steer_id', 'exit', 'resolution_ref']),
    optional: Object.freeze([]),
  }),
  'mind-open': Object.freeze({
    identity: Object.freeze(['mind', 'scope', 'generation']),
    required: Object.freeze(['mind', 'scope', 'session', 'handle', 'generation']),
    optional: Object.freeze([]),
    correlation: mindKey,
  }),
  'mind-retire': Object.freeze({
    identity: Object.freeze(['mind', 'scope', 'generation']),
    required: Object.freeze(['mind', 'scope', 'reason', 'generation']),
    optional: Object.freeze([]),
    correlation: mindKey,
  }),
});

const RECORD_KINDS = Object.freeze(Object.keys(KIND_SPECS));

// recordProblem(kind, payload) -> why that kind and those fields are not a
// record, in one plain sentence, or null when they are one. This is the whole
// schema contract and the only copy of it: the kind is one of the eight, the
// payload's key set is that kind's required fields plus at most its optional
// ones (an unknown field is refused, never silently dropped), and every field
// satisfies its own check. Every writer throws on the sentence.
function recordProblem(kind, payload) {
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(KIND_SPECS, kind)) {
    return `kind must be one of ${RECORD_KINDS.join(', ')} (got ${JSON.stringify(kind)})`;
  }
  if (!isPlainObject(payload)) {
    return `a "${kind}" record payload must be a plain object`;
  }

  const { required, optional } = KIND_SPECS[kind];
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      return `a "${kind}" record is missing required field "${field}"`;
    }
  }
  const allowed = [...required, ...optional];
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) {
      return `a "${kind}" record has unexpected field "${key}" (allowed: ${allowed.join(', ')})`;
    }
  }
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
    const problem = FIELD_CHECKS[field](payload[field]);
    if (problem !== null) {
      return `"${kind}" field "${field}" ${problem}`;
    }
  }

  // A dispatch declares its transport, so its transport_ref must be that
  // transport's shape — the terminal carries no transport of its own and is
  // instead bound to its dispatch's exact value at write time.
  if (kind === 'dispatch' && transportRefShape(payload.transport_ref) !== payload.transport) {
    return `a "dispatch" record on transport "${payload.transport}" must carry a transport_ref of exactly {${TRANSPORT_REF_FIELDS[payload.transport].join(', ')}}`;
  }

  // A timeout is not an outcome of its own — it is this reason on a FAILED
  // terminal. Checking status and reason independently would let a terminal
  // claim it both succeeded and ran out of time, and the pending/terminal
  // views downstream would read that unit as a success.
  if (
    kind === 'dispatch-terminal' &&
    payload.reason === TIMEOUT_REASON &&
    payload.status !== 'failed'
  ) {
    return `a "dispatch-terminal" record with reason "${TIMEOUT_REASON}" must carry status "failed", not ${JSON.stringify(payload.status)} — a timeout is a failure, never a status of its own`;
  }

  const exitVocabulary = { 'hold-resolve': HOLD_EXITS, 'steer-apply': STEER_EXITS }[kind];
  if (exitVocabulary !== undefined && !exitVocabulary.includes(payload.exit)) {
    return `"${kind}" field "exit" must be one of ${exitVocabulary.map((value) => JSON.stringify(value)).join(', ')}`;
  }

  // `reason` carries a free sentence on the two kinds that explain a failure
  // or a substitution, and a closed vocabulary on the one kind where it says
  // WHICH exit a seat took — a distinction the field table cannot make,
  // since it keys on the field name alone.
  if (kind === 'mind-retire' && !RETIRE_REASONS.includes(payload.reason)) {
    return `"mind-retire" field "reason" must be one of ${RETIRE_REASONS.map((value) => JSON.stringify(value)).join(', ')}`;
  }

  // A success has to prove itself, and a failure has nothing to prove. Both
  // halves are enforced: without the first, an ok terminal can claim a result
  // it cannot describe; without the second, a failed one can carry evidence of
  // a result that was never produced.
  if (kind === 'dispatch-terminal') {
    for (const field of RESULT_EVIDENCE_FIELDS) {
      const present = Object.prototype.hasOwnProperty.call(payload, field);
      if (payload.status === 'ok' && !present) {
        return `a "dispatch-terminal" record with status "ok" is missing required field "${field}" — a successful dispatch must attest what built it and what it produced`;
      }
      if (payload.status === 'failed' && present) {
        return `a "dispatch-terminal" record with status "failed" must not carry "${field}" — a dispatch that failed produced no result to attest`;
      }
    }
  }

  return null;
}

// ---------- paths and refs ----------

function ledgerPathOf(treeRoot) {
  return path.join(treeRoot, LEDGER_FILENAME);
}

function envelopePathOf(treeRoot, phase, dispatchId) {
  return path.join(treeRoot, ENVELOPES_DIRNAME, phase, `${dispatchId}.json`);
}

function ledgerRef(seq) {
  return `ledger:${seq}`;
}

function envelopeRef(phase, dispatchId) {
  return `envelope:${phase}/${dispatchId}`;
}

function requireTreeRoot(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('receipts: treeRoot must be a non-empty string');
  }
}

// Reads the ledger and fails closed on any parse error or common-header
// violation: an identity check over a stream this module cannot fully parse
// cannot prove a record's absence, and appending on that basis is exactly the
// duplicate the re-entry law exists to prevent.
function readLedgerOrThrow(ledgerPath) {
  const { records, errors, headerViolations } = readRecords(ledgerPath);
  if (errors.length > 0) {
    const detail = errors.map((e) => `line ${e.lineNo}: ${e.reason}`).join('; ');
    throw new Error(`receipts: ${ledgerPath} has malformed record(s) — refusing to trust this stream: ${detail}`);
  }
  if (headerViolations.length > 0) {
    const detail = headerViolations.map((v) => `record[${v.index}]: ${v.errors.join(', ')}`).join('; ');
    throw new Error(
      `receipts: ${ledgerPath} has record(s) violating the common JSONL header — refusing to trust this stream: ${detail}`
    );
  }
  return records;
}

// resolveRef(treeRoot, ref) -> the durable record or envelope behind a ref,
// or null when the ref is well-formed but nothing is there. The single
// decoder of the grammar at the top of this file; a ref outside it is a
// caller defect and throws.
function resolveRef(treeRoot, ref) {
  requireTreeRoot(treeRoot);

  const ledgerMatch = typeof ref === 'string' ? LEDGER_REF_RE.exec(ref) : null;
  if (ledgerMatch) {
    const seq = Number(ledgerMatch[1]);
    const record = readLedgerOrThrow(ledgerPathOf(treeRoot)).find((candidate) => candidate.seq === seq);
    return record === undefined ? null : record;
  }

  const envelopeMatch = typeof ref === 'string' ? ENVELOPE_REF_RE.exec(ref) : null;
  if (envelopeMatch) {
    return readJson(envelopePathOf(treeRoot, envelopeMatch[1], envelopeMatch[2]), null);
  }

  throw new Error(`receipts: ref must be ${REF_GRAMMAR} (got ${JSON.stringify(ref)})`);
}

// ---------- the shared append transaction ----------

// The record's own fields, the common header stream.js stamps set aside —
// what remains is exactly the payload a writer supplied, so a replay compares
// like against like, ts and seq excluded by construction.
function payloadOf(record) {
  const { schema_version, seq, kind, ts, correlation_id, ...payload } = record;
  return payload;
}

function identityMatches(record, kind, payload) {
  if (record.kind !== kind) return false;
  return KIND_SPECS[kind].identity.every((field) => record[field] === payload[field]);
}

function identityText(kind, payload) {
  return KIND_SPECS[kind].identity.map((field) => `${field}=${JSON.stringify(payload[field])}`).join(', ');
}

// withLifecycleLock(treeRoot, fn) — run fn under the lock every writer here
// takes. Exported because the mind lifecycle now has a reader OUTSIDE this
// module that must be atomic with respect to it: architecture-txn.js checks a
// generation and writes the marker that acts on it, and those two steps have
// to exclude a retire landing between them. The lock's identity is defined
// once, here, so no caller can take "the receipts lock" at a path this module
// does not recognize. Lock ORDER, for anyone composing it with another lock:
// this one is taken INNERMOST — nothing in this module takes any other
// module's lock except stream.js's own ledger lock, one level further in.
function withLifecycleLock(treeRoot, fn) {
  requireTreeRoot(treeRoot);
  return withLock(path.join(treeRoot, RECEIPTS_LOCK_BASE), fn);
}

// The body of an append, WITHOUT the lock: read the ledger, apply the
// re-entry law, run the kind's own precondition, append, and return the
// record read back off disk. Separated from the lock so that two appends can
// share one hold — the ledger is re-read on each call, so the second sees
// what the first just wrote.
function appendReceiptLocked(treeRoot, kind, payload, precondition) {
  const ledgerPath = ledgerPathOf(treeRoot);
  {
    const records = readLedgerOrThrow(ledgerPath);

    const existing = records.find((record) => identityMatches(record, kind, payload));
    if (existing !== undefined) {
      if (isDeepStrictEqual(payloadOf(existing), payload)) {
        return { ref: ledgerRef(existing.seq), record: existing };
      }
      throw new Error(
        `receipts: a "${kind}" record for ${identityText(kind, payload)} already exists with a different payload — refusing to write a conflicting duplicate`
      );
    }

    if (precondition) precondition(treeRoot, records, payload);

    const { identity, correlation } = KIND_SPECS[kind];
    const seq = appendRecord(ledgerPath, {
      kind,
      payload,
      correlation_id: correlation ? correlation(payload) : payload[identity[identity.length - 1]],
    });
    const record = readLedgerOrThrow(ledgerPath).find((candidate) => candidate.seq === seq);
    return { ref: ledgerRef(seq), record };
  }
}

// appendReceipt(treeRoot, kind, payload, precondition) — one validated record,
// under one lock hold. `precondition(treeRoot, records, payload)` throws to
// abort; it runs only on the first write, since a replay has already
// satisfied it once.
function appendReceipt(treeRoot, kind, payload, precondition) {
  requireTreeRoot(treeRoot);
  const problem = recordProblem(kind, payload);
  if (problem !== null) {
    throw new TypeError(`receipts: ${problem}`);
  }
  return withLifecycleLock(treeRoot, () => appendReceiptLocked(treeRoot, kind, payload, precondition));
}

// ---------- the eight writers ----------

function writeDispatch(treeRoot, payload) {
  return appendReceipt(treeRoot, 'dispatch', payload, null);
}

// The correlation law: a terminal never precedes its own dispatch, and it
// carries that dispatch's exact process/session identity — a terminal whose
// transport_ref differs describes some other process.
function requireMatchingDispatch(treeRoot, records, payload) {
  const dispatch = records.find(
    (record) => record.kind === 'dispatch' && record.dispatch_id === payload.dispatch_id
  );
  if (dispatch === undefined) {
    throw new Error(
      `receipts: no dispatch record for dispatch_id ${JSON.stringify(payload.dispatch_id)} — a terminal cannot precede its own dispatch`
    );
  }
  if (!isDeepStrictEqual(dispatch.transport_ref, payload.transport_ref)) {
    throw new Error(
      `receipts: dispatch-terminal transport_ref for dispatch_id ${JSON.stringify(payload.dispatch_id)} does not match its dispatch's transport_ref`
    );
  }
}

function writeDispatchTerminal(treeRoot, payload) {
  return appendReceipt(treeRoot, 'dispatch-terminal', payload, requireMatchingDispatch);
}

// A workflow's return cites the durable record it is returning about, and the
// citation is checked here rather than believed: a return pointing at nothing
// is a claim without evidence.
function requireResolvableRecordRef(treeRoot, records, payload) {
  if (resolveRef(treeRoot, payload.record_ref) === null) {
    throw new Error(
      `receipts: workflow-return record_ref ${JSON.stringify(payload.record_ref)} does not resolve to a durable record`
    );
  }
}

function writeWorkflowReturn(treeRoot, payload) {
  return appendReceipt(treeRoot, 'workflow-return', payload, requireResolvableRecordRef);
}

function writeHoldOpen(treeRoot, payload) {
  return appendReceipt(treeRoot, 'hold-open', payload, null);
}

function requireOpenHold(treeRoot, records, payload) {
  const open = records.find(
    (record) => record.kind === 'hold-open' && record.hold_id === payload.hold_id
  );
  if (open === undefined) {
    throw new Error(
      `receipts: no hold-open record for hold_id ${JSON.stringify(payload.hold_id)} — a hold cannot exit before it is opened`
    );
  }
}

function writeHoldResolve(treeRoot, payload) {
  return appendReceipt(treeRoot, 'hold-resolve', payload, requireOpenHold);
}

function writeSteerRaise(treeRoot, payload) {
  return appendReceipt(treeRoot, 'steer-raise', payload, null);
}

function requireRaisedSteer(treeRoot, records, payload) {
  const raised = records.find(
    (record) => record.kind === 'steer-raise' && record.steer_id === payload.steer_id
  );
  if (raised === undefined) {
    throw new Error(
      `receipts: no steer-raise record for steer_id ${JSON.stringify(payload.steer_id)} — a steer cannot exit before it is raised`
    );
  }
}

function writeSteerApply(treeRoot, payload) {
  return appendReceipt(treeRoot, 'steer-apply', payload, requireRaisedSteer);
}

function writeDegradedRoute(treeRoot, payload) {
  return appendReceipt(treeRoot, 'degraded-route', payload, null);
}

// The records of one mind's own scope, in stream order — every generation
// question below is asked of these and of nothing else.
function mindRecords(records, kind, payload) {
  return records.filter(
    (record) => record.kind === kind && record.mind === payload.mind && record.scope === payload.scope
  );
}

function hasGeneration(records, kind, payload, generation) {
  return mindRecords(records, kind, payload).some((record) => record.generation === generation);
}

// The generation ladder: 1 opens freely, N opens only over a retired N-1.
// Together with the re-entry law's own refusal of a second, different seat at
// the same generation, that is the whole two-writers guard on this side.
function requireOpenableGeneration(treeRoot, records, payload) {
  if (payload.generation === FIRST_GENERATION) return;
  const previous = payload.generation - 1;
  if (!hasGeneration(records, 'mind-open', payload, previous)) {
    throw new Error(
      `receipts: ${mindKey(payload)} has no generation ${previous} on the ledger — generations do not skip`
    );
  }
  if (!hasGeneration(records, 'mind-retire', payload, previous)) {
    throw new Error(
      `receipts: generation ${previous} of ${mindKey(payload)} is still live — retire it before opening generation ${payload.generation}`
    );
  }
}

function writeMindOpen(treeRoot, payload) {
  return appendReceipt(treeRoot, 'mind-open', payload, requireOpenableGeneration);
}

function requireOpenGeneration(treeRoot, records, payload) {
  if (!hasGeneration(records, 'mind-open', payload, payload.generation)) {
    throw new Error(
      `receipts: no mind-open record for ${mindKey(payload)} at generation ${payload.generation} — a mind cannot retire before it is opened`
    );
  }
}

// A close and a timeout END a seat; a supersede HANDS IT OVER, and the
// handover is only ever written by supersedeMind. Refusing the reason here is
// what makes that structural instead of advisory: a caller cannot assemble a
// supersede out of two standalone writers, because the first half does not
// exist on its own.
function writeMindRetire(treeRoot, payload) {
  if (isPlainObject(payload) && payload.reason === SUPERSEDE_REASON) {
    throw new Error(
      `receipts: a "${SUPERSEDE_REASON}" retire is half of a handover and is written only by supersedeMind — writeMindRetire writes the reasons that end a seat outright`
    );
  }
  return appendReceipt(treeRoot, 'mind-retire', payload, requireOpenGeneration);
}

// supersedeMind(treeRoot, retirePayload, openPayload) — retire generation N
// and open N+1 as ONE sequence, under a single lock hold.
//
// The lock is what this call is FOR. Two standalone writers each take and
// release the lock, so another lifecycle writer can land between them with no
// crash involved at all — and what it would land in is the one moment the
// seat is empty, which is exactly when a duplicate launch looks lawful. One
// hold removes that window for as long as this process lives.
//
// It does NOT make the two appends one write, and nothing here pretends
// otherwise: a kill between them leaves the retire durable and the open
// missing. That state is finished by re-entry, not by the lock — the retire
// replays onto its own receipt and the ladder leaves exactly one lawful next
// move. The lock buys exclusion while the process lives; re-entry buys
// completion after it dies; neither substitutes for the other.
function supersedeMind(treeRoot, retirePayload, openPayload) {
  requireTreeRoot(treeRoot);
  for (const [kind, payload] of [
    ['mind-retire', retirePayload],
    ['mind-open', openPayload],
  ]) {
    const problem = recordProblem(kind, payload);
    if (problem !== null) {
      throw new TypeError(`receipts: ${problem}`);
    }
  }
  if (retirePayload.reason !== SUPERSEDE_REASON) {
    throw new TypeError(
      `receipts: supersedeMind retires with reason ${JSON.stringify(SUPERSEDE_REASON)}, not ${JSON.stringify(retirePayload.reason)} — a handover is not a close`
    );
  }
  if (retirePayload.mind !== openPayload.mind || retirePayload.scope !== openPayload.scope) {
    throw new TypeError(
      `receipts: supersedeMind hands one seat to its own successor, so both records must name the same mind and scope (${mindKey(retirePayload)} vs ${mindKey(openPayload)})`
    );
  }
  if (openPayload.generation !== retirePayload.generation + 1) {
    throw new TypeError(
      `receipts: a supersede of generation ${retirePayload.generation} opens generation ${retirePayload.generation + 1}, not ${openPayload.generation}`
    );
  }

  return withLifecycleLock(treeRoot, () => ({
    retire: appendReceiptLocked(treeRoot, 'mind-retire', retirePayload, requireOpenGeneration),
    open: appendReceiptLocked(treeRoot, 'mind-open', openPayload, requireOpenableGeneration),
  }));
}

// ---------- envelope persistence ----------

// writeEnvelope(treeRoot, phase, dispatchId, envelope) — the envelope a unit
// returned, at the deterministic path its dispatch_id names, so a replay
// writes the same file: identical content is a no-op that returns the
// existing envelope as the receipt, conflicting content for the same
// dispatch_id fails closed.
function writeEnvelope(treeRoot, phase, dispatchId, envelope) {
  requireTreeRoot(treeRoot);
  if (typeof phase !== 'string' || !SAFE_ID_RE.test(phase)) {
    throw new TypeError(`receipts: phase must be a safe identifier (got ${JSON.stringify(phase)})`);
  }
  if (typeof dispatchId !== 'string' || !SAFE_ID_RE.test(dispatchId)) {
    throw new TypeError(`receipts: dispatch_id must be a safe identifier (got ${JSON.stringify(dispatchId)})`);
  }
  const { ok, errors } = validateEnvelope(envelope);
  if (!ok) {
    throw new TypeError(`receipts: invalid envelope — ${errors.join('; ')}`);
  }

  const file = envelopePathOf(treeRoot, phase, dispatchId);
  return withLock(file, () => {
    const existing = readJson(file, null);
    if (existing !== null) {
      if (isDeepStrictEqual(existing, envelope)) {
        return { ref: envelopeRef(phase, dispatchId), envelope: existing };
      }
      throw new Error(
        `receipts: an envelope for ${phase}/${dispatchId} already exists with different content — refusing to write a conflicting duplicate`
      );
    }
    writeAtomic(file, envelope);
    return { ref: envelopeRef(phase, dispatchId), envelope: readJson(file, null) };
  });
}

module.exports = {
  RECORD_KINDS,
  recordProblem,
  resolveRef,
  writeDispatch,
  writeDispatchTerminal,
  writeWorkflowReturn,
  writeHoldOpen,
  writeHoldResolve,
  writeDegradedRoute,
  writeSteerRaise,
  writeSteerApply,
  writeMindOpen,
  writeMindRetire,
  supersedeMind,
  withLifecycleLock,
  writeEnvelope,
};
