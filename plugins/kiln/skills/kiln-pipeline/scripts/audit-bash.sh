#!/bin/bash
# audit-bash.sh — PostToolUse hook for Bash filesystem audit
#
# Detects filesystem writes that bypass PreToolUse enforcement.
# Audit-only: never blocks the tool call. Warnings go to stderr AND exit 2
# so Claude Code surfaces them to the agent (exit 0 hides stderr on
# PostToolUse per v2.1.89 conventions).
#
# Flagged violations:
#   - Any pipeline agent writing to system config paths (.codex/, .claude/settings)
#   - Delegation agents (dial-a-coder, art-of-war) writing outside /tmp/
#   - bossman writing source code (anything outside .kiln/)
#
# Never flagged:
#   - Writes to /tmp/ (legitimate prompt staging for codex exec)
#   - Builder agents doing codex exec (their intended workflow)
#   - Non-Kiln agents (Explore, statusline, memory writes)
#   - Main session (engine owns all files)
#   - Commands with no filesystem write patterns

# Resolve the hooks dir once and source shared primitives (see
# enforce-pipeline.sh for the CLAUDE_PLUGIN_ROOT fallback rationale).
_KILN_HOOKS_DIR="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}/hooks"
. "$_KILN_HOOKS_DIR/_kiln-lib.sh"
. "$_KILN_HOOKS_DIR/_kiln-agents.sh"

INPUT=$(cat)
AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')
AGENT="${AGENT#kiln:}"
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# ── Pipeline context gate ────────────────────────────────────
# Only audit during active Kiln pipeline runs.
_kiln_pipeline_active || exit 0

# Main session (empty AGENT) is the engine — it owns all files, no audit needed.
# For named agents, only audit known Kiln pipeline agents.
[[ -n "$AGENT" ]] || exit 0
_kiln_is_known_agent "$AGENT" || exit 0

# ── Write-pattern detection ──────────────────────────────────
# Detect commands with filesystem write side effects.
# /tmp/ paths are excluded from flagging (legitimate prompt staging area).

_has_write_pattern=0

# cat heredoc writes: cat <<EOF or cat <<'EOF'
if echo "$COMMAND" | grep -qE 'cat\s+<<'; then
  _has_write_pattern=1
fi

# Redirect writes: cmd > path or cmd >> path (absolute or relative)
# Exclude: 2> (stderr), >/dev/null, > /tmp/
if echo "$COMMAND" | grep -qP '(?<![2&])>{1,2}\s+(?!/dev/null)(?!/tmp/)\S'; then
  _has_write_pattern=1
fi

# echo/printf writing to file (absolute or relative, exclude /tmp/ and /dev/null)
if echo "$COMMAND" | grep -qP '\b(echo|printf)\b[^>]*>\s+(?!/dev/null)(?!/tmp/)\S'; then
  _has_write_pattern=1
fi

# tee writing to a non-/tmp/ file
if echo "$COMMAND" | grep -qP '\btee\s+(?!/tmp/)\S'; then
  _has_write_pattern=1
fi

# cp or mv file operations (excluding purely /tmp/ to /tmp/)
if echo "$COMMAND" | grep -qP '\b(cp|mv)\s' && ! echo "$COMMAND" | grep -qP '\b(cp|mv)\s+/tmp/\S+\s+/tmp/'; then
  _has_write_pattern=1
fi

[[ "$_has_write_pattern" -eq 1 ]] || exit 0

# ── Violation checks ─────────────────────────────────────────
# _has_write_pattern=1 confirmed a write. Now check WHO and WHERE.
# Don't re-detect writes — use simple string matching on the full command.

# Check 1 — Any pipeline agent writing to system config paths (.codex/, .claude/settings)
if echo "$COMMAND" | grep -qE '(\.codex/|\.claude/settings|\.claude/projects/)'; then
  echo "AUDIT WARNING: $AGENT wrote to system config path via Bash. This bypasses PreToolUse enforcement (hook 5)." >&2
  echo "  Use Write/Edit tools for auditable file operations. Escalate tooling issues to the engine." >&2
  echo "  Command: $(echo "$COMMAND" | head -3)" >&2
  exit 2
fi

# Check 2 — Delegation agents (dial-a-coder + art-of-war) writing outside /tmp/
# Intended workflow: stage prompts in /tmp/, then run codex exec. Direct writes bypass hook 1.
if [[ "$AGENT" =~ ^(dial-a-coder|art-of-war)$ ]]; then
  # codex exec itself is the intended delegation path — always allowed
  if echo "$COMMAND" | grep -qE 'codex exec'; then
    exit 0
  fi
  # Any write that doesn't reference /tmp/ is suspicious
  if ! echo "$COMMAND" | grep -qE '/tmp/'; then
    echo "AUDIT WARNING: $AGENT wrote to a non-/tmp/ path via Bash. This bypasses PreToolUse enforcement (hook 1)." >&2
    echo "  Delegation agents should stage prompts in /tmp/ and delegate code writes to codex exec." >&2
    echo "  Command: $(echo "$COMMAND" | head -3)" >&2
    exit 2
  fi
  exit 0
fi

# Check 3 — bossman writing source code (anything outside .kiln/)
if [[ "$AGENT" == "bossman" ]]; then
  if ! echo "$COMMAND" | grep -qE '\.kiln/'; then
    echo "AUDIT WARNING: bossman wrote files outside .kiln/ via Bash. This bypasses PreToolUse enforcement (hook 7)." >&2
    echo "  bossman should scope and delegate, not write source code directly." >&2
    echo "  Command: $(echo "$COMMAND" | head -3)" >&2
    exit 2
  fi
  exit 0
fi

# All other Kiln agents with write patterns — no specific restriction, exit cleanly
exit 0
