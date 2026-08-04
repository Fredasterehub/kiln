'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { spawnSync } = require('node:child_process');

const { anonymizeBundle, anonymizeText } = require('../src/anonymize.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'anonymize.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'anonymize-test-'));
}

// ---------- anonymizeText ----------

test('anonymizeText replaces each of the six model-name tokens, case-insensitively', () => {
  const text = 'Fable drafted it, Opus reviewed, sonnet checked, GPT ran coverage, Sol judged, and Claude summarized.';
  const out = anonymizeText(text);
  for (const word of ['Fable', 'Opus', 'sonnet', 'GPT', 'Sol', 'Claude']) {
    assert.ok(!out.includes(word), `expected "${word}" to be redacted, got: ${out}`);
  }
  assert.equal((out.match(/\[model\]/g) || []).length, 6);
});

test('anonymizeText does not mangle words that merely contain a model-name substring', () => {
  const text = 'Please solve this in the console; note the clauses below.';
  const out = anonymizeText(text);
  assert.equal(out, text);
});

test('anonymizeText redacts a compound model tag like "GPT-5.6-Sol" into both tokens', () => {
  const out = anonymizeText('Dispatched to GPT-5.6-Sol for review.');
  assert.ok(!out.toLowerCase().includes('gpt'));
  assert.ok(!out.toLowerCase().includes('sol'));
  assert.match(out, /\[model\]-5\.6-\[model\]/);
});

test('anonymizeText redacts a UUID-shaped session id', () => {
  const out = anonymizeText('Codex session id: `019fa3e0-a89d-7e11-b0aa-5bb197ed9869`');
  assert.ok(!out.includes('019fa3e0-a89d-7e11-b0aa-5bb197ed9869'));
  assert.match(out, /\[session\]/);
});

test('anonymizeText redacts a labeled session_id field in JSON-ish text', () => {
  const out = anonymizeText('{"session_id": "abc-not-a-real-uuid-999"}');
  assert.ok(!out.includes('abc-not-a-real-uuid-999'));
  assert.match(out, /\[session\]/);
});

test('anonymizeText redacts a whole <system-reminder> block, including its content', () => {
  const text = 'Before.\n<system-reminder>secret harness state naming Claude and a session</system-reminder>\nAfter.';
  const out = anonymizeText(text);
  assert.ok(!out.includes('secret harness state'));
  assert.ok(!out.includes('<system-reminder>'));
  assert.match(out, /Before\.\n\[redacted\]\nAfter\./);
});

test('anonymizeText redacts a "codex exec resume" transcript marker', () => {
  const out = anonymizeText('Continue via `codex exec resume abc123 --last`.');
  assert.ok(!out.includes('codex exec resume'));
  assert.match(out, /\[redacted\]/);
});

test('anonymizeText strips frontmatter authorship keys but keeps other frontmatter lines', () => {
  const text = ['---', 'name: plan-author', 'model: fable-5', 'session_id: 019fa3e0-a89d-7e11-b0aa-5bb197ed9869', 'effort: high', '---', '', '# Body'].join(
    '\n'
  );
  const out = anonymizeText(text);
  assert.ok(!out.includes('model: fable-5') && !out.includes('model:'));
  assert.ok(!out.includes('session_id:'));
  assert.ok(out.includes('name: plan-author'));
  assert.ok(out.includes('effort: high'));
  assert.ok(out.includes('# Body'));
});

test('anonymizeText leaves a file with no frontmatter untouched by the frontmatter step', () => {
  const text = '# Plan\n\nNo frontmatter here, just prose.\n';
  const out = anonymizeText(text);
  assert.equal(out, text);
});

test('anonymizeText is deterministic: the same input always produces the same output', () => {
  const text = 'Fable and Sol, session 019fa3e0-a89d-7e11-b0aa-5bb197ed9869, codex exec resume xyz.';
  assert.equal(anonymizeText(text), anonymizeText(text));
});

// ---------- anonymizeBundle ----------

test('anonymizeBundle copies every named file from srcDir to destDir at the same relative path', () => {
  const srcDir = mkTmpDir();
  const destDir = path.join(mkTmpDir(), 'anon');
  fs.writeFileSync(path.join(srcDir, 'plan.md'), '# Plan\n\nAuthored by Claude Opus.\n');
  fs.writeFileSync(path.join(srcDir, 'protocol-record.md'), 'Sol ran coverage.\n');

  const { written } = anonymizeBundle(srcDir, destDir, ['plan.md', 'protocol-record.md']);

  assert.equal(written.length, 2);
  assert.equal(fs.existsSync(path.join(destDir, 'plan.md')), true);
  assert.equal(fs.existsSync(path.join(destDir, 'protocol-record.md')), true);
  assert.doesNotMatch(fs.readFileSync(path.join(destDir, 'plan.md'), 'utf8'), /Claude|Opus/);
  assert.doesNotMatch(fs.readFileSync(path.join(destDir, 'protocol-record.md'), 'utf8'), /Sol/);
});

