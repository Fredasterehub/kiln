'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const {
  codexInvocation,
  dispatchProcess,
  dispatchCodex,
  dispatchNative,
  completeNative,
  recoverDispatches,
  sessionMembers,
  sweepSession,
} = require('../src/dispatch.js');
const { recordProblem, writeDispatch } = require('../src/receipts.js');
const { readRecords } = require('../src/stream.js');
const { FAMILY_OF_BUILDER, TRANSPORT_OF_BUILDER } = require('../src/validators.js');
const { appendLine } = require('../src/jsonl.js');

const MODULE_PATH = path.resolve(__dirname, '..', 'src', 'dispatch.js');

// Wide enough that a child of a few hundred milliseconds never races it.
const WIDE_BOUND_MS = 5000;

function makeTree() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-test-'));
}

function ledgerOf(treeRoot) {
  const { records, errors, headerViolations } = readRecords(path.join(treeRoot, 'ledger.jsonl'));
  assert.deepEqual(errors, []);
  assert.deepEqual(headerViolations, []);
  return records;
}

function recordsOfKind(treeRoot, kind) {
  return ledgerOf(treeRoot).filter((record) => record.kind === kind);
}

function sha256Of(file) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// For polling while a dispatch is in flight. The child is released by a write
// to its stdin pipe, and a pipe write needs the event loop — so a poll that
// blocks the loop (waitUntil, below) would starve the very child it is
// waiting on.
async function waitUntilAsync(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function waitUntil(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    sleepSync(20);
  }
  return false;
}

// A shell script run as the dispatched child, written into the tree so the
// invocation names a real file on a real path.
//
// Every fixture opens by reading its instruction to EOF, because that is the
// invocation contract the launch gate rests on: a dispatched command does
// nothing until it has been told what to do. A fixture that skipped it would
// be testing a wrapper against a child the wrapper cannot actually hold.
function writeScript(treeRoot, name, lines) {
  const file = path.join(treeRoot, name);
  fs.writeFileSync(file, `${['#!/bin/bash', 'instruction=$(cat)', ...lines].join('\n')}\n`, { mode: 0o755 });
  return file;
}

function invocationFor(script, overrides = {}) {
  return { command: '/bin/bash', args: [script], stdin: 'do the work\n', model_id: 'gpt-5.6-sol', ...overrides };
}

function resultPathOf(treeRoot, dispatchId) {
  return path.join(treeRoot, 'dispatch', `${dispatchId}.result.md`);
}

function writePrompt(treeRoot, text = 'do the work\n') {
  fs.writeFileSync(path.join(treeRoot, 'prompt.md'), text);
}

// The brief's own signatures, and nothing besides — a caller writing exactly
// these four fields must be served.
function nativeSpec(overrides = {}) {
  return {
    dispatch_id: 'D1',
    seat: 'implementer_ui_creative',
    task_class: 'chunk_implementation',
    payload_ref: 'briefs/C1.md',
    ...overrides,
  };
}

function processSpec(overrides = {}) {
  return {
    dispatch_id: 'D1',
    seat: 'implementer',
    task_class: 'chunk_implementation',
    prompt_ref: 'prompt.md',
    ...overrides,
  };
}

function codexSpec(treeRoot, overrides = {}) {
  return {
    dispatch_id: 'D1',
    seat: 'implementer',
    task_class: 'chunk_implementation',
    prompt_ref: 'prompt.md',
    workdir: treeRoot,
    effort: 'low',
    sandbox: 'read-only',
    ...overrides,
  };
}

// A child that lives long enough to be reaped, in its own session, with
// grandchildren in SIBLING process groups — bash job control (`set -m`) puts
// each background job in a group of its own inside the same session, the shape
// S0 found codex's MCP servers taking and the shape a plain PGID kill misses.
function siblingGroupScript(treeRoot, name, readyFile) {
  return writeScript(treeRoot, name, ['set -m', 'sleep 300 &', 'sleep 300 &', `echo ready > ${readyFile}`, 'sleep 300']);
}

// Read independently of the module under test, so a survivor count here is a
// second opinion rather than an echo. Defunct entries are excluded: a killed
// child lingers in the process table until its parent reaps it, and a process
// that is already dead is not something a sweep failed to kill.
function psTable() {
  return (spawnSync('ps', ['-eo', 'pid=,pgid=,sess=,stat='], { encoding: 'utf8' }).stdout || '')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 4 && !parts[3].startsWith('Z'));
}

function pgidsOfSession(sessionId) {
  return psTable()
    .filter((parts) => parts[2] === String(sessionId))
    .map((parts) => parts[1]);
}

// The pids in a session, sorted — a SET to compare against another set, so
// "untouched" means the same processes, not merely some processes.
function membersOfSession(sessionId) {
  return psTable()
    .filter((parts) => parts[2] === String(sessionId))
    .map((parts) => parts[0])
    .sort();
}

