'use strict';

// The plan-gate boundary (the ruled "Plan gate: last interactivity if
// opted; else auto-proceed"; synthesis §3/§4 steal #13). approveGate() is
// the ONE sanctioned producer of the manifest.json + gate.json pair — it
// builds the digest-bound manifest over the five content artifacts
// (manifest.js) and writes the binding gate.json atomically (atomic-json.js).
// verifyGate() deliberately does NOT reimplement the digest-chain check:
// check-honesty.js's verifyArchitectureGateApproved already IS that
// mechanism (gate -> manifest -> artifacts, canonical-set enforcement, drift
// detection), so this module requires it rather than duplicating it — one
// native mechanism per constraint.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { writeAtomic } = require('./atomic-json.js');
const { writeManifest, CANONICAL_ARCHITECTURE_ARTIFACTS } = require('./manifest.js');
const {
  verifyArchitectureGateApproved,
  GATE_DECISIONS,
  DECISION_SOURCES,
  GATE_SCHEMA_VERSION,
  PLAN_GATE_DECISION_KIND,
} = require('./check-honesty.js');
const { appendRecord } = require('./stream.js');
const { validateCriteriaRegister, validateMilestones, validateScoutConstraints } = require('./validators.js');

// gate.json's schema_version and decision_source vocabulary are owned by
// check-honesty.js (the module that VERIFIES a gate is honest, per P6 Sol
// review BLOCKING #1) and imported here rather than redeclared — one native
// mechanism per constraint: a producer disagreeing with its own
// verifier about what "valid" means is exactly the redundancy that rule
// forbids.
const SCHEMA_VERSION = GATE_SCHEMA_VERSION;

// the three named planning protocols — the only vocabulary
// protocol-record.md's semantic check (assertSemanticallyValid, below)
// accepts as evidence a real protocol ran. Matched case-insensitively with
// underscores normalized to spaces, so "deep_scrutiny" and "Deep Scrutiny"
// both count.
const PLANNING_PROTOCOLS = ['standard', 'deep scrutiny', 'maximal confrontation'];

function readJsonArtifact(archDir, relFile) {
  const abs = path.join(archDir, relFile);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    throw new Error(`plan-gate: could not read ${relFile}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`plan-gate: ${relFile} is not valid JSON: ${err.message}`);
  }
}

// readScoutConstraints(treeRoot) -> the parsed scout/constraints.json
// document, or null when brownfield scouting never ran (no scout/
// directory, or no constraints.json inside it) — the vacuous-pass case the
// protected-path law (below) requires: a plan with nothing scouted has
// nothing to conflict with. When the file DOES exist, it is re-validated
// through validators.validateScoutConstraints before a single field is
// trusted — the same "never trust a file's prior validity, re-verify at the
// point you rely on it" discipline assertSemanticallyValid already applies
// to the other four content artifacts, extended here to this supporting
// artifact scout writes independently of the architecture phase's own five.
function readScoutConstraints(treeRoot) {
  const constraintsPath = path.join(treeRoot, 'scout', 'constraints.json');
  if (!fs.existsSync(constraintsPath)) {
    return null;
  }
  let raw;
  try {
    raw = fs.readFileSync(constraintsPath, 'utf8');
  } catch (err) {
    throw new Error(`plan-gate: could not read scout/constraints.json: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`plan-gate: scout/constraints.json is not valid JSON: ${err.message}`);
  }
  const { ok, errors } = validateScoutConstraints(parsed);
  if (!ok) {
    throw new Error(`plan-gate: scout/constraints.json failed validation — ${errors.join('; ')}`);
  }
  return parsed;
}

// Path-matching law for the protected-path block ([seq 50],
// ruled in the dev record): posix-normalized, and a
// protected path guards both an EXACT match and everything nested under it
// as a directory prefix — scout-agent.md:56 defines a protected_paths[]
// entry as "{trust_flag, path, anchor, note}: a path that must not be
// touched, or touched only per `note`" with no separate is-directory flag,
// so a single `path` string must cover both a protected file and a
// protected directory tree. The '/' boundary in the prefix check keeps this
// a directory-prefix match, never a bare string prefix — a protected
// "src/auth" must guard "src/auth/session.js" but never "src/auth2/foo.js".
function normalizeRelPath(relPath) {
  return path.posix.normalize(relPath.split(path.sep).join('/'));
}

