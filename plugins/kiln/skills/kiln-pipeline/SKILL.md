---
name: kiln-pipeline
description: >-
  Kiln multi-modal software creation pipeline. Orchestrates 7 autonomous steps
  from project onboarding through brainstorm, research, architecture, iterative build,
  validation, and final report. Use when the user invokes /kiln-fire.
version: 1.5.1
user-invocable: false
context: fork
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, TeamCreate, TeamDelete, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage
---

# Kiln Pipeline Engine

The engine body for the Kiln creation pipeline. This skill is read by the forked host session when `/kiln-fire` runs — it is not a prompt scoped to any agent. The forked session consumes it at xhigh effort, orchestrates seven sequential steps, spawns team rosters from blueprints, and consumes `.kiln/STATE.md` as its resume substrate.

The host session is the conductor. The conductor spawns agents, waits for signals, renders transitions, and rewrites STATE.md at step boundaries. Step work itself — editing source, reviewing diffs, running Codex — belongs to the spawned teams. If the engine ever finds itself authoring artifacts instead of dispatching, that is drift: dispatch instead.

## Prerequisites

Environment scaffolding (git init, `.kiln/` structure, hook-gated seed files) runs in the engine between the ignition banner and alpha's spawn. Alpha then handles the interactive onboarding conversation: working directory, project name, description, preferences.

**Codex CLI canonical invocation** (every agent that calls Codex uses this exact pattern — agents and reviewers grep the string, so drift here breaks them):
```
codex exec --sandbox danger-full-access -C "{working_dir}" < /tmp/kiln_prompt.md
```

**Prompt file creation**: Create prompt files via Bash heredoc (`cat <<'EOF' > /tmp/kiln_prompt.md`), not the Write tool. Write requires a prior Read on the file path, which fails on new files and wastes a tool call.

## Pipeline Overview

Seven steps, executed sequentially. Each step is a team of pre-defined agents.

1. **Onboarding** (Alpha) — INTERACTIVE — detect project, create `.kiln/`, map codebase if brownfield
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

Read `.kiln/STATE.md` to determine pipeline state. If it does not exist, start from step 1.

STATE.md fields:
- `skill`: absolute path to this skill file under the active plugin root. On resume, use the stored path if it is readable; otherwise recover to `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md`.
- `roster`: absolute path to the current step's blueprint under the active plugin root. On resume, use the stored path if it is readable; otherwise recover from `stage` using the deterministic blueprint map below.
- `stage`: current step name (`onboarding`, `brainstorm`, `research`, `architecture`, `build`, `validate`, `report`, `complete`).
- `team_iteration`: milestone-indexed counter (init 1, +1 per MILESTONE_TRANSITION). Drives kill-streak team naming.
- `chunk_count`: within-milestone CYCLE_WORKERS counter (init 0, +1 per CYCLE_WORKERS, reset to 0 on MILESTONE_TRANSITION). Drives chunk archive file names (`chunk-{N}-*`).
- `milestone_count`: total milestones from Architecture.
- `milestones_complete`: completed milestone count.
- `correction_cycle`: Validate->Build correction count (max 3).
- `run_id`: pipeline run identifier.
- `path`: working directory path.
- `started`: run start date.
- `updated`: last state update date.
- `step_N_start`: ISO 8601 timestamp when step N began (written at each step transition).
- `step_N_end`: ISO 8601 timestamp when step N completed (written when the step signals done).

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

The pattern below is the whole cycle: render, create team, spawn, wait, shut down, transition. Deviating (skipping a render, double-creating teams, editing files the team owns) produces state drift that later steps cannot recover from — so every step runs through all six sub-stages even when one looks unnecessary.

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
Then update STATE.md with the current version so the warning does not repeat. Continue the pipeline — do not halt.

**Cache health check**: Handled automatically by `check-cache.sh` SessionStart hook. No engine action needed.

