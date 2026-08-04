'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { approveGate, verifyGate } = require('../src/plan-gate.js');
const { CANONICAL_ARCHITECTURE_ARTIFACTS } = require('../src/manifest.js');
const { readAll } = require('../src/jsonl.js');
const { writeConstraints } = require('../src/scout.js');
const { writeValidContentArtifacts, validMilestones } = require('./fixtures/valid-architecture-artifacts.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'plan-gate.js');

function mkTmpArchDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-test-'));
  const archDir = path.join(dir, 'architecture');
  fs.mkdirSync(archDir, { recursive: true });
  return archDir;
}

// Arbitrary-text content — sufficient to satisfy approveGate's up-front
// existence check, never sufficient to pass its semantic sealing check. Used
// only by tests that fail (or expect to fail) BEFORE semantic validation
// ever runs — decision/decision_source vocabulary checks, missing-archDir
// checks — and by post-approval drift tampering, which is a purely
// digest-based check with no semantic re-validation.
function writeContentArtifacts(archDir) {
  for (const relFile of CANONICAL_ARCHITECTURE_ARTIFACTS) {
    fs.writeFileSync(path.join(archDir, relFile), `content of ${relFile}\n`);
  }
}

function sha256(buf) {
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

// ---------- approveGate ----------

test('approveGate throws when a required content artifact is missing', () => {
  const archDir = mkTmpArchDir();
  assert.throws(() => approveGate(archDir), /plan\.md/);
});

test('approveGate builds manifest.json over the five content artifacts and writes a bound gate.json', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);

  const { manifest, manifestPath, gate, gatePath, manifestDigest, created } = approveGate(archDir);

  assert.equal(fs.existsSync(manifestPath), true);
  assert.equal(fs.existsSync(gatePath), true);
  assert.deepEqual(created, [manifestPath, gatePath]);
  assert.deepEqual(
    manifest.artifacts.map((a) => a.path).sort(),
    [...CANONICAL_ARCHITECTURE_ARTIFACTS].sort()
  );

  assert.equal(gate.schema_version, 1);
  assert.equal(gate.decision, 'approved');
  assert.equal(gate.decision_source, 'operator');
  assert.equal(gate.manifest_digest, manifestDigest);
  assert.match(manifestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(manifestDigest, sha256(fs.readFileSync(manifestPath)));

  const onDiskGate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.deepEqual(onDiskGate, gate);
});

test('approveGate honors an explicit decision and decision_source', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);

  const { gate } = approveGate(archDir, { decision: 'auto-approved', decision_source: 'configured-policy' });
  assert.equal(gate.decision, 'auto-approved');
  assert.equal(gate.decision_source, 'configured-policy');
});

test('approveGate rejects an unsanctioned decision value', () => {
  const archDir = mkTmpArchDir();
  writeContentArtifacts(archDir);
  assert.throws(() => approveGate(archDir, { decision: 'maybe' }), TypeError);
});

test('approveGate rejects an unsanctioned decision_source value', () => {
  const archDir = mkTmpArchDir();
  writeContentArtifacts(archDir);
  assert.throws(() => approveGate(archDir, { decision_source: 'vibes' }), TypeError);
});

test('approveGate throws TypeError for a non-string archDir', () => {
  assert.throws(() => approveGate(undefined), TypeError);
  assert.throws(() => approveGate(''), TypeError);
});

// ---------- semantic sealing (P6 Sol review BLOCKING #1/#3) ----------
// approveGate used to prove only byte stability — the five canonical paths
// existing. These prove it now re-validates content BEFORE writing anything,
// and that a failure leaves archDir exactly as it was (no manifest.json, no
// gate.json).

test('approveGate rejects an empty criteria register and writes no gate', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  fs.writeFileSync(path.join(archDir, 'criteria-register.json'), JSON.stringify({ schema_version: 1, criteria: [] }));

  assert.throws(() => approveGate(archDir), /criteria-register\.json failed validation/);
  assert.equal(fs.existsSync(path.join(archDir, 'manifest.json')), false);
  assert.equal(fs.existsSync(path.join(archDir, 'gate.json')), false);
});

