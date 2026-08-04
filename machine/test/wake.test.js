'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { wakeDigest, renderDigest, wakePulse, renderPulse } = require('../src/wake.js');
const { writeStop, projectResumeFacts } = require('../src/handoff.js');
const { scaffoldTree } = require('../src/scaffold.js');
const { run: preflightRun } = require('../src/preflight.js');
const { createMilestone } = require('../src/milestones.js');
const { appendEntry } = require('../src/tablet.js');
const { readJson, writeAtomic } = require('../src/atomic-json.js');

const ROUTING_CONFIG = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');
const CLI_PATH = path.join(__dirname, '..', 'src', 'wake.js');
const TREE = '.thelastskill';

// The hard cap the wake digest is bound by, spelled here as the law the
// renderer must hold rather than read back from the module under test.
const MAX_DIGEST_LINES = 80;

// The hard cap the pulse is bound by, spelled here as the law the second
// renderer must hold rather than read back from the module under test.
const MAX_PULSE_LINES = 8;

// The share of that digest the tablet index may take, spelled here as the law
// the renderer must hold rather than read back from the module under test.
const MAX_TABLET_INDEX_LINES = 12;

// The tablet's own summary cap, spelled here as the law the read path must
// hold rather than read back from the module under test.
const TABLET_SUMMARY_MAX_CHARS = 120;

function scaffoldedProjectRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-test-'));
  const projectRoot = path.join(dir, 'proj');
  scaffoldTree(projectRoot, { routingConfigPath: ROUTING_CONFIG });
  return projectRoot;
}

function treeRootOf(projectRoot) {
  return path.join(projectRoot, TREE);
}

function bareProjectRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-test-'));
  const projectRoot = path.join(dir, 'proj');
  fs.mkdirSync(projectRoot, { recursive: true });
  return projectRoot;
}

// Every file under dir, relpath -> sha256 of its bytes, for the
// write-nothing property: a view that opened anything for write would move
// a digest, add a temp file, or drop a lockfile.
function snapshotTree(dir) {
  const snapshot = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        const rel = path.relative(dir, abs);
        snapshot[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      }
    }
  };
  walk(dir);
  return snapshot;
}

function lineCountOf(digest) {
  return digest.split('\n').length;
}

// A FIFO is the blocking node: a synchronous read of one waits for a writer
// that never comes, so a carrier read guarded by try/catch alone never
// returns to its catch. Each FIFO case runs through the CLI under a timeout,
// so a hang reads as the failure it is rather than stalling the suite.
function mkfifo(target) {
  return spawnSync('mkfifo', [target]).status === 0;
}

// Hosts without mkfifo skip these three cases rather than fail on a tool
// this suite does not otherwise need.
const FIFO_SUPPORTED = mkfifo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wake-fifo-')), 'probe'));
const FIFO_SKIP = FIFO_SUPPORTED ? false : 'mkfifo is unavailable on this host';

function viewPromptly(projectRoot) {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8', timeout: 10000 });
  assert.equal(proc.status, 0, `wake.js view did not exit 0 (signal ${proc.signal}): ${proc.stderr}`);
  return proc.stdout;
}

// ---------- classification ----------

