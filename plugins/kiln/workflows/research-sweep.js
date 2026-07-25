export const meta = {
  name: 'kiln-research-sweep',
  description: 'Pre-law feasibility gate: reads the Gauge research dial, and when research is on runs a bounded producer over the six canonical areas, ratifies any feasibility candidate (cross-family, or single-family through the claude family when codex is unavailable), and promotes only an accepted read to .kiln/docs/feasibility.md — every non-accept outcome holds the law. Branches on closed machine facts only.',
}

// RESEARCH_CORE_BEGIN — pure core: no fs, no clock, no randomness (tests evaluate this region)

// Parse-and-hop: the Workflow tool may deliver args as a JSON-encoded STRING (platform
// behavior, v3 precedent). Envelope mechanics, not content — the one sanctioned parse call in
// this file. Malformed input never silently takes the bare path.
function parseArgs(a) {
  if (a === undefined || a === null) return { ok: true, value: {} }
  if (typeof a === 'object' && !Array.isArray(a)) return { ok: true, value: a }
  if (typeof a !== 'string') return { ok: false }
  try {
    const v = JSON.parse(a)
    return v && typeof v === 'object' && !Array.isArray(v) ? { ok: true, value: v } : { ok: false }
  } catch { return { ok: false } }
}

// The transport exit table the kiln-review ratify verb speaks — the same closed mapping the
// kernel gate uses. 126/127 name the gate tool itself as unreachable; 21 is codex-unavailable;
// 20 and anything unrecognized fail closed as a transport failure.
function gateOutcome(exit) {
  return { 0: 'accept', 10: 'reject', 11: 'blocked', 21: 'codex_unavailable', 126: 'gate_unreachable', 127: 'gate_unreachable' }[exit]
    ?? 'transport_failure'
}

// The tier resolver, family-aware — copied from the kernel (a Workflow body cannot be imported).
// A claude alias passes through unchanged, a gpt alias resolves to a concrete id, inherit omits
// the model so the leg takes the dispatching session model.
function resolveTier(c, key) {
  const r = c.roles[key]
  // W2-S7a (B-D1): the alias is retained beside the resolved value as the durable tiers fact the
  // identity ledger records (requested_alias), distinct from the concrete model.
  const opts = { effort: r.effort, alias: r.alias }
  if (r.alias === 'inherit') return opts
  opts.model = r.family === 'gpt' ? c.resolver[r.alias] : r.alias
  return opts
}

// A FOCUSED fail-closed boot check: research-sweep consumes exactly four roles (kernel-leg for
// the mechanical legs, stage-law for the producer, ratify-reviewer for the cross-family gate,
// and — S4 — fallback-reviewer for the codex-absent claude ratify seat the degraded path calls).
// It validates only those against the same rules the kernel's validateTiers applies — the HIGH
// floor, a resolvable concrete gpt alias — so an unknown or effort-down tier holds the law at
// boot rather than throwing mid-sweep. The kernel's full boot gate still rules the whole config
// when it launches the law stage; this is the narrow gate for the one workflow that runs first.
function researchTiersValid(c) {
  if (!c || typeof c !== 'object') return false
  if (c.doctrine !== true) return false
  if (!c.resolver || typeof c.resolver !== 'object') return false
  if (!c.roles || typeof c.roles !== 'object') return false
  for (const key of ['kernel-leg', 'stage-law', 'ratify-reviewer', 'fallback-reviewer']) {
    const r = c.roles[key]
    if (!r || typeof r !== 'object') return false
    if (r.family !== 'claude' && r.family !== 'gpt') return false
    if (typeof r.alias !== 'string' || r.alias.length === 0) return false
    if (r.effort !== 'high' && r.effort !== 'xhigh') return false
    if (r.family === 'gpt' && (r.alias === 'inherit' || !Object.prototype.hasOwnProperty.call(c.resolver, r.alias))) return false
  }
  return true
}

// The workflow-local ratify loop (the kernel's LAW reviewLoop is NOT extracted; this is its own
// smaller loop). gate(mode) → exit int; repair(pass) → true only when the repair regenerated a
// sound candidate; cohort() → the current blocking-finding id array from the last published gate,
// absent for a pure control-flow caller.
// W6-S3: the TRANSITION is the single-source recoveryDecision — advance promotes, scoped-move
// spends one regenerate-candidate edge then re-grades (through the ratify-recheck verb, which
// reuses the prior review_id and constrains the reviewer to the prior finding cohort), held holds
// the law. EVERY transition off a closed fact flows through recoveryDecision — the loop
// short-circuits nothing above it. A recheck cohort must STRICTLY shrink the pinned prior or it is
// no progress and holds — the edge is spent either way. The contract carries two closed facts the
// loop no longer rules on its own: cohortEstablished (a prior cohort is pinned — a measured
// recheck; its ABSENCE is the establishing reject a first grade or a no-oracle caller makes, a
// scoped-move up to the reversibility-keyed cap, an omitted/invalid cap failing up to 1) and
// oracleMissing (a wired oracle that read no cohort is a missing verdict, held before any subset
// eval). The actual cohorts pass through — never a fabricated sentinel. accept promotes; a held
// reject is 'rejected'; every machine fault names its own transport fact — all non-accept results
// hold the law. The return carries edgeUses as repairs, the caller-facing name.
async function ratifyLoop(deps, cap) {
  cap = Number.isInteger(cap) && cap >= 1 ? cap : 1
  const heldAs = { blocked: 'blocked', codex_unavailable: 'codex-unavailable', gate_unreachable: 'gate-unreachable', transport_failure: 'transport-failure' }
  let edgeUses = 0
  let prior = null
  let exit = await deps.gate('review')
  for (;;) {
    const o = gateOutcome(exit)
    // The cohort oracle reads the current blocking set on a reject; a pure control-flow caller wires none.
    const curr = (o === 'reject' && deps.cohort) ? await deps.cohort() : null
    // recoveryDecision owns the transition off every closed fact below — the unreadable cohort and
    // the establishing reject are facts it weighs (oracleMissing / cohortEstablished), not branches
    // the loop takes above it, and the real prior/current cohorts pass through unfabricated.
    const decision = recoveryDecision({
      gateOutcome: o, edgeUses, cap, schemaValid: true, transport: o !== 'transport_failure',
      oracleMissing: o === 'reject' && !!deps.cohort && curr === null,
      cohortEstablished: prior !== null,
      priorBlockingIds: prior, currBlockingIds: curr,
    })
    if (decision.action === 'advance') return { result: 'accepted', repairs: edgeUses }
    if (decision.action === 'held') return { result: decision.reason === 'oracle-missing' ? 'transport-failure' : (heldAs[o] || 'rejected'), repairs: edgeUses }
    edgeUses += 1
    const confirmed = await deps.repair(edgeUses)
    if (confirmed !== true) return { result: 'repair-failed', repairs: edgeUses }
    prior = curr
    exit = await deps.gate('recheck')
  }
}

