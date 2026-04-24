#!/bin/bash
# session-cleanup.sh — SessionEnd hook for Kiln deadlock watchdog
#
# Tears down the detached watchdog and its transient state when the
# claude session ends. Paired with spawn-watchdog.sh: what SessionStart
# brought up, SessionEnd takes down, so a cleanly-closed session
# doesn't leak a watchdog process or stale activity state into the
# next invocation.
#
# Unlike the other Kiln hooks, this one does NOT gate on
# `stage != complete`. The session is ending either way — a pipeline
# still in-flight deserves cleanup just as much as a completed one,
# because the next SessionStart will re-spawn its own watchdog from a
# clean slate. Gating would leak state on mid-pipeline exits (the
# exact scenario where a stale watchdog + stale activity.json cause
# the zombie-and-false-alarm pattern the spike flagged).
#
# Fail-open everywhere. The session is exiting; nothing we do here can
# block it, and nothing that fails here should surface as an error.

. "$(dirname "$0")/_kiln-lib.sh"

# NOTE: session-cleanup deliberately does NOT gate on stage != complete
# (the session is ending regardless — a mid-pipeline exit still deserves
# teardown). Only needs root resolution, not the full composite gate.
ROOT=$(_kiln_find_root)
[[ -n "$ROOT" ]] || exit 0

TMP_DIR="$ROOT/.kiln/tmp"
PID_FILE="$TMP_DIR/watchdog.pid"
REWAKE_PID_FILE="$TMP_DIR/async-rewake-watchdog.pid"

# Best-effort kill, with a recycled-PID guard. On a long-running host
# the kernel may have rolled the saved PID over to an unrelated
# process between SessionStart and SessionEnd; blindly SIGTERMing
# that would be catastrophic. Verify the cmdline identifies our
# watchdog before killing. /proc is Linux-only — on Mac/WSL/BSD
# without procfs, skip the kill rather than risk hitting the wrong
# process. watchdog-loop.sh exits on its own via pipeline-complete or
# the 3-nudge escalation path, so a skipped cleanup is graceful
# decay, not a leak.
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" 2>/dev/null)
  if [[ -n "$PID" && -r "/proc/$PID/cmdline" ]]; then
    if grep -q "watchdog-loop" "/proc/$PID/cmdline" 2>/dev/null; then
      kill "$PID" 2>/dev/null
    fi
  fi
  rm -f "$PID_FILE" 2>/dev/null
fi

if [[ -f "$REWAKE_PID_FILE" ]]; then
  PID=$(cat "$REWAKE_PID_FILE" 2>/dev/null)
  if [[ -n "$PID" && -r "/proc/$PID/cmdline" ]]; then
    if grep -q "async-rewake-watchdog" "/proc/$PID/cmdline" 2>/dev/null; then
      kill "$PID" 2>/dev/null
    fi
  fi
  rm -f "$REWAKE_PID_FILE" 2>/dev/null
fi

# Transient state. activity.json and activity.lock are scoped to a
# single session's lifecycle — the next SessionStart will re-seed
# them. .kiln/DEADLOCK.flag is intentionally NOT removed here: it
# encodes "three nudges failed, operator intervention needed" and
# must survive session boundaries so the next SessionStart can
# detect and respond to it.
rm -f "$TMP_DIR/activity.json" 2>/dev/null
rm -f "$TMP_DIR/activity.lock" 2>/dev/null
rmdir "$TMP_DIR/async-rewake-watchdog.lock" 2>/dev/null

exit 0
