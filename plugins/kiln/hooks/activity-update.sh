#!/bin/bash
# activity-update.sh — Shared state-file updater for Kiln deadlock watchdog
#
# Wired to: PreToolUse, PostToolUse, SubagentStart, SubagentStop,
# TeammateIdle, UserPromptSubmit. Maintains .kiln/tmp/activity.json as
# the single source of truth the detached watchdog polls for stall
# detection. Read + merge + atomic write on every fire so any
# concurrent hook invocation sees a consistent file.
#
# Schema (authoritative — tests, watchdog, and deadlock-check.sh rely on it):
#   last_activity_ts      unix epoch of this fire
#   last_activity_source  event name, or event:tool (e.g. PostToolUse:SendMessage)
#   active_teammates      { name: last_seen_ts } — SubagentStart adds,
#                         SubagentStop/TeammateIdle remove, others untouched.
#                         Key source varies by event: agent_type for
#                         SubagentStart/Stop (confirmed in P1 spike + stop-guard),
#                         teammate_name for TeammateIdle (P2 spike).
#   last_nudge_ts         managed by deadlock-check.sh; preserved here
#   nudge_count           managed by deadlock-check.sh; preserved here
#   epoch                 monotonic counter bumped on every update; lets the
#                         watchdog invalidate stale deadlock evaluations
#   pipeline_phase        stage value from STATE.md, or "unknown"
#
# Fail-open everywhere: this is an advisory state writer, never a veto.
# Every branch exits 0. Concurrent fires are serialized via flock on a
# dedicated .lock file so the read-modify-write critical section is not
# a TOCTOU race — otherwise two concurrent fires could both read the
# old file and the second mv would silently clobber the first's
# nudge_count / active_teammates mutations.

INPUT=$(cat)

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

TMP_DIR="$ROOT/.kiln/tmp"
mkdir -p "$TMP_DIR" 2>/dev/null || exit 0
ACTIVITY="$TMP_DIR/activity.json"
LOCK="$TMP_DIR/activity.lock"

NOW=$(date +%s)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // ""' 2>/dev/null)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)

# Teammate identifier source is authoritative per event — no cross-field
# fallback. SubagentStart / SubagentStop carry agent_type (confirmed in
# P1 spike and stop-guard.sh). TeammateIdle carries teammate_name (P2
# spike). If the expected field is absent, leave TEAMMATE empty and
# skip the mutation — schema drift should surface, not be papered over.
case "$EVENT" in
  SubagentStart|SubagentStop)
    TEAMMATE=$(echo "$INPUT" | jq -r '.agent_type // ""' 2>/dev/null)
    ;;
  TeammateIdle)
    TEAMMATE=$(echo "$INPUT" | jq -r '.teammate_name // ""' 2>/dev/null)
    ;;
  *)
    TEAMMATE=""
    ;;
esac
TEAMMATE="${TEAMMATE#kiln:}"

SOURCE="$EVENT"
[[ -n "$TOOL" ]] && SOURCE="${EVENT}:${TOOL}"
[[ -n "$SOURCE" ]] || SOURCE="unknown"

# Serialize the read-modify-write critical section so concurrent hook
# fires don't clobber each other. flock releases automatically when
# the subshell exits; the lock file lives next to activity.json in
# .kiln/tmp/ and is independent of the atomic-mv path.
#
# Seed + merge happen in a single jq pass. Defaults are filled via //
# so the very first fire — when activity.json does not yet exist —
# applies its teammate mutation like any other. A separate early-exit
# seed branch would drop the opening SubagentStart before
# active_teammates ever saw it.
(
  flock -x 9

  TMP="$ACTIVITY.$$.tmp"
  EXISTING="{}"
  [[ -f "$ACTIVITY" ]] && EXISTING=$(cat "$ACTIVITY" 2>/dev/null || echo "{}")
  [[ -n "$EXISTING" ]] || EXISTING="{}"

  echo "$EXISTING" | jq --arg ts "$NOW" \
     --arg src "$SOURCE" \
     --arg phase "$_STAGE" \
     --arg event "$EVENT" \
     --arg teammate "$TEAMMATE" \
     '(.last_activity_ts = ($ts | tonumber))
      | (.last_activity_source = $src)
      | (.pipeline_phase = $phase)
      | (.epoch = ((.epoch // 0) + 1))
      | (.active_teammates = (.active_teammates // {}))
      | (.last_nudge_ts = (.last_nudge_ts // 0))
      | (.nudge_count = (.nudge_count // 0))
      | if $event == "SubagentStart" and $teammate != "" then
          .active_teammates[$teammate] = ($ts | tonumber)
        elif ($event == "SubagentStop" or $event == "TeammateIdle") and $teammate != "" then
          del(.active_teammates[$teammate])
        else . end' \
     > "$TMP" 2>/dev/null \
    && mv "$TMP" "$ACTIVITY" \
    || rm -f "$TMP"
) 9>"$LOCK"

exit 0
