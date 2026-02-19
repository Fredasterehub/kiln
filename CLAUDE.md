<!-- kiln:protocol:begin v0.2.1 -->
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

For full path derivation, memory schema, event schema, file naming conventions, Codex CLI patterns, working directory structure, and development guidelines, read the kiln-core skill at `$CLAUDE_HOME/kilntwo/skills/kiln-core.md`.

## Pipeline Stages

1. **Stage 1 — Initialization & Brainstorm** (interactive) — The orchestrator initializes the project, then spawns the `kiln-brainstormer` agent (Da Vinci) to facilitate a structured brainstorm session. The brainstormer uses 62 creative techniques, 50 elicitation methods, and anti-bias protocols to guide the operator through ideation. The operator selects a brainstorm depth (light/standard/deep) that sets the idea floor and technique intensity. Memory checkpoints are written periodically: `vision.md` captures the project vision across 11 structured sections, and `MEMORY.md` updates canonical runtime fields (`stage`, `status`, `brainstorm_depth`, phase fields, `handoff_note`, `last_updated`). The stage ends when the brainstormer signals completion and the pre-flight check passes.

2. **Stage 2 — Planning** (automated with operator review) — The orchestrator spawns both `kiln-planner-claude` and a Codex planner in parallel to produce independent implementation plans. A `kiln-debater` agent then analyzes disagreements between the two plans (debate mode 2 by default unless the operator specified otherwise during Stage 1). A `kiln-synthesizer` agent merges the plans and debate resolution into a single `master-plan.md`. The operator reviews and approves the master plan before Stage 3 begins.

3. **Stage 3 — Execution** (automated, phase by phase) — The orchestrator executes the master plan one phase at a time using the phase executor pattern. Each phase consists of: generating a phase-scoped plan (`$KILN_DIR/plans/phase_plan.md`), generating per-task prompts (`$KILN_DIR/prompts/`), running each Codex task sequentially, and running up to 3 QA review rounds before merging. Phases run sequentially; the orchestrator does not begin a new phase until the prior phase is merged and MEMORY.md is updated.

4. **Stage 4 — Validation** (automated) — After all phases are complete, the orchestrator runs end-to-end validation. Results are written to `$KILN_DIR/validation/report.md`. Any missing credentials or environment variables that blocked tests are recorded in `$KILN_DIR/validation/missing_credentials.md`. If validation fails, the orchestrator identifies the failing phase and re-enters Stage 3 for that phase only.

5. **Stage 5 — Complete & Delivery** (interactive) — The orchestrator produces a final delivery summary for the operator covering: all phases completed, files created or modified, test results, and any known limitations. MEMORY.md is updated with `stage: complete` and `status: complete`. The operator is prompted to review and approve the delivery.

## Orchestration Rules

1. **No /compact** — Never use `/compact`. Context management is handled exclusively through session resets and memory file resumption. Compacting loses tool call history that may be needed for debugging.

2. **Memory files are the single source of truth** — `MEMORY.md`, `vision.md`, `master-plan.md`, `decisions.md`, and `pitfalls.md` define project state. Before starting any stage or phase, read these files. After completing any stage or phase, update canonical runtime fields in `MEMORY.md`: `stage`, `status`, `planning_sub_stage`, phase fields, `handoff_note`, `handoff_context`, and `last_updated`.

3. **Sub-agent spawning is restricted** — Sub-agents cannot spawn their own sub-agents. Only the phase executor (the top-level orchestrator running Stage 3) may spawn Codex task agents. If a sub-agent needs additional work done, it must return that request to the orchestrator rather than spawning independently.

4. **Phase sizing** — Each phase must represent 1-4 hours of implementation work. Phases that are too large must be split during the planning stage. Phases that are too small may be merged. The synthesizer is responsible for enforcing this during master plan creation.

5. **QA cap** — A maximum of 3 review rounds are allowed per phase. If a phase still fails after 3 rounds, the orchestrator must stop automated execution and escalate to the operator with a summary of what failed and why.

6. **Debate mode default** — Unless the operator explicitly specifies a debate mode during Stage 1, the debater agent runs in mode 2 (Focused). Mode 1 (Skip) and mode 3 (Full) must be explicitly requested.

7. **Git discipline** — Create a feature branch at the start of each phase named `kiln/phase-NN` where NN is the zero-padded phase number. Commit atomically after each task completes. Merge the phase branch to the main branch only after the phase passes QA. Never commit directly to the main branch during automated execution.

8. **No judgment calls during automated execution** — If the orchestrator encounters an ambiguous situation, a missing requirement, a conflicting instruction, or an unexpected error during Stage 3, it must stop and ask the operator rather than guessing. Automated execution resumes only after the operator provides direction.

9. **Agent termination** — Every sub-agent spawned via the Task tool must terminate after completing its assigned task. Agents must write all required output artifacts, return a concise completion summary, and exit immediately. Never resume or reuse a prior agent instance — always spawn a fresh agent for each new task assignment.

10. **Generous timeouts** — All Codex CLI invocations must use a minimum timeout of 600 seconds. Tasks that involve large codebases, complex reasoning, or file-heavy operations should use 900 seconds or more.

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
| **Da Vinci** | kiln-brainstormer | Creative brainstorm facilitator |
| **Sherlock** | kiln-researcher | Fast documentation and codebase research |

When logging agent activity, use the alias (e.g., `[Confucius]` not `[kiln-planner-claude]`). When spawning agents via the Task tool, always set `name` to the alias and `subagent_type` to the internal name.

**Quote cycling** — Read `assets/names.json` (installed to `$CLAUDE_HOME/kilntwo/names.json`) at session start. When spawning an agent via the Task tool, set the `description` parameter to one of their quotes from the `quotes` array. Cycle sequentially through the array across spawns of the same agent. Do not repeat a quote within the same session unless all quotes have been used.

## Memory Structure

All memory files live in the project memory directory resolved by Kiln. The orchestrator must read all existing memory files at the start of every session before taking any action.

**MEMORY.md** — Tracks current pipeline state. Required fields, enums, and schema are defined in the kiln-core skill. Schema example:

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
brainstorm_depth: standard
debate_mode: 2
phase_number: 2
phase_name: API integration
phase_total: 4

## Handoff
handoff_note: Phase 2 task 3/6 complete; next: implement rate limiter.
handoff_context: |
  Phase 2 (API integration) is mid-execution. Tasks 1-3 committed on branch
  kiln/phase-02-api-integration. Task 3 added auth middleware, passed verification.
  Task 4 (rate limiter) not started. Phase plan specifies Redis-backed sliding window.
  No pitfalls. Codex succeeded first attempt on all completed tasks.

## Phase Statuses
- phase_number: 1 | phase_name: Foundation setup | phase_status: completed
- phase_number: 2 | phase_name: API integration | phase_status: in_progress

## Resume Log
- 2026-02-19T18:10:00Z Resumed via /kiln:resume
```

**vision.md** — Project vision, goals, success criteria. Written in Stage 1, read by planners in Stage 2.

**master-plan.md** — Synthesized master plan from `kiln-synthesizer`. Authoritative execution plan for Stage 3.

**decisions.md** — Append-only log of key technical decisions with rationale.

**pitfalls.md** — Append-only log of problems, failed approaches, and lessons learned.
<!-- kiln:protocol:end -->
