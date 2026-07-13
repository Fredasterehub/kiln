// skill-evals.test.mjs — P6 T2: the trigger + scenario eval set, written BEFORE the body rewrite
// (skill-craft §4 "build evaluations first"). skill-craft's trigger-eval methodology is 20 realistic
// queries (should-fire + near-miss negatives) run against a model; the T2 contract renders it as
// DETERMINISTIC string/structure assertions over the two SKILL descriptions and the conductor's
// routing table (no model calls). So each "should-fire" eval asserts the description carries the
// keyword that catches its query, and each "near-miss negative" asserts the description does NOT
// carry the bait that would misfire on a look-alike query (the near-miss query is named in the
// assertion message). The three scenario evals assert the conductor's load-bearing structure survives
// the restructure. This suite stays green through the rewrite; the only baseline-red assertions are
// the pushier-trigger-clause ones, which go green when kiln-fire's description gains that clause.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKILLS = join(ROOT, 'plugins', 'kiln', 'skills')

const fireSrc = readFileSync(join(SKILLS, 'kiln-fire', 'SKILL.md'), 'utf8')
const brainSrc = readFileSync(join(SKILLS, 'kiln-brainstorm', 'SKILL.md'), 'utf8')

// Single-line `description:` from the SKILL frontmatter — both SKILLs use the one-line form.
function description(src) {
  const m = src.match(/^description:[ \t]*(.+)$/m)
  assert.ok(m, 'no single-line description: found in frontmatter')
  return m[1].trim()
}
const fireDesc = description(fireSrc)
const brainDesc = description(brainSrc)

// The pushier-trigger sentence skill-craft §4 recommends, once it lands. End at a true sentence
// boundary (a period followed by whitespace+capital, or end of string) so the internal period in
// ".kiln/" does not truncate the clause.
function pushySentence(desc) {
  const m = desc.match(/Make sure to use this skill whenever[\s\S]*?\.(?=\s+[A-Z]|\s*$)/i)
  return m ? m[0] : null
}

// ── Trigger evals — kiln-fire SHOULD fire (description carries the catching keyword) ───────────

test('kiln-fire trigger: query "what conductor drives the Kiln pipeline" — description names it', () => {
  assert.match(fireDesc, /conductor/i)
  assert.match(fireDesc, /pipeline/i)
})

test('kiln-fire trigger: query "run the 8-stage build" — the stage list is present', () => {
  for (const stage of ['onboarding', 'brainstorm', 'gauge', 'research', 'architecture', 'build', 'validate', 'report']) {
    assert.match(fireDesc, new RegExp(stage, 'i'), `stage "${stage}" missing from the description`)
  }
})

test('kiln-fire trigger: query "/kiln-fire" — the explicit command is a documented trigger', () => {
  assert.match(fireDesc, /\/kiln-fire/)
})

test('kiln-fire trigger: query "build software with Kiln" — caught by name', () => {
  assert.match(fireDesc, /build software with Kiln/i)
})

test('kiln-fire trigger: query "resume my Kiln run" — resume is a documented trigger', () => {
  assert.match(fireDesc, /resum\w*/i)
})

test('kiln-fire trigger: query "forge/ship an app with Kiln" — the pushier clause covers casual verbs', () => {
  const s = pushySentence(fireDesc)
  assert.ok(s, 'the pushier "Make sure to use this skill whenever…" trigger clause is absent')
  assert.match(s, /forging/i)
  assert.match(s, /shipping/i)
  assert.match(s, /building/i)
})

