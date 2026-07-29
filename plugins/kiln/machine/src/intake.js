'use strict';

// Legacy intake — the archive half of the intake transaction (legacy-intake
// design §2, as amended by §9.1). INTAKE never transplants: it recognizes a
// prior Kiln-shaped tree, sets it aside WHOLE, scaffolds a fresh current tree
// in its place, and files the set-aside tree at `<tree>/archive/legacy-N`.
//
// Three invariants bind every line below:
//
//   1. Nothing in a legacy tree is ever deleted or rewritten. Every move is
//      a same-filesystem `renameSync` — a directory-entry move that does not
//      walk the tree, so contents, permissions, mtimes, and nested symlinks
//      travel untouched. There is no copy, no read, and no unlink anywhere in
//      this module's mutation path.
//   2. `scaffoldTree` is NEVER called with `opts.force`. Force does `rmSync`
//      on the whole tree (scaffold.js:96-97) and would destroy exactly what
//      intake exists to preserve. A scaffold refusal after a successful
//      set-aside is a STOP naming the set-aside path, never a retry.
//   3. No earned state is fabricated. The archive half writes exactly two
//      things: the transaction's own `txn.json`, and a plain greenfield
//      genesis tree via `scaffoldTree`. The single `intake` ledger record is
//      the harvest half's to append (§9.1.5), once, keyed on the txn_id.
//
// THE TRANSACTION (§9.1). One marker directory with a FIXED name,
// `<projectRoot><TREE_NAME>-intake/`, so its cardinality is zero-or-one by
// construction — "several sibling markers" is unreachable rather than
// handled. It holds `txn.json` (the durable identity and phase record),
// `tree/` (the legacy tree between phases `archived` and `placed`), and any
// `aborted-scaffold-<k>/` (an interrupted scaffold, moved aside, never
// deleted). Its exclusive owner is jsonl.js's `withLock` over `txn.json` —
// the codebase's ONE lock discipline, taken here rather than a second
// mechanism invented for this module. The whole transaction runs inside it,
// so concurrency closes by construction: one owner, one archive destination,
// no interleaved scaffold, no duplicate genesis.
//
// Every step advances `txn.json.phase` by one `writeAtomic` AFTER the step it
// records has committed, so each crash window is either "the step did not
// run" or "the step ran and the phase write was lost" — and the on-disk facts
// tell those apart without ever consulting presence alone (§9.1.3: two
// completion witnesses already in the code).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { withLock, readAll, LOCK_STALE_MS, LOCK_SUFFIX, LOCK_TIMEOUT_CODE } = require('./jsonl.js');
const { writeAtomic } = require('./atomic-json.js');
const { writeAtomicText } = require('./atomic-text.js');
const { appendRecord } = require('./stream.js');
const { scaffoldTree } = require('./scaffold.js');
const { detect, isResumableTree } = require('./detect.js');
const { ensureTreeSubdir } = require('./scout.js');
const { validateIntakeReport, checkIntakeTxn } = require('./validators.js');

const TREE_NAME = '.kiln';

// Derived from TREE_NAME so the package rename carries both names together,
// with no second literal to keep in sync — the same derivation detect.js
// makes for its own row-0 probe.
const INTAKE_MARKER_NAME = `${TREE_NAME}-intake`;
const INTAKE_TXN_FILENAME = 'txn.json';
const MARKER_TREE_NAME = 'tree';
const ABORTED_SCAFFOLD_PREFIX = 'aborted-scaffold-';
// Derived from the prefix that names them, so the one place a kept scaffold
// is named and the one place a kept scaffold is recognized cannot drift.
const ABORTED_SCAFFOLD_RE = new RegExp(`^${ABORTED_SCAFFOLD_PREFIX}[1-9][0-9]*$`);
const ARCHIVE_DIR_NAME = 'archive';
const LEGACY_DIR_RE = /^legacy-([1-9][0-9]*)$/;
const TXN_SCHEMA_VERSION = 1;

// The ladder advances a phase (or files one aborted scaffold) per step, so a
// transaction reaches `placed` from `claimed` in four steps. The ceiling
// exists so a logic error can never spin: it is a bug tripwire, not a retry
// budget.
const MAX_LADDER_STEPS = 8;

function refuse(message) {
  return new Error(`intake: ${message}`);
}

// lstat one path and report what node it actually is — never what a symlink
// at that path points at. `null` means "not there". Any other errno is a
// REFUSAL naming the path and the code: an unreadable path is not evidence of
// absence, and intake never guesses past an errno (design §6). Intake owns
// its own copy of this discipline and never relies on an earlier `detect()`
// call having run (§9.2.1) — a direct `intake.js archive` invocation
// validates its own roots.
function nodeTypeOf(target) {
  let lst;
  try {
    lst = fs.lstatSync(target);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw refuse(`"${target}" is unreadable (${err.code})`);
  }
  if (lst.isSymbolicLink()) return 'symlink';
  if (lst.isDirectory()) return 'dir';
  if (lst.isFile()) return 'file';
  return 'other';
}

// readTransaction(txnPath, projectRootReal) -> txn | null.
//
// `null` means "no transaction here": either the marker directory is absent,
// or it holds no `txn.json` at all — the crash window INSIDE lock acquisition
// itself, where the transaction never began (§9.1.2 step 4). That is treated
// as absent and a fresh identity is minted; it is never a refusal.
//
// Anything else at that path that does not authenticate against THIS project
// root and THIS tree name is a refusal naming the mismatched field. A foreign
// or corrupt marker is never followed, never removed, and never repaired.
function readTransaction(txnPath, projectRootReal) {
  const txnType = nodeTypeOf(txnPath);
  if (txnType === null) return null;
  if (txnType !== 'file') {
    throw refuse(`"${txnPath}" is not a regular file (${txnType})`);
  }

  let raw;
  try {
    raw = fs.readFileSync(txnPath, 'utf8');
  } catch (err) {
    throw refuse(`"${txnPath}" is unreadable (${err.code})`);
  }

  let txn;
  try {
    txn = JSON.parse(raw);
  } catch {
    throw refuse(`"${txnPath}" is not parseable JSON`);
  }
  if (txn === null || typeof txn !== 'object' || Array.isArray(txn)) {
    throw refuse(`"${txnPath}" is not a transaction record`);
  }

  const verdict = checkIntakeTxn(txn, { projectRootReal, treeName: TREE_NAME });
  if (!verdict.ok) {
    throw refuse(`"${txnPath}" fails authentication on ${verdict.field} (${verdict.saw})`);
  }
  return txn;
}

// Scaffold committed <=> `routing/active.json` is a REGULAR FILE parsing to an
// object with non-empty string `active_config` and `digest` (§9.1.3).
// scaffold.js:176-182 writes it as the LAST statement of scaffoldTree, after
// every directory, state.json, settings.json, handoff.md, all four genesis
// streams, and the dated routing copy — so its validity proves the whole
// sequence ran. This is what makes a partial scaffold distinguishable from a
// complete one without consulting presence alone. An unreadable, torn, or
// symlinked witness is simply "not committed": the tree is then preserved
// under the marker and rebuilt, never deleted, so a false negative here costs
// one extra kept directory and no bytes.
function scaffoldWitnessValid(treeDir) {
  const activePath = path.join(treeDir, 'routing', 'active.json');
  let lst;
  try {
    lst = fs.lstatSync(activePath);
  } catch {
    return false;
  }
  if (!lst.isFile()) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return (
    typeof parsed.active_config === 'string' &&
    parsed.active_config !== '' &&
    typeof parsed.digest === 'string' &&
    parsed.digest !== ''
  );
}

// The highest already-filed archive generation. Only a REAL DIRECTORY whose
// basename matches `legacy-<N>` counts — a symlink or a regular file at that
// name is not an archive, and leaving it uncounted is what makes the
// destination-occupied guard below fire on it rather than rename onto it.
function maxLegacyGeneration(archiveDir) {
  let entries;
  try {
    entries = fs.readdirSync(archiveDir, { withFileTypes: true });
  } catch (err) {
    throw refuse(`"${archiveDir}" is unreadable (${err.code})`);
  }
  let max = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const matched = LEGACY_DIR_RE.exec(entry.name);
    if (matched === null) continue;
    const n = Number(matched[1]);
    if (n > max) max = n;
  }
  return max;
}

// What is ACTUALLY inside the marker directory, partitioned into the three
// things it can hold (§9.1.1). This is the one reading every retirement
// decision is made from: the transaction record is what intake INTENDED, and
// intending is not knowing. The one ladder step whose durable record is
// written after its move — the partial-scaffold rename, whose `persist` can
// be lost — leaves an aborted scaffold on disk that the record does not name,
// and a retirement that read the record would delete it.
//
//   own     — `txn.json` and its own lockfile, both authored by this
//             transaction, the only two things it may ever remove.
//   aborted — `aborted-scaffold-<k>/`, a real directory: an interrupted
//             scaffold, kept whether or not the record caught up.
//   foreign — anything else at all, including `tree/`. Not this
//             transaction's output and not accounted for by any row of the
//             state table, so it is never removed and never quietly kept:
//             the caller refuses and names it.
function inspectMarker(markerPath) {
  let entries;
  try {
    entries = fs.readdirSync(markerPath, { withFileTypes: true });
  } catch (err) {
    throw refuse(`"${markerPath}" is unreadable (${err.code})`);
  }
  const own = new Set([INTAKE_TXN_FILENAME, `${INTAKE_TXN_FILENAME}${LOCK_SUFFIX}`]);
  const aborted = [];
  const foreign = [];
  for (const entry of entries) {
    if (own.has(entry.name) && entry.isFile()) continue;
    // withFileTypes reports the node itself, never its target, so a symlink
    // named `aborted-scaffold-1` is foreign rather than an aborted scaffold.
    if (entry.isDirectory() && ABORTED_SCAFFOLD_RE.test(entry.name)) aborted.push(entry.name);
    else foreign.push(entry.name);
  }
  aborted.sort();
  foreign.sort();
  return { aborted, foreign };
}

// Where the legacy tree is RIGHT NOW, read off the phase the marker records.
// This is the one sentence a refusal during a crash window has to get right:
// the operator is looking at a project whose tree has vanished from where
// they expect it, and every honest answer to "where did it go" is already in
// the transaction record.
function treeWhereabouts(ctx) {
  const txn = ctx.preLockTxn;
  const treeDir = path.join(ctx.projectRoot, TREE_NAME);
  if (txn === null || txn === undefined) {
    return `no tree has been set aside yet — "${treeDir}" is where it stands`;
  }
  if (txn.phase === 'claimed') {
    return `the legacy tree is either still at "${treeDir}" or already safe under "${ctx.markerTreePath}"`;
  }
  if (txn.phase === 'archived' || txn.phase === 'scaffolded') {
    return `the legacy tree is safe and whole under "${ctx.markerTreePath}"`;
  }
  if (typeof txn.archive_path !== 'string') {
    return `the legacy tree is safe and whole under "${ctx.markerPath}"`;
  }
  return `the legacy tree is safe and whole at "${path.join(ctx.projectRoot, txn.archive_path)}"`;
}

