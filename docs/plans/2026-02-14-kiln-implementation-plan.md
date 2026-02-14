# Kiln Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build kiln — a multi-model orchestration workflow for Claude Code — as an NPM package (`kiln-dev`) with 11 agents, 7 skills, 2 hooks, and an interactive installer.

**Architecture:** Kiln is primarily structured prompt engineering (markdown agents + skills) with a thin JS installer and shell hook scripts. The build uses the avatarme v2 workflow (conductor pattern, task packets, deterministic verification) via Claude Code Agent Teams. Each track is planned JIT with dual-model input, executed via task packets, and verified before advancing.

**Tech Stack:** Node.js (installer), Bash (hooks), Markdown (agents/skills/templates), Claude Code Agent Teams (build execution)

**Reference Docs:**
- Design spec: `/tank/dump/DEV/kiln/docs/plans/2026-02-14-kiln-architecture-design.md`
- Handoff: `/tank/dump/DEV/kiln/docs/plans/HANDOFF.md`
- Avatarme v2 workflow: `/tank/dump/DEV/avatarme/workflow-standalone/v2/`

---

## Pre-Execution Setup

Before any track begins, set up the build infrastructure:

### Step 1: Initialize the kiln repo

```bash
cd /tank/dump/DEV/kiln
git init
```

### Step 2: Install avatarme v2 workflow

```bash
python3 /tank/dump/DEV/avatarme/workflow-standalone/v2/bin/install.py \
  --repo-root /tank/dump/DEV/kiln \
  --modify-gitignore \
  --init-tracks
```

This copies:
- `agents/` -> `.claude/agents/` (11 build-process agents)
- `templates/` -> `templates/teams/`
- `contracts/` -> `docs/teams/contracts/`

### Step 3: Create project CLAUDE.md

Paste the CLAUDE_SNIPPET.md content into `/tank/dump/DEV/kiln/CLAUDE.md`, plus kiln-specific rules:

```markdown
# Kiln Build Rules

## Separation of Concerns
- `.claude/agents/` — avatarme v2 build-process agents (DO NOT EDIT as part of kiln product)
- `agents/` — kiln product agents (the NPM package source)
- `skills/` — kiln product skills (the NPM package source)
- `hooks/` — kiln product hooks (the NPM package source)

## What We're Building
Kiln is an NPM package. End users install it with `npx kiln-dev`.
The package source lives at the repo root: agents/, skills/, hooks/, bin/, templates/.
The .claude/ directory is OUR build tooling, not the product.

## Verification
- Agent/skill markdown: lint for required sections, validate YAML frontmatter
- Hook scripts: shellcheck + dry-run test
- Installer: run against a temp directory, verify file placement
- Integration: install into a sample project, invoke /kiln:init, verify .kiln/ creation
```

### Step 4: Create initial commit

```bash
git add -A && git commit -m "chore: initialize kiln repo with avatarme v2 build workflow"
```

### Step 5: Spawn Agent Team

Use the lead kickoff prompt from CLAUDE_SNIPPET.md to create a team named "teams" with the 11 avatarme v2 agents.

---

## Track Dependency Graph

```
T01 (Scaffolding)
 └─> T02 (Core Foundation)
      ├─> T03 (Init + Orchestrator)
      ├─> T04 (Brainstorming Pipeline)  ──────┐
      │    └─> T05 (Planning Pipeline)         │
      │         └─> T06 (Execution Pipeline)   │ parallel after T02
      │              └─> T07 (Verify + Review) │
      ├─> T08 (Reconcile + Utilities)  ────────┘
      └─> T09 (Hooks + Installer) ← depends on T03-T08
           └─> T10 (Integration Test) ← depends on everything
```

**Parallelism:** After T02 completes, T03/T04/T08 can run concurrently. T05 needs T04's output format. T06 needs T05. T07 needs T06. T09 needs all agent/skill tracks done. T10 is the capstone.

---

## Track 01: Project Scaffolding

**Goal:** Create the NPM package skeleton with correct directory structure, package.json, and basic README.

**Acceptance Criteria:**
- AC-01 (DET): `npm pack` succeeds and produces a tarball
- AC-02 (DET): Directory structure matches design spec (agents/, skills/, hooks/, bin/, templates/)
- AC-03 (DET): `node bin/install.js --help` exits 0

