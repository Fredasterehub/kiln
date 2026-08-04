'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { inventoryTarget, writeReuseMap, writeConstraints, ensureTreeSubdir } = require('../src/scout.js');

// mkProjectRoot() -> a fresh tmp dir standing in for the target repo, with
// its .thelastskill/ tree pre-scaffolded — matching the real brownfield
// sequence (detect -> scaffold -> scout, product/brownfield/flow.md) that
// P9 ruling 5's ensureScoutDir guard now enforces: every scout writer
// requires treeRoot to already exist before it will touch scout/.
function mkProjectRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  return dir;
}

function treeRootOf(projectRoot) {
  return path.join(projectRoot, '.thelastskill');
}

function write(root, relPath, content = '') {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
  return res;
}

function readInventory(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.thelastskill', 'scout', 'inventory.json'), 'utf8'));
}

// --- inventoryTarget: shape and empty repo ---

test('inventoryTarget reports an empty files list and correct summary for an empty directory', () => {
  const dir = mkProjectRoot();
  const result = inventoryTarget(dir);
  assert.equal(result.schema_version, 1);
  assert.equal(typeof result.generated_ts, 'string');
  assert.deepEqual(result.files, []);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.summary.by_lang, {});
  assert.deepEqual(result.summary.entry_points, []);
  assert.deepEqual(result.summary.test_dirs, []);
  assert.equal(result.summary.has_git, false);
  assert.equal('commit_count' in result.summary, false);
});

test('inventoryTarget atomic-writes scout/inventory.json under the target project\'s own tree', () => {
  const dir = mkProjectRoot();
  write(dir, 'a.js', 'x');
  const result = inventoryTarget(dir);
  const onDisk = readInventory(dir);
  assert.deepEqual(onDisk, result);
});

// --- skip rules ---

test('inventoryTarget skips node_modules, .git, and dot-directories', () => {
  const dir = mkProjectRoot();
  write(dir, 'node_modules/pkg/index.js', 'x');
  write(dir, '.git/HEAD', 'x');
  write(dir, '.hidden/file.txt', 'x');
  write(dir, 'src/real.js', 'x');
  const result = inventoryTarget(dir);
  assert.deepEqual(result.files.map((f) => f.path), ['src/real.js']);
});

// --- lang mapping ---

test('inventoryTarget maps file extensions to lang names and tallies by_lang', () => {
  const dir = mkProjectRoot();
  write(dir, 'a.js', 'x');
  write(dir, 'b.py', 'x');
  write(dir, 'c.ts', 'x');
  write(dir, 'README.md', 'x');
  write(dir, 'noext', 'x');
  const result = inventoryTarget(dir);
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.lang]));
  assert.equal(byPath['a.js'], 'javascript');
  assert.equal(byPath['b.py'], 'python');
  assert.equal(byPath['c.ts'], 'typescript');
  assert.equal(byPath['README.md'], 'markdown');
  assert.equal(byPath['noext'], 'other');
  assert.deepEqual(result.summary.by_lang, { javascript: 1, python: 1, typescript: 1, markdown: 1, other: 1 });
});

test('inventoryTarget records byte sizes matching the files on disk', () => {
  const dir = mkProjectRoot();
  write(dir, 'a.txt', 'hello world');
  const result = inventoryTarget(dir);
  assert.equal(result.files[0].bytes, Buffer.byteLength('hello world'));
});

// --- deterministic ordering ---

test('inventoryTarget returns files sorted by path regardless of on-disk creation order', () => {
  const dir = mkProjectRoot();
  write(dir, 'z.js', 'x');
  write(dir, 'a/b.js', 'x');
  write(dir, 'a.js', 'x');
  const result = inventoryTarget(dir);
  const paths = result.files.map((f) => f.path);
  const sorted = [...paths].sort();
  assert.deepEqual(paths, sorted);
});

// --- maxEntries truncation ---

