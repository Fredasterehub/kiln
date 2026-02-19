# Kiln Orchestration Protocol

This protocol is active when Kiln is installed in the project. The Claude Code orchestrator must follow these rules exactly. Rules are enforced across all five pipeline stages.

## Paths Contract

All runtime paths must follow this contract:

- `PROJECT_PATH`: absolute path to the active project root.
- `KILN_DIR`: `$PROJECT_PATH/.kiln`.
- `CLAUDE_HOME`: `$HOME/.claude`.
- `MEMORY_DIR`: `$CLAUDE_HOME/projects/$ENCODED_PATH/memory`.
- Claude-side install assets: `$CLAUDE_HOME/kilntwo/...`.

Never use root-relative kiln or claude paths. Always anchor filesystem paths to either `$PROJECT_PATH` (project artifacts) or `$HOME` (Claude memory/install artifacts).

## Pipeline Stages

1. **Stage 1 — Initialization & Brainstorm** (interactive) — The operator interactively describes the project goal. The orchestrator asks clarifying questions until it has a clear picture of scope, constraints, and success criteria. Memory checkpoints are written periodically: `vision.md` captures the project goal, and `MEMORY.md` updates canonical runtime fields (`stage`, `status`, phase fields, `handoff_note`, `last_updated`). The stage ends when the operator explicitly signals readiness to move to planning.

2. **Stage 2 — Planning** (automated with operator review) — The orchestrator spawns both `kiln-planner-claude` and a Codex planner in parallel to produce independent implementation plans. A `kiln-debater` agent then analyzes disagreements between the two plans (debate mode 2 by default unless the operator specified otherwise during Stage 1). A `kiln-synthesizer` agent merges the plans and debate resolution into a single `master-plan.md`. The operator reviews and approves the master plan before Stage 3 begins.

3. **Stage 3 — Execution** (automated, phase by phase) — The orchestrator executes the master plan one phase at a time using the phase executor pattern. Each phase consists of: generating a phase-scoped plan (`$KILN_DIR/plans/phase_plan.md`), generating per-task prompts (`$KILN_DIR/prompts/`), running each Codex task sequentially, and running up to 3 QA review rounds before merging. Phases run sequentially; the orchestrator does not begin a new phase until the prior phase is merged and MEMORY.md is updated.

4. **Stage 4 — Validation** (automated) — After all phases are complete, the orchestrator runs end-to-end validation. Results are written to `$KILN_DIR/validation/report.md`. Any missing credentials or environment variables that blocked tests are recorded in `$KILN_DIR/validation/missing_credentials.md`. If validation fails, the orchestrator identifies the failing phase and re-enters Stage 3 for that phase only.

5. **Stage 5 — Complete & Delivery** (interactive) — The orchestrator produces a final delivery summary for the operator covering: all phases completed, files created or modified, test results, and any known limitations. MEMORY.md is updated with `stage: complete` and `status: complete`. The operator is prompted to review and approve the delivery.

## Orchestration Rules

1. **No /compact** — Never use `/compact`. Context management is handled exclusively through session resets and memory file resumption. Compacting loses tool call history that may be needed for debugging.

2. **Memory files are the single source of truth** — `MEMORY.md`, `vision.md`, `master-plan.md`, `decisions.md`, and `pitfalls.md` define project state. Before starting any stage or phase, read these files. After completing any stage or phase, update canonical runtime fields in `MEMORY.md`: `stage`, `status`, `planning_sub_stage`, phase fields, `handoff_note`, and `last_updated`.

3. **Sub-agent spawning is restricted** — Sub-agents cannot spawn their own sub-agents. Only the phase executor (the top-level orchestrator running Stage 3) may spawn Codex task agents. If a sub-agent needs additional work done, it must return that request to the orchestrator rather than spawning independently.

4. **Phase sizing** — Each phase must represent 1–4 hours of implementation work. Phases that are too large must be split during the planning stage. Phases that are too small may be merged. The synthesizer is responsible for enforcing this during master plan creation.

5. **QA cap** — A maximum of 3 review rounds are allowed per phase. If a phase still fails after 3 rounds, the orchestrator must stop automated execution and escalate to the operator with a summary of what failed and why.

6. **Debate mode default** — Unless the operator explicitly specifies a debate mode during Stage 1, the debater agent runs in mode 2 (Focused). Mode 1 (Skip) and mode 3 (Full) must be explicitly requested.

7. **Git discipline** — Create a feature branch at the start of each phase named `kiln/phase-NN` where NN is the zero-padded phase number. Commit atomically after each task completes. Merge the phase branch to the main branch only after the phase passes QA. Never commit directly to the main branch during automated execution.

