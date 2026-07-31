'use strict';

// Milestone lifecycle bookkeeping for the implementation phase (the
// "milestones/<id>/" tree shape). This module owns exactly three
// operations — createMilestone, recordChunk, closeMilestone — the same
// "thin scaffolding, model authors the content" division scaffold.js
// already draws for architecture: it never authors spec.md (the kept-warm
// designer's own anchor source) and it never runs git as a general
// mechanism — the rollback protocol's own branch/merge/tag commands stay
// Kiln's narrowly-scoped Bash, never JS-layer machinery (one native
// mechanism per constraint). The one exception is closeMilestone's own git
// READ-ONLY verification below — it never runs a mutating git command,
// only `git rev-parse --verify`, so a milestone can never report green
// before its merge or tag has actually landed in the repository.
//
// milestones/index.json is the top-level restart-anytime index
// (machine/phases-registry.json's "implementation" exit_emits); each
// milestones/<id>/chunks.jsonl is the per-milestone chunk-record stream
// ({chunk_id, brief_ref, commit, review, journeys_added}).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { appendRecord, readRecords } = require('./stream.js');
const { readJson, writeAtomic } = require('./atomic-json.js');
const { DESIGNER_FAMILIES } = require('./validators.js');
const { PROFILE_IDS } = require('./toolchain.js');

const INDEX_SCHEMA_VERSION = 1;

// The six chunk-record kinds this stream carries across a chunk's lifecycle.
// The first four are the strict, ORDERED lifecycle spine (LIFECYCLE_KINDS,
// below) — spec, start, review (one or more, across a capped revise loop),
// green. "chunk-consult" and "chunk-journeys" are the designer's own
// side-channel records (mailbox consult answers; JIT journey authorship
// notices) — they carry a chunk_id and require the chunk to already exist,
// but they never participate in the strict spec->start->review->green
// precedence check, and never become the "latest lifecycle record" a
// precedence check reads. The designer file uses the recordChunk API only
// for these two kinds; milestone-designer.md never writes "chunk-green" —
// that stays orchestrator-only, below.
const LIFECYCLE_KINDS = ['chunk-spec', 'chunk-start', 'chunk-review', 'chunk-green'];
const CHUNK_RECORD_KINDS = [...LIFECYCLE_KINDS, 'chunk-consult', 'chunk-journeys'];

// Closed set: reviewer contracts and the flow both produce approve|revise,
// so this module speaks the same vocabulary rather than a third,
// incompatible one. "approve" is the only verdict chunk-green may itself
// carry AND the only verdict the immediately-preceding chunk-review may
// carry for a chunk to reach green — see assertLifecycleAndCrossChecks.
const REVIEW_VERDICTS = new Set(['approve', 'revise']);
const MILESTONE_STATUSES = { OPEN: 'open', GREEN: 'green' };

// A chunk-green's own "commit" must at least look like a real git SHA (7-40
// hex characters, git's own abbreviation floor through a full sha1/sha256
// object id) — refuses an obviously fabricated value like "commit:
// not-a-sha". This is a format check only; milestones.js still never
// shells out to verify a CHUNK commit against git (that stays Kiln's
// own real `git rev-parse HEAD` at commit time) — only closeMilestone's
// merge_sha/tag verification, below, does.
const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function milestoneDirOf(treeRoot, milestoneId) {
  return path.join(treeRoot, 'milestones', milestoneId);
}

function indexPathOf(treeRoot) {
  return path.join(treeRoot, 'milestones', 'index.json');
}

function chunksPathOf(treeRoot, milestoneId) {
  return path.join(milestoneDirOf(treeRoot, milestoneId), 'chunks.jsonl');
}

function readIndex(treeRoot) {
  return readJson(indexPathOf(treeRoot), { schema_version: INDEX_SCHEMA_VERSION, milestones: [] });
}

function findIndexEntry(index, milestoneId) {
  if (!isPlainObject(index) || !Array.isArray(index.milestones)) return undefined;
  return index.milestones.find((m) => isPlainObject(m) && m.id === milestoneId);
}

