#!/usr/bin/env bash
# validate-release.sh — Pre-release gate for Kiln.
# Fail-fast: exits non-zero on the first failed check with a descriptive message.
# Run standalone from anywhere; resolves the repo root via git.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

GREEN='\033[32m'
RED='\033[31m'
RESET='\033[0m'

pass() { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
fail() { printf "  ${RED}✗${RESET} %s\n" "$1" >&2; exit 1; }

PLUGIN_JSON="plugins/kiln/.claude-plugin/plugin.json"
MARKETPLACE_JSON=".claude-plugin/marketplace.json"

# (a) Manifests are valid JSON.
jq empty "$PLUGIN_JSON" 2>/dev/null || fail "Invalid JSON: $PLUGIN_JSON"
jq empty "$MARKETPLACE_JSON" 2>/dev/null || fail "Invalid JSON: $MARKETPLACE_JSON"
pass "Manifests parse as JSON"

# (b) The three version fields agree.
PLUGIN_VER="$(jq -r .version "$PLUGIN_JSON")"
MKT_VER="$(jq -r .version "$MARKETPLACE_JSON")"
MKT_PLUGIN_VER="$(jq -r '.plugins[0].version' "$MARKETPLACE_JSON")"
if [[ "$PLUGIN_VER" != "$MKT_VER" || "$PLUGIN_VER" != "$MKT_PLUGIN_VER" ]]; then
  fail "Version drift: plugin.json=$PLUGIN_VER marketplace.version=$MKT_VER marketplace.plugins[0].version=$MKT_PLUGIN_VER"
fi
pass "Version consistent across manifests ($PLUGIN_VER)"

# (c) Every workflow parses as JavaScript.
for js in plugins/kiln/workflows/*.js; do
  node --check "$js" 2>/dev/null || fail "node --check failed: $js"
done
pass "Workflows pass node --check"

# (d) The three data files exist and parse as JSON.
for name in lore-quotes.json tiers.json voice.json; do
  f="plugins/kiln/data/$name"
  [[ -f "$f" ]] || fail "Missing data file: $f"
  jq empty "$f" 2>/dev/null || fail "Invalid JSON: $f"
done
pass "Data files present and valid"

# (e) Zero-hooks invariant: hooks are parked until dogfood proves need (CONSTITUTION).
HOOKS="$(git ls-files plugins/kiln/hooks/)"
[[ -z "$HOOKS" ]] || fail "Hook creep — hooks are parked until dogfood proves need (CONSTITUTION), got:"$'\n'"$HOOKS"
pass "Zero-hooks invariant holds"

# (f) No tracked file references the deleted v1 skill paths. git grep searches
# tracked files only; exclude this script, which contains the patterns literally.
if STALE="$(git grep -l -e 'skills/kiln-pipeline/' -e 'skills/kiln-protocol/' -- . ':(exclude)scripts/validate-release.sh')"; then
  fail "Deleted v1 skill paths still referenced in tracked files:"$'\n'"$STALE"
fi
pass "No stale v1 skill-path references"

# (g) The v3 harness is green.
bash tests/v3/run.sh >/dev/null 2>&1 || fail "v3 harness failed — run 'bash tests/v3/run.sh'"
pass "v3 harness green (node --test tests/v3/)"

# (h) The plugin manifest passes the platform's own strict validator, when the CLI is present.
# CI boxes may lack the claude binary — skip with a visible note rather than fail the floor.
if command -v claude >/dev/null 2>&1; then
  claude plugin validate plugins/kiln --strict >/dev/null 2>&1 \
    || fail "'claude plugin validate plugins/kiln --strict' failed — inspect the manifest"
  pass "Plugin manifest passes 'claude plugin validate --strict'"
else
  printf "  - %s\n" "claude CLI absent — skipped 'claude plugin validate --strict' (check h)"
fi

printf "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "${GREEN} Release gate passed.${RESET}\n"
printf "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
