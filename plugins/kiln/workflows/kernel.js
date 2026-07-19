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
  // 126/127 are the shell codes for not-executable / not-found: the gate tool
  // itself was unreachable — distinct from a transport failure (codex never
  // reached, 20) or codex-unavailable (21). 20 and anything unrecognized fail closed.
  return { 0: 'accept', 10: 'reject', 11: 'blocked', 21: 'codex_unavailable', 126: 'gate_unreachable', 127: 'gate_unreachable' }[exit]
    ?? 'transport_failure'
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
    if (o === 'gate_unreachable') return { result: 'gate-unreachable', repairs }
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
// {driver} is absent by the sealed twelve-slot map: it is DRIVER-filled at
// completion from kiln-meter stdout, never a kernel fact.
const KERNEL_SLOTS = ['STAGE', 'i', 'n', 's', 't', 'slice', 'label', 'passes', 'count', 'ids', 'streak', 'STREAK']
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
    'density: ' + (f.density === 'engineer' ? 'engineer' : 'broad'),
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

// Tier resolution — pure over the validated tier config (data, never content).
// The tier file is the ONE place models and efforts are named; the kernel carries
// tier KEYS and resolves them here. validateTiers is the fail-closed BOOT gate: it
// requires every consumer role key and all three surface routes, each targeting a
// claude-family role, so a gap halts at boot with the named fact and never as a
// later throw. resolveTier is family-aware
// — a Claude alias is platform-resolved and passes UNCHANGED (the resolver is never
// consulted for it), a GPT alias MUST map to a concrete id through the resolver
// (codex -m rejects a bare alias), and inherit omits the model so the leg takes the
// dispatching session model. routeBuilder maps a validated surface to its builder
// role. No compiled model or effort value lives in the kernel — every value flows
// from the file at run time.
const TIER_EFFORTS = ['low', 'medium', 'high', 'xhigh']
const TIER_ROLES = ['driver', 'kernel-leg', 'stage-card', 'builder-ui', 'builder-logic', 'reviewer-gate', 'brainstorm-facilitator', 'haiku-migration', 'dev-sol']
const TIER_ROUTES = ['ui', 'logic', 'mixed']
function validateTiers(c) {
  if (!c || typeof c !== 'object') return false
  if (c.doctrine !== true) return false
  if (!c.resolver || typeof c.resolver !== 'object') return false
  if (!c.surface_routing || typeof c.surface_routing !== 'object') return false
  if (!c.roles || typeof c.roles !== 'object') return false
  for (const k of Object.keys(c.resolver)) {
    if (typeof c.resolver[k] !== 'string' || c.resolver[k].length === 0) return false
  }
  // every consumer role must be present and well-formed; a GPT alias must resolve
  for (const key of TIER_ROLES) {
    const r = c.roles[key]
    if (!r || typeof r !== 'object') return false
    if (r.family !== 'claude' && r.family !== 'gpt') return false
    if (typeof r.alias !== 'string' || r.alias.length === 0) return false
    if (!TIER_EFFORTS.includes(r.effort)) return false
    if (r.family === 'gpt' && (r.alias === 'inherit' || !Object.prototype.hasOwnProperty.call(c.resolver, r.alias))) return false
  }
  // all three surface routes must be present, point at a defined role, and that
  // role must be claude-family: a routed builder leg dispatches through the
  // workflow agent spawner, which spawns subagents only on the Anthropic API.
  // A gpt-family target has no transport there (codex speaks only behind
  // scripts/kiln-review), so a gpt route halts here at boot with the named
  // fact — never mid-build as a model-not-found spawn error dressed up as a
  // transport failure.
  for (const route of TIER_ROUTES) {
    const target = c.surface_routing[route]
    if (typeof target !== 'string' || !Object.prototype.hasOwnProperty.call(c.roles, target)) return false
    if (c.roles[target].family !== 'claude') return false
  }
  return true
}
function resolveTier(c, key) {
  const r = c.roles[key]
  const opts = { effort: r.effort }
  if (r.alias === 'inherit') return opts
  opts.model = r.family === 'gpt' ? c.resolver[r.alias] : r.alias
  return opts
}
function routeBuilder(c, surface) {
  return resolveTier(c, c.surface_routing[surface])
}
// A slices.json entry is either a legacy bare id string (surface defaults to mixed)
// or the object form encoded as "obj|<id>|<surface>"; an object must carry a nonempty
// id and a surface in ui|logic|mixed, else it is invalid and the run halts before any
// builder dispatch. Only the legacy bare form defaults to mixed.
function parseSliceEntry(entry) {
  const s = String(entry ?? '')
  if (s.slice(0, 4) === 'obj|') {
    const rest = s.slice(4)
    const bar = rest.indexOf('|')
    const id = bar < 0 ? rest : rest.slice(0, bar)
    const surface = bar < 0 ? '' : rest.slice(bar + 1)
    return { id, surface, valid: id.length > 0 && TIER_ROUTES.indexOf(surface) >= 0 }
  }
  return { id: s, surface: 'mixed', valid: s.length > 0 }
}

