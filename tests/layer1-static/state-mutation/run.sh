#!/bin/bash
# state-mutation/run.sh — verify Wave 3 (C10) STATE.md sed patterns
# actually mutate the real markdown-bullet field format used by the
# pipeline. Pre-Wave-3 patterns targeted plain `field: N` and silently
# no-oped against `- **field**: N`, so counters never advanced.
#
# This test reconstructs the bossman chunk_count increment and the
# engine milestone-transition reset against the same mock STATE.md the
# hook fixtures use, and asserts the values actually change.

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"

PASS=0
FAIL=0
FAILED=()

mktempdir() {
  mktemp -d -t kiln-state-mutation-XXXXXX
}

seed_state() {
  # $1 = dir, $2 = team_iteration value, $3 = chunk_count value
  cat > "$1/.kiln/STATE.md" <<EOF
# Kiln State

## Pipeline
- **skill**: ${REPO_ROOT}/plugins/kiln/skills/kiln-pipeline/SKILL.md
- **roster**: ${REPO_ROOT}/plugins/kiln/skills/kiln-pipeline/references/blueprints/step-5-build.md
- **stage**: build
- **team_iteration**: $2
- **chunk_count**: $3
- **correction_cycle**: 0
- **milestone_count**: 2
- **milestones_complete**: 0
- **plugin_version**: 1.3.0
- **run_id**: kiln-test-sed
- **started**: 2026-04-17
- **updated**: 2026-04-17T00:00:00Z

## Project
- **Name**: Test Project
- **Type**: greenfield
- **Path**: $1

## Flags
- **greenfield**: true
- **codex_available**: true
- **arch_review**: auto-proceed
EOF
}

check_field() {
  # $1 = file, $2 = field name, $3 = expected value
  local got
  got=$(grep -oP "(?<=\*\*$2\*\*:\s)[0-9]+" "$1" | head -1)
  if [[ "$got" != "$3" ]]; then
    echo "       field $2: got '$got', expected '$3'"
    return 1
  fi
  return 0
}

