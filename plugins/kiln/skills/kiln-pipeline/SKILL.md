---
name: kiln-pipeline
description: >-
  Kiln multi-modal software creation pipeline. Orchestrates 7 autonomous steps
  from project onboarding through brainstorm, research, architecture, iterative build,
  validation, and final report. Use when the user invokes /kiln-fire.
version: 1.0.5
user_invocable: false
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, TeamCreate, TeamDelete, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage
---

# Kiln Pipeline Engine

Orchestrate the full Kiln software creation pipeline. This skill is the conductor — it manages state, sequences steps, spawns pre-defined agent teams, handles Build looping and Validate correction cycles.

## Prerequisites

Environment setup (codex check, git init, working directory verification) is Alpha's responsibility in Step 1. The engine does NOT perform these checks — it spawns Alpha and hands off.

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

Banner rendering uses themed symlinks at the project root — all pointing to `kb.sh`. The engine writes banner config to `/tmp/kiln_banner.conf` (via Bash heredoc — 5 lines: title, quote, source, working_dir, spinner_json), then calls the step's symlink path. The user sees a thematic command path like `Bash(magic/happens)`, not raw printf commands.

**Step → Symlink mapping:**

| Step | Command path | User sees |
|------|-------------|-----------|
| 1 Onboarding | `omega/alpha` | `Bash(omega/alpha)` |
| 2 Brainstorm | `brainstorm/crunch` | `Bash(brainstorm/crunch)` |
| 3 Research | `deploy/spies` | `Bash(deploy/spies)` |
| 4 Architecture | `solid/foundation` | `Bash(solid/foundation)` |
| 5 Build | `magic/happens` | `Bash(magic/happens)` |
| 6 Validate | `pass/ordontpass` | `Bash(pass/ordontpass)` |
| 7 Report | `alpha/omega` | `Bash(alpha/omega)` |

Note: `description` parameter is confirmed no-op for UI header display — the user sees the command path. Description is still set for accessibility/logging. The engine should NOT write narration text before or after Bash calls — that creates duplication. Engine text is reserved for idle voice only.

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

On fresh run (no `.kiln/STATE.md`), before step 1:
1. Read ALL startup files in ONE parallel batch:
   - `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/brand.md`
   - `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/lore-engine.md`
   - `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/step-definitions.md`
   - `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/agents.json`
   - `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/lore.json`
   - `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-1-onboarding.md`
2. Render ignition banner (greeting from `lore.json` → `greetings`, lore key: `ignition`) + create team + spawn Phase A (mnemosyne).
3. Wait for READY → spawn Phase B (alpha, foreground) + operator greeting.

Budget: 3 turns max (batch read -> render+spawn Phase A -> spawn Phase B). Step 1 blueprint is read in the batch — no need for a separate "Read Blueprint" step.

On resume (`.kiln/STATE.md` exists with stage != complete):
1. Read `.kiln/STATE.md` + `.kiln/resume.md` in ONE parallel batch. `resume.md` contains pre-extracted brand palette, symlink map, status symbols, step signals, and engine rules — replaces `brand.md`, `lore-engine.md`, and `step-definitions.md` on resume.
2. Read the blueprint at the path in STATE.md `roster` field + `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/agents.json` (for spawn personality quotes) + `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/lore.json` (for transition quote).
3. Render resume banner (lore key: `resume`), create team, begin three-phase spawn for the current stage.

Budget: 3 turns max (read -> read -> render+spawn). The engine should NOT re-read `brand.md`, `lore-engine.md`, or `step-definitions.md` on resume — `resume.md` has everything needed.

### 1. Read Blueprint and Step Definition

Read these files for the current step:
- **Blueprint**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-{N}-{name}.md` — three-phase agent roster, communication model, spawn order.
- **Step definition**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/step-definitions.md` — done signals, state transitions, notes.

The blueprint tells you WHO to spawn and in which PHASE. The agent `.md` files (loaded via `subagent_type`) tell each agent WHAT to do. Step-definitions tell you what signals to expect.

