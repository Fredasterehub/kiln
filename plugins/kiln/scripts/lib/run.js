'use strict'

// The run lock and the state document — who holds the run, and what the run says it will do next.
const { createHash, randomUUID } = require('node:crypto')
const { appendFileSync, linkSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync,
  writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const { CODEX_UNAVAILABLE, TRANSPORT_FAILURE, classifyFailure, isObject, stop } = require('./core.js')

// W1-S2 (Defect B): the state-commit vocabulary. The kernel persisted STATE.md by
// handing a courier a bash heredoc that spelled out the whole ledger; a safety-tuned
// model reads that as forging a transition past validation and REFUSES, converting even
// honest holds into persist-failed. Here the courier speaks only closed words — a
// transition token, the stage, the slice, a next-action KEY, the density, and pointer
// paths — and this verb owns the document, the hint prose and the clock. The token names
// the transition kind (advance/seal-advance move forward, hold/degrade/boundary stop);
// an unsupported token, stage, key or density fails closed and nothing is written.
const STATE_TOKENS = new Set(['advance', 'seal-advance', 'hold', 'degrade', 'boundary'])
const STATE_STAGES = new Set(['law', 'build', 'validate', 'report'])
const STATE_SLICE_ID = /^[A-Za-z0-9._/-]+$/
// A pointer is a repo-relative path of safe characters only — no shell metacharacter,
// whitespace, or parent-escape rides the STATE.md pointers line or the courier argv.
const STATE_POINTER = /^[A-Za-z0-9._/-]+$/
// W3 (ruling §4): the master-plan digest is ONE optional trailing state-commit word, and it wears
// this prefix so it cannot be confused with a pointer. STATE_POINTER admits no colon, so a prefixed
// word is never a lawful pointer and a lawful pointer is never read as a digest — the separation is
// structural, which matters because the pointer list carries model-declared paths. The kernel spells
// the identical literal in its own courier builder; the two are pinned equal.
const MASTER_PLAN_ARG = 'master-plan-digest:'

// The next-action KEY table: each key resolves to one fixed operator hint, with the
// current stage and active slice filled in. relaunch-* name their own forward stage, so
// they ignore the current stage. An unknown key returns null and the verb fails closed.
function stateNextAction(key, stage, slice) {
  const hasSlice = slice !== 'none'
  switch (key) {
    case 'run-complete': return 'Run complete'
    case 'relaunch-law': return 'Relaunch the kernel workflow with stage=law'
    case 'relaunch-build': return 'Relaunch the kernel workflow with stage=build'
    case 'relaunch-validate': return 'Relaunch the kernel workflow with stage=validate'
    case 'relaunch-report': return 'Relaunch the kernel workflow with stage=report'
    case 'reopen-slice': return `Reopen slice ${slice}: LAW is red — relaunch stage ${stage}`
    case 'operator-ruling': return hasSlice
      ? `Operator ruling: the run is blocked for slice ${slice} — rule, then relaunch stage ${stage}`
      : `Operator ruling: the run is blocked — rule, then relaunch stage ${stage}`
    case 'restore-gate': return `Rerun stage ${stage} after restoring the gate tool`
    case 'restore-codex': return `Restore codex, then relaunch stage ${stage} — the second family is needed`
    case 'acknowledge-degrade': return `Acknowledge single-family degradation, then relaunch stage ${stage}`
    case 'repair-failed': return hasSlice
      ? `Rerun stage ${stage}: the repair pass did not land for slice ${slice}`
      : `Rerun stage ${stage}: the repair pass did not land`
    case 'rerun-onboarding': return `Rerun onboarding, then relaunch stage ${stage}`
    // A "Rerun stage X" hint names its TARGET stage, which may differ from the current
    // stage — a build with no slice list must return to the LAW producer, never rerun
    // build. rerun-stage stays as the same-stage fallback when no target is parsed.
    case 'rerun-law': return 'Rerun stage law'
    case 'rerun-build': return 'Rerun stage build'
    case 'rerun-validate': return 'Rerun stage validate'
    case 'rerun-report': return 'Rerun stage report'
    case 'rerun-stage': return `Rerun stage ${stage}`
    default: return null
  }
}

// W2-S2 (H6 / B02): the eight-line STATE.md rendered from a typed record. This is the ONE
// render template, shared by a fresh commit and by crash reconciliation, so the rendered view
// is byte-identical either way — the exact former stateDoc format, incl. `seals: .kiln/seals.log`.
function renderStateDoc(rec) {
  return [
    '# STATE',
    'stage: ' + rec.stage,
    'active_slice: ' + rec.active_slice,
    'next_action: ' + rec.next_action,
    'density: ' + rec.density,
    'pointers: ' + rec.pointers.join(' '),
    'seals: ' + rec.seals,
    'updated_at: ' + rec.updated_at,
  ].join('\n') + '\n'
}

// Crash reconciliation. state.json is written and renamed BEFORE STATE.md, so a crash between
// the two renames (or a torn/deleted STATE.md) leaves the rendered view lagging the canonical
// record. On the next trusted write we heal it FIRST: if STATE.md does not hash to the
// render_digest in the record, re-render it from the typed record before advancing — the drift is
// bounded to one write and the STATE.md-only conductor read never sees a torn document. A prior that
// cannot be re-rendered (missing fields) is left for the new commit below to overwrite whole.
function reconcileStateDoc(kilnDir, prior) {
  if (typeof prior.render_digest !== 'string') return
  const docPath = join(kilnDir, 'STATE.md')
  let current = null
  try {
    current = readFileSync(docPath)
  } catch {
    current = null
  }
  const currentDigest = current === null ? null : createHash('sha256').update(current).digest('hex')
  if (currentDigest === prior.render_digest) return
  let healed
  try {
    healed = renderStateDoc(prior)
  } catch {
    return
  }
  try {
    mkdirSync(kilnDir, { recursive: true })
    const temporary = join(kilnDir, `.STATE.tmp-${process.pid}-${randomUUID()}`)
    writeFileSync(temporary, healed)
    renameSync(temporary, docPath)
  } catch {
    // A failed heal is not fatal on its own — the STATE.md write in the new commit below is the
    // next chance to re-render the view from the canonical record.
  }
}

// ── W2-S1 (H2 / B01): the CONDUCTOR-OWNED run lock ──────────────────────────
// A per-RUN concurrency guard at .kiln/run.lock — deliberately distinct from the per-PLAN
// law/lock.hash attestation. The conductor acquires ONCE before the sweep and passes run_id
// plus an opaque owner token to every workflow; the workflows JOIN with the exact token,
// never a second acquire. The record is NEVER destroyed: release and a stale takeover both
// append it to run-history.jsonl before the live lock is replaced or removed, so the run
// record always survives somewhere durable.
const LOCK_FILE = 'run.lock'
const LOCK_HISTORY = 'run-history.jsonl'
const LOCK_DENIED = 12
// The availability-panel choices the lock record carries. The stored word has NO reader anywhere in
// the tree — every later boot re-decides from the two marker files — so it is a record of what was
// answered, not a switch. S10 wired the panel that produces it: the conductor passes follow-ladders
// at all four of its call sites, so in practice only that word is stored, while this set is what the
// verbs would accept.
const LOCK_CHOICES = new Set(['follow-ladders', 'stop-at-boundary', 'edit-ladders'])
// run_id and owner are minted as UUIDs; join/release/takeover echo them back over argv, so a
// closed token grammar rejects any shell metacharacter, whitespace, or control byte.
const LOCK_TOKEN = /^[A-Za-z0-9._-]+$/
// A takeover needs BOTH a dead holder pid AND a lock aged past this floor — never time alone.
// The floor clears the run-s4 resume window (the lock is far older than this by the resume)
// while staying short enough that a genuinely abandoned lock frees quickly.
const LOCK_AGE_FLOOR_MS = 5000

// The plugin version stamped into a fresh lock record — read from the shipped manifest,
// honest or fail-closed, never fabricated.
function pluginVersion() {
  try {
    const meta = JSON.parse(readFileSync(join(__dirname, '..', '..', '.claude-plugin', 'plugin.json'), 'utf8'))
    return typeof meta.version === 'string' && meta.version.trim() !== '' ? meta.version : null
  } catch {
    return null
  }
}

// Read the lock record. It distinguishes a TORN lock — bytes readable, JSON unparseable, reported
// as exists with a null record — from absent. Every other read failure is coerced to exists:false
// here, so an unreadable shape reads as absent through this function alone; presence on those
// shapes is lockPresence below, which takeover conjoins before the no-lock words and then holds on
// an unreadable lock rather than proving it stale. join and release refuse on a null record.
function readLockRecord(lockPath) {
  let raw
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch {
    return { exists: false, record: null }
  }
  try {
    const record = JSON.parse(raw)
    return { exists: true, record: isObject(record) ? record : null }
  } catch {
    return { exists: true, record: null }
  }
}

// run_id provenance: the CLI reads the CLI-owned run.lock ITSELF and trusts run_id ONLY from a
// record in the W2-S1 shape (run_id + owner in the LOCK_TOKEN grammar, a positive-integer
// conductor_pid). An absent, unreadable, or non-conforming lock records run_id honestly as null
// (a legacy launch), never a model-authorable string dressed as authoritative identity.
function runIdFromLock(kilnDir) {
  const lock = readLockRecord(join(kilnDir, LOCK_FILE)).record
  const conforms = isObject(lock)
    && typeof lock.run_id === 'string' && LOCK_TOKEN.test(lock.run_id)
    && typeof lock.owner === 'string' && LOCK_TOKEN.test(lock.owner)
    && Number.isInteger(lock.conductor_pid) && lock.conductor_pid > 0
  return conforms ? lock.run_id : null
}

// The never-delete guarantee: append the full record plus the lock event and an archive
// timestamp to run-history.jsonl BEFORE the live lock is replaced or removed. A lock is never
// a bare unlink that loses the record.
function archiveLockRecord(kilnDir, record, event) {
  const row = JSON.stringify({ ...record, lock_event: event, archived_at: new Date().toISOString() })
  appendFileSync(join(kilnDir, LOCK_HISTORY), `${row}\n`)
}

// W2-S10: presence decided by PRESENCE, for the two sites S10 wires. lstat answers on shapes
// readFileSync cannot open — an unreadable file, a directory, a dangling link, a loop, a socket —
// where readLockRecord reports all of them as absent. The four S1 verbs keep their sealed
// fail-closed reads. THREE-valued deliberately: this returns absent for ENOENT and indeterminate for
// every other error, and both call sites route indeterminate to a hold ahead of the probe (two call
// sites, count-pinned). Two-valued was the same defect one line down from the one it cured.
function lockPresence(kilnDir) {
  try {
    lstatSync(join(kilnDir, LOCK_FILE))
    return 'present'
  } catch (error) {
    return error.code === 'ENOENT' ? 'absent' : 'indeterminate'
  }
}

// W2-S10 (10a) + S10d: the ONE marker removal here, serving both rulings a minting verb may issue —
// a `degraded` refuted live by the classifier that wrote it, and a `degraded-ack` with no detection
// under it, which is RESIDUE: a word with no subject, removed so no later detection can complete it
// into a pair the operator never spoke. Both are trust-bearing, so both leave a receipt: the row
// lands BEFORE the removal and a failed append HOLDs with the marker standing, the never-a-bare-
// unlink discipline archiveAndDrop keeps one screen up. Bounded: marker transitions do not generally
// earn rows, and the kernel clears of the same shape (clearPerceptualMarker in kernel.js, and its
// ratify candidate rm tagged ratify:invalidate) stay rowless. ENOENT means a contender got there
// first — the same end state, so the rm is idempotent and races converge.
function clearMarker(kilnDir, verb, name, event) {
  try {
    archiveLockRecord(kilnDir, { marker: name, verb }, event)
  } catch {
    stop('transport_failure', `run-lock ${verb} could not record the ${event} ruling — the marker stands, nothing lost`, TRANSPORT_FAILURE)
  }
  try {
    unlinkSync(join(kilnDir, name))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      stop('transport_failure', `run-lock ${verb} could not clear the ${name} marker: ${error.message}`, TRANSPORT_FAILURE)
    }
  }
}

