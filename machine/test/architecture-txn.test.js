'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');

const {
  stageArtifacts,
  promoteStaged,
  readCurrent,
  reopenThroughTxn,
  revisionDirOf,
  markerPathOf,
} = require('../src/architecture-txn.js');
const { loadRegistry } = require('../src/phases.js');
const { verifyManifest, manifestArtifactsDigest, CANONICAL_ARCHITECTURE_ARTIFACTS } = require('../src/manifest.js');
const { readJson, writeAtomic } = require('../src/atomic-json.js');
const { readRecords, appendRecord } = require('../src/stream.js');
const { writeMindOpen, writeMindRetire, supersedeMind } = require('../src/receipts.js');
const {
  validCriteriaRegister,
  validMilestones,
  validArtifactMap,
  VALID_PROTOCOL_RECORD_MD,
  VALID_PLAN_MD,
} = require('./fixtures/valid-architecture-artifacts.js');

const MODULE_PATH = path.resolve(__dirname, '..', 'src', 'architecture-txn.js');
const REGISTRY_PATH = path.join(__dirname, '..', 'phases-registry.json');

function makeTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-txn-test-'));
  const treeRoot = path.join(tmp, '.thelastskill');
  const archDir = path.join(treeRoot, 'architecture');
  fs.mkdirSync(archDir, { recursive: true });
  return { treeRoot, archDir };
}

// The five canonical artifacts as stageArtifacts takes them: objects for the
// three JSON artifacts, prose strings for the two markdown ones — the same
// split atomic-json's write-architecture-artifact CLI and plan-author's own
// Write calls already draw.
function artifactSet(overrides = {}) {
  return Object.assign(
    {
      'plan.md': VALID_PLAN_MD,
      'criteria-register.json': validCriteriaRegister(),
      'milestones.json': validMilestones(),
      'artifact-map.json': validArtifactMap(),
      'protocol-record.md': VALID_PROTOCOL_RECORD_MD,
    },
    overrides
  );
}

// A second, distinguishable revision's worth of content.
function revisedSet() {
  return artifactSet({
    'plan.md': '# Plan\n\nSecond revision body.\n',
    'protocol-record.md': '# Protocol record\n\nProtocol: deep scrutiny. Second revision.\n',
  });
}

function revisionBytes(archDir, revision) {
  const dir = revisionDirOf(archDir, revision);
  const out = {};
  for (const relPath of CANONICAL_ARCHITECTURE_ARTIFACTS) {
    const abs = path.join(dir, relPath);
    out[relPath] = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  }
  out['manifest.json'] = readJson(path.join(dir, 'manifest.json'), null);
  return out;
}

// Content equality cannot see a rewrite that produced identical bytes, and
// "rewrites nothing" is a claim about writes, not about content. mtime and
// inode together catch both an in-place rewrite and an atomic
// write-temp-then-rename replacement.
function fileIdentity(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return { mtimeMs: stat.mtimeMs, ino: stat.ino };
}

function revisionIdentity(archDir, revision) {
  const dir = revisionDirOf(archDir, revision);
  const out = {};
  for (const relPath of [...CANONICAL_ARCHITECTURE_ARTIFACTS, 'manifest.json']) {
    out[relPath] = fileIdentity(path.join(dir, relPath));
  }
  return out;
}

// Everything a refused transaction must leave exactly as it found it: every
// revision directory INCLUDING its manifest, every rejection seal, the marker,
// and — because a refusal in the reopen path could touch either — state.json
// and the whole ledger.
function snapshot(archDir, treeRoot) {
  const revisions = {};
  const revisionsRoot = path.join(archDir, 'revisions');
  if (fs.existsSync(revisionsRoot)) {
    for (const entry of fs.readdirSync(revisionsRoot).sort()) {
      revisions[entry] = { content: revisionBytes(archDir, entry), identity: revisionIdentity(archDir, entry) };
    }
  }
  const rejected = {};
  const rejectedRoot = path.join(archDir, 'rejected');
  if (fs.existsSync(rejectedRoot)) {
    for (const entry of fs.readdirSync(rejectedRoot).sort()) {
      const abs = path.join(rejectedRoot, entry);
      rejected[entry] = { content: readJson(abs, null), identity: fileIdentity(abs) };
    }
  }
  const markerPath = markerPathOf(archDir);
  const snap = {
    marker: readJson(markerPath, null),
    markerIdentity: fileIdentity(markerPath),
    revisions,
    rejected,
  };
  if (treeRoot !== undefined) {
    snap.state = readJson(path.join(treeRoot, 'state.json'), null);
    snap.ledger = readRecords(path.join(treeRoot, 'ledger.jsonl')).records;
  }
  return snap;
}

