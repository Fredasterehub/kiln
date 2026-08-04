'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ENTRY_KINDS,
  TABLET_FILENAME,
  INDEX_MAX_ENTRIES,
  SUMMARY_MAX_CHARS,
  DETAIL_MAX_CHARS,
  appendEntry,
  readEntries,
  indexLines,
  renderEntry,
} = require('../src/tablet.js');
const { readRecords } = require('../src/stream.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'tablet.js');

function mkTreeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tablet-test-'));
}

function tabletPathOf(treeRoot) {
  return path.join(treeRoot, TABLET_FILENAME);
}

function recordsOf(treeRoot) {
  return readRecords(tabletPathOf(treeRoot)).records;
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8', input: '', ...opts });
}

const VALID = {
  decision: { kind: 'decision', course: 'The session store lands on SQLite', because: 'One file, no server to run on this floor' },
  constraint: { kind: 'constraint', fact: 'sqlite refuses WAL on this filesystem', must_respect: 'Pin journal_mode=DELETE in the migration' },
  failure: {
    kind: 'failure',
    broke: 'The migration ran twice and duplicated every row',
    consequence: 'The seed data had to be dropped and rebuilt by hand',
    prevention: 'Guard every migration with its own applied-marker check before it runs',
  },
};

// ---------- append: the three kinds ----------

for (const kind of ['decision', 'constraint', 'failure']) {
  test(`append records a ${kind} entry with the stream header and its own fields`, () => {
    const treeRoot = mkTreeRoot();
    const id = appendEntry(treeRoot, VALID[kind]);
    assert.equal(id, 'T-0');

    const records = recordsOf(treeRoot);
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, kind);
    assert.equal(records[0].seq, 0);
    assert.equal(records[0].schema_version, 1);
    assert.match(records[0].ts, /^\d{4}-\d{2}-\d{2}T/);
    for (const [field, value] of Object.entries(VALID[kind])) {
      if (field === 'kind') continue;
      assert.equal(records[0][field], value);
    }
  });
}

test('the three kinds are the whole closed set', () => {
  assert.deepEqual([...ENTRY_KINDS].sort(), ['constraint', 'decision', 'failure']);
});

// ---------- identity is the stream's seq ----------

test('entry identity is the stream seq, rendered T-<seq>, monotonic across appends', () => {
  const treeRoot = mkTreeRoot();
  assert.equal(appendEntry(treeRoot, VALID.decision), 'T-0');
  assert.equal(appendEntry(treeRoot, VALID.constraint), 'T-1');
  assert.equal(appendEntry(treeRoot, VALID.failure), 'T-2');
  assert.deepEqual(
    recordsOf(treeRoot).map((r) => r.seq),
    [0, 1, 2]
  );
});

// ---------- fail closed ----------

