'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(__dirname, '..', filePath), 'utf8');
}

describe('workflow drift guardrails', () => {
  it('start.md uses canonical MEMORY_DIR path contract', () => {
    const start = read('assets/commands/kiln/start.md');
    assert.ok(
      start.includes('$CLAUDE_HOME/projects/$ENCODED_PATH/memory'),
      'start.md must derive MEMORY_DIR as $CLAUDE_HOME/projects/$ENCODED_PATH/memory'
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

  it('README does not claim tmux is required', () => {
    const readme = read('README.md');
    assert.ok(
      !readme.includes('tmux required'),
      'README must not claim tmux is required'
    );
  });

  it('README does not claim Maestro owns shutdown_request dispatch', () => {
    const readme = read('README.md');
    assert.ok(
      !readme.includes('Maestro sends `shutdown_request`'),
      'README must not claim Maestro sends shutdown_request'
    );
  });
});
