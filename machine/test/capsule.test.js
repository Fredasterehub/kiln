'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  openCapsule,
  exportDiff,
  applyToStaging,
  closeCapsule,
  syncWorktreeToHead,
} = require('../src/capsule.js');
const { stagedDiffDigest } = require('../src/staged-diff.js');
const { createMilestone, recordChunk } = require('../src/milestones.js');
const { writeDispatch, writeDispatchTerminal } = require('../src/receipts.js');
const { sealChunk } = require('../src/implementation.js');
const { runGate } = require('../src/check-honesty.js');

const MODULE_PATH = path.resolve(__dirname, '..', 'src', 'capsule.js');
const MILESTONE = 'M1';
const CHUNK = 'C1';
const BRANCH = `milestone/${MILESTONE}`;
const TREE_NAME = '.thelastskill';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// A real repository on a milestone branch, with the machine tree living inside
// it exactly as it does in the field: present on disk, ignored by git, and
// therefore invisible to a worktree of that branch.
function makeWorkspace(parentDir = null, name = 'project') {
  const parent = parentDir || fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-test-'));
  const repoRoot = path.join(parent, name);
  fs.mkdirSync(repoRoot);
  git(repoRoot, 'init', '-q', '-b', 'main');
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), `${TREE_NAME}/\n`);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n');
  fs.writeFileSync(path.join(repoRoot, 'src.txt'), 'original\n');
  git(repoRoot, 'add', '.gitignore', 'README.md', 'src.txt');
  git(repoRoot, 'commit', '-q', '-m', 'initial');
  git(repoRoot, 'checkout', '-q', '-b', BRANCH);

  const treeRoot = path.join(repoRoot, TREE_NAME);
  fs.mkdirSync(treeRoot, { recursive: true });
  return { repoRoot, treeRoot, parent };
}

function opened(treeRoot, repoRoot, milestoneId = MILESTONE, chunkId = CHUNK) {
  return openCapsule(treeRoot, repoRoot, milestoneId, chunkId);
}

// What an implementer does inside its capsule: change a tracked file, and add
// a new one. A new file only crosses the boundary if it is STAGED — that is
// the "named new files" half of the export contract.
function buildInCapsule(capsuleDir) {
  fs.writeFileSync(path.join(capsuleDir, 'src.txt'), 'the chunk\n');
  fs.writeFileSync(path.join(capsuleDir, 'feature.txt'), 'new work\n');
  git(capsuleDir, 'add', 'feature.txt');
}

// Everything an implementer could write that must never cross: machine
// records under the tree's own directory, in the capsule.
function plantForgeries(capsuleDir) {
  const forged = path.join(capsuleDir, TREE_NAME);
  fs.mkdirSync(path.join(forged, 'milestones', MILESTONE), { recursive: true });
  fs.writeFileSync(path.join(forged, 'ledger.jsonl'), '{"forged":true}\n');
  fs.writeFileSync(path.join(forged, 'state.json'), '{"phase":"delivery"}\n');
  fs.writeFileSync(path.join(forged, 'milestones', MILESTONE, 'chunks.jsonl'), '{"kind":"chunk-green"}\n');
}

function replayInFreshProcess(fnName, args) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-replay-'));
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

// ---------- openCapsule ----------

test('openCapsule puts a detached worktree of the milestone tip OUTSIDE the project', () => {
  const { repoRoot, treeRoot } = makeWorkspace();

  const capsule = opened(treeRoot, repoRoot);

  assert.ok(fs.existsSync(capsule.capsuleDir));
  // Outside the repository, so nothing an implementer writes there can even
  // appear in the project's own status, let alone its index.
  assert.equal(capsule.capsuleDir.startsWith(repoRoot + path.sep), false);
  // DETACHED: the milestone branch is checked out in the project itself, and
  // git refuses a second worktree on a checked-out branch — so the capsule
  // sits at that branch's tip rather than on the branch.
  assert.equal(git(capsule.capsuleDir, 'rev-parse', 'HEAD').trim(), git(repoRoot, 'rev-parse', BRANCH).trim());
  // Detached means HEAD is not a symbolic ref, which is exactly what
  // `symbolic-ref` refuses to answer.
  assert.throws(() => git(capsule.capsuleDir, 'symbolic-ref', '--quiet', 'HEAD'));
});

test('the machine tree does not exist inside the capsule at all', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  fs.writeFileSync(path.join(treeRoot, 'state.json'), '{"phase":"implementation"}\n');

  const capsule = opened(treeRoot, repoRoot);

  // Not hidden, not ignored, not empty — ABSENT. The implementer cannot write
  // a machine record it can see, because there is nothing there to write to.
  assert.equal(fs.existsSync(path.join(capsule.capsuleDir, TREE_NAME)), false);
});

