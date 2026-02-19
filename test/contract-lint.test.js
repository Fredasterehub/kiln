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

// Extract the event type enum declared in a file (looks for backtick-quoted enum on a line with "Event type enum" or "event type enum").
function extractEventTypeEnum(content) {
  const enumLine = content.split('\n').find((l) => /[Ee]vent type enum/i.test(l));
  if (!enumLine) return [];
  const types = [];
  const regex = /`([a-z_]+)`/g;
  let match;
  while ((match = regex.exec(enumLine)) !== null) {
    types.push(match[1]);
  }
  return types;
}

// Extract all EVENT_TYPE values used in structured event lines (pattern: [TYPE] —).
function extractUsedEventTypes(content) {
  const types = [];
  const regex = /\[([a-z_]+)\] —/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    types.push(match[1]);
  }
  return [...new Set(types)];
}

// Extract EVENT_TYPE values from bracketed references like [setup], [branch] in workflow text.
function extractBracketedEventTypes(content) {
  const types = [];
  // Match patterns like: `[event_type]` where event_type is a known-format value
  // Look for `[word]` patterns that appear alongside event-related context
  const regex = /`\[([a-z_]+)\]`/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    types.push(match[1]);
  }
  return [...new Set(types)];
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

    // Both should reference phase state file
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

  it('event type enum in skill covers all event types used in executor', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');
    const skill = readAsset('skills/kiln-core.md');

    const skillEnum = extractEventTypeEnum(skill);
    const usedTypes = extractUsedEventTypes(executor);
    const bracketedTypes = extractBracketedEventTypes(executor);
    const allUsed = [...new Set([...usedTypes, ...bracketedTypes])];

    // Skill enum must be non-empty
    assert.ok(skillEnum.length > 0, 'Skill must declare an event type enum');
    assert.ok(allUsed.length > 0, 'Executor must use at least one event type');

    // Every used type must be in the enum
    const undeclared = allUsed.filter((t) => !skillEnum.includes(t));
    assert.deepStrictEqual(
      undeclared,
      [],
      `Event types used in executor but not in skill enum: ${JSON.stringify(undeclared)}`,
    );
  });

  it('event type enum in skill is fully covered by executor usage', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');
    const skill = readAsset('skills/kiln-core.md');

    const skillEnum = extractEventTypeEnum(skill);
    const usedTypes = extractUsedEventTypes(executor);
    const bracketedTypes = extractBracketedEventTypes(executor);
    const allUsed = [...new Set([...usedTypes, ...bracketedTypes])];

    // Every enum type should be used at least once (no dead entries)
    const unused = skillEnum.filter((t) => !allUsed.includes(t));
    assert.deepStrictEqual(
      unused,
      [],
      `Event types declared in skill enum but never used in executor: ${JSON.stringify(unused)}`,
    );
  });

  it('archive/ directory exists in skill tree and start.md gitignore', () => {
    const skill = readAsset('skills/kiln-core.md');
    const start = readAsset('commands/kiln/start.md');

    // Check skill tree contains archive/
    const treeSection = skill.match(/\$KILN_DIR\/\n([\s\S]*?)```/);
    assert.ok(treeSection, 'Skill must contain a $KILN_DIR/ directory tree');
    assert.ok(
      /^\s{2}archive\//m.test(treeSection[1]),
      'Skill directory tree must include archive/ as a top-level $KILN_DIR subdirectory',
    );

    // Check gitignore in start.md contains archive/
    const gitignoreSection = start.substring(
      start.indexOf('.gitignore'),
      start.indexOf('Do not add extra entries'),
    );
    assert.ok(
      gitignoreSection.includes('`archive/`'),
      'start.md gitignore must include archive/',
    );
  });

  it('gitignore template in start.md covers all $KILN_DIR subdirectories from skill', () => {
    const skill = readAsset('skills/kiln-core.md');
    const start = readAsset('commands/kiln/start.md');

    // Extract subdirs from the skill Working Directory Structure tree
    const treeSection = skill.match(/\$KILN_DIR\/\n([\s\S]*?)```/);
    assert.ok(treeSection, 'Skill must contain a $KILN_DIR/ directory tree');

    const protocolDirs = [];
    const dirRegex = /^\s{2}([a-z]+)\//gm;
    let match;
    while ((match = dirRegex.exec(treeSection[1])) !== null) {
      protocolDirs.push(match[1] + '/');
    }

    // Extract gitignore entries from start.md
    const gitignoreEntries = [];
    const entryRegex = /`([a-z]+\/)`/g;
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
        `Skill directory '${dir}' must be covered in start.md gitignore, found: ${JSON.stringify(gitignoreEntries)}`,
      );
    }
  });
});

