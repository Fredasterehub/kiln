'use strict';

// implementation.js — the two idempotent transactions of the implementation
// phase, and the only place in this tree that couples a git mutation to a
// lifecycle record:
//
//   sealChunk          — the approved diff becomes a commit, and that commit
//                        becomes the chunk's one `chunk-green` record
//   closeMilestoneTxn  — the milestone branch becomes a merge and a tag, and
//                        those become the milestone's green index entry
//
// Today those are separate, non-transactional calls: `milestones.js`'s
// recordChunk and closeMilestone each do their own half, and the git half is
// the orchestrator's own narrowly-scoped Bash (product/implementation/flow.md
// §"Milestone close"). A session that dies between the two halves leaves a
// commit no record cites, or a merge no milestone reports — and the re-entry
// that follows has no way to tell its own unfinished work from work never
// started. These two functions close that gap without moving the laws: this
// module never re-implements a rule `milestones.js` already owns (lifecycle
// precedence, the cross-family review law, the every-chunk-green closeability
// check, the git verification of tag and merge_sha all stay there, called),
// and machine stays the sole writer of `chunk-*` records.
//
// THE IDEMPOTENCY KEY IS IN THE COMMIT MESSAGE. A crash-recoverable git
// transaction needs to recognize its own prior work on re-entry, and git
// gives it exactly one durable place to sign it: the commit message. Both
// transactions write trailers naming the milestone, the chunk (or the close),
// and — for a chunk — the approved diff's digest, and both find their prior
// work by searching for the WHOLE trailer identity rather than by guessing
// from tree state. The milestone is part of that identity because chunk ids
// are milestone-local: "C1" in a merged earlier milestone is reachable from a
// later milestone's branch, and a search on chunk plus digest alone could
// answer with that older commit and seal the new chunk against work it never
// contained. That is also why `chunkCommitMessage` and `milestoneMergeMessage`
// are exported: the format IS the contract, and a caller reading `git log`
// reads the same key this module searches on.
//
// A REPLAY IS ONLY A REPLAY WHEN EVERY SEMANTIC INPUT MATCHES. Both
// transactions return an existing receipt for a re-call, which is what makes
// a crash between a mutation and its record safe — but only after comparing
// the full incoming payload against what was durably sealed, not just the
// identity that names the transaction. Every input either of them acts on is
// therefore persisted where the comparison can reach it: a chunk's
// `chunk-green` record carries its `diff_digest` and `gate_ref` alongside the
// review it cites, and a milestone's index entry carries its tag and
// review_evidence. A call differing in any of them is a different transaction
// wearing a sealed identity, and fails closed.
//
// THE APPROVED DIFF IS THE STAGED DIFF. sealChunk never stages anything. The
// caller stages exactly what its reviewer approved and cites that content by
// digest (`stagedDiffDigest`, whose flags pin every git config knob that
// could otherwise move the bytes); the transaction verifies the digest still
// matches before it commits and refuses otherwise. Verification therefore
// completes entirely before the first mutation: a refused seal leaves the
// repository and the record stream exactly as it found them.
//
// The read-check-mutate sequence runs under jsonl.js's single-writer lockfile
// on this module's own path, not on any stream it writes through —
// `recordChunk` and `closeMilestone` take the locks their own files need, and
// an outer lock on the same path would deadlock against them (receipts.js
// holds the same discipline for the same reason).

const path = require('node:path');

const { withLock } = require('./jsonl.js');
const { readRecords } = require('./stream.js');
const { readJson } = require('./atomic-json.js');
const { recordChunk, closeMilestone, createMilestone, LIFECYCLE_KINDS } = require('./milestones.js');
const { resolveRef } = require('./receipts.js');
// The staged-diff digest and the git primitives it rests on live in their own
// module so `milestones.js` can recompute the same digest without importing
// this one, which imports it. Re-exported below, unchanged.
const { stagedDiffDigest, git, gitOrThrow, requireRepo } = require('./staged-diff.js');

// withLock(file) creates and removes `<file>.lock`; the base path itself is
// never written, so this names a lock, not a file in the tree.
const IMPLEMENTATION_LOCK_BASE = 'implementation';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const DEFAULT_BASE_BRANCH = 'main';

