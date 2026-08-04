'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { loadRegistry, currentPhase, canEnter, advance, closeTerminal, reopenPhase, resumePoint } = require('../src/phases.js');
const { assembleLastMile, renderFacts, checkDeliveryReady } = require('../src/delivery.js');
const { scaffoldTree, scaffoldArchitecture } = require('../src/scaffold.js');
const { readJson, writeAtomic } = require('../src/atomic-json.js');
const { readAll } = require('../src/jsonl.js');
const { appendRecord } = require('../src/stream.js');
const { createMilestone, recordChunk, closeMilestone } = require('../src/milestones.js');
const { startRun, recordRun, computeSuiteState } = require('../src/verification.js');
const { writeDispatch, writeDispatchTerminal } = require('../src/receipts.js');
const { stagedDiffDigest } = require('../src/staged-diff.js');
const { writeValidContentArtifacts } = require('./fixtures/valid-architecture-artifacts.js');

const REGISTRY_PATH = path.join(__dirname, '..', 'phases-registry.json');
const ROUTING_CONFIG = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');

function makeTmpDir() {
  // A real (throwaway) git repository: a scaffolded tree's PARENT now has to
  // answer `git diff --cached`, because recordChunk verifies a build record's
  // diff_digest against what is actually staged there.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phases-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'initial');
  return dir;
}

function scaffoldedTreeRoot() {
  const tmp = makeTmpDir();
  scaffoldTree(tmp, { routingConfigPath: ROUTING_CONFIG });
  return path.join(tmp, '.thelastskill');
}

function writeRegistry(dir, obj) {
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

// Lands everything the canonical registry's brainstorm exit_checks now
// require (P4 Sol review MAJOR #5) — a non-stub vision.md, at least one
// non-genesis decisions.jsonl record, and a sealed transcript.jsonl — the
// same three facts brainstorm-crystallizer.md's own closing checks verify
// before calling advance() for real.
function sealBrainstormExit(treeRoot) {
  fs.writeFileSync(path.join(treeRoot, 'vision', 'vision.md'), '# Vision\n\ncrystallized.\n');
  appendRecord(path.join(treeRoot, 'vision', 'decisions.jsonl'), { kind: 'decision', payload: { text: 'stub decision' } });
  appendRecord(path.join(treeRoot, 'vision', 'transcript.jsonl'), { kind: 'sealed', payload: {} });
}

// Walks a freshly scaffolded tree from onboarding all the way to plan_gate,
// landing every real exit artifact along the way (including a properly
// sealed, approved, digest-matched architecture gate via
// scaffold.scaffoldArchitecture — the same op the phase-sequence replay
// scenario uses). Shared by the "architecture-gate-approved" entry-check
// tests below, which then tamper with gate.json/the artifacts it approved
// from this common, known-good starting point.
function buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath) {
  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm
  sealBrainstormExit(treeRoot);
  advance(treeRoot, registry, statePath, ledgerPath); // brainstorm -> research
  writeAtomic(path.join(treeRoot, 'research', 'index.json'), { stub: 'research:index.json' });
  fs.writeFileSync(path.join(treeRoot, 'research', 'summary.md'), '# Research summary\n\nstub.\n');
  for (let i = 0; i < 3; i++) {
    appendRecord(path.join(treeRoot, 'research', 'scratchpad.jsonl'), { kind: 'note', payload: { text: `stub note ${i}` } });
  }
  // jsonl-has-kind:freshness_gate (P5 fix pass) — proves a cache-first gate
  // decision was recorded before the phase closed; presence-of-evidence, not
  // truth-of-evidence (the machine cannot verify the gate's own reasoning).
  appendRecord(path.join(treeRoot, 'research', 'scratchpad.jsonl'), {
    kind: 'freshness_gate',
    payload: { topic: 'stub-topic', fresh: true, reason: 'stub gate check', load_bearing: false },
  });
  advance(treeRoot, registry, statePath, ledgerPath); // research -> architecture

  const architectureDir = path.join(treeRoot, 'architecture');
  // Semantically valid content (P6 Sol review BLOCKING #1/#3) — scaffoldArchitecture
  // now delegates to plan-gate.js's approveGate(), which re-validates
  // criteria-register.json/milestones.json/artifact-map.json/protocol-record.md
  // before sealing rather than merely requiring the five paths to exist.
  writeValidContentArtifacts(architectureDir);
  scaffoldArchitecture(architectureDir);
  advance(treeRoot, registry, statePath, ledgerPath); // architecture -> plan_gate
}

// One real chunk-spec -> chunk-start -> chunk-built -> chunk-review -> chunk-green sequence
// for milestoneId, then closeMilestone — the minimal path to a "green"
// milestones/index.json entry, shared by every "milestones-all-green"-facing
// test below.
// A chunk-built is a claim about a receipt, so a fixture that walks the
// lifecycle has to leave the receipt on the ledger first. One dispatch, one
// terminal, one build record citing it — the shape family-evidence.js
// composes, written here directly because these tests are about the
// lifecycle, not about gathering the evidence.
let evidenceSeq = 0;
function evidencedBuilt(treeRoot, chunkId, family = 'gpt', milestoneId = 'M1') {
  const dispatchId = `EV${(evidenceSeq += 1)}`;
  const digest = `sha256:${String(evidenceSeq).padStart(64, '0')}`;
  const codex = family === 'gpt';
  const transportRef = codex
    ? { pid: 4000 + evidenceSeq, pgid: 4000 + evidenceSeq, session: String(4000 + evidenceSeq) }
    : { task_ref: dispatchId };
  writeDispatch(treeRoot, {
    dispatch_id: dispatchId,
    seat: codex ? 'implementer' : 'implementer_ui_creative',
    transport: codex ? 'codex' : 'native',
    intended_family: family,
    task_class: 'chunk_implementation',
    prompt_ref: `briefs/${chunkId}.md`,
    transport_ref: transportRef,
  });
  const { record } = writeDispatchTerminal(treeRoot, {
    dispatch_id: dispatchId,
    status: 'ok',
    builder: codex ? 'sol' : 'claude-fallback',
    transport_ref: transportRef,
    result_ref: `results/${dispatchId}.md`,
    model_id: codex ? 'gpt-5.6-sol' : 'opus-5',
    result_digest: digest,
  });
  return {
    kind: 'chunk-built',
    chunk_id: chunkId,
    actual_family: family,
    intended_family: family,
    model_id: codex ? 'gpt-5.6-sol' : 'opus-5',
    dispatch_ref: `ledger:${record.seq}`,
    result_digest: digest,
    // The boundary recomputes this from the repository and compares, so a
    // fixture cannot invent it: a build record describes work that is there.
    diff_digest: stagedDiffDigest(path.join(treeRoot, '..')),
  };
}

