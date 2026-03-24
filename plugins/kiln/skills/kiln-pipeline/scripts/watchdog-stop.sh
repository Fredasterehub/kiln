#!/bin/bash
# watchdog-stop.sh — Stop/SubagentStop hook for Kiln pipeline
#
# Prevents the engine or any pipeline agent from stopping while the
# pipeline is active and their work is incomplete.
#
# Stop:         engine tries to stop → check pipeline active
# SubagentStop: agent tries to stop  → check deliverable exists
#
# Stateless. Reads .kiln/STATE.md for pipeline state.
# Exit 0 = allow stop. Exit 2 = block stop (stderr = nudge message).

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // ""')
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

# Pipeline is active. Now decide based on event type.

# ═══════════════════════════════════════════════════════════════
# STOP — engine (main session) trying to stop
# ═══════════════════════════════════════════════════════════════
if [[ "$EVENT" == "Stop" ]]; then
  cat >&2 <<MSG
Pipeline is active (stage: $_STAGE). Do not stop.

Run your watchdog protocol:
1. Check TaskList — what is the current in_progress task?
2. Scan received messages for the expected signal (may be malformed).
3. If an agent sent a wrong signal, reply with the correct format.
4. If an agent is silent, send ONE nudge with the expected action.
5. After 3 nudges with no progress, report stall to operator.
MSG
  exit 2
fi

# ═══════════════════════════════════════════════════════════════
# SUBAGENT STOP — a pipeline agent trying to stop
# ═══════════════════════════════════════════════════════════════
if [[ "$EVENT" == "SubagentStop" ]]; then
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

  # Builders: must have committed something
  case "$AGENT" in
    codex|daft|kaneda|clair|miyamoto)
      # Check if there's a commit in the last 30 minutes from anyone
      # (builders don't sign commits, so we check recency as proxy)
      RECENT=$(git -C "$ROOT" log --oneline --since="30 minutes ago" 2>/dev/null | head -1)
      if [[ -n "$RECENT" ]]; then
        exit 0 # a recent commit exists, allow stop
      fi
      echo "You are stopping but no commit was found in the last 30 minutes. Verify your changes are committed before stopping. Run: git add -A && git commit -m 'description'" >&2
      exit 2
      ;;
  esac

  # Bosses during their active stage: should have sent a terminal signal
  # We can't easily verify this from a hook, so allow stop for bosses.
  # The engine's watchdog protocol (Layer 2) handles boss stalls.

  # All other agents: allow stop
  exit 0
fi

# Unknown event — allow
exit 0
