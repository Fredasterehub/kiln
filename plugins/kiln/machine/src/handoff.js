'use strict';

// The handoff pair's stop writer (P11 parked question (c), converged: "a
// purpose-named handoff-recorder seat backed by one `handoff.js write-stop
// <treeRoot>` machine command... accept a bounded stop payload on stdin,
// validate the closed stop-state vocabulary, append the stop event,
// atomically update state.json, and render handoff.md as a mechanical view
// carrying the same generation or event sequence"). Every Stop-state
// (agents/maestro.md's own section) writes this SAME pair before a turn
// ends — DONE, BLOCKED-OPERATOR, QUOTA-WAIT, BUDGET-CEILING, EXHAUSTED —
// through this one sanctioned writer, never hand-authored prose.
//
// Convergence finding 21 (non-negotiable): a mid-phase stop must never race
// a concurrent phase transition. This module's own state.json read-modify-
// write takes jsonl.js's own withLock directly, on state.json's exact path —
// the SAME shared lock atomic-json.js's updateJson takes on that file, which
// phases.js's advance()/closeTerminal()/reopenPhase() and preflight.js's
// run() already call through — never a second, parallel mechanism.
//
// P11 Sol review pass-3 (parked question (c), STILL-OPEN after pass-2's
// defects 3/4): writeStop and renderOnboarding are now ONE coherent critical
// section EACH, both held on state.json's own lock (`jsonl.js`'s `withLock`
// — the SAME lockfile `atomic-json.js`'s `updateJson` takes on this exact
// path, so phases.js's advance()/closeTerminal()/reopenPhase() and
// preflight.js's run() stay serialized against every handoff.md writer, not
// just against each other). Per this file's own transaction, in order: the
// state precondition is checked (a missing/malformed state.json throws
// before anything else runs); handoff.md's target containment is validated
// — lstat for an existing symlink, realpath for an escaping parent — BEFORE
// either mutation below, so a refusal here (pass-2 defect 2's own case)
// leaves ledger.jsonl and state.json untouched too, closing pass-2 defect
// 3's residual partial-mutation case; the ledger append allocates the seq;
// state.json's own write records that exact seq as `last_stop`; and ONLY
// THEN is handoff.md rendered and rename-committed, still inside this SAME
// lock — closing pass-2 defect 4's residual render race, where a delayed
// rename from an earlier call could overwrite a later call's committed
// ledger/state view (Sol's own repro: ledger max seq and state.json.last_stop
// at seq 2, handoff.md still naming seq 1). No concurrent writeStop or
// renderOnboarding call can observe or commit a partial slice of this
// transaction, and the two callers can no longer interleave their renders
// against each other either, since both hold the identical lock.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { readJson, writeAtomic } = require('./atomic-json.js');
const { withLock } = require('./jsonl.js');
const { appendRecord } = require('./stream.js');
const { validateStop, validateIntakeReport } = require('./validators.js');

const MISSING_STATE = Symbol('handoff.missing-state');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// realpathOfPossiblyMissing(p) — same "resolve what exists, reattach the
// rest literally" helper anonymize.js's own copy documents in full;
// duplicated here per doctrine rule 6's "one native mechanism per
// constraint" binding an invariant, not a shared utility across modules.
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

// validateContainedTarget(treeRoot, targetPath) — refuses (throws) if
// targetPath already exists as a symlink (P11 Sol review pass-2 defect 2's
// own probe: a scaffold with `handoff.md` replaced by a symlink to a
// sibling file), or if targetPath's real, symlink-resolved location falls
// outside treeRoot's own real path (a symlinked parent directory, or a
// symlink target that itself escapes the tree). Pure validation — no
// filesystem mutation of any kind — so a transaction can run this BEFORE
// its first mutation and fail closed with nothing written anywhere (P11 Sol
// review pass-3, parked question (c): the residual case where this check
// ran only after the ledger and state.json had already been committed).
function validateContainedTarget(treeRoot, targetPath) {
  let lst;
  try {
    lst = fs.lstatSync(targetPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    lst = null;
  }
  if (lst && lst.isSymbolicLink()) {
    throw new Error(`handoff: refusing to write through a symlinked target ("${targetPath}")`);
  }

  const treeRootReal = fs.realpathSync(treeRoot);
  const targetReal = realpathOfPossiblyMissing(targetPath);
  const rel = path.relative(treeRootReal, targetReal);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`handoff: target "${targetPath}" resolves outside treeRoot (via a symlinked parent)`);
  }
}

