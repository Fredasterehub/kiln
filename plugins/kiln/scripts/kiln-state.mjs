#!/usr/bin/env node
// kiln-state.mjs — the Kiln run-state CLI. Zero dependencies, plain node ≥18.
//
// BLUEPRINT §4: .kiln/events.jsonl is the append-only WRITE-AHEAD source of truth; state.json is
// a deterministic PROJECTION of it — rebuilt from the ledger, never trusted over it. STATE.md is
// dead as a machine surface: `summary` renders the human view to stdout and writes nothing.
// Schemas live in plugins/kiln/schemas/{event,state}.schema.json; validation here is hand-rolled
// to match them (no ajv, no deps). Timestamps come from the system clock — this CLI runs via
// Bash in agents, it is NOT workflow-inlined code, so workflow determinism rules do not apply to
// `ts` assignment. Projection itself IS fully deterministic: updated_at is the ts of the last
// event (never the wall clock), so the same ledger always projects byte-identical state.json.
//
// Stage authority (P3.6 T4): state.json.stage is a projection of the stage_started/stage_completed
// brackets the workflows append. It is stage-accurate at the gauge/research/architecture/build/
// validate/report boundaries — those stages bracket their runs (architecture completes only on a
// locked Law; report only on a written artifact; a failed stage emits no completion). mapping is
// off-table (not in STAGE_ORDER): its brackets are still ledgered — for the telegraph (termination
// + exact-once) and the audit trail — and the reducer records them verbatim (stage_started sets
// stage:'mapping'; stage_completed sets last_completed_stage), but NO bump follows, so `stage` rests
// at 'mapping' until the next on-table stage_started overwrites it. state.json is not
// stage-authoritative across the mapping window.
// A conducted run births the ledger at onboarding (kiln-fire SKILL.md §5, `init`); a harness-driven
// run that skips the conductor still gets correct stage projections wherever the workflows bracket.
//
// Usage:
//   kiln-state.mjs init <kilnDir> --project-path <abs> [--name <s>] [--type <s>] [--greenfield true|false]
//   kiln-state.mjs append <kilnDir> '<event-json>'   event-json: {type, stage, data?, git?} — seq + ts assigned here
//   kiln-state.mjs project <kilnDir>                 rebuild state.json from the ledger
//   kiln-state.mjs validate <kilnDir>                schema + seq contiguity + projection sync; exit 1 on violation
//   kiln-state.mjs summary <kilnDir>                 human markdown run summary to stdout
//   kiln-state.mjs since <kilnDir> <afterSeq> [--kind <k>[,<k>...]] [--limit <n>]   read-only tail: events seq > afterSeq as one JSON line (NO lock)
//   kiln-state.mjs since <kilnDir> tail              cursor bootstrap: {events:[], last_seq:<true ledger tail>, truncated:false} — no flags
//   kiln-state.mjs unlock <kilnDir>                  clear a stale append lock (refuses while the holder is alive)
// Exit codes: 0 ok · 1 violation/error · 2 usage.

import { readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, rmdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve, isAbsolute, basename } from 'node:path'

const EVENT_TYPES = ['run_init', 'stage_started', 'stage_completed', 'gate_decision', 'posture_set', 'posture_escalated', 'check_result', 'commit', 'evidence', 'escalation', 'note', 'browser_leak_suspect', 'browser_lease', 'browser_sweep', 'gate_only_refused', 'gate_skipped', 'goal_audit_failure', 'law_red_auto_reject', 'probe_unavailable', 'slice_plan_invalid', 'slice_plan_invalidated', 'slice_plan_replanned', 'tamper_auto_reject', 'tier2_traversal', 'validate_verdict', 'verification_degraded', 'vision_compiled']
const STAGE_ORDER = ['onboarding', 'brainstorm', 'gauge', 'research', 'architecture', 'build', 'validate', 'report']
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const SHA_RE = /^[0-9a-f]{7,40}$/
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const die = (msg, code = 1) => { console.error(`kiln-state: ${msg}`); process.exit(code) }
const warn = (msg) => console.error(`kiln-state: WARNING: ${msg}`)

