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

// The claude gate speaks verdicts, not exit codes; this map lands them on the
// same closed exit table the codex transport uses, and anything unrecognized
// fails closed as a transport failure.
function verdictExit(v) {
  return { accept: 0, changes_required: 10, blocked: 11 }[v] ?? 20
}

// The locked-law digest shape scripts/kiln-review pins with its LAW_HASH — a
// lowercase SHA-256 hex string; the claude-gate mirror below applies the same
// format gate before the equality check.
const LAW_HASH = /^[0-9a-f]{64}$/
// S1 mirror: the claude gate verdict passes the SAME semantic validation the
// codex transport enforces in scripts/kiln-review (validateGate) before any
// publish — the field set is exactly the five schema keys, review_id is a
// nonempty string, law_hash is a lowercase 64-hex digest AND equals the locked
// law hash from the review request, the verdict enum is closed, blockers are
// nonempty strings, every finding is an object carrying exactly the six schema
// fields as nonempty strings with a path:line location and a unique id, and the
// verdict shape holds — accept demands empty findings and blockers,
// changes_required demands findings with no blockers, blocked demands blockers.
// The two request-scoped codex checks — review_id equals the issued id, and a
// recheck introduces no out-of-scope finding id — have no counterpart here: the
// claude reviewer mints or reuses the review_id itself, and the repair loop
// reads its finding set from the published gate, so neither an issued id nor an
// allowed-id set crosses into this function. Returns the named violation, or
// null when the verdict is sound; any violation is transport-failure exit
// semantics, never a seal.
function gateReviewInvalid(g, lawHash) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return 'not-an-object'
  const keys = Object.keys(g)
  const fields = ['review_id', 'law_hash', 'findings', 'blockers', 'verdict']
  if (keys.length !== fields.length || fields.some(k => keys.indexOf(k) < 0)) return 'fields-mismatch'
  if (typeof g.review_id !== 'string' || g.review_id.trim() === '') return 'review-id-empty'
  if (typeof g.law_hash !== 'string' || !LAW_HASH.test(g.law_hash) || g.law_hash !== lawHash) return 'law-hash-mismatch'
  if (!Array.isArray(g.findings)) return 'findings-shape'
  if (!Array.isArray(g.blockers) || g.blockers.some(b => typeof b !== 'string' || b.trim() === '')) return 'blockers-shape'
  if (['accept', 'changes_required', 'blocked'].indexOf(g.verdict) < 0) return 'verdict-unrecognized'
  const ids = new Set()
  const findingFields = ['id', 'criterion', 'location', 'failure_mode', 'evidence', 'minimal_fix']
  for (const f of g.findings) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return 'finding-not-an-object'
    const fk = Object.keys(f)
    if (fk.length !== findingFields.length || findingFields.some(k => fk.indexOf(k) < 0)) return 'finding-fields-mismatch'
    if (findingFields.some(k => typeof f[k] !== 'string' || f[k].trim() === '')) return 'finding-fields-empty'
    if (!/^.+:\d+(?::\d+)?$/.test(f.location)) return 'finding-location-shape'
    if (ids.has(f.id)) return 'finding-id-duplicate'
    ids.add(f.id)
  }
  if (g.verdict === 'accept' && (g.findings.length !== 0 || g.blockers.length !== 0)) return 'accept-with-findings'
  if (g.verdict === 'changes_required' && (g.findings.length === 0 || g.blockers.length !== 0)) return 'changes-required-shape'
  if (g.verdict === 'blocked' && g.blockers.length === 0) return 'blocked-without-blockers'
  return null
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
// Pre-gate receipt: the kernel side has the hands, so it executes the law
// checks itself and preserves the full output verbatim for the reviewer,
// who executes nothing. Output still reaches stdout for the ids fetch, and
// the check exit code survives the capture.
const LAW_CHECK_RECEIPT = 'bash .kiln/law/check.sh > .kiln/check-receipt.txt 2>&1; s=$?; cat .kiln/check-receipt.txt; exit $s'

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
// Wave 3: TIER_EFFORTS is the permitted effort FLOOR — Kiln runs only at high or
// xhigh, so the per-role membership check below rejects any role at a sub-HIGH tier
// and structurally forbids an effort-down route (the same fail-closed class as a
// missing role — a boot halt with the named fact, never a later throw).
const TIER_EFFORTS = ['high', 'xhigh']
const TIER_ROLES = ['driver', 'kernel-leg', 'stage-card', 'stage-law', 'builder-ui', 'builder-logic', 'reviewer-gate', 'fallback-reviewer', 'ratify-reviewer', 'brainstorm-facilitator', 'haiku-migration', 'dev-sol']
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
    const t = c.roles[target]
    if (t.family !== 'claude') return false
    // The HIGH floor binds route targets too: a route may name a role outside
    // TIER_ROLES, which the per-role effort check above never reaches — so an
    // additional sub-HIGH target is the same effort-down bypass and fails closed here.
    if (!TIER_EFFORTS.includes(t.effort)) return false
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

