---
name: kiln-tracker-execute
description: 'Execute stage tracker — single step, report, shut down'
---

## Overview
This skill executes exactly one pipeline step: `EXECUTE`. It is spawned by `kiln-fire` as a fresh teammate for each execution invocation. It reads `.kiln/STATE.md` from disk, runs phase task implementation for the active phase, writes execution artifacts, reports completion, and shuts down.

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
Implement all phase task packets safely and deterministically.

### Input Contract
- Read task packets from `.kiln/tracks/phase-N/PLAN.md`.
- Respect wave ordering and declared dependencies.

### Non-Teams Execution Protocol
1. Parse wave assignments and task IDs from `PLAN.md`.
2. Process waves sequentially (`wave-1`, `wave-2`, ...).
3. Within each wave, run tasks in parallel only when dependency-safe.
4. Per task:
   - Spawn `kiln-sharpener` for the implementation packet.
   - Spawn `kiln-executor` to implement changes.
   - Run mini-verify (`/kiln:verify`) for task ACs.
5. Persist task-level results and evidence paths for state ingestion.

### Teams Mode Selector (`preferences.useTeams`)
- `false` or absent: use non-Teams protocol above.
- `true`: use Teams wave scheduler contract below.

### Teams Wave Scheduler (EXECUTE)
When `preferences.useTeams: true`:
1. Parse waves from `.kiln/tracks/phase-N/PLAN.md`.
2. Create one wave team per wave in order.
3. Spawn one `kiln-wave-worker` per task packet in the active wave.
4. Worker worktree path is `${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/<task-id>/` with read-only `.kiln-snapshot/` control-plane copy.
5. Worker flow is `sharpen -> execute -> mini-verify -> TaskUpdate`.
6. Workers do not commit in worktrees.
7. Orchestrator performs copy-back to main and creates atomic task commits.

For authoritative wave scheduling protocol, see `skills/kiln-wave-schedule/kiln-wave-schedule.md`.
This tracker triggers that protocol for wave queue construction, parallelism enforcement, worker spawn template, integration checkpoint gating, and failure handling.

### Cancellation Protocol (Fail-Fast)
- Any worker failure triggers shutdown requests to in-flight peers in the same wave.
- Preserve failed worktree for forensics.
- Record failure evidence paths before rerun/halt decision.

### Retry Budget
- Maximum mini-verify retries: 2 per task.
- On retryable failure, rerun `sharpen -> execute -> mini-verify` for that task only.
- If a task reaches retry limit, mark phase step as failed and `HALT`.

### Concurrency Rules
- Waves are strictly sequential.
- Tasks inside a wave may run in parallel only if they do not share file targets and have no dependency edge.

### Exit Conditions
- `PASS`: all tasks in all waves satisfy mini-verify.
- `FAIL`: any task exceeds mini-verify retry budget.

### State Updates (Reported To `kiln-fire`)
- Per-task status enum: `queued`, `in_progress`, `done`, `blocked`, `halted`.
- Increment `correctionCycles.miniVerify` on each task retry.
- Record transition timestamps for task completion/failure.

## References
- `skills/kiln-core/kiln-core.md` — shared contracts, state schema, model routing, Context Freshness Contract
- `skills/kiln-wave-schedule/kiln-wave-schedule.md` — authoritative Teams wave scheduling and worker orchestration protocol