// The one lock both halves take, so the two ways it can fail are translated
// once rather than in two copies that drift (§9.1.6: the two commands are one
// transaction, re-entered).
//
// A crash leaves the lockfile behind, and `withLock` reclaims it only after
// LOCK_STALE_MS. Every re-entry inside that window would otherwise surface
// "timed out waiting for the append lock" — a message about a JSONL append,
// naming neither the tree nor the phase nor a way forward, at the most
// alarming moment intake has. The self-heal is real. This says so.
//
// The other failure is a peer retiring the marker while this caller waits:
// the lockfile's own directory goes with it, and every subsequent acquire
// attempt is an ENOENT on a path that is simply finished.
function withIntakeLock(ctx, fn) {
  try {
    return withLock(ctx.txnPath, fn);
  } catch (err) {
    if (err && err.code === LOCK_TIMEOUT_CODE) {
      const phase = ctx.preLockTxn === null || ctx.preLockTxn === undefined ? 'not yet recorded' : ctx.preLockTxn.phase;
      throw refuse(
        `another process holds the intake transaction at "${ctx.markerPath}" (recorded phase "${phase}"). ` +
          `Nothing was read, written, or removed, and ${treeWhereabouts(ctx)}. ` +
          `If that process was interrupted, its lock is reclaimed after ${Math.round(LOCK_STALE_MS / 1000)}s — ` +
          `re-run intake then and the transaction resumes from phase "${phase}".`
      );
    }
    if (err && err.code === 'ENOENT' && !fs.existsSync(ctx.markerPath)) {
      throw refuse(
        `the transaction marker at "${ctx.markerPath}" was retired by another process while this one waited for its lock — re-run detect and re-enter`
      );
    }
    throw err;
  }
}

// The marker's node type, proven again now that the lock is held. The
// pre-lock check (§9.1.2) has to run before `withLock`'s own recursive
// mkdirSync, which is where a pre-planted symlink is caught — but everything
// past this line writes into the marker, and between that check and the lock
// being acquired the path was unwatched. One lstat closes the part of that
// window this module owns; the mkdirSync inside `withLock` is the part it
// does not.
function assertMarkerIsRealDirectory(ctx) {
  const markerType = nodeTypeOf(ctx.markerPath);
  if (markerType !== 'dir') {
    throw refuse(
      `hazard — "${ctx.markerPath}" is not a real directory (${markerType === null ? 'absent' : markerType}) now that the transaction lock is held`
    );
  }
}

const nowUtc = () => new Date().toISOString();

// Persist the transaction record. Every phase write goes through this one
// function, so "the phase advances only by a durable atomic write" is a
// property of the module rather than of each call site.
function persist(ctx, fields) {
  ctx.txn = { ...ctx.txn, ...fields, updated_utc: nowUtc() };
  writeAtomic(ctx.txnPath, ctx.txn);
}

// Mint a fresh transaction identity (§9.1.1), inside the lock.
//
// The precondition is `detect()`'s own verdict, not a second recognizer
// written here: intake archives a tree only when the one classifier in the
// machine calls it `legacy`. It is read HERE, inside the lock, immediately
// before the claim — never carried in from a classification that ran before
// the lock was held.
//
// This is the MINT path only, and a transaction is minted only when no record
// exists — so this check alone never bound a re-entry, and a record that
// arrived any other way reached the ladder without it. What makes a direct
// `intake.js archive` invocation unable to set aside a resumable current tree
// is the same question asked again at the `claimed` step, which is the one
// step that moves a tree and which every entrant runs.
//
// The tier and markers detect found are recorded in the transaction because
// this is the only moment they are computable: from phase `archived` onward
// the legacy tree no longer lives at `<projectRoot>/<TREE_NAME>`, so a later
// re-entry cannot re-derive them from the tree's own location.
function mintTransaction(ctx) {
  const seen = detect(ctx.projectRoot);
  if (seen.evidence.intake_txn !== null) {
    throw refuse(`a foreign intake transaction appeared at "${ctx.markerPath}" — refusing to mint a second identity`);
  }
  if (seen.mode !== 'legacy') {
    throw refuse(
      `refusing to archive — detect classifies "${ctx.projectRoot}" as "${seen.mode}", not a legacy tree`
    );
  }
  const txn = {
    schema_version: TXN_SCHEMA_VERSION,
    txn_id: crypto.randomBytes(16).toString('hex'),
    // Recorded for the operator's benefit in a refusal message only — never
    // consulted for liveness. There is no lease, because there is nothing to
    // lease: the phase field IS the resume point, and any entrant continues
    // the same transaction from it.
    owner_pid: process.pid,
    project_root_real: ctx.projectRootReal,
    tree_name: TREE_NAME,
    phase: 'claimed',
    archive_path: null,
    aborted_scaffolds: [],
    tier: seen.evidence.legacy_tier,
    markers: seen.evidence.legacy_markers,
    started_utc: nowUtc(),
    updated_utc: nowUtc(),
  };
  ctx.txn = txn;
  writeAtomic(ctx.txnPath, txn);
  return txn;
}

// Retire the marker (§9.1.4) — the transaction's last act on the one refusal
// path the archive half can reach it by: `claimed` with nothing to claim.
// Expected to hold nothing but this transaction's own `txn.json` and its own
// lockfile, both authored moments earlier — and that expectation is CHECKED
// against the directory rather than assumed, so anything else on disk is left
// exactly where it is. This path is already refusing; leaving a marker
// standing costs the operator one directory, and removing bytes nobody
// accounted for costs them the bytes.
function retireMarker(ctx) {
  if (!fs.existsSync(ctx.markerPath)) return;
  const held = inspectMarker(ctx.markerPath);
  if (held.aborted.length > 0 || held.foreign.length > 0) return;
  fs.rmSync(ctx.markerPath, { recursive: true });
}

// One step of the phase ladder (§9.1.4's state table). Each `case` reads the
// on-disk facts fresh, under the lock, and either commits one move + one
// phase write, or refuses. Every hazard row refuses BEFORE mutating anything.
function ladderStep(ctx) {
  const { treeDir, markerTreePath } = ctx;

  switch (ctx.txn.phase) {
    case 'claimed': {
      const treeType = nodeTypeOf(treeDir);
      if (treeType !== null && treeType !== 'dir') {
        throw refuse(`hazard — "${treeDir}" exists but is not a real directory (${treeType})`);
      }
      const stashedType = nodeTypeOf(markerTreePath);
      if (stashedType !== null && stashedType !== 'dir') {
        throw refuse(`hazard — "${markerTreePath}" exists but is not a real directory (${stashedType})`);
      }
      if (treeType === 'dir' && stashedType === 'dir') {
        throw refuse(
          `hazard — a tree is present at BOTH "${treeDir}" and "${markerTreePath}"; an outside writer acted and intake does not guess past one`
        );
      }
      if (treeType === null && stashedType === null) {
        retireMarker(ctx);
        throw refuse(
          `nothing to archive — the tree vanished between classification and claim (neither "${treeDir}" nor "${markerTreePath}" exists); the marker has been retired`
        );
      }
      if (treeType === 'dir') {
        // The precondition, re-read at the step that acts on it. `mintTransaction`
        // asks detect before minting, but a transaction is only minted when no
        // record exists — so a record that arrived any other way reached this
        // rename without the question ever being asked. It is asked here
        // instead, where the tree is about to move, so the mint path and every
        // re-entry are both covered by one check.
        if (isResumableTree(treeDir)) {
          throw refuse(
            `refusing to archive — "${treeDir}" is a resumable current tree (a valid state.json at schema_version 1), and no transaction record licenses setting one aside. Nothing was moved. ` +
              `The record at "${ctx.txnPath}" was not written by intake against this tree; move the marker aside to close it — mv "${ctx.markerPath}" "${ctx.markerPath}-abandoned"`
          );
        }
        // Step 1. An atomic directory-entry move: nothing is read, copied,
        // rewritten, or deleted, and a rename has no half.
        fs.renameSync(treeDir, markerTreePath);
      }
      // stashedType === 'dir' with no tree at treeDir is the same step already
      // committed with its phase write lost — only intake can have created
      // <marker>/tree, since the exclusive marker was claimed before the tree
      // moved. Either way the tree is safe under the marker.
      persist(ctx, { phase: 'archived' });
      return;
    }

    case 'archived': {
      const stashedType = nodeTypeOf(markerTreePath);
      if (stashedType !== 'dir') {
        throw refuse(
          `hazard — the archived tree is no longer a real directory at "${markerTreePath}" (${stashedType === null ? 'absent' : stashedType})`
        );
      }
      const treeType = nodeTypeOf(treeDir);
      if (treeType !== null && treeType !== 'dir') {
        throw refuse(`hazard — "${treeDir}" exists but is not a real directory (${treeType})`);
      }
      if (treeType === 'dir' && scaffoldWitnessValid(treeDir)) {
        // The scaffold completed and only its phase write was lost. No
        // rescaffold, no deletion.
        persist(ctx, { phase: 'scaffolded' });
        return;
      }
      if (treeType === 'dir') {
        // A PARTIAL scaffold. It is provably intake's own uncommitted output,
        // and it is still never deleted: it is renamed into the marker and
        // kept, and named in the report the harvest half writes.
        const abortedName = `${ABORTED_SCAFFOLD_PREFIX}${ctx.txn.aborted_scaffolds.length + 1}`;
        const abortedPath = path.join(ctx.markerPath, abortedName);
        if (nodeTypeOf(abortedPath) !== null) {
          throw refuse(`hazard — "${abortedPath}" is already occupied; refusing to move a partial scaffold onto it`);
        }
        fs.renameSync(treeDir, abortedPath);
        persist(ctx, { aborted_scaffolds: [...ctx.txn.aborted_scaffolds, abortedName] });
        return;
      }
      // Step 2. The plain greenfield call — NEVER force.
      try {
        scaffoldTree(ctx.projectRoot, { routingConfigPath: ctx.routingConfigPath });
      } catch (err) {
        // The highest-anxiety failure in the design (§6): the operator's tree
        // has just vanished from where they expect it. The message is the
        // whole mitigation — it names where the tree is, states that nothing
        // was deleted, and prints the commands that restore the prior state.
        throw refuse(
          `the legacy tree is safe and whole at "${markerTreePath}", but the fresh scaffold failed (${err.message}). ` +
            `Nothing was deleted. Fix the cause and re-run intake to resume, or restore the prior state with:  ` +
            `mv "${markerTreePath}" "${treeDir}" && rm -r "${ctx.markerPath}"`
        );
      }
      persist(ctx, { phase: 'scaffolded' });
      return;
    }

    case 'scaffolded': {
      const treeType = nodeTypeOf(treeDir);
      if (treeType !== 'dir') {
        throw refuse(
          `hazard — the fresh tree is no longer a real directory at "${treeDir}" (${treeType === null ? 'absent' : treeType}); the legacy tree stays where it is, under "${ctx.markerPath}"`
        );
      }
      if (!scaffoldWitnessValid(treeDir)) {
        throw refuse(
          `hazard — "${treeDir}" no longer witnesses a completed scaffold (routing/active.json); an outside writer acted after this transaction scaffolded it`
        );
      }
      const archiveDir = path.join(treeDir, ARCHIVE_DIR_NAME);
      const archiveType = nodeTypeOf(archiveDir);
      if (archiveType !== 'dir') {
        // A symlinked archive/ would move the legacy tree clean out of the
        // project; a missing one means the tree under treeDir is not the tree
        // this transaction scaffolded.
        throw refuse(
          `hazard — "${archiveDir}" is not a real directory (${archiveType === null ? 'absent' : archiveType})`
        );
      }
      const stashedType = nodeTypeOf(markerTreePath);
      if (stashedType !== null && stashedType !== 'dir') {
        throw refuse(`hazard — "${markerTreePath}" exists but is not a real directory (${stashedType})`);
      }
      if (stashedType === null) {
        // The placement already committed and only its phase write was lost.
        // The archive directory of a freshly scaffolded tree is written by
        // nothing but this step, so the highest generation present is this
        // transaction's own.
        const placed = maxLegacyGeneration(archiveDir);
        if (placed === 0) {
          throw refuse(
            `hazard — nothing at "${markerTreePath}" and no archive generation under "${archiveDir}"; the set-aside tree cannot be accounted for`
          );
        }
        persist(ctx, {
          phase: 'placed',
          archive_path: path.join(TREE_NAME, ARCHIVE_DIR_NAME, `legacy-${placed}`),
        });
        return;
      }
      // Step 3. Monotonic, never overwriting: a target that somehow exists
      // means a concurrent or foreign writer, and guessing past one is how
      // trees get corrupted.
      const generation = maxLegacyGeneration(archiveDir) + 1;
      const relative = path.join(TREE_NAME, ARCHIVE_DIR_NAME, `legacy-${generation}`);
      const target = path.join(archiveDir, `legacy-${generation}`);
      if (nodeTypeOf(target) !== null) {
        throw refuse(`refusing to overwrite "${target}" — the archive destination is already occupied`);
      }
      fs.renameSync(markerTreePath, target);
      persist(ctx, { phase: 'placed', archive_path: relative });
      return;
    }

    default:
      throw refuse(`internal — the ladder was stepped at phase "${ctx.txn.phase}"`);
  }
}

