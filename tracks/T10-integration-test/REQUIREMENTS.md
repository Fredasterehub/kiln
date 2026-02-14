# REQUIREMENTS — T10: Integration Test

## Upstream Dependencies

### ALL Tracks T01-T09 (REQUIRED)
- T01: package.json, directory skeleton, bin/install.js stub
- T02: kiln-core skill, templates (config.json.tmpl, STATE.md.tmpl, vision-sections.md)
- T03: kiln-orchestrator agent, kiln-init/kiln-status/kiln-quick skills
- T04: kiln-brainstormer agent, kiln-brainstorm skill
- T05: kiln-planner, kiln-codex-planner, kiln-synthesizer, kiln-validator agents, kiln-plan skill
- T06: kiln-sharpener, kiln-executor agents, kiln-execute skill
- T07: kiln-e2e-verifier, kiln-reviewer agents, kiln-e2e/kiln-verify/kiln-track skills
- T08: kiln-researcher agent, kiln-reconcile/kiln-roadmap skills
- T09: hooks.json, on-session-start.sh, on-task-completed.sh, full bin/install.js

## Invariants

- Integration test must be fully deterministic (no flaky tests)
- Test runs against a temp directory (no side effects on the repo)
- Package must have zero runtime dependencies
- All cross-references between agents and skills must resolve
