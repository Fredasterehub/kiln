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

1. **Stage 1 — Initialization & Brainstorm** (interactive) — The orchestrator initializes the project and creates the `kiln-session` team. For brownfield projects (auto-detected), `kiln-mapper` (Mnemosyne) maps the existing codebase and pre-seeds memory files before brainstorming begins. Then the orchestrator spawns the `kiln-brainstormer` agent (Da Vinci) as a teammate to facilitate a structured brainstorm session. The brainstormer uses 62 creative techniques, 50 elicitation methods, and anti-bias protocols to guide the operator through ideation. The operator selects a brainstorm depth (light/standard/deep) that sets the idea floor and technique intensity. The operator also selects a communication style (`operator_mode: tour | express`) that controls verbosity of onboarding prompts. Memory checkpoints are written periodically: `vision.md` captures the project vision across 11 structured sections, and `MEMORY.md` updates canonical runtime fields (`stage`, `status`, `brainstorm_depth`, phase fields, `handoff_note`, `last_updated`). The stage ends when the brainstormer signals completion and the pre-flight check passes.

2. **Stage 2 — Planning** (automated with operator review) — The orchestrator spawns `kiln-planning-coordinator` (Aristotle) to own the entire planning pipeline end-to-end. Aristotle runs `kiln-planner-claude` and `kiln-planner-codex` in parallel, runs `kiln-debater` when debate mode requires it (mode 2 by default), synthesizes with `kiln-synthesizer`, validates with `kiln-plan-validator` (Athena) with up to 2 retries, and runs the operator approval loop. Aristotle writes planning artifacts to disk, updates `MEMORY.md`, and returns a single gating signal to Kiln: `PLAN_APPROVED` or `PLAN_BLOCKED`.

3. **Stage 3 — Execution** (automated, phase by phase) — The orchestrator executes the master plan one phase at a time using the phase executor pattern. Each phase consists of: refreshing the codebase index (Sherlock), generating a phase-scoped plan (`$KILN_DIR/plans/phase_plan.md`), JIT prompt sharpening (Scheherazade explores the codebase before generating context-rich prompts), running each Codex task sequentially, and running up to 3 QA review rounds with correction cycles before merging. After each phase merge, Sherlock reconciles living docs (`decisions.md`, `pitfalls.md`, `PATTERNS.md`, `tech-stack.md`). Phases run sequentially; the orchestrator does not begin a new phase until the prior phase is merged and MEMORY.md is updated.

4. **Stage 4 — Validation** (automated with correction loop) — After all phases are complete, the orchestrator runs end-to-end validation. Argus builds, deploys, and tests the actual running product against the master plan's acceptance criteria. Results are written to `$KILN_DIR/validation/report.md`. If validation fails, Argus generates correction task descriptions. The orchestrator creates correction phases that re-enter Stage 3 through the full Scheherazade→Codex→Sphinx cycle. This loop continues until validation passes or max 3 correction cycles are reached. Any missing credentials or environment variables are recorded in `$KILN_DIR/validation/missing_credentials.md`.

5. **Stage 5 — Complete & Delivery** (interactive) — The orchestrator produces a final delivery summary for the operator covering: all phases completed, files created or modified, test results, and any known limitations. MEMORY.md is updated with `stage: complete` and `status: complete`. The operator is prompted to review and approve the delivery.

## Orchestration Rules

1. **No /compact** — Never use `/compact`. Context management is handled exclusively through session resets and memory file resumption. Compacting loses tool call history that may be needed for debugging.

2. **Memory files are the single source of truth** — `MEMORY.md`, `vision.md`, `master-plan.md`, `decisions.md`, `pitfalls.md`, `PATTERNS.md`, and `tech-stack.md` define project state. Before starting any stage or phase, read these files. After completing any stage or phase, update canonical runtime fields in `MEMORY.md`: `stage`, `status`, `planning_sub_stage`, phase fields, `handoff_note`, `handoff_context`, and `last_updated`. Pipeline transitions are rendered via ANSI-colored Bash printf commands (see kiln-core.md ANSI Rendering section).

3. **Only Aristotle, Maestro, and Mnemosyne have Task tool and team management access** — Among spawned sub-agents, only `kiln-planning-coordinator` (Aristotle, Stage 2), `kiln-phase-executor` (Maestro, Stage 3), and `kiln-mapper` (Mnemosyne, Stage 1) have Task tool access and may use `TeamCreate`/`TeamDelete` for sub-team lifecycle. All other spawned agents are leaf workers that cannot spawn further sub-agents. The top-level orchestrator (Kiln, running `/kiln:start`) uses Task to spawn all top-level agents and is not subject to this restriction.

4. **Phase sizing** — Each phase must represent 1-4 hours of implementation work. Phases that are too large must be split during the planning stage. Phases that are too small may be merged. The synthesizer is responsible for enforcing this during master plan creation.

