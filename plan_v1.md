# Kiln v1.0 — Implementation Plan

Decisions log for all QA findings. Each task has a decision and rationale. Implementation follows after all decisions are locked.

**MANDATORY: All implementation agents must preload creatah skill.** Every worker spawned for plan_v1 tasks gets `skills: [creatah]` so they apply trim pass ("every line earns its tokens"), structural validation, and explain-the-why-not-the-what automatically. No exceptions.

---

## Task #14 — NAMING: Tier System Redesign

**Decision:** 3 active tiers. Cosmetic duo naming via per-tier pools in registry. No canonical name collisions.

| Tier | Builder (subagent_type) | Reviewer (subagent_type) | When |
|------|------------------------|-------------------------|------|
| Codex | `codex` | `sphinx` | Default — GPT-5.4 implements via CLI. Always. |
| Sonnet | `kaneda` | `tetsuo` | Fallback when Codex CLI unavailable |
| UI | `clair` | `obscur` | Components, pages, layouts, design token work |

**Removed:** Opus tier (daft+punk). Never used in 22 STs. GPT-5.4 is the implementation model by design choice. daft.md/punk.md kept on disk for future reactivation.

**Cosmetic naming:** Two pools. Name is cosmetic — `subagent_type` handles all real logic. krs-one picks from the matching pool per iteration (don't repeat within a run). Engine spawns with canonical `subagent_type` but injects cosmetic name at spawn. Pools can be any size.

**General pool** (Codex + Sonnet tiers):
codex+sphinx, kaneda+tetsuo, daft+punk, tintin+milou, mario+luigi, lucky+luke, asterix+obelix, athos+aramis, porthos+dartagnan, ...

**UI pool** (UI tier — art/design themed):
clair+obscur, yin+yang, recto+verso, monet+manet, ...

**Name selection:** `pool_index = (build_iteration * 7) % pool_size`. Boss already has build_iteration from STATE.md. Prime multiplier jumps through the pool pseudo-randomly. Zero extra reads, zero tracking, one line of arithmetic. Pool lives in registry file (boss already reads it for tier selection). Main session has zero name logic.

**Pool rules:**
- Only blacklist: infrastructure names (rakim, sentinel, thoth, krs-one, team-lead)
- Canonical pairs are valid picks from their relevant pool

**Implementation:**
- Create `plugins/kiln/skills/kiln-pipeline/references/build-tiers.md` — registry with tier definitions + name pools
- krs-one.md: 3-row tier table + "read registry, pick name from matching tier pool"
- Engine: validates subagent_types against registry
- Hook 17: whitelist from registry (3 builder + 3 reviewer types)
- SKILL.md identity injection: cosmetic name injected at spawn (already exists)

**Rationale:** GPT-5.4 implements by design. Registry makes tiers + names modular. Themed pools give character without collision. Extensible to any number of names or future tiers.

---

## Task #6 — A1: Reviewers missing Bash tool

**Decision:** Add Bash back to sphinx, tetsuo, punk tools list. One-line change per file. Bug introduced by v0.99 Pass 3 over-zealous tool pruning. Reviewers need Bash only for verdict archival (`cat <<EOF > .kiln/tmp/`). No source code access risk — no delegation hooks apply to reviewers.

**Files:** sphinx.md, tetsuo.md, punk.md — change `tools: Read, SendMessage` to `tools: Read, Bash, SendMessage`

---

## Task #7 — G1: Propagate mi6's REQUEST_WORKERS→WORKERS_SPAWNED pattern to all bosses

**Decision:** mi6 is the reference — it explicitly waits for WORKERS_SPAWNED before dispatching assignments. It's the boss that never stalls. Propagate this pattern to all 4 other bosses that send REQUEST_WORKERS.

**The mi6 pattern (line 64):** "Wait for engine to confirm spawns (WORKERS_SPAWNED). Then dispatch assignments individually."

**Files to fix:**
- krs-one.md — add "STOP. Wait for WORKERS_SPAWNED." after REQUEST_WORKERS, before assignment
- aristotle.md — add same after each of its 3 REQUEST_WORKERS (planners, plato, athena)
- mnemosyne.md — add same after REQUEST_WORKERS for scouts
- argus.md — add same after REQUEST_WORKERS for hephaestus

**mi6.md** — already correct, use as reference. Optimize wording if needed for consistency across all 5 bosses.

---

## Task #8 — A2: rm -rf regex — block escape paths only

**Decision:** Replace current regex with escape-path detection (Safety-Net pattern). Block paths that leave the project. Allow in-project cleanup.

**New regex:**
```bash
grep -qE 'rm\s+(-rf|-fr|-r\s+-f|-f\s+-r)\s+(/|~|\$HOME|\$\{HOME|\.\.)'
```

**Blocks:** `/anything`, `~/anything`, `$HOME`, `${HOME}`, `../anything` — all escape the project.
**Allows:** `rm -rf node_modules`, `rm -rf dist`, `rm -rf .next`, `rm -rf ./subdir` — all within project.

**Rationale:** Industry standard (Safety-Net plugin pattern). The axis is "does the path escape the project?" not "what directory name is it?" No allowlists to maintain. Proven across ecosystem.

**File:** enforce-pipeline.sh Hook 12 — replace regex on the rm -rf line

---

## Task #9 — G2: Milestone detection + QA redesign

**Decision:** Two changes:

**A) No race condition — clarify source of truth.** krs-one uses builder report + master-plan for completion detection, NOT rakim's async codebase-state.md. Rakim's update is for the NEXT iteration's bootstrap. Add explicit instruction: "Check deliverables against master-plan.md and the builder's IMPLEMENTATION_COMPLETE report."

