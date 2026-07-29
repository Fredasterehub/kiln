'use strict';

// Pointer shape is synthesis §2's literal spec ("atomic pointer:
// {active_config, digest}") — matches what machine/src/scaffold.js already
// writes into every scaffolded tree's routing/active.json, so this module
// interoperates with both the dev-repo's own machine/routing/ directory and
// every target project's .kiln/routing/ directory.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { readJson, writeAtomic } = require('./atomic-json.js');

const ACTIVE_FILENAME = 'active.json';
const SCHEMA_VERSION = 1;

// synthesis §7: "immutable dated configs (routing-YYYY-MM-DD-N.json, pointer
// rollback)" — this is the ONE place the filename shape is defined;
// scaffold.js imports it rather than keeping a second copy (anti-redundant-
// enforcement). Being a strict basename-only pattern (no path separators),
// it also structurally rejects traversal ('../x') and absolute/foreign
// targets by construction: anything matching this regex cannot escape the
// directory it is joined against.
const DATED_ROUTING_CONFIG_RE = /^routing-\d{4}-\d{2}-\d{2}-\d+\.json$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

const MISSING_POINTER = Symbol('routing.missing-pointer');
const MISSING_CONFIG = Symbol('routing.missing-config');

function activePointerPath(dirPath) {
  return path.join(dirPath, ACTIVE_FILENAME);
}

function sha256Of(buf) {
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

// Rejects a symlink target outright: an immutable dated config's whole point
// is that its bytes never change once written, and a symlink lets bytes
// change out from under a digest without ever touching the file the pointer
// nominally names.
function assertNotSymlink(targetPath, filename) {
  let lst;
  try {
    lst = fs.lstatSync(targetPath);
  } catch (err) {
    if (err.code === 'ENOENT') return; // caller's own readFileSync/stat reports the missing-file error
    throw err;
  }
  if (lst.isSymbolicLink()) {
    throw new Error(`routing: target "${filename}" is a symlink, which is not a permitted dated-config target`);
  }
}

// Validates the dated routing config's own minimal envelope: schema_version,
// an integer revision, and object-shaped seats/bans. Synthesis's own
// committed config (machine/routing/routing-YYYY-MM-DD-N.json) exercises
// this exact shape; the review flagged that revision/seats/bans previously
// went entirely unchecked at the read boundary.
function validateRoutingConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, errors: ['routing config must be a JSON object'] };
  }
  const errors = [];
  if (config.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (!Number.isInteger(config.revision)) errors.push('revision must be an integer');
  if (config.seats === null || typeof config.seats !== 'object' || Array.isArray(config.seats)) {
    errors.push('seats must be an object');
  }
  if (config.bans === null || typeof config.bans !== 'object' || Array.isArray(config.bans)) {
    errors.push('bans must be an object');
  }
  return { ok: errors.length === 0, errors };
}

