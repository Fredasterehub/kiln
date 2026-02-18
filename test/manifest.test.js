const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readManifest,
  writeManifest,
  computeChecksum,
  validateManifest,
} = require('../src/manifest.js');

const VALID_MANIFEST = {
  manifestVersion: 1,
  kilnVersion: '0.1.0',
  installedAt: new Date().toISOString(),
  files: [{ path: '/some/file.txt', checksum: 'sha256:abc123' }],
  protocolMarkers: {
    begin: '<!-- kiln:protocol:begin v0.1.0 -->',
    end: '<!-- kiln:protocol:end -->',
  },
};

describe('readManifest', () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-manifest-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns null for a non-existent manifest', () => {
    const result = readManifest(tmpHome);
    assert.strictEqual(result, null);
  });

  it('reads back a written manifest (round-trip via homeOverride string)', () => {
    writeManifest(VALID_MANIFEST, tmpHome);
    const result = readManifest(tmpHome);

    assert.strictEqual(result.manifestVersion, 1);
    assert.strictEqual(result.kilnVersion, '0.1.0');
  });

  it('accepts an object with manifestPath property', () => {
    writeManifest(VALID_MANIFEST, tmpHome);
    const manifestPath = path.join(tmpHome, '.claude', 'kilntwo', 'manifest.json');
    const result = readManifest({ manifestPath });

    assert.strictEqual(result.manifestVersion, 1);
  });
});

describe('writeManifest', () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-manifest-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('creates the kilntwo directory and writes manifest.json', () => {
    writeManifest(VALID_MANIFEST, tmpHome);
    const manifestPath = path.join(tmpHome, '.claude', 'kilntwo', 'manifest.json');

    assert.ok(fs.existsSync(manifestPath));

    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(parsed.kilnVersion, '0.1.0');
  });

  it('serializes with 2-space indentation', () => {
    writeManifest(VALID_MANIFEST, tmpHome);
    const manifestPath = path.join(tmpHome, '.claude', 'kilntwo', 'manifest.json');
    const raw = fs.readFileSync(manifestPath, 'utf8');

    assert.ok(raw.includes('  "manifestVersion"'));
  });
});

describe('computeChecksum', () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-manifest-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns a string in sha256:<hex> format', () => {
    const samplePath = path.join(tmpHome, 'sample.txt');
    fs.writeFileSync(samplePath, 'hello checksum');

    const checksum = computeChecksum(samplePath);

    assert.ok(checksum.startsWith('sha256:'));
    assert.strictEqual(checksum.slice('sha256:'.length).length, 64);
  });

  it('is deterministic - same file produces same checksum', () => {
    const samplePath = path.join(tmpHome, 'det.txt');
    fs.writeFileSync(samplePath, 'deterministic content');

    const first = computeChecksum(samplePath);
    const second = computeChecksum(samplePath);

    assert.strictEqual(first, second);
  });
});

describe('validateManifest', () => {
  it('returns valid: true for a valid manifest', () => {
    const result = validateManifest(VALID_MANIFEST);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('returns valid: false for null', () => {
    const result = validateManifest(null);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.includes('non-null object')));
  });

  it('reports error for missing manifestVersion', () => {
    const m = { ...VALID_MANIFEST, manifestVersion: undefined };
    assert.strictEqual(validateManifest(m).valid, false);
  });

  it('reports error for missing kilnVersion', () => {
    const m = { ...VALID_MANIFEST, kilnVersion: '' };
    assert.strictEqual(validateManifest(m).valid, false);
  });

  it('reports error for invalid installedAt', () => {
    const m = { ...VALID_MANIFEST, installedAt: 'not-a-date' };
    assert.strictEqual(validateManifest(m).valid, false);
  });

  it('reports per-entry error with index for a malformed files entry', () => {
    const m = {
      ...VALID_MANIFEST,
      files: [{ path: '/ok.txt', checksum: 'sha256:abc' }, null],
    };
    const result = validateManifest(m);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('files[1]')));
  });

  it('reports error when protocolMarkers is missing', () => {
    const { protocolMarkers: _, ...rest } = VALID_MANIFEST;
    const m = { ...rest, protocolMarkers: null };
    assert.strictEqual(validateManifest(m).valid, false);
  });

  it('reports error when protocolMarkers.begin is empty string', () => {
    const m = {
      ...VALID_MANIFEST,
      protocolMarkers: { begin: '', end: '<!-- kiln:protocol:end -->' },
    };
    assert.strictEqual(validateManifest(m).valid, false);
  });
});
