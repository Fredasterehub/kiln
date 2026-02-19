'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { install } = require('../src/install');
const { resolvePaths } = require('../src/paths');
const { computeChecksum } = require('../src/manifest');

const REPO_ROOT = path.resolve(__dirname, '..');
const ASSETS_AGENTS_DIR = path.join(REPO_ROOT, 'assets', 'agents');
const ASSETS_COMMANDS_DIR = path.join(REPO_ROOT, 'assets', 'commands', 'kiln');
const ASSETS_DATA_DIR = path.join(REPO_ROOT, 'assets', 'data');
const ASSETS_SKILLS_DIR = path.join(REPO_ROOT, 'assets', 'skills');
const ASSETS_TEMPLATES_DIR = path.join(REPO_ROOT, 'assets', 'templates');

function safeRm(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (_err) {
    // Do not mask test failures with cleanup failures.
  }
}

function listMarkdownFiles(dirPath) {
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

function listJsonFiles(dirPath) {
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function assertDirectoryExists(dirPath) {
  assert.strictEqual(fs.existsSync(dirPath), true, `${dirPath} should exist`);
  assert.strictEqual(
    fs.statSync(dirPath).isDirectory(),
    true,
    `${dirPath} should be a directory`
  );
}

function assertNonEmptyFile(filePath) {
  assert.strictEqual(fs.existsSync(filePath), true, `${filePath} should exist`);
  const stat = fs.statSync(filePath);
  assert.strictEqual(stat.isFile(), true, `${filePath} should be a file`);
  assert.ok(stat.size > 0, `${filePath} should be non-empty`);
}

// install() calls writeManifest(data, home) where home is the tmpHome string.
// writeManifest resolves the target using resolvePaths(home), so the manifest
// lands at tmpHome/.claude/kilntwo/manifest.json — not the real home directory.
// No real-home cleanup is needed.

describe('install E2E', { concurrency: false }, () => {
  let tmpHome;
  let tmpProject;
  let paths;
  let manifestPath;

  before(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-test-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-test-'));
    paths = resolvePaths(tmpHome);
    manifestPath = paths.manifestPath;
  });

  after(() => {
    safeRm(tmpHome);
    safeRm(tmpProject);
  });

  it('creates all expected directory structure', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    assertDirectoryExists(paths.agentsDir);
    assertDirectoryExists(paths.commandsDir);
    assertDirectoryExists(paths.dataDir);
    assertDirectoryExists(paths.kilntwoDir);
    assertDirectoryExists(paths.templatesDir);
  });

  it('copies all data files', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const dataNames = listJsonFiles(ASSETS_DATA_DIR);
    assert.strictEqual(dataNames.length, 2, 'assets/data should contain 2 JSON files');

    for (const name of dataNames) {
      assertNonEmptyFile(path.join(paths.dataDir, name));
    }

    // Verify they are valid JSON
    const techniques = JSON.parse(
      fs.readFileSync(path.join(paths.dataDir, 'brainstorming-techniques.json'), 'utf8')
    );
    assert.ok(Array.isArray(techniques.techniques), 'techniques must have techniques array');

    const methods = JSON.parse(
      fs.readFileSync(path.join(paths.dataDir, 'elicitation-methods.json'), 'utf8')
    );
    assert.ok(Array.isArray(methods.methods), 'methods must have methods array');
  });

  it('copies all agent files', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const agentNames = listMarkdownFiles(ASSETS_AGENTS_DIR);
    assert.strictEqual(agentNames.length, 17, 'assets/agents should contain 17 files');

    for (const name of agentNames) {
      assertNonEmptyFile(path.join(paths.agentsDir, name));
    }
  });

  it('copies all command files', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const expected = ['reset.md', 'resume.md', 'start.md'];
    for (const name of expected) {
      assertNonEmptyFile(path.join(paths.commandsDir, name));
    }
  });

  it('copies all template files', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const expected = ['MEMORY.md', 'decisions.md', 'master-plan.md', 'pitfalls.md', 'vision.md'];
    for (const name of expected) {
      assertNonEmptyFile(path.join(paths.templatesDir, name));
    }
  });

  it('copies names.json to kilntwoDir', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const namesPath = path.join(paths.kilntwoDir, 'names.json');
    assertNonEmptyFile(namesPath);
    const parsed = JSON.parse(fs.readFileSync(namesPath, 'utf8'));
    assert.ok(parsed['kiln-planner-claude'], 'names.json should contain kiln-planner-claude');
    assert.ok(
      Array.isArray(parsed['kiln-planner-claude'].quotes),
      'kiln-planner-claude should have quotes array'
    );
  });

  it('writes CLAUDE.md with protocol block to projectPath', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const claudeMdPath = path.join(tmpProject, 'CLAUDE.md');
    assert.strictEqual(fs.existsSync(claudeMdPath), true, 'CLAUDE.md should exist');
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    assert.ok(
      content.includes('<!-- kiln:protocol:begin'),
      'CLAUDE.md should contain protocol begin marker'
    );
  });

  it('returns correct shape from install()', () => {
    const result = install({ home: tmpHome, projectPath: tmpProject });
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

    assert.strictEqual(typeof result, 'object');
    assert.strictEqual(Array.isArray(result.installed), true);
    assert.strictEqual(Array.isArray(result.skipped), true);
    assert.strictEqual(typeof result.version, 'string');
    assert.ok(result.version.length > 0);
    assert.strictEqual(result.version, pkg.version);

    const expectedCount =
      listMarkdownFiles(ASSETS_AGENTS_DIR).length +
      listMarkdownFiles(ASSETS_COMMANDS_DIR).length +
      listJsonFiles(ASSETS_DATA_DIR).length +
      listMarkdownFiles(ASSETS_SKILLS_DIR).length +
      listMarkdownFiles(ASSETS_TEMPLATES_DIR).length +
      1; // names.json

    assert.strictEqual(
      result.installed.length,
      expectedCount,
      `installed.length should equal total asset count (${expectedCount})`
    );

    for (const installedPath of result.installed) {
      assert.strictEqual(typeof installedPath, 'string');
      assert.strictEqual(
        path.isAbsolute(installedPath),
        true,
        `installed path must be absolute: ${installedPath}`
      );
    }
  });

  it('manifest.json exists and is valid JSON', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    // manifest writes to tmpHome/.claude/kilntwo/manifest.json via writeManifest(data, home)
    assert.strictEqual(
      fs.existsSync(manifestPath),
      true,
      `manifest.json should exist at ${manifestPath}`
    );
    const raw = fs.readFileSync(manifestPath, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw), 'manifest.json should be valid JSON');
  });

  it('manifest contains files array with relative paths and checksums', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // install() writes a proper manifest: { manifestVersion, kilnVersion, installedAt, files, protocolMarkers }
    assert.strictEqual(typeof parsed, 'object');
    assert.ok(parsed !== null);
    assert.strictEqual(parsed.manifestVersion, 1);
    assert.strictEqual(typeof parsed.kilnVersion, 'string');
    assert.ok(parsed.kilnVersion.length > 0);
    assert.strictEqual(Array.isArray(parsed.files), true);

    for (const entry of parsed.files) {
      assert.strictEqual(typeof entry.path, 'string', 'each file entry must have a string path');
      assert.strictEqual(
        typeof entry.checksum,
        'string',
        'each file entry must have a string checksum'
      );
      assert.ok(entry.checksum.startsWith('sha256:'), 'checksum must start with sha256:');
      // paths in the manifest are relative to claudeDir
      assert.strictEqual(path.isAbsolute(entry.path), false, 'manifest paths must be relative');
    }
  });

  it('manifest stores the install target project and CLAUDE.md path', () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.strictEqual(parsed.projectPath, path.resolve(tmpProject));
    assert.strictEqual(parsed.claudeMdPath, path.join(path.resolve(tmpProject), 'CLAUDE.md'));
  });

  it('is idempotent — second install produces same file count and checksums', () => {
    const first = install({ home: tmpHome, projectPath: tmpProject });

    const agentNames = listMarkdownFiles(ASSETS_AGENTS_DIR);
    const commandNames = listMarkdownFiles(ASSETS_COMMANDS_DIR);
    const templateNames = listMarkdownFiles(ASSETS_TEMPLATES_DIR);

    const allInstalledFiles = [
      ...agentNames.map((name) => path.join(paths.agentsDir, name)),
      ...commandNames.map((name) => path.join(paths.commandsDir, name)),
      ...templateNames.map((name) => path.join(paths.templatesDir, name)),
    ];

    const countBefore = {
      agents: fs.readdirSync(paths.agentsDir).length,
      commands: fs.readdirSync(paths.commandsDir).length,
      templates: fs.readdirSync(paths.templatesDir).length,
    };

    const checksumsBefore = new Map(
      allInstalledFiles.map((filePath) => [filePath, computeChecksum(filePath)])
    );

    const second = install({ home: tmpHome, projectPath: tmpProject });

    // No new files should appear
    assert.strictEqual(fs.readdirSync(paths.agentsDir).length, countBefore.agents);
    assert.strictEqual(fs.readdirSync(paths.commandsDir).length, countBefore.commands);
    assert.strictEqual(fs.readdirSync(paths.templatesDir).length, countBefore.templates);

    // installed count should be the same (files with matching checksums stay in installed)
    assert.strictEqual(second.installed.length, first.installed.length);
    assert.strictEqual(Array.isArray(second.skipped), true);
    // Files are byte-for-byte identical to source, so none are skipped
    assert.strictEqual(second.skipped.length, 0);

    // Each file's content must be unchanged
    for (const filePath of allInstalledFiles) {
      assert.strictEqual(
        computeChecksum(filePath),
        checksumsBefore.get(filePath),
        `checksum changed for ${filePath}`
      );
    }
  });
});
