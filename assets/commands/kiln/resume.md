# /kiln:resume

Restore project context from memory and continue exactly where the last session stopped.

## Canonical MEMORY.md Schema (Expected by Resume)

Runtime fields must use these exact enums:
- `stage`: `brainstorm | planning | execution | validation | complete`
- `status`: `in_progress | paused | blocked | complete`
- `planning_sub_stage`: `dual_plan | debate | synthesis | null`
- `phase_status` entries under `## Phase Statuses`: `pending | in_progress | failed | completed`

## Paths Contract

- `PROJECT_PATH`: absolute project root path for the active run.
- `KILN_DIR = $PROJECT_PATH/.kiln`.
- `CLAUDE_HOME = $HOME/.claude`.
- `MEMORY_DIR = $CLAUDE_HOME/projects/$ENCODED_PATH/memory`.
- Never use root-relative kiln or claude paths.

## Step 1: Detect Project Path

Determine the project path from the current working directory (`process.cwd()`, `$PWD`, or equivalent) and store it as `PROJECT_PATH`.
If you cannot determine `PROJECT_PATH`, halt immediately and tell the user exactly:
"Cannot determine project path. Please run this command from the project root."

## Step 2: Compute Memory Directory Path

Compute the encoded project path using POSIX slash splitting exactly as `absolutePath.split('/').join('-')`:
1. Split `PROJECT_PATH` on `/`.
2. Join the parts with `-`.
3. Use the result to form `ENCODED_PATH`.
4. Set `MEMORY_DIR = $CLAUDE_HOME/projects/$ENCODED_PATH/memory/`.

Use this worked example to verify your result:
`PROJECT_PATH = /DEV/myproject`
`encoded      = -DEV-myproject`
`MEMORY_DIR   = $CLAUDE_HOME/projects/-DEV-myproject/memory/`

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

## Step 6: Route to Stage

Branch strictly on `stage` and run the matching behavior:

For `brainstorm`:
- Re-read `vision.md` in full.
- Tell the user: "Resuming brainstorming session. Here is the current vision:"
- Print the full content of `vision.md`.
- Ask: "What would you like to explore or refine next?"

For `planning`:
- Re-read `master-plan.md` in full.
- Read `planning_sub_stage` from MEMORY.md and normalize as follows:
  - `dual_plan`: two competing plans are being drafted.
  - `debate`: plans are being debated; check `debate_mode`.
  - `synthesis`: plans are being merged into the final master plan.
  - absent or `null`/unknown: treat as `dual_plan`.
- Tell the user: "Resuming planning stage ([planning_sub_stage])."
- Print the current master plan, or state that `master-plan.md` is absent.
- Invite the user to continue planning.

For `execution`:
- Read `MEMORY.md` and build an inventory of phases: for each phase in `master-plan.md`, record `{phase_number, name, status}` where status is one of `completed | in_progress | failed | pending` (derive **from `MEMORY.md`**, not from assumptions).
- Cross-check against archive: if `$KILN_DIR/archive/phase_<NN>/phase_summary.md` exists for a phase, treat that phase as definitively completed regardless of `MEMORY.md` status (the archive is created only after successful merge).
- Determine `N` (the next action) automatically:
  - If `MEMORY.md` indicates a phase `N` is `in_progress` (or the `handoff_note` says work was mid-phase), **resume phase `N`**.
  - Else if a phase `N` is `failed`, **retry phase `N`** (trust `handoff_note` for what was happening / what to fix).
  - Else pick the **lowest-numbered `pending`** phase as `N`.
  - Else (no pending/in_progress/failed phases remain), **set stage to `validation` and route to validation**.
- Load phase context for `N`:
  - If `$KILN_DIR/phase_<N>_state.md` exists, read it and treat it as the authoritative running log. Parse the `## Events` section to determine the last completed lifecycle step:
    - Last event type `setup` or `branch` → phase stopped during setup; restart from Step 2 (plan).
    - Last event type `plan_start`, `plan_complete`, `debate_complete`, or `synthesis_complete` → phase stopped during planning; restart from the next sub-step.
    - Last event type `sharpen_start` → sharpening began but did not complete; restart from Step 3 (sharpen).
    - Last event type `sharpen_complete` → prompts generated; restart from Step 4 (implement).
    - Last event type `reconcile_complete` → reconciliation done; restart from Step 7 (archive).
    - Last event type `task_start`, `task_success`, `task_retry`, or `task_fail` → phase stopped mid-implementation; restart from the next incomplete task.
    - Last event type `review_start`, `review_rejected`, `fix_start`, or `fix_complete` → phase stopped during review; restart from the next review round.
    - Last event type `review_approved` → review passed; restart from Step 6 (complete/merge).
    - Last event type `merge` → phase complete; should not be `in_progress`.
    - Last event type `error` or `halt` → phase stopped on error; trust `handoff_note` for what to fix.
    Trust `handoff_note` for additional context beyond what structured events convey.
  - Otherwise, extract the full Phase `N` section from `master-plan.md` as the authoritative plan for this phase.
- Print a one-line status: `"Resuming phase [N]/[phase_total]: [phase_name] — spawning Maestro."`
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
- After Maestro returns, update `MEMORY.md` with the new phase status, an updated `handoff_note`, and an updated `handoff_context`, then **re-enter this execution routing** to either resume/transition/retry or advance to `validation` automatically.

For `validation`:
- Re-read `master-plan.md` and `decisions.md`.
- Check `correction_cycle` from MEMORY.md.
- If `correction_cycle > 0` and `status == 'blocked'`:
  - Tell the user: "Validation failed after [correction_cycle] correction cycles. Here is the validation report:"
  - Read and display `$KILN_DIR/validation/report.md`.
  - Ask: "How would you like to proceed? Options: retry validation, fix manually, or mark complete."
- If `correction_cycle > 0` and `status == 'in_progress'`:
  - Tell the user: "Resuming validation — correction cycle [correction_cycle]/3 in progress."
  - Continue the validation-correction loop from Step 14 in start.md.
- Otherwise:
  - Tell the user: "Resuming validation stage."
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

Perform this update atomically: read the full current MEMORY.md content, apply both changes, and write the full updated content back without losing any existing content.

## Key Rules

- Treat memory as the sole source of truth. Never infer stage, phase, or status from source files, directory structure, or conversation history; read only from `$CLAUDE_HOME/projects/<encoded>/memory/`.
- If MEMORY.md is missing or corrupted, warn the user and suggest `/kiln:start`. Do not attempt to reconstruct state.
- Preserve all previous context. Do not re-ask questions that memory already answers.
- Do not modify any project source files during resume. Keep this command read-only except for the Step 7 MEMORY.md status update.
- Treat the handoff note as authoritative about what was happening. Trust it over inferences from other context.
