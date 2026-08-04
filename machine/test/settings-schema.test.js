'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { applySchema, loadProductSchema } = require('../src/settings.js');

const SCHEMA_PATH = path.join(__dirname, '..', 'settings-schema.json');

function loadKnobs() {
  return loadProductSchema(SCHEMA_PATH);
}

// --- the schema file loads and is applySchema-shaped ---

test('loadProductSchema loads machine/settings-schema.json and exposes a .knobs object usable by applySchema', () => {
  const doc = loadKnobs();
  assert.equal(doc.schema_version, 1);
  assert.equal(typeof doc.knobs, 'object');
  assert.equal(typeof doc.presets, 'object');
  assert.doesNotThrow(() => applySchema({}, doc.knobs));
});

// --- defaults match vision §9 / settings-menu-design.md ---

test('applying the product schema to an empty input yields the documented defaults for all ten settings plus floor_lock (locked by default); override_verification_floor is not deployed at all while locked', () => {
  const { knobs } = loadKnobs();
  const { settings } = applySchema({}, knobs);
  assert.deepEqual(settings, {
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
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'override_verification_floor'), false);
});

// --- floor-lock doctrine (settings-menu-design.md §4 point 4 layer (c),
// operator ruling 2026-07-28 [seq 48]) ---

test('a candidate carrying override_verification_floor while floor_lock is locked (the default) is stripped and reported with the exact operator-approved message, regardless of the value it carried', () => {
  const { knobs } = loadKnobs();
  for (const attempted of [true, false]) {
    const { settings, clamps } = applySchema({ override_verification_floor: attempted }, knobs);
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'override_verification_floor'), false);
    assert.deepEqual(
      clamps.find((c) => c.key === 'override_verification_floor'),
      {
        key: 'override_verification_floor',
        from: attempted,
        to: null,
        rule: 'locked',
        message: 'floor is locked in this install; override_verification_floor is inert',
      }
    );
  }
});

test('an on-disk doc read through applySchema (loadSettings\'s own path) is stripped identically to a write() candidate — same clamp channel, no second validation path', () => {
  const { knobs } = loadKnobs();
  const onDisk = { floor_lock: true, override_verification_floor: true };
  const { settings, clamps } = applySchema(onDisk, knobs);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'override_verification_floor'), false);
  assert.equal(
    clamps.find((c) => c.key === 'override_verification_floor').message,
    'floor is locked in this install; override_verification_floor is inert'
  );
});

test('unlocking with the interview\'s own provenance deploys override_verification_floor at its schema default (false), no warning', () => {
  const { knobs } = loadKnobs();
  const { settings, clamps } = applySchema(
    { floor_lock: false, override_verification_floor: false },
    knobs,
    { source: 'interview' }
  );
  assert.equal(settings.floor_lock, false);
  assert.equal(settings.override_verification_floor, false);
  assert.deepEqual(
    clamps.filter((c) => c.key === 'floor_lock' || c.key === 'override_verification_floor'),
    []
  );
});

test('unlocked + override_verification_floor true yields a warning line present exactly once, value passes through unchanged', () => {
  const { knobs } = loadKnobs();
  const { settings, clamps } = applySchema(
    { floor_lock: false, override_verification_floor: true },
    knobs,
    { source: 'interview' }
  );
  assert.equal(settings.override_verification_floor, true);
  const warnings = clamps.filter((c) => c.rule === 'warn');
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0], {
    key: 'override_verification_floor',
    from: true,
    to: true,
    rule: 'warn',
    message: 'override_verification_floor is active in this install — the verification floor clamp is disabled for this run.',
  });
});

test('unlocked + override_verification_floor false yields no warning', () => {
  const { knobs } = loadKnobs();
  const { clamps } = applySchema({ floor_lock: false, override_verification_floor: false }, knobs, {
    source: 'interview',
  });
  assert.deepEqual(
    clamps.filter((c) => c.key === 'override_verification_floor'),
    []
  );
});

test('a hand-edit flipping floor_lock to false (no interview provenance) is clamped back to true with a message, and override_verification_floor stays undeployed as a result', () => {
  const { knobs } = loadKnobs();
  const { settings, clamps } = applySchema({ floor_lock: false, override_verification_floor: true }, knobs);
  assert.equal(settings.floor_lock, true);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'override_verification_floor'), false);
  assert.deepEqual(
    clamps.find((c) => c.key === 'floor_lock'),
    {
      key: 'floor_lock',
      from: false,
      to: true,
      rule: 'source-locked',
      message: 'floor_lock cannot be hand-unlocked; only the settings interview can set it to false, and the interview asks once — a completed install is not re-asked, and a hand-edit of this key is clamped back to true.',
    }
  );
  assert.deepEqual(
    clamps.find((c) => c.key === 'override_verification_floor'),
    {
      key: 'override_verification_floor',
      from: true,
      to: null,
      rule: 'locked',
      message: 'floor is locked in this install; override_verification_floor is inert',
    }
  );
});

