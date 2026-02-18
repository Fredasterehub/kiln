'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolvePaths } = require('./paths');
const { writeManifest, computeChecksum, readManifest } = require('./manifest');
const { insertProtocol } = require('./markers');
const VERSION = require('../package.json').version;
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

/**
 * @param {object}  [opts={}]
 * @param {string}  [opts.home]        - override home directory (default: os.homedir() via resolvePaths)
 * @param {boolean} [opts.force=false] - overwrite user-edited files when true
 * @param {string}  [opts.projectPath] - project root whose CLAUDE.md receives the protocol block
 *                                       (default: process.cwd())
 * @returns {{ installed: string[], skipped: string[], version: string }}
 */
function install({ home, force = false, projectPath } = {}) {
  const { agentsDir, commandsDir, kilntwoDir, templatesDir } = resolvePaths(home);

  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.mkdirSync(kilntwoDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });

  const priorManifest = readManifest(home) || { files: [] };
  if (!Array.isArray(priorManifest.files)) priorManifest.files = [];

  const installed = [];
  const skipped = [];

  const copyJobs = [
    { srcDir: path.join(ASSETS_DIR, 'agents'), destDir: agentsDir },
    { srcDir: path.join(ASSETS_DIR, 'commands', 'kiln'), destDir: commandsDir },
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

  const resolvedProject = projectPath || process.cwd();
  const claudeMdPath = path.join(resolvedProject, 'CLAUDE.md');
  const protocolSrc = path.join(ASSETS_DIR, 'protocol.md');
  const protocolContent = fs.readFileSync(protocolSrc, 'utf8');
  insertProtocol(claudeMdPath, protocolContent, VERSION);

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
  }, home);

  return { installed, skipped, version: VERSION };
}

module.exports = {
  install, // ({ home?, force?, projectPath? }?) => { installed: string[], skipped: string[], version: string }
};
