# Blueprint: build

The engine reads this blueprint once per milestone to stand up the persistent minds plus krs-one, and returns to it every CYCLE_WORKERS to spawn the next duo, every MILESTONE_QA_READY to run the tribunal, and every milestone boundary to reset. KRS-One consults it inside the conversation for the duo-pool scenarios, the phase ordering, the complete signal vocabulary, and the per-role runtime-prompt templates. Reference posture — the shared contract between the spawning engine and the step boss across the full milestone.

## Meta
- **Team name**: `{kill_streak_name}` — cycles through Kill Streak Sequence based on `team_iteration` in STATE.md (one kill-streak per milestone; `chunk_count` tracks chunks *within* the milestone and does not rotate the name)
- **Artifact directory**: .kiln/
- **Expected output**: Source code (in project), {target}/AGENTS.md, updated living docs (.kiln/docs/codebase-state.md, patterns.md, pitfalls.md, decisions.md)
- **Inputs from previous steps**: .kiln/master-plan.md, .kiln/architecture-handoff.md, .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md, .kiln/docs/patterns.md, .kiln/docs/pitfalls.md, .kiln/design/tokens.json (conditional — present only for UI projects with design direction), .kiln/design/tokens.css (conditional), .kiln/design/creative-direction.md (conditional)
- **Workflow**: three-phase (persistent minds bootstrap, boss scopes, workers cycle per chunk)
- **Invoked once per milestone** by the pipeline runner. KRS-One persists for the full milestone and cycles fresh workers per chunk via CYCLE_WORKERS.

## Pipeline Runner Instructions

The pipeline runner invokes this blueprint once per milestone. The team persists for the full milestone — KRS-One cycles fresh workers internally via CYCLE_WORKERS.

**Signals from KRS-One (to team-lead):**
- `MILESTONE_COMPLETE: {milestone_name}` — milestone done, QA passed. Runner invokes next milestone's team.
- `BUILD_COMPLETE` — all milestones done. Proceed to step 6 (Validate).

**Legacy signal:** `ITERATION_COMPLETE` is now internal to the team (KRS-One cycles workers without runner involvement).

**Team name selection:** Read `team_iteration` from STATE.md. Look up the name in the Kill Streak Sequence. (`chunk_count` is the within-milestone CYCLE_WORKERS counter and does NOT change the team name.)

## Agent Roster

| Name | Agent Type | Role | Phase | Model |
|------|------------|------|-------|-------|
| rakim | dropping-science | Persistent mind. Codebase state authority. Writes codebase-state.md (TL;DR header) + AGENTS.md. Consultation for KRS-One and builders. | A | opus |
| thoth | lore-keepah | Persistent mind. Archivist — owns all writes to .kiln/archive/. Fire-and-forget. Guide scratchpad. | A | opus |
| sentinel | algalon-the-observer | Persistent mind. Quality guardian. Owns patterns.md (TL;DR header) and pitfalls.md. Consultation for quality questions. | A | sonnet |
| krs-one | bossman | Boss. Reads plan, receives READY summaries, scopes chunks, dispatches to worker pairs, delegates milestone QA via MILESTONE_QA_READY. | B (BACKGROUND) | opus |
| *duo pool* | dial-a-coder | Codex-type builder. Thin Codex CLI wrapper — delegates to GPT-5.4. | C (dynamic) | sonnet |
| *duo pool* | critical-thinker | Structural reviewer. Primary reviewer for Default and Fallback scenarios. APPROVED or REJECTED. | C (dynamic) | opus |
| *duo pool* | backup-coder | Sonnet-type builder. Direct implementation via Write/Edit. Fallback scenario. | C (dynamic) | sonnet |
| *duo pool* | la-peintresse | UI builder. Direct Opus implementation of components, pages, layouts, motion. | C (dynamic) | opus |
| *duo pool* | the-curator | UI reviewer. Design quality review with 5-axis advisory scoring. | C (dynamic) | sonnet |
| ken | team-red | QA analyst (Claude Opus). Deep analysis — build, tests, acceptance criteria, integration. Severity-rated report. | D (dynamic) | opus |
| ryu | team-blue | QA analyst (GPT-5.4 via Codex CLI). Independent second perspective. Thin CLI wrapper. | D (dynamic) | sonnet |
| denzel | the-negotiator | QA reconciler. Reads both anonymized QA reports, reconciles discrepancies, writes synthesis. | D (dynamic) | opus |
| judge-dredd | i-am-the-law | QA judge (Opus). Reads synthesis + source reports, issues final QA_PASS or QA_FAIL verdict. | D (dynamic) | opus |

