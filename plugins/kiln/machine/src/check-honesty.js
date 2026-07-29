'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { readJson } = require('./atomic-json.js');
const { readAll } = require('./jsonl.js');
const { appendRecord, ISO_8601_UTC_RE } = require('./stream.js');
const { verifyManifest, CANONICAL_ARCHITECTURE_ARTIFACTS } = require('./manifest.js');
const { validateDeviation, DEVIATION_FIELDS } = require('./validators.js');

const MISSING_STATE = Symbol('check-honesty.missing-state');
const GATE_DECISIONS = new Set(['approved', 'auto-approved', 'rejected', 'reopened']);
const APPROVED_DECISIONS = new Set(['approved', 'auto-approved']);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

// The sanctioned gate.json schema version and decision_source vocabulary
// (P6 Sol review BLOCKING #1: "the verifier trusts any sanctioned
// gate.decision and never validates decision_source, schema_version,
// decided_at, or evidence that the decision was emitted by the sanctioned
// producer"). Owned HERE, the verifier module, rather than in plan-gate.js —
// plan-gate.js already requires this module (verifyArchitectureGateApproved,
// GATE_DECISIONS), so the reverse import would cycle; a producer importing
// its vocabulary from the verifier that checks it is also the more honest
// direction, the same relationship GATE_DECISIONS already has here.
const GATE_SCHEMA_VERSION = 1;
const DECISION_SOURCES = new Set(['operator', 'configured-policy']);
const PLAN_GATE_DECISION_KIND = 'plan-gate-decision';

function isRecordObject(record) {
  return record !== null && typeof record === 'object' && !Array.isArray(record);
}

function isValidSeq(seq) {
  return typeof seq === 'number' && Number.isInteger(seq) && seq >= 0 && seq <= Number.MAX_SAFE_INTEGER;
}