// Reads the active.json pointer in dirPath and loads the dated config it
// names. Refuses (throws) rather than falling back to any default: an
// unpointed pointer, a dangling target, a digest mismatch, or a malformed
// config is a routing-directory defect, not a state this module papers
// over. The digest is now REQUIRED on every read (not merely checked when
// present) — an undated/undigested pointer used to load silently.
function loadRouting(dirPath) {
  const pointerPath = activePointerPath(dirPath);
  const pointer = readJson(pointerPath, MISSING_POINTER);
  if (pointer === MISSING_POINTER) {
    throw new Error(`routing: no active pointer found at ${pointerPath}`);
  }
  if (pointer === null || typeof pointer !== 'object' || Array.isArray(pointer)) {
    throw new Error(`routing: active pointer at ${pointerPath} must be a JSON object`);
  }
  if (pointer.schema_version !== SCHEMA_VERSION) {
    throw new Error(`routing: active pointer at ${pointerPath} must declare schema_version ${SCHEMA_VERSION}`);
  }

  const activeFile = pointer.active_config;
  if (typeof activeFile !== 'string' || activeFile === '') {
    throw new Error(`routing: active pointer at ${pointerPath} is missing a non-empty "active_config" filename`);
  }
  if (!DATED_ROUTING_CONFIG_RE.test(activeFile)) {
    throw new Error(
      `routing: active pointer at ${pointerPath} names "${activeFile}", which is not a valid routing-YYYY-MM-DD-N.json basename`
    );
  }

  if (typeof pointer.digest !== 'string' || !DIGEST_RE.test(pointer.digest)) {
    throw new Error(`routing: active pointer at ${pointerPath} is missing a valid "sha256:<hex>" digest`);
  }

  const configPath = path.join(dirPath, activeFile);
  assertNotSymlink(configPath, activeFile);

  let configRaw;
  try {
    configRaw = fs.readFileSync(configPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`routing: active pointer targets "${activeFile}", but ${configPath} does not exist`);
    }
    throw err;
  }

  const actualDigest = sha256Of(configRaw);
  if (actualDigest !== pointer.digest) {
    throw new Error(
      `routing: digest mismatch for "${activeFile}" — pointer records ${pointer.digest}, disk content hashes to ${actualDigest}`
    );
  }

  const config = readJson(configPath, MISSING_CONFIG);
  if (config === MISSING_CONFIG) {
    throw new Error(`routing: active pointer targets "${activeFile}", but ${configPath} does not exist`);
  }

  const { ok, errors } = validateRoutingConfig(config);
  if (!ok) {
    throw new Error(`routing: dated config "${activeFile}" failed schema validation: ${errors.join('; ')}`);
  }

  return { config, activeFile };
}

// Atomic pointer swap. Verifies the target dated config exists, is named per
// the immutable-dated-config pattern, and is not a symlink BEFORE writing
// the pointer, so a bad repoint can never leave active.json dangling; the
// dated config file itself is never edited (rollback = point elsewhere,
// never rewrite history). Recomputes the digest fresh from the target's
// current bytes on every swap.
function setActive(dirPath, filename) {
  if (typeof filename !== 'string' || filename === '') {
    throw new TypeError('routing: filename must be a non-empty string');
  }
  if (!DATED_ROUTING_CONFIG_RE.test(filename)) {
    throw new Error(`routing: "${filename}" is not a valid routing-YYYY-MM-DD-N.json basename`);
  }
  const targetPath = path.join(dirPath, filename);
  assertNotSymlink(targetPath, filename);

  let targetRaw;
  try {
    targetRaw = fs.readFileSync(targetPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`routing: cannot set active pointer — target "${filename}" does not exist at ${targetPath}`);
    }
    throw err;
  }
  writeAtomic(activePointerPath(dirPath), {
    schema_version: SCHEMA_VERSION,
    active_config: filename,
    digest: sha256Of(targetRaw),
  });
}

// CLI entrypoint (P11 finding F1: a shipped document had no lawful way to
// resolve the active dated config except a cwd-relative `node -e` require,
// which broke under the plugin layout). `active <dirPath>` is this module's
// one command, printing `loadRouting(dirPath)`'s own result — the resolved
// `activeFile` plus the dated config it points at — so a caller composes the
// absolute path to that file itself rather than this module guessing at one.
function parseArgv(argv) {
  const [command, dirPath] = argv;
  return { command, dirPath };
}

function main(argv) {
  const { command, dirPath } = parseArgv(argv);
  if (command !== 'active' || typeof dirPath !== 'string' || dirPath === '') {
    process.stderr.write('usage: routing.js active <dirPath>\n');
    process.exit(1);
  }
  try {
    const { config, activeFile } = loadRouting(dirPath);
    console.log(JSON.stringify({ activeFile, config }, null, 2));
  } catch (err) {
    process.stderr.write(`routing.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { loadRouting, setActive, validateRoutingConfig, ACTIVE_FILENAME, DATED_ROUTING_CONFIG_RE };