// W6-B / W6-01: the recovery-decision core, DRIFT-PINNED verbatim from workflows/kernel.js
// (a Workflow body cannot import). Both functions are byte-identical to the kernel copies;
// tests/research-sweep.test.mjs asserts the two copies agree (source-text + behavior), the
// same drift guard the POSTURE_* enums carry, so this deliberate duplication cannot drift.
function strictSubsetProgress(prior, curr) {
  if (!Array.isArray(prior) || !Array.isArray(curr)) return false
  const priorSet = new Set(prior)
  const currSet = new Set(curr)
  for (const id of currSet) {
    if (!priorSet.has(id)) return false
  }
  return currSet.size < priorSet.size
}

function recoveryDecision(facts) {
  const f = facts || {}
  if (f.transport === false) return { action: 'held', reason: 'transport-failure' }
  if (f.schemaValid === false) return { action: 'held', reason: 'schema-invalid' }
  if (f.gateOutcome === 'accept') return { action: 'advance', reason: 'accept' }
  if (f.gateOutcome === 'reject') {
    if (f.oracleMissing) return { action: 'held', reason: 'oracle-missing' }
    if (f.cohortEstablished && !strictSubsetProgress(f.priorBlockingIds, f.currBlockingIds)) return { action: 'held', reason: 'no-strict-progress' }
    if (f.edgeUses >= f.cap) return { action: 'held', reason: 'cap-exhausted' }
    return { action: 'scoped-move', reason: f.cohortEstablished ? 'strict-subset-progress' : 'establishing' }
  }
  return { action: 'held', reason: 'blocked' }
}

// W6-F: the recovery cap normalization, DRIFT-PINNED verbatim from workflows/kernel.js — cap 2
// only on exit 0 AND recovery_cap exactly 2, else fail-up to 1. research-sweep reads its cap the
// same way from its own dial leg; tests/research-sweep.test.mjs asserts this copy agrees with the
// kernel one (source text + behavior), so the duplication cannot drift.
function capFromDial(leg) {
  const d = leg || {}
  return d.exit === 0 && d.recovery_cap === 2 ? 2 : 1
}

// S4 (INTAKE-38): the verdict-exit map, the locked-law digest shape, and the gate-verdict
// shape validator, DRIFT-PINNED verbatim from workflows/kernel.js (a Workflow body cannot
// import). The claude feasibility ratify leg validates the verdict it publishes with the
// SAME rules the codex ratify verb enforces — only the transport differs, never the trust
// property. tests/research-sweep.test.mjs asserts these copies agree with the kernel copies
// (source text), the same drift guard the recovery-decision copies carry.
function verdictExit(v) {
  return { accept: 0, changes_required: 10, blocked: 11 }[v] ?? 20
}
const LAW_HASH = /^[0-9a-f]{64}$/
function gateReviewInvalid(g, lawHash, expectedReviewId, allowedFindingIds, locationRule) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return 'not-an-object'
  const keys = Object.keys(g)
  const fields = ['review_id', 'law_hash', 'findings', 'blockers', 'verdict']
  if (keys.length !== fields.length || fields.some(k => keys.indexOf(k) < 0)) return 'fields-mismatch'
  if (typeof g.review_id !== 'string' || g.review_id.trim() === '') return 'review-id-empty'
  if (expectedReviewId !== undefined && g.review_id !== expectedReviewId) return 'review-id-mismatch'
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
    if (!(locationRule || /^.+:\d+(?::\d+)?$/).test(f.location)) return 'finding-location-shape'
    if (ids.has(f.id)) return 'finding-id-duplicate'
    if (allowedFindingIds && !allowedFindingIds.has(f.id)) return 'finding-id-out-of-cohort'
    ids.add(f.id)
  }
  if (g.verdict === 'accept' && (g.findings.length !== 0 || g.blockers.length !== 0)) return 'accept-with-findings'
  if (g.verdict === 'changes_required' && (g.findings.length === 0 || g.blockers.length !== 0)) return 'changes-required-shape'
  if (g.verdict === 'blocked' && g.blockers.length === 0) return 'blocked-without-blockers'
  return null
}

