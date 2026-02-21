# /kiln:resume
Restore project context from memory and continue exactly where the last session stopped.
Read `$CLAUDE_HOME/kilntwo/skills/kiln-core.md` at startup for the canonical MEMORY.md schema, paths contract, config schema, event enum, and Codex CLI patterns. This file uses those definitions without repeating them.
## Step 1: Detect Project Path
Determine the project path from the current working directory (`process.cwd()`, `$PWD`, or equivalent) and store it as `PROJECT_PATH`.
If you cannot determine `PROJECT_PATH`, halt immediately and tell the user exactly:
"Cannot determine project path. Please run this command from the project root."
## Step 2: Compute Memory Directory Path
Compute the encoded project path using POSIX slash splitting exactly as `absolutePath.split('/').join('-')`, then set `MEMORY_DIR = $CLAUDE_HOME/projects/$ENCODED_PATH/memory/`.
Worked example: `PROJECT_PATH=/DEV/myproject`, `encoded=-DEV-myproject`, `MEMORY_DIR=$CLAUDE_HOME/projects/-DEV-myproject/memory/`.
## Step 3: Read MEMORY.md
Read `$MEMORY_DIR/MEMORY.md`.
If the file does not exist, or is empty, halt immediately and output exactly this warning block and nothing else:
```
[kiln:resume] No memory found at <resolved memory dir path>.
Memory may not have been initialized. Run /kiln:start to begin a new project session.
```
If the file exists, extract and store these fields:
- `stage` (`brainstorm`, `planning`, `execution`, `validation`, `complete`)
- `phase_number` (integer; only during `execution`, otherwise absent or `null`)
- `phase_name` (string; only during `execution`, otherwise absent or `null`)
- `phase_total` (integer; only during `execution`)
- `status` (`in_progress`, `paused`, `blocked`, `complete`)
- `handoff_note` (single-line routing hint; may be empty)
- `handoff_context` (multi-line narrative block; may be empty or absent)
- `debate_mode` (integer `1|2|3`; default `2` if absent)
- `planning_sub_stage` (`dual_plan`, `debate`, `synthesis`, or `null`)
- `project_mode` (`greenfield` or `brownfield`; may be absent)
- `last_updated` (ISO-8601 string; optional but recommended)
- `correction_cycle` (integer 0-3; 0 or absent when not in correction)
Also parse the `## Phase Statuses` section.
Each entry must be formatted as:
`- phase_number: <int> | phase_name: <string> | phase_status: <pending|in_progress|failed|completed>`
If `stage` or `status` are missing, or contain unrecognized values, treat MEMORY.md as corrupted, halt immediately, and output exactly:
```
[kiln:resume] MEMORY.md is corrupted or incomplete (missing required fields: <list>).
Run /kiln:start to reinitialize, or manually repair $CLAUDE_HOME/projects/<encoded>/memory/MEMORY.md.
```
## Step 4: Supporting Files
Supporting memory files (`vision.md`, `master-plan.md`, `decisions.md`, `pitfalls.md`, `PATTERNS.md`, `tech-stack.md`) are read by coordinators at their own startup — not by the orchestrator. Do not preload them here. If you need a specific value for routing (e.g., to display a summary), read only the specific file and extract only the needed fields.
## Step 5: Display Continuity Banner
Read `$CLAUDE_HOME/kilntwo/data/lore.json` and pick a random quote from `transitions.resume.quotes`. Render the banner and persist the quote in a single Bash call:
```bash
mkdir -p "$KILN_DIR/tmp" && \
printf '\n\033[38;5;179m━━━ Resume ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' "$QUOTE_TEXT" "$QUOTE_SOURCE" && \
printf '{"quote":"%s","by":"%s","section":"resume","at":"%s"}' "$QUOTE_TEXT" "$QUOTE_SOURCE" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > "$KILN_DIR/tmp/last-quote.json"
```
Do not use the Write tool for `last-quote.json`.