// Same fresh-process discipline C2's implementation.test.js established: a
// real new Node process, no module cache and no closure over the first call.
function replayInFreshProcess(fnName, args) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-txn-replay-'));
  const scriptPath = path.join(scriptDir, 'replay.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const txn = require(${JSON.stringify(MODULE_PATH)});\n` +
      `const { fn, args } = JSON.parse(process.argv[2]);\n` +
      `process.stdout.write(JSON.stringify(txn[fn](...args)));\n`
  );
  const out = execFileSync(process.execPath, [scriptPath, JSON.stringify({ fn: fnName, args })], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

// A tree walked far enough for reopenPhase to have something to rewind: the
// plan gate reached, architecture complete behind it. Hand-built rather than
// scaffolded — reopenPhase reads state.json and the registry and runs no
// entry checks, so this is the whole precondition.
function stateAtPlanGate(treeRoot) {
  const statePath = path.join(treeRoot, 'state.json');
  writeAtomic(statePath, {
    schema_version: 1,
    phase: 'plan_gate',
    phase_status: {
      onboarding: 'complete',
      brainstorm: 'complete',
      research: 'complete',
      architecture: 'complete',
    },
    next_action: 'plan_gate',
    updated_utc: '2026-01-01T00:00:00.000Z',
  });
  return statePath;
}

// Promotion requires the caller to cite the payload it staged, by the digest
// its stage receipt handed back. Tests that only need "a promoted revision"
// as setup go through this; tests about promotion itself cite the receipt
// explicitly so the binding is visible where it is the subject.
function stagePromoted(archDir, files) {
  const staged = stageArtifacts(archDir, files);
  return promoteStaged(archDir, staged.revision, staged.artifacts_digest);
}

// A well-formed digest for whatever is on disk now. Refusal tests use it to
// get past the argument check and reach the refusal they are actually about.
function artifactsDigestOf(archDir, revision) {
  return manifestArtifactsDigest(readJson(path.join(revisionDirOf(archDir, revision), 'manifest.json'), null));
}

function reopenOpts(treeRoot) {
  return { registry: loadRegistry(REGISTRY_PATH), statePath: path.join(treeRoot, 'state.json') };
}

function reopenRecords(treeRoot) {
  const { records } = readRecords(path.join(treeRoot, 'ledger.jsonl'));
  return records.filter((record) => record.kind === 'phase-reopen');
}

const DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER_DIGEST = `sha256:${'b'.repeat(64)}`;
const RATIONALE = 'operator rejected: milestone M2 conflates two unrelated slices';

// The module composes the rejected digest into the rationale it hands
// phases.js, so the ledger record it must find back later is owned by exactly
// one rejection. Mirrored here because it is a durable on-disk contract, not
// an internal detail — the assertions below hold the module to it.
function composedRationale(rationale, digest) {
  return `${rationale} [kiln-rejected ${digest}]`;
}

function sealPathOf(archDir, digest) {
  return path.join(archDir, 'rejected', `${digest.slice('sha256:'.length)}.json`);
}

// The pending seal this module writes before it calls reopenPhase — the state
// every crash between the two leaves behind. It binds the reopen context the
// precheck observed, so a successor can tell whether what it inherited is
// still the reopen that was authorized.
function pendingSeal(treeRoot, overrides = {}) {
  const statePath = path.join(treeRoot, 'state.json');
  const state = readJson(statePath, null);
  return {
    schema_version: 1,
    revision: 1,
    rejected_digest: DIGEST,
    rationale: RATIONALE,
    rejected_at: '2026-01-01T00:00:00.000Z',
    context: {
      from_phase: state === null ? null : state.phase,
      to_phase: 'architecture',
      state_digest: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(statePath)).digest('hex')}`,
    },
    reopen: null,
    refused: null,
    ...overrides,
  };
}

function appendReopenRecord(treeRoot, rationale) {
  return appendRecord(path.join(treeRoot, 'ledger.jsonl'), {
    kind: 'phase-reopen',
    payload: { from: 'plan_gate', to: 'architecture', rationale },
    correlation_id: 'architecture',
  });
}

// ---------- stageArtifacts ----------

test('stageArtifacts writes the five canonical artifacts and a verifying manifest into their own revision directory', () => {
  const { archDir } = makeTree();

  const receipt = stageArtifacts(archDir, artifactSet());

  assert.equal(receipt.revision, 1);
  assert.equal(receipt.revisionDir, revisionDirOf(archDir, 1));
  for (const relPath of CANONICAL_ARCHITECTURE_ARTIFACTS) {
    assert.ok(fs.statSync(path.join(receipt.revisionDir, relPath)).isFile());
  }
  assert.deepEqual(verifyManifest(receipt.revisionDir, receipt.manifest), { ok: true, drift: [] });
  assert.deepEqual(receipt.manifest, readJson(path.join(receipt.revisionDir, 'manifest.json'), null));
  assert.equal(receipt.manifest.revision, 1);
  assert.equal(fs.existsSync(markerPathOf(archDir)), false);
});

test('stageArtifacts refuses anything but exactly the five canonical artifacts', () => {
  const { archDir } = makeTree();
  const short = artifactSet();
  delete short['plan.md'];

  assert.throws(() => stageArtifacts(archDir, short), /exactly the five canonical architecture artifacts/);
  assert.throws(
    () => stageArtifacts(archDir, artifactSet({ 'notes.md': 'extra' })),
    /exactly the five canonical architecture artifacts/
  );
  assert.equal(fs.existsSync(path.join(archDir, 'revisions')), false);
});

test('stageArtifacts re-staged with identical content returns the identical receipt and rewrites nothing', () => {
  const { archDir } = makeTree();
  const first = stageArtifacts(archDir, artifactSet());
  const before = snapshot(archDir);

  const second = stageArtifacts(archDir, artifactSet());

  assert.deepEqual(second, first);
  assert.deepEqual(snapshot(archDir), before);
});

test('stageArtifacts re-staged with DIFFERENT content for the same revision fails closed, mutating nothing', () => {
  const { archDir } = makeTree();
  stageArtifacts(archDir, artifactSet());
  const before = snapshot(archDir);

  // The re-entry law binds every durable writer in this chunk, staging
  // included: identical payload replays, conflicting payload is refused.
  assert.throws(() => stageArtifacts(archDir, revisedSet()), /already staged .* with different content/);
  assert.deepEqual(snapshot(archDir), before);
});

test('stageArtifacts RESUMES a revision a crash left half-written, for the identical payload', () => {
  const { archDir } = makeTree();
  const complete = stageArtifacts(archDir, artifactSet());
  const revisionDir = revisionDirOf(archDir, 1);

  // Staging writes six files in sequence, so a crash leaves a prefix of them.
  // Categorically refusing that directory would make the revision number
  // permanently unusable through the API — there is no other way to reach it.
  fs.rmSync(path.join(revisionDir, 'manifest.json'));
  fs.rmSync(path.join(revisionDir, 'protocol-record.md'));
  const survivingPlan = fileIdentity(path.join(revisionDir, 'plan.md'));

  const resumed = stageArtifacts(archDir, artifactSet());

  assert.equal(resumed.revision, 1);
  assert.deepEqual(resumed.manifest.artifacts, complete.manifest.artifacts);
  assert.equal(resumed.artifacts_digest, complete.artifacts_digest);
  assert.deepEqual(verifyManifest(revisionDir, resumed.manifest), { ok: true, drift: [] });
  // Only the gap was written: the artifacts that survived the crash are
  // untouched, not rewritten with identical bytes.
  assert.deepEqual(fileIdentity(path.join(revisionDir, 'plan.md')), survivingPlan);
});

test('stageArtifacts resumes an interrupted revision in a FRESH NODE PROCESS', () => {
  const { archDir } = makeTree();
  const complete = stageArtifacts(archDir, artifactSet());
  const revisionDir = revisionDirOf(archDir, 1);
  fs.rmSync(path.join(revisionDir, 'manifest.json'));
  fs.rmSync(path.join(revisionDir, 'artifact-map.json'));

  const resumed = replayInFreshProcess('stageArtifacts', [archDir, artifactSet()]);

  assert.equal(resumed.artifacts_digest, complete.artifacts_digest);
  assert.deepEqual(verifyManifest(revisionDir, resumed.manifest), { ok: true, drift: [] });
});

test('stageArtifacts rebuilds a manifest that no longer describes its own intact artifacts', () => {
  const { archDir } = makeTree();
  const complete = stageArtifacts(archDir, artifactSet());
  const manifestPath = path.join(revisionDirOf(archDir, 1), 'manifest.json');

  // The five artifacts are intact and match the payload exactly; only the
  // manifest — derived data, not authored content — is wrong. Returning it
  // as a receipt would hand the caller a digest for a set it does not
  // describe, so the restage rebuilds it from the artifacts themselves.
  const shrunk = readJson(manifestPath, null);
  shrunk.artifacts = shrunk.artifacts.filter((entry) => entry.path !== 'milestones.json');
  writeAtomic(manifestPath, shrunk);

  const restaged = stageArtifacts(archDir, artifactSet());

  assert.equal(restaged.artifacts_digest, complete.artifacts_digest);
  assert.deepEqual(
    restaged.manifest.artifacts.map((entry) => entry.path).sort(),
    [...CANONICAL_ARCHITECTURE_ARTIFACTS].sort()
  );
  assert.deepEqual(verifyManifest(revisionDirOf(archDir, 1), restaged.manifest), { ok: true, drift: [] });
});

test('stageArtifacts refuses a CONFLICTING payload over a half-written revision', () => {
  const { archDir } = makeTree();
  stageArtifacts(archDir, artifactSet());
  const revisionDir = revisionDirOf(archDir, 1);
  fs.rmSync(path.join(revisionDir, 'manifest.json'));
  const before = snapshot(archDir);

  // Resuming is for the SAME payload. A different one arriving at a
  // half-written revision is a conflicting duplicate, not a continuation.
  assert.throws(() => stageArtifacts(archDir, revisedSet()), /already staged .* with different content/);
  assert.deepEqual(snapshot(archDir), before);
});

test('stageArtifacts stages the revision AFTER the marker once one is promoted', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());

  const second = stageArtifacts(archDir, revisedSet());

  assert.equal(second.revision, 2);
  assert.equal(second.revisionDir, revisionDirOf(archDir, 2));
  assert.equal(second.manifest.revision, 2);
});

test('stageArtifacts replayed in a FRESH NODE PROCESS returns the identical receipt and changes nothing', () => {
  const { archDir } = makeTree();
  const first = stageArtifacts(archDir, artifactSet());
  const before = snapshot(archDir);

  const replayed = replayInFreshProcess('stageArtifacts', [archDir, artifactSet()]);

  assert.deepEqual(replayed, first);
  assert.deepEqual(snapshot(archDir), before);
});

// ---------- promoteStaged ----------

test('promoteStaged makes the staged revision live, bumps the marker, and returns what it reads back', () => {
  const { archDir } = makeTree();
  const staged = stageArtifacts(archDir, artifactSet());

  const receipt = promoteStaged(archDir, 1, staged.artifacts_digest);

  assert.equal(receipt.revision, 1);
  assert.equal(receipt.revisionDir, revisionDirOf(archDir, 1));
  assert.deepEqual(verifyManifest(receipt.revisionDir, receipt.manifest), { ok: true, drift: [] });
  assert.deepEqual(receipt.manifest, staged.manifest);
  assert.deepEqual(receipt.marker, readJson(markerPathOf(archDir), null));
  assert.equal(receipt.marker.revision, 1);
  assert.deepEqual(readCurrent(archDir), receipt);
});

test('promotion touches no artifact file: the previous revision stays physically whole and readable throughout', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  const revisionOne = revisionBytes(archDir, 1);
  const staged2 = stageArtifacts(archDir, revisedSet());

  // Before the flip: revision 1 is live and whole, revision 2 is complete
  // beside it, and neither is being written into.
  assert.equal(readCurrent(archDir).revision, 1);
  assert.deepEqual(revisionBytes(archDir, 1), revisionOne);

  const receipt = promoteStaged(archDir, 2, staged2.artifacts_digest);

  // After the flip: revision 2 is live, and revision 1 is byte-for-byte the
  // set it always was — not merely still refusable, still READABLE.
  assert.equal(receipt.revision, 2);
  assert.deepEqual(revisionBytes(archDir, 1), revisionOne);
  assert.notDeepEqual(revisionBytes(archDir, 1), revisionBytes(archDir, 2));
  assert.deepEqual(readCurrent(archDir), receipt);
});

test('a crash before the marker write leaves the PREVIOUS revision live and whole, and the re-run completes', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  const revisionOne = revisionBytes(archDir, 1);
  const markerAtOne = readJson(markerPathOf(archDir), null);

  // The only durable write a promotion performs is the marker, so the only
  // state a crash can leave is "revision staged, marker not yet flipped".
  const staged2 = stageArtifacts(archDir, revisedSet());
  assert.deepEqual(readJson(markerPathOf(archDir), null), markerAtOne);

  const live = readCurrent(archDir);
  assert.equal(live.revision, 1);
  assert.deepEqual(revisionBytes(archDir, 1), revisionOne);

  const receipt = promoteStaged(archDir, 2, staged2.artifacts_digest);

  assert.equal(receipt.revision, 2);
  assert.deepEqual(readCurrent(archDir), receipt);
  assert.deepEqual(revisionBytes(archDir, 1), revisionOne);
});

test('promoteStaged recovers a crashed promotion in a FRESH NODE PROCESS', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  const staged2 = stageArtifacts(archDir, revisedSet());

  // The recovery that matters is the one a SUCCESSOR session performs, from a
  // crashed state — not a second call in the process that already succeeded.
  const replayed = replayInFreshProcess("promoteStaged", [archDir, 2, staged2.artifacts_digest]);

  assert.equal(replayed.revision, 2);
  assert.deepEqual(readCurrent(archDir), replayed);
});

test('promoteStaged called again for the same revision returns the identical receipt and changes nothing', () => {
  const { archDir } = makeTree();
  const staged = stageArtifacts(archDir, artifactSet());
  const first = promoteStaged(archDir, 1, staged.artifacts_digest);
  const before = snapshot(archDir);

  const second = promoteStaged(archDir, 1, staged.artifacts_digest);

  assert.deepEqual(second, first);
  assert.deepEqual(snapshot(archDir), before);
});

test('promoteStaged replayed in a FRESH NODE PROCESS returns the identical receipt and changes nothing', () => {
  const { archDir } = makeTree();
  const staged = stageArtifacts(archDir, artifactSet());
  const first = promoteStaged(archDir, 1, staged.artifacts_digest);
  const before = snapshot(archDir);

  const replayed = replayInFreshProcess("promoteStaged", [archDir, 1, staged.artifacts_digest]);

  assert.deepEqual(replayed, first);
  assert.deepEqual(snapshot(archDir), before);
});

test('promoteStaged refuses a revision the marker has already passed, mutating nothing', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stagePromoted(archDir, revisedSet());
  const before = snapshot(archDir);

  assert.throws(() => promoteStaged(archDir, 1, artifactsDigestOf(archDir, 1)), /revision 1 is already superseded \(the marker is at 2\)/);
  assert.deepEqual(snapshot(archDir), before);
});

test('promoteStaged refuses a revision that is not the marker\'s next, mutating nothing', () => {
  const { archDir } = makeTree();
  stageArtifacts(archDir, artifactSet());
  const before = snapshot(archDir);

  assert.throws(() => promoteStaged(archDir, 3, artifactsDigestOf(archDir, 1)), /revision 3 is not the next revision after 0/);
  assert.deepEqual(snapshot(archDir), before);
});

test('promoteStaged refuses a revision that has drifted from its own manifest, mutating nothing', () => {
  const { archDir } = makeTree();
  const staged = stageArtifacts(archDir, artifactSet());
  fs.writeFileSync(path.join(revisionDirOf(archDir, 1), 'plan.md'), '# Plan\n\ntampered after staging.\n');
  const before = snapshot(archDir);

  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest),
    /revision 1 does not match its own manifest .*plan\.md.*changed/
  );
  assert.deepEqual(snapshot(archDir), before);
});

test('promoteStaged refuses a SHRUNK manifest that verifies only because it declares less', () => {
  const { archDir } = makeTree();
  const staged = stageArtifacts(archDir, artifactSet());
  const manifestPath = path.join(staged.revisionDir, 'manifest.json');

  // verifyManifest only checks what a manifest DECLARES; it never scans for
  // what else is in the directory. So dropping an entry leaves a manifest
  // that verifies perfectly while vouching for four artifacts instead of five.
  const shrunk = readJson(manifestPath, null);
  shrunk.artifacts = shrunk.artifacts.filter((entry) => entry.path !== 'milestones.json');
  writeAtomic(manifestPath, shrunk);
  assert.equal(verifyManifest(staged.revisionDir, shrunk).ok, true);
  const before = snapshot(archDir);

  assert.throws(() => promoteStaged(archDir, 1, staged.artifacts_digest), /not the five canonical architecture artifacts/);
  assert.deepEqual(snapshot(archDir), before);
});

test('promoteStaged refuses an incomplete revision, mutating nothing', () => {
  const { archDir } = makeTree();
  const staged = stageArtifacts(archDir, artifactSet());
  fs.rmSync(path.join(revisionDirOf(archDir, 1), "milestones.json"));
  const before = snapshot(archDir);

  assert.throws(() => promoteStaged(archDir, 1, staged.artifacts_digest), /revision 1 is incomplete — missing milestones\.json/);
  assert.deepEqual(snapshot(archDir), before);
});

test('promoteStaged refuses a re-promotion of a promoted revision whose content has since changed', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());

  // The marker binds the revision to the exact manifest bytes that went live,
  // so swapping both the content and its manifest consistently is still
  // caught: the promoted digest no longer matches.
  const revisionDir = revisionDirOf(archDir, 1);
  fs.writeFileSync(path.join(revisionDir, 'plan.md'), '# Plan\n\nswapped under a promoted revision.\n');
  const manifest = readJson(path.join(revisionDir, 'manifest.json'), null);
  writeAtomic(path.join(revisionDir, 'manifest.json'), {
    ...manifest,
    artifacts: manifest.artifacts.map((entry) =>
      entry.path === 'plan.md'
        ? {
            path: 'plan.md',
            digest: `sha256:${crypto
              .createHash('sha256')
              .update(fs.readFileSync(path.join(revisionDir, 'plan.md')))
              .digest('hex')}`,
          }
        : entry
    ),
  });
  const before = snapshot(archDir);

  // Citing the swapped payload gets past the "is this what you staged" check,
  // which is the point: what refuses here is the marker's own binding to the
  // manifest that actually went live.
  assert.throws(
    () => promoteStaged(archDir, 1, artifactsDigestOf(archDir, 1)),
    /already promoted from different content/
  );
  assert.deepEqual(snapshot(archDir), before);
});

test('promoteStaged refuses a revision whose payload was swapped after staging, even though it verifies', () => {
  const { archDir } = makeTree();
  const staged = stageArtifacts(archDir, artifactSet());

  // A revision NUMBER is not an instruction. Between staging and promotion a
  // revision and its manifest can be replaced together, consistently, and the
  // result verifies against itself perfectly — requireVerifiedRevision has
  // nothing to object to. What refuses is the caller's citation of the
  // payload it actually staged.
  const revisionDir = revisionDirOf(archDir, 1);
  fs.writeFileSync(path.join(revisionDir, 'plan.md'), '# Plan\n\nsubstituted before promotion.\n');
  writeAtomic(path.join(revisionDir, 'manifest.json'), {
    ...staged.manifest,
    artifacts: staged.manifest.artifacts.map((entry) =>
      entry.path === 'plan.md'
        ? {
            path: 'plan.md',
            digest: `sha256:${crypto
              .createHash('sha256')
              .update(fs.readFileSync(path.join(revisionDir, 'plan.md')))
              .digest('hex')}`,
          }
        : entry
    ),
  });
  assert.equal(verifyManifest(revisionDir, readJson(path.join(revisionDir, 'manifest.json'), null)).ok, true);
  const before = snapshot(archDir);

  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest),
    /refusing to promote a payload other than the one staged/
  );
  assert.deepEqual(snapshot(archDir), before);
  assert.throws(() => readCurrent(archDir), /no promoted revision/);
});

test('promoteStaged requires the artifacts digest from the stage receipt', () => {
  const { archDir } = makeTree();
  stageArtifacts(archDir, artifactSet());

  assert.throws(() => promoteStaged(archDir, 1), /requires the "artifacts_digest" from the stage receipt/);
  assert.throws(() => promoteStaged(archDir, 1, 'not-a-digest'), /requires the "artifacts_digest"/);
});

test('a malformed marker fails closed everywhere rather than reading as revision zero', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());

  for (const broken of [
    { schema_version: 1, revision: 'one', manifest_digest: `sha256:${'c'.repeat(64)}` },
    { schema_version: 2, revision: 1, manifest_digest: `sha256:${'c'.repeat(64)}` },
    { schema_version: 1, revision: 1 },
    [],
    null,
  ]) {
    writeAtomic(markerPathOf(archDir), broken);
    // Reading a damaged marker as "nothing promoted" would hand the next
    // staging call revision 1 — the live revision — and overwrite it.
    assert.throws(() => readCurrent(archDir), /the marker at .*revision\.json/);
    assert.throws(() => stageArtifacts(archDir, revisedSet()), /the marker at .*revision\.json/);
    assert.throws(() => promoteStaged(archDir, 2, artifactsDigestOf(archDir, 1)), /the marker at .*revision\.json/);
  }
});

// ---------- the mind generation guard ----------

// The two-writers hazard, concretely: a mind is superseded — retired at
// generation N, a fresh one seated at N+1 — while the retired one's process
// is still alive. Whatever it was in the middle of, its promotion must not
// land. The guard is enforced here and read off the ledger, never taken from
// the caller: a stale writer's own belief about which generation is live is
// exactly the thing in question.
const ARCH_MIND = 'architect';
const ARCH_SCOPE = 'architecture';

// Wait for a child to reach its instrumented window — and never wait forever.
// A child that dies before signalling is a real outcome (the code under test
// refused earlier than the test expected), and it has to surface as a failing
// assertion rather than as a suite that hangs: a mutation caught by a hang is
// indistinguishable from one that is not caught at all.
async function waitForWindow(signalPath, child, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(signalPath)) {
    assert.equal(child.exitCode, null, 'the child exited before reaching its window');
    assert.ok(Date.now() < deadline, 'timed out waiting for the child to reach its window');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function seatMind(treeRoot, generation, overrides = {}) {
  return writeMindOpen(
    treeRoot,
    Object.assign(
      {
        mind: ARCH_MIND,
        scope: ARCH_SCOPE,
        session: `sess-${generation}`,
        handle: `agent-${generation}`,
        generation,
      },
      overrides
    )
  );
}

function retireMind(treeRoot, generation, reason = 'close', overrides = {}) {
  return writeMindRetire(
    treeRoot,
    Object.assign({ mind: ARCH_MIND, scope: ARCH_SCOPE, reason, generation }, overrides)
  );
}

// The handover, through the one writer that may write it.
function supersedeTo(treeRoot, next, overrides = {}) {
  return supersedeMind(
    treeRoot,
    Object.assign({ mind: ARCH_MIND, scope: ARCH_SCOPE, reason: 'supersede', generation: next - 1 }, overrides.retire),
    Object.assign(
      {
        mind: ARCH_MIND,
        scope: ARCH_SCOPE,
        session: `sess-${next}`,
        handle: `agent-${next}`,
        generation: next,
      },
      overrides.open
    )
  );
}

function mindOpts(generation, overrides = {}) {
  return Object.assign({ mind: ARCH_MIND, scope: ARCH_SCOPE, generation }, overrides);
}

test('a promotion by the live generation records its attribution on the marker', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  const staged = stageArtifacts(archDir, artifactSet());

  const receipt = promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1));

  assert.equal(receipt.marker.mind, ARCH_MIND);
  assert.equal(receipt.marker.mind_scope, ARCH_SCOPE);
  assert.equal(receipt.marker.mind_generation, 1);
  assert.deepEqual(receipt.marker, readJson(markerPathOf(archDir), null));
});

test('a promotion by a superseded generation is refused, and moves nothing', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  supersedeTo(treeRoot, 2);
  const staged = stageArtifacts(archDir, artifactSet());
  const before = snapshot(archDir, treeRoot);

  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1)),
    /generation 1 .* is not live \(generation 2 is\)/
  );
  assert.deepEqual(snapshot(archDir, treeRoot), before);
  assert.throws(() => readCurrent(archDir), /no promoted revision/);
});

// Retired and not yet replaced is just as stale: the seat is empty, and an
// empty seat has no authority to write the architecture.
test('a promotion by a retired generation is refused even when nothing has replaced it', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  retireMind(treeRoot, 1, 'timeout');
  const staged = stageArtifacts(archDir, artifactSet());

  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1)),
    /has no live generation/
  );
});

test('a promotion citing a mind that was never seated is refused', () => {
  const { treeRoot, archDir } = makeTree();
  const staged = stageArtifacts(archDir, artifactSet());

  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1)),
    /has no live generation/
  );
  seatMind(treeRoot, 1);
  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(2)),
    /generation 2 .* is not live \(generation 1 is\)/
  );
});

// The scoped-identity rule, at the level where it bites: generations are
// counted per (mind, scope), so another scope's second generation says
// nothing about whether this scope's first is still live.
test('another scope\'s generation does not make this scope\'s generation stale', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  seatMind(treeRoot, 1, { scope: 'milestones/M1', session: 'sess-m1' });
  supersedeTo(treeRoot, 2, {
    retire: { scope: 'milestones/M1' },
    open: { scope: 'milestones/M1', session: 'sess-m1b' },
  });
  const staged = stageArtifacts(archDir, artifactSet());

  const receipt = promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1));
  assert.equal(receipt.marker.mind_generation, 1);
});

// The ratchet: once a promotion is attributed, an unattributed one cannot
// follow. Without this the guard would be opt-in — a stale writer could skip
// the check by simply declining to say who it is.
test('once the marker carries an attribution, an unattributed promotion is refused', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  const staged = stageArtifacts(archDir, artifactSet());
  promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1));
  const staged2 = stageArtifacts(archDir, revisedSet());
  const before = snapshot(archDir, treeRoot);

  assert.throws(
    () => promoteStaged(archDir, 2, staged2.artifacts_digest),
    /names no mind — refusing to let an unattributed promotion supersede one/
  );
  assert.deepEqual(snapshot(archDir, treeRoot), before);
});

test('a promotion attributed to half a mind is a caller defect, not a refusal to weigh', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  const staged = stageArtifacts(archDir, artifactSet());

  for (const opts of [{ mind: ARCH_MIND }, { mind: ARCH_MIND, scope: ARCH_SCOPE }, { generation: 1 }]) {
    assert.throws(
      () => promoteStaged(archDir, 1, staged.artifacts_digest, opts),
      /requires all of \{mind, scope, generation\} or none/
    );
  }
});

// The already-promoted path answers the same question, because a stale writer
// re-calling it would otherwise read the receipt as confirmation that it is
// still the one seated.
test('a re-promotion of the live revision is guarded exactly as the first promotion was', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  const staged = stageArtifacts(archDir, artifactSet());
  promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1));

  assert.deepEqual(promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1)), readCurrent(archDir));

  supersedeTo(treeRoot, 2);
  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1)),
    /generation 1 .* is not live \(generation 2 is\)/
  );
  // The live generation reads the marker it inherited without rewriting it.
  const inherited = promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(2));
  assert.equal(inherited.marker.mind_generation, 1);
});

test('a marker carrying half an attribution fails closed rather than reading as unattributed', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  const staged = stageArtifacts(archDir, artifactSet());
  promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1));

  const markerPath = markerPathOf(archDir);
  const whole = readJson(markerPath, null);
  // Missing and unreadable are refused by different sentences on purpose: a
  // marker that lost a field says which fields it still has, which is what a
  // reader needs to tell a truncated write from a corrupted value.
  const cases = [
    [{ mind_generation: undefined }, /partial mind attribution \(mind, mind_scope\)/],
    [{ mind_scope: undefined }, /partial mind attribution \(mind, mind_generation\)/],
    [{ mind_generation: 0 }, /unreadable mind attribution/],
    [{ mind: '' }, /unreadable mind attribution/],
  ];
  for (const [damage, expected] of cases) {
    writeAtomic(markerPath, JSON.parse(JSON.stringify(Object.assign({}, whole, damage))));
    assert.throws(() => readCurrent(archDir), expected);
  }
});

// The guard is only a guard if the stream it reads is the one the promoted
// tree keeps. A promoting mind that could name the ledger it is judged by
// would carry its own alibi: a second tree where its generation is still
// live is trivial to produce, so the ledger is derived from archDir and there
// is no parameter that redirects it.
test('the guard reads the promoted tree\'s own ledger, and nothing can redirect it', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  supersedeTo(treeRoot, 2);
  const staged = stageArtifacts(archDir, artifactSet());

  // A real second tree whose ledger still shows generation 1 seated — the
  // alibi, built rather than described.
  const elsewhere = makeTree();
  seatMind(elsewhere.treeRoot, 1);

  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1)),
    /is not live \(generation 2 is\)/
  );
  // Naming the other tree's ledger in any shape a caller can reach changes
  // nothing: the option does not exist, and an unknown option is refused
  // rather than ignored.
  for (const alibi of [
    { ledgerPath: path.join(elsewhere.treeRoot, 'ledger.jsonl') },
    { ledger_path: path.join(elsewhere.treeRoot, 'ledger.jsonl') },
    { treeRoot: elsewhere.treeRoot },
  ]) {
    assert.throws(
      () => promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1, alibi)),
      /unexpected option/
    );
  }
  assert.throws(() => readCurrent(archDir), /no promoted revision/);

  // The same mind promoting in the tree where it IS live succeeds, which is
  // what makes the refusal above about the ledger rather than about the mind.
  const stagedElsewhere = stageArtifacts(elsewhere.archDir, artifactSet());
  assert.equal(
    promoteStaged(elsewhere.archDir, 1, stagedElsewhere.artifacts_digest, mindOpts(1)).marker.mind_generation,
    1
  );
});

// The cheap precondition earns its place by which refusal comes back: a mind
// that is no longer seated is told THAT, rather than being told its manifest
// is damaged by a verification it was never entitled to run. The authoritative
// check still runs later, adjacent to the write.
test('a superseded mind is told it is superseded, not that its revision is broken', () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  const staged = stageArtifacts(archDir, artifactSet());
  supersedeTo(treeRoot, 2);
  fs.writeFileSync(path.join(revisionDirOf(archDir, 1), 'plan.md'), '# tampered\n');

  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest, mindOpts(1)),
    /is not live \(generation 2 is\)/
  );
});

// The authoritative check is the one INSIDE the lock, and this is the window
// that proves it: the supersede lands after the cheap precondition has
// already passed and before the guard takes the lifecycle lock. Only a check
// adjacent to the write catches it — which is the exact sequence the review
// described.
function promoteWithPauseDuringVerification(archDir, revision, digest, opts, signalPath, pauseMs) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-txn-verify-'));
  const scriptPath = path.join(scriptDir, 'promote-slow-verify.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const manifest = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'manifest.js'))});\n` +
      `const realVerify = manifest.verifyManifest;\n` +
      `const { signalPath, pauseMs, args } = JSON.parse(process.argv[2]);\n` +
      `let seen = 0;\n` +
      `manifest.verifyManifest = function (...a) {\n` +
      `  const out = realVerify(...a);\n` +
      `  if (++seen === 1) {\n` +
      `    fs.writeFileSync(signalPath, 'verifying');\n` +
      `    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs);\n` +
      `  }\n` +
      `  return out;\n` +
      `};\n` +
      `const txn = require(${JSON.stringify(MODULE_PATH)});\n` +
      `txn.promoteStaged(...args);\n`
  );
  return spawn(process.execPath, [scriptPath, JSON.stringify({ signalPath, pauseMs, args: [archDir, revision, digest, opts] })], {
    stdio: 'ignore',
  });
}

