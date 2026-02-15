---
name: kiln-fire
description: "Light the kiln -- start or resume the full automated pipeline"
user_invocable: true
---
# /kiln:fire

## Overview

`/kiln:fire` is the primary entry command. It reads `.kiln/STATE.md`, determines the current project state, and routes to the correct next action automatically.

In Teams-first mode, `/kiln:fire` creates a Claude Code Team and becomes the orchestration loop: spawning teammates for each stage, auto-advancing on completion, and emitting lore transition messages at every boundary. The user session is the team lead. Three hard gates require operator approval: vision, roadmap, and reconcile.

In standalone mode (no Team tools available), `/kiln:fire` falls back to printing the next command for manual invocation, preserving backward compatibility.

## Decision Tree

Read `.kiln/STATE.md` and evaluate these branches in order. The first matching branch determines the action.

1. **No `.kiln/` directory exists**
   - Check: `test -d .kiln` fails.
   - Route: run `/kiln:init`, then start the brainstorm stage.
   - Teams mode: after init completes, emit the `ignition` transition message, then spawn a brainstorm teammate.
   - Standalone mode: print `No kiln state found. Initializing and starting brainstorm.`

2. **`.kiln/` exists but no `.kiln/STATE.md`**
   - Check: `test -d .kiln` passes and `test -f .kiln/STATE.md` fails.
   - Stop and print: `Found .kiln/ but missing .kiln/STATE.md. Initialization appears incomplete. Run /kiln:init to reinitialize.`

3. **`.kiln/STATE.md` exists but is corrupted/unparseable**
   - Check: file exists but required headings/fields cannot be parsed well enough to classify project stage.
   - Stop and print: `STATE.md appears corrupted or unparseable. Do not continue automatically. Run /kiln:init to reinitialize state, then verify with /kiln:status.`

4. **`STATE.md` is at initialization baseline (no phases started)**
   - Check: initialized metadata exists and no active or completed roadmap/track phase data is present.
   - Route: brainstorm stage.
   - Teams mode: emit `brainstorm-start` transition message, spawn a brainstorm teammate.
   - Standalone mode: print `Initialization complete. Starting brainstorm.`

5. **Brainstorm complete but no `.kiln/ROADMAP.md`**
   - Check: state indicates brainstorm complete (or `.kiln/VISION.md` exists) and roadmap file is missing.
   - Route: roadmap stage.
   - Teams mode: emit `roadmap-start` transition message, spawn a roadmap teammate.
   - Standalone mode: print `Vision is ready. Starting roadmap generation.`

6. **`.kiln/ROADMAP.md` exists and no phase is in-progress**
   - Check: roadmap exists and `STATE.md` shows no active in-progress phase/step.
   - Route: start the track execution loop.
   - Teams mode: emit `phase-start` transition message, spawn the track stage teammate for the first pending phase.
   - Standalone mode: print `Roadmap detected with no active phase. Starting track execution.`

7. **A phase is currently in-progress**
   - Check: `STATE.md` shows an active phase and current step with `in-progress` status.
   - Route: resume the track stage for the current phase/step.
   - Teams mode: check Active Task IDs via TaskList. If the teammate is still running, reattach. If missing, emit `resume` transition message and respawn.
   - Standalone mode: print `Resuming phase <N> at <step>.`

8. **All phases are complete**
   - Check: all roadmap phases are complete in state.
   - Route: emit `all-phases-complete` transition message, then show completion status.
   - Teams mode: emit `project-done` transition message when final report is written.
   - Standalone mode: print `All phases are complete. Run /kiln:status for the completion summary.`

## State Reading

Read `.kiln/STATE.md` using the canonical schema defined by `.claude/templates/STATE.md.tmpl` and parse by section heading:
- `Project State`
- `Phase Progress`
- `Current Track`
- `Correction Cycles`
- `Regression Suite`
- `Session Recovery`
- `Orchestration Session`

Parsing rules:
- Parse headings first, then parse structured rows and key-value lines inside each section.
- Normalize step names to: `plan`, `validate`, `execute`, `e2e`, `review`, `reconcile`.
- Normalize statuses to: `pending`, `in-progress`, `complete`, `failed`, `unknown`.
- Treat `Phase Progress` + `Current Track` as authoritative for routing.
- Use `.kiln/ROADMAP.md` presence as a secondary signal for whether execution can start.
- If `Orchestration Session` section exists, read it to determine team name, active stage, and active task IDs for resume logic.

Partial parsing and fallback:
- If some sections are missing but enough state exists to classify one decision-tree branch unambiguously, continue with that branch and emit a warning.
- If critical routing fields are missing (cannot determine initialization vs active-track vs complete), treat state as unparseable and follow Decision Tree branch 3.
- Never infer phase state from guesswork or unrelated files.

## Teams-First Flow

When Team tools (TeamCreate, SendMessage, TaskList) are available, `/kiln:fire` operates as a persistent orchestration loop rather than a one-shot router. This is the Athanor pattern: a self-feeding furnace where each stage's completion fuels the next.