// The ledger as it sits on disk. Parsed records compare equal across a write
// that changed formatting, ordering or whitespace; bytes do not, and "wrote
// nothing" is a claim about the file.
//
// Only ENOENT is an answer — "no ledger yet" is an ordinary state of a young
// tree and its bytes are genuinely none. Any other error is the read failing,
// and swallowing it would turn a permission or I/O fault into an empty buffer
// on BOTH snapshots, so a comparison across a call that wrote plenty would
// pass on two lies that happen to match.
function ledgerBytesOf(treeRoot) {
  try {
    return fs.readFileSync(path.join(treeRoot, 'ledger.jsonl'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return Buffer.alloc(0);
  }
}

// A detached session of our own, outside any dispatch, standing in for one a
// dispatch record claims.
function spawnLooseSession(treeRoot, name) {
  const readyFile = path.join(treeRoot, `${name}.ready`);
  const script = siblingGroupScript(treeRoot, `${name}.sh`, readyFile);
  const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
  child.unref();
  assert.ok(
    waitUntil(() => fs.existsSync(readyFile)),
    'the loose session never started'
  );
  return { pid: child.pid, session: String(child.pid) };
}

function killSession(sessionId) {
  for (const parts of psTable().filter((p) => p[2] === String(sessionId))) {
    try {
      process.kill(Number(parts[0]), 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

function ownSession() {
  return (spawnSync('ps', ['-o', 'sess=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout || '').trim();
}

// Every pair this module writes must still be a lawful receipts.js record and
// must still satisfy the correlation law — the wrapper composes those writers,
// it does not get a dialect of its own.
function assertLawfulPair(treeRoot, dispatchId) {
  const records = ledgerOf(treeRoot);
  const dispatch = records.find((r) => r.kind === 'dispatch' && r.dispatch_id === dispatchId);
  const terminals = records.filter((r) => r.kind === 'dispatch-terminal' && r.dispatch_id === dispatchId);

  assert.ok(dispatch !== undefined, `no dispatch record for ${dispatchId}`);
  assert.equal(terminals.length, 1, `expected exactly one terminal for ${dispatchId}`);

  const strip = (record) => {
    const { schema_version, seq, kind, ts, correlation_id, ...payload } = record;
    return payload;
  };
  assert.equal(recordProblem('dispatch', strip(dispatch)), null);
  assert.equal(recordProblem('dispatch-terminal', strip(terminals[0])), null);
  assert.deepEqual(terminals[0].transport_ref, dispatch.transport_ref);
  assert.ok(terminals[0].seq > dispatch.seq, 'the terminal was written before its own dispatch');
  return { dispatch, terminal: terminals[0] };
}

function replayInFreshProcess(fnName, args) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-replay-'));
  const scriptPath = path.join(scriptDir, 'replay.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const mod = require(${JSON.stringify(MODULE_PATH)});\n` +
      `const { fn, args } = JSON.parse(process.argv[2]);\n` +
      `Promise.resolve(mod[fn](...args)).then((v) => process.stdout.write(JSON.stringify(v)));\n`
  );
  const out = execFileSync(process.execPath, [scriptPath, JSON.stringify({ fn: fnName, args })], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

// ---------- codexInvocation ----------

test('codexInvocation builds the S0 spike invocation, prompt on stdin and result out of band', () => {
  const treeRoot = makeTree();
  writePrompt(treeRoot);

  const invocation = codexInvocation(treeRoot, {
    dispatch_id: 'D1',
    prompt_ref: 'prompt.md',
    workdir: '/some/work/dir',
    effort: 'high',
    sandbox: 'read-only',
    model: 'gpt-5.6-sol',
  });

  const args = invocation.args;
  assert.equal(invocation.command, 'codex');
  assert.deepEqual(args.slice(0, 2), ['exec', '-m']);
  assert.equal(args[2], 'gpt-5.6-sol');
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('-C') + 1], '/some/work/dir');
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.equal(args[args.indexOf('-c') + 1], 'model_reasoning_effort="high"');
  assert.equal(args[args.indexOf('-o') + 1], resultPathOf(treeRoot, 'D1'));
  // The prompt reaches codex on stdin, never as an argument: a brief is too
  // big for an argv and a `</dev/null`-less codex hangs to its timeout.
  assert.equal(args[args.length - 1], '-');
  // The prompt travels as CONTENT, not as a path: a child that could open the
  // file itself could start without being released.
  assert.equal(invocation.stdin, 'do the work\n');
  assert.equal(invocation.model_id, 'gpt-5.6-sol');
});

test('codexInvocation names the codex model without being told, and takes one when it is', () => {
  const treeRoot = makeTree();
  writePrompt(treeRoot);

  // The brief's signature has no model field: a seat routed to codex is routed
  // to Sol, and the record says which model ran either way.
  const byDefault = codexInvocation(treeRoot, codexSpec(treeRoot));
  assert.equal(byDefault.model_id, 'gpt-5.6-sol');
  assert.equal(byDefault.args[byDefault.args.indexOf('-m') + 1], 'gpt-5.6-sol');

  const named = codexInvocation(treeRoot, codexSpec(treeRoot, { model: 'gpt-5.6-sol-mini' }));
  assert.equal(named.model_id, 'gpt-5.6-sol-mini');
});

test('codexInvocation refuses an effort, a sandbox or a model outside the vocabulary it may name', () => {
  const treeRoot = makeTree();
  writePrompt(treeRoot);
  const base = codexSpec(treeRoot, { effort: 'high' });

  assert.throws(() => codexInvocation(treeRoot, { ...base, effort: 'ultra' }), /effort/);
  assert.throws(() => codexInvocation(treeRoot, { ...base, sandbox: 'anything-goes' }), /sandbox/);
});

test('codexInvocation refuses a prompt that is not there, and one that escapes the tree', () => {
  const treeRoot = makeTree();
  writePrompt(treeRoot);
  const base = codexSpec(treeRoot);

  assert.throws(() => codexInvocation(treeRoot, { ...base, prompt_ref: 'nope.md' }), /prompt_ref/);
  assert.throws(() => codexInvocation(treeRoot, { ...base, prompt_ref: undefined }), /prompt_ref/);
  assert.throws(() => codexInvocation(treeRoot, { ...base, prompt_ref: '../outside.md' }), /outside the tree/);
  assert.throws(() => codexInvocation(treeRoot, { ...base, prompt_ref: '/etc/passwd' }), /outside the tree/);
  assert.throws(() => codexInvocation(treeRoot, { ...base, workdir: '' }), /workdir/);
  assert.throws(() => codexInvocation(treeRoot, { ...base, dispatch_id: '' }), /dispatch_id/);
  // The module's own words, not JavaScript's: a bare destructure of null also
  // says "spec", so a looser pattern would pass with the guard gone.
  assert.throws(() => codexInvocation(treeRoot, null), /codexInvocation requires a dispatch spec object/);
});

// ---------- the native pair ----------

test('dispatchNative writes one dispatch record carrying the native transport shape, and no terminal', () => {
  const treeRoot = makeTree();

  const opened = dispatchNative(treeRoot, nativeSpec());

  assert.equal(opened.state, 'opened');
  assert.match(opened.ref, /^ledger:\d+$/);
  assert.equal(opened.record.kind, 'dispatch');
  assert.equal(opened.record.transport, 'native');
  // The handle a receipt written before the work can name: the id the
  // workflow already holds.
  assert.deepEqual(opened.record.transport_ref, { task_ref: 'D1' });
  // Derived from the transport rather than taken from the caller — choosing a
  // native step IS intending Claude, and a caller free to say otherwise could
  // name a family its own dispatch contradicts.
  assert.equal(opened.record.intended_family, 'claude');
  assert.equal(opened.record.prompt_ref, 'briefs/C1.md');
  assert.equal(recordsOfKind(treeRoot, 'dispatch').length, 1);
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 0);
  // The bound the workflow must hold its own agent step to: the class is named
  // once, here, so no workflow script restates a number.
  assert.ok(Number.isInteger(opened.bound_ms) && opened.bound_ms > 0);
});

test('dispatchNative refuses a task class the timeout table does not define', () => {
  const treeRoot = makeTree();

  assert.throws(() => dispatchNative(treeRoot, nativeSpec({ task_class: 'vibes' })), /no task class "vibes"/);
  assert.equal(ledgerOf(treeRoot).length, 0);
});

test('the native return says whether to run the Agent step, at every boundary', () => {
  const treeRoot = makeTree();

  // Newly opened: run it.
  assert.equal(dispatchNative(treeRoot, nativeSpec()).state, 'opened');

  // Opened before, never closed: whether the step already ran is unknowable,
  // so the id is spent and the caller must NOT run it again. Anything weaker
  // here — returning the same dispatch record, say — reads to a workflow as
  // "go ahead", and the Agent step runs twice.
  const again = dispatchNative(treeRoot, nativeSpec());
  assert.equal(again.state, 'recovered');
  assert.equal(again.record.kind, 'dispatch-terminal');
  assert.equal(again.record.reason, 'abandoned');

  // Closed: still do not run it.
  const settled = dispatchNative(treeRoot, nativeSpec());
  assert.equal(settled.state, 'settled');
  assert.equal(settled.record.kind, 'dispatch-terminal');

  assert.equal(recordsOfKind(treeRoot, 'dispatch').length, 1);
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 1);
});

test('a native dispatch whose step already completed replays as settled, never as opened', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());
  fs.mkdirSync(path.join(treeRoot, 'results'));
  fs.writeFileSync(path.join(treeRoot, 'results', 'C1.md'), '# the work\n');
  completeNative(treeRoot, { dispatch_id: 'D1', model_id: 'opus-5', result_ref: 'results/C1.md' });

  const replayed = dispatchNative(treeRoot, nativeSpec());

  assert.equal(replayed.state, 'settled');
  assert.equal(replayed.record.status, 'ok');
});

test('completeNative writes an ok terminal only with a model identity AND a real result artifact', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());
  fs.mkdirSync(path.join(treeRoot, 'results'));
  const resultFile = path.join(treeRoot, 'results', 'C1.md');
  fs.writeFileSync(resultFile, '# the work\n');

  completeNative(treeRoot, {
    dispatch_id: 'D1',
    model_id: 'opus-5',
    result_ref: 'results/C1.md',
  });

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'ok');
  assert.equal(terminal.builder, 'claude-fallback');
  assert.equal(terminal.result_ref, 'results/C1.md');
  // ON THE RECORD, not merely in the return: a crash here loses nothing, and a
  // later rewrite of the artifact has something to conflict with.
  assert.equal(terminal.model_id, 'opus-5');
  assert.equal(terminal.result_digest, sha256Of(resultFile));
});

test('a native build with no result artifact is failed, never ok', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());

  completeNative(treeRoot, {
    dispatch_id: 'D1',
    model_id: 'opus-5',
    result_ref: 'results/never-written.md',
  });

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.builder, null);
  assert.match(terminal.reason, /result/);
  assert.equal(terminal.result_ref, undefined);
  // A failure attests nothing, because it produced nothing to attest.
  assert.equal(terminal.model_id, undefined);
  assert.equal(terminal.result_digest, undefined);
});

test('an EMPTY result artifact is no result artifact', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());
  fs.mkdirSync(path.join(treeRoot, 'results'));
  fs.writeFileSync(path.join(treeRoot, 'results', 'C1.md'), '');

  completeNative(treeRoot, {
    dispatch_id: 'D1',
    model_id: 'opus-5',
    result_ref: 'results/C1.md',
  });

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.builder, null);
});

test('a native build with no model identity is failed even when its artifact is real', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());
  fs.mkdirSync(path.join(treeRoot, 'results'));
  fs.writeFileSync(path.join(treeRoot, 'results', 'C1.md'), '# the work\n');

  completeNative(treeRoot, { dispatch_id: 'D1', result_ref: 'results/C1.md' });

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.builder, null);
  assert.match(terminal.reason, /model/);
});

test('a result artifact reached by traversal is no result artifact', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());
  const outside = path.join(path.dirname(treeRoot), 'outside-result.md');
  fs.writeFileSync(outside, '# not this tree\n');

  try {
    assert.throws(
      () =>
        completeNative(treeRoot, {
          dispatch_id: 'D1',
          model_id: 'opus-5',
          result_ref: '../outside-result.md',
        }),
      /outside the tree/
    );
    assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 0);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

test('a caller-declared failure reason wins over a result artifact that happens to be there', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());
  fs.mkdirSync(path.join(treeRoot, 'results'));
  fs.writeFileSync(path.join(treeRoot, 'results', 'C1.md'), '# a partial draft\n');

  completeNative(treeRoot, {
    dispatch_id: 'D1',
    model_id: 'opus-5',
    result_ref: 'results/C1.md',
    reason: 'timeout',
  });

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.reason, 'timeout');
  assert.equal(terminal.builder, null);
});

test('completeNative refuses a dispatch_id that was never dispatched', () => {
  const treeRoot = makeTree();

  assert.throws(
    () => completeNative(treeRoot, { dispatch_id: 'D9', model_id: 'opus-5', result_ref: 'r.md' }),
    /no dispatch record/
  );
});

test('completeNative refuses a codex dispatch — the native pair closes native dispatches only', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'quick.sh', ['exit 0']);
  await dispatchProcess(treeRoot, processSpec({ dispatch_id: 'DP' }), invocationFor(script), {
    boundMs: WIDE_BOUND_MS,
  });

  assert.throws(
    () => completeNative(treeRoot, { dispatch_id: 'DP', model_id: 'opus-5', result_ref: 'r.md' }),
    /native/
  );
});

test('a second close of the same dispatch citing a different outcome fails closed', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());
  fs.mkdirSync(path.join(treeRoot, 'results'));
  const evidence = { dispatch_id: 'D1', model_id: 'opus-5', result_ref: 'results/C1.md' };

  // Recorded as having produced nothing, because at the time it had not.
  completeNative(treeRoot, evidence);
  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');

  // The artifact appears afterwards. A dispatch already recorded as failed
  // cannot be re-answered as a success, and this is why there is no replay
  // short circuit ahead of the write: the conflict has to reach the record.
  fs.writeFileSync(path.join(treeRoot, 'results', 'C1.md'), '# late\n');

  assert.throws(() => completeNative(treeRoot, evidence), /conflicting duplicate/);
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 1);
});

test('completeNative replays: the terminal on disk is the receipt, and no second terminal is written', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());
  fs.mkdirSync(path.join(treeRoot, 'results'));
  fs.writeFileSync(path.join(treeRoot, 'results', 'C1.md'), '# the work\n');
  const evidence = { dispatch_id: 'D1', model_id: 'opus-5', result_ref: 'results/C1.md' };

  const first = completeNative(treeRoot, evidence);
  const replayed = replayInFreshProcess('completeNative', [treeRoot, evidence]);

  // The receipt a replay hands back is the receipt of the terminal already on
  // the ledger — same record, cited the same way, and no second one written.
  // This is also what makes the retry at the workflow's hands boundary safe:
  // asking the same operation again is answered by what is already durable.
  assert.equal(replayed.ref, first.ref);
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 1);
  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(first.ref, `ledger:${terminal.seq}`);
});