test('a supersede that lands while the manifest is verified stops the promotion', async () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  const staged = stageArtifacts(archDir, artifactSet());
  const signalPath = path.join(treeRoot, 'verifying');

  const child = promoteWithPauseDuringVerification(
    archDir,
    1,
    staged.artifacts_digest,
    mindOpts(1),
    signalPath,
    500
  );
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  await waitForWindow(signalPath, child);

  // Generation 1 passed the cheap precondition a moment ago and is retired
  // now. The lifecycle lock is free — the promotion has not reached it yet.
  supersedeTo(treeRoot, 2);

  assert.notEqual(await exited, 0, 'the promotion must not succeed on a generation retired mid-flight');
  assert.throws(() => readCurrent(archDir), /no promoted revision/);
});

// The cross-process race M2 named: the generation check and the marker write
// must be one step with respect to lifecycle writes, or a promotion can pass
// the check, be superseded while the manifest is verified, and still write a
// marker attributed to a generation that is no longer seated.
//
// Forced rather than raced. The child pauses INSIDE the promotion, at the
// moment it is about to write the marker; the parent then tries to supersede.
// If the lifecycle lock is held across check-and-write, the supersede cannot
// land until the marker exists, and the retire's own timestamp says so.
function promoteWithPauseBeforeMarker(archDir, revision, digest, opts, signalPath, pauseMs) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-txn-race-'));
  const scriptPath = path.join(scriptDir, 'promote-slow.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const atomicJson = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'atomic-json.js'))});\n` +
      `const realWrite = atomicJson.writeAtomic;\n` +
      `const { signalPath, pauseMs, args } = JSON.parse(process.argv[2]);\n` +
      `atomicJson.writeAtomic = function (file, value) {\n` +
      `  if (String(file).endsWith('revision.json')) {\n` +
      `    fs.writeFileSync(signalPath, 'in-window');\n` +
      `    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs);\n` +
      `  }\n` +
      `  return realWrite(file, value);\n` +
      `};\n` +
      `const txn = require(${JSON.stringify(MODULE_PATH)});\n` +
      `txn.promoteStaged(...args);\n`
  );
  return spawn(process.execPath, [scriptPath, JSON.stringify({ signalPath, pauseMs, args: [archDir, revision, digest, opts] })], {
    stdio: 'ignore',
  });
}

