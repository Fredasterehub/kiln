---
name: kiln-v3-resume
description: Resume an active Kiln v3 run from .kiln/STATE.md with strict coordinator delegation and stage-gate reconciliation.
---

# Kiln v3 Resume Skill

Use this when `.kiln/STATE.md` exists and the run is not complete.

## Goals

- Restore the run without stage skipping.
- Enforce delegation to stage coordinators.
- Prevent top-level session takeover of implementation work.

## Resume Procedure

1. Read:
- `.kiln/config.json`
- `.kiln/STATE.md`
- `.kiln/master-plan.md` (if present)
- latest phase/test artifacts (if present)

2. Reconcile before routing:
- If a phase is implemented but missing Stage 5 verification, route to `testing` first.
- If correction loop is open, route to Stage 4 correction flow.
- Keep unresolved gates unresolved.

3. Delegate by stage:
- `init` -> `kiln3-init-coordinator`
- `mapping` -> `kiln3-codebase-mapper`
- `brainstorm` -> `kiln3-brainstormer` (direct operator handoff)
- `research` -> `kiln3-research-coordinator`
- `architecture` -> `kiln3-architecture-coordinator`
- `implementation` -> `kiln3-implementation-coordinator`
- `testing` -> `kiln3-testing-coordinator`
- `deployment` -> `kiln3-deployment-coordinator`
- `presentation` -> `kiln3-presentation-coordinator`

4. Update `.kiln/STATE.md` after each transition.

## Hard Rules

- Never execute stage internals from the top-level session.
- Never continue to next phase if Stage 5 for current phase is missing.
- Never run nested `claude` CLI inside a Claude session.
