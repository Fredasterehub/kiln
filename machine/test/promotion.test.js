'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { promoteArtifact, stagedPathFor, CLASS_NAMES } = require('../src/promotion.js');

// The 8-field brief `validators.js` already defines. A chunk brief is that
// object, not prose that happens to be non-empty.
function aBrief(overrides = {}) {
  return Object.assign(
    {
      outcome: 'the chunk builds the thing',
      scope: 'machine/src/thing.js and its tests',
      anchors: ['spec.md:12'],
      acceptance: 'the suite is green and the guard is mutation-bound',
      freshness: '2026-08-03',
      tier: 'standard',
      return_format: 'the six-field envelope',
      stop_condition: 'review approves',
    },
    overrides
  );
}

function makeTreeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-test-'));
}

function stage(treeRoot, artifactClass, milestoneId, name, content) {
  const file = path.join(treeRoot, 'staging', artifactClass, milestoneId, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return file;
}

test('a staged spec is promoted into the milestone and receipted by digest', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'spec', 'M1', 'spec.md', '# M1\n\nThe slice.\n');

  const receipt = promoteArtifact(treeRoot, 'spec', { milestone_id: 'M1' });

  assert.equal(receipt.ref, path.join('milestones', 'M1', 'spec.md'));
  assert.match(receipt.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(fs.readFileSync(receipt.path, 'utf8'), '# M1\n\nThe slice.\n');
});

test('an invalid artifact stays staged and nothing canonical is written', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'chunk-plan', 'M1', 'chunk-plan.json', { schema_version: 1, chunks: [] });

  assert.throws(
    () => promoteArtifact(treeRoot, 'chunk-plan', { milestone_id: 'M1' }),
    /nothing to build; it stays staged/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'chunk-plan.json')), false);
  assert.ok(fs.existsSync(path.join(treeRoot, 'staging', 'chunk-plan', 'M1', 'chunk-plan.json')));
});

test('a chunk plan naming the same chunk twice is refused', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'chunk-plan', 'M1', 'chunk-plan.json', {
    schema_version: 1,
    chunks: [{ id: 'C1' }, { id: 'C1' }],
  });

  assert.throws(() => promoteArtifact(treeRoot, 'chunk-plan', { milestone_id: 'M1' }), /same chunk twice/);
});

// A malformed journey nomination is refused HERE, where the designer can still
// fix it, rather than at the seal a whole milestone later — and refused with the
// chunk named, since a plan carries many and only one of them is wrong.
test('a chunk plan carrying a malformed journey nomination is refused, and a well-formed one promotes', () => {
  const bad = [
    [{ journey_id: '', script_path: 'test/j.test.js', harness: 'node-test' }, /journey_id/],
    [{ journey_id: 'J-1', script_path: '../outside/j.test.js', harness: 'node-test' }, /script_path/],
    [{ journey_id: 'J-1', script_path: 'test/j.test.js', harness: 'make' }, /harness/],
    [{ journey_id: 'J-1', script_path: 'test/j.test.js', harness: 'node-test', why: 'notes' }, /unexpected key/],
    ['J-1', /must be an object/],
  ];

  for (const [journey, reason] of bad) {
    const treeRoot = makeTreeRoot();
    stage(treeRoot, 'chunk-plan', 'M1', 'chunk-plan.json', {
      schema_version: 1,
      chunks: [{ id: 'C1', title: 'First' }, { id: 'C2', title: 'Second', journey }],
    });
    assert.throws(
      () => promoteArtifact(treeRoot, 'chunk-plan', { milestone_id: 'M1' }),
      reason,
      JSON.stringify(journey)
    );
    // The chunk is named, so a designer knows which of its nominations to fix.
    assert.throws(() => promoteArtifact(treeRoot, 'chunk-plan', { milestone_id: 'M1' }), /chunk "C2"/);
  }

  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'chunk-plan', 'M1', 'chunk-plan.json', {
    schema_version: 1,
    chunks: [
      { id: 'C1', title: 'First' },
      { id: 'C2', title: 'Second', journey: { journey_id: 'J-1', script_path: 'test/j.test.js', harness: 'node-test' } },
    ],
  });
  const promoted = promoteArtifact(treeRoot, 'chunk-plan', { milestone_id: 'M1' });
  assert.equal(promoted.content.chunks[1].journey.journey_id, 'J-1');
});

