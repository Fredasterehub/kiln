// build-spine.test.mjs — P2 T2 acceptance: the GENERATED workflows/build.js drives the batch
// slice spine through its INLINED pure core (validateSlicePlan + runnerGate + rejectionClass +
// escalate + GAUGE_CONFIG) with every agent MOCKED. Exercises the contract's load-bearing wiring:
//   · the §3.4 floor gates (no pluginRoot / unlocked Law → escalation return, zero ungated builds)
//   · ONE batch krs-one:slice-plan call per milestone, coverage re-asked once on gaps, then escalated
//   · the haiku krs-one:confirm and the single ledgered replan-for-the-remainder
//   · the TAMPER drill: kiln-law exit 2 → slice auto-REJECTED, NO reviewer spawned, the tamper
//     event LEDGERED (§5.1), fix brief names the touched lock
//   · the FRESHNESS gate (§6): evidence hashes/timestamps compared against HEAD in-script — HEAD
//     moved, results.jsonl missing, manifest from another commit, hash mismatch, unfinalized run,
//     evidence predating HEAD → auto-REJECTED, NO reviewer spawned
//   · the §6 evidence-first review (independent kiln-law rerun in the prompt) + codex effort dial
//     (medium baseline, high on posture D8 / fix-cycle>0)
//   · the RED lifecycle gate (T2-fix: exit code is the verdict): kiln-law run --flips exit 1 →
//     slice auto-REJECTED as 'logical' with NO reviewer spawned, ledgered law_red_auto_reject,
//     fix brief naming the FLIP_UNMET/REGRESSION ids; --flips/--only/--before threaded through
//     the runner prompt with statusBefore anchored in recorded evidence (lastRunId), and the
//     project suite persisted via 'kiln-law suite' (suite.log + suite.jsonl in the evidence dir)
//   · the §3.2 milestone gate: goal-backward audit at EVERY boundary (single-slice AND the
//     split/plan-abort failure branches, where findings merge into the failure record), judge
//     spawned ONLY on an ambiguous reconcile (zero blocking findings + analyst overall verdicts
//     disagree), verdict computed otherwise; the ORCHESTRATOR RULING on unusable audits — ONE
//     re-ask, then QA_FAIL with the blocking 'goal-audit-failure' finding, ledgered, and the
//     judge NEVER spawned on missing inputs; min_slices_for_tribunal + goal_backward posture
//     dials, ledgered gate_skipped on override
//   · the §3.3 Sentinel: feedback-source escalation at 2 logical rejections — per the §8
//     capability ladder, T3+ (codexAvailable ⟺ codex on board) swaps the reviewer FAMILY while
//     T1/T2 (no second family) goes fresh-context stronger effort — ledgered posture_escalated;
//     split_required STOP at 3 (surfaced in the milestone gate + return value)
//
// The workflow runs exactly as the runtime evaluates it (and as dry-run-runner.mjs does): the
// leading `export ` is stripped off `export const meta`, the body becomes an AsyncFunction whose
// parameters are the workflow globals, and stubs are passed positionally. `agent` is a
// programmable mock keyed off the call's `label`; every call records {label, prompt, model}.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKFLOW = fileURLToPath(new URL('../../plugins/kiln/workflows/build.js', import.meta.url))

const AsyncFunction = (async () => {}).constructor
const wfBody = readFileSync(WORKFLOW, 'utf8').replace(/^export const meta\b/m, 'const meta')

// runBuild — execute the generated workflow with injected globals and a programmable agent mock.
// `respond(label, prompt, model) → result|null` decides each call's return (keyed on label).
// Returns { result, log, calls }: the return value, the log lines, and every {label, prompt, model}.
async function runBuild(args, respond) {
  const logLines = []
  const calls = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    const model = (opts && opts.model) || ''
    calls.push({ label, prompt, model })
    return respond(label, prompt, model)
  }
  const stubs = {
    args,
    phase: () => {},
    log: (s) => logLines.push(String(s)),
    agent,
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
  const run = new AsyncFunction(...keys, wfBody)
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, log: logLines, calls }
}

const baseArgs = { kilnDir: '/tmp/kiln-x/.kiln', projectPath: '/tmp/kiln-x', codexAvailable: true, pluginRoot: '/plug' }
const labelsOf = (calls, frag) => calls.filter((c) => c.label.includes(frag))
const count = (calls, frag) => labelsOf(calls, frag).length

// Canned fixtures. ONE logic milestone; the Law carries one or two SCs depending on the test.
const milestone = (over = {}) => ({ id: 'M1', title: 'Core', summary: 's', acceptance: 'a', surface: 'logic', confidence: 'high', ...over })
const lawTwo = [{ id: 'SC-001', milestone: 'M1', kind: 'shell' }, { id: 'SC-002', milestone: 'M1', kind: 'shell' }]
const lawOne = [lawTwo[0]]
const planTwo = [
  { objective: 'add', files: [], constraints: '', done_when: 'add works', sc_ids: ['SC-001'] },
  { objective: 'list', files: [], constraints: '', done_when: 'list works', sc_ids: ['SC-002'] },
]
const planOne = [planTwo[0]]
const buildOk = { reasoning: 'r', tests_green: true, committed: true, evidence: 'ok', test_command: 'npm test' }
const runnerOk = { reasoning: 'r', verify_exit: 0, tamper_paths: [], law_run_exit: 0, flip_unmet: [], regressed: [], run_id: 'RUN1', head: 'abc123', suite_cmd: 'npm test', suite_exit: 0 }
const freshOk = {
  results_jsonl_exists: true, head: 'abc123', head_committed_epoch: 1000,
  manifest_head: 'abc123', manifest_results_sha256: 'feed01', manifest_completed_epoch: 1000,
  results_sha256: 'feed01', manifest_verification_class: 'full',
}
const reviewOk = { reasoning: 'r', verdict: 'APPROVED', law_green: true, tests_green: true, findings: [] }
const rejectLogical = { reasoning: 'r', verdict: 'REJECTED', law_green: false, tests_green: false, findings: [{ text: 'wrong behavior in add()', finding_class: 'logical' }] }
const qaClean = { reasoning: 'r', overall: 'pass', findings: [] }

// mkRespond — the happy-path responder; `over(label, prompt, model)` may return a value (used) or
// undefined (fall through to the defaults).
const mkRespond = (state = {}, over) => (label, prompt, model) => {
  if (over) { const v = over(label, prompt, model); if (v !== undefined) return v }
  if (label.startsWith('asimov:law-read')) return { reasoning: 'r', locked: true, checks: state.law || lawTwo }
  if (label === 'confucius:parse') return { reasoning: 'r', milestones: state.milestones || [milestone()] }
  if (label.startsWith('krs-one:slice-plan')) return { reasoning: 'r', slices: state.plan || planTwo }
  if (label.startsWith('krs-one:confirm')) return { reasoning: 'r', decision: 'proceed' }
  if (label.includes(':build:')) return buildOk
  if (label.startsWith('asimov:runner')) return runnerOk
  if (label.startsWith('thoth:freshness')) return freshOk
  if (label.includes(':review:')) return reviewOk
  if (label === 'thoth:ledger') return { ok: true }
  if (label.startsWith('ken:qa') || label.startsWith('ryu:qa')) return qaClean
  if (label.startsWith('aristotle:goal-backward')) return qaClean
  if (label.startsWith('judge-dredd:verdict')) return { reasoning: 'r', verdict: 'QA_PASS', findings: [] }
  return null // rakim legs, asset prep
}

// ── floor gates ──────────────────────────────────────────────────────────────────────────────────

test('floor gate: pluginRoot absent → escalation return BEFORE any agent call (no ungated build, dry-run-safe)', async () => {
  const { result, calls } = await runBuild({ kilnDir: '/tmp/k/.kiln', projectPath: '/tmp/k' }, mkRespond())
  assert.equal(calls.length, 0)
  assert.equal(result.law_gated, false)
  assert.equal(result.all_passed, false)
  assert.match(result.reason, /pluginRoot/)
})

