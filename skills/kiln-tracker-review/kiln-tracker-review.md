---
name: kiln-tracker-review
description: 'Review stage tracker — single step, report, shut down'
---

## Overview
This skill executes exactly one pipeline step: `REVIEW`. It is spawned by `kiln-fire` as a fresh teammate for each review invocation. It reads `.kiln/STATE.md` from disk, runs review gating for the active phase, writes review artifacts, reports completion, and shuts down.

## Single-Step Dispatcher Contract

When spawned by `kiln-fire`, this skill executes exactly ONE step:

1. Read `.kiln/STATE.md` from disk to determine the active phase and step.
2. Execute exactly that step (see Stage Details below).
3. Write artifacts to `.kiln/tracks/phase-N/`.
4. SendMessage `{ stage: "track:<phase>:<step>", status: "completed", evidence_paths: [...] }` to team lead.
5. Shut down.

Hard rules:
- **Do not write or edit `.kiln/STATE.md`.** Only `kiln-fire` writes STATE.md.
- **Do not advance `currentStep` or `currentPhase`.** That is `kiln-fire`'s responsibility.
- **Do not loop to the next step.** Execute one step, report, shut down.

Context Freshness: This skill follows the four-step ephemeral invariant defined in
`skills/kiln-core/kiln-core.md` § Context Freshness Contract:
spawn fresh → read from disk → do one job → write to disk → die.

## Stage Details

### Purpose
Apply comprehensive quality review after implementation and phase E2E validation.

### Subagents To Spawn
- Always spawn `kiln-reviewer` (Opus) after E2E pass.
- Also spawn `kiln-codex-reviewer` (GPT-5.3-codex-sparks) when `reviewStrategy: "debate"` and `modelMode: "multi-model"`.

### Mode Behavior
- `reviewStrategy: "single"` (default): run only `kiln-reviewer`.
- `reviewStrategy: "debate"`: run both reviewers, debate rounds, then final verdict.
- `claude-only`: run only `kiln-reviewer` regardless of `reviewStrategy`.

### Teams Mode Selector (`preferences.useTeams`)
- `false` or absent: sequential Task spawning for review/debate.
- `true` + `reviewStrategy: "single"`: unchanged single-reviewer path.
- `true` + `reviewStrategy: "debate"` + `modelMode: "multi-model"`: use review debate team scheduler.
- `true` + `reviewStrategy: "debate"` + `modelMode: "claude-only"`: skip Teams debate and use single-reviewer path.

### Review Debate Flow — Teams Scheduler
Debate mechanics (round budget, critique structure, convergence criteria, artifact naming) follow `skills/kiln-debate/kiln-debate.md`. This skill defines reviewer spawn/routing and final verdict semantics.

> **Context Freshness:** Per the Context Freshness Contract in
> `skills/kiln-core/kiln-core.md`, each debate subtask MUST receive a fresh
> agent. The tracker reads the latest disk artifacts between spawns to determine
> round state and convergence — it never carries in-memory state from one
> subtask agent into the next.

- Create one review team for `phase-N`.
- Spawn FRESH initial reviewers in parallel:
  - `kiln-reviewer` input: working tree diff, `.kiln/tracks/phase-N/e2e-results.md`, acceptance criteria; output `.kiln/tracks/phase-N/review.md`.
  - `kiln-codex-reviewer` input: working tree diff, `.kiln/tracks/phase-N/e2e-results.md`, acceptance criteria; output `.kiln/tracks/phase-N/review_codex.md`.
- For each round `r` in `1..debateRounds`:
  - Read latest artifacts from disk.
  - Spawn critique tasks in parallel, then read critiques.
  - Spawn revise tasks in parallel, then read revisions.
  - Append round results to `.kiln/tracks/phase-N/debate_log.md`.
  - Stop early on convergence.
- Final verdict rule: stricter verdict wins (`REJECTED` over `APPROVED`); Opus reviewer final revision is authoritative where contract requires an authority artifact.

### Review Debate Flow — Sequential Fallback
Sequential Task spawning remains fresh by construction; each Task receives a clean context window and uses disk artifacts as the sole handoff channel.

```text
1. Spawn FRESH kiln-reviewer and FRESH kiln-codex-reviewer in parallel.
   Input:  working tree diff, .kiln/tracks/phase-N/e2e-results.md, acceptance criteria
   Output: .kiln/tracks/phase-N/review.md
           .kiln/tracks/phase-N/review_codex.md

2. For round = 1 to debateRounds:
   a. Critique phase — spawn FRESH agents in parallel:
      - Spawn FRESH kiln-reviewer in critique mode.
        Input (disk):  .kiln/tracks/phase-N/review_codex.md (latest version)
        Output: .kiln/tracks/phase-N/critique_of_review_codex_r<round>.md
      - Spawn FRESH kiln-codex-reviewer in critique mode.
        Input (disk):  .kiln/tracks/phase-N/review.md (latest version)
        Output: .kiln/tracks/phase-N/critique_of_review_opus_r<round>.md

   b. Revise phase — spawn FRESH agents in parallel:
      - Spawn FRESH kiln-reviewer in revise mode.
        Input (disk):  .kiln/tracks/phase-N/review.md (latest),
                       .kiln/tracks/phase-N/critique_of_review_opus_r<round>.md
        Output: .kiln/tracks/phase-N/review_v<round+1>.md
      - Spawn FRESH kiln-codex-reviewer in revise mode.
        Input (disk):  .kiln/tracks/phase-N/review_codex.md (latest),
                       .kiln/tracks/phase-N/critique_of_review_codex_r<round>.md
        Output: .kiln/tracks/phase-N/review_codex_v<round+1>.md

   c. Convergence check:
      - Read both critique artifacts from disk for this round.
      - If convergence criteria met (per kiln-debate protocol), break early.
      - Append round result to .kiln/tracks/phase-N/debate_log.md.

3. Update .kiln/tracks/phase-N/debate_log.md with full review debate audit trail.

4. Final verdict determination:
   - Read both final revised reviews from disk.
   - Agreement on findings = high-confidence issues (always include).
   - Single-reviewer findings = evaluate on individual merit.
   - The Opus reviewer's final revision is the authoritative verdict.
   - If verdicts disagree: the stricter verdict wins (REJECTED beats APPROVED).
```

### State Tracking For Review Debate
- Track `reviewDebateRound` counter in phase metadata.
- Record convergence status after each round.
- On debate failure, fall back to Opus reviewer's latest verdict.

### Verdict Handling
- `APPROVED`: advance to `RECONCILE`.
- `REJECTED`: route corrections through `EXECUTE -> E2E -> REVIEW` with strict cycle counting.

### Correction Budget
- Maximum review correction cycles: 3 per phase.
- If still rejected after cycle 3, `HALT`.
- Debate rounds do not count as correction cycles.

### Exit Conditions
- `PASS`: review verdict is approved (post-debate when debate is active).
- `FAIL`: correction budget exhausted.

### State Updates (Reported To `kiln-fire`)
- Increment `correctionCycles.review` per rejected cycle.
- Persist review artifact path and top findings summary.
- Timestamp verdict transitions.

## References
- `skills/kiln-core/kiln-core.md` — shared contracts, state schema, model routing, Context Freshness Contract
- `skills/kiln-debate/kiln-debate.md` — debate activation and round protocol referenced by REVIEW debate mode
