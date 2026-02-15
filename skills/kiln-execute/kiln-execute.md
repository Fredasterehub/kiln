---
name: kiln-execute
description: Execution protocol — sharpening, implementation constraints, mini-verify, retry logic, wave execution rules
---

# Kiln Execute — Execution Protocol

## Sharpening Protocol

Sharpening transforms a task packet from PLAN.md into a Codex-optimized implementation prompt.
The sharpened prompt must be fully self-contained — the implementing model receives ONLY this prompt with zero prior context.

**Input:**
Task packet (goal, acceptance criteria, file hints, dependencies, implementation notes)
from `.kiln/tracks/phase-N/PLAN.md`.

**Process:**
1. Read the task packet from PLAN.md.
2. Explore the CURRENT codebase to gather real context:
   - Use Glob to discover file structure.
   - Use Read to examine key files referenced in the task packet's file hints.
   - Use Grep to find relevant imports, function signatures, class definitions.
3. Construct the implementation prompt embedding:
   - The full task goal and acceptance criteria.
   - Real file paths discovered from codebase exploration (NOT hypothetical).
   - Real function signatures, class names, import paths from the code.
   - Specific patterns from `.kiln/docs/PATTERNS.md` (if it exists).
   - Known pitfalls from `.kiln/docs/PITFALLS.md` (if it exists).
4. Apply the 6 Codex Prompting Guide principles (see next section).
5. Output the sharpened prompt:
   - `preferences.useTeams: false` -> `.kiln/tracks/phase-N/sharpened/<plan-task-id>.md`
   - `preferences.useTeams: true` -> `.kiln/tracks/phase-N/artifacts/<plan-task-id>/sharpened.md` (worker write policy restricts `.kiln` writes to `artifacts/<plan-task-id>/`)

**Sharpened prompt structure:**

```markdown
You are GPT-5.3-codex operating inside the repo at <project-root> (assume zero prior project context). Implement exactly one change: <task goal>.

## Goal
<task goal from packet>

## Acceptance Criteria (must all be satisfied)
<ACs from task packet, verbatim>

## Files to Create/Modify (exact paths)
<real file paths with action: add/modify/delete>

## Current Codebase Context
<actual file contents, function signatures, imports discovered during exploration>

## Implementation Notes
<specific guidance: patterns to follow, imports to use, edge cases to handle>

## Constraints
- Commit handling is mode-dependent:
  - `preferences.useTeams: false` -> executor creates one atomic commit per task
  - `preferences.useTeams: true` -> wave worker does not commit; orchestrator commits after copy-back on main
- No stubs, no TODOs, no placeholder implementations
- No unrelated changes outside the listed files
- If anything is ambiguous, make a reasonable assumption and proceed

## Verification
<commands to run after implementation>
```

## Codex Prompting Guide Principles

Apply ALL 6 principles when constructing sharpened prompts.
These are non-negotiable.

### Principle 1: Autonomy

Let the model gather context, plan its approach, implement, test, and refine autonomously.
Specify WHAT to achieve, not step-by-step HOW.
Give the goal, constraints, and acceptance criteria — let the model figure out the approach.

- GOOD: `Add authentication middleware that verifies JWT tokens and attaches user to request`
- BAD: `Step 1: import jsonwebtoken. Step 2: create a function called authMiddleware. Step 3: call jwt.verify...`

### Principle 2: Bias to Action

Instruct the model to make reasonable assumptions and proceed rather than asking for clarification.
The model should NEVER output questions or request more information.
Include in every sharpened prompt:
`If anything is ambiguous, make a reasonable assumption and proceed. Do NOT ask for clarification.`

- GOOD: `Create the user registration endpoint at POST /api/users`
- BAD: `Consider whether we should add a user registration endpoint`

### Principle 3: Batch Operations

Group related file reads, writes, and tool calls.
Read all relevant files at once.
Batch related changes together.
Structure prompts so the model can see all relevant context upfront rather than discovering it incrementally.

