'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PROFILE_IDS,
  KNOWN_PACKAGE_MANAGERS,
  DEFAULT_PROFILES_PATH,
  loadProfiles,
  validateProfiles,
  detectPackageManager,
  composeInstall,
  composeSuite,
  probeSatisfied,
  scaffoldProfile,
} = require('../src/toolchain.js');

// A pathProbe that finds nothing — the deterministic stand-in for "no known
// manager anywhere on PATH," so lockfile/packageManager-absent tests do not
// depend on what happens to be installed on the machine running the suite.
const noPathManagers = () => false;

// A pathProbe that finds exactly one named manager, for asserting the
// PATH-fallback picks up a specific manager without depending on the real
// host environment.
function onlyOnPath(name) {
  return (candidate) => candidate === name;
}

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-test-'));
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

function validRegistry(overrides) {
  const base = JSON.parse(fs.readFileSync(DEFAULT_PROFILES_PATH, 'utf8'));
  return Object.assign({}, base, overrides);
}

// ---------- PROFILE_IDS / KNOWN_PACKAGE_MANAGERS ----------

test('PROFILE_IDS is the exact closed v1 set (research/r3 §1 Q3)', () => {
  assert.deepEqual([...PROFILE_IDS].sort(), ['node-cli', 'node-web', 'python-pytest']);
});

test('KNOWN_PACKAGE_MANAGERS is the exact closed set', () => {
  assert.deepEqual([...KNOWN_PACKAGE_MANAGERS].sort(), ['bun', 'npm', 'pnpm', 'yarn']);
});

// ---------- loadProfiles / validateProfiles ----------

test('loadProfiles loads the shipped machine/toolchain-profiles.json and it validates', () => {
  const registry = loadProfiles();
  const res = validateProfiles(registry);
  assert.deepEqual(res, { ok: true, errors: [] });
  for (const id of PROFILE_IDS) {
    assert.ok(registry.profiles[id]);
  }
});

test('loadProfiles accepts an explicit path', () => {
  const registry = loadProfiles(DEFAULT_PROFILES_PATH);
  assert.equal(registry.schema_version, 1);
});

test('loadProfiles throws when the registry on disk fails validation', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'bad-profiles.json');
  writeJson(file, { schema_version: 1, profiles: {} });
  assert.throws(() => loadProfiles(file), /toolchain/);
});

test('validateProfiles rejects a non-object', () => {
  assert.equal(validateProfiles(null).ok, false);
  assert.equal(validateProfiles([]).ok, false);
  assert.doesNotThrow(() => validateProfiles(42));
});

test('validateProfiles rejects a wrong schema_version', () => {
  const res = validateProfiles(validRegistry({ schema_version: 2 }));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('schema_version')));
});

test('validateProfiles rejects a missing profile from the closed set', () => {
  const registry = loadProfiles();
  const profiles = { ...registry.profiles };
  delete profiles['node-cli'];
  const res = validateProfiles({ ...registry, profiles });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('node-cli')));
});

test('validateProfiles rejects an unknown extra profile key', () => {
  const registry = loadProfiles();
  const profiles = { ...registry.profiles, 'rust-cargo': registry.profiles['node-cli'] };
  const res = validateProfiles({ ...registry, profiles });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('rust-cargo')));
});

test('validateProfiles rejects a profile entry missing a required field', () => {
  const registry = loadProfiles();
  const profiles = { ...registry.profiles };
  const { install_cmd_template, ...rest } = profiles['node-web'];
  profiles['node-web'] = rest;
  const res = validateProfiles({ ...registry, profiles });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('install_cmd_template')));
});

test('validateProfiles rejects a non-array scaffolds / reporter_flags', () => {
  const registry = loadProfiles();
  const profiles = { ...registry.profiles };
  profiles['node-web'] = { ...profiles['node-web'], scaffolds: 'nope' };
  const res = validateProfiles({ ...registry, profiles });
  assert.equal(res.ok, false);
});

test('validateProfiles never throws on garbage input', () => {
  assert.doesNotThrow(() => validateProfiles(() => {}));
  assert.doesNotThrow(() => validateProfiles('nope'));
});

// ---------- detectPackageManager ----------

test('detectPackageManager throws when the directory does not exist', () => {
  assert.throws(() => detectPackageManager(path.join(os.tmpdir(), 'does-not-exist-toolchain-xyz')), /toolchain/);
});

test('detectPackageManager: package-lock.json -> npm', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  const res = detectPackageManager(dir);
  assert.equal(res.pm, 'npm');
  assert.equal(typeof res.reason, 'string');
});