// ── Hand-rolled validators, mirroring the schema files field-for-field ──────────────────────────
function validateEvent(ev, label) {
  const v = []
  if (!isObj(ev)) return [`${label}: not an object`]
  for (const k of Object.keys(ev)) if (!['seq', 'ts', 'type', 'stage', 'data', 'git'].includes(k)) v.push(`${label}: unknown key '${k}'`)
  if (!Number.isInteger(ev.seq) || ev.seq < 1) v.push(`${label}: seq must be an integer ≥ 1`)
  if (typeof ev.ts !== 'string' || !TS_RE.test(ev.ts)) v.push(`${label}: ts must be an ISO-8601 timestamp`)
  if (!EVENT_TYPES.includes(ev.type)) v.push(`${label}: type '${ev.type}' not in the event enum`)
  if (typeof ev.stage !== 'string') v.push(`${label}: stage must be a string`)
  if (!isObj(ev.data)) v.push(`${label}: data must be an object`)
  if (ev.git !== null && !(typeof ev.git === 'string' && SHA_RE.test(ev.git))) v.push(`${label}: git must be a 7-40 char hex sha or null`)
  return v
}

function validateState(st) {
  const v = []
  if (!isObj(st)) return ['state.json: not an object']
  const KEYS = ['schema', 'stage', 'last_completed_stage', 'posture', 'capability', 'project', 'milestones', 'counters', 'paths', 'started_at', 'updated_at', 'last_event_seq']
  for (const k of Object.keys(st)) if (!KEYS.includes(k)) v.push(`state.json: unknown key '${k}'`)
  for (const k of KEYS) if (!(k in st)) v.push(`state.json: missing key '${k}'`)
  if (st.schema !== 3) v.push('state.json: schema must be 3')
  if (typeof st.stage !== 'string') v.push('state.json: stage must be a string')
  if (st.last_completed_stage !== null && typeof st.last_completed_stage !== 'string') v.push('state.json: last_completed_stage must be a string or null')
  if (st.posture !== null && !isObj(st.posture)) v.push('state.json: posture must be an object or null')
  if (st.capability !== null) {
    if (!isObj(st.capability)) v.push('state.json: capability must be an object or null')
    else {
      for (const k of Object.keys(st.capability)) if (!['tier', 'verification_class', 'probes'].includes(k)) v.push(`state.json: capability has unknown key '${k}'`)
      if (typeof st.capability.tier !== 'string') v.push('state.json: capability.tier must be a string')
      if (typeof st.capability.verification_class !== 'string') v.push('state.json: capability.verification_class must be a string')
      if (!isObj(st.capability.probes)) v.push('state.json: capability.probes must be an object')
    }
  }
  if (!isObj(st.project)) v.push('state.json: project must be an object')
  else {
    for (const k of Object.keys(st.project)) if (!['name', 'path', 'type', 'greenfield'].includes(k)) v.push(`state.json: project has unknown key '${k}'`)
    for (const k of ['name', 'path', 'type']) if (typeof st.project[k] !== 'string') v.push(`state.json: project.${k} must be a string`)
    if (typeof st.project.greenfield !== 'boolean') v.push('state.json: project.greenfield must be a boolean')
  }
  if (!isObj(st.milestones)) v.push('state.json: milestones must be an object')
  else {
    for (const k of Object.keys(st.milestones)) if (!['count', 'complete', 'current'].includes(k)) v.push(`state.json: milestones has unknown key '${k}'`)
    for (const k of ['count', 'complete']) if (!Number.isInteger(st.milestones[k]) || st.milestones[k] < 0) v.push(`state.json: milestones.${k} must be an integer ≥ 0`)
    const cur = st.milestones.current
    if (cur !== null && typeof cur !== 'string' && !Number.isInteger(cur)) v.push('state.json: milestones.current must be a string, integer, or null')
  }
  if (!isObj(st.counters)) v.push('state.json: counters must be an object')
  else {
    for (const k of Object.keys(st.counters)) if (!['correction_cycle', 'build_iteration'].includes(k)) v.push(`state.json: counters has unknown key '${k}'`)
    for (const k of ['correction_cycle', 'build_iteration']) if (!Number.isInteger(st.counters[k]) || st.counters[k] < 0) v.push(`state.json: counters.${k} must be an integer ≥ 0`)
  }
  if (!isObj(st.paths)) v.push('state.json: paths must be an object')
  for (const k of ['started_at', 'updated_at']) if (typeof st[k] !== 'string') v.push(`state.json: ${k} must be a string`)
  if (!Number.isInteger(st.last_event_seq) || st.last_event_seq < 1) v.push('state.json: last_event_seq must be an integer ≥ 1')
  return v
}