// WHAT COMES BACK TRAVELS THROUGH A MODEL, AND EVERY BYTE OF IT IS EXPOSURE.
// The only caller of this operation is a workflow whose runtime cannot read
// disk: the return crosses back to it inside a seat's reply, retyped by hand.
// BURN-1 corrupted six of eight of those replies by one character, and this was
// the largest and most deeply nested payload any op in the table returned — ref
// plus the whole terminal record plus the whole evidence object, three closing
// braces in a row for a seat to miscount.
//
// The script reads `.ref` and nothing else, and the record it would otherwise
// be handed is already on the ledger, where a reader who needs it goes. So the
// return is the receipt: one field, and the whole truth left where it is
// durable.
test('completeNative answers with its receipt alone — the record stays on the ledger', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());
  fs.mkdirSync(path.join(treeRoot, 'results'));
  const resultFile = path.join(treeRoot, 'results', 'C1.md');
  fs.writeFileSync(resultFile, '# the work\n');

  const done = completeNative(treeRoot, {
    dispatch_id: 'D1',
    model_id: 'opus-5',
    result_ref: 'results/C1.md',
  });

  assert.deepEqual(Object.keys(done), ['ref']);
  // And nothing was lost by leaving: the ref resolves to the terminal that
  // carries every field the return used to restate.
  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(done.ref, `ledger:${terminal.seq}`);
  assert.equal(terminal.status, 'ok');
  assert.equal(terminal.builder, 'claude-fallback');
  assert.equal(terminal.model_id, 'opus-5');
  assert.equal(terminal.result_digest, sha256Of(resultFile));
});

// ---------- the process transport ----------

test('a child faster than its bound is never interrupted, and its whole result artifact survives', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'slow-but-fine.sh', [
    'sleep 0.3',
    `echo complete > "${resultPathOf(treeRoot, 'D1')}"`,
  ]);

  const started = Date.now();
  const done = await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: 3000 });
  const elapsed = Date.now() - started;

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'ok');
  assert.notEqual(terminal.reason, 'timeout');
  assert.ok(elapsed < 3000, `the wrapper waited ${elapsed}ms, past its own bound`);
  // A value coming back is not the same fact as the work never having been
  // interrupted: an enforcer that aborted at once and then let the child's exit
  // resolve anyway would satisfy the first and violate the second.
  assert.equal(done.evidence.interrupted, false, 'the bound signalled a child that finished in time');
  // A killed child would have left this missing or half-written; the complete
  // content is the proof the work ran to its own end.
  assert.equal(fs.readFileSync(resultPathOf(treeRoot, 'D1'), 'utf8'), 'complete\n');
  assert.equal(done.evidence.result_digest, sha256Of(resultPathOf(treeRoot, 'D1')));
});

test('builder is sol only on the evidence of a codex session banner, never on intent', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'banner.sh', [
    'echo "session id: 019fc563-021f-7f10-a8c4-99f7d44f25e0" >&2',
    `echo built > "${resultPathOf(treeRoot, 'D1')}"`,
  ]);

  const done = await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'ok');
  assert.equal(terminal.builder, 'sol');
  assert.equal(done.evidence.codex_session, '019fc563-021f-7f10-a8c4-99f7d44f25e0');
});

test('a successful child with no provenance banner is ok with builder null — success is not authorship', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'silent.sh', [`echo built > "${resultPathOf(treeRoot, 'D2')}"`]);

  const done = await dispatchProcess(treeRoot, processSpec({ dispatch_id: 'D2' }), invocationFor(script), {
    boundMs: WIDE_BOUND_MS,
  });

  const { terminal } = assertLawfulPair(treeRoot, 'D2');
  assert.equal(terminal.status, 'ok');
  assert.equal(terminal.builder, null);
  assert.equal(done.evidence.codex_session, null);
});

test('a non-zero exit is failed, and the terminal names the status it exited with', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'fail.sh', [`echo half > "${resultPathOf(treeRoot, 'D1')}"`, 'exit 3']);

  await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.builder, null);
  assert.match(terminal.reason, /3/);
  // A failed dispatch cites no result: whatever the child left behind is not
  // one, and a caller must never be handed it as one.
  assert.equal(terminal.result_ref, undefined);
});

test('a child that exits clean with no result artifact is failed, never ok', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'nothing.sh', ['exit 0']);

  await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.match(terminal.reason, /result/);
});

test('a command that does not exist is a recorded failure — it was dispatched, and it failed', async () => {
  const treeRoot = makeTree();

  // A process WAS created and released: the gate shim ran, took its token, and
  // found nothing to exec. Something went out and came back failed, so that is
  // what the pair says. Throwing instead would leave a spent dispatch_id with
  // no account of itself.
  await dispatchProcess(
    treeRoot,
    processSpec(),
    invocationFor('/nonexistent/binary', { command: '/nonexistent/binary', args: [] }),
    { boundMs: WIDE_BOUND_MS }
  );

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.builder, null);
  assert.match(terminal.reason, /exit-status-127/);
});

test('the recorded ids are the ones the OS actually gave the child, read back off ps', async () => {
  const treeRoot = makeTree();
  const readyFile = path.join(treeRoot, 'tree.ready');
  const script = siblingGroupScript(treeRoot, 'tree.sh', readyFile);

  // The module takes the child's group and session from the pid, on the
  // platform's guarantee that a detached fork leads both. That guarantee is
  // what makes a session sweep addressable at all, so it is checked here
  // against ps rather than assumed — while the child is still alive, since a
  // dead one tells ps nothing.
  const pending = dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: 1200 });
  assert.ok(
    await waitUntilAsync(() => fs.existsSync(readyFile)),
    'the child never reached its ready mark'
  );
  const dispatch = ledgerOf(treeRoot).find((r) => r.kind === 'dispatch');
  const observed = (
    spawnSync('ps', ['-o', 'pgid=,sess=', '-p', String(dispatch.transport_ref.pid)], { encoding: 'utf8' }).stdout || ''
  )
    .trim()
    .split(/\s+/);
  await pending;

  assert.equal(dispatch.transport, 'codex');
  assert.ok(Number.isInteger(dispatch.transport_ref.pid) && dispatch.transport_ref.pid > 0);
  assert.deepEqual(observed, [String(dispatch.transport_ref.pgid), dispatch.transport_ref.session]);
  assert.equal(dispatch.transport_ref.pgid, dispatch.transport_ref.pid);
  assert.equal(dispatch.transport_ref.session, String(dispatch.transport_ref.pid));
});

test('a child killed by a signal is failed, and the terminal names the signal', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'selfkill.sh', [`echo half > "${resultPathOf(treeRoot, 'D1')}"`, 'kill -9 $$']);

  await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });

  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.match(terminal.reason, /SIGKILL/);
  assert.equal(terminal.result_ref, undefined);
});

test('a timed-out child is swept whole by session, leaving no orphan and exactly one terminal', async () => {
  const treeRoot = makeTree();
  const readyFile = path.join(treeRoot, 'tree.ready');
  const script = siblingGroupScript(treeRoot, 'tree.sh', readyFile);

  const pending = dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: 1500 });
  assert.ok(
    await waitUntilAsync(() => fs.existsSync(readyFile)),
    'the child never reached its ready mark'
  );
  // Sampled while the child is still alive, so the fixture proves it built the
  // hard case: a kill of the recorded PGID alone would leave the siblings
  // running and this test would find survivors.
  const liveDispatch = ledgerOf(treeRoot).find((r) => r.kind === 'dispatch');
  const observedPgids = pgidsOfSession(liveDispatch.transport_ref.session);
  const done = await pending;

  const { terminal, dispatch } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.reason, 'timeout');
  assert.equal(terminal.builder, null);
  assert.ok(
    new Set(observedPgids).size >= 2,
    `the fixture never produced sibling process groups (saw ${JSON.stringify(observedPgids)})`
  );
  assert.deepEqual(pgidsOfSession(dispatch.transport_ref.session), [], 'the session outlived its own sweep');
  assert.equal(done.evidence.survivors, 0);
  assert.equal(done.evidence.interrupted, true);
});

test('a driver that dispatched a child does not outlive its own work waiting on it', () => {
  // Proven in a real process, the way C5 proved withBound clears its timer: an
  // in-process test cannot see a handle keeping the event loop open. The child
  // outlives its bound here, so if the wrapper held it, this would sit for the
  // child's whole three hundred seconds instead of exiting on the terminal.
  const treeRoot = makeTree();
  const readyFile = path.join(treeRoot, 'long.ready');
  const script = writeScript(treeRoot, 'long.sh', [`echo ready > ${readyFile}`, 'sleep 300']);
  const driver = path.join(treeRoot, 'driver.js');
  fs.writeFileSync(
    driver,
    `'use strict';\n` +
      `const { dispatchProcess } = require(${JSON.stringify(MODULE_PATH)});\n` +
      `dispatchProcess(${JSON.stringify(treeRoot)}, ${JSON.stringify(processSpec())}, ` +
      `${JSON.stringify(invocationFor(script))}, { boundMs: 300 })\n` +
      `  .then((r) => process.stdout.write(r.record.reason));\n`
  );

  const started = Date.now();
  const out = execFileSync(process.execPath, [driver], { encoding: 'utf8', timeout: 30000 });

  assert.equal(out, 'timeout');
  assert.ok(Date.now() - started < 30000, 'the driver outlived its own dispatch');
});

