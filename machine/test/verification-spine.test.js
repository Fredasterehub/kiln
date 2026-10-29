'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const { nextTransition, TRANSITIONS, RETURNS } = require('../src/verification-spine.js');
const {
  assembleSuite,
  startRun,
  runJourney,
  computeSuiteState,
  recordAffected,
  digestSuite,
} = require('../src/verification.js');
const { recordOutcome } = require('../src/quarantine.js');
const { readJson, writeAtomic } = require('../src/atomic-json.js');

const MODULE_PATH = path.resolve(__dirname, '..', 'src', 'verification-spine.js');

// ---------- the tree, built by the writers that own each file ----------

function makeTree() {
  const treeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verification-spine-test-'));
  fs.mkdirSync(path.join(treeRoot, 'architecture'), { recursive: true });
  fs.mkdirSync(path.join(treeRoot, 'verification'), { recursive: true });
  return treeRoot;
}

const CRITERIA = ['c1', 'c2'];

function journeyEntry(criterionId) {
  return {
    journey_id: `j-${criterionId}`,
    criterion_id: criterionId,
    script_path: `test/${criterionId}.test.js`,
    harness: 'node-test',
    added_in_milestone: 'M1',
  };
}

function registerPath(treeRoot) {
  return path.join(treeRoot, 'architecture', 'criteria-register.json');
}

function catalogPath(treeRoot) {
  return path.join(treeRoot, 'verification', 'journeys.json');
}

function ledgerPathOf(treeRoot) {
  return path.join(treeRoot, 'ledger.jsonl');
}

function writeRegister(treeRoot, ids = CRITERIA) {
  writeAtomic(registerPath(treeRoot), {
    schema_version: 1,
    criteria: ids.map((id) => ({
      id,
      text: `criterion ${id}`,
      source_ref: 'vision.md#1',
      journey_id: `j-${id}`,
    })),
  });
}

function writeCatalog(treeRoot, ids = CRITERIA) {
  writeAtomic(catalogPath(treeRoot), { schema_version: 1, journeys: ids.map(journeyEntry) });
}

// The assembled universe, through the assembler production uses. A fixture
// that hand-built the suite array would be binding the resolver to a shape
// `assembleSuite` never produces.
function assembledSuite(treeRoot) {
  const result = assembleSuite(treeRoot, readJson(registerPath(treeRoot), null), readJson(catalogPath(treeRoot), null));
  assert.equal(result.ok, true, `the fixture's own catalog does not assemble: ${(result.errors || []).join('; ')}`);
  return result.journeys;
}

// A journey really executed and really recorded: `runJourney` runs the command
// through the one sanctioned execution mechanism and writes the ledger evidence
// `recordRun` demands. Stamping a `journey-result` by hand would supply exactly
// the fact production refuses to take on trust.
function runJourneys(treeRoot, runId, journeyIds, cmd = 'true') {
  for (const journeyId of journeyIds) {
    runJourney(treeRoot, runId, journeyId, cmd, ledgerPathOf(treeRoot));
  }
}

function startAndRun(treeRoot, runId, journeyIds, cmd = 'true') {
  startRun(treeRoot, runId, assembledSuite(treeRoot));
  runJourneys(treeRoot, runId, journeyIds, cmd);
}

function computeFor(treeRoot, runId) {
  const quarantine = readJson(path.join(treeRoot, 'verification', 'quarantine.json'), { schema_version: 1, entries: [] });
  return computeSuiteState(treeRoot, runId, quarantine, assembledSuite(treeRoot));
}

