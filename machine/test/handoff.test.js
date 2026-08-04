'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { writeStop, renderOnboarding } = require('../src/handoff.js');
const { scaffoldTree } = require('../src/scaffold.js');
const { archiveLegacyTree, harvestLegacy } = require('../src/intake.js');
const { readJson } = require('../src/atomic-json.js');
const { readRecords } = require('../src/stream.js');

const ROUTING_CONFIG = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');
const CLI_PATH = path.join(__dirname, '..', 'src', 'handoff.js');
const PHASES_CLI_PATH = path.join(__dirname, '..', 'src', 'phases.js');

function scaffoldedTreeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
  const projectRoot = path.join(dir, 'proj');
  scaffoldTree(projectRoot, { routingConfigPath: ROUTING_CONFIG });
  return path.join(projectRoot, '.thelastskill');
}

function statePathFor(treeRoot) {
  return path.join(treeRoot, 'state.json');
}

function ledgerPathFor(treeRoot) {
  return path.join(treeRoot, 'ledger.jsonl');
}

function handoffPathFor(treeRoot) {
  return path.join(treeRoot, 'handoff.md');
}

function makeStop(overrides) {
  return Object.assign({ stop_state: 'DONE', reporter: 'maestro' }, overrides);
}

// ---------- writeStop ----------

test('writeStop appends a "stop" ledger record and returns its seq', () => {
  const treeRoot = scaffoldedTreeRoot();
  const stop = makeStop();
  const result = writeStop(treeRoot, stop);
  assert.equal(typeof result.seq, 'number');
  assert.deepEqual(result.stop, stop);

  const { records } = readRecords(ledgerPathFor(treeRoot));
  const stopRecords = records.filter((r) => r.kind === 'stop');
  assert.equal(stopRecords.length, 1);
  assert.equal(stopRecords[0].stop_state, 'DONE');
  assert.equal(stopRecords[0].reporter, 'maestro');
  assert.equal(stopRecords[0].correlation_id, 'DONE');
});

test('writeStop updates state.json\'s last_stop field, preserving every other field', () => {
  const treeRoot = scaffoldedTreeRoot();
  const before = readJson(statePathFor(treeRoot));
  const stop = makeStop({ stop_state: 'BLOCKED-OPERATOR', question: 'Ship as-is or fix first?' });

  const result = writeStop(treeRoot, stop);

  const after = readJson(statePathFor(treeRoot));
  assert.equal(after.phase, before.phase);
  assert.equal(after.schema_version, before.schema_version);
  assert.deepEqual(after.last_stop, { ...stop, seq: result.seq, ts: after.updated_utc });
  assert.deepEqual(result.state, after);
});

