#!/bin/bash
# stop-guard.sh — Stop hook for Kiln pipeline
#
# Prevents pipeline agents from stopping while their work is incomplete.
# Checks deliverables per role: persistent minds need status markers,
# builders need a recent commit.
#
# Exit 0 = allow stop. Exit 2 = block stop (stderr = nudge message).

INPUT=$(cat)
# The Stop hook for agents usually provides agent_type or similar context.
# In Gemini CLI / Claude Code, the "Stop" hook is called when an agent's turn ends.
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

# Builders: must have committed something or sent a terminal signal
case "$AGENT" in
  codex|daft|kaneda|clair|miyamoto)
    # Check if there's a recent commit
    RECENT=$(git -C "$ROOT" log --oneline --since="15 minutes ago" 2>/dev/null | head -1)
    if [[ -n "$RECENT" ]]; then
      exit 0
    fi
    # If no commit, did they send a message? (This is harder to check from bash without message logs)
    # For now, nudge them to commit or explain.
    echo "You are stopping but no recent commit was found. If you finished your task, ensure changes are committed. If blocked, SendMessage to krs-one." >&2
    exit 2
    ;;
esac

exit 0