function landOneGreenChunk(treeRoot, milestoneId, chunkId) {
  recordChunk(treeRoot, milestoneId, { kind: 'chunk-spec', chunk_id: chunkId, brief_ref: `${milestoneId}/spec.md#${chunkId}` });
  recordChunk(treeRoot, milestoneId, {
    kind: 'chunk-start',
    chunk_id: chunkId,
    implementer_seat: 'sol',
    implementer_family: 'gpt',
  });
  recordChunk(treeRoot, milestoneId, evidencedBuilt(treeRoot, chunkId, 'gpt', milestoneId));
  recordChunk(treeRoot, milestoneId, {
    kind: 'chunk-review',
    chunk_id: chunkId,
    review: { family: 'claude', verdict: 'approve', ref: `envelopes/implementation/${chunkId}-review.json` },
  });
  recordChunk(treeRoot, milestoneId, {
    kind: 'chunk-green',
    chunk_id: chunkId,
    commit: '0123456789abcdef0123456789abcdef01234567',
    review: { family: 'claude', verdict: 'approve', ref: `envelopes/implementation/${chunkId}-review.json` },
    verification: { gate_id: `${chunkId}-unit`, cmd: 'node --test', exit_code: 0 },
  });
  return closeMilestone(
    treeRoot,
    milestoneId,
    { tag: `milestone/${milestoneId}-green`, merge_sha: '0123456789abcdef0123456789abcdef01234567', review_evidence: `envelopes/implementation/${milestoneId}-review.json` },
    { skipGitVerify: true }
  );
}

// Walks a tree all the way through implementation with exactly one
// milestone, one chunk, closed green — the minimal state
// "milestones-all-green" needs to pass at the implementation -> verification
// boundary. Shared by every test in the "implementation -> verification"
// block below.
function buildThroughImplementation(treeRoot, registry, statePath, ledgerPath) {
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath); // at plan_gate
  advance(treeRoot, registry, statePath, ledgerPath); // plan_gate -> implementation
  createMilestone(treeRoot, { id: 'M1', title: 'Stub milestone', designer_family: 'gpt', toolchain_profile: null });
  landOneGreenChunk(treeRoot, 'M1', 'C1');
}

// --- loadRegistry: shape + ordering ---

test('loadRegistry loads the canonical phases-registry.json with 8 phases ordered 1..8', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.phases.length, 8);
  assert.deepEqual(
    registry.phases.map((p) => p.order),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );
  assert.deepEqual(
    registry.phases.map((p) => p.id),
    ['onboarding', 'brainstorm', 'research', 'architecture', 'plan_gate', 'implementation', 'verification', 'delivery']
  );
  for (const phase of registry.phases) {
    assert.equal(phase.resumable, true);
    assert.equal(typeof phase.interactive, 'boolean');
    assert.equal(typeof phase.title, 'string');
    assert.ok(Array.isArray(phase.entry_requires));
    assert.ok(Array.isArray(phase.exit_emits));
  }
});

test('loadRegistry orders phases by "order" regardless of on-disk array order', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [
      { id: 'b', order: 2, title: 'B', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
      { id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
    ],
  });
  const registry = loadRegistry(file);
  assert.deepEqual(registry.phases.map((p) => p.id), ['a', 'b']);
});

test('loadRegistry throws on duplicate phase id', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [
      { id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
      { id: 'a', order: 2, title: 'A2', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
    ],
  });
  assert.throws(() => loadRegistry(file), /duplicate phase id/);
});

test('loadRegistry throws on non-contiguous order sequence', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [
      { id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
      { id: 'b', order: 3, title: 'B', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
    ],
  });
  assert.throws(() => loadRegistry(file), /non-contiguous/);
});

test('loadRegistry throws on duplicate order value', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [
      { id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
      { id: 'b', order: 1, title: 'B', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
    ],
  });
  assert.throws(() => loadRegistry(file), /duplicate order/);
});

test('loadRegistry throws on a malformed phase entry (missing field)', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, interactive: false, entry_requires: [], exit_emits: [], resumable: true }],
  });
  assert.throws(() => loadRegistry(file), /"title"/);
});

test('loadRegistry throws on resumable !== true', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], resumable: false }],
  });
  assert.throws(() => loadRegistry(file), /resumable/);
});

test('loadRegistry throws on missing/wrong schema_version', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, { phases: [] });
  assert.throws(() => loadRegistry(file), /schema_version/);
});

test('loadRegistry throws when the file does not exist', () => {
  assert.throws(() => loadRegistry('/nonexistent/registry.json'), /could not read registry/);
});

// --- loadRegistry: relpath containment (P2 review [major] #5) ---

test('loadRegistry throws when entry_requires contains a ".." traversal segment', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, title: 'A', interactive: false, entry_requires: ['../escape.json'], exit_emits: [], resumable: true }],
  });
  assert.throws(() => loadRegistry(file), /entry_requires.*contained relative path/s);
});

test('loadRegistry throws when exit_emits contains an absolute path', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: ['/etc/passwd'], resumable: true }],
  });
  assert.throws(() => loadRegistry(file), /exit_emits.*contained relative path/s);
});

test('loadRegistry throws when a relpath contains a backslash', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, title: 'A', interactive: false, entry_requires: ['dir\\file.json'], exit_emits: [], resumable: true }],
  });
  assert.throws(() => loadRegistry(file), /contained relative path/);
});

test('loadRegistry throws when a relpath contains an empty or "." segment', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, title: 'A', interactive: false, entry_requires: ['dir//file.json'], exit_emits: [], resumable: true }],
  });
  assert.throws(() => loadRegistry(file), /contained relative path/);
});

// --- loadRegistry: entry_checks (semantic checks, optional) ---

test('loadRegistry throws when entry_checks names an unknown check', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], entry_checks: ['not-a-real-check'], resumable: true }],
  });
  assert.throws(() => loadRegistry(file), /unknown check/);
});

test('loadRegistry accepts a phase with no entry_checks field, and one that names a known check', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [
      { id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
      { id: 'b', order: 2, title: 'B', interactive: false, entry_requires: [], exit_emits: [], entry_checks: ['architecture-gate-approved'], resumable: true },
    ],
  });
  const registry = loadRegistry(file);
  assert.equal(registry.phases[0].entry_checks, undefined);
  assert.deepEqual(registry.phases[1].entry_checks, ['architecture-gate-approved']);
});

// --- loadRegistry: exit_checks (P4 Sol review MAJOR #5) ---

test('loadRegistry throws when exit_checks names an unknown check kind', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], exit_checks: [{ file: 'x.jsonl', check: 'not-a-real-check' }], resumable: true }],
  });
  assert.throws(() => loadRegistry(file), /exit_checks\[0\].*unknown check/s);
});

