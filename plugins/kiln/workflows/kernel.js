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
// so kernel and transport agree. W8-S3: the OPTIONAL locationRule mirrors the
// validateShape relaxation the screen family carries in scripts/kiln-review — a screen
// finding pins an evidence path with an optional :frame, where a line number does not
// exist. Absent, the default path:line pattern preserves the baseline byte-for-byte.
// Returns the named violation, or null when the verdict
// is sound; any violation is transport-failure exit semantics, never a seal.
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
// ONCE per invocation. The dial leg carries recovery_cap alone at both law and build;
// this normalizes it STRICTLY — cap 2 only when the leg exited 0 AND the dial read recovery_cap
// EXACTLY 2 (the reversible profile), and every other value or a transport failure fails UP to
// cap 1 (fewer recovery edges precisely when the reading is least trustworthy, matching
// gauge-dial its own fail-up default). research-sweep carries a drift-pinned copy. Never throws.
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

// STATE.md is one page of closed facts the kernel owns, but the courier that persists
// it is a safety-tuned model — and a bash heredoc spelling out the whole ledger reads
// to it as forging a transition past validation, so it refuses (Defect B). The kernel
// therefore speaks only closed words to the trusted kiln-review state-commit verb: a
// transition token, a next-action KEY, and neutral facts. That verb owns the document,
// the hint prose and the clock; nothing moralizable rides the courier. The token names
// the kind of move — advance/seal-advance go forward, hold/degrade/boundary stop — and
// lets an unsupported transition fail closed.
function stateToken(status) {
  if (status === 'ok' || status === 'done') return 'advance'
  if (status === 'blocked' || status === 'held') return 'hold'
  if (status === 'degraded') return 'degrade'
  return 'boundary'
}

// The next-action KEY the courier carries in place of prose. Status is authoritative
// for the kind of stop; next_action disambiguates only the statuses carrying more than
// one operator hint — held (codex-restore vs operator-ruling vs failed repair), degraded
// (audit needs codex vs seal proceeds single-family), the onboarding transport failure —
// and picks the forward stage for an advance. kiln-review maps each key to its fixed hint.
// A "Rerun stage X" hint names its TARGET stage X, which may differ from the current
// stage — a build that finds no slice list must return to the LAW producer, not rerun
// build (a resume loop). Parse the target so the rendered hint routes correctly.
function rerunKey(nextAction) {
  const prefix = 'Rerun stage '
  if (nextAction.startsWith(prefix)) {
    const target = nextAction.slice(prefix.length).split(/[ :]/)[0]
    if (SPINE.includes(target)) return 'rerun-' + target
  }
  return 'rerun-stage'
}
function stateKey(status, nextAction) {
  switch (status) {
    case 'done': return 'run-complete'
    case 'ok': {
      const prefix = 'Relaunch the kernel workflow with stage='
      return nextAction.startsWith(prefix) ? 'relaunch-' + nextAction.slice(prefix.length) : 'run-complete'
    }
    case 'law-red': return 'reopen-slice'
    case 'blocked': return 'operator-ruling'
    case 'gate-unreachable': return 'restore-gate'
    case 'repair-failed': return 'repair-failed'
    case 'degraded': return /restore codex/i.test(nextAction) ? 'restore-codex' : 'acknowledge-degrade'
    case 'held':
      if (/^Operator ruling/.test(nextAction)) return 'operator-ruling'
      if (/restore codex/i.test(nextAction)) return 'restore-codex'
      if (/pass did not land/.test(nextAction)) return 'repair-failed'
      return rerunKey(nextAction)
    case 'transport-failure':
      return /^Rerun onboarding/.test(nextAction) ? 'rerun-onboarding' : rerunKey(nextAction)
    case 'slices-invalid': return rerunKey(nextAction)
    default: return rerunKey(nextAction)
  }
}

// The strict pointer grammar: a repo-relative path of safe characters only — no shell
// metacharacter, whitespace, or parent-escape. Agent-declared pointers are untrusted, so
// a malformed one is dropped before it can ride the courier command (Defect B1).
function safePointer(p) {
  return typeof p === 'string' && /^[A-Za-z0-9._/-]+$/.test(p) && !p.includes('..')
}
// The research-sweep shq contract: close a word in single quotes with any embedded quote
// escaped, so nothing a word contains can break out into live shell — belt to the grammar.
// Built with split/join rather than a quote-bearing regex literal, which the content-blind
// source scanner would misread as a string delimiter.
function shq(s) {
  return "'" + String(s).split("'").join("'\\''") + "'"
}
// The opaque state-commit courier command: only closed words, each single-quoted, and the
// pointers filtered to the strict grammar. active_slice sanitizes to none unless it is a
// real slice id (a stop with no valid slice names none); the trusted CLI re-validates
// every word and owns the STATE.md bytes.
function stateCommitCmd(plugin, token, stage, activeSlice, key, density, pointers) {
  const slice = activeSlice && /^[A-Za-z0-9._/-]+$/.test(activeSlice) ? activeSlice : 'none'
  const clean = pointers.filter(safePointer)
  return 'node ' + shq(plugin + '/scripts/kiln-review') + ' state-commit .kiln '
    + [token, stage, slice, key, density, ...clean].map(shq).join(' ')
}

// W2-S4: the ui codex gate argv carries the AUTHORITATIVE closed facts (the audit-verb pattern):
// repo, the cwd-relative kiln dir, the named slice, and the reviewer-gate model and effort from
// the validated tier file. The CLI derives law_hash and law_text from the sealed trio; the
// builder request rides only as non-authoritative hints. B01: validateTiers accepts any nonempty
// resolver value, so the model (and every other word) is shq-quoted — a resolver value carrying a
// shell metacharacter or whitespace becomes one inert argv word, never live shell nor a broken
// arity. The governing principle: nothing this verb builds ships unquoted.
function gateCmd(mode, p) {
  // W2-S7a (B-D1): the reviewer alias rides argv adjacent to the model — the durable tiers fact the
  // codex identity records as requested_alias, distinct from the resolved --model value.
  const words = [p.plugin + '/scripts/kiln-review', mode, p.repo, p.kilnDir, p.slice, p.model, p.alias, p.effort, p.request]
  if (mode === 'recheck') words.push(p.priorGate, p.delta)
  words.push(p.gate)
  return words.map(shq).join(' ')
}

// W2-S3 (C2 / B04 / ruling 2): the LAW check runs through the fused verify-and-run verb
// once a trio is sealed. These builders take the kiln-review path (the runtime resolves it
// from the plugin root; the pure core stays path-agnostic and testable, and shq quotes the
// path so a plugin root with a space stays one argv word — B05). SEAL REGIME by file presence:
// a sealed trio verifies-and-runs through run-checks — verification and the argv spawn of
// check.sh happen in ONE synchronous trusted verb under the run lock, with no model boundary
// between them (an OS-level path re-read is outside the W2 threat model; A01). A sealed law
// whose trio.hash is gone is a torn seal that holds (exit TRIO_MISMATCH); an unsealed law still
// authoring its trio runs check.sh bare, because there is nothing sealed to verify yet. The
// selection test only picks the regime — run-checks re-verifies the whole cross-bound seal it
// then runs, so swapping a file after the test fails closed inside the verb.
const TRIO_MISMATCH = 22
// B02: the presence of ANY of the three seal artifacts enters the sealed regime. A trio
// present verifies-and-runs; a lock.hash OR lock.seal without the trio is a partial seal that
// holds (TRIO_MISMATCH) — lock.seal-only residue can never fall through to the bare branch.
// check.sh runs bare ONLY when none of the three seal artifacts exist (a pre-seal law).
const sealedLawCheck = (kr) =>
  'if test -f .kiln/law/trio.hash; then node ' + shq(kr) + ' run-checks .kiln'
  + '; elif test -f .kiln/law/lock.hash || test -f .kiln/law/lock.seal; then printf "trio_mismatch\\n"; exit ' + TRIO_MISMATCH
  + '; elif test -f .kiln/law/check.sh; then bash .kiln/law/check.sh; fi'
// Pre-gate receipt: the kernel side has the hands, so it runs the sealed check itself and
// preserves the full output verbatim for the reviewer, who executes nothing. A subshell
// contains the regime `exit` so the receipt still cats and the exit code survives the capture.
const lawCheckReceipt = (kr) =>
  '( ' + sealedLawCheck(kr) + ' ) > .kiln/check-receipt.txt 2>&1; s=$?; cat .kiln/check-receipt.txt; exit $s'

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
  "let auth=[],state=0,ok=true,found=false;" +
  "for(const ln of lines){const t=ln.trim();const row=t.slice(0,1)===\"|\";" +
  "if(state===0){if(t.slice(0,3)===\"## \"&&t.slice(3).trim().toLowerCase()===\"plan\"){state=1;found=true;}continue;}" +
  "if(state===1){if(t.slice(0,1)===\"#\"){ok=false;break;}if(!row)continue;const c=t.split(\"|\").slice(1,-1).map(x=>x.trim());" +
  "if(c.length===2&&c[0].toLowerCase()===\"slice\"&&c[1].toLowerCase()===\"milestone\"){state=2;continue;}ok=false;break;}" +
  "if(state===2){const c=t.split(\"|\").slice(1,-1).map(x=>x.trim());" +
  "if(row&&c.length===2&&c.every(x=>/^:?-{3,}:?$/.test(x))){state=3;continue;}ok=false;break;}" +
  "if(!row)break;" +
  "const c=t.split(\"|\").slice(1,-1).map(x=>x.trim());if(c.length!==2){ok=false;break;}auth.push([c[0],c[1]]);}" +
  "process.exit(ok&&found&&auth.length>0&&JSON.stringify(proj)===JSON.stringify(auth)?0:1);'"

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
// the project root, proven lexically AND physically against the real root (W2-S8: the
// cell is LAW text a model wrote, so an absolute path, a parent escape, and a symlink
// that merely wears an inside name all fail alike; realpath also subsumes the existence
// check, since a path that does not resolve is not an existing repo path).
// COVERAGE: every slices.json entry with surface
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
  "const path=require(\"path\");const root=fs.realpathSync(\".\");" +
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
  "if(c[6]){const a=path.resolve(root,c[6]);let r=\"\";try{r=fs.realpathSync(a)}catch(e){}" +
  "if(!(a===root||a.slice(0,root.length+1)===root+path.sep)||!(r===root||r.slice(0,root.length+1)===root+path.sep))ok=false;}}" +
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
  // W2-S7a (B-D1): the alias is retained beside the resolved value as the durable tiers fact the
  // identity ledger records (requested_alias) — distinct from the concrete model a resolver change
  // could later remap. Every family carries it; the inherit seat has an alias but no concrete model.
  const opts = { effort: r.effort, alias: r.alias }
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
// UNQUOTED shell word at seal:append and in the audit argv — so whitespace, control
// bytes and shell-active bytes are rejected HERE, before any builder dispatch, never
// mid-build as a split seal append or an unpublishable audit. Slash is inside the set:
// path-like ids such as feature/ui are shell-word-safe.
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

// C5: seal membership is EXACT first-field equality, never a regex anchor — a dotted or
// kebab id (a.b vs a-b vs axb) is a distinct member. The ledger line is `<id> <label>`; the
// id carries no whitespace, so the first space-delimited field is the whole id.
const sealMembers = (lines) => new Set(
  (lines || []).map(l => String(l).split(' ')[0]).filter(Boolean)
)

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
  // W2-S4 (B04): the trusted gate facts the claude reviewer reads — the CLI writes the FILTERED
  // builder hints here (from hintsFrom), so the reviewer never reads the raw builder request.
  gateFacts: '.kiln/gate-facts.json',
  slices: '.kiln/slices.json', seals: '.kiln/seals.log', degraded: '.kiln/degraded',
  ack: '.kiln/degraded-ack', receipt: '.kiln/check-receipt.txt', report: '.kiln/report.md',
  candidate: '.kiln/.gate-review.reviewer.tmp',
  // W7-S2: the published milestone audit verdict — the audit-family gate file.
  audit: '.kiln/audit-review.json',
  // W8-S3: the screening-room artifacts — the published perceptual verdict (the
  // audit gate-file precedent), the bounded second-family escalation verdict, its
  // closed one-line record, and the semantic-hold marker the report stage reads.
  screen: '.kiln/screen-review.json', screenEscalation: '.kiln/screen-escalation.json',
  screenRecord: '.kiln/screen-escalation.txt', perceptualPartial: '.kiln/perceptual-partial',
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
// W3: the Gauge cap dial read — the same boot-style projection shape research-sweep reads the
// research dial through (research-sweep.js carries this shape under its own DIAL, keyed to the
// field it projects). The leg parses the JSON gauge-dial prints; the kernel body never does.
// additionalProperties stays true so the other dials pass through harmlessly. Law and build both
// read the reversibility-keyed recovery cap through this one schema and one leg.
// The validate perceptual dial leg does NOT ride this shape: it takes the CLOSED PERCEPTUAL_DIAL
// below, for the relay-integrity reason stated there. Two dial schemas, one open and one closed.
const DIAL = { type: 'object', additionalProperties: true, properties: { exit: { type: 'integer' }, recovery_cap: { type: 'integer' } }, required: ['exit'] }
// W1-S1 (INTAKE-29 / Defect A): the perceptual dial leg needs the perceptual field to SURVIVE
// the relay. DIAL carries it only through additionalProperties, so a leg that drops the field
// still validates and the kernel reads the absence as live (a phantom screening room). This
// closed schema REQUIRES all three fields with no additionalProperties, so a dropped perceptual
// fails the leg to the honest error fallback instead of a false live read. DIAL stays as-is for
// the cap read, which never branches on perceptual.
const PERCEPTUAL_DIAL = { type: 'object', additionalProperties: false, properties: { exit: { type: 'integer' }, perceptual: { type: 'string', enum: ['dormant', 'on', 'error'] }, recovery_cap: { type: 'integer', enum: [1, 2] } }, required: ['exit', 'perceptual', 'recovery_cap'] }

