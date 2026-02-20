# /kiln:start — Kiln Protocol Entry Point
Execute the Kiln protocol autonomously from the current working directory using filesystem tools, bash commands, and the Task tool. Initialize project state, build memory, run collaborative planning with dual planners and optional debate, then execute the approved plan phase by phase with validation. Treat this file as authoritative runtime instructions. Proceed without asking between steps unless you encounter: an ambiguous requirement, a conflicting instruction, an unexpected error, or a situation not covered by the master plan. In those cases, stop and ask the operator (protocol rule 8).

---

Read `$CLAUDE_HOME/kilntwo/skills/kiln-core.md` at startup for the canonical MEMORY.md schema, paths contract, config schema, event enum, and Codex CLI patterns. This file uses those definitions without repeating them.

---

## Stage 1: Initialization & Brainstorm

1. Detect project path and initialize git.
   Before doing anything else in this step:
   Read `$CLAUDE_HOME/kilntwo/data/lore.json` and pick a random quote from `transitions.ignition.quotes`. Render the banner and persist the quote in a single Bash call:
   ```bash
   mkdir -p "$KILN_DIR/tmp" && \
   printf '\n\033[38;5;179m━━━ Ignition ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
   printf '{"quote":"%s","by":"%s","section":"ignition","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
   ```
   Do not use the Write tool for `last-quote.json`. Note: if `$KILN_DIR` does not exist yet, defer the mkdir+persist to after Step 2 creates `$KILN_DIR`.

   Then read `$CLAUDE_HOME/kilntwo/data/lore.json`. Pick a random entry from the `greetings` array. Display it via Bash printf with terracotta color:
   ```bash
   printf '\033[38;5;173m%s\033[0m\n\n' "$GREETING"
   ```
   Then print: `Before we fire up the forge, a few quick questions.`

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
   `tmp/`
   `config.json`
   `*_state.md`
   `codebase-snapshot.md`
   Do not add extra entries.
   Do not add trailing spaces.
   After writing `.gitignore`, create `$KILN_DIR/config.json`:
   - Read template from `$CLAUDE_HOME/kilntwo/data/default-config.json`.
   - If template is missing, write the default config object inline with `model_mode`, `preferences`, and `tooling` fields.
   - If `$KILN_DIR/config.json` already exists and parses as JSON, preserve it.
   - If it exists but is invalid JSON, overwrite with the default template.
   After writing this file, update `MEMORY_DIR/MEMORY.md` later in Step 4 (or as soon as `MEMORY_DIR` exists) with:
   `stage` = `brainstorm`
   `status` = `in_progress`
   `handoff_note` = `.kiln directory initialized.`
   `handoff_context` = `Project directory structure created at $KILN_DIR with .gitignore and config.json. Memory not yet initialized.`
   Also update `last_updated`.

   After creating `$KILN_DIR/`, install spinner verbs:
   Install spinner verbs via a single Bash command (never use the Write tool for this file):
   Read `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json` and build a flat array from `generic` + `brainstorm` verbs. Then run one Bash call:
   ```bash
   mkdir -p "$PROJECT_PATH/.claude" && printf '%s' '{"spinnerVerbs":{"mode":"replace","verbs":[...]}}' > "$PROJECT_PATH/.claude/settings.local.json"
   ```
   The path MUST be absolute. Never use a relative path.

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
   Process these template files from `$CLAUDE_HOME/kilntwo/templates/`: MEMORY.md, vision.md, master-plan.md, decisions.md, pitfalls.md, PATTERNS.md, tech-stack.md. For each: if memory file is missing or empty, copy from template (if available) or create with H1 heading only. Exception: for MEMORY.md, populate canonical schema fields (see kiln-core.md) rather than copying the template verbatim. Do not overwrite files that already contain non-empty content beyond a header.
   For `MEMORY.md`, populate these fields: `project_name` = basename of `PROJECT_PATH`, `project_path` = full `PROJECT_PATH`, `date_started` = today in `YYYY-MM-DD`, `stage` = `brainstorm`, `status` = `in_progress`, `planning_sub_stage` = `null`, `debate_mode` = `2`, `phase_number` = `null`, `phase_name` = `null`, `phase_total` = `null`, `handoff_note` = `Memory initialized; ready for brainstorming.`, `handoff_context` = `All core memory files instantiated from templates. Project is ready for Stage 1 brainstorming.`, `last_updated` = current ISO-8601 UTC timestamp. Keep `## Phase Statuses` present and empty.
   After completing this step, update `MEMORY_DIR/MEMORY.md`: `stage` = `brainstorm`, `status` = `in_progress`, `handoff_note` = `Memory initialization complete.`, `handoff_context` = `All core memory files instantiated from templates. Project is ready for brainstorming.`, `last_updated` = current ISO-8601 UTC timestamp.