test('approveGate rejects criteria-register.json that is not valid JSON', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  fs.writeFileSync(path.join(archDir, 'criteria-register.json'), 'not json at all');

  assert.throws(() => approveGate(archDir), /criteria-register\.json is not valid JSON/);
  assert.equal(fs.existsSync(path.join(archDir, 'gate.json')), false);
});

test('approveGate rejects milestones.json that references an unknown criterion (cross-check runs before sealing)', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  const badMilestones = validMilestones();
  badMilestones.milestones[0].criteria_ids = ['ACR-GHOST'];
  fs.writeFileSync(path.join(archDir, 'milestones.json'), JSON.stringify(badMilestones));

  assert.throws(() => approveGate(archDir), /milestones\.json failed validation.*unknown criterion/s);
  assert.equal(fs.existsSync(path.join(archDir, 'gate.json')), false);
});

test('approveGate rejects an artifact-map.json with an empty "artifacts" array', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  fs.writeFileSync(path.join(archDir, 'artifact-map.json'), JSON.stringify({ artifacts: [] }));

  assert.throws(() => approveGate(archDir), /artifact-map\.json must be an object with a non-empty "artifacts" array/);
  assert.equal(fs.existsSync(path.join(archDir, 'gate.json')), false);
});

test('approveGate rejects an artifact-map.json that is not an object with an "artifacts" array', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  fs.writeFileSync(path.join(archDir, 'artifact-map.json'), JSON.stringify(['nope']));

  assert.throws(() => approveGate(archDir), /artifact-map\.json must be an object/);
});

test('approveGate rejects an empty protocol-record.md', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  fs.writeFileSync(path.join(archDir, 'protocol-record.md'), '   \n  \n');

  assert.throws(() => approveGate(archDir), /protocol-record\.md is empty/);
  assert.equal(fs.existsSync(path.join(archDir, 'gate.json')), false);
});

test('approveGate rejects a protocol-record.md that names no planning protocol', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  fs.writeFileSync(path.join(archDir, 'protocol-record.md'), '# Protocol record\n\nSomething happened.\n');

  assert.throws(() => approveGate(archDir), /does not name a planning protocol/);
  assert.equal(fs.existsSync(path.join(archDir, 'gate.json')), false);
});

for (const protocol of ['standard', 'deep_scrutiny', 'Deep Scrutiny', 'maximal_confrontation', 'MAXIMAL CONFRONTATION']) {
  test(`approveGate accepts a protocol-record.md naming "${protocol}"`, () => {
    const archDir = mkTmpArchDir();
    writeValidContentArtifacts(archDir);
    fs.writeFileSync(path.join(archDir, 'protocol-record.md'), `# Protocol record\n\nProtocol: ${protocol}.\n`);

    assert.doesNotThrow(() => approveGate(archDir));
  });
}

test('approveGate seals successfully once all five artifacts are semantically valid', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  const { gate } = approveGate(archDir);
  assert.equal(gate.decision, 'approved');
  assert.equal(fs.existsSync(path.join(archDir, 'manifest.json')), true);
});

// ---------- protected-path conflict check (vision.md §5 [seq 50],
// research/p10/agreement-pass-triggers.md §4/§6) ----------
// "a plan touching a path in scout's protected_paths[] IS a block, detected
// deterministically by set-intersection at the plan gate (fail-closed seal
// refusal), never by model judgment." These exercise the check entirely
// through approveGate() — the same sealing entry point every other semantic
// check above goes through — never a direct call into plan-gate.js's
// internal helpers, matching this file's existing convention of testing the
// public surface only.

function protectedPathsConstraints(entries) {
  return {
    schema_version: 1,
    revision: 1,
    preserve: [],
    protected_paths: entries,
    compatibility: [],
    migrations: [],
    known_failures: [],
  };
}

test('approveGate: greenfield (no scout/ directory at all) is unaffected', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  // No scout/constraints.json anywhere under treeRoot — the vacuous-pass
  // case. Sealing succeeds even though milestones.json declares no
  // touched_paths, exactly as it did before this check existed.
  const { gate } = approveGate(archDir);
  assert.equal(gate.decision, 'approved');
});

