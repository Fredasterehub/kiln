'use strict';

// dispatch.js — every seat dispatch, wrapped: a receipt before the work, the
// timeout law around it, and exactly one terminal after it, whatever happened.
//
// There are two transports and they are shapes, not vendors. A NATIVE dispatch
// is an Agent-tool step the workflow itself runs, so this module cannot hold
// it: it opens the dispatch, hands back the bound the workflow must keep AND
// whether to run the step at all, and closes the terminal afterwards from the
// evidence the step produced — `dispatchNative` and `completeNative` are one
// pair with the agent turn between them. A PROCESS dispatch is a child this
// module owns end to end: `dispatchProcess` launches it detached, gates it
// until its receipt is durable, holds it to its class bound, and on timeout
// sweeps it dead. `dispatchCodex` is that wrapper with the codex invocation
// composed onto it, and `codexInvocation` is the invocation on its own, so the
// argv is readable without starting anything.
//
// NOTHING IS DISPATCHED THAT IS NOT FIRST RECORDED. A process identity does
// not exist until the OS hands it over, so a child is created before its
// receipt — but it is created BLOCKED, holding an unwritten stdin pipe it
// cannot begin without, and released only once the receipt is durable. A
// driver that dies in between leaves a child that reads EOF instead of an
// instruction and exits having done nothing, under a dispatch_id no record
// ever spent. For a native dispatch the same law is trivial: the record is
// written before the workflow is told to run the step at all.
//
// THE KILL IS BY RECORDED SESSION ID, NEVER BY NAME. S0's spike found that
// `setsid` makes a codex child a session LEADER and that codex puts its MCP
// servers in their own process groups inside that session, so a kill of the
// recorded PGID leaves them running. The sweep therefore enumerates every pid
// whose session equals the id recorded at dispatch, and every id it addresses
// is one this module wrote down at launch — a process-name match would kill
// whatever else on the machine happened to be called the same thing.
//
// A SWEEP AFTER A CRASH IS NOT THE SAME SWEEP. Inside `dispatchProcess` the
// child is ours and alive, so the recorded session is the child's by
// construction. `recoverDispatches` runs in a LATER process, against a session
// id whose pid may since have been recycled onto something else entirely — so
// it kills only a session it can still prove is the dispatched one: the
// session leader must be alive and must have started no later than the
// dispatch record's own timestamp (a recycled pid's process necessarily
// started after it). A session it cannot claim is recorded as such and left
// running. Both refusals fail in the safe direction, and a refusal that leaves
// live processes behind says so in the terminal rather than passing for a
// clean recovery.
//
// EVIDENCE, NEVER INTENT. `builder` on a terminal is never what the dispatch
// hoped for — the dispatch record carries that, as `intended_family`. A
// process dispatch is `sol` only when a codex session banner is actually in
// its captured output, and a successful child with no banner is `ok` with
// builder `null`: success is not authorship. A native build is `claude-fallback`
// — the record vocabulary's name for a proven Claude build — and only with BOTH
// a model identity and a real, non-empty result artifact behind it. A native
// build with no result artifact is `failed`, never `ok`.
//
// THE EVIDENCE IS ON THE RECORD. A successful terminal carries the concrete
// model identity that produced the result and the digest of the artifact
// itself — `receipts.js` requires both on an ok terminal and forbids both on a
// failed one. Returning them instead, as this module first did, loses them to
// any crash between the terminal and whoever consumes it, and re-deriving a
// digest later answers with whatever the file says NOW: an artifact rewritten
// under the same result_ref would read as a replay of the work that produced
// the original. Durably recorded, it reads as the conflict it is.
//
// THE THREE BOUNDARIES. A dispatch_id is spent the moment its dispatch record
// exists. Re-entering one that already has a terminal returns that terminal.
// Re-entering one that is still pending never relaunches: it recovers — the
// session is reaped if it is alive and claimable, recorded as abandoned if it
// is gone — and a genuine relaunch is a NEW dispatch_id. That is what keeps a
// crash between the launch and the terminal from becoming two live children.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const { readRecords } = require('./stream.js');
const { boundFor, withBound, TIMEOUT_CODE } = require('./timeouts.js');
const { writeDispatch, writeDispatchTerminal } = require('./receipts.js');
const { HOSTED_GPT_SEATS, FAMILY_OF_MODEL } = require('./validators.js');

const LEDGER_FILENAME = 'ledger.jsonl';
// Where a process dispatch's own artifacts land: the result codex is told to
// write, and the two captured streams the provenance banner is read out of.
const DISPATCH_DIRNAME = 'dispatch';

const CODEX_COMMAND = 'codex';
// The codex transport IS Sol: routing decides which SEAT goes out on which
// transport, and a seat routed to codex is routed to this model. A caller may
// still name another one; what it may not do is leave the record unable to say
// which model was asked for.
const CODEX_MODEL = 'gpt-5.6-sol';
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access'];

// Which family a dispatch INTENDS, by the transport it goes out on — a codex
// dispatch intends Sol, a native Agent-tool step intends Claude. Intent is not
// evidence: what actually built the result is `builder` on the terminal, set
// from the transport's own provenance and never from this.
const INTENDED_FAMILY = Object.freeze({ codex: 'gpt', native: 'claude' });

// The banner codex prints once, at the top of its own stderr. Only the head of
// each stream is scanned: a session id that is not in the first lines is not
// this banner, and a build with a large transcript should not be read whole to
// learn one field.
const SESSION_BANNER_RE = /session[ _-]?id:?\s+([A-Za-z0-9-]{8,})/i;
const BANNER_SCAN_BYTES = 64 * 1024;

