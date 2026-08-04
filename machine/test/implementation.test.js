'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  sealChunk,
  closeMilestoneTxn,
  openMilestoneTxn,
  stagedDiffDigest,
  chunkCommitMessage,
  milestoneMergeMessage,
} = require('../src/implementation.js');
const { createMilestone, recordChunk } = require('../src/milestones.js');
const { runGate } = require('../src/check-honesty.js');
const { readRecords } = require('../src/stream.js');
const { readJson } = require('../src/atomic-json.js');
const { writeDispatch, writeDispatchTerminal } = require('../src/receipts.js');

const MODULE_PATH = path.resolve(__dirname, '..', 'src', 'implementation.js');

const MILESTONE = 'M1';
const BRANCH = `milestone/${MILESTONE}`;
const BASE = 'main';
const TAG = `milestone/${MILESTONE}-green`;
const REVIEW_EVIDENCE = 'envelopes/implementation/M1-review.json';

function git(repoRoot, ...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

// A real, throwaway git repo with the machine tree living inside it — the
// same real-git discipline milestones.test.js:27-38 holds for closeMilestone's
// own rev-parse path, extended here because BOTH transactions under test are
// git mutations, and a mocked git would prove nothing about crash recovery.
// The tree is gitignored so the repo's own diffs are the chunk's work alone.
function makeWorkspace() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'implementation-git-'));
  git(repoRoot, 'init', '-q', '-b', BASE);
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'config', 'user.name', 'Test');
  git(repoRoot, 'config', 'commit.gpgsign', 'false');
  git(repoRoot, 'config', 'tag.gpgsign', 'false');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.thelastskill/\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n');
  git(repoRoot, 'add', '.gitignore', 'README.md');
  git(repoRoot, 'commit', '-q', '-m', 'initial');

  const treeRoot = path.join(repoRoot, '.thelastskill');
  fs.mkdirSync(treeRoot, { recursive: true });
  createMilestone(treeRoot, { id: MILESTONE, title: 'Substrate', designer_family: 'gpt' });
  git(repoRoot, 'checkout', '-q', '-b', BRANCH);
  return { repoRoot, treeRoot };
}

// A chunk-built is a claim about a receipt, so a fixture that walks the
// lifecycle has to leave the receipt on the ledger first. One dispatch, one
// terminal, one build record citing it — the shape family-evidence.js
// composes, written here directly because these tests are about the
// lifecycle, not about gathering the evidence.
let evidenceSeq = 0;
function evidencedBuilt(treeRoot, chunkId, family = 'gpt', milestoneId = 'M1') {
  const dispatchId = `EV${(evidenceSeq += 1)}`;
  const digest = `sha256:${String(evidenceSeq).padStart(64, '0')}`;
  const codex = family === 'gpt';
  const transportRef = codex
    ? { pid: 4000 + evidenceSeq, pgid: 4000 + evidenceSeq, session: String(4000 + evidenceSeq) }
    : { task_ref: dispatchId };
  writeDispatch(treeRoot, {
    dispatch_id: dispatchId,
    seat: codex ? 'implementer' : 'implementer_ui_creative',
    transport: codex ? 'codex' : 'native',
    intended_family: family,
    task_class: 'chunk_implementation',
    prompt_ref: `briefs/${chunkId}.md`,
    transport_ref: transportRef,
  });
  const { record } = writeDispatchTerminal(treeRoot, {
    dispatch_id: dispatchId,
    status: 'ok',
    builder: codex ? 'sol' : 'claude-fallback',
    transport_ref: transportRef,
    result_ref: `results/${dispatchId}.md`,
    model_id: codex ? 'gpt-5.6-sol' : 'opus-5',
    result_digest: digest,
  });
  return {
    kind: 'chunk-built',
    chunk_id: chunkId,
    actual_family: family,
    intended_family: family,
    model_id: codex ? 'gpt-5.6-sol' : 'opus-5',
    dispatch_ref: `ledger:${record.seq}`,
    result_digest: digest,
    // The boundary recomputes this from the repository and compares, so a
    // fixture cannot invent it: a build record describes work that is there.
    diff_digest: stagedDiffDigest(path.join(treeRoot, '..')),
  };
}