// createMilestone(treeRoot, entry) — entry: {id, title, designer_family,
// toolchain_profile?}. designer_family names which family dominates this
// milestone's implementation; toolchain_profile is a single closed-enum
// field (null | 'node-web' | 'node-cli' | 'python-pytest'), defaulting to
// null when a milestone needs nothing beyond what's already installed.
//
// Refuses (throws) if the milestone directory already exists or the id is
// already present in milestones/index.json — createMilestone is a one-shot
// genesis operation, never an upsert; a repeat call for the same id is a
// caller defect, not a resume case (resume reads chunks.jsonl/index.json
// directly, per the restart-anytime boundary table).
function createMilestone(treeRoot, entry) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('milestones: treeRoot must be a non-empty string');
  }
  if (!isPlainObject(entry)) {
    throw new TypeError('milestones: entry must be a plain object');
  }
  if (!isNonEmptyString(entry.id)) {
    throw new TypeError('milestones: entry.id must be a non-empty string');
  }
  if (!isNonEmptyString(entry.title)) {
    throw new TypeError('milestones: entry.title must be a non-empty string');
  }
  if (!DESIGNER_FAMILIES.has(entry.designer_family)) {
    throw new TypeError(
      `milestones: entry.designer_family must be one of ${[...DESIGNER_FAMILIES].join(', ')} (got ${JSON.stringify(entry.designer_family)})`
    );
  }
  const toolchainProfile = Object.prototype.hasOwnProperty.call(entry, 'toolchain_profile')
    ? entry.toolchain_profile
    : null;
  if (toolchainProfile !== null && !PROFILE_IDS.has(toolchainProfile)) {
    throw new TypeError(
      `milestones: entry.toolchain_profile must be null or one of ${[...PROFILE_IDS].join(', ')} (got ${JSON.stringify(toolchainProfile)})`
    );
  }

  const milestoneDir = milestoneDirOf(treeRoot, entry.id);
  if (fs.existsSync(milestoneDir)) {
    throw new Error(`milestones: milestone directory already exists at ${milestoneDir} — createMilestone is one-shot`);
  }

  const index = readIndex(treeRoot);
  if (!isPlainObject(index) || !Array.isArray(index.milestones)) {
    throw new Error(`milestones: ${indexPathOf(treeRoot)} exists but is not a well-formed index object`);
  }
  if (index.milestones.some((m) => isPlainObject(m) && m.id === entry.id)) {
    throw new Error(`milestones: id "${entry.id}" is already present in milestones/index.json`);
  }

  const mailboxDir = path.join(milestoneDir, 'mailbox');
  fs.mkdirSync(mailboxDir, { recursive: true });

  const chunksPath = chunksPathOf(treeRoot, entry.id);
  appendRecord(chunksPath, { kind: 'genesis', payload: {}, correlation_id: null });

  const indexPath = indexPathOf(treeRoot);
  const newIndex = {
    schema_version: INDEX_SCHEMA_VERSION,
    milestones: [
      ...index.milestones,
      {
        id: entry.id,
        title: entry.title,
        designer_family: entry.designer_family,
        toolchain_profile: toolchainProfile,
        status: MILESTONE_STATUSES.OPEN,
      },
    ],
  };
  writeAtomic(indexPath, newIndex);

  return { created: [milestoneDir, mailboxDir, chunksPath, indexPath], milestoneId: entry.id };
}