// Order-aware boundary predicate (INTAKE-26): a pre-seal / pre-recheck red set is
// TOLERABLE only when it is nonempty and every red owner resolves UNIQUELY to a
// strictly-later entry in the ordered slice list than the current slice — an
// unbuilt, still-planned, later slice (the W-04 expected pre-build state). The
// current slice id itself, an earlier owner, an owner that appears more than once
// in the plan (ambiguous), an unowned red (empty ids), an out-of-plan owner, or a
// mixed valid/invalid set all fail closed here. Sealed owners are ruled first by
// firstSealed → reopen in the runtime, before this predicate is ever consulted.
function redSetIsFuture(ids, sliceId, sliceIds) {
  if (!Array.isArray(ids) || ids.length === 0) return false
  const cur = sliceIds.indexOf(sliceId)
  if (cur < 0) return false
  for (const id of ids) {
    const at = sliceIds.indexOf(id)
    if (at < 0) return false
    if (at !== sliceIds.lastIndexOf(id)) return false
    if (at <= cur) return false
  }
  return true
}

// postureToDials — the pure Gauge dial function (Wave 3). Maps a closed posture
// {scope, novelty, reversibility} plus a visual-artifact presence flag to five
// scrutiny organs. Each dial is an INDEPENDENT monotone predicate (never a lookup
// matrix), so a later posture field adds one predicate, not a combinatorial table.
// It names NO effort tier — it toggles organs and permits xhigh only; effort stays
// in the tier file, never here. FAIL-UPWARD: a missing, non-object, extra-field, or
// out-of-enum posture returns the max-scrutiny profile with recovery_cap 1 (the safe
// autonomy bound) — the most scrutiny exactly when the posture is least trustworthy,
// regardless of the visual flag. Deterministic; never throws.
const POSTURE_SCOPE = ['small', 'large']
const POSTURE_NOVELTY = ['familiar', 'novel']
const POSTURE_REVERSIBILITY = ['reversible', 'risky', 'irreversible']
function postureToDials(posture, visualArtifactPresence) {
  const failUp = { width: 'wide', research: 'on', perceptual: 'on', recovery_cap: 1, xhigh_permit: true }
  // Reflective reads (Reflect.ownKeys) and property access (destructuring getters)
  // can throw on adversarial input — a throwing ownKeys trap, a throwing getter, a
  // revoked proxy (Array.isArray itself throws on one). The whole body is guarded
  // so "never throws" is unconditional: any throw fails UP to max scrutiny, the
  // least-trustworthy posture treated most severely. Reflect.ownKeys — not
  // Object.keys — also counts non-enumerable and Symbol own fields, so a malformed
  // posture cannot smuggle an extra field past the exact-field count.
  try {
    if (!posture || typeof posture !== 'object' || Array.isArray(posture)) return failUp
    const keys = Reflect.ownKeys(posture)
    const fields = ['scope', 'novelty', 'reversibility']
    if (keys.length !== fields.length || fields.some(k => keys.indexOf(k) < 0)) return failUp
    const { scope, novelty, reversibility } = posture
    if (POSTURE_SCOPE.indexOf(scope) < 0 || POSTURE_NOVELTY.indexOf(novelty) < 0 || POSTURE_REVERSIBILITY.indexOf(reversibility) < 0) return failUp
    return {
      width: (novelty === 'novel' || scope === 'large') ? 'wide' : 'floor',
      research: (novelty === 'novel' || reversibility === 'risky' || reversibility === 'irreversible') ? 'on' : 'off',
      perceptual: visualArtifactPresence === true ? 'on' : 'dormant',
      recovery_cap: reversibility === 'reversible' ? 2 : 1,
      xhigh_permit: novelty === 'novel' || reversibility === 'irreversible',
    }
  } catch { return failUp }
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
  request: '.kiln/review-request.json', ratifyRequest: '.kiln/ratify-request.json', delta: '.kiln/repair-delta.md',
  slices: '.kiln/slices.json', seals: '.kiln/seals.log', degraded: '.kiln/degraded',
  ack: '.kiln/degraded-ack', receipt: '.kiln/check-receipt.txt', report: '.kiln/report.md',
  candidate: '.kiln/.gate-review.reviewer.tmp',
  card: (s) => plugin + '/cards/' + s + '.md',
}
const EXIT = { type: 'object', additionalProperties: false, properties: { exit: { type: 'integer' } }, required: ['exit'] }
const IDS = { type: 'object', additionalProperties: false, properties: { exit: { type: 'integer' }, ids: { type: 'array', items: { type: 'string' } } }, required: ['exit', 'ids'] }
const STAGE_RESULT = {
  type: 'object', additionalProperties: false,
  properties: {
    facts: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'string' },                             // 'ok' iff the stage's success condition holds; any other string is an honest failure
        pointers: { type: 'array', items: { type: 'string' } }, // every artifact path the stage wrote
        schema_valid: { type: 'boolean' },                      // the stage's declared outputs are well-formed
        gate_verdict: { type: 'string' },                       // reserved for later waves — unpopulated now
        meter: { type: 'object' },                              // reserved for later waves — unpopulated now
      },
      required: ['status', 'pointers', 'schema_valid'],
    },
    narration_beat: { type: 'string' },                         // the one-line human beat this stage emits
  },
  required: ['facts', 'narration_beat'],
}
const TIERS = {
  type: 'object', additionalProperties: false,
  properties: {
    exit: { type: 'integer' }, doctrine: { type: 'boolean' },
    resolver: { type: 'object' }, surface_routing: { type: 'object' }, roles: { type: 'object' },
  },
  required: ['exit'],
}
// The claude gate reviewer WRITES its verdict object (per scripts/review-schema.json)
// to the fixed candidate file .kiln/.gate-review.reviewer.tmp as the final act of its
// turn, and returns only this light ack — the return carries no verdict authority.
// The kernel invalidates the candidate before the reviewer runs, reads the written
// bytes back raw, validates them, and promotes them content-free; a stale or missing
// candidate can never seal.
const ACK = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } }, required: ['ok'] }

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

