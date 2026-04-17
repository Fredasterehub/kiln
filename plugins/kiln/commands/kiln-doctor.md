---
name: kiln-doctor
description: Check Kiln pipeline prerequisites and diagnose issues.
argument-hint: [no arguments needed]
allowed-tools: Read, Bash, Glob, Grep
---

# /kiln-doctor

Run diagnostics to verify the Kiln pipeline is ready to fire.

## Checks to Perform

Run all checks and present results as a checklist:

### 0. Cache Health

```bash
SOURCE_VERSION=$(cat ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json | grep -o '"version": "[^"]*"' | grep -o '[0-9.]*')
CACHE_DIR="$HOME/.claude/plugins/cache/kiln/kiln/${SOURCE_VERSION}"
if [[ ! -d "$CACHE_DIR" ]]; then
  CACHED_VERSION=$(ls "$HOME/.claude/plugins/cache/kiln/kiln/" 2>/dev/null | head -1)
  if [[ -n "$CACHED_VERSION" && "$CACHED_VERSION" != "$SOURCE_VERSION" ]]; then
    echo "STALE:${CACHED_VERSION}:${SOURCE_VERSION}"
    rm -rf "$HOME/.claude/plugins/cache/kiln/"
    echo "CLEARED"
  else
    echo "OK:${SOURCE_VERSION}"
  fi
else
  echo "OK:${SOURCE_VERSION}"
fi
```
- If output contains `STALE`: `[FIX] Cache cleared — was v{cached}, expected v{source}. Restart needed.`
- If output contains `OK`: `[PASS] Cache: v{version} (current)`

### 1. Plugin Version

```bash
cat ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json | grep version
```
- Display the installed version
- Format: `[INFO] Kiln version: {version}`

### 2. Codex CLI Availability

```bash
if command -v codex >/dev/null 2>&1; then
  codex --version
else
  echo "MISSING"
fi
```
- If a version is returned: `[PASS] Codex CLI: {version}`
- If output is `MISSING`: `[INFO] Codex CLI: not found — Claude-only fallback remains available`

### 3. Codex Delegation Probe (Optional)

```bash
if command -v codex >/dev/null 2>&1; then
  TMP_DIR=$(mktemp -d)
  PROMPT_FILE="$TMP_DIR/kiln-doctor-prompt.md"
  trap 'rm -rf "$TMP_DIR"' EXIT
  git -C "$TMP_DIR" init -q
  cat >"$PROMPT_FILE" <<'EOF'
Reply with just OK
EOF
  timeout 30 codex exec --sandbox danger-full-access -C "$TMP_DIR" <"$PROMPT_FILE" 2>&1
else
  echo "SKIP:codex-missing"
fi
```
- If output contains `OK`: `[PASS] Codex delegation: probe succeeded`
- If output is `SKIP:codex-missing`: `[INFO] Codex delegation: skipped — Claude-only fallback will be used`
- If the probe fails or times out: `[WARN] Codex delegation: probe failed — Codex-backed GPT delegation unavailable, Claude-only fallback remains available`

### 4. Kiln Agent Files

Check that all 32 Kiln agent files exist in the plugin:
```bash
ls -1 ${CLAUDE_PLUGIN_ROOT}/agents/*.md | wc -l
```
- Expected: 32 agent files
- List any missing agents if count is wrong.

### 5. Pipeline Skill

Check that SKILL.md and reference files exist:
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/artifact-flow.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md`

### 6. Playwright MCP Contract

Determine whether Kiln bundles Playwright MCP or expects it externally:
```bash
if [[ -f "${CLAUDE_PLUGIN_ROOT}/.mcp.json" ]] && grep -q 'playwright' "${CLAUDE_PLUGIN_ROOT}/.mcp.json"; then
  echo "BUNDLED:.mcp.json"
elif grep -q 'playwright' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null; then
  echo "BUNDLED:plugin.json"
elif grep -q 'mcp__playwright__' "${CLAUDE_PLUGIN_ROOT}/agents/release-the-giant.md" "${CLAUDE_PLUGIN_ROOT}/agents/style-maker.md" 2>/dev/null; then
  echo "EXTERNAL"
else
  echo "UNUSED"
