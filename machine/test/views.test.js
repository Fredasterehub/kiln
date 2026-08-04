'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { regenerate, VIEW_NAMES, MAX_VIEW_BYTES } = require('../src/views.js');
const { readJson, writeAtomic } = require('../src/atomic-json.js');

const MODULE_PATH = path.resolve(__dirname, '..', 'src', 'views.js');

function makeTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'views-test-'));
  const treeRoot = path.join(tmp, '.thelastskill');
  fs.mkdirSync(treeRoot, { recursive: true });
  writeAtomic(path.join(treeRoot, 'state.json'), {
    schema_version: 1,
    phase: 'implementation',
    phase_status: { onboarding: 'complete' },
    next_action: 'implementation',
    updated_utc: '2026-01-01T00:00:00.000Z',
  });
  return treeRoot;
}

function record(seq, kind, extra = {}) {
  return {
    schema_version: 1,
    seq,
    kind,
    ts: '2026-01-01T00:00:00.000Z',
    correlation_id: null,
    ...extra,
  };
}

function writeLedger(treeRoot, records) {
  fs.writeFileSync(path.join(treeRoot, 'ledger.jsonl'), records.map((e) => `${JSON.stringify(e)}\n`).join(''));
}

function viewPath(treeRoot, name) {
  return path.join(treeRoot, 'views', `${name}.json`);
}

function readView(treeRoot, name) {
  return readJson(viewPath(treeRoot, name), null);
}

// Every view carries when it was made; that is the one field a second
// regeneration is allowed to change.
function withoutTimestamps(view) {
  const { generated_at, ...rest } = view;
  return rest;
}

function holdOpen(seq, id, extra = {}) {
  return record(seq, 'hold-open', {
    hold_id: id,
    severity: 'S2',
    summary: `hold ${id}`,
    origin_ref: 'ledger:0',
    ...extra,
  });
}

// ---------- what regeneration produces ----------

test('regenerate writes every named view, and reports what it wrote', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    holdOpen(0, 'h1'),
    record(1, 'degraded-route', {
      route_id: 'r1',
      expected: 'codex',
      actual: 'claude',
      reason: 'codex absent',
      scope_ref: 'ledger:0',
    }),
  ]);

  const receipt = regenerate(treeRoot);

  assert.deepEqual(
    receipt.views.map((view) => view.name).sort(),
    [...VIEW_NAMES].sort()
  );
  for (const name of VIEW_NAMES) {
    assert.ok(fs.statSync(viewPath(treeRoot, name)).isFile(), `${name} was not written`);
    assert.ok(readView(treeRoot, name) !== null);
  }
});

test('the holds view carries the open holds and nothing that was resolved', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    holdOpen(0, 'h1'),
    holdOpen(1, 'h2'),
    record(2, 'hold-resolve', { hold_id: 'h1', exit: 'resolved', resolution_ref: 'ledger:0' }),
  ]);

  regenerate(treeRoot);

  const view = readView(treeRoot, 'open-holds');
  assert.deepEqual(
    view.entries.map((entry) => entry.hold_id),
    ['h2']
  );
  assert.equal(view.dropped, 0);
});

test('the degraded-routes view surfaces a capability that went degraded mid-build, and only that', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    holdOpen(0, 'h1'),
    record(1, 'degraded-route', {
      route_id: 'r1',
      expected: 'codex',
      actual: 'claude',
      reason: 'codex went unreachable',
      scope_ref: 'ledger:0',
    }),
    record(2, 'dispatch', { dispatch_id: 'd1' }),
    holdOpen(3, 'h2'),
  ]);

  regenerate(treeRoot);

  // Four records in the stream, one of them a degraded route. A view that
  // carried the other three would still look plausible.
  const view = readView(treeRoot, 'degraded-routes');
  assert.equal(view.entries.length, 1);
  assert.equal(view.total, 1);
  assert.equal(view.entries[0].route_id, 'r1');
  assert.equal(view.entries[0].expected, 'codex');
  assert.equal(view.entries[0].actual, 'claude');
});