test('kiln-fire trigger: query "pick up my .kiln run" — the pushier clause names the .kiln resume', () => {
  const s = pushySentence(fireDesc)
  assert.ok(s, 'the pushier trigger clause is absent')
  assert.match(s, /\.kiln\//)
})

test('kiln-fire trigger: casual phrasing without the slash command still fires', () => {
  assert.match(fireDesc, /even without the \/kiln-fire command/i)
})

// ── Near-miss negatives — kiln-fire must NOT bait a look-alike query ───────────────────────────

test('kiln-fire near-miss: "build a Docker image" — trigger verbs stay gated on Kiln', () => {
  const s = pushySentence(fireDesc)
  assert.ok(s, 'the pushier trigger clause is absent')
  assert.match(s, /Kiln|\.kiln/, 'the pushier clause must gate its verbs on Kiln, or it baits generic "build" queries')
})

test('kiln-fire near-miss: "ship my npm package" — shipping is gated on Kiln, not offered bare', () => {
  const s = pushySentence(fireDesc)
  assert.ok(s, 'the pushier trigger clause is absent')
  // The shipping verb and the Kiln gate live in the same sentence.
  assert.ok(/shipping/i.test(s) && /Kiln|\.kiln/.test(s), 'shipping must co-occur with the Kiln gate')
})

test('kiln-fire near-miss: "fire up the grill/server" — no bare "fire up" bait', () => {
  assert.doesNotMatch(fireDesc, /fire up/i)
})

test('kiln-fire near-miss: "brainstorm a startup name" — brainstorm appears only as a stage, not a generic offer', () => {
  assert.doesNotMatch(fireDesc, /brainstorm(ing)?\s+(a\b|session|ideas|your)/i)
  assert.doesNotMatch(fireDesc, /help[^.]*brainstorm/i)
})

test('kiln-fire near-miss: "research the market" — research not offered as a standalone service', () => {
  assert.doesNotMatch(fireDesc, /research\s+(a\b|the\s+\w+\s+(market|topic|literature))/i)
  assert.doesNotMatch(fireDesc, /look into|investigate/i)
})

test('kiln-fire near-miss: "make a plan for my week" — no generic planning offer', () => {
  assert.doesNotMatch(fireDesc, /make (a|your) plan/i)
})

test('kiln-fire near-miss: "validate this form / report on sales" — stage verbs are not generic offers', () => {
  assert.doesNotMatch(fireDesc, /validate\s+(this|your|the form)/i)
  assert.doesNotMatch(fireDesc, /report on|write (a|the) report/i)
})

test('kiln-fire near-miss: "kiln pottery firing schedule" — no ceramics bait in the description', () => {
  assert.doesNotMatch(fireDesc, /pottery|ceramic|oven|kiln-dried/i)
})

test('kiln-fire near-miss: "resume my download" — resume is offered only for a Kiln/.kiln run', () => {
  // A resume TRIGGER names Kiln or .kiln ("resume a Kiln run"); no generic resume object is offered.
  assert.match(fireDesc, /resum\w*\s+a\s+(kiln|\.kiln)/i, 'no Kiln-gated resume trigger found')
  assert.doesNotMatch(fireDesc, /resum\w*\s+(a\s+)?(download|session|your work|anything|any run)/i)
})

test('kiln-fire near-miss: "take over any repo" — no over-broad any-project claim', () => {
  assert.doesNotMatch(fireDesc, /any (app|software|project|repo|codebase|repository)/i)
})

// ── kiln-brainstorm description evals ──────────────────────────────────────────────────────────

test('kiln-brainstorm: the negative trigger is present (prevents the near-miss misfire)', () => {
  assert.match(brainDesc, /not operator-invoked directly/i)
})

test('kiln-brainstorm: names its loader agent and what it produces', () => {
  assert.match(brainDesc, /the-creator/)
  assert.match(brainDesc, /VISION\.md/)
  assert.match(brainDesc, /ledger/i)
})

test('kiln-brainstorm near-miss: "help me brainstorm" — the negative trigger keeps it from firing directly', () => {
  // The description must not invite direct operator invocation; the negative trigger is the guard.
  assert.match(brainDesc, /not operator-invoked/i)
})

// ── Description hard limits + point-of-view (both SKILLs) ───────────────────────────────────────

for (const [name, desc] of [['kiln-fire', () => fireDesc], ['kiln-brainstorm', () => brainDesc]]) {
  test(`${name} description: non-empty and ≤1024 chars (S4 hard limit)`, () => {
    const d = desc()
    assert.ok(d.length > 0, 'empty description')
    assert.ok(d.length <= 1024, `${d.length} chars exceeds the 1024 limit`)
  })
  test(`${name} description: no XML (S4 hard limit)`, () => {
    assert.doesNotMatch(desc(), /<[^>]+>/)
  })
  test(`${name} description: third person — no leading first/second person`, () => {
    assert.doesNotMatch(desc(), /^\s*(You|I|We)\b/)
  })
}

test('kiln-fire description: third person addresses "the operator"', () => {
  assert.match(fireDesc, /the operator/i)
})

// ── Scenario evals (3) — the conductor's load-bearing structure survives the restructure ────────

test('scenario 1: the stage routing table survives — 7 workflow rows + an Args column', () => {
  // The table header carries an Args column (T1 added it, matched to the workflow headers).
  const header = fireSrc.match(/^\|\s*Stage\s*\|.*$/m)
  assert.ok(header, 'the routing-table header row is gone')
  assert.match(header[0], /\bArgs\b/, 'the routing table lost its Args column')
  // Every autonomous stage still has a table row (a line starting "| <Stage> |").
  const rows = fireSrc.split('\n').filter((l) => l.startsWith('|'))
  for (const stage of ['Brainstorm→VISION', 'Gauge', 'Research', 'Architecture', 'Build', 'Validate', 'Report']) {
    assert.ok(rows.some((l) => l.startsWith('| ' + stage + ' |')), `routing-table row for "${stage}" is missing`)
  }
  // pluginRoot stays flagged load-bearing where the workflows depend on it.
  assert.match(fireSrc, /pluginRoot/, 'pluginRoot dropped from the routing table')
})

test('scenario 2: the plan-approval gate and STATE.md discipline sections survive', () => {
  assert.match(fireSrc, /^##[^\n]*plan-approval gate/mi, 'the plan-approval gate section is gone')
  assert.match(fireSrc, /^##\s*STATE\.md discipline/mi, 'the STATE.md discipline section is gone')
  // The gate's operative rule: gated ⇒ Tier-2 checkpoint + AskUserQuestion Approve/Request changes.
  assert.match(fireSrc, /AskUserQuestion/, 'the plan gate lost its AskUserQuestion mechanism')
  // STATE discipline keeps the byte-stable / machine-read rule.
  assert.match(fireSrc, /byte-stable/i, 'STATE.md discipline lost the byte-stable field rule')
})

test('scenario 3: onboarding still births the ledger, the two-world rule holds, and the reference is pointed to once', () => {
  // The ledger-init step (kiln-state.mjs init) is the machine-first state bus birth — it must survive.
  assert.match(fireSrc, /kiln-state\.mjs init/, 'the ledger-init (kiln-state.mjs init) step is gone')
  // The two-world rule / files-are-the-bus contract.
  assert.match(fireSrc, /Files are the bus/i, 'the "files are the bus" rule is gone')
  // The per-stage arg prose moved to a single one-level-deep reference the body points to.
  assert.match(fireSrc, /workflow-contracts\.md/, 'the body does not point to references/workflow-contracts.md')
})


// ── P6.1 T1: platform currency — the conductor speaks the current binary's spawn semantics ──────

test('P6.1: zero TeamCreate/TeamDelete anywhere in the conductor; the Agent-tool spawn is named', () => {
  const fire = readFileSync(join(SKILLS, 'kiln-fire', 'SKILL.md'), 'utf8')
  assert.ok(!/TeamCreate|TeamDelete/.test(fire), 'the removed team-setup tools must not be instructed')
  assert.match(fire, /Agent tool/, 'the implicit-team Agent-tool spawn is the documented path')
  assert.match(fire, /`name`/, 'the spawn names Da Vinci for SendMessage addressability')
})

test('P6.1: the version floor reads 2.1.198 in the doctor and nothing still says 2.1.154', () => {
  const doctor = readFileSync(join(SKILLS, '..', 'commands', 'kiln-doctor.md'), 'utf8')
  assert.match(doctor, /2\.1\.198/)
  assert.ok(!doctor.includes('2.1.154'), 'the old floor must be gone from the doctor')
})

// ── WS-C/C3 + C4: the story telegraph tail contract lives in the conductor ──────────────────────

test('telegraph: the tail captures a sequence cursor before launch', () => {
  assert.match(fireSrc, /Capture the cursor BEFORE launch/i, 'cursor-capture step is missing')
  assert.match(fireSrc, /last_rendered_seq/, 'the cursor field is not named')
})

test('telegraph: the wake budget is bounded 6–8 checks per stage', () => {
  assert.match(fireSrc, /6[–-]8 checks per stage/, 'the 6–8 hard wake budget is not stated')
})

test('telegraph: the wake runs kiln-state since --kind lore and advances the cursor', () => {
  assert.match(fireSrc, /kiln-state\.mjs\s+since/, 'the tail does not call kiln-state since')
  assert.match(fireSrc, /--kind lore/, 'the wake does not filter to lore beats')
})

test('telegraph: overflow beats coalesce into one summary line, never spam', () => {
  assert.match(fireSrc, /coalesce/i, 'the coalescing rule is missing')
  assert.match(fireSrc, /truncated: true/, 'the --limit overflow signal is not handled')
})

test('telegraph: ledger-derived strings are sanitized before rendering', () => {
  assert.match(fireSrc, /saniti[sz]e/i, 'the sanitize-before-render rule is missing')
  assert.match(fireSrc, /newlines and control sequences/i, 'the newline/control-sequence strip is not specified')
})

test('telegraph: terminates on the completion notification AND a stage_completed beat', () => {
  assert.match(fireSrc, /stage_completed/, 'stage_completed termination is missing')
  assert.match(fireSrc, /completion notification/i, 'the completion-notification termination is missing')
})

test('telegraph: last_rendered_seq is persisted for exact-once resume', () => {
  assert.match(fireSrc, /exact-once/i, 'the exact-once resume rule is missing')
  assert.match(fireSrc, /Persist `last_rendered_seq`/, 'the cursor is not persisted per batch/at stage close')
})

test('telegraph: fails soft to plain wait-for-completion', () => {
  assert.match(fireSrc, /FAIL-SOFT/i, 'the fail-soft rule is missing')
  assert.match(fireSrc, /wait-for-completion/i, 'the plain wait-for-completion fallback is not named')
})

test('telegraph: theaterIntensity scales the beats (full renders, light coalesces, off is silent)', () => {
  const m = fireSrc.match(/theaterIntensity scales the beats[\s\S]*?intra-stage/i)
  assert.ok(m, 'the theaterIntensity scaling of beats is missing')
  assert.match(m[0], /full/)
  assert.match(m[0], /light/)
  assert.match(m[0], /off/)
})

test('telegraph: one PushNotification per stage completion + a one-time /workflows hint', () => {
  assert.match(fireSrc, /PushNotification/, 'the stage-completion PushNotification is missing')
  assert.match(fireSrc, /NEVER per beat or per slice/i, 'the one-per-stage ping doctrine is not stated')
  assert.match(fireSrc, /FIRST autonomous stage only/i, 'the one-time /workflows hint is missing')
})

// ── WS-D/D4: the unattended-chaining hard-stop list survives ────────────────────────────────────

test('chaining: clean completion auto-advances in the same turn', () => {
  assert.match(fireSrc, /Unattended chaining \(D4\)/, 'the D4 chaining doctrine paragraph is missing')
  assert.match(fireSrc, /auto-advances/i)
})

test('chaining: every hard stop is enumerated and plan_approval:auto chains through architecture', () => {
  assert.match(fireSrc, /plan_approval: gated/, 'the gated checkpoint hard stop is missing')
  assert.match(fireSrc, /correction_cycle >= 3/, 'the correction-escalation hard stop is missing')
  assert.match(fireSrc, /blocked \/ degraded \/ law-unlocked/, 'the blocked/degraded/law-unlocked hard stop is missing')
  assert.match(fireSrc, /operator interrupt/i, 'the operator-interrupt hard stop is missing')
  assert.match(fireSrc, /plan_approval: auto/, 'the auto-chains-through-architecture rule is missing')
})

// ── WS-C deliverable 3: the STATE template carries the cursor field at schema_version 3 ──────────

test('STATE template: last_rendered_seq bullet + schema_version 3', () => {
  const stateSrc = readFileSync(join(SKILLS, '..', 'templates', 'STATE.md'), 'utf8')
  assert.match(stateSrc, /\*\*schema_version\*\*:\s*3/, 'schema_version was not bumped to 3')
  assert.match(stateSrc, /\*\*last_rendered_seq\*\*:\s*0/, 'the last_rendered_seq cursor bullet is missing')
})

// ── WS-C r2 (Sol round 1) — cursor bootstrap, matching termination, drain, hint derivation ──────

test('r2 bootstrap: 0/absent/non-integer all read UNCAPTURED and resolve via the since-tail form', () => {
  assert.match(fireSrc, /UNCAPTURED/, 'the uncaptured-cursor rule is missing')
  assert.match(fireSrc, /since\s*\n?\s*<abs>\/\.kiln tail/, 'the explicit since-tail bootstrap call is missing')
  assert.match(fireSrc, /`0`[^.]*uncaptured\s+sentinel/i, 'the 0-as-sentinel rule is not stated')
  assert.match(fireSrc, /PERSIST it to\s*\n?\s*STATE before launching/i, 'the captured cursor is not persisted pre-launch')
  assert.doesNotMatch(fireSrc, /since <abs>\/\.kiln 0 --limit 1/, 'the truncating bootstrap query must be gone')
})

test('r2 termination: only a stage_completed MATCHING the active stage terminates; others render as beats', () => {
  assert.match(fireSrc, /`stage` field MATCHES the\s*\n?\s*active stage/, 'the matching-stage termination rule is missing')
  assert.match(fireSrc, /any OTHER stage is rendered\/coalesced/i, 'a foreign stage_completed must degrade to a beat')
})

test('r3 drain loop: notification-first closure drains to the tail — loop while truncated + completion unconsumed', () => {
  assert.match(fireSrc, /REPEAT `since <cursor> --kind lore` WHILE/, 'the drain loop is missing')
  assert.match(fireSrc, /`truncated: true` AND the active stage's `stage_completed` has not yet been consumed/, 'the loop condition is not stated')
  assert.match(fireSrc, /NOT part of the 6[–-]8 in-stage wake budget/, 'close-out fetches must be excluded from the wake budget')
  assert.match(fireSrc, /Only THEN[\s\S]{0,150}persist the cursor/, 'the cursor must persist only after the drain completes')
  assert.match(fireSrc, /no beat can ever render under the next stage/i, 'the boundary-isolation guarantee is missing')
  assert.match(fireSrc, /never\s*\n?\s*be closed by the prior stage's completion event/i, 'the cross-stage closure hazard is not named')
  // the single-fetch wording is retired — a bounded ONE-shot drain cannot guarantee boundary isolation
  assert.doesNotMatch(fireSrc, /ONE\s*\n?\s*bounded final `since` drain/i, 'the r2 single-drain wording must be gone')
})

test('r2 hint: the /workflows hint is derived from last_completed_stage, no new state field', () => {
  const m = fireSrc.match(/shows the forge in motion[\s\S]{0,400}/)
  assert.ok(m, 'the /workflows hint line is missing')
  assert.match(m[0], /last_completed_stage/, 'the hint must derive "first" from last_completed_stage')
  assert.match(m[0], /No new STATE field/i, 'the no-new-state-field rule is not stated')
})

test('r2 mirror: the workflow-contracts cadence line carries the full hard-stop list incl. operator interrupt', () => {
  const contracts = readFileSync(join(SKILLS, '..', 'references', 'workflow-contracts.md'), 'utf8')
  const m = contracts.match(/\*\*Launch cadence \(D4\)\.\*\*[\s\S]*?operator interrupt/)
  assert.ok(m, 'the cadence line is missing the operator-interrupt hard stop')
})

// ── WS-C r2 finding 2 — research/architecture emit honest stage brackets (the D4 chain predicate) ──

const WORKFLOWS_SRC = join(ROOT, 'plugins', 'kiln', 'workflows-src')
const researchSrc = readFileSync(join(WORKFLOWS_SRC, 'research.js'), 'utf8')
const archSrc = readFileSync(join(WORKFLOWS_SRC, 'architecture.js'), 'utf8')

test('chaining predicate: research.js brackets its run — started at entry, completed on BOTH success returns', () => {
  assert.match(researchSrc, /runLedger\('stage_started', \{\}, 'The Briefing'\)/, 'research stage_started is missing')
  const completions = researchSrc.match(/runLedger\('stage_completed'/g) || []
  assert.equal(completions.length, 2, `research must complete on BOTH success returns (zero-topics + synthesis), found ${completions.length}`)
  // the zero-topics completion sits inside the early-return branch, before its return
  assert.match(researchSrc, /await runLedger\('stage_completed', \{\}, 'The Briefing'\)\n  return \{ topics: \[\]/, 'the zero-topics route must complete the stage before returning')
})

test('chaining predicate: architecture.js completes ONLY on a locked Law — an escalation emits nothing', () => {
  assert.match(archSrc, /runLedger\('stage_started', \{\}, 'Laying Stone'\)/, 'architecture stage_started is missing')
  const completions = archSrc.match(/runLedger\('stage_completed'/g) || []
  assert.equal(completions.length, 1, 'architecture has exactly one completion emission')
  assert.match(archSrc, /if \(lawLocked\) await runLedger\('stage_completed'/, 'the completion must be gated on lawLocked === true')
})

test('chaining predicate: both bracket helpers are pluginRoot-gated and degrade to a log line', () => {
  for (const [name, src] of [['research.js', researchSrc], ['architecture.js', archSrc]]) {
    assert.match(src, /if \(!pluginRoot\) \{ log\(`pluginRoot absent — \$\{type\} not ledgered/, `${name}: the bracket helper must degrade, never fail the stage`)
  }
})