test('a driver killed between the launch and the receipt leaves a child that never worked', () => {
  // The window B2 names, exercised as the real thing: a driver process that
  // dies after the OS has created its child but before the child's identity is
  // durable. The kill is planted inside the ledger write itself, so it lands in
  // the window rather than near it.
  const treeRoot = makeTree();
  const marker = path.join(treeRoot, 'the-child-worked');
  const script = writeScript(treeRoot, 'gated.sh', [`echo "$instruction" > ${marker}`, 'sleep 300']);
  const driver = path.join(treeRoot, 'driver.js');
  fs.writeFileSync(
    driver,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const realAppend = fs.appendFileSync;\n` +
      `fs.appendFileSync = (file, data) => {\n` +
      `  if (String(file).endsWith('ledger.jsonl')) process.kill(process.pid, 'SIGKILL');\n` +
      `  return realAppend(file, data);\n` +
      `};\n` +
      `const { dispatchProcess } = require(${JSON.stringify(MODULE_PATH)});\n` +
      `dispatchProcess(${JSON.stringify(treeRoot)}, ${JSON.stringify(processSpec())}, ` +
      `${JSON.stringify(invocationFor(script))}, { boundMs: 60000 }).catch(() => {});\n`
  );

  const run = spawnSync(process.execPath, [driver], { encoding: 'utf8', timeout: 20000 });
  assert.equal(run.signal, 'SIGKILL', 'the driver was supposed to die inside the window');

  // The child was created — but it was created BLOCKED, and the pipe holding
  // it died with the driver, so it read EOF instead of an instruction.
  assert.ok(
    waitUntil(() => spawnSync('pgrep', ['-f', script], { encoding: 'utf8' }).status !== 0, 10000),
    'a child outlived the driver that never recorded it'
  );
  assert.equal(fs.existsSync(marker), false, 'an unrecorded child did the work anyway');
  assert.equal(ledgerOf(treeRoot).length, 0, 'a record survived a crash that was supposed to precede it');
});

test('a crash AFTER the transcripts exist spends the id — the residue is what spends it', async () => {
  // "No ledger record" is not the same fact as "unspent". This crash lands
  // inside the ledger write, which is AFTER the transcripts were created — so
  // the id carries deterministic residue, and the retry has to take a new one.
  // The absence of a record says nothing on its own.
  const treeRoot = makeTree();
  const marker = path.join(treeRoot, 'the-child-worked');
  const script = writeScript(treeRoot, 'gated.sh', [`echo "$instruction" > ${marker}`]);
  const driver = path.join(treeRoot, 'driver.js');
  fs.writeFileSync(
    driver,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const realAppend = fs.appendFileSync;\n` +
      `fs.appendFileSync = (file, data) => {\n` +
      `  if (String(file).endsWith('ledger.jsonl')) process.kill(process.pid, 'SIGKILL');\n` +
      `  return realAppend(file, data);\n` +
      `};\n` +
      `const { dispatchProcess } = require(${JSON.stringify(MODULE_PATH)});\n` +
      `dispatchProcess(${JSON.stringify(treeRoot)}, ${JSON.stringify(processSpec())}, ` +
      `${JSON.stringify(invocationFor(script))}, { boundMs: 60000 }).catch(() => {});\n`
  );
  spawnSync(process.execPath, [driver], { encoding: 'utf8', timeout: 20000 });
  assert.equal(ledgerOf(treeRoot).length, 0);
  // The driver died holding the append lock, exactly as a power loss leaves
  // it. jsonl.js reclaims a lock older than its stale window; backdating it is
  // how that thirty seconds passes here instead of being waited out.
  // Two of them, in fact: the receipts lock and, nested inside it, the ledger's
  // own append lock.
  const stale = new Date(Date.now() - 60000);
  const locks = fs.readdirSync(treeRoot).filter((name) => name.endsWith('.lock'));
  assert.ok(locks.length > 0, 'the driver was supposed to die inside its own append transaction');
  for (const name of locks) fs.utimesSync(path.join(treeRoot, name), stale, stale);
  // The transcripts the crashed attempt opened are on disk under D1.
  assert.ok(fs.existsSync(path.join(treeRoot, 'dispatch', 'D1.out')), 'the crash left no residue to reason about');

  // So D1 is refused for exactly that reason...
  const retryScript = writeScript(treeRoot, 'retry.sh', [`echo "$instruction" > "${resultPathOf(treeRoot, 'D2')}"`]);
  await assert.rejects(
    () => dispatchProcess(treeRoot, processSpec(), invocationFor(retryScript), { boundMs: WIDE_BOUND_MS }),
    /residue/
  );

  // ...and the retry succeeds under a new one.
  const done = await dispatchProcess(treeRoot, processSpec({ dispatch_id: 'D2' }), invocationFor(retryScript), {
    boundMs: WIDE_BOUND_MS,
  });

  assert.equal(done.record.status, 'ok');
  assert.equal(fs.readFileSync(resultPathOf(treeRoot, 'D2'), 'utf8'), 'do the work\n');
});