test('anonymizeBundle preserves nested relative paths (e.g. drafts/<slot>/plan.md)', () => {
  const srcDir = mkTmpDir();
  const destDir = path.join(mkTmpDir(), 'anon');
  const nestedSrc = path.join(srcDir, 'drafts', 'plan-A');
  fs.mkdirSync(nestedSrc, { recursive: true });
  fs.writeFileSync(path.join(nestedSrc, 'plan.md'), '# Plan A\n');

  const { written } = anonymizeBundle(srcDir, destDir, [path.join('drafts', 'plan-A', 'plan.md')]);

  assert.equal(written.length, 1);
  assert.equal(fs.existsSync(path.join(destDir, 'drafts', 'plan-A', 'plan.md')), true);
});

test('anonymizeBundle creates destDir if it does not exist', () => {
  const srcDir = mkTmpDir();
  const destDir = path.join(mkTmpDir(), 'does', 'not', 'exist', 'yet');
  fs.writeFileSync(path.join(srcDir, 'plan.md'), '# Plan\n');

  anonymizeBundle(srcDir, destDir, ['plan.md']);
  assert.equal(fs.existsSync(path.join(destDir, 'plan.md')), true);
});

test('anonymizeBundle throws when a named file does not exist in srcDir', () => {
  const srcDir = mkTmpDir();
  const destDir = path.join(mkTmpDir(), 'anon');
  assert.throws(() => anonymizeBundle(srcDir, destDir, ['plan.md']), /could not read/);
});

// ---------- containment (P11 Sol review pass-2 defect 1) ----------

test('anonymizeBundle refuses a "../secret.txt" entry and leaves the outside file untouched (Sol\'s own probe)', () => {
  const parent = mkTmpDir();
  const srcDir = path.join(parent, 'bundle');
  fs.mkdirSync(srcDir);
  const destDir = path.join(mkTmpDir(), 'anon');
  const secretPath = path.join(parent, 'secret.txt');
  const originalContent = 'Drafted by Claude Opus — sibling secret, outside the bundle.\n';
  fs.writeFileSync(secretPath, originalContent);

  assert.throws(() => anonymizeBundle(srcDir, destDir, ['../secret.txt']), /\.\./);

  assert.equal(fs.readFileSync(secretPath, 'utf8'), originalContent);
  assert.equal(fs.existsSync(path.join(destDir, 'secret.txt')), false);
});

test('anonymizeBundle refuses an absolute-path entry', () => {
  const srcDir = mkTmpDir();
  const destDir = path.join(mkTmpDir(), 'anon');
  const outside = path.join(mkTmpDir(), 'outside.txt');
  fs.writeFileSync(outside, 'outside content\n');
  assert.throws(() => anonymizeBundle(srcDir, destDir, [outside]), /relative/);
});

test('anonymizeBundle refuses destDir equal to srcDir', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'plan.md'), '# Plan\n');
  assert.throws(() => anonymizeBundle(dir, dir, ['plan.md']), /same directory/);
});

test('anonymizeBundle refuses a destDir nested inside srcDir', () => {
  const srcDir = mkTmpDir();
  fs.writeFileSync(path.join(srcDir, 'plan.md'), '# Plan\n');
  const destDir = path.join(srcDir, 'nested-dest');
  assert.throws(() => anonymizeBundle(srcDir, destDir, ['plan.md']), /nested inside srcDir/);
});