test('approveGate: an empty protected_paths[] is a vacuous pass, no touched_paths required', () => {
  const archDir = mkTmpArchDir();
  const treeRoot = path.dirname(archDir);
  writeValidContentArtifacts(archDir);
  writeConstraints(treeRoot, protectedPathsConstraints([]));

  const { gate } = approveGate(archDir);
  assert.equal(gate.decision, 'approved');
});

test('approveGate refuses to seal when protected_paths is non-empty and milestones.json declares no touched_paths', () => {
  const archDir = mkTmpArchDir();
  const treeRoot = path.dirname(archDir);
  writeValidContentArtifacts(archDir);
  writeConstraints(
    treeRoot,
    protectedPathsConstraints([
      {
        trust_flag: 'inherited-unverified',
        path: 'src/legacy',
        anchor: 'src/legacy/index.js:1',
        note: 'legacy auth module — operator sign-off required before touching',
      },
    ])
  );

  assert.throws(() => approveGate(archDir), /milestones\.json failed validation.*touched_paths.*required/s);
  assert.equal(fs.existsSync(path.join(archDir, 'gate.json')), false);
});

test('approveGate refuses to seal on an exact-path conflict, naming the conflicting path plus the entry\'s anchor and note', () => {
  const archDir = mkTmpArchDir();
  const treeRoot = path.dirname(archDir);
  writeValidContentArtifacts(archDir);
  const ms = validMilestones();
  ms.touched_paths = ['src/legacy/index.js', 'docs/readme.md'];
  fs.writeFileSync(path.join(archDir, 'milestones.json'), JSON.stringify(ms));
  writeConstraints(
    treeRoot,
    protectedPathsConstraints([
      {
        trust_flag: 'inherited-unverified',
        path: 'src/legacy/index.js',
        anchor: 'src/legacy/index.js:1',
        note: 'legacy auth module — operator sign-off required before touching',
      },
    ])
  );

  let thrown;
  try {
    approveGate(archDir);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, 'expected approveGate to throw');
  assert.match(thrown.message, /"src\/legacy\/index\.js" conflicts with protected_paths entry "src\/legacy\/index\.js"/);
  assert.match(thrown.message, /src\/legacy\/index\.js:1/);
  assert.match(thrown.message, /legacy auth module — operator sign-off required before touching/);
  assert.equal(fs.existsSync(path.join(archDir, 'gate.json')), false);
});

test('approveGate refuses to seal on a directory-prefix conflict (a protected directory protects everything under it)', () => {
  const archDir = mkTmpArchDir();
  const treeRoot = path.dirname(archDir);
  writeValidContentArtifacts(archDir);
  const ms = validMilestones();
  ms.touched_paths = ['src/legacy/auth/session.js'];
  fs.writeFileSync(path.join(archDir, 'milestones.json'), JSON.stringify(ms));
  writeConstraints(
    treeRoot,
    protectedPathsConstraints([
      {
        trust_flag: 'inherited-unverified',
        path: 'src/legacy',
        anchor: 'src/legacy:1',
        note: 'legacy tree — do not touch without operator sign-off',
      },
    ])
  );

  assert.throws(
    () => approveGate(archDir),
    /"src\/legacy\/auth\/session\.js" conflicts with protected_paths entry "src\/legacy"/
  );
  assert.equal(fs.existsSync(path.join(archDir, 'gate.json')), false);
});

test('approveGate: a directory-prefix match never fires as a bare string prefix (sibling directory name is unaffected)', () => {
  const archDir = mkTmpArchDir();
  const treeRoot = path.dirname(archDir);
  writeValidContentArtifacts(archDir);
  const ms = validMilestones();
  // "src/legacy-v2/index.js" shares the string prefix "src/legacy" with the
  // protected entry below but is a SIBLING directory, not a descendant —
  // must not conflict.
  ms.touched_paths = ['src/legacy-v2/index.js'];
  fs.writeFileSync(path.join(archDir, 'milestones.json'), JSON.stringify(ms));
  writeConstraints(
    treeRoot,
    protectedPathsConstraints([
      {
        trust_flag: 'inherited-unverified',
        path: 'src/legacy',
        anchor: 'src/legacy:1',
        note: 'legacy tree — do not touch without operator sign-off',
      },
    ])
  );

  const { gate } = approveGate(archDir);
  assert.equal(gate.decision, 'approved');
});

