'use strict';

// Phase-sequencing state machine (plan.md P2: "modular phase registry").
// The eight ruled pipeline phases (onboarding, brainstorm, research,
// architecture, plan_gate, implementation, verification, delivery) are DATA
// in machine/phases-registry.json (synthesis §2/§4's restart-anytime
// boundary table gives the entry/exit artifact lists) — this module only
// walks that data: it never hard-codes a phase name or an artifact path.
// treeRoot throughout is the `.kiln` directory itself (not the
// project root); entry_requires/exit_emits are relpaths within it, matching
// the registry's own doc comment.

const fs = require('node:fs');
const path = require('node:path');

const { readJson, updateJson } = require('./atomic-json.js');
const { appendRecord, readRecords } = require('./stream.js');
const { verifyArchitectureGateApproved } = require('./check-honesty.js');

const MISSING_STATE = Symbol('phases.missing-state');

// Named, registry-declarable semantic entry checks (P2 review [blocker] #1
// and [major] #5's sibling concern: a bare file-presence check cannot tell
// an approved gate from a rejected/reopened/digest-drifted one). phases.js
// still never hard-codes a PHASE name or artifact PATH — the registry
// decides which phase, if any, declares "architecture-gate-approved" in its
// entry_checks — but it does own this finite, named vocabulary of checks it
// knows how to run, the same way the dev-side replay harness owns a finite
// OPS vocabulary of op names without hard-coding which scenario calls them.
const SEMANTIC_CHECKS = {
  'architecture-gate-approved': (treeRoot) => verifyArchitectureGateApproved(path.join(treeRoot, 'architecture')),
};

// Named, registry-declarable EXIT checks (P4 Sol review MAJOR #5: fail-closed
// crystallization existed only as prompt behavior, not as a phase gate —
// exit_emits' own missingRelpaths mechanism only proves a path exists, never
// that its content means what a phase transition claims it means). Each
// registry entry_checks name a phase-wide fact; each exit_checks entry names
// a fact about ONE specific file, so the vocabulary here takes (absPath,
// param) rather than (treeRoot) — a small, finite, colon-parameterized set,
// the same "phases.js owns a finite named vocabulary, never a phase-specific
// one-off" shape SEMANTIC_CHECKS already established.
// latestRunId(treeRoot) -> {ok:true, runId} | {ok:false, reason} — reads
// verification/runs-index.json (verification.js's own startRun, the sole
// writer, records every started run in order) and returns its own latest
// entry's run_id. This is the ONE place "what is the current suite run"
// gets derived from disk; suite-state-green and run-bound (below) both
// cross-check their own citation against this SAME answer instead of each
// re-deriving "is this really the latest run" a second way (doctrine rule 6
// / one native mechanism per constraint). Extracted from
// suite-state-green's own P8 required-revision-#2 run-currency logic
// verbatim — run-bound (P9 Sol review BLOCKING #1: "readiness accepts stale
// delivery projections from an older run") needed the identical judgment
// for a file that is never itself suite-state.json.
function latestRunId(treeRoot) {
  const runsIndexPath = path.join(treeRoot, 'verification', 'runs-index.json');
  let content;
  try {
    content = fs.readFileSync(runsIndexPath, 'utf8');
  } catch (err) {
    return { ok: false, reason: `${runsIndexPath} could not be read: ${err.message}` };
  }
  let runsIndex;
  try {
    runsIndex = JSON.parse(content);
  } catch (err) {
    return { ok: false, reason: `${runsIndexPath} is not valid JSON: ${err.message}` };
  }
  if (!isPlainObject(runsIndex) || !Array.isArray(runsIndex.runs) || runsIndex.runs.length === 0) {
    return { ok: false, reason: `${runsIndexPath} must declare a non-empty "runs" array` };
  }
  const latest = runsIndex.runs[runsIndex.runs.length - 1];
  const latestId = isPlainObject(latest) ? latest.run_id : undefined;
  if (typeof latestId !== 'string' || latestId === '') {
    return { ok: false, reason: `${runsIndexPath}'s latest run entry carries no non-empty "run_id"` };
  }
  return { ok: true, runId: latestId };
}

