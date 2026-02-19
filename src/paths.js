const path = require('node:path');
const os = require('node:os');

function resolvePaths(homeOverride) {
  const home = homeOverride || os.homedir();
  const claudeDir = path.join(home, '.claude');
  const kilntwoDir = path.join(claudeDir, 'kilntwo');

  return {
    claudeDir,
    agentsDir: path.join(claudeDir, 'agents'),
    commandsDir: path.join(claudeDir, 'commands', 'kiln'),
    kilntwoDir,
    skillsDir: path.join(kilntwoDir, 'skills'),
    templatesDir: path.join(kilntwoDir, 'templates'),
    manifestPath: path.join(kilntwoDir, 'manifest.json'),
  };
}

// WARNING: This encoding is lossy — different absolute paths can produce the
// same encoded result (e.g. '/a/b-c' and '/a-b/c' both become '-a-b-c').
// A collision-resistant encoding is deferred to v0.2.0.
function encodeProjectPath(absolutePath) {
  return String(absolutePath)
    .replace(/[\\/]+/g, '-')
    .replace(/[:*?"<>|]/g, '-')
    .replace(/-+/g, '-');
}

function projectMemoryDir(homeOverride, projectPath) {
  const home = homeOverride || os.homedir();
  return path.join(
    home,
    '.claude',
    'projects',
    encodeProjectPath(projectPath),
    'memory'
  );
}

function projectClaudeMd(projectPath) {
  return path.join(projectPath, 'CLAUDE.md');
}

module.exports = {
  resolvePaths,
  encodeProjectPath,
  projectMemoryDir,
  projectClaudeMd,
};