// ── Ledger I/O ───────────────────────────────────────────────────────────────────────────────────
// Truncation vs corruption is decided by the trailing newline: append always writes '<json>\n',
// so a healthy ledger ends with '\n' and every line in it is COMPLETE. Only when that final
// newline is missing — the signature of an interrupted append — may an unparseable last line be
// dropped with a warning; partial-write recovery is structural (BLUEPRINT §4). A COMPLETE line
// that fails to parse is real corruption wherever it sits, final line included, and throws:
// kiln-state never guesses past garbage that was fully written.
function readLedger(kilnDir) {
  const file = join(kilnDir, 'events.jsonl')
  if (!existsSync(file)) throw new Error(`no events.jsonl in ${kilnDir} — run 'init' first`)
  const raw = readFileSync(file, 'utf8')
  const unterminated = raw !== '' && !raw.endsWith('\n')
  const lines = raw.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const events = []
  let dropped = false
  lines.forEach((line, i) => {
    try { events.push(JSON.parse(line)) } catch (e) {
      if (unterminated && i === lines.length - 1) { dropped = true; warn(`dropped truncated final line of events.jsonl (${line.length} bytes)`) }
      else throw new Error(`events.jsonl line ${i + 1} is corrupt — the ledger needs manual repair (only an unterminated final line is recoverable truncation)`)
    }
  })
  if (!events.length) throw new Error('events.jsonl holds no valid events')
  if (dropped) lines.pop()
  // unterminated also flags the tail for append-side healing when the partial line PARSED (a
  // write cut exactly before its newline) — appending onto it raw would glue two events together.
  return { file, events, lines, unterminated }
}

// state.json writes are atomic: write a tmp file in the same dir, then rename over the target.
function writeState(kilnDir, st) {
  const file = join(kilnDir, 'state.json')
  writeFileSync(file + '.tmp', JSON.stringify(st, null, 2) + '\n')
  renameSync(file + '.tmp', file)
  return file
}

// ── Append lock ────────────────────────────────────────────────────────────────────────────────
// Concurrent appends corrupt the ledger: two writers deriving next seq off the same tail duplicate
// it, and one healing the unterminated tail while the other appends loses bytes across the rename.
// The whole read→heal→derive→append→project section runs under one atomic mkdir lock (POSIX-atomic,
// no deps). There is NO steal in the hot path: a crashed writer's lock is cleared out-of-band by the
// `unlock` subcommand (which refuses while the holder is alive), never yanked mid-write by a racer.
const LOCK_DEADLINE_MS = 5000
const LOCK_RETRY_MS = 25
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
let lockCounter = 0