const EXIT_CHECK_KINDS = {
  // jsonl-sealed: the file's last record has kind "sealed". A missing file
  // or an empty stream both fail closed (zero records is never "sealed").
  'jsonl-sealed': (absPath) => {
    const { records } = readRecords(absPath);
    if (records.length === 0) {
      return { ok: false, reason: `${absPath} has no records` };
    }
    const last = records[records.length - 1];
    if (!isPlainObject(last) || last.kind !== 'sealed') {
      return { ok: false, reason: `${absPath}'s last record is not kind "sealed"` };
    }
    return { ok: true };
  },
  // jsonl-min-records:<n> — at least n records whose kind is not "genesis".
  // scaffold.js seeds every product JSONL stream with a genesis record at
  // tree-scaffold time, before any phase runs, so bare file-existence (or a
  // record count that includes that seed) can never distinguish "this phase
  // never ran" from "this phase ran and produced real records" — the same
  // reasoning flow.md's crystallizer section already documents.
  'jsonl-min-records': (absPath, param) => {
    const n = Number(param);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`phases: exit check "jsonl-min-records:${param}" has a malformed count`);
    }
    const { records } = readRecords(absPath);
    const nonGenesis = records.filter((r) => isPlainObject(r) && r.kind !== 'genesis');
    if (nonGenesis.length < n) {
      return {
        ok: false,
        reason: `${absPath} carries ${nonGenesis.length} non-genesis record(s), fewer than the required ${n}`,
      };
    }
    return { ok: true };
  },
  // file-nonempty: the file exists and has non-whitespace content. Used for
  // prose artifacts (e.g. vision.md) that are not JSON/JSONL and so cannot
  // be checked by either of the two checks above.
  'file-nonempty': (absPath) => {
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (err) {
      return { ok: false, reason: `${absPath} could not be read: ${err.message}` };
    }
    if (content.trim().length === 0) {
      return { ok: false, reason: `${absPath} is empty` };
    }
    return { ok: true };
  },
  // jsonl-has-kind:<kind> — at least one non-genesis record whose kind
  // matches <kind> (P5 fix pass, Sol review's auditability finding: a gate
  // decision that only ever lived in a worker's own prompt behavior left no
  // machine-checkable trace that it ran). Deliberately presence-of-evidence,
  // not truth-of-evidence, the same boundary jsonl-min-records already
  // draws: this proves a record of the named kind exists, never that its
  // payload's decision was itself correct — that remains the authoring
  // agent's attested responsibility, not something phases.js can verify.
  'jsonl-has-kind': (absPath, param) => {
    if (typeof param !== 'string' || param === '') {
      throw new Error(`phases: exit check "jsonl-has-kind:${param}" requires a non-empty kind`);
    }
    const { records } = readRecords(absPath);
    const hasMatch = records.some((r) => isPlainObject(r) && r.kind === param);
    if (!hasMatch) {
      return {
        ok: false,
        reason: `${absPath} carries no non-genesis record with kind "${param}"`,
      };
    }
    return { ok: true };
  },
  // milestones-all-green: the implementation phase's own exit floor (P7
  // build instruction; machine/src/milestones.js's closeMilestone is the
  // sole writer of a milestone entry's "green" status). Reads
  // milestones/index.json and requires a non-empty "milestones" array whose
  // every entry currently reports status "green" — a milestone left
  // "open" (never closed) fails the check exactly like a missing/malformed
  // index does, the same fail-closed posture file-nonempty and
  // jsonl-min-records already take on an empty/absent artifact.
  'milestones-all-green': (absPath) => {
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (err) {
      return { ok: false, reason: `${absPath} could not be read: ${err.message}` };
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return { ok: false, reason: `${absPath} is not valid JSON: ${err.message}` };
    }
    if (!isPlainObject(parsed) || !Array.isArray(parsed.milestones)) {
      return { ok: false, reason: `${absPath} must be an object with a "milestones" array` };
    }
    if (parsed.milestones.length === 0) {
      return { ok: false, reason: `${absPath} declares zero milestones — nothing has closed yet` };
    }
    const notGreen = parsed.milestones.filter((m) => !isPlainObject(m) || m.status !== 'green');
    if (notGreen.length > 0) {
      const ids = notGreen.map((m) => (isPlainObject(m) && typeof m.id === 'string' ? m.id : '?')).join(', ');
      return { ok: false, reason: `${absPath} has ${notGreen.length} milestone(s) not status "green" (${ids})` };
    }
    return { ok: true };
  },
  // suite-state-green: the verification phase's own exit floor (ruled:
  // "suite decides done"). Reads verification/suite-state.json (the sole
  // output of machine/src/verification.js's computeSuiteState) and requires
  // status === "green" with a non-empty run_id — a missing file, malformed
  // JSON, absent run_id, or any status other than "green" (including a
  // stale/never-computed file, or one quarantine.js's own recordOutcome/
  // release marked "stale" after a quarantine mutation — P8 required
  // revision #5) fails closed, the same posture milestones-all-green
  // already takes on an absent/open index.
  //
  // Run currency (P8 required revision #2): a green snapshot is only
  // trustworthy if it is the LATEST run, not merely A green run from
  // earlier in the pass — a probe that selects an old, still-green
  // suite-state.json while a newer run has since gone red must not pass
  // here. latestRunId(treeRoot) (above) is the shared "what is the current
  // run" derivation over verification/runs-index.json; this check requires
  // the persisted run_id to equal that same answer, rejecting a stale green
  // the same way it already rejects a stale status.
  'suite-state-green': (absPath, _param, treeRoot) => {
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (err) {
      return { ok: false, reason: `${absPath} could not be read: ${err.message}` };
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return { ok: false, reason: `${absPath} is not valid JSON: ${err.message}` };
    }
    if (!isPlainObject(parsed)) {
      return { ok: false, reason: `${absPath} must be a JSON object` };
    }
    if (typeof parsed.run_id !== 'string' || parsed.run_id === '') {
      return { ok: false, reason: `${absPath} "run_id" must be a non-empty string` };
    }
    if (parsed.status !== 'green') {
      return { ok: false, reason: `${absPath} "status" is ${JSON.stringify(parsed.status)}, not "green"` };
    }

    const latest = latestRunId(treeRoot);
    if (!latest.ok) {
      return latest;
    }
    if (latest.runId !== parsed.run_id) {
      return {
        ok: false,
        reason: `${absPath} "run_id" (${JSON.stringify(parsed.run_id)}) is not the latest run in ${path.join(treeRoot, 'verification', 'runs-index.json')} (latest is ${JSON.stringify(latest.runId)}) — stale green rejected`,
      };
    }
    return { ok: true };
  },
  // run-bound (P9 required revision #1; P9 Sol review BLOCKING #1: "readiness
  // accepts stale delivery projections from an older run"). A delivery
  // projection (delivery/last-mile.json, delivery/facts.json) that was
  // assembled/rendered against an OLDER run must not read as current just
  // because it once carried a legitimate run id — this check requires the
  // file's own top-level "generated_from_run" to equal the SAME current-run
  // identity suite-state-green establishes above (latestRunId(treeRoot),
  // never a second "what is current" derivation — doctrine rule 6, one
  // native mechanism per constraint). A missing file, unparseable JSON, and a missing/empty
  // generated_from_run all fail closed here too — the same posture
  // file-nonempty already takes on presence, so a passing run-bound check
  // subsumes it (a phase declaring run-bound on a file no longer also needs
  // a separate file-nonempty check for that same file).
  'run-bound': (absPath, _param, treeRoot) => {
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (err) {
      return { ok: false, reason: `${absPath} could not be read: ${err.message}` };
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return { ok: false, reason: `${absPath} is not valid JSON: ${err.message}` };
    }
    if (!isPlainObject(parsed)) {
      return { ok: false, reason: `${absPath} must be a JSON object` };
    }
    if (typeof parsed.generated_from_run !== 'string' || parsed.generated_from_run === '') {
      return { ok: false, reason: `${absPath} "generated_from_run" must be a non-empty string` };
    }

    const latest = latestRunId(treeRoot);
    if (!latest.ok) {
      return latest;
    }
    if (parsed.generated_from_run !== latest.runId) {
      return {
        ok: false,
        reason: `${absPath} "generated_from_run" (${JSON.stringify(parsed.generated_from_run)}) is not the latest run in ${path.join(treeRoot, 'verification', 'runs-index.json')} (latest is ${JSON.stringify(latest.runId)}) — stale projection rejected`,
      };
    }
    return { ok: true };
  },
};