test('inventoryTarget truncates to opts.maxEntries and sets truncated: true, keeping the sorted prefix', () => {
  const dir = mkProjectRoot();
  for (const name of ['a.js', 'b.js', 'c.js', 'd.js', 'e.js']) {
    write(dir, name, 'x');
  }
  const result = inventoryTarget(dir, { maxEntries: 3 });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.files.map((f) => f.path), ['a.js', 'b.js', 'c.js']);
});

test('inventoryTarget reports truncated: false when file count is within maxEntries', () => {
  const dir = mkProjectRoot();
  write(dir, 'a.js', 'x');
  const result = inventoryTarget(dir, { maxEntries: 5000 });
  assert.equal(result.truncated, false);
});

test('inventoryTarget defaults maxEntries to 5000', () => {
  const dir = mkProjectRoot();
  write(dir, 'a.js', 'x');
  const result = inventoryTarget(dir, {});
  assert.equal(result.truncated, false);
});

test('inventoryTarget throws a TypeError for a non-positive-integer opts.maxEntries', () => {
  const dir = mkProjectRoot();
  assert.throws(() => inventoryTarget(dir, { maxEntries: 0 }), TypeError);
  assert.throws(() => inventoryTarget(dir, { maxEntries: -1 }), TypeError);
  assert.throws(() => inventoryTarget(dir, { maxEntries: 1.5 }), TypeError);
});

// --- entry points ---

test('inventoryTarget reads package.json main and bin (string form) as entry points', () => {
  const dir = mkProjectRoot();
  write(dir, 'package.json', JSON.stringify({ main: 'lib/index.js', bin: 'bin/cli.js' }));
  write(dir, 'lib/index.js', 'x');
  write(dir, 'bin/cli.js', 'x');
  const result = inventoryTarget(dir);
  assert.ok(result.summary.entry_points.includes('lib/index.js'));
  assert.ok(result.summary.entry_points.includes('bin/cli.js'));
});

test('inventoryTarget reads package.json bin (object form) as entry points', () => {
  const dir = mkProjectRoot();
  write(dir, 'package.json', JSON.stringify({ bin: { mytool: 'bin/mytool.js' } }));
  write(dir, 'bin/mytool.js', 'x');
  const result = inventoryTarget(dir);
  assert.ok(result.summary.entry_points.includes('bin/mytool.js'));
});

test('inventoryTarget recognizes common conventional entrypoint filenames when present', () => {
  const dir = mkProjectRoot();
  write(dir, 'index.js', 'x');
  write(dir, 'main.py', 'x');
  const result = inventoryTarget(dir);
  assert.ok(result.summary.entry_points.includes('index.js'));
  assert.ok(result.summary.entry_points.includes('main.py'));
});

// --- entry points: containment (P11 Sol review finding 2) ---

test('inventoryTarget drops a package.json main that traverses outside the project', () => {
  const dir = mkProjectRoot();
  write(dir, 'package.json', JSON.stringify({ main: '../../outside-secret.txt' }));
  const result = inventoryTarget(dir);
  assert.deepEqual(result.summary.entry_points, []);
});

test('inventoryTarget drops a package.json bin (string form) that is an absolute path', () => {
  const dir = mkProjectRoot();
  write(dir, 'package.json', JSON.stringify({ bin: '/etc/passwd' }));
  const result = inventoryTarget(dir);
  assert.deepEqual(result.summary.entry_points, []);
});

test('inventoryTarget drops a traversing entry from package.json bin (object form) while keeping a valid sibling', () => {
  const dir = mkProjectRoot();
  write(dir, 'package.json', JSON.stringify({ bin: { good: 'bin/good.js', bad: '../../outside.js' } }));
  write(dir, 'bin/good.js', 'x');
  const result = inventoryTarget(dir);
  assert.deepEqual(result.summary.entry_points, ['bin/good.js']);
});