// W2-S1 (H2 / B01): the run lock JOIN. The conductor acquires the run lock ONCE before the
// sweep and passes run_id plus an opaque owner token in every launch; each kernel boot
// re-joins with the exact token BEFORE the tiers read or any stage work, so a second run on
// this project dir can never race over the shared .kiln files. A launch with no lock facts is
// a conductor contract violation (the conductor acquires before it ever launches a stage): a
// legacy resume that never acquired holds here, naming the missing facts, rather than run
// unlocked. A foreign lock is an honest hold naming the run that holds it; taking a stale lock
// over is the conductor decision at acquire, never a stage leg stealing a lock it cannot prove
// dead. These returns predate the tiers boot, so they speak kernel-owned lines (no voice read
// is possible yet), the same class as the tiers-config halt below.
if (typeof A.run_id !== 'string' || A.run_id.trim() === '' || typeof A.owner !== 'string' || A.owner.trim() === '') {
  return { status: 'run-unlocked', beat: 'This launch carries no run lock. Kiln takes the lock before the sweep and hands every stage its key; a stage that arrives without one will not share the project files blind. Relaunch through the conductor so the run holds its lock.', pointers: {} }
}
const joinCmd = 'node ' + shq(plugin + '/scripts/kiln-review') + ' run-lock join .kiln ' + [A.run_id, A.owner].map(shq).join(' ')
const joined = await agent(
  'Run exactly this in ' + projectDir + '. Report {exit, ids}: exit = the exit code; ids = the run_id the lock names as its owner when the join is refused (exit is nonzero), else []:\n' + joinCmd,
  { label: 'run-lock:join', schema: IDS },
).then(r => (r ?? { exit: 20, ids: [] }))
if (joined.exit !== 0) {
  const ownerTag = joined.ids && joined.ids[0] ? ' (run ' + joined.ids[0] + ')' : ''
  return { status: 'run-locked', beat: 'Another Kiln run holds the lock on this project' + ownerTag + '. I will not race a run that may still be live. If that run has ended, relaunch through the conductor and Kiln will take the stale lock over.', pointers: { lock: '.kiln/run.lock' } }
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

// W2-S7a (ruling A-prime): mint an attestation-bearing leg identity through the trusted CLI before
// each Claude dispatch — a mechanical idsFetch of identity-begin, the house idiom for a trusted CLI
// fact. The CLI appends the immutable intent and prints `<leg_id> <expected_label>`; the caller swaps
// that expected_label in as the dispatched agent label, so the leg is uniquely correlatable in the
// driver telemetry, and carries the leg_id into the seal, audit, or reviews reference. A failed or
// malformed mint returns null so the caller holds fail-closed — an unattested generation never seals.
const mintLeg = (role, alias, subject) => idsFetch(
  'node ' + shq(plugin + '/scripts/kiln-review') + ' identity-begin .kiln ' + shq(role) + ' ' + shq(alias) + ' ' + shq(subject),
  'identity:' + role,
  'a two-element array whose first element is the minted leg id and whose second is its expected label, both printed on one space-separated stdout line, [] if exit != 0',
).then(r => (r && r.exit === 0 && Array.isArray(r.ids) && r.ids.length === 2 && /^[0-9a-f]{32}$/.test(r.ids[0]) && r.ids[1] === 'leg:' + r.ids[0]) ? { legId: r.ids[0], label: r.ids[1] } : null)

// S4-D5: the degradation marker read as a TRI-STATE family-label authority. test -f
// answers 0 (present) or 1 (absent); anything else is an untrusted transport answer.
// The label callers map present to single-family and absent to dual; an untrusted read
// returns null so the caller HOLDS rather than seal a dual label it cannot trust. A
// path-selection read at the top of a stage may stay boolean (a nonzero read fails safe
// to the codex path); only these label-authority reads, reread at seal and append time,
// are tri-state — an unread marker must never resolve to dual.
// W2-S10d: this reads the marker to LABEL, never to select a seat, and it needs no ack gate: every
// call sits past the gate, which sits past the belt, so a marker still reaching here has a standing
// word behind it. That is a claim about control flow and is pinned as one in kernel.test.mjs.
const sealLabel = async (label) => {
  const e = await hands('test -f ' + P.degraded, label)
  return e === 0 ? 'single-family' : e === 1 ? 'dual' : null
}

// LAW beats report the owning slice ids on red (check.sh prints them; they
// arrive schema-forced — closed facts, never prose).
const lawBeat = (cmd, label) => idsFetch(cmd, label, 'the owning slice ids the check printed on stdout when exit != 0, else []')
// W2-S3: bind the fused check commands to this run plugin root. The pre-seal law authoring
// runs check.sh bare; every post-seal site runs run-checks, which re-verifies the sealed
// trio against law/trio.hash and only then executes check.sh (B04).
const LAW_CHECK = sealedLawCheck(plugin + '/scripts/kiln-review')
const LAW_GUARD = LAW_CHECK
const LAW_CHECK_RECEIPT = lawCheckReceipt(plugin + '/scripts/kiln-review')
// W2-S3 (B04): the all-three trio digest, in the fixed member order. A write-capable model
// turn (the degraded claude audit, the claude screen) is bracketed by this leg before and
// after — an unchanged digest across the turn proves the reviewer judged the sealed bytes it
// was handed and mutated none of the trio; a change fails the turn closed before any publish.
const trioDigest = (leg) => idsFetch(
  'sha256sum .kiln/LAW.md .kiln/law/check.sh .kiln/slices.json | cut -d" " -f1',
  leg, 'a three-element array of the 64-hex trio digests printed on stdout in order (LAW.md, check.sh, slices.json), [] if exit != 0')
// B04(b): the SEALED trio digests, read kernel-side from law/trio.hash. A write-capable turn
// binds its BEFORE digest (d0) to these — proof the reviewer judged the SEALED bytes, not
// merely a live state that stayed self-consistent across the turn; a drift already on disk
// before the turn is caught. The consuming verbs already validated the whole seal, so the
// trio.hash read here is coherent; a stray line yields a non-hex value that fails the equality.
const trioSealed = (leg) => idsFetch(
  "node -e 'const t=require(\"fs\").readFileSync(\".kiln/law/trio.hash\",\"utf8\").split(\"\\n\");process.stdout.write(JSON.stringify(t.slice(0,3).map(l=>String(l).split(\" \")[1]||\"\")))'",
  leg, 'a three-element array of the sealed trio digests from law/trio.hash in order (LAW.md, check.sh, slices.json), [] if exit != 0')

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
// W3: the ONE Gauge dial read. Law and build ask the same question — the reversibility-keyed
// recovery cap — so they share one prompt, one label and one schema rather than two legs that
// drifted apart once the width fork died. capFromDial fails the read up to cap 1 on any bad exit
// or missing field, so a transport failure spends fewer recovery edges, never more.
const capRead = () => agent(
  'Run exactly this in ' + projectDir + '. Report {exit, recovery_cap}: exit = the exit code; recovery_cap = the value of the "recovery_cap" field in the printed JSON dials object when exit is 0, omitted when exit is nonzero:\n' + 'node ' + plugin + '/scripts/gauge-dial.mjs',
  { label: 'cap:read', ...tier('kernel-leg'), schema: DIAL },
).then(x => (x ?? { exit: 20 }))

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
  // The courier carries a closed token + key, never next_action prose. The evidence
  // paths that used to sit inline in the prose — extra.gate (the screen/audit/gate
  // verdict) and extra.manifest (the held screen evidence generation) — now ride the
  // pointers so nothing the operator must open is lost. stateCommitCmd filters them to
  // the safe-path grammar, so a stray value can never reach the courier command.
  const evidence = extra ? [extra.gate, extra.manifest].filter((p) => typeof p === 'string') : []
  const pointers = [...new Set([...routes, ...evidence])]
  const cmd = stateCommitCmd(plugin, stateToken(status), fields.stage, fields.active_slice ?? 'none',
    stateKey(status, fields.next_action ?? ''), density, pointers)
  const w = await hands(cmd, 'state:write')
  if (w !== 0) return persistFail('state-write')
  return done(status, extra)
}
const nextAct = (s) => (s ? 'Relaunch the kernel workflow with stage=' + s : 'Run complete')
const reopen = async (owner, beatName) => {
  // W2-S7b (item 9): a reopen WITHDRAWS the slice before it stops. Without the cutoff the slice keeps
  // its rendered membership, the next boot skips it as sealed, and the reopen is a pure stop nothing
  // ever rebuilds (D1). The trusted verb derives the cutoff from the slices own candidate history and
  // is a no-op when an equal cutoff already stands, so a crash between it and the STATE write retries
  // onto the same answer. The owner always comes from firstSealed, so it is always in SEALS and always
  // has a candidate history. Nothing rebuilds in this invocation: every call site returns this stop.
  const cut = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' invalidate .kiln ' + shq(owner), 'seal:invalidate')
  if (cut !== 0) return persistFail('seal-invalidate')
  beats.push(await voiceBeat('reopen', { slice: owner }, 'Slice ' + owner + ' reopened — a law check went red at ' + beatName + '.'))
  return stop('law-red', {
    stage, active_slice: owner, next_action: 'Reopen slice ' + owner + ': LAW is red at ' + beatName,
  })
}
const failStop = (status, fields, line, extra) => {
  beats.push(line)
  return stop(status, fields, extra)
}
// Marker lifecycle: .kiln/perceptual-partial is written ONLY on a semantic perceptual hold (one
// writer in the shipped plugin, the touch tagged perceptual:marker; cards and SKILL.md read its
// presence, never write it) and REMOVED on every terminal nonsemantic validate path — ok (dormant
// or live-accept), the law-red reopen doors and the torn-trio doors (each at both preflight and
// stage end), the ledger-reconcile and seal-ledger read holds, capture-act failure, the six
// screening-room holds (manifest and family reads, degraded, gate-unreachable, repair-failed,
// transport-failure), addendum failure. Fifteen clear sites, count-pinned. A marker never outlives
// the conclusion it describes. A failed removal surfaces as persist-failed, never a stale marker.
const clearPerceptualMarker = async () => {
  if (await hands('rm -f ' + P.perceptualPartial, 'perceptual:marker-clear') !== 0) return persistFail('perceptual-marker-clear')
  return null
}

// W2-S6 (B06): reconcile the rendered seal and audit projections from their JSONL truth BEFORE the
// membership reads below. A crash between a prior JSONL append and its .log render, or a project
// sealed under W1 before the ledger existed, is healed here idempotently — the content-blind verb
// re-renders each .log from its JSONL (migrating a legacy log into JSONL first) and never rebuilds
// sealed work. sealMembers and the audit grep then always read a current-valid projection.
const reconciled = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' reconcile .kiln', 'ledger:reconcile')
if (reconciled !== 0) {
  // W2-S11 (B3): coverage, not a new rule — a terminal validate hold clears the marker here as it
  // already does at the law-red doors, so no marker outlives the conclusion it describes.
  if (stage === 'validate') {
    const pf = await clearPerceptualMarker()
    if (pf) return pf
  }
  return failStop('transport-failure',
    { stage, active_slice: 'none', next_action: 'Rerun the stage after fixing the transport: the seal and audit ledgers could not be reconciled from their JSONL truth' },
    await voiceBeat('transport-failure', {}, 'The seal and audit ledgers could not be reconciled from their JSONL truth — the run holds rather than read a stale projection.', 1))
}
// C5+M5: the seal ledger, read ONCE per kernel invocation into an exact-membership Set. This
// replaces the two unescaped `^<id> ` greps (a dotted id false-matched a kebab twin) AND the
// per-slice grep + indexOf hot loop (M5). An unreadable ledger is untrusted — every membership
// and reopen-ownership decision this invocation would be unreliable, so the run HOLDS fail-closed
// rather than rebuild sealed work or miss a reopen. An absent ledger is a legitimately empty set.
const sealLeg = await idsFetch(
  "node -e 'const fs=require(\"fs\");let t=\"\";try{t=fs.readFileSync(" + JSON.stringify(P.seals) + ",\"utf8\")}catch(e){if(e.code!==\"ENOENT\")process.exit(1)}process.stdout.write(JSON.stringify(t.split(\"\\n\").filter(Boolean)))'",
  'seal:set',
  'the printed JSON array of the raw non-empty lines of the seal ledger; an absent ledger prints [] at exit 0 and only a genuine read fault exits nonzero',
)
if (sealLeg.exit !== 0) {
  if (stage === 'validate') {
    const pf = await clearPerceptualMarker()
    if (pf) return pf
  }
  return failStop('transport-failure',
    { stage, active_slice: 'none', next_action: 'Rerun the stage after fixing the transport: the seal ledger at ' + P.seals + ' could not be read' },
    await voiceBeat('transport-failure', {}, 'The seal ledger could not be read — the run holds rather than risk rebuilding sealed work or missing a reopen.', 1))
}
const SEALS = sealMembers(sealLeg.ids)
// W2-S7a (F1): the boot-time sealed membership. SEALS is rendered membership only — the boot read,
// never live-added within an invocation (B-PROVISIONAL-LIVE) — so this snapshot equals SEALS for the
// whole run and every milestone-audit decision can rest on it. A covered slice absent from the
// snapshot is being rebuilt now and holds only a provisional candidate, so the seam neither honours a
// rendered audit over it nor dispatches a fresh one: it relaunches (W2-S7b item 11). Seal rendering is
// deferred to the conductor capture, so the audit projection can lead the seal projection across a
// crash — this snapshot is what stops that desync from ever buying a skip.
const SEALS_AT_BOOT = new Set(SEALS)
// W-04: rerun-reopen binds to SEALED checks (locked BEHAVIOR). A red owned by an unsealed slice
// is expected pre-build state — the criteria describe the finished artifact. Only a red whose
// owner sits in the seal ledger reopens. Membership is exact first-field equality over the SEALS
// set. W2-S7a (B-PROVISIONAL-LIVE): SEALS reflects RENDERED membership only — the boot read, never
// live-added. A this-run seal is provisional until the conductor capture promotes it, so it is not a
// member here; it becomes one on the next boot, and firstSealed never counts an unattested seal.
const firstSealed = async (ids) => ids.find(id => SEALS.has(id)) ?? null
// W2-S3 (B04 / ruling 2): the fused run-checks verb exits TRIO_MISMATCH when a sealed trio
// file no longer matches law/trio.hash. Every post-seal check site holds fail-closed on it —
// a tampered or torn trio is never treated as a mere law red, and check.sh never ran.
const trioMismatchHold = async (activeSlice) => failStop('transport-failure',
  { stage, active_slice: activeSlice, next_action: 'Rerun the stage after restoring the sealed law: a law/trio.hash member no longer matches its sealed digest' },
  await voiceBeat('transport-failure', {}, 'A sealed law file no longer matches its trio.hash digest — the run holds rather than judge tampered law.', 1))

const cardPrompt = (extra) => [
  'You are a Kiln stage agent. Read and follow the stage card at ' + P.card(stage) + ' exactly.',
  'Project dir: ' + projectDir + '. Artifacts live under .kiln/ (LAW at ' + P.law + ').',
  'Voice: fill your beat from ' + plugin + '/data/voice.json templates; prefill every semantic slot; leave kernel-owned slots (' + KERNEL_SLOTS.map(k => '{' + k + '}').join(' ') + ') unfilled.',
  'Density: ' + density + ' — a slot-fill rule, never a structure: broad fills slots with the plain reader-meaningful version, engineer fills the same slots with file paths, ids, and counts.',
  extra,
  'Return {facts:{status, pointers, schema_valid}, narration_beat} — facts.status is "ok" when the stage succeeded, facts.pointers lists every artifact path you wrote, facts.schema_valid is true when your declared outputs are well-formed, and narration_beat is your one-line beat.',
].filter(Boolean).join('\n')

// ── W8-S3: the screening room — closed commands and helpers for the validate seat ──
// Presence only: a GFM `## Perceptual` heading in the SEALED LAW.md — S1 already
// validated the full table shape at LAW time, pre-seal, so this exit fact feeds the
// gauge-dial --visual flag and nothing else. Any read failure reads as absent; the
// dial fail-up doctrine still outranks the flag on a malformed posture.
const PERCEPTUAL_PRESENCE =
  "node -e 'const fs=require(\"fs\");let f=false;" +
  "try{for(const ln of fs.readFileSync(\"./.kiln/LAW.md\",\"utf8\").split(\"\\n\")){const t=ln.trim();" +
  "if(t.slice(0,3)===\"## \"&&t.slice(3).trim().toLowerCase()===\"perceptual\"){f=true;break;}}}catch(e){}" +
  "process.exit(f?0:1);'"