4.5. Detect project mode.
   Check for brownfield indicators in `PROJECT_PATH`:
   - Dependency manifests: `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `build.gradle`
   - Source directories with source files: `src/`, `lib/`, `app/`, `cmd/`
   - Existing git history: run `git -C $PROJECT_PATH log --oneline -1` (non-empty output means commits exist)
   Also detect tooling hints for `$KILN_DIR/config.json`:
   - `package-lock.json` => `tooling.package_manager = npm`
   - `yarn.lock` => `tooling.package_manager = yarn`
   - `pnpm-lock.yaml` => `tooling.package_manager = pnpm`
   - `Makefile` => `tooling.build_system = make`
   - `tsconfig.json` => `tooling.type_checker = tsc`
   - `.eslintrc*` or `eslint.config.*` => `tooling.linter = eslint`
   - `package.json` scripts containing `test` => infer `tooling.test_runner` from script (`jest`, `vitest`, `mocha`, or `npm test`)

   If NO indicators found: set `PROJECT_MODE = greenfield`, write `project_mode: greenfield` to MEMORY.md `## Metadata`, update `handoff_note` = `Project mode: greenfield; brainstorm depth selection next.`, update `last_updated`. Proceed to Step 5.

   If indicators found: display detected files/directories to operator. Ask exactly:
   "I found an existing codebase ([list detected indicators]). Should I run Mnemosyne to map it before brainstorming?
     [Y] Map the codebase first (recommended)  [N] Skip mapping, start fresh"

   Set `PROJECT_MODE = brownfield`, write `project_mode: brownfield` to MEMORY.md `## Metadata`. If any tooling hints were detected, merge them into `$KILN_DIR/config.json` `tooling` fields (keep existing non-null values unless a more specific detected value exists).

   If operator responds Y:
   - Spawn `kiln-mapper` via the Task tool: `name: "Mnemosyne"`, `subagent_type: kiln-mapper`, `description`: (next quote from names.json). Task prompt must include `project_path`, `memory_dir`, `kiln_dir`, and instruction: "Map the existing codebase and pre-seed memory files. Write codebase-snapshot.md and seed decisions.md and pitfalls.md. Signal completion when done."
   - Wait for Mnemosyne to return.
   - Confirm: "Mnemosyne complete. Codebase snapshot ready at `$KILN_DIR/codebase-snapshot.md`."

   In both brownfield cases (Y or N), update MEMORY.md: `project_mode`, `handoff_note` (Y: `Project mode: brownfield; Mnemosyne complete; brainstorm depth next.` / N: `Project mode: brownfield (mapping skipped); brainstorm depth next.`), `handoff_context` (Y: `Brownfield project. Mnemosyne mapped the codebase. Snapshot at $KILN_DIR/codebase-snapshot.md. Decisions and pitfalls pre-seeded.` / N: `Brownfield indicators found. Operator chose to skip Mnemosyne mapping. Planners will work from vision.md only.`), `last_updated`. Proceed to Step 5.

