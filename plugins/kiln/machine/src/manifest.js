'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { writeAtomic } = require('./atomic-json.js');

const SCHEMA_VERSION = 1;
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

// The binding schema: {schema_version, revision, artifacts:[{path,
// digest:"sha256:..."}], created_at}. check-honesty's gate cross-check
// enforces this exact shape.

// The five substantive architecture artifacts a manifest.json digests
// (the full canonical artifact set, minus manifest.json and gate.json
// themselves). manifest.json and gate.json are the approval MACHINERY, not
// the approved content: gate.json's own `manifest_digest` field is what
// binds gate<->manifest, so manifest.json cannot also digest gate.json's
// bytes without a self-referential hash cycle (gate needs manifest's digest;
// manifest would need gate's digest; neither can be computed first). This
// canonical five-path set is shared with check-honesty.js's post-architecture
// cross-check and scaffold.js's phase-4 sealing operation — one source of
// truth, per the anti-redundant-enforcement rule.
const CANONICAL_ARCHITECTURE_ARTIFACTS = [
  'plan.md',
  'criteria-register.json',
  'milestones.json',
  'artifact-map.json',
  'protocol-record.md',
];

function sha256Of(filePath) {
  const buf = fs.readFileSync(filePath);
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

// assertSafeRelPath(relPath) — rejects an absolute path or any ".."/""
// segment before it is ever joined against baseDir: an unchecked relative
// path (e.g. a bare `../outside.txt`) would otherwise reach
// fs.statSync/fs.readFileSync directly. Same posix-normalize-then-check
// discipline anonymize.js's own assertSafeRelPath already applies to its
// own untrusted relPath entries.
function assertSafeRelPath(relPath) {
  if (typeof relPath !== 'string' || relPath === '') {
    throw new TypeError('manifest: every relPath must be a non-empty string');
  }
  const posixRel = relPath.split(path.sep).join('/');
  if (path.posix.isAbsolute(posixRel)) {
    throw new Error(`manifest: relPath must be relative, got absolute path "${relPath}"`);
  }
  if (posixRel.split('/').some((segment) => segment === '..' || segment === '')) {
    throw new Error(`manifest: relPath must not contain ".." or empty segments (got "${relPath}")`);
  }
}

// realpathOfPossiblyMissing(p) — same "resolve what exists, reattach the
// rest literally" helper anonymize.js's own copy already documents in full;
// duplicated here rather than imported, since these two modules share no
// other dependency and doctrine rule 6's "one native mechanism per
// constraint" binds a single INVARIANT, not a shared utility function across
// unrelated modules.
function realpathOfPossiblyMissing(p) {
  const abs = path.resolve(p);
  const suffix = [];
  let existing = abs;
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  return suffix.length > 0 ? path.join(realExisting, ...suffix) : realExisting;
}

// assertContained(baseReal, targetPath, relPath) — refuses a relPath whose
// real (symlink-resolved) location falls outside baseReal, catching a
// pre-planted symlinked path component even when relPath itself carries no
// "..".
function assertContained(baseReal, targetPath, relPath) {
  const targetReal = realpathOfPossiblyMissing(targetPath);
  const rel = path.relative(baseReal, targetReal);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`manifest: relPath "${relPath}" resolves outside baseDir (via ".." or a symlink)`);
  }
}

