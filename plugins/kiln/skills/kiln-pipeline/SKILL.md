---
name: kiln-pipeline
description: >-
  Kiln multi-modal software creation pipeline. Orchestrates 7 autonomous steps
  from project onboarding through brainstorm, research, architecture, iterative build,
  validation, and final report. Use when the user invokes /kiln-fire.
version: 0.98.3
user_invocable: false
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, TeamCreate, TeamDelete, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage
---

# Kiln Pipeline Engine

Orchestrate the full Kiln software creation pipeline. This skill is the conductor — it manages state, sequences steps, spawns pre-defined agent teams, handles Build looping and Validate correction cycles.

## Prerequisites

Environment scaffolding (git init, .kiln/ structure, hook-gated seed files) runs in the engine between the ignition banner and alpha's spawn. Alpha handles the conversation: working directory, project name, description, preferences.

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

The engine's own markdown text is the presentation layer. Transition banners, kill streak announcements, checkpoints, and spawning blocks are written directly in the response stream.

Spinner verbs still install through invisible plumbing:
- Write `settings.local.json` via Bash heredoc
- Use one Bash call per transition for spinner installation only
- Do not render banners through Bash output

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/lore-engine.md` for the full presentation protocol.
Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/brand.md` for visual vocabulary and brand tokens.

See § Engine Banners and § Step Transitions below for banner content and transition events.

1. **Transition banners** — markdown banners with lore quotes at every step boundary
2. **Kill streak announcements** — markdown streak banners at each Build iteration
3. **Agent personality** — random quote from agents.json in the `description` parameter on every spawn
4. **Spinner verbs** — step-appropriate verbs installed via settings.local.json at each transition
5. **Idle voice** — lore-flavored one-liners during forced idle turns (never "standing by")
6. **Step summary table** — compact progress table with status symbols after each transition

All lore data lives in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/`:
- `lore.json` — transition quotes and greetings
- `spinner-verbs.json` — step-categorized spinner verbs (8 categories, 64 verbs)
- `agents.json` — agent aliases and personality quotes

## Engine Banners and Step Transitions

Banner formats (ignition, resume, complete) and the full event-to-lore-key mapping table live in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/lore-engine.md`. Read it once at pipeline start.

## State Detection and Auto-Resume

Read `.kiln/STATE.md` to determine pipeline state. If it doesn't exist, start from step 1.

STATE.md fields:
- `skill`: absolute path to this skill file under the active plugin root. On resume, use the stored path if it is readable; otherwise recover to `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md`
- `roster`: absolute path to current step's blueprint under the active plugin root. On resume, use the stored path if it is readable; otherwise recover from `stage` using the deterministic blueprint map below
- `stage`: current step name (onboarding, brainstorm, research, architecture, build, validate, report, complete)
- `build_iteration`: current Build iteration count
- `milestone_count`: total milestones from Architecture
- `milestones_complete`: completed milestone count
- `correction_cycle`: Validate->Build correction count (max 3)
- `run_id`: pipeline run identifier
- `path`: working directory path
- `started`: run start date
- `updated`: last state update date
- `step_N_start`: ISO 8601 timestamp when step N began (written at each step transition)
- `step_N_end`: ISO 8601 timestamp when step N completed (written when step signals done)

Deterministic blueprint map for recovery:
- `onboarding` -> `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-1-onboarding.md`
- `brainstorm` -> `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-2-brainstorm.md`
- `research` -> `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-3-research.md`
- `architecture` -> `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-4-architecture.md`
- `build` -> `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-5-build.md`
- `validate` -> `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-6-validate.md`
- `report` -> `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-7-report.md`

