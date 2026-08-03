'use strict';

// architecture-txn.js — the architecture SET as one transaction.
//
// Today the five canonical architecture artifacts are written one file at a
// time, each atomically (atomic-json.js, atomic-text.js). Every individual
// write is safe and the SET is not: a session that dies partway through a
// revision leaves three files from the new plan and two from the old one,
// with nothing on disk saying so. Every later reader — the plan gate, the
// milestone designer, the implementation phase — sees a plausible,
// self-consistent-looking architecture that no author ever wrote.
//
// This module makes a revision the unit of change:
//
//   stageArtifacts   — the next revision is written whole, in its own directory
//   promoteStaged    — it becomes the live set, in ONE atomic write
//   reopenThroughTxn — a rejected revision is sealed and the phase reopened
//                      in a single call, with no gap between the two
//
// A REVISION IS A DIRECTORY AND THE MARKER IS A POINTER. Each revision is
// staged whole into `architecture/revisions/<n>/` and stays there, immutable,
// for the life of the tree. `architecture/revision.json` names which one is
// live. Promotion therefore copies nothing and overwrites nothing: it is a
// single `writeAtomic` of the marker, which is a temp-file write followed by
// one `rename`. There is no instant at which the live set is half of one
// revision and half of another, because there is no instant at which any
// artifact file is being written at all — the previous revision stays
// physically whole and readable in its own directory before, during, and
// after, and a crash at any point leaves the marker either wholly at the old
// revision or wholly at the new one.
//
// This is a deliberate departure from the chunk brief's "move into place",
// and the reason is that "move five files into place" has no atomic form:
// with the artifacts living at fixed paths, some sequence of copies is
// unavoidable, and every ordering of it has a window in which the live set is
// a mix. Refusing to READ during that window (an `in_flight` flag, the shape
// this module carried in its first draft) does not close it — it only asks
// every future reader to honor a flag, when the raw readers that already
// exist read the artifact paths directly. Making promotion a pointer flip
// removes the window instead of guarding it.
//
// `readCurrent` is the sanctioned read, and the whole consumer-resolution API
// this module offers: it resolves the marker, checks that the revision's
// manifest still declares exactly the canonical five and that their bytes
// still match, and returns the directory the live set lives in. Nothing
// consumes it yet — this layout is dormant beside the existing root-path
// readers until the slice that cuts them over, and it neither requires nor
// removes anything at the architecture root.
//
// ONE DUPLICATE THIS MODULE CANNOT AVOID. `phases.js#reopenPhase` is
// ledger-first: it appends its `phase-reopen` record and only then rewrites
// `state.json`. A crash between those two writes leaves a record for a reopen
// that never took effect, and the only sanctioned way to land the state
// transition is to call `reopenPhase` again — which appends a SECOND record
// with the same semantic identity and a new seq. This module does that
// deliberately, and treats the LAST matching record as the effective one.
// It is a constrained consequence of an existing writer's ordering, not a
// relaxation of the re-entry law: every durable artifact this module owns
// still replays exactly once. Making `reopenPhase` idempotent under its own
// reopen identity is the fix, and it belongs to whoever makes this path live.
//
// This module never writes a gate: `plan-gate.js#approveGate` is the sole
// producer of the manifest+gate pair for a SEALED architecture, and a
// promotion deliberately leaves any existing `gate.json` alone — a new
// revision invalidates the old gate, and check-honesty's own digest-chain
// check is what says so. Sealing the promoted revision is the caller's next
// step, not this transaction's business.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { withLock } = require('./jsonl.js');
const { writeAtomic, readJson } = require('./atomic-json.js');
const { writeAtomicText } = require('./atomic-text.js');
const { readRecords } = require('./stream.js');
const {
  writeManifest,
  verifyManifest,
  manifestArtifactsDigest,
  CANONICAL_ARCHITECTURE_ARTIFACTS,
  SHA256_DIGEST_RE,
} = require('./manifest.js');
const { reopenPhase } = require('./phases.js');

const SCHEMA_VERSION = 1;
const MARKER_FILENAME = 'revision.json';
const MANIFEST_FILENAME = 'manifest.json';
const REVISIONS_DIRNAME = 'revisions';
const REJECTED_DIRNAME = 'rejected';
const DEFAULT_REOPEN_TARGET = 'architecture';
const REOPEN_KIND = 'phase-reopen';
// withLock(file) creates and removes `<file>.lock`; the base path itself is
// never written, so this names a lock, not a file in the tree.
const TXN_LOCK_BASE = 'architecture-txn';

// Before anything is promoted the live set is at revision 0 — a number, not
// a special case, so "the next revision" is one expression everywhere.
const NO_REVISION = 0;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------- the layout, which is this module's contract ----------

function markerPathOf(archDir) {
  return path.join(archDir, MARKER_FILENAME);
}

function revisionDirOf(archDir, revision) {
  return path.join(archDir, REVISIONS_DIRNAME, String(revision));
}

