'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { checkHonesty, runGate, recordDeviation } = require('../src/check-honesty.js');
const { writeAtomic } = require('../src/atomic-json.js');
const { appendLine } = require('../src/jsonl.js');
const { writeManifest, CANONICAL_ARCHITECTURE_ARTIFACTS } = require('../src/manifest.js');
const { scaffoldArchitecture } = require('../src/scaffold.js');
const { writeValidContentArtifacts } = require('./fixtures/valid-architecture-artifacts.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'check-honesty.js');
const PASS_CMD = process.execPath + ' -e "process.exit(0)"';
const FAIL_CMD = process.execPath + ' -e "process.exit(1)"';

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-honesty-test-'));
}

function statePathFor(dir) {
  return path.join(dir, 'handoff-state.json');
}

function ledgerPathFor(dir) {
  return path.join(dir, 'ledger.jsonl');
}

function architectureDirFor(dir) {
  const architectureDir = path.join(dir, 'architecture');
  fs.mkdirSync(architectureDir, { recursive: true });
  return architectureDir;
}

function sha256Of(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function writeContentArtifacts(architectureDir) {
  for (const relFile of CANONICAL_ARCHITECTURE_ARTIFACTS) {
    fs.writeFileSync(path.join(architectureDir, relFile), `content of ${relFile}\n`);
  }
}

// Builds a fully valid, gate-approved architecture directory (five content
// artifacts + manifest.json + gate.json), mirroring what scaffoldArchitecture
// produces for real. Returns the paths so tests can tamper afterward. Uses
// SEMANTICALLY valid content (not the local writeContentArtifacts garbage
// below) because scaffoldArchitecture now delegates to approveGate, which
// (P6 Sol review BLOCKING #1/#3) refuses to seal malformed content.
function sealArchitecture(architectureDir, opts = {}) {
  writeValidContentArtifacts(architectureDir);
  return scaffoldArchitecture(architectureDir, opts);
}

test('green case: gate pass with matching cmd-bound ledger record and gated checklist item -> ok', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [{ status: 'done', verified: true, gate: 'unit-tests' }],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('checklist item verified done without a gate name is a violation, not exempt', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [],
    checklist: [{ status: 'done', verified: true }],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unrelated', cmd: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /names no "gate"/);
});

test('checklist item verified done with an explicit empty-string gate is a violation', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [],
    checklist: [{ status: 'done', verified: true, gate: '' }],
  });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.match(result.violations[0], /names no "gate"/);
});

test('missing gate event: gate reports pass but no ledger record exists at all', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'lint', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'other-gate', cmd: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /lint/);
});

test('gated checklist item verified done without matching ledger record is a violation', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'security-scan', last_result: 'fail', cmd: PASS_CMD }],
    checklist: [{ status: 'done', verified: true, gate: 'security-scan' }],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'other-gate', cmd: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /security-scan/);
});

test('gated checklist item referencing an unregistered gate name is a violation', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [],
    checklist: [{ status: 'done', verified: true, gate: 'ghost-gate' }],
  });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /no declared "cmd"/);
});

test('wrong exit_code: matching kind/gate_id/cmd but nonzero exit_code does not satisfy the gate', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 1 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /unit-tests/);
});

test('wrong cmd: matching kind/gate_id/exit_code but a different cmd does not satisfy the gate', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: 'node --test machine/test/' }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: 'echo not-the-real-command', exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /unit-tests/);
});

// ---------- ledger "cmd"/"command" field tolerance (read path only) ----------
// P9-era and P11 gate-evidence ledger records were written with "command"
// instead of the schema's "cmd" (seq ~40-42, ~59-70 of the real build
// ledger). Read tolerance only: hasGateEvidence accepts either field on a
// ledger record; state.json's own declared gate "cmd" (findGateCmd) and all
// sanctioned writers (runGate) stay strict and unchanged.

test('a ledger gate record carrying "command" (no "cmd") satisfies hasGateEvidence exactly as "cmd" does', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [{ status: 'done', verified: true, gate: 'unit-tests' }],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', command: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('a ledger gate record carrying both "cmd" and "command" prefers "cmd" when they agree with the expected cmd', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, command: 'echo not-the-real-command', exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('a ledger gate record carrying both "cmd" and "command" prefers "cmd" even when "command" matches instead', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: 'echo not-the-real-command', command: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /unit-tests/);
});

test('a ledger gate record with a "command" value that does not match the expected cmd is still a violation', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', command: 'echo not-the-real-command', exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /unit-tests/);
});

test('existing "cmd"-only ledger behavior is unchanged: matching "cmd" with no "command" field still satisfies the gate', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('gate reporting last_result=pass but declaring no cmd is a violation', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass' }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.match(result.violations[0], /declares no "cmd"/);
});

test('gate entries with last_result other than pass never require ledger evidence', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'flaky', last_result: 'fail' }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unrelated', cmd: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('stale success does not override a later failure for the same gate (latest record wins)', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 0 });
  appendLine(ledgerPath, { seq: 1, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 1 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /unit-tests/);
});