test('floor gate: unlocked/unreadable Law → escalation return after the law-read alone', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('asimov:law-read')) return { reasoning: 'r', locked: false, checks: [] }
  }))
  assert.equal(calls.length, 1)
  assert.ok(calls[0].label.startsWith('asimov:law-read'))
  assert.equal(result.law_gated, false)
  assert.match(result.reason, /unlocked/)
})

// ── the happy path ───────────────────────────────────────────────────────────────────────────────

test('happy path: ONE batch slice-plan, per-slice confirm→build→runner→probe→review, gate computed QA_PASS — analysts ∥ goal-backward, NO judge spawned on an unambiguous reconcile (§3.2)', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond())
  assert.equal(count(calls, 'krs-one:slice-plan'), 1, 'exactly ONE batch slice-plan call per milestone')
  assert.equal(count(calls, 'krs-one:confirm'), 2)
  assert.equal(count(calls, ':build:'), 2)
  assert.equal(count(calls, 'asimov:runner'), 2)
  assert.equal(count(calls, 'thoth:freshness'), 2)
  assert.equal(count(calls, ':review:'), 2)
  assert.equal(count(calls, 'ken:qa'), 1)
  assert.equal(count(calls, 'ryu:qa'), 1)
  assert.equal(count(calls, 'aristotle:goal-backward'), 1, '§3.2: the goal-backward audit runs at the milestone boundary')
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, '§3.2: zero blocking findings + agreeing analysts ⇒ the verdict is COMPUTED — no judge spend')
  // cross-family on a logic slice with codex: Opus reviews the codex build
  assert.ok(labelsOf(calls, ':review:').every((c) => c.model === 'opus'))
  assert.equal(result.law_gated, true)
  assert.equal(result.built[0].qa, 'QA_PASS')
  assert.equal(result.all_passed, true)
  assert.deepEqual(result.split_required, [])
})

test('evidence-first review: the reviewer prompt carries the SC mapping, the evidence dir, and the MANDATORY independent kiln-law rerun; the runner prompt runs verify before run --only', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond())
  const review = labelsOf(calls, ':review:')[0].prompt
  assert.match(review, /this slice claims SC-001/)
  assert.match(review, /\/tmp\/kiln-x\/\.kiln\/evidence\/RUN1\/results\.jsonl/)
  assert.match(review, /node \/plug\/scripts\/kiln-law\.mjs run \/tmp\/kiln-x \/tmp\/kiln-x\/\.kiln --only SC-001/)
  assert.match(review, /finding/i)
  const runner = labelsOf(calls, 'asimov:runner')[0].prompt
  assert.match(runner, /kiln-law\.mjs verify \/tmp\/kiln-x \/tmp\/kiln-x\/\.kiln/)
  assert.match(runner, /kiln-law\.mjs run \/tmp\/kiln-x \/tmp\/kiln-x\/\.kiln --only SC-001/)
  // the builder gets the lock warning + the outcome-phrased Law line
  const build = labelsOf(calls, ':build:')[0].prompt
  assert.match(build, /DONE only when its mapped checks pass — SC-001/)
  assert.match(build, /NEVER edit, move, or delete/)
})

// ── the §5.1 lifecycle wiring (T2-fix): flipPlan expectations + statusBefore + suite evidence ───

test('flip wiring: every runner step declares --flips; later slices re-run the milestone\'s green SCs (--only cumulative) and anchor statusBefore via --before <recorded runId> — state in evidence, never prose', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond())
  const runners = labelsOf(calls, 'asimov:runner').map((c) => c.prompt)
  assert.equal(runners.length, 2)
  // slice 0: nothing green yet — scope = its own flips, no --before (statusBefore = lock record)
  assert.match(runners[0], /kiln-law\.mjs run \/tmp\/kiln-x \/tmp\/kiln-x\/\.kiln --only SC-001 --flips SC-001/)
  assert.doesNotMatch(runners[0], /--before/)
  // slice 1: SC-001 is green — re-run it for the regression guard, flip SC-002, fold the
  // recorded RUN1 as statusBefore
  assert.match(runners[1], /kiln-law\.mjs run \/tmp\/kiln-x \/tmp\/kiln-x\/\.kiln --only SC-001,SC-002 --flips SC-002 --before RUN1/)
  // the verdict semantics are stated to the runner: the exit code is gated mechanically
  assert.match(runners[1], /lifecycle VERDICT the workflow gates on mechanically/)
  assert.match(runners[1], /FLIP_UNMET/)
  assert.match(runners[1], /REGRESSION/)
})

test('suite evidence (T2-fix #4): the runner persists the project suite via kiln-law suite INTO the evidence dir (suite.log + sha256\'d suite.jsonl); no recorded suite command → step skipped; reviewer pointed at the persisted log', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond())
  const runner = labelsOf(calls, 'asimov:runner')[0].prompt
  assert.match(runner, /kiln-law\.mjs suite \/tmp\/kiln-x \/tmp\/kiln-x\/\.kiln <runId> --cmd 'npm test'/)
  assert.match(runner, /suite\.log \+ a sha256'd result line in suite\.jsonl/)
  const review = labelsOf(calls, ':review:')[0].prompt
  assert.match(review, /persisted at \/tmp\/kiln-x\/\.kiln\/evidence\/RUN1\/suite\.log/)
  assert.match(review, /suite\.jsonl/)
  // a build that recorded no test_command skips the suite step instead of inventing one
  const noSuite = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.includes(':build:')) return { ...buildOk, test_command: undefined }
  }))
  const r2 = labelsOf(noSuite.calls, 'asimov:runner')[0].prompt
  assert.match(r2, /No project suite command was recorded/)
  assert.doesNotMatch(r2, /kiln-law\.mjs suite/)
})

test('RED lifecycle gate (T2-fix #2): kiln-law run exit 1 → slice auto-REJECTED as LOGICAL with NO reviewer spawned, ledgered law_red_auto_reject, fix brief naming the unmet flip; the Sentinel marches to split_required', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) return { ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-001'] }
  }))
  assert.equal(count(calls, ':review:'), 0, 'a slice that mechanically failed its Law must never reach a reviewer — the exit code is the verdict')
  const reds = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('law_red_auto_reject'))
  assert.equal(reds.length, 3, 'every red trial is ledgered — f0, f1, f2 (the split stops the slice)')
  assert.match(reds[0].prompt, /SC-001/, 'the ledger event names the unmet flip')
  // logical classing drives the §3.3 ladder: 2 rejections escalate the feedback source, 3 split
  const led = labelsOf(calls, 'thoth:ledger').map((l) => l.prompt)
  assert.ok(led.some((p) => p.includes('escalate_feedback_source')), 'red rejections are LOGICAL — the ratchet moves')
  assert.ok(led.some((p) => p.includes('split_and_rebuild')))
  assert.deepEqual(result.split_required, [{ milestone: 'M1', slice: 'M1:s0', sc_ids: ['SC-001'] }])
  assert.equal(count(calls, ':build:'), 3, 'initial + 2 fix builds — the split STOPS the slice')
  const fixBuild = labelsOf(calls, ':build:')[1].prompt
  assert.match(fixBuild, /lifecycle gate failed/)
  assert.match(fixBuild, /still not green: SC-001/)
  assert.match(fixBuild, /never the locked checks/)
  assert.equal(result.built[0].qa, 'QA_FAIL')
})

test('RED lifecycle gate: a regression of a previously-GREEN check rejects mechanically too, naming the regressed id', async () => {
  let trials = 0
  const { calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('asimov:runner')) {
      trials++
      // slice 0 green; slice 1 regresses SC-001 on its first trial, then recovers
      if (trials === 2) return { ...runnerOk, law_run_exit: 1, regressed: ['SC-001'] }
      return runnerOk
    }
  }))
  const fixBuild = calls.find((c) => c.label.includes(':build:M1:s1:fix1'))
  assert.ok(fixBuild, 'the regression triggers a fix build on slice 1')
  assert.match(fixBuild.prompt, /previously-GREEN check\(s\) regressed: SC-001/)
  assert.equal(count(calls, ':review:'), 2, 'one review per slice once the gate is green again — none on the red trial')
})