// KERNEL_CORE_END
// KERNEL_RUNTIME_BEGIN — evaluated as an async function body by the workflow runtime

// W-01: accept args in both shapes; malformed input is a closed-fact error,
// never a silent bare path. This site and the plugin-root halt below fire
// BEFORE a trusted plugin root exists, so both speak kernel-owned honest
// lines by the S1 joint ruling — no voice read is possible pre-root.
const parsed = parseArgs(args)
if (!parsed.ok) {
  return { status: 'bad-args', beat: 'Malformed launch args reached the kernel — relaunch with stage, projectDir, and idea.', pointers: {} }
}
const A = parsed.value

const projectDir = A.projectDir
// The plugin root is a REQUIRED absolute path. Kernel legs run with cwd =
// projectDir, so a relative root silently misreads the gate tool, the stage
// cards, and voice.json from wherever the leg happens to stand. A missing or
// relative root is a conductor contract violation, not a path to guess at.
const plugin = A.plugin
if (!plugin || plugin[0] !== '/') {
  return { status: 'bad-args', beat: 'The conductor must pass the plugin root as an absolute path — the kernel resolves its gate tool, stage cards, and voice from it while running with cwd = the project dir.', pointers: {} }
}
// The detail toggle is a closed launch fact, never content: A.detail present raises
// the render density to engineer, absent leaves it broad — the default. It rides the
// stage-card prompt as a directive and lands in STATE.md as the density line.
const density = A.detail ? 'engineer' : 'broad'
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
const TIERS = {
  type: 'object', additionalProperties: false,
  properties: {
    exit: { type: 'integer' }, doctrine: { type: 'boolean' },
    resolver: { type: 'object' }, surface_routing: { type: 'object' }, roles: { type: 'object' },
  },
  required: ['exit'],
}

// Boot (T-02): read the tier file once via an agent leg — the same node -p read
// surface as the voice beats below, never direct fs (the kernel stays content-
// blind). The boot leg omits model and effort: no tier value can exist before the
// file is read. The projection carries machine facts only — doctrine reduced to a
// presence flag, each role to family/alias/effort — and the pure core validates
// the whole shape. A missing, unreadable, or malformed tier file fails the run
// closed with the named configuration fact, the same class as the exit-20 halt.
const tiersCmd =
  "node -p 'JSON.stringify(((t)=>({doctrine:t.doctrine!==undefined,resolver:t.resolver,surface_routing:t.surface_routing,roles:Object.fromEntries(Object.keys(t.roles).map((k)=>[k,{family:t.roles[k].family,alias:t.roles[k].alias,effort:t.roles[k].effort}]))}))(require(" +
  JSON.stringify(plugin + '/data/tiers.json') + ")))'"
