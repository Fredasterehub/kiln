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

function removeKilnHookRegistrations(claudeDir) {
  const settingsFiles = [
    path.join(claudeDir, 'settings.json'),
    path.join(claudeDir, 'settings.local.json'),
  ];
  const hookNameNeedles = [
    'enforce-kiln-spawn-map.js',
    'enforce-kiln-coordinator-discipline.js',
    'enforce-kiln-maestro-discipline.js',
  ];

  for (const settingsPath of settingsFiles) {
    if (!fs.existsSync(settingsPath)) continue;

    let json;
    try {
      json = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      continue;
    }

    if (!json.hooks || !Array.isArray(json.hooks.PreToolUse)) continue;

    json.hooks.PreToolUse = json.hooks.PreToolUse
      .map((entry) => {
        if (!entry || !Array.isArray(entry.hooks)) return entry;
        const hooks = entry.hooks.filter((hook) => {
          const cmd = String(hook && hook.command ? hook.command : '');
          return !hookNameNeedles.some((needle) => cmd.includes(needle));
        });
        return { ...entry, hooks };
      })
      .filter((entry) => entry && Array.isArray(entry.hooks) && entry.hooks.length > 0);

    fs.writeFileSync(settingsPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  }
}

function uninstall({ home } = {}) {
  const paths = resolvePaths(home ? home : undefined);
  const { claudeDir, commandsDir, hooksDir, kilntwoDir, skillsDir, templatesDir, manifestPath } = paths;

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
  removeKilnHookRegistrations(claudeDir);

  for (const dirPath of [templatesDir, skillsDir, hooksDir, kilntwoDir, commandsDir]) {
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
