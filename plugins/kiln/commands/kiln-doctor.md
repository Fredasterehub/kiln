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

### 2. Claude Code Agent-Team Hard Gate

Kiln requires Claude Code agent teams. Missing team support is a hard failure, not a warning.

```bash
MIN_TEAM_VERSION="2.1.32"
if command -v claude >/dev/null 2>&1; then
  RAW_VERSION="$(claude --version 2>&1 | head -1)"
  VERSION="$(printf '%s\n' "$RAW_VERSION" | grep -oE '[0-9]+(\.[0-9]+){1,3}' | head -1)"
  if [[ -z "$VERSION" ]]; then
    echo "UNKNOWN_VERSION:${RAW_VERSION}"
  elif printf '%s\n%s\n' "$MIN_TEAM_VERSION" "$VERSION" | sort -V -C; then
    echo "OK:${VERSION}"
  else
    echo "TOO_OLD:${VERSION}:${MIN_TEAM_VERSION}"
  fi
else
  echo "MISSING"
fi
```

- If `OK`: `[PASS] Claude Code: {version} (agent-team floor >= 2.1.32)`
- If `TOO_OLD`: `[FAIL] Claude Code: {version} is below the documented agent-team floor {min}. Upgrade Claude Code before running Kiln.`
- If `UNKNOWN_VERSION`: `[FAIL] Claude Code: version could not be parsed from "{raw}". Verify the CLI supports agent teams before running Kiln.`
- If `MISSING`: `[FAIL] Claude Code CLI: not found. Kiln cannot run without Claude Code agent teams.`

Check the experimental flag through environment and likely settings files:

```bash
if [[ "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-}" == "1" ]]; then
  echo "OK:env"
elif grep -R '"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"[[:space:]]*:[[:space:]]*"\\?1"\\?' \
    "$HOME/.claude/settings.json" "$HOME/.claude/settings.local.json" \
    ".claude/settings.json" ".claude/settings.local.json" 2>/dev/null | head -1 >/dev/null; then
  echo "OK:settings"
else
  echo "MISSING"
fi
```

- If `OK:env` or `OK:settings`: `[PASS] Agent teams flag: enabled via {source}`
- If `MISSING`: `[FAIL] Agent teams flag: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 not detected in env or common Claude settings files. Set it before /kiln-fire.`

### 3. Native Tool Declaration and Runtime Introspection

Kiln's pipeline skill must declare the native team/task tools it needs:

```bash
SKILL="${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md"
REQUIRED_TOOLS="TeamCreate TeamDelete SendMessage TaskCreate TaskGet TaskList TaskUpdate"
for TOOL in $REQUIRED_TOOLS; do
  if grep -q "$TOOL" "$SKILL"; then
    echo "OK:${TOOL}"
  else
    echo "MISSING:${TOOL}"
  fi
done
echo "RUNTIME_INTROSPECTION_UNAVAILABLE"
```

- Every `OK:{tool}`: `[PASS] Pipeline declares {tool}`
- Any `MISSING:{tool}`: `[FAIL] Pipeline skill does not declare required native tool {tool}`
- Always report: `[DEGRADED] Runtime tool availability: slash-command doctor cannot introspect Claude's actually loaded tool set from inside this prompt. Manual verification: run /tools or start a tiny agent-team session and confirm TeamCreate, TeamDelete, SendMessage, TaskCreate, TaskGet, TaskList, and TaskUpdate are present. If any are absent, /kiln-fire will not be ready even if this declaration check passes.`

### 4. Runtime Dependencies

```bash
for BIN in bash python3 node jq git; do
  if command -v "$BIN" >/dev/null 2>&1; then
    echo "OK:${BIN}:$($BIN --version 2>&1 | head -1)"
  else
    echo "MISSING:${BIN}"
  fi
done
```

- Missing `bash`, `python3`, or `git`: `[FAIL] Required runtime missing: {bin}`
- Missing `jq`: `[DEGRADED] jq missing — some doctor/plugin checks fall back to grep and may be less precise`
- Missing `node`: `[WARN] Node missing — acceptable for non-JS projects, but JS/Playwright validation will be unavailable`

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

### 6. Playwright / Browser Validation Contract

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
if command -v npx >/dev/null 2>&1 && npx --yes playwright --version >/dev/null 2>&1; then
  echo "PLAYWRIGHT_CLI:OK"
else
  echo "PLAYWRIGHT_CLI:MISSING"