test('openCapsule refuses a repository that TRACKS the machine tree', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  fs.writeFileSync(path.join(treeRoot, 'state.json'), '{}\n');
  git(repoRoot, 'add', '-f', `${TREE_NAME}/state.json`);
  git(repoRoot, 'commit', '-q', '-m', 'tracked tree');

  // Verified, never assumed: if the tree is tracked, a worktree of the branch
  // materializes it inside the capsule and the whole isolation is gone.
  assert.throws(() => opened(treeRoot, repoRoot), /is tracked/);
});

test('openCapsule refuses a repository that does not ignore the machine tree', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'nothing\n');
  git(repoRoot, 'add', '.gitignore');
  git(repoRoot, 'commit', '-q', '-m', 'stop ignoring the tree');

  // Untracked is not the same as unreachable: an unignored tree is one
  // `git add -A` away from being staged, and the export would carry it.
  assert.throws(() => opened(treeRoot, repoRoot), /is not ignored/);
});

test('openCapsule is idempotent — reopening returns the same capsule, never a second one', () => {
  const { repoRoot, treeRoot } = makeWorkspace();

  const first = opened(treeRoot, repoRoot);
  fs.writeFileSync(path.join(first.capsuleDir, 'src.txt'), 'work in progress\n');
  const second = opened(treeRoot, repoRoot);

  assert.equal(second.capsuleDir, first.capsuleDir);
  assert.equal(second.state, 'reopened');
  // The work survives: a reopen is a resume, not a fresh checkout.
  assert.equal(fs.readFileSync(path.join(second.capsuleDir, 'src.txt'), 'utf8'), 'work in progress\n');
  assert.equal(git(repoRoot, 'worktree', 'list').trim().split('\n').length, 2);
});

test('openCapsule refuses ids that cannot name a directory', () => {
  const { repoRoot, treeRoot } = makeWorkspace();

  // A capsule's location is derived from (milestone, chunk); neither id is
  // shape-constrained upstream, so an id that would escape its own directory
  // is refused rather than resolved.
  assert.throws(() => opened(treeRoot, repoRoot, '../escape', CHUNK), /milestoneId/);
  assert.throws(() => opened(treeRoot, repoRoot, MILESTONE, 'a/b'), /chunkId/);
  assert.throws(() => opened(treeRoot, repoRoot, '', CHUNK), /milestoneId/);
});

test('two sibling repositories do not share one capsule', () => {
  // SIBLINGS: the same parent directory, which is where the capsules root
  // lives. Two repos in unrelated temp dirs would not collide however the key
  // is built, and would prove nothing.
  const first = makeWorkspace();
  const second = makeWorkspace(first.parent, 'project-two');
  // Same milestone, same chunk, different checkouts of the same project — the
  // ordinary shape of two machines, or two worktrees, working in parallel.
  const a = opened(first.treeRoot, first.repoRoot);
  const b = opened(second.treeRoot, second.repoRoot);

  assert.notEqual(a.capsuleDir, b.capsuleDir);
  fs.writeFileSync(path.join(a.capsuleDir, 'src.txt'), 'A work\n');
  fs.writeFileSync(path.join(b.capsuleDir, 'src.txt'), 'B work\n');
  // Keyed on (milestone, chunk) alone these resolve to one directory, and the
  // second repository reopens the first's worktree and exports its work.
  assert.equal(fs.readFileSync(path.join(a.capsuleDir, 'src.txt'), 'utf8'), 'A work\n');
  assert.equal(exportDiff(a.capsuleDir).patch_digest, exportDiff(a.capsuleDir).patch_digest);
  assert.notEqual(exportDiff(a.capsuleDir).patch_digest, exportDiff(b.capsuleDir).patch_digest);
});

test('a capsule record that belongs to something else is refused, never resumed', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  const recordPath = `${capsule.capsuleDir}.capsule.json`;

  for (const [field, value] of [
    ['repo_root', '/somewhere/else'],
    ['branch', 'milestone/M9'],
    ['tree_name', '.other'],
    ['chunk_id', 'C9'],
  ]) {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    fs.writeFileSync(recordPath, JSON.stringify({ ...record, [field]: value }));

    // Reopening is a resume, and a resume has to be of the same thing.
    assert.throws(() => opened(treeRoot, repoRoot), /belongs to something else/, field);
    fs.writeFileSync(recordPath, JSON.stringify(record));
  }
});