// ---------- the reachable green-path states, as a table ----------
//
// Every state the green path can durably reach, each built by the writers that
// own it. The three law tests below (totality, durable evidence, purity) drive
// this same table, so a state added here is held to all of them at once.
const STATES = [
  {
    name: 'nothing on disk at all',
    build: () => {},
    transition: TRANSITIONS.BLOCKED,
  },
  {
    name: 'a catalog with no criteria register beside it',
    build: (treeRoot) => writeCatalog(treeRoot),
    transition: TRANSITIONS.BLOCKED,
  },
  {
    name: 'a register with no catalog beside it',
    build: (treeRoot) => writeRegister(treeRoot),
    transition: TRANSITIONS.BLOCKED,
  },
  {
    name: 'a catalog that does not assemble against its register',
    build: (treeRoot) => {
      writeRegister(treeRoot, ['c1']);
      writeCatalog(treeRoot, ['c1', 'c2']);
    },
    transition: TRANSITIONS.BLOCKED,
  },
  {
    name: 'an assembled suite and no run',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
    },
    transition: TRANSITIONS.START_RUN,
  },
  {
    name: 'a run started and nothing recorded',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startRun(treeRoot, 'r1', assembledSuite(treeRoot));
    },
    transition: TRANSITIONS.RUN_JOURNEY,
  },
  {
    name: 'a run partially recorded',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startAndRun(treeRoot, 'r1', ['j-c1']);
    },
    transition: TRANSITIONS.RUN_JOURNEY,
  },
  {
    name: 'a run fully recorded and not yet computed',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
    },
    transition: TRANSITIONS.COMPUTE_SUITE_STATE,
  },
  {
    name: 'a suite-state computed for a run the newest run has superseded',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
      computeFor(treeRoot, 'r1');
      startAndRun(treeRoot, 'r2', ['j-c1', 'j-c2']);
    },
    transition: TRANSITIONS.COMPUTE_SUITE_STATE,
  },
  {
    name: 'a suite that changed after the current run bound its digest',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
      writeRegister(treeRoot, ['c1', 'c2', 'c3']);
      writeCatalog(treeRoot, ['c1', 'c2', 'c3']);
    },
    transition: TRANSITIONS.START_RUN,
  },
  {
    name: 'a run whose own stream cannot be read',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startAndRun(treeRoot, 'r1', ['j-c1']);
      // The crash class this arm exists for: a run stream truncated mid-record.
      // Nothing lawful writes a half line, and nothing repairs one either.
      fs.appendFileSync(path.join(treeRoot, 'verification', 'runs', 'r1.jsonl'), '{"kind":"journey-res');
    },
    transition: TRANSITIONS.COMPUTE_SUITE_STATE,
  },
  {
    name: 'a green suite-state for the current run',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
      computeFor(treeRoot, 'r1');
    },
    transition: TRANSITIONS.BLOCKED,
  },
  {
    name: 'a red suite-state for the current run',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startAndRun(treeRoot, 'r1', ['j-c1'], 'true');
      runJourneys(treeRoot, 'r1', ['j-c2'], 'false');
      computeFor(treeRoot, 'r1');
    },
    transition: TRANSITIONS.BLOCKED,
  },
  {
    name: 'a suite-state a quarantine decision has marked stale',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
      computeFor(treeRoot, 'r1');
      // The stale marker's own writer, never a hand-set status field: only a
      // real quarantine mutation puts this state on disk.
      recordOutcome(path.join(treeRoot, 'verification', 'quarantine.json'), 'j-c2', 'fail', { runId: 'r1' });
    },
    transition: TRANSITIONS.COMPUTE_SUITE_STATE,
  },
  {
    name: 'a run started under an id that is not one path segment',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      // start-run takes any non-empty string for a run id, and that id is a
      // file name — so this state is producible through the phase's own CLI,
      // not only by a corrupted index.
      startRun(treeRoot, '../escaped', assembledSuite(treeRoot));
    },
    transition: TRANSITIONS.BLOCKED,
  },
  {
    name: 'a start that tore between the run stream and the index',
    build: (treeRoot) => {
      writeRegister(treeRoot);
      writeCatalog(treeRoot);
      startRun(treeRoot, 'r1', assembledSuite(treeRoot));
      // start-run appends the run-start record and writes the index second, so
      // this is the crash window between the two halves: the stream exists and
      // the index has never heard of it. The id is spent — nothing can start it
      // again — and the next run has to be a different one.
      writeAtomic(path.join(treeRoot, 'verification', 'runs-index.json'), { schema_version: 1, runs: [] });
    },
    transition: TRANSITIONS.START_RUN,
  },
];