Then render the state summary via Bash:
```bash
printf '\033[2mSession rehydrated. Here'\''s where we left off:\033[0m\n'
printf '  \033[38;5;173m►\033[0m Stage: %s\n' "$STAGE"
```
If `project_mode` is present (not absent), render:
```bash
printf '  \033[2mMode:\033[0m    %s\n' "$PROJECT_MODE"
```
If in execution stage with phase info:
```bash
printf '  \033[38;5;173m►\033[0m Phase %s of %s │ %s\n' "$PHASE_NUMBER" "$PHASE_TOTAL" "$PHASE_NAME"
```
If correction_cycle is non-zero, also render:
```bash
printf '  \033[38;5;173m►\033[0m Correction: cycle %s/3\n' "$CORRECTION_CYCLE"
```
If handoff_note is present:
```bash
printf '  \033[2mHandoff:\033[0m %s\n' "$HANDOFF_NOTE"
```
End with:
```bash
printf '\n\033[2mPicking up where we left off.\033[0m\n\n'
```
If `handoff_context` is present and non-empty, display it immediately after the banner as a quoted block:
```
Context:
  [handoff_context content, indented 2 spaces per line]
```
After displaying the banner, check whether MEMORY.md contains a `## Reset Notes` section. If it does, parse the `next_action` field from that section. If `next_action` is present and non-empty, display it to the operator immediately after the banner as:
```
Recommended next step (from last reset): [next_action]
```
## Step 5.5: Clean Team State and Recreate Session Team
Teams do not persist cleanly across Claude Code sessions. Crashed or interrupted sessions leave stale team directories that block `TeamCreate`. Always clean up stale teams, then Always create the session team fresh.

