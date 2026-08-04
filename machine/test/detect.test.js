'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { detect } = require('../src/detect.js');

function mkTmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'detect-test-')));
}

// The tree name and the fixed intake-marker sibling name, spelled the way the
// module spells them (`TREE_NAME` and `${TREE_NAME}-intake`) so the package
// rename carries both here identically.
const TREE = '.thelastskill';
const MARKER = '.thelastskill-intake';

// A state.json that satisfies the strengthened row 1 (design §9.3.2): the
// four fields scaffold.js stamps at genesis and every later state writer
// spreads forward.
function currentState(extra = {}) {
  return JSON.stringify({ schema_version: 1, phase: 'onboarding', next_action: 'onboarding', ...extra });
}

// Writes {relPath: contents} into <dir>/<TREE>, creating parents.
function legacyTree(dir, files) {
  const treeDir = path.join(dir, TREE);
  fs.mkdirSync(treeDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(treeDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return treeDir;
}

// The v3.1.8 released shape (design §0 Finding 1) and its dev-HEAD sibling.
function releasedShape() {
  return {
    'STATE.md': 'stage: implement\nnext_action: build\n',
    'LAW.md': '# law\n',
    'slices.json': '[]\n',
    'law/lock.hash': 'deadbeef\n',
    'seals.log': 'slice-1 sealed\n',
    'docs/project-brief.md': '# brief\n',
  };
}
function devHeadShape() {
  return {
    'STATE.md': 'stage: implement\n',
    'state.json': JSON.stringify({ stage: 'implement', next_action_key: 'build', revision: 4 }),
    'seals.jsonl': JSON.stringify({ slice: 'slice-1' }) + '\n',
    'law/trio.hash': 'cafe\n',
    'law/lock.seal': 'sealed\n',
  };
}
function v1Shape() {
  return {
    'STATE.md': 'plugin_version: 1.0.0\nstep_3_status: done\n',
    'master-plan.md': '# plan\n',
    'resume.md': '# resume\n',
    'archive/step-1-discovery/notes.md': 'notes\n',
    'plans/plan-1.md': '# p\n',
  };
}

const TXN_ID = 'a'.repeat(32);

// The txn.json record of design §9.1.1, authenticated by detect's row-0 probe.
function validTxn(projectRoot, over = {}) {
  return {
    schema_version: 1,
    txn_id: TXN_ID,
    owner_pid: 4242,
    project_root_real: fs.realpathSync(projectRoot),
    tree_name: TREE,
    phase: 'claimed',
    archive_path: null,
    aborted_scaffolds: [],
    started_utc: '2026-07-29T00:00:00.000Z',
    updated_utc: '2026-07-29T00:00:00.000Z',
    ...over,
  };
}

// txn === null writes no txn.json at all (the crash-inside-lock-acquisition
// window); a string is written verbatim (malformed-record cases).
function writeMarker(projectRoot, txn) {
  const markerDir = path.join(projectRoot, MARKER);
  fs.mkdirSync(markerDir, { recursive: true });
  if (txn !== null) {
    fs.writeFileSync(path.join(markerDir, 'txn.json'), typeof txn === 'string' ? txn : JSON.stringify(txn));
  }
  return markerDir;
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
  return res;
}

// --- greenfield: empty directory ---

test('detect reports greenfield for a completely empty directory', () => {
  const dir = mkTmpDir();
  const result = detect(dir);
  assert.equal(result.mode, 'greenfield');
  assert.deepEqual(result.evidence, {
    has_tree: false,
    has_state: false,
    has_git: false,
    has_code: false,
    legacy_tier: null,
    legacy_markers: [],
    intake_txn: null,
  });
});

// --- greenfield edge: empty dir with only .git (no commits, no files) ---

test('detect reports greenfield for a dir containing only an empty git repo (no commits, no files)', () => {
  const dir = mkTmpDir();
  git(['init', '-q'], dir);
  const result = detect(dir);
  assert.equal(result.mode, 'greenfield');
  assert.equal(result.evidence.has_git, true);
  assert.equal(result.evidence.has_code, false);
  assert.equal(result.evidence.has_state, false);
});

// --- resume: .thelastskill/state.json exists ---

test('detect reports resume when .thelastskill/state.json exists and is a minimally valid state object', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.thelastskill', 'state.json'), currentState());
  const result = detect(dir);
  assert.equal(result.mode, 'resume');
  assert.equal(result.evidence.has_tree, true);
  assert.equal(result.evidence.has_state, true);
});

test('detect reports resume even when the project also has git commits and source files', () => {
  const dir = mkTmpDir();
  git(['init', '-q'], dir);
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1;\n');
  git(['add', '.'], dir);
  git(['-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-q', '-m', 'init'], dir);
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.thelastskill', 'state.json'),
    currentState({ phase: 'implementation', next_action: 'chunk_C03' })
  );
  const result = detect(dir);
  assert.equal(result.mode, 'resume');
});

// --- brownfield: git repo with commits, no state.json ---

