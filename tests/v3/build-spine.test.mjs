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
import { admitSpeculation } from '../../plugins/kiln/src/spine.mjs'
import { createHash } from 'node:crypto'
import { sha256Hex, canonicalJson } from '../../plugins/kiln/src/council.mjs'

const WORKFLOW = fileURLToPath(new URL('../../plugins/kiln/workflows/build.js', import.meta.url))
const BUILD_SRC = fileURLToPath(new URL('../../plugins/kiln/workflows-src/build.js', import.meta.url))

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
    calls.push({ label, prompt, model, schema: (opts && opts.schema) || null })
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

test('slicer consolidation (P5.5): trivial posture briefs the budget-grouping directive; standard keeps the pre-P5.5 text byte-identical; the high-dims/effort-0 trap reads standard', async () => {
  const { posture: gaugePosture } = await import('../../plugins/kiln/src/gauge.mjs')
  const gaugeConfig = JSON.parse(readFileSync(new URL('../../plugins/kiln/gauge-config.json', import.meta.url), 'utf8'))
  const mkProf = (over = {}) => Object.fromEntries(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'].map((d) => [d, { score: over[d] || 0, evidence: 'e' }]))
  const PRE_P55_TEXT = 'Decompose the milestone by such behaviors, in dependency order: a multi-command CLI gives a slice per command (add / list / done / rm), a CRUD resource a slice per operation.'
  const DIRECTIVE = 'the slice budget is the sizing authority, not behavior count'
  const sliceBrief = (calls) => calls.find((c) => c.label.startsWith('krs-one:slice-plan')).prompt

  // trivial (all-zero) => the grouping directive, and the per-command example is GONE
  const triv = await runBuild({ ...baseArgs, posture: gaugePosture(mkProf(), gaugeConfig) }, mkRespond())
  assert.ok(sliceBrief(triv.calls).includes(DIRECTIVE), 'trivial tier briefs the budget-grouping directive')
  assert.ok(!sliceBrief(triv.calls).includes(PRE_P55_TEXT), 'the per-command fragmentation example dies at trivial tier')

  // standard (one elevated dim) => byte-identical pre-P5.5 sentence, no directive
  const std = await runBuild({ ...baseArgs, posture: gaugePosture(mkProf({ D1: 1 }), gaugeConfig) }, mkRespond())
  assert.ok(sliceBrief(std.calls).includes(PRE_P55_TEXT), 'standard tier keeps the pre-P5.5 decomposition text verbatim')
  assert.ok(!sliceBrief(std.calls).includes(DIRECTIVE), 'no directive at standard')

  // the r1 trap: high dims, effort 0 => standard behavior
  const trap = await runBuild({ ...baseArgs, posture: gaugePosture(mkProf({ D1: 2, D2: 2, D5: 2, D6: 2, D7: 2 }), gaugeConfig) }, mkRespond())
  assert.ok(sliceBrief(trap.calls).includes(PRE_P55_TEXT) && !sliceBrief(trap.calls).includes(DIRECTIVE), 'high-dims/effort-0 reads standard')

  // absent posture (resume compatibility) => fail-soft standard
  const bare = await runBuild(baseArgs, mkRespond())
  assert.ok(sliceBrief(bare.calls).includes(PRE_P55_TEXT) && !sliceBrief(bare.calls).includes(DIRECTIVE), 'absent posture fails soft to standard')
})

test('milestone gate chain (P5.5): the REAL posture() at an all-zero (trivial) profile routes a 2-slice milestone to the skip path with goal-backward still run', async () => {
  const { posture: gaugePosture } = await import('../../plugins/kiln/src/gauge.mjs')
  const gaugeConfig = JSON.parse(readFileSync(new URL('../../plugins/kiln/gauge-config.json', import.meta.url), 'utf8'))
  const allZero = Object.fromEntries(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'].map((d) => [d, { score: 0, evidence: 'quiet' }]))
  const posture = gaugePosture(allZero, gaugeConfig)
  assert.equal(posture.scope_tier, 'trivial')
  assert.equal(posture.milestone_gate.min_slices_for_tribunal, 3)
  const { result, calls } = await runBuild({ ...baseArgs, posture }, mkRespond())
  assert.equal(count(calls, 'ken:qa') + count(calls, 'ryu:qa') + count(calls, 'judge-dredd:verdict'), 0, 'no analysts below the bumped threshold')
  assert.equal(count(calls, 'aristotle:goal-backward'), 1, 'goal-backward NEVER skips')
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

test('runner downshift (P5.5 T3): the transcription seat is haiku at trivial posture and sonnet at standard — at BOTH the per-slice and gate-only call sites (the high-dims/effort-0 trap reads standard)', async () => {
  const { posture: gaugePosture } = await import('../../plugins/kiln/src/gauge.mjs')
  const gaugeConfig = JSON.parse(readFileSync(new URL('../../plugins/kiln/gauge-config.json', import.meta.url), 'utf8'))
  const mkProf = (over = {}) => Object.fromEntries(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'].map((d) => [d, { score: over[d] || 0, evidence: 'e' }]))
  const runnerModels = (calls) => labelsOf(calls, 'asimov:runner').map((c) => c.model)

  const trivial = gaugePosture(mkProf(), gaugeConfig)
  const standard = gaugePosture(mkProf({ D1: 1 }), gaugeConfig)
  const trap = gaugePosture(mkProf({ D1: 2, D2: 2, D5: 2, D6: 2, D7: 2 }), gaugeConfig) // effort 0, but 5 elevated dims
  assert.equal(trivial.scope_tier, 'trivial')
  assert.equal(standard.scope_tier, 'standard')
  assert.equal(trap.scope_tier, 'standard')

  // per-slice call site (the normal build trial — two slices ⇒ two per-slice runner trials)
  const triv = await runBuild({ ...baseArgs, posture: trivial }, mkRespond())
  const trivModels = runnerModels(triv.calls)
  assert.equal(trivModels.length, 2, 'two per-slice trials')
  assert.ok(trivModels.every((m) => m === 'haiku'), 'per-slice runner downshifts to haiku at trivial posture')
  const std = await runBuild({ ...baseArgs, posture: standard }, mkRespond())
  const stdModels = runnerModels(std.calls)
  assert.equal(stdModels.length, 2)
  assert.ok(stdModels.every((m) => m === 'sonnet'), 'per-slice runner stays sonnet at standard posture')
  const trapRun = await runBuild({ ...baseArgs, posture: trap }, mkRespond())
  const trapModels = runnerModels(trapRun.calls)
  assert.equal(trapModels.length, 2)
  assert.ok(trapModels.every((m) => m === 'sonnet'), 'the high-dims/effort-0 profile keeps the per-slice runner at sonnet')

  // gate-only call site (the starved-gate retry — one runner over ALL milestone SCs)
  const gTriv = await runBuild({ ...baseArgs, gateOnly: true, posture: trivial }, mkRespond())
  assert.deepEqual(runnerModels(gTriv.calls), ['haiku'], 'gate-only runner downshifts to haiku at trivial posture')
  const gStd = await runBuild({ ...baseArgs, gateOnly: true, posture: standard }, mkRespond())
  assert.deepEqual(runnerModels(gStd.calls), ['sonnet'], 'gate-only runner stays sonnet at standard posture')
  const gTrap = await runBuild({ ...baseArgs, gateOnly: true, posture: trap }, mkRespond())
  assert.deepEqual(runnerModels(gTrap.calls), ['sonnet'], 'the high-dims/effort-0 profile keeps the gate-only runner at sonnet')
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

// ── D3 (plan WS-D): churn-aware speculation — admitSpeculation self-disables lever 3 when this ─────
//    milestone ran hot; re-enables automatically when calm. NULL-KEEP: a wrong admission costs one
//    wasted or one missed overlap, never correctness (pipelineInvalidated stays the rail). ──
const specSlice = (over = {}) => ({ approved: true, split_required: false, environment_blocked: false, logical_rejections: 0, ...over })

test('D3 admitSpeculation calm: an all-approved zero-rejection milestone speculates (admit, reason null, counts reported)', () => {
  assert.deepEqual(admitSpeculation([specSlice(), specSlice()]), { admit: true, reason: null, corrections: 0, slices: 2 })
})

test('D3 admitSpeculation zero-slices: nothing churned ⇒ calm — an empty array AND every non-array both admit (totality)', () => {
  assert.deepEqual(admitSpeculation([]), { admit: true, reason: null, corrections: 0, slices: 0 })
  for (const bad of [undefined, null, 'x', {}, 42, NaN]) {
    assert.deepEqual(admitSpeculation(bad), { admit: true, reason: null, corrections: 0, slices: 0 }, `non-array ${String(bad)} reads as zero slices`)
  }
})

test('D3 admitSpeculation split_or_blocked: any split_required OR environment_blocked ⇒ HOT — precedence over unapproved/correction_rate (a split slice is also unapproved)', () => {
  const rSplit = admitSpeculation([specSlice(), specSlice({ split_required: true, approved: false })])
  assert.equal(rSplit.admit, false)
  assert.equal(rSplit.reason, 'split_or_blocked')
  assert.equal(rSplit.slices, 2)
  const rBlocked = admitSpeculation([specSlice({ environment_blocked: true, approved: false })])
  assert.equal(rBlocked.reason, 'split_or_blocked')
  // split precedence even when the correction rate is also hot
  assert.equal(admitSpeculation([specSlice({ split_required: true, approved: false, logical_rejections: 5 })]).reason, 'split_or_blocked')
})

test('D3 admitSpeculation unapproved_slice: any approved !== true ⇒ HOT (when nothing split/blocked); approved must be STRICTLY true', () => {
  const r = admitSpeculation([specSlice(), specSlice({ approved: false })])
  assert.equal(r.admit, false)
  assert.equal(r.reason, 'unapproved_slice')
  assert.equal(admitSpeculation([specSlice({ approved: undefined })]).reason, 'unapproved_slice', 'a missing approved is not strictly true ⇒ unapproved')
})

test('D3 admitSpeculation correction_rate: Σ logical_rejections ≥ ceil(sliceCount/2) ⇒ HOT — the ≥ boundary is pinned exactly', () => {
  // 4 slices: ceil(4/2)=2 — EXACTLY 2 rejections is HOT (≥, not >)
  const at = admitSpeculation([specSlice({ logical_rejections: 2 }), specSlice(), specSlice(), specSlice()])
  assert.deepEqual(at, { admit: false, reason: 'correction_rate', corrections: 2, slices: 4 })
  // one below (1 over 4) is CALM
  assert.deepEqual(admitSpeculation([specSlice({ logical_rejections: 1 }), specSlice(), specSlice(), specSlice()]), { admit: true, reason: null, corrections: 1, slices: 4 })
  // odd count: 3 slices, ceil(3/2)=2 — 2 HOT, 1 calm
  assert.equal(admitSpeculation([specSlice({ logical_rejections: 2 }), specSlice(), specSlice()]).reason, 'correction_rate')
  assert.equal(admitSpeculation([specSlice({ logical_rejections: 1 }), specSlice(), specSlice()]).admit, true)
  // single slice: ceil(1/2)=1 — one rejection is HOT; the sum may spread across slices
  assert.equal(admitSpeculation([specSlice({ logical_rejections: 1 })]).reason, 'correction_rate')
  assert.equal(admitSpeculation([specSlice({ logical_rejections: 1 }), specSlice({ logical_rejections: 1 }), specSlice(), specSlice()]).reason, 'correction_rate', 'Σ=2 over 4 slices spread across two slices is HOT')
})

test('D3 admitSpeculation totality: malformed entries read as their falsy/0 value and never throw (advisory, never a gate)', () => {
  const r = admitSpeculation([null, 'x', 42, { logical_rejections: 'NaN' }])
  assert.equal(r.admit, false, 'every malformed row is approved!==true ⇒ HOT via unapproved_slice')
  assert.equal(r.reason, 'unapproved_slice')
  assert.equal(r.corrections, 0, 'a non-numeric logical_rejections reads as 0')
  assert.equal(admitSpeculation([specSlice({ logical_rejections: -5 })]).corrections, 0, 'a negative logical_rejections contributes 0, never a negative')
})

test('D3 wiring (bundled artifact): a HOT milestone HOLDS the next milestone\'s speculative slice plan — speculation_disabled ledgered, build.speculation_held beat fires, NO M2 speculative cut during M1\'s gate; proves admitSpeculation is inlined + wired', async () => {
  // M1 churns: its one slice takes ONE logical rejection then approves → logical_rejections=1,
  // ceil(1/2)=1 ⇒ HOT (correction_rate). The gate would likely invalidate a speculative plan, so
  // the pipeline never launches — M2 plans ONCE, synchronously, at its own head. HEAD is stable so
  // the calm control (the lever-3 tests above) would otherwise speculate.
  let disabled = null
  const { calls, log } = await runBuild(baseArgs, mkPipeline(() => 'HEAD_STABLE', (label, prompt) => {
    if (label.includes(':review:M1:s0:f0')) return rejectLogical // one logical rejection on M1's slice, then default reviewOk approves
    if (label === 'thoth:ledger' && /speculation_disabled/.test(prompt)) { disabled = prompt; return { ok: true } }
  }))
  assert.ok(disabled, 'the held speculation is ledgered (speculation_disabled) — proves admitSpeculation is inlined and the hold branch ran')
  assert.match(disabled, /"reason":"correction_rate"/, 'the ledgered reason is the churn class')
  assert.match(disabled, /"next_milestone":"M2"/)
  assert.match(disabled, /"milestone":"M1"/)
  // the speculative M2 plan was NEVER cut during M1's gate — M2 plans exactly once, at its own head
  assert.equal(labelsOf(calls, 'krs-one:slice-plan:M2').length, 1, 'M2 planned exactly once — synchronously; no speculative cut was burned')
  assert.equal(labelsOf(calls, 'thoth:head:M1:pipeline-base').length, 0, 'the base anchor never fired — the hold skips headSha entirely')
  assert.equal(labelsOf(calls, 'thoth:head:M2:pipeline-check').length, 0, 'no consume-time check — there was no pipelined plan to consume')
  // the beat rode the ledger, verbatim tail
  const beats = labelsOf(calls, 'thoth:ledger').filter((l) => /build\.speculation_held/.test(l.prompt))
  assert.equal(beats.length, 1, 'the build.speculation_held lore beat fires once')
  assert.match(beats[0].prompt, /the next cut waits for a settled anvil/)
  assert.ok(log.some((l) => /Holding M2's speculative slice plan/.test(l)))
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
    assert.match(s.prompt, /sweeps THIS build's own browser trees ONLY/, 'run-token scoped, never a concurrent run')
    assert.match(s.prompt, /blanket 'pkill -f chrome' is forbidden/)
  }
  const led = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('browser_sweep'))
  assert.equal(led.length, 2, 'both sweeps are ledgered (§3.5 — every browser-lifecycle action is an event)')
  assert.match(led[0].prompt, /"when":"pre-flight"/)
  assert.match(led[0].prompt, new RegExp(`"token":"${token}"`), 'the ledger records the scoping token')
  assert.match(led[1].prompt, /"when":"stage-end"/)
})

// ── P3.6 T3: each sweep leg ALSO runs the READ-ONLY leak-scan (RUN-B FINDING 3b) ─────────────────
// The sweep bracket learns to SEE a foreign browser it does not own — a stray Playwright temp-profile
// or Playwright-MCP browser, in a namespace no sweep reaps. browser_sweep now carries leak_suspects
// on EVERY bracket (baseline proof); the suspect/profile-dir detail rides a SEPARATE browser_leak_
// suspect event ONLY when count>0 (a lean ledger — zero-suspect scans ride the count).
test('T2.3 leak-scan: each sweep leg runs the READ-ONLY leak-scan right after the owned sweep; browser_sweep gains leak_suspects on every bracket; browser_leak_suspect rides ONLY when a foreign browser is seen', async () => {
  let sweepN = 0
  const { calls } = await runBuild(baseArgs, mkRespond({}, (label) => {
    if (label.startsWith('sentinel:sweep')) {
      // pre-flight sees 2 foreign browsers + 1 abandoned profile dir; stage-end sees a clean box
      return ++sweepN === 1
        ? { leak_suspects: 2, suspects: [{ pid: 111, arg0: '/opt/ms-playwright/chrome-headless-shell', namespace: 'playwright_chromiumdev_profile-', user_data_dir: '/tmp/playwright_chromiumdev_profile-abc' }, { pid: 222, arg0: '/opt/ms-playwright/chrome-headless-shell', namespace: 'ms-playwright/mcp-', user_data_dir: '/tmp/ms-playwright/mcp-x' }], profile_dirs: [{ path: '/tmp/playwright_chromiumdev_profile-dead', mtime: '2026-07-02T00:00:00.000Z' }] }
        : { leak_suspects: 0, suspects: [], profile_dirs: [] }
    }
    return undefined
  }))
  const sweeps = labelsOf(calls, 'sentinel:sweep')
  assert.equal(sweeps.length, 2)
  for (const s of sweeps) {
    assert.match(s.prompt, /node \/plug\/scripts\/kiln-probe\.mjs sweep kbuild-\w+/, 'the owned-namespace sweep runs first')
    assert.match(s.prompt, /node \/plug\/scripts\/kiln-probe\.mjs leak-scan\b/, 'the READ-ONLY foreign-browser scan runs right after')
    assert.match(s.prompt, /kills NOTHING, removes NOTHING/, 'the leg states the read-only contract to the scribe')
  }
  // the evidence-schema discipline (review r1 ruling): every field the ledger event carries is
  // REQUIRED — a schema-legal scribe can never report leak_suspects>0 while dropping the detail
  const sweepSchema = sweeps[0].schema
  assert.deepEqual([...sweepSchema.required].sort(), ['leak_scan_line', 'leak_suspects', 'profile_dirs', 'suspects', 'sweep_line'])
  assert.deepEqual([...sweepSchema.properties.suspects.items.required].sort(), ['arg0', 'namespace', 'pid', 'user_data_dir'])
  assert.deepEqual([...sweepSchema.properties.profile_dirs.items.required].sort(), ['mtime', 'path'])
  // baseline: every bracket ledgers browser_sweep WITH both arm counts
  const sweepLedgers = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('"browser_sweep"'))
  assert.equal(sweepLedgers.length, 2, 'browser_sweep is ledgered on every bracket')
  for (const l of sweepLedgers) assert.match(l.prompt, /"leak_suspects":\d+/, 'browser_sweep data gains leak_suspects on every bracket (baseline proof)')
  assert.match(sweepLedgers[0].prompt, /"leak_profile_dirs":1/, 'the disk arm rides the baseline too — dirs-only evidence is never silently dropped (review r1 ruling)')
  assert.match(sweepLedgers[1].prompt, /"leak_profile_dirs":0/, 'a clean box records zero, honestly')
  // detail: browser_leak_suspect rides ONLY the pre-flight bracket (2 suspects), NOT the clean stage-end
  const suspectLedgers = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('"browser_leak_suspect"'))
  assert.equal(suspectLedgers.length, 1, 'browser_leak_suspect is appended ONLY when a foreign browser is seen (count>0)')
  assert.match(suspectLedgers[0].prompt, /"when":"pre-flight"/, 'the detail event rides the bracket that saw the leak')
  assert.match(suspectLedgers[0].prompt, /"pid":111/, 'the suspect detail is carried in data')
  assert.match(suspectLedgers[0].prompt, /"profile_dirs":\[/, 'the abandoned-profile detail rides too')
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
    calls.push({ label, prompt, model, schema: (opts && opts.schema) || null })
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

// ── P3.5 T3: gate-only retry path (dogfood finding 4) — re-run a STARVED milestone gate over an
//    already-COMPLETED build. Scoring + Forging are SKIPPED; ONE deterministic Law check over ALL
//    the milestone's SCs (verify + run --only/--expect-green, NO --flips) gates the milestone, then
//    the FULL tribunal (conservative — the prior slice count is unknown to a fresh session). Refuses
//    with gate-only-on-red on anything but a fully-green Law. Pipelining never fires. ───────────────

const gateOnlyArgs = { ...baseArgs, gateOnly: true }

test('gateOnly happy path: NO slicer / NO confirm / NO builder — ONE Law check over ALL milestone SCs, then the FULL tribunal (ken ∥ ryu ∥ goal-backward), QA_PASS, gate_only flagged and counted as passed', async () => {
  const { result, calls } = await runBuild(gateOnlyArgs, mkRespond())
  // Scoring + Forging skipped entirely
  assert.equal(count(calls, 'krs-one:slice-plan'), 0, 'gate-only never slices')
  assert.equal(count(calls, 'krs-one:confirm'), 0, 'gate-only never confirms a slice')
  assert.equal(count(calls, ':build:'), 0, 'gate-only never builds — a starved gate is re-run, not re-built')
  // ONE deterministic Law check (runner + freshness), not one-per-slice
  assert.equal(count(calls, 'asimov:runner'), 1, 'one gate-only trial pass over the whole milestone')
  assert.equal(count(calls, 'thoth:freshness'), 1)
  assert.ok(labelsOf(calls, 'asimov:runner')[0].label.endsWith(':M1:gate-only'))
  // the FULL tribunal regardless of slice count
  assert.equal(count(calls, 'ken:qa'), 1)
  assert.equal(count(calls, 'ryu:qa'), 1)
  assert.equal(count(calls, 'aristotle:goal-backward'), 1)
  assert.equal(result.built[0].qa, 'QA_PASS')
  assert.equal(result.built[0].gate_only, true)
  assert.equal(result.built[0].tests_green, true, 'a green gate-only Law must read as tests_green so the milestone counts as passed')
  assert.equal(result.all_passed, true)
  assert.deepEqual(result.passed, ['M1'])
})

test('gateOnly runner prompt: verify + run --only ALL milestone SCs with --expect-green and NO --flips / NO --before (a regressions/green check, nothing is being flipped)', async () => {
  const { calls } = await runBuild(gateOnlyArgs, mkRespond())
  const runner = labelsOf(calls, 'asimov:runner')[0].prompt
  assert.match(runner, /kiln-law\.mjs verify \/tmp\/kiln-x \/tmp\/kiln-x\/\.kiln/)
  assert.match(runner, /kiln-law\.mjs run \/tmp\/kiln-x \/tmp\/kiln-x\/\.kiln --only SC-001,SC-002 --expect-green SC-001,SC-002 --run-prefix kbuild-/)
  assert.doesNotMatch(runner, /--flips/, 'gate-only flips nothing')
  assert.doesNotMatch(runner, /--before/, 'gate-only has no RED→GREEN lifecycle, so no statusBefore anchor')
  assert.match(runner, /every milestone SC is GREEN now over the completed build/)
})

test('gateOnly refuse-on-red: kiln-law run exit 1 (an SC not green over the completed build) → QA_FAIL with gate-only-on-red, NO tribunal, ledgered gate_only_refused — never gates a red Law, never builds', async () => {
  const { result, calls } = await runBuild(gateOnlyArgs, mkRespond({}, (label) => {
    if (label.startsWith('asimov:runner')) return { ...runnerOk, law_run_exit: 1 }
  }))
  assert.equal(count(calls, ':build:'), 0, 'a refused gate never builds')
  assert.equal(count(calls, 'ken:qa') + count(calls, 'ryu:qa') + count(calls, 'aristotle:goal-backward') + count(calls, 'judge-dredd:verdict'), 0, 'a red Law never reaches the tribunal under gate-only')
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.equal(result.built[0].gate_only, true)
  assert.match(result.built[0].findings.join(' '), /gate-only-on-red/)
  assert.match(result.built[0].findings.join(' '), /never gates a red Law/)
  const led = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('gate_only_refused'))
  assert.equal(led.length, 1, 'the refusal is ledgered')
  assert.match(led[0].prompt, /gate-only-on-red/)
  assert.equal(result.all_passed, false)
})

test('gateOnly refuse-on-stale: stale/missing evidence (no results.jsonl) → gate-only-on-red, NO tribunal — gate-only never gates over untrusted evidence', async () => {
  const { result, calls } = await runBuild(gateOnlyArgs, mkRespond({}, (label) => {
    if (label.startsWith('thoth:freshness')) return { ...freshOk, results_jsonl_exists: false }
  }))
  assert.equal(count(calls, 'ken:qa') + count(calls, 'aristotle:goal-backward'), 0, 'stale evidence never reaches the tribunal')
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings.join(' '), /gate-only-on-red/)
  assert.equal(labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('gate_only_refused')).length, 1)
})

test('gateOnly refuse-on-tamper: kiln-law verify exit 2 (a locked path touched) → gate-only-on-red, NO tribunal', async () => {
  const { result, calls } = await runBuild(gateOnlyArgs, mkRespond({}, (label) => {
    if (label.startsWith('asimov:runner')) return { reasoning: 'r', verify_exit: 2, tamper_paths: ['.kiln/law.json'] }
  }))
  assert.equal(count(calls, 'ken:qa') + count(calls, 'aristotle:goal-backward'), 0)
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings.join(' '), /gate-only-on-red/)
})

test('gateOnly routes CONSERVATIVELY to the FULL tribunal regardless of min_slices_for_tribunal — a raised dial cannot downgrade a fresh-session gate (the prior slice count is unknown)', async () => {
  const posture = { milestone_gate: { min_slices_for_tribunal: 9 } }
  const { result, calls } = await runBuild({ ...gateOnlyArgs, posture }, mkRespond())
  assert.equal(count(calls, 'ken:qa'), 1, 'the dual analysts fire under gate-only even at a high threshold')
  assert.equal(count(calls, 'ryu:qa'), 1)
  assert.equal(count(calls, 'aristotle:goal-backward'), 1)
  assert.equal(result.built[0].qa, 'QA_PASS')
})

test('gateOnly milestone gate: a blocking goal-backward finding still fails the gate (the §3.2 gate is unchanged under gate-only — only the build legs are skipped)', async () => {
  const { result, calls } = await runBuild(gateOnlyArgs, mkRespond({}, (label) => {
    if (label.startsWith('aristotle:goal-backward')) return { reasoning: 'r', overall: 'fail', findings: [{ text: 'the milestone goal is unreachable from the entry point', severity: 'critical' }] }
  }))
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings.join(' '), /unreachable from the entry point/)
})

test('gateOnly tribunal correction runs the NORMAL build+trial path (the existing correction code, unchanged) — a blocking analyst finding fires one corrective build + re-trial', async () => {
  const blocking = { reasoning: 'r', overall: 'fail', findings: [{ text: 'integration gap between slices', severity: 'critical' }] }
  const { result, calls } = await runBuild(gateOnlyArgs, mkRespond({}, (label) => {
    if (label.startsWith('ken:qa')) return blocking
  }))
  // the correction is the NORMAL build+trial path — a real fix, not a skipped build
  const correction = calls.find((c) => c.label.includes(':build:M1:correct1'))
  assert.ok(correction, 'gate-only corrections build (the existing correction path, reused unchanged)')
  assert.match(correction.prompt, /integration gap between slices/)
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, 'hasBlocking ⇒ computed QA_FAIL, no judge')
  assert.equal(result.built[0].qa, 'QA_FAIL')
})

test('gateOnly NEVER pipelines: a two-milestone run cuts NO speculative slice plan and probes NO pipeline base/check HEAD (nothing would consume a plan — gate-only slices nothing)', async () => {
  const { calls, result } = await runBuild(gateOnlyArgs, mkRespond({ law: lawM1M2, milestones: twoMilestones }))
  assert.equal(count(calls, 'krs-one:slice-plan'), 0, 'gate-only launches no slice plan, speculative or otherwise')
  assert.equal(count(calls, 'thoth:head'), 0, 'no pipeline base/check HEAD probes — the pipelining lever is guarded off')
  // both milestones gated independently, each with its own gate-only trial + full tribunal
  assert.equal(count(calls, 'asimov:runner'), 2, 'one gate-only trial per milestone')
  assert.equal(count(calls, 'ken:qa'), 2)
  assert.equal(result.built.length, 2)
  assert.equal(result.all_passed, true)
})

test('gateOnly skips the per-milestone codebase-state doc update (nothing was built — "was just built" would be a lie, and there is no next-milestone slicer to feed)', async () => {
  const { calls } = await runBuild(gateOnlyArgs, mkRespond())
  assert.equal(count(calls, 'rakim:state'), 0, 'no living-docs update under gate-only')
})

// ── P3.6 T4: the build stage brackets (RUN-B FINDING 2) — stage_started at the pre-flight bracket,
//    stage_completed ONLY on the genuine all-milestones-passed return. A QA_FAIL leaves the stage
//    current, so the projection reads 'build' and the conductor re-enters via the correction loop. ──
const stageLedgers = (calls, type) => labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes(`"type":"${type}"`))

test('P3.6 T4 stage brackets: the success path emits stage_started once and exactly one stage_completed; a QA_FAIL emits stage_started but NO stage_completed (the stage stays current)', async () => {
  // success: the happy path — every milestone passes its gate → all_passed
  const ok = await runBuild(baseArgs, mkRespond())
  assert.equal(ok.result.all_passed, true)
  const okStarted = stageLedgers(ok.calls, 'stage_started')
  const okCompleted = stageLedgers(ok.calls, 'stage_completed')
  assert.equal(okStarted.length, 1, 'stage_started fires exactly once, at the pre-flight bracket')
  assert.equal(okCompleted.length, 1, 'the genuine-completion path emits exactly one stage_completed')
  assert.match(okStarted[0].prompt, /"stage":"build"/, 'the entry bracket names the build stage')
  assert.match(okCompleted[0].prompt, /"stage":"build"/, 'stage_completed carries stage:build so the projection bumps to validate')
  // ordering: stage_started precedes EVERY other build-stage ledger event — the pre-flight sweep
  // appends browser_sweep at stage:'build', and a projection read must never see build events while
  // stage still reads the prior projection (T4 review r1) — and stage_completed follows the gate
  const labels = ok.calls.map((c) => c.label)
  const firstBuild = labels.findIndex((l) => l.includes(':build:'))
  const startedIdx = ok.calls.indexOf(okStarted[0])
  const completedIdx = ok.calls.indexOf(okCompleted[0])
  const preflightSweepIdx = labels.findIndex((l) => l.startsWith('sentinel:sweep'))
  assert.ok(preflightSweepIdx > -1, 'the pre-flight sweep leg exists')
  assert.ok(startedIdx > -1 && startedIdx < preflightSweepIdx, 'stage_started precedes the pre-flight sweep (the first build-stage ledger activity)')
  assert.ok(startedIdx < firstBuild, 'stage_started is bracketed before the first builder')
  assert.ok(completedIdx > firstBuild, 'stage_completed lands after the build work, on the completion return')

  // failure: a split (logical rejections) drives a milestone QA_FAIL → all_passed false → no completion
  const fail = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.includes(':review:')) return rejectLogical
  }))
  assert.equal(fail.result.all_passed, false)
  assert.equal(fail.result.built[0].qa, 'QA_FAIL')
  assert.equal(stageLedgers(fail.calls, 'stage_started').length, 1, 'stage_started still fires — the stage WAS entered')
  assert.equal(stageLedgers(fail.calls, 'stage_completed').length, 0, 'a QA_FAIL never emits stage_completed — the projection stays at build')
})