function buildState(entry) {
  const treeRoot = makeTree();
  entry.build(treeRoot);
  return treeRoot;
}

// ---------- totality ----------

test('every reachable green-path state resolves to exactly one descriptor, or to one blocked-with-reason', () => {
  const transitions = new Set(Object.values(TRANSITIONS));
  const returns = new Set(Object.values(RETURNS));

  for (const entry of STATES) {
    const treeRoot = buildState(entry);
    const next = nextTransition(treeRoot);

    assert.ok(next !== null && typeof next === 'object' && !Array.isArray(next), `${entry.name}: no descriptor`);
    assert.equal(next.transition, entry.transition, `${entry.name} resolved to ${next.transition}`);
    assert.ok(transitions.has(next.transition), `${entry.name}: ${next.transition} is not in the vocabulary`);
    assert.ok(returns.has(next.return), `${entry.name}: ${next.return} is not a workflow return`);
    assert.equal(typeof next.reason, 'string');
    assert.notEqual(next.reason.trim(), '', `${entry.name}: a descriptor with no reason`);
    if (next.transition === TRANSITIONS.BLOCKED) {
      assert.equal(next.return, RETURNS.BLOCKED, `${entry.name}: a blocked descriptor that does not return blocked`);
      assert.match(next.block_id, /^verification:/, `${entry.name}: a block with no scoped id`);
    } else {
      assert.equal(next.return, RETURNS.BEAT, `${entry.name}: a transition that does not beat`);
    }
    // A descriptor that does not survive JSON is a descriptor that answers
    // differently in the process that reads it back.
    assert.deepEqual(JSON.parse(JSON.stringify(next)), next, `${entry.name}: the descriptor does not round-trip`);
  }
});

// ---------- every descriptor's evidence is durable ----------

function digestOf(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

test('every descriptor cites durable evidence: present artifacts by digest, absent ones by name', () => {
  for (const entry of STATES) {
    const treeRoot = buildState(entry);
    const next = nextTransition(treeRoot);

    assert.ok(Array.isArray(next.evidence), `${entry.name}: no evidence array`);
    for (const ref of next.evidence) {
      const file = path.join(treeRoot, ref.path);
      assert.ok(fs.existsSync(file), `${entry.name}: evidence ${ref.path} is not on disk`);
      assert.equal(ref.digest, digestOf(file), `${entry.name}: evidence ${ref.path} carries a digest of other bytes`);
    }
    for (const missing of next.missing || []) {
      assert.equal(fs.existsSync(path.join(treeRoot, missing)), false, `${entry.name}: ${missing} is claimed absent and is on disk`);
    }
    if (typeof next.record_ref === 'string') {
      const [scope, runId, seq] = next.record_ref.split(':');
      assert.equal(scope, 'run', `${entry.name}: an unresolvable record ref ${next.record_ref}`);
      const records = fs
        .readFileSync(path.join(treeRoot, 'verification', 'runs', `${runId}.jsonl`), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line));
      assert.ok(
        records.some((record) => String(record.seq) === seq),
        `${entry.name}: record ref ${next.record_ref} resolves to nothing`
      );
    }
    // The blocked arms are the ones that can honestly have nothing to cite, and
    // even they name what they went looking for.
    assert.ok(
      next.evidence.length > 0 || (next.missing || []).length > 0,
      `${entry.name}: a descriptor that cites nothing at all`
    );
  }
});

// ---------- purity ----------

function treeDigest(treeRoot) {
  const files = {};
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files[path.relative(treeRoot, full)] = digestOf(full);
    }
  };
  walk(treeRoot);
  return files;
}

