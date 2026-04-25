# Deadlock Detection

Design and ops reference for Kiln's autonomous self-recovery system. Primary consumers are operators reading it to understand overnight-run resilience and engineers maintaining any of the six hook scripts or the watchdog loop — not a runtime agent prompt, so there is no effort tier; read it in documentation posture. Replaces the pre-P2 manual operator-watchdog polling protocol so a 2am stall does not lose work.

## Overview

Four cooperating parts:

1. **Aggregation layer** — a handful of thin hook scripts maintain
   `.kiln/tmp/activity.json`, a single JSON state file describing the
   pipeline's recent activity and active teammates.
2. **Direct idle intervention** — `TeammateIdle` checks whether the teammate
   is still marked active. If so, it returns exit code 2 with actionable
   stderr so the teammate is resumed immediately instead of waiting for a
   later hook turn.
3. **Detached watchdog** — a `nohup + disown` bash loop spawned from
   `SessionStart`, or from a `PostToolUse:Write/Edit` hook after a new
   `.kiln/STATE.md` appears. Every 60 seconds it reads `activity.json`,
   applies the deadlock rule, and writes a nudge when the pipeline is stalled.
4. **Async rewake bridge** — an `asyncRewake` command hook runs the same
   deadlock rule in the background and exits 2 when a nudge is staged. Claude
   Code treats that exit as an immediate wake even when the session is idle,
   which covers terminal-focus stalls where no later hook would fire.

Recovery has two paths. A dangling teammate gets immediate `TeammateIdle`
feedback through the native exit-2 path. Whole-pipeline silence is built on
re-injection: the next hook fire after a nudge emits the nudge text via
`additionalContext`, and the engine — itself a Claude LLM — reads the
structured prompt on its next turn and resumes. No operator needed for a
single stall.

All hooks gate on `.kiln/STATE.md` existing and `stage != complete`. Zero
overhead outside an active Kiln pipeline.

## activity.json schema

Located at `.kiln/tmp/activity.json`. Written atomically (write-temp-then-
rename) by every participating hook.

```json
{
  "last_activity_ts": 1713379200,
  "last_activity_source": "PostToolUse:SendMessage",
  "active_teammates": {"rakim-build-3": 1713379198, "sentinel-review-3": 1713379150},
  "last_nudge_ts": 0,
  "nudge_count": 0,
  "epoch": 42,
  "pipeline_phase": "build"
}
```

| Field | Type | Semantics |
|---|---|---|
| `last_activity_ts` | int (unix epoch, seconds) | Timestamp of the most recent hook-observed activity. Heartbeat — every relevant hook fire bumps it. |
| `last_activity_source` | string | Event that last bumped the timestamp, e.g. `"PostToolUse:SendMessage"`. Debug aid — identifies which hook channel is still firing when others have gone quiet. |
| `active_teammates` | object | Map of `teammate_name` → `last_seen_ts`. Populated by `SubagentStart` (add entry). Removed ONLY by `SubagentStop` (clean exit). `TeammateIdle` is heartbeat-only — the teammate stays tracked because dormant-waiting-for-message is not the same as exited. An empty map means no active subagent processes are running, but it is no longer a deadlock precondition (see Deadlock rule below). |
| `last_nudge_ts` | int (unix epoch, seconds; `0` = never) | When the most recent nudge was emitted. Used for debounce — a fresh nudge cannot fire within 600s of the previous one. |
| `nudge_count` | int | Nudges delivered in the current pipeline run. Watchdog escalates when this reaches 3. |
| `epoch` | int | Monotonically bumps on every activity write. Lets the watchdog distinguish stale reads from fresh state without a lock. |
| `pipeline_phase` | string | Current stage mirrored from `.kiln/STATE.md` (one of `onboarding`, `brainstorm`, `research`, `architecture`, `plan`, `build`, `validate`, `report`, `idle`, `awaiting_user`, `complete`). |

## Deadlock rule

The watchdog declares deadlock if and only if all three conditions hold:

```
DEADLOCK iff
  (now - last_activity_ts) > 300s
  AND (now - last_nudge_ts) > 600s   (debounce; last_nudge_ts == 0 bypasses this clause)
  AND pipeline_phase not in {"idle", "awaiting_user", "complete"}
```

Each clause has a purpose: 300s idle rules out normal think time; 600s
debounce keeps a persistent stall from producing a flood of nudges; the
phase filter keeps the watchdog silent when the pipeline is intentionally
waiting.

We used to require `active_teammates` to be empty as a 4th condition. That
conflated dormant-waiting-for-message with exited and produced
false-positives — the benoit M9-C2 stall was the concrete evidence. Once
A.1 keeps dormant teammates tracked in `active_teammates`, the clause would
prevent the watchdog from firing on real stalls where a teammate is alive
but the pipeline is genuinely stuck. The load-bearing signal is
`idle > 300s + phase filter`.

