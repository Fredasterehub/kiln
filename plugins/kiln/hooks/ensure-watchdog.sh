#!/bin/bash
# ensure-watchdog.sh - start the detached watchdog after STATE.md appears
#
# SessionStart cannot see a brand-new pipeline whose .kiln/STATE.md is
# created later in the same session. This hook is wired to PostToolUse
# Write/Edit and starts the watchdog if an active STATE.md exists and no
# live watchdog-loop process is recorded.

INPUT=$(cat)

_find_root() {
  local d="$PWD"
  while [[ "$d" != "/" ]]; do
    [[ -d "$d/.kiln" ]] && echo "$d" && return 0
    d=$(dirname "$d")
  done
  return 1
}

ROOT=$(_find_root)
[[ -n "$ROOT" ]] || exit 0

STATE="$ROOT/.kiln/STATE.md"
[[ -f "$STATE" ]] || exit 0

STAGE=$(grep -oP '(?<=\*\*stage\*\*: )\S+' "$STATE" 2>/dev/null || true)
[[ -n "$STAGE" ]] || exit 0
[[ "$STAGE" != "complete" ]] || exit 0

TMP_DIR="$ROOT/.kiln/tmp"
PID_FILE="$TMP_DIR/watchdog.pid"

if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" 2>/dev/null)
  if [[ -n "$PID" && -r "/proc/$PID/cmdline" ]] && grep -q "watchdog-loop" "/proc/$PID/cmdline" 2>/dev/null; then
    exit 0
  fi
fi

HOOK_DIR=$(realpath "$(dirname "$0")" 2>/dev/null || (cd "$(dirname "$0")" && pwd))
SPAWN="$HOOK_DIR/spawn-watchdog.sh"
[[ -x "$SPAWN" || -f "$SPAWN" ]] || exit 0

printf '%s' "$INPUT" | bash "$SPAWN" >/dev/null 2>&1 || true
exit 0
