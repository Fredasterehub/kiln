'use strict';

// Delivery phase machinery (ruled: "delivery: styled final
// presentation + last-mile report — TWO artifacts"; the delivery voice law,
// product/voice/kiln.md: "fact first, one breath of style", "no recorded
// event, no line", "red is red"; §1: "delivered scope never
// silently incomplete"; the dev record's ruled `delivery/` tree shape and
// divergence decisions).
//
// This module owns the machine-checkable half of delivery: a deterministic
// PROJECTION over already-recorded truth, never a place new facts get
// invented. Two writers:
//
//   assembleLastMile — every unresolved/parked/quarantined/at-cap/not-green
//   fact the tree already carries, rolled into delivery/last-mile.json.
//   Every item MUST trace to a recorded origin (a file, plus a seq or path
//   locating it within that file) — the same "no recorded event, no line"
//   law product/voice/kiln.md states for every narrating surface applies
//   here at the machine layer: nothing
//   enters the report that this module cannot point at on disk.
//
//   renderFacts — the delivery presenter's OWN input projection: a bounded, DATA-ONLY
//   view (never prose) of ledger phase-transitions, the current suite
//   state, the milestone index, and last-mile's own counts, written to
//   delivery/facts.json. The agent authoring `delivery/presentation.md` and
//   `delivery/last-mile-report.md` may cite these fact entries; it may not
//   narrate anything this file does not carry.
//
// checkDeliveryReady is the phase's own readiness gate, reusing phases.js's
// existing `suite-state-green` exit-check kind (run-currency included)
// rather than re-deriving that judgment a second way — one native mechanism
// per constraint.

const fs = require('node:fs');
const path = require('node:path');

const { readJson, writeAtomic } = require('./atomic-json.js');
const { readRecords, appendRecord } = require('./stream.js');
const { project } = require('./projection.js');
const { FIX_LOOP_CAP } = require('./quarantine.js');
const { runExitChecks } = require('./phases.js');
const { validatePark, PARK_ALL_FIELDS } = require('./validators.js');

const LAST_MILE_SCHEMA_VERSION = 1;
const FACTS_SCHEMA_VERSION = 1;

// Bounded per the ruled projection law — the delivery presenter consumes a view, never the raw
// ledger stream. 100 is a generous, still-bounded window over a stream
// this project's own pace never approaches (one entry per phase
// transition/reopen, of which there are at most a handful per run).
const LEDGER_FACTS_LAST_N = 100;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireTreeRoot(treeRoot, caller) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError(`delivery: ${caller} requires a non-empty treeRoot string`);
  }
}

function lastMilePathOf(treeRoot) {
  return path.join(treeRoot, 'delivery', 'last-mile.json');
}

function factsPathOf(treeRoot) {
  return path.join(treeRoot, 'delivery', 'facts.json');
}

// ---------- assembleLastMile ----------

// Reads last-mile.jsonl's own "park" records (workers request parking via
// their envelopes; Maestro is this stream's sole writer, through
// recordPark below — synthesis §2 — so what lands here is already routed,
// never appended by this module directly). Genesis/other kinds are
// ignored, matching every other stream reader's non-genesis convention in
// this codebase.
function collectParks(treeRoot) {
  const file = path.join(treeRoot, 'last-mile.jsonl');
  const { records } = readRecords(file);
  const items = [];
  for (const record of records) {
    if (!isPlainObject(record) || record.kind !== 'park') continue;
    items.push({
      source: { file: 'last-mile.jsonl', seq: record.seq },
      id: `park-${record.seq}`,
      summary: isNonEmptyString(record.summary) ? record.summary : '(park record carries no summary)',
      severity: isNonEmptyString(record.severity) ? record.severity : 'unspecified',
      ...(isNonEmptyString(record.owner_phase) ? { owner_phase: record.owner_phase } : {}),
    });
  }
  return items;
}