On resume:
1. Read `.kiln/STATE.md` and extract `stage`, `skill`, and `roster`.
2. If `stage` is missing or not one of `onboarding`, `brainstorm`, `research`, `architecture`, `build`, `validate`, `report`, `complete`, fail with: `Kiln resume failed: .kiln/STATE.md is missing a valid stage. Expected one of onboarding, brainstorm, research, architecture, build, validate, report, complete. Fix .kiln/STATE.md or remove it to start fresh.`
3. Resolve `skill`: prefer the stored path when it is readable; otherwise recover to `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md`.
4. If the recovered `skill` path is still unreadable, fail with: `Kiln resume failed: the stored skill path is stale or missing, and the active kiln-pipeline skill was not found at ${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md. Reinstall or repair the Kiln plugin, then retry /kiln-fire.`
5. If `stage: complete`, inform the operator the pipeline already finished. Do not fail because of a stale `roster` path when no blueprint read is needed.
6. Resolve `roster`: prefer the stored path when it is readable; otherwise recover from the deterministic blueprint map for the current `stage`.
7. If the recovered `roster` path is unreadable, fail with: `Kiln resume failed: the stored roster path is stale or missing, and no active blueprint was found for stage '{stage}' at the expected Kiln plugin path. Verify the plugin install at ${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/ and retry /kiln-fire.`
8. If either `skill` or `roster` was recovered, rewrite `.kiln/STATE.md` immediately so it stores the recovered active-plugin-root paths and refresh `updated` with the current UTC timestamp before continuing.
9. Resume from `stage`. Stage maps directly to step number — onboarding = 1, brainstorm = 2, research = 3, architecture = 4, build = 5, validate = 6, report = 7.

## Step Execution Pattern

For each step, follow this exact pattern. No shortcuts, no improvising.

### 0. Pipeline Start (first step only)

**Version check (resume only — fresh runs have no baseline to compare against):**
On resume, compare the active plugin version against the version recorded in STATE.md at onboarding:
```bash
PLUGIN_VERSION=$(cat ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json | jq -r '.version')
STATE_VERSION=$(grep -oP '(?<=\*\*plugin_version\*\*: )\S+' .kiln/STATE.md 2>/dev/null || echo "")
```
If `$STATE_VERSION` is non-empty and differs from `$PLUGIN_VERSION`, emit a loud warning:
```
⚠️ PLUGIN VERSION CHANGED
Onboarding: {STATE_VERSION} | Current: {PLUGIN_VERSION}
If you updated the plugin intentionally, this is expected.
If not, run `/plugin update` to get the latest version.
```
Then update STATE.md with the current version so the warning doesn't repeat. Continue the pipeline — do not halt.

**Cache health check**: Handled automatically by `check-cache.sh` SessionStart hook. No engine action needed.

On fresh run (no `.kiln/STATE.md`), before step 1:
1. ONE turn: Read `.kiln/STATE.md` (check existence — if missing, fresh run confirmed) + Read `lore.json` (select ignition quote) — parallel batch.
2. Immediately output ignition banner — this is the operator's FIRST visible output.
3. ONE turn — scaffolding + blueprint read (parallel batch):
   - Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-1-onboarding.md`
   - Write spinner verbs to `settings.local.json`
   - Run scaffolding via Bash:
     ```bash
     # Git init (unconditional — Codex CLI requires a git repo)
     if [ ! -d .git ]; then git init && git add -A && git commit -m "kiln: project initialized"; fi
     # .kiln/ directory structure
     mkdir -p .kiln/docs .kiln/docs/research .kiln/plans .kiln/archive .kiln/archive/step-3-research .kiln/archive/step-4-architecture .kiln/archive/step-5-build .kiln/archive/step-6-validate .kiln/validation .kiln/tmp .kiln/design
     # Seed hook-gated files (PreToolUse hooks block dispatches until line 1 is <!-- status: complete -->)
     echo '<!-- status: writing -->' > .kiln/docs/architecture.md
     echo '<!-- status: writing -->' > .kiln/docs/codebase-state.md
     echo '<!-- status: writing -->' > .kiln/docs/patterns.md
     # Codex pre-flight (mode check, not blocker)
     timeout 15 codex exec --sandbox danger-full-access "echo kiln-preflight-ok" 2>/dev/null && echo "codex:true" || echo "codex:false"
     ```
   - Capture codex result for STATE.md later (codex:true → codex_available: true)
4. Create team, spawn Phase A (mnemosyne), wait for READY, spawn Phase B (alpha, foreground) + operator greeting.

Budget: 3 turns max. Operator sees banner first, scaffolding is invisible, then Alpha.

On resume (`.kiln/STATE.md` exists with stage != complete):
1. ONE turn: Read `.kiln/STATE.md` + `.kiln/resume.md` + `lore.json` — parallel batch.
2. Immediately output resume banner — this is the operator's FIRST visible output.
3. ONE turn: Resolve bootstrap paths from the active plugin root before failing on stale state, then read the resolved blueprint path + write spinner verbs to `settings.local.json` — parallel batch:
   - Use the stored `skill` and `roster` paths when they are readable.
   - If `skill` is stale or missing, recover to `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md`.
   - If `roster` is stale or missing, recover from `stage` using the deterministic blueprint map above.
   - If either path was recovered, update `.kiln/STATE.md` in the same hidden turn and refresh `updated`.
   - Fail only when the current `stage` is invalid or the active plugin copy of the required file is missing.
4. Create team, spawn.

Budget: 3 turns max.

### 1. Read Blueprint and Step Definition

Read these files for the current step:
- **Blueprint**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-{N}-{name}.md` — three-phase agent roster, communication model, spawn order.
- **Step definition**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/step-definitions.md` — done signals, state transitions, notes.

The blueprint tells you WHO to spawn and in which PHASE. The agent `.md` files (loaded via `subagent_type`) tell each agent WHAT to do. Step-definitions tell you what signals to expect.

(Step 1's blueprint is read during Pipeline Start.)

### 2. Render Transition and Create Team

**Before creating the team**, render the step's transition. Visual vocabulary from `lore-engine.md` and `brand.md` on transitions, exact formats in § Engine Banners. Two parts:

1. **Spinner install + banner output** — Write `settings.local.json` via Bash heredoc to install spinner verbs, then output the transition banner as markdown text. For Build iterations, output the kill streak banner format instead of the standard transition.
2. **Spawning indicator** — markdown block listing agents being spawned.

**No extra narration around the banner.** The banner text IS the presentation. Any surrounding summary should add new information, not repeat the banner.

Then:

```
TeamCreate(team_name="{run_id}-{step_name}", description="Kiln {step_name}")
```

### 3. Three-Phase Spawn

You are the conductor — you spawn agents and wait for signals. You never perform step work yourself. Agents carry specialized logic you don't have: Alpha interviews operators, Da Vinci facilitates brainstorming, scouts map codebases. Even when the work looks trivial — a greenfield project with a clear brief — the agent applies conventions, file structures, and interaction patterns that you would skip. Never create `.kiln/`, `STATE.md`, or any pipeline artifact yourself. Never skip spawning.

The three-phase spawn sequence is defined in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md` § "Three-Phase Spawn". Follow it exactly. Not every step has all three phases — some steps skip Phase C. Step 7 is the exception: omega runs as a solo inline agent with no team (no TeamCreate/TeamDelete).

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

