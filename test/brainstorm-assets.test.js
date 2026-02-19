'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

describe('brainstorming-techniques.json', () => {
  const filePath = path.join(ASSETS_DIR, 'data', 'brainstorming-techniques.json');

  it('exists and is valid JSON', () => {
    assert.ok(fs.existsSync(filePath), 'brainstorming-techniques.json must exist');
    const raw = fs.readFileSync(filePath, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw), 'must be valid JSON');
  });

  it('has version field', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(data.version, '1.0');
  });

  it('contains exactly 61 techniques', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.ok(Array.isArray(data.techniques), 'techniques must be an array');
    assert.strictEqual(data.techniques.length, 61, `expected 61 techniques, got ${data.techniques.length}`);
  });

  it('every technique has required fields with correct types', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const validCategories = [
      'collaborative', 'creative', 'deep', 'structured', 'theatrical',
      'wild', 'introspective_delight', 'biomimetic', 'quantum', 'cultural',
    ];
    const validPhases = ['frame', 'diverge', 'reframe', 'converge', 'stress'];
    const validEnergy = ['low', 'medium', 'high'];

    for (const t of data.techniques) {
      assert.strictEqual(typeof t.id, 'number', `id must be number: ${JSON.stringify(t)}`);
      assert.ok(validCategories.includes(t.category), `invalid category "${t.category}" for technique ${t.id}`);
      assert.strictEqual(typeof t.name, 'string', `name must be string for technique ${t.id}`);
      assert.ok(t.name.length > 0, `name must be non-empty for technique ${t.id}`);
      assert.strictEqual(typeof t.description, 'string', `description must be string for technique ${t.id}`);
      assert.ok(t.description.length > 0, `description must be non-empty for technique ${t.id}`);
      assert.ok(validPhases.includes(t.phase), `invalid phase "${t.phase}" for technique ${t.id}`);
      assert.ok(validEnergy.includes(t.energy), `invalid energy "${t.energy}" for technique ${t.id}`);
    }
  });

  it('all 10 categories are represented', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const expectedCategories = [
      'collaborative', 'creative', 'deep', 'structured', 'theatrical',
      'wild', 'introspective_delight', 'biomimetic', 'quantum', 'cultural',
    ];
    const foundCategories = [...new Set(data.techniques.map((t) => t.category))];
    for (const cat of expectedCategories) {
      assert.ok(foundCategories.includes(cat), `category "${cat}" must be represented`);
    }
  });

  it('all 5 phases are represented', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const expectedPhases = ['frame', 'diverge', 'reframe', 'converge', 'stress'];
    const foundPhases = [...new Set(data.techniques.map((t) => t.phase))];
    for (const phase of expectedPhases) {
      assert.ok(foundPhases.includes(phase), `phase "${phase}" must be represented`);
    }
  });

  it('technique IDs are unique', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const ids = data.techniques.map((t) => t.id);
    const uniqueIds = [...new Set(ids)];
    assert.strictEqual(ids.length, uniqueIds.length, 'technique IDs must be unique');
  });
});

describe('elicitation-methods.json', () => {
  const filePath = path.join(ASSETS_DIR, 'data', 'elicitation-methods.json');

  it('exists and is valid JSON', () => {
    assert.ok(fs.existsSync(filePath), 'elicitation-methods.json must exist');
    const raw = fs.readFileSync(filePath, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw), 'must be valid JSON');
  });

  it('has version field', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(data.version, '1.0');
  });

  it('contains exactly 50 methods', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.ok(Array.isArray(data.methods), 'methods must be an array');
    assert.strictEqual(data.methods.length, 50, `expected 50 methods, got ${data.methods.length}`);
  });

  it('every method has required fields with correct types', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const validCategories = [
      'collaboration', 'advanced', 'competitive', 'technical', 'creative',
      'research', 'risk', 'core', 'learning', 'philosophical', 'retrospective',
    ];

    for (const m of data.methods) {
      assert.strictEqual(typeof m.id, 'number', `id must be number: ${JSON.stringify(m)}`);
      assert.ok(validCategories.includes(m.category), `invalid category "${m.category}" for method ${m.id}`);
      assert.strictEqual(typeof m.name, 'string', `name must be string for method ${m.id}`);
      assert.ok(m.name.length > 0, `name must be non-empty for method ${m.id}`);
      assert.strictEqual(typeof m.description, 'string', `description must be string for method ${m.id}`);
      assert.ok(m.description.length > 0, `description must be non-empty for method ${m.id}`);
      assert.strictEqual(typeof m.output_pattern, 'string', `output_pattern must be string for method ${m.id}`);
      assert.ok(m.output_pattern.length > 0, `output_pattern must be non-empty for method ${m.id}`);
    }
  });

  it('method IDs are unique and sequential 1-50', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const ids = data.methods.map((m) => m.id);
    for (let i = 1; i <= 50; i++) {
      assert.ok(ids.includes(i), `method ID ${i} must be present`);
    }
  });
});

describe('kiln-brainstormer.md', () => {
  const filePath = path.join(ASSETS_DIR, 'agents', 'kiln-brainstormer.md');

  it('exists and is non-empty', () => {
    assert.ok(fs.existsSync(filePath), 'kiln-brainstormer.md must exist');
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.length > 100, 'agent spec must be non-trivial');
  });

  it('has valid YAML frontmatter with required fields', () => {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.startsWith('---'), 'must start with YAML frontmatter delimiter');
    const endIdx = content.indexOf('---', 3);
    assert.ok(endIdx > 3, 'must have closing YAML frontmatter delimiter');
    const frontmatter = content.substring(3, endIdx);

    assert.ok(frontmatter.includes('name: Da Vinci'), 'frontmatter must have name: Da Vinci');
    assert.ok(frontmatter.includes('alias: kiln-brainstormer'), 'frontmatter must have alias: kiln-brainstormer');
    assert.ok(frontmatter.includes('model: opus'), 'frontmatter must specify model: opus');
  });

  it('contains required XML sections', () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const requiredTags = ['<role>', '<rules>', '<inputs>', '<workflow>'];
    for (const tag of requiredTags) {
      assert.ok(content.includes(tag), `agent spec must contain ${tag}`);
    }
  });

  it('enforces facilitator-not-generator philosophy in rules', () => {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('NEVER generate'), 'rules must prohibit generating ideas');
    assert.ok(content.includes('NEVER infer'), 'rules must prohibit inferring answers');
    assert.ok(content.includes('Confirm to write'), 'rules must require write confirmation');
  });

  it('references both data files', () => {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('brainstorming-techniques.json'), 'must reference techniques data file');
    assert.ok(content.includes('elicitation-methods.json'), 'must reference elicitation data file');
  });
});

describe('names.json brainstormer entry', () => {
  const filePath = path.join(ASSETS_DIR, 'names.json');

  it('contains kiln-brainstormer with correct alias', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.ok(data['kiln-brainstormer'], 'names.json must contain kiln-brainstormer');
    assert.strictEqual(data['kiln-brainstormer'].alias, 'Da Vinci');
  });

  it('has quotes array with at least 3 entries', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const entry = data['kiln-brainstormer'];
    assert.ok(Array.isArray(entry.quotes), 'must have quotes array');
    assert.ok(entry.quotes.length >= 3, `must have at least 3 quotes, got ${entry.quotes.length}`);
  });
});
