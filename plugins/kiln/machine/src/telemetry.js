'use strict';

// Content-free usage stream: adaptive calibration. Local-only,
// opt-in, refuses to run under any condition that could leak the stream off
// the machine or into git history. Every write goes through
// ./stream.js#appendRecord so the common JSONL header (schema_version, seq,
// kind, ts, correlation_id) is identical to every other stream in the tree.
//
// EVENT_KINDS below is a module-owned, CLOSED registry: a caller-supplied
// allowlist would let any caller invent any kind and write arbitrary
// values, up to and including code/prompt/argv/env content. A caller may
// only write one of the kinds named here; every field of every kind
// carries a fixed, narrow value domain (short identifiers drawn from
// closed enums, bounded numbers, booleans — never free text, never a
// nested object/array); every kind names the consumer that reads it — no
// consumer, no event. Error paths never interpolate caller-supplied
// content into a thrown message or log line — only registry-owned strings
// (a validated kind, a schema-owned field name) are ever echoed back.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const stream = require('./stream.js');

const MONTH_FILE_RE = /^events-\d{4}-\d{2}\.jsonl$/;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const USAGE_DIRNAME = 'usage';
const CORRELATION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// --- field-value domain validators (registry building blocks) -----------
// Every validator returns a boolean and is total (never throws) so it is
// safe to call on arbitrary, adversarial caller input.

const IDENT_RE = /^[a-z][a-z0-9_]{0,63}$/;

function isIdent(v) {
  return typeof v === 'string' && IDENT_RE.test(v);
}

function isBool(v) {
  return typeof v === 'boolean';
}

function isNonNegInt(v) {
  return Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
}

function isBoundedNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9;
}

function inSet(set) {
  return (v) => typeof v === 'string' && set.has(v);
}

const MODEL_IDS = new Set(['opus-5', 'sonnet-5', 'fable-5', 'gpt-5.6-sol']);
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh']);
const PLANNING_PROTOCOLS = new Set(['standard', 'deep_scrutiny', 'maximal_confrontation']);
const PLAN_WINNERS = new Set(['claude', 'sol']);
const REVIEW_SCOPES = new Set(['chunk', 'milestone']);
const JOURNEY_OUTCOMES = new Set(['pass', 'fail', 'quarantined']);

// The closed registry. Every kind: a fixed field set (name -> validator)
// and the consumer that reads it — run/phase transitions, per-seat usage,
// planning-selection winners, review pass counts, journey results,
// delivery summaries.
const EVENT_KINDS = Object.freeze({
  phase_transition: Object.freeze({
    consumer: 'maintenance workflow: phase-duration / routing-config aggregation',
    fields: Object.freeze({ from: isIdent, to: isIdent }),
  }),
  seat_usage: Object.freeze({
    consumer: 'maintenance workflow: per-seat cost and routing-config aggregation',
    fields: Object.freeze({
      seat: isIdent,
      model: inSet(MODEL_IDS),
      effort: inSet(EFFORT_LEVELS),
      tokens_in: isNonNegInt,
      tokens_out: isNonNegInt,
      cost_usd: isBoundedNumber,
    }),
  }),
  planning_selection: Object.freeze({
    consumer: 'planning-bet calibration (declared-bet honesty)',
    fields: Object.freeze({ protocol: inSet(PLANNING_PROTOCOLS), winner: inSet(PLAN_WINNERS) }),
  }),
  review_pass: Object.freeze({
    consumer: 'maintenance workflow: review-reinforcement calibration',
    fields: Object.freeze({ scope: inSet(REVIEW_SCOPES), pass_count: isNonNegInt, agreement_pass: isBool }),
  }),
  journey_result: Object.freeze({
    consumer: 'maintenance workflow: flake-rate and quarantine calibration',
    fields: Object.freeze({ outcome: inSet(JOURNEY_OUTCOMES), retry_count: isNonNegInt }),
  }),
  delivery_summary: Object.freeze({
    consumer: 'last-mile calibration (delivered-scope honesty)',
    fields: Object.freeze({ last_mile_count: isNonNegInt }),
  }),
});

