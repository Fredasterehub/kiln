'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const { archiveLegacyTree } = require('../src/intake.js');
const { detect } = require('../src/detect.js');
const { scaffoldTree } = require('../src/scaffold.js');
const { readAll } = require('../src/jsonl.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'intake.js');
const ROUTING_CONFIG = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');

// The tree name and the fixed intake-marker sibling name, spelled the way the
// module spells them (`TREE_NAME` and `${TREE_NAME}-intake`) so the package
// rename carries both here identically.
const TREE = '.thelastskill';
const MARKER = '.thelastskill-intake';
const TXN_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const ARCHIVE_1 = path.join(TREE, 'archive', 'legacy-1');

function mkTmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'intake-test-')));
}

function treeDirOf(dir) {
  return path.join(dir, TREE);
}
function markerDirOf(dir) {
  return path.join(dir, MARKER);
}
function markerTreeOf(dir) {
  return path.join(dir, MARKER, 'tree');
}
function txnPathOf(dir) {
  return path.join(dir, MARKER, 'txn.json');
}
function readTxn(dir) {
  return JSON.parse(fs.readFileSync(txnPathOf(dir), 'utf8'));
}
function archiveDirOf(dir) {
  return path.join(dir, TREE, 'archive');
}

// A legacy tree rich enough to exercise every preservation claim at once:
// nested directories, an empty directory, an internal symlink, a symlink
// pointing outside the project, a non-default file mode, and a distinctive
// mtime. Its markers make it tier 1 (LAW.md + slices.json + law/ + seals.log).
const ODD_MODE = 0o741;
const OLD_MTIME = new Date('2026-03-25T11:22:33.000Z');

function legacyFixture(dir) {
  const tree = treeDirOf(dir);
  const files = {
    'LAW.md': '# the old law\n\nA slice is done when the check passes.\n',
    'slices.json': '[{"id":"slice-1"}]\n',
    'STATE.md': 'stage: implement\nnext_action: build\n',
    'seals.log': 'slice-1 dual\nslice-2 single-family\n',
    'law/lock.hash': 'deadbeef\n',
    'law/check.sh': '#!/bin/sh\nexit 0\n',
    'docs/project-brief.md': '# brief\n',
    'docs/vision.md': '# vision\n\nBuild the thing.\n',
    'evidence/gen-1/probe.txt': 'probe output\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(tree, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.mkdirSync(path.join(tree, 'empty-on-purpose'), { recursive: true });
  fs.symlinkSync('../LAW.md', path.join(tree, 'docs', 'law-link.md'));
  fs.symlinkSync('/etc/hostname', path.join(tree, 'outside-link'));
  fs.chmodSync(path.join(tree, 'law', 'check.sh'), ODD_MODE);
  fs.utimesSync(path.join(tree, 'LAW.md'), OLD_MTIME, OLD_MTIME);
  return tree;
}

// Full structural + byte snapshot of a directory: every entry's relative
// path, node type, and content digest (or raw readlink string), plus file
// mode and mtime. Symlinks are never followed — a snapshot that resolved
// them could not tell "the link was moved" from "the link was followed".
function snapshot(root) {
  const out = [];
  const walk = (dir, rel) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const r = rel === '' ? entry.name : path.join(rel, entry.name);
      if (entry.isSymbolicLink()) {
        out.push({ rel: r, type: 'symlink', body: fs.readlinkSync(full) });
      } else if (entry.isDirectory()) {
        out.push({ rel: r, type: 'dir', body: null });
        walk(full, r);
      } else {
        const st = fs.lstatSync(full);
        out.push({
          rel: r,
          type: 'file',
          body: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
          mode: st.mode & 0o777,
          mtimeMs: Math.round(st.mtimeMs),
        });
      }
    }
  };
  walk(root, '');
  return out;
}

function relPaths(snap) {
  return snap.map((e) => e.rel);
}