fi
```
- If output starts with `BUNDLED`: `[PASS] Playwright MCP: bundled via {location}`
- If output is `EXTERNAL`: `[INFO] Playwright MCP: not bundled by this plugin. Argus browser validation for web UIs requires a separately enabled Playwright MCP server in Claude Code. Without it, non-UI work can continue, but UI/browser acceptance must report BLOCKED_BROWSER_VALIDATION_MISSING, PARTIAL_PASS_STATIC_ONLY, or FAIL_BROWSER_EVIDENCE_MISSING rather than full PASS.`
- If output is `UNUSED`: `[INFO] Playwright MCP: no plugin-level Playwright integration detected`
- If `PLAYWRIGHT_CLI:MISSING`: `[WARN] Playwright CLI: not found. Optional globally, but browser/UI milestones require a Playwright MCP/browser capability or must be marked partial/blocked. Official install pattern: npx playwright install or npx playwright install --with-deps after adding Playwright to the project.`
- If `PLAYWRIGHT_CLI:OK`: `[PASS] Playwright CLI: present. Browser binaries may still be missing; run the project's Playwright tests or npx playwright install when UI validation requires it.`

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
if [[ ! -f "$HOOKS_JSON" ]]; then
  echo "MISSING:hooks.json"
else
  python3 - "$HOOKS_JSON" "$CLAUDE_PLUGIN_ROOT" <<'PY'
import json, os, sys
hooks_json, root = sys.argv[1], sys.argv[2]
matcherless = {"UserPromptSubmit","Stop","TeammateIdle","TaskCreated","TaskCompleted","WorktreeCreate","WorktreeRemove","CwdChanged"}
data = json.load(open(hooks_json))
fail = False
events = data.get("hooks", {})
for required in ["SessionStart","SessionEnd","SubagentStart","SubagentStop","TaskCreated","TaskCompleted","FileChanged","StopFailure","TeammateIdle","PreToolUse","PostToolUse"]:
    if required not in events:
        print(f"MISSING_EVENT:{required}")
        fail = True
for event, entries in events.items():
    for entry in entries:
        if event in matcherless and "matcher" in entry:
            print(f"IGNORED_MATCHER:{event}")
            fail = True
        for hook in entry.get("hooks", []):
            command = hook.get("command", "")
            if not command.startswith("${CLAUDE_PLUGIN_ROOT}/"):
                continue
            rel = command.removeprefix("${CLAUDE_PLUGIN_ROOT}/")
            path = os.path.join(root, rel)
            if not os.path.isfile(path):
                print(f"MISSING:{rel}")
                fail = True
            elif not os.access(path, os.X_OK):
                print(f"NOT_EXECUTABLE:{rel}")
                fail = True
print("OK" if not fail else "FAILED")
PY
fi
```
- If output is `OK`: `[PASS] Hooks: all scripts present and executable`
- If output contains `MISSING:hooks.json`: `[FAIL] hooks.json not found`
- If output contains `MISSING_EVENT:`: `[FAIL] Required hook event missing: {event}`
- If output contains `MISSING:`: `[FAIL] Hook script missing: {script}`
- If output contains `NOT_EXECUTABLE:`: `[FAIL] Hook not executable: {script} — run chmod +x to fix`
- If output contains `IGNORED_MATCHER:`: `[FAIL] hooks.json sets matcher for matcherless event {event}; Claude Code silently ignores it`

### 10b. Critical State Validators

```bash
for SCRIPT in "${CLAUDE_PLUGIN_ROOT}/hooks/task-dag-guard.py" "${CLAUDE_PLUGIN_ROOT}/hooks/validate-state.py"; do
  if [[ -x "$SCRIPT" ]]; then
    echo "OK:${SCRIPT##*/}"
  elif [[ -f "$SCRIPT" ]]; then
    echo "NOT_EXECUTABLE:${SCRIPT##*/}"
  else
    echo "MISSING:${SCRIPT##*/}"
  fi
done
if [[ -d .kiln ]]; then
  "${CLAUDE_PLUGIN_ROOT}/hooks/validate-state.py" --root "$(pwd)" --all && echo "STATE_VALIDATORS:OK" || echo "STATE_VALIDATORS:FAILED"
else
  echo "STATE_VALIDATORS:SKIP_NO_PIPELINE"
fi
```

- `[PASS] State validators: task DAG and critical state validators present`
- `STATE_VALIDATORS:FAILED`: `[FAIL] Critical Kiln state/evidence schema validation failed. Fix the reported paths before /kiln-fire resumes.`
- `STATE_VALIDATORS:SKIP_NO_PIPELINE`: `[INFO] State validators: no .kiln/ state in current directory`

### 10c. Permission and Secret Safety Posture

Do not treat prompts or `allowed-tools` as a security boundary. Check for bypass mode and deny rules:

```bash
if [[ "${CLAUDE_CODE_DANGEROUSLY_SKIP_PERMISSIONS:-}" == "1" ]] || [[ "$*" == *"--dangerously-skip-permissions"* ]]; then
  echo "BYPASS_MODE"
