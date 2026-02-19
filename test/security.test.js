'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { uninstall } = require('../src/uninstall');
const { update } = require('../src/update');
const { doctor } = require('../src/doctor');
const { validateManifest, writeManifest } = require('../src/manifest');

function safeRm(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (_err) {
    // Do not mask test failures with cleanup failures.
  }
}

function writePoisonedManifest(tmpHome, maliciousPath) {
  const data = {
    manifestVersion: 1,
    kilnVersion: '0.1.0',
    installedAt: new Date().toISOString(),
    files: [{ path: maliciousPath, checksum: 'sha256:abc123' }],
    protocolMarkers: { begin: 'kiln:protocol:begin', end: 'kiln:protocol:end' },
  };
  writeManifest(data, tmpHome);
}

describe('security: path traversal', { concurrency: false }, () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-sec-'));
  });

  afterEach(() => {
    safeRm(tmpHome);
  });

  it('uninstall rejects manifest with ../../.ssh/config path', () => {
    writePoisonedManifest(tmpHome, '../../.ssh/config');
    assert.throws(
      () => uninstall({ home: tmpHome }),
      (err) => err.message.includes('path traversal'),
    );
  });

  it('uninstall rejects manifest with ../outside path', () => {
    writePoisonedManifest(tmpHome, '../outside');
    assert.throws(
      () => uninstall({ home: tmpHome }),
      (err) => err.message.includes('path traversal') || err.message.includes('Invalid manifest'),
    );
  });

  it('update rejects manifest with ../outside path', async () => {
    writePoisonedManifest(tmpHome, '../outside');
    await assert.rejects(
      () => update({ home: tmpHome }),
      (err) => err.message.includes('path traversal') || err.message.includes('Invalid manifest'),
    );
  });

  it('doctor rejects manifest with ../outside path in strict mode', () => {
    writePoisonedManifest(tmpHome, '../outside');
    const result = doctor({ home: tmpHome, strict: true });
    assert.strictEqual(result.ok, false);
    const checksumCheck = result.checks.find((c) => c.name === 'checksums');
    assert.ok(checksumCheck, 'expected a checksums check');
    assert.strictEqual(checksumCheck.status, 'fail');
    assert.ok(checksumCheck.message.includes('invalid'), `expected "invalid" in message, got: ${checksumCheck.message}`);
  });
});

describe('security: validateManifest rejects .. paths', () => {
  it('rejects files with .. segment', () => {
    const data = {
      manifestVersion: 1,
      kilnVersion: '0.1.0',
      installedAt: new Date().toISOString(),
      files: [{ path: '../../etc/passwd', checksum: 'sha256:abc' }],
      protocolMarkers: { begin: 'kiln:protocol:begin', end: 'kiln:protocol:end' },
    };
    const result = validateManifest(data);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('path traversal')));
  });

  it('accepts clean file paths', () => {
    const data = {
      manifestVersion: 1,
      kilnVersion: '0.1.0',
      installedAt: new Date().toISOString(),
      files: [{ path: 'kilntwo/templates/MEMORY.md', checksum: 'sha256:abc' }],
      protocolMarkers: { begin: 'kiln:protocol:begin', end: 'kiln:protocol:end' },
    };
    const result = validateManifest(data);
    assert.strictEqual(result.valid, true);
  });
});
