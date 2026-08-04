'use strict';

// The verification-phase machinery (the verification/ tree:
// runs/<run-id>.jsonl, runs-index.json, quarantine.json, affected-map.json,
// suite-state.json). Six operations:
//
//   assembleSuite  — fail-closed validation: the criteria-register itself
//                    (validators.validateCriteriaRegister) plus its strict
//                    1:1 map against journeys.json, plus per-journey
//                    script_path containment. Assembles, never writes (the
//                    same division validators.js's own criteria-register
//                    comment already draws for phase 7).
//   orderRun       — pure reordering: previously-failed first, then
//                    affected (per affected-map.json's own "pending"-status
//                    entries only — a journey already "green" never
//                    re-prioritizes), then the rest. Validates affectedMap
//                    via validators.validateAffectedMap when one is given.
//   startRun       — the sole writer of a run's own "run-start" record and
//                    of verification/runs-index.json's ordering: binds a
//                    runId to an immutable digest of the assembled suite it
//                    is about to exercise, and refuses to let a runId be
//                    reused (monotonic run identity — the run-currency law).
//   recordRun      — the sole writer of verification/runs/<run-id>.jsonl;
//                    every result MUST carry a runGate gate_id AND (unless
//                    the caller opts into the scenario-only escape hatch,
//                    below) a matching ledger record proving that gate
//                    actually ran (evidence binding — a caller-attested
//                    "pass" with no execution behind it is refused, not
//                    merely logged as such).
//   computeSuiteState — the sole writer of verification/suite-state.json.
//                    green IFF every non-quarantined journey in the
//                    assembled SUITE (a required argument now, not an
//                    incidental byproduct of whatever records happen to
//                    exist) carries exactly one verified, current-run,
//                    passing record. A missing record, an ambiguous
//                    (duplicate) one, an unverified one, a malformed run
//                    stream, or a run whose suite digest has drifted from
//                    the one it started against — every one of those is
//                    red, fail-closed, never vacuously green.
//   recordAffected — the sole sanctioned writer of
//                    verification/affected-map.json; validates via
//                    validators.validateAffectedMap before ever touching
//                    disk.
//   runJourney     — the sole per-journey execute-and-record shortcut,
//                    joining check-honesty.js's runGate (the one sanctioned
//                    command-execution-plus-ledger-evidence mechanism) to
//                    recordRun in a single call — the evidence recordRun's
//                    own evidence-binding check requires is always already
//                    in place by the time recordRun runs, because runGate
//                    just wrote it.

const path = require('node:path');
const crypto = require('node:crypto');

const { readRecords, appendRecord } = require('./stream.js');
const { readJson, writeAtomic } = require('./atomic-json.js');
const { runGate } = require('./check-honesty.js');
const validators = require('./validators.js');

const SUITE_STATE_SCHEMA_VERSION = 1;
const RUNS_INDEX_SCHEMA_VERSION = 1;
const RUN_STATUSES = new Set(['pass', 'fail']);
const HARNESSES = new Set(['playwright', 'node-test', 'pytest', 'cli']);

