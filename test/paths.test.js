const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { resolvePaths, encodeProjectPath, projectMemoryDir, projectClaudeMd } =
  require('../src/paths.js');

describe('resolvePaths', () => {
  it('with homeOverride returns correct paths', () => {
    const result = resolvePaths('/tmp/testhome');
    assert.strictEqual(result.claudeDir, path.join('/tmp/testhome', '.claude'));
    assert.strictEqual(result.agentsDir, path.join('/tmp/testhome', '.claude', 'agents'));
    assert.strictEqual(result.commandsDir, path.join('/tmp/testhome', '.claude', 'commands', 'kiln'));
    assert.strictEqual(result.kilntwoDir, path.join('/tmp/testhome', '.claude', 'kilntwo'));
    assert.strictEqual(result.hooksDir, path.join('/tmp/testhome', '.claude', 'kilntwo', 'hooks'));
    assert.strictEqual(result.preToolUseHooksDir, path.join('/tmp/testhome', '.claude', 'kilntwo', 'hooks', 'pre-tool-use'));
    assert.strictEqual(result.templatesDir, path.join('/tmp/testhome', '.claude', 'kilntwo', 'templates'));
    assert.strictEqual(result.manifestPath, path.join('/tmp/testhome', '.claude', 'kilntwo', 'manifest.json'));
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

  it('replaces Windows separators and invalid characters', () => {
    assert.strictEqual(
      encodeProjectPath('C:\\Users\\dev:team\\my*proj'),
      'C-Users-dev-team-my-proj'
    );
  });
});

describe('projectMemoryDir', () => {
  it('returns project-local .kiln memory path', () => {
    assert.strictEqual(
      projectMemoryDir('/tmp/testhome', '/DEV/foo'),
      path.join('/DEV/foo', '.kiln', 'memory')
    );
  });
});

describe('projectClaudeMd', () => {
  it('returns projectPath joined with CLAUDE.md', () => {
    assert.strictEqual(projectClaudeMd('/DEV/foo'), path.join('/DEV/foo', 'CLAUDE.md'));
    assert.strictEqual(projectClaudeMd('/home/user/proj'), path.join('/home/user/proj', 'CLAUDE.md'));
  });
});
