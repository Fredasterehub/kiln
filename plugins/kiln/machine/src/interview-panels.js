'use strict';

// Mechanically derives the AskUserQuestion panel shape for Panel 3 of the
// settings interview (product/onboarding/interview.md Step 3: Checkpoints +
// Budget) from machine/settings-schema.json's knobs, so the 4x4 input
// contract (ruled in the dev record: 1-4 questions
// per AskUserQuestion call, 2-4 supplied options per question, the
// automatic "Other" row is additional) is provable by a test rather than
// only by prose review (P3 Sol review finding 8 — the old design gave each
// ceiling question exactly one explicit option, "No ceiling", relying on
// the free-text "Other" row alone for every numeric value).

const HEADER_MAX = 12;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_QUESTIONS = 4;

const CHECKPOINTS_LABELS = Object.freeze({
  milestone_pauses: 'Milestone pauses',
  autonomous: 'Autonomous',
});

function assertHeader(header) {
  if (typeof header !== 'string' || header.length === 0 || header.length > HEADER_MAX) {
    throw new Error(`interview-panels: header "${header}" must be 1-${HEADER_MAX} characters`);
  }
}

function assertQuestionShape(q) {
  assertHeader(q.header);
  if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
    throw new Error(
      `interview-panels: question "${q.header}" has ${q.options.length} options, outside the ${MIN_OPTIONS}-${MAX_OPTIONS} contract`
    );
  }
  const defaults = q.options.filter((o) => o.isDefault === true);
  if (defaults.length !== 1) {
    throw new Error(`interview-panels: question "${q.header}" must have exactly one default option`);
  }
}

function buildCheckpointsQuestion(knobRule) {
  const q = {
    header: 'Checkpoints',
    question: knobRule.description,
    options: knobRule.enum.map((value) => ({
      label: CHECKPOINTS_LABELS[value] || value,
      value,
      isDefault: value === knobRule.default,
    })),
    allowOther: false,
  };
  assertQuestionShape(q);
  return q;
}

// buildPanel3(knobs, mode) -> { questions } — the exact shape of
// interview.md Step 3's single AskUserQuestion call. Checkpoints only:
// the budget family (ceilings + cost report) was removed from the operator
// surface because nothing downstream consumes it — no host primitive exposes
// session cost, so offering the knobs promised a readout that never renders.
// The schema keys stay as internal reserved defaults until the metered
// rewire lands. mode is state.json.preflight.mode, kept for call parity.
function buildPanel3(knobs, mode) {
  if (mode !== 'full-cross-family' && mode !== 'degraded-claude-only') {
    throw new TypeError('interview-panels: mode must be "full-cross-family" or "degraded-claude-only"');
  }

  const questions = [
    buildCheckpointsQuestion(knobs.checkpoints),
  ];

  if (questions.length > MAX_QUESTIONS) {
    throw new Error(
      `interview-panels: Panel 3 has ${questions.length} questions, exceeding the ${MAX_QUESTIONS}-question contract`
    );
  }
  return { questions };
}

module.exports = {
  buildPanel3,
  HEADER_MAX,
  MIN_OPTIONS,
  MAX_OPTIONS,
  MAX_QUESTIONS,
};
