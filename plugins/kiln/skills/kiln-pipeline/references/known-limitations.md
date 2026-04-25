# Known Limitations

Operator-facing reference for upstream Claude Code limitations Kiln cannot work around AND for Kiln-internal contracts and process lessons learned from past stalls. Read in documentation posture — no agent prompt loads this at runtime; the audience is an operator debugging a stall, judging whether a misbehavior is upstream or in-Kiln, or deciding how to run a long autonomous pipeline.

## Terminal Focus Stall

### Symptom

A Kiln pipeline appears to freeze when the terminal window loses focus (operator switches to another application), then resumes on its own the moment focus returns — without any prompt, keystroke, or hook fire from the operator. The pipeline is making no progress between the unfocus and the refocus, yet no Kiln deadlock nudge is emitted and no `DEADLOCK.flag` is written.

### Root cause

Tracked upstream as **`anthropics/claude-code#25068`** — Claude Code sessions can stall during long independent operations and resume only on new TTY input. Terminal focus-in events (xterm escape sequence `\e[I`) register as low-level TTY input under many terminal emulators, which is why refocusing alone wakes the session even without a keystroke.

Compounding factor: the server-sent events (SSE) idle timeout defaults to 5 minutes (`CLAUDE_STREAM_IDLE_TIMEOUT_MS=300000`). When an SSE stream aborts and retries, the retry can race with the focus wake-up, which is why the stall sometimes looks like it "recovers on its own" after a few minutes even without operator input.

### Why the old watchdog could not help

The original detached watchdog (`watchdog-loop.sh` + `deadlock-check.sh`) delivered nudges through a two-step indirection: write `.kiln/tmp/pending-nudge.json`, then wait for the next hook fire to consume it via `nudge-inject.sh`'s `additionalContext` injection. For a teammate stall (teammate still active after SubagentStop), the `TeammateIdle` native exit-2 path handles it directly — no hook indirection needed.

The terminal-focus class of stall is neither: the stalled party is the main engine session itself, and the main session may not fire ordinary hooks while stalled. Under the old delivery path, every nudge the watchdog wrote sat in `pending-nudge.json` undelivered. When focus returned, the first hook fire after refocus consumed the most recent nudge — but the session was already going to resume from the focus event, so the nudge arrived after the stall had self-resolved.

### Kiln-side mitigation

Kiln now also starts `async-rewake-watchdog.sh` as a Claude Code `asyncRewake` hook. It reuses the same deadlock rule as `deadlock-check.sh`, but exits 2 when a nudge is staged. Claude Code documents this as the native way for an async hook to wake Claude immediately even when the session is idle. This is a bandaid, not an upstream fix: it can wake the engine after the deadlock threshold, but it cannot make terminal focus independent orchestration immediate.

### Operator mitigations

If async rewake still misses a stall in your terminal / Claude Code version, use one of these options, in rough order of preference:

1. **`claude -p` for autonomous runs.** Non-interactive mode doesn't depend on TTY input to stay alive, so terminal focus is irrelevant. This is the right mode for overnight or untended pipelines and is what the Kiln design target has always assumed.

2. **`claude --worktree <name>` for parallel isolated work.** Each worktree runs in its own session; losing focus on the outer terminal doesn't stall the worktree's internal loop. Useful when you want to kick off a Kiln run and keep working elsewhere in the same repo.

3. **Bump the SSE idle timeout.** Set `CLAUDE_STREAM_IDLE_TIMEOUT_MS=600000` (10 minutes) or higher in your shell env before launching `claude`. Doesn't fix the focus-stall class, but reduces SSE-retry churn during long independent operations, which is the compounding factor.

Remote Control mode (for server / CI runs) is a fourth option when available in your setup, and has the same non-TTY posture as `claude -p`.

### What NOT to do

- Do **not** file this as a plain Kiln protocol deadlock bug unless `async-rewake-watchdog.sh` also failed to emit a wake after the deadlock threshold. The root focus dependency is upstream; Kiln's role is bounded recovery.
- Do **not** try to work around the stall with operator-side nudges (keyboard activity in the terminal, shell bells, etc.) — they will work, but they're slower and less deterministic than the async rewake bridge or `claude -p`.
- Do **not** lower the deadlock threshold aggressively. A too-fast rewake creates model churn during legitimate long thinking. If tuning is needed, prefer measured changes to the shared deadlock rule, not terminal-specific key injection.