// A journey is mechanically unique — the criteria register mints exactly one
// per criterion — so two chunks nominating the same one is a decomposition
// mistake, not a build that discovers itself. Left to the seal it surfaces
// twice over and late: identical nominations file two authorship records for
// one journey, and differing ones only collide after the SECOND chunk has
// already sealed.
test('two chunks nominating the same journey are refused at promotion, not at the second seal', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'chunk-plan', 'M1', 'chunk-plan.json', {
    schema_version: 1,
    chunks: [
      { id: 'C1', title: 'First', journey: { journey_id: 'J-1', script_path: 'test/a.test.js', harness: 'node-test' } },
      // A DIFFERENT script under the same journey id: the two nominations are
      // each well-formed on their own, which is exactly why validating them
      // independently could never catch this.
      { id: 'C2', title: 'Second', journey: { journey_id: 'J-1', script_path: 'test/b.test.js', harness: 'node-test' } },
    ],
  });

  assert.throws(() => promoteArtifact(treeRoot, 'chunk-plan', { milestone_id: 'M1' }), /J-1/);
  assert.throws(() => promoteArtifact(treeRoot, 'chunk-plan', { milestone_id: 'M1' }), /nominated by more than one chunk/);
  assert.equal(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'chunk-plan.json')), false);
});

test('two chunks nominating DIFFERENT journeys promote cleanly', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'chunk-plan', 'M1', 'chunk-plan.json', {
    schema_version: 1,
    chunks: [
      { id: 'C1', title: 'First', journey: { journey_id: 'J-1', script_path: 'test/a.test.js', harness: 'node-test' } },
      { id: 'C2', title: 'Second', journey: { journey_id: 'J-2', script_path: 'test/b.test.js', harness: 'node-test' } },
    ],
  });

  const promoted = promoteArtifact(treeRoot, 'chunk-plan', { milestone_id: 'M1' });
  assert.deepEqual(promoted.content.chunks.map((c) => c.journey.journey_id), ['J-1', 'J-2']);
});

test('promoting the same artifact twice returns the same receipt and rewrites nothing', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'review', 'M1', 'C1-r1.json', { verdict: 'approve', evidence: 'reads correctly', family: 'claude' });

  const first = promoteArtifact(treeRoot, 'review', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' });
  const before = fs.statSync(first.path).mtimeMs;
  const again = promoteArtifact(treeRoot, 'review', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' });

  assert.deepEqual(again, first);
  assert.equal(fs.statSync(first.path).mtimeMs, before);
});

test('promoting DIFFERENT bytes over a promoted artifact fails closed', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'review', 'M1', 'C1-r1.json', { verdict: 'approve', evidence: 'reads correctly', family: 'claude' });
  promoteArtifact(treeRoot, 'review', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' });
  stage(treeRoot, 'review', 'M1', 'C1-r1.json', { verdict: 'revise', evidence: 'second thoughts', family: 'claude' });

  assert.throws(
    () => promoteArtifact(treeRoot, 'review', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' }),
    /already holds a different review/
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(treeRoot, 'milestones', 'M1', 'reviews', 'C1-r1.json'), 'utf8')).verdict,
    'approve'
  );
});

test('a verdict with nothing behind it is not a review', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'milestone-review', 'M1', 'review.json', { verdict: 'approve', family: 'claude' });

  assert.throws(
    () => promoteArtifact(treeRoot, 'milestone-review', { milestone_id: 'M1' }),
    /an opinion/
  );
});

test('the artifact classes are a closed set, and a path cannot be invented by naming one', () => {
  const treeRoot = makeTreeRoot();

  assert.deepEqual(CLASS_NAMES, ['spec', 'chunk-plan', 'brief', 'review', 'milestone-review', 'consult']);
  assert.throws(() => promoteArtifact(treeRoot, '../../etc', { milestone_id: 'M1' }), /unknown artifact class/);
  assert.throws(() => promoteArtifact(treeRoot, 'spec', { milestone_id: '' }), /milestone_id/);
  assert.throws(() => promoteArtifact(treeRoot, 'brief', { milestone_id: 'M1' }), /chunk_id/);
  assert.throws(() => promoteArtifact(treeRoot, 'consult', { milestone_id: 'M1' }), /consult_id/);
});

test('a class with nothing staged says so rather than promoting an absence', () => {
  const treeRoot = makeTreeRoot();

  assert.throws(() => promoteArtifact(treeRoot, 'spec', { milestone_id: 'M1' }), /wrote nowhere this module reads/);
});

// ---------- the path fence ----------