test('loadRegistry throws when an exit_checks entry\'s file is not a contained relpath', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], exit_checks: [{ file: '/etc/passwd', check: 'file-nonempty' }], resumable: true }],
  });
  assert.throws(() => loadRegistry(file), /exit_checks\[0\].*contained relative path/s);
});

test('loadRegistry throws when an exit_checks entry is not an object', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], exit_checks: ['not-an-object'], resumable: true }],
  });
  assert.throws(() => loadRegistry(file), /exit_checks\[0\].*must be an object/s);
});

test('loadRegistry accepts a phase with no exit_checks field, and one that names known checks with params', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [
      { id: 'a', order: 1, title: 'A', interactive: false, entry_requires: [], exit_emits: [], resumable: true },
      {
        id: 'b',
        order: 2,
        title: 'B',
        interactive: false,
        entry_requires: [],
        exit_emits: [],
        exit_checks: [
          { file: 'x.jsonl', check: 'jsonl-sealed' },
          { file: 'y.jsonl', check: 'jsonl-min-records:1' },
          { file: 'z.md', check: 'file-nonempty' },
        ],
        resumable: true,
      },
    ],
  });
  const registry = loadRegistry(file);
  assert.equal(registry.phases[0].exit_checks, undefined);
  assert.deepEqual(registry.phases[1].exit_checks, [
    { file: 'x.jsonl', check: 'jsonl-sealed' },
    { file: 'y.jsonl', check: 'jsonl-min-records:1' },
    { file: 'z.md', check: 'file-nonempty' },
  ]);
});

test('the canonical registry\'s brainstorm phase declares the three brainstorm exit_checks', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const brainstorm = registry.phases.find((p) => p.id === 'brainstorm');
  assert.deepEqual(brainstorm.exit_checks, [
    { file: 'vision/transcript.jsonl', check: 'jsonl-sealed' },
    { file: 'vision/decisions.jsonl', check: 'jsonl-min-records:1' },
    { file: 'vision/vision.md', check: 'file-nonempty' },
  ]);
});

// --- loadRegistry: jsonl-has-kind:<kind> (P5 fix pass, auditability) ---

test('loadRegistry accepts jsonl-has-kind:<kind> as a known exit check', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [
      {
        id: 'a',
        order: 1,
        title: 'A',
        interactive: false,
        entry_requires: [],
        exit_emits: [],
        exit_checks: [{ file: 'x.jsonl', check: 'jsonl-has-kind:freshness_gate' }],
        resumable: true,
      },
    ],
  });
  const registry = loadRegistry(file);
  assert.deepEqual(registry.phases[0].exit_checks, [{ file: 'x.jsonl', check: 'jsonl-has-kind:freshness_gate' }]);
});

test('the canonical registry\'s research phase declares its four exit_checks, including jsonl-has-kind:freshness_gate and summary.md file-nonempty', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const research = registry.phases.find((p) => p.id === 'research');
  assert.deepEqual(research.exit_checks, [
    { file: 'research/index.json', check: 'file-nonempty' },
    { file: 'research/scratchpad.jsonl', check: 'jsonl-min-records:3' },
    { file: 'research/scratchpad.jsonl', check: 'jsonl-has-kind:freshness_gate' },
    { file: 'research/summary.md', check: 'file-nonempty' },
  ]);
});

// --- currentPhase ---

test('currentPhase reads state.phase', () => {
  assert.equal(currentPhase({ phase: 'onboarding' }), 'onboarding');
});

test('currentPhase throws on a state object with no phase field', () => {
  assert.throws(() => currentPhase({}), /no valid "phase" field/);
});

test('currentPhase throws when given a non-object', () => {
  assert.throws(() => currentPhase(null), /requires a state object/);
});

// --- canEnter ---

test('canEnter("onboarding") is always ok — entry_requires is empty', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const tmp = makeTmpDir();
  const result = canEnter(tmp, registry, 'onboarding');
  assert.deepEqual(result, { ok: true, missing: [] });
});

test('canEnter("research") refuses on a freshly scaffolded tree missing vision/vision.md', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const result = canEnter(treeRoot, registry, 'research');
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes(path.join('vision', 'vision.md')));
});

test('canEnter("brainstorm") succeeds once onboarding artifacts exist on a scaffolded tree', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  // scaffoldTree already lands state.json/settings.json/routing/active.json/ledger.jsonl
  const result = canEnter(treeRoot, registry, 'brainstorm');
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('canEnter throws on an unknown phase id', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const tmp = makeTmpDir();
  assert.throws(() => canEnter(tmp, registry, 'nope'), /unknown phase id/);
});

// --- canEnter("implementation"): "architecture-gate-approved" entry check
// (P2 review [blocker] #1 — presence of architecture/gate.json alone used to
// be sufficient regardless of its decision or digest) ---

test('canEnter("implementation") succeeds when the architecture gate is approved and digest-matched', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath);

  const result = canEnter(treeRoot, registry, 'implementation');
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('advance walks plan_gate -> implementation once the architecture gate is approved and digest-matched', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath);

  const result = advance(treeRoot, registry, statePath, ledgerPath);
  assert.equal(result.from, 'plan_gate');
  assert.equal(result.to, 'implementation');
});

test('canEnter("implementation") refuses a gate.json that exists but reports decision="rejected"', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath);

  const gatePath = path.join(treeRoot, 'architecture', 'gate.json');
  const gate = readJson(gatePath);
  writeAtomic(gatePath, { ...gate, decision: 'rejected' });

  const result = canEnter(treeRoot, registry, 'implementation');
  assert.equal(result.ok, false);
  assert.ok(result.missing.some((m) => m.includes('architecture-gate-approved') && m.includes('rejected')));
});

test('advance refuses plan_gate -> implementation when gate.json reports decision="reopened"', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath);

  const gatePath = path.join(treeRoot, 'architecture', 'gate.json');
  const gate = readJson(gatePath);
  writeAtomic(gatePath, { ...gate, decision: 'reopened' });

  assert.throws(() => advance(treeRoot, registry, statePath, ledgerPath), /architecture-gate-approved/);
  assert.equal(readJson(statePath).phase, 'plan_gate'); // refusal must not mutate state.json
});

test('canEnter("implementation") refuses when an approved gate\'s manifest_digest no longer matches the architecture artifacts on disk', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath);

  // tamper with an approved architecture artifact AFTER the gate sealed it
  writeAtomic(path.join(treeRoot, 'architecture', 'plan.md'), { stub: 'architecture:plan.md', tampered: true });

  const result = canEnter(treeRoot, registry, 'implementation');
  assert.equal(result.ok, false);
  assert.ok(result.missing.some((m) => m.includes('architecture-gate-approved')));
});