test('P3.6 T4 stage brackets: a floor-gate refusal (no pluginRoot) emits NEITHER bracket — the stage was never entered', async () => {
  const { calls } = await runBuild({ kilnDir: '/tmp/k/.kiln', projectPath: '/tmp/k' }, mkRespond())
  assert.equal(stageLedgers(calls, 'stage_started').length, 0)
  assert.equal(stageLedgers(calls, 'stage_completed').length, 0)
})

test('P3.6 T4 stage brackets: a gateOnly retry that ends green completes the stage (stage_started fires as a re-entry, stage_completed on the all-passed return)', async () => {
  const { result, calls } = await runBuild(gateOnlyArgs, mkRespond())
  assert.equal(result.all_passed, true)
  const started = stageLedgers(calls, 'stage_started')
  assert.equal(started.length, 1, 'gateOnly re-enters the stage — stage_started fires')
  assert.match(started[0].prompt, /"gate_only":true/, 'the entry bracket records the gate-only re-entry')
  assert.equal(stageLedgers(calls, 'stage_completed').length, 1, 'a green gate-only pass completes the stage')
})

// ── D1 failure-fingerprint retry router + D2 probe reject briefs + D5 slice telemetry (§9) ────────
// The RUNNER now transcribes evidence/<runId>/results.jsonl into check_results; the in-script
// admitRetry routes the NEXT builder attempt off the failure fingerprint. FAIL TOWARD v3.0.1: every
// existing test above passes a runner WITHOUT check_results, so the fingerprint is null and the
// admission is byte-identical to the old unconditional respawn (that is why none of them changed).
const redInfra = { ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-001'], check_results: [{ id: 'SC-001', exit: 124, timeout: true }] }
const redAssert = { ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-001'], check_results: [{ id: 'SC-001', exit: 1, timeout: false }] }

test('D1 environment_repeat: identical INFRA failure ×2 → NO third builder spawn, ONE environment-repair trial, slice closed environment_blocked (splitLedger carries the distinct class marker)', async () => {
  const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) return redInfra // the same infra fault every trial
  }))
  assert.equal(count(calls, ':build:'), 2, 'initial + ONE fix build — the environment repeat NEVER burns a builder attempt into an unchanged broken environment')
  assert.equal(count(calls, 'asimov:runner'), 3, 'fix0 trial + fix1 trial + ONE environment-repair trial (same commit, no builder change)')
  assert.equal(count(calls, ':review:'), 0, 'a red Law never reaches a reviewer')
  const pe = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('posture_escalated'))
  assert.equal(pe.length, 2, 'the repair probe AND the environment-blocked close are each ledgered')
  assert.ok(pe.some((l) => l.prompt.includes('environment_repair')), 'the environment-repair probe is ledgered')
  assert.ok(pe.some((l) => l.prompt.includes('environment_blocked')), 'the environment-blocked close is ledgered')
  assert.deepEqual(result.split_required, [{ milestone: 'M1', slice: 'M1:s0', sc_ids: ['SC-001'], class: 'environment' }], 'the splitLedger surface carries the distinct environment marker — the conductor reads "environment, not code"')
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.match(result.built[0].findings.join(' '), /environment_blocked/, 'the milestone-gate finding names the environment block')
})

