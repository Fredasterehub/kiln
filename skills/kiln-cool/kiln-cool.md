---
name: kiln-cool
description: "Save state snapshot and pause gracefully"
user_invocable: true
---
# /kiln:cool

## Overview
Use `/kiln:cool` to pause a kiln session safely and preserve a reliable handoff point so `/kiln:fire` can resume without ambiguity.

## Prerequisites (Blocking)
Run checks from the project root in this order:

1. Verify `.kiln/` exists.
2. Verify `.kiln/STATE.md` exists and is readable.

If `.kiln/` is missing, print:
`Kiln is not initialized for this project. Run /kiln:init first.`
Then stop.

If `.kiln/STATE.md` is missing or unreadable, print:
`Kiln state file missing or unreadable. Run /kiln:init to reinitialize.`
Then stop.

## Process -- Non-Teams Mode

> If `.kiln/STATE.md` Orchestration Session shows an active Teams session
> (`Team Name` is set and `Paused` is not `true`), skip to
> "Process -- Teams Mode" below instead of running these steps.

1. Read current `.kiln/STATE.md`.
2. Parse at least these sections before writing anything:
   - `## Phase Progress`
   - `## Current Track`
   - `## Session Recovery`
3. Verify STATE against actual `.kiln/` artifacts (minimum required checks):
   - For each phase listed in `## Phase Progress`, verify `.kiln/tracks/phase-<N>/` exists for phases marked `in-progress`, `complete`, or `failed`.
   - For the current track phase from `## Current Track`, verify step artifacts where applicable:
     - `plan` step touched: `.kiln/tracks/phase-<N>/PLAN.md`
     - `e2e` step touched: `.kiln/tracks/phase-<N>/e2e-results.md`
     - `review` step touched: `.kiln/tracks/phase-<N>/review.md`
     - `reconcile` step touched: `.kiln/tracks/phase-<N>/reconcile.md`
   - If Session Recovery text references a concrete path under `.kiln/`, verify that path exists.
4. If validation finds mismatches, do not fabricate progress. Keep phase/step statuses unchanged, report warnings, and continue with a metadata-only pause snapshot.
5. Update only the `## Session Recovery` section fields:
   - Set `Last Activity` to current timestamp in ISO 8601.
   - Set `Last Completed Action` to a truthful pause snapshot label based on current state (for example: `Paused via /kiln:cool at phase-<N>/<step> (<step status>)`).
   - Set `Next Expected Action` to resume instruction aligned to current state (for example: `Run /kiln:fire to resume phase-<N>/<step>`).
6. Optionally request a short operator context note when the hosting environment supports interactive input.
   - If supported: capture one short note and append it to `Last Completed Action` as `Operator note: <text>`.
   - If not supported: use safe default `Operator note: none provided` and continue without blocking.
7. Write the updated `.kiln/STATE.md`; also write state.json co-update per kiln-core § state.json Canonical Schema; then print confirmation:
   - Confirm snapshot save time.
   - Confirm no phase progress was changed.
   - Print explicit resume instruction: `Run /kiln:fire`.

## Process -- Teams Mode

### Step 1: Detect Active Session

- Read `Orchestration Session` from `.kiln/STATE.md`.
- If `Team Name` is absent or empty: Teams is not active. Fall through to Non-Teams Mode.
- If `Paused` is already `true`: report current pause state and reason. Stop (do not double-pause).
- Read `Active Stage` and `Active Task IDs`.

### Step 2: Ordered Shutdown Protocol

Branch by `Active Stage`:

**EXECUTE stage** (trackers spawning workers):
1. Identify the active tracker task ID (name pattern: `tracker-p<N>-execute`).
2. Send `shutdown_request` via SendMessage to the tracker.
3. Wait for `shutdown_ack` with stage-aware timeout: 3-5 minutes (respect `deadWorkerTimeoutMinutes` from `.kiln/config.json` if set).
4. On ack or timeout: proceed to Step 2b.
5. **Step 2b:** Send `shutdown_request` to ALL remaining active teammates (non-tracker task IDs in `Active Task IDs`).
6. Wait for all acks or 60-second timeout.
7. Record which teammates acknowledged and which timed out.

