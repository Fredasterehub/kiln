# Deadlock Detection

Autonomous self-recovery for stalled Kiln pipelines. Replaces the pre-P2 manual
operator-watchdog polling protocol — runs unattended overnight without losing
work on a 2am stall.

## Overview

Two cooperating parts:

1. **Aggregation layer** — a handful of thin hook scripts maintain
   `.kiln/tmp/activity.json`, a single JSON state file describing the
   pipeline's recent activity and active teammates.
2. **Detached watchdog** — a `nohup + disown` bash loop spawned from
   `SessionStart`. Every 60 seconds it reads `activity.json`, applies the
   deadlock rule, and writes a nudge when the pipeline is stalled.

Recovery is built on re-injection: the next hook fire after a nudge emits the
nudge text via `additionalContext`, and the engine — itself a Claude LLM —
reads the structured prompt on its next turn and resumes. No operator needed
for a single stall.

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
| `active_teammates` | object | Map of `teammate_name` → `last_seen_ts`. Populated by `SubagentStart` (add entry). Removed by `SubagentStop` (clean exit) and `TeammateIdle` (timeout/idle signal). An empty map means no active teammates — necessary condition for deadlock. |
| `last_nudge_ts` | int (unix epoch, seconds; `0` = never) | When the most recent nudge was emitted. Used for debounce — a fresh nudge cannot fire within 600s of the previous one. |
| `nudge_count` | int | Nudges delivered in the current pipeline run. Watchdog escalates when this reaches 3. |
| `epoch` | int | Monotonically bumps on every activity write. Lets the watchdog distinguish stale reads from fresh state without a lock. |
| `pipeline_phase` | string | Current stage mirrored from `.kiln/STATE.md` (one of `onboarding`, `brainstorm`, `research`, `architecture`, `plan`, `build`, `validate`, `report`, `idle`, `awaiting_user`, `complete`). |

## Deadlock rule

The watchdog declares deadlock if and only if all four conditions hold:

```
DEADLOCK iff
  active_teammates is empty
  AND (now - last_activity_ts) > 300s
  AND (now - last_nudge_ts) > 600s   (debounce; last_nudge_ts == 0 bypasses this clause)
  AND pipeline_phase not in {"idle", "awaiting_user", "complete"}
```

Each clause has a purpose: empty `active_teammates` rules out teammates
mid-turn; 300s idle rules out normal think time; 600s debounce keeps a
persistent stall from producing a flood of nudges; the phase filter keeps
the watchdog silent when the pipeline is intentionally waiting.

## Nudge mechanism

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
| `activity-update.sh` | `SubagentStart` / `SubagentStop` / `TeammateIdle` / `PreToolUse` / `PostToolUse` / `UserPromptSubmit` | Heartbeat + teammate tracking; writes `activity.json` |
| `spawn-watchdog.sh` | `SessionStart` | Gate, stale-PID kill, spawn detached `nohup + disown` loop |
| `session-cleanup.sh` | `SessionEnd` | Kill watchdog PID; remove `activity.json` and `watchdog.pid` |
| `watchdog-loop.sh` | (detached — not hook-registered) | 60s polling loop body; invokes `deadlock-check.sh` |
| `deadlock-check.sh` | (called by `watchdog-loop.sh`) | Evaluate rule; write nudge + STATE.md warning; escalate at 3 |
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