test('detect reports brownfield for a git repo with at least one commit', () => {
  const dir = mkTmpDir();
  git(['init', '-q'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# hi\n');
  git(['add', '.'], dir);
  git(['-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-q', '-m', 'init'], dir);
  const result = detect(dir);
  assert.equal(result.mode, 'brownfield');
  assert.equal(result.evidence.has_git, true);
  assert.equal(result.evidence.has_code, true);
  assert.equal(result.evidence.has_state, false);
});

// --- brownfield: no git at all, but source-ish files present ---

test('detect reports brownfield for a non-git directory with source-ish files outside dot-dirs', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)\n');
  const result = detect(dir);
  assert.equal(result.mode, 'brownfield');
  assert.equal(result.evidence.has_git, false);
  assert.equal(result.evidence.has_code, true);
});

test('detect finds source-ish files nested under a normal (non-dot) subdirectory', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const x = 1;\n');
  const result = detect(dir);
  assert.equal(result.mode, 'brownfield');
  assert.equal(result.evidence.has_code, true);
});

// --- greenfield: only dot-dir files, no real source ---

test('detect ignores source-ish files that live only inside dot-directories', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.hidden'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.hidden', 'script.js'), 'console.log(1);\n');
  const result = detect(dir);
  assert.equal(result.mode, 'greenfield');
  assert.equal(result.evidence.has_code, false);
});

test('detect reports brownfield for a non-git project that only has a README and notes (any file is project material, not just a recognized source extension)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'README.md'), '# hi\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi\n');
  const result = detect(dir);
  assert.equal(result.mode, 'brownfield');
  assert.equal(result.evidence.has_code, true);
});

test('detect reports brownfield for extensionless/config-only project material (e.g. a bare Makefile)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'Makefile'), 'all:\n\techo hi\n');
  const result = detect(dir);
  assert.equal(result.mode, 'brownfield');
  assert.equal(result.evidence.has_code, true);
});

// --- git repo, zero commits, but has source files -> brownfield via files, not commits ---

test('detect reports brownfield via source files even in a git repo with zero commits', () => {
  const dir = mkTmpDir();
  git(['init', '-q'], dir);
  fs.writeFileSync(path.join(dir, 'app.go'), 'package main\n');
  const result = detect(dir);
  assert.equal(result.mode, 'brownfield');
  assert.equal(result.evidence.has_git, true);
  assert.equal(result.evidence.has_code, true);
});

// --- broken-install: fail-closed on partial installs and malformed state ---

// A tree with no state.json is no longer proof of a crashed CURRENT scaffold
// (legacy-intake design §9.3.3: one generic filename cannot carry that
// claim). It falls to row 4 — archived whole, harvested generically, nothing
// deleted — which is what restores the advertised catch-all.
test('detect reports legacy tier 2 when .thelastskill/ exists but state.json does not (a foreign or pre-state tree)', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.thelastskill', 'settings.json'), '{}');
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 2);
  assert.equal(result.evidence.has_tree, true);
  assert.equal(result.evidence.has_state, false);
});

test('detect reports broken-install when state.json exists but is a directory, not a file', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.thelastskill', 'state.json'), { recursive: true });
  const result = detect(dir);
  assert.equal(result.mode, 'broken-install');
  assert.equal(result.evidence.has_state, true);
});

test('a state.json SYMLINK never wins row 1: a genuine tier-1 legacy tree is still migrated', () => {
  const dir = mkTmpDir();
  legacyTree(dir, releasedShape());
  // §9.3.2 requires a REGULAR FILE, and every tier-1 marker is already read
  // that way ("a symlink is never counted: it is not the marker, it is a
  // pointer at something else"). A symlink here would otherwise suppress a
  // real migration AND hand phases.js resume a state file that does not live
  // in the tree.
  const outside = path.join(dir, 'planted-state.json');
  fs.writeFileSync(outside, currentState());
  fs.symlinkSync(outside, path.join(dir, TREE, 'state.json'));

  const result = detect(dir);

  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 1);
  assert.equal(fs.readFileSync(outside, 'utf8'), currentState(), 'the planted file was touched');
});

test('a state.json symlink pointing at a valid state inside the tree is still not a state file', () => {
  const dir = mkTmpDir();
  // No tier-1 shape at all, so nothing but the node type of state.json
  // decides between row 1 and the rows below it.
  legacyTree(dir, { 'real-state.json': currentState() });
  fs.symlinkSync(path.join(dir, TREE, 'real-state.json'), path.join(dir, TREE, 'state.json'));

  const result = detect(dir);

  assert.notEqual(result.mode, 'resume');
  assert.equal(result.evidence.has_state, true, 'a node at state.json is still evidence that something is there');
});

test('detect reports broken-install when state.json contains malformed (unparseable) JSON', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.thelastskill', 'state.json'), '{not valid json');
  const result = detect(dir);
  assert.equal(result.mode, 'broken-install');
});

test('detect reports broken-install when state.json is the empty-object genesis stub (no phase/next_action yet)', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.thelastskill', 'state.json'), '{}');
  const result = detect(dir);
  assert.equal(result.mode, 'broken-install');
});

test('detect reports broken-install when state.json has phase but is missing next_action', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.thelastskill', 'state.json'), JSON.stringify({ phase: 'onboarding' }));
  const result = detect(dir);
  assert.equal(result.mode, 'broken-install');
});

