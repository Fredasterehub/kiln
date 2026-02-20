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
## Step 4: Read Supporting Memory Files
Read these files in parallel (batch reads):
- `$MEMORY_DIR/vision.md`
- `$MEMORY_DIR/master-plan.md`
- `$MEMORY_DIR/decisions.md`
- `$MEMORY_DIR/pitfalls.md`
- `$MEMORY_DIR/PATTERNS.md`
- `$MEMORY_DIR/tech-stack.md`
For each file: if it exists, store the full content. If it does not exist, record it as absent and continue without halting.
## Step 5: Display Continuity Banner
Display the continuity banner to the user as a code block, substituting values from loaded memory:
```
=== Kiln Resume ===
Project: [PROJECT_PATH]
Mode:    [project_mode]   (omit this line if project_mode is absent)
Stage:   [stage]
Phase:   [phase_number]/[phase_total] [phase_name]   (omit this line if not in execution stage)
Correction: cycle [correction_cycle]/3   (omit this line if correction_cycle is 0 or absent)
Status:  [status]
Handoff: [handoff_note, or "(none)" if empty]
=====================
```
Include the `Phase` line only when `stage === 'execution'` and `phase_number` is non-null.
If `phase_total` is absent, render phase as `[phase_number]/? [phase_name]`.
If `handoff_context` is present and non-empty, display it immediately after the banner as a quoted block:
```
Context:
  [handoff_context content, indented 2 spaces per line]
```
After displaying the banner, check whether MEMORY.md contains a `## Reset Notes` section. If it does, parse the `next_action` field from that section. If `next_action` is present and non-empty, display it to the operator immediately after the banner as:
```
Recommended next step (from last reset): [next_action]
```
In this same step, display one lore quote before routing:
- Read `$CLAUDE_HOME/kilntwo/data/lore.json`.
- Select a random quote from `transitions.resume.quotes`.
- Print it in italics with source attribution.
## Step 5.5: Re-establish Tmux Layout (if applicable)
Check `$TMUX` environment variable.
If set (already in a tmux session):
- Check if a right pane already exists: `tmux list-panes | wc -l`
- If only 1 pane: re-create the split layout same as start.md Step 0 (tmux layout active path). Store `$KILN_PANE` and `$AGENT_PANE`, set titles and border styles, set `TMUX_LAYOUT=true`.
- If 2+ panes already exist: recover pane IDs using tmux:
  ```bash
  KILN_PANE=$(tmux list-panes -F '#{pane_id} #{pane_left}' | sort -k2 -n | head -1 | awk '{print $1}')
  AGENT_PANE=$(tmux list-panes -F '#{pane_id} #{pane_left}' | sort -k2 -n | tail -1 | awk '{print $1}')
  ```
  Set `TMUX_LAYOUT=true` and continue with existing panes.
If not set: set `TMUX_LAYOUT=false` and continue.
## Step 6: Route to Stage
Branch strictly on `stage` and run the matching behavior.
For `brainstorm`:
- Re-read `vision.md` in full.
- Tell the user: "Resuming brainstorming session. Here is the current vision:"
- Print the full content of `vision.md`.
- Ask: "What would you like to explore or refine next?"
For `planning`:
- Read `planning_sub_stage` from MEMORY.md.
- Tell the user: "Resuming planning stage (sub-stage: [planning_sub_stage])."
- Spawn `kiln-planning-coordinator` via the Task tool:
  - `name`: `"Aristotle"`
  - `subagent_type`: `kiln-planning-coordinator`
  - `description`: (next quote from names.json quotes array for kiln-planning-coordinator)
  - Task prompt must include:
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
- Read `MEMORY.md` and build an inventory of phases: for each phase in `master-plan.md`, record `{phase_number, name, status}` where status is one of `completed | in_progress | failed | pending` (derive **from `MEMORY.md`**, not from assumptions).
- Cross-check against archive: if `$KILN_DIR/archive/phase_<NN>/phase_summary.md` exists for a phase, treat that phase as definitively completed regardless of `MEMORY.md` status (the archive is created only after successful merge).
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
- If `TMUX_LAYOUT=true`:
  - Update right pane title: `tmux select-pane -t $AGENT_PANE -T "Maestro — Phase N"`
  - Tail phase state: `tmux send-keys -t $AGENT_PANE "tail -f $KILN_DIR/phase_<N>_state.md" Enter`
- Spawn the next phase executor **immediately** (no permission prompt):
  - Spawn `kiln-phase-executor` via the **Task** tool.
  - `name: Maestro`
  - `subagent_type: kiln-phase-executor`
  - `description: (next quote from names.json; cycle quotes sequentially each phase spawn)`
  - Task prompt must include:
    - Full Phase `N` section from `master-plan.md`
    - Full `MEMORY.md`
    - Full `vision.md`
    - `handoff_context` (if present, for deeper phase context)
    - `PROJECT_PATH`
    - `MEMORY_DIR`
- After Maestro returns, update `MEMORY.md` with the new phase status, updated `handoff_note`, and updated `handoff_context`, then **re-enter this execution routing** to resume/transition/retry or advance to `validation` automatically.
- If `TMUX_LAYOUT=true`: kill the tail (`tmux send-keys -t $AGENT_PANE C-c`) and reset pane title (`tmux select-pane -t $AGENT_PANE -T "Ready"`).
For `validation`:
- Re-read `master-plan.md` and `decisions.md`.
- Check `correction_cycle` from MEMORY.md.
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
  - If `TMUX_LAYOUT=true`:
    - Update right pane title: `tmux select-pane -t $AGENT_PANE -T "Argus — Validation"`
    - Tail the validation report: `tmux send-keys -t $AGENT_PANE "tail -f $KILN_DIR/validation/report.md 2>/dev/null || echo 'Waiting for report...'" Enter`
  - Spawn Argus to run validation (Step 14 in start.md).
  - If `TMUX_LAYOUT=true`: kill the tail (`tmux send-keys -t $AGENT_PANE C-c`) and reset pane title (`tmux select-pane -t $AGENT_PANE -T "Ready"`).
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
