# Known Limitations

Operator-facing reference for runtime behaviors Kiln cannot work around because the root cause sits upstream in Claude Code itself. Read in documentation posture — no agent prompt loads this at runtime; the audience is an operator debugging a stall or deciding how to run a long autonomous pipeline.

## Terminal Focus Stall

### Symptom

A Kiln pipeline appears to freeze when the terminal window loses focus (operator switches to another application), then resumes on its own the moment focus returns — without any prompt, keystroke, or hook fire from the operator. The pipeline is making no progress between the unfocus and the refocus, yet no Kiln deadlock nudge is emitted and no `DEADLOCK.flag` is written.

### Root cause

Tracked upstream as **`anthropics/claude-code#25068`** — Claude Code sessions can stall during long independent operations and resume only on new TTY input. Terminal focus-in events (xterm escape sequence `\e[I`) register as low-level TTY input under many terminal emulators, which is why refocusing alone wakes the session even without a keystroke.

Compounding factor: the server-sent events (SSE) idle timeout defaults to 5 minutes (`CLAUDE_STREAM_IDLE_TIMEOUT_MS=300000`). When an SSE stream aborts and retries, the retry can race with the focus wake-up, which is why the stall sometimes looks like it "recovers on its own" after a few minutes even without operator input.

### Why Kiln's watchdog cannot help

The detached watchdog (`watchdog-loop.sh` + `deadlock-check.sh`) delivers nudges through a two-step indirection: write `.kiln/tmp/pending-nudge.json`, then wait for the next hook fire to consume it via `nudge-inject.sh`'s `additionalContext` injection. For a teammate stall (teammate still active after SubagentStop), the `TeammateIdle` native exit-2 path handles it directly — no hook indirection needed.

The terminal-focus class of stall is neither: the stalled party is the main engine session itself, and the main session is not firing any hooks while stalled. Every nudge the watchdog writes sits in `pending-nudge.json` undelivered, piling up. When focus returns, the first hook fire after refocus consumes the most recent nudge — but the session was already going to resume from the focus event, so the nudge arrives after the stall has already self-resolved.

The watchdog is not broken; it handles a different class of deadlock (teammate died, main session waiting on nothing). It cannot reach through a stalled event loop that isn't firing hooks.

### Operator mitigations

Three options, in rough order of preference:

1. **`claude -p` for autonomous runs.** Non-interactive mode doesn't depend on TTY input to stay alive, so terminal focus is irrelevant. This is the right mode for overnight or untended pipelines and is what the Kiln design target has always assumed.

2. **`claude --worktree <name>` for parallel isolated work.** Each worktree runs in its own session; losing focus on the outer terminal doesn't stall the worktree's internal loop. Useful when you want to kick off a Kiln run and keep working elsewhere in the same repo.

3. **Bump the SSE idle timeout.** Set `CLAUDE_STREAM_IDLE_TIMEOUT_MS=600000` (10 minutes) or higher in your shell env before launching `claude`. Doesn't fix the focus-stall class, but reduces SSE-retry churn during long independent operations, which is the compounding factor.

Remote Control mode (for server / CI runs) is a fourth option when available in your setup, and has the same non-TTY posture as `claude -p`.

### What NOT to do

- Do **not** file this as a Kiln deadlock bug. The deadlock detection subsystem works as designed; the terminal-focus stall is out of its reach by construction.
- Do **not** try to work around the stall with operator-side nudges (keyboard activity in the terminal, shell bells, etc.) — they will work, but they're slower than just switching mode to `claude -p`, and the habit papers over the actual upstream fix path.
- Do **not** modify `deadlock-check.sh` or the watchdog loop frequency to chase this case. The watchdog's indirection through `additionalContext` is the mechanism that makes it safe; there is no shorter path that doesn't fight the platform.

### Upstream status

GitHub `anthropics/claude-code#25068` remains open as of the v1.5.3 hooks consolidation. When it is resolved in a Claude Code release, the `claude -p` / `--worktree` / env-tuning mitigations above become unnecessary and this section can be narrowed to a historical note.