5. Onboarding questions.
   Ask the following questions in order. All questions support "tell me more" or "?" as input — this triggers a tour-mode explanation for that question regardless of current mode.

   **Q1 — Communication Style (ask first, plain text, NOT AskUserQuestion):**
   "One thing before we fire up — how should I talk to you?

     [1] Give me the full tour — Explain what each setting does, introduce the
         agents, tell me why these choices matter.

     [2] Just the controls — Show me my options. Skip the backstory.

   Either way, you can always ask 'tell me more' on any question."

   Store response as `OPERATOR_MODE`. Map: `1` = `tour`, `2` = `express`. Empty response or Enter → `tour`. If invalid, re-prompt once; if still invalid, use `tour`.
   Write `operator_mode` to `$KILN_DIR/config.json` (merge into existing JSON).

   **Q2 — Brainstorm Depth:**
   Ask based on `OPERATOR_MODE`:
   - Tour mode: "Time to calibrate Da Vinci — he's our brainstorm facilitator. He'll explore your idea using creative techniques and build a structured vision document.

     [1] Light — Quick sketch. 10+ ideas, fast convergence.
     [2] Standard — Broad exploration. 30+ ideas, covers blind spots. [default]
     [3] Deep — Full Da Vinci. 100+ ideas, every technique in the book."
   - Express mode: "Brainstorm depth? [1=Light / 2=Standard (default) / 3=Deep]"

   Store response as `BRAINSTORM_DEPTH`. Map: `1` = `light`, `2` = `standard`, `3` = `deep`. Empty response or Enter → `standard`. If invalid, re-prompt once; if still invalid, use `standard`.
   Record `brainstorm_depth` in `MEMORY_DIR/MEMORY.md`, update `handoff_note` = `Brainstorm depth set to <BRAINSTORM_DEPTH>; debate mode selection next.`, `last_updated`.

   **Q3 — Debate Mode:**
   Ask based on `OPERATOR_MODE`:
   - Tour mode: "After brainstorming, two AI planners independently design your implementation — one Claude, one GPT. Then Socrates compares their plans and resolves disagreements.

     [1] Skip — One planner only, no debate.
     [2] Focused — One debate round. The sweet spot for most projects. [default]
     [3] Full — Iterative debate until plans converge."
   - Express mode: "Debate mode? [1=Skip / 2=Focused (default) / 3=Full]"

   Store response as `DEBATE_MODE`. If empty → `2`. If invalid, re-prompt once; if still invalid, use `2`.
   Record `debate_mode` in `MEMORY_DIR/MEMORY.md`, update `handoff_note` = `Debate mode set to <DEBATE_MODE>; spawning Da Vinci.`, `handoff_context` = `Debate mode <DEBATE_MODE> selected. Brainstorm depth <BRAINSTORM_DEPTH> selected. About to spawn Da Vinci.`, `last_updated`.

   After all questions are answered, create the session team: `TeamCreate("kiln-session")`.

   Then render a brainstorm_start ANSI banner (see Step 6 below), then print via Bash:
   ```bash
   printf '\033[2mConfiguration locked. Spawning Da Vinci.\nDepth: %s. Debate: %s. Let'\''s see what you'\''ve got.\n\nDa Vinci, the floor is yours.\033[0m\n' "$BRAINSTORM_DEPTH" "$DEBATE_MODE"
   ```

6. Spawn brainstormer agent.
   Before spawning in this step:
   Read `$CLAUDE_HOME/kilntwo/data/lore.json` and pick a random quote from `transitions.brainstorm_start.quotes`. Render the banner and persist the quote in a single Bash call:
   ```bash
   mkdir -p "$KILN_DIR/tmp" && \
   printf '\n\033[38;5;179m━━━ Brainstorm ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
   printf '{"quote":"%s","by":"%s","section":"brainstorm_start","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
   ```
   Do not use the Write tool for `last-quote.json`.

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

7. Run pre-flight checklist.
   Verify all before Stage 2:
   - `vision.md` is non-empty with all required sections: Problem Statement, Target Users, Goals, Constraints, Tech Stack, Open Questions, Elicitation Log (at least one entry). No placeholder text (`_To be filled_`, `_TBD_`).
   - `DEBATE_MODE` is `1`, `2`, or `3`.
   - `$KILN_DIR/` exists and git is initialized in `PROJECT_PATH`.
   - `MEMORY_DIR` contains: `MEMORY.md`, `vision.md`, `master-plan.md`, `decisions.md`, `pitfalls.md`, `PATTERNS.md`, `tech-stack.md`.
   If any check fails, halt and tell the user exactly what is missing. Do not continue until fixed.
   If all checks pass:
   Read `$CLAUDE_HOME/kilntwo/data/lore.json` and pick a random quote from `transitions.brainstorm_complete.quotes`. Render the banner and persist the quote in a single Bash call:
   ```bash
   mkdir -p "$KILN_DIR/tmp" && \
   printf '\n\033[38;5;179m━━━ Brainstorm Complete ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
   printf '{"quote":"%s","by":"%s","section":"brainstorm_complete","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
   ```
   Do not use the Write tool for `last-quote.json`.
   Then print via Bash:
   ```bash
   printf '\033[32m✓\033[0m Pre-flight check complete.\n  \033[2mProject:\033[0m %s\n  \033[2mMemory:\033[0m  %s\n  \033[2mDebate:\033[0m  mode %s\n  \033[2mVision:\033[0m  ready\n\n\033[38;5;179mProceeding to Stage 2: Planning.\033[0m\n' \
     "$PROJECT_PATH" "$MEMORY_DIR" "$DEBATE_MODE"
   ```
   Update `MEMORY_DIR/MEMORY.md`: `stage` = `planning`, `status` = `in_progress`, `planning_sub_stage` = `dual_plan`, `handoff_note` = `Pre-flight passed; planning started.`, `handoff_context` = `Brainstorming complete. Vision captured in vision.md. Pre-flight checks passed. Aristotle about to be spawned for Stage 2 planning.`, `last_updated` = current ISO-8601 UTC timestamp.

