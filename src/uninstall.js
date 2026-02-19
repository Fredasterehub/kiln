'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { resolvePaths } = require('./paths');
const { readManifest, validateManifest } = require('./manifest');
const { removeProtocol } = require('./markers');

function resolveManifestClaudeMdPath(manifest) {
  if (manifest && typeof manifest.claudeMdPath === 'string' && manifest.claudeMdPath.length > 0) {
    return manifest.claudeMdPath;
  }

  if (
    manifest &&
    manifest.installTarget &&
    typeof manifest.installTarget.claudeMdPath === 'string' &&
    manifest.installTarget.claudeMdPath.length > 0
  ) {
    return manifest.installTarget.claudeMdPath;
  }

  if (manifest && typeof manifest.projectPath === 'string' && manifest.projectPath.length > 0) {
    return path.join(manifest.projectPath, 'CLAUDE.md');
  }

  if (
    manifest &&
    manifest.installTarget &&
    typeof manifest.installTarget.projectPath === 'string' &&
    manifest.installTarget.projectPath.length > 0
  ) {
    return path.join(manifest.installTarget.projectPath, 'CLAUDE.md');
  }

  return null;
}

function uninstall({ home } = {}) {
  const paths = resolvePaths(home ? home : undefined);
  const { commandsDir, kilntwoDir, templatesDir, manifestPath } = paths;

  const manifest = readManifest({ manifestPath });
  if (manifest === null) {
    return { error: 'not-installed' };
  }

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid manifest: ${validation.errors.join('; ')}`);
  }

  const removed = [];
  const notFound = [];

  for (const file of manifest.files) {
    if (file.path.includes('..')) {
      throw new Error(`Manifest entry contains path traversal: ${file.path}`);
    }
    const absolutePath = path.resolve(paths.claudeDir, file.path);
    if (!absolutePath.startsWith(paths.claudeDir + path.sep)) {
      throw new Error(`Refusing to operate outside claude directory: ${file.path}`);
    }
    try {
      fs.unlinkSync(absolutePath);
      removed.push(absolutePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        notFound.push(absolutePath);
        continue;
      }
      throw error;
    }
  }

  const claudeMdPath = resolveManifestClaudeMdPath(manifest);
  if (claudeMdPath !== null) {
    removeProtocol(claudeMdPath);
  }

  for (const dirPath of [templatesDir, kilntwoDir, commandsDir]) {
    try {
      fs.rmdirSync(dirPath);
    } catch (error) {
      if (
        error &&
        (error.code === 'ENOENT' ||
          error.code === 'ENOTEMPTY' ||
          error.code === 'EEXIST')
      ) {
        continue;
      }
      throw error;
    }
  }

  try {
    fs.unlinkSync(manifestPath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  return { removed, notFound };
}

module.exports = { uninstall };
