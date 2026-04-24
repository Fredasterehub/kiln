#!/bin/bash
# async-rewake-watchdog.sh — Claude Code asyncRewake bridge for Kiln stalls
#
# The detached watchdog can detect a silent engine and stage a nudge, but a
# terminal-focus stall may leave the main session idle with no future hook fire
# to consume that nudge. Claude Code's asyncRewake hook mode is the native wake
# path for that case: an async command hook that exits 2 wakes Claude even when
# the session is idle.
#
# This script intentionally reuses deadlock-check.sh and its activity.json
# contract. It does not invent a second deadlock rule; it only changes delivery
# from "next hook fire" to "wake the idle session now".

. "$(dirname "$0")/_kiln-lib.sh"

# Consume stdin so Claude Code can close the hook pipe immediately. The payload
# is not needed; filesystem state is the source of truth.
cat >/dev/null

_kiln_pipeline_active || exit 0

ROOT="$KILN_ROOT"
TMP_DIR="$ROOT/.kiln/tmp"
mkdir -p "$TMP_DIR" 2>/dev/null || exit 0

HOOK_DIR=$(realpath "$(dirname "$0")" 2>/dev/null || (cd "$(dirname "$0")" && pwd))
CHECK="$HOOK_DIR/deadlock-check.sh"
[[ -f "$CHECK" ]] || exit 0

LOCK_DIR="$TMP_DIR/async-rewake-watchdog.lock"
PID_FILE="$TMP_DIR/async-rewake-watchdog.pid"
PENDING="$TMP_DIR/pending-nudge.json"
FLAG="$ROOT/.kiln/DEADLOCK.flag"

# async hooks are not deduplicated by Claude Code. Keep exactly one bridge alive
# per pipeline so frequent hook fires do not create a process pile-up.
mkdir "$LOCK_DIR" 2>/dev/null || exit 0

cleanup() {
  rm -f "$PID_FILE" 2>/dev/null
  rmdir "$LOCK_DIR" 2>/dev/null
}
trap cleanup EXIT INT TERM HUP

echo "$$" > "$PID_FILE" 2>/dev/null || true

INTERVAL="${KILN_ASYNC_REWAKE_INTERVAL_SEC:-60}"
[[ "$INTERVAL" =~ ^[0-9]+$ ]] || INTERVAL=60
[[ "$INTERVAL" -ge 1 ]] || INTERVAL=1

emit_pending_rewake() {
  local MSG
  [[ -f "$PENDING" ]] || return 1
  MSG=$(jq -r '.additionalContext // ""' "$PENDING" 2>/dev/null)
  [[ -n "$MSG" ]] || return 1
  printf '%s\n' "KILN ASYNC REWAKE: ${MSG}" >&2
  return 0
}

emit_flag_rewake() {
  [[ -f "$FLAG" ]] || return 1
  printf '%s\n' "KILN ASYNC REWAKE: .kiln/DEADLOCK.flag exists. Re-read .kiln/STATE.md and resume or recover the pipeline." >&2
  return 0
}

while true; do
  _kiln_pipeline_active || exit 0

  if emit_pending_rewake; then
    exit 2
  fi

  bash "$CHECK" >/dev/null 2>&1
  CHECK_RC=$?

  if emit_pending_rewake; then
    exit 2
  fi

  if [[ "$CHECK_RC" -eq 1 ]] && emit_flag_rewake; then
    exit 2
  fi

  # Test escape hatch: run one detection pass without sleeping.
  [[ "${KILN_ASYNC_REWAKE_ONCE:-0}" == "1" ]] && exit 0

  sleep "$INTERVAL"
done