test('a later success supersedes an earlier failure for the same gate (latest record wins)', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 1 });
  appendLine(ledgerPath, { seq: 1, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('duplicate seq: two ledger records share the same seq value', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, { gates: [], checklist: [] });
  appendLine(ledgerPath, { seq: 0, kind: 'note' });
  appendLine(ledgerPath, { seq: 0, kind: 'note' });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /duplicate seq/);
});

test('non-decreasing seq: a later record has a smaller seq than an earlier one', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, { gates: [], checklist: [] });
  appendLine(ledgerPath, { seq: 5, kind: 'note' });
  appendLine(ledgerPath, { seq: 2, kind: 'note' });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /out of order/);
});

test('a ledger record missing seq entirely is a violation and cannot serve as evidence', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 0 });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('missing or invalid seq')));
  assert.ok(result.violations.some((v) => v.includes('unit-tests')));
});

test('a ledger record with a negative seq is a violation', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, { gates: [], checklist: [] });
  appendLine(ledgerPath, { seq: -1, kind: 'note' });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('missing or invalid seq')));
});

test('a ledger record with a fractional seq is a violation', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, { gates: [], checklist: [] });
  appendLine(ledgerPath, { seq: 1.5, kind: 'note' });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('missing or invalid seq')));
});

test('a ledger line that parses to a non-object JSON value is a violation', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, { gates: [], checklist: [] });
  fs.writeFileSync(ledgerPath, ['"just a string"', JSON.stringify({ seq: 0, kind: 'note' })].join('\n') + '\n');

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('is not an object')));
});

test('malformed ledger line: one violation per malformed line, not fatal', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, { gates: [], checklist: [] });
  fs.writeFileSync(
    ledgerPath,
    [JSON.stringify({ seq: 0, kind: 'note' }), '{not valid json', 'also not json', JSON.stringify({ seq: 1, kind: 'note' })].join(
      '\n'
    ) + '\n'
  );

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 2);
});

test('missing state file fails closed (ok:false), not treated as an empty state', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  appendLine(ledgerPath, { seq: 0, kind: 'note' });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /state: file not found/);
});

test('a state file that is not a JSON object fails closed', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  fs.writeFileSync(statePath, JSON.stringify([1, 2, 3]));

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.match(result.violations[0], /must be a JSON object/);
});

test('a state object with neither gates nor checklist (e.g. "{}") is honest — zero declared obligations, ok:true', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  fs.writeFileSync(statePath, JSON.stringify({}));

  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('a freshly scaffolded state.json shape (schema_version/phase/etc, no gates/checklist keys) passes cleanly', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, {
    schema_version: 1,
    created_ts: new Date().toISOString(),
    phase: 'onboarding',
    phase_status: {},
    current_milestone: null,
    current_chunk: null,
    next_action: 'onboarding',
    updated_utc: new Date().toISOString(),
  });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('a state object with non-array gates/checklist fails closed instead of silently coercing to []', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  fs.writeFileSync(statePath, JSON.stringify({ gates: 'nope', checklist: 42 }));

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('state.gates must be an array')));
  assert.ok(result.violations.some((v) => v.includes('state.checklist must be an array')));
});

test('missing ledger file is treated as an empty ledger when no obligations require evidence', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, { gates: [], checklist: [] });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('CLI: exit code 0 and no violations printed on a clean state/ledger pair', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, { gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }], checklist: [] });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unit-tests', cmd: PASS_CMD, exit_code: 0 });

  const proc = spawnSync(process.execPath, [CLI_PATH, statePath, ledgerPath], { encoding: 'utf8' });
  assert.equal(proc.status, 0);
});

test('CLI: exit code 1 and violation text printed to stdout on a dishonest state', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);

  writeAtomic(statePath, { gates: [{ name: 'lint', last_result: 'pass', cmd: PASS_CMD }], checklist: [] });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'other', cmd: PASS_CMD, exit_code: 0 });

  const proc = spawnSync(process.execPath, [CLI_PATH, statePath, ledgerPath], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stdout, /lint/);
});

// ---------- runGate: the sole sanctioned evidence producer ----------

test('runGate actually executes cmd and records the real exit code for a passing command', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);

  const outcome = runGate({ gateId: 'unit-tests', cmd: PASS_CMD, ledgerPath });
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.seq, 0);

  const statePath = statePathFor(dir);
  writeAtomic(statePath, { gates: [{ name: 'unit-tests', last_result: 'pass', cmd: PASS_CMD }], checklist: [] });
  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('runGate actually executes cmd and records the real exit code for a failing command (no caller-supplied exit_code to spoof)', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);

  const outcome = runGate({ gateId: 'unit-tests', cmd: FAIL_CMD, ledgerPath });
  assert.equal(outcome.exitCode, 1);

  const statePath = statePathFor(dir);
  writeAtomic(statePath, { gates: [{ name: 'unit-tests', last_result: 'pass', cmd: FAIL_CMD }], checklist: [] });
  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
});