test('an unknown kind is refused and nothing is written', () => {
  const treeRoot = mkTreeRoot();
  assert.throws(() => appendEntry(treeRoot, { kind: 'note', course: 'a', because: 'b' }), /kind/);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('a missing kind is refused', () => {
  const treeRoot = mkTreeRoot();
  assert.throws(() => appendEntry(treeRoot, { course: 'a', because: 'b' }), /kind/);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('a missing required field is refused and nothing is written', () => {
  const treeRoot = mkTreeRoot();
  assert.throws(() => appendEntry(treeRoot, { kind: 'decision', course: 'Ship it' }), /because/);
  assert.throws(
    () => appendEntry(treeRoot, { kind: 'failure', broke: 'x', consequence: 'y' }),
    /prevention/
  );
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('an empty or whitespace-only field is refused', () => {
  const treeRoot = mkTreeRoot();
  assert.throws(() => appendEntry(treeRoot, { kind: 'decision', course: '', because: 'b' }), /course/);
  assert.throws(() => appendEntry(treeRoot, { kind: 'decision', course: '   ', because: 'b' }), /course/);
  assert.throws(() => appendEntry(treeRoot, { kind: 'constraint', fact: 'f', must_respect: '\n\t' }), /must_respect/);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('a non-string field is refused', () => {
  const treeRoot = mkTreeRoot();
  assert.throws(() => appendEntry(treeRoot, { kind: 'decision', course: 42, because: 'b' }), /course/);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('a field outside the kind’s own set is refused rather than silently dropped', () => {
  const treeRoot = mkTreeRoot();
  assert.throws(
    () => appendEntry(treeRoot, { ...VALID.decision, correlation_id: 'chunk_C03' }),
    /correlation_id/
  );
  assert.throws(() => appendEntry(treeRoot, { ...VALID.constraint, seq: 7 }), /seq/);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('a summary over the hard cap in UTF-16 code units is refused: the entry is a record, not a diary', () => {
  const treeRoot = mkTreeRoot();
  const overCap = 'x'.repeat(SUMMARY_MAX_CHARS + 1);
  assert.throws(() => appendEntry(treeRoot, { kind: 'decision', course: overCap, because: 'b' }), /course/);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);

  assert.equal(appendEntry(treeRoot, { kind: 'decision', course: 'x'.repeat(SUMMARY_MAX_CHARS), because: 'b' }), 'T-0');
});

test('a detail field over the hard cap is refused', () => {
  const treeRoot = mkTreeRoot();
  const overCap = 'y'.repeat(DETAIL_MAX_CHARS + 1);
  assert.throws(() => appendEntry(treeRoot, { kind: 'decision', course: 'Ship it', because: overCap }), /because/);
  assert.throws(
    () => appendEntry(treeRoot, { ...VALID.failure, prevention: overCap }),
    /prevention/
  );
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

// An index line is one line by contract, so a field that cannot render as one
// line is not a lawful field: a summary carrying a newline would print as two
// physical lines and inject apparent structure into every index rendering it.
test('a field carrying a control character is refused: an index line is one line', () => {
  const treeRoot = mkTreeRoot();
  assert.throws(
    () => appendEntry(treeRoot, { kind: 'decision', course: 'lawful first line\n## Injected section', because: 'b' }),
    /course/
  );
  assert.throws(() => appendEntry(treeRoot, { kind: 'decision', course: 'a\rb', because: 'b' }), /course/);
  assert.throws(() => appendEntry(treeRoot, { kind: 'decision', course: 'Ship it', because: 'a\nb' }), /because/);
  assert.throws(() => appendEntry(treeRoot, { ...VALID.failure, prevention: 'a\u0000b' }), /prevention/);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('a non-object entry is refused', () => {
  const treeRoot = mkTreeRoot();
  assert.throws(() => appendEntry(treeRoot, 'decision'), TypeError);
  assert.throws(() => appendEntry(treeRoot, ['decision']), TypeError);
});

test('an empty treeRoot is refused', () => {
  assert.throws(() => appendEntry('', VALID.decision), TypeError);
  assert.throws(() => appendEntry(undefined, VALID.decision), TypeError);
});

// ---------- reading ----------

test('readEntries returns the lawful entries in stream order and skips foreign lines', () => {
  const treeRoot = mkTreeRoot();
  appendEntry(treeRoot, VALID.decision);
  fs.appendFileSync(tabletPathOf(treeRoot), `${JSON.stringify({ schema_version: 1, seq: 1, kind: 'note', ts: '2026-07-31T00:00:00.000Z', text: 'x' })}\n`);
  fs.appendFileSync(tabletPathOf(treeRoot), '{ not json\n');
  appendEntry(treeRoot, VALID.constraint);

  const entries = readEntries(treeRoot);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, 'decision');
  assert.equal(entries[1].kind, 'constraint');
});

test('readEntries on a tree with no tablet yet is empty, not an error', () => {
  assert.deepEqual(readEntries(mkTreeRoot()), []);
});

// One contract, both ends. A hand-written line the append validation would
// refuse is not memory however lawful its kind looks, and the read path skips
// it exactly as it skips a foreign kind — so the index it feeds stays one
// bounded, single-line-per-entry record of what the build actually recorded.
const LAWFUL_HEADER = Object.freeze({ schema_version: 1, ts: '2026-07-31T00:00:00.000Z', correlation_id: null });

const UNLAWFUL_LINES = {
  'a wrong schema_version': { ...LAWFUL_HEADER, schema_version: 2, seq: 1, kind: 'decision', course: 'c', because: 'b' },
  'an invalid ts': { ...LAWFUL_HEADER, ts: 'yesterday', seq: 1, kind: 'decision', course: 'c', because: 'b' },
  'a non-null correlation_id': {
    ...LAWFUL_HEADER,
    correlation_id: 'chunk_C03',
    seq: 1,
    kind: 'decision',
    course: 'c',
    because: 'b',
  },
  'an extra payload key': { ...LAWFUL_HEADER, seq: 1, kind: 'decision', course: 'c', because: 'b', note: 'x' },
  'an over-cap summary': {
    ...LAWFUL_HEADER,
    seq: 1,
    kind: 'decision',
    course: 'x'.repeat(SUMMARY_MAX_CHARS + 1),
    because: 'b',
  },
  'missing header fields': { seq: 1, kind: 'decision', course: 'c', because: 'b' },
  'a summary carrying an embedded newline': {
    ...LAWFUL_HEADER,
    seq: 1,
    kind: 'decision',
    course: 'lawful first line\n## Injected section',
    because: 'b',
  },
};

for (const [flaw, record] of Object.entries(UNLAWFUL_LINES)) {
  test(`readEntries skips a same-kind line carrying ${flaw}`, () => {
    const treeRoot = mkTreeRoot();
    appendEntry(treeRoot, VALID.decision);
    fs.appendFileSync(tabletPathOf(treeRoot), `${JSON.stringify(record)}\n`);

    const entries = readEntries(treeRoot);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].seq, 0);
  });

  test(`view renders no line for a same-kind line carrying ${flaw}`, () => {
    const treeRoot = mkTreeRoot();
    appendEntry(treeRoot, VALID.decision);
    fs.appendFileSync(tabletPathOf(treeRoot), `${JSON.stringify(record)}\n`);

    const proc = runCli(['view', treeRoot]);
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(proc.stdout, `- T-0 decision — ${VALID.decision.course}\n`);
    assert.equal(proc.stdout.trimEnd().split('\n').length, 1);
  });
}

test('indexLines renders newest first, one line per entry, id + kind + summary', () => {
  const treeRoot = mkTreeRoot();
  appendEntry(treeRoot, VALID.decision);
  appendEntry(treeRoot, VALID.constraint);

  const lines = indexLines(readEntries(treeRoot), INDEX_MAX_ENTRIES);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], `- T-1 constraint — ${VALID.constraint.fact}`);
  assert.equal(lines[1], `- T-0 decision — ${VALID.decision.course}`);
});

test('indexLines caps at the stated count and says how many more there are', () => {
  const treeRoot = mkTreeRoot();
  const total = INDEX_MAX_ENTRIES + 5;
  for (let i = 0; i < total; i++) {
    appendEntry(treeRoot, { kind: 'decision', course: `course ${i}`, because: 'b' });
  }

  const lines = indexLines(readEntries(treeRoot), INDEX_MAX_ENTRIES);
  assert.equal(lines.length, INDEX_MAX_ENTRIES);
  assert.equal(lines[0], `- T-${total - 1} decision — course ${total - 1}`);
  assert.equal(lines[lines.length - 1], `- (${total - (INDEX_MAX_ENTRIES - 1)} more entries)`);
});

test('indexLines with a budget of one renders the more-entries line alone', () => {
  const treeRoot = mkTreeRoot();
  appendEntry(treeRoot, VALID.decision);
  appendEntry(treeRoot, VALID.constraint);
  assert.deepEqual(indexLines(readEntries(treeRoot), 1), ['- (2 more entries)']);
});

test('renderEntry prints the id, the kind, when it was recorded, and every field', () => {
  const treeRoot = mkTreeRoot();
  appendEntry(treeRoot, VALID.failure);
  const rendered = renderEntry(readEntries(treeRoot)[0]);

  assert.match(rendered, /^T-0 failure\n/);
  assert.match(rendered, /- Recorded: \d{4}-\d{2}-\d{2}T/);
  assert.ok(rendered.includes(`- Broke: ${VALID.failure.broke}\n`));
  assert.ok(rendered.includes(`- Consequence: ${VALID.failure.consequence}\n`));
  assert.ok(rendered.includes(`- Prevention: ${VALID.failure.prevention}\n`));
});

// ---------- the module offers no way to unwrite an entry ----------

test('the module exposes append and read only: no delete, edit or supersede path', () => {
  const surface = Object.keys(require('../src/tablet.js'));
  for (const forbidden of ['deleteEntry', 'editEntry', 'supersede', 'removeEntry', 'updateEntry']) {
    assert.ok(!surface.includes(forbidden), `tablet.js must not export ${forbidden}`);
  }
});

// ---------- CLI ----------

test('CLI: append takes the entry JSON on stdin and prints the entry id', () => {
  const treeRoot = mkTreeRoot();
  const proc = runCli(['append', treeRoot], { input: JSON.stringify(VALID.constraint) });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(proc.stdout, 'T-0\n');
  assert.equal(recordsOf(treeRoot)[0].fact, VALID.constraint.fact);
});

test('CLI: malformed stdin JSON refuses with exit 1 and writes nothing', () => {
  const treeRoot = mkTreeRoot();
  const proc = runCli(['append', treeRoot], { input: '{ kind: decision' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /tablet\.js: /);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('CLI: stdin JSON that is not an object refuses with exit 1', () => {
  const treeRoot = mkTreeRoot();
  const proc = runCli(['append', treeRoot], { input: '["decision"]' });
  assert.equal(proc.status, 1);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('CLI: an unknown kind refuses with exit 1 and writes nothing', () => {
  const treeRoot = mkTreeRoot();
  const proc = runCli(['append', treeRoot], { input: JSON.stringify({ kind: 'progress', course: 'a', because: 'b' }) });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /kind/);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);
});

test('CLI: view prints the bounded index, newest first', () => {
  const treeRoot = mkTreeRoot();
  appendEntry(treeRoot, VALID.decision);
  appendEntry(treeRoot, VALID.constraint);

  const proc = runCli(['view', treeRoot]);
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(proc.stdout, `- T-1 constraint — ${VALID.constraint.fact}\n- T-0 decision — ${VALID.decision.course}\n`);
});

test('CLI: view on a tree with no entries says so and exits 0', () => {
  const proc = runCli(['view', mkTreeRoot()]);
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(proc.stdout, '(no entries)\n');
});

test('CLI: view T-<seq> prints exactly that entry and nothing else', () => {
  const treeRoot = mkTreeRoot();
  appendEntry(treeRoot, VALID.decision);
  appendEntry(treeRoot, VALID.constraint);
  appendEntry(treeRoot, VALID.failure);

  const proc = runCli(['view', treeRoot, 'T-1']);
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /^T-1 constraint\n/);
  assert.ok(proc.stdout.includes(`- Fact: ${VALID.constraint.fact}\n`));
  assert.ok(!proc.stdout.includes('T-0'));
  assert.ok(!proc.stdout.includes('T-2'));
});

test('CLI: an unknown entry id is a plain not-found error', () => {
  const treeRoot = mkTreeRoot();
  appendEntry(treeRoot, VALID.decision);

  const proc = runCli(['view', treeRoot, 'T-9']);
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^tablet\.js: .*no entry T-9 in tablet\.jsonl\n$/);
  assert.equal(proc.stdout, '');
});

test('CLI: an entry id that is not T-<seq> is refused', () => {
  const treeRoot = mkTreeRoot();
  appendEntry(treeRoot, VALID.decision);

  const proc = runCli(['view', treeRoot, '0']);
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /T-<seq>/);
});

test('CLI: an unknown command, a missing treeRoot, or a surplus argument fails closed', () => {
  const treeRoot = mkTreeRoot();

  const unknown = runCli(['supersede', treeRoot], { input: JSON.stringify(VALID.decision) });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /usage: tablet\.js append <treeRoot>/);

  const bare = runCli(['view']);
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /usage: tablet\.js append <treeRoot>/);

  const surplus = runCli(['append', treeRoot, 'T-0'], { input: JSON.stringify(VALID.decision) });
  assert.equal(surplus.status, 1);
  assert.match(surplus.stderr, /unexpected extra argument/);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), false);

  const viewSurplus = runCli(['view', treeRoot, 'T-0', 'T-1']);
  assert.equal(viewSurplus.status, 1);
  assert.match(viewSurplus.stderr, /unexpected extra argument/);
});

// The tree root is the explicit argument in every subcommand: the CLI run from
// an unrelated working directory writes to the root it was handed and leaves
// the working directory untouched.
test('CLI: the tree root is the argument, never the working directory', () => {
  const treeRoot = mkTreeRoot();
  const elsewhere = mkTreeRoot();

  const appended = runCli(['append', treeRoot], { input: JSON.stringify(VALID.decision), cwd: elsewhere });
  assert.equal(appended.status, 0, appended.stderr);
  assert.equal(fs.existsSync(tabletPathOf(treeRoot)), true);
  assert.deepEqual(fs.readdirSync(elsewhere), []);

  const viewed = runCli(['view', treeRoot], { cwd: elsewhere });
  assert.equal(viewed.status, 0, viewed.stderr);
  assert.match(viewed.stdout, /- T-0 decision — /);
});
