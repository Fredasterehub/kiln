---
name: kiln-wave-schedule
description: Wave scheduling, worker spawn, parallelism enforcement, integration checkpoints, and failure handling for Teams execution
---

# Kiln Wave Scheduling Protocol

## Purpose

This skill is the authoritative contract for Teams EXECUTE wave scheduling in Kiln.
It defines how the orchestrator builds wave queues, enforces concurrency, spawns workers, gates wave transitions, and handles failures.
The consumer is the orchestrator agent, which applies this protocol against platform primitives (`TaskList`, `TaskUpdate`, `addBlockedBy`, `SendMessage`).

## Wave Task Graph Construction

The orchestrator builds deterministic per-wave execution queues from `.kiln/tracks/phase-N/PLAN.md`.

### Parse waves from PLAN.md

1. Read the PLAN task list in `.kiln/tracks/phase-N/PLAN.md`.
2. Extract each task packet's plan task ID and wave assignment.
3. Group packets into `wave-1`, `wave-2`, `wave-3`, and so on.
4. Build one queue per wave; do not merge waves.

### Stable task ordering

- Primary order: PLAN appearance order (top to bottom in `PLAN.md`).
- Tie-breaker: canonical `task_id` sort when PLAN order is ambiguous or unavailable.
- Determinism guarantee: same PLAN input must produce the same queue order.

### Wave sequencing

- Create one wave-scoped EXECUTE team for each wave (`wave-1`, `wave-2`, ...).
- Process waves strictly in sequence (`wave-1` before `wave-2`, etc.).
- Next wave cannot start until current wave reaches integration checkpoint pass.
- Queue construction is deterministic and side-effect free; execution side effects start only when workers are spawned.

### Queue construction example

```markdown
PLAN rows:
P1-T01 wave-1
P1-T02 wave-1
P1-T03 wave-2

Queues:
wave-1: [P1-T01, P1-T02]
wave-2: [P1-T03]
```

## waveParallelism Enforcement

Concurrency is controlled by `.kiln/config.json` key `preferences.waveParallelism` (default `3`).

### Rules

- Parse `preferences.waveParallelism`; if missing/invalid, use `3`.
- Run at most `N` workers concurrently for the active wave.
- Keep excess tasks in the wave queue until a running worker reaches terminal status.
- On every terminal worker event, launch exactly one next queued task if cancellation is not active.
- If cancellation is active, do not launch new queued tasks.

### Deterministic scheduler loop

```text
while wave.queue not empty or wave.running not empty:
  while len(running) < waveParallelism and queue not empty and not cancellation_active:
    spawn next task packet as kiln-wave-worker
  wait for terminal worker event or shutdown_ack
  if terminal failure: set cancellation_active = true; broadcast shutdown_request
  if terminal success and not cancellation_active: launch next queued task
```

### Terminal event handling

- Terminal success: worker reaches `kiln_stage=done`.
- Terminal failure: worker reaches `kiln_stage=failed` or emits terminal failure evidence.
- Shutdown acknowledgement: peer emits `shutdown_ack` via `SendMessage` or reaches terminal state.

## Worker Spawn Template

Create one `kiln-wave-worker` teammate per task packet in the active wave.

### Worktree and filesystem contract

- Worker worktree path:
  `${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/<task-id-slug>/`
- Worker worktree must include `.kiln-snapshot/` as a read-only control-plane snapshot.
- Workers access control-plane via `.kiln-snapshot/` (read-only copy).
- Worker artifacts are written under `.kiln-artifacts/<plan-task-id>/`.
- Workers never commit in worktrees; only the orchestrator creates commits on main.

### Platform TaskUpdate metadata contract (7 keys)

| Key | Owner | Mutability | Example |
| --- | --- | --- | --- |
| `kiln_phase` | Orchestrator | Immutable | `phase-1` |
| `kiln_wave` | Orchestrator | Immutable | `1` |
| `kiln_plan_task_id` | Orchestrator | Immutable | `P1-T01` |
| `kiln_worktree` | Orchestrator | Immutable | `/tmp/kiln-<hash>/phase-1-exec-wave-1-task-1/` |
| `kiln_stage` | Worker | Milestone updates | `started \| sharpened \| implemented \| verified \| done \| failed` |
| `kiln_last_heartbeat` | Worker | Milestone/heartbeat updates | `2026-02-16T14:30:00Z` |
| `kiln_type` | Gate task only | Immutable | `wave-gate` |

### Worker flow per task packet

1. Claim and set `kiln_stage=started` with heartbeat `TaskUpdate`.
2. Sharpen approach and set `kiln_stage=sharpened`.
3. Implement and set `kiln_stage=implemented`.
4. Run explicit mini-verify and set `kiln_stage=verified` or `failed`.
5. Emit terminal `TaskUpdate` (`done` or `failed`) and terminal `SendMessage` with artifact pointers.

## Integration Checkpoint Protocol

After all successful tasks in a wave are integrated on main, run integration verify before starting the next wave.

### Integration rules

- Integration verify runs in the main workspace, not worker worktrees.
- Integration verify must pass before launching any next-wave worker.
- Integration verify is idempotent; crash recovery may re-run it safely.
- Copy-back semantics are orchestrator-owned; use `kiln-copyback` for authoritative mutation order.

### Wave-gate sentinel task pattern

Use platform-native sentinel tasks to represent wave completion gates.

1. Create a sentinel task per wave with metadata `kiln_type: "wave-gate"`.
2. Keep sentinel binary: `pending -> completed` only.
3. Add dependencies with `addBlockedBy` so all `wave-(N+1)` tasks are blocked by `wave-N` sentinel.
4. Mark sentinel `completed` only after integration verify passes for `wave-N`.

This yields a disk-persisted, self-documenting DAG in `TaskList` and avoids ambiguous transition states.

## Post-Wave Failure Handling

### Cancellation (fail-fast within wave)

- Any worker failure triggers orchestrator shutdown requests to all in-flight wave peers via `SendMessage`.
- Require `shutdown_ack` (or peer terminal status) before final wave failure decision.
- Do not launch new queued tasks while cancellation is active.
- Preserve failed worktree for forensics; never auto-clean failed worktrees.
- Record failure packet and evidence paths in `.kiln/STATE.md`, including artifact paths under `.kiln-artifacts/<plan-task-id>/`.

### Integration verify failure

- Halt progression to the next wave immediately.
- Generate deterministic correction tasks from integration verify evidence.
- Execute correction tasks with fix-forward commits only (never rewrite history).
- Re-run integration verify after each correction cycle until pass or halt threshold.
- Do not mark the wave sequence complete until integration verify passes.

### Failure evidence minimums

Store enough evidence for deterministic recovery:

- failing `kiln_plan_task_id`
- wave number and phase
- preserved worktree path
- verify output summary
- next action (`retry`, `correction-cycle`, or `halt`)
