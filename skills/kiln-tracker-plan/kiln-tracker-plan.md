---
name: kiln-tracker-plan
description: 'Plan stage tracker — single step, report, shut down'
---

## Overview
This skill executes exactly one pipeline step: `PLAN`. It is spawned by `kiln-fire` as a fresh teammate for each plan invocation. It reads `.kiln/STATE.md` from disk, executes plan generation for the active phase, writes planning artifacts, reports completion, and shuts down.

## Single-Step Dispatcher Contract

See `skills/kiln-core/kiln-core.md` § Tracker Contract. This skill follows that contract exactly.

## Stage Details

### Purpose
Convert phase intent into executable task packets for the active phase.

### Subagents To Spawn
- Always spawn `kiln-planner` (Opus lane).
- In `modelMode: "multi-model"`, also spawn `kiln-codex-planner` (Codex lane).
- In `modelMode: "multi-model"` with `planStrategy: "synthesize"` (default), spawn `kiln-synthesizer` after planner outputs are ready.
- In `modelMode: "multi-model"` with `planStrategy: "debate"`, run debate rounds before synthesis.

### Teams Mode Selector (`preferences.useTeams`)
- `false` or absent: use sequential Task spawns for planner/codex/synthesizer.
- `true` + `modelMode: "multi-model"`: use Teams scheduler for planning and dependent validation.
- `true` + `modelMode: "claude-only"`: force non-Teams PLAN path.

### Teams Scheduler Protocol (PLAN)
When `preferences.useTeams: true` and `modelMode: "multi-model"`:
1. Create a planning team scoped to `phase-N`.
2. Create planner tasks:
   - `phase-N:plan:planner-opus`
   - `phase-N:plan:planner-codex`
3. Run planner tasks in parallel.
4. Run synthesizer task `phase-N:plan:synthesizer` after planners finish.
5. Run dependent validator task `phase-N:plan:validator`.
6. Require validator to emit `plan-validation-result` sentinel for VALIDATE gate consumption.

Required outputs:
- Canonical `.kiln/tracks/phase-N/PLAN.md`
- `plan-validation-result` sentinel

### Mode Behavior
| Mode | Behavior |
| --- | --- |
| `multi-model` + `planStrategy: "synthesize"` | Produce `plan_claude.md` + `plan_codex.md`, then synthesize canonical `PLAN.md`. |
| `multi-model` + `planStrategy: "debate"` | Produce both initial plans, run debate rounds, then synthesize canonical `PLAN.md` from final revisions and debate artifacts. |
| `claude-only` | Run only `kiln-planner`; promote planner output to canonical `PLAN.md`; no codex planner, no debate, no synthesizer pass. |

### Plan Debate Flow
Debate round mechanics (critique structure, convergence criteria, artifact naming, round budget) follow `skills/kiln-debate/kiln-debate.md`. This skill defines activation conditions and participant spawn order.

> **Context Freshness:** Per the Context Freshness Contract in
> `skills/kiln-core/kiln-core.md`, each debate subtask MUST receive a fresh
> agent. The tracker manages round progression by reading disk artifacts between
> spawns — it never passes conversation context from one subtask agent to the
> next. Disk artifact paths are the sole handoff channel.

```text
1. Spawn FRESH kiln-planner and FRESH kiln-codex-planner in parallel.
   Input:  .kiln/VISION.md, .kiln/ROADMAP.md, .kiln/docs/*, codebase
   Output: .kiln/tracks/phase-N/plan_claude.md
           .kiln/tracks/phase-N/plan_codex.md

2. For round = 1 to debateRounds:
   a. Critique phase — spawn FRESH agents in parallel:
      - Spawn FRESH kiln-planner in critique mode.
        Input:  .kiln/tracks/phase-N/plan_codex.md (or plan_codex_v<round>.md for round > 1)
        Output: .kiln/tracks/phase-N/critique_of_codex_r<round>.md
      - Spawn FRESH kiln-codex-planner in critique mode.
        Input:  .kiln/tracks/phase-N/plan_claude.md (or plan_claude_v<round>.md for round > 1)
        Output: .kiln/tracks/phase-N/critique_of_claude_r<round>.md

   b. Read both critique artifacts from disk. Check convergence criteria
      (per kiln-debate protocol). Record round result in debate_log.md.
      Break early if convergence met.

   c. Revise phase — spawn FRESH agents in parallel:
      - Spawn FRESH kiln-planner in revise mode.
        Input:  .kiln/tracks/phase-N/plan_claude.md (latest version),
                .kiln/tracks/phase-N/critique_of_claude_r<round>.md
        Output: .kiln/tracks/phase-N/plan_claude_v<round+1>.md
      - Spawn FRESH kiln-codex-planner in revise mode.
        Input:  .kiln/tracks/phase-N/plan_codex.md (latest version),
                .kiln/tracks/phase-N/critique_of_codex_r<round>.md
        Output: .kiln/tracks/phase-N/plan_codex_v<round+1>.md

   d. Read both revised plans from disk. Append round summary to
      .kiln/tracks/phase-N/debate_log.md.

3. Write final debate_log.md with full audit trail.

4. Spawn FRESH kiln-synthesizer with disk inputs only.
   Input:  .kiln/tracks/phase-N/plan_claude_v<final>.md,
           .kiln/tracks/phase-N/plan_codex_v<final>.md,
           all critique artifacts (.kiln/tracks/phase-N/critique_of_*),
           .kiln/tracks/phase-N/debate_log.md
   Output: .kiln/tracks/phase-N/PLAN.md
```

### Debate State Tracking
- Track `debateRound` counter in phase metadata.
- Record convergence status after each round.
- On debate failure (both participants fail in the same round), proceed to synthesis with best available versions.

### Required Output
Produce canonical `.kiln/tracks/phase-N/PLAN.md` with task packets (goals, ACs, files, dependencies, waves, rollback context).

### Exit Conditions
- `PASS`: `PLAN.md` exists and is parseable for validation; in Teams multi-model path, `plan-validation-result` exists with pass status.
- `FAIL`: planning artifact is missing, malformed, or cannot be promoted to canonical `PLAN.md`.

### State Updates (Reported To `kiln-fire`)
- On pass: set `currentStep` to `validate`.
- Record planning artifact paths in phase metadata.
- On fail: increment plan retry metadata and attach failure context for re-plan routing.

## References
- `skills/kiln-core/kiln-core.md` — Tracker Contract, Context Freshness Contract, state schema, model routing
- `skills/kiln-debate/kiln-debate.md` — debate activation and round protocol referenced by PLAN debate mode
