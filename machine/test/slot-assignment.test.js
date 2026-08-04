'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { assignPlanSlot, firstHexByte } = require('../src/slot-assignment.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'slot-assignment.js');

function digestWithFirstByte(byteHex, rest) {
  return `sha256:${byteHex}${rest}`;
}

const REST_62 = '0'.repeat(62);

test('firstHexByte extracts the first byte (two hex chars) as an integer', () => {
  assert.equal(firstHexByte(digestWithFirstByte('00', REST_62)), 0);
  assert.equal(firstHexByte(digestWithFirstByte('ff', REST_62)), 255);
  assert.equal(firstHexByte(digestWithFirstByte('a3', REST_62)), 0xa3);
});

test('firstHexByte throws on a malformed digest', () => {
  assert.throws(() => firstHexByte('not-a-digest'), TypeError);
  assert.throws(() => firstHexByte('sha256:tooshort'), TypeError);
  assert.throws(() => firstHexByte(42), TypeError);
});

test('assignPlanSlot picks the candidate with an EVEN first hex byte as plan-A', () => {
  const candidates = [
    { id: 'claude-side', manifestDigest: digestWithFirstByte('a3', REST_62) }, // 0xa3 = 163, odd
    { id: 'sol-side', manifestDigest: digestWithFirstByte('04', REST_62) }, // 0x04 = 4, even
  ];
  const { planA, planB } = assignPlanSlot(candidates);
  assert.equal(planA, 'sol-side');
  assert.equal(planB, 'claude-side');
});

test('assignPlanSlot is symmetric: swapping input order swaps nothing about the outcome', () => {
  const a = { id: 'claude-side', manifestDigest: digestWithFirstByte('a3', REST_62) };
  const b = { id: 'sol-side', manifestDigest: digestWithFirstByte('04', REST_62) };
  const result1 = assignPlanSlot([a, b]);
  const result2 = assignPlanSlot([b, a]);
  assert.deepEqual(result1, result2);
});

test('assignPlanSlot breaks a same-parity tie by lexicographically smaller digest -> plan-A', () => {
  const candidates = [
    { id: 'first', manifestDigest: digestWithFirstByte('04', 'f'.repeat(62)) }, // even, larger tail
    { id: 'second', manifestDigest: digestWithFirstByte('04', '0'.repeat(62)) }, // even, smaller tail
  ];
  const { planA, planB } = assignPlanSlot(candidates);
  assert.equal(planA, 'second');
  assert.equal(planB, 'first');
});

test('assignPlanSlot is deterministic and replayable: same inputs always produce the same output', () => {
  const candidates = [
    { id: 'x', manifestDigest: digestWithFirstByte('37', REST_62) },
    { id: 'y', manifestDigest: digestWithFirstByte('9c', REST_62) },
  ];
  const runs = new Set([JSON.stringify(assignPlanSlot(candidates)), JSON.stringify(assignPlanSlot(candidates)), JSON.stringify(assignPlanSlot([...candidates]))]);
  assert.equal(runs.size, 1);
});

test('assignPlanSlot throws on anything other than exactly two candidates', () => {
  assert.throws(() => assignPlanSlot([]), TypeError);
  assert.throws(() => assignPlanSlot([{ id: 'a', manifestDigest: digestWithFirstByte('00', REST_62) }]), TypeError);
  assert.throws(
    () =>
      assignPlanSlot([
        { id: 'a', manifestDigest: digestWithFirstByte('00', REST_62) },
        { id: 'b', manifestDigest: digestWithFirstByte('01', REST_62) },
        { id: 'c', manifestDigest: digestWithFirstByte('02', REST_62) },
      ]),
    TypeError
  );
});

test('assignPlanSlot throws when the two candidates share the same id', () => {
  assert.throws(
    () =>
      assignPlanSlot([
        { id: 'dup', manifestDigest: digestWithFirstByte('00', REST_62) },
        { id: 'dup', manifestDigest: digestWithFirstByte('01', REST_62) },
      ]),
    TypeError
  );
});

test('assignPlanSlot throws on a malformed candidate entry', () => {
  assert.throws(() => assignPlanSlot([null, { id: 'b', manifestDigest: digestWithFirstByte('00', REST_62) }]), TypeError);
  assert.throws(() => assignPlanSlot([{ id: '' }, { id: 'b', manifestDigest: digestWithFirstByte('00', REST_62) }]), TypeError);
});

// ---------- CLI: assign (P11 convergence finding 4) ----------

test('CLI: assign prints {planA, planB} matching the library call', () => {
  const candidates = [
    { id: 'claude-side', manifestDigest: digestWithFirstByte('a3', REST_62) },
    { id: 'sol-side', manifestDigest: digestWithFirstByte('04', REST_62) },
  ];
  const proc = spawnSync(process.execPath, [CLI_PATH, 'assign'], { encoding: 'utf8', input: JSON.stringify(candidates) });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), assignPlanSlot(candidates));
});

test('CLI: assign exits 1 on a malformed candidates array', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'assign'], {
    encoding: 'utf8',
    input: JSON.stringify([{ id: 'only-one' }]),
  });
  assert.equal(proc.status, 1);
});

test('CLI: assign exits 1 on invalid JSON via stdin', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'assign'], { encoding: 'utf8', input: 'not json' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^slot-assignment\.js: /);
});

test('CLI: unknown command prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'bogus'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: slot-assignment\.js assign/);
});

test('CLI: a surplus positional argument is refused (P11 Sol review finding 13)', () => {
  const candidates = [
    { id: 'claude-side', manifestDigest: digestWithFirstByte('a3', REST_62) },
    { id: 'sol-side', manifestDigest: digestWithFirstByte('04', REST_62) },
  ];
  const proc = spawnSync(process.execPath, [CLI_PATH, 'assign', 'extra'], {
    encoding: 'utf8',
    input: JSON.stringify(candidates),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /unexpected extra argument/);
});
