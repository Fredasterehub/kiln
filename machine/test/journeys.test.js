'use strict';

// journeys.js — the sole writer of `verification/journeys.json` and of the
// `chunk-journeys` record beside it.
//
// The catalog is what `verification.js#assembleSuite` reads, and assembleSuite
// is fail-closed on it, so the acceptance that matters most lives in
// `implementation-workflow.test.js`, where a real build's output is put in
// front of the real assembleSuite. What this file proves is the writer's own
// contract: which nominations it refuses, that a refusal writes nothing at all,
// and that a replay leaves the catalog byte-identical.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const { recordAuthoredJourney, nominationProblem } = require('../src/journeys.js');
const { createMilestone, recordChunk } = require('../src/milestones.js');
const { writeAtomic, readJson } = require('../src/atomic-json.js');
const { readRecords } = require('../src/stream.js');

const CRITERION = 'ACR-1';
const JOURNEY = 'J-ACR-1';
const SCRIPT = 'test/journeys/acr-1.test.js';

function nomination(over = {}) {
  return { journey_id: JOURNEY, script_path: SCRIPT, harness: 'node-test', ...over };
}

// A project whose HEAD really carries the journey script, with a milestone tree
// inside it: the writer only catalogues a journey git can show in the sealed
// commit, so a fixture that merely puts the file on disk would never reach the
// checks under test.
function makeWorkspace({ commitScript = true, criteria, registerJourney = JOURNEY } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'journeys-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'tree/\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n');
  if (commitScript) {
    fs.mkdirSync(path.join(repoRoot, path.dirname(SCRIPT)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, SCRIPT), "require('node:test')('journey', () => {});\n");
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');

  const treeRoot = path.join(repoRoot, 'tree');
  fs.mkdirSync(path.join(treeRoot, 'architecture'), { recursive: true });
  writeAtomic(path.join(treeRoot, 'architecture', 'criteria-register.json'), {
    schema_version: 1,
    criteria:
      criteria === undefined
        ? [{ id: CRITERION, text: 'It runs.', source_ref: 'vision/vision.md#1', journey_id: registerJourney }]
        : criteria,
  });
  createMilestone(treeRoot, { id: 'M1', title: 'First', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'ledger:0' });
  return { repoRoot, treeRoot };
}

const CATALOG = (treeRoot) => path.join(treeRoot, 'verification', 'journeys.json');
const CHUNKS = (treeRoot) => path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl');

// Bytes, inode and mtime together, because "wrote nothing" is a claim about
// writes: identical content cannot tell a rewrite from a read.
function snapshot(files) {
  return files.map((file) => {
    if (!fs.existsSync(file)) return `${file} ABSENT`;
    const stat = fs.statSync(file);
    return `${file} ino=${stat.ino} mtime=${stat.mtimeMs} ${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  });
}

function journeyRecords(treeRoot) {
  return readRecords(CHUNKS(treeRoot)).records.filter((record) => record.kind === 'chunk-journeys');
}

// ---------- the write ----------

test('a nominated journey becomes a catalog entry whose criterion comes from the register', () => {
  const { repoRoot, treeRoot } = makeWorkspace();

  const result = recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C1', nomination());

  assert.equal(result.state, 'catalogued');
  assert.deepEqual(readJson(CATALOG(treeRoot), null), {
    schema_version: 1,
    journeys: [
      {
        journey_id: JOURNEY,
        // Not supplied by the caller anywhere — derived from the frozen 1:1
        // register, which is what stops anything downstream from deciding
        // which criterion a journey answers.
        criterion_id: CRITERION,
        script_path: SCRIPT,
        harness: 'node-test',
        added_in_milestone: 'M1',
      },
    ],
  });
  assert.deepEqual(
    journeyRecords(treeRoot).map((record) => [record.chunk_id, record.journey_ids]),
    [['C1', [JOURNEY]]],
    'the audit half of the write is missing'
  );
});

test('the catalog is created fresh on the first journey and appended to on the next', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const second = 'test/journeys/acr-2.test.js';
  fs.mkdirSync(path.join(repoRoot, path.dirname(second)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, second), "require('node:test')('journey', () => {});\n");
  execFileSync('git', ['add', '-A'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-q', '-m', 'second journey'], { cwd: repoRoot });
  writeAtomic(path.join(treeRoot, 'architecture', 'criteria-register.json'), {
    schema_version: 1,
    criteria: [
      { id: CRITERION, text: 'It runs.', source_ref: 'vision/vision.md#1', journey_id: JOURNEY },
      { id: 'ACR-2', text: 'It stops.', source_ref: 'vision/vision.md#2', journey_id: 'J-ACR-2' },
    ],
  });
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C2', brief_ref: 'ledger:1' });

  assert.equal(fs.existsSync(CATALOG(treeRoot)), false, 'the catalog exists before any journey was authored');
  recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C1', nomination());
  recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C2', nomination({ journey_id: 'J-ACR-2', script_path: second }));

  const catalog = readJson(CATALOG(treeRoot), null);
  assert.deepEqual(
    catalog.journeys.map((entry) => [entry.journey_id, entry.criterion_id]),
    [[JOURNEY, CRITERION], ['J-ACR-2', 'ACR-2']]
  );
  assert.equal(journeyRecords(treeRoot).length, 2);
});

// ---------- replay ----------

test('writing the same journey again changes nothing at all', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C1', nomination());
  const before = snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]);

  const again = recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C1', nomination());

  assert.equal(again.state, 'already-catalogued');
  assert.deepEqual(snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]), before);
  assert.equal(journeyRecords(treeRoot).length, 1, 'the replay logged a second audit record');
});

test('the same journey_id describing something else is refused, not replaced', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  const other = 'test/journeys/somewhere-else.test.js';
  fs.mkdirSync(path.join(repoRoot, path.dirname(other)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, other), "require('node:test')('journey', () => {});\n");
  execFileSync('git', ['add', '-A'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-q', '-m', 'another script'], { cwd: repoRoot });
  recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C1', nomination());
  const before = snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]);

  assert.throws(
    () => recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C1', nomination({ script_path: other })),
    /conflicting duplicate/
  );
  assert.deepEqual(snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]), before);
});

// ---------- refusals ----------

// EACH REFUSAL IS MATCHED ON ITS OWN REASON. `assert.throws` with no matcher
// passes on any error at all — including the TypeError a neutered guard throws
// one line later when it dereferences the thing it failed to check — so a guard
// can be entirely unbound while its case still goes green.
test('every refusal names its own reason and leaves the catalog and the chunk stream as they were', () => {
  const cases = [
    ['a journey the register never minted', () => nomination({ journey_id: 'J-INVENTED' }), /register names no journey/],
    ['a harness nothing can run', () => nomination({ harness: 'make' }), /harness/],
    ['a script_path that escapes the project', () => nomination({ script_path: '../elsewhere/j.test.js' }), /script_path/],
    ['an absolute script_path', () => nomination({ script_path: '/etc/passwd' }), /script_path/],
    ['a script_path carrying shell punctuation', () => nomination({ script_path: 'test/j.test.js; rm -rf /' }), /script_path/],
    ['a nomination with a key nobody reads', () => nomination({ note: 'why this one' }), /unexpected key/],
    ['no nomination object at all', () => null, /must be an object/],
  ];

  for (const [label, build, reason] of cases) {
    const { repoRoot, treeRoot } = makeWorkspace();
    const before = snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]);
    assert.throws(() => recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C1', build()), reason, label);
    assert.deepEqual(snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]), before, label);
  }
});

// THE SEAM BETWEEN THE TWO WRITES. The catalog entry and the audit record are
// two views of one fact, and the doctrine row this chunk wrote says they cannot
// come apart — but the catalog is a file and the record is a stream, so nothing
// makes the pair atomic except the order the checks run in. Every refusal the
// RECORD side can raise deterministically has to be raised BEFORE the catalog
// is touched, or a build ends with a catalogued journey no trail accounts for
// and no re-entry that can notice.
test('a refusal the audit record would raise leaves BOTH files untouched', () => {
  const cases = [
    [
      'the milestone is already green',
      ({ treeRoot }) => {
        const index = readJson(path.join(treeRoot, 'milestones', 'index.json'), null);
        index.milestones[0].status = 'green';
        writeAtomic(path.join(treeRoot, 'milestones', 'index.json'), index);
      },
      /already green/,
    ],
    [
      'the milestone stream is gone',
      ({ treeRoot }) => fs.rmSync(CHUNKS(treeRoot), { force: true }),
      /no such milestone/,
    ],
    [
      'the stream carries a record violating the common header',
      ({ treeRoot }) => fs.appendFileSync(CHUNKS(treeRoot), `${JSON.stringify({ kind: 'chunk-spec', chunk_id: 'C1' })}\n`),
      /common JSONL header/,
    ],
    [
      'the stream will not parse',
      ({ treeRoot }) => fs.appendFileSync(CHUNKS(treeRoot), 'not json at all\n'),
      /malformed record/,
    ],
    [
      'the chunk has no lifecycle record of its own',
      () => {},
      /requires a prior "chunk-spec" record/,
      'C-NEVER-BRIEFED',
    ],
    [
      // The byte ceiling is `jsonl.js`'s own law and it fires inside the append.
      // With the record written first, that refusal precedes the catalog too —
      // which is the whole reason this module states no length bound of its own.
      'the record would exceed the stream\'s byte ceiling',
      () => {},
      /LINE_CEILING/,
      'C1',
      () => nomination({ journey_id: `J-${'x'.repeat(9000)}` }),
    ],
  ];

  for (const [label, breakIt, reason, chunkId = 'C1', build = nomination] of cases) {
    const { repoRoot, treeRoot } = makeWorkspace({ registerJourney: build().journey_id });
    breakIt({ treeRoot });
    const before = snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]);

    assert.throws(() => recordAuthoredJourney(treeRoot, repoRoot, 'M1', chunkId, build()), reason, label);

    assert.deepEqual(
      snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]),
      before,
      `${label}: a write landed before the refusal, and the catalog and the trail are now telling different stories`
    );
  }
});

// THE CRASH WINDOW THE ORDER EXISTS FOR. The record goes down, the process
// dies, and the catalog line was never written. Re-entry has to adopt the
// record already there — not append a second one — and finish the catalog, so
// the two converge on exactly the state one uninterrupted call would have left.
test('a crash between the audit record and the catalog line converges on re-entry', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  // A real process, really killed, at the one instant that matters: the audit
  // record is already down and the catalog write has not begun. `writeAtomic`
  // writes through a temp file, so the kill is armed on any write naming the
  // catalog's own directory rather than on the final name.
  const child = `
    const fs = require('node:fs');
    // Armed on the FIRST syscall aimed at the catalog, whichever it is.
    // \`writeAtomic\` never calls writeFileSync — it mkdirs, opens a temp file
    // 'wx', writes to the descriptor and renames — so patching the obvious
    // function intercepts nothing at all, which is exactly what the first
    // version of this test did while reporting a green kill.
    for (const name of ['mkdirSync', 'openSync']) {
      const real = fs[name];
      fs[name] = function (target, ...rest) {
        if (String(target).includes('verification')) process.kill(process.pid, 'SIGKILL');
        return real.call(fs, target, ...rest);
      };
    }
    const journeys = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'journeys.js'))});
    journeys.recordAuthoredJourney(
      ${JSON.stringify(treeRoot)}, ${JSON.stringify(repoRoot)}, 'M1', 'C1',
      ${JSON.stringify(nomination())}
    );
  `;

  const died = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8' });

  // THE KILL ITSELF, ASSERTED — a window whose injection silently failed would
  // have this test proving recovery from a state nothing was ever in.
  assert.equal(died.signal, 'SIGKILL', `the kill never fired — ${died.stderr}`);
  assert.equal(fs.existsSync(CATALOG(treeRoot)), false, 'the catalog was written before the kill');
  assert.deepEqual(
    journeyRecords(treeRoot).map((r) => r.journey_ids),
    [[JOURNEY]],
    'the audit record is not down, so this is not the window under test'
  );

  const resumed = recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C1', nomination());

  assert.equal(resumed.state, 'catalogued');
  assert.equal(readJson(CATALOG(treeRoot), null).journeys.length, 1);
  assert.equal(
    journeyRecords(treeRoot).length,
    1,
    're-entry appended a second authorship record instead of adopting the one already there'
  );
});

// THE SCRIPT HAS TO BE IN THE COMMIT. A catalogued path pointing at nothing is
// a suite that cannot run, and the phase that finds out is a whole phase later.
test('a journey whose script the seal never committed is refused', () => {
  const { repoRoot, treeRoot } = makeWorkspace({ commitScript: false });
  // On disk but not in HEAD — exactly what an implementer who wrote the file
  // and never staged it would leave, and what a working-tree check would miss.
  fs.mkdirSync(path.join(repoRoot, path.dirname(SCRIPT)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, SCRIPT), "require('node:test')('journey', () => {});\n");
  const before = snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]);

  assert.throws(() => recordAuthoredJourney(treeRoot, repoRoot, 'M1', 'C1', nomination()), /carries no/);
  assert.deepEqual(snapshot([CATALOG(treeRoot), CHUNKS(treeRoot)]), before);
});

test('an unreadable register and an unreadable catalog are both refusals, never silent', () => {
  const broken = makeWorkspace();
  writeAtomic(path.join(broken.treeRoot, 'architecture', 'criteria-register.json'), { nothing: 'useful' });
  assert.throws(
    () => recordAuthoredJourney(broken.treeRoot, broken.repoRoot, 'M1', 'C1', nomination()),
    /not a usable criteria register/
  );

  const badCatalog = makeWorkspace();
  fs.mkdirSync(path.dirname(CATALOG(badCatalog.treeRoot)), { recursive: true });
  writeAtomic(CATALOG(badCatalog.treeRoot), { schema_version: 2, journeys: [] });
  assert.throws(
    () => recordAuthoredJourney(badCatalog.treeRoot, badCatalog.repoRoot, 'M1', 'C1', nomination()),
    /is not a journey catalog/
  );
});

test('the arguments are refused before anything is read', () => {
  const { repoRoot, treeRoot } = makeWorkspace();
  assert.throws(() => recordAuthoredJourney('', repoRoot, 'M1', 'C1', nomination()), TypeError);
  assert.throws(() => recordAuthoredJourney(treeRoot, '', 'M1', 'C1', nomination()), TypeError);
  assert.throws(() => recordAuthoredJourney(treeRoot, repoRoot, '', 'C1', nomination()), TypeError);
  assert.throws(() => recordAuthoredJourney(treeRoot, repoRoot, 'M1', '', nomination()), TypeError);
});

// ---------- the shape, shared with the promotion boundary ----------

test('nominationProblem names what is wrong, and passes a well-formed nomination', () => {
  assert.equal(nominationProblem(nomination()), null);
  assert.match(nominationProblem(nomination({ journey_id: '' })), /journey_id/);
  assert.match(nominationProblem(nomination({ script_path: '../x' })), /script_path/);
  assert.match(nominationProblem(nomination({ harness: 'nope' })), /harness/);
  assert.match(nominationProblem(nomination({ extra: 1 })), /unexpected key/);
  assert.match(nominationProblem('a journey'), /must be an object/);
});
