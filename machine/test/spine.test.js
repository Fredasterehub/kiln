'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { nextTransition, TRANSITIONS, REVISE_CAP } = require('../src/spine.js');
const { createMilestone, recordChunk } = require('../src/milestones.js');
const { recordBuilt } = require('../src/family-evidence.js');
const {
  writeDispatch,
  writeDispatchTerminal,
  writeSteerRaise,
  writeSteerApply,
} = require('../src/receipts.js');
const { appendRecord, readRecords } = require('../src/stream.js');
const { writeAtomic } = require('../src/atomic-json.js');

const MODULE_PATH = path.join(__dirname, '..', 'src', 'spine.js');

// A tree in a real repository: the resolver itself never shells out, but the
// transactions it names do, and a fixture that cannot be committed into would
// only ever exercise half the states.
function makeTree({ milestones = [{ id: 'M1', order: 1 }] } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'tree/\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n');
  git('add', '.gitignore', 'README.md');
  git('commit', '-q', '-m', 'initial');

  const treeRoot = path.join(repoRoot, 'tree');
  fs.mkdirSync(path.join(treeRoot, 'architecture'), { recursive: true });
  writeAtomic(path.join(treeRoot, 'architecture', 'milestones.json'), {
    schema_version: 1,
    milestones: milestones.map((m) =>
      Object.assign(
        {
          title: `Milestone ${m.id}`,
          designer_family: 'gpt',
          slice_goal: `Ship ${m.id}.`,
          chunk_count_estimate: 1,
          criteria_ids: ['ACR-1'],
        },
        m
      )
    ),
  });
  writeAtomic(path.join(treeRoot, 'state.json'), { phase: 'implementation', phase_status: {} });
  return { repoRoot, treeRoot };
}

// Every fixture milestone declares a toolchain profile, because every gate this
// phase runs — the per-chunk gate and the milestone regression floor — derives
// its command from one.
const PROFILED = Object.freeze({
  id: 'M1',
  title: 'Milestone M1',
  designer_family: 'gpt',
  toolchain_profile: 'node-cli',
});

function ledgerPathOf(treeRoot) {
  return path.join(treeRoot, 'ledger.jsonl');
}

function writeGate(treeRoot, gateId, exitCode, cmd = 'npm test') {
  return appendRecord(ledgerPathOf(treeRoot), {
    kind: 'gate',
    payload: { gate_id: gateId, cmd, exit_code: exitCode },
    correlation_id: gateId,
  });
}

// ---------- the milestone ladder ----------

test('an architecture with no milestone open yet resolves to opening the first one', () => {
  const { treeRoot } = makeTree({ milestones: [{ id: 'M1', order: 1 }, { id: 'M2', order: 2 }] });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.OPEN_MILESTONE);
  assert.equal(next.milestone_id, 'M1');
  assert.equal(next.return, 'beat');
});

test('milestones open in the order the architecture gives, not the order they are listed', () => {
  const { treeRoot } = makeTree({
    milestones: [
      { id: 'M2', order: 2 },
      { id: 'M1', order: 1 },
    ],
  });

  assert.equal(nextTransition(treeRoot).milestone_id, 'M1');
});

test('a tree whose architecture names no milestone at all is blocked, not silently complete', () => {
  const { treeRoot } = makeTree({ milestones: [] });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.match(next.reason, /no milestones/i);
});

test('an open milestone with a green preflight and nothing else on disk resolves to its spec', () => {
  const { treeRoot } = makeTree();
  createMilestone(treeRoot, PROFILED);
  writeGate(treeRoot, 'toolchain-preflight:M1', 0, 'true');

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.SPEC);
  assert.equal(next.milestone_id, 'M1');
});

// ---------- the toolchain preflight gate ----------

test('a milestone declaring a toolchain profile preflights before it specs', () => {
  const { treeRoot } = makeTree();
  createMilestone(treeRoot, {
    id: 'M1',
    title: 'Milestone M1',
    designer_family: 'gpt',
    toolchain_profile: 'node-cli',
  });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.TOOLCHAIN_PREFLIGHT);
  assert.equal(next.profile_id, 'node-cli');
});

test('a red preflight BLOCKS the spec and cites the gate record that says so', () => {
  const { treeRoot } = makeTree();
  createMilestone(treeRoot, {
    id: 'M1',
    title: 'Milestone M1',
    designer_family: 'gpt',
    toolchain_profile: 'node-cli',
  });
  const seq = writeGate(treeRoot, 'toolchain-preflight:M1', 1, 'npm ci');

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.equal(next.record_ref, `ledger:${seq}`);
  assert.match(next.reason, /preflight/i);
});

test('a green preflight makes spec the next transition, and the tree stays green on replay', () => {
  const { treeRoot } = makeTree();
  createMilestone(treeRoot, {
    id: 'M1',
    title: 'Milestone M1',
    designer_family: 'gpt',
    toolchain_profile: 'node-cli',
  });
  writeGate(treeRoot, 'toolchain-preflight:M1', 1, 'npm ci');
  writeGate(treeRoot, 'toolchain-preflight:M1', 0, 'npm ci');

  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.SPEC);
  // Asked twice on unchanged disk, the answer is the same answer.
  assert.deepEqual(nextTransition(treeRoot), nextTransition(treeRoot));
});

