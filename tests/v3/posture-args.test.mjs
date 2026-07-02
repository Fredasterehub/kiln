// posture-args.test.mjs — T3 acceptance: the GENERATED workflows/research.js and
// workflows/architecture.js READ the posture-derived args the conductor now passes (research:
// `topicsMax`; architecture: `planning`, `validationRounds`) — AND, with the args absent, behave
// EXACTLY as before (no behavior change without a posture). This is the "unit-test the arg
// plumbing where extractable" half of the T3 contract; the conductor SKILL.md changes (the Gauge
// stage, the Rigor card, the stage-table arg notes) are prose, asserted by the bundler/harness
// staying green and by review against the §3.2 table.
//
// Each workflow is executed exactly as the runtime evaluates it (and as dry-run-runner.mjs /
// gauge-workflow.test.mjs do): the leading `export ` is stripped off `export const meta`, the body
// becomes an AsyncFunction whose parameters are the workflow globals, and stubs are passed
// positionally. `agent` is a programmable mock keyed off the call's `label`; every call's label is
// recorded so we can prove which branch ran. parallel/pipeline mirror the runtime's per-item fault
// isolation. No network, no disk, no real agents.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RESEARCH = fileURLToPath(new URL('../../plugins/kiln/workflows/research.js', import.meta.url))
const ARCHITECTURE = fileURLToPath(new URL('../../plugins/kiln/workflows/architecture.js', import.meta.url))

const AsyncFunction = (async () => {}).constructor
const bodyOf = (file) => readFileSync(file, 'utf8').replace(/^export const meta\b/m, 'const meta')

// runWorkflow — execute a generated workflow with injected globals and a programmable `agent` mock.
// `respond(label, prompt) → result|null` decides each agent() call's return value (keyed on label).
// Returns { result, log, calls }: the workflow's return, the log lines, and every {label, prompt}.
async function runWorkflow(file, args, respond) {
  const log = []
  const calls = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    calls.push({ label, prompt })
    return respond(label, prompt)
  }
  const stubs = {
    args,
    phase: () => {},
    log: (s) => log.push(String(s)),
    agent,
    // real per-item fault isolation, mirroring the runtime
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async (items, ...stages) => {
      const out = []
      for (const [i, it] of items.entries()) {
        let v = it
        for (const s of stages) { v = await Promise.resolve(s(v, it, i)).catch(() => null); if (v === null) break }
        out.push(v)
      }
      return out
    },
    budget: undefined,
    workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, bodyOf(file))
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, log, calls }
}

const baseArgs = { kilnDir: '/tmp/nonexistent-kiln/.kiln', projectPath: '/tmp/nonexistent-kiln', codexAvailable: false }
const labelsIn = (calls) => calls.map((c) => c.label)
const count = (calls, label) => calls.filter((c) => c.label === label).length

// ── RESEARCH: `topicsMax` caps the topic count; absent ⇒ historical cap of 5 ───────────────────

// mi6:topics returns N topics; research slices to MAX_TOPICS, so the returned slug list proves the cap.
const nTopics = (n) => ({
  reasoning: 'r',
  topics: Array.from({ length: n }, (_, i) => ({
    slug: `t${i + 1}`, title: `Topic ${i + 1}`, question: 'q?', priority: 'high', acceptance_criteria: 'ac',
  })),
})
// A minimal synthesis result so the stage returns cleanly after the (empty) field work.
const synthOk = { reasoning: 's', research_file: '/x/research.md', topic_files: [], headline_findings: [], topics_written: 0 }
const researchRespond = (topicsResult) => (label) => {
  if (label === 'mi6:topics') return topicsResult
  if (label === 'mi6:synthesis') return synthOk
  return null // field operatives unused: pipeline still runs but findings are dropped to null
}

test('T3 research: topicsMax caps the investigated topic count below the historical 5', async () => {
  // Director offers 5; posture cap is 2 → exactly 2 survive.
  const { result, calls } = await runWorkflow(RESEARCH, { ...baseArgs, topicsMax: 2 }, researchRespond(nTopics(5)))
  assert.deepEqual(result.topics, ['t1', 't2'], 'topicsMax=2 must cap the 5 offered topics to the 2 most important')
  // The director's brief states the posture ceiling, not the historical 5.
  const brief = calls.find((c) => c.label === 'mi6:topics').prompt
  assert.match(brief, /hard ceiling of 2 topic/, 'the scoping brief must name the posture cap, not 5')
})