test('the friction view carries the rates, and no thresholds or verdicts about them', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    record(0, 'dispatch', { dispatch_id: 'd1' }),
    record(1, 'dispatch-terminal', { dispatch_id: 'd1', status: 'failed', reason: 'timeout', builder: null }),
  ]);

  regenerate(treeRoot);

  const view = readView(treeRoot, 'friction-rates');
  assert.equal(view.entries[0].dispatches_terminals, 1);
  assert.equal(view.entries[0].dispatches_timeout_share, 1);
  // Rates only. Whether a rate is acceptable is a decision, and decisions
  // live where they can be argued with, not in a generated file.
  const text = JSON.stringify(view);
  assert.equal(/threshold|verdict|healthy|promote|acceptable/i.test(text), false);
});

test('the position view says where the build stands without deciding anything about it', () => {
  const treeRoot = makeTree();
  fs.mkdirSync(path.join(treeRoot, 'milestones', 'M1'), { recursive: true });
  fs.writeFileSync(
    path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl'),
    [
      record(0, 'chunk-spec', { chunk_id: 'C1', brief_ref: 'M1/spec.md#C1' }),
      record(1, 'chunk-green', { chunk_id: 'C1', commit: 'abc1234' }),
      record(2, 'chunk-spec', { chunk_id: 'C2', brief_ref: 'M1/spec.md#C2' }),
    ]
      .map((e) => `${JSON.stringify(e)}\n`)
      .join('')
  );
  fs.writeFileSync(
    path.join(treeRoot, 'milestones', 'index.json'),
    JSON.stringify(
      {
        schema_version: 1,
        milestones: [
          { id: 'M0', title: 'first', designer_family: 'claude', status: 'green' },
          { id: 'M1', title: 'second', designer_family: 'gpt', status: 'open' },
          { id: 'M2', title: 'third', designer_family: 'claude', status: 'open' },
        ],
      },
      null,
      2
    )
  );

  regenerate(treeRoot);

  const view = readView(treeRoot, 'position');
  assert.equal(view.dropped, 0);
  assert.equal(view.total, 1);
  // The full position contract wake.js already speaks — including the chunk
  // counts. A position view that reports where the build is but not how far
  // through the milestone it got is a different, smaller contract.
  assert.deepEqual(view.entries[0], {
    phase: 'implementation',
    next_action: 'implementation',
    milestone_id: 'M1',
    // The FIRST milestone that is not green — not simply the last one, which
    // would name M2 here and would be wrong about where the build is.
    milestone_index: 2,
    milestone_total: 3,
    milestone_status: 'open',
    chunks_recorded: 2,
    chunks_green: 1,
  });
});

// ---------- boundedness ----------

test('a view stays under its byte cap and says how much it dropped', () => {
  const treeRoot = makeTree();
  const many = [];
  for (let seq = 0; seq < 2000; seq += 1) {
    many.push(holdOpen(seq, `h${seq}`, { summary: `a hold with a long explanation ${'x'.repeat(200)}` }));
  }
  writeLedger(treeRoot, many);

  regenerate(treeRoot);

  const view = readView(treeRoot, 'open-holds');
  // Every file, not just the one that grew: the cap is a promise about what a
  // reader will find on disk, and a reader does not know which view was the
  // one under pressure.
  for (const name of VIEW_NAMES) {
    const size = fs.statSync(viewPath(treeRoot, name)).size;
    assert.ok(size <= MAX_VIEW_BYTES, `${name} is ${size} bytes, over the ${MAX_VIEW_BYTES} cap`);
  }
  const bytes = fs.statSync(viewPath(treeRoot, 'open-holds')).size;
  assert.ok(bytes > MAX_VIEW_BYTES / 2, 'the fixture did not actually push the view against its cap');
  // A view is a view: it is allowed to be lossy, and required to say so.
  assert.ok(view.dropped > 0);
  assert.equal(view.total, 2000);
  assert.equal(view.entries.length + view.dropped, view.total);
});