// The PROBE_REQUEST message contract. During a brainstorm Da Vinci has no spawn tool and may
// send the conductor at most ONE nonterminal envelope: a probe request carrying ONLY the ledger
// path and the ledger sequence IDs to digest — never dialogue. validLedgerRef is the shared
// invariant (an ABSOLUTE path free of control characters — C0 U+0000–U+001F, DEL U+007F, and the
// C1 block U+0080–U+009F — plus a non-empty list of positive integer seq IDs) the workflow's own
// probe launch args are held to. The absolute + control-char rule is
// load-bearing: the ledger path is interpolated verbatim into the probe producer prompt, so a
// relative path, prose, or a newline-bearing value could smuggle instructions into that leg — all
// rejected here, before a probe is ever launched. validateProbeRequest adds the exact-keys check on
// the raw envelope, so a free-text field or any extra key is rejected too.
function validLedgerRef(ledger, seqs) {
  if (typeof ledger !== 'string' || ledger[0] !== '/') return false
  if (/[\u0000-\u001f\u007f-\u009f]/.test(ledger)) return false
  if (!Array.isArray(seqs) || seqs.length === 0) return false
  return seqs.every(s => Number.isInteger(s) && s > 0)
}
function validateProbeRequest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false
  if (Object.keys(m).sort().join(',') !== 'e,ledger,seqs') return false
  if (m.e !== 'PROBE_REQUEST') return false
  return validLedgerRef(m.ledger, m.seqs)
}

// RESEARCH_CORE_END
// RESEARCH_RUNTIME_BEGIN — evaluated as an async function body by the workflow runtime

// The launch envelope, in both shapes; malformed input is a closed-fact error, never a silent
// bare path. Both pre-boot halts speak workflow-owned honest lines — no voice read is possible
// before a trusted plugin root exists.
const parsed = parseArgs(args)
if (!parsed.ok) {
  return { status: 'bad-args', beat: 'Malformed launch args reached the research sweep — relaunch with projectDir and the plugin root.', pointers: {} }
}
const A = parsed.value
const projectDir = A.projectDir
// The plugin root is a REQUIRED absolute path — the sweep resolves its dial projector, its
// producer card, the rubric, and the gate tool from it while its legs run with cwd = projectDir.
const plugin = A.plugin
if (!plugin || plugin[0] !== '/') {
  return { status: 'bad-args', beat: 'The conductor must pass the plugin root as an absolute path — the research sweep resolves its dial projector, card, and gate tool from it while running with cwd = the project dir.', pointers: {} }
}

// Shell-safe single-quote wrapping for the one untrusted-shape value interpolated into leg
// commands — the absolute plugin root. A legal path may hold whitespace; a hostile one may hold
// shell metacharacters. Wrapping closes both: the command runs verbatim or not at all.
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'"

const F = {
  posture: '.kiln/posture.json',
  candidate: '.kiln/docs/feasibility-candidate.md',
  feasibility: '.kiln/docs/feasibility.md',
  request: '.kiln/feasibility-ratify-request.json',
  gate: '.kiln/feasibility-gate.json',
  // S4: the run-level degradation marker + its acknowledgment (shared with the kernel), and
  // the claude ratify leg's own candidate-verdict temp (distinct from the feasibility doc).
  degraded: '.kiln/degraded',
  ack: '.kiln/degraded-ack',
  gateTmp: '.kiln/.feasibility-gate.reviewer.tmp',
}
const EXIT = { type: 'object', additionalProperties: false, properties: { exit: { type: 'integer' } }, required: ['exit'] }
// Closed-facts fetch shape: an exit code plus a schema-forced string list (the kernel idsFetch shape).
const IDS = { type: 'object', additionalProperties: false, properties: { exit: { type: 'integer' }, ids: { type: 'array', items: { type: 'string' } } }, required: ['exit', 'ids'] }
// The dial leg reports the research field of the printed dials object — a boot-style projection
// leg (the tiers-boot shape): the leg parses the JSON gauge-dial prints, the workflow body never
// does. additionalProperties stays true so the other dials pass through harmlessly. W6-F: the
// same read also carries recovery_cap, so one dial read serves both the research gate and the
// reversibility-keyed cap the ratify loop honors.
const DIAL = { type: 'object', additionalProperties: true, properties: { exit: { type: 'integer' }, research: { type: 'string' }, recovery_cap: { type: 'integer' } }, required: ['exit'] }
const TIERS = {
  type: 'object', additionalProperties: false,
  properties: {
    exit: { type: 'integer' }, doctrine: { type: 'boolean' },
    resolver: { type: 'object' }, surface_routing: { type: 'object' }, roles: { type: 'object' },
  },
  required: ['exit'],
}
const STAGE_RESULT = {
  type: 'object', additionalProperties: false,
  properties: {
    facts: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'string' },
        pointers: { type: 'array', items: { type: 'string' } },
        schema_valid: { type: 'boolean' },
        gate_verdict: { type: 'string' },
        meter: { type: 'object' },
      },
      required: ['status', 'pointers', 'schema_valid'],
    },
    narration_beat: { type: 'string' },
  },
  required: ['facts', 'narration_beat'],
}
// S4: the claude ratify leg writes its verdict to the candidate temp and returns only this
// light ack — the return carries no verdict authority; the workflow reads and validates the
// bytes it will publish (the kernel claudeGate contract).
const ACK = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } }, required: ['ok'] }

// Every non-accept outcome takes this shape: the law does not plan over unratified research, so
// the conductor maps a held return to an existing hard stop and speaks the honest beat.
const held = (beat, extra) => ({ status: 'held', beat, pointers: { ...extra } })