test('detect reports broken-install when state.json is a JSON array rather than an object', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.thelastskill', 'state.json'), '[]');
  const result = detect(dir);
  assert.equal(result.mode, 'broken-install');
});

test('detect reports resume (not broken-install) for a minimally valid state.json with only schema_version + phase + next_action', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.thelastskill', 'state.json'), currentState());
  const result = detect(dir);
  assert.equal(result.mode, 'resume');
});

// --- error cases ---

test('detect throws a TypeError when projectRoot is missing or not a string', () => {
  assert.throws(() => detect(undefined), TypeError);
  assert.throws(() => detect(42), TypeError);
});

test('detect throws when projectRoot does not exist on disk', () => {
  const dir = mkTmpDir();
  assert.throws(() => detect(path.join(dir, 'does-not-exist')));
});

// --- CLI ---

test('CLI: detect command prints {mode, evidence} JSON for a brownfield target', () => {
  const CLI_PATH = path.join(__dirname, '..', 'src', 'detect.js');
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'README.md'), '# existing project\n');

  const proc = spawnSync(process.execPath, [CLI_PATH, 'detect', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.mode, 'brownfield');
  assert.equal(parsed.evidence.has_code, true);
});

test('CLI: detect requires a projectRoot argument', () => {
  const CLI_PATH = path.join(__dirname, '..', 'src', 'detect.js');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'detect'], { encoding: 'utf8' });
  assert.notEqual(proc.status, 0);
  assert.match(proc.stderr, /usage: detect\.js detect <projectRoot>/);
});

// =====================================================================
// Legacy recognition — the three-tier ladder (design §1, as amended by
// §9.3). One mode token, `legacy`, carrying evidence.legacy_tier.
// =====================================================================

// --- row 2: tier 1, the v3 Law shape ---

test('detect reports legacy tier 1 for the released v3.1.8 shape, naming the markers it actually found', () => {
  const dir = mkTmpDir();
  legacyTree(dir, releasedShape());
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 1);
  assert.deepEqual(result.evidence.legacy_markers, ['LAW.md', 'slices.json', 'law', 'seals.log', 'docs/project-brief.md']);
  assert.equal(result.evidence.has_tree, true);
});

test('detect reports legacy tier 1 for the dev-HEAD shape, where seals.jsonl fills the same seal-record slot', () => {
  const dir = mkTmpDir();
  legacyTree(dir, devHeadShape());
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 1);
  assert.deepEqual(result.evidence.legacy_markers, ['law', 'seals.jsonl']);
});

test('H-43 strong-plus-corroborating-is-tier-1: LAW.md + decisions.md clears the bar', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'LAW.md': '# law\n', 'decisions.md': '# decisions\n' });
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 1);
  assert.deepEqual(result.evidence.legacy_markers, ['LAW.md', 'decisions.md']);
});

// --- row 4: tier 2, the catch-all ---

test('H-42 low-specificity-pair-is-tier-2: decisions.md + posture.json alone is not the v3 Law shape', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'decisions.md': '# d\n', 'posture.json': '{}\n' });
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 2);
  assert.deepEqual(result.evidence.legacy_markers, ['decisions.md', 'posture.json']);
});

test('detect reports legacy tier 2 for two corroborating docs markers with no strong marker at all', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'docs/project-brief.md': '# b\n', 'docs/feasibility.md': '# f\n' });
  const result = detect(dir);
  assert.equal(result.evidence.legacy_tier, 2);
});

test('detect reports legacy tier 2 for a single strong marker standing alone', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'LAW.md': '# law\n' });
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 2);
  assert.deepEqual(result.evidence.legacy_markers, ['LAW.md']);
});

test('detect counts seals.log and seals.jsonl as one seal-record slot, so the pair alone stays tier 2', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'seals.log': 'a\n', 'seals.jsonl': '{}\n' });
  const result = detect(dir);
  assert.equal(result.evidence.legacy_tier, 2);
  assert.deepEqual(result.evidence.legacy_markers, ['seals.log']);
});

test('detect reports legacy tier 2 for a STATE.md-only tree (STATE.md is family-wide, never a tier-1 marker)', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'STATE.md': 'stage: implement\n' });
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 2);
  assert.deepEqual(result.evidence.legacy_markers, []);
});

test('detect reports legacy tier 2 for the v1.x shape, with no version-specific parsing anywhere', () => {
  const dir = mkTmpDir();
  legacyTree(dir, v1Shape());
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 2);
});

// --- H-40 / H-41: typed, non-symlink markers only ---

test('H-40 marker-node-types-enforced: a directory named LAW.md and a regular file named law count for nothing', () => {
  const dir = mkTmpDir();
  const treeDir = legacyTree(dir, { 'slices.json': '[]\n' });
  fs.mkdirSync(path.join(treeDir, 'LAW.md'), { recursive: true });
  fs.writeFileSync(path.join(treeDir, 'law'), 'not a directory\n');
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 2);
  assert.deepEqual(result.evidence.legacy_markers, ['slices.json']);
});