// The lock carries a MANDATORY ownership token. mkdir is the atomic gate; the moment it wins, we
// write {pid, ts, token} into owner.json INSIDE the dir. If that write fails we rmdir the lock and
// die rather than hold a tokenless lock — the write fence and release both key on the token, so a
// tokenless lock would be un-fenceable and un-releasable. The token is unique per acquire.
function acquireAppendLock(kilnDir) {
  const lockDir = join(kilnDir, '.state.lock')
  const token = `${process.pid}-${Date.now()}-${lockCounter++}-${Math.random().toString(36).slice(2)}`
  const deadline = Date.now() + LOCK_DEADLINE_MS
  for (;;) {
    try {
      mkdirSync(lockDir)
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (Date.now() >= deadline) {
        let who = 'owner.json unreadable'
        try { const o = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')); who = `held by pid ${o.pid} since ${o.ts}` } catch { /* owner gone/garbage */ }
        die(`append: could not acquire ${lockDir} within ${LOCK_DEADLINE_MS}ms — ${who}. If that process is dead, clear it with: kiln-state unlock ${kilnDir} (refuses while the holder is alive)`)
      }
      sleep(LOCK_RETRY_MS)
      continue
    }
    // mkdir won the gate — the token MUST land or we don't hold the lock.
    try {
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), token }))
    } catch (e) {
      try { rmdirSync(lockDir) } catch { /* nothing to unwind */ }
      die(`append: acquired ${lockDir} but could not write owner.json (${e.message}) — released it rather than hold a tokenless lock`)
    }
    return { lockDir, token }
  }
}

// Write fence: re-read owner.json and confirm OUR token still owns the lock. Called immediately
// before each write in the critical section. With no steal in the hot path this only ever fires
// against an out-of-band `unlock` (or manual tampering) racing a live holder — so we abort BEFORE
// writing rather than scribble under a lock we no longer own.
function lockStillOurs(lockDir, token) {
  let owner
  try { owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) } catch { return false }
  return isObj(owner) && owner.token === token
}

function releaseAppendLock(lockDir, token) {
  // Tear the lock down only if owner.json still holds OUR token; a differing/vanished owner means
  // something out-of-band already cleared us, so touch nothing. Belt-and-suspenders with no steal.
  let owner
  try { owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) } catch { return }
  if (!isObj(owner) || owner.token !== token) return
  try { rmSync(join(lockDir, 'owner.json'), { force: true }) } catch { /* already gone */ }
  try { rmdirSync(lockDir) } catch { /* already released */ }
}

