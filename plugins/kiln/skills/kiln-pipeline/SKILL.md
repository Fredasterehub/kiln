---
name: kiln-pipeline
description: >-
  Kiln multi-modal software creation pipeline. Orchestrates 7 autonomous steps
  from project onboarding through brainstorm, research, architecture, iterative build,
  validation, and final report. Use when the user invokes /kiln-fire.
version: 1.2.0
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

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/lore-engine.md` for the full presentation protocol (banners, transitions, event-to-lore-key mapping, spinner install).
Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/brand.md` for visual vocabulary and brand tokens.

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
1. Read `.kiln/STATE.md` (confirm missing) + `lore.json` (select ignition quote) in parallel.
2. Output ignition banner — operator's first visible output.
3. In parallel: read step-1 blueprint, write spinner verbs to `settings.local.json`, run scaffolding:
   ```bash
   if [ ! -d .git ]; then git init && git add -A && git commit -m "kiln: project initialized"; fi
   mkdir -p .kiln/docs .kiln/docs/research .kiln/plans .kiln/archive .kiln/archive/step-3-research .kiln/archive/step-4-architecture .kiln/archive/step-5-build .kiln/archive/step-6-validate .kiln/validation .kiln/tmp .kiln/design
   echo '<!-- status: writing -->' > .kiln/docs/architecture.md
   echo '<!-- status: writing -->' > .kiln/docs/codebase-state.md
   echo '<!-- status: writing -->' > .kiln/docs/patterns.md
   timeout 15 codex exec --sandbox danger-full-access "echo kiln-preflight-ok" 2>/dev/null && echo "codex:true" || echo "codex:false"
   ```
   Capture codex result for STATE.md (codex:true → codex_available: true).
4. Create team, spawn Phase A (mnemosyne), wait for READY, spawn Phase B (alpha, foreground) + operator greeting.

On resume (`.kiln/STATE.md` exists with stage != complete):
1. Read `.kiln/STATE.md` + `.kiln/resume.md` + `lore.json` in parallel.
2. Output resume banner — operator's first visible output.
3. Resolve bootstrap paths: prefer stored `skill`/`roster` when readable; recover from active plugin root if stale. Read resolved blueprint + write spinner verbs in parallel. If either path was recovered, update `.kiln/STATE.md`. Fail only when `stage` is invalid or the active plugin file is missing.
4. Create team, spawn.

### 1. Read Blueprint and Step Definition

Read the blueprint for the current step:
- **Blueprint**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-{N}-{name}.md` — three-phase agent roster, communication model, spawn order.

The blueprint tells you WHO to spawn and in which PHASE. The agent `.md` files (loaded via `subagent_type`) tell each agent WHAT to do. Step definitions and signal vocabulary are in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md` (§ Step Definitions).

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

You are the conductor — you spawn agents and wait for signals. You never perform step work yourself. Never create `.kiln/`, `STATE.md`, or any pipeline artifact yourself. Never skip spawning.

Follow `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md` § "Three-Phase Spawn" exactly. The engine-specific additions are:

1. **Build-step worker validation** (Step 5): validate every REQUEST_WORKERS payload against the legal builder+reviewer pairs (codex+sphinx, kaneda+sphinx, clair+obscur). If invalid, send WORKERS_REJECTED to the boss. See team-protocol.md § Build-Step Worker Validation for the full table and rules.
2. **CYCLE_WORKERS protocol** (below): mid-milestone worker cycling initiated by KRS-One.

#### CYCLE_WORKERS — Mid-Milestone Worker Cycling (Step 5 Only)

During a milestone, KRS-One may request fresh workers between iterations via `CYCLE_WORKERS` instead of `REQUEST_WORKERS`. This replaces the current builder+reviewer pair without tearing down the team — persistent minds (rakim, sentinel, thoth) and KRS-One stay alive throughout the milestone.

**CYCLE_WORKERS payload format:**
```
CYCLE_WORKERS: scenario={default|fallback|ui}, reason="{why cycling}", chunk="{chunk summary}"
```

**Engine protocol on receiving CYCLE_WORKERS:**

