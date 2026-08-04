'use strict';

// Legacy intake — the TIER-2 GENERIC harvest (design §3.3, §9.2.3, §9.2.4).
//
// Tier 2 is the family the machine cannot type: one v1.x sample, no v2
// sample, and a bespoke parser would be guesswork wearing a schema. So the
// contract it is held to here is deliberately narrow — walk, read, copy
// structure-preserved into `intake/documents/`, classify nothing, drop
// nothing silently — and every test below names the honesty invariant it
// would catch a regression against rather than a shape it happens to produce.
//
// The archive half's tests live in intake.test.js and the typed tier-1
// harvest's in intake-harvest.test.js; every test here re-enters through the
// transaction, because a harvest only ever continues one already at `placed`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { archiveLegacyTree, harvestLegacy } = require('../src/intake.js');
const { detect } = require('../src/detect.js');
const { readAll } = require('../src/jsonl.js');
const { validateIntakeReport } = require('../src/validators.js');

const ROUTING_CONFIG = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');
const FIXTURES = path.join(__dirname, 'fixtures');

const TREE = '.thelastskill';
const MARKER = '.thelastskill-intake';

function mkTmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tier2-test-')));
}

function treeDirOf(dir) {
  return path.join(dir, TREE);
}

// The two hand-built tier-2 fixtures of §9.5: `legacy-v1` is the undokiln1
// shape (STATE.md with `plugin_version`/`step_N_*`, an `archive/step-N-*`
// layout, loose prose) and `legacy-machine-evidence` is a sub-tier-1 tree
// whose point is the denylist. Neither reproduces a byte of any real
// third-party tree; both are written from the shapes verified in §0.
function plantLegacy(dir, fixture) {
  fs.cpSync(path.join(FIXTURES, fixture), treeDirOf(dir), { recursive: true });
  return treeDirOf(dir);
}

function restoreTxn(dir, txn, phase) {
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
    })
  );
}

function toPlaced(dir, fixture) {
  plantLegacy(dir, fixture);
  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  assert.equal(txn.phase, 'placed');
  assert.equal(txn.tier, 2, 'the fixture is not a tier-2 tree');
  return { txn, treeRoot: treeDirOf(dir), archiveAbs: path.join(dir, txn.archive_path) };
}

function harvested(dir, fixture) {
  const placed = toPlaced(dir, fixture);
  return { ...placed, report: harvestLegacy(placed.treeRoot, placed.archiveAbs) };
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

function everyFileUnder(root, prefix = '', out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const abs = path.join(root, entry.name);
    if (entry.isSymbolicLink()) out.push(rel);
    else if (entry.isDirectory()) everyFileUnder(abs, rel, out);
    else out.push(rel);
  }
  return out;
}

function documentsUnder(treeRoot) {
  return everyFileUnder(path.join(treeRoot, 'intake', 'documents')).sort();
}

// --- §3.3's five steps ---

test('tier 2 copies every readable document into intake/documents/, preserving relative structure', () => {
  const dir = mkTmpDir();
  const { treeRoot, archiveAbs, report } = harvested(dir, 'legacy-v1');

  assert.equal(report.tier, 2);
  assert.deepEqual(documentsUnder(treeRoot), [
    'README',
    'archive/step-1-scaffold/notes.md',
    'archive/step-2-plan/plan.md',
    'config.yaml',
    'docs/idea.md',
    'notes.txt',
  ]);
  // Structure-preserved means the nested path itself is the destination —
  // never a flattened basename, which would collide two `notes.md` from
  // different steps and silently keep one.
  const nested = carriedByPath(report, 'archive/step-1-scaffold/notes.md');
  assert.equal(nested.dest, 'intake/documents/archive/step-1-scaffold/notes.md');
  // Byte-for-byte, from the frozen archive.
  for (const entry of report.carried) {
    assert.equal(
      fs.readFileSync(path.join(treeRoot, ...entry.dest.split('/')), 'utf8'),
      fs.readFileSync(path.join(archiveAbs, ...entry.path.split('/')), 'utf8'),
      `${entry.path} did not land byte-identical`
    );
  }
  assert.deepEqual(validateIntakeReport(report), { ok: true, errors: [] });
});