// "jsonl-min-records:1" -> { kind: 'jsonl-min-records', param: '1' };
// "jsonl-sealed" -> { kind: 'jsonl-sealed', param: null }.
function parseExitCheckName(name) {
  const colonIdx = name.indexOf(':');
  if (colonIdx === -1) return { kind: name, param: null };
  return { kind: name.slice(0, colonIdx), param: name.slice(colonIdx + 1) };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => isNonEmptyString(v));
}

// A well-formed, contained relative path: no absolute paths, no backslashes
// (a Windows-style separator would silently misjoin on a POSIX host), and no
// '.'/'..'/empty segments (traversal, no-ops, or doubled separators). Every
// registry entry_requires/exit_emits value is later joined against treeRoot
// (missingRelpaths/relpathExists) without further checking, so this is the
// one place that join is proven safe — a malformed or replaced registry can
// never point readiness at a file outside `.kiln/` (P2 review
// [major] #5).
function isContainedRelpath(value) {
  if (!isNonEmptyString(value)) return false;
  if (path.isAbsolute(value)) return false;
  if (value.includes('\\')) return false;
  const segments = value.split('/');
  return segments.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function isRelpathArray(value) {
  return Array.isArray(value) && value.every((v) => isContainedRelpath(v));
}

// Validates one phase entry's shape. Returns a list of error strings (empty
// when valid) rather than throwing, so loadRegistry can report every
// malformed entry in one pass instead of stopping at the first.
function validatePhaseShape(phase, index) {
  const errors = [];
  const where = `phases[${index}]`;
  if (!isPlainObject(phase)) {
    return [`${where}: must be an object`];
  }
  if (!isNonEmptyString(phase.id)) errors.push(`${where}: "id" must be a non-empty string`);
  if (!Number.isInteger(phase.order) || phase.order < 1) {
    errors.push(`${where}: "order" must be a positive integer`);
  }
  if (!isNonEmptyString(phase.title)) errors.push(`${where}: "title" must be a non-empty string`);
  if (typeof phase.interactive !== 'boolean') errors.push(`${where}: "interactive" must be a boolean`);
  if (!isRelpathArray(phase.entry_requires)) {
    errors.push(
      `${where}: "entry_requires" must be an array of contained relative path strings (no absolute paths, no ".."/"." segments)`
    );
  }
  if (!isRelpathArray(phase.exit_emits)) {
    errors.push(
      `${where}: "exit_emits" must be an array of contained relative path strings (no absolute paths, no ".."/"." segments)`
    );
  }
  // entry_checks is OPTIONAL (defaults to none) and, unlike entry_requires/
  // exit_emits, names semantic checks rather than paths — every name must be
  // a key phases.js actually knows how to run (SEMANTIC_CHECKS), so a typo
  // or a check retired from this module fails registry load instead of
  // silently never running.
  if (Object.prototype.hasOwnProperty.call(phase, 'entry_checks')) {
    if (!isStringArray(phase.entry_checks)) {
      errors.push(`${where}: "entry_checks" must be an array of non-empty strings when present`);
    } else {
      for (const name of phase.entry_checks) {
        if (!Object.prototype.hasOwnProperty.call(SEMANTIC_CHECKS, name)) {
          errors.push(`${where}: "entry_checks" names unknown check "${name}" (known checks: ${Object.keys(SEMANTIC_CHECKS).join(', ')})`);
        }
      }
    }
  }
  // exit_checks is OPTIONAL (defaults to none) and pairs a specific file
  // with a check name from EXIT_CHECK_KINDS (P4 Sol review MAJOR #5) — each
  // entry is {file, check}, file a contained relpath (the same discipline
  // entry_requires/exit_emits use), check's kind (before an optional
  // ":param") a key EXIT_CHECK_KINDS actually knows how to run.
  if (Object.prototype.hasOwnProperty.call(phase, 'exit_checks')) {
    if (!Array.isArray(phase.exit_checks)) {
      errors.push(`${where}: "exit_checks" must be an array when present`);
    } else {
      phase.exit_checks.forEach((entry, i) => {
        const entryWhere = `${where}.exit_checks[${i}]`;
        if (!isPlainObject(entry)) {
          errors.push(`${entryWhere}: must be an object`);
          return;
        }
        if (!isContainedRelpath(entry.file)) {
          errors.push(`${entryWhere}: "file" must be a contained relative path string`);
        }
        if (!isNonEmptyString(entry.check)) {
          errors.push(`${entryWhere}: "check" must be a non-empty string`);
        } else {
          const { kind } = parseExitCheckName(entry.check);
          if (!Object.prototype.hasOwnProperty.call(EXIT_CHECK_KINDS, kind)) {
            errors.push(
              `${entryWhere}: "check" names unknown check "${entry.check}" (known checks: ${Object.keys(EXIT_CHECK_KINDS).join(', ')})`
            );
          }
        }
      });
    }
  }
  // Every phase is restart-anytime resumable by construction (synthesis §4);
  // a phase that declared otherwise would be a registry authoring defect,
  // not a variant this machine tolerates.
  if (phase.resumable !== true) errors.push(`${where}: "resumable" must be true`);
  return errors;
}

// loadRegistry(registryPath) — reads, validates, and orders the phase
// registry. Fails closed on any shape defect: unknown/duplicate ids,
// non-contiguous or duplicate "order" values, or a malformed phase entry all
// throw rather than returning a partially-usable registry.
function loadRegistry(registryPath) {
  if (!isNonEmptyString(registryPath)) {
    throw new TypeError('phases: registryPath must be a non-empty string');
  }

  let raw;
  try {
    raw = fs.readFileSync(registryPath, 'utf8');
  } catch (err) {
    throw new Error(`phases: could not read registry at ${registryPath}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`phases: registry at ${registryPath} is not valid JSON: ${err.message}`);
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.phases)) {
    throw new Error(`phases: registry at ${registryPath} must be an object with a "phases" array`);
  }
  if (parsed.schema_version !== 1) {
    throw new Error(`phases: registry at ${registryPath} must declare schema_version 1`);
  }
  if (parsed.phases.length === 0) {
    throw new Error(`phases: registry at ${registryPath} declares zero phases`);
  }

  const shapeErrors = [];
  parsed.phases.forEach((phase, index) => {
    shapeErrors.push(...validatePhaseShape(phase, index));
  });
  if (shapeErrors.length > 0) {
    throw new Error(`phases: registry at ${registryPath} is malformed: ${shapeErrors.join('; ')}`);
  }

  const ids = new Set();
  const orders = new Set();
  for (const phase of parsed.phases) {
    if (ids.has(phase.id)) {
      throw new Error(`phases: registry at ${registryPath} declares duplicate phase id "${phase.id}"`);
    }
    ids.add(phase.id);
    if (orders.has(phase.order)) {
      throw new Error(`phases: registry at ${registryPath} declares duplicate order ${phase.order}`);
    }
    orders.add(phase.order);
  }

  // "order" must be a contiguous 1..N sequence — no gaps, no phase skipped
  // by a typo, no room for two disjoint registries to silently interleave.
  const n = parsed.phases.length;
  for (let expected = 1; expected <= n; expected++) {
    if (!orders.has(expected)) {
      throw new Error(`phases: registry at ${registryPath} has a non-contiguous "order" sequence (missing ${expected})`);
    }
  }

  const phases = [...parsed.phases].sort((a, b) => a.order - b.order);
  return { schema_version: parsed.schema_version, phases };
}

function findPhase(registry, phaseId) {
  const phase = registry.phases.find((p) => p.id === phaseId);
  if (!phase) {
    const known = registry.phases.map((p) => p.id).join(', ');
    throw new Error(`phases: unknown phase id "${phaseId}" (known phases: ${known})`);
  }
  return phase;
}

// currentPhase(stateObj) — reads the `phase` field state.json carries as
// THE resume pointer (synthesis §2). Deliberately reads a plain object, not
// a file path: callers that already hold state in memory (e.g. advance(),
// mid-transaction) never re-read disk to ask what phase they are in.
function currentPhase(stateObj) {
  if (!isPlainObject(stateObj)) {
    throw new TypeError('phases: currentPhase() requires a state object');
  }
  if (!isNonEmptyString(stateObj.phase)) {
    throw new Error('phases: state object has no valid "phase" field');
  }
  return stateObj.phase;
}

function relpathExists(treeRoot, relPath) {
  const abs = path.join(treeRoot, relPath);
  try {
    return fs.statSync(abs).isFile();
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

function missingRelpaths(treeRoot, relPaths) {
  return relPaths.filter((relPath) => !relpathExists(treeRoot, relPath));
}

// runExitChecks(treeRoot, exitChecks) -> string[] of failure descriptions
// ("<check>: <reason>"), empty when every check passes. Each entry's `file`
// is resolved against treeRoot with the same join `relpathExists` uses;
// treeRoot itself is also passed through to checkFn (not just the resolved
// absPath) because a check like run-bound must locate a SECOND, fixed-
// location file (verification/suite-state.json + runs-index.json) to
// establish "current run" — the same reason latestRunId(treeRoot) above
// takes treeRoot rather than a path already resolved to one specific file.
function runExitChecks(treeRoot, exitChecks) {
  const failures = [];
  for (const entry of exitChecks || []) {
    const { kind, param } = parseExitCheckName(entry.check);
    const checkFn = EXIT_CHECK_KINDS[kind];
    const absPath = path.join(treeRoot, entry.file);
    const { ok, reason } = checkFn(absPath, param, treeRoot);
    if (!ok) failures.push(`${entry.check} (${entry.file}): ${reason}`);
  }
  return failures;
}

// canEnter(treeRoot, registry, phaseId) -> {ok, missing[]}. Checks the
// declared entry_requires against disk — never guesses about undeclared
// artifacts, never trusts state.json's own say-so about what phase is
// "really" ready — plus any declared entry_checks (semantic validation a
// bare file-presence check cannot express, e.g. "the architecture gate is
// actually approved and digest-matched," not merely that gate.json exists —
// P2 review [blocker] #1). A failed semantic check is reported as a
// descriptive string appended to the same `missing` array, alongside any
// missing relpaths, so callers keep a single flat list of "why not."
function canEnter(treeRoot, registry, phaseId) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('phases: treeRoot must be a non-empty string');
  }
  const phase = findPhase(registry, phaseId);
  const missing = missingRelpaths(treeRoot, phase.entry_requires);

  const checkFailures = [];
  for (const checkName of phase.entry_checks || []) {
    const checkFn = SEMANTIC_CHECKS[checkName];
    const { ok, violations } = checkFn(treeRoot);
    if (!ok) {
      for (const violation of violations) checkFailures.push(`${checkName}: ${violation}`);
    }
  }

  return { ok: missing.length === 0 && checkFailures.length === 0, missing: [...missing, ...checkFailures] };
}

// advance(treeRoot, registry, statePath, ledgerPath) — the one sanctioned
// phase-transition operation. Fails closed at every step: an incomplete
// current phase (its exit_emits missing) or an unready next phase (its
// entry_requires missing) both throw with the missing list attached, and no
// disk write happens until every check has passed.
//
// The whole decision — which phase is current, whether its exit is
// satisfied, which phase is next, whether ITS entry is satisfied — runs
// INSIDE atomic-json.js's updateJson lock on statePath (P11 convergence
// finding 21: a mid-phase handoff.js stop and a concurrent advance() both
// read-then-write state.json; per-file atomic writes alone don't stop the
// second writer from silently clobbering the first's update with a decision
// made against a now-stale read). The ledger-first write-ahead append below
// runs from INSIDE that same locked updater, so the append and the eventual
// state write are decided against the exact same locked read — never a
// stale pre-lock snapshot.
function advance(treeRoot, registry, statePath, ledgerPath) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('phases: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(statePath)) {
    throw new TypeError('phases: statePath must be a non-empty string');
  }
  if (!isNonEmptyString(ledgerPath)) {
    throw new TypeError('phases: ledgerPath must be a non-empty string');
  }

  let result;
  updateJson(statePath, MISSING_STATE, (state) => {
    if (state === MISSING_STATE) {
      throw new Error(`phases: no state.json found at ${statePath}`);
    }
    if (!isPlainObject(state)) {
      throw new Error(`phases: state at ${statePath} must be a JSON object`);
    }

    const currentId = currentPhase(state);
    const current = findPhase(registry, currentId);

    const stillMissing = missingRelpaths(treeRoot, current.exit_emits);
    if (stillMissing.length > 0) {
      throw new Error(
        `phases: cannot advance past "${currentId}" — exit_emits missing: ${stillMissing.join(', ')}`
      );
    }

    // Semantic exit checks (P4 Sol review MAJOR #5) run AFTER the path-existence
    // check above, on the phase being exited — a file existing is necessary
    // but, for a stream that must be sealed or a decision log that must carry
    // real content, never sufficient. Named failures, same shape as the
    // exit_emits refusal above.
    const exitCheckFailures = runExitChecks(treeRoot, current.exit_checks);
    if (exitCheckFailures.length > 0) {
      throw new Error(
        `phases: cannot advance past "${currentId}" — exit_checks failed: ${exitCheckFailures.join('; ')}`
      );
    }

    const next = registry.phases.find((p) => p.order === current.order + 1);
    if (!next) {
      throw new Error(`phases: "${currentId}" is the terminal phase (highest order) — nothing to advance to`);
    }

    const { ok, missing } = canEnter(treeRoot, registry, next.id);
    if (!ok) {
      throw new Error(
        `phases: cannot enter "${next.id}" from "${currentId}" — entry_requires missing: ${missing.join(', ')}`
      );
    }

    // Ledger-first (write-ahead) ordering: the ledger's phase-transition event
    // is appended BEFORE state.json is rewritten below — the reverse of the
    // original ordering, and deliberately so. P2 review [blocker] #2
    // reproduced the original ordering's failure mode by passing an
    // unwritable ledgerPath: state.json advanced to the next phase while
    // appendRecord() then threw, leaving an advanced authoritative state with
    // no matching ledger evidence, which synthesis §4's restart/narration laws
    // forbid (a boundary must write the state pointer AND a ledger event,
    // never one without the other). With the ledger written first, a failed
    // append throws HERE, before state.json is ever touched (updateJson's own
    // updater throwing means writeAtomic never runs), so the pre-transition
    // phase stays authoritative on both files — the failure mode collapses to
    // "nothing happened" instead of "state lied." The residual case (append
    // succeeds, the state write itself then fails) is the strictly safer
    // direction to fail in: it leaves an evidence record for a transition
    // state.json hasn't caught up to yet, and every reader of "what phase is
    // this" (resumePoint(), currentPhase()) reads ONLY state.json — never the
    // ledger — as THE resume pointer (synthesis §2), so that residual case can
    // never itself be mistaken for a completed phase.
    const nowIso = new Date().toISOString();
    appendRecord(ledgerPath, {
      kind: 'phase-transition',
      payload: { from: currentId, to: next.id },
      correlation_id: next.id,
    });

    const prevPhaseStatus = isPlainObject(state.phase_status) ? state.phase_status : {};
    const newState = {
      ...state,
      phase: next.id,
      phase_status: { ...prevPhaseStatus, [currentId]: 'complete' },
      next_action: next.id,
      updated_utc: nowIso,
    };
    result = { from: currentId, to: next.id, state: newState };
    return newState;
  });

  return result;
}

// closeTerminal(treeRoot, registry, statePath, ledgerPath) — the terminal-
// phase counterpart to advance() (P9 delivery-phase need): the registry's
// highest-"order" phase (delivery, phase 8) has no order+1 to
// advance INTO, so advance() itself always throws "is the terminal phase...
// nothing to advance to" when called against it — by construction, never a
// bug in advance(). Nothing before this addition ever marked that LAST
// phase's own exit_emits/exit_checks as verified or flipped its
// phase_status to "complete," so a fully delivered build had no
// machine-checkable "done" fact for resumePoint() to report. This function
// closes exactly that gap, reusing the SAME exit_emits/exit_checks
// validation advance() already runs on the phase it is closing (never a
// second implementation of "is this phase's own exit satisfied" — doctrine
// rule 6) and the same ledger-first write-ahead ordering advance() uses, but
// writes a "phase-terminal" ledger record instead of "phase-transition"
// (there is no "to" phase) and sets next_action to the literal sentinel
// "done" — a value no phase id can ever collide with (registry ids are
// validated non-empty strings the same way "done" is, but no registry in
// this product names a phase "done") — rather than leaving next_action
// pointed at the phase that has, in fact, already finished.
//
// Throws if the CURRENT phase is not the registry's own highest-order
// (terminal) phase — closeTerminal is not a second way to advance a
// non-terminal phase, callers use advance() for that; and throws with the
// same missing-list shape advance() uses if exit_emits/exit_checks are not
// yet satisfied — closing the pipeline is not permitted before its own last
// phase's promised artifacts are honestly on disk.
// Same locked-updater shape as advance(), above (P11 convergence finding
// 21): the exactly-once check, the terminal-phase/exit validation, the
// ledger-first append, and the state write all run inside one updateJson
// transaction on statePath, so a concurrent state.json writer can never
// interleave between this function's own read and write.
function closeTerminal(treeRoot, registry, statePath, ledgerPath) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('phases: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(statePath)) {
    throw new TypeError('phases: statePath must be a non-empty string');
  }
  if (!isNonEmptyString(ledgerPath)) {
    throw new TypeError('phases: ledgerPath must be a non-empty string');
  }

  let result;
  updateJson(statePath, MISSING_STATE, (state) => {
    if (state === MISSING_STATE) {
      throw new Error(`phases: no state.json found at ${statePath}`);
    }
    if (!isPlainObject(state)) {
      throw new Error(`phases: state at ${statePath} must be a JSON object`);
    }

    const currentId = currentPhase(state);

    // Exactly-once (P9 required revision #3; P9 Sol review MAJOR: "terminal
    // closure is not exactly-once" — a second closeTerminal call obtained
    // success twice with two "phase-terminal" ledger records). Checked here,
    // BEFORE any write below (ledger append or state.json rewrite) and before
    // even the terminal-phase/exit_emits/exit_checks validation that follows
    // — a build that has already closed is not re-validated, it is simply
    // refused, the same fail-fast posture the other closeTerminal guards
    // below take on a not-yet-ready build. next_action === "done" is the
    // sentinel this function itself stamps below (never any other writer's
    // value), and phase_status[currentId] === "complete" is the SAME
    // per-phase completion mark advance() stamps on every phase it exits —
    // either one already being true means this exact close already happened.
    if (state.next_action === 'done' || (isPlainObject(state.phase_status) && state.phase_status[currentId] === 'complete')) {
      throw new Error(
        `phases: cannot close terminal phase "${currentId}" — it is already closed (next_action is ${JSON.stringify(state.next_action)}) — closeTerminal is exactly-once, a second close is refused`
      );
    }

    const current = findPhase(registry, currentId);

    const highestOrder = Math.max(...registry.phases.map((p) => p.order));
    if (current.order !== highestOrder) {
      throw new Error(
        `phases: closeTerminal called on "${currentId}" (order ${current.order}) — only the registry's own terminal phase (highest order, ${highestOrder}) may be closed this way; use advance() for any earlier phase`
      );
    }

    const stillMissing = missingRelpaths(treeRoot, current.exit_emits);
    if (stillMissing.length > 0) {
      throw new Error(
        `phases: cannot close terminal phase "${currentId}" — exit_emits missing: ${stillMissing.join(', ')}`
      );
    }

    const exitCheckFailures = runExitChecks(treeRoot, current.exit_checks);
    if (exitCheckFailures.length > 0) {
      throw new Error(
        `phases: cannot close terminal phase "${currentId}" — exit_checks failed: ${exitCheckFailures.join('; ')}`
      );
    }

    const nowIso = new Date().toISOString();
    appendRecord(ledgerPath, {
      kind: 'phase-terminal',
      payload: { phase: currentId },
      correlation_id: currentId,
    });

    const prevPhaseStatus = isPlainObject(state.phase_status) ? state.phase_status : {};
    const newState = {
      ...state,
      phase_status: { ...prevPhaseStatus, [currentId]: 'complete' },
      next_action: 'done',
      updated_utc: nowIso,
    };
    result = { phase: currentId, state: newState };
    return newState;
  });

  return result;
}

