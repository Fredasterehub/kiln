'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BEGIN_RE = /<!-- kiln:protocol:begin v([\d.]+) -->/;
const END_RE = /<!-- kiln:protocol:end -->/;

function buildBlock(content, version) {
  const inner = content.endsWith('\n') ? content : `${content}\n`;
  return `<!-- kiln:protocol:begin v${version} -->\n${inner}<!-- kiln:protocol:end -->\n`;
}

function findBlock(text) {
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const beginMatch = lines[i].match(BEGIN_RE);
    if (!beginMatch) {
      continue;
    }

    for (let j = i; j < lines.length; j += 1) {
      if (END_RE.test(lines[j])) {
        return {
          start: i,
          end: j,
          version: beginMatch[1],
        };
      }
    }

    return null;
  }

  return null;
}

function replaceProtocol(filePath, content, version) {
  const text = fs.readFileSync(filePath, 'utf8');
  const block = findBlock(text);

  if (!block) {
    throw new Error(`kiln: no protocol block found in ${filePath}`);
  }

  const lines = text.split('\n');
  const replacementLines = buildBlock(content, version).split('\n');

  if (replacementLines[replacementLines.length - 1] === '') {
    replacementLines.pop();
  }

  lines.splice(block.start, block.end - block.start + 1, ...replacementLines);

  const next = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  fs.writeFileSync(filePath, next, 'utf8');
}

function insertProtocol(filePath, content, version) {
  const block = buildBlock(content, version);

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, block, 'utf8');
    return;
  }

  const text = fs.readFileSync(filePath, 'utf8');
  if (findBlock(text)) {
    replaceProtocol(filePath, content, version);
    return;
  }

  const base = text.replace(/\n+$/, '');
  const next = base.length === 0 ? block : `${base}\n${block}`;
  fs.writeFileSync(filePath, next, 'utf8');
}

/**
 * Removes the KilnTwo protocol block from a CLAUDE.md file.
 * No-op (does not throw) when the file does not exist or contains no protocol block,
 * as required by uninstall.js which calls this unconditionally.
 */
function removeProtocol(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const text = fs.readFileSync(filePath, 'utf8');
  const block = findBlock(text);

  if (!block) {
    return;
  }

  const lines = text.split('\n');
  lines.splice(block.start, block.end - block.start + 1);

  const next = lines.join('\n');
  if (next.trim().length === 0) {
    fs.unlinkSync(filePath);
    return;
  }

  fs.writeFileSync(filePath, `${next.replace(/\s+$/, '')}\n`, 'utf8');
}

function hasProtocol(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    return findBlock(fs.readFileSync(filePath, 'utf8')) !== null;
  } catch (_) {
    return false;
  }
}

function extractVersion(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const block = findBlock(fs.readFileSync(filePath, 'utf8'));
    return block ? block.version : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  insertProtocol,
  replaceProtocol,
  removeProtocol,
  hasProtocol,
  extractVersion,
};