// W2-S1 (H2 / B01): the run lock JOIN. The conductor acquires the run lock ONCE before this
// pre-law sweep and passes run_id plus an opaque owner token; the sweep joins with the exact
// token BEFORE the tiers read or any .kiln mutation, so a second run can never race over the
// shared .kiln files. Probe mode carries NO lock — it runs during the brainstorm, before the
// conductor acquires — so it never joins. A launch that should hold a lock but carries none,
// or a foreign lock, is an honest hard hold (the law does not plan while another run holds the
// project) naming the run that holds it; a stale lock is taken over at the conductor, never
// stolen by a leg. These returns predate the tiers boot, so they speak workflow-owned lines.
if (A.mode !== 'probe') {
  if (typeof A.run_id !== 'string' || A.run_id.trim() === '' || typeof A.owner !== 'string' || A.owner.trim() === '') {
    return held('This sweep carries no run lock. Kiln takes the lock before the sweep and hands it to every stage; without one I will not touch the shared project files. Relaunch through the conductor so the run holds its lock.', {})
  }
  const joinCmd = 'node ' + shq(plugin + '/scripts/kiln-review') + ' run-lock join .kiln ' + [A.run_id, A.owner].map(shq).join(' ')
  const joined = await agent(
    'Run exactly this in ' + projectDir + '. Report {exit, ids}: exit = the exit code; ids = the run_id the lock names as its owner when the join is refused (exit is nonzero), else []:\n' + joinCmd,
    { label: 'run-lock:join', schema: IDS },
  ).then(r => (r ?? { exit: 20, ids: [] }))
  if (joined.exit !== 0) {
    const ownerTag = joined.ids && joined.ids[0] ? ' (run ' + joined.ids[0] + ')' : ''
    return held('Another Kiln run holds the lock on this project' + ownerTag + '. The law does not plan while another run holds the forge. If that run has ended, relaunch through the conductor and Kiln will take the stale lock over.', { lock: '.kiln/run.lock' })
  }
}

// Boot: read the tier file once via an agent leg (the same node -p projection the kernel boots
// on — never direct fs). The boot leg omits model and effort: no tier value exists before the
// file is read. A missing, unreadable, or malformed tier file holds the law closed.
const tiersScript =
  'JSON.stringify(((t)=>({doctrine:t.doctrine!==undefined,resolver:t.resolver,surface_routing:t.surface_routing,roles:Object.fromEntries(Object.keys(t.roles).map((k)=>[k,{family:t.roles[k].family,alias:t.roles[k].alias,effort:t.roles[k].effort}]))}))(require(' +
  JSON.stringify(plugin + '/data/tiers.json') + ')))'
const tiersCmd = 'node -p ' + shq(tiersScript)
const tiers = await agent(
  'Run exactly this in ' + projectDir + '. Report {exit, doctrine, resolver, surface_routing, roles}: exit = the exit code; the other four = the fields of the printed JSON object when exit is 0, omitted when exit is nonzero:\n' + tiersCmd,
  { label: 'tiers:boot', schema: TIERS },
).then(r => (r ?? { exit: 20 }))
if (tiers.exit !== 0 || !researchTiersValid(tiers)) {
  return held('The tier file at ' + plugin + '/data/tiers.json is missing or malformed — the research sweep will not run on unknown model and effort tiers, and I do not lay the law over unratified research. Restore data/tiers.json to the sealed shape, then rerun.', { tiers: plugin + '/data/tiers.json' })
}
const tier = (key) => resolveTier(tiers, key)

// Mechanical hands: run one command, report the exit code. Model-backed, so it carries the
// kernel-leg tier; the values come from the file.
const hands = (cmd, label) => agent(
  'Run exactly this in ' + projectDir + ' and report only the exit code as {exit}:\n' + cmd,
  { label, ...tier('kernel-leg'), schema: EXIT },
).then(r => (r ? r.exit : 20))

// Closed-facts fetch: exit code plus a schema-forced string list (mirrors the kernel idsFetch).
const idsFetch = (cmd, label, when) => agent(
  'Run exactly this in ' + projectDir + '. Report {exit, ids}: exit = the exit code; ids = ' + when + ':\n' + cmd,
  { label, ...tier('kernel-leg'), schema: IDS },
).then(r => (r ?? { exit: 20, ids: [] }))

// W2-S7a (B-RESEARCH-SWEEP): the degraded feasibility ratifier is attestation-bearing (it publishes
// a feasibility verdict to reviews.jsonl), so it joins the identity protocol exactly like the kernel
// legs — mint through the trusted identity-begin verb, dispatch under the reserved leg label, thread
// the leg onto the publish. Mirrors the kernel mintLeg idiom; a failed mint holds fail-closed.
const mintLeg = (role, alias, subject) => idsFetch(
  'node ' + shq(plugin + '/scripts/kiln-review') + ' identity-begin .kiln ' + shq(role) + ' ' + shq(alias) + ' ' + shq(subject),
  'identity:' + role,
  'a two-element array whose first element is the minted leg id and whose second is its expected label, both printed on one space-separated stdout line, [] if exit != 0',
).then(r => (r && r.exit === 0 && Array.isArray(r.ids) && r.ids.length === 2 && /^[0-9a-f]{32}$/.test(r.ids[0]) && r.ids[1] === 'leg:' + r.ids[0]) ? { legId: r.ids[0], label: r.ids[1] } : null)