test('an explicit floor_lock: true from a hand-edit is never clamped — only an actual unlock attempt is source-gated', () => {
  const { knobs } = loadKnobs();
  const { settings, clamps } = applySchema({ floor_lock: true }, knobs);
  assert.equal(settings.floor_lock, true);
  assert.deepEqual(
    clamps.filter((c) => c.key === 'floor_lock'),
    []
  );
});

test('every named preset leaves floor_lock at the schema default (true) and override_verification_floor undeployed — no preset touches the floor lock', () => {
  const { knobs, presets } = loadKnobs();
  for (const name of Object.keys(presets)) {
    const { settings } = applySchema(presets[name], knobs);
    assert.equal(settings.floor_lock, true, `preset "${name}"`);
    assert.equal(
      Object.prototype.hasOwnProperty.call(settings, 'override_verification_floor'),
      false,
      `preset "${name}"`
    );
  }
});

// --- every knob carries description + cost_note ---

test('every top-level knob (and every budget sub-property) carries a description and a cost_note string', () => {
  const { knobs } = loadKnobs();
  for (const [key, rule] of Object.entries(knobs)) {
    assert.equal(typeof rule.description, 'string', `${key}.description`);
    assert.ok(rule.description.length > 0, `${key}.description non-empty`);
    assert.equal(typeof rule.cost_note, 'string', `${key}.cost_note`);
    assert.ok(rule.cost_note.length > 0, `${key}.cost_note non-empty`);
  }
  for (const [key, rule] of Object.entries(knobs.budget.properties)) {
    assert.equal(typeof rule.description, 'string', `budget.${key}.description`);
    assert.equal(typeof rule.cost_note, 'string', `budget.${key}.cost_note`);
  }
});

// --- cost_notes quote no dollar anchor at all, and cite no dev-only doc ---

test('no cost_note quotes a dollar figure, carries a leftover placeholder token, or cites a dev-only design doc', () => {
  const { knobs } = loadKnobs();
  const allRules = [...Object.values(knobs), ...Object.values(knobs.budget.properties)];
  for (const rule of allRules) {
    assert.equal(
      /\$\s*\d/.test(rule.cost_note),
      false,
      `cost_note "${rule.cost_note}" must not quote a dollar figure`
    );
    assert.equal(
      rule.cost_note.includes('$PLACEHOLDER'),
      false,
      `cost_note "${rule.cost_note}" must not carry a placeholder token`
    );
    assert.equal(
      /settings-menu-design\.md/.test(rule.cost_note),
      false,
      `cost_note "${rule.cost_note}" must not cite a dev-only design doc`
    );
  }
});

// --- the four split-rendered cost_notes stay one clause per enum value (product/onboarding/interview.md's allowlist) ---

test('facilitator, research_width, planning and reviews each carry exactly one "; "-separated cost clause per enum value', () => {
  const { knobs } = loadKnobs();
  for (const key of ['facilitator', 'research_width', 'planning', 'reviews']) {
    const rule = knobs[key];
    assert.equal(
      rule.cost_note.split('; ').length,
      rule.enum.length,
      `${key}.cost_note clause count must match enum length`
    );
  }
});

// --- reviews: down-clamp below floor is structurally impossible ---

test('reviews can never resolve to anything below the floor, no matter the garbage input thrown at it', () => {
  const { knobs } = loadKnobs();
  const ordinal = { floor: 1, x3: 3, x5: 5 };
  const garbageInputs = ['none', 'off', 0, -1, -99, null, '', 'FLOOR', 'x1', 'x0', {}, [], NaN, Infinity];
  for (const garbage of garbageInputs) {
    const { settings } = applySchema({ reviews: garbage }, knobs);
    assert.ok(
      Object.prototype.hasOwnProperty.call(ordinal, settings.reviews),
      `garbage input ${JSON.stringify(garbage)} produced non-enum reviews value ${JSON.stringify(settings.reviews)}`
    );
    assert.ok(
      ordinal[settings.reviews] >= ordinal.floor,
      `reviews value ${settings.reviews} resolved below the floor for garbage input ${JSON.stringify(garbage)}`
    );
  }
});

