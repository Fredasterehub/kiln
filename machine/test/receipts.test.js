'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync, spawn } = require('node:child_process');

const {
  RECORD_KINDS,
  recordProblem,
  writeDispatch,
  writeDispatchTerminal,
  writeWorkflowReturn,
  writeHoldOpen,
  writeHoldResolve,
  writeDegradedRoute,
  writeMindOpen,
  writeMindRetire,
  supersedeMind,
  writeSteerRaise,
  writeSteerApply,
  writeEnvelope,
  resolveRef,
} = require('../src/receipts.js');
const { readRecords } = require('../src/stream.js');
const { LOCK_SUFFIX, LOCK_STALE_MS, LOCK_TIMEOUT_CODE } = require('../src/jsonl.js');
const { readJson } = require('../src/atomic-json.js');

function makeTreeRoot() {
  // receipts.js only ever touches <treeRoot>/ledger.jsonl and
  // <treeRoot>/envelopes/... — a bare directory stands in for a scaffolded
  // .kiln tree here, the same narrow-fixture discipline milestones.test.js
  // applies.
  return fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-test-'));
}

function ledgerRecords(treeRoot) {
  return readRecords(path.join(treeRoot, 'ledger.jsonl')).records;
}

const MODULE_PATH = path.join(__dirname, '..', 'src', 'receipts.js');

// Same fresh-process discipline architecture-txn.test.js established: a real
// new Node process, no module cache and no closure over the first call — the
// only honest way to test the re-entry law the header states.
function replayInFreshProcess(fnName, args) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-replay-'));
  const scriptPath = path.join(scriptDir, 'replay.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const mod = require(${JSON.stringify(MODULE_PATH)});\n` +
      `const { fn, args } = JSON.parse(process.argv[2]);\n` +
      `process.stdout.write(JSON.stringify(mod[fn](...args)));\n`
  );
  return JSON.parse(
    execFileSync(process.execPath, [scriptPath, JSON.stringify({ fn: fnName, args })], { encoding: 'utf8' })
  );
}

const STREAM_PATH = path.join(__dirname, '..', 'src', 'stream.js');

// A supersede killed between its two appends, deterministically rather than
// by racing a timer: the child replaces stream.js's appendRecord BEFORE
// receipts.js is loaded (which destructures it at require time), so the first
// durable append is followed immediately by SIGKILL — inside the lock hold,
// with the retire already on disk and the open not yet attempted.
function killMidSupersede(treeRoot, retirePayload, openPayload) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-kill-'));
  const scriptPath = path.join(scriptDir, 'kill-mid.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const stream = require(${JSON.stringify(STREAM_PATH)});\n` +
      `const real = stream.appendRecord;\n` +
      `stream.appendRecord = function (...args) {\n` +
      `  const seq = real(...args);\n` +
      `  process.kill(process.pid, 'SIGKILL');\n` +
      `  return seq;\n` +
      `};\n` +
      `const { supersedeMind } = require(${JSON.stringify(MODULE_PATH)});\n` +
      `const { treeRoot, retire, open } = JSON.parse(process.argv[2]);\n` +
      `supersedeMind(treeRoot, retire, open);\n`
  );
  return spawnSync(
    process.execPath,
    [scriptPath, JSON.stringify({ treeRoot, retire: retirePayload, open: openPayload })],
    { encoding: 'utf8' }
  );
}

// The discriminating interception for "one hold, not two": the child pauses
// the instant the lifecycle lock is RELEASED. Pausing between the two appends
// would not distinguish anything — under two separate acquisitions that pause
// still sits inside the first hold. The release is the only moment the two
// shapes differ: one hold releases once, with the sequence finished; two
// releases expose the gap where the seat is empty.
function pauseAtLifecycleLockRelease(treeRoot, retirePayload, openPayload, signalPath, pauseMs) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-pause-'));
  const scriptPath = path.join(scriptDir, 'pause-mid.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const jsonl = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'jsonl.js'))});\n` +
      `const realWithLock = jsonl.withLock;\n` +
      `const { treeRoot, retire, open, signalPath, pauseMs } = JSON.parse(process.argv[2]);\n` +
      `let released = 0;\n` +
      `jsonl.withLock = function (file, fn) {\n` +
      `  const out = realWithLock(file, fn);\n` +
      `  if (String(file).endsWith('receipts') && ++released === 1) {\n` +
      `    fs.writeFileSync(signalPath, 'released');\n` +
      `    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs);\n` +
      `  }\n` +
      `  return out;\n` +
      `};\n` +
      `const { supersedeMind } = require(${JSON.stringify(MODULE_PATH)});\n` +
      `supersedeMind(treeRoot, retire, open);\n`
  );
  return spawn(
    process.execPath,
    [scriptPath, JSON.stringify({ treeRoot, retire: retirePayload, open: openPayload, signalPath, pauseMs })],
    { stdio: 'ignore' }
  );
}

function ofKind(treeRoot, kind) {
  return ledgerRecords(treeRoot).filter((record) => record.kind === kind);
}

