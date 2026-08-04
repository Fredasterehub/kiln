'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  recordBuilt,
  reviewerAvailability,
  selectReviewer,
  selectMilestoneReviewer,
  verifyReviewFamily,
} = require('../src/family-evidence.js');
const { seatAgentNames, SEAT_AGENTS } = require('../src/validators.js');
const { createMilestone, recordChunk } = require('../src/milestones.js');
const { writeDispatch, writeDispatchTerminal } = require('../src/receipts.js');
const { stagedDiffDigest } = require('../src/implementation.js');
const { readRecords } = require('../src/stream.js');
const { writeAtomic } = require('../src/atomic-json.js');
const { setActive } = require('../src/routing.js');
const { appendLine } = require('../src/jsonl.js');

const MODULE_PATH = path.resolve(__dirname, '..', 'src', 'family-evidence.js');

const A_DIGEST = `sha256:${'a'.repeat(64)}`;

function git(repoRoot, ...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

// A real git repo with the tree inside it, because a chunk-built carries the
// digest of the diff the build actually produced — and a mocked git would
// prove nothing about where that digest comes from.
function makeWorkspace(milestones = ['M1']) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'family-evidence-git-'));
  git(repoRoot, 'init', '-q', '-b', 'main');
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.thelastskill/\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n');
  git(repoRoot, 'add', '.gitignore', 'README.md');
  git(repoRoot, 'commit', '-q', '-m', 'initial');

  const treeRoot = path.join(repoRoot, '.thelastskill');
  fs.mkdirSync(treeRoot, { recursive: true });
  // The routing table a scaffolded tree carries: which model sits in which
  // seat is the dated config's answer, read through routing.js digest and
  // all, never this module's own idea.
  fs.cpSync(path.join(__dirname, '..', 'routing'), path.join(treeRoot, 'routing'), { recursive: true });
  for (const id of milestones) {
    createMilestone(treeRoot, { id, title: `Milestone ${id}`, designer_family: 'gpt' });
  }
  return { repoRoot, treeRoot };
}

function stageWork(repoRoot, name, body) {
  fs.writeFileSync(path.join(repoRoot, name), body);
  git(repoRoot, 'add', name);
}

function chunkRecords(treeRoot, milestoneId) {
  return readRecords(path.join(treeRoot, 'milestones', milestoneId, 'chunks.jsonl')).records;
}

function recordsOfKind(treeRoot, milestoneId, kind) {
  return chunkRecords(treeRoot, milestoneId).filter((record) => record.kind === kind);
}

// spec -> start, the state a chunk is in when its implementer is dispatched.
// `intended` is what the ROUTING said; what actually built it is the whole
// question this module answers, and it is deliberately different in most
// fixtures below.
function startedChunk(treeRoot, milestoneId, chunkId, intended = 'gpt') {
  recordChunk(treeRoot, milestoneId, {
    kind: 'chunk-spec',
    chunk_id: chunkId,
    brief_ref: `${milestoneId}/spec.md#${chunkId}`,
  });
  recordChunk(treeRoot, milestoneId, {
    kind: 'chunk-start',
    chunk_id: chunkId,
    implementer_seat: intended === 'gpt' ? 'implementer' : 'implementer_ui_creative',
    implementer_family: intended,
  });
}

function codexTransportRef(pid = 4242) {
  return { pid, pgid: pid, session: String(pid) };
}

// A NATIVE dispatch and its terminal — the shape a Claude fallback actually
// takes. C1's wrapper only ever reports `claude-fallback` out of this
// transport, and `sol` only ever out of a codex child.
function nativeFallback(treeRoot, dispatchId, overrides = {}) {
  const transportRef = { task_ref: dispatchId };
  writeDispatch(treeRoot, {
    dispatch_id: dispatchId,
    seat: 'implementer_ui_creative',
    transport: 'native',
    intended_family: 'claude',
    task_class: 'chunk_implementation',
    prompt_ref: 'briefs/C1.md',
    transport_ref: transportRef,
  });
  writeDispatchTerminal(treeRoot, {
    dispatch_id: dispatchId,
    status: 'ok',
    builder: 'claude-fallback',
    transport_ref: transportRef,
    result_ref: `results/${dispatchId}.md`,
    model_id: overrides.model_id || 'opus-5',
    result_digest: overrides.result_digest || A_DIGEST,
  });
}