test('reviews at each valid step (floor/x3/x5) passes through untouched', () => {
  const { knobs } = loadKnobs();
  for (const value of ['floor', 'x3', 'x5']) {
    const { settings, clamps } = applySchema({ reviews: value }, knobs);
    assert.equal(settings.reviews, value);
    assert.deepEqual(
      clamps.filter((c) => c.key === 'reviews'),
      []
    );
  }
});

// --- narration: theater depth is operator taste, never a rigor dial ---

test('narration is a knob of the product schema carrying exactly the two documented values, defaulting to the full cast', () => {
  const { knobs } = loadKnobs();
  assert.deepEqual(knobs.narration.enum, ['full_cast', 'plain_lines']);
  assert.equal(knobs.narration.default, 'full_cast');
});

test('narration at either valid value passes through untouched', () => {
  const { knobs } = loadKnobs();
  for (const value of ['full_cast', 'plain_lines']) {
    const { settings, clamps } = applySchema({ narration: value }, knobs);
    assert.equal(settings.narration, value);
    assert.deepEqual(
      clamps.filter((c) => c.key === 'narration'),
      []
    );
  }
});

test('an unknown narration value is refused exactly the way its enum neighbours are — clamped back to the default and reported', () => {
  const { knobs } = loadKnobs();
  for (const garbage of ['theatrical', 'off', 'FULL_CAST', 0, null, '', {}, []]) {
    const { settings, clamps } = applySchema({ narration: garbage }, knobs);
    assert.equal(settings.narration, 'full_cast', `garbage input ${JSON.stringify(garbage)}`);
    assert.deepEqual(
      clamps.find((c) => c.key === 'narration'),
      { key: 'narration', from: garbage, to: 'full_cast', rule: 'enum' }
    );
  }
});

test('narration is not floor-relevant: it carries no lock machinery, and neither value moves the verification floor or the floor lock', () => {
  const { knobs } = loadKnobs();
  assert.equal(Object.prototype.hasOwnProperty.call(knobs.narration, 'interview_only'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(knobs.narration, 'locked_by'), false);
  for (const value of ['full_cast', 'plain_lines']) {
    const { settings } = applySchema({ narration: value, reviews: 'floor' }, knobs);
    assert.equal(settings.reviews, 'floor');
    assert.equal(settings.floor_lock, true);
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'override_verification_floor'), false);
  }
});

test('every named preset leaves narration at the full cast — theater depth is operator taste, so no preset turns it down', () => {
  const { knobs, presets } = loadKnobs();
  for (const name of Object.keys(presets)) {
    const { settings } = applySchema(presets[name], knobs);
    assert.equal(settings.narration, 'full_cast', `preset "${name}"`);
  }
});

// --- budget: nested object clamping ---

test('budget.claude_ceiling_usd accepts explicit null (no ceiling) without reporting a clamp', () => {
  const { knobs } = loadKnobs();
  const { settings, clamps } = applySchema({ budget: { claude_ceiling_usd: null } }, knobs);
  assert.equal(settings.budget.claude_ceiling_usd, null);
  assert.deepEqual(
    clamps.filter((c) => c.key === 'budget.claude_ceiling_usd'),
    []
  );
});

test('budget.claude_ceiling_usd accepts a positive number untouched', () => {
  const { knobs } = loadKnobs();
  const { settings } = applySchema({ budget: { claude_ceiling_usd: 75 } }, knobs);
  assert.equal(settings.budget.claude_ceiling_usd, 75);
});

test('budget.claude_ceiling_usd clamps a negative number up to the 0 floor', () => {
  const { knobs } = loadKnobs();
  const { settings, clamps } = applySchema({ budget: { claude_ceiling_usd: -30 } }, knobs);
  assert.equal(settings.budget.claude_ceiling_usd, 0);
  assert.deepEqual(
    clamps.find((c) => c.key === 'budget.claude_ceiling_usd'),
    { key: 'budget.claude_ceiling_usd', from: -30, to: 0, rule: 'floor' }
  );
});

test('budget.claude_ceiling_usd rejects a wrong-typed value and resets to null', () => {
  const { knobs } = loadKnobs();
  const { settings, clamps } = applySchema({ budget: { claude_ceiling_usd: 'lots' } }, knobs);
  assert.equal(settings.budget.claude_ceiling_usd, null);
  assert.deepEqual(
    clamps.find((c) => c.key === 'budget.claude_ceiling_usd'),
    { key: 'budget.claude_ceiling_usd', from: 'lots', to: null, rule: 'invalid-type' }
  );
});