// --- "milestones-all-green" exit check (implementation -> verification) ---

test('advance refuses implementation -> verification when milestones/index.json does not exist yet', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath); // plan_gate
  advance(treeRoot, registry, statePath, ledgerPath); // plan_gate -> implementation

  assert.throws(() => advance(treeRoot, registry, statePath, ledgerPath), /exit_emits missing/);
  assert.equal(readJson(statePath).phase, 'implementation'); // refusal must not mutate state.json
});

test('advance refuses implementation -> verification when a milestone is still "open" (not closed green)', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> implementation
  createMilestone(treeRoot, { id: 'M1', title: 'Never closes', designer_family: 'gpt' });
  recordChunk(treeRoot, 'M1', { kind: 'chunk-spec', chunk_id: 'C1', brief_ref: 'M1/spec.md#C1' });

  assert.throws(() => advance(treeRoot, registry, statePath, ledgerPath), /milestones-all-green.*not status "green"/s);
  assert.equal(readJson(statePath).phase, 'implementation');
});

test('advance walks implementation -> verification once every milestone has closed green', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);

  const result = advance(treeRoot, registry, statePath, ledgerPath);
  assert.equal(result.from, 'implementation');
  assert.equal(result.to, 'verification');
});

// --- "suite-state-green" exit check (verification -> delivery) ---

test('loadRegistry accepts "suite-state-green" as a known exit check', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [
      {
        id: 'a',
        order: 1,
        title: 'A',
        interactive: false,
        entry_requires: [],
        exit_emits: [],
        exit_checks: [{ file: 'x.json', check: 'suite-state-green' }],
        resumable: true,
      },
    ],
  });
  const registry = loadRegistry(file);
  assert.deepEqual(registry.phases[0].exit_checks, [{ file: 'x.json', check: 'suite-state-green' }]);
});

test('the canonical registry\'s verification phase declares suite-state-green and affected-map file-nonempty exit_checks', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const verification = registry.phases.find((p) => p.id === 'verification');
  assert.deepEqual(verification.exit_checks, [
    { file: 'verification/suite-state.json', check: 'suite-state-green' },
    { file: 'verification/affected-map.json', check: 'file-nonempty' },
  ]);
});

test('advance refuses verification -> delivery when verification/suite-state.json does not exist yet', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  assert.throws(() => advance(treeRoot, registry, statePath, ledgerPath), /exit_emits missing/);
  assert.equal(readJson(statePath).phase, 'verification');
});

test('advance refuses verification -> delivery when suite-state.json reports status "red"', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];
  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1', cmd: 'x', exit_code: 1 }, correlation_id: 'gate-j1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'fail', duration_ms: 10, gate_id: 'gate-j1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite);

  assert.throws(() => advance(treeRoot, registry, statePath, ledgerPath), /suite-state-green.*not "green"/s);
  assert.equal(readJson(statePath).phase, 'verification');
});

test('advance walks verification -> delivery once suite-state.json is green and affected-map.json is non-empty', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];
  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite);

  const result = advance(treeRoot, registry, statePath, ledgerPath);
  assert.equal(result.from, 'verification');
  assert.equal(result.to, 'delivery');
});

test('REGRESSION (P8 required revision #2): advance refuses verification -> delivery when suite-state.json\'s run_id is stale (a newer run has since started)', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];

  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1-run1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1-run1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1-run1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite); // green, but about to go stale

  // A newer run starts (e.g. a fix-loop re-run) but suite-state.json is never
  // recomputed against it — the persisted green now describes a superseded run.
  startRun(treeRoot, 'run-2', suite);

  assert.throws(() => advance(treeRoot, registry, statePath, ledgerPath), /stale green rejected/);
  assert.equal(readJson(statePath).phase, 'verification');
});

test('advance refuses implementation -> verification when milestones/index.json declares zero milestones', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> implementation
  writeAtomic(path.join(treeRoot, 'milestones', 'index.json'), { schema_version: 1, milestones: [] });

  assert.throws(() => advance(treeRoot, registry, statePath, ledgerPath), /zero milestones/);
});

// --- advance: happy path onboarding -> brainstorm ---

test('advance walks a scaffolded tree from onboarding to brainstorm and writes state + ledger', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  const before = readJson(statePath);
  assert.equal(before.phase, 'onboarding');

  const result = advance(treeRoot, registry, statePath, ledgerPath);
  assert.equal(result.from, 'onboarding');
  assert.equal(result.to, 'brainstorm');
  assert.equal(result.state.phase, 'brainstorm');
  assert.equal(result.state.phase_status.onboarding, 'complete');
  assert.equal(result.state.next_action, 'brainstorm');

  const onDisk = readJson(statePath);
  assert.equal(onDisk.phase, 'brainstorm');

  const { records } = readAll(ledgerPath);
  const transitions = records.filter((r) => r.kind === 'phase-transition');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].from, 'onboarding');
  assert.equal(transitions[0].to, 'brainstorm');
  assert.equal(transitions[0].correlation_id, 'brainstorm');
});

test('advance walks onboarding -> brainstorm -> research once brainstorm artifacts land', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm

  // simulate the brainstorm facilitator + crystallizer landing their
  // artifacts: a crystallized vision.md, a real decision, a sealed
  // transcript (vision/decisions.jsonl already exists — genesis record from
  // scaffoldTree — but a genesis-only stream doesn't satisfy the
  // jsonl-min-records:1 exit check below).
  sealBrainstormExit(treeRoot);

  const result = advance(treeRoot, registry, statePath, ledgerPath); // brainstorm -> research
  assert.equal(result.from, 'brainstorm');
  assert.equal(result.to, 'research');
  assert.equal(readJson(statePath).phase, 'research');
});

// --- advance: research exit_checks (P5 fix pass — jsonl-has-kind:freshness_gate
// and summary.md file-nonempty; presence-of-evidence, not truth-of-evidence:
// these prove a gate record and a non-empty summary exist, never that the
// gate decision or the summary's content were correct) ---

function walkToResearch(treeRoot, registry, statePath, ledgerPath) {
  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm
  sealBrainstormExit(treeRoot);
  advance(treeRoot, registry, statePath, ledgerPath); // brainstorm -> research
}

