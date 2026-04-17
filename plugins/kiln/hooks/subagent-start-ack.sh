#!/bin/bash
# subagent-start-ack.sh — SubagentStart hook for Kiln pipeline
#
# Deterministic spawn acknowledgement. Fires ~90ms after the Agent tool
# call returns and ~30ms before the subagent's first PreToolUse, so any
# additionalContext emitted here lands in the subagent's first turn.
#
# Replaces the WORKER_READY belt-and-suspenders path for CYCLE_WORKERS
# unblock: instead of relying on the freshly-spawned worker to emit a
# one-time signal, the platform itself fires this event and the engine
# unblocks on the additionalContext injection. WORKERS_SPAWNED stays
# operator-visible for logging; the engine-internal unblock moves here.
#
# SubagentStart payload: session_id, transcript_path, cwd, agent_id,
#   agent_type, hook_event_name. team_name is NOT present — the engine
#   already knows team context from the spawning side.
#
# Stateless. Fail-open everywhere: this is a pre-turn notification, not
# a veto point. Every branch exits 0; malformed input, unknown agents,
# and missing pipeline context all route to a silent no-op rather than
# failing a spawn.
#
# Platform enforces a 5s timeout via hooks.json (matches advisory-hook
# precedent). Script has no set -e; every early-return is an explicit
# exit 0.

INPUT=$(cat)
AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""' 2>/dev/null)
AGENT="${AGENT#kiln:}"
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""' 2>/dev/null)

# ── Pipeline context gate ────────────────────────────────────
# Mirrors enforce-pipeline.sh:54-81. Only ack spawns during an active
# Kiln pipeline — outside a pipeline the hook is a silent no-op.
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

# ── Kiln agent whitelist ─────────────────────────────────────
# Mirrors enforce-pipeline.sh:86-98. Non-Kiln agents (Explore,
# statusline-setup, general-purpose, simplify-*) graceful no-op so the
# hook never injects additionalContext into unrelated subagents.
case "$AGENT" in
  the-beginning-of-the-end|the-discovery-begins|the-anatomist|trust-the-science|follow-the-scent|\
  the-creator|the-foundation|\
  alpha-team-deploy|unit-deployed|\
  the-plan-maker|pitie-pas-les-crocos|mystical-inspiration|art-of-war|divergences-converge|e-pluribus-unum|straight-outta-olympia|gracefully-degrading|\
  bossman|dropping-science|algalon-the-observer|lore-keepah|dial-a-coder|backup-coder|la-peintresse|critical-thinker|the-curator|\
  team-red|team-blue|the-negotiator|i-am-the-law|\
  release-the-giant|le-plexus-exploseur|style-maker|\
  the-end-of-the-beginning)
    ;; # known Kiln agent — fall through and emit
  *)
    exit 0 ;; # non-Kiln — graceful no-op
esac

# ── Emit additionalContext ───────────────────────────────────
# Engine consumes additionalContext from hook stdout and unblocks
# CYCLE_WORKERS on its own next turn. Empty stdout = silence; fail-open
# means worst case is silence, never a blocked spawn.
jq -cn --arg agent "$AGENT" --arg id "$AGENT_ID" \
  '{additionalContext: ("SubagentStart: agent_type=" + $agent + " agent_id=" + $id + " — spawn acknowledged")}' \
  2>/dev/null

exit 0