**~3 Tasks:**
1. Create package.json with correct name (`kiln-dev`), bin entry, files whitelist, no runtime deps
2. Create directory skeleton: `agents/`, `skills/`, `hooks/scripts/`, `bin/`, `templates/`
3. Create stub `bin/install.js` (argument parsing skeleton, --help, exits cleanly)

**Files Created:**
- `package.json`
- `bin/install.js` (stub)
- `agents/.gitkeep`, `skills/.gitkeep`, `hooks/scripts/.gitkeep`, `templates/.gitkeep`
- `.gitignore` (node_modules, .kiln/, .teams/)

**Verification:** `npm pack --dry-run` succeeds, `node bin/install.js --help` exits 0.

---

## Track 02: Core Foundation

**Goal:** Build the foundational skill (kiln-core) that defines universal invariants, the state layer schema, and all file templates. Every agent and skill downstream depends on this.

**Acceptance Criteria:**
- AC-01 (LLM): kiln-core skill defines all agent coordination contracts (file paths, output formats, sentinel schemas)
- AC-02 (DET): config.json template validates against a JSON schema
- AC-03 (DET): All template files exist and contain required placeholder sections
- AC-04 (LLM): kiln-core covers model routing table, Claude-only fallback rules, context budget guidelines

**~4 Tasks:**
1. Write `skills/kiln-core/kiln-core.md` — the constitution. Covers:
   - .kiln/ directory structure and file purposes
   - Model routing table (which model for which role)
   - Claude-only vs multi-model switching rules
   - Output format contracts between agents (what each agent reads/writes)
   - Context budget rules (orchestrator ~15%, tasks get full context)
   - Error escalation protocol (max retries, halt conditions)
   - Sentinel format (YAML blocks in markdown for machine-readable output)
2. Write `templates/config.json.tmpl` — schema for .kiln/config.json:
   - `projectType`: greenfield | brownfield | returning
   - `modelMode`: multi-model | claude-only
   - `tooling`: { testRunner, linter, typeChecker, buildSystem, startCommand }
   - `preferences`: { maxRetries, waveParallelism, e2eTimeout }
3. Write `templates/STATE.md.tmpl` — progress tracking format:
   - Phase list with status (pending/in-progress/complete/failed)
   - Current track step (plan/validate/execute/e2e/review/reconcile)
   - Correction cycle counts
   - Regression test count
4. Write `templates/vision-sections.md` — structured sections for VISION.md:
   - Problem statement, solution overview, user personas
   - Success criteria (measurable), constraints and non-goals
   - Key decisions, open questions

**Files Created:**
- `skills/kiln-core/kiln-core.md`
- `templates/config.json.tmpl`
- `templates/STATE.md.tmpl`
- `templates/vision-sections.md`

**Verification:** All files exist, config template is valid JSON, kiln-core contains all required sections (grep for key terms).

---

## Track 03: Init + Orchestrator

**Goal:** Build the orchestrator agent (thin traffic cop) and the /kiln:init slash command that detects project type, tooling, and Codex CLI availability.

**Acceptance Criteria:**
- AC-01 (LLM): Orchestrator agent correctly defines its role as traffic cop (routes, never implements)
- AC-02 (LLM): /kiln:init skill handles greenfield, brownfield, and returning project detection
- AC-03 (DET): Init skill references correct detection commands for each tooling type
- AC-04 (LLM): Orchestrator defines stage transitions and subagent spawning rules

**~4 Tasks:**
1. Write `agents/kiln-orchestrator.md`:
   - Opus 4.6 model assignment
   - Traffic cop role: reads STATE.md, routes to correct stage, spawns subagents
   - Stage transition logic: init -> brainstorm -> roadmap -> track loop -> final E2E
   - Context budget: stay under 15%, delegate everything
   - Error escalation: when to halt and report to operator
   - References kiln-core skill for contracts
2. Write `skills/kiln-init/kiln-init.md` (/kiln:init slash command):
   - Project type detection (check for src/, package.json, .kiln/)
   - Tooling discovery (test runner, linter, type checker, build system, start command)
   - Codex CLI detection (`which codex`, authentication check)
   - .kiln/ directory creation with config.json from template
   - STATE.md initialization
   - Living docs directory creation (empty)
   - Operator confirmation of detected config