test('advance refuses to leave research when scratchpad.jsonl carries no freshness_gate record', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  walkToResearch(treeRoot, registry, statePath, ledgerPath);
  writeAtomic(path.join(treeRoot, 'research', 'index.json'), { stub: 'research:index.json' });
  fs.writeFileSync(path.join(treeRoot, 'research', 'summary.md'), '# Research summary\n\nstub.\n');
  for (let i = 0; i < 3; i++) {
    appendRecord(path.join(treeRoot, 'research', 'scratchpad.jsonl'), { kind: 'note', payload: { text: `stub note ${i}` } });
  }
  // no freshness_gate record appended — the cache-first gate never proved it ran

  assert.throws(
    () => advance(treeRoot, registry, statePath, ledgerPath),
    /exit_checks failed.*jsonl-has-kind:freshness_gate.*no non-genesis record with kind "freshness_gate"/s
  );
  assert.equal(readJson(statePath).phase, 'research');
});

test('advance refuses to leave research when summary.md exists but is empty', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  walkToResearch(treeRoot, registry, statePath, ledgerPath);
  writeAtomic(path.join(treeRoot, 'research', 'index.json'), { stub: 'research:index.json' });
  fs.writeFileSync(path.join(treeRoot, 'research', 'summary.md'), '   \n  \n'); // whitespace only
  for (let i = 0; i < 3; i++) {
    appendRecord(path.join(treeRoot, 'research', 'scratchpad.jsonl'), { kind: 'note', payload: { text: `stub note ${i}` } });
  }
  appendRecord(path.join(treeRoot, 'research', 'scratchpad.jsonl'), {
    kind: 'freshness_gate',
    payload: { topic: 't', fresh: true, reason: 'r', load_bearing: false },
  });

  assert.throws(
    () => advance(treeRoot, registry, statePath, ledgerPath),
    /exit_checks failed.*file-nonempty.*summary\.md.*is empty/s
  );
  assert.equal(readJson(statePath).phase, 'research');
});

test('advance leaves research once index/summary/scratchpad all satisfy exit_checks, including a real freshness_gate record', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  walkToResearch(treeRoot, registry, statePath, ledgerPath);
  writeAtomic(path.join(treeRoot, 'research', 'index.json'), { stub: 'research:index.json' });
  fs.writeFileSync(path.join(treeRoot, 'research', 'summary.md'), '# Research summary\n\nstub.\n');
  for (let i = 0; i < 3; i++) {
    appendRecord(path.join(treeRoot, 'research', 'scratchpad.jsonl'), { kind: 'note', payload: { text: `stub note ${i}` } });
  }
  appendRecord(path.join(treeRoot, 'research', 'scratchpad.jsonl'), {
    kind: 'freshness_gate',
    payload: { topic: 't', fresh: true, reason: 'r', load_bearing: false },
  });

  const result = advance(treeRoot, registry, statePath, ledgerPath); // research -> architecture
  assert.equal(result.from, 'research');
  assert.equal(result.to, 'architecture');
});

// --- advance: refusal ---

test('advance refuses to leave brainstorm before vision/vision.md exists', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm

  assert.throws(
    () => advance(treeRoot, registry, statePath, ledgerPath),
    /exit_emits missing.*vision.*vision\.md/s
  );

  // refusal must not have mutated state.json
  assert.equal(readJson(statePath).phase, 'brainstorm');
});

// --- advance: exit_checks refusals (P4 Sol review MAJOR #5) — file
// existence alone is no longer sufficient to leave brainstorm ---

test('advance refuses to leave brainstorm when vision/transcript.jsonl exists but its last record is not sealed', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm
  fs.writeFileSync(path.join(treeRoot, 'vision', 'vision.md'), '# Vision\n\ncrystallized.\n');
  appendRecord(path.join(treeRoot, 'vision', 'decisions.jsonl'), { kind: 'decision', payload: { text: 'stub decision' } });
  appendRecord(path.join(treeRoot, 'vision', 'transcript.jsonl'), { kind: 'idea', payload: { text: 'still talking' } }); // never sealed

  assert.throws(
    () => advance(treeRoot, registry, statePath, ledgerPath),
    /exit_checks failed.*jsonl-sealed.*not kind "sealed"/s
  );
  assert.equal(readJson(statePath).phase, 'brainstorm');
});

test('advance refuses to leave brainstorm when vision/transcript.jsonl carries only its scaffold-time genesis record (facilitator never ran)', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm
  fs.writeFileSync(path.join(treeRoot, 'vision', 'vision.md'), '# Vision\n\ncrystallized.\n');
  appendRecord(path.join(treeRoot, 'vision', 'decisions.jsonl'), { kind: 'decision', payload: { text: 'stub decision' } });
  // vision/transcript.jsonl still carries only the genesis record scaffoldTree
  // wrote — no facilitator ever appended to it, let alone sealed it.

  assert.throws(
    () => advance(treeRoot, registry, statePath, ledgerPath),
    /exit_checks failed.*jsonl-sealed.*not kind "sealed"/s
  );
  assert.equal(readJson(statePath).phase, 'brainstorm');
});

test('advance refuses to leave brainstorm when vision/transcript.jsonl has been deleted entirely', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm
  fs.writeFileSync(path.join(treeRoot, 'vision', 'vision.md'), '# Vision\n\ncrystallized.\n');
  appendRecord(path.join(treeRoot, 'vision', 'decisions.jsonl'), { kind: 'decision', payload: { text: 'stub decision' } });
  fs.rmSync(path.join(treeRoot, 'vision', 'transcript.jsonl'), { force: true });

  assert.throws(
    () => advance(treeRoot, registry, statePath, ledgerPath),
    /exit_checks failed.*jsonl-sealed.*has no records/s
  );
  assert.equal(readJson(statePath).phase, 'brainstorm');
});

test('advance refuses to leave brainstorm when decisions.jsonl carries only its genesis record', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm
  fs.writeFileSync(path.join(treeRoot, 'vision', 'vision.md'), '# Vision\n\ncrystallized.\n');
  appendRecord(path.join(treeRoot, 'vision', 'transcript.jsonl'), { kind: 'sealed', payload: {} });
  // decisions.jsonl never gets a real decision appended — genesis only

  assert.throws(
    () => advance(treeRoot, registry, statePath, ledgerPath),
    /exit_checks failed.*jsonl-min-records:1.*0 non-genesis record/s
  );
  assert.equal(readJson(statePath).phase, 'brainstorm');
});

test('advance refuses to leave brainstorm when vision.md exists but is empty', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm
  fs.writeFileSync(path.join(treeRoot, 'vision', 'vision.md'), '   \n  \n'); // whitespace only
  appendRecord(path.join(treeRoot, 'vision', 'decisions.jsonl'), { kind: 'decision', payload: { text: 'stub decision' } });
  appendRecord(path.join(treeRoot, 'vision', 'transcript.jsonl'), { kind: 'sealed', payload: {} });

  assert.throws(
    () => advance(treeRoot, registry, statePath, ledgerPath),
    /exit_checks failed.*file-nonempty.*is empty/s
  );
  assert.equal(readJson(statePath).phase, 'brainstorm');
});

