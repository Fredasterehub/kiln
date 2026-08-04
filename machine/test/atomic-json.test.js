'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { spawn } = require('node:child_process');

const { writeAtomic, readJson, updateJson } = require('../src/atomic-json.js');

const ATOMIC_JSON_MODULE_PATH = path.join(__dirname, '..', 'src', 'atomic-json.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-json-test-'));
}

test('writeAtomic serializes pretty with 2-space indent', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  const obj = { b: 2, a: 1 };
  writeAtomic(file, obj);
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw, JSON.stringify(obj, null, 2));
});

test('writeAtomic leaves valid JSON after overwrite (atomic replace)', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  writeAtomic(file, { round: 1 });
  writeAtomic(file, { round: 2, extra: 'data' });
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(parsed, { round: 2, extra: 'data' });
});

test('writeAtomic removes the tmp file after success', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  writeAtomic(file, { ok: true });
  const tmpPath = file + '.tmp-' + process.pid;
  assert.equal(fs.existsSync(tmpPath), false);
  const entries = fs.readdirSync(dir);
  assert.deepEqual(entries, ['state.json']);
});

test('writeAtomic leaves no stray temp files after many rapid successive writes (unique tmp names, MAJOR-8)', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  for (let i = 0; i < 20; i++) {
    writeAtomic(file, { i });
  }
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { i: 19 });
});

test('writeAtomic does not collide with a stale file left at the old predictable "<file>.tmp-<pid>" name', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file + '.tmp-' + process.pid, 'stale leftover from a previous crashed run');
  writeAtomic(file, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: true });
});

test('writeAtomic creates the parent directory if missing', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'nested', 'deeper', 'state.json');
  writeAtomic(file, { created: true });
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { created: true });
});

test('writeAtomic throws TypeError on non-serializable value', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  const circular = {};
  circular.self = circular;
  assert.throws(() => writeAtomic(file, circular), TypeError);
});

test('writeAtomic throws TypeError on BigInt value (non-serializable)', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  assert.throws(() => writeAtomic(file, { big: 10n }), TypeError);
});

test('writeAtomic cleans up its temp file when the final rename fails (P11 Sol review finding 14)', () => {
  const dir = makeTmpDir();
  // A directory at the target path makes fs.renameSync fail with EISDIR —
  // the temp file must not survive that failure.
  const file = path.join(dir, 'state.json');
  fs.mkdirSync(file);

  assert.throws(() => writeAtomic(file, { ok: true }), (err) => err.code === 'EISDIR');

  const leftovers = fs.readdirSync(dir).filter((name) => name !== 'state.json');
  assert.deepEqual(leftovers, []);
});

test('writeAtomic round-trips complex data with full fidelity', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  const obj = {
    string: 'hello',
    number: 42.5,
    negative: -7,
    bool: true,
    nul: null,
    nested: { a: [1, 2, 3], b: { c: 'deep' } },
    array: [1, 'two', false, null, { five: 5 }],
    unicode: 'café ééé emoji 😀',
    empty: {},
    emptyArray: [],
  };
  writeAtomic(file, obj);
  const roundTripped = readJson(file);
  assert.deepEqual(roundTripped, obj);
});

test('readJson parses a valid file', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ x: 1 }));
  assert.deepEqual(readJson(file), { x: 1 });
});

test('readJson returns fallback on ENOENT', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'missing.json');
  assert.deepEqual(readJson(file, { default: true }), { default: true });
});

test('readJson returns undefined on ENOENT when no fallback given', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'missing.json');
  assert.equal(readJson(file), undefined);
});

test('readJson throws on parse error with file path in message', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{ not valid json ');
  assert.throws(
    () => readJson(file),
    (err) => err instanceof Error && err.message.includes(file)
  );
});

test('readJson propagates non-ENOENT filesystem errors (e.g. EISDIR)', () => {
  const dir = makeTmpDir();
  assert.throws(() => readJson(dir), (err) => err.code !== 'ENOENT');
});

// ---------- updateJson (P11 convergence finding 21 — a shared lock/CAS
// mechanism for every state.json read-modify-write) ----------

test('updateJson passes readJson\'s own fallback to the updater on a missing file, then writes the updater\'s return value', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  const result = updateJson(file, { count: 0 }, (current) => {
    assert.deepEqual(current, { count: 0 });
    return { count: current.count + 1 };
  });
  assert.deepEqual(result, { count: 1 });
  assert.deepEqual(readJson(file), { count: 1 });
});

test('updateJson passes the file\'s real current content to the updater when present', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  writeAtomic(file, { count: 5, other: 'kept' });
  const result = updateJson(file, { count: 0 }, (current) => ({ ...current, count: current.count + 1 }));
  assert.deepEqual(result, { count: 6, other: 'kept' });
  assert.deepEqual(readJson(file), { count: 6, other: 'kept' });
});

test('updateJson writes nothing and propagates the error when the updater throws', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  writeAtomic(file, { count: 1 });
  assert.throws(() => updateJson(file, undefined, () => {
    throw new Error('precondition failed');
  }), /precondition failed/);
  assert.deepEqual(readJson(file), { count: 1 });
});

