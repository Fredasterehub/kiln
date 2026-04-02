#!/bin/bash
# stop-guard.sh — SubagentStop hook for Kiln pipeline
#
# Prevents pipeline agents from stopping while their work is incomplete.
# Checks deliverables per role: persistent minds need status markers,
# builders need a recent commit or a terminal signal.
#
# Only handles SubagentStop — the Stop event (engine turn end) is never
# registered. Blocking Stop causes 100+ false positives per step.
# Engine stalls are handled by SKILL.md § 5 watchdog protocol (Layer 2).
#
# SubagentStop payload: agent_id, agent_type, agent_transcript_path,
#   last_assistant_message. NOTE: .history[] does NOT exist.
#
# Stateless. Reads .kiln/STATE.md for pipeline state.
# Exit 0 = allow stop. Exit 2 = block stop (stderr = nudge message).

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // ""')
AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')
AGENT="${AGENT#kiln:}"

# Only SubagentStop is registered, but guard anyway
[[ "$EVENT" == "SubagentStop" ]] || exit 0

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

# ── Terminal signal detection ────────────────────────────────
# last_assistant_message is the agent's final output before stopping.
# If it contains a terminal signal, the agent completed its work.
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""')

case "$LAST_MSG" in
  *ONBOARDING_COMPLETE*|*BRAINSTORM_COMPLETE*|*RESEARCH_COMPLETE*|\
  *ARCHITECTURE_COMPLETE*|*ITERATION_COMPLETE*|*MILESTONE_COMPLETE*|\
  *BUILD_COMPLETE*|*VALIDATE_PASS*|*VALIDATE_FAILED*|*REPORT_COMPLETE*|\
  *READY:*|*IMPLEMENTATION_COMPLETE*|*IMPLEMENTATION_BLOCKED*|\
  *REVIEW_REQUEST*|*APPROVED*|*REJECTED*|\
  *SERIALIZATION_COMPLETE*|*ITERATION_UPDATE*|\
  *MILESTONE_TRANSITION*|*CYCLE_WORKERS*|*WORKERS_SPAWNED*)
    exit 0
    ;;
esac

# ── Per-role deliverable checks ──────────────────────────────

# Persistent minds: must have status marker before stopping.
# Terminal signals (MILESTONE_COMPLETE, MILESTONE_TRANSITION) are caught
# above — persistent minds can always stop at milestone boundaries.
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

# Clio: if SERIALIZE_AND_SHUTDOWN was requested, must have delivered
case "$AGENT" in
  clio)
    # Check transcript for SERIALIZE_AND_SHUTDOWN request
    TRANSCRIPT=$(echo "$INPUT" | jq -r '.agent_transcript_path // ""')
    if [[ -f "$TRANSCRIPT" ]] && grep -qF 'SERIALIZE_AND_SHUTDOWN' "$TRANSCRIPT"; then
      if [[ -f "$ROOT/.kiln/docs/VISION.md" ]] && echo "$LAST_MSG" | grep -qF 'SERIALIZATION_COMPLETE'; then
        exit 0
      fi
      echo "You received SERIALIZE_AND_SHUTDOWN but haven't written VISION.md or signaled SERIALIZATION_COMPLETE. Finish serialization before stopping." >&2
      exit 2
    fi
    ;;
esac

# Builders: if they received APPROVED, must report IMPLEMENTATION_COMPLETE
case "$AGENT" in
  codex|daft|kaneda|clair|miyamoto)  # daft is dormant but kept for defensive safety
    TRANSCRIPT=$(echo "$INPUT" | jq -r '.agent_transcript_path // ""')
    if [[ -f "$TRANSCRIPT" ]] && grep -qF 'APPROVED' "$TRANSCRIPT"; then
      if echo "$LAST_MSG" | grep -qF 'IMPLEMENTATION_COMPLETE'; then
        exit 0
      fi
      echo "Your implementation was APPROVED but you haven't sent IMPLEMENTATION_COMPLETE to krs-one. Report your success before stopping." >&2
      exit 2
    fi
    # No commit-recency check — blocking-policy.md rule 5:
    # "No SubagentStop checks on builder commit history."
    # The reviewer is the quality gate, not the hook.
    ;;
esac

# Bosses during their active stage: should have sent a terminal signal.
# We can't easily verify this from a hook, so allow stop for bosses.
# The engine's watchdog protocol (Layer 2) handles boss stalls.

# All other agents: allow stop
exit 0
