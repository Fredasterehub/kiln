---
name: kiln-track
description: "Main work loop — auto-advances phases through plan, validate, execute, e2e, review, reconcile"
user_invocable: true
---
# /kiln:track — Track Execution Loop

## Overview
`/kiln:track` is the main work loop for kiln delivery. It takes roadmap phases from `.kiln/ROADMAP.md`, reads runtime status from `.kiln/STATE.md`, and drives each phase through the full gate sequence.

The kiln orchestrator (`agents/kiln-orchestrator.md`) executes this skill as a control contract. This skill defines ordering, transitions, retry budgets, pause conditions, and final closeout behavior.

Track scope is phase-complete delivery, not ad-hoc execution. The loop continues until every roadmap phase reaches `complete`, then it triggers Final Integration E2E as a separate terminal gate.

Core loop shape:
- Per-phase flow: `PLAN -> VALIDATE -> EXECUTE -> E2E -> REVIEW -> RECONCILE`
- Cross-phase behavior: auto-advance to next incomplete roadmap phase
- End-of-project behavior: run Final Integration E2E, then write `.kiln/FINAL_REPORT.md`

The orchestrator is routing-only. It does not implement source changes itself; it spawns designated subagents and records machine-readable state transitions.

## Prerequisites
Before running `/kiln:track`, confirm all control-plane artifacts exist:

- `.kiln/config.json` — project configuration produced by `/kiln:init`
- `.kiln/VISION.md` — operator-approved vision from `/kiln:brainstorm`
- `.kiln/ROADMAP.md` — phase decomposition from `/kiln:roadmap`
- `.kiln/STATE.md` — initialized pipeline state ledger

Prerequisite handling contract:

1. If any prerequisite is missing, stop immediately.
2. Print the missing path(s) and the exact command the operator must run.
3. Do not attempt fallback generation inside `/kiln:track`.

Operator guidance map for missing files:

| Missing file | Required command |
| --- | --- |
| `.kiln/config.json` | `/kiln:init` |
| `.kiln/VISION.md` | `/kiln:brainstorm` |
| `.kiln/ROADMAP.md` | `/kiln:roadmap` |
| `.kiln/STATE.md` | `/kiln:init` then `/kiln:status` check |

Example stop message format:

```text
Cannot run /kiln:track: missing .kiln/ROADMAP.md.
Run /kiln:roadmap first, then rerun /kiln:track.
```

## Track Loop
Run the loop exactly in this sequence:

1. Read `.kiln/STATE.md` to determine `currentPhase`, `currentStep`, counters, and gate status.
2. If no current phase is active, read `.kiln/ROADMAP.md` and select the first incomplete phase.
3. Execute the current step for the current phase:
   a. `PLAN` — spawn `kiln-planner` (Opus) plus `kiln-codex-planner` when `modelMode=multi-model`, then run `kiln-synthesizer` when `multi-model` to produce canonical `PLAN.md`.
   b. `VALIDATE` — spawn `kiln-validator` (Sonnet) for 7-dimension plan validation.
   c. `EXECUTE` — parse waves from `PLAN.md`; for each task run `kiln-sharpener` then `kiln-executor` then mini-verify; repeat through all waves in order.
   d. `E2E` — spawn `kiln-e2e-verifier` (Sonnet).
   e. `REVIEW` — spawn `kiln-reviewer` (Opus).
   f. `RECONCILE` — run reconciliation protocol via `/kiln:reconcile` (`skills/kiln-reconcile/kiln-reconcile.md`).
4. After each step completes: if `PASS`, advance to the next step and update `.kiln/STATE.md`; if `FAIL`, check correction budget, run correction flow when budget remains, otherwise `HALT`.
5. After `RECONCILE` completes for a phase: mark phase complete in `.kiln/STATE.md`, move to next incomplete phase; if none remain, trigger Final Integration E2E.
6. After Final Integration E2E passes: generate `.kiln/FINAL_REPORT.md`, mark project complete, and set state to terminal success.

Transition invariants:
- Only one active phase and one active step at a time.
- Every transition writes timestamped state before downstream spawn.
- Retry/correction counters are monotonic and persisted per phase.
- On any halt threshold, transition to failed state and wait for operator direction.

## Stage Details

### PLAN stage

#### Purpose
Convert phase intent from `ROADMAP.md` into executable task packets for this specific phase.

#### Subagents to spawn
- Always spawn `kiln-planner` (Opus lane).
- In `multi-model` mode, also spawn `kiln-codex-planner` (Codex lane).
- In `multi-model` mode, spawn `kiln-synthesizer` after both planners complete.

