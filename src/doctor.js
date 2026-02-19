'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { resolvePaths } = require('./paths');
const { readManifest, computeChecksum, validateManifest } = require('./manifest');

function checkCliAvailable(cliName, { platform = process.platform, exec = execSync } = {}) {
  const lookupCommand = platform === 'win32' ? `where ${cliName}` : `command -v ${cliName}`;
  try {
    exec(lookupCommand, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function doctor({ home, strict, platform = process.platform, exec = execSync } = {}) {
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
  if (checkCliAvailable('claude', { platform, exec })) {
    checks.push({ name: 'claude-cli', status: 'pass', message: 'claude CLI found' });
  } else {
    checks.push({
      name: 'claude-cli',
      status: 'fail',
      message: 'claude CLI not found — install via npm i -g @anthropic-ai/claude-code',
    });
  }

  // c. codex-cli
  if (checkCliAvailable('codex', { platform, exec })) {
    checks.push({ name: 'codex-cli', status: 'pass', message: 'codex CLI found' });
  } else {
    checks.push({
      name: 'codex-cli',
      status: 'fail',
      message: 'codex CLI not found — install via npm i -g @openai/codex',
    });
  }

  // c2. git-cli
  if (checkCliAvailable('git', { platform, exec })) {
    checks.push({ name: 'git-cli', status: 'pass', message: 'git CLI found' });
  } else {
    checks.push({
      name: 'git-cli',
      status: 'fail',
      message: 'git CLI not found — pipeline requires git for branch management',
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
    const validation = validateManifest(manifest);
    if (validation.valid) {
      checks.push({ name: 'manifest', status: 'pass', message: 'manifest found and valid' });
    } else {
      checks.push({
        name: 'manifest',
        status: 'fail',
        message: `manifest is invalid: ${validation.errors.join('; ')}`,
      });
    }
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
      const strictValidation = validateManifest(strictManifest);
      if (!strictValidation.valid) {
        checks.push({
          name: 'checksums',
          status: 'fail',
          message: `skipped — manifest is invalid: ${strictValidation.errors.join('; ')}`,
        });
      } else {
        const files = Array.isArray(strictManifest.files) ? strictManifest.files : [];
        const total = files.length;
        let mismatches = 0;

        for (const file of files) {
          const checkedPath = path.resolve(paths.claudeDir, file.path);
          if (!checkedPath.startsWith(paths.claudeDir + path.sep)) {
            checks.push({
              name: 'checksums',
              status: 'fail',
              message: `path escapes claude directory: ${file.path}`,
            });
            mismatches = -1;
            break;
          }
          try {
            const actual = computeChecksum(checkedPath);
            if (actual !== file.checksum) mismatches += 1;
          } catch {
            mismatches += 1;
          }
        }

        if (mismatches === -1) {
          // already pushed a fail check above
        } else if (mismatches === 0) {
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
  }

  const ok = checks.every((c) => c.status !== 'fail');
  return { ok, checks };
}

module.exports = { doctor };
