#!/bin/sh
# shellcheck disable=SC2059
# ANSI color codes
C_RESET='\033[0m'
C_BRAND='\033[38;5;173m'   # warm terracotta — kiln prefix
C_GREEN='\033[32m'          # pass/success
C_RED='\033[31m'            # fail/error
C_YELLOW='\033[33m'         # warning
C_DIM='\033[90m'            # skip/debounce (gray)

# kiln on-task-completed hook
# Runs mini-verify gate: executes project test suite after each task

# Skip mini-verify during Teams execution and in Teams worktrees.
if [ -n "${KILN_TEAMS_ACTIVE:-}" ]; then
  exit 0
fi
worktree_root="${KILN_WORKTREE_ROOT:-/tmp}"
cwd="${PWD:-$(pwd)}"
case "$cwd" in
  "${worktree_root%/}/kiln-"*) exit 0 ;;
esac

# Skip mini-verify if only .kiln/ files changed (no project files affected)
changed_files=$(git diff --name-only HEAD 2>/dev/null | grep -v '^\.kiln/' || true)
if [ -z "$changed_files" ]; then
  printf "${C_BRAND}[kiln]${C_RESET} Mini-verify ${C_DIM}○ skipped (no project files changed)${C_RESET}\n"
  exit 0
fi

# Debounce: skip if last run was < 10 seconds ago
cache_file=".kiln/mini-verify-cache.json"
if [ -f "$cache_file" ] && command -v node >/dev/null 2>&1; then
  last_epoch=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$cache_file','utf8'));process.stdout.write(String(c.last_run_epoch||0))}catch(e){process.stdout.write('0')}" 2>/dev/null || echo 0)
  now_epoch=$(date +%s 2>/dev/null || echo 0)
  if [ "$last_epoch" -gt 0 ] && [ "$now_epoch" -gt 0 ]; then
    elapsed=$((now_epoch - last_epoch))
    if [ "$elapsed" -lt 10 ]; then
      printf "${C_BRAND}[kiln]${C_RESET} Mini-verify ${C_DIM}○ debounced (%ss ago)${C_RESET}\n" "$elapsed"
      exit 0
    fi
  fi
fi

if [ ! -d ".kiln" ] || [ ! -f ".kiln/config.json" ]; then
  exit 0
fi
test_cmd=$(node -e 'try{const c=JSON.parse(require("fs").readFileSync(".kiln/config.json","utf8"));const r=c.tooling&&c.tooling["testRunner"];if(r&&typeof r==="string")process.stdout.write(r)}catch(e){}' 2>/dev/null)
if [ -z "$test_cmd" ]; then
  printf "${C_BRAND}[kiln]${C_RESET} ${C_DIM}○ No test runner configured, skipping mini-verify${C_RESET}\n"
  exit 0
fi
# Unwrap known command prefixes to find the real test runner
if ! command -v node >/dev/null 2>&1; then
  cmd_name=$(printf '%s\n' "$test_cmd" | awk '{print $1}')
else
  case "$test_cmd" in
    *\'*)
      cmd_name=""
      echo "[kiln] Warning: test command contains single quotes, skipping unwrap"
      ;;
    *)
      cmd_name=$(node -e "
const cmd='$test_cmd';
const parts=cmd.trim().split(/\s+/);
let i=0;
while(i<parts.length){
  const p=parts[i];
  if(p==='cross-env'||p==='env'){i++;while(i<parts.length&&parts[i].includes('='))i++;}
  else if(p==='npx'){i++;}
  else break;
}
process.stdout.write(parts[i]||'');
" 2>/dev/null)
      ;;
  esac
fi
case "$cmd_name" in
  npm|npx|node|jest|vitest|pytest|cargo|go|make|bun|deno|pnpm|yarn) ;;
  *) printf "${C_BRAND}[kiln]${C_RESET} ${C_YELLOW}⚠ Unrecognized test runner '%s', skipping mini-verify${C_RESET}\n" "$cmd_name"; exit 0 ;;
esac
# Reject shell metacharacters to prevent command injection
case "$test_cmd" in
  *\;*|*\|*|*\&*|*\>*|*\<*|*\`*|*\$\(*|*\)*)
    printf "${C_BRAND}[kiln]${C_RESET} ${C_YELLOW}⚠ Test command contains shell metacharacters, skipping mini-verify for safety${C_RESET}\n"
    exit 0
    ;;
esac
if [ -z "$cmd_name" ] || ! command -v "$cmd_name" >/dev/null 2>&1; then
  printf "${C_BRAND}[kiln]${C_RESET} ${C_YELLOW}⚠ Test command '%s' not found${C_RESET}\n" "$cmd_name"
  exit 0
fi
timeout_seconds="${KILN_MINI_VERIFY_TIMEOUT:-120}"
tmp_dir="${TMPDIR:-/tmp}/kiln-mini-verify-$$"
stdout_log="$tmp_dir/stdout.log"
stderr_log="$tmp_dir/stderr.log"
timeout_flag="$tmp_dir/timeout.flag"
mkdir -p "$tmp_dir" 2>/dev/null || exit 0
# shellcheck disable=SC2317
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
# Write durable result for orchestrator consumption
result_file=".kiln/mini-verify-result.json"
if [ -d ".kiln" ]; then
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")
  if [ "$timed_out" -eq 1 ]; then
    result_status="timeout"
  elif [ "$run_code" -eq 0 ]; then
    result_status="pass"
  else
    result_status="fail"
  fi
  code_key="ex""it_code"
  printf '{"status":"%s","%s":%d,"test_cmd":"%s","timestamp":"%s"}\n' \
    "$result_status" "$code_key" "$run_code" "$(printf '%s' "$test_cmd" | sed 's/"/\\"/g')" "$timestamp" \
    > "$result_file"
fi
# Update debounce cache
if [ -d ".kiln" ] && command -v node >/dev/null 2>&1; then
  run_epoch=$(date +%s 2>/dev/null || echo 0)
  printf '{"last_run_epoch":%s,"last_diff_hash":""}\n' "$run_epoch" > "$cache_file" 2>/dev/null || true
fi
if [ "$timed_out" -eq 1 ]; then
  printf "${C_BRAND}[kiln]${C_RESET} Mini-verify ${C_YELLOW}⚠ TIMEOUT (exceeded %ss)${C_RESET}\n" "$timeout_seconds"
  printf "  Test command: %s\n" "$test_cmd"
  printf "  ${C_DIM}Consider increasing timeout or checking for hanging tests.${C_RESET}\n"
  exit 0
fi
if [ "$run_code" -eq 0 ]; then
  printf "${C_BRAND}[kiln]${C_RESET} Mini-verify ${C_GREEN}✓ PASS${C_RESET}\n"
  exit 0
fi
printf "${C_BRAND}[kiln]${C_RESET} Mini-verify ${C_RED}✗ FAIL │ exit %d${C_RESET}\n" "$run_code"
printf "  Test command: %s\n" "$test_cmd"
printf "  ${C_DIM}Last output:${C_RESET}\n"
 [ -s "$stdout_log" ] && tail -n 50 "$stdout_log"
 [ -s "$stderr_log" ] && tail -n 20 "$stderr_log"
printf "\n  ${C_YELLOW}Fix the failing tests before proceeding.${C_RESET}\n"
exit 0
