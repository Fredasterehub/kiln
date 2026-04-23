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

. "$(dirname "$0")/_kiln-lib.sh"
. "$(dirname "$0")/_kiln-agents.sh"

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // ""')
AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')
AGENT="${AGENT#kiln:}"

# Only SubagentStop is registered, but guard anyway
[[ "$EVENT" == "SubagentStop" ]] || exit 0

# ── Pipeline context gate + Kiln agent whitelist ─────────────
_kiln_pipeline_active || exit 0
_kiln_is_known_agent "$AGENT" || exit 0
ROOT="$KILN_ROOT"

# ── Terminal signal detection ────────────────────────────────
# last_assistant_message is the agent's final output before stopping.
# If it contains a terminal signal, the agent completed its work.
#
# WAVE 3: the reviewer enforcement block runs BEFORE this fast path —
# otherwise a reviewer's stray `APPROVED` LAST_MSG (without the paired
# IMPLEMENTATION_APPROVED to krs-one) would exit 0 here and skip the
# reviewer check. See the reviewer block below.
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""')

# ── Bossman MILESTONE_COMPLETE: verify iter-log ──────────────
# Moved in v1.5.3 from the retired audit-milestone.sh. Bossman must
# write a final iter-log.md entry with `result: milestone_complete`
# and `qa: PASS` before claiming a milestone is done. Exit 2 here
# rather than the audit's exit-0-with-stderr — PostToolUse exit 0
# hides stderr from the agent's transcript, so the original was only
# advisory in name; SubagentStop surfaces stderr reliably when exit 2
# blocks the stop, and the stop is refused until the ledger matches
# the claim. Runs before the fast-path MILESTONE_COMPLETE exit so the
# fast path can't bypass the ledger check. Patterns are fixed-string
# (grep -F) with no line anchor so a single combined
# `result: milestone_complete, qa: PASS` line passes both checks —
# that's the shape the fixtures seed and bossman writes in practice.
if [[ "$AGENT" == "bossman" ]] && [[ "$LAST_MSG" == *MILESTONE_COMPLETE* ]]; then
  ITER_LOG="$ROOT/.kiln/docs/iter-log.md"
  if [[ ! -f "$ITER_LOG" ]]; then
    echo "You signaled MILESTONE_COMPLETE but .kiln/docs/iter-log.md does not exist. Write the iteration ledger entry before stopping." >&2
    exit 2
  fi
  LAST_HEADER_LINE=$(grep -n '^## Iteration' "$ITER_LOG" | tail -1 | cut -d: -f1)
  if [[ -z "$LAST_HEADER_LINE" ]]; then
    echo "You signaled MILESTONE_COMPLETE but iter-log.md has no '## Iteration' entries. Add the final entry before stopping." >&2
    exit 2
  fi
  LAST_ENTRY=$(tail -n +"$LAST_HEADER_LINE" "$ITER_LOG")
  if ! echo "$LAST_ENTRY" | grep -qiF 'result: milestone_complete'; then
    echo "You signaled MILESTONE_COMPLETE but iter-log.md last entry does not show 'result: milestone_complete'. Update the ledger before stopping." >&2
    exit 2
  fi
  if ! echo "$LAST_ENTRY" | grep -qiF 'qa: PASS'; then
    echo "You signaled MILESTONE_COMPLETE but iter-log.md last entry does not show 'qa: PASS'. QA must pass before claiming milestone completion." >&2
    exit 2
  fi
fi

case "$AGENT" in
  critical-thinker|the-curator)
    # Fall through to the reviewer block; do not fast-path on terminal
    # signals. The reviewer block re-evaluates the IMPLEMENTATION_APPROVED
    # pairing against the full transcript and is stricter than a
    # substring allowlist.
    ;;
  *)
    case "$LAST_MSG" in
      *ONBOARDING_COMPLETE*|*BRAINSTORM_COMPLETE*|*RESEARCH_COMPLETE*|\
      *ARCHITECTURE_COMPLETE*|*ITERATION_COMPLETE*|*MILESTONE_COMPLETE*|\
      *BUILD_COMPLETE*|*VALIDATE_PASS*|*VALIDATE_FAILED*|*REPORT_COMPLETE*|\
      *READY_BOOTSTRAP*|*READY:*|*WORKER_READY*|\
      *IMPLEMENTATION_APPROVED*|*IMPLEMENTATION_COMPLETE*|\
      *IMPLEMENTATION_BLOCKED*|*IMPLEMENTATION_REJECTED*|\
      *REVIEW_REQUEST*|*APPROVED*|*REJECTED*|\
      *SERIALIZATION_COMPLETE*|*ITERATION_UPDATE*|\
      *MILESTONE_TRANSITION*|*CYCLE_WORKERS*|*WORKERS_SPAWNED*|\
      *QA_REPORT_READY*|*RECONCILIATION_COMPLETE*|*QA_PASS*|*QA_FAIL*|\
      *PLAN_READY*|*DIVERGENCE_READY*|*SYNTHESIS_COMPLETE*|*VALIDATION_PASS*|\
      *VALIDATION_FAIL*|*DOCS_UPDATED*|*MAPPING_COMPLETE*|*SCOUT_REPORT*|\
      *MISSION_COMPLETE*|*REVISION_NEEDED*|*DESIGN_QA_COMPLETE*)
        exit 0
        ;;
    esac
    ;;
esac

# ── Per-role deliverable checks ──────────────────────────────