test('runGate throws TypeError for a missing/empty gateId or cmd', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  assert.throws(() => runGate({ gateId: '', cmd: PASS_CMD, ledgerPath }), TypeError);
  assert.throws(() => runGate({ gateId: 'g', cmd: '', ledgerPath }), TypeError);
  assert.throws(() => runGate({ gateId: 'g', cmd: PASS_CMD, ledgerPath: '' }), TypeError);
});

// ---------- runGate: a stated tree is a claim this module checks ----------

// A gate that runs in a checkout materialized for it is worth nothing unless
// the record says which tree it answered about. The caller states the tree it
// believes it built; runGate asks git, in the directory the command is about to
// run in, what is actually checked out there.
function makeCheckout() {
  const dir = mkTmpDir();
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  const treeOf = () => git('rev-parse', '--verify', 'HEAD^{tree}').stdout.trim();
  return { dir, git, treeOf };
}

test('runGate records the tree a gate ran against when the gate states one', () => {
  const { dir, treeOf } = makeCheckout();
  const ledgerPath = ledgerPathFor(mkTmpDir());

  const outcome = runGate({ gateId: 'chunk:M1:C1', cmd: PASS_CMD, ledgerPath, cwd: dir, tree: treeOf() });

  assert.equal(outcome.tree, treeOf());
  const record = JSON.parse(fs.readFileSync(ledgerPath, 'utf8').trim());
  assert.equal(record.tree, treeOf());
});

// The absence is deliberate and it is the honest shape: a gate that runs in an
// ordinary working tree cannot name a tree, because a working tree can differ
// from its own HEAD.
test('runGate records no tree when the gate states none', () => {
  const ledgerPath = ledgerPathFor(mkTmpDir());
  runGate({ gateId: 'regression-floor:M1', cmd: PASS_CMD, ledgerPath });

  const record = JSON.parse(fs.readFileSync(ledgerPath, 'utf8').trim());
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'tree'), false);
});

test('runGate refuses a gate whose stated tree is not the tree checked out where it would run', () => {
  const { dir, git, treeOf } = makeCheckout();
  const before = treeOf();
  // A second commit, so the stated tree is a real tree of this repository that
  // is simply not the one standing in the checkout — the wrong answer has to be
  // a DIFFERENT answer, not a malformed one.
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'second');
  assert.notEqual(treeOf(), before);

  const ledgerDir = mkTmpDir();
  const ledgerPath = ledgerPathFor(ledgerDir);
  // The command would leave a trace if it ever ran, which is how "refusal
  // mutates nothing" is checked rather than assumed.
  const witness = path.join(ledgerDir, 'the-gate-ran');
  const cmd = `${process.execPath} -e "require('fs').writeFileSync(${JSON.stringify(witness)}, 'x')"`;

  assert.throws(
    () => runGate({ gateId: 'chunk:M1:C1', cmd, ledgerPath, cwd: dir, tree: before }),
    /may not claim a tree the gate did not run against/
  );
  assert.equal(fs.existsSync(witness), false, 'the refused gate ran its command anyway');
  assert.equal(fs.existsSync(ledgerPath), false, 'the refused gate left a record');
});

// HEAD IS NOT THE CHECKOUT. `HEAD^{tree}` describes the commit that was checked
// out, not the bytes lying there now — so a checkout somebody left dirty passes
// a tree comparison perfectly while holding different content. The independent
// check has to ask about the files, or it is not independent of the claim.
test('runGate refuses a stated tree whose checkout holds modified tracked files', () => {
  const { dir, treeOf } = makeCheckout();
  const tree = treeOf();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'something a killed suite left\n');
  assert.equal(
    spawnSync('git', ['rev-parse', '--verify', 'HEAD^{tree}'], { cwd: dir, encoding: 'utf8' }).stdout.trim(),
    tree,
    'the fixture changed HEAD, so this case would be caught by the tree comparison alone'
  );

  const ledgerDir = mkTmpDir();
  const ledgerPath = ledgerPathFor(ledgerDir);
  const witness = path.join(ledgerDir, 'the-gate-ran');
  const cmd = `${process.execPath} -e "require('fs').writeFileSync(${JSON.stringify(witness)}, 'x')"`;

  assert.throws(() => runGate({ gateId: 'chunk:M1:C1', cmd, ledgerPath, cwd: dir, tree }), /tracked files/);
  assert.equal(fs.existsSync(witness), false, 'the refused gate ran its command anyway');
  assert.equal(fs.existsSync(ledgerPath), false, 'the refused gate left a record');
});