// ── the tamper drill ─────────────────────────────────────────────────────────────────────────────

test('tamper drill: kiln-law exit 2 → slice auto-REJECTED with NO reviewer spawned; every tamper LEDGERED (§5.1) naming the touched lock; no Sentinel escalation (mechanical)', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) return { reasoning: 'r', verify_exit: 2, tamper_paths: ['tests/acceptance/sc-001.sh'] }
  }))
  assert.equal(count(calls, ':review:'), 0, 'a tampered slice must never reach a reviewer')
  assert.equal(count(calls, 'thoth:freshness'), 0, 'verify stopped the runner — no run_id, no probe')
  const led = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('tamper_auto_reject'))
  assert.equal(led.length, 4, '§5.1: every locked-path mismatch is ledgered — one event per trial cycle f0..f3')
  for (const l of led) {
    assert.match(l.prompt, /tamper_auto_reject/, 'the ledger event records the workflow auto-reject, not an agent judgment')
    assert.match(l.prompt, /tests\/acceptance\/sc-001\.sh/, 'the ledger event names the touched lock')
    assert.doesNotMatch(l.prompt, /posture_escalated/, 'tamper is mechanical — the Sentinel must not escalate')
  }
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('posture_escalated')).length, 0, 'tamper is mechanical — the Sentinel must not escalate')
  assert.equal(count(calls, ':build:'), 4, 'initial build + MAX_REVIEW_FIXES fix builds')
  const fixBuild = labelsOf(calls, ':build:')[1].prompt
  assert.match(fixBuild, /tests\/acceptance\/sc-001\.sh/)
  assert.match(fixBuild, /immutable after lock/)
  assert.equal(result.built[0].qa, 'QA_FAIL')
})

// ── the freshness gate (§6: evidence timestamps/hashes compared against HEAD, in-script) ────────

test('freshness gate: stale evidence on ANY §6 arm → auto-REJECTED, no reviewer — HEAD moved, results.jsonl missing, manifest from another commit, hash mismatch, unfinalized run, evidence predating HEAD, unreadable verification_class', async () => {
  const staleProbes = [
    { ...freshOk, head: 'def456' },                      // HEAD moved since the runner anchored
    { ...freshOk, results_jsonl_exists: false },         // no evidence file at all
    { ...freshOk, manifest_head: 'old999' },             // evidence dir produced at another commit
    { ...freshOk, results_sha256: 'beef02' },            // results.jsonl altered after the run
    { ...freshOk, manifest_results_sha256: '' },         // run never finalized (aborted mid-run)
    { ...freshOk, manifest_completed_epoch: 999 },       // evidence predates the HEAD commit
    { ...freshOk, manifest_verification_class: '' },     // §7: degradation unprovable — fail closed
  ]
  for (const probe of staleProbes) {
    const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
      if (label.startsWith('thoth:freshness')) return probe
    }))
    assert.equal(count(calls, ':review:'), 0, `stale evidence (${JSON.stringify(probe)}) must never reach a reviewer`)
    assert.equal(result.built[0].qa, 'QA_FAIL')
    const fixBuild = labelsOf(calls, ':build:')[1].prompt
    assert.match(fixBuild, /Evidence gate failed/)
  }
})

test('freshness probe prompt: mechanical transcription of the §6 anchors — run.json manifest, results.jsonl rehash, HEAD sha + commit epoch, §7 verification_class', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }))
  const probe = labelsOf(calls, 'thoth:freshness')[0]
  assert.equal(probe.model, 'haiku')
  assert.match(probe.prompt, /\/tmp\/kiln-x\/\.kiln\/evidence\/RUN1\/run\.json/)
  assert.match(probe.prompt, /sha256sum \/tmp\/kiln-x\/\.kiln\/evidence\/RUN1\/results\.jsonl/)
  assert.match(probe.prompt, /git -C \/tmp\/kiln-x rev-parse HEAD/)
  assert.match(probe.prompt, /git -C \/tmp\/kiln-x show -s --format=%ct HEAD/)
  assert.match(probe.prompt, /manifest_verification_class = its "verification_class"/)
  assert.match(probe.prompt, /trust nothing the runner reported/)
})

// ── the §7 honesty channel: a static-only run proceeds HONESTLY degraded — ledgered + surfaced ──

test('verification degraded (§7): a static-only manifest with law exit 0 still reaches the reviewer, but the degradation is LEDGERED and NAMED in the review prompt — never silently green', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('thoth:freshness')) return { ...freshOk, manifest_verification_class: 'static-only' }
  }))
  assert.equal(count(calls, ':review:'), 1, 'degradation is the capability tier, not an error — the trial proceeds')
  assert.equal(result.built[0].qa, 'QA_PASS')
  const degraded = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('verification_degraded'))
  assert.equal(degraded.length, 1, 'the static-only run is ledgered the moment the gate sees it')
  assert.match(degraded[0].prompt, /"verification_class":"static-only"/)
  const review = labelsOf(calls, ':review:')[0].prompt
  assert.match(review, /VERIFICATION DEGRADED \(verification_class: static-only\)/, 'the reviewer is told the probe evidence was deferred')
  assert.match(review, /A deferral is never green/)
})

test('verification full (§7): a fully-verified run tells the reviewer the probe evidence EXISTS and must be read — no stale "later phase" language anywhere', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }))
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('verification_degraded')).length, 0, 'a full-verification run ledgers no degradation')
  const review = labelsOf(calls, ':review:')[0].prompt
  assert.match(review, /verification_class is 'full': every mapped probe EXECUTED/)
  assert.match(review, /PROBE_DEFERRED\/PROBE_UNAVAILABLE lines are honest deferrals — neither red nor green/)
  assert.doesNotMatch(review, /arrives in a later phase/, 'T1 made probes executable — the reviewer must not be told to ignore available probe evidence')
})

// ── slice-plan coverage: re-ask once, then escalate ─────────────────────────────────────────────

test('coverage gap: ONE re-ask with the exact arithmetic errors, then the milestone builds on the fixed plan', async () => {
  let planCalls = 0
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('krs-one:slice-plan')) {
      planCalls++
      return { reasoning: 'r', slices: planCalls === 1 ? planOne : planTwo } // first plan misses SC-002
    }
  }))
  assert.equal(planCalls, 2)
  const retry = calls.find((c) => c.label === 'krs-one:slice-plan:M1:retry')
  assert.ok(retry, 'the re-ask must be labeled :retry')
  assert.match(retry.prompt, /SC-002/)
  assert.match(retry.prompt, /REJECTED by the coverage arithmetic/)
  assert.equal(count(calls, ':build:'), 2)
  assert.equal(result.built[0].qa, 'QA_PASS')
})

test('coverage gap unrecovered: after the re-ask still broken → ledgered slice_plan_invalid, ZERO builds, QA_FAIL surfaced', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('krs-one:slice-plan')) return { reasoning: 'r', slices: planOne } // always misses SC-002
  }))
  assert.equal(count(calls, ':build:'), 0, 'never build against broken coverage')
  const ledger = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('slice_plan_invalid'))
  assert.equal(ledger.length, 1)
  assert.match(ledger[0].prompt, /slice_plan_invalid/)
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.equal(result.built[0].slice_plan_failed, true)
  assert.equal(result.all_passed, false)
})

// ── confirm + the single replan ──────────────────────────────────────────────────────────────────

test('replan: confirm says replan → ONE ledgered fresh slice-plan for the remainder, then the build proceeds; a second replan verdict is spent', async () => {
  let confirms = 0
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('krs-one:confirm')) {
      confirms++
      return { reasoning: 'r', decision: confirms === 1 ? 'replan' : 'proceed', reason: 'add already exists' }
    }
  }))
  const replan = calls.find((c) => c.label === 'krs-one:slice-plan:M1:replan')
  assert.ok(replan, 'the remainder must be replanned under the :replan label')
  assert.match(replan.prompt, /DRIFTED/)
  const ledger = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('slice_plan_replanned'))
  assert.equal(ledger.length, 1)
  assert.match(ledger[0].prompt, /slice_plan_replanned/)
  assert.equal(count(calls, ':build:'), 2)
  assert.equal(result.built[0].replanned, true)
  assert.equal(result.built[0].qa, 'QA_PASS')
})