test('a crash BEFORE anything exists leaves the id genuinely unspent, and it is reused', async () => {
  // The only shape that makes an id free again: no ledger record AND no
  // artifact of any kind under it. Staged by killing the driver at the moment
  // it reaches for the first transcript, before that file is created.
  const treeRoot = makeTree();
  const marker = path.join(treeRoot, 'the-child-worked');
  const script = writeScript(treeRoot, 'gated.sh', [`echo "$instruction" > ${marker}`]);
  const driver = path.join(treeRoot, 'driver.js');
  fs.writeFileSync(
    driver,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const realOpen = fs.openSync;\n` +
      `fs.openSync = (file, flags, ...rest) => {\n` +
      `  if (String(file).endsWith('.out')) process.kill(process.pid, 'SIGKILL');\n` +
      `  return realOpen(file, flags, ...rest);\n` +
      `};\n` +
      `const { dispatchProcess } = require(${JSON.stringify(MODULE_PATH)});\n` +
      `dispatchProcess(${JSON.stringify(treeRoot)}, ${JSON.stringify(processSpec())}, ` +
      `${JSON.stringify(invocationFor(script))}, { boundMs: 60000 }).catch(() => {});\n`
  );
  const run = spawnSync(process.execPath, [driver], { encoding: 'utf8', timeout: 20000 });
  assert.equal(run.signal, 'SIGKILL', 'the driver was supposed to die before it opened a transcript');

  // Both absences, asserted rather than assumed — either one alone would leave
  // the id spent, and only together do they mean nothing happened under it.
  assert.equal(ledgerOf(treeRoot).length, 0, 'a record was written');
  for (const artifact of ['D1.result.md', 'D1.out', 'D1.err']) {
    assert.equal(fs.existsSync(path.join(treeRoot, 'dispatch', artifact)), false, `${artifact} was created`);
  }
  assert.equal(fs.existsSync(marker), false, 'a child did the work');

  // Only now is reusing D1 itself the right thing.
  const retry = writeScript(treeRoot, 'retry.sh', [`echo "$instruction" > "${resultPathOf(treeRoot, 'D1')}"`]);
  const done = await dispatchProcess(treeRoot, processSpec(), invocationFor(retry), { boundMs: WIDE_BOUND_MS });

  assert.equal(done.record.status, 'ok');
  assert.equal(done.record.dispatch_id, 'D1');
});

test('the ledger snapshot an untouched-tree assertion rests on reports a failed read', () => {
  const treeRoot = makeTree();
  // A read that fails is not an empty ledger. If it answered like one, the
  // before/after comparison every refusal test rests on would compare two
  // empty buffers and pass over a call that wrote the whole file.
  fs.mkdirSync(path.join(treeRoot, 'ledger.jsonl'));

  assert.throws(() => ledgerBytesOf(treeRoot), (err) => err.code === 'EISDIR');

  // And a tree that simply has no ledger yet still answers with no bytes.
  assert.deepEqual(ledgerBytesOf(makeTree()), Buffer.alloc(0));
});

test('a dispatch_id belongs to the transport that opened it — the native pair will not touch a codex one', async () => {
  const treeRoot = makeTree();
  const readyFile = path.join(treeRoot, 'tree.ready');
  const script = siblingGroupScript(treeRoot, 'tree.sh', readyFile);

  // A codex dispatch left pending: a live session, a record, no terminal.
  // A bound short enough that awaiting it at the end costs a second, not a
  // minute — the subject here is the refusal, not the bound.
  const pending = dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: 1500 });
  assert.ok(
    await waitUntilAsync(() => fs.existsSync(readyFile)),
    'the child never reached its ready mark'
  );
  const dispatch = ledgerOf(treeRoot).find((r) => r.kind === 'dispatch');
  const ledgerBefore = ledgerBytesOf(treeRoot);
  const membersBefore = membersOfSession(dispatch.transport_ref.session);
  assert.ok(membersBefore.length >= 3, 'the fixture session never had members to leave alone');

  // The native pair has no business here. Recovering it would sweep a session
  // the caller cannot see, and answering `settled` or `recovered` would tell a
  // workflow something about work it never dispatched.
  assert.throws(() => dispatchNative(treeRoot, nativeSpec()), /transport-mismatch/);

  // The file, byte for byte — parsed records would compare equal across a
  // rewrite that changed nothing semantic, and the claim is that nothing was
  // written at all.
  assert.deepEqual(ledgerBytesOf(treeRoot), ledgerBefore, 'a refused call wrote to the ledger');
  // The same processes, not merely some processes: a partial sweep leaves
  // survivors, and a count or a non-empty check would call that untouched.
  assert.deepEqual(
    membersOfSession(dispatch.transport_ref.session),
    membersBefore,
    'a refused call disturbed the session'
  );

  await pending;
});

test('and the process wrapper will not touch a native one', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'quick.sh', [`echo built > "${resultPathOf(treeRoot, 'D1')}"`]);
  dispatchNative(treeRoot, nativeSpec());
  const before = ledgerBytesOf(treeRoot);

  await assert.rejects(
    () => dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS }),
    /transport-mismatch/
  );

  assert.deepEqual(ledgerBytesOf(treeRoot), before, 'a refused call wrote to the ledger');
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 0, 'the native record stopped being pending');
  assert.equal(fs.existsSync(path.join(treeRoot, 'dispatch')), false, 'a refused call launched a child');
});

test('a dispatch directory that leads out of the tree is refused before anything is written through it', async () => {
  const treeRoot = makeTree();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-elsewhere-'));
  fs.symlinkSync(outside, path.join(treeRoot, 'dispatch'));
  writePrompt(treeRoot);
  const script = writeScript(treeRoot, 'quick.sh', ['exit 0']);

  // Every artifact of a process dispatch is composed under this directory —
  // the transcripts it opens for writing, the result it digests, and the path
  // codex is handed as its own `-o` target. Checking each leaf would check the
  // wrong thing: they all spell their way inside a directory that leaves.
  await assert.rejects(
    () => dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS }),
    /the dispatch directory .* leads outside the tree/
  );
  assert.throws(() => codexInvocation(treeRoot, codexSpec(treeRoot)), /the dispatch directory/);

  assert.deepEqual(fs.readdirSync(outside), [], 'something was written outside the tree');
  assert.equal(ledgerOf(treeRoot).length, 0);
});

test('a dispatch_id carrying residue from a crashed attempt is refused, not overwritten', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'quick.sh', [`echo built > "${resultPathOf(treeRoot, 'D1')}"`]);
  fs.mkdirSync(path.join(treeRoot, 'dispatch'), { recursive: true });

  for (const residue of ['D1.result.md', 'D1.out', 'D1.err']) {
    const file = path.join(treeRoot, 'dispatch', residue);
    fs.writeFileSync(file, 'left over from an attempt that died\n');

    // Both ways of being wrong about residue are bad: digest it and a child
    // that produced nothing seals someone else's output; truncate it and the
    // only trace of the crashed attempt is gone.
    await assert.rejects(
      () => dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS }),
      /residue/,
      `${residue} should have refused the launch`
    );
    assert.equal(fs.readFileSync(file, 'utf8'), 'left over from an attempt that died\n');
    assert.equal(ledgerOf(treeRoot).length, 0);
    fs.rmSync(file);
  }
});

test('a stale result artifact can never be sealed as the output of a child that produced nothing', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'nothing.sh', ['exit 0']);
  fs.mkdirSync(path.join(treeRoot, 'dispatch'), { recursive: true });
  fs.writeFileSync(resultPathOf(treeRoot, 'D1'), '# somebody else work\n');

  await assert.rejects(
    () => dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS }),
    /residue/
  );

  // The alternative this refusal exists to prevent: a `/bin/true` of a child
  // exiting zero over a result it never wrote, digested and sealed as its own.
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 0);
});

test('the wrapper never launches twice for one dispatch_id: a completed dispatch replays its terminal', async () => {
  const treeRoot = makeTree();
  const result = resultPathOf(treeRoot, 'D1');
  const script = writeScript(treeRoot, 'once.sh', [`echo run >> "${result}"`]);

  const first = await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });
  const second = await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });

  assert.deepEqual(second.record, first.record);
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 1);
  assert.equal(fs.readFileSync(result, 'utf8'), 'run\n', 'the second call ran the child again');
});

test('dispatching repeatedly leaks none of the descriptors it opens for the child', async () => {
  const treeRoot = makeTree();
  writePrompt(treeRoot);
  const script = writeScript(treeRoot, 'quick.sh', ['exit 0']);
  const invocation = invocationFor(script);
  const openCount = () => fs.readdirSync('/proc/self/fd').length;

  await dispatchProcess(treeRoot, processSpec({ dispatch_id: 'W0' }), invocation, { boundMs: WIDE_BOUND_MS });
  const before = openCount();
  for (const id of ['W1', 'W2', 'W3', 'W4', 'W5']) {
    await dispatchProcess(treeRoot, processSpec({ dispatch_id: id }), invocation, { boundMs: WIDE_BOUND_MS });
  }

  // Three descriptors per dispatch — the prompt, and the two captured streams
  // — is a driver that runs out of file handles partway through a milestone.
  assert.ok(openCount() <= before + 1, `open descriptors went from ${before} to ${openCount()}`);
});

test('re-entering a dispatch that FAILED replays its terminal too, citing no result', async () => {
  const treeRoot = makeTree();
  const result = resultPathOf(treeRoot, 'D1');
  const script = writeScript(treeRoot, 'fail-once.sh', [`echo run >> "${result}"`, 'exit 3']);

  const first = await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });
  const second = await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });

  assert.deepEqual(second.record, first.record);
  assert.equal(second.evidence.result_ref, null);
  assert.equal(second.evidence.result_digest, null);
  // The artifact the failed run left behind is still on disk, and re-entry
  // must not start citing it as a result now that the run is over.
  assert.equal(fs.readFileSync(result, 'utf8'), 'run\n');
});

test('a fresh process re-entering a completed dispatch gets the same terminal, and no second launch', async () => {
  const treeRoot = makeTree();
  const result = resultPathOf(treeRoot, 'D1');
  const script = writeScript(treeRoot, 'once.sh', [`echo run >> "${result}"`]);
  const first = await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });

  const replayed = replayInFreshProcess('dispatchProcess', [
    treeRoot,
    processSpec(),
    invocationFor(script),
    { boundMs: WIDE_BOUND_MS },
  ]);

  assert.deepEqual(replayed.record, first.record);
  assert.equal(fs.readFileSync(result, 'utf8'), 'run\n');
});

test('a dispatch_id left pending is recovered, never relaunched — a relaunch needs a new id', async () => {
  const treeRoot = makeTree();
  const result = resultPathOf(treeRoot, 'D1');
  const script = writeScript(treeRoot, 'once.sh', [`echo run >> "${result}"`]);
  // A codex dispatch record with no terminal and a session that is long gone:
  // the pre-launch boundary, exactly as a crashed driver leaves it.
  const dead = spawnLooseSession(treeRoot, 'departed');
  writeDispatch(treeRoot, {
    dispatch_id: 'D1',
    seat: 'implementer',
    transport: 'codex',
    intended_family: 'gpt',
    task_class: 'chunk_implementation',
    prompt_ref: 'prompt.md',
    transport_ref: { pid: dead.pid, pgid: dead.pid, session: dead.session },
  });
  killSession(dead.session);
  assert.ok(
    await waitUntilAsync(() => pgidsOfSession(dead.session).length === 0),
    'the fixture session never died'
  );

  const recovered = await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });

  assert.equal(recovered.record.kind, 'dispatch-terminal');
  assert.equal(recovered.record.status, 'failed');
  assert.equal(recovered.record.reason, 'abandoned');
  assert.equal(fs.existsSync(result), false, 'the wrapper relaunched a dispatch_id that was already used');
});

// ---------- recovery at the three boundaries ----------

test('recoverDispatches closes a pre-launch pending dispatch as abandoned, and is idempotent', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());

  const first = recoverDispatches(treeRoot);
  const second = recoverDispatches(treeRoot);

  assert.equal(first.length, 1);
  assert.equal(first[0].dispatch_id, 'D1');
  assert.equal(first[0].action, 'abandoned');
  const { terminal } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.reason, 'abandoned');
  assert.deepEqual(second, []);
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 1);
});

test('recoverDispatches reaps a session a dead driver left in flight, and records one terminal', () => {
  const treeRoot = makeTree();
  const loose = spawnLooseSession(treeRoot, 'inflight');
  // The dispatch record is written AFTER its child started, exactly as the
  // wrapper writes it — which is what makes this session claimable.
  writeDispatch(treeRoot, {
    dispatch_id: 'DX',
    seat: 'implementer',
    transport: 'codex',
    intended_family: 'gpt',
    task_class: 'chunk_implementation',
    prompt_ref: 'prompt.md',
    transport_ref: { pid: loose.pid, pgid: loose.pid, session: loose.session },
  });
  assert.ok(pgidsOfSession(loose.session).length >= 3, 'the fixture session never had members to reap');

  const recovered = recoverDispatches(treeRoot);

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].action, 'reaped');
  const { terminal } = assertLawfulPair(treeRoot, 'DX');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.reason, 'orphaned');
  assert.deepEqual(pgidsOfSession(loose.session), []);
});

test('a fresh process reaps a session its dead predecessor left in flight', () => {
  // The boundary as it actually occurs: the driver that launched the child is
  // gone, and a successor process — with no memory, no handle, and only the
  // recorded session id — has to end it.
  const treeRoot = makeTree();
  const loose = spawnLooseSession(treeRoot, 'inherited');
  writeDispatch(treeRoot, {
    dispatch_id: 'DI',
    seat: 'implementer',
    transport: 'codex',
    intended_family: 'gpt',
    task_class: 'chunk_implementation',
    prompt_ref: 'prompt.md',
    transport_ref: { pid: loose.pid, pgid: loose.pid, session: loose.session },
  });
  assert.ok(pgidsOfSession(loose.session).length >= 3, 'the fixture session never had members to reap');

  const recovered = replayInFreshProcess('recoverDispatches', [treeRoot]);

  assert.equal(recovered[0].action, 'reaped');
  assert.deepEqual(pgidsOfSession(loose.session), []);
  const { terminal } = assertLawfulPair(treeRoot, 'DI');
  assert.equal(terminal.reason, 'orphaned');
});

test('recovery refuses to kill a session it cannot prove is the one that was dispatched', () => {
  const treeRoot = makeTree();
  // A live session that started AFTER the record claiming it — the shape a
  // recycled pid takes once the real child is long gone. Killing it would
  // destroy somebody else's work, so the recovery records the truth instead.
  const loose = spawnLooseSession(treeRoot, 'bystander');
  try {
    const stale = new Date(Date.now() - 3600 * 1000).toISOString();
    appendLine(path.join(treeRoot, 'ledger.jsonl'), {
      schema_version: 1,
      seq: 0,
      kind: 'dispatch',
      ts: stale,
      correlation_id: 'DY',
      dispatch_id: 'DY',
      seat: 'implementer',
      transport: 'codex',
      intended_family: 'gpt',
      task_class: 'chunk_implementation',
      prompt_ref: 'prompt.md',
      transport_ref: { pid: loose.pid, pgid: loose.pid, session: loose.session },
    });

    const recovered = recoverDispatches(treeRoot);

    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].action, 'unclaimable');
    const { terminal } = assertLawfulPair(treeRoot, 'DY');
    assert.equal(terminal.status, 'failed');
    assert.match(terminal.reason, /session/);
    // The one refusal left: a LIVE leader that started after the record naming
    // it, which the real child could not have done. Positive evidence of pid
    // recycling, not an absence of evidence about the leader.
    assert.match(recovered[0].why, /recycled/);
    assert.ok(pgidsOfSession(loose.session).length >= 3, 'the recovery killed a session it could not claim');
  } finally {
    killSession(loose.session);
  }
});

test('recoverDispatches leaves an already-terminal dispatch alone', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'quick.sh', ['exit 0']);
  await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });
  const before = ledgerOf(treeRoot);

  assert.deepEqual(recoverDispatches(treeRoot), []);
  assert.deepEqual(ledgerOf(treeRoot), before);
});

test('recoverDispatches closes every pending dispatch, not only the first', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'DA' }));
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'DB' }));

  const recovered = recoverDispatches(treeRoot);

  assert.deepEqual(
    recovered.map((entry) => entry.dispatch_id),
    ['DA', 'DB']
  );
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 2);
});

test('a ledger that does not read whole is refused by THIS module, before it decides anything', () => {
  // The refusal must be this module's own. receipts.js refuses the same
  // damaged stream a moment later, so an assertion that only matched the words
  // would pass with this guard gone — and the decision it guards is made
  // first: "no terminal for this dispatch" read off a stream that half-parsed
  // is how a dispatch gets launched a second time.
  for (const [label, junk] of [
    ['a line that is not JSON', '{not json\n'],
    ['a line that parses but is no record', `${JSON.stringify({ kind: 'dispatch' })}\n`],
  ]) {
    const treeRoot = makeTree();
    dispatchNative(treeRoot, nativeSpec());
    fs.appendFileSync(path.join(treeRoot, 'ledger.jsonl'), junk);

    assert.throws(() => recoverDispatches(treeRoot), /^Error: dispatch: /, label);
  }
});

test('a damaged ledger stops a launch, rather than risking a second child for a spent id', async () => {
  const treeRoot = makeTree();
  const result = resultPathOf(treeRoot, 'D1');
  const script = writeScript(treeRoot, 'once.sh', [`echo run >> "${result}"`]);
  await dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS });
  fs.appendFileSync(path.join(treeRoot, 'ledger.jsonl'), '{not json\n');

  // The records saying this id is already spent are in a stream that no longer
  // reads whole, so nothing here may conclude it is free.
  await assert.rejects(
    () => dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS }),
    /^Error: dispatch: /
  );
  assert.equal(fs.readFileSync(result, 'utf8'), 'run\n', 'a damaged ledger let the child run twice');
});

test('every entry point refuses a treeRoot that is not one', async () => {
  assert.throws(() => recoverDispatches(''), /treeRoot/);
  assert.throws(() => dispatchNative('', nativeSpec()), /treeRoot/);
  assert.throws(() => completeNative('', { dispatch_id: 'D1' }), /treeRoot/);
  assert.throws(() => codexInvocation('', {}), /treeRoot/);
  await assert.rejects(() => dispatchProcess('', processSpec(), { command: '/bin/true', args: [] }, {}), /treeRoot/);
});

test('recovery closes a codex dispatch whose session is simply gone as abandoned', () => {
  const treeRoot = makeTree();
  const loose = spawnLooseSession(treeRoot, 'departed');
  writeDispatch(treeRoot, {
    dispatch_id: 'DZ',
    seat: 'implementer',
    transport: 'codex',
    intended_family: 'gpt',
    task_class: 'chunk_implementation',
    prompt_ref: 'prompt.md',
    transport_ref: { pid: loose.pid, pgid: loose.pid, session: loose.session },
  });
  killSession(loose.session);
  assert.ok(
    waitUntil(() => pgidsOfSession(loose.session).length === 0),
    'the fixture session never died'
  );

  const recovered = recoverDispatches(treeRoot);

  assert.equal(recovered[0].action, 'abandoned');
  const { terminal } = assertLawfulPair(treeRoot, 'DZ');
  assert.equal(terminal.reason, 'abandoned');
});

test('a recorded session outliving its own leader is still reaped whole', () => {
  const treeRoot = makeTree();
  const readyFile = path.join(treeRoot, 'leaderless.ready');
  // The leader exits and its backgrounded children carry on in the same
  // session. These are this dispatch's orphans and nobody else will collect
  // them: refusing to sweep because the leader is gone would leave two
  // processes running forever and call the dispatch complete.
  const script = writeScript(treeRoot, 'leaderless.sh', [
    'set -m',
    'sleep 300 &',
    'sleep 300 &',
    `echo ready > ${readyFile}`,
    'exit 0',
  ]);
  const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
  child.unref();
  assert.ok(
    waitUntil(() => fs.existsSync(readyFile) && pgidsOfSession(String(child.pid)).length === 2),
    'the fixture never outlived its own leader'
  );
  try {
    writeDispatch(treeRoot, {
      dispatch_id: 'DL',
      seat: 'implementer',
      transport: 'codex',
      intended_family: 'gpt',
      task_class: 'chunk_implementation',
      prompt_ref: 'prompt.md',
      transport_ref: { pid: child.pid, pgid: child.pid, session: String(child.pid) },
    });

    const recovered = recoverDispatches(treeRoot);

    assert.equal(recovered[0].action, 'reaped');
    assert.equal(recovered[0].evidence.survivors, 0);
    assert.deepEqual(pgidsOfSession(String(child.pid)), []);
    const { terminal } = assertLawfulPair(treeRoot, 'DL');
    assert.equal(terminal.reason, 'orphaned');
  } finally {
    killSession(String(child.pid));
  }
});

test('a leader reaped away entirely does not excuse the orphan it left behind', async () => {
  const treeRoot = makeTree();
  const readyFile = path.join(treeRoot, 'reaped.ready');
  const script = writeScript(treeRoot, 'reaped.sh', [
    'set -m',
    'sleep 300 &',
    `echo ready > ${readyFile}`,
    'exit 0',
  ]);
  // Deliberately NOT unref'd: this test waits on the child's own exit event,
  // and an unref'd handle does not hold the event loop open — with nothing
  // else ref'd, node would exit here and take the rest of the file with it.
  const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
  // Awaited rather than slept through, so the event loop turns and this
  // process reaps its exited child: the leader then has no row in the process
  // table at all, which is what a crashed driver's successor actually finds.
  await new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    (spawnSync('ps', ['-o', 'stat=', '-p', String(child.pid)], { encoding: 'utf8' }).stdout || '').trim(),
    '',
    'the leader was still in the process table'
  );
  try {
    writeDispatch(treeRoot, {
      dispatch_id: 'DR',
      seat: 'implementer',
      transport: 'codex',
      intended_family: 'gpt',
      task_class: 'chunk_implementation',
      prompt_ref: 'prompt.md',
      transport_ref: { pid: child.pid, pgid: child.pid, session: String(child.pid) },
    });
    assert.equal(pgidsOfSession(String(child.pid)).length, 1, 'the fixture kept no orphan in the session');

    const recovered = recoverDispatches(treeRoot);

    assert.equal(recovered[0].action, 'reaped');
    assert.deepEqual(pgidsOfSession(String(child.pid)), []);
  } finally {
    killSession(String(child.pid));
  }
});

test('recovery cannot claim a session id that is not addressable at all', () => {
  const treeRoot = makeTree();
  // receipts.js requires only that a session be a non-empty string, so a
  // record from somewhere else can name one no sweep could ever address.
  writeDispatch(treeRoot, {
    dispatch_id: 'DU',
    seat: 'implementer',
    transport: 'codex',
    intended_family: 'gpt',
    task_class: 'chunk_implementation',
    prompt_ref: 'prompt.md',
    transport_ref: { pid: 4242, pgid: 4242, session: 'not-a-session' },
  });

  const recovered = recoverDispatches(treeRoot);

  assert.equal(recovered[0].action, 'unclaimable');
  const { terminal } = assertLawfulPair(treeRoot, 'DU');
  assert.equal(terminal.reason, 'unclaimable-session');
});

test('recovery in a fresh process closes the same pending dispatch exactly once', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec());

  const recovered = replayInFreshProcess('recoverDispatches', [treeRoot]);

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].action, 'abandoned');
  assert.deepEqual(recoverDispatches(treeRoot), []);
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 1);
});

// ---------- the guards that keep a sweep addressable ----------

test('sessionMembers refuses this process own session — a sweep must never reach the driver', () => {
  assert.throws(() => sessionMembers(ownSession()), /own session/);
});

test('sessionMembers refuses a session id that is not one', () => {
  assert.throws(() => sessionMembers(''), /session/);
  assert.throws(() => sessionMembers('0'), /session/);
  assert.throws(() => sessionMembers('not-a-pid'), /session/);
  assert.throws(() => sessionMembers(1234), /session/);
});

test('dispatchProcess refuses an invocation with no command, before it writes anything', async () => {
  const treeRoot = makeTree();

  await assert.rejects(() => dispatchProcess(treeRoot, processSpec(), { args: [] }, {}), /command/);
  assert.equal(ledgerOf(treeRoot).length, 0);
});

test('sweepSession refuses a session it must never address', () => {
  // The last guard between a wrapper that lost track of its own child and a
  // sweep that kills the driver running it.
  assert.throws(() => sweepSession(ownSession()), /own session/);
  assert.throws(() => sweepSession('not-a-pid'), /is not a session id/);
});

test('a session that ignores SIGTERM is escalated to SIGKILL rather than waited out forever', async () => {
  const treeRoot = makeTree();
  const readyFile = path.join(treeRoot, 'trapper.ready');
  const script = writeScript(treeRoot, 'trapper.sh', ["trap '' TERM", `echo ready > ${readyFile}`, 'sleep 300']);

  const pending = dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: 400 });
  assert.ok(
    await waitUntilAsync(() => fs.existsSync(readyFile)),
    'the trapping child never started'
  );
  const done = await pending;

  const { terminal, dispatch } = assertLawfulPair(treeRoot, 'D1');
  assert.equal(terminal.reason, 'timeout');
  assert.equal(done.evidence.survivors, 0);
  assert.deepEqual(pgidsOfSession(dispatch.transport_ref.session), []);
});

test('dispatchProcess refuses a spec that is not a dispatch, and launches nothing when it does', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'quick.sh', ['exit 0']);

  await assert.rejects(
    () => dispatchProcess(treeRoot, processSpec({ dispatch_id: 'not a safe id' }), invocationFor(script), {}),
    /dispatch_id/
  );
  await assert.rejects(() => dispatchProcess(treeRoot, null, invocationFor(script), {}), /spec object/);
  assert.equal(ledgerOf(treeRoot).length, 0);
  // An id that names paths is checked before those paths are built: with the
  // check late, the child has already run by the time the record refuses it.
  assert.equal(fs.existsSync(path.join(treeRoot, 'dispatch')), false, 'a refused spec still launched a child');
});

test('dispatchProcess refuses an invocation whose args are not a list of strings', async () => {
  const treeRoot = makeTree();

  await assert.rejects(() => dispatchProcess(treeRoot, processSpec(), { command: '/bin/bash' }, {}), /args/);
  await assert.rejects(
    () => dispatchProcess(treeRoot, processSpec(), { command: '/bin/bash', args: ['-c', 7] }, {}),
    /args/
  );
  await assert.rejects(() => dispatchProcess(treeRoot, processSpec(), null, {}), /invocation object/);

  // The instruction and the model are contract, not decoration: without the
  // first there is nothing to release the child with, and without the second a
  // successful terminal cannot attest what built its result.
  const script = writeScript(treeRoot, 'quick.sh', ['exit 0']);
  const noStdin = invocationFor(script);
  delete noStdin.stdin;
  await assert.rejects(() => dispatchProcess(treeRoot, processSpec(), noStdin, {}), /"stdin"/);
  const noModel = invocationFor(script);
  delete noModel.model_id;
  await assert.rejects(() => dispatchProcess(treeRoot, processSpec(), noModel, {}), /"model_id"/);

  assert.equal(ledgerOf(treeRoot).length, 0);
});

test('the native pair names what is missing rather than failing further downstream', () => {
  const treeRoot = makeTree();

  assert.throws(() => dispatchNative(treeRoot, null), /spec object/);
  assert.throws(() => completeNative(treeRoot, null), /evidence object/);
  // Without these two, the call reaches the ledger and comes back with "no
  // dispatch record for undefined" — a true sentence about the wrong problem.
  assert.throws(() => completeNative(treeRoot, { model_id: 'opus-5' }), /non-empty "dispatch_id"/);

  // Every field the brief's own signature declares, refused by name when it is
  // missing — a record cannot be assembled out of four fields when three
  // arrived, and "missing required field" from the schema underneath names the
  // record's vocabulary rather than the caller's.
  const noPayload = nativeSpec();
  delete noPayload.payload_ref;
  assert.throws(() => dispatchNative(treeRoot, noPayload), /non-empty "payload_ref"/);
  const noSeat = nativeSpec();
  delete noSeat.seat;
  assert.throws(() => dispatchNative(treeRoot, noSeat), /non-empty "seat"/);

  assert.equal(ledgerOf(treeRoot).length, 0);
});

test('dispatchProcess refuses a spec with no seat, before it launches anything', async () => {
  const treeRoot = makeTree();
  const script = writeScript(treeRoot, 'quick.sh', ['exit 0']);
  const noSeat = processSpec();
  delete noSeat.seat;

  await assert.rejects(() => dispatchProcess(treeRoot, noSeat, invocationFor(script), {}), /non-empty "seat"/);
  assert.equal(ledgerOf(treeRoot).length, 0);
  assert.equal(fs.existsSync(path.join(treeRoot, 'dispatch')), false);
});

test('dispatchCodex succeeds through the brief signature alone, against a real codex on PATH', async () => {
  const treeRoot = makeTree();
  writePrompt(treeRoot, 'implement C1\n');
  // A stand-in codex, found the way the real one is found — by name, on PATH.
  // No option lets a caller substitute the command, so the binding API is
  // exercised exactly as a workflow would call it, argv and all.
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-bin-'));
  fs.writeFileSync(
    path.join(binDir, 'codex'),
    [
      '#!/bin/bash',
      'instruction=$(cat)',
      'out=""',
      'while [[ $# -gt 0 ]]; do',
      '  if [[ $1 == "-o" ]]; then out=$2; shift; fi',
      '  shift',
      'done',
      'echo "session id: 019fc563-021f-7f10-a8c4-99f7d44f25e0" >&2',
      'printf "%s\\n" "$instruction" > "$out"',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  const priorPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${priorPath}`;

  try {
    // Exactly the seven fields the brief declares. Nothing else.
    const done = await dispatchCodex(
      treeRoot,
      {
        dispatch_id: 'D1',
        seat: 'implementer',
        task_class: 'chunk_implementation',
        prompt_ref: 'prompt.md',
        workdir: treeRoot,
        effort: 'low',
        sandbox: 'read-only',
      },
      { boundMs: WIDE_BOUND_MS }
    );

    const { dispatch, terminal } = assertLawfulPair(treeRoot, 'D1');
    assert.equal(dispatch.transport, 'codex');
    assert.equal(dispatch.intended_family, 'gpt');
    assert.equal(terminal.status, 'ok');
    assert.equal(terminal.builder, 'sol');
    assert.equal(terminal.model_id, 'gpt-5.6-sol');
    assert.equal(terminal.result_ref, 'dispatch/D1.result.md');
    assert.equal(terminal.result_digest, sha256Of(resultPathOf(treeRoot, 'D1')));
    assert.equal(done.evidence.codex_session, '019fc563-021f-7f10-a8c4-99f7d44f25e0');
    // The prompt reached the child on stdin, after the receipt — end to end.
    assert.equal(fs.readFileSync(resultPathOf(treeRoot, 'D1'), 'utf8'), 'implement C1\n');
  } finally {
    process.env.PATH = priorPath;
  }
});

test('a path that LEADS outside the tree is outside it, however it is spelled', () => {
  const treeRoot = makeTree();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-elsewhere-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'not this tree\n');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(treeRoot, 'prompt.md'));
  fs.mkdirSync(path.join(treeRoot, 'results'));
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(treeRoot, 'results', 'C1.md'));

  // A lexical prefix check passes both of these: they spell a path inside the
  // tree and resolve to a file outside it, which is how a prompt gets read or
  // a result gets digested from somewhere this tree does not own.
  assert.throws(() => codexInvocation(treeRoot, codexSpec(treeRoot)), /leads outside the tree/);
  dispatchNative(treeRoot, nativeSpec());
  assert.throws(
    () => completeNative(treeRoot, { dispatch_id: 'D1', model_id: 'opus-5', result_ref: 'results/C1.md' }),
    /leads outside the tree/
  );
  assert.equal(recordsOfKind(treeRoot, 'dispatch-terminal').length, 0);
});

