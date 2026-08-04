'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createMilestone, recordChunk, closeMilestone } = require('../src/milestones.js');
const { readJson } = require('../src/atomic-json.js');
const { readRecords } = require('../src/stream.js');
const { writeDispatch, writeDispatchTerminal } = require('../src/receipts.js');
const { appendLine } = require('../src/jsonl.js');
const { stagedDiffDigest } = require('../src/staged-diff.js');

function makeTreeRoot() {
  // A real (throwaway) git repository with the tree inside it. The bare
  // directory this used to be is no longer enough: recordChunk verifies a
  // build record's diff_digest against what is actually staged, so a
  // milestone tree now has to sit in a repository that can answer.
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'tree/\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n');
  git('add', '.gitignore', 'README.md');
  git('commit', '-q', '-m', 'initial');
  const treeRoot = path.join(repoRoot, 'tree');
  fs.mkdirSync(treeRoot);
  return treeRoot;
}

// A real, throwaway git repo with one commit and one annotated tag on it —
// for closeMilestone's git-binding tests, which must exercise the actual
// `git rev-parse --verify` path rather than mocking it away (P7 build
// instruction: "TDD the true-git path in milestones.test.js with a real
// temp git repo").
function makeGitRepoWithTag(tagName) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-git-'));
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
  fs.writeFileSync(path.join(repoRoot, 'file.txt'), 'hello\n');
  execFileSync('git', ['add', 'file.txt'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repoRoot });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();
  execFileSync('git', ['tag', '-a', tagName, '-m', tagName], { cwd: repoRoot });
  return { repoRoot, sha };
}

// ---------- chunk-lifecycle record builders ----------
// Default pairing mirrors implementer-sol (gpt) reviewed by
// chunk-reviewer-sonnet (claude) — the routing config's default pairing.

function specRecord(chunkId, overrides) {
  return Object.assign({ kind: 'chunk-spec', chunk_id: chunkId, brief_ref: `M1/spec.md#${chunkId}` }, overrides);
}

function startRecord(chunkId, overrides) {
  return Object.assign(
    { kind: 'chunk-start', chunk_id: chunkId, implementer_seat: 'sol', implementer_family: 'gpt' },
    overrides
  );
}



// A chunk-built is a claim about a receipt, so a fixture that walks the
// lifecycle has to leave the receipt on the ledger first. One dispatch, one
// terminal, one build record citing it — the shape family-evidence.js
// composes, written here directly because these tests are about the
// lifecycle, not about gathering the evidence.
//
// `family` is the family that ACTUALLY built, because that is what the
// terminal's own builder proves. `opts.intended` lets a fixture split the two
// — a dispatch that went out as one family and came back attested as another
// — which is the only shape in which the cross-family law can be broken
// without any record being forged.
let evidenceSeq = 0;
function evidencedBuilt(treeRoot, chunkId, family = 'gpt', milestoneId = 'M1', opts = {}) {
  const dispatchId = `EV${(evidenceSeq += 1)}`;
  const digest = `sha256:${String(evidenceSeq).padStart(64, '0')}`;
  const intended = opts.intended === undefined ? family : opts.intended;
  const codex = family === 'gpt';
  const transportRef = codex
    ? { pid: 4000 + evidenceSeq, pgid: 4000 + evidenceSeq, session: String(4000 + evidenceSeq) }
    : { task_ref: dispatchId };
  writeDispatch(treeRoot, {
    dispatch_id: dispatchId,
    seat: intended === 'gpt' ? 'implementer' : 'implementer_ui_creative',
    transport: codex ? 'codex' : 'native',
    intended_family: intended,
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
    intended_family: intended,
    model_id: codex ? 'gpt-5.6-sol' : 'opus-5',
    dispatch_ref: `ledger:${record.seq}`,
    result_digest: digest,
    // The boundary recomputes this from the repository and compares, so a
    // fixture cannot invent it: a build record describes work that is there.
    diff_digest: stagedDiffDigest(path.join(treeRoot, '..')),
  };
}

function reviewRecord(chunkId, verdict, overrides) {
  return Object.assign(
    {
      kind: 'chunk-review',
      chunk_id: chunkId,
      review: { family: 'claude', verdict, ref: `envelopes/implementation/${chunkId}-review.json` },
    },
    overrides
  );
}

function greenRecord(chunkId, overrides) {
  return Object.assign(
    {
      kind: 'chunk-green',
      chunk_id: chunkId,
      commit: '0123456789abcdef0123456789abcdef01234567',
      review: { family: 'claude', verdict: 'approve', ref: `envelopes/implementation/${chunkId}-review.json` },
      verification: { gate_id: `${chunkId}-unit`, cmd: 'node --test', exit_code: 0 },
    },
    overrides
  );
}

// Drives one chunk all the way through the real lifecycle (spec -> start ->
// review(approve) -> green) with the default cross-family pairing.
function recordThroughGreen(treeRoot, milestoneId, chunkId) {
  recordChunk(treeRoot, milestoneId, specRecord(chunkId));
  recordChunk(treeRoot, milestoneId, startRecord(chunkId));
  recordChunk(treeRoot, milestoneId, evidencedBuilt(treeRoot, chunkId));
  recordChunk(treeRoot, milestoneId, reviewRecord(chunkId, 'approve'));
  return recordChunk(treeRoot, milestoneId, greenRecord(chunkId));
}

const CLOSE_INFO = { tag: 'milestone/M1-green', merge_sha: '0123456789abcdef0123456789abcdef01234567', review_evidence: 'envelopes/implementation/M1-review.json' };

// ---------- createMilestone ----------

test('createMilestone materializes milestones/<id>/{mailbox/,chunks.jsonl} and an index.json entry', () => {
  const treeRoot = makeTreeRoot();
  const result = createMilestone(treeRoot, { id: 'M1', title: 'Skeleton', designer_family: 'gpt' });

  assert.ok(fs.statSync(path.join(treeRoot, 'milestones', 'M1', 'mailbox')).isDirectory());
  assert.ok(fs.statSync(path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl')).isFile());

  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'));
  assert.equal(index.schema_version, 1);
  assert.deepEqual(index.milestones, [{ id: 'M1', title: 'Skeleton', designer_family: 'gpt', toolchain_profile: null, status: 'open' }]);
  assert.deepEqual(result.milestoneId, 'M1');
});

test('createMilestone accepts an explicit toolchain_profile', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'Web slice', designer_family: 'claude', toolchain_profile: 'node-web' });
  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'));
  assert.equal(index.milestones[0].toolchain_profile, 'node-web');
});