test('a capsule whose worktree never got created is finished on reopen, not stranded', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  const base = capsule.record.base_commit;
  // The crash window: the record is durable and the worktree is gone. Created
  // in the other order this capsule would be unreachable — `worktree add`
  // fails on an existing path, and close refuses without a record.
  git(repoRoot, 'worktree', 'remove', '--force', capsule.capsuleDir);

  const reopened = opened(treeRoot, repoRoot);

  assert.equal(reopened.capsuleDir, capsule.capsuleDir);
  assert.equal(reopened.state, 'reopened');
  assert.ok(fs.existsSync(reopened.capsuleDir));
  // At the commit it was opened against, so a resumed capsule is the same
  // capsule rather than a newer one.
  assert.equal(git(reopened.capsuleDir, 'rev-parse', 'HEAD').trim(), base);
  assert.equal(closeCapsule(reopened.capsuleDir).state, 'closed');
});

test('a worktree git never finished registering is rebuilt on reopen, not resumed as-is', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  fs.writeFileSync(path.join(capsule.capsuleDir, 'half-written.txt'), 'from the interrupted add\n');

  // The state a `git worktree add` killed partway leaves behind: files on
  // disk, and git never finished registering them. Reproduced deterministically
  // rather than by racing a real kill — what matters is the state, and this is
  // exactly it: the admin entry gone and the capsule's own .git pointer gone.
  fs.rmSync(path.join(capsule.capsuleDir, '.git'), { force: true });
  fs.rmSync(path.join(repoRoot, '.git', 'worktrees', CHUNK), { recursive: true, force: true });
  assert.ok(fs.existsSync(capsule.capsuleDir), 'the fixture did not leave a directory behind');
  assert.equal(git(repoRoot, 'worktree', 'list').includes(capsule.capsuleDir), false);

  const reopened = opened(treeRoot, repoRoot);

  // A directory check would have called this ready and handed back a path
  // where every git command fails. Registration is the question, so the
  // half-built capsule is cleared and finished at the recorded commit.
  assert.equal(reopened.state, 'reopened');
  assert.equal(git(reopened.capsuleDir, 'rev-parse', 'HEAD').trim(), capsule.record.base_commit);
  assert.equal(fs.existsSync(path.join(reopened.capsuleDir, 'half-written.txt')), false);
  assert.equal(exportDiff(reopened.capsuleDir).patch_digest.startsWith('sha256:'), true);
  assert.equal(closeCapsule(reopened.capsuleDir).state, 'closed');
});

test('every single signal of a broken registration is enough to rebuild the capsule', () => {
  const other = makeWorkspace();

  // Each case breaks EXACTLY ONE of the things that make a worktree real, so
  // each check has to carry its own weight. Breaking all of them at once — the
  // interrupted-add fixture above — would pass with any one of them present.
  const cases = [
    [
      'git no longer lists it',
      (repoRoot, capsuleDir) => fs.rmSync(path.join(repoRoot, '.git', 'worktrees', CHUNK), { recursive: true, force: true }),
    ],
    ['the capsule has no .git pointer', (repoRoot, capsuleDir) => fs.rmSync(path.join(capsuleDir, '.git'), { force: true })],
    [
      'the .git pointer leads to another repository',
      (repoRoot, capsuleDir) =>
        fs.writeFileSync(path.join(capsuleDir, '.git'), `gitdir: ${path.join(other.repoRoot, '.git', 'worktrees', CHUNK)}\n`),
    ],
    [
      'the directory is gone but git still lists it',
      (repoRoot, capsuleDir) => fs.rmSync(capsuleDir, { recursive: true, force: true }),
    ],
  ];

  for (const [label, breakIt] of cases) {
    const { repoRoot, treeRoot } = makeWorkspace();
    const capsule = opened(treeRoot, repoRoot);
    breakIt(repoRoot, capsule.capsuleDir);

    const reopened = opened(treeRoot, repoRoot);

    assert.equal(reopened.state, 'reopened', label);
    assert.equal(git(reopened.capsuleDir, 'rev-parse', 'HEAD').trim(), capsule.record.base_commit, label);
    assert.ok(fs.existsSync(path.join(reopened.capsuleDir, '.git')), label);
    assert.equal(closeCapsule(reopened.capsuleDir).state, 'closed', label);
  }
});

test('a capsule git cannot remove is still discardable through the same API', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  fs.rmSync(path.join(capsule.capsuleDir, '.git'), { force: true });
  fs.rmSync(path.join(repoRoot, '.git', 'worktrees', CHUNK), { recursive: true, force: true });

  // git refuses to remove a worktree it does not know about. A capsule that
  // could not be discarded would be a directory nothing in the API can reach —
  // the same dead end the record-first ordering exists to prevent.
  const closed = closeCapsule(capsule.capsuleDir);

  assert.equal(closed.state, 'closed');
  assert.equal(fs.existsSync(capsule.capsuleDir), false);
  assert.equal(git(repoRoot, 'status', '--porcelain').trim(), '');
});

// ---------- exportDiff ----------

