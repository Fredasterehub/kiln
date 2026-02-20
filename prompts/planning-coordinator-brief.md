# Planning Brief — Stage 2 Planning Coordinator

## What You Are Planning

Design and spec a new Kiln agent: the **Stage 2 Planning Coordinator**. This is a teammate (has Task tool access) that owns the entire Stage 2 planning pipeline end-to-end, so Kiln (the orchestrator) never has to touch it directly.

## Core Architecture Principle

Kiln operates on a strict three-tier model:

- **Orchestrator (Kiln)**: super thin, lean, must hold context for the entire project duration (all 5 stages). Routes stages, reads memory, gates with operator. Never implements, plans, reviews, or debates anything directly. Think: traffic cop.
- **Coordinators (Teammates — have Task tool access)**: own a full pipeline stage. Spawn workers, sequence steps, write output artifacts, report a single clean signal back to Kiln. Run in a fresh context per stage.
- **Workers (Leaf agents — no Task access)**: do one job. Receive a prompt + inputs, write an output file, terminate.

**Current coordinator map:**
- Stage 1 — Brainstorm: Da Vinci (interactive, direct), Mnemosyne (brownfield mapping coordinator)
- Stage 2 — Planning: **MISSING** — Kiln does it directly ← the problem
- Stage 3 — Execution: Maestro (kiln-phase-executor) ✓
- Stage 4 — Validation: Argus
- Stage 5 — Delivery: Kiln direct (short, acceptable)

v1 had this right: `kiln-tracker-plan` owned Stage 2. v2 lost it.

## The Problem in Detail

Currently in `assets/commands/kiln/start.md`, Steps 8–11 are:

- **Step 8**: Kiln spawns Confucius + Sun Tzu in parallel (reading full vision.md, MEMORY.md, codebase snapshot into its context)
- **Step 9**: Kiln spawns Socrates with both plans (reads both full plan outputs into its context)
- **Step 10**: Kiln spawns Plato with both plans + debate output (reads all into its context)
- **Step 10.5**: Kiln spawns Athena (reads full master plan into its context)
- **Step 11**: Kiln presents master plan to operator for approval

That's 5 sequential agent spawns + all their outputs flowing through Kiln's context. By the time Stage 2 is done, Kiln is carrying ~30-50k tokens of planning artifacts. It then needs to survive all of Stage 3 (multiple phases, each with Maestro returning phase results). This is the context bloat.

## The Fix

A new agent — **`kiln-planning-coordinator`** — becomes a teammate that takes over all of Steps 8–11. Kiln's new role in Stage 2:

1. Spawn the planning coordinator with: `project_path`, `memory_dir`, `kiln_dir`, `debate_mode`, `brainstorm_depth`
2. Wait for a single return signal: `PLAN_APPROVED` or `PLAN_BLOCKED`
3. If `PLAN_APPROVED`: read a single field from MEMORY.md (`phase_total`) and proceed to Stage 3
4. If `PLAN_BLOCKED`: report to operator and halt

All the messy middle — dual planners, debate, synthesis, Athena, operator plan review loop — lives inside the coordinator. Never surfaces in Kiln's context.

## Reference: What a Coordinator Looks Like

Maestro (`kiln-phase-executor`) is the reference implementation. Key patterns:

```yaml
---
name: Maestro
alias: kiln-phase-executor
model: opus
tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - Task        ← coordinator always has Task
---
```

Maestro's rules pattern:
- Never perform work directly — delegate via Task
- Read output files, not Task return payloads (except short verdicts)
- On unrecoverable error: write error state and halt
- Terminate immediately after returning completion message

Maestro's inputs: `project_path`, `memory_dir`, `phase_number`, `phase_description`, `debate_mode`, `git_branch_name`

Maestro's workflow: Setup → Index → Plan → Sharpen → Implement → Review → Complete → Reconcile → Archive → Return

## What the Planning Coordinator Must Do