3. Write `skills/kiln-status/kiln-status.md` (/kiln:status slash command):
   - Read STATE.md + ROADMAP.md + current track state
   - Display phase progress, living doc status, regression suite size
   - Route to next action
4. Write `skills/kiln-quick/kiln-quick.md` (/kiln:quick slash command):
   - Single-pass mode: skip brainstorm/roadmap/dual-planning
   - Still gets: sharpening, implementation, adaptive verification, regression
   - Heuristics for "too big for quick mode" (>3 files, architectural change, new dependency)

**Files Created:**
- `agents/kiln-orchestrator.md`
- `skills/kiln-init/kiln-init.md`
- `skills/kiln-status/kiln-status.md`
- `skills/kiln-quick/kiln-quick.md`

**Verification:** Each agent/skill has required YAML frontmatter, references kiln-core, defines clear inputs/outputs.

---

## Track 04: Brainstorming Pipeline

**Goal:** Build the brainstormer agent, brainstorm skill, and the complete vision crystallization flow including dual-model challenge pass.

**Acceptance Criteria:**
- AC-01 (LLM): Brainstormer agent facilitates BMAD-style divergent exploration with anti-clustering
- AC-02 (LLM): Skill includes curated technique library (SCAMPER, First Principles, Reverse Brainstorming, Six Thinking Hats, Assumption Reversal)
- AC-03 (LLM): Vision challenge pass correctly invokes GPT-5.2 via Codex CLI with proper prompt
- AC-04 (LLM): Claude-only fallback skips challenge pass gracefully
- AC-05 (DET): /kiln:brainstorm skill exists with correct frontmatter

**~5 Tasks:**
1. Write `agents/kiln-brainstormer.md`:
   - Opus 4.6, interactive, facilitation-first persona
   - Phase A: Divergent exploration (50-100+ ideas, anti-clustering rotation)
   - Phase B: Convergent structuring (themes, must-have/nice-to-have, non-goals)
   - Phase C: Vision crystallization (draft VISION.md)
   - Only writes to .kiln/ directory
   - References kiln-brainstorm skill for technique library
2. Write `skills/kiln-brainstorm/kiln-brainstorm.md`:
   - Technique library with usage guidelines per technique
   - Anti-clustering protocol (rotate creative domain every 10 ideas)
   - "What else?" pressure techniques to resist premature convergence
   - VISION.md section format (from template)
   - Facilitation prompts and question patterns
3. Write vision challenge pass logic (embedded in brainstormer agent):
   - Codex CLI invocation: `codex exec -m gpt-5.2 -c 'model_reasoning_effort="high"' ...`
   - Challenge prompt: critique, missing elements, unexamined assumptions, unsurfaced risks
   - Output: `.kiln/tracks/phase-N/vision_critique.md`
4. Write vision synthesis logic (embedded in brainstormer agent):
   - Merge original VISION.md + critique
   - Resolve disagreements, incorporate valid challenges
   - Final VISION.md draft for operator approval
5. Write `/kiln:brainstorm` slash command skill:
   - Entry point that spawns brainstormer agent
   - Handles the HARD GATE (operator must explicitly approve VISION.md)
   - VISION.md becomes immutable after approval
   - Claude-only mode: skip challenge pass, single-perspective brainstorm

**Files Created:**
- `agents/kiln-brainstormer.md`
- `skills/kiln-brainstorm/kiln-brainstorm.md`

**Verification:** Agent references correct model, skill contains technique library, Codex CLI command is syntactically correct.

---

## Track 05: Planning Pipeline

**Goal:** Build the four planning agents (planner, codex-planner, synthesizer, validator) and the planning skill with 7-dimension validation.

**Acceptance Criteria:**
- AC-01 (LLM): Planner agent produces architectural plans with task packets, wave grouping, and acceptance criteria
- AC-02 (LLM): Codex-planner correctly wraps GPT-5.2 via Codex CLI for alternative perspective
- AC-03 (LLM): Synthesizer merges dual plans taking best of each, produces PLAN.md with task packets
- AC-04 (LLM): Validator checks all 7 dimensions (requirement coverage, task completeness, dependency correctness, scope sanity, context budget, verification derivation, living doc compliance)
- AC-05 (LLM): Claude-only fallback produces single plan without synthesis step

