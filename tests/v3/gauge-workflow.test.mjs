// gauge-workflow.test.mjs — T2 acceptance: the GENERATED workflows/gauge.js drives an end-to-end
// posture through its INLINED pure core (validateProfile + posture + GAUGE_CONFIG) from a fixture
// VISION, with the Alpha assessor MOCKED. This proves the mapping runs IN THE SCRIPT (not in
// an agent): the test feeds the workflow a profile via the mocked agent and asserts the returned
// posture equals posture(profile, CONFIG) computed independently from the shipped config — if the
// mapping had leaked into the agent, this script would have nothing to compute and the assertion
// would not hold. Also covers the override paths, the invalid→re-ask→conservative-default ladder,
// and the D8=2 second-scorer per-dimension max-reconcile.
//
// The workflow is run exactly as the runtime evaluates it (and as dry-run-runner.mjs does): the
// leading `export ` is stripped off `export const meta`, the body becomes an AsyncFunction whose
// parameters are the workflow globals, and stubs are passed positionally. Here `agent` is a
// programmable mock keyed off the call's `label`, and we capture every ledger command.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { posture as referencePosture, validateProfile } from '../../plugins/kiln/src/gauge.mjs'

const WORKFLOW = fileURLToPath(new URL('../../plugins/kiln/workflows/gauge.js', import.meta.url))
const CONFIG = JSON.parse(readFileSync(new URL('../../plugins/kiln/gauge-config.json', import.meta.url), 'utf8'))
const FIXTURE = fileURLToPath(new URL('./fixtures/vision-standard.md', import.meta.url))

const AsyncFunction = (async () => {}).constructor
const wfBody = readFileSync(WORKFLOW, 'utf8').replace(/^export const meta\b/m, 'const meta')

// profile builder: every dim 0 with nonempty evidence; `over` sets specific scores.
const prof = (over = {}) => {
  const p = {}
  for (let i = 1; i <= 8; i++) p[`D${i}`] = { score: 0, evidence: `quote for D${i}` }
  for (const [k, v] of Object.entries(over)) p[k] = { score: v, evidence: `quote for ${k}` }
  return p
}

// runGauge — execute the generated workflow with injected globals and a programmable `agent` mock.
// `respond(label, prompt) → result|null` decides what each agent() call returns (keyed on label).
// Returns { result, log, ledgerCmds }: the workflow's return value, the log lines, and the exact
// Bash commands handed to the ledger (Thoth) agent.
async function runGauge(args, respond) {
  const logLines = []
  const ledgerCmds = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    // The Thoth ledger leg is given a Bash command in its prompt; capture it, return a no-op result.
    if (label === 'thoth:ledger') {
      const m = prompt.match(/```\n([\s\S]*?)\n```/)
      if (m) ledgerCmds.push(m[1])
      return { ok: true }
    }
    return respond(label, prompt)
  }
  const stubs = {
    args,
    phase: () => {},
    log: (s) => logLines.push(String(s)),
    agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async () => [],
    budget: undefined,
    workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, wfBody)
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, log: logLines, ledgerCmds }
}

const baseArgs = { kilnDir: '/tmp/nonexistent-kiln/.kiln', projectPath: '/tmp/nonexistent-kiln', codexAvailable: false }

// The fixture's intended profile: a standard team app — moderate scope (D1=1), one high-priority
// before-build OQ → ambiguity (D2=1), known-stack CRUD (D3=0), a couple of real forks around auth
// (D4=1), third-party auth integration (D5=2), Postgres + audit log (D6=1), mostly executable but
// some browser (D7=1), real money/security (D8=2).
const fixtureProfile = prof({ D1: 1, D2: 1, D3: 0, D4: 1, D5: 2, D6: 1, D7: 1, D8: 2 })