test('T3 research: topicsMax absent ⇒ the VERBATIM v2 brief + behavior (no behavior change without a posture)', async () => {
  // T3 contract (tasks.md): an absent optional arg must default to CURRENT behavior. Without a
  // posture, research must run the v2 scoping model byte-for-byte — "between 2 and 5 topics" sourced
  // from OQs PLUS load-bearing unknowns — NOT the §3.2 OQ-only/zero-floor model the posture switches
  // on. This is the guard against the cycle-1 over-reach (the topic-sourcing model had changed
  // unconditionally; it must change only when the Gauge supplied a cap).
  const { result, calls } = await runWorkflow(RESEARCH, { ...baseArgs }, researchRespond(nTopics(7)))
  assert.equal(result.topics.length, 5, 'with no topicsMax, the historical cap of 5 must stand')
  const brief = calls.find((c) => c.label === 'mi6:topics').prompt
  // The v2 brief: "Return between 2 and 5 topics" + the load-bearing-unknowns instruction.
  assert.match(brief, /Return between 2 and 5 topics/, 'the no-posture brief must be the verbatim v2 "between 2 and 5 topics" brief')
  assert.match(brief, /load-bearing unknowns in Tech Stack, Constraints, and Risks/, 'the no-posture brief must keep the v2 load-bearing-unknowns topic source')
  // P4 T4 (a): the historical brief now carries the frontmatter-OQ alternative the posture brief has
  // always had — the two briefs agree on BOTH OQ encodings (a "OQ-N" body line OR a frontmatter entry).
  assert.match(brief, /or YAML frontmatter OQ entry/, 'the historical brief must accept the frontmatter OQ encoding too (P4 T4 (a))')
  // And it must NOT carry the posture-only §3.2 instructions (those would change v2 behavior).
  assert.doesNotMatch(brief, /EMPTY topics list/, 'no-posture brief must NOT instruct the zero-topics branch (that is posture-only)')
  assert.doesNotMatch(brief, /hard ceiling/, 'no-posture brief must NOT use the posture cap wording')
})

test('T3 research: a low topicsMax caps to one topic without a spurious lower floor', async () => {
  const { result, calls } = await runWorkflow(RESEARCH, { ...baseArgs, topicsMax: 1 }, researchRespond(nTopics(5)))
  assert.deepEqual(result.topics, ['t1'], 'topicsMax=1 caps to a single topic')
  const brief = calls.find((c) => c.label === 'mi6:topics').prompt
  assert.match(brief, /hard ceiling of 1 topic/, 'the cap drives the ceiling; no spurious "between 2 and 1" floor')
})

test('T3 research: a garbage topicsMax is ignored (falls back to the historical cap)', async () => {
  for (const bad of [0, -3, 2.5, 'three', null]) {
    const { result } = await runWorkflow(RESEARCH, { ...baseArgs, topicsMax: bad }, researchRespond(nTopics(7)))
    assert.equal(result.topics.length, 5, `topicsMax=${JSON.stringify(bad)} must be ignored and fall back to 5`)
  }
})

test('T3 research: WITH a posture, zero qualifying OQs ⇒ zero topics (the §3.2 0-if-no-OQs branch)', async () => {
  // BLUEPRINT §3.2 research row: `topics = 0 if no high-priority before-build OQs`. This branch is
  // POSTURE-GATED — it is reachable only because a topicsMax cap was supplied (the Gauge ran). The
  // director returns an empty topic list when none qualify; the stage must finish with empty results,
  // write no research.md, and never floor the count back up to a spurious minimum.
  const { result, calls } = await runWorkflow(RESEARCH, { ...baseArgs, topicsMax: 4 }, researchRespond(nTopics(0)))
  assert.deepEqual(result.topics, [], 'no qualifying OQs ⇒ no topics')
  assert.equal(result.research_file, null, 'zero topics ⇒ no research.md is written')
  // The posture scope brief must tell the director to return an empty list when no OQ qualifies.
  const brief = calls.find((c) => c.label === 'mi6:topics').prompt
  assert.match(brief, /EMPTY topics list/, 'the posture brief must instruct returning an empty list when no OQ qualifies')
  assert.match(brief, /never return more topics than there are qualifying OQs/, 'the posture brief must bound the count by qualifying-OQ count (min(OQ-count, cap))')
})