- GOOD: `Add the User model, the user routes (CRUD), and the corresponding tests`
- BAD: `First add the User model... now add the routes... now add tests...`

### Principle 4: Specificity

Use exact file paths (not "the config file").
Use exact function signatures (not "the auth function").
Use exact import paths (not "import the router").
Every reference must be grounded in the actual codebase.

- GOOD: `In src/routes/auth.ts, add a POST handler at /api/auth/login that uses the UserService.findByEmail() method from src/services/UserService.ts`
- BAD: `Add a login endpoint somewhere in the routes`

### Principle 5: Context

Reference what already exists.
Show the model the current state of files it will modify.
Include relevant code from dependencies and callers.
Provide verbatim snippets of existing code that the implementation must integrate with.

- GOOD: `Follow the existing route pattern in src/routes/tasks.ts which uses asyncHandler() wrapper and returns { data, error } response format`
- BAD: `Use good patterns`

### Principle 6: Acceptance Criteria

Every task must have testable success conditions.
Each criterion must be independently verifiable — either by running a command (deterministic)
or by inspecting specific code (LLM judgment).
Include verification commands the model should run after implementation.

- GOOD: `Done when: (1) POST /api/auth/login returns 200 with JWT for valid credentials, (2) returns 401 for invalid password, (3) returns 404 for unknown email`
- BAD: `Make sure it works`

## Implementation Constraints

These constraints apply to ALL task implementations:

1. **Atomic task boundary with mode-specific commit authority.**
   One task maps to one atomic integration commit.
   Commit format: `<phase>/<task-id>: <description>`
   (e.g., `phase-3/P3-T02: add JWT auth middleware`).
   - `preferences.useTeams: false` -> executor creates the task commit directly.
   - `preferences.useTeams: true` -> worker MUST NOT commit in worktree; orchestrator performs copy-back to main and creates the task commit.
2. **No stubs or TODOs.**
   Every function must be fully implemented.
   Banned:
   functions returning null/undefined,
   functions with only console.log/pass,
   components rendering null,
   handlers with only preventDefault,
   functions containing only TODO/FIXME/HACK/XXX comments.
3. **No unrelated changes.**
   Only touch files listed in the task packet.
   No drive-by refactors.
4. **Complete implementation.**
   If the task says "add error handling",
   write real error handling with specific error types.
   Do not do `catch(e) { throw e }` as the only handling.
5. **Test compliance.**
   Implementation must not break existing tests.
6. **One task at a time.**
   Do not pre-build infrastructure for upcoming tasks.

## Mini-Verify Protocol

Mini-verify runs after EVERY task implementation.
It catches failures early.

**Step 1: Run project test suite**
Read `.kiln/config.json` field `tooling.testRunner`.
If present, run that command.
If no test runner is configured, skip this step (log a warning).

**Step 2: Run prior E2E regression tests**
Check if `tests/e2e/` directory exists.
If it does, run all E2E test files using the project's test framework.
If no prior E2E tests exist (early phases), skip this step.

**Step 3: Quick AC check**
For each acceptance criterion in the task packet:
- (DET) criteria: run the verification command and check for pass.
- (LLM) criteria: inspect the relevant code to verify the criterion is met.

**Execution mode notes:**
- `preferences.useTeams: false` -> mini-verify runs in the primary workspace under the executor flow.
- `preferences.useTeams: true` -> mini-verify runs explicitly inside each worker worktree (not via hooks). Worker captures command stdout/stderr under `.kiln/tracks/phase-N/artifacts/<plan-task-id>/...` and reports evidence paths in `TaskUpdate`.

**Result determination:**
- ALL steps pass → PASS → proceed to next task (or next wave).
- ANY step fails → FAIL → trigger retry.

**On FAIL — Retry flow:**
1. Capture error output (test failures, stack traces, exit codes).
2. Append error context to the task packet.
3. Re-sharpen the task with error context included.
4. Re-execute with updated sharpened prompt.
5. Re-run mini-verify.
- Maximum 2 retries per task (3 total attempts).
- After 2 failed retries: HALT — save error context to `.kiln/tracks/phase-N/artifacts/`, update STATE.md with failed status, report to orchestrator.