test('approveGate seals once a scout constraints revision releases the conflicting entry', () => {
  const archDir = mkTmpArchDir();
  const treeRoot = path.dirname(archDir);
  writeValidContentArtifacts(archDir);
  const ms = validMilestones();
  ms.touched_paths = ['src/legacy/index.js'];
  fs.writeFileSync(path.join(archDir, 'milestones.json'), JSON.stringify(ms));

  const conflicting = protectedPathsConstraints([
    {
      trust_flag: 'inherited-unverified',
      path: 'src/legacy/index.js',
      anchor: 'src/legacy/index.js:1',
      note: 'legacy auth module — operator sign-off required before touching',
    },
  ]);
  writeConstraints(treeRoot, conflicting);
  assert.throws(() => approveGate(archDir), /plan touches path\(s\) protected/);

  // Revision 2 — writeConstraints (the sole sanctioned writer, per
  // scout.js's own header comment) accepts a bumped revision releasing the
  // entry; the Agreement Pass resolution named in vision.md §5 [seq 50] is
  // exactly this: "a scout constraints REVISION (writeConstraints with a
  // bumped revision removing/releasing the entry — the sanctioned writer
  // already supports revisions)."
  const released = protectedPathsConstraints([]);
  released.revision = 2;
  writeConstraints(treeRoot, released);

  const { gate } = approveGate(archDir);
  assert.equal(gate.decision, 'approved');
});

// ---------- ledger evidence (P6 Sol review BLOCKING #1: gate authorization
// forgeability) ----------

test('approveGate appends a "plan-gate-decision" ledger record mirroring gate.json', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  const { gate, ledgerPath } = approveGate(archDir, { decision: 'auto-approved', decision_source: 'configured-policy' });

  assert.equal(ledgerPath, path.join(path.dirname(archDir), 'ledger.jsonl'));
  const { records } = readAll(ledgerPath);
  const decisionRecords = records.filter((r) => r.kind === 'plan-gate-decision');
  assert.equal(decisionRecords.length, 1);
  assert.equal(decisionRecords[0].decision, gate.decision);
  assert.equal(decisionRecords[0].decision_source, gate.decision_source);
  assert.equal(decisionRecords[0].manifest_digest, gate.manifest_digest);
  assert.equal(decisionRecords[0].decided_at, gate.decided_at);
});

// ---------- verifyGate ----------

test('verifyGate reports ok:true immediately after approveGate', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  approveGate(archDir);

  const result = verifyGate(archDir);
  assert.deepEqual(result, { ok: true, reasons: [] });
});

test('verifyGate reports ok:false when no gate.json exists yet', () => {
  const archDir = mkTmpArchDir();
  writeContentArtifacts(archDir);

  const result = verifyGate(archDir);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.length > 0);
});

test('verifyGate refuses drift: mutating an artifact after approval fails and names the file', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  approveGate(archDir);

  fs.writeFileSync(path.join(archDir, 'plan.md'), 'TAMPERED after approval\n');

  const result = verifyGate(archDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((r) => r.includes('plan.md') && r.includes('changed')),
    `expected a reason naming plan.md's drift, got: ${JSON.stringify(result.reasons)}`
  );
});

test('verifyGate refuses when gate.json reports decision="rejected"', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  approveGate(archDir, { decision: 'rejected' });

  const result = verifyGate(archDir);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes('rejected')));
});

test('verifyGate refuses when manifest.json is rewritten to a different (still self-consistent) digest set after approval', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  const { manifestPath } = approveGate(archDir);

  // Swap manifest.json's own bytes for a structurally different manifest —
  // its own artifacts entries would re-verify internally consistent, but its
  // digest no longer matches what gate.json approved.
  fs.writeFileSync(manifestPath, JSON.stringify({ schema_version: 1, revision: 2, artifacts: [], created_at: new Date().toISOString() }));

  const result = verifyGate(archDir);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes('manifest.json')));
});

test('verifyGate throws TypeError for a non-string archDir', () => {
  assert.throws(() => verifyGate(undefined), TypeError);
});

// ---------- gate-forgery regression (P6 Sol review BLOCKING #1) ----------
// "A direct probe created a legitimate reopened/configured-policy gate,
// changed only gate.json to decision: 'approved', decision_source: 'forged',
// and received {ok:true, reasons:[]} from verifyGate()." Reproduced verbatim
// below, plus a stricter variant that keeps decision_source a fully
// sanctioned vocabulary value — proving the fix is the ledger cross-check
// itself, not merely the decision_source vocabulary check.