test('every view file has its own growth path, and every one of them is capped', () => {
  const bulky = 'x'.repeat(300);

  // open-holds: many holds.
  const holdsTree = makeTree();
  writeLedger(
    holdsTree,
    Array.from({ length: 400 }, (_, seq) => holdOpen(seq, `h${seq}`, { summary: `${bulky}${seq}` }))
  );

  // degraded-routes: many degraded routes.
  const degradedTree = makeTree();
  writeLedger(
    degradedTree,
    Array.from({ length: 400 }, (_, seq) =>
      record(seq, 'degraded-route', {
        route_id: `r${seq}`,
        expected: 'codex',
        actual: 'claude',
        reason: `${bulky}${seq}`,
        scope_ref: 'ledger:0',
      })
    )
  );

  // friction-by-chunk: many chunks across many milestones.
  const chunksTree = makeTree();
  const index = { schema_version: 1, milestones: [] };
  for (let m = 0; m < 20; m += 1) {
    // The milestone id is a directory name, so the bulk goes on the chunk id,
    // which is not.
    const id = `M${m}`;
    index.milestones.push({ id, title: id, designer_family: 'claude', status: 'open' });
    fs.mkdirSync(path.join(chunksTree, 'milestones', id), { recursive: true });
    fs.writeFileSync(
      path.join(chunksTree, 'milestones', id, 'chunks.jsonl'),
      Array.from({ length: 20 }, (_, c) =>
        `${JSON.stringify(record(c, 'chunk-spec', { chunk_id: `C${c}-${bulky}`, brief_ref: 'x' }))}\n`
      ).join('')
    );
  }
  fs.mkdirSync(path.join(chunksTree, 'milestones'), { recursive: true });
  fs.writeFileSync(path.join(chunksTree, 'milestones', 'index.json'), JSON.stringify(index, null, 2));

  // friction-by-seat: many distinct seats.
  const seatsTree = makeTree();
  writeLedger(
    seatsTree,
    Array.from({ length: 400 }, (_, seq) =>
      record(seq, 'dispatch', { dispatch_id: `d${seq}`, seat: `seat-${seq}-${bulky}`, transport: `t${seq}` })
    )
  );

  for (const [label, tree] of [
    ['open-holds', holdsTree],
    ['degraded-routes', degradedTree],
    ['friction-by-chunk', chunksTree],
    ['friction-by-seat', seatsTree],
  ]) {
    regenerate(tree);
    for (const name of VIEW_NAMES) {
      const size = fs.statSync(viewPath(tree, name)).size;
      assert.ok(size <= MAX_VIEW_BYTES, `${label}: ${name} is ${size} bytes, over the ${MAX_VIEW_BYTES} cap`);
    }
    const grown = readView(tree, label);
    assert.ok(grown.dropped > 0, `${label} did not actually drop anything — its growth path is unexercised`);
    assert.equal(grown.entries.length + grown.dropped, grown.total);
  }
});

test('the position view is capped too, and drops its entry rather than truncating an identifier', () => {
  const treeRoot = makeTree();
  // A phase id long enough that the position entry cannot fit. Shortening it
  // would name a phase that does not exist, so the entry goes rather than the
  // truth — and `dropped` says so.
  writeAtomic(path.join(treeRoot, 'state.json'), {
    schema_version: 1,
    phase: 'p'.repeat(MAX_VIEW_BYTES + 500),
    phase_status: {},
    next_action: 'x',
    updated_utc: '2026-01-01T00:00:00.000Z',
  });

  regenerate(treeRoot);

  const size = fs.statSync(viewPath(treeRoot, 'position')).size;
  assert.ok(size <= MAX_VIEW_BYTES, `position is ${size} bytes, over the ${MAX_VIEW_BYTES} cap`);
  const view = readView(treeRoot, 'position');
  assert.deepEqual(view.entries, []);
  assert.equal(view.dropped, 1);
  assert.equal(view.total, 1);
});

test('a view bounds its entry COUNT even when every entry would fit in its bytes', () => {
  const treeRoot = makeTree();
  // Two hundred tiny holds: comfortably inside the byte cap, and still far
  // more than a view should hand a reader. Bytes and count are two different
  // bounds, and only one of them binds here.
  writeLedger(
    treeRoot,
    Array.from({ length: 200 }, (_, seq) => record(seq, 'hold-open', { hold_id: `h${seq}` }))
  );

  regenerate(treeRoot);

  const view = readView(treeRoot, 'open-holds');
  assert.ok(fs.statSync(viewPath(treeRoot, 'open-holds')).size < MAX_VIEW_BYTES / 2);
  assert.equal(view.total, 200);
  assert.equal(view.entries.length, 50);
  assert.equal(view.dropped, 150);
});

