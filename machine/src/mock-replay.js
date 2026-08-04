'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { isDeepStrictEqual } = require('node:util');

const jsonl = require('./jsonl.js');
const atomicJson = require('./atomic-json.js');
const projection = require('./projection.js');
const settings = require('./settings.js');
const validators = require('./validators.js');
const { checkHonesty, runGate } = require('./check-honesty.js');
const stream = require('./stream.js');
const routing = require('./routing.js');
const manifest = require('./manifest.js');
const scaffold = require('./scaffold.js');
const phases = require('./phases.js');
const planGate = require('./plan-gate.js');
const telemetry = require('./telemetry.js');
const detect = require('./detect.js');
const interviewPanels = require('./interview-panels.js');
const catalog = require('./catalog.js');
const researchCache = require('./research-cache.js');
const anonymize = require('./anonymize.js');
const slotAssignment = require('./slot-assignment.js');
const judgeVerdict = require('./judge-verdict.js');
const atomicText = require('./atomic-text.js');
const milestones = require('./milestones.js');
const toolchain = require('./toolchain.js');
const verification = require('./verification.js');
const quarantine = require('./quarantine.js');
const delivery = require('./delivery.js');
const scout = require('./scout.js');
const preflight = require('./preflight.js');
const receipts = require('./receipts.js');
const implementation = require('./implementation.js');
const architectureTxn = require('./architecture-txn.js');
const spine = require('./spine.js');
const promotion = require('./promotion.js');
const workflow = require('./workflow.js');
const timeouts = require('./timeouts.js');
const views = require('./views.js');
const friction = require('./friction.js');
const familyEvidence = require('./family-evidence.js');

