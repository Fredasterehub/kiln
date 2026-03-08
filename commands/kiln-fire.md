---
name: kiln-fire
description: Launch the Kiln software creation pipeline. Detects project state and auto-resumes.
argument-hint: [no arguments needed]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, TeamCreate, TeamDelete, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage
---

# /kiln-fire

Launch the Kiln multi-modal software creation pipeline.

## Startup Sequence

1. **Detect working directory**: The operator has already launched Claude Code from their project folder. Ask them:
   "Fire up Kiln in this directory, or create a subfolder for a new project?"
   - If this directory: use the current working directory.
   - If subfolder: ask for the folder name, create it, and use that as the working directory.

2. **Check for existing pipeline state**: Look for `.kiln/STATE.md` in the working directory.
   - If found: read it and auto-resume from the current stage. Tell the operator: "Found existing Kiln run ({run_id}). Resuming from {stage}..."
   - If not found: fresh run — start from step 1 (Onboarding).

3. **Load the pipeline skill**: The kiln-pipeline skill contains all orchestration logic. Follow its instructions for state detection, step execution, and signal handling.

4. **Run the pipeline**: Execute steps sequentially following the skill's procedure. The pipeline is fully autonomous after step 2 (Brainstorm) — the operator only needs to participate during Brainstorm when Da Vinci asks questions.

## Important Notes

- The pipeline creates a `.kiln/` directory in the working directory to store all state and artifacts.
- Step 2 (Brainstorm) is INTERACTIVE — Da Vinci will ask the operator questions about their vision.
- All other steps are autonomous.
- Build iterations use kill streak team names (first-blood, combo, super-combo, ...).
- If anything goes wrong, the pipeline can be resumed — just run `/kiln-fire` again.
- For diagnostics, run `/kiln-doctor` first to verify prerequisites.
