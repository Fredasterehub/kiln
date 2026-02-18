'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('src/index.js (package entry point)', () => {
  it('exports all expected high-level functions', () => {
    const mod = require('../src/index');
    const expectedFunctions = [
      'install', 'uninstall', 'update', 'doctor',
      'resolvePaths', 'encodeProjectPath', 'projectMemoryDir', 'projectClaudeMd',
      'readManifest', 'writeManifest', 'computeChecksum', 'validateManifest',
      'insertProtocol', 'replaceProtocol', 'removeProtocol', 'hasProtocol', 'extractVersion',
    ];

    for (const name of expectedFunctions) {
      assert.strictEqual(typeof mod[name], 'function', `expected ${name} to be a function`);
    }
  });

  it('does not throw on require', () => {
    assert.doesNotThrow(() => require('../src/index'));
  });
});