1. **Validate scenario** — map to builder+reviewer pair:

   | Scenario | Builder | Reviewer |
   |----------|---------|----------|
   | default | codex | sphinx |
   | fallback | kaneda | sphinx |
   | ui | clair | obscur |

   If the scenario is unrecognized, reject:
   ```
   SendMessage(type: "message", recipient: "krs-one", content: "CYCLE_REJECTED: Unknown scenario '{scenario}'. Valid scenarios: default, fallback, ui.")
   ```

2. **Shutdown current workers** — send `shutdown_request` to the current builder and reviewer (if any exist). Wait for `shutdown_response` or `teammate_terminated` from both (60s timeout). Force-terminate on timeout. Do NOT shut down persistent minds or KRS-One.

3. **Spawn fresh pair** — spawn the new builder+reviewer on the existing team using the same validation rules as Phase C. Use canonical type names (`name: "codex"`, not cosmetic names). Each fresh worker starts with a clean context — this is the point of cycling.

4. **Confirm to KRS-One** — send WORKERS_SPAWNED with the new agent names:
   ```
   SendMessage(
     type: "message",
     recipient: "krs-one",
     content: "WORKERS_SPAWNED: {builder_name} (subagent_type: {builder_type}), {reviewer_name} (subagent_type: {reviewer_type}). Fresh context, awaiting assignment."
   )
   ```

5. **Update progress beat** — output a one-line progress beat for the operator:
   ```
   ◆ Cycling workers — {reason}. Spawning {builder_name}+{reviewer_name} ({scenario})...
   ```

**CYCLE_WORKERS vs REQUEST_WORKERS:** REQUEST_WORKERS is the initial Phase C spawn at the start of build. CYCLE_WORKERS is the mid-milestone replacement that shuts down existing workers first. Both use the same scenario validation table. The key difference: CYCLE_WORKERS always sends `shutdown_request` to existing workers before spawning, and it is initiated by KRS-One (not as a response to an initial team setup).

#### Spawn Parameters

For every agent, use ALL of these parameters:

```
Agent(
  name: "{agent_name}",           # from blueprint roster — EXACT name, no prefix
  description: "{personality}",    # random quote from agents.json — vary each spawn
  team_name: "{team_name}",       # the team from step 2 — REQUIRED
  subagent_type: "{agent_name}",  # matches the .md file in agents/
  prompt: "<lean runtime prompt>",
  run_in_background: true/false,  # interactive steps (1,2,4): boss=false; background steps (3,5,6,7): true
)
```

**Naming**: The `name` parameter controls what the operator sees in the UI header for every agent spawn. It should read like a character entering the scene — just their name and personality quote. Adding prefixes, namespaces, or team identifiers to `name` pollutes the operator's view with plumbing they don't need. The blueprint roster has the exact names — use them as-is.

**Every parameter is required.** Without `team_name`, agents spawn as isolated subagents — no SendMessage, no shutdown, no team pattern.

Bootstrap plumbing is invisible — batch prerequisite reads in parallel, output the banner as the first visible text. Interactive steps (1, 2, 4): banner → spawning indicator → spawn boss in foreground → operator greeting (text in `lore-engine.md`) → engine goes silent. Background steps (3, 5, 6, 7): banner → one-line progress beats at each phase transition surfacing real information from READY signals.

### 4. Wait for Done Signal

The engine waits for the boss's completion signal. Messages from the team arrive automatically. Do not read files, create tasks, or intervene.

**INTERACTIVE steps (Steps 1, 2, 4) — HANDS OFF.** The boss talks to the human. Wait silently and indefinitely — never nudge, re-spawn, take over, or assume the boss is stuck.

**Non-interactive steps (Steps 3, 5, 6, 7) — Watchdog Protocol:**

Every `idle_notification` is a health check opportunity. Do NOT waste it on poetry. On each idle notification:

