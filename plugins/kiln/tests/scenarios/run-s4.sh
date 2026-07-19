#!/bin/bash
# BEHAVIOR scenario 4 — interruption. Kill the session immediately after the
# first slice seal; fresh session, no resumeFromRunId, native runtime state
# purged (phase one runs --no-session-persistence — CLI-receipted flag,
# claude 2.1.212 --help: "Disable session persistence" — so NO runtime state
# is ever persisted to purge); orchestration state from .kiln/ alone; the
# project workspace remains. Exit 0 = pass.
. "$(dirname "$0")/lib.sh"

WD=$(mktemp -d)
echo "S4 workdir: $WD"

# Phase 1: launch the S1 run in its own process group, persistence OFF (T-06);
# watch seals.log sub-second and kill AT the first seal (T-05).
( cd "$WD" && exec setsid timeout "$RUN_TIMEOUT" claude -p "$S1_INVOCATION" \
    --plugin-dir "$KILN_PLUGIN_DIR" --permission-mode bypassPermissions \
    --no-session-persistence \
    --output-format stream-json --verbose </dev/null >"$WD/transcript1.jsonl" 2>"$WD/transcript1.err" ) &
PID=$!
until [ -s "$WD/.kiln/seals.log" ]; do
  kill -0 "$PID" 2>/dev/null || fail "run died before the first slice seal"
  sleep 0.2
done
PGID=$(ps -o pgid= "$PID" | tr -d ' ')
kill -TERM -- "-$PGID" 2>/dev/null; sleep 3; kill -KILL -- "-$PGID" 2>/dev/null
wait "$PID" 2>/dev/null

beats "$WD/transcript1.jsonl" | grep -iE 'driver' | grep -qE '[0-9]+' \
  && fail "run completed before the kill — no interruption occurred"
SID1=$(jq -r 'select(.session_id) | .session_id' "$WD/transcript1.jsonl" | head -1)

# Phase 2: a fresh session resumes from .kiln/ alone (bare invocation on an
# existing .kiln/ is the sealed conductor's resume path; no resume flags).
launch_run "$WD" '/kiln:kiln-fire' "$WD/transcript2.jsonl"
SID2=$(jq -r 'select(.session_id) | .session_id' "$WD/transcript2.jsonl" | head -1)
[ -n "$SID2" ] && [ "$SID1" != "$SID2" ] || fail "resume did not run in a fresh session"

beats "$WD/transcript2.jsonl" | grep -iE 'driver' | grep -qE '[0-9]+' \
  || fail "resumed run never spoke the completion line"
assert_s1_artifacts "$WD"

echo "S4 PASS (killed after first seal, fresh session completed from .kiln/ alone)"