// Wait for a child to reach its instrumented window — and never wait forever.
// A child that dies before signalling is a real outcome (it means the code
// under test refused earlier than the test expected), and it has to surface as
// a failing assertion rather than as a suite that hangs: a mutation that is
// caught by a hang is indistinguishable from one that is not caught at all.
async function waitForWindow(signalPath, child, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(signalPath)) {
    assert.equal(child.exitCode, null, 'the child exited before reaching its window');
    assert.ok(Date.now() < deadline, 'timed out waiting for the child to reach its window');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ---------- record builders ----------

function codexTransportRef(overrides) {
  return Object.assign({ pid: 4242, pgid: 4242, session: 'sess-abc' }, overrides);
}

function dispatchPayload(dispatchId, overrides) {
  return Object.assign(
    {
      dispatch_id: dispatchId,
      seat: 'implementer',
      transport: 'codex',
      intended_family: 'gpt',
      task_class: 'chunk_implementation',
      prompt_ref: 'briefs/C1.md',
      transport_ref: codexTransportRef(),
    },
    overrides
  );
}

const A_DIGEST = `sha256:${'a'.repeat(64)}`;
const ANOTHER_DIGEST = `sha256:${'b'.repeat(64)}`;

function terminalPayload(dispatchId, overrides) {
  return Object.assign(
    {
      dispatch_id: dispatchId,
      status: 'ok',
      builder: 'sol',
      transport_ref: codexTransportRef(),
      result_ref: 'envelopes/implementation/D1.json',
      model_id: 'gpt-5.6-sol',
      result_digest: A_DIGEST,
    },
    overrides
  );
}

// A failed terminal carries no evidence of a result, because there was none.
function failedTerminalPayload(dispatchId, overrides) {
  return Object.assign(
    {
      dispatch_id: dispatchId,
      status: 'failed',
      builder: null,
      transport_ref: codexTransportRef(),
      reason: 'error',
    },
    overrides
  );
}

function workflowReturnPayload(recordRef, overrides) {
  return Object.assign(
    {
      workflow: 'dev-chunk-cycle',
      run_ref: 'run-1',
      return: 'phase_complete',
      record_ref: recordRef,
    },
    overrides
  );
}

function holdOpenPayload(holdId, overrides) {
  return Object.assign(
    {
      hold_id: holdId,
      severity: 'S2',
      summary: 'codex transport unavailable mid-build',
      origin_ref: 'ledger:0',
    },
    overrides
  );
}

function holdResolvePayload(holdId, overrides) {
  return Object.assign(
    { hold_id: holdId, exit: 'resolved', resolution_ref: 'ledger:1' },
    overrides
  );
}

function degradedRoutePayload(routeId, overrides) {
  return Object.assign(
    {
      route_id: routeId,
      expected: 'sol',
      actual: 'claude-fallback',
      reason: 'codex unresponsive',
      scope_ref: 'milestones/M1',
    },
    overrides
  );
}

// A mind is identified by the pair, never by its name alone: two scopes can
// each seat a mind of the same name, and their generations count separately.
const MIND = 'designer';
const SCOPE = 'milestones/M1';

function mindOpenPayload(generation, overrides) {
  return Object.assign(
    {
      mind: MIND,
      scope: SCOPE,
      session: 'sess-mind-1',
      handle: 'agent-7f3',
      generation,
    },
    overrides
  );
}

function mindRetirePayload(generation, overrides) {
  return Object.assign({ mind: MIND, scope: SCOPE, reason: 'close', generation }, overrides);
}

function envelopeDoc(overrides) {
  return Object.assign(
    {
      state: 'done',
      result: 'chunk implemented',
      evidence: 'suite green',
      risks: 'none',
      artifact: 'machine/src/receipts.js',
      question: 'none',
    },
    overrides
  );
}

// A dispatch already on the ledger, so terminal/hold/return tests can start
// from a tree whose correlation preconditions are already satisfied.
function withDispatch(treeRoot, dispatchId) {
  return writeDispatch(treeRoot, dispatchPayload(dispatchId));
}

// ---------- recordProblem: the one contract, accept side ----------

test('recordProblem accepts a well-formed record of every kind', () => {
  assert.deepEqual(RECORD_KINDS, [
    'dispatch',
    'dispatch-terminal',
    'workflow-return',
    'hold-open',
    'hold-resolve',
    'degraded-route',
    'steer-raise',
    'steer-apply',
    'mind-open',
    'mind-retire',
  ]);
  assert.equal(recordProblem('dispatch', dispatchPayload('D1')), null);
  assert.equal(recordProblem('dispatch-terminal', terminalPayload('D1')), null);
  assert.equal(recordProblem('workflow-return', workflowReturnPayload('ledger:0')), null);
  assert.equal(recordProblem('hold-open', holdOpenPayload('H1')), null);
  assert.equal(recordProblem('hold-resolve', holdResolvePayload('H1')), null);
  assert.equal(recordProblem('degraded-route', degradedRoutePayload('R1')), null);
  assert.equal(recordProblem('mind-open', mindOpenPayload(1)), null);
  assert.equal(recordProblem('mind-retire', mindRetirePayload(1)), null);
});

test('recordProblem accepts a dispatch on the native transport with a task_ref transport_ref', () => {
  const payload = dispatchPayload('D1', { transport: 'native', transport_ref: { task_ref: 'task-7' } });
  assert.equal(recordProblem('dispatch', payload), null);
});

test('recordProblem accepts a failed terminal carrying reason "timeout" and a null builder', () => {
  const payload = failedTerminalPayload('D1', { reason: 'timeout' });
  delete payload.result_ref;
  assert.equal(recordProblem('dispatch-terminal', payload), null);
});

test('recordProblem refuses a terminal that claims both ok and reason "timeout"', () => {
  const payload = terminalPayload('D1', { status: 'ok', reason: 'timeout' });
  assert.match(recordProblem('dispatch-terminal', payload), /must carry status "failed"/);
});

test('writeDispatchTerminal refuses to append a terminal that is ok with reason timeout', () => {
  const treeRoot = makeTreeRoot();
  withDispatch(treeRoot, 'D1');
  assert.throws(
    () => writeDispatchTerminal(treeRoot, terminalPayload('D1', { status: 'ok', reason: 'timeout' })),
    /must carry status "failed"/
  );
  assert.equal(ofKind(treeRoot, 'dispatch-terminal').length, 0);
});

test('recordProblem accepts an envelope ref as a workflow-return record_ref', () => {
  assert.equal(
    recordProblem('workflow-return', workflowReturnPayload('envelope:implementation/D1')),
    null
  );
});

// ---------- recordProblem: the reject side ----------

test('recordProblem refuses an unknown kind', () => {
  assert.match(recordProblem('chunk-green', { chunk_id: 'C1' }), /kind must be one of/);
  assert.match(recordProblem(undefined, {}), /kind must be one of/);
});

// The schema as the spec states it, restated here so the suite asserts the
// contract rather than whatever receipts.js happens to enforce: every field
// below is REQUIRED for its kind, and every field named optional is not.
// Dropping any one of these from KIND_SPECS must turn the suite red.
const REQUIRED_FIELDS = {
  dispatch: [
    'dispatch_id',
    'seat',
    'transport',
    'intended_family',
    'task_class',
    'prompt_ref',
    'transport_ref',
  ],
  'dispatch-terminal': ['dispatch_id', 'status', 'builder', 'transport_ref'],
  'workflow-return': ['workflow', 'run_ref', 'return', 'record_ref'],
  'hold-open': ['hold_id', 'severity', 'summary', 'origin_ref'],
  'hold-resolve': ['hold_id', 'exit', 'resolution_ref'],
  'degraded-route': ['route_id', 'expected', 'actual', 'reason', 'scope_ref'],
  'steer-raise': ['steer_id', 'scope', 'instruction', 'origin'],
  'steer-apply': ['steer_id', 'exit', 'resolution_ref'],
  // session AND handle both, verbatim from the sealed schema: the session is
  // what a transport can be resumed through, the handle is what this machine
  // addresses the seated mind by, and neither substitutes for the other.
  'mind-open': ['mind', 'scope', 'session', 'handle', 'generation'],
  'mind-retire': ['mind', 'scope', 'reason', 'generation'],
};

const OPTIONAL_FIELDS = {
  dispatch: [],
  // model_id and result_digest are not listed here: they are not optional, they
  // are CONDITIONAL — required on an ok terminal, forbidden on a failed one —
  // and that law has tests of its own below.
  'dispatch-terminal': ['reason', 'result_ref'],
  'workflow-return': [],
  'hold-open': [],
  'hold-resolve': [],
  'degraded-route': [],
  'steer-raise': [],
  'steer-apply': [],
  'mind-open': [],
  'mind-retire': [],
};

// A fresh, well-formed payload of any kind, so a table-driven test can mutate
// one field per iteration without sharing state across iterations.
function freshPayload(kind) {
  switch (kind) {
    case 'dispatch':
      return dispatchPayload('D1');
    case 'dispatch-terminal':
      // Carries both optional fields, so dropping either one is a real drop.
      return failedTerminalPayload('D1', { result_ref: 'envelopes/implementation/D1.json' });
    case 'workflow-return':
      return workflowReturnPayload('ledger:0');
    case 'hold-open':
      return holdOpenPayload('H1');
    case 'hold-resolve':
      return holdResolvePayload('H1');
    case 'degraded-route':
      return degradedRoutePayload('R1');
    case 'steer-raise':
      return steerRaisePayload('S1');
    case 'steer-apply':
      return steerApplyPayload('S1');
    case 'mind-open':
      return mindOpenPayload(1);
    case 'mind-retire':
      return mindRetirePayload(1);
    default:
      throw new Error(`no builder for kind ${kind}`);
  }
}

test('recordProblem refuses EVERY missing required field, per kind', () => {
  for (const kind of RECORD_KINDS) {
    for (const field of REQUIRED_FIELDS[kind]) {
      const payload = freshPayload(kind);
      assert.equal(recordProblem(kind, payload), null, `${kind} fixture must start well-formed`);
      delete payload[field];
      assert.match(
        recordProblem(kind, payload),
        new RegExp(`missing required field "${field}"`),
        `${kind} must refuse a missing ${field}`
      );
    }
  }
});

test('recordProblem accepts a payload missing any optional field, per kind', () => {
  for (const kind of RECORD_KINDS) {
    for (const field of OPTIONAL_FIELDS[kind]) {
      const payload = freshPayload(kind);
      delete payload[field];
      assert.equal(
        recordProblem(kind, payload),
        null,
        `${kind} must accept a payload with no ${field}`
      );
    }
  }
});

test('recordProblem refuses an unexpected field (no silent extras), per kind', () => {
  const cases = [
    ['dispatch', dispatchPayload('D1')],
    ['dispatch-terminal', terminalPayload('D1')],
    ['workflow-return', workflowReturnPayload('ledger:0')],
    ['hold-open', holdOpenPayload('H1')],
    ['hold-resolve', holdResolvePayload('H1')],
    ['degraded-route', degradedRoutePayload('R1')],
    ['steer-raise', steerRaisePayload('S1')],
    ['steer-apply', steerApplyPayload('S1')],
    ['mind-open', mindOpenPayload(1)],
    ['mind-retire', mindRetirePayload(1)],
  ];
  for (const [kind, payload] of cases) {
    assert.match(
      recordProblem(kind, Object.assign({}, payload, { codex_session: 'sess-abc' })),
      /unexpected field "codex_session"/,
      `${kind} must refuse an extra field`
    );
  }
});

test('recordProblem refuses a value outside a closed enum, per enum field', () => {
  assert.match(recordProblem('dispatch', dispatchPayload('D1', { transport: 'ssh' })), /"transport"/);
  assert.match(
    recordProblem('dispatch-terminal', terminalPayload('D1', { status: 'timeout' })),
    /"status"/
  );
  assert.match(
    recordProblem('dispatch-terminal', terminalPayload('D1', { builder: 'fable' })),
    /"builder"/
  );
  assert.match(
    recordProblem('workflow-return', workflowReturnPayload('ledger:0', { return: 'done' })),
    /"return"/
  );
  assert.match(recordProblem('hold-open', holdOpenPayload('H1', { severity: 'S1' })), /"severity"/);
  assert.match(recordProblem('hold-resolve', holdResolvePayload('H1', { exit: 'dropped' })), /"exit"/);
  assert.match(recordProblem('mind-retire', mindRetirePayload(1, { reason: 'gone' })), /"reason"/);
});

test('recordProblem refuses a transport_ref outside the two lawful shapes', () => {
  assert.match(
    recordProblem('dispatch', dispatchPayload('D1', { transport_ref: { pid: 1, pgid: 1 } })),
    /"transport_ref"/
  );
  assert.match(
    recordProblem('dispatch', dispatchPayload('D1', { transport_ref: codexTransportRef({ pid: 'x' }) })),
    /"transport_ref"/
  );
  assert.match(
    recordProblem('dispatch', dispatchPayload('D1', { transport_ref: { task_ref: '' } })),
    /"transport_ref"/
  );
});

test('recordProblem refuses a dispatch whose transport_ref shape contradicts its transport', () => {
  assert.match(
    recordProblem('dispatch', dispatchPayload('D1', { transport: 'native' })),
    /transport_ref/
  );
  assert.match(
    recordProblem('dispatch', dispatchPayload('D1', { transport_ref: { task_ref: 'task-7' } })),
    /transport_ref/
  );
});

test('recordProblem refuses a record_ref that is not a decodable ref', () => {
  assert.match(
    recordProblem('workflow-return', workflowReturnPayload('milestones/M1/chunks.jsonl')),
    /"record_ref"/
  );
  assert.match(recordProblem('workflow-return', workflowReturnPayload('ledger:x')), /"record_ref"/);
});

// A dispatch_id becomes a path segment, so it must be path-safe. hold_id and
// route_id never leave the ledger, so their only contract is non-emptiness —
// a caller whose hold ids read "hold:transport" is not writing a bad record.
test('recordProblem refuses a dispatch_id that would not survive as a path segment', () => {
  assert.match(recordProblem('dispatch', dispatchPayload('../../etc/passwd')), /"dispatch_id"/);
  assert.match(recordProblem('dispatch', dispatchPayload('D 1')), /"dispatch_id"/);
  assert.match(recordProblem('dispatch', dispatchPayload('')), /"dispatch_id"/);
});

test('recordProblem refuses an empty ledger-only identity but not a merely unusual one', () => {
  assert.match(recordProblem('hold-open', holdOpenPayload('')), /"hold_id"/);
  assert.match(recordProblem('hold-resolve', holdResolvePayload('   ')), /"hold_id"/);
  assert.match(recordProblem('degraded-route', degradedRoutePayload('')), /"route_id"/);

  assert.equal(recordProblem('hold-open', holdOpenPayload('hold:transport')), null);
  assert.equal(recordProblem('hold-resolve', holdResolvePayload('hold:transport')), null);
  assert.equal(recordProblem('degraded-route', degradedRoutePayload('route/sol->claude')), null);
});

test('recordProblem refuses a payload that is not a plain object', () => {
  assert.match(recordProblem('dispatch', null), /plain object/);
  assert.match(recordProblem('dispatch', [dispatchPayload('D1')]), /plain object/);
});

// ---------- dispatch ----------

test('writeDispatch appends one dispatch record and returns it as the receipt', () => {
  const treeRoot = makeTreeRoot();
  const receipt = writeDispatch(treeRoot, dispatchPayload('D1'));

  assert.equal(receipt.ref, 'ledger:0');
  assert.equal(receipt.record.kind, 'dispatch');
  assert.equal(receipt.record.seq, 0);
  assert.equal(receipt.record.correlation_id, 'D1');
  assert.equal(receipt.record.schema_version, 1);
  assert.deepEqual(receipt.record.transport_ref, codexTransportRef());
  assert.equal(ofKind(treeRoot, 'dispatch').length, 1);
  assert.deepEqual(resolveRef(treeRoot, receipt.ref), receipt.record);
});

test('writeDispatch refuses an invalid payload before touching the ledger', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(
    () => writeDispatch(treeRoot, dispatchPayload('D1', { seat: '' })),
    /receipts: .*"seat"/
  );
  assert.equal(ledgerRecords(treeRoot).length, 0);
});