test('H-41 symlinked-markers-not-counted: a tree whose markers are all symlinks is tier 2', () => {
  const dir = mkTmpDir();
  const outside = mkTmpDir();
  fs.writeFileSync(path.join(outside, 'LAW.md'), '# law\n');
  fs.writeFileSync(path.join(outside, 'slices.json'), '[]\n');
  fs.mkdirSync(path.join(outside, 'law'), { recursive: true });
  const treeDir = legacyTree(dir, { 'STATE.md': 'stage: x\n' });
  fs.symlinkSync(path.join(outside, 'LAW.md'), path.join(treeDir, 'LAW.md'));
  fs.symlinkSync(path.join(outside, 'slices.json'), path.join(treeDir, 'slices.json'));
  fs.symlinkSync(path.join(outside, 'law'), path.join(treeDir, 'law'));
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 2);
  assert.deepEqual(result.evidence.legacy_markers, []);
});

test('detect takes the real seals.jsonl for the seal slot when seals.log at the same slot is a symlink', () => {
  const dir = mkTmpDir();
  const outside = mkTmpDir();
  fs.writeFileSync(path.join(outside, 'seals.log'), 'x\n');
  const treeDir = legacyTree(dir, { 'LAW.md': '# law\n', 'seals.jsonl': '{}\n' });
  fs.symlinkSync(path.join(outside, 'seals.log'), path.join(treeDir, 'seals.log'));
  const result = detect(dir);
  assert.equal(result.evidence.legacy_tier, 1);
  assert.deepEqual(result.evidence.legacy_markers, ['LAW.md', 'seals.jsonl']);
});

// --- rows 1/2/3 precedence ---

test('H-46 current-state-beats-strong-markers: a full v3.2.0 state.json outranks LAW.md + slices.json (the pinned §9.3.2 residue)', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'LAW.md': '# law\n', 'slices.json': '[]\n', 'state.json': currentState() });
  const result = detect(dir);
  assert.equal(result.mode, 'resume');
  assert.equal(result.evidence.legacy_tier, null);
  assert.deepEqual(result.evidence.legacy_markers, []);
});

test('H-44 foreign-state-plus-strong-markers-is-legacy: {phase,next_action} without schema_version loses row 1 to tier 1', () => {
  const dir = mkTmpDir();
  legacyTree(dir, {
    'LAW.md': '# law\n',
    'slices.json': '[]\n',
    'state.json': JSON.stringify({ phase: 'onboarding', next_action: 'onboarding' }),
  });
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 1);
  assert.equal(result.evidence.has_state, true);
});

test('detect reports broken-install for a state.json carrying the wrong schema_version on a tree with no legacy shape', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'state.json': currentState({ schema_version: 2 }) });
  const result = detect(dir);
  assert.equal(result.mode, 'broken-install');
});

test('detect reports broken-install for a valid-looking state.json that carries no schema_version at all', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'state.json': JSON.stringify({ phase: 'onboarding', next_action: 'onboarding' }) });
  const result = detect(dir);
  assert.equal(result.mode, 'broken-install');
});

test('H-45 malformed-state-no-legacy-shape-is-broken-install: a crashed current scaffold is fixed, never migrated', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'state.json': '{not valid json' });
  const result = detect(dir);
  assert.equal(result.mode, 'broken-install');
  assert.equal(result.evidence.legacy_tier, null);
});

test('detect reports legacy tier 2 (not broken-install) for a foreign tree carrying settings.json and handoff.md but no state.json', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'settings.json': '{}\n', 'handoff.md': '# handoff\n' });
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 2);
});

// --- the loop test: a post-intake tree never re-triggers intake ---

test('detect reports resume for a post-intake tree whose archive/legacy-1/ holds every tier-1 marker', () => {
  const dir = mkTmpDir();
  legacyTree(dir, {
    'state.json': currentState(),
    'archive/legacy-1/LAW.md': '# law\n',
    'archive/legacy-1/slices.json': '[]\n',
    'archive/legacy-1/seals.log': 'x\n',
  });
  const result = detect(dir);
  assert.equal(result.mode, 'resume');
});

test('detect never counts a marker under archive/: the same archived tree without state.json is tier 2, not tier 1', () => {
  const dir = mkTmpDir();
  legacyTree(dir, {
    'archive/legacy-1/LAW.md': '# law\n',
    'archive/legacy-1/slices.json': '[]\n',
    'archive/legacy-1/seals.log': 'x\n',
  });
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 2);
  assert.deepEqual(result.evidence.legacy_markers, []);
});

// --- J-50: evidence honesty on the short-circuit path ---

test('J-50 detect-skips-code-scan-on-rows-0-3: has_git/has_code are null (not computed), never false, on resume', () => {
  const dir = mkTmpDir();
  git(['init', '-q'], dir);
  legacyTree(dir, { 'state.json': currentState() });
  const result = detect(dir);
  assert.equal(result.mode, 'resume');
  assert.equal(result.evidence.has_git, null);
  assert.equal(result.evidence.has_code, null);
});