// A rejected revision is sealed at a path derived from its own digest, so a
// replay writes the same file: identical content is a no-op, a conflicting
// rejection of the same digest fails closed.
function sealPathOf(archDir, rejectedDigest) {
  return path.join(archDir, REJECTED_DIRNAME, `${rejectedDigest.slice('sha256:'.length)}.json`);
}

function digestOfFile(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function requireArchDir(archDir) {
  if (!isNonEmptyString(archDir)) {
    throw new TypeError('architecture-txn: archDir must be a non-empty string');
  }
}

// ---------- the marker ----------

// A marker that exists but does not hold its own shape is corruption, not a
// default. Reading it as revision 0 would silently hand the next staging call
// revision 1 — a live, already-promoted revision directory — and turn a
// damaged tree into an overwritten one. Absent is a legitimate state (nothing
// promoted yet); malformed never is.
function assertMarkerShape(marker, markerPath) {
  if (!isPlainObject(marker)) {
    throw new Error(
      `architecture-txn: the marker at ${markerPath} is not a JSON object — refusing to guess which revision is live`
    );
  }
  if (marker.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `architecture-txn: the marker at ${markerPath} declares schema_version ${JSON.stringify(marker.schema_version)}, expected ${SCHEMA_VERSION}`
    );
  }
  if (!Number.isInteger(marker.revision) || marker.revision < 1) {
    throw new Error(
      `architecture-txn: the marker at ${markerPath} names revision ${JSON.stringify(marker.revision)}, which is not a promoted revision number`
    );
  }
  if (typeof marker.manifest_digest !== 'string' || !SHA256_DIGEST_RE.test(marker.manifest_digest)) {
    throw new Error(
      `architecture-txn: the marker at ${markerPath} carries no sha256 manifest_digest — the promoted revision cannot be bound to its content`
    );
  }
}

function readMarker(archDir) {
  const markerPath = markerPathOf(archDir);
  const marker = readJson(markerPath, null);
  if (marker === null && !fs.existsSync(markerPath)) {
    return null;
  }
  assertMarkerShape(marker, markerPath);
  return marker;
}

function revisionOf(marker) {
  return marker === null ? NO_REVISION : marker.revision;
}

// ---------- staging ----------

// The bytes each artifact will occupy on disk, serialized exactly the way
// the writers below serialize them — so "is this already staged?" is a byte
// comparison against what a write would produce, never a guess.
function intendedBytes(files) {
  if (!isPlainObject(files)) {
    throw new TypeError('architecture-txn: stageArtifacts requires an object of artifact contents');
  }
  const declared = Object.keys(files).sort();
  const canonical = [...CANONICAL_ARCHITECTURE_ARTIFACTS].sort();
  if (declared.length !== canonical.length || !declared.every((name, i) => name === canonical[i])) {
    throw new Error(
      `architecture-txn: stageArtifacts requires exactly the five canonical architecture artifacts (${canonical.join(', ')}) — got: ${declared.join(', ') || '(empty)'}`
    );
  }

  const bytes = new Map();
  for (const relPath of CANONICAL_ARCHITECTURE_ARTIFACTS) {
    const content = files[relPath];
    if (relPath.endsWith('.json')) {
      if (!isPlainObject(content)) {
        throw new TypeError(`architecture-txn: "${relPath}" must be a plain object`);
      }
      bytes.set(relPath, JSON.stringify(content, null, 2));
    } else {
      if (!isNonEmptyString(content)) {
        throw new TypeError(`architecture-txn: "${relPath}" must be a non-empty string`);
      }
      bytes.set(relPath, content);
    }
  }
  return bytes;
}

// Which artifact already on disk disagrees with the payload being staged, or
// null if none does. Staging writes six files in sequence, so a crash leaves
// some prefix of them: the ones that landed are the evidence of what was
// being staged, and every one of them matching means this is the SAME staging
// resuming, not a different payload arriving. One that differs means a
// conflicting payload, which is refused.
function conflictingArtifact(revisionDir, bytes) {
  for (const [relPath, expected] of bytes) {
    const abs = path.join(revisionDir, relPath);
    if (!fs.existsSync(abs)) continue;
    if (fs.readFileSync(abs, 'utf8') !== expected) return relPath;
  }
  return null;
}

