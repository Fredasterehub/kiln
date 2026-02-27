'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolvePaths } = require('./paths');
const { writeManifest, computeChecksum } = require('./manifest');
const { insertProtocol } = require('./markers');
const VERSION = require('../package.json').version;
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function resolveInstallTarget(projectPath) {
  const resolvedProjectPath = path.resolve(projectPath || process.cwd());
  return {
    projectPath: resolvedProjectPath,
    claudeMdPath: path.join(resolvedProjectPath, 'CLAUDE.md'),
  };
}

function ensurePreToolUseHook(settingsPath, matcher, command, timeout = 5) {
  let settings;
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      settings = {};
    }
  } else {
    settings = {};
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks.PreToolUse)) {
    settings.hooks.PreToolUse = [];
  }

  let entry = settings.hooks.PreToolUse.find((item) => item && item.matcher === matcher);
  if (!entry) {
    entry = { matcher, hooks: [] };
    settings.hooks.PreToolUse.push(entry);
  }
  if (!Array.isArray(entry.hooks)) {
    entry.hooks = [];
  }

  const exists = entry.hooks.some((hook) => hook && hook.command === command);
  if (!exists) {
    entry.hooks.push({
      type: 'command',
      command,
      timeout,
    });
  }

  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function registerKilnHooks(home, preToolUseHooksDir) {
  const claudeDir = path.join(home || require('node:os').homedir(), '.claude');
  const settingsFiles = [
    path.join(claudeDir, 'settings.json'),
    path.join(claudeDir, 'settings.local.json'),
  ];

  const spawnMapCommand = `node "${path.join(preToolUseHooksDir, 'enforce-kiln-spawn-map.js').replace(/\\/g, '/')}"`;
  const coordinatorCommand = `node "${path.join(preToolUseHooksDir, 'enforce-kiln-coordinator-discipline.js').replace(/\\/g, '/')}"`;
  const maestroCommand = `node "${path.join(preToolUseHooksDir, 'enforce-kiln-maestro-discipline.js').replace(/\\/g, '/')}"`;

  for (const settingsPath of settingsFiles) {
    ensurePreToolUseHook(settingsPath, 'Task', spawnMapCommand, 5);
    ensurePreToolUseHook(settingsPath, 'Bash|Edit|Write|MultiEdit', coordinatorCommand, 5);
    ensurePreToolUseHook(settingsPath, 'Bash|Edit|Write|MultiEdit', maestroCommand, 5);
  }
}

/**
 * @param {object}  [opts={}]
 * @param {string}  [opts.home]        - override home directory (default: os.homedir() via resolvePaths)
 * @param {boolean} [opts.force=false] - overwrite user-edited files when true
 * @param {string}  [opts.projectPath] - project root whose CLAUDE.md receives the protocol block
 *                                       (default: process.cwd())
 * @returns {{ installed: string[], skipped: string[], version: string }}
 */
function install({ home, force = false, projectPath } = {}) {
  const {
    agentsDir,
    commandsDir,
    dataDir,
    hooksDir,
    preToolUseHooksDir,
    kilntwoDir,
    skillsDir,
    templatesDir,
  } = resolvePaths(home);

  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(preToolUseHooksDir, { recursive: true });
  fs.mkdirSync(kilntwoDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });

  const installed = [];
  const skipped = [];

  const copyJobs = [
    { srcDir: path.join(ASSETS_DIR, 'agents'), destDir: agentsDir, ext: '.md' },
    { srcDir: path.join(ASSETS_DIR, 'commands', 'kiln'), destDir: commandsDir, ext: '.md' },
    { srcDir: path.join(ASSETS_DIR, 'data'), destDir: dataDir, ext: '.json' },
    { srcDir: path.join(ASSETS_DIR, 'hooks', 'pre-tool-use'), destDir: preToolUseHooksDir, ext: '.js' },
    { srcDir: path.join(ASSETS_DIR, 'skills'), destDir: skillsDir, ext: '.md' },
    { srcDir: path.join(ASSETS_DIR, 'templates'), destDir: templatesDir, ext: '.md' },
  ];

  for (const { srcDir, destDir, ext } of copyJobs) {
    let filenames;
    try {
      filenames = fs.readdirSync(srcDir).filter((entry) => entry.endsWith(ext)).sort();
    } catch {
      continue;
    }

    for (const filename of filenames) {
      const srcPath = path.join(srcDir, filename);
      const destPath = path.join(destDir, filename);

      if (force) {
        fs.copyFileSync(srcPath, destPath);
        installed.push(destPath);
        continue;
      }

      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
        installed.push(destPath);
        continue;
      }

      const destChecksum = computeChecksum(destPath);
      const srcChecksum = computeChecksum(srcPath);

      if (destChecksum === srcChecksum) {
        installed.push(destPath);
      } else {
        console.error(`[kiln] skipping ${destPath} (user-edited; use --force to overwrite)`);
        skipped.push(destPath);
      }
    }
  }

  // Remove legacy kw-* agent files from a prior naming era
  try {
    const agentFiles = fs.readdirSync(agentsDir);
    for (const file of agentFiles) {
      if (file.startsWith('kw-') && file.endsWith('.md')) {
        const legacyPath = path.join(agentsDir, file);
        try {
          fs.unlinkSync(legacyPath);
          console.error(`[kiln] removing legacy agent: ${file}`);
        } catch {
          // per-file deletion failure — not fatal, continue with remaining files
        }
      }
    }
  } catch {
    // agentsDir read failed — not fatal
  }

  // Copy names.json to kilntwoDir
  const namesSrc = path.join(ASSETS_DIR, 'names.json');
  const namesDest = path.join(kilntwoDir, 'names.json');
  if (force || !fs.existsSync(namesDest)) {
    fs.copyFileSync(namesSrc, namesDest);
    installed.push(namesDest);
  } else {
    const destChecksum = computeChecksum(namesDest);
    const srcChecksum = computeChecksum(namesSrc);
    if (destChecksum === srcChecksum) {
      installed.push(namesDest);
    } else {
      console.error(`[kiln] skipping ${namesDest} (user-edited; use --force to overwrite)`);
      skipped.push(namesDest);
    }
  }

  const installTarget = resolveInstallTarget(projectPath);
  const protocolSrc = path.join(ASSETS_DIR, 'protocol.md');
  const protocolContent = fs.readFileSync(protocolSrc, 'utf8');
  insertProtocol(installTarget.claudeMdPath, protocolContent, VERSION);
  registerKilnHooks(home, preToolUseHooksDir);

  const paths = resolvePaths(home);
  const files = installed.map((destPath) => ({
    path: path.relative(paths.claudeDir, destPath),
    checksum: computeChecksum(destPath),
  }));
  writeManifest({
    manifestVersion: 1,
    kilnVersion: VERSION,
    installedAt: new Date().toISOString(),
    files,
    protocolMarkers: {
      begin: 'kiln:protocol:begin',
      end: 'kiln:protocol:end',
    },
    projectPath: installTarget.projectPath,
    claudeMdPath: installTarget.claudeMdPath,
  }, home);

  return { installed, skipped, version: VERSION };
}

module.exports = {
  install, // ({ home?, force?, projectPath? }?) => { installed: string[], skipped: string[], version: string }
};