test('runGate refuses a stated tree whose checkout has staged changes, and one whose tracked file is gone', () => {
  const ledgerPath = ledgerPathFor(mkTmpDir());

  const staged = makeCheckout();
  const stagedTree = staged.treeOf();
  fs.writeFileSync(path.join(staged.dir, 'a.txt'), 'staged over the checkout\n');
  staged.git('add', 'a.txt');
  assert.throws(
    () => runGate({ gateId: 'g', cmd: PASS_CMD, ledgerPath, cwd: staged.dir, tree: stagedTree }),
    /tracked files/
  );

  const deleted = makeCheckout();
  const deletedTree = deleted.treeOf();
  fs.rmSync(path.join(deleted.dir, 'a.txt'), { force: true });
  assert.throws(
    () => runGate({ gateId: 'g', cmd: PASS_CMD, ledgerPath, cwd: deleted.dir, tree: deletedTree }),
    /tracked files/
  );

  assert.equal(fs.existsSync(ledgerPath), false, 'a refused gate left a record');
});

// A STAGED CHANGE CAN CANCEL ITSELF IN THE WORKING TREE AND LEAVE THE INDEX
// DIRTY. `git diff HEAD` answers about the working tree, so a file staged and
// then restored to HEAD's bytes reads perfectly clean there while the index
// still holds the change — and the index is part of what a checkout is. The two
// comparisons are separate questions and both have to be asked.
test('runGate refuses a stated tree whose index is dirty even where the working tree is not', () => {
  const { dir, git: gitIn, treeOf } = makeCheckout();
  const tree = treeOf();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'staged, then taken back\n');
  gitIn('add', 'a.txt');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); // HEAD's own bytes, restored
  assert.equal(
    spawnSync('git', ['diff', '--quiet', 'HEAD'], { cwd: dir }).status,
    0,
    'the working tree is dirty in this fixture, so the working-tree comparison alone would catch it'
  );

  const ledgerPath = ledgerPathFor(mkTmpDir());
  assert.throws(() => runGate({ gateId: 'g', cmd: PASS_CMD, ledgerPath, cwd: dir, tree }), /tracked files/);
  assert.equal(fs.existsSync(ledgerPath), false, 'a refused gate left a record');
});

// A git that cannot answer is not a git that answered "clean". The two are one
// exit code apart — `--quiet` reports a difference as 1 and its own failure as
// anything above — and a corrupt index is enough to produce the second while
// the tree comparison ahead of it still passes, since `rev-parse` never reads
// the index at all.
test('runGate refuses a stated tree when git cannot say whether the checkout still holds it', () => {
  const { dir, treeOf } = makeCheckout();
  const tree = treeOf();
  fs.writeFileSync(path.join(dir, '.git', 'index'), 'not an index at all');
  assert.equal(
    spawnSync('git', ['rev-parse', '--verify', 'HEAD^{tree}'], { cwd: dir, encoding: 'utf8' }).status,
    0,
    'the fixture broke the tree comparison too, so this case cannot reach the check it is about'
  );

  const ledgerPath = ledgerPathFor(mkTmpDir());
  assert.throws(
    () => runGate({ gateId: 'g', cmd: PASS_CMD, ledgerPath, cwd: dir, tree }),
    /could not say whether/
  );
  assert.equal(fs.existsSync(ledgerPath), false, 'a refused gate left a record');
});

// Untracked files are NOT dirt for this purpose, and the boundary is
// deliberate: the machine plants a dependency symlink in the checkout before the
// gate runs, and a suite legitimately writes its own output there. Neither
// changes what the stated tree says.
test('runGate accepts a checkout carrying untracked files, which are not a claim about the tree', () => {
  const { dir, treeOf } = makeCheckout();
  const ledgerPath = ledgerPathFor(mkTmpDir());
  fs.writeFileSync(path.join(dir, 'coverage.out'), 'the suite wrote this\n');

  const outcome = runGate({ gateId: 'g', cmd: PASS_CMD, ledgerPath, cwd: dir, tree: treeOf() });

  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.tree, treeOf());
});

test('runGate refuses a stated tree it cannot check: no cwd, a malformed id, or a directory git does not know', () => {
  const ledgerPath = ledgerPathFor(mkTmpDir());
  const { dir, treeOf } = makeCheckout();
  const tree = treeOf();

  assert.throws(() => runGate({ gateId: 'g', cmd: PASS_CMD, ledgerPath, tree }), TypeError);
  assert.throws(() => runGate({ gateId: 'g', cmd: PASS_CMD, ledgerPath, cwd: dir, tree: 'HEAD' }), TypeError);
  assert.throws(
    () => runGate({ gateId: 'g', cmd: PASS_CMD, ledgerPath, cwd: mkTmpDir(), tree }),
    /is not a git checkout this can verify/
  );
  assert.equal(fs.existsSync(ledgerPath), false, 'a refused gate left a record');
});

test('runGate assigns increasing seq across repeated calls on the same ledger', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const first = runGate({ gateId: 'a', cmd: PASS_CMD, ledgerPath });
  const second = runGate({ gateId: 'b', cmd: PASS_CMD, ledgerPath });
  assert.equal(first.seq, 0);
  assert.equal(second.seq, 1);
});

