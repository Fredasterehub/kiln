'use strict';

// timeouts.js — how long a class of work is allowed to take, and the enforcer
// that holds it to that.
//
// There was no timeout configuration anywhere in this machine before now: the
// only wallclock numbers on disk were a shell `timeout 30` wrapped around one
// preflight probe and the lockfile constants in jsonl.js. `machine/timeout-table.json`
// is the one home for the real ones, and this module is the only way to read
// it. No per-seat timeout prose anywhere else — a bound that appears in a
// second place is a bound that will disagree with this one eventually.
//
// THE BOUNDS ARE GENEROUS ON PURPOSE. The operator's ruling is that work is
// never killed for taking a long time, only for hanging: a reviewer reading
// carefully for twenty-five minutes is doing its job, and a wrapper that cuts
// it off at ten has destroyed real work to enforce an invented deadline. So
// `withBound` interrupts at exactly the class bound and NEVER earlier, and
// that is the property its tests are built around.
//
// WHAT THIS MODULE DOES NOT DO: it does not know what a process is. `withBound`
// is a generic wallclock enforcer over a promise, and it hands the work an
// AbortSignal so work that CAN stop is told to. Turning that signal into a
// dead codex process — the kill sweep by recorded session id, and the
// process-level no-premature-kill test that proves it — belongs to the
// dispatch-wrapper chunk in the next slice, not here. The table's `notes`
// field carries the finding that implementer needs.

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const DEFAULT_TABLE_PATH = path.join(__dirname, '..', 'timeout-table.json');

// The floors, kept here rather than in the table, because a table cannot
// vouch for itself: a bound edited down to nothing would still be internally
// consistent with a floor stored beside it. These are the operator's ruling
// expressed as code, and `loadTable` refuses any table that falls under them.
const FLOORS_MS = Object.freeze({
  mechanical_step: 5 * 60 * 1000,
  research_read: 15 * 60 * 1000,
  review: 30 * 60 * 1000,
  chunk_implementation: 45 * 60 * 1000,
  mind_consult: 15 * 60 * 1000,
  codex_dispatch: 30 * 60 * 1000,
});

const TASK_CLASSES = Object.freeze(Object.keys(FLOORS_MS));

const TIMEOUT_CODE = 'ETIMEOUT';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// loadTable(file) — the table, or a refusal. Never a default: a machine that
// silently invented its own bounds when the table was missing or damaged
// would be enforcing numbers nobody ruled on, and would look like it was
// working.
function loadTable(file = DEFAULT_TABLE_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`timeouts: cannot read the timeout table at ${file}: ${err.message}`);
  }

  let table;
  try {
    table = JSON.parse(raw);
  } catch (err) {
    throw new Error(`timeouts: the timeout table at ${file} is not JSON: ${err.message}`);
  }

  if (!isPlainObject(table)) {
    throw new Error(`timeouts: the timeout table at ${file} must be a JSON object`);
  }
  if (table.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `timeouts: the timeout table at ${file} declares schema_version ${JSON.stringify(table.schema_version)}, expected ${SCHEMA_VERSION}`
    );
  }
  if (!isPlainObject(table.classes)) {
    throw new Error(`timeouts: the timeout table at ${file} has no "classes" object`);
  }
  const declared = Object.keys(table.classes).sort();
  const expected = [...TASK_CLASSES].sort();
  if (declared.length !== expected.length || !declared.every((name, i) => name === expected[i])) {
    throw new Error(
      `timeouts: the timeout table at ${file} declares ${JSON.stringify(declared)}, not the task classes ${JSON.stringify(expected)}`
    );
  }
  for (const taskClass of TASK_CLASSES) {
    const bound = table.classes[taskClass];
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new Error(
        `timeouts: the bound for "${taskClass}" in ${file} is ${JSON.stringify(bound)}, which is not a positive whole number of milliseconds`
      );
    }
    if (bound < FLOORS_MS[taskClass]) {
      throw new Error(
        `timeouts: the bound for "${taskClass}" in ${file} is ${bound}ms, under its ${FLOORS_MS[taskClass]}ms floor — work is never killed for taking a long time, only for hanging`
      );
    }
  }
  if (typeof table.notes !== 'string' || table.notes.trim() === '') {
    throw new Error(`timeouts: the timeout table at ${file} carries no "notes"`);
  }

  return table;
}

// boundFor(taskClass) — how long that class of work may take, in ms.
function boundFor(taskClass) {
  if (typeof taskClass !== 'string' || !Object.prototype.hasOwnProperty.call(FLOORS_MS, taskClass)) {
    throw new Error(
      `timeouts: no task class ${JSON.stringify(taskClass)} — the classes are ${TASK_CLASSES.join(', ')}`
    );
  }
  return loadTable().classes[taskClass];
}

// withBound(taskClass, fn, opts) — run `fn` under its class's wallclock bound.
//
// `fn` is called with `{signal}` — an AbortSignal that fires if the bound is
// reached, so work that can stop is told to stop. Work that cannot stop is at
// least no longer awaited: this is a wallclock enforcer, not a way to kill
// something JavaScript has no handle on.
//
// Resolves with the work's own value when it finishes in time, and rejects
// with the work's own error when it fails on its own account — neither is
// reshaped. Only the timeout rejection is this module's, and it is named:
// `code: "ETIMEOUT"`, carrying the class and the bound it exceeded.
//
// `opts.boundMs` runs a class at a different SCALE, which is what makes the
// behavior testable in milliseconds rather than in forty-five minutes. It
// never changes which class was named: the class is resolved first, and an
// unknown one is refused whatever bound was injected with it.
//
// It is `async` deliberately, so that EVERY failure — an unknown class, work
// that is not callable, the work's own error, the timeout — arrives the same
// way, as a rejection. A function that returns a promise but throws some of
// its errors synchronously is one a caller can only handle correctly by
// knowing which are which.
async function withBound(taskClass, fn, opts = {}) {
  // Resolved first and unconditionally, so an unknown class is refused
  // whatever bound was injected alongside it.
  const classBound = boundFor(taskClass);
  const bound = Number.isInteger(opts.boundMs) && opts.boundMs > 0 ? opts.boundMs : classBound;
  if (typeof fn !== 'function') {
    throw new TypeError(`timeouts: withBound requires work that is a function (got ${typeof fn})`);
  }

  const controller = new AbortController();
  let timer = null;

  const bounded = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error(
        `timeouts: "${taskClass}" did not finish within its ${bound}ms bound and was interrupted`
      );
      err.code = TIMEOUT_CODE;
      err.task_class = taskClass;
      err.bound_ms = bound;
      reject(err);
    }, bound);
  });

  try {
    return await Promise.race([Promise.resolve().then(() => fn({ signal: controller.signal })), bounded]);
  } finally {
    // Cleared however this settles. Left armed, a fast task under a
    // forty-five minute bound would keep the process alive for the rest of it.
    clearTimeout(timer);
  }
}

module.exports = {
  loadTable,
  boundFor,
  withBound,
  TASK_CLASSES,
  FLOORS_MS,
  TIMEOUT_CODE,
};
