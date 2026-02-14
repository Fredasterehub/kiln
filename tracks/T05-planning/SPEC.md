# T05 Planning Pipeline — Specification

## Acceptance Criteria

- AC-01 (LLM): Planner agent (`agents/kiln-planner.md`) produces architectural plans with task packets containing: goal, acceptance criteria, file hints, dependencies, estimated scope. Includes wave grouping for parallel execution. Reads VISION.md, ROADMAP.md, living docs, and current codebase.
- AC-02 (LLM): Codex-planner agent (`agents/kiln-codex-planner.md`) correctly wraps GPT-5.2 via Codex CLI with proper flags and prompt construction. Outputs plan_codex.md in the same format as plan_claude.md. Provides pragmatic/conventional perspective complementing Opus's thoroughness.
- AC-03 (LLM): Synthesizer agent (`agents/kiln-synthesizer.md`) merges dual plans by comparing task-by-task, picking cleaner architecture, more thorough error handling, and more secure approaches. Outputs PLAN.md with final task packets and wave assignments.
- AC-04 (LLM): Validator agent (`agents/kiln-validator.md`) checks all 7 dimensions: requirement coverage, task completeness, dependency correctness, scope sanity, context budget, verification derivation, living doc compliance. Outputs a sentinel block with PASS/FAIL and specific feedback per dimension.
- AC-05 (LLM): Claude-only fallback: single Opus plan goes directly to validation (no codex-planner, no synthesis step). Plan format is identical.

## Constraints

- Planner: Opus 4.6 model
- Codex-planner: Sonnet shell invoking GPT-5.2 via Codex CLI
- Synthesizer: Opus 4.6 model
- Validator: Sonnet model
- All agents must reference kiln-core for contracts
- Task packet format must be consistent across all 3 plan-producing agents
- All agents ~200-350 lines; skill ~200-300 lines

## Non-Goals

- Execution agents (Track T06)
- E2E verification (Track T07)
- Code review (Track T07)
- Reconciliation (Track T08)

## Dependencies

- T01 (directory skeleton — agents/, skills/kiln-plan/)
- T02 (kiln-core contracts, sentinel schema format)
- T03 (orchestrator spawning rules)
- T04 (VISION.md format — planner reads this)
