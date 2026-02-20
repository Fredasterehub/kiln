# /kiln:start — Kiln Protocol Entry Point
Execute the Kiln protocol autonomously from the current working directory using filesystem tools, bash commands, and the Task tool. Initialize project state, build memory, run collaborative planning with dual planners and optional debate, then execute the approved plan phase by phase with validation. Treat this file as authoritative runtime instructions. Proceed without asking between steps unless you encounter: an ambiguous requirement, a conflicting instruction, an unexpected error, or a situation not covered by the master plan. In those cases, stop and ask the operator (protocol rule 8).

---

## Canonical MEMORY.md Schema (Use Everywhere)

`MEMORY.md` must use these exact runtime fields and enum values:
- `stage`: `brainstorm | planning | execution | validation | complete`
- `status`: `in_progress | paused | blocked | complete`
- `planning_sub_stage`: `dual_plan | debate | synthesis | null`
- `phase_status` (in `## Phase Statuses` entries): `pending | in_progress | failed | completed`

Always update `last_updated` (ISO-8601 UTC) when runtime fields change.
Never write free-form status strings.

---

## Paths Contract

- `PROJECT_PATH`: absolute project root path for the active run.
- `KILN_DIR = $PROJECT_PATH/.kiln`.
- `CLAUDE_HOME = $HOME/.claude`.
- `MEMORY_DIR = $CLAUDE_HOME/projects/$ENCODED_PATH/memory`.
- Never use root-relative kiln or claude paths.

---

## Stage 1: Initialization & Brainstorm

1. Detect project path and initialize git.
   Capture the current working directory as `PROJECT_PATH`.
   Run `pwd` (or equivalent) and store the exact absolute path value.
   Derive all subsequent paths from `PROJECT_PATH`.
   In `PROJECT_PATH`, run `git rev-parse --git-dir`.
   If that command exits non-zero, run `git init` in `PROJECT_PATH`.
   Confirm git is now initialized before continuing.

2. Create `$KILN_DIR/` directory and `.gitignore`.
   Ensure `$KILN_DIR/` exists.
   Create it if missing.
   Write or overwrite `$KILN_DIR/.gitignore`.
   The file must contain exactly these lines and nothing else:
   `plans/`
   `prompts/`
   `reviews/`
   `outputs/`
   `archive/`
   `validation/`
   `*_state.md`
   `codebase-snapshot.md`
   Do not add extra entries.
   Do not add trailing spaces.
   After writing this file, update `MEMORY_DIR/MEMORY.md` later in Step 4 (or as soon as `MEMORY_DIR` exists) with:
   `stage` = `brainstorm`
   `status` = `in_progress`
   `handoff_note` = `.kiln directory initialized.`
   `handoff_context` = `Project directory structure created at $KILN_DIR with .gitignore. Memory not yet initialized.`
   Also update `last_updated`.

3. Resolve memory paths.
   Compute `HOME` as the user's home directory.
   Use `echo $HOME` if needed.
   Compute `ENCODED_PATH` by replacing every `/` in `PROJECT_PATH` with `-`.
   Use this explicit formula:
   `ENCODED_PATH = PROJECT_PATH` with `/` replaced by `-`.
   Example:
   `/DEV/myapp` becomes `-DEV-myapp`.
   Compute:
   `MEMORY_DIR = $CLAUDE_HOME/projects/<ENCODED_PATH>/memory`.
   Create `MEMORY_DIR` with `mkdir -p` if it does not exist.
   Confirm the directory exists before continuing.

4. Instantiate memory templates.
   Read templates from `$CLAUDE_HOME/kilntwo/templates/`.
   Process these files:
   `MEMORY.md`
   `vision.md`
   `master-plan.md`
   `decisions.md`
   `pitfalls.md`
   `PATTERNS.md`
   For each target memory file, first check whether it already exists and contains non-empty content beyond a header.
   If it already has substantial content, do not overwrite it.
   If it is missing or effectively empty, initialize it from the matching template when available.
   For `MEMORY.md`, enforce the canonical schema and fill/update these fields:
   `project_name` = basename of `PROJECT_PATH`.
   `project_path` = full `PROJECT_PATH`.
   `date_started` = today in `YYYY-MM-DD`.
   `stage` = `brainstorm`.
   `status` = `in_progress`.
   `planning_sub_stage` = `null`.
   `debate_mode` = `2` (default until Step 5 finalizes user input).
   `phase_number` = `null`.
   `phase_name` = `null`.
   `phase_total` = `null`.
   `handoff_note` = `Memory initialized; ready for brainstorming.`
   `handoff_context` = `All five memory files instantiated from templates. Project is ready for Stage 1 brainstorming.`
   `last_updated` = current ISO-8601 UTC timestamp.
   Keep `## Phase Statuses` present; leave it empty at initialization.
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
   After completing this step, update `MEMORY_DIR/MEMORY.md`:
   `stage` = `brainstorm`
   `status` = `in_progress`
   `handoff_note` = `Memory initialization complete.`
   `handoff_context` = `All five memory files instantiated from templates. Project is ready for brainstorming.`
   `last_updated` = current ISO-8601 UTC timestamp.