test('J-50 detect-skips-code-scan-on-rows-0-3: has_git/has_code are null on legacy tier 1 and on broken-install', () => {
  const tier1 = mkTmpDir();
  legacyTree(tier1, releasedShape());
  const legacyResult = detect(tier1);
  assert.equal(legacyResult.evidence.has_git, null);
  assert.equal(legacyResult.evidence.has_code, null);

  const broken = mkTmpDir();
  legacyTree(broken, { 'state.json': '{}' });
  const brokenResult = detect(broken);
  assert.equal(brokenResult.mode, 'broken-install');
  assert.equal(brokenResult.evidence.has_git, null);
  assert.equal(brokenResult.evidence.has_code, null);
});

test('J-50 legacy tier 2 is decided from .thelastskill facts alone too, so has_git/has_code stay null', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)\n');
  legacyTree(dir, { 'STATE.md': 'stage: x\n' });
  const result = detect(dir);
  assert.equal(result.evidence.legacy_tier, 2);
  assert.equal(result.evidence.has_git, null);
  assert.equal(result.evidence.has_code, null);
});

test('detect still computes has_git/has_code as real booleans on the brownfield row, with a null tier and no markers', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)\n');
  const result = detect(dir);
  assert.deepEqual(result.evidence, {
    has_tree: false,
    has_state: false,
    has_git: false,
    has_code: true,
    legacy_tier: null,
    legacy_markers: [],
    intake_txn: null,
  });
});

// =====================================================================
// Row 0 — the authenticated intake-marker probe (design §9.1.2, §9.3.4).
// It fires only on a proven in-flight transaction; anything else at that
// path is a refusal, never a classification.
// =====================================================================

test('A-1 marker-absent-no-row-0: with no intake marker on disk, intake_txn is null and the tree classifies normally', () => {
  const dir = mkTmpDir();
  legacyTree(dir, releasedShape());
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 1);
  assert.equal(result.evidence.intake_txn, null);
});

test('A-7 marker-beats-valid-current-state: an authenticated marker at phase placed outranks a valid current state.json', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'state.json': currentState() });
  writeMarker(dir, validTxn(dir, { phase: 'placed', archive_path: `${TREE}/archive/legacy-1` }));
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.deepEqual(result.evidence.intake_txn, { txn_id: TXN_ID, phase: 'placed' });
});

test('row 0 fires with no tree on disk at all — the tree is mid-flight inside the marker directory', () => {
  const dir = mkTmpDir();
  const markerDir = writeMarker(dir, validTxn(dir, { phase: 'archived' }));
  fs.mkdirSync(path.join(markerDir, 'tree'), { recursive: true });
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.has_tree, false);
  assert.deepEqual(result.evidence.intake_txn, { txn_id: TXN_ID, phase: 'archived' });
});

test('row 0 authenticates project_root_real against the resolved root, so a symlinked path to the same project still fires', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'STATE.md': 'stage: x\n' });
  writeMarker(dir, validTxn(dir));
  const link = path.join(mkTmpDir(), 'link-to-project');
  fs.symlinkSync(dir, link);
  const result = detect(link);
  assert.equal(result.mode, 'legacy');
  assert.deepEqual(result.evidence.intake_txn, { txn_id: TXN_ID, phase: 'claimed' });
});

test('A-2 marker-as-file-refuses: a regular file at the marker path is a hazard, named and never classified', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'state.json': currentState() });
  fs.writeFileSync(path.join(dir, MARKER), 'not a directory\n');
  assert.throws(() => detect(dir), /not a real directory/);
  assert.equal(fs.readFileSync(path.join(dir, MARKER), 'utf8'), 'not a directory\n');
});

test('A-3 marker-as-symlink-refuses: a marker symlinked at a real directory is never followed, removed, or classified', () => {
  const dir = mkTmpDir();
  const elsewhere = mkTmpDir();
  fs.writeFileSync(path.join(elsewhere, 'txn.json'), JSON.stringify(validTxn(dir)));
  fs.symlinkSync(elsewhere, path.join(dir, MARKER));
  assert.throws(() => detect(dir), /not a real directory/);
  assert.equal(fs.lstatSync(path.join(dir, MARKER)).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(elsewhere, 'txn.json')), true);
});

test('A-4 marker-foreign-project-root-refuses: a txn.json naming another directory refuses instead of firing row 0', () => {
  const dir = mkTmpDir();
  const other = mkTmpDir();
  writeMarker(dir, validTxn(dir, { project_root_real: other }));
  assert.throws(() => detect(dir), /project_root_real/);
});

test('A-5 marker-malformed-txn-refuses: unparseable txn.json', () => {
  const dir = mkTmpDir();
  writeMarker(dir, '{not json');
  assert.throws(() => detect(dir), /txn\.json/);
});

test('A-5 marker-malformed-txn-refuses: wrong tree_name', () => {
  const dir = mkTmpDir();
  writeMarker(dir, validTxn(dir, { tree_name: '.other' }));
  assert.throws(() => detect(dir), /tree_name/);
});

test('A-5 marker-malformed-txn-refuses: a txn_id that is not 32 lowercase hex characters', () => {
  const dir = mkTmpDir();
  writeMarker(dir, validTxn(dir, { txn_id: 'NOT-HEX' }));
  assert.throws(() => detect(dir), /txn_id/);
});