// A transaction record that authenticates against `dir` (design §9.1.1).
function plantTxn(dir, overrides = {}) {
  fs.mkdirSync(markerDirOf(dir), { recursive: true });
  const txn = {
    schema_version: 1,
    txn_id: TXN_ID,
    owner_pid: 4242,
    project_root_real: fs.realpathSync(dir),
    tree_name: TREE,
    phase: 'claimed',
    archive_path: null,
    aborted_scaffolds: [],
    tier: 1,
    markers: ['LAW.md', 'slices.json'],
    started_utc: '2026-07-29T00:00:00.000Z',
    updated_utc: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
  fs.writeFileSync(txnPathOf(dir), JSON.stringify(txn, null, 2));
  return txn;
}

// The legacy tree, set aside under the marker exactly as phase `claimed` ->
// `archived` leaves it.
function stashTree(dir) {
  fs.mkdirSync(markerDirOf(dir), { recursive: true });
  fs.renameSync(treeDirOf(dir), markerTreeOf(dir));
}

function archive(dir) {
  return archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
}

function runCli(dir, extraArgs = []) {
  return spawnSync(process.execPath, [CLI_PATH, 'archive', dir, '--routing', ROUTING_CONFIG, ...extraArgs], {
    encoding: 'utf8',
  });
}

// A witness-valid scaffold (design §9.1.3): routing/active.json is the LAST
// write of scaffoldTree, so its validity proves the whole sequence ran.
function witnessPath(dir) {
  return path.join(treeDirOf(dir), 'routing', 'active.json');
}

// =====================================================================
// §7.3 archive — the eleven
// =====================================================================

test('archive moves the legacy tree byte-for-byte: every path, digest, mode, mtime, and symlink target is identical under the archive', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);

  const result = archive(dir);

  assert.equal(result.archive_path, ARCHIVE_1);
  assert.deepEqual(snapshot(path.join(dir, result.archive_path)), before);
});

test('nothing in the legacy tree is ever deleted (§2.5): every path present before the archive is present after it', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const beforePaths = relPaths(snapshot(tree));

  const result = archive(dir);

  const afterPaths = relPaths(snapshot(path.join(dir, result.archive_path)));
  for (const rel of beforePaths) {
    assert.ok(afterPaths.includes(rel), `"${rel}" was deleted by the archive`);
  }
  assert.equal(afterPaths.length, beforePaths.length);
});

test('the archive lands at archive/legacy-1 inside the fresh tree', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);

  const result = archive(dir);

  assert.equal(result.archive_path, ARCHIVE_1);
  assert.equal(fs.statSync(path.join(dir, ARCHIVE_1)).isDirectory(), true);
  assert.equal(
    fs.readFileSync(path.join(dir, ARCHIVE_1, 'LAW.md'), 'utf8'),
    '# the old law\n\nA slice is done when the check passes.\n'
  );
});

test('an already-occupied archive/legacy-1 is never overwritten: the placement takes legacy-2 and legacy-1 keeps every byte', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  stashTree(dir);
  plantTxn(dir, { phase: 'scaffolded' });
  scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
  // A prior migration's archive, already sitting where the monotonic scan
  // looks.
  const prior = path.join(archiveDirOf(dir), 'legacy-1');
  fs.mkdirSync(path.join(prior, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(prior, 'docs', 'older.md'), '# an older run\n');
  const priorBefore = snapshot(prior);

  const result = archive(dir);

  assert.equal(result.archive_path, path.join(TREE, 'archive', 'legacy-2'));
  assert.deepEqual(snapshot(prior), priorBefore);
  assert.deepEqual(snapshot(path.join(dir, result.archive_path)), before);
  assert.deepEqual(fs.readdirSync(archiveDirOf(dir)).sort(), ['legacy-1', 'legacy-2']);
});

test('archive refuses rather than renaming onto a symlink squatting at the destination legacy-N', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const treeSnapshot = snapshot(tree);
  stashTree(dir);
  plantTxn(dir, { phase: 'scaffolded' });
  scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
  // A symlink is not a real directory, so the monotonic scan does not count
  // it — the destination-occupied guard is the only thing between it and a
  // rename that would move the legacy tree outside the project.
  const outside = mkTmpDir();
  fs.symlinkSync(outside, path.join(archiveDirOf(dir), 'legacy-1'));

  assert.throws(() => archive(dir), /intake: refusing to overwrite .*legacy-1/);
  assert.deepEqual(snapshot(markerTreeOf(dir)), treeSnapshot);
  assert.equal(fs.lstatSync(path.join(archiveDirOf(dir), 'legacy-1')).isSymbolicLink(), true);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('archive refuses when a regular file occupies the destination legacy-N', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);
  stashTree(dir);
  plantTxn(dir, { phase: 'scaffolded' });
  scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
  fs.writeFileSync(path.join(archiveDirOf(dir), 'legacy-1'), 'squatter\n');

  assert.throws(() => archive(dir), /intake: refusing to overwrite .*legacy-1/);
  assert.equal(fs.readFileSync(path.join(archiveDirOf(dir), 'legacy-1'), 'utf8'), 'squatter\n');
  assert.equal(fs.existsSync(markerTreeOf(dir)), true);
});