4.5. Detect project mode.
   Check for brownfield indicators in `PROJECT_PATH`:
   - Dependency manifests: `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `build.gradle`
   - Source directories with source files: `src/`, `lib/`, `app/`, `cmd/`
   - Existing git history: run `git -C $PROJECT_PATH log --oneline -1` (non-empty output means commits exist)

   If NO indicators found:
   - Set `PROJECT_MODE = greenfield`
   - Write `project_mode: greenfield` to the `## Metadata` section of `MEMORY_DIR/MEMORY.md`
   - Update `handoff_note` = `Project mode: greenfield; brainstorm depth selection next.`
   - Update `handoff_context` = `No brownfield indicators found. Project treated as greenfield.`
   - Update `last_updated`.
   - Proceed to Step 5.

   If indicators found: display the detected files/directories to the operator. Ask exactly:
   "I found an existing codebase ([list detected indicators]). Should I run Mnemosyne to map it before brainstorming?
     [Y] Map the codebase first (recommended)  [N] Skip mapping, start fresh"

   If operator responds Y (or any affirmative):
   - Set `PROJECT_MODE = brownfield`
   - Write `project_mode: brownfield` to the `## Metadata` section of `MEMORY_DIR/MEMORY.md`
   - Spawn `kiln-mapper` via the Task tool:
     `name`: `"Mnemosyne"` (the alias)
     `subagent_type`: `kiln-mapper`
     `description`: (next quote from names.json quotes array for kiln-mapper)
     Task prompt must include:
     `project_path` = `$PROJECT_PATH`
     `memory_dir` = `$MEMORY_DIR`
     `kiln_dir` = `$KILN_DIR`
     Instruction: "Map the existing codebase and pre-seed memory files. Write codebase-snapshot.md and seed decisions.md and pitfalls.md. Signal completion when done."
   - Wait for Mnemosyne to return.
   - Confirm to operator: "Mnemosyne complete. Codebase snapshot ready at `$KILN_DIR/codebase-snapshot.md`."
   - Update `handoff_note` = `Project mode: brownfield; Mnemosyne complete; brainstorm depth next.`
   - Update `handoff_context` = `Brownfield project. Mnemosyne mapped the codebase. Snapshot at $KILN_DIR/codebase-snapshot.md. Decisions and pitfalls pre-seeded.`
   - Update `last_updated`.
   - Proceed to Step 5.

   If operator responds N:
   - Set `PROJECT_MODE = brownfield`
   - Write `project_mode: brownfield` to the `## Metadata` section of `MEMORY_DIR/MEMORY.md`
   - Update `handoff_note` = `Project mode: brownfield (mapping skipped); brainstorm depth next.`
   - Update `handoff_context` = `Brownfield indicators found. Operator chose to skip Mnemosyne mapping. Codebase snapshot will not be available; planners will work from vision.md only.`
   - Update `last_updated`.
   - Proceed to Step 5.

5. Ask for brainstorm depth.
   Ask the user exactly this prompt:
   "What brainstorm depth would you like?
     1 = Light (quick, focused — idea floor: 10)
     2 = Standard (balanced exploration — idea floor: 30) [default]
     3 = Deep (comprehensive — idea floor: 100)

   Press Enter to accept the default (2)."
   Store the response as `BRAINSTORM_DEPTH`.
   If the user presses Enter or returns an empty response, set `BRAINSTORM_DEPTH = standard`.
   Map: `1` = `light`, `2` = `standard`, `3` = `deep`.
   If the response is not `1`, `2`, or `3`, re-prompt once.
   If the second response is still invalid, set `BRAINSTORM_DEPTH = standard`.
   Record `brainstorm_depth` in `MEMORY_DIR/MEMORY.md`.
   After recording it, keep:
   `stage` = `brainstorm`
   `status` = `in_progress`
   `handoff_note` = `Brainstorm depth set to <BRAINSTORM_DEPTH>; spawning brainstormer.`
   `handoff_context` = `Brainstorm depth <BRAINSTORM_DEPTH> selected by operator. About to spawn Da Vinci for structured brainstorm session.`
   Update `last_updated`.

