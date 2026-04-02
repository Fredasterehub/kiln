# Step Definitions

Which agents to spawn per step, spawn order, expected signals, and state transitions.

## Step 1: Onboarding

- **Boss**: alpha (opus)
- **Persistent minds**: mnemosyne (opus, Phase A — always spawns, does identity scan)
- **Workers**: maiev (sonnet), curie (sonnet), medivh (sonnet) — Phase C, brownfield only, requested by mnemosyne
- **Three-phase spawn**: Phase A (mnemosyne identity scan) → Phase B (alpha INTERACTIVE) → Phase C (scouts if brownfield + operator approves)
- **Done signal**: "ONBOARDING_COMPLETE" from alpha
- **State update**: stage → brainstorm
- **Notes**: Alpha handles project basics (name, path, type, tooling). Save the big questions for Da Vinci's brainstorm. Greenfield skips Phase C entirely.

## Step 2: Brainstorm

- **Boss**: da-vinci (opus)
- **Persistent minds**: clio (opus, Phase A — "Miss Clio", foundation curator)
- **Three-phase spawn**: Phase A (clio bootstraps from onboarding artifacts) → Phase B (da-vinci INTERACTIVE). No Phase C.
- **Done signal**: "BRAINSTORM_COMPLETE" from da-vinci
- **State update**: stage → research
- **Notes**: INTERACTIVE — da-vinci talks to the operator. Clio bootstraps first and signals READY with project context summary. Da Vinci receives that summary, enters conversation already knowing the project shape. Zero cost on greenfield.

## Step 3: Research

- **Boss**: mi6 (opus)
- **Persistent minds**: thoth (sonnet, Phase A — archivist, owns .kiln/archive/ writes)
- **Workers**: 2-5 field agents (sonnet), spawned as team members via REQUEST_WORKERS
- **Three-phase spawn**: Phase A (mi6 + thoth bootstrap in parallel) → Phase B/C merged (mi6 requests field agents, dispatches topics, validates findings)
- **Done signal**: "RESEARCH_COMPLETE" from mi6
- **State update**: stage → architecture
- **Notes**: MI6 acts as active firewall — validates findings (confidence ≥0.7, ≥3 sources, quotes present) before accepting. Field agents are team members with SendMessage, not fire-and-forget subagents. If VISION.md is fully specified with no open questions, mi6 signals RESEARCH_COMPLETE with 0 topics.

## Step 4: Architecture

- **Boss**: aristotle (opus)
- **Persistent minds**: numerobis (opus, Phase A — technical authority, replaces architect for this step), thoth (sonnet, Phase A — archivist)
- **Workers**: confucius (opus), sun-tzu (sonnet), plato (opus), athena (opus) — requested by aristotle in waves
- **Three-phase spawn**: Phase A (numerobis + thoth bootstrap in parallel) → Phase B (aristotle INTERACTIVE) → Phase C waves (confucius+sun-tzu → plato → athena)
- **Done signal**: "ARCHITECTURE_COMPLETE" from aristotle
- **State update**: stage → build, milestone_count → N
- **Validation loop**: athena may FAIL the plan, triggering plato revision only (max 2 rounds). If blocked after 2: "PLAN_BLOCKED".
- **Operator review**: aristotle presents plan summary, operator approves/edits/aborts.
- **Notes**: Plato writes directly (no Codex CLI). Retry sends to plato only, not planners.

## Step 5: Build (milestone-scoped lifecycle)

- **Boss**: krs-one (opus, Phase B — persists for the full milestone)
- **Persistent minds**: rakim (opus, Phase A — codebase state + AGENTS.md), sentinel (sonnet, Phase A — patterns + pitfalls), thoth (sonnet, Phase A — archivist). All three persist for the full milestone, bootstrap once at milestone start.
- **Workers**: one builder+reviewer pair per chunk from 3 scenarios — Phase C, spawned dynamically via CYCLE_WORKERS (not at team creation):
  - Default: codex+sphinx (GPT-5.4 delegation, sphinx is opus reviewer)
  - Fallback: kaneda+sphinx (direct Write/Edit, sphinx is opus reviewer)
  - UI: clair+obscur (components, pages, design system)
