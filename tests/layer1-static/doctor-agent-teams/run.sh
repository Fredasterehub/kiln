#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
DOCTOR="$REPO_ROOT/plugins/kiln/commands/kiln-doctor.md"

snippet=$(awk '
  /Check the experimental flag/ { seen = 1 }
  seen && /^```bash$/ { in_block = 1; next }
  in_block && /^```$/ { exit }
  in_block { print }
' "$DOCTOR")

if [[ -z "$snippet" ]]; then
  echo "doctor-agent-teams: failed to extract experimental flag snippet" >&2
  exit 1
fi

if grep -qE '\|\s*head\b' <<<"$snippet"; then
  echo "doctor-agent-teams: flag check must not pipe grep into head" >&2
  exit 1
fi

run_case() {
  local name="$1"
  local expected="$2"
  local mode="$3"
  local tmp
  tmp=$(mktemp -d -t kiln-doctor-XXXXXX)
  trap 'rm -rf "$tmp"' RETURN
  mkdir -p "$tmp/project" "$tmp/home"

  case "$mode" in
    no-settings)
      ;;
    invalid-settings)
      mkdir -p "$tmp/home/.claude"
      printf '{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": 0}\n' > "$tmp/home/.claude/settings.json"
      ;;
    env)
      ;;
    valid-settings)
      mkdir -p "$tmp/home/.claude"
      printf '{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}\n' > "$tmp/home/.claude/settings.local.json"
      ;;
    *)
      echo "unknown case mode: $mode" >&2
      exit 1
      ;;
  esac

  local actual
  if [[ "$mode" == "env" ]]; then
    actual=$(cd "$tmp/project" && HOME="$tmp/home" CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 bash -c "$snippet")
  else
    actual=$(cd "$tmp/project" && HOME="$tmp/home" env -u CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS bash -c "$snippet")
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "doctor-agent-teams: $name got '$actual', expected '$expected'" >&2
    exit 1
  fi
  echo "  ✓ $name"
}

echo "── Layer 1 — Doctor agent-team fixtures ──"
run_case "missing settings is missing" "MISSING" "no-settings"
run_case "settings without flag is missing" "MISSING" "invalid-settings"
run_case "env flag passes" "OK:env" "env"
run_case "settings flag passes" "OK:settings" "valid-settings"
