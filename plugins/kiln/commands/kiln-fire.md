---
name: kiln-fire
description: Launch the Kiln software creation pipeline. Detects project state and auto-resumes.
argument-hint: [no arguments needed]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, TeamCreate, TeamDelete, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage
---

# /kiln-fire

1. **Working directory**: Use the current working directory. Alpha handles path selection during onboarding.

2. **State detection**: Check for `.kiln/STATE.md` in the working directory.
   - **Found**:
     1. Read `.kiln/STATE.md`.
     2. Extract `stage` and `skill`.
     3. If `stage` is missing or not one of `onboarding`, `brainstorm`, `research`, `architecture`, `build`, `validate`, `report`, `complete`, fail with: `Kiln resume failed: .kiln/STATE.md is missing a valid stage. Expected one of onboarding, brainstorm, research, architecture, build, validate, report, complete. Fix .kiln/STATE.md or remove it to start fresh.`
     4. Set the active skill path to `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md`.
     5. If the stored `skill` path is present and readable, use it.
     6. If the stored `skill` path is missing or unreadable, try the active skill path instead. If that succeeds, treat it as a recovered path and update `.kiln/STATE.md` so `skill` points to the recovered path and `updated` reflects the recovery timestamp before continuing.
     7. If neither the stored path nor the active skill path can be read, fail with: `Kiln resume failed: the stored skill path is stale or missing, and the active kiln-pipeline skill was not found at ${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md. Reinstall or repair the Kiln plugin, then retry /kiln-fire.`
     8. Read the resolved skill file and resume from the current `stage`. The skill handles `roster` recovery from the active plugin root if the stored roster path is stale or missing.
   - **Not found**: Fresh run. Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md` and start from step 1.