When the boss sends `REQUEST_WORKERS`, validate then spawn each worker on the same team (`run_in_background: true`). Each worker gets a lean runtime prompt including their dynamic name and paired partner:

```
REQUEST_WORKERS: {name} (subagent_type: {type}), {name} (subagent_type: {type})
```

Names are free-form (krs-one picks from a famous duo pool). The `subagent_type` maps to the canonical agent `.md` file.

**Build-Step Worker Validation (Step 5 only):**

When the current stage is `build`, validate every REQUEST_WORKERS payload before spawning. Check `subagent_type` pairs against this table:

| Builder Type | Reviewer Type | Tier |
|-------------|---------------|------|
| codex | sphinx | Codex |
| kaneda | tetsuo | Sonnet |
| daft | punk | Opus |
| clair | obscur | UI |

Validation rules:
1. Each `subagent_type` must be a legal builder or reviewer type from the table above
2. Builder and reviewer must be from the same tier (e.g. codex+punk is invalid)
3. The request must contain exactly 1 builder + 1 reviewer
4. Generic types (`code`, `agent`, `worker`, etc.) are NEVER valid for build step
5. Names are free-form — do NOT validate the `name` parameter, only `subagent_type`

If validation fails, do NOT spawn. Send an error to the boss:

```
SendMessage(type: "message", recipient: "{boss_name}", content: "WORKERS_REJECTED: {reason}. Build step requires a builder+reviewer pair from the same tier. Legal pairs (by subagent_type): codex+sphinx (Codex), kaneda+tetsuo (Sonnet), daft+punk (Opus), clair+obscur (UI). Format: REQUEST_WORKERS: {name} (subagent_type: {builder_type}), {name} (subagent_type: {reviewer_type}).")
```

Only proceed to spawning once the full request passes all five rules.