(Step 1's blueprint and step-definitions.md are pre-read during Pipeline Start.)

### 2. Render Transition and Create Team

**Before creating the team**, render the step's transition. Visual vocabulary from startup batch (or `resume.md` on resume), exact formats in `lore-engine.md`. Two parts:

1. **Banner call** — Write banner config to `/tmp/kiln_banner.conf` (via Bash heredoc — same pattern as prompt files), then call the step's symlink (e.g. `Bash(command: "solid/foundation")`). The user sees the thematic command path in the header, and kb.sh renders the KILN banner with quote. For Build iterations: kill streak banner instead of standard. See lore-engine.md for conf file format and examples.
2. **Spawning indicator** — markdown block listing agents being spawned (see brand.md § Spawning Indicators).

**No engine text before or after the Bash call.** The call IS the presentation — the command path sets the scene, output delivers it. Any surrounding text is noise.

Then:

```
TeamCreate(team_name="{run_id}-{step_name}", description="Kiln {step_name}")
```

### 3. Three-Phase Spawn

You are the conductor — you spawn agents and wait for signals. You never perform step work yourself. Agents carry specialized logic you don't have: Alpha interviews operators, Da Vinci facilitates brainstorming, scouts map codebases. Even when the work looks trivial — a greenfield project with a clear brief — the agent applies conventions, file structures, and interaction patterns that you would skip. Never create `.kiln/`, `STATE.md`, or any pipeline artifact yourself. Never skip spawning.

The three-phase spawn sequence is defined in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md` § "Three-Phase Spawn". Follow it exactly. Not every step has all three phases — Step 7 is Phase B only. Some steps skip Phase C.

#### Phase A: Persistent Minds

If the blueprint lists Phase A agents, spawn each one (`run_in_background: true`). Each persistent mind bootstraps autonomously — reads its files, updates state, then signals READY via SendMessage to team-lead with a content summary. Capture the READY summary; the boss needs it.

#### Phase B: Boss

After ALL Phase A agents signal READY, spawn the boss. Interactive steps: `run_in_background: false` (boss talks to operator). Background steps: `run_in_background: true`.

**Lean runtime prompt** — only what changes per invocation:
```
You are "{boss_name}" on team "{team_name}". Working dir: {working_dir}.
Read your protocol files, then read team-protocol.md at:
  ${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md
{For each Phase A agent: "✓ {mind} READY: {summary from their READY signal}"}
{Step-specific state: build_iteration, correction_cycle, current milestone, etc.}
{Notes from step-definitions, if any}
```

The agent's `.md` file (loaded via `subagent_type`) already contains its full role, instructions, communication rules, and workflow. The runtime prompt adds only team identity, working directory, READY summaries, and step-specific state.

#### Phase C: Workers

When the boss sends `REQUEST_WORKERS`, parse the request and spawn each worker on the same team (`run_in_background: true`). Each worker gets a lean runtime prompt: team name, working dir, team-protocol.md path, "wait for assignment from {boss}."

```
REQUEST_WORKERS: {name} (subagent_type: {type}), {name} (subagent_type: {type}, isolation: worktree)
```

**Worktree isolation**: If a worker spec includes `isolation: worktree`, pass `isolation: "worktree"` to the Agent() call. This uses Claude Code's native git worktree feature — the agent gets its own isolated copy of the repository. SendMessage works normally across worktree boundaries. When the agent finishes and has made changes, the worktree path and branch are returned in the result — the engine should merge the worktree branch back to the working branch before proceeding.

The boss dispatches assignments via SendMessage after workers are spawned.

**After all Phase C workers are spawned**, send a confirmation to the boss so it wakes up with a message in its inbox. Without this, the boss can go idle after REQUEST_WORKERS and never see that workers are live — requiring a manual nudge.

```
SendMessage(
  type: "message",
  recipient: "{boss_name}",
  content: "WORKERS_SPAWNED: {worker_names}. All idle and awaiting assignment."
)
```

#### Spawn Parameters

For every agent, use ALL of these parameters:

```
Agent(
  name: "{agent_name}",           # from blueprint roster — EXACT name, no prefix
  description: "{personality}",    # random quote from agents.json — vary each spawn
  team_name: "{team_name}",       # the team from step 2 — REQUIRED
  subagent_type: "{agent_name}",  # matches the .md file in agents/
  prompt: "<lean runtime prompt>",
  run_in_background: true/false,  # see Engine Modes
  isolation: "worktree"           # OPTIONAL — only when blueprint/REQUEST_WORKERS specifies it
)
```

**Naming**: The `name` parameter controls what the operator sees in the UI header for every agent spawn. It should read like a character entering the scene — just their name and personality quote. Adding prefixes, namespaces, or team identifiers to `name` pollutes the operator's view with plumbing they don't need. The blueprint roster has the exact names — use them as-is.

**Every parameter is required.** Without `team_name`, agents spawn as isolated subagents — no SendMessage, no shutdown, no team pattern.

### 4. Engine Modes

Engine behavior during three-phase transitions depends on step type:

**Interactive (Steps 1, 2, 4):** Banner → spawning indicator → spawn boss in foreground → operator greeting → silent handoff. No progress beats. The boss IS the operator's interface — engine goes quiet until the boss signals done.

**Operator greeting**

This is the engine's LAST output before going silent. Two lines: character entry + navigation hint.

- **Step 1**
  Alpha is ready. The beginning of the end.
  ↳ shift+↓ to meet Alpha and begin preparation of the kiln
- **Step 2**
  Da Vinci is ready. The vision begins.
  ↳ shift+↓ to join Da Vinci for brainstorming
- **Step 4**
  Aristotle is ready. The plan awaits your judgment.
  ↳ shift+↓ to review the architecture with Aristotle

**Background (Steps 3, 5, 6, 7):** Banner → progress beats at each phase transition → idle voice during wait. Progress beats are one line per event with real information from READY signals:

```
◆ rakim bootstrapping...
✓ rakim ready — M2 in progress, 3/5 deliverables done. Key: src/components/LinkCard.tsx
◆ KRS-One entering — iteration 4, milestone M2...
✓ KRS-One: requesting codex, sphinx
◆ Spawning codex, sphinx...
```

Progress beats surface real information from READY signals and state. The operator should learn something from each line — what milestone, how far along, which agents. Never output template variables or generic status.

### 5. Wait for Done Signal

The engine waits for the boss's completion signal. Messages from the team arrive automatically. Do not read files, create tasks, or intervene.

**INTERACTIVE steps (Steps 1, 2) — HANDS OFF.** The boss is talking to the human operator. The operator may take 5 minutes, 30 minutes, or an hour to respond — this is normal. During INTERACTIVE steps:
- **NEVER** nudge, re-spawn, or replace the boss
- **NEVER** take over the interview or do the boss's work yourself
- **NEVER** assume the boss is stuck — the human is thinking
- **NEVER** spawn duplicate agents to "fix" a perceived problem
- Just wait. Silently. Indefinitely. The boss will signal done when the human is finished.

**Non-interactive steps (Steps 3-7)**: if an agent seems stuck (no activity for 5+ minutes), send ONE nudge via SendMessage. If still stuck after another 5 minutes, send one more. Never re-spawn or take over.

**Idle voice**: when the platform forces a response (`idle_notification`), output a lore-flavored one-liner from the current step's spinner verbs. Vary each time — never repeat the same line twice in a row. Never say "standing by", "waiting for signal", or any mechanical status update.

### 6. Shutdown and Transition

1. **Shutdown agents**: Send `shutdown_request` to each agent individually, in parallel. Do not use broadcast — shutdown is an orderly per-agent protocol, not an announcement.
2. **Wait for all confirmations**: Every agent must confirm before proceeding. Calling TeamDelete while agents are still alive orphans their processes.
3. **TeamDelete**: Only after all confirmations received.
4. **Then step 2 (Render Transition and Create Team)** for the next step. Always delete the old team before creating the new one — one team at a time, or TeamCreate fails on name collision.

### 7. Process Signal and Transition

Based on the boss's done signal, determine next action:

**Step 1 done** -> proceed to step 2
**Step 1 blocked** (ONBOARDING_BLOCKED) -> render `halt` banner, inform operator of the blocker details, stop pipeline
**Step 2 done** (BRAINSTORM_COMPLETE) -> verify `.kiln/docs/VISION.md` exists and is non-empty before proceeding to step 3. If missing, wait up to 30s (check every 5s), then nudge the vision curator if still missing.
**Step 3 done** (RESEARCH_COMPLETE) -> proceed to step 4
**Step 4 done** (ARCHITECTURE_COMPLETE) -> proceed to step 5
**Step 4 blocked** (PLAN_BLOCKED) -> render `halt` banner, inform operator, stop pipeline
**Step 5 signals**:
  - ITERATION_COMPLETE -> merge codex's worktree branch if pending (see Worktree Merge below), render `phase_complete` banner, re-invoke step 5 with next kill streak name
  - MILESTONE_COMPLETE -> merge codex's worktree branch if pending, render `milestone_complete` banner with celebration line, re-invoke step 5
  - BUILD_COMPLETE -> merge codex's worktree branch if pending, render `phases_complete` banner, proceed to step 6
**Step 6 signals**:
  - VALIDATE_PASS -> render `validation_passed` banner, proceed to step 7
  - VALIDATE_FAILED -> render `validation_failed` banner, check correction_cycle:
    - If < 3: render `correction_start` banner, increment correction_cycle in STATE.md, loop back to step 5. Correction dispatch follows the same structure as a normal Build iteration — KRS-One bootstraps persistent minds, reads the correction report at `.kiln/validation/report.md`, scopes a targeted fix, dispatches to codex. Do NOT inline the correction tasks or give KRS-One a vague "execute this." He scopes and delegates like any other iteration.
    - If >= 3: render `halt` banner, escalate to operator, stop pipeline
**Step 7 done** (REPORT_COMPLETE) -> render `project_complete` banner, pipeline complete

When writing STATE.md at step transitions, always include the `skill` and `roster` bootstrap paths. Set `roster` to the next step's blueprint path. These fields enable cold-start resume after session breaks.

## Build Loop — Kill Streak Names

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md` for Build step team naming (required at every Build step entry). The kill streak announcement is rendered as part of step 2 (Render Transition and Create Team) — bold orange banner with the streak name in ALL CAPS.

## Worktree Merge (Step 5)

When codex is spawned with `isolation: "worktree"`, it works in a temporary git worktree on its own branch. After the agent completes (shutdown), the Agent tool returns the worktree path and branch name if changes were made. The engine must merge these changes back to the working branch before the next iteration:

1. After shutting down the Step 5 team, check if codex's Agent result includes a worktree branch.
2. If yes: `git merge {worktree_branch} --no-edit` to bring codex's commits into the working branch.
3. If the merge has conflicts, inform the operator and stop the pipeline.
4. The worktree is automatically cleaned up by the Agent tool.

This merge happens during the Shutdown and Transition phase (step 6 of the execution pattern), after all agents confirm shutdown but before TeamDelete.

## Artifact Verification

Before each step, verify required input artifacts exist (see `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/artifact-flow.md`). If critical artifacts are missing, inform the operator rather than proceeding blind.
