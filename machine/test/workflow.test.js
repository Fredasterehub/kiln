'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const {
  snapshot,
  persistReceipt,
  invoke,
  OP_NAMES,
  RECEIPT_KINDS,
  MAX_SNAPSHOT_BYTES,
  MAX_LEDGER_VIEW_BYTES,
} = require('../src/workflow.js');
const receipts = require('../src/receipts.js');
const { readJson, writeAtomic } = require('../src/atomic-json.js');
const { readRecords } = require('../src/stream.js');
const { revisionDirOf } = require('../src/architecture-txn.js');
const {
  validCriteriaRegister,
  validMilestones,
  validArtifactMap,
  VALID_PROTOCOL_RECORD_MD,
  VALID_PLAN_MD,
} = require('./fixtures/valid-architecture-artifacts.js');

const MODULE_PATH = path.resolve(__dirname, '..', 'src', 'workflow.js');

function makeTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-test-'));
  const treeRoot = path.join(tmp, '.thelastskill');
  fs.mkdirSync(treeRoot, { recursive: true });
  writeAtomic(path.join(treeRoot, 'state.json'), {
    schema_version: 1,
    phase: 'implementation',
    phase_status: { onboarding: 'complete' },
    next_action: 'implementation',
    updated_utc: '2026-01-01T00:00:00.000Z',
  });
  return treeRoot;
}

function ledgerPathOf(treeRoot) {
  return path.join(treeRoot, 'ledger.jsonl');
}

// Raw stream writing, deliberately bypassing the sanctioned writers: these
// fixtures exercise the READ side, and some of them are shapes no writer would
// ever produce, which is the point.
function writeLedger(treeRoot, records) {
  fs.writeFileSync(ledgerPathOf(treeRoot), records.map((record) => `${JSON.stringify(record)}\n`).join(''));
}

function ledgerRecord(seq, kind, extra = {}) {
  return {
    schema_version: 1,
    seq,
    kind,
    ts: '2026-01-01T00:00:00.000Z',
    correlation_id: null,
    ...extra,
  };
}

function dispatchPayload(overrides = {}) {
  return {
    dispatch_id: 'd1',
    seat: 'implementer',
    transport: 'native',
    intended_family: 'claude',
    task_class: 'chunk_implementation',
    prompt_ref: 'envelopes/implementation/d1.json',
    transport_ref: { task_ref: 'task-1' },
    ...overrides,
  };
}

function replayInFreshProcess(fnName, args) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-replay-'));
  const scriptPath = path.join(scriptDir, 'replay.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const wf = require(${JSON.stringify(MODULE_PATH)});\n` +
      `const { fn, args } = JSON.parse(process.argv[2]);\n` +
      `process.stdout.write(JSON.stringify(wf[fn](...args)));\n`
  );
  const out = execFileSync(process.execPath, [scriptPath, JSON.stringify({ fn: fnName, args })], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

function artifactSet(overrides = {}) {
  return Object.assign(
    {
      'plan.md': VALID_PLAN_MD,
      'criteria-register.json': validCriteriaRegister(),
      'milestones.json': validMilestones(),
      'artifact-map.json': validArtifactMap(),
      'protocol-record.md': VALID_PROTOCOL_RECORD_MD,
    },
    overrides
  );
}

// ---------- snapshot ----------

test('snapshot returns the phase, its resume point, and a projected ledger view', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    ledgerRecord(0, 'phase-transition', { from: 'onboarding', to: 'brainstorm' }),
    ledgerRecord(1, 'dispatch', { dispatch_id: 'd1', seat: 'implementer' }),
  ]);

  const view = snapshot(treeRoot, 'implementation');

  assert.equal(view.schema_version, 1);
  assert.equal(view.phase, 'implementation');
  assert.equal(view.resume.phase, 'implementation');
  assert.equal(typeof view.resume.canResume, 'boolean');
  assert.ok(Array.isArray(view.resume.missing));
  assert.equal(view.ledger.total, 2);
  assert.equal(view.ledger.kept, 2);
  assert.deepEqual(
    view.ledger.view.map((record) => record.kind),
    ['phase-transition', 'dispatch']
  );
});

test('snapshot refuses a phase the registry does not define', () => {
  const treeRoot = makeTree();

  assert.throws(() => snapshot(treeRoot, 'not_a_phase'), /no phase "not_a_phase" in the registry/);
  assert.throws(() => snapshot(treeRoot, ''), /refusing to snapshot a phase that does not exist/);
  assert.throws(() => snapshot(treeRoot, undefined), /refusing to snapshot a phase that does not exist/);
});