// A milestone that declares no toolchain profile is not a milestone with
// nothing to preflight — it is a milestone whose gates this machine cannot
// name. `milestones.js` refuses a `chunk-green` without a passing verification
// record, and the only place a suite command comes from is the profile, so a
// profile-less milestone could never seal a single chunk. Blocking here says so
// before any work is done, rather than at the gate after a chunk was built.
// `toolchain_profile: null` is lawful where milestones.js defines it, so the
// resolver does not invent a blocker at the top. What is true is that such a
// milestone has no suite command this machine can name — and that becomes a
// problem at the rung that needs one, which is where it blocks, citing what it
// needs. The wall goes where the wall actually is.
test('a milestone that declares no toolchain profile specs and builds normally', () => {
  const { treeRoot } = makeTree();
  createMilestone(treeRoot, { id: 'M1', title: 'Milestone M1', designer_family: 'gpt' });

  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.SPEC);
});

test('a null-profile milestone blocks at the chunk gate, citing the command it cannot name', () => {
  const { treeRoot } = makeTree();
  createMilestone(treeRoot, { id: 'M1', title: 'Milestone M1', designer_family: 'gpt' });
  writeChunkPlan(treeRoot, 'M1', ['C1']);
  buildC1(treeRoot);
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: 'C1',
    review: { family: 'claude', verdict: 'approve', ref: 'reviews/C1.json' },
  });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.match(next.reason, /no toolchain profile/i);
  assert.match(next.reason, /suite/i);
});

// ---------- purity ----------

test('the resolver derives from disk alone: a fresh process reads the same answer', () => {
  const { treeRoot } = makeTree();
  createMilestone(treeRoot, PROFILED);
  writeGate(treeRoot, 'toolchain-preflight:M1', 0, 'true');

  const here = nextTransition(treeRoot);
  const there = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        `process.stdout.write(JSON.stringify(require(${JSON.stringify(MODULE_PATH)}).nextTransition(${JSON.stringify(treeRoot)})))`,
      ],
      { encoding: 'utf8' }
    )
  );

  assert.deepEqual(there, here);
});

// ---------- the chunk ladder ----------

// The spec transition's machine-readable half. spec.md is prose for the
// humans and the seats; the resolver cannot ask prose which chunks exist, so
// the same step promotes the decomposition as data. Without it "is there
// another chunk?" would have no disk answer and the resolver would be
// guessing.
function writeChunkPlan(treeRoot, milestoneId, chunkIds) {
  writeAtomic(path.join(treeRoot, 'milestones', milestoneId, 'chunk-plan.json'), {
    schema_version: 1,
    chunks: chunkIds.map((id) => ({ id, title: `Chunk ${id}` })),
  });
}

function openM1(treeRoot, chunkIds = ['C1']) {
  createMilestone(treeRoot, PROFILED);
  writeGate(treeRoot, 'toolchain-preflight:M1', 0, 'true');
  writeChunkPlan(treeRoot, 'M1', chunkIds);
}

const A_DIGEST = `sha256:${'a'.repeat(64)}`;

// A chunk carried to chunk-built through the real evidence chain: a dispatch
// and its terminal on the ledger, then C2's own writer. Hand-writing a
// chunk-built would put a state on disk that the write boundary refuses,
// which is a state the resolver will never actually meet.
function buildC1(treeRoot, chunkId = 'C1', dispatchId = 'D1') {
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: chunkId, brief_ref: `M1/briefs/${chunkId}.md` });
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-start',
    chunk_id: chunkId,
    implementer_seat: 'implementer',
    implementer_family: 'gpt',
  });
  const transportRef = { pid: 4242, pgid: 4242, session: dispatchId };
  writeDispatch(treeRoot, {
    dispatch_id: dispatchId,
    seat: 'implementer',
    transport: 'codex',
    intended_family: 'gpt',
    task_class: 'chunk_implementation',
    prompt_ref: `implementation/build/M1/${chunkId}`,
    transport_ref: transportRef,
  });
  writeDispatchTerminal(treeRoot, {
    dispatch_id: dispatchId,
    status: 'ok',
    builder: 'sol',
    transport_ref: transportRef,
    result_ref: `results/${dispatchId}.md`,
    model_id: 'gpt-5.6-sol',
    result_digest: A_DIGEST,
  });
  recordBuilt(treeRoot, 'M1', chunkId, { dispatch_id: dispatchId }, { repoRoot: path.join(treeRoot, '..') });
}

