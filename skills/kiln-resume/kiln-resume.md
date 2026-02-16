---
name: kiln-resume
description: Crash recovery and resume protocol — input reconciliation, task classification, worktree reuse, and retry policy for Teams execution
---

## Purpose

This skill defines the deterministic crash recovery protocol for Teams wave execution.
It is used by `kiln-orchestrator` after restart or compaction to reconstruct control-plane truth and resume safely.
The protocol enforces single-writer discipline (`.kiln/STATE.md` is orchestrator-owned) and idempotent recovery behavior.

## Resume Inputs

Resume reconciles four sources that can disagree after a crash:

1. `git worktree list --porcelain`:
Canonical Git view of active worktrees (`path`, `branch`, `head`, lock/prunable markers).
2. Filesystem scan under `${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/`:
Discovers orphaned, partial, or stale wave/task directories and artifacts.
3. `.kiln/STATE.md`:
Orchestrator canonical state for current phase, wave progression, blockers, and retry bookkeeping.
4. Teams `TaskList`:
Control-plane task status and task metadata, including terminal and in-flight task signals.

These inputs may be inconsistent after interruption. The resume algorithm below deterministically reconciles them.

## Task Classification

Each task must be classified as exactly one state:

1. **`done`**:
Terminal successful update exists, copy-back is integrated, and the result is committed to main.
2. **`ready_for_integration`**:
Terminal successful worker update exists, but copy-back and/or main-branch commit finalization has not completed.
3. **`in_progress`**:
Worker is active (heartbeat fresh) or worktree shows active mutation with no terminal status.
4. **`rerun_required`**:
Terminal update is missing, sources are inconsistent, copy-back is partial/corrupt, or heartbeat is stale.
5. **`orphaned`**:
Discovered worktree/task artifact cannot be reconciled to an active `task_id`, active phase, or expected path structure.

Classification is deterministic: same reconciled inputs produce the same state for each `task_id`.

## Worktree Reconciliation

Apply this algorithm in order:

1. Build a canonical task map keyed by `task_id`.
2. Merge `.kiln/STATE.md` state with latest valid `TaskUpdate` per task (idempotent; highest sequence wins).
3. Correlate discovered worktrees to `task_id` by path and metadata.
4. Classify every task using the five-state model above.
5. Resolve conflicts with signal precedence:
   - `orchestrator override (STATE.md) > TaskList terminal status > verified evidence paths > worktree existence`
6. For `in_progress` tasks with no active worker heartbeat beyond timeout, transition to `rerun_required`.
See the Dead Worker Detection section below for stage-aware threshold values.
7. Never duplicate `done` tasks or already-integrated `ready_for_integration` tasks.

This produces a deterministic action set. Given identical `git worktree list`, filesystem snapshot, `TaskList`, and `.kiln/STATE.md`, recovery emits identical actions.

## Recovery Priority Order

Handle classified tasks in this exact sequence:

1. **`orphaned`**:
Log for operator review and mark for cleanup tracking. Do not auto-delete.
2. **`ready_for_integration`**:
Integrate first using collision checks and stable ordering (see `kiln-copyback` skill semantics).
3. **`done`**:
Skip; already terminal and integrated.
4. **`in_progress`**:
If heartbeat is healthy, skip (worker still active). If stale, transition to `rerun_required`.
5. **`rerun_required`**:
Requeue only after all pending integration work is complete.

Integration before requeueing is mandatory to prevent collisions between pending successful output and fresh retry output.

## Retry Policy

### Worktree Reuse (default)

Retries reuse existing worktrees instead of delete+recreate:

1. `git -C <worktree> reset --hard <wave-base-ref>`
2. `git -C <worktree> clean -fd`
3. Refresh `.kiln-snapshot/` by re-copying current `config.json`, `.kiln/STATE.md`, `docs/`, and phase `PLAN`
4. Re-run worker task with the same `task_id`

If the worktree is missing or corrupt, create a fresh worktree and mark the prior path `orphaned`.

### Retry Tracking

- Retry count is tracked in `.kiln/STATE.md` under the Task Retry Ledger section (ledger format is introduced in Phase 2 Task 9).
- Maximum retries per task: `2` retries after the original attempt (`3` total attempts).
- If max retries are exceeded, orchestrator must HALT with a clear failure message.

### Cleanup Policy

- Preserve worktrees for `failed` tasks by default as debugging evidence.
- Preserve `ready_for_integration` and `orphaned` worktrees until terminal resolution.
- Perform cleanup only after terminal resolution and evidence capture.
- Cleanup operations never mutate `.kiln/STATE.md` except through orchestrator-controlled state transitions.

## Dead Worker Detection

Workers update `kiln_last_heartbeat` via `TaskUpdate` at each lifecycle transition.
When the orchestrator detects a stale heartbeat, it triggers recovery.

### Stage-Aware Thresholds

Different stages have different expected durations. Thresholds scale accordingly:

| `kiln_stage` | Healthy | Warning | Dead |
|--------------|---------|---------|------|
| `claimed` | < 5m | 5-10m | > 10m |
| `sharpening` / `sharpened` | < 10m | 10-15m | > 15m |
| `implementing` / `implemented` | < 20m | 20-30m | > 30m |
| `verifying` / `verified` | < 15m | 15-20m | > 20m |

**Override:** `preferences.deadWorkerTimeoutMinutes` in `.kiln/config.json` applies a uniform timeout across all stages. When set (non-null), it replaces the stage-aware thresholds. When `null` or absent, use the stage-aware defaults above.

### Detection Protocol

1. **Detect:** On each turn, orchestrator checks `kiln_last_heartbeat` for all `in_progress` tasks against the applicable threshold.
2. **Confirm:** If a task exceeds the Warning threshold, log it. If it exceeds the Dead threshold, proceed to recovery.
3. **Shutdown:** Send `shutdown_request` to the dead worker via `SendMessage`. Wait briefly for `shutdown_ack`.
4. **Classify:** If no response, transition task to `rerun_required`.
5. **Retry:** Check the Task Retry Ledger in STATE.md. If under retry limit (2): requeue with worktree reuse. If at limit: HALT.
6. **Record:** Update STATE.md Task Retry Ledger with the retry attempt.
