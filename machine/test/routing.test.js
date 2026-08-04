'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { loadSettings } = require('../src/settings.js');
const { loadRouting, setActive, validateRoutingConfig, ACTIVE_FILENAME } = require('../src/routing.js');

const ROUTING_DIR = path.join(__dirname, '..', 'routing');
// A basename for the temp-directory fixtures below, which write their own
// config bytes and never touch ROUTING_DIR — it only has to satisfy the
// routing-YYYY-MM-DD-N.json pattern, not name a committed file.
const FIXTURE_CONFIG_NAME = 'routing-2026-07-27-1.json';
// The currently-active dated config (machine/routing/active.json's pointer
// target) — revision 2 added the degraded_seats section (P3 BLOCKER-2 fix);
// revision 3 added the scout_agent/delivery_presenter seats (P9 Sol review
// disclosed-gap judgment 1); revision 4 added the onboarding_runner seat
// (P10 dogfood F2: onboarding's preflight had no roster seat — closed by
// agents/onboarding-runner.md and product/onboarding/flow.md); revision 5
// removes the maestro seat (the realignment: the session that orchestrates
// is Kiln itself, opened at any model and effort — not a routed seat).
// The superseded revision-4 file stays on disk beside it: a dated config is
// immutable once written (rollback is a repoint, and the exact table any
// past run used stays readable), and several suites feed it as their own
// scaffold fixture input.
const ACTIVE_CONFIG_NAME = 'routing-2026-07-31-5.json';
const ACTIVE_CONFIG_PATH = path.join(ROUTING_DIR, ACTIVE_CONFIG_NAME);

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'routing-test-'));
}

function sha256(buf) {
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

function writeDatedConfig(dir, name, overrides = {}) {
  const config = { schema_version: 1, revision: 1, seats: {}, bans: {}, ...overrides };
  fs.writeFileSync(path.join(dir, name), JSON.stringify(config));
  return config;
}

test('the committed dated routing config loads via loadSettings with an empty schema, preserving all keys', () => {
  const onDisk = JSON.parse(fs.readFileSync(ACTIVE_CONFIG_PATH, 'utf8'));
  const result = loadSettings(ACTIVE_CONFIG_PATH, {});
  assert.equal(result.source, 'file');
  assert.deepEqual(result.clamps, []);
  assert.deepEqual(result.settings, onDisk);
  assert.equal(result.settings.schema_version, 1);
  assert.equal(result.settings.calibrated, '2026-07-31');
  assert.equal(result.settings.seats.research_chief.model, 'opus-5');
  assert.equal(result.settings.seats.maestro, undefined);
  assert.equal(result.settings.bans.haiku, 'never');
});

test('the committed routing/active.json points at the committed dated config with a matching digest', () => {
  const pointer = JSON.parse(fs.readFileSync(path.join(ROUTING_DIR, 'active.json'), 'utf8'));
  assert.equal(pointer.schema_version, 1);
  assert.equal(pointer.active_config, ACTIVE_CONFIG_NAME);
  assert.ok(fs.existsSync(path.join(ROUTING_DIR, pointer.active_config)));
  const expectedDigest = sha256(fs.readFileSync(ACTIVE_CONFIG_PATH));
  assert.equal(pointer.digest, expectedDigest);
});

test('loadRouting reads the active pointer and returns the pointed-to dated config plus its filename', () => {
  const { config, activeFile } = loadRouting(ROUTING_DIR);
  assert.equal(activeFile, ACTIVE_CONFIG_NAME);
  assert.equal(config.schema_version, 1);
  assert.equal(config.seats.research_chief.model, 'opus-5');
  assert.equal(config.seats.maestro, undefined);
});

// --- scout_agent / delivery_presenter: P9 Sol review disclosed-gap judgment 1 ---

test('the active dated config carries scout_agent and delivery_presenter seats mirroring each agent file\'s own frontmatter model/effort', () => {
  const { config } = loadRouting(ROUTING_DIR);
  assert.deepEqual(config.seats.scout_agent, { model: 'sonnet-5', effort: 'high' });
  assert.deepEqual(config.seats.delivery_presenter, { model: 'opus-5', effort: 'high' });
});

// --- onboarding_runner: P10 dogfood F2, closed by product/agents/onboarding-runner.md ---

test('the active dated config carries an onboarding_runner seat mirroring product/agents/onboarding-runner.md\'s own frontmatter model/effort', () => {
  const { config } = loadRouting(ROUTING_DIR);
  assert.deepEqual(config.seats.onboarding_runner, { model: 'sonnet-5', effort: 'medium' });
});

// --- degraded_seats: the active config's no-parking substitution table ---

test('the active dated config carries a degraded_seats table with a same-family substitute for every Sol-only seat', () => {
  const { config } = loadRouting(ROUTING_DIR);
  assert.ok(config.degraded_seats, 'active config must carry degraded_seats');
  assert.equal(config.degraded_seats.implementer.model, 'opus-5');
  assert.equal(config.degraded_seats.coverage_check.model, 'sonnet-5');
  assert.equal(config.degraded_seats.chunk_review_of_claude_work['opus-5_authored'].model, 'sonnet-5');
  assert.equal(config.degraded_seats.chunk_review_of_claude_work['sonnet-5_authored'].model, 'opus-5');
  assert.deepEqual(config.degraded_seats.agreement_pass.models, ['fable-5', 'opus-5']);
});

test('degraded_seats never assigns Fable as an implementer (the fable_as_implementer ban still holds in degraded mode)', () => {
  const { config } = loadRouting(ROUTING_DIR);
  assert.notEqual(config.degraded_seats.implementer.model, 'fable-5');
});

test('loadRouting throws when the routing directory has no active.json pointer at all', () => {
  const dir = mkTmpDir();
  assert.throws(() => loadRouting(dir), /active pointer/);
});

test('loadRouting throws when active.json has a wrong schema_version', () => {
  const dir = mkTmpDir();
  writeDatedConfig(dir, FIXTURE_CONFIG_NAME);
  fs.writeFileSync(
    path.join(dir, ACTIVE_FILENAME),
    JSON.stringify({ schema_version: 2, active_config: FIXTURE_CONFIG_NAME, digest: sha256(fs.readFileSync(path.join(dir, FIXTURE_CONFIG_NAME))) })
  );
  assert.throws(() => loadRouting(dir), /schema_version/);
});

test('loadRouting throws when active.json points at a dated config that does not exist', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(
    path.join(dir, ACTIVE_FILENAME),
    JSON.stringify({ schema_version: 1, active_config: 'routing-2026-07-27-9.json', digest: `sha256:${'0'.repeat(64)}` })
  );
  assert.throws(() => loadRouting(dir), /routing-2026-07-27-9\.json/);
});