1. **Check TaskList** — what is the current `in_progress` task? What signal are you waiting for?
2. **Scan received messages** — did the expected signal arrive in a format you didn't recognize? Look for partial matches, misspelled signals, wrong casing, READY instead of REQUEST_WORKERS, etc.
3. **Check agent liveness** — has the agent you're waiting on sent ANY message recently? If yes but the signal was malformed, send a corrective message: "Expected `{signal}`, received `{what_they_sent}`. Please resend in the correct format."
4. **Nudge if silent** — if the agent has sent nothing since spawn or last assignment, send ONE targeted nudge via SendMessage reminding them of their expected action. Include the exact signal format they should send.
5. **Track nudge count** — after 3 nudges to the same agent with no response or progress, stop nudging that agent and report to the operator: "Agent {name} unresponsive after 3 nudges. Pipeline stalled at {task}. Operator intervention needed."

**Stagnation rule:** If the current `in_progress` task has not changed across 3 consecutive idle notifications, the pipeline is stalled. Report the stall clearly to the operator with the task name, the agent you're waiting on, and the last message received from that agent. Then STOP — do not loop.

**Idle voice (fallback only):** If the health check finds everything normal (agent is actively working, just slow), THEN output a brief lore-flavored one-liner. But health check comes first — every time.

### 5. Shutdown and Transition

1. **Shutdown agents**: Send `shutdown_request` to each agent individually, in parallel. Do not use broadcast — shutdown is an orderly per-agent protocol, not an announcement.
2. **Wait for confirmations or termination**: Track a wait set of all agents that received `shutdown_request`. An agent is cleared from the wait set when EITHER:
   - It sends `shutdown_response` (confirmation), OR
   - A `teammate_terminated` event is observed for that agent (system already killed it).
   Wait until ALL agents are cleared. If any agent has neither confirmed nor terminated after 60 seconds, treat it as terminated and proceed — do not wait indefinitely.
3. **TeamDelete**: Only after the wait set is empty (all agents confirmed, terminated, or timed out).
4. **Then § 2 (Render Transition and Create Team)** for the next step. Always delete the old team before creating the new one — one team at a time, or TeamCreate fails on name collision.

### 6. Process Signal and Transition

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
  - CYCLE_WORKERS -> KRS-One requests fresh workers mid-milestone. Execute the full CYCLE_WORKERS protocol (see § CYCLE_WORKERS above): validate scenario, shutdown current builder+reviewer, spawn fresh pair, send WORKERS_SPAWNED back to KRS-One. Do NOT tear down the team — persistent minds and KRS-One stay alive. Do NOT transition steps. After sending WORKERS_SPAWNED, return to waiting for the next signal. Update `build_iteration` in STATE.md.
  - ITERATION_COMPLETE -> (legacy/internal — CYCLE_WORKERS is preferred) Render `phase_complete` banner, increment `build_iteration` in STATE.md. This signal carries no scenario information, so wait for KRS-One's next CYCLE_WORKERS to determine the scenario. Loop back to wait.
  - MILESTONE_QA_READY -> KRS-One has verified deliverable completeness, requesting independent QA. Execute the full QA Tribunal protocol (see § MILESTONE_QA_READY below). After relaying QA_VERDICT to KRS-One, return to waiting for the next signal (MILESTONE_COMPLETE or back to CYCLE_WORKERS if QA failed).
  - MILESTONE_COMPLETE -> Full team lifecycle reset:
    1. Render `milestone_complete` banner. Increment `milestones_complete` in STATE.md.
    2. **Pre-shutdown check**: Verify all persistent minds have `<!-- status: complete -->` in their owned files (codebase-state.md, patterns.md). If any missing, wait 30s and re-check (max 3 times), then proceed with warning.
    3. Send `shutdown_request` to ALL agents (PMs, KRS-One, any remaining workers). Wait for responses (60s timeout, force-terminate on timeout).
    4. **TeamDelete** — tear down the entire milestone team.
    5. If `milestones_complete < milestone_count`:
       a. Create new team (`TeamCreate` with next kill-streak name).
       b. Re-spawn persistent minds (rakim, sentinel, thoth) — fresh context, they read their files on bootstrap.
       c. Re-spawn krs-one with updated milestone context.
       d. Wait for READY from PMs, then resume build loop.
    6. If all milestones done: wait for BUILD_COMPLETE from krs-one (sent before MILESTONE_COMPLETE in the final milestone).
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

