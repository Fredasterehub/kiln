'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function readAsset(relativePath) {
  return fs.readFileSync(path.join(ASSETS_DIR, relativePath), 'utf8');
}

describe('v0.8.0 — native teams', () => {

  it('start.md has no tmux/TMUX_LAYOUT/AGENT_PANE/KILN_PANE/davinci_complete refs', () => {
    const start = readAsset('commands/kiln/start.md');
    const forbidden = ['tmux', 'TMUX_LAYOUT', 'AGENT_PANE', 'KILN_PANE', 'davinci_complete'];

    for (const term of forbidden) {
      assert.ok(
        !start.includes(term),
        `start.md must not reference "${term}"`
      );
    }
  });

  it('resume.md has no tmux/TMUX_LAYOUT/AGENT_PANE/KILN_PANE refs', () => {
    const resume = readAsset('commands/kiln/resume.md');
    const forbidden = ['tmux', 'TMUX_LAYOUT', 'AGENT_PANE', 'KILN_PANE'];

    for (const term of forbidden) {
      assert.ok(
        !resume.includes(term),
        `resume.md must not reference "${term}"`
      );
    }
  });

  it('brainstormer has no tmux/davinci_complete/brainstorm_context refs', () => {
    const brainstormer = readAsset('agents/kiln-brainstormer.md');
    const forbidden = ['tmux', 'davinci_complete', 'brainstorm_context'];

    for (const term of forbidden) {
      assert.ok(
        !brainstormer.includes(term),
        `kiln-brainstormer.md must not reference "${term}"`
      );
    }
  });

  it('start.md references kiln-session team creation', () => {
    const start = readAsset('commands/kiln/start.md');

    assert.ok(
      start.includes('TeamCreate("kiln-session")'),
      'start.md must create kiln-session team'
    );
  });

  it('resume.md references kiln-session team recovery', () => {
    const resume = readAsset('commands/kiln/resume.md');

    assert.ok(
      resume.includes('kiln-session'),
      'resume.md must reference kiln-session team'
    );
    assert.ok(
      resume.includes('TeamCreate("kiln-session")'),
      'resume.md must have TeamCreate fallback for kiln-session'
    );
  });

  it('all top-level agent spawns in start.md include team_name', () => {
    const start = readAsset('commands/kiln/start.md');

    // Check that team_name appears near each agent spawn
    const agents = ['Da Vinci', 'Aristotle', 'Maestro', 'Argus'];
    for (const agent of agents) {
      const idx = start.indexOf(`"${agent}"`);
      assert.ok(idx >= 0, `start.md must spawn ${agent}`);
      // Look for team_name within 500 chars after the agent name
      const nearby = start.substring(idx, idx + 500);
      assert.ok(
        nearby.includes('team_name') && nearby.includes('kiln-session'),
        `${agent} spawn in start.md must include team_name: "kiln-session"`
      );
    }
  });

  it('planning coordinator has aristotle-planning sub-team + TeamDelete', () => {
    const coord = readAsset('agents/kiln-planning-coordinator.md');

    assert.ok(
      coord.includes('TeamCreate("aristotle-planning")'),
      'Planning coordinator must create aristotle-planning sub-team'
    );
    assert.ok(
      coord.includes('TeamDelete("aristotle-planning")'),
      'Planning coordinator must delete aristotle-planning sub-team'
    );
    assert.ok(
      coord.includes('team_name: "aristotle-planning"'),
      'Planning coordinator must pass team_name to worker spawns'
    );
  });

  it('phase executor has maestro-phase sub-team + TeamDelete', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');

    assert.ok(
      executor.includes('TeamCreate("maestro-phase-'),
      'Phase executor must create maestro-phase-<N> sub-team'
    );
    assert.ok(
      executor.includes('TeamDelete("maestro-phase-'),
      'Phase executor must delete maestro-phase-<N> sub-team'
    );
    assert.ok(
      executor.includes('team_name: "maestro-phase-'),
      'Phase executor must pass team_name to worker spawns'
    );
  });

  it('mapper has mnemosyne-mapping sub-team + TeamDelete', () => {
    const mapper = readAsset('agents/kiln-mapper.md');

    assert.ok(
      mapper.includes('TeamCreate("mnemosyne-mapping")'),
      'Mapper must create mnemosyne-mapping sub-team'
    );
    assert.ok(
      mapper.includes('TeamDelete("mnemosyne-mapping")'),
      'Mapper must delete mnemosyne-mapping sub-team'
    );
    assert.ok(
      mapper.includes('team_name: "mnemosyne-mapping"'),
      'Mapper must pass team_name to Muse spawns'
    );
  });

  it('protocol mentions team management in rule 3', () => {
    const protocol = readAsset('protocol.md');

    assert.ok(
      protocol.includes('TeamCreate') && protocol.includes('TeamDelete'),
      'Protocol rule 3 must mention TeamCreate/TeamDelete'
    );
  });

  it('protocol has kiln-session reference in rule 16', () => {
    const protocol = readAsset('protocol.md');

    assert.ok(
      protocol.includes('kiln-session'),
      'Protocol must reference kiln-session team'
    );
    assert.ok(
      protocol.includes('16.'),
      'Protocol must have rule 16'
    );
  });

  it('kiln-core.md has Team Pattern section with all team names', () => {
    const skill = readAsset('skills/kiln-core.md');

    assert.ok(
      skill.includes('## Team Pattern'),
      'kiln-core.md must have Team Pattern section'
    );
    assert.ok(
      skill.includes('kiln-session'),
      'kiln-core.md Team Pattern must document kiln-session'
    );
    assert.ok(
      skill.includes('aristotle-planning'),
      'kiln-core.md Team Pattern must document aristotle-planning'
    );
    assert.ok(
      skill.includes('maestro-phase-'),
      'kiln-core.md Team Pattern must document maestro-phase-<N>'
    );
    assert.ok(
      skill.includes('mnemosyne-mapping'),
      'kiln-core.md Team Pattern must document mnemosyne-mapping'
    );
  });

  it('kiln-core.md has no tmux artifacts in directory tree', () => {
    const skill = readAsset('skills/kiln-core.md');

    assert.ok(
      !skill.includes('brainstorm_context.md'),
      'kiln-core.md must not reference brainstorm_context.md'
    );
    assert.ok(
      !skill.includes('davinci_complete'),
      'kiln-core.md must not reference davinci_complete'
    );
  });

  it('start.md has TeamDelete at finalization', () => {
    const start = readAsset('commands/kiln/start.md');

    assert.ok(
      start.includes('TeamDelete("kiln-session")'),
      'start.md must delete kiln-session team at finalization'
    );
  });

  it('reset.md has TeamDelete for kiln-session', () => {
    const reset = readAsset('commands/kiln/reset.md');

    assert.ok(
      reset.includes('TeamDelete("kiln-session")'),
      'reset.md must delete kiln-session team during cleanup'
    );
  });

  it('kiln-planner-codex has prompt file pattern', () => {
    const codexPlanner = readAsset('agents/kiln-planner-codex.md');

    assert.ok(
      codexPlanner.includes('codex_prompt.md'),
      'kiln-planner-codex must reference codex_prompt.md prompt file'
    );
    assert.ok(
      codexPlanner.includes('$KILN_DIR/plans/codex_prompt.md'),
      'kiln-planner-codex must write prompt to $KILN_DIR/plans/codex_prompt.md'
    );
  });

  it('kiln-planner-codex has anti-pattern rules', () => {
    const codexPlanner = readAsset('agents/kiln-planner-codex.md');

    assert.ok(
      codexPlanner.includes('STOP'),
      'kiln-planner-codex must have STOP anti-pattern rule'
    );
    assert.ok(
      codexPlanner.includes('plan content'),
      'kiln-planner-codex must reference "plan content" in anti-pattern'
    );
  });

  it('kiln-planner-codex uses pipe pattern for Codex CLI', () => {
    const codexPlanner = readAsset('agents/kiln-planner-codex.md');

    assert.ok(
      codexPlanner.includes('cat $KILN_DIR/plans/codex_prompt.md | codex exec'),
      'kiln-planner-codex must use cat | codex exec pipe pattern'
    );
  });

  it('kiln-phase-executor has explicit name parameters for all agents', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');

    const requiredAliases = [
      'Sherlock', 'Confucius', 'Sun Tzu', 'Socrates',
      'Plato', 'Scheherazade', 'Codex', 'Sphinx'
    ];

    for (const alias of requiredAliases) {
      assert.ok(
        executor.includes(`name: "${alias}"`),
        `kiln-phase-executor must have explicit name: "${alias}" parameter`
      );
    }
  });
});
