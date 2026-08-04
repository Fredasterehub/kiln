'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { _load, categories, list, show, sample } = require('../src/catalog.js');

const CATALOG_PATH = path.join(__dirname, '..', '..', 'product', 'brainstorm', 'catalog.json');

function mkTmpFile(dir, obj) {
  const file = path.join(dir, 'catalog.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-test-'));
}

function baseFixture() {
  return {
    schema_version: 1,
    categories: [
      { id: 'cat-a', title: 'Category A', description: 'desc a' },
      { id: 'cat-b', title: 'Category B', description: 'desc b' },
    ],
    techniques: [
      { id: 't1', name: 'T1', category: 'cat-a', mechanics: 'Do the first thing then the second thing.', goal_tags: ['feature'], audience_tags: ['solo'], phase: 'divergent' },
      { id: 't2', name: 'T2', category: 'cat-a', mechanics: 'Do the third thing then the fourth thing.', goal_tags: ['novelty'], audience_tags: ['group'], phase: 'divergent' },
      { id: 't3', name: 'T3', category: 'cat-b', mechanics: 'Cluster the ideas then pick one per cluster.', goal_tags: ['planning'], audience_tags: ['solo', 'group'], phase: 'convergent' },
      { id: 't4', name: 'T4', category: 'cat-b', mechanics: 'Pre-mortem the idea then patch the failure.', goal_tags: ['diagnosis'], audience_tags: ['solo'], phase: 'critique' },
    ],
  };
}

// --- _load: the real, shipped catalog ---------------------------------

test('_load loads the real product catalog and it satisfies the roster quotas', () => {
  const cat = _load(CATALOG_PATH);
  assert.equal(cat.schema_version, 1);
  assert.ok(Array.isArray(cat.categories));
  assert.ok(Array.isArray(cat.techniques));

  const divergent = cat.techniques.filter((t) => t.phase === 'divergent');
  const convergentOrCritique = cat.techniques.filter((t) => t.phase === 'convergent' || t.phase === 'critique');
  const divergentCategories = new Set(divergent.map((t) => t.category));

  assert.ok(divergent.length >= 36, `expected >= 36 divergent techniques, got ${divergent.length}`);
  assert.ok(divergentCategories.size >= 8, `expected >= 8 divergent categories, got ${divergentCategories.size}`);
  assert.ok(convergentOrCritique.length >= 18, `expected >= 18 convergent/critique techniques, got ${convergentOrCritique.length}`);

  // Quality bar: every mechanics line is a real, actionable sentence, not a
  // placeholder stub.
  for (const t of cat.techniques) {
    assert.ok(t.mechanics.length >= 30, `${t.id} mechanics line too short to be actionable`);
  }

  // Every technique id and category id is unique; every technique references
  // a real category.
  const catIds = new Set(cat.categories.map((c) => c.id));
  const techIds = new Set();
  for (const t of cat.techniques) {
    assert.ok(!techIds.has(t.id), `duplicate technique id ${t.id}`);
    techIds.add(t.id);
    assert.ok(catIds.has(t.category), `technique ${t.id} references unknown category ${t.category}`);
  }
});

// --- _load: fail-closed shape validation ------------------------------

test('_load throws on a missing file', () => {
  assert.throws(() => _load('/nonexistent/catalog.json'), /catalog/);
});

test('_load throws on invalid JSON', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'catalog.json');
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => _load(file), /not valid JSON/);
});

test('_load throws when schema_version is missing or wrong', () => {
  const dir = mkTmpDir();
  const fixture = baseFixture();
  delete fixture.schema_version;
  const file = mkTmpFile(dir, fixture);
  assert.throws(() => _load(file), /schema_version/);
});

test('_load throws when categories is empty', () => {
  const dir = mkTmpDir();
  const fixture = baseFixture();
  fixture.categories = [];
  const file = mkTmpFile(dir, fixture);
  assert.throws(() => _load(file), /categories/);
});

