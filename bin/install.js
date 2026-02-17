#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const USAGE = `
kiln-one \u2014 Multi-model orchestration workflow for Claude Code

Usage:
  npx kiln-one [options]

Options:
  --help                Show this help message and exit
  --repo-root <path>    Target repository root (default: current directory)
  --yes, -y             Non-interactive mode (accept defaults)
  --force               Overwrite existing files that differ (update mode)
  --global              Install Claude assets into ~/.claude/

Examples:
  npx kiln-one
  npx kiln-one --repo-root /path/to/project
  npx kiln-one --repo-root /path/to/project --yes
`.trim();

const IGNITION_QUOTES = [
  { text: 'The creation of a thousand forests is in one acorn.', by: 'Ralph Waldo Emerson' },
  { text: 'Every new beginning comes from some other beginning\'s end.', by: 'Seneca' },
  { text: 'A journey of a thousand miles begins with a single step.', by: 'Lao Tzu' },
  { text: 'Imagination is more important than knowledge. For knowledge is limited, whereas imagination embraces the entire world.', by: 'Albert Einstein' },
  { text: 'In every curving beach, in every grain of sand there is the story of the earth.', by: 'Rachel Carson' }
];

function fatal(message, code) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    help: false,
    yes: false,
    force: false,
    global: false,
    repoRoot: process.cwd()
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help') {
      out.help = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      out.yes = true;
      continue;
    }
    if (arg === '--force') {
      out.force = true;
      continue;
    }
    if (arg === '--global') {
      out.global = true;
      continue;
    }
    if (arg === '--repo-root') {
      if (!args[i + 1]) {
        fatal('Missing value for --repo-root\n\n' + USAGE, 1);
      }
      out.repoRoot = path.resolve(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--repo-root=')) {
      out.repoRoot = path.resolve(arg.slice('--repo-root='.length));
      continue;
    }
    fatal(`Unknown option: ${arg}\n\n${USAGE}`, 1);
  }

  return out;
}

function ensureNodeVersion() {
  const major = Number(String(process.versions.node || '').split('.')[0] || 0);
  if (Number.isNaN(major) || major < 18) {
    fatal(
      `kiln-one requires Node.js 18 or newer (found ${process.versions.node || 'unknown'})`,
      1
    );
  }
}

function detectCodexCli() {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(cmd, ['codex'], { stdio: 'ignore' });
    return result.status === 0;
  } catch (_err) {
    return false;
  }
}

function createPrompter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  function prompt(question) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer));
    });
  }

  async function yesNo(question, defaultYes) {
    const defaultHint = defaultYes ? 'Y/n' : 'y/N';
    const answer = String(await prompt(`${question} (${defaultHint}) `)).trim().toLowerCase();
    if (!answer) {
      return defaultYes;
    }
    if (answer === 'y' || answer === 'yes') {
      return true;
    }
    if (answer === 'n' || answer === 'no') {
      return false;
    }
    return defaultYes;
  }

  function close() {
    rl.close();
  }

  return { prompt, yesNo, close };
}

function readJson(filePath, fallbackValue) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_err) {
    return fallbackValue;
  }
}

function isFileIdentical(src, dest) {
  try {
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dest);
    return a.equals(b);
  } catch (_err) {
    return false;
  }
}

function copyFileManaged(srcFile, destFile, stats, warnings, force) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  if (!fs.existsSync(destFile)) {
    fs.copyFileSync(srcFile, destFile);
    stats.copied += 1;
    return;
  }

  if (isFileIdentical(srcFile, destFile)) {
    stats.skipped += 1;
    return;
  }

  if (force) {
    fs.copyFileSync(srcFile, destFile);
    stats.copied += 1;
    return;
  }

  stats.conflicts += 1;
  warnings.push(`Conflict at ${destFile} (existing file differs, left unchanged)`);
}

function copyDir(srcDir, destDir, stats, warnings, force) {
  if (!fs.existsSync(srcDir)) {
    warnings.push(`Missing source directory: ${srcDir}`);
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, stats, warnings, force);
      continue;
    }
    if (entry.isFile()) {
      copyFileManaged(srcPath, destPath, stats, warnings, force);
    }
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${parts.join(',')}}`;
}