test('tier 2 does no role classification: every generic document is role `document`, inherited-unverified', () => {
  const dir = mkTmpDir();
  const tree = plantLegacy(dir, 'legacy-v1');
  // Names tier 1 types by hand — a vision, a codebase map, a research note.
  // None of them is a recognition marker, so the tree stays tier 2, and in
  // tier 2 the harvester must not guess at their meaning from their names.
  fs.writeFileSync(path.join(tree, 'docs', 'vision.md'), '# The vision\n');
  fs.writeFileSync(path.join(tree, 'docs', 'codebase-map.md'), '# The map\n');
  fs.writeFileSync(path.join(tree, 'docs', 'research-notes.md'), '# Findings\n');
  fs.writeFileSync(path.join(tree, 'decisions.md'), '# ADR-1\n');

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  assert.equal(txn.tier, 2);
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  for (const rel of ['docs/vision.md', 'docs/codebase-map.md', 'docs/research-notes.md', 'decisions.md']) {
    const entry = carriedByPath(report, rel);
    assert.ok(entry, `${rel} was not carried`);
    assert.equal(entry.role, 'document', `${rel} was given a typed role by tier 2`);
    assert.equal(entry.trust_flag, 'inherited-unverified');
    assert.equal(entry.dest, `intake/documents/${rel}`);
  }
  assert.equal(fs.existsSync(path.join(treeDirOf(dir), 'intake', 'vision')), false);
  assert.equal(fs.existsSync(path.join(treeDirOf(dir), 'intake', 'codebase')), false);
});