## Canonical Pairs

Workers are spawned from the duo pool (see `references/duo-pool.md`). The `name` parameter is the boss-selected character for this cycle (e.g., `tintin`). The `subagent_type` is the agent type template (e.g., `kiln:dial-a-coder`). Hook enforcement fires on the agent type — not the spawn name. KRS-One selects a duo from the pool using timestamp-seeded rotation.

| Scenario | Builder Type | Reviewer Type | When |
|----------|-------------|---------------|------|
| Default | dial-a-coder | critical-thinker | codex_available=true (structural work) |
| Fallback | backup-coder | critical-thinker | codex_available=false (structural fallback) |
| UI | la-peintresse | the-curator | Components, pages, layouts, motion, design system |

## Three-Phase Spawn

**Phase A** (persistent — spawned once at milestone start): rakim + sentinel + thoth bootstrap in parallel → rakim reads files + updates state → sentinel reads patterns → thoth ensures archive structure → all signal READY. These agents persist for the entire milestone.

**Phase B** (persistent — spawned once at milestone start): krs-one spawns (BACKGROUND). Receives READY summaries from rakim and sentinel in runtime prompt. Reads master plan, scopes the first chunk, then sends `CYCLE_WORKERS` to team-lead to request a fresh worker pair.

**Phase C** (dynamic — spawned per chunk via CYCLE_WORKERS): KRS-One sends `CYCLE_WORKERS: scenario={scenario}, duo_id={id}, coder_name={name}, reviewer_name={name}, reason={reason}, chunk={summary}` to team-lead. The engine shuts down any existing workers (sends `shutdown_request`, 60s timeout), then spawns a fresh builder+reviewer pair for the requested scenario (3 scenarios: default=dial-a-coder+critical-thinker, fallback=backup-coder+critical-thinker, ui=la-peintresse+the-curator). The engine sends `WORKERS_SPAWNED: duo_id={id}, coder_name={name}, reviewer_name={name}` back to KRS-One. Independently, each fresh worker sends `WORKER_READY: ready for assignment` to KRS-One as its first action — Wave 3 belt-and-suspenders fallback so krs-one unblocks even when the engine's WORKERS_SPAWNED path fails. Whichever arrives first unblocks; KRS-One dispatches a structured XML assignment to the fresh builder. After the reviewer sends `IMPLEMENTATION_APPROVED` (Wave 3 — reviewer owns the success handoff; builder just commits and stops on APPROVED), KRS-One sends blocking ITERATION_UPDATE to rakim and sentinel (60s timeout), waits for READY responses, then scopes the next chunk and issues another CYCLE_WORKERS — repeating until the milestone is complete.

Builders commit directly to the repo. The engine manages isolation.

**Phase D** (dynamic — spawned per milestone QA via MILESTONE_QA_READY): KRS-One sends `MILESTONE_QA_READY: {milestone_name}` to team-lead after verifying deliverable completeness, then blocks on `QA_PASS` / `QA_FAIL` (300s timeout). The engine spawns ken (team-red) + ryu (team-blue) in parallel (background) and randomly assigns one to slot `a` and the other to slot `b` via the runtime prompt. Each writes directly to `.kiln/tmp/qa-report-{slot}.md` — **self-anonymisation at spawn time, no mid-flight sed step** (Wave 2). Both signal QA_REPORT_READY to team-lead (tribunal-internal). The engine spawns denzel (the-negotiator), who reads the two slot files and writes reconciliation to `.kiln/tmp/qa-reconciliation.md`, signalling RECONCILIATION_COMPLETE to team-lead. The engine then spawns judge-dredd (i-am-the-law), who issues the final QA_PASS or QA_FAIL verdict **directly to krs-one** (no engine relay — Wave 2 removes the QA_VERDICT hop). The engine shuts down all four QA agents. On PASS, KRS-One proceeds to MILESTONE_COMPLETE. On FAIL, KRS-One re-scopes fixes.