**B) Lean milestone QA — integration-focused, not deep.** Replace the vague "read key files, check quality" with 3 concrete checks:
1. Run build command — does project still compile after N iterations?
2. Run test command — do ALL tests pass (not just this iteration's)?
3. Check master-plan deliverables — every item in this milestone marked done?

All pass → MILESTONE_COMPLETE. Any fail → QA FAIL → re-scope fixes.

**Rationale:** researchaih selectah research confirms: independent review (per-iteration reviewer) is the #1 quality lever (7x accuracy, PwC). Milestone QA catches integration drift between iterations. Deep QA (architecture, security, E2E) stays in Step 6 (argus+zoxea). krs-one stays lean — 3 mechanical checks, not subjective file reading.

**C) PostToolUse milestone verification hook.** New lightweight hook: fires on SendMessage when content contains `MILESTONE_COMPLETE`. Checks iter-log.md: last entry has `result: milestone_complete` and `qa: PASS`. Advisory (PostToolUse can't block) — warns engine via stderr if ledger doesn't match the claim. Follows existing pattern (audit-bash.sh, audit-status-marker.sh).

**Files:**
- krs-one.md step 6 — replace "Complete — QA Review" with 3 mechanical checks
- New script: `audit-milestone.sh` — PostToolUse hook for milestone verification
- hooks.json — add PostToolUse matcher for SendMessage

---

## Task #10 — G3: TDD is default behavior, not a flag

**Decision:** Remove `<tdd>true/false</tdd>` from assignment XML. TDD is the default protocol for all builders — not a toggle.

- Builder reads `<test_requirements>` from assignment. If testable behaviors exist → RED→GREEN→REFACTOR. If pure config/scaffolding → implement directly, note "no testable behavior."
- Builder includes `test_requirements: {from assignment}` in REVIEW_REQUEST so reviewer knows what was expected.
- Reviewer checks: if test_requirements present → test files MUST exist in diff. No test_requirements → no test expectation.
- No flag, no toggle. Builder decides gracefully based on assignment content.

**Files:**
- krs-one.md — remove `<tdd>` from assignment XML template
- codex.md, daft.md, kaneda.md, clair.md — remove `<tdd>` flag checks, make TDD the default path. Add `test_requirements` to REVIEW_REQUEST format.
- sphinx.md, tetsuo.md, punk.md, obscur.md — check for `test_requirements` in REVIEW_REQUEST instead of vague heuristic.

**AGENTS.md reinforcement:** Rakim adds "TDD: Write tests first for all testable behavior" to the Conventions section of AGENTS.md. GPT-5.4 auto-discovers this on every invocation — double reinforcement (prompt + project convention).

**TDD reference file:** Create `references/tdd-protocol.md` — full RED→GREEN→REFACTOR steps, edge cases (when nothing is testable, how to handle integration tests, etc.). On-demand only (Tier 3). Zero context cost unless explicitly loaded.

**Wiring:** Each builder agent .md gets one line: "For TDD protocol, read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/tdd-protocol.md`." Same pattern as codex.md's gpt54-prompt-guide reference. Agent owns its references — no engine changes needed.

**Verified:** GPT-5.4 tested with just "Follow TDD" in prompt — wrote tests first, clean implementation, all passing. Reference file is insurance, not a requirement.

**Rationale:** If we believe in TDD it's not optional. The builder is smart enough to know when there's nothing to test. A flag adds complexity for a decision the builder already makes naturally. AGENTS.md reinforces it as project convention.

---

## Task #11 — G4: Align team-protocol.md as Tier 3 reference for kiln-protocol

**Decision:** Keep both — two tiers of the same protocol:
- **kiln-protocol skill** (Tier 2, preloaded) — lean essentials: signals, blocking policy, communication, shutdown. ~2.5KB.
- **team-protocol.md** (Tier 3, on-demand reference) — detailed playbook: dispatch pattern, PM consultation pattern, three-phase spawn, examples.

**Changes to team-protocol.md:**
- Remove "Every boss reads this at startup" — kiln-protocol handles that now
- Remove reply-counting rules that conflict with fire-and-forget policy (section 2)
- Add header: "Detailed reference for kiln-protocol skill. On-demand — bosses read when they need the full playbook."
- Align all messaging rules with blocking-policy.md (boss→PM fire-and-forget, worker→PM consult freely)

**No changes to kiln-protocol skill** — it's already correct and lean.

**File:** team-protocol.md — update header, remove conflicting sections, align with current policy

---

## Task #12 — G5: clair.md missing assignment save

**Decision:** Add assignment XML save step to clair.md, same pattern as codex/daft/kaneda. Saves to `/tmp/kiln_assignment.xml`, extracts ITER for archive paths. One block, consistent with all other builders.

**File:** clair.md — add assignment save block before "Build" section

---

## Task #13 — A5: sentinel non-blocking annotation

**Decision:** Mirror rakim's pattern. Add "Non-blocking" headers and "(Non-blocking — KRS-One continues regardless.)" to sentinel's ITERATION_UPDATE handler. Same change already applied to rakim in Phase 1 — propagate to sentinel for consistency.

**File:** sentinel.md — add non-blocking annotations to ITERATION_UPDATE reply instruction

---

## Task #15 — A9/A10: Thoth upgrade — archival + documentation

**Decision:** Upgrade thoth from haiku to sonnet. One agent, dual duty. Thoth already touches every artifact — it has the full picture. A second agent would re-read everything thoth already processed.

**Archival fixes:**
- Fix STATE.md parsing: `grep -oP '(?<=\*\*stage\*\*: )\S+'` to match actual format
- Add polling loop: scan `.kiln/tmp/` every 30-60s for new files. Eliminates dependency on messages.
- Keep fire-and-forget — no replies, no ACKs

**Documentation duties (new):**
- At milestone boundaries: write `.kiln/docs/milestones/milestone-N.md` — polished summary of what was built
- At build-complete: write/update README.md, CHANGELOG.md, and conditionally api.md/deployment.md
- Source material: the artifacts thoth is already archiving — zero extra reads
- Triggered by: krs-one's existing fire-and-forget "MILESTONE_DONE" message (already sent, thoth just does more with it now). No coordination needed — Claude Code's message queue guarantees thoth finishes processing before reading shutdown_request. Same as rakim/sentinel.

**Documentation reference file:** Create `references/documentation-guide.md` — how to write good READMEs, changelogs, milestone summaries. Tier 3, thoth reads on first doc task.

**Relationship to omega (Step 7):** Omega writes internal build report (metrics, pipeline health). Thoth writes project documentation (user-facing). Different audiences, no overlap.

**Model:** sonnet — good enough for docs, cheap enough for always-on. The delta over haiku for file copies is negligible vs the cost of a second agent re-reading everything.

**Files:** thoth.md — upgrade model, add documentation duties, fix STATE.md parsing, add polling loop

---

## Task #16 — A11: kiln-protocol missing WORKERS_SPAWNED and WORKERS_REJECTED

**Decision:** Add both signals to kiln-protocol's signal table. Two lines. These are live engine signals bosses receive and act on — omitting them is a documentation gap.

**File:** kiln-protocol/SKILL.md — add to signal table:
- `WORKERS_SPAWNED: {names}` — Engine confirms workers on team
- `WORKERS_REJECTED: {reason}` — Engine rejected REQUEST_WORKERS

---

## Task #17 — A6/A8/S1: Stale references cleanup

**Decision:** Three doc-only fixes. No behavior change.

- **enforce-pipeline.sh headers:** `SEQUENCING — hooks 4, 5, 6` → `hooks 4, 5`. `SAFETY — hooks 11, 12, 13` → `hooks 11, 12, 12b`.
- **step-5-build.md:** Update communication model — remove stale krs-one→thoth ARCHIVE messages, replace with "krs-one writes to .kiln/tmp/, thoth archives via self-scan."
- **krs-one.md line 91:** "STATE.md and MEMORY.md writes" → "STATE.md and .kiln/docs/ writes". MEMORY.md writes stay removed — krs-one writes machine-readable iter-log.md, thoth produces human-readable history from it (Task #15 documentation duties).
- **Hook renumbering:** Once all hook decisions final, renumber sequentially 1-N. No more gaps (1, 3, 4, 5, 11, 12, 12b, 14, 15, 17 → clean 1-9).

**Files:** enforce-pipeline.sh (section headers + renumbering), step-5-build.md (communication model), krs-one.md (1 line)

---

## Task #18 — A7/S2: TDD template removal + step numbering fix

**Decision:** Two cleanup items, no design decisions:
- **TDD flag:** Remove `<tdd>true</tdd>` from krs-one assignment XML template (already decided in Task #10 — TDD is default behavior, no flag)
- **Step numbering:** Fix duplicate numbered steps in daft.md, kaneda.md, clair.md (copy-paste artifacts from Phase 4). Renumber sequentially.

**Files:** krs-one.md (remove tdd from XML), daft.md, kaneda.md, clair.md (renumber steps)

---

# Implementation Scoping

## Team Execution Protocol

Fresh team per scope. Three roles. One artifact (plan_v1.md). No ambiguity.

### Composition

| Role | Model | Agent Type | Constraint |
|------|-------|------------|------------|
| **Boss** | Opus | `general-purpose` | NEVER edits files. Reads plan, dispatches, tracks, escalates. |
| **Implementer** | Opus | `general-purpose` | Preloads creatah skill. Edits files. Reports to boss. |
| **Reviewer** | GPT-5.4 | via `codex exec` | Reviews diffs. APPROVED or REJECTED with line citations. |

**Why these models:** Opus boss for reasoning about scope and conflict resolution. Opus implementer for precise agent .md edits (these are prompts, not code — nuance matters). GPT-5.4 reviewer for cross-model blind-spot detection (if Claude wrote it, GPT reviews it).

### Step 0 — Main Session Sets Up Everything

**Platform constraint: Only the main session can spawn agents.** Teammates cannot use the Agent tool — this is a hard Claude Code restriction. The main session (operator) owns all spawning, team creation, and teardown.

Main session does ALL of the following before the boss starts working:

1. **Commit baseline:** `git add -A && git commit` before starting any scope. This ensures `git diff` only shows the current scope's changes — not prior work. Without this, the boss sees unrelated diffs and makes catastrophic decisions (e.g., telling implementer to revert prior work).
2. **Create team:** `TeamCreate("selektah-scope-{x}")`
3. **Create task graph:** One `TaskCreate` per task in the scope
4. **Spawn implementer:** `Agent(name: "implementer", subagent_type: "plan-implementer", team_name: ..., run_in_background: true)` — uses `.claude/agents/plan-implementer.md` which preloads creatah skill. Starts idle, waits for messages.
5. **Spawn boss:** `Agent(name: "boss", team_name: ...)` — starts immediately, reads plan, begins dispatching

The boss prompt must include:
- The implementer's name ("implementer") so it knows who to message
- The scope's task numbers and what to read in plan_v1.md
- The full execution flow (Steps 1-7)
- That it NEVER edits files and NEVER spawns agents
- The git safety rules (Step 3 implementer constraints)

### Step 1 — Boss Bootstraps

Boss reads plan_v1.md top-to-bottom. Extracts:
- The task decisions for the current scope (full text — rationale, files, exact changes)
- The execution protocol (this section)
- Prior scope results (to know what's already done and what patterns to follow)

Boss creates a **task checklist** from the scope's tasks. Example for Scope B:
```
☐ Task #6 — Add Bash to sphinx, tetsuo, punk tools
☐ Task #7 — WORKERS_SPAWNED pattern for 5 bosses
☐ Task #13 — sentinel non-blocking annotation
☐ Task #16 — kiln-protocol WORKERS_SPAWNED + WORKERS_REJECTED signals
☐ Task #11 — team-protocol.md alignment
```

### Step 2 — Boss Dispatches to Implementer

For each task in the checklist, boss sends **one assignment message** to implementer via SendMessage. Then STOPS and waits.

**Assignment format:**

```
TASK: #{number} — {title}

WHAT TO DO:
{Copy the exact decision text from plan_v1.md for this task. Don't paraphrase — the plan has the precision.}

FILES TO EDIT:
{List every file path from the task decision, with the specific changes described.}

REFERENCE FILES TO READ FIRST:
{Any files the implementer should read before editing — e.g., mi6.md as reference for Task #7.}

ACCEPTANCE CRITERIA:
- {Concrete, verifiable checks — e.g., "sphinx.md tools line includes Bash"}
- {One per bullet}

WHEN DONE: Reply with IMPLEMENTATION_COMPLETE and list every file you modified with a one-line summary of what changed.
IF BLOCKED: Reply with IMPLEMENTATION_BLOCKED and explain what's unclear.
```

**Rules for boss assignments:**
- ONE task per assignment. Never batch multiple tasks.
- Copy plan language verbatim for the "what to do" — the plan decisions are precise.
- List every file. The implementer should not need to guess which files to touch.
- Include reference files when the task says "use X as reference" (e.g., mi6.md for Task #7).

### Step 3 — Implementer Executes

Implementer receives the assignment and:

1. **Reads reference files first** — understand the pattern before editing
2. **Reads every target file** — understand current state before modifying
3. **Makes the edits** using Edit tool (prefer surgical edits over full rewrites)
4. **Verifies own work** — re-reads modified files, checks acceptance criteria
5. **Replies to boss**: `IMPLEMENTATION_COMPLETE` with file list and change summary
6. If unclear: replies `IMPLEMENTATION_BLOCKED` with specific question

**Implementer rules:**
- Preload creatah skill — apply trim pass (every line earns its tokens), structural validation
- Stay within scope. Don't "improve" adjacent code. Don't add comments to lines you didn't change.
- If the plan says "one-line change" — it's a one-line change. Trust the plan's precision.
- If the plan says "same pattern as X" — read X first, then replicate exactly.
- **NEVER run destructive git commands.** No `git checkout`, `git reset`, `git clean`, `git restore`, `git stash`. The implementer edits files with the Edit tool only. "Revert" means "edit the lines back to what they were" — NEVER `git checkout -- file`. Git commands destroy ALL uncommitted changes to a file, including prior work from other scopes.
- **Only touch files listed in the assignment.** If a file isn't in FILES TO EDIT, don't touch it.

### Step 4 — Boss Sends to GPT-5.4 Review

After implementer reports IMPLEMENTATION_COMPLETE, boss collects the diff and sends it to GPT-5.4 for review.

**How the boss invokes GPT-5.4 review:**

Boss uses Bash to run codex exec with a review prompt. The boss constructs the prompt, NOT the implementer.

```bash
# 1. Boss collects the SCOPED diff (task files only, never whole repo)
cd /DEV/kiln && git diff -- {file1} {file2} ... > /tmp/kiln_v1_scope_diff.txt

# 2. Boss writes the review prompt via heredoc (not Write tool)
cat <<'REVIEW_EOF' > /tmp/kiln_v1_review_prompt.md
## Task Being Reviewed
Task #{number} — {title}
{One-line summary of what the change should do}

## Acceptance Criteria
{Copy from the assignment}

## Context
{Any relevant rationale from plan_v1.md that the reviewer needs to understand WHY}

## Diff
{paste scoped diff content}

## Constraints
- Only the files listed above should have changed
- Changes must be minimal — no scope creep
- No syntax errors, broken references, or copy-paste artifacts

## Acceptance Criteria
Reply with exactly one of:
- APPROVED: {one-line summary of why it's correct}
- REJECTED: {numbered list of specific issues, each citing the exact file and line}
REVIEW_EOF

# 3. Boss invokes GPT-5.4 via codex exec (see codex-cli skill for full reference)
codex exec -m gpt-5.4 \
  -c 'model_reasoning_effort="high"' \
  --sandbox danger-full-access \
  -C /DEV/kiln \
  < /tmp/kiln_v1_review_prompt.md 2>&1 | tee /tmp/kiln_v1_review_result.txt
```

**Timeout:** Set `timeout: 300000` (5 min) on the Bash call. GPT-5.4 with high reasoning can take time.

**Verification:** `codex exec` exits 0 even on failure. Boss must read `/tmp/kiln_v1_review_result.txt` and confirm it contains an actual APPROVED/REJECTED verdict, not just errors.

Boss reads the review result and proceeds based on verdict.

### Step 5 — Handle Review Verdict

**If APPROVED:**
- Boss marks task complete in its checklist
- Moves to next task in scope (back to Step 2)
- If last task in scope: proceed to Step 7 (Wrap Up)

**If REJECTED (pass 1, 2, or 3):**
- Boss sends rejection feedback to implementer:

```
REVISION NEEDED (pass {N}/3):

GPT-5.4 found these issues:
{Copy the numbered issues verbatim from the review result}

Fix these specific issues using the Edit tool. Do NOT revert files with git commands — edit the specific lines that need changing. Do not change anything beyond the cited issues. Reply IMPLEMENTATION_COMPLETE when done.
```

- Boss STOPS and waits for implementer's fix
- When implementer reports done, boss collects new diff (scoped to task files only), sends to GPT-5.4 again (back to Step 4)
- Track pass count: pass 1, pass 2, pass 3
- **NEVER tell the implementer to "revert all changes" or "start over".** Always cite specific lines to fix.

**If REJECTED on pass 3 — Boss Escalation (Step 6):**

### Step 6 — Boss Resolves Conflicts

After 3 failed review passes, the boss does NOT send to implementer again. Instead:

1. Boss reads the full rejection history (all 3 REJECTED verdicts)
2. Boss reads the current file state
3. Boss reads the plan_v1.md task decision again
4. Boss determines:
   - **If GPT-5.4 is wrong** (rejecting something the plan explicitly calls for): Boss overrides. Mark task complete with note: "GPT reviewer overridden — plan explicitly specifies this approach. Reason: {specific plan reference}."
   - **If implementation is wrong** (implementer keeps missing the point): Boss writes a **precise correction spec** — exact file, exact line, exact old text → new text — and sends to implementer as a final directed fix. One more implement+review cycle (pass 4 — final).
   - **If the plan itself is ambiguous**: Boss STOPS everything and reports to operator: "SCOPE BLOCKED: Task #{N} failed 3 review passes. Core issue: {description}. Need operator decision."

5. If pass 4 also fails: STOP. Report to operator. Do not loop further.

### Step 7 — Wrap Up Scope

When all tasks in the scope are complete:

1. Boss writes a **results block** to plan_v1.md (same format as Scope A results):

```markdown
## Scope {X} — Results

**Status:** COMPLETE (or PARTIAL — list blocked tasks)

| Task | Status | Files Modified | GPT Passes | Notes |
|------|--------|----------------|------------|-------|
| #{N} | Done | `file.md` | 1 | Clean pass |
| #{M} | Done | `file1.md`, `file2.md` | 3 | Fixed: {issue summary} |

**Deviations from plan:** {Any changes from what plan_v1.md specified, with rationale. "None" if clean.}
```

2. Boss sends completion handoff to main session:

```
STATUS: COMPLETE
DECISIONS: {any judgment calls made during execution}
ARTIFACTS: /DEV/kiln/plan_v1.md (updated with results)
CONSTRAINTS: {anything the next scope should know}
NEXT: Execute Scope {X+1}
```

3. Team is torn down. Fresh team for next scope.

### Git Ceremony — Between Every Scope

**This is mandatory. Skipping it caused a near-catastrophic data loss in Scope B run 1.**

The working tree is shared across scopes. Without a baseline commit, `git diff` shows ALL uncommitted changes — the boss sees prior scope work, misattributes it to the implementer, and orders destructive reverts.

**After scope teardown, before next scope:**
```bash
# 1. Review what changed
git diff --stat
git diff                          # spot-check actual changes

# 2. Commit the scope (baseline for next scope)
git add -A
git commit -m "v1.0: Scope {X} — {description}"

# 3. Verify clean state
git status                        # must be clean (or only untracked files)
```

**After committing:** `git diff` returns empty. The next scope's boss will only see its own implementer's changes. This is the invariant that makes scoped review work.

**If something went wrong:** `git diff` before committing lets the operator inspect and selectively stage. Never blindly `git add -A` if the scope had issues — review first.

### Operator Responsibilities Between Scopes

After each scope completes, the operator (main session):

1. **Reads the results block** in plan_v1.md — verify it matches expectations
2. **Spot-checks changes** — `git diff` on key files, especially if GPT needed 3 passes
3. **Runs git ceremony** — commit scope, verify clean state (see above)
4. **Decides whether to proceed** — if partial/blocked, resolve before next scope
5. **Invokes next scope** — back to Step 0

### Team Teardown — Clean Shutdown

After scope completion OR when restarting due to issues:

1. **Send shutdown_request to each agent by name** (not broadcast — one at a time):
```
SendMessage(to: "{name}", message: {"type": "shutdown_request", "reason": "Scope complete"})
```
2. **Wait for shutdown_response** from each agent. If an agent doesn't respond after 2 attempts:
   - Send a plain text message telling it to approve the shutdown with the exact request_id
   - If still no response after 30s: force cleanup (step 4)
3. **Confirm all agents terminated** — check for teammate_terminated system messages
4. **Delete team:** `TeamDelete()`. If it fails ("active members"), force delete:
```bash
rm -rf ~/.claude/teams/selektah-scope-{x} ~/.claude/tasks/selektah-scope-{x}
```
Then run `TeamDelete()` to clear session state.

**Every agent prompt MUST include shutdown instructions.** Agents without explicit shutdown handling will ignore shutdown_request and go idle forever. Include this block in every agent prompt:
```
## SHUTDOWN
When you receive a message with type "shutdown_request", immediately respond:
SendMessage(to: "team-lead", message: {"type": "shutdown_response", "request_id": "{id from request}", "approve": true})
```

### Team Restart — When Things Go Wrong

If the boss stalls, gets interrupted, or agents misbehave:

1. **Teardown** the current team (full procedure above)
2. **Check git state** — `git diff` to see if any partial work was done. If good partial work exists, keep it. If broken, `git checkout -- .` the affected files.
3. **Check task progress** — note which tasks completed before the failure
4. **Recreate team** — full Step 0 again (TeamCreate, TaskCreate, spawn implementer, spawn boss)
5. **Tell the new boss what's already done** — include in the boss prompt: "Tasks #X and #Y are already complete. Start from Task #Z."

**Do NOT reuse stale agents.** Always spawn fresh. Stale agents have corrupted context from the failed run.

### Rules That Apply to Every Scope

1. **Boss never edits files.** Zero exceptions. If the boss touches Edit/Write tools, something is wrong.
2. **One task at a time.** Boss dispatches task, waits for completion + review, then next task. No parallel dispatch within a scope.
3. **Plan is law.** The task decisions in plan_v1.md are locked. Implementer follows them. Reviewer checks against them. Boss enforces them. If a decision turns out wrong, operator updates the plan — not the team.
4. **Creatah mandatory.** Implementer preloads creatah for trim pass and structural validation on every edit.
5. **Minimal diffs.** If the plan says "add one line" the diff should be one line. Reviewers reject scope creep.
6. **Cross-model review is the quality gate.** GPT-5.4 catches what Claude misses. This is the whole point of the reviewer role.
7. **Escalation has a ceiling.** Max 4 total passes (3 + 1 boss-resolved). After that, human decides.
8. **Results go in plan_v1.md.** The plan is both the spec and the ledger. Everything is in one file.
9. **Baseline commit before every scope.** Main session commits all prior work so `git diff` only shows current scope changes. Without this, the boss sees unrelated diffs and panics.
10. **No destructive git commands. Ever.** Implementer uses Edit tool only. Boss uses `git diff -- {files}` (scoped to task files) for review. Nobody runs `git checkout`, `git reset`, `git restore`, or `git clean`. These destroy prior work that shares the working tree.
11. **Diff is scoped to task files.** Boss collects `git diff -- file1 file2` not `git diff`. This prevents the boss from seeing unrelated changes and misattributing them to the implementer.

## Scopes (Sequential)

### Scope A — New Files + Registry
Tasks: #14 (build-tiers.md registry), #10 partial (tdd-protocol.md), #15 partial (documentation-guide.md), #9 partial (audit-milestone.sh)
**Why grouped:** All are NEW files. No merge conflicts. Clean creation.

### Scope B — Protocol Alignment
Tasks: #6 (reviewer Bash), #7 (WORKERS_SPAWNED pattern for 5 bosses), #13 (sentinel non-blocking), #16 (kiln-protocol signals), #11 (team-protocol.md alignment)
**Why grouped:** All protocol/communication fixes. Touch agent .md files and kiln-protocol skill. Related concerns.

### Scope C — krs-one Rewrite
Tasks: #14 partial (tier section rewrite + registry read + name formula), #9 (milestone QA redesign), #10 partial (remove tdd flag, add test_requirements), #18 partial (remove tdd from XML)
**Why grouped:** All krs-one.md changes. One coherent rewrite pass, not 4 separate edits.

### Scope D — Builder + Reviewer Fixes
Tasks: #10 partial (TDD default in builders, test_requirements in REVIEW_REQUEST), #12 (clair assignment save), #18 partial (step renumbering), TDD reference line in all builders
**Why grouped:** All builder/reviewer agent .md changes. Consistent patterns across 4 builders + 4 reviewers.

### Scope E — Hooks + Enforcement Cleanup
Tasks: #8 (rm-rf regex), #17 partial (enforce-pipeline headers + renumbering), #9 partial (hooks.json PostToolUse for audit-milestone.sh)
**Why grouped:** All enforce-pipeline.sh + hooks.json changes. One clean pass.

### Scope F — Thoth Upgrade + Docs
Tasks: #15 (thoth model upgrade, polling loop, STATE.md parsing, documentation duties)
**Why grouped:** Single agent rewrite. Self-contained.

### Scope G — Stale References
Tasks: #17 partial (step-5-build.md comms model, krs-one MEMORY.md line)
**Why grouped:** Doc-only cleanup. Quick final pass.

---

## Scope A — Results

**Status:** COMPLETE. All 4 files created.

| File | Status | Notes |
|------|--------|-------|
| `references/build-tiers.md` | Created | 3 tiers, 2 name pools, selection formula, blacklist. Opus tier removed by design (later scopes update SKILL.md, step-definitions, enforce-pipeline). |
| `references/tdd-protocol.md` | Created | RED/GREEN/REFACTOR, when to apply/skip, integration tests, 4 rules. Tier 3 on-demand. |
| `references/documentation-guide.md` | Created | README, CHANGELOG, milestone summary formats. Conditional files table. Style guide. Tier 3 on-demand. |
| `scripts/audit-milestone.sh` | Created | PostToolUse hook for SendMessage. Context gate + krs-one agent filter + iter-log last-entry parsing. |

**GPT-5.4 review:** 3 passes.
- Pass 1 REJECTED: (a) build-tiers contradicts live pipeline — by design, later scopes fix those files; (b) pool size coprime note missing; (c) iter-log grepped last 20 lines instead of last entry block.
- Pass 2 REJECTED: coprime note said "avoid 7 or 14" instead of "any multiple of 7".
- Pass 3 APPROVED.

**Deviations from plan:** None. All content matches plan_v1.md specifications.

---

## Scope B — Results

**Status:** COMPLETE. All 5 protocol alignment tasks done.

| Task | Status | Files Modified | GPT Passes | Notes |
|------|--------|----------------|------------|-------|
| #6 — Reviewer Bash tool | Already done | `sphinx.md`, `tetsuo.md`, `punk.md` | 0 | All 3 files already had `tools: Read, Bash, SendMessage` in baseline |
| #7 — WORKERS_SPAWNED pattern | Done | `krs-one.md` | 1 | aristotle, mnemosyne, argus already had the pattern. Only krs-one needed the addition |
| #13 — sentinel non-blocking | Done | `sentinel.md` | 1 | Added non-blocking annotation + reply wording to match rakim's pattern |
| #16 — kiln-protocol signals | Done | `kiln-protocol/SKILL.md` | 1 | Added WORKERS_SPAWNED and WORKERS_REJECTED to signal table |
| #11 — team-protocol alignment | Done | `team-protocol.md` | 2 | Pass 1 rejected: bootstrap self-ref + missing shutdown_response. Pass 2 approved |

**GPT-5.4 review:** 4 tasks reviewed (Task #6 skipped — already done). All approved. Task #11 needed 2 passes.

**Deviations from plan:**
- Task #6: No changes needed — files already had Bash in tools list (likely fixed in a prior session).
- Task #7: Only krs-one.md needed the change (3 of 4 target files already had the pattern). Plan said fix all 4 — 3 were already correct.
- No other deviations. All changes match plan_v1.md specifications.

---

## Scope C — Results

**Status:** COMPLETE. krs-one.md rewritten — 4 tasks, one coherent pass.

| Task | Status | Files Modified | GPT Passes | Notes |
|------|--------|----------------|------------|-------|
| #14 partial — Tier rewrite + registry + formula | Done | `krs-one.md` | 2 | Pass 1 rejected: REQUEST_WORKERS example still used Opus tier (daft/punk). Fixed line 115 to codex/sphinx. |
| #9 — Milestone QA redesign | Done | `krs-one.md` | 1 | Clean pass. Source of truth → master-plan.md + builder report. 3 mechanical checks. |
| #10 partial — Remove tdd flag | Done | `krs-one.md` | 1 (override) | GPT reviewer saw cumulative diff and false-positived on prior approved changes. Override: scoped diff correct. |
| #18 partial — Remove tdd from XML | Already done | — | 0 | Identical to Task #10 partial — tdd already removed. No changes needed. |

**Deviations from plan:**
- Task #14: REQUEST_WORKERS example (line 115) was not listed in plan as needing update, but GPT-5.4 correctly caught that daft/punk subagent_types became invalid after Opus tier removal. Fixed.
- Task #10/18 overlap: Both tasks specified removing `<tdd>` from krs-one XML. Task #10 did the work; Task #18 was a no-op.