function transactionResult(ctx) {
  return {
    txn_id: ctx.txn.txn_id,
    phase: ctx.txn.phase,
    archive_path: ctx.txn.archive_path,
    tier: ctx.txn.tier === undefined ? null : ctx.txn.tier,
    markers: Array.isArray(ctx.txn.markers) ? ctx.txn.markers : [],
    aborted_scaffolds: ctx.txn.aborted_scaffolds,
    marker_path: ctx.markerPath,
  };
}

function runTransaction(ctx) {
  assertMarkerIsRealDirectory(ctx);
  const existing = readTransaction(ctx.txnPath, ctx.projectRootReal);
  ctx.txn = existing === null ? mintTransaction(ctx) : existing;

  for (let step = 0; step < MAX_LADDER_STEPS; step++) {
    // `placed` is where the archive half stops (§9.1.6): the marker persists
    // through `placed` and `harvested` — it is the durable pending marker
    // that keeps detect's row 0 firing until the harvest half commits — so
    // re-entry here is a no-op returning the recorded archive_path.
    if (ctx.txn.phase === 'placed' || ctx.txn.phase === 'harvested') {
      return transactionResult(ctx);
    }
    ladderStep(ctx);
  }
  throw refuse(`internal — the phase ladder did not settle within ${MAX_LADDER_STEPS} steps`);
}