test('snapshot carries ONLY the kinds its selector names — nothing else can reach a workflow', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    ledgerRecord(0, 'phase-transition', { from: 'onboarding', to: 'brainstorm' }),
    // Real ledger kinds that are deliberately outside the selector, plus one
    // that no writer produces at all. None of them may appear.
    ledgerRecord(1, 'gate', { gate_id: 'suite', secret: 'must not surface' }),
    ledgerRecord(2, 'preflight', { check: 'codex' }),
    ledgerRecord(3, 'deviation', { summary: 'must not surface' }),
    ledgerRecord(4, 'invented-kind', { anything: 'must not surface' }),
  ]);

  const view = snapshot(treeRoot, 'implementation');

  assert.equal(view.ledger.total, 5);
  assert.deepEqual(
    view.ledger.view.map((record) => record.kind),
    ['phase-transition']
  );
  assert.equal(JSON.stringify(view).includes('must not surface'), false);
});

test('snapshot carries ONLY the fields its selector names, however large the record was on disk', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    ledgerRecord(0, 'dispatch', {
      dispatch_id: 'd1',
      seat: 'implementer',
      prompt_ref: 'envelopes/implementation/d1.json',
      transport_ref: { pid: 4242, pgid: 4242, session: 'sess-1' },
      prompt_body: 'x'.repeat(4000),
    }),
  ]);

  const view = snapshot(treeRoot, 'implementation');

  const record = view.ledger.view[0];
  assert.deepEqual(Object.keys(record).sort(), ['correlation_id', 'dispatch_id', 'kind', 'seq', 'ts']);
  assert.equal(JSON.stringify(view).includes('prompt_body'), false);
  assert.equal(JSON.stringify(view).includes('transport_ref'), false);
});

test('snapshot stays under its byte cap against an oversized stream, and says what it dropped', () => {
  const treeRoot = makeTree();
  const many = [];
  for (let seq = 0; seq < 4000; seq += 1) {
    many.push(
      ledgerRecord(seq, 'dispatch', {
        dispatch_id: `dispatch-${seq}`,
        correlation_id: `dispatch-${seq}`,
        prompt_body: 'x'.repeat(500),
      })
    );
  }
  writeLedger(treeRoot, many);

  const view = snapshot(treeRoot, 'implementation');

  assert.ok(Buffer.byteLength(JSON.stringify(view), 'utf8') <= MAX_SNAPSHOT_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(view.ledger.view), 'utf8') <= MAX_LEDGER_VIEW_BYTES);
  assert.equal(view.ledger.total, 4000);
  assert.ok(view.ledger.dropped > 0);
  // The records kept are the most recent ones — a workflow re-orienting after
  // a crash needs the tail, not the beginning.
  assert.equal(view.ledger.view[view.ledger.view.length - 1].dispatch_id, 'dispatch-3999');
});

test('snapshot looks back a bounded number of records even when every one of them would fit', () => {
  const treeRoot = makeTree();
  const many = [];
  for (let seq = 0; seq < 300; seq += 1) {
    many.push(ledgerRecord(seq, 'dispatch', { dispatch_id: `d${seq}` }));
  }
  writeLedger(treeRoot, many);

  const view = snapshot(treeRoot, 'implementation');

  // Small records, comfortably inside the byte budget — so the record count
  // is what bounds this, and something has to.
  assert.ok(Buffer.byteLength(JSON.stringify(view.ledger.view), 'utf8') < MAX_LEDGER_VIEW_BYTES);
  assert.equal(view.ledger.total, 300);
  assert.equal(view.ledger.kept, 40);
  assert.equal(view.ledger.view[view.ledger.view.length - 1].dispatch_id, 'd299');
});

test('snapshot evicts by BYTES when the projected records are themselves large', () => {
  const treeRoot = makeTree();
  const many = [];
  for (let seq = 0; seq < 40; seq += 1) {
    // `reason` survives field projection, so this is a record that is still
    // big after the selector has taken everything it can — the case the byte
    // budget exists for, rather than a record made large by fields that get
    // stripped anyway.
    many.push(ledgerRecord(seq, 'dispatch-terminal', { dispatch_id: `d${seq}`, reason: 'x'.repeat(2000) }));
  }
  writeLedger(treeRoot, many);

  const view = snapshot(treeRoot, 'implementation');

  assert.ok(Buffer.byteLength(JSON.stringify(view.ledger.view), 'utf8') <= MAX_LEDGER_VIEW_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(view), 'utf8') <= MAX_SNAPSHOT_BYTES);
  assert.ok(view.ledger.kept < 40);
  assert.ok(view.ledger.dropped > 0);
  assert.equal(view.ledger.view[view.ledger.view.length - 1].dispatch_id, 'd39');
});

test('snapshot caps the WHOLE object, not just its ledger view', () => {
  const treeRoot = makeTree();
  // resumePoint echoes state.json's own phase back for a phase the registry
  // does not define, so a canonical fact — not the stream — is what pushes
  // this snapshot toward the cap. The ledger budget alone cannot see it.
  writeAtomic(path.join(treeRoot, 'state.json'), {
    schema_version: 1,
    phase: 'p'.repeat(8000),
    phase_status: {},
    next_action: 'x',
    updated_utc: '2026-01-01T00:00:00.000Z',
  });
  const many = [];
  for (let seq = 0; seq < 200; seq += 1) {
    many.push(ledgerRecord(seq, 'dispatch-terminal', { dispatch_id: `d${seq}`, reason: 'x'.repeat(2000) }));
  }
  writeLedger(treeRoot, many);

  const view = snapshot(treeRoot, 'implementation');

  assert.ok(
    Buffer.byteLength(JSON.stringify(view), 'utf8') <= MAX_SNAPSHOT_BYTES,
    `snapshot was ${Buffer.byteLength(JSON.stringify(view), 'utf8')} bytes, over the ${MAX_SNAPSHOT_BYTES} cap`
  );
  assert.ok(view.ledger.kept > 0);
});