### Upstream status

GitHub `anthropics/claude-code#25068` remains open as of the v1.5.3 hooks consolidation. When it is resolved in a Claude Code release, the `claude -p` / `--worktree` / env-tuning mitigations above become unnecessary and this section can be narrowed to a historical note.

## Dormant Teammates Are Alive

### Symptom

Pre-v1.5.7, the watchdog could declare deadlock with a nudge that read "active teammates: none" while teammates were in fact alive and waiting for a message. The boss read this as ground truth and acted on phantom teammate death — escalating, requesting fresh workers, or filing BLOCKED — even though the existing teammates were dormant-but-tracked. The benoit M9-C2 stall (2026-04-24, freeze ~22:43-23:55Z) is the canonical occurrence.

### Root cause

`activity-update.sh` removed teammates from `.kiln/tmp/activity.json` `active_teammates` on `TeammateIdle`, conflating "actively working in this turn" with "alive". The deadlock rule then keyed on empty `active_teammates` as a 4th precondition, so two contracts said the same wrong thing in different surfaces. A teammate that was correctly waiting for a reply looked dead to the watchdog, and the boss inherited that misdiagnosis through the nudge text.

### Post-v1.5.7 contract

`TeammateIdle` is heartbeat-only — it bumps `last_activity_ts` and `last_activity_source`, but does not remove from `active_teammates`. `SubagentStop` is the sole removal path. The deadlock rule reduced to three conditions: `idle > 300s` AND `since_nudge > 600s` AND `pipeline_phase` not in `{idle, awaiting_user, complete}`. The watchdog nudge text became diagnostic ("idle_seconds=N, last_activity_source=X, active_teammates=…") rather than prescriptive; the boss reads facts about the stall, not a verdict about teammate death.

### What NOT to do

- Do not reintroduce a `TeammateIdle` removal path. Dormant-vs-dead is the distinction that makes the deadlock detector usable in long autonomous runs; collapsing the two false-fires the watchdog every time a teammate is correctly waiting on a message.
- Do not interpret "active_teammates: none" as evidence of agent death. Under the v1.5.7 contract that string can only mean every spawned subagent has cleanly exited via `SubagentStop` — and even then it is a precondition observation, not a diagnostic finding about why the pipeline is silent.

### References

- `plugins/kiln/skills/kiln-pipeline/references/deadlock-detection.md` — schema row + 3-condition rule.
- `plugins/kiln/hooks/activity-update.sh`, `deadlock-check.sh`, `teammate-idle-feedback.sh` — implementation.
- v1.5.7 Scope A handoff: `.kiln-dev/v157/scope-a-handoff.md`.

## Disk-Fallback For Missed Verdicts

### Symptom

Pre-v1.5.7, an in-memory `IMPLEMENTATION_APPROVED` message dropped or delayed by the platform left the boss with no recovery path — the protocol silently assumed the message arrived. The benoit M9-C2 stall combined this with the dormant-vs-dead misdiagnosis above: the reviewer's verdict was already on disk via thoth's archive write, but the boss had no contract telling it to look there. The build loop hung on a verdict that physically existed on the filesystem.

### Root cause

The verdict channel was single-source. Reviewer messages krs-one with `IMPLEMENTATION_APPROVED`; if that message is dropped under load, no other surface carries the verdict in a form the boss is contracted to read. The reviewer's `ARCHIVE`-to-thoth send writes `.kiln/archive/milestone-{N}/chunk-{M}/review.md`, but pre-v1.5.7 nothing told the boss to consult that path.

### Post-v1.5.7 contract