test('the resolver writes nothing: every arm leaves the tree byte-identical', () => {
  for (const entry of STATES) {
    const treeRoot = buildState(entry);
    const before = treeDigest(treeRoot);
    nextTransition(treeRoot);
    nextTransition(treeRoot);
    assert.deepEqual(treeDigest(treeRoot), before, `${entry.name}: the resolver moved a byte`);
  }
});

test('the resolver holds no write or execution mechanism of its own', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const forbidden = [
    [/writeAtomic/, 'the atomic JSON writer'],
    [/appendRecord|appendEvent/, 'a stream append'],
    [/writeFileSync|appendFileSync|createWriteStream|mkdirSync|rmSync|unlinkSync|renameSync/, 'a filesystem write'],
    [/child_process|spawn|execFile|execSync/, 'a child process'],
    [/runGate/, 'the gate runner'],
    [/startRun|recordRun|computeSuiteState|recordAffected|recordChunkAffected|runJourney/, 'a writing operation of verification.js'],
    [/decideFlake|recordOutcome|capTracker/, "the red ladder's own vocabulary"],
  ];
  for (const [pattern, name] of forbidden) {
    assert.equal(pattern.test(source), false, `verification-spine.js reaches for ${name}`);
  }
});

// ---------- fresh-process determinism ----------

function inAFreshProcess(treeRoot) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        `process.stdout.write(JSON.stringify(require(${JSON.stringify(MODULE_PATH)}).nextTransition(${JSON.stringify(treeRoot)})))`,
      ],
      { encoding: 'utf8' }
    )
  );
}

test('every state answers the same when asked again, and when asked by a new process', () => {
  for (const entry of STATES) {
    const treeRoot = buildState(entry);
    const once = nextTransition(treeRoot);
    assert.deepEqual(nextTransition(treeRoot), once, `${entry.name}: re-asking gave a different answer`);
    assert.deepEqual(inAFreshProcess(treeRoot), once, `${entry.name}: a fresh process disagreed`);
  }
});

// ---------- the walk, rung by rung ----------

test('the blocked entry names the catalog it is missing and the writer that owes it', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.equal(next.block_id, 'verification:no-catalog');
  assert.deepEqual(next.missing, ['verification/journeys.json']);
});

test('a catalog that does not assemble blocks with the assembler own errors, never with a summary', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot, ['c1']);
  writeCatalog(treeRoot, ['c1', 'c2']);

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.equal(next.block_id, 'verification:suite-does-not-assemble');
  assert.ok(
    next.errors.some((error) => error.includes('unknown criterion "c2"')),
    `the assembler's own error is not carried: ${JSON.stringify(next.errors)}`
  );
});

test('the first run is bound to the assembled suite and to the digest the run will carry', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.START_RUN);
  assert.equal(next.run_id, 'r1');
  assert.equal(next.suite_digest, digestSuite(assembledSuite(treeRoot)));
  assert.deepEqual(next.suite, assembledSuite(treeRoot));
});

test('a run id whose stream already exists is spent, and the next run gets a different one', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startRun(treeRoot, 'r1', assembledSuite(treeRoot));
  writeAtomic(path.join(treeRoot, 'verification', 'runs-index.json'), { schema_version: 1, runs: [] });

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.START_RUN);
  assert.equal(next.run_id, 'r2');
});

test('a run id that would walk out of the runs directory stops the walk before anything reads it', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startRun(treeRoot, '../escaped', assembledSuite(treeRoot));

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.equal(next.block_id, 'verification:unsafe-run-id');
  assert.match(next.reason, /path segment/);
});

test('an indexed run whose stream is gone never has its id handed out again — the id named is one that can be started', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  // r1 is burned by the crash window between the run stream and the index, so
  // the pass moves on to r2 — and then r2's own stream is lost off the disk,
  // which leaves the index the only record that the id was ever spent.
  startRun(treeRoot, 'r1', assembledSuite(treeRoot));
  writeAtomic(path.join(treeRoot, 'verification', 'runs-index.json'), { schema_version: 1, runs: [] });
  startRun(treeRoot, 'r2', assembledSuite(treeRoot));
  fs.rmSync(path.join(treeRoot, 'verification', 'runs', 'r2.jsonl'));

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.START_RUN);
  assert.equal(next.run_id, 'r3');
  // The binding half: the id in the descriptor is one the machine will accept.
  startRun(treeRoot, next.run_id, next.suite);
});