test('writeDispatch replay returns the existing receipt and appends nothing', () => {
  const treeRoot = makeTreeRoot();
  const first = writeDispatch(treeRoot, dispatchPayload('D1'));
  const replay = writeDispatch(treeRoot, dispatchPayload('D1'));

  assert.deepEqual(replay, first);
  assert.equal(ofKind(treeRoot, 'dispatch').length, 1);
});

test('writeDispatch refuses a conflicting duplicate dispatch_id', () => {
  const treeRoot = makeTreeRoot();
  writeDispatch(treeRoot, dispatchPayload('D1'));
  assert.throws(
    () => writeDispatch(treeRoot, dispatchPayload('D1', { seat: 'reviewer' })),
    /conflicting duplicate/
  );
  assert.equal(ofKind(treeRoot, 'dispatch').length, 1);
});

// ---------- dispatch-terminal ----------

test('writeDispatchTerminal appends a terminal correlated to its dispatch', () => {
  const treeRoot = makeTreeRoot();
  withDispatch(treeRoot, 'D1');
  const receipt = writeDispatchTerminal(treeRoot, terminalPayload('D1'));

  assert.equal(receipt.ref, 'ledger:1');
  assert.equal(receipt.record.kind, 'dispatch-terminal');
  assert.equal(receipt.record.correlation_id, 'D1');
  assert.equal(receipt.record.status, 'ok');
  assert.deepEqual(resolveRef(treeRoot, receipt.ref), receipt.record);
});

