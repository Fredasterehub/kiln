'use strict';

// gate-worktree.js — the throwaway checkout a chunk gate runs its suite in, so
// that the gate answers about the chunk rather than about the tree the chunk
// replaces.
//
// THE DEFECT THIS MODULE EXISTS FOR. A chunk's approved work reaches the
// project as an INDEX entry and nothing else: `capsule.js#applyToStaging`
// writes the index and never the working tree, deliberately, so that work
// nobody has sealed cannot be committed by accident. The seal is what moves it
// into the working tree, and the gate runs BEFORE the seal. So a gate run in
// the project's own directory ran the suite that was already there — and a
// chunk whose own suite is red passed its gate under its own gate id.
//
// WHAT REPLACES IT, AND WHY THIS SHAPE. The index's tree is materialized as a
// real git worktree somewhere the project is not, the suite runs there, and the
// gate record names that tree. The alternatives were considered and refused:
// gating AFTER the seal makes an unverified seal durable and inverts the rung's
// recovery semantics, and copying files into a scratch directory cannot
// reproduce the executable bits, the symlinks, the ignore rules or the
// repository context that a suite can legitimately depend on. A worktree is the
// only form that is the same kind of thing as the project.
//
// NOTHING THE PROJECT OWNS IS WRITTEN. The tree is derived through a COPY of
// the index, never the index itself — `git write-tree` rewrites the index's
// cache-tree extension, so running it in place would mutate the very artifact
// the gate is evidence about. The project's working tree is never touched at
// all. What is added to the repository is a tree object and a commit object,
// both unreferenced: git's own garbage collection is what eventually removes
// them, and nothing in the project points at either.
//
// THE COMMIT IS DETERMINISTIC, AND THAT IS THE RE-ENTRY STORY. Its identity,
// its author and its dates are pinned, so the same index under the same HEAD
// for the same gate always produces the same commit id. A killed invocation
// therefore recomputes exactly the commit it was working on, finds the worktree
// standing at it, and continues — while an index that has MOVED since produces
// a different commit, which is precisely the case that must not be resumed as
// though it were the same one. Identity does the work that a state file would
// otherwise have to do badly.
//
// NOTHING IS EVER REUSED, AND THAT IS THE RECOVERY STORY. An earlier draft
// resumed a checkout whenever git agreed it was a worktree of this repository
// standing at the right commit. Both facts are true of a checkout a killed suite
// left DIRTY — a suite is a program the target project wrote, running with write
// access to its own files — so the next gate would have run bytes nobody staged
// while recording the clean staged tree. A false claim, produced by the recovery
// path the whole module exists to make safe.
//
// Restoring such a checkout is possible and was rejected: `reset --hard` plus a
// clean sweep has to reason about ignored files, nested repositories and the
// dependency symlink, and every one of those is a way to be subtly wrong. The
// checkout is materialized again instead, unconditionally. It costs one
// checkout on a path that only runs after a crash, and it makes "the checkout
// holds exactly the staged tree" true by construction rather than by a check.
// The identity is unchanged by this — the same index under the same HEAD
// resolves to the same tree and commit — so re-entry is still the same gate.
//
// DEPENDENCIES ARE LINKED, NOT INSTALLED. Git does not carry `node_modules` or
// `.venv` — every ecosystem ignores them — so a fresh checkout of the project's
// tree has no libraries and its suite fails for reasons that have nothing to do
// with the chunk. The profile's own dependency directory is symlinked in from
// the project when the project has one. Which directory that is comes from the
// profile id through `toolchain.js`, never from a caller: a caller free to name
// it would be naming a path inside somebody else's checkout. Removing the
// worktree unlinks the symlink and leaves the project's own directory alone —
// neither git's removal nor Node's follows a symlink into its target.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { git, gitOrThrow, requireRepo } = require('./staged-diff.js');
const { dependencyDirOf } = require('./toolchain.js');

// Gate worktrees live beside the project for the same reason capsules do: one
// under the project root would show up in its own status and be swept up by its
// own suite, and one under the machine tree would put a checkout of the project
// inside the tree that is supposed to be invisible to it.
const WORKTREES_DIRNAME = '.kiln-gate-worktrees';