// manifestArtifactsDigest(manifest) — a single sha256 digest over ONLY a
// manifest's `artifacts` array (path+digest pairs), never its `revision` or
// `created_at`. Maximal confrontation's slot-assignment step needs "each
// candidate's own manifest digest" to be a pure function of that
// candidate's five FILES — no wall-clock time, fully replayable from the
// same two draft directories on a second run (product/architecture/flow.md
// step 5; machine/src/slot-assignment.js's own header comment). Hashing the
// whole manifest object would break that: `created_at` is
// `new Date().toISOString()` at build time, so two builds of byte-identical
// candidate content would otherwise get two different "manifest digests"
// depending on when buildManifest happened to run.
function manifestArtifactsDigest(manifest) {
  if (manifest === null || typeof manifest !== 'object' || !Array.isArray(manifest.artifacts)) {
    throw new TypeError('manifest: manifestArtifactsDigest requires a manifest object with an "artifacts" array');
  }
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(manifest.artifacts)).digest('hex')}`;
}

// {schema_version, revision, artifacts:[{path, digest}], created_at} over an
// explicit declared set of relative paths. Never scans baseDir for what
// "counts" — the caller declares exactly which files belong to the manifest.
function buildManifest(baseDir, relPaths, revision) {
  if (typeof baseDir !== 'string' || baseDir === '') {
    throw new TypeError('manifest: baseDir must be a non-empty string');
  }
  if (!Array.isArray(relPaths)) {
    throw new TypeError('manifest: relPaths must be an array of relative paths');
  }

  const baseReal = fs.realpathSync(baseDir);
  const artifacts = [];
  for (const relPath of relPaths) {
    assertSafeRelPath(relPath);
    const abs = path.join(baseDir, relPath);
    assertContained(baseReal, abs, relPath);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      throw new Error(`manifest: declared path is not a regular file: ${relPath}`);
    }
    artifacts.push({ path: relPath, digest: sha256Of(abs) });
  }

  return {
    schema_version: SCHEMA_VERSION,
    revision: Number.isInteger(revision) ? revision : 1,
    artifacts,
    created_at: new Date().toISOString(),
  };
}

function writeManifest(baseDir, relPaths, outFile, revision) {
  const manifest = buildManifest(baseDir, relPaths, revision);
  writeAtomic(outFile, manifest);
  return manifest;
}

// A manifest artifact entry is only trustworthy as a declaration if it is
// exactly the {path, digest} shape buildManifest produces; anything else
// (missing field, extra field, malformed digest) can't be verified against
// disk and is reported as "extra-declared" rather than silently skipped or
// crashing the whole check.
function isValidEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const keys = Object.keys(entry);
  if (keys.length !== 2) return false;
  if (typeof entry.path !== 'string' || entry.path === '') return false;
  if (typeof entry.digest !== 'string' || !SHA256_DIGEST_RE.test(entry.digest)) return false;
  return true;
}

// Checks ONLY the artifacts declared in manifestObj.artifacts against
// baseDir — never scans baseDir for undeclared additions. drift reasons:
//   missing         declared file no longer exists on disk (or is no longer
//                   a regular file)
//   changed         declared file exists but its digest differs
//   duplicate       the same path is declared more than once (a duplicate
//                   entry could otherwise be used to mask a shrunk manifest
//                   while presenting a longer artifacts array)
//   extra-declared  the manifest's own entry for this file is malformed (not
//                   a strict {path, digest} pair) and cannot be verified as
//                   a legitimate declaration
function verifyManifest(baseDir, manifestObj) {
  if (typeof baseDir !== 'string' || baseDir === '') {
    throw new TypeError('manifest: baseDir must be a non-empty string');
  }
  if (
    manifestObj === null ||
    typeof manifestObj !== 'object' ||
    Array.isArray(manifestObj) ||
    !Array.isArray(manifestObj.artifacts)
  ) {
    throw new TypeError('manifest: manifestObj must be an object with an "artifacts" array');
  }

  const drift = [];
  const seenPaths = new Set();
  for (const entry of manifestObj.artifacts) {
    if (!isValidEntry(entry)) {
      const label = entry !== null && typeof entry === 'object' && typeof entry.path === 'string' ? entry.path : '(unknown)';
      drift.push({ file: label, reason: 'extra-declared' });
      continue;
    }

    const relPath = entry.path;
    if (seenPaths.has(relPath)) {
      drift.push({ file: relPath, reason: 'duplicate' });
      continue;
    }
    seenPaths.add(relPath);

    const abs = path.join(baseDir, relPath);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (err) {
      if (err.code === 'ENOENT') {
        drift.push({ file: relPath, reason: 'missing' });
        continue;
      }
      throw err;
    }
    if (!stat.isFile()) {
      drift.push({ file: relPath, reason: 'missing' });
      continue;
    }

    const actualDigest = sha256Of(abs);
    if (actualDigest !== entry.digest) {
      drift.push({ file: relPath, reason: 'changed' });
    }
  }

  return { ok: drift.length === 0, drift };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// assertCanonicalRelPathSet(relPaths) — the Maximal-confrontation call edge:
// `build-manifest` is only ever invoked, per `agents/maestro.md`'s Bash law
// point 1 and `product/architecture/flow.md` step 5, over a candidate's own
// draft directory with EXACTLY the five canonical content artifacts
// declared — never a caller-chosen subset. A shrunk `relPaths` set would
// let slot assignment (and the judge's own review) proceed as a function
// of fewer than all five finished candidate artifacts, silently. Enforced
// HERE, at the CLI edge, rather than inside `buildManifest` itself —
// `buildManifest` stays a general-purpose digesting primitive
// (plan-gate.js's own `writeManifest` calls it with the same canonical
// set, and a caller may exercise it directly with deliberately
// shrunk/expanded sets to prove `verifyManifest`'s own drift detection) —
// this is the one call site with a closed, known-in-advance candidate set
// to check the caller's claim against.
function assertCanonicalRelPathSet(relPaths) {
  if (new Set(relPaths).size !== relPaths.length) {
    throw new Error('manifest: build-manifest relPaths must not contain a duplicate entry');
  }
  const declared = [...relPaths].sort();
  const canonical = [...CANONICAL_ARCHITECTURE_ARTIFACTS].sort();
  const isCanonicalSet = declared.length === canonical.length && declared.every((p, i) => p === canonical[i]);
  if (!isCanonicalSet) {
    throw new Error(
      `manifest: build-manifest relPaths must be exactly the canonical architecture artifact set (${canonical.join(', ')}) — got: ${declared.join(', ') || '(empty)'}`
    );
  }
}

// CLI entrypoint: Maximal confrontation's own mechanical mid-protocol
// steps — product/architecture/flow.md step 5 calls buildManifest against
// each candidate's own draft directory to derive the digest
// slot-assignment.js's assignPlanSlot needs. `build-manifest <baseDir>`
// reads `{relPaths, revision?}` via stdin and prints
// `{manifest, manifest_digest}` — `manifest_digest` is
// manifestArtifactsDigest(manifest), the same content-only digest
// assign-plan-slot expects, computed here so a caller never has to
// re-derive it a second way.
//
// parseArgv fails closed on a surplus positional argument — the same
// "every token is accounted for" discipline validators.js's own parseArgv
// already applies to an unrecognized flag.
function parseArgv(argv) {
  const [command, baseDir, ...rest] = argv;
  const error = rest.length > 0 ? `unexpected extra argument(s): ${rest.join(' ')}` : null;
  return { command, baseDir, error };
}

function main(argv) {
  const { command, baseDir, error } = parseArgv(argv);
  if (command !== 'build-manifest' || typeof baseDir !== 'string' || baseDir === '' || error) {
    if (error) process.stderr.write(`manifest.js: ${error}\n`);
    process.stderr.write('usage: manifest.js build-manifest <baseDir>   ({relPaths, revision?} JSON via stdin)\n');
    process.exit(1);
  }
  try {
    const inputText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
    let input;
    try {
      input = JSON.parse(inputText);
    } catch (err) {
      throw new Error(`build-manifest: input JSON via stdin is not valid JSON: ${err.message}`);
    }
    if (!isPlainObject(input) || !Array.isArray(input.relPaths)) {
      throw new Error('build-manifest: input JSON via stdin must be an object with a "relPaths" array');
    }
    assertCanonicalRelPathSet(input.relPaths);
    const manifest = buildManifest(baseDir, input.relPaths, input.revision);
    const manifest_digest = manifestArtifactsDigest(manifest);
    console.log(JSON.stringify({ manifest, manifest_digest }, null, 2));
  } catch (err) {
    process.stderr.write(`manifest.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  buildManifest,
  writeManifest,
  verifyManifest,
  manifestArtifactsDigest,
  CANONICAL_ARCHITECTURE_ARTIFACTS,
  SHA256_DIGEST_RE,
};
