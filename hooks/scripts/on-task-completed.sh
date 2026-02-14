#!/bin/sh
# kiln on-task-completed hook
# Runs mini-verify gate: executes project test suite after each task

if [ ! -d ".kiln" ] || [ ! -f ".kiln/config.json" ]; then
  exit 0
fi
test_cmd=$(grep '"testRunner"[[:space:]]*:' ".kiln/config.json" | head -n 1 | sed -n 's/.*"testRunner"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [ -z "$test_cmd" ]; then
  echo "[kiln] No test runner configured, skipping mini-verify"
  exit 0
fi
cmd_name=$(printf '%s\n' "$test_cmd" | awk '{print $1}')
if [ -z "$cmd_name" ] || ! command -v "$cmd_name" >/dev/null 2>&1; then
  echo "[kiln] Warning: test command '$cmd_name' not found"
  exit 0
fi
timeout_seconds="${KILN_MINI_VERIFY_TIMEOUT:-120}"
tmp_dir="${TMPDIR:-/tmp}/kiln-mini-verify-$$"
stdout_log="$tmp_dir/stdout.log"
stderr_log="$tmp_dir/stderr.log"
timeout_flag="$tmp_dir/timeout.flag"
mkdir -p "$tmp_dir" 2>/dev/null || exit 0
cleanup() { rm -rf "$tmp_dir" >/dev/null 2>&1; }
trap cleanup EXIT INT TERM
run_code=0
timed_out=0
if command -v timeout >/dev/null 2>&1; then
  timeout "$timeout_seconds" sh -c "$test_cmd" >"$stdout_log" 2>"$stderr_log"
  run_code=$?
  [ "$run_code" -eq 124 ] || [ "$run_code" -eq 137 ] && timed_out=1
else
  sh -c "$test_cmd" >"$stdout_log" 2>"$stderr_log" &
  test_pid=$!
  (
    sleep "$timeout_seconds"
    if kill -0 "$test_pid" 2>/dev/null; then
      echo "1" >"$timeout_flag"
      kill "$test_pid" 2>/dev/null
      sleep 1
      kill -9 "$test_pid" 2>/dev/null
    fi
  ) &
  watchdog_pid=$!
  wait "$test_pid"
  run_code=$?
  kill "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null
  [ -f "$timeout_flag" ] && timed_out=1
fi
if [ "$timed_out" -eq 1 ]; then
  echo "[kiln] Mini-verify: TIMEOUT (exceeded ${timeout_seconds}s)"
  echo "Test command: $test_cmd"
  echo "Consider increasing timeout or checking for hanging tests."
  exit 0
fi
if [ "$run_code" -eq 0 ]; then
  echo "[kiln] Mini-verify: PASS"
  exit 0
fi
echo "[kiln] Mini-verify: FAIL"
echo "Test command: $test_cmd"
echo "Exit code: $run_code"
echo "Last output:"
 [ -s "$stdout_log" ] && tail -n 50 "$stdout_log"
 [ -s "$stderr_log" ] && tail -n 20 "$stderr_log"
echo ""
echo "Fix the failing tests before proceeding."
exit 0
