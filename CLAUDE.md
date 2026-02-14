# Kiln — Build Configuration

## Project Overview

Kiln is a multi-model orchestration workflow for Claude Code, distributed as an NPM package (`kiln-dev`).
We are building kiln using the avatarme v2 workflow with Agent Teams.

## Separation of Concerns

- `.claude/agents/` — avatarme v2 build-process agents. DO NOT modify these as part of kiln product work.
- `agents/` — kiln PRODUCT agents (the NPM package source). This is what we are building.
- `skills/` — kiln PRODUCT skills (the NPM package source).
- `hooks/` — kiln PRODUCT hooks (the NPM package source).
- `bin/` — kiln PRODUCT installer.
- `templates/` — contains both `teams/` (build workflow templates) and kiln product templates at root level.

## Reference Documents

- **Design spec:** `docs/plans/2026-02-14-kiln-architecture-design.md` — the approved architecture
- **Implementation plan:** `docs/plans/2026-02-14-kiln-implementation-plan.md` — track-level plan with 10 tracks
- **Handoff:** `docs/plans/HANDOFF.md` — session context and decisions summary

## What We're Building

Kiln is an NPM package. End users install it with `npx kiln-dev`.
The package source lives at the repo root: `agents/`, `skills/`, `hooks/`, `bin/`, `templates/`.
The `.claude/` directory is OUR build tooling, not the product.

## Verification Rules

- Agent/skill markdown: must have required sections, validate any YAML frontmatter
- Hook scripts: `shellcheck` must pass
- Installer (`bin/install.js`): must work against a temp directory, verify file placement
- Integration: install into a sample project, invoke /kiln:init, verify .kiln/ creation
- Cross-references: every agent that references a skill must point to an existing skill

## Code Style

- Zero runtime dependencies for the NPM package (Node.js built-ins only)
- Shell scripts must pass shellcheck
- Markdown agents/skills should be thorough but not bloated (~200-400 lines each)
- All file paths in agents/skills must be relative (no hardcoded absolute paths)

---

# Teams Workflow Contract

## Mental Model

1. **Tasks are the scheduler**: if it is real work, it exists as a Claude Code Task with explicit dependencies.
2. **Tracks are durable memory**: plans/specs/packets live under `tracks/<track_id>/` and survive session resets.
3. **Deterministic verification is truth**: verification output beats LLM judgment.
4. **Conductor decides direction**: continue/adapt/replan/escalate at boundaries or when stuck.

## Canonical Track Layout

```text
tracks/<track_id>/
  index.md
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

## Team Roles

1. `researcher` (fast retrieval, citations, doc lookups)
2. `discoverer` (one-shot brownfield discovery)
3. `brainstormer` (BMAD-style ideation, human-in-loop)
4. `claude-planner` (Claude-native plan + risk analysis)
5. `codex-planner` (Codex CLI/MCP plan alternative)
6. `plan-synthesizer` (merges both into PLAN.md + packets)
7. `coder` (implements one task packet only; small diffs)
8. `qa-reviewer` (deterministic verify first; then criteria checks)
9. `conductor` (persistent drift/boundary/stuck arbitration)
10. `doc-keeper` (track-boundary doc reconciliation proposals only)
11. `integrator` (cross-task friction only; sutures, not surgery)

## Non-Negotiables

- Only `coder` and `integrator` edit source code.
- Every task packet lists allowed files; implementers only touch those files.
- Acceptance criteria are immutable once written; retries append context but never weaken criteria.
- If a task fails twice, Conductor decides: adapt bindings, replan the task, or replan the track.