test('snapshot refuses when the canonical facts alone cannot fit under the cap', () => {
  const treeRoot = makeTree();
  writeAtomic(path.join(treeRoot, 'state.json'), {
    schema_version: 1,
    phase: 'p'.repeat(MAX_SNAPSHOT_BYTES + 1000),
    phase_status: {},
    next_action: 'x',
    updated_utc: '2026-01-01T00:00:00.000Z',
  });

  // Truncating a phase id would hand a workflow a phase that does not exist,
  // which is worse than no snapshot: the ledger view can be shortened and say
  // so through `dropped`, but a canonical fact cannot be shortened honestly.
  assert.throws(() => snapshot(treeRoot, 'implementation'), /canonical facts .* exceed the \d+-byte cap on their own/);
});

test('snapshot cannot be pointed at another tree or given a fabricated registry', () => {
  const treeRoot = makeTree();
  const elsewhere = makeTree();
  writeLedger(elsewhere, [ledgerRecord(0, 'dispatch', { dispatch_id: 'from-elsewhere' })]);
  writeLedger(treeRoot, [ledgerRecord(0, 'dispatch', { dispatch_id: 'from-this-tree' })]);
  // Distinguishable state, so pointing the snapshot elsewhere would show.
  writeAtomic(path.join(elsewhere, 'state.json'), {
    schema_version: 1,
    phase: 'delivery',
    phase_status: {},
    next_action: 'delivery',
    updated_utc: '2026-01-01T00:00:00.000Z',
  });

  // A phase the machine's registry does not define stays refused however
  // convincing the registry a caller hands over.
  assert.throws(
    () =>
      snapshot(treeRoot, 'invented_phase', {
        registry: { schema_version: 1, phases: [{ id: 'invented_phase', order: 1, entry_requires: [] }] },
      }),
    /no phase "invented_phase" in the registry/
  );

  // And the snapshot reads this tree, whatever paths it is handed.
  const view = snapshot(treeRoot, 'implementation', {
    statePath: path.join(elsewhere, 'state.json'),
    ledgerPath: ledgerPathOf(elsewhere),
  });
  assert.equal(view.ledger.view[0].dispatch_id, 'from-this-tree');
  assert.equal(view.resume.phase, 'implementation');
});

test('snapshot reports a resume point that disk does not back', () => {
  const treeRoot = makeTree();

  // Nothing but state.json exists, so implementation's entry_requires cannot
  // be satisfied — snapshot reports that rather than deciding what to do.
  const view = snapshot(treeRoot, 'implementation');

  assert.equal(view.resume.canResume, false);
  assert.ok(view.resume.missing.length > 0);
});

// ---------- persistReceipt ----------

test('persistReceipt routes each ledger kind to its C1 writer', () => {
  const treeRoot = makeTree();

  const dispatch = persistReceipt(treeRoot, 'implementation', { kind: 'dispatch', payload: dispatchPayload() });
  assert.equal(dispatch.ref, 'ledger:0');
  assert.equal(dispatch.record.kind, 'dispatch');

  const terminal = persistReceipt(treeRoot, 'implementation', {
    kind: 'dispatch-terminal',
    payload: {
      dispatch_id: 'd1',
      status: 'ok',
      builder: null,
      transport_ref: { task_ref: 'task-1' },
      model_id: 'opus-5',
      result_digest: `sha256:${'a'.repeat(64)}`,
    },
  });
  assert.equal(terminal.record.kind, 'dispatch-terminal');

  const hold = persistReceipt(treeRoot, 'implementation', {
    kind: 'hold-open',
    payload: { hold_id: 'h1', severity: 'S2', summary: 'blocked on a decision', origin_ref: 'ledger:0' },
  });
  assert.equal(hold.record.kind, 'hold-open');

  const resolved = persistReceipt(treeRoot, 'implementation', {
    kind: 'hold-resolve',
    payload: { hold_id: 'h1', exit: 'resolved', resolution_ref: 'ledger:0' },
  });
  assert.equal(resolved.record.kind, 'hold-resolve');

  const degraded = persistReceipt(treeRoot, 'implementation', {
    kind: 'degraded-route',
    payload: { route_id: 'r1', expected: 'codex', actual: 'claude', reason: 'codex absent', scope_ref: 'ledger:0' },
  });
  assert.equal(degraded.record.kind, 'degraded-route');

  const returned = persistReceipt(treeRoot, 'implementation', {
    kind: 'workflow-return',
    payload: { workflow: 'dev-chunk-cycle', run_ref: 'wf_1', return: 'beat', record_ref: 'ledger:0' },
  });
  assert.equal(returned.record.kind, 'workflow-return');

  const { records } = readRecords(ledgerPathOf(treeRoot));
  assert.deepEqual(
    records.map((record) => record.kind),
    ['dispatch', 'dispatch-terminal', 'hold-open', 'hold-resolve', 'degraded-route', 'workflow-return']
  );
});

