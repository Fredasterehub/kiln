'use strict';

// receipts.js — the sole sanctioned writer of the six realignment record
// kinds, all of them on `<treeRoot>/ledger.jsonl`, plus the envelope files
// the workflows persist beside them:
//
//   dispatch          — a unit was sent out, written BEFORE any outcome
//   dispatch-terminal — that same unit's one and only outcome
//   workflow-return   — a workflow handed control back, citing a durable record
//   hold-open         — a blocker was raised
//   hold-resolve      — that same hold's one and only exit
//   degraded-route    — a capability was substituted mid-build
//
// Pending vs terminal is derivable from the dispatch/terminal pair alone (a
// dispatch with no terminal is pending), and open vs resolved from the
// hold-open/hold-resolve pair — no status field anywhere is ever updated in
// place, because nothing in this tree rewrites a stream.
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
// degraded-route = route_id, workflow-return = (workflow, run_ref), envelope
// = (phase, dispatch_id). A hold_id is therefore single-use for the lifetime
// of the tree, live or resolved; a genuine recurrence is a NEW hold_id whose
// origin_ref cites the prior hold.
//
// The read-check-append sequence runs under jsonl.js's own single-writer
// lockfile, taken on this module's own path rather than on ledger.jsonl:
// stream.appendRecord already takes the ledger's lock to allocate seq, and a
// second, outer lock on the same file would deadlock against it. These six
// kinds have exactly one writer — this module — so a module-scoped lock
// serializes every identity check that matters.

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
// The one reason with a status of its own attached to it by law.
const TIMEOUT_REASON = 'timeout';
// Evidence, never intent: who actually built it. A timeout is not a status of
// its own — it is `status: "failed", reason: "timeout"`.
const BUILDERS = ['sol', 'claude-fallback', null];
const WORKFLOW_RETURNS = ['beat', 'phase_complete', 'operator_needed', 'needs_consult', 'blocked'];
const HOLD_SEVERITIES = ['S2', 'S3'];
const HOLD_EXITS = ['resolved', 'delivered'];

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

function refText(value) {
  return typeof value === 'string' && (LEDGER_REF_RE.test(value) || ENVELOPE_REF_RE.test(value))
    ? null
    : `must be a ref of the form ${REF_GRAMMAR}`;
}

function isProcessId(value) {
  return Number.isSafeInteger(value) && value > 0;
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
  task_class: nonEmptyText,
  prompt_ref: nonEmptyText,
  transport_ref: transportRef,
  status: inSet(TERMINAL_STATUSES),
  builder: inSet(BUILDERS),
  reason: nonEmptyText,
  result_ref: nonEmptyText,
  workflow: nonEmptyText,
  run_ref: nonEmptyText,
  return: inSet(WORKFLOW_RETURNS),
  record_ref: refText,
  severity: inSet(HOLD_SEVERITIES),
  summary: nonEmptyText,
  origin_ref: nonEmptyText,
  exit: inSet(HOLD_EXITS),
  resolution_ref: nonEmptyText,
  expected: nonEmptyText,
  actual: nonEmptyText,
  scope_ref: nonEmptyText,
});

// The six kinds, closed. `identity` is the record-kind-scoped identity the
// re-entry law compares on; its most specific component doubles as the
// record's correlation_id, the way chunk_id does on the chunk streams.
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
    optional: Object.freeze([]),
  }),
  'dispatch-terminal': Object.freeze({
    identity: Object.freeze(['dispatch_id']),
    required: Object.freeze(['dispatch_id', 'status', 'builder', 'transport_ref']),
    optional: Object.freeze(['reason', 'result_ref']),
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
});

const RECORD_KINDS = Object.freeze(Object.keys(KIND_SPECS));

// recordProblem(kind, payload) -> why that kind and those fields are not a
// record, in one plain sentence, or null when they are one. This is the whole
// schema contract and the only copy of it: the kind is one of the six, the
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

// appendReceipt(treeRoot, kind, payload, precondition) — validate, then under
// this module's lock: read the ledger, apply the re-entry law, run the kind's
// own precondition, append, and return the record read back off disk.
// `precondition(treeRoot, records, payload)` throws to abort; it runs only on
// the first write, since a replay has already satisfied it once.
function appendReceipt(treeRoot, kind, payload, precondition) {
  requireTreeRoot(treeRoot);
  const problem = recordProblem(kind, payload);
  if (problem !== null) {
    throw new TypeError(`receipts: ${problem}`);
  }

  const ledgerPath = ledgerPathOf(treeRoot);
  return withLock(path.join(treeRoot, RECEIPTS_LOCK_BASE), () => {
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

    const identity = KIND_SPECS[kind].identity;
    const seq = appendRecord(ledgerPath, {
      kind,
      payload,
      correlation_id: payload[identity[identity.length - 1]],
    });
    const record = readLedgerOrThrow(ledgerPath).find((candidate) => candidate.seq === seq);
    return { ref: ledgerRef(seq), record };
  });
}

// ---------- the six writers ----------

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

function writeDegradedRoute(treeRoot, payload) {
  return appendReceipt(treeRoot, 'degraded-route', payload, null);
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
  writeEnvelope,
};
