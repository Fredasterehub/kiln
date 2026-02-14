# Track: T03-init-orchestrator

## Title
Init + Orchestrator

## Goal
Build the orchestrator agent (thin traffic cop) and the slash command skills for /kiln:init, /kiln:status, and /kiln:quick.

## State
PLANNED

## Created
2026-02-14T07:04:52Z

## Tasks
- T03-T01: Write orchestrator agent (kiln-orchestrator.md)
- T03-T02: Write /kiln:init skill (kiln-init.md)
- T03-T03: Write /kiln:status skill (kiln-status.md)
- T03-T04: Write /kiln:quick skill (kiln-quick.md)

## Acceptance Criteria
- AC-01 (LLM): Orchestrator defines traffic cop role, all stage transitions, subagent spawning
- AC-02 (LLM): /kiln:init handles greenfield/brownfield/returning detection with tooling discovery
- AC-03 (LLM): /kiln:status displays progress with next-action routing
- AC-04 (LLM): /kiln:quick defines single-pass mode with scope heuristics

## Dependencies
- T01 (Project Scaffolding) — directory skeleton
- T02 (Core Foundation) — kiln-core contracts, templates

## Blocks
- T04 (Brainstorming Pipeline) — needs orchestrator stage definitions
- T05 (Planning Pipeline) — needs orchestrator spawning rules
- T09 (Hooks + Installer) — needs init skill for integration testing