const tiers = await agent(
  'Run exactly this in ' + projectDir + '. Report {exit, doctrine, resolver, surface_routing, roles}: exit = the exit code; the other four = the fields of the printed JSON object when exit is 0, omitted when exit is nonzero:\n' + tiersCmd,
  { label: 'tiers:boot', schema: TIERS },
).then(r => (r ?? { exit: 20 }))
if (tiers.exit !== 0 || !validateTiers(tiers)) {
  return { status: 'tiers-config-invalid', beat: 'The tier file at ' + plugin + '/data/tiers.json is missing or malformed — Kiln will not run on unknown model and effort tiers. Restore data/tiers.json to the sealed shape.', pointers: {} }
}
const tier = (key) => resolveTier(tiers, key)

// Mechanical hands: run one command, report the exit code. Nothing else. The
// kernel legs (hands/idsFetch) are model-backed, so they carry the kernel-leg
// tier (Q1: a model-backed role defaults HIGH); the values come from the file.
const hands = (cmd, label) => agent(
  'Run exactly this in ' + projectDir + ' and report only the exit code as {exit}:\n' + cmd,
  { label, ...tier('kernel-leg'), schema: EXIT },
).then(r => (r ? r.exit : 20))

// Closed-facts fetch: exit code plus a schema-forced string list.
const idsFetch = (cmd, label, when) => agent(
  'Run exactly this in ' + projectDir + '. Report {exit, ids}: exit = the exit code; ids = ' + when + ':\n' + cmd,
  { label, ...tier('kernel-leg'), schema: IDS },
).then(r => (r ?? { exit: 20, ids: [] }))

// LAW beats report the owning slice ids on red (check.sh prints them; they
// arrive schema-forced — closed facts, never prose).
const lawBeat = (cmd, label) => idsFetch(cmd, label, 'the owning slice ids the check printed on stdout when exit != 0, else []')

// W-03: every kernel return carries a real beat. Sealed voice templates are
// fetched as opaque strings (the kernel carries beats, never parses them) and
// kernel-owned slots fill as ever; the fallback line fires only when the
// voice file is unreachable. idx selects the sealed variant under a key —
// transport-failure carries a review-call entry (0) and a stage-worker
// entry (1); every other key reads entry 0.
const voiceBeat = (key, facts, fallback, idx = 0) => idsFetch(
  "node -p 'JSON.stringify(require(" + JSON.stringify(plugin + '/data/voice.json') + ').beats[' + JSON.stringify(key) + "])'",
  'voice:' + key, 'the printed JSON array of beat templates, [] if exit != 0',
).then(v => fillClosed(v.ids[idx] ?? fallback, facts))

// Stage-card and per-slice builder legs share the {ok, beat, pointers} schema; the
// caller supplies the resolved tier opts. Stage cards (law/validate/report) run on
// stage-card; the per-slice builder runs on its surface-routed builder role (T-03).
const actWith = (prompt, label, opts) => agent(prompt, { label, ...opts, schema: STAGE_RESULT })
  .then(r => (r ?? { ok: false, beat: '', pointers: [] }))
const act = (prompt, label) => actWith(prompt, label, tier('stage-card'))

const stage = resolveStage(A)
if (stage === 'needs-brainstorm') {
  const nb = projectDir
    ? await voiceBeat('stage.brainstorm', {}, 'The anvil is empty — brainstorm first.')
    : 'The anvil is empty — brainstorm first.'
  return { status: 'needs-brainstorm', beat: nb, pointers: { state: P.state } }
}
if (!stage) {
  // S1 ruling: this twin site runs after the plugin root is validated, so it
  // reads the sealed bad-args key; the kernel line survives as the fallback.
  return { status: 'bad-args', beat: await voiceBeat('bad-args', {}, 'Unknown stage in the launch args — the spine knows law, build, validate, report.'), pointers: { state: P.state } }
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
  const w = await hands(atomicWriteCmd(stateDoc({ ...fields, density, pointers: [...routes] })), 'state:write')
  if (w !== 0) return persistFail('state-write')
  return done(status, extra)
}
const nextAct = (s) => (s ? 'Relaunch the kernel workflow with stage=' + s : 'Run complete')
// W-04: rerun-reopen binds to SEALED checks (locked BEHAVIOR). A red owned by
// an unsealed slice is expected pre-build state — the criteria describe the
// finished artifact. Only a red whose owner is present in seals.log reopens.
const firstSealed = async (ids) => {
  for (const id of ids) {
    if (await hands('grep -q "^' + id + ' " ' + P.seals + ' 2>/dev/null', 'seal:check') === 0) return id
  }
  return null
}
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
  'Density: ' + density + ' — a slot-fill rule, never a structure: broad fills slots with the plain reader-meaningful version, engineer fills the same slots with file paths, ids, and counts.',
  extra,
  'Return {ok, beat, pointers} — pointers lists every artifact path you wrote.',
].filter(Boolean).join('\n')