## Signal Vocabulary

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| `READY_BOOTSTRAP: {summary}` | rakim/sentinel/thoth → team-lead | No | PM bootstrap complete; PM available for consultation (Wave 2 distinct-name contract — post-iteration READY targets krs-one, not team-lead) |
| `CYCLE_WORKERS: scenario={s}, duo_id={id}, coder_name={name}, reviewer_name={name}, reason={r}, chunk={c}` | KRS-One → engine | Yes | Engine shuts down old pair, spawns fresh builder+reviewer from duo pool |
| `WORKERS_SPAWNED: duo_id={id}, {builder_name} (subagent_type: {builder_type}), {reviewer_name} (subagent_type: {reviewer_type})` | Engine → KRS-One | Yes (response) | Fresh pair on team, awaiting assignment — canonical CYCLE_WORKERS ack |
| `WORKER_READY: ready for assignment` | Worker → KRS-One | No (fire-and-forget fallback) | Wave 3 belt-and-suspenders: each freshly-spawned worker self-announces on first wake so krs-one unblocks CYCLE_WORKERS even when the engine's WORKERS_SPAWNED is delayed or lost |
| `CYCLE_REJECTED: {reason}` | Engine → KRS-One | Yes (response) | Invalid scenario — KRS-One must fix |
| `IMPLEMENTATION_APPROVED: {summary}` | Reviewer → KRS-One | Yes | Wave 3 success handoff — reviewer owns the signal; builder just commits and stops on APPROVED |
| `IMPLEMENTATION_BLOCKED: {blocker}` | Builder → KRS-One | Yes | Builder hit a tooling/technical blocker before producing reviewable output |
| `IMPLEMENTATION_REJECTED: {issues}` | Builder → KRS-One | Yes | Builder exhausted 3 reject/fix cycles without an APPROVED verdict |
| `REVIEW_REQUEST` | Builder → Reviewer | Yes | Builder requests paired review |
| `APPROVED` / `REJECTED: {issues}` | Reviewer → Builder | Yes (response) | Reviewer verdict (paired with IMPLEMENTATION_APPROVED → krs-one on APPROVED) |
| `ITERATION_UPDATE: {summary}` | KRS-One → rakim + sentinel | Yes (60s timeout) | PMs update state files, reply READY |
| `MILESTONE_TRANSITION: completed={n}, next={n}` | KRS-One → rakim + sentinel + thoth | Yes (60s, thoth fire-and-forget) | PMs archive + reset |
| `MILESTONE_QA_READY: {milestone_name}` | KRS-One → engine | Yes (300s timeout) | Deliverables verified, requesting independent QA |
| `QA_REPORT_READY` | ken/ryu → engine | No | Individual QA report written; engine tracks per-sender |
| `RECONCILIATION_COMPLETE` | denzel → engine | No | Reconciliation written to .kiln/tmp/qa-reconciliation.md; engine spawns judge-dredd |
| `QA_PASS` | judge-dredd → KRS-One | Yes (response) | Final verdict: all criteria satisfied. Direct, no engine relay (Wave 2 centralisation) |
| `QA_FAIL: {findings}` | judge-dredd → KRS-One | Yes (response) | Final verdict: issues found. Direct, no engine relay (Wave 2 centralisation) |
| `MILESTONE_COMPLETE: {name}` | KRS-One → engine | No (terminal) | Milestone QA passed |
| `BUILD_COMPLETE` | KRS-One → engine | No (terminal) | All milestones done |

## Communication Model

