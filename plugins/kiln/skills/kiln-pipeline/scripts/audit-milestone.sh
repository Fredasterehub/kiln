#!/bin/bash
# audit-milestone.sh — PostToolUse hook for SendMessage
#
# Fires when a message contains MILESTONE_COMPLETE. Verifies that
# iter-log.md agrees with the claim: last entry must have
# result: milestone_complete and qa: PASS.
#
# Advisory only — always exits 0. Warnings go to stderr (model feedback).
# Cannot block; PostToolUse hooks are informational by design.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
[[ "$TOOL" =~ ^(SendMessage|send_message)$ ]] || exit 0

AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')
AGENT="${AGENT#kiln:}"
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')

# Only fire when message contains MILESTONE_COMPLETE
echo "$CONTENT" | grep -qF 'MILESTONE_COMPLETE' || exit 0

# ── Pipeline context gate (same as audit-bash.sh) ───────────
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

# Only audit known pipeline agents that send milestone signals
case "$AGENT" in
  krs-one) ;; # the only agent that should send MILESTONE_COMPLETE
  *) exit 0 ;; # not our concern
esac

# ── Iter-log verification ────────────────────────────────────
ITER_LOG="$KILN_ROOT/.kiln/docs/iter-log.md"

if [[ ! -f "$ITER_LOG" ]]; then
  echo "AUDIT WARNING: MILESTONE_COMPLETE claimed but iter-log.md does not exist at $ITER_LOG." >&2
  echo "  The iteration ledger should be written before signaling milestone completion." >&2
  exit 0
fi

# Extract only the LAST entry block. Entries start with "## Iteration".
# Find the last such header and take everything from there to EOF.
LAST_HEADER_LINE=$(grep -n '^## Iteration' "$ITER_LOG" | tail -1 | cut -d: -f1)
if [[ -z "$LAST_HEADER_LINE" ]]; then
  echo "AUDIT WARNING: MILESTONE_COMPLETE claimed but iter-log.md has no '## Iteration' entries." >&2
  exit 0
fi
LAST_ENTRY=$(tail -n +"$LAST_HEADER_LINE" "$ITER_LOG")

# Check for result: milestone_complete (case-insensitive value)
if ! echo "$LAST_ENTRY" | grep -qiE '^\s*result:\s*milestone_complete'; then
  echo "AUDIT WARNING: MILESTONE_COMPLETE claimed but iter-log.md last entry does not show 'result: milestone_complete'." >&2
  echo "  Update iter-log.md to reflect the milestone result before signaling." >&2
fi

# Check for qa: PASS
if ! echo "$LAST_ENTRY" | grep -qiE '^\s*qa:\s*PASS'; then
  echo "AUDIT WARNING: MILESTONE_COMPLETE claimed but iter-log.md last entry does not show 'qa: PASS'." >&2
  echo "  QA must pass before claiming milestone completion. Run the 3 QA checks first." >&2
fi

exit 0