test('writeDispatchTerminal records a timeout as status failed with reason timeout', () => {
  const treeRoot = makeTreeRoot();
  withDispatch(treeRoot, 'D1');
  const payload = failedTerminalPayload('D1', { reason: 'timeout' });
  delete payload.result_ref;
  const receipt = writeDispatchTerminal(treeRoot, payload);

  assert.equal(receipt.record.status, 'failed');
  assert.equal(receipt.record.reason, 'timeout');
  assert.equal(receipt.record.builder, null);
});

// ---------- the evidence a successful terminal must carry ----------

test('an ok terminal must name the model that built it and digest what it produced', () => {
  for (const missing of ['model_id', 'result_digest']) {
    const payload = terminalPayload('D1');
    delete payload[missing];

    assert.match(
      recordProblem('dispatch-terminal', payload),
      new RegExp(`"${missing}"`),
      `an ok terminal must refuse to omit ${missing}`
    );
  }
  assert.equal(recordProblem('dispatch-terminal', terminalPayload('D1')), null);
});

test('a failed terminal carries neither, because there was no result to attest', () => {
  for (const [field, value] of [
    ['model_id', 'gpt-5.6-sol'],
    ['result_digest', A_DIGEST],
  ]) {
    assert.match(
      recordProblem('dispatch-terminal', failedTerminalPayload('D1', { [field]: value })),
      new RegExp(`"${field}"`),
      `a failed terminal must refuse to carry ${field}`
    );
  }
  assert.equal(recordProblem('dispatch-terminal', failedTerminalPayload('D1')), null);
});

test('a result_digest must be a digest, not a story about one', () => {
  for (const bad of ['', 'sha256:', 'not-a-digest', `sha256:${'a'.repeat(63)}`, `md5:${'a'.repeat(64)}`, `sha256:${'A'.repeat(64)}`]) {
    assert.match(
      recordProblem('dispatch-terminal', terminalPayload('D1', { result_digest: bad })),
      /"result_digest"/,
      `${JSON.stringify(bad)} is not a digest`
    );
  }
});

test('a terminal whose artifact was rewritten under the same result_ref is a CONFLICT, not a replay', () => {
  const treeRoot = makeTreeRoot();
  writeDispatch(treeRoot, dispatchPayload('D1'));
  writeDispatchTerminal(treeRoot, terminalPayload('D1'));

  // Same dispatch, same result path, different bytes: the evidence on the
  // record is what makes that detectable at all.
  assert.throws(
    () => writeDispatchTerminal(treeRoot, terminalPayload('D1', { result_digest: ANOTHER_DIGEST })),
    /conflicting duplicate/
  );
  assert.throws(
    () => writeDispatchTerminal(treeRoot, terminalPayload('D1', { model_id: 'opus-5' })),
    /conflicting duplicate/
  );
  assert.equal(ofKind(treeRoot, 'dispatch-terminal').length, 1);
});

test('writeDispatchTerminal refuses a terminal with no prior dispatch', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(() => writeDispatchTerminal(treeRoot, terminalPayload('D1')), /no dispatch record/);
  assert.equal(ledgerRecords(treeRoot).length, 0);
});

test('writeDispatchTerminal refuses a transport_ref that differs from its dispatch', () => {
  const treeRoot = makeTreeRoot();
  withDispatch(treeRoot, 'D1');
  assert.throws(
    () =>
      writeDispatchTerminal(treeRoot, terminalPayload('D1', { transport_ref: codexTransportRef({ pid: 99 }) })),
    /transport_ref/
  );
  assert.throws(
    () => writeDispatchTerminal(treeRoot, terminalPayload('D1', { transport_ref: { task_ref: 'task-7' } })),
    /transport_ref/
  );
  assert.equal(ofKind(treeRoot, 'dispatch-terminal').length, 0);
});

test('writeDispatchTerminal replay returns the existing receipt and appends nothing', () => {
  const treeRoot = makeTreeRoot();
  withDispatch(treeRoot, 'D1');
  const first = writeDispatchTerminal(treeRoot, terminalPayload('D1'));
  const replay = writeDispatchTerminal(treeRoot, terminalPayload('D1'));

  assert.deepEqual(replay, first);
  assert.equal(ofKind(treeRoot, 'dispatch-terminal').length, 1);
});

test('writeDispatchTerminal refuses a second, different terminal for the same dispatch_id', () => {
  const treeRoot = makeTreeRoot();
  withDispatch(treeRoot, 'D1');
  writeDispatchTerminal(treeRoot, terminalPayload('D1'));
  assert.throws(
    () => writeDispatchTerminal(treeRoot, failedTerminalPayload('D1')),
    /conflicting duplicate/
  );
  assert.equal(ofKind(treeRoot, 'dispatch-terminal').length, 1);
});

// ---------- workflow-return ----------

test('writeWorkflowReturn appends a return whose record_ref resolves', () => {
  const treeRoot = makeTreeRoot();
  const dispatch = withDispatch(treeRoot, 'D1');
  const receipt = writeWorkflowReturn(treeRoot, workflowReturnPayload(dispatch.ref));

  assert.equal(receipt.record.kind, 'workflow-return');
  assert.equal(receipt.record.correlation_id, 'run-1');
  assert.equal(receipt.record.record_ref, 'ledger:0');
  assert.deepEqual(resolveRef(treeRoot, receipt.record.record_ref), dispatch.record);
});

test('writeWorkflowReturn accepts an envelope record_ref that exists on disk', () => {
  const treeRoot = makeTreeRoot();
  const envelope = writeEnvelope(treeRoot, 'implementation', 'D1', envelopeDoc());
  const receipt = writeWorkflowReturn(treeRoot, workflowReturnPayload(envelope.ref));

  assert.equal(receipt.record.record_ref, 'envelope:implementation/D1');
});

