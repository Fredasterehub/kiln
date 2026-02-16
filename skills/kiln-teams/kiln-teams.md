---
name: kiln-teams
description: Teams coordination contract — stage scoping, task IDs, worktree protocol, platform metadata, wave-gate sentinels, cancellation, and resume semantics
---

# Kiln Teams — Coordination Contract

## Purpose

This document is the single source of truth for Teams-stage coordination contracts in kiln.
It defines deterministic rules for team scoping, task identities, worker worktrees, platform metadata, status reporting, failure handling, and crash recovery.

This contract is stage-oriented and aligns with `/kiln:track` sequencing:
`PLAN -> VALIDATE -> EXECUTE -> E2E -> REVIEW -> RECONCILE`.

## Terminology

- Phase identifier: `phase-N` (for example `phase-1`, `phase-2`). Used in file paths, task IDs, `STATE.md`, and commit messages.
- Stage names: uppercase for pipeline stages (`PLAN`, `EXECUTE`, `REVIEW`), lowercase in task ID segments (`plan`, `exec`, `review`).
- Team naming: `kiln-<stage>-phase-N` (for example `kiln-plan-phase-1`, `kiln-exec-phase-2`, `kiln-review-phase-3`).
- Worker: any teammate running inside a Teams stage. "Wave worker" specifically means an `EXECUTE`-stage teammate running in a worktree.

## v0 Stage Scope

Teams are enabled only for specific stages in v0.

- `PLAN`: exactly one team handles planning for the active phase.
- `EXECUTE`: one team per phase (`kiln-exec-phase-N`). All waves within the phase share this team.
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
- Execution team handles all waves for `phase-N` within one team.
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
- Retries reuse the same `task_id`. Retry count is tracked in STATE.md's Task Retry Ledger, not in task metadata.

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
- `phase-N:exec:wave-W:gate` — Wave W gate (sentinel task)

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
- Worktree directory: `${root}/kiln-<project-hash>/<task-id-slug>/`
- Default absolute placement (when not overridden): `/tmp/kiln-<project-hash>/<task-id-slug>/`

`<project-hash>` is a stable hash of the absolute repo path (or equivalent stable project identity).

Example:

```bash
root="${KILN_WORKTREE_ROOT:-/tmp}"
slug=$(printf '%s' "$task_id" | tr ':' '-')
wt="${root}/kiln-${project_hash}/${slug}"
```

### Filesystem-safe task ID slug

Canonical task IDs use colons as separators (e.g., `phase-1:exec:wave-1:task-1`).
Colons are invalid in Windows paths and problematic with some macOS tools.

When constructing filesystem paths (worktree directories, artifact namespaces),
replace colons with dashes to produce a filesystem-safe slug:

- Canonical task ID: `phase-1:exec:wave-1:task-1`
- Filesystem slug: `phase-1-exec-wave-1-task-1`
- Worktree path: `${root}/kiln-${project_hash}/phase-1-exec-wave-1-task-1/`

Rules:
- The canonical task ID (with colons) remains authoritative for Teams metadata,
  TaskUpdate calls, STATE.md references, and all non-filesystem contexts.
- The filesystem slug (with dashes) is used ONLY for directory names.
- Slug derivation: replace every `:` with `-`.
- On resume, reconstruct canonical task ID from the known format
  (`phase-N:stage:...`), which is unambiguous.

### .kiln context sharing (read-only snapshot)

Workers need read access to control-plane files but must never mutate canonical `.kiln/`.

The orchestrator copies a minimal read-only snapshot into each worktree:

```bash
# Orchestrator creates a snapshot directory in the worktree
mkdir -p "${wt}/.kiln-snapshot"

# Copy only what workers need to read:
cp "${canonical_kiln}/config.json" "${wt}/.kiln-snapshot/"
cp "${canonical_kiln}/STATE.md" "${wt}/.kiln-snapshot/"
cp -r "${canonical_kiln}/docs/" "${wt}/.kiln-snapshot/docs/" 2>/dev/null || true
cp -r "${canonical_kiln}/tracks/phase-${N}/" "${wt}/.kiln-snapshot/tracks/phase-${N}/" 2>/dev/null || true
```

Rules:
- The snapshot is created once at worktree setup time. It is NOT updated during execution.
- Workers read from `.kiln-snapshot/` instead of `.kiln/`.
- Workers write task artifacts to a local path: `.kiln-artifacts/<plan-task-id>/`
- After copy-back, orchestrator moves artifacts from the worker's `.kiln-artifacts/<plan-task-id>/`
  into canonical `.kiln/tracks/phase-N/artifacts/<plan-task-id>/`.
