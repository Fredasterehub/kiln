---
name: kiln-plan
description: Planning format specification — task packet format, atomization rules, wave grouping, 7-dimension validation criteria
---

# Kiln Plan — Format Specification

## Plan File Format

All plan files (plan_claude.md, plan_codex.md, PLAN.md) follow this structure:

```markdown
# Plan: Phase N — <Phase Title>

## Context
- Vision: <1-2 sentence summary of relevant VISION.md acceptance criteria for this phase>
- Codebase: <summary of what exists now — key files, patterns, dependencies>
- Living docs: <relevant constraints from TECH_STACK, PATTERNS, DECISIONS, PITFALLS>

## Task Packets

### Task P<N>-T<M>: <Task Title>

**Goal:** <1-2 sentences — what this task accomplishes>

**Acceptance Criteria:**
- AC-01: <specific, testable criterion>
- AC-02: <specific, testable criterion>

**Files:**
- `path/to/file.ext` (add|modify|delete) — <why>

**Dependencies:** [P<N>-T<X>, ...] or 'none'

**Wave:** <wave number>

**Estimated Scope:** ~<N> lines changed, <M> files touched

**Implementation Notes:**
<Specific guidance: what patterns to follow, what to import, what edge cases to handle. Reference actual file paths and function signatures from the current codebase.>

---

### Task P<N>-T<M+1>: <Next Task>
...

## Wave Summary

| Wave | Tasks | Can Parallelize |
|------|-------|-----------------|
| 1 | P<N>-T01, P<N>-T02 | Yes (independent) |
| 2 | P<N>-T03 | No (depends on Wave 1) |
| 3 | P<N>-T04, P<N>-T05 | Yes (independent) |
```

Task IDs use the format `P<phase_number>-T<task_number>` (e.g., P3-T01 for
Phase 3, Task 1). This distinguishes them from build-track task IDs (T01-T01
etc.).

## Task Atomization Rules

Each task packet must be atomic — a fresh subagent with zero prior context can
execute it independently.

**Size constraints:**
- **1-5 files per task.** If a task touches more than 5 files, split it.
- **One clear goal.** Each task does ONE thing. 'Add user model AND
  authentication middleware' is two tasks.
- **~50% context target.** The task packet + codebase reading should consume
  ~50% of a 200k-token context. Leave room for tool output and reasoning.
- **Estimated scope:** Include a line-count estimate. If >300 lines of changes,
  consider splitting.

**Self-containment rules:**
- Every task must include enough context for a fresh agent: which files to read,
  what patterns to follow, what the expected output looks like.
- Implementation Notes must reference REAL file paths and function signatures
  from the current codebase (as read during planning), not hypothetical ones.
- Dependencies must be explicit. If Task 3 creates a function that Task 5 calls,
  Task 5 must list Task 3 as a dependency.

**Acceptance criteria rules:**
- Each AC must be independently testable — either by running a command
  (deterministic) or by inspecting the code (LLM judgment).
- Mark each AC as `(DET)` for deterministic or `(LLM)` for judgment-based.
- Prefer deterministic criteria: 'tests pass', 'file exists', 'JSON validates'
  over 'code is clean'.
- Each AC must trace back to a VISION.md success criterion or a phase-level goal.

**What makes a bad task packet:**
- 'Implement the feature' — too vague, no AC, no file hints
- 'Fix everything' — no clear scope, unbounded
- Goal says one thing, AC says another — misalignment
- Dependencies not listed — subagent will reference files that don't exist yet
- Implementation Notes say 'follow best practices' — not specific enough

## Wave Grouping

Tasks within the same wave execute concurrently as independent subagents. Tasks
in later waves wait for all earlier waves to complete.

**Rules for wave assignment:**
1. **Wave 1:** Tasks with no dependencies (foundation tasks — models, schemas, configs).
2. **Subsequent waves:** Tasks whose dependencies are all in earlier waves.
3. **Same-wave safety:** Two tasks can be in the same wave ONLY if they are truly
   independent — they don't read each other's output files, they don't modify
   the same files, and neither depends on the other's side effects.

**Parallelism limits:**
- Maximum tasks per wave: read from `.kiln/config.json` `preferences.waveParallelism` (default: 3).
- If more independent tasks exist than the parallelism limit allows, split into sub-waves.

**Example wave assignment:**
```
Phase: 'Add authentication'
  Wave 1: P3-T01 (User model), P3-T02 (Auth config)     — independent foundation
  Wave 2: P3-T03 (Auth middleware)                        — needs User model from Wave 1
  Wave 3: P3-T04 (Login route), P3-T05 (Register route)  — need middleware from Wave 2
  Wave 4: P3-T06 (Protected route decorator)              — needs routes from Wave 3
```

