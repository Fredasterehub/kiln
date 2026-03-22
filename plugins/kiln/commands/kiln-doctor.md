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
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/step-definitions.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/artifact-flow.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md`

### 6. Existing Pipeline State

Check for `.kiln/STATE.md` in the current working directory:
- If found: display current stage, build_iteration, correction_cycle, run_id
- If not found: "No existing pipeline state. Ready for a fresh run."

### 7. Brainstorm Data

Check that brainstorm technique files exist:
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/brainstorming-techniques.json`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/elicitation-methods.json`
- If both are present: `[PASS] Brainstorm data: technique files present`
- If missing: "Brainstorm data files not found. Da Vinci will work without technique suggestions."

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
[INFO] Pipeline state: No existing run (ready for fresh start)
[PASS] Brainstorm data: technique files present

Verdict: Ready to fire (Claude-only mode)!
```

Use PASS/WARN/INFO/FIX prefixes. Prefer WARN or INFO over FAIL when Kiln can still run via Claude-only fallback. End with a clear verdict that reflects whether Codex-backed delegation is available.
