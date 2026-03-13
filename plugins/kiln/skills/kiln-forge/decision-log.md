# Kiln Forge — Decision Log

Iteration history for the kiln-forge skill itself.

## 2026-03-12: Initial Creation

**Decision**: Build kiln-forge as a skill within the existing plugin, not a separate tool.

**Rationale**: Skills are the natural extension point for Claude Code plugins. kiln-forge needs deep access to plugin internals (agent files, hooks, data). A separate tool would need its own discovery mechanism. A skill auto-triggers when the user talks about plugin development.

**Structure**: Router SKILL.md + 6 workflow files + 4 reference files + 3 data files + 3 scenario directories + 1 TUI blueprint + evals + health checks.

**Key decisions**:
1. Workflows are separate files, not inline in SKILL.md — keeps the router lean, each workflow self-contained.
2. plugin-architecture.md is the brain — every cross-reference in one place. Workflows consult it, not individual files.
3. Scenarios skip Steps 1-2 (interactive) — pre-seeded artifacts allow automated testing from Step 3+.
4. Three scenarios (S1/S5/S6) cover the critical paths. S5 (build cycle) is the primary target — most complexity, most common failure mode.
5. Data files (evolution-log, run-history, plugin-state) are JSON for machine readability. Decision-log and findings are markdown for human readability.
6. TUI blueprint is a self-contained spec for the Kiln pipeline to build from (ST12 dogfooding).
