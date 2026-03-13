---
name: kiln-fire
description: Launch the Kiln software creation pipeline. Detects project state and auto-resumes.
argument-hint: [no arguments needed]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, TeamCreate, TeamDelete, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage
---

# /kiln-fire

1. **Working directory**: Ask the operator: "Fire up Kiln in this directory, or create a subfolder for a new project?"
   - This directory: use current working directory.
   - Subfolder: ask for name, create it, use that.

2. **State detection**: Check for `.kiln/STATE.md` in the working directory.
   - **Found**: Read STATE.md. Read the file at the `skill` path. Follow that skill to resume from the current `stage`.
   - **Not found**: Fresh run. Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md` and start from step 1.
