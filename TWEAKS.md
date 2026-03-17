# Kiln Tweaks

Post-v9 refinements. Cross-referenced against kilntop TWEAKS.md (v1.0.5, ST15) and v9.1 QA pass.

> **Current version**: v9.1
> **Last updated**: 2026-03-17 (fresh TWEAKS.md from kilntop cross-reference + v9.1 QA)

## Edit Protocol

This file is the single source of truth for Kiln pipeline improvements.

**Task lifecycle**: backlog item -> active task (with `#` and description) -> done -> removed from table after next task promoted.

**Rules**:
- Active Tasks table holds the current sprint. Max ~5 tasks at a time.
- When a task completes: mark **done** in the table, note completion date.
- When promoting from backlog: assign the next available `#`, add a `### Task N` description section, update the table. Remove the backlog entry.
- When adding a new finding: add to the appropriate backlog section with `- [ ]` prefix.
- Every change to the table or task status must update the `Last updated` timestamp above.

## Active Tasks

| # | Task | Status | Blocked by | Updated |
|---|------|--------|------------|---------|
| 1 | Persistent mind handoff protocol | backlog | — | 2026-03-17 |
| 2 | Step timing in STATE.md + omega report table | backlog | — | 2026-03-17 |

### Task 1 — Persistent mind handoff protocol

**Problem**: rakim and sentinel re-read the entire codebase and regenerate state docs from scratch every iteration. By iteration 8, 90% is identical. cliwow: 17 iterations x 60-90s bootstrap = ~17 min of redundant reads.

**Design** (GPT-5.4, 2026-03-17):

Three files, clean ownership:
- `.kiln/docs/iteration-receipt.md` — krs-one writes at END of each iteration (what was scoped, implemented, skipped, QA result). Ground truth for persistent minds.
- `.kiln/docs/rakim-handoff.md` — rakim writes at END of each iteration (codebase delta, deliverable status changes).
- `.kiln/docs/sentinel-handoff.md` — sentinel writes at END of each iteration (pattern/pitfall deltas, test gaps).

**Incremental bootstrap flow** (iteration N+1):
1. Read own handoff.md + iteration-receipt.md (from iteration N)
2. Run `git diff --name-status --find-renames=90% <base_sha>..HEAD`
3. Patch docs incrementally (update delta, not rewrite)
4. Signal READY

**Full bootstrap fallback** (6-check gate — any fail → full):
1. Handoff file exists
2. `<!-- status: complete -->` marker present
3. Schema version supported
4. Base commit exists: `git cat-file -e <sha>`
5. Base is ancestor of HEAD: `git merge-base --is-ancestor`
6. No `force_full_reason` flag set

First iteration always does full bootstrap, writes first handoff at end.

**Files to modify**: rakim.md (handoff write + incremental bootstrap), sentinel.md (same), krs-one.md (iteration-receipt write before ITERATION_UPDATE), SKILL.md (document the protocol).

**Expected savings**: Phase A from 60-90s → 15-20s per iteration. At 17 iterations: ~12 min saved.

### Task 2 — Step timing in STATE.md + omega report table

**Problem**: No visibility into how long each step takes. No timing data in the final report.

**Implementation**:
1. **SKILL.md** — at each step transition, engine writes `step_N_start` and `step_N_end` ISO timestamps to STATE.md alongside existing fields. Trivial addition to the state update the engine already does.
2. **omega.md** — omega reads STATE.md timestamps, computes durations, renders a pipeline timing table in REPORT.md:

```
## Pipeline Timing

| Step | Name | Duration | Started | Ended |
|------|------|----------|---------|-------|
| 1 | Onboarding | 12m 34s | 10:00:00 | 10:12:34 |
| 2 | Brainstorm | 28m 11s | 10:12:40 | 10:40:51 |
| ... | | | | |
| **Total** | | **2h 14m** | | |
```

**Files to modify**: SKILL.md (timestamp writes at transitions), omega.md (timing table in report template).

---

## Backlog

### HIGH — Runtime Bugs & Reliability