test('a supersede cannot land between the generation check and the marker write', async () => {
  const { treeRoot, archDir } = makeTree();
  seatMind(treeRoot, 1);
  const staged = stageArtifacts(archDir, artifactSet());
  const signalPath = path.join(treeRoot, 'in-window');
  const PAUSE_MS = 500;

  const child = promoteWithPauseBeforeMarker(
    archDir,
    1,
    staged.artifacts_digest,
    mindOpts(1),
    signalPath,
    PAUSE_MS
  );
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  await waitForWindow(signalPath, child);

  // The child is now inside the guarded window. This is the write that must
  // not be allowed to interleave.
  supersedeTo(treeRoot, 2);
  assert.equal(await exited, 0);

  const markerWrittenAt = fs.statSync(markerPathOf(archDir)).mtimeMs;
  const retire = readRecords(path.join(treeRoot, 'ledger.jsonl')).records.find(
    (record) => record.kind === 'mind-retire'
  );
  assert.ok(
    Date.parse(retire.ts) >= markerWrittenAt - 50,
    `the retire landed ${markerWrittenAt - Date.parse(retire.ts)}ms BEFORE the marker it should have waited for`
  );
  // And the promotion that won the race is attributed to the generation that
  // was genuinely live when it was written.
  assert.equal(readCurrent(archDir).marker.mind_generation, 1);
});