test('persistReceipt files an envelope under the phase it is given', () => {
  const treeRoot = makeTree();
  const envelope = {
    state: 'done',
    result: 'chunk implemented',
    evidence: 'suite green, 1743/1743',
    risks: 'none',
    artifact: 'src/thing.js',
    question: '',
  };

  const written = persistReceipt(treeRoot, 'implementation', {
    kind: 'envelope',
    dispatch_id: 'd1',
    payload: envelope,
  });

  assert.equal(written.ref, 'envelope:implementation/d1');
  assert.deepEqual(written.envelope, envelope);
  assert.deepEqual(readJson(path.join(treeRoot, 'envelopes', 'implementation', 'd1.json'), null), envelope);
});

test('persistReceipt refuses a kind it has no writer for, and covers exactly C1 kinds plus the envelope', () => {
  const treeRoot = makeTree();

  assert.throws(
    () => persistReceipt(treeRoot, 'implementation', { kind: 'chunk-green', payload: {} }),
    /no writer for receipt kind "chunk-green"/
  );
  assert.throws(() => persistReceipt(treeRoot, 'implementation', 'not an object'), /requires a \{kind, payload\}/);

  // The routing table is bound to C1's own registry: a kind added there and
  // not routed here is a failure, not a silent gap.
  assert.deepEqual([...RECEIPT_KINDS].sort(), [...receipts.RECORD_KINDS, 'envelope'].sort());
});

test('persistReceipt adds no validation of its own — the writer refuses a malformed payload', () => {
  const treeRoot = makeTree();

  assert.throws(
    () => persistReceipt(treeRoot, 'implementation', { kind: 'dispatch', payload: dispatchPayload({ seat: 42 }) }),
    /receipts:/
  );
  // A terminal with no dispatch is refused by C1's correlation law, reached
  // through this facade exactly as it would be reached directly.
  assert.throws(
    () =>
      persistReceipt(treeRoot, 'implementation', {
        kind: 'dispatch-terminal',
        payload: {
          dispatch_id: 'nope',
          status: 'ok',
          builder: null,
          transport_ref: { task_ref: 't' },
          model_id: 'opus-5',
          result_digest: `sha256:${'a'.repeat(64)}`,
        },
      }),
    /receipts:/
  );
  assert.deepEqual(readRecords(ledgerPathOf(treeRoot)).records, []);
});

test('persistReceipt replayed with an identical payload returns the existing receipt', () => {
  const treeRoot = makeTree();
  const receipt = { kind: 'dispatch', payload: dispatchPayload() };

  const first = persistReceipt(treeRoot, 'implementation', receipt);
  const second = persistReceipt(treeRoot, 'implementation', receipt);

  assert.deepEqual(second, first);
  assert.equal(readRecords(ledgerPathOf(treeRoot)).records.length, 1);
});

test('persistReceipt replayed in a FRESH NODE PROCESS returns the existing receipt and appends nothing', () => {
  const treeRoot = makeTree();
  const receipt = { kind: 'dispatch', payload: dispatchPayload() };
  const first = persistReceipt(treeRoot, 'implementation', receipt);

  const replayed = replayInFreshProcess('persistReceipt', [treeRoot, 'implementation', receipt]);

  assert.deepEqual(replayed, first);
  assert.equal(readRecords(ledgerPathOf(treeRoot)).records.length, 1);
});

test('persistReceipt refuses a conflicting duplicate through the writer it routes to', () => {
  const treeRoot = makeTree();
  persistReceipt(treeRoot, 'implementation', { kind: 'dispatch', payload: dispatchPayload() });

  assert.throws(
    () =>
      persistReceipt(treeRoot, 'implementation', {
        kind: 'dispatch',
        payload: dispatchPayload({ seat: 'reviewer' }),
      }),
    /refusing to write a conflicting duplicate/
  );
  assert.equal(readRecords(ledgerPathOf(treeRoot)).records.length, 1);
});

// ---------- invoke ----------