// archiveLegacyTree(projectRoot, opts) -> {txn_id, phase, archive_path, tier,
// markers, aborted_scaffolds, marker_path}
//
// Runs the transaction from wherever it is up to `placed`, and is a no-op at
// `placed` or later. `archive_path` is project-root-relative
// (`<TREE_NAME>/archive/legacy-N`), the same string the transaction record
// carries. Idempotent, re-entrant across processes, and safe against a
// concurrent caller by the marker lock.
//
// opts.routingConfigPath (required): the source path to the current dated
// routing config, handed straight to scaffoldTree — intake makes no judgment
// about routing and validates none of it, so a bad config surfaces as
// scaffold's own message inside the stop that names the set-aside tree.
function archiveLegacyTree(projectRoot, opts = {}) {
  if (typeof projectRoot !== 'string' || projectRoot === '') {
    throw new TypeError('archiveLegacyTree: projectRoot must be a non-empty string');
  }
  const routingConfigPath = opts.routingConfigPath;
  if (typeof routingConfigPath !== 'string' || routingConfigPath === '') {
    throw new TypeError(
      'archiveLegacyTree: opts.routingConfigPath is required (source path to the current dated routing config)'
    );
  }

  // Roots first (§9.2.1): a symlinked project root is a refusal, and every
  // later comparison uses the resolved path.
  const rootType = nodeTypeOf(projectRoot);
  if (rootType === null) {
    throw refuse(`projectRoot does not exist: "${projectRoot}"`);
  }
  if (rootType !== 'dir') {
    throw refuse(`"${projectRoot}" is not a real directory (${rootType})`);
  }
  const projectRootReal = fs.realpathSync(projectRoot);

  const markerPath = path.join(projectRoot, INTAKE_MARKER_NAME);
  const ctx = {
    projectRoot,
    projectRootReal,
    routingConfigPath,
    treeDir: path.join(projectRoot, TREE_NAME),
    markerPath,
    markerTreePath: path.join(markerPath, MARKER_TREE_NAME),
    txnPath: path.join(markerPath, INTAKE_TXN_FILENAME),
    txn: null,
    // What the record said before the lock was contended, kept so a refusal
    // that never gets inside the lock can still name the phase and the tree.
    preLockTxn: null,
  };

  // Pre-lock validation (§9.1.2), before the first mutation of any kind:
  // `withLock`'s recursive mkdirSync would FOLLOW a pre-planted symlink at
  // the marker path, so the node type is proven here, where a refusal leaves
  // the filesystem byte-identical. The same read authenticates an existing
  // transaction record against this project root and tree name; the record is
  // read again inside the lock, where it is authoritative.
  const markerTypeBefore = nodeTypeOf(markerPath);
  if (markerTypeBefore !== null && markerTypeBefore !== 'dir') {
    throw refuse(`"${markerPath}" exists but is not a real directory (${markerTypeBefore})`);
  }
  if (markerTypeBefore === 'dir') {
    ctx.preLockTxn = readTransaction(ctx.txnPath, projectRootReal);
  }

  try {
    return withIntakeLock(ctx, () => runTransaction(ctx));
  } finally {
    // A refusal that happened after the lock created the marker directory but
    // before any transaction was minted leaves an empty directory behind.
    // detect treats that state as absent (§9.1.2 step 4), so it is inert
    // either way — but a refusal that leaves the project exactly as it found
    // it is the honest outcome, and this removes only an empty directory this
    // call itself created.
    if (markerTypeBefore === null) {
      try {
        if (fs.readdirSync(markerPath).length === 0) fs.rmdirSync(markerPath);
      } catch {
        /* the marker is in use or already gone — leave it exactly as it is */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// THE HARVEST HALF (design §3, §4, §9.2)
//
// The governing principle, stated once and enforced everywhere below: PROSE
// THAT STATES HUMAN INTENT SURVIVES; MACHINE EVIDENCE DOES NOT. A seal in
// `seals.log` means "a gate passed against a check.sh bound to a LAW.md
// digest". This tree never ran that check and holds no digest of it. The seal
// is a historical fact ABOUT THE OLD RUN, not evidence FOR THE NEW ONE. It
// can be reported. It can never be converted. So every item the harvest
// touches is exactly one of:
//
//   carried — durable meaning seeding the new run as a FLAGGED INPUT, tagged
//             with one of validators.js's two existing TRUST_FLAGS, landing
//             under `intake/` and nowhere else.
//   noted   — a historical fact, recorded and reported, binding nothing.
//
// and nothing in the `noted` class ever reaches `state.json`, `milestones/`,
// `verification/`, `architecture/`, or `ledger.jsonl` beyond the single
// `intake` record of finding.
//
// The harvest is TWO PHASES inside the intake lock (§9.2.4). The plan phase
// walks the archive, lstats every candidate, builds the complete plan and the
// complete report, validates the report, and validates every planned
// destination — with ZERO mutation, so any refusal leaves the filesystem
// byte-identical. Only then does the commit phase create directories, copy
// files, render `report.md`, and write `report.json` LAST, as the
// harvest-committed witness (§9.1.3).
// ---------------------------------------------------------------------------

const INTAKE_DIR_NAME = 'intake';
const LEDGER_FILENAME = 'ledger.jsonl';
const INTAKE_RECORD_KIND = 'intake';
const REPORT_JSON_NAME = 'report.json';
const REPORT_MD_NAME = 'report.md';
const REPORT_SCHEMA_VERSION = 1;

// A bug tripwire on a pathological archive, not a policy: the walk stops
// adding entries past it and says `truncated: true` rather than silently
// returning a subset (the honest-truncation discipline scout.js's
// inventoryTarget already holds).
const MAX_ARCHIVE_ENTRIES = 5000;

// Files whose CONTENT the harvest must read to record a count or a verbatim
// copy. Past these ceilings the file is recorded as unreadable with the
// ceiling named — never counted by guess, never silently skipped.
const COUNT_READ_CEILING = 8 * 1024 * 1024;
const VERBATIM_CEILING = 16 * 1024;

// §4.1's namespace, grouped by CONSUMING PHASE. `law` and `design` share the
// `design/` directory because both reach the same reader (plan-author /
// milestone-designer) as flagged inputs; the roles stay distinct in the
// report so the operator line can name them separately.
const ROLE_DEST_DIR = {
  vision: 'vision',
  law: 'design',
  design: 'design',
  research: 'research',
  codebase: 'codebase',
  document: 'documents',
};

// §3.2's typed table, depth-1 names. Every row is INDEPENDENTLY OPTIONAL —
// the harvest is presence-keyed, never completeness-keyed, which is what lets
// one harvester cover the whole v3 family across its additive drift with no
// version branch anywhere in its body.
const TIER1_ROOT_RULES = [
  { name: 'LAW.md', role: 'law', trust_flag: 'inherited-unverified' },
  { name: 'slices.json', role: 'design', trust_flag: 'inherited-unverified' },
  { name: 'decisions.md', role: 'design', trust_flag: 'inherited-unverified' },
];

// §3.2's `docs/` rows, first match wins. `codebase-map.md` is tested before
// the research and vision patterns because it is the one row with a different
// trust flag: a prior map of the code is ADVISORY — scout re-derives it and
// never trusts it.
const TIER1_DOC_RULES = [
  { test: (n) => n === 'codebase-map.md', role: 'codebase', trust_flag: 'inherited-advisory' },
  {
    test: (n) => n === 'feasibility.md' || /^probe-.+\.md$/.test(n) || /^research/.test(n),
    role: 'research',
    trust_flag: 'inherited-unverified',
  },
  {
    test: (n) => n === 'vision.md' || /^vision-.+\.md$/.test(n) || n === 'project-brief.md',
    role: 'vision',
    trust_flag: 'inherited-unverified',
  },
];

const BRAINSTORM_LEDGER_NAME = 'brainstorm-ledger.jsonl';

// §3.3's tier-2 document set, as a CLOSED list of extensions plus the
// extensionless-text case. With one v1.x sample and no v2 sample, a bespoke
// parser would be guesswork wearing a schema — so tier 2 recognizes a text
// document by extension and by its bytes, and nothing else about it.
const TIER2_DOCUMENT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.jsonl', '.yaml']);
const DOCUMENT_CEILING = 1024 * 1024;
const LOCKFILE_SUFFIX = '.lock';

// The MACHINE_EVIDENCE denylist (§9.2.4). Deliberately NOT holding
// `brainstorm-ledger.jsonl`: that file keeps its own sealed/unsealed rule
// (§3.4) and is the only JSONL that can ever be carried.
const MACHINE_EVIDENCE_BASENAMES = new Set([
  'STATE.md',
  'state.json',
  'seals.log',
  'seals.jsonl',
  'audits.log',
  'audits.jsonl',
  'reviews.jsonl',
  'posture.json',
]);
const MACHINE_EVIDENCE_DIRS = new Set(['law', 'evidence']);

// §3.2's transient set — listed, never silently dropped, never carried.
const TRANSIENT_BASENAMES = new Set(['degraded', 'degraded-ack', 'run.lock', '.turn.tmp']);
const TRANSIENT_DIRS = new Set(['.wide']);

// What the old run CLAIMED it delivered. Prose, but prose about the machine's
// own verdict rather than about human intent — so it is reported, not carried.
const RUN_CLAIM_BASENAMES = new Set([
  'report.md',
  'validate.md',
  'validate-report.md',
  'narration.md',
  'build-notes.md',
]);

// Recorded verbatim and namespaced (§3.2): where the old run stopped, and the
// posture it was run under. Settings come from the interview every time.
const VERBATIM_BASENAMES = new Set(['STATE.md', 'state.json', 'posture.json']);

// realpathOfPossiblyMissing / validateContainedTarget — intake's own copy of
// the contract proven at handoff.js:90-108, per that file's own header note:
// one native mechanism per constraint BINDING AN INVARIANT, not a utility
// shared across modules whose callers then drift apart. Both are pure
// validation, so the plan phase can run them before its first mutation.
function realpathOfPossiblyMissing(target) {
  const suffix = [];
  let existing = path.resolve(target);
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  return suffix.length > 0 ? path.join(realExisting, ...suffix) : realExisting;
}

// Called on EVERY destination leaf — report.json, report.md, every carried
// document, and every directory intake creates — never once on `intake/`.
// Because step 2 resolves the deepest EXISTING prefix, a pre-planted
// `intake/vision -> /outside` or `intake/documents/a -> /outside` is resolved
// at any depth and refused; ancestors that do not yet exist are created by
// intake itself as real directories and therefore cannot be symlinks.
function validateContainedTarget(treeRootReal, targetPath) {
  let lst;
  try {
    lst = fs.lstatSync(targetPath);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    lst = null;
  }
  if (lst && lst.isSymbolicLink()) {
    throw refuse(`refusing to write through a symlinked target ("${targetPath}")`);
  }
  const targetReal = realpathOfPossiblyMissing(targetPath);
  const rel = path.relative(treeRootReal, targetReal);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw refuse(`target "${targetPath}" resolves outside the tree (via a symlinked parent)`);
  }
}

// The whole source-containment mechanism, as ONE equality (§9.2.1):
// archiveReal must be exactly `<treeRootReal>/archive/legacy-<N>`. That single
// rule refuses an outside path, an ancestor, `intake/` itself, and any
// descendant of `intake/` — source/destination overlap is structurally
// impossible because `intake/` and `archive/` are siblings, and no path can
// satisfy this equality and also touch `intake/`.
function resolveArchiveSource(treeRootReal, archivePath) {
  const archiveType = nodeTypeOf(archivePath);
  if (archiveType === null) {
    throw refuse(`the archive source does not exist: "${archivePath}"`);
  }
  if (archiveType !== 'dir') {
    throw refuse(`the archive source "${archivePath}" is not a real directory (${archiveType})`);
  }
  const archiveReal = fs.realpathSync(archivePath);
  const expectedParent = path.join(treeRootReal, ARCHIVE_DIR_NAME);
  if (path.dirname(archiveReal) !== expectedParent || !LEGACY_DIR_RE.test(path.basename(archiveReal))) {
    throw refuse(
      `the archive source "${archivePath}" is not a "<tree>/${ARCHIVE_DIR_NAME}/legacy-N" directory (resolved to "${archiveReal}")`
    );
  }
  return archiveReal;
}

// Bounded, symlink-free walk of the frozen archive. `readdirSync` entries
// reporting isSymbolicLink() are RECORDED and never traversed, in either
// tier: a legacy `docs/vision.md` that is a symlink to `seals.log` cannot
// deliver seal bytes into `intake/vision/` labelled inherited-unverified,
// because it is never carried at all.
function walkArchive(archiveReal) {
  const nodes = [];
  const dirs = [];
  const unreadable = [];
  let truncated = false;
  let newestMtimeMs = null;

  const queue = [''];
  while (queue.length > 0 && !truncated) {
    const relDir = queue.shift();
    const absDir = relDir === '' ? archiveReal : path.join(archiveReal, relDir);
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      unreadable.push({ path: relDir === '' ? '.' : relDir, reason: `directory unreadable (${err.code})` });
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (nodes.length + dirs.length >= MAX_ARCHIVE_ENTRIES) {
        truncated = true;
        break;
      }
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      const abs = path.join(absDir, entry.name);
      if (entry.isSymbolicLink()) {
        let linkTarget = '';
        try {
          linkTarget = fs.readlinkSync(abs);
        } catch {
          linkTarget = '';
        }
        nodes.push({ rel, abs, kind: 'symlink', bytes: 0, mtimeMs: null, linkTarget });
        continue;
      }
      let stat = null;
      try {
        stat = fs.lstatSync(abs);
      } catch (err) {
        unreadable.push({ path: rel, reason: `unreadable (${err.code})` });
        continue;
      }
      if (stat.mtimeMs > (newestMtimeMs === null ? -Infinity : newestMtimeMs)) {
        newestMtimeMs = stat.mtimeMs;
      }
      if (stat.isDirectory()) {
        dirs.push(rel);
        queue.push(rel);
      } else if (stat.isFile()) {
        nodes.push({ rel, abs, kind: 'file', bytes: stat.size, mtimeMs: stat.mtimeMs, linkTarget: null });
      } else {
        nodes.push({ rel, abs, kind: 'other', bytes: 0, mtimeMs: stat.mtimeMs, linkTarget: null });
      }
    }
  }
  return { nodes, dirs, unreadable, truncated, newestMtimeMs };
}

function topSegment(rel) {
  const cut = rel.indexOf('/');
  return cut === -1 ? rel : rel.slice(0, cut);
}

function readTextBounded(node, ceiling, unreadable) {
  if (node.bytes > ceiling) {
    unreadable.push({ path: node.rel, reason: `exceeds the ${ceiling}-byte read ceiling (${node.bytes} bytes)` });
    return null;
  }
  try {
    return fs.readFileSync(node.abs, 'utf8');
  } catch (err) {
    unreadable.push({ path: node.rel, reason: `unreadable (${err.code})` });
    return null;
  }
}

function nonEmptyLines(text) {
  return text.split('\n').filter((line) => line.trim() !== '');
}

// §3.4's single seal test, and the whole of it: the ledger is sealed IFF its
// last line is a `session_complete` event. `coverage-spot-checks.md` Q4
// records the ethic — kiln renames an unsealed ledger and never resumes it —
// and intake honours it directly: unsealed is `noted` only, preserved in the
// archive with its path named so the operator can read it themselves.
function brainstormLedgerSealed(text) {
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return false;
  let last;
  try {
    last = JSON.parse(lines[lines.length - 1]);
  } catch {
    return false;
  }
  return last !== null && typeof last === 'object' && !Array.isArray(last) && last.e === 'session_complete';
}

// The tier-1 typed classification of ONE archive-relative path. Exactly one
// bucket per node, so every file in the archive is accounted for exactly
// once across carried / noted / ignored / unreadable.
function classifyTier1(node) {
  const { rel } = node;
  const base = path.basename(rel);
  const top = topSegment(rel);
  const depth = rel.split('/').length - 1;

  if (node.kind === 'symlink') {
    // The raw readlink string is recorded as an UNINTERPRETED string. The
    // target is not stat'd, not resolved, and not checked for containment —
    // because it is never touched.
    return { bucket: 'noted', reason: 'symlink', link_target: node.linkTarget };
  }
  if (node.kind !== 'file') {
    return { bucket: 'ignored', reason: 'not a regular file' };
  }
  if (TRANSIENT_DIRS.has(top) || TRANSIENT_BASENAMES.has(base) || base.endsWith('.tmp')) {
    return { bucket: 'ignored', reason: 'transient' };
  }
  if (depth === 0) {
    const rule = TIER1_ROOT_RULES.find((r) => r.name === base);
    if (rule) return { bucket: 'carried', role: rule.role, trust_flag: rule.trust_flag };
    if (base === BRAINSTORM_LEDGER_NAME) return { bucket: 'brainstorm-ledger' };
  }
  if (depth === 1 && top === 'docs') {
    const rule = TIER1_DOC_RULES.find((r) => r.test(base));
    if (rule) return { bucket: 'carried', role: rule.role, trust_flag: rule.trust_flag };
  }
  if (MACHINE_EVIDENCE_DIRS.has(top) && depth > 0) {
    return { bucket: 'noted', reason: 'machine-evidence' };
  }
  if (depth === 0 && VERBATIM_BASENAMES.has(base)) {
    return { bucket: 'verbatim' };
  }
  if (depth === 0 && MACHINE_EVIDENCE_BASENAMES.has(base)) {
    return { bucket: 'noted', reason: 'machine-evidence' };
  }
  if (depth === 0 && RUN_CLAIM_BASENAMES.has(base)) {
    return { bucket: 'noted', reason: 'run-claim' };
  }
  // Listed, never silently dropped: a readable document outside the typed
  // table is a fact of finding, reported with its path so the operator can
  // read it in the archive themselves.
  return { bucket: 'noted', reason: 'untyped' };
}

// The tier-2 classification of ONE archive-relative path (§3.3, §9.2.4).
// Where tier 1 reads a typed table, this reads nothing about meaning at all:
// the only questions asked are "is it machine evidence", "is it transient",
// and "is it a text document". Everything a name might otherwise suggest —
// that `vision.md` is a vision, that `codebase-map.md` is a map — is
// deliberately not asked, because with one v1.x sample the answer would be a
// guess, and a guessed role reaches the pipeline wearing the same label as a
// verified one.
//
// The MACHINE_EVIDENCE denylist is keyed on the BASENAME AT EVERY DEPTH here,
// unlike tier 1's depth-1 table: a tier-2 tree has no known layout, so
// `runs/old/state.json` is exactly as much machine evidence as a root one,
// and §3.1's principle would be false for tier 2 if depth could evade it.
function classifyTier2(node) {
  const { rel } = node;
  const segments = rel.split('/');
  const base = segments[segments.length - 1];
  // Every directory segment on the way down, not just the first: the
  // denylisted directories bind at ANY depth here for the same reason the
  // basenames do — a tier-2 tree has no layout the machine knows, so
  // `runs/old/law/notes.md` is exactly as much machine evidence as
  // `law/notes.md`, and prose inside it would otherwise be carried.
  const dirSegments = segments.slice(0, -1);

  if (node.kind === 'symlink') {
    return { bucket: 'noted', reason: 'symlink', link_target: node.linkTarget };
  }
  if (node.kind !== 'file') {
    return { bucket: 'ignored', reason: 'not a regular file' };
  }
  if (dirSegments.some((seg) => TRANSIENT_DIRS.has(seg)) || TRANSIENT_BASENAMES.has(base) || base.endsWith('.tmp')) {
    return { bucket: 'ignored', reason: 'transient' };
  }
  if (dirSegments.some((seg) => MACHINE_EVIDENCE_DIRS.has(seg))) {
    return { bucket: 'noted', reason: 'machine-evidence' };
  }
  if (MACHINE_EVIDENCE_BASENAMES.has(base)) {
    return { bucket: 'noted', reason: 'machine-evidence' };
  }
  // What the old run CLAIMED it delivered, bound in this tier too. Tier 1
  // notes these by name; tier 2 did not, so an old run's own `report.md`
  // reached `intake/documents/` as a generic document indistinguishable from
  // the operator's own writing — which made §3.1's "machine evidence does not
  // survive as carried input" false for exactly the prose that asserts what
  // the machine concluded. Keyed at every depth, like this tier's other
  // denylists and for the same reason: a tier-2 tree has no layout the
  // machine knows.
  if (RUN_CLAIM_BASENAMES.has(base)) {
    return { bucket: 'noted', reason: 'run-claim' };
  }
  // The one JSONL that can still be carried, keeping its own sealed/unsealed
  // rule (§3.4) in every tier: the operator's own words are not machine
  // evidence, and the denylist is deliberately not given this name.
  if (base === BRAINSTORM_LEDGER_NAME) {
    return { bucket: 'brainstorm-ledger' };
  }
  if (base.endsWith(LOCKFILE_SUFFIX)) {
    return { bucket: 'ignored', reason: 'lockfile' };
  }
  const ext = path.extname(base);
  if (ext !== '' && !TIER2_DOCUMENT_EXTENSIONS.has(ext)) {
    return { bucket: 'ignored', reason: `not a document extension ("${ext}")` };
  }
  return { bucket: 'document' };
}

// The bytes decide, not the extension alone: a `.json` full of NUL bytes is
// not a text document, and copying it into a directory the scout reads as
// prose would be a silent lie about what was found. Oversized, binary, and
// undecodable files are all LISTED — §3.3 step 4 — never dropped.
function readDocumentText(node, bins) {
  if (node.bytes > DOCUMENT_CEILING) {
    bins.ignored.push({
      path: node.rel,
      reason: `exceeds the ${DOCUMENT_CEILING}-byte document ceiling (${node.bytes} bytes)`,
    });
    return null;
  }
  let buffer;
  try {
    buffer = fs.readFileSync(node.abs);
  } catch (err) {
    bins.unreadable.push({ path: node.rel, reason: `unreadable (${err.code})` });
    return null;
  }
  if (buffer.includes(0)) {
    bins.ignored.push({ path: node.rel, reason: 'binary content (a NUL byte)' });
    return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    bins.ignored.push({ path: node.rel, reason: 'binary content (not decodable as UTF-8)' });
    return null;
  }
}

// §3.3 step 2: the first markdown heading, or the filename — READ, never
// inferred. A first line of prose is not a title, and treating it as one
// would put a sentence the operator never wrote in a title position.
function documentTitle(rel, text) {
  for (const line of text.split('\n')) {
    const heading = /^#{1,6}[ \t]+(\S.*?)[ \t]*$/.exec(line);
    if (heading) return heading[1];
  }
  return path.basename(rel);
}

// One counted ledger (`seals`, `audits`), read from whichever of its two
// forms exist. §3.4 binds this hard: INTAKE NEVER RECONCILES. Where a `.log`
// disagrees with its `.jsonl`, BOTH counts are recorded and neither file is
// repaired — a disagreement is not an error to fix, it is a fact about an
// interrupted run. The `.jsonl` is preferred as the truth where present
// (attestation.js:280-289 makes the `.log` its rendered projection).
function readCountedLedger(byRel, jsonlName, logName, unreadable, sliceOf) {
  const found = [];
  for (const name of [jsonlName, logName]) {
    const node = byRel.get(name);
    if (!node || node.kind !== 'file') continue;
    const text = readTextBounded(node, COUNT_READ_CEILING, unreadable);
    if (text === null) continue;
    found.push({ name, lines: nonEmptyLines(text) });
  }
  if (found.length === 0) return null;
  const preferred = found[0];
  const value = {
    count: preferred.lines.length,
    source: preferred.name,
    sources: found.map((f) => ({ file: f.name, count: f.lines.length })),
  };
  if (sliceOf) {
    value.slices = preferred.lines.map((line) => sliceOf(preferred.name, line)).filter((s) => s !== null);
  }
  return value;
}

// The one field both seal grammars share in the same position. No parser is
// written against either shape: the `.log` yields its first whitespace field,
// the `.jsonl` yields its own `slice` key, and a line that offers neither
// contributes nothing rather than a guess (§9.4.3).
function sealSliceOf(file, line) {
  if (file.endsWith('.jsonl')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.slice === 'string' && parsed.slice !== '') {
        return parsed.slice;
      }
    } catch {
      return null;
    }
    return null;
  }
  const first = line.trim().split(/\s+/)[0];
  return first === '' ? null : first;
}

