'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { rates, listOpenHolds, chunkCountsFor } = require('../src/friction.js');

function makeTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'friction-test-'));
  const treeRoot = path.join(tmp, '.thelastskill');
  fs.mkdirSync(treeRoot, { recursive: true });
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

function writeStream(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
}

function writeLedger(treeRoot, records) {
  writeStream(path.join(treeRoot, 'ledger.jsonl'), records);
}

function writeMilestone(treeRoot, milestoneId, records, status = 'open') {
  writeStream(path.join(treeRoot, 'milestones', milestoneId, 'chunks.jsonl'), records);
  const indexPath = path.join(treeRoot, 'milestones', 'index.json');
  const index = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    : { schema_version: 1, milestones: [] };
  index.milestones.push({ id: milestoneId, title: milestoneId, designer_family: 'claude', status });
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function reviewRecord(seq, chunkId, verdict) {
  return record(seq, 'chunk-review', {
    chunk_id: chunkId,
    review: { family: 'gpt', verdict, ref: `envelopes/implementation/${chunkId}-review.json` },
  });
}

function consultRecord(seq, chunkId, consultId) {
  return record(seq, 'chunk-consult', {
    chunk_id: chunkId,
    consult_id: consultId,
    asker: 'implementer',
    question: 'which anchor governs?',
    verdict: 'use the sealed one',
    anchor: 'spec.md:12',
  });
}

// ---------- an empty tree ----------

test('rates on a tree with no streams yet are all zero, and say so rather than dividing by nothing', () => {
  const treeRoot = makeTree();

  const result = rates(treeRoot);

  assert.equal(result.reviews.total, 0);
  assert.equal(result.reviews.revise_share, 0);
  assert.equal(result.consults.total, 0);
  assert.equal(result.consults.per_chunk, 0);
  assert.equal(result.dispatches.terminals, 0);
  assert.equal(result.dispatches.failure_share, 0);
  assert.equal(result.dispatches.timeout_share, 0);
  assert.deepEqual(result.holds, { opened: 0, resolved: 0, open: 0 });
  assert.deepEqual(listOpenHolds(treeRoot), []);
});

// ---------- review verdict share ----------

test('the revise share is computed over chunk-review records across every milestone', () => {
  const treeRoot = makeTree();
  // M1: three reviews, two revise. M2: one review, approve. Four total, two
  // revise — a share of exactly 0.5, hand-computed.
  writeMilestone(treeRoot, 'M1', [
    reviewRecord(0, 'C1', 'revise'),
    reviewRecord(1, 'C1', 'approve'),
    reviewRecord(2, 'C2', 'revise'),
  ]);
  writeMilestone(treeRoot, 'M2', [reviewRecord(0, 'C1', 'approve')], 'green');

  const result = rates(treeRoot);

  assert.equal(result.reviews.total, 4);
  assert.equal(result.reviews.approve, 2);
  assert.equal(result.reviews.revise, 2);
  assert.equal(result.reviews.revise_share, 0.5);
});

test('consult frequency counts consults against the chunks that were worked, not the reviews', () => {
  const treeRoot = makeTree();
  // Two distinct chunks seen; three consults, on one of them.
  writeMilestone(treeRoot, 'M1', [
    record(0, 'chunk-spec', { chunk_id: 'C1', brief_ref: 'M1/spec.md#C1' }),
    record(1, 'chunk-spec', { chunk_id: 'C2', brief_ref: 'M1/spec.md#C2' }),
    consultRecord(2, 'C1', 'q1'),
    consultRecord(3, 'C1', 'q2'),
    consultRecord(4, 'C1', 'q3'),
  ]);

  const result = rates(treeRoot);

  assert.equal(result.consults.total, 3);
  assert.equal(result.consults.chunks_consulted, 1);
  assert.equal(result.consults.chunks_seen, 2);
  assert.equal(result.consults.per_chunk, 1.5);
});

// ---------- dispatch outcomes ----------

test('dispatch failure and timeout shares come from C1 terminals, counted over terminals', () => {
  const treeRoot = makeTree();
  // Four terminals: one ok, three failed, two of those for timeout.
  writeLedger(treeRoot, [
    record(0, 'dispatch', { dispatch_id: 'd1' }),
    record(1, 'dispatch-terminal', { dispatch_id: 'd1', status: 'ok', builder: 'sol' }),
    record(2, 'dispatch', { dispatch_id: 'd2' }),
    record(3, 'dispatch-terminal', { dispatch_id: 'd2', status: 'failed', reason: 'timeout', builder: null }),
    record(4, 'dispatch', { dispatch_id: 'd3' }),
    record(5, 'dispatch-terminal', { dispatch_id: 'd3', status: 'failed', reason: 'timeout', builder: null }),
    record(6, 'dispatch', { dispatch_id: 'd4' }),
    record(7, 'dispatch-terminal', { dispatch_id: 'd4', status: 'failed', reason: 'error', builder: null }),
  ]);

  const result = rates(treeRoot);

  assert.equal(result.dispatches.dispatched, 4);
  assert.equal(result.dispatches.terminals, 4);
  assert.equal(result.dispatches.failed, 3);
  assert.equal(result.dispatches.timeout, 2);
  assert.equal(result.dispatches.failure_share, 0.75);
  assert.equal(result.dispatches.timeout_share, 0.5);
});

test('a dispatch with no terminal is pending, and never counted as a success', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    record(0, 'dispatch', { dispatch_id: 'd1' }),
    record(1, 'dispatch-terminal', { dispatch_id: 'd1', status: 'ok', builder: 'sol' }),
    record(2, 'dispatch', { dispatch_id: 'd2' }),
  ]);

  const result = rates(treeRoot);

  assert.equal(result.dispatches.dispatched, 2);
  assert.equal(result.dispatches.terminals, 1);
  assert.equal(result.dispatches.pending, 1);
  // The share is over what actually finished; a pending dispatch is not a
  // success and must not dilute the failure rate into looking better.
  assert.equal(result.dispatches.failure_share, 0);
});

