'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { scaffoldTree } = require('../src/scaffold.js');
const { run, DEFAULT_CODEX_CMD, DEGRADED_NOTICE, TREE_NAME } = require('../src/preflight.js');
const { readJson } = require('../src/atomic-json.js');
const { readRecords } = require('../src/stream.js');

const ROUTING_CONFIG = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');
const CLI_PATH = path.join(__dirname, '..', 'src', 'preflight.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));
}

function scaffoldedProjectRoot() {
  const dir = makeTmpDir();
  const projectRoot = path.join(dir, 'proj');
  scaffoldTree(projectRoot, { routingConfigPath: ROUTING_CONFIG });
  return projectRoot;
}

function statePathFor(projectRoot) {
  return path.join(projectRoot, TREE_NAME, 'state.json');
}

function ledgerPathFor(projectRoot) {
  return path.join(projectRoot, TREE_NAME, 'ledger.jsonl');
}

// A real, committed git repo at `dir` — used ONLY by CLI-level tests below,
// which control the child process's own cwd via spawnSync's `cwd` option.
// check-honesty.js's runGate takes no cwd parameter (by design — see
// preflight.js's own header comment), so an in-process `run()` call's git
// subprocess always inherits THIS test process's ambient cwd, not `dir` —
// only a spawned child process can be pointed at a specific git state.
function initGitRepo(dir) {
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'preflight-test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Preflight Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), 'preflight test fixture\n');
  spawnSync('git', ['add', 'README.md'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

// --- codex-fail -> degraded mode, notice verbatim, ledger evidence ---

test('run: codex failure yields degraded-claude-only mode with preflight.md\'s exact notice sentence stored verbatim', () => {
  const projectRoot = scaffoldedProjectRoot();

  const result = run(projectRoot, { workflowTool: false, agentTeams: false, codexCmd: 'exit 1' });

  assert.equal(result.mode, 'degraded-claude-only');

  const state = readJson(statePathFor(projectRoot));
  assert.equal(state.preflight.mode, 'degraded-claude-only');
  assert.equal(state.preflight.notice, DEGRADED_NOTICE);

  const { records } = readRecords(ledgerPathFor(projectRoot));
  const modeRecord = records.find((r) => r.kind === 'preflight' && r.correlation_id === 'codex-preflight');
  assert.ok(modeRecord, 'expected a kind:"preflight" ledger record for the degraded-mode decision');
  assert.equal(modeRecord.check, 'codex-responsive');
  assert.equal(modeRecord.ok, false);
  assert.equal(modeRecord.mode, 'degraded-claude-only');
});

test('run: codex success yields full-cross-family mode with a null notice', () => {
  const projectRoot = scaffoldedProjectRoot();

  const result = run(projectRoot, { workflowTool: true, agentTeams: true, codexCmd: 'exit 0' });

  assert.equal(result.mode, 'full-cross-family');
  const state = readJson(statePathFor(projectRoot));
  assert.equal(state.preflight.mode, 'full-cross-family');
  assert.equal(state.preflight.notice, null);

  const { records } = readRecords(ledgerPathFor(projectRoot));
  assert.ok(!records.some((r) => r.kind === 'preflight' && r.correlation_id === 'codex-preflight'));
});

// --- missing capability flags -> fail closed, nothing written ---

test('run: missing opts.workflowTool throws a TypeError and writes nothing', () => {
  const projectRoot = scaffoldedProjectRoot();
  const stateBefore = fs.readFileSync(statePathFor(projectRoot), 'utf8');
  const ledgerBefore = fs.readFileSync(ledgerPathFor(projectRoot), 'utf8');

  assert.throws(() => run(projectRoot, { agentTeams: true, codexCmd: 'exit 0' }), TypeError);

  assert.equal(fs.readFileSync(statePathFor(projectRoot), 'utf8'), stateBefore);
  assert.equal(fs.readFileSync(ledgerPathFor(projectRoot), 'utf8'), ledgerBefore);
});

test('run: missing opts.agentTeams throws a TypeError and writes nothing', () => {
  const projectRoot = scaffoldedProjectRoot();
  const stateBefore = fs.readFileSync(statePathFor(projectRoot), 'utf8');
  const ledgerBefore = fs.readFileSync(ledgerPathFor(projectRoot), 'utf8');

  assert.throws(() => run(projectRoot, { workflowTool: true, codexCmd: 'exit 0' }), TypeError);

  assert.equal(fs.readFileSync(statePathFor(projectRoot), 'utf8'), stateBefore);
  assert.equal(fs.readFileSync(ledgerPathFor(projectRoot), 'utf8'), ledgerBefore);
});

test('run: a non-boolean capability value (not merely absent) is also refused', () => {
  const projectRoot = scaffoldedProjectRoot();
  assert.throws(() => run(projectRoot, { workflowTool: 'yes', agentTeams: true, codexCmd: 'exit 0' }), TypeError);
});

// --- agent-teams absent -> present:false recorded honestly ---

test('run: agent-teams absent records present:false in its own kind:"preflight" ledger record', () => {
  const projectRoot = scaffoldedProjectRoot();
  run(projectRoot, { workflowTool: true, agentTeams: false, codexCmd: 'exit 0' });

  const { records } = readRecords(ledgerPathFor(projectRoot));
  const record = records.find((r) => r.kind === 'preflight' && r.correlation_id === 'agent-teams');
  assert.ok(record);
  assert.equal(record.check, 'agent-teams');
  assert.equal(record.present, false);
  assert.equal(record.source, 'session-tool-list');
});

test('run: the Workflow-tool and agent-teams facts never land in state.json.gates[]', () => {
  const projectRoot = scaffoldedProjectRoot();
  const result = run(projectRoot, { workflowTool: false, agentTeams: true, codexCmd: 'exit 0' });
  const gateNames = result.gates.map((g) => g.name);
  assert.ok(!gateNames.includes('workflow-tool'));
  assert.ok(!gateNames.includes('agent-teams'));
});

// --- gates[] entries carry REAL exit codes ---

test('run: a forced-fail codex subprocess records last_result "fail", never "pass"', () => {
  const projectRoot = scaffoldedProjectRoot();
  const result = run(projectRoot, { workflowTool: true, agentTeams: true, codexCmd: 'exit 1' });
  const codexGate = result.gates.find((g) => g.name === 'codex-preflight');
  assert.equal(codexGate.last_result, 'fail');
  assert.equal(codexGate.cmd, 'exit 1');
});

test('run: node always records a real exit code, never hardcoded', () => {
  const projectRoot = scaffoldedProjectRoot();
  const result = run(projectRoot, { workflowTool: true, agentTeams: true, codexCmd: 'exit 0' });
  const nodeGate = result.gates.find((g) => g.name === 'preflight-node');
  assert.equal(nodeGate.cmd, 'node --version');
  assert.equal(nodeGate.last_result, 'pass');
});

test('DEFAULT_CODEX_CMD is preflight.md\'s exact documented pipeline', () => {
  assert.match(DEFAULT_CODEX_CMD, /gpt-5\.6-sol/);
  assert.match(DEFAULT_CODEX_CMD, /grep -qx codex-ok/);
});

// --- state.json merge preserves scaffold's existing fields ---

test('run: preserves every field scaffold.scaffoldTree wrote to state.json, adding only gates/preflight', () => {
  const projectRoot = scaffoldedProjectRoot();
  const before = readJson(statePathFor(projectRoot));

  run(projectRoot, { workflowTool: true, agentTeams: true, codexCmd: 'exit 0' });

  const after = readJson(statePathFor(projectRoot));
  assert.equal(after.schema_version, before.schema_version);
  assert.equal(after.created_ts, before.created_ts);
  assert.equal(after.phase, before.phase);
  assert.deepEqual(after.phase_status, before.phase_status);
  assert.equal(after.current_milestone, before.current_milestone);
  assert.equal(after.current_chunk, before.current_chunk);
  assert.equal(after.next_action, before.next_action);
  assert.ok(Array.isArray(after.gates) && after.gates.length === 3);
  assert.ok(typeof after.preflight === 'object' && after.preflight !== null);
});

test('run: a second run appends to gates[] rather than replacing the first run\'s entries', () => {
  const projectRoot = scaffoldedProjectRoot();
  run(projectRoot, { workflowTool: true, agentTeams: true, codexCmd: 'exit 0' });
  const result = run(projectRoot, { workflowTool: true, agentTeams: false, codexCmd: 'exit 1' });
  assert.equal(result.gates.length, 6);
  assert.equal(result.gates[1].last_result, 'pass');
  assert.equal(result.gates[4].last_result, 'fail');
});

// --- scaffold-first precondition ---

test('run: throws a descriptive error when the tree has not been scaffolded', () => {
  const dir = makeTmpDir();
  assert.throws(
    () => run(dir, { workflowTool: true, agentTeams: true, codexCmd: 'exit 0' }),
    /preflight: no state\.json found/
  );
});

// --- CLI: only spawnSync's own `cwd` can make the git checks deterministic
// (see initGitRepo's header comment above) ---

test('CLI: run prints {mode, gates, capabilities, repo} and all-green including a real git check', () => {
  const projectRoot = scaffoldedProjectRoot();
  initGitRepo(projectRoot);

  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'run', projectRoot, '--workflow-tool', 'present', '--agent-teams', 'present', '--codex-cmd', 'exit 0'],
    { encoding: 'utf8', cwd: projectRoot }
  );
  assert.equal(proc.status, 0, proc.stderr);

  const printed = JSON.parse(proc.stdout);
  assert.deepEqual(Object.keys(printed).sort(), ['capabilities', 'gates', 'mode', 'repo']);
  assert.equal(printed.mode, 'full-cross-family');
  assert.deepEqual(
    printed.gates.map((g) => [g.name, g.last_result]),
    [
      ['preflight-node', 'pass'],
      ['codex-preflight', 'pass'],
      ['preflight-git', 'pass'],
    ]
  );
  assert.equal(printed.repo.branch, 'main');
});

test('CLI: run exits 1 with a preflight.js-prefixed error and writes nothing when a capability flag is missing', () => {
  const projectRoot = scaffoldedProjectRoot();
  const before = fs.readFileSync(statePathFor(projectRoot), 'utf8');

  const proc = spawnSync(process.execPath, [CLI_PATH, 'run', projectRoot, '--agent-teams', 'present'], {
    encoding: 'utf8',
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^preflight\.js: /);
  assert.equal(fs.readFileSync(statePathFor(projectRoot), 'utf8'), before);
});

test('CLI: run refuses a malformed --workflow-tool value', () => {
  const projectRoot = scaffoldedProjectRoot();
  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'run', projectRoot, '--workflow-tool', 'maybe', '--agent-teams', 'present'],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^preflight\.js: /);
});