// CURRENT generation = the highest .kiln/evidence/gen-<n> dir containing a valid
// manifest.json (the rule scripts/kiln-review currentGeneration applies),
// printed as the manifest path — the one closed handle every screening leg shares.
// A manifest-less dir is crash residue: it occupies its number and is never selected.
const CURRENT_MANIFEST =
  "node -e 'try{const fs=require(\"fs\");const root=\".kiln/evidence\";let best=-1;" +
  "for(const n of fs.readdirSync(root)){const m=/^gen-(\\d+)$/.exec(n);if(!m)continue;const g=Number(m[1]);if(g<=best)continue;" +
  "try{const b=JSON.parse(fs.readFileSync(root+\"/gen-\"+g+\"/manifest.json\",\"utf8\"));if(b&&typeof b===\"object\"&&!Array.isArray(b))best=g;}catch(e){}}" +
  "if(best<0)process.exit(1);console.log(root+\"/gen-\"+best+\"/manifest.json\");process.exit(0);}catch(e){process.exit(1)}'"
// The fetched manifest path rides prompts and further commands, so it is shape-gated
// to the exact closed form the allocator produces before it rides anywhere.
const MANIFEST_PATH = /^\.kiln\/evidence\/gen-\d+\/manifest\.json$/
// The family rule (plan F), a closed three-way exit fact: 0 = some perceptual owner
// carries surface ui (Opus-built pixels — the GPT screen verbs grade), 1 = PROVEN
// all-logic/mixed owners (GPT-coded rendering — the Claude leg grades), anything else
// is an untrusted answer and holds transport-class. W2-S3 (B04): the family and the criterion
// ownership key both derive over the VERIFIED trio through the fused kiln-review verbs
// (perceptual-family, screen-criteria) — the raw node -e legs that read LAW.md/slices.json
// unverified are retired, so the write-capable screen routing rests on sealed bytes.
// The pre-spawn BELT (plan G): a deterministic completeness check over the CURRENT
// manifest — required classes, keyframe/reference/image bounds, matching counts,
// recorded runtimes, gen number equal to its dir, every named file a REGULAR file
// whose realpath stays inside the generation dir (the scripts/kiln-review
// screenEvidence rule: a symlink pointing out is an outside path wearing an inside
// name — realpath containment keeps both family paths on the same admissible
// evidence boundary). The act contract (plan E) makes a violation unreachable; when
// one fires anyway the gate holds transport-class before any grader spawns. The
// manifest path rides argv, shape-gated by MANIFEST_PATH above.
const PERCEPTUAL_BELT =
  "node -e 'try{const fs=require(\"fs\"),path=require(\"path\");" +
  "const mf=process.argv[1];const dir=path.dirname(mf);" +
  "const m=JSON.parse(fs.readFileSync(mf,\"utf8\"));" +
  "if(!m||typeof m!==\"object\"||Array.isArray(m))process.exit(1);" +
  "if(m.generation!==Number((/^gen-(\\d+)$/.exec(path.basename(dir))||[])[1]))process.exit(1);" +
  "const rt=m.runtimes||{};if([\"playwright\",\"ffmpeg\"].some(k=>typeof rt[k]!==\"string\"||rt[k].trim()===\"\"))process.exit(1);" +
  "const f=m.files||{};const ent=n=>typeof f[n]===\"string\"&&f[n].trim()!==\"\"?f[n]:null;" +
  "const list=n=>Array.isArray(f[n])&&f[n].every(p=>typeof p===\"string\"&&p.trim()!==\"\")?f[n]:null;" +
  "const req=[\"meta\",\"dom\",\"console\",\"viewport_desktop\",\"viewport_mobile\",\"film\"].map(ent);" +
  "if(req.some(x=>x===null))process.exit(1);" +
  "const kf=list(\"keyframes\");if(!kf||kf.length<1||kf.length>6)process.exit(1);" +
  "const refs=f.references===undefined?[]:list(\"references\");if(!refs||refs.length>2)process.exit(1);" +
  "const imgs=2+kf.length+refs.length;if(imgs>10)process.exit(1);" +
  "const c=m.counts||{};if(c.keyframes!==kf.length||c.references!==refs.length||c.images!==imgs)process.exit(1);" +
  "const droot=path.resolve(dir);const dreal=fs.realpathSync(droot);" +
  "for(const p of req.concat(kf,refs)){const a=path.resolve(dir,p);" +
  "if(a.slice(0,droot.length+1)!==droot+path.sep)process.exit(1);" +
  "const r=fs.realpathSync(a);if(!fs.statSync(r).isFile())process.exit(1);" +
  "if(r.slice(0,dreal.length+1)!==dreal+path.sep)process.exit(1);}" +
  "process.exit(0);}catch(e){process.exit(1)}'"
// The screen-family location relaxation, mirrored byte-for-byte from the
// scripts/kiln-review SCREEN_LOCATION pattern: a screen finding pins an evidence path
// with an OPTIONAL :frame — a viewport capture has no line number.
const SCREEN_LOCATION_RULE = /^[^:]+(?::\d+)?$/