// The sole sanctioned producer of last-mile.jsonl "park" records (P11
// finding F4: the blocker ladder's S2/S3 outcome named this file but no
// mechanism ever wrote it). validatePark enforces the shape — summary and
// severity required, owner_phase optional, no unexpected keys — before
// anything reaches disk; a caller with a malformed park gets a thrown
// TypeError naming exactly which field is wrong, the same "fails closed
// rather than silently reshaping" posture check-honesty.js's
// recordDeviation already holds. Writes through stream.appendRecord (the
// common JSONL header wrapper), matching every other sanctioned writer in
// this tree.
function recordPark(treeRoot, { summary, severity, ownerPhase, correlationId } = {}) {
  requireTreeRoot(treeRoot, 'recordPark');
  const park = { summary, severity, ...(ownerPhase !== undefined ? { owner_phase: ownerPhase } : {}) };
  const { ok, errors } = validatePark(park);
  if (!ok) {
    throw new TypeError(`recordPark: invalid park — ${errors.join('; ')}`);
  }
  const file = path.join(treeRoot, 'last-mile.jsonl');
  const seq = appendRecord(file, {
    kind: 'park',
    payload: park,
    correlation_id: correlationId !== undefined ? correlationId : null,
  });
  return { seq, park };
}

// Reads verification/quarantine.json's own entries[] — every journey
// currently under flake tracking, whether mid-incident (history.length===1)
// or a decided quarantine verdict (history.length===2). Both are honest
// unresolved state a delivery report must not drop silently.
function collectQuarantineEntries(treeRoot) {
  const relFile = path.join('verification', 'quarantine.json');
  const doc = readJson(path.join(treeRoot, relFile), { schema_version: 1, entries: [] });
  const entries = isPlainObject(doc) && Array.isArray(doc.entries) ? doc.entries : [];
  const items = [];
  for (const entry of entries) {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.journey_id)) continue;
    const history = Array.isArray(entry.history) ? entry.history : [];
    const decided = history.length >= 2;
    items.push({
      source: { file: relFile, path: entry.journey_id },
      id: `quarantine-${entry.journey_id}`,
      summary: `Journey "${entry.journey_id}" ${decided ? 'quarantined (flake, decided)' : 'under active flake investigation (awaiting re-run)'}${
        isNonEmptyString(entry.reason) ? ` — reason: ${entry.reason}` : ''
      }`,
      severity: decided ? 'quarantined' : 'pending',
      owner_phase: 'verification',
    });
  }
  return items;
}

// Reads verification/fix-attempts.jsonl (quarantine.js's own capTracker
// stream) and surfaces every problem_key that reached the fix-loop cap
// — the same FIX_LOOP_CAP constant capTracker.atCap enforces,
// imported rather than re-declared, so this projection can never drift from
// the actual enforcement threshold.
function collectFixAttemptsAtCap(treeRoot) {
  const relFile = path.join('verification', 'fix-attempts.jsonl');
  const { records } = readRecords(path.join(treeRoot, relFile));
  const byKey = new Map();
  for (const record of records) {
    if (!isPlainObject(record) || record.kind !== 'fix-attempt') continue;
    if (!isNonEmptyString(record.problem_key)) continue;
    const list = byKey.get(record.problem_key) || [];
    list.push(record);
    byKey.set(record.problem_key, list);
  }
  const items = [];
  for (const [problemKey, list] of byKey) {
    if (list.length < FIX_LOOP_CAP) continue;
    const latest = list[list.length - 1];
    items.push({
      source: { file: relFile, seq: latest.seq },
      id: `fix-cap-${problemKey}`,
      summary: `Fix-loop cap (${FIX_LOOP_CAP}) reached for problem "${problemKey}" (${list.length} recorded attempts) — agreement pass required`,
      severity: 'blocking',
    });
  }
  return items;
}

// Globs verification/*.md — today that is security-scanner.md's own dated
// `security-scan-<date>.md` evidence artifact; discovery-agent currently
// files only an envelope, never a verification/*.md file, so this glob
// simply finds nothing for it yet. Presence-referenced ONLY: the file's
// existence is the recorded fact, its prose content is never parsed here
// (that would make this module a second, weaker markdown-scraping judge —
// the "MD: prose meaning, never scraped for state").
function collectVerificationReports(treeRoot) {
  const dir = path.join(treeRoot, 'verification');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const mdNames = names.filter((name) => name.toLowerCase().endsWith('.md')).sort();
  return mdNames.map((name) => ({
    source: { file: path.join('verification', name) },
    id: `verification-report-${name}`,
    summary: `Verification report on file: verification/${name} (presence-referenced — read the file for its actual findings)`,
    severity: 'unclassified',
    owner_phase: 'verification',
  }));
}

