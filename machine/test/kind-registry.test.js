'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { STREAM_REGISTRY, appendToStream, readStreamRecords } = require('../src/kind-registry.js');
const { readRecords, appendRecord } = require('../src/stream.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'kind-registry.js');

function mkTmpTreeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kind-registry-test-'));
}

// ---------- appendToStream ----------

test('appendToStream rejects an unknown streamId', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(() => appendToStream(treeRoot, 'nonexistent-stream', { kind: 'idea', payload: {} }), /unknown streamId/);
});

test('appendToStream throws TypeError for a missing/empty treeRoot', () => {
  assert.throws(() => appendToStream('', 'vision-transcript', { kind: 'idea', payload: {} }), TypeError);
  assert.throws(() => appendToStream(undefined, 'vision-transcript', { kind: 'idea', payload: {} }), TypeError);
});

test('appendToStream throws TypeError for a non-object record', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(() => appendToStream(treeRoot, 'vision-transcript', 'not an object'), TypeError);
});

// Per-kind valid payloads (P11 Sol review pass-2 defect 7 — closes each
// kind's own payload contract; "decision"/"finding" carry no exact schema
// the charter pins, so a generic plain-object payload stays valid for
// those two).
const VISION_TRANSCRIPT_VALID_PAYLOADS = {
  idea: { text: 'x' },
  decision: { text: 'x' },
  pivot: { from: 'a', to: 'b' },
  finding: { text: 'x' },
  freshness: { turn: 1, checked: false },
  sealed: {},
};

for (const kind of ['idea', 'decision', 'pivot', 'finding', 'freshness', 'sealed']) {
  test(`appendToStream: vision-transcript accepts kind "${kind}"`, () => {
    const treeRoot = mkTmpTreeRoot();
    const seq = appendToStream(treeRoot, 'vision-transcript', { kind, payload: VISION_TRANSCRIPT_VALID_PAYLOADS[kind] });
    assert.equal(typeof seq, 'number');
    const { records } = readRecords(path.join(treeRoot, 'vision', 'transcript.jsonl'));
    assert.equal(records[0].kind, kind);
  });
}

test('appendToStream: vision-transcript rejects a kind outside its own set', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(
    () => appendToStream(treeRoot, 'vision-transcript', { kind: 'gate', payload: {} }),
    /does not accept kind "gate"/
  );
});

test('appendToStream: vision-decisions accepts only "decision"', () => {
  const treeRoot = mkTmpTreeRoot();
  const seq = appendToStream(treeRoot, 'vision-decisions', {
    kind: 'decision',
    payload: { statement: 'Use SQLite', rationale: 'simplicity', transcript_seq_refs: [3] },
  });
  assert.equal(typeof seq, 'number');
  assert.throws(() => appendToStream(treeRoot, 'vision-decisions', { kind: 'idea', payload: {} }), /does not accept kind "idea"/);
});

// agents/research-chief.md's own documented per-kind shapes (lines 76-81).
const RESEARCH_SCRATCHPAD_VALID_PAYLOADS = {
  decomposition: { mission: 'm', subtopics: [{ topic: 't', cache_status: 'missing', action: 'brief_issued' }] },
  brief_issued: { worker: 'research-worker-t', topic: 't', outcome: 'ok', anchors: ['research/t.md'] },
  envelope_consumed: { worker: 'research-worker-t', topic: 't', state: 'done', result: 'ok' },
  steer: { decision: 'resume', topic: 't', reason: 'follow-up' },
  synthesis: { topic: 't', index_entry: { topic: 't', path: 'research/t.md', date: '2026-07-28', sources: [] } },
};

test('appendToStream: research-scratchpad accepts its five kinds', () => {
  const treeRoot = mkTmpTreeRoot();
  for (const kind of ['decomposition', 'brief_issued', 'envelope_consumed', 'steer', 'synthesis']) {
    appendToStream(treeRoot, 'research-scratchpad', { kind, payload: RESEARCH_SCRATCHPAD_VALID_PAYLOADS[kind] });
  }
  const { records } = readRecords(path.join(treeRoot, 'research', 'scratchpad.jsonl'));
  assert.deepEqual(
    records.map((r) => r.kind),
    ['decomposition', 'brief_issued', 'envelope_consumed', 'steer', 'synthesis']
  );
});

test('appendToStream: research-scratchpad "synthesis" also accepts the alternate {summary_path} shape', () => {
  const treeRoot = mkTmpTreeRoot();
  const seq = appendToStream(treeRoot, 'research-scratchpad', { kind: 'synthesis', payload: { summary_path: 'research/summary.md' } });
  assert.equal(typeof seq, 'number');
});

// research-cache.js's recordGateCheck is the sole sanctioned writer of
// "freshness_gate" on this same file — this registry must never become a
// second writer for the identical fact (vision §14).
test('appendToStream: research-scratchpad refuses "freshness_gate" (research-cache.js\'s own recordGateCheck owns that kind exclusively)', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(
    () => appendToStream(treeRoot, 'research-scratchpad', { kind: 'freshness_gate', payload: {} }),
    /does not accept kind "freshness_gate"/
  );
});