test('detectPackageManager: yarn.lock -> yarn', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  assert.equal(detectPackageManager(dir).pm, 'yarn');
});

test('detectPackageManager: pnpm-lock.yaml -> pnpm', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  assert.equal(detectPackageManager(dir).pm, 'pnpm');
});

test('detectPackageManager: bun.lockb -> bun', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'bun.lockb'), '');
  assert.equal(detectPackageManager(dir).pm, 'bun');
});

test('detectPackageManager: lockfile-first priority — package-lock.json wins over yarn.lock', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  assert.equal(detectPackageManager(dir).pm, 'npm');
});

test('detectPackageManager: falls back to package.json "packageManager" field', () => {
  const dir = mkTmpDir();
  writeJson(path.join(dir, 'package.json'), { packageManager: 'pnpm@8.6.0' });
  assert.equal(detectPackageManager(dir).pm, 'pnpm');
});

test('detectPackageManager: unrecognized "packageManager" field value falls to null with reason', () => {
  const dir = mkTmpDir();
  writeJson(path.join(dir, 'package.json'), { packageManager: 'nimble@1.0.0' });
  const res = detectPackageManager(dir);
  assert.equal(res.pm, null);
  assert.equal(typeof res.reason, 'string');
});

test('detectPackageManager: no lockfile and no package.json, and nothing on PATH -> null with reason', () => {
  const dir = mkTmpDir();
  const res = detectPackageManager(dir, { pathProbe: noPathManagers });
  assert.equal(res.pm, null);
  assert.ok(res.reason.length > 0);
});

test('detectPackageManager: no lockfile and package.json with no packageManager field, and nothing on PATH -> null', () => {
  const dir = mkTmpDir();
  writeJson(path.join(dir, 'package.json'), { name: 'x' });
  assert.equal(detectPackageManager(dir, { pathProbe: noPathManagers }).pm, null);
});

// ---------- detectPackageManager: PATH-probe fallback (R3 §1 Q2(c)) ----------

test('detectPackageManager: falls back to a PATH-detected manager when no lockfile or package.json exists', () => {
  const dir = mkTmpDir();
  const res = detectPackageManager(dir, { pathProbe: onlyOnPath('yarn') });
  assert.equal(res.pm, 'yarn');
  assert.match(res.reason, /PATH/);
});

test('detectPackageManager: falls back to a PATH-detected manager when package.json declares no packageManager field', () => {
  const dir = mkTmpDir();
  writeJson(path.join(dir, 'package.json'), { name: 'x' });
  const res = detectPackageManager(dir, { pathProbe: onlyOnPath('pnpm') });
  assert.equal(res.pm, 'pnpm');
});

test('detectPackageManager: PATH-probe order is npm, then yarn, then pnpm, then bun', () => {
  const dir = mkTmpDir();
  // Every manager "available" — npm must still win, first in the order.
  assert.equal(detectPackageManager(dir, { pathProbe: () => true }).pm, 'npm');
  // npm unavailable, yarn/pnpm/bun available — yarn wins.
  assert.equal(
    detectPackageManager(dir, { pathProbe: (m) => m !== 'npm' }).pm,
    'yarn'
  );
  // Only bun available.
  assert.equal(detectPackageManager(dir, { pathProbe: onlyOnPath('bun') }).pm, 'bun');
});

test('detectPackageManager: an unrecognized "packageManager" field value never falls through to a PATH probe', () => {
  const dir = mkTmpDir();
  writeJson(path.join(dir, 'package.json'), { packageManager: 'nimble@1.0.0' });
  // Even though npm is "available" on PATH here, an explicitly-declared but
  // unrecognized manager must stay null, never silently substituted.
  const res = detectPackageManager(dir, { pathProbe: () => true });
  assert.equal(res.pm, null);
});

test('detectPackageManager: lockfile presence never consults the PATH probe at all', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  let probed = false;
  const res = detectPackageManager(dir, { pathProbe: () => { probed = true; return true; } });
  assert.equal(res.pm, 'npm');
  assert.equal(probed, false);
});

test('detectPackageManager: corrupt package.json throws', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), '{not json');
  assert.throws(() => detectPackageManager(dir), /toolchain/);
});

// ---------- composeInstall ----------

test('composeInstall: node-web with an explicit pm name composes npm devDependency install', () => {
  const cmd = composeInstall('node-web', 'npm');
  assert.match(cmd, /npm install --save-dev/);
  assert.match(cmd, /@playwright\/test/);
  assert.match(cmd, /npx playwright install --with-deps/);
});