function reviewRefOf(chunkId) {
  return `envelopes/implementation/${chunkId}-review.json`;
}

// spec -> start -> built -> review, stopping one step short of green: sealChunk is the
// only thing that writes chunk-green, so every test that seals starts here.
function reviewedThroughApprove(treeRoot, chunkId, verdict = 'approve', milestoneId = MILESTONE) {
  recordChunk(treeRoot, milestoneId, {
    kind: 'chunk-spec',
    chunk_id: chunkId,
    brief_ref: `${milestoneId}/spec.md#${chunkId}`,
  });
  recordChunk(treeRoot, milestoneId, {
    kind: 'chunk-start',
    chunk_id: chunkId,
    implementer_seat: 'sol',
    implementer_family: 'gpt',
  });
  recordChunk(treeRoot, milestoneId, evidencedBuilt(treeRoot, chunkId, 'gpt', milestoneId));
  recordChunk(treeRoot, milestoneId, {
    kind: 'chunk-review',
    chunk_id: chunkId,
    review: { family: 'claude', verdict, ref: reviewRefOf(chunkId) },
  });
  return reviewRefOf(chunkId);
}

// Real gate evidence through the one sanctioned producer (check-honesty.js's
// runGate), cited by the C1 ref grammar the transaction resolves it through.
function gateRef(treeRoot, gateId, cmd = 'true') {
  const { seq } = runGate({ gateId, cmd, ledgerPath: path.join(treeRoot, 'ledger.jsonl') });
  return `ledger:${seq}`;
}

function stageWork(repoRoot, chunkId, body) {
  fs.writeFileSync(path.join(repoRoot, `${chunkId}.txt`), body);
  git(repoRoot, 'add', `${chunkId}.txt`);
}

function commitCount(repoRoot, ref = 'HEAD') {
  return Number(git(repoRoot, 'rev-list', '--count', ref).trim());
}

function mergeCount(repoRoot, ref = BASE) {
  return Number(git(repoRoot, 'rev-list', '--count', '--merges', ref).trim());
}

function tagNames(repoRoot) {
  return git(repoRoot, 'tag', '--list').split('\n').filter((line) => line !== '');
}

function chunkRecords(treeRoot, kind, chunkId, milestoneId = MILESTONE) {
  const { records } = readRecords(path.join(treeRoot, 'milestones', milestoneId, 'chunks.jsonl'));
  return records.filter((record) => record.kind === kind && record.chunk_id === chunkId);
}

function indexEntry(treeRoot, milestoneId = MILESTONE) {
  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'), null);
  return index.milestones.find((entry) => entry.id === milestoneId);
}