test('a symlink that stays inside the tree is an ordinary path', () => {
  const treeRoot = makeTree();
  fs.mkdirSync(path.join(treeRoot, 'briefs'));
  fs.writeFileSync(path.join(treeRoot, 'briefs', 'real.md'), 'do the work\n');
  fs.symlinkSync(path.join(treeRoot, 'briefs', 'real.md'), path.join(treeRoot, 'prompt.md'));

  // The rule is about where a path leads, not about whether it is a link.
  const invocation = codexInvocation(treeRoot, codexSpec(treeRoot));

  assert.equal(invocation.stdin, 'do the work\n');
});

test('a transcript path that is a symlink out of the tree cannot be opened to write through', async () => {
  const treeRoot = makeTree();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-elsewhere-'));
  const victim = path.join(outside, 'important.txt');
  fs.writeFileSync(victim, 'somebody else file\n');
  fs.mkdirSync(path.join(treeRoot, 'dispatch'), { recursive: true });
  fs.symlinkSync(victim, path.join(treeRoot, 'dispatch', 'D1.out'));
  const script = writeScript(treeRoot, 'quick.sh', ['exit 0']);

  await assert.rejects(
    () => dispatchProcess(treeRoot, processSpec(), invocationFor(script), { boundMs: WIDE_BOUND_MS }),
    /residue/
  );

  // Opening a transcript with plain 'w' through that link would have truncated
  // a file in another tree entirely.
  assert.equal(fs.readFileSync(victim, 'utf8'), 'somebody else file\n');
});

