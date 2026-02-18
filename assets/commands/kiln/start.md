# /kiln:start — Kiln Protocol Entry Point
Execute the Kiln protocol autonomously from the current working directory using filesystem tools, bash commands, and the Task tool. Initialize project state, build memory, run collaborative planning with dual planners and optional debate, then execute the approved plan phase by phase with validation. Treat this file as authoritative runtime instructions. Do not ask for permission between steps unless a step explicitly requires user input.

---

## Stage 1: Initialization & Brainstorm

1. Detect project path and initialize git.
   Capture the current working directory as `PROJECT_PATH`.
   Run `pwd` (or equivalent) and store the exact absolute path value.
   Derive all subsequent paths from `PROJECT_PATH`.
   In `PROJECT_PATH`, run `git rev-parse --git-dir`.
   If that command exits non-zero, run `git init` in `PROJECT_PATH`.
   Confirm git is now initialized before continuing.

2. Create `.kiln/` directory and `.gitignore`.
   Ensure `<PROJECT_PATH>/.kiln/` exists.
   Create it if missing.
   Write or overwrite `<PROJECT_PATH>/.kiln/.gitignore`.
   The file must contain exactly these four lines and nothing else:
   `plans/`
   `prompts/`
   `reviews/`
   `outputs/`
   Do not add extra entries.
   Do not add trailing spaces.
   After writing this file, update `MEMORY_DIR/MEMORY.md` status later in Step 4 or as soon as `MEMORY_DIR` exists, reflecting that `.kiln` initialization completed.

3. Resolve memory paths.
   Compute `HOME` as the user's home directory.
   Use `echo $HOME` if needed.
   Compute `ENCODED_PATH` by replacing every `/` in `PROJECT_PATH` with `-`.
   Use this explicit formula:
   `ENCODED_PATH = PROJECT_PATH` with `/` replaced by `-`.
   Example:
   `/DEV/myapp` becomes `-DEV-myapp`.
   Compute:
   `MEMORY_DIR = <HOME>/.claude/projects/<ENCODED_PATH>/memory`.
   Create `MEMORY_DIR` with `mkdir -p` if it does not exist.
   Confirm the directory exists before continuing.

4. Instantiate memory templates.
   Read templates from `<HOME>/.claude/kilntwo/templates/`.
   Process these files:
   `MEMORY.md`
   `vision.md`
   `master-plan.md`
   `decisions.md`
   `pitfalls.md`
   For each target memory file, first check whether it already exists and contains non-empty content beyond a header.
   If it already has substantial content, do not overwrite it.
   If it is missing or effectively empty, initialize it from the matching template when available.
   For `MEMORY.md`, fill these fields:
   `project_name` = basename of `PROJECT_PATH`.
   `project_path` = full `PROJECT_PATH`.
   `date_started` = today in `YYYY-MM-DD`.
   `status` = `"brainstorming"`.
   Preserve other placeholders as-is if present.
   If the template uses blank fields instead of placeholders, initialize those fields to empty strings.
   For `vision.md`, write template content and leave the body section empty.
   For `master-plan.md`, write template content and leave the body empty.
   For `decisions.md`, write template content and leave the decision log empty.
   For `pitfalls.md`, write template content and leave the pitfalls list empty.
   If a template file does not exist, create the memory file from scratch.
   The fallback file format is:
   H1 heading of the filename stem.
   One blank line.
   Nothing else.
   After completing this step, update `MEMORY_DIR/MEMORY.md` status to indicate memory initialization is complete.

5. Ask for debate mode.
   Ask the user exactly this prompt:
   "What debate mode would you like for planning?
     1 = Skip (no debate — synthesize immediately)
     2 = Focused (one round of critique and rebuttal) [default]
     3 = Full rounds (iterative debate until consensus)

   Press Enter to accept the default (2)."
   Store the response as `DEBATE_MODE`.
   If the user presses Enter or returns an empty response, set `DEBATE_MODE = 2`.
   If the response is not `1`, `2`, or `3`, re-prompt once.
   If the second response is still invalid, set `DEBATE_MODE = 2`.
   Record `debate_mode` in `MEMORY_DIR/MEMORY.md`.
   After recording it, update `MEMORY_DIR/MEMORY.md` status accordingly.