// The table is an inventory, not an index: every name in it is a decision to
// let a workflow reach one already-owned operation, and this list is where
// that decision is visible. A new op that is not added here fails.
test('the op table is exactly the operations workflows may reach, and nothing else', () => {
  assert.deepEqual(OP_NAMES, [
    'receipts.writeDispatch',
    'receipts.writeDispatchTerminal',
    'receipts.writeWorkflowReturn',
    'receipts.writeHoldOpen',
    'receipts.writeHoldResolve',
    'receipts.writeDegradedRoute',
    'receipts.writeEnvelope',
    'spine.nextTransition',
    'milestones.recordChunk',
    'views.regenerate',
    'familyEvidence.recordBuilt',
    'familyEvidence.selectReviewer',
    'familyEvidence.selectMilestoneReviewer',
    'dispatch.dispatchNative',
    'dispatch.completeNative',
    'dispatch.recoverDispatches',
    'capsule.openCapsule',
    'capsule.exportDiff',
    'capsule.applyToStaging',
    'capsule.discardStaging',
    'capsule.syncWorktreeToHead',
    'capsule.closeCapsule',
    'implementation.stagedDiffDigest',
    'promotion.stagedPathFor',
    'phases.advance',
    'receipts.writeSteerApply',
    'toolchain.probeSatisfied',
    'toolchain.scaffoldProfile',
    'toolchain.composeInstall',
    'toolchain.composeSuite',
    'checkHonesty.runGate',
    'checkHonesty.runStagedGate',
    'journeys.recordAuthored',
    'verification.recordChunkAffected',
    'promotion.promoteArtifact',
    'implementation.openMilestoneTxn',
    'implementation.sealChunk',
    'implementation.closeMilestoneTxn',
    'architectureTxn.stageArtifacts',
    'architectureTxn.promoteStaged',
    'architectureTxn.reopenThroughTxn',
  ]);
});

test('invoke refuses an op the table does not name', () => {
  const treeRoot = makeTree();

  assert.throws(() => invoke(treeRoot, 'fs.unlink', [treeRoot]), /unknown op "fs\.unlink"/);
  assert.throws(() => invoke(treeRoot, 'receipts.resolveRef', ['x']), /unknown op "receipts\.resolveRef"/);
  // A real machine function that is deliberately NOT in the table stays out
  // of reach: the table is the boundary, not a convenience index.
  assert.throws(() => invoke(treeRoot, 'phases.reopenPhase', [treeRoot]), /unknown op "phases\.reopenPhase"/);
  assert.throws(() => invoke(treeRoot, 'capsule.capsulePathsOf', [treeRoot]), /unknown op "capsule\.capsulePathsOf"/);
  assert.throws(() => invoke(treeRoot, 'receipts.writeDispatch', 'not-an-array'), /requires an args array/);
});

test('invoke returns the receipt read back off DISK, not the one the op was holding', () => {
  const treeRoot = makeTree();

  const result = invoke(treeRoot, 'receipts.writeDispatch', [treeRoot, dispatchPayload()]);

  assert.equal(result.ref, 'ledger:0');
  assert.deepEqual(result.record, receipts.resolveRef(treeRoot, 'ledger:0'));
  assert.deepEqual(result.record, readRecords(ledgerPathOf(treeRoot)).records[0]);
});

test('invoke resolves an envelope receipt off disk too', () => {
  const treeRoot = makeTree();
  const envelope = {
    state: 'blocked',
    result: 'stopped at the gate',
    evidence: 'no approval record',
    risks: 'none',
    artifact: '',
    question: 'which milestone closes first?',
  };

  const result = invoke(treeRoot, 'receipts.writeEnvelope', [treeRoot, 'implementation', 'd1', envelope]);

  assert.equal(result.ref, 'envelope:implementation/d1');
  assert.deepEqual(result.envelope, envelope);
  assert.deepEqual(result.envelope, receipts.resolveRef(treeRoot, 'envelope:implementation/d1'));
});

test('invoke drives a C3 transaction and hands back its own read-back receipt', () => {
  const treeRoot = makeTree();
  const archDir = path.join(treeRoot, 'architecture');
  fs.mkdirSync(archDir, { recursive: true });

  const staged = invoke(treeRoot, 'architectureTxn.stageArtifacts', [archDir, artifactSet()]);
  assert.equal(staged.revision, 1);
  assert.deepEqual(staged.manifest, readJson(path.join(revisionDirOf(archDir, 1), 'manifest.json'), null));

  const promoted = invoke(treeRoot, 'architectureTxn.promoteStaged', [archDir, 1, staged.artifacts_digest]);
  assert.equal(promoted.revision, 1);
  assert.deepEqual(promoted.marker, readJson(path.join(archDir, 'revision.json'), null));
});

test('invoke passes an op its own arguments unchanged, so the op refuses what it would refuse directly', () => {
  const treeRoot = makeTree();
  const archDir = path.join(treeRoot, 'architecture');
  fs.mkdirSync(archDir, { recursive: true });
  invoke(treeRoot, 'architectureTxn.stageArtifacts', [archDir, artifactSet()]);

  // The facade reshapes nothing: promoteStaged's own payload binding is what
  // answers here, in its own words.
  assert.throws(
    () => invoke(treeRoot, 'architectureTxn.promoteStaged', [archDir, 1, `sha256:${'f'.repeat(64)}`]),
    /refusing to promote a payload other than the one staged/
  );
});