## Nudge mechanism

When `TeammateIdle` arrives for a teammate that is still tracked in
`active_teammates`, `teammate-idle-feedback.sh` emits a concise diagnostic to
stderr and exits 2. A dormant-but-tracked teammate may have missed a message,
so this path prompts immediate re-engagement without waiting for the
watchdog loop. Normal completions stay quiet because `SubagentStop` removes
the teammate before the idle check becomes relevant.

The watchdog path is for the larger case where the pipeline has gone silent:
no hook-observed activity for 300s, regardless of how many teammates are
tracked. The detached loop stages a nudge for the next hook turn; the async
rewake bridge uses Claude Code's native asyncRewake exit-2 path to wake the
idle engine when there may not be a next hook turn.

When the rule fires:

1. `deadlock-check.sh` appends a `> [!WARNING] KILN DEADLOCK — …` block to
   `.kiln/STATE.md` and writes `.kiln/tmp/pending-nudge.json`. `nudge_count`
   and `last_nudge_ts` are bumped atomically in `activity.json`.
2. The next registered hook fire — `PreToolUse` or `UserPromptSubmit`, both
   registered to maximize capture of the engine's next turn — reads
   `pending-nudge.json`, emits its content through `additionalContext` on
   stdout (`{"hookSpecificOutput": {"hookEventName": "...",
   "additionalContext": "..."}}`), and deletes the pending file. The engine
   consumes the `additionalContext` attachment on its next turn.

The contract is deliberately asynchronous: the watchdog never talks to the
engine directly. It stages a message; the engine picks it up on the next
tool call. Round-trip latency is up to ~60s.

## Escalation

After `nudge_count` reaches 3 without recovery:

- The watchdog writes `.kiln/DEADLOCK.flag`.
- A final escalation block is appended to `.kiln/STATE.md`.
- The watchdog exits cleanly.

Recovery is restartable from persisted state. The next `SessionStart`
detects `DEADLOCK.flag`, runs the recovery routine (reload state, emit a
startup diagnostic, reset counters, remove the flag), and the pipeline
continues. An external wrapper or `kiln-doctor` cron can also read the flag
and re-enter the run. Design posture: a stalled run survives whoever picks
it up.

## Hook inventory

| Script | Event | Role |
|---|---|---|
| `activity-update.sh` | `SubagentStart` / `SubagentStop` / `TeammateIdle` / `PreToolUse` / `PostToolUse` / `UserPromptSubmit` | Heartbeat + teammate tracking; writes `activity.json`. `TeammateIdle` is heartbeat-only and does not remove from `active_teammates`. |
| `teammate-idle-feedback.sh` | `TeammateIdle` | Direct exit-2 feedback when a teammate is still marked active and tries to idle |
| `spawn-watchdog.sh` | `SessionStart` | Gate, stale-PID kill, spawn detached `nohup + disown` loop |
| `ensure-watchdog.sh` | `PostToolUse:Write/Edit` | Starts the watchdog after `.kiln/STATE.md` is created later in a fresh session |
| `session-cleanup.sh` | `SessionEnd` | Kill watchdog PID; remove `activity.json` and `watchdog.pid` |
| `watchdog-loop.sh` | (detached — not hook-registered) | 60s polling loop body; invokes `deadlock-check.sh` |
| `deadlock-check.sh` | (called by `watchdog-loop.sh`) | Evaluate rule; write nudge + STATE.md warning; escalate at 3 |
| `async-rewake-watchdog.sh` | `SessionStart` / `PostToolUse:Write/Edit` (`asyncRewake`) | Runs the same rule in a single background process and exits 2 with the staged nudge so Claude Code wakes even if the terminal-focus stall prevents ordinary hook delivery. |
| `nudge-inject.sh` | `PreToolUse` / `UserPromptSubmit` | Emit `pending-nudge.json` via `additionalContext` on the engine's next turn; delete file. Registered on both `PreToolUse` and `UserPromptSubmit` to catch whichever fires first. |

Every hook fails open — on any error the script exits 0 so the pipeline is
never blocked by a watchdog fault.

## Out of scope

- **Livelock** — an engine stuck in an infinite tool-call loop produces
  heartbeats without real progress, so this detector will not fire. A
  separate "same-tool-N-times" detector is deferred to a future pass.
- **VM suspend / clock skew** — the rule uses wall-clock time. A suspended
  VM that resumes with a stale `last_activity_ts` may trigger a spurious
  nudge. Not defended; acceptable if rare.
- **Nudge latency** — up to ~60s from stall detection to engine consumption.
  Acceptable for autonomous overnight runs; this is not a low-latency system.