// Everything a refused transaction must leave exactly as it found it: where
// HEAD sits, every ref and what it points at, the working tree, what is
// staged, and both record streams plus the milestone index. A refusal test
// asserts this whole snapshot is unchanged rather than spot-checking a count
// or two, which would miss an index reset, a branch switch, or a stray tag.
function snapshot(repoRoot, treeRoot) {
  return {
    branch: git(repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD').trim(),
    refs: git(repoRoot, 'show-ref').trim(),
    worktree: git(repoRoot, 'status', '--porcelain'),
    staged: stagedDiffDigest(repoRoot),
    chunkStream: readRecords(path.join(treeRoot, 'milestones', MILESTONE, 'chunks.jsonl')).records.length,
    ledger: readRecords(path.join(treeRoot, 'ledger.jsonl')).records.length,
    index: readJson(path.join(treeRoot, 'milestones', 'index.json'), null),
  };
}

// A genuinely fresh Node process — no module cache, no lock state, no closure
// over the first call. This is what a crashed session's successor actually
// is, and it is the only shape that proves re-entry works across processes
// rather than merely across calls.
function replayInFreshProcess(fnName, args) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'implementation-replay-'));
  const scriptPath = path.join(scriptDir, 'replay.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const impl = require(${JSON.stringify(MODULE_PATH)});\n` +
      `const { fn, args } = JSON.parse(process.argv[2]);\n` +
      `process.stdout.write(JSON.stringify(impl[fn](...args)));\n`
  );
  const out = execFileSync(process.execPath, [scriptPath, JSON.stringify({ fn: fnName, args })], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

// One chunk all the way to sealed, for the tests whose subject is the close
// transaction rather than the seal.
function sealOneChunk(repoRoot, treeRoot, chunkId) {
  const reviewRef = reviewedThroughApprove(treeRoot, chunkId);
  const gate = gateRef(treeRoot, `${chunkId}-unit`);
  stageWork(repoRoot, chunkId, `${chunkId} work\n`);
  const sealInfo = { diff_digest: stagedDiffDigest(repoRoot), review_ref: reviewRef, gate_ref: gate };
  return { receipt: sealChunk(treeRoot, MILESTONE, chunkId, sealInfo), sealInfo };
}

// ---------- stagedDiffDigest ----------

test('stagedDiffDigest is stable for the same staged diff and moves when the diff does', () => {
  const { repoRoot } = makeWorkspace();
  stageWork(repoRoot, 'C1', 'one\n');
  const first = stagedDiffDigest(repoRoot);

  assert.match(first, /^sha256:[0-9a-f]{64}$/);
  assert.equal(stagedDiffDigest(repoRoot), first);

  stageWork(repoRoot, 'C1', 'two\n');
  assert.notEqual(stagedDiffDigest(repoRoot), first);
});

test('stagedDiffDigest refuses a directory that is not a git repository', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'implementation-norepo-'));
  assert.throws(() => stagedDiffDigest(outside), /is not a git repository/);
});

// ---------- sealChunk ----------

test('sealChunk commits the approved diff and records chunk-green, returning the record read back off disk', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const reviewRef = reviewedThroughApprove(treeRoot, 'C1');
  const gate = gateRef(treeRoot, 'C1-unit');
  stageWork(repoRoot, 'C1', 'one\n');
  const digest = stagedDiffDigest(repoRoot);
  const before = commitCount(repoRoot);

  const receipt = sealChunk(treeRoot, MILESTONE, 'C1', {
    diff_digest: digest,
    review_ref: reviewRef,
    gate_ref: gate,
  });

  assert.equal(commitCount(repoRoot), before + 1);
  assert.equal(receipt.commit, git(repoRoot, 'rev-parse', 'HEAD').trim());
  assert.equal(git(repoRoot, 'log', '-1', '--format=%B').includes(digest), true);

  const greens = chunkRecords(treeRoot, 'chunk-green', 'C1');
  assert.equal(greens.length, 1);
  assert.deepEqual(receipt.record, greens[0]);
  assert.equal(greens[0].commit, receipt.commit);
  assert.equal(greens[0].diff_digest, digest);
  assert.equal(greens[0].gate_ref, gate);
  assert.deepEqual(greens[0].review, { family: 'claude', verdict: 'approve', ref: reviewRef });
  assert.deepEqual(greens[0].verification, { gate_id: 'C1-unit', cmd: 'true', exit_code: 0 });
});

