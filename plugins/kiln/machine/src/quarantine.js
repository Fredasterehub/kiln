'use strict';

// The flake protocol (ruled: "flake quarantine re-run-once";
// research/phase7-verification-research.md: "failure -> immediate single
// re-run. Consistent red = real fix task. Inconsistent = quarantine lane +
// flake-fix task + flip counter in state (PFS-lite)."). quarantine.json
// {schema_version, entries:[{journey_id, since_run, reason, history}]} holds
// exactly the journeys currently under active flake tracking. `history` is
// an array of {outcome, run_id} objects (P8 required revision #5, tightened
// this pass) rather than bare outcome strings — decideFlake now needs each
// outcome's own run_id to enforce that a verdict is reached over two
// DISTINCT runs, never the same run counted twice.
//
// PENDING vs. DECIDED (verification.js's own computeSuiteState reads this
// distinction directly): an entry with history.length === 1 is a journey
// mid-incident — one outcome in, awaiting its one re-run — and still votes
// normally. Only history.length === 2 (a "quarantine" verdict was actually
// reached and persisted) removes a journey's vote. A journey never sits in
// entries[] for longer than its verdict stays "quarantine": decideFlake
// resolving to "clear" (consistently passing again) or "fix-task"
// (consistently, non-flakily failing — a real bug that must keep voting
// red, not hide behind quarantine) both remove it. Once decided, a THIRD
// recordOutcome call for the same journey is refused — release() (the
// repaired path) is the only sanctioned way to reopen tracking.
//
// Fix-loop cap (ruled: "fix loops capped 2 passes per same/similar
// problem -> agreement pass") lives in the same module as a second, smaller
// concern (capTracker) — it shares this file's "count occurrences in a
// verification/ JSONL stream, decide against a small threshold" shape with
// the flake protocol above, without duplicating either one's mechanism.

const path = require('node:path');

const { readJson, writeAtomic } = require('./atomic-json.js');
const { readRecords, appendRecord } = require('./stream.js');

const QUARANTINE_SCHEMA_VERSION = 1;
const OUTCOMES = new Set(['pass', 'fail']);
const FIX_LOOP_CAP = 2;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readQuarantineDoc(quarantinePath) {
  return readJson(quarantinePath, { schema_version: QUARANTINE_SCHEMA_VERSION, entries: [] });
}

// A quarantine.json path is always <treeRoot>/verification/quarantine.json
// (product/verification/flow.md's own tree shape) — its sibling
// suite-state.json is derivable without a separate treeRoot argument.
function suiteStatePathFromQuarantinePath(quarantinePath) {
  return path.join(path.dirname(quarantinePath), 'suite-state.json');
}

// Any quarantine mutation that changes a journey's decided-quarantine
// status invalidates whatever green/red verdict is currently persisted in
// suite-state.json — that verdict was computed against a DIFFERENT
// quarantine membership than the one that now exists, and a stale green
// must never be consumable by the "suite-state-green" exit check (P8
// required revision #5). Marking `status: "stale"` (rather than deleting
// the file) is deliberately non-destructive: it fails the exit check's
// existing `status !== "green"` branch with no changes needed there, while
// preserving the prior snapshot's audit trail. A no-op when suite-state.json
// does not exist yet, or is already stale.
function markSuiteStateStale(quarantinePath) {
  const suiteStatePath = suiteStatePathFromQuarantinePath(quarantinePath);
  const existing = readJson(suiteStatePath, null);
  if (!isPlainObject(existing) || existing.status === 'stale') return;
  writeAtomic(suiteStatePath, { ...existing, status: 'stale' });
}