// ---------- holds ----------

test('the open-hold set is exactly opened minus resolved', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    record(0, 'hold-open', { hold_id: 'h1', severity: 'S2', summary: 'first', origin_ref: 'ledger:0' }),
    record(1, 'hold-open', { hold_id: 'h2', severity: 'S3', summary: 'second', origin_ref: 'ledger:0' }),
    record(2, 'hold-resolve', { hold_id: 'h1', exit: 'resolved', resolution_ref: 'ledger:0' }),
    record(3, 'hold-open', { hold_id: 'h3', severity: 'S2', summary: 'third', origin_ref: 'ledger:0' }),
    record(4, 'hold-resolve', { hold_id: 'h3', exit: 'delivered', resolution_ref: 'ledger:0' }),
  ]);

  const result = rates(treeRoot);
  const open = listOpenHolds(treeRoot);

  assert.deepEqual(result.holds, { opened: 3, resolved: 2, open: 1 });
  assert.deepEqual(
    open.map((hold) => hold.hold_id),
    ['h2']
  );
  assert.equal(open[0].summary, 'second');
  assert.equal(open[0].severity, 'S3');
});

test('a hold resolved by delivery is closed exactly as one resolved by repair', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    record(0, 'hold-open', { hold_id: 'h1', severity: 'S2', summary: 'only', origin_ref: 'ledger:0' }),
    record(1, 'hold-resolve', { hold_id: 'h1', exit: 'delivered', resolution_ref: 'ledger:0' }),
  ]);

  assert.deepEqual(listOpenHolds(treeRoot), []);
  assert.equal(rates(treeRoot).holds.open, 0);
});

test('open holds come back in the order they were opened', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    record(0, 'hold-open', { hold_id: 'h1', severity: 'S2', summary: 'a', origin_ref: 'ledger:0' }),
    record(1, 'hold-open', { hold_id: 'h2', severity: 'S2', summary: 'b', origin_ref: 'ledger:0' }),
    record(2, 'hold-open', { hold_id: 'h3', severity: 'S3', summary: 'c', origin_ref: 'ledger:0' }),
  ]);

  assert.deepEqual(
    listOpenHolds(treeRoot).map((hold) => hold.hold_id),
    ['h1', 'h2', 'h3']
  );
});

// ---------- honesty about damaged streams ----------

test('friction refuses a stream it cannot fully read rather than reporting a rate from part of it', () => {
  const treeRoot = makeTree();
  fs.writeFileSync(path.join(treeRoot, 'ledger.jsonl'), '{"schema_version":1,"seq":0,"kind":"dispatch"}\n{oops\n');

  // A rate derived from the half of a stream that happened to parse is a
  // number nobody can act on, and it looks exactly like a real one.
  assert.throws(() => rates(treeRoot), /friction:/);
  assert.throws(() => listOpenHolds(treeRoot), /friction:/);
});