- Workers never see or write to the real `.kiln/` directory.
- `.kiln-snapshot/` and `.kiln-artifacts/` are both excluded from git and from copy-back.

This eliminates the mutation blast radius entirely: a worker cannot corrupt the control plane
even by accident, because it has no path to the real `.kiln/`.

### Commit authority

Workers must never commit in worktrees.

- Worker responsibilities: implement, verify, report, and stage outputs for copy-back.
- Orchestrator responsibility: integrate copy-back into main workspace and create commits.

> **Note:** Authoritative copy-back contract is in `kiln-copyback`. This section is retained for Phase 1 compatibility and will be removed in Phase 3.

## Copy-Back Protocol

See `kiln-copyback` for the authoritative copy-back contract (change discovery, exclusion rules, application order, collision detection, stable commit order).

## Platform Task Metadata Contract

Workers and orchestrator communicate task state through Claude Code's native `TaskUpdate` metadata API. This replaces all custom YAML payload schemas.

### Metadata keys (7 total)

**Orchestrator-owned (immutable after task creation, 4 keys):**

| Key | Type | Description |
|-----|------|-------------|
| `kiln_phase` | `"phase-N"` | Phase this task belongs to |
| `kiln_wave` | `"wave-W"` | Wave number within the phase |
| `kiln_plan_task_id` | `"P1-T04"` | Plan task ID from PLAN.md (maps to artifact paths) |
| `kiln_worktree` | `"/tmp/kiln-.../..."` | Absolute worktree path for this task |

**Worker-mutable (updated during execution, 2 keys):**

| Key | Type | Description |
|-----|------|-------------|
| `kiln_stage` | enum | Worker lifecycle stage (see below) |
| `kiln_last_heartbeat` | ISO-8601 UTC | Last activity timestamp, updated at each milestone |

**Gate-specific (1 key):**

| Key | Type | Description |
|-----|------|-------------|
| `kiln_type` | `"wave-gate"` | Present only on wave-gate sentinel tasks |

### Worker lifecycle stages (`kiln_stage` enum)

Workers progress through these stages in order:

1. `claimed` — Task claimed by worker, reading inputs
2. `sharpening` — Producing sharpened implementation prompt
3. `sharpened` — Sharpening complete, artifact written
4. `implementing` — Executing code changes
5. `implemented` — Implementation complete, ready for verify
6. `verifying` — Running mini-verify checks
7. `verified` — Mini-verify passed (terminal success path)
8. `failed` — Task failed at any stage (terminal failure path)
9. `shutdown_ack` — Worker acknowledged shutdown request (terminal cancel path)

Workers update `kiln_stage` and `kiln_last_heartbeat` via `TaskUpdate` at each transition.

### Terminal reporting

On terminal status (`verified`, `failed`, `shutdown_ack`):

1. Write file artifacts to `.kiln-artifacts/<plan-task-id>/` (see `kiln-wave-worker` for details)
2. Call `TaskUpdate` with terminal `kiln_stage` and final `kiln_last_heartbeat`
3. Send `SendMessage` to orchestrator with brief summary (artifact paths, pass/fail, error if any)

Artifact files are the authoritative record. `SendMessage` is for fast notification; `TaskUpdate` metadata is for persistent state that survives compaction.

### Retry tracking

Retry counts are NOT stored in task metadata. The orchestrator tracks retries in STATE.md's Task Retry Ledger (single-writer principle). Maximum 2 retries per task before HALT.

## Wave-Gate Sentinel Tasks

Wave ordering is enforced through platform-native `addBlockedBy` dependencies.

### How it works

1. Orchestrator creates all wave tasks and gate tasks when the EXECUTE stage begins.
2. Each wave has a gate task: `phase-N:exec:wave-W:gate` with metadata `kiln_type: "wave-gate"`.
3. All tasks in wave W+1 have `addBlockedBy: [gate-task-id-for-wave-W]`.
4. The platform automatically blocks wave W+1 tasks until the wave W gate is completed.

### Gate completion protocol

After wave W completes:

1. All wave-W worker tasks reach terminal status.
2. Orchestrator runs copy-back integration (see `kiln-copyback`).
3. Orchestrator runs integration verify on main.
4. If verify passes: orchestrator completes the wave-W gate task via `TaskUpdate`.
5. Platform automatically unblocks wave W+1 tasks.
6. If verify fails: gate stays incomplete, wave W+1 remains blocked, orchestrator handles correction.

### Benefits

- No custom wave ordering logic needed in orchestrator.
- Wave sequencing survives compaction (TaskList persists dependencies).
- Workers cannot accidentally start before prior wave integrates.