// A dispatch and its terminal, exactly as C1's wrapper leaves them. `builder`
// is the evidence this module reads; everything else is scenery.
function dispatchedAndBuilt(treeRoot, dispatchId, overrides = {}) {
  const transportRef = overrides.transport_ref || codexTransportRef();
  writeDispatch(treeRoot, {
    dispatch_id: dispatchId,
    seat: 'implementer',
    transport: overrides.transport || 'codex',
    intended_family: overrides.intended_family || 'gpt',
    task_class: 'chunk_implementation',
    prompt_ref: 'briefs/C1.md',
    transport_ref: transportRef,
  });
  if (overrides.noTerminal) return;
  if (overrides.status === 'failed') {
    writeDispatchTerminal(treeRoot, {
      dispatch_id: dispatchId,
      status: 'failed',
      builder: null,
      transport_ref: transportRef,
      reason: overrides.reason || 'timeout',
    });
    return;
  }
  writeDispatchTerminal(treeRoot, {
    dispatch_id: dispatchId,
    status: 'ok',
    builder: 'builder' in overrides ? overrides.builder : 'sol',
    transport_ref: transportRef,
    result_ref: 'dispatch/D1.result.md',
    model_id: overrides.model_id || 'gpt-5.6-sol',
    result_digest: overrides.result_digest || A_DIGEST,
  });
}

// A dated routing config of our own, pointed at through routing.js's own
// swap so the digest is real. The config is a dated BET somebody writes, and
// every guard below is about what happens when the bet is wrong.
function repointRouting(treeRoot, seats) {
  const dir = path.join(treeRoot, 'routing');
  const filename = 'routing-2026-08-03-9.json';
  writeAtomic(path.join(dir, filename), {
    schema_version: 1,
    calibrated: '2026-08-03',
    revision: 9,
    seats,
    bans: {},
  });
  setActive(dir, filename);
}

function setPreflightMode(treeRoot, mode) {
  writeAtomic(path.join(treeRoot, 'state.json'), { schema_version: 1, preflight: { mode } });
}

function replayInFreshProcess(fnName, args) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-evidence-replay-'));
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

// ---------- recordBuilt: the evidence, and only the evidence ----------

test('recordBuilt takes the family from what BUILT the chunk, not from what was meant to', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1', 'gpt');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  const built = recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  assert.equal(built.record.kind, 'chunk-built');
  assert.equal(built.record.chunk_id, 'C1');
  assert.equal(built.record.actual_family, 'gpt');
  assert.equal(built.record.model_id, 'gpt-5.6-sol');
  assert.equal(built.record.result_digest, A_DIGEST);
  assert.equal(built.record.diff_digest, stagedDiffDigest(repoRoot));
  assert.match(built.record.dispatch_ref, /^ledger:\d+$/);
});

test('the real fallback sequence: Sol times out, a native Claude rebuild finishes, and the record shows both', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  // The sequence as it actually happens. The chunk went out intending gpt...
  startedChunk(treeRoot, 'M1', 'C1', 'gpt');
  // ...that Sol dispatch timed out and produced nothing...
  dispatchedAndBuilt(treeRoot, 'D1', { status: 'failed', reason: 'timeout' });
  // ...and a SECOND dispatch, native, was what actually built the chunk.
  nativeFallback(treeRoot, 'D2');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  const built = recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D2' }, { repoRoot });

  // Both halves on one record. `intended_family` comes from the CHUNK's own
  // start, not from the fallback dispatch — that dispatch is itself a claude
  // one, so reading intent off it would record intended === actual and erase
  // the divergence this record exists to show.
  assert.equal(built.record.actual_family, 'claude');
  assert.equal(built.record.intended_family, 'gpt');
  assert.equal(built.record.model_id, 'opus-5');
  assert.equal(selectReviewer(treeRoot, 'M1', 'C1').family, 'gpt', 'a claude-built chunk gets a Sol review');
});