test('_load throws on a malformed category entry', () => {
  const dir = mkTmpDir();
  const fixture = baseFixture();
  fixture.categories[0] = { id: 'cat-a' }; // missing title/description
  const file = mkTmpFile(dir, fixture);
  assert.throws(() => _load(file), /title/);
});

test('_load throws on a duplicate category id', () => {
  const dir = mkTmpDir();
  const fixture = baseFixture();
  fixture.categories.push({ id: 'cat-a', title: 'Dup', description: 'dup' });
  const file = mkTmpFile(dir, fixture);
  assert.throws(() => _load(file), /duplicate category id/);
});

test('_load throws on a technique referencing an unknown category', () => {
  const dir = mkTmpDir();
  const fixture = baseFixture();
  fixture.techniques[0].category = 'ghost-category';
  const file = mkTmpFile(dir, fixture);
  assert.throws(() => _load(file), /category/);
});

test('_load throws on a duplicate technique id', () => {
  const dir = mkTmpDir();
  const fixture = baseFixture();
  fixture.techniques[1].id = 't1';
  const file = mkTmpFile(dir, fixture);
  assert.throws(() => _load(file), /duplicate technique id/);
});

test('_load throws on an invalid phase value', () => {
  const dir = mkTmpDir();
  const fixture = baseFixture();
  fixture.techniques[0].phase = 'sideways';
  const file = mkTmpFile(dir, fixture);
  assert.throws(() => _load(file), /phase/);
});

test('_load throws when goal_tags is missing or empty', () => {
  const dir = mkTmpDir();
  const fixture = baseFixture();
  fixture.techniques[0].goal_tags = [];
  const file = mkTmpFile(dir, fixture);
  assert.throws(() => _load(file), /goal_tags/);
});

// --- catalog.js's public surface never re-exposes the whole-catalog loader --

test('catalog.js does not export a whole-catalog "loadCatalog" name, and _load is not in mock-replay.js\'s OPS dispatch table', () => {
  const catalogModule = require('../src/catalog.js');
  assert.equal(catalogModule.loadCatalog, undefined);
  assert.equal(typeof catalogModule._load, 'function');

  const { OPS } = require('../src/mock-replay.js');
  const catalogOpNames = Object.keys(OPS).filter((name) => name.startsWith('catalog.'));
  assert.deepEqual(catalogOpNames.sort(), ['catalog.categories', 'catalog.list', 'catalog.sample', 'catalog.show']);
  assert.equal(OPS['catalog.loadCatalog'], undefined);
  assert.equal(OPS['catalog._load'], undefined);
});

// --- categories(): names+counts, never dumps techniques ---------------------

test('categories() returns id/title/count for every category, counts sum to total techniques', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  const cats = categories(cat);
  assert.equal(cats.length, 2);
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  assert.equal(byId['cat-a'].count, 2);
  assert.equal(byId['cat-b'].count, 2);
  assert.equal(byId['cat-a'].title, 'Category A');
  const total = cats.reduce((sum, c) => sum + c.count, 0);
  assert.equal(total, cat.techniques.length);
  // never leaks technique-level fields
  for (const c of cats) {
    assert.deepEqual(Object.keys(c).sort(), ['count', 'id', 'title']);
  }
});

// --- list(): id+name+mechanics only, REQUIRES a scoping filter, capped -----

test('list() refuses a bare call with no filter at all', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  assert.throws(() => list(cat), /requires at least one of "category" or "phase"/);
});

test('list() refuses a filter that carries only goal_tag (not category or phase)', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  assert.throws(() => list(cat, { goal_tag: 'novelty' }), /requires at least one of "category" or "phase"/);
});

test('list() refuses an unknown filter key even when category/phase is also present', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  assert.throws(() => list(cat, { category: 'cat-a', bogus: 1 }), /unknown key "bogus"/);
});