// ---------- readCurrent ----------

test('readCurrent refuses a tree with nothing promoted yet', () => {
  const { archDir } = makeTree();
  stageArtifacts(archDir, artifactSet());

  assert.throws(() => readCurrent(archDir), /no promoted revision/);
});

test('readCurrent refuses a live revision that has drifted from its manifest', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  fs.writeFileSync(path.join(revisionDirOf(archDir, 1), 'plan.md'), '# Plan\n\nedited in place.\n');

  assert.throws(() => readCurrent(archDir), /does not match its own manifest.*plan\.md.*changed/);
});

test('readCurrent refuses a live revision whose manifest was replaced with a shrunk one', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  const manifestPath = path.join(revisionDirOf(archDir, 1), 'manifest.json');
  const shrunk = readJson(manifestPath, null);
  shrunk.artifacts = shrunk.artifacts.filter((entry) => entry.path !== 'plan.md');
  writeAtomic(manifestPath, shrunk);

  assert.throws(() => readCurrent(archDir), /not the five canonical architecture artifacts/);
});

test('readCurrent refuses a live revision whose content was swapped consistently with its manifest', () => {
  const { archDir } = makeTree();
  stagePromoted(archDir, artifactSet());

  // Rewriting an artifact AND its manifest entry together leaves a revision
  // that verifies against itself perfectly. What catches it is the marker: it
  // recorded the digest of the manifest that actually went live, so the
  // sanctioned read refuses content no promotion ever vouched for.
  const revisionDir = revisionDirOf(archDir, 1);
  fs.writeFileSync(path.join(revisionDir, 'plan.md'), '# Plan\n\nswapped under the live revision.\n');
  const manifestPath = path.join(revisionDir, 'manifest.json');
  const manifest = readJson(manifestPath, null);
  writeAtomic(manifestPath, {
    ...manifest,
    artifacts: manifest.artifacts.map((entry) =>
      entry.path === 'plan.md'
        ? {
            path: 'plan.md',
            digest: `sha256:${crypto
              .createHash('sha256')
              .update(fs.readFileSync(path.join(revisionDir, 'plan.md')))
              .digest('hex')}`,
          }
        : entry
    ),
  });
  assert.equal(verifyManifest(revisionDir, readJson(manifestPath, null)).ok, true);

  assert.throws(() => readCurrent(archDir), /no longer carries the manifest it was promoted with/);
});

// ---------- the transaction lock ----------

