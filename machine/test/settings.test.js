'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { applySchema, loadSettings, write, read } = require('../src/settings.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'settings.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
}

function baseSchema() {
  return {
    reviewMultiplier: { default: 1, floor: 1, ceiling: 5 },
    researchWidth: { default: 3, floor: 2, ceiling: 5 },
    facilitator: { default: 'opus', enum: ['opus', 'fable'] },
  };
}

// --- applySchema: floor clamp up ---

test('applySchema clamps a below-floor value up to the floor', () => {
  const input = { reviewMultiplier: 0, researchWidth: 3, facilitator: 'opus' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.reviewMultiplier, 1);
  assert.deepEqual(clamps, [{ key: 'reviewMultiplier', from: 0, to: 1, rule: 'floor' }]);
});

test('applySchema does not clamp a value exactly at the floor', () => {
  const input = { reviewMultiplier: 1, researchWidth: 3, facilitator: 'opus' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.reviewMultiplier, 1);
  assert.deepEqual(clamps, []);
});

// --- applySchema: ceiling clamp down ---

test('applySchema clamps an above-ceiling value down to the ceiling', () => {
  const input = { reviewMultiplier: 99, researchWidth: 3, facilitator: 'opus' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.reviewMultiplier, 5);
  assert.deepEqual(clamps, [{ key: 'reviewMultiplier', from: 99, to: 5, rule: 'ceiling' }]);
});

test('applySchema does not clamp a value exactly at the ceiling', () => {
  const input = { reviewMultiplier: 5, researchWidth: 3, facilitator: 'opus' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.reviewMultiplier, 5);
  assert.deepEqual(clamps, []);
});

// --- applySchema: enum reset ---

test('applySchema resets an enum-violating value to the default', () => {
  const input = { reviewMultiplier: 1, researchWidth: 3, facilitator: 'sonnet' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.facilitator, 'opus');
  assert.deepEqual(clamps, [{ key: 'facilitator', from: 'sonnet', to: 'opus', rule: 'enum' }]);
});

test('applySchema keeps a valid enum value untouched', () => {
  const input = { reviewMultiplier: 1, researchWidth: 3, facilitator: 'fable' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.facilitator, 'fable');
  assert.deepEqual(clamps, []);
});

// --- applySchema: missing key -> default ---

test('applySchema fills a missing key with its default and reports rule "default"', () => {
  const { settings, clamps } = applySchema({}, baseSchema());
  assert.deepEqual(settings, { reviewMultiplier: 1, researchWidth: 3, facilitator: 'opus' });
  assert.deepEqual(clamps, [
    { key: 'reviewMultiplier', from: undefined, to: 1, rule: 'default' },
    { key: 'researchWidth', from: undefined, to: 3, rule: 'default' },
    { key: 'facilitator', from: undefined, to: 'opus', rule: 'default' },
  ]);
});

test('applySchema treats an explicit undefined value as missing', () => {
  const input = { reviewMultiplier: undefined, researchWidth: 3, facilitator: 'opus' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.reviewMultiplier, 1);
  assert.deepEqual(clamps, [{ key: 'reviewMultiplier', from: undefined, to: 1, rule: 'default' }]);
});

// --- applySchema: unknown-key preservation ---

test('applySchema preserves unknown keys untouched and does not report clamps for them', () => {
  const input = { reviewMultiplier: 1, researchWidth: 3, facilitator: 'opus', customSeat: 'maestro-x' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.customSeat, 'maestro-x');
  assert.deepEqual(clamps, []);
});

test('applySchema preserves an unknown key even when it collides with no schema entry at all', () => {
  const input = {
    reviewMultiplier: 1,
    researchWidth: 3,
    facilitator: 'opus',
    budgetCeilingUsd: 250,
    nested: { a: 1 },
  };
  const { settings } = applySchema(input, baseSchema());
  assert.equal(settings.budgetCeilingUsd, 250);
  assert.deepEqual(settings.nested, { a: 1 });
});

// --- applySchema: purity ---

test('applySchema does not mutate the input object', () => {
  const input = { reviewMultiplier: 0 };
  const frozenCopy = { ...input };
  applySchema(input, baseSchema());
  assert.deepEqual(input, frozenCopy);
});

test('applySchema does not mutate the schema object', () => {
  const schema = baseSchema();
  const schemaCopy = JSON.parse(JSON.stringify(schema));
  applySchema({ reviewMultiplier: 0 }, schema);
  assert.deepEqual(schema, schemaCopy);
});

// --- applySchema: wrong-typed/non-finite values cannot bypass numeric bounds (MAJOR-5) ---

