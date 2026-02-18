#!/usr/bin/env node
'use strict';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';

const ok = (msg) => `${GREEN}✓${RESET} ${msg}`;
const fail = (msg) => `${RED}✗${RESET} ${msg}`;
const warn = (msg) => `${YELLOW}!${RESET} ${msg}`;
const bold = (msg) => `${BOLD}${msg}${RESET}`;

const HELP_TEXT = `Usage: kilntwo <command> [options]

Commands:
  install    Install KilnTwo agents and commands into ~/.claude
  uninstall  Remove KilnTwo files from ~/.claude
  update     Update installed KilnTwo files to the current version
  doctor     Check the KilnTwo installation for problems
  help       Show this help message

Options:
  --home <dir>  Use <dir> instead of ~ as the home directory
  --force       Overwrite existing files (install/update)
  --json        Output results as JSON
  --strict      Treat warnings as errors (doctor)
  --version     Print the kilntwo version and exit`;

function parseArgs(argv) {
  const flags = { home: undefined, force: false, json: false, strict: false, version: false };
  let command;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--version') {
      flags.version = true;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--strict') {
      flags.strict = true;
      continue;
    }
    if (arg === '--home') {
      flags.home = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      continue;
    }
    if (typeof command === 'undefined') {
      command = arg;
    }
  }

  return { command, flags };
}

// Normalize a status value from src modules to the canonical set
// used by printResult: 'ok', 'warn', 'error'.
// doctor.js uses 'pass'/'fail'; install/update use 'installed'/'updated'/'skipped'/'error'.
function normalizeStatus(status) {
  if (status === 'pass' || status === 'ok') return 'ok';
  if (status === 'fail' || status === 'error') return 'error';
  if (status === 'warn') return 'warn';
  return status;
}

