# Track: T05-planning

## Title
Planning Pipeline

## Goal
Build the four planning agents (planner, codex-planner, synthesizer, validator) and the planning skill with task packet format and 7-dimension validation.

## State
PLANNED

## Created
2026-02-14T07:16:02Z

## Tasks
- T05-T01: Write kiln-plan skill (format spec, atomization, wave grouping, 7-dim validation)
- T05-T02: Write planner agent (Opus, architectural perspective)
- T05-T03: Write codex-planner agent (Sonnet shell → GPT-5.2)
- T05-T04: Write synthesizer agent (Opus, merges dual plans)
- T05-T05: Write validator agent (Sonnet, 7-dimension check)

## Acceptance Criteria
- AC-01 (LLM): Planner produces plans with task packets, wave grouping, AC
- AC-02 (LLM): Codex-planner wraps GPT-5.2 via Codex CLI correctly
- AC-03 (LLM): Synthesizer merges plans — picks best architecture, error handling, security
- AC-04 (LLM): Validator checks all 7 dimensions with PASS/FAIL sentinel
- AC-05 (LLM): Claude-only fallback produces single plan without synthesis

## Dependencies
- T01 (directory skeleton — agents/, skills/kiln-plan/)
- T02 (kiln-core contracts, sentinel format)
- T03 (orchestrator spawning rules)
- T04 (VISION.md format — planner reads this)

## Blocks
- T06 (Execution Pipeline) — needs task packet format
- T07 (Verification + Review) — needs plan structure