test('a terminal that reports success without describing its result is discarded as malformed', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  writeDispatch(treeRoot, {
    dispatch_id: 'D1',
    seat: 'implementer',
    transport: 'codex',
    intended_family: 'gpt',
    task_class: 'chunk_implementation',
    prompt_ref: 'briefs/C1.md',
    transport_ref: codexTransportRef(),
  });
  // receipts.js refuses this shape at write time; a ledger can still acquire
  // one by being hand-edited or restored, and reading is not writing.
  appendLine(path.join(treeRoot, 'ledger.jsonl'), {
    schema_version: 1,
    seq: 1,
    kind: 'dispatch-terminal',
    ts: new Date().toISOString(),
    correlation_id: 'D1',
    dispatch_id: 'D1',
    status: 'ok',
    builder: 'sol',
    transport_ref: codexTransportRef(),
  });
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  // The refusal comes from the write boundary now: composition records what
  // the terminal says, and milestones.js decides whether the tree accepts it.
  assert.throws(
    () => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }),
    /requires a non-empty "model_id"/
  );
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 0);
});

test('a terminal whose builder could not have come out of its own transport is discarded as contradictory', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  // Sol reporting out of a native Agent step: a dispatch that could not have
  // happened, however well the record parses.
  const transportRef = { task_ref: 'D1' };
  writeDispatch(treeRoot, {
    dispatch_id: 'D1',
    seat: 'implementer',
    transport: 'native',
    intended_family: 'claude',
    task_class: 'chunk_implementation',
    prompt_ref: 'briefs/C1.md',
    transport_ref: transportRef,
  });
  writeDispatchTerminal(treeRoot, {
    dispatch_id: 'D1',
    status: 'ok',
    builder: 'sol',
    transport_ref: transportRef,
    result_ref: 'results/D1.md',
    model_id: 'gpt-5.6-sol',
    result_digest: A_DIGEST,
  });
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  assert.throws(
    () => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }),
    /a dispatch that could not have happened/
  );
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 0);
});

test('a chunk that never started has no intent to record a build against', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/spec.md#C1' });
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  assert.throws(() => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }), /no "chunk-start" record/);
});

test('a dispatch with no terminal yet builds nothing — the attempt is not over', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1', { noTerminal: true });
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  assert.throws(() => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }), /no terminal/);
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 0);
});

test('a FAILED terminal discards the attempt — no record, and therefore no reviewer', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1', { status: 'failed' });
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  // A failed terminal has no builder and no result to describe, so there is
  // nothing to compose a build out of and the boundary refuses the attempt on
  // the first thing it finds missing. What matters is the outcome, not which
  // sentence arrives: no record, and therefore no reviewer. The boundary's own
  // "did not succeed" refusal — for a WELL-FORMED record citing a failed
  // terminal — is exercised in milestones.test.js, where that record can be
  // handed to it directly.
  assert.throws(() => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }), /chunk-built/);
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 0);
  assert.throws(() => selectReviewer(treeRoot, 'M1', 'C1'), /no "chunk-built"/);
});

test('a successful terminal that cannot name its builder proves no family, and is discarded', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  // C1's law: a clean exit with a real artifact and no provenance banner is
  // `ok` with builder null — success, by somebody the machine cannot name.
  dispatchedAndBuilt(treeRoot, 'D1', { builder: null });
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  // Composition records the family the terminal proves, which for an unnamed
  // builder is none — and a record with no family is one the boundary refuses.
  assert.throws(
    () => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }),
    /requires "actual_family" to be one of claude, gpt/
  );
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 0);
});

test('a dispatch_id with nothing behind it composes nothing, and writes nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  assert.throws(
    () => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D9' }, { repoRoot }),
    /has no terminal record/
  );
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 0);
});