test('writeWorkflowReturn refuses a record_ref that does not resolve', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(
    () => writeWorkflowReturn(treeRoot, workflowReturnPayload('ledger:7')),
    /does not resolve/
  );
  assert.throws(
    () => writeWorkflowReturn(treeRoot, workflowReturnPayload('envelope:implementation/D9')),
    /does not resolve/
  );
  assert.equal(ledgerRecords(treeRoot).length, 0);
});

test('writeWorkflowReturn replay returns the existing receipt and appends nothing', () => {
  const treeRoot = makeTreeRoot();
  withDispatch(treeRoot, 'D1');
  const first = writeWorkflowReturn(treeRoot, workflowReturnPayload('ledger:0'));
  const replay = writeWorkflowReturn(treeRoot, workflowReturnPayload('ledger:0'));

  assert.deepEqual(replay, first);
  assert.equal(ofKind(treeRoot, 'workflow-return').length, 1);
});

test('writeWorkflowReturn refuses a conflicting duplicate (workflow, run_ref)', () => {
  const treeRoot = makeTreeRoot();
  withDispatch(treeRoot, 'D1');
  writeWorkflowReturn(treeRoot, workflowReturnPayload('ledger:0'));
  assert.throws(
    () => writeWorkflowReturn(treeRoot, workflowReturnPayload('ledger:0', { return: 'blocked' })),
    /conflicting duplicate/
  );
  assert.equal(ofKind(treeRoot, 'workflow-return').length, 1);
});

test('writeWorkflowReturn treats a different run_ref on the same workflow as a new record', () => {
  const treeRoot = makeTreeRoot();
  withDispatch(treeRoot, 'D1');
  writeWorkflowReturn(treeRoot, workflowReturnPayload('ledger:0'));
  writeWorkflowReturn(treeRoot, workflowReturnPayload('ledger:0', { run_ref: 'run-2' }));
  assert.equal(ofKind(treeRoot, 'workflow-return').length, 2);
});

// ---------- holds ----------

test('writeHoldOpen appends one hold-open record', () => {
  const treeRoot = makeTreeRoot();
  const receipt = writeHoldOpen(treeRoot, holdOpenPayload('H1'));

  assert.equal(receipt.record.kind, 'hold-open');
  assert.equal(receipt.record.correlation_id, 'H1');
  assert.equal(receipt.record.severity, 'S2');
  assert.deepEqual(resolveRef(treeRoot, receipt.ref), receipt.record);
});

test('writeHoldOpen replay returns the existing receipt and appends nothing', () => {
  const treeRoot = makeTreeRoot();
  const first = writeHoldOpen(treeRoot, holdOpenPayload('H1'));
  const replay = writeHoldOpen(treeRoot, holdOpenPayload('H1'));

  assert.deepEqual(replay, first);
  assert.equal(ofKind(treeRoot, 'hold-open').length, 1);
});

test('writeHoldOpen refuses a conflicting reuse of a live hold_id', () => {
  const treeRoot = makeTreeRoot();
  writeHoldOpen(treeRoot, holdOpenPayload('H1'));
  assert.throws(
    () => writeHoldOpen(treeRoot, holdOpenPayload('H1', { severity: 'S3' })),
    /conflicting duplicate/
  );
  assert.equal(ofKind(treeRoot, 'hold-open').length, 1);
});

test('writeHoldOpen refuses a conflicting reuse of an already-resolved hold_id', () => {
  const treeRoot = makeTreeRoot();
  const open = writeHoldOpen(treeRoot, holdOpenPayload('H1'));
  writeHoldResolve(treeRoot, holdResolvePayload('H1'));

  assert.throws(
    () => writeHoldOpen(treeRoot, holdOpenPayload('H1', { summary: 'it came back' })),
    /conflicting duplicate/
  );
  // A hold_id is single-use for the lifetime of the tree: even after the
  // exit, an identical replay still returns the original open receipt.
  assert.deepEqual(writeHoldOpen(treeRoot, holdOpenPayload('H1')), open);
  assert.equal(ofKind(treeRoot, 'hold-open').length, 1);
});

test('writeHoldResolve appends an exit for an open hold', () => {
  const treeRoot = makeTreeRoot();
  writeHoldOpen(treeRoot, holdOpenPayload('H1'));
  const receipt = writeHoldResolve(treeRoot, holdResolvePayload('H1', { exit: 'delivered' }));

  assert.equal(receipt.record.kind, 'hold-resolve');
  assert.equal(receipt.record.correlation_id, 'H1');
  assert.equal(receipt.record.exit, 'delivered');
});

test('writeHoldResolve refuses a hold that was never opened', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(() => writeHoldResolve(treeRoot, holdResolvePayload('H1')), /no hold-open record/);
  assert.equal(ledgerRecords(treeRoot).length, 0);
});

test('writeHoldResolve replay returns the existing receipt and appends nothing', () => {
  const treeRoot = makeTreeRoot();
  writeHoldOpen(treeRoot, holdOpenPayload('H1'));
  const first = writeHoldResolve(treeRoot, holdResolvePayload('H1'));
  const replay = writeHoldResolve(treeRoot, holdResolvePayload('H1'));

  assert.deepEqual(replay, first);
  assert.equal(ofKind(treeRoot, 'hold-resolve').length, 1);
});

test('writeHoldResolve refuses a second, different exit for the same hold_id', () => {
  const treeRoot = makeTreeRoot();
  writeHoldOpen(treeRoot, holdOpenPayload('H1'));
  writeHoldResolve(treeRoot, holdResolvePayload('H1'));
  assert.throws(
    () => writeHoldResolve(treeRoot, holdResolvePayload('H1', { exit: 'delivered' })),
    /conflicting duplicate/
  );
  assert.equal(ofKind(treeRoot, 'hold-resolve').length, 1);
});

test('a recurrence is a new hold_id citing the prior hold, and opens cleanly', () => {
  const treeRoot = makeTreeRoot();
  const first = writeHoldOpen(treeRoot, holdOpenPayload('H1'));
  writeHoldResolve(treeRoot, holdResolvePayload('H1'));
  const again = writeHoldOpen(treeRoot, holdOpenPayload('H2', { origin_ref: first.ref }));

  assert.equal(again.record.origin_ref, 'ledger:0');
  assert.equal(ofKind(treeRoot, 'hold-open').length, 2);
});

// ---------- degraded-route ----------

test('writeDegradedRoute appends a mid-build substitution record', () => {
  const treeRoot = makeTreeRoot();
  const receipt = writeDegradedRoute(treeRoot, degradedRoutePayload('R1'));

  assert.equal(receipt.record.kind, 'degraded-route');
  assert.equal(receipt.record.correlation_id, 'R1');
  assert.equal(receipt.record.expected, 'sol');
  assert.equal(receipt.record.actual, 'claude-fallback');
});

test('writeDegradedRoute replay returns the existing receipt and appends nothing', () => {
  const treeRoot = makeTreeRoot();
  const first = writeDegradedRoute(treeRoot, degradedRoutePayload('R1'));
  const replay = writeDegradedRoute(treeRoot, degradedRoutePayload('R1'));

  assert.deepEqual(replay, first);
  assert.equal(ofKind(treeRoot, 'degraded-route').length, 1);
});

