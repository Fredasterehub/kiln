'use strict';

// A minimal, semantically valid architecture five-artifact set — the
// content approveGate()'s semantic sealing (P6 Sol review BLOCKING #1/#3)
// actually accepts: criteria-register.json passes validateCriteriaRegister,
// milestones.json passes validateMilestones' cross-check against it,
// artifact-map.json is an object with a non-empty "artifacts" array, and
// protocol-record.md is non-empty and names one of vision §8's three
// planning protocols. Shared across the plan-gate/check-honesty/scaffold/
// phases test suites so every test that needs approveGate to actually seal
// starts from the same known-valid fixture rather than each file hand-
// rolling (and risking drifting) its own.

const fs = require('node:fs');
const path = require('node:path');

function validCriteriaRegister() {
  return {
    schema_version: 1,
    criteria: [{ id: 'ACR-1', text: 'Example criterion.', source_ref: 'vision.md#5', journey_id: 'J1' }],
  };
}

function validMilestones() {
  return {
    schema_version: 1,
    milestones: [
      {
        id: 'M1',
        order: 1,
        title: 'Example milestone',
        designer_family: 'gpt',
        slice_goal: 'Ship the example.',
        chunk_count_estimate: 1,
        criteria_ids: ['ACR-1'],
      },
    ],
  };
}

function validArtifactMap() {
  return {
    artifacts: [
      {
        path: 'milestones/index.json',
        format: 'json',
        writer: 'implementation',
        created_by_phase: 'implementation',
        restart_role: 'milestone progress index',
      },
    ],
  };
}

const VALID_PROTOCOL_RECORD_MD =
  '# Protocol record\n\nProtocol: standard. Draft pass complete; coverage-checker reported zero findings.\n';

const VALID_PLAN_MD = '# Plan\n\nExample plan body.\n';

// Writes the five canonical content artifacts (never manifest.json or
// gate.json — those are approveGate's own output) into architectureDir,
// creating it if needed.
function writeValidContentArtifacts(architectureDir) {
  fs.mkdirSync(architectureDir, { recursive: true });
  fs.writeFileSync(path.join(architectureDir, 'plan.md'), VALID_PLAN_MD);
  fs.writeFileSync(path.join(architectureDir, 'criteria-register.json'), JSON.stringify(validCriteriaRegister(), null, 2));
  fs.writeFileSync(path.join(architectureDir, 'milestones.json'), JSON.stringify(validMilestones(), null, 2));
  fs.writeFileSync(path.join(architectureDir, 'artifact-map.json'), JSON.stringify(validArtifactMap(), null, 2));
  fs.writeFileSync(path.join(architectureDir, 'protocol-record.md'), VALID_PROTOCOL_RECORD_MD);
}

module.exports = {
  writeValidContentArtifacts,
  validCriteriaRegister,
  validMilestones,
  validArtifactMap,
  VALID_PROTOCOL_RECORD_MD,
  VALID_PLAN_MD,
};