// Per-kind required-field checks — shape only (no reference to prior
// records; that cross-referencing is assertLifecycleAndCrossChecks, below,
// since it needs the chunk's full record history). chunk-green's
// verification requirement is the load-bearing one: a chunk cannot report
// green without a real, exit_code-0 verification record attached — the
// same "a gate passes only with ledger evidence" law check-honesty.js
// already enforces for phase gates, applied here to chunk gates. This does
// not re-run the gate itself (that stays check-honesty.js's runGate, one
// native mechanism) — it only refuses to LOG a green chunk that carries no
// evidence of one.
function assertChunkRecordShape(record) {
  if (!CHUNK_RECORD_KINDS.includes(record.kind)) {
    throw new TypeError(
      `milestones: chunk record kind must be one of ${CHUNK_RECORD_KINDS.join(', ')} (got ${JSON.stringify(record.kind)})`
    );
  }
  if (!isNonEmptyString(record.chunk_id)) {
    throw new TypeError('milestones: chunk record requires a non-empty "chunk_id"');
  }

  if (record.kind === 'chunk-spec') {
    if (!isNonEmptyString(record.brief_ref)) {
      throw new TypeError('milestones: "chunk-spec" record requires a non-empty "brief_ref"');
    }
  }

  if (record.kind === 'chunk-start') {
    if (!isNonEmptyString(record.implementer_seat)) {
      throw new TypeError('milestones: "chunk-start" record requires a non-empty "implementer_seat"');
    }
    // implementer_family — the family this chunk's implementation belongs
    // to: chunk-green's cross-family check has nothing to validate against
    // without this recorded at start time. Reuses DESIGNER_FAMILIES' exact
    // closed {claude, gpt} vocabulary rather
    // than a second, parallel family enum for the same concept.
    if (!DESIGNER_FAMILIES.has(record.implementer_family)) {
      throw new TypeError(
        `milestones: "chunk-start" record requires "implementer_family" to be one of ${[...DESIGNER_FAMILIES].join(', ')} (got ${JSON.stringify(record.implementer_family)})`
      );
    }
  }

  if (record.kind === 'chunk-review' || record.kind === 'chunk-green') {
    const review = record.review;
    if (
      !isPlainObject(review) ||
      !DESIGNER_FAMILIES.has(review.family) ||
      !REVIEW_VERDICTS.has(review.verdict) ||
      !isNonEmptyString(review.ref)
    ) {
      throw new TypeError(
        `milestones: "${record.kind}" record requires a "review" object with "family" one of ${[...DESIGNER_FAMILIES].join(', ')}, verdict one of ${[...REVIEW_VERDICTS].join(', ')}, and non-empty "ref"`
      );
    }
  }

  if (record.kind === 'chunk-green') {
    if (!isNonEmptyString(record.commit) || !COMMIT_SHA_RE.test(record.commit)) {
      throw new TypeError('milestones: "chunk-green" record requires a "commit" that looks like a git SHA (7-40 hex characters)');
    }
    if (record.review.verdict !== 'approve') {
      throw new TypeError('milestones: "chunk-green" record\'s own "review.verdict" must be "approve"');
    }
    const verification = record.verification;
    if (
      !isPlainObject(verification) ||
      !isNonEmptyString(verification.gate_id) ||
      !isNonEmptyString(verification.cmd) ||
      verification.exit_code !== 0
    ) {
      throw new TypeError(
        'milestones: "chunk-green" record requires a "verification" object with non-empty "gate_id"/"cmd" and "exit_code" === 0 — a chunk cannot report green without evidence a gate actually passed'
      );
    }
  }

  if (record.kind === 'chunk-consult') {
    if (
      !isNonEmptyString(record.consult_id) ||
      !isNonEmptyString(record.asker) ||
      !isNonEmptyString(record.question) ||
      !isNonEmptyString(record.verdict) ||
      !isNonEmptyString(record.anchor)
    ) {
      throw new TypeError(
        'milestones: "chunk-consult" record requires non-empty "consult_id", "asker", "question", "verdict", and "anchor" — the verdict-plus-verbatim-anchor shape'
      );
    }
  }

  if (record.kind === 'chunk-journeys') {
    if (
      !Array.isArray(record.journey_ids) ||
      record.journey_ids.length === 0 ||
      !record.journey_ids.every(isNonEmptyString)
    ) {
      throw new TypeError('milestones: "chunk-journeys" record requires a non-empty array of non-empty "journey_ids"');
    }
  }
}

// The latest record among LIFECYCLE_KINDS only, for one chunk_id — the
// pointer both the precedence check and closeMilestone's own "is every
// chunk green" question read. "chunk-consult"/"chunk-journeys" records
// never move this pointer (see the CHUNK_RECORD_KINDS comment above): a
// journeys-added notice logged right after a chunk-green must not make
// closeMilestone see anything but "chunk-green" as this chunk's latest
// lifecycle state.
function latestLifecycleRecord(records, chunkId) {
  let latest = null;
  for (const record of records) {
    if (!isPlainObject(record)) continue;
    if (!LIFECYCLE_KINDS.includes(record.kind)) continue;
    if (record.chunk_id !== chunkId) continue;
    if (!latest || record.seq > latest.seq) latest = record;
  }
  return latest;
}

