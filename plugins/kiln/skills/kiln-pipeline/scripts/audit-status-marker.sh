#!/bin/bash
# audit-status-marker.sh — PostToolUse hook for Write
#
# Checks that rakim and sentinel write <!-- status: complete --> as line 1
# of their hook-gated files. Advisory — tells the agent to fix it.
#
# Only fires during active Kiln pipeline runs (full context gate).
# Only matches rakim (codebase-state.md) and sentinel (patterns.md).

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
[[ "$TOOL" == "Write" ]] || exit 0

AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')
AGENT="${AGENT#kiln:}"
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# ── Pipeline context gate (same as enforce-pipeline.sh) ──────
_find_root() {
  local d="$PWD"
  while [[ "$d" != "/" ]]; do
    [[ -d "$d/.kiln" ]] && echo "$d" && return 0
    d=$(dirname "$d")
  done
  return 1
}

KILN_ROOT=$(_find_root)
[[ -n "$KILN_ROOT" ]] || exit 0

_STATE="$KILN_ROOT/.kiln/STATE.md"
[[ -f "$_STATE" ]] || exit 0

_STAGE=$(grep -oP '(?<=\*\*stage\*\*: )\S+' "$_STATE" 2>/dev/null || true)
if [[ -z "$_STAGE" ]] || [[ "$_STAGE" == "complete" ]]; then
  exit 0
fi

# Only check rakim and sentinel
case "$AGENT" in
  rakim|sentinel) ;;
  *) exit 0 ;;
esac

# Only check their specific gated files
case "$AGENT" in
  rakim)
    [[ "$FILE_PATH" == *codebase-state.md ]] || exit 0
    ;;
  sentinel)
    [[ "$FILE_PATH" == *patterns.md ]] || exit 0
    ;;
esac

# Check line 1 of the file that was just written
if [[ -f "$FILE_PATH" ]]; then
  LINE1=$(head -1 "$FILE_PATH")
  if [[ "$LINE1" != "<!-- status: complete -->" ]]; then
    cat >&2 <<MSG
Line 1 of $FILE_PATH must be exactly:  <!-- status: complete -->

You wrote: "$LINE1"

This marker is checked by a PreToolUse hook that gates downstream dispatches.
Without it, krs-one cannot send work to builders. Fix it now — rewrite the
file with <!-- status: complete --> as the very first line, before any other content.
MSG
    exit 2
  fi
fi

exit 0
