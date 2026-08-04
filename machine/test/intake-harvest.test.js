'use strict';

// Legacy intake — the HARVEST half (legacy-intake design §3, §4, and §9.2's
// containment contract). The archive half's own tests live in
// intake.test.js; every test here re-enters through it, because the design's
// sequencing makes the transaction the thing every later step resumes from:
// a harvest only ever runs against a transaction already at phase `placed`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { archiveLegacyTree, harvestLegacy } = require('../src/intake.js');
const { detect } = require('../src/detect.js');
const { scaffoldTree } = require('../src/scaffold.js');
const { run: preflightRun } = require('../src/preflight.js');
const { readAll } = require('../src/jsonl.js');
const { validateIntakeReport } = require('../src/validators.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'intake.js');
const ROUTING_CONFIG = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');
const FIXTURES = path.join(__dirname, 'fixtures');

const TREE = '.thelastskill';
const ARCHIVE_DIR = 'archive';
const MARKER = '.thelastskill-intake';

function mkTmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-test-')));
}

function treeDirOf(dir) {
  return path.join(dir, TREE);
}

// The two hand-built fixtures of §7.3, copied whole into the place a legacy
// tree actually occupies — the same path the current tree wants, which is
// the collision intake exists to resolve. Neither fixture reproduces a byte
// of any real third-party tree; both are written from the shapes verified in
// research/kiln-fold-in/v318-artifact-formats.md.
function plantLegacy(dir, fixture) {
  const tree = treeDirOf(dir);
  fs.cpSync(path.join(FIXTURES, fixture), tree, { recursive: true });
  return tree;
}

// Reconstruct a crash window: the marker and its transaction record, put back
// at a chosen phase so the harvest can be re-entered the way a re-run does.
// The marker is retired at commit (§9.1.4), so re-entry after a completed
// harvest is only reachable this way — which is exactly the state a process
// that died between two of the harvest's own steps leaves behind.
function restoreTxn(dir, txn, phase, overrides = {}) {
  fs.mkdirSync(path.join(dir, MARKER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, MARKER, 'txn.json'),
    JSON.stringify({
      schema_version: 1,
      txn_id: txn.txn_id,
      owner_pid: process.pid,
      project_root_real: dir,
      tree_name: TREE,
      phase,
      archive_path: txn.archive_path,
      aborted_scaffolds: [],
      tier: txn.tier,
      markers: txn.markers,
      started_utc: '2026-07-29T09:00:00.000Z',
      updated_utc: '2026-07-29T09:00:00.000Z',
      ...overrides,
    })
  );
}

// Run the archive half to phase `placed` — the harvest's entry precondition.
function toPlaced(dir, fixture) {
  plantLegacy(dir, fixture);
  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  assert.equal(txn.phase, 'placed');
  return {
    txn,
    treeRoot: treeDirOf(dir),
    archiveAbs: path.join(dir, txn.archive_path),
  };
}

function harvested(dir, fixture) {
  const placed = toPlaced(dir, fixture);
  const report = harvestLegacy(placed.treeRoot, placed.archiveAbs);
  return { ...placed, report };
}

function readReport(treeRoot) {
  return JSON.parse(fs.readFileSync(path.join(treeRoot, 'intake', 'report.json'), 'utf8'));
}

function ledgerRecords(treeRoot) {
  return readAll(path.join(treeRoot, 'ledger.jsonl')).records;
}

function carriedByPath(report, relPath) {
  return report.carried.find((entry) => entry.path === relPath) || null;
}

function notedReason(report, relPath) {
  const entry = report.noted.entries.find((e) => e.path === relPath);
  return entry ? entry.reason : null;
}

function ignoredReason(report, relPath) {
  const entry = report.ignored.find((e) => e.path === relPath);
  return entry ? entry.reason : null;
}

function readTxnOf(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, MARKER, 'txn.json'), 'utf8'));
}