function hooksByEvent(hooksObj) {
  const out = {};
  const hooks = hooksObj && hooksObj.hooks;

  if (Array.isArray(hooks)) {
    for (const hook of hooks) {
      if (!hook || typeof hook !== 'object' || Array.isArray(hook)) {
        continue;
      }
      const event = typeof hook.event === 'string' ? hook.event : '';
      if (!event) {
        continue;
      }
      if (!Array.isArray(out[event])) {
        out[event] = [];
      }
      const { event: _event, ...entry } = hook;
      out[event].push(entry);
    }
    return out;
  }

  if (!hooks || typeof hooks !== 'object') {
    return out;
  }

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    out[event] = entries.filter(
      (entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    );
  }
  return out;
}

function mergeHooksJson(existingHooksObj, kilnHooksObj) {
  const existingByEvent = hooksByEvent(existingHooksObj);
  const kilnByEvent = hooksByEvent(kilnHooksObj);

  const allEvents = new Set([...Object.keys(existingByEvent), ...Object.keys(kilnByEvent)]);
  const merged = {};

  for (const event of allEvents) {
    const mergedEntries = [];
    const seen = new Set();
    const combined = (existingByEvent[event] || []).concat(kilnByEvent[event] || []);
    for (const entry of combined) {
      const key = stableStringify(entry);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      mergedEntries.push(entry);
    }
    merged[event] = mergedEntries;
  }

  return { hooks: merged };
}

function detectProjectType(repoRoot) {
  const checks = [
    ['package.json', 'node'],
    ['Cargo.toml', 'rust'],
    ['go.mod', 'go'],
    ['pyproject.toml', 'python'],
    ['requirements.txt', 'python'],
    ['Gemfile', 'ruby'],
    ['pom.xml', 'java'],
    ['build.gradle', 'java'],
    ['Makefile', 'c-cpp']
  ];
  for (const [file, kind] of checks) {
    if (fs.existsSync(path.join(repoRoot, file))) {
      return kind;
    }
  }
  return 'greenfield';
}

function scriptOrNull(scripts, name) {
  if (!scripts || typeof scripts !== 'object') {
    return null;
  }
  const value = scripts[name];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function detectTooling(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return {
      testRunner: null,
      linter: null,
      typeChecker: null,
      buildSystem: null,
      startCommand: null
    };
  }

  const packageJson = readJson(packageJsonPath, {});
  const scripts = packageJson && packageJson.scripts ? packageJson.scripts : {};

  return {
    testRunner: scriptOrNull(scripts, 'test'),
    linter: scriptOrNull(scripts, 'lint'),
    typeChecker: scriptOrNull(scripts, 'typecheck') || scriptOrNull(scripts, 'check'),
    buildSystem: scriptOrNull(scripts, 'build'),
    startCommand: scriptOrNull(scripts, 'start') || scriptOrNull(scripts, 'dev')
  };
}

function renderStateTemplate(templateText, values) {
  let out = templateText;
  for (const [key, value] of Object.entries(values)) {
    const token = `{{${key}}}`;
    out = out.split(token).join(String(value));
  }
  return out;
}

function ensureGitignoreKiln(repoRoot, warnings) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return false;
  }

  const current = fs.readFileSync(gitignorePath, 'utf8');
  const lines = current.split(/\r?\n/);
  const hasKilnIgnore = lines.some((line) => line.trim() === '.kiln/' || line.trim() === '.kiln');
  if (hasKilnIgnore) {
    warnings.push(
      `${gitignorePath} ignores .kiln; remove this rule because .kiln/ should be committed`
    );
  }
  return hasKilnIgnore;
}

function resolveInstallRoots(repoRoot, useGlobal) {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!useGlobal) {
    return {
      claudeRoot: path.join(repoRoot, '.claude'),
      kilnRoot: path.join(repoRoot, '.kiln')
    };
  }
  if (!home) {
    fatal('Cannot resolve home directory for --global install (missing HOME/USERPROFILE)', 1);
  }
  return {
    claudeRoot: path.join(home, '.claude'),
    kilnRoot: path.join(repoRoot, '.kiln')
  };
}

