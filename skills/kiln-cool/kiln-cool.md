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

## Process

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
7. Write the updated `.kiln/STATE.md` and print confirmation:
   - Confirm snapshot save time.
   - Confirm no phase progress was changed.
   - Print explicit resume instruction: `Run /kiln:fire`.

## Transition Message on Pause

After writing the state snapshot (step 7), display a transition message using the `pause-cool` section from `.claude/skills/kiln-lore/kiln-lore.md`.

Read the `pause-cool` section and select one quote contextually. Display using this format:

```
━━━ Cooling ━━━
"[Quote]" -- [Attribution]

State saved. The kiln holds its heat. Run /kiln:fire to resume.
```

No emoji. The whitespace (blank line before the status) is intentional.

## Non-Destructive Rules
- Never change phase progress statuses.
- Never advance steps.
- Never edit sections outside `## Session Recovery`.
- Never infer completion that is not already recorded.