test('inventoryTarget drops a package.json main naming a file the walk never inventoried (node_modules is skipped)', () => {
  const dir = mkProjectRoot();
  write(dir, 'package.json', JSON.stringify({ main: 'node_modules/pkg/index.js' }));
  write(dir, 'node_modules/pkg/index.js', 'x'); // on disk, but walk() skips node_modules by name
  const result = inventoryTarget(dir);
  assert.deepEqual(result.summary.entry_points, []);
});

test('inventoryTarget drops a package.json main naming a file that does not exist on disk at all', () => {
  const dir = mkProjectRoot();
  write(dir, 'package.json', JSON.stringify({ main: 'lib/index.js' }));
  const result = inventoryTarget(dir);
  assert.deepEqual(result.summary.entry_points, []);
});

test('inventoryTarget normalizes a "./"-prefixed package.json main to its canonical relative form', () => {
  const dir = mkProjectRoot();
  write(dir, 'package.json', JSON.stringify({ main: './lib/index.js' }));
  write(dir, 'lib/index.js', 'x');
  const result = inventoryTarget(dir);
  assert.deepEqual(result.summary.entry_points, ['lib/index.js']);
});

// --- test_dirs ---

test('inventoryTarget lists conventional test directories', () => {
  const dir = mkProjectRoot();
  write(dir, 'test/a.js', 'x');
  write(dir, 'src/spec/b.js', 'x');
  write(dir, 'src/lib.js', 'x');
  const result = inventoryTarget(dir);
  assert.deepEqual(result.summary.test_dirs, ['src/spec', 'test']);
});

// --- git evidence ---

test('inventoryTarget reports has_git: false and no commit_count outside a git repo', () => {
  const dir = mkProjectRoot();
  const result = inventoryTarget(dir);
  assert.equal(result.summary.has_git, false);
  assert.equal('commit_count' in result.summary, false);
});

test('inventoryTarget reports has_git: true and a commit_count inside a git repo with commits', () => {
  const dir = mkProjectRoot();
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'a@b.c'], dir);
  git(['config', 'user.name', 'scout-test'], dir);
  write(dir, 'a.js', 'x');
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'first'], dir);
  const result = inventoryTarget(dir);
  assert.equal(result.summary.has_git, true);
  assert.equal(result.summary.commit_count, 1);
});

test('inventoryTarget reports has_git: true with no commit_count for a git repo with zero commits', () => {
  const dir = mkProjectRoot();
  git(['init', '-q'], dir);
  const result = inventoryTarget(dir);
  assert.equal(result.summary.has_git, true);
  assert.equal('commit_count' in result.summary, false);
});

// --- input validation ---

test('inventoryTarget throws a TypeError when projectRoot is missing or not a string', () => {
  assert.throws(() => inventoryTarget(), TypeError);
  assert.throws(() => inventoryTarget(42), TypeError);
  assert.throws(() => inventoryTarget(''), TypeError);
});

test('inventoryTarget throws when projectRoot does not exist on disk', () => {
  assert.throws(() => inventoryTarget('/nonexistent/definitely/not/here'));
});

test('inventoryTarget throws when <projectRoot>/.thelastskill does not already exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));
  assert.throws(() => inventoryTarget(dir), /treeRoot does not exist/);
});

// --- ruling 5: scout/ symlink containment (all three writers) ---

function validConstraints() {
  return {
    schema_version: 1,
    revision: 1,
    preserve: [{ trust_flag: 'inherited-unverified', note: 'existing auth flow' }],
    protected_paths: [
      {
        trust_flag: 'inherited-unverified',
        path: 'src/legacy/',
        anchor: 'src/legacy/README.md:1',
        note: 'legacy auth module — operator sign-off required before touching',
      },
    ],
    compatibility: [{ trust_flag: 'inherited-advisory', note: 'node 18 runtime floor' }],
    migrations: [],
    known_failures: [],
  };
}