---

## Stage 2: Planning

8. Spawn the Stage 2 planning coordinator.
   Before spawning in this step:
   Read `$CLAUDE_HOME/kilntwo/data/lore.json` and pick a random quote from `transitions.planning_start.quotes`. Render the banner and persist the quote in a single Bash call:
   ```bash
   mkdir -p "$KILN_DIR/tmp" && \
   printf '\n\033[38;5;179m━━━ Planning ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
   printf '{"quote":"%s","by":"%s","section":"planning_start","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
   ```
   Do not use the Write tool for `last-quote.json`.

   Install spinner verbs via a single Bash command (never use the Write tool for this file):
   Read `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json` and build a flat array from `generic` + `planning` verbs. Then run one Bash call:
   ```bash
   mkdir -p "$PROJECT_PATH/.claude" && printf '%s' '{"spinnerVerbs":{"mode":"replace","verbs":[...]}}' > "$PROJECT_PATH/.claude/settings.local.json"
   ```
   The path MUST be absolute. Never use a relative path.

   Update `MEMORY_DIR/MEMORY.md`:
   `stage` = `planning`
   `status` = `in_progress`
   `planning_sub_stage` = `dual_plan`
   `handoff_note` = `Stage 2 planning started; spawning Aristotle.`
   `handoff_context` = `Kiln is delegating Stage 2 planning (dual planners, debate, synthesis, Athena validation, operator approval loop) to the planning coordinator.`
   `last_updated` = current ISO-8601 UTC timestamp.

   Spawn `kiln-planning-coordinator` via the Task tool:
   `name`: `"Aristotle"` (the alias)
   `subagent_type`: `kiln-planning-coordinator`
   `team_name`: `"kiln-session"`
   `description`: (next quote from names.json quotes array for kiln-planning-coordinator)
   Immediately after spawning, send a nudge: `SendMessage(recipient: "Aristotle", content: "REMINDER: Create your aristotle-planning sub-team and spawn ALL workers with team_name. Every agent must be a teammate, not a bare subagent. Use SendMessage to nudge Sun Tzu about Codex CLI delegation after spawning him.", summary: "Team creation and delegation reminder")`.
   The Task prompt MUST include only these scalar inputs and absolute paths (do not inline large file contents):
   - `project_path` = `$PROJECT_PATH`
   - `memory_dir` = `$MEMORY_DIR`
   - `kiln_dir` = `$KILN_DIR`
   - `debate_mode` = `$DEBATE_MODE`
   - `brainstorm_depth` = `$BRAINSTORM_DEPTH`
   Instruction: "Own all of Stage 2 planning end-to-end: dual planners, conditional debate, synthesis, plan validation (Athena writes `plan_validation.md`), and operator approval. Return only `PLAN_APPROVED` or `PLAN_BLOCKED`."

9. Wait for the coordinator signal.
   Wait for Aristotle to complete.
   Parse the coordinator return signal from the first non-empty line:
   - `PLAN_APPROVED`
   - `PLAN_BLOCKED`
   If the signal is missing or malformed, treat as `PLAN_BLOCKED`.

10. If the signal is `PLAN_BLOCKED`, halt.
    Read `MEMORY_DIR/MEMORY.md` and display `handoff_note` and `handoff_context` to the operator.
    Tell the operator: "Planning is blocked or paused. Resolve the issue, then run `/kiln:resume`."
    Stop execution immediately.

11. If the signal is `PLAN_APPROVED`, confirm memory and read `phase_total`.
    Read `MEMORY_DIR/MEMORY.md`.
    Confirm it contains:
    `stage` = `execution`
    `status` = `in_progress`
    `planning_sub_stage` = `null`
    Read the integer `phase_total` field from MEMORY.md and store it for Stage 3.
    If `phase_total` is missing or non-integer, halt and tell the operator MEMORY.md is corrupted/incomplete.