#### Mode behavior
- `multi-model`:
  - Outputs expected: `.kiln/tracks/phase-N/plan_claude.md`, `.kiln/tracks/phase-N/plan_codex.md`, and synthesized `.kiln/tracks/phase-N/PLAN.md`.
  - `PLAN.md` is authoritative for downstream stages.
- `claude-only`:
  - Only `kiln-planner` runs.
  - Planner output is promoted/copied as `.kiln/tracks/phase-N/PLAN.md`.
  - No codex planner and no synthesizer pass.

#### Required output
`PLAN.md` must contain task packets with goals, ACs, files, dependencies, waves, and rollback context as defined by `skills/kiln-plan/kiln-plan.md`.

#### Exit conditions
- `PASS`: `PLAN.md` exists and is parseable for validation.
- `FAIL`: planning artifact missing, malformed, or cannot be promoted to canonical `PLAN.md`.

#### State updates
- Set `currentStep: validate` on pass.
- Record planning artifact paths in phase metadata.
- On fail, increment plan retry metadata and route to re-plan if budget remains.

### VALIDATE stage

#### Purpose
Quality-gate the phase plan using the 7-dimension validation contract.

#### Subagent to spawn
- Spawn `kiln-validator` with `PLAN.md` and relevant living docs.

#### Validation contract
- Must run all 7 dimensions from `kiln-plan` specification.
- Must emit machine-readable `plan-validation-result` sentinel.

#### Pass behavior
- Mark validation pass in state.
- Advance to `EXECUTE` for the same phase.

#### Fail behavior
- Route feedback back into planning.
- Re-trigger planning with validator findings attached.
- Maximum re-plan attempts: 2 for the same phase.
- After second failed validation cycle, `HALT` and wait for operator.

#### State updates
- Track `planValidationAttempts` per phase.
- Persist failure reasons and validator artifact path.
- Timestamp each validation result transition.

### EXECUTE stage

#### Purpose
Implement all phase task packets safely and deterministically.

#### Input contract
- Read tasks from `.kiln/tracks/phase-N/PLAN.md`.
- Respect wave ordering and dependencies.

#### Execution protocol
1. Parse wave table and task IDs from `PLAN.md`.
2. Process waves sequentially (`wave-1`, then `wave-2`, etc.).
3. Inside each wave, run tasks in parallel when dependency-safe.
4. For each task:
   - Spawn `kiln-sharpener` to produce an implementation packet for the executor model.
   - Spawn `kiln-executor` to implement the task.
   - Run mini-verify (`/kiln:verify`) against task acceptance criteria.
5. Persist task-level results and counters into `.kiln/STATE.md`.

#### Retry budget
- Mini-verify retries: max 2 per task.
- On retryable failure, rerun sharpen -> execute -> mini-verify for that task only.
- If a task hits mini-verify retry limit, set phase step to failed and `HALT`.

#### Concurrency rules
- Waves: strictly sequential.
- Tasks within a wave: parallel allowed only when they do not modify the same file set and do not depend on each other.

#### Exit conditions
- `PASS`: all tasks in all waves satisfy mini-verify.
- `FAIL`: any task exceeds mini-verify retry budget.

#### State updates
- Maintain per-task status (`queued`, `in_progress`, `done`, `blocked`, `halted`).
- Increment `correctionCycles.miniVerify` on each retry.
- Write transition timestamps for each task completion/failure.

### E2E stage

#### Purpose
Validate that the full phase behavior works end-to-end and does not regress prior behavior.

#### Subagent to spawn
- Spawn `kiln-e2e-verifier` after execute pass.

#### Required test scope
- New user-journey coverage introduced by this phase.
- Cumulative regression checks relevant to previously completed phases.

#### Correction loop
- On E2E fail, consume correction packets from `e2e-results.md`.
- Route corrections through execution flow (sharpen -> execute -> mini-verify).
- Re-run E2E after correction batch.
- Maximum E2E correction cycles: 3 per phase.

#### Exit conditions
- `PASS`: E2E sentinel reports pass and no blocking failures.
- `FAIL`: third correction cycle still failing -> `HALT`.

#### State updates
- Increment `correctionCycles.e2e` each failed E2E cycle.
- Store E2E artifact path in phase metadata.
- Timestamp each cycle boundary.

### REVIEW stage

#### Purpose
Apply comprehensive quality review after implementation and E2E validation.

#### Subagent to spawn
- Spawn `kiln-reviewer` on E2E pass.

#### Verdict handling
- `APPROVED`:
  - Advance directly to `RECONCILE`.
- `REJECTED`:
  - Use reviewer correction packets.
  - Route corrections through `EXECUTE` then `E2E` then `REVIEW`.
  - Maintain strict cycle counting.

#### Correction budget
- Maximum review correction cycles: 3 per phase.
- If review remains rejected after 3 cycles, `HALT`.