// ── Projection — the only producer of state.json content (tasks.md T2.4, encoded exactly) ───────
// Events fold in seq order. Per-type rules:
//   run_init          → project ← data.project, started_at = ts, stage = event.stage
//   stage_started     → stage = event.stage
//   stage_completed   → last_completed_stage = event.stage; stage bumps to the next entry of
//                       STAGE_ORDER (the final entry and off-table stages do not bump)
//   posture_set       → posture = data.posture (replace)
//   posture_escalated → posture = { ...posture, ...data.posture } (shallow-merge)
//   other KNOWN types → no per-type fold; UNKNOWN types fold into NOTHING, no error (forward
//                       compat) — only the positional bookkeeping below advances for them.
// Generic folds first, from any KNOWN event's data: capability replaces (normalized to schema
// shape); milestones / counters merge known keys; paths shallow-merges. updated_at = ts of the
// last event — never the wall clock — so projection is byte-deterministic. updated_at and
// last_event_seq track the ledger position for EVERY event (validate compares last_event_seq to
// the ledger tail) — they are bookkeeping, not a fold of the event's data.
function projectState(events) {
  const sorted = [...events].sort((a, b) => (a.seq || 0) - (b.seq || 0))
  const st = {
    schema: 3,
    stage: STAGE_ORDER[0],
    last_completed_stage: null,
    posture: null,
    capability: null,
    project: { name: '', path: '', type: 'unknown', greenfield: true },
    milestones: { count: 0, complete: 0, current: null },
    counters: { correction_cycle: 0, build_iteration: 0 },
    paths: {},
    started_at: sorted[0].ts,
    updated_at: sorted[0].ts,
    last_event_seq: sorted[0].seq,
  }
  for (const ev of sorted) {
    if (EVENT_TYPES.includes(ev.type)) { // unknown types reach the bookkeeping below and nothing else
      const d = isObj(ev.data) ? ev.data : {}
      if (isObj(d.capability)) {
        st.capability = {
          tier: typeof d.capability.tier === 'string' ? d.capability.tier : '',
          verification_class: typeof d.capability.verification_class === 'string' ? d.capability.verification_class : '',
          probes: isObj(d.capability.probes) ? d.capability.probes : {},
        }
      }
      if (isObj(d.milestones)) for (const k of ['count', 'complete', 'current']) { if (k in d.milestones) st.milestones[k] = d.milestones[k] }
      if (isObj(d.counters)) for (const k of ['correction_cycle', 'build_iteration']) { if (k in d.counters) st.counters[k] = d.counters[k] }
      if (isObj(d.paths)) st.paths = { ...st.paths, ...d.paths }
      switch (ev.type) {
        case 'run_init': {
          const p = isObj(d.project) ? d.project : {}
          st.project = {
            name: typeof p.name === 'string' ? p.name : '',
            path: typeof p.path === 'string' ? p.path : '',
            type: typeof p.type === 'string' ? p.type : 'unknown',
            greenfield: typeof p.greenfield === 'boolean' ? p.greenfield : true,
          }
          st.started_at = ev.ts
          if (typeof ev.stage === 'string') st.stage = ev.stage
          break
        }
        case 'stage_started': st.stage = ev.stage; break
        case 'stage_completed': {
          st.last_completed_stage = ev.stage
          const i = STAGE_ORDER.indexOf(ev.stage)
          if (i >= 0 && i < STAGE_ORDER.length - 1) st.stage = STAGE_ORDER[i + 1]
          break
        }
        case 'posture_set': if (isObj(d.posture)) st.posture = d.posture; break
        case 'posture_escalated': if (isObj(d.posture)) st.posture = { ...(st.posture || {}), ...d.posture }; break
        default: break
      }
    }
    st.updated_at = ev.ts
    st.last_event_seq = ev.seq
  }
  return st
}

