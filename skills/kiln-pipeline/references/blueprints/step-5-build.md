# Blueprint: build

## Meta
- **Team name**: `{kill_streak_name}` — cycles through Kill Streak Sequence based on `build_iteration` in STATE.md
- **Artifact directory**: .kiln/
- **Expected output**: Source code (in project), updated living docs (.kiln/docs/codebase-state.md, patterns.md, pitfalls.md, decisions.md)
- **Inputs from previous steps**: .kiln/master-plan.md, .kiln/architecture-handoff.md, .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md, .kiln/docs/patterns.md, .kiln/docs/pitfalls.md
- **Workflow**: sequential (boss scopes → codex implements → sphinx checks → docs update → milestone detection)
- **Re-invoked per iteration** by the pipeline runner. Each invocation = ONE focused implementation chunk.

## Pipeline Runner Instructions

The pipeline runner invokes this blueprint repeatedly. Each invocation is one team with one kill streak name.

**Signals from KRS-One:**
- `ITERATION_COMPLETE` — more work needed within the current milestone. Invoke next team.
- `MILESTONE_COMPLETE: {milestone_name}` — milestone done, QA passed. Invoke next team for next milestone.
- `BUILD_COMPLETE` — all milestones done. Proceed to step 6 (Validate).

**Team name selection:** Read `build_iteration` from STATE.md. Look up the name in the Kill Streak Sequence (see `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md`).

## Agent Roster

| Name | Role | Type | Model |
|------|------|------|-------|
| krs-one | Boss. Reads master plan, bootstraps persistent minds, scopes the next chunk within the current milestone, hands Codex the assignment, updates docs, detects milestone completion, does deep QA at milestone boundaries. | (boss) | opus |
| codex | Implementer. Thin Codex CLI wrapper — receives scoped assignment from KRS-One, constructs prompt, pipes to GPT-5.4 via `codex exec`, verifies output, commits, requests review from Sphinx. | general | sonnet |
| sphinx | Quick verifier. Receives review requests from Codex, checks build/tests/obvious issues. APPROVED or REJECTED. Lightweight gate, not deep review. | general | sonnet |
| architect | Persistent mind. Technical authority. Bootstraps from her files. Answers KRS-One's state questions and Codex's technical questions. Updates codebase-state.md, architecture.md, decisions.md after each iteration. | general | opus |
| sentinel | Persistent mind. Quality guardian. Bootstraps from his files. Answers questions about patterns and pitfalls. Updates patterns.md, pitfalls.md after each iteration. | general | opus |

## Communication Model

```
KRS-One  → Architect     (bootstrap + "what's the current state?")
KRS-One  → Sentinel      (bootstrap + "what patterns/pitfalls apply?")
KRS-One  → Codex         (scoped assignment with packaged context)
Codex    → Sphinx         (REVIEW_REQUEST after implementing)
Sphinx   → Codex          (APPROVED or REJECTED with issues)
Codex    → KRS-One        (IMPLEMENTATION_COMPLETE or IMPLEMENTATION_BLOCKED)
Codex    → Architect      (technical questions when stuck — optional)
KRS-One  → Architect      (update docs after implementation)
KRS-One  → Sentinel       (update docs after implementation)
KRS-One  → team-lead      (ITERATION_COMPLETE / MILESTONE_COMPLETE / BUILD_COMPLETE)
```

KRS-One doesn't relay between Codex and Sphinx — they talk directly. KRS-One packages context from Architect/Sentinel into Codex's assignment so Codex doesn't need multi-turn consultation.