**INTERACTIVE stages** (BRAINSTORM, ROADMAP):
1. Send `shutdown_request` to the active teammate (from `Active Task IDs`).
2. Wait for `shutdown_ack` with 60-second timeout.
3. Note: interactive teammates may have unsaved operator context. The checkpoint commit in Step 4 preserves any written artifacts.

**AUTOMATED stages** (PLAN, VALIDATE, E2E, REVIEW):
1. Send `shutdown_request` to the active teammate(s) (from `Active Task IDs`).
2. For PLAN/REVIEW with active debate: send to all debate teammates.
3. Wait for all acks or 60-second timeout.

### Step 3: Audit Uncommitted Work

Three-part audit (run all three, collect findings):

1. `git status --short` -- uncommitted changes in main workspace.
2. `git worktree list --porcelain` -- active worktrees and their status.
3. Scan `${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/` for artifact directories. Check for `.kiln-artifacts/` content that has not been copy-backed.

Cross-reference findings against `Active Task IDs` from STATE.md.

### Step 4: Report and Checkpoint Gate

- Display summary to operator:
  - Teammates that acknowledged vs. timed out.
  - Three-part audit output.
  - List of any uncommitted changes or pending copy-back artifacts.
- If uncommitted work found: offer checkpoint commit via AskUserQuestion.
  - Question: "Found uncommitted work (summarized above). Create a checkpoint commit? [yes/no]"
  - If yes: create checkpoint commit with message `kiln: pause checkpoint at phase-<N>/<step> (<timestamp>)`.
  - If no: continue without committing.

### Step 5: Write Pause State

Update `.kiln/STATE.md` Orchestration Session; also write state.json co-update per kiln-core § state.json Canonical Schema:
- Set `Paused: true`.
- Set `Pause Reason` to descriptive text (e.g., "Operator invoked /kiln:cool at phase-N/step").
- Update `Session Recovery` fields:
  - `Last Activity`: current ISO 8601 timestamp.
  - `Last Completed Action`: `Paused via /kiln:cool at phase-<N>/<step> (Teams mode)`.
  - `Next Expected Action`: `Run /kiln:fire to resume from phase-<N>/<step>`.

### Step 6: Transition Message

Display the pause-cool lore transition message using the existing format from "Transition Message on Pause" section.

## Transition Message on Pause

After writing the state snapshot and the state.json co-update per kiln-core § state.json
Canonical Schema, display a transition message.

Read the `pause-cool` section from `.claude/skills/kiln-lore/kiln-lore.md` and select one
quote contextually.

Display using the **Rendering Protocol** defined in kiln-lore § Rendering Protocol.
Use these values:
- `$title` = "Cooling"
- `$status_line` = "State saved. The kiln holds its heat. Run /kiln:fire to resume."

Set variables then call:

```bash
title="Cooling"
# (quote and attribution set from selected lore entry)
status_line="State saved. The kiln holds its heat. Run /kiln:fire to resume."
section="pause-cool"

printf '\033[38;5;179m━━━ %s ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m-- %s\033[0m\n\n\033[2m%s\033[0m\n' \
  "$title" "$quote" "$attribution" "$status_line"

# Write last-quote.json for status line display
if test -d .kiln; then
  printf '{"quote":"%s","by":"%s","section":"%s","at":"%s"}\n' \
    "$quote" "$attribution" "$section" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > .kiln/last-quote.json
fi
```

No emoji. The whitespace (blank line before the status line) is intentional (ma -- negative space).

## Non-Destructive Rules
- Never change phase progress statuses.
- Never advance steps.
- Never edit sections outside `## Session Recovery`.
- Never infer completion that is not already recorded.
- Never delete Teams or cancel tasks that completed successfully during shutdown.
- Never force-kill teammates -- always use SendMessage shutdown_request with timeout.
