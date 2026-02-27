'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(__dirname, '..', filePath), 'utf8');
}

describe('workflow drift guardrails', () => {
  it('start.md must be memory-first and not tmux-gated', () => {
    const start = read('assets/commands/kiln/start.md');
    assert.ok(
      start.includes('Rule 0: MEMORY.md First (Hard Gate)'),
      'start.md must enforce memory-first hard gate'
    );
    assert.ok(
      !start.includes('tmux is required for reliable multi-agent spawning right now'),
      'start.md must not enforce tmux preflight'
    );
  });

  it('resume.md must be memory-first and not tmux-gated', () => {
    const resume = read('assets/commands/kiln/resume.md');
    assert.ok(
      resume.includes('Rule 0: MEMORY.md First (Hard Gate)'),
      'resume.md must enforce memory-first hard gate'
    );
    assert.ok(
      !resume.includes('tmux is required for reliable multi-agent spawning right now'),
      'resume.md must not enforce tmux preflight'
    );
  });

  it('start.md uses project-local MEMORY_DIR path contract', () => {
    const start = read('assets/commands/kiln/start.md');
    assert.ok(
      start.includes('MEMORY_DIR = $PROJECT_PATH/.kiln/memory'),
      'start.md must derive MEMORY_DIR as $PROJECT_PATH/.kiln/memory'
    );
  });

  it('start.md uses TeamDelete-first cleanup and keeps rm -rf as fallback only', () => {
    const start = read('assets/commands/kiln/start.md');
    assert.ok(
      start.includes('Attempt `TeamDelete("kiln-session")` unconditionally.'),
      'start.md must attempt TeamDelete first'
    );
    assert.ok(
      !start.includes('rm -rf $HOME/.claude/teams/kiln-session/'),
      'start.md must not use rm -rf as the primary cleanup path'
    );
    assert.ok(
      start.includes('rm -rf "$CLAUDE_HOME/teams/kiln-session/"'),
      'start.md must keep rm -rf only as explicit stale-directory fallback'
    );
  });

  it('resume.md contains no broken double-slash memory path', () => {
    const resume = read('assets/commands/kiln/resume.md');
    const brokenPath = 'projects/' + '/memory';
    assert.ok(
      !resume.includes(brokenPath),
      'resume.md must not contain a broken double-slash memory path'
    );
  });

  it('resume.md defines project-local MEMORY_DIR without trailing slash', () => {
    const resume = read('assets/commands/kiln/resume.md');
    assert.ok(
      resume.includes('MEMORY_DIR = $PROJECT_PATH/.kiln/memory'),
      'resume.md must define project-local MEMORY_DIR without trailing slash'
    );
    assert.ok(
      !resume.includes('MEMORY_DIR = $PROJECT_PATH/.kiln/memory/'),
      'resume.md must not define MEMORY_DIR with trailing slash'
    );
  });

  it('resume.md missing-memory warning includes canonical MEMORY.md path', () => {
    const resume = read('assets/commands/kiln/resume.md');
    assert.ok(
      resume.includes('[kiln:resume] No memory found at $MEMORY_DIR/MEMORY.md.'),
      'resume.md warning must include $MEMORY_DIR/MEMORY.md'
    );
  });

  it('resume.md uses TeamDelete-first cleanup and fallback', () => {
    const resume = read('assets/commands/kiln/resume.md');
    assert.ok(
      resume.includes('Attempt `TeamDelete("kiln-session")` unconditionally.'),
      'resume.md must attempt TeamDelete first'
    );
    assert.ok(
      resume.includes('rm -rf "$CLAUDE_HOME/teams/kiln-session/"'),
      'resume.md must include stale-directory fallback cleanup'
    );
  });

  it('README explicitly states tmux is not required for sequential mode', () => {
    const readme = read('README.md');
    assert.ok(
      readme.includes('No tmux') || readme.includes('tmux is optional'),
      'README must state tmux is not required for sequential mode'
    );
  });

  it('README does not claim Maestro owns shutdown_request dispatch', () => {
    const readme = read('README.md');
    assert.ok(
      !readme.includes('Maestro sends `shutdown_request`'),
      'README must not claim Maestro sends shutdown_request'
    );
  });

  it('start.md has no unresolved handoff placeholders', () => {
    const start = read('assets/commands/kiln/start.md');
    const forbidden = ['set to ;', 'Debate mode  selected', 'Brainstorm depth  selected', '<BRAINSTORM_DEPTH>', '<DEBATE_MODE>'];
    for (const value of forbidden) {
      assert.ok(
        !start.includes(value),
        `start.md must not contain unresolved placeholder: ${value}`
      );
    }
  });
});
