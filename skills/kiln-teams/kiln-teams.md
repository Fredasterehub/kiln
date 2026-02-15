---
name: kiln-teams
description: Teams coordination contract — stage scoping, task IDs, worktree/copy-back protocol, TaskUpdate schema, cancellation, resume and cleanup semantics
---

# Kiln Teams — Coordination Contract

## Purpose

This document is the single source of truth for Teams-stage coordination contracts in kiln.
It defines deterministic rules for team scoping, task identities, worker worktrees, copy-back, status reporting, failure handling, and crash recovery.

This contract is stage-oriented and aligns with `/kiln:track` sequencing:
`PLAN -> VALIDATE -> EXECUTE -> E2E -> REVIEW -> RECONCILE`.

## Terminology

- Phase identifier: `phase-N` (for example `phase-1`, `phase-2`). Used in file paths, task IDs, `STATE.md`, and commit messages.
- Stage names: uppercase for pipeline stages (`PLAN`, `EXECUTE`, `REVIEW`), lowercase in task ID segments (`plan`, `exec`, `review`).
- Team naming: `kiln-<stage>-phase-N` (for example `kiln-plan-phase-1`, `kiln-exec-wave-1-phase-2`, `kiln-review-phase-3`).
- Worker: any teammate running inside a Teams stage. "Wave worker" specifically means an `EXECUTE`-stage teammate running in a worktree.

## v0 Stage Scope

Teams are enabled only for specific stages in v0.

- `PLAN`: exactly one team handles planning for the active phase.
- `EXECUTE`: one team per execution wave (`wave-1`, `wave-2`, etc.).
- `REVIEW`: exactly one team handles review debate.

Teams are not used in v0 for:

- `BRAINSTORM`
- `ROADMAP`
- `E2E`
- `RECONCILE`

Configuration contract:

- `preferences.executeConcurrency` is reserved in v0.
- The only supported value is `"worktree"`.
- Orchestrator must validate this on startup and reject unsupported values.

## Team Identity and Task ID Conventions

### Team scoping

For phase `phase-N`:

- Planning team handles only planning tasks for `phase-N`.
- Each execution wave has its own team and may run tasks in parallel.
- Review team handles review/debate tasks for `phase-N`.

### Task IDs

Task IDs are globally unique within a phase and must match exactly one of these formats:

- `phase-N:plan:*`
- `phase-N:exec:*`
- `phase-N:review:*`

Rules:

- `<N>` is the numeric phase index from `.kiln/tracks/phase-N/`.
- Suffix `*` is caller-defined but must be deterministic for retries/restarts.
- The same logical task must reuse the same ID on retry for idempotent reconciliation.
- Retries reuse the same `task_id`; use `sequence` and `idempotency_key` to distinguish attempts. Never embed attempt counters in `task_id`.

### Canonical Task ID Table

PLAN stage (`phase-N`):

- `phase-N:plan:planner-opus` — Opus planner initial
- `phase-N:plan:planner-codex` — Codex planner initial
- `phase-N:plan:critique-of-codex-rR` — Opus critiques Codex plan, round R
- `phase-N:plan:critique-of-claude-rR` — Codex critiques Opus plan, round R
- `phase-N:plan:revision-opus-vV` — Opus revision version V
- `phase-N:plan:revision-codex-vV` — Codex revision version V
- `phase-N:plan:synthesizer` — Plan synthesizer
- `phase-N:plan:validator` — Plan validator

EXECUTE stage (`phase-N`):

- `phase-N:exec:wave-W:task-T` — Wave W, task T

REVIEW stage (`phase-N`):

- `phase-N:review:opus-initial` — Opus reviewer initial
- `phase-N:review:codex-initial` — Codex reviewer initial
- `phase-N:review:critique-of-codex-rR` — Opus critiques Codex review, round R
- `phase-N:review:critique-of-opus-rR` — Codex critiques Opus review, round R
- `phase-N:review:revision-opus-vV` — Opus revision version V
- `phase-N:review:revision-codex-vV` — Codex revision version V

## Worktree Protocol

### Root placement

Worktrees are created outside the repository tree.

- Default base root: `/tmp`
- Override: `KILN_WORKTREE_ROOT`
- Effective root: `${KILN_WORKTREE_ROOT:-/tmp}`
- Worktree directory: `${root}/kiln-<project-hash>/<task-id>/`
- Default absolute placement (when not overridden): `/tmp/kiln-<project-hash>/<task-id>/`

