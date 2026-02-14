# Kiln Architecture Design

**Date:** 2026-02-14
**Status:** Draft — awaiting operator approval
**Location:** `/tank/dump/DEV/kiln/`
**Distribution:** NPM package (`kiln-dev`)

---

## 1. What Is Kiln

Kiln is a multi-model orchestration workflow for Claude Code that transforms ideas into verified, production-quality code. It fuses the best innovations from four systems:

| System | What We Take |
|--------|-------------|
| **BMAD Method** | Deep interactive brainstorming with anti-clustering, facilitation-first persona design |
| **Google Conductor** | Just-in-time planning per track, living docs that propagate constraints forward, workflow-as-data |
| **GSD** | Fresh 200k-token context per task (eliminates context rot), goal-backward verification, pre-execution plan validation |
| **Dual-model baseline** | Multi-model perspective fusion (Claude + GPT), synthesis of competing plans |

**Core metaphor:** Raw ideas enter as clay. Hardened, tested code exits as ceramic — refined by multiple models, verified by deterministic and AI quality gates, and proven by actually running the application.

**Target users:** Solo developers first, scales to small teams (2-5) without breaking.

---

## 2. Design Decisions

These decisions were made during the brainstorming phase and are non-negotiable:

1. **Multi-model is core.** GPT-5.2 and GPT-5.3-codex via Codex CLI are the premium path. Claude-only is a functional fallback that still works well thanks to the other workflow features — but dual-model perspectives are the key differentiator.

2. **Brainstorming is the only interactive phase.** The operator invests time upfront in a deep BMAD-style brainstorming session. Everything downstream is automated, pausing only for lightweight confirmations and failure escalations.

3. **Just-in-time planning per track.** We do NOT plan the entire implementation upfront. Each track (phase) is planned against the current codebase and living docs at execution time. No plan rot.

4. **Fresh context per task.** Each execution task gets a full 200k-token subagent context. The orchestrator stays lean at ~15% budget. Task 1 and task 20 execute at equal quality.

5. **Adaptive verification.** Detect the project's existing tooling (test runner, linter, type checker) and use it. Layer AI goal-backward verification on top. Don't impose a custom verification framework.

6. **GPT-5.2 writes prompts for GPT-5.3-codex.** Same model family understands what the sibling model responds best to. Claude writes prompts for Sonnet in the fallback path.

7. **Runtime verification is mandatory.** Whatever we build, we actually run it and verify it works — not just unit tests, but real user journeys tested against the live application.

8. **NPM distribution.** `npx kiln-dev` to install. Global or local scope. Zero runtime dependencies — the system is structured prompts, agents, and hooks.

---

## 3. Architecture Overview

Three layers:

```
+-------------------------------------------------------------------+
|                        USER INTERFACE                              |
|  6 slash commands. The complexity is behind them.                  |
|                                                                    |
|  /kiln:init  /kiln:brainstorm  /kiln:roadmap                      |
|  /kiln:track  /kiln:status  /kiln:quick                           |
+-------------------------------+-----------------------------------+
                                |
+-------------------------------v-----------------------------------+
|                      ORCHESTRATION LAYER                           |
|  Thin orchestrator (~15% context budget). Manages stage            |
|  transitions, spawns fresh subagents, maintains .kiln/ state.      |
|  NEVER does implementation work. Traffic cop only.                 |
|                                                                    |
|  Model: Opus 4.6 (deep reasoning for routing decisions)           |
+-------------------------------+-----------------------------------+
                                |
+-------------------------------v-----------------------------------+
|                      EXECUTION LAYER                               |
|  Fresh 200k-context subagents per task. Each reads current         |
|  codebase, sharpens prompts, executes, verifies. Model             |
|  selection per role (see Model Routing table).                     |
+-------------------------------+-----------------------------------+
                                |
+-------------------------------v-----------------------------------+
|                       STATE LAYER                                  |
|  .kiln/ directory. All state is files. Git-native.                 |
|  Survives session restarts, context resets, crashes.               |
|                                                                    |
|  .kiln/VISION.md           permanent north star                    |
|  .kiln/ROADMAP.md          high-level phases (directional)         |
|  .kiln/config.json         project settings, model preferences     |
|  .kiln/docs/               living docs (evolve per track)          |
|  .kiln/tracks/phase-N/     per-track plans, state, artifacts       |
|  .kiln/STATE.md            persistent progress tracking            |
+-------------------------------------------------------------------+
```

**Key invariants:**

- The orchestrator never implements. It routes, spawns, and tracks.
- Every subagent gets a fresh context. No context rot.
- All state is files in `.kiln/`. No database, no external service. Git-native.
- Multi-model is the premium path. Claude-only is always functional.

---

## 4. Model Routing

