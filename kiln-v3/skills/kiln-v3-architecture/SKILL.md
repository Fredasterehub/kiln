---
name: kiln-v3-architecture
description: Run Stage 3 architecture and roadmap with dual planners, synthesis, and learning-based validation retries.
---

# Kiln v3 Architecture Skill

Run architecture/roadmap.

- Visionary reads `vision-notes.md` to produce priorities.
- Architect produces constraints.
- Spawn two planner subagents in parallel:
  - Opus 4.6 planner -> `claude-plan.md`
  - Sonnet 4.6 wrapper planner -> Codex CLI -> `codex-plan.md`
- Treat these planners as real teammates in the same team session, not internal modes.
- Coordinator never writes plan files directly.
- Then run synthesis, validation, and learning retries.
