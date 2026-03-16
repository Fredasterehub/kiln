#!/bin/bash

INPUT=$(cat 2>/dev/null || true)

allow() {
  printf '{"decision":"allow"}\n'
  exit 0
}

block() {
  jq -cn --arg url "$1" --arg message "WebFetch pre-check: $1 timed out or did not respond to a HEAD request within 30 seconds. Find an alternative source." '{decision:"block",message:$message}'
  exit 0
}

# Pipeline context gate — only enforce in active kiln pipelines
_in_pipeline() {
  local d="$PWD"
  while [[ "$d" != "/" ]]; do
    [[ -d "$d/.kiln" ]] && return 0
    d=$(dirname "$d")
  done
  return 1
}
_in_pipeline || allow

[[ -n "$INPUT" ]] || allow

if ! printf '%s' "$INPUT" | jq empty >/dev/null 2>&1; then
  allow
fi

URL=$(printf '%s' "$INPUT" | jq -r '.tool_input.url // ""' 2>/dev/null)

[[ -n "$URL" ]] || allow

if curl -sI -L --max-time 30 "$URL" >/dev/null 2>&1; then
  allow
fi

block "$URL"