8. **No judgment calls during automated execution** — If the orchestrator encounters an ambiguous situation, a missing requirement, a conflicting instruction, or an unexpected error during Stage 3, it must stop and ask the operator rather than guessing. Automated execution resumes only after the operator provides direction.

9. **Agent termination** — Every sub-agent spawned via the Task tool must terminate after completing its assigned task. Agents must write all required output artifacts, return a concise completion summary, and exit immediately. Never resume or reuse a prior agent instance — always spawn a fresh agent for each new task assignment. This ensures clean context boundaries between phases and prevents stale state from bleeding across spawns.

10. **Generous timeouts** — All Codex CLI invocations must use a minimum timeout of 600 seconds. Tasks that involve large codebases, complex reasoning, or file-heavy operations should use 900 seconds or more. Never invoke Codex with default or short timeouts during automated pipeline execution.

## Agent Roster

The Kiln pipeline uses these specialized agents. Each has a character alias used in logs and status output.

| Alias | Internal Name | Role |
|---|---|---|
| **Kiln** | *(orchestrator)* | Top-level session coordinator — runs interactively in Claude Code |
| **Confucius** | kiln-planner-claude | Claude-side implementation planner |
| **Sun Tzu** | kiln-planner-codex | GPT-5.2 planning via Codex CLI |
| **Socrates** | kiln-debater | Plan debate and resolution |
| **Plato** | kiln-synthesizer | Plan synthesis and merge |
| **Scheherazade** | kiln-prompter | Task prompt generation via GPT-5.2 |
| **Codex** | kiln-implementer | Code implementation via GPT-5.3-codex |
| **Sphinx** | kiln-reviewer | Code review and QA gate |
| **Maestro** | kiln-phase-executor | Phase lifecycle coordinator |
| **Argus** | kiln-validator | E2E validation and test runner |
| **Sherlock** | kiln-researcher | Fast documentation and codebase research |

When logging agent activity, use the alias (e.g., `[Confucius]` not `[kiln-planner-claude]`). When spawning agents via the Task tool, always set `name` to the alias and `subagent_type` to the internal name. This ensures the Claude Code UI displays character names in the spawn box (e.g., `Confucius (Claude-side planner)` instead of `kiln-planner-claude`).

**Quote cycling** — Read `assets/names.json` (installed to `$CLAUDE_HOME/kilntwo/names.json`) at session start. When spawning an agent via the Task tool, set the `description` parameter to one of their quotes from the `quotes` array. Cycle sequentially through the array across spawns of the same agent. Do not repeat a quote within the same session unless all quotes have been used. Match the narrative arc: use early quotes for first spawns, later quotes as the pipeline progresses. For fix/retry rounds, prefer adversity-themed quotes (e.g., Sphinx's "Return and try again, mortal" or Confucius's "When goals shift, adjust the steps").

## Codex CLI Reference

These are the canonical invocation patterns for all Codex calls made by the orchestrator.

Use this pattern when invoking GPT-5.2 for planning, research, or prompt generation tasks:

```bash
codex exec -m gpt-5.2 \
  -c 'model_reasoning_effort="high"' \
  --skip-git-repo-check \
  -C <PROJECT_PATH> \
  "<PROMPT_TEXT>" \
  -o <OUTPUT_PATH>
```

Use this pattern when invoking gpt-5.3-codex for code implementation tasks:

```bash
cat <PROMPT_PATH> | codex exec -m gpt-5.3-codex \
  -c 'model_reasoning_effort="high"' \
  --full-auto \
  --skip-git-repo-check \
  -C <PROJECT_PATH> \
  - \
  -o <OUTPUT_PATH>
```

The following flags must always be present in every Codex invocation:

- `--skip-git-repo-check` — always include; prevents Codex from failing when the working directory is not a git repo root
- `-o <OUTPUT_PATH>` — always capture output to a file; never discard Codex output
- `-c 'model_reasoning_effort="high"'` — always set reasoning effort to high; default effort produces insufficient output quality for pipeline tasks

## Memory Structure

All memory files live in the project memory directory resolved by Kiln, and the orchestrator must read all existing memory files at the start of every session before taking any action.

**MEMORY.md** — Tracks the current pipeline state with one canonical schema.

Required runtime enums:
- `stage`: `brainstorm | planning | execution | validation | complete`
- `status`: `in_progress | paused | blocked | complete`
- `planning_sub_stage`: `dual_plan | debate | synthesis | null`
- `phase_status` in `## Phase Statuses`: `pending | in_progress | failed | completed`

Required fields:
- `project_name`
- `project_path`
- `date_started`
- `last_updated`
- `stage`
- `status`
- `planning_sub_stage`
- `debate_mode`
- `phase_number`
- `phase_name`
- `phase_total`
- `handoff_note`

Optional fields (written at specific stage boundaries):
- `plan_approved_at` — ISO-8601 timestamp, written at the end of Stage 2 when the operator approves the master plan.
- `completed_at` — ISO-8601 timestamp, written at the end of Stage 5 when the protocol run finishes.