function installAgents(sourceRoot, claudeRoot, warnings, force) {
  const srcAgentsDir = path.join(sourceRoot, 'agents');
  const destAgentsDir = path.join(claudeRoot, 'agents');
  const stats = { copied: 0, skipped: 0, conflicts: 0, scanned: 0 };

  if (!fs.existsSync(srcAgentsDir)) {
    warnings.push(`Missing source agents directory: ${srcAgentsDir}`);
    return stats;
  }

  fs.mkdirSync(destAgentsDir, { recursive: true });
  const entries = fs.readdirSync(srcAgentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    stats.scanned += 1;
    const srcFile = path.join(srcAgentsDir, entry.name);
    const destFile = path.join(destAgentsDir, entry.name);
    copyFileManaged(srcFile, destFile, stats, warnings, force);
  }
  return stats;
}

function installSkills(sourceRoot, claudeRoot, warnings, force) {
  const srcSkillsDir = path.join(sourceRoot, 'skills');
  const destSkillsDir = path.join(claudeRoot, 'skills');
  const stats = { copied: 0, skipped: 0, conflicts: 0, directories: 0 };

  if (!fs.existsSync(srcSkillsDir)) {
    warnings.push(`Missing source skills directory: ${srcSkillsDir}`);
    return stats;
  }

  fs.mkdirSync(destSkillsDir, { recursive: true });
  const entries = fs.readdirSync(srcSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    stats.directories += 1;
    const srcDir = path.join(srcSkillsDir, entry.name);
    const destDir = path.join(destSkillsDir, entry.name);
    copyDir(srcDir, destDir, stats, warnings, force);
  }

  return stats;
}

function installHooks(sourceRoot, claudeRoot, warnings, force) {
  const srcHooksDir = path.join(sourceRoot, 'hooks');
  const srcScriptsDir = path.join(srcHooksDir, 'scripts');
  const srcHooksJson = path.join(srcHooksDir, 'hooks.json');

  const destHooksDir = path.join(claudeRoot, 'hooks');
  const destScriptsDir = path.join(destHooksDir, 'scripts');
  const destHooksJson = path.join(destHooksDir, 'hooks.json');

  const stats = {
    scriptsCopied: 0,
    scriptsSkipped: 0,
    scriptsConflicts: 0,
    hookJsonStatus: 'skipped'
  };
  const scriptStats = { copied: 0, skipped: 0, conflicts: 0 };

  fs.mkdirSync(destScriptsDir, { recursive: true });

  if (fs.existsSync(srcScriptsDir)) {
    const entries = fs.readdirSync(srcScriptsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.sh')) {
        continue;
      }
      const srcFile = path.join(srcScriptsDir, entry.name);
      const destFile = path.join(destScriptsDir, entry.name);
      copyFileManaged(srcFile, destFile, scriptStats, warnings, force);
    }
  } else {
    warnings.push(`Missing source hook scripts directory: ${srcScriptsDir}`);
  }
  stats.scriptsCopied = scriptStats.copied;
  stats.scriptsSkipped = scriptStats.skipped;
  stats.scriptsConflicts = scriptStats.conflicts;

  if (!fs.existsSync(srcHooksJson)) {
    warnings.push(`Missing source hooks.json: ${srcHooksJson}`);
    return stats;
  }

  let kilnHooks = { hooks: {} };
  try {
    kilnHooks = JSON.parse(fs.readFileSync(srcHooksJson, 'utf8'));
  } catch (_err) {
    warnings.push(`Could not parse source hooks.json: ${srcHooksJson}`);
  }
  if (!fs.existsSync(destHooksJson)) {
    fs.writeFileSync(destHooksJson, JSON.stringify(kilnHooks, null, 2) + '\n', 'utf8');
    stats.hookJsonStatus = 'created';
    return stats;
  }

  let existingHooks = { hooks: {} };
  try {
    existingHooks = JSON.parse(fs.readFileSync(destHooksJson, 'utf8'));
  } catch (_err) {
    warnings.push(`Could not parse existing hooks.json, replacing with merged kiln hooks: ${destHooksJson}`);
  }
  const mergedHooks = mergeHooksJson(existingHooks, kilnHooks);
  fs.writeFileSync(destHooksJson, JSON.stringify(mergedHooks, null, 2) + '\n', 'utf8');
  stats.hookJsonStatus = 'merged';
  return stats;
}