// Every field of the commit that is not the tree or the parent, pinned. Two
// things follow, and both are wanted: the commit id is a pure function of what
// it describes, so re-entry recomputes it rather than remembering it; and the
// repository's own `user.name`/`user.email` are never required, so a project
// that has not configured git can still be gated.
const COMMIT_ENV = Object.freeze({
  GIT_AUTHOR_NAME: 'Kiln',
  GIT_AUTHOR_EMAIL: 'kiln@invalid',
  GIT_COMMITTER_NAME: 'Kiln',
  GIT_COMMITTER_EMAIL: 'kiln@invalid',
  GIT_AUTHOR_DATE: '1970-01-01T00:00:00+0000',
  GIT_COMMITTER_DATE: '1970-01-01T00:00:00+0000',
});

// A git object id, in either of the two widths git actually produces: 40 hex for
// a SHA-1 repository, 64 for a SHA-256 one. Pinning 40 refused every valid
// identity in a SHA-256 target — an opinion this module has no business having
// about the hash the target project chose. The width is not what makes an id
// right anyway: every id here is compared against one git itself produced.
const OBJECT_RE = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Anything at this path at all, symlinks included. `existsSync` follows the
// link, so a dangling one reads as absent and the next write fails EEXIST.
function somethingIsAt(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function gitWithEnv(repoRoot, args, env) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.error !== undefined) {
    throw new Error(`gate-worktree: could not run git in ${repoRoot} — ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `gate-worktree: git ${args.join(' ')} failed in ${repoRoot} (exit ${result.status}): ${(result.stderr || '').trim()}`
    );
  }
  return result.stdout;
}

// ---------- where a gate worktree lives ----------

// THE REPOSITORY IS PART OF THE IDENTITY, not just the gate id. Two sibling
// checkouts of the same project share a parent directory and can be gating the
// same chunk at once; keyed on the gate id alone they resolve to one directory,
// and the second would run its suite in the first's checkout.
//
// The two are digested as ONE tuple rather than joined into a string. A gate id
// carries `:` and a repository path carries `/`, so any separator chosen for a
// join is a separator one of the parts can already contain — and two different
// pairs would then produce one key. `JSON.stringify` of the pair has no such
// ambiguity.
function dirFor(repoRoot, gateId) {
  const key = createHash('sha256')
    .update(JSON.stringify([fs.realpathSync(repoRoot), gateId]))
    .digest('hex')
    .slice(0, 32);
  return path.join(repoRoot, '..', WORKTREES_DIRNAME, key);
}

// ---------- the tree the index describes ----------

// The index's tree, computed against a COPY. `git write-tree` writes the tree
// objects into the repository (which is wanted — the worktree has to be able to
// check them out) and updates the cache-tree extension of whatever index it
// read (which is not: the real index is the artifact this gate is evidence
// about, and evidence does not rewrite its subject).
function stagedTreeOf(repoRoot) {
  const indexPath = path.resolve(repoRoot, gitOrThrow(repoRoot, ['rev-parse', '--git-path', 'index']).trim());
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `gate-worktree: ${repoRoot} has no git index at ${indexPath} — there is no staged tree for a gate to run against`
    );
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-gate-index-'));
  const indexCopy = path.join(scratch, 'index');
  try {
    fs.copyFileSync(indexPath, indexCopy);
    const tree = gitWithEnv(repoRoot, ['write-tree'], { GIT_INDEX_FILE: indexCopy }).trim();
    if (!OBJECT_RE.test(tree)) {
      throw new Error(`gate-worktree: git write-tree in ${repoRoot} returned ${JSON.stringify(tree)}, not a tree id`);
    }
    return tree;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// The commit that carries that tree. Parented on HEAD when there is one, so the
// checkout has the project's real history behind it and a suite that asks git
// about its own repository gets a true answer. An unborn HEAD is lawful and
// parentless — a repository with no commits has no history to inherit.
function commitFor(repoRoot, tree, gateId) {
  const head = git(repoRoot, ['rev-parse', '--verify', 'HEAD']);
  const parent = head.status === 0 ? ['-p', head.stdout.trim()] : [];
  const commit = gitWithEnv(
    repoRoot,
    ['commit-tree', tree, ...parent, '-m', `kiln gate ${gateId}: the staged tree, checked out to be tested`],
    COMMIT_ENV
  ).trim();
  if (!OBJECT_RE.test(commit)) {
    throw new Error(`gate-worktree: git commit-tree in ${repoRoot} returned ${JSON.stringify(commit)}, not a commit id`);
  }
  return commit;
}

// ---------- dependencies ----------

// The profile's dependency directory, linked in from the project when the
// project actually has one. The directory NAME arrives already resolved, from
// the caller's own refuse-before-mutating step — resolving it here is what once
// made an unknown profile a refusal issued after a tree, a commit and a whole
// checkout had been written.
//
// Anything already at that path came out of the tree itself, since the checkout
// was created moments ago: the project TRACKS its dependencies and has its own.
// Replacing those with a link to the project's copy would substitute one tree
// for another underneath the gate, which is the exact substitution this module
// exists to prevent.
function linkDependencies(repoRoot, dir, dependencyDir) {
  if (dependencyDir === null) return null;
  const source = path.join(repoRoot, dependencyDir);
  const target = path.join(dir, dependencyDir);
  if (somethingIsAt(target)) return null;
  if (!fs.existsSync(source)) return null;
  fs.symlinkSync(source, target, 'dir');
  return dependencyDir;
}

// ---------- openGateWorktree ----------

// openGateWorktree(repoRoot, gateId, profileId) — a checkout of what is staged
// right now, ready for a suite to run in.
//
// Everything is derived, nothing is remembered: the tree from the index, the
// commit from the tree, the directory from the repository and the gate id.
//
// EVERY ARGUMENT IS REFUSED BEFORE THE FIRST MUTATION. `stagedTreeOf` writes
// tree objects into the repository and `commitFor` writes a commit, so a check
// made after them is a check made too late — an unknown profile used to be
// caught at link time, by which point an entire checkout existed. The
// dependency directory is therefore resolved up here, where its refusal costs
// the repository nothing.
function openGateWorktree(repoRoot, gateId, profileId) {
  if (!isNonEmptyString(repoRoot)) {
    throw new TypeError('gate-worktree: repoRoot must be a non-empty string');
  }
  if (!isNonEmptyString(gateId)) {
    throw new TypeError('gate-worktree: gateId must be a non-empty string');
  }
  const dependencyDir = dependencyDirOf(profileId);
  requireRepo(repoRoot);

  const tree = stagedTreeOf(repoRoot);
  const commit = commitFor(repoRoot, tree, gateId);
  const dir = dirFor(repoRoot, gateId);

  // Whatever is here — nothing, a checkout a killed suite dirtied, a worktree of
  // an older staged tree, or files a `git worktree add` never finished
  // registering — is cleared and built again. One answer for every state,
  // because none of them can be trusted to hold the tree this gate is about.
  fs.rmSync(dir, { recursive: true, force: true });
  gitOrThrow(repoRoot, ['worktree', 'prune']);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  gitOrThrow(repoRoot, ['worktree', 'add', '--quiet', '--detach', dir, commit]);

  const dependencies = linkDependencies(repoRoot, dir, dependencyDir);
  return { dir, tree, commit, dependencies };
}

// ---------- closeGateWorktree ----------

// closeGateWorktree(repoRoot, gateId) — the checkout goes.
//
// Nothing in it is ever wanted: the gate's whole result is the record runGate
// wrote, and whatever the suite left behind belongs to a tree that exists only
// to be tested. Idempotent, and reachable whatever shape the checkout is in —
// git refuses to remove a worktree it never finished registering, which is
// exactly the state a killed `worktree add` leaves, so the directory goes
// directly when git will not take it.
function closeGateWorktree(repoRoot, gateId) {
  if (!isNonEmptyString(repoRoot)) {
    throw new TypeError('gate-worktree: repoRoot must be a non-empty string');
  }
  if (!isNonEmptyString(gateId)) {
    throw new TypeError('gate-worktree: gateId must be a non-empty string');
  }
  requireRepo(repoRoot);
  const dir = dirFor(repoRoot, gateId);

  if (fs.existsSync(dir)) {
    const removed = git(repoRoot, ['worktree', 'remove', '--force', dir]);
    if (removed.status !== 0 && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  // Whether or not the directory was there, git's own bookkeeping may still
  // list it — a stale entry keeps the path unusable for the next `worktree
  // add`, which is the one thing a close must never leave behind.
  git(repoRoot, ['worktree', 'prune']);
  return { dir, state: 'closed' };
}

module.exports = { openGateWorktree, closeGateWorktree, WORKTREES_DIRNAME };