// ── End-to-end: the fixture VISION drives a posture through the inlined mapping ──
test('T2 e2e: a mocked Alpha profile from the fixture VISION yields posture(profile, CONFIG) — the mapping ran IN-SCRIPT', async () => {
  // Sanity: the fixture exists and the intended profile is itself valid.
  assert.match(readFileSync(FIXTURE, 'utf8'), /Team Expense Tracker/)
  assert.equal(validateProfile(fixtureProfile).ok, true)

  // D8=2 in the fixture would trigger a second scorer; here the second scorer returns null so the
  // primary profile stands unchanged — keeping this case a clean single-scorer mapping check.
  const { result, ledgerCmds } = await runGauge(baseArgs, (label) => {
    if (label === 'alpha:assess') return { reasoning: 'standard team app', profile: fixtureProfile }
    return null // cross-family second scorer unavailable → primary stands
  })

  assert.deepEqual(result.profile, fixtureProfile)
  assert.deepEqual(result.posture, referencePosture(fixtureProfile, CONFIG))
  assert.equal(result.override_applied, null)
  // Concrete expectations from the table for THIS profile (proves real mapping, not echo):
  assert.equal(result.posture.planning, 'single+redteam')         // D4=1 ∨ D8≥1, dual not triggered
  assert.equal(result.posture.research_topics_max, 4)              // base 2 + D3 0 + D5 2
  assert.equal(result.posture.plan_validation_rounds, 3)          // 1 + (D2≥1) + (D8=2)
  assert.equal(result.posture.slice_budget_hours, 0.5)           // 2 × 0.5 × 0.5 (D7≥1)
  assert.equal(result.posture.review.ui_effort_base, 'high')      // D8≥1
  assert.equal(result.posture.browser.tier2_per_milestone, true)  // D7≥1 ∨ D8≥1
  assert.equal(result.posture.validate.adversarial_pass, true)    // D8=2
  assert.equal(result.posture.validate.second_family, true)       // D8=2
  assert.equal(result.posture.effort_bias, 2)                     // max(D3,D4,D8)=2
  // pluginRoot absent → no ledger command attempted (degrade-to-log).
  assert.equal(ledgerCmds.length, 0)
})

// ── Override 'max' maps an all-ceiling profile; 'fast' an all-floor profile — both via the inlined posture ──
test("T2 override 'max' forces every dial to ceiling; 'fast' to the floor — independent of the assessed profile", async () => {
  // Assessor returns a tiny/trivial profile; the override must ignore it.
  const trivial = prof()
  const respond = (label) => label.startsWith('alpha:assess') ? { reasoning: 't', profile: trivial } : null

  const max = await runGauge({ ...baseArgs, postureOverride: 'max' }, respond)
  assert.deepEqual(max.result.posture, referencePosture(prof({ D1: 2, D2: 2, D3: 2, D4: 2, D5: 2, D6: 2, D7: 2, D8: 2 }), CONFIG))
  assert.equal(max.result.override_applied, 'max')
  // But the RETURNED profile is still the honestly-assessed one — override shapes posture, not truth.
  assert.deepEqual(max.result.profile, trivial)

  const fast = await runGauge({ ...baseArgs, postureOverride: 'fast' }, respond)
  assert.deepEqual(fast.result.posture, referencePosture(prof(), CONFIG))
  assert.equal(fast.result.override_applied, 'fast')
  // Floors hold under 'fast': goal-backward audit always on; consistency gate is a floor (absent here).
  assert.equal(fast.result.posture.milestone_gate.goal_backward, true)
  assert.equal(fast.result.posture.planning, 'single')
  assert.equal(fast.result.posture.plan_validation_rounds, 1)
})

test('T2 override: an unrecognised postureOverride is treated as null (no override)', async () => {
  const respond = (label) => label.startsWith('alpha:assess') ? { reasoning: 'x', profile: fixtureProfile } : null
  const { result } = await runGauge({ ...baseArgs, postureOverride: 'turbo' }, respond)
  assert.equal(result.override_applied, null)
  assert.deepEqual(result.posture, referencePosture(fixtureProfile, CONFIG))
})

