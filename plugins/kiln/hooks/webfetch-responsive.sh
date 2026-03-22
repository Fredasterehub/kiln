#!/bin/bash
# webfetch-responsive.sh — PreToolUse hook for WebFetch
# Pre-checks URL reachability before allowing WebFetch tool calls.
# Exit 0 with structured JSON deny output = block. Exit 0 with no output = allow.

INPUT=$(cat 2>/dev/null || true)

allow() {
  exit 0
}

deny() {
  jq -cn --arg reason "WebFetch pre-check: $1 timed out or did not respond to a HEAD request within 30 seconds. Find an alternative source." '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

[[ -n "$INPUT" ]] || allow

if ! printf '%s' "$INPUT" | jq empty >/dev/null 2>&1; then
  allow
fi

URL=$(printf '%s' "$INPUT" | jq -r '.tool_input.url // ""' 2>/dev/null)

[[ -n "$URL" ]] || allow

if curl -sI -L --max-time 30 "$URL" >/dev/null 2>&1; then
  allow
fi

deny "$URL"