6. Spawn brainstormer agent.
   Read the current contents of `MEMORY_DIR/vision.md` into `EXISTING_VISION`.
   If `PROJECT_MODE = brownfield` and `$KILN_DIR/codebase-snapshot.md` exists, read its contents into `CODEBASE_SNAPSHOT`.
   Otherwise set `CODEBASE_SNAPSHOT` to an empty string.
   Spawn `kiln-brainstormer` via the Task tool:
   `name`: `"Da Vinci"` (the alias)
   `subagent_type`: `kiln-brainstormer`
   `description`: (next quote from names.json quotes array for kiln-brainstormer)
   Task prompt must include:
   `project_path` = `$PROJECT_PATH`
   `memory_dir` = `$MEMORY_DIR`
   `kiln_dir` = `$KILN_DIR`
   `brainstorm_depth` = `$BRAINSTORM_DEPTH`
   `existing_vision` = full contents of `$EXISTING_VISION`
   If `CODEBASE_SNAPSHOT` is non-empty, include it under an `<codebase_snapshot>` XML tag.
   Instruction: "Run a complete brainstorm session. Facilitate idea generation using techniques and elicitation methods. Write vision.md with all 11 required sections. Update MEMORY.md checkpoints. Signal completion when the quality gate passes."
   Wait for completion.
   After Da Vinci returns, read the updated `MEMORY_DIR/vision.md` to confirm it was written.

6.5. Ask for debate mode.
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
   After recording it, keep:
   `stage` = `brainstorm`
   `status` = `in_progress`
   `handoff_note` = `Debate mode set to <DEBATE_MODE>; brainstorm complete, pre-flight next.`
   `handoff_context` = `Debate mode <DEBATE_MODE> selected by operator. Brainstorm session complete. Vision captured. Pre-flight check next.`
   Update `last_updated`.

7. Run pre-flight checklist.
   Verify each requirement before Stage 2:
   `vision.md` is non-empty and contains all required sections:
   `## Problem Statement`
   `## Target Users`
   `## Goals`
   `## Constraints`
   `## Tech Stack`
   `## Open Questions`
   `## Elicitation Log` (must have at least one method entry)
   No section contains placeholder text (`_To be filled_`, `_TBD_`, `_To be filled during brainstorm._`).
   `DEBATE_MODE` is one of `1`, `2`, or `3`.
   `$KILN_DIR/` exists.
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
     Project: $PROJECT_PATH
     Memory:  $MEMORY_DIR
     Debate mode: $DEBATE_MODE
     Vision: ready
   Proceeding to Stage 2: Planning.
   ```
   After this printout, update `MEMORY_DIR/MEMORY.md`:
   `stage` = `planning`
   `status` = `in_progress`
   `planning_sub_stage` = `dual_plan`
   `handoff_note` = `Pre-flight passed; planning started.`
   `handoff_context` = `Brainstorming complete. Vision captured in vision.md. Pre-flight checks passed. Dual planners (Confucius + Sun Tzu) about to be spawned with debate mode <DEBATE_MODE>.`
   `last_updated` = current ISO-8601 UTC timestamp.

---

## Stage 2: Planning

8. Spawn dual planners in parallel with the Task tool.
   If `PROJECT_MODE = brownfield` and `$KILN_DIR/codebase-snapshot.md` exists, read its contents into `CODEBASE_SNAPSHOT` (may already be loaded from Step 6).
   Use the Task tool by name.
   Spawn both planner tasks in parallel.
   First task:
   `name`: `"Confucius"` (the alias)
   `subagent_type`: `kiln-planner-claude`
   `description`: (next quote from names.json quotes array for kiln-planner-claude)
   Prompt content for `kiln-planner-claude` must include:
   Full contents of `MEMORY_DIR/vision.md`.
   Full contents of `MEMORY_DIR/MEMORY.md`.
   If `CODEBASE_SNAPSHOT` is non-empty, include it as a `## Codebase Context` section preceded by: "This is a brownfield project. The following codebase snapshot was generated by Mnemosyne:"
   Instruction text:
   "Create a detailed, phased implementation plan. Output it as markdown with sections: Overview, Phases (each with a name, goal, tasks, and acceptance criteria), Risks, and Open Questions. This is the Claude perspective plan."
   Include `PROJECT_PATH` and `MEMORY_DIR`.
   Second task:
   `name`: `"Sun Tzu"` (the alias)
   `subagent_type`: `kiln-planner-codex`
   `description`: (next quote from names.json quotes array for kiln-planner-codex)
   Prompt content for `kiln-planner-codex` must include:
   The same full vision and memory contents.
   If `CODEBASE_SNAPSHOT` is non-empty, include it as a `## Codebase Context` section preceded by: "This is a brownfield project. The following codebase snapshot was generated by Mnemosyne:"
   Instruction text:
   "Create a detailed, phased implementation plan. Output it as markdown with sections: Overview, Phases (each with a name, goal, tasks, and acceptance criteria), Risks, and Open Questions. This is the Codex perspective plan."
   Include `PROJECT_PATH` and `MEMORY_DIR`.
   Wait for both tasks to complete.
   Store outputs as:
   `PLAN_CLAUDE`
   `PLAN_CODEX`