6. Run brainstorming conversation.
   Start with this opening question:
   "Let's define the project vision. Tell me: what are you building, who is it for, and what problem does it solve?"
   Continue interactively.
   Ask follow-up questions to capture:
   Goals and success criteria.
   Constraints such as time, budget, team size, and technology restrictions.
   Tech stack preferences or hard requirements.
   Known risks and unknowns.
   Every approximately 5 exchanges, perform a silent checkpoint.
   At each checkpoint:
   Update `MEMORY_DIR/vision.md` with key points captured so far.
   Update `MEMORY_DIR/MEMORY.md` status to `"brainstorming — checkpoint N"`.
   Increment `N` each time.
   Do not interrupt conversational flow to announce the checkpoint unless necessary.
   Continue until the user indicates completion.
   Completion cues include phrases like:
   "done"
   "that's it"
   "let's move on"
   "ready to plan"
   When complete, write final `MEMORY_DIR/vision.md` with a complete structure including:
   Problem statement.
   Goals.
   Target users and stakeholders.
   Constraints.
   Tech stack decisions.
   Open questions.
   Ensure the vision content is concrete and non-empty.

7. Run pre-flight checklist.
   Verify each requirement before Stage 2:
   `vision.md` is non-empty and includes at least a problem statement.
   `DEBATE_MODE` is one of `1`, `2`, or `3`.
   `.kiln/` exists in `PROJECT_PATH`.
   A git repository is initialized in `PROJECT_PATH`.
   `MEMORY_DIR` exists and contains all five files:
   `MEMORY.md`
   `vision.md`
   `master-plan.md`
   `decisions.md`
   `pitfalls.md`
   If any check fails, halt immediately.
   Tell the user exactly what is missing.
   Do not continue until the missing requirement is fixed.
   If all checks pass, print exactly:
   ```text
   Pre-flight check complete.
     Project: <PROJECT_PATH>
     Memory:  <MEMORY_DIR>
     Debate mode: <DEBATE_MODE>
     Vision: ready
   Proceeding to Stage 2: Planning.
   ```
   After this printout, update `MEMORY_DIR/MEMORY.md` status to reflect that pre-flight passed and planning begins.

---

## Stage 2: Planning

8. Spawn dual planners in parallel with the Task tool.
   Use the Task tool by name.
   Spawn both planner tasks in parallel.
   First task name:
   `kiln-planner-claude`
   Task description:
   `"Kiln Claude Planner"`
   Prompt content for `kiln-planner-claude` must include:
   Full contents of `MEMORY_DIR/vision.md`.
   Full contents of `MEMORY_DIR/MEMORY.md`.
   Instruction text:
   "Create a detailed, phased implementation plan. Output it as markdown with sections: Overview, Phases (each with a name, goal, tasks, and acceptance criteria), Risks, and Open Questions. This is the Claude perspective plan."
   Include `PROJECT_PATH` and `MEMORY_DIR`.
   Second task name:
   `kiln-planner-codex`
   Task description:
   `"Kiln Codex Planner"`
   Prompt content for `kiln-planner-codex` must include:
   The same full vision and memory contents.
   Instruction text:
   "Create a detailed, phased implementation plan. Output it as markdown with sections: Overview, Phases (each with a name, goal, tasks, and acceptance criteria), Risks, and Open Questions. This is the Codex perspective plan."
   Include `PROJECT_PATH` and `MEMORY_DIR`.
   Wait for both tasks to complete.
   Store outputs as:
   `PLAN_CLAUDE`
   `PLAN_CODEX`