test('a record outside the selector never reaches any view, whatever it contains', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    holdOpen(0, 'h1'),
    // Real ledger kinds outside every view's selector, plus a field on a kind
    // that IS in a selector but which no view declares.
    record(1, 'gate', { gate_id: 'suite', detail: 'MUST-NOT-SURFACE' }),
    record(2, 'deviation', { summary: 'MUST-NOT-SURFACE' }),
    record(3, 'stop', { stop_state: 'DONE', question: 'MUST-NOT-SURFACE' }),
    record(4, 'invented-kind', { anything: 'MUST-NOT-SURFACE' }),
    holdOpen(5, 'h2', { operator_note: 'MUST-NOT-SURFACE' }),
  ]);

  regenerate(treeRoot);


  for (const name of VIEW_NAMES) {
    const text = fs.readFileSync(viewPath(treeRoot, name), 'utf8');
    assert.equal(text.includes('MUST-NOT-SURFACE'), false, `${name} leaked a record the selector excludes`);
  }
  // The holds themselves did come through — the selector is a filter, not a wall.
  assert.deepEqual(
    readView(treeRoot, 'open-holds').entries.map((entry) => entry.hold_id),
    ['h1', 'h2']
  );
});

// ---------- regeneration ----------

test('regenerating twice leaves byte-identical views, timestamps aside', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [holdOpen(0, 'h1'), holdOpen(1, 'h2')]);

  regenerate(treeRoot);
  const first = VIEW_NAMES.map((name) => withoutTimestamps(readView(treeRoot, name)));

  regenerate(treeRoot);
  const second = VIEW_NAMES.map((name) => withoutTimestamps(readView(treeRoot, name)));

  assert.deepEqual(second, first);
});

test('regeneration replaces a stale view rather than leaving yesterday\'s answer beside today\'s', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [holdOpen(0, 'h1')]);
  regenerate(treeRoot);
  assert.equal(readView(treeRoot, 'open-holds').entries.length, 1);

  writeLedger(treeRoot, [
    holdOpen(0, 'h1'),
    record(1, 'hold-resolve', { hold_id: 'h1', exit: 'resolved', resolution_ref: 'ledger:0' }),
  ]);
  regenerate(treeRoot);

  assert.deepEqual(readView(treeRoot, 'open-holds').entries, []);
});

test('a half-written views directory is completed by the next run, not left broken', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [holdOpen(0, 'h1')]);
  regenerate(treeRoot);

  // What a crash between two view writes leaves: some views current, one gone.
  fs.rmSync(viewPath(treeRoot, 'friction-rates'));
  // And one left over from an earlier revision of the tree.
  writeAtomic(viewPath(treeRoot, 'open-holds'), { schema_version: 1, entries: [], total: 0, dropped: 0 });

  regenerate(treeRoot);

  assert.ok(readView(treeRoot, 'friction-rates') !== null);
  assert.deepEqual(
    readView(treeRoot, 'open-holds').entries.map((entry) => entry.hold_id),
    ['h1']
  );
});

test('regenerate in a FRESH NODE PROCESS produces the same views', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [holdOpen(0, 'h1'), holdOpen(1, 'h2')]);
  regenerate(treeRoot);
  const inProcess = VIEW_NAMES.map((name) => withoutTimestamps(readView(treeRoot, name)));

  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'views-replay-'));
  const scriptPath = path.join(scriptDir, 'replay.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const { regenerate } = require(${JSON.stringify(MODULE_PATH)});\n` +
      `process.stdout.write(JSON.stringify(regenerate(${JSON.stringify(treeRoot)}).views.map((v) => v.name)));\n`
  );
  const names = JSON.parse(execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' }));

  assert.deepEqual(names.sort(), [...VIEW_NAMES].sort());
  assert.deepEqual(
    VIEW_NAMES.map((name) => withoutTimestamps(readView(treeRoot, name))),
    inProcess
  );
});

test('regenerate refuses a tree it cannot read a stream from, rather than writing a comforting view', () => {
  const treeRoot = makeTree();
  fs.writeFileSync(path.join(treeRoot, 'ledger.jsonl'), '{"schema_version":1,"seq":0,"kind":"hold-open"}\n{oops\n');

  assert.throws(() => regenerate(treeRoot), /friction:|views:/);
  // Nothing half-written: a view that says "no open holds" because the stream
  // failed to parse is worse than no view at all.
  assert.equal(fs.existsSync(path.join(treeRoot, 'views')), false);
});

test('regenerate requires a tree root', () => {
  assert.throws(() => regenerate(''), /treeRoot/);
});