9. Run conditional debate.
   If `DEBATE_MODE >= 2`, spawn `kiln-debater` using the Task tool.
   `name`: `"Socrates"` (the alias)
   `subagent_type`: `kiln-debater`
   `description`: (next quote from names.json quotes array for kiln-debater)
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
    `name`: `"Plato"` (the alias)
    `subagent_type`: `kiln-synthesizer`
    `description`: (next quote from names.json quotes array for kiln-synthesizer)
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
    After storing output, update `MEMORY_DIR/MEMORY.md`:
    `stage` = `planning`
    `status` = `paused`
    `planning_sub_stage` = `synthesis`
    `handoff_note` = `Master plan synthesized; awaiting user approval.`
    `handoff_context` = `Both planners produced plans. Debate (mode <DEBATE_MODE>) complete. Plato synthesized a master plan. The operator needs to review and approve before execution begins.`
    `last_updated` = current ISO-8601 UTC timestamp.

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
    Update `MEMORY_DIR/MEMORY.md`:
    `stage` = `planning`
    `status` = `paused`
    `planning_sub_stage` = `synthesis`
    `handoff_note` = `Planning complete; awaiting execution.`
    `handoff_context` = `Master plan saved but operator chose to abort before execution. Plan is ready for review at master-plan.md. Resume with /kiln:resume to continue.`
    `last_updated` = current ISO-8601 UTC timestamp.
    Tell the user to run `/kiln:resume` when ready.
    Stop execution immediately.

12. Update memory after planning approval.
    Write approved `MASTER_PLAN` to `MEMORY_DIR/master-plan.md`.
    Update `MEMORY_DIR/MEMORY.md` fields:
    `stage` -> `execution`.
    `status` -> `in_progress`.
    `planning_sub_stage` -> `null`.
    `phase_number` -> `null`.
    `phase_name` -> `null`.
    `phase_total` -> `<total number of phases parsed from master-plan.md>`.
    `handoff_note` -> `Plan approved; execution starting.`
    `handoff_context` -> `Operator approved the master plan with <phase_total> phases. Execution loop about to begin with phase 1.`
    `plan_approved_at` -> current ISO-8601 timestamp.
    `last_updated` -> current ISO-8601 UTC timestamp.
    Confirm both writes succeeded before moving to execution.

---

## Stage 3: Execution

