'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadTable, boundFor, withBound, TASK_CLASSES } = require('../src/timeouts.js');

const TABLE_PATH = path.join(__dirname, '..', 'timeout-table.json');

// The floors the operator ruled: generous, no premature kills, 30+ minutes
// where the class warrants it. A bound may exceed its floor; none may fall
// under one.
const FLOORS_MS = Object.freeze({
  mechanical_step: 5 * 60 * 1000,
  research_read: 15 * 60 * 1000,
  review: 30 * 60 * 1000,
  chunk_implementation: 45 * 60 * 1000,
  mind_consult: 15 * 60 * 1000,
  codex_dispatch: 30 * 60 * 1000,
});

// Headroom for a real scheduler under a loaded test runner. Wide enough that
// ordinary timer jitter never fails the suite, narrow enough that an enforcer
// firing at twice its bound does.
const SCHEDULER_TOLERANCE_MS = 150;

// Slack on the EARLY side, and it is not the same thing as the tolerance above.
// libuv caches its loop time once per iteration and truncates it to whole
// milliseconds, so a timer armed for 250ms can legitimately fire when the
// wallclock reads 249 — the timer is not early against the loop's own clock,
// only against ours. This is not measurement error on `Date.now()`: `hrtime`
// would observe the same early fire, because the timer really did run then.
// Under load it shows up in a few percent of runs, always by exactly 1ms.
//
// 10ms, and no wider. The margin to absorb is a single millisecond; an enforcer
// with a real defect — one aborting at any meaningful fraction of its bound —
// still fails this assertion by a wide factor. Widening it toward
// SCHEDULER_TOLERANCE_MS would let an enforcer that fired at 100ms pass as
// "on time", which is the exact defect this test exists to catch.
const TIMER_EARLY_SLACK_MS = 10;

function writeTable(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeouts-test-'));
  const file = path.join(dir, 'timeout-table.json');
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  return file;
}

function validTable(overrides = {}) {
  return {
    schema_version: 1,
    classes: { ...FLOORS_MS },
    notes: 'a note',
    ...overrides,
  };
}

// ---------- the table ----------

test('the shipped table names exactly the six task classes', () => {
  const table = loadTable(TABLE_PATH);

  assert.deepEqual(Object.keys(table.classes).sort(), Object.keys(FLOORS_MS).sort());
  assert.deepEqual([...TASK_CLASSES].sort(), Object.keys(FLOORS_MS).sort());
});

test('every shipped bound meets its floor', () => {
  const table = loadTable(TABLE_PATH);

  for (const [taskClass, floor] of Object.entries(FLOORS_MS)) {
    assert.ok(
      table.classes[taskClass] >= floor,
      `${taskClass} is ${table.classes[taskClass]}ms, under its ${floor}ms floor`
    );
  }
});

test('the table carries the codex kill-sweep finding forward to whoever builds the dispatch wrapper', () => {
  const table = loadTable(TABLE_PATH);

  // This note is the only place an S0 finding survives into the slice that
  // needs it. A table that lost it would still load, still pass every bound
  // check, and quietly cost the next implementer the same discovery.
  assert.match(table.notes, /session id/i);
  assert.match(table.notes, /pgid/i);
});

test('loadTable fails closed on a table it cannot trust, and never falls back to defaults', () => {
  for (const [label, contents] of [
    ['not an object', '[]'],
    // A bare null parses fine and is the one shape that reaches a property
    // read before any other check can refuse it — without its own guard the
    // refusal is a raw TypeError instead of this module's own words.
    ['a bare null', 'null'],
    ['unparseable', '{not json'],
    ['wrong schema_version', validTable({ schema_version: 2 })],
    ['no classes', { schema_version: 1, notes: 'x' }],
    ['classes not an object', validTable({ classes: [] })],
    ['a class missing', validTable({ classes: { mechanical_step: 300000 } })],
    ['an extra class', validTable({ classes: { ...FLOORS_MS, invented_class: 1000 } })],
    ['a non-integer bound', validTable({ classes: { ...FLOORS_MS, review: 1800000.5 } })],
    ['a zero bound', validTable({ classes: { ...FLOORS_MS, review: 0 } })],
    ['a negative bound', validTable({ classes: { ...FLOORS_MS, review: -1 } })],
    ['a bound under its floor', validTable({ classes: { ...FLOORS_MS, review: 60000 } })],
    ['no notes', validTable({ notes: undefined })],
  ]) {
    assert.throws(() => loadTable(writeTable(contents)), /timeouts:/, `${label} should have been refused`);
  }
});

test('loadTable refuses a table that is not there rather than inventing one', () => {
  assert.throws(() => loadTable(path.join(os.tmpdir(), 'no-such-timeout-table.json')), /timeouts:/);
});

// ---------- boundFor ----------

test('boundFor returns the shipped bound for each class', () => {
  const table = loadTable(TABLE_PATH);

  for (const taskClass of TASK_CLASSES) {
    assert.equal(boundFor(taskClass), table.classes[taskClass]);
  }
});

test('boundFor refuses a class the table does not name', () => {
  assert.throws(() => boundFor('deploy'), /no task class "deploy"/);
  assert.throws(() => boundFor(''), /no task class/);
  assert.throws(() => boundFor(undefined), /no task class/);
  // A prototype key is not a task class.
  assert.throws(() => boundFor('toString'), /no task class "toString"/);
});

