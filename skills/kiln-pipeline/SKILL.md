---
name: kiln-pipeline
description: >-
  Kiln multi-modal software creation pipeline. Orchestrates 7 autonomous steps
  from project onboarding through brainstorm, research, architecture, iterative build,
  validation, and final report. Use when the user invokes /kiln-fire.
version: 0.1.0
user_invocable: false
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, TeamCreate, TeamDelete, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage
hooks:
  PreToolUse:
    - matcher: ""
      hooks:
        - type: command
          command: "${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/scripts/enforce-pipeline.sh"
---

# Kiln Pipeline Engine

Orchestrate the full Kiln software creation pipeline. This skill is the conductor — it manages state, sequences steps, spawns pre-defined agent teams, handles Build looping and Validate correction cycles.

## Prerequisites

Before running, verify:
1. Codex CLI is available: `which codex`
2. Working directory is set and accessible
3. Git repo exists in working directory. If not, initialize one: `git init && git add -A && git commit -m "Initial commit"`
4. GPT-5.4 model is accessible. Test with:
   ```
   codex exec --sandbox danger-full-access "echo ok"
   ```
   If this fails, inform the operator and suggest running `/kiln-doctor`.

**Codex CLI canonical invocation** (all agents that call Codex must use this exact pattern):
```
codex exec --sandbox danger-full-access -C "{working_dir}" < /tmp/kiln_prompt.md
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

## Presentation Layer

Bash tool calls are the presentation layer. The Bash `description` parameter sets the scene; the ANSI output delivers the visual payoff. The engine should NOT write narration text before or after Bash calls — that creates duplication. Engine text is reserved for idle voice only.

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/lore-engine.md` at pipeline start (alongside step-definitions and artifact-flow). It specifies:

1. **Transition banners** — ANSI-colored banners with lore quotes at every step boundary
2. **Kill streak announcements** — bold orange streak names at each Build iteration
3. **Agent personality** — random quote from agents.json in the `description` parameter on every spawn
4. **Spinner verbs** — step-appropriate verbs installed via settings.local.json at each transition
5. **Idle voice** — lore-flavored one-liners during forced idle turns (never "standing by")
6. **Step summary table** — compact progress table with status symbols after each transition

