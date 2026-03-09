#!/usr/bin/env bash
set -euo pipefail

# Kiln installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Fredasterehub/kiln/v5/install.sh | bash

REPO="https://github.com/Fredasterehub/kiln.git"
BRANCH="v5"
INSTALL_DIR="$HOME/.claude/plugins/kiln"
TERRACOTTA='\033[38;5;173m'
GOLD='\033[38;5;179m'
DIM='\033[2m'
GREEN='\033[32m'
RED='\033[31m'
RESET='\033[0m'

printf "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "${TERRACOTTA} KILN${RESET} ${DIM}installer${RESET}\n"
printf "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n\n"

# Check prerequisites
check() {
  if command -v "$1" &>/dev/null; then
    printf "  ${GREEN}✓${RESET} %s\n" "$2"
    return 0
  else
    printf "  ${RED}✗${RESET} %s — %s\n" "$2" "$3"
    return 1
  fi
}

printf "${DIM}Checking prerequisites...${RESET}\n"
READY=true
check git "git" "install git first" || READY=false
check claude "Claude Code" "npm i -g @anthropic-ai/claude-code" || READY=false
check codex "Codex CLI" "npm i -g @openai/codex" || READY=false

if [ "$READY" = false ]; then
  printf "\n${RED}Missing prerequisites. Install them and try again.${RESET}\n"
  exit 1
fi

printf "\n${DIM}Installing to ${INSTALL_DIR}...${RESET}\n"

# Clean install — remove previous version if exists
if [ -d "$INSTALL_DIR" ]; then
  printf "  ${DIM}Removing previous installation...${RESET}\n"
  rm -rf "$INSTALL_DIR"
fi

# Clone — sparse checkout to skip docs/LICENSE/README
mkdir -p "$(dirname "$INSTALL_DIR")"
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$INSTALL_DIR" 2>/dev/null

# Clean up git artifacts and non-plugin files
rm -rf "$INSTALL_DIR/.git" \
       "$INSTALL_DIR/.gitignore" \
       "$INSTALL_DIR/LICENSE" \
       "$INSTALL_DIR/README.md" \
       "$INSTALL_DIR/docs" \
       "$INSTALL_DIR/install.sh"

# Verify installation
AGENT_COUNT=$(ls -1 "$INSTALL_DIR/agents/"*.md 2>/dev/null | wc -l)
SKILL_EXISTS=false
[ -f "$INSTALL_DIR/skills/kiln-pipeline/SKILL.md" ] && SKILL_EXISTS=true

printf "\n${DIM}Verifying...${RESET}\n"
printf "  ${GREEN}✓${RESET} ${AGENT_COUNT} agents\n"
printf "  ${GREEN}✓${RESET} Pipeline skill\n"

if [ -f "$INSTALL_DIR/hooks/hooks.json" ]; then
  printf "  ${GREEN}✓${RESET} Enforcement hooks\n"
fi

if [ -d "$INSTALL_DIR/commands" ]; then
  CMD_COUNT=$(ls -1 "$INSTALL_DIR/commands/"*.md 2>/dev/null | wc -l)
  printf "  ${GREEN}✓${RESET} ${CMD_COUNT} commands\n"
fi

printf "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "${TERRACOTTA} Installed.${RESET}\n\n"
printf "  ${DIM}Location:${RESET}  %s\n" "$INSTALL_DIR"
printf "  ${DIM}Launch:${RESET}    claude then ${TERRACOTTA}/kiln-fire${RESET}\n"
printf "  ${DIM}Diagnose:${RESET}  claude then ${TERRACOTTA}/kiln-doctor${RESET}\n"
printf "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
