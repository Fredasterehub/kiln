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
| thoth | Persistent mind. Archivist — owns all writes to .kiln/archive/. Fire-and-forget. | A | sonnet |
| sentinel | Persistent mind. Quality guardian. Owns patterns.md (TL;DR header) and pitfalls.md. Consultation for quality questions. | A | sonnet |
| krs-one | Boss. Reads plan, receives READY summaries, scopes chunks via structured XML assignments, dispatches to worker pairs, updates docs, milestone QA. | B (BACKGROUND) | opus |
| codex | Codex-type builder. Thin Codex CLI wrapper — delegates to GPT-5.4. | C (dynamic) | sonnet |
| sphinx | Structural reviewer (opus). Primary reviewer for Default and Fallback scenarios. APPROVED or REJECTED. | C (dynamic) | opus |
| kaneda | Sonnet-type builder. Direct implementation via Write/Edit. Fallback scenario. | C (dynamic) | sonnet |
| clair | UI builder. Direct Opus implementation of components, pages, layouts, motion. | C (dynamic) | opus |
| obscur | UI reviewer. Design quality review with 5-axis advisory scoring. | C (dynamic) | sonnet |

## Canonical Pairs

One pair per scenario. krs-one picks dynamic duo names per iteration — the `name:` parameter is cosmetic, the `subagent_type:` maps to the canonical agent `.md` file.

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

--- Milestone boundaries ---
KRS-One  → Rakim          (MILESTONE_TRANSITION — blocking)
KRS-One  → Sentinel       (MILESTONE_TRANSITION — blocking)
KRS-One  → team-lead      (MILESTONE_COMPLETE / BUILD_COMPLETE)
```

KRS-One packages context from rakim/sentinel into each builder's assignment so builders don't need multi-turn consultation for basic context. Direct consultation is for edge cases.

When `.kiln/design/` exists, KRS-One reads design artifacts and includes a `<design>` section in XML assignments. See krs-one.md for details.
