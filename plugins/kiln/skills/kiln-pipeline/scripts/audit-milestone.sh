#!/bin/bash
# audit-milestone.sh — PostToolUse hook for SendMessage
#
# Tracks terminal and coordination signals sent via SendMessage.
# Injects system-reminder context for terminal signals to ensure
# the engine processes them on its next idle turn.
#
# Tracked signals:
#   Terminal: MILESTONE_COMPLETE, BUILD_COMPLETE, ARCHITECTURE_COMPLETE,
#             ONBOARDING_COMPLETE, BRAINSTORM_COMPLETE, RESEARCH_COMPLETE,
#             VALIDATE_PASS, VALIDATE_FAILED, REPORT_COMPLETE
#   Coordination: CYCLE_WORKERS, REQUEST_WORKERS
#
# Advisory + context injection. Always exits 0.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
[[ "$TOOL" == "SendMessage" ]] || exit 0

AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')
AGENT="${AGENT#kiln:}"
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')

# Detect terminal signals — inject system-reminder so engine processes them
if echo "$CONTENT" | grep -qE 'BUILD_COMPLETE|ARCHITECTURE_COMPLETE|ONBOARDING_COMPLETE|BRAINSTORM_COMPLETE|RESEARCH_COMPLETE|VALIDATE_PASS|VALIDATE_FAILED|REPORT_COMPLETE'; then
  SIGNAL=$(echo "$CONTENT" | grep -oE 'BUILD_COMPLETE|ARCHITECTURE_COMPLETE|ONBOARDING_COMPLETE|BRAINSTORM_COMPLETE|RESEARCH_COMPLETE|VALIDATE_PASS|VALIDATE_FAILED|REPORT_COMPLETE' | head -1)
  jq -cn --arg sig "$SIGNAL" --arg agent "$AGENT" '{
    hookSpecificOutput: {
      additionalContext: ("SIGNAL RECEIVED: " + $agent + " sent " + $sig + ". Process this signal and advance the pipeline state machine.")
    }
  }'
  exit 0
fi

# Detect CYCLE_WORKERS — inject reminder for engine to execute cycling protocol
if echo "$CONTENT" | grep -qF 'CYCLE_WORKERS'; then
  jq -cn --arg agent "$AGENT" '{
    hookSpecificOutput: {
      additionalContext: ("CYCLE_WORKERS received from " + $agent + ". Execute cycling protocol: validate scenario, shutdown current workers, spawn fresh pair, send WORKERS_SPAWNED.")
    }
  }'
  exit 0
fi

# Detect REQUEST_WORKERS — inject reminder
if echo "$CONTENT" | grep -qF 'REQUEST_WORKERS'; then
  jq -cn --arg agent "$AGENT" '{
    hookSpecificOutput: {
      additionalContext: ("REQUEST_WORKERS received from " + $agent + ". Spawn requested workers on the team and send WORKERS_SPAWNED confirmation.")
    }
  }'
  exit 0
fi

# MILESTONE_COMPLETE gets special treatment — verify iter-log.md
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

# Only audit known pipeline agents that send milestone signals.
# AGENT is sourced from tool_input.agent_type (the subagent_type, prefix-
# stripped), which is the ROLE name "bossman", not the runtime spawn name
# "krs-one". See tests/layer1-static/hook-fixtures/audit-milestone/.
case "$AGENT" in
  bossman) ;; # the only agent that should send MILESTONE_COMPLETE
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
