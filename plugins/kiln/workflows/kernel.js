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
// W6-03: the two request-scoped codex checks — review_id equals the issued id, and a
// recheck introduces no out-of-cohort finding id — are OPTIONAL here, keyed by
// expectedReviewId and allowedFindingIds. Absent (a fresh review that mints or reuses
// its own review_id and reads its finding set from the published gate), both are
// skipped, so the pre-cohort behavior is unchanged. Present (the kernel snapshots a
// published prior gate before a recheck and passes the cohort), the review_id must
// equal the issued id and every finding must fall inside the prior allowed-id set —
// the SAME allowed-id rule the transport enforces (scripts/kiln-review validateShape),
// so kernel and transport agree. Returns the named violation, or null when the verdict
// is sound; any violation is transport-failure exit semantics, never a seal.
function gateReviewInvalid(g, lawHash, expectedReviewId, allowedFindingIds) {
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
    if (!/^.+:\d+(?::\d+)?$/.test(f.location)) return 'finding-location-shape'
    if (ids.has(f.id)) return 'finding-id-duplicate'
    if (allowedFindingIds && !allowedFindingIds.has(f.id)) return 'finding-id-out-of-cohort'
    ids.add(f.id)
  }
  if (g.verdict === 'accept' && (g.findings.length !== 0 || g.blockers.length !== 0)) return 'accept-with-findings'
  if (g.verdict === 'changes_required' && (g.findings.length === 0 || g.blockers.length !== 0)) return 'changes-required-shape'
  if (g.verdict === 'blocked' && g.blockers.length === 0) return 'blocked-without-blockers'
  return null
}

// The repair/recheck loop over injected closures. gate(mode, pass) → exit int; repair(pass) → true
// only when the repair result AND its delta are confirmed; cohort() → the current blocking-finding
// id array when an oracle is wired (the kernel snapshots the published gate), absent for a pure
// control-flow caller.
// W6-S3: the TRANSITION is the single-source recoveryDecision — advance seals, scoped-move spends
// one repair edge then rechecks, held ends the loop. The edge stays the repair each organ already
// owns; only the decision is shared, and EVERY transition from a closed fact flows through it — the
// loop short-circuits nothing above it. A recheck cohort must STRICTLY shrink the pinned prior
// (clear one blocking finding, introduce none) or it is no progress and holds — the edge is spent
// either way. The contract carries two closed facts the loop no longer rules on its own:
// cohortEstablished (a prior cohort is pinned — a measured recheck; its ABSENCE is the establishing
// reject a first review or a no-oracle caller makes, a scoped-move up to the reversibility-keyed
// cap, an omitted/invalid cap failing up to 1) and oracleMissing (a wired oracle that read no
// cohort is a missing verdict, held before any subset eval). The actual cohorts pass through — never
// a fabricated sentinel. A held maps onto the caller-facing terminal the beats already speak — a
// reject held is the operator-ruling blocked, the missing-oracle hold the transport terminal. The
// return carries edgeUses as repairs, the name the counters already speak.
async function reviewLoop(deps, cap) {
  cap = Number.isInteger(cap) && cap >= 1 ? cap : 1
  const heldAs = { codex_unavailable: 'degraded', gate_unreachable: 'gate-unreachable', transport_failure: 'transport-failure' }
  let edgeUses = 0
  let prior = null
  let exit = await deps.gate('review', 0)
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
    if (decision.action === 'advance') return { result: 'sealed', repairs: edgeUses }
    if (decision.action === 'held') return { result: decision.reason === 'oracle-missing' ? 'transport-failure' : (heldAs[o] || 'blocked'), repairs: edgeUses }
    edgeUses += 1
    const confirmed = await deps.repair(edgeUses)
    if (confirmed !== true) return { result: 'repair-failed', repairs: edgeUses }
    prior = curr
    exit = await deps.gate('recheck', edgeUses)
  }
}

// W6-B (Q5, CONFIRMED): a valid recheck must STRICTLY shrink the blocking cohort —
// every current blocking id was present before AND at least one prior id cleared
// (curr subset of prior, strict). Equality clears nothing, so it is no progress and
// holds upstream. accept is the empty strict subset (all cleared), handled by the
// recoveryDecision accept branch before this is consulted. A new-or-renamed id
// (the superset direction) is a schema / allowed-id violation caught earlier and
// held before this runs; the membership guard here still returns false on it as a
// second line. Deterministic, never throws.
function strictSubsetProgress(prior, curr) {
  if (!Array.isArray(prior) || !Array.isArray(curr)) return false
  const priorSet = new Set(prior)
  const currSet = new Set(curr)
  for (const id of currSet) {
    if (!priorSet.has(id)) return false
  }
  return currSet.size < priorSet.size
}

// W6-01/B/S3: the ONE pure recovery decision — the single source of the repair to
// recheck transition policy both the LAW/build reviewLoop and the research-sweep
// ratifyLoop route through (today each embeds the policy in its own control flow with
// a different vocabulary). Facts are all closed machine facts: gateOutcome (the
// gateOutcome return string), edgeUses/cap (the repair-edge budget for this run),
// prior/currBlockingIds (the prior and current blocking finding cohorts), schemaValid
// (the recheck verdict was well-formed), transport (the bridge delivered a verdict),
// oracleMissing (a wired cohort oracle read no verdict), cohortEstablished (a prior
// cohort is pinned, so this is a measured recheck rather than the establishing reject).
// A machine fault rules FIRST, before progress is weighed: a downed transport or a
// malformed verdict is the ABSENCE of a usable verdict, not evidence of progress, so
// the run holds rather than spend an edge on a fiction. Then accept advances. On a
// reject an unreadable oracle holds before any subset eval (a missing verdict is not
// progress); with a cohort established the current must be a strict subset of the prior
// or it holds; the establishing reject (no prior pinned, or no oracle) has nothing to
// disprove and is progress by definition. Either way an exhausted cap holds; otherwise
// the edge is a scoped-move. Everything else — equality, a non-shrinking cohort, a
// block — holds. Deterministic, never throws.
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