const SESSION_ID_RE = /^[1-9]\d*$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// THE LAUNCH GATE. A child is spawned behind this shim, which reads one line
// from stdin and will only become the dispatched command if that line is the
// release token. Anything else — above all the EOF a dying driver's pipe
// delivers — and it exits without ever exec'ing anything.
//
// The obvious gate is to spawn the command directly and rely on it blocking
// for its own instruction, and it does not hold: closing the pipe RELEASES
// such a child rather than stopping it, and it proceeds with an empty
// instruction. Whether that is harmless then depends on the command's own
// judgment, which is not a property this module can have. The shim removes the
// question: the decision to run belongs to code that lives here.
//
// `exec` replaces the shim's image, so the process the OS created is the
// process that ends up doing the work — same pid, same group, same session,
// which is what keeps the recorded identity true. The instruction follows the
// token on the same pipe, so a command that reads stdin still gets it.
const GATE_TOKEN = 'kiln-dispatch-release';
const GATE_ABORT_STATUS = 97;
const GATE_SCRIPT = `IFS= read -r go || exit ${GATE_ABORT_STATUS}; [ "$go" = "${GATE_TOKEN}" ] || exit ${GATE_ABORT_STATUS}; exec "$0" "$@"`;

// How long a swept session gets to die of SIGTERM before SIGKILL, and how long
// SIGKILL gets to take effect before survivors are counted and reported.
const SWEEP_TERM_GRACE_MS = 2000;
const SWEEP_KILL_GRACE_MS = 1000;
const SWEEP_POLL_MS = 25;

// Clock granularity slack when deciding whether a live session can still be
// claimed by a dispatch record. `ps` reports start times to the second, and
// the record is written a few milliseconds after the child starts.
const CLAIM_SLACK_MS = 2000;