function installCommands(sourceRoot, claudeRoot, warnings, force) {
  const srcCommandsDir = path.join(sourceRoot, 'commands');
  const destCommandsDir = path.join(claudeRoot, 'commands');
  const stats = { copied: 0, skipped: 0, conflicts: 0, directories: 0 };

  if (!fs.existsSync(srcCommandsDir)) {
    warnings.push(`Missing source commands directory: ${srcCommandsDir}`);
    return stats;
  }

  fs.mkdirSync(destCommandsDir, { recursive: true });
  const entries = fs.readdirSync(srcCommandsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    stats.directories += 1;
    const srcDir = path.join(srcCommandsDir, entry.name);
    const destDir = path.join(destCommandsDir, entry.name);
    copyDir(srcDir, destDir, stats, warnings, force);
  }

  return stats;
}

function installTemplates(sourceRoot, claudeRoot, warnings, force) {
  const srcTemplatesDir = path.join(sourceRoot, 'templates');
  const destTemplatesDir = path.join(claudeRoot, 'templates');
  const stats = { copied: 0, skipped: 0, conflicts: 0 };

  if (!fs.existsSync(srcTemplatesDir)) {
    warnings.push(`Missing source templates directory: ${srcTemplatesDir}`);
    return stats;
  }

  copyDir(srcTemplatesDir, destTemplatesDir, stats, warnings, force);
  return stats;
}

