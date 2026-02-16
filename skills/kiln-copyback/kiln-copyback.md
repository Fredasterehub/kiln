---
name: kiln-copyback
description: Deterministic copy-back protocol — change discovery, exclusions, application order, collision detection, and stable commit ordering
---

## Purpose

This skill defines the authoritative copy-back protocol for Kiln waves.
It is used by the orchestrator when integrating successful worker outputs.
The protocol is deterministic and lossless across add, modify, delete, rename,
and untracked-file changes produced in worker worktrees.
It standardizes how to discover changes, exclude protected paths, and apply
operations to the main workspace.
It also defines mandatory collision checks before any mutation.
It fixes commit ordering independent of worker completion timing.
Core promise: integration reproduces worker-intended content without dropping
valid changes on non-excluded paths.
Postcondition: for all non-excluded paths, the main workspace materialized tree
equals the selected worker result after copy-back application.

## Change Discovery

Run discovery from the worker worktree root with null-delimited outputs:

```bash
git diff --name-status -z
git ls-files -o --exclude-standard -z
```

Interpret `git diff --name-status -z` as operation records:
- `A`: file add
- `M`: file modify
- `D`: file delete
- `R<score>`: rename with old/new path pair in the same record

Interpret `git ls-files -o --exclude-standard -z` as untracked files that must
also be considered for copy-back (subject to exclusions).

`-z` is required because filenames may contain spaces, tabs, or newlines.
Null-byte separation is the only safe delimiter for lossless parsing.

The orchestrator should normalize parsed records into `changed_ops` with
explicit operation type and path fields. Rename operations must retain both:
- `from_path`: rename source path
- `path`: rename destination path

Discovery output must be complete before ordering and collision checks.
Missing operation types or lossy parsing is protocol-invalid.

## Exclusion Rules

Exclude any path that is:
- exactly `.kiln`
- starts with `.kiln/`
- exactly `.kiln-snapshot/`
- starts with `.kiln-snapshot/`
- exactly `.kiln-artifacts/`
- starts with `.kiln-artifacts/`

Rationale: workers never receive writable access to real `.kiln/`.
Workers operate with a read-only `.kiln-snapshot/` copy and separate artifact
staging under `.kiln-artifacts/`.

Artifact migration is orchestrator-owned and occurs after copy-back:
`.kiln-artifacts/<plan-task-id>/` is moved into
`.kiln/tracks/phase-N/artifacts/<plan-task-id>/`.

Worker copy-back never mutates `.kiln/STATE.md`.
State transitions are orchestrator responsibilities outside worker file replay.

## Application Order

Apply operations in this strict deterministic order:
1. Renames (`R*`)
2. Deletions (`D`)
3. Adds and modifies (`A`, `M`)
4. Untracked files (from `git ls-files -o --exclude-standard -z`)

Why this order is required:
- Renames first prevent accidental deletion of paths that were moved.
- Deletions before content writes remove obsolete files cleanly.
- Adds/modifies then copy bytes into their final locations.
- Untracked last captures newly created files unknown to index history.

Operation semantics:
- Renames apply source-to-destination mapping exactly.
- Deletions remove target paths if present.
- Adds/modifies copy file bytes byte-for-byte from worker tree.
- Untracked files copy byte-for-byte like adds, after tracked operations.

Postcondition after full application:
for all non-excluded paths, the main workspace materialized tree equals the
worker result selected for integration.

## Collision Detection

A wave-wide collision scan is mandatory before any main-workspace mutation.
No copy-back step may begin until this scan passes.

Build per-task touched-path sets from each successful worker's `changed_ops`:
- include `path` for add, modify, delete, rename destination, and untracked
- include `from_path` for rename source

Both rename endpoints are collidable. Omitting either endpoint is invalid.

Normalize path keys consistently before comparison.
A collision exists if the same normalized path key appears in more than one
successful worker in the same wave.

If any collision is detected:
- halt wave integration immediately
- preserve all involved worktrees (no cleanup)
- mark the wave for correction/replan
- do not mutate main workspace, git index, or commit history
- emit an operator-facing escalation message listing conflicting `task_id`s and
  the conflicting paths

Collision handling is fail-closed. Partial integration is forbidden.

## Overlap Preparation

The orchestrator may prepare copy-back materials while workers are still
running, but preparation is read-only.

Allowed during overlap:
- read worker worktrees
- precompute ordered operation lists
- cache change manifests
- snapshot staged files for later deterministic replay

Forbidden until wave completion gate:
- mutating main workspace
- mutating git index
- creating commits

Main mutation may begin only when all conditions are true:
- all active workers in the wave are terminal
- collision detection has passed
- stable commit order has been fixed

## Stable Commit Order

In-wave commit order is deterministic and derived from `PLAN.md` task order for
that wave.
Equivalent ordering key: ascending `phase-N:exec:wave-W:task-T`.

Never use worker completion order for copy-back or commit creation.
Integration and commits must follow the same stable order each run.

Retries preserve the same logical position and `task_id`.
A corrected retry that succeeds still commits in its original stable slot.

Why this rule exists:
- reproducible git history across repeated executions
- predictable conflict surfaces
- simpler forensics and operator reasoning