Verdict signals are dual-channel. The reviewer's `IMPLEMENTATION_APPROVED` to krs-one is the in-memory primary; `.kiln/archive/milestone-{N}/chunk-{M}/review.md` filed via thoth `ARCHIVE` on the same APPROVED is the authoritative fallback. The reviewer's `ARCHIVE`-to-thoth send MUST precede the `IMPLEMENTATION_APPROVED`-to-krs-one send so the disk channel cannot lag the message channel — if a future refactor reordered these, an in-flight verdict could be lost when the message is dropped. When the boss wakes out-of-band (watchdog nudge, async-rewake, operator nudge) without a verdict in inbox, it runs a disk-fallback procedure: identify in-flight `assignment_id`, read both candidate paths (`.kiln/archive/milestone-{N}/chunk-{M}/review.md` canonical + `.kiln/tmp/review.md` transient), treat a matching APPROVED on disk as if the message had arrived, and only escalate as genuine silence when neither match.

### What NOT to do

- Do not rely on in-memory messages as the single channel for verdicts. The platform's message delivery is best-effort under load and a dropped APPROVED stalls the build loop indefinitely without a fallback.
- Do not skip the `ARCHIVE`-before-message ordering in the reviewer body. Reordering would let the disk channel lag the message channel and recreate the original failure mode in a subtler form (the message arrives, the boss reads disk anyway and finds nothing, escalates).
- Do not treat the disk-fallback as a substitute for honest silence. If neither archive matches the in-flight `assignment_id`, the workers are genuinely stuck and the boss must escalate via `BLOCKED`, not auto-respawn fresh workers.

### References

- `plugins/kiln/agents/bossman.md` § Out-of-band wake recovery — boss procedure.
- `plugins/kiln/skills/kiln-protocol/SKILL.md` § Worker Signals — `IMPLEMENTATION_APPROVED` row dual-channel parenthetical.
- `plugins/kiln/skills/kiln-pipeline/references/team-protocol.md` § Blocking Policy Rule 6.
- `plugins/kiln/agents/critical-thinker.md` / `the-curator.md` § Review Flow → APPROVED step — reviewer ARCHIVE-before-message MUST.
- v1.5.7 Scope B handoff: `.kiln-dev/v157/scope-b-handoff.md`.

## Audit-vs-Reality Risk For Mass-Edit Briefs

### Symptom

A one-shot Explore-style codebase audit can overstate savings opportunities by scanning for keyword presence without verifying the keywords represent genuine drift. v1.5.7 Scope F's pre-dispatch audit (2026-04-25) listed F.1 ("calibration boilerplate factor") and F.3 ("archaeological tag cleanup") as high-impact targets; empirical verification before dispatch found F.1's factor pattern had already shipped in v1.5.1, and F.3's tags were active contract IDs cross-referenced from kiln-protocol/SKILL.md rather than dead archaeology. Two of seven planned chunks were absorbed/cancelled mid-scope.

### Root cause

Keyword-driven audits cannot distinguish "phrase present" from "phrase load-bearing". An audit pass that scans without reading-and-reasoning per file produces a savings count that overstates the deliverable shape. Brief-writers who treat the count as gospel scope inflated work that doesn't exist, and the implementer either ships busywork (a "fix" that flips already-correct code) or burns cycles discovering the audit was wrong mid-scope. Both outcomes are worse than running a smaller, verified scope.

### Mitigation for future bulk passes

Verify each high-impact target's drift empirically before mass-scoping. Read the file, compare to current contract surface, confirm the proposed change is non-trivial AND non-breaking. Pre-dispatch verification of the top-N highest-impact targets (the F.1 / F.3 method, retrospectively) is cheap insurance against scope inflation. Treat first-pass audit counts as upper bounds, not deliverables. A scope that reports "78% verified-clean" is doing the audit the right way — the right outcome of a sweep against well-hardened code is mostly no-ops.

### What NOT to do

- Do not dispatch a mass-edit scope based on a one-shot audit without per-file verification on the high-impact targets. The cost of verification is one Read per target; the cost of being wrong is a scope cycle.
- Do not let "X agents touched" become a savings target. Verified-clean is a valid outcome and a deliberate one — the brief should say "expected drift per file" up front, not "expected lines saved per file".
- Do not rerun the same audit pass to "double-check"; running the wrong tool twice doesn't make it the right tool. If the audit can't tell load-bearing from cosmetic, the next pass needs a different signal (e.g., grep for cross-references before recommending a tag rename).

### References

- v1.5.7 Scope F handoff: `.kiln-dev/v157/scope-f-handoff.md` — § "F.1 audit accuracy lesson" + § "Cancelled mid-scope".
