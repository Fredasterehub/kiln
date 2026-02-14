#!/usr/bin/env node

'use strict';

const path = require('path');

const USAGE = `
kiln-dev — Multi-model orchestration workflow for Claude Code

Usage:
  npx kiln-dev [options]

Options:
  --help                Show this help message and exit
  --repo-root <path>    Target repository root (default: current directory)

Examples:
  npx kiln-dev
  npx kiln-dev --repo-root /path/to/project
`.trim();

const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}

let repoRoot = process.cwd();
const rootIdx = args.indexOf('--repo-root');
if (rootIdx !== -1 && args[rootIdx + 1]) {
  repoRoot = path.resolve(args[rootIdx + 1]);
}

console.log('kiln-dev installer — not yet implemented');
process.exit(0);