test('a process KILLED inside the transaction blocks a successor until its lock goes stale, then the successor completes', () => {
  const { archDir } = makeTree();
  const staged = stageArtifacts(archDir, artifactSet());
  const lockFile = path.join(archDir, 'architecture-txn.lock');
  const readyFile = path.join(archDir, 'holder-ready');

  // A real process, really holding this module's lock, really SIGKILLed —
  // not a hand-placed file. SIGKILL runs no finally block, so the lock it
  // was holding survives it exactly as a power loss would leave it.
  const holder = spawn(
    process.execPath,
    [
      '-e',
      `const { withLock } = require(${JSON.stringify(path.resolve(__dirname, '..', 'src', 'jsonl.js'))});\n` +
        `withLock(${JSON.stringify(path.join(archDir, 'architecture-txn'))}, () => {\n` +
        `  require('node:fs').writeFileSync(${JSON.stringify(readyFile)}, 'held');\n` +
        `  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);\n` +
        `});\n`,
    ],
    { stdio: 'ignore' }
  );
  try {
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(readyFile) && Date.now() < deadline) {
      execFileSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)']);
    }
    assert.ok(fs.existsSync(readyFile), 'the holder never acquired the lock');
    assert.ok(fs.existsSync(lockFile), 'the holder left no lock file to inherit');
  } finally {
    holder.kill('SIGKILL');
  }

  // The immediate post-kill window: the lock is orphaned but not yet stale
  // (LOCK_STALE_MS is 30s, LOCK_TIMEOUT_MS is 5s), so a successor waits out
  // its whole timeout and fails closed rather than stealing a lock that might
  // still be held. This is the real cost of a killed process, and it is the
  // half of the behavior a backdated file can never show.
  assert.throws(
    () => promoteStaged(archDir, 1, staged.artifacts_digest),
    (err) => err.code === 'ELOCKTIMEOUT' && /timed out waiting for the append lock/.test(err.message)
  );
  assert.equal(fs.existsSync(lockFile), true);

  // Once it is older than the stale threshold, the successor reclaims it and
  // finishes the work — the recovery a crashed session depends on.
  const stale = new Date(Date.now() - 60_000);
  fs.utimesSync(lockFile, stale, stale);

  const receipt = promoteStaged(archDir, 1, staged.artifacts_digest);

  assert.equal(receipt.revision, 1);
  assert.equal(fs.existsSync(lockFile), false);
});

// ---------- reopenThroughTxn ----------

test('reopenThroughTxn seals the rejected digest and reopens the phase in one transaction', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);

  const receipt = reopenThroughTxn(
    archDir,
    { rationale: RATIONALE, rejected_digest: DIGEST },
    reopenOpts(treeRoot)
  );

  assert.equal(receipt.rejected_digest, DIGEST);
  // The operator's own words are kept verbatim on the seal...
  assert.equal(receipt.seal.rationale, RATIONALE);
  assert.equal(receipt.seal.revision, 1);
  assert.deepEqual(receipt.seal, readJson(receipt.sealPath, null));
  assert.equal(receipt.seal.reopen.from, 'plan_gate');
  assert.equal(receipt.seal.reopen.to, 'architecture');
  assert.equal(receipt.seal.reopen.seq, reopenRecords(treeRoot)[0].seq);

  // ...while the ledger record carries the rejected digest, so the record is
  // owned by exactly one rejection and says which architecture it was about.
  assert.equal(reopenRecords(treeRoot)[0].rationale, composedRationale(RATIONALE, DIGEST));

  const state = readJson(path.join(treeRoot, 'state.json'), null);
  assert.equal(state.phase, 'architecture');
  assert.equal(state.phase_status.architecture, undefined);
  assert.equal(reopenRecords(treeRoot).length, 1);
});

test('reopenThroughTxn finishes a reopen whose ledger record landed but whose STATE never did', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);

  // phases.js is ledger-first: it appends the phase-reopen record and only
  // then rewrites state.json. A crash between those two durable writes leaves
  // a record for a reopen that never took effect — so a recovery that trusts
  // the record alone reports success on a tree still sitting at the gate.
  const sealPath = sealPathOf(archDir, DIGEST);
  writeAtomic(sealPath, pendingSeal(treeRoot));
  appendReopenRecord(treeRoot, composedRationale(RATIONALE, DIGEST));
  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'plan_gate');

  const receipt = reopenThroughTxn(archDir, { rationale: RATIONALE, rejected_digest: DIGEST }, reopenOpts(treeRoot));

  // The transaction is only complete when the state transition is on disk.
  const state = readJson(path.join(treeRoot, 'state.json'), null);
  assert.equal(state.phase, 'architecture');
  assert.equal(state.phase_status.architecture, undefined);
  // Recovery appended its own record; the receipt cites the one that landed.
  const records = reopenRecords(treeRoot);
  assert.equal(records.length, 2);
  assert.equal(receipt.seal.reopen.seq, records[1].seq);
});

test('reopenThroughTxn finishes a state-less reopen in a FRESH NODE PROCESS', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const sealPath = sealPathOf(archDir, DIGEST);
  writeAtomic(sealPath, pendingSeal(treeRoot));
  appendReopenRecord(treeRoot, composedRationale(RATIONALE, DIGEST));

  const replayed = replayInFreshProcess('reopenThroughTxn', [
    archDir,
    { rationale: RATIONALE, rejected_digest: DIGEST },
    { registry: loadRegistry(REGISTRY_PATH), statePath: path.join(treeRoot, 'state.json') },
  ]);

  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'architecture');
  assert.equal(replayed.seal.reopen.to, 'architecture');
});

test('reopenThroughTxn re-entered after a crash between the seal and the reopen completes the reopen', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);

  // The crash point: the digest is sealed, and nothing else happened.
  const sealPath = sealPathOf(archDir, DIGEST);
  writeAtomic(sealPath, pendingSeal(treeRoot));
  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'plan_gate');

  const receipt = reopenThroughTxn(archDir, { rationale: RATIONALE, rejected_digest: DIGEST }, reopenOpts(treeRoot));

  assert.equal(receipt.seal.reopen.from, 'plan_gate');
  assert.equal(receipt.seal.reopen.to, 'architecture');
  assert.equal(receipt.seal.rejected_at, '2026-01-01T00:00:00.000Z');
  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'architecture');
  assert.equal(reopenRecords(treeRoot).length, 1);
});

test('reopenThroughTxn finishes a seal-only crash in a FRESH NODE PROCESS', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  writeAtomic(sealPathOf(archDir, DIGEST), pendingSeal(treeRoot));

  const replayed = replayInFreshProcess('reopenThroughTxn', [
    archDir,
    { rationale: RATIONALE, rejected_digest: DIGEST },
    { registry: loadRegistry(REGISTRY_PATH), statePath: path.join(treeRoot, 'state.json') },
  ]);

  assert.equal(replayed.seal.reopen.to, 'architecture');
  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'architecture');
  assert.equal(reopenRecords(treeRoot).length, 1);
});

test('reopenThroughTxn adopts a LANDED reopen whose seal never recorded it, in a FRESH NODE PROCESS', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };
  const first = reopenThroughTxn(archDir, args, reopenOpts(treeRoot));
  writeAtomic(first.sealPath, { ...first.seal, reopen: null });

  const replayed = replayInFreshProcess('reopenThroughTxn', [
    archDir,
    args,
    { registry: loadRegistry(REGISTRY_PATH), statePath: path.join(treeRoot, 'state.json') },
  ]);

  assert.deepEqual(replayed, first);
  assert.equal(reopenRecords(treeRoot).length, 1);
});

test('reopenThroughTxn re-entered after a crash between a LANDED reopen and the seal adopts it without reopening twice', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };

  // The crash point: the reopen fully landed — record appended AND state
  // rewritten — but the seal never recorded it. A re-entry that simply called
  // reopenPhase again would be refused by it, since architecture is no longer
  // complete to rewind to.
  const first = reopenThroughTxn(archDir, args, reopenOpts(treeRoot));
  writeAtomic(first.sealPath, { ...first.seal, reopen: null });
  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'architecture');

  const receipt = reopenThroughTxn(archDir, args, reopenOpts(treeRoot));

  assert.deepEqual(receipt, first);
  assert.equal(reopenRecords(treeRoot).length, 1);
});

test('reopenThroughTxn called again after success returns the identical receipt and reopens nothing twice', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };

  const first = reopenThroughTxn(archDir, args, reopenOpts(treeRoot));
  const after = snapshot(archDir, treeRoot);

  const second = reopenThroughTxn(archDir, args, reopenOpts(treeRoot));

  assert.deepEqual(second, first);
  assert.deepEqual(snapshot(archDir, treeRoot), after);
});

test('reopenThroughTxn replayed after the tree has MOVED ON returns the receipt without reopening again', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };

  const first = reopenThroughTxn(archDir, args, reopenOpts(treeRoot));

  // The repair happened and the tree walked back up to the gate. A replay of
  // the old rejection now finds a phase that is complete again and a state
  // that no longer looks reopened — and must still do nothing, because its
  // own seal already records that this rejection's reopen landed. Re-deriving
  // the answer from the tree instead of from the seal would rewind a phase
  // the tree has legitimately moved past.
  stateAtPlanGate(treeRoot);
  const after = snapshot(archDir, treeRoot);

  const replayed = reopenThroughTxn(archDir, args, reopenOpts(treeRoot));

  assert.deepEqual(replayed, first);
  assert.deepEqual(snapshot(archDir, treeRoot), after);
  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'plan_gate');
  assert.equal(reopenRecords(treeRoot).length, 1);
});

