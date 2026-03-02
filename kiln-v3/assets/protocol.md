# Kiln v3 Orchestration Protocol

This protocol defines Kiln v3 as a thin dispatcher over Claude Code native teams.

## Core Model

- Kiln orchestrates lifecycle only: spawn, monitor, gates, merge, checkpoint, signal.
- Work artifacts move through files, never coordinator summaries.
- Persistent minds survive across stages and update only their owned files.
- Context resets are handled by team lifecycle. Never use `/compact`.

## Pipeline Order

- Brownfield: Init -> Codebase Mapping -> Brainstorm -> Research -> Architecture -> Implementation Loop -> Deployment -> Presentation
- Greenfield: Init -> Brainstorm -> Research -> Architecture -> Implementation Loop -> Deployment -> Presentation

## Stage Contracts

### Stage 0: Init

- Team: `Coordinator`
- Outputs: `.kiln/config.json`, `.kiln/STATE.md`
- Select autonomy level: `supervised | guided | autonomous`
- Detect project mode: `greenfield | brownfield`

### Stage 0.5: Codebase Mapping (brownfield only)

- Team: `Coordinator`, `Clio`, `Urania`, `Melpomene`, optional `Calliope`, optional `Terpsichore`
- Pattern: parallel observers -> coordinator synthesis
- Outputs: `codebase-snapshot.md`, `tech-stack.md`, `decisions.md`, `pitfalls.md`, `PATTERNS.md`
- Birth events:
  - Architect seeded from architecture + stack + decisions
  - Sentinel seeded from pitfalls + patterns + quality findings

### Stage 1: Brainstorm

- Team: `Brainstormer` (+ optional feasibility researcher)
- Operator interacts directly with Brainstormer.
- Coordinator performs one handoff message, then enters silent watch mode.
- Silent watch defaults: timeout `20m`, max nudges `3`.
- Coordinator never relays brainstorm content.
- Output: `VISION.md` (immutable after approval)
- Birth event: Visionary seeded from approved `VISION.md`

### Stage 2: Research

- Team: `Coordinator`, `Researcher-1..N`, `Architect`, `Visionary`
- Dynamic N from `VISION.md` complexity:
  - score = feature(1-3) + integration(0-3) + risk(0-3) + unknowns(0-2)
  - N = clamp(ceil(score / 2), 1, 5)
- Researchers read `VISION.md` directly and each writes one owned file.
- Coordinator performs mechanical lossless merge only:
  - `cat research-*.md > research-findings.md`
- Persistent minds process merged findings:
  - Architect updates `tech-stack.md`, `decisions.md`
  - Visionary updates `vision-notes.md`

### Stage 3: Architecture & Roadmap

- Team: `Coordinator`, `Visionary`, `Architect`, `Confucius`, `Sun Tzu`, `Plato`, `Athena`
- No coordinator content relay.
- Step 1 perspectives (parallel):
  - Visionary reads `vision-notes.md` -> writes `vision-priorities.md`
  - Architect reads `architecture.md`, `decisions.md`, `tech-stack.md` -> writes `arch-constraints.md`
- Step 2 dual planning (parallel):
  - Confucius + Sun Tzu both read raw perspective files and write separate plans.
- Step 3 synthesis + validation:
  - Plato writes `master-plan.md`
  - Athena validates against `VISION.md` + architecture constraints.
- Validation fail path is learning path:
  - `validation-failure.md` written
  - Visionary and Architect update perspective files
  - planners retry with enriched context
- `master-plan.md` is high-level roadmap only (no detailed per-task decomposition).

### Stage 4: Implementation (per phase)

- Team: `Coordinator`, `Architect`, `Sentinel`, `Scheherazade`, `Worker-1..M`, `Sphinx`
- JIT planning at phase start:
  - Scheherazade reads current codebase + phase section + constraints + patterns/pitfalls
  - Writes `phase-plan-NN.md` + task prompts
- Native task management:
  - Use TaskCreate with `blockedBy`
  - Workers self-assign from TaskList when unblocked
- Direct loop (no coordinator relay):
  - Worker <-> Architect
  - Worker <-> Sentinel
  - Worker -> Reviewer
  - Reviewer -> Sharpener
  - Sharpener -> Worker
- Phase completion:
  - Merge worktrees
  - Integration tests
  - Sentinel updates `PATTERNS.md`, `pitfalls.md`
  - Architect updates `decisions.md`
  - Git checkpoint and `master-plan.md` status update happen here (after implementation)

### Stage 5: Milestone Testing

- Team: `Coordinator`, `Tester`, `Sentinel`, `Visionary`, `Architect`
- Tester owns test-plan generation:
  - Reads `phase-plan-NN.md` + current codebase
  - Writes `milestone-test-plan.md`
  - Executes and writes `test-results.md`
- Persistent minds advise tester directly (no coordinator relay).
- Failures loop back to Stage 4 with `test-results.md` as input.
- No separate bug-fix team. Reuse Stage 4 machinery.
- Max 3 fix loops before operator escalation.

### Stage 6: Deployment

- Team: `Coordinator`, `Architect`
- Output: deployment report + release metadata.

### Stage 7: Presentation

- Team: `Coordinator`
- Output: final project report and handoff summary.

## Autonomy Gates

Init selects one level for all gates.

- `supervised`: explicit operator approval required.
- `guided`: operator notified; auto-continue unless stopped.
- `autonomous`: auto-continue and report asynchronously.

Gates:

- `master-plan.md` approval
- phase-plan approval (before each Stage 4)
- code-review gate in implementation cycle
- deployment approval

## Persistent Minds

- Visionary owns: `VISION.md`, `vision-notes.md`, `vision-priorities.md`
- Architect owns: `architecture.md`, `tech-stack.md`, `decisions.md`, `arch-constraints.md`
- Sentinel owns: `PATTERNS.md`, `pitfalls.md`

Ownership rules:

- 1 file = 1 owner
- 1 owner = N files
- no cross-owner edits

## Native Team + Task Features

- One team lifecycle per run. Spawn-work-serialize-despawn cycles are phase scoped.
- Prefer shared task graph and dependency metadata over coordinator micromanagement.
- Use direct mentions (`@teammate`) for collaboration loops.
- Coordinator remains infrastructure-only.

## Hard Rules

- Never use `/compact`.
- Never route content through coordinator summaries.
- Never modify another persistent mind's files.
- Never create a separate bug-fix team.
- Always checkpoint after Stage 4 changes, not after Stage 3 planning.
