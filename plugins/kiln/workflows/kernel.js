export const meta = {
  name: 'kiln-kernel',
  description: 'Content-blind scheduler: one stage per invocation — dispatch, gates, counters, resume, path routing. Branches on closed machine facts only.',
}

// KERNEL_CORE_BEGIN — pure core: no fs, no clock, no randomness (tests evaluate this region)

const SPINE = ['law', 'build', 'validate', 'report']
// brainstorm precedes the spine but lives in the Da Vinci teammate (conductor-side);
// the kernel sees it only as the needs-brainstorm status below.

// Parse-and-hop: the Workflow tool may deliver args as a JSON-encoded STRING
// (platform behavior, v3 precedent). Envelope mechanics, not content — the one
// sanctioned parse call in this file. Malformed input never silently takes
// the bare path.
function parseArgs(a) {
  if (a === undefined || a === null) return { ok: true, value: {} }
  if (typeof a === 'object' && !Array.isArray(a)) return { ok: true, value: a }
  if (typeof a !== 'string') return { ok: false }
  try {
    const v = JSON.parse(a)
    return v && typeof v === 'object' && !Array.isArray(v) ? { ok: true, value: v } : { ok: false }
  } catch { return { ok: false } }
}

function resolveStage(a) {
  if (a && a.stage) return SPINE.includes(a.stage) ? a.stage : null
  return a && a.idea ? 'law' : 'needs-brainstorm'
}

function nextStage(s) {
  const i = SPINE.indexOf(s)
  return i >= 0 && i + 1 < SPINE.length ? SPINE[i + 1] : null
}

function gateOutcome(exit) {
  return { 0: 'accept', 10: 'reject', 11: 'blocked', 21: 'codex_unavailable' }[exit]
    ?? 'transport_failure' // 20 and anything unrecognized fail closed
}

// The repair/recheck loop over injected closures. gate(mode, pass) → exit int;
// repair(pass) → true only when the repair result AND its delta are confirmed.
// Max two repair passes, then blocked (locked BEHAVIOR). A recheck runs only
// after a confirmed repair; an unconfirmed repair halts visibly.
async function reviewLoop(deps, maxRepairs = 2) {
  let repairs = 0
  let exit = await deps.gate('review', 0)
  for (;;) {
    const o = gateOutcome(exit)
    if (o === 'accept') return { result: 'sealed', repairs }
    if (o === 'blocked') return { result: 'blocked', repairs }
    if (o === 'codex_unavailable') return { result: 'degraded', repairs }
    if (o === 'transport_failure') return { result: 'transport-failure', repairs }
    if (repairs >= maxRepairs) return { result: 'blocked', repairs }
    repairs += 1
    const confirmed = await deps.repair(repairs)
    if (confirmed !== true) return { result: 'repair-failed', repairs }
    exit = await deps.gate('recheck', repairs)
  }
}

// The kernel fills every kernel-owned slot from the sealed voice.json slots
// map — closed machine facts and counters only; every semantic slot arrives
// stage-prefilled ({quote}, {title_row}, …) and passes through untouched.
const KERNEL_SLOTS = ['STAGE', 'i', 'n', 's', 't', 'slice', 'label', 'driver', 'passes', 'count', 'ids', 'streak', 'STREAK']
function fillClosed(beat, facts) {
  let out = String(beat ?? '')
  for (const k of KERNEL_SLOTS) {
    if (facts && facts[k] !== undefined && facts[k] !== null) {
      out = out.split('{' + k + '}').join(String(facts[k]))
    }
  }
  return out
}

// The kill-streak arithmetic, verbatim from the sealed voice.json formula:
// index = (max(iteration + corrections, 1) - 1) % 40.
function streakIndex(iteration, corrections, length = 40) {
  return (Math.max(iteration + corrections, 1) - 1) % length
}

// STATE.md is one page of closed facts the kernel owns. updated_at is stamped
// by the shell at write time (no clock in this runtime).
function stateDoc(f) {
  return [
    '# STATE',
    'stage: ' + (f.stage ?? ''),
    'active_slice: ' + (f.active_slice ?? 'none'),
    'next_action: ' + (f.next_action ?? ''),
    'pointers: ' + (f.pointers ?? []).join(' '),
    'seals: ' + (f.seals ?? '.kiln/seals.log'),
    'updated_at: {updated_at}',
  ].join('\n')
}

// Exact shell for the atomic write: temp file, timestamp substitution, rename.
// The heredoc terminator stands alone on its own line; set -e surfaces any
// failed step as a nonzero exit.
function atomicWriteCmd(doc) {
  return [
    'set -e',
    'mkdir -p .kiln',
    "cat > .kiln/.STATE.tmp <<'KILN_STATE_EOF'",
    doc,
    'KILN_STATE_EOF',
    'ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'sed -i "s/{updated_at}/$ts/" .kiln/.STATE.tmp',
    'mv -f .kiln/.STATE.tmp .kiln/STATE.md',
  ].join('\n')
}