test('writeStop renders handoff.md as a mechanical view carrying phase, stop_state, reporter, and the ledger seq', () => {
  const treeRoot = scaffoldedTreeRoot();
  const stop = makeStop({ stop_state: 'BLOCKED-OPERATOR', question: 'Which branch do we ship?' });
  const result = writeStop(treeRoot, stop);

  const content = fs.readFileSync(handoffPathFor(treeRoot), 'utf8');
  assert.match(content, /# Handoff/);
  assert.match(content, /Phase: onboarding/);
  assert.match(content, /Stop state: BLOCKED-OPERATOR/);
  assert.match(content, /Reporter: maestro/);
  assert.match(content, new RegExp(`seq ${result.seq}`));
  assert.match(content, /Operator question: Which branch do we ship\?/);
});

test('writeStop renders handoff.md with the earliest_resume line for QUOTA-WAIT, and no operator-question line', () => {
  const treeRoot = scaffoldedTreeRoot();
  writeStop(treeRoot, makeStop({ stop_state: 'QUOTA-WAIT', earliest_resume: '2026-07-30T00:00:00Z' }));
  const content = fs.readFileSync(handoffPathFor(treeRoot), 'utf8');
  assert.match(content, /Earliest resume: 2026-07-30T00:00:00Z/);
  assert.doesNotMatch(content, /Operator question:/);
});

test('writeStop throws and writes nothing for a malformed stop (invalid stop_state)', () => {
  const treeRoot = scaffoldedTreeRoot();
  const ledgerBefore = fs.readFileSync(ledgerPathFor(treeRoot), 'utf8');
  const stateBefore = fs.readFileSync(statePathFor(treeRoot), 'utf8');
  const handoffBefore = fs.readFileSync(handoffPathFor(treeRoot), 'utf8');

  assert.throws(() => writeStop(treeRoot, { stop_state: 'GIVING-UP', reporter: 'maestro' }), TypeError);

  assert.equal(fs.readFileSync(ledgerPathFor(treeRoot), 'utf8'), ledgerBefore);
  assert.equal(fs.readFileSync(statePathFor(treeRoot), 'utf8'), stateBefore);
  assert.equal(fs.readFileSync(handoffPathFor(treeRoot), 'utf8'), handoffBefore);
});

test('writeStop throws and writes nothing for BLOCKED-OPERATOR missing its required question', () => {
  const treeRoot = scaffoldedTreeRoot();
  const ledgerBefore = fs.readFileSync(ledgerPathFor(treeRoot), 'utf8');
  assert.throws(() => writeStop(treeRoot, makeStop({ stop_state: 'BLOCKED-OPERATOR' })), TypeError);
  assert.equal(fs.readFileSync(ledgerPathFor(treeRoot), 'utf8'), ledgerBefore);
});

test('writeStop throws TypeError for a missing/empty treeRoot', () => {
  assert.throws(() => writeStop('', makeStop()), TypeError);
  assert.throws(() => writeStop(undefined, makeStop()), TypeError);
});

test('writeStop throws a descriptive error when state.json does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
  assert.throws(() => writeStop(dir, makeStop()), /no state\.json found/);
});

// P11 Sol review pass-2 defect 3: the precondition check now runs FIRST,
// inside the same locked transaction as the ledger append — a missing
// state.json must leave the ledger with NOTHING, never a "stop" record
// written ahead of a state write that then throws.
test('writeStop against a missing state.json leaves ledger.jsonl entirely untouched (P11 Sol review pass-2 defect 3)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
  assert.throws(() => writeStop(dir, makeStop()), /no state\.json found/);
  assert.equal(fs.existsSync(path.join(dir, 'ledger.jsonl')), false);
});

// P11 Sol review pass-2 defect 2: a scaffold with handoff.md replaced by a
// symlink to a sibling file must be refused, not written through.
test('writeStop refuses a symlinked handoff.md and leaves the outside target untouched (Sol\'s own probe)', () => {
  const treeRoot = scaffoldedTreeRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-outside-'));
  const outsideFile = path.join(outsideDir, 'sibling.md');
  const originalContent = 'not the real handoff\n';
  fs.writeFileSync(outsideFile, originalContent);
  fs.rmSync(handoffPathFor(treeRoot));
  fs.symlinkSync(outsideFile, handoffPathFor(treeRoot));

  assert.throws(() => writeStop(treeRoot, makeStop()), /symlinked/);
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), originalContent);
});

// P11 Sol review pass-3, parked question (c): a write-stop that refuses on
// handoff.md's own containment must leave the WHOLE stop triple untouched —
// not just the outside symlink target. Before the fix, the containment
// check ran only after the ledger append and the state.json write had
// already committed, so a refusal here still left a "stop" record in
// ledger.jsonl and a mutated state.json.last_stop even though handoff.md
// itself never changed. Asserting ledger.jsonl and state.json are
// byte-identical before/after closes that residual.
test('writeStop refuses a symlinked handoff.md and leaves ledger.jsonl and state.json byte-identical (P11 Sol review pass-3, parked (c))', () => {
  const treeRoot = scaffoldedTreeRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-outside-'));
  const outsideFile = path.join(outsideDir, 'sibling.md');
  fs.writeFileSync(outsideFile, 'not the real handoff\n');
  fs.rmSync(handoffPathFor(treeRoot));
  fs.symlinkSync(outsideFile, handoffPathFor(treeRoot));

  const ledgerBefore = fs.readFileSync(ledgerPathFor(treeRoot), 'utf8');
  const stateBefore = fs.readFileSync(statePathFor(treeRoot), 'utf8');

  assert.throws(() => writeStop(treeRoot, makeStop()), /symlinked/);

  assert.equal(fs.readFileSync(ledgerPathFor(treeRoot), 'utf8'), ledgerBefore);
  assert.equal(fs.readFileSync(statePathFor(treeRoot), 'utf8'), stateBefore);
});