test('advance leaves brainstorm once vision.md is non-stub, decisions.jsonl has a real decision, and transcript.jsonl is sealed', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  advance(treeRoot, registry, statePath, ledgerPath); // onboarding -> brainstorm
  sealBrainstormExit(treeRoot);

  const result = advance(treeRoot, registry, statePath, ledgerPath);
  assert.equal(result.from, 'brainstorm');
  assert.equal(result.to, 'research');
});

test('advance appends the ledger event before writing state.json — a failed ledger append leaves the pre-transition state completely untouched (regression, P2 review blocker #2)', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  // An existing directory (not a file) as ledgerPath: appendRecord's
  // readAll() -> fs.readFileSync() throws EISDIR, reproducing the exact
  // fault the review injected against the original (state-first) ordering.
  const badLedgerPath = path.join(treeRoot, 'architecture');

  const before = readJson(statePath);
  assert.equal(before.phase, 'onboarding');

  assert.throws(() => advance(treeRoot, registry, statePath, badLedgerPath));

  const after = readJson(statePath);
  assert.deepEqual(after, before); // byte-for-byte untouched, not merely same phase
});

// Real lost-update proof (P11 convergence finding 21 — a mid-phase stop and
// a concurrent phase transition both read-then-write state.json; per-file
// atomic writes alone don't stop one from silently clobbering the other's
// update). Two SEPARATE processes race the identical advance() CLI call
// against the same freshly-scaffolded tree, which has exactly one legal
// transition available (onboarding -> brainstorm). updateJson's shared lock
// must serialize them: exactly one wins and writes the real transition,
// exactly one ledger "phase-transition" record exists (never two, never
// zero), and the loser's own decision is made against a FRESH,
// post-transition read (state.phase already "brainstorm", whose own
// exit_emits are not yet satisfied) rather than a stale pre-lock snapshot
// that would have let it also believe onboarding->brainstorm was still live.
test('advance(): two competing processes racing the same legal transition never lose or duplicate the update (real lost-update proof)', async () => {
  const { spawn } = require('node:child_process');
  const CLI_PATH = path.join(__dirname, '..', 'src', 'phases.js');
  const treeRoot = scaffoldedTreeRoot();

  const runAdvance = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, 'advance', treeRoot]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });

  const [a, b] = await Promise.all([runAdvance(), runAdvance()]);
  const outcomes = [a, b];
  const succeeded = outcomes.filter((o) => o.code === 0);
  const failed = outcomes.filter((o) => o.code !== 0);

  assert.equal(succeeded.length, 1, 'exactly one of the two racing advance() calls must succeed');
  assert.equal(failed.length, 1, 'exactly one of the two racing advance() calls must fail closed');
  assert.match(failed[0].stderr, /cannot advance|exit_emits missing/);

  const finalState = readJson(path.join(treeRoot, 'state.json'));
  assert.equal(finalState.phase, 'brainstorm'); // the real transition landed, exactly once

  const { records } = readAll(path.join(treeRoot, 'ledger.jsonl'));
  const transitions = records.filter((r) => r.kind === 'phase-transition');
  assert.equal(transitions.length, 1, 'exactly one phase-transition ledger record — no lost update, no duplicate');
  assert.deepEqual(
    { from: transitions[0].from, to: transitions[0].to },
    { from: 'onboarding', to: 'brainstorm' }
  );
});

// --- closeTerminal: the terminal-phase counterpart to advance() (P9
// delivery-phase need — advance() itself always throws "terminal phase...
// nothing to advance to" against delivery, by construction, since no
// order+1 phase exists for it to enter) ---

test('closeTerminal closes the delivery phase once all four exit artifacts + exit_checks are satisfied', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];
  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite);

  advance(treeRoot, registry, statePath, ledgerPath); // -> delivery
  assembleLastMile(treeRoot);
  renderFacts(treeRoot);
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'last-mile-report.md'), '# Last mile\n\nNothing outstanding.\n');
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'presentation.md'), '# Delivered\n\nBuild complete.\n');

  const result = closeTerminal(treeRoot, registry, statePath, ledgerPath);
  assert.equal(result.phase, 'delivery');
  assert.equal(result.state.phase_status.delivery, 'complete');
  assert.equal(result.state.next_action, 'done');
  assert.equal(readJson(statePath).next_action, 'done');
  assert.equal(readJson(statePath).phase, 'delivery');
});

test('closeTerminal refuses (throws) when called on a phase that is not the registry\'s own terminal (highest-order) phase', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot(); // fresh tree: phase is "onboarding" (order 1)
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  assert.throws(
    () => closeTerminal(treeRoot, registry, statePath, ledgerPath),
    /only the registry's own terminal phase/
  );
});

test('closeTerminal refuses (throws) when the terminal phase\'s exit_emits are not yet all on disk', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];
  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite);
  advance(treeRoot, registry, statePath, ledgerPath); // -> delivery, nothing else written yet

  assert.throws(() => closeTerminal(treeRoot, registry, statePath, ledgerPath), /exit_emits missing/);
  assert.equal(readJson(statePath).phase, 'delivery');
});

test('closeTerminal refuses (throws) when exit_checks fail even though exit_emits files exist (e.g. an empty presentation.md)', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];
  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite);
  advance(treeRoot, registry, statePath, ledgerPath); // -> delivery

  assembleLastMile(treeRoot);
  renderFacts(treeRoot);
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'last-mile-report.md'), '# Last mile\n\nNothing outstanding.\n');
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'presentation.md'), '   \n'); // whitespace-only: file-nonempty fails

  assert.throws(() => closeTerminal(treeRoot, registry, statePath, ledgerPath), /exit_checks failed/);
});

test('REGRESSION (P9 required revision #3; P9 Sol review BLOCKING #3: "closeTerminal can succeed when checkDeliveryReady is false"): closeTerminal refuses a red suite even though every delivery exit_emits file is present and nonempty', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];
  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite); // green
  advance(treeRoot, registry, statePath, ledgerPath); // -> delivery

  // A second run starts and goes RED while already in the delivery phase —
  // no advance() call gates this (delivery has no next phase), so this is
  // the only way a red current run can coexist with delivery's own
  // exit_emits — exactly the shape a real fix-loop re-run in delivery would
  // leave behind.
  startRun(treeRoot, 'run-2', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1-run2', cmd: 'x', exit_code: 1 }, correlation_id: 'gate-j1-run2' });
  recordRun(treeRoot, 'run-2', [{ journey_id: 'j1', status: 'fail', duration_ms: 10, gate_id: 'gate-j1-run2' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-2', { schema_version: 1, entries: [] }, suite); // red, and current

  // Both delivery projections are freshly generated against the CURRENT
  // (red) run — run-bound is satisfied, isolating this test to the one
  // thing that must still refuse: the suite itself is not green.
  assembleLastMile(treeRoot);
  renderFacts(treeRoot);
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'last-mile-report.md'), '# Last mile\n\nNothing outstanding.\n');
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'presentation.md'), '# Delivered\n\nBuild complete.\n');

  assert.equal(checkDeliveryReady(treeRoot).ok, false);
  assert.throws(() => closeTerminal(treeRoot, registry, statePath, ledgerPath), /exit_checks failed.*suite-state-green/s);
  // Refused closure must leave state.json untouched — still mid-delivery,
  // never flipped to "done".
  assert.equal(readJson(statePath).next_action, 'delivery');
  assert.equal(readJson(statePath).phase_status.delivery, undefined);
});

