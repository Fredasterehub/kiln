'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { scaffoldTree, scaffoldArchitecture } = require('../src/scaffold.js');
const { CANONICAL_ARCHITECTURE_ARTIFACTS } = require('../src/manifest.js');
const { writeValidContentArtifacts } = require('./fixtures/valid-architecture-artifacts.js');

const ROUTING_CONFIG = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-test-'));
}

const EXPECTED_DIRS = [
  '.',
  'vision',
  'research',
  'architecture',
  'milestones',
  'verification',
  path.join('verification', 'runs'),
  'envelopes',
  'delivery',
  'usage',
  'archive',
  'routing',
];

const EXPECTED_FILES = [
  'state.json',
  'settings.json',
  'handoff.md',
  'ledger.jsonl',
  'last-mile.jsonl',
  path.join('vision', 'transcript.jsonl'),
  path.join('vision', 'decisions.jsonl'),
  path.join('research', 'scratchpad.jsonl'),
  path.join('routing', 'routing-2026-07-27-4.json'),
  path.join('routing', 'active.json'),
];

// --- full tree created ---

test('scaffoldTree creates every directory and genesis file in the greenfield tree', () => {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  const root = path.join(tmp, '.thelastskill');

  for (const dir of EXPECTED_DIRS) {
    const abs = path.join(root, dir);
    assert.equal(fs.existsSync(abs), true, `expected dir ${dir} to exist`);
    assert.equal(fs.statSync(abs).isDirectory(), true, `expected ${dir} to be a directory`);
  }
  for (const file of EXPECTED_FILES) {
    const abs = path.join(root, file);
    assert.equal(fs.existsSync(abs), true, `expected file ${file} to exist`);
    assert.equal(fs.statSync(abs).isFile(), true, `expected ${file} to be a file`);
  }
});

test('scaffoldTree does NOT write a root-level artifact-map.json (that artifact lives only under architecture/, per §3)', () => {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  const root = path.join(tmp, '.thelastskill');
  assert.equal(fs.existsSync(path.join(root, 'artifact-map.json')), false);
});

test('scaffoldTree returns {created} listing every path it touched', () => {
  const tmp = makeTmpDir();
  const { created } = scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  const root = path.join(tmp, '.thelastskill');
  const expectedCount = EXPECTED_DIRS.length + EXPECTED_FILES.length;
  assert.equal(created.length, expectedCount);
  for (const p of created) {
    assert.equal(path.isAbsolute(p), true);
    assert.equal(fs.existsSync(p), true);
    assert.equal(p.startsWith(root), true);
  }
});

// --- genesis files parse + header-valid ---

// The genesis state file, and the two fields it deliberately does NOT carry.
// `current_milestone` and `current_chunk` were written here at scaffold time and
// by nothing else, ever: across a whole implementation phase of the first live
// fire — eleven productive invocations, a milestone opened, chunks sealed — both
// stayed at their genesis `null`, because position is derived from
// `milestones/index.json` and the chunk records and no writer was ever owed
// them. A key that no operation advances is not a resume pointer; it is a
// second, permanently stale answer to a question the tree already answers, and
// the honest form of "dead" is absent rather than null.
test('state.json genesis carries schema_version, created_ts and the phase fields, and carries no milestone/chunk pointer keys', () => {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  const state = JSON.parse(
    fs.readFileSync(path.join(tmp, '.thelastskill', 'state.json'), 'utf8')
  );
  assert.equal(state.schema_version, 1);
  assert.equal(typeof state.created_ts, 'string');
  assert.equal(state.phase, 'onboarding');
  assert.deepEqual(state.phase_status, {});
  assert.equal(typeof state.next_action, 'string');
  assert.equal(typeof state.updated_utc, 'string');
  assert.equal('gates' in state, false);
  assert.equal('checklist' in state, false);
  // `in`, not a null check: a genesis writing `null` passes any comparison
  // against the value and is exactly what this deletes.
  assert.equal('current_milestone' in state, false);
  assert.equal('current_chunk' in state, false);
});

test('settings.json genesis is an empty object (no model judgment at scaffold time)', () => {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  const settings = JSON.parse(fs.readFileSync(path.join(tmp, '.thelastskill', 'settings.json'), 'utf8'));
  assert.deepEqual(settings, {});
});

test('handoff.md genesis is nonempty prose', () => {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  const handoff = fs.readFileSync(path.join(tmp, '.thelastskill', 'handoff.md'), 'utf8');
  assert.ok(handoff.length > 0);
  assert.match(handoff, /^# /);
});

for (const [label, relFile] of [
  ['ledger.jsonl', 'ledger.jsonl'],
  ['last-mile.jsonl', 'last-mile.jsonl'],
  ['vision/transcript.jsonl', path.join('vision', 'transcript.jsonl')],
  ['vision/decisions.jsonl', path.join('vision', 'decisions.jsonl')],
  ['research/scratchpad.jsonl', path.join('research', 'scratchpad.jsonl')],
]) {
  test(`${label} genesis record carries the common JSONL header and seq 0`, () => {
    const tmp = makeTmpDir();
    scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
    const raw = fs.readFileSync(path.join(tmp, '.thelastskill', relFile), 'utf8').trim();
    const lines = raw.split('\n');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.schema_version, 1);
    assert.equal(record.seq, 0);
    assert.equal(typeof record.kind, 'string');
    assert.equal(typeof record.ts, 'string');
    assert.equal(record.correlation_id, null);
  });
}