test('runGate writes ledger records through the common JSONL header (schema_version/ts/correlation_id)', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  runGate({ gateId: 'unit-tests', cmd: PASS_CMD, ledgerPath });

  const raw = fs.readFileSync(ledgerPath, 'utf8').trim();
  const record = JSON.parse(raw);
  assert.equal(record.schema_version, 1);
  assert.equal(typeof record.ts, 'string');
  assert.equal(record.correlation_id, 'unit-tests');
  assert.equal(record.gate_id, 'unit-tests');
});

// A GATE MUST NOT INHERIT ITS CALLER'S TEST HARNESS. `node --test` sets
// NODE_TEST_CONTEXT in the environment of every process it spawns, and a
// `node --test` that FINDS that variable believes it is a test file reporting to
// a parent runner: it reports through the parent and exits 0 whether its tests
// passed or failed. This file is itself such a child, so the question can be
// asked for real rather than staged — the gate below runs a suite whose one test
// fails, from inside the very context that would silence it.
test('runGate records red for a failing suite even when it is called from inside a node --test process', () => {
  // Verify the verifier: without the ambient variable this test poses no
  // question at all, and would pass on the very code it exists to refuse.
  assert.equal(
    typeof process.env.NODE_TEST_CONTEXT === 'string' && process.env.NODE_TEST_CONTEXT !== '',
    true,
    'this file is not running under `node --test`, so nothing here can inherit a test context'
  );

  const suiteDir = mkTmpDir();
  fs.writeFileSync(
    path.join(suiteDir, 'red.test.js'),
    [
      "require('node:test')('a test the target project cannot pass', () => {",
      "  require('node:assert/strict').equal(1, 2);",
      '});',
      '',
    ].join('\n')
  );
  const ledgerPath = ledgerPathFor(mkTmpDir());
  const cmd = `${JSON.stringify(process.execPath)} --test ${JSON.stringify(suiteDir)}`;

  const outcome = runGate({ gateId: 'chunk:M1:C1', cmd, ledgerPath });

  assert.notEqual(outcome.exitCode, 0, 'the gate reported green over a suite whose test failed');
  const record = JSON.parse(fs.readFileSync(ledgerPath, 'utf8').trim());
  assert.notEqual(record.exit_code, 0, 'the gate RECORDED green over a suite whose test failed');
});

// AND THE SCRUB TAKES EXACTLY ONE VARIABLE WITH IT. Naming an `env` for the
// child replaces the whole environment, so the copy around the deletion is
// load-bearing: a gate runs the TARGET PROJECT's own suite, and that suite needs
// PATH to find its runner, HOME for its caches, and whatever its virtualenv or
// toolchain exported. The marker below stands in for all of them — it is an
// ordinary inherited variable, and a child that cannot see it could not see PATH
// either.
test('runGate hands the child every environment variable but the one it strips', () => {
  const marker = 'KILN_GATE_ENV_PROBE';
  const ledgerPath = ledgerPathFor(mkTmpDir());
  const cmd = `${JSON.stringify(process.execPath)} -e "process.exit(process.env.${marker} === 'travelled' ? 0 : 1)"`;

  process.env[marker] = 'travelled';
  let outcome;
  try {
    outcome = runGate({ gateId: 'regression-floor:M1', cmd, ledgerPath });
  } finally {
    delete process.env[marker];
  }

  assert.equal(outcome.exitCode, 0, 'the gate ran its command in an environment the caller never had');
});

// ---------- recordDeviation: the sole sanctioned deviation-evidence producer (P11 F12) ----------

test('recordDeviation writes a valid deviation record and returns its seq', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);

  const outcome = recordDeviation({
    reportedBy: 'research-chief',
    expected: 'a generic ledger-append API for recording a deviation',
    actual: 'no such API exists; the brief itself was the deviation',
    summary: 'refused a false-premise brief rather than hand-roll a write to the audit stream',
    ledgerPath,
  });
  assert.equal(outcome.seq, 0);
  assert.equal(outcome.deviation.reported_by, 'research-chief');
});

test('recordDeviation throws TypeError for any missing/empty required field', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const base = { reportedBy: 'a', expected: 'b', actual: 'c', summary: 'd', ledgerPath };
  assert.throws(() => recordDeviation({ ...base, reportedBy: '' }), TypeError);
  assert.throws(() => recordDeviation({ ...base, expected: '' }), TypeError);
  assert.throws(() => recordDeviation({ ...base, actual: '' }), TypeError);
  assert.throws(() => recordDeviation({ ...base, summary: '' }), TypeError);
  assert.throws(() => recordDeviation({ ...base, reportedBy: undefined }), TypeError);
});

test('recordDeviation throws TypeError for a missing/empty ledgerPath', () => {
  assert.throws(
    () => recordDeviation({ reportedBy: 'a', expected: 'b', actual: 'c', summary: 'd', ledgerPath: '' }),
    TypeError
  );
});

