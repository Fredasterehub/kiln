---
name: kiln-doctor
description: Check Kiln pipeline prerequisites and diagnose issues.
argument-hint: [--fix]
allowed-tools: Read, Write, Bash, Glob, Grep
---

# /kiln-doctor

Run diagnostics to verify the Kiln pipeline is ready to fire. Use `--fix` to automatically remediate identified issues.

## Checks and Fixes

Run all checks and present results as a checklist. If `--fix` is provided, execute the FIX action after a check fails.

### 0. Cache Health
- **Check**: Compare `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` version against directory name in `~/.claude/plugins/cache/kiln/kiln/`.
- **Status**: `[PASS] Cache: v{version}` or `[FAIL] Cache STALE`
- **FIX**: `rm -rf "$HOME/.claude/plugins/cache/kiln/"`. Inform operator: "Cache cleared. Restart Claude Code to apply changes."

### 1. Plugin Version
- **Check**: Read `version` from `plugin.json`.
- **Status**: `[INFO] Kiln version: {version}`

### 2. Codex CLI Availability
- **Check**: `command -v codex`.
- **Status**: `[PASS] Codex CLI: {version}` or `[INFO] Codex CLI: not found — Claude-only fallback enabled`

### 3. Codex Delegation Probe
- **Check**: Run a minimal `codex exec` in a temp git repo.
- **Status**: `[PASS] Codex delegation: probe succeeded` or `[WARN] Codex delegation: probe failed`

### 4. Kiln Agent Files
- **Check**: Count `agents/*.md` files (expected: 32).
- **Status**: `[PASS] Agent files: 32/32 present` or `[FAIL] Missing: {list}`
- **FIX**: If missing files, suggest `claude plugin update kiln`.

### 5. Pipeline Skill & References
- **Check**: Verify existence of `SKILL.md` and all 15+ reference files.
- **Status**: `[PASS] Pipeline skill: All files present` or `[FAIL] Missing: {list}`

### 6. Playwright MCP
- **Check**: Check `argus.md` and `hephaestus.md` for `mcp__playwright__` tool usage.
- **Status**: `[PASS] Playwright MCP: detected` or `[INFO] Playwright MCP: not found (Argus fallback enabled)`

### 7. Existing Pipeline State
- **Check**: Read `.kiln/STATE.md`.
- **Status**: `[INFO] Pipeline state: {stage}, iteration {N}` or `[INFO] Pipeline state: No existing run`
- **FIX (if stage=complete)**: If operator wants to re-run, suggest `rm .kiln/STATE.md`.

### 8. Git Configuration
- **Check**: `git config user.name` and `git config user.email`.
- **Status**: `[PASS] Git config: {name} <{email}>` or `[FAIL] Git config missing`
- **FIX**: If `--fix` and project root found, suggest setting local git config.

### 9. Hook Health
- **Check**: Verify `hooks.json` matches files in `hooks/`.
- **Status**: `[PASS] Hooks: All scripts executable` or `[FAIL] Missing/non-executable scripts`
- **FIX**: `chmod +x hooks/*.sh`

## Verdict
End with a clear summary: `Verdict: Ready to fire (mode: {Claude-only|Multi-model})!`