test('writeDegradedRoute refuses a conflicting duplicate route_id', () => {
  const treeRoot = makeTreeRoot();
  writeDegradedRoute(treeRoot, degradedRoutePayload('R1'));
  assert.throws(
    () => writeDegradedRoute(treeRoot, degradedRoutePayload('R1', { reason: 'operator ruling' })),
    /conflicting duplicate/
  );
  assert.equal(ofKind(treeRoot, 'degraded-route').length, 1);
});

// ---------- mind lifecycle ----------

test('writeMindOpen appends one mind-open record correlated by the scoped pair', () => {
  const treeRoot = makeTreeRoot();
  const receipt = writeMindOpen(treeRoot, mindOpenPayload(1));

  assert.equal(receipt.ref, 'ledger:0');
  assert.equal(receipt.record.kind, 'mind-open');
  assert.equal(receipt.record.session, 'sess-mind-1');
  assert.equal(receipt.record.handle, 'agent-7f3');
  assert.equal(receipt.record.generation, 1);
  // The generation alone would not correlate anything (it is a small integer
  // every mind reuses) and the mind name alone would correlate across scopes.
  assert.equal(receipt.record.correlation_id, `mind ${JSON.stringify([MIND, SCOPE])}`);
  assert.deepEqual(resolveRef(treeRoot, receipt.ref), receipt.record);
});

test('a mind of the same name in another scope is a different mind, at its own generation', () => {
  const treeRoot = makeTreeRoot();
  const here = writeMindOpen(treeRoot, mindOpenPayload(1));
  const elsewhere = writeMindOpen(treeRoot, mindOpenPayload(1, { scope: 'milestones/M2', session: 'sess-mind-2' }));

  assert.notEqual(here.ref, elsewhere.ref);
  assert.notEqual(here.record.correlation_id, elsewhere.record.correlation_id);
  assert.equal(ofKind(treeRoot, 'mind-open').length, 2);
});

test('writeMindOpen replay returns the existing receipt and appends nothing', () => {
  const treeRoot = makeTreeRoot();
  const first = writeMindOpen(treeRoot, mindOpenPayload(1));
  const replay = writeMindOpen(treeRoot, mindOpenPayload(1));

  assert.deepEqual(replay, first);
  assert.equal(ofKind(treeRoot, 'mind-open').length, 1);
});

// The duplicate-launch refusal: a second seat claiming a generation that is
// already seated is not a replay, it is two minds believing they are the one.
test('writeMindOpen refuses a second launch at a generation already open', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));

  assert.throws(
    () => writeMindOpen(treeRoot, mindOpenPayload(1, { session: 'sess-mind-2', handle: 'agent-b12' })),
    /already exists with a different payload/
  );
  assert.equal(ofKind(treeRoot, 'mind-open').length, 1);
});

test('writeMindOpen refuses a generation whose predecessor is still live', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));

  assert.throws(() => writeMindOpen(treeRoot, mindOpenPayload(2, { session: 'sess-mind-2' })), /is still live/);
  assert.equal(ofKind(treeRoot, 'mind-open').length, 1);
});

test('writeMindOpen refuses a skipped generation', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));
  writeMindRetire(treeRoot, mindRetirePayload(1, { reason: 'close' }));

  assert.throws(() => writeMindOpen(treeRoot, mindOpenPayload(3, { session: 'sess-mind-3' })), /do not skip/);
  assert.equal(ofKind(treeRoot, 'mind-open').length, 1);
});

// The ladder asks its questions of ONE scope's records. A retire in some
// other scope is not this scope's retire, and reading it as one would seat a
// second mind over a scope that already has a live one.
test('a retire in another scope does not clear this scope\'s live generation', () => {
  const treeRoot = makeTreeRoot();
  const elsewhere = { scope: 'milestones/M2', session: 'sess-elsewhere' };
  writeMindOpen(treeRoot, mindOpenPayload(1, elsewhere));
  writeMindRetire(treeRoot, mindRetirePayload(1, { scope: elsewhere.scope, reason: 'close' }));
  writeMindOpen(treeRoot, mindOpenPayload(1));

  assert.throws(() => writeMindOpen(treeRoot, mindOpenPayload(2, { session: 'sess-mind-2' })), /is still live/);
  assert.deepEqual(
    ofKind(treeRoot, 'mind-open')
      .filter((record) => record.scope === SCOPE)
      .map((record) => record.generation),
    [1]
  );
});

test('writeMindRetire refuses a retire for a generation that was never opened', () => {
  const treeRoot = makeTreeRoot();

  assert.throws(() => writeMindRetire(treeRoot, mindRetirePayload(1)), /cannot retire before it is opened/);
  writeMindOpen(treeRoot, mindOpenPayload(1));
  assert.throws(() => writeMindRetire(treeRoot, mindRetirePayload(2)), /cannot retire before it is opened/);
  assert.equal(ofKind(treeRoot, 'mind-retire').length, 0);
});

// Every reason in the vocabulary reaches the ledger; they differ only in
// which writer is allowed to put it there.
test('every retire reason is recorded, each through the writer that owns it', () => {
  for (const reason of ['close', 'timeout']) {
    const treeRoot = makeTreeRoot();
    writeMindOpen(treeRoot, mindOpenPayload(1));
    const receipt = writeMindRetire(treeRoot, mindRetirePayload(1, { reason }));
    assert.equal(receipt.record.reason, reason);
  }

  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));
  const handover = supersedeMind(
    treeRoot,
    mindRetirePayload(1, { reason: 'supersede' }),
    mindOpenPayload(2, { session: 'sess-mind-2' })
  );
  assert.equal(handover.retire.record.reason, 'supersede');
});

test('writeMindRetire replay returns the receipt; a different exit for the same generation is refused', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));
  const first = writeMindRetire(treeRoot, mindRetirePayload(1, { reason: 'timeout' }));

  assert.deepEqual(writeMindRetire(treeRoot, mindRetirePayload(1, { reason: 'timeout' })), first);
  assert.throws(
    () => writeMindRetire(treeRoot, mindRetirePayload(1, { reason: 'close' })),
    /already exists with a different payload/
  );
  assert.equal(ofKind(treeRoot, 'mind-retire').length, 1);
});

test('supersedeMind writes the handover as one sequence and leaves exactly one live generation', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));

  const receipt = supersedeMind(
    treeRoot,
    mindRetirePayload(1, { reason: 'supersede' }),
    mindOpenPayload(2, { session: 'sess-mind-2', handle: 'agent-c99' })
  );

  assert.equal(receipt.retire.record.kind, 'mind-retire');
  assert.equal(receipt.open.record.kind, 'mind-open');
  assert.deepEqual(
    ofKind(treeRoot, 'mind-open').map((record) => record.generation),
    [1, 2]
  );
  assert.deepEqual(
    ofKind(treeRoot, 'mind-retire').map((record) => record.generation),
    [1]
  );
});

test('supersedeMind replay returns both receipts and appends nothing', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));
  const args = [mindRetirePayload(1, { reason: 'supersede' }), mindOpenPayload(2, { session: 'sess-mind-2' })];

  const first = supersedeMind(treeRoot, ...args);
  assert.deepEqual(supersedeMind(treeRoot, ...args), first);
  assert.equal(ledgerRecords(treeRoot).length, 3);
});