Optional sections:
- `## Phase Results` — Running log of phase completion summaries, appended after each phase completes in Stage 3.
- `## Validation` — Validator verdict, test counts, and report path, written during Stage 4.
- `## Reset Notes` — Written by `/kiln:reset` to preserve operator context across context resets.

Schema example:

```markdown
# Kiln Project Memory

## Metadata
project_name: my-project
project_path: /DEV/my-project
date_started: 2026-02-19
last_updated: 2026-02-19T18:10:00Z

## Runtime
stage: execution
status: in_progress
planning_sub_stage: null
debate_mode: 2
phase_number: 2
phase_name: API integration
phase_total: 4

## Handoff
handoff_note: Phase 2 in progress; continue with endpoint contract tests.

## Phase Statuses
- phase_number: 1 | phase_name: Foundation setup | phase_status: completed
- phase_number: 2 | phase_name: API integration | phase_status: in_progress

## Resume Log
- 2026-02-19T18:10:00Z Resumed via /kiln:resume
```

**vision.md** — Captures the project vision, goals, success criteria, and operator constraints as established during Stage 1. This file is written once during Stage 1 and read by both planners during Stage 2. It may be amended by the operator between stages but must not be modified by automated execution.

**master-plan.md** — The synthesized master plan produced by `kiln-synthesizer` at the end of Stage 2. Contains all phases with their tasks, acceptance criteria, and dependency graph. This is the authoritative execution plan for Stage 3.

**decisions.md** — An append-only log of key technical decisions made during the pipeline, each with a rationale and the stage/phase in which it was made. Codex agents append to this file when they make architectural choices that affect future phases.

**pitfalls.md** — An append-only log of problems encountered, failed approaches, and lessons learned during execution. Agents append to this file when they hit unexpected errors or discover that a planned approach will not work.

## Working Directory Structure

Kiln uses `$KILN_DIR/` to store all pipeline artifacts. This directory is managed by the orchestrator and must not be manually edited during automated execution.

```
$KILN_DIR/
  phase_<N>_state.md       — Per-phase state file (branch, commit SHA, events)
  plans/
    claude_plan.md         — Claude planner output
    codex_plan.md          — Codex planner output
    debate_resolution.md   — Debater agent output
    phase_plan.md          — Phase-scoped synthesized plan
  prompts/
    task_01.md             — Per-task Codex prompt (one file per task)
    task_NN.md             — (numbered sequentially, zero-padded to 2 digits)
    tasks_raw.md           — Intermediate prompter output (pre-split)
    manifest.md            — Ordered list of all task prompts with summaries
  reviews/
    fix_round_1.md         — QA fix prompt, round 1
    fix_round_N.md         — (numbered sequentially)
  outputs/
    task_01_output.md      — Captured Codex output for task 01
    task_01_error.md       — Captured Codex error output for task 01 (if any)
    task_NN_output.md      — (numbered matching task prompts)
  validation/
    report.md              — End-to-end validation results
    missing_credentials.md — Environment variables or secrets that were absent
```

- All paths shown above are absolute placeholders anchored at `$PROJECT_PATH`.
- Do not delete `$KILN_DIR/` directory contents between phases. The full artifact trail is preserved for debugging and audit purposes.
- If a file listed above does not exist yet (e.g. `debate_resolution.md` when debate was skipped), the orchestrator treats it as absent and proceeds without error.

## Development Guidelines

1. **Write clean, working code** — No placeholders, no TODOs, no `// implement later` comments. Every task prompt must produce complete, functional code. If a task cannot be completed without information that is not yet available, the Codex agent must return a clear error to the orchestrator rather than writing stub code.

2. **Follow existing project conventions** — Before writing any code, read the relevant existing source files to understand naming conventions, error handling patterns, module format (CommonJS vs ESM), and test structure. Do not introduce inconsistencies.

3. **Test everything** — Every function that can be tested must have tests. Acceptance criteria in task prompts must include at least one deterministically verifiable check (a command that can be run to confirm correctness). Tests must pass before a task is considered complete.

4. **Commit early and often** — Commit after each task completes, not only at phase end. Use descriptive commit messages that identify the phase and task number. Example: `kiln: phase-02 task-03 — implement rate limiter middleware`.

5. **Handle errors explicitly** — Never swallow errors silently. Every error path must either propagate the error to the caller, log it with context, or return a structured error value. Code that catches errors and does nothing is not acceptable.

6. **When in doubt, ask the operator** — If a Codex agent produces output that is ambiguous, incomplete, or contradicts the phase plan, the orchestrator must pause and ask the operator before proceeding. Automated execution must not make architectural decisions that were not covered in the master plan.