// Canonical serialization (keys sorted recursively) — validate compares VALUES, so a state.json
// that merely reorders keys is judged on content, not byte order.
const canon = (x) => Array.isArray(x) ? `[${x.map(canon).join(',')}]`
  : isObj(x) ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`
  : JSON.stringify(x)

// ── Commands ─────────────────────────────────────────────────────────────────────────────────────
function cmdInit(kilnDir, flags) {
  for (const k of Object.keys(flags)) if (!['project-path', 'name', 'type', 'greenfield'].includes(k)) die(`init: unknown flag --${k}`, 2)
  const projectPath = flags['project-path']
  if (!projectPath || !isAbsolute(projectPath)) die('init requires --project-path <absolute path>', 2)
  if (flags.greenfield !== undefined && flags.greenfield !== 'true' && flags.greenfield !== 'false') die('init: --greenfield takes true or false', 2)
  const file = join(kilnDir, 'events.jsonl')
  if (existsSync(file)) die(`${file} already exists — refusing to re-init over a live ledger`)
  mkdirSync(kilnDir, { recursive: true })
  const ev = {
    seq: 1, ts: new Date().toISOString(), type: 'run_init', stage: 'onboarding',
    data: {
      project: {
        name: flags.name || basename(projectPath),
        path: projectPath,
        type: flags.type || 'unknown',
        greenfield: flags.greenfield !== 'false',
      },
    },
    git: null,
  }
  appendFileSync(file, JSON.stringify(ev) + '\n')
  writeState(kilnDir, projectState([ev]))
  console.log(`kiln-state: initialized ${kilnDir} (run_init seq 1)`)
}

function cmdAppend(kilnDir, json) {
  let input
  try { input = JSON.parse(json) } catch (e) { die(`append: event is not valid JSON — ${e.message}`) }
  if (!isObj(input)) die('append: event must be a JSON object')
  for (const k of Object.keys(input)) {
    if (k === 'seq' || k === 'ts') die(`append assigns ${k} itself — provide only type, stage, data, git`)
    if (!['type', 'stage', 'data', 'git'].includes(k)) die(`append: unknown event key '${k}'`)
  }
  const { lockDir, token } = acquireAppendLock(kilnDir)
  try {
    const { file, events, lines, unterminated } = readLedger(kilnDir)
    // Heal before appending: an unterminated tail would swallow the new event's bytes. Rewrite the
    // surviving lines atomically (original raw lines, not re-serialized), then append as usual.
    if (unterminated) {
      writeFileSync(file + '.tmp', lines.join('\n') + '\n')
      renameSync(file + '.tmp', file)
    }
    const ev = {
      seq: events[events.length - 1].seq + 1,
      ts: new Date().toISOString(),
      type: input.type,
      stage: input.stage,
      data: input.data === undefined ? {} : input.data, // defaults fill absent fields, never mask bad ones
      git: input.git === undefined ? null : input.git,
    }
    const viol = validateEvent(ev, 'event')
    if (viol.length) throw new Error(`append: invalid event:\n  ${viol.join('\n  ')}`) // finally releases the lock; dispatch reports it
    // Write-ahead discipline: the ledger line lands FIRST, then the projection updates atomically.
    // Write fence before EACH write: re-verify our token owns the lock (guards an out-of-band `unlock`
    // racing us). If the fence fires between the two writes the ledger is already extended but the
    // projection is skipped — state.json is then stale by exactly one event, which `kiln-state project`
    // rebuilds; the ledger (the write-ahead source of truth) stays intact either way.
    if (!lockStillOurs(lockDir, token)) die('append: lock lost before write — ledger untouched')
    appendFileSync(file, JSON.stringify(ev) + '\n')
    if (!lockStillOurs(lockDir, token)) die('append: lock lost between writes — ledger extended, projection skipped (kiln-state project rebuilds it)')
    writeState(kilnDir, projectState([...events, ev]))
    console.log(JSON.stringify(ev))
  } finally {
    releaseAppendLock(lockDir, token)
  }
}

function cmdProject(kilnDir) {
  const { events } = readLedger(kilnDir)
  const file = writeState(kilnDir, projectState(events))
  console.log(`kiln-state: projected ${events.length} events (last seq ${events[events.length - 1].seq}) → ${file}`)
}

function cmdValidate(kilnDir) {
  const v = []
  let events = null
  try { ({ events } = readLedger(kilnDir)) } catch (e) { v.push(e.message) }
  if (events) {
    events.forEach((ev, i) => v.push(...validateEvent(ev, `event ${i + 1}`)))
    events.forEach((ev, i) => {
      if (Number.isInteger(ev.seq) && ev.seq !== i + 1) v.push(`event ${i + 1}: seq ${ev.seq} breaks contiguity (expected ${i + 1})`)
    })
    let st = null
    try { st = JSON.parse(readFileSync(join(kilnDir, 'state.json'), 'utf8')) } catch (e) { v.push(`state.json: ${e.message}`) }
    if (st) {
      v.push(...validateState(st))
      const tail = events[events.length - 1]
      if (st.last_event_seq !== tail.seq) v.push(`state.json: last_event_seq ${st.last_event_seq} ≠ ledger tail seq ${tail.seq}`)
      // The ledger wins: state.json must equal its own projection, value-for-value.
      if (canon(st) !== canon(projectState(events))) v.push("state.json: does not match the projection of events.jsonl — run 'project' to rebuild")
    }
  }
  if (v.length) { console.error(`kiln-state: INVALID:\n  ${v.join('\n  ')}`); process.exit(1) }
  console.log(`kiln-state: valid — ${events.length} events (seq 1..${events.length}), state.json in sync`)
}

// The human view (the STATE.md replacement) — rendered from the ledger, written nowhere.
function cmdSummary(kilnDir) {
  const { events } = readLedger(kilnDir)
  const st = projectState(events)
  const stageNo = STAGE_ORDER.indexOf(st.stage)
  const posture = st.posture
    ? Object.entries(st.posture).map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`).join(' · ')
    : 'not yet gauged'
  process.stdout.write([
    `# Kiln — ${st.project.name || 'unnamed run'}`,
    '',
    `**Stage:** ${st.stage}${stageNo >= 0 ? ` (${stageNo + 1}/${STAGE_ORDER.length})` : ''}${st.last_completed_stage ? ` · last completed: ${st.last_completed_stage}` : ''}`,
    `**Posture:** ${posture}`,
    `**Capability:** ${st.capability ? `${st.capability.tier} · ${st.capability.verification_class} verification` : 'not yet probed'}`,
    `**Milestones:** ${st.milestones.count ? `${st.milestones.complete}/${st.milestones.count} complete${st.milestones.current !== null ? ` · current: ${st.milestones.current}` : ''}` : 'not yet planned'}`,
    `**Cycles:** build iteration ${st.counters.build_iteration} · correction cycle ${st.counters.correction_cycle}`,
    `**Project:** ${st.project.path} (${st.project.type}, ${st.project.greenfield ? 'greenfield' : 'brownfield'})`,
    `**Run:** started ${st.started_at} · last event #${st.last_event_seq} at ${st.updated_at}`,
  ].join('\n') + '\n')
}