test('one dispatch builds one chunk — a second chunk may not claim the same work', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  startedChunk(treeRoot, 'M1', 'C2');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  // Otherwise a chunk nobody implemented inherits a successful dispatch and
  // walks into review carrying somebody else's evidence.
  assert.throws(() => recordBuilt(treeRoot, 'M1', 'C2', { dispatch_id: 'D1' }, { repoRoot }), /already claimed/);
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 1);
});

test('one dispatch builds one chunk ACROSS the tree, not just within a milestone', () => {
  const { repoRoot, treeRoot } = makeWorkspace(['M1', 'M2']);
  startedChunk(treeRoot, 'M1', 'C1');
  startedChunk(treeRoot, 'M2', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  // A dispatch_id names a ledger record every milestone can see, so a claim
  // check scoped to one stream lets the next milestone adopt the same
  // terminal — genuine evidence, belonging to somebody else.
  assert.throws(
    () => recordBuilt(treeRoot, 'M2', 'C1', { dispatch_id: 'D1' }, { repoRoot }),
    /already claimed by chunk "C1" of milestone "M1"/
  );
  assert.equal(recordsOfKind(treeRoot, 'M2', 'chunk-built').length, 0);
});

test('recordBuilt refuses a chunk that never started', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/spec.md#C1' });
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  assert.throws(() => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }), /chunk-start/);
});

test('recordBuilt replays: the record on disk is the receipt, and nothing is appended twice', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');

  const first = recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });
  const replayed = recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  assert.deepEqual(replayed.record, first.record);
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 1);
});

test('a replay whose diff has MOVED is a different build wearing a recorded identity, and fails closed', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  stageWork(repoRoot, 'work.txt', 'a second, unrecorded revision\n');

  assert.throws(
    () => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }),
    /already recorded a different/
  );
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 1);
});

test('a fresh process re-entering a recorded build gets the same record', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  const first = recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  const replayed = replayInFreshProcess('recordBuilt', [treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }]);

  assert.deepEqual(replayed.record, first.record);
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built').length, 1);
});

test('recordBuilt refuses a ledger it cannot read whole', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  fs.appendFileSync(path.join(treeRoot, 'ledger.jsonl'), '{not json\n');

  // Deciding "this dispatch has no terminal" from a stream that half-parsed
  // is how a failed attempt gets recorded as a build. Anchored on this
  // module's own words, because receipts.js refuses the same damaged stream a
  // moment later and a looser pattern could not tell whose guard fired.
  assert.throws(() => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }), /^Error: family-evidence: /);
});

test('recordBuilt refuses a ledger line that parses but is no record', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  appendLine(path.join(treeRoot, 'ledger.jsonl'), { kind: 'dispatch-terminal' });

  assert.throws(() => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot }), /common JSONL header/);
});

// ---------- selectReviewer: cross-family, from actual authorship ----------

test('a chunk Sol built is reviewed by the Claude seat', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  const reviewer = selectReviewer(treeRoot, 'M1', 'C1');

  assert.equal(reviewer.routing_key, 'chunk_review_of_gpt_work');
  assert.equal(reviewer.seat, 'chunk-reviewer-sonnet');
  assert.equal(reviewer.model, 'sonnet-5');
  assert.equal(reviewer.family, 'claude');
  assert.equal(reviewer.actual_family, 'gpt');
  assert.equal(reviewer.degraded, false);
});

test('a chunk Claude built is reviewed by the Sol seat, with the scope the routing config declares', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1', 'claude');
  nativeFallback(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  const reviewer = selectReviewer(treeRoot, 'M1', 'C1');

  assert.equal(reviewer.routing_key, 'chunk_review_of_claude_work');
  assert.equal(reviewer.seat, 'chunk-reviewer-sol');
  assert.equal(reviewer.model, 'gpt-5.6-sol');
  assert.equal(reviewer.family, 'gpt');
  assert.equal(reviewer.effort, 'medium');
  assert.equal(reviewer.scope, 'scoped');
});