// W2-S10: the availability probe the two MINTING verbs share. The two marker files differ by their
// WRITERS, counted over the whole shipped plugin rather than assumed (the S10 count-pin): FIVE sites
// touch `degraded` alone — kernel law ratify, milestone audit, degradedStop, the sweep feasibility
// ratify, and the builder card telling the agent to mark its own codex-absent build — while the
// single conductor touch is the only write of `degraded-ack` in the tree. So `degraded` is CLASSIFIED
// absence and the ack is the OPERATOR WORD. Both standing IS the word: mint, unquestioned. Otherwise
// the probe rules three ways — a clean exit 0 answers; a failure the REAL gate calls
// codex_unavailable panels; any other failure is unknown and mints, since the word has no remover
// but the operator hand and no low-fidelity detector may earn it. A detection with no word still
// steers the seats that read it, so the verbs rule it: an answer REFUTES it live — clear and go
// dual; anything less is a stop nobody answered — the panel. What that buys, stated as exactly what
// it is: a mint never completes over degraded-without-ack. Detections raised later in the run are
// each guarded where they are read, not here. join calls none of this (two call sites, pinned); it
// boots mid-run, already settled.
function refuseWithoutCodex(kilnDir, verb) {
  // Read as the other five readers read them (test -f): a REGULAR file, so a directory wearing a
  // marker name is absent here exactly as it is there, rather than a sixth detector disagreeing with
  // the five. A stat that FAILS is a different question, and only ENOENT proves absence — any other
  // failure holds, which is stricter than the five and never more permissive than them.
  const marker = (name) => {
    try {
      return statSync(join(kilnDir, name)).isFile()
    } catch (error) {
      if (error.code === 'ENOENT') return false
      stop('transport_failure', `run-lock ${verb} could not read the degradation marker ${name}: ${error.message}`, TRANSPORT_FAILURE)
    }
  }
  const detected = marker('degraded')
  // The fourth state: an ack with no detection under it. Inert to every reader — the defect is
  // COMPLETION, since a later detection would finish the pair and counterfeit a word nobody spoke.
  if (!detected && marker('degraded-ack')) clearMarker(kilnDir, verb, 'degraded-ack', 'ack_orphaned')
  if (detected && marker('degraded-ack')) return
  // SIGKILL, not the default TERM, or a binary that ignores TERM runs straight past the bound.
  const probe = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' })
  if (!probe.error && probe.status === 0) {
    // Cleared BEFORE the mint, never after: a crash in between would launch a run over the standing
    // stale marker. Clearing first leaves every crash state clean — marker gone, no lock, next
    // acquire mints dual — at the price that an invocation may clear and then LOSE the race. That
    // price is correct: the refutation is a fact about codex, not about who wins the lock.
    // BOTH markers are RE-READ here, after a probe that may have taken seconds. A word that landed
    // while it ran leaves the full pair standing and the verb mints under that acknowledged
    // degradation rather than destroying it; a detection that vanished while it ran leaves nothing
    // to refute, and a row asserting otherwise would be a receipt for a ruling never made. The
    // pre-probe read decides whether to ASK; only this read decides whether to ACT.
    if (marker('degraded') && !marker('degraded-ack')) clearMarker(kilnDir, verb, 'degraded', 'degradation_refuted')
    return
  }
  if (!detected && classifyFailure(probe) !== CODEX_UNAVAILABLE) return
  stop('codex_unavailable', `run-lock ${verb} refused: codex did not answer the availability probe and no acknowledged degradation stands — the availability panel rules first`, CODEX_UNAVAILABLE)
}

