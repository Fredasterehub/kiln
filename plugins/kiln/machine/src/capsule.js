'use strict';

// capsule.js — the isolated worktree an implementer builds in, and the patch
// boundary its work has to cross to reach the real repository.
//
// FORGERY THROUGH THE CAPSULE PATH BECOMES UNAVAILABLE RATHER THAN FORBIDDEN.
// Every seat contract in this tree already says an implementer never writes a
// machine record; the live run showed that saying so is not the same as making
// it impossible. A capsule makes it impossible along the one path by which an
// implementer's work reaches canonical truth — export, then apply — and the
// scope of that claim is part of the claim, not a footnote to it.
//
// Unavailable by construction, and it may be said that way: the capsule is a
// git worktree of the milestone tip, checked out somewhere the project tree is
// not, and the machine tree is ignored in that repository — so `.kiln` is not
// hidden inside the capsule, it is ABSENT. A planted `.kiln/ledger.jsonl`,
// `chunks.jsonl` or `state.json` therefore sits in no worktree of the branch:
// `git diff HEAD` cannot see it, no export carries it, and what an export does
// carry is verified against its digest before it governs a HEAD-seeded index.
// There is no ledger there to append to, no chunks.jsonl to write, no
// state.json to advance; an implementer that plants one anyway is writing into
// a directory that is about to be deleted.
//
// Not claimed, and it belongs in the same breath: nothing here resists a
// same-user process writing directly to `.git`, to the patch file, to the
// ledger, or to a machine record. Those writes go around this path rather than
// through it, and no property of this module constrains them. Read-only
// permissions on a review copy are defense in depth against an ordinary
// mistake, never the guarantee.
//
// ONE FACT CROSSES, AND IT IS A PATCH. `exportDiff` takes the capsule's
// tracked surface — modifications to files the branch already has, plus new
// files the implementer actually staged — and nothing else. What is neither
// tracked nor staged was never part of the work anybody approved, and a file
// under the machine tree's own directory is refused outright even if somebody
// forced it into the index.
//
// TWO DIGESTS, BOUND BY AN ACT RATHER THAN BY AN ASSUMPTION. An earlier draft
// rested on a single digest: the patch produced in the capsule was assumed
// byte-identical to the diff the project reports once it is applied, so one
// value could serve as both the reviewed artifact's identity and the staged
// content's. That is false in general, and the counterexample is ordinary — a
// patch that changes `.gitattributes` is rendered by the capsule under the NEW
// attributes and by the project under its own unchanged ones, so the same
// logical change comes out as a binary patch on one side and a text patch on
// the other. Resting on it would have rolled back valid builds as mismatches.
//
// So there are two facts, named separately:
//
//   patch_digest — the bytes of the patch file. What a reviewer read, and the
//                  only thing that identifies the reviewed artifact.
//   diff_digest  — `stagedDiffDigest(repoRoot)` once the patch is applied.
//                  What `milestones.js` recomputes at its write boundary and
//                  what `sealChunk` compares before it commits.
//
// What binds them is not equality — they describe different things — but that
// `applyToStaging` VERIFIES the patch file against `patch_digest` and then
// applies that exact artifact onto a CLEAN, HEAD-SEEDED index. Seeded from
// HEAD, not emptied: an empty index would report every unchanged file as
// deleted, and the digest would describe a change nobody made. The staged
// content is therefore what the reviewed patch says, and `diff_digest` is the
// project's own description of it.
//
// THE REVIEWER IS GIVEN THE PATCH, NEVER THE CAPSULE. Reading the capsule
// would mean reading a working tree that can still change; reading the patch
// is reading the exact artifact `patch_digest` names.
//
// WHAT IS GUARANTEED, AND WHAT IS NOT. The guarantee here is an API-BOUNDARY
// one, and it is worth stating exactly: mutations to the project's working
// tree or to the capsule AFTER export cannot alter what a digest-verified
// patch stages, and `recordChunk` refuses build evidence whose dispatch it
// cannot verify. That is a property of the operations in this module, not of
// the filesystem.
//
// NO SAME-USER TAMPER RESISTANCE IS CLAIMED. Anything running as this user can
// write to `.git` directly, rewrite the patch file, append to the ledger, or
// edit a machine record, and nothing here would stop it — a capsule constrains
// what the MACHINE will accept and act on, not what a process with the same
// credentials can do to the disk. Where this module makes a review copy
// read-only, that is defense in depth against an ordinary mistake, never the
// guarantee.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { writeAtomic, readJson } = require('./atomic-json.js');
const { git, gitOrThrow, requireRepo, stagedDiffDigest } = require('./staged-diff.js');

