---
name: kiln-tracker-reconcile
description: 'Reconcile stage tracker — single step, report, shut down'
---

## Overview
This skill executes exactly one pipeline step: `RECONCILE`. It is spawned by `kiln-fire` as a fresh teammate for each reconcile invocation. It reads `.kiln/STATE.md` from disk, runs phase reconciliation for the active phase, writes reconciliation artifacts, reports completion, and shuts down.

## Single-Step Dispatcher Contract

See `skills/kiln-core/kiln-core.md` § Tracker Contract. This skill follows that contract exactly.

## Stage Details

### Purpose
Bring living docs and phase state into sync with actually delivered behavior.

### Skill/Action To Run
- Run `/kiln:reconcile` via `.claude/skills/kiln-reconcile/kiln-reconcile.md`.

### Required Outputs
- Update `.kiln/docs/*` as needed for delivered behavior.
- Write `.kiln/tracks/phase-N/reconcile.md` with change log and unresolved doc debt.
- Emit proposed state transition to mark the phase complete.

### Operator Gate
- Present reconciliation changes for explicit operator confirmation.
- Do not finalize phase completion without operator confirmation.

### Exit Conditions
- `PASS`: operator confirms reconciliation outputs and there are no blocking documentation issues.
- `FAIL`: reconcile artifact missing/invalid, or operator declines pending edits.

### State Updates (Reported To `kiln-fire`)
- On pass: mark phase complete, clear `currentStep`, select next incomplete phase.
- If no phases remain: set `currentStep: final-integration-e2e`.
- Always append transition timestamps and operator confirmation note.

## References
- `skills/kiln-core/kiln-core.md` — Tracker Contract, Context Freshness Contract, state schema, model routing
