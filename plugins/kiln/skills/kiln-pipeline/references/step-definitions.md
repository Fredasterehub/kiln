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
- **Workers**: 2-5 field agents (sonnet), spawned as team members via REQUEST_WORKERS
- **Three-phase spawn**: Phase A (mi6 bootstraps, reads VISION.md, identifies topics, READY) → Phase B/C merged (mi6 requests field agents, dispatches topics, validates findings)
- **Done signal**: "RESEARCH_COMPLETE" from mi6
- **State update**: stage → architecture
- **Notes**: MI6 acts as active firewall — validates findings (confidence ≥0.7, ≥3 sources, quotes present) before accepting. Field agents are team members with SendMessage, not fire-and-forget subagents. If VISION.md is fully specified with no open questions, mi6 signals RESEARCH_COMPLETE with 0 topics.

## Step 4: Architecture

- **Boss**: aristotle (opus)
- **Persistent minds**: numerobis (opus, Phase A — technical authority, replaces architect for this step)
- **Workers**: confucius (opus), sun-tzu (sonnet), plato (opus), athena (opus) — requested by aristotle in waves
- **Three-phase spawn**: Phase A (numerobis bootstraps, writes arch docs) → Phase B (aristotle INTERACTIVE) → Phase C waves (confucius+sun-tzu → plato → athena)
- **Done signal**: "ARCHITECTURE_COMPLETE" from aristotle
- **State update**: stage → build, milestone_count → N
- **Validation loop**: athena may FAIL the plan, triggering plato revision only (max 2 rounds). If blocked after 2: "PLAN_BLOCKED".
- **Operator review**: aristotle presents plan summary, operator approves/edits/aborts.
- **Notes**: Socrates eliminated — structured comparison merged into plato (opus). Plato writes directly (no Codex CLI). Retry sends to plato only, not planners.

## Step 5: Build (re-invoked per iteration)

- **Boss**: krs-one (opus)
- **Persistent minds**: rakim (opus, Phase A — codebase state + AGENTS.md), sentinel (sonnet, Phase A — patterns + pitfalls)
- **Workers**: codex (sonnet, isolation: worktree), sphinx (sonnet) — Phase C, requested by krs-one
- **Three-phase spawn**: Phase A (rakim + sentinel bootstrap) → Phase B (krs-one BACKGROUND) → Phase C (codex in worktree + sphinx per request)
- **Team name**: kill streak name based on build_iteration (see kill-streaks.md)
- **Signals from KRS-One**:
  - `ITERATION_COMPLETE` — more work needed. Re-invoke with next kill streak name.
  - `MILESTONE_COMPLETE: {name}` — milestone done, deep QA passed. Re-invoke for next milestone.
  - `BUILD_COMPLETE` — all milestones done. Proceed to step 6.
- **State update**: build_iteration incremented each invocation. On BUILD_COMPLETE: stage → validate.
- **Notes**: KRS-One has NO Write/Edit tools — he scopes and delegates only. Structured XML assignments define WHAT/WHY, codex/GPT-5.4 decides HOW. Codex runs in git worktree isolation — engine merges the worktree branch after each iteration. Sentinel is sonnet (structured pattern docs + tool compliance).

## Step 6: Validate

- **Boss**: argus (sonnet, solo)
- **Agents**: zoxea (sonnet, consultation only — read-only mode)
- **Spawn order**: Both in parallel. Zoxea is passive.
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