// §3.4's three-value seal state, decided by PRESENCE alone — the harvester
// never verifies an old seal and never touches the old digest machinery.
// v3.1.8's `seal-law` writes the trio in the fixed order trio.hash ->
// lock.seal -> lock.hash (v318-artifact-formats.md §3), so `lock.hash` is
// that sequence's last write and therefore its witness: the same mechanism
// §9.1.3 uses for `routing/active.json`, named honestly rather than invented
// twice.
function lawSealState(byRel) {
  const present = (name) => {
    const node = byRel.get(name);
    return node !== undefined && node.kind === 'file';
  };
  if (present('law/lock.hash')) return 'sealed';
  if (present('law/lock.seal') || present('law/trio.hash')) return 'torn';
  return 'unsealed';
}

// §9.4.1: preservation bounds data loss; it does not bound operational
// disruption. These three commands are printed as a COURTESY, never as the
// defence — and never a `rm`, because only the operator decides what to
// discard.
function restoreCommands(projectRoot, treeRoot, archiveAbs) {
  const held = path.join(projectRoot, `${TREE_NAME}-restored`);
  const setAside = path.join(projectRoot, `${TREE_NAME}-v320-scaffold`);
  return [
    `mv "${archiveAbs}" "${held}"`,
    `mv "${treeRoot}" "${setAside}"`,
    `mv "${held}" "${treeRoot}"`,
  ];
}

// The renderer's own floor for the constraint validateIntakeReport states as
// a shape law. One value per Markdown line is what makes report.md
// mechanically readable, so the renderer keeps that true for whatever it is
// handed rather than trusting that validation ran first — the value escapes,
// it is never dropped, so nothing the operator needs goes missing and no
// value can break out of its own line.
const oneLine = (value) => String(value).replace(/\r/g, '\\r').replace(/\n/g, '\\n');