On fresh run (no `.kiln/STATE.md`), before step 1:
1. Read `.kiln/STATE.md` (confirm missing) + `lore.json` (select ignition quote) in parallel.
2. Output ignition banner — the operator's first visible output.
3. In parallel: read the step-1 blueprint, write spinner verbs to `settings.local.json`, run scaffolding:
   ```bash
   if [ ! -d .git ]; then git init && git add -A && git commit -m "kiln: project initialized"; fi
   mkdir -p .kiln/docs .kiln/docs/research .kiln/plans .kiln/archive .kiln/archive/step-3-research .kiln/archive/step-4-architecture .kiln/archive/step-5-build .kiln/archive/step-6-validate .kiln/validation .kiln/tmp .kiln/design
   echo '<!-- status: writing -->' > .kiln/docs/architecture.md
   echo '<!-- status: writing -->' > .kiln/docs/codebase-state.md
   echo '<!-- status: writing -->' > .kiln/docs/patterns.md
   timeout 15 codex exec --sandbox danger-full-access "echo kiln-preflight-ok" 2>/dev/null && echo "codex:true" || echo "codex:false"
   ```
   Capture the codex result for STATE.md (`codex:true` → `codex_available: true`).
4. Create the team, spawn Phase A (mnemosyne), wait for READY, spawn Phase B (alpha, foreground) + operator greeting.

On resume (`.kiln/STATE.md` exists with stage != complete):
1. Read `.kiln/STATE.md` + `.kiln/resume.md` + `lore.json` in parallel.
2. Output the resume banner — operator's first visible output.
3. Resolve bootstrap paths: prefer stored `skill`/`roster` when readable; recover from the active plugin root if stale. Read the resolved blueprint + write spinner verbs in parallel. If either path was recovered, update `.kiln/STATE.md`. Fail only when `stage` is invalid or the active plugin file is missing.
4. Create the team, spawn.

### 1. Read Blueprint and Step Definition

Read the blueprint for the current step:
- **Blueprint**: `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/step-{N}-{name}.md` — three-phase agent roster, communication model, spawn order.

