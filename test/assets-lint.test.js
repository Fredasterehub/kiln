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

// Extract the $KILN_DIR/ subdirectory names from the protocol Working Directory Structure.
function extractProtocolDirs() {
  const protocol = fs.readFileSync(path.join(ASSETS_DIR, 'protocol.md'), 'utf8');
  const treeMatch = protocol.match(/\$KILN_DIR\/\n([\s\S]*?)```/);
  if (!treeMatch) return [];
  const dirs = [];
  const dirRegex = /^\s{2}([a-z]+)\//gm;
  let m;
  while ((m = dirRegex.exec(treeMatch[1])) !== null) {
    dirs.push(m[1]);
  }
  return dirs;
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

  it('agent $KILN_DIR/<subdir>/ references exist in protocol directory tree', () => {
    const protocolDirs = extractProtocolDirs();
    assert.ok(protocolDirs.length > 0, 'Protocol must define at least one $KILN_DIR subdirectory');

    // Scan only agent files for $KILN_DIR/<subdir>/ references
    const agentDir = path.join(ASSETS_DIR, 'agents');
    const agentFiles = listTextAssets(agentDir);
    const failures = [];

    for (const filePath of agentFiles) {
      const rel = path.relative(path.join(__dirname, '..'), filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const subdirRegex = /\$KILN_DIR\/([a-z]+)\//g;
      let match;
      while ((match = subdirRegex.exec(content)) !== null) {
        const subdir = match[1];
        if (!protocolDirs.includes(subdir)) {
          failures.push(`${rel}: references $KILN_DIR/${subdir}/ which is not in protocol directory tree`);
        }
      }
    }

    assert.deepStrictEqual(failures, []);
  });
});
