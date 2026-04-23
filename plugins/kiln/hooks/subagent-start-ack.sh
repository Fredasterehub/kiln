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

. "$(dirname "$0")/_kiln-lib.sh"
. "$(dirname "$0")/_kiln-agents.sh"

INPUT=$(cat)
AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""' 2>/dev/null)
AGENT="${AGENT#kiln:}"
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""' 2>/dev/null)

# ── Pipeline context gate ────────────────────────────────────
# Only ack spawns during an active Kiln pipeline — outside a pipeline
# the hook is a silent no-op.
_kiln_pipeline_active || exit 0

# ── Kiln agent whitelist ─────────────────────────────────────
# Non-Kiln agents (Explore, statusline-setup, general-purpose,
# simplify-*) graceful no-op so the hook never injects
# additionalContext into unrelated subagents.
_kiln_is_known_agent "$AGENT" || exit 0

# ── Emit additionalContext ───────────────────────────────────
# Engine consumes additionalContext from hook stdout and unblocks
# CYCLE_WORKERS on its own next turn. Empty stdout = silence; fail-open
# means worst case is silence, never a blocked spawn.
jq -cn --arg agent "$AGENT" --arg id "$AGENT_ID" \
  '{additionalContext: ("SubagentStart: agent_type=" + $agent + " agent_id=" + $id + " — spawn acknowledged")}' \
  2>/dev/null

exit 0