test('appendToStream: onboarding-decision accepts only "decision", appends to ledger.jsonl', () => {
  const treeRoot = mkTmpTreeRoot();
  const seq = appendToStream(treeRoot, 'onboarding-decision', {
    kind: 'decision',
    payload: { event: 'settings_interview_completed', preset: 'balanced', telemetry_consent: false },
  });
  assert.equal(typeof seq, 'number');
  const { records } = readRecords(path.join(treeRoot, 'ledger.jsonl'));
  assert.equal(records[0].event, 'settings_interview_completed');
});

test('appendToStream: onboarding-decision refuses a non-"decision" kind (e.g. "gate")', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(
    () => appendToStream(treeRoot, 'onboarding-decision', { kind: 'gate', payload: {} }),
    /does not accept kind "gate"/
  );
});

// ---------- payload contract closure (P11 Sol review pass-2 defect 7) ----------

test('appendToStream: onboarding-decision refuses a forged event value even with a sanctioned kind (Sol\'s own probe)', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(
    () =>
      appendToStream(treeRoot, 'onboarding-decision', {
        kind: 'decision',
        payload: { event: 'wrong-event', preset: 'balanced', telemetry_consent: false },
      }),
    /must be exactly "settings_interview_completed"/
  );
  assert.equal(fs.existsSync(path.join(treeRoot, 'ledger.jsonl')), false);
});

test('appendToStream: onboarding-decision refuses an unexpected top-level record key (Sol\'s own probe)', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(
    () =>
      appendToStream(treeRoot, 'onboarding-decision', {
        kind: 'decision',
        payload: { event: 'settings_interview_completed', preset: 'balanced', telemetry_consent: false },
        correlation_id: null,
        unexpected: 'smuggled',
      }),
    /unexpected extra key/
  );
});

test('appendToStream: onboarding-decision refuses an unexpected payload key alongside a valid event', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(
    () =>
      appendToStream(treeRoot, 'onboarding-decision', {
        kind: 'decision',
        payload: { event: 'settings_interview_completed', preset: 'balanced', telemetry_consent: false, extra: 'x' },
      }),
    /payload must supply exactly these fields/
  );
});

test('appendToStream: rejects a non-scalar (object) correlation_id', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(
    () => appendToStream(treeRoot, 'vision-transcript', { kind: 'idea', payload: { text: 'x' }, correlation_id: { nope: true } }),
    TypeError
  );
});

test('appendToStream: vision-transcript "pivot" requires exactly {from, to}', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(() => appendToStream(treeRoot, 'vision-transcript', { kind: 'pivot', payload: { text: 'x' } }));
  assert.throws(() => appendToStream(treeRoot, 'vision-transcript', { kind: 'pivot', payload: { from: 'a', to: 'b', extra: 1 } }));
});

test('appendToStream: vision-transcript "freshness" requires source only when checked is true', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(() => appendToStream(treeRoot, 'vision-transcript', { kind: 'freshness', payload: { turn: 1, checked: true } }));
  assert.throws(() =>
    appendToStream(treeRoot, 'vision-transcript', { kind: 'freshness', payload: { turn: 1, checked: false, source: 'x' } })
  );
  const seq = appendToStream(treeRoot, 'vision-transcript', { kind: 'freshness', payload: { turn: 1, checked: true, source: 'web' } });
  assert.equal(typeof seq, 'number');
});

test('appendToStream: vision-decisions "decision" requires statement/rationale/transcript_seq_refs', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(() => appendToStream(treeRoot, 'vision-decisions', { kind: 'decision', payload: { statement: 'x' } }));
  assert.throws(() =>
    appendToStream(treeRoot, 'vision-decisions', {
      kind: 'decision',
      payload: { statement: 'x', rationale: 'y', transcript_seq_refs: [] },
    })
  );
});

test('appendToStream: research-scratchpad "decomposition" requires its documented subtopic shape', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(() =>
    appendToStream(treeRoot, 'research-scratchpad', {
      kind: 'decomposition',
      payload: { mission: 'm', subtopics: [{ topic: 't', cache_status: 'nope', action: 'brief_issued' }] },
    })
  );
});

// ---------- containment (P11 Sol review pass-2 defect 9) ----------

test('appendToStream refuses a symlinked stream parent directory escaping treeRoot (Sol\'s own probe)', () => {
  const treeRoot = mkTmpTreeRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-registry-outside-'));
  fs.symlinkSync(outsideDir, path.join(treeRoot, 'vision'));

  assert.throws(
    () => appendToStream(treeRoot, 'vision-transcript', { kind: 'idea', payload: { text: 'x' } }),
    /resolves outside treeRoot/
  );
  assert.equal(fs.existsSync(path.join(outsideDir, 'transcript.jsonl')), false);
});

// ---------- readStreamRecords ----------

test('readStreamRecords rejects an unknown streamId', () => {
  const treeRoot = mkTmpTreeRoot();
  assert.throws(() => readStreamRecords(treeRoot, 'nonexistent-stream'), /unknown streamId/);
});

