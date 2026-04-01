#!/bin/bash
# stop-guard.sh — Stop/SubagentStop hook for Kiln pipeline
#
# Prevents pipeline agents from stopping while their work is incomplete.
# Checks deliverables per role: persistent minds need status markers,
# builders need a recent commit or a terminal signal.
#
# Exit 0 = allow stop. Exit 2 = block stop (stderr = nudge message).

INPUT=$(cat)
# Handle both main session (AGENT) and subagents (AGENT_ID/SUBTYPE)
AGENT=$(echo "$INPUT" | jq -r '.agent_type // .agent_id // .subagent_type // ""')
AGENT="${AGENT#kiln:}"

# ── Pipeline context gate ────────────────────────────────────
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

_STATE="$ROOT/.kiln/STATE.md"
[[ -f "$_STATE" ]] || exit 0

_STAGE=$(grep -oP '(?<=\*\*stage\*\*: )\S+' "$_STATE" 2>/dev/null || true)
[[ -n "$_STAGE" ]] || exit 0
[[ "$_STAGE" != "complete" ]] || exit 0

# Only gate known Kiln pipeline agents
case "$AGENT" in
  alpha|mnemosyne|maiev|curie|medivh|\
  da-vinci|clio|\
  mi6|field-agent|\
  aristotle|numerobis|confucius|sun-tzu|plato|athena|\
  krs-one|rakim|sentinel|thoth|codex|daft|kaneda|clair|miyamoto|sphinx|punk|tetsuo|obscur|\
  zoxea|argus|hephaestus|omega)
    ;; # known agent — check deliverable
  *)
    exit 0 ;; # not a Kiln agent, allow stop
esac

# ── History Inspection ───────────────────────────────────────
# Get last action and last messages from transcript
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // .agent_transcript_path // ""')
LAST_TOOL=$(echo "$INPUT" | jq -r '.history[-1].tool_name // ""')
LAST_CONTENT=$(echo "$INPUT" | jq -r '.history[-1].tool_input.content // ""')

if [[ -f "$TRANSCRIPT" ]]; then
  # Check if they received a terminal request or sent a terminal signal
  LAST_RECEIVED=$(grep -E '"type":\s*"message"' "$TRANSCRIPT" | tail -1 | jq -r '.content // ""')
  LAST_SENT=$(grep -E '"type":\s*"message"' "$TRANSCRIPT" | grep -E '"sender":\s*"'${AGENT}'"' | tail -1 | jq -r '.content // ""')
fi

# Terminal signals always allow stop
case "$LAST_CONTENT" in
  *ONBOARDING_COMPLETE*|*BRAINSTORM_COMPLETE*|*RESEARCH_COMPLETE*|*ARCHITECTURE_COMPLETE*|*ITERATION_COMPLETE*|*MILESTONE_COMPLETE*|*BUILD_COMPLETE*|*VALIDATE_PASS*|*VALIDATE_FAILED*|*REPORT_COMPLETE*|*READY:*|*IMPLEMENTATION_COMPLETE*|*REVIEW_REQUEST*|*APPROVED*|*REJECTED*|*SERIALIZATION_COMPLETE*)
    exit 0
    ;;
esac

# ── Per-role deliverable checks ──────────────────────────────

case "$AGENT" in
  rakim)
    if [[ -f "$ROOT/.kiln/docs/codebase-state.md" ]]; then
      head -1 "$ROOT/.kiln/docs/codebase-state.md" | grep -qF '<!-- status: complete -->' && exit 0
    fi
    echo "You are stopping but codebase-state.md is missing or has no <!-- status: complete --> marker on line 1. Write your state file before stopping." >&2
    exit 2
    ;;
  sentinel)
    if [[ -f "$ROOT/.kiln/docs/patterns.md" ]]; then
      head -1 "$ROOT/.kiln/docs/patterns.md" | grep -qF '<!-- status: complete -->' && exit 0
    fi
    echo "You are stopping but patterns.md is missing or has no <!-- status: complete --> marker on line 1. Write your patterns file before stopping." >&2
    exit 2
    ;;
  numerobis)
    if [[ -f "$ROOT/.kiln/docs/architecture.md" ]]; then
      head -1 "$ROOT/.kiln/docs/architecture.md" | grep -qF '<!-- status: complete -->' && exit 0
    fi
    echo "You are stopping but architecture.md is missing or has no <!-- status: complete --> marker on line 1. Write your architecture file before stopping." >&2
    exit 2
    ;;
  clio)
    if [[ "$LAST_RECEIVED" == *"SERIALIZE_AND_SHUTDOWN"* ]]; then
      if [[ -f "$ROOT/.kiln/docs/VISION.md" ]] && [[ "$LAST_SENT" == *"SERIALIZATION_COMPLETE"* ]]; then
        exit 0
      fi
      echo "You received SERIALIZE_AND_SHUTDOWN but haven't written VISION.md or signaled SERIALIZATION_COMPLETE. Finish serialization before stopping." >&2
      exit 2
    fi
    ;;
  codex|daft|kaneda|clair|miyamoto)
    # Builders: if they just got APPROVED, they MUST report to krs-one
    if [[ "$LAST_RECEIVED" == *"APPROVED"* ]]; then
      if [[ "$LAST_SENT" == *"IMPLEMENTATION_COMPLETE"* ]]; then
        exit 0
      fi
      echo "Your implementation was APPROVED but you haven't sent IMPLEMENTATION_COMPLETE to krs-one. Report your success before stopping." >&2
      exit 2
    fi
    # General liveness check
    RECENT=$(git -C "$ROOT" log --oneline --since="10 minutes ago" 2>/dev/null | head -1)
    if [[ -z "$RECENT" && "$LAST_TOOL" == "" ]]; then
      echo "You are stopping but no recent work or message was found. If you are finished, report status. If blocked, explain why." >&2
      exit 2
    fi
    ;;
esac

# Allow stop if they made any tool call this turn (they are working)
[[ -n "$LAST_TOOL" && "$LAST_TOOL" != "null" ]] && exit 0

exit 0