**Identity injection for build-step workers:** The engine knows both names from the REQUEST_WORKERS line. Inject identity into each worker's runtime prompt:
- Builder: `Your name on this team is "{builder_name}". Your paired reviewer is "{reviewer_name}".`
- Reviewer: `Your name on this team is "{reviewer_name}". Your paired builder is "{builder_name}".`

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
)
```

**Naming**: The `name` parameter controls what the operator sees in the UI header for every agent spawn. It should read like a character entering the scene — just their name and personality quote. Adding prefixes, namespaces, or team identifiers to `name` pollutes the operator's view with plumbing they don't need. The blueprint roster has the exact names — use them as-is.

**Every parameter is required.** Without `team_name`, agents spawn as isolated subagents — no SendMessage, no shutdown, no team pattern.

### 4. Engine Modes

Bootstrap plumbing is invisible. The engine batches prerequisite reads into parallel tool calls and outputs the banner as its first visible text. The operator never sees file reads, spinner installation, or state checks — only the ignition/resume banner followed by the first agent.

Engine behavior during three-phase transitions depends on step type:

**Interactive (Steps 1, 2, 4):** Banner → spawning indicator → spawn boss in foreground → operator greeting → silent handoff. No progress beats. The boss IS the operator's interface — engine goes quiet until the boss signals done.

**Operator greeting**: Engine's last output before going silent. Greeting text lives in `lore-engine.md`.

**Background (Steps 3, 5, 6, 7):** Banner → progress beats at each phase transition → idle voice during wait. Progress beats are one line per event with real information from READY signals:

```
◆ rakim bootstrapping...
✓ rakim ready — M2 in progress, 3/5 deliverables done. Key: src/components/LinkCard.tsx
◆ KRS-One entering — iteration 4, milestone M2...
✓ KRS-One: requesting bonnie+clyde (daft+punk)
◆ Spawning bonnie, clyde...
```

Progress beats surface real information from READY signals and state. The operator should learn something from each line — what milestone, how far along, which agents. Never output template variables or generic status.

### 5. Wait for Done Signal

The engine waits for the boss's completion signal. Messages from the team arrive automatically. Do not read files, create tasks, or intervene.

**INTERACTIVE steps (Steps 1, 2, 4) — HANDS OFF.** The boss talks to the human. Wait silently and indefinitely — never nudge, re-spawn, take over, or assume the boss is stuck.

**Non-interactive steps (Steps 3, 5, 6, 7)**: if an agent seems stuck (no activity for 5+ minutes), send ONE nudge via SendMessage. If still stuck after another 5 minutes, send one more. Never re-spawn or take over.

**Idle voice**: when the platform forces a response (`idle_notification`), output a lore-flavored one-liner from the current step's spinner verbs. Vary each time — never repeat the same line twice in a row. Never say "standing by", "waiting for signal", or any mechanical status update.

### 6. Shutdown and Transition

1. **Shutdown agents**: Send `shutdown_request` to each agent individually, in parallel. Do not use broadcast — shutdown is an orderly per-agent protocol, not an announcement.
2. **Wait for confirmations or termination**: Track a wait set of all agents that received `shutdown_request`. An agent is cleared from the wait set when EITHER:
   - It sends `shutdown_response` (confirmation), OR
   - A `teammate_terminated` event is observed for that agent (system already killed it).
   Wait until ALL agents are cleared. If any agent has neither confirmed nor terminated after 60 seconds, treat it as terminated and proceed — do not wait indefinitely.
3. **TeamDelete**: Only after the wait set is empty (all agents confirmed, terminated, or timed out).
4. **Then step 2 (Render Transition and Create Team)** for the next step. Always delete the old team before creating the new one — one team at a time, or TeamCreate fails on name collision.

### 7. Process Signal and Transition

Based on the boss's done signal, determine next action:

**Step 1 done** -> validate onboarding artifacts BEFORE shutdown (Alpha is still alive):
  1. Read `.kiln/STATE.md` via Bash: verify `## Flags` section exists and contains `codex_available` AND `arch_review`
  2. Verify `.kiln/resume.md` exists
  If validation fails: send error to Alpha describing what is missing, wait for Alpha to fix and re-signal ONBOARDING_COMPLETE. Do NOT shut down the team yet.
  If validation passes: proceed to shutdown and transition to step 2.
**Step 1 blocked** (ONBOARDING_BLOCKED) -> render `halt` banner, inform operator of the blocker details, stop pipeline
**Step 2 done** (BRAINSTORM_COMPLETE) -> verify `.kiln/docs/VISION.md` exists and is non-empty before proceeding to step 3. If missing, wait up to 30s (check every 5s), then nudge the vision curator if still missing.
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
    - If < 3: render `correction_start` banner, increment correction_cycle in STATE.md, loop back to step 5. Correction dispatch follows the same structure as a normal Build iteration — KRS-One bootstraps persistent minds, reads the correction report at `.kiln/validation/report.md`, scopes a targeted fix, dispatches to a builder. Do NOT inline the correction tasks or give KRS-One a vague "execute this." He scopes and delegates like any other iteration.
    - If >= 3: render `halt` banner, escalate to operator, stop pipeline