// ── Invalid profile → ONE re-ask → conservative all-mid default; the stage never fails ──
test('T2 robustness: invalid profile re-asks once, then succeeds — the second answer is used', async () => {
  let calls = 0
  const { result } = await runGauge(baseArgs, (label) => {
    if (label === 'alpha:assess') { calls++; return { reasoning: 'oops', profile: prof({ D9: 1 }) } } // unknown key → invalid
    if (label === 'alpha:assess-retry') { calls++; return { reasoning: 'fixed', profile: fixtureProfile } }
    return null
  })
  assert.equal(calls, 2, 'the workflow must re-ask exactly once when the first profile is invalid')
  assert.deepEqual(result.profile, fixtureProfile)
  assert.deepEqual(result.posture, referencePosture(fixtureProfile, CONFIG))
})

test('T2 robustness: still-invalid after the re-ask → conservative all-mid profile, posture errs toward scrutiny, stage never fails', async () => {
  const { result, log } = await runGauge(baseArgs, (label) => {
    if (label.startsWith('alpha:assess')) return null // both attempts produce nothing usable
    return null
  })
  // Conservative default is an all-1 profile.
  const allMid = {}
  for (let i = 1; i <= 8; i++) allMid[`D${i}`] = result.profile[`D${i}`]
  for (let i = 1; i <= 8; i++) assert.equal(result.profile[`D${i}`].score, 1)
  assert.deepEqual(result.posture, referencePosture(prof({ D1: 1, D2: 1, D3: 1, D4: 1, D5: 1, D6: 1, D7: 1, D8: 1 }), CONFIG))
  assert.ok(log.some((l) => /WARNING/.test(l)), 'the degraded fallback must be logged as a warning')
  assert.equal(result.override_applied, null)
})

// ── D8=2 second-scorer deterministic per-dimension max-reconcile (higher score wins; both evidence kept) ──
test('T2 high-stakes: at D8=2 a second scorer reconciles per dimension — max score wins, both evidence strings kept', async () => {
  // primary: D8=2, D3=0, D4=1. second (fresh, same-family since codex off): D3=2, D4=0, D8=2.
  const primary = prof({ D1: 1, D4: 1, D8: 2, D3: 0 })
  const second = prof({ D3: 2, D4: 0, D8: 2 })
  primary.D3 = { score: 0, evidence: 'PRIMARY says known CRUD' }
  second.D3 = { score: 2, evidence: 'SECOND says novel algorithm' }

  let secondCalled = 0
  const { result, log } = await runGauge(baseArgs, (label) => {
    if (label === 'alpha:assess') return { reasoning: 'p', profile: primary }
    if (label === 'alpha:assess-cross-fresh') { secondCalled++; return { reasoning: 's', profile: second } }
    return null
  })

  assert.equal(secondCalled, 1, 'codexAvailable=false must spawn the FRESH same-family second scorer at D8=2')
  // per-dimension max: D3 → 2 (second wins), D4 → 1 (primary wins), D8 → 2 (tie).
  assert.equal(result.profile.D3.score, 2)
  assert.equal(result.profile.D4.score, 1)
  assert.equal(result.profile.D8.score, 2)
  // the winning evidence leads, both strings are kept (joined) when they differ.
  assert.match(result.profile.D3.evidence, /SECOND says novel algorithm/)
  assert.match(result.profile.D3.evidence, /PRIMARY says known CRUD/)
  // the reconciled profile drives the posture.
  assert.deepEqual(result.posture, referencePosture(prof({ D1: 1, D2: 0, D3: 2, D4: 1, D5: 0, D6: 0, D7: 0, D8: 2 }), CONFIG))
  assert.ok(log.some((l) => /second independent scorer/i.test(l)))
})