// decideFlake(history) -> "fix-task" | "quarantine" | "clear". Requires
// EXACTLY 2 outcomes (P8 required revision #5: the re-run-once protocol is
// "the original failure and ONE re-run," never an open-ended trailing
// window), each an {outcome, run_id} object, and the two run_ids must be
// DISTINCT — a verdict decided over the same run counted twice is not a
// re-run at all, and fails closed by throwing rather than guessing.
//   - every outcome in the window is "fail"  -> "fix-task" (failed twice
//     consistently, across two distinct runs; a real bug, not flake noise)
//   - every outcome in the window is "pass"  -> "clear" (healthy)
//   - a mix of "pass" and "fail"             -> "quarantine" (the
//     fail-then-pass — or pass-then-fail — inconsistency the re-run-once
//     protocol exists to catch)
function decideFlake(history) {
  if (!Array.isArray(history) || history.length !== 2) {
    throw new TypeError(
      'quarantine: decideFlake requires an array of EXACTLY 2 outcomes (the original run and its one re-run) to decide a verdict'
    );
  }
  history.forEach((entry, index) => {
    if (!isPlainObject(entry) || !OUTCOMES.has(entry.outcome) || !isNonEmptyString(entry.run_id)) {
      throw new TypeError(
        `quarantine: history[${index}] must be an object {outcome: "pass"|"fail", run_id: <non-empty string>} (got ${JSON.stringify(entry)})`
      );
    }
  });
  if (history[0].run_id === history[1].run_id) {
    throw new TypeError(
      'quarantine: decideFlake requires the two outcomes to carry DISTINCT run_id values — the original run and a genuinely different re-run'
    );
  }

  const allPass = history.every((entry) => entry.outcome === 'pass');
  const allFail = history.every((entry) => entry.outcome === 'fail');
  if (allPass) return 'clear';
  if (allFail) return 'fix-task';
  return 'quarantine';
}

// recordOutcome(quarantinePath, journeyId, outcome, opts) — tracks a
// journey's outcomes across the re-run-once protocol. opts.runId is now
// REQUIRED (P8 required revision #5) — every recorded outcome must be
// traceable to the run that produced it, since decideFlake needs it to
// enforce distinct-run re-runs. A passing outcome for a journey with no
// open tracking entry needs no bookkeeping (nothing to decide, nothing to
// record). A journey already carrying a DECIDED quarantine entry (2
// outcomes) refuses a third — release() (the repaired path) is the only
// sanctioned way to reopen tracking for it. A re-run using the SAME runId
// as the original failure is refused (not a genuine re-run).
//
// Returns { doc, verdict } where verdict is decideFlake's own return value,
// or null when this is the first outcome (not yet enough evidence to
// decide).
function recordOutcome(quarantinePath, journeyId, outcome, opts = {}) {
  if (!isNonEmptyString(quarantinePath)) {
    throw new TypeError('quarantine: quarantinePath must be a non-empty string');
  }
  if (!isNonEmptyString(journeyId)) {
    throw new TypeError('quarantine: journeyId must be a non-empty string');
  }
  if (!OUTCOMES.has(outcome)) {
    throw new TypeError(`quarantine: outcome must be "pass" or "fail" (got ${JSON.stringify(outcome)})`);
  }
  if (!isNonEmptyString(opts.runId)) {
    throw new TypeError(
      'quarantine: recordOutcome requires a non-empty opts.runId — every outcome must be traceable to the run that produced it (re-run-once enforcement)'
    );
  }

  const doc = readQuarantineDoc(quarantinePath);
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  const index = entries.findIndex((entry) => isPlainObject(entry) && entry.journey_id === journeyId);

  if (index === -1 && outcome === 'pass') {
    return { doc, verdict: 'clear' };
  }

  const existing = index === -1 ? null : entries[index];
  const priorHistory = existing && Array.isArray(existing.history) ? existing.history : [];

  if (priorHistory.length >= 2) {
    throw new Error(
      `quarantine: journey "${journeyId}" already carries a decided quarantine verdict (${priorHistory.length} outcomes) — recordOutcome refuses a third outcome; release() it first (the repaired path)`
    );
  }

  if (priorHistory.length === 1 && priorHistory[0].run_id === opts.runId) {
    throw new TypeError(
      `quarantine: recordOutcome's re-run for journey "${journeyId}" must use a run id distinct from the original failure's "${priorHistory[0].run_id}" — the flake protocol re-runs under a NEW runId`
    );
  }

  const newOutcome = { outcome, run_id: opts.runId };
  const history = [...priorHistory, newOutcome];
  const verdict = history.length >= 2 ? decideFlake(history) : null;

  let nextEntries;
  if (verdict === 'clear' || verdict === 'fix-task') {
    nextEntries = index === -1 ? entries : entries.filter((_, i) => i !== index);
  } else if (index === -1) {
    nextEntries = [
      ...entries,
      {
        journey_id: journeyId,
        since_run: opts.runId,
        reason: isNonEmptyString(opts.reason) ? opts.reason : null,
        history,
      },
    ];
  } else {
    nextEntries = entries.map((entry, i) => (i === index ? { ...entry, history } : entry));
  }

  const newDoc = { schema_version: QUARANTINE_SCHEMA_VERSION, entries: nextEntries };
  writeAtomic(quarantinePath, newDoc);
  // Every branch above except the early "lone pass, no-op" return actually
  // mutates quarantine.json — a suite-state.json snapshot computed before
  // this call may no longer reflect the current quarantine membership.
  markSuiteStateStale(quarantinePath);
  return { doc: newDoc, verdict };
}