// A journey's script_path is interpolated into a shell command string by
// product/verification/flow.md's own harness-to-cmd derivation (`node --test
// <script_path>`, `npx playwright test <script_path> ...`, etc.) — an
// unconstrained script_path would let shell metacharacters (`; exit 0`)
// smuggle through that derivation and fabricate a passing journey for a
// test that never ran. This charset is deliberately narrower than a generic
// "no shell metacharacters" denylist (which a novel metacharacter could
// slip past): an ALLOWLIST of exactly the characters a real relative
// source-file path needs closes the class of attack structurally, at
// assembly time — before a single harness command is ever derived — rather
// than only at execution time.
const SAFE_SCRIPT_PATH_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A contained, safe-charset relative script path: no absolute paths, no
// backslashes, no '.'/'..'/empty segments, and every character drawn from
// SAFE_SCRIPT_PATH_RE's allowlist — the same containment discipline
// phases.js's isContainedRelpath already applies to registry-declared
// paths, plus the additional charset floor a shell-interpolated command
// derivation needs that a bare path-traversal check does not.
function isContainedScriptPath(value) {
  if (!isNonEmptyString(value)) return false;
  if (path.isAbsolute(value)) return false;
  if (value.includes('\\')) return false;
  if (!SAFE_SCRIPT_PATH_RE.test(value)) return false;
  const segments = value.split('/');
  return segments.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// assembleSuite(treeRoot, criteriaRegister, journeysIndex) — the fail-closed
// 1:1 check between architecture/criteria-register.json's criteria and
// verification/journeys.json's journeys: every ID gets exactly one journey;
// this phase assembles, never writes. treeRoot is accepted for
// call-site symmetry with orderRun/startRun/recordRun/computeSuiteState (all
// of which key off it for I/O) — assembleSuite itself is a pure computation
// over its two JSON arguments and writes nothing.
//
// Fails closed on:
//   - a criteria register that is not itself well-formed
//     (validators.validateCriteriaRegister — two register entries sharing
//     one criterion id are rejected here, never passed through).
//   - missing: a register criterion with zero matching journey entries
//   - duplicate: a register criterion with more than one matching journey
//     entry, OR two journey entries sharing the same journey_id
//   - orphan: a journey entry whose criterion_id names no criterion in the
//     register
//   - any journey entry missing a non-empty script_path, an unsafe/
//     uncontained script_path (see SAFE_SCRIPT_PATH_RE above), or any other
//     required field
//
// Returns { ok: false, errors } on any violation, else
// { ok: true, errors: [], journeys: [<assembled journey descriptors>] }.
function assembleSuite(treeRoot, criteriaRegister, journeysIndex) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('verification: treeRoot must be a non-empty string');
  }

  const registerCheck = validators.validateCriteriaRegister(criteriaRegister);
  if (!registerCheck.ok) {
    return { ok: false, errors: registerCheck.errors };
  }

  const errors = [];

  if (
    !isPlainObject(journeysIndex) ||
    journeysIndex.schema_version !== 1 ||
    !Array.isArray(journeysIndex.journeys)
  ) {
    return {
      ok: false,
      errors: ['assembleSuite: journeysIndex must be an object {schema_version: 1, journeys: [...]}'],
    };
  }

  const byCriterion = new Map(); // criterion_id -> journey entries naming it
  const seenJourneyIds = new Set();

  journeysIndex.journeys.forEach((entry, index) => {
    const where = `journeysIndex.journeys[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${where} must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.journey_id)) {
      errors.push(`${where}.journey_id must be a non-empty string`);
    } else if (seenJourneyIds.has(entry.journey_id)) {
      errors.push(`${where}.journey_id "${entry.journey_id}" is a duplicate — journey_id must be unique`);
    } else {
      seenJourneyIds.add(entry.journey_id);
    }
    if (!isNonEmptyString(entry.script_path)) {
      errors.push(`${where}.script_path must be a non-empty string`);
    } else if (!isContainedScriptPath(entry.script_path)) {
      errors.push(
        `${where}.script_path "${entry.script_path}" is not a safe, contained relative path (no absolute paths, no ".."/"." segments, and only letters, digits, ".", "_", "-", and "/" are allowed)`
      );
    }
    if (!HARNESSES.has(entry.harness)) {
      errors.push(`${where}.harness must be one of ${[...HARNESSES].join(', ')} (got ${JSON.stringify(entry.harness)})`);
    }
    if (!isNonEmptyString(entry.added_in_milestone)) {
      errors.push(`${where}.added_in_milestone must be a non-empty string`);
    }
    if (!isNonEmptyString(entry.criterion_id)) {
      errors.push(`${where}.criterion_id must be a non-empty string`);
      return;
    }
    const list = byCriterion.get(entry.criterion_id) || [];
    list.push(entry);
    byCriterion.set(entry.criterion_id, list);
  });

  const registerCriterionIds = new Set();
  criteriaRegister.criteria.forEach((entry) => {
    if (isPlainObject(entry) && isNonEmptyString(entry.id)) {
      registerCriterionIds.add(entry.id);
    }
  });

  for (const criterionId of registerCriterionIds) {
    const list = byCriterion.get(criterionId) || [];
    if (list.length === 0) {
      errors.push(`criterion "${criterionId}" has no journey entry — every register criterion must have exactly one`);
    } else if (list.length > 1) {
      errors.push(`criterion "${criterionId}" has ${list.length} journey entries — exactly one is required`);
    }
  }

  for (const criterionId of byCriterion.keys()) {
    if (!registerCriterionIds.has(criterionId)) {
      errors.push(`journey entry references unknown criterion "${criterionId}" — orphan journey`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, errors: [], journeys: journeysIndex.journeys.map((entry) => ({ ...entry })) };
}

// orderRun(previousResults, affectedMap, allJourneys) — the failing-first
// dance: previously-failed journeys first, then affected (per
// affected-map.json's own "pending"-status entries only — a "green"
// affected-map entry never re-prioritizes, since re-running it would only
// weaken the signal), then everything else. Stable within each bucket
// (allJourneys' own relative order is preserved), so two callers given the
// same three inputs always get the same order — no judgment, no randomness.
//
// A present, non-null affectedMap is validated via
// validators.validateAffectedMap and rejected (thrown) if malformed — the
// document is validated before ordering ever runs. A null/undefined
// affectedMap (the very first pass, before the file exists) is tolerated as
// "no affected entries," per product/verification/flow.md's own documented
// first-pass default.
function orderRun(previousResults, affectedMap, allJourneys) {
  if (!Array.isArray(previousResults)) {
    throw new TypeError('verification: previousResults must be an array');
  }
  if (!Array.isArray(allJourneys)) {
    throw new TypeError('verification: allJourneys must be an array');
  }

  const failedIds = new Set();
  for (const result of previousResults) {
    if (isPlainObject(result) && isNonEmptyString(result.journey_id) && result.status === 'fail') {
      failedIds.add(result.journey_id);
    }
  }

  const affectedIds = new Set();
  if (affectedMap !== null && affectedMap !== undefined) {
    const { ok, errors } = validators.validateAffectedMap(affectedMap);
    if (!ok) {
      throw new TypeError(`verification: orderRun refuses a malformed affectedMap (${errors.join('; ')})`);
    }
    for (const entry of affectedMap.entries) {
      if (entry.status === 'pending' && entry.affected_by.length > 0) {
        affectedIds.add(entry.journey_id);
      }
    }
  }

  const failedBucket = [];
  const affectedBucket = [];
  const restBucket = [];

  for (const journey of allJourneys) {
    const journeyId = isPlainObject(journey) ? journey.journey_id : undefined;
    if (failedIds.has(journeyId)) {
      failedBucket.push(journey);
    } else if (affectedIds.has(journeyId)) {
      affectedBucket.push(journey);
    } else {
      restBucket.push(journey);
    }
  }

  return [...failedBucket, ...affectedBucket, ...restBucket];
}

function runsPathOf(treeRoot, runId) {
  return path.join(treeRoot, 'verification', 'runs', `${runId}.jsonl`);
}

function runsIndexPathOf(treeRoot) {
  return path.join(treeRoot, 'verification', 'runs-index.json');
}

function affectedMapPathOf(treeRoot) {
  return path.join(treeRoot, 'verification', 'affected-map.json');
}

function readRunsIndex(treeRoot) {
  const index = readJson(runsIndexPathOf(treeRoot), { schema_version: RUNS_INDEX_SCHEMA_VERSION, runs: [] });
  if (!isPlainObject(index) || !Array.isArray(index.runs)) {
    throw new Error(`verification: ${runsIndexPathOf(treeRoot)} must be an object with a "runs" array`);
  }
  return index;
}

// A deterministic digest of the assembled suite's own identity-bearing
// fields, independent of array order — this is the "immutable assembled-
// suite manifest" a run binds itself to at startRun time: two suites are
// the "same suite" iff every journey's own
// {journey_id, criterion_id, script_path, harness, added_in_milestone}
// agrees, regardless of the order assembleSuite happened to return them in.
function digestSuite(suite) {
  const canonical = suite
    .map((entry) => ({
      journey_id: entry.journey_id,
      criterion_id: entry.criterion_id ?? null,
      script_path: entry.script_path ?? null,
      harness: entry.harness ?? null,
      added_in_milestone: entry.added_in_milestone ?? null,
    }))
    .sort((a, b) => (a.journey_id < b.journey_id ? -1 : a.journey_id > b.journey_id ? 1 : 0));
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

// Validates a "suite" argument's own shape — a non-empty array of objects
// each carrying a unique, non-empty journey_id — shared by startRun and
// computeSuiteState, both of which need the same fixed universe of
// journey_ids to bind a run to. Throws on any violation: the suite argument
// is a caller-assembled fact (assembleSuite's own output, or an equivalent
// caller-supplied array), and a malformed one is a caller defect, not a
// legitimate red verdict.
function validateSuiteShape(suite) {
  if (!Array.isArray(suite) || suite.length === 0) {
    throw new TypeError('verification: suite must be a non-empty array of assembled journey descriptors');
  }
  const journeyIds = [];
  const seen = new Set();
  suite.forEach((entry, index) => {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.journey_id)) {
      throw new TypeError(`verification: suite[${index}] must be an object with a non-empty journey_id`);
    }
    if (seen.has(entry.journey_id)) {
      throw new TypeError(`verification: suite[${index}].journey_id "${entry.journey_id}" is a duplicate`);
    }
    seen.add(entry.journey_id);
    journeyIds.push(entry.journey_id);
  });
  return journeyIds;
}

// startRun(treeRoot, runId, suite) — the sole writer of a run's own
// "run-start" record and of verification/runs-index.json (the run-currency
// law). Binds runId to an immutable digest of the
// assembled suite it is about to exercise, and enforces a monotonic run
// identity: a runId already present in runs-index.json — or one whose own
// runs/<run-id>.jsonl already carries records — refuses to start again
// (fail closed rather than silently reusing or racing a prior run).
// runs-index.json's own ordering (append-only, one entry per started run)
// is what the "suite-state-green" exit check (phases.js) later cross-checks
// a persisted suite-state.json's run_id against, to reject a stale green.
function startRun(treeRoot, runId, suite) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('verification: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(runId)) {
    throw new TypeError('verification: runId must be a non-empty string');
  }
  validateSuiteShape(suite);

  const suiteDigest = digestSuite(suite);
  const index = readRunsIndex(treeRoot);
  if (index.runs.some((entry) => isPlainObject(entry) && entry.run_id === runId)) {
    throw new Error(
      `verification: run "${runId}" already exists in ${runsIndexPathOf(treeRoot)} — run ids are monotonic and may not be reused`
    );
  }

  const runPath = runsPathOf(treeRoot, runId);
  const { records: existingRecords } = readRecords(runPath);
  if (existingRecords.length > 0) {
    throw new Error(`verification: ${runPath} already carries records — run "${runId}" cannot be started twice`);
  }

  const seq = index.runs.length;
  appendRecord(runPath, {
    kind: 'run-start',
    payload: { suite_digest: suiteDigest, run_seq: seq },
    correlation_id: runId,
  });

  const nowIso = new Date().toISOString();
  writeAtomic(runsIndexPathOf(treeRoot), {
    schema_version: RUNS_INDEX_SCHEMA_VERSION,
    runs: [...index.runs, { run_id: runId, seq, suite_digest: suiteDigest, started_at: nowIso }],
  });

  return { runId, seq, suiteDigest, runPath };
}

// recordRun(treeRoot, runId, results, ledgerPath, opts) — the sole writer of
// verification/runs/<run-id>.jsonl. Every result MUST carry a non-empty
// gate_id, AND — the execution-evidence law — a matching ledger record
// (kind "gate", this exact gate_id, a present exit_code) proving that gate
// actually ran: a caller-attested "pass" with no ledger record behind it is
// refused outright, never merely logged as such. A batch is validated up
// front, before any record is appended, so a malformed batch never leaves a
// partial write behind.
//
// opts.unverifiedImport (default false) is a deliberate escape hatch for
// scenario/mock use ONLY (documented in product/verification/flow.md) —
// when set, ledgerPath is not required and no ledger cross-check runs;
// every record written this way is stamped unverified:true, and
// computeSuiteState treats an unverified record as a failure unless ITS
// OWN caller opts into opts.allowUnverified (scenario-only, symmetric).
function recordRun(treeRoot, runId, results, ledgerPath, opts = {}) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('verification: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(runId)) {
    throw new TypeError('verification: runId must be a non-empty string');
  }
  if (!Array.isArray(results)) {
    throw new TypeError('verification: results must be an array');
  }

  const unverifiedImport = opts.unverifiedImport === true;
  if (!unverifiedImport && !isNonEmptyString(ledgerPath)) {
    throw new TypeError(
      'verification: ledgerPath must be a non-empty string (the execution-evidence law) unless opts.unverifiedImport is set — scenario/mock use only'
    );
  }

  const ledgerRecords = unverifiedImport ? [] : readRecords(ledgerPath).records;

  results.forEach((result, index) => {
    const where = `results[${index}]`;
    if (!isPlainObject(result)) {
      throw new TypeError(`verification: ${where} must be an object`);
    }
    if (!isNonEmptyString(result.journey_id)) {
      throw new TypeError(`verification: ${where}.journey_id must be a non-empty string`);
    }
    if (!RUN_STATUSES.has(result.status)) {
      throw new TypeError(`verification: ${where}.status must be one of ${[...RUN_STATUSES].join(', ')} (got ${JSON.stringify(result.status)})`);
    }
    if (!(Number.isFinite(result.duration_ms) && result.duration_ms >= 0)) {
      throw new TypeError(`verification: ${where}.duration_ms must be a nonnegative finite number`);
    }
    if (!isNonEmptyString(result.gate_id)) {
      throw new TypeError(
        `verification: ${where}.gate_id must be a non-empty string — the execution-evidence law requires every recorded result to carry a runGate gate_id`
      );
    }
    if (!unverifiedImport) {
      const hasEvidence = ledgerRecords.some(
        (record) => isPlainObject(record) && record.kind === 'gate' && record.gate_id === result.gate_id && Number.isFinite(record.exit_code)
      );
      if (!hasEvidence) {
        throw new TypeError(
          `verification: ${where}.gate_id "${result.gate_id}" has no matching ledger record (kind="gate", exit_code present) at ${ledgerPath} — refused (execution-evidence law); pass opts.unverifiedImport for scenario/mock use only`
        );
      }
    }
  });

  const runPath = runsPathOf(treeRoot, runId);
  const seqs = results.map((result) =>
    appendRecord(runPath, {
      kind: 'journey-result',
      payload: {
        journey_id: result.journey_id,
        status: result.status,
        duration_ms: result.duration_ms,
        gate_id: result.gate_id,
        unverified: unverifiedImport,
      },
      correlation_id: result.gate_id,
    })
  );

  return { runPath, seqs };
}

// computeSuiteState(treeRoot, runId, quarantine, suite, opts) — the sole
// writer of verification/suite-state.json.
//
// green IFF EVERY journey in the assembled `suite` — the required fixed
// universe this pass must cover, not merely whatever records happen to
// exist (deriving the universe from the run's own records instead would
// let a nonexistent or partial run report vacuously green) — is either:
//   (a) decided-quarantined (quarantine.json carries an entry for it with
//       >= 2 outcomes — a PENDING single-outcome entry still votes, see
//       below), or
//   (b) backed by EXACTLY ONE verified, current-run "journey-result"
//       record reporting "pass".
//
// Fails closed (marks the journey failing, with a machine-readable reason
// in the returned `reasons` map) on:
//   - "no-result"            — zero records for this journey in this run.
//   - "duplicate-result"     — 2+ records for this journey in this run
//                              (ambiguous; recordRun's own contract is one
//                              call per journey per run — a duplicate is a
//                              structural anomaly, not "latest wins").
//   - "unverified-result"    — the record exists but was written via
//                              recordRun's opts.unverifiedImport escape,
//                              and this call did not set opts.allowUnverified.
//   - "failed"               — the record exists, verified, and reports
//                              "fail".
//   - "malformed-run-stream" — readRecords reported parse errors or header
//                              violations anywhere in this run's own
//                              stream (every non-quarantined journey fails
//                              closed together; a corrupted stream cannot
//                              partially vouch for anything it contains).
//   - "suite-digest-mismatch"— this run's own "run-start" record names a
//                              different suite digest than the `suite`
//                              this call was given (the run was started
//                              against a different assembled suite than
//                              the one being checked against now).
//
// Throws (a caller defect, not a legitimate red verdict) if `runId` was
// never registered via startRun — computing suite state for a run that was
// never started is not a valid state to be in.
//
// Quarantine PENDING vs. DECIDED: a quarantine.json entry with
// history.length === 1 is a journey mid-incident, one outcome in,
// awaiting its one re-run — it still votes normally, exactly like any other
// journey. Only history.length >= 2 (a "quarantine" verdict was actually
// reached and persisted) removes a journey's vote.
//
// run_seq/suite_digest are recorded into suite-state.json for auditability
// and so the "suite-state-green" exit check (phases.js) can cross-verify
// run currency against runs-index.json's own latest entry without
// duplicating this module's own run-lookup logic there.
function computeSuiteState(treeRoot, runId, quarantine, suite, opts = {}) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('verification: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(runId)) {
    throw new TypeError('verification: runId must be a non-empty string');
  }
  const journeyIds = validateSuiteShape(suite);
  const allowUnverified = opts.allowUnverified === true;

  const quarantinedIds = new Set();
  if (isPlainObject(quarantine) && Array.isArray(quarantine.entries)) {
    for (const entry of quarantine.entries) {
      if (isPlainObject(entry) && isNonEmptyString(entry.journey_id) && Array.isArray(entry.history) && entry.history.length >= 2) {
        quarantinedIds.add(entry.journey_id);
      }
    }
  }

  const suiteDigest = digestSuite(suite);
  const index = readRunsIndex(treeRoot);
  const runEntry = index.runs.find((entry) => isPlainObject(entry) && entry.run_id === runId);
  if (!runEntry) {
    throw new Error(
      `verification: run "${runId}" was never started — call startRun(treeRoot, runId, suite) before computeSuiteState (run-currency law)`
    );
  }

  const { records, errors, headerViolations } = readRecords(runsPathOf(treeRoot, runId));
  const malformedStream = errors.length > 0 || headerViolations.length > 0;

  let digestMismatch = false;
  if (!malformedStream) {
    const startRecord = records.find((record) => isPlainObject(record) && record.kind === 'run-start');
    digestMismatch = !startRecord || startRecord.suite_digest !== suiteDigest;
  }

  const passing = [];
  const failing = [];
  const reasons = {};

  if (malformedStream) {
    for (const journeyId of journeyIds) {
      if (quarantinedIds.has(journeyId)) continue;
      failing.push(journeyId);
      reasons[journeyId] = 'malformed-run-stream';
    }
  } else if (digestMismatch) {
    for (const journeyId of journeyIds) {
      if (quarantinedIds.has(journeyId)) continue;
      failing.push(journeyId);
      reasons[journeyId] = 'suite-digest-mismatch';
    }
  } else {
    const byJourney = new Map();
    for (const record of records) {
      if (isPlainObject(record) && record.kind === 'journey-result' && isNonEmptyString(record.journey_id)) {
        const list = byJourney.get(record.journey_id) || [];
        list.push(record);
        byJourney.set(record.journey_id, list);
      }
    }
    for (const journeyId of journeyIds) {
      if (quarantinedIds.has(journeyId)) continue;
      const list = byJourney.get(journeyId) || [];
      if (list.length === 0) {
        failing.push(journeyId);
        reasons[journeyId] = 'no-result';
      } else if (list.length > 1) {
        failing.push(journeyId);
        reasons[journeyId] = 'duplicate-result';
      } else if (list[0].unverified === true && !allowUnverified) {
        failing.push(journeyId);
        reasons[journeyId] = 'unverified-result';
      } else if (list[0].status === 'pass') {
        passing.push(journeyId);
      } else {
        failing.push(journeyId);
        reasons[journeyId] = 'failed';
      }
    }
  }

  const status = failing.length === 0 ? 'green' : 'red';

  const suiteState = {
    schema_version: SUITE_STATE_SCHEMA_VERSION,
    run_id: runId,
    run_seq: runEntry.seq,
    suite_digest: suiteDigest,
    status,
    passing,
    failing,
    reasons,
    quarantined: [...quarantinedIds],
    ts: new Date().toISOString(),
  };

  writeAtomic(path.join(treeRoot, 'verification', 'suite-state.json'), suiteState);

  return suiteState;
}

// recordAffected(treeRoot, entries) — the sole sanctioned writer of
// verification/affected-map.json: no other code path may write this file
// through a generic writeAtomic call. Validates the assembled document via
// validators.validateAffectedMap before it ever reaches disk; generated_at
// is stamped here, by the writer, never caller-supplied.
function recordAffected(treeRoot, entries) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('verification: treeRoot must be a non-empty string');
  }
  if (!Array.isArray(entries)) {
    throw new TypeError('verification: entries must be an array');
  }

  const affectedMap = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries,
  };

  const { ok, errors } = validators.validateAffectedMap(affectedMap);
  if (!ok) {
    throw new TypeError(`verification: recordAffected refuses a malformed affected-map (${errors.join('; ')})`);
  }

  writeAtomic(affectedMapPathOf(treeRoot), affectedMap);
  return affectedMap;
}

// runJourney(treeRoot, runId, journeyId, cmd, ledgerPath) — product/
// verification/flow.md's own "(b) failing-first dance" names this exact
// shape: "run ... via runGate, per-journey gate evidence, reporter flags
// from the milestone toolchain profiles." Runs ONE journey's reporter-
// flagged command through check-honesty.js's runGate — the one sanctioned
// command-execution-plus-ledger-evidence mechanism, never a second one built
// here — and records the resulting {journey_id, status, duration_ms,
// gate_id} straight through recordRun, in a single call, passing the SAME
// ledgerPath through so recordRun's own evidence-binding check always finds
// the record runGate just wrote. This is what lets Kiln's own narrowly-
// scoped, named-CLI-only Bash (product/charter.md) drive the entire
// per-journey execution loop directly, the same way it already drives
// milestones.js's create/record-chunk/close, rather than requiring a new
// execution-only worker seat this build has no chartered agent for.
//
// gate_id is deterministic from (runId, journeyId) — "journey-<id>-<runId>"
// — so a journey's flake-protocol re-run (a second runJourney call for the
// SAME journeyId under a NEW runId, per the flake protocol's own "re-run
// once") produces a distinct, still-traceable gate_id rather than colliding
// with its first attempt's ledger record.
function runJourney(treeRoot, runId, journeyId, cmd, ledgerPath) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('verification: treeRoot must be a non-empty string');
  }
  if (!isNonEmptyString(runId)) {
    throw new TypeError('verification: runId must be a non-empty string');
  }
  if (!isNonEmptyString(journeyId)) {
    throw new TypeError('verification: journeyId must be a non-empty string');
  }
  if (!isNonEmptyString(cmd)) {
    throw new TypeError('verification: cmd must be a non-empty string');
  }
  if (!isNonEmptyString(ledgerPath)) {
    throw new TypeError('verification: ledgerPath must be a non-empty string');
  }

  const gateId = `journey-${journeyId}-${runId}`;
  const startedAt = Date.now();
  const { exitCode } = runGate({ gateId, cmd, ledgerPath });
  const durationMs = Date.now() - startedAt;
  const status = exitCode === 0 ? 'pass' : 'fail';

  const result = { journey_id: journeyId, status, duration_ms: durationMs, gate_id: gateId };
  recordRun(treeRoot, runId, [result], ledgerPath);
  return { ...result, runPath: runsPathOf(treeRoot, runId) };
}

// CLI entrypoint (product/verification/flow.md's own "Bash, narrowly"
// widening — the same named-machine-layer-CLI convention milestones.js/
// phases.js already establish, so Kiln's phase-sequencing role can invoke
// these operations the identical way it invokes milestones.js's
// create/record-chunk/close today, rather than reaching for an ad hoc
// script). Every argument that is itself JSON (a criteria register, a
// journeys index, a results array, a quarantine doc, an assembled suite) is
// passed as a single JSON-string positional argument and JSON.parse'd here
// — the same shape milestones.js's own `record-chunk <milestoneId>
// <jsonRecord>` already uses.
function parseFlags(rest) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--unverified-import') {
      flags.unverifiedImport = true;
    } else if (rest[i] === '--allow-unverified') {
      flags.allowUnverified = true;
    } else {
      positional.push(rest[i]);
    }
  }
  return { positional, flags };
}