// ── the Sentinel: feedback escalation + split_required ──────────────────────────────────────────

test('Sentinel ladder (§8 T3+ capability tier — codex on board): 2 logical rejections escalate the FEEDBACK SOURCE by swapping the reviewer FAMILY (:esc label + ledger); 3 STOP the slice as split_required, surfaced in gate + return', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.includes(':review:')) return rejectLogical
  }))
  const reviews = labelsOf(calls, ':review:')
  assert.equal(reviews.length, 3, 'f0 reject, f1 reject (escalates), f2 escalated reject (splits)')
  assert.deepEqual(reviews.map((c) => c.model), ['opus', 'opus', 'sonnet'], 'the 3rd review is the SWAPPED family (codex wrapper) — the §8 T3+ arm of the tasks.md T2.4 contract')
  assert.ok(reviews[2].label.endsWith(':esc'))
  assert.match(reviews[2].prompt, /<escalated>/)
  assert.match(reviews[2].prompt, /model_reasoning_effort="high"/, 'the escalated codex leg runs at high effort')
  const ledger = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('posture_escalated'))
  assert.equal(ledger.length, 2, 'posture_escalated ledgered at the escalation AND at the split')
  assert.match(ledger[0].prompt, /posture_escalated/)
  assert.match(ledger[0].prompt, /escalate_feedback_source/)
  assert.match(ledger[1].prompt, /split_and_rebuild/)
  assert.equal(count(calls, ':build:'), 3, 'initial + 2 fix builds — the split STOPS the slice before a 4th')
  assert.equal(count(calls, 'ken:qa') + count(calls, 'ryu:qa') + count(calls, 'judge-dredd:verdict'), 0, 'the gate verdict is mechanical on a split — no tribunal spend (nothing on this branch can pass)')
  assert.equal(count(calls, 'aristotle:goal-backward'), 1, 'T2-fix #3: the goal-backward audit runs at EVERY boundary — split included; its findings merge into the failure record')
  assert.deepEqual(result.split_required, [{ milestone: 'M1', slice: 'M1:s0', sc_ids: ['SC-001'] }])
  assert.deepEqual(result.built[0].split_required, ['M1:s0'])
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings[0], /split_required/)
})

test('boundary audit on a FAILED boundary: a blocking goal-backward finding on the split branch MERGES into the failure record (verdict stays the mechanical QA_FAIL)', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.includes(':review:')) return rejectLogical
    if (label.startsWith('aristotle:goal-backward')) return { reasoning: 'r', overall: 'fail', findings: [{ text: 'the goal is unreachable from the entry point', severity: 'critical' }] }
  }))
  assert.equal(count(calls, 'aristotle:goal-backward'), 1)
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings.join(' '), /split_required/, 'the mechanical failure record survives')
  assert.match(result.built[0].findings.join(' '), /unreachable from the entry point/, 'the audit finding joined it')
})

test('Sentinel ladder (§8 T1/T2 capability tiers — no codex): escalation is a FRESH-CONTEXT stronger-effort Opus leg, NEVER a family swap; ledger + split semantics unchanged', async () => {
  const { result, calls } = await runBuild({ ...baseArgs, codexAvailable: false }, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.includes(':review:')) return rejectLogical
  }))
  const reviews = labelsOf(calls, ':review:')
  assert.equal(reviews.length, 3, 'f0 reject, f1 reject (escalates), f2 escalated reject (splits)')
  assert.deepEqual(reviews.map((c) => c.model), ['opus', 'opus', 'opus'], 'no second family on board — every review leg stays Opus (the T1/T2 arm of the tasks.md T2.4 contract)')
  assert.ok(reviews[2].label.endsWith(':esc'), 'the escalated leg is still a distinct fresh-context feedback source')
  assert.match(reviews[2].prompt, /<escalated>/)
  assert.ok(!reviews[2].prompt.includes('codex exec'), 'the swap arm must not fire below T3 — no codex delegation')
  const ledger = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('posture_escalated'))
  assert.equal(ledger.length, 2, 'posture_escalated ledgered at the escalation AND at the split — tier-independent')
  assert.match(ledger[0].prompt, /escalate_feedback_source/)
  assert.match(ledger[1].prompt, /split_and_rebuild/)
  assert.deepEqual(result.split_required, [{ milestone: 'M1', slice: 'M1:s0', sc_ids: ['SC-001'] }])
})

test('Sentinel: mechanical rejections never escalate — full fix cycles, no ledger, no family swap', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.includes(':review:')) return { reasoning: 'r', verdict: 'REJECTED', law_green: true, tests_green: true, findings: [{ text: 'stray debug print', finding_class: 'mechanical' }] }
  }))
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('posture_escalated')).length, 0, 'mechanical rejections never escalate — no posture ledger')
  assert.equal(count(calls, ':review:'), 4, 'f0..f3 — the full MAX_REVIEW_FIXES loop')
  assert.ok(labelsOf(calls, ':review:').every((c) => c.model === 'opus' && !c.label.endsWith(':esc')))
})

// ── the §3.2 milestone gate: goal-backward at the boundary, judge ONLY on ambiguous reconcile ────

test('milestone gate (§3.2): blocking findings → computed QA_FAIL with NO judge spawned; the correction loop fires, then escalates to validate', async () => {
  const blocking = { reasoning: 'r', overall: 'fail', findings: [{ text: 'list renders nothing — the store is never read', severity: 'critical' }] }
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('ken:qa')) return blocking
  }))
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, 'hasBlocking ⇒ the verdict is COMPUTED — a judge could only soften the deterministic gate')
  assert.equal(count(calls, 'ken:qa'), 2, 'gate cycle c0 + one correction re-gate c1')
  assert.equal(count(calls, 'aristotle:goal-backward'), 2, 'the audit re-runs each gate cycle — a corrective commit moves the boundary it audits')
  const correction = calls.find((c) => c.label.includes(':build:M1:correct1'))
  assert.ok(correction, 'one corrective build fires before the re-gate')
  assert.match(correction.prompt, /list renders nothing/)
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings.join(' '), /list renders nothing/)
})

test('milestone gate (§3.2): zero blocking findings + analyst overall verdicts DISAGREE → the judge is spawned and rules; agreement never spawns one', async () => {
  // disagree: ken pass, ryu fail (fail unbacked by a blocking finding — ambiguous reconcile)
  const a = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('ryu:qa')) return { reasoning: 'r', overall: 'fail', findings: [{ text: 'naming nit', severity: 'low' }] }
  }))
  assert.equal(count(a.calls, 'judge-dredd:verdict'), 1, 'ambiguous reconcile ⇒ the judge rules')
  assert.equal(a.result.built[0].qa, 'QA_PASS', 'the judge verdict (QA_PASS) is honored')
  // the same shape but the judge says FAIL → correction loop, then QA_FAIL
  const b = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('ryu:qa')) return { reasoning: 'r', overall: 'fail', findings: [] }
    if (label.startsWith('judge-dredd:verdict')) return { reasoning: 'r', verdict: 'QA_FAIL', findings: ['goal not met'] }
  }))
  assert.equal(count(b.calls, 'judge-dredd:verdict'), 2, 'judge per ambiguous cycle: c0 + the post-correction re-gate')
  assert.equal(b.result.built[0].qa, 'QA_FAIL')
  // QA_FINDINGS carry the overall verdict the gate computes disagreement from
  const ken = labelsOf(a.calls, 'ken:qa')[0]
  assert.match(ken.prompt, /overall/)
  assert.match(ken.prompt, /'fail' MUST be backed by at least one critical or high finding/)
})