test('exportDiff captures tracked changes and staged new files, and nothing else', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  fs.writeFileSync(path.join(capsule.capsuleDir, 'scratch.txt'), 'never staged\n');

  const exported = exportDiff(capsule.capsuleDir);
  const patch = fs.readFileSync(exported.patch_path, 'utf8');

  assert.match(patch, /a\/src\.txt/);
  assert.match(patch, /b\/feature\.txt/);
  // An unstaged new file is not part of the work anybody approved.
  assert.equal(patch.includes('scratch.txt'), false);
  assert.match(exported.patch_digest, /^sha256:[0-9a-f]{64}$/);
});

test('nothing an implementer writes under the machine tree reaches the patch', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  plantForgeries(capsule.capsuleDir);

  const patch = fs.readFileSync(exportDiff(capsule.capsuleDir).patch_path, 'utf8');

  assert.equal(patch.includes(TREE_NAME), false, 'a forged machine record reached the patch');
  assert.equal(patch.includes('forged'), false);
});

test('exportDiff refuses a patch that touches the machine tree, however it got staged', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  plantForgeries(capsule.capsuleDir);
  // `git add -f` defeats the ignore rule. It does not defeat this.
  git(capsule.capsuleDir, 'add', '-f', `${TREE_NAME}/ledger.jsonl`);

  assert.throws(() => exportDiff(capsule.capsuleDir), /machine tree/);
});

test('a machine-tree path git QUOTES is refused just the same', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  // core.quotePath is on deliberately, so this path appears in the patch
  // header as ".thelastskill/\\303\\251.jsonl" — a reader that recognised only
  // unquoted headers would walk straight past the one file that must never
  // cross, which is exactly the shape of a real bypass.
  const forged = path.join(capsule.capsuleDir, TREE_NAME);
  fs.mkdirSync(forged, { recursive: true });
  fs.writeFileSync(path.join(forged, 'é.jsonl'), '{"forged":true}\n');
  git(capsule.capsuleDir, 'add', '-f', `${TREE_NAME}/é.jsonl`);

  assert.throws(() => exportDiff(capsule.capsuleDir), /machine tree/);
  assert.equal(fs.existsSync(`${capsule.capsuleDir}.patch`), false, 'a refused export still wrote a patch');
});

test('the two digests are two facts: the artifact reviewed, and the work staged', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);

  const exported = exportDiff(capsule.capsuleDir);
  const applied = applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);

  // patch_digest names the bytes a reviewer read, and is stable across
  // re-exports of the same work.
  assert.equal(exportDiff(capsule.capsuleDir).patch_digest, exported.patch_digest);
  assert.equal(applied.patch_digest, exported.patch_digest);
  // diff_digest is the project's own account of what is staged — the value
  // milestones.js recomputes and sealChunk compares.
  assert.equal(applied.diff_digest, stagedDiffDigest(repoRoot));
});

test('a patch that changes .gitattributes still applies — the two digests simply differ', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  git(repoRoot, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(repoRoot, '.gitattributes'), '* text\n');
  git(repoRoot, 'add', '.gitattributes');
  git(repoRoot, 'commit', '-q', '-m', 'attributes');
  git(repoRoot, 'checkout', '-q', BRANCH);
  git(repoRoot, 'merge', '-q', 'main');
  const capsule = opened(treeRoot, repoRoot);

  // The counterexample that killed the byte-identity assumption: the capsule
  // renders src.txt under its OWN new attributes (binary), the project renders
  // it under its unchanged ones (text). Same logical change, different bytes.
  fs.writeFileSync(path.join(capsule.capsuleDir, '.gitattributes'), '*.txt -diff\n');
  fs.writeFileSync(path.join(capsule.capsuleDir, 'src.txt'), 'the chunk\n');
  git(capsule.capsuleDir, 'add', '.gitattributes');
  const exported = exportDiff(capsule.capsuleDir);

  const applied = applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);

  // A design resting on the two being equal would have rolled this back as a
  // mismatch and failed a perfectly valid build.
  assert.notEqual(applied.diff_digest, exported.patch_digest);
  assert.equal(applied.diff_digest, stagedDiffDigest(repoRoot));
  assert.match(git(repoRoot, 'diff', '--cached', '--name-only'), /src\.txt/);
});

// ---------- applyToStaging ----------

test('applyToStaging stages the exported work in the REAL repository', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);

  const applied = applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);

  assert.equal(applied.patch_digest, exported.patch_digest);
  assert.equal(applied.diff_digest, stagedDiffDigest(repoRoot));
  assert.match(git(repoRoot, 'diff', '--cached', '--name-only'), /feature\.txt/);
  // The working tree of the project is left alone: only the index moved.
  assert.equal(fs.readFileSync(path.join(repoRoot, 'src.txt'), 'utf8'), 'original\n');
});