// W6-F (A3, Q3 CONFIRMED): the recovery cap is reversibility-keyed off the Gauge dial and read
// ONCE per invocation. The dial leg carries recovery_cap alongside width (law) or alone (build);
// this normalizes it STRICTLY — cap 2 only when the leg exited 0 AND the dial read recovery_cap
// EXACTLY 2 (the reversible profile), and every other value or a transport failure fails UP to
// cap 1 (fewer recovery edges precisely when the reading is least trustworthy, matching
// gauge-dial its own fail-up default). Width never enters here — a wide plan widens the plan
// table, it never raises the cap. research-sweep carries a drift-pinned copy. Never throws.
function capFromDial(leg) {
  const d = leg || {}
  return d.exit === 0 && d.recovery_cap === 2 ? 2 : 1
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

// S1 (A9 / W5-03): the projection-agreement leg. Milestone labels are AUTHORITATIVE in
// the LAW plan table (a `| slice | milestone |` GitHub table in LAW.md); slices.json is
// their checked projection. This deterministic command compares the two ordered
// [id, label] lists and exits 0 iff they agree — the kernel branches on that exit code
// alone and never reads the plan prose. It anchors on a GFM `## Plan` heading (a literal
// `## ` prefix — `##Plan` is prose, not a heading), stops at the next section heading so a
// table under a later heading cannot masquerade as the plan, requires the
// `| slice | milestone |` header and a GFM delimiter row of at least three hyphens per cell,
// reads exactly two cells per data row (a longer row is malformed), and normalizes an empty
// cell / absent field to ''.
// A missing/unanchored/malformed table or any divergence exits nonzero, so a mismatched
// plan never seals (W7 audits the seams
// off this same projection, so they must match).
const MILESTONE_PROJECTION_CHECK =
  "node -e 'const fs=require(\"fs\");" +
  "const proj=require(\"./.kiln/slices.json\").map(s=>[String((s&&s.id)||\"\").trim(),String((s&&s.milestone)||\"\").trim()]);" +
  "const lines=fs.readFileSync(\"./.kiln/LAW.md\",\"utf8\").split(\"\\n\");" +
  "let auth=[],state=0,ok=true;" +
  "for(const ln of lines){const t=ln.trim();const row=t.slice(0,1)===\"|\";" +
  "if(state===0){if(t.slice(0,3)===\"## \"&&t.slice(3).trim().toLowerCase()===\"plan\")state=1;continue;}" +
  "if(state===1){if(t.slice(0,1)===\"#\"){ok=false;break;}if(!row)continue;const c=t.split(\"|\").slice(1,-1).map(x=>x.trim());" +
  "if(c.length===2&&c[0].toLowerCase()===\"slice\"&&c[1].toLowerCase()===\"milestone\"){state=2;continue;}ok=false;break;}" +
  "if(state===2){const c=t.split(\"|\").slice(1,-1).map(x=>x.trim());" +
  "if(row&&c.length===2&&c.every(x=>/^:?-{3,}:?$/.test(x))){state=3;continue;}ok=false;break;}" +
  "if(!row)break;" +
  "const c=t.split(\"|\").slice(1,-1).map(x=>x.trim());if(c.length!==2){ok=false;break;}auth.push([c[0],c[1]]);}" +
  "process.exit(ok&&JSON.stringify(proj)===JSON.stringify(auth)?0:1);'"

// S1 (W8-B): the perceptual-table gate. The Perceptual table rides INSIDE LAW.md under a
// GFM `## Perceptual` heading — `| criterion id | owning slice | dim | requirement |
// proxy command | expected | reference |`, the reference cell optional per row. This
// deterministic command reads LAW.md + slices.json and exits 0 iff the closed facts
// agree, with the same parser discipline as MILESTONE_PROJECTION_CHECK above (heading
// anchor, section boundary, exact header, GFM delimiter row of at least three hyphens
// per cell, exactly seven cells per row — split on UNESCAPED `|` only, so a lawful
// proxy command carries a pipe as GFM `\|` and unescapes to the real operator; the
// milestone parser above keeps its raw split because labels forbid `|` by law).
// Table present: every required cell nonempty
// after trim; criterion ids unique; each owning slice a slices.json id; each dim a
// shipped perceptual-rubric id (the FIXED six, duplicated here because a const command
// cannot read the plugin path — the kernel.test.mjs drift guard pins the two lists
// together); DISTINCT dims 4-6; a nonempty reference cell names an existing path INSIDE
// the project root (resolve-containment before fs.existsSync — an absolute or
// parent-escaping path that exists elsewhere never rides; the card demands an existing
// repo path). COVERAGE: every slices.json entry with surface
// ui or mixed owns at least one row. CONSISTENCY: any ui/mixed surface REQUIRES the
// table, and a `## Perceptual` heading with no well-formed table under it fails closed.
// Absent table with no ui/mixed surfaces agrees (exit 0) — the dormant run never pays.
const PERCEPTUAL_TABLE_CHECK =
  "node -e 'const fs=require(\"fs\");" +
  "const slices=require(\"./.kiln/slices.json\");" +
  "const ids=slices.map(s=>String((s&&s.id)||\"\").trim());" +
  "const vis=slices.filter(s=>[\"ui\",\"mixed\"].indexOf(String((s&&s.surface)||\"\").trim())>=0).map(s=>String((s&&s.id)||\"\").trim());" +
  "const dims=[\"composition-hierarchy\",\"typography\",\"color-contrast\",\"interaction-feedback\",\"motion-continuity\",\"fidelity-to-requirement\"];" +
  "const head=[\"criterion id\",\"owning slice\",\"dim\",\"requirement\",\"proxy command\",\"expected\",\"reference\"];" +
  "const path=require(\"path\");const root=path.resolve(\".\");" +
  "const cells=s=>s.split(/(?<!\\\\)\\|/).slice(1,-1).map(x=>x.replace(/\\\\\\|/g,\"|\").trim());" +
  "const lines=fs.readFileSync(\"./.kiln/LAW.md\",\"utf8\").split(\"\\n\");" +
  "let rows=[],state=0,ok=true,found=false;" +
  "for(const ln of lines){const t=ln.trim();const row=t.slice(0,1)===\"|\";" +
  "if(state===0){if(t.slice(0,3)===\"## \"&&t.slice(3).trim().toLowerCase()===\"perceptual\"){state=1;found=true;}continue;}" +
  "if(state===1){if(t.slice(0,1)===\"#\"){ok=false;break;}if(!row)continue;const c=cells(t);" +
  "if(c.length===7&&c.every((x,i)=>x.toLowerCase()===head[i])){state=2;continue;}ok=false;break;}" +
  "if(state===2){const c=t.split(\"|\").slice(1,-1).map(x=>x.trim());" +
  "if(row&&c.length===7&&c.every(x=>/^:?-{3,}:?$/.test(x))){state=3;continue;}ok=false;break;}" +
  "if(!row)break;" +
  "const c=cells(t);if(c.length!==7){ok=false;break;}rows.push(c);}" +
  "if(found){if(state!==3)ok=false;" +
  "const seen=new Set(),dset=new Set(),owned=new Set();" +
  "for(const c of rows){for(let i=0;i<6;i++)if(!c[i])ok=false;" +
  "if(seen.has(c[0]))ok=false;seen.add(c[0]);" +
  "if(ids.indexOf(c[1])<0)ok=false;owned.add(c[1]);" +
  "if(dims.indexOf(c[2])<0)ok=false;dset.add(c[2]);" +
  "if(c[6]){const a=path.resolve(c[6]);if(!(a===root||a.slice(0,root.length+1)===root+path.sep)||!fs.existsSync(a))ok=false;}}" +
  "if(dset.size<4||dset.size>6)ok=false;" +
  "for(const v of vis)if(!owned.has(v))ok=false;" +
  "}else{ok=vis.length===0;}" +
  "process.exit(ok?0:1);'"

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
// A slices.json entry is either a legacy bare id string (surface mixed, no label)
// or the object form encoded as EXACTLY four wire slots — "obj|<id>|<surface>|<label>"
// — where the trailing milestone <label> is OPTIONAL (S1, A9): a legacy three-slot
// "obj|<id>|<surface>" reads as an absent label. An object must carry a SLICE_ID id
// and a surface in ui|logic|mixed. The milestone normalizes to '' when absent and is
// REJECTED (entry invalid, run halts before any builder dispatch) when it smuggles the
// '|' descriptor separator — which would split into extra slots — or a control
// character, which cannot survive the descriptor transport. Only the legacy bare form
// defaults to mixed; its id is charset-gated the same way.
// The ONE slice-id contract (W7-S1), shared verbatim with the kiln-review append-audit
// gate: letters, digits, dot, underscore, hyphen and slash. A slice id rides an
// UNQUOTED shell word at seal:append, the grep anchors "^<id> " over seals.log and
// audits.log, and the audit argv — so whitespace, control bytes and shell-active
// bytes are rejected HERE, before any builder dispatch, never mid-build as a split
// seal append or an unpublishable audit. Slash is inside the set: path-like ids such
// as feature/ui are shell-word-safe and anchor-safe.
const SLICE_ID = /^[A-Za-z0-9._/-]+$/
function parseSliceEntry(entry) {
  const s = String(entry ?? '')
  if (s.slice(0, 4) === 'obj|') {
    const parts = s.slice(4).split('|')
    const id = parts[0] ?? ''
    const surface = parts[1] ?? ''
    const rawMilestone = parts.length > 2 ? parts[2] : ''
    // Two slots (legacy, absent label) or three (id|surface|label) only; a fourth
    // slot means a raw '|' rode inside a field — reject rather than guess.
    const shaped = parts.length === 2 || parts.length === 3
    // The full control-free invariant (C0, DEL, and C1 U+0080–U+009F) checked on the RAW
    // bytes: C1 is not whitespace, so it would survive the trim below and cannot ride the
    // descriptor transport — the range is explicit so it is rejected, not normalized away.
    const cleanLabel = !/[\x00-\x1f\x7f\x80-\x9f]/.test(rawMilestone)
    // Normalize to the trimmed label — the SAME normalization MILESTONE_PROJECTION_CHECK
    // applies — so the seam fact and the W7 audit read identical bytes and a padded cell
    // that passes projection agreement can never fabricate a spurious milestone seam.
    const milestone = rawMilestone.trim()
    return { id, surface, milestone, valid: shaped && cleanLabel && SLICE_ID.test(id) && TIER_ROUTES.indexOf(surface) >= 0 }
  }
  return { id: s, surface: 'mixed', milestone: '', valid: SLICE_ID.test(s) }
}

// S1 (A9, W5-07): the milestone SEAM closed fact, carried for the W7 goal-backward
// audit — W5 computes it but never audits. `labels` is the normalized milestone per
// slice in build order (parseSliceEntry trimmed each and normalized an absent label to the empty string); a seam
// falls AFTER slice i when i is the FINAL slice, or when its label differs from that of
// the NEXT slice — the point a milestone completes. An unlabeled run (every label
// empty) carries a single whole-build seam at the final slice, the A9 implicit final.
function milestoneSeamAfter(labels, i) {
  if (!Array.isArray(labels) || i < 0 || i >= labels.length) return false
  return i === labels.length - 1 || labels[i] !== labels[i + 1]
}

// W7-01 (plan B): the ONE pure milestone-audit reconcile — the derivation rule the
// kernel branches on over the published closed arrays, never on the wire verdict
// string. Pinned finding identity is the stable finding id, the SAME key the W6
// cohort lineage and strictSubsetProgress speak. Dedup by id is defensive (the wire
// validator enforces uniqueness) and preserves first-seen input order; a duplicated
// id where any instance is a blocker collapses to a blocker — max severity, blockers
// dominant. invalid when either input is not an array, a finding lacks a nonempty
// string id, or a blocker entry is not a nonempty string equal to some finding id —
// the referential rule, which also rules a blocker set over empty findings invalid.
// Derivation: deduped blocker ids nonempty is blocked; else deduped finding ids
// nonempty is changes_required; else accept. Deterministic, never throws.
function reconcileAudit(findings, blockers) {
  const invalid = { verdict: 'invalid', blockerIds: [], findingIds: [] }
  try {
    if (!Array.isArray(findings) || !Array.isArray(blockers)) return invalid
    const findingIds = []
    const seen = new Set()
    for (const f of findings) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) return invalid
      if (typeof f.id !== 'string' || f.id.trim() === '') return invalid
      if (!seen.has(f.id)) {
        seen.add(f.id)
        findingIds.push(f.id)
      }
    }
    const blockerIds = []
    const chosen = new Set()
    for (const b of blockers) {
      if (typeof b !== 'string' || b.trim() === '' || !seen.has(b)) return invalid
      if (!chosen.has(b)) {
        chosen.add(b)
        blockerIds.push(b)
      }
    }
    const verdict = blockerIds.length > 0 ? 'blocked' : findingIds.length > 0 ? 'changes_required' : 'accept'
    return { verdict, blockerIds, findingIds }
  } catch {
    return invalid
  }
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

