---
name: kiln-pipeline
description: >-
  Kiln multi-modal software creation pipeline. Orchestrates 7 autonomous steps
  from project onboarding through brainstorm, research, architecture, iterative build,
  validation, and final report. Use when the user invokes /kiln-fire.
version: 0.1.0
user_invocable: false
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, TeamCreate, TeamDelete, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage
---

# Kiln Pipeline Engine

Orchestrate the full Kiln software creation pipeline. This skill is the conductor — it manages state, sequences steps, spawns pre-defined agent teams, handles Build looping and Validate correction cycles.

## Prerequisites

Before running, verify:
1. Codex CLI is available: `which codex`
2. Working directory is set and accessible
3. Git repo exists in working directory. If not, initialize one: `git init && git add -A && git commit -m "Initial commit"`
4. GPT-5.4 model is accessible. Test with the full flags that agents use:
   ```
   codex exec -m gpt-5.4 -c 'model_reasoning_effort="high"' --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check "echo ok"
   ```
   If this fails, inform the operator and suggest running `/kiln-doctor`.

**Codex CLI canonical invocation** (all agents that call Codex must use this exact pattern):
```
codex exec -m gpt-5.4 -c 'model_reasoning_effort="high"' --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C "{working_dir}" < /tmp/kiln_prompt.md
```

**Prompt file creation**: Create prompt files via Bash heredoc (`cat <<'EOF' > /tmp/kiln_prompt.md`), not the Write tool. Write requires a prior Read on the file path, which fails on new files and wastes a tool call.

## Pipeline Overview

7 steps, executed sequentially. Each step = a team of pre-defined agents.

1. **Onboarding** (Alpha) — INTERACTIVE — detect project, create .kiln/, map codebase if brownfield
2. **Brainstorm** (Da Vinci) — INTERACTIVE — facilitate vision discovery with operator
3. **Research** (MI6) — investigate open questions from VISION.md
4. **Architecture** (Aristotle) — dual-model planning, debate, synthesis, validation
5. **Build** (KRS-One) — JIT implementation, iterates with kill streak names
6. **Validate** (Argus) — test against acceptance criteria, may loop back to Build
7. **Report** (Omega) — compile final REPORT.md

## State Detection and Auto-Resume

Read `.kiln/STATE.md` to determine pipeline state. If it doesn't exist, start from step 1.

STATE.md fields:
- `stage`: current step name (brainstorm, research, architecture, build, validate, report, complete)
- `build_iteration`: current Build iteration count
- `milestone_count`: total milestones from Architecture
- `correction_cycle`: Validate->Build correction count (max 3)
- `run_id`: pipeline run identifier

Resume logic:
- `stage: brainstorm` -> start step 2
- `stage: research` -> start step 3
- `stage: architecture` -> start step 4
- `stage: build` -> start step 5 (read build_iteration for kill streak name)
- `stage: validate` -> start step 6
- `stage: report` -> start step 7
- `stage: complete` -> pipeline already finished, inform operator
- No STATE.md -> start step 1

## Step Execution Pattern

For each step, follow this exact pattern. No shortcuts, no improvising.

### 1. Read Blueprint and Step Definition

Read both files for the current step:
- **Blueprint**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-{N}-{name}.md` — agent roster, communication model, spawn order.
- **Step definition**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/step-definitions.md` — done signals, state transitions, Notes.

The blueprint tells you WHO to spawn and HOW they communicate. The agent `.md` files (loaded automatically via `subagent_type`) tell each agent WHAT to do. Step-definitions tell you what signals to expect and any gate instructions (Notes field).

### 2. Create Team

```
TeamCreate(team_name="{run_id}-{step_name}", description="Kiln {step_name}")
```

### 3. Spawn Agents

You are the conductor — you spawn agents and wait for signals. You never perform step work yourself. Agents carry specialized logic you don't have: Alpha interviews operators, Da Vinci facilitates brainstorming, scouts map codebases. Even when the work looks trivial — a greenfield project with a clear brief — the agent applies conventions, file structures, and interaction patterns that you would skip. Never create `.kiln/`, `STATE.md`, or any pipeline artifact yourself. Never skip spawning.

For each agent in the blueprint's Agent Roster, spawn using the Agent tool with ALL of these parameters:

```
Agent(
  name: "{agent_name}",           # from blueprint roster (e.g., "aristotle")
  team_name: "{team_name}",       # the team from step 2 — REQUIRED
  subagent_type: "{agent_name}",  # matches the .md file in agents/
  prompt: "<runtime prompt>",     # team context + step-specific state (see below)
  run_in_background: true/false   # see below
)
```

