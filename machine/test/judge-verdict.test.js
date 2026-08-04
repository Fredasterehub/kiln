'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { writeJudgeVerdict, JUDGE_VERDICT_FILENAME } = require('../src/judge-verdict.js');
const { CANONICAL_ARCHITECTURE_ARTIFACTS } = require('../src/manifest.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'judge-verdict.js');

function mkTmpArchDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-verdict-test-'));
  const archDir = path.join(dir, 'architecture');
  fs.mkdirSync(archDir, { recursive: true });
  return archDir;
}

test('writeJudgeVerdict writes the exact verdict text to architecture/judge-verdict.md', () => {
  const archDir = mkTmpArchDir();
  const text = '# Verdict\n\nplan-A wins, decisive margin.\n\n## Named steals\n- ...\n';
  const { verdictPath } = writeJudgeVerdict(archDir, text);

  assert.equal(verdictPath, path.join(archDir, JUDGE_VERDICT_FILENAME));
  assert.equal(fs.readFileSync(verdictPath, 'utf8'), text);
});

test('judge-verdict.md is never one of the five canonical digested content artifacts', () => {
  assert.ok(!CANONICAL_ARCHITECTURE_ARTIFACTS.includes(JUDGE_VERDICT_FILENAME));
});

test('writeJudgeVerdict throws TypeError for missing/empty archDir or verdictText', () => {
  assert.throws(() => writeJudgeVerdict('', 'text'), TypeError);
  assert.throws(() => writeJudgeVerdict(mkTmpArchDir(), ''), TypeError);
  assert.throws(() => writeJudgeVerdict(mkTmpArchDir(), '   \n  '), TypeError);
});

test('writeJudgeVerdict overwrites a prior verdict completely (a re-judged run never mixes old and new text)', () => {
  const archDir = mkTmpArchDir();
  writeJudgeVerdict(archDir, 'first verdict\n');
  writeJudgeVerdict(archDir, 'second verdict\n');
  assert.equal(fs.readFileSync(path.join(archDir, JUDGE_VERDICT_FILENAME), 'utf8'), 'second verdict\n');
});

// ---------- CLI ----------

test('CLI: write command reads verdict text from stdin and writes it verbatim', () => {
  const archDir = mkTmpArchDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write', archDir], {
    encoding: 'utf8',
    input: '# Verdict\n\nplan-B wins.\n',
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(fs.readFileSync(path.join(archDir, 'judge-verdict.md'), 'utf8'), '# Verdict\n\nplan-B wins.\n');
});

test('CLI: missing arguments exits 1 with a usage message', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage/);
});

test('CLI: unknown command exits 1', () => {
  const archDir = mkTmpArchDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'delete', archDir], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
});