Workers it coordinates (in order):
1. **Confucius** (kiln-planner-claude) — parallel with Sun Tzu
2. **Sun Tzu** (kiln-planner-codex) — parallel with Confucius
3. **Socrates** (kiln-debater) — if debate_mode >= 2
4. **Plato** (kiln-synthesizer) — always
5. **Athena** (kiln-plan-validator) — always; re-validate loop up to 2 retries

Then: operator review loop (present plan, accept/edit/abort). On approval: write master-plan.md, update MEMORY.md, return `PLAN_APPROVED` with phase_total.

## Files That Will Change

1. **New file**: `assets/agents/kiln-planning-coordinator.md` — the agent definition
2. **Modified**: `assets/commands/kiln/start.md` — Steps 8–11 replaced by single coordinator spawn
3. **Modified**: `assets/names.json` — add new entry with alias + quotes
4. **Modified**: `assets/protocol.md` — add coordinator to agent roster, update Stage 2 description, update rule 3 (Task access list)
5. **Modified**: `assets/skills/kiln-core.md` — update Stage 2 in any stage descriptions
6. **Tests**: `test/install.e2e.test.js` — agent count 18→19; `test/v040-contracts.test.js` or new test file for coordinator contract

## Design Questions the Plan Must Answer

1. **Alias**: What alias does this coordinator get? Should be a philosopher/strategist fitting "planning and strategy" (Confucius/Socrates/Plato are taken; Sun Tzu is taken). Options: Aristotle, Clausewitz, Machiavelli, Zhuangzi — or something else entirely.

2. **Operator interaction**: The plan review loop (Step 11 — "does this plan look correct?") currently lives in Kiln. Should the coordinator handle it directly, or should it signal Kiln to do the operator interaction? Consider: coordinators don't normally talk to the operator — that's Kiln's job. But if coordinator signals Kiln "plan ready, show it", Kiln needs to load the full plan into context anyway.

3. **MEMORY.md updates**: Currently Kiln updates `planning_sub_stage` at each step (dual_plan → debate → synthesis). Should the coordinator write these directly, or should Kiln poll/read them?

4. **Context budget rule**: Maestro has "keeps orchestration context under 6,000 tokens". What's the right budget for the planning coordinator? It reads full plan outputs (could be large).

5. **Re-validation loop**: Athena can fail and trigger re-planning (up to 2 retries). Each retry re-spawns Confucius + Sun Tzu + Socrates + Plato + Athena. Should this loop live inside the coordinator (cleaner for Kiln) or escalate to Kiln?

6. **Resume compatibility**: `/kiln:resume` currently reads `planning_sub_stage` to restore mid-planning state. The coordinator introduces a new abstraction layer. Does resume.md need to change to resume a mid-coordinator run?

## Output Format

Your plan must include:

1. **Agent alias and rationale**
2. **Full agent definition** (`kiln-planning-coordinator.md`) — YAML frontmatter + role + rules + inputs + workflow, matching the exact style of `kiln-phase-executor.md`
3. **Exact start.md changes** — what Steps 8-12 become after the refactor
4. **names.json entry** — alias + role + 5 quotes
5. **Protocol.md changes** — agent roster row + rule 3 update + Stage 2 description update
6. **Test changes** — what needs updating/adding
7. **Answers to all 6 design questions above** with reasoned choices

## Context

- Package: `kilntwo` — NPM package, installs Kiln protocol into Claude Code
- Architecture: zero dependencies, pure Node.js, CommonJS
- All agent definitions: `assets/agents/kiln-*.md` with YAML frontmatter + XML sections
- All agents use Opus 4.6 except: Sherlock (Sonnet), Sun Tzu/Scheherazade/Codex (GPT family), Athena (Sonnet)
- Path contract: always use `$PROJECT_PATH`, `$KILN_DIR`, `$MEMORY_DIR`, `$CLAUDE_HOME` — never root-anchored paths
- Event format: `- [ISO] [ALIAS] [TYPE] — desc` using closed enum from kiln-core
- Tests: `node --test test/*.test.js` — currently 153 passing