test('the digest opens with the detect() classification and reports uncomputed evidence as not computed', () => {
  const projectRoot = scaffoldedProjectRoot();
  const digest = wakeDigest(projectRoot);

  assert.match(digest, /^# Wake\n/);
  assert.match(digest, /## Classification\n/);
  assert.match(digest, /- Mode: resume\n/);
  assert.match(digest, /- Tree present: yes\n/);
  assert.match(digest, /- State file present: yes\n/);
  // detect() decides a resume from .kiln facts alone, so these two are null.
  assert.match(digest, /- Git repo: not computed\n/);
  assert.match(digest, /- Project code: not computed\n/);
  assert.doesNotMatch(digest, /- Git repo: no\n/);
  assert.doesNotMatch(digest, /- Project code: no\n/);
});

test('greenfield reports the git and code evidence detect() actually computed', () => {
  const digest = wakeDigest(bareProjectRoot());
  assert.match(digest, /- Mode: greenfield\n/);
  assert.match(digest, /- Tree present: no\n/);
  assert.match(digest, /- Project code: no\n/);
  assert.doesNotMatch(digest, /not computed/);
});

// ---------- resume ----------

test('a resume tree carries phase, next action, canResume and the milestone position', () => {
  const projectRoot = scaffoldedProjectRoot();
  const digest = wakeDigest(projectRoot);

  assert.match(digest, /## Position\n/);
  assert.match(digest, /- Phase: onboarding\n/);
  assert.match(digest, /- Next action: onboarding\n/);
  assert.match(digest, /- Can resume: yes\n/);
  assert.match(digest, /- Milestone: ABSENT\n/);
  assert.match(digest, /- Chunks: ABSENT\n/);
});

test('the milestone position is read from milestones/index.json and its chunk stream', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  createMilestone(treeRoot, { id: 'M1', title: 'Skeleton', designer_family: 'gpt' });
  createMilestone(treeRoot, { id: 'M2', title: 'Store', designer_family: 'claude' });

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Milestone: 1 of 2 — M1 \(open\)\n/);
  assert.match(digest, /- Chunks: 0 recorded, 0 green\n/);
});

// A milestones/index.json that cannot be parsed is an unreadable piece of a
// tree that is otherwise a sound resume point: the position reads ABSENT and
// the rest of the digest still renders.
test('a milestones/index.json of invalid JSON renders the position ABSENT and still exits 0', () => {
  const projectRoot = scaffoldedProjectRoot();
  fs.writeFileSync(path.join(treeRootOf(projectRoot), 'milestones', 'index.json'), '{ milestones: [');

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Mode: resume\n/);
  assert.match(digest, /- Phase: onboarding\n/);
  assert.match(digest, /- Milestone: ABSENT\n/);
  assert.match(digest, /- Chunks: ABSENT\n/);

  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
});

test('a milestones/index.json that is a FIFO renders the position ABSENT and still exits 0', { skip: FIFO_SKIP }, () => {
  const projectRoot = scaffoldedProjectRoot();
  const indexPath = path.join(treeRootOf(projectRoot), 'milestones', 'index.json');
  fs.rmSync(indexPath, { force: true });
  assert.ok(mkfifo(indexPath));

  const stdout = viewPromptly(projectRoot);
  assert.match(stdout, /- Mode: resume\n/);
  assert.match(stdout, /- Milestone: ABSENT\n/);
  assert.match(stdout, /- Chunks: ABSENT\n/);
});

// A chunk stream carrying an unparseable line is read for the records it does
// carry: readRecords collects the parse failure and the counts stay honest
// about the chunks the stream actually names.
test('a chunks.jsonl carrying an unparseable line still renders the milestone and the chunks it names', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  createMilestone(treeRoot, { id: 'M1', title: 'Skeleton', designer_family: 'gpt' });
  fs.writeFileSync(
    path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl'),
    `{ not json\n${JSON.stringify({ schema_version: 1, seq: 1, kind: 'chunk-green', ts: '2026-07-31T00:00:00.000Z', chunk_id: 'C1' })}\n`
  );

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Milestone: 1 of 1 — M1 \(open\)\n/);
  assert.match(digest, /- Chunks: 1 recorded, 1 green\n/);

  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
});

// A chunks.jsonl that is not a readable file at all — a directory standing
// where the stream belongs — leaves the chunk facts unobserved. The milestone
// facts the index did yield still render; only the chunk line degrades to
// ABSENT, since a count the digest never observed would be a lie.
test('a chunks.jsonl that cannot be read renders the milestone and the chunks ABSENT', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  createMilestone(treeRoot, { id: 'M1', title: 'Skeleton', designer_family: 'gpt' });
  const chunksPath = path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl');
  fs.rmSync(chunksPath, { force: true });
  fs.mkdirSync(chunksPath);

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Mode: resume\n/);
  assert.match(digest, /- Milestone: 1 of 1 — M1 \(open\)\n/);
  assert.match(digest, /- Chunks: ABSENT\n/);

  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
});

test('a chunks.jsonl that is a FIFO renders the milestone and the chunks ABSENT', { skip: FIFO_SKIP }, () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  createMilestone(treeRoot, { id: 'M1', title: 'Skeleton', designer_family: 'gpt' });
  const chunksPath = path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl');
  fs.rmSync(chunksPath, { force: true });
  assert.ok(mkfifo(chunksPath));

  const stdout = viewPromptly(projectRoot);
  assert.match(stdout, /- Mode: resume\n/);
  assert.match(stdout, /- Milestone: 1 of 1 — M1 \(open\)\n/);
  assert.match(stdout, /- Chunks: ABSENT\n/);
});

test('canResume false renders the missing list plainly and still exits 0', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  const statePath = path.join(treeRoot, 'state.json');
  writeAtomic(statePath, { ...readJson(statePath), phase: 'architecture' });

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Phase: architecture\n/);
  assert.match(digest, /- Can resume: no\n/);
  assert.match(digest, /- Missing:\n/);
  assert.match(digest, /\n {2}- \S+/);

  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /- Can resume: no\n/);
});