test('milestone gate (§3.2): a dead analyst at the tribunal threshold fails the boundary closed (QA_FAIL) — the judge NEVER spawns on a missing overall verdict, mirroring the goal-audit ruling', async () => {
  // ken dies (null) → reports[0] is null → gateDecision cannot read its overall. The §3.2
  // judge-spawn condition presupposes TWO readable, disagreeing verdicts; a missing one is not
  // disagreement, it is absent evidence → fail closed, no judge (operator ruling: "the judge
  // NEVER spawns on missing inputs").
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('ken:qa')) return null
  }))
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, 'a missing analyst verdict cannot be "two disagreeing verdicts" — no judge spawns on missing inputs')
  assert.equal(result.built[0].qa, 'QA_FAIL', 'absent analyst evidence fails the milestone boundary closed')
})

test('milestone gate (§3.2): goal-backward findings JOIN the reconcile — a critical audit finding blocks the milestone without any judge', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('aristotle:goal-backward')) return { reasoning: 'r', overall: 'fail', findings: [{ text: 'checks pass but the feature is unreachable from the CLI entry point', severity: 'critical' }] }
  }))
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, 'the audit finding makes the reconcile blocking — computed QA_FAIL, no judge')
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings.join(' '), /unreachable from the CLI entry point/)
})

test('ORCHESTRATOR RULING at the tribunal: a null/unusable goal-backward audit is re-asked ONCE; still null → QA_FAIL with the blocking goal-audit-failure finding, LEDGERED — the judge NEVER spawns on missing inputs, no corrective build is spent', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('aristotle:goal-backward')) return null
  }))
  const audits = labelsOf(calls, 'aristotle:goal-backward')
  assert.equal(audits.length, 2, 'the first ask + exactly ONE re-ask')
  assert.ok(audits[1].label.endsWith(':retry'), 'the re-ask is labeled :retry')
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, 'the judge NEVER spawns on missing inputs (§3.2 condition is exhaustive; absent evidence is fail-closed)')
  assert.equal(count(calls, ':build:'), 2, 'no corrective build — an infrastructure failure is not a code defect a builder can fix')
  const led = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('goal_audit_failure'))
  assert.equal(led.length, 1)
  assert.match(led[0].prompt, /goal_audit_failure/)
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings.join(' '), /goal-audit-failure/, 'the blocking finding names the ruling')
})

test('ORCHESTRATOR RULING at the tribunal: an audit that is unusable once but USABLE on the re-ask proceeds normally — no goal-audit-failure, verdict computed', async () => {
  let audits = 0
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('aristotle:goal-backward')) {
      audits++
      return audits === 1 ? { reasoning: 'r', overall: 'maybe', findings: [] } : qaClean // first report non-binary → unusable
    }
  }))
  assert.equal(audits, 2)
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, 'usable inputs + agreeing analysts ⇒ computed verdict, no judge')
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('goal_audit_failure')).length, 0, 'a recovered audit ledgers no failure')
  assert.equal(result.built[0].qa, 'QA_PASS')
  assert.doesNotMatch(result.built[0].findings.join(' '), /goal-audit-failure/)
})

test('milestone gate single-slice row (§3.2): slice review + goal-backward IS the gate — clean audit passes, a blocking audit finding fails it, NO tribunal or judge either way', async () => {
  // clean: approved slice + clean audit → QA_PASS
  const a = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }))
  assert.equal(count(a.calls, 'aristotle:goal-backward'), 1, 'the audit runs at EVERY boundary that can pass — single-slice included')
  assert.equal(count(a.calls, 'ken:qa') + count(a.calls, 'ryu:qa') + count(a.calls, 'judge-dredd:verdict'), 0, 'tribunal redundancy skip below the threshold')
  assert.equal(a.result.built[0].qa, 'QA_PASS')
  // goal broken: approved slice but a critical audit finding → QA_FAIL
  const b = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('aristotle:goal-backward')) return { reasoning: 'r', overall: 'fail', findings: [{ text: 'the page exists but nothing links to it', severity: 'high' }] }
  }))
  assert.equal(b.result.built[0].qa, 'QA_FAIL', '"checks pass, goal broken" is caught at the single-slice boundary')
  assert.match(b.result.built[0].findings.join(' '), /nothing links to it/)
  // dead audit (ORCHESTRATOR RULING): ONE re-ask, then fail closed — never an unaudited pass
  const c = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('aristotle:goal-backward')) return null
  }))
  const audits = labelsOf(c.calls, 'aristotle:goal-backward')
  assert.equal(audits.length, 2, 'the single-slice boundary re-asks the unusable audit exactly once')
  assert.ok(audits[1].label.endsWith(':retry'))
  assert.equal(c.result.built[0].qa, 'QA_FAIL')
  assert.match(c.result.built[0].findings.join(' '), /goal-audit-failure/)
  assert.match(c.result.built[0].findings.join(' '), /fails closed/)
  const led = labelsOf(c.calls, 'thoth:ledger').filter((l) => l.prompt.includes('goal_audit_failure'))
  assert.equal(led.length, 1)
  assert.match(led[0].prompt, /goal_audit_failure/)
})

test('boundary audit on a plan-abort (T2-fix #3): a failed replanned remainder still gets the goal-backward audit at its boundary — findings merge into the QA_FAIL record', async () => {
  let confirms = 0
  const { result, calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('krs-one:confirm')) {
      confirms++
      return { reasoning: 'r', decision: confirms === 1 ? 'replan' : 'proceed', reason: 'state drift' }
    }
    if (label.includes(':slice-plan:M1:replan')) return { reasoning: 'r', slices: planOne } // remainder keeps missing SC-002
    if (label.startsWith('aristotle:goal-backward')) return { reasoning: 'r', overall: 'fail', findings: [{ text: 'half the milestone is unplanned', severity: 'high' }] }
  }))
  assert.equal(count(calls, ':build:'), 0, 'the abort fires before any build')
  assert.equal(count(calls, 'aristotle:goal-backward'), 1, 'the audit runs at the aborted boundary too')
  assert.equal(count(calls, 'ken:qa') + count(calls, 'ryu:qa') + count(calls, 'judge-dredd:verdict'), 0)
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings.join(' '), /\[slice_plan\]/)
  assert.match(result.built[0].findings.join(' '), /half the milestone is unplanned/)
})

test('milestone gate: the goal_backward posture dial OFF skips the audit with a LEDGERED gate_skipped (§3.5) — single-slice gates on the slice review alone', async () => {
  const posture = { milestone_gate: { goal_backward: false } }
  const { result, calls } = await runBuild({ ...baseArgs, posture }, mkRespond({ law: lawOne, plan: planOne }))
  assert.equal(count(calls, 'aristotle:goal-backward'), 0)
  const led = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('gate_skipped'))
  assert.equal(led.length, 1)
  assert.match(led[0].prompt, /gate_skipped/)
  assert.match(led[0].prompt, /goal_backward/)
  assert.equal(result.built[0].qa, 'QA_PASS')
})

test('milestone gate: min_slices_for_tribunal is the posture dial — raised to 3, a 2-slice milestone gates on slice reviews + goal-backward, no analysts', async () => {
  const posture = { milestone_gate: { min_slices_for_tribunal: 3 } }
  const { result, calls } = await runBuild({ ...baseArgs, posture }, mkRespond())
  assert.equal(count(calls, 'ken:qa') + count(calls, 'ryu:qa') + count(calls, 'judge-dredd:verdict'), 0)
  assert.equal(count(calls, 'aristotle:goal-backward'), 1)
  assert.equal(result.built[0].qa, 'QA_PASS')
})

// ── posture plumbing: the codex review effort dial ───────────────────────────────────────────────