function plantScoutSymlink(treeRoot) {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-outside-'));
  fs.symlinkSync(outside, path.join(treeRoot, 'scout'), 'dir');
  return outside;
}

test('inventoryTarget throws and writes nothing outside the tree when scout/ is a pre-existing symlink', () => {
  const dir = mkProjectRoot();
  write(dir, 'a.js', 'x');
  const treeRoot = treeRootOf(dir);
  const outside = plantScoutSymlink(treeRoot);
  assert.throws(() => inventoryTarget(dir), /symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('writeReuseMap throws and writes nothing outside the tree when scout/ is a pre-existing symlink', () => {
  const dir = mkProjectRoot();
  const treeRoot = treeRootOf(dir);
  const outside = plantScoutSymlink(treeRoot);
  assert.throws(
    () => writeReuseMap(treeRoot, [{ path: 'a.js', trust: 'inherited-unverified', note: 'n' }]),
    /symlink/
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('writeConstraints throws and writes nothing outside the tree when scout/ is a pre-existing symlink', () => {
  const dir = mkProjectRoot();
  const treeRoot = treeRootOf(dir);
  const outside = plantScoutSymlink(treeRoot);
  assert.throws(() => writeConstraints(treeRoot, validConstraints()), /symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

// ============================== writeReuseMap ==============================

function readReuseMap(treeRoot) {
  return JSON.parse(fs.readFileSync(path.join(treeRoot, 'scout', 'reuse-map.json'), 'utf8'));
}

// seedInventory(projectRoot, files) — writes each {relPath: content} to disk
// under projectRoot and runs the real inventoryTarget walk over it, so
// writeReuseMap tests exercise ruling 6 against a genuinely recorded
// inventory.json rather than a hand-built one.
function seedInventory(projectRoot, files) {
  for (const [relPath, content] of Object.entries(files)) {
    write(projectRoot, relPath, content);
  }
  return inventoryTarget(projectRoot);
}

test('writeReuseMap validates and atomic-writes scout/reuse-map.json under treeRoot', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'README.md': 'x', 'test/legacy.test.js': 'x' });
  const entries = [
    { path: 'README.md', trust: 'inherited-unverified', note: 'brainstorm INPUTS' },
    { path: 'test/legacy.test.js', trust: 'inherited-advisory', note: 'verification seed' },
  ];
  const result = writeReuseMap(treeRoot, entries);
  assert.equal(result.schema_version, 1);
  assert.equal(typeof result.generated_ts, 'string');
  assert.equal(result.entries.length, 2);
  assert.deepEqual(readReuseMap(treeRoot), result);
});

test('writeReuseMap sorts entries by path deterministically', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'z.md': 'x', 'a.md': 'x' });
  const entries = [
    { path: 'z.md', trust: 'inherited-unverified', note: 'n' },
    { path: 'a.md', trust: 'inherited-unverified', note: 'n' },
  ];
  const result = writeReuseMap(treeRoot, entries);
  assert.deepEqual(result.entries.map((e) => e.path), ['a.md', 'z.md']);
});

test('writeReuseMap throws a TypeError when entries is not an array', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  assert.throws(() => writeReuseMap(treeRoot, 'nope'), TypeError);
  assert.throws(() => writeReuseMap(treeRoot, undefined), TypeError);
});

test('writeReuseMap throws a TypeError for an entry with an unrecognized trust flag', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'a.md': 'x' });
  assert.throws(
    () => writeReuseMap(treeRoot, [{ path: 'a.md', trust: 'fully-trusted', note: 'n' }]),
    TypeError
  );
});

test('writeReuseMap throws a TypeError for an entry missing path or note', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  assert.throws(() => writeReuseMap(treeRoot, [{ trust: 'inherited-unverified', note: 'n' }]), TypeError);
  assert.throws(() => writeReuseMap(treeRoot, [{ path: 'a.md', trust: 'inherited-unverified' }]), TypeError);
});