// Read-only ledger tail (WS-C/C3): events with seq > afterSeq as ONE JSON line, for the conductor's
// story-telegraph loop. Takes NO lock and writes nothing — pure read. Tolerant of a torn final line
// (an interrupted append): readLedger drops an unterminated unparseable tail with a warning, so the
// telegraph never errors on the very tail it is chasing. --kind filters NOTE events by data.kind
// (lore beats vs slice_telemetry / divergence / …); structural lifecycle events (stage_completed, …)
// are not kinds and always pass, so ONE `since … --kind lore` call both feeds the beats and lets the
// tail see the stage close. --limit caps the batch (default 200): truncated:true with last_seq at the
// last delivered event means "call again from there"; otherwise last_seq is the ledger tail (so the
// cursor advances past filtered-out events too). Missing file ⇒ {events:[],last_seq:null,truncated:false}, exit 0.
//
// `since <kilnDir> tail` is the CURSOR BOOTSTRAP form (r2 finding 1): it delivers NOTHING and
// returns the TRUE ledger tail as last_seq — the one non-truncating way to capture a first cursor
// (a capped numeric query returns the first delivered seq when truncated, which would replay
// history). No flags: the form answers exactly one question.
//
// Every failure mode here is FAIL-SOFT (the telegraph is presentation — it may never stall a run):
// an empty or fully-torn ledger, or any other readLedger refusal, degrades to the missing-file
// shape with a stderr warning, exit 0. The loud refusals stay where repair decisions live —
// `project` and `validate` still exit 1 on real corruption.
function cmdSince(kilnDir, afterSeqArg, flags) {
  for (const k of Object.keys(flags)) if (!['kind', 'limit'].includes(k)) die(`since: unknown flag --${k}`, 2)
  const tailForm = afterSeqArg === 'tail'
  if (tailForm && Object.keys(flags).length) die('since tail takes no flags', 2)
  const afterSeq = tailForm ? null : Number(afterSeqArg)
  if (!tailForm && (!Number.isInteger(afterSeq) || afterSeq < 0)) die("since requires <afterSeq> as an integer ≥ 0 (or the literal 'tail')", 2)
  const limit = flags.limit === undefined ? 200 : Number(flags.limit)
  if (!Number.isInteger(limit) || limit < 1) die('since: --limit takes an integer ≥ 1', 2)
  const kinds = flags.kind === undefined ? null : flags.kind.split(',').map((s) => s.trim()).filter(Boolean)
  const emptyShape = () => console.log(JSON.stringify({ events: [], last_seq: null, truncated: false }))
  const file = join(kilnDir, 'events.jsonl')
  if (!existsSync(file)) { emptyShape(); return }
  let events
  try { ({ events } = readLedger(kilnDir)) } catch (e) { warn(`since: ${e.message} — degrading to the empty shape (read-only tail, fail-soft)`); emptyShape(); return }
  const tailSeq = events[events.length - 1].seq
  if (tailForm) { console.log(JSON.stringify({ events: [], last_seq: tailSeq, truncated: false })); return }
  const passesKind = (ev) => {
    if (kinds === null) return true
    if (ev.type !== 'note') return true // lifecycle events carry no data.kind — never filtered out
    const k = isObj(ev.data) ? ev.data.kind : undefined
    return typeof k === 'string' && kinds.includes(k)
  }
  const matched = events.filter((ev) => Number.isInteger(ev.seq) && ev.seq > afterSeq && passesKind(ev))
  const truncated = matched.length > limit
  const out = truncated ? matched.slice(0, limit) : matched
  const last_seq = truncated ? out[out.length - 1].seq : tailSeq
  console.log(JSON.stringify({ events: out, last_seq, truncated }))
}