// --- observed-unknown (P11 convergence parked question (b) AMEND: the
// binary present/absent routing contract stays unchanged, but an
// "observed" annotation preserves whether that boolean was a measured
// reading or a degraded stand-in for an introspection source that
// couldn't be resolved) ---

test('run: without an explicit observed override, capabilities.*.observed defaults to the routing boolean\'s own present/absent reading', () => {
  const projectRoot = scaffoldedProjectRoot();
  const result = run(projectRoot, { workflowTool: true, agentTeams: false, codexCmd: 'exit 0' });
  assert.equal(result.capabilities.workflow_tool.observed, 'present');
  assert.equal(result.capabilities.agent_teams.observed, 'absent');
});

test('run: an explicit observed:"unknown" is recorded in capabilities and ledger evidence when the routing value is false', () => {
  const projectRoot = scaffoldedProjectRoot();
  const result = run(projectRoot, {
    workflowTool: false,
    agentTeams: true,
    codexCmd: 'exit 0',
    workflowToolObserved: 'unknown',
  });
  assert.equal(result.capabilities.workflow_tool.present, false);
  assert.equal(result.capabilities.workflow_tool.observed, 'unknown');

  const { records } = readRecords(ledgerPathFor(projectRoot));
  const record = records.find((r) => r.kind === 'preflight' && r.correlation_id === 'workflow-tool');
  assert.equal(record.present, false);
  assert.equal(record.observed, 'unknown');
});