// The reasons a terminal can fail for, as tokens rather than sentences, so a
// rate can count them. `timeout` is the one receipts.js attaches a law to: a
// terminal carrying it must be failed.
const REASON_TIMEOUT = 'timeout';
const REASON_ABANDONED = 'abandoned';
const REASON_ORPHANED = 'orphaned';
const REASON_UNCLAIMABLE = 'unclaimable-session';
const REASON_NO_RESULT = 'no-result-artifact';
const REASON_NO_MODEL = 'no-model-identity';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireTreeRoot(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('dispatch: treeRoot must be a non-empty string');
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------- paths ----------

function ledgerPathOf(treeRoot) {
  return path.join(treeRoot, LEDGER_FILENAME);
}

// The directory every artifact of a process dispatch lives in, validated as a
// location before anything is composed beneath it. `dispatch/` is a path like
// any other and can be a symlink out of the tree — and everything downstream
// takes it on trust: the transcripts are opened for writing, the result is
// digested, and codex is handed the result path as its own `-o` target. A
// containment check on each leaf would be checking the wrong thing, since each
// leaf spells its way inside a directory that does not stay there.
function dispatchDirOf(treeRoot) {
  return resolveInTree(treeRoot, DISPATCH_DIRNAME, 'the dispatch directory');
}

// The result a process dispatch is told to write, named by its dispatch_id the
// way receipts.js names an envelope: deterministic, so a re-entry looks in the
// same place a crashed predecessor was writing to.
function resultPathOf(treeRoot, dispatchId) {
  return path.join(dispatchDirOf(treeRoot), `${dispatchId}.result.md`);
}

// The real path of a location, whether or not anything is there yet: the
// deepest ancestor that exists is resolved through its symlinks, and the part
// that does not exist is appended to it. A lexical check alone cannot answer
// where a path leads.
function realLocationOf(target) {
  const parts = target.split(path.sep);
  // One step per segment, walking up until something exists — bounded by the
  // path's own length, so nothing has to guard the loop against running away.
  for (let depth = parts.length; depth > 0; depth -= 1) {
    const probe = parts.slice(0, depth).join(path.sep) || path.sep;
    try {
      return path.join(fs.realpathSync(probe), ...parts.slice(depth));
    } catch {
      /* not there yet; try the parent */
    }
  }
  return target;
}

// A path a caller cites must be inside the tree — and INSIDE means where it
// actually leads, not what it spells. A `..` is the obvious way out; a symlink
// is the quiet one, and a symlink is a file the tree can hold: without
// resolving it, a prompt or a result artifact could name a link and be read,
// digested, or truncated somewhere else entirely.
function resolveInTree(treeRoot, relPath, label) {
  if (!isNonEmptyString(relPath)) {
    throw new TypeError(`dispatch: ${label} must be a non-empty string`);
  }
  const real = realLocationOf(path.resolve(treeRoot, relPath));
  const rootReal = realLocationOf(treeRoot);
  const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (real !== rootReal && !real.startsWith(rootWithSep)) {
    throw new Error(`dispatch: ${label} ${JSON.stringify(relPath)} leads outside the tree at ${rootReal}`);
  }
  return real;
}

function hasContent(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function digestOf(file) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function readHead(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return '';
  }
  try {
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// ---------- the ledger, read only ----------

// Fails closed on any parse error or common-header violation: deciding "this
// dispatch has no terminal" from a stream that does not read whole is how a
// second launch happens, which is the one thing this module exists to prevent.
function readLedgerOrThrow(treeRoot) {
  const file = ledgerPathOf(treeRoot);
  const { records, errors, headerViolations } = readRecords(file);
  if (errors.length > 0) {
    const detail = errors.map((e) => `line ${e.lineNo}: ${e.reason}`).join('; ');
    throw new Error(`dispatch: ${file} has malformed record(s) — refusing to trust this stream: ${detail}`);
  }
  if (headerViolations.length > 0) {
    const detail = headerViolations.map((v) => `record[${v.index}]: ${v.errors.join(', ')}`).join('; ');
    throw new Error(
      `dispatch: ${file} has record(s) violating the common JSONL header — refusing to trust this stream: ${detail}`
    );
  }
  return records;
}

function dispatchRecordOf(records, dispatchId) {
  return records.find((record) => record.kind === 'dispatch' && record.dispatch_id === dispatchId) || null;
}

function terminalRecordOf(records, dispatchId) {
  return records.find((record) => record.kind === 'dispatch-terminal' && record.dispatch_id === dispatchId) || null;
}

// ---------- processes ----------

function ps(args) {
  const result = spawnSync('ps', args, { encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new Error(`dispatch: could not run ps — ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout || '' };
}

// This process's own session id, read once: a process's session cannot change
// unless it calls setsid itself, and nothing here ever does.
let ownSessionCache = null;
function ownSessionId() {
  if (ownSessionCache === null) {
    ownSessionCache = ps(['-o', 'sess=', '-p', String(process.pid)]).stdout.trim();
  }
  return ownSessionCache;
}

// Why this session id cannot be addressed, or null when it can. One copy of
// the rule with two responses: `sessionMembers` throws on it, and the crash
// recovery records it as a session it may not claim.
function sessionProblem(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return `${JSON.stringify(sessionId)} is not a session id`;
  }
  if (sessionId === ownSessionId()) {
    return `session ${sessionId} is this process own session`;
  }
  return null;
}

// A DEFUNCT process is not a survivor. A killed child stays in the process
// table until its parent reaps it, and this module's own parent — the driver
// running the sweep — cannot reap anything while the sweep is blocking its
// event loop. Counting zombies would make every successful sweep report
// survivors and then wait out its whole grace period for a process that is
// already dead.
function membersOf(sessionId) {
  return ps(['-eo', 'pid=,sess=,stat='])
    .stdout.split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 3 && parts[1] === sessionId && !parts[2].startsWith('Z'))
    .map((parts) => Number(parts[0]))
    // Declared tripwire on the second clause: pid 1 leads its own session and
    // can never be inside a dispatched one, so nothing reaches it — but the
    // cost of being wrong once is the whole machine, and the line is free.
    .filter((pid) => Number.isSafeInteger(pid) && pid > 1);
}

// sessionMembers(sessionId) — every pid currently in that session. The whole
// addressable surface of a dispatched child: its leader, its children, and the
// servers it put in process groups of their own.
function sessionMembers(sessionId) {
  const problem = sessionProblem(sessionId);
  if (problem !== null) {
    throw new Error(`dispatch: ${problem} — refusing to address it`);
  }
  return membersOf(sessionId);
}

// When that process started, or null when there is no such process to ask
// about. A DEFUNCT one is no such process: it still has a row in the table and
// `ps` will still answer with a start time, but it is dead and identifies
// nothing — treating it as a live leader would let a session be claimed on the
// strength of a corpse.
// When the process with this pid started, or null when there is no such
// process to date. One decision in one place: an absent process prints
// nothing, and nothing parses to NaN.
function processStartedAt(pid) {
  const text = ps(['-o', 'lstart=', '-p', String(pid)]).stdout.trim();
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function signalMembers(sessionId, signal) {
  for (const pid of membersOf(sessionId)) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone, or no longer ours to signal. Either way it is not a
      // survivor, and the count below is what reports the truth.
    }
  }
}

function waitForEmptySession(sessionId, graceMs) {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (membersOf(sessionId).length === 0) return true;
    sleepSync(SWEEP_POLL_MS);
  }
  return membersOf(sessionId).length === 0;
}

// sweepSession(sessionId) — SIGTERM the whole session, give it its grace, then
// SIGKILL whatever is left, and report how many survived even that. A survivor
// count above zero is a fact the terminal carries, not an error thrown: the
// dispatch did end, and pretending it ended cleanly would be the lie.
function sweepSession(sessionId) {
  const problem = sessionProblem(sessionId);
  if (problem !== null) {
    throw new Error(`dispatch: ${problem} — refusing to sweep it`);
  }
  signalMembers(sessionId, 'SIGTERM');
  if (!waitForEmptySession(sessionId, SWEEP_TERM_GRACE_MS)) {
    signalMembers(sessionId, 'SIGKILL');
    waitForEmptySession(sessionId, SWEEP_KILL_GRACE_MS);
  }
  return membersOf(sessionId).length;
}

// A RECORDED SESSION STILL ALIVE IS THIS DISPATCH'S TO END. That is the whole
// in-flight boundary: a crashed driver's successor finds the session id it
// wrote down and reaps it, and anything left breathing afterwards is an orphan
// nobody will ever collect. So `claimable` is the default and the refusal is
// narrow — it takes POSITIVE evidence of pid recycling to withhold a sweep,
// namely a live session leader that started AFTER the record naming it, which
// the real child could not have done. A leader that has exited leaves the
// session no less this dispatch's: its members are still the processes it
// spawned, and they still have to go.
function sessionClaim(record) {
  const sessionId = record.transport_ref.session;
  const problem = sessionProblem(sessionId);
  if (problem !== null) return { state: 'unclaimable', survivors: 0, why: problem };

  const members = membersOf(sessionId);
  if (members.length === 0) return { state: 'gone', survivors: 0 };

  // `stream.js` validates every record's ts against its own ISO-8601 pattern
  // before `readLedgerOrThrow` hands it over, so this parse cannot fail here.
  const startedAt = processStartedAt(Number(sessionId));
  if (startedAt !== null && startedAt > Date.parse(record.ts) + CLAIM_SLACK_MS) {
    return {
      state: 'unclaimable',
      survivors: members.length,
      why: `session ${sessionId} is led by a process that started after the dispatch claiming it — this pid has been recycled`,
    };
  }
  return { state: 'claimable', survivors: members.length };
}

// ---------- the codex invocation ----------

function inSet(value, values, field) {
  if (!values.includes(value)) {
    throw new TypeError(`dispatch: ${field} must be one of ${values.join(', ')} (got ${JSON.stringify(value)})`);
  }
}

// codexInvocation(treeRoot, spec) — the argv S0 proved, and nothing implicit.
//
// The prompt goes in on stdin (`-`) for three reasons that all matter: a brief
// is too big for an argv, a codex left with an open stdin hangs to its
// timeout, and — the load-bearing one — a command that must read its
// instruction before it can begin is a command that can be HELD. That is what
// `dispatchProcess` uses to keep a child from working until its receipt is on
// disk, so the prompt travels as content here rather than as a path the child
// could open on its own.
//
// The result comes back through `-o` rather than out of the transcript, so
// "did it produce anything" is a question about a file.
function codexInvocation(treeRoot, spec) {
  requireTreeRoot(treeRoot);
  if (!isPlainObject(spec)) {
    throw new TypeError('dispatch: codexInvocation requires a dispatch spec object');
  }
  const { dispatch_id: dispatchId, prompt_ref: promptRef, workdir, effort, sandbox } = spec;
  // A seat routed to codex is routed to Sol; a caller may override, and the
  // model it ran under is recorded on the terminal either way.
  const model = isNonEmptyString(spec.model) ? spec.model : CODEX_MODEL;

  if (!isNonEmptyString(dispatchId)) {
    throw new TypeError('dispatch: codexInvocation requires a non-empty "dispatch_id"');
  }
  if (!isNonEmptyString(workdir)) {
    throw new TypeError('dispatch: codexInvocation requires a non-empty "workdir"');
  }
  inSet(effort, EFFORTS, 'effort');
  inSet(sandbox, SANDBOXES, 'sandbox');

  const promptPath = resolveInTree(treeRoot, promptRef, 'prompt_ref');
  if (!hasContent(promptPath)) {
    throw new Error(`dispatch: prompt_ref ${JSON.stringify(promptRef)} is not a readable prompt at ${promptPath}`);
  }

  return {
    command: CODEX_COMMAND,
    args: [
      'exec',
      '-m',
      model,
      '-c',
      `model_reasoning_effort="${effort}"`,
      '--sandbox',
      sandbox,
      '-C',
      workdir,
      '--skip-git-repo-check',
      '-o',
      resultPathOf(treeRoot, dispatchId),
      '-',
    ],
    cwd: workdir,
    model_id: model,
    stdin: fs.readFileSync(promptPath, 'utf8'),
  };
}

// ---------- the shared dispatch spec ----------

// A dispatch_id belongs to the transport that opened it, in both directions.
// Asked BEFORE any replay, recovery, sweep or launch, because every one of
// those acts on a record this caller would be misreading: the native pair
// would answer a workflow about a codex child it cannot see, and the process
// wrapper would reach for a session that never existed. The mismatch is a
// caller defect, so it refuses and touches nothing.
function requireTransport(dispatch, transport, dispatchId) {
  if (dispatch !== null && dispatch.transport !== transport) {
    throw new Error(
      `dispatch: transport-mismatch — dispatch_id ${JSON.stringify(dispatchId)} was sent out on the "${dispatch.transport}" transport, not "${transport}"`
    );
  }
}

// The seven fields a dispatch record carries, assembled from the four a caller
// names plus the three the transport already determines. Taken by name, so the
// transport detail a codex spec also carries — its workdir, effort and sandbox
// — never leaks into a record that refuses unknown fields.
//
// `intended_family` is DERIVED rather than accepted: intent is expressed by
// choosing a transport, and a caller free to declare a family could name one
// its own dispatch contradicts.
function dispatchPayload(spec, transport, promptRef, transportRef) {
  return {
    ...(spec.execution_mode === undefined ? {} : { execution_mode: spec.execution_mode }),
    dispatch_id: spec.dispatch_id,
    seat: spec.seat,
    transport,
    intended_family: INTENDED_FAMILY[transport],
    task_class: spec.task_class,
    prompt_ref: promptRef,
    transport_ref: transportRef,
  };
}

// The task class is resolved before anything is written: an unknown class is a
// dispatch nobody set a bound for, and `timeouts.js` is the one place that
// says which classes exist.
function requireSpec(spec, what) {
  if (!isPlainObject(spec)) {
    throw new TypeError(`dispatch: ${what} requires a dispatch spec object`);
  }
  // receipts.js holds the same shape rule for its own reason — a dispatch_id
  // names an envelope file there. This module needs it EARLIER: a process
  // dispatch builds three paths out of the id and launches a child before its
  // record is ever written, so an id checked only at record time would be
  // checked after the damage.
  if (typeof spec.dispatch_id !== 'string' || !SAFE_ID_RE.test(spec.dispatch_id)) {
    throw new TypeError(
      `dispatch: ${what} requires a "dispatch_id" of letters, digits, dot, dash or underscore (got ${JSON.stringify(spec.dispatch_id)})`
    );
  }
  if (!isNonEmptyString(spec.seat)) {
    throw new TypeError(`dispatch: ${what} requires a non-empty "seat"`);
  }
  return boundFor(spec.task_class);
}

// ---------- the native pair ----------

// dispatchNative(treeRoot, {dispatch_id, seat, task_class, payload_ref}) — the
// first half of the native pair. The workflow runs the Agent step itself, so
// all this can do is record that it is about to and hand back the bound the
// step must be held to.
//
// THE RETURN SAYS WHETHER TO RUN THE STEP, because nothing else can. A caller
// that only learns "there is a dispatch record for this id" cannot tell an id
// it just opened from one a dead predecessor opened and may already have run:
//
//   opened    — the record is new. Run the Agent step, then completeNative.
//   recovered — a record existed with no terminal. Whether the step ran is
//               unknowable, so the dispatch is closed as abandoned and the id
//               is spent; a retry is a NEW dispatch_id. Do NOT run the step.
//   settled   — a terminal already exists. Do NOT run the step.
//
// The task_ref the record carries is the dispatch_id itself: a receipt written
// before the work can only name an identity that exists before the work, and
// the id the workflow already holds is exactly that.
function dispatchNative(treeRoot, spec) {
  requireTreeRoot(treeRoot);
  const boundMs = requireSpec(spec, 'dispatchNative');
  if (!isNonEmptyString(spec.payload_ref)) {
    throw new TypeError('dispatch: dispatchNative requires a non-empty "payload_ref"');
  }

  const records = readLedgerOrThrow(treeRoot);
  const opened = dispatchRecordOf(records, spec.dispatch_id);
  requireTransport(opened, 'native', spec.dispatch_id);

  const settled = terminalRecordOf(records, spec.dispatch_id);
  if (settled !== null) {
    return { state: 'settled', ref: `ledger:${settled.seq}`, record: settled, bound_ms: boundMs };
  }
  if (opened !== null) {
    const { ref, record } = recoverOne(treeRoot, opened);
    return { state: 'recovered', ref, record, bound_ms: boundMs };
  }

  const written = writeDispatch(
    treeRoot,
    dispatchPayload(spec, 'native', spec.payload_ref, { task_ref: spec.dispatch_id })
  );
  return { state: 'opened', ref: written.ref, record: written.record, bound_ms: boundMs };
}

// The evidence a finished native step is believed on, or the reason it is not
// believed. A model identity and a real result artifact are both required for
// `ok`: a step that returned nothing built nothing, whatever it said.
function nativeOutcome(treeRoot, evidence) {
  const { model_id: modelId, result_ref: resultRef, reason } = evidence;

  // A caller that knows the step did not finish — it timed out, it threw — is
  // believed about the failure. It is never believed about a success.
  if (isNonEmptyString(reason)) {
    return { reason, digest: null };
  }
  const resultPath = isNonEmptyString(resultRef) ? resolveInTree(treeRoot, resultRef, 'result_ref') : null;
  if (!isNonEmptyString(modelId)) {
    return { reason: REASON_NO_MODEL, digest: null };
  }
  if (resultPath === null || !hasContent(resultPath)) {
    return { reason: REASON_NO_RESULT, digest: null };
  }
  return { reason: null, digest: digestOf(resultPath) };
}

// A hosted Sol run, and WHO MAY LAWFULLY CLAIM ONE.
//
// SEAT-ATTESTED, NOT MACHINE-CAPTURED, and that boundary belongs in the same
// breath as the claim. For a codex dispatch the machine spawned the child and
// harvested the session from its own transcript. A hosted run happens INSIDE a
// native Agent step, so nothing the machine controls ever sees it — the seat
// hands the id over and that is the only evidence there is.
//
// WHICH IS EXACTLY WHY THE CLAIM IS BOUND. Shape alone is evidence of nothing:
// accepting any UUID-shaped string would let a native Opus result become
// GPT-family evidence, and the cross-family law would then be deciding on a
// coincidence. Three things must hold together — the session must be
// well-formed, the SEAT must be one that runs its model through Codex, and the
// MODEL must be one this tree places in the gpt family. Any one of them alone
// is a coincidence; the three together are a claim only a hosted run can make.
const HOSTED_SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hostedBuilder(evidence, dispatch) {
  const declared = dispatch.execution_mode === 'hosted';
  const claimed = Object.prototype.hasOwnProperty.call(evidence, 'hosted_session');

  // THE DISPATCH SAID WHAT THIS RUN WAS, and the terminal is held to it. A run
  // that declared hosted owes its session — silence is not a quiet downgrade to
  // native, because the dispatch already committed. A run that declared native
  // cannot smuggle one in, whatever its seat is capable of on another day.
  if (!declared) {
    if (claimed) {
      throw new Error(
        `dispatch: dispatch ${JSON.stringify(dispatch.dispatch_id)} went out in "native" mode, so its terminal cannot claim a hosted Sol session — a seat that CAN host is not a run that DID`
      );
    }
    return null;
  }
  if (!claimed) {
    throw new Error(
      `dispatch: dispatch ${JSON.stringify(dispatch.dispatch_id)} went out in "hosted" mode and its terminal names no "hosted_session" — a hosted run is attested by its session or not at all`
    );
  }
  if (typeof evidence.hosted_session !== 'string' || !HOSTED_SESSION_RE.test(evidence.hosted_session)) {
    throw new TypeError(
      `dispatch: "hosted_session" must be a codex session identity of the form 8-4-4-4-12 hex (got ${JSON.stringify(evidence.hosted_session)})`
    );
  }
  // The mode is a claim too, so the seat and the model still have to be able to
  // support it: only a seat that runs its model through Codex may be dispatched
  // hosted, and only a gpt model can be what it hosted.
  if (!HOSTED_GPT_SEATS.includes(dispatch.seat)) {
    throw new Error(
      `dispatch: seat ${JSON.stringify(dispatch.seat)} does not host a model through Codex, so it cannot be dispatched in "hosted" mode (the seats that can: ${HOSTED_GPT_SEATS.join(', ')})`
    );
  }
  if (FAMILY_OF_MODEL[evidence.model_id] !== 'gpt') {
    throw new Error(
      `dispatch: a hosted Sol run is gpt work, but this terminal names model ${JSON.stringify(evidence.model_id)} — refusing to attest gpt authorship for a model this tree does not place in that family`
    );
  }
  return 'sol-hosted';
}

// completeNative(treeRoot, {dispatch_id, model_id, result_ref, reason,
// hosted_session}) — the second half: exactly one terminal, from what the step
// actually left behind.
function completeNative(treeRoot, evidence) {
  requireTreeRoot(treeRoot);
  if (!isPlainObject(evidence)) {
    throw new TypeError('dispatch: completeNative requires an evidence object');
  }
  const { dispatch_id: dispatchId, model_id: modelId } = evidence;
  if (!isNonEmptyString(dispatchId)) {
    throw new TypeError('dispatch: completeNative requires a non-empty "dispatch_id"');
  }

  // Which pair owns a dispatch is a fact about the dispatch itself, true
  // whether or not a terminal has been written, so it is read first and a
  // caller that got it wrong is refused on a replay exactly as on a first call.
  const records = readLedgerOrThrow(treeRoot);
  const dispatch = dispatchRecordOf(records, dispatchId);
  if (dispatch === null) {
    throw new Error(
      `dispatch: no dispatch record for dispatch_id ${JSON.stringify(dispatchId)} — a terminal cannot precede its own dispatch`
    );
  }
  if (dispatch.transport !== 'native') {
    throw new Error(
      `dispatch: dispatch_id ${JSON.stringify(dispatchId)} was sent out on the "${dispatch.transport}" transport — completeNative closes native dispatches only`
    );
  }

  // No replay short circuit here on purpose. Re-deriving the outcome and
  // handing the same terminal to receipts.js is what a replay IS: an identical
  // payload comes back as the record already on disk, and a payload that
  // differs — a different model claimed, or an artifact rewritten under the
  // same result_ref into a different digest — fails closed there rather than
  // being quietly answered with the older receipt.
  // THE FAILURE PATH IS DECIDED FIRST, AND THAT ORDER IS THE POINT. A run that
  // did not happen has nothing to attest: a hosted agent that threw, or that
  // reported it wrote nothing, has no session to give, and demanding one before
  // the declared-failure rule can speak means the known failed terminal is
  // never written at all — recovery then sweeps the dispatch up as generically
  // abandoned and the reason the caller actually had is thrown away.
  //
  // So the attestation rules apply to SUCCESS. On a failure the builder is
  // `null` whatever mode the dispatch declared, which is already what a failed
  // terminal says: success is not authorship, and neither is its absence.
  const outcome = nativeOutcome(treeRoot, evidence);
  const hosted = outcome.reason === null ? hostedBuilder(evidence, dispatch) : null;
  const written =
    outcome.reason === null
      ? writeDispatchTerminal(treeRoot, {
          dispatch_id: dispatchId,
          status: 'ok',
          builder: hosted === null ? 'claude-fallback' : hosted,
          ...(hosted === null ? {} : { hosted_session: evidence.hosted_session }),
          transport_ref: dispatch.transport_ref,
          result_ref: evidence.result_ref,
          model_id: modelId,
          result_digest: outcome.digest,
        })
      : writeDispatchTerminal(treeRoot, {
          dispatch_id: dispatchId,
          status: 'failed',
          builder: null,
          transport_ref: dispatch.transport_ref,
          reason: outcome.reason,
        });

  return { ref: written.ref, record: written.record, evidence: evidenceOfTerminal(treeRoot, written.record) };
}

// The evidence behind a terminal, READ OFF THE RECORD. Nothing here is
// recomputed from disk: the digest and the model identity were durably
// attested when the terminal was written, and re-deriving them later would
// answer with whatever the tree says now — which is exactly how a rewritten
// artifact would pass for a replay of the work that produced the original.
// The codex session is the one thing not on the record (receipts.js has no
// field for it and it is corroborating, not constitutive — `builder` already
// carries what it proves), so it comes from the captured transcript.
function evidenceOfTerminal(treeRoot, terminal) {
  return {
    builder: terminal.builder,
    model_id: terminal.model_id === undefined ? null : terminal.model_id,
    result_ref: terminal.result_ref === undefined ? null : terminal.result_ref,
    result_digest: terminal.result_digest === undefined ? null : terminal.result_digest,
    codex_session: harvestSession(treeRoot, terminal.dispatch_id),
    survivors: 0,
    interrupted: false,
  };
}

// ---------- the process transport ----------

function harvestSession(treeRoot, dispatchId) {
  for (const suffix of ['.err', '.out']) {
    const match = SESSION_BANNER_RE.exec(
      readHead(path.join(dispatchDirOf(treeRoot), `${dispatchId}${suffix}`), BANNER_SCAN_BYTES)
    );
    if (match !== null) return match[1];
  }
  return null;
}

// An invocation names a command, its instruction, and the concrete model that
// command runs — the last of which a successful terminal has to attest. The
// instruction reaches the child on stdin, behind the release token, so a
// command that reads stdin (codex does, via `-`) receives exactly it.
function requireInvocation(invocation) {
  if (!isPlainObject(invocation)) {
    throw new TypeError('dispatch: dispatchProcess requires an invocation object');
  }
  if (!isNonEmptyString(invocation.command)) {
    throw new TypeError('dispatch: an invocation requires a non-empty "command"');
  }
  if (!Array.isArray(invocation.args) || invocation.args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('dispatch: an invocation requires "args" as an array of strings');
  }
  if (typeof invocation.stdin !== 'string') {
    throw new TypeError('dispatch: an invocation requires its instruction as a string "stdin"');
  }
  if (!isNonEmptyString(invocation.model_id)) {
    throw new TypeError('dispatch: an invocation requires a non-empty "model_id"');
  }
  return invocation;
}

// Nothing this module is about to write may already be there. A leftover
// transcript or result under an unspent dispatch_id is residue from an attempt
// that crashed, and the two ways of being wrong about it are both bad: digest
// it and a child that produced nothing seals someone else's output as its own;
// truncate it and the only trace of the crashed attempt is gone. So the launch
// is refused, the residue is preserved, and the retry takes a NEW dispatch_id
// — which is what the re-entry law asks for anyway.
//
// `lstatSync` rather than `existsSync`: a symlink is something being there,
// and it is the shape that would otherwise send a write outside the tree.
function requireNoResidue(paths) {
  for (const file of paths) {
    let present = true;
    try {
      fs.lstatSync(file);
    } catch {
      present = false;
    }
    if (present) {
      throw new Error(
        `dispatch: ${file} already exists — this dispatch_id has residue from an earlier attempt, and a retry needs a new one`
      );
    }
  }
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

// What a finished child proves. Anything short of "exited zero and left a
// non-empty result artifact" is a failure, and a failure cites no result: the
// half-written file a failed run leaves behind is not one, and handing it back
// as one is how unfinished work gets sealed.
function processOutcome(treeRoot, dispatchId, exit) {
  if (exit.signal !== null && exit.signal !== undefined) {
    return { reason: `killed-by-${exit.signal}`, digest: null };
  }
  if (exit.code !== 0) {
    return { reason: `exit-status-${exit.code}`, digest: null };
  }
  const resultPath = resultPathOf(treeRoot, dispatchId);
  if (!hasContent(resultPath)) {
    return { reason: REASON_NO_RESULT, digest: null };
  }
  return { reason: null, digest: digestOf(resultPath) };
}

function terminalReceipt(treeRoot, payload, extra) {
  const written = writeDispatchTerminal(treeRoot, payload);
  return {
    ref: written.ref,
    record: written.record,
    evidence: { ...evidenceOfTerminal(treeRoot, written.record), ...extra },
  };
}

// dispatchProcess(treeRoot, spec, invocation, opts) — launch a real child
// detached, hold it to its class bound, and write the one terminal.
//
// THE CHILD IS CREATED BEFORE ITS RECEIPT AND RELEASED AFTER IT. A process
// identity does not exist until the OS hands it over, so the record cannot
// come first — but "created" and "working" are separable, and everything turns
// on separating them. What the OS creates is the gate shim above, waiting for
// a release token it will not invent; only once the identity-bearing receipt
// is durable is that token written, and only then does the process become the
// dispatched command at all.
//
// A driver that dies in the gap therefore leaves no working session and no
// evidence to lose: the pipe dies with it, the shim reads EOF instead of the
// token, and it exits having exec'd nothing. The dispatch_id is unspent
// because no record was written, and it can be launched again — which is safe
// precisely because nothing ran.
//
// `detached` makes the child the leader of its own group AND its own session —
// that is what makes a session sweep addressable at all — so the ids are known
// from the pid the moment spawn returns. `setsid` cannot fail for a freshly
// forked child, so the three ids ARE the pid and are not re-derived from `ps`;
// the suite proves that guarantee holds on this platform by reading `ps`
// itself while a dispatched child is alive, which is where a platform claim
// belongs.
//
// `opts.boundMs` runs the class at a different SCALE, exactly as
// `timeouts.withBound` does and for the same reason: a bound of forty-five
// minutes is not something a test can wait for. It never changes which class
// was named.
async function dispatchProcess(treeRoot, spec, invocation, opts = {}) {
  requireTreeRoot(treeRoot);
  requireSpec(spec, 'dispatchProcess');
  const launch = requireInvocation(invocation);

  // A dispatch_id is spent once its record exists: a completed one replays its
  // terminal, and a pending one is recovered, never relaunched.
  const records = readLedgerOrThrow(treeRoot);
  const opened = dispatchRecordOf(records, spec.dispatch_id);
  requireTransport(opened, 'codex', spec.dispatch_id);

  const settled = terminalRecordOf(records, spec.dispatch_id);
  if (settled !== null) {
    return {
      ref: `ledger:${settled.seq}`,
      record: settled,
      evidence: evidenceOfTerminal(treeRoot, settled),
    };
  }
  if (opened !== null) {
    // One return shape whichever way this goes. Which recovery happened is on
    // the terminal's own `reason`, where a later reader can still see it.
    const { ref, record, evidence } = recoverOne(treeRoot, opened);
    return { ref, record, evidence };
  }

  fs.mkdirSync(dispatchDirOf(treeRoot), { recursive: true });
  const outPath = path.join(dispatchDirOf(treeRoot), `${spec.dispatch_id}.out`);
  const errPath = path.join(dispatchDirOf(treeRoot), `${spec.dispatch_id}.err`);
  requireNoResidue([resultPathOf(treeRoot, spec.dispatch_id), outPath, errPath]);

  const fds = [];
  let child;
  try {
    // 'wx' — O_CREAT|O_EXCL: the residue check above gives the readable
    // refusal, and this is what makes it race-free and symlink-proof, since
    // O_EXCL refuses to follow a link that appeared in between.
    const out = fs.openSync(outPath, 'wx');
    const err = fs.openSync(errPath, 'wx');
    fds.push(out, err);
    child = spawn('/bin/bash', ['-c', GATE_SCRIPT, launch.command, ...launch.args], {
      cwd: launch.cwd,
      detached: true,
      stdio: ['pipe', out, err],
    });
  } finally {
    for (const fd of fds) fs.closeSync(fd);
  }

  // Attached before anything can throw. A spawn the OS refused reports itself
  // through an `error` event, and an unheard `error` on a ChildProcess is an
  // uncaught exception in whatever runs next; the refusal itself is handled
  // below, off the missing pid. A child that errors WITHOUT exiting is a hang,
  // and a hang is what the bound already exists for.
  child.once('error', () => {});
  const exited = waitForExit(child);

  // No pid means the OS refused to create the gate shim itself — /bin/bash is
  // gone. Nothing was sent out, so nothing is recorded and the dispatch_id has
  // not been spent. Declared tripwire: unproducible in a test now that the
  // spawned command is always the shim, kept because the alternative is a
  // string of confusing downstream refusals about an undefined pid.
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error(`dispatch: could not launch ${JSON.stringify(launch.command)} — no process was created`);
  }

  // The bound's own timer is what keeps this process alive while the work
  // runs; the child must not be. A survivor the sweep could not kill would
  // otherwise hold the driver open for the rest of its own lifetime, long
  // after the terminal said the dispatch was over — a CLI that has finished
  // and will not exit. Unreffing does not stop the exit event from arriving.
  //
  // Declared tripwire: no test can produce it, because a process that
  // survives SIGKILL is one stuck in uninterruptible sleep. It was observed
  // for real — a mutation run that disabled the kill escalation left this
  // module's own suite hanging for the child's full three hundred seconds.
  child.unref();

  const sessionId = String(child.pid);
  const transportRef = { pid: child.pid, pgid: child.pid, session: sessionId };

  try {
    writeDispatch(treeRoot, dispatchPayload(spec, 'codex', spec.prompt_ref, transportRef));
  } catch (err) {
    // The receipt is the only thing that would have made this child findable
    // again, so it does not get to outlive it — and it never worked, because
    // its instruction is still unwritten.
    try {
      sweepSession(sessionId);
    } catch {
      /* the throw below is the one that matters */
    }
    throw err;
  }

  // Released. Everything above this line happened to a process that had not
  // yet become the dispatched command at all. The write is asynchronous, so a
  // caller that blocks the event loop after this point starves its own child —
  // awaiting the returned promise is what runs it.
  child.stdin.end(`${GATE_TOKEN}\n${launch.stdin}`);

  let exit;
  let boundSignal = null;
  try {
    exit = await withBound(
      spec.task_class,
      (ctx) => {
        boundSignal = ctx.signal;
        return exited;
      },
      Number.isInteger(opts.boundMs) ? { boundMs: opts.boundMs } : {}
    );
  } catch (err) {
    // Declared tripwire: `withBound` rejects with the work's own error, and
    // waiting on a child's exit event never rejects — so nothing but the
    // timeout reaches here today. It stays because swallowing some future
    // failure as a timeout would kill a live session on a false pretext.
    if (err.code !== TIMEOUT_CODE) throw err;
    // The bound is what decides; the sweep is what makes the decision real.
    // It happens here rather than off the AbortSignal so that the kill has
    // finished — and its survivors counted — before the terminal claims it.
    const survivors = sweepSession(sessionId);
    return terminalReceipt(
      treeRoot,
      {
        dispatch_id: spec.dispatch_id,
        status: 'failed',
        builder: null,
        transport_ref: transportRef,
        reason: REASON_TIMEOUT,
      },
      { survivors, interrupted: true }
    );
  }

  const outcome = processOutcome(treeRoot, spec.dispatch_id, exit);
  if (outcome.reason !== null) {
    return terminalReceipt(
      treeRoot,
      {
        dispatch_id: spec.dispatch_id,
        status: 'failed',
        builder: null,
        transport_ref: transportRef,
        reason: outcome.reason,
      },
      { interrupted: boundSignal.aborted }
    );
  }

  // Authorship is proven by the transport's own provenance evidence or it is
  // not proven at all. A clean exit with a real artifact and no banner is a
  // successful build by somebody this machine cannot name.
  const session = harvestSession(treeRoot, spec.dispatch_id);
  return terminalReceipt(
    treeRoot,
    {
      dispatch_id: spec.dispatch_id,
      status: 'ok',
      builder: session === null ? null : 'sol',
      transport_ref: transportRef,
      // Built as the tree-relative name rather than derived from the resolved
      // path: a ref is what the tree calls the artifact, and it must not start
      // describing wherever a symlink resolution happened to land.
      result_ref: `${DISPATCH_DIRNAME}/${spec.dispatch_id}.result.md`,
      model_id: launch.model_id,
      result_digest: outcome.digest,
    },
    // A value coming back is not the same fact as the work never having been
    // interrupted: an enforcer that aborted early and then let the child's
    // exit resolve anyway would satisfy the first and violate the second.
    { interrupted: boundSignal.aborted }
  );
}

// dispatchCodex(treeRoot, {dispatch_id, seat, task_class, prompt_ref, workdir,
// effort, sandbox}, opts) — the process wrapper with the codex invocation
// composed onto it. The invocation is built first, so a spec that cannot name
// a lawful effort, sandbox or prompt is refused before anything is launched or
// written.
async function dispatchCodex(treeRoot, spec, opts = {}) {
  requireTreeRoot(treeRoot);
  return dispatchProcess(treeRoot, spec, codexInvocation(treeRoot, spec), opts);
}

// ---------- recovery ----------

// The terminal's `reason` stays one of a handful of tokens, so a rate can
// count them — but WHY a session could not be claimed differs (an id no sweep
// could address, a leader that is gone, a start time that postdates the
// record), and an operator with live processes left on their machine needs
// that sentence. It travels back with the recovery report rather than into the
// record, where it would turn a countable vocabulary into free text.
function recoverOne(treeRoot, dispatch) {
  let action = 'abandoned';
  let reason = REASON_ABANDONED;
  let survivors = 0;
  let why = null;

  if (dispatch.transport === 'codex') {
    const claim = sessionClaim(dispatch);
    if (claim.state === 'claimable') {
      survivors = sweepSession(dispatch.transport_ref.session);
      action = 'reaped';
      reason = REASON_ORPHANED;
    } else if (claim.state === 'unclaimable') {
      survivors = claim.survivors;
      action = 'unclaimable';
      reason = REASON_UNCLAIMABLE;
      why = claim.why;
    }
  }

  const receipt = terminalReceipt(
    treeRoot,
    {
      dispatch_id: dispatch.dispatch_id,
      status: 'failed',
      builder: null,
      transport_ref: dispatch.transport_ref,
      reason,
    },
    { survivors }
  );
  return { dispatch_id: dispatch.dispatch_id, action, why, ...receipt };
}

// recoverDispatches(treeRoot) — close out every dispatch a dead driver left
// pending, and nothing else. Idempotent by construction: a dispatch with a
// terminal is not pending, so a second run finds nothing to do.
function recoverDispatches(treeRoot) {
  requireTreeRoot(treeRoot);
  const records = readLedgerOrThrow(treeRoot);
  const terminated = new Set(
    records.filter((record) => record.kind === 'dispatch-terminal').map((record) => record.dispatch_id)
  );
  return records
    .filter((record) => record.kind === 'dispatch' && !terminated.has(record.dispatch_id))
    .map((record) => recoverOne(treeRoot, record));
}

module.exports = {
  codexInvocation,
  dispatchProcess,
  dispatchCodex,
  dispatchNative,
  completeNative,
  recoverDispatches,
  sessionMembers,
  sweepSession,
};