// ---------- the last stop ----------

test('a waiting BLOCKED-OPERATOR stop renders the operator question verbatim', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  const question = 'Postgres or SQLite for the session store — which do you want?';
  writeStop(treeRoot, { stop_state: 'BLOCKED-OPERATOR', reporter: 'handoff-recorder', question });

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /## Last stop\n/);
  assert.match(digest, /- Stop state: BLOCKED-OPERATOR\n/);
  assert.match(digest, /- Reporter: handoff-recorder\n/);
  assert.match(digest, /- Recorded: \S+ \(ledger\.jsonl seq \d+\)\n/);
  assert.ok(digest.includes(`- Operator question: ${question}\n`));
});

test('a tree with no stop yet renders the last stop ABSENT', () => {
  const digest = wakeDigest(scaffoldedProjectRoot());
  assert.match(digest, /- Last stop: ABSENT\n/);
  assert.doesNotMatch(digest, /- Operator question:/);
});

test('a DONE stop carries no operator question line', () => {
  const projectRoot = scaffoldedProjectRoot();
  writeStop(treeRootOf(projectRoot), { stop_state: 'DONE', reporter: 'handoff-recorder' });

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Stop state: DONE\n/);
  assert.doesNotMatch(digest, /- Operator question:/);
});

// ---------- capabilities ----------

// The fixture is written by preflight.js itself, so the section is proven
// against the shape actually recorded rather than a hand-copied one. The
// codex check is the documented --codex-cmd seam; node and git run for real.
function preflightedProjectRoot(opts) {
  const projectRoot = scaffoldedProjectRoot();
  preflightRun(projectRoot, { codexCmd: 'exit 0', ...opts });
  return projectRoot;
}

test('a recorded preflight renders the mode and both capabilities, routing and observed', () => {
  const projectRoot = preflightedProjectRoot({
    workflowTool: true,
    agentTeams: false,
    agentTeamsObserved: 'unknown',
  });

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /## Capabilities\n/);
  assert.match(digest, /- Preflight mode: full-cross-family\n/);
  assert.match(digest, /- Workflow tool: present \(observed present\)\n/);
  assert.match(digest, /- Agent teams: absent \(observed unknown\)\n/);
});

test('a degraded preflight renders the mode it recorded', () => {
  const projectRoot = preflightedProjectRoot({
    workflowTool: false,
    agentTeams: true,
    codexCmd: 'exit 1',
  });

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Preflight mode: degraded-claude-only\n/);
  assert.match(digest, /- Workflow tool: absent \(observed absent\)\n/);
  assert.match(digest, /- Agent teams: present \(observed present\)\n/);
});