test('T2 high-stakes: D8<2 never spawns a second scorer', async () => {
  let secondCalled = 0
  await runGauge(baseArgs, (label) => {
    if (label === 'alpha:assess') return { reasoning: 'p', profile: prof({ D8: 1, D3: 2 }) }
    if (label.startsWith('alpha:assess-cross')) { secondCalled++; return null }
    return null
  })
  assert.equal(secondCalled, 0, 'the second scorer is gated strictly on D8=2')
})

test('T2 high-stakes: a flaky second scorer (invalid profile) is discarded; the primary stands', async () => {
  const primary = prof({ D8: 2, D3: 0 })
  const { result } = await runGauge(baseArgs, (label) => {
    if (label === 'alpha:assess') return { reasoning: 'p', profile: primary }
    if (label === 'alpha:assess-cross-fresh') return { reasoning: 'broken', profile: prof({ D9: 2 }) } // invalid
    return null
  })
  assert.deepEqual(result.profile, primary)
  assert.deepEqual(result.posture, referencePosture(primary, CONFIG))
})

// eventOf — parse the kiln-state event JSON embedded (single-quoted, shell-escaped) in a ledger cmd.
const eventOf = (cmd) => JSON.parse(cmd.slice(cmd.indexOf("'") + 1, cmd.lastIndexOf("'")).replace(/'\\''/g, "'"))

// ── The ledger legs: with pluginRoot present the gauge brackets its run (stage_started at entry,
// posture_set in The Ledger, stage_completed on the genuine-completion path) — ─────────
test('T2 ledger: pluginRoot present → Thoth brackets the run (stage_started · posture_set · stage_completed) with the C1 lore beats riding between', async () => {
  const { ledgerCmds } = await runGauge(
    { ...baseArgs, pluginRoot: '/abs/plugin/root' },
    (label) => label === 'alpha:assess' ? { reasoning: 'x', profile: fixtureProfile } : null
  )
  const evs = ledgerCmds.map(eventOf)
  // The lifecycle brackets in order — lore notes ride BETWEEN them but never displace the brackets.
  const lifecycle = evs.filter((e) => e.type !== 'note')
  assert.deepEqual(lifecycle.map((e) => e.type), ['stage_started', 'posture_set', 'stage_completed'],
    'the entry bracket precedes the posture, and the completion bracket follows it')
  // C1 lore beats: the posture_set keystone + the D8=2 second-scorer beat this fixture triggers.
  const beats = evs.filter((e) => e.type === 'note' && e.data && e.data.kind === 'lore')
  const keys = beats.map((b) => b.data.key)
  assert.ok(keys.includes('gauge.posture_set'), 'the gauge.posture_set keystone rides the ledger')
  assert.ok(keys.includes('gauge.second_scorer'), 'the D8=2 fixture triggers the second-scorer beat')
  for (const b of beats) {
    assert.match(b.data.key, /^[a-z]+\.[a-z_]+$/, 'a lore key is <stage>.<beat_name>')
    assert.equal(typeof b.data.text, 'string', 'a lore beat carries a text line')
  }
  for (const cmd of ledgerCmds) {
    assert.match(cmd, /\/abs\/plugin\/root\/scripts\/kiln-state\.mjs append/)
    assert.match(cmd, /\/tmp\/nonexistent-kiln\/\.kiln/)
  }
  for (const e of evs) assert.equal(e.stage, 'gauge', 'every gauge event carries stage:gauge (drives the projection fold)')
  // the posture_set still carries the full posture + assessed profile
  const posture = evs.find((e) => e.type === 'posture_set')
  assert.deepEqual(posture.data.posture, referencePosture(fixtureProfile, CONFIG))
  assert.deepEqual(posture.data.profile, fixtureProfile)
  // the posture_set keystone beat renders BEFORE the stage_completed terminator (telegraph ordering)
  const beatIdx = evs.findIndex((e) => e.type === 'note' && e.data.key === 'gauge.posture_set')
  const doneIdx = evs.findIndex((e) => e.type === 'stage_completed')
  assert.ok(beatIdx > -1 && beatIdx < doneIdx, 'the posture_set beat precedes stage_completed')
})