test('friction refuses a stream whose records break the common header, even though each line parses', () => {
  const treeRoot = makeTree();
  // Valid JSON on every line, so nothing here is a parse error — what is
  // wrong is that these are not records: no ts, no correlation_id. A stream
  // of well-formed lines that are not records is still a stream this module
  // cannot rate.
  fs.writeFileSync(
    path.join(treeRoot, 'ledger.jsonl'),
    '{"schema_version":1,"seq":0,"kind":"hold-open","hold_id":"h1"}\n'
  );

  assert.throws(() => rates(treeRoot), /violating the common JSONL header/);
  assert.throws(() => listOpenHolds(treeRoot), /violating the common JSONL header/);
});

test('friction skips an index entry that names no milestone, and still reads the ones that do', () => {
  const treeRoot = makeTree();
  writeMilestone(treeRoot, 'M1', [reviewRecord(0, 'C1', 'revise')]);
  // A damaged index entry is not a reason to refuse the whole tree — the
  // other milestones are still on disk and still countable.
  const indexPath = path.join(treeRoot, 'milestones', 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.milestones.push(null, { title: 'no id at all' }, { id: '' });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  assert.equal(rates(treeRoot).reviews.total, 1);
  assert.equal(rates(treeRoot).reviews.revise, 1);
});

test('friction refuses a chunk stream it cannot fully read', () => {
  const treeRoot = makeTree();
  writeMilestone(treeRoot, 'M1', [reviewRecord(0, 'C1', 'approve')]);
  fs.appendFileSync(path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl'), '{not json\n');

  assert.throws(() => rates(treeRoot), /friction:/);
});

test('friction reads only the milestones the index names', () => {
  const treeRoot = makeTree();
  writeMilestone(treeRoot, 'M1', [reviewRecord(0, 'C1', 'revise')]);
  // A directory the index does not list is not part of the record: the index
  // is what says which milestones exist.
  writeStream(path.join(treeRoot, 'milestones', 'M-stray', 'chunks.jsonl'), [
    reviewRecord(0, 'C9', 'revise'),
    reviewRecord(1, 'C9', 'revise'),
  ]);

  assert.equal(rates(treeRoot).reviews.total, 1);
});

test('rates require a tree root', () => {
  assert.throws(() => rates(''), /treeRoot/);
  assert.throws(() => listOpenHolds(undefined), /treeRoot/);
});

// ---------- the scoped-identity law ----------

test('a chunk id is scoped to its MILESTONE — the same id in two milestones is two chunks', () => {
  const treeRoot = makeTree();
  // Chunk ids are milestone-local: every milestone starts again at C1. Keyed
  // by chunk_id alone, M1/C1 and M2/C1 collapse into one chunk and every rate
  // computed over them is wrong by exactly the collision count.
  writeMilestone(treeRoot, 'M1', [
    record(0, 'chunk-spec', { chunk_id: 'C1', brief_ref: 'M1/spec.md#C1' }),
    consultRecord(1, 'C1', 'q1'),
  ]);
  writeMilestone(treeRoot, 'M2', [record(0, 'chunk-spec', { chunk_id: 'C1', brief_ref: 'M2/spec.md#C1' })]);

  const result = rates(treeRoot);

  assert.equal(result.consults.chunks_seen, 2);
  assert.equal(result.consults.chunks_consulted, 1);
  assert.equal(result.consults.per_chunk, 0.5);
});

test('two milestones reviewing their own C1 are counted as two chunks, not one', () => {
  const treeRoot = makeTree();
  writeMilestone(treeRoot, 'M1', [reviewRecord(0, 'C1', 'revise'), reviewRecord(1, 'C1', 'approve')]);
  writeMilestone(treeRoot, 'M2', [reviewRecord(0, 'C1', 'approve')]);

  const perChunk = rates(treeRoot).per_key.chunks;

  assert.deepEqual(
    perChunk.map((entry) => entry.key).sort(),
    ['M1/C1', 'M2/C1']
  );
  const m1 = perChunk.find((entry) => entry.key === 'M1/C1');
  assert.equal(m1.milestone, 'M1');
  assert.equal(m1.chunk, 'C1');
  assert.equal(m1.reviews, 2);
  assert.equal(m1.revise, 1);
});

// ---------- per-key breakdown ----------

test('rates say WHICH chunk produced the friction, not only how much there was', () => {
  const treeRoot = makeTree();
  writeMilestone(treeRoot, 'M1', [
    record(0, 'chunk-spec', { chunk_id: 'C1', brief_ref: 'M1/spec.md#C1' }),
    reviewRecord(1, 'C1', 'revise'),
    reviewRecord(2, 'C1', 'revise'),
    reviewRecord(3, 'C1', 'approve'),
    consultRecord(4, 'C1', 'q1'),
    record(5, 'chunk-spec', { chunk_id: 'C2', brief_ref: 'M1/spec.md#C2' }),
    reviewRecord(6, 'C2', 'approve'),
  ]);

  const perChunk = rates(treeRoot).per_key.chunks;

  const c1 = perChunk.find((entry) => entry.key === 'M1/C1');
  assert.deepEqual(c1, {
    key: 'M1/C1',
    milestone: 'M1',
    chunk: 'C1',
    reviews: 3,
    approve: 1,
    revise: 2,
    consults: 1,
  });
  const c2 = perChunk.find((entry) => entry.key === 'M1/C2');
  assert.equal(c2.reviews, 1);
  assert.equal(c2.revise, 0);
  assert.equal(c2.consults, 0);
});

test('rates say WHICH seat and WHICH transport the dispatch failures came from', () => {
  const treeRoot = makeTree();
  writeLedger(treeRoot, [
    record(0, 'dispatch', { dispatch_id: 'd1', seat: 'implementer', transport: 'codex' }),
    record(1, 'dispatch-terminal', { dispatch_id: 'd1', status: 'failed', reason: 'timeout', builder: null }),
    record(2, 'dispatch', { dispatch_id: 'd2', seat: 'implementer', transport: 'codex' }),
    record(3, 'dispatch-terminal', { dispatch_id: 'd2', status: 'ok', builder: 'sol' }),
    record(4, 'dispatch', { dispatch_id: 'd3', seat: 'reviewer', transport: 'native' }),
    record(5, 'dispatch-terminal', { dispatch_id: 'd3', status: 'failed', reason: 'error', builder: null }),
  ]);

  const perKey = rates(treeRoot).per_key;

  const implementer = perKey.seats.find((entry) => entry.key === 'implementer');
  assert.deepEqual(implementer, { key: 'implementer', dispatched: 2, terminals: 2, failed: 1, timeout: 1 });
  const reviewer = perKey.seats.find((entry) => entry.key === 'reviewer');
  assert.deepEqual(reviewer, { key: 'reviewer', dispatched: 1, terminals: 1, failed: 1, timeout: 0 });

  const codex = perKey.transports.find((entry) => entry.key === 'codex');
  assert.deepEqual(codex, { key: 'codex', dispatched: 2, terminals: 2, failed: 1, timeout: 1 });
});

// ---------- per-milestone chunk counts ----------

test('chunkCountsFor reports distinct chunks recorded and green, exactly as the wake position does', () => {
  const treeRoot = makeTree();
  writeMilestone(treeRoot, 'M1', [
    record(0, 'chunk-spec', { chunk_id: 'C1', brief_ref: 'M1/spec.md#C1' }),
    reviewRecord(1, 'C1', 'approve'),
    record(2, 'chunk-green', {
      chunk_id: 'C1',
      commit: 'abc1234',
      diff_digest: `sha256:${'a'.repeat(64)}`,
      review: { family: 'gpt', verdict: 'approve', ref: 'r' },
    }),
    record(3, 'chunk-spec', { chunk_id: 'C2', brief_ref: 'M1/spec.md#C2' }),
  ]);

  assert.deepEqual(chunkCountsFor(treeRoot, 'M1'), { recorded: 2, green: 1 });
  assert.deepEqual(chunkCountsFor(treeRoot, 'M-absent'), { recorded: 0, green: 0 });
});

test('a chunk record with no chunk_id is not a chunk, and never becomes a phantom key', () => {
  const treeRoot = makeTree();
  writeMilestone(treeRoot, 'M1', [
    record(0, 'chunk-spec', { chunk_id: 'C1', brief_ref: 'M1/spec.md#C1' }),
    // A record on the chunk stream carrying no chunk_id — a malformed or
    // future kind. Counting it would invent a chunk that does not exist and
    // move every rate computed over the chunk count.
    record(1, 'chunk-journeys', { journeys: ['j1'] }),
  ]);

  const result = rates(treeRoot);

  assert.equal(result.consults.chunks_seen, 1);
  assert.deepEqual(
    result.per_key.chunks.map((entry) => entry.key),
    ['M1/C1']
  );
  assert.deepEqual(chunkCountsFor(treeRoot, 'M1'), { recorded: 1, green: 0 });
});