13. Execute each phase sequentially.
    Read `MEMORY_DIR/master-plan.md`.
    Parse every section whose heading begins with `### Phase`.
    Keep original order.
    Set `phase_total` in `MEMORY.md` to the parsed phase count before the loop starts.
    For each phase:
    Before spawning the executor, update `MEMORY_DIR/MEMORY.md`:
    `stage` = `execution`
    `status` = `in_progress`
    `phase_number` = `N`
    `phase_name` = `<phase name>`
    `phase_total` = `<total phases>`
    `handoff_note` = `Executing phase <N>: <phase name>.`
    `handoff_context` = `Phase <N>/<phase_total> (<phase name>) starting. Previous phases: <summary of completed/failed phases from Phase Statuses>. Maestro is about to be spawned to execute this phase.`
    In `## Phase Statuses`, upsert this entry for phase `N` with `phase_status = in_progress`.
    Update `last_updated`.
    Spawn `kiln-phase-executor` via the Task tool.
    `name`: `"Maestro"` (the alias)
    `subagent_type`: `kiln-phase-executor`
    `description`: (next quote from names.json quotes array for kiln-phase-executor)
    Task prompt must include:
    Full phase section from the master plan, including name, goal, tasks, and acceptance criteria.
    Full `MEMORY_DIR/MEMORY.md`.
    Full `MEMORY_DIR/vision.md`.
    `PROJECT_PATH`.
    `MEMORY_DIR`.
    Include this instruction text:
    "Implement this phase completely. Write working code, create real files, run tests. When done, write a phase summary to `$MEMORY_DIR/phase-<N>-results.md` with sections: Completed Tasks, Files Created or Modified, Tests Run and Results, Blockers or Issues. Do not proceed to the next phase — stop after this phase is complete."
    Wait for completion before spawning the next phase executor.
    After each phase:
    Read `MEMORY_DIR/phase-<N>-results.md`.
    Extract a one-sentence summary from the results.
    Ensure `MEMORY_DIR/MEMORY.md` has a `## Phase Results` section.
    Append a line:
    `- Phase N (<phase name>): complete — <one-sentence summary from results file>`
    Update `MEMORY_DIR/MEMORY.md`:
    `stage` = `execution`
    `status` = `in_progress`
    `phase_number` = `N`
    `phase_name` = `<phase name>`
    In `## Phase Statuses`, set phase `N` to `phase_status = completed`.
    `handoff_note` = `Phase <N> complete; ready for next phase.`
    `handoff_context` = `Phase <N> (<phase name>) completed successfully. <one-sentence summary from results>. Next: phase <N+1> or validation if all phases done.`
    `last_updated` = current ISO-8601 UTC timestamp.
    If executor output is placeholder-only, TODO-only, or stub-only:
    Fail that phase.
    Update phase `N` in `## Phase Statuses` to `phase_status = failed`.
    Set `status` = `blocked`.
    Update `handoff_note` with the failure reason and required fix.
    Update `handoff_context` with detailed failure description: what phase failed, which tasks produced stubs/placeholders, what files were affected, and what the operator needs to fix before retrying.
    Update `last_updated`.
    Report the failure to the user.
    Do not continue to the next phase until corrected.

14. Run final validation with correction loop.
    After all phases complete, set `correction_cycle = 0` in `MEMORY_DIR/MEMORY.md`.
    Enter the validation-correction loop (max 3 cycles):

    14a. Spawn `kiln-validator` via the Task tool.
    `name`: `"Argus"` (the alias)
    `subagent_type`: `kiln-validator`
    `description`: (next quote from names.json quotes array for kiln-validator)
    Prompt must include:
    Full `MEMORY_DIR/master-plan.md`.
    All `MEMORY_DIR/phase-*-results.md` files in full.
    `PROJECT_PATH`.
    `MEMORY_DIR`.
    Include this instruction:
    "Build, deploy, and validate the project end-to-end. Test the actual running product against the master plan's acceptance criteria. For each failure, generate a correction task description with: what failed, evidence, affected files, suggested fix, and verification command. Write the validation report to `$PROJECT_PATH/.kiln/validation/report.md`."
    Wait for completion.
    Confirm `$PROJECT_PATH/.kiln/validation/report.md` exists and is readable.

    14b. Check the validation verdict.
    Read the report and extract the verdict (PASS, PARTIAL, or FAIL).
    If verdict is PASS:
    Update `MEMORY_DIR/MEMORY.md`:
    `stage` = `validation`
    `status` = `in_progress`
    `correction_cycle` = `0`
    `handoff_note` = `Validation passed; finalization pending.`
    `handoff_context` = `All phases executed and validated. Argus deployed and tested the product. All acceptance criteria met. Report at $KILN_DIR/validation/report.md. Finalization (Stage 5) is next.`
    `last_updated` = current ISO-8601 UTC timestamp.
    Proceed to Step 15.

    14c. If verdict is PARTIAL or FAIL and `correction_cycle < 3`:
    Increment `correction_cycle`.
    Append `[correction_start]` event to the `## Correction Log` section of `$MEMORY_DIR/MEMORY.md`.
    Read the `## Correction Tasks` section from the validation report.
    For each correction task, create a correction phase that re-enters Stage 3:
    Update `MEMORY_DIR/MEMORY.md`:
    `stage` = `execution`
    `status` = `in_progress`
    `handoff_note` = `Correction cycle <correction_cycle>/3: fixing validation failures.`
    `handoff_context` = `Validation verdict: <verdict>. <N> correction tasks identified. Running correction phase through full Scheherazade→Codex→Sphinx cycle. Cycle <correction_cycle> of max 3.`
    Append to `## Correction Log`: `- Cycle <correction_cycle>: <verdict>, <N> correction tasks`
    `last_updated` = current ISO-8601 UTC timestamp.
    Spawn `kiln-phase-executor` (Maestro) with the correction tasks as the phase description.
    `name`: `"Maestro"` (the alias)
    `subagent_type`: `kiln-phase-executor`
    `description`: (next quote from names.json quotes array for kiln-phase-executor)
    After Maestro completes the correction phase, append `[correction_complete]` event to the `## Correction Log` section of `$MEMORY_DIR/MEMORY.md`. Loop back to Step 14a.

    14d. If verdict is PARTIAL or FAIL and `correction_cycle >= 3`:
    Update `MEMORY_DIR/MEMORY.md`:
    `stage` = `validation`
    `status` = `blocked`
    `handoff_note` = `Validation failed after 3 correction cycles; operator intervention needed.`
    `handoff_context` = `Validation still failing after 3 correction cycles. Verdict: <verdict>. Report at $KILN_DIR/validation/report.md. Operator must review failures and decide how to proceed.`
    `last_updated` = current ISO-8601 UTC timestamp.
    Display the validation report to the operator.
    Halt and wait for operator direction. Do not proceed to Step 15.