### Team Creation

On first invocation in a fresh project:
1. Create a Claude Code Team using TeamCreate with a name derived from the project (e.g., `kiln-<project-name>`).
2. The user's session becomes the team lead.
3. Write the team name and orchestration metadata to `STATE.md` Orchestration Session section.
4. Emit the `ignition` transition message using `.claude/skills/kiln-lore/kiln-lore.md`.
5. Enter the stage machine loop.

### Stage Machine Loop

The core loop runs until all phases are complete or the operator pauses:

```
read STATE.md
  -> route via Decision Tree
  -> spawn appropriate teammate for the current stage
  -> wait for completion signal (SendMessage or TaskList polling)
  -> update STATE.md Orchestration Session fields
  -> emit transition message with lore quote
  -> advance to next stage
  -> repeat
```

### Three Hard Gates

The loop auto-advances through all stages except these three, which require explicit operator approval:

1. **Vision gate** (after brainstorm): Operator must approve `.kiln/VISION.md` before roadmap begins.
2. **Roadmap gate** (after roadmap generation): Operator must approve `.kiln/ROADMAP.md` before track execution begins.
3. **Reconcile gate** (after each phase review): Operator must approve reconciliation before advancing to the next phase.

These gates are enforced by the brainstorm, roadmap, and track skills respectively. The fire skill does not bypass them.

### STATE.md Updates