test("a verdict computed against a suite other than the one on disk is not this suite's verdict", () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
  // The verdict CLI takes the suite as an argument, so a verdict bound to a
  // narrower universe than the tree's own is producible — and it is not an
  // answer about the suite this pass assembled.
  computeSuiteState(treeRoot, 'r1', { schema_version: 1, entries: [] }, assembledSuite(treeRoot).slice(0, 1));

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.COMPUTE_SUITE_STATE);
  assert.equal(next.run_id, 'r1');
  assert.equal(next.suite_digest, digestSuite(assembledSuite(treeRoot)));
});

test('a suite that changed under a running pass resolves to a fresh run, never to a recompute against the stale one', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
  writeRegister(treeRoot, ['c1', 'c2', 'c3']);
  writeCatalog(treeRoot, ['c1', 'c2', 'c3']);

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.START_RUN);
  assert.equal(next.run_id, 'r2');
  assert.equal(next.suite_digest, digestSuite(assembledSuite(treeRoot)));
  assert.match(next.reason, /digest/i);
});

test('a started run runs its journeys one per invocation, in the assembled order, until none is owed', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startRun(treeRoot, 'r1', assembledSuite(treeRoot));

  const first = nextTransition(treeRoot);
  assert.equal(first.transition, TRANSITIONS.RUN_JOURNEY);
  assert.equal(first.journey_id, 'j-c1');
  assert.equal(first.run_id, 'r1');
  assert.equal(first.script_path, 'test/c1.test.js');
  assert.equal(first.harness, 'node-test');
  assert.equal(first.remaining, 2);

  runJourneys(treeRoot, 'r1', ['j-c1']);
  const second = nextTransition(treeRoot);
  assert.equal(second.transition, TRANSITIONS.RUN_JOURNEY);
  assert.equal(second.journey_id, 'j-c2');
  assert.equal(second.remaining, 1);

  runJourneys(treeRoot, 'r1', ['j-c2']);
  assert.equal(nextTransition(treeRoot).transition, TRANSITIONS.COMPUTE_SUITE_STATE);
});

test('the order is the failing-first dance: last pass failures first, then the pending affected, then the rest', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot, ['c1', 'c2', 'c3']);
  writeCatalog(treeRoot, ['c1', 'c2', 'c3']);

  // A first pass where the LAST journey failed, and a map that marks the middle
  // one affected: three journeys, so re-ordering nothing and re-ordering
  // everything are both visibly wrong.
  startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2'], 'true');
  runJourneys(treeRoot, 'r1', ['j-c3'], 'false');
  computeFor(treeRoot, 'r1');
  recordAffected(treeRoot, [{ journey_id: 'j-c2', affected_by: ['M1/C1'], status: 'pending' }]);
  startRun(treeRoot, 'r2', assembledSuite(treeRoot));

  assert.equal(nextTransition(treeRoot).journey_id, 'j-c3');
  runJourneys(treeRoot, 'r2', ['j-c3']);
  assert.equal(nextTransition(treeRoot).journey_id, 'j-c2');
  runJourneys(treeRoot, 'r2', ['j-c2']);
  assert.equal(nextTransition(treeRoot).journey_id, 'j-c1');
});

test('a journey recorded in an earlier run is still owed by this one', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
  computeFor(treeRoot, 'r1');
  startRun(treeRoot, 'r2', assembledSuite(treeRoot));

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.RUN_JOURNEY);
  assert.equal(next.run_id, 'r2');
  assert.equal(next.remaining, 2);
  // The gate id carries the run that scopes it, so the second run's evidence
  // can never be mistaken for the first's.
  assert.equal(next.gate_id, 'journey-j-c1-r2');
  assert.notEqual(next.gate_id, 'journey-j-c1-r1');
});

