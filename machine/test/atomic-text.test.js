'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeAtomicText } = require('../src/atomic-text.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-text-test-'));
}

test('writeAtomicText writes the exact text given, byte for byte', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'note.md');
  writeAtomicText(file, '# Note\n\nHello.\n');
  assert.equal(fs.readFileSync(file, 'utf8'), '# Note\n\nHello.\n');
});

test('writeAtomicText creates parent directories as needed', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'a', 'b', 'c', 'note.md');
  writeAtomicText(file, 'nested\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'nested\n');
});

test('writeAtomicText overwrites an existing file completely, never appends', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'note.md');
  writeAtomicText(file, 'first\n');
  writeAtomicText(file, 'second\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'second\n');
});

test('writeAtomicText leaves no temp file behind on success', () => {
  const dir = mkTmpDir();
  const file = path.join(dir, 'note.md');
  writeAtomicText(file, 'content\n');
  const entries = fs.readdirSync(dir);
  assert.deepEqual(entries, ['note.md']);
});

test('writeAtomicText throws TypeError for a non-string file or text', () => {
  assert.throws(() => writeAtomicText('', 'x'), TypeError);
  assert.throws(() => writeAtomicText(path.join(mkTmpDir(), 'f.md'), 42), TypeError);
});