`<project-hash>` is a stable hash of the absolute repo path (or equivalent stable project identity).

Example:

```bash
root="${KILN_WORKTREE_ROOT:-/tmp}"
wt="${root}/kiln-${project_hash}/${task_id}"
```

### .kiln sharing

Each worker worktree must receive a symlink to the orchestrator control plane:

```bash
ln -s /abs/path/.kiln "${wt}/.kiln"
```

Contract:

- The symlink target must be the canonical absolute `.kiln` path in the primary repo.
- `EXECUTE`-stage wave workers treat `.kiln/**` as read-only, except task-namespaced artifacts:
  `.kiln/tracks/phase-N/artifacts/<plan-task-id>/`.

  `<plan-task-id>` is the PLAN.md task identifier (e.g., `P1-T04`), not the Teams
  `task_id`. The orchestrator maps between Teams task IDs and plan task IDs when
  coordinating artifact paths.

### Commit authority

Workers must never commit in worktrees.

- Worker responsibilities: implement, verify, report, and stage outputs for copy-back.
- Orchestrator responsibility: integrate copy-back into main workspace and create commits.

## Copy-Back Protocol (Lossless)

Copy-back must preserve add/modify/delete/rename/untracked changes with deterministic semantics.

### Change discovery commands

Use both commands from worker worktree root:

```bash
git diff --name-status -z
git ls-files -o --exclude-standard -z
```

Interpretation contract:

- `git diff --name-status -z` captures tracked deltas including:
  - `A` add
  - `M` modify
  - `D` delete
  - `R<score>` rename (old/new path pair)
- `git ls-files -o --exclude-standard -z` captures untracked paths.

### Exclusions and read-only paths

- Exclude any path matching `.kiln` or starting with `.kiln/` from copy-back.
- The `.kiln` symlink entry itself must never be copied back.
- Never copy back `.kiln/**` except artifacts that are already written in-place to:
  `.kiln/tracks/phase-N/artifacts/<plan-task-id>/`.

### Deterministic application order

Apply copy-back in this order:

1. Renames (`R*`) using old/new pair mapping.
2. Deletions (`D`).
3. Adds/Modifies (`A`, `M`) by byte-for-byte file copy.
4. Untracked files from `git ls-files -o --exclude-standard -z`.

Postcondition:

- Main workspace materialized tree equals worker result for all non-excluded paths.
- No `.kiln/STATE.md` mutation is performed by worker copy-back.

### Collision detection before copy-back

Before any main-workspace mutation, orchestrator must perform a wave-wide collision scan across all successful workers' `changed_ops`.

- Scan set must include:
  - `path` for `add|modify|delete|rename|untracked`
  - `from_path` for `rename` (treat source and destination as collidable keys)
- A collision exists when the same normalized path key appears in more than one successful worker in the wave.
- If any collision is detected, halt wave integration, preserve all involved worktrees, and mark wave for correction/replan. Do not mutate main/index and do not create commits until collision is resolved.

### Overlap copy-back prep

Orchestrator may prepare copy-back materials while workers are still running (for example capture per-worker change manifests and staged file snapshots), but this prep is read-only against main.

- Allowed during overlap: read worker worktrees, precompute ordered operation lists, cache manifests.
- Forbidden until wave completion: mutating main workspace, mutating git index, or creating commits.
- Main mutation may begin only after all active workers in the wave have reached terminal states, collision detection passes, and stable commit order is fixed.

### Stable commit order

In-wave commit order is deterministic and derived from `PLAN.md` task order for that wave (equivalently deterministic ascending `phase-N:exec:wave-W:task-T` ordering), never worker completion order.

- Copy-back and commit creation must follow this stable order.
- Retries preserve the same logical position and `task_id`; successful corrections still commit in stable order.

## TaskUpdate Payload Contract

`TaskUpdate` is for `EXECUTE` wave workers only (`phase-N:exec:*` worktree tasks).

### Required schema