test('B-9 reenter-phase-claimed: a transaction interrupted at `claimed` moves the tree aside and runs to `placed`', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  plantTxn(dir, { phase: 'claimed' });

  const result = archive(dir);

  assert.equal(result.txn_id, TXN_ID);
  assert.equal(result.phase, 'placed');
  assert.deepEqual(snapshot(path.join(dir, result.archive_path)), before);
  assert.equal(fs.existsSync(markerTreeOf(dir)), false);
  assert.equal(readTxn(dir).phase, 'placed');
});

test('B-14 reenter-phase-scaffolded: a transaction interrupted at `scaffolded` places the archive and clears <marker>/tree', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  stashTree(dir);
  plantTxn(dir, { phase: 'scaffolded' });
  scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const settingsBefore = fs.readFileSync(path.join(dir, TREE, 'settings.json'), 'utf8');

  const result = archive(dir);

  assert.equal(result.phase, 'placed');
  assert.deepEqual(snapshot(path.join(dir, result.archive_path)), before);
  assert.equal(fs.existsSync(markerTreeOf(dir)), false);
  // The fresh tree was kept as it stood, not rebuilt underneath the archive.
  assert.equal(fs.readFileSync(path.join(dir, TREE, 'settings.json'), 'utf8'), settingsBefore);
});

test('archive refuses on an unwritable project root and leaves the legacy tree untouched', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root ignores mode bits
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  fs.chmodSync(dir, 0o500);
  try {
    assert.throws(() => archive(dir), /intake/);
    assert.deepEqual(snapshot(tree), before);
  } finally {
    fs.chmodSync(dir, 0o700);
  }
});

test('B-12 scaffoldTree is never called with force: a partial scaffold is moved aside whole, never removed', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  stashTree(dir);
  plantTxn(dir, { phase: 'archived' });
  // A partial scaffold: state.json landed (scaffold's first file write), the
  // routing witness never did. `force` would rmSync this whole directory.
  fs.mkdirSync(path.join(dir, TREE, 'vision'), { recursive: true });
  fs.writeFileSync(path.join(dir, TREE, 'state.json'), '{"schema_version":1,"phase":"onboarding"}');
  fs.writeFileSync(path.join(dir, TREE, 'half-written.txt'), 'partial\n');

  const result = archive(dir);

  const aborted = path.join(markerDirOf(dir), 'aborted-scaffold-1');
  assert.equal(fs.readFileSync(path.join(aborted, 'half-written.txt'), 'utf8'), 'partial\n');
  assert.equal(fs.readFileSync(path.join(aborted, 'state.json'), 'utf8'), '{"schema_version":1,"phase":"onboarding"}');
  assert.deepEqual(readTxn(dir).aborted_scaffolds, ['aborted-scaffold-1']);
  assert.deepEqual(result.aborted_scaffolds, ['aborted-scaffold-1']);
  // ... and the transaction still completed against a genuine fresh scaffold.
  assert.deepEqual(snapshot(path.join(dir, result.archive_path)), before);
  assert.equal(JSON.parse(fs.readFileSync(witnessPath(dir), 'utf8')).active_config, path.basename(ROUTING_CONFIG));
});

test('intake.js never sets an opts.force property on the one call that could destroy a legacy tree', () => {
  const src = fs.readFileSync(CLI_PATH, 'utf8');
  assert.equal(/\bforce\s*:/.test(src), false, 'intake.js sets a `force:` property somewhere');
});

