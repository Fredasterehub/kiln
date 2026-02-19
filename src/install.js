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

/**
 * @param {object}  [opts={}]
 * @param {string}  [opts.home]        - override home directory (default: os.homedir() via resolvePaths)
 * @param {boolean} [opts.force=false] - overwrite user-edited files when true
 * @param {string}  [opts.projectPath] - project root whose CLAUDE.md receives the protocol block
 *                                       (default: process.cwd())
 * @returns {{ installed: string[], skipped: string[], version: string }}
 */
function install({ home, force = false, projectPath } = {}) {
  const { agentsDir, commandsDir, kilntwoDir, skillsDir, templatesDir } = resolvePaths(home);

  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.mkdirSync(kilntwoDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });

  const installed = [];
  const skipped = [];

  const copyJobs = [
    { srcDir: path.join(ASSETS_DIR, 'agents'), destDir: agentsDir },
    { srcDir: path.join(ASSETS_DIR, 'commands', 'kiln'), destDir: commandsDir },
    { srcDir: path.join(ASSETS_DIR, 'skills'), destDir: skillsDir },
    { srcDir: path.join(ASSETS_DIR, 'templates'), destDir: templatesDir },
  ];

  for (const { srcDir, destDir } of copyJobs) {
    let filenames;
    try {
      filenames = fs.readdirSync(srcDir).filter((entry) => entry.endsWith('.md')).sort();
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
