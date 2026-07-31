'use strict';

// The wake: one deterministic re-orientation, composed from the tree's own
// files and written nowhere. `wake.js view <projectRoot>` prints a single
// bounded digest — detect.js's classification, the resume point phases.js
// computes, the last stop handoff.js recorded, and the milestone position
// the milestones/ tree carries, the capabilities the preflight recorded
// into state.json, and the index of the tablet the build has been writing
// — each line a projection of a fact already on disk. This module opens nothing for write: the digest is a view,
// never a second maintained artifact, and running it twice changes
// nothing.
//
// The argument is the PROJECT root — the directory that may contain the
// tree — the same root detect.js and scaffold.js take, since a
// classification is a fact about the project and the tree may not exist at
// all yet. The tree path is derived from it here.
//
// Absence is data: a missing piece renders ABSENT and the digest still
// exits 0, so a caller reads the digest rather than the exit code to learn
// where a project stands. Evidence detect.js did not compute renders "not
// computed" rather than a fabricated "no". A real error — a projectRoot
// that does not exist, a path that cannot be read — still throws, through
// detect.js's own refusals.
//
// `--pulse` is a second renderer over those same gathered facts, not a
// second reader: the room check a session runs before it speaks. It prints
// the subset that answers "where does this stand right now" — the position,
// the last stop with any waiting operator question verbatim, and how much
// memory the tablet carries as a count — and, for a project with no resume
// tree, the classification line alone, since nothing else can be said
// honestly. Same gather, same selectors, same absence semantics, same
// exit-0-always contract; only the projection differs.
//
// The rendered digest is capped at MAX_DIGEST_LINES lines, counted on the
// rendered string itself: a bounded read stays bounded whatever the tree
// grows into — including a single state field that carries newlines of its
// own — and a truncated digest says so on its last line.

const fs = require('node:fs');
const path = require('node:path');

const { readJson } = require('./atomic-json.js');
const { detect } = require('./detect.js');
const { projectResumeFacts } = require('./handoff.js');
const { loadRegistry, resumePoint } = require('./phases.js');
const { readRecords } = require('./stream.js');
const { TABLET_FILENAME, readEntries, indexLines } = require('./tablet.js');

const TREE_NAME = '.kiln';
const STATE_FILENAME = 'state.json';
const REGISTRY_PATH = path.join(__dirname, '..', 'phases-registry.json');
const MAX_DIGEST_LINES = 80;
// The pulse is a glance, and it stays one: four rendered lines at most, and
// the cap holds whatever a single state field carries.
const MAX_PULSE_LINES = 8;
// The share of the digest the tablet index may take. A longer tablet renders
// its newest entries here and one more-entries line; the rest are reached by
// id through tablet.js's own view.
const MAX_TABLET_INDEX_LINES = 12;

