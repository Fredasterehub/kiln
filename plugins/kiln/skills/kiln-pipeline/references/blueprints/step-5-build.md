# Blueprint: build

## Meta
- **Team name**: `{kill_streak_name}` — cycles through Kill Streak Sequence based on `build_iteration` in STATE.md
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

**Team name selection:** Read `build_iteration` from STATE.md. Look up the name in the Kill Streak Sequence.

## Agent Roster

| Name | Role | Phase | Model |
|------|------|-------|-------|
| rakim | Persistent mind. Codebase state authority. Writes codebase-state.md (TL;DR header) + AGENTS.md. Consultation for KRS-One and Codex. | A | opus |
| thoth | Persistent mind. Archivist — owns all writes to .kiln/archive/. Fire-and-forget. Guide scratchpad. | A | opus |
| sentinel | Persistent mind. Quality guardian. Owns patterns.md (TL;DR header) and pitfalls.md. Consultation for quality questions. | A | sonnet |
| krs-one | Boss. Reads plan, receives READY summaries, scopes chunks, dispatches to worker pairs, delegates milestone QA via MILESTONE_QA_READY. | B (BACKGROUND) | opus |
| codex | Codex-type builder. Thin Codex CLI wrapper — delegates to GPT-5.4. | C (dynamic) | sonnet |
| sphinx | Structural reviewer (opus). Primary reviewer for Default and Fallback scenarios. APPROVED or REJECTED. | C (dynamic) | opus |
| kaneda | Sonnet-type builder. Direct implementation via Write/Edit. Fallback scenario. | C (dynamic) | sonnet |
| clair | UI builder. Direct Opus implementation of components, pages, layouts, motion. | C (dynamic) | opus |
| obscur | UI reviewer. Design quality review with 5-axis advisory scoring. | C (dynamic) | sonnet |
| maat | QA analyst (Claude Opus). Deep analysis — build, tests, acceptance criteria, integration. Severity-rated report. | D (dynamic) | opus |
| anubis | QA analyst (GPT-5.4 via Codex CLI). Independent second perspective. Thin CLI wrapper. | D (dynamic) | sonnet |
| osiris | QA synthesizer. Reads both reports, evidence-weighted arbitration, unified QA_PASS/QA_FAIL verdict. | D (dynamic) | opus |

## Canonical Pairs

One pair per scenario. Workers are spawned with their canonical type name — `name:` always matches `subagent_type:` (e.g., `name: "codex"`, `subagent_type: "kiln:codex"`). This ensures hook enforcement fires correctly.

| Scenario | Builder Type | Reviewer Type | When |
|----------|-------------|---------------|------|
| Default | codex | sphinx | codex_available=true (structural work) |
| Fallback | kaneda | sphinx | codex_available=false (structural fallback) |
| UI | clair | obscur | Components, pages, layouts, motion, design system |

## Three-Phase Spawn

**Phase A** (persistent — spawned once at milestone start): rakim + sentinel + thoth bootstrap in parallel → rakim reads files + updates state → sentinel reads patterns → thoth ensures archive structure → all signal READY. These agents persist for the entire milestone.

**Phase B** (persistent — spawned once at milestone start): krs-one spawns (BACKGROUND). Receives READY summaries from rakim and sentinel in runtime prompt. Reads master plan, scopes the first chunk, then sends `CYCLE_WORKERS` to team-lead to request a fresh worker pair.

**Phase C** (dynamic — spawned per chunk via CYCLE_WORKERS): KRS-One sends `CYCLE_WORKERS: scenario={scenario}, reason={reason}, chunk={summary}` to team-lead. The engine shuts down any existing workers (sends `shutdown_request`, 60s timeout), then spawns a fresh builder+reviewer pair for the requested scenario (3 scenarios: default=codex+sphinx, fallback=kaneda+sphinx, ui=clair+obscur). The engine sends `WORKERS_SPAWNED: {builder_name}, {reviewer_name}` back to KRS-One. KRS-One dispatches a structured XML assignment to the fresh builder. After builder completes (IMPLEMENTATION_COMPLETE), KRS-One sends blocking ITERATION_UPDATE to rakim and sentinel (60s timeout), waits for READY responses, then scopes the next chunk and issues another CYCLE_WORKERS — repeating until the milestone is complete.

Builders commit directly to the repo. The engine manages isolation.