// ── ARCHITECTURE: `planning` decides single-vs-dual; `validationRounds` sets the revision count ──

// Foundation result with a chosen scope. has_visual_direction:false skips the design:tokens leg.
const foundation = (scope) => ({
  reasoning: 'f', architecture_file: '/x/architecture.md', tech_stack_file: '/x/tech-stack.md',
  arch_constraints_file: '/x/arch-constraints.md', has_visual_direction: false, scope,
  estimated_milestones: 1, summary: 'sum',
})
const planResult = (slot) => ({ reasoning: 'p', slot, plan_file: `/x/plan-${slot}.md`, approach_summary: 'a', milestones: [{ id: 'M1', title: 'T', summary: 's' }], key_decisions: [] })
const divergenceResult = { reasoning: 'd', analysis_file: '/x/div.md', consensus: [], divergences: [], unique_insights: [] }
const synthResult = { reasoning: 's', master_plan_file: '/x/master-plan.md', milestone_count: 1, milestones: [{ id: 'M1', title: 'T', surface: 'logic', confidence: 'high' }], confidence_summary: 'c' }
const validateResult = (verdict) => ({ reasoning: 'v', verdict, failed_dimensions: verdict === 'FAIL' ? ['x'] : [], fixes: [] })

// archRespond — drive a full architecture run. `athenaVerdict` lets a test force FAIL to count rounds.
// `researchMissing` lets a test simulate the §3.2 zero-topics route (no research.md on disk). The
// thoth:research-check probe runs an `ls` and returns missing=[] when present, [path] when absent;
// default here is PRESENT (the normal route most tests exercise).
const archRespond = (scope, athenaVerdict = 'PASS', researchMissing = false) => (label) => {
  if (label === 'thoth:research-check') return { reasoning: 'ls', missing: researchMissing ? ['/x/research.md'] : [] }
  if (label === 'numerobis:foundation') return foundation(scope)
  if (label === 'confucius:plan') return planResult('a')
  if (label === 'sun-tzu:plan' || label === 'miyamoto:plan') return planResult('b')
  if (label === 'diogenes:divergence') return divergenceResult
  if (label === 'plato:synthesis' || label.startsWith('plato:revise')) return synthResult
  if (label.startsWith('athena:validate')) return validateResult(athenaVerdict)
  if (label === 'numerobis:handoff') return null
  if (label === 'thoth:verify') return { reasoning: 'ok', missing: [] }
  return null
}
const councilRan = (calls) => labelsIn(calls).includes('confucius:plan') || labelsIn(calls).includes('sun-tzu:plan') || labelsIn(calls).includes('miyamoto:plan')

test("T3 architecture: planning='dual' runs The Council even when foundation scope is trivial", async () => {
  const { calls, result } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'dual' }, archRespond('trivial'))
  assert.ok(councilRan(calls), "planning='dual' must run the dual-plan council regardless of scope")
  // Seat identity under codexAvailable:false — the fallback is Miyamoto's seat, never Sun Tzu's.
  assert.ok(labelsIn(calls).includes('miyamoto:plan'), 'the no-codex slot-B must run as miyamoto:plan')
  assert.ok(!labelsIn(calls).includes('sun-tzu:plan'), 'crediting Sun Tzu without codex is a ghost credit')
  assert.ok(labelsIn(calls).includes('diogenes:divergence'), 'the divergence step runs when both plans land')
  assert.equal(result.lite_path, false)
})

test("T3 architecture: planning='single' takes the lite path even when foundation scope is complex", async () => {
  const { calls, result, log } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single' }, archRespond('complex'))
  assert.ok(!councilRan(calls), "planning='single' must skip The Council regardless of scope")
  assert.equal(result.lite_path, true)
  assert.ok(log.some((l) => /Posture planning='single'/.test(l)), 'the lite-path log must attribute the choice to the posture')
})

test("T3 architecture: planning='single+redteam' also takes the lite path (red-team is a later phase)", async () => {
  const { calls, result } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single+redteam' }, archRespond('complex'))
  assert.ok(!councilRan(calls), "'single+redteam' routes like single in this phase")
  assert.equal(result.lite_path, true)
})

