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
// knowledge, no reviewer choice, no loop, no ordering decision. Nor do those
// live in the workflow scripts: a script performs the one transition it was
// handed and holds no policy either. They live in the phase's RESOLVER —
// `machine/src/spine.js` for implementation — where a test can build a tree
// state and read the answer without running an agent or a workflow. A facade
// that started making them would be a second orchestrator competing with the
// resolver. Every function below either reads bounded state or forwards to a
// module that already owns the law it enforces.
//
// It adds no validation of its own. `persistReceipt` routes and receipts.js
// validates; `invoke` dispatches and the operation validates. A second layer
// here would be a second copy of a contract that already has an owner, and
// the copies drift — so the only thing this module refuses on its own account
// is a name it does not know: an unknown phase, an unknown receipt kind, an
// unknown op.

const fs = require('node:fs');
const path = require('node:path');

const { projectFile } = require('./projection.js');
const { readJson } = require('./atomic-json.js');
const { manifestArtifactsDigest } = require('./manifest.js');
const { readRecords } = require('./stream.js');
const phases = require('./phases.js');
const { loadRegistry, resumePoint } = phases;
const receipts = require('./receipts.js');
const implementation = require('./implementation.js');
const architectureTxn = require('./architecture-txn.js');
const milestones = require('./milestones.js');
const spine = require('./spine.js');
const views = require('./views.js');
const familyEvidence = require('./family-evidence.js');
const capsule = require('./capsule.js');
const dispatch = require('./dispatch.js');
const toolchain = require('./toolchain.js');
const { runGate } = require('./check-honesty.js');
const promotion = require('./promotion.js');

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
  'steer-raise': receipts.writeSteerRaise,
  'steer-apply': receipts.writeSteerApply,
  'mind-open': receipts.writeMindOpen,
  'mind-retire': receipts.writeMindRetire,
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
  // `none` is for an operation whose whole result IS its return value:
  // resolving the next transition reads disk and writes nothing, and
  // regenerating views is derived and idempotent. There is no durable record
  // to verify afterwards, and claiming one would be the verification theatre
  // this table exists to avoid.
  'spine.nextTransition': { call: spine.nextTransition, root: (args) => args[0], receipt: 'none' },
  'milestones.recordChunk': { call: milestones.recordChunk, root: (args) => args[0], receipt: 'readback' },
  'views.regenerate': { call: views.regenerate, root: (args) => args[0], receipt: 'none' },
  'familyEvidence.recordBuilt': { call: familyEvidence.recordBuilt, root: (args) => args[0], receipt: 'readback' },
  'familyEvidence.selectReviewer': { call: familyEvidence.selectReviewer, root: (args) => args[0], receipt: 'none' },
  'familyEvidence.selectMilestoneReviewer': {
    call: familyEvidence.selectMilestoneReviewer,
    root: (args) => args[0],
    receipt: 'none',
  },
  'dispatch.dispatchNative': { call: dispatch.dispatchNative, root: (args) => args[0], receipt: 'ref' },
  'dispatch.completeNative': { call: dispatch.completeNative, root: (args) => args[0], receipt: 'ref' },
  // Recovery answers every open dispatch in the tree at once and is
  // idempotent, so it needs nothing from the caller but the tree — and takes
  // nothing else, which is what keeps a workflow from naming a dispatch it
  // would like reaped.
  'dispatch.recoverDispatches': { call: dispatch.recoverDispatches, root: (args) => args[0], receipt: 'none' },
  // The capsule ops take the tree root, the milestone and the chunk, and
  // DERIVE every path from them. Passing a capsule directory or a patch path
  // would let a workflow export a patch out of a capsule that is not this
  // chunk's, or stage one — the same reason the toolchain ops take a tree root
  // and derive the project directory rather than accepting one.
  'capsule.openCapsule': {
    call: (treeRoot, milestoneId, chunkId) =>
      capsule.openCapsule(treeRoot, path.join(treeRoot, '..'), milestoneId, chunkId),
    root: (args) => args[0],
    receipt: 'none',
  },
  'capsule.exportDiff': {
    call: (treeRoot, milestoneId, chunkId) =>
      capsule.exportDiff(capsule.capsulePathsOf(path.join(treeRoot, '..'), milestoneId, chunkId).capsuleDir),
    root: (args) => args[0],
    receipt: 'none',
  },
  'capsule.applyToStaging': {
    call: (treeRoot, milestoneId, chunkId, patchDigest) => {
      const repoRoot = path.join(treeRoot, '..');
      const { patchPath } = capsule.capsulePathsOf(repoRoot, milestoneId, chunkId);
      return capsule.applyToStaging(repoRoot, patchPath, patchDigest);
    },
    root: (args) => args[0],
    receipt: 'none',
  },
  'capsule.discardStaging': {
    call: (treeRoot) => capsule.discardStaging(path.join(treeRoot, '..')),
    root: (args) => args[0],
    receipt: 'none',
  },
  'capsule.syncWorktreeToHead': {
    call: (treeRoot) => capsule.syncWorktreeToHead(path.join(treeRoot, '..')),
    root: (args) => args[0],
    receipt: 'none',
  },
  'capsule.closeCapsule': {
    call: (treeRoot, milestoneId, chunkId) =>
      capsule.closeCapsule(capsule.capsulePathsOf(path.join(treeRoot, '..'), milestoneId, chunkId).capsuleDir),
    root: (args) => args[0],
    receipt: 'none',
  },
  // What is staged in the project right now. `sealChunk` cites a diff digest,
  // and the only honest one is the current one: a digest carried down from the
  // build record is stale the moment a revise stages new work.
  'implementation.stagedDiffDigest': {
    call: (treeRoot) => ({ diff_digest: implementation.stagedDiffDigest(path.join(treeRoot, '..')) }),
    root: (args) => args[0],
    receipt: 'none',
  },
  // Where a seat must write what it authored. Derived by the module that will
  // later read it, so the two cannot disagree.
  'promotion.stagedPathFor': {
    call: (treeRoot, artifactClass, scope) => {
      const stagedPath = promotion.stagedPathFor(treeRoot, artifactClass, scope);
      // Both forms, because they answer two different callers: the absolute
      // path is what a seat is told to write, and the tree-relative one is
      // what a dispatch terminal cites as the artifact it produced.
      return { staged_path: stagedPath, staged_ref: path.relative(treeRoot, stagedPath) };
    },
    root: (args) => args[0],
    receipt: 'none',
  },
  // The phase's own terminal move. The registry and both file paths are this
  // machine's, derived from the tree — a workflow that could supply a registry
  // could advance into a phase the machine does not define.
  // `phases.advance()` returns {from, to, state} and no seq, but it APPENDS a
  // `phase-transition` record on its way — so the ref a workflow must cite is
  // read back from the ledger here rather than invented from a field that does
  // not exist. Building `ledger:${result.seq}` out of an absent seq produced
  // `ledger:undefined`, which `writeWorkflowReturn` then refused AFTER the
  // phase pointer had already moved.
  'phases.advance': {
    call: (treeRoot) => {
      const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
      const result = phases.advance(
        treeRoot,
        loadRegistry(DEFAULT_REGISTRY_PATH),
        path.join(treeRoot, 'state.json'),
        ledgerPath
      );
      const { records } = readRecords(ledgerPath);
      const transition = records
        .filter((r) => r.kind === 'phase-transition' && r.from === result.from && r.to === result.to)
        .pop();
      if (transition === undefined) {
        throw new Error(
          `workflow: phases.advance moved ${JSON.stringify(result.from)} to ${JSON.stringify(result.to)} but appended no matching "phase-transition" record — the advance cannot be cited`
        );
      }
      return { ...result, seq: transition.seq };
    },
    root: (args) => args[0],
    receipt: 'none',
  },
  'receipts.writeSteerApply': { call: receipts.writeSteerApply, root: (args) => args[0], receipt: 'ref' },
  // The toolchain acts on the PROJECT, which is the tree's parent — so these
  // take the tree root like every other op and derive the project directory
  // from it. A workflow that could name the directory to scaffold or install
  // into would be choosing where the machine writes, which is the one thing
  // this table exists to prevent.
  'toolchain.probeSatisfied': {
    call: (treeRoot, profileId) => toolchain.probeSatisfied(profileId, path.join(treeRoot, '..')),
    root: (args) => args[0],
    receipt: 'none',
  },
  'toolchain.scaffoldProfile': {
    call: (treeRoot, profileId) => toolchain.scaffoldProfile(profileId, path.join(treeRoot, '..')),
    root: (args) => args[0],
    receipt: 'none',
  },
  // The exact commands a gate runs, composed from the profile rather than
  // guessed. Hard-coding `npm ci` and `npm test` was the alternative, and it
  // is wrong for two of the three profiles.
  'toolchain.composeInstall': {
    call: (treeRoot, profileId) => ({ cmd: toolchain.composeInstall(profileId, path.join(treeRoot, '..')) }),
    root: (args) => args[0],
    receipt: 'none',
  },
  'toolchain.composeSuite': {
    call: (treeRoot, profileId) => ({ cmd: toolchain.composeSuite(profileId, path.join(treeRoot, '..')) }),
    root: (args) => args[0],
    receipt: 'none',
  },
  // runGate takes a single options object, and its ledger path is derived from
  // the tree the invocation names rather than supplied beside it.
  'checkHonesty.runGate': {
    call: (treeRoot, gateId, cmd) =>
      runGate({
        gateId,
        cmd,
        ledgerPath: path.join(treeRoot, 'ledger.jsonl'),
        // The gate runs in the PROJECT, which is the tree's parent. A suite
        // run wherever the caller happened to be standing is evidence about
        // some other directory.
        cwd: path.join(treeRoot, '..'),
      }),
    root: (args) => args[0],
    receipt: 'none',
  },
  'promotion.promoteArtifact': { call: promotion.promoteArtifact, root: (args) => args[0], receipt: 'readback' },
  'implementation.openMilestoneTxn': {
    call: implementation.openMilestoneTxn,
    root: (args) => args[0],
    receipt: 'readback',
  },
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