// ── Probe mode: an off-window digest for a brainstorm, never a ratified feasibility ──
// A closed MODE of this same recipe. During a brainstorm no posture exists yet, so probe mode
// BYPASSES the dial read and the whole ratify loop: it reads only the ledger turns the conductor
// forwarded (the path + seq IDs from Da Vinci's one PROBE_REQUEST), has the fresh research seat
// write a COMPACT digest under .kiln/docs/, and returns a single pointer for the conductor's
// PROBE_RESULT. A probe informs discussion only; it holds no law, because there is no law yet — a
// bad request or a missing digest returns an honest closed status the conductor voices and moves on.
if (A.mode === 'probe') {
  if (!validLedgerRef(A.ledger, A.seqs)) {
    return { status: 'bad-probe', beat: 'The probe request reached the sweep without a ledger path and its sequence IDs — a probe carries only those, never dialogue. Nothing was digested.', pointers: {} }
  }
  // W2-S1 (B04): the probe is exempt from the run lock (it precedes acquire), so its digest must
  // never share a guarded path — two concurrent brainstorms at the same maximum seq would collide.
  // A per-invocation UUID makes the name unique. A Workflow body cannot mint (no Date/random in the
  // sandbox), so the id rides a mechanical hands leg. A malformed or missing id holds the probe.
  const idLeg = await idsFetch(
    "node -p 'require(\"crypto\").randomUUID()'",
    'probe:id', 'a one-element array holding the printed UUID, [] if exit != 0')
  if (idLeg.exit !== 0 || idLeg.ids.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(idLeg.ids[0])) {
    return { status: 'probe-failed', beat: 'The probe desk could not mint a unique digest name — nothing was written this pass.', pointers: {} }
  }
  // The seq names the run, the UUID makes it collision-free — no shell metacharacter in either.
  const digest = '.kiln/docs/probe-' + Math.max(...A.seqs) + '-' + idLeg.ids[0] + '.md'
  const probePrompt = [
    'You are a Kiln probe desk: a fresh-context reader with no view of the live brainstorm window.',
    'Read the append-only ledger at ' + A.ledger + ' and consider ONLY the entries whose seq is one of: ' + A.seqs.join(', ') + '.',
    'Working root: ' + projectDir + '. Distill those turns into a COMPACT digest — the concrete points, tensions, and open questions they raise — to inform the ongoing discussion. Invent nothing beyond what those entries say; add no dialogue of your own.',
    'Write the digest via temp + rename to ' + digest + ' and return facts.status "ok". If you cannot read the referenced entries, write nothing and return an honest failure status. Never ask the operator.',
    'That digest is your SOLE permitted write — never create or modify the ledger, the vision, the essence, the posture, or any other artifact under this root; a probe reads to inform, it authors nothing but its own digest.',
    'Return {facts:{status, pointers, schema_valid}, narration_beat} — narration_beat one plain line that a fresh digest is on disk.',
  ].join('\n')
  // Prep the desk. Freshness needs no invalidation now: the UUID name is unique to this pass, so a
  // producer that writes nothing leaves the fresh path empty and fails the content-blind test -s
  // below — the stale-ride is impossible by construction (the property the old rm -f only approximated).
  if (await hands('mkdir -p .kiln/docs', 'probe:prep') !== 0) {
    return { status: 'probe-failed', beat: 'The .kiln/docs desk would not open for the probe digest — nothing was written this pass.', pointers: {} }
  }
  const dg = await agent(probePrompt, { label: 'probe:producer', ...tier('stage-law'), schema: STAGE_RESULT })
    .then(r => (r ?? { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '' }))
  if (dg.facts.status !== 'ok' || await hands('test -s ' + digest, 'probe:check') !== 0) {
    return { status: 'probe-failed', beat: 'The probe desk left no digest on disk — the sketch gets no fresh reading this pass.', pointers: {} }
  }
  return { status: 'probed', beat: dg.narration_beat || 'A fresh desk read the referenced turns and left a compact digest for the sketch.', pointers: { digest } }
}

// The producer leg: the fresh research desk over the six canonical areas.
const producerPrompt = (extra) => [
  'You are the Kiln research-sweep producer. Read and follow the card at ' + plugin + '/cards/research-sweep.md exactly.',
  'Project dir: ' + projectDir + '. Artifacts live under .kiln/. Read the brief at ' + '.kiln/docs/project-brief.md, and the brownfield map at .kiln/docs/codebase-map.md when present.',
  'Classify the brief\'s unresolved assumptions against EXACTLY the six canonical areas. If none qualify, write nothing and return facts.status "no-qualifying-question". If some qualify, write the feasibility CANDIDATE to ' + F.candidate + ' (not the canonical ' + F.feasibility + ') and return facts.status "ok". Never ask the operator.',
  extra,
  'Return {facts:{status, pointers, schema_valid}, narration_beat}.',
].filter(Boolean).join('\n')

// Freshness: invalidate every prior feasibility artifact at the top of the run, before the dial
// is even read. A stale candidate must never satisfy the content-blind test -s and ride to
// ratify; a stale canonical feasibility.md must never survive a stand-down, a no-qualifying, or a
// hold and be read by the LAW as current advice. Only THIS run's freshly ratified read may sit at
// the canonical path when the sweep returns — every other path leaves .kiln/docs clean.
if (await hands('rm -f ' + F.candidate + ' ' + F.feasibility, 'invalidate') !== 0) {
  return held('The prior feasibility artifacts under .kiln/docs would not clear — the law holds rather than risk planning over a stale read. Rerun.', { candidate: F.candidate, feasibility: F.feasibility })
}