test('no reviewer exists before the evidence of who built it does', () => {
  const { treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');

  assert.throws(() => selectReviewer(treeRoot, 'M1', 'C1'), /no "chunk-built"/);
});

test('chunk ids are milestone-local: two milestones with a C1 each get their own reviewers', () => {
  const { repoRoot, treeRoot } = makeWorkspace(['M1', 'M2']);
  // The same chunk id in both milestones, built by DIFFERENT families. Any
  // lookup that keys on the chunk id alone answers one of these with the
  // other's evidence, and the wrong answer here is a same-family review.
  startedChunk(treeRoot, 'M1', 'C1', 'gpt');
  startedChunk(treeRoot, 'M2', 'C1', 'claude');
  dispatchedAndBuilt(treeRoot, 'D1');
  nativeFallback(treeRoot, 'D2');
  stageWork(repoRoot, 'm1.txt', 'M1 work\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });
  stageWork(repoRoot, 'm2.txt', 'M2 work\n');
  recordBuilt(treeRoot, 'M2', 'C1', { dispatch_id: 'D2' }, { repoRoot });

  assert.equal(selectReviewer(treeRoot, 'M1', 'C1').family, 'claude');
  assert.equal(selectReviewer(treeRoot, 'M2', 'C1').family, 'gpt');
  assert.equal(recordsOfKind(treeRoot, 'M1', 'chunk-built')[0].actual_family, 'gpt');
  assert.equal(recordsOfKind(treeRoot, 'M2', 'chunk-built')[0].actual_family, 'claude');
});

// A same-family substitute would be reviewed work that can never be sealed:
// `milestones.js` refuses a chunk-green whose review family is the family that
// built it. So the answer is a declared stop, not a second Claude mind — and
// the question is asked as a pure READ, before any reviewer is dispatched.
test('degraded mode declares the review unavailable instead of seating a same-family reviewer', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  setPreflightMode(treeRoot, 'degraded-claude-only');
  startedChunk(treeRoot, 'M1', 'C1', 'claude');
  nativeFallback(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  const availability = reviewerAvailability(treeRoot, 'M1', 'C1');

  assert.equal(availability.available, false);
  assert.equal(availability.route.expected, 'gpt');
  assert.equal(availability.route.actual, 'none');
  assert.equal(availability.route.scope_ref, 'milestones/M1/C1');
  assert.match(availability.route.reason, /degraded-claude-only/);
  // Injective over the pair: neither id is shape-constrained, so a joined
  // key would let "a-b"/"c" and "a"/"b-c" collide into one route record.
  assert.equal(availability.route.route_id, `chunk-review ${JSON.stringify(['M1', 'C1'])}`);
  // The read writes nothing — the caller that turns a stop into a durable
  // record is the one that writes it, exactly once.
  assert.equal(
    readRecords(path.join(treeRoot, 'ledger.jsonl')).records.filter((r) => r.kind === 'degraded-route').length,
    0
  );
  // And nothing can select a reviewer around it.
  assert.throws(() => selectReviewer(treeRoot, 'M1', 'C1'), /no reviewer to select/);
});

test('the unavailable review does not depend on the degraded table having an entry', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  setPreflightMode(treeRoot, 'degraded-claude-only');
  startedChunk(treeRoot, 'M1', 'C1', 'claude');
  // A Claude model the degraded table pairs with nothing. Under the old
  // substitute path this was its own refusal; the outcome no longer turns on
  // the table at all, because no substitute is sought.
  nativeFallback(treeRoot, 'D1', { model_id: 'fable-5' });
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  assert.equal(reviewerAvailability(treeRoot, 'M1', 'C1').available, false);
  assert.throws(() => selectReviewer(treeRoot, 'M1', 'C1'), /no reviewer to select/);
});

test('degraded mode leaves a Sol-built chunk alone — its reviewer was already a Claude one', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  setPreflightMode(treeRoot, 'degraded-claude-only');
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  const reviewer = selectReviewer(treeRoot, 'M1', 'C1');

  assert.equal(reviewerAvailability(treeRoot, 'M1', 'C1').available, true);
  assert.equal(reviewer.degraded, false);
  assert.equal(reviewer.routing_key, 'chunk_review_of_gpt_work');
  assert.equal(reviewer.seat, 'chunk-reviewer-sonnet');
  assert.equal(readRecords(path.join(treeRoot, 'ledger.jsonl')).records.filter((r) => r.kind === 'degraded-route').length, 0);
});