test('createMilestone appends a second milestone to the same index without disturbing the first', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt' });
  createMilestone(treeRoot, { id: 'M2', title: 'Second', designer_family: 'claude', toolchain_profile: 'python-pytest' });
  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'));
  assert.equal(index.milestones.length, 2);
  assert.equal(index.milestones[0].id, 'M1');
  assert.equal(index.milestones[1].id, 'M2');
});

test('createMilestone refuses a duplicate id (one-shot, never an upsert)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt' });
  assert.throws(() => createMilestone(treeRoot, { id: 'M1', title: 'Again', designer_family: 'gpt' }), /already exists/);
});

test('createMilestone rejects an invalid designer_family', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(
    () => createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'sol' }),
    /designer_family/
  );
});

test('createMilestone rejects a toolchain_profile outside the closed enum', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(
    () => createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt', toolchain_profile: 'rust-cargo' }),
    /toolchain_profile/
  );
});

test('createMilestone rejects missing/empty id or title', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(() => createMilestone(treeRoot, { title: 'X', designer_family: 'gpt' }), TypeError);
  assert.throws(() => createMilestone(treeRoot, { id: 'M1', designer_family: 'gpt' }), TypeError);
});

// ---------- recordChunk: basic refusals ----------

test('recordChunk refuses when the milestone does not exist', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(() => recordChunk(treeRoot, 'M1', specRecord('C1')), /no such milestone/);
});

test('recordChunk rejects an unknown kind', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-nope', chunk_id: 'C1' }),
    /chunk record kind must be one of/
  );
});

test('recordChunk rejects a missing/empty chunk_id', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  assert.throws(() => recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', brief_ref: 'x' }), /chunk_id/);
});

test('recordChunk refuses further writes once the milestone is already green', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');
  closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true });
  assert.throws(() => recordChunk(treeRoot, 'M1', specRecord('C2')), /already green/);
});

test('recordChunk refuses to write on top of a chunks.jsonl carrying a malformed line', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  fs.appendFileSync(path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl'), 'not-json\n');
  assert.throws(() => recordChunk(treeRoot, 'M1', specRecord('C1')), /malformed record/);
});

test('recordChunk refuses to write on top of a chunks.jsonl record violating the common header', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  const chunksPath = path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl');
  fs.appendFileSync(chunksPath, `${JSON.stringify({ kind: 'chunk-spec', chunk_id: 'ZZ' })}\n`);
  assert.throws(() => recordChunk(treeRoot, 'M1', specRecord('C1')), /violating the common JSONL header/);
});

// ---------- recordChunk: chunk-spec ----------

test('recordChunk appends a well-formed chunk-spec record', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));

  const { records } = readRecords(path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl'));
  const nonGenesis = records.filter((r) => r.kind !== 'genesis');
  assert.equal(nonGenesis.length, 1);
  assert.equal(nonGenesis[0].chunk_id, 'C1');
  assert.equal(nonGenesis[0].brief_ref, 'M1/spec.md#C1');
  assert.equal(nonGenesis[0].correlation_id, 'C1');
});

test('recordChunk rejects "chunk-spec" without brief_ref', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  assert.throws(() => recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1' }), /brief_ref/);
});