test('T3 architecture: planning absent ⇒ foundation scope decides (historical behavior unchanged)', async () => {
  // trivial scope, no posture → lite path (as before)
  const trivial = await runWorkflow(ARCHITECTURE, { ...baseArgs }, archRespond('trivial'))
  assert.ok(!councilRan(trivial.calls), 'no posture + trivial scope ⇒ lite path, as before')
  assert.equal(trivial.result.lite_path, true)
  assert.ok(trivial.log.some((l) => /Scope='trivial'/.test(l)), 'the historical log must still attribute lite to scope')

  // standard scope, no posture → council runs (as before)
  const standard = await runWorkflow(ARCHITECTURE, { ...baseArgs }, archRespond('standard'))
  assert.ok(councilRan(standard.calls), 'no posture + non-trivial scope ⇒ The Council runs, as before')
  assert.equal(standard.result.lite_path, false)
})

test('T3 architecture: validationRounds is the Athena VALIDATION-PASS count, not a revision count', async () => {
  // BLUEPRINT §3.2: plan_validation_rounds = `1 + (D2>=1) + (D8=2)` is the number of Athena passes.
  // athena always FAILs → the loop runs exactly `validationRounds` passes (round 0..rounds-1) and
  // `validationRounds - 1` plato revisions. posture rounds=3 ⇒ 3 passes / 2 revisions (NOT 4/3).
  const forced = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'dual', validationRounds: 3 }, archRespond('standard', 'FAIL'))
  assert.equal(count(forced.calls, 'athena:validate:r0') + count(forced.calls, 'athena:validate:r1') + count(forced.calls, 'athena:validate:r2') + count(forced.calls, 'athena:validate:r3'), 3,
    'validationRounds=3 must run exactly 3 athena passes (rounds 0..2), not 4')
  // exactly validationRounds-1 plato revisions (a revision happens only between two passes)
  assert.equal(count(forced.calls, 'plato:revise:r1') + count(forced.calls, 'plato:revise:r2') + count(forced.calls, 'plato:revise:r3'), 2,
    'validationRounds=3 ⇒ 2 plato revisions, not 3')
})

test('T3 architecture: validationRounds=1 runs exactly one pass and zero revisions', async () => {
  // The minimum the §3.2 formula yields (D2=0, D8<2) is plan_validation_rounds=1: ONE validation
  // pass, NO plato revision. The old off-by-one would have run 2 passes here.
  const one = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single', validationRounds: 1 }, archRespond('trivial', 'FAIL'))
  const athenaPasses = labelsIn(one.calls).filter((l) => l.startsWith('athena:validate')).length
  assert.equal(athenaPasses, 1, 'validationRounds=1 ⇒ exactly one athena pass')
  assert.equal(labelsIn(one.calls).filter((l) => l.startsWith('plato:revise')).length, 0, 'validationRounds=1 ⇒ zero plato revisions')
})

test('T3 architecture: validationRounds absent on the dual path ⇒ historical 3 passes', async () => {
  const def = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'dual' }, archRespond('standard', 'FAIL'))
  const athenaPasses = labelsIn(def.calls).filter((l) => l.startsWith('athena:validate')).length
  assert.equal(athenaPasses, 3, 'no validationRounds on the dual path ⇒ 3 athena passes (v2 behavior unchanged)')
})

test('T3 architecture: validationRounds absent on the lite path ⇒ historical 2 passes', async () => {
  const lite = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single' }, archRespond('trivial', 'FAIL'))
  const athenaPasses = labelsIn(lite.calls).filter((l) => l.startsWith('athena:validate')).length
  assert.equal(athenaPasses, 2, 'no validationRounds on the lite path ⇒ 2 athena passes (v2 behavior unchanged)')
})

test('T3 architecture: a garbage validationRounds is ignored (falls back to the path default)', async () => {
  for (const bad of [0, -1, 1.5, 'two']) {
    const r = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'dual', validationRounds: bad }, archRespond('standard', 'FAIL'))
    const athenaPasses = labelsIn(r.calls).filter((l) => l.startsWith('athena:validate')).length
    assert.equal(athenaPasses, 3, `validationRounds=${JSON.stringify(bad)} must be ignored ⇒ dual-path default of 3 passes`)
  }
})

test('T3 architecture: an unrecognised planning value is treated as null (scope decides)', async () => {
  const { calls, result } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'turbo' }, archRespond('trivial'))
  assert.ok(!councilRan(calls), "unrecognised planning ⇒ null ⇒ scope decides (trivial ⇒ lite)")
  assert.equal(result.lite_path, true)
})