```
--- Phase A (bootstrap, once per milestone) ---
Rakim    → team-lead      (READY_BOOTSTRAP: codebase state summary)
Sentinel → team-lead      (READY_BOOTSTRAP: patterns/pitfalls guidance)

--- Phase B (boss dispatches, persistent) ---
KRS-One  → team-lead      (CYCLE_WORKERS: scenario + reason — blocking, unblocks on first of: WORKERS_SPAWNED OR WORKER_READY)
Engine   → KRS-One        (WORKERS_SPAWNED: builder_name + reviewer_name — canonical ack)
Builder  → KRS-One        (WORKER_READY: ready for assignment — first-wake self-announce, belt-and-suspenders fallback)
Reviewer → KRS-One        (WORKER_READY: ready for assignment — first-wake self-announce, belt-and-suspenders fallback)
KRS-One  → Builder        (structured XML assignment with packaged context and reviewer name)

--- Phase C (worker execution, fresh per chunk) ---
Builder  → Reviewer       (REVIEW_REQUEST after implementing)
Reviewer → Builder        (APPROVED or REJECTED with issues)
Reviewer → KRS-One        (IMPLEMENTATION_APPROVED on APPROVED — Wave 3 reviewer-owned success handoff, paired with APPROVED to the builder)
Builder  → KRS-One        (IMPLEMENTATION_BLOCKED on tooling/technical blockers, IMPLEMENTATION_REJECTED after 3 failed review cycles)
Builder  → KRS-One        (silent stop on APPROVED — no signal, just commit)
Builder  → Rakim          (architecture questions — optional)
Builder  → Sentinel       (pattern/quality questions — optional)
Structural Builder → thoth  (ARCHIVE: prompt.md, codex-output.log, fix-{N}-*.md — fire-and-forget)
Structural Reviewer → thoth (ARCHIVE: review.md, fix-{N}-review.md — fire-and-forget)

--- Between chunks (persistent minds sync) ---
KRS-One  → Rakim          (ITERATION_UPDATE — blocking, 60s timeout, expects READY back)
KRS-One  → Sentinel       (ITERATION_UPDATE — blocking, 60s timeout, expects READY back)
KRS-One  → .kiln/tmp/     (writes chunk-${N}-summary, chunk-${N}-assignment, QA artifacts — thoth self-scans on wake)

--- Phase D (milestone QA — Judge Dredd Tribunal) ---
KRS-One      → team-lead    (MILESTONE_QA_READY: {milestone_name} — blocking 300s, waits for QA_PASS / QA_FAIL)
Engine       → ken          (spawn, background — team-red, Opus; runtime prompt includes random slot={a|b})
Engine       → ryu          (spawn, background — team-blue, GPT via Codex; runtime prompt includes the other slot)
ken          → .kiln/tmp/   (writes qa-report-{slot}.md directly — self-anonymised at spawn time, Wave 2)
ryu          → .kiln/tmp/   (writes qa-report-{other-slot}.md directly — self-anonymised at spawn time, Wave 2)
ken          → rakim        (QA context consultation — optional)
ken          → sentinel     (QA patterns consultation — optional)
ken          → team-lead    (QA_REPORT_READY — tribunal-internal, engine tracks per-sender)
ryu          → team-lead    (QA_REPORT_READY — tribunal-internal, engine tracks per-sender)
Engine       → denzel       (spawn, background — the-negotiator: reads qa-report-a.md + qa-report-b.md)
denzel       → team-lead    (RECONCILIATION_COMPLETE — tribunal-internal)
Engine       → judge-dredd  (spawn, background — i-am-the-law: final verdict)
judge-dredd  → thoth        (ARCHIVE: all 4 QA artifacts — fire-and-forget)
judge-dredd  → krs-one      (QA_PASS or QA_FAIL — DIRECT, no engine relay; Wave 2 centralisation)
Engine       → .            (shuts down ken, ryu, denzel, judge-dredd; does NOT emit QA_VERDICT anymore)

--- Milestone boundaries ---
KRS-One  → Rakim          (MILESTONE_TRANSITION — blocking)
KRS-One  → Sentinel       (MILESTONE_TRANSITION — blocking)
KRS-One  → team-lead      (MILESTONE_COMPLETE / BUILD_COMPLETE)
```

KRS-One packages context from rakim/sentinel into each builder's assignment so builders don't need multi-turn consultation for basic context. Direct consultation is for edge cases.

When `.kiln/design/` exists, KRS-One reads design artifacts and includes a `<design>` section in XML assignments. See bossman.md for details.

## Runtime Prompt Templates (Belt-and-Suspenders)

The engine MUST include these mandatory lines in the runtime prompt when spawning build-step workers. This is the second enforcement layer (Layer 1 = agent.md, Layer 2 = spawn prompt, Layer 3 = enforce-pipeline.sh hook).

Spawn names for Phase C workers come from the duo pool (selected by KRS-One). Use `{coder_name}` and `{reviewer_name}` from the CYCLE_WORKERS payload. Spawn names for Phase D QA agents are fixed (ken, ryu, denzel, judge-dredd).