12. Display the plan-approved transition and proceed to Stage 3.
    Before proceeding:
    Read `$CLAUDE_HOME/kilntwo/data/lore.json` and pick a random quote from `transitions.plan_approved.quotes`. Render the banner and persist the quote in a single Bash call:
    ```bash
    mkdir -p "$KILN_DIR/tmp" && \
    printf '\n\033[38;5;179m━━━ Plan Approved ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
    printf '{"quote":"%s","by":"%s","section":"plan_approved","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
    ```
    Do not use the Write tool for `last-quote.json`.
    Confirm `MEMORY_DIR/master-plan.md` exists and is non-empty.
    Proceed immediately to Stage 3 (Execution).

---

## Stage 3: Execution

13. Execute each phase sequentially.
    Read `MEMORY_DIR/master-plan.md`.
    Parse every section whose heading begins with `### Phase`.
    Keep original order.
    Set `phase_total` in `MEMORY.md` to the parsed phase count before the loop starts.

    **Parallel pre-reads for Stage 3** (issue all in a single parallel batch):
    1. `$MEMORY_DIR/master-plan.md`
    2. `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json`
    3. `$CLAUDE_HOME/kilntwo/data/lore.json`

    These are needed throughout the execution loop. Read once, reuse from memory.

    Install spinner verbs via a single Bash command (never use the Write tool for this file):
    Read `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json` (from the pre-read above) and build a flat array from `generic` + `execution` verbs. Then run one Bash call:
    ```bash
    mkdir -p "$PROJECT_PATH/.claude" && printf '%s' '{"spinnerVerbs":{"mode":"replace","verbs":[...]}}' > "$PROJECT_PATH/.claude/settings.local.json"
    ```
    The path MUST be absolute. Never use a relative path.

    For each phase:
    Before phase initialization, use the lore.json data already read above (do not re-read) and pick a random quote from `transitions.phase_start.quotes`. Render the banner and persist the quote in a single Bash call:
    ```bash
    mkdir -p "$KILN_DIR/tmp" && \
    printf '\n\033[38;5;179m━━━ Phase %s: %s ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$PHASE_NUMBER" "$PHASE_NAME" "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
    printf '{"quote":"%s","by":"%s","section":"phase_start","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
    ```
    Do not use the Write tool for `last-quote.json`.
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
    `team_name`: `"kiln-session"`
    `description`: (next quote from names.json quotes array for kiln-phase-executor)
    Immediately after spawning, send a nudge: `SendMessage(recipient: "Maestro", content: "REMINDER: Create your maestro-phase-<N> sub-team and spawn ALL workers with team_name. Every agent (Sherlock, Scheherazade, Codex, Sphinx, planners) must be a teammate, not a bare subagent. Use SendMessage to nudge Codex about CLI delegation after spawning.", summary: "Team creation and delegation reminder")`.
    Task prompt must include:
    Full phase section from the master plan, including name, goal, tasks, and acceptance criteria.
    `PROJECT_PATH`.
    `MEMORY_DIR`.
    Include this instruction text:
    "Read MEMORY.md and vision.md from MEMORY_DIR at startup for full project context. Implement this phase completely. Write working code, create real files, run tests. When done, write a phase summary to `$MEMORY_DIR/phase-<N>-results.md` with sections: Completed Tasks, Files Created or Modified, Tests Run and Results, Blockers or Issues. Do not proceed to the next phase — stop after this phase is complete."
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
    After phase completion update, use the lore.json data already read above (do not re-read) and pick a random quote from `transitions.phase_complete.quotes`. Render the banner and persist the quote in a single Bash call:
    ```bash
    mkdir -p "$KILN_DIR/tmp" && \
    printf '\n\033[38;5;179m━━━ Phase %s Complete ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$PHASE_NUMBER" "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
    printf '{"quote":"%s","by":"%s","section":"phase_complete","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
    ```
    Do not use the Write tool for `last-quote.json`.
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
    Before entering validation loop:
    Use the lore.json data already read above (do not re-read) and pick a random quote from `transitions.validation_start.quotes`. Render the banner and persist the quote in a single Bash call:
    ```bash
    mkdir -p "$KILN_DIR/tmp" && \
    printf '\n\033[38;5;179m━━━ Validation ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
    printf '{"quote":"%s","by":"%s","section":"validation_start","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
    ```
    Do not use the Write tool for `last-quote.json`.

    **Parallel pre-reads for Stage 4** (issue all in a single parallel batch):
    1. `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json`
    2. `$CLAUDE_HOME/kilntwo/data/lore.json`

    Install spinner verbs via a single Bash command (never use the Write tool for this file):
    Read `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json` (from the pre-read above) and build a flat array from `generic` + `validation` verbs. Then run one Bash call:
    ```bash
    mkdir -p "$PROJECT_PATH/.claude" && printf '%s' '{"spinnerVerbs":{"mode":"replace","verbs":[...]}}' > "$PROJECT_PATH/.claude/settings.local.json"
    ```
    The path MUST be absolute. Never use a relative path.

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
    "Build, deploy, and validate the project end-to-end. Test the actual running product against the master plan's acceptance criteria. For each failure, generate a correction task description with: what failed, evidence, affected files, suggested fix, and verification command. Write the validation report to `$KILN_DIR/validation/report.md`."
   Wait for completion.
    Confirm `$KILN_DIR/validation/report.md` exists and is readable.

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
    `team_name`: `"kiln-session"`
    `description`: (next quote from names.json quotes array for kiln-phase-executor)
    Immediately after spawning, send the same team creation and delegation nudge as in Step 13.
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
    Before final status output in this step:
    Read `$CLAUDE_HOME/kilntwo/data/lore.json` and pick a random quote from `transitions.project_complete.quotes`. Render the banner and persist the quote in a single Bash call:
    ```bash
    mkdir -p "$KILN_DIR/tmp" && \
    printf '\n\033[38;5;179m━━━ Project Complete ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
    printf '{"quote":"%s","by":"%s","section":"project_complete","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
    ```
    Do not use the Write tool for `last-quote.json`.
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

    Delete the session team: `TeamDelete("kiln-session")`.

    Count completed phases as `PHASE_COUNT`.
    Print via Bash:
    ```bash
    printf '\n\033[38;5;173m[kiln]\033[0m Protocol complete.\n  \033[2mProject:\033[0m %s\n  \033[2mPhases:\033[0m  %s completed\n  \033[2mReport:\033[0m  %s\n\n\033[2mRun kilntwo doctor to verify installation health.\nTo resume a paused run, use /kiln:resume.\033[0m\n' \
      "$PROJECT_PATH" "$PHASE_COUNT" "$KILN_DIR/validation/report.md"
    ```
    End execution.