// The whole subtree as one comparable value — every path, its node type, and
// a content hash for each file — so "byte-identical afterwards" is asserted
// rather than approximated by a directory listing.
function fingerprint(root) {
  const out = [];
  const walk = (abs, prefix) => {
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) {
        out.push(`${rel} symlink ${fs.readlinkSync(full)}`);
      } else if (entry.isDirectory()) {
        out.push(`${rel} dir`);
        walk(full, rel);
      } else {
        out.push(`${rel} file ${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
      }
    }
  };
  walk(root, '');
  return out;
}

// Every regular file under the archive, archive-relative, POSIX-separated.
function everyFileUnder(root, prefix = '', out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const abs = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      out.push(rel);
    } else if (entry.isDirectory()) {
      everyFileUnder(abs, rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

// --- the typed harvest (§3.2) ---

test('tier 1 carries prior vision prose into intake/vision/, byte-identical to the frozen archive', () => {
  const dir = mkTmpDir();
  const { treeRoot, archiveAbs, report } = harvested(dir, 'legacy-v3-released');

  for (const [src, dest] of [
    ['docs/vision.md', 'intake/vision/vision.md'],
    ['docs/vision-scope.md', 'intake/vision/vision-scope.md'],
    ['docs/project-brief.md', 'intake/vision/project-brief.md'],
  ]) {
    const entry = carriedByPath(report, src);
    assert.ok(entry, `${src} was not carried`);
    assert.equal(entry.dest, dest);
    assert.equal(entry.role, 'vision');
    assert.equal(entry.trust_flag, 'inherited-unverified');
    assert.equal(
      fs.readFileSync(path.join(treeRoot, ...dest.split('/')), 'utf8'),
      fs.readFileSync(path.join(archiveAbs, ...src.split('/')), 'utf8')
    );
  }
});

test('tier 1 carries LAW prose, slices, and decisions into intake/design/ — the law as prose, never as a seal', () => {
  const dir = mkTmpDir();
  const { treeRoot, report } = harvested(dir, 'legacy-v3-released');

  assert.equal(carriedByPath(report, 'LAW.md').role, 'law');
  assert.equal(carriedByPath(report, 'LAW.md').dest, 'intake/design/LAW.md');
  assert.equal(carriedByPath(report, 'slices.json').role, 'design');
  assert.equal(carriedByPath(report, 'decisions.md').role, 'design');
  assert.match(fs.readFileSync(path.join(treeRoot, 'intake', 'design', 'LAW.md'), 'utf8'), /# LAW/);
});

test('tier 1 carries prior findings into intake/research/ and the prior map into intake/codebase/ as advisory', () => {
  const dir = mkTmpDir();
  const { report } = harvested(dir, 'legacy-v3-released');

  for (const src of ['docs/feasibility.md', 'docs/probe-transport.md', 'docs/research-notes.md']) {
    const entry = carriedByPath(report, src);
    assert.ok(entry, `${src} was not carried`);
    assert.equal(entry.role, 'research');
    assert.equal(entry.dest, `intake/research/${path.basename(src)}`);
  }

  const map = carriedByPath(report, 'docs/codebase-map.md');
  assert.equal(map.role, 'codebase');
  assert.equal(map.dest, 'intake/codebase/codebase-map.md');
  // The one row of §3.2 that is advisory rather than unverified: a prior map
  // of the code is re-derived by scout, never trusted.
  assert.equal(map.trust_flag, 'inherited-advisory');
});

test('seals, audits, reviews, and the law digests are noted and never carried — machine evidence does not survive', () => {
  const dir = mkTmpDir();
  const { treeRoot, report } = harvested(dir, 'legacy-v3-released');

  for (const evidencePath of ['seals.log', 'audits.log', 'reviews.jsonl', 'law/lock.hash', 'law/check.sh']) {
    assert.equal(carriedByPath(report, evidencePath), null, `${evidencePath} reached carried[]`);
    assert.equal(notedReason(report, evidencePath), 'machine-evidence');
  }
  assert.deepEqual(report.noted.seals, {
    count: 2,
    slices: ['scaffold', 'parse'],
    source: 'seals.log',
    sources: [{ file: 'seals.log', count: 2 }],
  });
  assert.deepEqual(report.noted.reviews, { count: 2 });

  // Nothing that names a seal is anywhere under intake/.
  const intakeFiles = everyFileUnder(path.join(treeRoot, 'intake'));
  for (const rel of intakeFiles) {
    if (rel === 'report.json' || rel === 'report.md') continue;
    assert.equal(/seal|lock\.hash|trio/.test(rel), false, `${rel} carries seal material into intake/`);
  }
});

test('both audit grammars harvest count-only: v3.1.8 two-field `<seam> accept` and dev-HEAD three-field', () => {
  const released = mkTmpDir();
  const relReport = harvested(released, 'legacy-v3-released').report;
  assert.deepEqual(relReport.noted.audits, {
    count: 2,
    source: 'audits.log',
    sources: [{ file: 'audits.log', count: 2 }],
  });

  const dev = mkTmpDir();
  const devReport = harvested(dev, 'legacy-v3-dev').report;
  assert.equal(devReport.noted.audits.count, 2);
  assert.equal(devReport.noted.audits.source, 'audits.jsonl');
  assert.deepEqual(devReport.noted.audits.sources, [
    { file: 'audits.jsonl', count: 2 },
    { file: 'audits.log', count: 2 },
  ]);
  // Neither grammar is parsed or validated: no field of either audit line
  // reaches the report, so the released two-field form can never be checked
  // against the dev three-field form.
  assert.equal(JSON.stringify(devReport).includes('seam-1'), false);
  assert.equal(JSON.stringify(relReport).includes('seam-1'), false);
});

test('a seals.log disagreeing with seals.jsonl harvests both counts and repairs neither', () => {
  const dir = mkTmpDir();
  const { archiveAbs, report } = harvested(dir, 'legacy-v3-dev');

  assert.equal(report.noted.seals.source, 'seals.jsonl');
  assert.equal(report.noted.seals.count, 2);
  assert.deepEqual(report.noted.seals.slices, ['ingest', 'render']);
  assert.deepEqual(report.noted.seals.sources, [
    { file: 'seals.jsonl', count: 2 },
    { file: 'seals.log', count: 1 },
  ]);
  // The archive is frozen: the stale projection is still exactly one line.
  assert.equal(fs.readFileSync(path.join(archiveAbs, 'seals.log'), 'utf8'), 'ingest dual\n');
});

test('a sealed brainstorm ledger is carried as vision input; an unsealed one is noted only', () => {
  const sealed = mkTmpDir();
  const sealedRun = harvested(sealed, 'legacy-v3-released');
  const entry = carriedByPath(sealedRun.report, 'brainstorm-ledger.jsonl');
  assert.ok(entry, 'a sealed brainstorm ledger was not carried');
  assert.equal(entry.role, 'vision');
  assert.equal(fs.existsSync(path.join(sealedRun.treeRoot, 'intake', 'vision', 'brainstorm-ledger.jsonl')), true);

  const unsealed = mkTmpDir();
  const unsealedRun = harvested(unsealed, 'legacy-v3-dev');
  assert.equal(carriedByPath(unsealedRun.report, 'brainstorm-ledger.jsonl'), null);
  assert.equal(notedReason(unsealedRun.report, 'brainstorm-ledger.jsonl'), 'unsealed-brainstorm-ledger');
  assert.equal(
    fs.existsSync(path.join(unsealedRun.treeRoot, 'intake', 'vision', 'brainstorm-ledger.jsonl')),
    false
  );
});

test('STATE.md, state.json, and posture.json are recorded verbatim and namespaced under noted', () => {
  const dir = mkTmpDir();
  const { archiveAbs, report } = harvested(dir, 'legacy-v3-dev');

  const paths = report.noted.verbatim.map((v) => v.path).sort();
  assert.deepEqual(paths, ['STATE.md', 'posture.json', 'state.json']);
  for (const record of report.noted.verbatim) {
    assert.equal(record.truncated, false);
    assert.equal(record.text, fs.readFileSync(path.join(archiveAbs, record.path), 'utf8'));
    assert.equal(carriedByPath(report, record.path), null, `${record.path} reached carried[]`);
  }
});

test('law seal state is a noted presence fact across sealed, torn, and unsealed trees', () => {
  const sealed = mkTmpDir();
  assert.equal(harvested(sealed, 'legacy-v3-dev').report.noted.law_sealed, 'sealed');

  const torn = mkTmpDir();
  plantLegacy(torn, 'legacy-v3-dev');
  fs.rmSync(path.join(treeDirOf(torn), 'law', 'lock.hash'));
  let txn = archiveLegacyTree(torn, { routingConfigPath: ROUTING_CONFIG });
  let report = harvestLegacy(treeDirOf(torn), path.join(torn, txn.archive_path));
  assert.equal(report.noted.law_sealed, 'torn');

  const unsealed = mkTmpDir();
  plantLegacy(unsealed, 'legacy-v3-dev');
  for (const name of ['lock.hash', 'lock.seal', 'trio.hash']) {
    fs.rmSync(path.join(treeDirOf(unsealed), 'law', name));
  }
  txn = archiveLegacyTree(unsealed, { routingConfigPath: ROUTING_CONFIG });
  report = harvestLegacy(treeDirOf(unsealed), path.join(unsealed, txn.archive_path));
  assert.equal(report.noted.law_sealed, 'unsealed');
});

test('evidence generations and transient runtime state are counted and listed, never carried, never silently dropped', () => {
  const dir = mkTmpDir();
  const { treeRoot, report } = harvested(dir, 'legacy-v3-dev');

  assert.deepEqual(report.noted.evidence, { count: 2, generations: ['gen-1', 'gen-2'] });
  for (const rel of ['evidence/gen-1/probe.txt', 'evidence/gen-2/probe.txt']) {
    assert.equal(notedReason(report, rel), 'machine-evidence');
  }
  for (const rel of ['degraded', 'degraded-ack', 'run.lock', '.turn.tmp', '.wide/scratch.txt']) {
    assert.equal(ignoredReason(report, rel), 'transient', `${rel} was not listed as transient`);
  }
  assert.equal(fs.existsSync(path.join(treeRoot, 'intake', 'documents')), false);
});

test('a run-claim document is noted, not carried: what the old run said it delivered binds nothing', () => {
  const dir = mkTmpDir();
  const { report } = harvested(dir, 'legacy-v3-dev');
  for (const rel of ['narration.md', 'build-notes.md']) {
    assert.equal(notedReason(report, rel), 'run-claim');
    assert.equal(carriedByPath(report, rel), null);
  }
});

test('a document outside the tier-1 table is noted as untyped, never silently dropped and never carried', () => {
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v3-released');
  fs.writeFileSync(path.join(treeDirOf(dir), 'README.md'), '# stray\n');
  fs.mkdirSync(path.join(treeDirOf(dir), 'notes'));
  fs.writeFileSync(path.join(treeDirOf(dir), 'notes', 'meeting.md'), '# meeting\n');
  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  assert.equal(notedReason(report, 'README.md'), 'untyped');
  assert.equal(notedReason(report, 'notes/meeting.md'), 'untyped');
  assert.equal(carriedByPath(report, 'README.md'), null);
});

test('every file in the archive is accounted for exactly once across carried, noted, ignored, and unreadable', () => {
  for (const fixture of ['legacy-v3-released', 'legacy-v3-dev']) {
    const dir = mkTmpDir();
    const { archiveAbs, report } = harvested(dir, fixture);
    const onDisk = everyFileUnder(archiveAbs).sort();
    const accounted = [
      ...report.carried.map((e) => e.path),
      ...report.noted.entries.map((e) => e.path),
      ...report.ignored.map((e) => e.path),
      ...report.unreadable.map((e) => e.path),
    ].sort();
    assert.deepEqual(accounted, onDisk, `${fixture}: the archive and the report disagree about what is in it`);
  }
});

test('the harvest is presence-keyed: a tree missing slices.json harvests everything else', () => {
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v3-released');
  fs.rmSync(path.join(treeDirOf(dir), 'slices.json'));
  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  assert.equal(carriedByPath(report, 'slices.json'), null);
  assert.ok(carriedByPath(report, 'LAW.md'));
  assert.ok(carriedByPath(report, 'docs/vision.md'));
  assert.deepEqual(validateIntakeReport(report), { ok: true, errors: [] });
});

test('a legacy tree with nothing carryable harvests to a valid report with an empty carried[]', () => {
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v3-released');
  const tree = treeDirOf(dir);
  // Strip it to two strong markers that are BOTH machine evidence — `law/`
  // and `seals.log` — so the tree is squarely tier 1 and yet holds not one
  // line of prose the harvest may carry.
  for (const entry of fs.readdirSync(tree)) {
    if (entry === 'seals.log' || entry === 'law') continue;
    fs.rmSync(path.join(tree, entry), { recursive: true });
  }
  for (const entry of fs.readdirSync(path.join(tree, 'law'))) {
    fs.rmSync(path.join(tree, 'law', entry));
  }

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));
  assert.deepEqual(report.carried, []);
  assert.equal(report.noted.law_sealed, 'unsealed');
  assert.equal(report.noted.seals.count, 2);
  assert.equal(report.noted.reviews, null);
  assert.deepEqual(validateIntakeReport(report), { ok: true, errors: [] });
  assert.equal(fs.existsSync(path.join(treeDirOf(dir), 'intake', 'report.json')), true);
});

// --- §3.5's six non-goals, each as its own test ---

test('NON-GOAL 2 (the anti-synthesis test): after the harvest, state.json is still the genesis onboarding state, byte for byte', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-dev');
  const statePath = path.join(placed.treeRoot, 'state.json');
  const before = fs.readFileSync(statePath, 'utf8');

  harvestLegacy(placed.treeRoot, placed.archiveAbs);

  const after = fs.readFileSync(statePath, 'utf8');
  assert.equal(after, before, 'the harvest rewrote state.json');
  const state = JSON.parse(after);
  assert.equal(state.phase, 'onboarding');
  assert.equal(state.next_action, 'onboarding');
  assert.deepEqual(state.phase_status, {});
  // No position is synthesized, and there is no longer a key in which to
  // synthesize one: genesis writes no milestone/chunk pointer at all, so a
  // harvest that invented one would have had to invent the field too.
  assert.equal('current_milestone' in state, false);
  assert.equal('current_chunk' in state, false);
  // The old run's own vocabulary never appears in the new state file.
  for (const legacyKey of ['stage', 'next_action_key', 'active_slice', 'revision', 'render_digest', 'seals']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(state, legacyKey),
      false,
      `state.json inherited the legacy key "${legacyKey}"`
    );
  }
});

test('NON-GOAL 3: no resume point is fabricated — the archived STATE.md next_action never reaches the new tree', () => {
  const dir = mkTmpDir();
  const { treeRoot } = harvested(dir, 'legacy-v3-dev');
  const stateText = fs.readFileSync(path.join(treeRoot, 'state.json'), 'utf8');
  assert.equal(stateText.includes('validate'), false);
  assert.equal(stateText.includes('render'), false);
  assert.equal(detect(path.dirname(treeRoot)).mode, 'resume');
  assert.equal(JSON.parse(stateText).phase, 'onboarding');
});

test('NON-GOALS 1 and 4: the ledger gains exactly one intake record and no gate, chunk-green, or phase-transition anywhere', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const treeRoot = placed.treeRoot;
  // Everything the genesis scaffold wrote, before the harvest touches the
  // tree — so the claim under test is not "these paths are empty" but "the
  // harvest changed nothing outside intake/ and one ledger line".
  const before = new Map(
    everyFileUnder(treeRoot).map((rel) => [rel, fs.readFileSync(path.join(treeRoot, ...rel.split('/')), 'utf8')])
  );
  const report = harvestLegacy(treeRoot, placed.archiveAbs);
  const txn = placed.txn;

  for (const [rel, content] of before) {
    if (rel === 'ledger.jsonl') continue;
    assert.equal(
      fs.readFileSync(path.join(treeRoot, ...rel.split('/')), 'utf8'),
      content,
      `the harvest rewrote ${rel}`
    );
  }
  const added = everyFileUnder(treeRoot).filter((rel) => !before.has(rel));
  assert.equal(
    added.every((rel) => rel.startsWith('intake/')),
    true,
    `the harvest wrote outside intake/: ${added.filter((rel) => !rel.startsWith('intake/')).join(', ')}`
  );

  const records = ledgerRecords(treeRoot);
  assert.deepEqual(records.map((r) => r.kind), ['genesis', 'intake']);
  const intakeRecord = records[1];
  assert.equal(intakeRecord.txn_id, txn.txn_id);
  assert.equal(intakeRecord.correlation_id, txn.txn_id);
  assert.equal(intakeRecord.tier, 1);
  assert.equal(intakeRecord.archive_path, txn.archive_path);
  assert.equal(intakeRecord.carried_count, report.carried.length);

  // No milestone, verification, or architecture artifact was created at all,
  // and the parking stream still holds only its genesis record.
  assert.deepEqual(fs.readdirSync(path.join(treeRoot, 'milestones')), []);
  assert.deepEqual(fs.readdirSync(path.join(treeRoot, 'verification', 'runs')), []);
  assert.deepEqual(fs.readdirSync(path.join(treeRoot, 'architecture')), []);
  assert.deepEqual(readAll(path.join(treeRoot, 'last-mile.jsonl')).records.map((r) => r.kind), ['genesis']);
  const ledgerText = fs.readFileSync(path.join(treeRoot, 'ledger.jsonl'), 'utf8');
  for (const forbidden of ['chunk-green', 'phase-transition', '"gate"', 'plan-gate-decision']) {
    assert.equal(ledgerText.includes(forbidden), false, `the ledger holds a ${forbidden} record`);
  }
});

test('NON-GOAL 5: settings are never inherited — settings.json is untouched and posture.json is noted only', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-dev');
  const settingsPath = path.join(placed.treeRoot, 'settings.json');
  const before = fs.readFileSync(settingsPath, 'utf8');

  const report = harvestLegacy(placed.treeRoot, placed.archiveAbs);

  assert.equal(fs.readFileSync(settingsPath, 'utf8'), before);
  const settings = JSON.parse(before);
  for (const key of ['scope', 'novelty', 'reversibility']) {
    assert.equal(Object.prototype.hasOwnProperty.call(settings, key), false);
  }
  assert.equal(carriedByPath(report, 'posture.json'), null);
  assert.equal(notedReason(report, 'posture.json'), 'verbatim');
});

test('NON-GOAL 6: no research-cache entry is written — a legacy research document has no citation to fabricate', () => {
  const dir = mkTmpDir();
  const { treeRoot, report } = harvested(dir, 'legacy-v3-released');

  // research/ holds nothing but the genesis scratchpad the scaffold seeded:
  // no cache directory, no cached entry, no source list.
  assert.deepEqual(fs.readdirSync(path.join(treeRoot, 'research')), ['scratchpad.jsonl']);
  assert.deepEqual(readAll(path.join(treeRoot, 'research', 'scratchpad.jsonl')).records.map((r) => r.kind), [
    'genesis',
  ]);
  // The prior findings landed under intake/research/ instead, as flagged
  // input the chief reads — never as a cached source with an invented URL.
  assert.ok(carriedByPath(report, 'docs/feasibility.md'));
  assert.equal(fs.existsSync(path.join(treeRoot, 'intake', 'research', 'feasibility.md')), true);
});

// --- validate-before-write, idempotence, exactly-once (§9.2.4, §9.1.5) ---

test('the report on disk passes validateIntakeReport and matches the returned object', () => {
  const dir = mkTmpDir();
  const { treeRoot, report } = harvested(dir, 'legacy-v3-dev');
  const onDisk = readReport(treeRoot);
  assert.deepEqual(onDisk, report);
  assert.deepEqual(validateIntakeReport(onDisk), { ok: true, errors: [] });
  assert.match(fs.readFileSync(path.join(treeRoot, 'intake', 'report.md'), 'utf8'), /archive/i);
});

test('G-38 unreadable-source-does-not-sink-the-pass: an unreadable file lands in unreadable[] and the harvest still commits', () => {
  if (process.getuid && process.getuid() === 0) return; // root reads anything
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v3-released');
  fs.chmodSync(path.join(treeDirOf(dir), 'docs', 'vision.md'), 0o000);
  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  const entry = report.unreadable.find((e) => e.path === 'docs/vision.md');
  assert.ok(entry, 'the unreadable file was not recorded');
  assert.match(entry.reason, /EACCES/);
  assert.equal(carriedByPath(report, 'docs/vision.md'), null);
  // One bad file does not sink the pass: everything else still committed.
  assert.ok(carriedByPath(report, 'docs/project-brief.md'));
  assert.deepEqual(validateIntakeReport(report), { ok: true, errors: [] });
});

test('C-19 harvest-plan-deterministic: re-harvesting the frozen archive yields identical bytes', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-dev');
  const intakeDir = path.join(placed.treeRoot, 'intake');
  const bytes = () =>
    everyFileUnder(intakeDir)
      .sort()
      .map((rel) => [rel, fs.readFileSync(path.join(intakeDir, ...rel.split('/')), 'utf8')]);

  const first = harvestLegacy(placed.treeRoot, placed.archiveAbs);
  const firstBytes = bytes();

  // Re-enter the whole harvest against the same frozen archive, from the
  // recorded phase — the plan is a pure function of (archive, tier), so a
  // re-run re-plans identically and re-copying is idempotent.
  restoreTxn(dir, placed.txn, 'placed');
  const second = harvestLegacy(placed.treeRoot, placed.archiveAbs);

  assert.deepEqual(bytes().filter(([rel]) => rel !== 'report.json' && rel !== 'report.md'),
    firstBytes.filter(([rel]) => rel !== 'report.json' && rel !== 'report.md'));
  assert.deepEqual({ ...second, harvested_utc: null }, { ...first, harvested_utc: null });
});

test('C-18 intake-ledger-record-exactly-once: three re-entries leave exactly one intake record', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-dev');
  harvestLegacy(placed.treeRoot, placed.archiveAbs);
  restoreTxn(dir, placed.txn, 'placed');
  harvestLegacy(placed.treeRoot, placed.archiveAbs);
  restoreTxn(dir, placed.txn, 'placed');
  harvestLegacy(placed.treeRoot, placed.archiveAbs);

  const intakeRecords = ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake');
  assert.equal(intakeRecords.length, 1, 'the intake record is not exactly-once across re-entries');
  assert.equal(intakeRecords[0].txn_id, placed.txn.txn_id);
  assert.equal(fs.existsSync(path.join(dir, MARKER)), false, 'the marker was not retired');
});

test('B-15 reenter-phase-placed-midharvest: a crash mid-copy re-plans the whole pass and commits exactly one report state', () => {
  // A clean pass over the same fixture: the single state a `placed` re-entry
  // must converge on, whatever partial bytes the crash left behind. Only the
  // four per-run identity fields differ between two projects — the minted
  // txn_id, the restore commands that name this project's own paths, and the
  // two timestamps — so the comparison below normalizes exactly those and
  // holds the whole plan (carried, noted, ignored, unreadable, counts) equal.
  const cleanDir = mkTmpDir();
  const clean = harvested(cleanDir, 'legacy-v3-released');
  const planOf = (report) => ({
    ...report,
    txn_id: null,
    restore_commands: null,
    harvested_utc: null,
    archive_mtime: null,
  });

  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  // The crash window inside `commitHarvest`: `intake/` exists, some planned
  // destinations are already written — one of them truncated the way a copy
  // interrupted mid-write leaves it, one opened and never written — and
  // `report.json` never landed, so nothing on disk accounts for the pass.
  const intakeDir = path.join(placed.treeRoot, 'intake');
  const truncated = path.join(intakeDir, 'vision', 'vision.md');
  fs.mkdirSync(path.dirname(truncated), { recursive: true });
  fs.writeFileSync(truncated, '# vis');
  const emptied = path.join(intakeDir, 'design', 'LAW.md');
  fs.mkdirSync(path.dirname(emptied), { recursive: true });
  fs.writeFileSync(emptied, '');
  assert.equal(fs.existsSync(path.join(intakeDir, 'report.json')), false);

  const report = harvestLegacy(placed.treeRoot, placed.archiveAbs);

  // Re-planned and re-committed rather than patched: every carried
  // destination holds the frozen archive's bytes, the two half-written ones
  // included.
  for (const entry of report.carried) {
    assert.deepEqual(
      fs.readFileSync(path.join(placed.treeRoot, ...entry.dest.split('/'))),
      fs.readFileSync(path.join(placed.archiveAbs, ...entry.path.split('/'))),
      `${entry.dest} kept the bytes the interrupted copy left`
    );
  }
  assert.ok(carriedByPath(report, 'docs/vision.md'), 'the truncated destination was dropped from the re-plan');
  assert.ok(carriedByPath(report, 'LAW.md'), 'the emptied destination was dropped from the re-plan');
  assert.deepEqual(planOf(report), planOf(clean.report));

  // Exactly one report state: the returned report, the committed report.json,
  // and one rendered report.md — no second report file and no atomic-write
  // residue left beside them.
  assert.deepEqual({ ...readReport(placed.treeRoot), harvested_utc: null }, { ...report, harvested_utc: null });
  assert.deepEqual(
    fs.readdirSync(intakeDir).filter((name) => name.startsWith('report')).sort(),
    ['report.json', 'report.md']
  );
  assert.equal(ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake').length, 1);
  assert.equal(fs.existsSync(path.join(dir, MARKER)), false, 'the marker was not retired');
});

test('B-16 reenter-phase-harvested: a crash after the report but before the ledger appends exactly one record', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-dev');
  harvestLegacy(placed.treeRoot, placed.archiveAbs);
  assert.equal(ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake').length, 1);

  // Reconstruct the crash window: the report is committed and the phase says
  // `harvested`, but the ledger append never ran.
  const ledgerPath = path.join(placed.treeRoot, 'ledger.jsonl');
  fs.writeFileSync(
    ledgerPath,
    readAll(ledgerPath)
      .records.filter((r) => r.kind !== 'intake')
      .map((r) => `${JSON.stringify(r)}\n`)
      .join('')
  );
  restoreTxn(dir, placed.txn, 'harvested');

  harvestLegacy(placed.treeRoot, placed.archiveAbs);
  assert.equal(ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake').length, 1);
  assert.equal(fs.existsSync(path.join(dir, MARKER)), false, 'the marker was not retired');
});

test('the marker is retired at commit and the migrated project classifies `resume` from then on', () => {
  const dir = mkTmpDir();
  const { treeRoot } = harvested(dir, 'legacy-v3-released');
  assert.equal(fs.existsSync(path.join(dir, MARKER)), false);
  const seen = detect(dir);
  assert.equal(seen.mode, 'resume');
  assert.equal(seen.evidence.intake_txn, null);
  // The archive is still whole inside the tree, and it re-triggers nothing.
  assert.equal(fs.existsSync(path.join(treeRoot, 'archive', 'legacy-1', 'LAW.md')), true);
});

test('G-37 malformed-report-writes-nothing: a report failing validateIntakeReport copies nothing and appends nothing', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  // The reachable route to an invalid report: the transaction record carries
  // the markers detect found, and `markers` is the one field the ladder never
  // re-derives (from phase `archived` on, the legacy tree is no longer where
  // detect could look). A corrupt entry there produces a report the validator
  // refuses — and the plan phase runs that validator BEFORE the first copy,
  // so intake/ is never created at all.
  restoreTxn(dir, placed.txn, 'placed', { markers: ['LAW.md', ''] });

  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /markers/);
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake')), false);
  assert.equal(ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake').length, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, MARKER, 'txn.json'), 'utf8')).phase, 'placed');
});

// --- containment: destinations (§9.2.2) ---

test('D-23 dest-leaf-symlink-refuses: a pre-planted intake/report.json symlink is never written through', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const outside = path.join(dir, 'outside.json');
  fs.writeFileSync(outside, '{"untouched":true}\n');
  fs.mkdirSync(path.join(placed.treeRoot, 'intake'));
  fs.symlinkSync(outside, path.join(placed.treeRoot, 'intake', 'report.json'));

  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /symlink/i);
  assert.equal(fs.readFileSync(outside, 'utf8'), '{"untouched":true}\n');
  assert.equal(ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake').length, 0);
});

test('D-21 dest-nested-parent-symlink-refuses: a real intake/ with a symlinked intake/vision writes nothing outside', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(placed.treeRoot, 'intake'));
  fs.symlinkSync(outside, path.join(placed.treeRoot, 'intake', 'vision'), 'dir');

  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /symlink|outside/i);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake', 'report.json')), false);
});

test('D-22 dest-deep-parent-symlink-refuses: the escape is caught at depth, before any copy', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(placed.treeRoot, 'intake', 'design'), { recursive: true });
  fs.symlinkSync(outside, path.join(placed.treeRoot, 'intake', 'design', 'LAW.md'));

  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /symlink|outside/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('D-26 containment-refusal-mutates-nothing: a refused harvest leaves the tree and the archive byte-identical', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const snapshot = (root) =>
    everyFileUnder(root)
      .sort()
      .map((rel) => {
        const abs = path.join(root, ...rel.split('/'));
        if (fs.lstatSync(abs).isSymbolicLink()) return [rel, `symlink:${fs.readlinkSync(abs)}`];
        return [rel, crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')];
      });
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(placed.treeRoot, 'intake'));
  fs.symlinkSync(outside, path.join(placed.treeRoot, 'intake', 'research'), 'dir');

  const treeBefore = snapshot(placed.treeRoot);
  const archiveBefore = snapshot(placed.archiveAbs);
  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /^Error: intake: .*symlink/);
  assert.deepEqual(snapshot(placed.treeRoot), treeBefore);
  assert.deepEqual(snapshot(placed.archiveAbs), archiveBefore);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, MARKER, 'txn.json'), 'utf8')).phase, 'placed');
});

test('G-39 plan-validated-before-first-copy: a violation on the LAST planned destination leaves no earlier file copied', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  // report.json is the very last write of the commit phase; a symlink there
  // must still be caught in the plan, before the first document is copied.
  fs.mkdirSync(path.join(placed.treeRoot, 'intake'));
  fs.symlinkSync(path.join(outside, 'stolen.json'), path.join(placed.treeRoot, 'intake', 'report.json'));

  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /^Error: intake: .*symlink/);
  // Not one document was copied: intake/ still holds only the planted link.
  assert.deepEqual(fs.readdirSync(path.join(placed.treeRoot, 'intake')), ['report.json']);
  assert.deepEqual(fs.readdirSync(outside), []);
});

// --- containment: roots and sources (§9.2.1, §9.2.3) ---

test('D-25 symlinked-tree-root-refuses: a symlinked treeRoot never reaches the harvest', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const linked = path.join(dir, 'linked-tree');
  fs.symlinkSync(placed.treeRoot, linked, 'dir');
  assert.throws(() => harvestLegacy(linked, placed.archiveAbs), /symlink|not a real directory/i);
});

test('E-27/E-28/E-29/E-30 source containment: outside, intake itself, the tree root, and an intake descendant all refuse', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const outside = path.join(dir, 'elsewhere');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(placed.treeRoot, 'intake', 'documents'), { recursive: true });

  for (const source of [
    outside,
    path.join(placed.treeRoot, 'intake'),
    placed.treeRoot,
    path.join(placed.treeRoot, 'intake', 'documents'),
    path.join(placed.treeRoot, 'archive'),
  ]) {
    assert.throws(
      () => harvestLegacy(placed.treeRoot, source),
      /archive/i,
      `${source} was accepted as a harvest source`
    );
  }
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake', 'report.json')), false);
});

test('E-31 source-archive-symlink-refuses: a symlinked legacy-N is never followed', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const decoy = path.join(placed.treeRoot, 'archive', 'legacy-2');
  fs.symlinkSync(placed.archiveAbs, decoy, 'dir');
  assert.throws(() => harvestLegacy(placed.treeRoot, decoy), /symlink|not a real directory/i);
});

test('E-32 tier1-source-symlink-internal-noted: a docs/vision.md symlinked at seals.log delivers no seal bytes', () => {
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v3-released');
  const tree = treeDirOf(dir);
  fs.rmSync(path.join(tree, 'docs', 'vision.md'));
  fs.symlinkSync('../seals.log', path.join(tree, 'docs', 'vision.md'));

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(tree, path.join(dir, txn.archive_path));

  assert.equal(carriedByPath(report, 'docs/vision.md'), null);
  const noted = report.noted.entries.find((e) => e.path === 'docs/vision.md');
  assert.deepEqual(noted, { path: 'docs/vision.md', reason: 'symlink', link_target: '../seals.log' });
  assert.equal(fs.existsSync(path.join(tree, 'intake', 'vision', 'vision.md')), false);
  const carriedText = report.carried
    .map((e) => fs.readFileSync(path.join(tree, ...e.dest.split('/')), 'utf8'))
    .join('');
  assert.equal(carriedText.includes('scaffold dual'), false, 'seal bytes reached intake/');
});

test('E-33 tier1-source-symlink-outside-noted: a link out of the project carries no outside byte', () => {
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v3-released');
  const tree = treeDirOf(dir);
  fs.rmSync(path.join(tree, 'docs', 'project-brief.md'));
  fs.symlinkSync('/etc/hostname', path.join(tree, 'docs', 'project-brief.md'));

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(tree, path.join(dir, txn.archive_path));

  assert.equal(carriedByPath(report, 'docs/project-brief.md'), null);
  const noted = report.noted.entries.find((e) => e.path === 'docs/project-brief.md');
  assert.equal(noted.reason, 'symlink');
  assert.equal(noted.link_target, '/etc/hostname');
  assert.equal(fs.existsSync(path.join(tree, 'intake', 'vision', 'project-brief.md')), false);
});

test('a symlinked directory inside the archive is recorded and never descended into', () => {
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v3-released');
  const tree = treeDirOf(dir);
  const outside = path.join(dir, 'outside-docs');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'vision.md'), '# not ours\n');
  fs.symlinkSync(outside, path.join(tree, 'docs', 'more'), 'dir');

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(tree, path.join(dir, txn.archive_path));

  assert.equal(notedReason(report, 'docs/more'), 'symlink');
  assert.equal(report.carried.some((e) => e.path.startsWith('docs/more')), false);
  assert.equal(JSON.stringify(report).includes('not ours'), false);
});

// --- transaction preconditions and the CLI ---

test('harvest refuses when no intake transaction is in flight, and leaves no marker behind', () => {
  const dir = mkTmpDir();
  const { treeRoot, archiveAbs } = harvested(dir, 'legacy-v3-released');
  const before = fs.readFileSync(path.join(treeRoot, 'intake', 'report.json'), 'utf8');
  assert.throws(() => harvestLegacy(treeRoot, archiveAbs), /transaction/i);
  assert.equal(fs.readFileSync(path.join(treeRoot, 'intake', 'report.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, MARKER)), false, 'the refusal minted a marker directory');
});

test('harvest refuses an archivePath that disagrees with the transaction record', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const other = path.join(placed.treeRoot, 'archive', 'legacy-2');
  fs.mkdirSync(other, { recursive: true });
  assert.throws(() => harvestLegacy(placed.treeRoot, other), /archive_path|transaction/i);
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake')), false);
});

test('CLI: harvest prints the report and re-entry in a second process is idempotent', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const first = spawnSync(process.execPath, [CLI_PATH, 'harvest', placed.treeRoot, placed.archiveAbs], {
    encoding: 'utf8',
  });
  assert.equal(first.status, 0, first.stderr);
  const printed = JSON.parse(first.stdout);
  assert.deepEqual(validateIntakeReport(printed), { ok: true, errors: [] });

  const second = spawnSync(process.execPath, [CLI_PATH, 'harvest', placed.treeRoot, placed.archiveAbs], {
    encoding: 'utf8',
  });
  assert.equal(second.status, 1, 'a retired transaction must refuse rather than re-harvest');
  assert.match(second.stderr, /intake\.js:/);
  assert.equal(ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake').length, 1);
});

test('CLI: harvest usage is refused on a missing argument and on a surplus one', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const missing = spawnSync(process.execPath, [CLI_PATH, 'harvest', placed.treeRoot], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /usage/);

  const surplus = spawnSync(
    process.execPath,
    [CLI_PATH, 'harvest', placed.treeRoot, placed.archiveAbs, 'extra'],
    { encoding: 'utf8' }
  );
  assert.equal(surplus.status, 1);
  assert.match(surplus.stderr, /extra/);
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake')), false);
});

test('the report names the restore commands and carries no residue path when no scaffold was aborted', () => {
  const dir = mkTmpDir();
  const { report, treeRoot } = harvested(dir, 'legacy-v3-released');
  assert.equal(report.residue_path, null);
  assert.deepEqual(report.aborted_scaffolds, []);
  assert.equal(report.restore_commands.length, 3);
  assert.ok(report.restore_commands.every((cmd) => cmd.startsWith('mv ')), 'a restore command is not a move');
  assert.equal(report.restore_commands.some((cmd) => cmd.includes('rm ')), false, 'the restore path deletes something');
  const rendered = fs.readFileSync(path.join(treeRoot, 'intake', 'report.md'), 'utf8');
  for (const cmd of report.restore_commands) assert.ok(rendered.includes(cmd));
});

// The tier is read from the transaction, not guessed at harvest time, and it
// selects the classifier. This is the dispatch itself — the tier-2 harvest's
// own behaviour is proven in intake-tier2.test.js.
test('the typed table never runs against a tier-2 tree: the same names are carried generically instead', () => {
  const dir = mkTmpDir();
  const tree = treeDirOf(dir);
  fs.mkdirSync(path.join(tree, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'STATE.md'), '# STATE\nstage: build\n');
  fs.writeFileSync(path.join(tree, 'LAW.md'), '# LAW\n');
  fs.writeFileSync(path.join(tree, 'decisions.md'), '## ADR-1 — x\n');
  fs.writeFileSync(path.join(tree, 'docs', 'vision.md'), '# The vision\n');
  // One strong marker plus one corroborating: tier 1 needs >=1 strong AND
  // >=2 slots, so LAW.md + decisions.md IS tier 1. Drop the strong marker to
  // land in tier 2 with the very names the typed table would have claimed.
  fs.rmSync(path.join(tree, 'LAW.md'));

  const seen = detect(dir);
  assert.equal(seen.mode, 'legacy');
  assert.equal(seen.evidence.legacy_tier, 2);
  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  assert.equal(report.tier, 2);
  assert.equal(carriedByPath(report, 'docs/vision.md').role, 'document');
  assert.equal(carriedByPath(report, 'decisions.md').role, 'document');
  assert.equal(report.carried.some((entry) => entry.role === 'design' || entry.role === 'vision'), false);
  assert.equal(fs.existsSync(path.join(treeDirOf(dir), 'intake', 'design')), false);
});

test('an unrecognized tier is refused rather than harvested by either classifier, and nothing is written', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  // The one branch neither tier owns. A transaction whose tier is not 1 or 2
  // has no classifier at all, and guessing one would decide the honesty of
  // every entry in the report by default.
  restoreTxn(dir, placed.txn, 'placed', { tier: 3 });
  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /tier 3/);
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake')), false);
  assert.equal(ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake').length, 0);
});

test('B-13 aborted-scaffold-retires-marker: the residue is kept whole, named in the report, and removed by one printed command', () => {
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v3-released');
  // Reproduce the one row §9.1.4 closes without deleting anything: the tree
  // is already set aside, and an interrupted scaffold occupies its place with
  // no routing witness. The archive half moves that partial aside rather than
  // forcing over it, and the harvest half is what retires the marker.
  fs.mkdirSync(path.join(dir, MARKER), { recursive: true });
  fs.renameSync(treeDirOf(dir), path.join(dir, MARKER, 'tree'));
  const txnId = 'b7c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5';
  fs.writeFileSync(
    path.join(dir, MARKER, 'txn.json'),
    JSON.stringify({
      schema_version: 1,
      txn_id: txnId,
      owner_pid: process.pid,
      project_root_real: dir,
      tree_name: TREE,
      phase: 'archived',
      archive_path: null,
      aborted_scaffolds: [],
      tier: 1,
      markers: ['LAW.md', 'slices.json'],
      started_utc: '2026-07-29T09:00:00.000Z',
      updated_utc: '2026-07-29T09:00:00.000Z',
    })
  );
  fs.mkdirSync(treeDirOf(dir), { recursive: true });
  fs.writeFileSync(path.join(treeDirOf(dir), 'half-written.txt'), 'partial\n');

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  assert.deepEqual(txn.aborted_scaffolds, ['aborted-scaffold-1']);
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  const residue = path.join(dir, `${MARKER}-aborted-${txnId}`);
  assert.equal(report.residue_path, residue);
  assert.deepEqual(report.aborted_scaffolds, ['aborted-scaffold-1']);
  assert.equal(fs.existsSync(path.join(dir, MARKER)), false, 'the marker was not retired');
  // Nothing was deleted: the interrupted scaffold is still there, whole.
  assert.equal(
    fs.readFileSync(path.join(residue, 'aborted-scaffold-1', 'half-written.txt'), 'utf8'),
    'partial\n'
  );
  const rendered = fs.readFileSync(path.join(treeDirOf(dir), 'intake', 'report.md'), 'utf8');
  assert.ok(rendered.includes(`rm -r "${residue}"`), 'the report does not print the one command that removes the residue');
  // The residue carries the fixed marker name plus a suffix, so detect's row-0
  // probe — which reads only the fixed name — can never re-trigger intake.
  assert.equal(detect(dir).mode, 'resume');
});

// =====================================================================
// P. Marker retirement reads the marker, not the record
//
// The invariant these three bind is the product's first one: nothing in a
// legacy tree is ever deleted. Retirement chose between "remove the marker"
// and "keep it whole" by reading `txn.aborted_scaffolds`, so anything on disk
// inside the marker that the record did not happen to name was destroyed —
// and the report then said `aborted_scaffolds: []`, false about the deletion
// and false about the residue. The decision must be read off the marker's own
// entries, which is also where §9.1.4's two missing `placed`/`harvested`
// hazard rows live.
// =====================================================================

test('P-1 placed-with-a-tree-under-the-marker: the harvest refuses the hazard row and deletes nothing', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  // §9.1.4's `placed | .kiln present | <marker>/tree present` row: a second
  // whole tree under the marker is impossible without an outside writer, and
  // intake never guesses past one. The archive half refuses this at
  // `scaffolded`; the harvest half must refuse it at `placed`.
  const stashed = path.join(dir, MARKER, 'tree');
  fs.mkdirSync(path.join(stashed, 'law'), { recursive: true });
  fs.writeFileSync(path.join(stashed, 'LAW.md'), '# LAW\n\nirreplaceable operator prose\n');
  fs.writeFileSync(path.join(stashed, 'law', 'lock.hash'), 'cafebabe\n');
  const stashedBefore = fingerprint(stashed);
  const archiveBefore = fingerprint(placed.archiveAbs);

  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /hazard/);

  assert.deepEqual(fingerprint(stashed), stashedBefore, 'a whole tree under the marker was not left byte-identical');
  assert.deepEqual(fingerprint(placed.archiveAbs), archiveBefore);
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake')), false);
  assert.equal(ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake').length, 0);
  assert.equal(readTxnOf(dir).phase, 'placed', 'a refused harvest advanced the phase');
});

test('P-2 unrecorded-aborted-scaffold: a partial scaffold the record never named survives retirement and is named in the report', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  // The one ladder step whose durable record is written AFTER its move: the
  // partial-scaffold rename commits, then the persist that records it is
  // lost. The directory is on disk; `aborted_scaffolds` is still empty.
  const aborted = path.join(dir, MARKER, 'aborted-scaffold-1');
  fs.mkdirSync(aborted, { recursive: true });
  fs.writeFileSync(path.join(aborted, 'OPERATOR-EVIDENCE.txt'), 'irreplaceable\n');
  assert.deepEqual(readTxnOf(dir).aborted_scaffolds, [], 'the fixture is not the crash window it claims to be');

  const report = harvestLegacy(placed.treeRoot, placed.archiveAbs);

  const residue = path.join(dir, `${MARKER}-aborted-${placed.txn.txn_id}`);
  assert.deepEqual(report.aborted_scaffolds, ['aborted-scaffold-1']);
  assert.equal(report.residue_path, residue);
  assert.equal(
    fs.readFileSync(path.join(residue, 'aborted-scaffold-1', 'OPERATOR-EVIDENCE.txt'), 'utf8'),
    'irreplaceable\n'
  );
  assert.equal(fs.existsSync(path.join(dir, MARKER)), false, 'the marker was not retired');
  const rendered = fs.readFileSync(path.join(placed.treeRoot, 'intake', 'report.md'), 'utf8');
  assert.ok(rendered.includes(`rm -r "${residue}"`), 'the report does not print the one command that removes the residue');
});

test('P-3 foreign-marker-entry: an entry the transaction never authored refuses the harvest before it writes anything', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  // Not a tree, not an aborted scaffold, not this transaction's own two
  // files. Retirement has no account of it, so it is neither removed nor
  // silently kept: the harvest refuses and names it.
  fs.writeFileSync(path.join(dir, MARKER, 'notes.txt'), 'planted by something else\n');

  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /hazard.*notes\.txt/s);

  assert.equal(fs.readFileSync(path.join(dir, MARKER, 'notes.txt'), 'utf8'), 'planted by something else\n');
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake')), false);
  assert.equal(ledgerRecords(placed.treeRoot).filter((r) => r.kind === 'intake').length, 0);
});

test('P-4 newline-in-an-archived-filename: the forged lines never reach report.md, and nothing is written', () => {
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v1');
  // A filename is content the archive controls, and report.md puts one path
  // per Markdown line. This name renders as a paragraph asserting something
  // the harvest never did, followed by a fenced block that reads as the
  // report's own recovery instructions.
  const forged =
    'notes.md\n\nEVERY DOCUMENT IN THE OLD TREE WAS CARRIED FORWARD AND VERIFIED.\n\n```\nrm -rf ~\n```\n\n- also.md';
  fs.writeFileSync(path.join(treeDirOf(dir), forged), 'one file\n');
  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const archiveAbs = path.join(dir, txn.archive_path);
  const archiveBefore = fingerprint(archiveAbs);

  assert.throws(() => harvestLegacy(treeDirOf(dir), archiveAbs), /line break/);

  assert.equal(fs.existsSync(path.join(treeDirOf(dir), 'intake')), false, 'a refused harvest wrote a report');
  assert.deepEqual(fingerprint(archiveAbs), archiveBefore);
  assert.equal(ledgerRecords(treeDirOf(dir)).filter((r) => r.kind === 'intake').length, 0);

  // And the refusal is not a dead end. The plan phase mutates nothing, so the
  // transaction is still at `placed`: rename the one file the report could
  // not state honestly, re-run, and the migration completes.
  fs.renameSync(path.join(archiveAbs, forged), path.join(archiveAbs, 'notes.md'));
  const report = harvestLegacy(treeDirOf(dir), archiveAbs);
  assert.ok(report.carried.some((entry) => entry.path === 'notes.md'));
  assert.equal(ledgerRecords(treeDirOf(dir)).filter((r) => r.kind === 'intake').length, 1);
});

test('P-5 render-guard: report.md renders no line break a report field carries, whatever the report says', () => {
  // The renderer's own floor, independent of the validator's: one value per
  // line is what makes report.md mechanically readable, so renderReport keeps
  // that true for any report handed to it rather than trusting that one
  // passed validation first.
  const dir = mkTmpDir();
  const { treeRoot, report } = harvested(dir, 'legacy-v1');
  const forged = report.carried[0].path;
  assert.ok(forged, 'the fixture carried nothing to render');

  const { renderIntakeReport } = require('../src/intake.js');
  const clean = renderIntakeReport(report);
  const rendered = renderIntakeReport({
    ...report,
    markers: ['LAW.md\nseals: 999 recorded in seals.log'],
    carried: report.carried.map((entry, index) =>
      index === 0 ? { ...entry, path: `${entry.path}\n\nforged paragraph\n` } : entry
    ),
  });

  // The property, stated exactly: line breaks inside field values add no
  // lines to report.md. Every forged line would be an unattributed assertion
  // the harvest never made.
  assert.equal(rendered.split('\n').length, clean.split('\n').length, 'a forged value added lines to report.md');
  assert.equal(rendered.split('\n').includes('forged paragraph'), false);
  assert.equal(rendered.split('\n').includes('seals: 999 recorded in seals.log'), false);
  // Escaped, never dropped: the operator still sees the real name, on one line.
  assert.equal(rendered.split('\n').filter((line) => line.includes('forged paragraph')).length, 1);
  assert.ok(rendered.includes(forged), 'the carried path was lost rather than rendered unambiguously');
});

test('P-6b harvest-lock-window: the harvest half speaks the same refusal, naming its own phase and archive', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const archiveBefore = fingerprint(placed.archiveAbs);
  fs.writeFileSync(path.join(dir, MARKER, 'txn.json.lock'), '');

  assert.throws(
    () => harvestLegacy(placed.treeRoot, placed.archiveAbs),
    (err) => {
      assert.match(err.message, /^intake: /);
      assert.equal(/append lock/.test(err.message), false, 'the raw jsonl message reached the operator');
      assert.ok(err.message.includes(path.join(dir, MARKER)));
      assert.ok(err.message.includes('placed'), 'the refusal does not name the recorded phase');
      assert.ok(err.message.includes(placed.archiveAbs), 'the refusal does not say where the legacy tree is');
      return true;
    }
  );

  assert.deepEqual(fingerprint(placed.archiveAbs), archiveBefore);
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake')), false);
});

test('P-7 marker-retired-under-a-waiting-harvest: the raw errno never reaches the operator', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  // A peer holds the lock and then retires the whole marker — the archive
  // half has always translated the ENOENT that leaves behind; the harvest
  // half called withLock bare and surfaced the errno. Both take the same
  // lock, so both translate it, from one wrapper.
  fs.writeFileSync(path.join(dir, MARKER, 'txn.json.lock'), '');
  const retire = require('node:child_process').spawn(
    process.execPath,
    ['-e', `setTimeout(() => require("node:fs").rmSync(${JSON.stringify(path.join(dir, MARKER))}, { recursive: true, force: true }), 300)`],
    { detached: true, stdio: 'ignore' }
  );
  retire.unref();

  assert.throws(
    () => harvestLegacy(placed.treeRoot, placed.archiveAbs),
    (err) => {
      assert.match(err.message, /^intake: /);
      assert.match(err.message, /retired by another process/);
      assert.equal(/ENOENT/.test(err.message), false, 'the raw errno reached the operator');
      return true;
    }
  );
});

test('P-9 unusable-tier-has-a-terminal-path: the refusal names the one move that closes the transaction', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  // A tier is recorded once, at mint, from detect's own verdict, so only a
  // hand-written record carries an unusable one. Refusing the harvest is
  // right — guessing a tier would decide the honesty of every entry in the
  // report by default — but the refusal used to say the transaction stayed
  // "re-enterable", and it could never finish: while the marker stands,
  // detect's row 0 routes every entry straight back to it.
  restoreTxn(dir, placed.txn, 'placed', { tier: null });
  const marker = path.join(dir, MARKER);
  const abandoned = `${marker}-abandoned`;

  let message = '';
  assert.throws(
    () => harvestLegacy(placed.treeRoot, placed.archiveAbs),
    (err) => {
      message = err.message;
      return /tier null/.test(err.message);
    }
  );
  assert.ok(message.includes(placed.archiveAbs), 'the refusal does not say where the legacy tree is');
  assert.ok(message.includes(`mv "${marker}" "${abandoned}"`), 'the refusal names no way to close the transaction');
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake')), false);

  // Doing exactly what it says closes it, and costs nothing: the archived
  // tree is untouched and the fresh tree is a tree the pipeline can enter.
  const archiveBefore = fingerprint(placed.archiveAbs);
  fs.renameSync(marker, abandoned);
  assert.equal(detect(dir).mode, 'resume');
  assert.deepEqual(fingerprint(placed.archiveAbs), archiveBefore);
});

// =====================================================================
// S. Every write path, including the two that were exempt
//
// The harvest's containment sweep covered planned directories, copied
// leaves, and both reports — and not `ledger.jsonl`, the one destination
// intake writes to that no check ever saw. And every check was a check of a
// PATHNAME, re-touched later by another pathname operation, so a validated
// path could be replaced between the proof and the use.
// =====================================================================

test('S-1 ledger-containment: a symlinked ledger.jsonl is never appended through', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  const outsideDir = mkTmpDir();
  const outside = path.join(outsideDir, 'stolen-ledger.jsonl');
  fs.writeFileSync(outside, '');
  const ledger = path.join(placed.treeRoot, 'ledger.jsonl');
  fs.rmSync(ledger);
  fs.symlinkSync(outside, ledger);

  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /symlinked target|ledger\.jsonl/);

  assert.equal(fs.readFileSync(outside, 'utf8'), '', 'an intake record was appended outside the tree');
  // The plan phase mutates nothing, so the refusal costs the operator no
  // copied file and no half-written report either.
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake')), false);
});

test('S-2 source-replacement-race: a source swapped for a symlink mid-harvest never delivers the outside bytes', () => {
  const secretDir = mkTmpDir();
  const secret = path.join(secretDir, 'secret.md');
  const secretBytes = '# OUTSIDE BYTES THAT MUST NEVER BE CARRIED\n';
  fs.writeFileSync(secret, secretBytes);

  // The walk lstats a source and proves it a regular file; the copy opens
  // that pathname again, later. A peer that swaps the file for a symlink in
  // between turns proven material into followed material. This is a race, so
  // it asserts the invariant that must hold however the timing lands rather
  // than one outcome: the harvest either refuses or carries the real bytes,
  // and the outside bytes never appear under the tree either way.
  for (let attempt = 0; attempt < 4; attempt++) {
    const dir = mkTmpDir();
    const placed = toPlaced(dir, 'legacy-v3-released');
    const source = path.join(placed.archiveAbs, 'docs', 'vision.md');
    const realBytes = fs.readFileSync(source, 'utf8');

    const flipper = require('node:child_process').spawn(
      process.execPath,
      [
        '-e',
        `const fs = require('node:fs');
         const src = ${JSON.stringify(source)};
         const secret = ${JSON.stringify(secret)};
         const real = fs.readFileSync(src);
         const deadline = Date.now() + 250;
         while (Date.now() < deadline) {
           try { fs.rmSync(src); fs.symlinkSync(secret, src); } catch {}
           try { fs.rmSync(src); fs.writeFileSync(src, real); } catch {}
         }`,
      ],
      { detached: true, stdio: 'ignore' }
    );
    flipper.unref();

    try {
      harvestLegacy(placed.treeRoot, placed.archiveAbs);
    } catch {
      // A refusal is a correct outcome: the source stopped being what the
      // plan proved, and intake does not guess past that.
    }

    const intakeDir = path.join(placed.treeRoot, 'intake');
    if (fs.existsSync(intakeDir)) {
      for (const rel of everyFileUnder(intakeDir)) {
        const body = fs.readFileSync(path.join(intakeDir, ...rel.split('/')), 'utf8');
        assert.equal(body.includes(secretBytes), false, `outside bytes reached intake/${rel}`);
      }
      const carried = path.join(intakeDir, 'vision', 'vision.md');
      if (fs.existsSync(carried)) {
        assert.equal(fs.readFileSync(carried, 'utf8'), realBytes);
      }
    }
    assert.equal(fs.readFileSync(secret, 'utf8'), secretBytes, 'the outside file was written to');

    // Let the peer finish before the next attempt so the attempts do not
    // contend for the machine with each other.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
});

test('S-2b torn-destination-heals: a destination left half-written by a crash is rewritten whole, not appended to', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v3-released');
  // Exactly what a kill mid-copy leaves: the destination exists, shorter
  // than its source. Re-entry re-plans and re-copies, so the heal must be a
  // truncating rewrite — a copy that appended, or that stopped because the
  // path already existed, would publish a corrupt document under a trust
  // flag and no later step would notice, because a short file is a valid one.
  const destDir = path.join(placed.treeRoot, 'intake', 'vision');
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'vision.md'), '# Vis');

  const report = harvestLegacy(placed.treeRoot, placed.archiveAbs);

  const entry = carriedByPath(report, 'docs/vision.md');
  assert.ok(entry, 'the torn destination was not re-copied');
  const carried = path.join(placed.treeRoot, ...entry.dest.split('/'));
  assert.deepEqual(
    fs.readFileSync(carried),
    fs.readFileSync(path.join(placed.archiveAbs, 'docs', 'vision.md')),
    'the healed copy is not byte-identical to the frozen archive'
  );
  assert.equal(fs.statSync(carried).size, entry.bytes);
});

// --- the operator acceptance criterion ---
// Binding, and stated as one sentence: a post-intake tree satisfies EVERY
// pipeline entry requirement. Not "intake finished cleanly" — the tree the
// operator is left standing in must be the same tree a greenfield run would
// have been given, so the door's own next steps run against it unchanged.

test('ACCEPTANCE: a post-intake tree is scaffold-complete — every path a fresh scaffold creates is there, same node type', () => {
  const dir = mkTmpDir();
  const { treeRoot } = harvested(dir, 'legacy-v3-released');

  const freshDir = mkTmpDir();
  const freshProject = path.join(freshDir, 'proj');
  scaffoldTree(freshProject, { routingConfigPath: ROUTING_CONFIG });
  const freshTree = path.join(freshProject, TREE);

  const walk = (root, prefix = '', out = new Map()) => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      out.set(rel, entry.isDirectory() ? 'dir' : 'file');
      if (entry.isDirectory()) walk(path.join(root, entry.name), rel, out);
    }
    return out;
  };

  const fresh = walk(freshTree);
  const post = walk(treeRoot);
  assert.ok(fresh.size > 0, 'the fresh scaffold produced nothing to compare against');
  for (const [rel, kind] of fresh) {
    assert.equal(post.get(rel), kind, `the post-intake tree is missing the scaffolded ${kind} "${rel}"`);
  }
  // The carried material and the frozen archive are the only additions, and
  // both live where the design puts them — never loose in the tree root.
  for (const rel of post.keys()) {
    if (fresh.has(rel)) continue;
    assert.ok(
      rel === 'intake' || rel.startsWith('intake/') || rel === ARCHIVE_DIR || rel.startsWith(`${ARCHIVE_DIR}/`),
      `the post-intake tree gained "${rel}", which is neither scaffolded, carried, nor archived`
    );
  }
});

test('ACCEPTANCE: a post-intake tree is preflight-runnable — preflight commits its own record against it, unchanged', () => {
  const dir = mkTmpDir();
  const { treeRoot } = harvested(dir, 'legacy-v3-released');

  const result = preflightRun(dir, { workflowTool: true, agentTeams: true, codexCmd: 'exit 0' });
  assert.ok(result.mode === 'full-cross-family' || result.mode === 'degraded-claude-only');

  const state = JSON.parse(fs.readFileSync(path.join(treeRoot, 'state.json'), 'utf8'));
  assert.equal(state.preflight.mode, result.mode);
  assert.equal(state.phase, 'onboarding');

  const kinds = ledgerRecords(treeRoot).map((r) => r.kind);
  // Intake's own record stays exactly where it was appended, and everything
  // after it is preflight's own evidence — its `preflight` findings and the
  // real `gate` records runGate writes for the subprocess checks. Nothing
  // else appears: the door's entry evidence is written by the door, against
  // a tree intake only furnished.
  assert.deepEqual(kinds.slice(0, 2), ['genesis', 'intake']);
  assert.ok(kinds.slice(2).includes('preflight'), 'preflight committed no record of its own');
  for (const kind of kinds.slice(2)) {
    assert.ok(kind === 'preflight' || kind === 'gate', `the preflight run appended an unexpected "${kind}" record`);
  }
});