- [ ] **Reviewer-builder pair narrowing may break parallel dispatch** — v9.1 QA narrowed obiwan/rick/obscur/verso/yang to list only their canonical paired builders. GPT-5.4 challenged this: broader lists were intentional cross-compatibility so krs-one can dynamically reassign. In cliwow (single-lane), no impact. **In parallel mode, krs-one may assign a builder to a non-paired reviewer and get rejected.** Verify in next parallel build run. If it breaks, revert to broad lists. Files: `agents/obiwan.md`, `agents/rick.md`, `agents/obscur.md`, `agents/verso.md`, `agents/yang.md`.

- [ ] **Resume breaks agent protocol (carried from kilntop)** — After session break and resume, agents abandon protocol and freestyle. Hooks may stop firing. Root cause unknown — could be: (a) hooks not re-loaded on resume, (b) agent_type field lost after context compression, (c) agents lose subagent_type identity. **Critical — #1 blocker for multi-session pipelines.** Not yet observed in v9 but never tested either.

- [ ] **Teardown doesn't actually kill workers (platform quirk)** — TeamDelete refuses active members. Workers spawned then "torn down" keep running and consuming context. Observed in kilntop ST11.5: 3 incorrect workers completed their assignments after teardown. No v9-specific workaround exists.

- [ ] **Hook 4 may block wrong recipients** — KRS-One appeared blocked sending to "team-lead" but hook 4 regex only matches `^(codex|sphinx|morty|rick|luke|obiwan|kaneda|tetsuo|johnny)$`. Either recipient field parsing is wrong or UI showed misleading context. Needs transcript analysis. Carried from kilntop ST10.

### MEDIUM — Performance & Optimization

- [ ] **Persistent mind handoff docs** — rakim and sentinel re-read the entire codebase and regenerate state docs from scratch every iteration. By iteration 8, 90% is identical to iteration 7. Proposal: at end of each iteration, write compact `handoff.md` — what changed, current status, key deltas. Next bootstrap: (1) read handoff.md, (2) `git diff HEAD~1` for ground truth, (3) patch docs incrementally. Expected Phase A reduction from 60-90s to 15-20s.

- [ ] **Rakim bootstrap overhead** — 2.5 min avg x N build iterations adds up. cliwow had 17 iterations = ~42 min of plan-reading. Handoff docs (above) are the fix.

- [ ] **Thoth over-spawning in build** — Spawned every iteration but mostly idle. In kilntop ST15: spawned 4 times, contributed ~4 min of archive work, was idle ~56 min. Consider conditional spawn (only when archive write needed) or persistence across iterations.

- [ ] **Codex utilization (32% active time)** — Only 32% of build step time is active coding (kilntop ST15: 30/93 min). Rest is bootstrap, consultation, review cycles. Strongest argument for persistent builder agents or prewarming.

- [ ] **Engine bootstrap reads still visible** — Partially addressed (resume.md cache, lean fresh/resume). But operator still sees file reads as UI lines before agents spawn. Ideal: banner -> agents spawning, all setup invisible.

- [ ] **Idle notification noise** — 141 events in kilntop ST15 (14.7% of session). krs-one alone = 25. Consider throttling or batching idle voice responses.

### MEDIUM — Missing Features

- [ ] **TeammateIdle watchdog hook** — When all agents idle and engine has a pending action, pipeline stalls. User is the only watchdog. Design: shell script on TeammateIdle event, checks if boss sent expected signal, nudges if not. Safety: `stop_hook_active` prevents infinite loops. Deferred in kilntop (tasklist approach was cleaner) but still no tasklist implementation.

- [ ] **Git worktrees for parallel pairs** — Parallel codex+sphinx and morty+rick in same repo will clobber files. Claude Code's `isolation: "worktree"` is silently ignored when `team_name` is set (tested 2026-03-14). Options: (1) manual worktree via Bash (engine creates, merges branches after), (2) non-overlapping scoping (krs-one ensures no file overlap), (3) staggered pairs. Option 2 is current default but fragile.

- [ ] **Session break advisory** — Large projects will exhaust context. Should advise `/new` after Step 4 and every ~10 build iterations. Resume protocol makes this seamless. Currently SKILL.md enables breaks but doesn't advise timing.

- [ ] **Deployment info capture** — Nobody captures how to serve/open the app. Step 6 (argus) needs this for Playwright validation. Alpha or Da Vinci should note it during onboarding/brainstorm. Carried from kilntop ST10/ST11.

