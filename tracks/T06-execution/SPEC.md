# T06 Execution Pipeline — Specification

## Acceptance Criteria

- AC-01 (LLM): Sharpener agent (`agents/kiln-sharpener.md`) reads task packet + current codebase (real file paths, function signatures, imports) and produces a Codex-optimized implementation prompt. Includes sub-division logic for oversized tasks.
- AC-02 (LLM): Sharpener follows Codex Prompting Guide principles: autonomy (let model decide approach), bias to action (do it, don't ask), batch operations (group related changes), specificity (exact paths and signatures), context (reference what exists), acceptance criteria (testable success conditions).
- AC-03 (LLM): Executor agent (`agents/kiln-executor.md`) correctly invokes GPT-5.3-codex via Codex CLI with flags: `-m gpt-5.3-codex`, `--full-auto`, `-c 'model_reasoning_effort="high"'`. Makes atomic git commit on completion.
- AC-04 (LLM): Mini-verify logic (in `skills/kiln-execute/kiln-execute.md`) runs project test suite from config.json tooling detection + prior E2E regression tests after each task. Max 2 retries with error context, then halt.
- AC-05 (LLM): Claude-only fallback: Opus sharpens for Sonnet (instead of GPT-5.2 for Codex), Sonnet implements directly (instead of GPT-5.3-codex via Codex CLI). Same quality gates apply.

## Constraints

- Sharpener: Sonnet model (shell agent invoking GPT-5.2 via Codex CLI)
- Executor: Sonnet model (shell agent invoking GPT-5.3-codex via Codex CLI)
- All agents must reference kiln-core and kiln-execute skill
- Zero external dependencies in any shell scripts
- Sharpened prompts must reference REAL file paths from codebase exploration, not hypothetical ones

## Non-Goals

- E2E test generation (Track T07)
- Code review (Track T07)
- Reconciliation (Track T08)
- Plan generation (Track T05)

## Dependencies

- T01 (directory skeleton — agents/, skills/kiln-execute/)
- T02 (kiln-core contracts, sentinel format)
- T05 (kiln-plan skill — task packet format that sharpener reads)