- **Three-phase spawn**: Phase A (rakim + sentinel + thoth bootstrap in parallel, ALL THREE signal READY) → Phase B (krs-one BACKGROUND, persists for milestone) → Phase C dynamic (fresh builder+reviewer pair per CYCLE_WORKERS request, old pair shut down before new pair spawns)
- **Team name**: kill streak name based on build_iteration (see kill-streaks.md)
- **Worker cycling**: KRS-One scopes a chunk → sends CYCLE_WORKERS to team-lead with scenario and reason → engine shuts down current workers → engine spawns fresh builder+reviewer pair → engine sends WORKERS_SPAWNED to KRS-One with new agent names → KRS-One dispatches assignment to fresh workers. Fresh context per chunk prevents accumulated confusion.
- **Signals from KRS-One**:
  - `CYCLE_WORKERS` — request fresh builder+reviewer pair. Sent to team-lead (blocking). Engine responds with WORKERS_SPAWNED.
  - `ITERATION_UPDATE` — sent to rakim+sentinel (blocking, 60s timeout) after builder reports `IMPLEMENTATION_COMPLETE` and reviewer gates. Persistent minds respond with READY. If builder sends `IMPLEMENTATION_BLOCKED` instead, KRS-One re-scopes the chunk as a fix.
  - `MILESTONE_TRANSITION: completed={name}, next={name}` — sent to rakim+sentinel+thoth (blocking for rakim+sentinel, fire-and-forget for thoth). PMs archive and reset for next milestone. Sent BEFORE MILESTONE_COMPLETE.
  - `MILESTONE_COMPLETE: {name}` — milestone done, deep QA passed. Sent to engine AFTER MILESTONE_TRANSITION acknowledged. Triggers next milestone or BUILD_COMPLETE.
  - `BUILD_COMPLETE` — all milestones done. Proceed to step 6.
- **State update**: build_iteration incremented per worker cycle. On MILESTONE_COMPLETE: advance to next milestone. On BUILD_COMPLETE: stage → validate.
- **Notes**: KRS-One has NO Write/Edit tools — he scopes and delegates only. KRS-One persists for the full milestone — no re-invocation between iterations. Structured XML assignments define WHAT/WHY, builders decide HOW. 3 scenarios: default (GPT-5.4 delegation via codex+sphinx), fallback (direct Write/Edit via kaneda+sphinx), UI (clair+obscur). sphinx (opus) is the single structural reviewer for Default and Fallback. Sentinel is sonnet (structured pattern docs + tool compliance). ITERATION_COMPLETE is legacy/internal — replaced by CYCLE_WORKERS for worker management and ITERATION_UPDATE for persistent mind sync.

## Step 6: Validate

- **Boss**: argus (sonnet)
- **Persistent minds**: zoxea (sonnet, Phase A — architecture verifier, writes architecture-check.md)
- **Workers**: hephaestus (sonnet, Phase C — conditional, only when `.kiln/design/` exists AND project is web app. Spawned by argus via REQUEST_WORKERS. 5-axis design review, advisory scoring.)
- **Spawn order**: Phase A (zoxea bootstraps, writes architecture-check.md, signals READY) → Phase B (argus validates with zoxea's findings) → Phase C conditional (argus requests hephaestus if design artifacts exist).
- **Signals from Argus**:
  - `VALIDATE_PASS` — proceed to step 7. State: stage → report.
  - `VALIDATE_FAILED` — correction tasks in report.md.
    - If correction_cycle < 3: increment correction_cycle, loop back to step 5.
    - If correction_cycle >= 3: escalate to operator. Pipeline blocked.

## Step 7: Report

- **Boss**: omega (opus, solo)
- **Agents**: none
- **Spawn order**: omega only.
- **Done signal**: "REPORT_COMPLETE" from omega
- **State update**: stage → complete