function renderReport(report) {
  const lines = [];
  lines.push('# Intake — the record of finding');
  lines.push('');
  lines.push(`- tier: ${oneLine(report.tier)}`);
  lines.push(`- markers: ${report.markers.length > 0 ? report.markers.map(oneLine).join(' · ') : '(none)'}`);
  lines.push(`- archive: ${oneLine(report.archive_path)}`);
  lines.push(
    `- newest file mtime in the archive: ${report.archive_mtime === null ? '(none)' : oneLine(report.archive_mtime)}`
  );
  lines.push(`- harvested: ${oneLine(report.harvested_utc)}`);
  lines.push('');
  lines.push('## Carried — flagged inputs, nothing more');
  lines.push('');
  if (report.carried.length === 0) {
    lines.push('Nothing in it could be carried forward honestly.');
  } else {
    for (const entry of report.carried) {
      const title = entry.title === undefined ? '' : ` · "${oneLine(entry.title)}"`;
      lines.push(
        `- ${oneLine(entry.path)} -> ${oneLine(entry.dest)} · role ${oneLine(entry.role)} · ${oneLine(entry.trust_flag)}${title}`
      );
    }
  }
  lines.push('');
  lines.push('## Noted — historical facts, binding nothing');
  lines.push('');
  if (report.tier === 1) {
    lines.push(`- law seal state: ${oneLine(report.noted.law_sealed)}`);
    lines.push(
      `- seals: ${report.noted.seals === null ? '(none)' : `${oneLine(report.noted.seals.count)} recorded in ${oneLine(report.noted.seals.source)}`}`
    );
    lines.push(
      `- audits: ${report.noted.audits === null ? '(none)' : `${oneLine(report.noted.audits.count)} recorded in ${oneLine(report.noted.audits.source)}`}`
    );
    lines.push(`- reviews: ${report.noted.reviews === null ? '(none)' : oneLine(report.noted.reviews.count)}`);
    lines.push(
      `- evidence generations: ${report.noted.evidence === null ? '(none)' : report.noted.evidence.generations.map(oneLine).join(' ')}`
    );
  } else {
    // Tier 2 reads no version's grammar (§3.3), so it has no count to state —
    // and rendering "seals: (none)" here would assert an ABSENCE the harvest
    // never established, in an archive that may hold seals it simply did not
    // read. What it can state is what it found, and where.
    lines.push(`- law seal state, by presence of the law digests alone: ${oneLine(report.noted.law_sealed)}`);
    const machineEvidence = report.noted.entries.filter((entry) => entry.reason === 'machine-evidence');
    lines.push(
      `- machine evidence found: ${machineEvidence.length} file(s), each named in report.json — recorded and located, never counted or interpreted`
    );
    for (const entry of machineEvidence) lines.push(`  - ${oneLine(entry.path)}`);
  }
  lines.push(`- other noted entries: ${report.noted.entries.length}`);
  lines.push(`- ignored: ${report.ignored.length} · unreadable: ${report.unreadable.length}`);
  // Honest truncation, in the document the operator actually reads: a report
  // that listed a subset without saying so would be read as the whole archive.
  if (report.truncated) {
    lines.push(
      `- the walk was TRUNCATED at the entry ceiling — what is listed above is what was walked, not everything under ${oneLine(report.archive_path)}`
    );
  }
  lines.push('');
  lines.push('What it proved, it proved for the old fire. No seal, no gate, and no');
  lines.push('resume point was carried forward, and nothing in the archive was deleted.');
  lines.push('');
  lines.push('## If this was a mistake');
  lines.push('');
  lines.push('```');
  for (const cmd of report.restore_commands) lines.push(oneLine(cmd));
  lines.push('```');
  if (report.residue_path !== null) {
    lines.push('');
    lines.push(
      `An interrupted scaffold was kept whole at ${oneLine(report.residue_path)} (${report.aborted_scaffolds.map(oneLine).join(' ')}). Remove it when you no longer want it:`
    );
    lines.push('');
    lines.push('```');
    lines.push(`rm -r "${oneLine(report.residue_path)}"`);
    lines.push('```');
  }
  lines.push('');
  return lines.join('\n');
}

// The plan phase, shared by both tiers. ZERO MUTATION (§9.2.4): every path
// below is lstat'd, every destination is containment-checked, and the whole
// report is validated — a failure anywhere throws with nothing written.
//
// The tiers differ in exactly two places: how ONE archive path is classified,
// and which noted facts the walk yields. The destination bookkeeping, the
// report assembly, the validation, and the containment pass are ONE mechanism
// serving both, so a rule proven for tier 1 cannot quietly drift out of tier 2
// behind a second copy of it.
function newBins(walk) {
  return {
    carried: [],
    notedEntries: [],
    ignored: [],
    unreadable: [...walk.unreadable],
    verbatim: [],
    copies: [],
    destDirs: new Set(),
    takenDests: new Map(),
  };
}

