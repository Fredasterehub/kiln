'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function readAsset(relativePath) {
  return fs.readFileSync(path.join(ASSETS_DIR, relativePath), 'utf8');
}

describe('v0.9.0 — orchestrator efficiency & correctness', () => {

  describe('spinner verbs use atomic Bash pattern', () => {

    it('resume.md spinner verbs use mkdir -p atomic Bash pattern', () => {
      const resume = readAsset('commands/kiln/resume.md');
      // All spinner verb sites should use mkdir -p + printf > absolute path
      const spinnerSections = resume.split('Install spinner verbs');
      // Should have at least 4 spinner sites (brainstorm, planning, execution, validation)
      assert.ok(
        spinnerSections.length >= 5,
        `resume.md should have at least 4 "Install spinner verbs" sites, found ${spinnerSections.length - 1}`
      );
      for (let i = 1; i < spinnerSections.length; i++) {
        const section = spinnerSections[i].substring(0, 500);
        assert.ok(
          section.includes('mkdir -p'),
          `resume.md spinner verb site ${i} must use mkdir -p atomic Bash pattern`
        );
        assert.ok(
          section.includes('$PROJECT_PATH/.claude'),
          `resume.md spinner verb site ${i} must use absolute $PROJECT_PATH/.claude path`
        );
        assert.ok(
          section.includes('never use the Write tool'),
          `resume.md spinner verb site ${i} must prohibit Write tool`
        );
      }
    });

    it('start.md spinner verbs use mkdir -p atomic Bash pattern', () => {
      const start = readAsset('commands/kiln/start.md');
      const spinnerSections = start.split('Install spinner verbs');
      // Should have at least 4 spinner sites (brainstorm, planning, execution, validation)
      assert.ok(
        spinnerSections.length >= 5,
        `start.md should have at least 4 "Install spinner verbs" sites, found ${spinnerSections.length - 1}`
      );
      for (let i = 1; i < spinnerSections.length; i++) {
        const section = spinnerSections[i].substring(0, 500);
        assert.ok(
          section.includes('mkdir -p'),
          `start.md spinner verb site ${i} must use mkdir -p atomic Bash pattern`
        );
        assert.ok(
          section.includes('$PROJECT_PATH/.claude'),
          `start.md spinner verb site ${i} must use absolute $PROJECT_PATH/.claude path`
        );
      }
    });
  });

  describe('unconditional team recreation', () => {

    it('resume.md team recreation is unconditional', () => {
      const resume = readAsset('commands/kiln/resume.md');
      assert.ok(
        resume.includes('unconditionally') || resume.includes('Always create'),
        'resume.md must contain "unconditionally" or "Always create" for team recreation'
      );
      assert.ok(
        !resume.includes('If the team already exists'),
        'resume.md must NOT contain "If the team already exists" conditional'
      );
      assert.ok(
        resume.includes('Do not check whether the team exists'),
        'resume.md must explicitly prohibit checking team existence'
      );
    });
  });

  describe('build/test command prohibition', () => {

    it('resume.md prohibits build/test commands', () => {
      const resume = readAsset('commands/kiln/resume.md');
      assert.ok(
        resume.includes('MUST NOT run'),
        'resume.md Key Rules must contain "MUST NOT run" prohibition'
      );
      assert.ok(
        resume.includes('cargo check'),
        'resume.md prohibition must mention cargo check'
      );
      assert.ok(
        resume.includes('npm test'),
        'resume.md prohibition must mention npm test'
      );
    });

    it('start.md prohibits build/test commands', () => {
      const start = readAsset('commands/kiln/start.md');
      assert.ok(
        start.includes('MUST NOT run'),
        'start.md Key Rules must contain "MUST NOT run" prohibition'
      );
      assert.ok(
        start.includes('cargo check'),
        'start.md prohibition must mention cargo check'
      );
      assert.ok(
        start.includes('Maestro (Stage 3)') && start.includes('Argus (Stage 4)'),
        'start.md prohibition must delegate to Maestro and Argus'
      );
    });
  });

  describe('parallel pre-reads in resume.md', () => {

    it('execution routing instructs parallel reads', () => {
      const resume = readAsset('commands/kiln/resume.md');
      const execIdx = resume.indexOf('For `execution`:');
      assert.ok(execIdx >= 0, 'resume.md must have execution routing section');
      const execSection = resume.substring(execIdx, execIdx + 1000);
      assert.ok(
        execSection.includes('Parallel pre-reads'),
        'resume.md execution routing must instruct parallel pre-reads'
      );
      assert.ok(
        execSection.includes('parallel tool calls'),
        'resume.md execution routing must mention parallel tool calls'
      );
      assert.ok(
        execSection.includes('spinner-verbs.json') && execSection.includes('lore.json') && execSection.includes('master-plan.md'),
        'resume.md execution pre-reads must include spinner-verbs, lore, and master-plan'
      );
    });

    it('validation routing instructs parallel reads', () => {
      const resume = readAsset('commands/kiln/resume.md');
      const valIdx = resume.indexOf('For `validation`:');
      assert.ok(valIdx >= 0, 'resume.md must have validation routing section');
      const valSection = resume.substring(valIdx, valIdx + 1000);
      assert.ok(
        valSection.includes('Parallel pre-reads'),
        'resume.md validation routing must instruct parallel pre-reads'
      );
      assert.ok(
        valSection.includes('parallel tool calls'),
        'resume.md validation routing must mention parallel tool calls'
      );
      assert.ok(
        valSection.includes('decisions.md') && valSection.includes('validation/report.md'),
        'resume.md validation pre-reads must include decisions.md and validation report'
      );
    });
  });

  describe('banner + quote persistence combined', () => {

    it('resume.md banner uses combined Bash for quote persistence', () => {
      const resume = readAsset('commands/kiln/resume.md');
      assert.ok(
        resume.includes('mkdir -p "$KILN_DIR/tmp"'),
        'resume.md banner must use mkdir -p for tmp dir'
      );
      assert.ok(
        resume.includes('Do not use the Write tool for `last-quote.json`'),
        'resume.md must prohibit Write tool for last-quote.json'
      );
    });

    it('start.md banners use combined Bash for quote persistence', () => {
      const start = readAsset('commands/kiln/start.md');
      const quoteProhibitions = start.split('Do not use the Write tool for `last-quote.json`');
      // Should have at least 9 banner sites
      assert.ok(
        quoteProhibitions.length >= 10,
        `start.md should have at least 9 "Do not use Write tool" sites, found ${quoteProhibitions.length - 1}`
      );
    });

    it('start.md execution loop reuses pre-read lore.json', () => {
      const start = readAsset('commands/kiln/start.md');
      assert.ok(
        start.includes('lore.json data already read above'),
        'start.md phase banners must reference pre-read lore.json data'
      );
    });
  });

  describe('start.md parallel pre-reads', () => {

    it('Stage 3 has parallel pre-read block', () => {
      const start = readAsset('commands/kiln/start.md');
      assert.ok(
        start.includes('Parallel pre-reads for Stage 3'),
        'start.md must have parallel pre-read block for Stage 3'
      );
    });

    it('Stage 4 has parallel pre-read block', () => {
      const start = readAsset('commands/kiln/start.md');
      assert.ok(
        start.includes('Parallel pre-reads for Stage 4'),
        'start.md must have parallel pre-read block for Stage 4'
      );
    });
  });
});