test('sealChunk refuses a gate_ref that resolves to no record, mutating nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const reviewRef = reviewedThroughApprove(treeRoot, 'C1');
  stageWork(repoRoot, 'C1', 'one\n');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () =>
      sealChunk(treeRoot, MILESTONE, 'C1', {
        diff_digest: stagedDiffDigest(repoRoot),
        review_ref: reviewRef,
        gate_ref: 'ledger:99',
      }),
    /gate_ref "ledger:99" does not resolve/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk refuses gate evidence whose gate did not pass, mutating nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const reviewRef = reviewedThroughApprove(treeRoot, 'C1');
  const failed = gateRef(treeRoot, 'C1-unit', 'false');
  stageWork(repoRoot, 'C1', 'one\n');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () =>
      sealChunk(treeRoot, MILESTONE, 'C1', {
        diff_digest: stagedDiffDigest(repoRoot),
        review_ref: reviewRef,
        gate_ref: failed,
      }),
    /exit_code 1/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk refuses a diff_digest that does not match what is staged, mutating nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const reviewRef = reviewedThroughApprove(treeRoot, 'C1');
  const gate = gateRef(treeRoot, 'C1-unit');
  stageWork(repoRoot, 'C1', 'one\n');
  const approved = stagedDiffDigest(repoRoot);
  stageWork(repoRoot, 'C1', 'something else entirely\n');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () => sealChunk(treeRoot, MILESTONE, 'C1', { diff_digest: approved, review_ref: reviewRef, gate_ref: gate }),
    /staged diff does not match the approved diff_digest/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk refuses a review_ref that is not the chunk\'s latest review, mutating nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  reviewedThroughApprove(treeRoot, 'C1');
  const gate = gateRef(treeRoot, 'C1-unit');
  stageWork(repoRoot, 'C1', 'one\n');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () =>
      sealChunk(treeRoot, MILESTONE, 'C1', {
        diff_digest: stagedDiffDigest(repoRoot),
        review_ref: 'envelopes/implementation/some-other-review.json',
        gate_ref: gate,
      }),
    /is not the latest "chunk-review"/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk refuses a chunk whose latest review is a revise verdict, mutating nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const reviewRef = reviewedThroughApprove(treeRoot, 'C1', 'revise');
  const gate = gateRef(treeRoot, 'C1-unit');
  stageWork(repoRoot, 'C1', 'one\n');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () =>
      sealChunk(treeRoot, MILESTONE, 'C1', {
        diff_digest: stagedDiffDigest(repoRoot),
        review_ref: reviewRef,
        gate_ref: gate,
      }),
    /verdict "revise"/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk refuses to commit when HEAD is not on the milestone branch, mutating nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const reviewRef = reviewedThroughApprove(treeRoot, 'C1');
  const gate = gateRef(treeRoot, 'C1-unit');
  stageWork(repoRoot, 'C1', 'one\n');
  const digest = stagedDiffDigest(repoRoot);
  git(repoRoot, 'checkout', '-q', BASE);
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () => sealChunk(treeRoot, MILESTONE, 'C1', { diff_digest: digest, review_ref: reviewRef, gate_ref: gate }),
    /is on branch "main", not the milestone branch "milestone\/M1"/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk re-entered after a crash between its commit and its record writes only the record', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const reviewRef = reviewedThroughApprove(treeRoot, 'C1');
  const gate = gateRef(treeRoot, 'C1-unit');
  stageWork(repoRoot, 'C1', 'one\n');
  const digest = stagedDiffDigest(repoRoot);

  // The crash point: the transaction's own commit landed, the chunk-green
  // record never did. Nothing is staged any more, so a re-entry that could
  // only recognize its work by re-digesting the index would fail here.
  git(repoRoot, 'commit', '-q', '-m', chunkCommitMessage(MILESTONE, 'C1', 'C1-unit', digest));
  const commits = commitCount(repoRoot);
  const head = git(repoRoot, 'rev-parse', 'HEAD').trim();

  const receipt = sealChunk(treeRoot, MILESTONE, 'C1', {
    diff_digest: digest,
    review_ref: reviewRef,
    gate_ref: gate,
  });

  assert.equal(commitCount(repoRoot), commits);
  assert.equal(receipt.commit, head);
  assert.equal(chunkRecords(treeRoot, 'chunk-green', 'C1').length, 1);
  assert.equal(receipt.record.commit, head);
});

