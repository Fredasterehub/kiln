---
name: kiln-tracker-reconcile
description: 'Reconcile stage tracker — single step, report, shut down'
---

## Overview
This skill executes exactly one pipeline step: `RECONCILE`. It is spawned by `kiln-fire` as a fresh teammate for each reconcile invocation. It reads `.kiln/STATE.md` from disk, runs phase reconciliation for the active phase, writes reconciliation artifacts, reports completion, and shuts down.

## Single-Step Dispatcher Contract

When spawned by `kiln-fire`, this skill executes exactly ONE step:

1. Read `.kiln/STATE.md` from disk to determine the active phase and step.
2. Execute exactly that step (see Stage Details below).
3. Write artifacts to `.kiln/tracks/phase-N/`.
4. SendMessage `{ stage: "track:<phase>:<step>", status: "completed", evidence_paths: [...] }` to team lead.
5. Shut down.

Hard rules:
- **Do not write or edit `.kiln/STATE.md`.** Only `kiln-fire` writes STATE.md.
- **Do not advance `currentStep` or `currentPhase`.** That is `kiln-fire`'s responsibility.
- **Do not loop to the next step.** Execute one step, report, shut down.

Context Freshness: This skill follows the four-step ephemeral invariant defined in
`skills/kiln-core/kiln-core.md` § Context Freshness Contract:
spawn fresh → read from disk → do one job → write to disk → die.

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
- `skills/kiln-core/kiln-core.md` — shared contracts, state schema, model routing, Context Freshness Contract