test('loadRouting throws when active.json is missing a non-empty "active_config" filename', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, ACTIVE_FILENAME), JSON.stringify({ schema_version: 1 }));
  assert.throws(() => loadRouting(dir), /"active_config"/);
});

test('loadRouting throws when active_config is not a valid routing-YYYY-MM-DD-N.json basename', () => {
  const dir = mkTmpDir();
  writeDatedConfig(dir, 'routing.json');
  fs.writeFileSync(
    path.join(dir, ACTIVE_FILENAME),
    JSON.stringify({ schema_version: 1, active_config: 'routing.json', digest: `sha256:${'0'.repeat(64)}` })
  );
  assert.throws(() => loadRouting(dir), /not a valid routing-YYYY-MM-DD-N\.json basename/);
});

test('loadRouting throws when active_config attempts path traversal (rejected by the strict basename pattern)', () => {
  const dir = mkTmpDir();
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub, { recursive: true });
  writeDatedConfig(dir, 'routing-2026-07-27-1.json');
  fs.writeFileSync(
    path.join(sub, ACTIVE_FILENAME),
    JSON.stringify({ schema_version: 1, active_config: '../routing-2026-07-27-1.json', digest: `sha256:${'0'.repeat(64)}` })
  );
  assert.throws(() => loadRouting(sub), /not a valid routing-YYYY-MM-DD-N\.json basename/);
});

test('loadRouting throws when the pointer has no valid digest', () => {
  const dir = mkTmpDir();
  writeDatedConfig(dir, FIXTURE_CONFIG_NAME);
  fs.writeFileSync(path.join(dir, ACTIVE_FILENAME), JSON.stringify({ schema_version: 1, active_config: FIXTURE_CONFIG_NAME }));
  assert.throws(() => loadRouting(dir), /valid "sha256:<hex>" digest/);
});

test('loadRouting throws on a digest mismatch between the pointer and the dated config on disk', () => {
  const dir = mkTmpDir();
  writeDatedConfig(dir, 'routing-2026-07-27-1.json');
  fs.writeFileSync(
    path.join(dir, ACTIVE_FILENAME),
    JSON.stringify({ schema_version: 1, active_config: 'routing-2026-07-27-1.json', digest: `sha256:${'0'.repeat(64)}` })
  );
  assert.throws(() => loadRouting(dir), /digest mismatch/);
});

test('loadRouting throws when the dated config target is a symlink', () => {
  const dir = mkTmpDir();
  const realConfig = writeDatedConfig(dir, 'real.json');
  fs.symlinkSync(path.join(dir, 'real.json'), path.join(dir, 'routing-2026-07-27-1.json'));
  fs.writeFileSync(
    path.join(dir, ACTIVE_FILENAME),
    JSON.stringify({
      schema_version: 1,
      active_config: 'routing-2026-07-27-1.json',
      digest: sha256(Buffer.from(JSON.stringify(realConfig))),
    })
  );
  assert.throws(() => loadRouting(dir), /symlink/);
});

