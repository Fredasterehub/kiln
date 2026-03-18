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
| codex | Structural implementer template. Thin Codex CLI wrapper — receives structured assignment, constructs prompt, pipes to GPT-5.4, verifies, commits, requests paired structural review. | C | sonnet |
| sphinx | Structural reviewer template. APPROVED or REJECTED. Lightweight gate. | C | sonnet |
| picasso | UI implementer template. Direct Opus builder for components, pages, layouts, motion, and design system work. | C | opus |
| renoir | UI reviewer template. Design quality reviewer with 5-axis advisory scoring. | C | sonnet |

## Named Pairs

### Structural Pairs

| Pair | Builder | Reviewer | Builder Type | Reviewer Type |
|------|---------|----------|--------------|---------------|
| 1 | codex | sphinx | codex | sphinx |
| 2 | morty | rick | codex | sphinx |
| 3 | luke | obiwan | codex | sphinx |

### Claude-Type Structural Pairs (when codex_available=false)

| Pair | Builder | Reviewer | Builder Type | Reviewer Type |
|------|---------|----------|--------------|---------------|
| 1 | kaneda | sphinx | kaneda | sphinx |
| 2 | tetsuo | rick | tetsuo | sphinx |
| 3 | johnny | obiwan | johnny | sphinx |

### UI Pairs

| Pair | Builder | Reviewer | Builder Type | Reviewer Type |
|------|---------|----------|--------------|---------------|
| 1 | clair | obscur | picasso | renoir |
| 2 | yin | yang | picasso | renoir |
| 3 | recto | verso | picasso | renoir |

## Three-Phase Spawn

**Phase A**: rakim + sentinel + thoth bootstrap in parallel → rakim reads files + updates state → sentinel reads patterns → thoth ensures archive structure → all signal READY.

**Phase B**: krs-one spawns (BACKGROUND). Receives READY summaries from rakim and sentinel in runtime prompt. Reads master plan, scopes one chunk or up to 3 independent chunks, requests the needed worker pairs.

**Phase C**: 1-3 builder+reviewer pairs, any mix of structural (subagent_type: codex/sphinx), claude-type structural (subagent_type: kaneda/tetsuo/johnny + sphinx, when codex_available=false), and UI (subagent_type: picasso/renoir). Each builder receives a structured assignment with `reviewer: {paired reviewer name}`. Builders send REVIEW_REQUEST directly to their paired reviewer, reviewers reply directly to builders, and builders report IMPLEMENTATION_COMPLETE or IMPLEMENTATION_BLOCKED back to KRS-One. Sequential remains the default when work is dependent.

## Communication Model

```
Rakim    → team-lead      (READY: codebase state summary)
Sentinel → team-lead      (READY: patterns/pitfalls guidance)
KRS-One  → team-lead      (REQUEST_WORKERS: 1-3 named builder+reviewer pairs)
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