// One plain sentence per non-resume mode: what the classification means
// mechanically for the session that just woke. A tree with no phase gets no
// phase section — these lines are the whole of what there is to say.
const MODE_MEANING = {
  greenfield: 'No tree and no project material yet — the build starts at onboarding.',
  brownfield: 'No tree, and the project already carries code — onboarding runs the brownfield scout first.',
  legacy: 'An earlier tree is on disk — intake sets it aside whole and harvests what carries forward.',
  'broken-install':
    'The tree is on disk but state.json is not a current resume point — the install is repaired, not migrated.',
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

// A boolean detect.js may have left uncomputed: null is its own answer,
// never folded into "no".
function computed(value) {
  return value === null ? 'not computed' : yesNo(value);
}

// isRegularFile(target) -> whether a regular file stands at that path, the
// lstat detect.js applies before reading state.json and for the same reason:
// a carrier read is only safe once the node is known to be a file. A
// directory, a symlink, a device or a FIFO is not a carrier — and a
// synchronous read of a FIFO blocks forever waiting for a writer, so no
// try/catch around the read can catch it. Every carrier read here checks
// first, and a non-regular node is the same absence a missing one is.
function isRegularFile(target) {
  try {
    return fs.lstatSync(target).isFile();
  } catch {
    return false;
  }
}

// chunkCounts(chunksPath) -> {recorded, green} | null — the distinct chunk
// ids a milestone's stream carries and the distinct ids that reached
// chunk-green. A stream that is not on disk has recorded nothing, and that is
// zero. A path whose bytes cannot be read at all — anything standing where
// the stream belongs that is not a readable file — is not zero but unknown:
// null, so the digest renders the chunk facts ABSENT rather than report a
// count it never observed.
function chunkCounts(chunksPath) {
  if (chunksPath === null || !fs.existsSync(chunksPath)) return { recorded: 0, green: 0 };
  if (!isRegularFile(chunksPath)) return null;

  let records;
  try {
    records = readRecords(chunksPath).records;
  } catch {
    return null;
  }

  const recorded = new Set();
  const green = new Set();
  for (const record of records) {
    if (!isPlainObject(record) || !isNonEmptyString(record.chunk_id)) continue;
    recorded.add(record.chunk_id);
    if (record.kind === 'chunk-green') green.add(record.chunk_id);
  }
  return { recorded: recorded.size, green: green.size };
}

// readPosition(treeRoot) -> {index, total, id, status, chunks_recorded,
// chunks_green} | null — where the build stands in the milestone sequence,
// read from milestones/index.json and the current milestone's own
// chunks.jsonl. The current milestone is the first one not yet green; when
// every milestone is green it is the last. An index that cannot be read or
// parsed at all is an absence like any other: the position renders ABSENT and
// the rest of the digest still stands. The two reads degrade separately —
// a milestone read from a sound index still renders when its chunk stream
// cannot be read, and the counts alone go null.
function readPosition(treeRoot) {
  const indexPath = path.join(treeRoot, 'milestones', 'index.json');
  if (!isRegularFile(indexPath)) return null;

  let index;
  try {
    index = readJson(indexPath, null);
  } catch {
    return null;
  }
  if (!isPlainObject(index) || !Array.isArray(index.milestones)) return null;

  const entries = index.milestones.filter(isPlainObject);
  if (entries.length === 0) return null;

  const openAt = entries.findIndex((entry) => entry.status !== 'green');
  const at = openAt === -1 ? entries.length - 1 : openAt;
  const entry = entries[at];
  const id = isNonEmptyString(entry.id) ? entry.id : null;

  const counts = chunkCounts(id === null ? null : path.join(treeRoot, 'milestones', id, 'chunks.jsonl'));

  return {
    index: at + 1,
    total: entries.length,
    id,
    status: isNonEmptyString(entry.status) ? entry.status : null,
    chunks_recorded: counts === null ? null : counts.recorded,
    chunks_green: counts === null ? null : counts.green,
  };
}

// capabilityFacts(entry) -> {routing, observed} | null — one capability as
// preflight.js records it: `present` is the boolean downstream routing reads,
// `observed` is the separate fact of how that boolean was arrived at, so a
// measured "absent" and an unresolved "unknown" stay distinguishable here the
// way they are on disk.
function capabilityFacts(entry) {
  if (!isPlainObject(entry)) return null;
  const present = entry.present;
  return {
    routing: present === true ? 'present' : present === false ? 'absent' : null,
    observed: isNonEmptyString(entry.observed) ? entry.observed : null,
  };
}

// readPreflight(treeRoot) -> {mode, workflow_tool, agent_teams} | null — the
// state.json.preflight block onboarding recorded. A tree that never ran
// preflight has no block, and that is an absence, not a failure. A state
// file that cannot be read or parsed at all is the same absence: an
// unreadable state is what broken-install means, and the digest reports
// that classification rather than failing on the bytes behind it.
function readPreflight(treeRoot) {
  const statePath = path.join(treeRoot, STATE_FILENAME);
  if (!isRegularFile(statePath)) return null;

  let state;
  try {
    state = readJson(statePath, null);
  } catch {
    return null;
  }
  if (!isPlainObject(state) || !isPlainObject(state.preflight)) return null;
  const block = state.preflight;
  const capabilities = isPlainObject(block.capabilities) ? block.capabilities : {};
  return {
    mode: isNonEmptyString(block.mode) ? block.mode : null,
    workflow_tool: capabilityFacts(capabilities.workflow_tool),
    agent_teams: capabilityFacts(capabilities.agent_teams),
  };
}

// readTablet(treeRoot) -> the entries the build's memory carries, read
// through tablet.js — the one reader of that stream — or null when there is
// nothing readable standing at tablet.jsonl. The regular-file gate comes
// first for the same reason every other carrier read here applies it: a
// synchronous read of a FIFO waits forever for a writer no try/catch can
// interrupt. A stream that is not on disk is an absence, and so is one whose
// bytes cannot be read at all.
function readTablet(treeRoot) {
  const streamPath = path.join(treeRoot, TABLET_FILENAME);
  if (!fs.existsSync(streamPath) || !isRegularFile(streamPath)) return null;
  try {
    return readEntries(treeRoot);
  } catch {
    return null;
  }
}

// gather(projectRoot) -> the facts the digest renders. Phase, stop and
// position are read only for a resume tree: no other mode has a phase to
// report, and inventing one would be the digest's first lie.
function gather(projectRoot) {
  const { mode, evidence } = detect(projectRoot);
  const treeRoot = path.join(projectRoot, TREE_NAME);
  const facts = { mode, evidence, resume: null, preflight: readPreflight(treeRoot), tablet: readTablet(treeRoot) };

  if (mode === 'resume') {
    const statePath = path.join(treeRoot, STATE_FILENAME);
    const state = readJson(statePath, null);
    const point = resumePoint(treeRoot, loadRegistry(REGISTRY_PATH), statePath);
    facts.resume = { ...projectResumeFacts(state, point), position: readPosition(treeRoot) };
  }

  return facts;
}

function classificationLines(mode, evidence) {
  const txn = evidence.intake_txn;
  return [
    `- Mode: ${mode}`,
    `- Tree present: ${yesNo(evidence.has_tree)}`,
    `- State file present: ${yesNo(evidence.has_state)}`,
    `- Git repo: ${computed(evidence.has_git)}`,
    `- Project code: ${computed(evidence.has_code)}`,
    `- Legacy tier: ${evidence.legacy_tier === null ? 'ABSENT' : evidence.legacy_tier}`,
    `- Legacy markers: ${evidence.legacy_markers.length === 0 ? 'ABSENT' : evidence.legacy_markers.join(', ')}`,
    `- Intake transaction: ${txn === null ? 'ABSENT' : `${txn.txn_id} (phase ${txn.phase})`}`,
  ];
}

// canResume false is reported, never acted on: the digest states what disk
// does and does not back up, and the caller decides what to do about it.
function positionLines(resume) {
  const lines = [
    `- Phase: ${resume.phase === null ? 'ABSENT' : resume.phase}`,
    `- Next action: ${resume.next_action === null ? 'ABSENT' : resume.next_action}`,
    `- Can resume: ${resume.can_resume === null ? 'ABSENT' : yesNo(resume.can_resume)}`,
  ];
  if (resume.can_resume === false && resume.missing.length > 0) {
    lines.push('- Missing:');
    for (const relpath of resume.missing) {
      lines.push(`  - ${relpath}`);
    }
  }
  const position = resume.position;
  if (position === null) {
    lines.push('- Milestone: ABSENT', '- Chunks: ABSENT');
  } else {
    lines.push(
      `- Milestone: ${position.index} of ${position.total} — ${position.id === null ? 'ABSENT' : position.id}` +
        ` (${position.status === null ? 'ABSENT' : position.status})`,
      position.chunks_recorded === null
        ? '- Chunks: ABSENT'
        : `- Chunks: ${position.chunks_recorded} recorded, ${position.chunks_green} green`
    );
  }
  return lines;
}

function stopLines(stop) {
  if (stop === null) return ['- Last stop: ABSENT'];
  const lines = [
    `- Stop state: ${stop.stop_state}`,
    `- Reporter: ${stop.reporter === null ? 'ABSENT' : stop.reporter}`,
    `- Recorded: ${stop.ts === null ? 'ABSENT' : stop.ts} (ledger.jsonl seq ${stop.seq === null ? 'ABSENT' : stop.seq})`,
  ];
  if (stop.question !== null) {
    lines.push(`- Operator question: ${stop.question}`);
  }
  if (stop.earliest_resume !== null) {
    lines.push(`- Earliest resume: ${stop.earliest_resume}`);
  }
  return lines;
}

// The two capabilities preflight records, in preflight.md's own check order,
// each rendered as the routing token followed by the observation behind it.
function capabilityLine(label, capability) {
  if (capability === null) return `- ${label}: ABSENT`;
  const routing = capability.routing === null ? 'ABSENT' : capability.routing;
  const observed = capability.observed === null ? 'ABSENT' : capability.observed;
  return `- ${label}: ${routing} (observed ${observed})`;
}

function capabilitiesLines(preflight) {
  if (!preflight) return ['- Preflight: ABSENT'];
  return [
    `- Preflight mode: ${preflight.mode === null ? 'ABSENT' : preflight.mode}`,
    capabilityLine('Workflow tool', preflight.workflow_tool),
    capabilityLine('Agent teams', preflight.agent_teams),
  ];
}

// The tablet index, newest first, inside the section's own share of the
// digest. A stream that could not be read renders ABSENT; one that is
// readable renders the count it carries, even when that count is zero.
function tabletLines(entries) {
  if (!Array.isArray(entries)) return ['- Entries: ABSENT'];
  return [`- Entries: ${entries.length}`, ...indexLines(entries, MAX_TABLET_INDEX_LINES)];
}

// The cap binds the view a reader receives, so it counts the physical lines
// of the rendered text: one field carrying newlines of its own is as many
// lines as it prints, and a truncated view is exactly `limit` lines including
// its own last-line marker. Both renderers cap the same way, each with its
// own limit and its own name for what was cut.
function capToLimit(text, limit, label) {
  const lines = text.split('\n');
  if (lines.length <= limit) return text;
  return [...lines.slice(0, limit - 1), `- (${label} truncated at ${limit} lines)`].join('\n');
}

// renderDigest(facts) -> the whole digest as one string, capped. Pure: the
// facts are already gathered, and every branch here is a presentation of
// one of them.
function renderDigest(facts) {
  const lines = ['# Wake', '', '## Classification', ...classificationLines(facts.mode, facts.evidence)];

  if (facts.mode === 'resume') {
    lines.push('', '## Position', ...positionLines(facts.resume));
    lines.push('', '## Last stop', ...stopLines(facts.resume.stop));
  } else {
    lines.push('', '## What this means', `- ${MODE_MEANING[facts.mode]}`);
  }

  // What the session that just woke can actually reach, as the preflight
  // recorded it — the section holds the digest's shape in every mode, and a
  // tree that has not run preflight reads ABSENT.
  lines.push('', '## Capabilities', ...capabilitiesLines(facts.preflight));

  // What the build has carved into its memory — the index, newest first. The
  // section holds the digest's shape in every mode, and a tree with no tablet
  // stream reads ABSENT.
  lines.push('', '## Tablet', ...tabletLines(facts.tablet));

  lines.push('');
  return capToLimit(lines.join('\n'), MAX_DIGEST_LINES, 'digest');
}

// The pulse's own three position-and-memory lines, each a compression of a
// digest section into the one sentence a room check needs. canResume false is
// reported as plainly as it is in the digest; the missing list it stands for
// belongs to the digest, which is where a caller goes next.
function pulseLines(resume, tablet) {
  const position = resume.position;
  const stop = resume.stop;
  const lines = [
    `- Phase: ${resume.phase === null ? 'ABSENT' : resume.phase}` +
      ` (next ${resume.next_action === null ? 'ABSENT' : resume.next_action},` +
      ` can resume: ${resume.can_resume === null ? 'ABSENT' : yesNo(resume.can_resume)})`,
    position === null
      ? '- Milestone: ABSENT'
      : `- Milestone: ${position.index} of ${position.total} — ${position.id === null ? 'ABSENT' : position.id}` +
        ` (${position.status === null ? 'ABSENT' : position.status}), ` +
        (position.chunks_recorded === null
          ? 'chunks ABSENT'
          : `chunks ${position.chunks_recorded} recorded, ${position.chunks_green} green`),
    stop === null
      ? '- Last stop: ABSENT'
      : `- Last stop: ${stop.stop_state}` + (stop.question === null ? '' : ` — operator question: ${stop.question}`),
    // The count, not the index: a room check reports how much memory stands
    // behind it and leaves the reading of it to the tablet's own view.
    `- Tablet: ${Array.isArray(tablet) ? `${tablet.length} entries` : 'ABSENT'}`,
  ];
  return lines;
}

// renderPulse(facts) -> the room check as one string, capped. Pure, over the
// same facts renderDigest projects. A project with no resume tree has no
// position, no stop and no memory to report, so the classification it does
// have is the whole of what it can say.
function renderPulse(facts) {
  const lines =
    facts.mode === 'resume' ? pulseLines(facts.resume, facts.tablet) : [`- Mode: ${facts.mode}`];
  lines.push('');
  return capToLimit(lines.join('\n'), MAX_PULSE_LINES, 'pulse');
}

function wakeFacts(projectRoot) {
  if (!isNonEmptyString(projectRoot)) {
    throw new TypeError('wake: projectRoot must be a non-empty string');
  }
  return gather(projectRoot);
}

function wakeDigest(projectRoot) {
  return renderDigest(wakeFacts(projectRoot));
}

function wakePulse(projectRoot) {
  return renderPulse(wakeFacts(projectRoot));
}

// CLI entrypoint (this codebase's flat one-command convention). The view is
// prose, so it goes to stdout as it was rendered — trailing newline included
// — rather than through a JSON envelope. One optional flag selects the
// renderer; parseArgv fails closed on everything else, so a surplus
// positional argument and a flag this command does not have are refused the
// same way.
const PULSE_FLAG = '--pulse';

function parseArgv(argv) {
  const [command, projectRoot, ...rest] = argv;
  const pulse = rest[0] === PULSE_FLAG;
  const surplus = pulse ? rest.slice(1) : rest;
  const error = surplus.length > 0 ? `unexpected extra argument(s): ${surplus.join(' ')}` : null;
  return { command, projectRoot, pulse, error };
}

const USAGE = 'usage: wake.js view <projectRoot> [--pulse]\n';

function main(argv) {
  const { command, projectRoot, pulse, error } = parseArgv(argv);
  if (command !== 'view' || !isNonEmptyString(projectRoot) || error) {
    if (error) process.stderr.write(`wake.js: ${error}\n`);
    process.stderr.write(USAGE);
    process.exit(1);
  }
  try {
    process.stdout.write(pulse ? wakePulse(projectRoot) : wakeDigest(projectRoot));
  } catch (err) {
    process.stderr.write(`wake.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { wakeDigest, renderDigest, wakePulse, renderPulse };