test('recordDeviation writes through the common JSONL header, kind "deviation", correlation_id defaulting to null', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  recordDeviation({ reportedBy: 'a', expected: 'b', actual: 'c', summary: 'd', ledgerPath });

  const raw = fs.readFileSync(ledgerPath, 'utf8').trim();
  const record = JSON.parse(raw);
  assert.equal(record.schema_version, 1);
  assert.equal(record.kind, 'deviation');
  assert.equal(typeof record.ts, 'string');
  assert.equal(record.correlation_id, null);
  assert.equal(record.reported_by, 'a');
});

test('recordDeviation stamps the caller-supplied correlationId', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  recordDeviation({
    reportedBy: 'a',
    expected: 'b',
    actual: 'c',
    summary: 'd',
    ledgerPath,
    correlationId: 'chunk_C03',
  });
  const raw = fs.readFileSync(ledgerPath, 'utf8').trim();
  assert.equal(JSON.parse(raw).correlation_id, 'chunk_C03');
});

test('recordDeviation assigns increasing seq across repeated calls on the same ledger', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const base = { reportedBy: 'a', expected: 'b', actual: 'c', summary: 'd', ledgerPath };
  const first = recordDeviation(base);
  const second = recordDeviation(base);
  assert.equal(first.seq, 0);
  assert.equal(second.seq, 1);
});

// ---------- architecture manifest/gate cross-check (derived architectureDir) ----------

function cleanStateAndLedger(dir) {
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);
  writeAtomic(statePath, { gates: [], checklist: [] });
  return { statePath, ledgerPath };
}

test('no architecture/ directory at all: no cross-check performed, still ok', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('architecture/ exists but gate.json does not: no cross-check, still ok', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  architectureDirFor(dir);
  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('gate.json exists but decision is "rejected": no cross-check performed', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  writeAtomic(path.join(architectureDir, 'gate.json'), {
    schema_version: 1,
    decision: 'rejected',
    manifest_digest: null,
    decided_at: new Date().toISOString(),
    decision_source: 'operator',
  });
  // No manifest.json on disk at all — must not matter, since nothing was approved.
  const result = checkHonesty({ statePath, ledgerPath });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('a passed-through checkHonesty call cannot opt out of the cross-check by omitting an architectureDir argument (no such argument exists)', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  sealArchitecture(architectureDir);
  fs.rmSync(path.join(architectureDir, 'plan.md'));

  // Caller cannot bypass the check by passing an unrelated third key.
  const result = checkHonesty({ statePath, ledgerPath, architectureDir: '/tmp/does-not-matter' });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('plan.md')));
});

for (const decision of ['approved', 'auto-approved']) {
  test(`gate.json decision="${decision}", manifest matches disk exactly: ok, no drift violations`, () => {
    const dir = mkTmpDir();
    const { statePath, ledgerPath } = cleanStateAndLedger(dir);
    const architectureDir = architectureDirFor(dir);
    sealArchitecture(architectureDir, { decision });

    const result = checkHonesty({ statePath, ledgerPath });
    assert.deepEqual(result, { ok: true, violations: [] });
  });

  test(`gate-forgery regression via checkHonesty(): a "${decision}" gate hand-flipped from "reopened" with no matching ledger record fails (P6 Sol review BLOCKING #1 — checkArchitectureManifest is the single mechanism both checkHonesty() and verifyGate() share)`, () => {
    const dir = mkTmpDir();
    const { statePath, ledgerPath } = cleanStateAndLedger(dir);
    const architectureDir = architectureDirFor(dir);
    sealArchitecture(architectureDir, { decision: 'reopened', decisionSource: 'configured-policy' });

    const gatePath = path.join(architectureDir, 'gate.json');
    const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
    writeAtomic(gatePath, { ...gate, decision });

    const result = checkHonesty({ statePath, ledgerPath });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.includes('plan-gate-decision') && v.includes('forged gate flip')));
  });
}

test('gate.json decision="approved" but manifest.json missing on disk: fail closed', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  writeContentArtifacts(architectureDir);
  writeAtomic(path.join(architectureDir, 'gate.json'), {
    schema_version: 1,
    decision: 'approved',
    manifest_digest: 'sha256:' + '0'.repeat(64),
    decided_at: new Date().toISOString(),
    decision_source: 'operator',
  });
  // manifest.json intentionally never written.

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('manifest.json') && v.includes('not found')));
});

test('gate.json decision="approved" but manifest_digest does not match manifest.json on disk: fail closed', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  writeContentArtifacts(architectureDir);
  writeManifest(architectureDir, CANONICAL_ARCHITECTURE_ARTIFACTS, path.join(architectureDir, 'manifest.json'));
  writeAtomic(path.join(architectureDir, 'gate.json'), {
    schema_version: 1,
    decision: 'approved',
    manifest_digest: 'sha256:' + '0'.repeat(64), // does not match the real manifest.json
    decided_at: new Date().toISOString(),
    decision_source: 'operator',
  });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('does not match')));
});

test('gate.json decision="approved" but declares no valid manifest_digest: violation, fail closed', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  writeAtomic(path.join(architectureDir, 'gate.json'), {
    schema_version: 1,
    decision: 'approved',
    decided_at: new Date().toISOString(),
    decision_source: 'operator',
  });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('manifest_digest')));
});