test('anonymizeBundle refuses a srcDir nested inside destDir', () => {
  const destDir = mkTmpDir();
  const srcDir = path.join(destDir, 'nested-src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(path.join(srcDir, 'plan.md'), '# Plan\n');
  assert.throws(() => anonymizeBundle(srcDir, destDir, ['plan.md']), /nested inside destDir/);
});

test('anonymizeBundle refuses a symlinked path component that escapes srcDir, even with no ".." in the relPath', () => {
  const parent = mkTmpDir();
  const srcDir = path.join(parent, 'bundle');
  fs.mkdirSync(srcDir);
  const outsideDir = path.join(parent, 'outside');
  fs.mkdirSync(outsideDir);
  const secretPath = path.join(outsideDir, 'secret.txt');
  const originalContent = 'sibling secret via a symlinked directory\n';
  fs.writeFileSync(secretPath, originalContent);
  fs.symlinkSync(outsideDir, path.join(srcDir, 'linked'));
  const destDir = path.join(mkTmpDir(), 'anon');

  assert.throws(() => anonymizeBundle(srcDir, destDir, [path.join('linked', 'secret.txt')]), /resolves outside/);
  assert.equal(fs.readFileSync(secretPath, 'utf8'), originalContent);
});

test('anonymizeBundle throws TypeError for missing/empty arguments', () => {
  assert.throws(() => anonymizeBundle('', 'dest', ['a']), TypeError);
  assert.throws(() => anonymizeBundle('src', '', ['a']), TypeError);
  assert.throws(() => anonymizeBundle('src', 'dest', []), TypeError);
  assert.throws(() => anonymizeBundle('src', 'dest', undefined), TypeError);
});

test('anonymizeBundle is deterministic: running it twice over the same source produces byte-identical output', () => {
  const srcDir = mkTmpDir();
  const destDir1 = path.join(mkTmpDir(), 'anon1');
  const destDir2 = path.join(mkTmpDir(), 'anon2');
  fs.writeFileSync(path.join(srcDir, 'plan.md'), '# Plan\n\nDrafted by Fable, checked by Sol.\n');

  anonymizeBundle(srcDir, destDir1, ['plan.md']);
  anonymizeBundle(srcDir, destDir2, ['plan.md']);

  assert.equal(
    fs.readFileSync(path.join(destDir1, 'plan.md'), 'utf8'),
    fs.readFileSync(path.join(destDir2, 'plan.md'), 'utf8')
  );
});

test('anonymizeBundle over the canonical five architecture artifacts scrubs authorship from all of them', () => {
  const { writeValidContentArtifacts } = require('./fixtures/valid-architecture-artifacts.js');
  const { CANONICAL_ARCHITECTURE_ARTIFACTS } = require('../src/manifest.js');

  const srcDir = path.join(mkTmpDir(), 'architecture');
  writeValidContentArtifacts(srcDir);
  // Inject an authorship tell into one of the fixture files to prove the
  // pipeline actually scrubs real content, not just the fixture's defaults.
  fs.appendFileSync(path.join(srcDir, 'protocol-record.md'), '\nDrafted by Claude Opus, session 019fa3e0-a89d-7e11-b0aa-5bb197ed9869.\n');

  const destDir = path.join(mkTmpDir(), 'anon');
  const { written } = anonymizeBundle(srcDir, destDir, CANONICAL_ARCHITECTURE_ARTIFACTS);

  assert.equal(written.length, CANONICAL_ARCHITECTURE_ARTIFACTS.length);
  const protocolRecord = fs.readFileSync(path.join(destDir, 'protocol-record.md'), 'utf8');
  assert.doesNotMatch(protocolRecord, /Claude|Opus/);
  assert.doesNotMatch(protocolRecord, /019fa3e0-a89d-7e11-b0aa-5bb197ed9869/);
  assert.match(protocolRecord, /standard/i); // the protocol name itself must survive anonymization
});

// ---------- CLI: anonymize-bundle (P11 convergence finding 4) ----------

test('CLI: anonymize-bundle reads its files array from stdin and scrubs authorship', () => {
  const srcDir = mkTmpDir();
  fs.writeFileSync(path.join(srcDir, 'report.md'), 'Drafted by Sol, session 019fa3e0-a89d-7e11-b0aa-5bb197ed9869.\n');
  const destDir = path.join(mkTmpDir(), 'anon');

  const proc = spawnSync(process.execPath, [CLI_PATH, 'anonymize-bundle', srcDir, destDir], {
    encoding: 'utf8',
    input: JSON.stringify(['report.md']),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.written.length, 1);
  const content = fs.readFileSync(path.join(destDir, 'report.md'), 'utf8');
  assert.doesNotMatch(content, /Sol/);
  assert.doesNotMatch(content, /019fa3e0-a89d-7e11-b0aa-5bb197ed9869/);
});

test('CLI: anonymize-bundle exits 1 for a missing source file', () => {
  const srcDir = mkTmpDir();
  const destDir = path.join(mkTmpDir(), 'anon');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'anonymize-bundle', srcDir, destDir], {
    encoding: 'utf8',
    input: JSON.stringify(['nope.md']),
  });
  assert.equal(proc.status, 1);
});

test('CLI: anonymize-bundle exits 1 on invalid JSON via stdin', () => {
  const srcDir = mkTmpDir();
  const destDir = path.join(mkTmpDir(), 'anon');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'anonymize-bundle', srcDir, destDir], {
    encoding: 'utf8',
    input: 'not json',
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^anonymize\.js: /);
});

test('CLI: missing srcDir/destDir prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'anonymize-bundle'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: anonymize\.js/);
});

test('CLI: unknown command prints usage and exits 1', () => {
  const srcDir = mkTmpDir();
  const destDir = path.join(mkTmpDir(), 'anon');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'bogus', srcDir, destDir], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: anonymize\.js/);
});

test('CLI: a surplus positional argument is refused (P11 Sol review finding 13)', () => {
  const srcDir = mkTmpDir();
  const destDir = path.join(mkTmpDir(), 'anon');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'anonymize-bundle', srcDir, destDir, 'extra'], {
    encoding: 'utf8',
    input: JSON.stringify(['plan.md']),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /unexpected extra argument/);
});