const OPS = {
  'jsonl.appendLine': jsonl.appendLine,
  'jsonl.appendEvent': jsonl.appendEvent,
  'jsonl.readAll': jsonl.readAll,
  'atomicJson.writeAtomic': atomicJson.writeAtomic,
  'atomicJson.readJson': atomicJson.readJson,
  'projection.project': projection.project,
  'projection.projectFile': projection.projectFile,
  'settings.applySchema': settings.applySchema,
  'settings.loadSettings': settings.loadSettings,
  'settings.write': settings.write,
  'settings.read': settings.read,
  'validators.validateEnvelope': validators.validateEnvelope,
  'validators.validateBrief': validators.validateBrief,
  'validators.validateAffectedMap': validators.validateAffectedMap,
  'validators.validateScoutConstraints': validators.validateScoutConstraints,
  'validators.validateCriteriaRegister': validators.validateCriteriaRegister,
  'validators.validateMilestones': validators.validateMilestones,
  checkHonesty,
  'checkHonesty.runGate': runGate,
  'stream.appendRecord': stream.appendRecord,
  'stream.validateRecordHeader': stream.validateRecordHeader,
  'stream.readRecords': stream.readRecords,
  'routing.loadRouting': routing.loadRouting,
  'routing.setActive': routing.setActive,
  'routing.validateRoutingConfig': routing.validateRoutingConfig,
  'manifest.buildManifest': manifest.buildManifest,
  'manifest.writeManifest': manifest.writeManifest,
  'manifest.verifyManifest': manifest.verifyManifest,
  'scaffold.scaffoldTree': scaffold.scaffoldTree,
  'scaffold.scaffoldArchitecture': scaffold.scaffoldArchitecture,
  'phases.loadRegistry': phases.loadRegistry,
  'phases.canEnter': phases.canEnter,
  'phases.advance': phases.advance,
  'phases.reopenPhase': phases.reopenPhase,
  'phases.resumePoint': phases.resumePoint,
  'phases.closeTerminal': phases.closeTerminal,
  'planGate.approveGate': planGate.approveGate,
  'planGate.verifyGate': planGate.verifyGate,
  'telemetry.enabled': telemetry.enabled,
  'telemetry.recordEvent': telemetry.recordEvent,
  'telemetry.status': telemetry.status,
  'telemetry.purge': telemetry.purge,
  'detect.detect': detect.detect,
  'interviewPanels.buildPanel3': interviewPanels.buildPanel3,
  // catalog._load (the unscoped whole-catalog loader) is deliberately NOT
  // wired in here — P4 Sol review BLOCKING-1. Only the scoped-serving
  // functions below are dispatcher-reachable.
  'catalog.categories': catalog.categories,
  'catalog.list': catalog.list,
  'catalog.show': catalog.show,
  'catalog.sample': catalog.sample,
  'researchCache.loadIndex': researchCache.loadIndex,
  'researchCache.upsertEntry': researchCache.upsertEntry,
  'researchCache.isFresh': researchCache.isFresh,
  'researchCache.requireFreshOrExplain': researchCache.requireFreshOrExplain,
  'researchCache.recordGateCheck': researchCache.recordGateCheck,
  'anonymize.anonymizeBundle': anonymize.anonymizeBundle,
  'slotAssignment.assignPlanSlot': slotAssignment.assignPlanSlot,
  'judgeVerdict.writeJudgeVerdict': judgeVerdict.writeJudgeVerdict,
  'atomicText.writeAtomicText': atomicText.writeAtomicText,
  'milestones.createMilestone': milestones.createMilestone,
  'milestones.recordChunk': milestones.recordChunk,
  'milestones.closeMilestone': milestones.closeMilestone,
  'toolchain.loadProfiles': toolchain.loadProfiles,
  'toolchain.validateProfiles': toolchain.validateProfiles,
  'toolchain.detectPackageManager': toolchain.detectPackageManager,
  'toolchain.probeSatisfied': toolchain.probeSatisfied,
  'toolchain.composeInstall': toolchain.composeInstall,
  'toolchain.scaffoldProfile': toolchain.scaffoldProfile,
  'verification.assembleSuite': verification.assembleSuite,
  'verification.orderRun': verification.orderRun,
  'verification.startRun': verification.startRun,
  'verification.recordRun': verification.recordRun,
  'verification.computeSuiteState': verification.computeSuiteState,
  'verification.recordAffected': verification.recordAffected,
  'verification.runJourney': verification.runJourney,
  'quarantine.recordOutcome': quarantine.recordOutcome,
  'quarantine.decideFlake': quarantine.decideFlake,
  'quarantine.release': quarantine.release,
  // capTracker(treeRoot) is a factory (vision §5.7's fix-loop cap, scoped to
  // one problemKey at a time) rather than a flat function, so it is curried
  // here into two flat ops — the same shape every other OPS entry takes —
  // instead of exposing the factory itself, which mock-replay's flat
  // (op, args[]) step shape has no way to call in two stages.
  'quarantine.capRecordAttempt': (treeRoot, problemKey) => quarantine.capTracker(treeRoot).recordAttempt(problemKey),
  'quarantine.capAtCap': (treeRoot, problemKey) => quarantine.capTracker(treeRoot).atCap(problemKey),
  'quarantine.capCheckAndRecord': (treeRoot, problemKey) => quarantine.capTracker(treeRoot).checkAndRecord(problemKey),
  'delivery.assembleLastMile': delivery.assembleLastMile,
  'delivery.renderFacts': delivery.renderFacts,
  'delivery.checkDeliveryReady': delivery.checkDeliveryReady,
  'scout.inventoryTarget': scout.inventoryTarget,
  'scout.writeReuseMap': scout.writeReuseMap,
  'scout.writeConstraints': scout.writeConstraints,
  'preflight.run': preflight.run,
  'receipts.recordProblem': receipts.recordProblem,
  'receipts.resolveRef': receipts.resolveRef,
  'receipts.writeDispatch': receipts.writeDispatch,
  'receipts.writeDispatchTerminal': receipts.writeDispatchTerminal,
  'receipts.writeWorkflowReturn': receipts.writeWorkflowReturn,
  'receipts.writeHoldOpen': receipts.writeHoldOpen,
  'receipts.writeHoldResolve': receipts.writeHoldResolve,
  'receipts.writeDegradedRoute': receipts.writeDegradedRoute,
  'receipts.writeMindOpen': receipts.writeMindOpen,
  'receipts.writeMindRetire': receipts.writeMindRetire,
  'receipts.supersedeMind': receipts.supersedeMind,
  'receipts.writeSteerRaise': receipts.writeSteerRaise,
  'receipts.writeSteerApply': receipts.writeSteerApply,
  'receipts.writeEnvelope': receipts.writeEnvelope,
  'implementation.stagedDiffDigest': implementation.stagedDiffDigest,
  'implementation.sealChunk': implementation.sealChunk,
  'implementation.closeMilestoneTxn': implementation.closeMilestoneTxn,
  // spine.js is a pure reader: it writes nothing and spawns nothing, so a
  // scenario can ask it anything about a tree it built and get an answer
  // with no way to reach past that tree.
  'spine.nextTransition': spine.nextTransition,
  'promotion.promoteArtifact': promotion.promoteArtifact,
  // Pure derivations, safe for a scenario for the same reason the resolver is:
  // they read a table and return a string. Nothing they touch can be named by
  // the scenario file, because both derive every path from the class and the
  // scope they are given.
  'promotion.stagedPathFor': promotion.stagedPathFor,
  'toolchain.composeSuite': toolchain.composeSuite,
  'architectureTxn.stageArtifacts': architectureTxn.stageArtifacts,
  'architectureTxn.promoteStaged': architectureTxn.promoteStaged,
  'architectureTxn.readCurrent': architectureTxn.readCurrent,
  'architectureTxn.reopenThroughTxn': architectureTxn.reopenThroughTxn,
  'workflow.snapshot': workflow.snapshot,
  'workflow.persistReceipt': workflow.persistReceipt,
  'workflow.invoke': workflow.invoke,
  // withBound is deliberately NOT wired: it returns a promise, and a replay
  // step compares a return value synchronously — a scenario could only ever
  // assert that a Promise object came back. Its behavior is covered where it
  // can actually be observed, in machine/test/timeouts.test.js.
  'timeouts.loadTable': timeouts.loadTable,
  'timeouts.boundFor': timeouts.boundFor,
  // NO ENTRY FROM dispatch.js IS WIRED HERE AT ALL, and the omission is the
  // whole module rather than the dangerous-looking half of it. Two reasons,
  // and the second is why nothing was kept:
  //
  //   - `dispatchProcess` and `dispatchCodex` return promises, which a replay
  //     step cannot compare — the same reason `withBound` is absent.
  //   - Every remaining entry point can reach `recoverOne`, and `recoverOne`
  //     sweeps a session with real signals. `receipts.writeDispatch` is wired
  //     right here, so a two-step scenario could fabricate a codex dispatch
  //     naming any live session on this machine and then have recovery kill
  //     it. Wiring only the "safe" functions would have left that path open
  //     through `dispatchNative`, and a fence with a way around it is not a
  //     fence. (The same reasoning keeps catalog._load out.)
  //
  // The wrapper's behavior is covered where a real child process can actually
  // be observed, in machine/test/dispatch.test.js.
  // family-evidence's own writes and reads are wired: none of them signal a
  // process, and every one is a pure function of the two streams plus the
  // dated routing table — which is exactly what a replay can assert against.
  'familyEvidence.recordBuilt': familyEvidence.recordBuilt,
  'familyEvidence.selectReviewer': familyEvidence.selectReviewer,
  'familyEvidence.selectMilestoneReviewer': familyEvidence.selectMilestoneReviewer,
  'familyEvidence.verifyReviewFamily': familyEvidence.verifyReviewFamily,
  // NO ENTRY FROM capsule.js IS WIRED HERE, and the omission is the whole
  // module for the same reason dispatch.js's is. Every function in it mutates
  // something real: openCapsule adds a git worktree to a repository,
  // applyToStaging writes that repository's index, closeCapsule deletes a
  // directory tree with --force. A scenario runs in a bare mkdtemp sandbox and
  // takes its arguments from a file, so wiring any of them would hand a
  // scenario file the ability to name a repository somewhere else on the
  // machine and stage or delete inside it. Nothing that mutates a real tree is
  // reachable from a scenario. Its behavior is covered against throwaway
  // repositories in machine/test/capsule.test.js.
  'views.regenerate': views.regenerate,
  'friction.rates': friction.rates,
  'friction.listOpenHolds': friction.listOpenHolds,
};