**Phase D** (dynamic — spawned per milestone QA via MILESTONE_QA_READY): KRS-One sends `MILESTONE_QA_READY: {milestone_name}` to team-lead after verifying deliverable completeness. The engine spawns maat + anubis in parallel (background). Both run independent QA analysis and signal QA_REPORT_READY when done. The engine then spawns osiris, who reads both reports, performs evidence-weighted arbitration, and signals QA_PASS or QA_FAIL. The engine shuts down all three QA agents and relays the verdict to KRS-One as QA_VERDICT. On PASS, KRS-One proceeds to MILESTONE_COMPLETE. On FAIL, KRS-One re-scopes fixes.

## Signal Vocabulary

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| `READY: {summary}` | rakim/sentinel/thoth → engine | No | Bootstrap complete; PM available for consultation |
| `CYCLE_WORKERS: scenario={s}, reason={r}, chunk={c}` | KRS-One → engine | Yes | Engine shuts down old pair, spawns fresh builder+reviewer |
| `WORKERS_SPAWNED: {builder}, {reviewer}` | Engine → KRS-One | Yes (response) | Fresh pair on team, awaiting assignment |
| `CYCLE_REJECTED: {reason}` | Engine → KRS-One | Yes (response) | Invalid scenario — KRS-One must fix |
| `IMPLEMENTATION_COMPLETE: {summary}` | Builder → KRS-One | Yes | Builder done, reviewed and approved |
| `IMPLEMENTATION_BLOCKED: {blocker}` | Builder → KRS-One | Yes | Builder hit a blocker |
| `REVIEW_REQUEST` | Builder → Reviewer | Yes | Builder requests paired review |
| `APPROVED` / `REJECTED: {issues}` | Reviewer → Builder | Yes (response) | Reviewer verdict |
| `ITERATION_UPDATE: {summary}` | KRS-One → rakim + sentinel | Yes (60s timeout) | PMs update state files, reply READY |
| `MILESTONE_TRANSITION: completed={n}, next={n}` | KRS-One → rakim + sentinel + thoth | Yes (60s, thoth fire-and-forget) | PMs archive + reset |
| `MILESTONE_QA_READY: {milestone_name}` | KRS-One → engine | Yes (300s timeout) | Deliverables verified, requesting independent QA |
| `QA_REPORT_READY` | maat/anubis → engine | No | Individual QA report written; engine tracks per-sender |
| `QA_PASS` | osiris → engine | No | Synthesis verdict: all criteria satisfied |
| `QA_FAIL: {findings}` | osiris → engine | No | Synthesis verdict: issues found |
| `QA_VERDICT: {PASS/FAIL}` | engine → KRS-One | Yes (response) | Engine relays osiris's verdict |
| `MILESTONE_COMPLETE: {name}` | KRS-One → engine | No (terminal) | Milestone QA passed |
| `BUILD_COMPLETE` | KRS-One → engine | No (terminal) | All milestones done |

## Communication Model

```
--- Phase A (bootstrap, once per milestone) ---
Rakim    → team-lead      (READY: codebase state summary)
Sentinel → team-lead      (READY: patterns/pitfalls guidance)

--- Phase B (boss dispatches, persistent) ---
KRS-One  → team-lead      (CYCLE_WORKERS: scenario + reason — blocking)
Engine   → KRS-One        (WORKERS_SPAWNED: builder_name + reviewer_name — blocking)
KRS-One  → Builder        (structured XML assignment with packaged context and reviewer name)

--- Phase C (worker execution, fresh per chunk) ---
Builder  → Reviewer       (REVIEW_REQUEST after implementing)
Reviewer → Builder        (APPROVED or REJECTED with issues)
Builder  → KRS-One        (IMPLEMENTATION_COMPLETE or IMPLEMENTATION_BLOCKED)
Builder  → Rakim          (architecture questions — optional)
Builder  → Sentinel       (pattern/quality questions — optional)
Structural Builder → thoth  (ARCHIVE: prompt.md, codex-output.log, fix-{N}-*.md — fire-and-forget)
Structural Reviewer → thoth (ARCHIVE: review.md, fix-{N}-review.md — fire-and-forget)

--- Between chunks (persistent minds sync) ---
KRS-One  → Rakim          (ITERATION_UPDATE — blocking, 60s timeout, expects READY back)
KRS-One  → Sentinel       (ITERATION_UPDATE — blocking, 60s timeout, expects READY back)
KRS-One  → .kiln/tmp/     (writes iter-summary, assignment, QA artifacts — thoth self-scans on wake)

--- Phase D (milestone QA — Egyptian Judgment Tribunal) ---
KRS-One  → team-lead      (MILESTONE_QA_READY: {milestone_name} — blocking 300s)
Engine   → maat           (spawn, background — deep Claude analysis)
Engine   → anubis         (spawn, background — GPT-5.4 analysis via Codex CLI)
maat     → rakim          (QA context consultation — optional)
maat     → sentinel       (QA patterns consultation — optional)
maat     → team-lead      (QA_REPORT_READY)
anubis   → team-lead      (QA_REPORT_READY)
Engine   → osiris         (spawn, background — after both reports ready)
osiris   → thoth          (ARCHIVE: all 3 QA reports — fire-and-forget)
osiris   → team-lead      (QA_PASS or QA_FAIL)
Engine   → KRS-One        (QA_VERDICT: {PASS/FAIL} + findings)

--- Milestone boundaries ---
KRS-One  → Rakim          (MILESTONE_TRANSITION — blocking)
KRS-One  → Sentinel       (MILESTONE_TRANSITION — blocking)
KRS-One  → team-lead      (MILESTONE_COMPLETE / BUILD_COMPLETE)
```