function pathIsProtectedBy(touchedPath, protectedPath) {
  const touched = normalizeRelPath(touchedPath);
  const guarded = normalizeRelPath(protectedPath);
  return touched === guarded || touched.startsWith(`${guarded}/`);
}

// assertNoProtectedPathConflicts(touchedPaths, protectedPaths) — the
// deterministic set-intersection itself ([seq 50]): a plan
// touching ANY path a scout protected_paths[] entry guards is a block, by
// rule, never by model judgment. Refuses (throws) naming every conflicting
// pair — the touched path plus the specific protected_paths entry's own
// `anchor`/`note` — so the seal refusal is actionable without a second
// lookup into scout/constraints.json. A protected_paths entry with no
// usable `path` is no longer structurally possible on anything read through
// readScoutConstraints above — validateScoutConstraints now requires
// `path`/`anchor`/`note` on every protected_paths entry, fail-closed (P11
// Sol review finding 7, closing the gap where a non-empty protected list
// could activate this whole protocol while protecting nothing). The
// `typeof entry.path === 'string' && entry.path !== ''` guard below stays as
// defense in depth, never the only enforcement, for a caller that hands this
// function a protectedPaths array built some other way than through the
// validated read/write path. Called
// only when protectedPaths is already known non-empty — an empty list is
// the vacuous-pass case assertSemanticallyValid's own caller-side check
// handles, not this function.
function assertNoProtectedPathConflicts(touchedPaths, protectedPaths) {
  const conflicts = [];
  for (const touched of touchedPaths) {
    for (const entry of protectedPaths) {
      if (typeof entry.path === 'string' && entry.path !== '' && pathIsProtectedBy(touched, entry.path)) {
        conflicts.push({ touched, entry });
      }
    }
  }
  if (conflicts.length === 0) {
    return;
  }
  const lines = conflicts.map(
    ({ touched, entry }) =>
      `"${touched}" conflicts with protected_paths entry "${entry.path}" (${entry.anchor}: ${entry.note})`
  );
  throw new Error(
    `plan-gate: plan touches path(s) protected by scout/constraints.json — seal refused:\n${lines.join('\n')}`
  );
}