15. Finalize protocol run.
    Update `MEMORY_DIR/MEMORY.md` fields:
    `stage` -> `complete`.
    `status` -> `complete`.
    `planning_sub_stage` -> `null`.
    `phase_number` -> `null`.
    `phase_name` -> `null`.
    `completed_at` -> current ISO-8601 timestamp.
    `handoff_note` -> `Protocol run completed successfully.`
    `handoff_context` -> `All <N> phases completed and validated. Validation report at $KILN_DIR/validation/report.md. Protocol run is finished.`
    `last_updated` -> current ISO-8601 UTC timestamp.
    Count completed phases as `N`.
    Print exactly:
    ```text
    Kiln protocol complete.
      Project: $PROJECT_PATH
      Phases completed: <N>
      Validation report: $PROJECT_PATH/.kiln/validation/report.md

    Run `kilntwo doctor` to verify your installation health.
    To resume a paused run, use /kiln:resume.
    ```
    End execution.

---

## Key Rules

1. **All paths are dynamic.** Never hardcode paths. Derive every path from `PROJECT_PATH`, `HOME`, and `ENCODED_PATH` from Step 3. The command must work in any project directory.
2. **Memory is the source of truth.** Before every stage transition, re-read `MEMORY_DIR/MEMORY.md` and trust canonical fields (`stage`, `status`, `planning_sub_stage`, `phase_number`, `phase_total`, and `## Phase Statuses`). If `stage=planning` and `status=paused`, resume planning review at Step 11. If `stage=execution` and `phase_number` is set, resume execution from that phase using `phase_status` values.
3. **Never skip stages.** Execute Stage 1 before Stage 2 and Stage 2 before Stage 3. The only exception is resumption as described in Rule 2. Use `/kiln:resume` for resumption; do not implement separate resume logic outside these state checks.
4. **Use the Task tool for all sub-agents.** Never invoke `kiln-planner-claude`, `kiln-planner-codex`, `kiln-debater`, `kiln-synthesizer`, `kiln-phase-executor`, or `kiln-validator` as slash commands. Spawn each exclusively with the Task tool and complete, self-contained prompts. Always set `name` to the agent's character alias (e.g., `"Confucius"`, `"Maestro"`) and `subagent_type` to the internal name (e.g., `kiln-planner-claude`). This ensures the Claude Code UI shows aliases in the spawn box.
5. **Parallel where safe, sequential where required.** Run Step 8 planners in parallel. Run all other Task spawns sequentially, waiting for each to finish before starting the next.
6. **Write working outputs only.** Phase executors must create real files with real content and working code. Placeholders, TODO stubs, and non-functional scaffolds are failures that must be reported before continuing.
7. **Checkpoint memory after every significant action.** Update canonical runtime fields (`stage`, `status`, `planning_sub_stage`, phase fields, `handoff_note`, `handoff_context`, `last_updated`, and phase-status entries when applicable) after Step 2, after Step 4, after Step 5, at every brainstorm checkpoint, after Step 7, after Step 10, after Step 12, after each phase in Step 13, after Step 14, and after Step 15.
