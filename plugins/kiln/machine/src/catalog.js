'use strict';

// Scoped serving discipline for the brainstorm technique catalog
// (product/brainstorm/catalog.json), per the BMAD-brainstorm study §e/§b:
// NEVER dump the whole library into a caller's context. _load() validates
// the shape once, fail-closed, and is the only function in this module that
// returns the unscoped whole catalog — it is deliberately underscore-named
// and never wired into the dev-side replay harness's OPS dispatch table (P4
// Sol review BLOCKING-1). Every other function here takes the already-loaded
// catalog and returns only the slice a caller asked for — categories()
// (names+counts), list()/sample() (id+name+mechanics, the "pick a
// technique" view — both REQUIRE a scoping filter and REFUSE a call wide
// enough to reconstruct the roster), show() (the one full entry a caller
// committed to running). sample() takes an explicit seed rather than
// Math.random() so a facilitator session is replayable: the same seed
// reproduces the same technique batch for a resumed session or a reviewed
// transcript.

const fs = require('node:fs');

const PHASES = new Set(['divergent', 'convergent', 'critique']);
const SCOPED_LIST_KEYS = ['id', 'name', 'mechanics'];

// Hard caps on the scoped-serving discipline (P4 Sol review BLOCKING-1):
// list() and sample() must never be usable to reconstruct the whole catalog
// in one call. Exceeding either cap is a refusal, not a silent truncation —
// the caller narrows the filter and calls again, the same "hard refusal on
// any command that would dump the whole catalog" shape the r2 BMAD study
// documents for the baseline's own CLI (§b line 247).
const LIST_CAP = 12;
const SAMPLE_CAP = 5;
const LIST_FILTER_KEYS = new Set(['category', 'phase', 'goal_tag']);
const SAMPLE_OPTION_KEYS = new Set(['phase', 'category', 'n', 'seed']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function validateCategoryShape(category, index) {
  const where = `categories[${index}]`;
  if (!isPlainObject(category)) return [`${where}: must be an object`];
  const errors = [];
  if (!isNonEmptyString(category.id)) errors.push(`${where}: "id" must be a non-empty string`);
  if (!isNonEmptyString(category.title)) errors.push(`${where}: "title" must be a non-empty string`);
  if (!isNonEmptyString(category.description)) errors.push(`${where}: "description" must be a non-empty string`);
  return errors;
}

function validateTechniqueShape(technique, index, categoryIds) {
  const where = `techniques[${index}]`;
  if (!isPlainObject(technique)) return [`${where}: must be an object`];
  const errors = [];
  if (!isNonEmptyString(technique.id)) errors.push(`${where}: "id" must be a non-empty string`);
  if (!isNonEmptyString(technique.name)) errors.push(`${where}: "name" must be a non-empty string`);
  if (!isNonEmptyString(technique.mechanics)) errors.push(`${where}: "mechanics" must be a non-empty string`);
  if (!isNonEmptyString(technique.category) || !categoryIds.has(technique.category)) {
    errors.push(`${where}: "category" must reference a declared category id`);
  }
  if (!isNonEmptyStringArray(technique.goal_tags)) {
    errors.push(`${where}: "goal_tags" must be a non-empty array of strings`);
  }
  if (!isNonEmptyStringArray(technique.audience_tags)) {
    errors.push(`${where}: "audience_tags" must be a non-empty array of strings`);
  }
  if (!PHASES.has(technique.phase)) {
    errors.push(`${where}: "phase" must be one of ${[...PHASES].join(', ')}`);
  }
  return errors;
}

// _load(catalogPath) — reads, parses, and validates the catalog file. Fails
// closed on any shape defect: not an object, wrong/missing schema_version,
// empty categories/techniques, a malformed entry, a duplicate id, or a
// technique referencing an unknown category all throw rather than returning
// a partially-usable catalog.
//
// Deliberately underscore-named and NEVER added to the dev-side replay
// harness's OPS dispatch table (P4 Sol review BLOCKING-1): this is the one function in
// the module that returns the unscoped whole catalog, so it is not part of
// the scoped-serving surface a session/scenario can reach by name — only
// categories()/list()/show()/sample() are. A caller that needs a `cat`
// handle (the facilitator, running this module directly via Bash, or a test)
// calls _load() once, then passes the handle to the scoped functions below;
// that direct-require call is not the same reachability surface the
// dispatcher's OPS table stands in for.
function _load(catalogPath) {
  if (!isNonEmptyString(catalogPath)) {
    throw new TypeError('catalog: catalogPath must be a non-empty string');
  }

  let raw;
  try {
    raw = fs.readFileSync(catalogPath, 'utf8');
  } catch (err) {
    throw new Error(`catalog: could not read catalog at ${catalogPath}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`catalog: catalog at ${catalogPath} is not valid JSON: ${err.message}`);
  }

  if (!isPlainObject(parsed) || parsed.schema_version !== 1) {
    throw new Error(`catalog: catalog at ${catalogPath} must be an object declaring schema_version 1`);
  }
  if (!Array.isArray(parsed.categories) || parsed.categories.length === 0) {
    throw new Error(`catalog: catalog at ${catalogPath} must declare a non-empty "categories" array`);
  }
  if (!Array.isArray(parsed.techniques) || parsed.techniques.length === 0) {
    throw new Error(`catalog: catalog at ${catalogPath} must declare a non-empty "techniques" array`);
  }

  const categoryErrors = [];
  parsed.categories.forEach((c, i) => categoryErrors.push(...validateCategoryShape(c, i)));
  if (categoryErrors.length > 0) {
    throw new Error(`catalog: catalog at ${catalogPath} is malformed: ${categoryErrors.join('; ')}`);
  }

  const categoryIds = new Set();
  for (const c of parsed.categories) {
    if (categoryIds.has(c.id)) {
      throw new Error(`catalog: catalog at ${catalogPath} declares duplicate category id "${c.id}"`);
    }
    categoryIds.add(c.id);
  }

  const techniqueErrors = [];
  parsed.techniques.forEach((t, i) => techniqueErrors.push(...validateTechniqueShape(t, i, categoryIds)));
  if (techniqueErrors.length > 0) {
    throw new Error(`catalog: catalog at ${catalogPath} is malformed: ${techniqueErrors.join('; ')}`);
  }

  const techniqueIds = new Set();
  for (const t of parsed.techniques) {
    if (techniqueIds.has(t.id)) {
      throw new Error(`catalog: catalog at ${catalogPath} declares duplicate technique id "${t.id}"`);
    }
    techniqueIds.add(t.id);
  }

  return { schema_version: parsed.schema_version, categories: parsed.categories, techniques: parsed.techniques };
}

function assertCatalog(cat) {
  if (!isPlainObject(cat) || !Array.isArray(cat.categories) || !Array.isArray(cat.techniques)) {
    throw new TypeError('catalog: expected a catalog object as returned by _load()');
  }
}

function toScopedRow(technique) {
  return { id: technique.id, name: technique.name, mechanics: technique.mechanics };
}

function assertNoUnknownKeys(obj, allowed, where) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new TypeError(`catalog: ${where} has unknown key "${key}" (allowed: ${[...allowed].join(', ')})`);
    }
  }
}

// categories(cat) -> [{id, title, count}] — the cheap map: every category
// name plus how many techniques it holds, never the techniques themselves.
function categories(cat) {
  assertCatalog(cat);
  const counts = new Map();
  for (const t of cat.techniques) {
    counts.set(t.category, (counts.get(t.category) || 0) + 1);
  }
  return cat.categories.map((c) => ({ id: c.id, title: c.title, count: counts.get(c.id) || 0 }));
}

function matchesFilter(technique, filter) {
  if (filter.category && technique.category !== filter.category) return false;
  if (filter.phase && technique.phase !== filter.phase) return false;
  if (filter.goal_tag && !technique.goal_tags.includes(filter.goal_tag)) return false;
  return true;
}

// list(cat, {category, phase, goal_tag}) -> [{id, name, mechanics}] — the
// scoped index a facilitator scans to pick a technique, never the full
// entry (mechanics only, no tags/category leaking through this view).
// REQUIRES at least one of category/phase (goal_tag alone does not count as
// scoping — it can still span every category) and REFUSES a filtered result
// wider than LIST_CAP entries rather than truncating it silently: either
// case is the caller's cue to narrow the filter and call again, never a
// path back to the whole roster in one call (P4 Sol review BLOCKING-1).
function list(cat, filter = {}) {
  assertCatalog(cat);
  if (!isPlainObject(filter)) {
    throw new TypeError('catalog: list() filter must be an object');
  }
  assertNoUnknownKeys(filter, LIST_FILTER_KEYS, 'list() filter');
  if (!isNonEmptyString(filter.category) && !isNonEmptyString(filter.phase)) {
    throw new Error(
      'catalog: list() requires at least one of "category" or "phase" to scope the call — an unscoped list() would serve the whole catalog, which the serving discipline forbids'
    );
  }
  const rows = cat.techniques.filter((t) => matchesFilter(t, filter)).map(toScopedRow);
  if (rows.length > LIST_CAP) {
    throw new Error(
      `catalog: list() matched ${rows.length} techniques, exceeding the ${LIST_CAP}-entry cap — narrow the filter (add or tighten category/phase/goal_tag) and call list() again`
    );
  }
  return rows;
}

// show(cat, id) -> the one full entry a caller committed to running.
function show(cat, id) {
  assertCatalog(cat);
  const technique = cat.techniques.find((t) => t.id === id);
  if (!technique) {
    throw new Error(`catalog: unknown technique id "${id}"`);
  }
  return { ...technique };
}

// Deterministic PRNG (mulberry32) seeded from an integer. Never Math.random:
// sample() must be replayable given the same seed, so a resumed session or a
// reviewed transcript reproduces the exact same technique batch.
function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Folds a string seed into a 32-bit integer (FNV-1a) so callers can pass a
// human-readable seed (a session id, a resume token) instead of memorizing
// an integer. An integer seed is used as-is.
function seedToInt(seed) {
  if (typeof seed === 'number' && Number.isInteger(seed)) return seed >>> 0;
  if (isNonEmptyString(seed)) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
  throw new TypeError('catalog: sample() seed must be a non-empty string or an integer');
}

// sample(cat, {phase, category, n, seed}) -> up to n scoped rows drawn from
// the filtered pool via a seeded Fisher-Yates shuffle. seed is REQUIRED (no
// default, no Math.random fallback) so every draw is deterministic and
// replayable; the same {phase, category, n, seed} always returns the same
// technique batch in the same order. phase is also REQUIRED (P4 Sol review
// BLOCKING-1: an unscoped draw is still a whole-catalog-adjacent call), and
// n is capped at SAMPLE_CAP — refused, not clamped, past that ceiling.
function sample(cat, opts = {}) {
  assertCatalog(cat);
  if (!isPlainObject(opts)) {
    throw new TypeError('catalog: sample() options must be an object');
  }
  assertNoUnknownKeys(opts, SAMPLE_OPTION_KEYS, 'sample() options');
  const { phase, category, n, seed } = opts;
  if (!isNonEmptyString(phase)) {
    throw new TypeError(
      'catalog: sample() requires an explicit "phase" to scope the draw — an unscoped sample() would serve across the whole catalog, which the serving discipline forbids'
    );
  }
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError('catalog: sample() requires an integer "n" >= 0');
  }
  if (n > SAMPLE_CAP) {
    throw new RangeError(`catalog: sample() refuses n=${n}, exceeding the ${SAMPLE_CAP}-entry cap per draw`);
  }
  if (seed === undefined || seed === null) {
    throw new TypeError('catalog: sample() requires an explicit "seed" for deterministic, replayable output');
  }

  const pool = cat.techniques.filter((t) => matchesFilter(t, { category, phase }));
  const rng = mulberry32(seedToInt(seed));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n).map(toScopedRow);
}

// CLI entrypoint (P11 convergence finding 3: agents/brainstorm-facilitator.md
// names _load/categories/list/show/sample as commanded runtime calls with no
// executable form under a real plugin install — an LLM agent's Bash tool can
// only run a shell command, never hold an in-process JS handle across
// separate calls the way the facilitator's own prose describes "keeping a
// handle in working memory"). Every subcommand loads the catalog internally
// via _load and returns ONLY a scoped view — there is deliberately no bare
// "load" command that would print the whole catalog raw; that would defeat
// the exact scoped-serving discipline categories()/list()/show()/sample()
// already hold in-process (P4 Sol review BLOCKING-1).
function readStdinJson(label) {
  const text = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} JSON via stdin is not valid JSON: ${err.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${label} JSON via stdin must be a JSON object`);
  }
  return parsed;
}

function parseArgv(argv) {
  const [command, catalogPath, ...rest] = argv;
  return { command, catalogPath, rest };
}

function main(argv) {
  const { command, catalogPath, rest } = parseArgv(argv);
  if (!isNonEmptyString(catalogPath)) {
    process.stderr.write(
      'usage: catalog.js <categories|list|show|sample> <catalogPath> [id]   (list/sample take a filter/options JSON via stdin)\n'
    );
    process.exit(1);
  }
  try {
    const cat = _load(catalogPath);
    let result;
    if (command === 'categories') {
      result = categories(cat);
    } else if (command === 'list') {
      result = list(cat, readStdinJson('list filter'));
    } else if (command === 'show') {
      const id = rest[0];
      if (!isNonEmptyString(id)) {
        throw new Error('show requires an <id> argument');
      }
      result = show(cat, id);
    } else if (command === 'sample') {
      result = sample(cat, readStdinJson('sample options'));
    } else {
      throw new Error(`unknown command "${command}" (expected categories, list, show, or sample)`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`catalog.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { _load, categories, list, show, sample, SCOPED_LIST_KEYS };
