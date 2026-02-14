# T03 Init + Orchestrator — Specification

## Acceptance Criteria

- AC-01 (LLM): Orchestrator agent (`agents/kiln-orchestrator.md`) correctly defines its role as traffic cop — routes to correct stage, spawns subagents, never implements. Covers all stage transitions: init -> brainstorm -> roadmap -> track loop (plan -> validate -> execute -> e2e -> review -> reconcile) -> final integration E2E.
- AC-02 (LLM): `/kiln:init` skill (`skills/kiln-init/kiln-init.md`) handles greenfield, brownfield, and returning project detection. Includes correct tooling discovery commands for test runner, linter, type checker, build system, start command. Includes Codex CLI detection. Creates `.kiln/` directory structure from templates.
- AC-03 (LLM): `/kiln:status` skill (`skills/kiln-status/kiln-status.md`) reads STATE.md and ROADMAP.md, displays phase progress with statuses, shows correction cycle counts and regression suite size, routes to next action with specific command suggestion.
- AC-04 (LLM): `/kiln:quick` skill (`skills/kiln-quick/kiln-quick.md`) defines single-pass lightweight mode that skips brainstorm/roadmap/dual-planning but retains sharpening, implementation, verification, and regression. Includes concrete heuristics for "too big for quick mode".

## Constraints

- Each agent/skill file must have YAML frontmatter with `name` and `description` fields
- All agents/skills must reference `kiln-core` skill for contracts
- Orchestrator must stay under ~15% context budget — delegate everything
- `/kiln:init` must ask zero questions about workflow preferences — detect only, confirm detected config
- Zero external dependencies — all detection uses shell commands available on standard systems

## Non-Goals

- Brainstormer agent or brainstorm skill (Track T04)
- Planning agents (Track T05)
- Execution agents (Track T06)
- Verification/review agents (Track T07)
- Reconcile skill (Track T08)
- /kiln:track skill implementation (Track T07 — the track loop logic)

## Dependencies

- T01: Directory skeleton (agents/, skills/kiln-init/, etc.)
- T02: kiln-core skill (contracts, model routing table, output formats)