The blueprint tells you WHO to spawn and in which PHASE. The agent `.md` files (loaded via `subagent_type`) tell each agent WHAT to do. Step definitions and signal vocabulary are in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md` (§ Step Definitions).

(Step 1's blueprint is read during Pipeline Start.)

### 2. Render Transition and Create Team

Before creating the team, render the step's transition. Visual vocabulary from `lore-engine.md` and `brand.md` on transitions, exact formats in § Engine Banners. Two parts:

1. **Spinner install + banner output** — Write `settings.local.json` via Bash heredoc to install spinner verbs, then output the transition banner as markdown text. For Build iterations, output the kill streak banner format instead of the standard transition.
2. **Spawning indicator** — markdown block listing agents being spawned. Format per agent: `` → `{spawn_name}` (`{agent_type}`) — "{personality_quote}" ``. See `lore-engine.md` for full examples.

The banner text is the presentation. Extra narration around it either duplicates the banner or dilutes it — add surrounding text only when it introduces new information.

Then:

```
TeamCreate(team_name="{run_id}-{step_name}", description="Kiln {step_name}")
```

### 3. Three-Phase Spawn

The engine's role is conductor: spawn agents, wait for signals. It does not perform step work, does not create `.kiln/`, `STATE.md`, or other pipeline artifacts itself, and does not skip spawning. The pattern below is what the conductor actually does.

Follow `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md` § "Three-Phase Spawn" exactly. The engine-specific additions are:

1. **Build-step worker validation** (Step 5): validate every REQUEST_WORKERS payload against the legal builder+reviewer pairs (dial-a-coder+critical-thinker, backup-coder+critical-thinker, la-peintresse+the-curator). If invalid, send WORKERS_REJECTED to the boss. See team-protocol.md § Build-Step Worker Validation for the full table and rules.
2. **REQUEST_WORKERS protocol** (below): universal Phase C spawn handler for every step.
3. **CYCLE_WORKERS protocol** (below): mid-milestone worker cycling initiated by KRS-One.

#### REQUEST_WORKERS — Universal Phase C Spawn (Wave 4 C6)

Every boss that spawns workers sends `REQUEST_WORKERS` and then stops waiting for a `WORKERS_SPAWNED` confirmation. Five bosses use this across the pipeline: mnemosyne (Step 1 scouts), mi6 (Step 3 field agents), aristotle (Step 4 planners + diogenes + plato + athena), argus (Step 6 hephaestus), krs-one's first Phase C spawn at Step 5 (before cycling via CYCLE_WORKERS). Pre-Wave-4 the engine documented WORKERS_SPAWNED only for CYCLE_WORKERS, so every non-Step-5 boss depended on engine LLM extrapolation. This section makes the contract explicit.

**REQUEST_WORKERS payload format:**
```
REQUEST_WORKERS: {name} (subagent_type: {type}[, {key}={value}]*), {name} (subagent_type: {type}[, {key}={value}]*), ...
```

The worker tuple's required fields are `{name}` and `subagent_type: {type}`. Bosses may append any number of extra `{key}={value}` pairs (comma-separated, inside the parentheses) to communicate per-worker configuration the engine must inject into the runtime prompt. The live example is Aristotle at Step 4, which passes `slot=a` / `slot=b` to self-anonymise the dual-planner pair (`confucius (subagent_type: mystical-inspiration, slot=a)`). The engine collects these pairs as-is and templates them into the spawned worker's runtime prompt; it does not interpret them beyond that.

Agents send **bare** subagent types (e.g., `the-anatomist`, `unit-deployed`, `art-of-war`) — the engine normalises by prepending `kiln:` when calling the `Agent(...)` tool. This is the Wave 4 C7 rule; agents that still emit `kiln:the-anatomist` are accepted (the engine strips-then-re-adds the prefix), but bare is canonical.

**Engine protocol on receiving REQUEST_WORKERS:**

1. **Parse the payload** into a list of `(name, type, extras)` triples, where `extras` is a (possibly empty) dict of the trailing `key=value` pairs. The regex shape to match one tuple is `(\w[\w-]*)\s*\(subagent_type:\s*(?:kiln:)?([\w-]+)(?:,\s*([^)]*))?\)` — group 1 is the name, group 2 is the bare type, group 3 (optional) is the raw extras string that gets parsed on `,\s*` into `key=value` entries. Reject on malformed input with `WORKERS_REJECTED: unable to parse payload '{payload}'`.

2. **Normalise types** — strip any leading `kiln:` prefix so the match against known agent templates is canonical.

3. **Validate types** exist as agent `.md` files under `plugins/kiln/agents/`. For Step 5 additionally match the scenario roster (`dial-a-coder`/`critical-thinker`/`backup-coder`/`la-peintresse`/`the-curator` only). Unknown types: send `WORKERS_REJECTED: unknown subagent_type '{type}'`.

4. **Spawn each worker** on the current team with `run_in_background: true`, inlining any extras from the tuple into the runtime prompt (e.g., `slot=a` becomes `Your assigned slot: a.` in the prompt body):
   ```
   Agent(
     name: "{name}",
     subagent_type: "kiln:{type}",      # engine adds the prefix
     team_name: "{team_name}",
     prompt: "<lean runtime prompt — include the role-appropriate Protocol Injection block from § Protocol Injection, plus a line for each key=value from extras>",
     run_in_background: true,
   )
   ```

5. **Confirm to boss** — emit a single canonical `WORKERS_SPAWNED` with every spawned pair echoed back (carrying the normalised `subagent_type`, with the `kiln:` prefix restored so the boss sees exactly what was spawned). Extras are not re-echoed — they are spawn-time configuration, not part of the ack contract:
   ```
   SendMessage(
     type: "message",
     recipient: "{boss}",
     content: "WORKERS_SPAWNED: {name} (subagent_type: kiln:{type}), {name} (subagent_type: kiln:{type}), ..."
   )
   ```

6. **Partial failure** — if any single spawn fails, treat the whole request as failed: shut down any workers already spawned in this batch, then send `WORKERS_REJECTED: {reason}` with enough detail for the boss to retry or escalate.

**CYCLE_WORKERS vs REQUEST_WORKERS**: REQUEST_WORKERS is the initial Phase C spawn at the start of any step. CYCLE_WORKERS is Step-5-only, mid-milestone, and shuts down the existing builder+reviewer before spawning the fresh pair. Both end with a `WORKERS_SPAWNED` confirmation in the same shape.

#### CYCLE_WORKERS — Mid-Milestone Worker Cycling (Step 5 Only)

During a milestone, KRS-One may request fresh workers between iterations via `CYCLE_WORKERS` instead of `REQUEST_WORKERS`. This replaces the current builder+reviewer pair without tearing down the team — persistent minds (rakim, sentinel, thoth) and KRS-One stay alive throughout the milestone.

**CYCLE_WORKERS payload format:**
```
CYCLE_WORKERS: scenario={default|fallback|ui}, duo_id={duo_id}, coder_name={name}, reviewer_name={name}, reason="{why cycling}", chunk="{chunk summary}"
```

**Engine protocol on receiving CYCLE_WORKERS:**

1. **Validate scenario** — map to builder+reviewer pair:

   | Scenario | Builder Type | Reviewer Type |
   |----------|-------------|---------------|
   | default | dial-a-coder | critical-thinker |
   | fallback | backup-coder | critical-thinker |
   | ui | la-peintresse | the-curator |

   If the scenario is unrecognized, reject:
   ```
   SendMessage(type: "message", recipient: "krs-one", content: "CYCLE_REJECTED: Unknown scenario '{scenario}'. Valid scenarios: default, fallback, ui.")
   ```

2. **Shutdown current workers** — send `shutdown_request` to the current builder and reviewer (if any exist). Wait for `shutdown_response` or `teammate_terminated` from both (60s timeout). Force-terminate on timeout. Persistent minds and KRS-One stay alive — shutting them down would wipe the milestone's accumulated context, which is the opposite of what cycling is for.

3. **Spawn fresh pair** — spawn the new builder+reviewer on the existing team. Use boss-selected duo names from duo-pool.md: `name` is the character's spawn name for this cycle (e.g., `tintin`), `subagent_type` is the agent type template (e.g., `kiln:dial-a-coder`). Each fresh worker starts with a clean context — this is the point of cycling.

4. **Confirm to KRS-One** — send WORKERS_SPAWNED with the new agent names:
   ```
   SendMessage(
     type: "message",
     recipient: "krs-one",
     content: "WORKERS_SPAWNED: duo_id={duo_id}, {builder_name} (subagent_type: {builder_type}), {reviewer_name} (subagent_type: {reviewer_type}). Fresh context, awaiting assignment."
   )
   ```

5. **Update progress beat** — output a one-line progress beat for the operator:
   ```
   ◆ Cycling workers — {reason}. Spawning {builder_name}+{reviewer_name} ({scenario})...
   ```

**CYCLE_WORKERS vs REQUEST_WORKERS:** REQUEST_WORKERS is the initial Phase C spawn at the start of build. CYCLE_WORKERS is the mid-milestone replacement that shuts down existing workers first. Both use the same scenario validation table. The key difference: CYCLE_WORKERS always sends `shutdown_request` to existing workers before spawning, and it is initiated by KRS-One (not as a response to an initial team setup).
See `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/duo-pool.md` for the full pool table and rotation rules.

#### Spawn Parameters

Every `Agent(...)` spawn populates every parameter below — none is optional:

```
Agent(
  name: "{spawn_name}",           # who the agent IS this cycle — from duo pool or blueprint roster
  description: "{personality}",    # random quote from agents.json — vary each spawn
  team_name: "{team_name}",       # the team from step 2 — REQUIRED
  subagent_type: "{agent_type}",  # the .md template — what the agent IS (e.g., kiln:dial-a-coder)
  prompt: "<lean runtime prompt>",
  run_in_background: true/false,  # interactive steps (1,2,4): boss=false; background steps (3,5,6,7): true
)
```

**Naming**: The `name` parameter is who the agent IS this cycle — the character entering the scene. For persistent agents and bosses, `name` is a fixed, well-known spawn name defined in the step blueprint (e.g., `krs-one`, `aristotle`). For duo pool workers, `name` is the boss-selected spawn name (e.g., `tintin`, `mario`) while `subagent_type` is the agent type template (e.g., `kiln:dial-a-coder`). Never add prefixes or team identifiers to `name`.

`team_name` is the reason for the REQUIRED annotation on that parameter: without it agents spawn as isolated subagents with no SendMessage routing, no shutdown, and no team pattern. A silently dropped `team_name` looks like it worked until the first inter-agent signal disappears.

Bootstrap plumbing is invisible — batch prerequisite reads in parallel, output the banner as the first visible text. Interactive steps (1, 2, 4): banner → spawning indicator → spawn boss in foreground → operator greeting (text in `lore-engine.md`) → engine goes silent. Background steps (3, 5, 6, 7): banner → one-line progress beats at each phase transition surfacing real information from READY signals.

### 4. Wait for Done Signal

The engine waits for the boss's completion signal. Messages from the team arrive automatically. Do not read files, create tasks, or intervene.

**Interactive steps (Steps 1, 2, 4) — hands off.** The boss is mid-conversation with the human; any engine-side nudge, re-spawn, or takeover interrupts that dialogue and corrupts it. Wait silently and indefinitely. Apparent inactivity is the boss waiting on the operator, not a stuck pipeline.

**Non-interactive steps (Steps 3, 5, 6, 7) — stall detection is native.** The detached watchdog (`watchdog-loop.sh`) monitors `.kiln/tmp/activity.json` and injects nudges automatically when the pipeline stalls. See `plugins/kiln/skills/kiln-pipeline/references/deadlock-detection.md` for the contract. On each idle notification, output a brief lore-flavored one-liner only — no manual polling needed.

### 5. Shutdown and Transition

1. **Shutdown agents**: Send `shutdown_request` to each agent individually, in parallel. Shutdown is a per-agent protocol — broadcasting conflates it with an announcement and loses the per-agent ack.
2. **Wait for confirmations or termination**: Track a wait set of all agents that received `shutdown_request`. Clear an agent from the set when EITHER:
   - it sends `shutdown_response` (confirmation), OR
   - a `teammate_terminated` event is observed for that agent (the system has already killed it).
   Continue until the wait set is empty. If any agent has neither confirmed nor terminated after 60 seconds, treat it as terminated and proceed — do not wait indefinitely.
3. **TeamDelete**: Only once the wait set is empty (all agents confirmed, terminated, or timed out).
4. **Then § 2 (Render Transition and Create Team)** for the next step. Always delete the old team before creating the new one — concurrent teams fail TeamCreate on name collision.

### 6. Process Signal and Transition

Based on the boss's done signal, determine the next action:

**Step 1 done** -> validate onboarding artifacts BEFORE shutdown (Alpha is still alive):
  1. Read `.kiln/STATE.md` via Bash: verify `## Flags` section exists and contains `codex_available` AND `arch_review`.
  2. Verify `.kiln/resume.md` exists.
  If validation fails: send an error to Alpha describing what is missing, wait for Alpha to fix and re-signal ONBOARDING_COMPLETE. Keep the team alive until validation passes — shutting down before a fix loses the fixer.
  If validation passes: proceed to shutdown and transition to step 2.