test('list() refuses a scoped call whose result exceeds the 12-entry cap', () => {
  const cat = _load(CATALOG_PATH);
  // "divergent" alone is a valid single-filter scope but matches far more
  // than 12 techniques in the real catalog — the cap refuses it rather than
  // truncating or returning the whole slice.
  assert.throws(() => list(cat, { phase: 'divergent' }), /exceeding the 12-entry cap/);
});

test('list() filters by category and never exceeds the filtered slice', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  const rows = list(cat, { category: 'cat-a' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['t1', 't2']);
});

test('list() filters by phase', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  const rows = list(cat, { phase: 'critique' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 't4');
});

test('list() filters by goal_tag combined with a required category/phase scope', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  const rows = list(cat, { category: 'cat-a', goal_tag: 'novelty' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 't2');
});

test('list() combines filters (AND semantics) and returns empty when nothing matches', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  const rows = list(cat, { category: 'cat-a', phase: 'critique' });
  assert.deepEqual(rows, []);
});

// --- show(): full entry ------------------------------------------------------

test('show() returns the full entry for a known id', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  const entry = show(cat, 't1');
  assert.equal(entry.id, 't1');
  assert.equal(entry.name, 'T1');
  assert.equal(entry.category, 'cat-a');
  assert.deepEqual(entry.goal_tags, ['feature']);
  assert.deepEqual(entry.audience_tags, ['solo']);
  assert.equal(entry.phase, 'divergent');
});

test('show() throws on an unknown id', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  assert.throws(() => show(cat, 'ghost'), /unknown technique/);
});

// --- sample(): deterministic seeded selection, REQUIRES phase, capped at 5 --

test('sample() requires an explicit seed and refuses to fall back to randomness', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  assert.throws(() => sample(cat, { phase: 'divergent', n: 2 }), /seed/);
});

test('sample() refuses a call with no phase at all', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  assert.throws(() => sample(cat, { n: 2, seed: 'x' }), /requires an explicit "phase"/);
});

test('sample() refuses n greater than the 5-entry cap', () => {
  const cat = _load(CATALOG_PATH);
  assert.throws(() => sample(cat, { phase: 'divergent', n: 6, seed: 'x' }), /exceeding the 5-entry cap/);
});

test('sample() refuses an unknown option key', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  assert.throws(() => sample(cat, { phase: 'divergent', n: 1, seed: 'x', bogus: 1 }), /unknown key "bogus"/);
});

test('sample() is deterministic: same seed + same params always returns the same result', () => {
  const cat = _load(CATALOG_PATH);
  const a = sample(cat, { phase: 'divergent', n: 5, seed: 'replay-42' });
  const b = sample(cat, { phase: 'divergent', n: 5, seed: 'replay-42' });
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
});

test('sample() with a different seed produces a different order or set (not hard-coded)', () => {
  const cat = _load(CATALOG_PATH);
  const a = sample(cat, { phase: 'divergent', n: 5, seed: 'seed-one' });
  const b = sample(cat, { phase: 'divergent', n: 5, seed: 'seed-two' });
  assert.notDeepEqual(a, b);
});

test('sample() never exceeds the requested n, respects the filtered pool, and only returns id/name/mechanics fields', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  const rows = sample(cat, { category: 'cat-a', phase: 'divergent', n: 5, seed: 'x' });
  assert.ok(rows.length <= 2, 'cannot sample more than the filtered pool');
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['id', 'mechanics', 'name']);
  }
});

test('sample() respects the phase and category filters before drawing', () => {
  const cat = _load(mkTmpFile(mkTmpDir(), baseFixture()));
  const rows = sample(cat, { phase: 'divergent', n: 5, seed: 'y' });
  assert.deepEqual(rows.map((r) => r.id).sort(), ['t1', 't2']);
});

