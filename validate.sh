#!/usr/bin/env bash
# validate.sh — the Kiln v3.2 release gate.
#
#   ./validate.sh [repo-root]
#
# Runnable alone at any time. release.sh runs it again on the final tree, after
# the version bump and before commit/tag/push, so what ships is what was proven.
#
# Root resolution: the argument if given, else this script's own directory, else
# the git toplevel — whichever first holds .claude-plugin/marketplace.json.
set -euo pipefail

if [ -t 1 ]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  GREEN=''; RED=''; DIM=''; RESET=''
fi

pass() { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
skip() { printf "  %s-%s %s\n" "$DIM" "$RESET" "$1"; }
fail() { printf "  %s✗%s %s\n" "$RED" "$RESET" "$1" >&2; exit 1; }

command -v jq   >/dev/null 2>&1 || fail "jq not found — install jq"
command -v node >/dev/null 2>&1 || fail "node not found — Kiln's scripts need Node 18+"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKER=".claude-plugin/marketplace.json"

if [ $# -gt 1 ]; then
  fail "Usage: ./validate.sh [repo-root]"
elif [ $# -eq 1 ]; then
  ROOT="$1"
  [ -f "$ROOT/$MARKER" ] || fail "Not a Kiln repo root (no $MARKER): $ROOT"
elif [ -f "$SCRIPT_DIR/$MARKER" ]; then
  ROOT="$SCRIPT_DIR"
elif TOP="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" && [ -f "$TOP/$MARKER" ]; then
  ROOT="$TOP"
else
  fail "Cannot find the Kiln repo root — pass it: ./validate.sh /path/to/kiln"
fi

ROOT="$(cd "$ROOT" && pwd)"
cd "$ROOT"

MARKETPLACE="$MARKER"
PLUGIN="plugins/kiln/.claude-plugin/plugin.json"
SELF="$(basename "${BASH_SOURCE[0]}")"

printf "%sKiln release gate — %s%s\n" "$DIM" "$ROOT" "$RESET"

# 1. Every JSON in the tree parses — both manifests among them.
[ -f "$PLUGIN" ] || fail "Missing plugin manifest: $PLUGIN"
JSON_COUNT=0
while IFS= read -r f; do
  jq empty "$f" 2>/dev/null || fail "Invalid JSON: $f"
  JSON_COUNT=$((JSON_COUNT + 1))
done < <(find . -name '*.json' -not -path './.git/*' -not -path './.kiln/*')
pass "JSON parses ($JSON_COUNT files, both manifests included)"

# 2. The three version fields move in lockstep.
PLUGIN_VER="$(jq -r '.version' "$PLUGIN")"
MKT_VER="$(jq -r '.version' "$MARKETPLACE")"
MKT_ENTRY_VER="$(jq -r '.plugins[0].version' "$MARKETPLACE")"
if [ "$PLUGIN_VER" != "$MKT_VER" ] || [ "$PLUGIN_VER" != "$MKT_ENTRY_VER" ]; then
  fail "Version drift: plugin.json=$PLUGIN_VER marketplace.version=$MKT_VER marketplace.plugins[0].version=$MKT_ENTRY_VER"
fi
pass "Version agrees across all three fields ($PLUGIN_VER)"

# 3. Marketplace and plugin identity are exactly what the install path expects.
check_field() {
  local got want file
  file="$1"; want="$3"
  got="$(jq -r "$2" "$file")"
  [ "$got" = "$want" ] || fail "$file $2 is '$got' — expected '$want'"
}
check_field "$MARKETPLACE" '.name'               'kiln'
check_field "$MARKETPLACE" '.plugins[0].name'    'kiln'
check_field "$MARKETPLACE" '.plugins[0].source'  './plugins/kiln'
check_field "$MARKETPLACE" '.owner.url'          'https://github.com/Fredasterehub'
check_field "$PLUGIN"      '.name'               'kiln'
check_field "$PLUGIN"      '.author.url'         'https://github.com/Fredasterehub'
check_field "$PLUGIN"      '.repository'         'https://github.com/Fredasterehub/kiln'
pass "Identity intact (kiln@kiln, Fredasterehub, source ./plugins/kiln)"

# 4. Every shipped script parses as JavaScript.
JS_COUNT=0
while IFS= read -r js; do
  node --check "$js" 2>/dev/null || fail "node --check failed: $js"
  JS_COUNT=$((JS_COUNT + 1))
done < <(find . -name '*.js' -not -path './.git/*' -not -path './.kiln/*')
pass "Scripts pass node --check ($JS_COUNT files)"

# 5. Tokens that must not survive into the public tree. This script names each
# pattern literally, so it excludes itself from its own scan.
# $3 is "-i" for names that must not survive in any casing, empty for patterns
# that are only wrong in one casing — /DEV/ is a workstation path, /dev/null is not.
# .git is excluded twice on purpose: a directory in a clone, but a file holding an
# absolute gitdir: path in a linked worktree, where --exclude-dir would not catch it.
# Reports locations only — these files hold long prose lines, and a wall of
# matched text buries the one thing the operator needs: where to go.
no_token() {
  local label="$1" pattern="$2" hits n more=""
  if hits="$(grep -rn ${3:+"$3"} -e "$pattern" . \
        --exclude-dir=.git --exclude-dir=.kiln --exclude=.git --exclude="$SELF" 2>/dev/null)"; then
    hits="$(printf '%s\n' "$hits" | cut -d: -f1,2)"
    n="$(printf '%s\n' "$hits" | wc -l)"
    if [ "$n" -gt 25 ]; then more=$'\n'"    ... and $((n - 25)) more"; fi
    fail "$label — $n occurrence(s):"$'\n'"$(printf '%s\n' "$hits" | head -25)$more"
  fi
  pass "$label"
}
no_token "Zero build-name placeholders (thelastskill)" 'thelastskill' -i
no_token "Zero workstation paths (/DEV/)"              '/DEV/'
no_token "Zero foreman references"                     'foreman'       -i

# 6. Nothing tracked outside the storefront. Needs git; degrades honestly without it.
if TOP="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)"; then
  TRACKED="$(git -C "$ROOT" ls-files)"
  STRAY="$(printf '%s\n' "$TRACKED" | grep -vE '^(README\.md|LICENSE|\.gitignore|release\.sh|validate\.sh|\.claude-plugin/|plugins/|docs/|\.github/)' || true)"
  [ -z "$STRAY" ] || fail "Tracked outside the storefront allowlist:"$'\n'"$STRAY"
  # Build material that could hide inside an allowlisted directory. A top-level
  # research/ is already caught above; plugins/kiln/product/research/ is a
  # shipped phase and must not be, so this list stays off that name.
  BURIED="$(printf '%s\n' "$TRACKED" | grep -E '(^|/)(test|tests|scenarios|evals)/|(^|/)mock-replay\.js$|(^|/)\.(kiln-dev|thelastskill)/' || true)"
  [ -z "$BURIED" ] || fail "Forbidden build/verification paths tracked:"$'\n'"$BURIED"
  if [ "$TOP" = "$ROOT" ]; then
    pass "Tracked paths inside the storefront allowlist"
  else
    pass "Tracked paths inside the storefront allowlist (subtree of $TOP)"
  fi
else
  skip "not a git work tree — skipped the tracked-path check"
fi

# 7. The platform's own strict validator, when the CLI is here. CI boxes have no
# claude binary; a visible skip beats a false floor (kiln precedent).
if command -v claude >/dev/null 2>&1; then
  claude plugin validate plugins/kiln --strict >/dev/null 2>&1 \
    || fail "'claude plugin validate plugins/kiln --strict' failed — inspect the manifest"
  pass "Manifest passes 'claude plugin validate --strict'"
else
  skip "claude CLI absent — skipped 'claude plugin validate --strict'"
fi

printf "\n%sGate passed.%s\n" "$GREEN" "$RESET"
printf "%sNOTE  This gate proves the public tree only. The full suite and the nine\n" "$DIM"
printf "      scenarios live dev-side: run fold-in/verify.sh in the build repo and\n"
printf "      see it green before you cut a release.%s\n" "$RESET"