// A handover is one act over one seat. A pair naming two different minds, two
// different scopes, or two generations that are not consecutive is not a
// handover with a typo in it — it is two unrelated operations, and writing
// them under one lock would give them an atomicity they have no claim to.
test('supersedeMind refuses a pair that is not one seat handing over to its own successor', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));

  const cases = [
    [mindRetirePayload(1, { reason: 'supersede' }), mindOpenPayload(2, { mind: 'other' }), /the same mind and scope/],
    [
      mindRetirePayload(1, { reason: 'supersede' }),
      mindOpenPayload(2, { scope: 'milestones/M2' }),
      /the same mind and scope/,
    ],
    [mindRetirePayload(1, { reason: 'supersede' }), mindOpenPayload(3), /generation 2, not 3/],
    [mindRetirePayload(1, { reason: 'close' }), mindOpenPayload(2), /reason "supersede"/],
  ];
  for (const [retire, open, expected] of cases) {
    assert.throws(() => supersedeMind(treeRoot, retire, open), expected);
  }
  assert.equal(ofKind(treeRoot, 'mind-retire').length, 0);
});

// The fence that makes the atomic path the ONLY path: a supersede cannot be
// assembled out of two standalone writers, because the standalone retire
// refuses that reason outright. A close or a timeout stays available on its
// own — those end a seat rather than hand it over.
test('writeMindRetire refuses to write a supersede on its own', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));

  assert.throws(
    () => writeMindRetire(treeRoot, mindRetirePayload(1, { reason: 'supersede' })),
    /supersedeMind/
  );
  assert.equal(ofKind(treeRoot, 'mind-retire').length, 0);
  assert.equal(writeMindRetire(treeRoot, mindRetirePayload(1, { reason: 'close' })).record.reason, 'close');
});

// One lock hold does not make two durable appends one write, and this is the
// state that proves it: the process is KILLED between them, inside the lock,
// with the retire already on disk. What the lock buys is exclusion while the
// process lives; what re-entry buys is finishing after it dies. Both are
// needed, and neither substitutes for the other.
test('a kill between the two appends of a supersede leaves a finishable state', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));

  const killed = killMidSupersede(
    treeRoot,
    mindRetirePayload(1, { reason: 'supersede' }),
    mindOpenPayload(2, { session: 'sess-mind-2' })
  );
  assert.equal(killed.signal, 'SIGKILL');

  // The retire is durable, the open never happened, and the lock the dead
  // process was holding is still on disk.
  assert.equal(ofKind(treeRoot, 'mind-retire').length, 1);
  assert.equal(ofKind(treeRoot, 'mind-open').length, 1);
  const lockPath = path.join(treeRoot, 'receipts') + LOCK_SUFFIX;
  assert.ok(fs.existsSync(lockPath));

  // Re-entry inside the stale window waits for a holder that will never
  // return, and says so rather than writing behind it.
  assert.throws(
    () => supersedeMind(treeRoot, mindRetirePayload(1, { reason: 'supersede' }), mindOpenPayload(2, { session: 'sess-mind-2' })),
    (err) => err.code === LOCK_TIMEOUT_CODE
  );

  // Once the lock is old enough to be abandoned, jsonl.js reclaims it on its
  // own — aged here rather than waited out.
  const aged = (Date.now() - LOCK_STALE_MS - 1000) / 1000;
  fs.utimesSync(lockPath, aged, aged);

  const finished = supersedeMind(
    treeRoot,
    mindRetirePayload(1, { reason: 'supersede' }),
    mindOpenPayload(2, { session: 'sess-mind-2' })
  );

  assert.equal(finished.open.record.generation, 2);
  assert.equal(ofKind(treeRoot, 'mind-retire').length, 1, 'the replayed retire must not append a second record');
  assert.deepEqual(
    ofKind(treeRoot, 'mind-open').map((record) => record.generation),
    [1, 2]
  );
});

// What the single hold is FOR, made observable. Between the retire and the
// open the seat is empty, and an empty seat is exactly when a competing
// launch at the next generation looks lawful to another writer. Forced, not
// raced: the child pauses the moment it releases the lifecycle lock, and the
// parent tries to seat itself right then. Under one hold that moment comes
// only after the open is durable, so the competitor is refused as the
// duplicate it is; under two holds it would find an empty seat and take it.
test('no other writer can seat itself between the retire and the open', async () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));
  const signalPath = path.join(treeRoot, 'in-gap');

  const child = pauseAtLifecycleLockRelease(
    treeRoot,
    mindRetirePayload(1, { reason: 'supersede' }),
    mindOpenPayload(2, { session: 'sess-mind-child' }),
    signalPath,
    500
  );
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  await waitForWindow(signalPath, child);

  // The competing launch. It waits for the lock, and by the time it gets it
  // the seat is filled — so it is refused as the duplicate it is, rather than
  // succeeding into a gap.
  assert.throws(
    () => writeMindOpen(treeRoot, mindOpenPayload(2, { session: 'sess-mind-intruder' })),
    /already exists with a different payload/
  );
  assert.equal(await exited, 0);

  const opens = ofKind(treeRoot, 'mind-open').filter((record) => record.generation === 2);
  assert.equal(opens.length, 1);
  assert.equal(opens[0].session, 'sess-mind-child');
});

test('an already-durable mind-open replays identically in a fresh process', () => {
  const treeRoot = makeTreeRoot();
  const first = writeMindOpen(treeRoot, mindOpenPayload(1));

  const replayed = replayInFreshProcess('writeMindOpen', [treeRoot, mindOpenPayload(1)]);

  assert.deepEqual(replayed, first);
  assert.equal(ofKind(treeRoot, 'mind-open').length, 1);
});

// The same obligation for the other writer. The fixture retires with "close"
// because a supersede is no longer writable through writeMindRetire at all.
test('an already-durable mind-retire replays identically in a fresh process', () => {
  const treeRoot = makeTreeRoot();
  writeMindOpen(treeRoot, mindOpenPayload(1));
  const first = writeMindRetire(treeRoot, mindRetirePayload(1, { reason: 'close' }));

  const replayed = replayInFreshProcess('writeMindRetire', [
    treeRoot,
    mindRetirePayload(1, { reason: 'close' }),
  ]);

  assert.deepEqual(replayed, first);
  assert.equal(ofKind(treeRoot, 'mind-retire').length, 1);
  assert.equal(ledgerRecords(treeRoot).length, 2);
});

test('recordProblem refuses a generation that is not a counting number', () => {
  for (const generation of [0, -1, 1.5, '2', null]) {
    assert.match(recordProblem('mind-open', mindOpenPayload(generation)), /"generation"/);
    assert.match(recordProblem('mind-retire', mindRetirePayload(generation)), /"generation"/);
  }
});

// ---------- envelopes ----------

test('writeEnvelope round-trips through envelopes/<phase>/<dispatch_id>.json', () => {
  const treeRoot = makeTreeRoot();
  const doc = envelopeDoc();
  const receipt = writeEnvelope(treeRoot, 'implementation', 'D1', doc);

  assert.equal(receipt.ref, 'envelope:implementation/D1');
  assert.deepEqual(receipt.envelope, doc);
  assert.deepEqual(
    readJson(path.join(treeRoot, 'envelopes', 'implementation', 'D1.json')),
    doc
  );
  assert.deepEqual(resolveRef(treeRoot, receipt.ref), doc);
});