test('applyToStaging refuses a digest that is not the patch it was handed', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);
  const before = stagedDiffDigest(repoRoot);

  assert.throws(
    () => applyToStaging(repoRoot, exported.patch_path, `sha256:${'f'.repeat(64)}`),
    /is not the artifact that was reviewed/
  );
  // A refusal leaves the index exactly as it found it — otherwise a rejected
  // patch would still be sitting in staging for the next thing that commits.
  assert.equal(stagedDiffDigest(repoRoot), before);
  assert.equal(git(repoRoot, 'diff', '--cached', '--name-only').trim(), '');
});

test('applyToStaging refuses to apply onto an index that already holds something', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'somebody else work\n');
  git(repoRoot, 'add', 'README.md');
  const before = stagedDiffDigest(repoRoot);

  // The approved diff is the staged diff. Applying on top of unrelated staged
  // work would make the staged diff something nobody approved.
  assert.throws(() => applyToStaging(repoRoot, exported.patch_path, exported.patch_digest), /already holds/);
  assert.equal(stagedDiffDigest(repoRoot), before);
});

test('applying twice is the same as applying once — a crash between apply and seal recovers', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);
  const first = applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);

  // The successor cannot tell whether its predecessor got as far as staging,
  // so it re-applies — and finds the work already there, under the digest it
  // was going to produce anyway.
  const again = applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);

  assert.equal(again.state, 'already-staged');
  assert.equal(again.diff_digest, first.diff_digest);
  assert.equal(stagedDiffDigest(repoRoot), first.diff_digest);
});

test('a replay citing a different or missing patch is refused, even when the digest matches', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);
  const applied = applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);
  const stagedBefore = stagedDiffDigest(repoRoot);

  // A retry names an artifact that is not the one reviewed. Answering
  // "already-staged" off the staged digest alone would accept it and quietly
  // detach the reviewed patch from the work that is staged.
  const corrupted = path.join(path.dirname(exported.patch_path), 'corrupted.patch');
  fs.writeFileSync(corrupted, 'not a patch at all\n');
  assert.throws(
    () => applyToStaging(repoRoot, corrupted, exported.patch_digest),
    /is not the artifact that was reviewed/
  );
  assert.throws(
    () => applyToStaging(repoRoot, path.join(path.dirname(exported.patch_path), 'gone.patch'), exported.patch_digest),
    /cannot read the patch/
  );

  assert.equal(stagedDiffDigest(repoRoot), stagedBefore);
  // And the honest replay still works.
  assert.equal(applyToStaging(repoRoot, exported.patch_path, exported.patch_digest).diff_digest, applied.diff_digest);
});

test('applyToStaging never touches the capsule', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);
  const capsuleBefore = git(capsule.capsuleDir, 'status', '--porcelain');

  applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);

  assert.equal(git(capsule.capsuleDir, 'status', '--porcelain'), capsuleBefore);
});

// ---------- forgery unavailability through the capsule path ----------

test('planted machine records have ZERO effect on canonical facts, end to end', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  createMilestone(treeRoot, { id: MILESTONE, title: 'Substrate', designer_family: 'gpt' });
  fs.writeFileSync(path.join(treeRoot, 'state.json'), '{"phase":"implementation"}\n');
  const ledgerBefore = fs.existsSync(path.join(treeRoot, 'ledger.jsonl'))
    ? fs.readFileSync(path.join(treeRoot, 'ledger.jsonl'))
    : Buffer.alloc(0);
  const chunksBefore = fs.readFileSync(path.join(treeRoot, 'milestones', MILESTONE, 'chunks.jsonl'));

  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  plantForgeries(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);
  applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);

  // The whole point of the capsule path, stated as bytes: the canonical
  // streams are untouched, and the forged files exist only in a directory that
  // is about to be deleted.
  assert.deepEqual(fs.readFileSync(path.join(treeRoot, 'milestones', MILESTONE, 'chunks.jsonl')), chunksBefore);
  assert.deepEqual(
    fs.existsSync(path.join(treeRoot, 'ledger.jsonl')) ? fs.readFileSync(path.join(treeRoot, 'ledger.jsonl')) : Buffer.alloc(0),
    ledgerBefore
  );
  assert.equal(fs.readFileSync(path.join(treeRoot, 'state.json'), 'utf8').includes('delivery'), false);
  assert.equal(git(repoRoot, 'diff', '--cached', '--name-only').includes(TREE_NAME), false);
});

// ---------- the machine boundary after export ----------

