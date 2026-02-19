'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function readAsset(relativePath) {
  return fs.readFileSync(path.join(ASSETS_DIR, relativePath), 'utf8');
}

// Extract all $KILN_DIR/outputs/ filename patterns from a markdown file,
// normalizing <NN>, <N>, and similar padding variants to a canonical form.
function extractOutputFilenamePatterns(content) {
  const patterns = [];
  const regex = /\$KILN_DIR\/outputs\/([a-zA-Z0-9_<>]+\.md)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    // Normalize padding: <NN> and <N> → <N>
    const normalized = match[1].replace(/<NN>/g, '<N>').replace(/<N>/g, '<N>');
    patterns.push(normalized);
  }
  return [...new Set(patterns)];
}

// Extract all $KILN_DIR/reviews/ filename patterns for review outputs.
function extractReviewFilenamePatterns(content) {
  const patterns = [];
  const regex = /\$KILN_DIR\/reviews\/([a-zA-Z0-9_<>]+\.md)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const normalized = match[1].replace(/<NN>/g, '<N>').replace(/<review_round>/g, '<N>').replace(/<R>/g, '<N>');
    patterns.push(normalized);
  }
  return [...new Set(patterns)];
}

// Extract $KILN_DIR/phase_*state* filename patterns.
function extractPhaseStatePatterns(content) {
  const patterns = [];
  const regex = /\$KILN_DIR\/phase_[^`\s]*state[^`\s]*\.md/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    // Normalize phase number placeholders
    const normalized = match[0]
      .replace(/<phase_number>/g, '<N>')
      .replace(/<N>/g, '<N>');
    patterns.push(normalized);
  }
  return [...new Set(patterns)];
}

describe('contract lint', () => {
  // Known gaps: spawn-input completeness not checked, padding normalization is approximate.

  it('output filename patterns are consistent between executor and implementer', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');
    const implementer = readAsset('agents/kiln-implementer.md');

    const executorPatterns = extractOutputFilenamePatterns(executor);
    const implementerPatterns = extractOutputFilenamePatterns(implementer);

    // Both should reference task_<N>_output.md (after normalization)
    assert.ok(
      executorPatterns.includes('task_<N>_output.md'),
      `Executor must reference task_<N>_output.md, found: ${JSON.stringify(executorPatterns)}`,
    );
    assert.ok(
      implementerPatterns.includes('task_<N>_output.md'),
      `Implementer must reference task_<N>_output.md, found: ${JSON.stringify(implementerPatterns)}`,
    );

    // Filter to base task output patterns (exclude fix_ and error_ variants)
    const executorBase = executorPatterns.filter(
      (p) => p.startsWith('task_<N>') && p.endsWith('_output.md') && !p.includes('fix') && !p.includes('error'),
    );
    const implementerBase = implementerPatterns.filter(
      (p) => p.startsWith('task_<N>') && p.endsWith('_output.md') && !p.includes('fix') && !p.includes('error'),
    );

    assert.deepStrictEqual(
      executorBase,
      implementerBase,
      'Base output filename patterns must match between executor and implementer',
    );
  });

  it('review fix-round filenames are consistent between executor and reviewer', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');
    const reviewer = readAsset('agents/kiln-reviewer.md');

    const executorReview = extractReviewFilenamePatterns(executor);
    const reviewerReview = extractReviewFilenamePatterns(reviewer);

    // Both should reference fix_round_<N>.md
    assert.ok(
      executorReview.includes('fix_round_<N>.md'),
      `Executor must reference fix_round_<N>.md, found: ${JSON.stringify(executorReview)}`,
    );
    assert.ok(
      reviewerReview.includes('fix_round_<N>.md'),
      `Reviewer must reference fix_round_<N>.md, found: ${JSON.stringify(reviewerReview)}`,
    );
  });

  it('phase state filename is consistent between resume and executor', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');
    const resume = readAsset('commands/kiln/resume.md');

    const executorState = extractPhaseStatePatterns(executor);
    const resumeState = extractPhaseStatePatterns(resume);

    // Both should reference phase_<N>_state.md
    assert.ok(
      executorState.some((p) => p.includes('state')),
      `Executor must reference phase state file, found: ${JSON.stringify(executorState)}`,
    );
    assert.ok(
      resumeState.some((p) => p.includes('state')),
      `Resume must reference phase state file, found: ${JSON.stringify(resumeState)}`,
    );

    // The patterns should be the same (after normalization)
    const executorNorm = executorState.map((p) => p.replace(/<phase_number>/g, '<N>'));
    const resumeNorm = resumeState.map((p) => p.replace(/<phase_number>/g, '<N>'));

    // At least one pattern must overlap
    const overlap = executorNorm.filter((p) => resumeNorm.includes(p));
    assert.ok(
      overlap.length > 0,
      `Phase state filename must match between executor (${JSON.stringify(executorNorm)}) and resume (${JSON.stringify(resumeNorm)})`,
    );
  });

  it('gitignore template in start.md covers all $KILN_DIR subdirectories from protocol', () => {
    const protocol = readAsset('protocol.md');
    const start = readAsset('commands/kiln/start.md');

    // Extract subdirs from the protocol Working Directory Structure tree
    const treeSection = protocol.match(/\$KILN_DIR\/\n([\s\S]*?)```/);
    assert.ok(treeSection, 'Protocol must contain a $KILN_DIR/ directory tree');

    const protocolDirs = [];
    const dirRegex = /^\s{2}([a-z]+)\//gm;
    let match;
    while ((match = dirRegex.exec(treeSection[1])) !== null) {
      protocolDirs.push(match[1] + '/');
    }

    // Extract gitignore entries from start.md
    // Look for backtick-quoted directory entries after the gitignore write instruction
    const gitignoreEntries = [];
    const entryRegex = /`([a-z]+\/)`/g;
    // Search in the gitignore section of start.md
    const gitignoreSection = start.substring(
      start.indexOf('.gitignore'),
      start.indexOf('Do not add extra entries'),
    );
    while ((match = entryRegex.exec(gitignoreSection)) !== null) {
      gitignoreEntries.push(match[1]);
    }

    for (const dir of protocolDirs) {
      assert.ok(
        gitignoreEntries.includes(dir),
        `Protocol directory '${dir}' must be covered in start.md gitignore, found: ${JSON.stringify(gitignoreEntries)}`,
      );
    }
  });
});