test('recordChunk rejects a second "chunk-spec" for the same chunk (must be the first lifecycle record)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  assert.throws(() => recordChunk(treeRoot, 'M1', specRecord('C1')), /must be the first lifecycle record/);
});

// ---------- recordChunk: chunk-start ----------

test('recordChunk rejects "chunk-start" without implementer_seat', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-start', chunk_id: 'C1', implementer_family: 'gpt' }),
    /implementer_seat/
  );
});

test('recordChunk rejects "chunk-start" without a valid implementer_family', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-start', chunk_id: 'C1', implementer_seat: 'sol' }),
    /implementer_family/
  );
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-start', chunk_id: 'C1', implementer_seat: 'sol', implementer_family: 'sol' }),
    /implementer_family/
  );
});

test('recordChunk rejects "chunk-start" before "chunk-spec" (out-of-order)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  assert.throws(
    () => recordChunk(treeRoot, 'M1', startRecord('C1')),
    /requires the chunk's prior lifecycle record to be "chunk-spec"/
  );
});

test('recordChunk rejects "chunk-built" without a valid actual_family', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));

  // The one field this module's own cross-family law reads off a build; the
  // rest of the evidence is family-evidence.js's to gather and validate.
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-built', chunk_id: 'C1' }),
    /requires "actual_family" to be one of claude, gpt/
  );
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...evidencedBuilt(treeRoot, 'C1'), actual_family: 'sonnet' }),
    /requires "actual_family" to be one of claude, gpt/
  );
});

// ---------- chunk-built: a claim about a receipt ----------

// A chunk at chunk-start, plus a valid build record citing a real terminal —
// the starting point for every "one field is wrong" case below.
function chunkAwaitingBuild(treeRoot, family = 'gpt') {
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1', { implementer_family: family }));
  return evidencedBuilt(treeRoot, 'C1', family);
}

test('recordChunk rejects a "chunk-built" that does not carry its whole claim', () => {
  for (const [field, pattern] of [
    ['intended_family', /requires "intended_family" to be one of claude, gpt/],
    ['dispatch_ref', /requires a "dispatch_ref" of the form ledger:<seq>/],
    ['model_id', /requires a non-empty "model_id"/],
    ['result_digest', /requires a "result_digest" of the form sha256:/],
    ['diff_digest', /requires a "diff_digest" of the form sha256:/],
  ]) {
    const treeRoot = makeTreeRoot();
    const built = chunkAwaitingBuild(treeRoot);
    delete built[field];

    // A claim with a missing field cannot be contradicted by anything, which
    // is exactly how an unevidenced build would slip through.
    assert.throws(() => recordChunk(treeRoot, 'M1', built), pattern, `missing ${field}`);
  }
});

test('recordChunk rejects a "chunk-built" whose intent is not the chunk\'s own', () => {
  const treeRoot = makeTreeRoot();
  const built = chunkAwaitingBuild(treeRoot, 'gpt');

  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, intended_family: 'claude' }),
    /the intent is the chunk's, not the build's/
  );
});

test('recordChunk rejects a "chunk-built" citing something that is not a terminal', () => {
  const treeRoot = makeTreeRoot();
  const built = chunkAwaitingBuild(treeRoot);

  // ledger:0 is the DISPATCH the helper wrote, not its terminal.
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, dispatch_ref: 'ledger:0' }),
    /is not a "dispatch-terminal" record/
  );
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, dispatch_ref: 'ledger:99' }),
    /is not a "dispatch-terminal" record/
  );
});

test('recordChunk rejects a "chunk-built" citing a terminal that failed', () => {
  const treeRoot = makeTreeRoot();
  const built = chunkAwaitingBuild(treeRoot);
  const transportRef = { task_ref: 'FAILED' };
  writeDispatch(treeRoot, {
    dispatch_id: 'FAILED',
    seat: 'implementer',
    transport: 'native',
    intended_family: 'claude',
    task_class: 'chunk_implementation',
    prompt_ref: 'briefs/C1.md',
    transport_ref: transportRef,
  });
  const { record } = writeDispatchTerminal(treeRoot, {
    dispatch_id: 'FAILED',
    status: 'failed',
    builder: null,
    transport_ref: transportRef,
    reason: 'timeout',
  });

  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, dispatch_ref: `ledger:${record.seq}` }),
    /a dispatch that did not succeed built nothing/
  );
});

test('recordChunk rejects a "chunk-built" whose claims contradict the terminal it cites', () => {
  const treeRoot = makeTreeRoot();
  const built = chunkAwaitingBuild(treeRoot, 'gpt');

  // The terminal's builder is `sol`, which proves gpt and nothing else.
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, actual_family: 'claude' }),
    /proves "gpt"/
  );
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, model_id: 'opus-5' }),
    /claims model_id "opus-5", but its terminal recorded "gpt-5.6-sol"/
  );
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, result_digest: `sha256:${'f'.repeat(64)}` }),
    /claims result_digest .*, but its terminal recorded/
  );
});