// The frozen posture enums (Wave 3). validatePosture below reuses them as the LAW
// input gate; the Gauge dial PROJECTOR (postureToDials) moved to scripts/gauge-dial.mjs
// (W4) — it was body-local here with no production consumer and cannot be imported from a
// Workflow async-body, and research-sweep.js is its first real reader. That script keeps
// its own copy of these three arrays; tests/gauge-dial.test.mjs asserts the two agree, so
// the deliberate duplication can never drift.
const POSTURE_SCOPE = ['small', 'large']
const POSTURE_NOVELTY = ['familiar', 'novel']
const POSTURE_REVERSIBILITY = ['reversible', 'risky', 'irreversible']

// validatePosture — the pure LAW-input-gate predicate (Wave 3). The onboarding
// producer (direct path) or the vision compiler (brainstorm path) writes
// .kiln/posture.json as EXACTLY {scope, novelty, reversibility} over the frozen
// enums; this is the deterministic check the kernel runs before the law stage
// plans, reusing the same frozen POSTURE_* enums the projector does. True iff obj
// is a plain object carrying exactly those three own fields, each in its enum —
// the same exact-field guard (Reflect.ownKeys catches non-enumerable and Symbol
// smuggling) so an ill-formed projection cannot pass the gate. Deterministic;
// adversarial input fails to false, never throws.
function validatePosture(obj) {
  try {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
    const keys = Reflect.ownKeys(obj)
    const fields = ['scope', 'novelty', 'reversibility']
    if (keys.length !== fields.length || fields.some(k => keys.indexOf(k) < 0)) return false
    const { scope, novelty, reversibility } = obj
    return POSTURE_SCOPE.indexOf(scope) >= 0 && POSTURE_NOVELTY.indexOf(novelty) >= 0 && POSTURE_REVERSIBILITY.indexOf(reversibility) >= 0
  } catch { return false }
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
  // W7-S2: the published milestone audit verdict — the audit-family gate file.
  audit: '.kiln/audit-review.json',
  // Wave 3: the onboarding outputs the LAW input gate verifies before planning.
  brief: '.kiln/docs/project-brief.md', posture: '.kiln/posture.json',
  // Wave 3 (brownfield arm): the closed-fact marker the onboarding preflight drops
  // on a brownfield target, and the map it then authors — the gate requires the map
  // nonempty whenever the marker is present. Greenfield runs carry neither.
  brownfield: '.kiln/brownfield', codebaseMap: '.kiln/docs/codebase-map.md',
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
// Wave 3: the LAW-input posture read. A boot-style node -p projection leg (the
// tiers-boot shape) returns exit plus the OWN keys of the on-disk posture, which the
// pure validatePosture then checks against the frozen enums — the kernel stays
// content-blind (the leg parses, never the kernel body). The projection carries
// every own key faithfully: a dropped field is absent from the return, an EXTRA
// field (a persisted dial or effort) is carried through — so the validatePosture
// exact-field guard rejects both, and the returned key set models the on-disk
// posture in BOTH directions. additionalProperties stays true precisely so an extra
// on-disk key reaches that guard instead of being silently stripped at the schema
// and admitted as a valid three-field posture.
const POSTURE_LEG = {
  type: 'object', additionalProperties: true,
  properties: {
    exit: { type: 'integer' },
    scope: { type: 'string' }, novelty: { type: 'string' }, reversibility: { type: 'string' },
  },
  required: ['exit'],
}
// W5-S2 (W5-04): the Gauge WIDTH dial read — the same boot-style projection shape research-sweep
// reads the research dial through. The leg parses the JSON gauge-dial prints; the kernel body
// never does. additionalProperties stays true so the other dials pass through harmlessly. W6-F:
// the same leg also carries recovery_cap, so one dial read serves both the WIDE branch and the
// reversibility-keyed recovery cap; the build stage reuses this schema for its own cap read.
const WIDTH = { type: 'object', additionalProperties: true, properties: { exit: { type: 'integer' }, width: { type: 'string' }, recovery_cap: { type: 'integer' } }, required: ['exit'] }
// W5-S2 (W5-01): a WIDE adjust leg returns the ordinary stage envelope plus the closed
// `converged` self-report the content-blind skip-adjudication gate reads alongside byte-equality.
const WIDE_ADJUST = {
  type: 'object', additionalProperties: false,
  properties: { facts: STAGE_RESULT.properties.facts, narration_beat: { type: 'string' }, converged: { type: 'boolean' } },
  required: ['facts', 'narration_beat', 'converged'],
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

// ── W5-S2 (W5-01/02/06): the WIDE blind-dual branch helpers ─────────────────
// Isolated candidate paths — a WIDE author never writes the canonical .kiln/LAW.md (avoids the
// W5-02 collision two authors racing the same path would cause). Each dir holds the FULL LAW
// output set; the adjusted dirs hold each post-cross-read candidate.
const WIDE = { root: '.kiln/.wide', aDraft: '.kiln/.wide/a', bDraft: '.kiln/.wide/b', aAdj: '.kiln/.wide/a-adjusted', bAdj: '.kiln/.wide/b-adjusted' }
// Promote the identical adjusted candidate, its COMPLETE four-output set, to the canonical LAW
// paths as ONE all-or-nothing transaction. A test -s per output fails closed on an incomplete
// candidate before canon is touched; then an ERR-trap unwinds any partial promote so a
// mid-sequence mv fault leaves canon ALL-old (or all-absent), never a LAW.md-changed /
// slices-stale mix — the command re-exits nonzero, the run fails closed, and it never ratifies
// or seals (W5-02). The `phase` gate scopes the unwind: while staging the prior canon aside a
// fault leaves the originals in place (nothing to undo); once promoting, a fault restores each
// slot from its backup or removes the freshly-moved file. Kiln runs one pipeline over its own
// .kiln/ with no concurrent writer, so the moves carry no time-of-check/use window (the same
// binding the research sweep promote uses). The a-side is chosen by convention: the skip gate
// proved the two byte-equal.
const WIDE_PROMOTE = [
  'set -e', 'mkdir -p .kiln/law',
  'test -s ' + WIDE.aAdj + '/LAW.md', 'test -s ' + WIDE.aAdj + '/law/check.sh',
  'test -s ' + WIDE.aAdj + '/slices.json', 'test -s ' + WIDE.aAdj + '/decisions.md',
  'bak=' + WIDE.root + '/.promote-bak; phase=stage',
  'rm -rf "$bak"; mkdir -p "$bak/law"',
  'rollback(){ trap - ERR; set +e;'
    + ' if [ -e "$bak/LAW.md" ]; then mv -f "$bak/LAW.md" .kiln/LAW.md; elif [ "$phase" = promote ]; then rm -f .kiln/LAW.md; fi;'
    + ' if [ -e "$bak/law/check.sh" ]; then mv -f "$bak/law/check.sh" .kiln/law/check.sh; elif [ "$phase" = promote ]; then rm -f .kiln/law/check.sh; fi;'
    + ' if [ -e "$bak/slices.json" ]; then mv -f "$bak/slices.json" .kiln/slices.json; elif [ "$phase" = promote ]; then rm -f .kiln/slices.json; fi;'
    + ' if [ -e "$bak/decisions.md" ]; then mv -f "$bak/decisions.md" .kiln/decisions.md; elif [ "$phase" = promote ]; then rm -f .kiln/decisions.md; fi;'
    + ' exit 1; }',
  'trap rollback ERR',
  'if [ -e .kiln/LAW.md ]; then mv -f .kiln/LAW.md "$bak/LAW.md"; fi',
  'if [ -e .kiln/law/check.sh ]; then mv -f .kiln/law/check.sh "$bak/law/check.sh"; fi',
  'if [ -e .kiln/slices.json ]; then mv -f .kiln/slices.json "$bak/slices.json"; fi',
  'if [ -e .kiln/decisions.md ]; then mv -f .kiln/decisions.md "$bak/decisions.md"; fi',
  'phase=promote',
  'mv -f ' + WIDE.aAdj + '/LAW.md .kiln/LAW.md',
  'mv -f ' + WIDE.aAdj + '/law/check.sh .kiln/law/check.sh',
  'mv -f ' + WIDE.aAdj + '/slices.json .kiln/slices.json',
  'mv -f ' + WIDE.aAdj + '/decisions.md .kiln/decisions.md',
  'trap - ERR', 'rm -rf "$bak"',
].join('\n')
// The COMPLETE canonical LAW output set, relative to .kiln/. Two closed-fact gates read it so no
// residual difference is ever silently discarded: the skip-adjudication byte gate compares all four
// across the two adjusted candidates (equal LAW.md with a divergent check.sh/slices.json/decisions.md
// is a residual divergence, not an identical pair), and the adjudicate completeness gate tests each
// canonical output nonempty — the same four test -s floor WIDE_PROMOTE enforces on the skip path.
const WIDE_OUTPUTS = ['LAW.md', 'law/check.sh', 'slices.json', 'decisions.md']
const WIDE_BYTE_EQUAL = WIDE_OUTPUTS.map(o => 'cmp -s ' + WIDE.aAdj + '/' + o + ' ' + WIDE.bAdj + '/' + o).join(' && ')
const WIDE_CANON_CHECK = WIDE_OUTPUTS.map(o => 'test -s .kiln/' + o).join(' && ')
// The shared WIDE context — project dir, voice, density, and the verbatim operator idea (which MAY
// name a family; blindness is about ORCHESTRATION metadata, not idea content). Reused by the two
// symmetric author scaffolds and the fresh adjudicator, none of which carry a family/persona/model token.
const wideCtx = [
  'Project dir: ' + projectDir + '. Artifacts live under .kiln/.',
  'Voice: fill your beat from ' + plugin + '/data/voice.json templates; prefill every semantic slot; leave kernel-owned slots (' + KERNEL_SLOTS.map(k => '{' + k + '}').join(' ') + ') unfilled.',
  'Density: ' + density + ' — a slot-fill rule, never a structure: broad fills slots with the plain reader-meaningful version, engineer fills the same slots with file paths, ids, and counts.',
  A.idea ? 'Operator idea (verbatim): ' + A.idea : '',
].filter(Boolean)
// The SYMMETRIC author scaffolds — isomorphic modulo the neutral A/B candidate dir (W5-06): no
// orchestration-supplied peer provenance, no family/persona/model token.
const wideCommon = [
  'You are a Kiln WIDE LAW author: one of two independent minds planning the same idea, working apart. Read and follow the stage card at ' + plugin + '/cards/wide-plan.md exactly.',
  ...wideCtx,
]
const wideDraftPrompt = (dir) => [
  ...wideCommon,
  'Write your DRAFT — the full LAW output set (LAW.md, law/check.sh, slices.json, decisions.md) — into your candidate directory ' + dir + ', never the canonical .kiln/LAW.md. This draft is IMMUTABLE: once written you do not edit it.',
  'Return {facts:{status, pointers, schema_valid}, narration_beat} — facts.status is "ok" only if all four outputs are written under ' + dir + '.',
].join('\n')
const wideAdjustPrompt = (own, peer, adj) => [
  ...wideCommon,
  'You already wrote a draft plan at ' + own + '. A second, independent plan of the SAME idea sits at ' + peer + ' — read ONLY its plan artifacts (LAW.md, law/check.sh, slices.json, decisions.md); it carries no author identity and you supply none.',
  'Weigh the two plans and write your ADJUSTED full LAW output set to ' + adj + ' (never the canonical .kiln/LAW.md). Return converged:true ONLY if the two plans have genuinely converged to the same law (you adopted the shared plan); converged:false if a real divergence remains — never a convergence you do not see.',
  'Return {facts:{status, pointers, schema_valid}, narration_beat, converged} — facts.status is "ok" only if all four adjusted outputs are written under ' + adj + '.',
].join('\n')
const wideAdjust = (prompt, label) => agent(prompt, { label, ...tier('stage-law'), schema: WIDE_ADJUST })
  .then(r => (r ?? { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '', converged: false }))
// W5-S3 (W5-05 / ADR A11): the fresh Q-F adjudicator scaffold. A fresh leg — not one of the two
// authors, decorrelated by freshness, still the stage-law/fable rung (NO role #13) — anonymized
// like the cross-read: it reads the two ADJUSTED candidates as neutral A/B artifacts, consolidates
// what they already agree on, and rules ONLY the surviving divergences into the COMPLETE four-output
// canonical LAW, appending one ADR per residual call to .kiln/decisions.md — never a silent
// whole-new plan. Because it authors canonical directly, its result rejoins the UNCHANGED ratify
// block exactly as the floor act would.
const wideAdjudicatePrompt = [
  'You are a Kiln WIDE LAW adjudicator: a fresh mind resolving the residual divergence between two independent plans of the same idea. Read and follow the stage card at ' + plugin + '/cards/wide-adjudicate.md exactly.',
  ...wideCtx,
  'Two ADJUSTED candidate plans of the same idea sit at ' + WIDE.aAdj + ' and ' + WIDE.bAdj + ' — read ONLY their plan artifacts (LAW.md, law/check.sh, slices.json, decisions.md); neither carries an author identity and you supply none.',
  'Consolidate everything the two candidates already agree on and carry it unchanged; rule ONLY the surviving divergences — the parts where they still differ. Never synthesize a wholly new plan: every criterion and slice you emit is one the two candidates already share, or your ruling on a specific divergence between them.',
  'Write the COMPLETE canonical LAW — .kiln/LAW.md, .kiln/law/check.sh, .kiln/slices.json, .kiln/decisions.md — and APPEND one "## ADR-N" entry to .kiln/decisions.md per residual divergence you ruled, each recording the call and its rationale.',
  'Return {facts:{status, pointers, schema_valid}, narration_beat} — facts.status is "ok" only if the complete four-output canonical LAW is written.',
].join('\n')

// LAW rerun beat: at every kernel invocation start (resume), if the check
// exists. Red reopens only a sealed owner; otherwise the run proceeds.
const pre = await lawBeat(LAW_GUARD, 'law:preflight')
if (pre.exit !== 0) {
  const owner = await firstSealed(pre.ids)
  if (owner) return reopen(owner, 'resume')
}

if (stage !== 'build') {
  const stageFacts = { STAGE: stage.toUpperCase(), i: SPINE.indexOf(stage) + 1, n: SPINE.length }
  // Wave 3 (the Gauge foundation): the LAW input gate. The onboarding organ (direct
  // path) or the vision compiler (brainstorm path) is the earliest producer — it writes
  // .kiln/docs/project-brief.md + .kiln/posture.json before the kernel ever launches the
  // law stage. This deterministic post-producer gate verifies both are present and
  // well-formed BEFORE planning: the brief by a nonempty test (the report existence
  // gate's shape), the posture by a boot-style node -p projection leg (the tiers-boot
  // shape) validated against the frozen enums. schema_valid is the producer's own
  // self-attestation and is deliberately NOT trusted here. Missing or malformed halts
  // honestly, reusing transport-failure (no new status, no new voice beat), and names a
  // rerun of onboarding — a plan built on absent inputs is never begun.
  if (stage === 'law') {
    if (await hands('test -s ' + P.brief, 'onboarding:brief-check') !== 0) {
      return failStop('transport-failure',
        { stage, next_action: 'Rerun onboarding: ' + P.brief + ' is empty or missing before the LAW stage plans' },
        await voiceBeat('transport-failure', {}, 'The onboarding brief at ' + P.brief + ' is empty or missing — the LAW has nothing to plan from, so the run holds.', 1),
        { brief: P.brief, posture: P.posture })
    }
    // Faithful projection: {...p} carries EVERY own key of the on-disk posture
    // (never a hand-picked scope/novelty/reversibility triple, which would silently
    // strip a persisted dial or effort and pass the gate). The validatePosture
    // exact-field guard is the sole judge of the field set.
    const postureCmd =
      "node -p 'JSON.stringify(((p)=>({...p}))(require(\"./" + P.posture + "\")))'"
    const postureLeg = await agent(
      'Run exactly this in ' + projectDir + '. Report {exit, ...fields}: exit = the exit code; the remaining keys = EVERY field of the printed JSON object exactly as printed when exit is 0 — add none and drop none — all omitted when exit is nonzero:\n' + postureCmd,
      { label: 'onboarding:posture', ...tier('kernel-leg'), schema: POSTURE_LEG },
    ).then(rp => (rp ?? { exit: 20 }))
    const { exit: postureExit, ...postureProjection } = postureLeg
    if (postureExit !== 0 || !validatePosture(postureProjection)) {
      return failStop('transport-failure',
        { stage, next_action: 'Rerun onboarding: ' + P.posture + ' is missing or not a valid {scope,novelty,reversibility} projection' },
        await voiceBeat('transport-failure', {}, 'The onboarding posture at ' + P.posture + ' is missing or malformed — the run holds until it is a valid {scope, novelty, reversibility} projection.', 1),
        { brief: P.brief, posture: P.posture })
    }
    // Wave 3 (the brownfield arm): the onboarding preflight is a bounded
    // deterministic classifier (scripts/detect-brownfield.sh). On a brownfield
    // target it drops the closed-fact marker .kiln/brownfield and authors
    // .kiln/docs/codebase-map.md; greenfield drops neither. A present marker
    // (test -e) therefore makes the map a REQUIRED input — a plan laid over an
    // existing codebase with no map is a plan built blind. A marker with a missing
    // or empty map (test -s) halts honestly, reusing transport-failure (no new
    // status, no new voice beat), naming a rerun of onboarding; greenfield runs
    // (no marker) short-circuit and require no map. Both legs branch on shell
    // exits only — the kernel reads neither the marker nor the map.
    if (await hands('test -e ' + P.brownfield, 'onboarding:brownfield-check') === 0 &&
        await hands('test -s ' + P.codebaseMap, 'onboarding:map-check') !== 0) {
      return failStop('transport-failure',
        { stage, next_action: 'Rerun onboarding: ' + P.brownfield + ' marks a brownfield run but ' + P.codebaseMap + ' is empty or missing' },
        await voiceBeat('transport-failure', {}, 'The onboarding marked a brownfield run but the codebase map at ' + P.codebaseMap + ' is empty or missing — the LAW will not plan over an existing codebase blind, so the run holds.', 1),
        { brief: P.brief, posture: P.posture, codebaseMap: P.codebaseMap })
    }
  }
  // W5-S2 (W5-04): the LAW producer branches on the Gauge WIDTH dial (mirroring the research-
  // sweep dial read). floor is the SOLE narrow result — exit 0 AND width 'floor' — and keeps the
  // EXISTING single act producer, untouched; every other value or a transport failure fails UP to
  // the WIDE blind-dual branch. validate and report never read width — they keep the single act.
  // Both LAW branches leave the full four-output LAW set on disk and rejoin the UNCHANGED ratify
  // block below; a WIDE divergence holds safely before it (S3 lands the adjudicator that resolves
  // it). The kernel stays content-blind — it branches on the width, converged, and byte-equality
  // closed facts, never on plan content.
  let r
  // W6-F: the reversibility-keyed recovery cap, threaded into the LAW-ratify loop below. It stays
  // 1 on every non-law path (unused there) and is set from the single dial read this law
  // invocation makes. Width never raises it — a wide plan widens the plan table, not the budget.
  let cap = 1
  if (stage === 'law') {
    const widthLeg = await agent(
      'Run exactly this in ' + projectDir + '. Report {exit, width, recovery_cap}: exit = the exit code; width = the value of the "width" field and recovery_cap = the value of the "recovery_cap" field in the printed JSON dials object when exit is 0, both omitted when exit is nonzero:\n' + 'node ' + plugin + '/scripts/gauge-dial.mjs',
      { label: 'width:read', ...tier('kernel-leg'), schema: WIDTH },
    ).then(x => (x ?? { exit: 20 }))
    // One dial read carries both the WIDE-branch width and the recovery cap (fail-up to 1).
    cap = capFromDial(widthLeg)
    if (widthLeg.exit === 0 && widthLeg.width === 'floor') {
      r = await act(cardPrompt(A.idea ? 'Operator idea (verbatim): ' + A.idea : ''), 'stage:law')
    } else {
      // The blind-dual dance (W5-01/02/06). Freshness first: clear any stale wide workspace so a
      // stale prior candidate can never ride a false byte-equality or promote.
      if (await hands('rm -rf ' + WIDE.root, 'wide:prep') !== 0) return persistFail('wide-prep')
      // Two BLIND authors, SYMMETRIC scaffolding (the draft prompts isomorphic modulo the neutral
      // A/B candidate dir — no orchestration peer provenance), each writing an IMMUTABLE full-output
      // draft to an ISOLATED dir, never the canonical .kiln/LAW.md.
      const draftA = await actWith(wideDraftPrompt(WIDE.aDraft), 'wide:draft-a', tier('stage-law'))
      const draftB = await actWith(wideDraftPrompt(WIDE.bDraft), 'wide:draft-b', tier('stage-law'))
      // Symmetric cross-read + ONE adjustment: each reads the OTHER immutable draft (its plan
      // artifacts only — no author identity, no runtime label/persona/model metadata) and writes an
      // ADJUSTED full-output candidate to its own isolated path, returning converged.
      const adjA = await wideAdjust(wideAdjustPrompt(WIDE.aDraft, WIDE.bDraft, WIDE.aAdj), 'wide:adjust-a')
      const adjB = await wideAdjust(wideAdjustPrompt(WIDE.bDraft, WIDE.aDraft, WIDE.bAdj), 'wide:adjust-b')
      // The content-blind skip-adjudication gate (W5-01): all four legs must be valid — status 'ok'
      // AND self-attested schema_valid — before any comparison, promotion, or adjudication. A leg
      // that declares malformed or missing outputs is a transport failure, not a residual
      // divergence: there is no valid candidate PAIR to adjudicate, so the run holds honestly and
      // an invalid leg is never promoted or adjudicated.
      const bothValid = draftA.facts.status === 'ok' && draftA.facts.schema_valid === true &&
        draftB.facts.status === 'ok' && draftB.facts.schema_valid === true &&
        adjA.facts.status === 'ok' && adjA.facts.schema_valid === true &&
        adjB.facts.status === 'ok' && adjB.facts.schema_valid === true
      if (!bothValid) return failStop('transport-failure',
        { stage, next_action: 'Rerun stage ' + stage },
        await voiceBeat('transport-failure', {}, 'A wide plan author did not return sound work — the run holds.', 1))
      // Both authors report converged AND all four adjusted outputs are BYTE-EQUAL → promote the
      // identical candidate directly. The cmp spans the COMPLETE four-output set (WIDE_BYTE_EQUAL):
      // equal LAW.md files with a divergent check.sh/slices.json/decisions.md are a residual
      // divergence that adjudicates, never a skip that silently discards the difference. The cmp is a
      // closed fact the kernel reads without ever opening the plan, short-circuited unless both
      // converged — so a non-converged report never fabricates a byte-equality, and a residual
      // divergence never skip-adjudicates.
      const bothConverged = adjA.converged === true && adjB.converged === true
      const skipAdjudication = bothConverged &&
        await hands(WIDE_BYTE_EQUAL, 'wide:byte-equal') === 0
      if (skipAdjudication) {
        // Atomic promotion of the identical adjusted candidate, its COMPLETE four-output set, to the
        // canonical LAW paths — a test -s per output makes an incomplete WIDE result fail closed, so
        // it never ratifies or seals (W5-02). r rejoins the UNCHANGED ratify block as the floor act would.
        if (await hands(WIDE_PROMOTE, 'wide:promote') !== 0) return persistFail('wide-promote')
        r = { facts: { status: 'ok', pointers: [P.law, '.kiln/law/check.sh', P.slices, '.kiln/decisions.md'], schema_valid: true }, narration_beat: adjA.narration_beat }
      } else {
        // W5-S3 (W5-05 / ADR A11): a residual divergence between two VALID candidates — a
        // non-converged report OR a byte-mismatch. A fresh Q-F adjudicator (a fresh stage-law/fable
        // leg, decorrelated by freshness, NO role #13) reads both adjusted candidates anonymized,
        // consolidates what they already agree on, and rules ONLY the surviving divergences into the
        // complete four-output canonical LAW, appending its adjudication ADRs to .kiln/decisions.md
        // — never a silent whole-new plan. Its result rejoins the UNCHANGED ratify block below and
        // still takes the ordinary opposite-family ratify key; this replaces the S2 temporary hold.
        r = await actWith(wideAdjudicatePrompt, 'wide:adjudicate', tier('stage-law'))
        // The adjudicator authors canonical directly, so it earns the SAME completeness floor
        // WIDE_PROMOTE enforces on the skip path: a self-attested schema_valid AND a test -s on each
        // of the four canonical outputs (WIDE_CANON_CHECK) must hold, or the run fails closed HERE —
        // status 'ok' alone never proves a complete, valid four-output LAW reached canon to ratify
        // and seal. An unsound self-report holds as a transport failure; an incomplete canon on disk
        // fails closed like a failed promote.
        if (r.facts.schema_valid !== true) return failStop('transport-failure',
          { stage, next_action: 'Rerun stage ' + stage },
          await voiceBeat('transport-failure', {}, 'The wide adjudicator did not return sound work — the run holds.', 1))
        if (await hands(WIDE_CANON_CHECK, 'wide:adjudicate-check') !== 0) return persistFail('wide-adjudicate')
      }
    }
  } else {
    r = await act(cardPrompt(A.idea ? 'Operator idea (verbatim): ' + A.idea : ''), 'stage:' + stage)
  }
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
      // The review grades the fresh LAW; a recheck re-grades the regenerated LAW through the W6
      // ratify-recheck verb, which reuses the prior review_id and constrains the reviewer to the
      // prior finding cohort — the SAME lineage the build recheck carries, so a repair round cannot
      // introduce a finding id out of nowhere (kiln-review recomputes the candidate digest from the
      // current bytes). prior and output are both P.gate: ratify-recheck reads the prior into memory
      // before runGate writes the output. The direct-path call preserves 126/127 → gate-unreachable
      // exactly as the build gate does. A9: the <repo> arg is the cwd-relative `.` — hands runs in
      // projectDir and the verb resolves the .kiln/ request and the artifact against it, never a
      // bare projectDir, which a whitespace path would split into extra argv and fail the gate.
      gate: (mode) => hands(
        mode === 'recheck'
          ? plugin + '/scripts/kiln-review ratify-recheck . ' + P.ratifyRequest + ' ' + P.gate + ' ' + P.gate
          : plugin + '/scripts/kiln-review ratify . ' + P.ratifyRequest + ' ' + P.gate,
        'ratify:gate'),
      // The pinned prior cohort for the strict-subset transition: the finding ids the last published
      // gate carries. A recheck must strictly shrink it or recoveryDecision holds the LAW.
      cohort: async () => {
        const c = await idsFetch(
          "node -p 'JSON.stringify((require(\"./" + P.gate + "\").findings||[]).map(f=>String(f.id)))'",
          'ratify:cohort', 'the printed JSON array of the prior ratify finding ids, [] if exit != 0',
        )
        return c.exit === 0 ? c.ids : null
      },
      repair: async (pass) => {
        const rr = await act(cardPrompt('Ratify repair pass ' + pass + ': the LAW did not ratify. Read every finding in ' + P.gate + ' and regenerate ' + P.law + ' to resolve them all, keeping the acceptance criteria and the slice plan sound and complete.'), 'ratify:repair')
        if (rr.facts.status !== 'ok') return false
        for (const p of rr.facts.pointers) routes.add(p)
        candidateBeat = rr.narration_beat // buffer the repaired candidate; the repair card beat also claims SEALED, so it is never emitted mid-loop
        return true
      },
    }, cap)
    if (ratifyLoop.result === 'sealed') {
      // S1 (A9 / W5-03): before the seal, a deterministic leg confirms the slices.json
      // milestone projection AGREES with the authoritative LAW plan table — the kernel
      // branches on the exit code alone (content-blind, never the plan prose). W7 audits
      // the seams off the slices projection, so a table/projection divergence must never
      // lock; a disagreement is an honest hold (reused transport-failure), not a silent
      // seal. This precedes the seal, so the SEALED-claiming card beat still speaks only
      // after both the projection and the seal land.
      if (await hands(MILESTONE_PROJECTION_CHECK, 'law:milestone-projection') !== 0) {
        return failStop('transport-failure',
          { stage, active_slice: 'none', next_action: 'Rerun stage law: the slices.json milestone projection disagrees with the LAW plan table' },
          await voiceBeat('transport-failure', {}, 'The slice milestones do not match the LAW plan table — the projection and its authoritative table must agree before the law locks, so the run holds.', 1),
          { law: P.law, slices: P.slices })
      }
      // S1 (W8-B): the perceptual table earns the SAME deterministic pre-seal agreement
      // the milestone projection above earns — the kernel branches on the exit code alone
      // (content-blind, never the table prose). Full lawful rows (nonempty cells, unique
      // ids, owners in slices.json, shipped-rubric dims 4-6 distinct, existing references),
      // COVERAGE of every ui/mixed slice, and the CONSISTENCY rule (any ui/mixed surface
      // requires the table) must all hold, or the run holds honestly (reused
      // transport-failure) — never a silent seal. Absent table with no ui/mixed surfaces
      // agrees, so a non-visual run seals exactly as before.
      if (await hands(PERCEPTUAL_TABLE_CHECK, 'law:perceptual-table') !== 0) {
        return failStop('transport-failure',
          { stage, active_slice: 'none', next_action: 'Rerun stage law: the LAW perceptual table does not agree with the slices and the shipped perceptual rubric' },
          await voiceBeat('transport-failure', {}, 'The perceptual table does not hold — its rows, owners and dims must agree with the slices and the shipped rubric before the law locks, so the run holds.', 1),
          { law: P.law, slices: P.slices })
      }
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
// closed surface fact and an OPTIONAL milestone label (S1); the fetch emits a legacy
// bare id string untouched, and the object form as "obj|<id>|<surface>|<milestone>"
// (the milestone slot rides in LOCKSTEP with the parseSliceEntry four-slot parse — an
// absent label projects to the empty trailing slot), so parseSliceEntry can tell the
// forms apart and validate the object form (bare strings alone default to mixed).
const list = await idsFetch(
  "node -p 'JSON.stringify(require(\"./" + P.slices + "\").map(s=>typeof s===\"string\"?s:\"obj|\"+(s&&s.id||\"\")+\"|\"+(s&&s.surface||\"\")+\"|\"+(s&&s.milestone||\"\")))'",
  'slices:fetch', 'the printed JSON array of slice descriptor strings (a bare id, or "obj|<id>|<surface>|<milestone>"), [] if exit != 0',
)
if (list.exit !== 0 || list.ids.length === 0) {
  return failStop('transport-failure', { stage, next_action: 'Rerun stage law: no slice list at ' + P.slices }, await voiceBeat('transport-failure', {}, 'No slice list on the ledger — the law stage must run again.', 1))
}
const slices = list.ids.map(parseSliceEntry)
// A malformed slice descriptor (an id outside the shared SLICE_ID charset or an
// unknown surface) halts BEFORE any builder dispatch — the law stage must author it right.
const badSlice = slices.find(x => !x.valid)
if (badSlice) {
  return failStop('slices-invalid',
    { stage, active_slice: badSlice.id || 'none', next_action: 'Rerun stage law: a slice descriptor in ' + P.slices + ' is malformed' },
    'A slice descriptor is malformed — every slice needs an id of letters, digits, dot, underscore, hyphen or slash, and a surface of ui, logic, or mixed. The law stage must run again.')
}
// The ordered slice-id list backs the order-aware boundary predicate (INTAKE-26).
const sliceIds = slices.map(x => x.id)
// S1 (A9): the milestone labels projected into each slice, in build order — the seam
// closed fact rides the facts of each slice below, carried for the W7 goal-backward audit.
const milestones = slices.map(x => x.milestone)
const ladder = await idsFetch(
  "node -p 'JSON.stringify(require(" + JSON.stringify(plugin + '/data/voice.json') + ").killstreak.ladder)'",
  'ladder:fetch', 'the printed JSON array of streak names, [] if exit != 0',
)
// W6-F: the reversibility-keyed recovery cap, read ONCE per build invocation from the same Gauge
// dial the law stage reads, and threaded into every slice gate reviewLoop below — a reject repair
// traverses the regenerate-slice edge only up to the cap (2 reversible, else 1; fail-up to 1 on any
// bad read). Width never raises it. One read, reused for every slice.
const capLeg = await agent(
  'Run exactly this in ' + projectDir + '. Report {exit, recovery_cap}: exit = the exit code; recovery_cap = the value of the "recovery_cap" field in the printed JSON dials object when exit is 0, omitted when exit is nonzero:\n' + 'node ' + plugin + '/scripts/gauge-dial.mjs',
  { label: 'cap:read', ...tier('kernel-leg'), schema: WIDTH },
).then(x => (x ?? { exit: 20 }))
const cap = capFromDial(capLeg)
// ── W7-S2: the seam gate — the milestone audit seated in the build loop ──────
// ONE shared block for both paths a seam slice takes (the fresh seal and the
// seal-skip resume, the all-sealed resume included): when the seam closed fact
// holds and audits.log lacks the seam line, the goal-backward audit runs before
// the loop advances. The gate rides the UNCHANGED reviewLoop under the same
// per-invocation reversibility cap the slice gates use; blocked is RECOVERABLE
// here — exit 11 lands on the reject class, since audit blockers reopen their
// owning slices through the Claude repair leg — and the kernel branches on its
// own reconcileAudit derivation over the published closed arrays, never on the
// wire verdict string. Returns null to advance, or the halting kernel result.
const auditSeam = async (slice) => {
  // One accepted audit per seam, checked by EXACT first-field match: the slice-id
  // charset admits dots, so each dot is BRE-escaped — a raw `^a.b ` anchor would
  // let a logged axb line suppress the legal seam a.b. Closed exit law: 0 is
  // logged (skip), 1 is PROVEN absence (a missing log normalizes to 1 before grep
  // can answer 2 for it); anything else — an unreadable log, a hands transport
  // failure — is an untrusted answer and HOLDS, because a re-audit over an unread
  // log could re-append an already-logged seam.
  const logged = await hands(
    'test -e .kiln/audits.log || exit 1; grep -q "^' + slice.replace(/\./g, '\\.') + ' " .kiln/audits.log',
    'audit:check')
  if (logged === 0) return null
  if (logged !== 1) {
    return failStop('transport-failure',
      { stage, active_slice: slice, next_action: 'Rerun stage build after fixing the transport: the audits.log membership check for slice ' + slice + ' did not answer' },
      await voiceBeat('transport-failure', {}, 'The audits.log check for slice ' + slice + ' returned no trustworthy answer — the run holds.', 1),
      { gate: P.audit })
  }
  // Receipt first: the auditor judges executed evidence, so the LAW check
  // receipt refreshes immediately before the initial audit on EVERY path. Red
  // takes the existing pre-seal door exactly — a sealed owner reopens, a
  // non-future red halts law-red — and no audit runs over a red law.
  const guard = await lawBeat(LAW_CHECK_RECEIPT, 'law:pre-audit')
  if (guard.exit !== 0) {
    const owner = await firstSealed(guard.ids)
    if (owner) return reopen(owner, 'pre-audit')
    if (!redSetIsFuture(guard.ids, slice, sliceIds)) {
      return failStop('law-red',
        { stage, active_slice: slice, next_action: 'Rerun stage build: the LAW is red at the milestone audit of slice ' + slice },
        'The law is red at the milestone audit of slice ' + slice + ' — no audit over a red law.')
    }
  }
  const auditorOpts = tier('reviewer-gate')
  // The kernel-owned derivation from the last parsed published verdict — the
  // promotion below demands the advance result AND an accept from THIS,
  // never the wire verdict alone.
  let derived = null
  let recheckRed = null
  const auditGate = async (mode) => {
    // The freshReceipt mirror: every recheck judges a fresh receipt; a sealed
    // or non-future red stashes for the after-loop reopen / law-red ruling.
    if (mode === 'recheck') {
      const again = await lawBeat(LAW_CHECK_RECEIPT, 'law:pre-audit-recheck')
      if (again.exit !== 0) {
        const owner = await firstSealed(again.ids)
        if (owner || !redSetIsFuture(again.ids, slice, sliceIds)) {
          recheckRed = again.ids
          return 20
        }
      }
    }
    // Closed facts only ride the argv: repo `.`, the cwd-relative kiln dir, the
    // seam slice id, and the reviewer-gate model and effort from the tier file
    // (the ratify-leg pattern). The recheck hands the published prior verdict
    // path as its own pre-recheck snapshot — the CLI reads the prior fully
    // before it writes the output path — plus the repair-delta path.
    const exit = await hands(
      mode === 'recheck'
        ? plugin + '/scripts/kiln-review audit-recheck . .kiln ' + slice + ' ' + auditorOpts.model + ' ' + auditorOpts.effort + ' ' + P.audit + ' ' + P.delta + ' ' + P.audit
        : plugin + '/scripts/kiln-review audit . .kiln ' + slice + ' ' + auditorOpts.model + ' ' + auditorOpts.effort + ' ' + P.audit,
      'audit:' + mode)
    if (exit === 0 || exit === 10 || exit === 11) {
      // The ONE sanctioned audit-verdict parse (the gate-file mirror): the
      // kernel rederives the verdict from the published closed arrays and
      // demands THREE-WAY agreement — derivation, wire exit, AND the published
      // verdict string (exit 0 over a `blocked` string is a disagreement the
      // exit alone cannot see). Invalid, a recompute mismatch, or a string
      // disagreement is the invalid-artifact wire law, transport-class, never
      // a promotion.
      const raw = await idsFetch('cat ' + P.audit, 'audit:read', 'a one-element array holding the exact audit verdict file contents printed on stdout, [] if exit != 0')
      if (raw.exit !== 0 || raw.ids.length !== 1) return 20
      let g
      try { g = JSON.parse(raw.ids[0]) } catch { return 20 }
      // Totality over the published bytes: JSON `null` parses clean, so the
      // object guard rules before any dereference.
      if (!g || typeof g !== 'object') return 20
      const d = reconcileAudit(g.findings, g.blockers)
      if (g.verdict !== d.verdict || verdictExit(d.verdict) !== exit) return 20
      derived = d.verdict
      // Blocked is recoverable at this gate — the canonical reopen edge: exit
      // 11 returns to the loop as the reject class and drives the same repair
      // plus recheck cycle a changes_required does.
      return exit === 11 ? 10 : exit
    }
    return exit
  }
  const loop = await reviewLoop({
    gate: auditGate,
    // The pinned prior cohort: the finding ids the published audit verdict carries.
    cohort: async () => {
      const c = await idsFetch(
        "node -p 'JSON.stringify((require(\"./" + P.audit + "\").findings||[]).map(f=>String(f.id)))'",
        'audit:findings', 'the printed JSON array of the current audit finding ids, [] if exit != 0',
      )
      return c.exit === 0 ? c.ids : null
    },
    // ONE fresh Claude leg, opposite-family to the GPT auditor, on the ACK
    // contract: a STATIC prompt of closed-safe paths only — the leg itself
    // reads the audit JSON and LAW.md (criterion ownership is LAW.md prose),
    // repairs the owning slices, and writes the repair delta. Seals stand:
    // a repaired sealed slice is never re-sealed.
    repair: async () => {
      const ack = await agent([
        'You are the milestone audit repair leg: a fresh mind repairing the audited milestone against the locked law.',
        'Project dir: ' + projectDir + '. Read the published audit verdict at ' + P.audit + ' and the locked law at ' + P.law + '.',
        'Repair the content the findings pin, slice by owning slice, blockers first. Criterion ownership is read from ' + P.law + '. Seals stand: never re-seal a repaired slice.',
        'Write the repair delta to ' + P.delta + ' describing every change. Then return { ok: true } — the ack carries no verdict; the audit recheck judges the repository.',
      ].join('\n'), { label: 'audit:repair', ...tier('builder-ui'), schema: ACK })
      if (!ack || ack.ok !== true) return false
      // The reviewLoop contract: a repair confirms only with its delta on disk —
      // the same `test -s` the slice-gate repair edge performs. An ACK without a
      // nonempty delta is repair-failed, never a recheck over nothing (the
      // recheck would reject the blank delta as transport and mask the truth).
      return await hands('test -s ' + P.delta, 'delta:check') === 0
    },
  }, cap)
  // A red pre-recheck rerun is a law fact, not a transport fact — the pre-seal
  // door rules it before any transport branch reads the result.
  if (recheckRed) {
    const owner = await firstSealed(recheckRed)
    if (owner) return reopen(owner, 'pre-audit-recheck')
    return failStop('law-red',
      { stage, active_slice: slice, next_action: 'Rerun stage build: the LAW went red during the milestone audit of slice ' + slice },
      'The law went red during the milestone audit of slice ' + slice + ' — no recheck over a red law.')
  }
  // Kernel-owned promotion: only the advance result AND an accept from the
  // kernel derivation append the audit fact — through the trusted CLI verb,
  // never a bare shell append. Then the loop continues past the seam.
  if (loop.result === 'sealed' && derived === 'accept') {
    if (await hands('node ' + plugin + '/scripts/kiln-review append-audit .kiln ' + slice, 'audit:append') !== 0) return persistFail('audit-append')
    return null
  }
  // Stop surfaces: the existing statuses, exactly as the build gate maps them.
  // Every next_action is a STATIC template interpolating only the seam slice
  // id, the pass count, and the audit artifact path — no verdict prose enters
  // STATE; the audit JSON is the operator detail surface.
  if (loop.result === 'blocked') {
    const found = await idsFetch(
      "node -p 'JSON.stringify((require(\"./" + P.audit + "\").findings||[]).map(f=>String(f.id)))'",
      'audit:findings', 'the printed JSON array of the current audit finding ids, [] if exit != 0',
    )
    beats.push(await voiceBeat('blocked', { passes: loop.repairs, ids: found.ids.join(', '), count: found.ids.length }, 'The gate held after ' + loop.repairs + ' repair passes — the ruling is yours.'))
    return stop('blocked',
      { stage, active_slice: slice, next_action: 'Operator ruling: the milestone audit held for slice ' + slice + ' after ' + loop.repairs + ' repair passes — the verdict is at ' + P.audit },
      { gate: P.audit, finding_ids: found.ids, passes: loop.repairs })
  }
  if (loop.result === 'degraded') {
    // The degraded hard-stop the slice gates take, with an audit-honest next
    // step: the milestone auditor has no single-family fallback, so the seam
    // waits on codex — the mark and the ack record the stop as ever.
    const db = await voiceBeat('degradation', {}, 'Codex is not answering — answer continue to proceed single-family.')
    if (await hands('touch ' + P.degraded + ' ' + P.ack, 'degraded:mark') !== 0) return persistFail('degraded-mark')
    beats.push(db)
    return stop('degraded', { stage, active_slice: slice, next_action: 'Restore codex, then relaunch stage build: the milestone audit of slice ' + slice + ' needs the second family' })
  }
  if (loop.result === 'gate-unreachable') {
    return failStop('gate-unreachable',
      { stage, active_slice: slice, next_action: 'Rerun stage build: the milestone audit gate tool is unreachable for slice ' + slice },
      await voiceBeat('gate-unreachable', {}, 'The gate tool would not run — not found or not executable where it lives, so codex was never reached and no verdict was possible.'),
      { gate: P.audit })
  }
  if (loop.result === 'repair-failed') {
    return failStop('repair-failed',
      { stage, active_slice: slice, next_action: 'Rerun stage build: the milestone audit repair pass did not land for slice ' + slice },
      'The milestone audit repair pass did not land for slice ' + slice + ' — the run holds.',
      { gate: P.audit })
  }
  // transport-failure — and, fail-closed, any advance whose derivation is not
  // accept — holds here: no verdict, no promotion.
  return failStop('transport-failure',
    { stage, active_slice: slice, next_action: 'Rerun stage build after fixing the transport: the milestone audit of slice ' + slice + ' published no usable verdict' },
    await voiceBeat('transport-failure', {}, 'The milestone audit call for slice ' + slice + ' returned no verdict — the run holds.'),
    { gate: P.audit })
}
let corrections = 0
for (const entry of slices) {
  const slice = entry.id
  const ordinal = slices.indexOf(entry) + 1
  const sealed = await hands('grep -q "^' + slice + ' " ' + P.seals + ' 2>/dev/null', 'seal:check')
  if (sealed === 0) {
    // W7-S2: a sealed seam slice can still owe its milestone audit — a resume
    // that sealed the seam without auditing re-fires here, the all-sealed
    // resume included; a logged seam skips inside the shared block.
    if (milestoneSeamAfter(milestones, ordinal - 1)) {
      const held = await auditSeam(slice)
      if (held) return held
    }
    continue
  }
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
    // S1 (A9): the milestone seam closed fact — true when this slice ends a milestone.
    // Carried with the slice for the W7 goal-backward audit; W5 does not audit here.
    seam: milestoneSeamAfter(milestones, ordinal - 1),
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
      // W6-03 runtime: a recheck must reuse the issued review_id and introduce no
      // out-of-cohort finding — the SAME request-scoped rule the codex transport
      // enforces. The kernel snapshots the prior published gate HERE, before the
      // reviewer runs: at this point P.gate still holds the prior verdict (the
      // content-free publish that overwrites it is the last act of this turn), so
      // one read yields the cohort — index 0 the prior review_id, the rest the
      // prior finding ids. A fresh review leaves both undefined, so gateReviewInvalid
      // skips the two checks and the pre-cohort behavior is unchanged. A failed
      // snapshot is transport-failure exit semantics, never a seal.
      let expectedReviewId, allowedFindingIds
      if (mode === 'recheck') {
        const prior = await idsFetch(
          "node -p 'JSON.stringify((g=>[String(g.review_id)].concat((g.findings||[]).map(f=>String(f.id))))(require(\"./" + P.gate + "\")))'",
          'recheck:cohort', 'a JSON array whose first element is the prior gate review_id and whose remaining elements are the prior finding ids, [] if exit != 0',
        )
        if (prior.exit !== 0 || prior.ids.length < 1) return 20
        expectedReviewId = prior.ids[0]
        allowedFindingIds = new Set(prior.ids.slice(1))
      }
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
      if (gateReviewInvalid(g, req.ids[0], expectedReviewId, allowedFindingIds) !== null) return 20
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
    // W6-07: the ui codex gate takes the cwd-relative repo arg `.` exactly as the LAW-ratify gate
    // does — hands runs with cwd = projectDir, and kiln-review resolves the request, the artifact,
    // and the diff against it. A bare projectDir interpolation would split a whitespace path into
    // extra argv and fail this fixed-arity gate. The keyed cap bounds the regenerate-slice edge.
    const loop = await reviewLoop({
      gate: freshReceipt(!wasDegraded && entry.surface === 'ui'
        ? (mode) => hands(gateCmd(mode, { plugin, repo: '.', request: P.request, gate: P.gate, priorGate: P.gate, delta: P.delta }), 'gate:' + mode)
        : claudeGate),
      // The pinned prior cohort for the strict-subset transition: the finding ids the freshly
      // published gate carries — the SAME fetch the repair reads (findings:fetch, the same P.gate
      // at the same loop phase), reused here as the closed cohort. A recheck must strictly shrink it
      // or recoveryDecision holds; the S1 recheck:cohort/allowedFindingIds already rejects an
      // out-of-cohort id at the gate, so this is content-blind over the closed id set alone.
      cohort: async () => {
        const c = await idsFetch(
          "node -p 'JSON.stringify((require(\"./" + P.gate + "\").findings||[]).map(f=>String(f.id)))'",
          'findings:fetch', 'the printed JSON array of the current gate finding ids, [] if exit != 0',
        )
        return c.exit === 0 ? c.ids : null
      },
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
    }, cap)
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
  // W7-S2: the seam gate fires after the fresh seal and its STATE write — the
  // milestone audit rules before the loop advances past the seam.
  if (facts.seam) {
    const held = await auditSeam(slice)
    if (held) return held
  }
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
