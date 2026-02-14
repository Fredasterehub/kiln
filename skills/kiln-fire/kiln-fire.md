---
name: kiln-fire
description: "The one command -- start new projects or resume existing ones"
user_invocable: true
---
# /kiln:fire

## Overview

`/kiln:fire` is the primary entry command. It reads `.kiln/STATE.md`, determines the current project state, and routes to the correct next kiln action automatically.

This command is state-driven and safe: it uses explicit filesystem and state checks only, never guesses workflow position, and stops with remediation commands when required state is missing or invalid.

## Decision tree

1. **No `.kiln/` directory exists**
   - Check: `test -d .kiln` fails.
   - Route: run `/kiln:init`, then route to `/kiln:brainstorm`.
   - Print: `No kiln state found. Running initialization path: /kiln:init -> /kiln:brainstorm.`

2. **`.kiln/` exists but no `.kiln/STATE.md`**
   - Check: `test -d .kiln` passes and `test -f .kiln/STATE.md` fails.
   - Stop and print: `Found .kiln/ but missing .kiln/STATE.md. Initialization appears incomplete. Run /kiln:init to reinitialize.`

3. **`.kiln/STATE.md` exists but is corrupted/unparseable**
   - Check: file exists but required headings/fields cannot be parsed well enough to classify project stage.
   - Stop and print: `STATE.md appears corrupted or unparseable. Do not continue automatically. Run /kiln:init to reinitialize state, then verify with /kiln:status.`

4. **`STATE.md` is at initialization baseline (no phases started)**
   - Check: initialized metadata exists and no active or completed roadmap/track phase data is present.
   - Route: `/kiln:brainstorm`.
   - Print: `Initialization complete. Next step: /kiln:brainstorm.`

5. **Brainstorm complete but no `.kiln/ROADMAP.md`**
   - Check: state indicates brainstorm complete (or `.kiln/VISION.md` exists) and roadmap file is missing.
   - Route: `/kiln:roadmap`.
   - Print: `Vision is ready but roadmap is missing. Next step: /kiln:roadmap.`

6. **`.kiln/ROADMAP.md` exists and no phase is in-progress**
   - Check: roadmap exists and `STATE.md` shows no active in-progress phase/step.
   - Route: start `/kiln:track`.
   - Print: `Roadmap detected with no active phase. Next step: /kiln:track to start execution.`

7. **A phase is currently in-progress**
   - Check: `STATE.md` shows an active phase and current step with `in-progress` status.
   - Route: resume `/kiln:track` at the current phase/step.
   - Print: `Resuming phase <N> at <step>. Run /kiln:track to continue.`

8. **All phases are complete**
   - Check: all roadmap phases are complete in state.
   - Route: show completion status via `/kiln:status` (and report final-report state if present).
   - Print: `All phases are complete. Run /kiln:status for completion summary and final report state.`

## State reading

Read `.kiln/STATE.md` using the canonical schema defined by `templates/STATE.md.tmpl` and parse by section heading:
- `Project`
- `Phase Progress`
- `Current Track`
- `Correction Cycles`
- `Regression Suite`
- `Session Recovery`

Parsing rules:
- Parse headings first, then parse structured rows and key-value lines inside each section.
- Normalize step names to: `plan`, `validate`, `execute`, `e2e`, `review`, `reconcile`.
- Normalize statuses to: `pending`, `in-progress`, `complete`, `failed`, `unknown`.
- Treat `Phase Progress` + `Current Track` as authoritative for routing.
- Use `.kiln/ROADMAP.md` presence as a secondary signal for whether execution can start.

Partial parsing and fallback:
- If some sections are missing but enough state exists to classify one decision-tree branch unambiguously, continue with that branch and emit a warning.
- If critical routing fields are missing (cannot determine initialization vs active-track vs complete), treat state as unparseable and follow Decision tree branch 3.
- Never infer phase state from guesswork or unrelated files.

## Error handling

Non-destructive behavior:
- Never overwrite `.kiln/STATE.md`, `.kiln/ROADMAP.md`, or `.kiln/VISION.md` inside `/kiln:fire`.
- Never auto-reinitialize on corruption or partial state.
- On corruption or incomplete initialization, stop and provide explicit remediation commands.

Stop messages and remediation commands:
- Missing `.kiln/`: print `Kiln is not initialized. Run /kiln:init, then /kiln:brainstorm.`
- Missing `STATE.md` under existing `.kiln/`: print `Kiln state file missing under existing .kiln/. Run /kiln:init to reinitialize.`
- Corrupt/unparseable `STATE.md`: print `Warning: STATE.md appears corrupted. Stop. Run /kiln:init to reinitialize, then run /kiln:status.`
- Missing `.kiln/ROADMAP.md` after brainstorm completion: print `Roadmap not found. Run /kiln:roadmap.`

Operational constraint:
- `/kiln:fire` is a router only; it selects and announces the next command and never performs destructive recovery.

## References

Routes and contracts used by this skill:
- `skills/kiln-core/kiln-core.md`
- `skills/kiln-init/kiln-init.md`
- `skills/kiln-brainstorm/kiln-brainstorm.md`
- `skills/kiln-roadmap/kiln-roadmap.md`
- `skills/kiln-track/kiln-track.md`
- `skills/kiln-status/kiln-status.md`