// Semantic sealing (P6 Sol review BLOCKING #1/#3, part of the "gate accepts
// malformed architecture artifacts" finding): approval used to prove only
// byte stability (the five canonical paths exist) — the plan-gate tests
// deliberately filled every artifact with arbitrary text and successfully
// approved them. This is the machine's SINGLE semantic enforcement point
// (product/architecture/flow.md's "Sealing the gate"): re-parses and
// re-validates the three JSON artifacts and minimally shape-checks the other
// two, BEFORE any manifest/gate bytes are written. Any failure throws and
// leaves archDir exactly as it was — no manifest.json, no gate.json, no
// ledger record. This does NOT prove the plan is a GOOD architecture (that
// stays plan-coverage-checker's/plan-breaker's/plan-judge's job, per the
// anti-merge law) — only that its content is the shape the rest of the
// pipeline can honestly build on.
//
// Protected-path law, added in this same enforcement point (ruled in the
// dev record [seq 50], closing the ruled "agreement-pass additional
// trigger moments"): "a plan touching a
// path in scout's protected_paths[] IS a block, detected deterministically
// by set-intersection at the plan gate (fail-closed seal refusal), never by
// model judgment." No new trigger, no new gate, no new module — the research
// pass's own recommendation was that a protected-path conflict is "a
// detection problem, not an adjudication problem" (§4), so the fix reuses
// this function's own existing re-parse-and-re-validate sealing step. When
// <treeRoot>/scout/constraints.json exists and its own protected_paths[] is
// non-empty, milestones.json must declare a touched_paths[] footprint
// (validateMilestones's own extended check, below) and sealing refuses
// outright — naming every conflicting path plus its protected_paths entry's
// own `anchor`/`note` — while that footprint intersects the guarded set. No
// scout constraints, or an empty protected_paths[], is the vacuous-pass case
// the same ruling states explicitly: greenfield and "scout found nothing to
// protect" both proceed exactly as they did before this change.
function assertSemanticallyValid(archDir) {
  const criteriaRegister = readJsonArtifact(archDir, 'criteria-register.json');
  const criteriaResult = validateCriteriaRegister(criteriaRegister);
  if (!criteriaResult.ok) {
    throw new Error(`plan-gate: criteria-register.json failed validation — ${criteriaResult.errors.join('; ')}`);
  }

  // Read scout's constraints ONCE, here — both the touched_paths
  // requiredness fed into validateMilestones below and the conflict check
  // that follows it need the same protected_paths[] list. archDir is always
  // the tree-relative canonical `<treeRoot>/architecture` (this module's own
  // header comment), so treeRoot is always archDir's own parent directory —
  // the identical derivation approveGate's own ledgerPath computation uses,
  // below.
  const treeRoot = path.dirname(archDir);
  const scoutConstraints = readScoutConstraints(treeRoot);
  const protectedPaths =
    scoutConstraints && Array.isArray(scoutConstraints.protected_paths) ? scoutConstraints.protected_paths : [];

  const milestones = readJsonArtifact(archDir, 'milestones.json');
  const milestonesResult = validateMilestones(milestones, criteriaRegister, {
    requireTouchedPaths: protectedPaths.length > 0,
  });
  if (!milestonesResult.ok) {
    throw new Error(`plan-gate: milestones.json failed validation — ${milestonesResult.errors.join('; ')}`);
  }

  if (protectedPaths.length > 0) {
    assertNoProtectedPathConflicts(milestones.touched_paths, protectedPaths);
  }

  const artifactMap = readJsonArtifact(archDir, 'artifact-map.json');
  if (
    artifactMap === null ||
    typeof artifactMap !== 'object' ||
    Array.isArray(artifactMap) ||
    !Array.isArray(artifactMap.artifacts) ||
    artifactMap.artifacts.length < 1
  ) {
    throw new Error('plan-gate: artifact-map.json must be an object with a non-empty "artifacts" array');
  }

  const protocolRecordPath = path.join(archDir, 'protocol-record.md');
  let protocolRecord;
  try {
    protocolRecord = fs.readFileSync(protocolRecordPath, 'utf8');
  } catch (err) {
    throw new Error(`plan-gate: could not read protocol-record.md: ${err.message}`);
  }
  if (protocolRecord.trim() === '') {
    throw new Error('plan-gate: protocol-record.md is empty');
  }
  const normalized = protocolRecord.toLowerCase().replace(/_/g, ' ');
  if (!PLANNING_PROTOCOLS.some((name) => normalized.includes(name))) {
    throw new Error(
      `plan-gate: protocol-record.md does not name a planning protocol (expected one of: ${PLANNING_PROTOCOLS.join(', ')})`
    );
  }
}