**Step 1 blocked** (ONBOARDING_BLOCKED) -> render `halt` banner, inform operator of the blocker details, stop pipeline.
**Step 2 done** (BRAINSTORM_COMPLETE) -> verify `.kiln/docs/VISION.md` exists and is non-empty before proceeding to step 3. If missing, wait up to 30s (check every 5s), then nudge the vision curator if still missing.
**Step 3 done** (RESEARCH_COMPLETE) -> proceed to step 4.
**Step 4 done** (ARCHITECTURE_COMPLETE) -> proceed to step 5.
**Step 4 blocked** (PLAN_BLOCKED) -> render `halt` banner, inform operator, stop pipeline.
**Step 5 signals**:
  - CYCLE_WORKERS -> KRS-One requests fresh workers mid-milestone. Execute the full CYCLE_WORKERS protocol (see § CYCLE_WORKERS above): validate scenario, shutdown current builder+reviewer, spawn fresh pair, send WORKERS_SPAWNED back to KRS-One. Keep the team intact — persistent minds and KRS-One carry milestone context that re-spawning would lose. Do not transition steps. After sending WORKERS_SPAWNED, return to waiting for the next signal. The engine does not touch `chunk_count` here — bossman owns that write at § 1 Initialize (Wave 3, C10); `team_iteration` stays fixed for the duration of the milestone and only changes inside the MILESTONE_COMPLETE handler below.
  - MILESTONE_QA_READY -> KRS-One has verified deliverable completeness, requesting independent QA. Execute the full QA Tribunal protocol (see § MILESTONE_QA_READY below). Judge-dredd signals QA_PASS / QA_FAIL directly to krs-one (Wave 2 — no engine relay). The engine shuts down the four QA agents and returns to waiting for the next signal (MILESTONE_COMPLETE, or back to CYCLE_WORKERS if QA failed).
  - MILESTONE_COMPLETE -> Full team lifecycle reset:
    1. Render `milestone_complete` banner. Increment `milestones_complete` in STATE.md. Increment `team_iteration` by 1 and reset `chunk_count` to 0 via Bash sed. STATE.md fields are markdown bullets (`- **team_iteration**: N`, `- **chunk_count**: N`), so the sed patterns must match that exact shape — a plain `s/team_iteration:/.../` pattern silently no-ops against the real state file:
       ```bash
       CURRENT_TEAM_ITER=$(grep -oP '(?<=\*\*team_iteration\*\*:\s)[0-9]+' .kiln/STATE.md | head -1)
       NEW_TEAM_ITER=$((CURRENT_TEAM_ITER + 1))
       sed -i -E "s/(\*\*team_iteration\*\*:[[:space:]]*)[0-9]+/\1${NEW_TEAM_ITER}/" .kiln/STATE.md
       sed -i -E "s/(\*\*chunk_count\*\*:[[:space:]]*)[0-9]+/\10/" .kiln/STATE.md
       ```
       The new `team_iteration` selects the next kill-streak name for § 2 banner rendering; `chunk_count` restarts from 0 for the next milestone's chunk archive paths.
    2. **Pre-shutdown check**: Verify all persistent minds have `<!-- status: complete -->` in their owned files (codebase-state.md, patterns.md). If any are missing, wait 30s and re-check (max 3 times), then proceed with a warning.
    3. Send `shutdown_request` to every agent on the team (PMs, KRS-One, any remaining workers). Wait for responses (60s timeout, force-terminate on timeout).
    4. **TeamDelete** — tear down the entire milestone team.
    5. Non-final milestone (`milestones_complete < milestone_count`):
       a. Create new team (`TeamCreate` with next kill-streak name).
       b. Re-spawn persistent minds (rakim, sentinel, thoth) — fresh context, they read their files on bootstrap.
       c. Re-spawn krs-one with updated milestone context.
       d. Wait for READY from PMs, then resume the build loop.
    6. Final-milestone note (Wave 4 C4 contract): `MILESTONE_COMPLETE` is sent on every milestone except the final one. On the final milestone, krs-one sends `BUILD_COMPLETE` alone — no MILESTONE_COMPLETE pair — and the engine handles it in the BUILD_COMPLETE branch below. If the engine ever sees both signals for the same final milestone it is a contract regression; flag and take whichever arrived first.
  - BUILD_COMPLETE -> Wave 4 C4 terminal for the final milestone. The engine treats this as the sole close-out for milestone N when `milestones_complete == milestone_count - 1` (the in-flight milestone is the final one). Steps:
    1. Increment `milestones_complete` to match `milestone_count` in STATE.md.
    2. Update STATE.md `stage` to `validate` via Bash sed using the markdown-bullet-aware pattern (same shape as team_iteration / chunk_count).
    3. Run the same pre-shutdown check as MILESTONE_COMPLETE — verify persistent-mind status markers, then send `shutdown_request` to every agent in the active team, TeamDelete.
    4. Render `phases_complete` banner, proceed to step 6 (Validate).
    Do not wait for a paired `MILESTONE_COMPLETE` after `BUILD_COMPLETE` — the pre-Wave-4 sequencing (final milestone emitted both) is retired; `BUILD_COMPLETE` is the sole terminal.
