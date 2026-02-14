# T04 Brainstorming Pipeline — Specification

## Acceptance Criteria

- AC-01 (LLM): Brainstormer agent (`agents/kiln-brainstormer.md`) facilitates BMAD-style divergent exploration with anti-clustering rotation across creative domains. Defines 3-phase flow: divergent exploration (50-100+ ideas), convergent structuring (themes, prioritization, non-goals), vision crystallization (draft VISION.md). Facilitation-first persona — asks probing questions, never generates ideas unilaterally.
- AC-02 (LLM): Brainstorm skill (`skills/kiln-brainstorm/kiln-brainstorm.md`) includes curated technique library with at least 5 named techniques (SCAMPER, First Principles, Reverse Brainstorming, Six Thinking Hats, Assumption Reversal) each with description, when to use, and example prompts. Includes anti-clustering protocol and "what else?" pressure techniques.
- AC-03 (LLM): Brainstormer agent includes vision challenge pass that correctly invokes GPT-5.2 via Codex CLI with proper flags and a challenge prompt. Challenge output goes to `.kiln/tracks/phase-N/vision_critique.md`. Synthesis step merges original + critique into final VISION.md.
- AC-04 (LLM): Claude-only fallback path is clearly defined: skips vision challenge pass, skips synthesis, single-perspective brainstorm produces VISION.md directly. Pipeline shape is preserved.
- AC-05 (DET): `/kiln:brainstorm` skill file exists at `skills/kiln-brainstorm/kiln-brainstorm.md` with correct YAML frontmatter (name, description, user_invocable: true).

## Constraints

- Brainstormer agent model: Opus 4.6 (needs deep reasoning for facilitation)
- Agent/skill files ~200-400 lines each
- YAML frontmatter required on all files
- Must reference kiln-core skill for coordination contracts
- VISION.md output must follow the section structure from templates/vision-sections.md
- Hard gate: operator must explicitly approve VISION.md before downstream stages can run

## Non-Goals

- Planning agents (Track T05)
- Roadmap generation (Track T08 — /kiln:roadmap skill)
- Execution pipeline (Track T06)
- Actual brainstorming content — this track creates the tools, not the output

## Dependencies

- T01 (directory skeleton — agents/, skills/kiln-brainstorm/)
- T02 (kiln-core contracts, templates/vision-sections.md)
- T03 (orchestrator — defines how brainstormer is spawned)