// LAW rerun beat: at every kernel invocation start (resume), if the check
// exists. Red reopens only a sealed owner; otherwise the run proceeds.
const pre = await lawBeat(LAW_GUARD, 'law:preflight')
if (pre.exit !== 0) {
  const owner = await firstSealed(pre.ids)
  if (owner) return reopen(owner, 'resume')
}

if (stage !== 'build') {
  const stageFacts = { STAGE: stage.toUpperCase(), i: SPINE.indexOf(stage) + 1, n: SPINE.length }
  const r = await act(cardPrompt(A.idea ? 'Operator idea (verbatim): ' + A.idea : ''), 'stage:' + stage)
  // S1 ruling: reachable twin sites read their sealed keys; the kernel lines
  // below survive only as unreachable-voice fallbacks (W-03).
  if (!r.ok) return failStop('transport-failure', { stage, next_action: 'Rerun stage ' + stage }, await voiceBeat('transport-failure', {}, 'The ' + stage + ' stage did not return sound work — the run holds.', 1))
  for (const p of r.pointers) routes.add(p)
  // LAW rerun beat: stage end (report is a stage, so this also guards completion).
  const post = await lawBeat(LAW_GUARD, 'law:stage-end')
  if (post.exit !== 0) {
    const owner = await firstSealed(post.ids)
    if (owner) return reopen(owner, 'stage end')
  }
  beats.push(fillClosed(r.beat, stageFacts))
  return stop(stage === 'report' ? 'done' : 'ok', { stage, next_action: nextAct(nextStage(stage)) })
}