# Persistent minds: must have status marker before stopping.
# Terminal signals (MILESTONE_COMPLETE, MILESTONE_TRANSITION) are caught
# above — persistent minds can always stop at milestone boundaries.
case "$AGENT" in
  dropping-science)
    if [[ -f "$ROOT/.kiln/docs/codebase-state.md" ]]; then
      head -1 "$ROOT/.kiln/docs/codebase-state.md" | grep -qF '<!-- status: complete -->' && exit 0
    fi
    echo "You are stopping but codebase-state.md is missing or has no <!-- status: complete --> marker on line 1. Write your state file before stopping." >&2
    exit 2
    ;;
  algalon-the-observer)
    if [[ -f "$ROOT/.kiln/docs/patterns.md" ]]; then
      head -1 "$ROOT/.kiln/docs/patterns.md" | grep -qF '<!-- status: complete -->' && exit 0
    fi
    echo "You are stopping but patterns.md is missing or has no <!-- status: complete --> marker on line 1. Write your patterns file before stopping." >&2
    exit 2
    ;;
  pitie-pas-les-crocos)
    if [[ -f "$ROOT/.kiln/docs/architecture.md" ]]; then
      head -1 "$ROOT/.kiln/docs/architecture.md" | grep -qF '<!-- status: complete -->' && exit 0
    fi
    echo "You are stopping but architecture.md is missing or has no <!-- status: complete --> marker on line 1. Write your architecture file before stopping." >&2
    exit 2
    ;;
esac

# the-foundation: if SERIALIZE_AND_SHUTDOWN was requested, must have delivered
case "$AGENT" in
  the-foundation)
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

# Builders: Wave 3 contract — on APPROVED, the builder commits and stops
# silently. The PAIRED REVIEWER owns the IMPLEMENTATION_APPROVED → krs-one
# handoff, so the hook no longer demands a terminal signal from the builder
# after APPROVED. See kiln-protocol SKILL.md § Worker Signals and the
# audit entry C8 in PLUMBING-AUDIT-v1.3.0.md for the rationale.
# (No commit-recency check either — team-protocol.md blocking policy rule 5:
#  "No SubagentStop checks on builder commit history." The reviewer is the
#  quality gate, not the hook.)

# Reviewers: on every APPROVED verdict, must emit a paired
# IMPLEMENTATION_APPROVED to krs-one (Wave 3). This is the new
# enforcement point — the reviewer owns the success handoff.
#
# Contract: every `APPROVED:` the reviewer sent to the builder must be
# paired with an `IMPLEMENTATION_APPROVED:` to krs-one. The reviewer may
# have rejected earlier chunks in the same session (reject → fix →
# approve is the normal flow), so a global `no REJECTED ever` heuristic
# would let reject-then-approve sessions bypass the pairing check.
# Instead: count the string occurrences directly.
#
#   grep -cF 'APPROVED:' — matches BOTH the reviewer's 'APPROVED: ...'
#   verdict to the builder AND the 'IMPLEMENTATION_APPROVED: ...' send
#   to krs-one (the second is a superstring of the first).
#
#   Therefore:
#     approvals_to_builder = total_APPROVED - IMPLEMENTATION_APPROVED
#   And the pairing invariant is:
#     approvals_to_builder == IMPLEMENTATION_APPROVED
#
# Any unpaired APPROVED means the reviewer notified the builder but
# did NOT notify krs-one, and the build loop is about to stall.
case "$AGENT" in
  critical-thinker|the-curator)
    TRANSCRIPT=$(echo "$INPUT" | jq -r '.agent_transcript_path // ""')
    if [[ -f "$TRANSCRIPT" ]]; then
      ALL_APPROVED=$(grep -cF 'APPROVED:' "$TRANSCRIPT" 2>/dev/null || echo 0)
      IMPL_APPROVED=$(grep -cF 'IMPLEMENTATION_APPROVED:' "$TRANSCRIPT" 2>/dev/null || echo 0)
      # Include LAST_MSG in case it hasn't flushed to transcript yet
      if echo "$LAST_MSG" | grep -qF 'IMPLEMENTATION_APPROVED:'; then
        IMPL_APPROVED=$((IMPL_APPROVED + 1))
        ALL_APPROVED=$((ALL_APPROVED + 1))
      elif echo "$LAST_MSG" | grep -qF 'APPROVED:'; then
        ALL_APPROVED=$((ALL_APPROVED + 1))
      fi
      APPROVALS_TO_BUILDER=$((ALL_APPROVED - IMPL_APPROVED))
      if (( APPROVALS_TO_BUILDER > IMPL_APPROVED )); then
        UNPAIRED=$((APPROVALS_TO_BUILDER - IMPL_APPROVED))
        echo "You issued ${APPROVALS_TO_BUILDER} APPROVED verdict(s) to the builder but only ${IMPL_APPROVED} IMPLEMENTATION_APPROVED message(s) to krs-one — ${UNPAIRED} unpaired. Wave 3 contract: every APPROVED MUST be paired with IMPLEMENTATION_APPROVED to krs-one. Send the missing handoff(s) before stopping." >&2
        exit 2
      fi
    fi
    ;;
esac

# Bosses during their active stage: should have sent a terminal signal.
# We can't easily verify this from a hook, so allow stop for bosses.
# The engine's watchdog protocol (Layer 2) handles boss stalls.

# All other agents: allow stop
exit 0