// ---------- CLI: write-stop ----------

test('CLI: write-stop reads the stop JSON from stdin and writes the pair', () => {
  const treeRoot = scaffoldedTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-stop', treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify(makeStop()),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.stop.stop_state, 'DONE');
  assert.equal(readJson(statePathFor(treeRoot)).last_stop.stop_state, 'DONE');
  assert.match(fs.readFileSync(handoffPathFor(treeRoot), 'utf8'), /Stop state: DONE/);
});

test('CLI: write-stop exits 1 and writes nothing for a malformed stop', () => {
  const treeRoot = scaffoldedTreeRoot();
  const stateBefore = fs.readFileSync(statePathFor(treeRoot), 'utf8');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-stop', treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify({ stop_state: 'DONE' }), // missing reporter
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /handoff\.js:/);
  assert.equal(fs.readFileSync(statePathFor(treeRoot), 'utf8'), stateBefore);
});

test('CLI: write-stop exits 1 for an unexpected extra key', () => {
  const treeRoot = scaffoldedTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-stop', treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify(Object.assign(makeStop(), { extra: 'smuggled' })),
  });
  assert.equal(proc.status, 1);
});

test('CLI: write-stop exits 1 on invalid JSON via stdin', () => {
  const treeRoot = scaffoldedTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-stop', treeRoot], { encoding: 'utf8', input: 'not json' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /handoff\.js:/);
});

test('CLI: write-stop exits 1 when a non-object JSON value is piped via stdin', () => {
  const treeRoot = scaffoldedTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-stop', treeRoot], { encoding: 'utf8', input: '"just a string"' });
  assert.equal(proc.status, 1);
});

test('CLI: missing treeRoot argument prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-stop'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: handoff\.js write-stop/);
});

test('CLI: unknown command prints usage and exits 1', () => {
  const treeRoot = scaffoldedTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'delete-everything', treeRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: handoff\.js write-stop/);
});

// ---------- Cross-module concurrency (P11 convergence finding 21's own
// non-negotiable condition: "handoff.js write-stop must participate in the
// same state lock or generation compare-and-swap as every other state.json
// read-modify-write" — proven here against phases.js's advance(), not
// merely against another handoff.js caller) ----------

test('handoff.js write-stop and phases.js advance() racing the SAME state.json never lose either update', async () => {
  const treeRoot = scaffoldedTreeRoot();

  const runChild = (cliArgs, input) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, cliArgs);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => {
        stdout += c;
      });
      child.stderr.on('data', (c) => {
        stderr += c;
      });
      if (input !== undefined) {
        child.stdin.write(input);
      }
      child.stdin.end();
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });

  const [advanceResult, stopResult] = await Promise.all([
    runChild([PHASES_CLI_PATH, 'advance', treeRoot]),
    runChild([CLI_PATH, 'write-stop', treeRoot], JSON.stringify(makeStop({ stop_state: 'BUDGET-CEILING' }))),
  ]);

  assert.equal(advanceResult.code, 0, advanceResult.stderr);
  assert.equal(stopResult.code, 0, stopResult.stderr);

  const finalState = readJson(statePathFor(treeRoot));
  // The phase transition landed...
  assert.equal(finalState.phase, 'brainstorm');
  // ...AND the stop was recorded — neither write erased the other's effect.
  assert.equal(finalState.last_stop.stop_state, 'BUDGET-CEILING');

  const { records } = readRecords(ledgerPathFor(treeRoot));
  assert.equal(records.filter((r) => r.kind === 'phase-transition').length, 1);
  assert.equal(records.filter((r) => r.kind === 'stop').length, 1);
});