// The claimed fence was "the staged path is derived from class and scope, so a
// caller cannot choose where the machine writes". Derivation alone does not
// close it: `path.join` NORMALISES `..`, so a scope id containing one walks the
// derived path straight back out of the tree. The ids are single path segments
// and are checked as such — the same rule capsule.js and dispatch.js already
// hold their own ids to.
test('a scope id that is not a single path segment is refused before anything is read', () => {
  const treeRoot = makeTreeRoot();

  for (const bad of ['../../etc', '..', 'a/b', '/abs', './x']) {
    assert.throws(
      () => promoteArtifact(treeRoot, 'spec', { milestone_id: bad }),
      /one path segment/,
      `milestone_id ${JSON.stringify(bad)} was not refused`
    );
    assert.throws(
      () => promoteArtifact(treeRoot, 'review', { milestone_id: 'M1', chunk_id: bad, round: 'r1' }),
      /one path segment/,
      `chunk_id ${JSON.stringify(bad)} was not refused`
    );
  }
});

// The wrong answer has to be a DIFFERENT answer: this fixture stages an
// artifact at the exact path the escape would read from, and asserts the
// refusal happens anyway and the target outside the tree is never written.
test('a traversing id cannot move the canonical write outside the tree', () => {
  const parent = makeTreeRoot();
  const treeRoot = path.join(parent, 'tree');
  fs.mkdirSync(treeRoot);
  const escapedStage = path.join(parent, 'tree', 'staging', 'spec', '..', '..', '..');

  assert.throws(() => promoteArtifact(treeRoot, 'spec', { milestone_id: '../..' }), /one path segment/);
  assert.equal(fs.existsSync(path.join(parent, 'milestones')), false);
  assert.equal(fs.existsSync(path.resolve(escapedStage, 'milestones')), false);
});

// ---------- the staged path is a fact the caller can be told ----------

// A workflow has to name the staging file to the seat that writes it, and the
// only honest source of that name is the module that will later read it. The
// two were separately invented before, and disagreed: the seat was told an
// extensionless directory and promotion looked for `spec.md`.
test('the staged path a seat is told is the path promotion reads', () => {
  const treeRoot = makeTreeRoot();
  const told = stagedPathFor(treeRoot, 'spec', { milestone_id: 'M1' });
  fs.mkdirSync(path.dirname(told), { recursive: true });
  fs.writeFileSync(told, '# M1\n');

  const receipt = promoteArtifact(treeRoot, 'spec', { milestone_id: 'M1' });

  assert.equal(receipt.ref, path.join('milestones', 'M1', 'spec.md'));
  assert.equal(stagedPathFor(treeRoot, 'brief', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' }), 
    path.join(treeRoot, 'staging', 'brief', 'M1', 'C1.json'));
  assert.throws(() => stagedPathFor(treeRoot, 'brief', { milestone_id: 'M1' }), /chunk_id/);
});

// ---------- the brief is the 8-field brief ----------

test('a chunk brief is promoted only when it validates as a brief', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'brief', 'M1', 'C1.json', aBrief());

  const receipt = promoteArtifact(treeRoot, 'brief', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' });

  assert.equal(receipt.ref, path.join('milestones', 'M1', 'briefs', 'C1.json'));
});

test('a brief missing a required field stays staged, and the refusal names the field', () => {
  const treeRoot = makeTreeRoot();
  const short = aBrief();
  delete short.acceptance;
  stage(treeRoot, 'brief', 'M1', 'C1.json', short);

  assert.throws(
    () => promoteArtifact(treeRoot, 'brief', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' }),
    /acceptance/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'briefs', 'C1.json')), false);
});

// Prose that is merely non-empty was the old contract, and it is what let a
// brief with none of its eight fields through.
test('a non-empty string is not a brief', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'brief', 'M1', 'C1.json', '"just some prose"');

  assert.throws(() => promoteArtifact(treeRoot, 'brief', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' }), /brief/);
});

// ---------- a review evidences the family that produced it ----------

// The reviewer's family is chosen by code and evidenced by the chunk-review
// record; a verdict artifact that does not say which family wrote it cannot
// corroborate that selection, which is the whole point of folding selection
// into the review transition.
test('a review artifact must name the family that produced it', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'review', 'M1', 'C1-r1.json', { verdict: 'approve', evidence: 'reads correctly' });

  assert.throws(
    () => promoteArtifact(treeRoot, 'review', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' }),
    /family/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'reviews', 'C1-r1.json')), false);

  stage(treeRoot, 'review', 'M1', 'C1-r1.json', { verdict: 'approve', evidence: 'reads correctly', family: 'claude' });
  const receipt = promoteArtifact(treeRoot, 'review', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' });
  assert.equal(receipt.ref, path.join('milestones', 'M1', 'reviews', 'C1-r1.json'));
});

test('a review naming a family outside the closed vocabulary is refused', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'review', 'M1', 'C1-r1.json', { verdict: 'approve', evidence: 'e', family: 'gemini' });

  assert.throws(() => promoteArtifact(treeRoot, 'review', { milestone_id: 'M1', chunk_id: 'C1', round: 'r1' }), /family/);
});