// Reads milestones/index.json and surfaces every milestone whose status is
// not "green" — closeMilestone (machine/src/milestones.js) is the sole
// writer of that status, so anything else here is honestly incomplete.
function collectMilestonesNotGreen(treeRoot) {
  const relFile = path.join('milestones', 'index.json');
  const doc = readJson(path.join(treeRoot, relFile), { schema_version: 1, milestones: [] });
  const milestones = isPlainObject(doc) && Array.isArray(doc.milestones) ? doc.milestones : [];
  const items = [];
  for (const m of milestones) {
    if (!isPlainObject(m) || !isNonEmptyString(m.id)) continue;
    if (m.status === 'green') continue;
    items.push({
      source: { file: relFile, path: m.id },
      id: `milestone-${m.id}`,
      summary: `Milestone "${m.id}" is not green (status: ${JSON.stringify(m.status ?? null)})`,
      severity: 'blocking',
      owner_phase: 'implementation',
    });
  }
  return items;
}

// assembleLastMile(treeRoot) — the deterministic projection over recorded
// truth this module exists to compute. Writes delivery/last-mile.json
// atomically and returns the written document.
function assembleLastMile(treeRoot) {
  requireTreeRoot(treeRoot, 'assembleLastMile');

  const parks = collectParks(treeRoot);
  const quarantineItems = collectQuarantineEntries(treeRoot);
  const fixCapItems = collectFixAttemptsAtCap(treeRoot);
  const reportItems = collectVerificationReports(treeRoot);
  const milestoneItems = collectMilestonesNotGreen(treeRoot);

  const items = [...parks, ...quarantineItems, ...fixCapItems, ...reportItems, ...milestoneItems];

  const suiteState = readJson(path.join(treeRoot, 'verification', 'suite-state.json'), null);
  const generatedFromRun = isPlainObject(suiteState) && isNonEmptyString(suiteState.run_id) ? suiteState.run_id : null;

  const doc = {
    schema_version: LAST_MILE_SCHEMA_VERSION,
    generated_from_run: generatedFromRun,
    items,
    counts: {
      total: items.length,
      last_mile_parks: parks.length,
      quarantine_entries: quarantineItems.length,
      fix_attempts_at_cap: fixCapItems.length,
      verification_reports: reportItems.length,
      milestones_not_green: milestoneItems.length,
    },
  };

  writeAtomic(lastMilePathOf(treeRoot), doc);
  return doc;
}

// ---------- renderFacts ----------