// ---------- the CLI ----------

// The executable form, and the ONLY one. The Workflow runtime cannot touch a
// filesystem, so every operation reaches the tree through the `workflow-hands`
// agent running one command — and that agent is a model.
//
// THE PAYLOAD NEVER BECOMES SHELL TEXT. Asking a model to interpolate a tree
// path, an op name and a JSON argument list into shell quotes is asking it to
// get quoting right over canonical data it does not control: one apostrophe in
// a milestone title breaks a single-quoted word, and `$(...)` or a backtick in
// a double-quoted one is executed rather than passed. So the payload arrives
// on STDIN, delivered through a heredoc whose delimiter is quoted — which
// suppresses every expansion the shell has and treats quotes as bytes. The
// model's whole job becomes pasting one line between two fixed markers.
//
// There is deliberately no argv payload path. A second way in would be a way
// around, and the quoting hazard would still be reachable from the seat that
// was supposed to have been relieved of it.
//
// A REFUSAL IS DATA. The command answers `{ok, result}` on stdout either way —
// the operation's return when it succeeded, the error text verbatim when it
// refused — and exits non-zero on a refusal so the two agree. That is what
// lets the seat carry a refusal back unedited instead of interpreting it.
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdin();
  let answer;
  let ok = true;
  try {
    if (raw.trim() === '') {
      throw new Error(
        'workflow: this command reads its {treeRoot, op, args} payload from stdin, and stdin was empty — there is no argument form'
      );
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      throw new Error(`workflow: the payload on stdin is not JSON: ${err.message}`);
    }
    if (!isPlainObject(payload)) {
      throw new TypeError('workflow: the payload on stdin must be a {treeRoot, op, args} object');
    }
    if (!isNonEmptyString(payload.op)) {
      throw new TypeError('workflow: the payload on stdin requires a non-empty "op"');
    }
    answer = invoke(payload.treeRoot, payload.op, payload.args === undefined ? [] : payload.args);
  } catch (err) {
    ok = false;
    // The MESSAGE, not the stack: every refusal in this machine is a
    // deliberately worded sentence naming what was wrong, and that sentence is
    // what a workflow acts on. A stack would bury it in paths the caller
    // cannot use and the seat would be tempted to summarise.
    answer = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  process.stdout.write(JSON.stringify({ ok, result: answer }));
  process.exitCode = ok ? 0 : 1;
}

if (require.main === module) main();

module.exports = {
  snapshot,
  persistReceipt,
  invoke,
  OP_NAMES,
  RECEIPT_KINDS,
  MAX_SNAPSHOT_BYTES,
  MAX_LEDGER_VIEW_BYTES,
};