test('recordChunk rejects a "chunk-built" whose terminal cannot describe its own result', () => {
  const treeRoot = makeTreeRoot();
  const built = chunkAwaitingBuild(treeRoot);
  // receipts.js refuses this shape when it writes; a ledger can still acquire
  // one by being hand-edited or restored, and reading is not writing.
  appendLine(path.join(treeRoot, 'ledger.jsonl'), {
    schema_version: 1,
    seq: 99,
    kind: 'dispatch-terminal',
    ts: new Date().toISOString(),
    correlation_id: 'EVX',
    dispatch_id: 'EVX',
    status: 'ok',
    builder: 'sol',
    transport_ref: { pid: 9, pgid: 9, session: '9' },
  });

  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, dispatch_ref: 'ledger:99' }),
    /reports success without describing the result/
  );
});

test('recordChunk rejects a "chunk-built" whose terminal has no dispatch on the ledger', () => {
  const treeRoot = makeTreeRoot();
  const built = chunkAwaitingBuild(treeRoot);
  // A terminal is only interpretable through the dispatch it answers: the
  // transport it went out on is what says which builders were even possible.
  appendLine(path.join(treeRoot, 'ledger.jsonl'), {
    schema_version: 1,
    seq: 99,
    kind: 'dispatch-terminal',
    ts: new Date().toISOString(),
    correlation_id: 'ORPHAN',
    dispatch_id: 'ORPHAN',
    status: 'ok',
    builder: 'sol',
    transport_ref: { pid: 9, pgid: 9, session: '9' },
    model_id: built.model_id,
    result_digest: built.result_digest,
  });

  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, dispatch_ref: 'ledger:99' }),
    /whose own dispatch "ORPHAN" is not on the ledger/
  );
});

test('recordChunk rejects a "chunk-built" whose diff is not the diff that is staged', () => {
  const treeRoot = makeTreeRoot();
  const built = chunkAwaitingBuild(treeRoot);

  // Everything else about this record is true — a real receipt, a real model,
  // a real result. Without this check it would attest a digest nobody ever
  // compared to anything, and the repository could hold something else.
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { ...built, diff_digest: `sha256:${'c'.repeat(64)}` }),
    /a build record describes work that is actually there/
  );

  // And the same record, once the work it claims is genuinely staged.
  const repoRoot = path.join(treeRoot, '..');
  fs.writeFileSync(path.join(repoRoot, 'work.txt'), 'the chunk\n');
  execFileSync('git', ['add', 'work.txt'], { cwd: repoRoot });
  const { seq } = recordChunk(treeRoot, 'M1', { ...built, diff_digest: stagedDiffDigest(repoRoot) });
  assert.equal(typeof seq, 'number');
});

test('recordChunk verifies the staged diff in the repository a caller NAMES', () => {
  const treeRoot = makeTreeRoot();
  const built = chunkAwaitingBuild(treeRoot);
  // A second repository, with different work staged in it.
  const otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-other-'));
  const git = (...args) => execFileSync('git', args, { cwd: otherRepo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(otherRepo, 'elsewhere.txt'), 'other work\n');
  git('add', 'elsewhere.txt');

  // The default repoRoot would answer with the tree's own parent; the override
  // is what lets a caller working in a capsule name the repository the build
  // actually happened in.
  assert.throws(() => recordChunk(treeRoot, 'M1', built, { repoRoot: otherRepo }), /describes work that is actually there/);
  const { seq } = recordChunk(
    treeRoot,
    'M1',
    { ...built, diff_digest: stagedDiffDigest(otherRepo) },
    { repoRoot: otherRepo }
  );
  assert.equal(typeof seq, 'number');
});

test('recordChunk refuses to verify a build against a ledger it cannot read whole', () => {
  const treeRoot = makeTreeRoot();
  const built = chunkAwaitingBuild(treeRoot);
  fs.appendFileSync(path.join(treeRoot, 'ledger.jsonl'), '{not json\n');

  // Deciding "this build's receipt is fine" from a stream that half-parsed is
  // the same mistake as deciding it has none.
  assert.throws(() => recordChunk(treeRoot, 'M1', built), /does not read whole/);
});

test('a well-shaped "chunk-built" with no receipt behind it cannot be written at all', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));

  // This is the hole the whole chunk exists to close: mint a build record,
  // obtain a reviewer, skip the evidence. Every field is present and
  // well-formed; nothing on the ledger backs any of it.
  const forged = {
    kind: 'chunk-built',
    chunk_id: 'C1',
    actual_family: 'gpt',
    intended_family: 'gpt',
    model_id: 'gpt-5.6-sol',
    dispatch_ref: 'ledger:0',
    result_digest: `sha256:${'a'.repeat(64)}`,
    diff_digest: `sha256:${'a'.repeat(64)}`,
  };

  assert.throws(() => recordChunk(treeRoot, 'M1', forged), /is not a "dispatch-terminal" record/);
  const records = readRecords(path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl')).records;
  assert.equal(records.filter((r) => r.kind === 'chunk-built').length, 0);
});