```yaml
task_id: "phase-N:exec:*"
phase: "phase-N"
stage: "execute"
status: "queued | in_progress | verify_passed | verify_failed | done | failed | canceled | shutdown_requested | shutdown_ack"
worktree_path: "${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/<task-id>/"
changed_ops:
  - op: "add | modify | delete | rename | untracked"
    path: "relative/path"
    from_path: "relative/old-path-or-null"
verify_summary:
  result: "pass | fail | skipped"
  command_summary:
    - "<command + exit summary>"
  checks:
    - name: "<ac-or-check-name>"
      outcome: "pass | fail | skipped"
evidence_paths:
  - ".kiln/tracks/phase-N/<stage-output-or-artifact-path>"
error:
  code: "string-or-null"
  message: "string-or-null"
  details_path: ".kiln/tracks/phase-N/<stage-error-log-or-null>"
timestamps:
  started_at: "ISO-8601-UTC-or-null"
  updated_at: "ISO-8601-UTC"
  completed_at: "ISO-8601-UTC-or-null"
emitted_at: "ISO-8601-UTC"
sequence: 1
idempotency_key: "stable-key-for-logical-update"
```

### Idempotency and ordering

- `idempotency_key` must be stable for a logically identical update.
- Orchestrator must treat duplicate `idempotency_key` as no-op.
- `sequence` must be monotonic per `task_id`.
- If out-of-order updates arrive, orchestrator keeps highest applied `sequence` and ignores lower ones.
- Workers must filter `.kiln` and `.kiln/*` from `changed_ops` in `TaskUpdate`.

## PLAN/REVIEW Progress Contract (SendMessage)

PLAN and REVIEW teammates report progress via lightweight `SendMessage` events, not schema-validated `TaskUpdate`.

Required fields for progress events:

```yaml
phase: "phase-N"
task_id: "phase-N:plan:* | phase-N:review:*"
state: "started | progress | completed | failed"
evidence_paths:
  - ".kiln/tracks/phase-N/<artifact-path>"
```

Rules:

- `task_id` must use canonical PLAN/REVIEW IDs from this document.
- `evidence_paths` must point to concrete artifacts produced so far.
- Orchestrator treats these messages as progress telemetry; final gate decisions still use stage-specific contracts (for example `plan-validation-result` in VALIDATE).

## Control-Plane Write Policy

Control-plane writes are single-writer to prevent state corruption.

- Only orchestrator writes `.kiln/STATE.md`.
- PLAN stage teammates (primary workspace) may write designated planning outputs under `.kiln/tracks/phase-N/` (for example `plan_claude.md`, `plan_codex.md`, `PLAN.md`, debate artifacts).
- REVIEW stage teammates (primary workspace) may write designated review outputs under `.kiln/tracks/phase-N/` (for example `review.md`, `review_codex.md`, critique/revision artifacts, `debate_log.md`).
- EXECUTE stage wave workers (worktrees) may write under `.kiln/**` only at:
  `.kiln/tracks/phase-N/artifacts/<plan-task-id>/`.
- All teammates must never write `.kiln/STATE.md`.
- Any attempted write outside stage-allowed locations is a protocol violation and must fail the task.

## Hooks and Mini-Verify Behavior

When Teams execution is active, hooks must be disabled to avoid duplicate/implicit verification.

Required environment contract:

- The orchestrator session and all worker processes must set `KILN_TEAMS_ACTIVE=1` (or equivalent compatibility flag) whenever `preferences.useTeams` is `true`.
- This prevents hooks from triggering during both worker execution and orchestrator state updates.

Behavior:

- Hook-driven mini-verify is disabled while Teams is active.
- Workers run explicit mini-verify as an execution step and report results via `TaskUpdate.verify_summary`.

## Cancellation and Failure Semantics

Within an execution wave, failure is fail-fast at wave scope.

- If any worker fails its task, orchestrator must issue shutdown requests to all other in-flight workers in the same wave.
- Workers receiving shutdown should stop new mutations, emit `shutdown_ack`, and preserve current evidence.
- Failed worker worktree must be preserved (no cleanup).
- Orchestrator records evidence paths for failed and shutdown tasks before deciding rerun/halt.

### Post-wave integration verify failure policy

After all successful worker outputs for a wave are integrated and committed in stable order, orchestrator must run integration verify on main.

- If integration verify passes, wave is complete and next wave may start.
- If integration verify fails:
  - Halt before starting the next wave.
  - Generate correction tasks (fix-forward only) and produce new correction commits; no reverts/reset of successful task commits.
  - Preserve relevant worktrees/artifacts for forensics.
  - Do not proceed until integration verify passes.