// Out-of-band recovery for a wedged lock: NEVER called by append. Clears .state.lock only when its
// holder is provably gone — a live pid (process.kill(pid, 0) succeeds, or EPERM = exists-not-ours)
// refuses, so a running writer can never have its lock pulled out from under it.
function cmdUnlock(kilnDir) {
  const lockDir = join(kilnDir, '.state.lock')
  if (!existsSync(lockDir)) { console.log(`kiln-state: no lock at ${lockDir} — nothing to clear`); return }
  let owner = null
  try { owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) } catch { /* tokenless/garbage lock — clearable */ }
  if (isObj(owner) && Number.isInteger(owner.pid)) {
    let alive = false
    try { process.kill(owner.pid, 0); alive = true } catch (e) { alive = e.code === 'EPERM' } // EPERM → exists, just not ours
    if (alive) die(`unlock: ${lockDir} is held by a LIVE process (pid ${owner.pid} since ${owner.ts}) — refusing to clear it; stop that process first`)
  }
  rmSync(lockDir, { recursive: true, force: true })
  console.log(`kiln-state: cleared stale lock ${lockDir} — was ${isObj(owner) ? `pid ${owner.pid} (ts ${owner.ts})` : 'a tokenless/unreadable owner'}`)
}

// ── Dispatch ─────────────────────────────────────────────────────────────────────────────────────
const USAGE = `usage: kiln-state.mjs <init|append|project|validate|summary|since|unlock> <kilnDir> [args]   (header comment has the full forms)`
function parseFlags(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) die(USAGE, 2)
    flags[argv[i].slice(2)] = argv[i + 1]
  }
  return flags
}

const [cmd, kilnDirArg, ...rest] = process.argv.slice(2)
if (!cmd || !kilnDirArg) die(USAGE, 2)
const kilnDir = resolve(kilnDirArg)
try {
  if (cmd === 'init') cmdInit(kilnDir, parseFlags(rest))
  else if (cmd === 'append') { if (rest.length !== 1) die(USAGE, 2); cmdAppend(kilnDir, rest[0]) }
  else if (cmd === 'project') cmdProject(kilnDir)
  else if (cmd === 'validate') cmdValidate(kilnDir)
  else if (cmd === 'summary') cmdSummary(kilnDir)
  else if (cmd === 'since') { if (rest.length < 1) die(USAGE, 2); cmdSince(kilnDir, rest[0], parseFlags(rest.slice(1))) }
  else if (cmd === 'unlock') cmdUnlock(kilnDir)
  else die(USAGE, 2)
} catch (e) { die(e.message) }