test('applySchema rejects a string value for a numeric-bounded rule instead of letting it bypass the ceiling', () => {
  const input = { reviewMultiplier: '100', researchWidth: 3, facilitator: 'opus' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.reviewMultiplier, 1);
  assert.deepEqual(clamps, [{ key: 'reviewMultiplier', from: '100', to: 1, rule: 'invalid-type' }]);
});

test('applySchema rejects NaN for a numeric-bounded rule instead of letting it bypass both bounds', () => {
  const input = { reviewMultiplier: NaN, researchWidth: 3, facilitator: 'opus' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.reviewMultiplier, 1);
  assert.deepEqual(clamps, [{ key: 'reviewMultiplier', from: NaN, to: 1, rule: 'invalid-type' }]);
});

test('applySchema rejects Infinity for a numeric-bounded rule instead of letting it bypass the ceiling', () => {
  const input = { reviewMultiplier: Infinity, researchWidth: 3, facilitator: 'opus' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.reviewMultiplier, 1);
  assert.deepEqual(clamps, [{ key: 'reviewMultiplier', from: Infinity, to: 1, rule: 'invalid-type' }]);
});

test('applySchema rejects -Infinity for a numeric-bounded rule instead of letting it bypass the floor', () => {
  const input = { reviewMultiplier: -Infinity, researchWidth: 3, facilitator: 'opus' };
  const { settings, clamps } = applySchema(input, baseSchema());
  assert.equal(settings.reviewMultiplier, 1);
  assert.deepEqual(clamps, [{ key: 'reviewMultiplier', from: -Infinity, to: 1, rule: 'invalid-type' }]);
});

// --- applySchema: multiple clamps reported together, exact shape ---

test('applySchema reports every clamp in one pass with exact from/to values', () => {
  const { settings, clamps } = applySchema(
    { reviewMultiplier: 0, researchWidth: 99, facilitator: 'nope' },
    baseSchema()
  );
  assert.deepEqual(settings, { reviewMultiplier: 1, researchWidth: 5, facilitator: 'opus' });
  assert.deepEqual(clamps, [
    { key: 'reviewMultiplier', from: 0, to: 1, rule: 'floor' },
    { key: 'researchWidth', from: 99, to: 5, rule: 'ceiling' },
    { key: 'facilitator', from: 'nope', to: 'opus', rule: 'enum' },
  ]);
});

// --- applySchema: error cases ---

test('applySchema treats a missing obj argument as empty (all defaults)', () => {
  const { settings, clamps } = applySchema(undefined, baseSchema());
  assert.deepEqual(settings, { reviewMultiplier: 1, researchWidth: 3, facilitator: 'opus' });
  assert.equal(clamps.length, 3);
});

test('applySchema throws a TypeError when schema is missing', () => {
  assert.throws(() => applySchema({}, undefined), TypeError);
});

test('applySchema throws a TypeError when schema is not an object', () => {
  assert.throws(() => applySchema({}, 'not-a-schema'), TypeError);
});

// --- applySchema: locked_by / warn_when / interview_only — the generic
// mechanism the floor-lock doctrine (settings-menu-design.md §4 point 4
// layer (c), operator ruling 2026-07-28 [seq 48]) is built from. Tested
// here schema-agnostically, the same way enum/floor/ceiling are tested
// above; the product schema's own floor_lock/override_verification_floor
// wiring is proven separately by settings-schema.test.js. ---

function lockSchema() {
  return {
    lock: { default: true, enum: [true, false], interview_only: true, source_locked_message: 'lock cannot be hand-unlocked' },
    secret: { default: false, enum: [true, false], locked_by: 'lock', locked_message: 'lock is on; secret is inert', warn_when: true, warn_message: 'secret is active' },
  };
}

test('applySchema omits a locked_by-gated key entirely when its gate resolves to the schema default (true), absent input reports no clamp for it', () => {
  const { settings, clamps } = applySchema({}, lockSchema());
  assert.deepEqual(settings, { lock: true });
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'secret'), false);
  assert.deepEqual(
    clamps.filter((c) => c.key === 'secret'),
    []
  );
});

test('applySchema strips a locked_by-gated key that IS present while gated, reporting the rule\'s own message and leaking no raw value through', () => {
  const { settings, clamps } = applySchema({ secret: true }, lockSchema());
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'secret'), false);
  assert.deepEqual(clamps.find((c) => c.key === 'secret'), {
    key: 'secret',
    from: true,
    to: null,
    rule: 'locked',
    message: 'lock is on; secret is inert',
  });
});

test('applySchema lets a locked_by-gated key resolve and warn normally once its gate resolves false', () => {
  const { settings, clamps } = applySchema({ lock: false, secret: true }, lockSchema(), { source: 'interview' });
  assert.equal(settings.secret, true);
  assert.deepEqual(clamps.filter((c) => c.key === 'secret'), [
    { key: 'secret', from: true, to: true, rule: 'warn', message: 'secret is active' },
  ]);
});

