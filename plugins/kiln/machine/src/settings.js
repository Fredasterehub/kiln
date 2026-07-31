'use strict';

const path = require('node:path');

const { readJson, writeAtomic } = require('./atomic-json');

const MISSING = Symbol('settings.missing-file');
const DEFAULT_SCHEMA_PATH = path.join(__dirname, '..', 'settings-schema.json');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireSchema(schema) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError('applySchema: schema must be an object of {key: rule}');
  }
}

// A write/read call's provenance: 'interview' names the one caller allowed
// to set an `interview_only` rule to a non-default value (product/onboarding/
// interview.md Step 5, the settings interview's own write() call); anything
// else — including simply omitting opts — is 'hand-edit', the fail-closed
// default for every other caller (a plain hand-edit of settings.json, a
// future tool, a test). Never inferred from the candidate's shape, only from
// what the caller explicitly declares.
function resolveProvenance(opts) {
  return opts && typeof opts.source === 'string' && opts.source.length > 0 ? opts.source : 'hand-edit';
}

function applySchema(obj, schema, opts) {
  requireSchema(schema);
  const input = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  const settings = { ...input };
  const clamps = [];
  const provenance = resolveProvenance(opts);

  for (const key of Object.keys(schema)) {
    const rule = schema[key];
    const present = Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;

    // A rule with `type: 'object'` + `properties` recurses applySchema over
    // its own sub-schema, so a compound setting (e.g. the budget knob's
    // {claude_ceiling_usd, codex_ceiling_usd, budget_report}) gets the exact
    // same per-key default/enum/floor/ceiling guarantees as a flat one,
    // including partial-override fill-in of only the missing sub-keys.
    if (isPlainObject(rule) && rule.type === 'object' && isPlainObject(rule.properties)) {
      const validNested = present && isPlainObject(input[key]);
      const nestedInput = validNested ? input[key] : {};
      const { settings: nestedSettings, clamps: nestedClamps } = applySchema(nestedInput, rule.properties, opts);
      settings[key] = nestedSettings;
      if (present && !validNested) {
        clamps.push({ key, from: input[key], to: nestedSettings, rule: 'invalid-type' });
      }
      for (const c of nestedClamps) {
        clamps.push({ key: `${key}.${c.key}`, from: c.from, to: c.to, rule: c.rule, ...(c.message ? { message: c.message } : {}) });
      }
      continue;
    }

    // A rule with `locked_by: '<siblingKey>'` (the floor-lock doctrine)
    // names a sibling key that must appear earlier in
    // this same schema, so its resolved value already sits in `settings` by
    // the time this key is reached. When that sibling resolves `true`, this
    // key's whole capability is not deployed in this install: it is omitted
    // from `settings` entirely — not defaulted, not present-as-false — and
    // if the input tried to carry it anyway (a candidate or an on-disk doc
    // naming the key, any value), that attempt is stripped and reported
    // through this same clamps channel, never a second reporting mechanism,
    // using the rule's own schema-owned `locked_message` text (single
    // source of truth for knob copy, product/onboarding/interview.md's own
    // doctrine extended to clamp messages).
    if (typeof rule.locked_by === 'string' && settings[rule.locked_by] === true) {
      // `settings` started as a shallow copy of `input` (above), so a
      // present key must be deleted here explicitly — every other branch in
      // this loop overwrites `settings[key]` itself, but this is the one
      // path that means "not deployed," and skipping the delete would leak
      // the raw, unvalidated input value straight through untouched.
      delete settings[key];
      if (present) {
        // `to: null`, not `undefined` — the latter can never round-trip
        // through a JSON scenario file's `expect` block (JSON has no
        // `undefined` literal, and neither omitting the field nor writing
        // `null` would deep-equal a real `to: undefined` value), and `null`
        // reads perfectly well here as "nothing landed."
        clamps.push({ key, from: input[key], to: null, rule: 'locked', message: rule.locked_message });
      }
      continue;
    }

    if (!present) {
      settings[key] = rule.default;
      clamps.push({ key, from: undefined, to: rule.default, rule: 'default' });
      continue;
    }

    const value = input[key];

    // A nullable rule treats an explicit `null` as a first-class value (e.g.
    // "no ceiling"), never a validation failure and never coerced to the
    // default — only genuinely missing/undefined keys fall back to default.
    if (rule.nullable === true && value === null) {
      settings[key] = null;
      continue;
    }

    if (Array.isArray(rule.enum)) {
      let resolved;
      let enumClamped = false;
      if (rule.enum.includes(value)) {
        resolved = value;
      } else {
        resolved = rule.default;
        enumClamped = true;
      }

      // A rule with `interview_only: true` (the floor-lock doctrine again:
      // floor_lock itself is only settable to a non-default value by the
      // settings interview's own write() call — "the lock is not
      // hand-unlockable, that's the point") clamps a non-default resolved
      // value back to the default whenever this call's provenance isn't
      // 'interview', reported through the same clamps channel with the
      // rule's own schema-owned `source_locked_message`. A resolved value
      // that already equals the default never trips this — only an actual
      // unlock attempt does.
      if (!enumClamped && rule.interview_only === true && resolved !== rule.default && provenance !== 'interview') {
        clamps.push({ key, from: value, to: rule.default, rule: 'source-locked', message: rule.source_locked_message });
        settings[key] = rule.default;
        continue;
      }

      settings[key] = resolved;
      if (enumClamped) {
        clamps.push({ key, from: value, to: rule.default, rule: 'enum' });
      } else if (rule.warn_when !== undefined && resolved === rule.warn_when) {
        // A rule with `warn_when: <value>` reports — never clamps — when
        // the resolved value matches it (override_verification_floor's own
        // "loud warning on every run that uses it"): `to` equals `from`
        // because nothing is being changed, only flagged, through the same
        // clamps channel via the rule's own schema-owned `warn_message`.
        clamps.push({ key, from: resolved, to: resolved, rule: 'warn', message: rule.warn_message });
      }
      continue;
    }

    const hasFloor = typeof rule.floor === 'number';
    const hasCeiling = typeof rule.ceiling === 'number';

    if (hasFloor || hasCeiling) {
      // A floor/ceiling rule is a numeric rule: a wrong-typed value (e.g. a
      // string) or a non-finite number (NaN, Infinity) must not silently
      // bypass the bound by skipping the numeric comparisons below.
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        settings[key] = rule.default;
        clamps.push({ key, from: value, to: rule.default, rule: 'invalid-type' });
        continue;
      }
      if (hasFloor && value < rule.floor) {
        settings[key] = rule.floor;
        clamps.push({ key, from: value, to: rule.floor, rule: 'floor' });
        continue;
      }
      if (hasCeiling && value > rule.ceiling) {
        settings[key] = rule.ceiling;
        clamps.push({ key, from: value, to: rule.ceiling, rule: 'ceiling' });
        continue;
      }
    }

    settings[key] = value;
  }

  return { settings, clamps };
}

