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

  it('no coordinator agent contains TeamCreate or TeamDelete', () => {
    const coordinators = [
      'agents/kiln-planning-coordinator.md',
      'agents/kiln-phase-executor.md',
      'agents/kiln-mapper.md'
    ];

    for (const file of coordinators) {
      const content = readAsset(file);
      assert.ok(
        !content.includes('TeamCreate('),
        `${file} must NOT contain TeamCreate — flat team model`
      );
      assert.ok(
        !content.includes('TeamDelete('),
        `${file} must NOT contain TeamDelete — flat team model`
      );
    }
  });

  it('no coordinator agent passes team_name to worker spawns', () => {
    const coordinators = [
      'agents/kiln-planning-coordinator.md',
      'agents/kiln-phase-executor.md',
      'agents/kiln-mapper.md'
    ];

    for (const file of coordinators) {
      const content = readAsset(file);
      assert.ok(
        !content.includes('team_name:'),
        `${file} must NOT pass team_name to worker spawns — auto-registration handles this`
      );
    }
  });

  it('no coordinator agent has post-spawn SendMessage nudge', () => {
    const coordinators = [
      'agents/kiln-planning-coordinator.md',
      'agents/kiln-phase-executor.md',
      'agents/kiln-mapper.md'
    ];

    for (const file of coordinators) {
      const content = readAsset(file);
      assert.ok(
        !content.includes('SendMessage('),
        `${file} must NOT use SendMessage nudges — delegation mandates go in Task prompt`
      );
    }
  });

  it('protocol rule 3 says only Kiln calls TeamCreate/TeamDelete', () => {
    const protocol = readAsset('protocol.md');

    assert.ok(
      protocol.includes('Only Kiln') && protocol.includes('TeamCreate') && protocol.includes('TeamDelete'),
      'Protocol rule 3 must say only Kiln calls TeamCreate/TeamDelete'
    );
  });

  it('protocol rule 16 documents flat team model', () => {
    const protocol = readAsset('protocol.md');

    assert.ok(
      protocol.includes('kiln-session'),
      'Protocol must reference kiln-session team'
    );
    assert.ok(
      protocol.includes('16.'),
      'Protocol must have rule 16'
    );
    assert.ok(
      protocol.includes('No sub-teams'),
      'Protocol rule 16 must state no sub-teams'
    );
  });

  it('kiln-core.md has flat Team Pattern section', () => {
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
      skill.includes('Single flat team') || skill.includes('only team'),
      'kiln-core.md Team Pattern must document flat model'
    );
    assert.ok(
      skill.includes('No sub-teams'),
      'kiln-core.md Team Pattern must state no sub-teams'
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

  it('kiln-implementer has delegation mandate and anti-pattern rules', () => {
    const implementer = readAsset('agents/kiln-implementer.md');

    assert.ok(
      implementer.includes('Delegation mandate'),
      'kiln-implementer must have Delegation mandate rule'
    );
    assert.ok(
      implementer.includes('STOP'),
      'kiln-implementer must have STOP anti-pattern rule'
    );
    assert.ok(
      implementer.includes('Self-check'),
      'kiln-implementer must have Self-check rule'
    );
    assert.ok(
      implementer.includes('No code fixups'),
      'kiln-implementer must have No code fixups rule'
    );
  });

  it('kiln-implementer uses pipe pattern for Codex CLI', () => {
    const implementer = readAsset('agents/kiln-implementer.md');

    assert.ok(
      implementer.includes('cat <PROMPT_PATH> | codex exec'),
      'kiln-implementer must use cat | codex exec pipe pattern'
    );
    assert.ok(
      implementer.includes('gpt-5.3-codex'),
      'kiln-implementer must target gpt-5.3-codex model'
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

  it('delegation mandates are in Task prompt, not SendMessage', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');

    // Scheherazade delegation is in Task prompt
    assert.ok(
      executor.includes('Task prompt to Scheherazade MUST include the delegation mandate'),
      'Scheherazade delegation mandate must be in Task prompt'
    );
    // Codex delegation is in Task prompt
    assert.ok(
      executor.includes('Task prompt to Codex MUST begin with'),
      'Codex delegation mandate must be in Task prompt'
    );
  });
});