**Step 6 signals**:
  - VALIDATE_PASS -> render `validation_passed` banner, proceed to step 7.
  - VALIDATE_FAILED -> render `validation_failed` banner, check correction_cycle:
    - If < 3: render `correction_start` banner, increment correction_cycle in STATE.md, loop back to step 5. Correction dispatch follows the same structure as a normal Build iteration — KRS-One bootstraps persistent minds, reads the correction report at `.kiln/validation/report.md`, scopes a targeted fix, dispatches to a builder. The engine does not inline the correction tasks or hand KRS-One a vague "execute this"; scoping and delegation are his job for corrections exactly as they are for any other iteration.
    - If >= 3: render `halt` banner, escalate to operator, stop pipeline.
**Step 7 done** (REPORT_COMPLETE) -> render `project_complete` banner, pipeline complete.

When writing STATE.md at step transitions, always include the `skill` and `roster` bootstrap paths from the active plugin root. Set `skill` to `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md` and set `roster` to the next step's blueprint path under `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/blueprints/`. Never preserve a stale cache or previous install path when writing new state — these fields enable cold-start resume after session breaks, and a stale path defeats the resume.

**Step timing**: At the start of each step, write `step_N_start: {ISO 8601 timestamp}` to STATE.md. When the step signals done, write `step_N_end: {ISO 8601 timestamp}`. Use `date -u +%Y-%m-%dT%H:%M:%SZ` via Bash for consistent formatting. Omega uses these timestamps to build the pipeline timing table in REPORT.md.