test('REGRESSION (P9 required revision #1 wired into #3): closeTerminal refuses when delivery projections are stale (checkDeliveryReady false via run-bound) even though every delivery exit_emits file is present and nonempty', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];
  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite);
  advance(treeRoot, registry, statePath, ledgerPath); // -> delivery

  assembleLastMile(treeRoot);
  renderFacts(treeRoot);
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'last-mile-report.md'), '# Last mile\n\nNothing outstanding.\n');
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'presentation.md'), '# Delivered\n\nBuild complete.\n');

  // A second run starts and goes GREEN, but the delivery projections are
  // never regenerated — last-mile.json/facts.json still name run-1 while
  // the live suite is current on run-2. Every exit_emits file remains
  // present and nonempty throughout.
  startRun(treeRoot, 'run-2', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1-run2', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1-run2' });
  recordRun(treeRoot, 'run-2', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1-run2' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-2', { schema_version: 1, entries: [] }, suite);

  assert.equal(checkDeliveryReady(treeRoot).ok, false);
  assert.throws(() => closeTerminal(treeRoot, registry, statePath, ledgerPath), /exit_checks failed.*run-bound/s);
  // Refused closure must leave state.json untouched — still mid-delivery,
  // never flipped to "done".
  assert.equal(readJson(statePath).next_action, 'delivery');
  assert.equal(readJson(statePath).phase_status.delivery, undefined);
});

test('REGRESSION (P9 required revision #3; P9 Sol review MAJOR: "terminal closure is not exactly-once"): a second closeTerminal call throws, and the ledger carries exactly one phase-terminal record', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];
  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite);
  advance(treeRoot, registry, statePath, ledgerPath); // -> delivery

  assembleLastMile(treeRoot);
  renderFacts(treeRoot);
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'last-mile-report.md'), '# Last mile\n\nNothing outstanding.\n');
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'presentation.md'), '# Delivered\n\nBuild complete.\n');

  closeTerminal(treeRoot, registry, statePath, ledgerPath);
  assert.equal(readJson(statePath).next_action, 'done');

  assert.throws(
    () => closeTerminal(treeRoot, registry, statePath, ledgerPath),
    /already closed/
  );

  const { records } = readAll(ledgerPath);
  const terminals = records.filter((r) => r.kind === 'phase-terminal');
  assert.equal(terminals.length, 1);
  assert.equal(readJson(statePath).next_action, 'done');
  assert.equal(readJson(statePath).phase_status.delivery, 'complete');
});

test('advance throws when state.json is missing', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const tmp = makeTmpDir();
  assert.throws(
    () => advance(tmp, registry, path.join(tmp, 'state.json'), path.join(tmp, 'ledger.jsonl')),
    /no state\.json found/
  );
});

test('advance throws on the terminal phase (delivery) with nothing to advance to', () => {
  const tmp = makeTmpDir();
  const file = writeRegistry(tmp, {
    schema_version: 1,
    phases: [{ id: 'delivery', order: 1, title: 'Delivery', interactive: false, entry_requires: [], exit_emits: [], resumable: true }],
  });
  const registry = loadRegistry(file);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  const state = readJson(statePath);
  const { writeAtomic } = require('../src/atomic-json.js');
  writeAtomic(statePath, { ...state, phase: 'delivery' });

  assert.throws(() => advance(treeRoot, registry, statePath, ledgerPath), /terminal phase/);
});

// --- reopenPhase: the sanctioned reverse transition (P6 Sol review MAJOR,
// ruling (b)'s additional state issue — operator rejection at plan_gate had
// no defined re-entry mechanism) ---

test('reopenPhase rewinds plan_gate back to architecture, un-completing both phases, with a ledger event carrying the rationale', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath); // ends at plan_gate

  const before = readJson(statePath);
  assert.equal(before.phase, 'plan_gate');
  assert.equal(before.phase_status.architecture, 'complete');

  const result = reopenPhase(treeRoot, registry, statePath, ledgerPath, 'architecture', {
    rationale: 'operator rejected: milestone M2 conflates two unrelated slices',
  });

  assert.equal(result.from, 'plan_gate');
  assert.equal(result.to, 'architecture');
  assert.equal(result.state.phase, 'architecture');
  assert.equal(result.state.phase_status.architecture, undefined);

  const onDisk = readJson(statePath);
  assert.equal(onDisk.phase, 'architecture');
  assert.equal(onDisk.phase_status.architecture, undefined);

  const { records } = readAll(ledgerPath);
  const reopens = records.filter((r) => r.kind === 'phase-reopen');
  assert.equal(reopens.length, 1);
  assert.equal(reopens[0].from, 'plan_gate');
  assert.equal(reopens[0].to, 'architecture');
  assert.match(reopens[0].rationale, /milestone M2/);
  assert.equal(reopens[0].correlation_id, 'architecture');
});

test('reopenPhase requires a non-empty rationale', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath);

  assert.throws(() => reopenPhase(treeRoot, registry, statePath, ledgerPath, 'architecture', {}), TypeError);
  assert.throws(() => reopenPhase(treeRoot, registry, statePath, ledgerPath, 'architecture', { rationale: '' }), TypeError);
});

test('reopenPhase refuses a target phase that is not strictly earlier than the current phase', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath); // at plan_gate

  assert.throws(
    () => reopenPhase(treeRoot, registry, statePath, ledgerPath, 'plan_gate', { rationale: 'x' }),
    /must be strictly earlier/
  );
  assert.throws(
    () => reopenPhase(treeRoot, registry, statePath, ledgerPath, 'implementation', { rationale: 'x' }),
    /must be strictly earlier/
  );
  assert.equal(readJson(statePath).phase, 'plan_gate'); // refusal must not mutate state.json
});