test('permissions and mtimes survive the archive (a rename never walks the tree)', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);

  const result = archive(dir);
  const archived = path.join(dir, result.archive_path);

  assert.equal(fs.statSync(path.join(archived, 'law', 'check.sh')).mode & 0o777, ODD_MODE);
  assert.equal(Math.round(fs.statSync(path.join(archived, 'LAW.md')).mtimeMs), OLD_MTIME.getTime());
});

test('a symlink inside the legacy tree is moved, never followed', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);

  const result = archive(dir);
  const archived = path.join(dir, result.archive_path);

  assert.equal(fs.lstatSync(path.join(archived, 'docs', 'law-link.md')).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(path.join(archived, 'docs', 'law-link.md')), '../LAW.md');
  assert.equal(fs.lstatSync(path.join(archived, 'outside-link')).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(path.join(archived, 'outside-link')), '/etc/hostname');
});

// =====================================================================
// A. Transaction identity and exclusive owner (design §9.1.1-§9.1.2)
// =====================================================================

test('A-2 marker-as-file-refuses: intake validates its own marker rather than trusting an earlier detect', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  fs.writeFileSync(markerDirOf(dir), 'planted\n');

  assert.throws(() => archive(dir), /not a real directory/);
  assert.deepEqual(snapshot(tree), before);
  assert.equal(fs.readFileSync(markerDirOf(dir), 'utf8'), 'planted\n');
});

test('A-3 marker-as-symlink-refuses: the link is never followed, removed, or written through', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const outside = mkTmpDir();
  fs.symlinkSync(outside, markerDirOf(dir));

  assert.throws(() => archive(dir), /not a real directory/);
  assert.equal(fs.lstatSync(markerDirOf(dir)).isSymbolicLink(), true);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(tree), true);
});

test('A-4 marker-foreign-project-root-refuses: a txn.json naming another project root never authenticates', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);
  plantTxn(dir, { project_root_real: path.join(os.tmpdir(), 'some-other-project') });

  assert.throws(() => archive(dir), /project_root_real/);
  assert.equal(fs.existsSync(treeDirOf(dir)), true);
  assert.equal(fs.existsSync(markerTreeOf(dir)), false);
});

test('A-5 marker-malformed-txn-refuses: a bad txn_id, an unknown phase, and unparseable JSON each refuse', () => {
  const badId = mkTmpDir();
  legacyFixture(badId);
  plantTxn(badId, { txn_id: 'not-a-txn-id' });
  assert.throws(() => archive(badId), /txn_id/);

  const badPhase = mkTmpDir();
  legacyFixture(badPhase);
  plantTxn(badPhase, { phase: 'nearly-done' });
  assert.throws(() => archive(badPhase), /phase/);

  const badJson = mkTmpDir();
  legacyFixture(badJson);
  fs.mkdirSync(markerDirOf(badJson), { recursive: true });
  fs.writeFileSync(txnPathOf(badJson), '{not json');
  assert.throws(() => archive(badJson), /parseable/);
  assert.equal(fs.existsSync(treeDirOf(badJson)), true);
});

test('A-6 marker-lockfile-only-mints-fresh: a marker holding only a lockfile is the pre-claim crash window, not a refusal', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  fs.mkdirSync(markerDirOf(dir), { recursive: true });
  // The lock its dead owner never released: older than jsonl.js's own
  // LOCK_STALE_MS, so the one lock discipline in the codebase reclaims it
  // rather than blocking re-entry forever.
  const abandonedLock = path.join(markerDirOf(dir), 'txn.json.lock');
  fs.writeFileSync(abandonedLock, '');
  const longAgo = new Date(Date.now() - 120000);
  fs.utimesSync(abandonedLock, longAgo, longAgo);

  const result = archive(dir);

  assert.match(result.txn_id, /^[0-9a-f]{32}$/);
  assert.equal(result.phase, 'placed');
  assert.deepEqual(snapshot(path.join(dir, result.archive_path)), before);
});