test('posture: ui review effort is medium baseline (v2-equivalent default), high when the posture says so (D8≥1), and high on fix-cycle>0', async () => {
  const uiState = { milestones: [milestone({ surface: 'ui' })], law: lawOne, plan: planOne }
  // absent posture → medium
  const a = await runBuild(baseArgs, mkRespond(uiState))
  assert.match(labelsOf(a.calls, ':review:')[0].prompt, /model_reasoning_effort="medium"/)
  assert.equal(labelsOf(a.calls, ':review:')[0].model, 'sonnet', 'ui review is the codex wrapper leg')
  // posture ui_effort_base high → high from the first review
  const b = await runBuild({ ...baseArgs, posture: { review: { ui_effort_base: 'high', escalate_on: 'fix_cycle' } } }, mkRespond(uiState))
  assert.match(labelsOf(b.calls, ':review:')[0].prompt, /model_reasoning_effort="high"/)
  // fix-cycle>0 → high even from a medium baseline
  let uiReviews = 0
  const c = await runBuild(baseArgs, mkRespond(uiState, (label) => {
    if (label.includes(':review:')) {
      uiReviews++
      if (uiReviews === 1) return { reasoning: 'r', verdict: 'REJECTED', law_green: true, tests_green: true, findings: [{ text: 'missing aria label', finding_class: 'mechanical' }] }
      return reviewOk
    }
  }))
  const prompts = labelsOf(c.calls, ':review:').map((x) => x.prompt)
  assert.match(prompts[0], /model_reasoning_effort="medium"/)
  assert.match(prompts[1], /model_reasoning_effort="high"/)
})

// ── commit discipline (unchanged from v2) ────────────────────────────────────────────────────────

test('commit-before-review: an uncommitted build is auto-rejected with NO runner and NO reviewer call spent', async () => {
  let builds = 0
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.includes(':build:')) {
      builds++
      return builds === 1 ? { ...buildOk, committed: false } : buildOk
    }
  }))
  // cycle f0: no runner, no review; cycle f1 (after the fix build): full trial
  assert.equal(count(calls, 'asimov:runner'), 1)
  assert.equal(count(calls, ':review:'), 1)
  const fixBuild = labelsOf(calls, ':build:')[1].prompt
  assert.match(fixBuild, /was not committed/)
})

// ── velocity levers (§9 lever 3 + the model downshifts) ─────────────────────────────────────────

test('velocity levers: rakim:setup ∥ confucius:parse are both haiku; assetPrep is haiku; ryu QA runs at effort "high" not "xhigh"', async () => {
  const uiState = { milestones: [milestone({ surface: 'ui' })], law: lawOne, plan: planOne }
  const { calls } = await runBuild(baseArgs, mkRespond(uiState))
  const modelOf = (frag) => (calls.find((c) => c.label.includes(frag)) || {}).model
  assert.equal(modelOf('rakim:setup'), 'haiku', 'rakim:setup downshifts to haiku')
  assert.equal(modelOf('confucius:parse'), 'haiku', 'confucius:parse downshifts to haiku')
  assert.equal(modelOf('rakim:state'), 'haiku', 'the per-milestone state doc leg is haiku')
  assert.equal(modelOf(':prep:'), 'haiku', 'the asset-prep probe is haiku')
  // ryu runs at the tribunal threshold (a 2-slice milestone); drive one and read its effort
  const twoSlice = await runBuild(baseArgs, mkRespond())
  const ryu = twoSlice.calls.find((c) => c.label.startsWith('ryu:qa'))
  assert.ok(ryu, 'ryu runs at the 2-slice tribunal threshold')
  assert.match(ryu.prompt, /model_reasoning_effort="high"/)
  assert.doesNotMatch(ryu.prompt, /xhigh/, 'ryu QA dropped from xhigh to high (BLUEPRINT §8 / lever 4)')
})

// ── §9 lever 3: pipelined next-milestone slicing + base_sha invalidation ─────────────────────────

// Two single-slice logic milestones, each owning one Law SC. mkTwoMilestone keeps both lite-gate
// (single-slice) so the gate is cheap; `headFn(label)` decides each thoth:head probe's sha.
const lawM1M2 = [{ id: 'SC-001', milestone: 'M1', kind: 'shell' }, { id: 'SC-002', milestone: 'M2', kind: 'shell' }]
const twoMilestones = [milestone({ id: 'M1', surface: 'logic' }), milestone({ id: 'M2', title: 'Next', surface: 'logic' })]
const mkPipeline = (headFn, extra) => mkRespond({}, (label, prompt, model) => {
  if (label.startsWith('asimov:law-read')) return { reasoning: 'r', locked: true, checks: lawM1M2 }
  if (label === 'confucius:parse') return { reasoning: 'r', milestones: twoMilestones }
  if (label.startsWith('thoth:head')) return { reasoning: 'r', head: headFn(label) }
  if (label.startsWith('krs-one:slice-plan')) {
    // each milestone's plan flips exactly its own SC
    return { reasoning: 'r', slices: [{ objective: label.includes(':M2') ? 'm2 work' : 'm1 work', files: [], constraints: '', done_when: 'works', sc_ids: label.includes(':M2') ? ['SC-002'] : ['SC-001'] }] }
  }
  if (extra) return extra(label, prompt, model)
})

test('lever 3: M2\'s slice plan is cut SPECULATIVELY during M1\'s gate (a krs-one:slice-plan:M2 call fires before M2\'s own Scoring), and reused when HEAD never moved', async () => {
  // HEAD constant across the run — no corrective commit — so the pipelined plan stays valid.
  const { calls, log } = await runBuild(baseArgs, mkPipeline(() => 'HEAD_STABLE'))
  const planLabels = labelsOf(calls, 'krs-one:slice-plan').map((c) => c.label)
  // exactly one M1 plan and one M2 plan — the M2 plan was the SPECULATIVE one, REUSED (not re-cut)
  assert.equal(planLabels.filter((l) => l.includes(':M1')).length, 1, 'one M1 slice plan')
  assert.equal(planLabels.filter((l) => l.includes(':M2')).length, 1, 'M2 planned exactly once — the speculative plan, reused')
  // the base probe fires during M1's gate, the check probe at M2's head
  assert.ok(labelsOf(calls, 'thoth:head:M1:pipeline-base').length === 1, 'base_sha anchored during M1\'s gate')
  assert.ok(labelsOf(calls, 'thoth:head:M2:pipeline-check').length === 1, 'HEAD re-checked when M2 consumes the plan')
  assert.ok(log.some((l) => /reusing the PIPELINED slice plan/.test(l)), 'M2 reused the pipelined plan')
  // ordering proof: the speculative M2 plan was issued BEFORE M2\'s own Scoring phase began
  const allLabels = calls.map((c) => c.label)
  const m2Plan = allLabels.indexOf('krs-one:slice-plan:M2')
  const m2Confirm = allLabels.indexOf('krs-one:confirm:M2:s0')
  assert.ok(m2Plan > -1 && m2Plan < m2Confirm, 'the M2 plan was cut speculatively, before M2\'s slice confirm')
})

test('lever 3 invalidation (§9 finding #8): a corrective commit moves HEAD between base_sha and consume → the pipelined plan is invalidated, M2 RE-SLICES, and slice_plan_invalidated is LEDGERED', async () => {
  // base probe (during M1's gate) sees HEAD_BEFORE; the consume-time check sees HEAD_AFTER — a
  // corrective commit moved it. M2 must re-slice and ledger the invalidation.
  const headFn = (label) => label.includes('pipeline-base') ? 'HEAD_BEFORE' : 'HEAD_AFTER'
  let ledgered = null
  const { calls, log } = await runBuild(baseArgs, mkPipeline(headFn, (label, prompt) => {
    if (label === 'thoth:ledger' && /slice_plan_invalidated/.test(prompt)) { ledgered = prompt; return { ok: true } }
  }))
  assert.ok(log.some((l) => /PIPELINED plan invalidated/.test(l)), 'M2 detected the moved HEAD')
  assert.ok(ledgered, 'slice_plan_invalidated was ledgered')
  assert.match(ledgered, /HEAD_BEFORE/)
  assert.match(ledgered, /HEAD_AFTER/)
  // M2 was planned TWICE: the (discarded) speculative cut + the fresh re-slice against the new HEAD
  const m2Plans = labelsOf(calls, 'krs-one:slice-plan:M2')
  assert.equal(m2Plans.length, 2, 'M2 re-sliced against the new HEAD after invalidation')
})

test('lever 3 fail-closed: an unreadable HEAD at consume time invalidates the pipelined plan (freshness cannot be proven → re-slice)', async () => {
  // base probe returns a sha; the consume-time check returns '' (git failed) — fail closed.
  const headFn = (label) => label.includes('pipeline-base') ? 'HEAD_X' : ''
  const { calls, log } = await runBuild(baseArgs, mkPipeline(headFn))
  assert.ok(log.some((l) => /PIPELINED plan invalidated/.test(l)), 'an unreadable HEAD forces a re-slice')
  assert.equal(labelsOf(calls, 'krs-one:slice-plan:M2').length, 2, 'M2 re-sliced (fail-closed on the blank HEAD)')
})