test('recordChunk rejects "chunk-built" before "chunk-start" (out-of-order)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));

  assert.throws(
    () => recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1')),
    /requires the chunk's prior lifecycle record to be "chunk-start"/
  );
});

// ---------- recordChunk: chunk-review ----------

test('recordChunk rejects "chunk-review" without a well-formed review object', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  assert.throws(() => recordChunk(treeRoot, 'M1', { kind: 'chunk-review', chunk_id: 'C1' }), /review/);
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-review', chunk_id: 'C1', review: { family: 'claude', verdict: 'green', ref: 'x' } }),
    /review/
  );
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-review', chunk_id: 'C1', review: { family: 'sonnet', verdict: 'approve', ref: 'x' } }),
    /review/
  );
});

test('recordChunk rejects "chunk-review" before "chunk-start"', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  assert.throws(
    () => recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve')),
    /requires the chunk's prior lifecycle record to be "chunk-built" or "chunk-review"/
  );
});

test('recordChunk allows a revise loop: multiple sequential chunk-review records', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'revise'));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'revise'));
  const { seq } = recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve'));
  assert.equal(typeof seq, 'number');
});

test('recordChunk refuses a "chunk-review" recorded after the chunk already reached chunk-green (no reopening a closed chunk)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');
  assert.throws(
    () => recordChunk(treeRoot, 'M1', reviewRecord('C1', 'revise')),
    /requires the chunk's prior lifecycle record to be "chunk-built" or "chunk-review"/
  );
});

// ---------- recordChunk: chunk-green ----------

test('recordChunk REJECTS "chunk-green" without a verification object (the load-bearing case)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve'));
  const { verification, ...withoutVerification } = greenRecord('C1');
  assert.throws(() => recordChunk(treeRoot, 'M1', withoutVerification), /verification/);
});

test('recordChunk rejects "chunk-green" whose verification carries a non-zero exit_code', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve'));
  const record = greenRecord('C1', { verification: { gate_id: 'C1-unit', cmd: 'node --test', exit_code: 1 } });
  assert.throws(() => recordChunk(treeRoot, 'M1', record), /verification/);
});

test('recordChunk rejects "chunk-green" whose own review.verdict is not "approve"', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve'));
  const record = greenRecord('C1', { review: { family: 'claude', verdict: 'revise', ref: 'envelopes/implementation/C1-review.json' } });
  assert.throws(() => recordChunk(treeRoot, 'M1', record), /review\.verdict/);
});

test('recordChunk rejects "chunk-green" without a commit', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve'));
  const { commit, ...withoutCommit } = greenRecord('C1');
  assert.throws(() => recordChunk(treeRoot, 'M1', withoutCommit), /commit/);
});

test('recordChunk rejects "chunk-green" whose commit does not look like a git SHA', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve'));
  const record = greenRecord('C1', { commit: 'not-a-sha' });
  assert.throws(() => recordChunk(treeRoot, 'M1', record), /git SHA/);
});

test('recordChunk rejects "chunk-green" before a "chunk-review" record exists', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  assert.throws(
    () => recordChunk(treeRoot, 'M1', greenRecord('C1')),
    /requires the chunk's prior lifecycle record to be "chunk-review"/
  );
});

test('recordChunk rejects "chunk-green" when the latest chunk-review verdict is "revise"', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'revise'));
  assert.throws(
    () => recordChunk(treeRoot, 'M1', greenRecord('C1')),
    /latest "chunk-review" record's verdict to be "approve"/
  );
});

test('recordChunk rejects "chunk-green" whose review does not exactly match the latest chunk-review record (forged evidence closed)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve'));
  const forgedRef = greenRecord('C1', { review: { family: 'claude', verdict: 'approve', ref: 'invented-ref.json' } });
  assert.throws(() => recordChunk(treeRoot, 'M1', forgedRef), /must carry the exact "review"/);
  const forgedFamily = greenRecord('C1', { review: { family: 'gpt', verdict: 'approve', ref: `envelopes/implementation/C1-review.json` } });
  assert.throws(() => recordChunk(treeRoot, 'M1', forgedFamily), /must carry the exact "review"/);
});

test('recordChunk rejects "chunk-green" whose review.family equals the family that built it (cross-family law, no intent/outcome split)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1', { implementer_family: 'gpt' }));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: 'C1',
    review: { family: 'gpt', verdict: 'approve', ref: 'envelopes/implementation/C1-review.json' },
  });
  const record = greenRecord('C1', { review: { family: 'gpt', verdict: 'approve', ref: 'envelopes/implementation/C1-review.json' } });
  assert.throws(() => recordChunk(treeRoot, 'M1', record), /cross-family review law/);
});