test('run: an explicit observed:"present" or "absent" is carried through even when it matches the routing value', () => {
  const projectRoot = scaffoldedProjectRoot();
  const result = run(projectRoot, {
    workflowTool: true,
    agentTeams: false,
    codexCmd: 'exit 0',
    workflowToolObserved: 'present',
    agentTeamsObserved: 'absent',
  });
  assert.equal(result.capabilities.workflow_tool.observed, 'present');
  assert.equal(result.capabilities.agent_teams.observed, 'absent');
});

test('run: throws TypeError for an observed value outside present/absent/unknown', () => {
  const projectRoot = scaffoldedProjectRoot();
  assert.throws(
    () => run(projectRoot, { workflowTool: false, agentTeams: true, codexCmd: 'exit 0', workflowToolObserved: 'maybe' }),
    TypeError
  );
});

test('run: refuses observed:"unknown" paired with a routing value of true (an unknown observation must degrade)', () => {
  const projectRoot = scaffoldedProjectRoot();
  assert.throws(
    () => run(projectRoot, { workflowTool: true, agentTeams: true, codexCmd: 'exit 0', workflowToolObserved: 'unknown' }),
    /must route as degraded/
  );
});

test('run: an invalid observed value writes nothing to state.json or ledger.jsonl', () => {
  const projectRoot = scaffoldedProjectRoot();
  const stateBefore = fs.readFileSync(statePathFor(projectRoot), 'utf8');
  const ledgerBefore = fs.readFileSync(ledgerPathFor(projectRoot), 'utf8');
  assert.throws(() =>
    run(projectRoot, { workflowTool: false, agentTeams: true, codexCmd: 'exit 0', workflowToolObserved: 'maybe' })
  );
  assert.equal(fs.readFileSync(statePathFor(projectRoot), 'utf8'), stateBefore);
  assert.equal(fs.readFileSync(ledgerPathFor(projectRoot), 'utf8'), ledgerBefore);
});