test('gate.json exists but "decision" is not one of the four sanctioned values: violation, fail closed', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  writeAtomic(path.join(architectureDir, 'gate.json'), { schema_version: 1, decision: 'maybe' });

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('invalid "decision"')));
});

test('gate.json exists but is not a JSON object: violation, fail closed', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  fs.writeFileSync(path.join(architectureDir, 'gate.json'), JSON.stringify([1, 2, 3]));

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('gate.json') && v.includes('JSON object')));
});

test('approved gate, an architecture artifact drifted (changed): drift becomes a violation', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  sealArchitecture(architectureDir);

  fs.writeFileSync(path.join(architectureDir, 'plan.md'), '# plan (amended, no new gate)\n');

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('plan.md') && v.includes('changed')));
});

test('approved gate, an architecture artifact went missing: drift becomes a violation', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  sealArchitecture(architectureDir);

  fs.rmSync(path.join(architectureDir, 'plan.md'));

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('plan.md') && v.includes('missing')));
});

test('approved gate, manifest.json shrunk to omit a required artifact: violation, cannot silently re-approve', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  sealArchitecture(architectureDir);

  // Attack: rewrite manifest.json to drop "plan.md" so its own drift can
  // never be reported, then re-point gate.json's manifest_digest at the
  // rewritten manifest.
  const shrunk = writeManifest(
    architectureDir,
    CANONICAL_ARCHITECTURE_ARTIFACTS.filter((p) => p !== 'plan.md'),
    path.join(architectureDir, 'manifest.json')
  );
  const gatePath = path.join(architectureDir, 'gate.json');
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  gate.manifest_digest = sha256Of(path.join(architectureDir, 'manifest.json'));
  writeAtomic(gatePath, gate);
  fs.rmSync(path.join(architectureDir, 'plan.md'));

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('missing required artifact "plan.md"')));
  assert.ok(shrunk.artifacts.every((a) => a.path !== 'plan.md'));
});

test('approved gate, manifest.json declares an unexpected artifact path: violation', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  sealArchitecture(architectureDir);

  fs.writeFileSync(path.join(architectureDir, 'extra.md'), 'not part of the canonical set\n');
  const manifest = writeManifest(
    architectureDir,
    [...CANONICAL_ARCHITECTURE_ARTIFACTS, 'extra.md'],
    path.join(architectureDir, 'manifest.json')
  );
  const gatePath = path.join(architectureDir, 'gate.json');
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  gate.manifest_digest = sha256Of(path.join(architectureDir, 'manifest.json'));
  writeAtomic(gatePath, gate);

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('unexpected artifact "extra.md"')));
  assert.equal(manifest.artifacts.length, CANONICAL_ARCHITECTURE_ARTIFACTS.length + 1);
});

test('approved gate, manifest.json declares a duplicate path: violation', () => {
  const dir = mkTmpDir();
  const { statePath, ledgerPath } = cleanStateAndLedger(dir);
  const architectureDir = architectureDirFor(dir);
  sealArchitecture(architectureDir);

  const manifestPath = path.join(architectureDir, 'manifest.json');
  const manifestObj = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifestObj.artifacts.push({ ...manifestObj.artifacts[0] });
  writeAtomic(manifestPath, manifestObj);
  const gatePath = path.join(architectureDir, 'gate.json');
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  gate.manifest_digest = sha256Of(manifestPath);
  writeAtomic(gatePath, gate);

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('declared more than once')));
});

test('architecture manifest-digest check combines with the ordinary gate/checklist checks in one violations list', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);
  const architectureDir = architectureDirFor(dir);

  writeAtomic(statePath, {
    gates: [{ name: 'lint', last_result: 'pass', cmd: PASS_CMD }],
    checklist: [],
  });
  appendLine(ledgerPath, { seq: 0, kind: 'gate', gate_id: 'unrelated', cmd: PASS_CMD, exit_code: 0 });

  sealArchitecture(architectureDir);
  fs.rmSync(path.join(architectureDir, 'plan.md'));

  const result = checkHonesty({ statePath, ledgerPath });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 2);
  assert.ok(result.violations.some((v) => v.includes('lint')));
  assert.ok(result.violations.some((v) => v.includes('plan.md')));
});

test('CLI: two-arg invocation (statePath, ledgerPath) derives architectureDir and still catches drift', () => {
  const dir = mkTmpDir();
  const statePath = statePathFor(dir);
  const ledgerPath = ledgerPathFor(dir);
  const architectureDir = architectureDirFor(dir);
  writeAtomic(statePath, { gates: [], checklist: [] });

  sealArchitecture(architectureDir);
  fs.rmSync(path.join(architectureDir, 'plan.md'));

  const proc = spawnSync(process.execPath, [CLI_PATH, statePath, ledgerPath], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stdout, /plan\.md/);
});