test('gate-forgery regression: hand-flipping decision/decision_source on a legitimate reopened gate is refused', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  const { gatePath } = approveGate(archDir, { decision: 'reopened', decision_source: 'configured-policy' });

  // The exact probe from the review: only gate.json's own bytes are touched,
  // never the ledger — this is what an attacker with write access to
  // gate.json but not to the append-only ledger can actually do.
  const forged = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  fs.writeFileSync(gatePath, JSON.stringify({ ...forged, decision: 'approved', decision_source: 'forged' }));

  const result = verifyGate(archDir);
  assert.equal(result.ok, false);
});

test('gate-forgery regression: a valid-vocabulary decision flip (reopened -> approved) with no matching ledger record is refused', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  const { gatePath } = approveGate(archDir, { decision: 'reopened', decision_source: 'configured-policy' });

  // Stricter than the review's own probe: decision_source stays a fully
  // sanctioned value ("configured-policy") — the ONLY forged field is
  // decision itself, flipped from the ledger's recorded "reopened" to
  // "approved". A pre-fix verifier that only checked GATE_DECISIONS
  // membership and the manifest digest chain would have accepted this
  // outright, since neither of those two facts changed.
  const forged = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  fs.writeFileSync(gatePath, JSON.stringify({ ...forged, decision: 'approved' }));

  const result = verifyGate(archDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((r) => r.includes('plan-gate-decision') && r.includes('forged gate flip')),
    `expected a reason naming the ledger mismatch, got: ${JSON.stringify(result.reasons)}`
  );
});

test('gate-forgery regression: a gate.json with no corresponding ledger record at all is refused even with a correct manifest digest', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  const { gatePath, manifestDigest } = approveGate(archDir);

  // Delete the ledger entirely — simulates a gate.json planted without ever
  // going through approveGate (e.g. copied in from another tree), even
  // though its manifest_digest is genuinely correct for this manifest.json.
  fs.rmSync(path.join(path.dirname(archDir), 'ledger.jsonl'), { force: true });
  assert.equal(fs.existsSync(path.join(archDir, 'manifest.json')), true, 'sanity: manifest.json still on disk');
  assert.match(manifestDigest, /^sha256:[0-9a-f]{64}$/);

  const result = verifyGate(archDir);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes('plan-gate-decision') && r.includes('no')));
});

// ---------- CLI ----------

test('CLI approve then verify: exit 0 on a clean approval', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);

  const approveProc = spawnSync(process.execPath, [CLI_PATH, 'approve', archDir], { encoding: 'utf8' });
  assert.equal(approveProc.status, 0, approveProc.stderr);
  assert.match(approveProc.stdout, /"decision": "approved"/);

  const verifyProc = spawnSync(process.execPath, [CLI_PATH, 'verify', archDir], { encoding: 'utf8' });
  assert.equal(verifyProc.status, 0, verifyProc.stderr);
  assert.match(verifyProc.stdout, /OK/);
});

test('CLI approve honors --decision and --source flags', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);

  const proc = spawnSync(
    process.execPath,
    [CLI_PATH, 'approve', archDir, '--decision', 'auto-approved', '--source', 'configured-policy'],
    { encoding: 'utf8' }
  );
  assert.equal(proc.status, 0, proc.stderr);
  const gate = JSON.parse(fs.readFileSync(path.join(archDir, 'gate.json'), 'utf8'));
  assert.equal(gate.decision, 'auto-approved');
  assert.equal(gate.decision_source, 'configured-policy');
});

test('CLI verify: exit 1 and prints a reason naming the drifted file after tampering', () => {
  const archDir = mkTmpArchDir();
  writeValidContentArtifacts(archDir);
  approveGate(archDir);
  fs.writeFileSync(path.join(archDir, 'plan.md'), 'TAMPERED\n');

  const proc = spawnSync(process.execPath, [CLI_PATH, 'verify', archDir], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stdout, /plan\.md/);
});

test('CLI: missing arguments exits 1 with a usage message', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage/);
});
