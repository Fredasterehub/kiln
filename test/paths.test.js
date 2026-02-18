const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { resolvePaths, encodeProjectPath, projectMemoryDir, projectClaudeMd } =
  require('../src/paths.js');

describe('resolvePaths', () => {
  it('with homeOverride returns correct paths', () => {
    const result = resolvePaths('/tmp/testhome');
    assert.strictEqual(result.claudeDir, '/tmp/testhome/.claude');
    assert.strictEqual(result.agentsDir, '/tmp/testhome/.claude/agents');
    assert.strictEqual(result.commandsDir, '/tmp/testhome/.claude/commands/kiln');
    assert.strictEqual(result.kilntwoDir, '/tmp/testhome/.claude/kilntwo');
    assert.strictEqual(result.templatesDir, '/tmp/testhome/.claude/kilntwo/templates');
    assert.strictEqual(result.manifestPath, '/tmp/testhome/.claude/kilntwo/manifest.json');
  });

  it('without override does not throw', () => {
    assert.doesNotThrow(() => resolvePaths());
    const result = resolvePaths();
    assert.ok(typeof result.claudeDir === 'string');
    assert.ok(result.claudeDir.length > 0);
  });
});

describe('encodeProjectPath', () => {
  it('converts /DEV/foo to -DEV-foo', () => {
    assert.strictEqual(encodeProjectPath('/DEV/foo'), '-DEV-foo');
  });

  it('converts /home/user/proj to -home-user-proj', () => {
    assert.strictEqual(encodeProjectPath('/home/user/proj'), '-home-user-proj');
  });
});

describe('projectMemoryDir', () => {
  it('returns correct compound path', () => {
    assert.strictEqual(
      projectMemoryDir('/tmp/testhome', '/DEV/foo'),
      '/tmp/testhome/.claude/projects/-DEV-foo/memory'
    );
  });
});

describe('projectClaudeMd', () => {
  it('returns projectPath joined with CLAUDE.md', () => {
    assert.strictEqual(projectClaudeMd('/DEV/foo'), '/DEV/foo/CLAUDE.md');
    assert.strictEqual(projectClaudeMd('/home/user/proj'), '/home/user/proj/CLAUDE.md');
  });
});