// reopenPhase(treeRoot, registry, statePath, ledgerPath, targetPhaseId,
// {rationale}) — the sanctioned REVERSE transition advance() has no notion
// of (P6 Sol review MAJOR, ruling (b)'s additional state issue: "On operator
// rejection, the flow keeps machine state at plan_gate but sends the author
// back to mutate phase-4 artifacts... phases.js has forward advancement, not
// a defined reopen/rewind transition... The fix needs explicit revision/
// re-entry semantics, capture of the operator's rejection rationale, a new
// manifest/gate for the repaired revision, and no stale gate left
// authoritative during repair"). Used when a later, already-completed phase
// must be redone — an operator rejecting the architecture gate at plan_gate
// is the motivating case, but the mechanism is phase-generic, not
// plan-gate-specific.
//
// targetPhaseId must be a phase strictly EARLIER (lower order) than the
// current phase AND already marked "complete" in phase_status — reopening a
// phase that was never finished is not a rewind, it's a state that was never
// honest to begin with, and throws instead. Every phase from targetPhaseId
// through the current phase (inclusive) loses its "complete" mark: a rewind
// to architecture also un-completes plan_gate, since plan_gate's own
// gate.json is about to become stale the moment repair begins — leaving it
// marked complete would let a stale gate keep looking authoritative during
// repair, exactly what the review names as a residual risk.
//
// Ledger-first, same ordering discipline as advance() and for the same
// reason: the "phase-reopen" event (payload {from, to, rationale}) is
// appended BEFORE state.json is rewritten, so a failed append leaves the
// pre-reopen phase authoritative on both files rather than a state.json that
// claims a reopening no ledger event backs.
// Same locked-updater shape as advance()/closeTerminal(), above (P11
// convergence finding 21): the target-validity checks, the ledger-first
// append, and the state write all run inside one updateJson transaction on
// statePath.
function reopenPhase(treeRoot, registry, statePath, ledgerPath, targetPhaseId, opts = {}) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('phases: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(statePath)) {
    throw new TypeError('phases: statePath must be a non-empty string');
  }
  if (!isNonEmptyString(ledgerPath)) {
    throw new TypeError('phases: ledgerPath must be a non-empty string');
  }
  if (!isNonEmptyString(targetPhaseId)) {
    throw new TypeError('phases: reopenPhase requires a non-empty targetPhaseId');
  }
  const rationale = opts.rationale;
  if (!isNonEmptyString(rationale)) {
    throw new TypeError('phases: reopenPhase requires a non-empty opts.rationale (the operator/reviewer\'s stated reason)');
  }

  let result;
  updateJson(statePath, MISSING_STATE, (state) => {
    if (state === MISSING_STATE) {
      throw new Error(`phases: no state.json found at ${statePath}`);
    }
    if (!isPlainObject(state)) {
      throw new Error(`phases: state at ${statePath} must be a JSON object`);
    }

    const currentId = currentPhase(state);
    const current = findPhase(registry, currentId);
    const target = findPhase(registry, targetPhaseId);

    if (target.order >= current.order) {
      throw new Error(
        `phases: reopenPhase target "${targetPhaseId}" (order ${target.order}) must be strictly earlier than the current phase "${currentId}" (order ${current.order})`
      );
    }

    const prevPhaseStatus = isPlainObject(state.phase_status) ? state.phase_status : {};
    if (prevPhaseStatus[targetPhaseId] !== 'complete') {
      throw new Error(
        `phases: reopenPhase target "${targetPhaseId}" was never completed (phase_status shows ${JSON.stringify(prevPhaseStatus[targetPhaseId] ?? null)}) — nothing to reopen`
      );
    }

    appendRecord(ledgerPath, {
      kind: 'phase-reopen',
      payload: { from: currentId, to: targetPhaseId, rationale },
      correlation_id: targetPhaseId,
    });

    const newPhaseStatus = { ...prevPhaseStatus };
    for (const phase of registry.phases) {
      if (phase.order >= target.order && phase.order <= current.order) {
        delete newPhaseStatus[phase.id];
      }
    }

    const nowIso = new Date().toISOString();
    const newState = {
      ...state,
      phase: targetPhaseId,
      phase_status: newPhaseStatus,
      next_action: targetPhaseId,
      updated_utc: nowIso,
    };
    result = { from: currentId, to: targetPhaseId, state: newState };
    return newState;
  });

  return result;
}

