'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { spawnSync } = require('node:child_process');

const {
  buildManifest,
  writeManifest,
  verifyManifest,
  manifestArtifactsDigest,
  CANONICAL_ARCHITECTURE_ARTIFACTS,
} = require('../src/manifest.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'manifest.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
}

function sha256(buf) {
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

// ---------- buildManifest ----------

test('buildManifest computes a sha256 digest for every declared relPath', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), '# plan\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'gate.json'), JSON.stringify({ approved: true }));

  const manifest = buildManifest(dir, ['plan.md', path.join('sub', 'gate.json')]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.revision, 1);
  assert.equal(typeof manifest.created_at, 'string');
  assert.ok(!Number.isNaN(Date.parse(manifest.created_at)));

  const planBuf = fs.readFileSync(path.join(dir, 'plan.md'));
  const gateBuf = fs.readFileSync(path.join(dir, 'sub', 'gate.json'));
  const byPath = Object.fromEntries(manifest.artifacts.map((a) => [a.path, a.digest]));
  assert.equal(byPath['plan.md'], sha256(planBuf));
  assert.equal(byPath[path.join('sub', 'gate.json')], sha256(gateBuf));
});

test('buildManifest accepts an explicit revision', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');
  const manifest = buildManifest(dir, ['plan.md'], 3);
  assert.equal(manifest.revision, 3);
});

test('buildManifest defaults revision to 1 when not an integer', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');
  const manifest = buildManifest(dir, ['plan.md'], 'nope');
  assert.equal(manifest.revision, 1);
});

test('buildManifest throws when a declared relPath does not exist', () => {
  const dir = mkTmpDir();
  assert.throws(() => buildManifest(dir, ['missing.md']));
});

test('buildManifest throws when a declared relPath is a directory, not a file', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, 'adir'));
  assert.throws(() => buildManifest(dir, ['adir']), /not a regular file/);
});

test('buildManifest throws TypeError for a non-array relPaths', () => {
  const dir = mkTmpDir();
  assert.throws(() => buildManifest(dir, 'plan.md'), TypeError);
});

test('buildManifest on an empty relPaths list produces an empty artifacts array', () => {
  const dir = mkTmpDir();
  const manifest = buildManifest(dir, []);
  assert.deepEqual(manifest.artifacts, []);
});

// ---------- writeManifest ----------

test('writeManifest writes the manifest atomically to outFile and returns it', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');
  const outFile = path.join(dir, 'manifest.json');

  const manifest = writeManifest(dir, ['plan.md'], outFile);
  const onDisk = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.deepEqual(onDisk, manifest);
  assert.ok(onDisk.artifacts[0].digest.startsWith('sha256:'));
});

// ---------- verifyManifest ----------

function manifestFor(dir, relPaths) {
  return buildManifest(dir, relPaths);
}

test('verifyManifest reports ok:true and empty drift when disk matches the manifest exactly', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');
  const manifest = manifestFor(dir, ['plan.md']);

  const result = verifyManifest(dir, manifest);
  assert.deepEqual(result, { ok: true, drift: [] });
});

test('verifyManifest reports "missing" drift for a declared file removed from disk', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');
  const manifest = manifestFor(dir, ['plan.md']);
  fs.rmSync(path.join(dir, 'plan.md'));

  const result = verifyManifest(dir, manifest);
  assert.equal(result.ok, false);
  assert.deepEqual(result.drift, [{ file: 'plan.md', reason: 'missing' }]);
});

test('verifyManifest reports "changed" drift when file content differs from the declared digest', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');
  const manifest = manifestFor(dir, ['plan.md']);
  fs.writeFileSync(path.join(dir, 'plan.md'), 'DIFFERENT content');

  const result = verifyManifest(dir, manifest);
  assert.equal(result.ok, false);
  assert.deepEqual(result.drift, [{ file: 'plan.md', reason: 'changed' }]);
});

test('verifyManifest reports "missing" drift when a declared file becomes a directory', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');
  const manifest = manifestFor(dir, ['plan.md']);
  fs.rmSync(path.join(dir, 'plan.md'));
  fs.mkdirSync(path.join(dir, 'plan.md'));

  const result = verifyManifest(dir, manifest);
  assert.equal(result.ok, false);
  assert.equal(result.drift[0].file, 'plan.md');
  assert.equal(result.drift[0].reason, 'missing');
});

test('verifyManifest reports "extra-declared" for a malformed manifest entry (not a strict {path,digest} shape)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');

  const badManifest = {
    schema_version: 1,
    revision: 1,
    created_at: new Date().toISOString(),
    artifacts: [{ path: 'plan.md', digest: 'not-a-real-digest' }],
  };
  const result = verifyManifest(dir, badManifest);
  assert.equal(result.ok, false);
  assert.deepEqual(result.drift, [{ file: 'plan.md', reason: 'extra-declared' }]);
});