#### MILESTONE_QA_READY — Egyptian Judgment Tribunal (Step 5 Only)

When KRS-One sends `MILESTONE_QA_READY: {milestone_name}`, the engine orchestrates independent dual-model QA via three dedicated agents (maat, anubis, osiris). KRS-One blocks on QA_VERDICT (300s timeout).

**Engine protocol on receiving MILESTONE_QA_READY:**

1. **Pre-package PM context for anubis** — Read the TL;DR headers from rakim's `.kiln/docs/codebase-state.md` and sentinel's `.kiln/docs/patterns.md` (first 30 lines of each). Anubis is a thin Codex CLI wrapper that does NOT consult PMs directly — the engine pre-packages this context into its runtime prompt.

2. **Spawn maat + anubis (parallel, background):**
   ```
   Agent(name: "maat", subagent_type: "kiln:maat", team_name: "{team_name}",
     run_in_background: true,
     prompt: "You are 'maat' on team '{team_name}'. Step 5: Build — Milestone QA.
     Milestone under review: {milestone_name}.
     Working dir: {working_dir}. Master plan: .kiln/master-plan.md.
     {protocol_injection_full}
     Run your QA analysis. Consult rakim and sentinel as needed.")

   Agent(name: "anubis", subagent_type: "kiln:anubis", team_name: "{team_name}",
     run_in_background: true,
     prompt: "You are 'anubis' on team '{team_name}'. Step 5: Build — Milestone QA.
     Milestone under review: {milestone_name}.
     Working dir: {working_dir}. Master plan: .kiln/master-plan.md.
     Codebase state summary:\n{rakim_tldr}
     Patterns summary:\n{sentinel_tldr}
     {protocol_injection_worker}
     Construct your QA prompt for GPT-5.4 and invoke codex exec.")
   ```

3. **Wait for TWO distinct QA_REPORT_READY signals** — create two separate wait tasks:
   - "Wait for QA_REPORT_READY from maat"
   - "Wait for QA_REPORT_READY from anubis"
   Track by sender. Both must arrive before proceeding. 300s timeout for the pair.

4. **Spawn osiris (background)** after both reports are ready:
   ```
   Agent(name: "osiris", subagent_type: "kiln:osiris", team_name: "{team_name}",
     run_in_background: true,
     prompt: "You are 'osiris' on team '{team_name}'. Step 5: Build — Milestone QA Synthesis.
     Milestone: {milestone_name}. Working dir: {working_dir}.
     Two QA reports are ready: .kiln/tmp/qa-maat-report.md and .kiln/tmp/qa-anubis-report.md.
     {protocol_injection_full}
     Read both reports, synthesize, and signal QA_PASS or QA_FAIL.")
   ```

5. **Wait for QA_PASS or QA_FAIL from osiris** — single wait task. 300s timeout.

6. **Shutdown QA agents** — send `shutdown_request` to maat, anubis, and osiris. Wait for confirmations (60s timeout). Force-terminate on timeout.

7. **Relay verdict to KRS-One:**
   ```
   SendMessage(type: "message", recipient: "krs-one",
     content: "QA_VERDICT: {PASS or FAIL}. {osiris's findings summary}")
   ```

8. **Return to signal wait loop** — do NOT transition steps. KRS-One decides next action (MILESTONE_COMPLETE on PASS, re-scope on FAIL).

#### Protocol Injection (Runtime)

Every agent spawn MUST include a role-appropriate protocol block in its runtime prompt. This is Layer 2 enforcement (Layer 1 = agent.md bootstrap Read, Layer 3 = enforce-pipeline.sh hook).