// THE CASE THE INTENT-ONLY CHECK COULD NOT SEE. A chunk dispatched to the
// Sol-hosting seat (intent gpt, native transport) whose run came back attested
// as a Claude fallback was BUILT by claude — and a claude reviewer on it is a
// same-family review that the intent comparison waves through, because the
// intent still reads gpt. The sealed law is about who actually built.
test('recordChunk rejects "chunk-green" whose review.family equals the family that ACTUALLY built, even when the intent differs', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1', { implementer_family: 'gpt' }));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1', 'claude', 'M1', { intended: 'gpt' }));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve'));
  const record = greenRecord('C1');
  assert.throws(() => recordChunk(treeRoot, 'M1', record), /cross-family review law/);
});

// The same split, from the other side: after a fallback, the LAWFUL reviewer is
// the one whose family differs from the actual builder — and that family is the
// one the chunk was originally dispatched to. An intent-only check refuses it,
// which would leave a fallen-back chunk with no reviewer it could seal under at
// all: family-evidence's own selectReviewer routes to exactly this seat.
test('recordChunk accepts "chunk-green" whose review.family matches the INTENDED family but differs from the actual builder', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1', { implementer_family: 'gpt' }));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1', 'claude', 'M1', { intended: 'gpt' }));
  recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve', { review: { family: 'gpt', verdict: 'approve', ref: 'envelopes/implementation/C1-review.json' } }));
  const { seq } = recordChunk(
    treeRoot,
    'M1',
    greenRecord('C1', { review: { family: 'gpt', verdict: 'approve', ref: 'envelopes/implementation/C1-review.json' } })
  );
  assert.equal(typeof seq, 'number');
});

// The cross-family law reads one record, so a stream that lost it must refuse
// rather than fall back to a weaker question. recordChunk's own precedence
// keeps this shape from being written through the API; a stream can still
// acquire it by being hand-edited or restored, and reading is not writing.
test('recordChunk rejects "chunk-green" on a chunk whose stream carries no "chunk-built" at all', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  appendLine(path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl'), {
    schema_version: 1,
    seq: 99,
    kind: 'chunk-review',
    ts: new Date().toISOString(),
    correlation_id: 'C1',
    chunk_id: 'C1',
    review: { family: 'claude', verdict: 'approve', ref: 'envelopes/implementation/C1-review.json' },
  });

  assert.throws(
    () => recordChunk(treeRoot, 'M1', greenRecord('C1')),
    /no "chunk-built" record found, so nothing proves who built it/
  );
});

test('recordChunk accepts a well-formed "chunk-green" record (default gpt-implemented/claude-reviewed pairing)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  const { seq } = recordThroughGreen(treeRoot, 'M1', 'C1');
  assert.equal(typeof seq, 'number');
});

test('recordChunk accepts the other cross-family pairing (claude-implemented/gpt-reviewed)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'claude' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1', { implementer_seat: 'opus', implementer_family: 'claude' }));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1', 'claude'));
  recordChunk(treeRoot, 'M1', {
    kind: 'chunk-review',
    chunk_id: 'C1',
    review: { family: 'gpt', verdict: 'approve', ref: 'envelopes/implementation/C1-review.json' },
  });
  const { seq } = recordChunk(
    treeRoot,
    'M1',
    greenRecord('C1', { review: { family: 'gpt', verdict: 'approve', ref: 'envelopes/implementation/C1-review.json' } })
  );
  assert.equal(typeof seq, 'number');
});

// ---------- recordChunk: chunk-consult / chunk-journeys ----------

test('recordChunk accepts a well-formed "chunk-consult" record once the chunk exists', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  const { seq } = recordChunk(treeRoot, 'M1', {
    kind: 'chunk-consult',
    chunk_id: 'C1',
    consult_id: 'Q1',
    asker: 'implementer-sol',
    question: 'Does "outcome" include the CLI flag parsing?',
    verdict: 'Yes — spec.md#C1 names it explicitly.',
    anchor: 'milestones/M1/spec.md:12',
  });
  assert.equal(typeof seq, 'number');
});

test('recordChunk rejects "chunk-consult" missing required fields', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-consult', chunk_id: 'C1', consult_id: 'Q1' }),
    /chunk-consult/
  );
});

test('recordChunk rejects "chunk-consult"/"chunk-journeys" before the chunk exists', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  assert.throws(
    () =>
      recordChunk(treeRoot, 'M1', {
        kind: 'chunk-consult',
        chunk_id: 'C1',
        consult_id: 'Q1',
        asker: 'x',
        question: 'x',
        verdict: 'x',
        anchor: 'x',
      }),
    /requires a prior "chunk-spec"/
  );
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-journeys', chunk_id: 'C1', journey_ids: ['J1'] }),
    /requires a prior "chunk-spec"/
  );
});