// release(quarantinePath, journeyId) — an explicit, administrative release
// (e.g. right after a fix commit, before any new outcome has been recorded),
// distinct from recordOutcome's own data-driven "clear" removal above. Also
// the ONLY sanctioned way to reopen tracking for a journey whose entry was
// already decided (recordOutcome refuses a third outcome otherwise).
function release(quarantinePath, journeyId) {
  if (!isNonEmptyString(quarantinePath)) {
    throw new TypeError('quarantine: quarantinePath must be a non-empty string');
  }
  if (!isNonEmptyString(journeyId)) {
    throw new TypeError('quarantine: journeyId must be a non-empty string');
  }

  const doc = readQuarantineDoc(quarantinePath);
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  const hadEntry = entries.some((entry) => isPlainObject(entry) && entry.journey_id === journeyId);
  const nextEntries = entries.filter((entry) => !(isPlainObject(entry) && entry.journey_id === journeyId));

  const newDoc = { schema_version: QUARANTINE_SCHEMA_VERSION, entries: nextEntries };
  writeAtomic(quarantinePath, newDoc);
  if (hadEntry) markSuiteStateStale(quarantinePath);
  return newDoc;
}

function fixAttemptsPathOf(treeRoot) {
  return path.join(treeRoot, 'verification', 'fix-attempts.jsonl');
}

// capTracker(treeRoot) — the fix-loop cap (ruled: "capped 2 passes per
// same/similar problem -> agreement pass"). recordAttempt logs one fix
// attempt against a problemKey (the caller's own identity for "same/similar
// problem" — this identity remains caller judgment, a semantic boundary the
// machine cannot itself draw: two failures the caller judges to share a
// root cause must be given the SAME problemKey for the cap to bind them
// together, and nothing here can verify that judgment was made honestly);
// atCap reports whether that key has reached the cap. checkAndRecord
// (P8 required revision #6) is the atomic combined operation: it checks the
// cap BEFORE recording, so a third attempt can never slip in between a
// caller's own separate atCap-then-recordAttempt calls — it refuses instead
// of recording. Record only — the machine never spawns the agreement pass
// itself, it only makes the fact machine-checkable for whatever flow
// consumes checkAndRecord's/atCap's answer.
function capTracker(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('quarantine: treeRoot must be a non-empty string');
  }

  const attemptsPath = fixAttemptsPathOf(treeRoot);

  function countFor(problemKey) {
    if (!isNonEmptyString(problemKey)) {
      throw new TypeError('quarantine: problemKey must be a non-empty string');
    }
    const { records } = readRecords(attemptsPath);
    return records.filter(
      (record) => isPlainObject(record) && record.kind === 'fix-attempt' && record.problem_key === problemKey
    ).length;
  }

  function recordAttempt(problemKey) {
    if (!isNonEmptyString(problemKey)) {
      throw new TypeError('quarantine: problemKey must be a non-empty string');
    }
    return appendRecord(attemptsPath, {
      kind: 'fix-attempt',
      payload: { problem_key: problemKey },
      correlation_id: problemKey,
    });
  }

  function atCap(problemKey) {
    return countFor(problemKey) >= FIX_LOOP_CAP;
  }

  // checkAndRecord — refuses BEFORE writing, at the cap, rather than
  // recording a third attempt and letting the caller notice atCap()
  // separately (the gap a two-call check-then-record sequence leaves open
  // to a race, or simply to a caller that forgets to check first).
  function checkAndRecord(problemKey) {
    if (atCap(problemKey)) {
      return { allowed: false, agreement_pass_required: true, count: countFor(problemKey) };
    }
    recordAttempt(problemKey);
    return { allowed: true, agreement_pass_required: false, count: countFor(problemKey) };
  }

  return { attemptsPath, recordAttempt, countFor, atCap, checkAndRecord };
}