## Wave Parallelism Enforcement

`preferences.waveParallelism` caps concurrently active workers inside a single wave.

- If wave task count is less than or equal to the cap, start all tasks immediately.
- If wave task count exceeds the cap, enqueue overflow tasks and run FIFO batches within the same wave as slots free up.
- Next wave must not start until the current wave queue is fully drained and post-wave integration verify has passed.

## Resume and Cleanup (Deterministic)

After orchestrator crash/restart, resume must reconstruct truth deterministically and preserve single-writer control.

### Resume inputs

Reconcile all four sources:

1. `git worktree list`
2. Filesystem scan under `${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/`
3. `.kiln/STATE.md`
4. Teams `TaskList`

### Resume algorithm

1. Build canonical task map keyed by `task_id`.
2. Merge state from `.kiln/STATE.md` and latest idempotent `TaskUpdate` per task.
3. Correlate discovered worktrees to `task_id` by path and metadata.
4. Classify each task deterministically:
   - `done`: terminal successful update exists and copy-back integrated.
   - `ready_for_integration`: terminal successful worker update exists, but copy-back and/or main commit is not yet applied.
   - `in_progress`: worker active or worktree has active mutation and no terminal status.
   - `orphaned`: discovered worktree/task artifact cannot be reconciled to an active canonical `task_id`, active phase, or expected `${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/<task-id>/` structure.
   - `rerun_required`: missing terminal update, inconsistent sources, or partial/corrupt copy-back.
5. Deterministic priority order: `orphaned` -> `ready_for_integration` -> `done` -> `in_progress` -> `rerun_required`.
6. For tasks marked `in_progress` with no active worker heartbeat beyond timeout, transition to `rerun_required`.
7. Integrate `ready_for_integration` tasks first using collision checks + stable order rules before requeueing anything.
8. Requeue only `rerun_required` tasks; never duplicate `done` or already integrated `ready_for_integration` tasks.
9. Continue wave ordering from `/kiln:track` contract.

### Retry worktree reuse

Retries must reuse existing worktrees when possible (lossless, faster recovery), instead of delete+recreate.

- Reuse flow:
  1. `git -C <worktree> reset --hard <wave-base-ref>`
  2. `git -C <worktree> clean -fd`
  3. Ensure `.kiln` symlink exists and points to canonical absolute `.kiln` path (repair if needed)
  4. Re-run worker task with same `task_id`
- If reuse preconditions fail (missing/corrupt worktree), fallback to fresh create and mark prior path `orphaned`.

### Cleanup policy

- Preserve worktrees for `failed` tasks by default.
- Preserve worktrees referenced by unresolved `rerun_required` tasks until rerun completes.
- Cleanup only after terminal resolution and evidence capture.
- Cleanup operations must never mutate `.kiln/STATE.md` except via orchestrator-controlled state transition.

## Compliance Checklist

A Teams-enabled stage is compliant only if all are true:

- Team scope matches v0 stage rules.
- Task IDs match required patterns exactly.
- Worktrees are under `${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/<task-id>/`.
- `.kiln` symlink is present and points to canonical absolute control-plane path.
- Worker made no commits in worktree.
- Copy-back used both `git diff --name-status -z` and `git ls-files -o --exclude-standard -z`.
- Collision detection ran across wave `changed_ops` (including rename `from_path`) before any main mutation.
- Overlap prep did not mutate main/index/commits before wave completion + collision pass + stable order selection.
- In-wave commits were applied in stable PLAN.md order, not completion order.
- Copy-back excluded any path matching `.kiln` or starting with `.kiln/`; `.kiln` symlink entry itself was not copied back.
- EXECUTE workers emitted schema-compliant, idempotent `TaskUpdate` payloads.
- PLAN/REVIEW teammates emitted SendMessage progress events with `phase`, `task_id`, `state`, and `evidence_paths`.
- Only orchestrator wrote `.kiln/STATE.md`.
- On failure, orchestrator issued wave shutdown and preserved failed worktree.
- On post-wave integration verify failure, orchestrator halted next-wave start and used fix-forward correction commits only.
- Retries reused worktrees via reset+clean+symlink-resync when possible.
- Resume logic reconciles worktree + filesystem + state + Teams task list before requeue.
- Orchestrator and workers set `KILN_TEAMS_ACTIVE=1` (or equivalent) and used explicit mini-verify.