describe('regression tests', () => {
  it('executor uses lowercase $memory_dir, never $MEMORY_DIR', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');
    const lines = executor.split('\n');
    const violations = [];

    for (let i = 0; i < lines.length; i++) {
      // Skip the frontmatter and any comments about the convention itself
      if (/\$MEMORY_DIR/.test(lines[i]) && !/^\s*#/.test(lines[i]) && !lines[i].includes('kiln-core')) {
        violations.push(`line ${i + 1}: ${lines[i].trim()}`);
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Executor must use $memory_dir (lowercase), not $MEMORY_DIR: ${JSON.stringify(violations)}`,
    );
  });

  it('no duplicate step numbers in numbered lists across agent files', () => {
    const agentDir = path.join(ASSETS_DIR, 'agents');
    const agentFiles = fs.readdirSync(agentDir).filter((f) => f.endsWith('.md'));
    const failures = [];

    for (const filename of agentFiles) {
      const content = fs.readFileSync(path.join(agentDir, filename), 'utf8');
      const lines = content.split('\n');

      // Track numbered items within each section (reset on heading)
      let currentSection = '';
      const seenNumbers = new Map(); // section -> Set of numbers

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect section headers (## or ### level)
        if (/^#{1,3}\s/.test(line)) {
          currentSection = line.trim();
          seenNumbers.set(currentSection, new Set());
          continue;
        }

        // Detect numbered list items at the start of a line (e.g., "1.", "5.", "10.")
        const numMatch = line.match(/^(\d+)\.\s/);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          const sectionNums = seenNumbers.get(currentSection);
          if (sectionNums) {
            if (sectionNums.has(num)) {
              failures.push(`${filename}:${i + 1}: duplicate step number ${num} in section "${currentSection}"`);
            }
            sectionNums.add(num);
          }
        }
      }
    }

    assert.deepStrictEqual(
      failures,
      [],
      `Duplicate step numbers found: ${JSON.stringify(failures)}`,
    );
  });

  it('handoff_context appears in protocol required fields, template, reset, and start checkpoints', () => {
    const protocol = readAsset('protocol.md');
    const start = readAsset('commands/kiln/start.md');
    const reset = readAsset('commands/kiln/reset.md');

    const failures = [];

    if (!protocol.includes('handoff_context')) {
      failures.push('protocol.md does not mention handoff_context');
    }
    if (!start.includes('handoff_context')) {
      failures.push('start.md does not mention handoff_context');
    }
    if (!reset.includes('handoff_context')) {
      failures.push('reset.md does not mention handoff_context');
    }

    assert.deepStrictEqual(
      failures,
      [],
      `handoff_context missing from: ${JSON.stringify(failures)}`,
    );
  });

  it('skill and protocol path contracts are consistent', () => {
    const skill = readAsset('skills/kiln-core.md');
    const protocol = readAsset('protocol.md');

    // Both must define the same core path variables
    const pathVars = ['PROJECT_PATH', 'KILN_DIR', 'CLAUDE_HOME', 'MEMORY_DIR'];

    for (const v of pathVars) {
      assert.ok(
        skill.includes(v),
        `Skill must define path variable ${v}`,
      );
      assert.ok(
        protocol.includes(v),
        `Protocol must reference path variable ${v}`,
      );
    }
  });

  it('protocol agent roster includes all agents from names.json', () => {
    const protocol = readAsset('protocol.md');
    const names = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'names.json'), 'utf8'));

    const failures = [];
    for (const [internal, entry] of Object.entries(names)) {
      if (internal === 'kiln') continue; // orchestrator is listed differently
      if (!protocol.includes(entry.alias)) {
        failures.push(`alias "${entry.alias}" (${internal}) missing from protocol agent roster`);
      }
      if (!protocol.includes(internal)) {
        failures.push(`internal name "${internal}" missing from protocol agent roster`);
      }
    }

    assert.deepStrictEqual(
      failures,
      [],
      `Protocol agent roster gaps: ${JSON.stringify(failures)}`,
    );
  });

  it('vision.md template has all required sections for pre-flight check', () => {
    const vision = readAsset('templates/vision.md');
    const requiredSections = [
      '## Problem Statement',
      '## Target Users',
      '## Goals',
      '## Constraints',
      '## Tech Stack',
      '## Open Questions',
      '## Elicitation Log',
    ];

    const missing = requiredSections.filter((s) => !vision.includes(s));
    assert.deepStrictEqual(
      missing,
      [],
      `vision.md template missing sections: ${JSON.stringify(missing)}`,
    );
  });

  it('slug example in executor matches the described transform', () => {
    const executor = readAsset('agents/kiln-phase-executor.md');

    // Find the example line
    const exampleLine = executor.split('\n').find((l) => l.includes('Example:') && l.includes('authentication'));
    assert.ok(exampleLine, 'Executor must have a slug example with "authentication"');

    // Extract the input and output from the example
    const inputMatch = exampleLine.match(/"([^"]+)"/);
    const outputMatch = exampleLine.match(/`([a-z-]+)`\s*\.?\s*$/);

    assert.ok(inputMatch, 'Example must show input in quotes');
    assert.ok(outputMatch, 'Example must show output in backticks');

    const input = inputMatch[1];
    const expectedOutput = outputMatch[1];

    // Apply the documented transform
    const actual = input
      .toLowerCase()
      .replace(/ /g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 30);

    assert.strictEqual(
      actual,
      expectedOutput,
      `Slug example: "${input}" should produce "${actual}" but example shows "${expectedOutput}"`,
    );
  });
});