1. Remove all known Kiln team directories via Bash (ignore errors if they don't exist):
   ```bash
   rm -rf $HOME/.claude/teams/kiln-session/
   ```
2. Create the session team: `TeamCreate("kiln-session")`

Do not check whether the team exists first. Do not skip this step. This ensures a clean slate regardless of how the previous session ended.
## Step 6: Route to Stage
Branch strictly on `stage` and run the matching behavior.
For `brainstorm`:
- Install spinner verbs via a single Bash command (never use the Write tool for this file):
  Read `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json` and build a flat array from `generic` + `brainstorm` verbs. Then run one Bash call:
  ```bash
  mkdir -p "$PROJECT_PATH/.claude" && printf '%s' '{"spinnerVerbs":{"mode":"replace","verbs":[...]}}' > "$PROJECT_PATH/.claude/settings.local.json"
  ```
  The path MUST be absolute. Never use a relative path.
- Re-read `vision.md` in full.
- Tell the user: "Resuming brainstorming session. Here is the current vision:"
- Print the full content of `vision.md`.
- Ask: "What would you like to explore or refine next?"
For `planning`:
- Install spinner verbs via a single Bash command (never use the Write tool for this file):
  Read `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json` and build a flat array from `generic` + `planning` verbs. Then run one Bash call:
  ```bash
  mkdir -p "$PROJECT_PATH/.claude" && printf '%s' '{"spinnerVerbs":{"mode":"replace","verbs":[...]}}' > "$PROJECT_PATH/.claude/settings.local.json"
  ```
  The path MUST be absolute. Never use a relative path.
- Read `planning_sub_stage` from MEMORY.md.
- Tell the user: "Resuming planning stage (sub-stage: [planning_sub_stage])."
- Spawn `kiln-planning-coordinator` via the Task tool:
  - `name`: `"Aristotle"`
  - `subagent_type`: `kiln-planning-coordinator`
  - `description`: (next quote from names.json quotes array for kiln-planning-coordinator)
  - **The Task prompt MUST begin with**: "Spawn all workers via Task without team_name — Claude Code auto-registers them into the session team. For Sun Tzu, prepend the Codex CLI delegation mandate directly in the Task prompt — Sun Tzu must pipe through codex exec -m gpt-5.2, not write the plan itself. See Sun Tzu's agent definition for the exact CLI patterns."
  - Then include:
    - `project_path` = `$PROJECT_PATH`
    - `memory_dir` = `$MEMORY_DIR`
    - `kiln_dir` = `$KILN_DIR`
    - `debate_mode` from MEMORY.md (default 2 if absent)
    - `brainstorm_depth` from MEMORY.md (default `standard` if absent)
  - Instruction: "Resume the Stage 2 planning pipeline from current state. Read planning_sub_stage from MEMORY.md and check existing artifacts to determine where to resume. Run plan validation (Athena writes `plan_validation.md`) and operator approval. Return `PLAN_APPROVED` or `PLAN_BLOCKED`."
- Parse the return value:
  - If first non-empty line is `PLAN_APPROVED`: re-read MEMORY.md, confirm `stage=execution` and `phase_total` is set, proceed to execution routing.
  - If first non-empty line is `PLAN_BLOCKED`: display `handoff_note` and `handoff_context` to operator, halt.
  - If signal missing or malformed: treat as `PLAN_BLOCKED`.
For `execution`:
- **Parallel pre-reads** (issue all of these in a single parallel batch):
  1. `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json`
  2. `$CLAUDE_HOME/kilntwo/data/lore.json`
  3. `$MEMORY_DIR/master-plan.md`
  4. All `$KILN_DIR/phase_*_state.md` files (Glob)
  5. `$KILN_DIR/archive/` directory listing (Glob for `phase_*/phase_summary.md`)

  These reads are independent. Issue them as parallel tool calls in a single response.

- Install spinner verbs from the pre-read data via a single Bash command (never use the Write tool for this file):
  Build a flat array from `generic` + `execution` verbs. Then run one Bash call:
  ```bash
  mkdir -p "$PROJECT_PATH/.claude" && printf '%s' '{"spinnerVerbs":{"mode":"replace","verbs":[...]}}' > "$PROJECT_PATH/.claude/settings.local.json"
  ```
  The path MUST be absolute. Never use a relative path.
- Build the phase inventory from `master-plan.md` and MEMORY.md fields (already extracted in Step 3): for each phase in `master-plan.md`, record `{phase_number, name, status}` where status is one of `completed | in_progress | failed | pending` (derive **from `MEMORY.md`**, not from assumptions).
- Cross-check against archive using the pre-read directory listing: if `$KILN_DIR/archive/phase_<NN>/phase_summary.md` exists for a phase, treat that phase as definitively completed regardless of `MEMORY.md` status (the archive is created only after successful merge).
- Determine `N` automatically:
  - If `MEMORY.md` indicates a phase `N` is `in_progress` (or the `handoff_note` says work was mid-phase), **resume phase `N`**.
  - Else if a phase `N` is `failed`, **retry phase `N`** (trust `handoff_note` for what was happening / what to fix).
  - Else pick the **lowest-numbered `pending`** phase as `N`.
  - Else (no pending/in_progress/failed phases remain), **set stage to `validation` and route to validation**.
- Load phase context for `N`:
  - If `$KILN_DIR/phase_<N>_state.md` exists, read it as authoritative and parse `## Events`.
| Last event type | Restart from |
|---|---|
| `setup`, `branch` | Step 2 (plan) |
| `plan_start`, `plan_complete`, `debate_complete`, `synthesis_complete` | Next sub-step after last |
| `sharpen_start` | Step 3 (sharpen) |
| `sharpen_complete` | Step 4 (implement) |
| `reconcile_complete` | Step 7 (archive) |
| `task_start`, `task_success`, `task_retry`, `task_fail` | Next incomplete task |
| `review_start`, `review_rejected`, `fix_start`, `fix_complete` | Next review round |
| `review_approved` | Step 6 (complete/merge) |
| `merge` | Phase complete; should not be `in_progress` |
| `error`, `halt` | Trust `handoff_note` |
  - Trust `handoff_note` for additional context beyond what structured events convey.
  - Otherwise, extract the full Phase `N` section from `master-plan.md` as the authoritative plan for this phase.
- Print: `"Resuming phase [N]/[phase_total]: [phase_name] — spawning Maestro."`
- **Worker reaping** — While Maestro is executing, you will receive idle notifications from workers (Sherlock, Confucius, Sun Tzu, Socrates, Plato, Scheherazade, Codex, Sphinx). When you see a worker go idle, send `SendMessage(type: "shutdown_request", recipient: "<worker_alias>")` to free resources. This is fire-and-forget. Maestro does NOT handle worker shutdown.
- Spawn the next phase executor **immediately** (no permission prompt):
  - Spawn `kiln-phase-executor` via the **Task** tool.
  - `name: Maestro`
  - `subagent_type: kiln-phase-executor`
  - `description: (next quote from names.json; cycle quotes sequentially each phase spawn)`
  - **The Task prompt MUST begin with**: "Spawn all workers via Task without team_name — Claude Code auto-registers them into the session team. For delegation agents (Sun Tzu, Scheherazade, Codex), prepend the Codex CLI delegation mandate directly in the Task prompt — they must pipe through codex exec, not write content themselves. See their agent definitions for the exact CLI patterns."
  - Task prompt must include:
    - Full Phase `N` section from `master-plan.md`
    - `handoff_context` (if present, for deeper phase context)
    - `PROJECT_PATH`
    - `MEMORY_DIR`
    - Instruction: "Read MEMORY.md and vision.md from MEMORY_DIR at startup for full project context. Resume from the state indicated in the phase state file and handoff context."
- After Maestro returns, update `MEMORY.md` with the new phase status, updated `handoff_note`, and updated `handoff_context`, then **re-enter this execution routing** to resume/transition/retry or advance to `validation` automatically.
For `validation`:
- **Parallel pre-reads** (issue all in a single parallel batch):
  1. `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json`
  2. `$CLAUDE_HOME/kilntwo/data/lore.json`
  3. `$MEMORY_DIR/master-plan.md`
  4. `$MEMORY_DIR/decisions.md`
  5. `$KILN_DIR/validation/report.md` (may not exist; that is fine)

  These reads are independent. Issue them as parallel tool calls in a single response.

- Install spinner verbs from the pre-read data via a single Bash command (never use the Write tool for this file):
  Build a flat array from `generic` + `validation` verbs. Then run one Bash call:
  ```bash
  mkdir -p "$PROJECT_PATH/.claude" && printf '%s' '{"spinnerVerbs":{"mode":"replace","verbs":[...]}}' > "$PROJECT_PATH/.claude/settings.local.json"
  ```
  The path MUST be absolute. Never use a relative path.
- Check `correction_cycle` from MEMORY.md (already extracted in Step 3).
- If `correction_cycle > 0` and `status == 'blocked'`:
  - Tell the user: "Validation is blocked at cycle [correction_cycle]/3."
  - Read and display `$KILN_DIR/validation/report.md`.
  - Ask: "How would you like to proceed: retry validation, fix manually, or mark complete?"
- If `correction_cycle > 0` and `status == 'in_progress'`:
  - Tell the user: "Resuming validation correction cycle [correction_cycle]/3."
  - Continue the validation-correction loop from Step 14 in start.md.
- Otherwise:
  - Tell the user: "Resuming validation stage from current memory."
  - Summarize what was built from `master-plan.md` and what decisions were made from `decisions.md`.
  - Spawn Argus to run validation (Step 14 in start.md).
For `complete`:
- Tell the user exactly:
```
This project is marked complete.
What would you like to do next?
  1. Start a new project in this directory (/kiln:start)
  2. Review the decisions log
  3. Review the pitfalls log
  4. Archive this project's memory
```
- Do not resume any work. Wait for the user's choice.
## Step 7: Update MEMORY.md
If `stage` is not `complete`, update `$MEMORY_DIR/MEMORY.md`:
- Set `status` to `in_progress`.
- Set `last_updated` to the current ISO-8601 UTC timestamp.
- Append this line under `## Resume Log` (create the section if it does not exist):
  `- Resumed: <ISO-8601 timestamp>`
Perform this update atomically: read full MEMORY.md, apply both changes, and write the full updated content back without losing existing content.
## Key Rules
- Read stage and status only from `$CLAUDE_HOME/projects/<encoded>/memory/`; do not infer from repo shape or conversation history.
- If MEMORY.md is missing/corrupted, warn and direct to `/kiln:start`; do not reconstruct state.
- Keep resume read-only for project files; only Step 7 may update MEMORY.md.
- Preserve context already in memory and treat `handoff_note` as authoritative routing context.
- The orchestrator MUST NOT run project build, compile, test, lint, or deployment commands (e.g., `cargo check`, `npm test`, `go build`, `make`, `pytest`). State assessment uses MEMORY.md fields, phase state files, git status, and handoff context only. Build verification is Maestro's job (Stage 3) and Argus's job (Stage 4).