**~5 Tasks:**
1. Write `agents/kiln-planner.md`:
   - Opus 4.6, architectural perspective
   - Reads: VISION.md, ROADMAP.md, living docs, current codebase
   - Outputs: `.kiln/tracks/phase-N/plan_claude.md`
   - Task packet format: goal, acceptance criteria, file hints, dependencies, estimated scope
   - Wave grouping for parallel execution
   - Planning rules: small diffs, reversible steps, explicit failure modes
2. Write `agents/kiln-codex-planner.md`:
   - Sonnet shell agent that invokes GPT-5.2 via Codex CLI
   - Same inputs as planner, different perspective (pragmatic, conventional)
   - Outputs: `.kiln/tracks/phase-N/plan_codex.md`
   - Codex CLI invocation with proper flags and prompt construction
   - Fallback: if no Codex, skip (orchestrator handles)
3. Write `agents/kiln-synthesizer.md`:
   - Opus 4.6, strategic merge
   - Reads both plan files, analyzes strengths/weaknesses
   - Picks cleaner architecture, more thorough error handling, more secure approach
   - Outputs: `.kiln/tracks/phase-N/PLAN.md` (master plan with task packets)
   - Each task must be atomic, self-contained, sized for fresh subagent context
4. Write `agents/kiln-validator.md`:
   - Sonnet, mechanical 7-dimension check
   - PASS -> proceed to execution
   - FAIL -> specific feedback about which dimensions failed, back to planning
   - References kiln-plan skill for validation criteria
5. Write `skills/kiln-plan/kiln-plan.md`:
   - Planning format specification
   - Task atomization rules (1-5 files per task, one clear goal)
   - Wave grouping rules (independent tasks in same wave)
   - 7-dimension validation criteria with pass/fail thresholds
   - Task packet template format

**Files Created:**
- `agents/kiln-planner.md`
- `agents/kiln-codex-planner.md`
- `agents/kiln-synthesizer.md`
- `agents/kiln-validator.md`
- `skills/kiln-plan/kiln-plan.md`

**Verification:** All agents have correct model assignments, Codex CLI commands are syntactically valid, validator covers all 7 dimensions.

---

## Track 06: Execution Pipeline

**Goal:** Build the sharpener and executor agents, plus the execution skill with mini-verify logic.

**Acceptance Criteria:**
- AC-01 (LLM): Sharpener agent reads task packet + current codebase and produces Codex-optimized prompt
- AC-02 (LLM): Sharpener follows Codex Prompting Guide principles (autonomy, bias to action, batch ops, specificity)
- AC-03 (LLM): Executor agent correctly invokes GPT-5.3-codex via Codex CLI with --full-auto
- AC-04 (LLM): Mini-verify runs project test suite + prior E2E tests after each task
- AC-05 (LLM): Claude-only fallback: Opus sharpens for Sonnet, Sonnet implements

**~4 Tasks:**
1. Write `agents/kiln-sharpener.md`:
   - Sonnet shell agent invoking GPT-5.2 via Codex CLI
   - Reads task packet + actual codebase (real file paths, function signatures, imports)
   - Produces Codex-optimized prompt following the Prompting Guide:
     - Autonomy, bias to action, batch operations
     - Specificity (exact paths, signatures)
     - Context (references to what exists)
     - Acceptance criteria (testable success conditions)
   - Sub-divides oversized tasks on the fly
   - Claude-only fallback: Opus generates Sonnet-optimized prompt
2. Write `agents/kiln-executor.md`:
   - Sonnet shell agent invoking GPT-5.3-codex via Codex CLI
   - Flags: `-m gpt-5.3-codex`, `--full-auto`, `-c 'model_reasoning_effort="high"'`
   - Atomic git commit on completion
   - Large prompts via stdin pipe
   - Claude-only fallback: Sonnet implements directly