**Codex-type builder (dial-a-coder):**
```
You are "{coder_name}" (dial-a-coder) on team "{team_name}". Your paired reviewer is "{reviewer_name}" (critical-thinker). Working dir: {working_dir}.
Step 5: Build. You are a Codex-type builder (GPT-5.4 delegation via Codex CLI).
MANDATORY: You are a thin Codex CLI wrapper. You write prompts to /tmp/ and invoke codex exec. You NEVER call Write or Edit on source files. The enforcement hook will block you if you try.
Await your structured XML assignment from krs-one. Codex CLI available (v{codex_version}).
```

**art-of-war (architecture planner):**
```
You are "sun-tzu" (art-of-war) on team "{team_name}". Working dir: {working_dir}.
Step 4: Architecture. You are a Codex-side planner — thin CLI wrapper.
MANDATORY: You construct prompts and invoke codex exec. You NEVER write plan content directly. The enforcement hook will block you if you try.
```

**Fallback builder (backup-coder):**
```
You are "{coder_name}" (backup-coder) on team "{team_name}". Your paired reviewer is "{reviewer_name}" (critical-thinker). Working dir: {working_dir}.
Step 5: Build. You are a Sonnet-type builder — direct implementation via Write/Edit.
```

**UI builder (la-peintresse):**
```
You are "{coder_name}" (la-peintresse) on team "{team_name}". Your paired reviewer is "{reviewer_name}" (the-curator). Working dir: {working_dir}.
Step 5: Build. You are a UI builder — direct Opus implementation of components, pages, layouts, motion.
```

**Structural reviewer (critical-thinker) and UI reviewer (the-curator):**
```
You are "{reviewer_name}" ({reviewer_type}) on team "{team_name}". Your paired builder is "{coder_name}" ({builder_type}). Working dir: {working_dir}.
Step 5: Build. You are a reviewer. Verdict: APPROVED or REJECTED.
```

UI-reviewer spawn (the-curator) additionally primes the design QA rubric path — belt-and-suspenders with the Instructions read in the-curator.md:
```
Read ${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/design/design-qa.md for the automated design-check list that feeds your Token Compliance axis. Design findings are advisory only — never cause a REJECTED verdict on their own.
```

**ken (QA analyst — team-red, Claude Opus):**
```
You are "ken" (team-red) on team "{team_name}". Step 5: Build — Milestone QA.
Milestone under review: {milestone_name}. Working dir: {working_dir}. Master plan: .kiln/master-plan.md.
Run your QA analysis. Write findings directly to .kiln/tmp/qa-report-${slot}.md (slot from runtime prompt, a or b — the other checker has the complementary slot; stay neutral in the report body). Consult rakim and sentinel as needed.
```

**ryu (QA analyst — team-blue, GPT-5.4 via Codex CLI):**
```
You are "ryu" (team-blue) on team "{team_name}". Step 5: Build — Milestone QA.
Milestone under review: {milestone_name}. Working dir: {working_dir}. Master plan: .kiln/master-plan.md.
Codebase state summary:
{rakim_tldr}
Patterns summary:
{sentinel_tldr}
Construct your QA prompt for GPT-5.4 and invoke codex exec. Write findings directly to .kiln/tmp/qa-report-${slot}.md (slot from runtime prompt, a or b — the other checker has the complementary slot; stay neutral in the report body).
```

**denzel (QA reconciler — the-negotiator):**
```
You are "denzel" (the-negotiator) on team "{team_name}". Step 5: Build — Milestone QA Reconciliation.
Milestone: {milestone_name}. Working dir: {working_dir}.
Two anonymized QA reports: .kiln/tmp/qa-report-a.md and .kiln/tmp/qa-report-b.md.
Read both reports, reconcile discrepancies, write reconciliation to .kiln/tmp/qa-reconciliation.md, signal RECONCILIATION_COMPLETE.
```

**judge-dredd (QA judge — i-am-the-law):**
```
You are "judge-dredd" (i-am-the-law) on team "{team_name}". Step 5: Build — Milestone QA Verdict.
Milestone: {milestone_name}. Working dir: {working_dir}.
Reconciliation report: .kiln/tmp/qa-reconciliation.md. Source reports: .kiln/tmp/qa-report-a.md, .kiln/tmp/qa-report-b.md.
Read the reconciliation and source reports. Issue final QA_PASS or QA_FAIL verdict with evidence.
```
