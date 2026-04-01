#!/bin/bash
# stop-guard.sh — Stop hook for Kiln pipeline
#
# Prevents pipeline agents from stopping while their work is incomplete.
# Checks deliverables per role: persistent minds need status markers,
# builders need a recent commit or a terminal signal.
#
# Exit 0 = allow stop. Exit 2 = block stop (stderr = nudge message).

INPUT=$(cat)
AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')
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
# Check if the agent sent a message or wrote a file in its LAST action.
LAST_TOOL=$(echo "$INPUT" | jq -r '.history[-1].tool_name // ""')
LAST_CONTENT=$(echo "$INPUT" | jq -r '.history[-1].tool_input.content // ""')

# If they sent a terminal signal, always allow stop.
case "$LAST_CONTENT" in
  *ONBOARDING_COMPLETE*|*BRAINSTORM_COMPLETE*|*RESEARCH_COMPLETE*|*ARCHITECTURE_COMPLETE*|*ITERATION_COMPLETE*|*MILESTONE_COMPLETE*|*BUILD_COMPLETE*|*VALIDATE_PASS*|*VALIDATE_FAILED*|*REPORT_COMPLETE*|*READY:*|*IMPLEMENTATION_COMPLETE*|*REVIEW_REQUEST*|*APPROVED*|*REJECTED*)
    exit 0
    ;;
esac

# ── Per-role deliverable checks ──────────────────────────────

# Persistent minds: must have status marker before stopping
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
esac

# Builders: must have committed something or sent a terminal signal (handled above)
case "$AGENT" in
  codex|daft|kaneda|clair|miyamoto)
    # If they didn't send a signal, did they at least commit recently?
    RECENT=$(git -C "$ROOT" log --oneline --since="10 minutes ago" 2>/dev/null | head -1)
    if [[ -n "$RECENT" ]]; then
      # They committed, but did they report it? 
      # If they are stopping without SendMessage, they might be multi-turning.
      # Allow if they at least did a tool call this turn.
      [[ "$LAST_TOOL" != "null" && -n "$LAST_TOOL" ]] && exit 0
    fi
    
    echo "You are stopping but no recent commit or report was found. Ensure your work is committed and report status via SendMessage before stopping." >&2
    exit 2
    ;;
esac

# All other agents: allow stop if they did SOMETHING this turn
[[ "$LAST_TOOL" != "null" && -n "$LAST_TOOL" ]] && exit 0

# If they did NOTHING and are stopping, block it (unless they are waiting for a reply)
# But wait, how do we know they are waiting?
# Usually, if they are waiting, their last tool was SendMessage.
if [[ "$LAST_TOOL" == "" || "$LAST_TOOL" == "null" ]]; then
    echo "You are stopping without taking any action. If you are waiting for a reply, your last action should have been SendMessage. If you are finished, send a terminal signal." >&2
    exit 2
fi

exit 0
