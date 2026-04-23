#!/bin/bash
# nudge-inject.sh — delivery mechanism for watchdog deadlock nudges.
#
# Watchdog writes .kiln/tmp/pending-nudge.json with an additionalContext
# string. This hook fires on the next registered event (primarily
# PreToolUse) and emits that string to stdout in the platform hook
# format, which Claude Code reads and feeds into the agent's turn as a
# hook_additional_context attachment. The pending file is deleted on
# every invocation that sees it — consume once, never re-fire.
#
# Fail-open everywhere: malformed payloads, jq failures, missing fields
# all delete-and-exit-0 rather than leaving the nudge to re-fire on a
# later hook and potentially spam the model. Exit 2 would be the
# blocking-error path and starves the nudge channel (see spike §
# "Edge cases"), so every branch exits 0.
#
# stdout shape (confirmed in p2-00 spike transcript):
#   {"hookSpecificOutput": {"hookEventName": "<event>", "additionalContext": "<text>"}}
# hookEventName must match the actual event — pulled from the stdin
# payload's hook_event_name, defaulting to PreToolUse since that's the
# primary wiring and the safe fallback.

. "$(dirname "$0")/_kiln-lib.sh"

INPUT=$(cat)

# ── Pipeline context gate ────────────────────────────────────
# Zero overhead outside active Kiln pipelines: no .kiln dir, no
# STATE.md, or stage=complete → silent no-op. _kiln_pipeline_active
# sets KILN_ROOT on success.
_kiln_pipeline_active || exit 0

# ── Atomic claim ─────────────────────────────────────────────
# mv is atomic on Linux (same filesystem). Two concurrent hook fires
# both seeing the pending file would otherwise emit the same nudge
# twice; the rename race ensures only the winner owns the content and
# all losers see ENOENT and silently exit.
PENDING="$KILN_ROOT/.kiln/tmp/pending-nudge.json"
CLAIMED="$KILN_ROOT/.kiln/tmp/pending-nudge.$$.claimed"
mv "$PENDING" "$CLAIMED" 2>/dev/null || exit 0

# ── Read additionalContext ───────────────────────────────────
# Missing/empty field → consume and discard (delete-and-exit) so a
# malformed nudge doesn't re-fire on every subsequent PreToolUse.
CONTEXT=$(jq -r '.additionalContext // ""' "$CLAIMED" 2>/dev/null)
if [[ -z "$CONTEXT" ]]; then
  rm -f "$CLAIMED"
  exit 0
fi

# ── Resolve event name ───────────────────────────────────────
# hookEventName in the output must match the firing event (spike
# observed Claude Code validates this). PreToolUse is the primary
# wiring and a safe default for any hook registered without a payload.
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // ""' 2>/dev/null)
[[ -n "$EVENT" ]] || EVENT="PreToolUse"

# ── Emit + consume ───────────────────────────────────────────
# jq --arg for safe string encoding; never hand-build JSON. Deletion
# happens unconditionally after the emit attempt — if jq fails we
# still consume the file so the nudge can't re-fire.
jq -cn --arg event "$EVENT" --arg ctx "$CONTEXT" \
  '{hookSpecificOutput: {hookEventName: $event, additionalContext: $ctx}}' \
  2>/dev/null

rm -f "$CLAIMED"
exit 0
