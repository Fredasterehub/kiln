---
name: kiln-tracker-e2e
description: 'E2e stage tracker — single step, report, shut down'
---

## Overview
This skill executes exactly one pipeline step: `E2E`. It is spawned by `kiln-fire` as a fresh teammate for each end-to-end invocation. It reads `.kiln/STATE.md` from disk, runs phase end-to-end verification for the active phase, writes E2E artifacts, reports completion, and shuts down.

## Single-Step Dispatcher Contract

See `skills/kiln-core/kiln-core.md` § Tracker Contract. This skill follows that contract exactly.

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
- `skills/kiln-core/kiln-core.md` — Tracker Contract, Context Freshness Contract, state schema, model routing