// stageArtifacts(archDir, files) — write the next revision whole, into its own
// directory and never over the live one. `files` maps each canonical artifact
// to its content: a plain object for the three JSON artifacts, prose for the
// two markdown ones.
//
// Staging obeys the re-entry law exactly as promotion does, in all three of
// its states. Staging the SAME content over a complete revision returns the
// existing receipt and writes nothing. Staging the same content over a
// revision a crash left half-written RESUMES it — writing only the artifacts
// that never landed, then the manifest — because six sequential durable
// writes have five interior crash points and a staging that could not be
// finished would be a revision number permanently unusable through the API.
// Staging DIFFERENT content for a revision that already has any artifact on
// disk fails closed: the header law does not exempt staging, and a revision
// directory is durable state a manifest digest or another reader may already
// be pointed at. Revising a draft means removing the staged revision
// deliberately, not having it replaced underneath.
//
// The manifest is written LAST, so a crash mid-staging leaves a revision
// directory its own manifest does not verify — which `promoteStaged` refuses
// — rather than a manifest vouching for files that were never finished.
function stageArtifacts(archDir, files) {
  requireArchDir(archDir);
  const bytes = intendedBytes(files);

  return withLock(path.join(archDir, TXN_LOCK_BASE), () => {
    const revision = revisionOf(readMarker(archDir)) + 1;
    const revisionDir = revisionDirOf(archDir, revision);
    const manifestPath = path.join(revisionDir, MANIFEST_FILENAME);

    if (fs.existsSync(revisionDir)) {
      const conflict = conflictingArtifact(revisionDir, bytes);
      if (conflict !== null) {
        throw new Error(
          `architecture-txn: revision ${revision} is already staged at ${revisionDir} with different content (${conflict} differs) — refusing to replace a staged revision; remove it deliberately to restage`
        );
      }
      // No separate "are all five here?" check: a manifest that declares the
      // canonical set and verifies is itself the proof that every one of them
      // is present and intact. A manifest that does not is derived data gone
      // wrong over artifacts that are fine, and gets rebuilt below.
      const existing = readJson(manifestPath, null);
      if (manifestProvesComplete(revisionDir, existing)) {
        return stageReceipt(revision, revisionDir, existing, manifestPath);
      }
    }

    // Whatever is already here matches, so only the gap is written.
    for (const [relPath, content] of bytes) {
      const abs = path.join(revisionDir, relPath);
      if (fs.existsSync(abs)) continue;
      if (relPath.endsWith('.json')) {
        writeAtomic(abs, files[relPath]);
      } else {
        writeAtomicText(abs, content);
      }
    }
    const manifest = writeManifest(revisionDir, CANONICAL_ARCHITECTURE_ARTIFACTS, manifestPath, revision);
    return stageReceipt(revision, revisionDir, manifest, manifestPath);
  });
}

// The receipt carries the digest a promotion must cite. It is the digest over
// the manifest's `artifacts[]` ALONE (manifest.js#manifestArtifactsDigest) —
// deliberately not the manifest file's bytes, which carry a `created_at` a
// resumed staging legitimately changes. Binding the payload rather than the
// timestamp is what lets a caller hold a stage receipt across a crash and
// still promote exactly what it staged.
function stageReceipt(revision, revisionDir, manifest, manifestPath) {
  return {
    revision,
    revisionDir,
    manifest,
    artifacts_digest: manifestArtifactsDigest(manifest),
    manifest_file_digest: digestOfFile(manifestPath),
  };
}

// ---------- promotion ----------

// verifyManifest checks only the entries a manifest DECLARES — it never scans
// the directory for what else is there. On its own that leaves a manifest
// free to drop an artifact entry entirely and still verify clean, so a shrunk
// or substituted manifest would promote as a complete revision. The declared
// set is therefore checked against the canonical five by name, before its
// digests are checked against disk.
function declaredPathsOf(manifest) {
  return manifest.artifacts.map((entry) => (isPlainObject(entry) ? entry.path : null)).sort();
}

function declaresCanonicalSet(manifest) {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.artifacts)) return false;
  const declared = declaredPathsOf(manifest);
  const canonical = [...CANONICAL_ARCHITECTURE_ARTIFACTS].sort();
  return declared.length === canonical.length && declared.every((name, i) => name === canonical[i]);
}

// A manifest is only evidence that a revision is COMPLETE if it declares the
// whole set and then verifies. Either half alone proves nothing: verification
// covers only what is declared, and a declaration proves nothing about bytes.
function manifestProvesComplete(revisionDir, manifest) {
  return manifest !== null && declaresCanonicalSet(manifest) && verifyManifest(revisionDir, manifest).ok;
}

function assertDeclaresCanonicalSet(manifest, label) {
  if (!declaresCanonicalSet(manifest)) {
    throw new Error(
      `architecture-txn: ${label} declares ${JSON.stringify(declaredPathsOf(manifest))}, not the five canonical architecture artifacts — refusing to treat a shrunk or substituted manifest as a complete revision`
    );
  }
}

// A revision is promotable only if all five artifacts are there and its own
// manifest still declares exactly them and describes them exactly. Every
// failure is a refusal, not a repair: a revision that drifted from its
// manifest is either a half-finished staging or a tampered one, and neither
// is something to promote on a guess about which.
function requireVerifiedRevision(archDir, revision) {
  const revisionDir = revisionDirOf(archDir, revision);
  for (const relPath of CANONICAL_ARCHITECTURE_ARTIFACTS) {
    if (!fs.existsSync(path.join(revisionDir, relPath))) {
      throw new Error(`architecture-txn: revision ${revision} is incomplete — missing ${relPath}`);
    }
  }
  const manifestPath = path.join(revisionDir, MANIFEST_FILENAME);
  const manifest = readJson(manifestPath, null);
  if (manifest === null) {
    throw new Error(`architecture-txn: revision ${revision} is incomplete — missing ${MANIFEST_FILENAME}`);
  }
  if (!isPlainObject(manifest) || !Array.isArray(manifest.artifacts)) {
    throw new Error(`architecture-txn: the manifest for revision ${revision} is not a manifest object`);
  }
  assertDeclaresCanonicalSet(manifest, `the manifest for revision ${revision}`);
  const { ok, drift } = verifyManifest(revisionDir, manifest);
  if (!ok) {
    const detail = drift.map((entry) => `${entry.file}: ${entry.reason}`).join('; ');
    throw new Error(
      `architecture-txn: revision ${revision} does not match its own manifest (${detail}) — refusing to promote a tampered revision`
    );
  }
  return { revisionDir, manifest, manifestPath };
}

