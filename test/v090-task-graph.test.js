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

    it('does NOT have TaskCreate in tools (Kiln creates task graph)', () => {
      const frontmatter = maestro.substring(0, maestro.indexOf('---', 4));
      assert.ok(
        !frontmatter.includes('- TaskCreate'),
        'kiln-phase-executor.md must NOT list TaskCreate in tools (Kiln creates the task graph)'
      );
    });

    it('has TaskUpdate in tools', () => {
      assert.ok(
        maestro.includes('- TaskUpdate'),
        'kiln-phase-executor.md must list TaskUpdate in tools'
      );
    });

    it('does NOT have TaskList in tools (Kiln creates task graph)', () => {
      const frontmatter = maestro.substring(0, maestro.indexOf('---', 4));
      assert.ok(
        !frontmatter.includes('- TaskList'),
        'kiln-phase-executor.md must NOT list TaskList in tools (Kiln creates the task graph)'
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

    it('does NOT have Grep in tools (codebase exploration is worker work)', () => {
      const frontmatter = maestro.substring(0, maestro.indexOf('---', 4));
      assert.ok(
        !frontmatter.includes('- Grep'),
        'kiln-phase-executor.md must NOT list Grep in tools (codebase exploration is delegated to workers)'
      );
    });

    it('does NOT have Glob in tools (codebase exploration is worker work)', () => {
      const frontmatter = maestro.substring(0, maestro.indexOf('---', 4));
      assert.ok(
        !frontmatter.includes('- Glob'),
        'kiln-phase-executor.md must NOT list Glob in tools (codebase exploration is delegated to workers)'
      );
    });
  });

  describe('Maestro rules', () => {

    it('has Task graph gates rule', () => {
      assert.ok(
        maestro.includes('Task graph gates'),
        'kiln-phase-executor.md rules must mention "Task graph gates"'
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

    it('Setup section references task_ids input', () => {
      const setupIdx = maestro.indexOf('## Setup');
      const codebaseIdx = maestro.indexOf('## Codebase Index');
      assert.ok(setupIdx >= 0 && codebaseIdx > setupIdx, 'must have Setup and Codebase Index sections');
      const setupSection = maestro.substring(setupIdx, codebaseIdx);
      assert.ok(
        setupSection.includes('task_ids'),
        'Setup section must reference task_ids from Kiln'
      );
    });

    it('Setup section references kiln-core.md resume mapping', () => {
      const setupIdx = maestro.indexOf('## Setup');
      const codebaseIdx = maestro.indexOf('## Codebase Index');
      const setupSection = maestro.substring(setupIdx, codebaseIdx);
      assert.ok(
        setupSection.includes('kiln-core.md') && setupSection.includes('resume'),
        'Setup section must reference kiln-core.md resume mapping'
      );
    });

    it('inputs section includes task_ids', () => {
      const inputsIdx = maestro.indexOf('<inputs>');
      const inputsEnd = maestro.indexOf('</inputs>');
      const inputsSection = maestro.substring(inputsIdx, inputsEnd);
      assert.ok(
        inputsSection.includes('task_ids'),
        'inputs must include task_ids parameter'
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

    it('kiln-core.md contains Phase Task Graph heading', () => {
      const core = readAsset('skills/kiln-core.md');
      assert.ok(
        core.includes('## Phase Task Graph'),
        'kiln-core.md must have "## Phase Task Graph" section'
      );
    });

    it('kiln-core.md Phase Task Graph has template and resume mapping', () => {
      const core = readAsset('skills/kiln-core.md');
      const idx = core.indexOf('## Phase Task Graph');
      const section = core.substring(idx, idx + 1500);
      assert.ok(
        section.includes('blockedBy') && section.includes('Resume pre-marking') && section.includes('task_ids'),
        'Phase Task Graph section must have template with blockedBy, resume pre-marking, and task_ids passing'
      );
    });
  });

  describe('protocol.md rule 16 — team lifecycle & worker reaping (v0.11.0)', () => {

    it('protocol.md rule 16 mentions dependency graph', () => {
      const protocol = readAsset('protocol.md');
      const rule16Idx = protocol.indexOf('16. **Team lifecycle');
      assert.ok(rule16Idx >= 0, 'protocol.md must have rule 16');
      const rule16 = protocol.substring(rule16Idx, rule16Idx + 800);
      assert.ok(
        rule16.includes('dependency graph') && rule16.includes('blockedBy'),
        'protocol.md rule 16 must mention dependency graph with blockedBy'
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