test('dispatchCodex refuses what codexInvocation refuses, and launches nothing when it does', async () => {
  const treeRoot = makeTree();
  writePrompt(treeRoot);

  await assert.rejects(
    () =>
      dispatchCodex(
        treeRoot,
        processSpec({ workdir: treeRoot, effort: 'ultra', sandbox: 'read-only', model: 'gpt-5.6-sol' }),
        {}
      ),
    /effort/
  );
  assert.equal(ledgerOf(treeRoot).length, 0);
});

// ---------- a hosted Sol run, attested ----------

// THE VOCABULARY WAS MISSING A WORD. `implementer-sol` is a native Agent step
// whose seat runs Sol through the Codex CLI inside itself. The machine
// dispatched natively, so `claude-fallback` is what C1 could attest — but the
// work was genuinely gpt, and recording it as claude made the cross-family
// seal check refuse the very chunk it had just built, and deleted the routing
// law from the decision.
//
// `sol-hosted` names exactly what happened: a native dispatch whose seat
// hosted a Sol run. Every existing law keeps working unchanged — its lawful
// transport is `native`, so the internally-impossible-record check passes, and
// its family is gpt, so cross-family routing is correct.
test('a native step that hosted a Sol run attests sol-hosted, and its family is gpt', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'H1', seat: 'implementer-sol', execution_mode: 'hosted' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'H1.md'), '# the work\n');

  completeNative(treeRoot, {
    dispatch_id: 'H1',
    model_id: 'gpt-5.6-sol',
    result_ref: 'results/H1.md',
    hosted_session: '019fc563-021f-7f10-a8c4-99f7d44f25e0',
  });

  const { terminal } = assertLawfulPair(treeRoot, 'H1');
  assert.equal(terminal.status, 'ok');
  assert.equal(terminal.builder, 'sol-hosted');
  assert.equal(FAMILY_OF_BUILDER[terminal.builder], 'gpt');
  // The lawful transport for it is native, so the record is not an internally
  // impossible one — that check stays exactly as it was.
  assert.equal(TRANSPORT_OF_BUILDER[terminal.builder], 'native');
});