// P11 Sol review pass-2 defect 4: the ledger append and the state.json
// write must now serialize as ONE transaction under state.json's own lock —
// a 24-process probe previously landed every stop record while
// state.json.last_stop.seq lagged far behind the max ledger seq. Proven
// here with several competing `write-stop` CLI processes: whichever
// process's transaction is the LAST to release the state.json lock is, by
// construction, the one that appended the highest ledger seq — so its own
// state write must be the one state.json ends up holding.
test('several competing write-stop calls racing the same treeRoot never desync state.json.last_stop.seq from the latest stop record (P11 Sol review pass-2 defect 4)', async () => {
  const treeRoot = scaffoldedTreeRoot();

  const runChild = (input) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, 'write-stop', treeRoot]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => {
        stdout += c;
      });
      child.stderr.on('data', (c) => {
        stderr += c;
      });
      child.stdin.write(input);
      child.stdin.end();
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });

  const WORKER_COUNT = 8;
  const results = await Promise.all(
    Array.from({ length: WORKER_COUNT }, (_, i) =>
      runChild(JSON.stringify(makeStop({ stop_state: 'BUDGET-CEILING', reporter: `worker-${i}` })))
    )
  );
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
  }

  const finalState = readJson(statePathFor(treeRoot));
  const { records } = readRecords(ledgerPathFor(treeRoot));
  const stopRecords = records.filter((r) => r.kind === 'stop');
  assert.equal(stopRecords.length, WORKER_COUNT);
  const maxSeq = Math.max(...stopRecords.map((r) => r.seq));
  assert.equal(finalState.last_stop.seq, maxSeq);
});

// P11 Sol review pass-3, parked question (c): before the render moved
// inside state.json's own lock, a delayed handoff.md rename from an
// earlier-committed call could overwrite a later call's already-committed
// ledger/state view (Sol's own repro: ledger max seq and
// state.json.last_stop landed at seq 2, but handoff.md still named seq 1).
// With the render now fully serialized inside the same lock as the ledger
// append and the state write, handoff.md must always name the SAME stop
// state.json.last_stop and the ledger's own maximum-seq stop record name —
// deterministically, with no injection hooks needed to provoke the race.
test('several competing write-stop calls racing the same treeRoot leave handoff.md naming the SAME stop as state.json.last_stop and the max-seq ledger record (P11 Sol review pass-3, parked (c))', async () => {
  const treeRoot = scaffoldedTreeRoot();

  const runChild = (input) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, 'write-stop', treeRoot]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => {
        stdout += c;
      });
      child.stderr.on('data', (c) => {
        stderr += c;
      });
      child.stdin.write(input);
      child.stdin.end();
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });

  const WORKER_COUNT = 8;
  const results = await Promise.all(
    Array.from({ length: WORKER_COUNT }, (_, i) =>
      runChild(JSON.stringify(makeStop({ stop_state: 'BUDGET-CEILING', reporter: `worker-${i}` })))
    )
  );
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
  }

  const finalState = readJson(statePathFor(treeRoot));
  const { records } = readRecords(ledgerPathFor(treeRoot));
  const stopRecords = records.filter((r) => r.kind === 'stop');
  const maxSeq = Math.max(...stopRecords.map((r) => r.seq));
  const maxSeqRecord = stopRecords.find((r) => r.seq === maxSeq);

  const handoffContent = fs.readFileSync(handoffPathFor(treeRoot), 'utf8');
  const seqMatch = handoffContent.match(/seq (\d+)\)/);
  const reporterMatch = handoffContent.match(/Reporter: (\S+)/);
  assert.ok(seqMatch, 'handoff.md must name a ledger seq');
  assert.ok(reporterMatch, 'handoff.md must name a reporter');
  const renderedSeq = Number(seqMatch[1]);

  assert.equal(renderedSeq, finalState.last_stop.seq);
  assert.equal(renderedSeq, maxSeq);
  assert.equal(reporterMatch[1], finalState.last_stop.reporter);
  assert.equal(reporterMatch[1], maxSeqRecord.reporter);
});

// ---------- renderOnboarding (P11 Sol review pass-2 defect 5) ----------