// ── ARCHITECTURE: research.md is OPTIONAL (the §3.2 zero-topics route writes none) ───────────────
// Finding-1 guard: research can scope to zero topics and write no research.md (research_file: null).
// Architecture must self-detect that (thoth:research-check `ls` probe) and never point an agent at a
// phantom file. We assert on the prompts the agents receive.
const researchPath = '/tmp/nonexistent-kiln/.kiln/docs/research.md'

test('T3 architecture: research.md PRESENT ⇒ agents are pointed at it (normal route unchanged)', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'dual' }, archRespond('standard', 'PASS', false))
  const foundationPrompt = calls.find((c) => c.label === 'numerobis:foundation').prompt
  assert.ok(foundationPrompt.includes(researchPath), 'with research present, the foundation prompt names research.md')
  assert.match(foundationPrompt, /Ground every decision in the research/, 'present ⇒ the citation instruction stands')
  // Every council-path prompt that grounds in research must carry the real path, never a placeholder.
  const planPrompt = calls.find((c) => c.label === 'confucius:plan').prompt
  assert.ok(planPrompt.includes(researchPath), 'the planner brief names research.md when present')
})

test('T3 architecture: research.md ABSENT ⇒ no phantom path; agents grounded in VISION (Finding-1 fix)', async () => {
  const { calls, log } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'dual' }, archRespond('standard', 'PASS', true))
  // The probe must have run and the stage must have logged the no-research grounding.
  assert.ok(labelsIn(calls).includes('thoth:research-check'), 'architecture must probe for research.md existence')
  assert.ok(log.some((l) => /Research input: none/.test(l)), 'the stage logs that it is grounding in VISION when research is absent')
  // NO agent prompt may reference the phantom research.md path.
  const grounding = ['numerobis:foundation', 'confucius:plan', 'sun-tzu:plan', 'miyamoto:plan', 'plato:synthesis']
  for (const lbl of grounding) {
    const c = calls.find((x) => x.label === lbl)
    if (!c) continue
    assert.ok(!c.prompt.includes(researchPath), `${lbl} must NOT reference a non-existent research.md`)
  }
  // The foundation prompt must explicitly redirect grounding to VISION (no "cite the research" demand).
  const foundationPrompt = calls.find((c) => c.label === 'numerobis:foundation').prompt
  assert.doesNotMatch(foundationPrompt, /Ground every decision in the research \(cite/, 'absent ⇒ the citation demand is dropped')
  assert.match(foundationPrompt, /ground every decision in VISION\.md/, 'absent ⇒ the prompt redirects grounding to VISION.md')
})

// ── ARCHITECTURE T3 velocity levers: design:tokens ∥ The Council (lever 6) + handoff fold (lever 5) ──

// archRespondVD — like archRespond but the foundation reports a real Visual Direction, so the
// design:tokens leg runs. It returns null (its writes are out-of-band); the existence check passes.
const archRespondVD = (scope, athenaVerdict = 'PASS') => (label) => {
  const base = archRespond(scope, athenaVerdict)(label)
  if (label === 'numerobis:foundation') return { ...foundation(scope), has_visual_direction: true }
  return base
}

test('T3 lever 6: design:tokens runs (visual direction present) and is launched as a parallel leg, awaited before the stage closes', async () => {
  const { calls, log, result } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'dual' }, archRespondVD('standard'))
  assert.ok(labelsIn(calls).includes('design:tokens'), 'design:tokens runs when VISION carries a visual direction')
  assert.equal(result.has_visual_direction, true)
  assert.ok(log.some((l) => /Design tokens launching in parallel/.test(l)), 'lever 6: the design leg is launched in parallel')
  assert.ok(log.some((l) => /Design tokens generated/.test(l)), 'the parallel design leg is awaited (and confirmed) before the stage closes')
})

test('T3 lever 6: no visual direction ⇒ design:tokens never runs (the leg stays conditional)', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'dual' }, archRespond('standard'))
  assert.ok(!labelsIn(calls).includes('design:tokens'), 'no design tokens without a visual direction')
})