function printResult(command, result, flags) {
  if (result && typeof result.error === 'string' && result.error.length > 0) {
    console.log(fail(result.error));
    return 1;
  }

  if (command === 'install') {
    const files = Array.isArray(result && result.files) ? result.files : [];
    // Also accept the flat arrays returned by src/install.js
    const installedPaths = Array.isArray(result && result.installed) ? result.installed : [];
    const skippedPaths = Array.isArray(result && result.skipped) ? result.skipped : [];

    let installed = 0;
    let skipped = 0;
    let errors = 0;

    if (files.length > 0) {
      for (const entry of files) {
        const filePath = entry && entry.path ? entry.path : '';
        const status = normalizeStatus(entry && entry.status);
        if (status === 'ok' || entry.status === 'installed') {
          installed += 1;
          console.log(ok(filePath));
        } else if (status === 'warn' || entry.status === 'skipped') {
          skipped += 1;
          console.log(warn(`${filePath} (skipped)`));
        } else if (status === 'error') {
          errors += 1;
          console.log(fail(filePath));
        }
      }
    } else {
      // src/install.js returns { installed: string[], skipped: string[], version }
      for (const filePath of installedPaths) {
        installed += 1;
        console.log(ok(filePath));
      }
      for (const filePath of skippedPaths) {
        skipped += 1;
        console.log(warn(`${filePath} (skipped)`));
      }
    }

    console.log(bold(`\n${installed} installed, ${skipped} skipped, ${errors} errors`));
    return errors > 0 ? 1 : 0;
  }

  if (command === 'uninstall') {
    const removed = Array.isArray(result && result.removed) ? result.removed : [];
    const notFound = Array.isArray(result && result.notFound) ? result.notFound : [];

    for (const filePath of removed) {
      console.log(ok(`removed: ${filePath}`));
    }
    for (const filePath of notFound) {
      console.log(warn(`not found: ${filePath}`));
    }

    console.log(bold(`\n${removed.length} file(s) removed`));
    return 0;
  }

  if (command === 'update') {
    // src/update.js returns { status, from, to, installed, removed }
    // or { files: [{path, status}], ... } per the prompt convention
    const updates = Array.isArray(result && result.updates) ? result.updates : [];
    const installedPaths = Array.isArray(result && result.installed) ? result.installed : [];
    const removedPaths = Array.isArray(result && result.removed) ? result.removed : [];

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    if (updates.length > 0) {
      for (const entry of updates) {
        const filePath = entry && entry.path ? entry.path : '';
        const status = normalizeStatus(entry && entry.status);
        if (status === 'ok' || entry.status === 'updated') {
          updated += 1;
          console.log(ok(filePath));
        } else if (status === 'warn' || entry.status === 'skipped') {
          skipped += 1;
          console.log(warn(`${filePath} (skipped)`));
        } else if (status === 'error') {
          errors += 1;
          console.log(fail(filePath));
        }
      }
    } else if (result && result.status === 'up-to-date') {
      console.log(ok(`already up-to-date at v${result.version}`));
    } else {
      for (const filePath of installedPaths) {
        updated += 1;
        console.log(ok(filePath));
      }
    }

    console.log(bold(`\n${updated} updated, ${skipped} skipped, ${errors} errors`));
    return errors > 0 ? 1 : 0;
  }

  if (command === 'doctor') {
    const checks = Array.isArray(result && result.checks) ? result.checks : [];
    let passed = 0;
    let warned = 0;
    let failed = 0;

    for (const check of checks) {
      const name = check && check.name ? check.name : '';
      const message = check && check.message ? `: ${check.message}` : '';
      const status = normalizeStatus(check && check.status);
      if (status === 'ok') {
        passed += 1;
        console.log(`${ok(name)}${message}`);
      } else if (status === 'warn') {
        warned += 1;
        console.log(`${warn(name)}${message}`);
      } else if (status === 'error') {
        failed += 1;
        console.log(`${fail(name)}${message}`);
      }
    }

    console.log(bold(`\nPassed: ${passed}  Warned: ${warned}  Failed: ${failed}`));
    return failed > 0 || (flags.strict && warned > 0) ? 1 : 0;
  }

  return 1;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.version) {
    const version = require('../package.json').version;
    console.log(`kiln v${version}`);
    process.exit(0);
    return;
  }

  if (command === 'help') {
    console.log(bold(HELP_TEXT));
    process.exit(0);
    return;
  }

  if (typeof command === 'undefined') {
    console.log(bold(HELP_TEXT));
    process.exit(1);
    return;
  }

  let result;

  try {
    const fs = require('node:fs');
    const path = require('node:path');

    if (command === 'install') {
      const modulePath = path.resolve(__dirname, '../src/install.js');
      if (!fs.existsSync(modulePath)) {
        throw new Error('Command module not available: install');
      }
      const mod = require('../src/install.js');
      const fn = typeof mod === 'function' ? mod : (mod && mod.install);
      if (typeof fn !== 'function') {
        throw new TypeError('Expected ../src/install.js to export a function');
      }
      result = await fn({ home: flags.home, force: flags.force });
    } else if (command === 'uninstall') {
      const modulePath = path.resolve(__dirname, '../src/uninstall.js');
      if (!fs.existsSync(modulePath)) {
        throw new Error('Command module not available: uninstall');
      }
      const mod = require('../src/uninstall.js');
      const fn = typeof mod === 'function' ? mod : (mod && mod.uninstall);
      if (typeof fn !== 'function') {
        throw new TypeError('Expected ../src/uninstall.js to export a function');
      }
      result = await fn({ home: flags.home });
    } else if (command === 'update') {
      const modulePath = path.resolve(__dirname, '../src/update.js');
      if (!fs.existsSync(modulePath)) {
        throw new Error('Command module not available: update');
      }
      const mod = require('../src/update.js');
      const fn = typeof mod === 'function' ? mod : (mod && mod.update);
      if (typeof fn !== 'function') {
        throw new TypeError('Expected ../src/update.js to export a function');
      }
      result = await fn({ home: flags.home, force: flags.force });
    } else if (command === 'doctor') {
      const modulePath = path.resolve(__dirname, '../src/doctor.js');
      if (!fs.existsSync(modulePath)) {
        throw new Error('Command module not available: doctor');
      }
      const mod = require('../src/doctor.js');
      const fn = typeof mod === 'function' ? mod : (mod && mod.doctor);
      if (typeof fn !== 'function') {
        throw new TypeError('Expected ../src/doctor.js to export a function');
      }
      result = await fn({ home: flags.home, strict: flags.strict });
    } else {
      console.log(bold(HELP_TEXT));
      process.exit(1);
      return;
    }

    if (flags.json) {
      let exitCode = 0;

      if (result && typeof result.error === 'string' && result.error.length > 0) {
        exitCode = 1;
      } else if (command === 'install') {
        const files = Array.isArray(result && result.files) ? result.files : [];
        if (files.some((entry) => entry && normalizeStatus(entry.status) === 'error')) {
          exitCode = 1;
        }
      } else if (command === 'update') {
        const updates = Array.isArray(result && result.updates) ? result.updates : [];
        if (updates.some((entry) => entry && normalizeStatus(entry.status) === 'error')) {
          exitCode = 1;
        }
      } else if (command === 'doctor') {
        const checks = Array.isArray(result && result.checks) ? result.checks : [];
        const hasError = checks.some((check) => check && normalizeStatus(check.status) === 'error');
        const hasWarn = checks.some((check) => check && normalizeStatus(check.status) === 'warn');
        if (hasError || (flags.strict && hasWarn)) {
          exitCode = 1;
        }
      }

      console.log(JSON.stringify(result, null, 2));
      process.exit(exitCode);
      return;
    }

    process.exit(printResult(command, result, flags));
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (flags.json) {
      console.error(JSON.stringify({ error: message }));
    } else {
      console.error(fail(message));
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error(fail(err.message));
  process.exit(1);
});