test('writeReuseMap throws a TypeError when treeRoot is missing or not a string', () => {
  assert.throws(() => writeReuseMap(undefined, []), TypeError);
  assert.throws(() => writeReuseMap('', []), TypeError);
});

// --- ruling 6: reuse-map traceability against inventory.json + disk ---

test('writeReuseMap throws naming the entry when inventory.json does not exist yet', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  write(projectRoot, 'a.md', 'x');
  assert.throws(
    () => writeReuseMap(treeRoot, [{ path: 'a.md', trust: 'inherited-unverified', note: 'n' }]),
    /inventory\.json to already exist/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'scout', 'reuse-map.json')), false);
});

test('writeReuseMap throws naming an entry with an absolute path', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'a.md': 'x' });
  assert.throws(
    () =>
      writeReuseMap(treeRoot, [
        { path: '/definitely/not/here.js', trust: 'inherited-unverified', note: 'n' },
      ]),
    /entries\[0\]\.path "\/definitely\/not\/here\.js" must be relative/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'scout', 'reuse-map.json')), false);
});

test('writeReuseMap throws naming an entry with a ".." traversal path', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'a.md': 'x' });
  assert.throws(
    () => writeReuseMap(treeRoot, [{ path: '../outside.js', trust: 'inherited-unverified', note: 'n' }]),
    /entries\[0\]\.path "\.\.\/outside\.js" must not contain a "\.\." segment/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'scout', 'reuse-map.json')), false);
});

test('writeReuseMap throws naming an entry absent from the recorded inventory', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'a.md': 'x' });
  write(projectRoot, 'missing.js', 'x'); // exists on disk but was never walked/inventoried
  assert.throws(
    () => writeReuseMap(treeRoot, [{ path: 'missing.js', trust: 'inherited-unverified', note: 'n' }]),
    /entries\[0\]\.path "missing\.js" is not present in/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'scout', 'reuse-map.json')), false);
});

test('writeReuseMap throws naming an inventoried entry that has since been deleted from disk', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'gone.js': 'x' });
  fs.unlinkSync(path.join(projectRoot, 'gone.js'));
  assert.throws(
    () => writeReuseMap(treeRoot, [{ path: 'gone.js', trust: 'inherited-unverified', note: 'n' }]),
    /entries\[0\]\.path "gone\.js" no longer exists on disk/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'scout', 'reuse-map.json')), false);
});

test('writeReuseMap accepts a real walked inventory and the written entries revalidate from disk', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'README.md': 'x', 'src/legacy.js': 'x' });
  const entries = [
    { path: 'README.md', trust: 'inherited-unverified', note: 'brainstorm INPUTS' },
    { path: 'src/legacy.js', trust: 'inherited-advisory', note: 'verification seed' },
  ];
  const result = writeReuseMap(treeRoot, entries);
  assert.equal(result.entries.length, 2);
  const onDisk = readReuseMap(treeRoot);
  assert.deepEqual(onDisk, result);
  for (const entry of onDisk.entries) {
    assert.equal(fs.existsSync(path.join(projectRoot, entry.path)), true);
  }
});

// ============================== writeConstraints ============================

function readConstraints(treeRoot) {
  return JSON.parse(fs.readFileSync(path.join(treeRoot, 'scout', 'constraints.json'), 'utf8'));
}

test('writeConstraints validates via validators.validateScoutConstraints and atomic-writes scout/constraints.json', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  const constraints = validConstraints();
  const result = writeConstraints(treeRoot, constraints);
  assert.deepEqual(result, constraints);
  assert.deepEqual(readConstraints(treeRoot), constraints);
});

test('writeConstraints throws a TypeError and writes nothing for constraints missing a required field', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  const constraints = validConstraints();
  delete constraints.known_failures;
  assert.throws(() => writeConstraints(treeRoot, constraints), TypeError);
  assert.equal(fs.existsSync(path.join(treeRoot, 'scout', 'constraints.json')), false);
});