| Role | Multi-model | Claude-only | Why |
|------|------------|-------------|-----|
| Orchestrator | Opus 4.6 | Opus 4.6 | Deep reasoning for routing decisions |
| Brainstormer | Opus 4.6 (interactive) | Opus 4.6 | Facilitation needs deep reasoning |
| Vision Challenger | GPT-5.2-high (Codex CLI) | *skipped* | Fresh eyes on brainstorm output |
| Vision Synthesizer | Opus 4.6 | *skipped* | Merges brainstorm + critique |
| Planner A | Opus 4.6 | Opus 4.6 | Architectural perspective (thorough, security-first) |
| Planner B | GPT-5.2-high (Codex CLI) | *skipped* | Alternative perspective (pragmatic, conventional) |
| Plan Synthesizer | Opus 4.6 | *skipped* | Strategic merge needs deep judgment |
| Plan Validator | Sonnet | Sonnet | Mechanical 7-dimension check |
| Sharpener | GPT-5.2-high (Codex CLI) | Opus 4.6 | Prompt engineer for target model's family |
| Implementer | GPT-5.3-codex-high (Codex CLI) | Sonnet | Code generation |
| E2E Verifier | Sonnet | Sonnet | Test generation + execution (mechanical) |
| Reviewer | Opus 4.6 | Opus 4.6 | Quality gate needs deep reasoning |
| Researcher | Haiku | Haiku | Fast retrieval, on-demand at any stage |

**GPT-5.2 appears in exactly three places:**

1. Vision Challenger — critiques the brainstorm output before finalization
2. Planner B — alternative architectural perspective per track
3. Sharpener — prompt engineer for its sibling model (GPT-5.3-codex)

All three are "GPT talking to GPT" or "GPT challenging Claude" roles where model-family affinity or diverse perspective matters.

---

## 5. Pipeline Stages

### 5.1 INIT (`/kiln:init`)

One-time project setup. Detects what exists, configures kiln.

```
/kiln:init
    |
    +-- Detect project type:
    |   +-- Greenfield (no src/, no package.json) -> minimal config
    |   +-- Brownfield (existing code) -> deep scan
    |   +-- Returning (has .kiln/) -> resume from STATE.md
    |
    +-- Discover existing tooling:
    |   +-- Test runner (jest, pytest, vitest, go test...)
    |   +-- Linter (eslint, ruff, golangci-lint...)
    |   +-- Type checker (tsc, mypy, pyright...)
    |   +-- Build system (npm, cargo, make...)
    |   +-- Start command (npm run dev, python app.py, etc.)
    |   +-- Store in .kiln/config.json -> verification uses these
    |
    +-- Detect Codex CLI availability:
    |   +-- Found + authenticated -> multi-model mode
    |   +-- Not found -> Claude-only mode
    |   +-- Store in .kiln/config.json
    |
    +-- Create .kiln/ directory structure:
        +-- config.json       (tooling, model mode, preferences)
        +-- STATE.md          (progress tracking, empty)
        +-- docs/             (living docs, empty until first track)
```

**Key principle:** Init asks zero questions about workflow preferences. It detects. The only user interaction is confirming the detected configuration.

---

### 5.2 BRAINSTORM (`/kiln:brainstorm`)

The interactive heart. The only stage where the human drives. Everything downstream feeds from this output.

**Phase A: Divergent Exploration**

- Model: Opus 4.6
- Target: 50-100+ ideas before any organization
- Anti-clustering: rotate creative domain every 10 ideas (technical -> UX -> business -> edge cases -> security -> ...)
- Technique library: curated subset of BMAD's 48 techniques picked for highest ROI (SCAMPER, First Principles, Reverse Brainstorming, Six Thinking Hats, Assumption Reversal, etc.)
- Facilitation, not generation: Opus asks probing questions, challenges assumptions, applies frameworks
- "What else?" pressure: actively resist premature convergence

**Phase B: Convergent Structuring**

- Group ideas into themes
- Identify: must-haves vs nice-to-haves vs out-of-scope
- Define: user personas, success metrics, constraints
- Surface: risks, dependencies, unknowns
- Non-goals: explicitly list what we are NOT building

**Phase C: Vision Crystallization (Dual-Model)**

```
Opus drafts VISION.md from interactive brainstorm
    |
    v
GPT-5.2-high CHALLENGE PASS (via Codex CLI)
    Reads draft VISION.md
    "Critique this vision. What's missing? What assumptions
     are unexamined? What risks aren't surfaced? What would
     you add or change?"
    -> vision_critique.md
    |
    v
Opus SYNTHESIS
    Merges original + critique into final VISION.md
    Resolves disagreements, incorporates valid challenges
    -> VISION.md (final draft)
    |
    v
*** HARD GATE: Operator must explicitly approve ***
    +-- APPROVED -> VISION.md written and locked. Proceed.
    +-- REVISE -> back to Phase A/B/C as needed, iterate
    No downstream stage can run without this approval.
```

**VISION.md structured sections:**

- Problem statement
- Solution overview
- User personas
- Success criteria (measurable)
- Constraints and non-goals
- Key decisions made during brainstorm
- Open questions (if any remain)

**VISION.md is immutable after approval.** If the vision changes, re-brainstorm.

---

### 5.3 ROADMAP (`/kiln:roadmap`)

Auto-generated from the approved VISION.md. High-level only.