test('D1 environment repair RECOVERY: the same infra fault twice, but the no-change repair trial goes GREEN → it was environmental noise, the loop resumes and the slice PASSES (still no extra builder spawn)', async () => {
  let trials = 0
  const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) { trials++; return trials <= 2 ? redInfra : runnerOk } // repair (3rd) recovers
  }))
  assert.equal(count(calls, 'asimov:runner'), 3, 'fix0, fix1, then the ONE environment-repair trial')
  assert.equal(count(calls, ':build:'), 2, 'the repair used NO builder — the loop resumed on the recovered green')
  assert.equal(count(calls, ':review:'), 1, 'only the recovered (green, proceed) repair trial reaches a reviewer')
  assert.equal(result.built[0].qa, 'QA_PASS')
  assert.deepEqual(result.split_required, [], 'a recovered environment repeat is not blocked')
})

test('D1 assertion_repeat: identical ASSERTION failure ×2 → the retry is admitted but the Sentinel signal STRENGTHENS — split fires ONE CYCLE SOONER (2 builds, not the v3.0.1 three)', async () => {
  const { result, calls, log } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) return redAssert // the same assertion fault every trial
  }))
  assert.equal(count(calls, ':build:'), 2, 'escalate-diagnosis drives the split at fix1 — the v3.0.1 unconditional path would take 3 builds')
  assert.equal(count(calls, 'asimov:runner'), 2, 'assertion repeat ADMITS the retry — no environment-repair trial')
  const pe = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('posture_escalated'))
  assert.equal(pe.length, 1, 'the +1 diagnosis jump lands directly on split_and_rebuild — no separate feedback-escalation ledger')
  assert.ok(pe[0].prompt.includes('split_and_rebuild'))
  assert.ok(log.some((l) => /escalating diagnosis/.test(l)), 'the diagnosis escalation is logged')
  assert.deepEqual(result.split_required, [{ milestone: 'M1', slice: 'M1:s0', sc_ids: ['SC-001'] }])
})