// promoteStaged(archDir, revision, expectedArtifactsDigest) — the staged
// revision becomes the live set. Promotion is a single atomic marker write, so
// it has no internal steps to crash between: the marker is either the old
// revision or the new one, and both name a directory that is whole.
//
// A revision NUMBER is not an instruction. Between staging and promotion —
// and across a crash in between — a revision directory and its manifest can be
// replaced together, consistently, and would then verify perfectly against
// themselves. So the caller cites the payload it staged, by the digest its
// stage receipt handed back, and promotion refuses anything else: what goes
// live is what was authored, not merely whatever now occupies the slot.
//
// A re-call for the already-promoted revision compares that same full input,
// and additionally that the manifest file on disk is still the one the marker
// recorded at promotion. Returning a receipt for a revision whose bytes have
// since been swapped would vouch for content that never went live.
function promoteStaged(archDir, revision, expectedArtifactsDigest) {
  requireArchDir(archDir);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new TypeError(
      `architecture-txn: promoteStaged requires an integer revision >= 1 (got ${JSON.stringify(revision)})`
    );
  }
  if (typeof expectedArtifactsDigest !== 'string' || !SHA256_DIGEST_RE.test(expectedArtifactsDigest)) {
    throw new TypeError(
      `architecture-txn: promoteStaged requires the "artifacts_digest" from the stage receipt, of the form sha256:<64 hex> (got ${JSON.stringify(expectedArtifactsDigest)})`
    );
  }

  return withLock(path.join(archDir, TXN_LOCK_BASE), () => {
    const marker = readMarker(archDir);
    const current = revisionOf(marker);

    if (revision === current) {
      const { manifest, manifestPath } = requireVerifiedRevision(archDir, revision);
      requireIntendedPayload(revision, manifest, expectedArtifactsDigest);
      if (marker.manifest_digest !== digestOfFile(manifestPath)) {
        throw new Error(
          `architecture-txn: revision ${revision} is already promoted from different content than the revision now on disk — refusing to vouch for content that never went live`
        );
      }
      return readCurrent(archDir);
    }
    if (revision < current) {
      throw new Error(
        `architecture-txn: revision ${revision} is already superseded (the marker is at ${current}) — refusing to promote a stale revision`
      );
    }
    if (revision !== current + 1) {
      throw new Error(
        `architecture-txn: revision ${revision} is not the next revision after ${current} — revisions promote in order`
      );
    }

    const { manifest, manifestPath } = requireVerifiedRevision(archDir, revision);
    requireIntendedPayload(revision, manifest, expectedArtifactsDigest);

    // The whole promotion: one atomic write, binding the revision to the
    // exact manifest bytes that were verified a line above.
    writeAtomic(markerPathOf(archDir), {
      schema_version: SCHEMA_VERSION,
      revision,
      manifest_digest: digestOfFile(manifestPath),
      promoted_at: new Date().toISOString(),
    });

    return readCurrent(archDir);
  });
}

function requireIntendedPayload(revision, manifest, expectedArtifactsDigest) {
  const actual = manifestArtifactsDigest(manifest);
  if (actual !== expectedArtifactsDigest) {
    throw new Error(
      `architecture-txn: revision ${revision} on disk carries artifacts digest ${actual}, not the ${expectedArtifactsDigest} this promotion was asked to make live — refusing to promote a payload other than the one staged`
    );
  }
}

// readCurrent(archDir) — the sanctioned read of the live architecture set,
// and the receipt promotion returns. Answers only when the marker names a
// promoted revision whose manifest is still the one that was promoted and
// still describes its own bytes exactly.
//
// It deliberately does NOT require manifest.json's own `revision` field to
// equal the marker's: that field belongs to whoever last sealed the set
// (plan-gate.js#approveGate rebuilds the manifest at gate time), and this
// module will not turn another module's default into a fatal read error.
// What it does enforce is the part that decides whether the set is coherent:
// the declared set, the declared digests, and the binding to what went live.
function readCurrent(archDir) {
  requireArchDir(archDir);
  const marker = readMarker(archDir);
  const revision = revisionOf(marker);
  if (revision < 1) {
    throw new Error(`architecture-txn: no promoted revision in ${archDir} — nothing to read`);
  }

  const { revisionDir, manifest, manifestPath } = requireVerifiedRevision(archDir, revision);
  if (marker.manifest_digest !== digestOfFile(manifestPath)) {
    throw new Error(
      `architecture-txn: the live revision ${revision} no longer carries the manifest it was promoted with — the promoted content has been replaced`
    );
  }

  return { revision, revisionDir, manifest, marker };
}