// CLI entrypoint (product/verification/flow.md's own "Bash, narrowly"
// widening — the same named-machine-layer-CLI convention milestones.js/
// phases.js already establish). `cap-record-attempt`/`cap-at-cap`/
// `cap-check-and-record` curry capTracker(treeRoot) themselves so the CLI
// surface stays flat, one command per call, matching every other module's
// convention rather than exposing the factory shape directly.
function parseArgv(argv) {
  const [command, ...rest] = argv;
  return { command, rest };
}

function main(argv) {
  const { command, rest } = parseArgv(argv);
  try {
    let result;
    if (command === 'decide-flake') {
      const [historyJson] = rest;
      if (!historyJson) throw new Error('decide-flake requires <historyJson>');
      result = decideFlake(JSON.parse(historyJson));
    } else if (command === 'record-outcome') {
      const [quarantinePath, journeyId, outcome, ...flags] = rest;
      if (!quarantinePath || !journeyId || !outcome) {
        throw new Error('record-outcome requires <quarantinePath> <journeyId> <outcome> --run-id X [--reason Y]');
      }
      const opts = {};
      for (let i = 0; i < flags.length; i++) {
        if (flags[i] === '--run-id') {
          opts.runId = flags[i + 1];
          i++;
        } else if (flags[i] === '--reason') {
          opts.reason = flags[i + 1];
          i++;
        }
      }
      result = recordOutcome(quarantinePath, journeyId, outcome, opts);
    } else if (command === 'release') {
      const [quarantinePath, journeyId] = rest;
      if (!quarantinePath || !journeyId) throw new Error('release requires <quarantinePath> <journeyId>');
      result = release(quarantinePath, journeyId);
    } else if (command === 'cap-record-attempt') {
      const [treeRoot, problemKey] = rest;
      if (!treeRoot || !problemKey) throw new Error('cap-record-attempt requires <treeRoot> <problemKey>');
      result = { seq: capTracker(treeRoot).recordAttempt(problemKey) };
    } else if (command === 'cap-at-cap') {
      const [treeRoot, problemKey] = rest;
      if (!treeRoot || !problemKey) throw new Error('cap-at-cap requires <treeRoot> <problemKey>');
      result = { atCap: capTracker(treeRoot).atCap(problemKey) };
    } else if (command === 'cap-check-and-record') {
      const [treeRoot, problemKey] = rest;
      if (!treeRoot || !problemKey) throw new Error('cap-check-and-record requires <treeRoot> <problemKey>');
      result = capTracker(treeRoot).checkAndRecord(problemKey);
    } else {
      throw new Error(
        `unknown command "${command}" (expected decide-flake, record-outcome, release, cap-record-attempt, cap-at-cap, or cap-check-and-record)`
      );
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`quarantine.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  decideFlake,
  recordOutcome,
  release,
  capTracker,
  QUARANTINE_SCHEMA_VERSION,
  FIX_LOOP_CAP,
};