test('invoke refuses to verify one tree against an operation aimed at another', () => {
  const treeA = makeTree();
  const treeB = makeTree();

  // The verification root and the operation's own target must be the same
  // tree. Left unbound, this call writes into A and looks for the receipt in
  // B — a mismatch that would either fail confusingly or, worse, resolve
  // against some unrelated record that happened to share a seq.
  assert.throws(
    () => invoke(treeB, 'receipts.writeDispatch', [treeA, dispatchPayload()]),
    /operates on .* but this invocation would verify against/
  );
  assert.deepEqual(readRecords(ledgerPathOf(treeA)).records, []);
  assert.deepEqual(readRecords(ledgerPathOf(treeB)).records, []);
});

test('invoke fails an operation that left no durable record, however it returned', () => {
  const treeRoot = makeTree();

  // The one way to produce "the op wrote nothing" for an op that always
  // writes: drop the append underneath it. In a child process, so the patch
  // touches nothing else. receipts.js still hands back a ref; nothing is
  // behind it, and that is what invoke must catch.
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-notrace-'));
  const scriptPath = path.join(scriptDir, 'notrace.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const realAppend = fs.appendFileSync;\n` +
      `fs.appendFileSync = (file, ...rest) => {\n` +
      `  if (String(file).endsWith('ledger.jsonl')) return undefined;\n` +
      `  return realAppend(file, ...rest);\n` +
      `};\n` +
      `const wf = require(${JSON.stringify(MODULE_PATH)});\n` +
      `try {\n` +
      `  wf.invoke(${JSON.stringify(treeRoot)}, 'receipts.writeDispatch', [${JSON.stringify(
        treeRoot
      )}, ${JSON.stringify(dispatchPayload())}]);\n` +
      `  process.stdout.write('NO-THROW');\n` +
      `} catch (err) {\n` +
      `  process.stdout.write(err.message);\n` +
      `}\n`
  );
  const out = execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' });

  assert.match(out, /resolves to nothing/);
  assert.match(out, /left no durable record did not succeed/);
});

test('invoke re-reads stageArtifacts\' manifest from disk, and fails when it is not there', () => {
  const treeRoot = makeTree();
  const archDir = path.join(treeRoot, 'architecture');
  fs.mkdirSync(archDir, { recursive: true });

  // stageArtifacts returns writeManifest's in-memory object on its new-write
  // path — it never rereads it — so the read-back this facade promises has to
  // happen here. Provenance is proved the only way it can be: with the
  // manifest write dropped underneath, the op still returns a manifest and
  // invoke must still fail.
  // Equal content proves nothing about provenance, so the file on disk is made
  // to differ from the object the op returns: the write lands, and then a
  // marker is added to the file the op will never look at again. A receipt
  // carrying that marker can only have come from disk.
  const treeTwo = makeTree();
  const archTwo = path.join(treeTwo, 'architecture');
  fs.mkdirSync(archTwo, { recursive: true });
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-provenance-'));
  const scriptPath = path.join(scriptDir, 'provenance.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const realRename = fs.renameSync;\n` +
      `fs.renameSync = (from, to, ...rest) => {\n` +
      `  const out = realRename(from, to, ...rest);\n` +
      `  if (String(to).endsWith('manifest.json')) {\n` +
      `    const onDisk = JSON.parse(fs.readFileSync(to, 'utf8'));\n` +
      `    onDisk.came_from_disk = true;\n` +
      `    fs.writeFileSync(to, JSON.stringify(onDisk, null, 2));\n` +
      `  }\n` +
      `  return out;\n` +
      `};\n` +
      `const wf = require(${JSON.stringify(MODULE_PATH)});\n` +
      `const fx = require(${JSON.stringify(path.resolve(__dirname, 'fixtures', 'valid-architecture-artifacts.js'))});\n` +
      `const files = {\n` +
      `  'plan.md': fx.VALID_PLAN_MD,\n` +
      `  'criteria-register.json': fx.validCriteriaRegister(),\n` +
      `  'milestones.json': fx.validMilestones(),\n` +
      `  'artifact-map.json': fx.validArtifactMap(),\n` +
      `  'protocol-record.md': fx.VALID_PROTOCOL_RECORD_MD,\n` +
      `};\n` +
      `const receipt = wf.invoke(${JSON.stringify(treeTwo)}, 'architectureTxn.stageArtifacts', [${JSON.stringify(
        archTwo
      )}, files]);\n` +
      `process.stdout.write(JSON.stringify(receipt.manifest.came_from_disk === true));\n`
  );
  assert.equal(execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' }), 'true');
});

test('the reread fails closed when the manifest is gone or changed between the op and the read', () => {
  // The operation digests the manifest and returns; this facade reads the same
  // file again afterwards. Two reads, so the file can change in between — the
  // read must fail closed rather than hand back a receipt carrying null, or
  // one carrying a manifest that is not the payload the operation returned.
  const sabotage = (label, mutate) => {
    const treeRoot = makeTree();
    const archDir = path.join(treeRoot, 'architecture');
    fs.mkdirSync(archDir, { recursive: true });
    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), `workflow-${label}-`));
    const scriptPath = path.join(scriptDir, 'sabotage.js');
    fs.writeFileSync(
      scriptPath,
      `'use strict';\n` +
        `const fs = require('node:fs');\n` +
        `const realRead = fs.readFileSync;\n` +
        `let sabotaged = false;\n` +
        `fs.readFileSync = (file, ...rest) => {\n` +
        `  const out = realRead(file, ...rest);\n` +
        // The operation's own digest read is the last time it looks at this
        // file; everything after it belongs to the facade.
        `  if (!sabotaged && String(file).endsWith('manifest.json')) {\n` +
        `    sabotaged = true;\n` +
        `    ${mutate}\n` +
        `  }\n` +
        `  return out;\n` +
        `};\n` +
        `const wf = require(${JSON.stringify(MODULE_PATH)});\n` +
        `const fx = require(${JSON.stringify(path.resolve(__dirname, 'fixtures', 'valid-architecture-artifacts.js'))});\n` +
        `const files = {\n` +
        `  'plan.md': fx.VALID_PLAN_MD,\n` +
        `  'criteria-register.json': fx.validCriteriaRegister(),\n` +
        `  'milestones.json': fx.validMilestones(),\n` +
        `  'artifact-map.json': fx.validArtifactMap(),\n` +
        `  'protocol-record.md': fx.VALID_PROTOCOL_RECORD_MD,\n` +
        `};\n` +
        `try {\n` +
        `  const r = wf.invoke(${JSON.stringify(treeRoot)}, 'architectureTxn.stageArtifacts', [${JSON.stringify(
          archDir
        )}, files]);\n` +
        `  process.stdout.write('RETURNED:' + JSON.stringify(r.manifest));\n` +
        `} catch (err) {\n` +
        `  process.stdout.write('THREW:' + err.message);\n` +
        `}\n`
    );
    return execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  };

  // Gone: a receipt carrying {manifest: null} would be a success that vouches
  // for nothing at all.
  const removed = sabotage('gone', 'fs.unlinkSync(file);');
  assert.match(removed, /^THREW:/);
  assert.match(removed, /is not the payload it returned/);

  // Changed: still well-formed JSON, still a manifest, but no longer the set
  // the operation verified and digested.
  const replaced = sabotage(
    'changed',
    `const m = JSON.parse(realRead(file, 'utf8'));\n` +
      `        m.artifacts = m.artifacts.filter((e) => e.path !== 'milestones.json');\n` +
      `        fs.writeFileSync(file, JSON.stringify(m, null, 2));`
  );
  assert.match(replaced, /^THREW:/);
  assert.match(replaced, /is not the payload it returned/);
});