test('A-5 marker-malformed-txn-refuses: a phase outside the closed five-value ladder', () => {
  const dir = mkTmpDir();
  writeMarker(dir, validTxn(dir, { phase: 'harvesting' }));
  assert.throws(() => detect(dir), /phase/);
});

test('A-5 marker-malformed-txn-refuses: a txn.json carrying the wrong schema_version', () => {
  const dir = mkTmpDir();
  writeMarker(dir, validTxn(dir, { schema_version: 2 }));
  assert.throws(() => detect(dir), /schema_version/);
});

test('P-10 one-authentication-contract: both readers of a marker refuse the same records, field for field', () => {
  // The contract was written twice — once in detect's row-0 probe, once in
  // intake's `readTransaction` — and the two disagreed by one field, so a
  // record missing `aborted_scaffolds` made detect report an in-flight
  // transaction that intake then refused as corrupt. What authenticates a
  // marker is one rule; each module keeps its own read and its own voice.
  const { archiveLegacyTree } = require('../src/intake.js');
  const mutations = [
    ['schema_version', { schema_version: 2 }],
    ['txn_id', { txn_id: 'NOT-HEX' }],
    ['tree_name', { tree_name: '.other' }],
    ['phase', { phase: 'harvesting' }],
    ['aborted_scaffolds', { aborted_scaffolds: undefined }],
    ['aborted_scaffolds', { aborted_scaffolds: 'aborted-scaffold-1' }],
  ];
  for (const [field, over] of mutations) {
    const dir = mkTmpDir();
    legacyTree(dir, releasedShape());
    writeMarker(dir, validTxn(dir, over));
    const named = new RegExp(field);
    assert.throws(() => detect(dir), named, `detect accepted a record failing on ${field}`);
    assert.throws(
      () => archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG }),
      named,
      `intake accepted a record failing on ${field}`
    );
  }
});

test('A-5 marker-malformed-txn-refuses: a txn.json that is a directory rather than a regular file', () => {
  const dir = mkTmpDir();
  const markerDir = writeMarker(dir, null);
  fs.mkdirSync(path.join(markerDir, 'txn.json'), { recursive: true });
  assert.throws(() => detect(dir), /txn\.json/);
});

test('A-5 marker-malformed-txn-refuses: a txn.json symlinked at a valid record elsewhere', () => {
  const dir = mkTmpDir();
  const elsewhere = mkTmpDir();
  const real = path.join(elsewhere, 'txn.json');
  fs.writeFileSync(real, JSON.stringify(validTxn(dir)));
  const markerDir = writeMarker(dir, null);
  fs.symlinkSync(real, path.join(markerDir, 'txn.json'));
  assert.throws(() => detect(dir), /txn\.json/);
});

test('detect refuses with the errno when txn.json exists but cannot be read', () => {
  const dir = mkTmpDir();
  const markerDir = writeMarker(dir, validTxn(dir));
  const txnPath = path.join(markerDir, 'txn.json');
  fs.chmodSync(txnPath, 0o000);
  try {
    assert.throws(() => detect(dir), /EACCES/);
  } finally {
    fs.chmodSync(txnPath, 0o600);
  }
});

test('A-6 marker-lockfile-only-mints-fresh: a marker holding only a lockfile is treated as absent, never refused', () => {
  const dir = mkTmpDir();
  legacyTree(dir, releasedShape());
  const markerDir = writeMarker(dir, null);
  fs.writeFileSync(path.join(markerDir, 'txn.json.lock'), '');
  const result = detect(dir);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.evidence.legacy_tier, 1);
  assert.equal(result.evidence.intake_txn, null);
});

test('the retired aborted-scaffold residue is not the fixed marker name, so it can never re-trigger row 0', () => {
  const dir = mkTmpDir();
  legacyTree(dir, { 'state.json': currentState() });
  const residue = path.join(dir, `${MARKER}-aborted-${TXN_ID}`);
  fs.mkdirSync(residue, { recursive: true });
  fs.writeFileSync(path.join(residue, 'txn.json'), JSON.stringify(validTxn(dir, { phase: 'harvested' })));
  const result = detect(dir);
  assert.equal(result.mode, 'resume');
  assert.equal(result.evidence.intake_txn, null);
});

// =====================================================================
// Filesystem hazards at the tree root (design §6): refusal is a property
// of the filesystem, never of a shape. Nothing is removed or guessed past.
// =====================================================================

test('detect refuses when .thelastskill is itself a symlink pointing outside the project root', () => {
  const dir = mkTmpDir();
  const outside = mkTmpDir();
  fs.writeFileSync(path.join(outside, 'LAW.md'), '# law\n');
  fs.writeFileSync(path.join(outside, 'slices.json'), '[]\n');
  fs.symlinkSync(outside, path.join(dir, TREE));
  assert.throws(() => detect(dir), /symlink/);
  assert.equal(fs.lstatSync(path.join(dir, TREE)).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(outside, 'LAW.md')), true);
});

