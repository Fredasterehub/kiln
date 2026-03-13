#!/bin/bash
# Run S7 Full Pipeline baseline test against GitHub plugin version.
# Usage: ./run-baseline.sh
#
# Clones/updates the GitHub plugin, creates a workspace, launches claude.
# You watch the session run autonomously. After completion, use forge dashboard
# to import results and set baseline.

set -euo pipefail

GITHUB_DIR="/tmp/kiln-github"
PLUGIN_DIR="$GITHUB_DIR/plugins/kiln"
S7_SOURCE="/DEV/kilntop/plugin/skills/kiln-forge/scenarios/s7-full-pipeline"
SCENARIO_DIR="$PLUGIN_DIR/skills/kiln-forge/scenarios/s7-full-pipeline"
WORKSPACE="/tmp/kiln-baseline-$(date +%Y%m%d-%H%M%S)"
STDERR_LOG=""
PROMPT_FILE=""
RUNNER_PID=""

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

trap cleanup EXIT
trap on_interrupt INT TERM

echo "=== S7 Full Pipeline Baseline ==="

for cmd in claude git python3 setsid; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
done

# Clone/update GitHub plugin
if [ -d "$GITHUB_DIR/.git" ]; then
  echo "[1/5] Updating GitHub clone..."
  if ! git -C "$GITHUB_DIR" pull --ff-only; then
    echo "GitHub clone update failed; recreating $GITHUB_DIR..."
    rm -rf "$GITHUB_DIR"
    git clone https://github.com/Fredasterehub/kiln.git "$GITHUB_DIR"
  fi
elif [ -e "$GITHUB_DIR" ]; then
  echo "[1/5] Existing path is not a git repo; recreating $GITHUB_DIR..."
  rm -rf "$GITHUB_DIR"
  git clone https://github.com/Fredasterehub/kiln.git "$GITHUB_DIR"
else
  echo "[1/5] Cloning from GitHub..."
  git clone https://github.com/Fredasterehub/kiln.git "$GITHUB_DIR"
fi

# Install S7 scenario + forge data dirs
echo "[2/5] Installing S7 scenario..."
mkdir -p "$PLUGIN_DIR/skills/kiln-forge/scenarios"
rm -rf "$SCENARIO_DIR"
cp -R "$S7_SOURCE" "$SCENARIO_DIR"
DATA_DIR="$PLUGIN_DIR/skills/kiln-forge/data"
mkdir -p "$DATA_DIR"
for f in run-history.json evolution-log.json findings.json; do
  [ -f "$DATA_DIR/$f" ] || echo "[]" > "$DATA_DIR/$f"
done
[ -f "$DATA_DIR/plugin-state.json" ] || echo "{}" > "$DATA_DIR/plugin-state.json"

# Create workspace
echo "[3/5] Creating workspace at $WORKSPACE..."
CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR" bash "$SCENARIO_DIR/seed/setup.sh" "$WORKSPACE"

PROMPT_FILE="$WORKSPACE/.kiln/prompt.md"
cp "$SCENARIO_DIR/prompt.md" "$PROMPT_FILE"
STDERR_LOG="$WORKSPACE/.kiln/stderr.log"

echo "[4/5] Ready to launch."
echo ""
echo "  Workspace: $WORKSPACE"
echo "  Plugin:    $PLUGIN_DIR"
echo "  Timeout:   90 minutes"
echo ""
echo "  The session will start in 3 seconds."
echo "  Watch it run — do NOT type anything (auto-answer is active)."
echo ""
sleep 3

# Launch claude — stream-json piped through human-readable filter
FILTER="$SCENARIO_DIR/stream-filter.py"
echo "[5/5] Launching claude..."
setsid bash -lc '
  set -euo pipefail
  workspace="$1"
  prompt_file="$2"
  plugin_dir="$3"
  stderr_log="$4"
  filter="$5"

  cd "$workspace"
  claude -p "$(cat "$prompt_file")" \
    --plugin-dir "$plugin_dir" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    2>"$stderr_log" \
    | python3 "$filter"
' bash "$WORKSPACE" "$PROMPT_FILE" "$PLUGIN_DIR" "$STDERR_LOG" "$FILTER" &
RUNNER_PID=$!
wait "$RUNNER_PID"
RUNNER_PID=""

echo ""
echo "=== DONE ==="
echo "Workspace: $WORKSPACE"
echo ""
echo "Next: run purecheck and import to forge dashboard."
echo "  1. Find session JSONL: ls -lt ~/.claude/projects/*/ | head -20"
echo "  2. python3 /DEV/kilntop/purecheck/purecheck.py --deep --json-only --out $WORKSPACE/.kiln <session.jsonl>"
echo "  3. Start forge: cd /DEV/kilntop/kiln-forge-server && ./target/release/kiln-forge-server --port 3003"
echo "  4. Browse to http://localhost:3003 — results appear in history"