// Capsules live beside the project, never inside it: a worktree under the
// project root would show up in its own status, and one under the machine tree
// would put the thing being isolated inside the isolation.
const CAPSULES_DIRNAME = '.kiln-capsules';

// A capsule's location is built out of (milestone, chunk), and neither id is
// shape-constrained where it comes from — `milestones.js` asks only for a
// non-empty string. An id that is not a single safe path segment is refused
// rather than resolved, because resolving it is how a capsule escapes its own
// directory.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

// The flags that pin every git config knob able to change a diff's BYTES
// without changing the change. The same set `staged-diff.js` uses — not
// because the two outputs have to match (they need not; see the header) but
// because each side should be stable against its own repository's config.
const DIFF_FLAGS = [
  '-c',
  'core.abbrev=40',
  '-c',
  'core.quotePath=true',
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-renames',
  '--binary',
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireSafeId(value, what) {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) {
    throw new TypeError(
      `capsule: ${what} must be one path segment of letters, digits, dot, dash or underscore (got ${JSON.stringify(value)})`
    );
  }
}

function digestOfBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// ---------- where a capsule lives ----------

// THE REPOSITORY IS PART OF A CAPSULE'S IDENTITY, not just the milestone and
// the chunk. Two sibling checkouts of the same project share a parent
// directory and can be working the same (milestone, chunk) at once; keyed on
// those two alone they resolve to one capsule, and the second would "reopen"
// the first's worktree and export its work as its own. The scoped-id law
// again: an id unique only WITHIN a repository has to carry the repository.
//
// A digest rather than the path itself, because a repository path is not a
// path segment — and nothing is lost by making it opaque here, since the
// record beside the capsule names the repository in full.
function repoKeyOf(repoRoot) {
  return digestOfBytes(fs.realpathSync(repoRoot)).slice('sha256:'.length, 'sha256:'.length + 16);
}

function capsuleDirOf(repoRoot, milestoneId, chunkId) {
  return path.join(repoRoot, '..', CAPSULES_DIRNAME, repoKeyOf(repoRoot), milestoneId, chunkId);
}

// The record and the patch sit BESIDE the worktree rather than inside it: a
// file inside would be an untracked file in the capsule, and `git worktree
// remove` would take the record with it. A capsule that is gone is still a
// capsule that happened.
function recordPathOf(capsuleDir) {
  return `${capsuleDir}.capsule.json`;
}

function patchPathOf(capsuleDir) {
  return `${capsuleDir}.patch`;
}

function readRecord(capsuleDir) {
  const record = readJson(recordPathOf(capsuleDir), null);
  if (record === null) {
    throw new Error(`capsule: no capsule record at ${recordPathOf(capsuleDir)} — nothing was ever opened here`);
  }
  return record;
}

// ---------- what the repository has to be ----------

// The machine tree must be BOTH untracked and ignored, and the two are
// different guarantees. Untracked is what keeps it out of a worktree of the
// branch — a tracked tree would be materialized inside the capsule and there
// would be no isolation at all. Ignored is what keeps it out of the export: an
// unignored tree is one `git add -A` away from being staged, and the patch
// would carry it across.
function requireTreeIsInvisible(repoRoot, treeName) {
  const tracked = git(repoRoot, ['ls-files', '--error-unmatch', '--', treeName]);
  if (tracked.status === 0) {
    throw new Error(
      `capsule: ${JSON.stringify(treeName)} is tracked in ${repoRoot} — a worktree of the milestone would materialize the machine tree inside the capsule, and there would be nothing isolated about it`
    );
  }
  const ignored = git(repoRoot, ['check-ignore', '--quiet', '--', `${treeName}/`]);
  if (ignored.status !== 0) {
    throw new Error(
      `capsule: ${JSON.stringify(treeName)} is not ignored in ${repoRoot} — an unignored machine tree can be staged, and the export would carry it out of the capsule`
    );
  }
}