test('sealChunk does not reuse an earlier milestone\'s commit sharing this chunk id and digest', () => {
  const { repoRoot, treeRoot } = makeWorkspace();

  // M1's C1 adds shared.txt.
  const firstReview = reviewedThroughApprove(treeRoot, 'C1');
  const firstGate = gateRef(treeRoot, 'C1-unit');
  fs.writeFileSync(path.join(repoRoot, 'shared.txt'), 'shared\n');
  git(repoRoot, 'add', 'shared.txt');
  const digest = stagedDiffDigest(repoRoot);
  const first = sealChunk(treeRoot, MILESTONE, 'C1', {
    diff_digest: digest,
    review_ref: firstReview,
    gate_ref: firstGate,
  });

  // M1 lands on main and the file is removed by later work, so the very same
  // add-diff can be staged again on M2's branch — and M1's commit is
  // reachable from it. Chunk ids are milestone-local, so "C1" recurs.
  closeMilestoneTxn(treeRoot, MILESTONE, { tag: TAG, review_evidence: REVIEW_EVIDENCE });
  fs.rmSync(path.join(repoRoot, 'shared.txt'));
  git(repoRoot, 'commit', '-q', '-a', '-m', 'remove shared.txt');
  git(repoRoot, 'checkout', '-q', '-b', 'milestone/M2');
  createMilestone(treeRoot, { id: 'M2', title: 'Second', designer_family: 'gpt' });
  const secondReview = reviewedThroughApprove(treeRoot, 'C1', 'approve', 'M2');
  const secondGate = gateRef(treeRoot, 'M2-C1-unit');
  fs.writeFileSync(path.join(repoRoot, 'shared.txt'), 'shared\n');
  git(repoRoot, 'add', 'shared.txt');

  // The collision precondition, asserted rather than assumed: the same digest,
  // and M1's commit really is reachable from the branch being searched.
  assert.equal(stagedDiffDigest(repoRoot), digest);
  assert.equal(git(repoRoot, 'log', '--format=%H', 'milestone/M2').includes(first.commit), true);

  const second = sealChunk(treeRoot, 'M2', 'C1', {
    diff_digest: digest,
    review_ref: secondReview,
    gate_ref: secondGate,
  });

  assert.notEqual(second.commit, first.commit);
  assert.equal(second.commit, git(repoRoot, 'rev-parse', 'HEAD').trim());
  assert.equal(chunkRecords(treeRoot, 'chunk-green', 'C1', 'M2')[0].commit, second.commit);
  assert.equal(fs.readFileSync(path.join(repoRoot, 'shared.txt'), 'utf8'), 'shared\n');
});

