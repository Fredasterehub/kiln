'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function readAsset(relativePath) {
  return fs.readFileSync(path.join(ASSETS_DIR, relativePath), 'utf8');
}

describe('task graph flow enforcement', () => {

  const maestro = readAsset('agents/kiln-phase-executor.md');

  describe('Maestro tools', () => {

    it('has TaskCreate in tools', () => {
      assert.ok(
        maestro.includes('- TaskCreate'),
        'kiln-phase-executor.md must list TaskCreate in tools'
      );
    });

    it('has TaskUpdate in tools', () => {
      assert.ok(
        maestro.includes('- TaskUpdate'),
        'kiln-phase-executor.md must list TaskUpdate in tools'
      );
    });

    it('has TaskList in tools', () => {
      assert.ok(
        maestro.includes('- TaskList'),
        'kiln-phase-executor.md must list TaskList in tools'
      );
    });

    it('has TaskGet in tools', () => {
      assert.ok(
        maestro.includes('- TaskGet'),
        'kiln-phase-executor.md must list TaskGet in tools'
      );
    });

    it('has SendMessage in tools', () => {
      assert.ok(
        maestro.includes('- SendMessage'),
        'kiln-phase-executor.md must list SendMessage in tools'
      );
    });
  });

  describe('Maestro rules', () => {

    it('has Task graph enforcement rule', () => {
      assert.ok(
        maestro.includes('Task graph enforcement'),
        'kiln-phase-executor.md rules must mention "Task graph enforcement"'
      );
    });

    it('has Worker shutdown rule', () => {
      assert.ok(
        maestro.includes('Worker shutdown'),
        'kiln-phase-executor.md rules must mention "Worker shutdown"'
      );
    });

    it('has No polling rule', () => {
      assert.ok(
        maestro.includes('No polling'),
        'kiln-phase-executor.md rules must mention "No polling"'
      );
      assert.ok(
        maestro.includes('Task tool is blocking'),
        'No polling rule must explain that Task tool is blocking'
      );
      assert.ok(
        maestro.includes('Never poll the filesystem'),
        'No polling rule must explicitly prohibit filesystem polling'
      );
    });
  });

  describe('Maestro Setup task graph creation', () => {

    it('Setup section mentions TaskCreate', () => {
      const setupIdx = maestro.indexOf('## Setup');
      const codebaseIdx = maestro.indexOf('## Codebase Index');
      assert.ok(setupIdx >= 0 && codebaseIdx > setupIdx, 'must have Setup and Codebase Index sections');
      const setupSection = maestro.substring(setupIdx, codebaseIdx);
      assert.ok(
        setupSection.includes('TaskCreate'),
        'Setup section must mention TaskCreate for task graph creation'
      );
    });

    it('Setup section mentions addBlockedBy', () => {
      const setupIdx = maestro.indexOf('## Setup');
      const codebaseIdx = maestro.indexOf('## Codebase Index');
      const setupSection = maestro.substring(setupIdx, codebaseIdx);
      assert.ok(
        setupSection.includes('addBlockedBy'),
        'Setup section must mention addBlockedBy for dependency chains'
      );
    });

    it('Setup section has resume mapping', () => {
      const setupIdx = maestro.indexOf('## Setup');
      const codebaseIdx = maestro.indexOf('## Codebase Index');
      const setupSection = maestro.substring(setupIdx, codebaseIdx);
      assert.ok(
        setupSection.includes('Resume') && setupSection.includes('plan_complete') && setupSection.includes('review_approved'),
        'Setup section must have resume mapping with event-to-task mapping'
      );
    });
  });

  describe('Maestro workflow sections have TaskUpdate gates', () => {

    const sections = [
      { name: 'Codebase Index', task: 'T1' },
      { name: 'Plan', task: 'T2' },
      { name: 'Sharpen', task: 'T3' },
      { name: 'Implement', task: 'T4' },
      { name: 'Review', task: 'T5' },
      { name: 'Complete', task: 'T6' },
      { name: 'Reconcile', task: 'T7' },
      { name: 'Archive', task: 'T8' },
    ];

    for (const { name, task } of sections) {
      it(`${name} section has in_progress gate for ${task}`, () => {
        const sectionIdx = maestro.indexOf(`## ${name}`);
        assert.ok(sectionIdx >= 0, `must have ## ${name} section`);
        // Find next section or end
        const nextSectionMatch = maestro.substring(sectionIdx + 5).match(/\n## /);
        const endIdx = nextSectionMatch
          ? sectionIdx + 5 + nextSectionMatch.index
          : maestro.length;
        const sectionContent = maestro.substring(sectionIdx, endIdx);
        assert.ok(
          sectionContent.includes(`TaskUpdate(${task}, status: "in_progress")`),
          `${name} section must have TaskUpdate(${task}, status: "in_progress") gate`
        );
      });

      it(`${name} section has completed close for ${task}`, () => {
        const sectionIdx = maestro.indexOf(`## ${name}`);
        const nextSectionMatch = maestro.substring(sectionIdx + 5).match(/\n## /);
        const endIdx = nextSectionMatch
          ? sectionIdx + 5 + nextSectionMatch.index
          : maestro.length;
        const sectionContent = maestro.substring(sectionIdx, endIdx);
        assert.ok(
          sectionContent.includes(`TaskUpdate(${task}, status: "completed")`),
          `${name} section must have TaskUpdate(${task}, status: "completed") close`
        );
      });
    }
  });

  describe('Maestro workflow mentions shutdown_request', () => {

    it('Codebase Index shuts down Sherlock', () => {
      const idx = maestro.indexOf('## Codebase Index');
      const endIdx = maestro.indexOf('## Plan');
      const section = maestro.substring(idx, endIdx);
      assert.ok(
        section.includes('shutdown_request') && section.includes('Sherlock'),
        'Codebase Index must send shutdown_request to Sherlock'
      );
    });

    it('Plan shuts down planners', () => {
      const idx = maestro.indexOf('## Plan');
      const endIdx = maestro.indexOf('## Sharpen');
      const section = maestro.substring(idx, endIdx);
      assert.ok(
        section.includes('shutdown_request') && section.includes('Confucius'),
        'Plan must send shutdown_request to Confucius'
      );
      assert.ok(
        section.includes('shutdown_request') && section.includes('Sun Tzu'),
        'Plan must send shutdown_request to Sun Tzu'
      );
    });

    it('Implement shuts down Codex per task', () => {
      const idx = maestro.indexOf('## Implement');
      const endIdx = maestro.indexOf('## Review');
      const section = maestro.substring(idx, endIdx);
      assert.ok(
        section.includes('shutdown_request') && section.includes('Codex'),
        'Implement must send shutdown_request to Codex'
      );
    });

    it('Reconcile shuts down Sherlock', () => {
      const idx = maestro.indexOf('## Reconcile');
      const endIdx = maestro.indexOf('## Archive');
      const section = maestro.substring(idx, endIdx);
      assert.ok(
        section.includes('shutdown_request') && section.includes('Sherlock'),
        'Reconcile must send shutdown_request to Sherlock'
      );
    });
  });

  describe('SendMessage used only for shutdown_request', () => {

    it('every SendMessage in Maestro is a shutdown_request', () => {
      // Skip YAML frontmatter (between --- markers)
      const endFrontmatter = maestro.indexOf('---', maestro.indexOf('---') + 3);
      const body = maestro.substring(endFrontmatter);
      const lines = body.split('\n');
      const violations = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('SendMessage') && !lines[i].includes('shutdown_request')) {
          // Allow the rule definition line
          if (lines[i].includes('Worker shutdown') || lines[i].includes('exclusively for shutdown_request')) continue;
          violations.push(`line ${i + 1}: ${lines[i].trim()}`);
        }
      }
      assert.deepStrictEqual(
        violations,
        [],
        `SendMessage used for non-shutdown purposes:\n${violations.join('\n')}`
      );
    });
  });

  describe('kiln-core.md has Task Graph Pattern section', () => {

    it('kiln-core.md contains Task Graph Pattern heading', () => {
      const core = readAsset('skills/kiln-core.md');
      assert.ok(
        core.includes('## Task Graph Pattern'),
        'kiln-core.md must have "## Task Graph Pattern" section'
      );
    });

    it('kiln-core.md Task Graph Pattern mentions addBlockedBy', () => {
      const core = readAsset('skills/kiln-core.md');
      const idx = core.indexOf('## Task Graph Pattern');
      const section = core.substring(idx, idx + 500);
      assert.ok(
        section.includes('addBlockedBy'),
        'Task Graph Pattern section must mention addBlockedBy'
      );
    });
  });

  describe('protocol.md rule 16 mentions task graph', () => {

    it('protocol.md rule 16 mentions task graph', () => {
      const protocol = readAsset('protocol.md');
      const rule16Idx = protocol.indexOf('16. **Team lifecycle**');
      assert.ok(rule16Idx >= 0, 'protocol.md must have rule 16');
      const rule16 = protocol.substring(rule16Idx, rule16Idx + 600);
      assert.ok(
        rule16.includes('task graph') && rule16.includes('blockedBy'),
        'protocol.md rule 16 must mention task graph with blockedBy'
      );
    });
  });
});