test('a routing config with no seat for this work refuses rather than inventing one', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });
  repointRouting(treeRoot, { implementer: { model: 'gpt-5.6-sol' } });

  assert.throws(() => selectReviewer(treeRoot, 'M1', 'C1'), /has no seat "chunk_review_of_gpt_work"/);
});

test('a routing config naming a model this tree cannot place refuses to guess its family', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });
  repointRouting(treeRoot, { chunk_review_of_gpt_work: { model: 'some-new-model-7' } });

  // Guessing would put an unplaceable mind on one side of a law about minds
  // being different, and the guess would never be visible again.
  assert.throws(() => selectReviewer(treeRoot, 'M1', 'C1'), /cannot place in a family/);
});

test('a routing config that pairs a family with itself is a defect, not a review', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });
  // The shipped table pairs cross-family by construction — but a table is a
  // dated bet somebody can edit, and this is what happens when the edit is wrong.
  repointRouting(treeRoot, { chunk_review_of_gpt_work: { model: 'gpt-5.6-sol' } });

  assert.throws(() => selectReviewer(treeRoot, 'M1', 'C1'), /the same family that built it/);
});

// ---------- selectMilestoneReviewer: the mirror, one level up ----------

function builtChunk(repoRoot, treeRoot, milestoneId, chunkId, family, dispatchId, pid) {
  startedChunk(treeRoot, milestoneId, chunkId, family);
  // Which transport a family comes out of is not a choice: Sol is a codex
  // child, a Claude build is a native Agent step, and a fixture that mixed
  // them would be describing a dispatch that cannot happen.
  if (family === 'gpt') {
    dispatchedAndBuilt(treeRoot, dispatchId, { transport_ref: codexTransportRef(pid) });
  } else {
    nativeFallback(treeRoot, dispatchId);
  }
  stageWork(repoRoot, `${milestoneId}-${chunkId}.txt`, `${milestoneId} ${chunkId}\n`);
  recordBuilt(treeRoot, milestoneId, chunkId, { dispatch_id: dispatchId }, { repoRoot });
}

test('a milestone Sol mostly built is reviewed by Claude', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  builtChunk(repoRoot, treeRoot, 'M1', 'C1', 'gpt', 'D1', 4242);
  builtChunk(repoRoot, treeRoot, 'M1', 'C2', 'gpt', 'D2', 4243);
  builtChunk(repoRoot, treeRoot, 'M1', 'C3', 'claude', 'D3', 4244);

  const reviewer = selectMilestoneReviewer(treeRoot, 'M1');

  assert.equal(reviewer.dominant_family, 'gpt');
  assert.equal(reviewer.review_family, 'claude');
  assert.equal(reviewer.routing_key, 'milestone_review');
  assert.equal(reviewer.seat, 'milestone-reviewer');
  assert.deepEqual(reviewer.counts, { gpt: 2, claude: 1 });
});

test('a milestone Claude mostly built is reviewed by Sol', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  builtChunk(repoRoot, treeRoot, 'M1', 'C1', 'claude', 'D1', 4242);
  builtChunk(repoRoot, treeRoot, 'M1', 'C2', 'claude', 'D2', 4243);

  const reviewer = selectMilestoneReviewer(treeRoot, 'M1');

  assert.equal(reviewer.dominant_family, 'claude');
  assert.equal(reviewer.review_family, 'gpt');
});