test('sealChunk called again with identical arguments returns the identical receipt and changes nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const reviewRef = reviewedThroughApprove(treeRoot, 'C1');
  const gate = gateRef(treeRoot, 'C1-unit');
  stageWork(repoRoot, 'C1', 'one\n');
  const args = { diff_digest: stagedDiffDigest(repoRoot), review_ref: reviewRef, gate_ref: gate };

  const first = sealChunk(treeRoot, MILESTONE, 'C1', args);
  const before = snapshot(repoRoot, treeRoot);
  const second = sealChunk(treeRoot, MILESTONE, 'C1', args);

  assert.deepEqual(second, first);
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk replayed in a FRESH NODE PROCESS returns the identical receipt and changes nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const { receipt, sealInfo } = sealOneChunk(repoRoot, treeRoot, 'C1');
  const before = snapshot(repoRoot, treeRoot);

  const replayed = replayInFreshProcess('sealChunk', [treeRoot, MILESTONE, 'C1', sealInfo]);

  assert.deepEqual(replayed, receipt);
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk refuses a re-call for the same chunk carrying a different diff_digest', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const reviewRef = reviewedThroughApprove(treeRoot, 'C1');
  const gate = gateRef(treeRoot, 'C1-unit');
  stageWork(repoRoot, 'C1', 'one\n');
  sealChunk(treeRoot, MILESTONE, 'C1', {
    diff_digest: stagedDiffDigest(repoRoot),
    review_ref: reviewRef,
    gate_ref: gate,
  });

  stageWork(repoRoot, 'C1', 'a second, unapproved revision\n');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () =>
      sealChunk(treeRoot, MILESTONE, 'C1', {
        diff_digest: stagedDiffDigest(repoRoot),
        review_ref: reviewRef,
        gate_ref: gate,
      }),
    /already sealed with a different diff_digest/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk refuses a re-call for a sealed chunk carrying a different gate_ref', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const { sealInfo } = sealOneChunk(repoRoot, treeRoot, 'C1');
  const otherGate = gateRef(treeRoot, 'C1-unit-rerun');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () => sealChunk(treeRoot, MILESTONE, 'C1', { ...sealInfo, gate_ref: otherGate }),
    /already sealed with a different gate_ref/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('sealChunk refuses a re-call for a sealed chunk carrying a different review_ref', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const { sealInfo } = sealOneChunk(repoRoot, treeRoot, 'C1');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () =>
      sealChunk(treeRoot, MILESTONE, 'C1', {
        ...sealInfo,
        review_ref: 'envelopes/implementation/some-other-review.json',
      }),
    /already sealed with a different review_ref/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

// ---------- closeMilestoneTxn ----------

test('closeMilestoneTxn merges no-ff, tags the merge, flips the index, and returns the entry read back off disk', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');

  const receipt = closeMilestoneTxn(treeRoot, MILESTONE, { tag: TAG, review_evidence: REVIEW_EVIDENCE });

  assert.equal(git(repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), BASE);
  assert.equal(mergeCount(repoRoot), 1);
  assert.deepEqual(tagNames(repoRoot), [TAG]);
  assert.equal(git(repoRoot, 'rev-parse', `refs/tags/${TAG}^{commit}`).trim(), receipt.merge_sha);
  assert.equal(git(repoRoot, 'rev-parse', BASE).trim(), receipt.merge_sha);

  const entry = indexEntry(treeRoot);
  assert.equal(entry.status, 'green');
  assert.equal(entry.tag, TAG);
  assert.equal(entry.merge_sha, receipt.merge_sha);
  assert.equal(entry.review_evidence, REVIEW_EVIDENCE);
  assert.equal(entry.verified, true);
  assert.deepEqual(receipt.entry, entry);
});

test('closeMilestoneTxn refuses a milestone with a non-green chunk BEFORE merging or tagging anything', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');
  reviewedThroughApprove(treeRoot, 'C2'); // reviewed, never sealed
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () => closeMilestoneTxn(treeRoot, MILESTONE, { tag: TAG, review_evidence: REVIEW_EVIDENCE }),
    /has non-green chunks: C2 \(latest: chunk-review\) — refusing to merge or tag/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
  assert.equal(mergeCount(repoRoot), 0);
  assert.deepEqual(tagNames(repoRoot), []);
});

test('closeMilestoneTxn re-entered after a crash between its merge and its tag makes only the tag', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');

  git(repoRoot, 'checkout', '-q', BASE);
  git(repoRoot, 'merge', '--no-ff', BRANCH, '-m', milestoneMergeMessage(MILESTONE, BRANCH, BASE));
  const mergeSha = git(repoRoot, 'rev-parse', 'HEAD').trim();
  const commits = commitCount(repoRoot, BASE);

  const receipt = closeMilestoneTxn(treeRoot, MILESTONE, { tag: TAG, review_evidence: REVIEW_EVIDENCE });

  assert.equal(commitCount(repoRoot, BASE), commits);
  assert.equal(mergeCount(repoRoot), 1);
  assert.equal(receipt.merge_sha, mergeSha);
  assert.deepEqual(tagNames(repoRoot), [TAG]);
  assert.equal(indexEntry(treeRoot).status, 'green');
});

test('closeMilestoneTxn re-entered after a crash between its tag and the index flip writes only the record', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');

  git(repoRoot, 'checkout', '-q', BASE);
  git(repoRoot, 'merge', '--no-ff', BRANCH, '-m', milestoneMergeMessage(MILESTONE, BRANCH, BASE));
  const mergeSha = git(repoRoot, 'rev-parse', 'HEAD').trim();
  git(repoRoot, 'tag', '-a', TAG, '-m', TAG);
  const commits = commitCount(repoRoot, BASE);
  assert.equal(indexEntry(treeRoot).status, 'open');

  const receipt = closeMilestoneTxn(treeRoot, MILESTONE, { tag: TAG, review_evidence: REVIEW_EVIDENCE });

  assert.equal(commitCount(repoRoot, BASE), commits);
  assert.equal(mergeCount(repoRoot), 1);
  assert.deepEqual(tagNames(repoRoot), [TAG]);
  assert.equal(receipt.merge_sha, mergeSha);
  assert.equal(indexEntry(treeRoot).status, 'green');
});