test('sample() with numeric seeds is also deterministic', () => {
  const cat = _load(CATALOG_PATH);
  const a = sample(cat, { phase: 'convergent', n: 3, seed: 12345 });
  const b = sample(cat, { phase: 'convergent', n: 3, seed: 12345 });
  assert.deepEqual(a, b);
});

// ---------- CLI (P11 convergence finding 3: brainstorm-facilitator.md's
// commanded _load/categories/list/show/sample calls had no executable form) ----------

const { spawnSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'src', 'catalog.js');

test('CLI: categories prints the category map with no stdin required', () => {
  const catalogPath = mkTmpFile(mkTmpDir(), baseFixture());
  const proc = spawnSync(process.execPath, [CLI_PATH, 'categories', catalogPath], { encoding: 'utf8', input: '' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), [
    { id: 'cat-a', title: 'Category A', count: 2 },
    { id: 'cat-b', title: 'Category B', count: 2 },
  ]);
});

test('CLI: show prints the one full entry for the given id', () => {
  const catalogPath = mkTmpFile(mkTmpDir(), baseFixture());
  const proc = spawnSync(process.execPath, [CLI_PATH, 'show', catalogPath, 't1'], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(JSON.parse(proc.stdout).id, 't1');
});

test('CLI: show exits 1 for an unknown id', () => {
  const catalogPath = mkTmpFile(mkTmpDir(), baseFixture());
  const proc = spawnSync(process.execPath, [CLI_PATH, 'show', catalogPath], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /requires an <id>/);
});

test('CLI: list reads its filter from stdin and returns the scoped rows', () => {
  const catalogPath = mkTmpFile(mkTmpDir(), baseFixture());
  const proc = spawnSync(process.execPath, [CLI_PATH, 'list', catalogPath], {
    encoding: 'utf8',
    input: JSON.stringify({ category: 'cat-a' }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(
    JSON.parse(proc.stdout).map((r) => r.id).sort(),
    ['t1', 't2']
  );
});

test('CLI: list exits 1 (never dumps the whole catalog) when neither category nor phase is given', () => {
  const catalogPath = mkTmpFile(mkTmpDir(), baseFixture());
  const proc = spawnSync(process.execPath, [CLI_PATH, 'list', catalogPath], { encoding: 'utf8', input: '{}' });
  assert.equal(proc.status, 1);
});

test('CLI: sample reads its options from stdin and returns a deterministic scoped draw', () => {
  const catalogPath = mkTmpFile(mkTmpDir(), baseFixture());
  const options = JSON.stringify({ phase: 'divergent', n: 2, seed: 'cli-seed' });
  const a = spawnSync(process.execPath, [CLI_PATH, 'sample', catalogPath], { encoding: 'utf8', input: options });
  const b = spawnSync(process.execPath, [CLI_PATH, 'sample', catalogPath], { encoding: 'utf8', input: options });
  assert.equal(a.status, 0, a.stderr);
  assert.deepEqual(JSON.parse(a.stdout), JSON.parse(b.stdout));
});

test('CLI: sample exits 1 without a seed', () => {
  const catalogPath = mkTmpFile(mkTmpDir(), baseFixture());
  const proc = spawnSync(process.execPath, [CLI_PATH, 'sample', catalogPath], {
    encoding: 'utf8',
    input: JSON.stringify({ phase: 'divergent', n: 2 }),
  });
  assert.equal(proc.status, 1);
});

test('CLI: there is no bare "load" (or similarly unscoped) command that dumps the whole catalog', () => {
  const catalogPath = mkTmpFile(mkTmpDir(), baseFixture());
  const proc = spawnSync(process.execPath, [CLI_PATH, 'load', catalogPath], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /unknown command/);
});

test('CLI: missing catalogPath prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'categories'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: catalog\.js/);
});

test('CLI: a malformed catalog file fails closed with a catalog.js-prefixed error', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'catalog.json');
  fs.writeFileSync(file, '{ not json');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'categories', file], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^catalog\.js: /);
});