function gateCmd(mode, p) {
  const bin = p.plugin + '/scripts/kiln-review'
  return mode === 'recheck'
    ? [bin, 'recheck', p.repo, p.request, p.priorGate, p.delta, p.gate].join(' ')
    : [bin, 'review', p.repo, p.request, p.gate].join(' ')
}

const LAW_CHECK = 'bash .kiln/law/check.sh'
// Resume / stage-end / completion guard: a missing check succeeds; a present
// red check stays nonzero.
const LAW_GUARD = 'if test -f .kiln/law/check.sh; then ' + LAW_CHECK + '; fi'

// KERNEL_CORE_END
// KERNEL_RUNTIME_BEGIN — evaluated as an async function body by the workflow runtime

// W-01: accept args in both shapes; malformed input is a closed-fact error,
// never a silent bare path. No trusted paths exist here, so the beat is a
// kernel-owned honest line (no sealed key covers transport errors).
const parsed = parseArgs(args)
if (!parsed.ok) {
  return { status: 'bad-args', beat: 'Malformed launch args reached the kernel — relaunch with stage, projectDir, and idea.', pointers: {} }
}
const A = parsed.value

const projectDir = A.projectDir
const plugin = A.plugin ?? 'plugins/kiln'
const P = {
  state: '.kiln/STATE.md', law: '.kiln/LAW.md', gate: '.kiln/gate-review.json',
  request: '.kiln/review-request.json', delta: '.kiln/repair-delta.md',
  slices: '.kiln/slices.json', seals: '.kiln/seals.log', degraded: '.kiln/degraded',
  card: (s) => plugin + '/cards/' + s + '.md',
}
const EXIT = { type: 'object', additionalProperties: false, properties: { exit: { type: 'integer' } }, required: ['exit'] }
const IDS = { type: 'object', additionalProperties: false, properties: { exit: { type: 'integer' }, ids: { type: 'array', items: { type: 'string' } } }, required: ['exit', 'ids'] }
const STAGE_RESULT = {
  type: 'object', additionalProperties: false,
  properties: { ok: { type: 'boolean' }, beat: { type: 'string' }, pointers: { type: 'array', items: { type: 'string' } } },
  required: ['ok', 'beat', 'pointers'],
}

// Mechanical hands: run one command, report the exit code. Nothing else.
const hands = (cmd, label) => agent(
  'Run exactly this in ' + projectDir + ' and report only the exit code as {exit}:\n' + cmd,
  { label, effort: 'low', schema: EXIT },
).then(r => (r ? r.exit : 20))

// Closed-facts fetch: exit code plus a schema-forced string list.
const idsFetch = (cmd, label, when) => agent(
  'Run exactly this in ' + projectDir + '. Report {exit, ids}: exit = the exit code; ids = ' + when + ':\n' + cmd,
  { label, effort: 'low', schema: IDS },
).then(r => (r ?? { exit: 20, ids: [] }))

// LAW beats report the owning slice ids on red (check.sh prints them; they
// arrive schema-forced — closed facts, never prose).
const lawBeat = (cmd, label) => idsFetch(cmd, label, 'the owning slice ids the check printed on stdout when exit != 0, else []')

// W-03: every kernel return carries a real beat. Sealed voice templates are
// fetched as opaque strings (the kernel carries beats, never parses them) and
// kernel-owned slots fill as ever; the fallback line fires only when the
// voice file is unreachable.
const voiceBeat = (key, facts, fallback) => idsFetch(
  "node -p 'JSON.stringify(require(" + JSON.stringify(plugin + '/data/voice.json') + ').beats[' + JSON.stringify(key) + "])'",
  'voice:' + key, 'the printed JSON array of beat templates, [] if exit != 0',
).then(v => fillClosed(v.ids[0] ?? fallback, facts))

const act = (prompt, label) => agent(prompt, { label, effort: 'medium', schema: STAGE_RESULT })
  .then(r => (r ?? { ok: false, beat: '', pointers: [] }))

const stage = resolveStage(A)
if (stage === 'needs-brainstorm') {
  const nb = projectDir
    ? await voiceBeat('stage.brainstorm', {}, 'The anvil is empty — brainstorm first.')
    : 'The anvil is empty — brainstorm first.'
  return { status: 'needs-brainstorm', beat: nb, pointers: { state: P.state } }
}
if (!stage) {
  return { status: 'bad-args', beat: 'Unknown stage in the launch args — the spine knows law, build, validate, report.', pointers: { state: P.state } }
}