test('closeMilestoneTxn called again with identical arguments returns the identical receipt and changes nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');
  const args = { tag: TAG, review_evidence: REVIEW_EVIDENCE };

  const first = closeMilestoneTxn(treeRoot, MILESTONE, args);
  const before = snapshot(repoRoot, treeRoot);
  const second = closeMilestoneTxn(treeRoot, MILESTONE, args);

  assert.deepEqual(second, first);
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('closeMilestoneTxn replayed in a FRESH NODE PROCESS returns the identical receipt and changes nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');
  const args = { tag: TAG, review_evidence: REVIEW_EVIDENCE };
  const first = closeMilestoneTxn(treeRoot, MILESTONE, args);
  const before = snapshot(repoRoot, treeRoot);

  const replayed = replayInFreshProcess('closeMilestoneTxn', [treeRoot, MILESTONE, args]);

  assert.deepEqual(replayed, first);
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('closeMilestoneTxn refuses a re-call for a closed milestone carrying a different tag', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');
  closeMilestoneTxn(treeRoot, MILESTONE, { tag: TAG, review_evidence: REVIEW_EVIDENCE });
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () => closeMilestoneTxn(treeRoot, MILESTONE, { tag: 'milestone/M1-other', review_evidence: REVIEW_EVIDENCE }),
    /already closed under tag "milestone\/M1-green" — refusing to close it again with a different tag/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('closeMilestoneTxn refuses a re-call for a closed milestone carrying different review_evidence', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');
  closeMilestoneTxn(treeRoot, MILESTONE, { tag: TAG, review_evidence: REVIEW_EVIDENCE });
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () =>
      closeMilestoneTxn(treeRoot, MILESTONE, {
        tag: TAG,
        review_evidence: 'envelopes/implementation/some-other-review.json',
      }),
    /already closed under tag "milestone\/M1-green" — refusing to close it again with a different review_evidence/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

test('closeMilestoneTxn refuses to merge a dirty working tree, mutating nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'uncommitted work\n');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () => closeMilestoneTxn(treeRoot, MILESTONE, { tag: TAG, review_evidence: REVIEW_EVIDENCE }),
    /working tree is not clean/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
  assert.equal(mergeCount(repoRoot), 0);
  assert.deepEqual(tagNames(repoRoot), []);
});

test('closeMilestoneTxn refuses a tag that already exists on something other than this milestone\'s merge', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');
  git(repoRoot, 'tag', '-a', TAG, '-m', 'a tag from somewhere else');
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () => closeMilestoneTxn(treeRoot, MILESTONE, { tag: TAG, review_evidence: REVIEW_EVIDENCE }),
    /tag "milestone\/M1-green" already exists/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
  assert.equal(mergeCount(repoRoot), 0);
});

test('closeMilestoneTxn refuses a repoRoot that is not a git repository, mutating nothing', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  sealOneChunk(repoRoot, treeRoot, 'C1');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'implementation-norepo-'));
  const before = snapshot(repoRoot, treeRoot);

  assert.throws(
    () =>
      closeMilestoneTxn(
        treeRoot,
        MILESTONE,
        { tag: TAG, review_evidence: REVIEW_EVIDENCE },
        { repoRoot: outside }
      ),
    /is not a git repository/
  );
  assert.deepEqual(snapshot(repoRoot, treeRoot), before);
});

// ---------- openMilestoneTxn ----------

