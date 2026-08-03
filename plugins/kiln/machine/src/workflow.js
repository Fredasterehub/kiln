'use strict';

// workflow.js — the facade a Workflow script talks to, and nothing more.
//
// The Workflow runtime cannot touch the filesystem, so everything a workflow
// needs from the tree has to arrive through a function call. That is the whole
// reason this module exists, and it is the whole of what it does:
//
//   snapshot       — a bounded, selector-built view of where the tree stands
//   persistReceipt — route a receipt to the C1 writer that owns its kind
//   invoke         — call one already-owned machine operation, by name
//
// THIS IS NOT A CONDUCTOR. There is no phase policy here, no protocol
// knowledge, no reviewer choice, no loop, no ordering decision. Those live in
// the workflow scripts, which is exactly where a reader expects to find them;
// a facade that started making them would be a second orchestrator competing
// with the first. Every function below either reads bounded state or forwards
// to a module that already owns the law it enforces.
//
// It adds no validation of its own. `persistReceipt` routes and receipts.js
// validates; `invoke` dispatches and the operation validates. A second layer
// here would be a second copy of a contract that already has an owner, and
// the copies drift — so the only thing this module refuses on its own account
// is a name it does not know: an unknown phase, an unknown receipt kind, an
// unknown op.

const path = require('node:path');

const { projectFile } = require('./projection.js');
const { readJson } = require('./atomic-json.js');
const { manifestArtifactsDigest } = require('./manifest.js');
const { loadRegistry, resumePoint } = require('./phases.js');
const receipts = require('./receipts.js');
const implementation = require('./implementation.js');
const architectureTxn = require('./architecture-txn.js');

const SCHEMA_VERSION = 1;
const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'phases-registry.json');

// MAX_SNAPSHOT_BYTES is a guarantee about the WHOLE object, not about the
// stream projection inside it. The canonical facts are not fixed-size the way
// they first appear: `resumePoint` echoes state.json's own phase back when
// the registry does not define it, so a corrupt state file puts an arbitrarily
// long string in a snapshot without touching the ledger at all. The budget is
// therefore measured against those facts first, and what remains — never more
// than MAX_LEDGER_VIEW_BYTES — is what the ledger view gets to spend.
const MAX_LEDGER_VIEW_BYTES = 12288;
const MAX_SNAPSHOT_BYTES = 16384;

// The projection's own counters (total/kept/dropped) are measured as zeroes
// before the projection runs and can only grow in digits afterwards. This
// covers that growth for any stream length a filesystem could hold.
const COUNTER_HEADROOM_BYTES = 64;

// How far back a snapshot looks, before the byte budget gets its say.
const MAX_LEDGER_RECORDS = 40;

// A snapshot is built ONLY through these selectors. That is what makes it a
// projection rather than a stream handed over whole: a record of a kind not
// named here cannot reach a workflow through this module at all, and a field
// not named here cannot either, however large the record was on disk.
const LEDGER_KINDS = Object.freeze([
  'phase-transition',
  'phase-terminal',
  'phase-reopen',
  'plan-gate-decision',
  'stop',
  'dispatch',
  'dispatch-terminal',
  'workflow-return',
  'hold-open',
  'hold-resolve',
  'degraded-route',
]);