function monthFile(usageDir, when = new Date()) {
  const stamp = when.toISOString().slice(0, 7); // 'YYYY-MM'
  return path.join(usageDir, `events-${stamp}.jsonl`);
}

// Walks up from a possibly-nonexistent path to the nearest ancestor that
// does exist, so a git check can run with a valid cwd even before
// usageDir has ever been created on disk.
function nearestExistingAncestor(dirPath) {
  let dir = path.resolve(dirPath);
  for (;;) {
    if (fs.existsSync(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return dir; // reached filesystem root without finding one
    dir = parent;
  }
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

// True when usageDir is unsafe to write telemetry into: either it is a git
// repo where the path is already tracked in the index, or it is a git repo
// where the path is NOT covered by .gitignore (so a future `git add` could
// pick it up). Outside any git repo entirely, there is nothing to refuse.
// A missing git binary fails closed (treated as unsafe) — refusing telemetry
// on an unverifiable environment is the privacy-conscious default.
function isGitUnsafe(usageDir) {
  const cwd = nearestExistingAncestor(usageDir);

  const repoCheck = git(['rev-parse', '--is-inside-work-tree'], cwd);
  if (repoCheck.error && repoCheck.error.code === 'ENOENT') {
    return true; // git unavailable — cannot verify safety, refuse
  }
  if (repoCheck.status !== 0 || repoCheck.stdout.trim() !== 'true') {
    return false; // not inside a git repo at all — nothing to refuse
  }

  const lsFiles = git(['ls-files', '--error-unmatch', usageDir], cwd);
  if (lsFiles.status === 0) return true; // already tracked in the index

  // A trailing separator tells git-check-ignore to match this path as a
  // directory even when it does not yet exist on disk (a bare path with no
  // trailing slash and nothing on disk is ambiguous to a directory-only
  // gitignore pattern like ".kiln/usage/").
  const dirPath = usageDir.endsWith(path.sep) ? usageDir : usageDir + path.sep;
  const checkIgnore = git(['check-ignore', '-q', dirPath], cwd);
  if (checkIgnore.status !== 0) return true; // not covered by .gitignore

  return false; // gitignore-covered, not tracked — safe
}

// Recognized as evidence the process runs inside SOME CI/build/agent-runner
// environment. Presence of the key (any value) counts, matching the "CI"
// convention's own any-value semantics. CODEX_CI is this runtime's own
// marker — a session can run with CODEX_CI=1 and CI unset, and telemetry
// must never record under that condition — named explicitly rather than
// left to a generic list.
const CI_ENV_MARKERS = Object.freeze([
  'CI',
  'CONTINUOUS_INTEGRATION',
  'CODEX_CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'TRAVIS',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'APPVEYOR',
  'BUILDKITE',
  'DRONE',
  'TF_BUILD',
  'CODEBUILD_BUILD_ID',
  'NETLIFY',
  'VERCEL',
  'RENDER',
  'CIRRUS_CI',
  'SEMAPHORE',
  'BUDDY',
  'BITBUCKET_BUILD_NUMBER',
]);

function isCI() {
  return CI_ENV_MARKERS.some((key) => key in process.env);
}

// enabled(usageDir, settings) -> {enabled, reason}
// reason is null when enabled, otherwise one of:
//   'consent'       settings.telemetry_consent !== true
//   'do_not_track'  process.env.DO_NOT_TRACK is set (any value)
//   'ci'            any recognized CI/build-runner env marker is set
//   'git_tracked'   usageDir is git-tracked or not gitignore-covered
function enabled(usageDir, settings) {
  if (typeof usageDir !== 'string' || usageDir === '') {
    throw new TypeError('telemetry: usageDir must be a non-empty string');
  }
  const s = isPlainObject(settings) ? settings : {};

  if (s.telemetry_consent !== true) {
    return { enabled: false, reason: 'consent' };
  }
  if ('DO_NOT_TRACK' in process.env) {
    return { enabled: false, reason: 'do_not_track' };
  }
  if (isCI()) {
    return { enabled: false, reason: 'ci' };
  }
  if (isGitUnsafe(usageDir)) {
    return { enabled: false, reason: 'git_tracked' };
  }
  return { enabled: true, reason: null };
}

// Creates the month file at FILE_MODE (0600) if it does not exist yet — the
// mode argument to the creating open() call is applied atomically at
// creation, so there is no window where the file exists at a permissive,
// umask-derived mode before this call returns: appending content first and
// chmod'ing afterward would leave exactly that window open. Since 0600 has
// no group/other bits, umask can only ever
// narrow it further, never widen it, so the mode is always exactly 0600
// regardless of the process umask. If the file already exists, repairs its
// mode and refuses a non-regular or symlink target rather than writing
// content through it.
function ensureSecureFile(file) {
  let lst;
  try {
    lst = fs.lstatSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const fd = fs.openSync(file, 'wx', FILE_MODE);
    fs.closeSync(fd);
    return;
  }
  if (lst.isSymbolicLink()) {
    throw new Error('telemetry: refusing to write the usage stream through a symlink target');
  }
  if (!lst.isFile()) {
    throw new Error('telemetry: usage stream target exists and is not a regular file');
  }
  fs.chmodSync(file, FILE_MODE);
}

// Rejects a symlinked usageDir the same fail-closed way ensureSecureFile
// (above) already rejects a symlinked month file: a pre-planted
// `.kiln/usage -> /tmp/outside` symlink would otherwise let recordEvent's
// mkdirSync/chmodSync/append pass straight through it, since mkdirSync's
// own recursive:true is a no-op on an already-existing path and never
// checks whether that path is a symlink — the month file it then wrote
// would sit inside the symlink's REAL target directory as a plain,
// non-symlinked file, so ensureSecureFile's own per-file check would never
// see anything to refuse. Checked BEFORE usageDir is ever created,
// chmod'd, or joined against, the same "secure before any content lands"
// ordering ensureSecureFile holds for the file one level down.
function ensureSecureUsageDir(usageDir) {
  let lst;
  try {
    lst = fs.lstatSync(usageDir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return; // does not exist yet — mkdirSync below creates a real directory
  }
  if (lst.isSymbolicLink()) {
    throw new Error('telemetry: refusing to write the usage stream through a symlinked usage directory');
  }
  if (!lst.isDirectory()) {
    throw new Error('telemetry: usage directory target exists and is not a real directory');
  }
}

// recordEvent(usageDir, settings, evt) -> {recorded, reason?, seq?, file?}
// evt = { kind, payload, correlation_id }. kind must be one of the closed
// EVENT_KINDS registry above; payload must supply EXACTLY that kind's
// declared field set (no more, no fewer), every value passing its
// registered validator; correlation_id must be null or a short identifier.
// Payload shape is validated FIRST and unconditionally (a caller passing an
// unregistered kind or an out-of-domain value is a programmer error, not a
// consent decision) — then the write itself only happens when
// enabled(usageDir, settings) is true.
function recordEvent(usageDir, settings, evt) {
  if (!isPlainObject(evt)) {
    throw new TypeError('telemetry: evt must be an object');
  }
  const { kind } = evt;
  const payload = evt.payload === undefined ? {} : evt.payload;
  const correlation_id = evt.correlation_id === undefined ? null : evt.correlation_id;

  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_KINDS, kind)) {
    throw new TypeError('telemetry: evt.kind must be one of the registered event kinds');
  }
  const schema = EVENT_KINDS[kind];

  if (!isPlainObject(payload)) {
    throw new TypeError(`telemetry: evt.payload must be a plain object for kind "${kind}"`);
  }
  const declaredFields = Object.keys(schema.fields).sort();
  const suppliedFields = Object.keys(payload).sort();
  const fieldsMatch =
    declaredFields.length === suppliedFields.length && declaredFields.every((f, i) => f === suppliedFields[i]);
  if (!fieldsMatch) {
    throw new TypeError(
      `telemetry: evt.payload for kind "${kind}" must supply exactly these fields: ${declaredFields.join(', ') || '(none)'}`
    );
  }
  for (const field of declaredFields) {
    if (!schema.fields[field](payload[field])) {
      throw new TypeError(`telemetry: evt.payload.${field} for kind "${kind}" failed its value-domain check`);
    }
  }

  if (correlation_id !== null && !(typeof correlation_id === 'string' && CORRELATION_ID_RE.test(correlation_id))) {
    throw new TypeError('telemetry: evt.correlation_id must be null or a short identifier string');
  }

  const gate = enabled(usageDir, settings);
  if (!gate.enabled) {
    return { recorded: false, reason: gate.reason };
  }

  ensureSecureUsageDir(usageDir);
  fs.mkdirSync(usageDir, { recursive: true, mode: DIR_MODE });
  fs.chmodSync(usageDir, DIR_MODE);

  const file = monthFile(usageDir);
  ensureSecureFile(file); // secure BEFORE any content lands, every time
  const seq = stream.appendRecord(file, { kind, payload, correlation_id });

  return { recorded: true, seq, file };
}

// purge(usageDir) -> {removed: [filenames]} — deletes only recognized usage
// stream files (events-YYYY-MM.jsonl) directly inside usageDir. Never
// recursive, never touches the directory itself or any other entry inside
// it (a lockfile, an unrelated file, a subdirectory), and refuses outright
// unless usageDir's own basename is "usage": purge must never recursively
// remove whatever directory string it is handed with no check that it is
// the intended target. A no-op (not an error) when nothing was there.
function purge(usageDir) {
  if (typeof usageDir !== 'string' || usageDir === '') {
    throw new TypeError('telemetry: usageDir must be a non-empty string');
  }
  if (path.basename(usageDir) !== USAGE_DIRNAME) {
    throw new Error(`telemetry: purge refuses a directory not named "${USAGE_DIRNAME}"`);
  }
  if (!fs.existsSync(usageDir)) {
    return { removed: [] };
  }
  const dirStat = fs.lstatSync(usageDir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new Error('telemetry: purge refuses a usage directory that is a symlink or not a real directory');
  }

  const removed = [];
  for (const name of fs.readdirSync(usageDir)) {
    if (!MONTH_FILE_RE.test(name)) continue;
    const target = path.join(usageDir, name);
    const targetStat = fs.lstatSync(target);
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) continue; // never follow/remove non-regular entries
    fs.unlinkSync(target);
    removed.push(name);
  }
  return { removed };
}

// status(usageDir, settings) -> {enabled, reason, files, totalBytes}
// Inspection always works regardless of the current enabled state — an
// operator disabling telemetry must still be able to see (and then purge)
// what was recorded while it was on.
function status(usageDir, settings) {
  const gate = enabled(usageDir, settings);
  let files = [];
  if (fs.existsSync(usageDir)) {
    files = fs
      .readdirSync(usageDir)
      .filter((name) => MONTH_FILE_RE.test(name))
      .map((name) => ({ name, bytes: fs.statSync(path.join(usageDir, name)).size }));
  }
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  return { enabled: gate.enabled, reason: gate.reason, files, totalBytes };
}

// CLI entrypoint: six documented call sites name function-level calls
// against this module, so it needs a require.main guard and an executable
// form to switch to. Two commands, both taking `usageDir` and the project's own
// `settings.json` content as a literal JSON-string argument, matching every
// other machine-layer CLI's convention: `enabled` prints `enabled()`'s own
// result; `record` reads the event JSON from stdin (the judge-verdict.js
// stdin pattern) and prints `recordEvent()`'s own result. `purge`/`status`
// stay library-only — neither is named by any shipped instruction site.
function main(argv) {
  const [command, usageDir, settingsJsonText] = argv;
  if ((command !== 'enabled' && command !== 'record') || typeof usageDir !== 'string' || usageDir === '') {
    process.stderr.write("usage: telemetry.js <enabled|record> <usageDir> '<settingsJson>'   (record also reads the event JSON via stdin)\n");
    process.exit(1);
  }
  try {
    let settings = {};
    if (typeof settingsJsonText === 'string' && settingsJsonText !== '') {
      settings = JSON.parse(settingsJsonText);
    }
    let result;
    if (command === 'enabled') {
      result = enabled(usageDir, settings);
    } else {
      const evtText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
      const evt = JSON.parse(evtText);
      result = recordEvent(usageDir, settings, evt);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`telemetry.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { enabled, recordEvent, purge, status, EVENT_KINDS };
