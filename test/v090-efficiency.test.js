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

  describe('Codex CLI sandbox bypass flag', () => {

    it('every codex exec invocation in assets/ includes --dangerously-bypass-approvals-and-sandbox', () => {
      const agentsDir = path.join(ASSETS_DIR, 'agents');
      const skillsDir = path.join(ASSETS_DIR, 'skills');
      const dirs = [agentsDir, skillsDir];
      const violations = [];

      for (const dir of dirs) {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const content = fs.readFileSync(path.join(dir, file), 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('codex exec') && !lines[i].includes('codex exec`') && !lines[i].includes('codex exec -')) {
              // Skip lines that are just mentions, not invocations
              continue;
            }
            if (lines[i].includes('codex exec -m')) {
              // Look at this line and the next 5 lines for the flag
              const block = lines.slice(i, i + 6).join('\n');
              if (!block.includes('--dangerously-bypass-approvals-and-sandbox')) {
                violations.push(`${file}:${i + 1}`);
              }
            }
          }
        }
      }

      assert.deepStrictEqual(
        violations,
        [],
        `codex exec invocations missing --dangerously-bypass-approvals-and-sandbox:\n${violations.join('\n')}`
      );
    });

    it('kiln-core.md GPT-5.2 template includes the sandbox bypass flag', () => {
      const core = readAsset('skills/kiln-core.md');
      const gpt52idx = core.indexOf('**GPT-5.2**');
      assert.ok(gpt52idx >= 0, 'kiln-core.md must have GPT-5.2 template section');
      const templateBlock = core.substring(gpt52idx, gpt52idx + 300);
      assert.ok(
        templateBlock.includes('--dangerously-bypass-approvals-and-sandbox'),
        'kiln-core.md GPT-5.2 template must include --dangerously-bypass-approvals-and-sandbox'
      );
    });
  });

  describe('no legacy kw- agent files', () => {

    it('no kw-* files exist in assets/agents/', () => {
      const agentsDir = path.join(ASSETS_DIR, 'agents');
      const kwFiles = fs.readdirSync(agentsDir).filter(f => f.startsWith('kw-'));
      assert.deepStrictEqual(
        kwFiles,
        [],
        `Legacy kw-* files found in assets/agents/: ${kwFiles.join(', ')}`
      );
    });
  });

  describe('install removes legacy kw-* agents', () => {

    it('install function removes kw-*.md files from agentsDir', () => {
      const os = require('node:os');
      const { install } = require('../src/install');
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-test-'));
      const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-proj-'));

      try {
        // Run install once to create the directory structure
        install({ home: tmpHome, force: true, projectPath: tmpProject });

        // Seed fake kw-* files in the agents dir
        const { resolvePaths } = require('../src/paths');
        const { agentsDir } = resolvePaths(tmpHome);
        fs.writeFileSync(path.join(agentsDir, 'kw-reviewer.md'), 'legacy');
        fs.writeFileSync(path.join(agentsDir, 'kw-planner.md'), 'legacy');
        fs.writeFileSync(path.join(agentsDir, 'kw-executor.md'), 'legacy');

        // Run install again — should clean up the kw-* files
        install({ home: tmpHome, force: true, projectPath: tmpProject });

        const remaining = fs.readdirSync(agentsDir).filter(f => f.startsWith('kw-'));
        assert.deepStrictEqual(
          remaining,
          [],
          `kw-* files should be removed after install, found: ${remaining.join(', ')}`
        );
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpProject, { recursive: true, force: true });
      }
    });
  });
});