function settlePostSeal(treeRoot, chunkId = 'C1', milestoneId = 'M1') {
  const file = path.join(treeRoot, 'envelopes', 'implementation', `postseal.${milestoneId}.${chunkId}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, { state: 'done', result: 'settled', evidence: 'e', risks: 'none', artifact: 'a', question: 'none' });
}

function greenC1(treeRoot, chunkId = 'C1', dispatchId = 'D1') {
  buildC1(treeRoot, chunkId, dispatchId);
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: chunkId,
    review: { family: 'claude', verdict: 'approve', ref: `reviews/${chunkId}.md` },
  });
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-green',
    chunk_id: chunkId,
    review: { family: 'claude', verdict: 'approve', ref: `reviews/${chunkId}.md` },
    commit: 'abc1234',
    verification: { gate_id: `chunk:${chunkId}`, cmd: 'npm test', exit_code: 0 },
  });
  settlePostSeal(treeRoot, chunkId);
}

test('a specced milestone with no chunk started resolves to the first chunk brief', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot, ['C1', 'C2']);

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.NEXT_CHUNK_BRIEF);
  assert.equal(next.chunk_id, 'C1');
});

test('a chunk with its brief on record resolves to dispatching its implementer', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/briefs/C1.md' });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.DISPATCH_IMPLEMENTER);
  assert.equal(next.chunk_id, 'C1');
});

// A chunk-start is the chunk's recorded INTENT, not evidence that anything was
// built. Advancing on it alone was the defect: `recordBuilt` needs a dispatch
// to verify the build against, and a bare chunk-start names none.
test('a started chunk with nothing built behind it resolves to dispatching, not to recording a build', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/briefs/C1.json' });
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-start',
    chunk_id: 'C1',
    implementer_seat: 'implementer',
    implementer_family: 'gpt',
  });

  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.DISPATCH_IMPLEMENTER);
});

test('a built chunk resolves to its review, and the review names no seat of its own', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.REVIEW);
  assert.equal(next.chunk_id, 'C1');
  // The reviewer's family is chosen by the machine at review time and
  // evidenced by the chunk-review record; the resolver does not pre-decide it.
  assert.equal(next.review_family, undefined);
});

// ---------- no lawful reviewer ----------

// A chunk the CLAUDE family actually built, in a tree where no gpt model is
// reachable. There is no lawful reviewer: a claude review of claude-built work
// is the one pairing the seal refuses, so seating one buys a review the chunk
// could never seal under. The resolver declares the stop before a reviewer is
// paid for, and carries the route its caller records.
function buildC1Native(treeRoot, chunkId = 'C1', dispatchId = 'D1') {
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: chunkId, brief_ref: `M1/briefs/${chunkId}.md` });
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-start',
    chunk_id: chunkId,
    implementer_seat: 'implementer_ui_creative',
    implementer_family: 'claude',
  });
  const transportRef = { task_ref: dispatchId };
  writeDispatch(treeRoot, {
    dispatch_id: dispatchId,
    seat: 'implementer_ui_creative',
    transport: 'native',
    intended_family: 'claude',
    task_class: 'chunk_implementation',
    prompt_ref: `implementation/build/M1/${chunkId}`,
    transport_ref: transportRef,
  });
  writeDispatchTerminal(treeRoot, {
    dispatch_id: dispatchId,
    status: 'ok',
    builder: 'claude-fallback',
    transport_ref: transportRef,
    result_ref: `results/${dispatchId}.md`,
    model_id: 'opus-5',
    result_digest: A_DIGEST,
  });
  recordBuilt(treeRoot, 'M1', chunkId, { dispatch_id: dispatchId }, { repoRoot: path.join(treeRoot, '..') });
}

// Degraded mode is the only state in which reviewer availability is even a
// question, and answering it reads the dated routing table — so a tree that
// declares the mode carries the table a scaffolded tree would have.
function setDegradedMode(treeRoot) {
  const statePath = path.join(treeRoot, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.preflight = { mode: 'degraded-claude-only' };
  writeAtomic(statePath, state);
  fs.cpSync(path.join(__dirname, '..', 'routing'), path.join(treeRoot, 'routing'), { recursive: true });
}

test('a claude-built chunk with no reachable gpt reviewer resolves to blocked, carrying the route to record', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  setDegradedMode(treeRoot);
  buildC1Native(treeRoot);

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.equal(next.return, 'blocked');
  assert.equal(next.chunk_id, 'C1');
  assert.equal(next.block_id, 'implementation:no-cross-family-reviewer:M1:C1');
  assert.equal(next.degraded_route.expected, 'gpt');
  assert.equal(next.degraded_route.actual, 'none');
  assert.equal(next.degraded_route.route_id, `chunk-review ${JSON.stringify(['M1', 'C1'])}`);
  assert.match(next.reason, /degraded-claude-only/);
  // No reviewer was dispatched and no record was written by resolving: the
  // resolver reads, and the caller that stops writes.
  const ledger = readRecords(path.join(treeRoot, 'ledger.jsonl')).records;
  assert.equal(ledger.filter((r) => r.kind === 'degraded-route').length, 0);
  assert.equal(ledger.filter((r) => r.kind === 'dispatch' && r.task_class === 'review').length, 0);
});

test('the same stop is resolved again on relaunch, with nothing new on the tree', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  setDegradedMode(treeRoot);
  buildC1Native(treeRoot);

  const first = nextTransition(treeRoot);
  const before = readRecords(path.join(treeRoot, 'ledger.jsonl')).records.length;
  const again = nextTransition(treeRoot);
  const fresh = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        `process.stdout.write(JSON.stringify(require(${JSON.stringify(MODULE_PATH)}).nextTransition(${JSON.stringify(treeRoot)})))`,
      ],
      { encoding: 'utf8' }
    )
  );
  const after = readRecords(path.join(treeRoot, 'ledger.jsonl')).records.length;

  // Not vacuous: the stop itself is what must recur, so the assertion names it.
  assert.equal(first.transition, TRANSITIONS.BLOCKED);
  assert.deepEqual(again, first);
  assert.deepEqual(fresh.transition, first.transition);
  assert.deepEqual(fresh.degraded_route, first.degraded_route);
  assert.equal(after, before);
});

test('a gpt-built chunk is untouched by degraded mode — its reviewer was already a claude one', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  setDegradedMode(treeRoot);
  buildC1(treeRoot);

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.REVIEW);
  assert.equal(next.degraded_route, undefined);
});

test('an approving review resolves to sealing; a revising one resolves to another attempt', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: 'C1',
    review: { family: 'claude', verdict: 'revise', ref: 'reviews/C1-r1.md' },
  });

  const revise = nextTransition(treeRoot);
  assert.equal(revise.transition, TRANSITIONS.REVISE);
  assert.equal(revise.attempt, 2);

  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: 'C1',
    review: { family: 'claude', verdict: 'approve', ref: 'reviews/C1-r2.md' },
  });
  // An approved chunk still has to pass its own gate before it seals:
  // `milestones.js` refuses a chunk-green carrying no passing verification.
  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.CHUNK_GATE);
  writeGate(treeRoot, 'chunk:M1:C1', 0, 'node --test');
  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.SEAL);
});

test('the revise loop is capped by code, and the cap routes to the operator rather than looping', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);
  for (let attempt = 1; attempt <= REVISE_CAP; attempt++) {
    recordChunk(treeRoot, 'M1', {
      kind: 'chunk-review',
      chunk_id: 'C1',
      review: { family: 'claude', verdict: 'revise', ref: `reviews/C1-r${attempt}.md` },
    });
  }

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.OPERATOR_NEEDED);
  assert.equal(next.return, 'operator_needed');
  assert.match(next.reason, /cap/i);
});

test('a green chunk moves to the next chunk in the plan', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot, ['C1', 'C2']);
  greenC1(treeRoot);

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.NEXT_CHUNK_BRIEF);
  assert.equal(next.chunk_id, 'C2');
});

test('a milestone whose every planned chunk is green resolves to its milestone review', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  greenC1(treeRoot);

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.MILESTONE_REVIEW);
  assert.equal(next.milestone_id, 'M1');
});

// ---------- the milestone close ladder ----------

// The milestone review's durable evidence is its promoted verdict artifact:
// there is no chunk record for a milestone-level review, and the resolver
// must not ask for the same review twice.
function writeMilestoneReview(treeRoot, milestoneId, verdict = 'approve') {
  writeAtomic(path.join(treeRoot, 'milestones', milestoneId, 'review.json'), {
    schema_version: 1,
    verdict,
    family: 'claude',
    evidence: 'the slice composes to its stated goal',
  });
}

test('a reviewed milestone resolves to its regression floor, not straight to close', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  greenC1(treeRoot);
  writeMilestoneReview(treeRoot, 'M1');

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.REGRESSION_FLOOR);
  assert.equal(next.milestone_id, 'M1');
});

test('a red regression floor blocks the close and cites the gate', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  greenC1(treeRoot);
  writeMilestoneReview(treeRoot, 'M1');
  const seq = writeGate(treeRoot, 'regression-floor:M1', 1);

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.equal(next.record_ref, `ledger:${seq}`);
  assert.match(next.reason, /regression floor/i);
});

test('a green regression floor resolves to closing the milestone', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  greenC1(treeRoot);
  writeMilestoneReview(treeRoot, 'M1');
  writeGate(treeRoot, 'regression-floor:M1', 1);
  writeGate(treeRoot, 'regression-floor:M1', 0);

  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.CLOSE);
});

test('a milestone review that asked for changes routes to the operator rather than closing', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  greenC1(treeRoot);
  writeMilestoneReview(treeRoot, 'M1', 'revise');

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.OPERATOR_NEEDED);
  assert.equal(next.return, 'operator_needed');
});

test('every milestone green resolves to advancing the phase, once', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  greenC1(treeRoot);
  writeMilestoneReview(treeRoot, 'M1');
  writeGate(treeRoot, 'regression-floor:M1', 0);
  // The close transaction is what flips the index entry; the fixture stands in
  // for it so the resolver's own terminal rung is what is under test.
  const indexPath = path.join(treeRoot, 'milestones', 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.milestones[0].status = 'green';
  writeAtomic(indexPath, index);

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.PHASE_ADVANCE);
  assert.equal(next.return, 'phase_complete');
});

// ---------- completion advances without another worker turn ----------

// The property the sealed decomposition names explicitly: once a step's own
// durable evidence is on disk, the NEXT transition is reachable with no
// further worker action. Walked end to end here, one rung at a time, with
// nothing between the rungs but the record the previous one left.
test('each rung advances on its own evidence alone, walked end to end', () => {
  const { treeRoot } = makeTree();
  const seen = [];
  const step = () => {
    const next = nextTransition(treeRoot);
    seen.push(next.transition);
    return next;
  };

  step(); // open-milestone
  createMilestone(treeRoot, PROFILED);
  step(); // toolchain-preflight
  writeGate(treeRoot, 'toolchain-preflight:M1', 0, 'true');
  step(); // spec
  writeChunkPlan(treeRoot, 'M1', ['C1']);
  step(); // next-chunk-brief
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/briefs/C1.json' });

  const dispatch = step(); // dispatch-implementer
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-start',
    chunk_id: 'C1',
    implementer_seat: 'implementer',
    implementer_family: 'gpt',
  });
  writeAttempt(treeRoot, dispatch.dispatch_id);

  const built = step(); // record-built
  recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: built.dispatch_id }, { repoRoot: path.join(treeRoot, '..') });
  step(); // review
  // `writeAttempt` builds NATIVELY, so the terminal attests claude and the
  // cross-family reviewer for this chunk is the gpt one — which is what
  // `selectReviewer` returns from that same evidence. A claude review here
  // would be a same-family review of a claude build, a state the ladder
  // cannot produce.
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: 'C1',
    review: { family: 'gpt', verdict: 'approve', ref: 'reviews/C1.json' },
  });
  step(); // chunk-gate
  writeGate(treeRoot, 'chunk:M1:C1', 0, 'node --test');

  const seal = step(); // seal
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-green',
    chunk_id: 'C1',
    review: { family: 'gpt', verdict: 'approve', ref: seal.review_ref },
    commit: 'abc1234',
    verification: { gate_id: seal.gate_id, cmd: 'node --test', exit_code: 0 },
  });
  step(); // post-seal
  settlePostSeal(treeRoot, 'C1');
  step(); // milestone-review
  writeMilestoneReview(treeRoot, 'M1');
  step(); // regression-floor
  writeGate(treeRoot, 'regression-floor:M1', 0, 'node --test');
  step(); // close
  const indexPath = path.join(treeRoot, 'milestones', 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.milestones[0].status = 'green';
  writeAtomic(indexPath, index);
  const done = step(); // phase-advance

  assert.deepEqual(seen, [
    TRANSITIONS.OPEN_MILESTONE,
    TRANSITIONS.TOOLCHAIN_PREFLIGHT,
    TRANSITIONS.SPEC,
    TRANSITIONS.NEXT_CHUNK_BRIEF,
    TRANSITIONS.DISPATCH_IMPLEMENTER,
    TRANSITIONS.RECORD_BUILT,
    TRANSITIONS.REVIEW,
    TRANSITIONS.CHUNK_GATE,
    TRANSITIONS.SEAL,
    TRANSITIONS.POST_SEAL,
    TRANSITIONS.MILESTONE_REVIEW,
    TRANSITIONS.REGRESSION_FLOOR,
    TRANSITIONS.CLOSE,
    TRANSITIONS.PHASE_ADVANCE,
  ]);
  assert.equal(done.return, 'phase_complete');
});

// Kill-and-rerun across the SAME ladder: at every rung, asking again on
// unchanged disk answers the same rung, and asking from a fresh process
// answers it too. A resolver that remembered anything between calls would
// diverge here and nowhere else.
test('every rung of the ladder is re-entrant: asked again, and asked by a new process, it answers the same', () => {
  const { treeRoot } = makeTree();
  const advance = [
    () => createMilestone(treeRoot, PROFILED),
    () => writeGate(treeRoot, 'toolchain-preflight:M1', 0, 'true'),
    () => writeChunkPlan(treeRoot, 'M1', ['C1']),
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/briefs/C1.json' }),
    () => {
      recordChunk(treeRoot, 'M1', {
        kind: 'chunk-start',
        chunk_id: 'C1',
        implementer_seat: 'implementer',
        implementer_family: 'gpt',
      });
      writeAttempt(treeRoot, nextTransition(treeRoot).dispatch_id);
    },
    () => recordBuilt(treeRoot, 'M1', 'C1', { dispatch_id: 'd1' }, { repoRoot: path.join(treeRoot, '..') }),
    // gpt reviews, because `writeAttempt` builds natively and the terminal
    // attests claude — the same cross-family selection the machine makes.
    () =>
      recordChunk(treeRoot, 'M1', {
        kind: 'chunk-review',
        chunk_id: 'C1',
        review: { family: 'gpt', verdict: 'approve', ref: 'reviews/C1.json' },
      }),
    () => writeGate(treeRoot, 'chunk:M1:C1', 0, 'node --test'),
    () =>
      recordChunk(treeRoot, 'M1', {
        kind: 'chunk-green',
        chunk_id: 'C1',
        review: { family: 'gpt', verdict: 'approve', ref: 'reviews/C1.json' },
        commit: 'abc1234',
        verification: { gate_id: 'chunk:M1:C1', cmd: 'node --test', exit_code: 0 },
      }),
    () => settlePostSeal(treeRoot, 'C1'),
    () => writeMilestoneReview(treeRoot, 'M1'),
    () => writeGate(treeRoot, 'regression-floor:M1', 0, 'node --test'),
  ];

  const inAFreshProcess = () =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          `process.stdout.write(JSON.stringify(require(${JSON.stringify(MODULE_PATH)}).nextTransition(${JSON.stringify(treeRoot)})))`,
        ],
        { encoding: 'utf8' }
      )
    );

  for (const landRung of [...advance, () => {}]) {
    const once = nextTransition(treeRoot);
    assert.deepEqual(nextTransition(treeRoot), once, `re-asking at ${once.transition} gave a different answer`);
    assert.deepEqual(inAFreshProcess(), once, `a fresh process disagreed at ${once.transition}`);
    landRung();
  }
});

// ---------- the forbidden mechanisms ----------

// The absences the sealed plan requires, checked rather than promised. Scoped
// to the executable files: workflows/README.md NAMES these mechanisms in order
// to forbid them, and a proof that cannot tell documentation from use would
// either fail on its own contract or have to stop reading the prose that
// states it.
test('no workflow script and no part of the resolver reaches for a forbidden mechanism', () => {
  const roots = [
    path.join(__dirname, '..', '..', 'workflows'),
    path.join(__dirname, '..', 'src', 'spine.js'),
  ];
  const files = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    if (fs.statSync(root).isDirectory()) {
      for (const name of fs.readdirSync(root)) {
        if (name.endsWith('.js')) files.push(path.join(root, name));
      }
    } else {
      files.push(root);
    }
  }
  assert.ok(files.length >= 2, 'the proof must actually be reading the workflow scripts and the resolver');

  const forbidden = [
    [/SendMessage/, 'SendMessage'],
    [/TaskStop/, 'TaskStop'],
    [/\bpgrep\b/, 'pgrep'],
    [/\bps\b\s+-/, 'ps'],
    [/sentinel/i, 'a sentinel file'],
    [/codex[^\n]*\bresume\b/, 'a codex resume'],
    [/setInterval|while\s*\([^)]*\)\s*\{[^}]*await/, 'a polling loop'],
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [pattern, name] of forbidden) {
      assert.equal(pattern.test(source), false, `${path.basename(file)} reaches for ${name}`);
    }
  }
});

// ---------- steering ----------

test('a steer landed between invocations changes the next transition, and stops changing it once answered', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  const before = nextTransition(treeRoot);
  assert.equal(before.transition, TRANSITIONS.NEXT_CHUNK_BRIEF);

  // The operator steers between two invocations — nothing else about the tree
  // changes.
  const raised = writeSteerRaise(treeRoot, {
    steer_id: 'S1',
    scope: 'milestones/M1',
    instruction: 'do the smaller refactor first',
    origin: 'operator',
  });

  const steered = nextTransition(treeRoot);
  assert.equal(steered.transition, TRANSITIONS.APPLY_STEER);
  assert.equal(steered.instruction, 'do the smaller refactor first');
  assert.equal(steered.record_ref, raised.ref);

  // Answered, the ladder resumes exactly where it was.
  writeSteerApply(treeRoot, { steer_id: 'S1', exit: 'applied', resolution_ref: raised.ref });
  assert.deepEqual(nextTransition(treeRoot), before);
});

test('a steer routed to the operator is answered too, and does not re-surface', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  const raised = writeSteerRaise(treeRoot, {
    steer_id: 'S1',
    scope: 'milestones/M1',
    instruction: 'stop and let me look',
    origin: 'operator',
  });
  writeSteerApply(treeRoot, { steer_id: 'S1', exit: 'operator', resolution_ref: raised.ref });

  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.NEXT_CHUNK_BRIEF);
});

// The designer's side-channel records carry a chunk_id but are not lifecycle
// progress — milestones.js keeps them out of its own precedence check for the
// same reason. A consult answered mid-review must not read as the chunk
// having moved on.
test('a consult or a journeys notice does not move a chunk along the ladder', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);
  const beforeSideChannel = nextTransition(treeRoot);

  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-consult',
    chunk_id: 'C1',
    consult_id: 'Q1',
    asker: 'implementer',
    question: 'which boundary owns the retry?',
    verdict: 'the caller does',
    anchor: 'spec.md:42',
  });

  assert.deepEqual(nextTransition(treeRoot), beforeSideChannel);
  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.REVIEW);
});

// ---------- dispatch attempts, and re-entry across them ----------

// The chunk lifecycle allows exactly ONE `chunk-start` per chunk — its
// precedence check requires the prior record to be `chunk-spec` — so a chunk's
// attempts cannot be counted from lifecycle records. They are counted from
// DISPATCH receipts, which is also the shape C2 describes when it explains why
// intent and outcome must be read from different records: one recorded intent,
// several attempts under it.
const BUILD_SCOPE = 'implementation/build/M1/C1';

function writeAttempt(treeRoot, dispatchId, { status = 'ok', scope = BUILD_SCOPE } = {}) {
  const transportRef = { task_ref: dispatchId };
  writeDispatch(treeRoot, {
    dispatch_id: dispatchId,
    seat: 'implementer',
    transport: 'native',
    intended_family: 'claude',
    task_class: 'chunk_implementation',
    prompt_ref: scope,
    transport_ref: transportRef,
  });
  if (status === null) return;
  writeDispatchTerminal(
    treeRoot,
    status === 'ok'
      ? {
          dispatch_id: dispatchId,
          status: 'ok',
          builder: 'claude-fallback',
          transport_ref: transportRef,
          result_ref: `results/${dispatchId}.md`,
          model_id: 'opus-5',
          result_digest: A_DIGEST,
        }
      : {
          dispatch_id: dispatchId,
          status: 'failed',
          builder: null,
          transport_ref: transportRef,
          reason: 'timeout',
        }
  );
}

function startedC1(treeRoot) {
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/briefs/C1.json' });
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-start',
    chunk_id: 'C1',
    implementer_seat: 'implementer',
    implementer_family: 'gpt',
  });
}

// A dispatch with no terminal is a predecessor that died mid-step. Nothing
// about the build can be reasoned about until that record is honest, so the
// recovery rung pre-empts the rest of the ladder.
test('an un-terminated dispatch is recovered before anything else is decided', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  startedC1(treeRoot);
  writeAttempt(treeRoot, 'd1', { status: null });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.RECOVER_DISPATCH);
  assert.equal(next.dispatch_id, 'd1');
});

test('a started chunk whose dispatch never happened is dispatched, not recorded as built', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  startedC1(treeRoot);

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.DISPATCH_IMPLEMENTER);
  assert.equal(next.attempt, 1);
  assert.equal(next.needs_chunk_start, false);
});

// The re-entry hazard the verdict named: a bare `chunk-start` advanced straight
// to `record-built` with no dispatch_id, and `recordBuilt` cannot succeed
// without one.
test('record-built is only reachable with a successful attempt, and it names that attempt', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  startedC1(treeRoot);
  writeAttempt(treeRoot, 'd1');

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.RECORD_BUILT);
  assert.equal(next.dispatch_id, 'd1');
});

// A relaunch is a NEW dispatch_id, never a reuse — C1's own law. The fixture
// makes the wrong answer a different answer: a failed attempt is already on
// record, so returning d1 again would be visible.
test('a failed attempt is retried under a fresh dispatch id, never the spent one', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  startedC1(treeRoot);
  writeAttempt(treeRoot, 'd1', { status: 'failed' });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.DISPATCH_IMPLEMENTER);
  assert.equal(next.attempt, 2);
  assert.notEqual(next.dispatch_id, 'd1');
  assert.match(next.dispatch_id, /^d\d+$/);
});

// A dispatch belonging to a DIFFERENT chunk must not count as this chunk's
// attempt. Two chunks, one attempt each, and the wrong scoping would make the
// second chunk look already built.
test('attempts are scoped to their own chunk', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot, ['C1', 'C2']);
  startedC1(treeRoot);
  writeAttempt(treeRoot, 'd1', { scope: 'implementation/build/M1/C2' });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.DISPATCH_IMPLEMENTER);
  assert.equal(next.chunk_id, 'C1');
});

// ---------- the revise loop ----------

// A revise cannot write another `chunk-start`, so its own durable evidence is
// a new dispatch attempt. The chunk is ready to be reviewed again when it has
// more successful attempts than reviews — one uniform rule that also answers
// the first build.
test('a revise dispatches another attempt, and the attempt is what makes the next review reachable', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: 'C1',
    review: { family: 'claude', verdict: 'revise', ref: 'reviews/C1-r1.md' },
  });

  const revise = nextTransition(treeRoot);
  assert.equal(revise.transition, TRANSITIONS.REVISE);
  assert.equal(revise.attempt, 2);

  // The revise's attempt lands. The lifecycle pointer has not moved — it is
  // still the revising review — and the resolver must read the attempt, not
  // the pointer, to know the chunk is ready for another look.
  writeAttempt(treeRoot, revise.dispatch_id);
  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.REVIEW);
});

// ---------- the chunk gate ----------

test('an approved chunk gates before it seals, and the seal cites the gate and the review it acted on', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: 'C1',
    review: { family: 'claude', verdict: 'approve', ref: 'reviews/C1.json' },
  });

  const gate = nextTransition(treeRoot);
  assert.equal(gate.transition, TRANSITIONS.CHUNK_GATE);
  assert.equal(gate.gate_id, 'chunk:M1:C1');
  assert.equal(gate.profile_id, 'node-cli');

  const seq = writeGate(treeRoot, 'chunk:M1:C1', 0, 'node --test');
  const seal = nextTransition(treeRoot);
  assert.equal(seal.transition, TRANSITIONS.SEAL);
  assert.equal(seal.gate_ref, `ledger:${seq}`);
  assert.equal(seal.review_ref, 'reviews/C1.json');
});

test('a red chunk gate blocks the seal and cites the gate that failed', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: 'C1',
    review: { family: 'claude', verdict: 'approve', ref: 'reviews/C1.json' },
  });
  const seq = writeGate(treeRoot, 'chunk:M1:C1', 1, 'node --test');

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.equal(next.record_ref, `ledger:${seq}`);
});

// ---------- what the transitions have to carry ----------

// Opening a milestone dropped the architecture's own description, which is how
// a milestone reached the chunk ladder with no toolchain profile and therefore
// bypassed preflight entirely.
test('open-milestone carries the architecture\'s title, family and toolchain profile', () => {
  const { treeRoot } = makeTree({
    milestones: [
      { id: 'M1', order: 1, title: 'The first slice', designer_family: 'claude', toolchain_profile: 'node-web' },
    ],
  });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.OPEN_MILESTONE);
  assert.equal(next.title, 'The first slice');
  assert.equal(next.designer_family, 'claude');
  assert.equal(next.toolchain_profile, 'node-web');
});

test('the regression floor names the profile whose suite it has to run', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  greenC1(treeRoot);
  writeMilestoneReview(treeRoot, 'M1');

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.REGRESSION_FLOOR);
  assert.equal(next.profile_id, 'node-cli');
  assert.equal(next.gate_id, 'regression-floor:M1');
});

// A milestone id that is not a single path segment reaches capsule.js and
// promotion.js as a path component. Both refuse it — three rungs later, after
// a spec and a brief have been written. The resolver refuses it at the top.
test('an id that is not a single path segment is refused before any work is done', () => {
  const { treeRoot } = makeTree({ milestones: [{ id: '../escape', order: 1 }] });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.match(next.reason, /path segment/);
});

// ---------- steering: applied or the operator's ----------

// The steer's exit is a decision, and it was not being made. The rule is
// disk-decidable: a steer aimed at the milestone being built now can be
// applied by this phase; one aimed anywhere else cannot, whatever it says.
test('a steer scoped to the active milestone is applied; one scoped elsewhere is the operator\'s', () => {
  const { treeRoot } = makeTree({ milestones: [{ id: 'M1', order: 1 }, { id: 'M2', order: 2 }] });
  openM1(treeRoot);

  writeSteerRaise(treeRoot, {
    steer_id: 'S1',
    scope: 'milestones/M1',
    instruction: 'do the smaller refactor first',
    origin: 'operator',
  });
  const mine = nextTransition(treeRoot);
  assert.equal(mine.transition, TRANSITIONS.APPLY_STEER);
  assert.equal(mine.exit, 'applied');
  assert.equal(mine.return, 'beat');
  writeSteerApply(treeRoot, { steer_id: 'S1', exit: 'applied', resolution_ref: mine.record_ref });

  writeSteerRaise(treeRoot, {
    steer_id: 'S2',
    scope: 'milestones/M2',
    instruction: 'rework the slice after this one',
    origin: 'operator',
  });
  const theirs = nextTransition(treeRoot);
  assert.equal(theirs.transition, TRANSITIONS.APPLY_STEER);
  assert.equal(theirs.exit, 'operator');
  assert.equal(theirs.return, 'operator_needed');
});

// ---------- consults ----------

// A worker's question is durable state, and the pending/answered pair is
// derived exactly as an open steer and an open hold are — never a status field.
function raiseConsult(treeRoot, milestoneId, consultId, chunkId = 'C1') {
  const file = path.join(treeRoot, 'staging', 'consult-request', milestoneId, `${consultId}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, {
    consult_id: consultId,
    chunk_id: chunkId,
    asker: 'implementer',
    question: 'which boundary owns the retry?',
  });
}

