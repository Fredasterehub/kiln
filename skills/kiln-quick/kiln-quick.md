---
name: kiln-quick
description: Lightweight single-pass mode for small, well-understood changes
user_invocable: true
---

# /kiln:quick — Quick Mode

## Overview

Quick mode is for small, well-understood changes where the full kiln pipeline is overkill. The user provides a natural language description of the change and kiln handles it in a single pass.

**Usage:** `/kiln:quick \"add a health check endpoint at /api/health\"`

**What quick mode SKIPS:**
- Brainstorming session (no VISION.md needed)
- Roadmap generation (single task, no multi-phase planning)
- Dual-model planning (no GPT perspective, no plan synthesis)
- Plan validation (single task doesn't need 7-dimension validation)
- Living doc reconciliation (small changes rarely affect architecture)

**What quick mode KEEPS:**
- Opus planning (single focused plan with clear acceptance criteria)
- Prompt sharpening (Sharpener optimizes the implementation prompt)
- Implementation (fresh subagent executes the change)
- Mini-verify (project test suite runs after implementation)
- Existing E2E regression (all prior tracks' E2E tests run — catches regressions)
- Atomic git commit (change is committed as a single unit)
- Stub detection (no hollow implementations, even in quick mode)

**Same quality gates on the code itself, less ceremony around it.**

## Prerequisites

Before starting quick mode, verify kiln is initialized:
1. Check if `.kiln/` directory exists. If not: print 'Kiln is not initialized for this project. Run /kiln:init first.' and stop.
2. Check if `.kiln/config.json` exists and is readable. If not: print 'Kiln configuration missing or unreadable. Run /kiln:init to reinitialize.' and stop.

Run these checks from the project root.
Treat missing required files as blocking.
Never crash on missing prerequisites.

Prerequisite execution order:
1. Validate `.kiln/` exists.
2. Validate `.kiln/config.json` exists and is readable.
3. Continue to scope guard.

## Scope Guard

Before starting quick mode, evaluate whether the requested change is appropriate. Quick mode is designed for small changes. If the change is too big, redirect the user to the full pipeline.

**Heuristics for 'too big for quick mode'** — if ANY of these are true, reject and suggest full pipeline:

1. **File count > 3:** The change would likely touch more than 3 files. Quick mode targets surgical changes.
   - Example that's OK: 'Fix the null check in UserService.ts' (1 file)
   - Example that's too big: 'Add user authentication to the app' (auth middleware, routes, models, UI — 5+ files)

2. **New dependency required:** The change requires adding a new package/library dependency.
   - Example that's OK: 'Fix the date formatting bug' (uses existing deps)
   - Example that's too big: 'Add WebSocket support' (needs ws or socket.io package)

3. **Architectural change:** The change affects the application's architecture, patterns, or conventions.
   - Example that's OK: 'Add a GET /api/health endpoint' (follows existing route pattern)
   - Example that's too big: 'Refactor from REST to GraphQL' (architectural shift)

4. **New user-facing feature:** The change introduces a wholly new feature that users interact with.
   - Example that's OK: 'Fix the submit button not working on the login form' (bug fix)
   - Example that's too big: 'Add a dashboard page with charts' (new feature)

5. **Database schema change:** The change requires modifying database tables, migrations, or data models.
   - Example that's OK: 'Fix the query that returns stale data' (query fix)
   - Example that's too big: 'Add a comments table with foreign keys to posts and users'

**When rejecting:** Print:

```
This change appears too large for quick mode:
  Reason: <which heuristic triggered>

Quick mode is for: bug fixes, small tweaks, config changes, one-off tasks.
Full pipeline is for: new features, architectural changes, multi-file work.

Recommendation: Run /kiln:brainstorm to plan this properly.
```

**When approving:** Proceed to the quick mode pipeline.

## Pipeline

The quick mode pipeline has 5 steps. Each step is executed in sequence.

### Step 1: Plan (Opus, single-pass)

The orchestrator (or the agent executing this skill) creates a focused plan:
- Read the user's description
- Read the current codebase (relevant files based on the description)
- Read `.kiln/config.json` for tooling info
- Read `.kiln/docs/*` living docs if they exist (respect existing patterns)
- Produce a single task packet with:
  - Goal: the user's description, sharpened into a specific objective
  - Acceptance criteria: 1-3 concrete, testable criteria
  - File hints: which files will likely be touched (1-3 files max)
  - Implementation notes: specific guidance based on codebase reading

This is NOT a full PLAN.md — it's a single inline task. No file is written to .kiln/tracks/.

### Step 2: Sharpen

Read `.kiln/config.json` for `modelMode`:

**Multi-model mode:** Spawn the kiln-sharpener agent with the task packet. The sharpener uses GPT-5.2 via Codex CLI to produce a Codex-optimized implementation prompt with real file paths, real function signatures, and specific acceptance criteria.

**Claude-only mode:** The Opus orchestrator generates a Sonnet-optimized prompt directly. Include:
- Exact file paths to modify
- Current function signatures and imports
- What to change and why
- Acceptance criteria restated as done-criteria

### Step 3: Implement

**Multi-model mode:** Spawn the kiln-executor agent, which invokes GPT-5.3-codex via Codex CLI with the sharpened prompt. Atomic git commit on completion.

**Claude-only mode:** Spawn a Sonnet subagent with the sharpened prompt. Atomic git commit on completion.

### Step 4: Mini-Verify

After implementation completes:
1. Run the project's test suite (from `.kiln/config.json` `tooling.testRunner`):
   - If testRunner is not null: run the test command (e.g., `npm test`, `pytest`, `cargo test`)
   - If testRunner is null: skip test suite (no tests configured)
2. Run existing E2E regression tests (if any exist from prior full-pipeline tracks):
   - Glob for `tests/e2e/**/*.spec.*` or similar
   - If found: run them to ensure the quick change didn't break prior functionality
3. Check for stubs and incomplete implementations:
   - Scan the git diff for: functions returning null/undefined without logic, TODO/FIXME comments, hardcoded mock data, empty catch blocks, console.log-only functions

**On pass:** Proceed to Step 5.
**On fail:** One retry with error context appended to the sharpened prompt. If retry also fails: HALT and report to user.

### Step 5: Report

Print a completion summary:

```
/kiln:quick completed successfully.

Change: <user's description>
Files modified: <list of files>
Tests: <passed/skipped>
Regression: <passed/skipped/N tests>
Commit: <git commit hash>

The change has been committed. Review with 'git diff HEAD~1' if needed.
```

If there are no tests configured, add: 'Note: No test runner configured. Consider adding tests and running /kiln:init to update tooling detection.'

## State Tracking

Quick mode does NOT update STATE.md or create .kiln/tracks/ directories. Quick changes are tracked only via git history. This keeps the state layer clean — quick changes are surgical interventions, not tracked phases.

However, if living docs exist, the quick mode change should still respect them. Read .kiln/docs/PATTERNS.md and .kiln/docs/DECISIONS.md during the planning step to ensure the change follows established project conventions.

## Examples

Good candidates for /kiln:quick:
- `/kiln:quick \"fix the null reference error in UserService.getById\"`
- `/kiln:quick \"add CORS headers to the Express middleware\"`
- `/kiln:quick \"update the README with the new API endpoint\"`
- `/kiln:quick \"change the default timeout from 5s to 30s in config\"`
- `/kiln:quick \"fix the typo in the error message on line 42 of auth.ts\"`

Bad candidates (redirect to full pipeline):
- `/kiln:quick \"add user authentication\"` → Too big (architectural, multi-file, new deps)
- `/kiln:quick \"build a dashboard\"` → New feature (needs brainstorming)
- `/kiln:quick \"refactor the database layer\"` → Architectural change (needs planning)
- `/kiln:quick \"add real-time notifications\"` → New dependency + multi-file
