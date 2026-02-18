'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { install } = require('../src/install');
const { doctor } = require('../src/doctor');
const { resolvePaths } = require('../src/paths');
const { readManifest } = require('../src/manifest');

describe('doctor', () => {
  let tmpHome;
  let tmpProject;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-doctor-test-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-doctor-proj-'));
    install({ home: tmpHome, projectPath: tmpProject });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  it('strict mode passes checksums after a fresh install', () => {
    const result = doctor({ home: tmpHome, strict: true });
    const checksumCheck = result.checks.find((c) => c.name === 'checksums');
    assert.ok(checksumCheck, 'checksums check should be present');
    assert.strictEqual(
      checksumCheck.status,
      'pass',
      `expected checksums to pass, got: ${checksumCheck.message}`
    );
  });

  it('strict mode detects a modified file', () => {
    const paths = resolvePaths(tmpHome);
    const manifest = readManifest({ manifestPath: paths.manifestPath });

    assert.ok(manifest, 'manifest should exist after install');
    assert.ok(manifest.files.length > 0, 'manifest should have at least one file');

    // Tamper with the first file
    const firstFile = manifest.files[0];
    const absPath = path.join(paths.claudeDir, firstFile.path);
    fs.appendFileSync(absPath, '\n<!-- tampered -->');

    const result = doctor({ home: tmpHome, strict: true });
    const checksumCheck = result.checks.find((c) => c.name === 'checksums');
    assert.ok(checksumCheck, 'checksums check should be present');
    assert.strictEqual(checksumCheck.status, 'warn');
    assert.ok(checksumCheck.message.includes('1 of'));
  });

  it('non-strict mode skips checksums', () => {
    const result = doctor({ home: tmpHome, strict: false });
    const checksumCheck = result.checks.find((c) => c.name === 'checksums');
    assert.strictEqual(
      checksumCheck,
      undefined,
      'checksums check should not be present in non-strict mode'
    );
  });
});