// The one place a source file becomes a planned destination, in either tier.
// `destRel` is the intake-relative path the caller chose — a typed directory
// plus the basename in tier 1, the archive-relative path itself in tier 2 —
// and the collision guard is shared, because two sources landing on one
// destination silently keeps whichever was copied last.
function claimCarried(ctx, bins, node, claim) {
  // fs.copyFileSync FOLLOWS symlinks on its source, so it is reached only
  // after the walk's lstat has proven a regular file. That ordering is the
  // contract, not an implementation detail.
  let fd;
  try {
    fd = fs.openSync(node.abs, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch (err) {
    bins.unreadable.push({ path: node.rel, reason: `unreadable (${err.code})` });
    return;
  }
  fs.closeSync(fd);
  const dest = `${INTAKE_DIR_NAME}/${claim.destRel}`;
  const already = bins.takenDests.get(dest);
  if (already !== undefined) {
    throw refuse(
      `two archived documents ("${already}" and "${node.rel}") both plan to land at "${dest}" — refusing to overwrite one with the other`
    );
  }
  bins.takenDests.set(dest, node.rel);
  const destAbs = path.join(ctx.treeRoot, ...dest.split('/'));
  bins.destDirs.add(path.dirname(destAbs));
  const entry = { path: node.rel, dest, role: claim.role, trust_flag: claim.trust_flag, bytes: node.bytes };
  if (claim.title !== undefined) {
    // §3.3's per-document record, and the only handle the scout has on a
    // document it has not opened: the title as READ, and the file's own mtime.
    entry.title = claim.title;
    entry.mtime = node.mtimeMs === null ? null : new Date(node.mtimeMs).toISOString();
  }
  bins.carried.push(entry);
  bins.copies.push({ src: node.abs, dest: destAbs });
}

function planTier1(ctx, walk, byRel, bins) {
  for (const node of walk.nodes) {
    const verdict = classifyTier1(node);
    switch (verdict.bucket) {
      case 'carried':
        claimCarried(ctx, bins, node, {
          role: verdict.role,
          trust_flag: verdict.trust_flag,
          destRel: `${ROLE_DEST_DIR[verdict.role]}/${path.basename(node.rel)}`,
        });
        break;
      case 'brainstorm-ledger': {
        const text = readTextBounded(node, COUNT_READ_CEILING, bins.unreadable);
        if (text === null) break;
        if (brainstormLedgerSealed(text)) {
          claimCarried(ctx, bins, node, {
            role: 'vision',
            trust_flag: 'inherited-unverified',
            destRel: `${ROLE_DEST_DIR.vision}/${path.basename(node.rel)}`,
          });
        } else {
          bins.notedEntries.push({ path: node.rel, reason: 'unsealed-brainstorm-ledger' });
        }
        break;
      }
      case 'verbatim': {
        if (node.bytes > VERBATIM_CEILING) {
          bins.verbatim.push({ path: node.rel, bytes: node.bytes, text: null, truncated: true });
          bins.notedEntries.push({ path: node.rel, reason: 'verbatim' });
          break;
        }
        let text;
        try {
          text = fs.readFileSync(node.abs, 'utf8');
        } catch (err) {
          bins.unreadable.push({ path: node.rel, reason: `unreadable (${err.code})` });
          break;
        }
        bins.verbatim.push({ path: node.rel, bytes: node.bytes, text, truncated: false });
        bins.notedEntries.push({ path: node.rel, reason: 'verbatim' });
        break;
      }
      case 'ignored':
        bins.ignored.push({ path: node.rel, reason: verdict.reason });
        break;
      default: {
        const entry = { path: node.rel, reason: verdict.reason };
        if (verdict.reason === 'symlink') entry.link_target = verdict.link_target;
        bins.notedEntries.push(entry);
        break;
      }
    }
  }

  const generations = walk.dirs
    .filter((rel) => rel.startsWith('evidence/') && rel.split('/').length === 2)
    .map((rel) => rel.slice('evidence/'.length))
    .sort();
  const reviewsNode = byRel.get('reviews.jsonl');
  let reviews = null;
  if (reviewsNode !== undefined && reviewsNode.kind === 'file') {
    const text = readTextBounded(reviewsNode, COUNT_READ_CEILING, bins.unreadable);
    if (text !== null) reviews = { count: nonEmptyLines(text).length };
  }
  return {
    law_sealed: lawSealState(byRel),
    seals: readCountedLedger(byRel, 'seals.jsonl', 'seals.log', bins.unreadable, sealSliceOf),
    audits: readCountedLedger(byRel, 'audits.jsonl', 'audits.log', bins.unreadable, null),
    reviews,
    evidence: generations.length === 0 ? null : { count: generations.length, generations },
  };
}

// §3.3's generic harvest. The counted `noted` facts tier 1 reads are ALL NULL
// here, and deliberately: counting `seals.log`'s lines or naming an
// `evidence/gen-N` generation means reading a v3 grammar into a tree whose
// family the machine could not even recognize. Every machine-evidence file is
// still named and located in `noted.entries` — reported, never interpreted,
// never silently dropped.
function planTier2(ctx, walk, byRel, bins) {
  for (const node of walk.nodes) {
    const verdict = classifyTier2(node);
    switch (verdict.bucket) {
      case 'document': {
        const text = readDocumentText(node, bins);
        if (text === null) break;
        // Structure-preserved (§3.3 step 3): the archive-relative path IS the
        // destination path. Flattening to basenames would collide two
        // `notes.md` from different directories and keep only one.
        claimCarried(ctx, bins, node, {
          role: 'document',
          trust_flag: 'inherited-unverified',
          destRel: `${ROLE_DEST_DIR.document}/${node.rel}`,
          title: documentTitle(node.rel, text),
        });
        break;
      }
      case 'brainstorm-ledger': {
        const text = readTextBounded(node, COUNT_READ_CEILING, bins.unreadable);
        if (text === null) break;
        if (brainstormLedgerSealed(text)) {
          claimCarried(ctx, bins, node, {
            role: 'vision',
            trust_flag: 'inherited-unverified',
            destRel: `${ROLE_DEST_DIR.vision}/${path.basename(node.rel)}`,
            title: documentTitle(node.rel, text),
          });
        } else {
          bins.notedEntries.push({ path: node.rel, reason: 'unsealed-brainstorm-ledger' });
        }
        break;
      }
      case 'ignored':
        bins.ignored.push({ path: node.rel, reason: verdict.reason });
        break;
      default: {
        const entry = { path: node.rel, reason: verdict.reason };
        if (verdict.reason === 'symlink') entry.link_target = verdict.link_target;
        bins.notedEntries.push(entry);
        break;
      }
    }
  }
  return {
    // Presence, not parsing: whether a `law/lock.hash` is on disk is a
    // filesystem fact in any family, and it is the only one of these six the
    // generic harvest can state without reading a grammar it does not know.
    law_sealed: lawSealState(byRel),
    seals: null,
    audits: null,
    reviews: null,
    evidence: null,
  };
}

function planHarvest(ctx) {
  const { treeRoot, treeRootReal, archiveReal, txn } = ctx;
  const walk = walkArchive(archiveReal);
  const byRel = new Map(walk.nodes.map((node) => [node.rel, node]));
  const bins = newBins(walk);

  const noted = txn.tier === 1 ? planTier1(ctx, walk, byRel, bins) : planTier2(ctx, walk, byRel, bins);

  // A file whose content could not be read is recorded in unreadable[] and
  // must not also be claimed anywhere else: one bucket per file, so the
  // report and the archive can be compared entry for entry.
  const unreadablePaths = new Set(bins.unreadable.map((entry) => entry.path));
  const keep = (entry) => !unreadablePaths.has(entry.path);

  const projectRoot = path.dirname(treeRoot);
  // What the report says was kept is read off the marker, not off the record.
  // A partial scaffold whose `persist` was lost is on disk and absent from
  // `txn.aborted_scaffolds`; a report built from the record would name
  // neither it nor the residue it is kept in, and would say so in a document
  // whose whole purpose is telling the operator what became of their tree.
  const kept = inspectMarker(ctx.markerPath).aborted;
  const residuePath = kept.length === 0 ? null : residuePathOf(ctx);

  const report = {
    schema_version: REPORT_SCHEMA_VERSION,
    txn_id: txn.txn_id,
    tier: txn.tier,
    markers: Array.isArray(txn.markers) ? txn.markers : [],
    archive_path: txn.archive_path,
    // Worded everywhere it is rendered as a FILE fact, because that is what
    // it is: no seal or audit row at v3.1.8 carries a timestamp, so the
    // archive's newest mtime is the only honest date the harvest has. An
    // earlier draft specified a `noted.seals.last_ts`; it is struck for the
    // same reason a `stopped_at` field is absent here — a legacy tree
    // records no verified stop timestamp anywhere, and a field the harvester
    // would have to invent or silently drop is worse than an absent clause.
    archive_mtime: walk.newestMtimeMs === null ? null : new Date(walk.newestMtimeMs).toISOString(),
    aborted_scaffolds: kept,
    residue_path: residuePath,
    restore_commands: restoreCommands(projectRoot, treeRoot, path.join(projectRoot, txn.archive_path)),
    carried: bins.carried.filter(keep),
    noted: {
      law_sealed: noted.law_sealed,
      seals: noted.seals,
      audits: noted.audits,
      reviews: noted.reviews,
      evidence: noted.evidence,
      verbatim: bins.verbatim.filter(keep),
      entries: bins.notedEntries.filter(keep),
    },
    ignored: bins.ignored.filter(keep),
    unreadable: bins.unreadable,
    truncated: walk.truncated,
    harvested_utc: nowUtc(),
  };

  const verdict = validateIntakeReport(report);
  if (!verdict.ok) {
    // The plan phase mutates nothing, so this refusal is recoverable by
    // construction: whatever the archive holds that the report cannot state
    // honestly, the operator fixes it in place and re-runs. Saying where to
    // look and that a re-run resumes is the difference between a refusal and
    // a dead end.
    throw refuse(
      `refusing to write an invalid intake report — ${verdict.errors.join('; ')}. ` +
        `Nothing was read, written, or removed: the legacy tree is whole at "${ctx.archivePath}" and the transaction stays at phase "placed", so a re-run resumes it once the cause is fixed.`
    );
  }

  const keptDests = new Set(report.carried.map((entry) => entry.dest));
  const plannedCopies = bins.copies.filter((copy) =>
    keptDests.has(path.relative(treeRoot, copy.dest).split(path.sep).join('/'))
  );
  const plannedDirs = [...new Set(plannedCopies.map((copy) => path.dirname(copy.dest)))];

  // Every destination leaf, never once on `intake/` (§9.2.2). In tier 2 the
  // destination directories are nested to the archive's own depth, which is
  // exactly what the deepest-existing-prefix resolution is for: a planted
  // `intake/documents/a -> /outside` is resolved and refused at any level.
  const intakeDir = path.join(treeRoot, INTAKE_DIR_NAME);
  validateContainedTarget(treeRootReal, intakeDir);
  for (const dir of plannedDirs) validateContainedTarget(treeRootReal, dir);
  for (const copy of plannedCopies) validateContainedTarget(treeRootReal, copy.dest);
  const reportJsonPath = path.join(intakeDir, REPORT_JSON_NAME);
  const reportMdPath = path.join(intakeDir, REPORT_MD_NAME);
  validateContainedTarget(treeRootReal, reportMdPath);
  validateContainedTarget(treeRootReal, reportJsonPath);
  // The ledger is the harvest's fourth destination, and the sweep's job is to
  // refuse before the first mutation — so it is proven here too, not only at
  // the append.
  validateContainedTarget(treeRootReal, path.join(treeRoot, LEDGER_FILENAME));

  return { report, copies: plannedCopies, destDirs: plannedDirs, reportJsonPath, reportMdPath };
}

// O_NOFOLLOW is what turns "we lstat'd this earlier and it was a regular
// file" into "the descriptor open right now is not a symlink". Node exposes
// it on the POSIX platforms this machine targets; where the constant is
// absent the open degrades to a following one — the behaviour that existed
// before this guard, never a new weakness.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

const COPY_CHUNK_BYTES = 64 * 1024;

// The copy, bound to DESCRIPTORS rather than to pathnames. `copyFileSync`
// resolves both of its arguments afresh at the moment it runs, so the walk's
// proof that a source is a regular file and the plan's proof that a
// destination is not a symlink were each re-litigated by the filesystem —
// against whatever those paths meant by the time the copy got to them.
// Opening each end once with O_NOFOLLOW makes the proof and the use the same
// act, which is the only version of "no source symlink is ever followed"
// that holds against a writer acting during the harvest rather than before
// it.
//
// Bytes move through a fixed buffer rather than a whole-file read: a carried
// tier-1 document has no size ceiling (only tier 2's generic documents do),
// so reading one in would put an archive's largest file in memory.
function copyNoFollow(src, dest) {
  let srcFd;
  try {
    srcFd = fs.openSync(src, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch (err) {
    throw refuse(
      `hazard — "${src}" is no longer the regular file the plan proved it to be (${err.code}); nothing was copied from it`
    );
  }
  let destFd;
  try {
    destFd = fs.openSync(
      dest,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | O_NOFOLLOW,
      0o600
    );
  } catch (err) {
    fs.closeSync(srcFd);
    throw refuse(`hazard — "${dest}" is not a plain file to write (${err.code}); nothing was written through it`);
  }
  try {
    const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
    for (;;) {
      const read = fs.readSync(srcFd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      // Both ends can be short: a read may return less than the buffer, and
      // a write may take less than it was given. Looping on the write is
      // what keeps a carried document from being silently truncated — the
      // one failure mode of a hand-rolled copy that no later step would
      // notice, because a short file is still a valid file.
      let written = 0;
      while (written < read) {
        written += fs.writeSync(destFd, buffer, written, read - written);
      }
    }
    // The carried copy keeps the archived file's permission bits, which is
    // what copyFileSync did and what keeps a copy readable exactly where its
    // source was.
    fs.fchmodSync(destFd, fs.fstatSync(srcFd).mode & 0o777);
  } finally {
    fs.closeSync(srcFd);
    fs.closeSync(destFd);
  }
}

// The commit phase. Directories first, then every copy, then report.md, then
// report.json LAST — it is the harvest-committed witness (§9.1.3), so a crash
// anywhere before it leaves no report and the phase still at `placed`, and
// the whole pass simply re-runs: the archive is frozen and nothing but intake
// writes under `intake/`, so re-planning yields the identical plan and
// re-copying is idempotent. No reconciliation, no partial-publication
// bookkeeping.
//
// The plan's containment sweep runs again here, per directory, immediately
// before that directory is created. It is the same check for the same
// invariant, not a second mechanism: the sweep's job is to refuse before the
// first mutation, and this one's is to bind at the moment of use, because
// `mkdirSync` re-resolves a pathname the sweep proved some copies ago.
function commitHarvest(ctx, plan) {
  ensureTreeSubdir(ctx.treeRoot, INTAKE_DIR_NAME);
  for (const dir of plan.destDirs) {
    validateContainedTarget(ctx.treeRootReal, dir);
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const copy of plan.copies) copyNoFollow(copy.src, copy.dest);
  writeAtomicText(plan.reportMdPath, renderReport(plan.report));
  writeAtomic(plan.reportJsonPath, plan.report);
}

// §9.1.5's exactly-once, keyed on the transaction identity itself rather than
// on an "already done?" flag: the identity IS the flag, and it lives in the
// record. The window between the append and the retirement is closed by this
// same read on re-entry — the record is found, the append is skipped, the
// marker is retired.
function appendIntakeRecordOnce(ctx, report) {
  const ledgerPath = path.join(ctx.treeRoot, LEDGER_FILENAME);
  // The ledger is a destination intake writes to, and it was the one write
  // path no containment check ever saw: `appendRecord` appends by pathname,
  // and appending follows a symlink, so a planted `ledger.jsonl -> outside`
  // put an intake record outside the tree. Checked here, immediately before
  // the read-and-append that binds it, and again in the plan sweep so a
  // `placed` harvest refuses before it copies anything.
  validateContainedTarget(ctx.treeRootReal, ledgerPath);
  const { records } = readAll(ledgerPath);
  const already = records.some(
    (record) =>
      record !== null &&
      typeof record === 'object' &&
      record.kind === INTAKE_RECORD_KIND &&
      record.txn_id === ctx.txn.txn_id
  );
  if (already) return;
  appendRecord(ledgerPath, {
    kind: INTAKE_RECORD_KIND,
    payload: {
      txn_id: ctx.txn.txn_id,
      tier: report.tier,
      archive_path: report.archive_path,
      markers: report.markers,
      carried_count: report.carried.length,
      noted_count: report.noted.entries.length,
      aborted_scaffolds: report.aborted_scaffolds,
    },
    correlation_id: ctx.txn.txn_id,
  });
}

// Marker retirement, the transaction's last act (§9.1.4), decided by reading
// the marker rather than the record. With the directory holding nothing but
// this transaction's own txn.json and its own lockfile, both authored by this
// transaction, it is removed. With anything kept inside it NOTHING IS
// DELETED: the whole marker is renamed aside and named in the report, with
// the one command that removes it. Row 0 probes only the fixed name, so the
// residue can never re-trigger intake.
//
// `foreign` cannot appear here — runHarvest refuses on it before the plan
// phase, where a refusal leaves the filesystem byte-identical — so this
// reads the same partition one last time at the moment it acts on it.
function retireTransaction(ctx) {
  const held = inspectMarker(ctx.markerPath);
  if (held.foreign.length > 0) {
    throw refuse(
      `hazard — "${ctx.markerPath}" holds ${held.foreign.map((name) => `"${name}"`).join(', ')}, which this transaction did not author; refusing to retire a marker it cannot account for`
    );
  }
  if (held.aborted.length === 0) {
    // Plain rmSync, no tolerance flag: the marker provably exists here —
    // this transaction is holding the lock that lives inside it — and the
    // one guard this module keeps against the destructive scaffold option
    // is a source-text one, so no line here spells that word at all.
    fs.rmSync(ctx.markerPath, { recursive: true });
    return null;
  }
  const residue = residuePathOf(ctx);
  if (nodeTypeOf(residue) !== null) {
    throw refuse(`hazard — "${residue}" is already occupied; refusing to move the transaction residue onto it`);
  }
  fs.renameSync(ctx.markerPath, residue);
  return residue;
}

// Where a kept marker goes. One derivation, read by the plan phase that names
// it in the report and by the retirement that performs the move, so the
// report cannot name a path the retirement does not use.
function residuePathOf(ctx) {
  return path.join(ctx.projectRoot, `${INTAKE_MARKER_NAME}-aborted-${ctx.txn.txn_id}`);
}

// The committed report, re-read as the witness itself: at phase `harvested`
// the copy work is already done, and re-entry must not re-plan against an
// archive it has already published from.
function readCommittedReport(ctx) {
  const reportPath = path.join(ctx.treeRoot, INTAKE_DIR_NAME, REPORT_JSON_NAME);
  if (nodeTypeOf(reportPath) !== 'file') {
    throw refuse(
      `hazard — the transaction records phase "harvested" but "${reportPath}" is not a regular file; the harvest cannot be accounted for`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    throw refuse(`hazard — "${reportPath}" is not parseable JSON`);
  }
  const verdict = validateIntakeReport(parsed);
  if (!verdict.ok) {
    throw refuse(`hazard — "${reportPath}" is not a valid intake report (${verdict.errors.join('; ')})`);
  }
  return parsed;
}

function runHarvest(ctx) {
  assertMarkerIsRealDirectory(ctx);
  const existing = readTransaction(ctx.txnPath, ctx.projectRootReal);
  if (existing === null) {
    throw refuse(
      `no intake transaction is in flight at "${ctx.markerPath}" — a harvest only ever continues a transaction the archive half claimed`
    );
  }
  ctx.txn = existing;

  if (ctx.txn.phase !== 'placed' && ctx.txn.phase !== 'harvested') {
    throw refuse(
      `refusing to harvest — the transaction at "${ctx.markerPath}" is at phase "${ctx.txn.phase}"; run the archive half to "placed" first`
    );
  }

  // §9.1.4's two rows the harvest half owns, read from disk before the plan
  // phase so a refusal leaves the filesystem byte-identical. At `placed` and
  // at `harvested` the set-aside tree has already been filed under
  // `archive/legacy-N`: anything at `<marker>/tree` is a SECOND whole tree an
  // outside writer put there, and intake does not guess past one — the
  // archive half refuses the same shape at `scaffolded`.
  const stashedType = nodeTypeOf(ctx.markerTreePath);
  if (stashedType !== null) {
    throw refuse(
      `hazard — a tree is present at "${ctx.markerTreePath}" while the transaction is at phase "${ctx.txn.phase}", where the set-aside tree is already filed at "${ctx.txn.archive_path}"; an outside writer acted and intake does not guess past one`
    );
  }
  // The same reading for everything else the marker holds: retirement may
  // remove only this transaction's own two files, so an entry it cannot
  // account for is refused here rather than discovered at the moment of
  // deletion, when the harvest has already committed.
  const held = inspectMarker(ctx.markerPath);
  if (held.foreign.length > 0) {
    throw refuse(
      `hazard — "${ctx.markerPath}" holds ${held.foreign.map((name) => `"${name}"`).join(', ')}, which this transaction did not author; nothing was read, written, or removed`
    );
  }

  if (ctx.txn.archive_path !== ctx.archiveRelative) {
    throw refuse(
      `the archive source "${ctx.archivePath}" does not match the transaction's recorded archive_path ("${ctx.txn.archive_path}")`
    );
  }

  let report;
  if (ctx.txn.phase === 'placed') {
    if (ctx.txn.tier !== 1 && ctx.txn.tier !== 2) {
      // Guessing a tier would decide the honesty of every entry in the report
      // by default, so this refuses — but it must not refuse into a dead end.
      // A tier is recorded once, at mint, from detect's own verdict, so no
      // transaction this machine started can carry another: the record came
      // from somewhere else, and while the marker stands detect's row 0 routes
      // every entry straight back to it. The refusal therefore names the one
      // move that closes the transaction, and it is a `mv`, never a `rm` —
      // only the operator decides what to discard.
      throw refuse(
        `refusing to harvest — the transaction at "${ctx.markerPath}" records tier ${ctx.txn.tier === undefined ? 'null' : JSON.stringify(ctx.txn.tier)}, and the harvest has exactly two: 1 (typed) and 2 (generic). A tier is recorded at mint from detect's own verdict, so this record was not written by intake. ` +
          `Nothing was read, written, or removed: the legacy tree is whole at "${ctx.archivePath}" and the fresh tree at "${ctx.treeRoot}" is complete. ` +
          `To close the transaction, move the marker aside — mv "${ctx.markerPath}" "${ctx.markerPath}-abandoned" — after which detect reads the fresh tree and nothing under "${ctx.archivePath}" is affected.`
      );
    }
    const plan = planHarvest(ctx);
    commitHarvest(ctx, plan);
    persist(ctx, { phase: 'harvested' });
    report = plan.report;
  } else {
    report = readCommittedReport(ctx);
  }

  appendIntakeRecordOnce(ctx, report);
  retireTransaction(ctx);
  return report;
}

// harvestLegacy(treeRoot, archivePath) -> the intake report.
//
// Runs the transaction from phase `placed` to committed: plan, validate,
// copy, report, ledger, retire. Re-entrant — a crash anywhere re-runs the
// whole pass from the recorded phase, and the ledger record is exactly-once
// per transaction identity forever.
//
// treeRoot is the `<TREE_NAME>` directory itself; archivePath is the
// `<tree>/archive/legacy-N` directory the archive half filed. Both are
// validated here, by this module, and never trusted from an earlier detect()
// call having run (§9.2.1).
function harvestLegacy(treeRoot, archivePath) {
  if (typeof treeRoot !== 'string' || treeRoot === '') {
    throw new TypeError('harvestLegacy: treeRoot must be a non-empty string');
  }
  if (typeof archivePath !== 'string' || archivePath === '') {
    throw new TypeError('harvestLegacy: archivePath must be a non-empty string');
  }

  const treeType = nodeTypeOf(treeRoot);
  if (treeType === null) throw refuse(`the tree does not exist: "${treeRoot}"`);
  if (treeType !== 'dir') throw refuse(`"${treeRoot}" is not a real directory (${treeType})`);
  if (path.basename(treeRoot) !== TREE_NAME) {
    throw refuse(`"${treeRoot}" is not a "${TREE_NAME}" tree`);
  }
  const treeRootReal = fs.realpathSync(treeRoot);
  const archiveReal = resolveArchiveSource(treeRootReal, archivePath);

  const projectRoot = path.dirname(treeRoot);
  const projectRootType = nodeTypeOf(projectRoot);
  if (projectRootType !== 'dir') {
    throw refuse(`"${projectRoot}" is not a real directory (${projectRootType === null ? 'absent' : projectRootType})`);
  }
  const projectRootReal = fs.realpathSync(projectRoot);
  const markerPath = path.join(projectRoot, INTAKE_MARKER_NAME);

  const ctx = {
    projectRoot,
    projectRootReal,
    treeRoot,
    treeRootReal,
    archivePath,
    archiveReal,
    // The project-root-relative form the transaction record carries, so the
    // two are compared as the same string rather than as two path spellings.
    archiveRelative: path.join(TREE_NAME, ARCHIVE_DIR_NAME, path.basename(archiveReal)),
    markerPath,
    markerTreePath: path.join(markerPath, MARKER_TREE_NAME),
    txnPath: path.join(markerPath, INTAKE_TXN_FILENAME),
    txn: null,
    preLockTxn: null,
  };

  // Pre-lock validation (§9.1.2), before the first mutation of any kind:
  // withLock's recursive mkdirSync would both FOLLOW a pre-planted symlink at
  // the marker path and CREATE a marker directory where no transaction ever
  // existed. Refusing here leaves the project byte-identical in both cases.
  const markerType = nodeTypeOf(markerPath);
  if (markerType === null) {
    throw refuse(
      `no intake transaction is in flight at "${markerPath}" — a harvest only ever continues a transaction the archive half claimed`
    );
  }
  if (markerType !== 'dir') {
    throw refuse(`"${markerPath}" exists but is not a real directory (${markerType})`);
  }
  ctx.preLockTxn = readTransaction(ctx.txnPath, projectRootReal);

  return withIntakeLock(ctx, () => runHarvest(ctx));
}

// CLI entrypoint — the flat one-command convention detect.js/milestones.js/
// phases.js/verification.js/quarantine.js/delivery.js already establish, with
// scaffold.js's own `--routing <datedConfigPath>` flag for the config the
// fresh genesis needs. Fails closed on a surplus positional or an unknown
// flag: every token is accounted for.
function parseArgv(argv) {
  const positional = [];
  let routingConfigPath;
  let error = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--routing') {
      routingConfigPath = argv[i + 1];
      i++;
    } else if (arg.startsWith('--')) {
      error = error || `unrecognized flag: ${arg}`;
    } else {
      positional.push(arg);
    }
  }
  // `archive` takes one positional, `harvest` takes two; the arity is read
  // from the command so a surplus token is still refused by name in both.
  const [command, ...operands] = positional;
  const arity = command === 'harvest' ? 2 : 1;
  const rest = operands.slice(arity);
  if (!error && rest.length > 0) error = `unexpected extra argument(s): ${rest.join(' ')}`;
  return { command, operands: operands.slice(0, arity), routingConfigPath, error };
}

const USAGE =
  'usage: intake.js archive <projectRoot> --routing <datedConfigPath>\n' +
  '       intake.js harvest <treeRoot> <archivePath>\n';

function main(argv) {
  const { command, operands, routingConfigPath, error } = parseArgv(argv);
  const archiveOk = command === 'archive' && operands[0] && routingConfigPath;
  const harvestOk = command === 'harvest' && operands[0] && operands[1] && routingConfigPath === undefined;
  if ((!archiveOk && !harvestOk) || error) {
    if (error) process.stderr.write(`intake.js: ${error}\n`);
    process.stderr.write(USAGE);
    process.exit(1);
    return;
  }
  try {
    const result = archiveOk
      ? archiveLegacyTree(operands[0], { routingConfigPath })
      : harvestLegacy(operands[0], operands[1]);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`intake.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

// `renderIntakeReport` is exported for the render guard's own test: the
// rendering law — one report value per Markdown line, whatever the value
// carries — is a property of this function, and testing it through a committed
// report could only ever exercise reports that already passed validation.
module.exports = { archiveLegacyTree, harvestLegacy, renderIntakeReport: renderReport };