// The trailer keys both transactions sign their commits with, and search on.
const MILESTONE_TRAILER = 'Kiln-Milestone';
const CHUNK_TRAILER = 'Kiln-Chunk';
const DIGEST_TRAILER = 'Kiln-Diff-Digest';
const CLOSE_TRAILER = 'Kiln-Milestone-Close';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function milestoneBranchOf(milestoneId) {
  return `milestone/${milestoneId}`;
}

// ---------- git ----------

// The branch HEAD is on — this module's own question, since only its
// transactions care which branch a chunk commits to.
function currentBranch(repoRoot) {
  return gitOrThrow(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

// The commit a ref resolves to, or null when the ref does not exist. Peeling
// through `^{commit}` is what makes an annotated tag and a hex-shaped string
// both answer the same question honestly (milestones.js:456 names the same
// trap for a bare `--verify` on a raw SHA).
function commitOf(repoRoot, ref) {
  const result = git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return result.status === 0 ? result.stdout.trim() : null;
}

// The newest commit reachable from `ref` whose message contains all of
// `needles` verbatim — how each transaction recognizes its own prior work.
// A missing ref (an unborn branch, a milestone branch never created) is not
// an error here: it is simply no prior work.
function findSignedCommit(repoRoot, ref, needles) {
  const args = ['log', '--format=%H', '--max-count=1', '--fixed-strings', '--all-match'];
  for (const needle of needles) args.push(`--grep=${needle}`);
  args.push(ref, '--');
  const result = git(repoRoot, args);
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return sha === '' ? null : sha;
}

// ---------- the commit messages, which are also the idempotency keys ----------

// The subject line is product/implementation/flow.md's own chunk-commit form
// ("chunk: <chunk_id> green [gate <gate_id>]"); the trailers below it are
// what makes the commit findable again after a crash.
function chunkCommitMessage(milestoneId, chunkId, gateId, diffDigest) {
  return [
    `chunk: ${chunkId} green [gate ${gateId}]`,
    '',
    `${MILESTONE_TRAILER}: ${milestoneId}`,
    `${CHUNK_TRAILER}: ${chunkId}`,
    `${DIGEST_TRAILER}: ${diffDigest}`,
  ].join('\n');
}

// The subject line is flow.md's own merge form ("merge: milestone/<id> into
// main"); the trailer is what a re-entry between the merge and the tag finds.
function milestoneMergeMessage(milestoneId, branch, base) {
  return [`merge: ${branch} into ${base}`, '', `${CLOSE_TRAILER}: ${milestoneId}`].join('\n');
}

// ---------- reading the chunk stream ----------

// Fails closed on any parse error or common-header violation, rather than
// deciding "this chunk has no green record yet" from a stream it cannot
// fully parse — the same read discipline milestones.js:389 and receipts.js
// apply before they append.
function readChunkRecordsOrThrow(chunksPath) {
  const { records, errors, headerViolations } = readRecords(chunksPath);
  if (errors.length > 0) {
    const detail = errors.map((e) => `line ${e.lineNo}: ${e.reason}`).join('; ');
    throw new Error(`implementation: ${chunksPath} has malformed record(s) — refusing to trust this stream: ${detail}`);
  }
  if (headerViolations.length > 0) {
    const detail = headerViolations.map((v) => `record[${v.index}]: ${v.errors.join(', ')}`).join('; ');
    throw new Error(
      `implementation: ${chunksPath} has record(s) violating the common JSONL header — refusing to trust this stream: ${detail}`
    );
  }
  return records;
}

function chunksPathOf(treeRoot, milestoneId) {
  return path.join(treeRoot, 'milestones', milestoneId, 'chunks.jsonl');
}

// The latest lifecycle record per chunk — the same latest-by-seq pointer
// milestones.js reads to decide whether a milestone can close.
function latestLifecycleByChunk(records) {
  const latest = new Map();
  for (const record of records) {
    if (!LIFECYCLE_KINDS.includes(record.kind)) continue;
    if (!isNonEmptyString(record.chunk_id)) continue;
    const prior = latest.get(record.chunk_id);
    if (prior === undefined || record.seq > prior.seq) latest.set(record.chunk_id, record);
  }
  return latest;
}

function latestOfKind(records, kind, chunkId) {
  let latest = null;
  for (const record of records) {
    if (record.kind !== kind || record.chunk_id !== chunkId) continue;
    if (latest === null || record.seq > latest.seq) latest = record;
  }
  return latest;
}

// ---------- sealChunk ----------

// The gate evidence a chunk-green must carry, taken from the real `gate`
// record the ref cites rather than from anything the caller says about it —
// check-honesty.js's runGate is the sole producer of that record, and this
// reads what it actually wrote.
function verificationFrom(treeRoot, gateRef) {
  const record = resolveRef(treeRoot, gateRef);
  if (record === null) {
    throw new Error(`implementation: gate_ref ${JSON.stringify(gateRef)} does not resolve to a durable record`);
  }
  if (record.kind !== 'gate') {
    throw new Error(
      `implementation: gate_ref ${JSON.stringify(gateRef)} resolves to a "${record.kind}" record, not a "gate" record`
    );
  }
  if (record.exit_code !== 0) {
    throw new Error(
      `implementation: gate "${record.gate_id}" cited by ${JSON.stringify(gateRef)} exited with exit_code ${record.exit_code} — a chunk cannot seal on a gate that did not pass`
    );
  }
  return { gate_id: record.gate_id, cmd: record.cmd, exit_code: record.exit_code };
}

// The review a chunk-green must carry, taken from the chunk's own latest
// `chunk-review` record: the caller cites the review it acted on, and a
// citation that is not the operative review is refused rather than believed.
// milestones.js keeps its own copy of this check at append time; what this
// adds is refusing BEFORE the commit, so a stale citation never mutates git.
function reviewFrom(records, chunkId, reviewRef) {
  const latest = latestOfKind(records, 'chunk-review', chunkId);
  if (latest === null) {
    throw new Error(`implementation: chunk "${chunkId}" has no "chunk-review" record — nothing approved this diff`);
  }
  if (latest.review.ref !== reviewRef) {
    throw new Error(
      `implementation: review_ref ${JSON.stringify(reviewRef)} is not the latest "chunk-review" for chunk "${chunkId}" (that is ${JSON.stringify(latest.review.ref)})`
    );
  }
  if (latest.review.verdict !== 'approve') {
    throw new Error(
      `implementation: chunk "${chunkId}"'s latest review carries verdict "${latest.review.verdict}" — only an approved chunk seals`
    );
  }
  return { family: latest.review.family, verdict: latest.review.verdict, ref: latest.review.ref };
}

// sealChunk(treeRoot, milestoneId, chunkId, {diff_digest, review_ref,
// gate_ref}, opts) — one recoverable transaction: verify the gate evidence,
// the review, and the staged diff; commit it to the milestone branch signed
// with the digest; record `chunk-green` through milestones.js. Re-entry at
// any internal point finishes exactly what is missing — the commit is found
// by its digest trailer, the record by the chunk's own green record — and a
// second call for the same chunk under a DIFFERENT digest fails closed.
//
// opts: {repoRoot = <treeRoot>/.. (the project root the tree sits inside,
// milestones.js's own default), branch = milestone/<milestoneId>}.
function sealChunk(treeRoot, milestoneId, chunkId, sealInfo, opts = {}) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('implementation: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(milestoneId)) {
    throw new TypeError('implementation: milestoneId must be a non-empty string');
  }
  if (!isNonEmptyString(chunkId)) {
    throw new TypeError('implementation: chunkId must be a non-empty string');
  }
  if (!isPlainObject(sealInfo)) {
    throw new TypeError('implementation: sealChunk requires a {diff_digest, review_ref, gate_ref} object');
  }
  const { diff_digest: diffDigest, review_ref: reviewRef, gate_ref: gateRef } = sealInfo;
  if (typeof diffDigest !== 'string' || !DIGEST_RE.test(diffDigest)) {
    throw new TypeError(
      `implementation: sealChunk requires a "diff_digest" of the form sha256:<64 hex> (got ${JSON.stringify(diffDigest)})`
    );
  }
  if (!isNonEmptyString(reviewRef)) {
    throw new TypeError('implementation: sealChunk requires a non-empty "review_ref"');
  }
  if (!isNonEmptyString(gateRef)) {
    throw new TypeError('implementation: sealChunk requires a non-empty "gate_ref"');
  }

  const repoRoot = isNonEmptyString(opts.repoRoot) ? opts.repoRoot : path.join(treeRoot, '..');
  const branch = isNonEmptyString(opts.branch) ? opts.branch : milestoneBranchOf(milestoneId);
  requireRepo(repoRoot);

  const chunksPath = chunksPathOf(treeRoot, milestoneId);

  return withLock(path.join(treeRoot, IMPLEMENTATION_LOCK_BASE), () => {
    const records = readChunkRecordsOrThrow(chunksPath);

    // Already sealed: the receipt is the record on disk, whatever this call
    // would have written — but only once every input this call carries is the
    // input that was actually sealed.
    const sealed = latestOfKind(records, 'chunk-green', chunkId);
    if (sealed !== null) {
      assertSameSeal(sealed, chunkId, { diffDigest, reviewRef, gateRef });
      return receiptOf(milestoneId, chunkId, sealed);
    }

    const verification = verificationFrom(treeRoot, gateRef);
    const review = reviewFrom(records, chunkId, reviewRef);
    const message = chunkCommitMessage(milestoneId, chunkId, verification.gate_id, diffDigest);

    // Re-entry after a crash between the commit and the record: the commit
    // signed with this identity is already on the branch, and nothing is
    // staged any more, so the digest check below must not run against an empty
    // index. All three trailers are required to match — a chunk id alone is
    // milestone-local, and an earlier milestone's commit can be reachable from
    // this branch.
    let commit = findSignedCommit(repoRoot, branch, [
      `${MILESTONE_TRAILER}: ${milestoneId}`,
      `${CHUNK_TRAILER}: ${chunkId}`,
      `${DIGEST_TRAILER}: ${diffDigest}`,
    ]);

    if (commit === null) {
      const head = currentBranch(repoRoot);
      if (head !== branch) {
        throw new Error(
          `implementation: ${repoRoot} is on branch "${head}", not the milestone branch "${branch}" — refusing to commit a chunk anywhere else`
        );
      }
      const staged = stagedDiffDigest(repoRoot);
      if (staged !== diffDigest) {
        throw new Error(
          `implementation: the staged diff does not match the approved diff_digest (staged ${staged}, approved ${diffDigest}) — refusing to commit an unapproved diff`
        );
      }
      gitOrThrow(repoRoot, ['commit', '--quiet', '--message', message]);
      commit = commitOf(repoRoot, 'HEAD');
    }

    const { seq } = recordChunk(treeRoot, milestoneId, {
      kind: 'chunk-green',
      chunk_id: chunkId,
      commit,
      review,
      verification,
      diff_digest: diffDigest,
      gate_ref: gateRef,
    });

    const written = readChunkRecordsOrThrow(chunksPath).find((record) => record.seq === seq);
    return receiptOf(milestoneId, chunkId, written);
  });
}

// A sealed chunk answers a re-call with its own receipt only when that call
// carries the inputs that were actually sealed. Comparing the approved diff
// alone would let a replay citing a missing, failed, or unrelated gate — or a
// review that never approved this diff — collect a receipt for work it never
// did. Each input is compared against where it is durably bound: the digest
// and the gate ref on the record itself, the review ref on the review the
// record cites.
function assertSameSeal(sealed, chunkId, { diffDigest, reviewRef, gateRef }) {
  const conflicts = [];
  if (sealed.diff_digest !== diffDigest) {
    conflicts.push(`diff_digest (sealed ${sealed.diff_digest}, called with ${diffDigest})`);
  }
  if (sealed.gate_ref !== gateRef) {
    conflicts.push(`gate_ref (sealed ${JSON.stringify(sealed.gate_ref)}, called with ${JSON.stringify(gateRef)})`);
  }
  if (sealed.review.ref !== reviewRef) {
    conflicts.push(`review_ref (sealed ${JSON.stringify(sealed.review.ref)}, called with ${JSON.stringify(reviewRef)})`);
  }
  if (conflicts.length > 0) {
    throw new Error(
      `implementation: chunk "${chunkId}" is already sealed with a different ${conflicts.join(', and a different ')} — refusing to seal it twice`
    );
  }
}

// The receipt is the durable record itself, read back off disk — identical on
// the first call and on every replay, since both read the same line.
function receiptOf(milestoneId, chunkId, record) {
  return {
    milestoneId,
    chunkId,
    commit: record.commit,
    diff_digest: record.diff_digest,
    seq: record.seq,
    record,
  };
}

// ---------- closeMilestoneTxn ----------

// The pre-mutation refusal gate: is this milestone closeable AT ALL, asked
// before anything is merged or tagged. It answers the same question
// closeMilestone answers authoritatively at the end of the transaction —
// every chunk's latest lifecycle record is chunk-green, and the milestone is
// in the index — and it deliberately answers it no more deeply than that.
// Whatever changes between this scan and closeMilestone's own check is
// closeMilestone's to catch; what this prevents is a merge and a tag made on
// behalf of a milestone that was never closeable in the first place.
function assertCloseable(treeRoot, milestoneId) {
  if (indexEntryOf(treeRoot, milestoneId) === null) {
    throw new Error(
      `implementation: milestone "${milestoneId}" is not present in the milestone index — refusing to merge or tag a milestone that cannot close`
    );
  }
  const latestByChunk = latestLifecycleByChunk(
    readChunkRecordsOrThrow(chunksPathOf(treeRoot, milestoneId))
  );
  if (latestByChunk.size === 0) {
    throw new Error(
      `implementation: milestone "${milestoneId}" has no chunk records — refusing to merge or tag a milestone that cannot close`
    );
  }
  const notGreen = [...latestByChunk.entries()].filter(([, record]) => record.kind !== 'chunk-green');
  if (notGreen.length > 0) {
    const names = notGreen.map(([chunkId, record]) => `${chunkId} (latest: ${record.kind})`).join(', ');
    throw new Error(
      `implementation: milestone "${milestoneId}" has non-green chunks: ${names} — refusing to merge or tag a milestone that cannot close`
    );
  }
}

function indexEntryOf(treeRoot, milestoneId) {
  const index = readJson(path.join(treeRoot, 'milestones', 'index.json'), null);
  if (!isPlainObject(index) || !Array.isArray(index.milestones)) return null;
  const entry = index.milestones.find((candidate) => isPlainObject(candidate) && candidate.id === milestoneId);
  return entry === undefined ? null : entry;
}

// closeMilestoneTxn(treeRoot, milestoneId, {tag, review_evidence}, opts) —
// one recoverable transaction: merge the milestone branch into the base with
// a real merge commit, annotate it with the tag, and flip the milestone's
// index entry through milestones.js's closeMilestone. Re-entry at any
// internal point finishes exactly what is missing — the merge is found by its
// close trailer, the tag by name, the flip by the index entry's own status —
// and a second call under a DIFFERENT tag fails closed.
//
// The merge is always `--no-ff`: a fast-forward would leave no merge commit
// to carry the trailer, no single `merge_sha` for the record, and no rollback
// point for the milestone (product/implementation/flow.md §"Milestone close").
//
// closeMilestone owns the closeability law and is called LAST, as that flow
// document orders it: it is the authoritative, race-safe check, and the
// preliminary scan below transfers no ownership of it. But it cannot be the
// ONLY check, because by the time it runs the merge and the tag already
// exist: a milestone that turns out not to be closeable would be left with
// `main` merged and a tag claiming all its chunk gates passed, possibly
// forever. Recoverability prevents a duplicate; it does not make a failed
// transaction truthful. So the same latest-lifecycle-per-chunk question is
// asked once BEFORE the first mutation, purely as a refusal gate.
//
// opts: {repoRoot = <treeRoot>/.., branch = milestone/<milestoneId>,
// base = "main"}.
function closeMilestoneTxn(treeRoot, milestoneId, closeInfo, opts = {}) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('implementation: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(milestoneId)) {
    throw new TypeError('implementation: milestoneId must be a non-empty string');
  }
  if (!isPlainObject(closeInfo)) {
    throw new TypeError('implementation: closeMilestoneTxn requires a {tag, review_evidence} object');
  }
  if (!isNonEmptyString(closeInfo.tag)) {
    throw new TypeError('implementation: closeMilestoneTxn requires a non-empty "tag"');
  }
  if (!isNonEmptyString(closeInfo.review_evidence)) {
    throw new TypeError('implementation: closeMilestoneTxn requires a non-empty "review_evidence"');
  }

  const repoRoot = isNonEmptyString(opts.repoRoot) ? opts.repoRoot : path.join(treeRoot, '..');
  const branch = isNonEmptyString(opts.branch) ? opts.branch : milestoneBranchOf(milestoneId);
  const base = isNonEmptyString(opts.base) ? opts.base : DEFAULT_BASE_BRANCH;
  const { tag, review_evidence: reviewEvidence } = closeInfo;

  return withLock(path.join(treeRoot, IMPLEMENTATION_LOCK_BASE), () => {
    // Already closed: the receipt is the index entry on disk — but only once
    // every input this call carries is the input that was actually closed.
    // Both the tag and the review evidence are durably bound on that entry,
    // so both are compared: a re-call citing different review evidence is a
    // second close of something already sealed, not a replay of it.
    const closed = indexEntryOf(treeRoot, milestoneId);
    if (closed !== null && closed.status === 'green') {
      const conflicts = [];
      if (closed.tag !== tag) conflicts.push(`tag (called with ${JSON.stringify(tag)})`);
      if (closed.review_evidence !== reviewEvidence) {
        conflicts.push(
          `review_evidence (closed with ${JSON.stringify(closed.review_evidence)}, called with ${JSON.stringify(reviewEvidence)})`
        );
      }
      if (conflicts.length > 0) {
        throw new Error(
          `implementation: milestone "${milestoneId}" is already closed under tag ${JSON.stringify(closed.tag)} — refusing to close it again with a different ${conflicts.join(', and a different ')}`
        );
      }
      return { milestoneId, tag: closed.tag, merge_sha: closed.merge_sha, entry: closed };
    }

    requireRepo(repoRoot);
    assertCloseable(treeRoot, milestoneId);

    let mergeSha = findSignedCommit(repoRoot, base, [`${CLOSE_TRAILER}: ${milestoneId}`]);
    if (mergeSha === null) {
      // No merge yet, so the tag cannot legitimately exist either: one that
      // does was put there by something other than this transaction, and
      // moving it or merging under it would destroy whatever it marks.
      if (commitOf(repoRoot, `refs/tags/${tag}`) !== null) {
        throw new Error(
          `implementation: tag ${JSON.stringify(tag)} already exists but no merge commit for milestone "${milestoneId}" does — refusing to close over a tag this transaction did not make`
        );
      }
      const dirty = gitOrThrow(repoRoot, ['status', '--porcelain', '--untracked-files=no']).trim();
      if (dirty !== '') {
        throw new Error(
          `implementation: the working tree is not clean in ${repoRoot} — refusing to merge over uncommitted work:\n${dirty}`
        );
      }
      gitOrThrow(repoRoot, ['checkout', '--quiet', base]);
      gitOrThrow(repoRoot, ['merge', '--no-ff', '--quiet', branch, '--message', milestoneMergeMessage(milestoneId, branch, base)]);
      mergeSha = commitOf(repoRoot, 'HEAD');
    }

    const tagged = commitOf(repoRoot, `refs/tags/${tag}`);
    if (tagged === null) {
      gitOrThrow(repoRoot, ['tag', '--annotate', tag, '--message', `${milestoneId} green: all chunk gates passed`, mergeSha]);
    } else if (tagged !== mergeSha) {
      throw new Error(
        `implementation: tag ${JSON.stringify(tag)} points at ${tagged}, not this milestone's merge commit ${mergeSha} — refusing to move it`
      );
    }

    closeMilestone(treeRoot, milestoneId, { tag, merge_sha: mergeSha, review_evidence: reviewEvidence }, { repoRoot });

    const entry = indexEntryOf(treeRoot, milestoneId);
    return { milestoneId, tag, merge_sha: mergeSha, entry };
  });
}