test('a mutation made after export changes neither what is staged nor what the boundary accepts', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  createMilestone(treeRoot, { id: MILESTONE, title: 'Substrate', designer_family: 'gpt' });
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);
  const applied = applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);

  // A reviewer — or anything else — writing into the capsule and the project's
  // working tree after the export. This is the API-BOUNDARY guarantee, and
  // only that: what a digest-verified patch stages does not depend on either
  // tree. It is not a claim that such writes are prevented; nothing here
  // prevents them.
  fs.writeFileSync(path.join(capsule.capsuleDir, 'src.txt'), 'reviewer meddling\n');
  fs.writeFileSync(path.join(capsule.capsuleDir, 'reviewer.txt'), 'meddling\n');
  fs.writeFileSync(path.join(repoRoot, 'src.txt'), 'meddling in the project too\n');

  assert.equal(stagedDiffDigest(repoRoot), applied.diff_digest);
  // And re-running the boundary operation over the same verified artifact
  // reaches the same answer, because the artifact is what governs.
  assert.equal(applyToStaging(repoRoot, exported.patch_path, exported.patch_digest).diff_digest, applied.diff_digest);
});

test('a mutation made after export does not make an unauthorized build acceptable', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  createMilestone(treeRoot, { id: MILESTONE, title: 'Substrate', designer_family: 'gpt' });
  recordChunk(treeRoot, MILESTONE, { kind: 'chunk-spec', chunk_id: CHUNK, brief_ref: 'M1/spec.md#C1' });
  recordChunk(treeRoot, MILESTONE, {
    kind: 'chunk-start',
    chunk_id: CHUNK,
    implementer_seat: 'implementer',
    implementer_family: 'gpt',
  });
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);
  const applied = applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);
  fs.writeFileSync(path.join(capsule.capsuleDir, 'src.txt'), 'meddling\n');

  // The other half of the boundary: staging the right work is not enough on
  // its own. A build record still has to cite a dispatch the tree can verify,
  // and one that cannot is refused however honest the diff is.
  assert.throws(
    () =>
      recordChunk(treeRoot, MILESTONE, {
        kind: 'chunk-built',
        chunk_id: CHUNK,
        actual_family: 'gpt',
        intended_family: 'gpt',
        model_id: 'gpt-5.6-sol',
        dispatch_ref: 'ledger:0',
        result_digest: `sha256:${'a'.repeat(64)}`,
        diff_digest: applied.diff_digest,
      }),
    /is not a "dispatch-terminal" record/
  );
});

test('the patch is the reviewed artifact, byte for byte', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);

  // What a reviewer reads IS what patch_digest names — not a rendering of it,
  // not a second diff taken later.
  const bytes = fs.readFileSync(exported.patch_path);
  assert.equal(
    `sha256:${require('node:crypto').createHash('sha256').update(bytes).digest('hex')}`,
    exported.patch_digest
  );

  // And work done in the capsule after export moves neither the artifact that
  // was reviewed nor anything staged.
  applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);
  const staged = stagedDiffDigest(repoRoot);
  fs.writeFileSync(path.join(capsule.capsuleDir, 'src.txt'), 'later meddling\n');
  assert.deepEqual(fs.readFileSync(exported.patch_path), bytes);
  assert.equal(stagedDiffDigest(repoRoot), staged);
});

// ---------- closeCapsule ----------

test('closeCapsule removes the worktree, records the close, and is idempotent', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);

  const closed = closeCapsule(capsule.capsuleDir);
  const recordAfterFirst = fs.readFileSync(`${capsule.capsuleDir}.capsule.json`);
  const again = closeCapsule(capsule.capsuleDir);

  assert.equal(closed.state, 'closed');
  assert.equal(again.state, 'closed');
  // Idempotent means the SECOND close changes nothing, not merely that it
  // answers the same way: a rewritten record would move closed_at and make
  // the tree disagree with itself about when the capsule ended.
  assert.deepEqual(again.record, closed.record);
  assert.deepEqual(fs.readFileSync(`${capsule.capsuleDir}.capsule.json`), recordAfterFirst);
  assert.equal(fs.existsSync(capsule.capsuleDir), false);
  assert.equal(git(repoRoot, 'worktree', 'list').trim().split('\n').length, 1);
  // The record outlives the worktree: a capsule that is gone is still a
  // capsule that happened.
  assert.equal(closed.record.milestone_id, MILESTONE);
  assert.equal(closed.record.chunk_id, CHUNK);
});

test('a capsule whose directory is already gone still closes, and leaves the repository alone', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  const head = git(repoRoot, 'rev-parse', 'HEAD').trim();
  // A crashed session, its capsule wiped by something else entirely.
  fs.rmSync(capsule.capsuleDir, { recursive: true, force: true });

  const closed = closeCapsule(capsule.capsuleDir);

  assert.equal(closed.state, 'closed');
  assert.equal(git(repoRoot, 'rev-parse', 'HEAD').trim(), head);
  assert.equal(git(repoRoot, 'status', '--porcelain').trim(), '');
});