## 7-Dimension Validation

The plan validator checks the plan against these 7 dimensions. ALL must pass
for the plan to proceed to execution. Each dimension has specific pass/fail
criteria.

### Dimension 1: Requirement Coverage

**Question:**
Does the plan address ALL acceptance criteria from VISION.md for this phase?

**Pass:**
Every success criterion (SC-NN) assigned to this phase in the roadmap has at
least one task whose AC traces back to it. No orphaned requirements.

**Fail:**
One or more success criteria have no corresponding task. Report which SC-NNs
are uncovered.

### Dimension 2: Task Completeness

**Question:**
Is each task self-contained with a clear goal and testable AC?

**Pass:**
Every task has: a goal (1-2 sentences), at least 1 AC marked (DET) or (LLM),
file hints, implementation notes referencing real paths.

**Fail:**
One or more tasks are missing required fields, have vague goals ('improve code'),
or have untestable AC ('make it better'). Report which tasks fail and why.

### Dimension 3: Dependency Correctness

**Question:**
Does task ordering make sense? Are wave groupings safe?

**Pass:**
No circular dependencies. Every dependency reference points to an existing task.
No two tasks in the same wave modify the same file. No task depends on a task in
a later wave.

**Fail:**
Circular dependency detected, or missing dependency reference, or same-wave
conflict. Report the specific issue.

### Dimension 4: Scope Sanity

**Question:**
Is the plan appropriately scoped — not too ambitious, not too minimal?

**Pass:**
Total estimated scope is reasonable for the phase description (heuristic: 3-10
tasks per phase, 50-500 total lines changed). No single task exceeds ~300 lines.
Phase doesn't try to do more than the roadmap description implies.

**Fail:**
Phase has >15 tasks (probably over-scoped) or <2 tasks (probably under-scoped).
Or a single task is massive (>500 lines). Report the issue.

### Dimension 5: Context Budget

**Question:**
Are tasks sized for a fresh 200k-token subagent?

**Pass:**
Each task touches 1-5 files. Implementation Notes + file reading would consume
~50% of context (heuristic: if the files listed total >5000 lines, the task is
too big). No task requires reading the entire codebase.

**Fail:**
A task touches >5 files, or the files it references are too large for a single
context. Report which tasks exceed budget.

### Dimension 6: Verification Derivation

**Question:**
Is every acceptance criterion testable or verifiable?

**Pass:**
Every AC can be verified by either: (a) running a command that produces
pass/fail, or (b) inspecting specific code for a specific property. Every (DET)
AC has a concrete command. Every (LLM) AC has a specific inspection target.

**Fail:**
An AC is unmeasurable ('code is good'), untestable ('performance is acceptable'
without a threshold), or unverifiable. Report which ACs fail.

### Dimension 7: Living Doc Compliance

**Question:**
Does the plan respect the current state of TECH_STACK, PATTERNS, DECISIONS, and
PITFALLS?

**Pass:**
The plan uses the project's established technology choices (from TECH_STACK),
follows documented patterns (from PATTERNS), respects recorded decisions (from
DECISIONS), and avoids known pitfalls (from PITFALLS). If living docs are empty
(Phase 1), this dimension auto-passes.

**Fail:**
Plan introduces a technology not in TECH_STACK without justification, violates
a documented pattern, contradicts a recorded decision, or repeats a known
pitfall. Report the specific conflict.

**Sentinel output format:**
```yaml
sentinel: plan-validation-result
status: pass | fail
timestamp: <ISO 8601>
details:
  dimensions_checked: 7
  dimensions_passed: <N>
  failures:
    - dimension: <name>
      reason: <specific feedback>
```

## Claude-Only Mode

When `.kiln/config.json` has `modelMode: 'claude-only'`:

1. **Skip codex-planner:** Only Planner A (Opus) runs. Output goes to `.kiln/tracks/phase-N/plan_claude.md`.
2. **Skip synthesizer:** The Opus plan IS the master plan. Copy/rename it to `.kiln/tracks/phase-N/PLAN.md`.
3. **Validator runs normally:** The 7-dimension check applies regardless of how many models produced the plan.
4. **Format is identical:** plan_claude.md in Claude-only mode uses exactly the
   same task packet format as PLAN.md in multi-model mode. Downstream execution
   doesn't know or care whether synthesis happened.

The orchestrator handles this branching — the planner agent itself always
produces the same format.