#### Exit conditions
- `PASS`: reviewer verdict approved.
- `FAIL`: correction budget exhausted.

#### State updates
- Increment `correctionCycles.review` per rejected cycle.
- Persist review artifact path and top findings summary.
- Timestamp verdict transitions.

### RECONCILE stage

#### Purpose
Bring living docs and state in sync with actual delivered behavior for the phase.

#### Skill/action to run
- Run `/kiln:reconcile` to produce documentation reconciliation outputs.

#### Required outputs
- Updates to `.kiln/docs/*` as needed.
- `.kiln/tracks/phase-N/reconcile.md` with change log and unresolved doc debt.
- Proposed state transition to mark phase complete.

#### Operator gate
- Present reconcile changes for explicit operator confirmation.
- Do not finalize phase completion without confirmation.

#### Exit conditions
- `PASS`: operator confirms reconcile outputs and no unresolved blocking doc issues.
- `FAIL`: reconcile artifact missing, invalid, or operator declines changes pending edits.

#### State updates
- On pass, mark phase `complete`, clear `currentStep`, and select next incomplete phase.
- On no remaining phases, set `currentStep: final-integration-e2e`.
- Always append transition timestamps and operator confirmation note.

## Pause Conditions
Pause the track loop under these exact conditions:

1. After `RECONCILE`, pause for operator confirmation of living-doc changes.
2. On any `HALT` where correction budget is exhausted (mini-verify, E2E, or review).
3. On plan validation failure after 2 re-plan attempts for the same phase.
4. If the operator types `pause`, stop after the current step completes and persist resumable state.

Pause behavior contract:
- Persist `.kiln/STATE.md` before responding to operator.
- Report current phase, current step, counters, and next required action.
- Resume only when operator explicitly requests continuation.

## Final Integration E2E
Final Integration E2E is a terminal project gate that runs only after all roadmap phases are complete.

Trigger conditions:
- Every phase listed in `.kiln/ROADMAP.md` is marked `complete` in `.kiln/STATE.md`.
- No phase is in `failed` or `in_progress` state.

Required coverage:
- Cross-cutting user journeys spanning multiple phases.
- Full regression suite across all phase-level capabilities.

Correction loop:
- Maximum 3 correction cycles.
- Each failed cycle routes corrections through execute + verification before re-running the final suite.

Terminal outcomes:
- On `PASS`:
  - Generate `.kiln/FINAL_REPORT.md`.
  - Final report must include delivered scope, open risks, test coverage summary, and living-doc status.
  - Mark project state as complete with completion timestamp.
- On `FAIL` after 3 cycles:
  - `HALT` with full context.
  - Record failure artifacts, attempted fixes, and blocking defects.
  - Wait for operator direction.

## State Tracking
`/kiln:track` relies on `.kiln/STATE.md` as the single source of truth for loop progress.

Required fields:
- `currentPhase`
- `currentStep`
- `correctionCycles` with counters for `e2e`, `review`, and `miniVerify`
- Phase progress table with status for each roadmap phase
- Transition timestamps for every step and phase change

Recommended state structure:

```yaml
currentPhase: phase-2
currentStep: execute
correctionCycles:
  miniVerify: 1
  e2e: 0
  review: 0
phaseProgress:
  - phase: phase-1
    title: Authentication Baseline
    status: complete
    startedAt: 2026-02-14T08:00:00Z
    completedAt: 2026-02-14T10:00:00Z
  - phase: phase-2
    title: Billing and Entitlements
    status: in_progress
    startedAt: 2026-02-14T10:05:00Z
    completedAt: null
transitionLog:
  - at: 2026-02-14T10:05:00Z
    from: phase-1/reconcile
    to: phase-2/plan
    result: pass
```

Phase progress requirements:
- Include every roadmap phase, even those not started yet.
- Allowed statuses: `pending`, `in_progress`, `complete`, `failed`.
- Keep phase ordering identical to `ROADMAP.md`.

Transition timestamp requirements:
- Write an ISO 8601 UTC timestamp for each transition.
- Record both successful and failed transitions.
- Include the artifact path that informed each gate decision when available.

Counter requirements:
- Counters reset when moving to a new phase.
- Counters do not reset within correction cycles of the same phase.
- Counters must survive process interruptions and resume safely.

State integrity rules:
- Never advance `currentStep` without writing state.
- Never mark phase complete before reconcile confirmation.
- Never start Final Integration E2E until all phases are complete.
- On inconsistency between roadmap and state, pause and escalate to operator.

This contract is normative for `/kiln:track`. If a subagent output conflicts with this skill, follow this skill's sequencing and gate rules, then request corrected subagent output as needed.
