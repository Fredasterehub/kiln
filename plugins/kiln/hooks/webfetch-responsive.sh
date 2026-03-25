#!/bin/bash
# webfetch-responsive.sh — PreToolUse hook for WebFetch
# Pre-checks URL can deliver content within 20 seconds.
# Does a real GET (not HEAD) — HEAD lies about availability.
# Exit 0 with structured JSON deny output = block. Exit 0 with no output = allow.

INPUT=$(cat 2>/dev/null || true)

allow() {
  exit 0
}

deny() {
  jq -cn --arg reason "$1" '{
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

# Real GET with 20s timeout — downloads first 1KB to prove content delivery.
# HEAD passes on sites that hang on actual content (the whole problem).
if curl -s -L --max-time 20 -r 0-1023 -o /dev/null -w '' "$URL" 2>/dev/null; then
  allow
fi

deny "WebFetch pre-check: $URL did not deliver content within 20 seconds. Find an alternative source."