test('writeConstraints throws a TypeError for an entry with an unrecognized trust_flag', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  const constraints = validConstraints();
  constraints.preserve[0].trust_flag = 'fully-trusted';
  assert.throws(() => writeConstraints(treeRoot, constraints), TypeError);
});

test('writeConstraints throws a TypeError when treeRoot is missing or not a string', () => {
  assert.throws(() => writeConstraints(undefined, validConstraints()), TypeError);
  assert.throws(() => writeConstraints('', validConstraints()), TypeError);
});

// ---------- CLI (P11 finding F2: scout-agent.md's own cwd-relative `node -e`
// require, plus a false "from the project root" assertion) ----------

const CLI_PATH = path.join(__dirname, '..', 'src', 'scout.js');

test('CLI: inventory <projectRoot> prints the same document inventoryTarget writes to disk', () => {
  const projectRoot = mkProjectRoot();
  write(projectRoot, 'index.js', 'console.log(1);\n');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'inventory', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.deepEqual(printed, readInventory(projectRoot));
  assert.ok(printed.files.some((f) => f.path === 'index.js'));
});

test('CLI: inventory honors an explicit maxEntries argument', () => {
  const projectRoot = mkProjectRoot();
  write(projectRoot, 'a.js');
  write(projectRoot, 'b.js');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'inventory', projectRoot, '1'], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.truncated, true);
  assert.equal(printed.files.length, 1);
});

test('CLI: missing projectRoot exits 1 with a usage message', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'inventory'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage/);
});

test('CLI: a nonexistent projectRoot exits 1 naming the error', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'inventory', '/no/such/path'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /does not exist/);
});

test('CLI: a maxEntries argument with trailing garbage ("1garbage") exits 1 rather than silently truncating to 1 (P11 Sol review finding 9)', () => {
  const projectRoot = mkProjectRoot();
  write(projectRoot, 'a.js');
  const proc = spawnSync(process.execPath, [CLI_PATH, 'inventory', projectRoot, '1garbage'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /maxEntries/);
});

// ---------- CLI: write-reuse-map / write-constraints (P11 convergence
// finding 3) ----------

test('CLI: write-reuse-map reads entries from stdin and writes scout/reuse-map.json', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'README.md': 'x' });
  const entries = [{ path: 'README.md', trust: 'inherited-unverified', note: 'brainstorm INPUTS' }];
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-reuse-map', treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify(entries),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.deepEqual(printed, readReuseMap(treeRoot));
  assert.equal(printed.entries.length, 1);
});

test('CLI: write-reuse-map exits 1 and writes nothing for an entry the inventory never saw', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'README.md': 'x' });
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-reuse-map', treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify([{ path: 'never-inventoried.js', trust: 'inherited-unverified', note: 'n' }]),
  });
  assert.equal(proc.status, 1);
  assert.equal(fs.existsSync(path.join(treeRoot, 'scout', 'reuse-map.json')), false);
});

test('CLI: write-reuse-map exits 1 on invalid JSON via stdin', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  seedInventory(projectRoot, { 'README.md': 'x' });
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-reuse-map', treeRoot], { encoding: 'utf8', input: 'not json' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^scout\.js: /);
});

test('CLI: write-constraints reads the constraints object from stdin and writes scout/constraints.json', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  fs.mkdirSync(treeRoot, { recursive: true });
  const constraints = validConstraints();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-constraints', treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify(constraints),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), constraints);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(treeRoot, 'scout', 'constraints.json'), 'utf8')), constraints);
});

test('CLI: write-constraints exits 1 and writes nothing for a malformed constraints document', () => {
  const projectRoot = mkProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  fs.mkdirSync(treeRoot, { recursive: true });
  const proc = spawnSync(process.execPath, [CLI_PATH, 'write-constraints', treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify({ schema_version: 1 }),
  });
  assert.equal(proc.status, 1);
  assert.equal(fs.existsSync(path.join(treeRoot, 'scout', 'constraints.json')), false);
});