// ---------- reject and reopen ----------

// Fails closed on a ledger it cannot fully parse: deciding "this reopen never
// happened" from a stream that did not fully read is exactly how a second
// reopen gets appended over the first.
function readLedgerOrThrow(ledgerPath) {
  const { records, errors, headerViolations } = readRecords(ledgerPath);
  if (errors.length > 0) {
    const detail = errors.map((e) => `line ${e.lineNo}: ${e.reason}`).join('; ');
    throw new Error(`architecture-txn: ${ledgerPath} has malformed record(s) — refusing to trust this stream: ${detail}`);
  }
  if (headerViolations.length > 0) {
    const detail = headerViolations.map((v) => `record[${v.index}]: ${v.errors.join(', ')}`).join('; ');
    throw new Error(
      `architecture-txn: ${ledgerPath} has record(s) violating the common JSONL header — refusing to trust this stream: ${detail}`
    );
  }
  return records;
}

// phases.js owns the reopen record's shape — {from, to, rationale} — and this
// module calls it rather than editing it, so the only field available to
// carry an identity is the rationale. Matching on the operator's prose alone
// does not identify THIS rejection: prose repeats, and a recurrence of the
// same objection gets described in the same words precisely when it matters,
// so a later rejection would adopt an earlier one's record and skip its own
// reopen. Composing the digest into the recorded rationale makes the ledger
// record self-identifying — exactly one rejection can own it — and has the
// side benefit of making the ledger say WHICH architecture was rejected,
// which a reader of a reopen record could not otherwise tell. The operator's
// own words are preserved verbatim on the seal.
function composeRationale(rationale, rejectedDigest) {
  return `${rationale} [kiln-rejected ${rejectedDigest}]`;
}

// A reopen is identified by the whole transition it records, source phase
// included. Matching on target and rationale alone would let a reopen out of
// some OTHER phase — one that shares this rejection's target and prose —
// finalize a seal as though it were the reopen that seal is owed.
function matchingReopenRecords(ledgerPath, fromPhaseId, targetPhaseId, composedRationale) {
  return readLedgerOrThrow(ledgerPath).filter(
    (record) =>
      record.kind === REOPEN_KIND &&
      record.from === fromPhaseId &&
      record.to === targetPhaseId &&
      record.rationale === composedRationale
  );
}

// The postcondition reopenPhase establishes, judged from the transaction's
// own state snapshot. phases.js is ledger-first by design: it appends the
// reopen record and only then rewrites state.json, so a crash between those
// two durable writes leaves a record for a reopen that never took effect. The
// record is therefore evidence that the reopen was ATTEMPTED, never that it
// landed — only state.json says that.
function phaseIsReopened(snapshot, targetPhaseId) {
  if (snapshot.state === null) return false;
  const phaseStatus = isPlainObject(snapshot.state.phase_status) ? snapshot.state.phase_status : {};
  return snapshot.state.phase === targetPhaseId && phaseStatus[targetPhaseId] !== 'complete';
}

// The cheap precondition, asked BEFORE the first mutation, covering every way
// reopenPhase itself refuses: an unknown current or target phase, a target
// that is not strictly earlier than the current phase, and a target that was
// never completed. phases.js remains the authority — it re-checks all three
// under its own state lock and is what actually refuses — but asking here is
// what keeps a refusal from leaving a sealed rejection behind for a reopen
// that could never land. (The C2 ruling: a pre-scan that transfers no
// ownership of the law is not the duplication rule 6 forbids.)
// Returns null when a reopen is currently applicable, or the reason it is
// not. Separated from the throwing form because recovery has to ASK the
// question without treating the answer as fatal: a blocked precondition on a
// fresh call is a refusal, while a blocked precondition against a seal whose
// context no longer holds is a terminal outcome to be recorded.
function reopenBlocker(registry, snapshot, statePath, targetPhaseId) {
  const state = snapshot.state;
  if (state === null) {
    return `no readable state.json at ${statePath} — nothing to reopen`;
  }
  const phases = Array.isArray(registry.phases) ? registry.phases : [];
  const target = phases.find((phase) => isPlainObject(phase) && phase.id === targetPhaseId);
  if (target === undefined) {
    return `no phase "${targetPhaseId}" in the registry — nothing to reopen`;
  }
  const currentId = state.phase;
  const current = phases.find((phase) => isPlainObject(phase) && phase.id === currentId);
  if (current === undefined) {
    return `state.json is at phase ${JSON.stringify(currentId)}, which the registry does not define — nothing to reopen`;
  }
  if (target.order >= current.order) {
    return `phase "${targetPhaseId}" (order ${target.order}) is not strictly earlier than the current phase "${currentId}" (order ${current.order}) — nothing to reopen`;
  }
  const phaseStatus = isPlainObject(state.phase_status) ? state.phase_status : {};
  if (phaseStatus[targetPhaseId] !== 'complete') {
    return `phase "${targetPhaseId}" is not complete in ${statePath} — nothing to reopen, and refusing to seal a rejection whose reopen cannot land`;
  }
  return null;
}