test('lever 3: a blank base_sha (the HEAD probe failed when anchoring) never starts the pipeline — M2 plans normally, once, no invalidation ledger', async () => {
  // every head probe returns '' — the base anchor is blank, so the pipeline is never launched.
  let invalidatedLedger = false
  const { calls } = await runBuild(baseArgs, mkPipeline(() => '', (label, prompt) => {
    if (label === 'thoth:ledger' && /slice_plan_invalidated/.test(prompt)) { invalidatedLedger = true; return { ok: true } }
  }))
  // the base probe ran (and returned blank), so NO speculative M2 plan was launched during M1's gate
  assert.equal(labelsOf(calls, 'krs-one:slice-plan:M2').length, 1, 'M2 planned exactly once — synchronously, the pipeline never started')
  assert.equal(labelsOf(calls, 'thoth:head:M2:pipeline-check').length, 0, 'no consume-time check — there was no pipelined plan to consume')
  assert.equal(invalidatedLedger, false, 'a never-started pipeline produces no invalidation ledger')
})

// ── P3 T2: ui-slice probe gating (§7 default-fail / honest-degrade) ──────────────────────────────
// A ui milestone so surfaceOf() ⇒ 'ui'; one probe-kind SC mapped to the one slice. The ui review
// leg is the codex wrapper (sonnet) — Opus builds, Codex reviews — so :review: calls are sonnet.
const uiMilestone = (over = {}) => milestone({ surface: 'ui', ...over })
const lawProbe = [{ id: 'SC-001', milestone: 'M1', kind: 'probe' }]
const planProbe = [{ objective: 'render the hero page', files: ['index.html'], constraints: '', done_when: 'the probe SC passes', sc_ids: ['SC-001'] }]
const uiProbeState = { milestones: [uiMilestone()], law: lawProbe, plan: planProbe }

test('T2.1 ui probe gating — FULL: every mapped probe EXECUTED (verification_class full) → the slice proceeds, NO probe_unavailable ledger, and the ui reviewer is told the probe evidence exists and must be read', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond(uiProbeState))
  assert.equal(count(calls, ':review:'), 1, 'a fully-verified ui slice reaches the reviewer')
  assert.equal(labelsOf(calls, ':review:')[0].model, 'sonnet', 'ui review is the cross-family codex (sonnet wrapper) leg')
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => /probe_unavailable|verification_degraded/.test(l.prompt)).length, 0, 'a full-verification run ledgers no degradation')
  assert.equal(result.built[0].qa, 'QA_PASS')
  const review = labelsOf(calls, ':review:')[0].prompt
  assert.match(review, /verification_class is 'full': every mapped probe EXECUTED/)
})

test('T2.1 ui probe gating — DEGRADE (exit 78 / deferred → static-only): the slice proceeds HONESTLY DEGRADED, ledgers probe_unavailable (the §7 capability event, surface recorded), and the ui review falls back to the static checks — never silently green', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond(uiProbeState, (label) => {
    if (label.startsWith('thoth:freshness')) return { ...freshOk, manifest_verification_class: 'static-only' }
  }))
  assert.equal(count(calls, ':review:'), 1, 'degradation is the capability tier, not an error — the trial proceeds')
  const pu = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('probe_unavailable'))
  assert.equal(pu.length, 1, 'a ui slice that lost its browser-probe evidence ledgers probe_unavailable (NOT the generic verification_degraded)')
  assert.match(pu[0].prompt, /"verification_class":"static-only"/)
  assert.match(pu[0].prompt, /"surface":"ui"/, 'the probe_unavailable event records the surface')
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('verification_degraded')).length, 0, 'a ui slice uses probe_unavailable, never the logic-surface generic event')
  const review = labelsOf(calls, ':review:')[0].prompt
  assert.match(review, /VERIFICATION DEGRADED \(verification_class: static-only\)/)
  assert.match(review, /A deferral is never green/)
  assert.match(review, /Screenshot rubric: SKIPPED this run/, 'a static-only run has no screenshot to judge — the binary rubric is gated out')
  assert.equal(result.built[0].qa, 'QA_PASS')
})

test('T2.1 probe exit 1/79 (assert-fail / timeout) folds to RED upstream → slice auto-REJECTED before any reviewer (the exit code is the verdict — probeGate is never consulted on a red gate)', async () => {
  // kiln-law folds a probe exit 1/79 to a red check ⇒ its declared flip is UNMET ⇒ kiln-law run
  // exits non-zero ⇒ runnerGate returns 'red'. The runner agent transcribes the FLIP_UNMET id.
  const { result, calls } = await runBuild(baseArgs, mkRespond(uiProbeState, (label) => {
    if (label.startsWith('asimov:runner')) return { ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-001'] }
  }))
  assert.equal(count(calls, ':review:'), 0, 'a probe that asserted-failed or timed out makes the Law RED — no reviewer is spent')
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('law_red_auto_reject')).length, 3, 'every red trial is ledgered (f0..f2; the split stops the slice)')
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('probe_unavailable')).length, 0, 'a red probe is a defect, not a capability degradation — never probe_unavailable')
  assert.equal(result.built[0].qa, 'QA_FAIL')
})

test('T2.1 missing/stale probe evidence → stale gate → slice auto-REJECTED before any reviewer (default-fail; probeGate never reached)', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond(uiProbeState, (label) => {
    if (label.startsWith('thoth:freshness')) return { ...freshOk, results_jsonl_exists: false } // no probe evidence file at all
  }))
  assert.equal(count(calls, ':review:'), 0, 'missing probe evidence is structurally impossible to approve — no reviewer')
  assert.equal(result.built[0].qa, 'QA_FAIL')
  const fixBuild = labelsOf(calls, ':build:')[1].prompt
  assert.match(fixBuild, /Evidence gate failed/)
})

test('T2.2 ui reviewer brief: probe evidence paths + SCREENSHOT judged by BINARY RUBRIC only (no numeric aesthetic score), and the reviewer RE-RUNS the slice\'s mapped probe SCs itself (independent-rerun floor)', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond(uiProbeState))
  const review = labelsOf(calls, ':review:')[0].prompt
  // probe evidence paths
  assert.match(review, /\/tmp\/kiln-x\/\.kiln\/evidence\/RUN1\//, 'the evidence dir is named')
  assert.match(review, /probe-<SC>\.json/, 'the probe result file is named')
  // screenshot binary rubric (the §7 rule)
  assert.match(review, /Screenshot rubric \(binary ONLY\)/)
  assert.match(review, /NEVER assign a numeric or aesthetic score/)
  assert.match(review, /VLMs rank reliably but score unreliably/)
  // independent rerun of the mapped probe SCs
  assert.match(review, /RE-RUN the slice's mapped probe SCs via the kiln-law rerun/)
  assert.match(review, /node \/plug\/scripts\/kiln-law\.mjs run \/tmp\/kiln-x \/tmp\/kiln-x\/\.kiln --only SC-001/)
  // the builder-never-browser law restated for the reviewer
  assert.match(review, /NEVER open a browser or drive Playwright yourself/)
  assert.match(review, /a subprocess with a deadline, never a service/)
})

// ── P3 T2.3: stage-level browser sweeps (the OUTER bracket — pre-flight + unconditional end) ──────

// The build's stage-scoped browser kill token — kbuild-<args.runToken | projectPath-hash>
// (build.js BUILD_RUN_TOKEN; Date.now/Math.random are forbidden in workflow scripts, so the
// conductor mints cross-run uniqueness via args.runToken). Both stage sweeps and every kiln-law
// --run-prefix carry it, so a sweep reaps ONLY this build's browser trees, never a concurrent
// Kiln run's (the reviewer's MAJOR / discipline-spec "post-check cleanup is run-token scoped").
const BUILD_TOKEN_RE = /kbuild-[A-Za-z0-9._-]+/

