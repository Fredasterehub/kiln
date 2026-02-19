'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolvePaths } = require('./paths.js');
const { readManifest, computeChecksum } = require('./manifest.js');
const { install }      = require('./install.js');
const currentVersion   = require('../package.json').version;

function sortPaths(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function resolveManifestProjectPath(manifest) {
  if (manifest && typeof manifest.projectPath === 'string' && manifest.projectPath.length > 0) {
    return manifest.projectPath;
  }

  if (manifest && typeof manifest.claudeMdPath === 'string' && manifest.claudeMdPath.length > 0) {
    return path.dirname(manifest.claudeMdPath);
  }

  if (
    manifest &&
    manifest.installTarget &&
    typeof manifest.installTarget.projectPath === 'string' &&
    manifest.installTarget.projectPath.length > 0
  ) {
    return manifest.installTarget.projectPath;
  }

  if (
    manifest &&
    manifest.installTarget &&
    typeof manifest.installTarget.claudeMdPath === 'string' &&
    manifest.installTarget.claudeMdPath.length > 0
  ) {
    return path.dirname(manifest.installTarget.claudeMdPath);
  }

  return null;
}

function buildPreviousChecksumMap(manifest, home) {
  const previousState = new Map();
  const files = Array.isArray(manifest && manifest.files) ? manifest.files : [];
  const { claudeDir } = resolvePaths(home);

  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.checksum !== 'string') {
      continue;
    }
    const absolutePath = path.join(claudeDir, file.path);
    previousState.set(absolutePath, {
      checksum: file.checksum,
      existed: fs.existsSync(absolutePath),
    });
  }

  return previousState;
}

async function update({ home, force } = {}) {
  const manifest = readManifest(home);

  if (!manifest) {
    return { error: 'not-installed', hint: 'Run kilntwo install first' };
  }

  const previousState = buildPreviousChecksumMap(manifest, home);
  const targetProjectPath = resolveManifestProjectPath(manifest);
  const oldVersion = manifest.kilnVersion;
  const installResult = install({
    home,
    force: Boolean(force),
    projectPath: targetProjectPath || undefined,
  });
  const installed = sortPaths(
    Array.isArray(installResult.installed) ? installResult.installed : []
  );
  const skipped = sortPaths(
    Array.isArray(installResult.skipped) ? installResult.skipped : []
  );
  const updated = [];
  const unchanged = [];

  for (const installedPath of installed) {
    const prior = previousState.get(installedPath);
    const nextChecksum = computeChecksum(installedPath);
    if (!prior || prior.existed === false || prior.checksum !== nextChecksum) {
      updated.push(installedPath);
    } else {
      unchanged.push(installedPath);
    }
  }

  if (oldVersion === currentVersion && updated.length === 0 && skipped.length === 0) {
    return { status: 'up-to-date', version: currentVersion, unchanged };
  }

  const updates = [
    ...updated.map((filePath) => ({ path: filePath, status: 'updated' })),
    ...skipped.map((filePath) => ({ path: filePath, status: 'skipped' })),
  ].sort((a, b) => a.path.localeCompare(b.path));

  return {
    status:    'updated',
    from:      oldVersion,
    to:        currentVersion,
    updates,
    updated,
    skipped,
    unchanged,
    installed,
  };
}

module.exports = { update };
