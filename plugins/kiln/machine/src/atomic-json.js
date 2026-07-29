'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { withLock } = require('./jsonl.js');

function writeAtomic(file, obj) {
  let serialized;
  try {
    serialized = JSON.stringify(obj, null, 2);
  } catch (err) {
    throw new TypeError(`atomic-json: cannot serialize object for ${file}: ${err.message}`);
  }
  if (typeof serialized !== 'string') {
    throw new TypeError(`atomic-json: value for ${file} is not JSON-serializable`);
  }

  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  // Unique, unpredictable temp name opened with 'wx': a fixed "<file>.tmp-<pid>"
  // name is guessable and collides across worker threads sharing a pid, and a
  // non-exclusive 'w' open follows a pre-planted symlink at that path instead
  // of refusing it. The random suffix plus O_CREAT|O_EXCL closes both.
  const tmpFile = path.join(
    dir,
    `.${path.basename(file)}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  );
  const fd = fs.openSync(tmpFile, 'wx');
  try {
    fs.writeSync(fd, serialized);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // Cleanup on a failed replacement (P11 Sol review finding 14): an EISDIR
  // (or any other renameSync failure — a permissions error, a cross-device
  // rename) previously left the temp file behind in the target directory
  // forever, since nothing after the write ever removed it on that path.
  // The temp file is still ours alone at this point (its unpredictable name
  // means no other writer could have raced to remove or replace it), so an
  // unconditional best-effort unlink on the throw path is safe; the
  // original error is what the caller sees either way.
  try {
    fs.renameSync(tmpFile, file);
  } catch (err) {
    fs.rmSync(tmpFile, { force: true });
    throw err;
  }
}

function readJson(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return fallback;
    }
    throw err;
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`atomic-json: failed to parse JSON at ${file}: ${err.message}`);
  }
}

// updateJson(file, fallback, updater) — a locked read-modify-write over ONE
// json file (P11 convergence finding 21: "no shared lock or generation
// comparison prevents two CLI invocations from atomically replacing each
// other's updates" — per-file atomic writes stop torn files, never lost
// updates). Takes jsonl.js's own single-writer lockfile discipline
// (`withLock` — exclusive create, stale-lock reclaim, bounded retry) rather
// than a second, parallel locking mechanism invented for JSON files (one
// native mechanism per constraint) — every caller sharing the SAME
// `file` path serializes through the SAME lock.
//
// `updater(current)` runs INSIDE the lock and must return the value to
// persist; `current` is `readJson(file, fallback)`'s own result, read fresh
// at this call's own turn holding the lock, never a value some earlier,
// pre-lock read could have gone stale by. `updater` may throw (a
// precondition failure, an already-closed state, a validation error) to
// abort the whole transaction: `writeAtomic` never runs, nothing on disk
// changes, and the lock still releases via `withLock`'s own `finally`. A
// caller that also needs to append a ledger event as part of the same
// transaction (phases.js's ledger-first ordering) does so FROM INSIDE
// `updater`, so the append and the eventual state write are both decided
// against the exact same locked read — never a stale decision made before
// the lock was taken.
function updateJson(file, fallback, updater) {
  if (typeof updater !== 'function') {
    throw new TypeError('atomic-json: updateJson requires an updater function');
  }
  return withLock(file, () => {
    const current = readJson(file, fallback);
    const next = updater(current);
    writeAtomic(file, next);
    return next;
  });
}

// CLI entrypoint. Deliberately NOT a generic "write <anyPath> <anyJson>"
// command — that would be exactly the unbounded write surface the stream
// registries elsewhere in this tree (kind-registry.js) refuse to expose.
// The one sanctioned command here is closed to plan-author's own three JSON
// artifacts (agents/plan-author.md's own table: criteria-register.json,
// milestones.json, artifact-map.json — the two markdown artifacts, plan.md
// and protocol-record.md, are plain prose written with the Write tool
// directly, never through this JSON writer). `dir` is either the canonical
// `architecture/` path or a Maximal-confrontation candidate's own
// `architecture/drafts/<slot>/` directory; `artifact` selects the FIXED
// basename — a caller can never name an arbitrary file, only one of these
// three.
const ARCHITECTURE_ARTIFACT_BASENAMES = Object.freeze({
  'criteria-register': 'criteria-register.json',
  milestones: 'milestones.json',
  'artifact-map': 'artifact-map.json',
});

// parseArgv fails closed on a surplus positional argument (P11 Sol review
// finding 13) — the same "every token is accounted for" discipline
// validators.js's own parseArgv already applies to an unrecognized flag.
function parseArgv(argv) {
  const [command, dir, artifact, ...rest] = argv;
  const error = rest.length > 0 ? `unexpected extra argument(s): ${rest.join(' ')}` : null;
  return { command, dir, artifact, error };
}

function main(argv) {
  const { command, dir, artifact, error } = parseArgv(argv);
  const knownArtifacts = Object.keys(ARCHITECTURE_ARTIFACT_BASENAMES);
  if (
    command !== 'write-architecture-artifact' ||
    typeof dir !== 'string' ||
    dir === '' ||
    !Object.prototype.hasOwnProperty.call(ARCHITECTURE_ARTIFACT_BASENAMES, artifact) ||
    error
  ) {
    if (error) process.stderr.write(`atomic-json.js: ${error}\n`);
    process.stderr.write(
      `usage: atomic-json.js write-architecture-artifact <dir> <${knownArtifacts.join('|')}>   (JSON body via stdin)\n`
    );
    process.exit(1);
  }
  try {
    const bodyText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (err) {
      throw new Error(`write-architecture-artifact: JSON body via stdin is not valid JSON: ${err.message}`);
    }
    const target = path.join(dir, ARCHITECTURE_ARTIFACT_BASENAMES[artifact]);
    writeAtomic(target, body);
    console.log(JSON.stringify({ written: target }, null, 2));
  } catch (err) {
    process.stderr.write(`atomic-json.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { writeAtomic, readJson, updateJson };
