#!/bin/bash
# Run S8 Step-Isolated Relay against the GitHub plugin clone.
# Usage: ./run-relay.sh [run_root]

set -euo pipefail

GITHUB_DIR="${KILN_GITHUB_DIR:-/tmp/kiln-github}"
PLUGIN_DIR="${KILN_PLUGIN_DIR:-$GITHUB_DIR/plugins/kiln}"
S8_SOURCE="/DEV/kilntop/plugin/skills/kiln-forge/scenarios/s8-relay"
S7_SOURCE="/DEV/kilntop/plugin/skills/kiln-forge/scenarios/s7-full-pipeline"
SCENARIO_DIR="$PLUGIN_DIR/skills/kiln-forge/scenarios/s8-relay"
S7_SCENARIO_DIR="$PLUGIN_DIR/skills/kiln-forge/scenarios/s7-full-pipeline"
EXPECT_JSON="$SCENARIO_DIR/expect.json"
RUN_ROOT="${1:-/tmp/kiln-relay-$(date +%Y%m%d-%H%M%S)}"
RUNNER_PID=""
CURRENT_STEP=""
OVERALL_STATUS=0
STEPS=(1 1b 2 3 4 5 6 7)

declare -A STEP_NAMES=(
  [1]="onboarding"
  [1b]="onboarding-brownfield"
  [2]="brainstorm"
  [3]="research"
  [4]="architecture"
  [5]="build"
  [6]="validate"
  [7]="report"
)

declare -A STEP_TIMEOUTS=(
  [1]=240
  [1b]=300
  [2]=300
  [3]=300
  [4]=420
  [5]=360
  [6]=240
  [7]=180
)

declare -A STEP_RESULTS
declare -A STEP_DURATIONS
declare -A STEP_WORKSPACES

cleanup() {
  trap - EXIT INT TERM

  if [ -n "${RUNNER_PID:-}" ] && kill -0 "$RUNNER_PID" 2>/dev/null; then
    kill -TERM -- "-$RUNNER_PID" 2>/dev/null || kill -TERM "$RUNNER_PID" 2>/dev/null || true
    wait "$RUNNER_PID" 2>/dev/null || true
  fi
}

on_interrupt() {
  cleanup
  exit 130
}

install_clone() {
  if [ -n "${KILN_PLUGIN_DIR:-}" ]; then
    if [ ! -d "$PLUGIN_DIR" ]; then
      echo "Configured plugin dir does not exist: $PLUGIN_DIR" >&2
      exit 1
    fi
    echo "[1/4] Using existing plugin dir: $PLUGIN_DIR"
    return
  fi

  if [ -d "$GITHUB_DIR/.git" ]; then
    echo "[1/4] Updating GitHub clone..."
    if ! git -C "$GITHUB_DIR" pull --ff-only; then
      echo "GitHub clone update failed; recreating $GITHUB_DIR..."
      rm -rf "$GITHUB_DIR"
      git clone https://github.com/Fredasterehub/kiln.git "$GITHUB_DIR"
    fi
  elif [ -e "$GITHUB_DIR" ]; then
    echo "[1/4] Existing path is not a git repo; recreating $GITHUB_DIR..."
    rm -rf "$GITHUB_DIR"
    git clone https://github.com/Fredasterehub/kiln.git "$GITHUB_DIR"
  else
    echo "[1/4] Cloning from GitHub..."
    git clone https://github.com/Fredasterehub/kiln.git "$GITHUB_DIR"
  fi
}

install_scenarios() {
  echo "[2/4] Installing S7 + S8 scenarios..."
  mkdir -p "$PLUGIN_DIR/skills/kiln-forge/scenarios"

  if [ "$PLUGIN_DIR" = "/DEV/kilntop/plugin" ]; then
    echo "Using in-repo scenario files."
  else
    rm -rf "$SCENARIO_DIR" "$S7_SCENARIO_DIR"
    cp -R "$S8_SOURCE" "$SCENARIO_DIR"
    cp -R "$S7_SOURCE" "$S7_SCENARIO_DIR"
  fi

  local data_dir="$PLUGIN_DIR/skills/kiln-forge/data"
  mkdir -p "$data_dir"
  for f in run-history.json evolution-log.json findings.json; do
    [ -f "$data_dir/$f" ] || echo "[]" > "$data_dir/$f"
  done
  [ -f "$data_dir/plugin-state.json" ] || echo "{}" > "$data_dir/plugin-state.json"
}

