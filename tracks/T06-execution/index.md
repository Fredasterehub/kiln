# Track: T06-execution

## Title
Execution Pipeline

## Goal
Build the sharpener and executor agents, plus the execution skill with sharpening protocol, Codex Prompting Guide principles, mini-verify logic, retry protocol, and wave execution rules.

## State
PLANNED

## Created
2026-02-14T07:22:42Z

## Tasks
- T06-T01: Write kiln-execute skill (sharpening protocol, Codex Prompting Guide, mini-verify, wave execution, Claude-only fallback)
- T06-T02: Write sharpener agent (Sonnet shell → GPT-5.2 via Codex CLI, prompt construction, sub-division, codebase exploration)
- T06-T03: Write executor agent (Sonnet shell → GPT-5.3-codex via Codex CLI, post-execution verification, atomic commit, mini-verify)

## Acceptance Criteria
- AC-01 (LLM): Sharpener reads task packet + codebase, produces Codex-optimized prompt
- AC-02 (LLM): Sharpener follows 6 Codex Prompting Guide principles
- AC-03 (LLM): Executor invokes GPT-5.3-codex via Codex CLI with correct flags
- AC-04 (LLM): Mini-verify runs test suite + E2E regression after each task
- AC-05 (LLM): Claude-only fallback: Opus sharpens for Sonnet, Sonnet implements

## Dependencies
- T01 (directory skeleton — agents/, skills/kiln-execute/)
- T02 (kiln-core contracts, sentinel format)
- T05 (kiln-plan skill — task packet format that sharpener reads)

## Blocks
- T07 (Verification + Review) — needs execution pipeline for E2E and review corrections
