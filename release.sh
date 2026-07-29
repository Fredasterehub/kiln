#!/usr/bin/env bash
# release.sh — cut a Kiln release. One command, start to finish.
#
#   ./release.sh X.Y.Z "Chapter Name" [notes.md]
#
# Bumps the three version fields, runs the gate on the final tree, commits,
# tags, pushes, verifies the tag on origin, and publishes the GitHub release.
# Every step fails loudly and stops; nothing is retried or repaired silently.
set -euo pipefail

if [ -t 1 ]; then
  TERRACOTTA=$'\033[38;5;173m'; GOLD=$'\033[38;5;179m'
  GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  TERRACOTTA=''; GOLD=''; GREEN=''; RED=''; DIM=''; RESET=''
fi

RULE="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

step() { printf "  %s→ %s%s\n" "$DIM" "$1" "$RESET"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
fail() { printf "  %s✗%s %s\n" "$RED" "$RESET" "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./release.sh X.Y.Z "Chapter Name" [notes.md]

  X.Y.Z         the new version — written to all three manifest fields
  Chapter Name  the release chapter, e.g. "The Realignment"
                becomes: commit "release: vX.Y.Z — Chapter Name"
                         tag    "Kiln vX.Y.Z — Chapter Name"
                         GitHub release "vX.Y.Z — Chapter Name"
  notes.md      optional release notes file; without it, gh generates notes

The README's "Fresh from the Kiln" narrative is written by hand, before the
release. This script does not touch prose.
EOF
}

printf "%s%s%s\n" "$GOLD" "$RULE" "$RESET"
printf "%s KILN%s %srelease%s\n" "$TERRACOTTA" "$RESET" "$DIM" "$RESET"
printf "%s%s%s\n\n" "$GOLD" "$RULE" "$RESET"

if [ $# -eq 1 ] && [ "$1" = "--help" ]; then usage; exit 0; fi
if [ $# -lt 2 ] || [ $# -gt 3 ]; then usage; exit 1; fi

VERSION="$1"
CHAPTER="$2"
NOTES="${3:-}"
TAG="v${VERSION}"
TITLE="${TAG} — ${CHAPTER}"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Version must be X.Y.Z, got '$VERSION'"
[ -n "$CHAPTER" ] || fail "Chapter name must not be empty"
if [ -n "$NOTES" ]; then
  [ -f "$NOTES" ] || fail "Notes file not found: $NOTES"
  NOTES="$(cd "$(dirname "$NOTES")" && pwd)/$(basename "$NOTES")"
fi

for tool in git jq gh; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool not found — install $tool"
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATE="$SCRIPT_DIR/validate.sh"
[ -x "$VALIDATE" ] || fail "validate.sh must sit beside release.sh and be executable"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Not inside a git repository"
cd "$ROOT"
MARKETPLACE=".claude-plugin/marketplace.json"
PLUGIN="plugins/kiln/.claude-plugin/plugin.json"
if [ ! -f "$MARKETPLACE" ] || [ ! -f "$PLUGIN" ]; then fail "Not the Kiln repo root: $ROOT"; fi

printf "%sPreconditions%s\n" "$DIM" "$RESET"

step "git rev-parse --abbrev-ref HEAD"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || fail "Releases are cut from main. Current branch: $BRANCH"
ok "On main"

step "git status --porcelain"
[ -z "$(git status --porcelain)" ] || fail "Working tree is dirty. Commit or stash first."
ok "Working tree clean"

step "git remote get-url origin"
ORIGIN="$(git remote get-url origin 2>/dev/null)" || fail "No 'origin' remote — this is not the Kiln repository clone."
ok "Origin: $ORIGIN"

step "git fetch --tags"
git fetch --tags || fail "git fetch failed"
ok "Refs and tags fetched"

step "git rev-parse -q --verify refs/tags/$TAG"
! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1 || fail "Tag $TAG already exists"
ok "Tag available: $TAG"

step "gh auth status"
gh auth status >/dev/null 2>&1 || fail "GitHub CLI not authenticated. Run: gh auth login"
ok "GitHub CLI authenticated"

printf "\n%sVersion%s\n" "$DIM" "$RESET"

FROM="$(jq -r '.version' "$PLUGIN")"
step "bump $FROM → $VERSION in all three manifest fields"

write_json() {
  local file="$1" filter="$2"
  jq --arg v "$VERSION" "$filter" "$file" > "$file.tmp" && mv "$file.tmp" "$file"
}
# shellcheck disable=SC2016  # $v is a jq variable, not a shell one
write_json "$PLUGIN" '.version = $v'
# shellcheck disable=SC2016
write_json "$MARKETPLACE" '.version = $v | .plugins[0].version = $v'

for got in \
  "$(jq -r '.version' "$PLUGIN")" \
  "$(jq -r '.version' "$MARKETPLACE")" \
  "$(jq -r '.plugins[0].version' "$MARKETPLACE")"
do
  [ "$got" = "$VERSION" ] || fail "Bump did not take — a manifest field reads '$got'"
done
ok "All three fields read $VERSION"

printf "\n%sGate — on the final tree%s\n" "$DIM" "$RESET"

if ! "$VALIDATE" "$ROOT"; then
  git checkout -- "$PLUGIN" "$MARKETPLACE"
  fail "Gate failed on the bumped tree. The version bump was reverted; nothing was committed."
fi

printf "\n%sPublish%s\n" "$DIM" "$RESET"

step "git commit -m \"release: $TITLE\""
git add "$PLUGIN" "$MARKETPLACE"
git commit -q -m "release: $TITLE"
ok "Release commit created"

step "git tag -a $TAG -m \"Kiln $TITLE\""
git tag -a "$TAG" -m "Kiln $TITLE"
ok "Annotated tag created"

step "git push origin $BRANCH"
git push origin "$BRANCH" || fail "Push of $BRANCH failed. The commit and tag are local; fix and rerun the push."
ok "Branch pushed"

step "git push origin $TAG"
git push origin "$TAG" || fail "Push of $TAG failed. The tag is local; fix and push it before creating the release."
ok "Tag pushed"

step "git ls-remote --tags --exit-code origin refs/tags/$TAG"
git ls-remote --tags --exit-code origin "refs/tags/$TAG" >/dev/null \
  || fail "$TAG is not on origin after the push."
ok "Tag verified on origin"

if [ -n "$NOTES" ]; then
  step "gh release create $TAG --notes-file $NOTES"
  URL="$(gh release create "$TAG" --title "$TITLE" --notes-file "$NOTES" --latest --verify-tag)"
else
  step "gh release create $TAG --generate-notes"
  URL="$(gh release create "$TAG" --title "$TITLE" --generate-notes --latest --verify-tag)"
fi
ok "GitHub release published"

printf "\n%s%s%s\n" "$GOLD" "$RULE" "$RESET"
printf "%s Kiln %s is out.%s\n" "$TERRACOTTA" "$TAG" "$RESET"
printf "  %sCommit%s   %s\n" "$DIM" "$RESET" "$(git rev-parse HEAD)"
printf "  %sChapter%s  %s\n" "$DIM" "$RESET" "$CHAPTER"
printf "  %sRelease%s  %s\n" "$DIM" "$RESET" "$URL"
printf "%s%s%s\n" "$GOLD" "$RULE" "$RESET"