function requireReopenable(registry, snapshot, statePath, targetPhaseId) {
  const blocker = reopenBlocker(registry, snapshot, statePath, targetPhaseId);
  if (blocker !== null) {
    throw new Error(`architecture-txn: ${blocker}`);
  }
}

// ONE read of state.json, parsed and digested from the SAME bytes. Every
// question this transaction asks about "the state" is asked of this object,
// because a precheck that approves one read while the context binds another
// authorizes a reopen against a state nothing ever checked — and the two
// disagreeing is not a hypothetical: state.json has other writers, and the
// gap between two reads is exactly where one of them lands.
function readStateSnapshot(statePath) {
  let raw;
  try {
    raw = fs.readFileSync(statePath);
  } catch (err) {
    if (err.code === 'ENOENT') return { state: null, digest: null };
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    throw new Error(`architecture-txn: failed to parse JSON at ${statePath}: ${err.message}`);
  }
  return {
    state: isPlainObject(parsed) ? parsed : null,
    digest: `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`,
  };
}

// The state a successful precheck observed, recorded on the pending seal so a
// successor can tell whether the reopen it inherited is still the reopen that
// was authorized. Without it, recovery can only ask "is a reopen possible
// now?", which is a different question from "is the reopen this rejection
// sealed still the one that applies?" — and answering the first when you meant
// the second is how a stale rejection rewinds a tree that has moved on.
//
// Pure over the snapshot: it binds the very bytes the precheck passed on.
function reopenContextOf(snapshot, targetPhaseId) {
  return {
    from_phase: snapshot.state.phase,
    to_phase: targetPhaseId,
    state_digest: snapshot.digest,
  };
}

// Why the sealed context can no longer be authoritatively applied, or null if
// it still can. "No longer applicable" is scoped to THIS seal's context — it
// does not claim a reopen could never succeed again in some later state.
function sealedContextBlocker(seal, registry, snapshot, statePath, targetPhaseId) {
  const context = seal.context;
  if (context.to_phase !== targetPhaseId) {
    throw new Error(
      `architecture-txn: the seal at this digest was sealed to reopen "${context.to_phase}", but this call targets "${targetPhaseId}" — refusing to apply a sealed rejection to a different phase`
    );
  }
  if (snapshot.digest === null) {
    return `state.json at ${statePath} is gone since the rejection was sealed — the sealed reopen context can no longer be applied`;
  }
  if (snapshot.digest !== context.state_digest) {
    return `state.json has changed since the rejection was sealed (was ${context.state_digest}, now ${snapshot.digest}) — the sealed reopen from "${context.from_phase}" can no longer be authoritatively applied`;
  }
  return reopenBlocker(registry, snapshot, statePath, targetPhaseId);
}

// F9's binding: a seal claiming a completed reopen is authoritative only once
// the record it names is shown to exist and to be the record it describes. An
// unbacked `reopen` object would otherwise short-circuit the whole transaction
// on nothing but its own say-so.
function requireReopenRecordBinds(ledgerPath, seal, composedRationale, targetPhaseId) {
  const { from, to, seq } = seal.reopen;
  if (to !== targetPhaseId) {
    throw new Error(
      `architecture-txn: the seal records a reopen to "${to}", but this call targets "${targetPhaseId}"`
    );
  }
  const record = readLedgerOrThrow(ledgerPath).find((entry) => entry.seq === seq);
  if (record === undefined) {
    throw new Error(
      `architecture-txn: the seal records a reopen at seq ${seq}, which is not in ${ledgerPath} — refusing to treat an unbacked seal as complete`
    );
  }
  if (
    record.kind !== REOPEN_KIND ||
    record.to !== to ||
    record.from !== from ||
    record.rationale !== composedRationale
  ) {
    throw new Error(
      `architecture-txn: the record at seq ${seq} in ${ledgerPath} is not the ${REOPEN_KIND} this seal claims (${JSON.stringify({ from, to })}) — refusing to treat a mismatched seal as complete`
    );
  }
}

