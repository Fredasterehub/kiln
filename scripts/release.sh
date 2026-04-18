#!/usr/bin/env bash
set -euo pipefail

TERRACOTTA='\033[38;5;173m'
GOLD='\033[38;5;179m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION=""
DESCRIPTION=""
CURRENT_BRANCH=""
TAG_NAME=""
RELEASE_URL=""
COMMIT_SHA=""

print_banner() {
  printf "%b\n" "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  printf "%b\n" "${TERRACOTTA} KILN${RESET} ${DIM}release${RESET}"
  printf "%b\n\n" "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

print_usage() {
  printf "%s\n" "Usage: ./scripts/release.sh X.Y.Z \"short description\""
  printf "\n"
  printf "%s\n" "Cut a Kiln release by bumping the version files, committing, tagging,"
  printf "%s\n" "pushing the branch and tag, verifying the tag on origin, and creating"
  printf "%s\n" "a GitHub release."
}

print_command() {
  printf "${DIM}  → %s${RESET}\n" "$1"
}

fail() {
  printf "  ${RED}✗${RESET} %s\n" "$1" >&2
  exit 1
}

print_banner

if [[ $# -eq 1 && "$1" == "--help" ]]; then
  print_usage
  exit 0
fi

if [[ $# -ne 2 ]]; then
  print_usage
  exit 1
fi

VERSION="$1"
DESCRIPTION="$2"
TAG_NAME="v${VERSION}"

if [[ -z "$DESCRIPTION" ]]; then
  print_usage
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "Invalid version format '$VERSION'. Expected: X.Y.Z"
fi

printf "%b\n" "${DIM}Checking preconditions...${RESET}"

print_command "git rev-parse --abbrev-ref HEAD"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]] && [[ "$CURRENT_BRANCH" != "v9" ]]; then
  fail "Must release from main or v9. Current branch: ${CURRENT_BRANCH}"
fi
printf "  ${GREEN}✓${RESET} Current branch: %s\n" "$CURRENT_BRANCH"

print_command "git status --porcelain"
if [[ -n "$(git status --porcelain)" ]]; then
  fail "Working tree is dirty. Commit or stash first."
fi
printf "  ${GREEN}✓${RESET} Working tree clean\n"

print_command "git fetch"
if ! git fetch; then
  fail "git fetch failed"
fi
printf "  ${GREEN}✓${RESET} Fetched latest refs\n"

print_command "git rev-parse -q --verify \"refs/tags/${TAG_NAME}\""
if git rev-parse -q --verify "refs/tags/${TAG_NAME}" >/dev/null 2>&1; then
  fail "Tag ${TAG_NAME} already exists."
fi
printf "  ${GREEN}✓${RESET} Tag available: %s\n" "$TAG_NAME"

print_command "gh auth status"
if ! gh auth status >/dev/null 2>&1; then
  fail "GitHub CLI not authenticated. Run: gh auth login"
fi
printf "  ${GREEN}✓${RESET} GitHub CLI authenticated\n"

printf "%b\n" "\n${DIM}Running release flow...${RESET}"

print_command "./scripts/bump-version.sh \"$VERSION\""
./scripts/bump-version.sh "$VERSION"
printf "  ${GREEN}✓${RESET} Version files updated\n"

print_command "git add plugins/kiln/.claude-plugin/plugin.json .claude-plugin/marketplace.json plugins/kiln/skills/kiln-pipeline/SKILL.md"
git add \
  plugins/kiln/.claude-plugin/plugin.json \
  .claude-plugin/marketplace.json \
  plugins/kiln/skills/kiln-pipeline/SKILL.md
printf "  ${GREEN}✓${RESET} Staged release files\n"

print_command "git commit -m \"release: ${TAG_NAME} — ${DESCRIPTION}\""
git commit -m "release: ${TAG_NAME} — ${DESCRIPTION}"
printf "  ${GREEN}✓${RESET} Created release commit\n"

print_command "git tag -a \"${TAG_NAME}\" -m \"Kiln ${TAG_NAME} — ${DESCRIPTION}\""
git tag -a "${TAG_NAME}" -m "Kiln ${TAG_NAME} — ${DESCRIPTION}"
printf "  ${GREEN}✓${RESET} Created annotated tag %s\n" "$TAG_NAME"

print_command "git push origin \"${CURRENT_BRANCH}\""
git push origin "${CURRENT_BRANCH}"
printf "  ${GREEN}✓${RESET} Pushed branch origin/%s\n" "$CURRENT_BRANCH"

print_command "git push origin \"${TAG_NAME}\""
git push origin "${TAG_NAME}"
printf "  ${GREEN}✓${RESET} Pushed tag %s\n" "$TAG_NAME"

print_command "git ls-remote --tags --exit-code origin \"refs/tags/${TAG_NAME}\""
if ! git ls-remote --tags --exit-code origin "refs/tags/${TAG_NAME}" >/dev/null; then
  fail "Tag ${TAG_NAME} was not found on origin after push."
fi
printf "  ${GREEN}✓${RESET} Verified tag on origin: %s\n" "$TAG_NAME"

if [[ "$CURRENT_BRANCH" == "main" ]] && [[ -f "/DEV/kiln/.kiln-dev/sunset-window.flag" ]]; then
  print_command "git push origin main:v9"
  git push origin main:v9
  printf "  ${GREEN}✓${RESET} Sunset dual-push completed: main -> v9\n"
fi

print_command "gh release create \"${TAG_NAME}\" --notes \"${DESCRIPTION}\""
RELEASE_URL="$(gh release create "${TAG_NAME}" --notes "${DESCRIPTION}")"
printf "  ${GREEN}✓${RESET} Created GitHub release\n"

print_command "git rev-parse HEAD"
COMMIT_SHA="$(git rev-parse HEAD)"

printf "%b\n" "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
printf "%b\n" "${TERRACOTTA} Release complete.${RESET}"
printf "  ${DIM}Commit:${RESET}  %s\n" "$COMMIT_SHA"
printf "  ${DIM}Tag:${RESET}     %s\n" "$TAG_NAME"
printf "  ${DIM}Release:${RESET} %s\n" "$RELEASE_URL"
printf "%b\n" "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