test_bossman_chunk_increment() {
  local name="bossman-chunk-increment"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln"
  seed_state "$tmp" 2 3
  (
    cd "$tmp" || exit 1
    CHUNK=$(grep -oP '(?<=\*\*chunk_count\*\*:\s)[0-9]+' .kiln/STATE.md | head -1)
    CHUNK=$((CHUNK + 1))
    sed -i -E "s/(\*\*chunk_count\*\*:[[:space:]]*)[0-9]+/\1${CHUNK}/" .kiln/STATE.md
  )
  local ok=1
  check_field "$tmp/.kiln/STATE.md" "chunk_count" "4" || ok=0
  check_field "$tmp/.kiln/STATE.md" "team_iteration" "2" || ok=0  # unchanged
  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

test_milestone_transition_reset() {
  local name="milestone-transition-team-iter-bump-and-chunk-reset"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln"
  seed_state "$tmp" 2 7
  (
    cd "$tmp" || exit 1
    CURRENT_TEAM_ITER=$(grep -oP '(?<=\*\*team_iteration\*\*:\s)[0-9]+' .kiln/STATE.md | head -1)
    NEW_TEAM_ITER=$((CURRENT_TEAM_ITER + 1))
    sed -i -E "s/(\*\*team_iteration\*\*:[[:space:]]*)[0-9]+/\1${NEW_TEAM_ITER}/" .kiln/STATE.md
    sed -i -E "s/(\*\*chunk_count\*\*:[[:space:]]*)[0-9]+/\10/" .kiln/STATE.md
  )
  local ok=1
  check_field "$tmp/.kiln/STATE.md" "team_iteration" "3" || ok=0
  check_field "$tmp/.kiln/STATE.md" "chunk_count" "0" || ok=0
  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

test_pre_wave3_pattern_would_noop() {
  # Regression lock: the retired pre-Wave-3 sed shape targeting
  # plain `chunk_count:` MUST silently no-op against markdown-bullet
  # state. If someone reintroduces that pattern, this test catches it.
  local name="pre-wave3-plain-pattern-noops-as-expected"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln"
  seed_state "$tmp" 1 5
  (
    cd "$tmp" || exit 1
    # Legacy (broken) sed — does not account for markdown bullet wrapping
    sed -i "s/chunk_count: [0-9]*/chunk_count: 99/" .kiln/STATE.md
  )
  local ok=1
  check_field "$tmp/.kiln/STATE.md" "chunk_count" "5" || ok=0
  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    echo "       Pre-Wave-3 pattern unexpectedly mutated — the bullet shape may have changed."
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

test_activity_json_atomic_write() {
  local name="activity-json-atomic-write"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln/tmp"

  local ACTIVITY="$tmp/.kiln/tmp/activity.json"
  local TMP_FILE="$ACTIVITY.$$.tmp"
  local NOW=1713379200

  echo '{}' | jq --arg ts "$NOW" --arg src "PostToolUse:SendMessage" --arg phase "build" \
    '(.last_activity_ts = ($ts | tonumber)) | (.epoch = 1) | (.last_nudge_ts = 0) | (.nudge_count = 0)
     | (.last_activity_source = $src) | (.pipeline_phase = $phase) | (.active_teammates = {})' \
    > "$TMP_FILE" 2>/dev/null && mv "$TMP_FILE" "$ACTIVITY"

  local ok=1
  if ! jq empty "$ACTIVITY" 2>/dev/null; then
    echo "       activity.json is not valid JSON"
    ok=0
  fi
  local got_ts got_epoch got_phase
  got_ts=$(jq -r '.last_activity_ts // "missing"' "$ACTIVITY" 2>/dev/null)
  got_epoch=$(jq -r '.epoch // "missing"' "$ACTIVITY" 2>/dev/null)
  got_phase=$(jq -r '.pipeline_phase // "missing"' "$ACTIVITY" 2>/dev/null)
  [[ "$got_ts" == "$NOW" ]] || { echo "       last_activity_ts: got '$got_ts', expected '$NOW'"; ok=0; }
  [[ "$got_epoch" == "1" ]] || { echo "       epoch: got '$got_epoch', expected '1'"; ok=0; }
  [[ "$got_phase" == "build" ]] || { echo "       pipeline_phase: got '$got_phase', expected 'build'"; ok=0; }
  local got_src got_teammates got_nudge_ts got_nudge_count
  got_src=$(jq -r '.last_activity_source // "missing"' "$ACTIVITY" 2>/dev/null)
  got_teammates=$(jq -r '.active_teammates // "missing"' "$ACTIVITY" 2>/dev/null)
  got_nudge_ts=$(jq -r '.last_nudge_ts // "missing"' "$ACTIVITY" 2>/dev/null)
  got_nudge_count=$(jq -r '.nudge_count // "missing"' "$ACTIVITY" 2>/dev/null)
  [[ "$got_src" == "PostToolUse:SendMessage" ]] || { echo "       last_activity_source: got '$got_src', expected 'PostToolUse:SendMessage'"; ok=0; }
  [[ "$got_teammates" == "{}" ]] || { echo "       active_teammates: got '$got_teammates', expected '{}'"; ok=0; }
  [[ "$got_nudge_ts" == "0" ]] || { echo "       last_nudge_ts: got '$got_nudge_ts', expected '0'"; ok=0; }
  [[ "$got_nudge_count" == "0" ]] || { echo "       nudge_count: got '$got_nudge_count', expected '0'"; ok=0; }
  if ls "$tmp/.kiln/tmp/"*.tmp 2>/dev/null | grep -q .; then
    echo "       temp file left behind after atomic write"
    ok=0
  fi

  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

test_activity_json_concurrent_write_no_clobber() {
  local name="activity-json-concurrent-write-no-clobber"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln/tmp"

  local ACTIVITY="$tmp/.kiln/tmp/activity.json"
  local LOCK="$tmp/.kiln/tmp/activity.lock"

  echo '{"epoch": 0, "nudge_count": 0, "last_nudge_ts": 0, "active_teammates": {}}' > "$ACTIVITY"

  local i
  for i in $(seq 1 20); do
    (
      local TMP_FILE="$ACTIVITY.$$.tmp"
      (
        flock -x 9
        local EXISTING
        EXISTING=$(cat "$ACTIVITY" 2>/dev/null) || exit 0
        [[ -n "$EXISTING" ]] || exit 0
        echo "$EXISTING" | jq --arg ts "$((1713379200 + i))" \
          '(.last_activity_ts = ($ts | tonumber)) | (.epoch = ((.epoch // 0) + 1))' \
          > "$TMP_FILE" 2>/dev/null && mv "$TMP_FILE" "$ACTIVITY" || rm -f "$TMP_FILE"
      ) 9>"$LOCK"
    ) &
  done
  wait

  local ok=1
  if ! jq empty "$ACTIVITY" 2>/dev/null; then
    echo "       activity.json corrupted after concurrent writes"
    ok=0
  fi
  local got_epoch
  got_epoch=$(jq -r '.epoch // 0' "$ACTIVITY" 2>/dev/null)
  if [[ "$got_epoch" -ne 20 ]]; then
    echo "       epoch=$got_epoch after 20 concurrent writers — expected 20 (some writes dropped)"
    ok=0
  fi
  if ls "$tmp/.kiln/tmp/"*.tmp 2>/dev/null | grep -q .; then
    echo "       temp files left behind after concurrent writes"
    ok=0
  fi

  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

test_activity_json_failed_write_no_clobber() {
  local name="activity-json-failed-write-no-clobber"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln/tmp"

  local ACTIVITY="$tmp/.kiln/tmp/activity.json"
  local TMP_FILE="$ACTIVITY.$$.tmp"

  echo '{"epoch": 5, "last_activity_ts": 1713379200}' > "$ACTIVITY"

  echo '{}' | jq 'this_is_not_valid_jq_syntax' > "$TMP_FILE" 2>/dev/null || rm -f "$TMP_FILE"

  local ok=1
  if ! jq empty "$ACTIVITY" 2>/dev/null; then
    echo "       activity.json corrupted after failed write attempt"
    ok=0
  fi
  local got_epoch
  got_epoch=$(jq -r '.epoch // "missing"' "$ACTIVITY" 2>/dev/null)
  [[ "$got_epoch" == "5" ]] || { echo "       epoch: got '$got_epoch', expected '5' (original untouched)"; ok=0; }
  if [[ -f "$TMP_FILE" ]]; then
    echo "       temp file not cleaned up after failed write"
    ok=0
  fi

  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

test_ensure_watchdog_starts_after_state_creation() {
  local name="ensure-watchdog-starts-after-state-creation"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln"
  seed_state "$tmp" 1 0

  (
    cd "$tmp" || exit 1
    printf '{"hook_event_name":"PostToolUse","tool_name":"Write"}' \
      | bash "$REPO_ROOT/plugins/kiln/hooks/ensure-watchdog.sh"
  )

  local ok=1
  local pid_file="$tmp/.kiln/tmp/watchdog.pid"
  if [[ ! -f "$pid_file" ]]; then
    echo "       watchdog.pid was not created"
    ok=0
  else
    local pid
    pid=$(cat "$pid_file" 2>/dev/null)
    if [[ -z "$pid" ]]; then
      echo "       watchdog.pid is empty"
      ok=0
    elif [[ ! -r "/proc/$pid/cmdline" ]] || ! grep -q "watchdog-loop" "/proc/$pid/cmdline" 2>/dev/null; then
      echo "       pid '$pid' is not a live watchdog-loop process"
      ok=0
    fi
    [[ -n "${pid:-}" ]] && kill "$pid" 2>/dev/null || true
  fi

  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

test_async_rewake_exits_2_on_deadlock() {
  local name="async-rewake-exits-2-on-deadlock"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln/tmp"
  seed_state "$tmp" 1 0

  local old_ts
  old_ts=$(( $(date +%s) - 700 ))
  cat > "$tmp/.kiln/tmp/activity.json" <<EOF
{
  "last_activity_ts": $old_ts,
  "last_activity_source": "SubagentStop:dial-a-coder",
  "active_teammates": {},
  "last_nudge_ts": 0,
  "nudge_count": 0,
  "epoch": 1,
  "pipeline_phase": "build"
}
EOF

  local stderr_file="$tmp/stderr.txt"
  local stdout_file="$tmp/stdout.txt"
  local rc
  (
    cd "$tmp" || exit 1
    KILN_ASYNC_REWAKE_ONCE=1 \
      printf '{"hook_event_name":"SessionStart"}' \
      | KILN_ASYNC_REWAKE_ONCE=1 bash "$REPO_ROOT/plugins/kiln/hooks/async-rewake-watchdog.sh" \
        > "$stdout_file" 2> "$stderr_file"
  )
  rc=$?

  local ok=1
  if [[ "$rc" -ne 2 ]]; then
    echo "       exit code: got '$rc', expected '2'"
    ok=0
  fi
  if ! grep -q "KILN ASYNC REWAKE: KILN DEADLOCK WATCHDOG" "$stderr_file"; then
    echo "       stderr missing async rewake deadlock message"
    ok=0
  fi
  if [[ ! -f "$tmp/.kiln/tmp/pending-nudge.json" ]]; then
    echo "       pending-nudge.json was not staged"
    ok=0
  fi
  if [[ -d "$tmp/.kiln/tmp/async-rewake-watchdog.lock" ]]; then
    echo "       async rewake lock was not cleaned up"
    ok=0
  fi

  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

echo "── State-mutation tests ─────────────────"
echo "  chunk_count / team_iteration sed patterns"
test_bossman_chunk_increment
test_milestone_transition_reset
test_pre_wave3_pattern_would_noop
echo ""
echo "  activity.json atomic-write patterns"
test_activity_json_atomic_write
test_activity_json_concurrent_write_no_clobber
test_activity_json_failed_write_no_clobber
echo ""
echo "  watchdog startup"
test_ensure_watchdog_starts_after_state_creation
test_async_rewake_exits_2_on_deadlock
echo ""
echo "State-mutation: ${PASS} passed, ${FAIL} failed"
if (( FAIL > 0 )); then
  echo "Failed:"
  for n in "${FAILED[@]}"; do
    echo "  $n"
  done
  exit 1
fi
exit 0