// The (unique) chunk-start record for one chunk_id — precedence below
// guarantees at most one exists per chunk's lifecycle pass (a second
// chunk-start attempt is itself rejected as out-of-order, since the latest
// lifecycle record right after the first chunk-start is "chunk-start", not
// "chunk-spec").
function findChunkStartRecord(records, chunkId) {
  let found;
  for (const record of records) {
    if (isPlainObject(record) && record.kind === 'chunk-start' && record.chunk_id === chunkId) {
      found = record;
    }
  }
  return found;
}

// Enforces the strict lifecycle precedence per chunk_id (spec -> start ->
// review -> green; out-of-order rejected) plus chunk-green's cross-record
// checks:
// the immediately-preceding chunk-review must carry verdict "approve", that
// same review's family/ref is what chunk-green's own "review" must match
// exactly (never a caller-invented family/ref disconnected from a real
// review record — the forged-green probe's exact hole), and that family
// must differ from the chunk's own recorded implementer_family (the
// cross-family review law).
function assertLifecycleAndCrossChecks(records, record) {
  const chunkId = record.chunk_id;
  const latest = latestLifecycleRecord(records, chunkId);

  if (record.kind === 'chunk-spec') {
    if (latest !== null) {
      throw new TypeError(
        `milestones: chunk "${chunkId}" already has a lifecycle record (latest: "${latest.kind}") — "chunk-spec" must be the first lifecycle record for a chunk`
      );
    }
    return;
  }

  if (record.kind === 'chunk-start') {
    if (!latest || latest.kind !== 'chunk-spec') {
      throw new TypeError(
        `milestones: "chunk-start" for chunk "${chunkId}" requires the chunk's prior lifecycle record to be "chunk-spec" (got ${latest ? `"${latest.kind}"` : 'none'})`
      );
    }
    return;
  }

  if (record.kind === 'chunk-review') {
    if (!latest || (latest.kind !== 'chunk-start' && latest.kind !== 'chunk-review')) {
      throw new TypeError(
        `milestones: "chunk-review" for chunk "${chunkId}" requires the chunk's prior lifecycle record to be "chunk-start" or "chunk-review" (got ${latest ? `"${latest.kind}"` : 'none'})`
      );
    }
    return;
  }

  if (record.kind === 'chunk-green') {
    if (!latest || latest.kind !== 'chunk-review') {
      throw new TypeError(
        `milestones: "chunk-green" for chunk "${chunkId}" requires the chunk's prior lifecycle record to be "chunk-review" (got ${latest ? `"${latest.kind}"` : 'none'})`
      );
    }
    if (latest.review.verdict !== 'approve') {
      throw new TypeError(
        `milestones: "chunk-green" for chunk "${chunkId}" requires the latest "chunk-review" record's verdict to be "approve" (got "${latest.review.verdict}")`
      );
    }
    if (record.review.family !== latest.review.family || record.review.ref !== latest.review.ref) {
      throw new TypeError(
        `milestones: "chunk-green" for chunk "${chunkId}" must carry the exact "review" (family/ref) of the latest "chunk-review" record — got family=${JSON.stringify(record.review.family)}/ref=${JSON.stringify(record.review.ref)}, expected family=${JSON.stringify(latest.review.family)}/ref=${JSON.stringify(latest.review.ref)} — a green record cannot invent evidence no real review record ever carried`
      );
    }
    const startRecord = findChunkStartRecord(records, chunkId);
    if (!startRecord) {
      throw new TypeError(
        `milestones: "chunk-green" for chunk "${chunkId}" cannot cross-check reviewer family — no "chunk-start" record found`
      );
    }
    if (record.review.family === startRecord.implementer_family) {
      throw new TypeError(
        `milestones: "chunk-green" for chunk "${chunkId}" requires review.family ("${record.review.family}") to differ from the chunk's implementer_family ("${startRecord.implementer_family}") — cross-family review law`
      );
    }
    return;
  }

  // chunk-consult / chunk-journeys: side-channel records that never move the
  // lifecycle pointer, but still require the chunk to genuinely exist —
  // consulting on, or logging a journey against, a chunk with no brief yet
  // is a caller defect, not a valid state.
  if (!latest) {
    throw new TypeError(
      `milestones: "${record.kind}" for chunk "${chunkId}" requires a prior "chunk-spec" record — the chunk must exist first`
    );
  }
}