**Gate log**: gate-log.md is optional. If alpha seeded it during onboarding, the engine may append a one-line entry at step transitions. Gate-log writes never block or delay the transition flow.

#### MILESTONE_QA_READY — Judge Dredd Tribunal (Step 5 Only)

When KRS-One sends `MILESTONE_QA_READY: {milestone_name}`, the engine orchestrates independent dual-model QA via four dedicated agents (ken, ryu, denzel, judge-dredd) in a sequential 4-step flow. KRS-One blocks on QA_PASS / QA_FAIL from judge-dredd directly — the engine no longer relays a QA_VERDICT (Wave 2 centralisation, 300s timeout).

**Engine protocol on receiving MILESTONE_QA_READY:**

1. **Pre-package PM context for ryu** — Read the TL;DR headers from rakim's `.kiln/docs/codebase-state.md` and sentinel's `.kiln/docs/patterns.md` (first 30 lines of each). Ryu is a thin Codex CLI wrapper that does not consult PMs directly — the engine pre-packages this context into its runtime prompt so the GPT-5.4 side still sees the same ground truth as ken.

2. **Spawn ken + ryu (parallel, background):**

   The engine randomly assigns one checker to slot 'a' and the other to slot 'b' per milestone — this replaces the mid-flight anonymization step (Wave 2 self-anonymization).
   ```
   Agent(name: "ken", subagent_type: "kiln:team-red", team_name: "{team_name}",
     run_in_background: true,
     prompt: "You are 'ken' on team '{team_name}'. Step 5: Build — Milestone QA.
     Milestone under review: {milestone_name}.
     Working dir: {working_dir}. Master plan: .kiln/master-plan.md.
     {protocol_injection_full}
     Run your QA analysis. Your report slot: {ken_slot}. Write to .kiln/tmp/qa-report-${ken_slot}.md.
     Consult rakim and sentinel as needed.")

   Agent(name: "ryu", subagent_type: "kiln:team-blue", team_name: "{team_name}",
     run_in_background: true,
     prompt: "You are 'ryu' on team '{team_name}'. Step 5: Build — Milestone QA.
     Milestone under review: {milestone_name}.
     Working dir: {working_dir}. Master plan: .kiln/master-plan.md.
     Codebase state summary:\n{rakim_tldr}
     Patterns summary:\n{sentinel_tldr}
     {protocol_injection_worker}
     Construct your QA prompt for GPT-5.4 and invoke codex exec.
     Your report slot: {ryu_slot}. Write to .kiln/tmp/qa-report-${ryu_slot}.md.")
   ```

