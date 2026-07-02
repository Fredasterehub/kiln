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
