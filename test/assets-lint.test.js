'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function listTextAssets(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTextAssets(absolute));
      continue;
    }

    if (entry.isFile() && (absolute.endsWith('.md') || absolute.endsWith('.json'))) {
      files.push(absolute);
    }
  }

  return files;
}

describe('asset lint', () => {
  it('rejects forbidden portability and placeholder-regression patterns', () => {
    const files = listTextAssets(ASSETS_DIR);
    const failures = [];

    for (const filePath of files) {
      const rel = path.relative(path.join(__dirname, '..'), filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      if (/(?<![a-zA-Z0-9_$>])\/\.kiln\//.test(content)) {
        failures.push(`${rel}: contains bare root-anchored '/.kiln/' segment`);
      }
      if (/(?<![a-zA-Z0-9_$>])\/\.claude\//.test(content)) {
        failures.push(`${rel}: contains bare root-anchored '/.claude/' segment`);
      }

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();

        if (/^-C(?:\s*\\)?$/.test(trimmed) || /\s-C\s*(?:\\\s*)?$/.test(line)) {
          failures.push(`${rel}:${i + 1}: blank -C argument`);
        }
        if (/^-o(?:\s*\\)?$/.test(trimmed) || /\s-o\s*(?:\\\s*)?$/.test(line)) {
          failures.push(`${rel}:${i + 1}: blank -o argument`);
        }
        if (/<\s*>/.test(line) || /\$\{\s*\}/.test(line) || /\[\s*<\s*>\s*\]/.test(line)) {
          failures.push(`${rel}:${i + 1}: obvious placeholder-erased pattern`);
        }
      }
    }

    assert.deepStrictEqual(failures, []);
  });
});