function parseArgv(argv) {
  const [command, ...rest] = argv;
  return { command, rest };
}

function main(argv) {
  const { command, rest } = parseArgv(argv);
  try {
    let result;
    if (command === 'assemble-suite') {
      const [treeRoot, criteriaRegisterJson, journeysIndexJson] = rest;
      if (!treeRoot || !criteriaRegisterJson || !journeysIndexJson) {
        throw new Error('assemble-suite requires <treeRoot> <criteriaRegisterJson> <journeysIndexJson>');
      }
      result = assembleSuite(treeRoot, JSON.parse(criteriaRegisterJson), JSON.parse(journeysIndexJson));
    } else if (command === 'order-run') {
      const [previousResultsJson, affectedMapJson, allJourneysJson] = rest;
      if (!previousResultsJson || !affectedMapJson || !allJourneysJson) {
        throw new Error('order-run requires <previousResultsJson> <affectedMapJson> <allJourneysJson>');
      }
      result = orderRun(JSON.parse(previousResultsJson), JSON.parse(affectedMapJson), JSON.parse(allJourneysJson));
    } else if (command === 'start-run') {
      const [treeRoot, runId, suiteJson] = rest;
      if (!treeRoot || !runId || !suiteJson) {
        throw new Error('start-run requires <treeRoot> <runId> <suiteJson>');
      }
      result = startRun(treeRoot, runId, JSON.parse(suiteJson));
    } else if (command === 'record-run') {
      const { positional, flags } = parseFlags(rest);
      const [treeRoot, runId, resultsJson, ledgerPath] = positional;
      if (!treeRoot || !runId || !resultsJson) {
        throw new Error('record-run requires <treeRoot> <runId> <resultsJson> <ledgerPath> [--unverified-import]');
      }
      result = recordRun(treeRoot, runId, JSON.parse(resultsJson), ledgerPath, { unverifiedImport: flags.unverifiedImport === true });
    } else if (command === 'compute-suite-state') {
      const { positional, flags } = parseFlags(rest);
      const [treeRoot, runId, quarantineJson, suiteJson] = positional;
      if (!treeRoot || !runId || !quarantineJson || !suiteJson) {
        throw new Error('compute-suite-state requires <treeRoot> <runId> <quarantineJson> <suiteJson> [--allow-unverified]');
      }
      result = computeSuiteState(treeRoot, runId, JSON.parse(quarantineJson), JSON.parse(suiteJson), {
        allowUnverified: flags.allowUnverified === true,
      });
    } else if (command === 'record-affected') {
      const [treeRoot, entriesJson] = rest;
      if (!treeRoot || !entriesJson) {
        throw new Error('record-affected requires <treeRoot> <entriesJson>');
      }
      result = recordAffected(treeRoot, JSON.parse(entriesJson));
    } else if (command === 'record-journey-run') {
      const [treeRoot, runId, journeyId, cmd, ledgerPath] = rest;
      if (!treeRoot || !runId || !journeyId || !cmd || !ledgerPath) {
        throw new Error('record-journey-run requires <treeRoot> <runId> <journeyId> <cmd> <ledgerPath>');
      }
      result = runJourney(treeRoot, runId, journeyId, cmd, ledgerPath);
    } else {
      throw new Error(
        `unknown command "${command}" (expected assemble-suite, order-run, start-run, record-run, compute-suite-state, record-affected, or record-journey-run)`
      );
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`verification.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  assembleSuite,
  // Exported for the ONE caller that must hold a journey to the same floor
  // before writing it: `journeys.js`, the catalog's writer. A writer free to
  // produce what this consumer will refuse is a build that discovers its own
  // malformed catalog a whole phase later, and a second copy of the rule is
  // how the two drift. The rule itself is unchanged and still owned here.
  isContainedScriptPath,
  orderRun,
  startRun,
  recordRun,
  computeSuiteState,
  recordAffected,
  runJourney,
  digestSuite,
  SUITE_STATE_SCHEMA_VERSION,
  RUNS_INDEX_SCHEMA_VERSION,
  RUN_STATUSES,
  HARNESSES,
};