test('writeEnvelope refuses an envelope that fails validation', () => {
  const treeRoot = makeTreeRoot();
  const broken = envelopeDoc({ state: 'finished' });
  assert.throws(() => writeEnvelope(treeRoot, 'implementation', 'D1', broken), /invalid envelope/);
  assert.equal(fs.existsSync(path.join(treeRoot, 'envelopes')), false);
});

test('writeEnvelope refuses a phase or dispatch_id that is not a safe identifier', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(() => writeEnvelope(treeRoot, '../escape', 'D1', envelopeDoc()), /phase/);
  assert.throws(() => writeEnvelope(treeRoot, 'implementation', '../D1', envelopeDoc()), /dispatch_id/);
});

test('writeEnvelope replay of identical content returns the existing receipt and rewrites nothing', () => {
  const treeRoot = makeTreeRoot();
  const file = path.join(treeRoot, 'envelopes', 'implementation', 'D1.json');

  const first = writeEnvelope(treeRoot, 'implementation', 'D1', envelopeDoc());
  const before = fs.statSync(file);

  const replay = writeEnvelope(treeRoot, 'implementation', 'D1', envelopeDoc());
  const after = fs.statSync(file);

  assert.deepEqual(replay, first);
  // writeAtomic always lands a NEW temp file and renames it over the target,
  // so a repeated write necessarily changes the inode. Comparing the returned
  // value alone would pass even if the replay branch re-persisted; this is the
  // observation that the replay was genuinely a no-op on disk.
  assert.equal(after.ino, before.ino, 'an identical replay must not re-persist the envelope');
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1, 'no temp file may be left behind');
});

test('writeEnvelope refuses conflicting content for the same dispatch_id', () => {
  const treeRoot = makeTreeRoot();
  writeEnvelope(treeRoot, 'implementation', 'D1', envelopeDoc());
  assert.throws(
    () => writeEnvelope(treeRoot, 'implementation', 'D1', envelopeDoc({ state: 'blocked' })),
    /conflicting duplicate/
  );
  assert.deepEqual(resolveRef(treeRoot, 'envelope:implementation/D1'), envelopeDoc());
});

// ---------- resolveRef ----------

test('resolveRef returns null for a well-formed ref with nothing behind it', () => {
  const treeRoot = makeTreeRoot();
  assert.equal(resolveRef(treeRoot, 'ledger:0'), null);
  assert.equal(resolveRef(treeRoot, 'envelope:implementation/D1'), null);
});

test('resolveRef refuses a ref outside the two grammars', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(() => resolveRef(treeRoot, 'tablet:T-3'), /ledger:<seq>/);
  assert.throws(() => resolveRef(treeRoot, 'envelope:implementation/../D1'), /ledger:<seq>/);
  assert.throws(() => resolveRef(treeRoot, 42), /ledger:<seq>/);
});

// ---------- untrustworthy stream ----------

test('a writer refuses to append on top of a ledger it cannot parse', () => {
  const treeRoot = makeTreeRoot();
  writeDispatch(treeRoot, dispatchPayload('D1'));
  fs.appendFileSync(path.join(treeRoot, 'ledger.jsonl'), '{ not json\n');

  assert.throws(() => writeDispatch(treeRoot, dispatchPayload('D2')), /refusing to trust this stream/);
});

// ---------- steering ----------

function steerRaisePayload(steerId, overrides) {
  return Object.assign(
    {
      steer_id: steerId,
      scope: 'milestones/M1',
      instruction: 'prefer the smaller refactor over the rewrite',
      origin: 'operator',
    },
    overrides
  );
}

function steerApplyPayload(steerId, overrides) {
  return Object.assign({ steer_id: steerId, exit: 'applied', resolution_ref: 'ledger:0' }, overrides);
}

test('a steer is raised once and exits once, exactly as a hold does', () => {
  const treeRoot = makeTreeRoot();
  const raised = writeSteerRaise(treeRoot, steerRaisePayload('S1'));
  assert.equal(raised.record.kind, 'steer-raise');
  assert.equal(raised.record.correlation_id, 'S1');

  const applied = writeSteerApply(treeRoot, steerApplyPayload('S1'));
  assert.equal(applied.record.exit, 'applied');
  assert.equal(ofKind(treeRoot, 'steer-apply').length, 1);
});

test('a steer cannot exit before it is raised', () => {
  const treeRoot = makeTreeRoot();

  assert.throws(() => writeSteerApply(treeRoot, steerApplyPayload('S1')), /cannot exit before it is raised/);
  assert.equal(ofKind(treeRoot, 'steer-apply').length, 0);
});

test('a steer_id is single-use: a second, different raise under it is refused', () => {
  const treeRoot = makeTreeRoot();
  writeSteerRaise(treeRoot, steerRaisePayload('S1'));

  assert.deepEqual(
    writeSteerRaise(treeRoot, steerRaisePayload('S1')).record.instruction,
    'prefer the smaller refactor over the rewrite'
  );
  assert.throws(
    () => writeSteerRaise(treeRoot, steerRaisePayload('S1', { instruction: 'something else entirely' })),
    /already exists with a different payload/
  );
});

test('a steer exits either applied or routed to the operator, and nothing else', () => {
  const treeRoot = makeTreeRoot();
  writeSteerRaise(treeRoot, steerRaisePayload('S1'));
  writeSteerRaise(treeRoot, steerRaisePayload('S2'));

  assert.equal(writeSteerApply(treeRoot, steerApplyPayload('S1', { exit: 'operator' })).record.exit, 'operator');
  assert.match(recordProblem('steer-apply', steerApplyPayload('S2', { exit: 'ignored' })), /"exit"/);
});

test('an already-durable steer replays identically in a fresh process', () => {
  const treeRoot = makeTreeRoot();
  const first = writeSteerRaise(treeRoot, steerRaisePayload('S1'));

  assert.deepEqual(replayInFreshProcess('writeSteerRaise', [treeRoot, steerRaisePayload('S1')]), first);
  assert.equal(ofKind(treeRoot, 'steer-raise').length, 1);
});

// Two kinds carry an "exit" and the vocabularies do not overlap. Admitting
// both in the field table is what lets one name serve two kinds; narrowing
// each to its own is what stops a hold from taking a steer's exit.
test('a hold and a steer each refuse the other\'s exit vocabulary', () => {
  assert.match(recordProblem('hold-resolve', holdResolvePayload('H1', { exit: 'applied' })), /"exit"/);
  assert.match(recordProblem('hold-resolve', holdResolvePayload('H1', { exit: 'operator' })), /"exit"/);
  assert.match(recordProblem('steer-apply', steerApplyPayload('S1', { exit: 'resolved' })), /"exit"/);
  assert.match(recordProblem('steer-apply', steerApplyPayload('S1', { exit: 'delivered' })), /"exit"/);
  assert.equal(recordProblem('hold-resolve', holdResolvePayload('H1', { exit: 'delivered' })), null);
  assert.equal(recordProblem('steer-apply', steerApplyPayload('S1', { exit: 'operator' })), null);
});