All lore data lives in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/`:
- `lore.json` — transition quotes and greetings
- `spinner-verbs.json` — step-categorized spinner verbs (8 categories, 64 verbs)
- `agents.json` — agent aliases and personality quotes

## State Detection and Auto-Resume

Read `.kiln/STATE.md` to determine pipeline state. If it doesn't exist, start from step 1.

STATE.md fields:
- `skill`: absolute path to this skill file — read on resume to reload full protocol
- `roster`: absolute path to current step's blueprint — read for agent spawn config
- `stage`: current step name (onboarding, brainstorm, research, architecture, build, validate, report, complete)
- `build_iteration`: current Build iteration count
- `milestone_count`: total milestones from Architecture
- `milestones_complete`: completed milestone count
- `correction_cycle`: Validate->Build correction count (max 3)
- `run_id`: pipeline run identifier
- `path`: working directory path
- `started`: run start date
- `updated`: last state update date

On resume: read `skill` from STATE.md, load that file (this file), then resume from `stage`. Stage maps directly to step number — onboarding = 1, brainstorm = 2, research = 3, architecture = 4, build = 5, validate = 6, report = 7. If `stage: complete`, inform the operator the pipeline already finished.

## Step Execution Pattern

For each step, follow this exact pattern. No shortcuts, no improvising.

### 0. Pipeline Start (first step only)

On fresh run (not resume), before step 1:
1. Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/lore-engine.md` — rendering spec for the entire run.
2. Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/agents.json` — agent personality quotes.
3. Output a random **greeting** from `data/lore.json` → `greetings` in terracotta (`\033[38;5;173m`).

On resume, read lore-engine.md alongside SKILL.md (it's part of the protocol, not optional).

### 1. Read Blueprint and Step Definition

Read both files for the current step:
- **Blueprint**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-{N}-{name}.md` — agent roster, communication model, spawn order.
- **Step definition**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/step-definitions.md` — done signals, state transitions, Notes.

The blueprint tells you WHO to spawn and HOW they communicate. The agent `.md` files (loaded automatically via `subagent_type`) tell each agent WHAT to do. Step-definitions tell you what signals to expect and any gate instructions (Notes field).

### 2. Render Transition and Create Team

**Before creating the team**, render the step's presentation in ONE Bash call (see lore-engine.md for exact formats). This single call does everything:
1. **ANSI banner** with inline step progress (e.g. `━━━ Ignition [1► 2○ 3○ 4○ 5○ 6○ 7○]`) + lore quote (2-3 lines max — Claude Code truncates longer output)
2. **Spinner verb install** — silently writes to `{working_dir}/.claude/settings.local.json`
3. **For Build iterations**: kill streak announcement instead of standard banner

The Bash **description** parameter is part of the narrative — use the evocative descriptions from lore-engine.md (e.g. "The philosophers convene...", "KRS-One takes the stage..."). The description sets the scene; the ANSI output delivers the visual payoff. They complement, never duplicate.

**No engine text before or after the Bash call.** Do not narrate what you are about to do ("Let me render the banner...") or explain what just happened. The Bash call IS the presentation — the description sets the scene, the output delivers it. Any engine text around it is noise.

The Bash tool's `description` parameter is what the user sees in the `● Bash(...)` header. Set it explicitly:

```
Bash(
  description: "The forge ignites...",    # narrative setup — NOT the command
  command: "printf '...' && echo '...' > settings.local.json"
)
```

Then:

```
TeamCreate(team_name="{run_id}-{step_name}", description="Kiln {step_name}")
```

### 3. Spawn Agents

You are the conductor — you spawn agents and wait for signals. You never perform step work yourself. Agents carry specialized logic you don't have: Alpha interviews operators, Da Vinci facilitates brainstorming, scouts map codebases. Even when the work looks trivial — a greenfield project with a clear brief — the agent applies conventions, file structures, and interaction patterns that you would skip. Never create `.kiln/`, `STATE.md`, or any pipeline artifact yourself. Never skip spawning.

For each agent in the blueprint's Agent Roster, spawn using the Agent tool with ALL of these parameters:

```
Agent(
  name: "{agent_name}",           # from blueprint roster (e.g., "aristotle")
  description: "{personality}",    # random quote from agents.json for this agent
  team_name: "{team_name}",       # the team from step 2 — REQUIRED
  subagent_type: "{agent_name}",  # matches the .md file in agents/
  prompt: "<runtime prompt>",     # team context + step-specific state (see below)
  run_in_background: true/false   # see below
)
```

**Every parameter is required.** Without `team_name`, agents spawn as isolated subagents — no SendMessage, no shutdown, no team pattern. The `description` shows as flavor text in the team panel — pick a different quote each spawn, never repeat within a session.

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

The main session waits. Messages from the team arrive automatically. Do not read files, create tasks, or intervene.

When the boss signals done, proceed to step 5 (shutdown).

**INTERACTIVE steps (Step 1, Step 2) — HANDS OFF.** The boss is talking to the human operator. The operator may take 5 minutes, 30 minutes, or an hour to respond — this is normal. During INTERACTIVE steps:
- **NEVER** nudge, re-spawn, or replace the boss
- **NEVER** take over the interview or do the boss's work yourself
- **NEVER** assume the boss is stuck — the human is thinking
- **NEVER** spawn duplicate agents to "fix" a perceived problem
- Just wait. Silently. Indefinitely. The boss will signal done when the human is finished.

**Non-interactive steps (Steps 3-7)**: if an agent seems stuck (no activity for 5+ minutes), send ONE nudge via SendMessage. If still stuck after another 5 minutes, send one more. Never re-spawn or take over.

**Idle voice**: when the platform forces a response (`idle_notification`), output a lore-flavored one-liner from the current step's spinner verbs. Vary each time — never repeat the same line twice in a row. Never say "standing by", "waiting for signal", or any mechanical status update.

### 5. Shutdown and Transition

1. **Shutdown agents**: Send `shutdown_request` to each agent individually, in parallel. Do not use broadcast — shutdown is an orderly per-agent protocol, not an announcement.
2. **Wait for all confirmations**: Every agent must confirm before proceeding. Calling TeamDelete while agents are still alive orphans their processes.
3. **TeamDelete**: Only after all confirmations received.
4. **Then step 2 (Render Transition and Create Team)** for the next step. Always delete the old team before creating the new one — one team at a time, or TeamCreate fails on name collision.

### 6. Process Signal and Transition

Based on the boss's done signal, determine next action:

**Step 1 done** -> proceed to step 2
**Step 2 done** (BRAINSTORM_COMPLETE) -> verify `.kiln/docs/VISION.md` exists and is non-empty before proceeding to step 3. If missing, wait up to 30s (check every 5s), then nudge Visionary if still missing.
**Step 3 done** (RESEARCH_COMPLETE) -> proceed to step 4
**Step 4 done** (ARCHITECTURE_COMPLETE) -> proceed to step 5
**Step 4 blocked** (PLAN_BLOCKED) -> render `halt` banner, inform operator, stop pipeline
**Step 5 signals**:
  - ITERATION_COMPLETE -> render `phase_complete` banner, re-invoke step 5 with next kill streak name
  - MILESTONE_COMPLETE -> render `milestone_complete` banner with celebration line, re-invoke step 5
  - BUILD_COMPLETE -> render `phases_complete` banner, proceed to step 6
**Step 6 signals**:
  - VALIDATE_PASS -> render `validation_passed` banner, proceed to step 7
  - VALIDATE_FAILED -> render `validation_failed` banner, check correction_cycle:
    - If < 3: render `correction_start` banner, increment correction_cycle in STATE.md, loop back to step 5
    - If >= 3: render `halt` banner, escalate to operator, stop pipeline
**Step 7 done** (REPORT_COMPLETE) -> render `project_complete` banner, pipeline complete

When writing STATE.md at step transitions, always include the `skill` and `roster` bootstrap paths. Set `roster` to the next step's blueprint path. These fields enable cold-start resume after session breaks.

## Build Loop — Kill Streak Names

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md` for Build step team naming (required at every Build step entry). The kill streak announcement is rendered as part of step 2 (Render Transition and Create Team) — bold orange banner with the streak name in ALL CAPS.

## Artifact Verification

Before each step, verify required input artifacts exist (see `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/artifact-flow.md`). If critical artifacts are missing, inform the operator rather than proceeding blind.
