# Blueprint: build

## Meta
- **Team name**: `{kill_streak_name}` — cycles through Kill Streak Sequence based on `build_iteration` in STATE.md
- **Artifact directory**: .kiln/
- **Expected output**: Source code (in project), {target}/AGENTS.md, updated living docs (.kiln/docs/codebase-state.md, patterns.md, pitfalls.md, decisions.md)
- **Inputs from previous steps**: .kiln/master-plan.md, .kiln/architecture-handoff.md, .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md, .kiln/docs/patterns.md, .kiln/docs/pitfalls.md, .kiln/design/tokens.json (conditional — present only for UI projects with design direction), .kiln/design/tokens.css (conditional), .kiln/design/creative-direction.md (conditional)
- **Workflow**: three-phase (persistent minds bootstrap, boss scopes, workers implement)
- **Re-invoked per iteration** by the pipeline runner. Each invocation = ONE focused implementation chunk.

## Pipeline Runner Instructions

The pipeline runner invokes this blueprint repeatedly. Each invocation is one team with one kill streak name.

**Signals from KRS-One:**
- `ITERATION_COMPLETE` — more work needed within the current milestone. Invoke next team.
- `MILESTONE_COMPLETE: {milestone_name}` — milestone done, QA passed. Invoke next team for next milestone.
- `BUILD_COMPLETE` — all milestones done. Proceed to step 6 (Validate).

**Team name selection:** Read `build_iteration` from STATE.md. Look up the name in the Kill Streak Sequence.

## Agent Roster

| Name | Role | Phase | Model |
|------|------|-------|-------|
| rakim | Persistent mind. Codebase state authority. Writes codebase-state.md (TL;DR header) + AGENTS.md. Consultation for KRS-One and Codex. | A | opus |
| thoth | Persistent mind. Archivist — owns all writes to .kiln/archive/. Fire-and-forget. | A | haiku |
| sentinel | Persistent mind. Quality guardian. Owns patterns.md (TL;DR header) and pitfalls.md. Consultation for quality questions. | A | sonnet |
| krs-one | Boss. Reads plan, receives READY summaries, scopes chunks via structured XML assignments, dispatches to worker pairs, updates docs, milestone QA. | B (BACKGROUND) | opus |
| codex | Codex-type builder. Thin Codex CLI wrapper — delegates to GPT-5.4. | C | sonnet |
| sphinx | Structural reviewer. APPROVED or REJECTED. Lightweight gate. | C | sonnet |
| daft | Opus-type builder. Direct implementation via Write/Edit. Heavy reasoning. | C | opus |
| punk | Structural reviewer. APPROVED or REJECTED. | C | sonnet |
| kaneda | Sonnet-type builder. Direct implementation via Write/Edit. | C | sonnet |
| tetsuo | Structural reviewer. APPROVED or REJECTED. | C | sonnet |
| clair | UI builder. Direct Opus implementation of components, pages, layouts, motion. | C | opus |
| obscur | UI reviewer. Design quality review with 5-axis advisory scoring. | C | sonnet |

## Canonical Pairs

One pair per tier. krs-one picks dynamic duo names per iteration — the `name:` parameter is cosmetic, the `subagent_type:` maps to the canonical agent `.md` file.

| Tier | Builder Type | Reviewer Type | When |
|------|-------------|---------------|------|
| Codex | codex | sphinx | codex_available=true (default structural) |
| Sonnet | kaneda | tetsuo | codex_available=false (structural fallback) |
| Opus | daft | punk | Heavy reasoning, complex architectural work |
| UI | clair | obscur | Components, pages, layouts, motion, design system |

## Three-Phase Spawn

**Phase A**: rakim + sentinel + thoth bootstrap in parallel → rakim reads files + updates state → sentinel reads patterns → thoth ensures archive structure → all signal READY.

**Phase B**: krs-one spawns (BACKGROUND). Receives READY summaries from rakim and sentinel in runtime prompt. Reads master plan, scopes one focused chunk, requests one builder+reviewer pair from the appropriate tier.

**Phase C**: One builder+reviewer pair per REQUEST_WORKERS. krs-one selects a tier (Codex, Sonnet, Opus, or UI) and picks a tier-themed duo name from the matching pool. Example: `REQUEST_WORKERS: asterix (subagent_type: daft), obelix (subagent_type: punk)`. The engine injects identity into both agents' runtime prompts at spawn. Builders send REVIEW_REQUEST directly to their paired reviewer, reviewers reply directly to builders, and builders report IMPLEMENTATION_COMPLETE or IMPLEMENTATION_BLOCKED back to KRS-One.

Builders commit directly to the repo. The engine manages isolation.

## Communication Model

```
Rakim    → team-lead      (READY: codebase state summary)
Sentinel → team-lead      (READY: patterns/pitfalls guidance)
KRS-One  → team-lead      (REQUEST_WORKERS: one named builder+reviewer pair)
KRS-One  → Builder        (structured XML assignment with packaged context and reviewer name)
Builder  → Reviewer       (REVIEW_REQUEST after implementing)
Reviewer → Builder        (APPROVED or REJECTED with issues)
Builder  → KRS-One        (IMPLEMENTATION_COMPLETE or IMPLEMENTATION_BLOCKED)
Builder  → Rakim          (architecture questions — optional)
Builder  → Sentinel       (pattern/quality questions — optional)
KRS-One  → Rakim           (ITERATION_UPDATE / MILESTONE_DONE / QA_ISSUES)
KRS-One  → Sentinel        (ITERATION_UPDATE)
KRS-One  → team-lead       (ITERATION_COMPLETE / MILESTONE_COMPLETE / BUILD_COMPLETE)
KRS-One  → thoth           (ARCHIVE: bootstrap-context.md, assignment.xml, codebase-state-snapshot.md, qa-{milestone}.md — fire-and-forget)
Structural Builder → thoth  (ARCHIVE: prompt.md, codex-output.log, fix-{N}-*.md — fire-and-forget)
Structural Reviewer → thoth (ARCHIVE: review.md, fix-{N}-review.md — fire-and-forget)
```

KRS-One packages context from rakim/sentinel into each builder's assignment so builders don't need multi-turn consultation for basic context. Direct consultation is for edge cases.

When `.kiln/design/` exists, KRS-One reads design artifacts and includes a `<design>` section in XML assignments. See krs-one.md for details.