// A repository with a tree and NO milestone in it — makeWorkspace already
// opens one, which is exactly the state these tests must start before.
function bareWorkspace() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'implementation-open-'));
  git(repoRoot, 'init', '-q', '-b', BASE);
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'config', 'user.name', 'Test');
  git(repoRoot, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.thelastskill/\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n');
  git(repoRoot, 'add', '.gitignore', 'README.md');
  git(repoRoot, 'commit', '-q', '-m', 'initial');
  const treeRoot = path.join(repoRoot, '.thelastskill');
  fs.mkdirSync(treeRoot, { recursive: true });
  return { repoRoot, treeRoot };
}

// The mirror of closeMilestoneTxn at the other end of a milestone's life:
// branch creation and the milestone's own genesis records, as ONE recoverable
// transaction. Every interior point is re-enterable, because the branch and
// the index entry are two durable writes and a crash lands between them.
test('openMilestoneTxn creates the branch and the milestone, and returns what it made', () => {
  const { treeRoot, repoRoot } = bareWorkspace();

  const opened = openMilestoneTxn(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt' });

  assert.equal(opened.milestoneId, 'M1');
  assert.equal(opened.branch, 'milestone/M1');
  assert.equal(
    execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    'milestone/M1'
  );
  assert.equal(readJson(path.join(treeRoot, 'milestones', 'index.json'), null).milestones[0].id, 'M1');
});

test('openMilestoneTxn replays onto its own work rather than refusing or duplicating', () => {
  const { treeRoot } = bareWorkspace();
  const first = openMilestoneTxn(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt' });

  const again = openMilestoneTxn(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt' });

  assert.deepEqual(again, first);
  assert.equal(readJson(path.join(treeRoot, 'milestones', 'index.json'), null).milestones.length, 1);
});

test('a crash after the branch and before the milestone is finished by re-entry', () => {
  const { treeRoot, repoRoot } = bareWorkspace();
  // Exactly the interior state: the branch exists, nothing else does.
  execFileSync('git', ['checkout', '--quiet', '-b', 'milestone/M1'], { cwd: repoRoot });

  const opened = openMilestoneTxn(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt' });

  assert.equal(opened.branch, 'milestone/M1');
  assert.equal(readJson(path.join(treeRoot, 'milestones', 'index.json'), null).milestones[0].id, 'M1');
});

test('openMilestoneTxn refuses to reopen a milestone under a different description', () => {
  const { treeRoot } = bareWorkspace();
  openMilestoneTxn(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt' });

  assert.throws(
    () => openMilestoneTxn(treeRoot, { id: 'M1', title: 'Something else', designer_family: 'gpt' }),
    /already open/
  );
});

// The toolchain profile is part of the description, and it is the part with
// consequences: it decides whether the milestone preflights at all and which
// install and suite commands the gates run. A replay comparison that ignored it
// would let a second call quietly re-describe an open milestone as needing a
// different toolchain than the one its preflight gate was taken against.
test('openMilestoneTxn refuses a replay that re-describes the toolchain profile', () => {
  const { treeRoot } = bareWorkspace();
  openMilestoneTxn(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt', toolchain_profile: 'node-cli' });

  assert.throws(
    () =>
      openMilestoneTxn(treeRoot, {
        id: 'M1',
        title: 'First',
        designer_family: 'gpt',
        toolchain_profile: 'node-web',
      }),
    /already open/
  );

  // The genuine replay — same description, profile included — still replays.
  const again = openMilestoneTxn(treeRoot, {
    id: 'M1',
    title: 'First',
    designer_family: 'gpt',
    toolchain_profile: 'node-cli',
  });
  assert.equal(again.entry.toolchain_profile, 'node-cli');
});

// `null` is a real value here — "this milestone needs nothing" — and it is the
// value `createMilestone` records when a caller omits the field. A comparison
// that skipped `undefined` OR `null` alike would let a profile-less milestone
// be reopened as a profiled one.
test('a milestone opened with no toolchain cannot be replayed into one that has a toolchain', () => {
  const { treeRoot } = bareWorkspace();
  openMilestoneTxn(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt' });

  assert.throws(
    () =>
      openMilestoneTxn(treeRoot, {
        id: 'M1',
        title: 'First',
        designer_family: 'gpt',
        toolchain_profile: 'node-cli',
      }),
    /already open/
  );
});