// ---------- openCapsule ----------

// IS THERE A WORKTREE HERE, as git understands the question — not "is there a
// directory". A `git worktree add` that dies partway leaves files on disk that
// git never finished registering, and a directory check calls that a capsule
// ready to resume: the caller gets a path with no `.git`, every git command in
// it fails, and the export it eventually asks for is impossible. Two things
// are asked, because either alone can be true while the worktree is unusable —
// git lists the path among its worktrees for THIS repository, and the `.git`
// file in it points back into this repository's own worktree metadata.
function isRegisteredWorktree(repoRoot, capsuleDir) {
  const listed = git(repoRoot, ['worktree', 'list', '--porcelain']);
  if (listed.status !== 0) return false;
  const wanted = path.resolve(capsuleDir);
  const registered = listed.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .some((line) => path.resolve(line.slice('worktree '.length)) === wanted);
  if (!registered) return false;

  let pointer;
  try {
    pointer = fs.readFileSync(path.join(capsuleDir, '.git'), 'utf8').trim();
  } catch {
    return false;
  }
  const match = /^gitdir:\s*(.+)$/.exec(pointer);
  if (match === null) return false;
  const gitDir = git(repoRoot, ['rev-parse', '--git-common-dir']);
  if (gitDir.status !== 0) return false;
  const common = path.resolve(repoRoot, gitDir.stdout.trim());
  const target = path.resolve(match[1]);
  return target === common || target.startsWith(common + path.sep);
}

// A capsule already on disk is only THIS capsule if its record says so. A
// record naming another repository, branch or machine tree is not a capsule to
// resume — it is a collision, and resuming it would export somebody else's
// work under this chunk's name.
function requireSameCapsule(record, capsuleDir, repoRoot, milestoneId, chunkId, treeName, branch) {
  const expected = {
    repo_root: fs.realpathSync(repoRoot),
    milestone_id: milestoneId,
    chunk_id: chunkId,
    tree_name: treeName,
    branch,
  };
  for (const [field, want] of Object.entries(expected)) {
    if (record[field] !== want) {
      throw new Error(
        `capsule: the record at ${recordPathOf(capsuleDir)} was opened with ${field} ${JSON.stringify(record[field])}, not ${JSON.stringify(want)} — refusing to reopen a capsule that belongs to something else`
      );
    }
  }
}