test('reopenThroughTxn replayed in a FRESH NODE PROCESS returns the identical receipt and changes nothing', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };
  const first = reopenThroughTxn(archDir, args, reopenOpts(treeRoot));
  const after = snapshot(archDir, treeRoot);

  const replayed = replayInFreshProcess('reopenThroughTxn', [
    archDir,
    args,
    { registry: loadRegistry(REGISTRY_PATH), statePath: path.join(treeRoot, 'state.json') },
  ]);

  assert.deepEqual(replayed, first);
  assert.deepEqual(snapshot(archDir, treeRoot), after);
});

test('reopenThroughTxn reopens again for a NEW digest that reuses an earlier rejection\'s rationale', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);

  const first = reopenThroughTxn(archDir, { rationale: RATIONALE, rejected_digest: DIGEST }, reopenOpts(treeRoot));

  // The architecture was repaired and walked back up to the gate, and the
  // operator's objection this time is worded exactly as it was before — the
  // likeliest case of all, since a recurrence is what gets described in the
  // same words. A rejection's identity is its digest, never its prose.
  stagePromoted(archDir, revisedSet());
  stateAtPlanGate(treeRoot);

  const second = reopenThroughTxn(
    archDir,
    { rationale: RATIONALE, rejected_digest: OTHER_DIGEST },
    reopenOpts(treeRoot)
  );

  const records = reopenRecords(treeRoot);
  assert.equal(records.length, 2);
  assert.equal(first.seal.reopen.seq, records[0].seq);
  assert.equal(second.seal.reopen.seq, records[1].seq);
  assert.equal(second.seal.revision, 2);
  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'architecture');
});

test('reopenThroughTxn refuses a seal whose durable payload does not match this rejection', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const sealPath = sealPathOf(archDir, DIGEST);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };

  const wellFormed = pendingSeal(treeRoot);
  const goodReopen = { from: 'plan_gate', to: 'architecture', seq: 0 };
  // The path carries the intended identity; it does not vouch for the record
  // stored at it. Every field the transaction would go on to trust is checked.
  for (const [broken, pattern] of [
    [{ ...wellFormed, rejected_digest: OTHER_DIGEST }, /records rejected_digest .*, not sha256:a/],
    [{ ...wellFormed, rationale: 'a different reason entirely' }, /already sealed with a different rationale/],
    [{ ...wellFormed, schema_version: 7 }, /declares schema_version 7/],
    [{ ...wellFormed, revision: 'one' }, /records revision "one"/],
    [{ ...wellFormed, rejected_at: '' }, /carries no rejected_at/],
    [{ ...wellFormed, context: undefined }, /carries no readable reopen context/],
    [{ ...wellFormed, context: { ...wellFormed.context, state_digest: 'nope' } }, /carries no readable reopen context/],
    // A seal with no source phase names no reopen: the record lookup would
    // match nothing, and without this the transaction discovers that only
    // AFTER reopenPhase has already moved the tree.
    [{ ...wellFormed, context: { ...wellFormed.context, from_phase: '' } }, /carries no readable reopen context/],
    [{ ...wellFormed, reopen: 'done' }, /not a \{from, to, seq\} record reference/],
    [{ ...wellFormed, reopen: { from: 'plan_gate', to: 'architecture' } }, /not a \{from, to, seq\} record reference/],
    [{ ...wellFormed, reopen: { ...goodReopen, seq: -1 } }, /not a \{from, to, seq\} record reference/],
    [{ ...wellFormed, refused: {} }, /records a refusal with no reason/],
    [
      { ...wellFormed, reopen: goodReopen, refused: { reason: 'x', refused_at: 'now' } },
      /both a completed reopen and a refusal/,
    ],
    // F9's binding: a seal claiming a completed reopen is authoritative only
    // once the record it names is shown to exist and to BE that record.
    [{ ...wellFormed, reopen: goodReopen }, /records a reopen at seq 0, which is not in/],
  ]) {
    writeAtomic(sealPath, broken);
    const before = snapshot(archDir, treeRoot);
    assert.throws(() => reopenThroughTxn(archDir, args, reopenOpts(treeRoot)), pattern);
    assert.deepEqual(snapshot(archDir, treeRoot), before);
  }
});

test('reopenThroughTxn refuses a completed seal whose named record is not the reopen it claims', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };

  // A real record at that seq, for a DIFFERENT rejection. Without the binding
  // check a seal could name any record in the ledger and be believed.
  const seq = appendReopenRecord(treeRoot, composedRationale(RATIONALE, OTHER_DIGEST));
  writeAtomic(
    sealPathOf(archDir, DIGEST),
    pendingSeal(treeRoot, { reopen: { from: 'plan_gate', to: 'architecture', seq } })
  );
  const before = snapshot(archDir, treeRoot);

  assert.throws(
    () => reopenThroughTxn(archDir, args, reopenOpts(treeRoot)),
    /is not the phase-reopen this seal claims/
  );
  assert.deepEqual(snapshot(archDir, treeRoot), before);
});

test('reopenThroughTxn refuses a completed seal pointing at a record of the wrong KIND', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };

  // A record carrying this rejection's exact from/to/rationale — but it is a
  // phase-TRANSITION, not a reopen. Only the kind discriminates it, which is
  // why the kind is checked rather than inferred from the fields happening to
  // line up.
  const seq = appendRecord(path.join(treeRoot, 'ledger.jsonl'), {
    kind: 'phase-transition',
    payload: { from: 'plan_gate', to: 'architecture', rationale: composedRationale(RATIONALE, DIGEST) },
    correlation_id: 'architecture',
  });
  writeAtomic(
    sealPathOf(archDir, DIGEST),
    pendingSeal(treeRoot, { reopen: { from: 'plan_gate', to: 'architecture', seq } })
  );

  assert.throws(
    () => reopenThroughTxn(archDir, args, reopenOpts(treeRoot)),
    /is not the phase-reopen this seal claims/
  );
});

test('a pending seal whose state context is GONE is closed unfinished, and re-entry reproduces that refusal', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };
  const sealPath = sealPathOf(archDir, DIGEST);

  // Sealed against the tree at the gate, then the crash — and by the time a
  // successor runs, the tree has been driven somewhere else entirely. The
  // reopen this rejection authorized was authorized against a state that no
  // longer exists, so it must not be applied to whatever state is there now.
  writeAtomic(sealPath, pendingSeal(treeRoot));
  writeAtomic(path.join(treeRoot, 'state.json'), {
    schema_version: 1,
    phase: 'implementation',
    phase_status: { architecture: 'complete', plan_gate: 'complete' },
    next_action: 'implementation',
    updated_utc: '2026-02-02T00:00:00.000Z',
  });

  assert.throws(
    () => reopenThroughTxn(archDir, args, reopenOpts(treeRoot)),
    /state\.json has changed since the rejection was sealed/
  );

  // The refusal is durable and terminal: the seal is closed, not left pending
  // for the next session to re-evaluate against a third state.
  const closed = readJson(sealPath, null);
  assert.equal(closed.reopen, null);
  assert.match(closed.refused.reason, /state\.json has changed/);
  assert.equal(reopenRecords(treeRoot).length, 0);
  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'implementation');

  const after = snapshot(archDir, treeRoot);
  assert.throws(
    () => reopenThroughTxn(archDir, args, reopenOpts(treeRoot)),
    /closed unfinished .* and cannot be resumed/
  );
  assert.deepEqual(snapshot(archDir, treeRoot), after);
  assert.equal(reopenRecords(treeRoot).length, 0);
});

test('the sealed context is the ONE state the precheck read, even if state.json changes underneath', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  const statePath = stateAtPlanGate(treeRoot);
  const atGate = fs.readFileSync(statePath);

  // The precheck and the context must come from a single read. With two
  // independent reads, a write landing between them lets the seal bind a
  // context no precheck ever approved — the authorization would describe one
  // state and the binding another. Forced here by serving the first read of
  // state.json from the gate and every later read from a tree that has moved
  // on, in a child process so the patch touches nothing else.
  const moved = JSON.stringify(
    {
      schema_version: 1,
      phase: 'implementation',
      phase_status: { onboarding: 'complete', brainstorm: 'complete', research: 'complete' },
      next_action: 'implementation',
      updated_utc: '2026-02-02T00:00:00.000Z',
    },
    null,
    2
  );

  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-txn-race-'));
  const scriptPath = path.join(scriptDir, 'race.js');
  fs.writeFileSync(
    scriptPath,
    `'use strict';\n` +
      `const fs = require('node:fs');\n` +
      `const real = fs.readFileSync;\n` +
      `let seen = 0;\n` +
      `fs.readFileSync = (file, ...rest) => {\n` +
      `  if (String(file) === ${JSON.stringify(statePath)}) {\n` +
      `    seen += 1;\n` +
      `    const body = seen === 1 ? ${JSON.stringify(atGate.toString('utf8'))} : ${JSON.stringify(moved)};\n` +
      `    return rest[0] ? body : Buffer.from(body);\n` +
      `  }\n` +
      `  return real(file, ...rest);\n` +
      `};\n` +
      `const txn = require(${JSON.stringify(MODULE_PATH)});\n` +
      `const { loadRegistry } = require(${JSON.stringify(path.resolve(__dirname, '..', 'src', 'phases.js'))});\n` +
      `try {\n` +
      `  txn.reopenThroughTxn(${JSON.stringify(archDir)}, ${JSON.stringify({
        rationale: RATIONALE,
        rejected_digest: DIGEST,
      })}, { registry: loadRegistry(${JSON.stringify(REGISTRY_PATH)}), statePath: ${JSON.stringify(statePath)} });\n` +
      `} catch {}\n` +
      `process.stdout.write(real(${JSON.stringify(sealPathOf(archDir, DIGEST))}, 'utf8'));\n`
  );
  const sealed = JSON.parse(execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' }));

  // Whatever else happened, the seal binds the state the precheck approved:
  // the phase it saw, and the digest of those same bytes.
  assert.equal(sealed.context.from_phase, 'plan_gate');
  assert.equal(sealed.context.state_digest, `sha256:${crypto.createHash('sha256').update(atGate).digest('hex')}`);
});

