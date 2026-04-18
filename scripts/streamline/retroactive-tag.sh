#!/usr/bin/env bash
set -euo pipefail

TERRACOTTA='\033[38;5;173m'
GOLD='\033[38;5;179m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

VERSIONS="1.0.0 1.0.1 1.1.0 1.2.0 1.3.0"
REMOTE_BRANCH="${REMOTE_BRANCH:-v9}"

DRY_RUN="false"
YES="false"
CREATED=0
SKIPPED=0
NOT_FOUND=0
ERRORS=0

print_banner() {
  printf "%b\n" "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  printf "%b\n" "${TERRACOTTA} KILN${RESET} ${DIM}retroactive release tags${RESET}"
  printf "%b\n\n" "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

print_usage() {
  printf "%s\n" "Usage: retroactive-tag.sh [--dry-run] [--yes] [--help]"
  printf "\n"
  printf "%s\n" "Create and push annotated retroactive tags for historical Kiln release commits"
  printf "%s\n" "found on origin/${REMOTE_BRANCH}."
  printf "\n"
  printf "%s\n" "Options:"
  printf "%s\n" "  --dry-run  Run commit/tag checks and show write commands without executing them"
  printf "%s\n" "  --yes      Skip per-tag interactive confirmation"
  printf "%s\n" "  --help     Show this help"
}

run_write() {
  local display="$1"
  shift

  if [[ "$DRY_RUN" == "true" ]]; then
    printf "  ${YELLOW}○${RESET} [DRY-RUN] %s\n" "$display"
    return 0
  fi

  printf "  ${DIM}→ %s${RESET}\n" "$display"
  "$@"
}

confirm_tag() {
  if [[ "$YES" == "true" ]]; then
    return 0
  fi

  local reply=""
  read -r -p "  Create and push tag v${1}? [y/N] " reply </dev/tty || {
    printf "%b\n" "  ${RED}✗${RESET} Confirmation failed" >&2
    return 1
  }
  [[ "$reply" =~ ^[Yy] ]]
}

print_summary() {
  printf "%b\n" "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  printf "%b\n" "${TERRACOTTA} Summary${RESET}"
  printf "%b\n\n" "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  printf "  ${GREEN}Created:${RESET}    %d\n" "$CREATED"
  printf "  ${YELLOW}Skipped:${RESET}    %d ${DIM}(already tagged or declined)${RESET}\n" "$SKIPPED"
  printf "  ${YELLOW}Not found:${RESET}  %d\n" "$NOT_FOUND"
  printf "  ${RED}Errors:${RESET}     %d\n" "$ERRORS"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN="true"
      ;;
    --yes)
      YES="true"
      ;;
    --help)
      print_usage
      exit 0
      ;;
    --*)
      printf "${RED}✗${RESET} Unknown option: %s\n\n" "$1" >&2
      print_usage
      exit 1
      ;;
    *)
      printf "${RED}✗${RESET} Unexpected argument: %s\n\n" "$1" >&2
      print_usage
      exit 1
      ;;
  esac
  shift
done

print_banner

printf "  ${DIM}→ %s${RESET}\n" "git fetch origin"
if ! git fetch origin; then
  printf "%b\n" "  ${RED}✗${RESET} git fetch origin failed" >&2
  exit 1
fi
printf "%b\n\n" "  ${GREEN}✓${RESET} Fetched origin"

for v in $VERSIONS; do
  SHA="$(git log --grep="^release: v${v}\b" --format="%H" "origin/${REMOTE_BRANCH}" -n 1)"

  if [[ -z "$SHA" ]]; then
    printf "  ${RED}✗${RESET} v%s: release commit not found on origin/%s, skipping\n\n" "$v" "$REMOTE_BRANCH"
    NOT_FOUND=$((NOT_FOUND + 1))
    continue
  fi

  if git rev-parse -q --verify "refs/tags/v${v}" >/dev/null 2>&1 || \
    git ls-remote --tags --exit-code origin "refs/tags/v${v}" >/dev/null 2>&1; then
    printf "  ${YELLOW}○${RESET} v%s already tagged, skipping\n\n" "$v"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  SUBJECT="$(git log -1 --format="%s" "$SHA")"

  printf "  ${DIM}SHA:${RESET}     %s\n" "$SHA"
  printf "  ${DIM}Commit:${RESET}  %s\n" "$SUBJECT"

  if ! confirm_tag "$v"; then
    printf "  ${YELLOW}○${RESET} v%s skipped\n\n" "$v"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  TAG_MESSAGE="Kiln v${v} — ${SUBJECT}"

  run_write "git tag -a \"v${v}\" \"$SHA\" -m \"$TAG_MESSAGE\"" git tag -a "v${v}" "$SHA" -m "$TAG_MESSAGE"
  run_write "git push origin \"v${v}\"" git push origin "v${v}"

  if [[ "$DRY_RUN" == "true" ]]; then
    printf "  ${YELLOW}○${RESET} [DRY-RUN] git ls-remote --tags origin \"v%s\"\n\n" "$v"
    CREATED=$((CREATED + 1))
    continue
  fi

  if ! git ls-remote --tags --exit-code origin "v${v}" >/dev/null 2>&1; then
    printf "  ${RED}✗${RESET} Push verify failed for v%s\n\n" "$v"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  printf "  ${GREEN}✓${RESET} v%s tagged and verified on origin\n\n" "$v"
  CREATED=$((CREATED + 1))
done

print_summary