function initializeKiln(sourceRoot, repoRoot, kilnRoot, projectType, modelMode, tooling, useTeams, warnings) {
  fs.mkdirSync(kilnRoot, { recursive: true });
  fs.mkdirSync(path.join(kilnRoot, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(kilnRoot, 'tracks'), { recursive: true });

  const livingDocs = ['TECH_STACK.md', 'PATTERNS.md', 'DECISIONS.md', 'PITFALLS.md'];
  for (const doc of livingDocs) {
    const docPath = path.join(kilnRoot, 'docs', doc);
    if (!fs.existsSync(docPath)) {
      fs.writeFileSync(docPath, '', 'utf8');
    }
  }

  const configTemplatePath = path.join(sourceRoot, 'templates', 'config.json.tmpl');
  const stateTemplatePath = path.join(sourceRoot, 'templates', 'STATE.md.tmpl');

  const configPath = path.join(kilnRoot, 'config.json');
  const statePath = path.join(kilnRoot, 'STATE.md');

  if (!fs.existsSync(configPath)) {
    const configTemplate = readJson(configTemplatePath, {});
    configTemplate.projectType = projectType;
    configTemplate.modelMode = modelMode;
    configTemplate.tooling = tooling;
    configTemplate.preferences = configTemplate.preferences || {};
    configTemplate.preferences.useTeams = useTeams;
    fs.writeFileSync(configPath, JSON.stringify(configTemplate, null, 2) + '\n', 'utf8');
  } else {
    warnings.push(`Existing file preserved: ${configPath}`);
  }

  if (!fs.existsSync(statePath)) {
    const now = new Date().toISOString();
    const stateTemplate = fs.readFileSync(stateTemplatePath, 'utf8');
    const rendered = renderStateTemplate(stateTemplate, {
      project_name: path.basename(repoRoot),
      model_mode: modelMode,
      init_timestamp: now,
      current_phase_number: 1,
      current_phase_title: 'Initialization',
      current_step: 'plan',
      step_status: 'pending',
      step_started_timestamp: now,
      mini_verify_retries: 0,
      e2e_cycles: 0,
      review_cycles: 0,
      regression_test_count: 0,
      completed_phases_count: 0,
      last_activity_timestamp: now,
      last_completed_action: 'none',
      next_expected_action: 'Run /kiln:fire'
    });
    fs.writeFileSync(statePath, rendered, 'utf8');
  } else {
    warnings.push(`Existing file preserved: ${statePath}`);
  }
}

function printBanner() {
  const quote = IGNITION_QUOTES[Math.floor(Math.random() * IGNITION_QUOTES.length)];
  console.log('');
  console.log('  \u2501\u2501\u2501 Ignition \u2501\u2501\u2501');
  console.log(`  \u201c${quote.text}\u201d`);
  console.log(`    -- ${quote.by}`);
  console.log('');
}

function printSummary(summary) {
  const agentCount = summary.agents.copied + summary.agents.skipped;
  const skillCount = summary.skills.directories;
  const commandCount = summary.commands.copied + summary.commands.skipped;

  const modelLabel = summary.modelMode === 'multi-model'
    ? 'multi-model (Codex CLI found)'
    : 'claude-only';
  const teamsLabel = summary.useTeams ? 'teams' : 'solo';
  const scopeLabel = summary.useGlobal ? 'global' : 'project';

  console.log('');
  console.log('  \u2501\u2501\u2501 The kiln is lit \u2501\u2501\u2501');
  console.log('');
  console.log(`  ${summary.repoRoot}`);
  console.log(`  ${modelLabel}  \u00b7  ${teamsLabel}  \u00b7  ${scopeLabel}`);
  console.log(`  ${agentCount} agents  \u00b7  ${skillCount} skills  \u00b7  ${commandCount} commands`);
  console.log('');
  console.log('  /kiln:fire     Light the kiln');
  console.log('  /kiln:cool     Pause safely');
  console.log('  /kiln:quick    One-shot mode');
  console.log('  /kiln:status   Where am I?');
  console.log('');
  console.log('  brainstorm \u2192 roadmap \u2192 plan \u2192 execute \u2192 verify \u2192 reconcile');
  console.log('');
  console.log('  Tip: claude --dangerously-skip-permissions');
  console.log('  Next: /kiln:fire');

  if (summary.warnings.length > 0) {
    console.log('');
    for (const warning of summary.warnings) {
      console.log(`  ! ${warning}`);
    }
  }
}

async function main() {
  ensureNodeVersion();

  const options = parseArgs(process.argv);
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const sourceRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(options.repoRoot);
  const codexDetected = detectCodexCli();
  const modelMode = codexDetected ? 'multi-model' : 'claude-only';

  printBanner();

  let useGlobal = options.global;
  let useTeams = true;
  if (!options.yes) {
    const prompter = createPrompter();
    try {
      const installConfirmed = await prompter.yesNo(`Install kiln to ${repoRoot}?`, true);
      if (!installConfirmed) {
        console.log('Installation cancelled.');
        process.exit(0);
      }

      if (!options.global) {
        useGlobal = await prompter.yesNo(
          'Install globally to ~/.claude/?',
          false
        );
      }

      const { claudeRoot: checkRoot } = resolveInstallRoots(repoRoot, useGlobal);
      if (fs.existsSync(checkRoot) && !options.force) {
        const updateConfirmed = await prompter.yesNo(
          'Existing kiln installation found. Update?',
          true
        );
        if (!updateConfirmed) {
          console.log('Installation cancelled.');
          process.exit(0);
        }
      }

      useTeams = await prompter.yesNo('Enable Teams mode?', true);
    } finally {
      prompter.close();
    }
  }

  const { claudeRoot, kilnRoot } = resolveInstallRoots(repoRoot, useGlobal);

  const warnings = [];

  try {
    fs.mkdirSync(claudeRoot, { recursive: true });
    const agents = installAgents(sourceRoot, claudeRoot, warnings, options.force);
    const skills = installSkills(sourceRoot, claudeRoot, warnings, options.force);
    const commands = installCommands(sourceRoot, claudeRoot, warnings, options.force);
    const hooks = installHooks(sourceRoot, claudeRoot, warnings, options.force);
    const templates = installTemplates(sourceRoot, claudeRoot, warnings, options.force);
    const projectType = detectProjectType(repoRoot);
    const tooling = detectTooling(repoRoot);
    initializeKiln(sourceRoot, repoRoot, kilnRoot, projectType, modelMode, tooling, useTeams, warnings);
    const gitignoreHasKilnIgnore = ensureGitignoreKiln(repoRoot, warnings);

    printSummary({
      repoRoot,
      claudeRoot,
      kilnRoot,
      projectType,
      modelMode,
      useTeams,
      useGlobal,
      tooling,
      agents,
      skills,
      commands,
      hooks,
      templates,
      gitignoreHasKilnIgnore,
      warnings
    });
  } catch (err) {
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
      fatal(`Permission denied: ${err.message}`, 1);
    }
    if (err && err.code === 'ENOENT') {
      fatal(`File or directory not found: ${err.path || err.message}`, 1);
    }
    fatal(`Installation failed: ${err && err.message ? err.message : String(err)}`, 1);
  }
}

main().catch((err) => {
  fatal(`Installation failed: ${err && err.message ? err.message : String(err)}`, 1);
});