// writeContainedAtomic(targetPath, content) — the mechanical write half of
// the same discipline atomic-json.js's own writeAtomic already applies to
// JSON: a unique-temp-name, O_CREAT|O_EXCL, fsync, rename, cleanup-on-
// failure sequence, here over plain Markdown content rather than a
// JSON.stringify call over an object. Callers MUST have already run
// validateContainedTarget(treeRoot, targetPath) against this SAME
// targetPath earlier in the same transaction — this function performs no
// containment check of its own.
function writeContainedAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = path.join(
    dir,
    `.${path.basename(targetPath)}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  );
  const fd = fs.openSync(tmpFile, 'wx');
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmpFile, targetPath);
  } catch (err) {
    fs.rmSync(tmpFile, { force: true });
    throw err;
  }
}

// Purely mechanical: every line traces to a field already on `state` or
// `stop` — never invented prose (the "no event no line" law,
// applied here at the machine layer exactly as delivery.js's own renderers
// already apply it). No stop kind gets a narrated sentence; the reader gets
// the facts and, for BLOCKED-OPERATOR, the operator's own verbatim question.
function renderHandoffMd(state, stop, seq, ts) {
  const lines = [
    '# Handoff',
    '',
    `- Phase: ${isNonEmptyString(state.phase) ? state.phase : '(unknown)'}`,
    `- Next action: ${isNonEmptyString(state.next_action) ? state.next_action : '(unknown)'}`,
    `- Stop state: ${stop.stop_state}`,
    `- Reporter: ${stop.reporter}`,
    `- Stop recorded: ${ts} (ledger.jsonl seq ${seq})`,
  ];
  if (isNonEmptyString(stop.question)) {
    lines.push(`- Operator question: ${stop.question}`);
  }
  if (isNonEmptyString(stop.earliest_resume)) {
    lines.push(`- Earliest resume: ${stop.earliest_resume}`);
  }
  lines.push('');
  return lines.join('\n');
}

// writeStop(treeRoot, stop) -> {seq, stop, state} — the sole sanctioned
// writer of a "stop" ledger record. Refuses (throws) BEFORE any write if
// `stop` fails validateStop's closed-vocabulary check — nothing reaches
// disk on a malformed stop. Everything else — the state precondition
// check, handoff.md's containment validation, the ledger-first append, the
// state.json write, and handoff.md's render-and-rename — runs inside ONE
// `withLock` transaction on state.json's own lock, in that exact order, so
// every fallible check precedes the transaction's first mutation and the
// render is fully serialized against every other writeStop or
// renderOnboarding call (see this file's own header comment for why that
// closes pass-2 defects 3/4's residual cases under parked question (c)).
function writeStop(treeRoot, stop) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('handoff: treeRoot must be a non-empty string');
  }
  const { ok, errors } = validateStop(stop);
  if (!ok) {
    throw new TypeError(`handoff: invalid stop — ${errors.join('; ')}`);
  }

  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  const handoffPath = path.join(treeRoot, 'handoff.md');

  return withLock(statePath, () => {
    // Precondition FIRST — a missing/malformed state.json throws here,
    // before ANYTHING else in this transaction runs.
    const state = readJson(statePath, MISSING_STATE);
    if (state === MISSING_STATE) {
      throw new Error(`handoff: no state.json found at ${statePath} — scaffold the tree first`);
    }
    if (!isPlainObject(state)) {
      throw new Error(`handoff: state at ${statePath} must be a JSON object`);
    }

    // handoff.md's containment validated SECOND — still before either
    // mutation below, so a symlinked or escaping target now refuses with
    // the ledger and state.json both untouched (closing pass-2 defect 3's
    // residual case, where this check ran only after both were committed).
    validateContainedTarget(treeRoot, handoffPath);

    // Ledger-first (write-ahead), the same ordering discipline
    // phases.js's advance()/closeTerminal()/reopenPhase() already hold —
    // this is the transaction's first mutation, and the ONLY steps after it
    // are writes over already-validated targets: state.json's own write,
    // then handoff.md's render-and-rename, both still inside this lock so
    // no concurrent writeStop/renderOnboarding call can interleave a render
    // between two calls' ledger/state commits (closing pass-2 defect 4's
    // residual render race).
    const seq = appendRecord(ledgerPath, {
      kind: 'stop',
      payload: stop,
      correlation_id: stop.stop_state,
    });

    const nowIso = new Date().toISOString();
    const newState = {
      ...state,
      last_stop: { ...stop, seq, ts: nowIso },
      updated_utc: nowIso,
    };
    writeAtomic(statePath, newState);

    writeContainedAtomic(handoffPath, renderHandoffMd(newState, stop, seq, newState.updated_utc));

    return { seq, stop, state: newState };
  });
}

// renderOnboardingMd(state, settings, scoutInventory, intakeReport) — purely
// mechanical, same "no event no line" discipline renderHandoffMd already
// holds: every line traces to a field actually read this call, and a section
// whose backing fact isn't on disk is omitted outright, never guessed or
// stubbed.
function renderOnboardingMd(state, settings, scoutInventory, intakeReport) {
  const lines = [
    '# Handoff',
    '',
    `- Phase: ${isNonEmptyString(state.phase) ? state.phase : '(unknown)'}`,
    `- Next action: ${isNonEmptyString(state.next_action) ? state.next_action : '(unknown)'}`,
  ];
  const preflight = isPlainObject(state.preflight) ? state.preflight : null;
  if (preflight && isNonEmptyString(preflight.mode)) {
    const noticeDelivered = isNonEmptyString(preflight.notice) ? 'yes' : 'no';
    lines.push(`- Preflight mode: ${preflight.mode} (degraded-mode notice delivered: ${noticeDelivered})`);
  }
  if (isPlainObject(settings) && isNonEmptyString(settings.preset)) {
    lines.push(`- Settings preset: ${settings.preset} (see .kiln/views/settings-recap.md for the full recap)`);
  }
  if (isPlainObject(scoutInventory) && Array.isArray(scoutInventory.files)) {
    lines.push(`- Brownfield scout: completed, ${scoutInventory.files.length} file(s) inventoried`);
  }
  // The intake section (legacy-intake design §4.3 step (e)): present only
  // when intake.js's own report is on disk, under the same omit-when-absent
  // rule the scout line above already applies. `intakeReport` is already
  // schema-checked by the caller through validators.js's own
  // validateIntakeReport — the same law intake.js validates against before
  // writing the file, never a second reading of the shape here — so a
  // report this view cannot trust yields no line at all rather than a
  // half-true one. The line states counts and locations only; what the old
  // run proved is not restated, because nothing here carried it forward.
  if (intakeReport !== null) {
    lines.push(
      `- Intake: tier ${intakeReport.tier}, an earlier tree set aside whole at ${intakeReport.archive_path}, ` +
        `${intakeReport.carried.length} file(s) carried into intake/ (see intake/report.md for the full record)`
    );
  }
  lines.push('');
  return lines.join('\n');
}

// renderOnboarding(treeRoot) -> {content} — the SOLE other writer of
// handoff.md (P11 Sol review pass-2 defect 5: `onboarding-runner` was
// separately, directly overwriting the same file with its own `Write`
// tool, which meant a late onboarding close and a stop could race through
// two formats and two write mechanisms, only one of which participated in
// the state/ledger lock protocol). A mechanical view of onboarding facts
// already on disk — phase, next_action, preflight mode/notice, the
// settings preset, and (when present) scout's own completed inventory
// count — through the SAME contained atomic writer writeStop uses. Never
// touches ledger.jsonl or state.json's stop fields; this is a different
// mechanical view of different facts, not a stop. Reads and renders inside
// the SAME state.json lock writeStop takes (P11 Sol review pass-3, parked
// question (c)'s "cross-call view coherence" residual): the two sanctioned
// handoff.md writers are now fully serialized against each other, not just
// against phases.js/preflight.js's own state.json writes, so an onboarding
// close and a stop can no longer interleave their renders and leave
// handoff.md showing whichever one happened to rename last by accident.
function renderOnboarding(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('handoff: treeRoot must be a non-empty string');
  }
  const statePath = path.join(treeRoot, 'state.json');
  const settingsPath = path.join(treeRoot, 'settings.json');
  const scoutInventoryPath = path.join(treeRoot, 'scout', 'inventory.json');
  const intakeReportPath = path.join(treeRoot, 'intake', 'report.json');
  const handoffPath = path.join(treeRoot, 'handoff.md');

  return withLock(statePath, () => {
    const state = readJson(statePath, MISSING_STATE);
    if (state === MISSING_STATE) {
      throw new Error(`handoff: no state.json found at ${statePath} — scaffold the tree first`);
    }
    if (!isPlainObject(state)) {
      throw new Error(`handoff: state at ${statePath} must be a JSON object`);
    }
    validateContainedTarget(treeRoot, handoffPath);

    const settings = readJson(settingsPath, {});
    const scoutInventory = readJson(scoutInventoryPath, null);
    const intakeReportRaw = readJson(intakeReportPath, null);
    const intakeReport =
      intakeReportRaw !== null && validateIntakeReport(intakeReportRaw).ok ? intakeReportRaw : null;

    const content = renderOnboardingMd(state, settings, scoutInventory, intakeReport);
    writeContainedAtomic(handoffPath, content);
    return { content };
  });
}

// CLI entrypoint (this codebase's flat one-command convention). `write-stop
// <treeRoot>` reads the stop payload from stdin (the judge-verdict.js stdin
// pattern) — never argv JSON. `render-onboarding <treeRoot>` takes no
// stdin. parseArgv fails closed on a surplus positional argument (P11 Sol
// review finding 13).
function parseArgv(argv) {
  const [command, treeRoot, ...rest] = argv;
  const error = rest.length > 0 ? `unexpected extra argument(s): ${rest.join(' ')}` : null;
  return { command, treeRoot, error };
}

const USAGE =
  'usage: handoff.js write-stop <treeRoot>   (stop JSON piped via stdin)\n' +
  '       handoff.js render-onboarding <treeRoot>\n';

function main(argv) {
  const { command, treeRoot, error } = parseArgv(argv);
  if ((command !== 'write-stop' && command !== 'render-onboarding') || !isNonEmptyString(treeRoot) || error) {
    if (error) process.stderr.write(`handoff.js: ${error}\n`);
    process.stderr.write(USAGE);
    process.exit(1);
  }
  try {
    let result;
    if (command === 'render-onboarding') {
      result = renderOnboarding(treeRoot);
    } else {
      const stopText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
      let parsed;
      try {
        parsed = JSON.parse(stopText);
      } catch (err) {
        throw new Error(`write-stop: stop JSON via stdin is not valid JSON: ${err.message}`);
      }
      if (!isPlainObject(parsed)) {
        throw new Error('write-stop: stop JSON via stdin must be a JSON object');
      }
      result = writeStop(treeRoot, parsed);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`handoff.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { writeStop, renderOnboarding };