// Stage-card and per-slice builder legs share the {facts:{status, pointers, schema_valid}, narration_beat} schema; the
// caller supplies the resolved tier opts. INTAKE-19 seat law: the LAW stage is a
// thinking seat — slice creation resolves through the stage-law tier; validate and
// report stay on stage-card; the per-slice builder runs on its surface-routed
// builder role (T-03).
const actWith = (prompt, label, opts) => agent(prompt, { label, ...opts, schema: STAGE_RESULT })
  .then(r => (r ?? { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '' }))
const act = (prompt, label) => actWith(prompt, label, tier(stage === 'law' ? 'stage-law' : 'stage-card'))

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
  'Return {facts:{status, pointers, schema_valid}, narration_beat} — facts.status is "ok" when the stage succeeded, facts.pointers lists every artifact path you wrote, facts.schema_valid is true when your declared outputs are well-formed, and narration_beat is your one-line beat.',
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
  if (r.facts.status !== 'ok') return failStop('transport-failure', { stage, next_action: 'Rerun stage ' + stage }, await voiceBeat('transport-failure', {}, 'The ' + stage + ' stage did not return sound work — the run holds.', 1))
  for (const p of r.facts.pointers) routes.add(p)
  // Wave 1 (the Second Key): the LAW stage is content-blind-gated before it can
  // lock. The card produced the candidate LAW; a fresh OPPOSITE-family mind now
  // ratifies it against the architecture-feasibility rubric (reviewLoop + the
  // kiln-review `ratify` verb), and only on accept does the kernel seal the LAW
  // (the opaque `seal-law` verb) and let build begin. A broken bridge, a block,
  // or non-convergence is a terminal HELD for the operator — the LAW never locks
  // single-family, because a plan no second family has ratified is not ratified.
  if (stage === 'law') {
    // A2: the LAW card beat asserts the law is SEALED and build starts (cards/law.md),
    // so it must NEVER reach the transcript on a HELD — that would read "sealed… build
    // starts" above the honest hold line, a self-contradicting record. BUFFER the latest
    // candidate beat (a repair regenerates the whole LAW, so its beat replaces the prior
    // one) and emit it ONLY after a successful ratify AND seal; every held/halt path
    // emits its own line alone.
    let candidateBeat = r.narration_beat
    const ratifyOpts = tier('ratify-reviewer')
    // Content-blind request write: the kernel cannot author files, so it ships the
    // ratify request as a heredoc of closed facts through a mechanical hand — the
    // same shape as the STATE.md write — and branches only on the exit code. The
    // review_id is kernel-issued (the ratify verb expects the caller to supply it,
    // unlike a slice review, which mints its own), the reviewer is the opposite-
    // family ratify-reviewer tier, the artifact is the repo-relative LAW, and the
    // rubric is the ABSOLUTE law-rubric path (kiln-review resolves the artifact
    // repo-relative but the rubric from CWD/absolute).
    const ratifyReq = JSON.stringify({
      review_id: 'law-ratify', reviewer_model: ratifyOpts.model, reviewer_effort: ratifyOpts.effort,
      artifact: P.law, rubric: plugin + '/data/law-rubric.json',
    })
    const writeReq = [
      'set -e', 'mkdir -p .kiln',
      "cat > .kiln/.ratify-request.tmp <<'KILN_RATIFY_EOF'", ratifyReq, 'KILN_RATIFY_EOF',
      'mv -f .kiln/.ratify-request.tmp ' + P.ratifyRequest,
    ].join('\n')
    if (await hands(writeReq, 'ratify:request') !== 0) return persistFail('ratify-request')
    const ratifyLoop = await reviewLoop({
      // The ratify verb has no recheck mode — a repair regenerates the whole LAW,
      // so every round re-grades the fresh artifact (kiln-review recomputes the
      // candidate digest from the current bytes). The direct-path call preserves
      // 126/127 → gate-unreachable exactly as the build gate does. A9: the <repo>
      // arg is the cwd-relative `.` — hands runs in projectDir, and ratify resolves the
      // .kiln/ request and the artifact against it — never a bare projectDir, which a
      // whitespace path would split into extra argv and fail this mandatory 3-arg gate.
      gate: () => hands(plugin + '/scripts/kiln-review ratify . ' + P.ratifyRequest + ' ' + P.gate, 'ratify:gate'),
      repair: async (pass) => {
        const rr = await act(cardPrompt('Ratify repair pass ' + pass + ': the LAW did not ratify. Read every finding in ' + P.gate + ' and regenerate ' + P.law + ' to resolve them all, keeping the acceptance criteria and the slice plan sound and complete.'), 'ratify:repair')
        if (rr.facts.status !== 'ok') return false
        for (const p of rr.facts.pointers) routes.add(p)
        candidateBeat = rr.narration_beat // buffer the repaired candidate; the repair card beat also claims SEALED, so it is never emitted mid-loop
        return true
      },
    })
    if (ratifyLoop.result === 'sealed') {
      // seal-law is the only sealer on the kernel side: it digests LAW.md and
      // writes law/lock.hash, so the LAW locks only after cross-family ratification.
      if (await hands('node ' + plugin + '/scripts/kiln-review seal-law .kiln', 'law:seal') !== 0) return persistFail('law-seal')
      // Only now, past ratify AND seal, does the SEALED-claiming card beat speak.
      beats.push(fillClosed(candidateBeat, stageFacts))
    } else if (ratifyLoop.result === 'degraded') {
      return failStop('held',
        { stage, active_slice: 'none', next_action: 'The LAW needs an opposite-family ratifier and codex is not answering — restore codex, then rerun stage law' },
        'The LAW would not ratify: codex is not answering, and I do not lock the law with a single family. It stays open until a second family can rule — restore codex and rerun the law stage.',
        { gate: P.gate })
    } else if (ratifyLoop.result === 'blocked') {
      return failStop('held',
        { stage, active_slice: 'none', next_action: 'Operator ruling: the ratify reviewer held the LAW after ' + ratifyLoop.repairs + ' repair passes — rule, then rerun stage law' },
        'The LAW did not ratify after ' + ratifyLoop.repairs + ' repair passes — the reviewer holds it and the law stays unlocked. The ruling is yours: revise the acceptance criteria, then rerun the law stage.',
        { gate: P.gate })
    } else if (ratifyLoop.result === 'repair-failed') {
      return failStop('held',
        { stage, active_slice: 'none', next_action: 'Rerun stage law — a LAW repair pass did not land' },
        'A LAW repair pass did not land — the run holds with the law unlocked. Rerun the law stage.',
        { gate: P.gate })
    } else if (ratifyLoop.result === 'gate-unreachable') {
      return failStop('gate-unreachable',
        { stage, active_slice: 'none', next_action: 'Rerun stage law after restoring the gate tool at ' + plugin + '/scripts/kiln-review' },
        await voiceBeat('gate-unreachable', {}, 'The gate tool at ' + plugin + '/scripts/kiln-review is unreachable — not found or not executable; codex was never reached, so no verdict was possible.'),
        { gate: P.gate })
    } else if (ratifyLoop.result === 'transport-failure') {
      return failStop('transport-failure',
        { stage, active_slice: 'none', next_action: 'Rerun stage law after fixing the transport' },
        await voiceBeat('transport-failure', {}, 'The ratify call went out and came back with no verdict — the LAW cannot lock until the transport is sound.'),
        { gate: P.gate })
    }
  }
  // LAW rerun beat: stage end (report is a stage, so this also guards completion).
  const post = await lawBeat(LAW_GUARD, 'law:stage-end')
  if (post.exit !== 0) {
    const owner = await firstSealed(post.ids)
    if (owner) return reopen(owner, 'stage end')
  }
  // The deterministic completion gate: a report card may claim status ok yet leave
  // .kiln/report.md empty or missing — content-blind, that is the report stage failing
  // to deliver sound work, the same failure class as a bad return, never a false done.
  // It fires before the SEALED-claiming report beat is pushed, so a false completion
  // never reads its own success line above the honest hold (the top-of-branch guard rule).
  if (stage === 'report' && await hands('test -s ' + P.report, 'report:check') !== 0) {
    return failStop('transport-failure',
      { stage, next_action: 'Rerun stage report: ' + P.report + ' is empty or missing' },
      await voiceBeat('transport-failure', {}, 'The report stage returned but ' + P.report + ' is empty or missing — the run holds.', 1),
      { report: P.report })
  }
  if (stage !== 'law') beats.push(fillClosed(r.narration_beat, stageFacts))
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
// The ordered slice-id list backs the order-aware boundary predicate (INTAKE-26).
const sliceIds = slices.map(x => x.id)
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
  // T-03: the kernel surface-routes the builder leg BEFORE agent() — ui to
  // builder-ui, logic and mixed to builder-logic — and the build and repair of this slice
  // both dispatch with the resolved role opts. Only the kernel holds this
  // pre-dispatch moment; the card never sees it.
  const builderOpts = routeBuilder(tiers, entry.surface)
  const streak = ladder.ids[streakIndex(ordinal, corrections, ladder.ids.length || 40)] ?? ''
  const facts = {
    STAGE: stage.toUpperCase(), slice, i: ordinal, n: slices.length,
    s: ordinal, t: slices.length, streak, STREAK: streak.toUpperCase(),
    passes: 0, count: 0, ids: '',
  }
  const r = await actWith(cardPrompt('Build exactly slice ' + slice + ' (surface ' + entry.surface + '). Write ' + P.request + ' per the card before returning.'), 'slice:' + slice, builderOpts)
  if (r.facts.status !== 'ok') return failStop('transport-failure', { stage, active_slice: slice, next_action: 'Rerun stage build' }, await voiceBeat('transport-failure', {}, 'Slice ' + slice + ' did not return sound work — the run holds.', 1))
  for (const p of r.facts.pointers) routes.add(p)
  beats.push(fillClosed(r.narration_beat, facts))
  // LAW rerun beat: before any dependent seal. The check must exist by build.
  // Boundary ruling (INTAKE-26, order-aware): a pre-seal red blocks the current
  // seal unless a sealed owner reopens OR every red owner is a strictly-later
  // planned slice (expected pre-build state) — green THROUGH the current slice,
  // later planned owners may remain red. The pre-seal run doubles as the gate
  // receipt: the full check output lands verbatim at the receipt path, so the
  // reviewer judges executed evidence and executes nothing.
  const guard = await lawBeat(LAW_CHECK_RECEIPT, 'law:pre-seal')
  if (guard.exit !== 0) {
    const owner = await firstSealed(guard.ids)
    if (owner) return reopen(owner, 'pre-seal')
    // Tolerate a red owned entirely by strictly-later planned slices; any other
    // red — current, earlier, unowned, out-of-plan, duplicate, or mixed — halts.
    if (!redSetIsFuture(guard.ids, slice, sliceIds)) {
      return failStop('law-red',
        { stage, active_slice: slice, next_action: 'Rerun stage build: slice ' + slice + ' LAW is red before seal' },
        'The law is red at the seal of slice ' + slice + ' — no seal without green through the current slice.')
    }
  }

  const wasDegraded = await hands('test -f ' + P.degraded, 'degraded:check') === 0
  // S3: a degradation the builder marks on disk takes the SAME acknowledgment
  // hard-stop the exit-21 path takes. The ack file records that the kernel
  // stopped and the operator relaunched; a marker discovered pre-gate without
  // it stops the run here — never a silent ok seal. After acknowledgment the
  // run continues single-family: a ui slice skips the gate (no cross-family
  // reviewer without codex), a logic or mixed slice still faces the opus
  // fallback gate below — the seal reads the marker either way.
  const degradedStop = async () => {
    const db = await voiceBeat('degradation', {}, 'Codex is not answering — answer continue to proceed single-family.')
    const m = await hands('touch ' + P.degraded + ' ' + P.ack, 'degraded:mark')
    if (m !== 0) return persistFail('degraded-mark')
    beats.push(db)
    return stop('degraded', { stage, active_slice: slice, next_action: 'Acknowledge single-family degradation, then relaunch stage build' })
  }
  if (wasDegraded && await hands('test -f ' + P.ack, 'degraded-ack:check') !== 0) {
    return degradedStop()
  }
  // The gate decision, on the closed degradation and surface facts:
  //   - normal run: every surface gates. Coder and reviewer never share a
  //     family. A logic or mixed slice is GPT-coded (the build card makes one
  //     bash codex exec call), so its gate is a fresh claude mind on stage-card
  //     ruling on the law, the diff, and the kernel-side check receipt —
  //     executing nothing; it writes its verdict to the candidate file and the
  //     kernel validates those bytes and promotes them content-free. The ui
  //     surface alone keeps the codex gate.
  //   - degraded and acknowledged: codex is gone, so a ui slice cannot be gated
  //     cross-family and keeps its honest skip; but a logic or mixed slice the
  //     builder coded on sonnet STILL faces a gate — a fresh OPUS mind, a
  //     different and stronger model than the sonnet builder, same family, fresh
  //     context. That is the best split without a second family: the v3
  //     codex-absent fallback restored (retired/v3/data/duo-pool.json:7,
  //     logic_fallback — sonnet builds, opus reviews cross-context). It runs the
  //     SAME full validation; the seal-label read below still reads the marker
  //     at seal time, so it speaks single-family either way. reviewerOpts names
  //     the fallback-reviewer opus tier when degraded, stage-card (inherit) on
  //     the normal path.
  const runGate = !wasDegraded || entry.surface !== 'ui'
  if (runGate) {
    const reviewerOpts = wasDegraded ? tier('fallback-reviewer') : tier('stage-card')
    const claudeGate = async (mode) => {
      // S1: the locked law hash arrives from the review request as a closed
      // machine fact through the standard fetch surface — the same source
      // scripts/kiln-review reads on the codex path. An unreadable request is
      // a transport failure there, so it is one here.
      const req = await idsFetch(
        "node -p 'JSON.stringify([String(require(\"./" + P.request + "\").law_hash)])'",
        'request:hash', 'a one-element array holding the request law_hash, [] if exit != 0',
      )
      if (req.exit !== 0 || req.ids.length !== 1) return 20
      // Producer-self-publish: invalidate any prior candidate BEFORE the reviewer
      // runs, so an {ok} ack with no fresh write can never promote a stale verdict.
      if (await hands('rm -f ' + P.candidate, 'gate:invalidate') !== 0) return 20
      // The reviewer WRITES its verdict object to the candidate file as the final
      // act of its turn and returns only a light {ok} ack — the return carries no
      // verdict authority; the kernel reads and validates the bytes it will publish.
      const reviewerAck = await agent([
        'You are the gate reviewer for this slice: a fresh mind judging the diff against the locked law.',
        'Project dir: ' + projectDir + '. Read the locked law at ' + P.law + ', the review request at ' + P.request + ' (its criteria are the slice criteria; its paths name the diff), and the changed files themselves.',
        'The law checks were already executed kernel-side; their full output is attached verbatim at ' + P.receipt + '. Execute nothing — no commands, no tests, no builds: judge the diff against the law with the receipt as the only execution evidence.',
        'Receipt rows owned by slices not yet built in this run are expected pre-build evidence — judge only this slice\'s criteria from the review request; never treat them as findings, and never filter or rewrite the receipt.',
        mode === 'recheck'
          ? 'Read and reuse the prior review_id from ' + P.gate + ' first. Recheck only the finding ids in ' + P.gate + ' against ' + P.delta + ' and the current files. Preserve each unresolved finding id; never add one. Accept only when every listed finding is repaired.'
          : 'Report only substantiated criterion violations at exact repo-relative path:line locations with stable finding ids. Verdict rules: accept only when findings and blockers are both empty; changes_required only for repairable findings with no blockers; blocked only when the review cannot complete, with blocker reasons. Mint a fresh review_id.',
        'Compose the verdict object per ' + plugin + '/scripts/review-schema.json (copy law_hash verbatim from the request), and as the FINAL act of your turn write it as JSON to ' + P.candidate + '. Then return { ok: true } — the ack carries no verdict; the kernel reads and validates the file you wrote.',
      ].join('\n'), { label: 'gate-claude:' + mode, ...reviewerOpts, schema: ACK })
      if (!reviewerAck || reviewerAck.ok !== true) return 20
      // Read the candidate back as raw UTF-8 and run the ONE sanctioned gate-file
      // parse (the mirror of the parse-and-hop args adapter). The kernel validates
      // exactly the bytes it will publish, never the returned ack.
      const raw = await idsFetch('cat ' + P.candidate, 'gate:read', 'a one-element array holding the exact candidate file contents printed on stdout, [] if exit != 0')
      if (raw.exit !== 0 || raw.ids.length !== 1) return 20
      let g
      try { g = JSON.parse(raw.ids[0]) } catch { return 20 }
      // S1: the semantic mirror rules BEFORE the kernel promotes — a failed
      // validation is transport-failure exit semantics, never a seal.
      if (gateReviewInvalid(g, req.ids[0]) !== null) return 20
      // Content-free promotion: the validated candidate becomes the gate file.
      const w = await hands('mv -f ' + P.candidate + ' ' + P.gate, 'gate:publish')
      return w === 0 ? verdictExit(g.verdict) : 20
    }
    // S2: a recheck judges executed evidence, so the receipt must be fresh —
    // before EVERY recheck round, either gate family, the kernel reruns the
    // full check into the receipt. No gate ever judges a stale pre-repair
    // receipt. A red rerun takes the same door as any pre-seal red: reopen a
    // sealed owner, else halt law-red — recorded here, ruled after the loop.
    let recheckRed = null
    const freshReceipt = (inner) => async (mode) => {
      if (mode === 'recheck') {
        const again = await lawBeat(LAW_CHECK_RECEIPT, 'law:pre-recheck')
        // Mirror the pre-seal gate exactly: firstSealed is consulted FIRST, so a
        // regression in an already-SEALED later slice reopens (never masked by
        // future-tolerance); only a future, non-sealed red proceeds to the recheck.
        // A sealed or non-future red stashes for the after-loop firstSealed →
        // reopen / law-red ruling.
        if (again.exit !== 0) {
          const owner = await firstSealed(again.ids)
          if (owner || !redSetIsFuture(again.ids, slice, sliceIds)) {
            recheckRed = again.ids
            return 20
          }
        }
      }
      return inner(mode)
    }
    const loop = await reviewLoop({
      gate: freshReceipt(!wasDegraded && entry.surface === 'ui'
        ? (mode) => hands(gateCmd(mode, { plugin, repo: projectDir, request: P.request, gate: P.gate, priorGate: P.gate, delta: P.delta }), 'gate:' + mode)
        : claudeGate),
      repair: async (pass) => {
        const found = await idsFetch(
          "node -p 'JSON.stringify((require(\"./" + P.gate + "\").findings||[]).map(f=>String(f.id)))'",
          'findings:fetch', 'the printed JSON array of finding ids, [] if exit != 0',
        )
        facts.passes = pass
        facts.count = found.ids.length
        facts.ids = found.ids.join(', ')
        const rr = await actWith(cardPrompt('Repair pass ' + pass + ' for slice ' + slice + ' (surface ' + entry.surface + '): fix ONLY the findings in ' + P.gate + '; write the repair delta to ' + P.delta + '.'), 'repair:' + slice, builderOpts)
        if (rr.facts.status !== 'ok') return false
        const d = await hands('test -s ' + P.delta, 'delta:check')
        if (d !== 0) return false
        for (const p of rr.facts.pointers) routes.add(p)
        beats.push(fillClosed(rr.narration_beat, facts))
        return true
      },
    })
    corrections += loop.repairs
    facts.passes = loop.repairs
    // S2 ruling: a red pre-recheck rerun is a law fact, not a transport fact —
    // it takes the pre-seal door before any transport branch reads the result.
    if (recheckRed) {
      const owner = await firstSealed(recheckRed)
      if (owner) return reopen(owner, 'pre-recheck')
      return failStop('law-red',
        { stage, active_slice: slice, next_action: 'Rerun stage build: slice ' + slice + ' LAW went red after a repair pass' },
        'The law went red after a repair pass on slice ' + slice + ' — no recheck over a red law.')
    }
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
    if (loop.result === 'degraded') return degradedStop()
  }
  // Seal-label law (S2): the label reads the marker AT SEAL TIME, any gate
  // path. A builder that lost codex mid-run marks .kiln/degraded and builds
  // the slice itself, so a seal that follows a same-family gate speaks
  // single-family; dual only when the marker is absent at the moment of the
  // seal.
  const label = await hands('test -f ' + P.degraded, 'degraded:check') === 0 ? 'single-family' : 'dual'
  // Branch verb (INTAKE-28): the seal append rides the trusted kiln-review CLI as
  // an opaque `append-seal` verb. A Sonnet kernel leg refuses a bare
  // `echo >> seals.log` — it reads seals.log as a dual-key attestation ledger and
  // declines to scribe an append it cannot verify. The seals.log semantics live
  // inside the CLI; the courier sees only the verb and neutral args. The kiln dir
  // is the cwd-relative `.kiln` (hands runs with cwd = projectDir): a bare projectDir
  // interpolation would split a whitespace path into extra args and fail every seal.
  const s = await hands('node ' + plugin + '/scripts/kiln-review append-seal .kiln ' + slice + ' ' + label, 'seal:append')
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
