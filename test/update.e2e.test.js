'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { install } = require('../src/install');
const { update } = require('../src/update');
const { resolvePaths } = require('../src/paths');

function safeRm(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (_err) {
    // Best-effort cleanup only.
  }
}

describe('update E2E', { concurrency: false }, () => {
  let tmpHome;
  let tmpProject;
  let paths;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-test-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-test-'));
    paths = resolvePaths(tmpHome);
  });

  afterEach(() => {
    safeRm(tmpHome);
    safeRm(tmpProject);
  });

  it('does not overwrite manually edited files when force is false', async () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const editedPath = path.join(paths.agentsDir, 'kiln-debater.md');
    const editedContent = '# user edit\nthis file should survive update without force\n';
    fs.writeFileSync(editedPath, editedContent, 'utf8');

    const result = await update({ home: tmpHome, force: false });

    assert.strictEqual(
      fs.readFileSync(editedPath, 'utf8'),
      editedContent,
      'manual edits should be preserved by update without --force'
    );
    assert.strictEqual(Array.isArray(result.skipped), true);
    assert.ok(result.skipped.includes(editedPath), 'edited file should be reported as skipped');
  });

  it('reports updated and skipped files distinctly', async () => {
    install({ home: tmpHome, projectPath: tmpProject });

    const editedPath = path.join(paths.agentsDir, 'kiln-implementer.md');
    fs.writeFileSync(editedPath, '# user edit\n', 'utf8');

    const deletedPath = path.join(paths.commandsDir, 'start.md');
    fs.unlinkSync(deletedPath);

    const result = await update({ home: tmpHome, force: false });

    assert.strictEqual(Array.isArray(result.updated), true);
    assert.strictEqual(Array.isArray(result.skipped), true);
    assert.ok(result.updated.includes(deletedPath), 'deleted managed file should be restored and reported updated');
    assert.ok(result.skipped.includes(editedPath), 'edited managed file should be skipped');

    const sortedUpdated = [...result.updated].sort((a, b) => a.localeCompare(b));
    const sortedSkipped = [...result.skipped].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(result.updated, sortedUpdated, 'updated paths should be deterministic');
    assert.deepStrictEqual(result.skipped, sortedSkipped, 'skipped paths should be deterministic');
  });
});
