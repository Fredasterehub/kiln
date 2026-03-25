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

# Stream the response and stop after the first 1KB. This proves body bytes arrived
# even when the server ignores Range, without waiting for the full response to finish.
BYTES=$(
  curl -sS -L \
    --globoff \
    --proto '=http,https' \
    --proto-redir '=http,https' \
    --connect-timeout 5 \
    --max-time 20 \
    --speed-time 10 \
    --speed-limit 100 \
    --range 0-1023 \
    -- "$URL" 2>/dev/null | head -c 1024 | wc -c | tr -d '[:space:]'
)
if [[ "$BYTES" =~ ^[0-9]+$ ]] && (( BYTES > 0 )); then
  allow
fi

deny "WebFetch pre-check: $URL did not deliver content within 20 seconds. Find an alternative source."