**Model:** Opus 4.6

```
/kiln:roadmap
    |
    +-- Reads: .kiln/VISION.md (approved)
    |
    +-- Generates ROADMAP.md:
    |   Phase titles + 1-2 sentence descriptions. That's it.
    |   NO subtasks. NO file paths. NO implementation details.
    |   Number of phases is DYNAMIC — determined by the model
    |   based on project scope and complexity.
    |   A CLI tool might get 3 phases. A SaaS platform might get 12.
    |
    +-- Presents to operator for review
    |   Reorder phases? Add/remove phases? Adjust scope?
    |   Operator confirms.
    |
    +-- Output: .kiln/ROADMAP.md
```

**Why this is lightweight on purpose:** Every phase gets its own just-in-time detailed plan when executed. The roadmap sets the order and scope. No plan rot.

---

### 5.4 TRACK (`/kiln:track`)

The main work loop. One command triggers the full automated cycle. The orchestrator loops through all tracks automatically — the operator does NOT need to invoke `/kiln:track` for each phase.

```
/kiln:track
    |
    Picks next incomplete phase from ROADMAP.md
    |
    === TRACK LOOP (auto-advances through all phases) =========
    |
    |   Step 1: PLAN (just-in-time, dual-model)
    |   Step 2: VALIDATE (pre-execution gate)
    |   Step 3: EXECUTE (fresh context per task)
    |   Step 4: RUNTIME VERIFICATION (E2E + regression)
    |   Step 5: CODE REVIEW (comprehensive quality gate)
    |   Step 6: RECONCILE (living docs + roadmap check)
    |   |
    |   Auto-advance -> next phase
    |   (pauses only for reconcile confirmation, failures,
    |    or operator halt)
    |
    ============================================================
    |
    After ALL tracks complete:
    FINAL INTEGRATION E2E (cross-cutting user journeys)
    |
    PROJECT COMPLETE
```

---

#### Step 1: PLAN (just-in-time, dual-model)