// A seal found at the digest-derived path is durable state this transaction is
// about to adopt as its own prior work, so every field it will be trusted for
// is checked — not just the rationale. The path carries the intended identity;
// it does not vouch for the record stored there.
function assertSealShape(seal, sealPath, rejectedDigest, rationale) {
  if (!isPlainObject(seal)) {
    throw new Error(`architecture-txn: the seal at ${sealPath} is not a JSON object`);
  }
  if (seal.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `architecture-txn: the seal at ${sealPath} declares schema_version ${JSON.stringify(seal.schema_version)}, expected ${SCHEMA_VERSION}`
    );
  }
  if (seal.rejected_digest !== rejectedDigest) {
    throw new Error(
      `architecture-txn: the seal at ${sealPath} records rejected_digest ${JSON.stringify(seal.rejected_digest)}, not ${rejectedDigest} — refusing to adopt a seal for a different rejection`
    );
  }
  if (seal.rationale !== rationale) {
    throw new Error(
      `architecture-txn: rejected digest ${rejectedDigest} is already sealed with a different rationale (${JSON.stringify(seal.rationale)}) — a fresh rejection is a fresh digest`
    );
  }
  if (!Number.isInteger(seal.revision) || seal.revision < 0) {
    throw new Error(
      `architecture-txn: the seal at ${sealPath} records revision ${JSON.stringify(seal.revision)}, which is not a revision number`
    );
  }
  if (typeof seal.rejected_at !== 'string' || seal.rejected_at === '') {
    throw new Error(`architecture-txn: the seal at ${sealPath} carries no rejected_at timestamp`);
  }
  if (
    !isPlainObject(seal.context) ||
    !isNonEmptyString(seal.context.to_phase) ||
    !isNonEmptyString(seal.context.from_phase) ||
    typeof seal.context.state_digest !== 'string' ||
    !SHA256_DIGEST_RE.test(seal.context.state_digest)
  ) {
    throw new Error(
      `architecture-txn: the seal at ${sealPath} carries no readable reopen context {from_phase, to_phase, state_digest} — a successor cannot tell whether the reopen it inherited still applies`
    );
  }
  if (seal.reopen !== null) {
    if (
      !isPlainObject(seal.reopen) ||
      !isNonEmptyString(seal.reopen.from) ||
      !isNonEmptyString(seal.reopen.to) ||
      !Number.isInteger(seal.reopen.seq) ||
      seal.reopen.seq < 0
    ) {
      throw new Error(
        `architecture-txn: the seal at ${sealPath} records a reopen that is not a {from, to, seq} record reference — refusing to adopt an unreadable completion state`
      );
    }
  }
  if (seal.refused !== null) {
    if (!isPlainObject(seal.refused) || !isNonEmptyString(seal.refused.reason)) {
      throw new Error(
        `architecture-txn: the seal at ${sealPath} records a refusal with no reason — refusing to adopt an unreadable terminal state`
      );
    }
    if (seal.reopen !== null) {
      throw new Error(
        `architecture-txn: the seal at ${sealPath} records both a completed reopen and a refusal — refusing to adopt a contradictory terminal state`
      );
    }
  }
}