// renderFacts(treeRoot) — the delivery presenter's own bounded input projection.
// DATA only: every element is {kind, ts, source, ...statement-data fields},
// never a prose sentence — composing prose from these facts is the
// presentation author's job, not this module's. Requires
// delivery/last-mile.json to already exist (assembleLastMile runs first in
// the delivery phase's own sequence) since the last-mile-counts fact cites
// it rather than recomputing it a second way.
//
// Provenance (P9 required revision #4; P9 Sol review MAJOR: "renderFacts
// fabricates citation timestamps and can emit a line with no antecedent
// event at all"). Every fact carries a `source` object locating recorded
// material on disk — {file} plus a seq or path where the source stream
// carries one, the SAME shape assembleLastMile's own items already use —
// and a `ts` that comes ONLY from a field some other writer actually
// recorded, never from `new Date()` computed at render time:
//   - phase-transition: record.ts (stream.js's appendRecord stamps this on
//     every record, unconditionally) + {file:'ledger.jsonl', seq:record.seq}.
//   - suite-state: computeSuiteState's own recorded `ts` field
//     (machine/src/verification.js) when present, else null — never this
//     module's own clock — + {file:'verification/suite-state.json'}.
//   - milestone: milestones/index.json entries (createMilestone,
//     closeMilestone — machine/src/milestones.js) carry no timestamp field
//     at all, so ts is always null here + {file:'milestones/index.json',
//     path:m.id}.
//   - last-mile-counts: delivery/last-mile.json's own assembleLastMile
//     output carries no timestamp field either, so ts is always null here +
//     {file:'delivery/last-mile.json'}.
// The delivery voice law (product/voice/kiln.md) — "no recorded event, no
// line" — applies at this machine layer exactly as it does to
// the presenter's prose: a fact with no recorded timestamp states that
// honestly (ts:null) rather than inventing one that would read as a real
// event time to whatever cites it.
function renderFacts(treeRoot) {
  requireTreeRoot(treeRoot, 'renderFacts');

  const facts = [];

  // Ledger phase-transitions — bounded projection, never the
  // raw stream.
  const { view: transitions } = project(readRecords(path.join(treeRoot, 'ledger.jsonl')).records, {
    kinds: ['phase-transition'],
    lastN: LEDGER_FACTS_LAST_N,
  });
  for (const record of transitions) {
    facts.push({
      kind: 'phase-transition',
      ts: record.ts,
      source: { file: 'ledger.jsonl', seq: record.seq },
      from: record.from,
      to: record.to,
    });
  }

  // Current suite state, if verification has run.
  const suiteStateRelFile = path.join('verification', 'suite-state.json');
  const suiteState = readJson(path.join(treeRoot, suiteStateRelFile), null);
  let generatedFromRun = null;
  if (isPlainObject(suiteState)) {
    generatedFromRun = isNonEmptyString(suiteState.run_id) ? suiteState.run_id : null;
    facts.push({
      kind: 'suite-state',
      ts: isNonEmptyString(suiteState.ts) ? suiteState.ts : null,
      source: { file: suiteStateRelFile },
      run_id: suiteState.run_id ?? null,
      status: suiteState.status ?? null,
      passing_count: Array.isArray(suiteState.passing) ? suiteState.passing.length : 0,
      failing_count: Array.isArray(suiteState.failing) ? suiteState.failing.length : 0,
      quarantined_count: Array.isArray(suiteState.quarantined) ? suiteState.quarantined.length : 0,
    });
  }

  // Milestone index — one fact per milestone, current status only (no
  // prose, no derived judgment). milestones/index.json entries carry no
  // recorded timestamp (createMilestone/closeMilestone never stamp one), so
  // ts is honestly null rather than a render-time substitute.
  const milestoneRelFile = path.join('milestones', 'index.json');
  const milestoneDoc = readJson(path.join(treeRoot, milestoneRelFile), { schema_version: 1, milestones: [] });
  const milestoneList = isPlainObject(milestoneDoc) && Array.isArray(milestoneDoc.milestones) ? milestoneDoc.milestones : [];
  for (const m of milestoneList) {
    if (!isPlainObject(m) || !isNonEmptyString(m.id)) continue;
    facts.push({
      kind: 'milestone',
      ts: null,
      source: { file: milestoneRelFile, path: m.id },
      id: m.id,
      status: m.status ?? null,
      designer_family: m.designer_family ?? null,
    });
  }

  // Last-mile's own counts — cited, never recomputed a second way. Its
  // source file (delivery/last-mile.json) is guaranteed to exist by the
  // throw below whenever this fact is emitted; last-mile.json itself
  // carries no timestamp field, so ts is honestly null.
  const lastMilePath = lastMilePathOf(treeRoot);
  const lastMile = readJson(lastMilePath, null);
  if (!isPlainObject(lastMile) || !isPlainObject(lastMile.counts)) {
    throw new Error(
      `delivery: renderFacts requires ${lastMilePath} to already exist (run assembleLastMile first) — no last-mile counts to cite`
    );
  }
  facts.push({
    kind: 'last-mile-counts',
    ts: null,
    source: { file: path.join('delivery', 'last-mile.json') },
    generated_from_run: lastMile.generated_from_run ?? null,
    counts: lastMile.counts,
  });

  const doc = {
    schema_version: FACTS_SCHEMA_VERSION,
    // Run-bound (P9 required revision #1): copied from the SAME suite-state
    // snapshot the `suite-state` fact above cites, never derived a second
    // way — null when no suite state exists yet, which correctly makes the
    // registry's "run-bound" exit check on this file fail closed rather
    // than pass on an absent identity.
    generated_from_run: generatedFromRun,
    facts,
  };

  writeAtomic(factsPathOf(treeRoot), doc);
  return doc;
}

