# Known Limitations

Operator-facing reference for runtime behaviors Kiln cannot work around because the root cause sits upstream in Claude Code itself. Read in documentation posture — no agent prompt loads this at runtime; the audience is an operator debugging a stall or deciding how to run a long autonomous pipeline.

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