test('a tree with no preflight recorded yet renders capabilities ABSENT', () => {
  const digest = wakeDigest(scaffoldedProjectRoot());
  assert.match(digest, /## Capabilities\n- Preflight: ABSENT\n/);
  assert.doesNotMatch(digest, /- Preflight mode:/);
});

test('the capabilities section is present in every mode', () => {
  const roots = {
    resume: scaffoldedProjectRoot(),
    greenfield: bareProjectRoot(),
    brownfield: brownfieldProjectRoot(),
    legacy: legacyProjectRoot(),
    'broken-install': brokenInstallProjectRoot(),
  };

  for (const [mode, projectRoot] of Object.entries(roots)) {
    const digest = wakeDigest(projectRoot);
    assert.match(digest, new RegExp(`- Mode: ${mode}\\n`));
    assert.match(digest, /## Capabilities\n- Preflight: ABSENT\n/);
  }
});

// A state.json that cannot be read is exactly what broken-install means:
// detect() classifies it, and the wake reports that classification rather
// than tripping over the same bytes on its way to the capabilities section.
test('a state.json of invalid JSON renders broken-install with capabilities ABSENT', () => {
  const projectRoot = bareProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  fs.mkdirSync(treeRoot, { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'state.json'), '{ phase: onboarding');

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Mode: broken-install\n/);
  assert.match(digest, /## Capabilities\n- Preflight: ABSENT\n/);

  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
});

test('a state.json that is a directory renders broken-install with capabilities ABSENT', () => {
  const projectRoot = bareProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  fs.mkdirSync(path.join(treeRoot, 'state.json'), { recursive: true });

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Mode: broken-install\n/);
  assert.match(digest, /## Capabilities\n- Preflight: ABSENT\n/);

  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
});

test('a state.json that is a FIFO renders broken-install with capabilities ABSENT', { skip: FIFO_SKIP }, () => {
  const projectRoot = bareProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  fs.mkdirSync(treeRoot, { recursive: true });
  assert.ok(mkfifo(path.join(treeRoot, 'state.json')));

  const stdout = viewPromptly(projectRoot);
  assert.match(stdout, /- Mode: broken-install\n/);
  assert.match(stdout, /## Capabilities\n- Preflight: ABSENT\n/);
});

// ---------- the tablet ----------

function brownfieldProjectRoot() {
  const projectRoot = bareProjectRoot();
  fs.writeFileSync(path.join(projectRoot, 'index.js'), 'module.exports = {};\n');
  return projectRoot;
}

function brokenInstallProjectRoot() {
  const projectRoot = bareProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  fs.mkdirSync(treeRoot, { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'state.json'), JSON.stringify({ phase: 'onboarding' }));
  return projectRoot;
}

function legacyProjectRoot() {
  const projectRoot = bareProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  fs.mkdirSync(treeRoot, { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'LAW.md'), '# Law\n');
  fs.writeFileSync(path.join(treeRoot, 'decisions.md'), '# Decisions\n');
  return projectRoot;
}

// A tree with no tablet stream has recorded nothing lawful to read: the line
// belongs to the digest's shape in every mode and reads ABSENT.
test('the tablet line renders ABSENT in every mode with no tablet stream', () => {
  const roots = {
    resume: scaffoldedProjectRoot(),
    greenfield: bareProjectRoot(),
    brownfield: brownfieldProjectRoot(),
    legacy: legacyProjectRoot(),
    'broken-install': brokenInstallProjectRoot(),
  };

  for (const [mode, projectRoot] of Object.entries(roots)) {
    const digest = wakeDigest(projectRoot);
    assert.match(digest, new RegExp(`- Mode: ${mode}\\n`));
    assert.match(digest, /## Tablet\n- Entries: ABSENT\n/);
  }
});

test('a tree carrying a tablet renders the real index, newest first', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  appendEntry(treeRoot, { kind: 'decision', course: 'The session store lands on SQLite', because: 'no server on this floor' });
  appendEntry(treeRoot, { kind: 'constraint', fact: 'sqlite refuses WAL here', must_respect: 'pin journal_mode=DELETE' });

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /## Tablet\n- Entries: 2\n/);
  assert.ok(digest.includes('- T-1 constraint — sqlite refuses WAL here\n'));
  assert.ok(digest.includes('- T-0 decision — The session store lands on SQLite\n'));
  assert.doesNotMatch(digest, /- Entries: ABSENT/);
});

test('a tablet stream carrying no lawful entry reports the zero it observed', () => {
  const projectRoot = scaffoldedProjectRoot();
  fs.writeFileSync(path.join(treeRootOf(projectRoot), 'tablet.jsonl'), `${JSON.stringify({ seq: 1, kind: 'note' })}\n`);

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /## Tablet\n- Entries: 0\n/);
});

// A tablet.jsonl that is not a readable file leaves the entries unobserved —
// the same carrier discipline every other read in the digest follows.
test('a tablet.jsonl that is a directory renders the tablet ABSENT and still exits 0', () => {
  const projectRoot = scaffoldedProjectRoot();
  fs.mkdirSync(path.join(treeRootOf(projectRoot), 'tablet.jsonl'));

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Mode: resume\n/);
  assert.match(digest, /## Tablet\n- Entries: ABSENT\n/);

  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
});

test('a tablet.jsonl that is a FIFO renders the tablet ABSENT', { skip: FIFO_SKIP }, () => {
  const projectRoot = scaffoldedProjectRoot();
  assert.ok(mkfifo(path.join(treeRootOf(projectRoot), 'tablet.jsonl')));

  const stdout = viewPromptly(projectRoot);
  assert.match(stdout, /- Mode: resume\n/);
  assert.match(stdout, /## Tablet\n- Entries: ABSENT\n/);
});

// The wake reads the tablet through tablet.js, so it inherits that module's
// one validation contract: a line the append validation would refuse never
// reaches the index, however lawful its kind looks from the outside.
test('a line the append contract would refuse never reaches the wake index', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  appendEntry(treeRoot, { kind: 'decision', course: 'The session store lands on SQLite', because: 'no server on this floor' });

  const header = { schema_version: 1, ts: '2026-07-31T00:00:00.000Z', correlation_id: null };
  const refused = [
    { ...header, schema_version: 2, seq: 1, kind: 'decision', course: 'wrong schema version', because: 'b' },
    { ...header, ts: 'yesterday', seq: 2, kind: 'decision', course: 'invalid timestamp', because: 'b' },
    { ...header, correlation_id: 'chunk_C03', seq: 3, kind: 'decision', course: 'stray correlator', because: 'b' },
    { ...header, seq: 4, kind: 'decision', course: 'extra payload key', because: 'b', note: 'x' },
    { ...header, seq: 5, kind: 'decision', course: 'z'.repeat(TABLET_SUMMARY_MAX_CHARS + 1), because: 'b' },
    { seq: 6, kind: 'decision', course: 'no common header', because: 'b' },
  ];
  for (const record of refused) {
    fs.appendFileSync(path.join(treeRoot, 'tablet.jsonl'), `${JSON.stringify(record)}\n`);
  }

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /## Tablet\n- Entries: 1\n/);
  for (const course of ['wrong schema version', 'invalid timestamp', 'stray correlator', 'extra payload key', 'no common header']) {
    assert.ok(!digest.includes(course), `the digest must not render "${course}"`);
  }
  assert.doesNotMatch(digest, /zzzz/);
});

// An index line is one line by contract: a summary carrying a newline of its
// own would print as two and inject apparent digest structure into the wake.
test('a tablet summary carrying an embedded newline never reaches the wake index', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  appendEntry(treeRoot, { kind: 'decision', course: 'The session store lands on SQLite', because: 'no server on this floor' });
  const injected = {
    schema_version: 1,
    seq: 1,
    kind: 'decision',
    ts: '2026-07-31T00:00:00.000Z',
    correlation_id: null,
    course: 'lawful first line\n## Injected section',
    because: 'b',
  };
  fs.appendFileSync(path.join(treeRoot, 'tablet.jsonl'), `${JSON.stringify(injected)}\n`);

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /## Tablet\n- Entries: 1\n/);
  assert.ok(!digest.includes('## Injected section'));
  assert.equal(digest.split('\n').filter((line) => line.startsWith('- T-')).length, 1);
});

// The index rides inside the digest's own budget: a tablet longer than the
// section's share renders the newest entries and one more-entries line, and
// the whole digest still holds the cap.
test('a long tablet renders the newest entries, a more-entries line, and holds the digest cap', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  createMilestone(treeRoot, { id: 'M1', title: 'Skeleton', designer_family: 'gpt' });
  writeStop(treeRoot, { stop_state: 'BLOCKED-OPERATOR', reporter: 'handoff-recorder', question: 'Which store?' });
  const total = 40;
  for (let i = 0; i < total; i++) {
    appendEntry(treeRoot, { kind: 'decision', course: `course ${i}`, because: 'because' });
  }

  const digest = wakeDigest(projectRoot);
  assert.ok(lineCountOf(digest) <= MAX_DIGEST_LINES);
  assert.match(digest, new RegExp(`- Entries: ${total}\\n`));
  assert.ok(digest.includes(`- T-${total - 1} decision — course ${total - 1}\n`));

  const tabletLines = digest
    .split('\n')
    .slice(digest.split('\n').indexOf('## Tablet') + 2)
    .filter((line) => line.startsWith('- '));
  assert.equal(tabletLines.length, MAX_TABLET_INDEX_LINES);
  assert.match(tabletLines[tabletLines.length - 1], /^- \(\d+ more entries\)$/);
  assert.doesNotMatch(digest, /truncated/);
});

// ---------- the short modes ----------

test('greenfield renders a short digest with no phase or stop sections invented', () => {
  const digest = wakeDigest(bareProjectRoot());
  assert.match(digest, /## What this means\n/);
  assert.doesNotMatch(digest, /## Position/);
  assert.doesNotMatch(digest, /## Last stop/);
  assert.ok(lineCountOf(digest) < 25);
});

test('broken-install classifies and explains itself without a phase section', () => {
  const projectRoot = bareProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  fs.mkdirSync(treeRoot, { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'state.json'), JSON.stringify({ phase: 'onboarding' }));

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Mode: broken-install\n/);
  assert.match(digest, /- Tree present: yes\n/);
  assert.match(digest, /- State file present: yes\n/);
  assert.match(digest, /## What this means\n/);
  assert.doesNotMatch(digest, /## Position/);
  assert.doesNotMatch(digest, /## Last stop/);

  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
});

test('a legacy tree names its tier and the markers found', () => {
  const projectRoot = bareProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  fs.mkdirSync(treeRoot, { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'LAW.md'), '# Law\n');
  fs.writeFileSync(path.join(treeRoot, 'decisions.md'), '# Decisions\n');

  const digest = wakeDigest(projectRoot);
  assert.match(digest, /- Mode: legacy\n/);
  assert.match(digest, /- Legacy tier: 1\n/);
  assert.match(digest, /- Legacy markers: LAW\.md, decisions\.md\n/);
});

// ---------- the size cap ----------

test('every mode renders within the digest line cap', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  createMilestone(treeRoot, { id: 'M1', title: 'Skeleton', designer_family: 'gpt' });
  writeStop(treeRoot, { stop_state: 'BLOCKED-OPERATOR', reporter: 'handoff-recorder', question: 'Which store?' });
  for (const root of [projectRoot, bareProjectRoot()]) {
    assert.ok(lineCountOf(wakeDigest(root)) <= MAX_DIGEST_LINES);
  }
});

test('the renderer truncates rather than exceed the cap, and says so', () => {
  const facts = {
    mode: 'resume',
    evidence: { has_tree: true, has_state: true, has_git: null, has_code: null, legacy_tier: null, legacy_markers: [], intake_txn: null },
    resume: {
      phase: 'architecture',
      next_action: 'architecture',
      can_resume: false,
      missing: Array.from({ length: 200 }, (_, i) => `architecture/artifact-${i}.md`),
      stop: null,
      position: null,
    },
    tablet: null,
  };
  const digest = renderDigest(facts);
  assert.ok(lineCountOf(digest) <= MAX_DIGEST_LINES);
  assert.match(digest, /truncated/);
});

// The cap binds the digest a reader actually receives, so it counts the
// physical lines of the rendered string — a single state field carrying
// newlines is as many lines as it prints.
test('a state field carrying newlines is capped by physical lines, not by field count', () => {
  const facts = {
    mode: 'resume',
    evidence: { has_tree: true, has_state: true, has_git: null, has_code: null, legacy_tier: null, legacy_markers: [], intake_txn: null },
    resume: {
      phase: 'implementation',
      next_action: Array.from({ length: 100 }, (_, i) => `run step ${i}`).join('\n'),
      can_resume: true,
      missing: [],
      stop: null,
      position: null,
    },
  };
  const digest = renderDigest(facts);
  const lines = digest.split('\n');
  assert.equal(lines.length, MAX_DIGEST_LINES);
  assert.match(lines[lines.length - 1], /truncated/);
});

// ---------- the write-nothing property ----------

test('a view writes nothing: the tree is byte-identical before and after', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  writeStop(treeRoot, { stop_state: 'BLOCKED-OPERATOR', reporter: 'handoff-recorder', question: 'Which store?' });

  const before = snapshotTree(treeRoot);
  wakeDigest(projectRoot);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(snapshotTree(treeRoot), before);
});

// ---------- the shared selector ----------

test('projectResumeFacts is pure: it mutates neither argument', () => {
  const state = Object.freeze({
    schema_version: 1,
    phase: 'implementation',
    next_action: 'implementation',
    last_stop: Object.freeze({ stop_state: 'DONE', reporter: 'handoff-recorder', seq: 4, ts: '2026-07-31T00:00:00.000Z' }),
  });
  const point = Object.freeze({ phase: 'implementation', canResume: true, missing: Object.freeze([]) });

  const first = projectResumeFacts(state, point);
  const second = projectResumeFacts(state, point);
  assert.deepEqual(first, second);
  assert.equal(first.phase, 'implementation');
  assert.equal(first.next_action, 'implementation');
  assert.equal(first.can_resume, true);
  assert.deepEqual(first.missing, []);
  assert.equal(first.stop.stop_state, 'DONE');
  assert.equal(first.stop.seq, 4);
});

test('projectResumeFacts takes the phase from the resume point, and from state only without one', () => {
  const state = { phase: 'architecture', next_action: 'architecture' };
  const point = { phase: 'implementation', canResume: true, missing: [] };

  assert.equal(projectResumeFacts(state, point).phase, 'implementation');
  assert.equal(projectResumeFacts(state, null).phase, 'architecture');
  assert.equal(projectResumeFacts(state, { canResume: false, missing: [] }).phase, null);
});

test('projectResumeFacts reports absent fields as null, never as invented values', () => {
  const facts = projectResumeFacts({}, null);
  assert.equal(facts.phase, null);
  assert.equal(facts.next_action, null);
  assert.equal(facts.can_resume, null);
  assert.deepEqual(facts.missing, []);
  assert.equal(facts.stop, null);
});

test('both surfaces read the waiting question through the same selector', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  const question = 'Which cloud account should the delivery land in?';
  writeStop(treeRoot, { stop_state: 'BLOCKED-OPERATOR', reporter: 'handoff-recorder', question });

  const handoffMd = fs.readFileSync(path.join(treeRoot, 'handoff.md'), 'utf8');
  const digest = wakeDigest(projectRoot);
  assert.ok(handoffMd.includes(`- Operator question: ${question}\n`));
  assert.ok(digest.includes(`- Operator question: ${question}\n`));

  const facts = projectResumeFacts(readJson(path.join(treeRoot, 'state.json')), null);
  assert.equal(facts.stop.question, question);
});

// ---------- the pulse ----------

function pulsePromptly(projectRoot) {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot, '--pulse'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(proc.status, 0, `wake.js view --pulse did not exit 0 (signal ${proc.signal}): ${proc.stderr}`);
  return proc.stdout;
}

// The room check a session runs before it speaks: the position, the stop that
// is waiting on the operator with its question verbatim, and how much memory
// the tablet carries — a subset of the digest, never a second reading of it.
test('the pulse renders the position, the waiting question verbatim, and the tablet count', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  createMilestone(treeRoot, { id: 'M1', title: 'Skeleton', designer_family: 'gpt' });
  createMilestone(treeRoot, { id: 'M2', title: 'Store', designer_family: 'claude' });
  const question = 'Postgres or SQLite for the session store — which do you want?';
  writeStop(treeRoot, { stop_state: 'BLOCKED-OPERATOR', reporter: 'handoff-recorder', question });
  appendEntry(treeRoot, { kind: 'decision', course: 'The session store lands on SQLite', because: 'no server on this floor' });

  const pulse = wakePulse(projectRoot);
  assert.match(pulse, /- Phase: onboarding \(next onboarding, can resume: yes\)\n/);
  assert.match(pulse, /- Milestone: 1 of 2 — M1 \(open\), chunks 0 recorded, 0 green\n/);
  assert.match(pulse, /- Last stop: BLOCKED-OPERATOR\b/);
  assert.ok(pulse.includes(question), 'the waiting question must render verbatim');
  assert.match(pulse, /- Tablet: 1 entries?\n/);
  assert.ok(lineCountOf(pulse) <= MAX_PULSE_LINES, `the pulse ran to ${lineCountOf(pulse)} lines`);
  // A subset, not the digest: no headings, no evidence block, no tablet index.
  assert.doesNotMatch(pulse, /# Wake/);
  assert.doesNotMatch(pulse, /## /);
  assert.doesNotMatch(pulse, /- T-\d/);
});

test('the pulse reports canResume false without spilling the missing list', () => {
  const projectRoot = scaffoldedProjectRoot();
  const statePath = path.join(treeRootOf(projectRoot), 'state.json');
  writeAtomic(statePath, { ...readJson(statePath), phase: 'architecture' });

  const pulse = wakePulse(projectRoot);
  assert.match(pulse, /- Phase: architecture \(next onboarding, can resume: no\)\n/);
  assert.doesNotMatch(pulse, /- Missing:/);
  assert.ok(lineCountOf(pulse) <= MAX_PULSE_LINES);
});

// A project with no tree has no position, no stop and no memory to report:
// the classification is the whole of what the room check can honestly say.
test('the pulse of a tree-less project is the classification line alone', () => {
  const pulse = wakePulse(bareProjectRoot());
  assert.equal(pulse, '- Mode: greenfield\n');
});

test('the pulse of a broken install is the classification line alone and still exits 0', () => {
  const projectRoot = brokenInstallProjectRoot();

  assert.equal(wakePulse(projectRoot), '- Mode: broken-install\n');
  assert.equal(pulsePromptly(projectRoot), '- Mode: broken-install\n');
});

test('the pulse counts the tablet it can read and reports ABSENT for the one it cannot', () => {
  const withEntries = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(withEntries);
  appendEntry(treeRoot, { kind: 'decision', course: 'The session store lands on SQLite', because: 'no server on this floor' });
  appendEntry(treeRoot, { kind: 'constraint', fact: 'sqlite refuses WAL here', must_respect: 'pin journal_mode=DELETE' });
  assert.match(wakePulse(withEntries), /- Tablet: 2 entries\n/);

  const noStream = scaffoldedProjectRoot();
  assert.match(wakePulse(noStream), /- Tablet: ABSENT\n/);

  const unreadable = scaffoldedProjectRoot();
  fs.mkdirSync(path.join(treeRootOf(unreadable), 'tablet.jsonl'));
  assert.match(wakePulse(unreadable), /- Tablet: ABSENT\n/);
});

// The pulse holds its own cap on the rendered string, so one state field
// carrying newlines of its own cannot grow the room check.
test('the pulse truncates rather than exceed its cap, and says so', () => {
  const pulse = renderPulse({
    mode: 'resume',
    evidence: { has_tree: true, has_state: true, has_git: null, has_code: null, legacy_tier: null, legacy_markers: [], intake_txn: null },
    resume: {
      phase: 'implementation',
      next_action: Array.from({ length: 40 }, (_, i) => `run step ${i}`).join('\n'),
      can_resume: true,
      missing: [],
      stop: null,
      position: null,
    },
    tablet: null,
  });
  const lines = pulse.split('\n');
  assert.equal(lines.length, MAX_PULSE_LINES);
  assert.match(lines[lines.length - 1], /truncated/);
});

test('a pulse writes nothing: the tree is byte-identical before and after', () => {
  const projectRoot = scaffoldedProjectRoot();
  const treeRoot = treeRootOf(projectRoot);
  writeStop(treeRoot, { stop_state: 'BLOCKED-OPERATOR', reporter: 'handoff-recorder', question: 'Which store?' });
  appendEntry(treeRoot, { kind: 'decision', course: 'The session store lands on SQLite', because: 'no server on this floor' });

  const before = snapshotTree(treeRoot);
  wakePulse(projectRoot);
  pulsePromptly(projectRoot);
  assert.deepEqual(snapshotTree(treeRoot), before);
});

// The flag without the digest's own behavior: the same view, the same
// classification, one renderer chosen at the end.
test('the pulse renders the mode the digest classified, in every mode', () => {
  const roots = {
    resume: scaffoldedProjectRoot(),
    greenfield: bareProjectRoot(),
    brownfield: brownfieldProjectRoot(),
    legacy: legacyProjectRoot(),
    'broken-install': brokenInstallProjectRoot(),
  };

  for (const [mode, projectRoot] of Object.entries(roots)) {
    const pulse = wakePulse(projectRoot);
    if (mode === 'resume') {
      assert.match(pulse, /- Phase: /);
    } else {
      assert.equal(pulse, `- Mode: ${mode}\n`);
    }
    assert.ok(lineCountOf(pulse) <= MAX_PULSE_LINES);
  }
});

// ---------- CLI ----------

test('CLI: view --pulse prints the pulse and exits 0', () => {
  const projectRoot = scaffoldedProjectRoot();
  writeStop(treeRootOf(projectRoot), { stop_state: 'BLOCKED-OPERATOR', reporter: 'handoff-recorder', question: 'Which store?' });

  const stdout = pulsePromptly(projectRoot);
  assert.equal(stdout, wakePulse(projectRoot));
  assert.notEqual(stdout, wakeDigest(projectRoot));
});

test('CLI: a flag other than --pulse fails closed', () => {
  const projectRoot = scaffoldedProjectRoot();

  for (const flag of ['--digest', '-p', '--pulse=1', '--PULSE']) {
    const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot, flag], { encoding: 'utf8' });
    assert.equal(proc.status, 1, `${flag} must be refused`);
    assert.match(proc.stderr, /wake\.js: unexpected extra argument/);
    assert.match(proc.stderr, /usage: wake\.js view <projectRoot>/);
  }

  const twice = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot, '--pulse', '--pulse'], { encoding: 'utf8' });
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /wake\.js: unexpected extra argument/);
});


test('CLI: view prints the digest and exits 0', () => {
  const projectRoot = scaffoldedProjectRoot();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /^# Wake\n/);
  assert.equal(proc.stdout, wakeDigest(projectRoot));
});

test('CLI: an unknown command, a missing argument, or a surplus argument fails closed', () => {
  const projectRoot = scaffoldedProjectRoot();

  const unknown = spawnSync(process.execPath, [CLI_PATH, 'pulse', projectRoot], { encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /usage: wake\.js view <projectRoot>/);

  const bare = spawnSync(process.execPath, [CLI_PATH, 'view'], { encoding: 'utf8' });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /usage: wake\.js view <projectRoot>/);

  const surplus = spawnSync(process.execPath, [CLI_PATH, 'view', projectRoot, 'extra'], { encoding: 'utf8' });
  assert.equal(surplus.status, 1);
  assert.match(surplus.stderr, /wake\.js: unexpected extra argument/);
});

test('CLI: a projectRoot that does not exist is a real error, not an absence', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'view', path.join(os.tmpdir(), 'wake-test-no-such-dir')], {
    encoding: 'utf8',
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /wake\.js: /);
});