function loadSettings(file, schema, opts) {
  requireSchema(schema);
  const raw = readJson(file, MISSING);
  const source = raw === MISSING ? 'defaults' : 'file';
  // opts (provenance) is threaded through here too, not only write() below:
  // a hand-edited on-disk doc bypasses write() entirely (a text editor, not
  // this module), so the only place a hand-edited `floor_lock: false` can
  // ever be caught and clamped back is the next read — omitting opts here
  // (the default 'hand-edit' provenance) would make the lock trivially
  // bypassable by editing the file directly, defeating the doctrine.
  const { settings, clamps } = applySchema(source === 'file' ? raw : {}, schema, opts);
  return { settings, clamps, source };
}

// Loads machine/settings-schema.json (or any doc shaped like it): the
// product's schema_version + knobs (applySchema-shaped, per key a rule) +
// presets (named override bundles for the knobs). Throws rather than
// defaulting — a missing or malformed product schema is a build defect, not
// a runtime state to paper over.
function loadProductSchema(file) {
  const raw = readJson(file, MISSING);
  if (raw === MISSING) {
    throw new Error(`settings: product schema file not found: ${file}`);
  }
  if (!isPlainObject(raw) || !isPlainObject(raw.knobs)) {
    throw new Error(`settings: product schema at ${file} must be an object with a "knobs" object`);
  }
  return raw;
}