test('detect refuses when .thelastskill exists as a regular file rather than a directory', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, TREE), 'not a tree\n');
  assert.throws(() => detect(dir), /not a directory/);
});

test('detect refuses with the errno when .thelastskill exists but is unreadable', () => {
  const dir = mkTmpDir();
  const treeDir = legacyTree(dir, { 'LAW.md': '# law\n', 'slices.json': '[]\n' });
  fs.chmodSync(treeDir, 0o000);
  try {
    assert.throws(() => detect(dir), /EACCES/);
  } finally {
    fs.chmodSync(treeDir, 0o700);
  }
});

// --- CLI ---

test('CLI: detect prints the legacy classification, its tier, and its markers', () => {
  const CLI_PATH = path.join(__dirname, '..', 'src', 'detect.js');
  const dir = mkTmpDir();
  legacyTree(dir, releasedShape());
  const proc = spawnSync(process.execPath, [CLI_PATH, 'detect', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.mode, 'legacy');
  assert.equal(parsed.evidence.legacy_tier, 1);
  assert.ok(parsed.evidence.legacy_markers.includes('slices.json'));
});

test('CLI: a hazard at the intake marker exits non-zero and names the path', () => {
  const CLI_PATH = path.join(__dirname, '..', 'src', 'detect.js');
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, MARKER), 'planted\n');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'detect', dir], { encoding: 'utf8' });
  assert.notEqual(proc.status, 0);
  assert.match(proc.stderr, /not a real directory/);
  assert.match(proc.stderr, new RegExp(MARKER.replace('.', '\\.')));
});

// =====================================================================
// I. Entry orchestration contract (design §9.5, Sol finding 12)
//
// One rule, written in fifteen places (design §9.4.2): CLASSIFY FIRST with
// detect.js, then branch on the printed `mode` and on nothing else — never
// on a bare `.thelastskill/state.json` existence check, which a legacy or a
// crashed tree satisfies just as well as a healthy one. These three tests
// drive the real CLIs a runner drives, and assert what the machine can
// actually prove: the call sequence each tree shape produces under that
// rule, and — since a rule no mechanism enforces is only a hope — what the
// forbidden calls do when made anyway. They assert no prose.
// =====================================================================

const { scaffoldTree } = require('../src/scaffold.js');

const DETECT_CLI = path.join(__dirname, '..', 'src', 'detect.js');
const PHASES_CLI = path.join(__dirname, '..', 'src', 'phases.js');
const INTAKE_CLI = path.join(__dirname, '..', 'src', 'intake.js');
const ROUTING_CONFIG = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');