## Orchestrator TaskList Reading Protocol

The orchestrator reconstructs execution state from platform primitives every turn.

### State reconstruction (every turn)

1. Read `TaskList` to get all tasks with their metadata and status.
2. Read `.kiln/STATE.md` for phase/step/retry context.
3. Read `.kiln/config.json` for preferences.

### Decision tree

For each task in TaskList:

1. **Terminal + not integrated:** Run copy-back for this task (see `kiln-copyback`).
2. **Terminal + integrated:** No action needed.
3. **In-progress + heartbeat fresh:** Worker active, wait.
4. **In-progress + heartbeat stale:** Potential dead worker (see `kiln-resume` for detection thresholds).
5. **Blocked by gate:** Waiting for prior wave gate completion.
6. **Pending + unblocked:** Available for claiming by a worker.

### PLAN/REVIEW stage monitoring

PLAN and REVIEW teammates report progress via `SendMessage`. Orchestrator treats these as informational telemetry. Final gate decisions use stage-specific sentinel files (e.g., `plan-validation-result` for VALIDATE).

## Control-Plane Write Policy

Control-plane writes are single-writer to prevent state corruption.

- Only orchestrator writes `.kiln/STATE.md`.
- PLAN stage teammates (primary workspace) may write designated planning outputs under `.kiln/tracks/phase-N/` (for example `plan_claude.md`, `plan_codex.md`, `PLAN.md`, debate artifacts).
- REVIEW stage teammates (primary workspace) may write designated review outputs under `.kiln/tracks/phase-N/` (for example `review.md`, `review_codex.md`, critique/revision artifacts, `debate_log.md`).
- EXECUTE stage wave workers (worktrees) read control-plane context only from `.kiln-snapshot/**` and may write only to:
  `.kiln-artifacts/<plan-task-id>/`.
- All teammates must never write `.kiln/STATE.md`.
- Any attempted write outside stage-allowed locations is a protocol violation and must fail the task.

## Hooks and Mini-Verify Behavior

When Teams execution is active, hooks must be disabled to avoid duplicate/implicit verification.

Required environment contract:

- The orchestrator session and all worker processes must set `KILN_TEAMS_ACTIVE=1` (or equivalent compatibility flag) whenever `preferences.useTeams` is `true`.
- This prevents hooks from triggering during both worker execution and orchestrator state updates.

Behavior:

- Hook-driven mini-verify is disabled while Teams is active.
- Workers run explicit mini-verify as an execution step and report results via file artifacts in `.kiln-artifacts/<plan-task-id>/verify/`.

## Cancellation and Failure Semantics

Within an execution wave, failure is fail-fast at wave scope.

- If any worker fails its task, orchestrator must issue shutdown requests to all other in-flight workers in the same wave.
- Workers receiving shutdown should stop new mutations, emit `shutdown_ack` via TaskUpdate, and preserve current evidence.
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

> **Note:** Authoritative resume contract is in `kiln-resume`. This section is retained for backward compatibility and will be removed in Phase 3.

## Resume and Cleanup

See `kiln-resume` for the authoritative resume contract (resume inputs, task classification, recovery priority, retry policy, cleanup semantics).

## Compliance Checklist

A Teams-enabled stage is compliant only if all are true:

- Team scope matches v0 stage rules (one exec team per phase, not per wave).
- Task IDs match required patterns exactly.
- Worktrees are under `${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/<task-id-slug>/`.
- `.kiln-snapshot/` directory is present with read-only copies of config.json, STATE.md, docs/, phase PLAN.
- Worker made no commits in worktree.
- Copy-back followed `kiln-copyback` protocol (change discovery, exclusions, application order, collision detection, stable commit order).
- Wave ordering enforced via wave-gate sentinel tasks with `addBlockedBy`.
- All task metadata uses the 7-key platform contract (no custom YAML payloads).
- Workers updated `kiln_stage` and `kiln_last_heartbeat` at each lifecycle transition.
- Terminal workers wrote file artifacts before final TaskUpdate + SendMessage.
- PLAN/REVIEW teammates reported via SendMessage; orchestrator used sentinel files for gate decisions.
- Only orchestrator wrote `.kiln/STATE.md`.
- On failure, orchestrator issued wave shutdown and preserved failed worktree.
- On post-wave integration verify failure, orchestrator halted next-wave start and used fix-forward correction commits only.
- Retries tracked in STATE.md Task Retry Ledger (not in task metadata).
- Resume logic follows `kiln-resume` protocol.
- Orchestrator and workers set `KILN_TEAMS_ACTIVE=1` and used explicit mini-verify.
