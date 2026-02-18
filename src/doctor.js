'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { resolvePaths } = require('./paths');
const { readManifest, computeChecksum } = require('./manifest');

function doctor({ home, strict } = {}) {
  const checks = [];
  const paths = resolvePaths(home);

  // a. node-version
  const nodeVersion = process.versions.node;
  const major = Number.parseInt(String(nodeVersion).split('.')[0], 10);
  if (major >= 18) {
    checks.push({
      name: 'node-version',
      status: 'pass',
      message: `Node.js v${nodeVersion} (major ${major} >= 18)`,
    });
  } else {
    checks.push({
      name: 'node-version',
      status: 'fail',
      message: `Node.js v${nodeVersion} is below the required v18`,
    });
  }

  // b. claude-cli
  try {
    execSync('which claude', { stdio: 'ignore' });
    checks.push({ name: 'claude-cli', status: 'pass', message: 'claude CLI found' });
  } catch {
    checks.push({
      name: 'claude-cli',
      status: 'fail',
      message: 'claude CLI not found — install via npm i -g @anthropic-ai/claude-code',
    });
  }

  // c. codex-cli
  try {
    execSync('which codex', { stdio: 'ignore' });
    checks.push({ name: 'codex-cli', status: 'pass', message: 'codex CLI found' });
  } catch {
    checks.push({
      name: 'codex-cli',
      status: 'fail',
      message: 'codex CLI not found — install via npm i -g @openai/codex',
    });
  }

  // d. claude-dir
  try {
    fs.accessSync(paths.claudeDir, fs.constants.W_OK);
    checks.push({
      name: 'claude-dir',
      status: 'pass',
      message: '~/.claude/ exists and is writable',
    });
  } catch {
    checks.push({
      name: 'claude-dir',
      status: 'fail',
      message: '~/.claude/ is missing or not writable',
    });
  }

  // e. teams-enabled
  const settingsPath = path.join(paths.claudeDir, 'settings.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (parsed && parsed.teams) {
      checks.push({ name: 'teams-enabled', status: 'pass', message: 'teams settings found' });
    } else {
      checks.push({
        name: 'teams-enabled',
        status: 'warn',
        message: '~/.claude/settings.json not found or teams not configured (non-fatal)',
      });
    }
  } catch {
    checks.push({
      name: 'teams-enabled',
      status: 'warn',
      message: '~/.claude/settings.json not found or teams not configured (non-fatal)',
    });
  }

  // f. manifest
  const manifestPath = paths.manifestPath;
  const manifest = readManifest({ manifestPath });
  if (manifest) {
    checks.push({ name: 'manifest', status: 'pass', message: 'manifest found and valid' });
  } else {
    checks.push({
      name: 'manifest',
      status: 'warn',
      message: 'manifest not found — run kilntwo install first',
    });
  }

  // g. checksums (strict only)
  if (strict) {
    const strictManifest = readManifest({ manifestPath });
    if (!strictManifest) {
      checks.push({
        name: 'checksums',
        status: 'warn',
        message: 'manifest not found — skipping checksum verification',
      });
    } else {
      const files = Array.isArray(strictManifest.files) ? strictManifest.files : [];
      const total = files.length;
      let mismatches = 0;

      for (const file of files) {
        try {
          const actual = computeChecksum(path.join(paths.claudeDir, file.path));
          if (actual !== file.checksum) mismatches += 1;
        } catch {
          mismatches += 1;
        }
      }

      if (mismatches === 0) {
        checks.push({
          name: 'checksums',
          status: 'pass',
          message: `all ${total} file(s) match their checksums`,
        });
      } else {
        checks.push({
          name: 'checksums',
          status: 'warn',
          message: `${mismatches} of ${total} file(s) have checksum mismatches`,
        });
      }
    }
  }

  const ok = checks.every((c) => c.status !== 'fail');
  return { ok, checks };
}

module.exports = { doctor };
