# Track: T04-brainstorming

## Title
Brainstorming Pipeline

## Goal
Build the brainstormer agent, brainstorm skill (technique library), and the /kiln:brainstorm slash command with dual-model vision crystallization flow.

## State
PLANNED

## Created
2026-02-14T07:11:00Z

## Tasks
- T04-T01: Write brainstormer agent (3-phase flow + challenge/synthesis)
- T04-T02: Write brainstorm technique skill (technique library + anti-clustering)
- T04-T03: Write /kiln:brainstorm entry point (appended to skill file)

## Acceptance Criteria
- AC-01 (LLM): BMAD-style divergent exploration with anti-clustering
- AC-02 (LLM): Curated technique library with 5+ named techniques
- AC-03 (LLM): Vision challenge pass via Codex CLI (GPT-5.2)
- AC-04 (LLM): Claude-only fallback skips challenge pass gracefully
- AC-05 (DET): /kiln:brainstorm skill exists with correct frontmatter

## Dependencies
- T01 (directory skeleton — agents/, skills/kiln-brainstorm/)
- T02 (kiln-core contracts, templates/vision-sections.md)
- T03 (orchestrator — defines how brainstormer is spawned)

## Blocks
- T05 (Planning Pipeline) — needs VISION.md format established
