const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  insertProtocol,
  replaceProtocol,
  removeProtocol,
  hasProtocol,
  extractVersion,
} = require('../src/markers.js');

describe('insertProtocol', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `kiln-markers-test-${Math.random().toString(36).slice(2)}.md`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpFile, { force: true });
  });

  it('creates a new file with protocol block when file does not exist', () => {
    fs.rmSync(tmpFile, { force: true });
    insertProtocol(tmpFile, 'hello world', '1.0.0');
    const content = fs.readFileSync(tmpFile, 'utf8');

    assert.ok(content.includes('<!-- kiln:protocol:begin v1.0.0 -->'));
    assert.ok(content.includes('hello world'));
    assert.ok(content.includes('<!-- kiln:protocol:end -->'));
  });

  it('appends a protocol block to an existing file with no block', () => {
    fs.writeFileSync(tmpFile, '# Existing Content\n');
    insertProtocol(tmpFile, 'protocol content', '2.0.0');
    const content = fs.readFileSync(tmpFile, 'utf8');

    assert.ok(content.includes('# Existing Content'));
    assert.ok(content.includes('<!-- kiln:protocol:begin v2.0.0 -->'));
    assert.ok(
      content.indexOf('# Existing Content') <
        content.indexOf('<!-- kiln:protocol:begin')
    );
  });

  it('replaces an existing protocol block', () => {
    insertProtocol(tmpFile, 'first content', '1.0.0');
    insertProtocol(tmpFile, 'second content', '1.1.0');
    const content = fs.readFileSync(tmpFile, 'utf8');

    assert.ok(content.includes('second content'));
    assert.ok(content.includes('v1.1.0'));
    assert.ok(!content.includes('first content'));
    assert.strictEqual((content.match(/kiln:protocol:begin/g) || []).length, 1);
  });
});

describe('replaceProtocol', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `kiln-markers-test-${Math.random().toString(36).slice(2)}.md`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpFile, { force: true });
  });

  it('replaces the existing block in place', () => {
    insertProtocol(tmpFile, 'old', '1.0.0');
    replaceProtocol(tmpFile, 'new content', '1.2.0');
    const content = fs.readFileSync(tmpFile, 'utf8');

    assert.ok(content.includes('new content'));
    assert.ok(content.includes('v1.2.0'));
    assert.ok(!content.includes('old'));
  });
});

describe('removeProtocol', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `kiln-markers-test-${Math.random().toString(36).slice(2)}.md`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpFile, { force: true });
  });

  it('removes the block and preserves surrounding content', () => {
    fs.writeFileSync(tmpFile, '# Before\n');
    insertProtocol(tmpFile, 'block content', '1.0.0');
    fs.appendFileSync(tmpFile, '\n# After\n');

    removeProtocol(tmpFile);
    const content = fs.readFileSync(tmpFile, 'utf8');

    assert.ok(content.includes('# Before'));
    assert.ok(content.includes('# After'));
    assert.ok(!content.includes('kiln:protocol'));
  });

  it('deletes the file if only the protocol block remained', () => {
    insertProtocol(tmpFile, 'only block', '1.0.0');
    removeProtocol(tmpFile);
    assert.ok(!fs.existsSync(tmpFile));
  });
});

describe('hasProtocol', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `kiln-markers-test-${Math.random().toString(36).slice(2)}.md`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpFile, { force: true });
  });

  it('returns false when file does not exist', () => {
    assert.strictEqual(hasProtocol(tmpFile), false);
  });

  it('returns false for a file with no protocol block', () => {
    fs.writeFileSync(tmpFile, '# Just a markdown file\n');
    assert.strictEqual(hasProtocol(tmpFile), false);
  });

  it('returns true when the protocol block is present', () => {
    insertProtocol(tmpFile, 'content', '1.0.0');
    assert.strictEqual(hasProtocol(tmpFile), true);
  });
});

describe('extractVersion', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `kiln-markers-test-${Math.random().toString(36).slice(2)}.md`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpFile, { force: true });
  });

  it('returns null when file does not exist', () => {
    assert.strictEqual(extractVersion(tmpFile), null);
  });

  it('returns the version string from the marker', () => {
    insertProtocol(tmpFile, 'content', '3.7.2');
    assert.strictEqual(extractVersion(tmpFile), '3.7.2');
  });
});
