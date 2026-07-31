'use strict';

// Onboarding mode detection: greenfield / brownfield / resume detection,
// extended to a three-tier legacy recognition ladder. Pure
// evidence-gathering — this module makes no decisions beyond the five-way
// classification and its honest refusals; the onboarding phase itself owns
// what happens next in each mode.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { checkIntakeTxn } = require('./validators.js');

const TREE_NAME = '.kiln';
const STATE_FILENAME = 'state.json';

// The intake transaction's marker sibling. The name is FIXED, never
// timestamped, so its cardinality is zero-or-one by construction —
// "several sibling markers" is unreachable rather than handled. Derived
// from TREE_NAME so the package rename carries both names together, with
// no second literal to keep in sync.
const INTAKE_MARKER_NAME = `${TREE_NAME}-intake`;
const INTAKE_TXN_FILENAME = 'txn.json';

// The v3 Law shape, partitioned. Recognition asks one question and never
// asks a version: does this tree's shape support a typed harvest? A STRONG
// marker is a shape only the Kiln v3 family writes; a CORROBORATING marker
// is present in that family without being exclusive to it. Tier 1 requires
// >=1 strong AND >=2 slots total — one stray LAW.md is not the v3 Law
// shape, and `decisions.md` + `posture.json` is not either. Nothing is
// refused either way: a tree under the bar lands in tier 2 and is still
// archived whole and harvested generically.
//
// Each slot declares the node type its marker must be. A slot listing two
// names is satisfied by either one (the seal record is `seals.log` at
// v3.1.8, `seals.jsonl` in the current version) and counts exactly once.
const TIER1_STRONG = [
  { names: ['LAW.md'], type: 'file' },
  { names: ['slices.json'], type: 'file' },
  { names: ['law'], type: 'dir' },
  { names: ['seals.log', 'seals.jsonl'], type: 'file' },
];
const TIER1_CORROBORATING = [
  { names: ['decisions.md'], type: 'file' },
  { names: ['posture.json'], type: 'file' },
  { names: ['docs/project-brief.md'], type: 'file' },
  { names: ['docs/feasibility.md'], type: 'file' },
];

// Bounds the recursive scan against pathological trees; six levels covers
// any conventional project layout (src/lib/pkg/module/... nesting) without
// risking runaway walks.
const MAX_SCAN_DEPTH = 6;

function isGitRepo(projectRoot) {
  const res = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  return res.status === 0 && res.stdout.trim() === 'true';
}

function hasGitCommits(projectRoot) {
  const res = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--verify', '--quiet', 'HEAD'], {
    encoding: 'utf8',
  });
  return res.status === 0;
}

// Short-circuiting recursive walk: stops at the first qualifying entry
// found. Dot-directories (and dot-files) are excluded at every level — this
// also keeps the walk out of .git and .kiln without special-casing
// either by name. ANY regular file outside a dot-dir counts as evidence of
// pre-existing project material: a narrow source-extension allowlist would
// call HTML/CSS/Vue/Svelte/Terraform/config/package-only and extensionless
// projects "greenfield" even though real project material already exists
// there — this is a deliberately broad, fail-closed heuristic, not a
// language registry.
function hasProjectMaterial(dir, depth = 0) {
  if (depth > MAX_SCAN_DEPTH) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // never follow symlinks into a scan (loop risk)
    if (entry.isDirectory()) {
      if (hasProjectMaterial(full, depth + 1)) return true;
    } else if (entry.isFile()) {
      return true;
    }
  }
  return false;
}