// openCapsule(treeRoot, repoRoot, milestoneId, chunkId) — the worktree an
// implementer builds in.
//
// DETACHED, not on the branch. The project itself has the milestone branch
// checked out (that is where `sealChunk` commits), and git refuses a second
// worktree on a checked-out branch. A capsule therefore sits AT the branch's
// tip rather than on it — which is also the honest shape: a capsule never
// commits anything, it produces a patch.
//
// THE RECORD IS WRITTEN FIRST, and that ordering is the whole crash story. The
// worktree is the durable mutation; the record is what makes it findable
// again. Created in the other order, a crash between them leaves a directory
// that cannot be reopened (the path exists, so `worktree add` fails) and
// cannot be discarded (no record, so `closeCapsule` refuses) — a capsule
// nothing in the API can reach. Record first, and the only window left is a
// record whose worktree does not exist yet, which the reopen path below simply
// finishes.
function openCapsule(treeRoot, repoRoot, milestoneId, chunkId) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('capsule: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(repoRoot)) {
    throw new TypeError('capsule: repoRoot must be a non-empty string');
  }
  requireSafeId(milestoneId, 'milestoneId');
  requireSafeId(chunkId, 'chunkId');
  requireRepo(repoRoot);

  const treeName = path.basename(path.resolve(treeRoot));
  requireTreeIsInvisible(repoRoot, treeName);

  const capsuleDir = capsuleDirOf(repoRoot, milestoneId, chunkId);
  const branch = `milestone/${milestoneId}`;
  const existing = readJson(recordPathOf(capsuleDir), null);

  if (existing !== null) {
    requireSameCapsule(existing, capsuleDir, repoRoot, milestoneId, chunkId, treeName, branch);
    if (isRegisteredWorktree(repoRoot, capsuleDir)) {
      return { capsuleDir, state: 'reopened', record: existing };
    }
    // The record is here and a usable worktree is not: the crash window above,
    // a capsule somebody removed by hand, or — the case a directory check
    // cannot see — a `git worktree add` that died partway, leaving files on
    // disk that git never finished registering. All three are the same
    // situation, and the answer is to clear whatever is there and finish the
    // job at the commit this capsule was opened against, so a resumed capsule
    // is the same capsule rather than a newer one.
    fs.rmSync(capsuleDir, { recursive: true, force: true });
    gitOrThrow(repoRoot, ['worktree', 'prune']);
    gitOrThrow(repoRoot, ['worktree', 'add', '--quiet', '--detach', capsuleDir, existing.base_commit]);
    return { capsuleDir, state: 'reopened', record: existing };
  }

  const tip = gitOrThrow(repoRoot, ['rev-parse', '--verify', `${branch}^{commit}`]).trim();
  const record = {
    schema_version: 1,
    milestone_id: milestoneId,
    chunk_id: chunkId,
    repo_root: fs.realpathSync(repoRoot),
    tree_name: treeName,
    branch,
    base_commit: tip,
    state: 'open',
    opened_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(capsuleDir), { recursive: true });
  writeAtomic(recordPathOf(capsuleDir), record);
  gitOrThrow(repoRoot, ['worktree', 'add', '--quiet', '--detach', capsuleDir, tip]);
  return { capsuleDir, state: 'opened', record };
}

// ---------- exportDiff ----------

// The paths a capsule's work touches, asked of git rather than parsed out of
// the patch. `--name-only -z` returns raw bytes with no quoting at all, which
// is the point: `core.quotePath` is on deliberately, so the diff is stable —
// but that means a path like `.kiln/é` appears in the patch header as
// `".kiln/\303\251"`, and a reader that only recognises unquoted headers walks
// straight past the one file that must never cross. Parsing the patch was that
// reader; asking git is not.
function changedPathsIn(capsuleDir) {
  const out = gitOrThrow(capsuleDir, ['diff', 'HEAD', '--name-only', '-z']);
  return out.split('\0').filter((entry) => entry !== '');
}

// exportDiff(capsuleDir) — the capsule's work as one patch, and the digest of
// the artifact a reviewer will read.
//
// `git diff HEAD` is the whole mechanism: it reports what the tracked surface
// looks like now against the commit the capsule started from, which is exactly
// "modifications to tracked files, plus new files the implementer staged".
// Anything untracked and unstaged is invisible to it — no filtering required,
// because it was never in scope.
function exportDiff(capsuleDir) {
  if (!isNonEmptyString(capsuleDir)) {
    throw new TypeError('capsule: capsuleDir must be a non-empty string');
  }
  const record = readRecord(capsuleDir);
  requireRepo(capsuleDir);

  // `git add -f` defeats the ignore rule. It does not defeat this: a patch
  // that names the machine tree is refused whatever put it there, so the one
  // path that could carry a forged record across is closed at the boundary
  // rather than left to the ignore file's good behaviour.
  const forbidden = changedPathsIn(capsuleDir).filter(
    (entry) => entry === record.tree_name || entry.startsWith(`${record.tree_name}/`)
  );
  if (forbidden.length > 0) {
    throw new Error(
      `capsule: the export from ${capsuleDir} touches the machine tree (${forbidden.join(', ')}) — nothing under ${JSON.stringify(record.tree_name)} crosses out of a capsule`
    );
  }

  const patch = gitOrThrow(capsuleDir, [...DIFF_FLAGS, 'HEAD']);
  const patchPath = patchPathOf(capsuleDir);
  fs.writeFileSync(patchPath, patch);
  const patchDigest = digestOfBytes(Buffer.from(patch, 'utf8'));
  writeAtomic(recordPathOf(capsuleDir), {
    ...record,
    state: 'exported',
    exported_at: new Date().toISOString(),
    patch_path: patchPath,
    patch_digest: patchDigest,
  });
  return { patch_path: patchPath, patch_digest: patchDigest };
}

