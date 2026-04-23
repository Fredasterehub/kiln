#!/bin/bash
# teammate-idle-feedback.sh - direct TeammateIdle intervention for Kiln teams
#
# TeammateIdle can feed stderr back to the teammate with exit code 2,
# making the teammate continue instead of going idle. Use that native
# path only when the teammate is still marked active in activity.json:
# clean SubagentStop handling removes the teammate first, so this hook
# stays quiet for normal completions and only intervenes on dangling
# active teammates.

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
[[ "$STAGE" != "idle" ]] || exit 0
[[ "$STAGE" != "awaiting_user" ]] || exit 0

TEAMMATE=$(echo "$INPUT" | jq -r '.teammate_name // ""' 2>/dev/null)
TEAMMATE="${TEAMMATE#kiln:}"
[[ -n "$TEAMMATE" ]] || exit 0

ACTIVITY="$ROOT/.kiln/tmp/activity.json"
[[ -f "$ACTIVITY" ]] || exit 0

if jq -e --arg teammate "$TEAMMATE" '(.active_teammates // {}) | has($teammate)' "$ACTIVITY" >/dev/null 2>&1; then
  cat >&2 <<EOF
KILN TEAMMATE IDLE: you are still marked active in .kiln/tmp/activity.json while the pipeline is in stage '$STAGE'. Re-read .kiln/STATE.md, finish the assigned handoff, and emit the required Kiln signal or status marker before going idle.
EOF
  exit 2
fi

exit 0
