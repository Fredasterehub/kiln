#!/bin/bash
# audit-status-marker.sh — PostToolUse hook for Write
#
# Checks that dropping-science, algalon-the-observer, and pitie-pas-les-crocos
# write <!-- status: complete --> as line 1 of their hook-gated files.
# Advisory — tells the agent to fix it.
#
# Only fires during active Kiln pipeline runs (full context gate).
# Only matches dropping-science (codebase-state.md),
# algalon-the-observer (patterns.md), and pitie-pas-les-crocos (architecture.md).

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
[[ "$TOOL" =~ ^(Write|write_to_file)$ ]] || exit 0

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

# Only check dropping-science, algalon-the-observer, and pitie-pas-les-crocos
case "$AGENT" in
  dropping-science|algalon-the-observer|pitie-pas-les-crocos) ;;
  *) exit 0 ;;
esac

# Only check their specific gated files
case "$AGENT" in
  dropping-science)
    [[ "$FILE_PATH" == *codebase-state.md ]] || exit 0
    ;;
  algalon-the-observer)
    [[ "$FILE_PATH" == *patterns.md ]] || exit 0
    ;;
  pitie-pas-les-crocos)
    [[ "$FILE_PATH" == *architecture.md ]] || exit 0
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
Without it, downstream agents are blocked. Fix it now — rewrite the file with
<!-- status: complete --> as the very first line, before any other content.
MSG
    exit 0
  fi
fi

exit 0
