#!/bin/bash
# teammate-idle-feedback.sh - direct TeammateIdle intervention for Kiln teams
#
# TeammateIdle can feed stderr back to the teammate with exit code 2,
# making the teammate continue instead of going idle. Use that native
# path only when the teammate is still marked active in activity.json:
# clean SubagentStop handling removes the teammate first, so this hook
# stays quiet for normal completions and only intervenes on dangling
# active teammates.

. "$(dirname "$0")/_kiln-lib.sh"

INPUT=$(cat)

_kiln_pipeline_active || exit 0
# Idle and awaiting_user stages are expected quiet windows — no feedback.
case "$KILN_STAGE" in idle|awaiting_user) exit 0 ;; esac

TEAMMATE=$(echo "$INPUT" | jq -r '.teammate_name // ""' 2>/dev/null)
TEAMMATE=$(_kiln_strip_prefix "$TEAMMATE")
[[ -n "$TEAMMATE" ]] || exit 0

ACTIVITY="$KILN_ROOT/.kiln/tmp/activity.json"
[[ -f "$ACTIVITY" ]] || exit 0

if jq -e --arg teammate "$TEAMMATE" '(.active_teammates // {}) | has($teammate)' "$ACTIVITY" >/dev/null 2>&1; then
  cat >&2 <<EOF
KILN TEAMMATE IDLE: you are still marked active in .kiln/tmp/activity.json while the pipeline is in stage '$KILN_STAGE'. Re-read .kiln/STATE.md, finish the assigned handoff, and emit the required Kiln signal or status marker before going idle.
EOF
  exit 2
fi

exit 0