// A resume claim needs more than "a path exists at state.json": a
// directory, unparseable text, or `{}` at that path must never be reported
// as a resumable build. Requires a regular file, parseable JSON, a plain
// object, and non-empty string `phase`/`next_action` fields — the two
// fields the wake digest promises to report to the operator on resume.
function isValidStateFile(statePath) {
  let stat;
  try {
    // lstat, never stat: a marker must be a REGULAR FILE, and this module
    // already reads every tier-1 marker that way — a symlink is never the
    // marker, it is a pointer at something else. Following one here would
    // let a planted link win row 1 over a genuine legacy tree, suppressing a
    // real migration and handing `phases.js resume` a state file that does
    // not live in the tree.
    stat = fs.lstatSync(statePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  let raw;
  try {
    raw = fs.readFileSync(statePath, 'utf8');
  } catch {
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (typeof parsed.phase !== 'string' || parsed.phase === '') return false;
  if (typeof parsed.next_action !== 'string' || parsed.next_action === '') return false;
  // The stricter current-tree proof: scaffold.js stamps `schema_version: 1`
  // at genesis and every later state writer spreads `...state` forward, so
  // it survives every write of a real current tree. No legacy shape carries
  // it — released v3.1.8 has no state.json at all, and other kiln versions
  // write stage/next_action_key/revision instead. This one field is what
  // keeps row 1 from claiming a foreign state file as a resumable build.
  if (parsed.schema_version !== 1) return false;
  return true;
}

// Row 1's question — "is this a resumable CURRENT tree?" — named and
// exported so intake can ask it at the one step that moves a tree, rather
// than writing a second recognizer inside the module that acts on the answer.
// One classifier in the machine, asked by everyone who needs its verdict.
function isResumableTree(treeDir) {
  return isValidStateFile(path.join(treeDir, STATE_FILENAME));
}

// lstat one path and report what node it actually is — never what a symlink
// at that path points at. `null` means "not there" (ENOENT, or ENOTDIR when
// an expected parent directory is a regular file). Any other errno is a
// REFUSAL naming the path and the code: an unreadable tree is not evidence
// of absence, and detect never guesses past an errno.
function nodeTypeOf(target) {
  let lst;
  try {
    lst = fs.lstatSync(target);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw new Error(`detect: refusing to classify — "${target}" is unreadable (${err.code})`);
  }
  if (lst.isSymbolicLink()) return 'symlink';
  if (lst.isDirectory()) return 'dir';
  if (lst.isFile()) return 'file';
  return 'other';
}

// One marker slot -> the name actually found, or null. Every counted marker
// must match its declared node type, and a symlink is NEVER counted: it is
// not the marker, it is a pointer at something else.
function markerFound(treeDir, slot) {
  for (const name of slot.names) {
    if (nodeTypeOf(path.join(treeDir, name)) === slot.type) return name;
  }
  return null;
}

// collectTier1Markers(treeDir) -> {markers, strong}. `markers` carries what
// was actually found, in declaration order, one entry per satisfied slot —
// so the operator line names real evidence rather than a bare verdict, and
// `markers.length` is exactly the count the tier bar reads. Only depth-1
// paths plus the `law/` and `docs/` probes are ever consulted: no path
// under `archive/` is a marker, so a tree that has already been through
// intake cannot re-trigger it.
function collectTier1Markers(treeDir) {
  const markers = [];
  let strong = 0;
  for (const slot of TIER1_STRONG) {
    const found = markerFound(treeDir, slot);
    if (found !== null) {
      markers.push(found);
      strong += 1;
    }
  }
  for (const slot of TIER1_CORROBORATING) {
    const found = markerFound(treeDir, slot);
    if (found !== null) markers.push(found);
  }
  return { markers, strong };
}

// probeIntakeMarker(projectRoot, projectRootReal) -> {txn_id, phase} | null.
//
// Row 0 of the decision table: an interrupted intake transaction must be
// resumed before any other reading of the tree, because during its window the
// tree can look like row 1 and still have its predecessor set aside. The
// probe fires ONLY on a proven in-flight transaction; anything else at that
// path is a refusal, never a classification — and the marker is never
// followed, never removed, and never repaired here.
//
// This runs the same pre-mutation validation discipline handoff.js:90-108
// holds, for the same reason: intake's own `withLock` does a recursive
// mkdirSync at this path, which would follow a pre-planted symlink.
function probeIntakeMarker(projectRoot, projectRootReal) {
  const markerPath = path.join(projectRoot, INTAKE_MARKER_NAME);
  const markerType = nodeTypeOf(markerPath);
  if (markerType === null) return null;
  if (markerType !== 'dir') {
    throw new Error(
      `detect: refusing to classify — "${markerPath}" exists but is not a real directory (${markerType})`
    );
  }

  const txnPath = path.join(markerPath, INTAKE_TXN_FILENAME);
  const txnType = nodeTypeOf(txnPath);
  // A marker directory holding no txn.json is the crash window inside lock
  // acquisition itself: the transaction never began. Treated as absent — a
  // fresh identity is minted on entry by intake, not here. Not a refusal.
  if (txnType === null) return null;
  if (txnType !== 'file') {
    throw new Error(`detect: refusing to classify — "${txnPath}" is not a regular file (${txnType})`);
  }

  let raw;
  try {
    raw = fs.readFileSync(txnPath, 'utf8');
  } catch (err) {
    throw new Error(`detect: refusing to classify — "${txnPath}" is unreadable (${err.code})`);
  }

  let txn;
  try {
    txn = JSON.parse(raw);
  } catch {
    throw new Error(`detect: refusing to classify — "${txnPath}" is not parseable JSON`);
  }
  if (txn === null || typeof txn !== 'object' || Array.isArray(txn)) {
    throw new Error(`detect: refusing to classify — "${txnPath}" is not a transaction record`);
  }

  const verdict = checkIntakeTxn(txn, { projectRootReal, treeName: TREE_NAME });
  if (!verdict.ok) {
    throw new Error(
      `detect: refusing to classify — "${txnPath}" fails authentication on ${verdict.field} (${verdict.saw})`
    );
  }

  return { txn_id: txn.txn_id, phase: txn.phase };
}

// detect(projectRoot) -> {mode, evidence}
//
// mode is exactly one of "resume" | "legacy" | "broken-install" |
// "brownfield" | "greenfield", decided by an ordered decision table. No
// shape and no version is ever refused; refusal is a property of the
// filesystem alone.
//
//   row 0  legacy         = an authenticated .kiln-intake marker is on disk —
//                           an intake transaction is in flight and must be
//                           re-entered before any other reading of the tree.
//                           evidence.intake_txn carries {txn_id, phase}.
//   row 1  resume         = .kiln/state.json is a regular file parsing to a
//                           plain object with non-empty phase/next_action AND
//                           schema_version === 1. A working current tree is
//                           never re-classified as legacy, whatever else is
//                           on disk — which is what makes intake fire exactly
//                           once per migration, with no "already done?" flag.
//   row 2  legacy tier 1  = the tree carries >=1 strong and >=2 total typed,
//                           non-symlink v3-Law markers: a shape that supports
//                           a typed, per-artifact harvest.
//   row 3  broken-install = the tree exists and state.json exists but failed
//                           row 1 — a crashed scaffold of the CURRENT version,
//                           which is fixed rather than migrated.
//   row 4  legacy tier 2  = any other .kiln-shaped tree (STATE.md-only, v1,
//                           v2, foreign). The catch-all catches into a tier,
//                           never into a refusal: it is archived whole and
//                           harvested generically.
//   row 5  brownfield     = no tree, but the project already has code (a git
//                           repo with at least one commit, or any project
//                           material outside dot-dirs)
//   row 6  greenfield     = neither
//
// evidence.has_git / has_code are `null` when NOT COMPUTED — an honest third
// value, never a fabricated `false`. Rows 0-4 are decided from .kiln facts
// alone, so they are decided before isGitRepo/hasGitCommits/hasProjectMaterial
// run at all: a resume costs zero git subprocesses and no depth-six scan.
function detect(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot === '') {
    throw new TypeError('detect: projectRoot must be a non-empty string');
  }
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`detect: projectRoot does not exist: ${projectRoot}`);
  }
  let projectRootReal;
  try {
    projectRootReal = fs.realpathSync(projectRoot);
  } catch (err) {
    throw new Error(`detect: refusing to classify — "${projectRoot}" does not resolve (${err.code})`);
  }

  const treeDir = path.join(projectRoot, TREE_NAME);
  const statePath = path.join(treeDir, STATE_FILENAME);

  const treeType = nodeTypeOf(treeDir);
  if (treeType === 'symlink') {
    // A rename would move a link, not the tree, and a harvest would read
    // outside the project. lstat before rename is the whole mechanism.
    throw new Error(`detect: refusing to classify — "${treeDir}" is a symlink, not a real tree directory`);
  }
  if (treeType !== null && treeType !== 'dir') {
    throw new Error(`detect: refusing to classify — "${treeDir}" exists but is not a directory (${treeType})`);
  }

  const evidence = {
    has_tree: treeType === 'dir',
    // The node's own existence, read the way every other probe in this module
    // reads one: `existsSync` follows a symlink and reports a dangling link as
    // absent, which is a judgment about the link's TARGET, not about what is
    // at this path.
    has_state: treeType === 'dir' && nodeTypeOf(statePath) !== null,
    has_git: null,
    has_code: null,
    legacy_tier: null,
    legacy_markers: [],
    intake_txn: null,
  };

  const intakeTxn = probeIntakeMarker(projectRoot, projectRootReal);
  if (intakeTxn !== null) {
    // The tier is not restated here: between phases `archived` and `placed`
    // the legacy tree does not live at treeDir at all, and the transaction
    // reads its own recorded phase to know where it is.
    evidence.intake_txn = intakeTxn;
    return { mode: 'legacy', evidence };
  }

  if (evidence.has_state && isValidStateFile(statePath)) {
    return { mode: 'resume', evidence };
  }

  if (evidence.has_tree) {
    const { markers, strong } = collectTier1Markers(treeDir);
    if (strong >= 1 && markers.length >= 2) {
      evidence.legacy_tier = 1;
      evidence.legacy_markers = markers;
      return { mode: 'legacy', evidence };
    }
    if (evidence.has_state) {
      return { mode: 'broken-install', evidence };
    }
    evidence.legacy_tier = 2;
    evidence.legacy_markers = markers;
    return { mode: 'legacy', evidence };
  }

  evidence.has_git = isGitRepo(projectRoot);
  evidence.has_code = (evidence.has_git && hasGitCommits(projectRoot)) || hasProjectMaterial(projectRoot);
  return { mode: evidence.has_code ? 'brownfield' : 'greenfield', evidence };
}

// CLI entrypoint: every caller of `detect()` — the fire entry's own wake
// read (`machine/src/wake.js`), `product/onboarding/flow.md`'s own scripted
// classification step, and (downstream of a "brownfield" result)
// `product/brownfield/flow.md`'s own entry step — uses this one
// `detect <projectRoot>` CLI subcommand, the same flat one-command
// convention `milestones.js`/`phases.js`/`verification.js`/`quarantine.js`/
// `delivery.js` already establish. This is purely additive — `detect()`
// itself is unchanged.
function parseArgv(argv) {
  const [command, projectRoot] = argv;
  return { command, projectRoot };
}

function main(argv) {
  const { command, projectRoot } = parseArgv(argv);
  if (command !== 'detect' || !projectRoot) {
    process.stderr.write('usage: detect.js detect <projectRoot>\n');
    process.exit(1);
    return;
  }
  try {
    const result = detect(projectRoot);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`detect.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { detect, isResumableTree };