test('CLI: write-reuse-map/write-constraints missing treeRoot prints usage and exits 1', () => {
  const proc1 = spawnSync(process.execPath, [CLI_PATH, 'write-reuse-map'], { encoding: 'utf8' });
  assert.equal(proc1.status, 1);
  assert.match(proc1.stderr, /usage/);
  const proc2 = spawnSync(process.execPath, [CLI_PATH, 'write-constraints'], { encoding: 'utf8' });
  assert.equal(proc2.status, 1);
  assert.match(proc2.stderr, /usage/);
});

test('CLI: unknown command prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'bogus'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage/);
});

// --- ensureTreeSubdir: the §9.2.2 generalization of ensureScoutDir ---
//
// ensureScoutDir is now one caller of a shared guard rather than a
// scout-only body, so intake.js becomes a CALLER of that guard and never a
// second copy of the check. The whole addition is the `name` contract:
// one lowercase basename, `/^[a-z][a-z0-9-]*$/`, which rejects an absolute
// path, `.`, `..`, a separator in either direction, the empty string, a
// leading dot, and an uppercase letter — everything after it is
// ensureScoutDir's already-proven body.

test('D-24 ensure-tree-subdir-rejects-traversal: every non-basename `name` is refused before any mkdir', () => {
  const dir = mkProjectRoot();
  const treeRoot = treeRootOf(dir);
  const rejected = ['/abs', '.', '..', 'a/b', 'a\\b', '', '.hidden', 'Upper', '../escape', 'scout/', '-leading'];
  for (const name of rejected) {
    assert.throws(
      () => ensureTreeSubdir(treeRoot, name),
      /name/,
      `ensureTreeSubdir accepted ${JSON.stringify(name)} as a subdirectory name`
    );
  }
  // Nothing was created by any of the refusals.
  assert.deepEqual(fs.readdirSync(treeRoot), []);
});

test('ensureTreeSubdir creates and returns a real contained subdirectory, and is idempotent', () => {
  const dir = mkProjectRoot();
  const treeRoot = treeRootOf(dir);
  const first = ensureTreeSubdir(treeRoot, 'intake');
  assert.equal(first, path.join(treeRoot, 'intake'));
  assert.equal(fs.lstatSync(first).isDirectory(), true);
  assert.equal(ensureTreeSubdir(treeRoot, 'intake'), first);
  assert.equal(ensureTreeSubdir(treeRoot, 'scout'), path.join(treeRoot, 'scout'));
});

test('ensureTreeSubdir refuses a pre-planted symlink at the subdirectory name and writes nothing outside', () => {
  const dir = mkProjectRoot();
  const treeRoot = treeRootOf(dir);
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(treeRoot, 'intake'), 'dir');
  assert.throws(() => ensureTreeSubdir(treeRoot, 'intake'), /symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('ensureTreeSubdir refuses a symlinked treeRoot rather than resolving through it', () => {
  const dir = mkProjectRoot();
  const treeRoot = treeRootOf(dir);
  // The guard refuses a symlink AT the subdirectory name, and resolved one
  // at the root — so a caller handed a symlinked tree root created the
  // subdirectory inside whatever the link pointed at, which is the very
  // redirection this guard exists to stop. Every caller in the machine
  // happens to validate its own root first; the exported guard must not
  // depend on that.
  const linked = path.join(dir, 'linked-tree');
  fs.symlinkSync(treeRoot, linked, 'dir');

  assert.throws(() => ensureTreeSubdir(linked, 'intake'), /symlink/);

  assert.deepEqual(fs.readdirSync(treeRoot), [], 'the subdirectory was created through the link');
});

test('ensureTreeSubdir requires an existing treeRoot rather than inventing one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));
  assert.throws(() => ensureTreeSubdir(path.join(dir, '.thelastskill'), 'intake'), /does not exist/);
});