9. Run conditional debate.
   If `DEBATE_MODE >= 2`, spawn `kiln-debater` using the Task tool.
   Task description:
   `"Kiln Plan Debater"`
   Prompt must include:
   Full `PLAN_CLAUDE`.
   Full `PLAN_CODEX`.
   `PROJECT_PATH`.
   `MEMORY_DIR`.
   If `DEBATE_MODE == 2`, include this instruction:
   "Perform one focused round of critique: identify the top 3 strengths and top 3 weaknesses of each plan, then produce a rebuttal for each weakness. Output structured markdown."
   If `DEBATE_MODE == 3`, include this instruction:
   "Perform iterative debate rounds between the two plans until you reach consensus on the strongest approach. Run at least 2 rounds, up to 4. Each round: critique weaknesses, propose improvements, refine. Output each round as a markdown section, then a final consensus summary."
   Wait for completion.
   Store output as `DEBATE_OUTPUT`.
   If `DEBATE_MODE == 1`, skip spawning `kiln-debater`.
   In that case set `DEBATE_OUTPUT` to an empty string.

10. Synthesize the master plan.
    Spawn `kiln-synthesizer` with the Task tool.
    Task description:
    `"Kiln Plan Synthesizer"`
    Prompt must include:
    Full `PLAN_CLAUDE`.
    Full `PLAN_CODEX`.
    Full `DEBATE_OUTPUT`.
    `PROJECT_PATH`.
    `MEMORY_DIR`.
    Include this instruction exactly:
    "Synthesize these inputs into a single authoritative master plan. The master plan must be structured as markdown with these top-level sections: ## Overview, ## Phases (each phase as ### Phase N: Name with Goal, Tasks as a numbered list, and Acceptance Criteria as a checklist), ## Risks, ## Open Questions. Be concrete and actionable — no vague tasks."
    Wait for completion.
    Store output as `MASTER_PLAN`.
    After storing output, update `MEMORY_DIR/MEMORY.md` status to indicate synthesis complete and awaiting user approval.

11. Present master plan for review.
    Display `MASTER_PLAN` to the user in full.
    Ask exactly:
    "Does this master plan look correct? You may:
      - Type 'yes' or press Enter to proceed to execution
      - Type 'edit' to provide corrections (I will revise and show you again)
      - Type 'abort' to stop here and save the plan for later"
    If response is `edit`:
    Collect user corrections.
    Revise `MASTER_PLAN`.
    For minor edits, revise inline.
    For major edits, re-run `kiln-synthesizer` with updated guidance.
    Show revised `MASTER_PLAN` in full.
    Ask for approval again.
    Repeat until user provides `yes`, Enter, or `abort`.
    If response is `abort`:
    Write current `MASTER_PLAN` to `MEMORY_DIR/master-plan.md`.
    Update `MEMORY_DIR/MEMORY.md` status to `"planning complete — awaiting execution"`.
    Tell the user to run `/kiln:resume` when ready.
    Stop execution immediately.

12. Update memory after planning approval.
    Write approved `MASTER_PLAN` to `MEMORY_DIR/master-plan.md`.
    Update `MEMORY_DIR/MEMORY.md` fields:
    `status` -> `"planning complete"`.
    `plan_approved_at` -> current ISO-8601 timestamp.
    Confirm both writes succeeded before moving to execution.

---

## Stage 3: Execution

