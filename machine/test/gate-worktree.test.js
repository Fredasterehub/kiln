'use strict';

// gate-worktree.js — the throwaway checkout a chunk gate runs its suite in.
//
// WHAT THIS FILE HAS TO PROVE, in the order it matters. That the checkout holds
// the STAGED tree and not the tree the chunk replaces (the defect the module
// exists for); that the project's own index and working tree come through
// untouched (a gate is evidence, not a mutation); that a checkout left behind
// by a killed process is reclaimed rather than reused on faith; and that a
// suite which needs installed dependencies can still find them.
//
// The kill matrix at the bottom uses real SIGKILLs of real child processes,
// because a `finally` that never runs is the whole point and no in-process
// simulation has one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const { openGateWorktree, closeGateWorktree } = require('../src/gate-worktree.js');
const { runGate } = require('../src/check-honesty.js');
const { readRecords } = require('../src/stream.js');

const SRC = path.join(__dirname, '..', 'src');
const GATE = 'chunk:M1:C1';
const PROFILE = 'node-cli';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// A project with a passing suite committed, and a DIFFERENT, failing suite
// staged in the index and nowhere else. That is the exact shape a chunk is in
// when its gate runs: `capsule.js#applyToStaging` writes the index and never
// the working tree, and the seal is what moves it.
function makeProject({ stageBreak = true, parent } = {}) {
  const root = parent === undefined ? fs.mkdtempSync(path.join(os.tmpdir(), 'gate-wt-')) : parent;
  const repoRoot = fs.mkdtempSync(path.join(root, 'proj-'));
  git(repoRoot, 'init', '-q', '-b', 'main');
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'tree/\nnode_modules/\n');
  fs.mkdirSync(path.join(repoRoot, 'test'));
  fs.writeFileSync(path.join(repoRoot, 'test', 'smoke.test.js'), passingSuite());
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-q', '-m', 'initial');

  const treeRoot = path.join(repoRoot, 'tree');
  fs.mkdirSync(treeRoot, { recursive: true });

  if (stageBreak) {
    fs.writeFileSync(path.join(repoRoot, 'test', 'smoke.test.js'), failingSuite());
    git(repoRoot, 'add', 'test/smoke.test.js');
    // The working tree goes back to what HEAD says while the INDEX keeps the
    // change: `git checkout-index` would rewrite the index's own stat cache, so
    // the file is restored from the commit instead.
    fs.writeFileSync(path.join(repoRoot, 'test', 'smoke.test.js'), passingSuite());
  }
  return { root, repoRoot, treeRoot };
}

function passingSuite() {
  return "const test = require('node:test');\nconst assert = require('node:assert');\ntest('smoke', () => assert.ok(true));\n";
}

function failingSuite() {
  return "const test = require('node:test');\nconst assert = require('node:assert');\ntest('smoke', () => assert.ok(false, 'this chunk broke the suite'));\n";
}

// The tree the index describes, derived the way a reader outside this module
// would derive it — against a copy, so the check does not disturb what it
// checks.
function stagedTreeOf(repoRoot) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-wt-index-'));
  try {
    const copy = path.join(scratch, 'index');
    fs.copyFileSync(path.join(repoRoot, '.git', 'index'), copy);
    return execFileSync('git', ['write-tree'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, GIT_INDEX_FILE: copy },
    }).trim();
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Inode and mtime travel with the content, because "nothing was written" is a
// claim about writes: identical bytes cannot tell a rewrite from a read, and an
// atomic write-then-rename changes the inode while it is at it.
function snapshotOf(repoRoot, relPaths) {
  return relPaths.map((rel) => {
    const file = path.join(repoRoot, rel);
    const stat = fs.statSync(file);
    const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return `${rel} ino=${stat.ino} mtime=${stat.mtimeMs} ${digest}`;
  });
}

const WATCHED = ['.git/index', 'test/smoke.test.js', '.gitignore'];

// THE WHOLE BLAST RADIUS OF A REFUSAL, not the working tree alone. Materializing
// a checkout writes objects into `.git/objects` and an admin entry under
// `.git/worktrees` before a single file appears anywhere a `WATCHED` list would
// look — so a refusal that had already written a tree and a commit would pass a
// content snapshot and still have mutated the repository. Every refusal case is
// held to this one.
function everythingUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath || entry.path, entry.name)))
    .sort();
}