// (a) Read the Gauge research dial. gauge-dial always exits 0 with a valid dials object, so
// 'off' is the ONLY stand-down trigger — an unreadable dial or any other value fails UP to on
// (more scrutiny when the reading is least trustworthy).
const dial = await agent(
  'Run exactly this in ' + projectDir + '. Report {exit, research, recovery_cap}: exit = the exit code; research = the value of the "research" field and recovery_cap = the value of the "recovery_cap" field in the printed JSON dials object when exit is 0, both omitted when exit is nonzero:\n' + 'node ' + shq(plugin + '/scripts/gauge-dial.mjs'),
  { label: 'dial:read', ...tier('kernel-leg'), schema: DIAL },
).then(r => (r ?? { exit: 20 }))
const research = (dial.exit === 0 && dial.research === 'off') ? 'off' : 'on'
// W6-F: one dial read carries both the research gate and the reversibility-keyed cap (fail-up to
// 1) the ratify loop below honors — read here, before the stand-down, so the single read serves both.
const cap = capFromDial(dial)
if (research === 'off') {
  return { status: 'stood-down', beat: 'The Gauge reads low — familiar, reversible ground, no feasibility question worth a desk. The forge goes straight to the law.', pointers: { posture: F.posture } }
}

// (b) The producer classifies unresolved assumptions against the six areas.
const producer = await agent(producerPrompt(''), { label: 'producer', ...tier('stage-law'), schema: STAGE_RESULT })
  .then(r => (r ?? { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '' }))
if (producer.facts.status === 'no-qualifying-question') {
  return { status: 'no-qualifying-question', beat: producer.narration_beat || 'The desk looked and found no assumption the build leans on — nothing to investigate. Straight to the law.', pointers: { posture: F.posture } }
}
if (producer.facts.status !== 'ok') {
  return held('The research desk returned no sound work — I hold the law rather than plan over an unread feasibility question. Rerun.', { posture: F.posture })
}
// A candidate the producer claims must exist before it can be ratified — content-blind test -s.
if (await hands('test -s ' + F.candidate, 'candidate:check') !== 0) {
  return held('The research desk reported a feasibility candidate but ' + F.candidate + ' is empty or missing — the law holds. Rerun.', { candidate: F.candidate })
}

