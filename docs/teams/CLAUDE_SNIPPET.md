# Teams Workflow Contract (Paste Into Project `CLAUDE.md`)

## Mental Model

1. **Tasks are the scheduler**: if it is real work, it exists as a Claude Code Task with explicit dependencies.
2. **Tracks are durable memory**: plans/specs/packets live under `tracks/<track_id>/` and survive session resets.
3. **Deterministic verification is truth**: verification output beats LLM judgment.
4. **Conductor decides direction**: continue/adapt/replan/escalate at boundaries or when stuck.

## Canonical Track Layout

```text
tracks/<track_id>/
  index.md
  discovery.md                (optional, brownfield)
  VISION.md                   (brainstorm output)
  REQUIREMENTS.md             (brainstorm output)
  RISKS.md                    (brainstorm output)
  DECISIONS.md                (brainstorm output, ADR-ready)
  SPEC.md                     (plan output, acceptance criteria)
  PLAN.md                     (plan output, task graph)
  TASKS/
    <track_id>-T01.md          (task packets)
    <track_id>-T02.md
  VERDICTS/
    <track_id>-T01-qa.md
    <track_id>-T02-qa.md
```

## Runtime State (Never Commit)

```text
.teams/
  conductor/<track_id>.yaml
  reconcile/<track_id>.trigger
  reconcile/<track_id>.yaml
  session/<task_list_id>/STATE_SNAPSHOT.md
```

Add `.teams/` to `.gitignore`.

## Team Roles

Create an Agent Team named `teams` with these teammates:

1. `researcher` (fast retrieval, citations, doc lookups)
2. `discoverer` (one-shot brownfield discovery to `tracks/<track_id>/discovery.md`)
3. `brainstormer` (BMAD-style ideation, human-in-loop; writes `tracks/<track_id>/*`)
4. `claude-planner` (Claude-native plan + risk analysis)
5. `codex-planner` (Codex CLI/MCP plan alternative; writes structured output)
6. `plan-synthesizer` (merges both into `tracks/<track_id>/PLAN.md` + packets)
7. `coder` (implements one task packet only; small diffs)
8. `qa-reviewer` (deterministic verify first; then criteria checks; outputs verdict)
9. `conductor` (persistent drift/boundary/stuck arbitration; writes `.teams/conductor/*`)
10. `doc-keeper` (track-boundary doc reconciliation proposals only)
11. `integrator` (cross-task friction only; sutures, not surgery)

## Non-Negotiables

- Only `coder` and `integrator` edit source code.
- Every task packet lists allowed files; implementers only touch those files.
- Acceptance criteria are immutable once written; retries append context but never weaken criteria.
- If a task fails twice, Conductor decides: adapt bindings, replan the task, or replan the track.

## Lead Kickoff Prompt (Copy/Paste)

Create an AGENT TEAM named "teams" using the teammates defined in `.claude/agents/`.
Rules:
- I (Lead) operate in delegate mode and do not edit code.
- All real work happens as Claude Code Tasks with dependencies.
- Deterministic verification output is truth; LLM judgment is secondary.
Now spawn the teammates and wait.