else
  echo "NORMAL_MODE"
fi
SETTINGS_FILES=("$HOME/.claude/settings.json" "$HOME/.claude/settings.local.json" ".claude/settings.json" ".claude/settings.local.json")
if grep -R '"deny"' "${SETTINGS_FILES[@]}" 2>/dev/null | grep -E '\.env|secrets/|\*\.pem|\*\.key|credentials\.json|\.npmrc' >/dev/null; then
  echo "SECRET_DENY:OK"
else
  echo "SECRET_DENY:MISSING"
fi
```

- `BYPASS_MODE` plus `SECRET_DENY:MISSING`: `[FAIL] Unsafe permissions: bypass/dangerously-skip-permissions detected without visible deny rules for secrets. Add deny rules before running Kiln.`
- `SECRET_DENY:MISSING` in normal mode: `[WARN] Secret deny rules not detected. Recommended deny patterns: .env, .env.*, secrets/**, *.pem, *_rsa, *.key, credentials.json, .npmrc.`
- `SECRET_DENY:OK`: `[PASS] Secret deny posture: deny rules found`

### 10d. LSP / Code Intelligence Capability

```bash
if [[ -n "${CLAUDE_CODE_LSP:-}" ]]; then
  echo "LSP_ENV:${CLAUDE_CODE_LSP}"
elif find . -maxdepth 3 \( -name 'tsconfig.json' -o -name 'pyproject.toml' -o -name 'go.mod' -o -name 'Cargo.toml' \) | head -1 | grep -q .; then
  echo "PROJECT_CAN_USE_LSP"
else
  echo "NO_PROJECT_LSP_HINT"
fi
```

- `PROJECT_CAN_USE_LSP`: `[DEGRADED] LSP runtime availability cannot be introspected from this slash command. Reviewers will request LSP diagnostics where Claude Code exposes them; absence is degraded, not hard fail.`
- `NO_PROJECT_LSP_HINT`: `[INFO] LSP: no obvious language-server project files detected`

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

### 12. Plugin Branch Alignment

```bash
if [[ -d "${HOME}/.claude/plugins/marketplaces/kiln" ]] && git -C "${HOME}/.claude/plugins/marketplaces/kiln" rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH="$(git -C "${HOME}/.claude/plugins/marketplaces/kiln" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
  echo "BRANCH:${BRANCH}"
else
  echo "NOT_FOUND"
fi
```
- If output is `NOT_FOUND`: `[INFO] Plugin branch: clone not found — skipping`
- If output is `BRANCH:main`: `[PASS] Plugin branch: main`
- If output is `BRANCH:v9`: `[WARN] Plugin branch: v9 (deprecated — should be main)`
  Fix:
    `git -C "${HOME}/.claude/plugins/marketplaces/kiln" remote set-branches origin main`
    `git -C "${HOME}/.claude/plugins/marketplaces/kiln" fetch origin`
    `git -C "${HOME}/.claude/plugins/marketplaces/kiln" checkout main`
    `git -C "${HOME}/.claude/plugins/marketplaces/kiln" branch -D v9`
  Prompt the user for confirmation with `[y/N]` before executing the fix. Only `y` or `Y` proceeds; bare Enter defaults to No.
  If confirmed, run the four fix commands above in order, then run `git -C "${HOME}/.claude/plugins/marketplaces/kiln" rev-parse --abbrev-ref HEAD` to verify success.
  If verification returns `main`: `[PASS] Aligned to main`
  If the user declines: `[INFO] Skipped (user declined)`
- If output starts with `BRANCH:` and is not `BRANCH:main` or `BRANCH:v9`: `[INFO] Plugin branch: {branch}`

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

Verdict: DEGRADED
```

Use these prefixes consistently:
- `[PASS]` — required capability present.
- `[FAIL]` — Kiln cannot safely run or cannot meet a hard contract.
- `[DEGRADED]` — Kiln may run, but the doctor cannot prove a native/runtime capability or an optional quality signal is available.
- `[WARN]` — non-blocking issue with clear risk.
- `[INFO]` — informational.
- `[FIX]` — doctor applied a local repair.

Hard-fail the final verdict when any of these fail: Claude Code version/team flag, required agent-team tools declared by the pipeline skill, hooks.json or hook scripts, Python/bash/git, secret deny posture while bypass mode is active, or critical `.kiln` state validators. Do not print "Ready to fire" for a session that cannot run agent teams.

End with one of:
- `Verdict: READY` — no FAIL, no unverified hard native-team requirement.
- `Verdict: DEGRADED` — no FAIL, but runtime introspection/LSP/Playwright/Codex optional checks are incomplete.
- `Verdict: NOT READY` — at least one FAIL.