// Reads chunks.jsonl and fails closed on any parse error or common-header
// violation, rather than silently discarding the errors/headerViolations
// reports readRecords already returns. recordChunk applies this too —
// appending on top of a stream this module cannot trust to parse cleanly
// would let a corrupt tail silently continue accumulating rather than
// surfacing loud.
function readChunkRecordsOrThrow(chunksPath) {
  const { records, errors, headerViolations } = readRecords(chunksPath);
  if (errors.length > 0) {
    const detail = errors.map((e) => `line ${e.lineNo}: ${e.reason}`).join('; ');
    throw new Error(`milestones: ${chunksPath} has malformed record(s) — refusing to trust this stream: ${detail}`);
  }
  if (headerViolations.length > 0) {
    const detail = headerViolations.map((v) => `record[${v.index}]: ${v.errors.join(', ')}`).join('; ');
    throw new Error(`milestones: ${chunksPath} has record(s) violating the common JSONL header — refusing to trust this stream: ${detail}`);
  }
  return records;
}

// recordChunk(treeRoot, milestoneId, record) — appends one chunk-lifecycle
// record to milestones/<id>/chunks.jsonl. `record` carries `kind`/`chunk_id`
// plus the kind-specific fields assertChunkRecordShape checks; every field
// besides `kind` becomes payload (chunk_id doubles as the record's
// correlation_id, per the common-header sketch).
//
// Refuses (throws) when the milestone's index entry already reports status
// "green" — closeMilestone is the sole writer of that status, and a
// milestone it has already closed accepts no further chunk writes: a
// nominally "done" milestone's own evidence stream must never stay mutable.
function recordChunk(treeRoot, milestoneId, record) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('milestones: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(milestoneId)) {
    throw new TypeError('milestones: milestoneId must be a non-empty string');
  }
  if (!isPlainObject(record)) {
    throw new TypeError('milestones: record must be a plain object');
  }

  const chunksPath = chunksPathOf(treeRoot, milestoneId);
  if (!fs.existsSync(chunksPath)) {
    throw new Error(`milestones: no such milestone "${milestoneId}" — ${chunksPath} does not exist (createMilestone first)`);
  }

  const index = readIndex(treeRoot);
  const indexEntry = findIndexEntry(index, milestoneId);
  if (indexEntry && indexEntry.status === MILESTONE_STATUSES.GREEN) {
    throw new Error(`milestones: milestone "${milestoneId}" is already green — recordChunk refuses further writes`);
  }

  assertChunkRecordShape(record);

  const records = readChunkRecordsOrThrow(chunksPath);
  assertLifecycleAndCrossChecks(records, record);

  const { kind, chunk_id, ...rest } = record;
  const seq = appendRecord(chunksPath, { kind, payload: { chunk_id, ...rest }, correlation_id: chunk_id });
  return { chunksPath, seq };
}

// git rev-parse --verify <ref>, read-only — the sole git invocation this
// module makes, and only from closeMilestone (see the file-header comment).
// Returns false on any non-zero exit OR a spawn failure (missing git
// binary, non-existent cwd) — closeMilestone treats both identically as
// "could not verify," never distinguishing a real ref-not-found from an
// environment defect, since either way the ref is not confirmed present.
function verifyGitRef(repoRoot, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', ref], { cwd: repoRoot, encoding: 'utf8' });
  return result.error === undefined && result.status === 0;
}