// (c) The workflow-local gate → one repair → re-ratify loop. Content-blind request write: the
// workflow ships the ratify request as a heredoc of closed facts through a mechanical hand (the
// same shape the kernel writes its LAW ratify request), then branches only on exit codes. The
// review_id is workflow-issued; the reviewer is the opposite-family ratify-reviewer tier; the
// artifact is the repo-relative candidate, proven contained by the verb before it is opened.
// W2-S8: the request names no rubric — the feasibility family word on the verb argv selects the
// shipped instrument, so the request file cannot point the grader at a rubric of its own.
// S4 (INTAKE-38): the feasibility ratify TRANSPORT degrades to the claude family when codex
// is down. A tri-state path-selector read chooses the seat — absent the cross-family codex
// ratifier, present a fresh OPUS claude ratifier that mirrors the codex digest, echo and
// lineage rules and records single-family honestly. W2-S10d: the marker records a DETECTION, written
// by whichever detector met the absence; the ack records the OPERATOR WORD. A detection nobody has
// answered selects no seat — it returns this sweep's own degraded status below, the one that asks
// for the word, and the acked relaunch selects honestly. The minting verbs cover the launch
// boundary; a joined relaunch after a mid-run detection reaches here without passing them.
// W2-S10d (B3): ONE degraded return — the guard here and the detection arm below both call it.
const degradedStatus = () => ({ status: 'degraded', beat: 'Codex is not answering. I complete single-family only after you answer continue — a fresh opus mind in the claude family will ratify the feasibility read, and every seal will say so. Say `continue` and I proceed.', pointers: { posture: F.posture } })
const degraded = await hands('test -f ' + F.degraded, 'feasibility:degraded') === 0
if (degraded && await hands('test -f ' + F.ack, 'feasibility:degraded-ack') !== 0) return degradedStatus()
const reviewerOpts = degraded ? tier('fallback-reviewer') : tier('ratify-reviewer')
// The claude feasibility ratify leg (the kernel claudeRatify mirror): the workflow computes
// the candidate digest BEFORE the reviewer turn, the opus reviewer echoes it as law_hash, the
// workflow rejects a mismatched echo, and — because a claude agent CAN write files — it
// RECOMPUTES the candidate digest AFTER the turn and confirms it unchanged; a tampered read is
// a transport failure, never a publish. The verdict shape is validated with the SAME
// gateReviewInvalid the codex path enforces, drift-pinned above.
const claudeFeasRatify = async (mode) => {
  const d0 = await idsFetch('sha256sum ' + F.candidate + ' | cut -d" " -f1', 'feasibility:digest', 'a one-element array holding the 64-hex candidate digest printed on stdout, [] if exit != 0')
  if (d0.exit !== 0 || d0.ids.length !== 1 || !LAW_HASH.test(d0.ids[0])) return 20
  const candidateDigest = d0.ids[0]
  let expectedReviewId, allowedFindingIds
  if (mode === 'recheck') {
    const prior = await idsFetch(
      "node -p 'JSON.stringify((g=>[String(g.review_id)].concat((g.findings||[]).map(f=>String(f.id))))(require(\"./" + F.gate + "\")))'",
      'feasibility:recheck-cohort', 'a JSON array whose first element is the prior gate review_id and whose remaining elements are the prior finding ids, [] if exit != 0')
    if (prior.exit !== 0 || prior.ids.length < 1) return 20
    expectedReviewId = prior.ids[0]
    allowedFindingIds = new Set(prior.ids.slice(1))
  }
  if (await hands('rm -f ' + F.gateTmp, 'feasibility:invalidate') !== 0) return 20
  // W2-S7a (B-RESEARCH-SWEEP): mint the ratifier leg and dispatch under its reserved label; the leg
  // rides the publish-gate argv below so the feasibility row on reviews.jsonl carries its reviewer id.
  const ratifyLeg = await mintLeg('ratifier', reviewerOpts.alias, 'feasibility')
  if (!ratifyLeg) return 20
  // W2-S7a (FORK 1): the feasibility claude leg is a FORK-1 transport like the four kernel claude legs
  // — it composes the SAME artifact-ratify contract (purpose feasibility) the codex ratify verb plants,
  // so a degraded resume threads the digest into publish-gate instead of hitting the contracts bypass
  // guard (store present + digest omitted → HOLD) that would otherwise wedge the pre-law gate forever
  // once codex has run once. contract-prepare runs after the digest derivation, before dispatch; the
  // digest is the LAST publish-gate word. A recheck rides the prior gate for its finding cohort.
  const fc = await idsFetch(
    'node ' + shq(plugin + '/scripts/kiln-review') + ' contract-prepare ' + shq('.') + ' .kiln artifact-ratify ' + (mode === 'recheck' ? 'recheck' : 'initial') + ' feasibility ' + shq(F.candidate) + (mode === 'recheck' ? ' ' + shq(F.gate) : ''),
    'feasibility:contract', 'a one-element array holding the canonical contract sha256 printed on stdout, [] if exit != 0')
  if (fc.exit !== 0 || fc.ids.length !== 1 || !LAW_HASH.test(fc.ids[0])) return 20
  const feasContract = fc.ids[0]
  const ack = await agent([
    'You are the feasibility ratify reviewer: a fresh mind judging the feasibility candidate against the feasibility rubric.',
    'The canonical contract at .kiln/contracts/sha256/' + feasContract + '.json is the COMPLETE authoritative facts for this ratification — the candidate text, its digest, and the rubric criteria. Judge exactly that contract.',
    'Project dir: ' + projectDir + '. Read the feasibility candidate at ' + F.candidate + ' and the feasibility rubric at ' + plugin + '/data/feasibility-rubric.json.',
    'Judge the candidate against every rubric dimension. Execute nothing — no commands, no tests, no builds: the candidate is a read, judged as text. Change no file: judge the candidate, never edit it.',
    mode === 'recheck'
      ? 'Read and reuse the prior review_id from ' + F.gate + ' first. Recheck only the finding ids in ' + F.gate + ' against the regenerated candidate. Preserve each unresolved finding id; never add one. Accept only when every listed finding is repaired.'
      : 'Report only substantiated rubric violations at exact path:line locations with stable finding ids. Verdict rules: accept only when findings and blockers are both empty; changes_required only for repairable findings with no blockers; blocked only when the review cannot complete, with blocker reasons. Mint a fresh review_id.',
    'Set law_hash to exactly ' + candidateDigest + ' — the sha256 of the candidate you judged; copy it verbatim so it binds this verdict to those bytes.',
    'Compose the verdict object per ' + plugin + '/scripts/review-schema.json, and as the FINAL act of your turn write it as JSON to ' + F.gateTmp + '. Then return { ok: true } — the ack carries no verdict; the workflow reads and validates the file you wrote.',
  ].join('\n'), { label: ratifyLeg.label, ...reviewerOpts, schema: ACK })
  if (!ack || ack.ok !== true) return 20
  const raw = await idsFetch('cat ' + F.gateTmp, 'feasibility:read', 'a one-element array holding the exact candidate verdict file contents printed on stdout, [] if exit != 0')
  if (raw.exit !== 0 || raw.ids.length !== 1) return 20
  let g
  try { g = JSON.parse(raw.ids[0]) } catch { return 20 }
  if (gateReviewInvalid(g, candidateDigest, expectedReviewId, allowedFindingIds) !== null) return 20
  // S4-D1: the write-capable turn tamper check — the candidate bytes the reviewer judged
  // must still be on disk. A changed digest means the ratifier rewrote the read it graded.
  const d1 = await idsFetch('sha256sum ' + F.candidate + ' | cut -d" " -f1', 'feasibility:digest-confirm', 'a one-element array holding the 64-hex candidate digest printed on stdout, [] if exit != 0')
  if (d1.exit !== 0 || d1.ids.length !== 1 || d1.ids[0] !== candidateDigest) return 20
  // W2-S5: archive-then-publish through the trusted verb before the content-free overwrite — the
  // validated feasibility verdict lands in the immutable ledger first (its own review family, though
  // it reuses the ratify verb). A failed archive fails closed and the feasibility ratify holds.
  const w = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' publish-gate .kiln feasibility ' + F.gateTmp + ' ' + F.gate + ' ' + shq(ratifyLeg.legId) + ' ' + shq(feasContract), 'feasibility:publish')
  return w === 0 ? verdictExit(g.verdict) : 20
}
const ratifyReq = JSON.stringify({
  review_id: 'feasibility-ratify', reviewer_model: reviewerOpts.model, reviewer_alias: reviewerOpts.alias, reviewer_effort: reviewerOpts.effort,
  artifact: F.candidate,
})
const writeReq = [
  'set -e', 'mkdir -p .kiln',
  "cat > .kiln/.feasibility-ratify-request.tmp <<'KILN_FEAS_EOF'", ratifyReq, 'KILN_FEAS_EOF',
  'mv -f .kiln/.feasibility-ratify-request.tmp ' + F.request,
].join('\n')
// The codex path alone carries a request file; the claude leg reads the rubric itself.
if (!degraded && await hands(writeReq, 'ratify:request') !== 0) {
  return held('The ledger would not take the feasibility ratify request — the law holds until the write lands. Rerun.', { request: F.request })
}
const loop = await ratifyLoop({
  // The review grades the fresh candidate; a recheck re-grades the regenerated candidate through
  // the W6 ratify-recheck verb, which reuses the prior review_id and constrains the reviewer to the
  // prior finding cohort — the SAME lineage the build recheck carries. prior and output are both
  // F.gate: ratify-recheck reads the prior into memory before runGate writes the output. The <repo>
  // arg is the cwd-relative `.` (hands runs with cwd = projectDir) — never a bare projectDir, which
  // a whitespace path would split into extra argv and fail the gate.
  gate: degraded
    ? (mode) => claudeFeasRatify(mode)
    : (mode) => hands(
        mode === 'recheck'
          ? shq(plugin + '/scripts/kiln-review') + ' ratify-recheck . .kiln ' + F.request + ' ' + F.gate + ' ' + F.gate + ' feasibility'
          : shq(plugin + '/scripts/kiln-review') + ' ratify . .kiln ' + F.request + ' ' + F.gate + ' feasibility',
        'ratify:gate'),
  // The pinned prior cohort for the strict-subset transition: the finding ids the last published
  // gate carries. A recheck must strictly shrink it or recoveryDecision holds the law.
  cohort: async () => {
    const c = await idsFetch(
      "node -p 'JSON.stringify((require(\"./" + F.gate + "\").findings||[]).map(f=>String(f.id)))'",
      'ratify:cohort', 'the printed JSON array of the prior ratify finding ids, [] if exit != 0',
    )
    return c.exit === 0 ? c.ids : null
  },
  repair: async (pass) => {
    // Freshness before the repair, mirroring the top-of-run invalidation: clear the rejected
    // first-round candidate BEFORE the repair runs. A repair that reports ok without rewriting
    // then leaves nothing on disk, so candidate:recheck fails and the loop halts — the stale
    // rejected bytes can never survive to be re-ratified or promoted.
    if (await hands('rm -f ' + F.candidate, 'invalidate:repair') !== 0) return false
    const rr = await agent(
      producerPrompt('Repair pass ' + pass + ': the feasibility candidate did not ratify. Read every finding in ' + F.gate + ' and regenerate ' + F.candidate + ' to resolve them all.'),
      { label: 'producer:repair', ...tier('stage-law'), schema: STAGE_RESULT },
    ).then(r => (r ?? { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '' }))
    if (rr.facts.status !== 'ok') return false
    if (await hands('test -s ' + F.candidate, 'candidate:recheck') !== 0) return false
    return true
  },
}, cap)