13. Execute each phase sequentially.
    Read `MEMORY_DIR/master-plan.md`.
    Parse every section whose heading begins with `### Phase`.
    Keep original order.
    For each phase:
    Spawn `kiln-phase-executor` via the Task tool.
    Task description format:
    `"Kiln Phase Executor — <phase name>"`
    Task prompt must include:
    Full phase section from the master plan, including name, goal, tasks, and acceptance criteria.
    Full `MEMORY_DIR/MEMORY.md`.
    Full `MEMORY_DIR/vision.md`.
    `PROJECT_PATH`.
    `MEMORY_DIR`.
    Include this instruction text:
    "Implement this phase completely. Write working code, create real files, run tests. When done, write a phase summary to `<MEMORY_DIR>/phase-<N>-results.md` with sections: Completed Tasks, Files Created or Modified, Tests Run and Results, Blockers or Issues. Do not proceed to the next phase — stop after this phase is complete."
    Wait for completion before spawning the next phase executor.
    After each phase:
    Read `MEMORY_DIR/phase-<N>-results.md`.
    Extract a one-sentence summary from the results.
    Ensure `MEMORY_DIR/MEMORY.md` has a `## Phase Results` section.
    Append a line:
    `- Phase N (<phase name>): complete — <one-sentence summary from results file>`
    Update `MEMORY_DIR/MEMORY.md` status to `"executing — phase N complete"`.
    If executor output is placeholder-only, TODO-only, or stub-only:
    Fail that phase.
    Report the failure to the user.
    Do not continue to the next phase until corrected.

14. Run final validation.
    After all phases complete, spawn `kiln-validator` via the Task tool.
    Task description:
    `"Kiln Final Validator"`
    Prompt must include:
    Full `MEMORY_DIR/master-plan.md`.
    All `MEMORY_DIR/phase-*-results.md` files in full.
    `PROJECT_PATH`.
    `MEMORY_DIR`.
    Include this instruction:
    "Validate that all phases of the master plan have been implemented. For each phase, check that every acceptance criterion is met. Run any test commands referenced in the plan. Output a validation report as markdown with sections: ## Summary (pass/fail), ## Phase Checklist (one row per phase with pass/fail per criterion), ## Issues Found (empty if none), ## Recommendations. Write this report to `<MEMORY_DIR>/validation-report.md`."
    Wait for completion.
    Confirm `MEMORY_DIR/validation-report.md` exists and is readable.
    Update `MEMORY_DIR/MEMORY.md` status to indicate validation complete.

15. Finalize protocol run.
    Update `MEMORY_DIR/MEMORY.md` fields:
    `status` -> `"complete"`.
    `completed_at` -> current ISO-8601 timestamp.
    Count completed phases as `N`.
    Print exactly:
    ```text
    Kiln protocol complete.
      Project: <PROJECT_PATH>
      Phases completed: <N>
      Validation report: <MEMORY_DIR>/validation-report.md

    Run `kilntwo doctor` to verify your installation health.
    To resume a paused run, use /kiln:resume.
    ```
    End execution.

---

## Key Rules

1. **All paths are dynamic.** Never hardcode paths. Derive every path from `PROJECT_PATH`, `HOME`, and `ENCODED_PATH` from Step 3. The command must work in any project directory.
2. **Memory is the source of truth.** Before every stage transition, re-read `MEMORY_DIR/MEMORY.md` to confirm current state. If status already equals `"planning complete"` when entering Stage 2, skip to Step 11 using existing `master-plan.md`. If status equals `"executing — phase N complete"`, resume from phase `N+1`.
3. **Never skip stages.** Execute Stage 1 before Stage 2 and Stage 2 before Stage 3. The only exception is resumption as described in Rule 2. Use `/kiln:resume` for resumption; do not implement separate resume logic outside these state checks.
4. **Use the Task tool for all sub-agents.** Never invoke `kiln-planner-claude`, `kiln-planner-codex`, `kiln-debater`, `kiln-synthesizer`, `kiln-phase-executor`, or `kiln-validator` as slash commands. Spawn each exclusively with the Task tool and complete, self-contained prompts.
5. **Parallel where safe, sequential where required.** Run Step 8 planners in parallel. Run all other Task spawns sequentially, waiting for each to finish before starting the next.
6. **Write working outputs only.** Phase executors must create real files with real content and working code. Placeholders, TODO stubs, and non-functional scaffolds are failures that must be reported before continuing.
7. **Checkpoint memory after every significant action.** Update `MEMORY_DIR/MEMORY.md` status after Step 2, after Step 4, after Step 5, at every brainstorm checkpoint, after Step 7, after Step 10, after Step 12, after each phase in Step 13, after Step 14, and after Step 15.
