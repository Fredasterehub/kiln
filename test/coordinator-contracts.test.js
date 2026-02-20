'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function readAsset(relativePath) {
  return fs.readFileSync(path.join(ASSETS_DIR, relativePath), 'utf8');
}

describe('planning coordinator contracts', () => {

  it('kiln-planning-coordinator agent exists with required structure', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    // YAML frontmatter
    assert.ok(coord.includes('name: Aristotle'), 'Must have name: Aristotle');
    assert.ok(coord.includes('alias: kiln-planning-coordinator'), 'Must have alias');
    assert.ok(coord.includes('model: opus'), 'Must use opus model');
    assert.ok(coord.includes('Task'), 'Must have Task tool (coordinator)');

    // Required XML sections
    for (const tag of ['<role>', '<rules>', '<inputs>', '<workflow>']) {
      assert.ok(coord.includes(tag), `Must contain ${tag}`);
    }
  });

  it('coordinator workflow includes all 7 pipeline steps', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    const steps = ['## Setup', '## Dual Plan', '## Debate', '## Synthesize', '## Validate', '## Operator Review', '## Finalize'];
    for (const step of steps) {
      assert.ok(coord.includes(step), `Must include workflow step: ${step}`);
    }
  });

  it('coordinator spawns all 5 worker agents', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    const workers = [
      'kiln-planner-claude', 'kiln-planner-codex',
      'kiln-debater', 'kiln-synthesizer', 'kiln-plan-validator'
    ];
    for (const worker of workers) {
      assert.ok(coord.includes(worker), `Must reference worker: ${worker}`);
    }
  });

  it('coordinator aliases match workers', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    const aliases = ['Confucius', 'Sun Tzu', 'Socrates', 'Plato', 'Athena'];
    for (const alias of aliases) {
      assert.ok(coord.includes(alias), `Must reference worker alias: ${alias}`);
    }
  });

  it('coordinator returns PLAN_APPROVED or PLAN_BLOCKED', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    assert.ok(coord.includes('PLAN_APPROVED'), 'Must return PLAN_APPROVED on success');
    assert.ok(coord.includes('PLAN_BLOCKED'), 'Must return PLAN_BLOCKED on failure');
  });

  it('coordinator handles operator review loop with all options', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    assert.ok(coord.includes('yes'), 'Must handle yes/approve');
    assert.ok(coord.includes('edit'), 'Must handle edit');
    assert.ok(coord.includes('show'), 'Must handle show');
    assert.ok(coord.includes('abort'), 'Must handle abort');
    assert.ok(coord.includes('revalidate'), 'Must handle revalidate');
  });

  it('coordinator updates planning_sub_stage', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    for (const sub of ['dual_plan', 'debate', 'synthesis']) {
      assert.ok(coord.includes(sub), `Must reference planning_sub_stage: ${sub}`);
    }
  });

  it('coordinator has validation retry loop', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    assert.ok(
      coord.includes('validation_attempt') || coord.includes('retry'),
      'Must have validation retry mechanism'
    );
    assert.ok(
      coord.includes('max 2 retries') || coord.includes('3 total'),
      'Must specify retry limit'
    );
  });

  it('coordinator maintains planning_state.md event log', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    assert.ok(
      coord.includes('planning_state.md'),
      'Must reference planning_state.md event log'
    );
    assert.ok(
      coord.includes('[plan_start]'),
      'Must emit plan_start event'
    );
    assert.ok(
      coord.includes('[plan_complete]'),
      'Must emit plan_complete event'
    );
    assert.ok(
      coord.includes('[plan_validate_start]'),
      'Must emit plan_validate_start event'
    );
    assert.ok(
      coord.includes('[plan_validate_complete]'),
      'Must emit plan_validate_complete event'
    );
  });

  it('coordinator context budget is documented', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    assert.ok(
      coord.includes('8,000') || coord.includes('8000'),
      'Coordinator must document 8,000 token context budget'
    );
  });

  it('coordinator does not display lore quotes', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    assert.ok(
      coord.includes('Do NOT display lore') || coord.includes('not display lore') || coord.includes('NOT display lore'),
      'Coordinator must explicitly state it does not display lore'
    );
  });

  it('coordinator uses file-first operator review', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    assert.ok(
      coord.includes('10-15 line summary') || (coord.includes('concise') && coord.includes('summary')),
      'Coordinator must present a summary, not the full plan'
    );
    assert.ok(
      coord.includes('show'),
      'Coordinator must support show command for full plan display'
    );
  });

  it('names.json includes Aristotle entry', () => {
    const names = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'names.json'), 'utf8'));
    const entry = names['kiln-planning-coordinator'];

    assert.ok(entry, 'names.json must have kiln-planning-coordinator entry');
    assert.strictEqual(entry.alias, 'Aristotle');
    assert.strictEqual(entry.role, 'planning coordinator');
    assert.ok(Array.isArray(entry.quotes), 'Must have quotes array');
    assert.ok(entry.quotes.length >= 5, 'Must have at least 5 quotes');
  });

  it('protocol.md includes Aristotle in agent roster', () => {
    const protocol = readAsset('protocol.md');

    assert.ok(protocol.includes('Aristotle'), 'Protocol must mention Aristotle');
    assert.ok(
      protocol.includes('kiln-planning-coordinator'),
      'Protocol must mention kiln-planning-coordinator'
    );
  });

  it('protocol rule 3 includes Aristotle in Task access list', () => {
    const protocol = readAsset('protocol.md');

    // Rule 3 should mention all three coordinators
    assert.ok(
      protocol.includes('kiln-planning-coordinator') &&
      protocol.includes('kiln-phase-executor') &&
      protocol.includes('kiln-mapper'),
      'Rule 3 must list all three coordinators with Task access'
    );
  });

  it('protocol agent count is 15', () => {
    const protocol = readAsset('protocol.md');

    assert.ok(
      protocol.includes('15 specialized agents'),
      'Protocol must state 15 specialized agents'
    );
  });

  it('start.md spawns Aristotle instead of individual planners', () => {
    const start = readAsset('commands/kiln/start.md');

    // Must reference coordinator
    assert.ok(
      start.includes('kiln-planning-coordinator') || start.includes('Aristotle'),
      'start.md must reference planning coordinator'
    );

    // Must parse PLAN_APPROVED/PLAN_BLOCKED
    assert.ok(
      start.includes('PLAN_APPROVED'),
      'start.md must handle PLAN_APPROVED return'
    );
    assert.ok(
      start.includes('PLAN_BLOCKED'),
      'start.md must handle PLAN_BLOCKED return'
    );
  });

  it('start.md Stage 2 section does not directly spawn individual planners', () => {
    const start = readAsset('commands/kiln/start.md');

    // Extract just the Stage 2 section
    const stage2Start = start.indexOf('## Stage 2');
    const stage3Start = start.indexOf('## Stage 3');
    if (stage2Start >= 0 && stage3Start >= 0) {
      const stage2 = start.substring(stage2Start, stage3Start);

      // Should NOT directly spawn Confucius, Sun Tzu, Socrates, Plato, or Athena
      // (those are now spawned by the coordinator)
      assert.ok(
        !stage2.includes('kiln-planner-claude') &&
        !stage2.includes('kiln-planner-codex') &&
        !stage2.includes('kiln-debater') &&
        !stage2.includes('kiln-synthesizer') &&
        !stage2.includes('kiln-plan-validator'),
        'Stage 2 in start.md should delegate to coordinator, not spawn workers directly'
      );
    }
  });

  it('resume.md planning case spawns Aristotle', () => {
    const resume = readAsset('commands/kiln/resume.md');

    assert.ok(
      resume.includes('kiln-planning-coordinator') || resume.includes('Aristotle'),
      'resume.md planning case must spawn planning coordinator'
    );
  });
});