test('tier 2 records the title it READ — the first markdown heading, or the filename when there is none', () => {
  const dir = mkTmpDir();
  const { report } = harvested(dir, 'legacy-v1');

  assert.equal(carriedByPath(report, 'docs/idea.md').title, 'The idea, as first written');
  assert.equal(carriedByPath(report, 'README').title, 'Read me first');
  // No heading to read: the filename, which is a fact, rather than a title
  // inferred from the first line of prose, which would be a guess.
  assert.equal(carriedByPath(report, 'notes.txt').title, 'notes.txt');
  assert.equal(carriedByPath(report, 'config.yaml').title, 'config.yaml');
  // §3.3's per-document record is {path, bytes, mtime, title} — all four.
  const entry = carriedByPath(report, 'docs/idea.md');
  assert.equal(typeof entry.bytes, 'number');
  assert.match(entry.mtime, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test('tier 2 lists binaries, lockfiles, oversized files, and non-files in ignored[] — never a silent drop', () => {
  const dir = mkTmpDir();
  const tree = plantLegacy(dir, 'legacy-v1');
  fs.writeFileSync(path.join(tree, 'huge.md'), `# Big\n${'x'.repeat(1024 * 1024)}`);
  fs.writeFileSync(path.join(tree, 'deps.lock'), 'a@1.0.0\n');
  fs.writeFileSync(path.join(tree, 'mixed.json'), Buffer.from([0x7b, 0x00, 0x7d]));
  fs.mkdirSync(path.join(tree, 'empty-dir'));

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  assert.match(ignoredReason(report, 'assets/logo.png'), /not a document extension/);
  assert.match(ignoredReason(report, 'huge.md'), /ceiling/);
  assert.match(ignoredReason(report, 'deps.lock'), /lockfile/);
  assert.match(ignoredReason(report, 'mixed.json'), /binary/);
  assert.equal(ignoredReason(report, 'run.lock'), 'transient');
  for (const rel of ['assets/logo.png', 'huge.md', 'deps.lock', 'mixed.json', 'run.lock']) {
    assert.equal(carriedByPath(report, rel), null, `${rel} was carried as a document`);
  }
  assert.equal(documentsUnder(treeDirOf(dir)).includes('assets/logo.png'), false);
});

test('every file in a tier-2 archive is accounted for exactly once across carried, noted, ignored, and unreadable', () => {
  for (const fixture of ['legacy-v1', 'legacy-machine-evidence']) {
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

test('S-3 tier2-run-claim-noted: what the old RUN claimed it delivered is reported, never carried as prose', () => {
  const dir = mkTmpDir();
  plantLegacy(dir, 'legacy-v1');
  const treeRoot = treeDirOf(dir);
  // Prose about the machine's own verdict rather than about human intent —
  // tier 1 notes these by name, and tier 2 did not, so an old run's own
  // `report.md` came through `intake/documents/` as a generic document
  // indistinguishable from the operator's writing. Keyed at every depth,
  // like tier 2's other denylists: a tier-2 tree has no layout the machine
  // knows, so a nested run claim is exactly as much a run claim.
  const claims = [
    'report.md',
    'validate.md',
    'validate-report.md',
    'narration.md',
    'build-notes.md',
    'runs/old/report.md',
  ];
  for (const rel of claims) {
    const full = path.join(treeRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '# the old run said it delivered everything\n');
  }

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeRoot, path.join(dir, txn.archive_path));

  for (const rel of claims) {
    assert.equal(carriedByPath(report, rel), null, `${rel} was carried as prose`);
    assert.equal(notedReason(report, rel), 'run-claim', `${rel} is not noted as a run claim`);
  }
  // A filter, not a refusal to harvest: the operator's own prose still comes
  // through the same run.
  assert.ok(carriedByPath(report, 'docs/idea.md'), 'genuine prose stopped being carried');
});

// --- F-35: the MACHINE_EVIDENCE denylist, which is what makes §3.1 true in tier 2 ---

test('F-35 tier2-machine-evidence-denylisted: no machine evidence reaches intake/documents/, at any depth', () => {
  const dir = mkTmpDir();
  const { treeRoot, report } = harvested(dir, 'legacy-machine-evidence');

  // The fixture nests `state.json`, `seals.jsonl`, and `posture.json` under
  // `runs/old/` deliberately: a root `state.json` would make detect classify
  // the tree `broken-install` and it would never reach intake at all, and a
  // root `seals.*` plus `posture.json` beside `law/` would clear the tier-1
  // bar. Nesting them proves the stronger rule anyway — the denylist is
  // keyed on the basename at EVERY depth, not on a depth-1 table.
  const denied = [
    'STATE.md',
    'audits.log',
    'audits.jsonl',
    'reviews.jsonl',
    'law/lock.hash',
    'law/check.sh',
    'evidence/gen-1/probe.txt',
    'runs/old/state.json',
    'runs/old/seals.jsonl',
    'runs/old/posture.json',
  ];
  const documents = documentsUnder(treeRoot);
  for (const rel of denied) {
    assert.equal(carriedByPath(report, rel), null, `${rel} was carried as a generic document`);
    assert.equal(notedReason(report, rel), 'machine-evidence', `${rel} is not noted as machine evidence`);
    assert.equal(documents.includes(rel), false, `${rel} reached intake/documents/`);
  }
  // §9.2.4's denylisted DIRECTORIES bind the same way as its basenames: at
  // any depth. A tier-2 tree has no layout the machine knows, so `law/` and
  // `evidence/` nested under a run directory are exactly as much machine
  // evidence as top-level ones — and a `.md` inside them would otherwise be
  // carried as prose, which is the §3.1 hole the denylist exists to close.
  assert.equal(notedReason(report, 'runs/old/evidence/gen-2/probe.md'), 'machine-evidence');
  assert.equal(notedReason(report, 'runs/old/law/notes.md'), 'machine-evidence');
  assert.equal(ignoredReason(report, 'runs/old/.wide/scratch.md'), 'transient');
  for (const rel of ['runs/old/evidence/gen-2/probe.md', 'runs/old/law/notes.md', 'runs/old/.wide/scratch.md']) {
    assert.equal(carriedByPath(report, rel), null, `${rel} was carried as prose`);
    assert.equal(documents.includes(rel), false, `${rel} reached intake/documents/`);
  }
  // The prose in the same tree still comes through — the denylist is a filter,
  // not a refusal to harvest.
  assert.ok(carriedByPath(report, 'notes.md'));
  assert.ok(carriedByPath(report, 'docs/plan.md'));
  assert.ok(carriedByPath(report, 'handbook'));
  // No version-specific parsing in tier 2 (§3.3): machine evidence is named
  // and located, never counted or interpreted.
  assert.equal(report.noted.seals, null);
  assert.equal(report.noted.audits, null);
  assert.equal(report.noted.reviews, null);
  assert.equal(report.noted.evidence, null);
  assert.deepEqual(report.noted.verbatim, []);
  assert.deepEqual(validateIntakeReport(report), { ok: true, errors: [] });
});

test('the tier-2 report.md never renders a seal or audit count as "(none)" for an archive that holds both', () => {
  const dir = mkTmpDir();
  const { treeRoot, report } = harvested(dir, 'legacy-machine-evidence');
  const rendered = fs.readFileSync(path.join(treeRoot, 'intake', 'report.md'), 'utf8');

  // The archive DOES hold seals, audits, and reviews. Tier 2 does not read
  // their grammar, so the report has no count to state — and a rendered
  // "seals: (none)" would be read as "this archive holds no seals", which is
  // the opposite of what was found.
  assert.ok(report.noted.entries.some((e) => e.path === 'audits.log'));
  assert.equal(rendered.includes('(none)'), false, 'a tier-2 report rendered an absence it never established');
  assert.match(rendered, /machine evidence/i);
  assert.match(rendered, /never counted|not counted|never interpreted/i);
  // Presence is the only claim the seal line can carry in a family whose
  // grammar the harvester does not know.
  assert.match(rendered, /law seal state, by presence/i);
});

test('F-36 tier2-sealed-brainstorm-still-carried: the operator\u2019s own words survive the denylist; an unsealed ledger does not', () => {
  const sealed =
    '{"seq":1,"e":"idea","by":"operator","text":"a searchable index of my notes"}\n' +
    '{"seq":2,"e":"session_complete","entries":1}\n';
  const unsealed = '{"seq":1,"e":"idea","by":"operator","text":"half a thought"}\n';

  for (const [text, expectCarried] of [[sealed, true], [unsealed, false]]) {
    const dir = mkTmpDir();
    const tree = plantLegacy(dir, 'legacy-v1');
    fs.writeFileSync(path.join(tree, 'brainstorm-ledger.jsonl'), text);
    const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
    assert.equal(txn.tier, 2);
    const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

    const entry = carriedByPath(report, 'brainstorm-ledger.jsonl');
    if (expectCarried) {
      assert.ok(entry, 'a sealed brainstorm ledger was denied by the tier-2 denylist');
      assert.equal(entry.role, 'vision');
      assert.equal(entry.dest, 'intake/vision/brainstorm-ledger.jsonl');
      assert.equal(fs.readFileSync(path.join(tree, 'intake', 'vision', 'brainstorm-ledger.jsonl'), 'utf8'), text);
    } else {
      assert.equal(entry, null, 'an unsealed ledger was carried');
      assert.equal(notedReason(report, 'brainstorm-ledger.jsonl'), 'unsealed-brainstorm-ledger');
      assert.equal(documentsUnder(tree).includes('brainstorm-ledger.jsonl'), false);
    }
  }
});

// --- §9.2.3 no-follow, in the tier the design extended it to ---

test('F-34 tier2-dir-symlink-not-traversed: a symlinked directory yields no document from outside', () => {
  const dir = mkTmpDir();
  const outside = mkTmpDir();
  fs.writeFileSync(path.join(outside, 'secret.md'), '# Not ours\n');
  const tree = plantLegacy(dir, 'legacy-v1');
  fs.mkdirSync(path.join(tree, 'sub'));
  fs.symlinkSync(outside, path.join(tree, 'sub', 'link'));

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  assert.equal(notedReason(report, 'sub/link'), 'symlink');
  assert.equal(report.noted.entries.find((e) => e.path === 'sub/link').link_target, outside);
  assert.equal(carriedByPath(report, 'sub/link'), null);
  assert.equal(documentsUnder(treeDirOf(dir)).some((rel) => rel.includes('secret.md')), false);
  assert.equal(report.carried.some((e) => e.path.includes('secret')), false);
});

test('a tier-2 file symlink is noted with its raw target and never read, copied, or resolved', () => {
  const dir = mkTmpDir();
  const tree = plantLegacy(dir, 'legacy-v1');
  fs.symlinkSync('../STATE.md', path.join(tree, 'docs', 'summary.md'));
  fs.symlinkSync('/etc/hostname', path.join(tree, 'host.txt'));

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  assert.equal(notedReason(report, 'docs/summary.md'), 'symlink');
  assert.equal(notedReason(report, 'host.txt'), 'symlink');
  assert.equal(report.noted.entries.find((e) => e.path === 'host.txt').link_target, '/etc/hostname');
  assert.equal(carriedByPath(report, 'docs/summary.md'), null);
  const documents = documentsUnder(treeDirOf(dir));
  assert.equal(documents.includes('docs/summary.md'), false);
  assert.equal(documents.includes('host.txt'), false);
});

// --- containment on tier 2's own new surface: destination directories at depth ---

test('a symlinked intake/documents/<dir> at depth refuses the whole tier-2 harvest and writes nothing', () => {
  const dir = mkTmpDir();
  const outside = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-v1');
  // Tier 1 only ever creates depth-1 destination directories; tier 2 creates
  // them at the archive's own depth, which is the new surface. Plant the
  // escape two levels down, where only the deepest-existing-prefix resolution
  // of validateContainedTarget can catch it.
  fs.mkdirSync(path.join(placed.treeRoot, 'intake', 'documents', 'archive'), { recursive: true });
  fs.symlinkSync(outside, path.join(placed.treeRoot, 'intake', 'documents', 'archive', 'step-1-scaffold'));

  assert.throws(() => harvestLegacy(placed.treeRoot, placed.archiveAbs), /symlink|outside/i);
  assert.deepEqual(everyFileUnder(outside), [], 'the refused harvest wrote outside the tree');
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake', 'report.json')), false);
  assert.equal(fs.existsSync(path.join(placed.treeRoot, 'intake', 'documents', 'docs')), false);
  assert.equal(
    readAll(path.join(placed.treeRoot, 'ledger.jsonl')).records.filter((r) => r.kind === 'intake').length,
    0
  );
});

// --- tolerance and the empty case ---

test('an unreadable tier-2 document lands in unreadable[] and the pass still commits', () => {
  if (process.getuid && process.getuid() === 0) return; // root reads anything
  const dir = mkTmpDir();
  const tree = plantLegacy(dir, 'legacy-v1');
  fs.chmodSync(path.join(tree, 'docs', 'idea.md'), 0o000);

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  const entry = report.unreadable.find((e) => e.path === 'docs/idea.md');
  assert.ok(entry, 'the unreadable document was not recorded');
  assert.match(entry.reason, /EACCES/);
  assert.equal(carriedByPath(report, 'docs/idea.md'), null);
  // One bad file does not sink the pass.
  assert.ok(carriedByPath(report, 'notes.txt'));
  assert.ok(fs.existsSync(path.join(treeDirOf(dir), 'intake', 'report.json')));
  assert.deepEqual(validateIntakeReport(report), { ok: true, errors: [] });
});

test('a tier-2 tree with no readable document harvests to a valid report with an empty carried[]', () => {
  const dir = mkTmpDir();
  const tree = treeDirOf(dir);
  fs.mkdirSync(tree, { recursive: true });
  fs.writeFileSync(path.join(tree, 'run.lock'), 'held\n');
  fs.writeFileSync(path.join(tree, 'blob.dat'), Buffer.from([0x00, 0x01, 0x02]));

  const seen = detect(dir);
  assert.equal(seen.mode, 'legacy');
  assert.equal(seen.evidence.legacy_tier, 2);

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  assert.deepEqual(report.carried, []);
  assert.equal(report.noted.law_sealed, 'unsealed');
  assert.deepEqual(validateIntakeReport(report), { ok: true, errors: [] });
  assert.ok(fs.existsSync(path.join(treeDirOf(dir), 'intake', 'report.json')));
  assert.equal(fs.existsSync(path.join(treeDirOf(dir), 'intake', 'documents')), false);
  const rendered = fs.readFileSync(path.join(treeDirOf(dir), 'intake', 'report.md'), 'utf8');
  assert.ok(rendered.includes('Nothing in it could be carried forward honestly.'));
});

test('a pathological archive truncates HONESTLY: the report says so rather than returning a silent subset', () => {
  const dir = mkTmpDir();
  const tree = plantLegacy(dir, 'legacy-v1');
  // Past the walk's entry ceiling. The extras are binaries so the test costs
  // a walk and not five thousand copies; what is under test is the walk's
  // own bound, which is a bug tripwire on a pathological tree rather than a
  // policy — and the one thing it must never do is report a subset as if it
  // were the whole archive.
  fs.mkdirSync(path.join(tree, 'bulk'));
  for (let i = 0; i < 5200; i += 1) {
    fs.writeFileSync(path.join(tree, 'bulk', `f${i}.png`), 'x');
  }

  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const report = harvestLegacy(treeDirOf(dir), path.join(dir, txn.archive_path));

  assert.equal(report.truncated, true, 'the walk stopped early and the report did not say so');
  assert.deepEqual(validateIntakeReport(report), { ok: true, errors: [] });
  assert.ok(fs.existsSync(path.join(treeDirOf(dir), 'intake', 'report.json')));
  const rendered = fs.readFileSync(path.join(treeDirOf(dir), 'intake', 'report.md'), 'utf8');
  assert.match(rendered, /truncat/i, 'the rendered report does not say the walk was truncated');
});

// --- idempotence and the anti-fabrication invariants, in tier 2 ---

test('re-harvesting a frozen tier-2 archive is idempotent: identical documents, identical report', () => {
  const dir = mkTmpDir();
  const placed = toPlaced(dir, 'legacy-machine-evidence');
  const intakeDir = path.join(placed.treeRoot, 'intake');
  const bytes = () =>
    everyFileUnder(intakeDir)
      .sort()
      .map((rel) => [rel, fs.readFileSync(path.join(intakeDir, ...rel.split('/')), 'utf8')]);

  const first = harvestLegacy(placed.treeRoot, placed.archiveAbs);
  const firstBytes = bytes();

  restoreTxn(dir, placed.txn, 'placed');
  const second = harvestLegacy(placed.treeRoot, placed.archiveAbs);

  const stripReport = (list) => list.filter(([rel]) => rel !== 'report.json' && rel !== 'report.md');
  assert.deepEqual(stripReport(bytes()), stripReport(firstBytes));
  assert.deepEqual({ ...second, harvested_utc: null }, { ...first, harvested_utc: null });
  assert.equal(
    readAll(path.join(placed.treeRoot, 'ledger.jsonl')).records.filter((r) => r.kind === 'intake').length,
    1,
    'the re-entered tier-2 harvest appended a second intake record'
  );
});

test('the tier-2 harvest fabricates no earned state: onboarding phase intact, one intake record, no gate', () => {
  const dir = mkTmpDir();
  const { treeRoot } = harvested(dir, 'legacy-v1');

  const state = JSON.parse(fs.readFileSync(path.join(treeRoot, 'state.json'), 'utf8'));
  assert.equal(state.phase, 'onboarding');
  const records = readAll(path.join(treeRoot, 'ledger.jsonl')).records;
  const intakeRecords = records.filter((r) => r.kind === 'intake');
  assert.equal(intakeRecords.length, 1);
  assert.equal(intakeRecords[0].tier, 2);
  for (const kind of ['gate', 'chunk-green', 'phase-transition', 'seal', 'verification']) {
    assert.equal(records.some((r) => r.kind === kind), false, `the tier-2 harvest wrote a ${kind} record`);
  }
  // Carried material lands under intake/ only — never in the directories the
  // pipeline earns for itself.
  for (const earned of ['milestones', 'verification', 'architecture', 'law']) {
    const at = path.join(treeRoot, earned);
    if (!fs.existsSync(at)) continue;
    assert.deepEqual(everyFileUnder(at), [], `the tier-2 harvest wrote into ${earned}/`);
  }
});

test('the tier-2 report.md names each document by title and destination, and the archive is untouched', () => {
  const dir = mkTmpDir();
  const { treeRoot, archiveAbs, report } = harvested(dir, 'legacy-v1');
  const rendered = fs.readFileSync(path.join(treeRoot, 'intake', 'report.md'), 'utf8');

  assert.ok(rendered.includes('tier: 2'));
  for (const entry of report.carried) {
    assert.ok(rendered.includes(entry.dest), `${entry.dest} is missing from the rendered report`);
    assert.ok(rendered.includes(entry.title), `the title of ${entry.path} is missing from the rendered report`);
  }
  // §2.5: nothing in a legacy tree is ever deleted or rewritten.
  assert.deepEqual(everyFileUnder(archiveAbs).sort(), everyFileUnder(path.join(FIXTURES, 'legacy-v1')).sort());
});