// A bare 40(or 7-40)-hex-character string parses as a plausible SHA-1
// expression on its face, so plain `git rev-parse --verify <sha>` echoes it
// straight back WITHOUT checking the object actually exists in the
// database (git's own disambiguation shortcut for hex-shaped input).
// Appending `^{commit}` forces git to actually resolve and peel the object,
// which fails closed on a merge_sha nothing in the repo backs — the
// distinction a bare `--verify` on a raw SHA silently misses.
function verifyCommitExists(repoRoot, sha) {
  return verifyGitRef(repoRoot, `${sha}^{commit}`);
}

// closeMilestone(treeRoot, milestoneId, {tag, merge_sha, review_evidence},
// opts) — refuses (throws) unless every chunk this milestone has ever
// recorded currently sits at "chunk-green" as its MOST RECENT LIFECYCLE
// record (latest-by-seq among LIFECYCLE_KINDS, mirroring check-honesty.js's
// own "only the latest record counts" discipline) — a milestone with zero
// recorded chunks, or any chunk whose last lifecycle record is
// spec/start/review-not-yet-green, is not closeable.
//
// All three of {tag, merge_sha, review_evidence} are REQUIRED — a milestone
// can never report green before the required merge/tag actually exists,
// with no durable bridge left open. `tag` and `merge_sha` are cross-checked
// against the real git repository via read-only `git rev-parse --verify`
// (cwd = opts.repoRoot, defaulting to treeRoot/.. — the project root the
// .kiln tree sits inside) — a merge_sha or tag this call cannot verify
// refuses the close outright (fail closed). The one escape hatch is
// opts.skipGitVerify === true, which must be passed EXPLICITLY by the
// caller (an environment with no real git repository behind it, never
// production use) and always persists `verified: false` on the index entry
// rather than silently pretending verification ran.
//
// On success, flips the milestone's milestones/index.json entry to status
// "green" and records tag/merge_sha/review_evidence/verified alongside it —
// the facts phases.js's "milestones-all-green" exit check, and any later
// reader of "was this milestone's merge point real," read at the
// implementation -> verification boundary.
function closeMilestone(treeRoot, milestoneId, closeInfo, opts = {}) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('milestones: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(milestoneId)) {
    throw new TypeError('milestones: milestoneId must be a non-empty string');
  }
  if (!isPlainObject(closeInfo)) {
    throw new TypeError('milestones: closeMilestone requires a {tag, merge_sha, review_evidence} object');
  }
  if (!isNonEmptyString(closeInfo.tag)) {
    throw new TypeError('milestones: closeMilestone requires a non-empty "tag"');
  }
  if (!isNonEmptyString(closeInfo.merge_sha)) {
    throw new TypeError('milestones: closeMilestone requires a non-empty "merge_sha"');
  }
  if (!isNonEmptyString(closeInfo.review_evidence)) {
    throw new TypeError('milestones: closeMilestone requires a non-empty "review_evidence"');
  }

  const chunksPath = chunksPathOf(treeRoot, milestoneId);
  if (!fs.existsSync(chunksPath)) {
    throw new Error(`milestones: no such milestone "${milestoneId}" — ${chunksPath} does not exist`);
  }

  const records = readChunkRecordsOrThrow(chunksPath);
  const latestByChunk = new Map();
  for (const record of records) {
    if (!isPlainObject(record) || !LIFECYCLE_KINDS.includes(record.kind)) continue;
    const chunkId = record.chunk_id;
    if (!isNonEmptyString(chunkId)) continue;
    const prior = latestByChunk.get(chunkId);
    if (!prior || record.seq > prior.seq) latestByChunk.set(chunkId, record);
  }

  if (latestByChunk.size === 0) {
    throw new Error(`milestones: milestone "${milestoneId}" has no chunk records — nothing to close`);
  }

  const notGreen = [...latestByChunk.entries()].filter(([, record]) => record.kind !== 'chunk-green');
  if (notGreen.length > 0) {
    const names = notGreen.map(([chunkId, record]) => `${chunkId} (latest: ${record.kind})`).join(', ');
    throw new Error(`milestones: milestone "${milestoneId}" has non-green chunks: ${names}`);
  }

  let verified;
  if (opts.skipGitVerify === true) {
    verified = false;
  } else {
    const repoRoot = isNonEmptyString(opts.repoRoot) ? opts.repoRoot : path.join(treeRoot, '..');
    if (!verifyCommitExists(repoRoot, closeInfo.merge_sha)) {
      throw new Error(
        `milestones: closeMilestone could not verify merge_sha "${closeInfo.merge_sha}" in ${repoRoot} (git rev-parse --verify failed) — refusing to close`
      );
    }
    if (!verifyGitRef(repoRoot, `refs/tags/${closeInfo.tag}`)) {
      throw new Error(
        `milestones: closeMilestone could not verify tag "${closeInfo.tag}" in ${repoRoot} (git rev-parse --verify refs/tags/${closeInfo.tag} failed) — refusing to close`
      );
    }
    verified = true;
  }

  const indexPath = indexPathOf(treeRoot);
  const index = readIndex(treeRoot);
  if (!isPlainObject(index) || !Array.isArray(index.milestones)) {
    throw new Error(`milestones: ${indexPath} is not a well-formed index object`);
  }
  const entryIndex = index.milestones.findIndex((m) => isPlainObject(m) && m.id === milestoneId);
  if (entryIndex === -1) {
    throw new Error(`milestones: "${milestoneId}" is not present in ${indexPath}`);
  }

  const newMilestones = index.milestones.map((m, i) =>
    i === entryIndex
      ? {
          ...m,
          status: MILESTONE_STATUSES.GREEN,
          tag: closeInfo.tag,
          merge_sha: closeInfo.merge_sha,
          review_evidence: closeInfo.review_evidence,
          verified,
        }
      : m
  );
  writeAtomic(indexPath, { schema_version: INDEX_SCHEMA_VERSION, milestones: newMilestones });

  return {
    ok: true,
    milestoneId,
    chunkIds: [...latestByChunk.keys()],
    tag: closeInfo.tag,
    merge_sha: closeInfo.merge_sha,
    verified,
  };
}