test('applySchema clamps an interview_only key\'s hand-edited non-default value back to the default, reporting rule "source-locked"', () => {
  const { settings, clamps } = applySchema({ lock: false }, lockSchema());
  assert.equal(settings.lock, true);
  assert.deepEqual(clamps.find((c) => c.key === 'lock'), {
    key: 'lock',
    from: false,
    to: true,
    rule: 'source-locked',
    message: 'lock cannot be hand-unlocked',
  });
});

test('applySchema honors an interview_only key\'s non-default value when opts.source is "interview"', () => {
  const { settings, clamps } = applySchema({ lock: false }, lockSchema(), { source: 'interview' });
  assert.equal(settings.lock, false);
  assert.deepEqual(
    clamps.filter((c) => c.key === 'lock'),
    []
  );
});

test('applySchema never clamps an interview_only key when the value already equals the default, regardless of source', () => {
  const { settings, clamps } = applySchema({ lock: true }, lockSchema());
  assert.equal(settings.lock, true);
  assert.deepEqual(
    clamps.filter((c) => c.key === 'lock'),
    []
  );
});

test('applySchema treats an opts with a non-string or empty source the same as an omitted opts (fail-closed "hand-edit")', () => {
  for (const badOpts of [undefined, {}, { source: '' }, { source: 42 }]) {
    const { settings } = applySchema({ lock: false }, lockSchema(), badOpts);
    assert.equal(settings.lock, true, `opts=${JSON.stringify(badOpts)}`);
  }
});

// --- loadSettings: defaults on missing file ---

test('loadSettings returns defaults with source "defaults" when the file does not exist', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'settings.json');
  const result = loadSettings(file, baseSchema());
  assert.equal(result.source, 'defaults');
  assert.deepEqual(result.settings, { reviewMultiplier: 1, researchWidth: 3, facilitator: 'opus' });
  assert.equal(result.clamps.length, 3);
});

// --- loadSettings: reads file, source "file" ---

test('loadSettings reads an existing file and reports source "file"', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ reviewMultiplier: 3, customSeat: 'maestro-x' }));
  const result = loadSettings(file, baseSchema());
  assert.equal(result.source, 'file');
  assert.equal(result.settings.reviewMultiplier, 3);
  assert.equal(result.settings.customSeat, 'maestro-x');
  assert.deepEqual(result.clamps, [
    { key: 'researchWidth', from: undefined, to: 3, rule: 'default' },
    { key: 'facilitator', from: undefined, to: 'opus', rule: 'default' },
  ]);
});

test('loadSettings reports source "file" even when the on-disk object is empty', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({}));
  const result = loadSettings(file, baseSchema());
  assert.equal(result.source, 'file');
  assert.deepEqual(result.settings, { reviewMultiplier: 1, researchWidth: 3, facilitator: 'opus' });
});

test('loadSettings clamps an out-of-range value read from disk', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ reviewMultiplier: -5 }));
  const result = loadSettings(file, baseSchema());
  assert.equal(result.settings.reviewMultiplier, 1);
  assert.deepEqual(
    result.clamps.find((c) => c.key === 'reviewMultiplier'),
    { key: 'reviewMultiplier', from: -5, to: 1, rule: 'floor' }
  );
});

// --- loadSettings: opts (provenance) threading — a hand-edited on-disk
// file bypasses write() entirely, so loadSettings must apply the same
// interview_only gate on read, not only on write (operator ruling
// 2026-07-28 [seq 48]) ---

test('loadSettings clamps a hand-edited interview_only value read from disk back to its default when opts is omitted', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ lock: false }));
  const result = loadSettings(file, lockSchema());
  assert.equal(result.settings.lock, true);
  assert.deepEqual(result.clamps.find((c) => c.key === 'lock'), {
    key: 'lock',
    from: false,
    to: true,
    rule: 'source-locked',
    message: 'lock cannot be hand-unlocked',
  });
});

test('loadSettings honors an interview_only value read from disk when called with the interview provenance', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ lock: false }));
  const result = loadSettings(file, lockSchema(), { source: 'interview' });
  assert.equal(result.settings.lock, false);
});

// --- loadSettings: error cases ---

test('loadSettings propagates a corrupt-JSON parse error from atomic-json rather than silently defaulting', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ not valid json');
  assert.throws(() => loadSettings(file, baseSchema()), /atomic-json/);
});

test('loadSettings throws when schema is missing', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'settings.json');
  assert.throws(() => loadSettings(file, undefined), TypeError);
});

// --- write: floor-clamps via the SAME applySchema/loadProductSchema this
// module already exports — never a second validation path ---