// (d) ONLY on accept, promote — atomically rename the ratified candidate file itself to the
// canonical path, the same mechanical mv -f idiom the ratify request write already uses. The bytes
// promoted ARE the bytes ratified: the SAME candidate file ratify accepted is renamed to the
// canonical path with NO intervening write. Kiln runs one pipeline over its own .kiln/ with no
// concurrent writer, and the freshness step already cleared any stale candidate before this run
// produced its own, so an atomic rename of the ratified file has no time-of-check/time-of-use
// window to defend. This is the honesty-floor binding; the digest-copy dance was over-engineering
// and is removed.
if (loop.result === 'accepted') {
  if (await hands('mv -f ' + F.candidate + ' ' + F.feasibility, 'promote') !== 0) {
    return held('The accepted feasibility read would not promote to ' + F.feasibility + ' — the rename failed and the law holds rather than leave the ratified read unpublished. Rerun.', { candidate: F.candidate })
  }
  // The success beat is availability-aware: dual names a second family, single-family names
  // the fresh opus mind in the claude family — never a second family that did not sign.
  const beat = degraded
    ? 'The research desk ratified single-family — codex is not answering, so a fresh opus mind in the claude family signed the feasibility read, honestly marked. It rests at ' + F.feasibility + ', advisory to the law, never its authority. The forge moves on.'
    : 'The research desk ratified — a second family signed the feasibility read. It rests at ' + F.feasibility + ', advisory to the law, never its authority. The forge moves on.'
  return { status: 'accepted', beat, pointers: { feasibility: F.feasibility } }
}
// (e) S4-D2: a FIRST codex-down detection is the acknowledgment stop, not a hold — persist
// the degraded marker ALONE and return the distinct degraded status. Detection never writes
// the ack: that file is the operator word, and only the conductor writes it, on continue.
// The acked re-run enters with both files and ratifies single-family through the claude seat
// above. Reachable only on the codex path — the claude leg spawns no codex that could fail.
if (loop.result === 'codex-unavailable') {
  if (await hands('touch ' + F.degraded, 'feasibility:degraded-mark') !== 0) {
    return held('The ledger would not take the degradation markers — the law holds until the write lands. Rerun.', { posture: F.posture })
  }
  return degradedStatus()
}
// Every other non-accept outcome holds the law — rejected or stale research never becomes advice.
const heldBeat = {
  rejected: 'The feasibility read would not ratify after a repair — I do not lay the law over research a reviewer rejected. Revise the assumptions or stand research down, then rerun.',
  blocked: 'The feasibility reviewer holds the research — the law waits on your ruling. Rule, then rerun.',
  'gate-unreachable': 'The gate tool at ' + plugin + '/scripts/kiln-review is unreachable — not found or not executable; codex was never reached, so no feasibility verdict was possible. Restore it, then rerun.',
  'transport-failure': 'The feasibility ratify call went out and came back with no verdict — the law cannot plan over research the transport never confirmed. Fix the transport, then rerun.',
  'repair-failed': 'A feasibility repair pass did not land — the law holds with the research unratified. Rerun.',
}[loop.result] || 'The feasibility read did not ratify — the law holds. Rerun.'
return held(heldBeat, { gate: F.gate })