Both planners read:
- VISION.md (permanent north star)
- ROADMAP.md (where this phase fits in the whole)
- .kiln/docs/* (living docs — current tech stack, patterns, decisions, pitfalls from ALL prior tracks)
- Actual codebase (what exists RIGHT NOW — files, structure, imports)

```
Planner A (Opus 4.6):
    -> .kiln/tracks/phase-N/plan_claude.md

Planner B (GPT-5.2-high, via Codex CLI):
    -> .kiln/tracks/phase-N/plan_codex.md

[Claude-only mode: single Opus plan, skip synthesis]

Synthesizer (Opus 4.6):
    Merges both plans. Picks cleaner architecture, more thorough
    error handling, more secure approach.
    -> .kiln/tracks/phase-N/PLAN.md (master)
```

PLAN.md contains task packets:
- Each task: goal, acceptance criteria, file hints, dependencies, estimated scope
- Wave grouping for parallel execution (independent tasks in same wave run concurrently)
- Task sizing: 1-5 files per task, one clear goal, sized for a fresh subagent context

**Why dual-model planning is rigorous, not redundant:** The two models genuinely think differently. Opus tends toward thoroughness, edge case coverage, and security-first design. GPT-5.2 tends toward pragmatism, speed, and conventional patterns. The synthesizer picks the best of each — producing a plan better than either alone.

---

#### Step 2: VALIDATE (pre-execution gate)

7-dimension plan check before burning tokens on execution:

1. **Requirement coverage** — does plan address all acceptance criteria from VISION.md for this phase?
2. **Task completeness** — is each task self-contained with clear goal and AC?
3. **Dependency correctness** — does task ordering make sense? Are wave groupings safe?
4. **Scope sanity** — not over-scoped (too ambitious) or under-scoped (missing pieces)?
5. **Context budget** — are tasks sized appropriately for a fresh subagent (~50% context target)?
6. **Verification derivation** — is each acceptance criterion testable/verifiable?
7. **Living doc compliance** — does the plan respect current TECH_STACK, PATTERNS, DECISIONS?

```
PASS -> proceed to Step 3 (Execute)
FAIL -> back to Step 1 with specific feedback about what failed
```

---

#### Step 3: EXECUTE (fresh context per task)

For each task in dependency/wave order:

```
+-- SHARPEN (GPT-5.2-high via Codex CLI) -------------------------+
|                                                                   |
|  Reads: task packet + CURRENT codebase (what actually exists NOW) |
|  Generates: Codex-optimized prompt following the Codex Prompting  |
|  Guide — real file paths, real function signatures, real imports, |
|  bias to action, batch operations, specific acceptance criteria   |
|                                                                   |
|  If task is too large for Codex's sweet spot, sub-divides it     |
|  on the fly into smaller atomic units.                           |
|                                                                   |
|  [Claude-only: Opus generates Sonnet-optimized prompt]           |
+-------------------------------+----------------------------------+
                                |
+-------------------------------v----------------------------------+
|  IMPLEMENT (GPT-5.3-codex-high via Codex CLI)                    |
|                                                                   |
|  Fresh 200k-token context subagent                                |
|  Executes sharpened prompt                                        |
|  Atomic git commit on completion                                  |
|                                                                   |
|  [Claude-only: Sonnet subagent implements]                       |
+-------------------------------+----------------------------------+
                                |
+-------------------------------v----------------------------------+
|  MINI-VERIFY (per-task, lightweight)                              |
|                                                                   |
|  Run project's test suite (detected at init)                      |
|  Including prior tracks' E2E tests (regression)                   |
|  Quick AC check: did this specific task meet its narrow goal?    |
|                                                                   |
|  PASS -> next task (or next wave)                                |
|  FAIL -> re-sharpen with error context -> retry                  |
|          (max 2 retries per task, then halt + report to operator) |
+------------------------------------------------------------------+
```

**Parallel execution:** Independent tasks within the same wave run concurrently as separate subagents. Wave 1 completes before Wave 2 starts.

**Why sharpening is just-in-time:** A prompt for Task 5 written before Task 1 executes would reference files and functions that don't exist yet. By sharpening at execution time, every prompt references the ACTUAL current codebase — including everything prior tasks created. No fictional file paths.

---

#### Step 4: RUNTIME VERIFICATION (E2E + cumulative regression)

**Model:** Sonnet (test generation + execution is mechanical work)

Runs after ALL tasks in the track complete. Actually starts the application and tests it.

**Phase A: Environment Setup**

```
Detect start command from config.json (set at init):
    npm run dev, python app.py, cargo run,
    docker compose up, go run main.go, etc.

Detect project type:
    web-ui, api-server, cli-tool, library, backend-service

Start the application.
Wait for ready signal (port listening, health check,
    stdout marker like "Server started on :3000")

If app fails to start:
    IMMEDIATE FAIL -> captures startup error
    -> correction task: "Application fails to start: [error]"
    -> back to Step 3 (Execute)
```

**Phase B: Test Generation**

```
Reads:
    VISION.md acceptance criteria for this phase
    PLAN.md task acceptance criteria
    Current codebase (routes, components, CLI args)

Generates USER JOURNEY tests, not unit tests:
    NOT: "test that /api/tasks returns 200"
    BUT: "as a user, I can create a task, see it in the list,
         mark it complete, and verify it shows as done"

Each test scenario maps to a specific acceptance criterion.

By project type:
    Web UI:      Playwright (navigate, click, fill, assert visible state)
                 Capture screenshots at each step (audit artifacts)
    API server:  HTTP requests (POST/GET/PUT/DELETE, validate responses)
    CLI tool:    Subprocess (invoke with real args, verify stdout/stderr/exit)
    Library:     Import tests (require/import exports, call with real inputs)
    Backend:     Integration (send messages/events, verify side effects)
```

**Phase C: Test Execution**

```
Run TWO test suites:

1. NEW tests for this track's acceptance criteria
2. ALL prior tracks' E2E tests (cumulative regression)

Collect results per acceptance criterion:
    AC-1: "User can create a task"        PASS
    AC-2: "Task appears in list view"      PASS
    AC-3: "User can mark task complete"    FAIL
          Error: clicking checkbox triggers 500,
          PATCH /api/tasks/:id returns
          "Cannot read property 'status' of undefined"
    AC-4: "Completed tasks show strikethrough" BLOCKED (AC-3 failed)

Regression results:
    Phase 1 E2E: 3/3 PASS
    Phase 2 E2E: 4/4 PASS
    Phase 3 E2E: 5/5 PASS  (prior tracks still work)
```

**Phase D: Teardown + Results**

```
Stop the application
Save test results to .kiln/tracks/phase-N/e2e-results.md
Save screenshots/recordings to .kiln/tracks/phase-N/artifacts/
Commit generated E2E tests to the project:
    tests/e2e/phase-N-*.spec.ts
    (future tracks' mini-verify runs these as regression)
```

**Failure Flow:**

```
E2E Results:
    |
    +-- ALL PASS
    |   -> proceed to Step 5 (Code Review)
    |
    +-- FAILURES FOUND
        |
        +-- Categorize each failure:
        |
        |   TYPE A: Code Bug
        |     "PATCH /api/tasks/:id crashes with TypeError"
        |     -> correction task targeting the specific file/function
        |
        |   TYPE B: Integration Gap
        |     "Frontend calls /api/tasks but endpoint is /api/v1/tasks"
        |     -> correction task to align consumer and provider
        |
        |   TYPE C: Missing Functionality
        |     "No endpoint for marking task complete exists"
        |     -> correction task to implement the missing piece
        |
        |   TYPE D: Environment/Config Issue
        |     "App starts but can't connect to database"
        |     -> correction task for config/setup
        |
        +-- Generate correction task packets:
        |   Each includes:
        |     - The exact failure (error message, screenshot, response body)
        |     - Which acceptance criterion it violates
        |     - Root cause analysis (what file/line is likely responsible)
        |     - What "fixed" looks like (the AC re-stated as done criteria)
        |
        +-- Execute corrections:
        |   Sharpen -> Implement -> Mini-verify (same as Step 3)
        |
        +-- RE-RUN FULL E2E SUITE (not just failed tests)
        |   Why full suite? Corrections might break something that passed.
        |
        +-- Max 3 E2E correction cycles
            After 3 failures: HALT + escalate to operator
            Provide: full test results, all correction attempts,
            screenshots, error logs.
```

---

#### Step 5: CODE REVIEW (comprehensive quality gate)

**Model:** Opus 4.6

Runs ONLY after E2E verification passes. If the app doesn't work, there's no point reviewing code quality.

Reads:
- Full git diff (all tasks in this track combined)
- PLAN.md (what was intended)
- VISION.md (acceptance criteria for this phase)
- Living docs (compliance check)
- E2E results (what was verified working)

Checks:
- **Correctness** — code does what spec says
- **Completeness** — all acceptance criteria met
- **Security** — no injection vulnerabilities, no exposed secrets, no hardcoded credentials
- **Integration** — pieces wire together correctly (imports resolve, APIs consumed properly)
- **Stub detection** — no hollow implementations (components returning null, hardcoded API responses, forms that only preventDefault, fetch calls without response handling)
- **Quality** — clean, readable, follows project patterns from PATTERNS.md
- **No regressions** — existing functionality preserved

```
APPROVED -> Step 6 (Reconcile)

REJECTED -> correction task packets with specific issues
    Each issue: file, line, what's wrong, what to do
    |
    v
    Execute corrections (Sharpen -> Implement -> Mini-verify)
    |
    v
    Re-run E2E (corrections might break runtime behavior)
    |
    v
    Re-review (Opus)
    |
    Max 3 code review correction cycles.
    After 3 failures: HALT + escalate to operator.
```

**Important:** Code review corrections re-trigger E2E verification before the next review pass. This prevents a code review fix from breaking runtime behavior.

**Why corrections don't get dual-model planning:** Corrections are narrow and specific — "fix expired token handling on line 47." The reviewer already identified exactly what's wrong. The Sharpener (GPT-5.2) still optimizes correction prompts for Codex at execution time, so multi-model involvement isn't lost.

---

#### Step 6: RECONCILE (living docs + roadmap check)

**Model:** Opus 4.6

After a track passes both E2E and code review, update the project's living knowledge.

```
Reads: what changed in this track (files created/modified, deps added)

Updates living docs as needed:

  .kiln/docs/TECH_STACK.md
    "Added jsonwebtoken@9.0.0, bcrypt@5.1.0 dependencies"

  .kiln/docs/PATTERNS.md
    "Auth middleware pattern: verify -> extract -> attach to req.user"

  .kiln/docs/DECISIONS.md
    "JWT over sessions: stateless, scales horizontally. Secret via
     env var JWT_SECRET, never hardcoded."

  .kiln/docs/PITFALLS.md
    "bcrypt.compare is async — don't forget to await. Cost factor
     10 is sufficient for MVP, increase for production."

Presents proposed updates to operator for confirmation.
Commits living doc updates.
```

**Roadmap check:**

```
Does the roadmap still make sense given what we learned?
  - Maybe a planned phase is now unnecessary
  - Maybe we discovered a new phase is needed
  - Maybe the order should change

Quick Opus assessment -> operator confirms any changes
Updates ROADMAP.md if needed
```

**State update:**

```
Updates STATE.md: Phase N complete
Auto-advances to Phase N+1 (back to Step 1: Plan)
```

**Why this matters:** When Phase 4 plans, it reads the updated living docs and sees that we use JWT auth (from Phase 3), that bcrypt.compare is async (pitfall from Phase 3), that the middleware pattern is verify->extract->attach. Its plan inherently respects all of this. The project self-corrects without anyone manually propagating constraints.

---

### 5.5 FINAL INTEGRATION E2E

Runs once after ALL tracks in the roadmap are complete. The ultimate quality gate.

**Model:** Sonnet (test generation), Opus (report generation)

```
After the last track's reconcile step:
    |
    +-- Generate CROSS-CUTTING user journey tests
    |   These test flows that span multiple phases:
    |   "User signs up (Phase 3), creates a task (Phase 4),
    |    filters by status (Phase 5), hits rate limit (Phase 6),
    |    sees proper error message"
    |
    |   These journeys could NOT be tested during per-track E2E
    |   because all the pieces weren't in place yet.
    |
    +-- Run the complete E2E suite:
    |   1. All per-track E2E tests (full regression)
    |   2. New cross-cutting integration tests
    |
    +-- On failure:
    |   Correction tasks -> Execute -> Re-run full suite
    |   Max 3 cycles, then halt + escalate
    |
    +-- On success:
    |   Generate FINAL TEST REPORT:
    |     - Total tests: X passed, Y skipped, Z failed
    |     - Per-phase breakdown
    |     - Cross-cutting journey results
    |     - Screenshots/recordings
    |     - Performance observations
    |   Save to .kiln/FINAL_REPORT.md
    |
    +-- PROJECT COMPLETE
```

**The verification pyramid in practice:**

```
                    /\
                   /  \
                  / FI \        Final Integration (cross-cutting journeys)
                 /______\       Runs once, after all tracks
                /        \
               / Per-Track \    Track E2E + cumulative regression
              /   E2E + Reg \   Runs after each track, grows over time
             /______________\
            /                \
           /    Mini-Verify    \  Unit/integration tests per task
          /   (per task, fast)   \ Runs after every single task
         /______________________\
```

Each layer catches different classes of bugs:
- **Mini-verify:** task broke something, tests fail, syntax errors
- **Per-track E2E:** feature doesn't actually work, stubs, integration gaps
- **Cumulative regression:** new track silently broke prior track's functionality
- **Final integration:** cross-phase journeys that only exist when everything's assembled

---

### 5.6 STATUS (`/kiln:status`)

Progress reporting and intelligent next-action routing.

```
/kiln:status
    |
    +-- Reads: STATE.md + ROADMAP.md + current track state
    |
    +-- Displays:
    |
    |   Project: MyApp
    |   Mode: multi-model (Codex CLI detected)
    |
    |   Phase 1: Project scaffolding     [completed]
    |   Phase 2: Core data model         [completed]
    |   Phase 3: Authentication          [in progress] (E2E running)
    |   Phase 4: API endpoints           [pending]
    |   Phase 5: Frontend                [pending]
    |
    |   Living docs: last updated Phase 2
    |   Current track: 1 E2E correction cycle, 0 review corrections
    |   Regression suite: 12 tests (from Phases 1-2)
    |
    +-- Routes to next action:
        "Phase 3 E2E in progress. Run /kiln:track to resume."
        or
        "All phases complete. Final integration E2E pending."
        or
        "Phase 3 halted after 3 correction cycles. Review
         .kiln/tracks/phase-3/e2e-results.md for details."
```

---

### 5.7 QUICK (`/kiln:quick`)

Lightweight mode for small, well-understood changes.

```
/kiln:quick "add a health check endpoint at /api/health"
    |
    +-- Skips: brainstorm, roadmap, dual-model planning
    +-- Single-pass: Opus plans -> Sharpener -> Implementer
    +-- Still gets: adaptive verification, atomic commit, stub detection
    +-- Still runs: existing E2E regression suite (catches regressions)
    +-- Same quality gates on the code itself, less ceremony around it
    |
    +-- For: bug fixes, small features, config changes, one-off tasks
        NOT for: new features, architectural changes, multi-file work
```

---

## 6. Living Documents

These files live in `.kiln/docs/` and evolve across tracks. Each track's reconciliation step can update them. Future tracks read them during planning.

| Doc | Purpose | Example Content |
|-----|---------|----------------|
| `TECH_STACK.md` | What we build with | Languages, frameworks, deps with versions |
| `PATTERNS.md` | How we build | Architecture patterns, naming conventions, file structure |
| `DECISIONS.md` | Why we chose X over Y | Decision records with rationale and context |
| `PITFALLS.md` | What to avoid | Known gotchas, anti-patterns discovered during development |

**How they propagate constraints:** When Track 4 plans, it reads these docs and sees that we switched to SQLite in Track 2, that we use the repository pattern (Track 1), that batch operations should avoid the ORM (Pitfall from Track 3). Its plan inherently respects all of this without anyone manually propagating constraints.

**Budget:** Each living doc has a soft budget (~3000 words) to prevent unbounded growth. Reconciliation replaces outdated entries rather than appending indefinitely.

---

## 7. File Structure

### Project directory (`.kiln/`)

```
.kiln/
+-- config.json                    # detected tooling, model mode, preferences
+-- VISION.md                      # permanent north star (from brainstorm)
+-- ROADMAP.md                     # high-level phases (directional)
+-- STATE.md                       # persistent progress tracking
+-- FINAL_REPORT.md                # generated after final integration E2E
|
+-- docs/                          # living docs (evolve per track)
|   +-- TECH_STACK.md
|   +-- PATTERNS.md
|   +-- DECISIONS.md
|   +-- PITFALLS.md
|
+-- tracks/
    +-- phase-1/
    |   +-- plan_claude.md         # Opus perspective
    |   +-- plan_codex.md          # GPT-5.2 perspective (if multi-model)
    |   +-- PLAN.md                # synthesized master plan
    |   +-- e2e-results.md         # runtime verification results
    |   +-- review.md              # code review output
    |   +-- reconcile.md           # living doc changes log
    |   +-- artifacts/             # screenshots, recordings, logs
    +-- phase-2/
    |   +-- ...
    +-- phase-N/
        +-- ...
```

**Everything in `.kiln/` is committed to git.** The full decision trail is reviewable: vision -> roadmap -> each track's dual plans -> synthesized plan -> E2E results -> review -> living doc updates. Complete auditability.

### NPM package structure

```
kiln/
+-- package.json                   # "kiln-dev" on npm
+-- bin/
|   +-- install.js                 # npx kiln-dev -> interactive setup
|
+-- agents/                        # Claude Code agent definitions
|   +-- kiln-orchestrator.md       # thin traffic cop (Opus)
|   +-- kiln-brainstormer.md       # BMAD-style ideation (Opus)
|   +-- kiln-planner.md            # planning agent (Opus)
|   +-- kiln-codex-planner.md      # GPT-5.2 planning wrapper (Sonnet shell)
|   +-- kiln-synthesizer.md        # dual-plan merge (Opus)
|   +-- kiln-validator.md          # 7-dimension plan check (Sonnet)
|   +-- kiln-sharpener.md          # GPT-5.2 prompt engineer (Sonnet shell)
|   +-- kiln-executor.md           # GPT-5.3-codex wrapper (Sonnet shell)
|   +-- kiln-e2e-verifier.md       # runtime verification (Sonnet)
|   +-- kiln-reviewer.md           # comprehensive quality gate (Opus)
|   +-- kiln-researcher.md         # fast retrieval, on-demand (Haiku)
|
+-- skills/                        # behavioral modules injected into agents
|   +-- kiln-core/                 # universal invariants for all agents
|   +-- kiln-brainstorm/           # brainstorming techniques + anti-clustering
|   +-- kiln-plan/                 # planning format + atomization rules
|   +-- kiln-execute/              # sharpening + implementation constraints
|   +-- kiln-verify/               # adaptive verification + stub detection
|   +-- kiln-e2e/                  # runtime test generation + execution
|   +-- kiln-reconcile/            # living doc update protocol
|
+-- hooks/                         # lifecycle enforcement
|   +-- hooks.json                 # hook registration
|   +-- scripts/
|       +-- on-task-completed.sh   # mini-verify gate
|       +-- on-session-start.sh    # state rehydration from STATE.md
|
+-- templates/                     # initial file templates
|   +-- config.json.tmpl
|   +-- STATE.md.tmpl
|   +-- vision-sections.md         # structured sections for VISION.md
|
+-- README.md
```

**Install flow:**

```bash
npx kiln-dev
# Detects: Claude Code installed? Codex CLI available?
# Asks: global or local install?
# Copies: agents/ -> .claude/agents/, skills/ -> .claude/skills/
# Copies: hooks/ -> .claude/hooks/ (or merges with existing)
# Creates: .kiln/ in project root (if not already present)
# Done. Ready to /kiln:brainstorm
```

---

## 8. Claude-Only vs Multi-Model Paths

Every stage has a clean fallback. The pipeline shape does not change — only which models fill each role:

| Stage | Multi-model | Claude-only |
|-------|------------|-------------|
| Brainstorm | Opus interactive -> GPT-5.2 challenge -> Opus synthesis | Opus interactive only (single perspective) |
| Plan | Opus plan + GPT-5.2 plan -> Opus synthesis | Opus single plan (no synthesis step) |
| Validate | Same (model-agnostic check) | Same |
| Sharpen | GPT-5.2 -> Codex-optimized prompt | Opus -> Sonnet-optimized prompt |
| Execute | GPT-5.3-codex implements | Sonnet implements |
| E2E Verify | Same (model-agnostic) | Same |
| Review | Opus (same either way) | Opus (same) |
| Reconcile | Opus (same either way) | Opus (same) |

**Detection is automatic at init.** If `codex` CLI is on PATH and authenticated, multi-model activates. If not, Claude-only. No configuration needed. The user can also force a mode in `.kiln/config.json`.

---

## 9. End-to-End Example

**Scenario:** Building a task management API from scratch.

```
$ npx kiln-dev                          # Install (one-time)
  Detected: Claude Code v2.x, Codex CLI v0.92
  Mode: multi-model
  Install scope: local
  Done.

$ claude
> /kiln:init                            # Project setup
  Detected: greenfield (no existing code)
  Tooling: none yet (will detect after scaffolding)
  Created .kiln/ directory
  Ready to brainstorm.

> /kiln:brainstorm                      # Deep interactive session
  [30 minutes of BMAD-style facilitation with Opus]
  [100+ ideas explored, clustered, prioritized]
  [Draft VISION.md produced]
  [GPT-5.2 challenge pass: "Missing rate limiting consideration,
   no mention of pagination strategy, auth should support API keys
   not just JWT for service-to-service calls"]
  [Opus synthesizes: incorporates rate limiting, pagination,
   API key auth alongside JWT]
  [Operator reviews and approves VISION.md]

> /kiln:roadmap                         # Generate phases
  Phase 1: Project scaffolding + CI
  Phase 2: Data model + storage
  Phase 3: Authentication (JWT + API keys)
  Phase 4: Task CRUD endpoints
  Phase 5: Advanced features (filtering, sorting, pagination)
  Phase 6: Rate limiting + security hardening
  [Operator confirms]

> /kiln:track                           # Start building (auto-loops)

  === Phase 1: Project scaffolding ===
  [Plan: Opus + GPT-5.2 -> synthesize -> validate]
  [Execute: 3 tasks in 2 waves, fresh context each]
  [Mini-verify: each task passes]
  [E2E: app starts, responds to GET /, returns 200. PASS]
  [Code review: APPROVED]
  [Reconcile: TECH_STACK.md created (TypeScript, Express, Jest)]

  === Phase 2: Data model ===
  [Plan reads: TECH_STACK.md says TypeScript + Express]
  [Plan reads: codebase now has src/app.ts, tsconfig.json]
  [Plans against ACTUAL current state]
  [Execute: 4 tasks]
  [E2E: CRUD operations work, data persists. PASS]
  [Code review: REJECTED - missing index on task.userId]
  [Correction -> re-execute -> E2E re-run: PASS -> re-review: APPROVED]
  [Reconcile: PATTERNS.md updated (repository pattern for data access)]

  === Phase 3: Authentication ===
  [Plan reads: PATTERNS.md says repository pattern]
  [Plans JWT + API key auth per VISION.md]
  [Execute: 5 tasks]
  [E2E: login works, protected routes reject without token,
   API key auth works for service endpoints. PASS]
  [Regression: Phase 1 (3/3), Phase 2 (4/4). All prior tests pass.]
  [Code review: APPROVED]
  [Reconcile: DECISIONS.md updated (JWT for users, API keys for services)]
  [Reconcile: PITFALLS.md updated (bcrypt.compare is async)]

  === Phase 4: Task CRUD endpoints ===
  [Plan reads: all living docs, sees JWT auth, repository pattern]
  [Execute: 4 tasks]
  [E2E: FAIL - "mark task complete returns 500"]
  [Correction: fix TypeError in PATCH handler]
  [Re-run full E2E: Phase 4 PASS, regression (Phases 1-3) PASS]
  [Code review: APPROVED]
  [Reconcile: PATTERNS.md updated (error handling middleware pattern)]

  ... continues through all phases ...

  === All tracks complete ===

  === FINAL INTEGRATION E2E ===
  [Cross-cutting journey: sign up -> create task -> filter ->
   hit rate limit -> see error -> retry after cooldown -> success]
  [Full regression: 28/28 tests pass]
  [Integration tests: 5/5 pass]
  [FINAL_REPORT.md generated]

  PROJECT COMPLETE
  6 phases, 23 total tasks, 2 correction cycles.
  Living docs: 4 documents maintained across all tracks.
  E2E suite: 33 tests covering all acceptance criteria.
  Full audit trail in .kiln/tracks/ and .kiln/FINAL_REPORT.md
```

---

## 10. What Makes Kiln Competitive

| Feature | GSD | BMAD | Conductor | Kiln |
|---------|-----|------|-----------|------|
| Fresh context per task | Yes | No | No | **Yes** |
| Multi-model perspectives | No | No | No | **Yes** |
| Deep brainstorming | Basic discuss | Yes (48 techniques) | Basic Q&A | **Yes (BMAD + dual-model challenge)** |
| Just-in-time planning | Per phase | N/A | Per track | **Yes (per track)** |
| Living docs | STATE.md only | No | Yes (5 docs) | **Yes (4 docs, budget-capped)** |
| Adaptive verification | Partial | No | TDD-focused | **Yes (detect + deterministic + AI)** |
| Runtime verification (E2E) | No | No | No | **Yes (per-track + final integration)** |
| Goal-backward verification | Yes | No | No | **Yes** |
| Stub detection | Yes | No | No | **Yes** |
| Pre-execution plan validation | Yes (7 dims) | No | No | **Yes (7 dims)** |
| Cumulative regression | No | No | No | **Yes (grows per track)** |
| Claude-only fallback | N/A | IDE-agnostic | Gemini-only | **Yes** |
| NPM distribution | Yes | Yes | Yes | **Yes** |

**Kiln's unique position:** It is the only workflow that combines multi-model perspective fusion with fresh-context-per-task execution, just-in-time planning with living document propagation, AND runtime verification that actually runs the application. Each of these features exists in isolation in other tools. Kiln integrates all of them into a single, coherent pipeline.

---

## 11. Open Questions

These can be resolved during implementation planning:

1. **Hook complexity** — How many hooks do we actually need? Minimum viable: `on-session-start` (rehydrate) and `on-task-completed` (mini-verify). Others can be added later.

2. **Researcher agent integration** — When does the researcher get spawned? Current design: on-demand at any stage when an agent needs information. Should it be more structured?

3. **Max task retries in mini-verify** — Currently set at 2 retries per task. Is this enough? Too many?

4. **Living doc format** — Freeform markdown or structured sections with headers? Structured is easier to parse but less flexible.

5. **Wave parallelism limits** — How many parallel subagents per wave? Depends on system resources and API rate limits. Should be configurable in config.json.

6. **Quick mode boundaries** — What exactly qualifies as "too big for quick mode"? Need heuristics (file count, estimated diff size, architectural impact).

7. **E2E test framework selection** — Playwright for web is clear. What about API testing (supertest? raw fetch?), CLI testing (execa? child_process?), library testing (vitest? jest?). Should we detect and match the project's existing test framework?

8. **E2E startup timeout** — How long to wait for the app to start before declaring failure? Should be configurable per project type.
