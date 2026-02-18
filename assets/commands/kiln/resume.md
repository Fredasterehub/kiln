# /kiln:resume

Restore project context from memory and continue exactly where the last session stopped.

## Step 1: Detect Project Path

Determine the project path from the current working directory (`process.cwd()`, `$PWD`, or equivalent) and store it as `PROJECT_PATH`.
If you cannot determine `PROJECT_PATH`, halt immediately and tell the user exactly:
"Cannot determine project path. Please run this command from the project root."

## Step 2: Compute Memory Directory Path

Compute the encoded project path using POSIX slash splitting exactly as `absolutePath.split('/').join('-')`:
1. Split `PROJECT_PATH` on `/`.
2. Join the parts with `-`.
3. Use the result to form the memory directory path: `~/.claude/projects/<encoded-path>/memory/`.

Use this worked example to verify your result:
`PROJECT_PATH = /DEV/myproject`
`encoded      = -DEV-myproject`
`memory dir   = ~/.claude/projects/-DEV-myproject/memory/`

## Step 3: Read MEMORY.md

Read `<memory-dir>/MEMORY.md`.
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
- `status` (`in-progress`, `paused`, `blocked`)
- `handoff_note` (free text; may be empty)
- `debate_mode` (boolean `true`/`false`; default `false` if absent)

Also read `planning_sub_stage` if present for planning routing.

If `stage` or `status` are missing, or contain unrecognized values, treat MEMORY.md as corrupted, halt immediately, and output exactly:

```
[kiln:resume] MEMORY.md is corrupted or incomplete (missing required fields: <list>).
Run /kiln:start to reinitialize, or manually repair ~/.claude/projects/<encoded>/memory/MEMORY.md.
```

## Step 4: Read Supporting Memory Files

Read these files in parallel (batch reads):
- `<memory-dir>/vision.md`
- `<memory-dir>/master-plan.md`
- `<memory-dir>/decisions.md`
- `<memory-dir>/pitfalls.md`

For each file: if it exists, store the full content. If it does not exist, record it as absent and continue without halting.

## Step 5: Display Continuity Banner

Display the continuity banner to the user as a code block, substituting values from loaded memory:

```
=== Kiln Resume ===
Project: [PROJECT_PATH]
Stage:   [stage]
Phase:   [phase_number]/[phase_total] [phase_name]   (omit this line if not in execution stage)
Status:  [status]
Handoff: [handoff_note, or "(none)" if empty]
=====================
```

Include the `Phase` line only when `stage === 'execution'` and `phase_number` is non-null.
If `phase_total` is absent, render phase as `[phase_number]/? [phase_name]`.

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
  - `dual-plan`: two competing plans are being drafted.
  - `debate`: plans are being debated; check `debate_mode`.
  - `synthesis`: plans are being merged into the final master plan.
  - absent or unknown: treat as `dual-plan`.
- Tell the user: "Resuming planning stage ([planning_sub_stage])."
- Print the current master plan, or state that `master-plan.md` is absent.
- Invite the user to continue planning.

For `execution`:
- Set `N = phase_number` and look for `<PROJECT_PATH>/.kiln/phase_<N>.md`.
- If the phase file exists, read it and summarize: "Resuming execution — Phase [N]/[total]: [phase_name]. Last recorded state: [brief summary from phase file]."
- If the phase file does not exist, fall back to `master-plan.md` and tell the user: "Resuming execution — Phase [N]/[total]: [phase_name]. No phase state file found; reading master plan for context."
- Print the relevant section of the master plan.
- Ask: "Shall I continue from where we left off?"

For `validation`:
- Re-read `master-plan.md` and `decisions.md`.
- Tell the user: "Resuming validation stage."
- Summarize what was built from `master-plan.md` and what decisions were made from `decisions.md`.
- Invite the user to continue validation.

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

If `stage` is not `complete`, update `<memory-dir>/MEMORY.md`:
- Set `status` to `in-progress`.
- Append this line under `## Resume Log` (create the section if it does not exist):
  `- Resumed: <ISO-8601 timestamp>`

Perform this update atomically: read the full current MEMORY.md content, apply both changes, and write the full updated content back without losing any existing content.

## Key Rules

- Treat memory as the sole source of truth. Never infer stage, phase, or status from source files, directory structure, or conversation history; read only from `~/.claude/projects/<encoded>/memory/`.
- If MEMORY.md is missing or corrupted, warn the user and suggest `/kiln:start`. Do not attempt to reconstruct state.
- Preserve all previous context. Do not re-ask questions that memory already answers.
- Do not modify any project source files during resume. Keep this command read-only except for the Step 7 MEMORY.md status update.
- Treat the handoff note as authoritative about what was happening. Trust it over inferences from other context.
