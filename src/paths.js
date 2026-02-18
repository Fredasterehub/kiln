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
    templatesDir: path.join(kilntwoDir, 'templates'),
    manifestPath: path.join(kilntwoDir, 'manifest.json'),
  };
}

function encodeProjectPath(absolutePath) {
  return absolutePath.split(path.sep).join('-');
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