// ---------- checkDeliveryReady ----------

// checkDeliveryReady(treeRoot) -> {ok, missing[]}. Reuses phases.js's own
// named exit-check kinds rather than re-deriving any of these judgments a
// second way — one native mechanism per constraint:
// `suite-state-green` (run-currency check included) on the live suite
// snapshot, and `run-bound` on each of this module's own two JSON outputs
// (P9 required revision #1; P9 Sol review BLOCKING #1: "readiness accepts
// stale delivery projections from an older run" — a projection assembled or
// rendered from an OLDER run must fail here even though its file is
// present and nonempty, so run-bound subsumes what a bare file-nonempty
// check on these two files used to do; missing/empty/unparseable all still
// fail closed under run-bound, they just also now catch "present but
// stale").
function checkDeliveryReady(treeRoot) {
  requireTreeRoot(treeRoot, 'checkDeliveryReady');

  const failures = runExitChecks(treeRoot, [
    { file: path.join('verification', 'suite-state.json'), check: 'suite-state-green' },
    { file: path.join('delivery', 'last-mile.json'), check: 'run-bound' },
    { file: path.join('delivery', 'facts.json'), check: 'run-bound' },
  ]);

  return { ok: failures.length === 0, missing: failures };
}

// CLI entrypoint (this codebase's own "Bash, narrowly" convention — flat,
// one command per call, matching phases.js/milestones.js/verification.js).
function parseArgv(argv) {
  const [command, ...rest] = argv;
  return { command, rest };
}

function main(argv) {
  const { command, rest } = parseArgv(argv);
  try {
    let result;
    if (command === 'assemble-last-mile') {
      const [treeRoot] = rest;
      if (!treeRoot) throw new Error('assemble-last-mile requires <treeRoot>');
      result = assembleLastMile(treeRoot);
    } else if (command === 'render-facts') {
      const [treeRoot] = rest;
      if (!treeRoot) throw new Error('render-facts requires <treeRoot>');
      result = renderFacts(treeRoot);
    } else if (command === 'check-delivery-ready') {
      const [treeRoot] = rest;
      if (!treeRoot) throw new Error('check-delivery-ready requires <treeRoot>');
      result = checkDeliveryReady(treeRoot);
    } else if (command === 'park') {
      const [treeRoot] = rest;
      if (!treeRoot) throw new Error('park requires <treeRoot>');
      const parkText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
      let parsed;
      try {
        parsed = JSON.parse(parkText);
      } catch (err) {
        throw new Error(`park JSON via stdin is not valid JSON: ${err.message}`);
      }
      if (!isPlainObject(parsed)) {
        throw new Error('park JSON via stdin must be a JSON object');
      }
      // CLI adapter parity (P11 Sol review finding 5): recordPark below only
      // ever reconstructs {summary, severity, owner_phase} from named
      // fields, so an extra key on the raw parsed input would otherwise
      // never reach validatePark's own extra-key check at all — the adapter
      // validates the PARSED object's actual key set itself, before any
      // reconstruction happens.
      const allowedKeys = new Set([...PARK_ALL_FIELDS, 'correlation_id']);
      const extraKeys = Object.keys(parsed).filter((key) => !allowedKeys.has(key));
      if (extraKeys.length > 0) {
        throw new Error(`park JSON via stdin carries unexpected key(s): ${extraKeys.join(', ')}`);
      }
      result = recordPark(treeRoot, {
        summary: parsed.summary,
        severity: parsed.severity,
        ownerPhase: parsed.owner_phase,
        correlationId: parsed.correlation_id,
      });
    } else {
      throw new Error(`unknown command "${command}" (expected assemble-last-mile, render-facts, check-delivery-ready, or park)`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`delivery.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { assembleLastMile, renderFacts, checkDeliveryReady, recordPark, LAST_MILE_SCHEMA_VERSION, FACTS_SCHEMA_VERSION };