test('reopenPhase refuses a target phase that was never completed', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath); // plan_gate; research IS complete

  // Simulate a data-integrity gap: research's completion record is missing
  // even though the current phase (plan_gate) is well past it.
  const state = readJson(statePath);
  const { research, ...phaseStatusWithoutResearch } = state.phase_status;
  writeAtomic(statePath, { ...state, phase_status: phaseStatusWithoutResearch });

  assert.throws(
    () => reopenPhase(treeRoot, registry, statePath, ledgerPath, 'research', { rationale: 'x' }),
    /research.*was never completed/s
  );
});

test('reopenPhase leaves no stale "complete" phase between the target and the phase being rewound from', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath); // plan_gate, with onboarding/brainstorm/research/architecture all complete

  const result = reopenPhase(treeRoot, registry, statePath, ledgerPath, 'research', { rationale: 'research findings were stale' });
  assert.equal(result.state.phase, 'research');
  // research and architecture are both rewound over (research <= X <= plan_gate's predecessor, i.e. architecture) — both lose "complete"
  assert.equal(result.state.phase_status.research, undefined);
  assert.equal(result.state.phase_status.architecture, undefined);
  // earlier, unaffected phases keep their completion record
  assert.equal(result.state.phase_status.onboarding, 'complete');
  assert.equal(result.state.phase_status.brainstorm, 'complete');
});

test('reopenPhase throws when state.json is missing', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const tmp = makeTmpDir();
  assert.throws(
    () => reopenPhase(tmp, registry, path.join(tmp, 'state.json'), path.join(tmp, 'ledger.jsonl'), 'architecture', { rationale: 'x' }),
    /no state\.json found/
  );
});

test('reopenPhase throws TypeError for missing/empty required arguments', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  assert.throws(() => reopenPhase('', registry, statePath, ledgerPath, 'architecture', { rationale: 'x' }), TypeError);
  assert.throws(() => reopenPhase(treeRoot, registry, '', ledgerPath, 'architecture', { rationale: 'x' }), TypeError);
  assert.throws(() => reopenPhase(treeRoot, registry, statePath, '', 'architecture', { rationale: 'x' }), TypeError);
  assert.throws(() => reopenPhase(treeRoot, registry, statePath, ledgerPath, '', { rationale: 'x' }), TypeError);
});

test('CLI: reopen command rewinds a phase with --rationale', () => {
  const { spawnSync } = require('node:child_process');
  const CLI_PATH = path.join(__dirname, '..', 'src', 'phases.js');
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughArchitecture(treeRoot, registry, statePath, ledgerPath);

  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'reopen', treeRoot, 'architecture', '--rationale', 'operator rejected the plan'],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(readJson(statePath).phase, 'architecture');
});

test('CLI: close-terminal command closes the delivery phase', () => {
  const { spawnSync } = require('node:child_process');
  const CLI_PATH = path.join(__dirname, '..', 'src', 'phases.js');
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  buildThroughImplementation(treeRoot, registry, statePath, ledgerPath);
  advance(treeRoot, registry, statePath, ledgerPath); // -> verification

  writeAtomic(path.join(treeRoot, 'verification', 'affected-map.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: [],
  });
  const suite = [{ journey_id: 'j1' }];
  startRun(treeRoot, 'run-1', suite);
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'gate-j1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-j1' });
  recordRun(treeRoot, 'run-1', [{ journey_id: 'j1', status: 'pass', duration_ms: 10, gate_id: 'gate-j1' }], ledgerPath);
  computeSuiteState(treeRoot, 'run-1', { schema_version: 1, entries: [] }, suite);
  advance(treeRoot, registry, statePath, ledgerPath); // -> delivery

  assembleLastMile(treeRoot);
  renderFacts(treeRoot);
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'last-mile-report.md'), '# Last mile\n\nNothing outstanding.\n');
  fs.writeFileSync(path.join(treeRoot, 'delivery', 'presentation.md'), '# Delivered\n\nBuild complete.\n');

  const proc = spawnSync(process.execPath, [CLI_PATH, 'close-terminal', treeRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(readJson(statePath).next_action, 'done');
  assert.equal(readJson(statePath).phase_status.delivery, 'complete');
});

// --- resumePoint ---

test('resumePoint on a freshly scaffolded tree reports the onboarding-complete phase (brainstorm) as resumable', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');

  const point = resumePoint(treeRoot, registry, statePath);
  assert.equal(point.phase, 'onboarding');
  assert.equal(point.canResume, true);
  assert.deepEqual(point.missing, []);
});

test('resumePoint on a half-built tree (state says architecture, artifacts absent) reports canResume:false with the missing list', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const state = readJson(statePath);
  const { writeAtomic } = require('../src/atomic-json.js');
  writeAtomic(statePath, { ...state, phase: 'architecture' });

  const point = resumePoint(treeRoot, registry, statePath);
  assert.equal(point.phase, 'architecture');
  assert.equal(point.canResume, false);
  assert.ok(point.missing.includes(path.join('vision', 'vision.md')));
  assert.ok(point.missing.includes('research/index.json'.replace('/', path.sep)));
});

test('resumePoint reports canResume:false when state.json does not exist', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  const tmp = makeTmpDir();
  const point = resumePoint(tmp, registry, path.join(tmp, 'state.json'));
  assert.equal(point.phase, null);
  assert.equal(point.canResume, false);
  assert.deepEqual(point.missing, ['state.json']);
});

// --- CLI: resume (P11 Sol review finding 15(i)) — pinning the exit/result
// contract in both canResume outcomes: this is a query, not a gate, so it
// prints the full JSON result and exits 0 either way; the caller (Maestro)
// is the one that must branch on the printed canResume field, never the
// process exit code.

test('CLI: resume command exits 0 and prints the full JSON result when canResume is true', () => {
  const { spawnSync } = require('node:child_process');
  const CLI_PATH = path.join(__dirname, '..', 'src', 'phases.js');
  const treeRoot = scaffoldedTreeRoot();

  const proc = spawnSync(process.execPath, [CLI_PATH, 'resume', treeRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.phase, 'onboarding');
  assert.equal(printed.canResume, true);
  assert.deepEqual(printed.missing, []);
});

test('CLI: resume command ALSO exits 0 and prints canResume:false with the missing list when disk does not back state.json\'s claim', () => {
  const { spawnSync } = require('node:child_process');
  const CLI_PATH = path.join(__dirname, '..', 'src', 'phases.js');
  const treeRoot = scaffoldedTreeRoot();
  const statePath = path.join(treeRoot, 'state.json');
  const state = readJson(statePath);
  writeAtomic(statePath, { ...state, phase: 'architecture' });

  const proc = spawnSync(process.execPath, [CLI_PATH, 'resume', treeRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.phase, 'architecture');
  assert.equal(printed.canResume, false);
  assert.ok(printed.missing.length > 0);
});