// ---------- withBound ----------

test('withBound returns the work\'s own value when it finishes inside its bound, un-interrupted', async () => {
  const started = Date.now();
  let signal = null;

  const result = await withBound(
    'review',
    async (ctx) => {
      signal = ctx.signal;
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Work that was signalled to stop must not report success as though it
      // had finished on its own.
      assert.equal(ctx.signal.aborted, false, 'the work was aborted while it was still running');
      return { done: 'the work' };
    },
    { boundMs: 400 }
  );

  assert.deepEqual(result, { done: 'the work' });
  // The value winning the race is not the same fact as the work never being
  // interrupted: an enforcer that aborts early and then lets the callback
  // resolve anyway would satisfy the first and violate the second.
  assert.equal(signal.aborted, false, 'the signal was aborted despite the work finishing in time');
  assert.ok(Date.now() - started < 400);
});

test('withBound does not interrupt work that finishes just under its bound', async () => {
  let signal = null;

  const result = await withBound(
    'review',
    async (ctx) => {
      signal = ctx.signal;
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(ctx.signal.aborted, false, 'the work was aborted while it was still running');
      return 'finished';
    },
    { boundMs: 300 }
  );

  assert.equal(result, 'finished');
  assert.equal(signal.aborted, false, 'the signal was aborted despite the work finishing in time');
});

test('withBound interrupts at the bound and not before, with a named error carrying class and bound', async () => {
  const started = Date.now();
  let interruptedAt = null;

  await assert.rejects(
    withBound(
      'codex_dispatch',
      () => new Promise((resolve) => setTimeout(() => resolve('too late'), 5000)),
      { boundMs: 250 }
    ),
    (err) => {
      interruptedAt = Date.now();
      assert.equal(err.code, 'ETIMEOUT');
      assert.equal(err.task_class, 'codex_dispatch');
      assert.equal(err.bound_ms, 250);
      assert.match(err.message, /codex_dispatch/);
      assert.match(err.message, /250/);
      return true;
    }
  );

  // Not before the bound — the whole point of the operator's ruling...
  const elapsed = interruptedAt - started;
  assert.ok(
    elapsed >= 250 - TIMER_EARLY_SLACK_MS,
    `interrupted after ${elapsed}ms, before its 250ms bound (early slack ${TIMER_EARLY_SLACK_MS}ms)`
  );
  // ...and AT the bound, not merely somewhere after it. "Never early" alone is
  // satisfied by an enforcer that fires at twice the bound, or never — which
  // would be a hang wearing a timeout's clothes.
  assert.ok(
    elapsed <= 250 + SCHEDULER_TOLERANCE_MS,
    `interrupted after ${elapsed}ms, well past its 250ms bound (tolerance ${SCHEDULER_TOLERANCE_MS}ms)`
  );
});

test('withBound hands the work a signal it can watch, and aborts it at the bound', async () => {
  let signal = null;

  await assert.rejects(
    withBound(
      'mechanical_step',
      (ctx) =>
        new Promise((resolve) => {
          signal = ctx.signal;
          setTimeout(() => resolve('too late'), 5000);
        }),
      { boundMs: 150 }
    ),
    (err) => err.code === 'ETIMEOUT'
  );

  // Work that can stop — a child process, a fetch — is told to. Work that
  // cannot is at least no longer awaited.
  assert.ok(signal !== null, 'the work was never handed a signal');
  assert.equal(signal.aborted, true);
});

test('withBound surfaces the work\'s own failure unchanged', async () => {
  await assert.rejects(
    withBound('review', async () => {
      throw new Error('the work itself failed');
    }, { boundMs: 400 }),
    (err) => err.message === 'the work itself failed' && err.code === undefined
  );
});

test('an injected bound changes the SCALE only — never which class was named', async () => {
  // The injection exists so a bound can be exercised at test scale. It is not
  // a way to run under a class the table does not define.
  await assert.rejects(
    () => withBound('invented_class', async () => 'x', { boundMs: 10 }),
    /no task class "invented_class"/
  );

  // And a named class with no injection uses the table's own bound.
  const bound = boundFor('mechanical_step');
  assert.ok(bound >= FLOORS_MS.mechanical_step);
});

test('withBound refuses work that is not callable', async () => {
  await assert.rejects(() => withBound('review', 'not a function', { boundMs: 10 }), /requires work that is a function/);
});

test('withBound does not hold the event loop open after the work finishes', async () => {
  // A timer left armed after a fast task keeps a process alive for the whole
  // bound — for `chunk_implementation` that is forty-five minutes of a CLI
  // that looks hung. Proved by running one in a real process and timing it.
  const { execFileSync } = require('node:child_process');
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeouts-exit-'));
  const scriptPath = path.join(scriptDir, 'exit.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const { withBound } = require(${JSON.stringify(path.resolve(__dirname, '..', 'src', 'timeouts.js'))});\n` +
      `withBound('chunk_implementation', async () => 'quick').then((v) => process.stdout.write(v));\n`
  );

  const started = Date.now();
  const out = execFileSync(process.execPath, [scriptPath], { encoding: 'utf8', timeout: 10000 });

  assert.equal(out, 'quick');
  assert.ok(Date.now() - started < 10000, 'the process outlived its work');
});