Only the team lead (the fire skill's session) writes to `STATE.md`. Teammates report via SendMessage; they never write STATE directly. After each stage completion:

1. Update `Active Stage` to the next stage.
2. Clear `Active Task IDs` from the completed stage.
3. Set `Last Transition ID` to the transition key (e.g., `vision-approved`).
4. Update `Session Recovery` fields (Last Activity, Last Completed Action, Next Expected Action).

## Teammate Spawning Protocol

Each stage spawns a single teammate with specific configuration:

### Brainstorm Stage

- **Skill:** `.claude/skills/kiln-brainstorm/kiln-brainstorm.md`
- **Model:** Opus (interactive, deep exploration needs high capability)
- **Mode:** Interactive -- the teammate engages directly with the operator
- **Completion signal:** SendMessage to team lead with `{ stage: "brainstorm", status: "completed" }`

### Roadmap Stage

- **Skill:** `.claude/skills/kiln-roadmap/kiln-roadmap.md`
- **Model:** Opus (interactive, requires operator collaboration on phase design)
- **Mode:** Interactive -- the teammate presents phases and iterates with the operator
- **Completion signal:** SendMessage to team lead with `{ stage: "roadmap", status: "completed" }`

### Track Stages (plan, validate, execute, e2e, review, reconcile)

- **Skill:** `.claude/skills/kiln-track/kiln-track.md`
- **Model:** Per `.claude/skills/kiln-core/kiln-core.md` model routing (varies by step type)
- **Mode:** Automated for most steps; interactive for reconcile (hard gate)
- **Completion signal:** SendMessage to team lead with `{ stage: "track:<phase>:<step>", status: "completed" }`

### Spawning Template

When spawning a teammate, use the Task tool with:
- `subagent_type`: `general-purpose`
- `team_name`: the active team name from STATE.md
- `name`: descriptive name (e.g., `brainstormer`, `roadmapper`, `tracker-p1-plan`)
- `prompt`: instructions referencing the appropriate skill and current project state

Record the spawned task ID in `STATE.md` Active Task IDs.

## Auto-Advance Logic

When a teammate completes its work, the fire skill detects completion and advances:

### Completion Detection (Dual-Channel)

**Primary channel: SendMessage**

Teammates send a completion message to the team lead on finishing:
```
SendMessage:
  type: "message"
  recipient: "team-lead"
  content: { stage: "<stage>", status: "completed", evidence_paths: ["<artifact>"] }
  summary: "<stage> complete"
```

The fire skill parses this message, verifies the referenced artifacts exist, and advances.

**Fallback channel: TaskList polling**

If SendMessage delivery fails or is delayed, the fire skill periodically checks TaskList:
- Look for the active teammate's task by ID.
- If status is `completed`, treat as completion signal.
- If status is `in_progress` for an extended period with no messages, log a warning but do not intervene.

### Advance Cycle

On receiving a completion signal:

1. **Verify artifacts:** Confirm referenced files exist (e.g., `.kiln/VISION.md`, `.kiln/ROADMAP.md`).
2. **Update STATE.md:** Write new Active Stage, clear Active Task IDs, update Session Recovery fields.
3. **Emit transition message:** Read the appropriate section from `.claude/skills/kiln-lore/kiln-lore.md`, select a contextually fitting quote, and display it using the transition message format.
4. **Spawn next teammate:** Determine the next stage from the Decision Tree and spawn the corresponding teammate.

### Stage Transitions

| Completion | Transition Key | Next Stage |
|------------|---------------|------------|
| init complete | `ignition` | brainstorm |
| brainstorm complete | `vision-approved` | roadmap |
| roadmap complete | `roadmap-approved` | track (phase 1, plan) |
| plan complete | `validate` | track (same phase, validate) |
| validate complete | `execute` | track (same phase, execute) |
| execute complete | `e2e` | track (same phase, e2e) |
| e2e complete | `review` | track (same phase, review) |
| review complete | `reconcile` | track (same phase, reconcile) |
| reconcile complete | `phase-complete` | track (next phase, plan) OR all-phases-complete |
| all phases complete | `all-phases-complete` | project-done |

## Resume from Any State

When `/kiln:fire` is invoked on a project with an existing Orchestration Session in STATE.md, it enters resume mode:

### Resume Detection

1. Read `Orchestration Session` section from STATE.md.
2. If `Team Name` is set and `Paused` is not `true`, this is a resume scenario.
3. Read `Active Stage` to determine where the pipeline was interrupted.
4. Read `Active Task IDs` to check for still-running teammates.

### Resume Logic

1. **Check active tasks via TaskList:** For each ID in Active Task IDs, query TaskList.
   - If the task is still `in_progress`: reattach to it (monitor for completion via SendMessage/TaskList).
   - If the task is `completed`: process the completion and advance as normal.
   - If the task is missing or failed: emit a `resume` transition message and respawn the teammate for the active stage.

2. **No active tasks:** The pipeline was interrupted between stages. Emit a `resume` transition message and spawn the teammate for the Active Stage.

3. **Paused state:** If `Paused` is `true`, display the pause reason and ask the operator whether to resume or remain paused. On resume, clear the paused flag and continue from Active Stage.

### Crash Safety

The Orchestration Session in STATE.md is the single source of truth for resume. Because only the team lead writes STATE, and writes happen before spawning, the resume point is always at most one stage behind actual progress. This is safe: re-running a completed stage is idempotent (skills check for existing artifacts before acting).

## Lore Integration

At every stage transition, display a lore message using quotes from `.claude/skills/kiln-lore/kiln-lore.md`.

### Reading Protocol

1. Identify the transition key from the Stage Transitions table.
2. Read the corresponding section from `.claude/skills/kiln-lore/kiln-lore.md` (e.g., `## ignition`, `## vision-approved`).
3. Select one quote contextually from the 4-5 available. The AI is the selection mechanism -- choose the quote that best fits the current project moment.
4. Display using the transition message format.

### Transition Message Format

```
━━━ [Title] ━━━
"[Quote]" -- [Attribution]

[One-line status. Action ->]
```

Rules:
- `━━━` divider: exactly 3 box-drawing characters on each side of the title.
- Title: plain text describing the transition (e.g., "Ignition", "Vision Approved", "Phase 2 Starting").
- Quote: with proper em-dash attribution.
- Status line: ends with ` ->` when spawning next stage, plain statement when halting or completing.
- Max 4 lines total.
- No emoji anywhere.

## Backward Compatibility

When Team tools (TeamCreate, SendMessage, TaskList) are not available or the operator opts out:

- `/kiln:fire` operates as a one-shot router, identical to legacy behavior.
- Each decision tree branch prints the recommended next command for manual invocation.
- No team is created, no teammates are spawned, no transition messages are emitted.
- The Orchestration Session section in STATE.md is left empty or not written.

Detection: If TeamCreate is not in the available tool set, fall back to standalone mode automatically.

## Error Handling

Non-destructive behavior:
- Never overwrite `.kiln/STATE.md`, `.kiln/ROADMAP.md`, or `.kiln/VISION.md` from within the routing logic.
- Never auto-reinitialize on corruption or partial state.
- On corruption or incomplete initialization, stop and provide explicit remediation commands.
- STATE.md Orchestration Session updates are additive (update fields, never delete sections).

Stop messages and remediation commands:
- Missing `.kiln/`: print `Kiln is not initialized. Running /kiln:init.`
- Missing `STATE.md` under existing `.kiln/`: print `Kiln state file missing under existing .kiln/. Run /kiln:init to reinitialize.`
- Corrupt/unparseable `STATE.md`: print `Warning: STATE.md appears corrupted. Stop. Run /kiln:init to reinitialize, then run /kiln:status.`
- Missing `.kiln/ROADMAP.md` after brainstorm completion: print `Roadmap not found. Starting roadmap generation.`

Operational constraint:
- `/kiln:fire` is the orchestration loop; it manages the stage machine but delegates all real work to teammates. It never performs brainstorming, roadmapping, or track execution directly.

## References

Routes and contracts used by this skill:
- `.claude/skills/kiln-core/kiln-core.md`
- `.claude/skills/kiln-init/kiln-init.md`
- `.claude/skills/kiln-brainstorm/kiln-brainstorm.md`
- `.claude/skills/kiln-roadmap/kiln-roadmap.md`
- `.claude/skills/kiln-track/kiln-track.md`
- `.claude/skills/kiln-status/kiln-status.md`
- `.claude/skills/kiln-lore/kiln-lore.md`