test('routing/active.json points at the copied dated config with a matching sha256 digest', () => {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  const root = path.join(tmp, '.thelastskill');
  const active = JSON.parse(fs.readFileSync(path.join(root, 'routing', 'active.json'), 'utf8'));
  assert.equal(active.active_config, 'routing-2026-07-27-4.json');
  assert.match(active.digest, /^sha256:[0-9a-f]{64}$/);

  const copied = fs.readFileSync(path.join(root, 'routing', 'routing-2026-07-27-4.json'));
  const expectedDigest = `sha256:${crypto.createHash('sha256').update(copied).digest('hex')}`;
  assert.equal(active.digest, expectedDigest);

  const source = JSON.parse(fs.readFileSync(ROUTING_CONFIG, 'utf8'));
  const copiedObj = JSON.parse(copied.toString('utf8'));
  assert.deepEqual(copiedObj, source);
});

// --- idempotency refusal ---

test('scaffoldTree throws if .thelastskill already exists and opts.force is not set', () => {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  assert.throws(
    () => scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG }),
    /already exists/
  );
});

test('scaffoldTree does not partially mutate an existing tree on refusal', () => {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  const before = fs.readFileSync(
    path.join(tmp, '.thelastskill', 'state.json'),
    'utf8'
  );
  assert.throws(() => scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG }));
  const after = fs.readFileSync(path.join(tmp, '.thelastskill', 'state.json'), 'utf8');
  assert.equal(before, after);
});

// --- force mode ---

test('scaffoldTree with opts.force rebuilds a fresh tree over an existing one', () => {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  const statePath = path.join(tmp, '.thelastskill', 'state.json');
  fs.writeFileSync(
    path.join(tmp, '.thelastskill', 'graffiti.txt'),
    'stale leftover from a previous run'
  );
  const result = scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG, force: true });
  assert.equal(fs.existsSync(statePath), true);
  assert.equal(
    fs.existsSync(path.join(tmp, '.thelastskill', 'graffiti.txt')),
    false,
    'force mode should rebuild fresh, not merge with stale leftovers'
  );
  assert.ok(result.created.length > 0);
});

// --- required opts ---

test('scaffoldTree throws without opts.routingConfigPath', () => {
  const tmp = makeTmpDir();
  assert.throws(() => scaffoldTree(tmp, {}), /routingConfigPath/);
});

test('scaffoldTree throws if routingConfigPath is not named routing-YYYY-MM-DD-N.json', () => {
  const tmp = makeTmpDir();
  const badPath = path.join(tmp, 'routing.json');
  fs.writeFileSync(badPath, JSON.stringify({ schema_version: 1 }));
  assert.throws(() => scaffoldTree(tmp, { routingConfigPath: badPath }), /routing-YYYY-MM-DD-N\.json/);
});

// --- CLI ---

test('CLI: node scaffold.js <targetRoot> --routing <path> materializes the tree and exits 0', () => {
  const { spawnSync } = require('node:child_process');
  const tmp = makeTmpDir();
  const scriptPath = path.join(__dirname, '..', 'src', 'scaffold.js');
  const result = spawnSync(process.execPath, [scriptPath, tmp, '--routing', ROUTING_CONFIG], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(tmp, '.thelastskill', 'state.json')), true);
});

test('CLI: missing --routing exits nonzero with a usage message', () => {
  const { spawnSync } = require('node:child_process');
  const tmp = makeTmpDir();
  const scriptPath = path.join(__dirname, '..', 'src', 'scaffold.js');
  const result = spawnSync(process.execPath, [scriptPath, tmp], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage/);
});

// --- scaffoldArchitecture: phase-4 sealing operation ---

function architectureDirFor(tmp) {
  const dir = path.join(tmp, 'architecture');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('scaffoldArchitecture throws when a required content artifact is missing', () => {
  const tmp = makeTmpDir();
  const architectureDir = architectureDirFor(tmp);
  assert.throws(() => scaffoldArchitecture(architectureDir), /plan\.md/);
});

test('scaffoldArchitecture seals the five content artifacts into manifest.json + gate.json, completing the seven-file §3 shape', () => {
  const tmp = makeTmpDir();
  const architectureDir = architectureDirFor(tmp);
  writeValidContentArtifacts(architectureDir);

  const { manifest, manifestPath, gatePath } = scaffoldArchitecture(architectureDir);

  assert.equal(fs.existsSync(manifestPath), true);
  assert.equal(fs.existsSync(gatePath), true);
  for (const relFile of CANONICAL_ARCHITECTURE_ARTIFACTS) {
    assert.equal(fs.existsSync(path.join(architectureDir, relFile)), true);
  }

  assert.deepEqual(
    manifest.artifacts.map((a) => a.path).sort(),
    [...CANONICAL_ARCHITECTURE_ARTIFACTS].sort()
  );

  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.equal(gate.schema_version, 1);
  assert.equal(gate.decision, 'approved');
  assert.equal(gate.decision_source, 'operator');
  assert.match(gate.manifest_digest, /^sha256:[0-9a-f]{64}$/);

  const actualManifestDigest = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex')}`;
  assert.equal(gate.manifest_digest, actualManifestDigest);
});

test('scaffoldArchitecture honors an explicit decision/decisionSource', () => {
  const tmp = makeTmpDir();
  const architectureDir = architectureDirFor(tmp);
  writeValidContentArtifacts(architectureDir);

  const { gatePath } = scaffoldArchitecture(architectureDir, { decision: 'auto-approved', decisionSource: 'configured-policy' });
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.equal(gate.decision, 'auto-approved');
  assert.equal(gate.decision_source, 'configured-policy');
});
