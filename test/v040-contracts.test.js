'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function readAsset(relativePath) {
  return fs.readFileSync(path.join(ASSETS_DIR, relativePath), 'utf8');
}

describe('v0.4.0 contracts', () => {

  it('kiln-plan-validator agent exists with required structure', () => {
    const validator = readAsset('agents/kiln-plan-validator.md');

    // Must have YAML frontmatter with correct fields
    assert.ok(validator.includes('name: Athena'), 'Must have name: Athena');
    assert.ok(validator.includes('alias: kiln-plan-validator'), 'Must have alias');
    assert.ok(validator.includes('model: sonnet'), 'Must use sonnet model');

    // Must have required XML sections
    for (const tag of ['<role>', '<rules>', '<inputs>', '<workflow>']) {
      assert.ok(validator.includes(tag), `Must contain ${tag}`);
    }

    // Must validate 7 dimensions
    const dimensions = [
      'requirement coverage', 'atomization', 'file action',
      'dependency', 'phase sizing', 'scope', 'acceptance criteria'
    ];
    for (const dim of dimensions) {
      assert.ok(
        validator.toLowerCase().includes(dim.toLowerCase()),
        `Must reference dimension: ${dim}`
      );
    }
  });

  it('names.json includes Athena entry for kiln-plan-validator', () => {
    const names = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'names.json'), 'utf8'));
    const entry = names['kiln-plan-validator'];

    assert.ok(entry, 'names.json must have kiln-plan-validator entry');
    assert.strictEqual(entry.alias, 'Athena');
    assert.strictEqual(entry.role, 'plan validator');
    assert.ok(Array.isArray(entry.quotes), 'Must have quotes array');
    assert.ok(entry.quotes.length >= 3, 'Must have at least 3 quotes');
  });

  it('protocol.md includes Athena in agent roster', () => {
    const protocol = readAsset('protocol.md');

    assert.ok(protocol.includes('Athena'), 'Protocol must mention Athena');
    assert.ok(protocol.includes('kiln-plan-validator'), 'Protocol must mention kiln-plan-validator');
    assert.ok(
      protocol.includes('plan validation') || protocol.includes('Plan validation'),
      'Protocol must describe plan validation role'
    );
  });

  it('protocol rule 15 requires plan validation before execution', () => {
    const protocol = readAsset('protocol.md');

    assert.ok(
      protocol.includes('Plans must pass validation') || protocol.includes('plan validation'),
      'Protocol must have rule about plan validation gate'
    );
  });

  it('start.md includes plan validation step after synthesis', () => {
    const start = readAsset('commands/kiln/start.md');

    assert.ok(
      start.includes('kiln-plan-validator') || start.includes('Athena'),
      'start.md must reference plan validator'
    );
    assert.ok(
      start.includes('plan_validation.md'),
      'start.md must reference plan validation report path'
    );
  });

  it('default-config.json exists and has valid structure', () => {
    const configPath = path.join(ASSETS_DIR, 'data', 'default-config.json');
    assert.ok(fs.existsSync(configPath), 'default-config.json must exist in data/');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(config.model_mode, 'Must have model_mode');
    assert.ok(config.preferences, 'Must have preferences');
    assert.ok(config.tooling, 'Must have tooling');
    assert.strictEqual(config.preferences.debate_mode, 2, 'Default debate_mode must be 2');
    assert.strictEqual(config.preferences.review_rounds_max, 3);
    assert.strictEqual(config.preferences.correction_cycles_max, 3);
    assert.strictEqual(config.preferences.codex_timeout, 600);
  });

  it('start.md references config.json creation', () => {
    const start = readAsset('commands/kiln/start.md');

    assert.ok(
      start.includes('config.json'),
      'start.md must reference config.json'
    );
  });

  it('kiln-core.md documents config schema', () => {
    const skill = readAsset('skills/kiln-core.md');

    assert.ok(
      skill.includes('## Config Schema') || skill.includes('config.json'),
      'kiln-core must document config schema'
    );
  });

  it('lore.json exists with valid structure', () => {
    const lorePath = path.join(ASSETS_DIR, 'data', 'lore.json');
    assert.ok(fs.existsSync(lorePath), 'lore.json must exist in data/');

    const lore = JSON.parse(fs.readFileSync(lorePath, 'utf8'));
    assert.ok(lore.transitions, 'Must have transitions object');

    const expectedKeys = [
      'ignition', 'brainstorm_start', 'brainstorm_complete',
      'planning_start', 'plan_approved', 'phase_start', 'phase_complete',
      'review_approved', 'review_rejected', 'validation_start',
      'validation_passed', 'validation_failed', 'correction_start',
      'project_complete', 'resume'
    ];

    for (const key of expectedKeys) {
      assert.ok(lore.transitions[key], `Must have transition: ${key}`);
      assert.ok(Array.isArray(lore.transitions[key].quotes), `${key} must have quotes array`);
      assert.ok(lore.transitions[key].quotes.length >= 3, `${key} must have >= 3 quotes`);

      for (const q of lore.transitions[key].quotes) {
        assert.ok(typeof q.text === 'string' && q.text.length > 0, `${key} quote must have text`);
        assert.ok(typeof q.source === 'string' && q.source.length > 0, `${key} quote must have source`);
      }
    }
  });

  it('start.md references lore display', () => {
    const start = readAsset('commands/kiln/start.md');

    assert.ok(
      start.includes('lore.json') || start.includes('lore'),
      'start.md must reference lore system'
    );
  });

  it('resume.md references lore display', () => {
    const resume = readAsset('commands/kiln/resume.md');

    assert.ok(
      resume.includes('lore.json') || resume.includes('lore'),
      'resume.md must reference lore system'
    );
  });

  it('status command exists with required structure', () => {
    const status = readAsset('commands/kiln/status.md');

    assert.ok(status.includes('kiln:status'), 'Must have kiln:status name');
    assert.ok(status.includes('MEMORY.md'), 'Must read MEMORY.md');
    assert.ok(status.includes('read-only') || status.includes('never modif'), 'Must be read-only');
  });

  it('tech-stack.md template exists with required sections', () => {
    const tsPath = path.join(ASSETS_DIR, 'templates', 'tech-stack.md');
    assert.ok(fs.existsSync(tsPath), 'templates/tech-stack.md must exist');

    const content = fs.readFileSync(tsPath, 'utf8');
    assert.ok(content.includes('# Tech Stack'), 'Must have Tech Stack heading');
    assert.ok(content.includes('## Languages'), 'Must have Languages section');
    assert.ok(content.includes('## Frameworks'), 'Must have Frameworks section');
    assert.ok(content.includes('## Libraries'), 'Must have Libraries section');
  });

  it('Sherlock reconciliation includes tech stack', () => {
    const researcher = readAsset('agents/kiln-researcher.md');

    assert.ok(
      researcher.includes('tech-stack.md') || researcher.includes('tech stack'),
      'Sherlock must reference tech stack in reconciliation'
    );
  });

  it('protocol.md mentions tech-stack.md in memory structure', () => {
    const protocol = readAsset('protocol.md');

    assert.ok(
      protocol.includes('tech-stack.md'),
      'Protocol must mention tech-stack.md'
    );
  });

  it('event enum has 27 types including v0.4.0 additions', () => {
    const skill = readAsset('skills/kiln-core.md');
    const enumLine = skill.split('\n').find((l) => /[Ee]vent type enum/i.test(l));
    assert.ok(enumLine, 'Skill must declare event type enum');

    const types = [];
    const regex = /`([a-z_]+)`/g;
    let match;
    while ((match = regex.exec(enumLine)) !== null) {
      types.push(match[1]);
    }

    assert.strictEqual(types.length, 27, `Expected 27 event types, got ${types.length}`);
    assert.ok(types.includes('plan_validate_start'), 'Must include plan_validate_start');
    assert.ok(types.includes('plan_validate_complete'), 'Must include plan_validate_complete');
  });

  it('config.json is in start.md gitignore', () => {
    const start = readAsset('commands/kiln/start.md');
    const gitignoreSection = start.substring(
      start.indexOf('.gitignore'),
      start.indexOf('Do not add extra entries')
    );
    assert.ok(
      gitignoreSection.includes('config.json'),
      'start.md gitignore must include config.json'
    );
  });

  it('start.md references tech-stack.md in template instantiation', () => {
    const start = readAsset('commands/kiln/start.md');

    assert.ok(
      start.includes('tech-stack.md'),
      'start.md must reference tech-stack.md in template list'
    );
  });

  it('resume.md reads tech-stack.md', () => {
    const resume = readAsset('commands/kiln/resume.md');

    assert.ok(
      resume.includes('tech-stack.md'),
      'resume.md must read tech-stack.md'
    );
  });
});