test('an invocation whose durable write never landed fails, rather than returning a receipt', () => {
  const treeRoot = makeTree();
  const archDir = path.join(treeRoot, 'architecture');
  fs.mkdirSync(archDir, { recursive: true });

  // The manifest write dropped underneath the operation. It refuses in its own
  // words — the file it must digest is not there — and the invocation fails
  // with it. What must not happen is a receipt coming back.
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-nomanifest-'));
  const scriptPath = path.join(scriptDir, 'nomanifest.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const realRename = fs.renameSync;\n` +
      `fs.renameSync = (from, to, ...rest) => {\n` +
      `  if (String(to).endsWith('manifest.json')) return undefined;\n` +
      `  return realRename(from, to, ...rest);\n` +
      `};\n` +
      `const wf = require(${JSON.stringify(MODULE_PATH)});\n` +
      `const fx = require(${JSON.stringify(path.resolve(__dirname, 'fixtures', 'valid-architecture-artifacts.js'))});\n` +
      `const files = {\n` +
      `  'plan.md': fx.VALID_PLAN_MD,\n` +
      `  'criteria-register.json': fx.validCriteriaRegister(),\n` +
      `  'milestones.json': fx.validMilestones(),\n` +
      `  'artifact-map.json': fx.validArtifactMap(),\n` +
      `  'protocol-record.md': fx.VALID_PROTOCOL_RECORD_MD,\n` +
      `};\n` +
      `try {\n` +
      `  wf.invoke(${JSON.stringify(treeRoot)}, 'architectureTxn.stageArtifacts', [${JSON.stringify(
        archDir
      )}, files]);\n` +
      `  process.stdout.write('NO-THROW');\n` +
      `} catch (err) {\n` +
      `  process.stdout.write('THREW');\n` +
      `}\n`
  );

  assert.equal(execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' }), 'THREW');
  assert.equal(fs.existsSync(path.join(revisionDirOf(archDir, 1), 'manifest.json')), false);
});

test('invoke leaves the re-entry law where it lives: a replayed op returns its existing receipt', () => {
  const treeRoot = makeTree();
  const payload = dispatchPayload();

  const first = invoke(treeRoot, 'receipts.writeDispatch', [treeRoot, payload]);
  const second = invoke(treeRoot, 'receipts.writeDispatch', [treeRoot, payload]);

  assert.deepEqual(second, first);
  assert.equal(readRecords(ledgerPathOf(treeRoot)).records.length, 1);
});

// ---------- the stdin CLI ----------

// The Workflow runtime has no filesystem, so every machine operation reaches
// the tree through an agent that runs one command. That agent is a model, and
// a model asked to interpolate canonical values into shell quotes is one
// apostrophe away from a broken command or an executed one. The payload
// therefore never becomes shell TEXT: it arrives on stdin, and the CLI has no
// argv path at all, so there is no quoting decision left to get wrong.
const CLI_PATH = path.join(__dirname, '..', 'src', 'workflow.js');

function runCli(payload, { onArgv = false } = {}) {
  const args = onArgv ? [CLI_PATH, JSON.stringify(payload)] : [CLI_PATH];
  const result = spawnSync(process.execPath, args, {
    input: onArgv ? '' : JSON.stringify(payload),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('the CLI reads its payload from stdin and answers {ok, result}', () => {
  const treeRoot = makeTree();

  const run = runCli({ treeRoot, op: 'receipts.writeDispatch', args: [treeRoot, dispatchPayload()] });

  assert.equal(run.status, 0);
  const answer = JSON.parse(run.stdout);
  assert.equal(answer.ok, true);
  assert.match(answer.result.ref, /^ledger:\d+$/);
});

// The hazard the heredoc closes, driven with the values that would break a
// quoted shell word. A single-quoted argument cannot carry an apostrophe at
// all, and `$(...)`/backticks would be EXECUTED in a double-quoted one.
test('canonical values that would break or escape shell quoting survive intact', () => {
  const treeRoot = makeTree();
  const hostile = "it's $(touch /tmp/pwned) `id` \"quoted\" \\ end";

  const run = runCli({
    treeRoot,
    op: 'receipts.writeHoldOpen',
    args: [treeRoot, { hold_id: 'H1', severity: 'S2', summary: hostile, origin_ref: 'spec.md:1' }],
  });

  assert.equal(run.status, 0);
  const answer = JSON.parse(run.stdout);
  assert.equal(answer.ok, true);
  assert.equal(answer.result.record.summary, hostile);
  assert.equal(fs.existsSync('/tmp/pwned'), false);
});

// If a payload could also arrive on argv, the quoting hazard would still be
// reachable — a fence with a way around it is not a fence.
test('there is no argv payload path: the CLI still reads stdin, and refuses an empty one', () => {
  const treeRoot = makeTree();

  const run = runCli({ treeRoot, op: 'receipts.writeDispatch', args: [treeRoot, dispatchPayload()] }, { onArgv: true });

  assert.equal(run.status, 1);
  const answer = JSON.parse(run.stdout);
  assert.equal(answer.ok, false);
  // The refusal has to be the EMPTY-STDIN one specifically. "not JSON" would
  // also mention stdin and would also refuse, so a laxer assertion cannot tell
  // the guard from the parse failure behind it.
  assert.match(answer.result, /there is no argument form/);
  assert.equal(readRecords(ledgerPathOf(treeRoot)).records.length, 0);
});

test('a refusal is data, not a crash: {ok:false} with the error verbatim and a non-zero exit', () => {
  const treeRoot = makeTree();

  const run = runCli({ treeRoot, op: 'nope.notAnOp', args: [treeRoot] });

  assert.equal(run.status, 1);
  const answer = JSON.parse(run.stdout);
  assert.equal(answer.ok, false);
  assert.match(answer.result, /unknown op "nope\.notAnOp"/);
});

// Each of these refuses for its OWN stated reason. Every one of them would
// also be refused a step or two later — an array has no `op`, a payload with
// no `op` reaches `invoke` as an unknown one — so asserting only "it was
// refused" proves nothing about the guard that named it. `null` is the case
// that binds the shape check on its own account: without it, the next line
// reads a property off `null` and the named refusal becomes a raw TypeError.
test('a payload that is not an object, or names no op, is refused by name', () => {
  const treeRoot = makeTree();
  const cases = [
    [[], /must be a \{treeRoot, op, args\} object/],
    ['string', /must be a \{treeRoot, op, args\} object/],
    [42, /must be a \{treeRoot, op, args\} object/],
    [null, /must be a \{treeRoot, op, args\} object/],
    [{ treeRoot }, /requires a non-empty "op"/],
    [{ treeRoot, op: '' }, /requires a non-empty "op"/],
  ];

  for (const [bad, expected] of cases) {
    const run = runCli(bad);
    assert.equal(run.status, 1, `${JSON.stringify(bad)} was not refused`);
    const answer = JSON.parse(run.stdout);
    assert.equal(answer.ok, false);
    assert.match(answer.result, expected, `${JSON.stringify(bad)} was refused for the wrong reason`);
  }
  assert.equal(fs.existsSync(path.join(treeRoot, 'views')), false);
});