// Resolves a '$TMP'-rooted path to an absolute path and refuses to let it
// escape the sandbox directory via traversal ('$TMP/../x') or a bare-prefix
// sibling ('$TMPx' is left untouched below, never reaching here as a path).
function resolveInSandbox(rawPath, sandboxDir) {
  const suffix = rawPath.slice('$TMP'.length); // '' or starts with '/'
  const resolved = path.resolve(sandboxDir, '.' + suffix);
  const sandboxWithSep = sandboxDir.endsWith(path.sep) ? sandboxDir : sandboxDir + path.sep;
  if (resolved !== sandboxDir && !resolved.startsWith(sandboxWithSep)) {
    throw new Error(`mock-replay: path "${rawPath}" escapes the sandbox root`);
  }
  return resolved;
}

// Rewrites every string that is exactly '$TMP' or starts with '$TMP/' (at any
// depth of args, since ops like checkHonesty take a single options object
// carrying path fields) into a path resolved and contained under the per-run
// sandbox directory. A string merely prefixed with '$TMP' (e.g. '$TMPfoo') is
// not a sandbox path and is left untouched rather than resolved to a sibling
// of the sandbox directory.
function rewriteTmp(value, sandboxDir) {
  if (typeof value === 'string') {
    if (value === '$TMP') return sandboxDir;
    if (value.startsWith('$TMP/')) return resolveInSandbox(value, sandboxDir);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteTmp(entry, sandboxDir));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = rewriteTmp(value[key], sandboxDir);
    }
    return out;
  }
  return value;
}