test('CLI usage line does not offer an architectureDir argument to omit', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH], { encoding: 'utf8' });
  assert.notEqual(proc.status, 0);
  assert.match(proc.stderr, /usage: check-honesty\.js <statePath> <ledgerPath>/);
  assert.doesNotMatch(proc.stderr, /architectureDir/);
});

// ---------- CLI: record-deviation (P11 finding F12's adjacent defect —
// recordDeviation had no invocation form a Bash-only worker could call) ----------

function lastLedgerRecord(ledgerPath) {
  const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

test('CLI: record-deviation reads the deviation JSON from stdin and appends it', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const deviation = {
    reported_by: 'research-chief',
    expected: 'a generic ledger-append API',
    actual: 'no such API exists',
    summary: 'refused a false-premise brief rather than hand-roll a write',
  };
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record-deviation', ledgerPath], {
    encoding: 'utf8',
    input: JSON.stringify(deviation),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.deepEqual(printed.deviation, deviation);

  const record = lastLedgerRecord(ledgerPath);
  assert.equal(record.kind, 'deviation');
  assert.equal(record.reported_by, deviation.reported_by);
  assert.equal(record.expected, deviation.expected);
  assert.equal(record.actual, deviation.actual);
  assert.equal(record.summary, deviation.summary);
  assert.equal(record.correlation_id, null);
});

test('CLI: record-deviation honors an explicit correlation_id', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const deviation = {
    reported_by: 'research-chief',
    expected: 'x',
    actual: 'y',
    summary: 'z',
    correlation_id: 'topic-7',
  };
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record-deviation', ledgerPath], {
    encoding: 'utf8',
    input: JSON.stringify(deviation),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const record = lastLedgerRecord(ledgerPath);
  assert.equal(record.correlation_id, 'topic-7');
});

test('CLI: record-deviation exits 1 and writes nothing for a malformed deviation', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record-deviation', ledgerPath], {
    encoding: 'utf8',
    input: JSON.stringify({ reported_by: '' }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /check-honesty\.js/);
  assert.equal(fs.existsSync(ledgerPath), false);
});

// CLI adapter parity (P11 Sol review finding 5): recordDeviation itself only
// ever reconstructs {reported_by, expected, actual, summary} from the parsed
// stdin object, so an extra key on the raw input silently never reached
// validateDeviation's own extra-key check at all — the adapter, not the
// library, must validate the parsed object's actual key set before writing.
test('CLI: record-deviation exits 1 and writes nothing for a deviation carrying an unexpected extra key', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record-deviation', ledgerPath], {
    encoding: 'utf8',
    input: JSON.stringify({
      reported_by: 'research-chief',
      expected: 'a generic ledger-append API',
      actual: 'no such API exists',
      summary: 'refused a false-premise brief rather than hand-roll a write',
      unexpected: 'smuggled-field',
    }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /check-honesty\.js/);
  assert.equal(fs.existsSync(ledgerPath), false);
});

test('CLI: record-deviation exits 1 with a usage message when ledgerPath is missing', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record-deviation'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage/);
});

// ---------- CLI: run-gate (P11 convergence finding 3 — a Bash-only worker,
// e.g. security-scanner, had no way to reach runGate at all) ----------

test('CLI: run-gate executes the real command and appends real ledger evidence', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'run-gate', ledgerPath], {
    encoding: 'utf8',
    input: JSON.stringify({ gateId: 'security-scan-npm', cmd: 'echo hello' }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.gateId, 'security-scan-npm');
  assert.equal(printed.exitCode, 0);
  assert.match(printed.stdout, /hello/);

  const record = lastLedgerRecord(ledgerPath);
  assert.equal(record.kind, 'gate');
  assert.equal(record.gate_id, 'security-scan-npm');
  assert.equal(record.cmd, 'echo hello');
  assert.equal(record.exit_code, 0);
});

test('CLI: run-gate records a real non-zero exit code, never hardcoded to 0', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'run-gate', ledgerPath], {
    encoding: 'utf8',
    input: JSON.stringify({ gateId: 'security-scan-npm', cmd: 'exit 7' }),
  });
  assert.equal(proc.status, 0, proc.stderr); // the CLI call itself succeeds; the GATE's own exit code is the payload
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.exitCode, 7);
  assert.equal(lastLedgerRecord(ledgerPath).exit_code, 7);
});

test('CLI: run-gate exits 1 and writes nothing for a missing gateId/cmd', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'run-gate', ledgerPath], { encoding: 'utf8', input: JSON.stringify({}) });
  assert.equal(proc.status, 1);
  assert.equal(fs.existsSync(ledgerPath), false);
});

test('CLI: run-gate exits 1 on invalid JSON via stdin', () => {
  const dir = mkTmpDir();
  const ledgerPath = ledgerPathFor(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'run-gate', ledgerPath], { encoding: 'utf8', input: 'not json' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^check-honesty\.js: /);
});

test('CLI: run-gate exits 1 with a usage message when ledgerPath is missing', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'run-gate'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage/);
});