const beats = []
const routes = new Set([P.state, P.law, P.gate])
const point = { state: P.state, next_stage: nextStage(stage) }
const done = (status, extra) => ({ status, beat: beats.join('\n'), pointers: { ...point, routes: [...routes], ...extra } })
const persistFail = (what) => ({
  status: 'persist-failed',
  beat: 'The ledger would not take the write (' + what + ') — nothing advanced.',
  pointers: { ...point, failed: what },
})
// Every boundary, hard-stop, and success status returns only after STATE
// persistence is confirmed; a failed write surfaces explicitly.
const stop = async (status, fields, extra) => {
  const w = await hands(atomicWriteCmd(stateDoc({ ...fields, pointers: [...routes] })), 'state:write')
  if (w !== 0) return persistFail('state-write')
  return done(status, extra)
}
const nextAct = (s) => (s ? 'Relaunch the kernel workflow with stage=' + s : 'Run complete')
const reopen = async (owner, beatName) => {
  beats.push(await voiceBeat('reopen', { slice: owner }, 'Slice ' + owner + ' reopened — a law check went red at ' + beatName + '.'))
  return stop('law-red', {
    stage, active_slice: owner, next_action: 'Reopen slice ' + owner + ': LAW is red at ' + beatName,
  })
}
const failStop = (status, fields, line, extra) => {
  beats.push(line)
  return stop(status, fields, extra)
}

const cardPrompt = (extra) => [
  'You are a Kiln stage agent. Read and follow the stage card at ' + P.card(stage) + ' exactly.',
  'Project dir: ' + projectDir + '. Artifacts live under .kiln/ (LAW at ' + P.law + ').',
  'Voice: fill your beat from ' + plugin + '/data/voice.json templates; prefill every semantic slot; leave kernel-owned slots (' + KERNEL_SLOTS.map(k => '{' + k + '}').join(' ') + ') unfilled.',
  extra,
  'Return {ok, beat, pointers} — pointers lists every artifact path you wrote.',
].filter(Boolean).join('\n')

// LAW rerun beat: at every kernel invocation start (resume), if the check exists.
const pre = await lawBeat(LAW_GUARD, 'law:preflight')
if (pre.exit !== 0) return reopen(pre.ids[0] ?? 'unknown', 'resume')

if (stage !== 'build') {
  const stageFacts = { STAGE: stage.toUpperCase(), i: SPINE.indexOf(stage) + 1, n: SPINE.length }
  const r = await act(cardPrompt(A.idea ? 'Operator idea (verbatim): ' + A.idea : ''), 'stage:' + stage)
  if (!r.ok) return failStop('transport-failure', { stage, next_action: 'Rerun stage ' + stage }, 'The ' + stage + ' stage did not return sound work — the run holds.')
  for (const p of r.pointers) routes.add(p)
  // LAW rerun beat: stage end (report is a stage, so this also guards completion).
  const post = await lawBeat(LAW_GUARD, 'law:stage-end')
  if (post.exit !== 0) return reopen(post.ids[0] ?? 'unknown', 'stage end')
  beats.push(fillClosed(r.beat, stageFacts))
  return stop(stage === 'report' ? 'done' : 'ok', { stage, next_action: nextAct(nextStage(stage)) })
}