test('recordChunk rejects "chunk-journeys" with an empty journey_ids array', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-journeys', chunk_id: 'C1', journey_ids: [] }),
    /journey_ids/
  );
});

// THE ONE KIND THAT IS WRITTEN ALONGSIDE ANOTHER ARTIFACT, so the one kind that
// needs a replay to be free. `journeys.js` writes this record and then the
// catalog entry; a crash between the two has to be re-enterable, and it only is
// if re-recording the same authorship is a no-op rather than a second record.
test('an identical "chunk-journeys" replay returns the existing receipt and appends nothing', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  const first = recordChunk(treeRoot, 'M1', { kind: 'chunk-journeys', chunk_id: 'C1', journey_ids: ['J1'] });
  const chunksPath = path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl');
  const before = fs.readFileSync(chunksPath);
  const stat = fs.statSync(chunksPath);

  const again = recordChunk(treeRoot, 'M1', { kind: 'chunk-journeys', chunk_id: 'C1', journey_ids: ['J1'] });

  assert.equal(again.seq, first.seq, 'the replay minted a new record instead of adopting the existing one');
  assert.deepEqual(fs.readFileSync(chunksPath), before);
  assert.equal(fs.statSync(chunksPath).ino, stat.ino);
  assert.equal(fs.statSync(chunksPath).mtimeMs, stat.mtimeMs);
  assert.equal(
    readRecords(chunksPath).records.filter((r) => r.kind === 'chunk-journeys').length,
    1,
    'the stream carries two authorship records for one chunk'
  );
});

// A DIFFERING payload is not a replay, it is a contradiction: the same chunk
// cannot have authored two different sets of journeys, and quietly appending
// the second would leave the stream unable to say which is true.
test('a "chunk-journeys" record naming different journeys for the same chunk is refused', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', { kind: 'chunk-journeys', chunk_id: 'C1', journey_ids: ['J1'] });
  const chunksPath = path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl');
  const before = fs.readFileSync(chunksPath);

  assert.throws(
    () => recordChunk(treeRoot, 'M1', { kind: 'chunk-journeys', chunk_id: 'C1', journey_ids: ['J2'] }),
    /already recorded/
  );
  assert.deepEqual(fs.readFileSync(chunksPath), before, 'the refused record was appended anyway');

  // A DIFFERENT chunk authoring its own journeys is untouched by any of this.
  recordChunk(treeRoot, 'M1', specRecord('C2'));
  const other = recordChunk(treeRoot, 'M1', { kind: 'chunk-journeys', chunk_id: 'C2', journey_ids: ['J2'] });
  assert.equal(typeof other.seq, 'number');
});

test('a "chunk-journeys" record does not disturb the strict lifecycle pointer', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));
  recordChunk(treeRoot, 'M1', evidencedBuilt(treeRoot, 'C1'));
  recordChunk(treeRoot, 'M1', { kind: 'chunk-journeys', chunk_id: 'C1', journey_ids: ['J1'] });
  // still legal to move from chunk-start -> chunk-review even though a
  // chunk-journeys record is now the most recent record overall.
  const { seq } = recordChunk(treeRoot, 'M1', reviewRecord('C1', 'approve'));
  assert.equal(typeof seq, 'number');
});

// ---------- closeMilestone: chunk-completeness ----------

test('closeMilestone refuses a milestone with zero chunk records', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  assert.throws(() => closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true }), /no chunk records/);
});

test('closeMilestone refuses when a chunk\'s latest lifecycle record is not "chunk-green"', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', specRecord('C1'));
  recordChunk(treeRoot, 'M1', startRecord('C1'));

  assert.throws(
    () => closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true }),
    /non-green chunks.*C1.*chunk-start/s
  );
  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'));
  assert.equal(index.milestones[0].status, 'open');
});

test('closeMilestone refuses when ANY chunk (among several) is not green yet', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');
  recordChunk(treeRoot, 'M1', specRecord('C2'));

  assert.throws(() => closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true }), /C2/);
});

test('closeMilestone succeeds once every recorded chunk is green, flips index status to "green"', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');
  recordThroughGreen(treeRoot, 'M1', 'C2');

  const result = closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.chunkIds.sort(), ['C1', 'C2']);

  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'));
  assert.equal(index.milestones[0].status, 'green');
  assert.equal(index.milestones[0].tag, CLOSE_INFO.tag);
  assert.equal(index.milestones[0].merge_sha, CLOSE_INFO.merge_sha);
  assert.equal(index.milestones[0].review_evidence, CLOSE_INFO.review_evidence);
});

test('closeMilestone succeeds when a chunk-journeys record follows chunk-green (side-channel records never disturb the lifecycle pointer)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');
  recordChunk(treeRoot, 'M1', { kind: 'chunk-journeys', chunk_id: 'C1', journey_ids: ['J1'] });
  const result = closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true });
  assert.equal(result.ok, true);
});