function parseArgv(argv) {
  const [command, treeRoot, ...rest] = argv;
  const positional = [];
  let repoRoot;
  let skipGitVerify = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--repo-root') {
      repoRoot = rest[i + 1];
      i++;
    } else if (rest[i] === '--skip-git-verify') {
      skipGitVerify = true;
    } else {
      positional.push(rest[i]);
    }
  }
  return { command, treeRoot, positional, repoRoot, skipGitVerify };
}

function main(argv) {
  const { command, treeRoot, positional, repoRoot, skipGitVerify } = parseArgv(argv);
  if (!command || !treeRoot) {
    process.stderr.write(
      'usage: milestones.js create <treeRoot> <jsonEntry>\n' +
        '       milestones.js record-chunk <treeRoot> <milestoneId> <jsonRecord>\n' +
        '       milestones.js close <treeRoot> <milestoneId> <jsonCloseInfo> [--repo-root <path>] [--skip-git-verify]\n'
    );
    process.exit(1);
    return;
  }
  try {
    let result;
    if (command === 'create') {
      const [entryJson] = positional;
      if (!entryJson) throw new Error('create requires a JSON entry argument');
      result = createMilestone(treeRoot, JSON.parse(entryJson));
    } else if (command === 'record-chunk') {
      const [milestoneId, recordJson] = positional;
      if (!milestoneId || !recordJson) throw new Error('record-chunk requires <milestoneId> <jsonRecord>');
      result = recordChunk(treeRoot, milestoneId, JSON.parse(recordJson));
    } else if (command === 'close') {
      const [milestoneId, closeInfoJson] = positional;
      if (!milestoneId || !closeInfoJson) throw new Error('close requires <milestoneId> <jsonCloseInfo>');
      const opts = {};
      if (repoRoot) opts.repoRoot = repoRoot;
      if (skipGitVerify) opts.skipGitVerify = true;
      result = closeMilestone(treeRoot, milestoneId, JSON.parse(closeInfoJson), opts);
    } else {
      throw new Error(`unknown command "${command}" (expected create, record-chunk, or close)`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`milestones.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  createMilestone,
  recordChunk,
  closeMilestone,
  CHUNK_RECORD_KINDS,
  LIFECYCLE_KINDS,
  REVIEW_VERDICTS,
  MILESTONE_STATUSES,
};