5. **QA cap** — A maximum of 3 review rounds are allowed per phase. If a phase still fails after 3 rounds, the orchestrator must stop automated execution and escalate to the operator with a summary of what failed and why.

6. **Debate mode default** — Unless the operator explicitly specifies a debate mode during Stage 1, the debater agent runs in mode 2 (Focused). Mode 1 (Skip) and mode 3 (Full) must be explicitly requested.

7. **Git discipline** — Create a feature branch at the start of each phase named `kiln/phase-NN` where NN is the zero-padded phase number. Commit atomically after each task completes. Merge the phase branch to the main branch only after the phase passes QA. Never commit directly to the main branch during automated execution.

8. **No judgment calls during automated execution** — If the orchestrator encounters an ambiguous situation, a missing requirement, a conflicting instruction, or an unexpected error during Stage 3, it must stop and ask the operator rather than guessing. Automated execution resumes only after the operator provides direction.

9. **Agent termination** — Every sub-agent spawned via the Task tool must terminate after completing its assigned task. Agents must write all required output artifacts, return a concise completion summary, and exit immediately. Never resume or reuse a prior agent instance — always spawn a fresh agent for each new task assignment.

10. **Generous timeouts** — All Codex CLI invocations must use a minimum timeout of 600 seconds. Tasks that involve large codebases, complex reasoning, or file-heavy operations should use 900 seconds or more.

11. **Scheherazade must explore the current codebase before generating any implementation prompt** — JIT sharpening is mandatory. Prompts generated without codebase exploration are rejected.

12. **After each phase, reconcile living docs** — Sherlock updates `decisions.md`, `pitfalls.md`, `PATTERNS.md`, and `tech-stack.md` after every phase merge. Scheherazade reads these files before sharpening subsequent tasks, creating a cross-phase learning loop.

13. **Stage 4 must deploy and test the actual running product** — Unit tests alone are insufficient. Argus must attempt to build, deploy, and test real user flows against acceptance criteria.

14. **Validation failures generate correction phases that re-enter Stage 3** — Max 3 correction cycles. Each correction phase goes through the full Scheherazade→Codex→Sphinx cycle. If still failing after 3 cycles, halt and escalate to operator.

15. **Plans must pass validation before execution** — After Plato's synthesis, the orchestrator spawns Athena (`kiln-plan-validator`) and emits `[plan_validate_start]` / `[plan_validate_complete]` events for the gate. If validation fails, loop back to planners with Athena's feedback. Only proceed to Stage 3 after plan validation passes.

16. **Team lifecycle** — Kiln creates the `kiln-session` team for orchestrator-level tracking. Coordinators (Aristotle, Maestro, Mnemosyne) are spawned WITHOUT `team_name` — they create their own ephemeral sub-teams (`aristotle-planning`, `maestro-phase-<N>`, `mnemosyne-mapping`) at setup after a defensive `TeamDelete` cleanup. Workers join the coordinator's sub-team. Coordinators call `TeamDelete` before returning.

## Agent Roster

The Kiln pipeline uses 15 specialized agents. Rules are enforced by 16 orchestration rules above. Each has a character alias used in logs and status output.

| Alias | Internal Name | Role |
|---|---|---|
| **Kiln** | *(orchestrator)* | Top-level session coordinator — runs interactively in Claude Code |
| **Confucius** | kiln-planner-claude | Claude-side implementation planner |
| **Sun Tzu** | kiln-planner-codex | GPT-5.2 planning via Codex CLI |
| **Socrates** | kiln-debater | Plan debate and resolution |
| **Plato** | kiln-synthesizer | Plan synthesis with parallel annotations |
| **Scheherazade** | kiln-prompter | JIT prompt sharpening with codebase exploration |
| **Codex** | kiln-implementer | Code implementation via GPT-5.3-codex |
| **Sphinx** | kiln-reviewer | Code review and QA gate |
| **Maestro** | kiln-phase-executor | Phase lifecycle coordinator |
| **Argus** | kiln-validator | Deploy, validate, and generate corrections |
| **Da Vinci** | kiln-brainstormer | Creative brainstorm facilitator |
| **Sherlock** | kiln-researcher | Research, codebase indexing, and living docs reconciliation |
| **Athena** | kiln-plan-validator | Pre-execution plan validation |
| **Mnemosyne** | kiln-mapper | Brownfield codebase cartographer |
| **Aristotle** | kiln-planning-coordinator | Stage 2 planning coordinator |

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
project_mode: brownfield
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

**decisions.md** — Append-only log of key technical decisions with rationale. Updated by Sherlock during reconciliation.

**pitfalls.md** — Append-only log of problems, failed approaches, and lessons learned. Updated by Sherlock during reconciliation.

**PATTERNS.md** — Append-only log of coding patterns discovered during execution. Updated by Sherlock during reconciliation. Read by Scheherazade for JIT sharpening.

**tech-stack.md** — Living inventory of languages, frameworks, libraries, and build tools. Updated by Sherlock during reconciliation.