test('D1 progress: CHANGING failure signatures admit exactly as v3.0.1 — the call/label sequence is byte-identical to a run with NO check_results', async () => {
  let t = 0
  const withFp = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) { t++; return { ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-001'], check_results: [{ id: `C${t}`, exit: 1, timeout: false }] } } // a NEW failing id each trial ⇒ progress
  }))
  const noFp = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) return { ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-001'] } // v3.0.1: no check_results
  }))
  assert.deepEqual(withFp.calls.map((c) => c.label), noFp.calls.map((c) => c.label), 'a changing fingerprint never diverts the admission — identical label sequence to v3.0.1')
  assert.deepEqual(withFp.result.split_required, noFp.result.split_required)
})

test('D1 fail-safe: garbled/missing check_results → NO fingerprint → v3.0.1 admission exactly (3 builds, split at 3, no repair trial) — a PARTIAL garble beside a valid infra row included (Sol r1-3 atomicity)', async () => {
  for (const bad of [undefined, 'garbage', [{ id: '', exit: 'x' }], [{ nope: 1 }], [{ id: 'SC-001', exit: 124, timeout: true }, { nope: 1 }]]) {
    const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
      if (label.startsWith('asimov:runner')) return { ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-001'], check_results: bad }
    }))
    assert.equal(count(calls, ':build:'), 3, `check_results=${JSON.stringify(bad)} → v3.0.1 unconditional respawns`)
    assert.equal(count(calls, 'asimov:runner'), 3, 'no environment-repair trial — a garbled transcription means no fingerprint')
    assert.deepEqual(result.split_required, [{ milestone: 'M1', slice: 'M1:s0', sc_ids: ['SC-001'] }])
  }
})

test('D1 runner prompt: the runner is instructed to transcribe results.jsonl into check_results (id, exit, timeout = 124/79) — and told the transcription happens on EVERY run, a red exit skipping only the suite (r1 advisory)', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }))
  const runner = labelsOf(calls, 'asimov:runner')[0].prompt
  assert.match(runner, /results\.jsonl.*check_results/s)
  assert.match(runner, /timeout = true iff exit is 124 or 79/)
  assert.match(runner, /a red law_run_exit skips only the suite, never this/)
  assert.match(runner, /STOP after that transcription — skip step 3/)
})

test('D2 probe reject brief: a FAILED probe check makes the fix build brief carry the deterministic artifact paths (probe-<id>.json, .log, screenshot) — script-assembled from runId + failed ids', async () => {
  const lawProbe = [{ id: 'SC-001', milestone: 'M1', kind: 'probe' }]
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawProbe, plan: planOne, milestones: [milestone({ surface: 'ui' })] }, (label) => {
    if (label.startsWith('asimov:runner')) return redAssert // the probe SC fails red
  }))
  const fix1 = calls.find((c) => c.label.includes(':build:M1:s0:fix1'))
  assert.ok(fix1, 'a fix build fires after the first probe rejection')
  assert.match(fix1.prompt, /\/tmp\/kiln-x\/\.kiln\/evidence\/RUN1\/probe-SC-001\.json/)
  assert.match(fix1.prompt, /probe-SC-001\.log/)
  assert.match(fix1.prompt, /screenshot/)
  assert.match(fix1.prompt, /READ its captured evidence/)
  assert.match(fix1.prompt, /NOT browser authority/, 'reading artifacts is not browser authority — the builder still never spawns a browser')
})

test('D2 probe reject brief: a SHELL (non-probe) failure carries NO artifact paths — the brief stays plain', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) return redAssert
  }))
  const fix1 = calls.find((c) => c.label.includes(':build:M1:s0:fix1'))
  assert.ok(fix1)
  assert.doesNotMatch(fix1.prompt, /probe-SC-001\.json/, 'a shell check leaves no probe artifacts to name')
})

test('D2 tribunal fixNote: a milestone-gate correction over probe-covered SCs inherits the last trial\'s probe artifacts (from lastRunId + the milestone probe SCs)', async () => {
  const lawProbeTwo = [{ id: 'SC-001', milestone: 'M1', kind: 'probe' }, { id: 'SC-002', milestone: 'M1', kind: 'probe' }]
  const blocking = { reasoning: 'r', overall: 'fail', findings: [{ text: 'the two panels never wire together', severity: 'critical' }] }
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawProbeTwo, plan: planTwo, milestones: [milestone({ surface: 'ui' })] }, (label) => {
    if (label.startsWith('ken:qa')) return blocking // blocking → computed QA_FAIL → correction loop
  }))
  const correction = calls.find((c) => c.label.includes(':build:M1:correct1'))
  assert.ok(correction, 'the tribunal correction build fires')
  assert.match(correction.prompt, /evidence\/RUN1\/probe-SC-001\.json/)
  assert.match(correction.prompt, /evidence\/RUN1\/probe-SC-002\.json/)
  assert.match(correction.prompt, /READ its captured evidence/)
})

test('D5 slice telemetry: each slice close emits a note{kind:slice_telemetry} carrying the required deterministic keys (NO clocks)', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond())
  const notes = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('slice_telemetry'))
  assert.equal(notes.length, 2, 'one telemetry note per slice')
  const p = notes[0].prompt
  assert.match(p, /"type":"note"/)
  for (const key of ['"kind":"slice_telemetry"', '"slice_id":"M1:s0"', '"surface":"logic"', '"builder_model":"sonnet"', '"reviewer_escalated":false', '"attempts":1', '"rejection_classes":[]', '"fingerprint":null', '"first_pass_green":true', '"environment_blocked":false', '"split":false']) {
    assert.ok(p.includes(key), `slice_telemetry note must carry ${key}`)
  }
})

test('D5 slice telemetry: an environment-blocked slice records environment_blocked:true and the last fingerprint signature', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) return redInfra
  }))
  const note = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('slice_telemetry'))[0].prompt
  assert.match(note, /"environment_blocked":true/)
  assert.match(note, /"fingerprint":"infra\|SC-001:infra"/)
  assert.match(note, /"split":false/)
})

// ── Sol WSD-r1 round-2 fixes: the repair trial is an OBSERVATION; mixed honesty; telemetry null ──

test('D1 repair observation (Sol r1-1 + r2-1): identical infra ×2, the repair trial fails RED with a CHANGED signature → the observation never counts, but the GENUINE outer rejection still escalates the Sentinel — the admitted correction is reviewed by the ESCALATED source and the slice RECOVERS (no split)', async () => {
  let trials = 0
  const { result, calls, log } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) {
      trials++
      if (trials <= 2) return redInfra                       // fix0 + fix1: the identical infra fault
      if (trials === 3) return redAssert                     // the repair trial: still red, but the failure MOVED
      return runnerOk                                        // the admitted correction goes green
    }
  }))
  assert.equal(count(calls, 'asimov:runner'), 4, 'fix0 + fix1 + the ONE repair trial + the admitted correction\'s trial')
  assert.equal(count(calls, ':build:'), 3, 'initial + fix1 + the ONE admitted correction — the repair itself spends no builder')
  const reviews = labelsOf(calls, ':review:')
  assert.equal(reviews.length, 1, 'only the recovered green trial reaches a reviewer')
  assert.equal(reviews[0].model, 'sonnet', 'Sol r2-1: the correction is reviewed by the ESCALATED source — the outer rejection reached the feedback threshold, so the family swapped')
  assert.ok(reviews[0].label.endsWith(':esc'), 'the correction review rides the escalated leg')
  assert.equal(result.built[0].qa, 'QA_PASS', 'the promised correction was admitted and the slice recovered — round-1 wrongly split here (2 rejections + the observation reached the split threshold)')
  assert.deepEqual(result.split_required, [], 'no split, no environment block')
  assert.ok(log.some((l) => /moved the failure/.test(l)), 'the moved-fingerprint observation is logged')
  const pe = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('posture_escalated'))
  assert.equal(pe.length, 2, 'the environment-repair probe AND the outer rejection\'s feedback escalation are each ledgered — the observation itself spends nothing')
  assert.ok(pe.some((l) => l.prompt.includes('environment_repair')))
  assert.ok(pe.some((l) => l.prompt.includes('escalate_feedback_source')), 'Sol r2-1: escalate() still runs for the genuine outer rejection at its already-incremented count')
  assert.ok(!pe.some((l) => l.prompt.includes('split_and_rebuild')), 'the observation never pushes the count to the split threshold')
})

test('D1 repair observation (Sol r1-1 + r2-1): the repair trial clears the Law but the REVIEWER rejects → observation not counted, the outer rejection still escalates — the admitted correction is reviewed by the ESCALATED source, recovery to QA_PASS (no split)', async () => {
  let trials = 0
  let revN = 0
  const { result, calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) { trials++; return trials <= 2 ? redInfra : runnerOk } // repair (3rd) + correction (4th) go green
    if (label.includes(':review:')) { revN++; return revN === 1 ? rejectLogical : reviewOk } // the repair's reviewer rejects; the correction's approves
  }))
  assert.equal(count(calls, 'asimov:runner'), 4, 'fix0 + fix1 + the repair trial + the correction\'s trial')
  const reviews = labelsOf(calls, ':review:')
  assert.equal(reviews.length, 2, 'the repair\'s green trial reached a reviewer (rejected), then the correction\'s (approved)')
  assert.equal(reviews[0].model, 'opus', 'the repair observation itself is reviewed by the not-yet-escalated source (the outer rejection\'s escalation follows the observation)')
  assert.equal(reviews[1].model, 'sonnet', 'Sol r2-1: the admitted correction is reviewed by the ESCALATED (swapped-family) source')
  assert.ok(reviews[1].label.endsWith(':esc'))
  assert.equal(count(calls, ':build:'), 3, 'initial + fix1 + the ONE admitted correction')
  assert.equal(result.built[0].qa, 'QA_PASS', 'round-1 wrongly split here: 2 environmental rejections + the observation\'s reviewer rejection reached the split threshold')
  assert.deepEqual(result.split_required, [])
  const correction = calls.find((c) => c.label.includes(':build:M1:s0:fix2'))
  assert.ok(correction, 'the admitted correction is the fix2 build')
  assert.match(correction.prompt, /wrong behavior in add\(\)/, 'the correction brief carries the repair reviewer\'s findings')
  const pe = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('posture_escalated'))
  assert.equal(pe.length, 2, 'environment_repair + the outer rejection\'s escalate_feedback_source — no split_and_rebuild')
  assert.ok(pe.some((l) => l.prompt.includes('environment_repair')))
  assert.ok(pe.some((l) => l.prompt.includes('escalate_feedback_source')))
  assert.ok(!pe.some((l) => l.prompt.includes('split_and_rebuild')))
})

