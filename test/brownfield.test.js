'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function readAsset(relativePath) {
  return fs.readFileSync(path.join(ASSETS_DIR, relativePath), 'utf8');
}

// Extract YAML frontmatter between --- delimiters.
function frontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

describe('kiln-mapper (Mnemosyne)', () => {
  it('kiln-mapper.md exists in assets/agents/', () => {
    const filePath = path.join(ASSETS_DIR, 'agents', 'kiln-mapper.md');
    assert.ok(fs.existsSync(filePath), 'assets/agents/kiln-mapper.md must exist');
  });

  it('kiln-mapper.md frontmatter has correct name, alias, and model', () => {
    const content = readAsset('agents/kiln-mapper.md');
    const fm = frontmatter(content);
    assert.ok(fm.includes('kiln-mapper'), 'frontmatter must contain kiln-mapper (alias field)');
    assert.ok(fm.includes('Mnemosyne'), 'frontmatter must contain alias Mnemosyne');
    assert.ok(fm.includes('opus'), 'frontmatter must specify opus model');
  });

  it('kiln-mapper.md has forbidden files list (.env, .pem)', () => {
    const content = readAsset('agents/kiln-mapper.md');
    assert.ok(content.includes('.env'), 'kiln-mapper must list .env in forbidden files');
    assert.ok(
      content.includes('.pem') || content.includes('*.pem'),
      'kiln-mapper must list .pem in forbidden files',
    );
  });

  it('kiln-mapper.md has provenance prefix [Observed by Mnemosyne', () => {
    const content = readAsset('agents/kiln-mapper.md');
    assert.ok(
      content.includes('[Observed by Mnemosyne'),
      'kiln-mapper must include provenance prefix [Observed by Mnemosyne',
    );
  });

  it('kiln-mapper.md has idempotency guard for seeding', () => {
    const content = readAsset('agents/kiln-mapper.md');
    assert.ok(
      content.includes('only if') || content.includes('idempotency'),
      'kiln-mapper must have idempotency guard for seeding decisions.md and pitfalls.md',
    );
  });

  it('kiln-mapper.md has Task tool in tools list', () => {
    const content = readAsset('agents/kiln-mapper.md');
    const fm = frontmatter(content);
    assert.ok(
      /^\s*-\s*Task\s*$/m.test(fm),
      'kiln-mapper frontmatter must include Task in tools list',
    );
  });
});

describe('Muse agents (leaf workers)', () => {
  const museFiles = [
    'kiln-arch-muse.md',
    'kiln-tech-muse.md',
    'kiln-quality-muse.md',
    'kiln-api-muse.md',
    'kiln-data-muse.md',
  ];

  it('all 5 muse files exist in assets/agents/', () => {
    const missing = museFiles.filter(
      (f) => !fs.existsSync(path.join(ASSETS_DIR, 'agents', f)),
    );
    assert.deepStrictEqual(missing, [], `Missing muse files: ${JSON.stringify(missing)}`);
  });

  it('no muse file references the Task tool (leaf worker enforcement)', () => {
    const violations = [];
    for (const f of museFiles) {
      const content = readAsset(`agents/${f}`);
      const fm = frontmatter(content);
      // Task must not appear as a tool in frontmatter
      if (/^\s*-\s*Task\s*$/m.test(fm)) {
        violations.push(f);
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      `Muse files must not have Task tool: ${JSON.stringify(violations)}`,
    );
  });

  it('all muse files contain work block format (### Observations)', () => {
    const missing = [];
    for (const f of museFiles) {
      const content = readAsset(`agents/${f}`);
      if (!content.includes('### Observations')) {
        missing.push(f);
      }
    }
    assert.deepStrictEqual(
      missing,
      [],
      `Muse files missing work block (### Observations): ${JSON.stringify(missing)}`,
    );
  });
});

describe('brownfield schema and protocol', () => {
  it('names.json has kiln-mapper entry with alias Mnemosyne and at least 5 quotes', () => {
    const names = JSON.parse(readAsset('names.json'));
    const entry = names['kiln-mapper'];
    assert.ok(entry, 'names.json must have kiln-mapper entry');
    assert.strictEqual(entry.alias, 'Mnemosyne', 'kiln-mapper alias must be Mnemosyne');
    assert.ok(Array.isArray(entry.quotes), 'kiln-mapper must have quotes array');
    assert.ok(entry.quotes.length >= 5, `kiln-mapper must have at least 5 quotes, found ${entry.quotes.length}`);
  });

  it('templates/MEMORY.md contains project_mode field', () => {
    const template = readAsset('templates/MEMORY.md');
    assert.ok(
      template.includes('project_mode'),
      'templates/MEMORY.md must contain project_mode field',
    );
  });

  it('kiln-core.md contains project_mode in memory schema', () => {
    const skill = readAsset('skills/kiln-core.md');
    assert.ok(
      skill.includes('project_mode'),
      'kiln-core.md must define project_mode in memory schema',
    );
  });

  it('start.md .gitignore entries include codebase-snapshot.md', () => {
    const start = readAsset('commands/kiln/start.md');
    // Find the gitignore section (between .gitignore mention and "Do not add extra entries")
    const gitignoreStart = start.indexOf('.gitignore');
    const gitignoreEnd = start.indexOf('Do not add extra entries');
    assert.ok(gitignoreStart !== -1, 'start.md must have .gitignore section');
    assert.ok(gitignoreEnd !== -1, 'start.md must have "Do not add extra entries" sentinel');
    const gitignoreSection = start.substring(gitignoreStart, gitignoreEnd);
    assert.ok(
      gitignoreSection.includes('codebase-snapshot.md'),
      'start.md gitignore entries must include codebase-snapshot.md',
    );
  });

  it('start.md has Step 4.5 brownfield detection', () => {
    const start = readAsset('commands/kiln/start.md');
    assert.ok(
      start.includes('4.5'),
      'start.md must contain Step 4.5',
    );
    assert.ok(
      start.toLowerCase().includes('brownfield'),
      'start.md must contain brownfield detection logic',
    );
  });

  it('resume.md has project_mode in continuity banner', () => {
    const resume = readAsset('commands/kiln/resume.md');
    assert.ok(
      resume.includes('project_mode'),
      'resume.md must extract project_mode from MEMORY.md',
    );
    assert.ok(
      resume.includes('Mode:') || resume.includes('[project_mode]'),
      'resume.md continuity banner must display project_mode',
    );
  });
});