// build: gate every slice per the locked review invariant. Each slice carries a
// closed surface fact; the fetch emits a legacy bare id string untouched, and the
// object form as "obj|<id>|<surface>", so parseSliceEntry can tell the two apart
// and validate the object form (bare strings alone default to mixed).
const list = await idsFetch(
  "node -p 'JSON.stringify(require(\"./" + P.slices + "\").map(s=>typeof s===\"string\"?s:\"obj|\"+(s&&s.id||\"\")+\"|\"+(s&&s.surface||\"\")))'",
  'slices:fetch', 'the printed JSON array of slice descriptor strings (a bare id, or "obj|<id>|<surface>"), [] if exit != 0',
)
if (list.exit !== 0 || list.ids.length === 0) {
  return failStop('transport-failure', { stage, next_action: 'Rerun stage law: no slice list at ' + P.slices }, await voiceBeat('transport-failure', {}, 'No slice list on the ledger — the law stage must run again.', 1))
}
const slices = list.ids.map(parseSliceEntry)
// A malformed slice descriptor (object form missing an id or naming an unknown
// surface) halts BEFORE any builder dispatch — the law stage must author it right.
const badSlice = slices.find(x => !x.valid)
if (badSlice) {
  return failStop('slices-invalid',
    { stage, active_slice: badSlice.id || 'none', next_action: 'Rerun stage law: a slice descriptor in ' + P.slices + ' is malformed' },
    'A slice descriptor is malformed — every slice needs an id and a surface of ui, logic, or mixed. The law stage must run again.')
}
const ladder = await idsFetch(
  "node -p 'JSON.stringify(require(" + JSON.stringify(plugin + '/data/voice.json') + ").killstreak.ladder)'",
  'ladder:fetch', 'the printed JSON array of streak names, [] if exit != 0',
)
let corrections = 0
for (const entry of slices) {
  const slice = entry.id
  const ordinal = slices.indexOf(entry) + 1
  const sealed = await hands('grep -q "^' + slice + ' " ' + P.seals + ' 2>/dev/null', 'seal:check')
  if (sealed === 0) continue
  // T-03: the kernel surface-routes the builder leg BEFORE agent() — ui/mixed to
  // builder-ui, logic to builder-logic — and the build and repair of this slice
  // both dispatch with the resolved role opts. Only the kernel holds this
  // pre-dispatch moment; the card never sees it.
  const builderOpts = routeBuilder(tiers, entry.surface)
  const streak = ladder.ids[streakIndex(ordinal, corrections, ladder.ids.length || 40)] ?? ''
  const facts = {
    STAGE: stage.toUpperCase(), slice, i: ordinal, n: slices.length,
    s: ordinal, t: slices.length, streak, STREAK: streak.toUpperCase(),
    passes: 0, count: 0, ids: '',
  }
  const r = await actWith(cardPrompt('Build exactly slice ' + slice + '. Write ' + P.request + ' per the card before returning.'), 'slice:' + slice, builderOpts)
  if (!r.ok) return failStop('transport-failure', { stage, active_slice: slice, next_action: 'Rerun stage build' }, await voiceBeat('transport-failure', {}, 'Slice ' + slice + ' did not return sound work — the run holds.', 1))
  for (const p of r.pointers) routes.add(p)
  beats.push(fillClosed(r.beat, facts))
  // LAW rerun beat: before any dependent seal. The check must exist by build.
  // Boundary ruling (Sol, W-04): ANY pre-seal red blocks the current seal
  // unless a sealed owner is reopened — full LAW green at every slice boundary.
  const guard = await lawBeat(LAW_CHECK, 'law:pre-seal')
  if (guard.exit !== 0) {
    const owner = await firstSealed(guard.ids)
    if (owner) return reopen(owner, 'pre-seal')
    return failStop('law-red',
      { stage, active_slice: slice, next_action: 'Rerun stage build: slice ' + slice + ' LAW is red before seal' },
      'The law is red at the seal of slice ' + slice + ' — no seal without full green.')
  }

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
        const rr = await actWith(cardPrompt('Repair pass ' + pass + ' for slice ' + slice + ': fix ONLY the findings in ' + P.gate + '; write the repair delta to ' + P.delta + '.'), 'repair:' + slice, builderOpts)
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
    if (loop.result === 'gate-unreachable') return failStop('gate-unreachable', { stage, active_slice: slice, next_action: 'Rerun stage build after restoring the gate tool at ' + plugin + '/scripts/kiln-review' }, await voiceBeat('gate-unreachable', {}, 'The gate tool at ' + plugin + '/scripts/kiln-review is unreachable — not found or not executable; codex was never reached, so no verdict was possible.'), { gate: P.gate })
    if (loop.result === 'transport-failure') return failStop('transport-failure', { stage, active_slice: slice, next_action: 'Rerun stage build after fixing the transport' }, await voiceBeat('transport-failure', {}, 'The review transport failed for slice ' + slice + ' — no verdict was published.'), { gate: P.gate })
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
  beats.push(await voiceBeat('seal', { ...facts, label }, 'sealed — {label} · slice {slice}'))
  const w = await hands(atomicWriteCmd(stateDoc({ stage, active_slice: slice, next_action: nextAct('build'), density, pointers: [...routes] })), 'state:write')
  if (w !== 0) return persistFail('state-write')
}
// LAW rerun beat: stage end. Red reopens only a sealed owner.
const post = await lawBeat(LAW_CHECK, 'law:stage-end')
if (post.exit !== 0) {
  const owner = await firstSealed(post.ids)
  if (owner) return reopen(owner, 'stage end')
}
// W-03 residue: every slice already sealed → the loop pushed nothing; the
// sealed resume template carries the beat (the ledger holds, we move on).
if (beats.length === 0) {
  beats.push(await voiceBeat('resume', {}, 'The ledger holds every seal — nothing left on the anvil; moving on.'))
}
return stop('ok', { stage, active_slice: 'none', next_action: nextAct(nextStage(stage)) })