// resumePoint(treeRoot, registry, statePath) -> {phase, canResume, missing[]}
// for a fresh session picking the tree back up: never mutates anything,
// only reports what state.json claims and whether disk actually backs that
// claim up (per-phase entry_requires — the same check a live advance() into
// that phase would have performed).
function resumePoint(treeRoot, registry, statePath) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('phases: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(statePath)) {
    throw new TypeError('phases: statePath must be a non-empty string');
  }

  const state = readJson(statePath, MISSING_STATE);
  if (state === MISSING_STATE || !isPlainObject(state) || !isNonEmptyString(state.phase)) {
    return { phase: null, canResume: false, missing: ['state.json'] };
  }

  const phaseId = state.phase;
  let phase;
  try {
    phase = findPhase(registry, phaseId);
  } catch {
    return { phase: phaseId, canResume: false, missing: [] };
  }

  const missing = missingRelpaths(treeRoot, phase.entry_requires);
  return { phase: phase.id, canResume: missing.length === 0, missing };
}

// CLI entrypoint (packaging finding, P2 skeleton-walk proof: scaffold.js and
// check-honesty.js both end in a `node <file> ...` shell-runnable form;
// phases.js lacked one, so a worker brief that says "run phases.js's
// advance()" could not be satisfied by a bare shell command the way it can
// for its siblings. `--registry` defaults to this module's own canonical
// `machine/phases-registry.json` (the same path the dev-side test suite
// hard-codes as REGISTRY_PATH); statePath/ledgerPath are always
// `<treeRoot>/state.json` and `<treeRoot>/ledger.jsonl` per the module
// contract (treeRoot is the `.kiln` directory itself). Prints the
// JSON result on success; on failure, prints the thrown message to stderr
// and exits 1 — nothing here catches an error to keep going.
const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'phases-registry.json');