test('T2.3 stage sweeps: a PRE-FLIGHT sweep fires at build start and an UNCONDITIONAL sweep at build end — both run kiln-probe sweep scoped to THIS build\'s run token (never the whole namespace, never blanket pkill), both LEDGERED browser_sweep with the token', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond())
  const sweeps = labelsOf(calls, 'sentinel:sweep')
  assert.equal(sweeps.length, 2, 'exactly two stage sweeps: pre-flight + stage-end')
  assert.ok(sweeps[0].label.endsWith(':pre-flight'), 'the first sweep is the pre-flight')
  assert.ok(sweeps[1].label.endsWith(':stage-end'), 'the second sweep is the unconditional stage-end')
  // both sweeps must carry the SAME token (one stage, one token)
  const t0 = sweeps[0].prompt.match(BUILD_TOKEN_RE)
  assert.ok(t0, 'the pre-flight sweep is scoped to a kbuild- run token')
  const token = t0[0]
  for (const s of sweeps) {
    assert.equal(s.model, 'haiku', 'the sweep is a mechanical haiku leg')
    assert.match(s.prompt, new RegExp(`node /plug/scripts/kiln-probe\\.mjs sweep ${token}\\b`), 'it runs kiln-probe sweep with THIS build\'s run-token prefix — never bare')
    assert.doesNotMatch(s.prompt, /sweep['"`\s]*\n/, 'never a bare (whole-namespace) sweep')
    assert.match(s.prompt, /scopes the sweep to THIS build's own browser trees ONLY/, 'run-token scoped, never a concurrent run')
    assert.match(s.prompt, /blanket 'pkill -f chrome' is forbidden/)
  }
  const led = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('browser_sweep'))
  assert.equal(led.length, 2, 'both sweeps are ledgered (§3.5 — every browser-lifecycle action is an event)')
  assert.match(led[0].prompt, /"when":"pre-flight"/)
  assert.match(led[0].prompt, new RegExp(`"token":"${token}"`), 'the ledger records the scoping token')
  assert.match(led[1].prompt, /"when":"stage-end"/)
})

test('T2.3 run-token scoping: every kiln-law run (the runner AND the reviewer rerun) threads the SAME --run-prefix as the sweeps — so every probe this build spawns falls under the token the sweep reaps', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond(uiProbeState))
  const token = labelsOf(calls, 'sentinel:sweep')[0].prompt.match(BUILD_TOKEN_RE)[0]
  const runner = labelsOf(calls, 'asimov:runner')[0].prompt
  assert.match(runner, new RegExp(`kiln-law\\.mjs run [^\\n]*--run-prefix ${token}\\b`), 'the deterministic runner names this build\'s run token on kiln-law run')
  const review = labelsOf(calls, ':review:')[0].prompt
  assert.match(review, new RegExp(`kiln-law\\.mjs run [^\\n]*--run-prefix ${token}\\b`), 'the reviewer\'s independent rerun threads the SAME token, so its probe trees are swept by the same stage bracket')
})

test('T2.3 ordering: the pre-flight sweep precedes the first builder, and the stage-end sweep is the FINAL agent call (the OUTER bracket around every probe spawn)', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond())
  const labels = calls.map((c) => c.label)
  const preFlight = labels.indexOf('sentinel:sweep:pre-flight')
  const firstBuild = labels.findIndex((l) => l.includes(':build:'))
  const lastGate = Math.max(...labels.map((l, i) => (l.startsWith('aristotle:goal-backward') || l.startsWith('judge-dredd') || l.startsWith('ken:qa') || l.startsWith('ryu:qa')) ? i : -1))
  const stageEnd = labels.indexOf('sentinel:sweep:stage-end')
  assert.ok(preFlight > -1 && firstBuild > -1 && preFlight < firstBuild, 'the pre-flight sweep runs before the first builder could spawn a probe')
  assert.ok(stageEnd > -1 && lastGate > -1 && stageEnd > lastGate, 'the stage-end sweep runs after the last milestone gate')
})

test('T2.3 the stage-end sweep is UNCONDITIONAL — it still fires when the build ends in QA_FAIL (a crashed/aborted probe run is exactly when leaked browsers must be reaped)', async () => {
  // drive a QA_FAIL via a split (logical rejections) on a single-slice ui milestone
  const { result, calls } = await runBuild(baseArgs, mkRespond(uiProbeState, (label) => {
    if (label.includes(':review:')) return rejectLogical
  }))
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.equal(labelsOf(calls, 'sentinel:sweep').filter((s) => s.label.endsWith(':stage-end')).length, 1, 'the stage-end sweep fires even on a failed build')
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('browser_sweep')).length, 2, 'both sweeps ledgered regardless of verdict')
})

test('T2.3 floor gates skip the sweep — an ungated early return (no pluginRoot) spawns no agent at all, so there is no browser stage to bracket', async () => {
  const { calls } = await runBuild({ kilnDir: '/tmp/k/.kiln', projectPath: '/tmp/k' }, mkRespond())
  assert.equal(calls.length, 0, 'the pluginRoot floor returns before any agent — including the sweeper (the CLI would be unlocatable)')
})

// runBuildCapturing — like runBuild but it surfaces the recorded calls EVEN WHEN the workflow body
// throws. The reviewer's CRITICAL: the stage-end sweep must be in the cleanup/finally so any throw
// after pre-flight still reaps this build's browsers (a crash mid-probe is exactly when leaks
// survive). Returns { thrown, calls }.
async function runBuildCapturing(args, respond) {
  const calls = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    const model = (opts && opts.model) || ''
    calls.push({ label, prompt, model })
    return respond(label, prompt, model)
  }
  const stubs = {
    args, phase: () => {}, log: () => {}, agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async () => [], budget: undefined, workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, wfBody)
  let thrown = null
  try { await run(...keys.map((k) => stubs[k])) } catch (e) { thrown = e }
  return { thrown, calls }
}

test('T2.3 CRITICAL: a throw AFTER pre-flight (a post-preflight parse/agent crash) still runs the stage-end sweep — it lives in finally, never after the loop, so no throw can skip the OUTER browser bracket', async () => {
  // crash the build mid-milestone: the runner step throws on its first call (a post-preflight
  // parse crash, exactly the reviewer's synthetic). The pre-flight sweep has already run; the
  // milestone loop then throws; the finally MUST still fire the stage-end sweep.
  const boom = new Error('synthetic post-preflight crash')
  const { thrown, calls } = await runBuildCapturing(baseArgs, mkRespond(uiProbeState, (label) => {
    if (label.startsWith('asimov:runner')) throw boom
  }))
  assert.equal(thrown, boom, 'the original error propagates out unmasked')
  const sweeps = labelsOf(calls, 'sentinel:sweep')
  assert.ok(sweeps.some((s) => s.label.endsWith(':pre-flight')), 'the pre-flight sweep ran before the crash')
  assert.ok(sweeps.some((s) => s.label.endsWith(':stage-end')), 'the stage-end sweep STILL ran via finally despite the throw (the reviewer\'s CRITICAL)')
  // and it was the run-token-scoped sweep, not a bare one
  const end = sweeps.find((s) => s.label.endsWith(':stage-end'))
  assert.match(end.prompt, new RegExp(`kiln-probe\\.mjs sweep ${BUILD_TOKEN_RE.source}\\b`), 'the finally sweep is still run-token scoped')
})

test('T2.3 the stage-end sweep failing in finally never masks the real build error (cleanup is itself guarded)', async () => {
  const boom = new Error('the real build crash')
  // the build crashes mid-milestone AND the stage-end sweeper itself rejects — the ORIGINAL crash
  // must still be what propagates (a swallowed primary error is a debugging nightmare).
  const { thrown } = await runBuildCapturing(baseArgs, mkRespond(uiProbeState, (label) => {
    if (label.startsWith('asimov:runner')) throw boom
    if (label === 'sentinel:sweep:stage-end') throw new Error('sweep also failed')
  }))
  assert.equal(thrown, boom, 'the finally guards the sweep so the primary error survives unmasked')
})