test('an unanswered consult pre-empts the ladder and returns needs_consult', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);
  const before = nextTransition(treeRoot);
  assert.equal(before.transition, TRANSITIONS.REVIEW);

  raiseConsult(treeRoot, 'M1', 'Q1');

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.CONSULT);
  assert.equal(next.return, 'needs_consult');
  assert.equal(next.consult_id, 'Q1');
  assert.equal(next.chunk_id, 'C1');
});

test('a consult stops pre-empting once its answer is canonical, and the ladder resumes where it was', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);
  const before = nextTransition(treeRoot);
  raiseConsult(treeRoot, 'M1', 'Q1');
  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.CONSULT);

  writeAtomic(path.join(treeRoot, 'milestones', 'M1', 'consults', 'Q1.json'), {
    consult_id: 'Q1',
    asker: 'implementer',
    question: 'which boundary owns the retry?',
    verdict: 'the caller does',
    anchor: 'spec.md:42',
  });

  assert.deepEqual(nextTransition(treeRoot), before);
});

// Two consults, one answered: the wrong answer is a different answer.
test('answering one consult does not answer another', () => {
  const { treeRoot } = makeTree();
  openM1(treeRoot);
  buildC1(treeRoot);
  raiseConsult(treeRoot, 'M1', 'Q1');
  raiseConsult(treeRoot, 'M1', 'Q2');
  writeAtomic(path.join(treeRoot, 'milestones', 'M1', 'consults', 'Q1.json'), {
    consult_id: 'Q1',
    asker: 'implementer',
    question: 'q',
    verdict: 'v',
    anchor: 'spec.md:1',
  });

  const next = nextTransition(treeRoot);

  assert.equal(next.transition, TRANSITIONS.CONSULT);
  assert.equal(next.consult_id, 'Q2');
});