// ---------- consult answers ----------

// The consult seam's artifact class. Its shape is milestones.js's own
// `chunk-consult` vocabulary, so a promoted answer and the record that cites
// it cannot disagree about what an answer is.
test('a consult answer is promoted under its own id and carries the anchored shape', () => {
  const treeRoot = makeTreeRoot();
  const answer = {
    consult_id: 'Q1',
    asker: 'implementer',
    question: 'which boundary owns the retry?',
    verdict: 'the caller does',
    anchor: 'spec.md:42',
  };
  stage(treeRoot, 'consult', 'M1', 'Q1.json', answer);

  const receipt = promoteArtifact(treeRoot, 'consult', { milestone_id: 'M1', chunk_id: 'C1', consult_id: 'Q1' });

  assert.equal(receipt.ref, path.join('milestones', 'M1', 'consults', 'Q1.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(receipt.path, 'utf8')), answer);
});

test('a consult answer with no anchor is an opinion, and stays staged', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'consult', 'M1', 'Q1.json', {
    consult_id: 'Q1',
    asker: 'implementer',
    question: 'which boundary owns the retry?',
    verdict: 'the caller does',
  });

  assert.throws(
    () => promoteArtifact(treeRoot, 'consult', { milestone_id: 'M1', chunk_id: 'C1', consult_id: 'Q1' }),
    /anchor/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'consults', 'Q1.json')), false);
});

test('a consult answer whose id is not the id it was promoted under is refused', () => {
  const treeRoot = makeTreeRoot();
  stage(treeRoot, 'consult', 'M1', 'Q1.json', {
    consult_id: 'Q2',
    asker: 'implementer',
    question: 'q',
    verdict: 'v',
    anchor: 'spec.md:1',
  });

  assert.throws(
    () => promoteArtifact(treeRoot, 'consult', { milestone_id: 'M1', chunk_id: 'C1', consult_id: 'Q1' }),
    /consult_id/
  );
});

// LEXICAL CONTAINMENT IS NOT CONTAINMENT — the lesson this build already
// learned once, in dispatch.js, arriving in a new module. Checking the scope
// ids closes traversal: they are single path segments, so no `..` can walk a
// derived path out of the tree. It does NOT close a path that spells its way
// inside the tree and LEADS outside — a symlinked `milestones/` is perfectly
// legal to `path.join`, and the write lands wherever it points.
test('a canonical path that leads outside the tree is refused, symlink or not', () => {
  const parent = makeTreeRoot();
  const treeRoot = path.join(parent, 'tree');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(treeRoot);
  fs.mkdirSync(outside);
  // The whole milestones directory is somebody else's, spelled from inside.
  fs.symlinkSync(outside, path.join(treeRoot, 'milestones'));
  stage(treeRoot, 'spec', 'M1', 'spec.md', '# M1\n');

  assert.throws(() => promoteArtifact(treeRoot, 'spec', { milestone_id: 'M1' }), /outside/i);
  assert.equal(fs.existsSync(path.join(outside, 'M1', 'spec.md')), false);
});

// The same hazard on the READ side: a staging directory that leads out of the
// tree would let a promotion pick up bytes from anywhere and give them the
// authority of a canonical artifact.
test('a staged path that leads outside the tree is refused', () => {
  const parent = makeTreeRoot();
  const treeRoot = path.join(parent, 'tree');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(path.join(treeRoot, 'staging'), { recursive: true });
  fs.mkdirSync(path.join(outside, 'spec', 'M1'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'spec', 'M1', 'spec.md'), '# not ours\n');
  fs.symlinkSync(path.join(outside, 'spec'), path.join(treeRoot, 'staging', 'spec'));

  assert.throws(() => promoteArtifact(treeRoot, 'spec', { milestone_id: 'M1' }), /outside/i);
  assert.equal(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'spec.md')), false);
});

// A symlink that stays inside the tree is perfectly legal — the point is where
// a path LEADS, never whether a link was involved.
test('a symlink that leads back inside the tree is not refused', () => {
  const treeRoot = makeTreeRoot();
  fs.mkdirSync(path.join(treeRoot, 'real-staging', 'spec', 'M1'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'real-staging', 'spec', 'M1', 'spec.md'), '# M1\n');
  fs.mkdirSync(path.join(treeRoot, 'staging'), { recursive: true });
  fs.symlinkSync(path.join(treeRoot, 'real-staging', 'spec'), path.join(treeRoot, 'staging', 'spec'));

  const receipt = promoteArtifact(treeRoot, 'spec', { milestone_id: 'M1' });

  assert.equal(receipt.ref, path.join('milestones', 'M1', 'spec.md'));
});