test('verifyManifest reports "duplicate" drift when the same path is declared twice', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');
  const manifest = manifestFor(dir, ['plan.md']);
  manifest.artifacts.push({ ...manifest.artifacts[0] });

  const result = verifyManifest(dir, manifest);
  assert.equal(result.ok, false);
  assert.deepEqual(result.drift, [{ file: 'plan.md', reason: 'duplicate' }]);
});

test('verifyManifest ignores files present on disk but not declared in the manifest (only checks declared files)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), 'content');
  fs.writeFileSync(path.join(dir, 'undeclared.md'), 'not in manifest');
  const manifest = manifestFor(dir, ['plan.md']);

  const result = verifyManifest(dir, manifest);
  assert.deepEqual(result, { ok: true, drift: [] });
});

test('verifyManifest reports drift for multiple declared files independently', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'a.md'), 'a');
  fs.writeFileSync(path.join(dir, 'b.md'), 'b');
  fs.writeFileSync(path.join(dir, 'c.md'), 'c');
  const manifest = manifestFor(dir, ['a.md', 'b.md', 'c.md']);

  fs.rmSync(path.join(dir, 'a.md'));
  fs.writeFileSync(path.join(dir, 'b.md'), 'CHANGED');

  const result = verifyManifest(dir, manifest);
  assert.equal(result.ok, false);
  const byFile = Object.fromEntries(result.drift.map((d) => [d.file, d.reason]));
  assert.equal(byFile['a.md'], 'missing');
  assert.equal(byFile['b.md'], 'changed');
  assert.equal(byFile['c.md'], undefined);
});

test('verifyManifest throws TypeError when manifestObj has no "artifacts" array', () => {
  const dir = mkTmpDir();
  assert.throws(() => verifyManifest(dir, { schema_version: 1 }), TypeError);
  assert.throws(() => verifyManifest(dir, null), TypeError);
});

// ---------- CANONICAL_ARCHITECTURE_ARTIFACTS ----------

test('CANONICAL_ARCHITECTURE_ARTIFACTS names exactly the five substantive (non manifest/gate) architecture artifacts', () => {
  assert.deepEqual(
    [...CANONICAL_ARCHITECTURE_ARTIFACTS].sort(),
    ['artifact-map.json', 'criteria-register.json', 'milestones.json', 'plan.md', 'protocol-record.md'].sort()
  );
});

// ---------- manifestArtifactsDigest (P11 convergence finding 4 — Maximal
// confrontation's slot-assignment.js needs a content-only, wall-clock-free
// digest per candidate) ----------

test('manifestArtifactsDigest is a sha256:<hex> digest over ONLY the artifacts array', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'a.md'), 'a');
  const manifest = buildManifest(dir, ['a.md']);
  const digest = manifestArtifactsDigest(manifest);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(digest, `sha256:${crypto.createHash('sha256').update(JSON.stringify(manifest.artifacts)).digest('hex')}`);
});

test('manifestArtifactsDigest is identical across two rebuilds of byte-identical content, despite different created_at', async () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'a.md'), 'same content');
  const first = buildManifest(dir, ['a.md']);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = buildManifest(dir, ['a.md']);
  assert.notEqual(first.created_at, second.created_at); // proves the timestamps really did differ
  assert.equal(manifestArtifactsDigest(first), manifestArtifactsDigest(second));
});

test('manifestArtifactsDigest changes when a declared file\'s content changes', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'a.md'), 'v1');
  const before = manifestArtifactsDigest(buildManifest(dir, ['a.md']));
  fs.writeFileSync(path.join(dir, 'a.md'), 'v2');
  const after = manifestArtifactsDigest(buildManifest(dir, ['a.md']));
  assert.notEqual(before, after);
});

test('manifestArtifactsDigest throws TypeError for a non-manifest input', () => {
  assert.throws(() => manifestArtifactsDigest(null), TypeError);
  assert.throws(() => manifestArtifactsDigest({}), TypeError);
});

// ---------- CLI: build-manifest ----------
//
// The CLI edge enforces the canonical five-artifact set (P11 Sol review
// finding 10) — every CLI-level test below declares exactly
// CANONICAL_ARCHITECTURE_ARTIFACTS as its relPaths, using the shared
// architecture fixture, rather than an arbitrary single-file set; the
// library-level `buildManifest` tests above keep exercising arbitrary sets
// directly, since that enforcement lives only at this CLI boundary.

const { writeValidContentArtifacts } = require('./fixtures/valid-architecture-artifacts.js');