3. **Wait for TWO distinct QA_REPORT_READY signals** — create two separate wait tasks:
   - "Wait for QA_REPORT_READY from ken"
   - "Wait for QA_REPORT_READY from ryu"
   Track by sender. Both must arrive before proceeding. 300s timeout for the pair.

4. **Spawn denzel (background)** after both reports are ready:
   ```
   Agent(name: "denzel", subagent_type: "kiln:the-negotiator", team_name: "{team_name}",
     run_in_background: true,
     prompt: "You are 'denzel' on team '{team_name}'. Step 5: Build — Milestone QA Reconciliation.
     Milestone: {milestone_name}. Working dir: {working_dir}.
     Two anonymous QA reports: .kiln/tmp/qa-report-a.md and .kiln/tmp/qa-report-b.md.
     {protocol_injection_full}
     Read both reports, reconcile findings, write .kiln/tmp/qa-reconciliation.md, signal RECONCILIATION_COMPLETE.")
   ```

5. **Wait for RECONCILIATION_COMPLETE from denzel** — single wait task. 300s timeout.

6. **Spawn judge-dredd (background)** after reconciliation is ready:
   ```
   Agent(name: "judge-dredd", subagent_type: "kiln:i-am-the-law", team_name: "{team_name}",
     run_in_background: true,
     prompt: "You are 'judge-dredd' on team '{team_name}'. Step 5: Build — Milestone QA Verdict.
     Milestone: {milestone_name}. Working dir: {working_dir}.
     QA reports: .kiln/tmp/qa-report-a.md, .kiln/tmp/qa-report-b.md.
     Reconciliation: .kiln/tmp/qa-reconciliation.md.
     {protocol_injection_full}
     Read the reports and reconciliation. Signal QA_PASS or QA_FAIL with findings.")
   ```