// openMilestoneTxn(treeRoot, entry, opts) — a milestone's branch and its own
// genesis records, as ONE recoverable transaction. The mirror of
// closeMilestoneTxn at the other end of a milestone's life, and re-enterable
// for the same reason: two durable writes (the branch, then the milestone)
// with a crash point between them.
//
// The order is branch FIRST. A milestone in the index whose branch does not
// exist is a milestone nothing can commit to, and the only way out of it is
// to make the branch anyway — so the sequence puts the recoverable half
// first, and re-entry finishes whichever half is missing. `createMilestone`
// is a one-shot genesis operation that refuses a repeat, so replay is
// answered here, from the index entry it already wrote.
//
// opts: {repoRoot = <treeRoot>/.., branch = milestone/<id>, base = "main"}.
function openMilestoneTxn(treeRoot, entry, opts = {}) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('implementation: treeRoot must be a non-empty string');
  }
  if (!isPlainObject(entry) || !isNonEmptyString(entry.id)) {
    throw new TypeError('implementation: openMilestoneTxn requires a milestone entry with a non-empty "id"');
  }
  const milestoneId = entry.id;
  const repoRoot = isNonEmptyString(opts.repoRoot) ? opts.repoRoot : path.join(treeRoot, '..');
  const branch = isNonEmptyString(opts.branch) ? opts.branch : milestoneBranchOf(milestoneId);
  const base = isNonEmptyString(opts.base) ? opts.base : DEFAULT_BASE_BRANCH;

  return withLock(path.join(treeRoot, IMPLEMENTATION_LOCK_BASE), () => {
    // Already open: the index entry IS the receipt, and it is only a replay
    // if it describes the same milestone. A second call under a different
    // title or family is a different milestone wearing a recorded id.
    const existing = indexEntryOf(treeRoot, milestoneId);
    if (existing !== null) {
      for (const field of ['title', 'designer_family']) {
        if (entry[field] !== undefined && existing[field] !== entry[field]) {
          throw new Error(
            `implementation: milestone "${milestoneId}" is already open as ${JSON.stringify(existing[field])} — refusing to reopen it as ${JSON.stringify(entry[field])}`
          );
        }
      }
      // The toolchain profile is compared ALWAYS, not only when the caller
      // supplied it. Omitting it is not "no opinion": `createMilestone`
      // records an omission as `null`, a real value meaning this milestone
      // needs nothing, so an absent field is a claim like any other. And it is
      // the claim with consequences — it decides whether the milestone
      // preflights at all, and which install and suite commands its gates run
      // — so a replay free to re-describe it would leave a milestone's gate
      // records and its recorded toolchain describing different milestones.
      const wantProfile = Object.prototype.hasOwnProperty.call(entry, 'toolchain_profile')
        ? entry.toolchain_profile
        : null;
      if (existing.toolchain_profile !== wantProfile) {
        throw new Error(
          `implementation: milestone "${milestoneId}" is already open with toolchain_profile ${JSON.stringify(existing.toolchain_profile)} — refusing to reopen it as ${JSON.stringify(wantProfile)}`
        );
      }
      requireRepo(repoRoot);
      ensureBranch(repoRoot, branch, base);
      return { milestoneId, branch, entry: existing };
    }

    requireRepo(repoRoot);
    ensureBranch(repoRoot, branch, base);
    createMilestone(treeRoot, entry);
    return { milestoneId, branch, entry: indexEntryOf(treeRoot, milestoneId) };
  });
}

// The branch exists and is checked out, whether this call made it or found
// it. Checking out a branch that is already current is a no-op in git, so
// re-entry costs nothing and asserts the state the caller is owed.
function ensureBranch(repoRoot, branch, base) {
  if (commitOf(repoRoot, branch) === null) {
    gitOrThrow(repoRoot, ['checkout', '--quiet', '-b', branch, base]);
    return;
  }
  if (currentBranch(repoRoot) !== branch) {
    gitOrThrow(repoRoot, ['checkout', '--quiet', branch]);
  }
}

module.exports = {
  sealChunk,
  closeMilestoneTxn,
  openMilestoneTxn,
  stagedDiffDigest,
  chunkCommitMessage,
  milestoneMergeMessage,
};