3. Write `skills/kiln-execute/kiln-execute.md`:
   - Sharpening protocol and prompt format
   - Implementation constraints (atomic commits, no stubs, no TODOs)
   - Mini-verify protocol: run test suite, run prior E2E tests
   - Retry logic: max 2 retries per task with error context, then halt
   - Wave execution: parallel independent tasks, sequential dependent tasks
4. Write mini-verify logic (embedded in kiln-execute skill):
   - Detect test command from .kiln/config.json
   - Run project tests
   - Run cumulative E2E regression (all prior tracks' tests)
   - Quick AC check per task
   - PASS/FAIL determination and retry triggering

**Files Created:**
- `agents/kiln-sharpener.md`
- `agents/kiln-executor.md`
- `skills/kiln-execute/kiln-execute.md`

**Verification:** Codex CLI invocations are syntactically correct, mini-verify references config.json tooling detection, retry limits are enforced.

---

## Track 07: Verification + Review

**Goal:** Build the E2E verifier and reviewer agents, plus verification and E2E skills with adaptive tooling detection and stub detection.

**Acceptance Criteria:**
- AC-01 (LLM): E2E verifier generates user journey tests (not unit tests) per project type
- AC-02 (LLM): E2E verifier handles web-ui (Playwright), api-server (HTTP), cli-tool (subprocess), library (import)
- AC-03 (LLM): Reviewer checks correctness, completeness, security, integration, stub detection, quality
- AC-04 (LLM): Stub detection covers: null-returning components, hardcoded API responses, no-op form handlers, unhandled fetch responses
- AC-05 (LLM): Failure categorization (code bug, integration gap, missing functionality, config issue)

**~5 Tasks:**
1. Write `agents/kiln-e2e-verifier.md`:
   - Sonnet, test generation + execution
   - Phase A: Environment setup (detect start command, start app, wait for ready)
   - Phase B: Generate user journey tests from acceptance criteria
   - Phase C: Execute tests (new + cumulative regression)
   - Phase D: Teardown, save results, commit E2E tests
   - Failure categorization and correction task generation
   - Max 3 E2E correction cycles, then halt
2. Write `skills/kiln-e2e/kiln-e2e.md`:
   - Test generation patterns per project type:
     - Web UI: Playwright (navigate, click, fill, assert)
     - API server: HTTP requests (CRUD, validate responses)
     - CLI tool: subprocess (invoke with args, verify stdout/stderr/exit)
     - Library: import tests (require, call, verify)
   - User journey format (not unit tests — end-to-end flows)
   - Startup timeout detection and configuration
   - Screenshot/artifact capture
   - Regression suite growth protocol
3. Write `agents/kiln-reviewer.md`:
   - Opus 4.6, comprehensive quality gate
   - Reads: full git diff, PLAN.md, VISION.md, living docs, E2E results
   - Checks: correctness, completeness, security, integration, stubs, quality, regressions
   - APPROVED -> proceed to reconcile
   - REJECTED -> correction tasks with file:line specificity
   - Corrections re-trigger E2E (critical: prevents fixes from breaking runtime)
   - Max 3 review correction cycles, then halt
4. Write `skills/kiln-verify/kiln-verify.md`:
   - Adaptive verification protocol:
     - Step 1: Detect project tooling from config.json
     - Step 2: Run detected tools (test runner, linter, type checker)
     - Step 3: Layer AI goal-backward verification on top
   - Stub detection patterns (detailed checklist):
     - Components returning null/empty/placeholder
     - Hardcoded API responses instead of real calls
     - Forms with only preventDefault, no submission logic
     - Fetch/API calls without response handling
     - Functions with only console.log, no real logic
   - Verification result format
5. Write `/kiln:track` slash command (embedded in orchestrator or separate skill):
   - The main work loop entry point
   - Auto-advances through all phases
   - Stage transitions: plan -> validate -> execute -> e2e -> review -> reconcile
   - Pause conditions: reconcile confirmation, failures, operator halt
   - Final integration E2E after all tracks

**Files Created:**
- `agents/kiln-e2e-verifier.md`
- `agents/kiln-reviewer.md`
- `skills/kiln-e2e/kiln-e2e.md`
- `skills/kiln-verify/kiln-verify.md`
- `skills/kiln-track/kiln-track.md` (if separate from orchestrator)

**Verification:** All project types covered in E2E skill, stub detection checklist is comprehensive, reviewer checks all required dimensions.

---

## Track 08: Reconcile + Utilities

**Goal:** Build the reconciliation skill, researcher agent, and the /kiln:roadmap slash command.

**Acceptance Criteria:**
- AC-01 (LLM): Reconcile skill updates living docs (TECH_STACK, PATTERNS, DECISIONS, PITFALLS)
- AC-02 (LLM): Living doc updates replace outdated entries (budget-capped ~3000 words each)
- AC-03 (LLM): Researcher agent provides fast retrieval with structured output format
- AC-04 (LLM): /kiln:roadmap generates dynamic phase count from VISION.md
- AC-05 (LLM): Roadmap is lightweight on purpose (titles + 1-2 sentences, no implementation details)

**~4 Tasks:**
1. Write `skills/kiln-reconcile/kiln-reconcile.md`:
   - Living doc update protocol:
     - Read what changed in the track (files, deps, patterns, decisions)
     - Update TECH_STACK.md (languages, frameworks, deps with versions)
     - Update PATTERNS.md (architecture patterns, naming, file structure)
     - Update DECISIONS.md (decision records with rationale)
     - Update PITFALLS.md (gotchas, anti-patterns discovered)
   - Budget enforcement (~3000 words per doc, replace not append)
   - Roadmap check: does the roadmap still make sense?
   - STATE.md update: mark phase complete, advance to next
   - Operator confirmation for proposed changes
2. Write `agents/kiln-researcher.md`:
   - Haiku, fast retrieval, on-demand at any stage
   - Tools: Read, Grep, Glob, WebSearch, WebFetch, Context7 MCP
   - Structured output: Key findings (with sources), relevant files/URLs, recommendation
   - Spawned on-demand by any other agent that needs information
3. Write `skills/kiln-roadmap/kiln-roadmap.md` (/kiln:roadmap slash command):
   - Reads approved VISION.md
   - Generates ROADMAP.md: phase titles + 1-2 sentence descriptions
   - Dynamic phase count (model determines based on scope)
   - Operator review: reorder, add/remove, adjust scope
   - Output: .kiln/ROADMAP.md
4. Write final integration E2E logic (embedded in orchestrator or kiln-track skill):
   - Triggers after ALL tracks complete
   - Cross-cutting user journey test generation
   - Full regression + integration tests
   - Max 3 correction cycles
   - FINAL_REPORT.md generation

**Files Created:**
- `skills/kiln-reconcile/kiln-reconcile.md`
- `agents/kiln-researcher.md`
- `skills/kiln-roadmap/kiln-roadmap.md`

**Verification:** Living doc sections defined, researcher has correct model/tools, roadmap keeps to lightweight format.

---

## Track 09: Hooks + Installer

**Goal:** Build the lifecycle hooks (mini-verify gate, state rehydration) and the interactive installer that copies the package into a user's project.

**Acceptance Criteria:**
- AC-01 (DET): `shellcheck hooks/scripts/*.sh` passes
- AC-02 (DET): `node bin/install.js --help` shows usage
- AC-03 (DET): Installer copies agents/, skills/, hooks/ to correct .claude/ destinations in a temp dir
- AC-04 (DET): Installer creates .kiln/ directory structure
- AC-05 (LLM): on-session-start rehydrates state from STATE.md correctly
- AC-06 (LLM): on-task-completed runs mini-verify gate

**~4 Tasks:**
1. Write `hooks/hooks.json`:
   - Hook registration for Claude Code
   - on-session-start: triggers `scripts/on-session-start.sh`
   - on-task-completed: triggers `scripts/on-task-completed.sh`
   - Hook event types and trigger conditions
2. Write `hooks/scripts/on-session-start.sh`:
   - Reads .kiln/STATE.md
   - Outputs current phase, step, and pending actions
   - Detects if previous session was interrupted mid-track
   - Provides resume instructions
3. Write `hooks/scripts/on-task-completed.sh`:
   - Mini-verify gate: runs project test suite after each task completion
   - Reads .kiln/config.json for test command
   - Reports PASS/FAIL
   - On FAIL: provides error summary for retry context
4. Write `bin/install.js` (full implementation):
   - Interactive prompts (global vs local install)
   - Detect Claude Code installation
   - Detect Codex CLI availability
   - Copy agents/ -> .claude/agents/ (or merge with existing)
   - Copy skills/ -> .claude/skills/
   - Copy hooks/ -> .claude/hooks/ (or merge with existing hooks.json)
   - Create .kiln/ in project root from templates
   - Update .gitignore (add .kiln/ if not present)
   - Success message with next steps (/kiln:brainstorm)
   - Zero runtime dependencies (use only Node.js built-ins: fs, path, readline)

**Files Created:**
- `hooks/hooks.json`
- `hooks/scripts/on-session-start.sh`
- `hooks/scripts/on-task-completed.sh`
- `bin/install.js` (replace stub from T01)

**Verification:** shellcheck passes on both scripts, `node bin/install.js` works against a temp directory, hooks.json is valid JSON.

---

## Track 10: Integration Test

**Goal:** End-to-end verification that the complete kiln package installs correctly and the slash commands function as designed.

**Acceptance Criteria:**
- AC-01 (DET): `npx kiln-dev` installs into a fresh temp project without errors
- AC-02 (DET): All 11 agent files exist in .claude/agents/ after install
- AC-03 (DET): All 7 skill directories exist in .claude/skills/ after install
- AC-04 (DET): hooks.json is valid and references existing scripts
- AC-05 (DET): .kiln/ directory created with config.json and STATE.md
- AC-06 (LLM): /kiln:init correctly detects a Node.js project's tooling
- AC-07 (DET): `npm pack` produces valid tarball, `npm publish --dry-run` succeeds

**~3 Tasks:**
1. Create integration test script (`tests/integration.sh`):
   - Create temp directory with a sample Node.js project
   - Run `node bin/install.js` against it
   - Verify all files placed correctly (agents, skills, hooks)
   - Verify .kiln/ structure
   - Verify config.json is valid JSON
   - Verify no file references are broken (all referenced scripts exist)
   - Clean up temp directory
2. Validate all cross-references:
   - Every agent that references a skill -> that skill exists
   - Every skill that references a template -> that template exists
   - Every agent's model assignment matches the design spec
   - Hooks reference existing scripts
   - Config template has all required fields
3. Package validation:
   - `npm pack --dry-run` succeeds
   - Tarball contains all required files
   - No dev/build files leaked into package
   - README exists with install instructions
   - `npm publish --dry-run` succeeds (name available or scoped)

**Files Created:**
- `tests/integration.sh`
- `README.md` (package README)

**Verification:** integration.sh exits 0, npm pack succeeds, all cross-references resolve.

---

## Open Questions (Resolve During Execution)

These from the design doc can be resolved JIT as each track is planned:

1. **Hook complexity** (T09): Start with minimum viable (2 hooks). Add more later if needed.
2. **Researcher integration** (T08): On-demand spawning by any agent. No structured trigger points initially.
3. **Max task retries** (T06): Keep at 2 per mini-verify. Tune based on integration testing.
4. **Living doc format** (T08): Structured sections with headers for parsability. Each doc gets a defined schema.
5. **Wave parallelism** (T06): Configurable in config.json, default to 3 concurrent tasks.
6. **Quick mode boundaries** (T03): Heuristic: >3 files OR new dependency OR architectural change = too big.
7. **E2E framework selection** (T07): Match project's existing test framework. Default: Playwright (web), native fetch (API), child_process (CLI).
8. **E2E startup timeout** (T07): Default 30s, configurable per project type in config.json.

---

## Execution Strategy

1. **Build framework:** Avatarme v2 Agent Teams (conductor pattern, task packets, deterministic verification)
2. **Track execution:** JIT planning with dual-model input per track. Conductor manages advancement.
3. **Parallelism:** After T02, run T03/T04/T08 concurrently. Sequential chains where dependencies exist.
4. **Verification per track:** Deterministic gates where possible (shellcheck, npm pack, JSON validation), LLM judgment for prompt quality.
5. **Total estimated tasks:** ~41 across 10 tracks.
6. **Each track gets its own just-in-time detailed task packets** at execution time, following the avatarme v2 task-packet template format.