test('write floor-clamps a candidate settings doc and atomic-writes settings.json', () => {
  const dir = makeTmpDir();
  const result = write(dir, { budget: { claude_ceiling_usd: -30 }, reviews: 'off' });

  assert.equal(result.budget.claude_ceiling_usd, 0);
  assert.equal(result.reviews, 'floor'); // reviews can never resolve below the floor
  assert.equal(result.facilitator, 'opus-5'); // untouched key still fills to its default

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.deepEqual(onDisk, result);
});

test('write with an empty candidate resolves to every knob\'s documented schema default, including the locked floor_lock default', () => {
  const dir = makeTmpDir();
  const result = write(dir, {});
  assert.deepEqual(result, {
    facilitator: 'opus-5',
    research_width: 3,
    planning: 'standard',
    reviews: 'floor',
    checkpoints: 'milestone_pauses',
    narration: 'full_cast',
    budget: { claude_ceiling_usd: null, codex_ceiling_usd: null, budget_report: false },
    telemetry_consent: false,
    blocking_preference: 'auto_remedy',
    plan_review: 'auto_proceed',
    floor_lock: true,
  });
});

// --- write: floor_lock is not hand-unlockable (operator ruling 2026-07-28
// [seq 48]) — the interview is the sole caller entitled to pass
// {source: 'interview'}; every other caller, including an omitted opts,
// gets the fail-closed 'hand-edit' default ---

test('write clamps a candidate\'s floor_lock: false back to true when opts is omitted (hand-edit)', () => {
  const dir = makeTmpDir();
  const result = write(dir, { floor_lock: false });
  assert.equal(result.floor_lock, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'override_verification_floor'), false);
});

test('write honors floor_lock: false when called with {source: "interview"}, deploying override_verification_floor at its own default', () => {
  const dir = makeTmpDir();
  const result = write(dir, { floor_lock: false }, { source: 'interview' });
  assert.equal(result.floor_lock, false);
  assert.equal(result.override_verification_floor, false);
});

test('write strips a candidate\'s override_verification_floor while floor_lock is locked, even with {source: "interview"} (the source marker only unlocks floor_lock itself)', () => {
  const dir = makeTmpDir();
  const result = write(dir, { override_verification_floor: true }, { source: 'interview' });
  assert.equal(result.floor_lock, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'override_verification_floor'), false);
});

test('write rejects a non-object candidate (array) instead of silently defaulting', () => {
  const dir = makeTmpDir();
  assert.throws(() => write(dir, ['not', 'an', 'object']), TypeError);
  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false);
});

test('write rejects null/undefined candidates', () => {
  const dir = makeTmpDir();
  assert.throws(() => write(dir, null), TypeError);
  assert.throws(() => write(dir), TypeError);
});

test('write throws TypeError for an empty treeRoot', () => {
  assert.throws(() => write('', {}), TypeError);
});

// --- read: reports what is actually on disk, never re-clamped ---

test('read returns {} when settings.json does not exist yet (scaffold genesis)', () => {
  const dir = makeTmpDir();
  assert.deepEqual(read(dir), {});
});

test('read returns exactly what write() last wrote', () => {
  const dir = makeTmpDir();
  write(dir, { reviews: 'x3' });
  assert.equal(read(dir).reviews, 'x3');
});

test('read throws TypeError for an empty treeRoot', () => {
  assert.throws(() => read(''), TypeError);
});

// --- CLI ---

test('CLI: write clamps and prints the resolved doc', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'write', dir, JSON.stringify({ budget: { claude_ceiling_usd: -50 } })],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.budget.claude_ceiling_usd, 0); // clamped up to the 0 floor
});

test('CLI: read prints the current settings.json doc', () => {
  const dir = makeTmpDir();
  write(dir, { facilitator: 'fable-5' });
  const proc = spawnSync(process.execPath, [CLI_PATH, 'read', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(JSON.parse(proc.stdout).facilitator, 'fable-5');
});

test('CLI: write exits 1 with a settings.js-prefixed error on invalid JSON, writing nothing', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write', dir, '{ not valid'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^settings\.js: /);
  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false);
});

test('CLI: write exits 1 when the json argument is missing entirely', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^settings\.js: /);
});

// --- CLI: --source interview (product/onboarding/flow.md's pinned
// invocation) is the only way to unlock floor_lock ---

test('CLI: write without --source clamps floor_lock: false back to true', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'write', dir, JSON.stringify({ floor_lock: false })],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(JSON.parse(proc.stdout).floor_lock, true);
});

test('CLI: write --source interview honors floor_lock: false', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'write', dir, JSON.stringify({ floor_lock: false }), '--source', 'interview'],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(JSON.parse(proc.stdout).floor_lock, false);
});

test('CLI: --source is scanned out of the argument list regardless of position relative to the JSON argument', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'write', dir, '--source', 'interview', JSON.stringify({ floor_lock: false })],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(JSON.parse(proc.stdout).floor_lock, false);
});