function sha256Of(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

// The latest ledger record for a gate_id, by seq, among records that carry a
// well-formed seq. A record without one cannot establish "latest" and cannot
// serve as evidence (see the malformed-seq violation loop in checkHonesty).
function latestGateRecord(ledgerRecords, gateId) {
  let latest = null;
  for (const record of ledgerRecords) {
    if (!isRecordObject(record)) continue;
    if (record.kind !== 'gate' || record.gate_id !== gateId) continue;
    if (!isValidSeq(record.seq)) continue;
    if (latest === null || record.seq > latest.seq) latest = record;
  }
  return latest;
}

// Some historical ledger records (P9-era and the P11 gate-evidence run) were
// written with "command" instead of the schema's "cmd". Read tolerance only:
// "cmd" wins when a record carries both, "command" is accepted when "cmd" is
// absent. Sanctioned writers (runGate) still emit only "cmd" for new events.
function ledgerRecordCmd(record) {
  return typeof record.cmd === 'string' ? record.cmd : record.command;
}

// Evidence is honest only when the LATEST ledger record for this exact gate
// both succeeded and names the same command the state declares for it. This
// closes two holes at once: a stale success cannot paper over a later
// failure (only the latest record counts), and a record cannot certify a
// command other than the one actually required (cmd must match).
function hasGateEvidence(ledgerRecords, gateId, expectedCmd) {
  const latest = latestGateRecord(ledgerRecords, gateId);
  return latest !== null && latest.exit_code === 0 && ledgerRecordCmd(latest) === expectedCmd;
}

// The latest ledger record of kind "plan-gate-decision" — the evidence trail
// approveGate() (plan-gate.js) appends alongside gate.json itself. Same
// latest-by-seq discipline as latestGateRecord: a record without a
// well-formed seq cannot establish "latest" and cannot serve as evidence.
function latestPlanGateDecisionRecord(ledgerRecords) {
  let latest = null;
  for (const record of ledgerRecords) {
    if (!isRecordObject(record)) continue;
    if (record.kind !== PLAN_GATE_DECISION_KIND) continue;
    if (!isValidSeq(record.seq)) continue;
    if (latest === null || record.seq > latest.seq) latest = record;
  }
  return latest;
}

function findGateCmd(gates, gateName) {
  for (const entry of gates) {
    if (isRecordObject(entry) && entry.name === gateName) {
      return typeof entry.cmd === 'string' && entry.cmd !== '' ? entry.cmd : null;
    }
  }
  return null;
}

// Post-architecture-boundary cross-check (synthesis §3/§4): when gate.json
// records an APPROVED decision, the artifacts it approved must still match
// the digests frozen in the manifest.json it is bound to. Fails closed — an
// unreadable/missing manifest, a digest-unbound manifest, or a manifest that
// doesn't declare EXACTLY the canonical artifact set while gate says
// approved is itself a violation, never a silent skip.
//
// architectureDir is always the tree-relative canonical location, derived
// from statePath rather than accepted as an optional caller argument
// (review [blocker] #1: an optional arg is an escape hatch — omitting it
// used to skip the whole cross-check).
//
// opts.requireApproved (default false) selects which of two callers this
// serves — the same digest/canonical-set/drift logic underneath either way
// (one source of truth, per the anti-redundant-enforcement rule):
//   false — checkHonesty()'s own audit: state.json makes no claim about the
//           gate, so an absent gate.json or a rejected/reopened decision is
//           simply nothing to cross-check yet, not a violation.
//   true  — verifyArchitectureGateApproved()'s stricter question, asked at
//           the plan_gate -> implementation phase-entry boundary (P2 review
//           [blocker] #1): is there CURRENTLY an approved, digest-matched
//           gate? Here an absent gate.json or a non-approved decision IS
//           itself the violation — implementation must structurally refuse
//           to start otherwise (synthesis §3/§4).
function checkArchitectureManifest(architectureDir, violations, opts = {}) {
  const requireApproved = opts.requireApproved === true;
  const gatePath = path.join(architectureDir, 'gate.json');
  const MISSING_GATE = Symbol('check-honesty.missing-gate');

  let gate;
  try {
    gate = readJson(gatePath, MISSING_GATE);
  } catch (err) {
    violations.push(`architecture gate: failed to read/parse ${gatePath}: ${err.message}`);
    return;
  }
  if (gate === MISSING_GATE) {
    if (requireApproved) {
      violations.push(`architecture gate: ${gatePath} not found — implementation may not begin without an approved gate`);
    }
    return; // no gate yet: nothing to cross-check (unless requireApproved, handled above)
  }
  if (!isRecordObject(gate)) {
    violations.push(`architecture gate: ${gatePath} must be a JSON object`);
    return;
  }

  if (!GATE_DECISIONS.has(gate.decision)) {
    violations.push(
      `architecture gate: ${gatePath} has an invalid "decision" (must be one of ${[...GATE_DECISIONS].join(', ')})`
    );
    return;
  }
  if (!APPROVED_DECISIONS.has(gate.decision)) {
    if (requireApproved) {
      violations.push(
        `architecture gate: ${gatePath} reports decision="${gate.decision}" — implementation may not begin without an approved gate`
      );
    }
    return; // rejected/reopened: nothing approved to cross-check (unless requireApproved, handled above)
  }

  // Gate-forgery close (P6 Sol review BLOCKING #1): a decision reaching
  // APPROVED_DECISIONS is not, by itself, evidence the decision was ever
  // emitted by approveGate() — a probe that hand-edits gate.json's own bytes
  // (`decision: "approved", decision_source: "forged"`) previously passed
  // this function outright, because nothing past this point re-derived
  // "approved" from anything but gate.json's own say-so. Two independent
  // checks close that: (1) gate.json's own provenance fields must themselves
  // be well-formed — a schema this module actually owns (GATE_SCHEMA_VERSION,
  // DECISION_SOURCES), never merely "some string"; (2) gate.json's decision
  // fields must match the LATEST "plan-gate-decision" ledger record
  // approveGate() appends via stream.appendRecord — a record gate.json's own
  // author (a Bash-capable worker or the plan-gate CLI) cannot rewrite
  // without also rewriting an append-only, single-writer JSONL stream in a
  // way the seq/ordering checks above would themselves catch. Both checks are
  // deliberately non-blocking (pushed, not returned) so a malformed-provenance
  // gate still gets every other violation this function would otherwise
  // report — reasons accumulate, they don't short-circuit each other.
  if (gate.schema_version !== GATE_SCHEMA_VERSION) {
    violations.push(`architecture gate: ${gatePath} must declare schema_version ${GATE_SCHEMA_VERSION} (got ${JSON.stringify(gate.schema_version)})`);
  }
  if (!DECISION_SOURCES.has(gate.decision_source)) {
    violations.push(
      `architecture gate: ${gatePath} has an invalid "decision_source" (must be one of ${[...DECISION_SOURCES].join(', ')}, got ${JSON.stringify(gate.decision_source)})`
    );
  }
  if (
    typeof gate.decided_at !== 'string' ||
    !ISO_8601_UTC_RE.test(gate.decided_at) ||
    Number.isNaN(Date.parse(gate.decided_at))
  ) {
    violations.push(`architecture gate: ${gatePath} declares no valid "decided_at" ISO-8601 UTC timestamp`);
  }

  const ledgerPath = path.join(path.dirname(architectureDir), 'ledger.jsonl');
  const { records: ledgerRecords } = readAll(ledgerPath);
  const decisionRecord = latestPlanGateDecisionRecord(ledgerRecords);
  if (decisionRecord === null) {
    violations.push(
      `architecture gate: no "${PLAN_GATE_DECISION_KIND}" ledger record found at ${ledgerPath} to corroborate ${gatePath} — an approval with no evidence trail is not trusted`
    );
  } else {
    const mismatched = ['decision', 'decision_source', 'manifest_digest', 'decided_at'].filter(
      (field) => decisionRecord[field] !== gate[field]
    );
    if (mismatched.length > 0) {
      violations.push(
        `architecture gate: ${gatePath} does not match the latest "${PLAN_GATE_DECISION_KIND}" ledger record (mismatched: ${mismatched.join(', ')}) — possible forged gate flip`
      );
    }
  }

  const manifestDigest = gate.manifest_digest;
  if (typeof manifestDigest !== 'string' || !DIGEST_RE.test(manifestDigest)) {
    violations.push(
      `architecture gate: ${gatePath} reports decision="${gate.decision}" but declares no valid "manifest_digest"`
    );
    return;
  }

  const manifestPath = path.join(architectureDir, 'manifest.json');
  const MISSING_MANIFEST = Symbol('check-honesty.missing-manifest');
  let manifestObj;
  try {
    manifestObj = readJson(manifestPath, MISSING_MANIFEST);
  } catch (err) {
    violations.push(
      `architecture manifest: failed to read/parse ${manifestPath} while gate reports decision="${gate.decision}": ${err.message}`
    );
    return;
  }
  if (manifestObj === MISSING_MANIFEST) {
    violations.push(`architecture manifest: ${manifestPath} not found while gate reports decision="${gate.decision}"`);
    return;
  }

  // The gate's manifest_digest must match manifest.json's OWN bytes on disk
  // — this is what stops a rewritten/shrunk manifest.json from being
  // silently re-trusted after approval (review [blocker] #2): swapping the
  // file changes its digest, which no longer matches what was approved.
  const actualManifestDigest = sha256Of(manifestPath);
  if (actualManifestDigest !== manifestDigest) {
    violations.push(
      `architecture manifest: ${manifestPath} digest ${actualManifestDigest} does not match gate.json's approved manifest_digest ${manifestDigest}`
    );
    return;
  }

  if (!isRecordObject(manifestObj) || !Array.isArray(manifestObj.artifacts)) {
    violations.push(`architecture manifest: ${manifestPath} must be an object with an "artifacts" array`);
    return;
  }

  // The manifest must declare EXACTLY the canonical artifact set — no
  // missing, no duplicate, no unexpected paths — so an approval can never be
  // laundered through a manifest that quietly drops entries (review
  // [blocker] #2).
  const declaredPaths = manifestObj.artifacts
    .map((entry) => (entry !== null && typeof entry === 'object' ? entry.path : undefined))
    .filter((p) => typeof p === 'string');
  const declaredSet = new Set(declaredPaths);
  const duplicates = declaredPaths.filter((p, i) => declaredPaths.indexOf(p) !== i);
  for (const dup of new Set(duplicates)) {
    violations.push(`architecture manifest: "${dup}" is declared more than once in ${manifestPath}`);
  }
  for (const required of CANONICAL_ARCHITECTURE_ARTIFACTS) {
    if (!declaredSet.has(required)) {
      violations.push(`architecture manifest: ${manifestPath} is missing required artifact "${required}"`);
    }
  }
  for (const declared of declaredSet) {
    if (!CANONICAL_ARCHITECTURE_ARTIFACTS.includes(declared)) {
      violations.push(`architecture manifest: ${manifestPath} declares unexpected artifact "${declared}"`);
    }
  }

  let result;
  try {
    result = verifyManifest(architectureDir, manifestObj);
  } catch (err) {
    violations.push(`architecture manifest: failed to verify ${manifestPath}: ${err.message}`);
    return;
  }
  for (const d of result.drift) {
    violations.push(`architecture artifact drift: "${d.file}" (${d.reason})`);
  }
}

// Stricter, standalone form of the same architecture-gate check, asked as an
// unconditional question rather than a conditional-on-a-claim one: "is
// implementation currently allowed to begin?" Used by
// machine/src/phases.js's "architecture-gate-approved" entry check (P2
// review [blocker] #1) — never duplicated there, since duplicating this
// digest/canonical-set/drift logic in two modules is exactly what the
// anti-redundant-enforcement rule forbids.
function verifyArchitectureGateApproved(architectureDir) {
  const violations = [];
  checkArchitectureManifest(architectureDir, violations, { requireApproved: true });
  return { ok: violations.length === 0, violations };
}

function checkHonesty({ statePath, ledgerPath }) {
  // Fail closed: state defines what is expected, so a missing, non-object,
  // or malformed-obligations state cannot be treated as "nothing to check".
  const state = readJson(statePath, MISSING_STATE);
  if (state === MISSING_STATE) {
    return { ok: false, violations: [`state: file not found at ${statePath}`] };
  }
  if (!isRecordObject(state)) {
    return { ok: false, violations: [`state: must be a JSON object at ${statePath}`] };
  }

  const violations = [];

  // gates/checklist are OPTIONAL: synthesis §2's state.json schema carries
  // no such fields at all (they are a proof-of-work overlay this module
  // adds on top). A freshly scaffolded tree's state.json has neither key and
  // that is honest — zero obligations declared, zero evidence required. Only
  // a PRESENT-but-wrong-typed value fails closed; absence does not (review
  // [major] "scaffold and check-honesty disagree on the state contract").
  const gatesPresent = Object.prototype.hasOwnProperty.call(state, 'gates');
  const gatesOk = !gatesPresent || Array.isArray(state.gates);
  if (!gatesOk) violations.push('state.gates must be an array when present');
  const checklistPresent = Object.prototype.hasOwnProperty.call(state, 'checklist');
  const checklistOk = !checklistPresent || Array.isArray(state.checklist);
  if (!checklistOk) violations.push('state.checklist must be an array when present');

  const { records: ledgerRecords, errors: ledgerErrors } = readAll(ledgerPath);

  for (const err of ledgerErrors) {
    violations.push(`ledger: malformed line ${err.lineNo}: ${err.reason}`);
  }

  // Every ledger record must be an object carrying a well-formed,
  // nonnegative safe-integer seq to participate in a verdict at all: a
  // record silently skipped here would also be silently unusable as
  // evidence, and unique/non-decreasing order is checked only among records
  // that passed this gate.
  const seenSeqs = new Set();
  let lastSeq;
  let hasLastSeq = false;
  ledgerRecords.forEach((record, index) => {
    if (!isRecordObject(record)) {
      violations.push(`ledger: record at index ${index} is not an object`);
      return;
    }
    if (!isValidSeq(record.seq)) {
      violations.push(`ledger: record at index ${index} has a missing or invalid seq`);
      return;
    }
    const seq = record.seq;
    if (seenSeqs.has(seq)) {
      violations.push(`ledger: duplicate seq value ${seq}`);
    } else {
      seenSeqs.add(seq);
    }
    if (hasLastSeq && seq < lastSeq) {
      violations.push(`ledger: seq value ${seq} is out of order (follows ${lastSeq})`);
    }
    lastSeq = seq;
    hasLastSeq = true;
  });

  const gates = gatesOk && gatesPresent ? state.gates : [];

  // (a) every gate reporting last_result === 'pass' needs matching, cmd-bound
  // ledger evidence.
  for (const entry of gates) {
    if (isRecordObject(entry) && entry.last_result === 'pass') {
      const gateId = entry.name;
      const cmd = findGateCmd(gates, gateId);
      if (cmd === null) {
        violations.push(`gate "${gateId}" reports last_result=pass but declares no "cmd"`);
        continue;
      }
      if (!hasGateEvidence(ledgerRecords, gateId, cmd)) {
        violations.push(
          `gate "${gateId}" reports last_result=pass without a matching ledger record (kind=gate, gate_id=${gateId}, cmd=${JSON.stringify(cmd)}, exit_code=0)`
        );
      }
    }
  }

  // (b) a checklist item verified done can never opt out of proof: the
  // "gate" field is mandatory whenever verified+done, not merely checked
  // when present.
  const checklist = checklistOk && checklistPresent ? state.checklist : [];
  for (const item of checklist) {
    if (isRecordObject(item) && item.verified === true && item.status === 'done') {
      const gateId = item.gate;
      if (typeof gateId !== 'string' || gateId === '') {
        violations.push('checklist item is verified done but names no "gate" to prove it');
        continue;
      }
      const cmd = findGateCmd(gates, gateId);
      if (cmd === null) {
        violations.push(`checklist item gated on "${gateId}" references a gate with no declared "cmd"`);
        continue;
      }
      if (!hasGateEvidence(ledgerRecords, gateId, cmd)) {
        violations.push(
          `checklist item gated on "${gateId}" is verified done without a matching ledger record (kind=gate, gate_id=${gateId}, cmd=${JSON.stringify(cmd)}, exit_code=0)`
        );
      }
    }
  }

  // architectureDir is ALWAYS the canonical sibling of statePath — never an
  // optional argument the caller can omit to skip the check (review
  // [blocker] #1).
  const architectureDir = path.join(path.dirname(statePath), 'architecture');
  checkArchitectureManifest(architectureDir, violations);

  return { ok: violations.length === 0, violations };
}

// The sole sanctioned producer of gate evidence. It actually executes cmd
// and records the exit code the process really returned rather than
// accepting a caller-supplied exit_code, so evidence can no longer be
// hand-authored the way a generic ledger append previously allowed. Writes
// through stream.appendRecord (the common JSONL header wrapper) rather than
// jsonl.appendEvent directly, so ledger.jsonl — one of the nine named
// streams synthesis §2 binds to the common header — never mixes
// header-complete and header-bare records (review [major] "the common JSONL
// header is not applied to all nine streams").
function runGate({ gateId, cmd, ledgerPath }) {
  if (typeof gateId !== 'string' || gateId === '') {
    throw new TypeError('runGate: gateId must be a non-empty string');
  }
  if (typeof cmd !== 'string' || cmd === '') {
    throw new TypeError('runGate: cmd must be a non-empty string');
  }
  if (typeof ledgerPath !== 'string' || ledgerPath === '') {
    throw new TypeError('runGate: ledgerPath must be a non-empty string');
  }
  const outcome = spawnSync(cmd, { shell: true, encoding: 'utf8' });
  const exitCode = outcome.status === null ? 1 : outcome.status; // signal-killed -> treated as failure
  const seq = appendRecord(ledgerPath, {
    kind: 'gate',
    payload: { gate_id: gateId, cmd, exit_code: exitCode },
    correlation_id: gateId,
  });
  return { gateId, cmd, exitCode, seq, stdout: outcome.stdout, stderr: outcome.stderr };
}

// The sole sanctioned producer of deviation evidence (P11 finding F12): a
// generic, unvalidated ledger.jsonl append was deliberately never exposed —
// runGate's own header comment names exactly why ("evidence can no longer be
// hand-authored the way a generic ledger append previously allowed"), and a
// deviation record deserves the same one-sanctioned-writer discipline, not a
// second exemption from it. validateDeviation enforces the shape
// (reported_by/expected/actual/summary, all non-empty strings, no
// unexpected keys) before anything reaches disk; a caller with a malformed
// report gets a thrown TypeError naming exactly which field is wrong, the
// same "fails closed rather than silently reshaping" posture every other
// record* function in this tree already holds.
function recordDeviation({ reportedBy, expected, actual, summary, ledgerPath, correlationId } = {}) {
  const deviation = { reported_by: reportedBy, expected, actual, summary };
  const { ok, errors } = validateDeviation(deviation);
  if (!ok) {
    throw new TypeError(`recordDeviation: invalid deviation — ${errors.join('; ')}`);
  }
  if (typeof ledgerPath !== 'string' || ledgerPath === '') {
    throw new TypeError('recordDeviation: ledgerPath must be a non-empty string');
  }
  const seq = appendRecord(ledgerPath, {
    kind: 'deviation',
    payload: deviation,
    correlation_id: correlationId !== undefined ? correlationId : null,
  });
  return { seq, deviation };
}

// CLI entrypoint. Three shapes: the original two-positional-argument audit
// form (`checkHonesty`, unchanged), `record-deviation <ledgerPath>` (P11
// finding F12's adjacent defect: recordDeviation had no invocation form a
// Bash-only worker could actually call), and `run-gate <ledgerPath>` (P11
// convergence finding 3: agents/security-scanner.md's own scan commands
// name runGate as their one sanctioned command-execution-plus-evidence
// mechanism, but a Bash-only worker had no way to reach it — this is the
// narrow form it needs: `{gateId, cmd}` via stdin, never a generic "run any
// command" surface beyond what runGate itself already sanctions and
// evidences). Both stdin-consuming subcommands read the judge-verdict.js
// stdin pattern.
function main(argv) {
  if (argv[0] === 'run-gate') {
    const ledgerPath = argv[1];
    if (typeof ledgerPath !== 'string' || ledgerPath === '') {
      process.stderr.write('usage: check-honesty.js run-gate <ledgerPath>   ({gateId, cmd} JSON piped via stdin)\n');
      process.exit(1);
    }
    try {
      const bodyText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch (err) {
        throw new Error(`run-gate: {gateId, cmd} JSON via stdin is not valid JSON: ${err.message}`);
      }
      if (!isRecordObject(parsed)) {
        throw new Error('run-gate: {gateId, cmd} JSON via stdin must be a JSON object');
      }
      const result = runGate({ gateId: parsed.gateId, cmd: parsed.cmd, ledgerPath });
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (err) {
      process.stderr.write(`check-honesty.js: ${err.message}\n`);
      process.exit(1);
    }
  }

  if (argv[0] === 'record-deviation') {
    const ledgerPath = argv[1];
    if (typeof ledgerPath !== 'string' || ledgerPath === '') {
      process.stderr.write('usage: check-honesty.js record-deviation <ledgerPath>   (deviation JSON piped via stdin)\n');
      process.exit(1);
    }
    try {
      const deviationText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
      const parsed = JSON.parse(deviationText);
      if (!isRecordObject(parsed)) {
        throw new Error('record-deviation: deviation JSON via stdin must be a JSON object');
      }
      // CLI adapter parity (P11 Sol review finding 5): recordDeviation below
      // only ever reconstructs {reported_by, expected, actual, summary} from
      // named fields, so an extra key on the raw parsed input would
      // otherwise never reach validateDeviation's own extra-key check at
      // all — the adapter validates the PARSED object's actual key set
      // itself, before any reconstruction happens.
      const allowedKeys = new Set([...DEVIATION_FIELDS, 'correlation_id']);
      const extraKeys = Object.keys(parsed).filter((key) => !allowedKeys.has(key));
      if (extraKeys.length > 0) {
        throw new Error(`record-deviation: deviation JSON via stdin carries unexpected key(s): ${extraKeys.join(', ')}`);
      }
      const { seq, deviation } = recordDeviation({
        reportedBy: parsed.reported_by,
        expected: parsed.expected,
        actual: parsed.actual,
        summary: parsed.summary,
        ledgerPath,
        correlationId: parsed.correlation_id,
      });
      console.log(JSON.stringify({ seq, deviation }, null, 2));
      process.exit(0);
    } catch (err) {
      process.stderr.write(`check-honesty.js: ${err.message}\n`);
      process.exit(1);
    }
  }

  const [statePath, ledgerPath] = argv;
  if (!statePath || !ledgerPath) {
    process.stderr.write('usage: check-honesty.js <statePath> <ledgerPath>\n');
    process.exit(1);
  }
  const { ok, violations } = checkHonesty({ statePath, ledgerPath });
  for (const violation of violations) {
    console.log(violation);
  }
  if (ok) {
    console.log('check-honesty: OK');
  }
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  checkHonesty,
  runGate,
  recordDeviation,
  verifyArchitectureGateApproved,
  GATE_DECISIONS,
  APPROVED_DECISIONS,
  GATE_SCHEMA_VERSION,
  DECISION_SOURCES,
  PLAN_GATE_DECISION_KIND,
};