## Wave Execution Rules

Tasks within a plan are grouped into waves.
Tasks in the same wave are independent and execute in parallel.
Later waves wait for earlier waves to complete.

**Execution order:**
1. Execute all Wave 1 tasks (parallel up to waveParallelism limit).
2. Wait for ALL Wave 1 tasks to pass mini-verify.
3. Execute all Wave 2 tasks.
4. Continue until all waves complete.

**Parallelism:**
Read `.kiln/config.json` field `preferences.waveParallelism` (default: 3).
If a wave has more tasks than this limit, orchestrator must queue excess tasks and run them in deterministic FIFO batches within the same wave. The next wave cannot start until the full current-wave queue is drained.

**Execution mode selector:**
Read `.kiln/config.json` key `preferences.useTeams`:
- `false` (default sequential executor path)
- `true` (Teams wave path with worktrees and orchestrated copy-back)

### Non-Teams Wave Execution (`preferences.useTeams: false`)

This is the existing sequential/non-Teams protocol.

**Per-task cycle:**
Sharpen -> Implement -> Mini-verify -> Commit (if pass).

**Commit responsibility:**
Executor commits each passing task with message format `<phase>/<task-id>: <description>`.

### Teams Wave Execution (`preferences.useTeams: true`)

Teams execution uses one execution team per wave and one worker teammate per task
in that wave.

**Per-task cycle (worker-side):**
Sharpen -> Implement -> Mini-verify -> Emit TaskUpdate.

**Worker assignment and runtime:**
1. Orchestrator creates the wave team (`wave-1`, `wave-2`, ...).
2. Orchestrator spawns one per-task `kiln-wave-worker` teammate.
3. Each worker runs in an isolated worktree at:
   `${KILN_WORKTREE_ROOT:-/tmp}/kiln-<project-hash>/<task-id>/`
4. Worker worktree must include `.kiln` symlink to canonical repo `.kiln`.
5. Worker treats `.kiln/**` as read-only except:
   `.kiln/tracks/phase-N/artifacts/<plan-task-id>/...`

**Commit responsibility (explicit):**
- Workers do NOT commit in worktrees.
- Orchestrator copies back worker outputs into the main workspace, then creates
  the atomic task commit on main.

**Copy-back correctness contract (orchestrator):**
Use both discovery commands from worker root:
```bash
git diff --name-status -z
git ls-files -o --exclude-standard -z
```
Copy-back must preserve rename/delete/add/modify/untracked semantics and exclude
`.kiln/**` except already-written task artifacts under
`.kiln/tracks/phase-N/artifacts/<plan-task-id>/...`.

**Post-wave integration verify (main worktree):**
After recombining all successful worker outputs for the wave, orchestrator runs
integration verify in the main worktree before starting the next wave.
This verifies recombination correctness and cross-task interactions that are not
visible in isolated worktrees.

If post-wave integration verify fails:
- Halt before starting the next wave.
- Generate correction tasks and apply fix-forward correction commits on main (no revert-based rollback of successful task commits).
- Preserve relevant worktrees and evidence artifacts for forensics.
- Re-run integration verify after corrections; do not proceed until it passes.

**Wave failure:**
If ANY task in a wave fails after retries,
HALT the entire execution pipeline.
Do NOT start the next wave.

## Claude-Only Execution

When `.kiln/config.json` has `modelMode: 'claude-only'`:

**Sharpening:**
Opus 4.6 generates the implementation prompt directly (no Codex CLI).
Optimized for Sonnet: more explicit structure, file contents quoted inline,
step-by-step guidance is acceptable.

**Execution:**
Sonnet implements directly as a Claude Code subagent.
No Codex CLI invocation.

**What stays the same:**
Mini-verify runs identically.
Retry limits are identical.
Atomic commit discipline is identical.
Wave execution rules are identical.
The only difference is which models fill the sharpener and implementer roles.