function stripIgnored(value, ignore) {
  if (!Array.isArray(ignore) || ignore.length === 0) return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = { ...value };
  for (const key of ignore) {
    delete out[key];
  }
  return out;
}

function runStep(step, sandboxDir) {
  const fn = OPS[step.op];

  try {
    const args = rewriteTmp(step.args || [], sandboxDir);
    if (typeof fn !== 'function') {
      throw new Error(`mock-replay: unknown op "${step.op}"`);
    }
    const returnValue = fn(...args);

    if (step.expectError) {
      return { op: step.op, ok: false, detail: `expected error containing "${step.expectError}" but call succeeded` };
    }
    if (Object.prototype.hasOwnProperty.call(step, 'expect')) {
      const actual = stripIgnored(returnValue, step.ignore);
      if (isDeepStrictEqual(actual, step.expect)) {
        return { op: step.op, ok: true, detail: 'ok' };
      }
      return {
        op: step.op,
        ok: false,
        detail: `expect mismatch: actual=${JSON.stringify(actual)} expected=${JSON.stringify(step.expect)}`,
      };
    }
    return { op: step.op, ok: true, detail: 'ok' };
  } catch (err) {
    if (step.expectError) {
      if (typeof err.message === 'string' && err.message.includes(step.expectError)) {
        return { op: step.op, ok: true, detail: 'ok (expected error)' };
      }
      return {
        op: step.op,
        ok: false,
        detail: `error message "${err.message}" does not contain expected substring "${step.expectError}"`,
      };
    }
    return { op: step.op, ok: false, detail: `unexpected error: ${err.message}` };
  }
}

function replay(scenarioPath, opts = {}) {
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  const tmpRoot = opts.tmpRoot || os.tmpdir();
  const sandboxDir = fs.mkdtempSync(path.join(tmpRoot, 'mock-replay-'));

  const results = [];
  const t0 = performance.now();
  try {
    for (const step of scenario.steps) {
      results.push(runStep(step, sandboxDir));
    }
  } finally {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }
  const ms = performance.now() - t0;

  const failed = results.filter((r) => !r.ok).length;
  const passed = results.length - failed;

  return { name: scenario.name, passed, failed, results, ms };
}

function main(argv) {
  const [scenarioPath] = argv;
  if (!scenarioPath) {
    process.stderr.write('usage: mock-replay.js <scenarioPath>\n');
    process.exit(1);
  }
  const outcome = replay(scenarioPath);
  for (const result of outcome.results) {
    console.log(`[${result.ok ? 'PASS' : 'FAIL'}] ${result.op} - ${result.detail}`);
  }
  console.log(`Total: ${outcome.passed} passed, ${outcome.failed} failed (${outcome.ms.toFixed(2)}ms)`);
  process.exit(outcome.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { replay, OPS };