// reopenThroughTxn(archDir, {rationale, rejected_digest}, opts) — a rejected
// architecture revision is sealed and the phase reopened in ONE call. Today
// those are two commands with a gap between them, and a session that dies in
// the gap leaves either a rejection nothing acted on or a reopened phase with
// no record of what was rejected or why.
//
// The seal is the whole state machine, and every transition is one atomic
// write of it. `reopen: null, refused: null` is PENDING — the rejection is
// recorded and the reopen is still owed. `reopen` filled is COMPLETE.
// `refused` filled is CLOSED UNFINISHED — the reopen was found permanently
// inapplicable to the context this rejection was sealed against, which is a
// terminal answer a re-entry reproduces rather than re-decides.
//
// A pending seal carries the reopen CONTEXT its precheck observed — source
// phase, target phase, and a digest of the state it checked — because
// recovery must answer "does the reopen this rejection authorized still
// apply?", which is not the same question as "is some reopen possible now?".
// Recovery therefore resolves in this order: if a matching record exists AND
// state.json shows the transition landed, finalize from that record; else if
// the sealed context still holds and the preconditions are still true, call
// reopenPhase and finalize from the effective record; else close the seal
// with a durable refusal. A transient failure — a lock timeout, an I/O
// error — leaves the seal pending and is never converted into a refusal.
//
// Landing is judged from state.json, never from the presence of a ledger
// record, because phases.js appends that record before it rewrites state.
//
// opts: {registry (required — phases.js's own loaded registry), statePath =
// <treeRoot>/state.json, ledgerPath = <treeRoot>/ledger.jsonl,
// targetPhaseId = "architecture"}.
function reopenThroughTxn(archDir, rejectInfo, opts = {}) {
  requireArchDir(archDir);
  if (!isPlainObject(rejectInfo)) {
    throw new TypeError('architecture-txn: reopenThroughTxn requires a {rationale, rejected_digest} object');
  }
  const { rationale, rejected_digest: rejectedDigest } = rejectInfo;
  if (!isNonEmptyString(rationale)) {
    throw new TypeError('architecture-txn: reopenThroughTxn requires a non-empty "rationale"');
  }
  if (typeof rejectedDigest !== 'string' || !SHA256_DIGEST_RE.test(rejectedDigest)) {
    throw new TypeError(
      `architecture-txn: reopenThroughTxn requires a "rejected_digest" of the form sha256:<64 hex> (got ${JSON.stringify(rejectedDigest)})`
    );
  }
  if (!isPlainObject(opts.registry)) {
    throw new TypeError('architecture-txn: reopenThroughTxn requires opts.registry (a loaded phases registry)');
  }

  const treeRoot = path.dirname(archDir);
  const statePath = isNonEmptyString(opts.statePath) ? opts.statePath : path.join(treeRoot, 'state.json');
  const ledgerPath = isNonEmptyString(opts.ledgerPath) ? opts.ledgerPath : path.join(treeRoot, 'ledger.jsonl');
  const targetPhaseId = isNonEmptyString(opts.targetPhaseId) ? opts.targetPhaseId : DEFAULT_REOPEN_TARGET;
  const sealPath = sealPathOf(archDir, rejectedDigest);
  const composedRationale = composeRationale(rationale, rejectedDigest);

  return withLock(path.join(archDir, TXN_LOCK_BASE), () => {
    // The one read. The precheck evaluates on it, the seal binds it, and the
    // landed-check judges by it — so all three describe the same state.
    const snapshot = readStateSnapshot(statePath);
    let seal = readJson(sealPath, null);
    if (seal !== null) {
      assertSealShape(seal, sealPath, rejectedDigest, rationale);

      if (seal.refused !== null) {
        // Terminal, and reproduced rather than re-decided: the reopen was
        // found permanently inapplicable to this seal's context, and asking
        // the question again against a LATER state is exactly the mistake
        // that refusal exists to prevent.
        throw new Error(
          `architecture-txn: this rejection was closed unfinished at ${seal.refused.refused_at} and cannot be resumed — ${seal.refused.reason}`
        );
      }
      if (seal.reopen !== null) {
        // The transaction's own completion record — authoritative only once
        // the ledger record it names is shown to back it.
        requireReopenRecordBinds(ledgerPath, seal, composedRationale, targetPhaseId);
        return { rejected_digest: rejectedDigest, sealPath, seal };
      }
    } else {
      // Nothing has been written yet, so this refusal costs the tree nothing.
      requireReopenable(opts.registry, snapshot, statePath, targetPhaseId);
      seal = {
        schema_version: SCHEMA_VERSION,
        revision: revisionOf(readMarker(archDir)),
        rejected_digest: rejectedDigest,
        rationale,
        rejected_at: new Date().toISOString(),
        context: reopenContextOf(snapshot, targetPhaseId),
        reopen: null,
        refused: null,
      };
      // Seal first, then reopen — the same ledger-first ordering phases.js
      // itself keeps: a failure after this point leaves a rejection that
      // honestly says its reopen has not landed, never a reopened phase with
      // no record of what was rejected or why.
      writeAtomic(sealPath, seal);
    }

    // The seal is pending. Four outcomes, in order. The reopen it is owed is
    // the one out of the phase it bound, so that is what is looked for.
    const fromPhaseId = seal.context.from_phase;
    const landed =
      matchingReopenRecords(ledgerPath, fromPhaseId, targetPhaseId, composedRationale).length > 0 &&
      phaseIsReopened(snapshot, targetPhaseId);

    if (!landed) {
      const blocker = sealedContextBlocker(seal, opts.registry, snapshot, statePath, targetPhaseId);
      if (blocker !== null) {
        // The sealed context is gone. Close THIS seal with a durable refusal
        // rather than leaving a pending rejection that every future re-entry
        // would re-evaluate against whatever state it happens to find.
        seal = { ...seal, refused: { reason: blocker, refused_at: new Date().toISOString() } };
        writeAtomic(sealPath, seal);
        throw new Error(
          `architecture-txn: this rejection cannot be finished — ${blocker}; it is now closed unfinished at ${sealPath}`
        );
      }
      // Anything that throws from here — a lock timeout, an I/O failure,
      // phases.js refusing under its own lock — leaves the seal PENDING, not
      // refused: a transient failure is not a verdict.
      reopenPhase(treeRoot, opts.registry, statePath, ledgerPath, targetPhaseId, {
        rationale: composedRationale,
      });
    }

    const records = matchingReopenRecords(ledgerPath, fromPhaseId, targetPhaseId, composedRationale);
    if (records.length === 0) {
      throw new Error(
        `architecture-txn: phase "${targetPhaseId}" was reopened but no matching ${REOPEN_KIND} record from "${fromPhaseId}" appeared in ${ledgerPath} — refusing to return a receipt no record backs`
      );
    }
    // The last matching record is the one whose state transition landed: a
    // recovery from the ledger-appended/state-not-rewritten crash appends a
    // second record (see the header), and the effective reopen is the one
    // that finished.
    const effective = records[records.length - 1];

    seal = { ...seal, reopen: { from: effective.from, to: effective.to, seq: effective.seq } };
    writeAtomic(sealPath, seal);
    return { rejected_digest: rejectedDigest, sealPath, seal: readJson(sealPath, null) };
  });
}

module.exports = {
  stageArtifacts,
  promoteStaged,
  readCurrent,
  reopenThroughTxn,
  revisionDirOf,
  markerPathOf,
};