test('P-6 lock-window-after-a-crash: a held lock refuses in intake\'s own voice, naming the phase and where the tree is', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);
  stashTree(dir);
  plantTxn(dir, { phase: 'archived' });
  const before = snapshot(markerTreeOf(dir));
  // The lockfile a SIGKILL leaves behind, FRESH: inside LOCK_STALE_MS the one
  // lock discipline in the codebase is still waiting for a holder that will
  // never come back. Every re-entry in that window lands here — at the exact
  // moment the operator's tree has vanished from where they expect it — and
  // what they were told was that an append lock timed out.
  fs.writeFileSync(path.join(markerDirOf(dir), 'txn.json.lock'), '');

  assert.throws(
    () => archive(dir),
    (err) => {
      assert.match(err.message, /^intake: /, 'the raw jsonl message reached the operator');
      assert.equal(/append lock/.test(err.message), false);
      assert.ok(err.message.includes(markerDirOf(dir)), 'the refusal does not name the marker');
      assert.ok(err.message.includes('archived'), 'the refusal does not name the recorded phase');
      assert.ok(err.message.includes(markerTreeOf(dir)), 'the refusal does not say where the legacy tree is');
      assert.match(err.message, /re-run/, 'the refusal does not say the transaction resumes');
      return true;
    }
  );

  assert.deepEqual(snapshot(markerTreeOf(dir)), before, 'a refused re-entry touched the set-aside tree');
  assert.equal(readTxn(dir).phase, 'archived');
});

test('archive refuses a resumable current tree: intake never archives what detect calls `resume`', () => {
  const dir = mkTmpDir();
  scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const before = snapshot(treeDirOf(dir));

  assert.throws(() => archive(dir), /resume/);
  assert.deepEqual(snapshot(treeDirOf(dir)), before);
  assert.equal(fs.existsSync(markerDirOf(dir)), false, 'a refusal left an intake marker behind');
});

test('P-8 reentry-revalidates-the-precondition: a planted record never archives a resumable current tree', () => {
  const dir = mkTmpDir();
  scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const before = snapshot(treeDirOf(dir));
  // `mintTransaction` reads detect's verdict, but `runTransaction` only calls
  // it when NO record exists — so a hand-written one skipped the precondition
  // entirely and drove the ladder against a healthy tree. The guarantee has
  // to live on the step that MOVES the tree, which the mint path and every
  // re-entry both run.
  plantTxn(dir, { phase: 'claimed' });

  assert.throws(() => archive(dir), /resumable current tree/);

  assert.deepEqual(snapshot(treeDirOf(dir)), before, 'a live current tree was moved');
  assert.equal(fs.existsSync(markerTreeOf(dir)), false);
  // And the refusal is not a dead end: the marker it refuses on is one the
  // operator can move aside, after which the tree classifies as itself again.
  fs.renameSync(markerDirOf(dir), `${markerDirOf(dir)}-abandoned`);
  assert.equal(detect(dir).mode, 'resume');
});

test('archive refuses a greenfield project: there is no legacy tree to archive', () => {
  const dir = mkTmpDir();

  assert.throws(() => archive(dir), /greenfield/);
  assert.equal(fs.existsSync(markerDirOf(dir)), false);
});

test('the transaction marker survives the archive command, so detect still routes re-entry through row 0', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);

  const result = archive(dir);

  assert.equal(readTxn(dir).phase, 'placed');
  const seen = detect(dir);
  assert.equal(seen.mode, 'legacy');
  assert.deepEqual(seen.evidence.intake_txn, { txn_id: result.txn_id, phase: 'placed' });
});

test('A-8 concurrent-archive-one-owner: two concurrent archive processes produce one archive, one genesis, and no legacy-2', async () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);

  const runChild = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, 'archive', dir, '--routing', ROUTING_CONFIG]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => {
        stdout += c;
      });
      child.stderr.on('data', (c) => {
        stderr += c;
      });
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });

  const results = await Promise.all([runChild(), runChild()]);
  for (const r of results) {
    assert.equal(r.code, 0, r.stderr);
  }

  assert.deepEqual(fs.readdirSync(archiveDirOf(dir)).sort(), ['legacy-1']);
  assert.deepEqual(snapshot(path.join(dir, ARCHIVE_1)), before);
  for (const r of results) {
    assert.equal(JSON.parse(r.stdout).archive_path, ARCHIVE_1);
  }
  // One genesis, not two: the fresh ledger carries exactly one record and it
  // is the scaffold's own.
  const { records } = readAll(path.join(dir, TREE, 'ledger.jsonl'));
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'genesis');
});

// =====================================================================
// B. Phase ladder — every crash window, including the phase-write-lost pair
// =====================================================================