test('composeInstall: node-web with each known pm name composes the matching install verb AND the matching exec verb', () => {
  assert.match(composeInstall('node-web', 'yarn'), /yarn add --dev/);
  assert.match(composeInstall('node-web', 'yarn'), /yarn dlx playwright install --with-deps/);
  assert.match(composeInstall('node-web', 'pnpm'), /pnpm add --save-dev/);
  assert.match(composeInstall('node-web', 'pnpm'), /pnpm dlx playwright install --with-deps/);
  assert.match(composeInstall('node-web', 'bun'), /bun add --dev/);
  assert.match(composeInstall('node-web', 'bun'), /bunx playwright install --with-deps/);
});

test('composeInstall: node-web resolves pm from a directory when pmOrDir is not a known pm name', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  assert.match(composeInstall('node-web', dir), /pnpm add --save-dev/);
});

test('composeInstall: node-web throws when the directory has no detectable pm anywhere, including PATH', () => {
  const dir = mkTmpDir();
  assert.throws(() => composeInstall('node-web', dir, { pathProbe: noPathManagers }), /toolchain/);
});

test('composeInstall: node-web resolves pm via the PATH-probe fallback when nothing is declared in the directory', () => {
  const dir = mkTmpDir();
  const cmd = composeInstall('node-web', dir, { pathProbe: onlyOnPath('yarn') });
  assert.match(cmd, /yarn add --dev/);
  assert.match(cmd, /yarn dlx playwright install --with-deps/);
});

test('composeInstall: node-cli returns the same literal no-op regardless of pmOrDir', () => {
  const a = composeInstall('node-cli', 'npm');
  const b = composeInstall('node-cli', mkTmpDir());
  assert.equal(a, b);
  assert.match(a, /nothing to install/);
});

test('composeInstall: python-pytest returns the venv/pip command regardless of pmOrDir', () => {
  const cmd = composeInstall('python-pytest', 'npm');
  assert.match(cmd, /pip install -r requirements-dev\.txt/);
});

test('composeInstall: never mutates any file on disk', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  const before = fs.readdirSync(dir).sort();
  composeInstall('node-web', dir);
  const after = fs.readdirSync(dir).sort();
  assert.deepEqual(before, after);
});

test('composeInstall: throws on an unknown profileId', () => {
  assert.throws(() => composeInstall('go-modules', 'npm'), /toolchain/);
});

test('composeInstall: throws on a null profileId', () => {
  assert.throws(() => composeInstall(null, 'npm'), /toolchain/);
});

// ---------- probeSatisfied ----------

test('probeSatisfied: node-web is unsatisfied when @playwright/test is not resolvable', () => {
  const dir = mkTmpDir();
  const res = probeSatisfied('node-web', dir);
  assert.equal(res.satisfied, false);
  assert.equal(typeof res.probe_cmd, 'string');
  assert.ok(res.probe_cmd.length > 0);
});

test('probeSatisfied: node-web is satisfied once @playwright/test resolves in node_modules', () => {
  const dir = mkTmpDir();
  const pkgDir = path.join(dir, 'node_modules', '@playwright', 'test');
  fs.mkdirSync(pkgDir, { recursive: true });
  writeJson(path.join(pkgDir, 'package.json'), { name: '@playwright/test' });
  assert.equal(probeSatisfied('node-web', dir).satisfied, true);
});

test('probeSatisfied: node-cli is always satisfied (zero-install)', () => {
  assert.equal(probeSatisfied('node-cli', mkTmpDir()).satisfied, true);
});

test('probeSatisfied: python-pytest is unsatisfied without a venv', () => {
  assert.equal(probeSatisfied('python-pytest', mkTmpDir()).satisfied, false);
});

test('probeSatisfied: python-pytest is satisfied once a venv pytest executable exists', () => {
  const dir = mkTmpDir();
  const binDir = path.join(dir, '.venv', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'pytest'), '#!/bin/sh\n');
  assert.equal(probeSatisfied('python-pytest', dir).satisfied, true);
});

test('probeSatisfied: throws on an unknown profileId', () => {
  assert.throws(() => probeSatisfied('go-modules', mkTmpDir()), /toolchain/);
});

// ---------- scaffoldProfile ----------

test('scaffoldProfile: null profile is a no-op', () => {
  const dir = mkTmpDir();
  const before = fs.readdirSync(dir).sort();
  const result = scaffoldProfile(null, dir);
  assert.deepEqual(result, { created: [], skipped: [] });
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});

test('scaffoldProfile: node-cli is a no-op', () => {
  const dir = mkTmpDir();
  const before = fs.readdirSync(dir).sort();
  const result = scaffoldProfile('node-cli', dir);
  assert.deepEqual(result, { created: [], skipped: [] });
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});

