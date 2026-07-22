export const meta = {
  name: 'kiln-research-sweep',
  description: 'Pre-law feasibility gate: reads the Gauge research dial, and when research is on runs a bounded producer over the six canonical areas, cross-family ratifies any feasibility candidate, and promotes only an accepted read to .kiln/docs/feasibility.md — every non-accept outcome holds the law. Branches on closed machine facts only.',
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
  const opts = { effort: r.effort }
  if (r.alias === 'inherit') return opts
  opts.model = r.family === 'gpt' ? c.resolver[r.alias] : r.alias
  return opts
}

// A FOCUSED fail-closed boot check: research-sweep consumes exactly three roles (kernel-leg for
// the mechanical legs, stage-law for the producer, ratify-reviewer for the cross-family gate).
// It validates only those against the same rules the kernel's validateTiers applies — the HIGH
// floor, a resolvable concrete gpt alias — so an unknown or effort-down tier holds the law at
// boot rather than throwing mid-sweep. The kernel's full boot gate still rules the whole config
// when it launches the law stage; this is the narrow gate for the one workflow that runs first.
function researchTiersValid(c) {
  if (!c || typeof c !== 'object') return false
  if (c.doctrine !== true) return false
  if (!c.resolver || typeof c.resolver !== 'object') return false
  if (!c.roles || typeof c.roles !== 'object') return false
  for (const key of ['kernel-leg', 'stage-law', 'ratify-reviewer']) {
    const r = c.roles[key]
    if (!r || typeof r !== 'object') return false
    if (r.family !== 'claude' && r.family !== 'gpt') return false
    if (typeof r.alias !== 'string' || r.alias.length === 0) return false
    if (r.effort !== 'high' && r.effort !== 'xhigh') return false
    if (r.family === 'gpt' && (r.alias === 'inherit' || !Object.prototype.hasOwnProperty.call(c.resolver, r.alias))) return false
  }
  return true
}

// The workflow-local ratify loop — bounded at ONE repair (the kernel's LAW reviewLoop is NOT
// extracted; this is its own smaller loop, and the ratify verb has no recheck mode, so every
// round re-grades the freshly regenerated candidate). gate() → exit int; repair(pass) → true
// only when the repair regenerated a sound candidate. accept promotes; a reject past the cap is
// 'rejected'; every other outcome names the transport fact — all non-accept results hold the law.
async function ratifyLoop(deps, maxRepairs = 1) {
  let repairs = 0
  let exit = await deps.gate()
  for (;;) {
    const o = gateOutcome(exit)
    if (o === 'accept') return { result: 'accepted', repairs }
    if (o === 'blocked') return { result: 'blocked', repairs }
    if (o === 'codex_unavailable') return { result: 'codex-unavailable', repairs }
    if (o === 'gate_unreachable') return { result: 'gate-unreachable', repairs }
    if (o === 'transport_failure') return { result: 'transport-failure', repairs }
    if (repairs >= maxRepairs) return { result: 'rejected', repairs }
    repairs += 1
    const confirmed = await deps.repair(repairs)
    if (confirmed !== true) return { result: 'repair-failed', repairs }
    exit = await deps.gate()
  }
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
}
const EXIT = { type: 'object', additionalProperties: false, properties: { exit: { type: 'integer' } }, required: ['exit'] }
// The dial leg reports the research field of the printed dials object — a boot-style projection
// leg (the tiers-boot shape): the leg parses the JSON gauge-dial prints, the workflow body never
// does. additionalProperties stays true so the other dials pass through harmlessly.
const DIAL = { type: 'object', additionalProperties: true, properties: { exit: { type: 'integer' }, research: { type: 'string' } }, required: ['exit'] }
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

// Every non-accept outcome takes this shape: the law does not plan over unratified research, so
// the conductor maps a held return to an existing hard stop and speaks the honest beat.
const held = (beat, extra) => ({ status: 'held', beat, pointers: { ...extra } })

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
  'Run exactly this in ' + projectDir + '. Report {exit, research}: exit = the exit code; research = the value of the "research" field in the printed JSON dials object when exit is 0, omitted when exit is nonzero:\n' + 'node ' + shq(plugin + '/scripts/gauge-dial.mjs'),
  { label: 'dial:read', ...tier('kernel-leg'), schema: DIAL },
).then(r => (r ?? { exit: 20 }))
const research = (dial.exit === 0 && dial.research === 'off') ? 'off' : 'on'
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
// artifact is the repo-relative candidate; the rubric is the ABSOLUTE feasibility-rubric path.
const reviewerOpts = tier('ratify-reviewer')
const ratifyReq = JSON.stringify({
  review_id: 'feasibility-ratify', reviewer_model: reviewerOpts.model, reviewer_effort: reviewerOpts.effort,
  artifact: F.candidate, rubric: plugin + '/data/feasibility-rubric.json',
})
const writeReq = [
  'set -e', 'mkdir -p .kiln',
  "cat > .kiln/.feasibility-ratify-request.tmp <<'KILN_FEAS_EOF'", ratifyReq, 'KILN_FEAS_EOF',
  'mv -f .kiln/.feasibility-ratify-request.tmp ' + F.request,
].join('\n')
if (await hands(writeReq, 'ratify:request') !== 0) {
  return held('The ledger would not take the feasibility ratify request — the law holds until the write lands. Rerun.', { request: F.request })
}
const loop = await ratifyLoop({
  // The <repo> arg is the cwd-relative `.` (hands runs with cwd = projectDir) — never a bare
  // projectDir, which a whitespace path would split into extra argv and fail this 3-arg gate.
  gate: () => hands(shq(plugin + '/scripts/kiln-review') + ' ratify . ' + F.request + ' ' + F.gate, 'ratify:gate'),
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
})

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
  return { status: 'accepted', beat: 'The research desk ratified — a second family signed the feasibility read. It rests at ' + F.feasibility + ', advisory to the law, never its authority. The forge moves on.', pointers: { feasibility: F.feasibility } }
}
// (e) Every non-accept outcome holds the law — rejected or stale research never becomes advice.
const heldBeat = {
  rejected: 'The feasibility read would not ratify after a repair — I do not lay the law over research a second family rejected. Revise the assumptions or stand research down, then rerun.',
  blocked: 'The feasibility reviewer holds the research — the law waits on your ruling. Rule, then rerun.',
  'codex-unavailable': 'The feasibility read needs an opposite-family ratifier and codex is not answering — I do not ratify research single-family. Restore codex, then rerun.',
  'gate-unreachable': 'The gate tool at ' + plugin + '/scripts/kiln-review is unreachable — not found or not executable; codex was never reached, so no feasibility verdict was possible. Restore it, then rerun.',
  'transport-failure': 'The feasibility ratify call went out and came back with no verdict — the law cannot plan over research the transport never confirmed. Fix the transport, then rerun.',
  'repair-failed': 'A feasibility repair pass did not land — the law holds with the research unratified. Rerun.',
}[loop.result] || 'The feasibility read did not ratify — the law holds. Rerun.'
return held(heldBeat, { gate: F.gate })