// The common header, plus the identity fields the kinds above carry. `pick`
// copies only what a record actually has, so one flat list serves every kind
// without inventing a per-kind schema this module would then have to own.
const LEDGER_FIELDS = Object.freeze([
  'seq',
  'kind',
  'ts',
  'correlation_id',
  'from',
  'to',
  'dispatch_id',
  'status',
  'workflow',
  'return',
  'hold_id',
  'severity',
  'exit',
  'route_id',
  'reason',
  'decision',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireTreeRoot(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('workflow: treeRoot must be a non-empty string');
  }
}

// ---------- snapshot ----------

// snapshot(treeRoot, phase) — where the tree stands, for one named phase,
// small enough to hand to a workflow whole.
//
// It takes no options, and that is deliberate. A caller-supplied registry
// would let a phase this machine does not define pass validation, and
// caller-supplied state or ledger paths would let a snapshot of one tree be
// assembled out of another — both of which turn "the canonical facts about
// treeRoot" into "whatever the caller arranged to be told". The registry is
// always this machine's own, and both paths are always derived from treeRoot.
function snapshot(treeRoot, phase) {
  requireTreeRoot(treeRoot);
  const registry = loadRegistry(DEFAULT_REGISTRY_PATH);
  const phases = Array.isArray(registry.phases) ? registry.phases : [];
  if (!isNonEmptyString(phase) || !phases.some((entry) => isPlainObject(entry) && entry.id === phase)) {
    throw new Error(
      `workflow: no phase ${JSON.stringify(phase)} in the registry — refusing to snapshot a phase that does not exist`
    );
  }

  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  // The canonical facts first, measured against the cap before the stream is
  // allowed to spend anything. If they alone do not fit, the snapshot is
  // refused rather than shortened: the ledger view can lose records and say so
  // through `dropped`, but a truncated phase id is not a smaller truth, it is
  // a different and false one.
  const facts = {
    schema_version: SCHEMA_VERSION,
    phase,
    resume: resumePoint(treeRoot, registry, statePath),
    ledger: { view: [], total: 0, kept: 0, dropped: 0 },
  };
  const factBytes = Buffer.byteLength(JSON.stringify(facts), 'utf8') + COUNTER_HEADROOM_BYTES;
  if (factBytes >= MAX_SNAPSHOT_BYTES) {
    throw new Error(
      `workflow: the canonical facts for phase "${phase}" in ${treeRoot} are ${factBytes} bytes and exceed the ${MAX_SNAPSHOT_BYTES}-byte cap on their own — refusing to hand back a snapshot that cannot be bounded honestly`
    );
  }

  return {
    ...facts,
    ledger: projectFile(ledgerPath, {
      kinds: LEDGER_KINDS,
      lastN: MAX_LEDGER_RECORDS,
      fields: LEDGER_FIELDS,
      maxBytes: Math.min(MAX_LEDGER_VIEW_BYTES, MAX_SNAPSHOT_BYTES - factBytes),
    }),
  };
}

// ---------- persistReceipt ----------

// One writer per kind, and the kinds are C1's own — the table below is checked
// against `receipts.RECORD_KINDS` by a test, so a kind added there and not
// routed here is a failure rather than a silent gap.
const RECEIPT_WRITERS = Object.freeze({
  dispatch: receipts.writeDispatch,
  'dispatch-terminal': receipts.writeDispatchTerminal,
  'workflow-return': receipts.writeWorkflowReturn,
  'hold-open': receipts.writeHoldOpen,
  'hold-resolve': receipts.writeHoldResolve,
  'degraded-route': receipts.writeDegradedRoute,
});

const ENVELOPE_KIND = 'envelope';
const RECEIPT_KINDS = Object.freeze([...Object.keys(RECEIPT_WRITERS), ENVELOPE_KIND]);

// persistReceipt(treeRoot, phase, receipt) — write a receipt through the C1
// writer that owns its kind.
//
// `receipt` is {kind, payload} for a ledger record, or {kind: "envelope",
// dispatch_id, payload} for an envelope — `phase` is what an envelope is
// filed under, and is ignored for the ledger kinds, which are not per-phase.
//
// The only thing refused here is a kind with no writer. Every other refusal —
// a missing field, an unknown field, a terminal with no dispatch, a
// conflicting duplicate — belongs to receipts.js, which already enforces all
// of it under its own lock; repeating any of it here would be a second copy
// of a contract that already has an owner. The re-entry law comes along for
// free for the same reason: it lives in the writer, not in the routing.
function persistReceipt(treeRoot, phase, receipt) {
  requireTreeRoot(treeRoot);
  if (!isPlainObject(receipt)) {
    throw new TypeError('workflow: persistReceipt requires a {kind, payload} receipt object');
  }
  const { kind } = receipt;
  if (kind === ENVELOPE_KIND) {
    return receipts.writeEnvelope(treeRoot, phase, receipt.dispatch_id, receipt.payload);
  }
  const write = Object.prototype.hasOwnProperty.call(RECEIPT_WRITERS, kind) ? RECEIPT_WRITERS[kind] : null;
  if (write === null) {
    throw new Error(
      `workflow: no writer for receipt kind ${JSON.stringify(kind)} — the kinds this facade can persist are ${RECEIPT_KINDS.join(', ')}`
    );
  }
  return write(treeRoot, receipt.payload);
}

// ---------- invoke ----------

// The closed op table: exactly the transactions and writers S1 has built, and
// nothing speculative. A workflow can reach these and only these, by name.
//
// Each entry says two things: which tree the operation writes into, and how an
// invocation proves it actually landed.
//
// `root(args)` is the tree the operation itself targets. Verification happens
// against THAT tree and no other — an invocation whose stated root is not the
// operation's own is refused before anything runs, because a receipt looked
// for in the wrong tree either fails confusingly or, worse, resolves against
// an unrelated record that happens to share a seq.
//
// `receipt` says where the durable proof comes from.
//   `ref`      — the receipt carries a receipts.js ref, resolved here.
//   `readback` — the operation's own receipt IS a disk read (C2 reads its
//                record back off the chunk stream; C3's promotion and reopen
//                read the marker and the seal back off their files), so a
//                second read here would be a second copy of a guarantee that
//                already has an owner and a test.
//   `reread`   — the operation returns an in-memory object it never reread.
//                `stageArtifacts` is the one: on its new-write path it hands
//                back exactly what `manifest.js#writeManifest` built, and
//                writeManifest writes and returns the same object without
//                looking at the file again. So the read-back this facade
//                promises has to happen here, from the path the receipt
//                itself names.
const OPS = Object.freeze({
  'receipts.writeDispatch': { call: receipts.writeDispatch, root: (args) => args[0], receipt: 'ref' },
  'receipts.writeDispatchTerminal': { call: receipts.writeDispatchTerminal, root: (args) => args[0], receipt: 'ref' },
  'receipts.writeWorkflowReturn': { call: receipts.writeWorkflowReturn, root: (args) => args[0], receipt: 'ref' },
  'receipts.writeHoldOpen': { call: receipts.writeHoldOpen, root: (args) => args[0], receipt: 'ref' },
  'receipts.writeHoldResolve': { call: receipts.writeHoldResolve, root: (args) => args[0], receipt: 'ref' },
  'receipts.writeDegradedRoute': { call: receipts.writeDegradedRoute, root: (args) => args[0], receipt: 'ref' },
  'receipts.writeEnvelope': { call: receipts.writeEnvelope, root: (args) => args[0], receipt: 'ref' },
  'implementation.sealChunk': { call: implementation.sealChunk, root: (args) => args[0], receipt: 'readback' },
  'implementation.closeMilestoneTxn': {
    call: implementation.closeMilestoneTxn,
    root: (args) => args[0],
    receipt: 'readback',
  },
  // architecture-txn takes the architecture directory, and derives its own
  // treeRoot from it exactly this way.
  'architectureTxn.stageArtifacts': {
    call: architectureTxn.stageArtifacts,
    root: (args) => path.dirname(args[0]),
    receipt: 'reread',
    reread: (result) => ({
      key: 'manifest',
      file: path.join(result.revisionDir, 'manifest.json'),
      digest: result.artifacts_digest,
    }),
  },
  'architectureTxn.promoteStaged': {
    call: architectureTxn.promoteStaged,
    root: (args) => path.dirname(args[0]),
    receipt: 'readback',
  },
  'architectureTxn.reopenThroughTxn': {
    call: architectureTxn.reopenThroughTxn,
    root: (args) => path.dirname(args[0]),
    receipt: 'readback',
  },
});

const OP_NAMES = Object.freeze(Object.keys(OPS));

// invoke(treeRoot, op, args) — run one already-owned machine operation.
//
// `args` is the operation's own full argument list, spread as-is: this module
// does not reshape calls, because knowing how to reshape them would be
// knowing what they mean. `treeRoot` is what a `ref` receipt resolves
// against, which is why it is a parameter of its own rather than dug out of
// the arguments.
//
// No phase policy, no ordering, no retries, no loops. One call, one receipt.
function invoke(treeRoot, op, args = []) {
  requireTreeRoot(treeRoot);
  if (!Object.prototype.hasOwnProperty.call(OPS, op)) {
    throw new Error(
      `workflow: unknown op ${JSON.stringify(op)} — this facade dispatches only ${OP_NAMES.join(', ')}`
    );
  }
  if (!Array.isArray(args)) {
    throw new TypeError(`workflow: invoke requires an args array (got ${JSON.stringify(args)})`);
  }

  const entry = OPS[op];
  const opRoot = entry.root(args);
  if (!isNonEmptyString(opRoot) || path.resolve(opRoot) !== path.resolve(treeRoot)) {
    throw new Error(
      `workflow: ${op} operates on ${JSON.stringify(opRoot)} but this invocation would verify against ${JSON.stringify(treeRoot)} — refusing to look for a receipt in a tree the operation never touched`
    );
  }

  const result = entry.call(...args);

  // A `ref` receipt is a claim about the tree; this is where the claim is
  // checked. An op whose ref resolves to nothing left no durable record and
  // did not succeed, however it returned.
  if (entry.receipt === 'ref' && receipts.resolveRef(treeRoot, result.ref) === null) {
    throw new Error(
      `workflow: ${op} returned the receipt ${JSON.stringify(result.ref)}, which resolves to nothing in ${treeRoot} — an operation that left no durable record did not succeed`
    );
  }

  // A `reread` receipt is one the op never read back, so the read happens here
  // and what comes back is what is on disk. That the operation digested this
  // same file a moment earlier is not a reason to trust this read: they are
  // two reads, and what lies between them is exactly where a file gets
  // removed or replaced. So the read must produce the payload the operation
  // returned — proved against the digest the operation itself computed over
  // the set it verified — or the invocation fails. A receipt carrying `null`,
  // or carrying some other manifest, would be a success vouching for
  // something no operation ever wrote.
  if (entry.receipt === 'reread') {
    const { key, file, digest } = entry.reread(result);
    const onDisk = readJson(file, null);
    if (!isPlainObject(onDisk) || !Array.isArray(onDisk.artifacts) || manifestArtifactsDigest(onDisk) !== digest) {
      throw new Error(
        `workflow: ${op} named ${JSON.stringify(file)} as its durable receipt, and what is there now is not the payload it returned — an operation whose durable record is missing or changed did not succeed`
      );
    }
    return { ...result, [key]: onDisk };
  }
  return result;
}

module.exports = {
  snapshot,
  persistReceipt,
  invoke,
  OP_NAMES,
  RECEIPT_KINDS,
  MAX_SNAPSHOT_BYTES,
  MAX_LEDGER_VIEW_BYTES,
};