// LAW rerun beat: at every kernel invocation start (resume), if the check
// exists. Red reopens only a sealed owner; otherwise the run proceeds.
const pre = await lawBeat(LAW_GUARD, 'law:preflight')
if (pre.exit === TRIO_MISMATCH) {
  if (stage === 'validate') {
    const pf = await clearPerceptualMarker()
    if (pf) return pf
  }
  return trioMismatchHold('none')
}
if (pre.exit !== 0) {
  const owner = await firstSealed(pre.ids)
  if (owner) {
    // W8-S3 (DELTA-10): a law-red reopen concludes a validate invocation, and it is
    // nonsemantic — the marker clears BEFORE the reopen lands, at this door and at
    // stage end, so a stale hold marker never outlives a later validate conclusion.
    if (stage === 'validate') {
      const pf = await clearPerceptualMarker()
      if (pf) return pf
    }
    return reopen(owner, 'resume')
  }
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
  let r
  // W6-F: the reversibility-keyed recovery cap, threaded into the LAW-ratify loop below. It stays
  // 1 on the report path (unused there) and is set from the single dial read a law or validate
  // invocation makes.
  let cap = 1
  // W8-S3 (plan C): the validate activation — one closed table-presence check over the
  // SEALED LAW.md feeds the gauge-dial --visual flag, and ONE dial leg (the CLOSED
  // PERCEPTUAL_DIAL, never the open cap-read DIAL) returns perceptual + recovery_cap — one
  // read, two facts. Dormant
  // is the SOLE skip result — exit 0 AND perceptual dormant — and keeps the single-act
  // validate byte-identical; every other value or a transport failure fails UP to the
  // live screening machinery (the gauge-dial malformed-posture fail-up arrives
  // through the same door).
  let perceptual = false
  // W1-S1 (INTAKE-29 / Defect A): the screening activation CEILING. visualTable is the closed
  // fact that the sealed LAW actually carries a ## Perceptual table — the same presence read that
  // feeds --visual. Screening opens only on perceptual AND visualTable, so a non-visual project
  // can never reach the manifest gate even if a dial fail-up or a relay drop makes the read live;
  // the phantom screening room stays shut on a project that has no perceptual table at all.
  let visualTable = false
  if (stage === 'validate') {
    const visual = await hands(PERCEPTUAL_PRESENCE, 'perceptual:presence') === 0
    visualTable = visual
    const dialLeg = await agent(
      'Run exactly this in ' + projectDir + '. Report {exit, perceptual, recovery_cap}: exit = the exit code. On exit 0, perceptual = the value of the "perceptual" field and recovery_cap = the value of the "recovery_cap" field in the printed JSON dials object. On a nonzero exit or unparseable output, report perceptual "error" and recovery_cap 1:\n' + 'node ' + plugin + '/scripts/gauge-dial.mjs --visual ' + (visual ? 'true' : 'false'),
      { label: 'perceptual:dial', ...tier('kernel-leg'), schema: PERCEPTUAL_DIAL },
    ).then(x => (x ?? { exit: 20, perceptual: 'error', recovery_cap: 1 }))
    perceptual = !(dialLeg.exit === 0 && dialLeg.perceptual === 'dormant')
    cap = capFromDial(dialLeg)
  }
  if (stage === 'law') {
    // The law dial read exists for the recovery cap alone — it is the one dial read a law
    // invocation makes, through the same leg the build stage uses.
    cap = capFromDial(await capRead())
  }
  r = await act(cardPrompt(A.idea ? 'Operator idea (verbatim): ' + A.idea : ''), 'stage:' + stage)
  // S1 ruling: reachable twin sites read their sealed keys; the kernel lines
  // below survive only as unreachable-voice fallbacks (W-03). W8-S3: on validate this
  // door is also the capture-act failure (the act contract is a COMPLETE manifest or
  // an honest not-ok) — a terminal nonsemantic path, so the marker is removed first.
  if (r.facts.status !== 'ok') {
    if (stage === 'validate') {
      const pf = await clearPerceptualMarker()
      if (pf) return pf
    }
    return failStop('transport-failure', { stage, next_action: 'Rerun stage ' + stage }, await voiceBeat('transport-failure', {}, 'The ' + stage + ' stage did not return sound work — the run holds.', 1))
  }
  for (const p of r.facts.pointers) routes.add(p)
  // Wave 1 (the Second Key): the LAW stage is content-blind-gated before it can
  // lock. The card produced the candidate LAW; a fresh OPPOSITE-family mind now
  // ratifies it against the architecture-feasibility rubric (reviewLoop + the
  // kiln-review `ratify` verb), and only on accept does the kernel seal the LAW
  // (the opaque `seal-law` verb) and let build begin. Codex unavailable is the
  // acknowledgment stop, and the acked re-run ratifies single-family through the
  // claude seat, honestly labeled; a reviewer block or non-convergence stays the
  // operator HELD.
  if (stage === 'law') {
    // A2: the LAW card beat asserts the law is SEALED and build starts (cards/law.md),
    // so it must NEVER reach the transcript on a HELD — that would read "sealed… build
    // starts" above the honest hold line, a self-contradicting record. BUFFER the latest
    // candidate beat (a repair regenerates the whole LAW, so its beat replaces the prior
    // one) and emit it ONLY after a successful ratify AND seal; every held/halt path
    // emits its own line alone.
    let candidateBeat = r.narration_beat
    // S4 (INTAKE-38, the recovered no-codex pathway): the ratify TRANSPORT degrades to
    // the claude family when codex is down, never the ratification itself. A tri-state
    // path-selector read of the degradation marker chooses the seat — absent selects the
    // cross-family codex ratifier (the normal dual key), present selects a fresh OPUS
    // claude ratifier (opposite model, same family) that mirrors the codex packet,
    // digest, echo and lineage rules exactly and seals honestly single-family.
    // W2-S10d: the marker records a DETECTION; the ack records the operator word. A
    // detection nobody has answered must not select a seat, so it takes the stage own
    // degraded stop below — the stop that asks for the word — and the acked relaunch
    // selects honestly. Without this the builder-written marker (cards/build.md) would
    // route a joined relaunch straight to the single-family seat with no word anywhere.
    // W2-S10d (B3): ONE stop body, called by the guard below and by the detection arm — mark is
    // what the arm needs and the guard does not, the marker already standing by then.
    const lawDegradedStop = async (mark) => {
      const db = await voiceBeat('degradation', {}, 'Codex is not answering — answer continue to proceed single-family.')
      if (mark && await hands('touch ' + P.degraded, 'degraded:mark') !== 0) return persistFail('degraded-mark')
      beats.push(db)
      return stop('degraded', { stage, active_slice: 'none', next_action: 'Acknowledge single-family degradation, then relaunch stage law' })
    }
    const degraded = await hands('test -f ' + P.degraded, 'law:degraded') === 0
    if (degraded && await hands('test -f ' + P.ack, 'law:degraded-ack') !== 0) return lawDegradedStop(false)
    const ratifyOpts = degraded ? tier('fallback-reviewer') : tier('ratify-reviewer')
    // The claude ratify leg (the claudeGate mirror): the kernel computes the candidate
    // LAW digest BEFORE the reviewer turn, the opus reviewer echoes it as law_hash, and
    // the kernel rejects a mismatched echo. Because a claude agent CAN write files —
    // unlike the read-only codex -C sandbox — the kernel RECOMPUTES the LAW digest AFTER
    // the turn and confirms it unchanged; a tampered law is a transport failure, never a
    // publish or a seal. A recheck snapshots the prior cohort exactly as claudeGate does.
    const claudeRatify = async (mode) => {
      const d0 = await idsFetch('sha256sum ' + P.law + ' | cut -d" " -f1', 'ratify:digest', 'a one-element array holding the 64-hex candidate law digest printed on stdout, [] if exit != 0')
      if (d0.exit !== 0 || d0.ids.length !== 1 || !LAW_HASH.test(d0.ids[0])) return 20
      const candidateDigest = d0.ids[0]
      let expectedReviewId, allowedFindingIds
      if (mode === 'recheck') {
        const prior = await idsFetch(
          "node -p 'JSON.stringify((g=>[String(g.review_id)].concat((g.findings||[]).map(f=>String(f.id))))(require(\"./" + P.gate + "\")))'",
          'ratify:recheck-cohort', 'a JSON array whose first element is the prior gate review_id and whose remaining elements are the prior finding ids, [] if exit != 0')
        if (prior.exit !== 0 || prior.ids.length < 1) return 20
        expectedReviewId = prior.ids[0]
        allowedFindingIds = new Set(prior.ids.slice(1))
      }
      if (await hands('rm -f ' + P.candidate, 'ratify:invalidate') !== 0) return 20
      // W2-S7a: mint the ratifier leg and dispatch under its reserved label; the leg rides the
      // publish-gate argv below so the ratify verdict on reviews.jsonl carries its reviewer identity.
      const ratifyLeg = await mintLeg('ratifier', ratifyOpts.alias, 'law-ratify')
      if (!ratifyLeg) return 20
      // W2-S7a (FORK 1): compose the artifact-ratify contract (the candidate LAW text and digest, the
      // rubric criteria) through the trusted verb before dispatch; the digest threads into the prompt
      // and the publish-gate binding. A recheck rides the prior gate for its finding cohort.
      const rc = await idsFetch(
        'node ' + shq(plugin + '/scripts/kiln-review') + ' contract-prepare ' + shq('.') + ' .kiln artifact-ratify ' + (mode === 'recheck' ? 'recheck' : 'initial') + ' ratify ' + shq(P.law) + (mode === 'recheck' ? ' ' + shq(P.gate) : ''),
        'ratify:contract', 'a one-element array holding the canonical contract sha256 printed on stdout, [] if exit != 0')
      if (rc.exit !== 0 || rc.ids.length !== 1 || !LAW_HASH.test(rc.ids[0])) return 20
      const ratifyContract = rc.ids[0]
      const ack = await agent([
        'You are the LAW ratify reviewer: a fresh mind judging the candidate law against the architecture-feasibility rubric.',
        'The canonical contract at .kiln/contracts/sha256/' + ratifyContract + '.json is the COMPLETE authoritative facts for this ratification — the artifact text, its candidate digest, and the rubric criteria. Judge exactly that contract.',
        'Project dir: ' + projectDir + '. Read the candidate law at ' + P.law + ' and the ratify rubric at ' + plugin + '/data/law-rubric.json.',
        'Judge the law against every rubric dimension. Execute nothing — no commands, no tests, no builds: the law is a plan, judged as text. Change no file: judge the law, never edit it.',
        mode === 'recheck'
          ? 'Read and reuse the prior review_id from ' + P.gate + ' first. Recheck only the finding ids in ' + P.gate + ' against the regenerated law. Preserve each unresolved finding id; never add one. Accept only when every listed finding is repaired.'
          : 'Report only substantiated rubric violations at exact repo-relative path:line locations with stable finding ids. Verdict rules: accept only when findings and blockers are both empty; changes_required only for repairable findings with no blockers; blocked only when the review cannot complete, with blocker reasons. Mint a fresh review_id.',
        'Set law_hash to exactly ' + candidateDigest + ' — the sha256 of the candidate law you judged; copy it verbatim so it binds this verdict to those bytes.',
        'Compose the verdict object per ' + plugin + '/scripts/review-schema.json, and as the FINAL act of your turn write it as JSON to ' + P.candidate + '. Then return { ok: true } — the ack carries no verdict; the kernel reads and validates the file you wrote.',
      ].join('\n'), { label: ratifyLeg.label, ...ratifyOpts, schema: ACK })
      if (!ack || ack.ok !== true) return 20
      const raw = await idsFetch('cat ' + P.candidate, 'ratify:read', 'a one-element array holding the exact candidate file contents printed on stdout, [] if exit != 0')
      if (raw.exit !== 0 || raw.ids.length !== 1) return 20
      let g
      try { g = JSON.parse(raw.ids[0]) } catch { return 20 }
      if (gateReviewInvalid(g, candidateDigest, expectedReviewId, allowedFindingIds) !== null) return 20
      // S4-D1: the write-capable turn tamper check — the LAW bytes the reviewer judged
      // must still be the bytes on disk. A changed digest means the ratifier rewrote the
      // very law it graded; the kernel holds the transport and never publishes or seals.
      const d1 = await idsFetch('sha256sum ' + P.law + ' | cut -d" " -f1', 'ratify:digest-confirm', 'a one-element array holding the 64-hex candidate law digest printed on stdout, [] if exit != 0')
      if (d1.exit !== 0 || d1.ids.length !== 1 || d1.ids[0] !== candidateDigest) return 20
      // W2-S5: the content-free publish routes through the trusted archive-then-publish verb —
      // it reads the candidate bytes, appends the validated verdict to the immutable ledger, then
      // renames the candidate over the gate file. The kernel stays content-blind; a failed archive
      // fails closed (nonzero) and the ratify holds, never publishing an un-archived verdict.
      const w = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' publish-gate .kiln ratify ' + P.candidate + ' ' + P.gate + ' ' + shq(ratifyLeg.legId) + ' ' + shq(ratifyContract), 'ratify:publish')
      return w === 0 ? verdictExit(g.verdict) : 20
    }
    // Content-blind request write: the kernel cannot author files, so it ships the
    // ratify request as a heredoc of closed facts through a mechanical hand — the
    // same shape as the STATE.md write — and branches only on the exit code. The
    // review_id is kernel-issued (the ratify verb expects the caller to supply it,
    // unlike a slice review, which mints its own), the reviewer is the opposite-
    // family ratify-reviewer tier, and the artifact is the repo-relative LAW, which
    // the verb resolves against the repo and proves contained before it opens it.
    // W2-S8: the request names no rubric — the ratify family word on the verb argv
    // below selects the shipped instrument, so this file cannot point the grader
    // anywhere.
    const ratifyReq = JSON.stringify({
      review_id: 'law-ratify', reviewer_model: ratifyOpts.model, reviewer_alias: ratifyOpts.alias, reviewer_effort: ratifyOpts.effort,
      artifact: P.law,
    })
    const writeReq = [
      'set -e', 'mkdir -p .kiln',
      "cat > .kiln/.ratify-request.tmp <<'KILN_RATIFY_EOF'", ratifyReq, 'KILN_RATIFY_EOF',
      'mv -f .kiln/.ratify-request.tmp ' + P.ratifyRequest,
    ].join('\n')
    // The codex path alone carries a request file; the claude leg reads the rubric itself.
    if (!degraded && await hands(writeReq, 'ratify:request') !== 0) return persistFail('ratify-request')
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
      gate: degraded
        ? (mode) => claudeRatify(mode)
        : (mode) => hands(
            mode === 'recheck'
              ? plugin + '/scripts/kiln-review ratify-recheck . .kiln ' + P.ratifyRequest + ' ' + P.gate + ' ' + P.gate + ' ratify'
              : plugin + '/scripts/kiln-review ratify . .kiln ' + P.ratifyRequest + ' ' + P.gate + ' ratify',
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
      // seal-law is the only sealer on the kernel side: it digests LAW.md and writes
      // law/lock.hash, plus the digest-bound lock.seal label sidecar. The family label is
      // reread tri-state AT SEAL TIME (S4-D5): absent seals dual, present single-family,
      // an untrusted read HOLDS rather than seal a label it cannot trust.
      const sealFamily = await sealLabel('law:seal-label')
      if (sealFamily === null) {
        return failStop('transport-failure',
          { stage, active_slice: 'none', next_action: 'Rerun stage law after fixing the transport: the degradation marker gave no trustworthy answer at the LAW seal' },
          await voiceBeat('transport-failure', {}, 'The degradation marker gave no trustworthy answer at the LAW seal — the run holds rather than seal an untrusted family label.'),
          { law: P.law })
      }
      if (await hands('node ' + plugin + '/scripts/kiln-review seal-law .kiln ' + sealFamily, 'law:seal') !== 0) return persistFail('law-seal')
      // Only now, past ratify AND seal, does the SEALED-claiming card beat speak.
      beats.push(fillClosed(candidateBeat, stageFacts))
    } else if (ratifyLoop.result === 'degraded') {
      // S4-D2: the FIRST codex-down detection is the acknowledgment stop, mirroring the
      // build and audit stops — persist the degraded marker ALONE, push the degradation
      // beat, and return the distinct degraded stop. Detection never writes the ack: the
      // ack is the operator word, and only the conductor writes it, on continue. The
      // acked re-run enters with both files and ratifies single-family through the
      // claude seat above.
      return lawDegradedStop(true)
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
  // ── W8-S3: the screening room — the perceptual gate seated in validate (plans F/G/H/I).
  // Live only: the dormant run never reaches this block and stays byte-identical. Act 1
  // already held a COMPLETE manifest or took the act-failure door above; the loop below
  // is the 4th reviewLoop wiring — reviewLoop, recoveryDecision and strictSubsetProgress
  // are consumed UNTOUCHED, and the kernel writes no files (trusted CLI + hands legs).
  if (stage === 'validate' && perceptual && visualTable) {
    // The CURRENT manifest — the one closed handle: the belt checks it, the digest
    // binds to it, the recheck delta names it, and the recapture repair refreshes it.
    const mf0 = await idsFetch(CURRENT_MANIFEST, 'perceptual:manifest', 'a one-element array holding the CURRENT generation manifest path printed on stdout, [] if exit != 0')
    if (mf0.exit !== 0 || mf0.ids.length !== 1 || !MANIFEST_PATH.test(mf0.ids[0])) {
      const pf = await clearPerceptualMarker()
      if (pf) return pf
      return failStop('transport-failure',
        { stage, next_action: 'Rerun stage validate: no CURRENT evidence generation manifest under .kiln/evidence' },
        await voiceBeat('transport-failure', {}, 'The sealed LAW carries a Perceptual table but the capture step published no readable CURRENT evidence manifest — the perceptual gate cannot grade, so the run holds.'),
        { gate: P.screen })
    }
    let manifest = mf0.ids[0]
    // The family rule (plan F), read once per run: 0 routes the GPT screen verbs,
    // 1 the Claude leg, anything else is untrusted and holds — the audit-member law. W2-S3
    // (B04): the family derives over the VERIFIED trio through the fused verb, so the routing
    // rests on sealed bytes; a torn seal exits nonzero-nonone here and holds like any untrusted
    // read.
    const fam = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' perceptual-family .kiln', 'perceptual:family')
    if (fam !== 0 && fam !== 1) {
      const pf = await clearPerceptualMarker()
      if (pf) return pf
      return failStop('transport-failure',
        { stage, next_action: 'Rerun stage validate after fixing the transport: the perceptual family read did not answer' },
        await voiceBeat('transport-failure', {}, 'The perceptual family read returned no trustworthy answer — the run holds.'),
        { gate: P.screen })
    }
    const primaryScreen = fam === 0
    const screenOpts = tier('reviewer-gate')
    // The pre-leg digest: the kernel computes the current-manifest sha256 through a
    // mechanical hand, so the Claude verdict binds to the evidence exactly as the CLI
    // binds the screen verdict — law_hash = the manifest digest, byte-symmetric.
    const screenDigest = async () => {
      const d = await idsFetch('sha256sum ' + manifest + ' | cut -d" " -f1', 'screen:digest', 'a one-element array holding the 64-hex digest printed on stdout, [] if exit != 0')
      return d.exit === 0 && d.ids.length === 1 && LAW_HASH.test(d.ids[0]) ? d.ids[0] : null
    }
    // W2-S3 (B04): the criterion ownership key derives over VERIFIED LAW.md through the fused
    // verb, so the ids the claude path enforces rest on sealed bytes, not a raw re-read.
    const screenCriteria = async () => {
      const c = await idsFetch('node ' + shq(plugin + '/scripts/kiln-review') + ' screen-criteria .kiln', 'screen:criteria', 'the printed JSON array of the LAW Perceptual criterion ids, [] if exit != 0')
      return c.exit === 0 && c.ids.length > 0 ? new Set(c.ids) : null
    }
    // The Claude multimodal leg (the claudeGate pattern): a STATIC prompt of closed
    // interpolations only — the manifest path, the pre-leg digest, the rubric and LAW
    // paths, the candidate path. The leg reads the evidence itself via Read and writes
    // the candidate; the kernel reads the bytes back through the shared mirror read,
    // recomputes ALL the S2 verb rules (gateReviewInvalid with law_hash = the pre-leg
    // digest and the screen location rule, the verdict enum, empty blockers, criterion
    // membership) and promotes content-free.
    const screenLegPrompt = (mode, mf, digest, contract) => [
      'You are the perceptual grading reviewer: a fresh mind grading the rendered surface against the locked law.',
      'The canonical contract at .kiln/contracts/sha256/' + contract + '.json is the COMPLETE authoritative facts for this grade — the perceptual criteria rows, the rubric, the evidence-manifest digest, and the attached and reference image digests. Judge exactly that contract.',
      'Project dir: ' + projectDir + '. Read the locked law at ' + P.law + ' (its Perceptual table rows are the criteria), the shipped rubric at ' + plugin + '/data/perceptual-rubric.json, and the evidence manifest at ' + mf + '.',
      'Read the evidence yourself with the Read tool: the manifest names every file of its generation — read the two viewports, the labeled keyframes, and any reference images directly, plus meta, console, and the DOM snapshot as text.',
      'Judge ONLY the Perceptual table rows, each on its named rubric dim per the shipped anchors — never any other dimension, and never general taste beyond what a row pins. For each finding set criterion = the row criterion id and location = an evidence path with an optional :frame (for example viewport-mobile.png or film.webm:3). Insufficient evidence on a dim is a finding citing the rubric insufficient_evidence line as its evidence — never a blocker. Execute nothing and install nothing.',
      'Set law_hash to exactly ' + digest + ' — the sha256 of the graded evidence manifest; it binds this verdict to that evidence. Verdict rules: accept only when findings and blockers are both empty; changes_required for one or more repairable findings. Never return blocked and never write a blocker: hard failure belongs to the law proxies.',
      mode === 'recheck'
        ? 'Read and reuse the prior review_id from ' + P.screen + ' first. Recheck only the finding ids in ' + P.screen + ' against the fresh evidence generation. Preserve each unresolved finding id; never add one. Accept only when every listed finding is repaired.'
        : mode === 'escalate'
          ? 'This is a bounded second-family escalation of a held verdict: re-grade ONLY the surviving criterion ids named by the findings in the published verdict at ' + P.screen + ', on the same evidence generation. Mint a fresh review_id.'
          : 'Mint a fresh review_id.',
      'Compose the verdict object per ' + plugin + '/scripts/review-schema.json, and as the FINAL act of your turn write it as JSON to ' + P.candidate + '. Then return { ok: true } — the ack carries no verdict; the kernel reads and validates the file you wrote.',
    ].join('\n')
    // The shared screen mirror read — the ONE sanctioned W8-S3 parse site (the
    // gate-file mirror precedent): the Claude candidate, the escalation candidate,
    // and the recheck prior lineage all ride this single site; the kernel parses
    // only the gate envelopes it validates, never content.
    const readScreenJson = async (path, label, when) => {
      const raw = await idsFetch('cat ' + path, label, when)
      if (raw.exit !== 0 || raw.ids.length !== 1) return null
      try { return JSON.parse(raw.ids[0]) } catch { return null }
    }
    // W8S3-ESC-SCOPE (plan H, ONLY-survivors): the OPTIONAL scope set narrows the
    // admissible finding criteria below the full table — an escalation may speak
    // ONLY to the surviving criterion ids, and an off-scope finding invalidates the
    // whole candidate exactly as an off-table criterion does: exit 20, never published.
    const claudeScreen = async (mode, target, expectedReviewId, allowedFindingIds, priorDigest, scope) => {
      const digest = await screenDigest()
      if (digest === null) return 20
      // Digest freshness on the Claude path, byte-symmetric with the CLI screen-recheck
      // rule: a regrade over the very evidence bytes that already failed never runs.
      if (priorDigest !== undefined && digest === priorDigest) return 20
      const criteria = await screenCriteria()
      if (criteria === null) return 20
      // Producer-self-publish: invalidate any prior candidate BEFORE the reviewer runs.
      if (await hands('rm -f ' + P.candidate, 'screen:invalidate') !== 0) return 20
      // W2-S3 (B04): the claude screen reviewer is write-capable, so bracket its turn with the
      // trio digest — the criteria and family it judges derive from the sealed LAW/slices, and
      // this catches a mutation of any trio member during review, recheck OR escalation. d0 is
      // bound to the SEALED trio.hash digests (not merely compared to d1), so a drift already on
      // disk before the turn is caught; d1 === d0 then rules mutation, before any publish.
      const sealed = await trioSealed('screen-claude:trio-sealed')
      if (sealed.exit !== 0 || sealed.ids.length !== 3) return 20
      const d0 = await trioDigest('screen-claude:trio-digest')
      if (d0.exit !== 0 || d0.ids.length !== 3 || d0.ids.some((h, i) => h !== sealed.ids[i])) return 20
      // W2-S7a: mint the screen-grader leg and dispatch under its reserved label; the leg rides the
      // publish-gate argv below so the screen verdict on reviews.jsonl carries its reviewer identity.
      const screenLeg = await mintLeg('screen-grader', tier('fallback-reviewer').alias, 'screen')
      if (!screenLeg) return 20
      // W2-S7a (FORK 1): compose the perceptual-screen contract (criteria, rubric, evidence-manifest
      // digest, per-image byte digests) through the trusted verb before dispatch; the digest threads
      // into the prompt and the publish-gate binding. recheck and escalation read the held/prior verdict
      // at P.screen for their cohort and survivor scope.
      const contractCmd = 'node ' + shq(plugin + '/scripts/kiln-review') + ' contract-prepare ' + shq('.') + ' .kiln perceptual-screen ' + (mode === 'recheck' ? 'recheck' : mode === 'escalate' ? 'escalation' : 'initial') + ((mode === 'recheck' || mode === 'escalate') ? ' ' + shq(P.screen) : '')
      const sc = await idsFetch(contractCmd, 'screen:contract', 'a one-element array holding the canonical contract sha256 printed on stdout, [] if exit != 0')
      if (sc.exit !== 0 || sc.ids.length !== 1 || !LAW_HASH.test(sc.ids[0])) return 20
      const screenContract = sc.ids[0]
      const ack = await agent(screenLegPrompt(mode, manifest, digest, screenContract), { label: screenLeg.label, ...tier('fallback-reviewer'), schema: ACK })
      if (!ack || ack.ok !== true) return 20
      const g = await readScreenJson(P.candidate, 'screen:read', 'a one-element array holding the exact candidate file contents printed on stdout, [] if exit != 0')
      if (g === null) return 20
      if (gateReviewInvalid(g, digest, expectedReviewId, allowedFindingIds, SCREEN_LOCATION_RULE) !== null) return 20
      // The screen verb rules, kernel-side: a perceptual grade never blocks (hard
      // failure belongs to the law proxies) and every finding pins a table criterion.
      if (g.verdict === 'blocked' || g.blockers.length !== 0) return 20
      if (g.findings.some(f => !criteria.has(f.criterion))) return 20
      if (scope && g.findings.some(f => !scope.has(f.criterion))) return 20
      const d1 = await trioDigest('screen-claude:trio-confirm')
      if (d1.exit !== 0 || d1.ids.length !== 3 || d1.ids.some((h, i) => h !== d0.ids[i])) return 20
      // W2-S7a (F3): the trio bracket rebinds the LAW, but a screen contract also hashes the images, the
      // evidence-manifest digest, and the meta/console/DOM text — none covered by the trio. A write-
      // capable reviewer that changed any of those would publish under the stale pre-dispatch contract
      // (publish-gate only re-verifies the STORED bytes). Recompose the contract over the CURRENT evidence
      // and REQUIRE the digest unchanged; any divergence HOLDs before the publish, nothing lands.
      const scc = await idsFetch(contractCmd, 'screen:contract-confirm', 'a one-element array holding the recomposed canonical contract sha256 printed on stdout, [] if exit != 0')
      if (scc.exit !== 0 || scc.ids.length !== 1 || scc.ids[0] !== screenContract) return 20
      // W2-S5: archive-then-publish through the trusted verb before the content-free overwrite —
      // target is the primary screen gate or the escalation gate, and both preserve their verdict
      // in the immutable ledger first. A failed archive fails closed and the screen holds.
      if (await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' publish-gate .kiln screen ' + P.candidate + ' ' + target + ' ' + shq(screenLeg.legId) + ' ' + shq(screenContract), 'screen:publish') !== 0) return 20
      return verdictExit(g.verdict)
    }
    // W8S3-ADDENDUM-IFF bookkeeping: true the moment THIS run publishes a verdict to
    // the screen gate file, either family — the addendum-iff rule below keys on it.
    let published = false
    const gate = async (mode) => {
      // Pre-spawn BELT (plan G): deterministic manifest completeness before ANY primary
      // spawn, either family — should be unreachable given the act contract; a
      // violation is transport-class, never a grade.
      if (await hands(PERCEPTUAL_BELT + ' ' + manifest, 'perceptual:belt') !== 0) return 20
      if (primaryScreen) {
        // The GPT primary through the trusted verbs. The recheck hands the published
        // prior verdict as its own pre-recheck snapshot (the CLI reads it fully before
        // writing the output) plus the CURRENT manifest as the digest-bound delta —
        // the CLI enforces digest-inequality on this path. Direct-path call preserves
        // 126/127 as gate-unreachable exactly as the build gate does.
        const exit = await hands(
          mode === 'recheck'
            ? plugin + '/scripts/kiln-review screen-recheck . .kiln ' + screenOpts.model + ' ' + screenOpts.alias + ' ' + screenOpts.effort + ' ' + P.screen + ' ' + manifest + ' ' + P.screen
            : plugin + '/scripts/kiln-review screen . .kiln ' + screenOpts.model + ' ' + screenOpts.alias + ' ' + screenOpts.effort + ' ' + P.screen,
          'screen:' + mode)
        if (exit === 0 || exit === 10) published = true
        return exit
      }
      // The Claude primary: a recheck establishes lineage from the prior published
      // verdict HERE, and NOTHING WEAKER than the CLI screen-recheck path — the FULL
      // prior screen shape is recomputed before any lineage fact is trusted:
      // gateReviewInvalid over the five fields, the screen location rule, unique ids
      // and the verdict-consistency rules (self-anchored, exactly as the CLI validates
      // the prior against its own review_id and law_hash), then the screen verb rules
      // (a changes_required prior with every criterion on the sealed table). The
      // KERNEL then enforces the digest-inequality the CLI enforces on the screen
      // path. Byte-symmetric rules, two transports.
      let expectedReviewId, allowedFindingIds, priorDigest
      if (mode === 'recheck') {
        const prior = await readScreenJson(P.screen, 'screen:prior', 'a one-element array holding the exact published screen verdict bytes printed on stdout, [] if exit != 0')
        if (prior === null) return 20
        if (gateReviewInvalid(prior, prior.law_hash, prior.review_id, undefined, SCREEN_LOCATION_RULE) !== null) return 20
        if (prior.verdict !== 'changes_required') return 20
        const pc = await screenCriteria()
        if (pc === null || prior.findings.some(f => !pc.has(f.criterion))) return 20
        expectedReviewId = prior.review_id
        priorDigest = prior.law_hash
        allowedFindingIds = new Set(prior.findings.map(f => String(f.id)))
      }
      const exit = await claudeScreen(mode, P.screen, expectedReviewId, allowedFindingIds, priorDigest)
      if (exit === 0 || exit === 10) published = true
      return exit
    }
    const loop = await reviewLoop({
      gate,
      // The pinned prior cohort: the finding ids the published screen verdict carries.
      cohort: async () => {
        const c = await idsFetch(
          "node -p 'JSON.stringify((require(\"./" + P.screen + "\").findings||[]).map(f=>String(f.id)))'",
          'screen:findings', 'the printed JSON array of the current screen finding ids, [] if exit != 0',
        )
        return c.exit === 0 ? c.ids : null
      },
      // The RECAPTURE act leg (plan G): a fresh card act scoped to the capture step —
      // fresh generation per the S2 allocator; the confirmed delta is the NEW manifest
      // path, test -s. The digest-inequality at recheck rules the freshness either way.
      repair: async (pass) => {
        const rr = await act(cardPrompt('Recapture pass ' + pass + ': the perceptual gate needs fresh evidence. Execute ONLY the capture step of the card (step 4) — reserve a fresh evidence generation with the recipe allocator, capture the full required set, and publish its complete manifest.json LAST. Touch nothing else.'), 'perceptual:recapture')
        if (rr.facts.status !== 'ok') return false
        for (const p of rr.facts.pointers) routes.add(p)
        beats.push(fillClosed(rr.narration_beat, stageFacts))
        const mf = await idsFetch(CURRENT_MANIFEST, 'perceptual:manifest', 'a one-element array holding the CURRENT generation manifest path printed on stdout, [] if exit != 0')
        if (mf.exit !== 0 || mf.ids.length !== 1 || !MANIFEST_PATH.test(mf.ids[0])) return false
        if (await hands('test -s ' + mf.ids[0], 'perceptual:delta-check') !== 0) return false
        manifest = mf.ids[0]
        return true
      },
    }, cap)
    // The ADDENDUM act (plan I, act 2): runs iff a PUBLISHED verdict exists — the loop
    // advance (rows grade PASS) or the semantic hold (survivors grade PARTIAL). Its
    // failure is the existing act transport hold, which removes the marker.
    const addendum = async (extra) => {
      const add = await act(cardPrompt(extra), 'perceptual:addendum')
      if (add.facts.status !== 'ok') return null
      for (const p of add.facts.pointers) routes.add(p)
      return add
    }
    const addendumHold = async () => {
      const pf = await clearPerceptualMarker()
      if (pf) return pf
      return failStop('transport-failure', { stage, next_action: 'Rerun stage ' + stage }, await voiceBeat('transport-failure', {}, 'The ' + stage + ' stage did not return sound work — the run holds.', 1))
    }
    // W8S3-ADDENDUM-IFF (criterion 6): a published verdict and the act-2 addendum
    // are one. The sealed and blocked branches below carry their own; when THIS run
    // published a changes_required verdict and then stranded on a nonsemantic hold —
    // a dead recapture, a downed recheck transport, a degraded or unreachable gate —
    // the rows still land before the hold returns. Only no-verdict paths skip act 2.
    if (published && loop.result !== 'sealed' && loop.result !== 'blocked') {
      const add = await addendum('Perceptual addendum: the published perceptual verdict at ' + P.screen + ' stands changes_required while the run holds. Follow the Perceptual addendum section of the card: append the perceptual rows to .kiln/validate.md — grade PARTIAL for the surviving criterion ids named by the findings in the published verdict at ' + P.screen + ', grade PASS for the rest — and re-emit the truthful stage beat.')
      if (add === null) return addendumHold()
      beats.push(fillClosed(add.narration_beat, stageFacts))
    }
    if (loop.result === 'sealed') {
      const add = await addendum('Perceptual addendum: the published perceptual verdict at ' + P.screen + ' accepted this evidence generation. Follow the Perceptual addendum section of the card: append the perceptual rows to .kiln/validate.md with every grade PASS, and re-emit the truthful stage beat.')
      if (add === null) return addendumHold()
      // The truthful re-emitted beat replaces the act-1 beat on the common ok path.
      r = { facts: r.facts, narration_beat: add.narration_beat }
    } else if (loop.result === 'blocked') {
      // The SEMANTIC hold (plan H): exhaustion or no-progress with nonempty survivors.
      // Order is law: marker FIRST, then ONE bounded opposite-family escalation, the
      // closed outcome recorded, the PARTIAL addendum, then the static held return.
      // The escalation can never change status, marker, or outcome.
      if (await hands('touch ' + P.perceptualPartial, 'perceptual:marker') !== 0) return persistFail('perceptual-marker')
      const surv = await idsFetch(
        "node -p 'JSON.stringify([...new Set((require(\"./" + P.screen + "\").findings||[]).map(f=>String(f.criterion)))])'",
        'screen:survivors', 'the printed JSON array of the surviving criterion ids the published verdict pins, [] if exit != 0',
      )
      const survivors = surv.exit === 0 && surv.ids.length > 0 ? surv.ids : null
      let outcome = 'escalation unavailable'
      if (survivors !== null) {
        // ONLY-survivors (plan H): the second family speaks to the surviving
        // criterion ids ALONE, and BOTH transports enforce the scope PRE-PUBLISH —
        // the Claude leg through its scope set, the GPT path through the
        // survivor-scoped screen-escalate verb — so an out-of-scope answer is
        // never published, and the closed outcome set stays closed.
        if (primaryScreen) {
          // Primary GPT — the OTHER transport is the Claude leg, published to the
          // separate escalation artifact; the held verdict is never overwritten.
          const esc = await claudeScreen('escalate', P.screenEscalation, undefined, undefined, undefined, new Set(survivors))
          if (esc === 0) outcome = 'CONTESTED'
          // A scope-valid changes_required carries survivor findings by construction.
          else if (esc === 10) outcome = 'CORROBORATED'
        } else {
          // Primary Claude — the OTHER transport is the GPT screen-escalate verb:
          // the held verdict rides argv, the verb re-derives the survivors itself,
          // packets ONLY the surviving rows, and refuses any off-survivor finding
          // pre-publish — same generation, separate output artifact.
          const esc = await hands(plugin + '/scripts/kiln-review screen-escalate . .kiln ' + screenOpts.model + ' ' + screenOpts.alias + ' ' + screenOpts.effort + ' ' + P.screen + ' ' + P.screenEscalation, 'escalate:screen')
          if (esc === 0) outcome = 'CONTESTED'
          // A scope-valid changes_required carries survivor findings by construction.
          else if (esc === 10) outcome = 'CORROBORATED'
        }
      }
      // One closed line into the held record — outcome and count only, closed values.
      const recordWrite = [
        'set -e', 'mkdir -p .kiln',
        "cat > .kiln/.screen-escalation.tmp <<'KILN_ESC_EOF'",
        outcome + (survivors === null ? '' : ' — ' + survivors.length + ' surviving criteria'),
        'KILN_ESC_EOF',
        'mv -f .kiln/.screen-escalation.tmp ' + P.screenRecord,
      ].join('\n')
      if (await hands(recordWrite, 'escalate:record') !== 0) return persistFail('escalation-record')
      const add = await addendum('Perceptual addendum: a semantic perceptual hold stands. Follow the Perceptual addendum section of the card: append the perceptual rows to .kiln/validate.md — grade PARTIAL for the surviving criterion ids named by the findings in the published verdict at ' + P.screen + ', grade PASS for the rest — and re-emit the truthful stage beat.')
      if (add === null) return addendumHold()
      beats.push(fillClosed(add.narration_beat, stageFacts))
      const found = await idsFetch(
        "node -p 'JSON.stringify((require(\"./" + P.screen + "\").findings||[]).map(f=>String(f.id)))'",
        'screen:findings', 'the printed JSON array of the current screen finding ids, [] if exit != 0',
      )
      beats.push(await voiceBeat('blocked', { passes: loop.repairs, ids: found.ids.join(', '), count: found.ids.length }, 'The gate held after ' + loop.repairs + ' repair passes — the ruling is yours.'))
      return stop('blocked',
        { stage, next_action: 'Operator ruling: the perceptual screen held ' + (survivors === null ? found.ids.length : survivors.length) + ' criteria (' + outcome + ') after ' + loop.repairs + ' repair passes — the verdict is at ' + P.screen + ' and the evidence manifest at ' + manifest },
        { gate: P.screen, manifest, finding_ids: found.ids, passes: loop.repairs, escalation: outcome })
    } else if (loop.result === 'degraded') {
      // PRIMARY transport unavailable — the degraded-class hold: no semantic ruling
      // happened, so NO marker and NO escalation; a stale marker is cleared. The
      // LAW-ratify held precedent: a stage-level hold naming the codex restore.
      const pf = await clearPerceptualMarker()
      if (pf) return pf
      return failStop('held',
        { stage, next_action: 'Restore codex, then rerun stage validate: the perceptual screen needs the second family' },
        'The perceptual screen would not grade: codex is not answering, and the family rule names it the primary. The hold is honest — restore codex and rerun the validate stage.',
        { gate: P.screen })
    } else if (loop.result === 'gate-unreachable') {
      const pf = await clearPerceptualMarker()
      if (pf) return pf
      return failStop('gate-unreachable',
        { stage, next_action: 'Rerun stage validate after restoring the gate tool at ' + plugin + '/scripts/kiln-review' },
        await voiceBeat('gate-unreachable', {}, 'The gate tool at ' + plugin + '/scripts/kiln-review is unreachable — not found or not executable; codex was never reached, so no verdict was possible.'),
        { gate: P.screen })
    } else if (loop.result === 'repair-failed') {
      // A failed recapture is capture-class — nonsemantic, marker removed.
      const pf = await clearPerceptualMarker()
      if (pf) return pf
      return failStop('repair-failed',
        { stage, next_action: 'Rerun stage validate: the recapture pass did not land a fresh evidence generation' },
        'The recapture pass did not land a fresh evidence generation — the run holds.',
        { gate: P.screen })
    } else {
      // transport-failure — the Claude leg failure and the missing-oracle hold
      // included: nonsemantic, no marker, no escalation.
      const pf = await clearPerceptualMarker()
      if (pf) return pf
      return failStop('transport-failure',
        { stage, next_action: 'Rerun stage validate after fixing the transport: the perceptual screen published no usable verdict' },
        await voiceBeat('transport-failure', {}, 'The perceptual screen call returned no verdict — the run holds.'),
        { gate: P.screen })
    }
  }
  // LAW rerun beat: stage end (report is a stage, so this also guards completion).
  const post = await lawBeat(LAW_GUARD, 'law:stage-end')
  if (post.exit === TRIO_MISMATCH) {
    if (stage === 'validate') {
      const pf = await clearPerceptualMarker()
      if (pf) return pf
    }
    return trioMismatchHold('none')
  }
  if (post.exit !== 0) {
    const owner = await firstSealed(post.ids)
    if (owner) {
      // W8-S3 (DELTA-10): the stage-end law-red door is a terminal validate path too.
      if (stage === 'validate') {
        const pf = await clearPerceptualMarker()
        if (pf) return pf
      }
      return reopen(owner, 'stage end')
    }
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
  // W8-S3: the ok terminal — dormant or live-accept — is a nonsemantic conclusion; a
  // stale marker from a prior semantic hold is removed before the run advances.
  if (stage === 'validate') {
    const pf = await clearPerceptualMarker()
    if (pf) return pf
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
// W2-S3 (B03): the build order is fetched through the fused `slices` verb — it verifies
// slices.json against the sealed trio and prints the descriptor projection in ONE operation, so
// a slice id, order, surface or milestone tampered after preflight is a TRIO_MISMATCH hold, and
// no write-capable builder is ever dispatched over drifted facts. The projection is
// byte-compatible with the former node -p leg.
const list = await idsFetch(
  'node ' + shq(plugin + '/scripts/kiln-review') + ' slices .kiln',
  'slices:fetch', 'the printed JSON array of slice descriptor strings (a bare id, or "obj|<id>|<surface>|<milestone>"), [] if exit != 0',
)
if (list.exit === TRIO_MISMATCH) return trioMismatchHold('none')
if (list.exit !== 0 || list.ids.length === 0) {
  return failStop('transport-failure', { stage, next_action: 'Rerun stage law: no slice list at ' + P.slices }, await voiceBeat('transport-failure', {}, 'No slice list on the ledger — the law stage must run again.', 1))
}
const slices = list.ids.map(parseSliceEntry)
// A malformed slice descriptor (an id outside the shared SLICE_ID charset or an
// unknown surface) halts BEFORE any builder dispatch — the law stage must author it right.
const badSlice = slices.find(x => !x.valid)
if (badSlice) {
  // slices-invalid means no trustworthy slice exists — the whole descriptor is malformed,
  // so a grammar-valid id inside it is not an in-plan slice. STATE names none, always.
  return failStop('slices-invalid',
    { stage, active_slice: 'none', next_action: 'Rerun stage law: a slice descriptor in ' + P.slices + ' is malformed' },
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
// bad read). One read, reused for every slice.
const cap = capFromDial(await capRead())
// ── W7-S2: the seam gate — the milestone audit seated in the build loop ──────
// ONE shared block for both paths a seam slice takes (the fresh seal and the
// seal-skip resume, the all-sealed resume included): when the seam closed fact
// holds and no current audit covers it, the goal-backward audit runs before the
// loop advances. W2-S7b (item 10): there is no repair edge here — a non-accept
// WITHDRAWS the covered prefix through the one batch cutoff and stops, and the
// ordinary build path rebuilds it, so no model ever mutates sealed content
// behind standing seals. The kernel branches on its own reconcileAudit
// derivation over the published closed arrays, never on the wire verdict
// string. Returns null to advance, or the halting kernel result.
const auditSeam = async (slice) => {
  // W2-S7a: the covered prefix — every slice up to and including this seam, the cumulative set the
  // audit attests. Reused by the boot-membership guards here and by the rejection cutoff below.
  const seamIdx = sliceIds.indexOf(slice)
  const coveredPrefix = seamIdx >= 0 ? sliceIds.slice(0, seamIdx + 1) : []
  // W2-S7b (item 11): the audited-skip decision reads the REDUCTION through the trusted verb — the
  // last membership-bearing decision the kernel took from a rendered projection line, and the one that
  // let a NARROWER covered audit answer for this seam once the wider one went stale. Closed exit law,
  // the grammar the old grep spoke: 0 is a current member, 1 is PROVEN absence, and anything else — an
  // unreadable ledger, a transport failure, a malformed answer — is untrusted and HOLDS, because a
  // re-audit over an unread ledger could re-append an already-logged seam. The member answer is TAGGED
  // and the two tags are disjoint: covered:<csv> carries coverage, legacy alone is the coverage-less W1
  // member. The kernel reads the TAG, never the payload shape — a slice may legitimately be named
  // legacy, and an untagged answer would let an audit covering only that slice pass as the W1 one.
  const member = await idsFetch(
    'node ' + shq(plugin + '/scripts/kiln-review') + ' audit-member .kiln ' + shq(slice),
    'audit:member',
    'a one-element array holding the single stdout line the verb prints at exit 0 — either covered: followed by the current audit members covered slice ids as a comma list, or the bare word legacy — and [] at any nonzero exit')
  const trusted = member.exit === 1 || (member.exit === 0 && member.ids.length === 1)
  if (!trusted) {
    return failStop('transport-failure',
      { stage, active_slice: slice, next_action: 'Rerun stage build after fixing the transport: the audit membership check for slice ' + slice + ' did not answer' },
      await voiceBeat('transport-failure', {}, 'The audit membership check for slice ' + slice + ' returned no trustworthy answer — the run holds.', 1),
      { gate: P.audit })
  }
  // W2-S7a (F1) + W2-S7b (item 11): honor a rendered audit ONLY when its coverage SPANS this seams
  // verified prefix and that whole prefix was sealed AT BOOT. A covered slice absent from the boot
  // snapshot is being rebuilt now, so the audit judged content that no longer stands; a covered set
  // narrower than the prefix judged a milestone that has since grown. The check reads the frozen
  // snapshot, never the live SEALS a same-invocation seal would leak into. A coverage-less W1 member
  // keeps its exact pre-S7b treatment — the reduction elects one only while no cutoff exists anywhere.
  const prefixAtBoot = coveredPrefix.every((id) => SEALS_AT_BOOT.has(id))
  if (seamIdx >= 0) {
    if (member.exit === 0 && prefixAtBoot && (member.ids[0] === 'legacy' || member.ids[0] === 'covered:' + coveredPrefix.join(','))) return null
    // Never DISPATCH an audit whose coverage could only be provisional: a covered slice rebuilt this
    // invocation holds an unpromoted seal candidate, so the append could only die at the CLI, which
    // refuses an audit covering a slice at no generation. Return the advance-class relaunch instead —
    // the conductor capture promotes the candidates, and the next boot audits over rendered
    // membership. The durable fact that relaunch resumes from is already on disk: the rebuild that
    // made this prefix provisional wrote seal-advance / relaunch-build before the loop reached here.
    if (!prefixAtBoot) return done('ok', { next_stage: 'build' })
  }
  // Receipt first: the auditor judges executed evidence, so the LAW check
  // receipt refreshes immediately before the initial audit on EVERY path. Red
  // takes the existing pre-seal door exactly — a sealed owner reopens, a
  // non-future red halts law-red — and no audit runs over a red law.
  const guard = await lawBeat(LAW_CHECK_RECEIPT, 'law:pre-audit')
  if (guard.exit === TRIO_MISMATCH) return trioMismatchHold(slice)
  if (guard.exit !== 0) {
    const owner = await firstSealed(guard.ids)
    if (owner) return reopen(owner, 'pre-audit')
    if (!redSetIsFuture(guard.ids, slice, sliceIds)) {
      return failStop('law-red',
        { stage, active_slice: slice, next_action: 'Rerun stage build: the LAW is red at the milestone audit of slice ' + slice },
        'The law is red at the milestone audit of slice ' + slice + ' — no audit over a red law.')
    }
  }
  // S4 (INTAKE-38): the audit TRANSPORT degrades to the claude family when codex is
  // down — a fresh OPUS goal-backward auditor (singular) mirroring the codex audit
  // packet and feeding the SAME reconcileAudit derivation. A tri-state path-selector
  // read chooses the seat: absent the cross-family codex auditor, present the claude one.
  // W2-S10d: an UNANSWERED detection selects no seat. The sealed-skip loop reaches this
  // audit at :2278 and continues past it, so the build belt below never runs first on
  // this path — the guard has to stand here, and it takes the local degraded stop.
  // W2-S10d (B3): ONE stop body — the guard below and the detection arm both call it, so the beat
  // and the next_action have a single home.
  const auditDegradedStop = async (mark) => {
    const db = await voiceBeat('degradation', {}, 'Codex is not answering — answer continue to proceed single-family.')
    if (mark && await hands('touch ' + P.degraded, 'degraded:mark') !== 0) return persistFail('degraded-mark')
    beats.push(db)
    return stop('degraded', { stage, active_slice: slice, next_action: 'Acknowledge single-family degradation, then relaunch stage build: the milestone audit of slice ' + slice + ' completes single-family' })
  }
  const degraded = await hands('test -f ' + P.degraded, 'audit:degraded') === 0
  if (degraded && await hands('test -f ' + P.ack, 'audit:degraded-ack') !== 0) return auditDegradedStop(false)
  const auditorOpts = degraded ? tier('fallback-reviewer') : tier('reviewer-gate')
  // W2-S7a: the claude auditor leg the degraded seat mints — carried into the audit candidate and
  // the reviews reference below. The codex auditor leaves it null; its identity lives on reviews.jsonl.
  let auditorLeg = null
  // The claude audit leg (the claudeGate mirror): the kernel reads the SEALED law hash,
  // the opus auditor echoes it as law_hash, and the kernel validates the five-field
  // verdict shape, the echo, and the audit blocker to finding referential rule before
  // publishing to the audit gate file. The three-way agreement below stays UNCHANGED —
  // only the transport is swapped. W2-S7b (item 10): initial-only, like the codex seat —
  // the recheck arm went with the repair edge it judged.
  const claudeAudit = async () => {
    // S4-B1: the seam-bounded closed facts, derived kernel-side from the same trim-normalized
    // projection the codex auditFacts reads (sliceIds/milestones, byte-identical to the CLI by the
    // projection-agreement check) — the closing block is the maximal contiguous same-label run
    // ending at the seam, the sealed prefix every slice up to and including it. The claude auditor is
    // bound to THIS prefix, never the seal ledger; an all-sealed resume with an earlier seam audit
    // missing can then neither judge the milestone on later work nor raise an out-of-prefix finding.
    const seam = sliceIds.indexOf(slice)
    if (seam < 0) return 20
    let start = seam
    while (start > 0 && milestones[start - 1] === milestones[seam]) start -= 1
    const closingBlock = sliceIds.slice(start, seam + 1)
    const sealedPrefix = sliceIds.slice(0, seam + 1)
    const lh = await idsFetch(
      "node -p 'JSON.stringify([String(require(\"fs\").readFileSync(\".kiln/law/lock.hash\",\"utf8\")).trim()])'",
      'audit-claude:lawhash', 'a one-element array holding the sealed law lock.hash digest printed on stdout, [] if exit != 0')
    if (lh.exit !== 0 || lh.ids.length !== 1 || !LAW_HASH.test(lh.ids[0])) return 20
    const lawHash = lh.ids[0]
    if (await hands('rm -f ' + P.candidate, 'audit-claude:invalidate') !== 0) return 20
    // W2-S3 (B04): the claude auditor is write-capable, so bracket its turn with the shared
    // trio digest. The lawHash echo binds LAW.md; this catches a mutation of any trio member
    // during the turn — the seam facts rest on slices.json, the receipt on check.sh. d0 is
    // bound to the SEALED trio.hash digests (not merely compared to d1), so a drift already on
    // disk before the turn is caught; d1 === d0 then rules mutation, before any publish.
    const sealed = await trioSealed('audit-claude:trio-sealed')
    if (sealed.exit !== 0 || sealed.ids.length !== 3) return 20
    const d0 = await trioDigest('audit-claude:trio-digest')
    if (d0.exit !== 0 || d0.ids.length !== 3 || d0.ids.some((h, i) => h !== sealed.ids[i])) return 20
    // W2-S7a: mint the auditor leg and dispatch under its reserved label; the leg rides the
    // publish-gate argv and the append-audit reference so the audit attestation carries its identity.
    const auditLeg = await mintLeg('auditor', auditorOpts.alias, slice)
    if (!auditLeg) return 20
    auditorLeg = auditLeg.legId
    // W2-S7a (FORK 1): compose the milestone-audit contract (auditFacts, coverage tuples, receipt
    // digest) through the trusted verb before dispatch; the digest threads into the prompt and the
    // publish-gate binding.
    const ac = await idsFetch(
      'node ' + shq(plugin + '/scripts/kiln-review') + ' contract-prepare ' + shq('.') + ' .kiln milestone-audit initial ' + shq(slice),
      'audit-claude:contract', 'a one-element array holding the canonical contract sha256 printed on stdout, [] if exit != 0')
    if (ac.exit !== 0 || ac.ids.length !== 1 || !LAW_HASH.test(ac.ids[0])) return 20
    const auditContract = ac.ids[0]
    const ack = await agent([
      'You are the milestone audit reviewer: a fresh mind judging the sealed milestone goal-backward against the locked law.',
      'The canonical contract at .kiln/contracts/sha256/' + auditContract + '.json is the COMPLETE authoritative facts for this audit — the sealed law_hash, the seam, the milestone, the closing block, the cumulative sealed prefix, the coverage tuples, and the receipt digest. Judge exactly that contract.',
      'Project dir: ' + projectDir + '. Read the locked law at ' + P.law + ', the vision documents in the repository, and the slice plan at ' + P.slices + '. The milestone under audit' + (milestones[seam] ? ' (' + milestones[seam] + ')' : '') + ' closes at slice ' + slice + '. The closing block is exactly: ' + closingBlock.join(', ') + '. The cumulative sealed prefix under audit is exactly: ' + sealedPrefix.join(', ') + ' — judge ONLY this prefix; slices beyond it are out of scope, never evidence, never a finding.',
      'Judge goal-backward over the cumulative sealed prefix with focus on the closing block at slice ' + slice + ': integrated reachability, the connections between slices, and delivery of the milestone goal. The law checks were already executed kernel-side; their full output is attached verbatim at ' + P.receipt + '. Read files freely to judge, but execute nothing — no tests, no builds, no state-changing commands. Creative direction and visual taste belong to the builder; never raise them as a finding. Change no file: judge the milestone, write only the verdict.',
      'For each finding pin the failed LAW criterion id in criterion and an exact repo-relative path:line in location, with the concrete failure, its evidence, and the smallest repair. Every blocker id must equal one of your finding ids. Verdict rules: accept only when findings and blockers are both empty; changes_required for repairable findings with no blockers; blocked only when the milestone goal is undeliverable, with blocker ids naming findings. Mint a fresh review_id.',
      'Set law_hash to exactly ' + lawHash + ' — the sealed law digest; copy it verbatim.',
      'Compose the verdict object per ' + plugin + '/scripts/review-schema.json, and as the FINAL act of your turn write it as JSON to ' + P.candidate + '. Then return { ok: true } — the ack carries no verdict; the kernel reads and validates the file you wrote.',
    ].join('\n'), { label: auditLeg.label, ...auditorOpts, schema: ACK })
    if (!ack || ack.ok !== true) return 20
    const raw = await idsFetch('cat ' + P.candidate, 'audit-claude:read', 'a one-element array holding the exact candidate file contents printed on stdout, [] if exit != 0')
    if (raw.exit !== 0 || raw.ids.length !== 1) return 20
    let g
    try { g = JSON.parse(raw.ids[0]) } catch { return 20 }
    if (gateReviewInvalid(g, lawHash) !== null) return 20
    // The audit referential rule (kiln-review auditShapeInvalid mirror): a blocked
    // verdict carries findings, and every blocker id equals a finding id — so a blocker
    // always carries its criterion, location and minimal fix through that finding.
    if (g.verdict === 'blocked' && g.findings.length === 0) return 20
    const fids = new Set(g.findings.map(f => f.id))
    if (g.blockers.some(b => !fids.has(b))) return 20
    const d1 = await trioDigest('audit-claude:trio-confirm')
    if (d1.exit !== 0 || d1.ids.length !== 3 || d1.ids.some((h, i) => h !== d0.ids[i])) return 20
    // W2-S5: archive-then-publish through the trusted verb before the content-free overwrite of the
    // audit gate — the validated audit verdict lands in the immutable ledger first. A failed archive
    // fails closed and the audit holds, never publishing an un-archived verdict.
    const w = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' publish-gate .kiln audit ' + P.candidate + ' ' + P.audit + ' ' + shq(auditLeg.legId) + ' ' + shq(auditContract), 'audit-claude:publish')
    return w === 0 ? verdictExit(g.verdict) : 20
  }
  // ONE dispatch, no loop: closed facts only ride the argv — repo `.`, the cwd-relative kiln dir, the
  // seam slice id, and the reviewer-gate model, alias and effort from the tier file (the ratify-leg
  // pattern).
  const exit = degraded
    ? await claudeAudit()
    : await hands(plugin + '/scripts/kiln-review audit . .kiln ' + slice + ' ' + auditorOpts.model + ' ' + auditorOpts.alias + ' ' + auditorOpts.effort + ' ' + P.audit, 'audit:review')
  // The kernel-owned derivation from the published verdict: the ONE sanctioned audit-verdict parse
  // (the gate-file mirror). The kernel rederives the verdict from the published closed arrays and
  // demands THREE-WAY agreement — derivation, wire exit, AND the published verdict string (exit 0
  // over a `blocked` string is a disagreement the exit alone cannot see). Anything less leaves
  // derived null, and every branch below needs it: an unusable verdict can neither promote an audit
  // nor withdraw a prefix, so it falls through to the transport hold.
  let derived = null
  if (exit === 0 || exit === 10 || exit === 11) {
    const raw = await idsFetch('cat ' + P.audit, 'audit:read', 'a one-element array holding the exact audit verdict file contents printed on stdout, [] if exit != 0')
    let g = null
    // Totality over the published bytes: JSON `null` parses clean, so the object guard rules before
    // any dereference.
    if (raw.exit === 0 && raw.ids.length === 1) {
      try { g = JSON.parse(raw.ids[0]) } catch { g = null }
    }
    if (g && typeof g === 'object') {
      const d = reconcileAudit(g.findings, g.blockers)
      if (g.verdict === d.verdict && verdictExit(d.verdict) === exit) derived = d.verdict
    }
  }
  const outcome = gateOutcome(exit)
  // Kernel-owned promotion: only the accept outcome AND an accept from the
  // kernel derivation append the audit fact — through the trusted CLI verb,
  // never a bare shell append. Then the loop continues past the seam.
  if (outcome === 'accept' && derived === 'accept') {
    // The audit ledger line carries the family label, reread tri-state at append time
    // (S4-D4/D5): absent appends dual, present single-family, an untrusted read HOLDS.
    const auditFamily = await sealLabel('audit:seal-label')
    if (auditFamily === null) {
      return failStop('transport-failure',
        { stage, active_slice: slice, next_action: 'Rerun stage build after fixing the transport: the degradation marker gave no trustworthy answer at the milestone audit append of slice ' + slice },
        await voiceBeat('transport-failure', {}, 'The degradation marker gave no trustworthy answer at the milestone audit append of slice ' + slice + ' — the run holds rather than record an untrusted family label.', 1),
        { gate: P.audit })
    }
    // W2-S7b (item 6): the audit candidate records the auditor leg — the degraded seat its claude leg,
    // the codex path the - sentinel (its identity rides reviews.jsonl) — and the SIXTH word carries the
    // attestation kind unconditionally, never keyed on whether a cutoff exists. The repair-legs word is
    // always empty: no leg mutates sealed content on this path at all. A still-pending referenced
    // Claude intent makes the row provisional until capture-and-finalize promotes it.
    if (await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' append-audit .kiln ' + slice + ' ' + auditFamily + ' ' + shq(auditorLeg || '-') + ' ' + shq('') + ' ' + shq('reviewed'), 'audit:append') !== 0) return persistFail('audit-append')
    return null
  }
  // Stop surfaces: the existing statuses, exactly as the build gate maps them.
  // Every next_action is a STATIC template interpolating only the seam slice
  // id and the audit artifact path — no verdict prose enters STATE; the audit
  // JSON is the operator detail surface.
  // W2-S7b (item 10, the D2 cure): a derived non-accept WITHDRAWS the entire covered prefix through
  // the one batch cutoff and stops. Nothing mutates sealed content behind standing seals — the next
  // boot rebuilds every invalidated slice through the ordinary build/review/seal path, and a fresh
  // full milestone audit runs over the reseal. The cutoff fires only on the three-way-agreed derived
  // verdict, never on a wire exit alone, and it lands BEFORE the STATE write, so a crash between them
  // relaunches onto a durable cutoff and a fresh audit rather than a stale verdict.
  if (derived === 'changes_required' || derived === 'blocked') {
    const found = await idsFetch(
      "node -p 'JSON.stringify((require(\"./" + P.audit + "\").findings||[]).map(f=>String(f.id)))'",
      'audit:findings', 'the printed JSON array of the current audit finding ids, [] if exit != 0',
    )
    if (await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' invalidate .kiln ' + shq(coveredPrefix.join(',')), 'seal:invalidate') !== 0) return persistFail('seal-invalidate')
    beats.push('The milestone audit did not accept slice ' + slice + '. Every seal it covered is withdrawn — evidence-bound, not sacred — and the next fire rebuilds them from the sealed plan. Findings ' + found.ids.join(', ') + ' are on the table; the ruling is yours.')
    return stop('blocked',
      { stage, active_slice: slice, next_action: 'Operator ruling: the milestone audit did not accept slice ' + slice + ' — the covered prefix is withdrawn and the verdict is at ' + P.audit },
      { gate: P.audit, finding_ids: found.ids })
  }
  if (outcome === 'codex_unavailable') {
    // S4-D2: the FIRST codex-down detection is the acknowledgment stop the slice gates
    // take — persist the degraded marker ALONE and stop; the ack is the operator word,
    // conductor-written on continue. The acked re-run enters with both files and audits
    // single-family through the claude seat above; the append reads the marker at append
    // time and records single-family honestly.
    return auditDegradedStop(true)
  }
  if (outcome === 'gate_unreachable') {
    return failStop('gate-unreachable',
      { stage, active_slice: slice, next_action: 'Rerun stage build: the milestone audit gate tool is unreachable for slice ' + slice },
      await voiceBeat('gate-unreachable', {}, 'The gate tool would not run — not found or not executable where it lives, so codex was never reached and no verdict was possible.'),
      { gate: P.audit })
  }
  // transport-failure — and, fail-closed, any outcome whose derivation is not
  // usable — holds here: no verdict, no promotion, no cutoff.
  return failStop('transport-failure',
    { stage, active_slice: slice, next_action: 'Rerun stage build after fixing the transport: the milestone audit of slice ' + slice + ' published no usable verdict' },
    await voiceBeat('transport-failure', {}, 'The milestone audit call for slice ' + slice + ' returned no verdict — the run holds.'),
    { gate: P.audit })
}
let corrections = 0
for (const [idx, entry] of slices.entries()) {
  const slice = entry.id
  const ordinal = idx + 1
  if (SEALS.has(slice)) {
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
  // W2-S7a (FORK 3): capture the immutable baseline of this slice generation BEFORE the first builder
  // mutation, so dirty or untracked pre-run files are attributed to the baseline and never falsely to
  // the slice. A nonzero start (a torn key, an unreadable tree, an unsupported special file) holds the
  // stage rather than build a slice whose control-derived delta can never be trusted. The repo is the
  // cwd-relative dot (hands runs with cwd = projectDir), so a whitespace path never splits the argv.
  const manifestStart = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' manifest-start ' + shq('.') + ' .kiln ' + shq(slice), 'manifest:start')
  if (manifestStart !== 0) return failStop('transport-failure', { stage, active_slice: slice, next_action: 'Rerun stage build' }, await voiceBeat('transport-failure', {}, 'Slice ' + slice + ' could not capture its baseline manifest — the run holds rather than build a slice whose delta cannot be trusted.', 1))
  // W2-S7a (ruling A-prime): the write-capable legs of THIS slice generation accumulate their leg
  // ids for the seal below — the builder, every repair pass, and the accepting reviewer. builder +
  // repair are always Claude, so the seal is provisional until capture-and-finalize resolves them.
  // The reviewer is a real leg on every gated path: a claude gate mints it directly, a normal ui
  // codex gate threads the leg read from its <gate>.leg sidecar (B-D2); only the absent degraded-ui
  // gate leaves the reviewer position at the - sentinel.
  const builderLegs = []
  let reviewerLeg = null
  const builderLeg = await mintLeg('builder', builderOpts.alias, slice)
  if (!builderLeg) return failStop('transport-failure', { stage, active_slice: slice, next_action: 'Rerun stage build' }, await voiceBeat('transport-failure', {}, 'Slice ' + slice + ' could not mint a builder identity — the run holds rather than build an unattested slice.', 1))
  builderLegs.push(builderLeg.legId)
  const r = await actWith(cardPrompt('Build exactly slice ' + slice + ' (surface ' + entry.surface + '). Write ' + P.request + ' (the builder evidence hints) per the card before returning.'), builderLeg.label, builderOpts)
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
  if (guard.exit === TRIO_MISMATCH) return trioMismatchHold(slice)
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
  // hard-stop the exit-21 path takes. The ack file records the OPERATOR WORD:
  // the conductor touch is its only writer in the tree, and all five detections
  // — the three here, the sweep, and the builder card — touch the degraded
  // marker alone, so a marker discovered pre-gate without an ack is a stop
  // nobody answered. This is the belt for the ACTIVE UNSEALED SLICE path only;
  // the law ratify, seam audit and sweep selectors carry the same rule locally
  // because control never passes here on their way. After acknowledgment the
  // run continues single-family: a ui slice skips the gate (no cross-family
  // reviewer without codex), a logic or mixed slice still faces the opus
  // fallback gate below — the seal reads the marker either way.
  const degradedStop = async () => {
    const db = await voiceBeat('degradation', {}, 'Codex is not answering — answer continue to proceed single-family.')
    const m = await hands('touch ' + P.degraded, 'degraded:mark')
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
  // W2-S7a (B-D2): the ui-normal gate alone is the codex reviewer; its minted leg reaches the seal
  // through the sidecar the review verb wrote. Every other gate is claude — the kernel minted its
  // reviewer leg directly into reviewerLeg. Only the degraded-ui no-gate seal carries the - sentinel.
  const usedCodexGate = runGate && !wasDegraded && entry.surface === 'ui'
  if (runGate) {
    // W2-S10d: this selector needs no ack gate of its own, and the reason is ORDER, not luck —
    // wasDegraded is read at the belt above and the belt returns degradedStop when the ack is
    // missing, so control only reaches here past a standing word. Pinned in kernel.test.mjs; the
    // sibling selectors at law ratify and the seam audit sit on no such path and carry their own.
    const reviewerOpts = wasDegraded ? tier('fallback-reviewer') : tier('stage-card')
    const claudeGate = async (mode) => {
      // W2-S4 (B02/B03/B04): the claude gate derives its facts from the SAME sealed authority the
      // codex packet uses. gate-facts runs buildGateFacts, so law_hash is CROSS-BOUND to the sealed
      // trio (trio[LAW.md] === lock.hash === lock.seal): a lock.hash quietly swapped to a valid-but-
      // different digest, or any torn seal, exits TRIO_MISMATCH and never rides an accept. It also
      // runs hintsFrom and writes the FILTERED four hint fields to the trusted P.gateFacts file the
      // reviewer reads — so a forged law_text, slice_id, law_hash or injected instruction in the raw
      // request never reaches the model. The demoted request stays a required deliverable: a missing
      // or malformed one is the same transport hold hintsFrom takes on the codex path. A torn seal
      // sets trioTorn so the after-loop routes it to the both-family TRIO_MISMATCH hold, not a
      // plain transport 20 (B03).
      const gf = await idsFetch(
        'node ' + shq(plugin + '/scripts/kiln-review') + ' gate-facts .kiln ' + shq(slice) + ' ' + shq(P.request) + ' ' + shq(P.gateFacts),
        'gate-claude:facts', 'a one-element array holding the sealed cross-bound law_hash printed on stdout, [] if exit != 0')
      if (gf.exit === TRIO_MISMATCH) { trioTorn = true; return 20 }
      if (gf.exit !== 0 || gf.ids.length !== 1 || !LAW_HASH.test(gf.ids[0])) return 20
      const lawHash = gf.ids[0]
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
      // W2-S4 (B03): the claude gate is write-capable, so bracket its turn with the shared trio
      // digest. d0 binds to the SEALED trio.hash (not merely compared to d1), so a LAW, check.sh or
      // slices.json drift already on disk before the turn is caught; d1 === d0 after rules mutation,
      // before publish. A digest that disagrees with the sealed trio is the integrity class, not a
      // plain transport failure: it sets trioTorn and the after-loop holds TRIO_MISMATCH, both
      // families consistent — a transport-shaped read failure (exit or arity) stays transport 20.
      const sealed = await trioSealed('gate-claude:trio-sealed')
      if (sealed.exit !== 0 || sealed.ids.length !== 3) return 20
      const d0 = await trioDigest('gate-claude:trio-digest')
      if (d0.exit !== 0 || d0.ids.length !== 3) return 20
      if (d0.ids.some((h, i) => h !== sealed.ids[i])) { trioTorn = true; return 20 }
      // W2-S7a: mint the gate-reviewer leg and dispatch under its reserved label. It rides the
      // publish-gate argv below (reviews.jsonl reviewer identity) and becomes the seal reviewer
      // reference — the last accepting gate leg is the one the seal binds.
      const gateLeg = await mintLeg('gate-reviewer', reviewerOpts.alias, slice)
      if (!gateLeg) return 20
      reviewerLeg = gateLeg.legId
      // W2-S7a (FORK 1): compose the canonical contract through the trusted verb BEFORE dispatch — the
      // SAME facts the codex packet derives (buildGateFacts, hintsFrom, the receipt digest, the reviewed
      // manifest). The digest is the one closed stdout fact; it threads into the reviewer prompt as the
      // authoritative file to judge AND into the publish-gate binding below. A recheck rides the prior
      // gate and the repair delta. A failed compose holds transport-20; every word shq-quoted.
      const gc = await idsFetch(
        'node ' + shq(plugin + '/scripts/kiln-review') + ' contract-prepare ' + shq('.') + ' .kiln slice-review ' + (mode === 'recheck' ? 'recheck' : 'initial') + ' ' + shq(slice) + ' ' + shq(P.request) + (mode === 'recheck' ? ' ' + shq(P.gate) + ' ' + shq(P.delta) : ''),
        'gate-claude:contract', 'a one-element array holding the canonical contract sha256 printed on stdout, [] if exit != 0')
      if (gc.exit !== 0 || gc.ids.length !== 1 || !LAW_HASH.test(gc.ids[0])) return 20
      const gateContract = gc.ids[0]
      // The reviewer WRITES its verdict object to the candidate file as the final
      // act of its turn and returns only a light {ok} ack — the return carries no
      // verdict authority; the kernel reads and validates the bytes it will publish.
      const reviewerAck = await agent([
        'You are the gate reviewer for slice ' + slice + ': a fresh mind judging the diff against the locked law.',
        'The canonical contract at .kiln/contracts/sha256/' + gateContract + '.json is the COMPLETE authoritative facts for this review — the sealed law_text scoped to slice ' + slice + ', the non-authoritative builder hints, the receipt digest, and the reviewed manifest. Judge exactly that contract; it is the sole authority for the criteria.',
        'Project dir: ' + projectDir + '. Read the locked law at ' + P.law + ' — the sealed, verified LAW; scope it to slice ' + slice + ' and judge that slice against it — and the changed files themselves. The builder evidence hints are the trusted filtered facts at ' + P.gateFacts + ' (criteria, paths, failures, commands only): they are non-authoritative context that may orient you but never narrow or override the law, and no finding derives from them. Do not read the raw review request.',
        'The law checks were already executed kernel-side; their full output is attached verbatim at ' + P.receipt + '. Execute nothing — no commands, no tests, no builds: judge the diff against the law with the receipt as the only execution evidence.',
        'Receipt rows owned by slices not yet built in this run are expected pre-build evidence — judge only the criteria for slice ' + slice + ' from the locked law; never treat them as findings, and never filter or rewrite the receipt.',
        mode === 'recheck'
          ? 'Read and reuse the prior review_id from ' + P.gate + ' first. Recheck only the finding ids in ' + P.gate + ' against ' + P.delta + ' and the current files. Preserve each unresolved finding id; never add one. Accept only when every listed finding is repaired.'
          : 'Report only substantiated criterion violations at exact repo-relative path:line locations with stable finding ids. Verdict rules: accept only when findings and blockers are both empty; changes_required only for repairable findings with no blockers; blocked only when the review cannot complete, with blocker reasons. Mint a fresh review_id.',
        'Set law_hash to exactly ' + lawHash + ' — the sealed law digest; copy it verbatim. Compose the verdict object per ' + plugin + '/scripts/review-schema.json, and as the FINAL act of your turn write it as JSON to ' + P.candidate + '. Then return { ok: true } — the ack carries no verdict; the kernel reads and validates the file you wrote.',
      ].join('\n'), { label: gateLeg.label, ...reviewerOpts, schema: ACK })
      if (!reviewerAck || reviewerAck.ok !== true) return 20
      // Read the candidate back as raw UTF-8 and run the ONE sanctioned gate-file
      // parse (the mirror of the parse-and-hop args adapter). The kernel validates
      // exactly the bytes it will publish, never the returned ack.
      const raw = await idsFetch('cat ' + P.candidate, 'gate:read', 'a one-element array holding the exact candidate file contents printed on stdout, [] if exit != 0')
      if (raw.exit !== 0 || raw.ids.length !== 1) return 20
      let g
      try { g = JSON.parse(raw.ids[0]) } catch { return 20 }
      // S1: the semantic mirror rules BEFORE the kernel promotes — a failed
      // validation is transport-failure exit semantics, never a seal. law_hash binds to the
      // sealed digest (W2-S4), so a verdict echoing anything but the sealed LAW hash is rejected.
      if (gateReviewInvalid(g, lawHash, expectedReviewId, allowedFindingIds) !== null) return 20
      // W2-S4 (B03): confirm the trio is byte-identical to the sealed digest the turn opened on —
      // a trio member mutated during the write-capable reviewer turn is the integrity class, held
      // TRIO_MISMATCH after the loop, before any publish.
      const d1 = await trioDigest('gate-claude:trio-confirm')
      if (d1.exit !== 0 || d1.ids.length !== 3) return 20
      if (d1.ids.some((h, i) => h !== d0.ids[i])) { trioTorn = true; return 20 }
      // Content-free promotion: the validated candidate becomes the gate file.
      // W2-S5: archive-then-publish through the trusted verb before the content-free overwrite —
      // the validated build-gate verdict lands in the immutable ledger first, filed under the review
      // family that shares this gate file with LAW ratify. A failed archive fails closed (nonzero)
      // and the gate holds, never publishing an un-archived verdict.
      // W2-S7a (FORK 3): the review publish carries the repo and slice so the verb recomputes the
      // control-derived manifest and rejects drift before it archives and publishes — the codex path
      // runs the same check inside runGate. Every new word shq-quoted, the repo the cwd-relative dot.
      const w = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' publish-gate .kiln review ' + P.candidate + ' ' + P.gate + ' ' + shq(gateLeg.legId) + ' ' + shq('.') + ' ' + shq(slice) + ' ' + shq(gateContract), 'gate:publish')
      return w === 0 ? verdictExit(g.verdict) : 20
    }
    // S2: a recheck judges executed evidence, so the receipt must be fresh —
    // before EVERY recheck round, either gate family, the kernel reruns the
    // full check into the receipt. No gate ever judges a stale pre-repair
    // receipt. A red rerun takes the same door as any pre-seal red: reopen a
    // sealed owner, else halt law-red — recorded here, ruled after the loop.
    let recheckRed = null
    // W2-S3: as in the audit gate, a torn trio at the recheck receipt stashes for the
    // after-loop fail-closed ruling — the gate itself can only return an exit code.
    let trioTorn = false
    const freshReceipt = (inner) => async (mode) => {
      if (mode === 'recheck') {
        const again = await lawBeat(LAW_CHECK_RECEIPT, 'law:pre-recheck')
        if (again.exit === TRIO_MISMATCH) {
          trioTorn = true
          return 20
        }
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
      // W2-S7a (FORK 3): prepare a FRESH control-derived manifest before EVERY gate — initial and
      // recheck — so the diff the reviewer judges is captured immediately before the gate and the
      // publication and seal recompute-and-match it. A nonzero prepare holds the gate transport-20.
      const manifestPrepare = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' manifest-prepare ' + shq('.') + ' .kiln ' + shq(slice), 'manifest:prepare')
      if (manifestPrepare !== 0) return 20
      return inner(mode)
    }
    // W6-07: the ui codex gate takes the cwd-relative repo arg `.` exactly as the LAW-ratify gate
    // does — hands runs with cwd = projectDir, and kiln-review resolves the request, the artifact,
    // and the diff against it. A bare projectDir interpolation would split a whitespace path into
    // extra argv and fail this fixed-arity gate. The keyed cap bounds the regenerate-slice edge.
    // W2-S4: the ui codex reviewer is the reviewer-gate seat; its model and effort ride argv from
    // the validated tier file (the audit-verb pattern), no longer relayed through the request.
    const gateOpts = tier('reviewer-gate')
    const loop = await reviewLoop({
      gate: freshReceipt(!wasDegraded && entry.surface === 'ui'
        ? (mode) => hands(gateCmd(mode, { plugin, repo: '.', kilnDir: '.kiln', slice, model: gateOpts.model, alias: gateOpts.alias, effort: gateOpts.effort, request: P.request, gate: P.gate, priorGate: P.gate, delta: P.delta }), 'gate:' + mode)
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
        // W2-S7a: a repair pass is a write-capable leg of this generation — mint its identity,
        // accumulate it into the seal builder references, and dispatch under the reserved label.
        const repairLeg = await mintLeg('repair', builderOpts.alias, slice)
        if (!repairLeg) return false
        builderLegs.push(repairLeg.legId)
        const rr = await actWith(cardPrompt('Repair pass ' + pass + ' for slice ' + slice + ' (surface ' + entry.surface + '): fix ONLY the findings in ' + P.gate + '; write the repair delta to ' + P.delta + '.'), repairLeg.label, builderOpts)
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
    // W2-S3: a trio torn during the slice recheck holds fail-closed before any red ruling.
    if (trioTorn) return trioMismatchHold(slice)
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
  // W2-S7a (B-D2): the codex gate minted its reviewer leg inside the review verb, which surfaced it
  // in the gate sidecar (<gate>.leg). Read it now and carry it into the seal reviewer position;
  // append-seal re-validates it against identity.jsonl. A missing or malformed sidecar after a
  // successful codex gate is a transport fault — no seal over an unrecoverable reviewer identity.
  if (usedCodexGate) {
    const legRead = await idsFetch('cat ' + P.gate + '.leg', 'gate:leg', 'the codex reviewer leg id printed on stdout, [] if exit != 0')
    if (legRead.exit !== 0 || legRead.ids.length !== 1 || !/^[0-9a-f]{32}$/.test(legRead.ids[0])) {
      return failStop('transport-failure',
        { stage, active_slice: slice, next_action: 'Rerun stage build after fixing the transport: the codex reviewer identity sidecar was unreadable at the seal of slice ' + slice },
        await voiceBeat('transport-failure', {}, 'The codex reviewer identity for slice ' + slice + ' could not be read from its gate sidecar — the run holds rather than seal without a reviewer identity.', 1),
        { gate: P.gate })
    }
    reviewerLeg = legRead.ids[0]
  }
  // Seal-label law (S2): the label reads the marker AT SEAL TIME, any gate
  // path, and keys on PRESENCE rather than on which writer set it — a builder
  // that lost codex mid-run, or the conductor at the availability panel before
  // the run began. A seal that follows a same-family gate speaks single-family;
  // dual only when the marker is absent at the moment of the seal.
  const label = await sealLabel('degraded:check')
  if (label === null) {
    return failStop('transport-failure',
      { stage, active_slice: slice, next_action: 'Rerun stage build after fixing the transport: the degradation marker gave no trustworthy answer at the seal of slice ' + slice },
      await voiceBeat('transport-failure', {}, 'The degradation marker gave no trustworthy answer at the seal of slice ' + slice + ' — the run holds rather than seal an untrusted family label.', 1),
      { gate: P.gate })
  }
  // Branch verb (INTAKE-28): the seal append rides the trusted kiln-review CLI as
  // an opaque `append-seal` verb. A Sonnet kernel leg refuses a bare
  // `echo >> seals.log` — it reads seals.log as a dual-key attestation ledger and
  // declines to scribe an append it cannot verify. The seals.log semantics live
  // inside the CLI; the courier sees only the verb and neutral args. The kiln dir
  // is the cwd-relative `.kiln` (hands runs with cwd = projectDir): a bare projectDir
  // interpolation would split a whitespace path into extra args and fail every seal.
  // W2-S7a (ruling A-prime): the seal carries this generation leg references — the accumulated
  // builder + repair legs and the accepting reviewer position. The reviewer is a real leg on every
  // gated path: the claude gate-reviewer leg the kernel minted, or the codex reviewer leg read from
  // the gate sidecar above (B-D2). The - sentinel survives ONLY on the verdictless degraded-ui seal,
  // which had no gate at all. Every word shq-quoted (the gateCmd idiom). The builder legs are
  // pending Claude intents, so the seal appends PROVISIONAL and renders no membership until
  // capture-and-finalize promotes it.
  // W2-S7b (items 6 and 8): the SEVENTH word is the attestation kind, passed unconditionally from
  // here on — a gated seal is `reviewed` and binds by reference to its accepted review; the one
  // ungated path, the acknowledged degraded-ui seal, is `verdictless-degraded-ui`, which is what makes
  // the two distinguishable on the wire (D3). runGate is the closed fact that tells them apart, and
  // the verdictless field law — single-family label, reviewer `-` — is already exactly what that path
  // passes. It is never keyed on whether a cutoff exists: from the first cutoff the seal ledger is
  // modern, and a candidate carrying no kind is refused.
  const s = await hands('node ' + shq(plugin + '/scripts/kiln-review') + ' append-seal .kiln ' + slice + ' ' + label + ' ' + shq(builderLegs.join(',')) + ' ' + shq(reviewerLeg || '-') + ' ' + shq('.') + ' ' + shq(runGate ? 'reviewed' : 'verdictless-degraded-ui'), 'seal:append')
  if (s !== 0) return persistFail('seal-append')
  // W2-S7a (B-PROVISIONAL-LIVE): the seal is provisional while its Claude builder legs are unresolved
  // (they resolve only at the conductor capture), so it grants NO rendered membership yet. SEALS
  // reflects RENDERED membership only — a live add here would let firstSealed/reopen count an
  // unattested seal, contradicting provisional-never-counts. The membership set stays the boot read;
  // a this-run seal becomes a member on the next boot, after capture promotes it.
  beats.push(await voiceBeat('seal', { ...facts, label }, 'sealed — {label} · slice {slice}'))
  const w = await hands(stateCommitCmd(plugin, 'seal-advance', stage, slice, 'relaunch-build', density, [...routes]), 'state:write')
  if (w !== 0) return persistFail('state-write')
  // W2-S7b (item 11): a FRESH seam candidate is provisional until the conductor capture promotes it,
  // so this invocation returns rather than audit it — an audit over a provisional prefix could only
  // die at its append. The STATE write above already persisted the durable fact this relaunch resumes
  // from (token seal-advance, key relaunch-build); capture-and-finalize runs after every terminal
  // return, so the next boot audits the seam over RENDERED membership through the sealed-skip path.
  // That leaves auditSeam exactly one call site, behind the sealed-skip, by construction.
  if (facts.seam) return done('ok', { next_stage: 'build' })
}
// LAW rerun beat: stage end. Red reopens only a sealed owner.
const post = await lawBeat(LAW_CHECK, 'law:stage-end')
if (post.exit === TRIO_MISMATCH) return trioMismatchHold('none')
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