test('a pending seal is not finalized from a landed record whose FROM is not the one it bound', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  const statePath = stateAtPlanGate(treeRoot);
  const sealPath = sealPathOf(archDir, DIGEST);

  // Sealed while the tree was at the gate, so the reopen it authorized is the
  // one out of plan_gate.
  writeAtomic(sealPath, pendingSeal(treeRoot));
  assert.equal(readJson(sealPath, null).context.from_phase, 'plan_gate');

  // A reopen that really landed — but out of a different phase entirely. It
  // shares this rejection's target and rationale, so kind/to/rationale alone
  // cannot tell it apart from the reopen this seal is owed.
  appendRecord(path.join(treeRoot, 'ledger.jsonl'), {
    kind: 'phase-reopen',
    payload: { from: 'implementation', to: 'architecture', rationale: composedRationale(RATIONALE, DIGEST) },
    correlation_id: 'architecture',
  });
  writeAtomic(statePath, {
    schema_version: 1,
    phase: 'architecture',
    phase_status: { onboarding: 'complete', brainstorm: 'complete', research: 'complete' },
    next_action: 'architecture',
    updated_utc: '2026-02-02T00:00:00.000Z',
  });

  assert.throws(
    () => reopenThroughTxn(archDir, { rationale: RATIONALE, rejected_digest: DIGEST }, reopenOpts(treeRoot)),
    /state\.json has changed since the rejection was sealed/
  );

  // The seal never adopted the stranger's reopen as its own completion.
  const closed = readJson(sealPath, null);
  assert.equal(closed.reopen, null);
  assert.match(closed.refused.reason, /state\.json has changed/);
});

test('a pending seal refuses to be applied to a DIFFERENT target phase than it was sealed for', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  writeAtomic(sealPathOf(archDir, DIGEST), pendingSeal(treeRoot));
  const before = snapshot(archDir, treeRoot);

  assert.throws(
    () =>
      reopenThroughTxn(archDir, { rationale: RATIONALE, rejected_digest: DIGEST }, {
        ...reopenOpts(treeRoot),
        targetPhaseId: 'research',
      }),
    /sealed to reopen "architecture", but this call targets "research"/
  );
  assert.deepEqual(snapshot(archDir, treeRoot), before);
});

test('a pending seal is closed unfinished when a REGISTRY change makes its reopen impossible', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const sealPath = sealPathOf(archDir, DIGEST);
  writeAtomic(sealPath, pendingSeal(treeRoot));

  // state.json is byte-identical to what the precheck saw, so the sealed
  // context holds — but the registry the successor loads has moved
  // architecture after plan_gate, and reopenPhase would refuse. The sealed
  // context holding is not on its own enough; the preconditions must still be
  // true against the registry this session actually has.
  const registry = loadRegistry(REGISTRY_PATH);
  const reordered = {
    ...registry,
    phases: registry.phases.map((phase) => (phase.id === 'architecture' ? { ...phase, order: 9 } : phase)),
  };

  assert.throws(
    () =>
      reopenThroughTxn(archDir, { rationale: RATIONALE, rejected_digest: DIGEST }, {
        registry: reordered,
        statePath: path.join(treeRoot, 'state.json'),
      }),
    /is not strictly earlier than the current phase "plan_gate"/
  );

  const closed = readJson(sealPath, null);
  assert.match(closed.refused.reason, /not strictly earlier/);
  assert.equal(closed.reopen, null);
  assert.equal(reopenRecords(treeRoot).length, 0);
});

test('a TRANSIENT failure leaves the pending seal pending, never converted into a refusal', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };
  const sealPath = sealPathOf(archDir, DIGEST);
  writeAtomic(sealPath, pendingSeal(treeRoot));

  // The sealed context still holds and every precondition is true, so this is
  // not a verdict about the rejection — it is the state lock being held by
  // someone else. A lock timeout must not close the seal.
  const stateLock = path.join(treeRoot, 'state.json.lock');
  fs.writeFileSync(stateLock, '');
  try {
    assert.throws(() => reopenThroughTxn(archDir, args, reopenOpts(treeRoot)), (err) => err.code === 'ELOCKTIMEOUT');
  } finally {
    fs.rmSync(stateLock, { force: true });
  }

  const stillPending = readJson(sealPath, null);
  assert.equal(stillPending.refused, null);
  assert.equal(stillPending.reopen, null);

  // And with the transient condition gone, the same call finishes the work.
  const receipt = reopenThroughTxn(archDir, args, reopenOpts(treeRoot));
  assert.equal(receipt.seal.reopen.to, 'architecture');
  assert.equal(readJson(path.join(treeRoot, 'state.json'), null).phase, 'architecture');
});

test('reopenThroughTxn refuses every way the reopen could not land, sealing nothing', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  const statePath = path.join(treeRoot, 'state.json');
  const args = { rationale: RATIONALE, rejected_digest: DIGEST };

  // Each of these is a way reopenPhase itself refuses. Every one must be
  // refused BEFORE the seal is written — a rejection sealed on disk for a
  // reopen that could never run is the half-transaction this module exists to
  // prevent.
  const cases = [
    // The target phase was never completed: nothing to rewind to.
    [{ phase: 'plan_gate', phase_status: { onboarding: 'complete' } }, {}, /phase "architecture" is not complete/],
    // The target is not strictly earlier than where the tree actually is.
    [
      { phase: 'brainstorm', phase_status: { architecture: 'complete' } },
      {},
      /is not strictly earlier than the current phase "brainstorm"/,
    ],
    // state.json names a phase the registry does not define.
    [{ phase: 'not_a_phase', phase_status: { architecture: 'complete' } }, {}, /which the registry does not define/],
    // The registry has no such target phase at all.
    [
      { phase: 'plan_gate', phase_status: { architecture: 'complete' } },
      { targetPhaseId: 'no_such_phase' },
      /no phase "no_such_phase" in the registry/,
    ],
  ];

  for (const [state, extraOpts, pattern] of cases) {
    writeAtomic(statePath, {
      schema_version: 1,
      next_action: 'plan_gate',
      updated_utc: '2026-01-01T00:00:00.000Z',
      ...state,
    });
    const before = snapshot(archDir, treeRoot);
    assert.throws(() => reopenThroughTxn(archDir, args, { ...reopenOpts(treeRoot), ...extraOpts }), pattern);
    assert.deepEqual(snapshot(archDir, treeRoot), before);
    assert.equal(fs.existsSync(path.join(archDir, 'rejected')), false);
  }
});

test('reopenThroughTxn refuses a missing state.json, sealing nothing', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  const before = snapshot(archDir, treeRoot);

  assert.throws(
    () => reopenThroughTxn(archDir, { rationale: RATIONALE, rejected_digest: DIGEST }, reopenOpts(treeRoot)),
    /no readable state\.json/
  );
  assert.deepEqual(snapshot(archDir, treeRoot), before);
  assert.equal(fs.existsSync(path.join(archDir, 'rejected')), false);
});

test('reopenThroughTxn refuses a malformed rejected_digest, an empty rationale, and a missing registry', () => {
  const { treeRoot, archDir } = makeTree();
  stagePromoted(archDir, artifactSet());
  stateAtPlanGate(treeRoot);
  const before = snapshot(archDir, treeRoot);

  assert.throws(
    () => reopenThroughTxn(archDir, { rationale: RATIONALE, rejected_digest: 'not-a-digest' }, reopenOpts(treeRoot)),
    /rejected_digest/
  );
  assert.throws(
    () => reopenThroughTxn(archDir, { rationale: '  ', rejected_digest: DIGEST }, reopenOpts(treeRoot)),
    /rationale/
  );
  assert.throws(
    () => reopenThroughTxn(archDir, { rationale: RATIONALE, rejected_digest: DIGEST }, {}),
    /opts\.registry/
  );
  assert.deepEqual(snapshot(archDir, treeRoot), before);
});