test('closing a capsule discards its work — the repository never saw it', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);

  closeCapsule(capsule.capsuleDir);

  assert.equal(fs.readFileSync(path.join(repoRoot, 'src.txt'), 'utf8'), 'original\n');
  assert.equal(fs.existsSync(path.join(repoRoot, 'feature.txt')), false);
  assert.equal(git(repoRoot, 'diff', '--cached', '--name-only').trim(), '');
});

test('a fresh process reopens and closes the same capsule', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const first = opened(treeRoot, repoRoot);

  const replayed = replayInFreshProcess('openCapsule', [treeRoot, repoRoot, MILESTONE, CHUNK]);
  assert.equal(replayed.capsuleDir, first.capsuleDir);
  assert.equal(replayed.state, 'reopened');

  const closed = replayInFreshProcess('closeCapsule', [first.capsuleDir]);
  assert.equal(closed.state, 'closed');
  assert.equal(fs.existsSync(first.capsuleDir), false);
});

test('a directory that was never a capsule is not one', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const stranger = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-capsule-'));

  // The record beside the worktree is what says a capsule exists. Without it
  // there is no repository to remove a worktree from and no tree name to
  // refuse a patch against, and guessing either would be worse than refusing.
  assert.throws(() => exportDiff(stranger), /no capsule record/);
  assert.throws(() => closeCapsule(stranger), /no capsule record/);
  assert.equal(git(repoRoot, 'worktree', 'list').trim().split('\n').length, 1);
  assert.ok(fs.existsSync(stranger), 'a refusal deleted a directory it did not own');
});

test('every entry point refuses arguments that are not arguments', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const capsule = opened(treeRoot, repoRoot);
  const exported = exportDiff(capsule.capsuleDir);

  assert.throws(() => openCapsule('', repoRoot, MILESTONE, CHUNK), /treeRoot/);
  assert.throws(() => openCapsule(treeRoot, '', MILESTONE, CHUNK), /repoRoot/);
  assert.throws(() => exportDiff(''), /capsuleDir/);
  assert.throws(() => closeCapsule(''), /capsuleDir/);
  assert.throws(() => applyToStaging('', exported.patch_path, exported.patch_digest), /repoRoot/);
  assert.throws(() => applyToStaging(repoRoot, '', exported.patch_digest), /patchPath/);
  // A digest that is not one cannot be compared against anything, and the
  // comparison is the only reason the patch is trusted.
  assert.throws(() => applyToStaging(repoRoot, exported.patch_path, 'not-a-digest'), /digest of the form/);
  assert.throws(() => applyToStaging(repoRoot, exported.patch_path, undefined), /digest of the form/);
  assert.equal(git(repoRoot, 'diff', '--cached', '--name-only').trim(), '');
});

// ---------- the round trip, all the way to the boundary ----------

test('a build made in a capsule is one the chunk-built boundary accepts', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  createMilestone(treeRoot, { id: MILESTONE, title: 'Substrate', designer_family: 'gpt' });
  recordChunk(treeRoot, MILESTONE, { kind: 'chunk-spec', chunk_id: CHUNK, brief_ref: 'M1/spec.md#C1' });
  recordChunk(treeRoot, MILESTONE, {
    kind: 'chunk-start',
    chunk_id: CHUNK,
    implementer_seat: 'implementer',
    implementer_family: 'gpt',
  });
  const transportRef = { pid: 4242, pgid: 4242, session: '4242' };
  writeDispatch(treeRoot, {
    dispatch_id: 'D1',
    seat: 'implementer',
    transport: 'codex',
    intended_family: 'gpt',
    task_class: 'chunk_implementation',
    prompt_ref: 'briefs/C1.md',
    transport_ref: transportRef,
  });
  const { record: terminal } = writeDispatchTerminal(treeRoot, {
    dispatch_id: 'D1',
    status: 'ok',
    builder: 'sol',
    transport_ref: transportRef,
    result_ref: 'results/D1.md',
    model_id: 'gpt-5.6-sol',
    result_digest: `sha256:${'a'.repeat(64)}`,
  });

  const capsule = opened(treeRoot, repoRoot);
  buildInCapsule(capsule.capsuleDir);
  plantForgeries(capsule.capsuleDir);
  const exported = exportDiff(capsule.capsuleDir);
  const applied = applyToStaging(repoRoot, exported.patch_path, exported.patch_digest);

  // The digest the project reports for the staged work is the digest the
  // record carries and the
  // boundary recomputes — one fact from the worktree to the write.
  const { seq } = recordChunk(treeRoot, MILESTONE, {
    kind: 'chunk-built',
    chunk_id: CHUNK,
    actual_family: 'gpt',
    intended_family: 'gpt',
    model_id: 'gpt-5.6-sol',
    dispatch_ref: `ledger:${terminal.seq}`,
    result_digest: `sha256:${'a'.repeat(64)}`,
    diff_digest: applied.diff_digest,
  });

  assert.equal(typeof seq, 'number');

  // ...and all the way through the seal. A review, a gate, and the commit that
  // cites both — the capsule's work becoming a chunk of the milestone branch.
  const reviewRef = 'envelopes/implementation/C1-review.json';
  recordChunk(treeRoot, MILESTONE, {
    kind: 'chunk-review',
    chunk_id: CHUNK,
    review: { family: 'claude', verdict: 'approve', ref: reviewRef },
  });
  const gate = runGate({ gateId: 'C1-unit', cmd: 'true', ledgerPath: path.join(treeRoot, 'ledger.jsonl') });
  const sealed = sealChunk(
    treeRoot,
    MILESTONE,
    CHUNK,
    { diff_digest: applied.diff_digest, review_ref: reviewRef, gate_ref: `ledger:${gate.seq}` },
    { repoRoot }
  );

  assert.match(sealed.commit, /^[0-9a-f]{40}$/);
  assert.equal(sealed.diff_digest, applied.diff_digest);
  // The commit holds the capsule's work and nothing the capsule forged.
  const committed = git(repoRoot, 'show', '--name-only', '--format=', sealed.commit);
  assert.match(committed, /feature\.txt/);
  assert.equal(committed.includes(TREE_NAME), false, 'a forged machine record reached the commit');

  closeCapsule(capsule.capsuleDir);
  assert.equal(git(repoRoot, 'rev-parse', 'HEAD').trim(), sealed.commit, 'closing the capsule disturbed the seal');
});