function repoSnapshot(repoRoot) {
  return [
    ...snapshotOf(repoRoot, WATCHED),
    `worktrees: ${git(repoRoot, 'worktree', 'list', '--porcelain')}`,
    `objects: ${everythingUnder(path.join(repoRoot, '.git', 'objects')).join(',')}`,
    `admin: ${everythingUnder(path.join(repoRoot, '.git', 'worktrees')).join(',')}`,
  ];
}

// What bytes a gate actually saw, recorded by the gate command itself. A gate
// that ran against a checkout somebody left dirty reports the dirty digest, and
// no assertion about the RECORD could have told the difference — the record
// carries the tree it was told, which is exactly the claim under test.
function sawCommandFor(root) {
  const witness = path.join(root, 'what-the-gate-saw');
  const script = path.join(root, 'record-what-i-see.js');
  fs.writeFileSync(
    script,
    "const fs = require('node:fs');\nconst { createHash } = require('node:crypto');\n" +
      `fs.writeFileSync(${JSON.stringify(witness)}, createHash('sha256').update(fs.readFileSync('test/smoke.test.js')).digest('hex'));\n`
  );
  return { witness, cmd: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}` };
}

function digestOf(text) {
  return createHash('sha256').update(text).digest('hex');
}

// ---------- what the checkout holds ----------

test('the checkout holds the staged tree, not the tree the chunk replaces', () => {
  const { repoRoot } = makeProject();

  const opened = openGateWorktree(repoRoot, GATE, PROFILE);

  assert.equal(opened.tree, stagedTreeOf(repoRoot));
  assert.notEqual(
    opened.tree,
    git(repoRoot, 'rev-parse', 'HEAD^{tree}').trim(),
    'the staged tree equals HEAD, so this case cannot tell the two apart'
  );
  assert.equal(fs.readFileSync(path.join(opened.dir, 'test', 'smoke.test.js'), 'utf8'), failingSuite());
  // The commit exists to be checked out and carries exactly that tree.
  assert.equal(git(repoRoot, 'rev-parse', `${opened.commit}^{tree}`).trim(), opened.tree);
  // And the project's own working tree still holds the passing copy — which is
  // what made the old gate green.
  assert.equal(fs.readFileSync(path.join(repoRoot, 'test', 'smoke.test.js'), 'utf8'), passingSuite());
  closeGateWorktree(repoRoot, GATE);
});

test('the project has its own history behind the checkout', () => {
  const { repoRoot } = makeProject();
  const opened = openGateWorktree(repoRoot, GATE, PROFILE);

  assert.equal(git(opened.dir, 'rev-parse', 'HEAD~1').trim(), git(repoRoot, 'rev-parse', 'HEAD').trim());
  closeGateWorktree(repoRoot, GATE);
});

test('opening and closing leaves the project index and working tree untouched', () => {
  const { repoRoot } = makeProject();
  const before = snapshotOf(repoRoot, WATCHED);

  const opened = openGateWorktree(repoRoot, GATE, PROFILE);
  assert.deepEqual(snapshotOf(repoRoot, WATCHED), before, 'materializing the checkout wrote to the project');
  closeGateWorktree(repoRoot, GATE);

  assert.deepEqual(snapshotOf(repoRoot, WATCHED), before);
  assert.equal(fs.existsSync(opened.dir), false, 'the checkout outlived its close');
  assert.equal(git(repoRoot, 'status', '--porcelain').includes('?? '), false);
});

// ---------- re-entry ----------

// NOTHING A PREDECESSOR LEFT IN THE CHECKOUT SURVIVES INTO THE NEXT GATE. The
// identity a gate record states is only worth what the bytes under it were, and
// a suite killed mid-run can leave a tracked file rewritten, a tracked file
// deleted, or junk on the side. An earlier version of this module reused such a
// checkout whenever its HEAD commit still matched — and HEAD matches a dirty
// checkout perfectly well, so the gate would have run altered bytes and recorded
// the clean staged tree. The identity is the same on re-entry; the contents are
// materialized again regardless.
test('re-entry materializes the checkout again, and nothing a killed suite left behind survives', () => {
  const { repoRoot } = makeProject();
  const first = openGateWorktree(repoRoot, GATE, PROFILE);
  // The three shapes of dirt a killed suite leaves, one file each.
  fs.writeFileSync(path.join(first.dir, 'test', 'smoke.test.js'), 'the suite rewrote its own test\n');
  fs.rmSync(path.join(first.dir, '.gitignore'), { force: true });
  fs.writeFileSync(path.join(first.dir, 'scratch.log'), 'junk\n');

  const second = openGateWorktree(repoRoot, GATE, PROFILE);

  assert.deepEqual(
    { dir: second.dir, tree: second.tree, commit: second.commit },
    { dir: first.dir, tree: first.tree, commit: first.commit },
    'an unchanged index must still resolve to the same identity'
  );
  assert.equal(
    fs.readFileSync(path.join(second.dir, 'test', 'smoke.test.js'), 'utf8'),
    failingSuite(),
    'the next gate would have run the bytes the killed suite left, under the staged tree\'s id'
  );
  assert.equal(fs.existsSync(path.join(second.dir, '.gitignore')), true, 'a tracked file the killed suite deleted stayed deleted');
  assert.equal(fs.existsSync(path.join(second.dir, 'scratch.log')), false, 'the killed suite\'s leftovers survived');
  closeGateWorktree(repoRoot, GATE);
});

test('an index that has moved gets a new checkout rather than the old one resumed', () => {
  const { repoRoot } = makeProject();
  const first = openGateWorktree(repoRoot, GATE, PROFILE);
  const witness = path.join(first.dir, 'from-the-older-tree');
  fs.writeFileSync(witness, 'x');

  // A revise stages different work: the same gate id, a different tree.
  fs.writeFileSync(path.join(repoRoot, 'test', 'smoke.test.js'), passingSuite() + "test('extra', () => {});\n");
  git(repoRoot, 'add', 'test/smoke.test.js');

  const second = openGateWorktree(repoRoot, GATE, PROFILE);

  assert.equal(second.dir, first.dir, 'the directory is the gate\'s, so this case must turn on the tree alone');
  assert.notEqual(second.tree, first.tree);
  assert.notEqual(second.commit, first.commit);
  assert.equal(fs.existsSync(witness), false, 'the gate would have run its suite in a checkout of the older tree');
  assert.match(fs.readFileSync(path.join(second.dir, 'test', 'smoke.test.js'), 'utf8'), /extra/);
  closeGateWorktree(repoRoot, GATE);
});

test('every single signal of a broken registration rebuilds the checkout', () => {
  const other = makeProject();

  // One variable at a time. Breaking all of them at once would pass with any
  // one of the checks present, and bind none of them.
  const cases = [
    [
      'git no longer lists it',
      (repoRoot, dir) => {
        for (const name of fs.readdirSync(path.join(repoRoot, '.git', 'worktrees'))) {
          fs.rmSync(path.join(repoRoot, '.git', 'worktrees', name), { recursive: true, force: true });
        }
      },
    ],
    ['the checkout has no .git pointer', (repoRoot, dir) => fs.rmSync(path.join(dir, '.git'), { force: true })],
    [
      'the .git pointer leads to another repository',
      (repoRoot, dir) => {
        const stranger = openGateWorktree(other.repoRoot, GATE, PROFILE);
        const pointer = fs.readFileSync(path.join(stranger.dir, '.git'), 'utf8');
        fs.writeFileSync(path.join(dir, '.git'), pointer);
      },
    ],
    ['the directory is gone but git still lists it', (repoRoot, dir) => fs.rmSync(dir, { recursive: true, force: true })],
  ];

  for (const [label, breakIt] of cases) {
    const { repoRoot } = makeProject();
    const first = openGateWorktree(repoRoot, GATE, PROFILE);
    breakIt(repoRoot, first.dir);

    const reopened = openGateWorktree(repoRoot, GATE, PROFILE);

    assert.equal(git(reopened.dir, 'rev-parse', 'HEAD').trim(), first.commit, label);
    assert.equal(fs.readFileSync(path.join(reopened.dir, 'test', 'smoke.test.js'), 'utf8'), failingSuite(), label);
    closeGateWorktree(repoRoot, GATE);
  }
});

// Two shapes of a checkout git will not remove, one variable apart. The second
// is the one that needs the prune: git refuses the removal AND keeps its admin
// entry, so a close that only deleted the directory would leave the path
// registered — and the next `worktree add` there fails on a checkout nobody can
// see. Breaking both signals at once, as an earlier version of this test did,
// deleted the admin entry as part of the fixture and left the prune unbound.
test('a checkout git cannot remove is still discardable, and its registration goes with it', () => {
  const { repoRoot } = makeProject();
  // The fixture's own staged-but-not-in-the-working-tree change is what the
  // status should still say afterwards, so it is captured rather than assumed
  // to be empty.
  const status = git(repoRoot, 'status', '--porcelain');
  const opened = openGateWorktree(repoRoot, GATE, PROFILE);
  // Only the pointer: git still lists the path, and still refuses to remove
  // something it no longer recognises as a working tree.
  fs.rmSync(path.join(opened.dir, '.git'), { force: true });
  assert.equal(git(repoRoot, 'worktree', 'list').includes(opened.dir), true, 'the fixture already deregistered it');

  assert.equal(closeGateWorktree(repoRoot, GATE).state, 'closed');
  assert.equal(fs.existsSync(opened.dir), false);
  assert.equal(git(repoRoot, 'worktree', 'list').trim().split('\n').length, 1, 'a stale registration survived the close');
  // The registration is what would make the next gate impossible, so the next
  // gate is what proves it is gone.
  const again = openGateWorktree(repoRoot, GATE, PROFILE);
  closeGateWorktree(repoRoot, GATE);
  assert.equal(git(repoRoot, 'status', '--porcelain'), status);
});

test('a checkout git never finished registering is discardable too, and closing twice changes nothing', () => {
  const { repoRoot } = makeProject();
  const opened = openGateWorktree(repoRoot, GATE, PROFILE);
  // The state a killed `git worktree add` leaves: files on disk, and git never
  // finished registering them.
  fs.rmSync(path.join(opened.dir, '.git'), { force: true });
  for (const name of fs.readdirSync(path.join(repoRoot, '.git', 'worktrees'))) {
    fs.rmSync(path.join(repoRoot, '.git', 'worktrees', name), { recursive: true, force: true });
  }

  assert.equal(closeGateWorktree(repoRoot, GATE).state, 'closed');
  assert.equal(fs.existsSync(opened.dir), false);
  assert.equal(closeGateWorktree(repoRoot, GATE).state, 'closed');
  assert.equal(fs.existsSync(opened.dir), false);
});

// ---------- identity ----------

test('two checkouts of the same project sharing a parent do not share a gate checkout', () => {
  // Siblings, deliberately: two repositories in their own temp roots would
  // differ whatever the key was built from, and the case could not fail.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-wt-siblings-'));
  const left = makeProject({ parent: root });
  const right = makeProject({ parent: root });

  const a = openGateWorktree(left.repoRoot, GATE, PROFILE);
  const b = openGateWorktree(right.repoRoot, GATE, PROFILE);

  assert.notEqual(a.dir, b.dir, 'one checkout would have run both projects\' suites');
  assert.equal(fs.realpathSync(path.dirname(a.dir)), fs.realpathSync(path.dirname(b.dir)));
  closeGateWorktree(left.repoRoot, GATE);
  closeGateWorktree(right.repoRoot, GATE);
});

test('two gates of one project do not share a checkout', () => {
  const { repoRoot } = makeProject();
  const a = openGateWorktree(repoRoot, 'chunk:M1:C1', PROFILE);
  const b = openGateWorktree(repoRoot, 'chunk:M1:C2', PROFILE);

  assert.notEqual(a.dir, b.dir);
  closeGateWorktree(repoRoot, 'chunk:M1:C1');
  closeGateWorktree(repoRoot, 'chunk:M1:C2');
});

// ---------- dependencies ----------

test("the profile's dependency directory is linked in, and the project's own copy survives the close", () => {
  const { repoRoot } = makeProject();
  const installed = path.join(repoRoot, 'node_modules', 'left-pad');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'index.js'), 'module.exports = 1;\n');

  const opened = openGateWorktree(repoRoot, GATE, PROFILE);

  assert.equal(opened.dependencies, 'node_modules');
  const link = path.join(opened.dir, 'node_modules');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'the dependencies were copied rather than linked');
  assert.equal(fs.readFileSync(path.join(link, 'left-pad', 'index.js'), 'utf8'), 'module.exports = 1;\n');

  // Re-entry materializes again, so the link is made again rather than found.
  const again = openGateWorktree(repoRoot, GATE, PROFILE);
  assert.equal(again.dependencies, 'node_modules');
  assert.equal(fs.lstatSync(path.join(again.dir, 'node_modules')).isSymbolicLink(), true);

  closeGateWorktree(repoRoot, GATE);
  assert.equal(fs.existsSync(path.join(installed, 'index.js')), true, "the close reached through the link into the project");
});

test('a project with no installed dependencies gets no link, and a tracked one is left alone', () => {
  const bare = makeProject();
  const openedBare = openGateWorktree(bare.repoRoot, GATE, PROFILE);
  assert.equal(openedBare.dependencies, null);
  assert.equal(fs.existsSync(path.join(openedBare.dir, 'node_modules')), false);
  closeGateWorktree(bare.repoRoot, GATE);

  // A project that COMMITS its dependencies has them materialized by the
  // checkout itself. Linking over them would substitute the project's copy for
  // the tree the gate is supposed to be about.
  const tracked = makeProject({ stageBreak: false });
  fs.writeFileSync(path.join(tracked.repoRoot, '.gitignore'), 'tree/\n');
  fs.mkdirSync(path.join(tracked.repoRoot, 'node_modules', 'vendored'), { recursive: true });
  fs.writeFileSync(path.join(tracked.repoRoot, 'node_modules', 'vendored', 'index.js'), 'committed\n');
  git(tracked.repoRoot, 'add', '-A');
  git(tracked.repoRoot, 'commit', '-q', '-m', 'vendor');

  const opened = openGateWorktree(tracked.repoRoot, GATE, PROFILE);

  assert.equal(opened.dependencies, null);
  assert.equal(fs.lstatSync(path.join(opened.dir, 'node_modules')).isSymbolicLink(), false);
  assert.equal(
    fs.readFileSync(path.join(opened.dir, 'node_modules', 'vendored', 'index.js'), 'utf8'),
    'committed\n'
  );
  closeGateWorktree(tracked.repoRoot, GATE);
});

// ---------- refusals ----------

test('refusals outside a usable repository', () => {
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-wt-bare-'));
  assert.throws(() => openGateWorktree(notARepo, GATE, PROFILE), /is not a git repository/);
  assert.throws(() => closeGateWorktree(notARepo, GATE), /is not a git repository/);

  // `git init` writes no index until something is added, so a repository that
  // has staged nothing has no staged tree for a gate to run against.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-wt-empty-'));
  git(empty, 'init', '-q', '-b', 'main');
  assert.throws(() => openGateWorktree(empty, GATE, PROFILE), /no git index/);
});

// EVERY REFUSAL, AGAINST THE WHOLE BLAST RADIUS. Asserting only that a call
// threw says nothing about what it had already done on the way: the invalid
// profile was validated at the very END of the open, after a tree and a commit
// had been written into the repository and a worktree checked out — so the
// refusal that looked clean left git metadata and a checkout behind it.
test('a refused open mutates nothing — not the worktree, not the index, not git\'s own objects', () => {
  const { repoRoot } = makeProject();
  const cases = [
    ['an empty repo root', () => openGateWorktree('', GATE, PROFILE)],
    ['an empty gate id', () => openGateWorktree(repoRoot, '', PROFILE)],
    ['a profile that does not exist', () => openGateWorktree(repoRoot, GATE, 'no-such-profile')],
    ['no profile at all', () => openGateWorktree(repoRoot, GATE, undefined)],
    ['an empty gate id on close', () => closeGateWorktree(repoRoot, '')],
  ];

  for (const [label, call] of cases) {
    const before = repoSnapshot(repoRoot);
    assert.throws(call, undefined, label);
    assert.deepEqual(repoSnapshot(repoRoot), before, `${label}: the refusal had already changed something`);
    assert.equal(
      fs.existsSync(path.join(repoRoot, '..', '.kiln-gate-worktrees')) &&
        fs.readdirSync(path.join(repoRoot, '..', '.kiln-gate-worktrees')).length > 0,
      false,
      `${label}: the refusal left a checkout behind`
    );
  }
});

// ---------- object format ----------

// A repository whose objects are SHA-256 names them in 64 hex characters, and a
// 40-character-only identity contract refuses tree ids that are perfectly valid
// there. The gate has no business having an opinion about which hash the target
// project chose.
test('a SHA-256 repository gates on its own 64-character tree ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-wt-sha256-'));
  const repoRoot = path.join(root, 'proj');
  fs.mkdirSync(repoRoot);
  git(repoRoot, 'init', '-q', '-b', 'main', '--object-format=sha256');
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'config', 'user.name', 'Test');
  fs.mkdirSync(path.join(repoRoot, 'test'));
  fs.writeFileSync(path.join(repoRoot, 'test', 'smoke.test.js'), passingSuite());
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-q', '-m', 'initial');
  fs.writeFileSync(path.join(repoRoot, 'test', 'smoke.test.js'), failingSuite());
  git(repoRoot, 'add', 'test/smoke.test.js');
  fs.writeFileSync(path.join(repoRoot, 'test', 'smoke.test.js'), passingSuite());

  const opened = openGateWorktree(repoRoot, GATE, PROFILE);

  assert.equal(opened.tree.length, 64, 'a sha256 repository was given a sha1-shaped identity');
  assert.equal(opened.tree, stagedTreeOf(repoRoot));

  // And the gate runs there for real, so the identity contract is exercised end
  // to end rather than only at the module boundary.
  const seen = sawCommandFor(root);
  const ledgerPath = path.join(root, 'ledger.jsonl');
  const outcome = runGate({ gateId: GATE, cmd: seen.cmd, ledgerPath, cwd: opened.dir, tree: opened.tree });

  assert.equal(outcome.exitCode, 0);
  assert.equal(fs.readFileSync(seen.witness, 'utf8'), digestOf(failingSuite()));
  closeGateWorktree(repoRoot, GATE);
});

// ---------- killed, at every window ----------

// The windows a gate has, and what each kill must leave recoverable:
// materialization, the suite itself, the record, and the cleanup. Each case
// kills a REAL process — `process.kill(process.pid, 'SIGKILL')`, with no
// `finally` able to run — and each asserts its own kill actually fired before
// asserting anything about recovery. An aggregated "some kill happened" would
// let one window stand in for the others.
function runChild(source) {
  return spawnSync(process.execPath, ['-e', source], { encoding: 'utf8' });
}

function childPrelude({ repoRoot, treeRoot }) {
  return `
    const gw = require(${JSON.stringify(path.join(SRC, 'gate-worktree.js'))});
    const { runGate } = require(${JSON.stringify(path.join(SRC, 'check-honesty.js'))});
    const REPO = ${JSON.stringify(repoRoot)};
    const LEDGER = ${JSON.stringify(path.join(treeRoot, 'ledger.jsonl'))};
    const GATE = ${JSON.stringify(GATE)};
  `;
}

function gateRecordsIn(treeRoot) {
  const file = path.join(treeRoot, 'ledger.jsonl');
  return fs.existsSync(file) ? readRecords(file).records.filter((r) => r.kind === 'gate') : [];
}

test('a gate killed at any of its windows leaves a project the next gate can finish in', () => {
  const workflow = require('../src/workflow.js');
  const passes = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;

  const windows = [
    {
      name: 'the checkout is built and the suite has not started',
      source: (p) => `${childPrelude(p)} gw.openGateWorktree(REPO, GATE, 'node-cli'); process.kill(process.pid, 'SIGKILL');`,
      recordedBefore: 0,
    },
    {
      name: 'the suite is running',
      // The real facade op, killed from inside the suite it spawned: the gate
      // command kills the process that is waiting on it, which is as close to a
      // machine losing power mid-gate as a test can get.
      source: (p) => `
        const wf = require(${JSON.stringify(path.join(SRC, 'workflow.js'))});
        wf.invoke(${JSON.stringify(p.treeRoot)}, 'checkHonesty.runStagedGate', [
          ${JSON.stringify(p.treeRoot)}, ${JSON.stringify(GATE)}, 'kill -9 $PPID', 'node-cli'
        ]);
      `,
      recordedBefore: 0,
    },
    {
      name: 'the record is written and the checkout is not yet cleaned up',
      source: (p) => `${childPrelude(p)}
        const w = gw.openGateWorktree(REPO, GATE, 'node-cli');
        runGate({ gateId: GATE, cmd: ${JSON.stringify(passes)}, ledgerPath: LEDGER, cwd: w.dir, tree: w.tree });
        process.kill(process.pid, 'SIGKILL');`,
      recordedBefore: 1,
    },
    {
      // THE WINDOW THE FIRST VERSION OF THIS MATRIX MISSED. A suite is a program
      // the target project wrote, running with write access to its own checkout,
      // and a killed one can leave a tracked file rewritten behind it. Reused,
      // that checkout runs bytes nobody staged while the record states the clean
      // staged tree — a false claim that every other assertion here would pass.
      name: 'the suite rewrote a tracked file before it died',
      source: (p) => `
        const wf = require(${JSON.stringify(path.join(SRC, 'workflow.js'))});
        wf.invoke(${JSON.stringify(p.treeRoot)}, 'checkHonesty.runStagedGate', [
          ${JSON.stringify(p.treeRoot)}, ${JSON.stringify(GATE)},
          'printf "the suite wrecked its own test\\n" > test/smoke.test.js; kill -9 $PPID', 'node-cli'
        ]);
      `,
      recordedBefore: 0,
      // The dirt is the injection here, so the dirt is what gets asserted.
      leftBehind: (dir) =>
        assert.match(
          fs.readFileSync(path.join(dir, 'test', 'smoke.test.js'), 'utf8'),
          /wrecked its own test/,
          'the killed suite never dirtied its checkout, so this case proves nothing'
        ),
    },
  ];

  for (const window of windows) {
    const project = makeProject();
    const untouched = snapshotOf(project.repoRoot, WATCHED);

    const died = runChild(window.source(project));

    // THE KILL ITSELF, ASSERTED. A window whose injection silently failed
    // proves recovery from a state nothing was ever in.
    assert.equal(died.signal, 'SIGKILL', `${window.name}: the kill never fired — ${died.stderr}`);
    assert.equal(gateRecordsIn(project.treeRoot).length, window.recordedBefore, window.name);
    const stranded = fs
      .readdirSync(path.join(project.root, '.kiln-gate-worktrees'))
      .map((name) => path.join(project.root, '.kiln-gate-worktrees', name));
    assert.equal(stranded.length, 1, `${window.name}: no checkout was left behind, so there is nothing to recover from`);
    if (window.leftBehind) window.leftBehind(stranded[0]);

    // And the gate runs again, for real, through the facade — with a command
    // that reports WHAT IT SAW. The record's tree is the claim under test, so a
    // recovered gate that ran a predecessor's leftovers has to be caught by the
    // bytes, never by the record agreeing with itself.
    const seen = sawCommandFor(project.root);
    const outcome = workflow.invoke(project.treeRoot, 'checkHonesty.runStagedGate', [
      project.treeRoot,
      GATE,
      seen.cmd,
      'node-cli',
    ]);

    assert.equal(outcome.exitCode, 0, window.name);
    assert.equal(outcome.tree, stagedTreeOf(project.repoRoot), window.name);
    assert.equal(
      fs.readFileSync(seen.witness, 'utf8'),
      digestOf(failingSuite()),
      `${window.name}: the recovered gate ran bytes that are not the staged tree's, and recorded the staged tree`
    );
    const records = gateRecordsIn(project.treeRoot);
    assert.equal(records.length, window.recordedBefore + 1, window.name);
    assert.equal(records[records.length - 1].tree, outcome.tree, window.name);
    assert.equal(fs.existsSync(stranded[0]), false, `${window.name}: the stranded checkout was never reclaimed`);
    assert.deepEqual(snapshotOf(project.repoRoot, WATCHED), untouched, `${window.name}: the project was written to`);
  }
});