test('a native step with no hosted session is still claude-fallback', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'H2' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'H2.md'), '# the work\n');

  completeNative(treeRoot, {
    dispatch_id: 'H2',
    model_id: 'opus-5',
    result_ref: 'results/H2.md',
  });

  assert.equal(assertLawfulPair(treeRoot, 'H2').terminal.builder, 'claude-fallback');
});

// A seat cannot claim a hosted Sol run by handing over something that is not a
// session identity. The claim is seat-attested, so its SHAPE is the only thing
// the machine can hold it to — and holding it to nothing would make the
// attestation free.
// THE CLAIM IS BOUND TO WHO MAY LAWFULLY MAKE IT. Shape alone is not evidence
// of anything: a native Opus step carrying any UUID-shaped string would
// otherwise become GPT-family evidence, and the cross-family law would be
// deciding on a coincidence.
test('a seat that does not host Sol cannot claim a hosted run', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'H7', seat: 'implementer-opus', execution_mode: 'hosted' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'H7.md'), '# the work\n');

  assert.throws(
    () =>
      completeNative(treeRoot, {
        dispatch_id: 'H7',
        model_id: 'gpt-5.6-sol',
        result_ref: 'results/H7.md',
        hosted_session: '019fc563-021f-7f10-a8c4-99f7d44f25e0',
      }),
    /does not host/
  );
});

test('a claude model cannot claim a hosted Sol run, whatever seat it sat in', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'H8', seat: 'implementer-sol', execution_mode: 'hosted' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'H8.md'), '# the work\n');

  assert.throws(
    () =>
      completeNative(treeRoot, {
        dispatch_id: 'H8',
        model_id: 'opus-5',
        result_ref: 'results/H8.md',
        hosted_session: '019fc563-021f-7f10-a8c4-99f7d44f25e0',
      }),
    /gpt/i
  );
});

// The session is what the attestation RESTS on, so it has to outlive the call
// that made it. Evidence that only travels in a return value is lost at the
// first crash — C1's own lesson, and here the fact is constitutive rather than
// corroborating, which is exactly when the schema should widen.
test('the hosted session is persisted on the terminal, not discarded', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'H9', seat: 'implementer-sol', execution_mode: 'hosted' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'H9.md'), '# the work\n');

  completeNative(treeRoot, {
    dispatch_id: 'H9',
    model_id: 'gpt-5.6-sol',
    result_ref: 'results/H9.md',
    hosted_session: '019fc563-021f-7f10-a8c4-99f7d44f25e0',
  });

  const { terminal } = assertLawfulPair(treeRoot, 'H9');
  assert.equal(terminal.builder, 'sol-hosted');
  assert.equal(terminal.hosted_session, '019fc563-021f-7f10-a8c4-99f7d44f25e0');
});

test('a malformed hosted session does not buy a gpt attestation', () => {
  const treeRoot = makeTree();
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  for (const [id, bad] of [['H3', 'yes'], ['H4', ''], ['H5', 42], ['H6', 'not-a-uuid-at-all']]) {
    dispatchNative(treeRoot, nativeSpec({ dispatch_id: id, seat: 'implementer-sol', execution_mode: 'hosted' }));
    fs.writeFileSync(path.join(treeRoot, 'results', `${id}.md`), '# the work\n');
    assert.throws(
      () =>
        completeNative(treeRoot, {
          dispatch_id: id,
          model_id: 'gpt-5.6-sol',
          result_ref: `results/${id}.md`,
          hosted_session: bad,
        }),
      /hosted_session/,
      `${JSON.stringify(bad)} was accepted as a session identity`
    );
  }
});

// ---------- a seat that CAN host is not a run that DID ----------

// `milestone-reviewer` is dual-mode by design: native Sonnet when the milestone
// was gpt-dominant, hosted Sol when it was claude-dominant or tied. Binding the
// hosted claim to the SEAT's capability made the lawful native route
// impossible to complete honestly — it would have to attest a session it never
// had. The dispatch declares which mode this run is, and the terminal binds
// against that.
test('a dual-mode seat dispatched natively completes without a hosted session', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'M1', seat: 'milestone-reviewer', execution_mode: 'native' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'M1.md'), '# the review\n');

  completeNative(treeRoot, {
    dispatch_id: 'M1',
    model_id: 'sonnet-5',
    result_ref: 'results/M1.md',
  });

  const { terminal } = assertLawfulPair(treeRoot, 'M1');
  assert.equal(terminal.status, 'ok');
  assert.equal(terminal.builder, 'claude-fallback');
});

test('the same seat dispatched hosted attests gpt from the session it declares', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'M2', seat: 'milestone-reviewer', execution_mode: 'hosted' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'M2.md'), '# the review\n');

  completeNative(treeRoot, {
    dispatch_id: 'M2',
    model_id: 'gpt-5.6-sol',
    result_ref: 'results/M2.md',
    hosted_session: '019fc563-021f-7f10-a8c4-99f7d44f25e0',
  });

  assert.equal(assertLawfulPair(treeRoot, 'M2').terminal.builder, 'sol-hosted');
});

// A run that DECLARED hosted owes the session. Silence is not a downgrade to
// native — the dispatch already said what this run was.
test('a dispatch declared hosted cannot close without its session', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'M3', seat: 'implementer-sol', execution_mode: 'hosted' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'M3.md'), '# the work\n');

  // The SILENCE is what is refused here, and it has to be told apart from a
  // malformed one: without this guard the shape check below still throws, so
  // a laxer assertion would pass while the "a declared hosted run owes its
  // session" rule did nothing.
  assert.throws(
    () => completeNative(treeRoot, { dispatch_id: 'M3', model_id: 'gpt-5.6-sol', result_ref: 'results/M3.md' }),
    /went out in "hosted" mode and its terminal names no "hosted_session"/
  );
});

// And a run that declared NATIVE cannot smuggle one in.
test('a dispatch declared native cannot claim a hosted session', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'M4', seat: 'implementer-sol', execution_mode: 'native' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'M4.md'), '# the work\n');

  assert.throws(
    () =>
      completeNative(treeRoot, {
        dispatch_id: 'M4',
        model_id: 'gpt-5.6-sol',
        result_ref: 'results/M4.md',
        hosted_session: '019fc563-021f-7f10-a8c4-99f7d44f25e0',
      }),
    /native/i
  );
});

// ---------- a run that did not happen has nothing to attest ----------

// THE FAILURE PATH IS DECIDED BEFORE THE ATTESTATION PATH. A hosted agent that
// throws, or reports it wrote nothing, has no session to give — correctly,
// because there was no run. Asking for one before the declared-failure rule
// gets to speak means the known failed terminal is never written at all, and
// recovery later sweeps the dispatch up as generically abandoned: the reason
// the caller actually had is thrown away. Same defect class as the authored
// seats a round earlier, wearing hosted clothes.
test('a hosted dispatch that failed closes with its reason, not a demand for a session', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'F1', seat: 'implementer-sol', execution_mode: 'hosted' }));

  completeNative(treeRoot, {
    dispatch_id: 'F1',
    reason: 'the hosted run threw before it produced anything',
  });

  const { terminal } = assertLawfulPair(treeRoot, 'F1');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.builder, null);
  assert.equal(terminal.reason, 'the hosted run threw before it produced anything');
});

// And the terminal it wrote is a REAL terminal, so recovery has nothing left to
// classify — the reason survives instead of being replaced by "abandoned".
test('recovery does not reclassify a hosted failure it already has the reason for', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'F2', seat: 'implementer-sol', execution_mode: 'hosted' }));
  completeNative(treeRoot, { dispatch_id: 'F2', reason: 'the hosted seat reported that it wrote nothing' });

  recoverDispatches(treeRoot);

  const { terminal } = assertLawfulPair(treeRoot, 'F2');
  assert.equal(terminal.reason, 'the hosted seat reported that it wrote nothing');
  assert.equal(
    readRecords(path.join(treeRoot, 'ledger.jsonl')).records.filter(
      (r) => r.kind === 'dispatch-terminal' && r.dispatch_id === 'F2'
    ).length,
    1,
    'recovery wrote a second terminal over a dispatch that was already closed'
  );
});

// A hosted run that SUCCEEDED still owes its session — the failure path is a
// path for failures, not a way around the attestation.
test('the failure path does not become a way around the attestation', () => {
  const treeRoot = makeTree();
  dispatchNative(treeRoot, nativeSpec({ dispatch_id: 'F3', seat: 'implementer-sol', execution_mode: 'hosted' }));
  fs.mkdirSync(path.join(treeRoot, 'results'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'results', 'F3.md'), '# the work\n');

  assert.throws(
    () => completeNative(treeRoot, { dispatch_id: 'F3', model_id: 'gpt-5.6-sol', result_ref: 'results/F3.md' }),
    /names no "hosted_session"/
  );
});