---

## Key Rules

1. **All paths are dynamic.** Never hardcode paths. Derive every path from `PROJECT_PATH`, `HOME`, and `ENCODED_PATH` from Step 3. The command must work in any project directory.
2. **Memory is the source of truth.** Before every stage transition, re-read `MEMORY_DIR/MEMORY.md` and trust canonical fields (`stage`, `status`, `planning_sub_stage`, `phase_number`, `phase_total`, and `## Phase Statuses`). If `stage=planning` and `status=paused`, resume planning review at Step 11. If `stage=execution` and `phase_number` is set, resume execution from that phase using `phase_status` values.
3. **Never skip stages.** Execute Stage 1 before Stage 2 and Stage 2 before Stage 3. The only exception is resumption as described in Rule 2. Use `/kiln:resume` for resumption; do not implement separate resume logic outside these state checks.
4. **Use the Task tool for all sub-agents.** Never invoke `kiln-planner-claude`, `kiln-planner-codex`, `kiln-debater`, `kiln-synthesizer`, `kiln-plan-validator`, `kiln-planning-coordinator`, `kiln-phase-executor`, or `kiln-validator` as slash commands. Spawn each exclusively with the Task tool and complete, self-contained prompts. Always set `name` to the agent's character alias (e.g., `"Confucius"`, `"Aristotle"`, `"Maestro"`) and `subagent_type` to the internal name (e.g., `kiln-planner-claude`). This ensures the Claude Code UI shows aliases in the spawn box.
5. **Parallel where safe, sequential where required.** Run Step 8 planners in parallel. Run all other Task spawns sequentially, waiting for each to finish before starting the next.
6. **Write working outputs only.** Phase executors must create real files with real content and working code. Placeholders, TODO stubs, and non-functional scaffolds are failures that must be reported before continuing.
7. **Checkpoint memory after every significant action.** Update canonical runtime fields (`stage`, `status`, `planning_sub_stage`, phase fields, `handoff_note`, `handoff_context`, `last_updated`, and phase-status entries when applicable) after Step 2, after Step 4, after Step 5, at every brainstorm checkpoint, after Step 7, after Step 8 (planning coordinator return), after each phase in Step 13, after Step 14, and after Step 15.
8. **No project build/test commands.** The orchestrator MUST NOT run `cargo check`, `npm test`, `go build`, `make`, `pytest`, or any project build/compile/test/lint commands. These are delegated to Maestro (Stage 3) and Argus (Stage 4).
