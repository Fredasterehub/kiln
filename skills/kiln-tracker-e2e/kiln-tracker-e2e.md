---
name: kiln-tracker-e2e
description: 'E2e stage tracker — single step, report, shut down'
---

## Overview
This skill executes exactly one pipeline step: `E2E`. It is spawned by `kiln-fire` as a fresh teammate for each end-to-end invocation. It reads `.kiln/STATE.md` from disk, runs phase end-to-end verification for the active phase, writes E2E artifacts, reports completion, and shuts down.

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
Validate full phase behavior end-to-end and ensure prior behavior does not regress.

### Subagent To Spawn
- Spawn `kiln-e2e-verifier` after execute pass for the active phase.

### Required Test Scope
- New user-journey coverage introduced by the active phase.
- Cumulative regression checks relevant to previously completed phases.

### Correction Loop
- On E2E fail, consume correction packets from `.kiln/tracks/phase-N/e2e-results.md`.
- Route correction packets through execution flow: `sharpen -> execute -> mini-verify`.
- Re-run E2E after the correction batch.
- Maximum E2E correction cycles per phase: 3.

### Exit Conditions
- `PASS`: E2E sentinel reports pass and there are no blocking failures.
- `FAIL`: third correction cycle still failing, then `HALT`.

### State Updates (Reported To `kiln-fire`)
- Increment `correctionCycles.e2e` for each failed E2E cycle.
- Persist E2E artifact path in phase metadata.
- Timestamp each E2E cycle boundary.

## References
- `skills/kiln-core/kiln-core.md` — shared contracts, state schema, model routing, Context Freshness Contract
