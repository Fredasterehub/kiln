---
name: kiln-v3-core
description: Core operating skill for Kiln v3 team orchestration in Claude Code. Use this whenever running Kiln v3 stages, enforcing persistent-mind file ownership, dynamic research sizing, JIT phase planning, and Stage 4<->5 correction loops.
---

# Kiln v3 Core Skill

Use this skill for all Kiln v3 operations.

## Required Inputs

- `PROJECT_PATH`
- `KILN_DIR=${PROJECT_PATH}/.kiln`
- `.kiln/config.json`
- `.kiln/STATE.md`

## Stage Routing

- `init`
- `mapping`
- `brainstorm`
- `research`
- `architecture`
- `implementation`
- `testing`
- `deployment`
- `presentation`

Never skip forward when a stage or gate is unresolved.

## Delegation Invariant

- Top-level session is a dispatcher, not an implementer.
- Stage work must be delegated to the stage coordinator agent.
- If a coordinator or worker fails, escalate or retry delegation; do not absorb execution into the top-level session.

## Resume-First Rule

- If `.kiln/STATE.md` exists and `status` is not `complete`, use `/kiln-v3:kiln-v3-resume`.
- Do not restart with `/kiln-v3:start` over an active run.
- If `start` is invoked with active state, route immediately to resume flow.

## Stage 5 Backfill Gate

- Never advance to next implementation phase without milestone testing for the current phase.
- If a phase is marked complete but there is no matching Stage 5 test result, resume must backfill Stage 5 first.

## Brainstorm Direct Mode

- Stage 1 must be direct operator <-> Da Vinci.
- Coordinator may not relay brainstorm content.
- Silence watcher defaults:
  - `brainstorm.silence_timeout_minutes = 20`
  - `brainstorm.max_nudges = 3`

## Persistent Mind Ownership

- Visionary: `VISION.md`, `vision-notes.md`, `vision-priorities.md`
- Architect: `architecture.md`, `tech-stack.md`, `decisions.md`, `arch-constraints.md`
- Sentinel: `PATTERNS.md`, `pitfalls.md`

Hard rule: only owners edit owned files.

## Research Sizing Rule

Compute from `VISION.md`:

- `score = feature(1-3) + integration(0-3) + risk(0-3) + unknowns(0-2)`
- `count = clamp(ceil(score / 2), 1, 5)`

Use `count` researchers in Stage 2.

## Architecture Rule

Visionary must read `vision-notes.md` when producing `vision-priorities.md`.

Stage 3 dual planning must run as parallel subagents:

- `kiln3-planner-claude` (Opus 4.6) writes `claude-plan.md`
- `kiln3-planner-codex` (Sonnet 4.6 wrapper) calls Codex CLI and writes `codex-plan.md`

Coordinator never drafts planner outputs.

## Checkpoint Rule

- Git checkpoints happen after Stage 4 implementation merges.
- Never checkpoint planning as implementation rollback boundaries.

## Testing Rule

- Tester generates `milestone-test-plan.md` directly from `phase-plan-NN.md` + codebase.
- On failure, loop to Stage 4 with `test-results.md` input.
- Max 3 loops before escalation.

## Native Team Features

- Use team-scoped task graph with dependency fields (`blockedBy`).
- Workers self-assign from shared task list.
- Prefer direct teammate mentions for feedback loops.
- Keep coordinator infrastructure-only.
- Never run nested `claude` CLI from within Claude Code sessions.
- In greenfield Stage 4, skip Sherlock indexing.