// process.kill(pid, 0) probes liveness without delivering a signal. Only ESRCH PROVES the
// holder is gone; success and EPERM prove it alive; any other error, or a missing or
// non-positive pid, is UNKNOWN. Takeover requires PROVEN dead, so it treats UNKNOWN as
// not-dead and fails closed — a lock is never taken over on unproven death (B03).
function pidState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    if (error.code === 'ESRCH') return 'dead'
    if (error.code === 'EPERM') return 'alive'
    return 'unknown'
  }
}

// Is a lock record takeover-stale? BOTH the holder pid must be PROVEN dead AND the lock aged
// past the floor — never time alone. Returns the reason on a refusal so the honest fact can
// name why (fail closed on an unprobeable pid or an unreadable start time).
function takeoverStale(record) {
  const state = pidState(record.conductor_pid)
  if (state === 'alive') return { stale: false, fact: 'live' }
  if (state !== 'dead') return { stale: false, fact: 'unprobeable' }
  const startedAt = Date.parse(record.started_at)
  if (!Number.isFinite(startedAt)) return { stale: false, fact: 'no-start' }
  if (Date.now() - startedAt < LOCK_AGE_FLOOR_MS) return { stale: false, fact: 'young' }
  return { stale: true, fact: 'stale' }
}

// Claim-by-rename: rename(2) on ONE source path has exactly one winner — the loser gets ENOENT.
// After a successful claim the caller holds the ONLY reference to those bytes, so every decision
// (takeover staleness, release identity) is re-made on the CLAIMED bytes, never on the pre-claim
// read a concurrent contender may already have invalidated. Returns {claimPath, record} on the
// win, or null when the claim was lost (ENOENT). Crash residue between claim and its terminal
// move leaves an orphaned .run.lock.claim-* file and an empty lock path — acceptable: the record
// bytes survive on disk (never-delete) and the next acquire proceeds fresh; there is no janitor.
function claimLock(kilnDir) {
  const claimPath = join(kilnDir, `.run.lock.claim-${process.pid}-${randomUUID()}`)
  try {
    renameSync(join(kilnDir, LOCK_FILE), claimPath)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  return { claimPath, record: readLockRecord(claimPath).record }
}

// The claimed record is NOT the one this verb may end (a fresh lock landed in the claim window):
// put it back. linkSync is create-exclusive — on success the claim is dropped and the lock is
// whole again (returns true). If the path is re-occupied, the displaced record is archived (never
// lost — its owner join-fails into the honest hold) and the claim removed (true). If archival ALSO
// fails (history unavailable), the claim file is the SOLE surviving copy, so it is PRESERVED on
// disk untouched — the documented orphan-claim residue — and false is returned: the claim is NEVER
// unlinked without the record safe somewhere durable, and the caller surfaces the transport failure.
function restoreOrArchive(kilnDir, claimPath, record) {
  try {
    linkSync(claimPath, join(kilnDir, LOCK_FILE))
    try { unlinkSync(claimPath) } catch { /* restored; the claim link can linger harmlessly */ }
    return true
  } catch { /* the lock path is re-occupied — the claimed record cannot go back there */ }
  if (record) {
    try {
      archiveLockRecord(kilnDir, record, 'displaced')
      try { unlinkSync(claimPath) } catch { /* archived; the claim file can linger harmlessly */ }
      return true
    } catch { /* history is unavailable — the claim is the last copy; preserve it, fall through */ }
  }
  return false
}

// The terminal move when this verb IS authorized to end the claimed lock: archive the record,
// then drop the claim. Archive FIRST, unlink second — never an unlink without an archive. If the
// archive fails, the record is the only copy, so it is RESTORED to the lock path rather than
// lost, and the caller fails transport. Returns true on a clean archive+drop.
function archiveAndDrop(kilnDir, claimPath, record, event) {
  try {
    archiveLockRecord(kilnDir, record, event)
  } catch {
    try { linkSync(claimPath, join(kilnDir, LOCK_FILE)); unlinkSync(claimPath) } catch { /* bytes remain in the claim file */ }
    return false
  }
  try { unlinkSync(claimPath) } catch { /* archived; the claim file can linger harmlessly */ }
  return true
}


module.exports = { LOCK_CHOICES, LOCK_DENIED, LOCK_FILE, LOCK_TOKEN, MASTER_PLAN_ARG, STATE_POINTER, STATE_SLICE_ID,
  STATE_STAGES, STATE_TOKENS, archiveAndDrop, claimLock, lockPresence, pluginVersion, readLockRecord,
  runIdFromLock,
  reconcileStateDoc, refuseWithoutCodex, renderStateDoc, restoreOrArchive, stateNextAction, takeoverStale }