// ---------- applyToStaging ----------

// What this patch WOULD stage, computed without touching the real index.
// `GIT_INDEX_FILE` points git at a scratch index seeded from HEAD, so "is the
// work already staged?" is answered against a freshly derived expectation
// rather than a remembered one. That matters on exactly the path a remembered
// answer cannot serve: a predecessor that applied the patch and died before
// recording anything about it.
function expectedStagedDigest(repoRoot, patchPath) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-index-'));
  const indexFile = path.join(scratch, 'index');
  const run = (args) => {
    const result = spawnSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, GIT_INDEX_FILE: indexFile },
    });
    if (result.error !== undefined) {
      throw new Error(`capsule: could not run git in ${repoRoot} — ${result.error.message}`);
    }
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  };
  try {
    const seeded = run(['read-tree', 'HEAD']);
    if (seeded.status !== 0) {
      throw new Error(`capsule: could not read HEAD into a scratch index for ${repoRoot}: ${seeded.stderr.trim()}`);
    }
    const applied = run(['apply', '--cached', patchPath]);
    if (applied.status !== 0) {
      throw new Error(
        `capsule: the patch at ${patchPath} does not apply to ${repoRoot}'s index: ${applied.stderr.trim()}`
      );
    }
    const diff = run([...DIFF_FLAGS, '--cached']);
    if (diff.status !== 0) {
      throw new Error(`capsule: could not read the scratch index of ${repoRoot}: ${diff.stderr.trim()}`);
    }
    return digestOfBytes(Buffer.from(diff.stdout, 'utf8'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// applyToStaging(repoRoot, patchPath, patchDigest) — the machine puts the
// approved work into the REAL repository's index, and nowhere else.
//
// The index only: the project's working tree is never written, so a capsule's
// work cannot appear as uncommitted changes somebody later commits by accident.
// And onto a CLEAN index only, because the law downstream is that the approved
// diff is the staged diff — applying on top of unrelated staged work would
// make the staged diff something nobody approved.
//
// THE PATCH IS VERIFIED FIRST, before any decision is taken about the index. A
// replay that skipped straight to "the digest already matches" would accept a
// retry citing a corrupt, missing or entirely different patch, and the
// reviewed artifact and the staged work would come apart — which is precisely
// what this boundary exists to prevent.
function applyToStaging(repoRoot, patchPath, patchDigest) {
  if (!isNonEmptyString(repoRoot)) {
    throw new TypeError('capsule: repoRoot must be a non-empty string');
  }
  if (!isNonEmptyString(patchPath)) {
    throw new TypeError('capsule: patchPath must be a non-empty string');
  }
  if (typeof patchDigest !== 'string' || !DIGEST_RE.test(patchDigest)) {
    throw new TypeError(
      `capsule: applyToStaging requires a patch digest of the form sha256:<64 lowercase hex> (got ${JSON.stringify(patchDigest)})`
    );
  }
  requireRepo(repoRoot);

  let bytes;
  try {
    bytes = fs.readFileSync(patchPath);
  } catch (err) {
    throw new Error(`capsule: cannot read the patch at ${patchPath}: ${err.message}`);
  }
  const actualPatchDigest = digestOfBytes(bytes);
  if (actualPatchDigest !== patchDigest) {
    throw new Error(
      `capsule: the patch at ${patchPath} digests to ${actualPatchDigest}, not the approved ${patchDigest} — this is not the artifact that was reviewed`
    );
  }

  const expected = expectedStagedDigest(repoRoot, patchPath);

  // Already there: a successor that cannot tell whether its predecessor got as
  // far as staging re-applies, and finds the work under the digest this exact
  // patch produces.
  if (stagedDiffDigest(repoRoot) === expected) {
    return { patch_digest: patchDigest, diff_digest: expected, state: 'already-staged' };
  }

  const staged = gitOrThrow(repoRoot, ['diff', '--cached', '--name-only']).trim();
  if (staged !== '') {
    throw new Error(
      `capsule: ${repoRoot} already holds staged changes (${staged.split('\n').join(', ')}) — the approved diff is the staged diff, and applying over somebody else's work would make it something nobody approved`
    );
  }

  const applied = git(repoRoot, ['apply', '--cached', patchPath]);
  if (applied.status !== 0) {
    throw new Error(
      `capsule: the patch at ${patchPath} does not apply to ${repoRoot}'s index: ${applied.stderr.trim()}`
    );
  }

  const diffDigest = stagedDiffDigest(repoRoot);
  // Declared tripwire: the index was verified clean (equal to HEAD) and the
  // expectation came from applying this same patch to a scratch index seeded
  // from HEAD, so the two cannot disagree today. It stays because it is what
  // gives the rollback below anything to fire on — without it, a future
  // divergence between the two paths would stage something unapproved and say
  // nothing.
  if (diffDigest !== expected) {
    gitOrThrow(repoRoot, ['reset', '--quiet']);
    throw new Error(
      `capsule: applying ${patchPath} staged ${diffDigest}, not the ${expected} the same patch produces on a clean index — the index has been left as it was found`
    );
  }
  return { patch_digest: patchDigest, diff_digest: diffDigest, state: 'staged' };
}

// ---------- closeCapsule ----------

// closeCapsule(capsuleDir) — the worktree goes, the record stays.
//
// Closing DISCARDS: whatever is in the capsule that did not cross as a patch
// was never part of the work, and deleting it is the point rather than a side
// effect. The project is not touched — a capsule that is thrown away costs the
// repository nothing, which is what makes discarding a crashed one a safe
// default rather than a decision.
//
// Idempotent both ways: a capsule already closed closes again to the same
// answer, and one whose directory somebody else removed still closes, because
// the record is what says it existed.
function closeCapsule(capsuleDir) {
  if (!isNonEmptyString(capsuleDir)) {
    throw new TypeError('capsule: capsuleDir must be a non-empty string');
  }
  const record = readRecord(capsuleDir);

  if (fs.existsSync(capsuleDir)) {
    // `--force` because a capsule is expected to hold uncommitted work: that
    // work is being discarded on purpose, and git's own refusal to remove a
    // dirty worktree is asking a question that has already been answered.
    const removed = git(record.repo_root, ['worktree', 'remove', '--force', capsuleDir]);
    if (removed.status !== 0 && fs.existsSync(capsuleDir)) {
      // git refuses a directory it never finished registering, which is
      // exactly the state a crashed `worktree add` leaves. A capsule has to be
      // discardable through this API whatever shape it is in, so the directory
      // goes directly — it holds only work that was never approved, and the
      // prune below is what settles git's own bookkeeping afterwards.
      fs.rmSync(capsuleDir, { recursive: true, force: true });
    }
  }
  // Whether or not the directory was there, git's own bookkeeping may still
  // list it. Pruning is what makes a capsule removed by something else stop
  // counting as a worktree of this repository.
  git(record.repo_root, ['worktree', 'prune']);

  if (record.state === 'closed') {
    return { capsuleDir, state: 'closed', record };
  }
  const closed = { ...record, state: 'closed', closed_at: new Date().toISOString() };
  writeAtomic(recordPathOf(capsuleDir), closed);
  return { capsuleDir, state: 'closed', record: closed };
}

// discardStaging(repoRoot) — drop whatever is in the index, keeping the
// working tree exactly as it is.
//
// A review that asked for changes REJECTED what was staged, and the next
// attempt's patch is a superset of it taken against the same base commit. So
// the rejected work has to go before the new work can be applied: `applyToStaging`
// refuses a non-empty index on purpose — the approved diff is the staged diff,
// and applying over work nobody approved would make the staged diff something
// nobody approved either. Discarding is the honest way past that refusal, and
// it is a different act from applying, so it is a different function.
//
// The index only, never the working tree: nothing here belongs to a human, and
// a capsule's own worktree is somewhere else entirely.
function discardStaging(repoRoot) {
  if (!isNonEmptyString(repoRoot)) {
    throw new TypeError('capsule: repoRoot must be a non-empty string');
  }
  requireRepo(repoRoot);
  gitOrThrow(repoRoot, ['reset', '--quiet', 'HEAD']);
  return { repoRoot, staged: stagedDiffDigest(repoRoot) };
}

// syncWorktreeToHead(repoRoot) — bring the working tree level with HEAD, for
// the paths the last commit actually touched and for no others.
//
// THE INDEX-ONLY RULE INVERTS THE MOMENT THE COMMIT LANDS. Applying a capsule's
// patch writes the index and never the working tree, on purpose: before the
// commit, work in the working tree is work somebody could commit by accident.
// After the commit, the same choice leaves the opposite problem — HEAD carries
// the chunk and the working tree still holds the content it replaced, so the
// repository reads as dirty from then on and `closeMilestoneTxn` refuses to
// merge over it.
//
// SCOPED TO THE COMMIT, WHICH IS THE WHOLE DIFFERENCE. An earlier form ran
// `git reset --hard HEAD` and defended it with an assumption — that nothing
// else edits this working tree during a build — that the machine never
// enforced. An assumption the code cannot check is not a safeguard, it is a
// hope with a comment attached. Asking HEAD which paths it changed and
// restoring exactly those makes unrelated edits unreachable by construction:
// there is no assumption left to violate, because the command never names
// their paths.
function syncWorktreeToHead(repoRoot) {
  if (!isNonEmptyString(repoRoot)) {
    throw new TypeError('capsule: repoRoot must be a non-empty string');
  }
  requireRepo(repoRoot);
  // `-z` for the same reason the export asks for it: a path is read from git's
  // machine-facing output, never parsed out of the human-facing one.
  const changed = gitOrThrow(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'])
    .split('\0')
    .filter((entry) => entry !== '');

  // RECONCILE TO HEAD'S ACTUAL TREE, which is not the same as checking paths
  // out of it. `git checkout HEAD -- <path>` restores a path HEAD HAS; a path
  // the chunk DELETED is absent from HEAD, so checkout cannot express "this
  // file should not exist" and the stale working-tree copy survives — which is
  // precisely the inverse-dirty state this function exists to clear. A rename
  // is the same failure wearing a different name, since its old path is a
  // deletion. So each touched path is asked of HEAD separately and reconciled
  // to what HEAD actually says: restored if it is there, removed if it is not.
  const restored = [];
  const removed = [];
  for (const rel of changed) {
    const inHead = git(repoRoot, ['cat-file', '-e', `HEAD:${rel}`]).status === 0;
    if (inHead) {
      restored.push(rel);
    } else {
      removed.push(rel);
      fs.rmSync(path.join(repoRoot, rel), { force: true });
    }
  }
  if (restored.length > 0) {
    gitOrThrow(repoRoot, ['checkout', '--quiet', 'HEAD', '--', ...restored]);
  }
  return { repoRoot, synced: changed, restored, removed, staged: stagedDiffDigest(repoRoot) };
}

// capsulePathsOf(repoRoot, milestoneId, chunkId) — where this capsule's
// directory and its exported patch live, derived from the same three facts
// every other function here derives them from.
//
// Exported for one caller: `machine/src/workflow.js`, whose op table must be
// able to reach a capsule's export and apply steps without a workflow naming a
// directory. A workflow free to pass a capsule path could export a patch out of
// somebody else's capsule, or stage one; deriving it from the milestone and
// chunk the invocation already names closes that by construction, which is the
// same reason the toolchain ops take a tree root and derive the project dir.
function capsulePathsOf(repoRoot, milestoneId, chunkId) {
  if (!isNonEmptyString(repoRoot)) {
    throw new TypeError('capsule: repoRoot must be a non-empty string');
  }
  requireSafeId(milestoneId, 'milestoneId');
  requireSafeId(chunkId, 'chunkId');
  const capsuleDir = capsuleDirOf(repoRoot, milestoneId, chunkId);
  return { capsuleDir, patchPath: patchPathOf(capsuleDir) };
}

module.exports = { openCapsule, exportDiff, applyToStaging, closeCapsule, discardStaging, syncWorktreeToHead, capsulePathsOf };