test('B-9b claimed with the tree already moved: the lost phase write is recovered and the rename is not repeated', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  stashTree(dir);
  plantTxn(dir, { phase: 'claimed' });

  const result = archive(dir);

  assert.equal(result.phase, 'placed');
  assert.deepEqual(snapshot(path.join(dir, result.archive_path)), before);
  assert.deepEqual(fs.readdirSync(archiveDirOf(dir)).sort(), ['legacy-1']);
});

test('B-10 reenter-phase-archived-no-kiln: a transaction at `archived` with no tree scaffolds a fresh one and runs on', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  stashTree(dir);
  plantTxn(dir, { phase: 'archived' });

  const result = archive(dir);

  assert.equal(result.phase, 'placed');
  assert.equal(JSON.parse(fs.readFileSync(witnessPath(dir), 'utf8')).active_config, path.basename(ROUTING_CONFIG));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, TREE, 'state.json'), 'utf8')).phase, 'onboarding');
  assert.deepEqual(snapshot(path.join(dir, result.archive_path)), before);
});

test('B-11 reenter-phase-archived-complete-witness: a witnessed scaffold is never rebuilt, moved aside, or deleted', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);
  stashTree(dir);
  plantTxn(dir, { phase: 'archived' });
  scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
  fs.writeFileSync(path.join(dir, TREE, 'settings.json'), '{"interview":"already answered"}');

  const result = archive(dir);

  assert.equal(result.phase, 'placed');
  assert.equal(fs.readFileSync(path.join(dir, TREE, 'settings.json'), 'utf8'), '{"interview":"already answered"}');
  assert.deepEqual(readTxn(dir).aborted_scaffolds, []);
  assert.equal(fs.readdirSync(markerDirOf(dir)).includes('aborted-scaffold-1'), false);
});

test('B-14b scaffolded with the archive already placed: the lost phase write is recovered and no legacy-2 is created', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  stashTree(dir);
  plantTxn(dir, { phase: 'scaffolded' });
  scaffoldTree(dir, { routingConfigPath: ROUTING_CONFIG });
  fs.renameSync(markerTreeOf(dir), path.join(archiveDirOf(dir), 'legacy-1'));

  const result = archive(dir);

  assert.equal(result.archive_path, ARCHIVE_1);
  assert.deepEqual(fs.readdirSync(archiveDirOf(dir)).sort(), ['legacy-1']);
  assert.deepEqual(snapshot(path.join(dir, result.archive_path)), before);
});

test('B-17 refuse-hazard-rows: claimed with two trees, claimed with none, archived with the tree gone, scaffolded with no fresh tree', () => {
  // claimed + both .kiln and <marker>/tree present — an outside writer acted
  const both = mkTmpDir();
  legacyFixture(both);
  fs.mkdirSync(markerTreeOf(both), { recursive: true });
  fs.writeFileSync(path.join(markerTreeOf(both), 'LAW.md'), 'other\n');
  plantTxn(both, { phase: 'claimed' });
  const bothBefore = snapshot(treeDirOf(both));
  assert.throws(() => archive(both), /hazard/);
  assert.deepEqual(snapshot(treeDirOf(both)), bothBefore);
  assert.equal(fs.readFileSync(path.join(markerTreeOf(both), 'LAW.md'), 'utf8'), 'other\n');

  // claimed + neither — the tree vanished between classification and claim
  const neither = mkTmpDir();
  plantTxn(neither, { phase: 'claimed' });
  assert.throws(() => archive(neither), /nothing to archive/);
  assert.equal(fs.existsSync(markerDirOf(neither)), false, 'the marker was not retired');

  // archived + <marker>/tree gone
  const gone = mkTmpDir();
  plantTxn(gone, { phase: 'archived' });
  scaffoldTree(gone, { routingConfigPath: ROUTING_CONFIG });
  const goneBefore = snapshot(treeDirOf(gone));
  assert.throws(() => archive(gone), /hazard/);
  assert.deepEqual(snapshot(treeDirOf(gone)), goneBefore);

  // scaffolded + no fresh tree
  const removed = mkTmpDir();
  legacyFixture(removed);
  stashTree(removed);
  plantTxn(removed, { phase: 'scaffolded' });
  const removedBefore = snapshot(markerTreeOf(removed));
  assert.throws(() => archive(removed), /hazard/);
  assert.deepEqual(snapshot(markerTreeOf(removed)), removedBefore);
});

