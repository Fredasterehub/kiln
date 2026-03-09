# Step Definitions

Which agents to spawn per step, spawn order, expected signals, and state transitions.

## Step 1: Onboarding

- **Boss**: alpha (opus)
- **Agents**: mnemosyne (opus, conditional — brownfield only). Mnemosyne internally spawns 5 scouts: atlas, nexus, spine, signal, bedrock.
- **Spawn order**: alpha first. Alpha spawns mnemosyne if brownfield.
- **Done signal**: "onboarding complete" from alpha
- **State update**: stage → brainstorm
- **Notes**: Alpha interviews the operator directly. Greenfield skips mnemosyne entirely.

## Step 2: Brainstorm

- **Boss**: da-vinci (opus)
- **Agents**: visionary (opus)
- **Spawn order**: da-vinci and visionary in parallel. Visionary bootstraps immediately (reads onboarding artifacts).
- **Done signal**: "BRAINSTORM_COMPLETE" from da-vinci
- **State update**: stage → research
- **Notes**: INTERACTIVE — da-vinci talks to the operator. Visionary receives fire-and-forget VISION_UPDATEs.

## Step 3: Research

- **Boss**: mi6 (opus)
- **Agents**: Dynamic — mi6 spawns field-agent instances at runtime (named sherlock, watson, poirot, etc.). Agent #7 must be "bond".
- **Spawn order**: mi6 only. mi6 spawns field-agent instances internally using subagent_type "field-agent".
- **Done signal**: "RESEARCH_COMPLETE" from mi6
- **State update**: stage → architecture
- **Notes**: If VISION.md is fully specified with no open questions, mi6 signals RESEARCH_COMPLETE with 0 topics.

## Step 4: Architecture

- **Boss**: aristotle (opus)
- **Agents**: architect (opus), confucius (opus), sun-tzu (sonnet), socrates (opus), plato (sonnet), athena (opus)
- **Spawn order**: All agents in parallel. Aristotle orchestrates the dependency chain via messages.
- **Done signal**: "ARCHITECTURE_COMPLETE" from aristotle
- **State update**: stage → build, milestone_count → N
- **Validation loop**: athena may FAIL the plan, triggering re-planning (max 3 attempts). If blocked after 3: "PLAN_BLOCKED".
- **Operator review**: aristotle presents plan summary, operator approves/edits/aborts.
- **Notes**: Architect bootstraps autonomously on spawn (MODE: Architecture). Aristotle must wait for architect's BOOTSTRAP_COMPLETE before dispatching planners. Include this in aristotle's runtime prompt.

## Step 5: Build (re-invoked per iteration)

- **Boss**: krs-one (opus)
- **Agents**: codex (sonnet), sphinx (sonnet), architect (opus), sentinel (opus)
- **Spawn order**: All agents in parallel. KRS-One orchestrates via messages.
- **Team name**: kill streak name based on build_iteration (see kill-streaks.md)
- **Signals from KRS-One**:
  - `ITERATION_COMPLETE` — more work needed. Re-invoke with next kill streak name.
  - `MILESTONE_COMPLETE: {name}` — milestone done, deep QA passed. Re-invoke for next milestone.
  - `BUILD_COMPLETE` — all milestones done. Proceed to step 6.
- **State update**: build_iteration incremented each invocation. On BUILD_COMPLETE: stage → validate.

## Step 6: Validate

- **Boss**: argus (opus, solo)
- **Agents**: architect (opus, consultation only — read-only mode)
- **Spawn order**: Both in parallel. Architect is passive.
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