test('T3 lever 5: on the LITE path the handoff is folded into Plato\'s synthesis — NO numerobis:handoff agent', async () => {
  const { calls, log } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single' }, archRespond('complex'))
  assert.ok(!labelsIn(calls).includes('numerobis:handoff'), 'lite path: no dedicated handoff agent')
  const synth = calls.find((c) => c.label === 'plato:synthesis').prompt
  assert.match(synth, /architecture-handoff\.md/, 'Plato\'s synthesis brief carries the folded handoff')
  assert.match(synth, /Rewrite it whenever you rewrite the plan/, 'the fold rides every Plato write so the handoff never drifts from the final plan')
  assert.ok(log.some((l) => /Handoff folded into Plato/.test(l)), 'the lever-5 fold is logged')
})

test('T3 lever 5: the fold also rides every plato:revise on the lite path (so a revised plan keeps a matching handoff)', async () => {
  // force Athena FAIL so a plato:revise fires; lite path → 2 validation passes / 1 revision.
  const { calls } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single' }, archRespond('complex', 'FAIL'))
  const revise = calls.find((c) => c.label.startsWith('plato:revise'))
  assert.ok(revise, 'a plato:revise fires on the lite path when Athena FAILs')
  assert.match(revise.prompt, /architecture-handoff\.md/, 'the revise brief re-folds the handoff so it matches the revised plan')
})

test('T3 lever 5: the FULL (council) path KEEPS the dedicated numerobis:handoff agent — and does NOT fold it into synthesis', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'dual' }, archRespond('standard'))
  assert.ok(labelsIn(calls).includes('numerobis:handoff'), 'full path: the dedicated handoff pass is kept (lever 5 is partial)')
  const synth = calls.find((c) => c.label === 'plato:synthesis').prompt
  assert.doesNotMatch(synth, /architecture-handoff\.md/, 'full path: Plato does NOT fold the handoff (the dedicated agent owns it)')
})

// ── P4 T4 consumer alignment: the visualDirection thread (d) + athena reads VISION (c) ───────────
const visionPath = '/tmp/nonexistent-kiln/.kiln/docs/VISION.md'

test('T4 (c): athena:validate reads VISION for the completeness-vs-goals ruling', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single' }, archRespond('trivial'))
  const av = calls.find((c) => c.label.startsWith('athena:validate')).prompt
  assert.ok(av.includes(visionPath), 'the validator now has VISION in her read list — she rules completeness vs VISION goals')
})

test('T4 (d): a threaded visualDirection arg IS has_visual_direction — the foundation agent is not consulted', async () => {
  // arg=true even though the foundation reports has_visual_direction:false → the arg wins in the SCRIPT
  const argTrue = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single', visualDirection: true }, archRespond('trivial'))
  assert.equal(argTrue.result.has_visual_direction, true, 'the conductor-threaded arg wins over the foundation judgment')
  assert.ok(labelsIn(argTrue.calls).includes('design:tokens'), 'arg=true forces the design leg even when foundation said false')
  const fpTrue = argTrue.calls.find((c) => c.label === 'numerobis:foundation').prompt
  assert.match(fpTrue, /set has_visual_direction=true verbatim/, 'the foundation agent is TOLD the answer, not asked to judge it')
  assert.doesNotMatch(fpTrue, /decline line/, 'the decline-byte judgment is not asked when the arg is threaded')

  // arg=false even though the foundation reports has_visual_direction:true → the arg wins, design leg skipped
  const argFalse = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single', visualDirection: false }, archRespondVD('trivial'))
  assert.equal(argFalse.result.has_visual_direction, false, 'arg=false overrides a foundation true')
  assert.ok(!labelsIn(argFalse.calls).includes('design:tokens'), 'arg=false skips the design leg even when foundation said true')
})

test('T4 (d): absent visualDirection ⇒ the foundation agent judges, given the EXACT decline bytes', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, { ...baseArgs, planning: 'single' }, archRespond('trivial'))
  const fp = calls.find((c) => c.label === 'numerobis:foundation').prompt
  assert.match(fp, /whether the VISION Visual Direction section contains real Visual Direction/, 'absent ⇒ the agent is asked to judge (the pre-v3 fallback)')
  assert.match(fp, /No visual direction specified\. Build will proceed without design system generation\./, 'the EXACT decline bytes are quoted, not the elided "..." the scout flagged')
  assert.doesNotMatch(fp, /section 12/, 'the "section 12" reference is retired (v3 renumbered)')
})
