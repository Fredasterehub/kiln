---
name: kiln-core
description: "Universal invariants and coordination contracts for the kiln workflow"
---

## .kiln/ Directory Structure

```
.kiln/
  config.json              # Project config (model mode, tooling, preferences)
  VISION.md                # Locked brainstorm output (operator-approved)
  ROADMAP.md               # Phase breakdown from planner
  STATE.md                 # Persistent progress tracker
  FINAL_REPORT.md          # End-of-project summary
  docs/
    TECH_STACK.md           # Detected/chosen technology stack
    PATTERNS.md             # Codebase patterns and conventions
    DECISIONS.md            # ADR-format decision records
    PITFALLS.md             # Known gotchas and workarounds
  tracks/
    phase-N/
      plan_claude.md        # Claude planner output
      plan_codex.md         # Codex planner output
      PLAN.md               # Synthesized plan with task packets
      critique_of_codex_r1.md   # (debate) Claude critiques Codex plan, round 1
      critique_of_claude_r1.md  # (debate) Codex critiques Claude plan, round 1
      plan_claude_v2.md     # (debate) Claude revised plan after round 1
      plan_codex_v2.md      # (debate) Codex revised plan after round 1
      debate_log.md         # (debate) Full audit trail of debate rounds
      e2e-results.md        # E2E verification output
      review.md             # Code review output
      review_codex.md       # (debate) GPT reviewer output
      critique_of_review_codex_r1.md  # (debate) Opus critiques GPT review
      critique_of_review_opus_r1.md   # (debate) GPT critiques Opus review
      review_v2.md          # (debate) Opus revised review after round 1
      review_codex_v2.md    # (debate) GPT revised review after round 1
      reconcile.md          # Documentation reconciliation log
      artifacts/            # Phase-specific generated assets
      sharpened/            # Sharpened implementation prompts, one per task
```

### Path-by-Path Purpose

- `.kiln/`: Root workspace for durable orchestration state and machine-readable workflow artifacts. It is created during `init` and updated throughout every stage.
- `.kiln/config.json`: Canonical runtime configuration (model routing mode, safety defaults, tooling toggles, retry policy). It is written at project initialization and only changed through explicit operator or orchestrator configuration updates. Preferences include:
  - `planStrategy`: `"synthesize"` (default) or `"debate"` — controls whether planners debate before synthesis.
  - `reviewStrategy`: `"single"` (default) or `"debate"` — controls whether a GPT reviewer joins Opus for review debate.
  - `debateRounds`: integer 1-3 (default 2) — maximum critique-revise rounds when debate is active.
  - `executeConcurrency`: reserved field; in v0 the only supported value is `"worktree"`. Orchestrator must validate this at startup and reject unsupported values with a clear error.
- `.kiln/VISION.md`: Locked product vision and non-goal boundary agreed after brainstorm. It is written after brainstorm approval and read by roadmap/planning to prevent scope drift.
- `.kiln/ROADMAP.md`: Phase decomposition that turns vision into sequenced delivery chunks. It is written once roadmap is accepted and may be amended only when the orchestrator re-baselines phases.
- `.kiln/STATE.md`: Continuous progress ledger for current stage, active phase, task states, blockers, and halt reasons. It is updated at each transition boundary and after every task completion/failure.
- `.kiln/FINAL_REPORT.md`: Final synthesis of delivered scope, open risks, known deviations, and evidence references. It is written at closeout after final integration E2E and is read by operators as the completion handoff.

- `.kiln/docs/`: Cross-phase knowledge base containing stable technical reference docs used by implementers and reviewers. It is initialized early and updated during reconcile or when major discoveries require codification.
- `.kiln/docs/TECH_STACK.md`: Source of truth for languages, frameworks, build/test tooling, runtime targets, and version assumptions. It is created during discovery and refreshed whenever implementation introduces or retires core tooling.
- `.kiln/docs/PATTERNS.md`: Repository conventions for architecture style, naming, testing style, and interface boundaries. It is updated when repeated implementation motifs are proven and should be reused.
- `.kiln/docs/DECISIONS.md`: ADR-style decision log with context, chosen option, tradeoffs, and rollback notes. It is appended when decisions materially affect implementation strategy or future maintenance.
- `.kiln/docs/PITFALLS.md`: Catalog of recurring failures, environment traps, flaky tests, and reliable mitigations. It is updated after verification/review expose non-obvious hazards that should not be rediscovered.