fi
```
- If output starts with `BUNDLED`: `[PASS] Playwright MCP: bundled via {location}`
- If output is `EXTERNAL`: `[INFO] Playwright MCP: not bundled by this plugin. Argus browser validation for web UIs requires a separately enabled Playwright MCP server in Claude Code. Without it, Kiln falls back to non-browser checks and browser-only acceptance criteria may stay PARTIAL.`
- If output is `UNUSED`: `[INFO] Playwright MCP: no plugin-level Playwright integration detected`

### 7. Existing Pipeline State

Check for `.kiln/STATE.md` in the current working directory:
- If found: display current stage, team_iteration, chunk_count, correction_cycle, run_id
- If not found: "No existing pipeline state. Ready for a fresh run."

### 8. Brainstorm Data

Check that brainstorm technique files exist:
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/brainstorming-techniques.json`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/elicitation-methods.json`
- If both are present: `[PASS] Brainstorm data: technique files present`
- If missing: "Brainstorm data files not found. Da Vinci will work without technique suggestions."

### 9. Git Configuration

```bash
GIT_NAME=$(git config user.name 2>/dev/null)
GIT_EMAIL=$(git config user.email 2>/dev/null)
if [[ -n "$GIT_NAME" && -n "$GIT_EMAIL" ]]; then
  echo "OK:${GIT_NAME}:${GIT_EMAIL}"
else
  echo "MISSING:name=${GIT_NAME:-unset}:email=${GIT_EMAIL:-unset}"
fi
```
- If output starts with `OK`: `[PASS] Git config: {name} <{email}>`
- If output starts with `MISSING`: `[WARN] Git config: incomplete — agents that commit may fail. Set with git config user.name / user.email`

### 10. Hook Health

Verify all hook scripts referenced in `hooks.json` exist and are executable:
```bash
HOOKS_JSON="${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json"
HOOKS_DIR="${CLAUDE_PLUGIN_ROOT}/hooks"
FAIL=0
if [[ ! -f "$HOOKS_JSON" ]]; then
  echo "MISSING:hooks.json"
else
  for COMMAND in $(grep -o '"command":[ ]*"[^"]*"' "$HOOKS_JSON" | grep -o '"[^"]*"$' | tr -d '"' | sort -u); do
    # Strip ${CLAUDE_PLUGIN_ROOT}/ prefix to get relative path
    SCRIPT="${COMMAND#\$\{CLAUDE_PLUGIN_ROOT\}/}"
    SCRIPT_PATH="${CLAUDE_PLUGIN_ROOT}/${SCRIPT}"
    if [[ ! -f "$SCRIPT_PATH" ]]; then
      echo "MISSING:${SCRIPT}"
      FAIL=1
    elif [[ ! -x "$SCRIPT_PATH" ]]; then
      echo "WARN:${SCRIPT}"
      FAIL=1
    fi
  done
  if [[ $FAIL -eq 0 ]]; then
    echo "OK"
  fi
fi
```
- If output is `OK`: `[PASS] Hooks: all scripts present and executable`
- If output contains `MISSING:hooks.json`: `[FAIL] hooks.json not found`
- If output contains `MISSING:`: `[FAIL] Hook script missing: {script}`
- If output contains `WARN:`: `[WARN] Hook not executable: {script} — run chmod +x to fix`

### 11. Fetch MCP (Anthropic Official)

```bash
if [[ -f "${CLAUDE_PLUGIN_ROOT}/.mcp.json" ]] && grep -q '"fetch"' "${CLAUDE_PLUGIN_ROOT}/.mcp.json"; then
  if command -v uvx >/dev/null 2>&1; then
    echo "OK"
  else
    echo "MISSING_UVX"
  fi
else
  echo "NOT_CONFIGURED"
fi
```
- If output is `OK`: `[PASS] Fetch MCP: bundled (official Anthropic server via uvx)`
- If output is `MISSING_UVX`: `[WARN] Fetch MCP: configured but uvx not found — install uv (https://docs.astral.sh/uv/) for reliable web research`
- If output is `NOT_CONFIGURED`: `[WARN] Fetch MCP: .mcp.json missing or fetch server not configured — field agents will use WebSearch and context7 for research (WebFetch is blocked during pipeline runs)`

## Output Format

Present results as:
```
Kiln Doctor Report
==================
[PASS] Cache: v0.98.2 (current)
[INFO] Kiln version: 0.98.2
[INFO] Codex CLI: not found — Claude-only fallback remains available
[INFO] Codex delegation: skipped — Claude-only fallback will be used
[PASS] Agent files: 32/32 present
[PASS] Pipeline skill: All files present
[INFO] Playwright MCP: not bundled by this plugin. Argus browser validation for web UIs requires a separately enabled Playwright MCP server in Claude Code. Without it, Kiln falls back to non-browser checks and browser-only acceptance criteria may stay PARTIAL.
[INFO] Pipeline state: No existing run (ready for fresh start)
[PASS] Brainstorm data: technique files present
[PASS] Git config: Gemini CLI <noreply@example.com>
[PASS] Hooks: all scripts present and executable
[PASS] Fetch MCP: bundled (official Anthropic server via uvx)

Verdict: Ready to fire (Claude-only mode)!
```

Use PASS/WARN/INFO/FIX prefixes. Prefer WARN or INFO over FAIL when Kiln can still run via Claude-only fallback. End with a clear verdict that reflects whether Codex-backed delegation is available.
