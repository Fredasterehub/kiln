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

    it('does NOT have SendMessage in tools', () => {
      const frontmatter = maestro.substring(0, maestro.indexOf('---', 4));
      assert.ok(
        !frontmatter.includes('- SendMessage'),
        'kiln-phase-executor.md must NOT list SendMessage in tools (worker shutdown is Kiln responsibility)'
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

    it('has Prefer Task return over polling rule', () => {
      assert.ok(
        maestro.includes('Prefer Task return over polling'),
        'kiln-phase-executor.md rules must mention "Prefer Task return over polling"'
      );
      assert.ok(
        maestro.includes('Task tool is blocking'),
        'Polling rule must explain that Task tool is blocking'
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

  describe('Maestro workflow does NOT contain shutdown_request (v0.11.0)', () => {

    it('Codebase Index does not shut down Sherlock', () => {
      const idx = maestro.indexOf('## Codebase Index');
      const endIdx = maestro.indexOf('## Plan');
      const section = maestro.substring(idx, endIdx);
      assert.ok(
        !section.includes('shutdown_request'),
        'Codebase Index must NOT contain shutdown_request (Kiln handles worker cleanup)'
      );
    });

    it('Plan does not shut down planners', () => {
      const idx = maestro.indexOf('## Plan');
      const endIdx = maestro.indexOf('## Sharpen');
      const section = maestro.substring(idx, endIdx);
      assert.ok(
        !section.includes('shutdown_request'),
        'Plan must NOT contain shutdown_request (Kiln handles worker cleanup)'
      );
    });

    it('Implement does not shut down Codex', () => {
      const idx = maestro.indexOf('## Implement');
      const endIdx = maestro.indexOf('## Review');
      const section = maestro.substring(idx, endIdx);
      assert.ok(
        !section.includes('shutdown_request'),
        'Implement must NOT contain shutdown_request (Kiln handles worker cleanup)'
      );
    });

    it('Reconcile does not shut down Sherlock', () => {
      const idx = maestro.indexOf('## Reconcile');
      const endIdx = maestro.indexOf('## Archive');
      const section = maestro.substring(idx, endIdx);
      assert.ok(
        !section.includes('shutdown_request'),
        'Reconcile must NOT contain shutdown_request (Kiln handles worker cleanup)'
      );
    });
  });

  describe('Maestro workflow contains no SendMessage calls (v0.11.0)', () => {

    it('no SendMessage calls in Maestro workflow sections', () => {
      // Skip YAML frontmatter and rules section — only check workflow
      const workflowIdx = maestro.indexOf('<workflow>');
      const workflow = maestro.substring(workflowIdx);
      const lines = workflow.split('\n');
      const violations = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('SendMessage(')) {
          violations.push(`line ${i + 1}: ${lines[i].trim()}`);
        }
      }
      assert.deepStrictEqual(
        violations,
        [],
        `Maestro workflow must not contain SendMessage calls (Kiln handles worker shutdown):\n${violations.join('\n')}`
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

  describe('protocol.md rule 16 — team lifecycle & worker reaping (v0.11.0)', () => {

    it('protocol.md rule 16 mentions task graph', () => {
      const protocol = readAsset('protocol.md');
      const rule16Idx = protocol.indexOf('16. **Team lifecycle');
      assert.ok(rule16Idx >= 0, 'protocol.md must have rule 16');
      const rule16 = protocol.substring(rule16Idx, rule16Idx + 800);
      assert.ok(
        rule16.includes('task graph') && rule16.includes('blockedBy'),
        'protocol.md rule 16 must mention task graph with blockedBy'
      );
    });

    it('rule 16 includes worker reaping', () => {
      const protocol = readAsset('protocol.md');
      const rule16Idx = protocol.indexOf('16. **Team lifecycle');
      const rule16 = protocol.substring(rule16Idx, rule16Idx + 800);
      assert.ok(
        rule16.includes('worker reaping') || rule16.includes('reaps idle workers'),
        'rule 16 must include worker reaping guidance'
      );
    });

    it('rule 16 says Maestro does not handle worker shutdown', () => {
      const protocol = readAsset('protocol.md');
      const rule16Idx = protocol.indexOf('16. **Team lifecycle');
      const rule16 = protocol.substring(rule16Idx, rule16Idx + 800);
      assert.ok(
        rule16.includes('Maestro does not handle worker shutdown'),
        'rule 16 must say Maestro does not handle worker shutdown'
      );
    });
  });
});