// write(treeRoot, candidate, opts) — the onboarding interview's SOLE caller
// into this module once the interview finishes (Kiln's own Bash law, the
// onboarding-engine point: settings.js write is Kiln's sole-caller call
// after the interview, the same pattern the delivery engine point already
// uses). Validates and floor-clamps candidate via THIS module's own
// applySchema/loadProductSchema — never a second validation path — then
// atomic-writes the clamped doc to <treeRoot>/settings.json and returns
// exactly what landed on disk. candidate must already be a JSON object (the
// CLI's own json-string argument is parsed into one before reaching here,
// see main() below); a non-object candidate is refused outright rather than
// silently defaulted, so a caller mistake surfaces as a loud failure instead
// of "every setting quietly reset to default."
//
// opts.source is this call's provenance (product/onboarding/interview.md
// Step 5): the settings interview is the sole caller entitled to pass
// `{ source: 'interview' }`, which is what
// lets a `floor_lock: false` pick in candidate actually land — every other
// caller, including an omitted opts, gets the fail-closed 'hand-edit'
// default, under which `applySchema`'s `interview_only` rule clamps
// floor_lock back to true no matter what candidate asks for ("the lock is
// not hand-unlockable, that's the point"). The CLI below exposes this as
// `--source interview` (product/onboarding/flow.md's pinned invocation).
function write(treeRoot, candidate, opts) {
  if (typeof treeRoot !== 'string' || treeRoot === '') {
    throw new TypeError('settings: treeRoot must be a non-empty string');
  }
  if (!isPlainObject(candidate)) {
    throw new TypeError('settings: write requires candidate to be a JSON object');
  }

  const { knobs } = loadProductSchema(DEFAULT_SCHEMA_PATH);
  const { settings } = applySchema(candidate, knobs, opts);

  writeAtomic(path.join(treeRoot, 'settings.json'), settings);
  return settings;
}

// read(treeRoot) — prints <treeRoot>/settings.json exactly as it sits on
// disk, never re-clamped: a genesis tree's settings.json is `{}`
// (scaffold.js) until write() above has run once, and that emptiness is
// itself the honest answer this command reports rather than a schema-filled
// substitute.
function read(treeRoot) {
  if (typeof treeRoot !== 'string' || treeRoot === '') {
    throw new TypeError('settings: treeRoot must be a non-empty string');
  }
  return readJson(path.join(treeRoot, 'settings.json'), {});
}

// CLI entrypoint (this codebase's flat one-command convention — phases.js/
// delivery.js/scaffold.js). `write` takes the whole candidate settings doc
// as a single JSON-string argument (the interview's assembled answers in
// one shot) plus the optional `--source <value>` flag (product/onboarding/
// flow.md's pinned invocation passes `--source interview`, the only caller
// entitled to unlock floor_lock); `--source` is scanned out of the argument
// list wherever it appears rather than pinned to a fixed position, so it
// reads naturally whether written before or after the JSON argument. `read`
// takes neither.
function parseArgv(argv) {
  const [command, treeRoot, ...rest] = argv;
  let source;
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--source') {
      source = rest[i + 1];
      i += 1;
    } else {
      positional.push(rest[i]);
    }
  }
  return { command, treeRoot, jsonText: positional[0], source };
}

function main(argv) {
  const { command, treeRoot, jsonText, source } = parseArgv(argv);
  if (!command || !treeRoot) {
    process.stderr.write("usage: settings.js <write|read> <treeRoot> ['<json>'] [--source interview]\n");
    process.exit(1);
    return;
  }
  try {
    let result;
    if (command === 'write') {
      if (typeof jsonText !== 'string' || jsonText === '') {
        throw new Error('write requires a JSON string argument');
      }
      let candidate;
      try {
        candidate = JSON.parse(jsonText);
      } catch (err) {
        throw new Error(`json argument is not valid JSON: ${err.message}`);
      }
      result = write(treeRoot, candidate, { source });
    } else if (command === 'read') {
      result = read(treeRoot);
    } else {
      throw new Error(`unknown command "${command}" (expected write or read)`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`settings.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { applySchema, loadSettings, loadProductSchema, write, read, DEFAULT_SCHEMA_PATH };