test('D1 cap extension (Sol r2-2): a moved repair at fix === MAX_REVIEW_FIXES still admits its ONE promised correction — the observation consumed no builder attempt, the extension is one-shot, and the correction is reviewed by the escalated source', async () => {
  // Sol's reachable sequence: two mechanical rejections, a first infra fingerprint at fix2, the
  // identical infra fingerprint at fix3 (the cap), then a CHANGED repair fingerprint.
  let trials = 0
  let revN = 0
  const mechReject = { reasoning: 'r', verdict: 'REJECTED', law_green: true, tests_green: true, findings: [{ text: 'stray debug print', finding_class: 'mechanical' }] }
  const { result, calls, log } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.startsWith('asimov:runner')) {
      trials++
      if (trials <= 2) return runnerOk    // fix0 + fix1: green Law, the reviewer rejects mechanically
      if (trials <= 4) return redInfra    // fix2: first infra fp · fix3 (the cap): the identical repeat
      if (trials === 5) return redAssert  // the repair trial: MOVED
      return runnerOk                     // the extension correction goes green
    }
    if (label.includes(':review:')) { revN++; return revN <= 2 ? mechReject : reviewOk }
  }))
  const fix4 = calls.find((c) => c.label.includes(':build:M1:s0:fix4'))
  assert.ok(fix4, 'Sol r2-2: the promised correction is admitted DESPITE the cap — round 2 broke on the cap before it')
  assert.equal(count(calls, ':build:'), 5, 'initial + fix1..fix3 + the ONE extension correction — never more than one extension')
  assert.equal(count(calls, 'asimov:runner'), 6, 'four cycle trials + the repair trial + the extension correction\'s trial')
  const reviews = labelsOf(calls, ':review:')
  assert.equal(reviews.length, 3, 'two mechanical rejections + the extension correction\'s review')
  assert.ok(reviews[2].label.endsWith(':esc'), 'the extension correction is reviewed by the escalated source (the outer rejection hit the feedback threshold)')
  assert.equal(result.built[0].qa, 'QA_PASS', 'the extension correction recovered the slice')
  assert.deepEqual(result.split_required, [])
  assert.ok(log.some((l) => /promised correction is still admitted/.test(l)), 'the one-shot cap extension is logged')
})

test('D1 mixed honesty (Sol r1-5): an identical MIXED repeat closes blocked with class \'mixed\' naming the unresolved assertion(s) — never the pure-infra "not the code" claim', async () => {
  const lawBoth = [{ id: 'SC-001', milestone: 'M1', kind: 'shell' }, { id: 'SC-002', milestone: 'M1', kind: 'shell' }]
  const planBoth = [{ objective: 'both', files: [], constraints: '', done_when: 'both work', sc_ids: ['SC-001', 'SC-002'] }]
  const redMixed = { ...runnerOk, law_run_exit: 1, flip_unmet: ['SC-001', 'SC-002'], check_results: [{ id: 'SC-001', exit: 124, timeout: true }, { id: 'SC-002', exit: 1, timeout: false }] }
  const { result, calls, log } = await runBuild(baseArgs, mkRespond({ law: lawBoth, plan: planBoth }, (label) => {
    if (label.startsWith('asimov:runner')) return redMixed // the identical mixed fault every trial
  }))
  assert.equal(count(calls, 'asimov:runner'), 3, 'fix0 + fix1 + the ONE environment-repair trial')
  assert.equal(count(calls, ':build:'), 2, 'the mixed-infra diversion itself is retained (ratified) — no third builder into the unchanged environment')
  assert.deepEqual(result.split_required, [{ milestone: 'M1', slice: 'M1:s0', sc_ids: ['SC-001', 'SC-002'], class: 'mixed', unresolved_assertions: ['SC-002'] }], 'the splitLedger marker is mixed (not environment) and names the unresolved assertion SCs')
  const findings = result.built[0].findings.join(' ')
  assert.match(findings, /UNRESOLVED/, 'the QA finding says the product assertions remain unresolved')
  assert.match(findings, /SC-002/, 'the unresolved assertion SC is named')
  assert.match(findings, /code work is still owed/, 'mixed honesty: code work remains after the environment repair')
  assert.doesNotMatch(findings, /not the code/, 'a MIXED repeat may never claim "environment, not code" — it contains a product assertion')
  assert.ok(log.some((l) => /MIXED failure/.test(l)), 'the blocked log line is the mixed wording')
  assert.ok(log.some((l) => /blocked MIXED \(environment repair \+ unresolved assertions/.test(l)), 'the closing bow distinguishes mixed blocks from split decisions and pure environment repair')
  const blocked = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('"action":"environment_blocked"'))
  assert.equal(blocked.length, 1, 'exactly one blocked-close ledger event (the telemetry note also carries the environment_blocked KEY — filter on the action)')
  assert.match(blocked[0].prompt, /"fingerprint_class":"mixed"/)
  assert.match(blocked[0].prompt, /"unresolved_assertions":\["SC-002"\]/)
})