test('CLI: --workflow-tool-observed/--agent-teams-observed flow through to capabilities and ledger evidence', () => {
  const projectRoot = scaffoldedProjectRoot();
  const proc = spawnSync(
    process.execPath,
    [
      CLI_PATH,
      'run',
      projectRoot,
      '--workflow-tool',
      'absent',
      '--agent-teams',
      'present',
      '--codex-cmd',
      'exit 0',
      '--workflow-tool-observed',
      'unknown',
      '--agent-teams-observed',
      'present',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.capabilities.workflow_tool.observed, 'unknown');
  assert.equal(printed.capabilities.agent_teams.observed, 'present');
});

test('CLI: an invalid --workflow-tool-observed value exits 1 with a preflight.js-prefixed error', () => {
  const projectRoot = scaffoldedProjectRoot();
  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'run', projectRoot, '--workflow-tool', 'present', '--agent-teams', 'present', '--workflow-tool-observed', 'nope'],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^preflight\.js: /);
  assert.match(proc.stderr, /present, absent, unknown/);
});

// P11 Sol review pass-2 defect 11 / convergence parked question (b)
// STILL-OPEN: a fresh probe passed a misspelled `--workflow-tool-obesrved`
// and the command exited 0, persisting observed:"absent" — recreating the
// measured-absence/unknown collapse the amendment required this module to
// prevent. parseArgv must now refuse ANY unrecognized token, not silently
// drop it.
test('CLI: a misspelled/unrecognized flag exits 1 and writes nothing (Sol\'s own probe)', () => {
  const projectRoot = scaffoldedProjectRoot();
  const stateBefore = fs.readFileSync(statePathFor(projectRoot), 'utf8');
  const ledgerBefore = fs.readFileSync(ledgerPathFor(projectRoot), 'utf8');

  const proc = spawnSync(
    process.execPath,
    [
      CLI_PATH,
      'run',
      projectRoot,
      '--workflow-tool',
      'present',
      '--agent-teams',
      'present',
      '--workflow-tool-obesrved',
      'unknown',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^preflight\.js: /);
  assert.match(proc.stderr, /unrecognized argument/);
  assert.equal(fs.readFileSync(statePathFor(projectRoot), 'utf8'), stateBefore);
  assert.equal(fs.readFileSync(ledgerPathFor(projectRoot), 'utf8'), ledgerBefore);
});

test('CLI: the five checks land in ledger evidence in preflight.md\'s exact document order', () => {
  const projectRoot = scaffoldedProjectRoot();
  initGitRepo(projectRoot);

  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'run', projectRoot, '--workflow-tool', 'present', '--agent-teams', 'present', '--codex-cmd', 'exit 0'],
    { encoding: 'utf8', cwd: projectRoot }
  );
  assert.equal(proc.status, 0, proc.stderr);

  const { records } = readRecords(ledgerPathFor(projectRoot));
  const ordered = records
    .filter((r) => r.kind === 'gate' || r.kind === 'preflight')
    .map((r) => (r.kind === 'gate' ? r.gate_id : r.correlation_id));

  assert.deepEqual(ordered, [
    'preflight-node',
    'codex-preflight',
    'workflow-tool',
    'agent-teams',
    'preflight-git',
    'preflight-git-branch',
  ]);
});