// ---------- the post-seal sync reconciles to HEAD's actual tree ----------

// `git checkout HEAD -- <path>` restores a path HEAD HAS. A path the chunk
// DELETED is absent from HEAD, so checkout cannot express "this file should not
// exist" — and the stale working-tree copy survives as exactly the
// inverse-dirty state the sync exists to clear. A rename is the same failure
// under another name, its old path being a deletion.
test('syncWorktreeToHead removes a path the commit deleted, not just restores the ones it kept', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-del-'));
  const g = (...a) => execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@e.c');
  g('config', 'user.name', 'T');
  fs.writeFileSync(path.join(repoRoot, 'keep.txt'), 'one\n');
  fs.writeFileSync(path.join(repoRoot, 'gone.txt'), 'delete me\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'seed');

  // The commit the seal makes: one file changed, one file deleted — staged
  // only, exactly as `applyToStaging` leaves them, so the working tree still
  // holds the pre-commit content of both.
  g('rm', '--cached', '-q', 'gone.txt');
  fs.writeFileSync(path.join(repoRoot, 'keep.txt'), 'two\n');
  g('add', '--', 'keep.txt');
  g('commit', '-q', '-m', 'the chunk');
  fs.writeFileSync(path.join(repoRoot, 'keep.txt'), 'one\n');

  assert.ok(fs.existsSync(path.join(repoRoot, 'gone.txt')), 'the fixture must start inverse-dirty');

  const result = syncWorktreeToHead(repoRoot);

  assert.equal(fs.readFileSync(path.join(repoRoot, 'keep.txt'), 'utf8'), 'two\n');
  assert.equal(fs.existsSync(path.join(repoRoot, 'gone.txt')), false, 'the deleted path survived the sync');
  assert.deepEqual(result.removed, ['gone.txt']);
  // And the repository is genuinely clean, which is what the milestone close
  // refuses to merge without.
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }), '');
});

// A path the sync was never asked about is not touched, deleted or otherwise —
// scoping is what removes the assumption rather than enforcing it.
test('syncWorktreeToHead leaves untouched paths alone, including untracked ones', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-scope-'));
  const g = (...a) => execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@e.c');
  g('config', 'user.name', 'T');
  fs.writeFileSync(path.join(repoRoot, 'touched.txt'), 'one\n');
  fs.writeFileSync(path.join(repoRoot, 'other.txt'), 'mine\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'seed');
  fs.writeFileSync(path.join(repoRoot, 'touched.txt'), 'two\n');
  g('add', '--', 'touched.txt');
  g('commit', '-q', '-m', 'the chunk');
  fs.writeFileSync(path.join(repoRoot, 'other.txt'), 'my uncommitted edit\n');
  fs.writeFileSync(path.join(repoRoot, 'scratch.txt'), 'untracked\n');

  syncWorktreeToHead(repoRoot);

  assert.equal(fs.readFileSync(path.join(repoRoot, 'other.txt'), 'utf8'), 'my uncommitted edit\n');
  assert.equal(fs.readFileSync(path.join(repoRoot, 'scratch.txt'), 'utf8'), 'untracked\n');
});