test('a missing budget key fills in the full nested default object', () => {
  const { knobs } = loadKnobs();
  const { settings } = applySchema({}, knobs);
  assert.deepEqual(settings.budget, { claude_ceiling_usd: null, codex_ceiling_usd: null, budget_report: false });
});

test('a partially-specified budget object fills only the missing sub-keys with their defaults', () => {
  const { knobs } = loadKnobs();
  const { settings } = applySchema({ budget: { budget_report: true } }, knobs);
  assert.deepEqual(settings.budget, { claude_ceiling_usd: null, codex_ceiling_usd: null, budget_report: true });
});

test('a non-object budget value is rejected and reset to the full nested default', () => {
  const { knobs } = loadKnobs();
  const { settings, clamps } = applySchema({ budget: 'lots of money' }, knobs);
  assert.deepEqual(settings.budget, { claude_ceiling_usd: null, codex_ceiling_usd: null, budget_report: false });
  assert.deepEqual(
    clamps.find((c) => c.key === 'budget'),
    { key: 'budget', from: 'lots of money', to: settings.budget, rule: 'invalid-type' }
  );
});

// --- presets: balanced is exactly the defaults; others override only what they name ---

test('preset "balanced" leaves every non-budget knob at schema defaults but sets the binding-table ~$75 split ceiling (settings-menu-design.md §3)', () => {
  const { knobs, presets } = loadKnobs();
  const { settings } = applySchema(presets.balanced, knobs);
  const { settings: defaults } = applySchema({}, knobs);
  const { budget, ...nonBudget } = settings;
  const { budget: defaultBudget, ...defaultNonBudget } = defaults;
  assert.deepEqual(nonBudget, defaultNonBudget);
  assert.deepEqual(settings.budget, { claude_ceiling_usd: 75, codex_ceiling_usd: 75, budget_report: false });
});

test('preset "budget_solo" overrides research_width to 2 and sets the binding-table ~$30 split ceiling (settings-menu-design.md §3)', () => {
  const { knobs, presets } = loadKnobs();
  const { settings } = applySchema(presets.budget_solo, knobs);
  assert.equal(settings.facilitator, 'opus-5');
  assert.equal(settings.research_width, 2);
  assert.equal(settings.planning, 'standard');
  assert.equal(settings.reviews, 'floor');
  assert.equal(settings.checkpoints, 'milestone_pauses');
  assert.deepEqual(settings.budget, { claude_ceiling_usd: 30, codex_ceiling_usd: 30, budget_report: false });
});

test('preset "max_rigor" overrides facilitator/research/planning/reviews/checkpoints, never drops reviews below the floor, stays at no ceiling, and opts into the budget report (the no-ceiling-but-curious case)', () => {
  const { knobs, presets } = loadKnobs();
  const { settings } = applySchema(presets.max_rigor, knobs);
  assert.equal(settings.facilitator, 'fable-5');
  assert.equal(settings.research_width, 5);
  assert.equal(settings.planning, 'maximal_confrontation');
  assert.equal(settings.reviews, 'x5');
  assert.equal(settings.checkpoints, 'autonomous');
  assert.deepEqual(settings.budget, { claude_ceiling_usd: null, codex_ceiling_usd: null, budget_report: true });
});

test('every named preset (balanced, budget_solo) sets an equal split between claude_ceiling_usd and codex_ceiling_usd — no per-family evidence exists to justify an asymmetric split', () => {
  const { knobs, presets } = loadKnobs();
  for (const name of ['balanced', 'budget_solo']) {
    const { settings } = applySchema(presets[name], knobs);
    assert.equal(settings.budget.claude_ceiling_usd, settings.budget.codex_ceiling_usd, `preset "${name}"`);
  }
});

test('preset "custom" applies as an empty override, deferring entirely to the interview answers', () => {
  const { knobs, presets } = loadKnobs();
  assert.deepEqual(presets.custom, {});
  const { settings } = applySchema({ facilitator: 'fable-5', ...presets.custom }, knobs);
  assert.equal(settings.facilitator, 'fable-5');
});

test('every preset name referenced by the design is present in the presets map', () => {
  const { presets } = loadKnobs();
  assert.deepEqual(Object.keys(presets).sort(), ['balanced', 'budget_solo', 'custom', 'max_rigor']);
});

// --- loadProductSchema error cases ---

test('loadProductSchema throws when the file does not exist', () => {
  assert.throws(() => loadProductSchema(path.join(__dirname, 'nope-settings-schema.json')));
});