test('an evenly split milestone takes the conservative path, whichever chunk finished last', () => {
  const { repoRoot, treeRoot } = makeWorkspace(['M1', 'M2']);
  builtChunk(repoRoot, treeRoot, 'M1', 'C1', 'gpt', 'D1', 4242);
  builtChunk(repoRoot, treeRoot, 'M1', 'C2', 'claude', 'D2', 4243);
  // The same split, built in the opposite order.
  builtChunk(repoRoot, treeRoot, 'M2', 'C1', 'claude', 'D3', 4244);
  builtChunk(repoRoot, treeRoot, 'M2', 'C2', 'gpt', 'D4', 4245);

  const first = selectMilestoneReviewer(treeRoot, 'M1');
  const second = selectMilestoneReviewer(treeRoot, 'M2');

  // No family dominates, so no reviewer is fully decorrelated and the mirror
  // rule settles it by conservatism: the Sol-hosted path, both times. Deciding
  // by build ORDER would make the reviewing family depend on which chunk
  // happened to finish last — not a property of the work, and it would flip on
  // a rerun that finished differently.
  assert.deepEqual(first.counts, { gpt: 1, claude: 1 });
  assert.equal(first.dominant_family, null);
  assert.equal(first.review_family, 'gpt');
  assert.equal(first.tie_broken_by, 'conservative');
  assert.equal(second.review_family, first.review_family);
});

test('a milestone review has no seat when the routing config does not declare one', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  builtChunk(repoRoot, treeRoot, 'M1', 'C1', 'gpt', 'D1', 4242);
  repointRouting(treeRoot, { implementer: { model: 'gpt-5.6-sol' } });

  assert.throws(() => selectMilestoneReviewer(treeRoot, 'M1'), /has no seat to be held in/);
});

test('a build record whose family cannot be read refuses the tally rather than skipping it', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  builtChunk(repoRoot, treeRoot, 'M1', 'C1', 'gpt', 'D1', 4242);
  // milestones.js refuses this on the way in; a stream that acquired one some
  // other way must not be quietly tallied as though the record were absent —
  // a dominance computed over records it could not read is a number nobody
  // can act on, and it looks exactly like a real one.
  appendLine(path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl'), {
    schema_version: 1,
    seq: 99,
    kind: 'chunk-built',
    ts: new Date().toISOString(),
    correlation_id: 'C9',
    chunk_id: 'C9',
    actual_family: 'sonnet',
  });

  assert.throws(() => selectMilestoneReviewer(treeRoot, 'M1'), /cannot be read as a family/);
});

test('a milestone with nothing built yet has no reviewer to name', () => {
  const { treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');

  assert.throws(() => selectMilestoneReviewer(treeRoot, 'M1'), /no "chunk-built"/);
});

test('milestone reviewers are per milestone, even when the chunk ids repeat', () => {
  const { repoRoot, treeRoot } = makeWorkspace(['M1', 'M2']);
  builtChunk(repoRoot, treeRoot, 'M1', 'C1', 'gpt', 'D1', 4242);
  builtChunk(repoRoot, treeRoot, 'M2', 'C1', 'claude', 'D2', 4243);

  assert.equal(selectMilestoneReviewer(treeRoot, 'M1').review_family, 'claude');
  assert.equal(selectMilestoneReviewer(treeRoot, 'M2').review_family, 'gpt');
});

// ---------- verifyReviewFamily: the seal-time check ----------

test('a seal whose reviewer shares the builder family is refused', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1', 'gpt');
  // Intent said gpt, a Claude fallback actually built it — so a CLAUDE review
  // is now same-family, which the intended-family check alone cannot see.
  nativeFallback(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  assert.throws(() => verifyReviewFamily(treeRoot, 'M1', 'C1', 'claude'), /cross-family/);
  assert.deepEqual(verifyReviewFamily(treeRoot, 'M1', 'C1', 'gpt'), { actual_family: 'claude', review_family: 'gpt' });
});

test('verifyReviewFamily refuses a chunk with no build evidence at all', () => {
  const { treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');

  assert.throws(() => verifyReviewFamily(treeRoot, 'M1', 'C1', 'claude'), /no "chunk-built"/);
});

test('verifyReviewFamily refuses a family outside the closed vocabulary', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  assert.throws(() => verifyReviewFamily(treeRoot, 'M1', 'C1', 'sol'), /must be one of/);
});

// ---------- the arguments themselves ----------

test('every entry point refuses a treeRoot, milestone or chunk that is not one', () => {
  const { treeRoot } = makeWorkspace();

  assert.throws(() => recordBuilt('', 'M1', 'C1', { dispatch_id: 'D1' }), /treeRoot/);
  assert.throws(() => recordBuilt(treeRoot, '', 'C1', { dispatch_id: 'D1' }), /milestoneId/);
  assert.throws(() => recordBuilt(treeRoot, 'M1', '', { dispatch_id: 'D1' }), /chunkId/);
  // The module's own sentence: a bare property read on null also says
  // "dispatch_id", so a looser pattern would pass with the guard gone.
  assert.throws(() => recordBuilt(treeRoot, 'M1', 'C1', null), /requires a non-empty "dispatch_id"/);
  assert.throws(() => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: '' }), /requires a non-empty "dispatch_id"/);
  assert.throws(() => selectReviewer('', 'M1', 'C1'), /treeRoot/);
  assert.throws(() => selectMilestoneReviewer('', 'M1'), /treeRoot/);
  assert.throws(() => verifyReviewFamily('', 'M1', 'C1', 'gpt'), /treeRoot/);
});