// ---------- the routing law decides the implementer ----------

// D6's core, and the thing routing every chunk to Opus had quietly deleted:
// Sol implements ordinary chunks and Opus owns UI/creative work, and the
// architecture marks which a milestone is through `designer_family`. Two
// fixtures differing in exactly that one field, so the wrong answer is a
// DIFFERENT answer rather than an absent one.
test('an ordinary milestone dispatches the Sol implementer; a UI/creative one dispatches Opus', () => {
  const ordinary = makeTree({
    milestones: [{ id: 'M1', order: 1, designer_family: 'gpt', toolchain_profile: 'node-cli' }],
  }).treeRoot;
  createMilestone(ordinary, { id: 'M1', title: 'Milestone M1', designer_family: 'gpt', toolchain_profile: 'node-cli' });
  writeGate(ordinary, 'toolchain-preflight:M1', 0, 'true');
  writeChunkPlan(ordinary, 'M1', ['C1']);
  recordChunk(ordinary, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/briefs/C1.json' });

  const sol = nextTransition(ordinary);
  assert.equal(sol.transition, TRANSITIONS.DISPATCH_IMPLEMENTER);
  assert.equal(sol.implementer_seat, 'implementer-sol');
  assert.equal(sol.implementer_family, 'gpt');

  const creative = makeTree({
    milestones: [{ id: 'M1', order: 1, designer_family: 'claude', toolchain_profile: 'node-cli' }],
  }).treeRoot;
  createMilestone(creative, {
    id: 'M1',
    title: 'Milestone M1',
    designer_family: 'claude',
    toolchain_profile: 'node-cli',
  });
  writeGate(creative, 'toolchain-preflight:M1', 0, 'true');
  writeChunkPlan(creative, 'M1', ['C1']);
  recordChunk(creative, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/briefs/C1.json' });

  const opus = nextTransition(creative);
  assert.equal(opus.implementer_seat, 'implementer-opus');
  assert.equal(opus.implementer_family, 'claude');
});
