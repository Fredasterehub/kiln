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

# (c) Every workflow parses as JavaScript and matches workflows-src/ (the bundler is the only writer).
for js in plugins/kiln/workflows/*.js; do
  node --check "$js" 2>/dev/null || fail "node --check failed: $js"
done
node scripts/bundle-workflows.mjs --check >/dev/null 2>&1 || fail "Generated workflows out of sync — run 'node scripts/bundle-workflows.mjs'"
pass "Workflows pass node --check and match workflows-src"

# (d) The six data files and the two state schemas exist and parse as JSON.
for name in agents.json brainstorming-techniques.json duo-pool.json elicitation-methods.json lore.json spinner-verbs.json; do
  f="plugins/kiln/data/$name"
  [[ -f "$f" ]] || fail "Missing data file: $f"
  jq empty "$f" 2>/dev/null || fail "Invalid JSON: $f"
done
for f in plugins/kiln/schemas/event.schema.json plugins/kiln/schemas/state.schema.json plugins/kiln/schemas/law.schema.json; do
  [[ -f "$f" ]] || fail "Missing schema file: $f"
  jq empty "$f" 2>/dev/null || fail "Invalid JSON: $f"
done
pass "Data files and schemas present and valid"

# (e) Sanctioned-hooks invariant (P5 T2 retired v2's zero-hooks law): the plugin ships EXACTLY
# the design-approved micro hook set — hooks.json + the two command scripts. Anything more or
# less is hook creep or a broken surface; both fail the floor.
HOOKS="$(git ls-files plugins/kiln/hooks/ | sort)"
EXPECTED_HOOKS="plugins/kiln/hooks/hooks.json
plugins/kiln/hooks/notify.sh
plugins/kiln/hooks/session-title.sh"
[[ "$HOOKS" == "$EXPECTED_HOOKS" ]] || fail "Sanctioned-hooks invariant broken — expected exactly the P5 T2 micro set, got:"$'\n'"$HOOKS"
pass "Sanctioned-hooks invariant holds (the P5 T2 micro set, exactly)"

# (f) No tracked file references the deleted v1 skill paths. git grep searches
# tracked files only; exclude this script, which contains the patterns literally.
if STALE="$(git grep -l -e 'skills/kiln-pipeline/' -e 'skills/kiln-protocol/' -- . ':(exclude)scripts/validate-release.sh')"; then
  fail "Deleted v1 skill paths still referenced in tracked files:"$'\n'"$STALE"
fi
pass "No stale v1 skill-path references"

# (g) The v3 harness is green.
bash tests/v3/run.sh >/dev/null 2>&1 || fail "v3 harness failed — run 'bash tests/v3/run.sh'"
pass "v3 harness green (node --test tests/v3/)"

printf "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "${GREEN} Release gate passed.${RESET}\n"
printf "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