test('loadRouting throws when the dated config fails schema validation (missing seats/bans, non-integer revision)', () => {
  const dir = mkTmpDir();
  const badConfig = { schema_version: 1 };
  fs.writeFileSync(path.join(dir, 'routing-2026-07-27-1.json'), JSON.stringify(badConfig));
  fs.writeFileSync(
    path.join(dir, ACTIVE_FILENAME),
    JSON.stringify({
      schema_version: 1,
      active_config: 'routing-2026-07-27-1.json',
      digest: sha256(Buffer.from(JSON.stringify(badConfig))),
    })
  );
  assert.throws(() => loadRouting(dir), /failed schema validation/);
});

test('setActive swaps the pointer to a new dated config after verifying it exists', () => {
  const dir = mkTmpDir();
  writeDatedConfig(dir, 'routing-2026-07-27-1.json', { revision: 1, note: 'first' });
  writeDatedConfig(dir, 'routing-2026-08-01-1.json', { revision: 2, note: 'second' });
  setActive(dir, 'routing-2026-07-27-1.json');

  setActive(dir, 'routing-2026-08-01-1.json');
  const pointer = JSON.parse(fs.readFileSync(path.join(dir, ACTIVE_FILENAME), 'utf8'));
  assert.equal(pointer.active_config, 'routing-2026-08-01-1.json');
  assert.match(pointer.digest, /^sha256:[0-9a-f]{64}$/);

  const { config, activeFile } = loadRouting(dir);
  assert.equal(activeFile, 'routing-2026-08-01-1.json');
  assert.equal(config.revision, 2);
});

test('setActive throws and does not write the pointer when the target dated config does not exist', () => {
  const dir = mkTmpDir();
  writeDatedConfig(dir, 'routing-2026-07-27-1.json');
  setActive(dir, 'routing-2026-07-27-1.json');

  assert.throws(() => setActive(dir, 'routing-2026-08-01-1.json'), /does not exist/);

  const pointer = JSON.parse(fs.readFileSync(path.join(dir, ACTIVE_FILENAME), 'utf8'));
  assert.equal(pointer.active_config, 'routing-2026-07-27-1.json');
});

test('setActive throws TypeError for a missing or empty filename', () => {
  const dir = mkTmpDir();
  assert.throws(() => setActive(dir, ''), TypeError);
  assert.throws(() => setActive(dir, undefined), TypeError);
});

test('setActive throws for a filename that is not a valid routing-YYYY-MM-DD-N.json basename', () => {
  const dir = mkTmpDir();
  writeDatedConfig(dir, 'routing.json');
  assert.throws(() => setActive(dir, 'routing.json'), /not a valid routing-YYYY-MM-DD-N\.json basename/);
  assert.throws(() => setActive(dir, '../routing-2026-07-27-1.json'), /not a valid routing-YYYY-MM-DD-N\.json basename/);
});

test('setActive throws when the target is a symlink', () => {
  const dir = mkTmpDir();
  writeDatedConfig(dir, 'real.json');
  fs.symlinkSync(path.join(dir, 'real.json'), path.join(dir, 'routing-2026-07-27-1.json'));
  assert.throws(() => setActive(dir, 'routing-2026-07-27-1.json'), /symlink/);
});

// ---------- CLI (P11 finding F1: onboarding-runner.md's own cwd-relative
// `node -e` require had no lawful CLI to fall back on) ----------

const { spawnSync } = require('node:child_process');
const CLI_PATH = path.join(__dirname, '..', 'src', 'routing.js');

test('CLI: active <dirPath> prints the resolved activeFile and dated config', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'active', ROUTING_DIR], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.activeFile, ACTIVE_CONFIG_NAME);
  assert.equal(printed.config.schema_version, 1);
  assert.equal(printed.config.seats.research_chief.model, 'opus-5');
});

test('CLI: active exits 1 with a usage message when dirPath is missing', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'active'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage/);
});

test('CLI: active exits 1 naming the error when the directory has no active pointer', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'active', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /active pointer/);
});

test('setActive rollback: repointing back to an earlier dated config never edits the config file itself', () => {
  const dir = mkTmpDir();
  const original = writeDatedConfig(dir, 'routing-2026-07-27-1.json', { revision: 1 });
  writeDatedConfig(dir, 'routing-2026-08-01-1.json', { revision: 2 });

  setActive(dir, 'routing-2026-08-01-1.json');
  setActive(dir, 'routing-2026-07-27-1.json'); // rollback

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'routing-2026-07-27-1.json'), 'utf8'));
  assert.deepEqual(onDisk, original);
  const { activeFile } = loadRouting(dir);
  assert.equal(activeFile, 'routing-2026-07-27-1.json');
});

// ---------- validateRoutingConfig ----------

test('validateRoutingConfig accepts a well-formed dated config', () => {
  const result = validateRoutingConfig({ schema_version: 1, revision: 1, seats: {}, bans: {} });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('validateRoutingConfig reports every missing/malformed field at once', () => {
  const result = validateRoutingConfig({ schema_version: 2, revision: 'nope', seats: [], bans: null });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 4);
});

test('validateRoutingConfig rejects a non-object config', () => {
  assert.equal(validateRoutingConfig(null).ok, false);
  assert.equal(validateRoutingConfig('nope').ok, false);
  assert.equal(validateRoutingConfig([1, 2]).ok, false);
});