check_artifacts() {
  local step="$1"
  local workspace="$2"

  python3 - "$EXPECT_JSON" "$step" "$workspace" <<'PY'
import json
import os
import sys

expect_path, step_arg, workspace = sys.argv[1:4]

with open(expect_path, "r", encoding="utf-8") as fh:
    data = json.load(fh)

steps = data.get("steps", [])
step_data = next((item for item in steps if str(item.get("step")) == str(step_arg)), None)
if step_data is None:
    print(f"Missing step definition for step {step_arg}", file=sys.stderr)
    sys.exit(1)

errors = []
for artifact in step_data.get("artifacts", []):
    rel_path = artifact["path"]
    abs_path = os.path.join(workspace, rel_path)
    should_exist = artifact.get("exists", False)
    exists = os.path.exists(abs_path)

    if should_exist and not exists:
      errors.append(f"missing {rel_path}")
      continue

    if artifact.get("contains") is not None and exists:
      with open(abs_path, "r", encoding="utf-8", errors="ignore") as fh:
          content = fh.read()
      if artifact["contains"] not in content:
          errors.append(f"{rel_path} missing text: {artifact['contains']}")

if errors:
    for error in errors:
        print(error, file=sys.stderr)
    sys.exit(1)
PY
}

run_step() {
  local step="$1"
  local step_name="${STEP_NAMES[$step]}"
  local timeout_seconds="${STEP_TIMEOUTS[$step]}"
  local workspace="$RUN_ROOT/step-$step-$step_name"
  local prompt_file="$workspace/.kiln/prompt.md"
  local stderr_log="$workspace/.kiln/stderr.log"
  local stream_log="$workspace/.kiln/stream.log"
  local filter="$SCENARIO_DIR/stream-filter.py"
  local step_start step_end duration exit_code artifact_status result

  CURRENT_STEP="$step"
  STEP_WORKSPACES[$step]="$workspace"
  rm -rf "$workspace"

  echo ""
  echo "=== Step $step/${#STEPS[@]}: $step_name ==="
  echo "Workspace: $workspace"
  echo "Timeout:   ${timeout_seconds}s"

  CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR" bash "$SCENARIO_DIR/seed/setup-step-$step.sh" "$workspace"
  cp "$SCENARIO_DIR/prompts/step-$step.md" "$prompt_file"

  step_start="$(date +%s)"
  set +e
  setsid bash -lc '
    set -euo pipefail
    workspace="$1"
    prompt_file="$2"
    plugin_dir="$3"
    stderr_log="$4"
    filter="$5"
    timeout_seconds="$6"
    stream_log="$7"

    cd "$workspace"
    timeout --signal=TERM --kill-after=30s "$timeout_seconds" \
      claude -p "$(cat "$prompt_file")" \
        --plugin-dir "$plugin_dir" \
        --dangerously-skip-permissions \
        --output-format stream-json \
        --verbose \
        2>"$stderr_log" \
      | python3 "$filter" | tee "$stream_log"
  ' bash "$workspace" "$prompt_file" "$PLUGIN_DIR" "$stderr_log" "$filter" "$timeout_seconds" "$stream_log" &
  RUNNER_PID=$!
  wait "$RUNNER_PID"
  exit_code=$?
  RUNNER_PID=""
  set -e

  artifact_status=0
  if ! check_artifacts "$step" "$workspace"; then
    artifact_status=1
  fi

  step_end="$(date +%s)"
  duration=$((step_end - step_start))
  STEP_DURATIONS[$step]="$duration"

  if [ "$exit_code" -eq 0 ] && [ "$artifact_status" -eq 0 ]; then
    result="PASS"
  else
    result="FAIL"
    OVERALL_STATUS=1
  fi

  STEP_RESULTS[$step]="$result"

  echo "Step $step result: $result"
  if [ "$exit_code" -eq 124 ]; then
    echo "Reason: timed out after ${timeout_seconds}s"
  elif [ "$exit_code" -ne 0 ]; then
    echo "Reason: claude exited with code $exit_code"
  fi
  if [ "$artifact_status" -ne 0 ]; then
    echo "Reason: artifact check failed"
  fi
  echo "Duration: ${duration}s"

  CURRENT_STEP=""
}

trap cleanup EXIT
trap on_interrupt INT TERM

echo "=== S8 Step-Isolated Relay ==="

for cmd in claude git python3 setsid timeout tee; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
done

install_clone
install_scenarios

echo "[3/4] Using run root: $RUN_ROOT"
mkdir -p "$RUN_ROOT"

echo "[4/4] Starting isolated relay..."
total_start="$(date +%s)"

for step in "${STEPS[@]}"; do
  run_step "$step"
done

total_end="$(date +%s)"
total_duration=$((total_end - total_start))

echo ""
echo "=== Summary ==="
for step in "${STEPS[@]}"; do
  echo "Step $step (${STEP_NAMES[$step]}): ${STEP_RESULTS[$step]} in ${STEP_DURATIONS[$step]}s"
  echo "Workspace: ${STEP_WORKSPACES[$step]}"
done
echo "Total time: ${total_duration}s"

exit "$OVERALL_STATUS"