7. **Wait for QA_PASS or QA_FAIL from judge-dredd** — single wait task. 300s timeout.

8. **Shutdown QA agents** — send `shutdown_request` to ken, ryu, denzel, and judge-dredd. Wait for confirmations (60s timeout). Force-terminate on timeout.

9. **Return to signal wait loop** — KRS-One receives QA_PASS or QA_FAIL directly from judge-dredd and advances milestone state. No engine relay.

#### Protocol Injection (Runtime)

Every agent spawn includes a role-appropriate protocol block inlined in its runtime prompt. This is Layer 2 enforcement (Layer 1 = agent.md bootstrap Read, Layer 3 = enforce-pipeline.sh hook). The three variants below are copy-pasted into runtime prompts verbatim — paraphrasing or abbreviating any line breaks downstream spawns that grep for it.

**Full protocol** — for bosses, persistent minds, QA agents (denzel, judge-dredd, aristotle, krs-one, rakim, sentinel, etc.):
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

**Worker protocol** — for builders, reviewers (dial-a-coder, backup-coder, la-peintresse, critical-thinker, the-curator, team-blue):
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

On every turn, check `TaskList` and find the current `in_progress` task. If it is a `Wait for X` task, scan every received teammate message for signal `X`. Process every teammate-message block in the input — stopping after the first match drops signals that arrived in the same turn. If the signal is found, mark the task complete and immediately continue to the next unblocked task. If not found, STOP and wait for more messages.

After receiving any teammate message, check TaskList first to identify the current in_progress task. Match the incoming message against the expected signal. Then act on the result.

**Malformed signal recovery:** If a teammate message does not match the expected signal but contains a recognizable intent (e.g. `READY` when `REQUEST_WORKERS` was expected, a signal with wrong casing, or a signal buried in prose), do not silently ignore it. Silent drops produce the worst failure mode — both sides believe they communicated. Send a corrective reply: "I received your message but expected signal `{expected}`. You sent `{what_they_sent}`. Please resend as exactly: `{expected}: {format}`."

Use the exact signal names from `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md` (§ Signal Vocabulary). Rebuild the tasklist at every step transition; Build iterations also rebuild the full chain. The tasklist is engine-only: agents never touch it and use `SendMessage` only. When transitioning between steps, delete all previous tasks (`TaskUpdate status: deleted`) before creating the new step's chain.

Read the current step's blueprint for the step-specific spawn/wait sequence. Each blueprint defines the Phase A/B/C roster, the signals to wait for, and any conditional branches (e.g. brownfield scout requests in step 1, argus→hephaestus branch in step 6). The blueprint is the authoritative task chain for that step.

## Build Loop — Kill Streak Names

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md` for Build step team naming (required at every Build step entry). The kill streak announcement is rendered as part of step 2 (Render Transition and Create Team) — bold orange banner with the streak name in ALL CAPS.

## Artifact Verification

Before each step, verify required input artifacts exist (see `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/artifact-flow.md`). If critical artifacts are missing, inform the operator rather than proceeding blind.
