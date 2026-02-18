'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { uninstall } = require('../src/uninstall');
const { resolvePaths } = require('../src/paths');
const { writeManifest, computeChecksum } = require('../src/manifest');

const REPO_ROOT = path.resolve(__dirname, '..');
const ASSETS_AGENTS_DIR = path.join(REPO_ROOT, 'assets', 'agents');

function safeRm(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (_err) {
    // Do not mask test failures with cleanup failures.
  }
}

// Write a manifest that uninstall() can read.
// uninstall() calls readManifest({ manifestPath }) which reads an object with
// a `files` array of { path, checksum } entries. writeManifest(data, homeOverride)
// resolves the target from homeOverride (a string), writing to
// homeOverride/.claude/kilntwo/manifest.json.
function writeUninstallManifest(tmpHome, fileEntries) {
  const data = {
    manifestVersion: 1,
    kilnVersion: '0.1.0',
    installedAt: new Date().toISOString(),
    files: fileEntries,
    protocolMarkers: { begin: 'kiln:protocol:begin', end: 'kiln:protocol:end' },
  };
  writeManifest(data, tmpHome);
}

describe('uninstall E2E', { concurrency: false }, () => {
  let tmpHome;
  let tmpProject;
  let paths;
  let originalCwd;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-test-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-test-'));

    // uninstall() calls removeProtocol(path.join(process.cwd(), 'CLAUDE.md')).
    // Redirect cwd to a temp project dir so it operates on a temp file.
    originalCwd = process.cwd();
    process.chdir(tmpProject);

    paths = resolvePaths(tmpHome);
  });

  afterEach(() => {
    try {
      process.chdir(originalCwd);
    } catch (_err) {
      // Best effort.
    }
    safeRm(tmpHome);
    safeRm(tmpProject);
  });

  it('returns { error: "not-installed" } when no manifest exists', () => {
    const result = uninstall({ home: tmpHome });

    assert.strictEqual(result.error, 'not-installed');
    assert.strictEqual(fs.existsSync(paths.manifestPath), false);
  });

  it('removes all installed kiln-* agent files', () => {
    const agentNames = fs
      .readdirSync(ASSETS_AGENTS_DIR)
      .filter((name) => name.endsWith('.md') && name.startsWith('kiln-'))
      .sort();

    fs.mkdirSync(paths.agentsDir, { recursive: true });
    fs.mkdirSync(paths.kilntwoDir, { recursive: true });

    const manifestFiles = [];
    const absolutePaths = [];

    for (const name of agentNames) {
      const absolutePath = path.join(paths.agentsDir, name);
      fs.writeFileSync(absolutePath, `managed ${name}\n`, 'utf8');
      absolutePaths.push(absolutePath);
      manifestFiles.push({
        path: `agents/${name}`,
        checksum: computeChecksum(absolutePath),
      });
    }

    writeUninstallManifest(tmpHome, manifestFiles);

    const result = uninstall({ home: tmpHome });

    assert.strictEqual(Array.isArray(result.removed), true);
    assert.strictEqual(result.removed.length, absolutePaths.length);
    assert.strictEqual(result.notFound.length, 0);

    for (const absolutePath of absolutePaths) {
      assert.strictEqual(
        fs.existsSync(absolutePath),
        false,
        `${absolutePath} should have been deleted`
      );
      assert.ok(
        result.removed.includes(absolutePath),
        `${absolutePath} should be in result.removed`
      );
    }
  });

  it('removes manifest.json after uninstall', () => {
    fs.mkdirSync(paths.agentsDir, { recursive: true });
    fs.mkdirSync(paths.kilntwoDir, { recursive: true });

    const filePath = path.join(paths.agentsDir, 'kiln-debater.md');
    fs.writeFileSync(filePath, 'managed\n', 'utf8');

    writeUninstallManifest(tmpHome, [
      { path: 'agents/kiln-debater.md', checksum: computeChecksum(filePath) },
    ]);

    assert.strictEqual(
      fs.existsSync(paths.manifestPath),
      true,
      'manifest.json should exist before uninstall'
    );

    uninstall({ home: tmpHome });

    assert.strictEqual(
      fs.existsSync(paths.manifestPath),
      false,
      'manifest.json should be removed after uninstall'
    );
  });

  it('preserves non-KilnTwo files in the same directories', () => {
    fs.mkdirSync(paths.agentsDir, { recursive: true });
    fs.mkdirSync(paths.kilntwoDir, { recursive: true });

    const managedPath = path.join(paths.agentsDir, 'kiln-debater.md');
    fs.writeFileSync(managedPath, 'managed\n', 'utf8');

    const customPath = path.join(paths.agentsDir, 'user-custom-agent.md');
    fs.writeFileSync(customPath, 'keep me', 'utf8');

    writeUninstallManifest(tmpHome, [
      { path: 'agents/kiln-debater.md', checksum: computeChecksum(managedPath) },
    ]);

    uninstall({ home: tmpHome });

    assert.strictEqual(
      fs.existsSync(managedPath),
      false,
      'managed file should be removed'
    );
    assert.strictEqual(
      fs.existsSync(customPath),
      true,
      'user custom file should be preserved'
    );
    assert.strictEqual(
      fs.readFileSync(customPath, 'utf8'),
      'keep me',
      'user custom file content should be unchanged'
    );
  });

  it('leaves command directory intact when it has extra files', () => {
    fs.mkdirSync(paths.commandsDir, { recursive: true });
    fs.mkdirSync(paths.kilntwoDir, { recursive: true });

    const managedPath = path.join(paths.commandsDir, 'start.md');
    fs.writeFileSync(managedPath, 'managed\n', 'utf8');

    const customPath = path.join(paths.commandsDir, 'my-custom-cmd.md');
    fs.writeFileSync(customPath, 'keep me', 'utf8');

    writeUninstallManifest(tmpHome, [
      { path: 'commands/kiln/start.md', checksum: computeChecksum(managedPath) },
    ]);

    uninstall({ home: tmpHome });

    assert.strictEqual(
      fs.existsSync(managedPath),
      false,
      'managed command file should be removed'
    );
    assert.strictEqual(
      fs.existsSync(customPath),
      true,
      'user custom command file should be preserved'
    );
    assert.strictEqual(
      fs.readFileSync(customPath, 'utf8'),
      'keep me',
      'custom command file content should be unchanged'
    );
    // rmdirSync skips ENOTEMPTY, so the directory stays when it has extra files
    assert.strictEqual(
      fs.existsSync(paths.commandsDir),
      true,
      'commandsDir should still exist when it has extra files'
    );
    assert.strictEqual(
      fs.statSync(paths.commandsDir).isDirectory(),
      true,
      'commandsDir should still be a directory'
    );
  });

  it('handles notFound files gracefully', () => {
    fs.mkdirSync(paths.kilntwoDir, { recursive: true });

    const missingRel = ['agents/kiln-missing-a.md', 'commands/kiln/missing-b.md'];
    writeUninstallManifest(
      tmpHome,
      missingRel.map((rel) => ({ path: rel, checksum: 'sha256:missing' }))
    );

    const result = uninstall({ home: tmpHome });

    assert.strictEqual('error' in result, false, 'result should not have an error property');
    assert.strictEqual(Array.isArray(result.notFound), true);
    assert.strictEqual(Array.isArray(result.removed), true);
    assert.strictEqual(result.removed.length, 0);
    assert.strictEqual(result.notFound.length, missingRel.length);

    for (const rel of missingRel) {
      const abs = path.join(paths.claudeDir, rel);
      assert.ok(result.notFound.includes(abs), `${abs} should be in result.notFound`);
    }
  });

  it('result has correct shape: { removed, notFound }', () => {
    fs.mkdirSync(paths.agentsDir, { recursive: true });
    fs.mkdirSync(paths.kilntwoDir, { recursive: true });

    const managedPath = path.join(paths.agentsDir, 'kiln-debater.md');
    fs.writeFileSync(managedPath, 'managed\n', 'utf8');

    writeUninstallManifest(tmpHome, [
      { path: 'agents/kiln-debater.md', checksum: computeChecksum(managedPath) },
    ]);

    const result = uninstall({ home: tmpHome });

    assert.strictEqual(Array.isArray(result.removed), true);
    assert.strictEqual(Array.isArray(result.notFound), true);
    assert.strictEqual('error' in result, false, 'result should not have an error property');
    assert.strictEqual(result.removed.length, 1);
    assert.strictEqual(result.notFound.length, 0);
  });
});