test('closeMilestone refuses when the milestone does not exist', () => {
  const treeRoot = makeTreeRoot();
  assert.throws(() => closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true }), /no such milestone/);
});

test('closeMilestone refuses on a chunks.jsonl carrying a malformed line', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');
  fs.appendFileSync(path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl'), 'not-json\n');
  assert.throws(() => closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true }), /malformed record/);
});

test('closeMilestone refuses on a chunks.jsonl record violating the common header', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');
  const chunksPath = path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl');
  fs.appendFileSync(chunksPath, `${JSON.stringify({ kind: 'chunk-spec', chunk_id: 'ZZ' })}\n`);
  assert.throws(() => closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true }), /violating the common JSONL header/);
});

// ---------- closeMilestone: required close-info fields ----------

test('closeMilestone requires a {tag, merge_sha, review_evidence} object, all three non-empty', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');
  assert.throws(() => closeMilestone(treeRoot, 'M1'), /closeMilestone requires/);
  assert.throws(
    () => closeMilestone(treeRoot, 'M1', { merge_sha: 'x', review_evidence: 'y' }, { skipGitVerify: true }),
    /"tag"/
  );
  assert.throws(
    () => closeMilestone(treeRoot, 'M1', { tag: 'x', review_evidence: 'y' }, { skipGitVerify: true }),
    /"merge_sha"/
  );
  assert.throws(
    () => closeMilestone(treeRoot, 'M1', { tag: 'x', merge_sha: 'y' }, { skipGitVerify: true }),
    /"review_evidence"/
  );
});

// ---------- closeMilestone: git binding ----------

test('closeMilestone verifies merge_sha and tag against a real git repo (default repoRoot = treeRoot/..)', () => {
  const { repoRoot, sha } = makeGitRepoWithTag('milestone/M1-green');
  const treeRoot = path.join(repoRoot, '.thelastskill');
  fs.mkdirSync(treeRoot, { recursive: true });
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');

  const result = closeMilestone(treeRoot, 'M1', {
    tag: 'milestone/M1-green',
    merge_sha: sha,
    review_evidence: 'envelopes/implementation/M1-review.json',
  });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);

  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'));
  assert.equal(index.milestones[0].verified, true);
  assert.equal(index.milestones[0].tag, 'milestone/M1-green');
  assert.equal(index.milestones[0].merge_sha, sha);
});

test('closeMilestone accepts opts.repoRoot pointing at a git repo not adjacent to treeRoot', () => {
  const { repoRoot, sha } = makeGitRepoWithTag('milestone/M1-green');
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');

  const result = closeMilestone(
    treeRoot,
    'M1',
    { tag: 'milestone/M1-green', merge_sha: sha, review_evidence: 'x' },
    { repoRoot }
  );
  assert.equal(result.verified, true);
});

test('closeMilestone refuses when merge_sha does not exist in the git repo', () => {
  const { repoRoot } = makeGitRepoWithTag('milestone/M1-green');
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');

  assert.throws(
    () =>
      closeMilestone(
        treeRoot,
        'M1',
        { tag: 'milestone/M1-green', merge_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', review_evidence: 'x' },
        { repoRoot }
      ),
    /could not verify merge_sha/
  );

  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'));
  assert.equal(index.milestones[0].status, 'open');
});

test('closeMilestone refuses when the tag does not exist in the git repo', () => {
  const { repoRoot, sha } = makeGitRepoWithTag('milestone/M1-green');
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');

  assert.throws(
    () => closeMilestone(treeRoot, 'M1', { tag: 'no-such-tag', merge_sha: sha, review_evidence: 'x' }, { repoRoot }),
    /could not verify tag/
  );
});

test('closeMilestone refuses when repoRoot is not a git repository at all', () => {
  const treeRoot = makeTreeRoot();
  const notARepo = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');

  assert.throws(
    () =>
      closeMilestone(
        treeRoot,
        'M1',
        { tag: 'milestone/M1-green', merge_sha: '0123456789abcdef0123456789abcdef01234567', review_evidence: 'x' },
        { repoRoot: notARepo }
      ),
    /could not verify merge_sha/
  );
});

test('closeMilestone honors opts.skipGitVerify explicitly, recording verified:false', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');

  const result = closeMilestone(treeRoot, 'M1', CLOSE_INFO, { skipGitVerify: true });
  assert.equal(result.ok, true);
  assert.equal(result.verified, false);

  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'));
  assert.equal(index.milestones[0].verified, false);
});

test('closeMilestone defaults to real git verification when skipGitVerify is not passed (fails closed without a real repo)', () => {
  const treeRoot = makeTreeRoot();
  createMilestone(treeRoot, { id: 'M1', title: 'X', designer_family: 'gpt' });
  recordThroughGreen(treeRoot, 'M1', 'C1');

  assert.throws(() => closeMilestone(treeRoot, 'M1', CLOSE_INFO), /could not verify merge_sha/);
});
