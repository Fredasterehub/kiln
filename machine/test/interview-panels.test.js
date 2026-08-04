'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadProductSchema } = require('../src/settings.js');
const { buildPanel3, HEADER_MAX, MIN_OPTIONS, MAX_OPTIONS, MAX_QUESTIONS } = require('../src/interview-panels.js');

const SCHEMA_PATH = path.join(__dirname, '..', 'settings-schema.json');

function loadKnobs() {
  return loadProductSchema(SCHEMA_PATH).knobs;
}

function assertPanelShape(panel, expectedQuestionCount) {
  assert.equal(panel.questions.length, expectedQuestionCount);
  assert.ok(panel.questions.length <= MAX_QUESTIONS);
  for (const q of panel.questions) {
    assert.equal(typeof q.header, 'string');
    assert.ok(q.header.length > 0 && q.header.length <= HEADER_MAX, `header "${q.header}" must be 1-${HEADER_MAX} chars`);
    assert.equal(typeof q.question, 'string');
    assert.ok(q.question.length > 0);
    assert.ok(
      q.options.length >= MIN_OPTIONS && q.options.length <= MAX_OPTIONS,
      `question "${q.header}" has ${q.options.length} options, outside ${MIN_OPTIONS}-${MAX_OPTIONS}`
    );
    const defaults = q.options.filter((o) => o.isDefault === true);
    assert.equal(defaults.length, 1, `question "${q.header}" must have exactly one default`);
    const labels = q.options.map((o) => o.label);
    assert.equal(new Set(labels).size, labels.length, `question "${q.header}" has duplicate option labels`);
  }
}

test('buildPanel3 in full-cross-family mode produces exactly 1 question (checkpoints only), within the 2-4 option contract', () => {
  const knobs = loadKnobs();
  const panel = buildPanel3(knobs, 'full-cross-family');
  assertPanelShape(panel, 1);
  assert.deepEqual(
    panel.questions.map((q) => q.header),
    ['Checkpoints']
  );
});

test('buildPanel3 in degraded-claude-only mode also produces exactly 1 question (checkpoints only); mode no longer affects panel shape', () => {
  const knobs = loadKnobs();
  const panel = buildPanel3(knobs, 'degraded-claude-only');
  assertPanelShape(panel, 1);
  assert.deepEqual(
    panel.questions.map((q) => q.header),
    ['Checkpoints']
  );
});

test('the Checkpoints question mirrors machine/settings-schema.json\'s checkpoints enum in order, with plain-language labels and the schema default marked', () => {
  const knobs = loadKnobs();
  const panel = buildPanel3(knobs, 'full-cross-family');
  const checkpoints = panel.questions.find((q) => q.header === 'Checkpoints');
  assert.deepEqual(
    checkpoints.options.map((o) => o.value),
    knobs.checkpoints.enum
  );
  assert.deepEqual(
    checkpoints.options.map((o) => o.label),
    ['Milestone pauses', 'Autonomous']
  );
  assert.equal(checkpoints.options.find((o) => o.isDefault).value, knobs.checkpoints.default);
});

test('buildPanel3 throws for an unrecognized mode value', () => {
  const knobs = loadKnobs();
  assert.throws(() => buildPanel3(knobs, 'nonsense'), TypeError);
  assert.throws(() => buildPanel3(knobs, undefined), TypeError);
});