**Full protocol** — for bosses, persistent minds, QA agents (maat, osiris, aristotle, krs-one, rakim, sentinel, etc.):
```
## Kiln Protocol (Runtime)
- SendMessage is the ONLY way to reach teammates. Plain text is invisible to agents.
- After sending a message expecting a reply, STOP your turn. Never sleep-poll.
- One message per wake-up. Process it fully before acting.
- Signal format: SendMessage(type:"message", recipient:"team-lead", content:"SIGNAL_NAME: context")
- On shutdown_request: approve immediately — SendMessage(type:"shutdown_response", request_id:"{id}", approve:true). No delay, no summary.
- Consult persistent minds when uncertain: rakim (codebase state), sentinel (patterns).
- Consultation: send question → STOP → wait for reply → continue. Use sparingly.
- Chunk scope is immutable after dispatch. New info goes in the next assignment.
- NEVER read/write: .env, *.pem, *_rsa, *.key, credentials.json, secrets.*, .npmrc
```

**Worker protocol** — for builders, reviewers (codex, kaneda, clair, sphinx, obscur, anubis):
```
## Kiln Protocol (Runtime)
- SendMessage is the ONLY way to reach teammates. Plain text is invisible to agents.
- After sending a message expecting a reply, STOP your turn. Never sleep-poll.
- One message per wake-up. Process it fully before acting.
- Signal format: SendMessage(type:"message", recipient:"{name}", content:"{SIGNAL}: {context}")
- On shutdown_request: approve immediately — SendMessage(type:"shutdown_response", request_id:"{id}", approve:true). No delay, no summary.
- Consult persistent minds when uncertain: rakim (codebase state), sentinel (patterns). Send question → STOP → wait → continue.
- NEVER read/write: .env, *.pem, *_rsa, *.key, credentials.json, secrets.*, .npmrc
```

**Fire-and-forget protocol** — for thoth:
```
## Kiln Protocol (Runtime)
- SendMessage is the ONLY way to reach teammates. Plain text is invisible to agents.
- One message per wake-up. Process it fully before acting.
- On shutdown_request: approve immediately — SendMessage(type:"shutdown_response", request_id:"{id}", approve:true). No delay, no summary.
- NEVER read/write: .env, *.pem, *_rsa, *.key, credentials.json, secrets.*, .npmrc
```

Select the variant matching the agent's role. Include it verbatim in the `prompt` parameter — do not summarize or abbreviate.

## Signal Processing via Tasklist

At each step transition, create a private `TaskCreate` chain for the current step. Use `blockedBy` so every task is either a `Spawn ...` action or a `Wait for ...` action, and the chain advances strictly in order.

On every turn, check `TaskList` and find the current `in_progress` task. If it is a `Wait for X` task, scan ALL received teammate messages for signal `X`. Process EVERY teammate-message block in the input; do not stop after the first match. If the signal is found, mark the task complete and immediately continue to the next unblocked task. If not found, STOP and wait for more messages.

After receiving any teammate message, check TaskList first to identify your current in_progress task. Match the incoming message against the expected signal. Then act on the result.

**Malformed signal recovery:** If a teammate message does NOT match the expected signal but DOES contain a recognizable intent (e.g. `READY` when you expected `REQUEST_WORKERS`, or a signal with wrong casing, or a signal buried in prose), do NOT silently ignore it. Send a corrective reply: "I received your message but expected signal `{expected}`. You sent `{what_they_sent}`. Please resend as exactly: `{expected}: {format}`." This prevents the deadlock where both sides think they communicated correctly.

Use the exact signal names from `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md` (§ Signal Vocabulary). Rebuild the tasklist at every step transition; Build iterations also rebuild the full chain. The tasklist is engine-only: agents never touch it and use `SendMessage` only. When transitioning between steps, delete all previous tasks (`TaskUpdate status: deleted`) before creating the new step's chain.

Read the current step's blueprint for the step-specific spawn/wait sequence. Each blueprint defines the Phase A/B/C roster, the signals to wait for, and any conditional branches (e.g. brownfield scout requests in step 1, argus→hephaestus branch in step 6). The blueprint is the authoritative task chain for that step.

## Build Loop — Kill Streak Names

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md` for Build step team naming (required at every Build step entry). The kill streak announcement is rendered as part of step 2 (Render Transition and Create Team) — bold orange banner with the streak name in ALL CAPS.

## Artifact Verification

Before each step, verify required input artifacts exist (see `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/artifact-flow.md`). If critical artifacts are missing, inform the operator rather than proceeding blind.
