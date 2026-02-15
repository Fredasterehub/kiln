#!/usr/bin/env bash
set -euo pipefail

# Kiln integration test
# Validates: installation, file placement, .kiln/ creation, hooks registration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

validate_json_file() {
  local file="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$file"
  else
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$file"
  fi
}

check_config_key() {
  local file="$1"
  local key="$2"
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const key = process.argv[2];
if (!(key in data)) {
  process.exit(1);
}
" "$file" "$key"
}

echo "Kiln integration test"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "Using temp repo: $TMPDIR"

mkdir -p "$TMPDIR/src" "$TMPDIR/node_modules"
cat > "$TMPDIR/package.json" <<'JSON'
{
  "name": "kiln-integration-fixture",
  "version": "0.0.1",
  "scripts": {
    "test": "echo test"
  }
}
JSON

echo "console.log('fixture');" > "$TMPDIR/src/index.js"

echo ""
echo "Group 1: Installation"
if node "$SCRIPT_DIR/bin/install.js" --repo-root "$TMPDIR" --yes >"$TMPDIR/install.log" 2>&1; then
  echo "  PASS: installer exits successfully"
  PASS=$((PASS + 1))
else
  echo "  FAIL: installer exits successfully"
  FAIL=$((FAIL + 1))
  echo "--- installer output ---"
  cat "$TMPDIR/install.log"
  echo "------------------------"
fi
check ".claude directory created" test -d "$TMPDIR/.claude"
check ".kiln directory created" test -d "$TMPDIR/.kiln"

echo ""
echo "Group 2: Agent files"
AGENT_DIR="$TMPDIR/.claude/agents"
AGENTS=(
  kiln-orchestrator.md
  kiln-brainstormer.md
  kiln-planner.md
  kiln-codex-planner.md
  kiln-synthesizer.md
  kiln-validator.md
  kiln-sharpener.md
  kiln-executor.md
  kiln-e2e-verifier.md
  kiln-reviewer.md
  kiln-codex-reviewer.md
  kiln-researcher.md
  kiln-wave-worker.md
)

for agent in "${AGENTS[@]}"; do
  check "agent exists: $agent" test -f "$AGENT_DIR/$agent"
done

EXPECTED_AGENT_COUNT=${#AGENTS[@]}
check "agent count is $EXPECTED_AGENT_COUNT" bash -c '[ "$(find "$1" -maxdepth 1 -type f -name "*.md" | wc -l)" -eq "$2" ]' _ "$AGENT_DIR" "$EXPECTED_AGENT_COUNT"

echo ""
echo "Group 3: Skill directories"
SKILL_ROOT="$TMPDIR/.claude/skills"
SKILLS=(
  kiln-core
  kiln-init
  kiln-status
  kiln-quick
  kiln-brainstorm
  kiln-plan
  kiln-execute
  kiln-e2e
  kiln-verify
  kiln-track
  kiln-reconcile
  kiln-roadmap
  kiln-fire
  kiln-cool
  kiln-debate
)

for skill in "${SKILLS[@]}"; do
  local_dir="$SKILL_ROOT/$skill"
  check "skill directory exists: $skill" test -d "$local_dir"
  check "skill has markdown: $skill" bash -c 'find "$1" -maxdepth 1 -type f -name "*.md" | grep -q "."' _ "$local_dir"
done

check "at least 15 skill directories installed" bash -c '[ "$(find "$1" -mindepth 1 -maxdepth 1 -type d | wc -l)" -ge 15 ]' _ "$SKILL_ROOT"

echo ""
echo "Group 4: Hooks"
HOOKS_DIR="$TMPDIR/.claude/hooks"
HOOKS_JSON="$HOOKS_DIR/hooks.json"
HOOK_SCRIPTS_DIR="$HOOKS_DIR/scripts"
check "hooks.json exists" test -f "$HOOKS_JSON"
check "hooks.json valid JSON" validate_json_file "$HOOKS_JSON"
check "hook script exists: on-session-start.sh" test -f "$HOOK_SCRIPTS_DIR/on-session-start.sh"
check "hook script exists: on-task-completed.sh" test -f "$HOOK_SCRIPTS_DIR/on-task-completed.sh"
check "hooks.json references existing hook scripts" node -e '
const fs = require("fs");
const path = require("path");
const hooksJson = process.argv[1];
const scriptsDir = process.argv[2];
const data = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
const commands = [];
function walk(value) {
  if (Array.isArray(value)) {
    for (const v of value) walk(v);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "command" && typeof v === "string") {
      commands.push(v);
    }
    walk(v);
  }
}
walk(data);
if (commands.length === 0) {
  process.exit(1);
}
for (const cmd of commands) {
  const match = cmd.match(/hooks\/scripts\/([A-Za-z0-9._-]+\.sh)/);
  if (!match) {
    process.exit(1);
  }
  const scriptPath = path.join(scriptsDir, match[1]);
  if (!fs.existsSync(scriptPath)) {
    process.exit(1);
  }
}
' "$HOOKS_JSON" "$HOOK_SCRIPTS_DIR"

if command -v shellcheck >/dev/null 2>&1; then
  check "hook scripts pass shellcheck" shellcheck "$HOOK_SCRIPTS_DIR/on-session-start.sh" "$HOOK_SCRIPTS_DIR/on-task-completed.sh"
else
  echo "  SKIP: shellcheck not available"
fi

echo ""
echo "Group 5: .kiln structure"
KILN_DIR="$TMPDIR/.kiln"
check "config.json exists" test -f "$KILN_DIR/config.json"
check "config.json valid JSON" validate_json_file "$KILN_DIR/config.json"
check "STATE.md exists" test -f "$KILN_DIR/STATE.md"
check "docs directory exists" test -d "$KILN_DIR/docs"
check "tracks directory exists" test -d "$KILN_DIR/tracks"
check "living doc: TECH_STACK.md exists" test -f "$KILN_DIR/docs/TECH_STACK.md"
check "living doc: PATTERNS.md exists" test -f "$KILN_DIR/docs/PATTERNS.md"
check "living doc: DECISIONS.md exists" test -f "$KILN_DIR/docs/DECISIONS.md"
check "living doc: PITFALLS.md exists" test -f "$KILN_DIR/docs/PITFALLS.md"

echo ""
echo "Group 6: Templates"
TEMPLATES_DIR="$TMPDIR/.claude/templates"
check "templates directory exists" test -d "$TEMPLATES_DIR"
check "STATE.md.tmpl exists" test -f "$TEMPLATES_DIR/STATE.md.tmpl"
check "config.json.tmpl exists" test -f "$TEMPLATES_DIR/config.json.tmpl"
check "vision-sections.md exists" test -f "$TEMPLATES_DIR/vision-sections.md"
check "FINAL_REPORT.md.tmpl exists" test -f "$TEMPLATES_DIR/FINAL_REPORT.md.tmpl"
echo ""
echo "Group 7: config.json content"
check "config has projectType" check_config_key "$KILN_DIR/config.json" "projectType"
check "config has modelMode" check_config_key "$KILN_DIR/config.json" "modelMode"
check "config has tooling" check_config_key "$KILN_DIR/config.json" "tooling"
check "config has preferences.useTeams" node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
if (!d.preferences || typeof d.preferences.useTeams !== 'boolean') process.exit(1);
" "$KILN_DIR/config.json"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All integration tests passed!"
