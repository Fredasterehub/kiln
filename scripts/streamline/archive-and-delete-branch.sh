#!/usr/bin/env bash
set -euo pipefail

TERRACOTTA='\033[38;5;173m'
GOLD='\033[38;5;179m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

DRY_RUN="false"
YES="false"
BRANCH=""

print_banner() {
  printf "%b\n" "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  printf "%b\n" "${TERRACOTTA} KILN${RESET} ${DIM}archive remote branch${RESET}"
  printf "%b\n\n" "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

print_usage() {
  printf "%s\n" "Usage: archive-and-delete-branch.sh [--dry-run] [--yes] [--help] BRANCH"
  printf "\n"
  printf "%s\n" "Safely archive a remote branch on origin by tagging its tip, verifying the"
  printf "%s\n" "archive tag on origin, then deleting the remote branch."
  printf "\n"
  printf "%s\n" "Options:"
  printf "%s\n" "  --dry-run  Run validations and show write commands without executing them"
  printf "%s\n" "  --yes      Skip interactive confirmation"
  printf "%s\n" "  --help     Show this help"
}

print_command() {
  printf "${DIM}  → %s${RESET}\n" "$1"
}

print_dry_run_command() {
  printf "  ${YELLOW}○${RESET} [DRY-RUN] %s\n" "$1"
}

run_check() {
  local display="$1"
  shift

  print_command "$display"
  "$@" >/dev/null 2>&1
}

run_write() {
  local display="$1"
  shift

  if [[ "$DRY_RUN" == "true" ]]; then
    print_dry_run_command "$display"
    return 0
  fi

  print_command "$display"
  "$@"
}

confirm_or_abort() {
  local reply=""

  if [[ "$YES" == "true" ]]; then
    printf "%b\n" "  ${YELLOW}○${RESET} Confirmation skipped with ${DIM}--yes${RESET}"
    return 0
  fi

  printf "\n${YELLOW}This will create ${DIM}%s${RESET}${YELLOW}, push it to origin, then delete origin/%s.${RESET}\n" "$ARCHIVE_TAG" "$BRANCH"
  read -r -p "Proceed? [y/N] " reply </dev/tty || {
    printf "%b\n" "\n${RED}✗${RESET} Confirmation failed" >&2
    exit 1
  }

  if [[ ! "$reply" =~ ^[Yy] ]]; then
    printf "%b\n" "\n${YELLOW}○${RESET} Aborted"
    exit 1
  fi
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
      if [[ -n "$BRANCH" ]]; then
        printf "${RED}✗${RESET} Unexpected argument: %s\n\n" "$1" >&2
        print_usage
        exit 1
      fi
      BRANCH="$1"
      ;;
  esac
  shift
done

if [[ -z "$BRANCH" ]]; then
  print_usage
  exit 1
fi

ARCHIVE_TAG="archive/$BRANCH"
ARCHIVE_DATE="$(date +%Y-%m-%d)"
TAG_MESSAGE="archive: $BRANCH — archived $ARCHIVE_DATE"

print_banner

printf "%b\n" "${DIM}Validating remote branch and archive tag...${RESET}"

if ! run_check "git ls-remote --exit-code --heads origin \"$BRANCH\"" git ls-remote --exit-code --heads origin "$BRANCH"; then
  printf "  ${RED}✗${RESET} Remote branch not found on origin: %s\n" "$BRANCH" >&2
  exit 1
fi
printf "  ${GREEN}✓${RESET} Found origin/%s\n" "$BRANCH"

if run_check "git ls-remote --tags --exit-code origin \"$ARCHIVE_TAG\"" git ls-remote --tags --exit-code origin "$ARCHIVE_TAG"; then
  printf "  ${RED}✗${RESET} Archive tag already exists on origin: %s\n" "$ARCHIVE_TAG" >&2
  exit 1
fi
printf "  ${GREEN}✓${RESET} Archive tag available: %s\n" "$ARCHIVE_TAG"

print_command "git ls-remote --heads origin \"$BRANCH\" | awk '{print \$1}'"
SHA="$(git ls-remote --heads origin "$BRANCH" | awk '{print $1}')"

if [[ -z "$SHA" ]]; then
  printf "  ${RED}✗${RESET} Could not resolve origin/%s SHA\n" "$BRANCH" >&2
  exit 1
fi
printf "  ${GREEN}✓${RESET} Branch tip SHA: %s\n" "$SHA"

confirm_or_abort
printf "%b\n" "\n${DIM}Archiving remote branch tip...${RESET}"

run_write "git tag -a \"$ARCHIVE_TAG\" \"$SHA\" -m \"$TAG_MESSAGE\"" git tag -a "$ARCHIVE_TAG" "$SHA" -m "$TAG_MESSAGE"
run_write "git push origin \"$ARCHIVE_TAG\"" git push origin "$ARCHIVE_TAG"

if [[ "$DRY_RUN" == "true" ]]; then
  print_dry_run_command "git ls-remote --tags --exit-code origin \"$ARCHIVE_TAG\""
else
  if ! run_check "git ls-remote --tags --exit-code origin \"$ARCHIVE_TAG\"" git ls-remote --tags --exit-code origin "$ARCHIVE_TAG"; then
    printf "  ${RED}✗${RESET} Archive tag push could not be verified on origin: %s\n" "$ARCHIVE_TAG" >&2
    exit 1
  fi
  printf "  ${GREEN}✓${RESET} Verified archive tag on origin: %s\n" "$ARCHIVE_TAG"
fi

printf "%b\n" "\n${DIM}Deleting remote branch...${RESET}"
run_write "git push origin --delete \"$BRANCH\"" git push origin --delete "$BRANCH"

if [[ "$DRY_RUN" == "true" ]]; then
  print_dry_run_command "git ls-remote --heads origin \"$BRANCH\""
  printf "%b\n" "\n  ${YELLOW}○${RESET} Dry run complete — no write operations executed"
  exit 0
fi

print_command "git ls-remote --heads origin \"$BRANCH\""
REMOTE_BRANCH_AFTER_DELETE="$(git ls-remote --heads origin "$BRANCH")"

if [[ -n "$REMOTE_BRANCH_AFTER_DELETE" ]]; then
  printf "  ${RED}✗${RESET} Remote branch still present after delete attempt: %s\n" "$BRANCH" >&2
  exit 1
fi

printf "  ${GREEN}✓${RESET} Verified branch removed from origin: %s\n" "$BRANCH"
printf "%b\n" "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
printf "%b\n\n" "${TERRACOTTA} Archived and deleted.${RESET}"
printf "  ${DIM}Branch:${RESET}   origin/%s\n" "$BRANCH"
printf "  ${DIM}Archive:${RESET}  %s\n" "$ARCHIVE_TAG"
printf "  ${DIM}SHA:${RESET}      %s\n" "$SHA"
printf "%b\n" "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