- `.kiln/tracks/`: Container for per-phase execution traces, plans, verifications, and reconciliation artifacts. It is created when roadmap introduces phases and is read by orchestrator for progress auditing.
- `.kiln/tracks/phase-N/`: Isolated record for one roadmap phase (`phase-1`, `phase-2`, etc.) to avoid cross-phase ambiguity. It is created when phase execution begins and remains immutable except for in-phase updates.
- `.kiln/tracks/phase-N/plan_claude.md`: Planner output from Claude-side planning lane. It is written when Planner A runs and used as an input candidate to synthesis/validation.
- `.kiln/tracks/phase-N/plan_codex.md`: Planner output from Codex-side planning lane in multi-model mode. It is written when Planner B runs and omitted in Claude-only mode.
- `.kiln/tracks/phase-N/PLAN.md`: Synthesized executable plan with task packets, acceptance criteria, dependencies, and rollback notes. It is written after planning synthesis and becomes the only execution plan for that phase.
- `.kiln/tracks/phase-N/e2e-results.md`: End-to-end verification evidence with pass/fail status, environment, commands, and defect links. It is written after each E2E cycle and finalized when E2E gates pass.
- `.kiln/tracks/phase-N/review.md`: Code review findings, severity tags, requested corrections, and final verdict. It is written in review stage and updated across correction cycles until pass or halt.
- `.kiln/tracks/phase-N/reconcile.md`: Documentation reconciliation log mapping implementation changes to docs updates and unresolved doc debt. It is written during reconcile and consulted before advancing phases.
- `.kiln/tracks/phase-N/artifacts/`: Phase-scoped storage for generated evidence such as logs, traces, diff snapshots, benchmark outputs, or exported reports. It is written whenever stage output is too large for Markdown summary files.
- `.kiln/tracks/phase-N/sharpened/`: Per-task sharpened implementation prompts generated by the sharpener agent, written during execute stage, consumed by the executor, with one file per task ID. In Teams mode (`preferences.useTeams: true`), sharpened prompts are written to `.kiln/tracks/phase-N/artifacts/<plan-task-id>/sharpened.md` instead (inside the worker's allowed write scope).

### Artifact Namespacing Rules

To prevent collisions under parallel task execution, artifact paths under a phase are namespaced by task ID.

- Required per-task namespace: `.kiln/tracks/phase-N/artifacts/<plan-task-id>/...`
- `<plan-task-id>` must match the canonical task ID from `PLAN.md` (for example `P1-T04`). In both Teams and non-Teams modes, the plan task ID is the artifact namespace key — not the Teams task_id (which is used for orchestration only).
- A writer must only write inside its own `<plan-task-id>/` subtree.
- Shared phase-level artifacts (outside any `<plan-task-id>/` subtree) are allowed when produced by orchestrator-owned stages or by stage agents during error escalation (for example synthesized summaries, review escalation context).
- Optional per-wave sub-namespace (when worktree waves are active): `.kiln/tracks/phase-N/artifacts/<plan-task-id>/wave-<wave-id>/...`
- If per-wave namespace is used, final task evidence references must point to the canonical task path and include the wave subpath.

## Model Routing Table

| Role | Multi-Model Assignment | Claude-Only Assignment |
| --- | --- | --- |
| Orchestrator | Opus 4.6 | Opus 4.6 |
| Brainstormer | Opus 4.6 | Opus 4.6 |
| Vision Challenger | GPT-5.2-high (Codex CLI) | skipped |
| Vision Synthesizer | Opus 4.6 | skipped |
| Planner A | Opus 4.6 | Opus 4.6 |
| Planner B | GPT-5.2-high (Codex CLI) | skipped |
| Plan Synthesizer | Opus 4.6 | skipped |
| Plan Validator | Sonnet | Sonnet |
| Sharpener | GPT-5.2-high (Codex CLI) | Opus 4.6 |
| Implementer | GPT-5.3-codex-high (Codex CLI) | Sonnet |
| E2E Verifier | Sonnet | Sonnet |
| Reviewer | Opus 4.6 | Opus 4.6 |
| Codex Reviewer | GPT-5.3-codex-sparks (Codex CLI) | skipped |
| Researcher | Haiku | Haiku |

## Claude-Only Fallback Rules

- Skip challenge pass (single-perspective brainstorm)
- Skip Planner B and synthesis (single Opus plan)
- Skip plan debate (no competing plan to debate)
- Skip review debate (no Codex Reviewer available)
- Opus sharpens for Sonnet instead of GPT-5.2 for Codex
- Sonnet implements instead of GPT-5.3-codex
- Pipeline shape stays the same; only model assignments change
- Debate preferences in config.json are ignored in claude-only mode

### What "Shape Stays the Same" Means

- The same stage sequence still runs: brainstorm, roadmap, per-phase plan/validate/execute/e2e/review/reconcile, then final integration E2E.
- The same gate files still exist and are expected by automation (`VISION.md`, `PLAN.md`, `e2e-results.md`, `review.md`).
- The same retry ceilings still apply (mini-verify, E2E cycles, review cycles).
- The same halt behavior still triggers when correction budgets are exhausted.
- The same operator approval gate after brainstorm remains mandatory.

### Concrete Examples

- Example A: In multi-model mode, brainstorm includes challenge + synthesis; in Claude-only mode, brainstorm writes `VISION.md` directly, but the orchestrator still waits for operator approval before roadmap.
- Example B: In multi-model mode, both `plan_claude.md` and `plan_codex.md` may be produced before synthesis; in Claude-only mode only `plan_claude.md` is produced, but validation and execution still consume a single `PLAN.md` contract.
- Example C: In multi-model mode, GPT-5.3-codex executes tasks and Sonnet verifies E2E; in Claude-only mode Sonnet executes, yet E2E outputs are still written to `.kiln/tracks/phase-N/e2e-results.md` with unchanged schema.
- Example D: In both modes, review findings can trigger correction loops, and reconcile cannot start until review either passes or halts.
- Example E: In both modes, final integration E2E is a separate terminal gate, not merged into per-phase E2E.

## Output Format Contracts

### Read/Write Matrix

| Agent | Reads | Write Contract (verbatim) |
| --- | --- | --- |
| Brainstormer | `.kiln/config.json`, existing problem statement, prior constraints, operator notes | Brainstormer writes: .kiln/VISION.md, .kiln/tracks/phase-N/vision_critique.md |
| Planner | `.kiln/VISION.md`, `.kiln/ROADMAP.md`, `.kiln/docs/TECH_STACK.md`, prior phase outcomes | Planner writes: .kiln/tracks/phase-N/plan_claude.md or plan_codex.md |
| Synthesizer | `.kiln/tracks/phase-N/plan_claude.md`, `.kiln/tracks/phase-N/plan_codex.md` (if present), validator notes | Synthesizer writes: .kiln/tracks/phase-N/PLAN.md |
| Executor | `.kiln/tracks/phase-N/PLAN.md`, codebase, tests, patterns and decision docs | Executor writes: source code + atomic git commit (non-Teams mode). In Teams mode, wave workers write source code in their assigned worktrees plus task-namespaced artifacts; orchestrator performs integration and creates the atomic git commit on main. |
| E2E Verifier | `.kiln/tracks/phase-N/PLAN.md`, changed code paths, environment setup docs | E2E Verifier writes: .kiln/tracks/phase-N/e2e-results.md, tests/e2e/ |
| Reviewer | PR diff or working tree diff, `.kiln/tracks/phase-N/e2e-results.md`, acceptance criteria | Reviewer writes: .kiln/tracks/phase-N/review.md |
| Codex Reviewer | PR diff or working tree diff, `.kiln/tracks/phase-N/e2e-results.md`, acceptance criteria | Codex Reviewer writes: .kiln/tracks/phase-N/review_codex.md |
| Reconciler | `.kiln/tracks/phase-N/review.md`, merged changes, existing `.kiln/docs/*` docs | Reconciler writes: .kiln/docs/* updates, .kiln/tracks/phase-N/reconcile.md |

### Teams Coordination

For detailed Teams behavior and orchestration semantics, `skills/kiln-teams/kiln-teams.md` is the canonical contract. This core document defines cross-mode invariants that must hold in both sequential and Teams execution.

- Single control-plane writer: only orchestrator writes `.kiln/STATE.md`.
- In Teams mode, workers must not edit `.kiln/STATE.md` or other shared control-plane files under `.kiln/**`.
- Worker write scope depends on stage:
  - EXECUTE workers (worktrees): `.kiln/tracks/phase-N/artifacts/<plan-task-id>/...` only, plus source changes in their assigned worktree.
  - PLAN teammates (primary workspace): designated planning outputs under `.kiln/tracks/phase-N/` (for example `plan_claude.md`, `plan_codex.md`, `PLAN.md`, critique/revision debate artifacts, validation sentinel outputs).
  - REVIEW teammates (primary workspace): designated review outputs under `.kiln/tracks/phase-N/` (for example `review.md`, `review_codex.md`, critiques, revisions, `debate_log.md` when review-stage debate logging is delegated).
- Shared phase documents (for example `PLAN.md`, `review.md`, `e2e-results.md`, `reconcile.md`) remain orchestrator-owned writes unless a stage contract explicitly delegates generation.
- The one atomic commit per task invariant remains required; commit authoring responsibility is mode-dependent:
  - Non-Teams mode: executor creates task commit directly.
  - Teams mode: orchestrator integrates worker results and creates the task commit on main.
- For full stage-scoped write policy details and conflict resolution, defer to `skills/kiln-teams/kiln-teams.md`.

### Atomic Git Commit Definition

- One commit maps to one coherent task packet from `PLAN.md` with a clear objective boundary.
- The commit contains exactly the minimal code/docs/tests needed to satisfy that packet.
- The commit message identifies phase and task ID (for example: `phase-2/P2-T04: add retryable webhook verifier`).
- The commit passes relevant local checks specified by the task acceptance criteria.
- The commit can be reverted without breaking unrelated completed tasks.
- Mixed concerns (feature + unrelated refactor + docs cleanup) are not atomic.
- Fixup commits are allowed during development but should be squashed into the task-level atomic result before handoff.

### TaskUpdate Payload Schema

The canonical `TaskUpdate` payload schema is defined in `skills/kiln-teams/kiln-teams.md` § TaskUpdate Payload Contract. That document is the single source of truth for required keys, status enum values, idempotency rules, and ordering semantics.

Core invariants (duplicated here for quick reference — defer to kiln-teams on any conflict):

- Every update must include `task_id`, `phase`, `status`, and `emitted_at`.
- `evidence_paths` must be inside the plan-task namespace: `.kiln/tracks/phase-N/artifacts/<plan-task-id>/`.
- `idempotency_key` must be stable for logically identical updates; orchestrator treats duplicates as no-ops.
- `sequence` must be monotonic per `task_id`; out-of-order updates are discarded.
- Status transitions follow the enum in kiln-teams; non-Teams (sequential) mode uses the subset: `queued | in_progress | done | failed`.

### Acceptable `tests/e2e/` Artifacts

- Executable E2E specs that run in CI or documented local runner.
- Test fixtures and stable mock data required only for E2E scenarios.
- Harness utilities (setup/teardown, deterministic test helpers) scoped to E2E.
- Environment manifests for E2E (for example `.env.example.e2e`, docker compose snippets).
- Generated reports only when they are reproducible and ignored/managed appropriately.
- Snapshot artifacts only if they are deterministic and reviewed for signal value.
- Non-deterministic binaries, machine-specific paths, and one-off debug dumps are not acceptable as permanent artifacts.

## Sentinel Schema Format

Sentinel blocks are YAML-in-Markdown markers intended for machine parsing, gate checks, and automation triggers.
They must remain strict YAML, avoid tabs, and keep keys stable across phases.
Use one sentinel block per decision event to avoid ambiguous parser behavior.

```yaml
sentinel: plan-validation-result
status: pass|fail
details: ...
```

### Sentinel Types

- `plan-validation-result`
- `e2e-result`
- `review-verdict`
- `task-status`

### Key Rules

- Required keys must always be present, even when value is `null`.
- Recommended keys improve observability and should be included whenever available.
- `status` values should be from a small controlled set (`pass`, `fail`, `blocked`, `in_progress`, `done`).
- Timestamps should use ISO 8601 UTC (`2026-02-14T12:34:56Z`).
- Arrays should be used for multi-item diagnostics rather than delimited strings.

### Type Contracts

#### `plan-validation-result`

- Required keys: `sentinel`, `phase`, `status`, `validator`, `plan_path`, `checks`.
- Recommended keys: `blocking_issues`, `warnings`, `next_action`, `timestamp`, `related_artifacts`.
- `checks` should be a YAML list of named checks with boolean outcomes.

#### `e2e-result`

- Required keys: `sentinel`, `phase`, `status`, `suite`, `environment`, `summary`, `timestamp`.
- Recommended keys: `failed_tests`, `flaky_tests`, `run_command`, `duration_seconds`, `artifacts`.
- `summary` should be concise and paired with detailed logs in phase artifacts.

#### `review-verdict`

- Required keys: `sentinel`, `phase`, `status`, `reviewer`, `severity_high`, `severity_medium`, `severity_low`.
- Recommended keys: `must_fix`, `should_fix`, `notes`, `timestamp`, `diff_ref`.
- Severity counts should be numeric for deterministic gating.

#### `task-status`

- Required keys: `sentinel`, `phase`, `task_id`, `status`, `owner`, `timestamp`.
- Recommended keys: `started_at`, `completed_at`, `dependencies`, `blocked_by`, `evidence_paths`.
- `status` should track lifecycle transitions (`queued`, `in_progress`, `done`, `blocked`, `halted`).

#### `debate-round`

- Required keys: `sentinel`, `phase`, `stage` (`plan` or `review`), `round`, `status` (`complete`, `converged`, `failed`).
- Recommended keys: `claude_critique_path`, `codex_critique_path`, `claude_revision_path`, `codex_revision_path`, `convergence_reason`, `timestamp`.
- Used to track debate round completion and convergence detection.

## Context Budget Rules

- Orchestrator stays under ~15% of context
- Each task gets a fresh 200k-token subagent
- Task packets are self-contained: goal, AC, file hints, dependencies
- No cross-task context leakage

### Practical Budgeting Guidance

- Orchestrator prompts should include only phase-level summaries and current gate state.
- Deep implementation details should live in task packets, not orchestrator memory.
- Subagents should start with only packet inputs plus minimal repo context needed to act.
- Long logs should be summarized with links/paths, not pasted in full.
- Repeated policy text should be referenced once and reused by pointer.

### Cross-Task Context Leakage: Do / Don't

- Do: Pass Task B only the finalized outputs Task B explicitly depends on (for example API contract file and migration ID).
- Do: Reference shared conventions via `.kiln/docs/PATTERNS.md` instead of copying full Task A discussion threads.
- Do: Include concise dependency summaries in each packet when dependencies are mandatory.
- Don't: Paste Task A's full debugging transcript into Task B prompt when only one interface decision matters.
- Don't: Carry speculative ideas from failed tasks into unrelated tasks without explicit validation.
- Don't: Reuse transient secrets, local paths, or machine-specific assumptions from one task packet to another.

### Self-Contained Task Packet Checklist

- Goal statement with measurable outcome.
- Acceptance criteria with executable verification steps.
- File hints listing expected touch points.
- Dependency list with required upstream artifacts.
- Out-of-scope list to prevent accidental expansion.
- Rollback notes for risky operations.

### Budget Enforcement Signals

- If packet context grows beyond practical limits, split task before execution.
- If a subagent requests unrelated prior-task logs, orchestrator should redact and provide summary.
- If repeated clarifications exceed two rounds, update packet template instead of inflating prompts.

## Error Escalation Protocol

- Mini-verify: max 2 retries per task, then halt
- E2E verification: max 3 correction cycles, then halt
- Code review: max 3 correction cycles, then halt
- On halt: save full error context to .kiln/tracks/phase-N/, report to operator with actionable summary

### Full Error Context Requirements

Full error context must include enough data for another engineer to reproduce, diagnose, and continue without reopening prior chat history.
Every halt should produce structured artifacts under the current phase folder.

### Required Evidence Set

- `commands-run.md`: exact commands, working directory, and environment variables used (with secrets redacted).
- `logs/` files: raw stdout/stderr for failing commands, grouped by attempt number.
- `diff.patch`: code diff at halt time including uncommitted changes relevant to failure.
- `repro-steps.md`: deterministic reproduction procedure from clean checkout.
- `attempt-history.md`: each retry/correction cycle with timestamp and outcome.
- `hypotheses.md`: ranked suspected root causes and disproof steps already attempted.
- `gate-status.yaml`: machine-readable halt sentinel with cycle counts and blocking gate.

### Placement Convention

- Store narrative summaries in `.kiln/tracks/phase-N/review.md` or `.kiln/tracks/phase-N/e2e-results.md` according to failing gate.
- Store bulky logs and patches in `.kiln/tracks/phase-N/artifacts/` with stable filenames.
- Store reproduction and command docs at `.kiln/tracks/phase-N/` root for quick operator access.
- Link every artifact path from the relevant gate file to avoid orphan evidence.

### Actionable Halt Summary Template

- Failure gate and cycle count at stop.
- Most likely root cause in one sentence.
- Impacted acceptance criteria and user-visible risk.
- Smallest next action that can unblock work.
- Required operator decision (for example scope cut, dependency approval, environment fix).

### Escalation Discipline

- Do not continue coding after retry budget is exhausted.
- Do not delete failed-attempt artifacts, even if superseded.
- If two gates fail concurrently, escalate the earliest blocking gate first.
- If a halt is caused by missing external access, mark as `blocked` not `fail`.

## Stage Transitions

Canonical pipeline order:
`init -> brainstorm -> roadmap -> track loop (plan -> validate -> execute -> e2e -> review -> reconcile) -> final integration E2E`

- Only the orchestrator advances stages
- Hard gate after brainstorm (operator approval required)

### Transition Invariants

| Transition | Required Inputs Before Move | Outputs Produced By Transition |
| --- | --- | --- |
| `init -> brainstorm` | Repository available, `.kiln/config.json` initialized, operator objective captured | Brainstorm packet and constraints assembled |
| `brainstorm -> roadmap` | `.kiln/VISION.md` exists, operator approval recorded, non-goals documented | `.kiln/ROADMAP.md` with phased delivery boundaries |
| `roadmap -> track loop` | Roadmap has ordered phases, first phase folder created | Active phase state set in `.kiln/STATE.md` |
| `plan -> validate` | Planner outputs exist (`plan_claude.md` and/or `plan_codex.md`), synthesized `PLAN.md` present | Validation result sentinel and go/no-go decision |
| `validate -> execute` | Plan validator status is `pass`, task packets complete | Task execution start markers and implementation changes (commits are produced by executor in non-Teams mode, orchestrator in Teams mode) |
| `execute -> e2e` | Code changes for phase integrated, task-level checks passed | E2E run artifacts and `.kiln/tracks/phase-N/e2e-results.md` updates |
| `e2e -> review` | E2E status is `pass` or explicitly waived by operator with rationale | Review packet with diff and verification context |
| `review -> reconcile` | Review verdict `pass` or accepted risk decision logged | Documentation update list and reconciliation tasks |
| `reconcile -> next phase` | `.kiln/tracks/phase-N/reconcile.md` complete, docs updated, residual risks logged | Next phase activation in `.kiln/STATE.md` |
| `track loop complete -> final integration E2E` | All planned phases completed or deferred with approval, integration branch consistent | Final end-to-end verification across full system |

### Teams Resume/Recovery Algorithm

When Teams mode uses worktree waves, resume must be deterministic and must not require worker edits to control-plane state.

1. Determine worktree root:
   - Use `KILN_WORKTREE_ROOT` if set.
   - Otherwise default to `/tmp`.
2. Collect git worktree truth:
   - Run `git worktree list --porcelain`.
   - Parse each entry into `(path, branch, head, locked, prunable)`.
3. Collect filesystem truth:
   - Scan the worktree root for kiln wave/task directories and marker artifacts.
   - Build candidate records keyed by `(phase, wave_id, task_id)`.
4. Collect control-plane truth:
   - Read `.kiln/STATE.md` (orchestrator-only canonical state).
   - Read current phase `PLAN.md` task list and Teams TaskList state from canonical Teams artifacts (see `skills/kiln-teams/kiln-teams.md`).
5. Reconcile without multi-writer mutation:
   - Join records by `task_id` and prefer explicit TaskList status over inferred filesystem status.
   - Use worktree presence + branch/head + artifact evidence to classify each task deterministically.
     - Teams mode (`preferences.useTeams: true`): use the 5-state classification from `skills/kiln-teams/kiln-teams.md`: `done`, `ready_for_integration`, `in_progress`, `rerun_required`, `orphaned`.
     - Non-Teams mode: `not_started`, `in_progress`, `done`, `blocked`.
   - Mark orphaned worktrees for operator/orchestrator cleanup; do not silently delete.
6. Emit recovery actions (orchestrator):
   - Update TaskList entries first.
   - Update `.kiln/STATE.md` to reflect next deterministic action and blockers.
   - Queue integrate/continue/retry decisions per task in stable order (`phase`, then task order in `PLAN.md`).

Determinism rules:

- Given the same `git worktree list` output, filesystem snapshot, TaskList, and `.kiln/STATE.md`, recovery must produce the same action set.
- If signals conflict, precedence is `orchestrator override > TaskList terminal status > verified evidence paths > worktree existence`.
- Schema stability is preserved: existing `.kiln/STATE.md` and sentinel schemas are unchanged; Teams additions are additive and external to those schemas.

### Gate Discipline

- A stage cannot be advanced by implementers, reviewers, or verifiers directly.
- Any manual override must be written in `.kiln/STATE.md` with operator name and timestamp.
- Missing required inputs force a halt or rollback to previous stage.
- Transition outputs are auditable artifacts, not implicit chat conclusions.

### Stage Completion Signals

- Each stage completion should include at least one sentinel block in its primary output file.
- `.kiln/STATE.md` should record stage entry time, completion time, and gate verdict.
- If completion is partial, status must be `blocked` with explicit blocker ownership.
- Final integration E2E is the only valid terminal quality gate before closeout.

## STATE.md Canonical Schema

The `.kiln/STATE.md` file must use these exact section labels, field labels, and enums.

### Project State

- **Project:** `<string>`
- **Model Mode:** `<string>`
- **Initialized:** `<ISO 8601 timestamp>`

### Phase Progress

| Phase | Title | Status |
| --- | --- | --- |

Status enum: `pending | in-progress | complete | failed`

### Current Track

- **Phase:** `N — Title`
- **Current Step:** `plan | validate | execute | e2e | review | reconcile`
- **Step Status:** `pending | in-progress | complete | failed`
- **Started:** `<ISO 8601 timestamp>`

### Correction Cycles

- **Mini-verify retries (current task):** `N / 2`
- **E2E correction cycles (current track):** `N / 3`
- **Code review correction cycles (current track):** `N / 3`

### Regression Suite

`<count> tests from <count> completed phases`

### Session Recovery

- **Last Activity:** `<ISO 8601 timestamp>`
- **Last Completed Action:** `<string>`
- **Next Expected Action:** `<string>`