function sha256Of(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

// approveGate(archDir, {decision, decision_source, revision}) -> {manifest,
// manifestPath, gate, gatePath, manifestDigest, created}. Refuses (throws)
// if any of the five required content artifacts is missing from archDir —
// sealing before authoring is not permitted (same precondition
// scaffold.js's scaffoldArchitecture enforces) — or if decision/
// decision_source is not one of the sanctioned values. Always builds a
// fresh manifest.json over the current artifact bytes, regardless of
// decision: even a "rejected" gate is bound to a reproducible digest of what
// was rejected.
function approveGate(archDir, opts = {}) {
  if (!isNonEmptyString(archDir)) {
    throw new TypeError('plan-gate: archDir must be a non-empty string');
  }

  const decision = Object.prototype.hasOwnProperty.call(opts, 'decision') ? opts.decision : 'approved';
  if (!GATE_DECISIONS.has(decision)) {
    throw new TypeError(
      `plan-gate: decision must be one of ${[...GATE_DECISIONS].join(', ')} (got ${JSON.stringify(decision)})`
    );
  }

  const decisionSource = Object.prototype.hasOwnProperty.call(opts, 'decision_source')
    ? opts.decision_source
    : 'operator';
  if (!DECISION_SOURCES.has(decisionSource)) {
    throw new TypeError(
      `plan-gate: decision_source must be one of ${[...DECISION_SOURCES].join(', ')} (got ${JSON.stringify(decisionSource)})`
    );
  }

  for (const relFile of CANONICAL_ARCHITECTURE_ARTIFACTS) {
    if (!fs.existsSync(path.join(archDir, relFile))) {
      throw new Error(
        `plan-gate: required architecture artifact "${relFile}" is missing from ${archDir} — author it before gating`
      );
    }
  }

  // Semantic sealing (P6 Sol review BLOCKING #1/#3) — before any manifest or
  // gate byte is written, not after. A throw here leaves archDir exactly as
  // it was: no manifest.json, no gate.json, no ledger record.
  assertSemanticallyValid(archDir);

  const manifestPath = path.join(archDir, 'manifest.json');
  const manifest = writeManifest(archDir, CANONICAL_ARCHITECTURE_ARTIFACTS, manifestPath, opts.revision);
  const manifestDigest = sha256Of(manifestPath);

  const decidedAt = new Date().toISOString();
  const gatePath = path.join(archDir, 'gate.json');
  const gate = {
    schema_version: SCHEMA_VERSION,
    decision,
    manifest_digest: manifestDigest,
    decided_at: decidedAt,
    decision_source: decisionSource,
  };
  writeAtomic(gatePath, gate);

  // Gate-forgery close (P6 Sol review BLOCKING #1): the tamper-evident
  // evidence trail check-honesty.js's verifyArchitectureGateApproved
  // cross-checks gate.json against. archDir is always the tree-relative
  // canonical `<treeRoot>/architecture` (this module's own header comment;
  // check-honesty.js's checkArchitectureManifest derives the same ledger
  // path the same way), so ledger.jsonl is archDir's own parent sibling —
  // never a caller-supplied path that could be pointed elsewhere to dodge
  // the cross-check.
  const ledgerPath = path.join(path.dirname(archDir), 'ledger.jsonl');
  const ledgerSeq = appendRecord(ledgerPath, {
    kind: PLAN_GATE_DECISION_KIND,
    payload: { decision, decision_source: decisionSource, manifest_digest: manifestDigest, decided_at: decidedAt },
    correlation_id: null,
  });

  return { manifest, manifestPath, gate, gatePath, manifestDigest, ledgerPath, ledgerSeq, created: [manifestPath, gatePath] };
}

// verifyGate(archDir) -> {ok, reasons[]}. Re-verifies the full digest chain
// (gate.json's manifest_digest -> manifest.json's own bytes -> manifest.json's
// declared artifacts -> the five content artifacts on disk) via
// check-honesty.js's verifyArchitectureGateApproved, which already fails
// closed on a missing/non-approved/digest-drifted gate. Renamed
// `violations` -> `reasons` at this boundary only to match this module's own
// return-shape contract; the underlying check is not duplicated.
function verifyGate(archDir) {
  if (!isNonEmptyString(archDir)) {
    throw new TypeError('plan-gate: archDir must be a non-empty string');
  }
  const { ok, violations } = verifyArchitectureGateApproved(archDir);
  return { ok, reasons: violations };
}

function parseArgv(argv) {
  const [command, archDir, ...rest] = argv;
  let decision;
  let source;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--decision') {
      decision = rest[i + 1];
      i++;
    } else if (rest[i] === '--source') {
      source = rest[i + 1];
      i++;
    }
  }
  return { command, archDir, decision, source };
}

function main(argv) {
  const { command, archDir, decision, source } = parseArgv(argv);
  if (!command || !archDir) {
    process.stderr.write('usage: plan-gate.js <approve|verify> <archDir> [--decision X --source Y]\n');
    process.exit(1);
    return;
  }
  try {
    if (command === 'approve') {
      const opts = {};
      if (decision !== undefined) opts.decision = decision;
      if (source !== undefined) opts.decision_source = source;
      const { gate, manifestPath, gatePath } = approveGate(archDir, opts);
      console.log(JSON.stringify({ manifestPath, gatePath, gate }, null, 2));
      process.exit(0);
    } else if (command === 'verify') {
      const { ok, reasons } = verifyGate(archDir);
      for (const reason of reasons) console.log(reason);
      if (ok) console.log('plan-gate: OK');
      process.exit(ok ? 0 : 1);
    } else {
      throw new Error(`unknown command "${command}" (expected approve or verify)`);
    }
  } catch (err) {
    process.stderr.write(`plan-gate.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { approveGate, verifyGate, DECISION_SOURCES };