// ---------- selectors return INSTALLED seat names ----------

// A routing KEY is not a seat name. `chunk_review_of_claude_work` is what the
// config calls the slot; `chunk-reviewer-sol` is the agent that exists on
// disk. Passing the former as an `agentType` binds nothing, and the live run
// is where that was discovered — so the map between the two closed
// vocabularies lives in validators.js, where they meet, and the suite asserts
// every name a selector can return is really installed.
const AGENTS_DIR = path.join(__dirname, '..', '..', 'agents');

function installedAgent(name) {
  return fs.existsSync(path.join(AGENTS_DIR, `${name}.md`));
}

test('selectReviewer returns the seat name as installed, never the routing key', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1', 'gpt');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  const selection = selectReviewer(treeRoot, 'M1', 'C1');

  assert.equal(selection.seat, 'chunk-reviewer-sonnet');
  assert.ok(installedAgent(selection.seat), `${selection.seat} is not installed in agents/`);
  assert.equal(selection.family, 'claude');
});

test('a claude-built chunk routes to the installed Sol reviewer', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1', 'claude');
  nativeFallback(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  const selection = selectReviewer(treeRoot, 'M1', 'C1');

  assert.equal(selection.seat, 'chunk-reviewer-sol');
  assert.ok(installedAgent(selection.seat));
  assert.equal(selection.family, 'gpt');
});

test('selectMilestoneReviewer returns the installed milestone-reviewer seat', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  startedChunk(treeRoot, 'M1', 'C1', 'gpt');
  dispatchedAndBuilt(treeRoot, 'D1');
  stageWork(repoRoot, 'work.txt', 'the chunk\n');
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'D1' }, { repoRoot });

  const selection = selectMilestoneReviewer(treeRoot, 'M1');

  assert.equal(selection.seat, 'milestone-reviewer');
  assert.ok(installedAgent(selection.seat));
  assert.equal(selection.review_family, 'claude');
});

// The standing check: a seat renamed or deleted in agents/ fails the SUITE
// rather than the live run. This is the assertion whose absence let three
// nonexistent agentTypes ship green.
test('every seat name any selector can return exists as a file in agents/', () => {
  const names = seatAgentNames();
  assert.ok(names.length >= 5, 'the seat map must actually name the seats');
  for (const name of names) {
    assert.ok(installedAgent(name), `the seat map names "${name}", which is not installed in agents/`);
  }
  // Both families resolve for every seat kind a selector can reach, so no
  // family can fall through to `undefined` and reach an agentType.
  for (const family of ['gpt', 'claude']) {
    assert.ok(SEAT_AGENTS.chunk_review[family], `no chunk-review seat for ${family}`);
    assert.ok(SEAT_AGENTS.implementer[family], `no implementer seat for ${family}`);
  }
});