KRS-One packages context from rakim/sentinel into each builder's assignment so builders don't need multi-turn consultation for basic context. Direct consultation is for edge cases.

When `.kiln/design/` exists, KRS-One reads design artifacts and includes a `<design>` section in XML assignments. See krs-one.md for details.

## Runtime Prompt Templates (Belt-and-Suspenders)

The engine MUST include these mandatory lines in the runtime prompt when spawning build-step workers. This is the second enforcement layer (Layer 1 = agent.md, Layer 2 = spawn prompt, Layer 3 = enforce-pipeline.sh hook).

**Codex-type builder (codex):**
```
You are "codex" on team "{team_name}". Your paired reviewer is "sphinx". Working dir: {working_dir}.
Step 5: Build. You are a Codex-type builder (GPT-5.4 delegation via Codex CLI).
MANDATORY: You are a thin Codex CLI wrapper. You write prompts to /tmp/ and invoke codex exec. You NEVER call Write or Edit on source files. The enforcement hook will block you if you try.
Await your structured XML assignment from krs-one. Codex CLI available (v{codex_version}).
```

**Sun-tzu (architecture planner):**
```
You are "sun-tzu" on team "{team_name}". Working dir: {working_dir}.
Step 4: Architecture. You are a Codex-side planner — thin CLI wrapper.
MANDATORY: You construct prompts and invoke codex exec. You NEVER write plan content directly. The enforcement hook will block you if you try.
```

**Kaneda (fallback builder):**
```
You are "kaneda" on team "{team_name}". Your paired reviewer is "sphinx". Working dir: {working_dir}.
Step 5: Build. You are a Sonnet-type builder — direct implementation via Write/Edit.
```

**Clair (UI builder):**
```
You are "clair" on team "{team_name}". Your paired reviewer is "obscur". Working dir: {working_dir}.
Step 5: Build. You are a UI builder — direct Opus implementation of components, pages, layouts, motion.
```

**Reviewers (sphinx, obscur):**
```
You are "{reviewer_type}" on team "{team_name}". Your paired builder is "{builder_type}". Working dir: {working_dir}.
Step 5: Build. You are a structural reviewer. Verdict: APPROVED or REJECTED.
```

**Maat (QA analyst — Claude Opus):**
```
You are "maat" on team "{team_name}". Step 5: Build — Milestone QA.
Milestone under review: {milestone_name}. Working dir: {working_dir}. Master plan: .kiln/master-plan.md.
Run your QA analysis. Consult rakim and sentinel as needed.
```

**Anubis (QA analyst — GPT-5.4 via Codex CLI):**
```
You are "anubis" on team "{team_name}". Step 5: Build — Milestone QA.
Milestone under review: {milestone_name}. Working dir: {working_dir}. Master plan: .kiln/master-plan.md.
Codebase state summary:
{rakim_tldr}
Patterns summary:
{sentinel_tldr}
Construct your QA prompt for GPT-5.4 and invoke codex exec.
```

**Osiris (QA synthesizer):**
```
You are "osiris" on team "{team_name}". Step 5: Build — Milestone QA Synthesis.
Milestone: {milestone_name}. Working dir: {working_dir}.
Two QA reports are ready: .kiln/tmp/qa-maat-report.md and .kiln/tmp/qa-anubis-report.md.
Read both reports, synthesize, and signal QA_PASS or QA_FAIL.
```