test('a fully recorded run resolves to the verdict, naming the suite and the quarantine document it is computed against', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.COMPUTE_SUITE_STATE);
  assert.equal(next.run_id, 'r1');
  assert.deepEqual(next.suite, assembledSuite(treeRoot));
  assert.equal(next.suite_digest, digestSuite(assembledSuite(treeRoot)));
  assert.equal(next.quarantine_ref, null);
});

test('a run whose stream cannot be read is never answered with another journey run', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startAndRun(treeRoot, 'r1', ['j-c1']);
  fs.appendFileSync(path.join(treeRoot, 'verification', 'runs', 'r1.jsonl'), '{"kind":"journey-res');

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.COMPUTE_SUITE_STATE);
  assert.match(next.reason, /cannot be read|malformed/i);
});

test("a verdict computed for a superseded run is not this run's verdict", () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
  computeFor(treeRoot, 'r1');
  startAndRun(treeRoot, 'r2', ['j-c1', 'j-c2']);

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.COMPUTE_SUITE_STATE);
  assert.equal(next.run_id, 'r2');
});

test('a verdict a quarantine decision marked stale is computed again for the same run', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
  computeFor(treeRoot, 'r1');
  recordOutcome(path.join(treeRoot, 'verification', 'quarantine.json'), 'j-c2', 'fail', { runId: 'r1' });

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.COMPUTE_SUITE_STATE);
  assert.equal(next.run_id, 'r1');
  assert.match(next.reason, /stale/i);
  assert.equal(next.quarantine_ref.path, 'verification/quarantine.json');
});

// ---------- the boundaries this chunk does not own ----------

test('a green verdict hands off to the post-green lane, and names it absent rather than improvising it', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startAndRun(treeRoot, 'r1', ['j-c1', 'j-c2']);
  const state = computeFor(treeRoot, 'r1');
  assert.equal(state.status, 'green');

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.equal(next.block_id, 'verification:post-green-absent:r1');
  assert.match(next.reason, /discovery/i);
  assert.match(next.reason, /security/i);
  assert.match(next.reason, /exit/i);
  assert.ok(
    next.evidence.some((ref) => ref.path === 'verification/suite-state.json'),
    'the handoff does not cite the verdict it is handing off'
  );
});

test('a red verdict hands off to the red ladder, and names it absent rather than improvising it', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  startAndRun(treeRoot, 'r1', ['j-c1'], 'true');
  runJourneys(treeRoot, 'r1', ['j-c2'], 'false');
  const state = computeFor(treeRoot, 'r1');
  assert.equal(state.status, 'red');

  const next = nextTransition(treeRoot);
  assert.equal(next.transition, TRANSITIONS.BLOCKED);
  assert.equal(next.block_id, 'verification:red-ladder-absent:r1');
  assert.match(next.reason, /flake/i);
  assert.match(next.reason, /quarantine/i);
  assert.deepEqual(next.failing, ['j-c2']);
});

// ---------- refusals ----------

test('a runs index this resolver cannot read stops it rather than resolving from a guess', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  writeCatalog(treeRoot);
  writeAtomic(path.join(treeRoot, 'verification', 'runs-index.json'), { schema_version: 1, runs: 'not an array' });

  assert.throws(() => nextTransition(treeRoot), /runs-index/);
});

test('a catalog this resolver cannot parse stops it rather than reading it as an absent one', () => {
  const treeRoot = makeTree();
  writeRegister(treeRoot);
  fs.writeFileSync(catalogPath(treeRoot), '{ not json');

  assert.throws(() => nextTransition(treeRoot), /journeys\.json/);
});

test('the resolver refuses a tree root that is not one', () => {
  assert.throws(() => nextTransition(''), TypeError);
  assert.throws(() => nextTransition(undefined), TypeError);
});