test('a scaffold failure stops with the legacy tree named and the restore commands printed, never a retry', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);
  stashTree(dir);
  plantTxn(dir, { phase: 'archived' });

  assert.throws(
    () => archiveLegacyTree(dir, { routingConfigPath: path.join(dir, 'routing-2026-07-27-9.json') }),
    (err) => err.message.includes(markerTreeOf(dir)) && /\bmv\b/.test(err.message)
  );
  assert.deepEqual(snapshot(markerTreeOf(dir)), before);
  assert.equal(readTxn(dir).phase, 'archived');
});

// =====================================================================
// C. Exactly-once
// =====================================================================

test('C-20 archive-destination-exactly-once: three re-entries leave exactly one archive and one fresh tree', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);

  const first = archive(dir);
  const treeAfterFirst = snapshot(treeDirOf(dir));
  const second = archive(dir);
  const third = archive(dir);

  assert.equal(second.archive_path, first.archive_path);
  assert.equal(third.archive_path, first.archive_path);
  assert.equal(second.txn_id, first.txn_id);
  assert.deepEqual(fs.readdirSync(archiveDirOf(dir)).sort(), ['legacy-1']);
  assert.deepEqual(snapshot(path.join(dir, first.archive_path)), before);
  assert.deepEqual(snapshot(treeDirOf(dir)), treeAfterFirst);
});

test('the archive half writes no ledger record: the single intake record is the harvest half to append (§9.1.5)', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);

  archive(dir);

  const { records } = readAll(path.join(dir, TREE, 'ledger.jsonl'));
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'genesis');
});

test('the fresh tree is a plain greenfield genesis: onboarding phase, empty settings, no earned state', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);

  archive(dir);

  const state = JSON.parse(fs.readFileSync(path.join(dir, TREE, 'state.json'), 'utf8'));
  assert.equal(state.phase, 'onboarding');
  assert.equal(state.next_action, 'onboarding');
  assert.deepEqual(state.phase_status, {});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, TREE, 'settings.json'), 'utf8')), {});
});

// =====================================================================
// Process re-entry through the CLI (design §9.1.6)
// =====================================================================

test('CLI: archive prints the transaction record and re-entry in a second process is a no-op', () => {
  const dir = mkTmpDir();
  const tree = legacyFixture(dir);
  const before = snapshot(tree);

  const first = runCli(dir);
  assert.equal(first.status, 0, first.stderr);
  const parsed = JSON.parse(first.stdout);
  assert.equal(parsed.phase, 'placed');
  assert.equal(parsed.archive_path, ARCHIVE_1);
  assert.equal(parsed.tier, 1);
  assert.ok(parsed.markers.includes('LAW.md'));

  const second = runCli(dir);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).archive_path, parsed.archive_path);
  assert.deepEqual(fs.readdirSync(archiveDirOf(dir)).sort(), ['legacy-1']);
  assert.deepEqual(snapshot(path.join(dir, ARCHIVE_1)), before);
});

test('CLI: a refusal exits non-zero and names the path', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);
  fs.writeFileSync(markerDirOf(dir), 'planted\n');

  const proc = runCli(dir);

  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /intake\.js:/);
  assert.ok(proc.stderr.includes(markerDirOf(dir)));
});

test('CLI: usage is refused without --routing, on an unknown command, and on a surplus argument', () => {
  const dir = mkTmpDir();
  legacyFixture(dir);

  const noRouting = spawnSync(process.execPath, [CLI_PATH, 'archive', dir], { encoding: 'utf8' });
  assert.equal(noRouting.status, 1);
  assert.match(noRouting.stderr, /usage:/);

  const unknown = spawnSync(process.execPath, [CLI_PATH, 'harvest-everything', dir, '--routing', ROUTING_CONFIG], {
    encoding: 'utf8',
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /usage:/);

  const surplus = runCli(dir, ['extra-argument']);
  assert.equal(surplus.status, 1);
  assert.match(surplus.stderr, /extra-argument/);

  assert.equal(fs.existsSync(markerDirOf(dir)), false);
});
