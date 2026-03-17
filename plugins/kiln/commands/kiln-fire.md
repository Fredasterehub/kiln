---
name: kiln-fire
description: Launch the Kiln software creation pipeline. Detects project state and auto-resumes.
argument-hint: [no arguments needed]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, TeamCreate, TeamDelete, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage
---

# /kiln-fire

Splash first, work second. The operator sees the banner immediately — everything else happens after.

1. **State detection**: Check for `.kiln/STATE.md` in the working directory (single Read).

2. **Splash screen** — render IMMEDIATELY, before any file reads, blueprint loading, or agent spawning:

   **Fresh run** (no STATE.md):
   ```
   `"I'm the Alpha, the Omega, the beginning and ending. We are all one and everything is living."`
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   **KILN** ► Ignition
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   `↳ preparing the forge...`
   ```

   **Resume** (STATE.md exists, stage != complete):
   ```
   `"{random quote from pool of 4}"`
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   **KILN** ► Resuming — `{stage}` · iteration {build_iteration} · {milestones_complete}/{milestone_count} milestones
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   `↳ reigniting the forge...`
   ```

   **Complete** (stage == complete):
   ```
   `"The future's a mystery, the past is history. Today is a gift — that's why it is called the present."`
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   **KILN** ► Complete — `{project_name}`
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   `↳ report at .kiln/REPORT.md`
   ```
   Stop here. Pipeline already finished.

3. **Load pipeline** — AFTER the splash is rendered, read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md` (fresh) or the `skill` path from STATE.md (resume). Follow that skill to execute from the current stage.

The splash banner is hardcoded in this command — the engine never needs to look anything up to render it. State detection gives you the stage and counters for the resume variant. Everything else (blueprint reads, team creation, agent spawning) happens in the skill, after the splash.