**Every parameter is required.** Without `team_name`, agents spawn as isolated subagents — no SendMessage, no shutdown, no team pattern.

**Runtime prompt** — provides the team context that the agent's `.md` file doesn't have:
```
You are "{agent_name}" on team "{team_name}". Working dir: {working_dir}.
{step-specific context: current milestone, build_iteration, correction_cycle, etc.}
{Notes from step-definitions, if any — e.g., gate instructions for aristotle}
```

The agent's `.md` file (loaded via `subagent_type`) already contains its full role, instructions, communication rules, and workflow. The runtime prompt adds only what changes per invocation: team identity, working directory, and step-specific state.

**Architect mode selection** (architect appears in steps 4, 5, 6 — her `.md` file has 3 modes):
- Step 4: runtime prompt includes "MODE: Architecture"
- Step 5: runtime prompt includes "MODE: Build"
- Step 6: runtime prompt includes "MODE: Validate"

**run_in_background**:
- **INTERACTIVE steps** (Step 1, Step 2): `false` for the boss. These bosses talk directly to the operator — background spawn breaks that interaction.
- **All other steps**: `true` for all agents.

**Spawn order**: Follow the blueprint. Most steps spawn all agents in parallel. Step 1 spawns alpha first (who conditionally spawns mnemosyne).

### 4. Wait for Done Signal

The main session does nothing. Messages from the team arrive automatically. Do not read files, create tasks, or intervene.

When the boss signals done, proceed to step 5 (shutdown).

If an agent seems stuck (no activity for 2+ minutes), send a nudge via SendMessage.

### 5. Shutdown and Transition

1. **Shutdown agents**: Send `shutdown_request` to each agent individually, in parallel. Do not use broadcast — shutdown is an orderly per-agent protocol, not an announcement.
2. **Wait for all confirmations**: Every agent must confirm before proceeding. Calling TeamDelete while agents are still alive orphans their processes.
3. **TeamDelete**: Only after all confirmations received.
4. **Then TeamCreate** for the next step. Always delete the old team before creating the new one — one team at a time, or TeamCreate fails on name collision.

### 6. Process Signal and Transition

Based on the boss's done signal, determine next action:

**Step 1 done** -> proceed to step 2
**Step 2 done** (BRAINSTORM_COMPLETE) -> verify `.kiln/docs/VISION.md` exists and is non-empty before proceeding to step 3. If missing, wait up to 30s (check every 5s), then nudge Visionary if still missing.
**Step 3 done** (RESEARCH_COMPLETE) -> proceed to step 4
**Step 4 done** (ARCHITECTURE_COMPLETE) -> proceed to step 5
**Step 4 blocked** (PLAN_BLOCKED) -> inform operator, stop pipeline
**Step 5 signals**:
  - ITERATION_COMPLETE -> re-invoke step 5 with next kill streak name
  - MILESTONE_COMPLETE -> re-invoke step 5 with next kill streak name
  - BUILD_COMPLETE -> proceed to step 6
**Step 6 signals**:
  - VALIDATE_PASS -> proceed to step 7
  - VALIDATE_FAILED -> check correction_cycle:
    - If < 3: increment correction_cycle in STATE.md, loop back to step 5
    - If >= 3: escalate to operator, stop pipeline
**Step 7 done** (REPORT_COMPLETE) -> pipeline complete

## Build Loop — Kill Streak Names

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md` for the 20 team names.

Select team name by `build_iteration` (1-indexed):
- Iteration 1 = first-blood
- Iteration 2 = combo
- ...
- Iteration 20 = ultra-combo
- Iteration 21+ = wrap around to #1

## Correction Cycle Logic

When Validate returns VALIDATE_FAILED:
1. Read correction_cycle from STATE.md
2. If correction_cycle < 3:
   - Increment correction_cycle in STATE.md
   - Loop back to step 5 (Build)
   - KRS-One will read .kiln/validation/report.md for correction tasks
3. If correction_cycle >= 3:
   - Inform operator: "Pipeline blocked after 3 correction cycles. Manual intervention needed."
   - Display correction tasks from .kiln/validation/report.md
   - Stop pipeline

## Artifact Verification

Before each step, verify required input artifacts exist (see `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/artifact-flow.md`). If critical artifacts are missing, inform the operator rather than proceeding blind.

## Error Handling

- If an agent fails to spawn, retry once. If still failing, inform operator.
- If Codex CLI is unavailable, suggest running `/kiln-doctor`.
- If a step produces unexpected signals, log the signal and ask operator for guidance.
- Never silently swallow errors — surface them clearly.
