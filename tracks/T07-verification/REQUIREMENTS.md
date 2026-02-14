# REQUIREMENTS — T07: Verification + Review

## Upstream Dependencies

### T02: Core Foundation (REQUIRED)
- `skills/kiln-core/kiln-core.md` — coordination contracts, sentinel schemas, model routing table, error escalation protocol
- `templates/config.json.tmpl` — project config schema (tooling detection, preferences)
- `templates/STATE.md.tmpl` — progress tracking format

### T03: Init + Orchestrator (REQUIRED)
- `agents/kiln-orchestrator.md` — spawning contracts, stage transition rules (E2E verifier and reviewer are spawned by orchestrator)
- `skills/kiln-init/kiln-init.md` — tooling detection (config.json tooling field used by verification)

### T06: Execution Pipeline (REQUIRED)
- `skills/kiln-execute/kiln-execute.md` — mini-verify protocol (T07 E2E builds on mini-verify results)
- `agents/kiln-executor.md` — atomic commit format (reviewer reviews these commits)
- `agents/kiln-sharpener.md` — correction task format (reviewer generates correction tasks in same format)

### T04: Brainstorming Pipeline (SOFT)
- `agents/kiln-brainstormer.md` — VISION.md format (reviewer reads VISION.md for completeness checks)

### T05: Planning Pipeline (SOFT)
- `skills/kiln-plan/kiln-plan.md` — PLAN.md format, acceptance criteria format (reviewer checks against these)

## Invariants

- E2E tests are user journey tests, NOT unit tests
- Reviewer generates correction tasks with file:line specificity
- Max 3 E2E correction cycles, then halt
- Max 3 review correction cycles, then halt
- Corrections re-trigger E2E (prevents fixes from breaking runtime)
- All sentinel output follows kiln-core schemas