test('renderOnboarding writes a mechanical view naming phase, next_action, preflight mode, and settings preset', () => {
  const treeRoot = scaffoldedTreeRoot();
  const statePath = statePathFor(treeRoot);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.preflight = { mode: 'full-cross-family', notice: null };
  fs.writeFileSync(statePath, JSON.stringify(state));
  fs.writeFileSync(path.join(treeRoot, 'settings.json'), JSON.stringify({ preset: 'balanced' }));

  const { content } = renderOnboarding(treeRoot);
  assert.match(content, /# Handoff/);
  assert.match(content, /Phase: onboarding/);
  assert.match(content, /Preflight mode: full-cross-family/);
  assert.match(content, /Settings preset: balanced/);
  assert.equal(fs.readFileSync(handoffPathFor(treeRoot), 'utf8'), content);
});

test('renderOnboarding names the degraded-mode notice as delivered when preflight recorded one', () => {
  const treeRoot = scaffoldedTreeRoot();
  const statePath = statePathFor(treeRoot);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.preflight = { mode: 'degraded-claude-only', notice: 'GPT-5.6-Sol isn\'t reachable right now...' };
  fs.writeFileSync(statePath, JSON.stringify(state));

  const { content } = renderOnboarding(treeRoot);
  assert.match(content, /Preflight mode: degraded-claude-only \(degraded-mode notice delivered: yes\)/);
});

test('renderOnboarding cites scout\'s own inventoried file count when scout/inventory.json exists', () => {
  const treeRoot = scaffoldedTreeRoot();
  fs.mkdirSync(path.join(treeRoot, 'scout'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'scout', 'inventory.json'), JSON.stringify({ files: [{ path: 'a.js' }, { path: 'b.js' }] }));

  const { content } = renderOnboarding(treeRoot);
  assert.match(content, /Brownfield scout: completed, 2 file\(s\) inventoried/);
});

test('renderOnboarding throws a descriptive error when state.json does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
  assert.throws(() => renderOnboarding(dir), /no state\.json found/);
});

test('renderOnboarding refuses a symlinked handoff.md, matching writeStop\'s own containment', () => {
  const treeRoot = scaffoldedTreeRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-outside-'));
  const outsideFile = path.join(outsideDir, 'sibling.md');
  fs.writeFileSync(outsideFile, 'not the real handoff\n');
  fs.rmSync(handoffPathFor(treeRoot));
  fs.symlinkSync(outsideFile, handoffPathFor(treeRoot));

  assert.throws(() => renderOnboarding(treeRoot), /symlinked/);
});

// ---------- the intake section (legacy-intake design §4.3 step (e)) ----------
// Both tests run the REAL intake pipeline rather than planting a hand-written
// report.json: the section's whole contract is that every clause traces to a
// field intake.js actually wrote, so a fixture report that drifted from the
// harvester's own shape would prove nothing.

test('renderOnboarding renders an intake section from intake/report.json when one is on disk', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-intake-')));
  fs.cpSync(path.join(__dirname, 'fixtures', 'legacy-v3-released'), path.join(dir, '.thelastskill'), {
    recursive: true,
  });
  const txn = archiveLegacyTree(dir, { routingConfigPath: ROUTING_CONFIG });
  const treeRoot = path.join(dir, '.thelastskill');
  const report = harvestLegacy(treeRoot, path.join(dir, txn.archive_path));

  const { content } = renderOnboarding(treeRoot);
  assert.match(
    content,
    new RegExp(
      `- Intake: tier ${report.tier}, an earlier tree set aside whole at ${report.archive_path.replace(/\./g, '\\.')}, ` +
        `${report.carried.length} file\\(s\\) carried into intake/ \\(see intake/report\\.md for the full record\\)`
    )
  );
  assert.equal(fs.readFileSync(handoffPathFor(treeRoot), 'utf8'), content);
});

test('renderOnboarding omits the intake section when intake/report.json is absent', () => {
  const treeRoot = scaffoldedTreeRoot();
  assert.equal(fs.existsSync(path.join(treeRoot, 'intake', 'report.json')), false);

  const { content } = renderOnboarding(treeRoot);
  assert.doesNotMatch(content, /Intake/);
});

test('CLI: render-onboarding prints {content} and writes handoff.md', () => {
  const treeRoot = scaffoldedTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'render-onboarding', treeRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.match(printed.content, /# Handoff/);
  assert.equal(fs.readFileSync(handoffPathFor(treeRoot), 'utf8'), printed.content);
});

test('CLI: a surplus positional argument is refused (P11 Sol review finding 13)', () => {
  const treeRoot = scaffoldedTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'render-onboarding', treeRoot, 'extra'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /unexpected extra argument/);
});