function parseArgv(argv) {
  const [command, treeRoot, ...rest] = argv;
  let registryPath = DEFAULT_REGISTRY_PATH;
  let rationale;
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--registry') {
      registryPath = rest[i + 1];
      i++;
    } else if (rest[i] === '--rationale') {
      rationale = rest[i + 1];
      i++;
    } else {
      positional.push(rest[i]);
    }
  }
  return { command, treeRoot, positional, registryPath, rationale };
}

function main(argv) {
  const { command, treeRoot, positional, registryPath, rationale } = parseArgv(argv);
  if (!command || !treeRoot) {
    process.stderr.write(
      'usage: phases.js <can-enter|advance|close-terminal|reopen|resume> <treeRoot> [phaseId] [--registry <path>] [--rationale <text>]\n'
    );
    process.exit(1);
    return;
  }
  try {
    const registry = loadRegistry(registryPath);
    let result;
    if (command === 'can-enter') {
      const phaseId = positional[0];
      if (!isNonEmptyString(phaseId)) throw new Error('can-enter requires a phaseId argument');
      result = canEnter(treeRoot, registry, phaseId);
    } else if (command === 'advance') {
      result = advance(treeRoot, registry, path.join(treeRoot, 'state.json'), path.join(treeRoot, 'ledger.jsonl'));
    } else if (command === 'close-terminal') {
      result = closeTerminal(treeRoot, registry, path.join(treeRoot, 'state.json'), path.join(treeRoot, 'ledger.jsonl'));
    } else if (command === 'reopen') {
      const targetPhaseId = positional[0];
      if (!isNonEmptyString(targetPhaseId)) throw new Error('reopen requires a targetPhaseId argument');
      result = reopenPhase(treeRoot, registry, path.join(treeRoot, 'state.json'), path.join(treeRoot, 'ledger.jsonl'), targetPhaseId, {
        rationale,
      });
    } else if (command === 'resume') {
      result = resumePoint(treeRoot, registry, path.join(treeRoot, 'state.json'));
    } else {
      throw new Error(`unknown command "${command}" (expected can-enter, advance, close-terminal, reopen, or resume)`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`phases.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { loadRegistry, currentPhase, canEnter, advance, closeTerminal, reopenPhase, resumePoint, runExitChecks };