test('readStreamRecords reads back what appendToStream wrote, in order', () => {
  const treeRoot = mkTmpTreeRoot();
  appendToStream(treeRoot, 'vision-transcript', { kind: 'idea', payload: { text: 'first' } });
  appendToStream(treeRoot, 'vision-transcript', { kind: 'sealed', payload: {} });
  const { records } = readStreamRecords(treeRoot, 'vision-transcript');
  assert.deepEqual(records.map((r) => r.kind), ['idea', 'sealed']);
});

// P11 Sol review pass-2 defect 8: onboarding-decision resolves to the
// SHARED ledger.jsonl — a mixed ledger carrying other sanctioned writers'
// kinds must still surface only this stream's own registered kind through
// this read.
test('readStreamRecords: onboarding-decision reads only "decision" records from a mixed ledger.jsonl (Sol\'s own probe)', () => {
  const treeRoot = mkTmpTreeRoot();
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'preflight-node', cmd: 'node --version', exit_code: 0 } });
  appendToStream(treeRoot, 'onboarding-decision', {
    kind: 'decision',
    payload: { event: 'settings_interview_completed', preset: 'balanced', telemetry_consent: false },
  });
  appendRecord(ledgerPath, { kind: 'gate', payload: { gate_id: 'preflight-git', cmd: 'git status', exit_code: 0 } });

  const { records } = readStreamRecords(treeRoot, 'onboarding-decision');
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'decision');
  assert.equal(records[0].event, 'settings_interview_completed');

  // The raw file still carries all three records — the filtering happens on
  // the returned view, not by rewriting the shared ledger.
  const { records: raw } = readRecords(ledgerPath);
  assert.equal(raw.length, 3);
});

test('readStreamRecords on a nonexistent stream file reads as zero records, not an error', () => {
  const treeRoot = mkTmpTreeRoot();
  const { records, errors } = readStreamRecords(treeRoot, 'research-scratchpad');
  assert.deepEqual(records, []);
  assert.deepEqual(errors, []);
});

// ---------- STREAM_REGISTRY shape (documentation-grade proof) ----------

test('STREAM_REGISTRY names exactly the four closed streams this module owns', () => {
  assert.deepEqual(
    Object.keys(STREAM_REGISTRY).sort(),
    ['onboarding-decision', 'research-scratchpad', 'vision-decisions', 'vision-transcript']
  );
});

// ---------- CLI ----------

test('CLI: append reads the record from stdin and writes it to the streamId\'s own file', () => {
  const treeRoot = mkTmpTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'append', 'vision-transcript', treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify({ kind: 'idea', payload: { text: 'CLI idea' } }),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(typeof printed.seq, 'number');
  const { records } = readRecords(path.join(treeRoot, 'vision', 'transcript.jsonl'));
  assert.equal(records[0].text, 'CLI idea');
});

test('CLI: append exits 1 and writes nothing for a kind outside the streamId\'s contract', () => {
  const treeRoot = mkTmpTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'append', 'vision-decisions', treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify({ kind: 'idea', payload: {} }),
  });
  assert.equal(proc.status, 1);
  assert.equal(fs.existsSync(path.join(treeRoot, 'vision', 'decisions.jsonl')), false);
});

test('CLI: append exits 1 for an unknown streamId (never accepts a literal path)', () => {
  const treeRoot = mkTmpTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'append', path.join(treeRoot, 'ledger.jsonl'), treeRoot], {
    encoding: 'utf8',
    input: JSON.stringify({ kind: 'decision', payload: {} }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /unknown streamId/);
});

test('CLI: append exits 1 on invalid JSON via stdin', () => {
  const treeRoot = mkTmpTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'append', 'vision-transcript', treeRoot], {
    encoding: 'utf8',
    input: 'not json',
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /^kind-registry\.js: /);
});

test('CLI: read prints the streamId\'s own readRecords() result', () => {
  const treeRoot = mkTmpTreeRoot();
  appendToStream(treeRoot, 'research-scratchpad', { kind: 'steer', payload: { decision: 'x', topic: 'y', reason: 'z' } });
  const proc = spawnSync(process.execPath, [CLI_PATH, 'read', 'research-scratchpad', treeRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.records.length, 1);
  assert.equal(printed.records[0].kind, 'steer');
});

test('CLI: read exits 1 for an unknown streamId', () => {
  const treeRoot = mkTmpTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'read', 'not-a-stream', treeRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /unknown streamId/);
});

test('CLI: missing arguments prints usage and exits 1', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'append', 'vision-transcript'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: kind-registry\.js/);
});

test('CLI: unknown command prints usage and exits 1', () => {
  const treeRoot = mkTmpTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'delete', 'vision-transcript', treeRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage: kind-registry\.js/);
});

test('CLI: a surplus positional argument is refused (P11 Sol review finding 13)', () => {
  const treeRoot = mkTmpTreeRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'read', 'vision-transcript', treeRoot, 'extra'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /unexpected extra argument/);
});