function runCli(cliPath, args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

// The documented machine-layer entry sequence, written once so all three
// tests below drive the identical rule: detect, then the one call the
// printed mode entitles. Every spawn is recorded, so a test reads back the
// calls that actually happened rather than the calls it hoped for. Nothing
// here branches on the fixture — only on detect's own output.
function entrySequence(projectRoot) {
  const calls = [];
  const call = (label, cliPath, args) => {
    calls.push(label);
    return runCli(cliPath, args);
  };

  const detected = call('detect', DETECT_CLI, ['detect', projectRoot]);
  if (detected.status !== 0) return { calls, mode: null, detected, next: null };
  const mode = JSON.parse(detected.stdout).mode;

  let next = null;
  if (mode === 'resume') {
    next = call('phases resume', PHASES_CLI, ['resume', path.join(projectRoot, TREE)]);
  } else if (mode === 'legacy') {
    next = call('intake archive', INTAKE_CLI, ['archive', projectRoot, '--routing', ROUTING_CONFIG]);
  }
  // `broken-install` stops here and goes to the operator; `brownfield` and
  // `greenfield` hand off to onboarding's own flow, which is not a machine
  // call this classifier makes.
  return { calls, mode, detected, next };
}

test('I-47 entry-valid-current-tree: the sequence is detect -> phases.js resume, and both intake entrypoints refuse the tree', () => {
  const dir = mkTmpDir();
  scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const statePath = path.join(dir, TREE, 'state.json');
  const stateBefore = fs.readFileSync(statePath);

  const entry = entrySequence(dir);

  assert.equal(entry.mode, 'resume');
  assert.deepEqual(entry.calls, ['detect', 'phases resume']);
  assert.equal(entry.next.status, 0, entry.next.stderr);
  const point = JSON.parse(entry.next.stdout);
  assert.equal(point.phase, 'onboarding');
  assert.equal(point.canResume, true);

  // "no intake call occurs" is not left to the runner's discipline: both
  // intake entrypoints refuse a tree detect calls `resume`, and each refusal
  // leaves the project exactly as it found it.
  const archive = runCli(INTAKE_CLI, ['archive', dir, '--routing', ROUTING_CONFIG]);
  assert.equal(archive.status, 1);
  assert.match(archive.stderr, /classifies .* as "resume", not a legacy tree/);
  const harvest = runCli(INTAKE_CLI, [
    'harvest',
    path.join(dir, TREE),
    path.join(dir, TREE, 'archive', 'legacy-1'),
  ]);
  assert.equal(harvest.status, 1);
  assert.match(harvest.stderr, /^intake\.js: intake: /);
  assert.deepEqual(fs.readFileSync(statePath), stateBefore);
  assert.equal(fs.existsSync(path.join(dir, MARKER)), false, 'a refused intake left a marker behind');
  assert.deepEqual(fs.readdirSync(path.join(dir, TREE, 'archive')), []);
});

test('I-48 entry-legacy-tree: both legacy shapes produce detect -> intake, and resume reports a state.json missing off an intact tree', () => {
  for (const shape of [
    { label: 'v3.1.8 released', files: releasedShape() },
    { label: 'dev HEAD', files: devHeadShape() },
  ]) {
    const dir = mkTmpDir();
    const treeDir = legacyTree(dir, shape.files);
    const listingBefore = fs.readdirSync(treeDir).sort();

    // What a resume-first runner would have acted on, read before the rule
    // is applied: the tree is whole on disk and the query calls its state
    // file missing. The call is a pure read, so this costs the tree nothing.
    const resumeFirst = runCli(PHASES_CLI, ['resume', treeDir]);
    assert.equal(resumeFirst.status, 0, resumeFirst.stderr);
    assert.deepEqual(JSON.parse(resumeFirst.stdout), { phase: null, canResume: false, missing: ['state.json'] }, shape.label);
    if (shape.files['state.json'] !== undefined) {
      assert.equal(fs.existsSync(path.join(treeDir, 'state.json')), true, 'the file it called missing');
    }
    assert.deepEqual(fs.readdirSync(treeDir).sort(), listingBefore);

    const entry = entrySequence(dir);

    assert.equal(entry.mode, 'legacy', shape.label);
    assert.deepEqual(entry.calls, ['detect', 'intake archive'], `${shape.label}: the sequence is not detect -> intake`);
    assert.equal(entry.next.status, 0, entry.next.stderr);
    const txn = JSON.parse(entry.next.stdout);
    assert.equal(txn.phase, 'placed');
    assert.equal(txn.tier, 1);
    // The legacy tree is set aside whole, not resumed and not scaffolded over.
    assert.deepEqual(fs.readdirSync(path.join(dir, TREE, 'archive', 'legacy-1')).sort(), listingBefore);
  }
});

test('I-49 entry-broken-current: a crashed install of the current version stops at detect, and resume cannot tell it from a healthy tree', () => {
  // The healthy twin the broken trees are read against: same scaffold, same
  // registry, only state.json differs.
  const healthyDir = mkTmpDir();
  scaffoldTree(healthyDir, { routingConfigPath: ROUTING_CONFIG });
  const healthyResume = runCli(PHASES_CLI, ['resume', path.join(healthyDir, TREE)]);
  assert.equal(healthyResume.status, 0, healthyResume.stderr);

  // Two crash shapes, both row 3: the tree is there, state.json is there, and
  // row 1 fails. `phases.js resume` reads neither fact — it reads
  // state.json's `phase` field and checks the registry against it — so on
  // one shape it fails closed on the parse and on the other it cannot tell
  // the broken tree from the healthy one. Which is the point: classification
  // is detect's job and never resume's (doctrine rule 6, one mechanism per
  // constraint), and each `resumeAnyway` below is what a resume-first runner
  // would have had to act on.
  const shapes = [
    {
      label: 'truncated state.json',
      bytes: '{"schema_version":1,"phase":"implem',
      resumeAnyway: (proc) => {
        assert.equal(proc.status, 1);
        assert.match(proc.stderr, /failed to parse JSON/);
      },
    },
    {
      // Parseable, and carrying the two fields a resume reads — but not the
      // schema_version a current tree stamps at genesis (design §9.3.2).
      label: 'state.json without schema_version',
      bytes: JSON.stringify({ phase: 'onboarding', next_action: 'onboarding' }),
      resumeAnyway: (proc) => {
        assert.equal(proc.status, 0, proc.stderr);
        assert.deepEqual(
          JSON.parse(proc.stdout),
          JSON.parse(healthyResume.stdout),
          'a crashed install answered the resume query differently from a healthy tree'
        );
      },
    },
  ];

  for (const shape of shapes) {
    const dir = mkTmpDir();
    scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
    fs.writeFileSync(path.join(dir, TREE, 'state.json'), shape.bytes);

    const entry = entrySequence(dir);

    assert.equal(entry.mode, 'broken-install', shape.label);
    assert.deepEqual(entry.calls, ['detect'], `${shape.label}: the sequence made a second machine call`);
    assert.equal(entry.next, null);

    shape.resumeAnyway(runCli(PHASES_CLI, ['resume', path.join(dir, TREE)]));
    assert.equal(fs.existsSync(path.join(dir, TREE, 'state.json')), true);

    // And it is never migrated either: intake refuses a broken install by
    // detect's own word, so the two wrong branches are both closed.
    const archive = runCli(INTAKE_CLI, ['archive', dir, '--routing', ROUTING_CONFIG]);
    assert.equal(archive.status, 1, shape.label);
    assert.match(archive.stderr, /classifies .* as "broken-install", not a legacy tree/);
    assert.equal(fs.existsSync(path.join(dir, MARKER)), false);
  }
});