test('D5 telemetry (Sol r1-4): a rejected NO-fingerprint slice emits fingerprint:null — never the empty string of a truthy null-fingerprint object', async () => {
  const { calls } = await runBuild(baseArgs, mkRespond({ law: lawOne, plan: planOne }, (label) => {
    if (label.includes(':review:')) return { reasoning: 'r', verdict: 'REJECTED', law_green: true, tests_green: true, findings: [{ text: 'stray debug print', finding_class: 'mechanical' }] }
  }))
  const note = labelsOf(calls, 'thoth:ledger').filter((l) => l.prompt.includes('slice_telemetry'))[0].prompt
  assert.ok(note.includes('"fingerprint":null'), 'a reviewer-rejected (green-Law) slice has NO fingerprint — telemetry must carry null')
  assert.ok(!note.includes('"fingerprint":""'), 'the truthy null-fingerprint object must not leak "" (Sol r1-4)')
  assert.match(note, /"first_pass_green":false/)
  assert.match(note, /"attempts":4/)
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// ── B4-2 build keystones at capability tier T4 (D2/D3/D4/D5/D6): the Sol evidence analyst (Ryu bump),
//    the milestone-close ratification pair (Judge Dredd retired), and the correction council. Every
//    Sol leg rides a receipt-attested codex envelope + an invocation-exact ledger cross-check (the
//    inlined gate.mjs + council.mjs machinery, driven by the same programmable mock). Fixtures derive
//    every cross-side hash from real bytes (the architecture-council.test.mjs discipline).
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const T4TOKEN = 'BUILD-RUNTOKEN-xyz'
const t4args = (extra = {}) => ({ ...baseArgs, capabilityTier: 'T4', runToken: T4TOKEN, ...extra })
const shaB = (buf) => createHash('sha256').update(buf).digest('hex')
const oshaOf = (p) => shaB(Buffer.from(JSON.stringify(p)))
const rshaOf = (r) => shaB(Buffer.from(JSON.stringify(r)))
const SESSION = '019f5a46-fc83-7181-8303-f516494485ac', INV = '3'.repeat(64), PSHA = '1'.repeat(64), XSHA = '5'.repeat(64)
const validReceipt = (payload, over = {}) => ({
  receipt_version: 1, parser_version: 'kiln-codex-receipt/1', transport: 'codex_exec', invocation_id: INV,
  prompt_sha256: PSHA, packet_sha256: XSHA, cli_version: '0.144.1', requested_model: 'gpt-5.6-sol',
  reported_model: 'gpt-5.6-sol', session_id: SESSION, exit_code: 0, tokens_used: 18747,
  output_sha256: oshaOf(payload), stderr_sha256: XSHA, ...over,
})
const solEnv = (payload, rOver) => ({ payload, codex_receipt: validReceipt(payload, rOver || {}), raw_artifact_refs: { stderr: 's', output: 'o' } })
const crossOkB = (payload, keystone, phaseTag, over = {}) => ({
  output_sha256_disk: over.disk !== undefined ? over.disk : oshaOf(payload),
  output_canonical_sha256: over.canon !== undefined ? over.canon : sha256Hex(canonicalJson(payload)),
  ledger: {
    verified: over.verified === null ? null : { status: 'verified', invocation_id: INV, receipt_sha256: rshaOf(validReceipt(payload)), output_sha256: oshaOf(payload), session_id: SESSION, reported_model: 'gpt-5.6-sol', tokens_used: 18747, exit_code: 0, receipt_verified: true, ...(over.verified || {}) },
    reservation: over.reservation === null ? null : { invocation_id: INV, keystone, phase: phaseTag, seat: 'sol', attempt: 1, run_token: T4TOKEN, prompt_sha256: PSHA, packet_sha256: XSHA, ...(over.reservation || {}) },
  },
})
const rat = (h, over = {}) => ({ reasoning: 'r', artifact_hash: h, verdict: 'APPROVE', divergence_selections: [], findings: [], changed_evidence: [], ...over })
const corr = (h, choice, over = {}) => ({ reasoning: 'r', artifact_hash: h, findings: [], reasons: ['route'], choice, ...over })
const CLOSE_FINDING = { finding_id: 'CF-1', claim: 'the goal is not reachable from the entry point', required_change: 'wire the entry point', evidence_refs: ['src/app.js:10'], evidence_class: 'repo_state', executable_check: null }
// anchorFilesFromPrompt (B42-3) — mirror the Thoth close-anchor: parse the paths from the
// 'sha256sum <paths>' one-liner and return one {path, sha256} per named artifact (a real 64-hex
// digest of the path bytes, so the in-script evidence_manifest_hash is deterministic + exact-coverage).
const anchorFilesFromPrompt = (prompt) => {
  const m = prompt.match(/sha256sum ([^\n']+)/)
  const paths = m ? m[1].trim().split(/\s+/).filter(Boolean) : []
  return paths.map((p) => ({ path: p, sha256: sha256Hex(p) }))
}

// t4Council(cfg) — a council-leg responder (returns undefined for non-council labels ⇒ mkRespond
// defaults). Captures the close/correction artifact hashes from the fable/sol prompts so the ratify
// payloads + their cross-checks echo whatever hash the workflow computed (robust to closeRecord drift).
function t4Council(cfg = {}) {
  let closeHash = null, corrHash = null
  const analystB = cfg.solAnalyst !== undefined ? cfg.solAnalyst : { findings: [], overall: 'fail', report_markdown: '# b' }
  return (label, prompt) => {
    if (label.startsWith('thoth:probe-exec')) return cfg.probeExec !== undefined ? cfg.probeExec : { executed_ids: [] }
    if (label.startsWith('thoth:close-anchor')) return cfg.closeAnchor !== undefined ? cfg.closeAnchor : { reasoning: 'a', files: anchorFilesFromPrompt(prompt) }
    if (label.startsWith('ken:qa')) return cfg.ken !== undefined ? cfg.ken : { reasoning: 'r', overall: 'pass', findings: [] }
    if (label.startsWith('aristotle:goal-backward')) return cfg.goal !== undefined ? cfg.goal : { reasoning: 'r', overall: 'pass', findings: [] }
    if (label.startsWith('ryu:qa')) return cfg.solAnalystEnv !== undefined ? cfg.solAnalystEnv : solEnv(analystB)
    if (label.startsWith('thoth:receipt-check:ryu:')) return cfg.analystCross !== undefined ? cfg.analystCross : crossOkB(analystB, 'milestone_close:M1', 'QA_EVIDENCE_C0')
    if (label.startsWith('fable:close')) { const m = prompt.match(/artifact_hash = "([0-9a-f]{64})"/); if (m) closeHash = m[1]; return cfg.fableClose ? cfg.fableClose(closeHash) : rat(closeHash) }
    if (label.startsWith('sol:close')) { const m = prompt.match(/"artifact_hash":"([0-9a-f]{64})"/); if (m) closeHash = m[1]; if (cfg.solClose === 'dead') return {}; return cfg.solClose ? solEnv(cfg.solClose(closeHash)) : solEnv(rat(closeHash)) }
    if (label.startsWith('thoth:receipt-check:sol:close')) return crossOkB(cfg.solClose && cfg.solClose !== 'dead' ? cfg.solClose(closeHash) : rat(closeHash), 'milestone_close:M1', 'CLOSE_RATIFY_C0')
    if (label.startsWith('fable:correction')) { const m = prompt.match(/artifact_hash = "([0-9a-f]{64})"/); if (m) corrHash = m[1]; return corr(corrHash, cfg.fableCorr || 'RETRY', cfg.corrOver || {}) }
    if (label.startsWith('sol:correction')) { const m = prompt.match(/"artifact_hash":"([0-9a-f]{64})"/); if (m) corrHash = m[1]; if (cfg.solCorr === 'dead') return {}; return solEnv(corr(corrHash, cfg.solCorr || 'RETRY', cfg.corrOver || {})) }
    if (label.startsWith('thoth:receipt-check:sol:correction')) return crossOkB(corr(corrHash, cfg.solCorr && cfg.solCorr !== 'dead' ? cfg.solCorr : 'RETRY', cfg.corrOver || {}), 'correction:M1', 'CORRECTION_C0')
    return undefined
  }
}
const ledgerPrompts = (calls) => labelsOf(calls, 'thoth:ledger').map((c) => c.prompt)

// ── D3: dual-APPROVE close ⇒ QA_PASS + a twin_ratified certificate (Judge Dredd never spawns) ──
test('D3 milestone close: an ambiguous reconcile at T4 spawns the blind Fable/Sol close pair (NOT Judge Dredd); dual-APPROVE ⇒ QA_PASS + a twin_ratified certificate', async () => {
  const { result, calls } = await runBuild(t4args(), mkRespond({}, t4Council()))
  const exact = (label) => calls.filter((c) => c.label === label).length
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, 'Judge Dredd is retired at T4')
  assert.equal(exact('fable:close:M1:c0'), 1, 'the blind Fable close ratifier is dispatched once on the ambiguous branch')
  assert.equal(exact('sol:close:M1:c0'), 1, 'the receipt-attested Sol close ratifier is dispatched once')
  assert.equal(exact('thoth:receipt-check:sol:close:M1:c0'), 1, 'the Sol close leg is cross-checked invocation-exact')
  assert.equal(result.built[0].qa, 'QA_PASS')
  assert.equal(result.built[0].council.close_terminal, 'RATIFIED')
  assert.equal(result.built[0].council.certificate.label, 'twin_ratified')
  assert.equal(result.built[0].council.certificate.terminal, 'RATIFIED')
})

// ── DSGN-B42-2: certificate context exactness — deterministic non-null evidence_manifest_hash, per-sig provenance ──
test('DSGN-B42-2 certificate context: bundle_hash = plan_hash (the close record IS the artifact), evidence_manifest_hash is non-null + 64-hex, per-signature seat_provenance is distinct', async () => {
  const { result } = await runBuild(t4args(), mkRespond({}, t4Council()))
  const cert = result.built[0].council.certificate
  assert.equal(cert.plan_hash, cert.decision_bundle_hash, 'no second render on the close pair — plan_hash = bundle_hash')
  const [sigF, sigS] = cert.signatures
  assert.equal(sigF.renderer_version, 'b42-close/1')
  assert.ok(/^[0-9a-f]{64}$/.test(sigF.evidence_manifest_hash), 'evidence_manifest_hash is deterministic + non-null (never null)')
  assert.equal(sigF.evidence_manifest_hash, sigS.evidence_manifest_hash)
  assert.equal(sigF.plan_hash, cert.decision_bundle_hash)
  assert.notEqual(canonicalJson(sigF.seat_provenance), canonicalJson(sigS.seat_provenance), 'each signature carries its OWN head provenance')
})

// ── D3: split / BLOCK / dead ⇒ QA_FAIL fail-closed, honest terminal, no judge fallback ──
test('D3 milestone close: a BLOCK verdict ⇒ QA_FAIL fail-closed (terminal BLOCKED), no judge fallback at T4, frozen findings surfaced', async () => {
  const { result, calls } = await runBuild(t4args(), mkRespond({}, t4Council({ fableClose: (h) => ({ ...rat(h), verdict: 'BLOCK', findings: [CLOSE_FINDING] }), fableCorr: 'ESCALATE', solCorr: 'ESCALATE' })))
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, 'a non-dual-APPROVE close never falls back to a judge at T4')
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.equal(result.built[0].council.close_terminal, 'BLOCKED')
  assert.equal(result.built[0].council.certificate, null, 'twin_ratified appears ONLY with a valid certificate')
  assert.ok(result.built[0].findings.some((f) => /CF-1/.test(f)), 'the frozen close_council finding is rendered into the boundary record')
})

test('D3 milestone close: a SPLIT (fable APPROVE, sol BLOCK) ⇒ QA_FAIL fail-closed BLOCKED', async () => {
  const { result } = await runBuild(t4args(), mkRespond({}, t4Council({ solClose: (h) => ({ ...rat(h), verdict: 'BLOCK', findings: [CLOSE_FINDING] }), fableCorr: 'ESCALATE', solCorr: 'ESCALATE' })))
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.equal(result.built[0].council.close_terminal, 'BLOCKED')
})

test('D3 milestone close: a DEAD Sol close seat (no receipt) ⇒ QA_FAIL fail-closed DEGRADED (never a Sonnet stand-in, never a judge)', async () => {
  const { result, calls } = await runBuild(t4args(), mkRespond({}, t4Council({ solClose: 'dead', fableCorr: 'ESCALATE', solCorr: 'ESCALATE' })))
  assert.equal(count(calls, 'judge-dredd:verdict'), 0)
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.equal(result.built[0].council.close_terminal, 'DEGRADED')
})

// ── D2: the Ryu bump — receipt attestation + invocation-exact cross-check binding ──
test('D2 Sol evidence analyst: the Ryu leg rides a receipt-attested codex envelope + an invocation-exact cross-check; a FAILED cross-check (wrong keystone) ⇒ dead analyst B ⇒ QA_FAIL via the reconcile, no close pair', async () => {
  const { result, calls } = await runBuild(t4args(), mkRespond({}, t4Council({ analystCross: crossOkB({ findings: [], overall: 'fail', report_markdown: '# b' }, 'wrong:keystone', 'QA_EVIDENCE_C0') })))
  assert.equal(count(calls, 'thoth:receipt-check:ryu:M1:c0'), 1, 'the analyst receipt is cross-checked')
  assert.equal(count(calls, 'fable:close:M1:c0'), 0, 'a dead analyst B fails the gate closed BEFORE any close pair (unreadable overall ⇒ QA_FAIL)')
  assert.equal(result.built[0].qa, 'QA_FAIL')
})

// ── D4: correction council — three rulings + fail-closed ESCALATE ──
test('D4 correction council: RETRY ⇒ the sole corrective build fires; ESCALATE ⇒ break QA_FAIL, no build; REPLAN ⇒ replan_required marker', async () => {
  // Force a blocking reconcile (computed QA_FAIL, no close pair) so the correction council is reached at c0.
  const blockingKen = { reasoning: 'r', overall: 'fail', findings: [{ text: 'list renders nothing', severity: 'critical' }] }
  const retry = await runBuild(t4args(), mkRespond({}, t4Council({ ken: blockingKen, fableCorr: 'RETRY', solCorr: 'RETRY' })))
  assert.equal(count(retry.calls, 'fable:correction:M1:c0'), 1, 'the correction council runs BEFORE the corrective build')
  assert.ok(labelsOf(retry.calls, ':build:').some((c) => /correct1/.test(c.label)), 'RETRY ⇒ the sole corrective build fires')
  assert.equal(retry.result.built[0].council.correction_ruling, 'RETRY')
  assert.equal(retry.result.built[0].council.correction_terminal, 'RULED', 'B42-5: matched choices ⇒ an honest RULED terminal')

  const escalate = await runBuild(t4args(), mkRespond({}, t4Council({ ken: blockingKen, fableCorr: 'ESCALATE', solCorr: 'ESCALATE' })))
  assert.ok(!labelsOf(escalate.calls, ':build:').some((c) => /correct1/.test(c.label)), 'ESCALATE ⇒ NO corrective build spent')
  assert.equal(escalate.result.built[0].qa, 'QA_FAIL')
  assert.equal(escalate.result.built[0].council.correction_ruling, 'ESCALATE')
  assert.ok(escalate.result.built[0].findings.some((f) => /ESCALATE/.test(f)))

  const replan = await runBuild(t4args(), mkRespond({}, t4Council({ ken: blockingKen, fableCorr: 'REPLAN', solCorr: 'REPLAN' })))
  assert.equal(replan.result.built[0].council.replan_required, true, 'REPLAN ⇒ the never-silent replan_required marker on the milestone result')
  assert.equal(replan.result.built[0].council.correction_ruling, 'REPLAN')
})

test('D4 correction council: a SPLIT (fable RETRY, sol ESCALATE) ⇒ fail-closed ESCALATE (never a silent RETRY); a DEAD correction seat ⇒ fail-closed ESCALATE', async () => {
  const blockingKen = { reasoning: 'r', overall: 'fail', findings: [{ text: 'broken', severity: 'high' }] }
  const split = await runBuild(t4args(), mkRespond({}, t4Council({ ken: blockingKen, fableCorr: 'RETRY', solCorr: 'ESCALATE' })))
  assert.equal(split.result.built[0].council.correction_ruling, 'ESCALATE', 'a split correction routes fail-closed to ESCALATE')
  assert.equal(split.result.built[0].council.correction_terminal, 'BLOCKED', 'B42-5: a LIVE legal split is an honest BLOCKED terminal (not silently unlabeled)')
  assert.ok(!labelsOf(split.calls, ':build:').some((c) => /correct1/.test(c.label)))
  const dead = await runBuild(t4args(), mkRespond({}, t4Council({ ken: blockingKen, solCorr: 'dead' })))
  assert.equal(dead.result.built[0].council.correction_ruling, 'ESCALATE', 'a dead correction seat routes fail-closed to ESCALATE')
  assert.equal(dead.result.built[0].council.correction_terminal, 'DEGRADED', 'B42-5: a dead correction seat is an honest DEGRADED terminal')
})

// ── DSGN-B42-1: the frozen close_council_findings reach the correction packet AND the corrective fixNote ──
test('DSGN-B42-1 council-findings carriage: a blocked close freezes its findings into qaFindings, the correction-council packet, AND the corrective build fixNote (verbatim IDs)', async () => {
  const { result, calls } = await runBuild(t4args(), mkRespond({}, t4Council({ fableClose: (h) => ({ ...rat(h), verdict: 'BLOCK', findings: [CLOSE_FINDING] }), fableCorr: 'RETRY', solCorr: 'RETRY' })))
  assert.equal(result.built[0].council.close_terminal, 'BLOCKED')
  const corrFable = calls.find((c) => c.label === 'fable:correction:M1:c0').prompt
  assert.match(corrFable, /close-council-findings/, 'the correction packet carries a close-council-findings block')
  assert.match(corrFable, /CF-1/, 'the frozen finding id rides the correction packet verbatim')
  const correctBuild = calls.find((c) => /:build:.*correct1/.test(c.label)).prompt
  assert.match(correctBuild, /CF-1/, 'the corrective build fixNote carries the frozen finding id — never spent blind to what blocked the close')
})

// ── B42-2: the Sol evidence analyst packet NAMES the per-milestone/cycle artifacts (script-derived) ──
test('B42-2 analyst packet names the artifacts: the Sol evidence analyst packet + brief name law.json + the last trial\'s results/suite/run files (from lastRunId), not just the evidence-dir root', async () => {
  const { calls } = await runBuild(t4args(), mkRespond({}, t4Council()))
  const ryu = calls.find((c) => c.label === 'ryu:qa:M1:c0').prompt
  assert.match(ryu, /\/tmp\/kiln-x\/\.kiln\/law\.json/, 'law.json is named')
  assert.match(ryu, /evidence\/RUN1\/results\.jsonl/, 'the last trial results are named')
  assert.match(ryu, /evidence\/RUN1\/suite\.log/, 'the last trial suite log is named')
  assert.match(ryu, /evidence\/RUN1\/run\.json/, 'the run manifest is named')
  assert.match(ryu, /"evidence_artifacts":\[/, 'the packet carries the NAMED evidence_artifacts, not the bare dir root')
  // B42-2 derived-probe semantics: a shell-only milestone has no probe SCs ⇒ NO derivation leg is
  // dispatched and NO probe artifact is named (the analyst list derives from executed state, never the Law).
  assert.equal(count(calls, 'thoth:probe-exec'), 0, 'no probe SCs ⇒ no derivation leg dispatched (logic milestone byte-preserved)')
  const ryuArtifacts = (ryu.match(/"evidence_artifacts":\[([^\]]*)\]/) || [])[1] || ''
  assert.doesNotMatch(ryuArtifacts, /probe/, 'a shell-only milestone names NO probe artifact in the evidence_artifacts list')
})

// ── B42-3: the close record BINDS names to hashes (a Thoth anchor); a dead/partial anchor ⇒ DEGRADED ──
test('B42-3 evidence-bound close: a Thoth transcription leg binds each NAMED artifact to its sha256, both packets carry the COMPLETE closeRecord, and a dead/partial anchor ⇒ DEGRADED (the certificate never binds unhashed names)', async () => {
  // a dead/partial anchor fails the close CLOSED — the certificate must never bind unhashed names
  const deadAnchor = await runBuild(t4args(), mkRespond({}, t4Council({ closeAnchor: { reasoning: 'a', files: [] }, fableCorr: 'ESCALATE', solCorr: 'ESCALATE' })))
  assert.equal(deadAnchor.result.built[0].council.close_terminal, 'DEGRADED', 'a dead/partial anchor fails the close CLOSED')
  assert.equal(deadAnchor.result.built[0].council.certificate, null)
  assert.equal(deadAnchor.result.built[0].qa, 'QA_FAIL')

  // the happy close: the anchor binds {path, sha256}; both packets carry the complete closeRecord
  const { calls } = await runBuild(t4args(), mkRespond({}, t4Council()))
  assert.equal(calls.filter((c) => c.label === 'thoth:close-anchor:M1:c0').length, 1, 'the Thoth transcription leg runs once')
  const solClose = calls.find((c) => c.label === 'sol:close:M1:c0').prompt
  assert.match(solClose, /"evidence_refs":\[\{"path":/, 'the sol packet carries the complete closeRecord with {path, sha256} evidence_refs (never bare path strings)')
  assert.match(solClose, /law\.json/, 'law.json is bound in the evidence refs')
  const fableClose = calls.find((c) => c.label === 'fable:close:M1:c0').prompt
  assert.match(fableClose, /evidence_refs/, 'the fable prompt carries the complete frozen closeRecord')
  assert.match(fableClose, /results\.jsonl/, 'the last trial results are bound')
  // AMB-B42-2: a suite-recorded build (buildOk.test_command = 'npm test') names the FULL five-artifact
  // manifest — law.json + results.jsonl + suite.log + suite.jsonl + run.json — and states it honestly.
  assert.match(solClose, /suite\.log/, 'a suite-recorded build binds suite.log')
  assert.match(solClose, /suite\.jsonl/, 'and suite.jsonl')
  assert.match(solClose, /"suite_recorded":true/, 'the close record honestly states the full manifest it binds')
  const anchor = calls.find((c) => c.label === 'thoth:close-anchor:M1:c0').prompt
  assert.equal(anchorFilesFromPrompt(anchor).length, 5, 'the full five-artifact manifest (law + results + suite.log + suite.jsonl + run)')
  // B42-3 derived-probe semantics: a shell-only milestone binds NO probe artifact — the close manifest
  // never names probe-<SC> files that the trial did not record (derived from executed state, not the Law).
  assert.doesNotMatch(anchor, /probe-/, 'a shell-only milestone binds NO probe artifact into the close manifest')
  assert.match(solClose, /"executed_probe_ids":\[\]/, 'the close record honestly states an empty executed-probe set when the milestone has no probe SCs')
})

// ── AMB-B42-2: a genuinely suite-less product at the ambiguous close names the REDUCED manifest — no
//    absent suite file is named, so the pair CONVENES (suite_recorded:false) instead of DEGRADING ──
test('AMB-B42-2 suite-less close: a build that recorded NO project suite names only law.json + results.jsonl + run.json — the pair CONVENES over the reduced hashed manifest (suite_recorded:false), never a spurious DEGRADE', async () => {
  const council = t4Council()
  const suiteless = (label, prompt, model) => {
    if (label.includes(':build:')) return { ...buildOk, test_command: undefined }
    return council(label, prompt, model)
  }
  const { result, calls } = await runBuild(t4args(), mkRespond({}, suiteless))
  assert.equal(count(calls, 'fable:close:M1:c0'), 1, 'the close pair convenes over the reduced manifest — no spurious anchor DEGRADE')
  assert.equal(result.built[0].qa, 'QA_PASS', 'a genuinely suite-less product never spuriously DEGRADEs at the close')
  assert.equal(result.built[0].council.close_terminal, 'RATIFIED')
  const anchor = calls.find((c) => c.label === 'thoth:close-anchor:M1:c0').prompt
  assert.doesNotMatch(anchor, /suite\.log/, 'the close anchor names NO suite file when none was recorded')
  assert.doesNotMatch(anchor, /suite\.jsonl/)
  assert.match(anchor, /results\.jsonl/, 'results.jsonl is always named')
  assert.match(anchor, /run\.json/, 'run.json is always named')
  assert.equal(anchorFilesFromPrompt(anchor).length, 3, 'exactly the reduced three-artifact manifest (law + results + run)')
  const solClose = calls.find((c) => c.label === 'sol:close:M1:c0').prompt
  assert.match(solClose, /"suite_recorded":false/, 'the close record honestly states the reduced manifest it binds')
  assert.doesNotMatch(solClose, /suite\.log/, 'the reduced evidence_refs bind no absent suite file')
  // B42-2 fix (brief point 4): the Sol analyst's NAMED list (the packet's evidence_artifacts) gets the
  // SAME script-side conditioning, so the analyst list and the close-anchor list never disagree.
  const ryu = calls.find((c) => c.label === 'ryu:qa:M1:c0').prompt
  const ryuArtifacts = (ryu.match(/"evidence_artifacts":\[([^\]]*)\]/) || [])[1] || ''
  assert.doesNotMatch(ryuArtifacts, /suite/, 'the Sol analyst named list drops the suite files too — the two named lists never disagree')
  assert.match(ryuArtifacts, /results\.jsonl/, 'results.jsonl stays named in the analyst list')
})

// ── B42-2/B42-3 (derived-probe semantics): probe artifacts derive from the trial's RECORDED execution
//    state — a DEFERRED probe is named NOWHERE; an EXECUTED probe is named in the analyst packet AND the
//    close manifest AND hash-bound in evidence_refs. ONE derivation leg feeds both named lists. ──
test('B42-2/B42-3 derived-probe close: a DEFERRED probe SC is named nowhere (analyst packet + close manifest both omit it) while an EXECUTED probe SC is named in BOTH and hash-bound in evidence_refs (single derivation leg)', async () => {
  const lawProbeTwo = [{ id: 'SC-001', milestone: 'M1', kind: 'probe' }, { id: 'SC-002', milestone: 'M1', kind: 'probe' }]
  const state = { milestones: [uiMilestone()], law: lawProbeTwo, plan: planTwo }
  // the single derivation leg reports SC-001 EXECUTED (a recorded exit row) and SC-002 NOT (deferred → no artifacts)
  const { result, calls } = await runBuild(t4args(), mkRespond(state, t4Council({ probeExec: { executed_ids: ['SC-001'] } })))
  assert.equal(count(calls, 'thoth:probe-exec:M1:c0'), 1, 'the single probe-execution derivation leg runs once per gate cycle')
  // (B42-2) the analyst packet NAMES the executed probe artifacts and OMITS the deferred one
  const ryu = calls.find((c) => c.label === 'ryu:qa:M1:c0').prompt
  assert.match(ryu, /evidence\/RUN1\/probe-SC-001\.json/, 'the executed probe result is named in the analyst packet')
  assert.match(ryu, /evidence\/RUN1\/probe-SC-001\.log/, 'the executed probe log is named in the analyst packet')
  assert.doesNotMatch(ryu, /probe-SC-002/, 'a DEFERRED probe left no artifacts — the analyst packet names it NOWHERE (never the Law probe list)')
  // (B42-3) the close anchor HASHES the executed probe artifacts and OMITS the deferred one
  const anchor = calls.find((c) => c.label === 'thoth:close-anchor:M1:c0').prompt
  assert.match(anchor, /probe-SC-001\.json/, 'the close anchor hashes the executed probe result')
  assert.match(anchor, /probe-SC-001\.log/, 'and the executed probe log')
  assert.doesNotMatch(anchor, /probe-SC-002/, 'the close anchor never hashes a deferred probe artifact')
  // (B42-3) the executed probe artifacts ENTER closeRecord.evidence_refs (hash-bound) + executed_probe_ids
  const solClose = calls.find((c) => c.label === 'sol:close:M1:c0').prompt
  assert.match(solClose, /"path":"[^"]*probe-SC-001\.json","sha256":"[0-9a-f]{64}"/, 'the executed probe result is hash-bound in evidence_refs (never a bare path)')
  assert.match(solClose, /"executed_probe_ids":\["SC-001"\]/, 'the close record states exactly the executed probe id it binds')
  assert.doesNotMatch(solClose, /probe-SC-002/, 'the deferred probe enters neither evidence_refs nor executed_probe_ids')
  // the certificate seals over the manifest that now includes the executed probe artifacts
  assert.equal(result.built[0].qa, 'QA_PASS')
  assert.equal(result.built[0].council.close_terminal, 'RATIFIED')
})

// ── B42-4: per-slice fingerprint + attempts ride the correction packet (retained on the slice records) ──
test('B42-4 correction telemetry: the correction packet carries per-slice fingerprint + attempts (retained on the slice records, passed through sliceTelemetry)', async () => {
  const blockingKen = { reasoning: 'r', overall: 'fail', findings: [{ text: 'list renders nothing', severity: 'critical' }] }
  const { calls } = await runBuild(t4args(), mkRespond({}, t4Council({ ken: blockingKen, fableCorr: 'RETRY', solCorr: 'RETRY' })))
  const corrFable = calls.find((c) => c.label === 'fable:correction:M1:c0').prompt
  assert.match(corrFable, /"fingerprint":/, 'per-slice fingerprint rides the correction packet')
  assert.match(corrFable, /"attempts":/, 'per-slice attempts ride the correction packet')
  const corrSol = calls.find((c) => c.label === 'sol:correction:M1:c0').prompt
  assert.match(corrSol, /"fingerprint":/, 'the Sol packet carries the same telemetry')
  assert.match(corrSol, /"attempts":/)
})

test('B42-4 correction telemetry VALUE: a reject-then-green slice records fingerprint:null — the last attempt was green, never the overcome failure signature (Sol r2 seed: the value, not just the key)', async () => {
  const blockingKen = { reasoning: 'r', overall: 'fail', findings: [{ text: 'x', severity: 'critical' }] }
  const council = t4Council({ ken: blockingKen, fableCorr: 'RETRY', solCorr: 'RETRY' })
  let trials = 0
  const { calls } = await runBuild(t4args(), mkRespond({}, (label, prompt, model) => {
    // slice0's FIRST trial is RED with an assertion fingerprint; every later trial is GREEN — so slice0
    // is reject-then-green (approved) and slice1 is first-pass green.
    if (label.startsWith('asimov:runner')) { trials++; return trials === 1 ? redAssert : runnerOk }
    return council(label, prompt, model)
  }))
  const corrFable = calls.find((c) => c.label === 'fable:correction:M1:c0').prompt
  const tel = JSON.parse(corrFable.match(/Slice telemetry: (\[[^\n]*\])/)[1])
  const s0 = tel.find((s) => s.id === 'M1:s0')
  assert.equal(s0.fingerprint, null, 'B42-4: an APPROVED (reject-then-green) slice carries fingerprint:null — the decisive trial was green, no failure signature')
  assert.ok(s0.attempts >= 2, 'the slice really did retry (fix0 red → fix1 green) before approval — the null is earned, not vacuous')
  assert.ok(!/assertion\|SC-001/.test(corrFable), 'the overcome assertion signature never leaks into the correction telemetry')
})

// ── B42-5: the correction heads' findings + reasons are RETAINED and ride qaFindings verbatim ──
test('B42-5 correction findings carried: ESCALATE rides the heads\' retained findings + reasons verbatim into qaFindings (never generic synthesized prose), with an honest RULED terminal', async () => {
  const blockingKen = { reasoning: 'r', overall: 'fail', findings: [{ text: 'broken', severity: 'high' }] }
  const { result } = await runBuild(t4args(), mkRespond({}, t4Council({ ken: blockingKen, fableCorr: 'ESCALATE', solCorr: 'ESCALATE', corrOver: { findings: [{ text: 'the route needs a conductor decision', severity: 'high' }], reasons: ['beyond one corrective build'] } })))
  assert.equal(result.built[0].council.correction_ruling, 'ESCALATE')
  assert.equal(result.built[0].council.correction_terminal, 'RULED', 'both heads agree on ESCALATE ⇒ matched ⇒ RULED')
  assert.ok(result.built[0].findings.some((f) => /the route needs a conductor decision/.test(f)), 'the correction finding rides qaFindings verbatim')
  assert.ok(result.built[0].findings.some((f) => /beyond one corrective build/.test(f)), 'the correction reason rides qaFindings verbatim')
})

test('B42-5 dead-seat carriage: a DEAD Sol correction seat still carries the SURVIVING Fable head\'s findings + reasons verbatim into qaFindings AND the council_ruling note (never discarded on a degraded pair)', async () => {
  const blockingKen = { reasoning: 'r', overall: 'fail', findings: [{ text: 'broken', severity: 'high' }] }
  // sol correction seat is DEAD (no receipt); the fable head survives with its own findings + reasons.
  const { result, calls } = await runBuild(t4args(), mkRespond({}, t4Council({ ken: blockingKen, solCorr: 'dead', corrOver: { findings: [{ text: 'the surviving head still ruled the route', severity: 'high' }], reasons: ['the fable seat reasoning survives the dead sol seat'] } })))
  assert.equal(result.built[0].council.correction_ruling, 'ESCALATE', 'a dead correction seat routes fail-closed to ESCALATE')
  assert.equal(result.built[0].council.correction_terminal, 'DEGRADED', 'and is an honest DEGRADED terminal')
  assert.ok(result.built[0].findings.some((f) => /the surviving head still ruled the route/.test(f)), 'the surviving Fable head\'s finding rides qaFindings verbatim (never discarded on a dead seat)')
  assert.ok(result.built[0].findings.some((f) => /the fable seat reasoning survives/.test(f)), 'the surviving head\'s reason rides qaFindings verbatim')
  const ruling = ledgerPrompts(calls).find((p) => /"phase":"CORRECTION_C0"/.test(p) && /"terminal":"DEGRADED"/.test(p))
  assert.ok(ruling && /the surviving head still ruled the route/.test(ruling), 'the council_ruling note carries the surviving head\'s finding')
})

// ── B42-7: an invalid close ratification degrades honestly — never mislabeled BLOCKED ──
test('B42-7 invalid close ratification: dual APPROVE echoing a WRONG artifact_hash ⇒ DEGRADED (never mislabeled BLOCKED, never a frozen-findings carry from an invalid verdict)', async () => {
  const badHash = '9'.repeat(64)
  const { result } = await runBuild(t4args(), mkRespond({}, t4Council({ fableClose: () => rat(badHash), solClose: () => rat(badHash), fableCorr: 'ESCALATE', solCorr: 'ESCALATE' })))
  assert.equal(result.built[0].qa, 'QA_FAIL')
  assert.equal(result.built[0].council.close_terminal, 'DEGRADED', 'an invalid ratification degrades honestly — never mislabeled BLOCKED')
  assert.equal(result.built[0].council.certificate, null)
})

// ── red-findings monotonicity (structural): hasBlocking ⇒ QA_FAIL with NO close-pair dispatch ──
test('red-findings monotonicity: a blocking reconcile ⇒ computed QA_FAIL with NO close-pair dispatch — a council can never green a deterministic red gate', async () => {
  const blockingKen = { reasoning: 'r', overall: 'fail', findings: [{ text: 'the store is never read', severity: 'critical' }] }
  const { result, calls } = await runBuild(t4args(), mkRespond({}, t4Council({ ken: blockingKen, fableCorr: 'ESCALATE', solCorr: 'ESCALATE' })))
  assert.equal(count(calls, 'fable:close:M1:c0'), 0, 'a deterministic QA_FAIL never reaches the close pair (structural red monotonicity)')
  assert.equal(count(calls, 'sol:close:M1:c0'), 0)
  assert.equal(result.built[0].qa, 'QA_FAIL')
})

// ── B42-1 (the fail-open catch): promised-but-tokenless ⇒ analyst B is a DEAD SEAT (zero legacy Ryu),
//    QA_FAIL before any computed pass, never a silent Judge Dredd downgrade; sub-T4 byte-preserved ──
test('B42-1 promised-but-tokenless: T4 + codex but NO runToken, AGREEING zero-blocking analysts ⇒ QA_FAIL DEGRADED with ZERO legacy Ryu dispatches (never a computed QA_PASS, never a Judge Dredd downgrade)', async () => {
  // The exact fail-open seed (Sol's probe): both analysts would agree with zero blocking. Under the OLD
  // code this computed QA_PASS via the legacy receiptless Ryu. Now analyst B is a DEAD SEAT — no Ryu leg
  // is dispatched, and the reconcile arithmetic (unreadable overall B) fails the boundary CLOSED first.
  const { result, calls } = await runBuild({ ...baseArgs, capabilityTier: 'T4' }, mkRespond({}, (label) => {
    if (label.startsWith('ken:qa')) return { reasoning: 'r', overall: 'pass', findings: [] }
    if (label.startsWith('ryu:qa')) return { reasoning: 'r', overall: 'pass', findings: [] } // would-be AGREEING zero-blocking analyst — never reached
    if (label.startsWith('aristotle:goal-backward')) return { reasoning: 'r', overall: 'pass', findings: [] }
    return undefined
  }))
  assert.equal(count(calls, 'ryu:qa'), 0, 'B42-1: analyst B is a DEAD SEAT under misconfiguration — NO legacy receiptless Ryu is ever dispatched (zero legacy_ryu_calls)')
  assert.equal(count(calls, 'judge-dredd:verdict'), 0, 'no silent downgrade to Judge Dredd')
  assert.equal(count(calls, 'fable:close:M1:c0'), 0, 'the close pair cannot convene without a runToken')
  assert.equal(result.built[0].qa, 'QA_FAIL', 'agreeing zero-blocking analysts no longer compute QA_PASS — the boundary fails CLOSED before any computed pass')
  assert.equal(result.built[0].council.close_terminal, 'DEGRADED')
  assert.ok(result.built[0].findings.some((f) => /runToken/.test(f)))
})

test('D5 sub-T4 byte-preservation: at T3 (no council) an ambiguous reconcile spawns the v3.0.1 Judge Dredd — NO Sol analyst envelope, NO close pair, NO receipt-check', async () => {
  const { result, calls } = await runBuild({ ...baseArgs, capabilityTier: 'T3', runToken: T4TOKEN }, mkRespond({}, (label) => {
    if (label.startsWith('ken:qa')) return { reasoning: 'r', overall: 'pass', findings: [] }
    if (label.startsWith('ryu:qa')) return { reasoning: 'r', overall: 'fail', findings: [] }
    if (label.startsWith('aristotle:goal-backward')) return { reasoning: 'r', overall: 'pass', findings: [] }
    if (label.startsWith('judge-dredd:verdict')) return { reasoning: 'r', verdict: 'QA_PASS', findings: [] }
    return undefined
  }))
  assert.equal(count(calls, 'judge-dredd:verdict'), 1, 'T3 keeps the v3.0.1 single-Opus Judge Dredd')
  assert.equal(count(calls, 'fable:close:M1:c0'), 0, 'no close pair below T4')
  assert.equal(count(calls, 'thoth:receipt-check:ryu:M1:c0'), 0, 'the T3 Ryu leg is a plain sonnet — no receipt cross-check')
  assert.equal(result.built[0].qa, 'QA_PASS')
  assert.equal(result.built[0].council, undefined, 'sub-T4 results carry NO council field (byte-preserved)')
})

// ── B42-6: boundary records — the gate_decision council seat-summary ARRAY + the results[].council fields ──
test('B42-6 boundary records: the gate_decision ledger append carries a council seat-summary ARRAY (exact shape, COMPUTED bundle_hash), receipts ride a separate council_receipts key, and results[].council carries the honest terminals', async () => {
  const { result, calls } = await runBuild(t4args(), mkRespond({}, t4Council()))
  const gd = ledgerPrompts(calls).find((p) => p.includes('"type":"gate_decision"'))
  assert.ok(gd, 'a gate_decision event is appended')
  assert.match(gd, /"council":\[/, 'the gate_decision council field is an ARRAY of per-seat summaries')
  assert.match(gd, /"seat":"milestone_close"/)
  assert.match(gd, /"terminal":"RATIFIED"/)
  assert.match(gd, /"certificate_present":true/)
  assert.match(gd, /"bundle_hash":"[0-9a-f]{64}"/, 'bundle_hash is the COMPUTED record hash, present on every seat entry')
  assert.match(gd, /"receipt_verified":true/)
  assert.match(gd, /"ledger_verified":true/)
  assert.match(gd, /"council_receipts":\[/, 'the receipts list rides gate_decision as a SEPARATE council_receipts key')
  assert.equal(result.built[0].council.close_terminal, 'RATIFIED')
  assert.equal(result.built[0].council.replan_required, false)
})

// ── bundled-artifact presence: the extended @inline:council name list ships into workflows/build.js ──
test('bundled artifact: workflows/build.js inlines the extended @inline:council name list (solWrapperPlan, crossCheckOk, assembleRatifyCertificate, RATIFY_SCHEMA, …)', () => {
  const gen = readFileSync(WORKFLOW, 'utf8')
  for (const name of ['solWrapperPlan', 'crossCheckOk', 'assembleRatifyCertificate', 'councilTemplateHash', 'seatProv', 'twinRatified', 'validateRatification', 'buildCheckpoint', 'RATIFY_SCHEMA', 'CROSS_CHECK_SCHEMA', 'envelopeSchema', 'CANON_HASH_ONELINER', 'LEDGER_EXTRACT_ONELINER', 'SHA64_RE']) {
    assert.ok(gen.includes(`function ${name}`) || gen.includes(`const ${name}`), `workflows/build.js must inline ${name}`)
  }
  // the src marker lists the names (build.js source carries the extended @inline:council marker)
  const src = readFileSync(BUILD_SRC, 'utf8')
  assert.match(src, /@inline:council:.*solWrapperPlan.*crossCheckOk.*assembleRatifyCertificate/)
})

// ── capabilityTier threading: build reads A.capabilityTier with the T1..T4 validation idiom ──
test('D5 capabilityTier threading: a garbage capabilityTier ⇒ no council (validated to null, exactly architecture.js:69 idiom)', async () => {
  const { result, calls } = await runBuild({ ...baseArgs, capabilityTier: 'T9', runToken: T4TOKEN }, mkRespond({}, (label) => {
    if (label.startsWith('ken:qa')) return { reasoning: 'r', overall: 'pass', findings: [] }
    if (label.startsWith('ryu:qa')) return { reasoning: 'r', overall: 'fail', findings: [] }
    if (label.startsWith('aristotle:goal-backward')) return { reasoning: 'r', overall: 'pass', findings: [] }
    if (label.startsWith('judge-dredd:verdict')) return { reasoning: 'r', verdict: 'QA_PASS', findings: [] }
    return undefined
  }))
  assert.equal(count(calls, 'fable:close:M1:c0'), 0, 'an unrecognised tier validates to null ⇒ no council')
  assert.equal(count(calls, 'judge-dredd:verdict'), 1, 'the v3.0.1 path stands')
  assert.equal(result.built[0].council, undefined)
})