- [ ] **Alpha git init reliability** — Alpha sometimes skips git init on greenfield. sun-tzu needs a git repo for codex exec (Hook 10 blocks --skip-git-repo-check). Make git init unconditional, not behind "if not initialized." Carried from kilntop.

### LOW — Polish & Consistency

- [ ] **Verify agent model assignment at runtime** — kilntop ST16 observation: many agents appeared as "opus 4.6" in UI but should be sonnet. Could be UI display issue (shows parent model) or `model:` frontmatter not respected. Need to check subagent JSONL for actual model used. Cost impact: opus is ~15x sonnet per token.

- [ ] **Coordinator brand vocabulary** — krs-one, aristotle, mi6 read team-protocol.md but not brand.md directly. Voice guidance is embedded in each agent's protocol (implicit). Consider: explicit pointer to brand.md for visual alphabet consistency. Low priority since current output looks fine.

- [ ] **Codex bootstrap-before-inbox** — After spawn, codex bootstraps before reading inbox. KRS-One's assignment is waiting but codex does its own setup first. Wastes a round trip. Different from "acknowledge then ignore" — this is "bootstrap first, read inbox second." Low severity.

- [ ] **Alpha writes pointless greenfield artifacts** — codebase-snapshot.md on greenfield is low-value. Content inventory went into STATE.md instead of a separate doc. Consider: skip codebase-snapshot for greenfield, redirect content to proper doc files.

- [ ] **Enforce-pipeline.sh hook count** — Script header and README claim "17 hooks" but hook 2 was removed and hook 16 never existed. Actually 15 active enforcement checks. Fix the documentation, not the hooks.

---

## v9.1 QA Findings — Already Fixed

For reference, these were found and fixed in commit `5a0abf3` and `394fccf`:

- [x] **Zoxea bootstrap deadlock (H3)** — Phase A agent waited instead of bootstrapping. Would have blocked Step 6.
- [x] **SKILL.md presentation layer unreferenced (H2)** — Engine now loads lore-engine.md and brand.md.
- [x] **Banner format distinction undocumented (H1)** — Two-format design now explicitly documented.
- [x] **Step Transitions table duplicated (M8)** — Single source in lore-engine.md.
- [x] **Resume quotes split (M9)** — Consolidated into lore.json (8 quotes, one pool).
- [x] **Stale resume.md reference** — Fixed (GPT-5.4 catch).
- [x] **Tool list corrections** — plato, omega, thoth, athena, confucius, krs-one.
- [x] **Color standardization** — 9 agents mapped to standard palette.
- [x] **Dead code removal** — anvil, kb.sh, design-qa.md deleted.
- [x] **design-patterns.md wired** — picasso now reads CSS technique reference.
- [x] **Lore dedup** — 4 duplicate quotes resolved, attribution conflict fixed.
- [x] **Model promotions reverted** — sentinel, argus, miyamoto stay sonnet (by design).

## Carried from kilntop — Verified DONE in v9

These kilntop items are resolved and need no further action:

- [x] Symlink banner system replaced with markdown-native (Task 39)
- [x] MI6 goes straight to REQUEST_WORKERS, no READY (Task 32)
- [x] Da-Vinci 12-section VISION template with Section 12 Visual Direction (Task 33)
- [x] Sentinel status marker baked into TL;DR header (Task 34)
- [x] Parallel codex with named pairs — 6 structural + 6 UI agents (Task 30)
- [x] Deep validate — argus uses Playwright for web UIs (Task 31)
- [x] Design cascade — confucius reads Section 12, generates tokens (Task 40)
- [x] Operator plan approval handled by aristotle Phase 6 (Task 16)
- [x] WebFetch 30s HEAD pre-check hook (Task 28)
- [x] Field agent spawn reads team-protocol.md, waits for MI6 (Task 25)
- [x] Interactive greeting after boss spawn (Task 22)
- [x] Lean resume (2-3 turn budget) (Task 23)
- [x] Lean fresh run (3-turn budget) (Task 24)
- [x] Progressive MI6 synthesis (Task 28)
- [x] Alpha codex pre-flight + early fail-loud (Task 26)
- [x] Da-Vinci brainstorm evolution — bmad v6 (Task 27)