// build: gate every slice per the locked review invariant.
const list = await idsFetch('cat ' + P.slices, 'slices:fetch', 'the slice ids in the file parsed as a JSON array of strings, [] if exit != 0')
if (list.exit !== 0 || list.ids.length === 0) {
  return failStop('transport-failure', { stage, next_action: 'Rerun stage law: no slice list at ' + P.slices }, 'No slice list on the ledger — the law stage must run again.')
}
const ladder = await idsFetch(
  "node -p 'JSON.stringify(require(" + JSON.stringify(plugin + '/data/voice.json') + ").killstreak.ladder)'",
  'ladder:fetch', 'the printed JSON array of streak names, [] if exit != 0',
)
let corrections = 0
for (const slice of list.ids) {
  const ordinal = list.ids.indexOf(slice) + 1
  const sealed = await hands('grep -q "^' + slice + ' " ' + P.seals + ' 2>/dev/null', 'seal:check')
  if (sealed === 0) continue
  const streak = ladder.ids[streakIndex(ordinal, corrections, ladder.ids.length || 40)] ?? ''
  const facts = {
    STAGE: stage.toUpperCase(), slice, i: ordinal, n: list.ids.length,
    s: ordinal, t: list.ids.length, streak, STREAK: streak.toUpperCase(),
    passes: 0, count: 0, ids: '',
  }
  const r = await act(cardPrompt('Build exactly slice ' + slice + '. Write ' + P.request + ' per the card before returning.'), 'slice:' + slice)
  if (!r.ok) return failStop('transport-failure', { stage, active_slice: slice, next_action: 'Rerun stage build' }, 'Slice ' + slice + ' did not return sound work — the run holds.')
  for (const p of r.pointers) routes.add(p)
  beats.push(fillClosed(r.beat, facts))
  // LAW rerun beat: before any dependent seal. The check must exist by build.
  const guard = await lawBeat(LAW_CHECK, 'law:pre-seal')
  if (guard.exit !== 0) return reopen(guard.ids[0] ?? slice, 'pre-seal')

  const wasDegraded = await hands('test -f ' + P.degraded, 'degraded:check') === 0
  let label = 'single-family'
  if (!wasDegraded) {
    const loop = await reviewLoop({
      gate: (mode) => hands(gateCmd(mode, { plugin, repo: projectDir, request: P.request, gate: P.gate, priorGate: P.gate, delta: P.delta }), 'gate:' + mode),
      repair: async (pass) => {
        const found = await idsFetch(
          "node -p 'JSON.stringify((require(\"./" + P.gate + "\").findings||[]).map(f=>String(f.id)))'",
          'findings:fetch', 'the printed JSON array of finding ids, [] if exit != 0',
        )
        facts.passes = pass
        facts.count = found.ids.length
        facts.ids = found.ids.join(', ')
        const rr = await act(cardPrompt('Repair pass ' + pass + ' for slice ' + slice + ': fix ONLY the findings in ' + P.gate + '; write the repair delta to ' + P.delta + '.'), 'repair:' + slice)
        if (!rr.ok) return false
        const d = await hands('test -s ' + P.delta, 'delta:check')
        if (d !== 0) return false
        for (const p of rr.pointers) routes.add(p)
        beats.push(fillClosed(rr.beat, facts))
        return true
      },
    })
    corrections += loop.repairs
    facts.passes = loop.repairs
    if (loop.result === 'blocked') {
      const found = await idsFetch(
        "node -p 'JSON.stringify((require(\"./" + P.gate + "\").findings||[]).map(f=>String(f.id)))'",
        'findings:fetch', 'the printed JSON array of finding ids, [] if exit != 0',
      )
      beats.push(await voiceBeat('blocked', { passes: loop.repairs, ids: found.ids.join(', '), count: found.ids.length }, 'The gate held after ' + loop.repairs + ' repair passes — the ruling is yours.'))
      return stop('blocked', { stage, active_slice: slice, next_action: 'Operator ruling: gate blocked for slice ' + slice }, { gate: P.gate, finding_ids: found.ids, passes: loop.repairs })
    }
    if (loop.result === 'transport-failure') return failStop('transport-failure', { stage, active_slice: slice, next_action: 'Rerun stage build after fixing the transport' }, 'The review transport failed for slice ' + slice + ' — no verdict was published.', { gate: P.gate })
    if (loop.result === 'repair-failed') return failStop('repair-failed', { stage, active_slice: slice, next_action: 'Rerun stage build: repair pass failed for slice ' + slice }, 'The repair pass did not land for slice ' + slice + ' — the run holds.', { gate: P.gate })
    if (loop.result === 'degraded') {
      const db = await voiceBeat('degradation', {}, 'Codex is not answering — answer continue to proceed single-family.')
      const m = await hands('touch ' + P.degraded, 'degraded:mark')
      if (m !== 0) return persistFail('degraded-mark')
      beats.push(db)
      return stop('degraded', { stage, active_slice: slice, next_action: 'Acknowledge single-family degradation, then relaunch stage build' })
    }
    label = 'dual'
  }
  const s = await hands('echo "' + slice + ' ' + label + '" >> ' + P.seals, 'seal:append')
  if (s !== 0) return persistFail('seal-append')
  beats.push(fillClosed('sealed — {label} · slice {slice}', { ...facts, label }))
  const w = await hands(atomicWriteCmd(stateDoc({ stage, active_slice: slice, next_action: nextAct('build'), pointers: [...routes] })), 'state:write')
  if (w !== 0) return persistFail('state-write')
}
// LAW rerun beat: stage end.
const post = await lawBeat(LAW_CHECK, 'law:stage-end')
if (post.exit !== 0) return reopen(post.ids[0] ?? 'unknown', 'stage end')
// W-03 residue: every slice already sealed → the loop pushed nothing; the
// sealed resume template carries the beat (the ledger holds, we move on).
if (beats.length === 0) {
  beats.push(await voiceBeat('resume', {}, 'The ledger holds every seal — nothing left on the anvil; moving on.'))
}
return stop('ok', { stage, active_slice: 'none', next_action: nextAct(nextStage(stage)) })