**Step 7 done** (REPORT_COMPLETE) -> render `project_complete` banner, pipeline complete

When writing STATE.md at step transitions, always include the `skill` and `roster` bootstrap paths from the active plugin root. Set `skill` to `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md` and set `roster` to the next step's blueprint path under `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/`. Never preserve a stale cache or previous install path when writing new state. These fields enable cold-start resume after session breaks.

**Step timing**: At the start of each step, write `step_N_start: {ISO 8601 timestamp}` to STATE.md. When the step signals done, write `step_N_end: {ISO 8601 timestamp}`. Use `date -u +%Y-%m-%dT%H:%M:%SZ` via Bash for consistent formatting. Omega uses these timestamps to build the pipeline timing table in REPORT.md.

**Gate log**: gate-log.md is optional. If alpha seeded it during onboarding, the engine may append a one-line entry at step transitions. Do not let gate-log writes block or delay the transition flow.

## Signal Processing via Tasklist

At each step transition, create a private `TaskCreate` chain for the current step. Use `blockedBy` so every task is either a `Spawn ...` action or a `Wait for ...` action, and the chain advances strictly in order.

On every turn, check `TaskList` and find the current `in_progress` task. If it is a `Wait for X` task, scan ALL received teammate messages for signal `X`. Process EVERY teammate-message block in the input; do not stop after the first match. If the signal is found, mark the task complete and immediately continue to the next unblocked task. If not found, STOP and wait for more messages.

After receiving any teammate message, check TaskList first to identify your current in_progress task. Match the incoming message against the expected signal. Then act on the result.

Use the exact signal names from `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/step-definitions.md`. Rebuild the tasklist at every step transition; Build iterations also rebuild the full chain. The tasklist is engine-only: agents never touch it and use `SendMessage` only. When transitioning between steps, delete all previous tasks (`TaskUpdate status: deleted`) before creating the new step's chain.

**Step 1**
- `Spawn Phase A`
- `Wait READY`
- `Spawn Phase B`
- `Wait REQUEST_WORKERS` or `ONBOARDING_COMPLETE` (brownfield: mnemosyne requests scouts; greenfield: skip straight to done)
- If REQUEST_WORKERS: `Spawn requested scouts`, then `Wait ONBOARDING_COMPLETE`

**Step 2**
- `Spawn Phase A`
- `Wait READY`
- `Spawn Phase B`
- `Wait BRAINSTORM_COMPLETE`

**Step 3**
- `Spawn mi6 + thoth`
- `Wait REQUEST_WORKERS`
- `Spawn requested field agents`
- `Wait RESEARCH_COMPLETE`

**Step 4**
- `Spawn numerobis + thoth`
- `Wait READY` (both), then `Spawn aristotle`
- `Wait REQUEST_WORKERS` / `Spawn requested wave` x3
- `Wait ARCHITECTURE_COMPLETE` or `PLAN_BLOCKED`

**Step 5**
- `Spawn rakim + sentinel + thoth`
- `Wait READY from rakim, sentinel, AND thoth (all 3 required)`, then `Spawn krs-one`
- `Wait REQUEST_WORKERS`, then `Spawn requested workers`
- `Wait ITERATION_COMPLETE`, `MILESTONE_COMPLETE`, or `BUILD_COMPLETE`

**Step 6**
- `Spawn zoxea`
- `Wait READY`, then `Spawn argus`
- `Wait REQUEST_WORKERS` or `VALIDATE_PASS` or `VALIDATE_FAILED` (REQUEST_WORKERS: argus requests hephaestus for design QA — conditional)
- If REQUEST_WORKERS: `Spawn hephaestus`, then `Wait VALIDATE_PASS` or `VALIDATE_FAILED`

**Step 7**
- `Spawn omega`
- `Wait REPORT_COMPLETE`

## Build Loop — Kill Streak Names

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md` for Build step team naming (required at every Build step entry). The kill streak announcement is rendered as part of step 2 (Render Transition and Create Team) — bold orange banner with the streak name in ALL CAPS.

## Artifact Verification

Before each step, verify required input artifacts exist (see `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/artifact-flow.md`). If critical artifacts are missing, inform the operator rather than proceeding blind.
