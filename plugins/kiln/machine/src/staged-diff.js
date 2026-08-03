'use strict';

// staged-diff.js — what is staged in a git repository, as one canonical
// digest, plus the three read-only git primitives it rests on.
//
// This lives on its own because TWO modules need the same answer and neither
// may import the other. `implementation.js` cites the staged diff when it
// seals a chunk; `milestones.js` recomputes it when it verifies that a build
// record's `diff_digest` describes work that is actually there. implementation.js
// already imports milestones.js, so the digest could not stay where it was
// without making a cycle — and a second copy of it would be two answers to a
// question that must have exactly one.
//
// implementation.js re-exports `stagedDiffDigest`, so every existing caller —
// the workflow facade's op table among them — keeps working unchanged: the
// function moved, the contract did not.

const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Every git invocation here goes through these two. `-c` settings that would
// otherwise vary the BYTES of a diff are pinned at the call site that reads
// them, never left to the repository's own config.
function git(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new Error(`staged-diff: could not run git in ${repoRoot} — ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function gitOrThrow(repoRoot, args) {
  const result = git(repoRoot, args);
  if (result.status !== 0) {
    throw new Error(
      `staged-diff: git ${args.join(' ')} failed in ${repoRoot} (exit ${result.status}): ${result.stderr.trim()}`
    );
  }
  return result.stdout;
}

function requireRepo(repoRoot) {
  const result = git(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  if (result.status !== 0 || result.stdout.trim() !== 'true') {
    throw new Error(`staged-diff: ${repoRoot} is not a git repository — refusing to run a git transaction against it`);
  }
}

// stagedDiffDigest(repoRoot) — the canonical digest of what is staged right
// now, and the value a reviewer cites when it approves a diff. Every flag here
// pins a git config knob that could otherwise change the bytes without
// changing the change: rename detection, external and textconv drivers, color,
// abbreviation width, and non-ASCII path quoting. Binary content is included
// (as git's own base85) so a binary-only change is never digested as an empty
// diff.
function stagedDiffDigest(repoRoot) {
  if (!isNonEmptyString(repoRoot)) {
    throw new TypeError('staged-diff: repoRoot must be a non-empty string');
  }
  requireRepo(repoRoot);
  const diff = gitOrThrow(repoRoot, [
    '-c',
    'core.abbrev=40',
    '-c',
    'core.quotePath=true',
    'diff',
    '--cached',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--binary',
  ]);
  return `sha256:${createHash('sha256').update(diff, 'utf8').digest('hex')}`;
}

module.exports = { stagedDiffDigest, git, gitOrThrow, requireRepo };