test('scaffoldProfile: node-web materializes playwright.config.ts and an example test under tests/', () => {
  const dir = mkTmpDir();
  const result = scaffoldProfile('node-web', dir);

  const configPath = path.join(dir, 'playwright.config.ts');
  const examplePath = path.join(dir, 'tests', 'example.spec.ts');
  assert.ok(fs.existsSync(configPath));
  assert.ok(fs.existsSync(examplePath));
  assert.match(fs.readFileSync(configPath, 'utf8'), /defineConfig/);
  assert.match(fs.readFileSync(examplePath, 'utf8'), /@playwright\/test/);
  assert.deepEqual(result.created.sort(), [configPath, examplePath].sort());
  assert.deepEqual(result.skipped, []);
});

test('scaffoldProfile: node-web never overwrites an existing playwright.config.ts or example test', () => {
  const dir = mkTmpDir();
  const configPath = path.join(dir, 'playwright.config.ts');
  fs.writeFileSync(configPath, '// hand-authored, do not touch\n');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  const examplePath = path.join(dir, 'tests', 'example.spec.ts');
  fs.writeFileSync(examplePath, '// hand-authored test\n');

  const result = scaffoldProfile('node-web', dir);

  assert.equal(fs.readFileSync(configPath, 'utf8'), '// hand-authored, do not touch\n');
  assert.equal(fs.readFileSync(examplePath, 'utf8'), '// hand-authored test\n');
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.skipped.sort(), [configPath, examplePath].sort());
});

test('scaffoldProfile: python-pytest creates requirements-dev.txt naming pytest and the venv convention', () => {
  const dir = mkTmpDir();
  const result = scaffoldProfile('python-pytest', dir);
  const reqPath = path.join(dir, 'requirements-dev.txt');
  assert.ok(fs.existsSync(reqPath));
  const contents = fs.readFileSync(reqPath, 'utf8');
  assert.match(contents, /pytest/);
  assert.match(contents, /\.venv/);
  assert.deepEqual(result.created, [reqPath]);
  assert.deepEqual(result.skipped, []);
});

test('scaffoldProfile: python-pytest appends the pytest entry to an existing requirements-dev.txt lacking it', () => {
  const dir = mkTmpDir();
  const reqPath = path.join(dir, 'requirements-dev.txt');
  fs.writeFileSync(reqPath, 'requests==2.31.0\n');

  const result = scaffoldProfile('python-pytest', dir);

  const contents = fs.readFileSync(reqPath, 'utf8');
  assert.match(contents, /requests==2\.31\.0/);
  assert.match(contents, /^pytest$/m);
  assert.deepEqual(result.created, [reqPath]);
  assert.deepEqual(result.skipped, []);
});

test('scaffoldProfile: python-pytest skips (never duplicates) when requirements-dev.txt already names pytest', () => {
  const dir = mkTmpDir();
  const reqPath = path.join(dir, 'requirements-dev.txt');
  fs.writeFileSync(reqPath, 'pytest\nrequests==2.31.0\n');

  const result = scaffoldProfile('python-pytest', dir);

  const contents = fs.readFileSync(reqPath, 'utf8');
  assert.equal((contents.match(/^pytest$/gm) || []).length, 1);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.skipped, [reqPath]);
});

test('scaffoldProfile: throws on an unknown profileId', () => {
  assert.throws(() => scaffoldProfile('go-modules', mkTmpDir()), /toolchain/);
});

test('scaffoldProfile: throws on a non-empty-string targetDir', () => {
  assert.throws(() => scaffoldProfile('node-cli', ''), /toolchain/);
  assert.throws(() => scaffoldProfile('node-cli', 42), /toolchain/);
});

// ---------- containment (P11 Sol review pass-2 defect 12) ----------

test('scaffoldProfile: python-pytest refuses a symlinked requirements-dev.txt rather than writing through it (Sol\'s own probe)', () => {
  const dir = mkTmpDir();
  const outside = path.join(mkTmpDir(), 'outside-requirements.txt');
  fs.writeFileSync(outside, 'requests==2.31.0\n');
  fs.symlinkSync(outside, path.join(dir, 'requirements-dev.txt'));

  assert.throws(() => scaffoldProfile('python-pytest', dir), /symlinked requirements-dev\.txt/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'requests==2.31.0\n');
});

test('scaffoldProfile: node-web refuses a symlinked playwright.config.ts', () => {
  const dir = mkTmpDir();
  const outside = path.join(mkTmpDir(), 'outside-config.ts');
  fs.writeFileSync(outside, '// not the real config\n');
  fs.symlinkSync(outside, path.join(dir, 'playwright.config.ts'));

  assert.throws(() => scaffoldProfile('node-web', dir), /symlinked playwright\.config\.ts/);
});