test('CLI: build-manifest prints {manifest, manifest_digest} matching the library calls', () => {
  const dir = mkTmpDir();
  writeValidContentArtifacts(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest', dir], {
    encoding: 'utf8',
    input: JSON.stringify({ relPaths: CANONICAL_ARCHITECTURE_ARTIFACTS }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  const expectedManifest = buildManifest(dir, CANONICAL_ARCHITECTURE_ARTIFACTS);
  assert.deepEqual(printed.manifest.artifacts, expectedManifest.artifacts);
  assert.equal(printed.manifest_digest, manifestArtifactsDigest(expectedManifest));
});

test('CLI: build-manifest honors an explicit revision', () => {
  const dir = mkTmpDir();
  writeValidContentArtifacts(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest', dir], {
    encoding: 'utf8',
    input: JSON.stringify({ relPaths: CANONICAL_ARCHITECTURE_ARTIFACTS, revision: 3 }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(JSON.parse(proc.stdout).manifest.revision, 3);
});

test('CLI: build-manifest exits 1 for a missing declared file', () => {
  const dir = mkTmpDir();
  writeValidContentArtifacts(dir);
  fs.rmSync(path.join(dir, 'plan.md'));
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest', dir], {
    encoding: 'utf8',
    input: JSON.stringify({ relPaths: CANONICAL_ARCHITECTURE_ARTIFACTS }),
  });
  assert.equal(proc.status, 1);
});

test('CLI: build-manifest exits 1 on invalid JSON via stdin', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest', dir], { encoding: 'utf8', input: 'not json' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^manifest\.js: /);
});

test('CLI: build-manifest exits 1 when "relPaths" is missing', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest', dir], { encoding: 'utf8', input: '{}' });
  assert.equal(proc.status, 1);
});

test('CLI: missing baseDir prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: manifest\.js/);
});

test('CLI: a surplus positional argument is refused (P11 Sol review finding 13)', () => {
  const dir = mkTmpDir();
  writeValidContentArtifacts(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest', dir, 'extra'], {
    encoding: 'utf8',
    input: JSON.stringify({ relPaths: CANONICAL_ARCHITECTURE_ARTIFACTS }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /unexpected extra argument/);
});

// ---------- containment + canonical-set enforcement (P11 Sol review pass-2
// defect 10) ----------

test('buildManifest refuses a "../outside.txt" relPath rather than digesting the outside file', () => {
  const parent = mkTmpDir();
  const dir = path.join(parent, 'arch');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(parent, 'outside.txt'), 'not part of this candidate\n');
  assert.throws(() => buildManifest(dir, ['../outside.txt']), /\.\./);
});

test('buildManifest refuses a symlinked path component that escapes baseDir', () => {
  const parent = mkTmpDir();
  const dir = path.join(parent, 'arch');
  fs.mkdirSync(dir);
  const outsideDir = path.join(parent, 'outside');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'secret.md'), 'secret\n');
  fs.symlinkSync(outsideDir, path.join(dir, 'linked'));
  assert.throws(() => buildManifest(dir, [path.join('linked', 'secret.md')]), /resolves outside/);
});

test('buildManifest refuses an absolute relPath', () => {
  const dir = mkTmpDir();
  const outside = path.join(mkTmpDir(), 'outside.txt');
  fs.writeFileSync(outside, 'content\n');
  assert.throws(() => buildManifest(dir, [outside]), /relative/);
});

test('CLI: build-manifest refuses a shrunk relPaths set (fewer than the canonical five)', () => {
  const dir = mkTmpDir();
  writeValidContentArtifacts(dir);
  const shrunk = CANONICAL_ARCHITECTURE_ARTIFACTS.filter((p) => p !== 'plan.md');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest', dir], {
    encoding: 'utf8',
    input: JSON.stringify({ relPaths: shrunk }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /canonical architecture artifact set/);
});

test('CLI: build-manifest refuses an expanded relPaths set (an extra path beyond the canonical five)', () => {
  const dir = mkTmpDir();
  writeValidContentArtifacts(dir);
  fs.writeFileSync(path.join(dir, 'extra.md'), 'not canonical\n');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest', dir], {
    encoding: 'utf8',
    input: JSON.stringify({ relPaths: [...CANONICAL_ARCHITECTURE_ARTIFACTS, 'extra.md'] }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /canonical architecture artifact set/);
});

test('CLI: build-manifest refuses a duplicate relPaths entry', () => {
  const dir = mkTmpDir();
  writeValidContentArtifacts(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'build-manifest', dir], {
    encoding: 'utf8',
    input: JSON.stringify({ relPaths: [...CANONICAL_ARCHITECTURE_ARTIFACTS, 'plan.md'] }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /duplicate entry/);
});