test('updateJson does not create the file when the updater throws on a missing file', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  assert.throws(() => updateJson(file, undefined, () => {
    throw new Error('no file yet');
  }));
  assert.equal(fs.existsSync(file), false);
});

test('updateJson throws TypeError when updater is not a function', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  assert.throws(() => updateJson(file, {}, 'not a function'), TypeError);
});

test('updateJson releases its lock after a throw, so a subsequent call still succeeds', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  writeAtomic(file, { count: 1 });
  assert.throws(() => updateJson(file, undefined, () => {
    throw new Error('boom');
  }));
  const result = updateJson(file, undefined, (current) => ({ count: current.count + 1 }));
  assert.deepEqual(result, { count: 2 });
});

// Real lost-update proof (P11 convergence finding 21's own non-negotiable):
// N separate child PROCESSES each run one updateJson increment against the
// exact same file, concurrently. A bare readJson()+writeAtomic() pair would
// let two processes both read the same starting count and each write
// "current+1", losing all but one increment; updateJson's shared lock must
// serialize every one of them so every single increment survives — mirrors
// jsonl.test.js's own "appendEvent is race-free under real concurrent
// writers from separate processes" proof exactly, applied here to a JSON
// read-modify-write instead of a JSONL append.
test('updateJson: two (and more) competing updates through separate processes never lose an update (real lost-update proof)', async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'state.json');
  writeAtomic(file, { count: 0 });

  const workerScript = path.join(dir, 'worker.js');
  fs.writeFileSync(
    workerScript,
    [
      `const { updateJson } = require(${JSON.stringify(ATOMIC_JSON_MODULE_PATH)});`,
      `updateJson(${JSON.stringify(file)}, undefined, (current) => ({ count: current.count + 1 }));`,
    ].join('\n')
  );

  const WORKER_COUNT = 12;
  const runs = Array.from(
    { length: WORKER_COUNT },
    () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [workerScript]);
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`worker exited with code ${code}: ${stderr}`));
        });
        child.on('error', reject);
      })
  );

  await Promise.all(runs);

  assert.deepEqual(readJson(file), { count: WORKER_COUNT });
});

// ---------- CLI: write-architecture-artifact (P11 convergence finding 3 —
// agents/plan-author.md:41's writeAtomic requirement, closed to its three
// sanctioned JSON targets) ----------

const { spawnSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'src', 'atomic-json.js');

test('CLI: write-architecture-artifact writes criteria-register.json under the given dir', () => {
  const dir = makeTmpDir();
  const body = { schema_version: 1, criteria: [{ id: 'ACR-01', text: 'x', source_ref: 'vision.md', journey_id: 'J1' }] };
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-architecture-artifact', dir, 'criteria-register'], {
    encoding: 'utf8',
    input: JSON.stringify(body),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(readJson(path.join(dir, 'criteria-register.json')), body);
});

test('CLI: write-architecture-artifact writes milestones.json and artifact-map.json under the given dir', () => {
  const dir = makeTmpDir();
  spawnSync(process.execPath, [CLI_PATH, 'write-architecture-artifact', dir, 'milestones'], {
    encoding: 'utf8',
    input: JSON.stringify({ schema_version: 1, milestones: [] }),
  });
  spawnSync(process.execPath, [CLI_PATH, 'write-architecture-artifact', dir, 'artifact-map'], {
    encoding: 'utf8',
    input: JSON.stringify({ artifacts: [] }),
  });
  assert.deepEqual(readJson(path.join(dir, 'milestones.json')), { schema_version: 1, milestones: [] });
  assert.deepEqual(readJson(path.join(dir, 'artifact-map.json')), { artifacts: [] });
});

test('CLI: write-architecture-artifact writes into a drafts/<slot>/ candidate directory too', () => {
  const dir = path.join(makeTmpDir(), 'drafts', 'candidate-1');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-architecture-artifact', dir, 'milestones'], {
    encoding: 'utf8',
    input: JSON.stringify({ schema_version: 1, milestones: [] }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(readJson(path.join(dir, 'milestones.json')), { schema_version: 1, milestones: [] });
});

test('CLI: write-architecture-artifact refuses an unrecognized artifact name (never an arbitrary filename)', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-architecture-artifact', dir, 'plan'], {
    encoding: 'utf8',
    input: '{}',
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: atomic-json\.js/);
  assert.equal(fs.existsSync(path.join(dir, 'plan.md')), false);
  assert.equal(fs.existsSync(path.join(dir, 'plan.json')), false);
});

test('CLI: write-architecture-artifact exits 1 on invalid JSON via stdin', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-architecture-artifact', dir, 'milestones'], {
    encoding: 'utf8',
    input: 'not json',
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^atomic-json\.js: /);
});

test('CLI: missing dir/artifact prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-architecture-artifact'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: atomic-json\.js/);
});

test('CLI: unknown command prints usage and exits 1', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'bogus', dir, 'milestones'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: atomic-json\.js/);
});

test('CLI: a surplus positional argument is refused (P11 Sol review finding 13)', () => {
  const dir = makeTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-architecture-artifact', dir, 'milestones', 'extra'], {
    encoding: 'utf8',
    input: JSON.stringify({ schema_version: 1, milestones: [] }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /unexpected extra argument/);
});