test('scaffoldProfile: node-web refuses a symlinked tests directory', () => {
  const dir = mkTmpDir();
  const outsideDir = path.join(mkTmpDir(), 'outside-tests');
  fs.mkdirSync(outsideDir);
  fs.symlinkSync(outsideDir, path.join(dir, 'tests'));

  assert.throws(() => scaffoldProfile('node-web', dir), /symlinked tests directory/);
  assert.equal(fs.existsSync(path.join(outsideDir, 'example.spec.ts')), false);
});

// ---------- CLI (P11 convergence finding 3: product/implementation/flow.md's
// toolchain-preflight step and agents/security-scanner.md's own
// detectPackageManager call had no executable form) ----------

const { spawnSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'src', 'toolchain.js');

test('CLI: detect-package-manager finds a committed lockfile', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'detect-package-manager', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), detectPackageManager(dir));
});

test('CLI: detect-package-manager exits 1 on a missing dir argument', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'detect-package-manager'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^toolchain\.js: /);
});

test('CLI: probe-satisfied reports node-cli as always satisfied', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'probe-satisfied', 'node-cli', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), probeSatisfied('node-cli', dir));
});

test('CLI: probe-satisfied exits 1 on an unknown profileId', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'probe-satisfied', 'go-modules', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
});

test('CLI: scaffold-profile accepts the literal "null" profileId as a no-op', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'scaffold-profile', 'null', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), { created: [], skipped: [] });
});

test('CLI: scaffold-profile materializes requirements-dev.txt for python-pytest', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'scaffold-profile', 'python-pytest', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'requirements-dev.txt')), true);
});

test('CLI: scaffold-profile exits 1 on an unknown (non-null) profileId', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'scaffold-profile', 'go-modules', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
});

test('CLI: compose-install for node-cli returns the template unmodified (no pm resolution needed)', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'compose-install', 'node-cli', 'irrelevant'], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), { cmd: composeInstall('node-cli', 'irrelevant') });
});

test('CLI: compose-install for node-web substitutes a known package manager name directly', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'compose-install', 'node-web', 'yarn'], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.match(printed.cmd, /yarn add --dev/);
  assert.match(printed.cmd, /yarn dlx playwright install/);
});

test('CLI: compose-install for node-web resolves a package manager from a target directory\'s own lockfile', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'compose-install', 'node-web', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.match(printed.cmd, /pnpm add --save-dev/);
  assert.match(printed.cmd, /pnpm dlx playwright install/);
});

test('CLI: unknown command prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'bogus'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: toolchain\.js/);
});

test('CLI: no command prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: toolchain\.js/);
});

test('CLI: a surplus positional argument is refused (P11 Sol review finding 13)', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'detect-package-manager', dir, 'extra'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /takes at most 1 argument/);
});

// ---------- composeSuite ----------

// The regression floor and the per-chunk gate both run "the target project's
// own full suite". Which command that is, is a property of the toolchain
// profile — exactly like the install command already is — and the reporter
// flags the registry already carries are useless to anyone who has to invent
// the command they attach to. Hard-coding `npm test` was the alternative, and
// it is wrong for two of the three profiles.
test('composeSuite derives the profile\'s full suite command, reporter flags included', () => {
  const cli = composeSuite('node-cli');
  const web = composeSuite('node-web', 'npm');
  const py = composeSuite('python-pytest');

  assert.match(cli, /--test-reporter=tap/);
  assert.match(web, /--reporter=json/);
  assert.match(py, /--junitxml=report\.xml/);
  // Three profiles, three different suites — a fixture where the wrong answer
  // is a different answer.
  assert.equal(new Set([cli, web, py]).size, 3);
});

test('composeSuite refuses a profile the registry does not name', () => {
  assert.throws(() => composeSuite('node-desktop'), /profile/i);
  assert.throws(() => composeSuite(null), /profile/i);
});

// Every flag the registry declares reaches the command. A template that
// substituted only the first would report on a fraction of the suite while
// looking like it reported on all of it.
test('composeSuite carries every reporter flag the profile declares', () => {
  const registry = loadProfiles();
  for (const id of ['node-cli', 'node-web', 'python-pytest']) {
    const cmd = composeSuite(id, 'npm');
    for (const flag of registry.profiles[id].reporter_flags) {
      assert.ok(cmd.includes(flag), `${id}: ${flag} is missing from ${cmd}`);
    }
  }
});
