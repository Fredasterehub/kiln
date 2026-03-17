#!/usr/bin/env bash
set -euo pipefail

# Kiln installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Fredasterehub/kiln/master/install.sh | bash

REPO="Fredasterehub/kiln"
TERRACOTTA='\033[38;5;173m'
GOLD='\033[38;5;179m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

printf "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "${TERRACOTTA} KILN${RESET} ${DIM}installer${RESET}\n"
printf "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n\n"

# Check prerequisites
printf "${DIM}Checking prerequisites...${RESET}\n"

if command -v claude &>/dev/null; then
  printf "  ${GREEN}✓${RESET} Claude Code\n"
else
  printf "  ${RED}✗${RESET} Claude Code — npm i -g @anthropic-ai/claude-code\n"
  printf "\n${RED}Claude Code is required. Install it and try again.${RESET}\n"
  exit 1
fi

if command -v codex &>/dev/null; then
  printf "  ${GREEN}✓${RESET} Codex CLI (GPT-5.4 delegation enabled)\n"
else
  printf "  ${YELLOW}○${RESET} Codex CLI not found — GPT-5.4 delegation disabled\n"
  printf "    ${DIM}Kiln runs end-to-end on Claude alone. For dual-model mode: npm i -g @openai/codex${RESET}\n"
fi

# Register marketplace + install plugin via native Claude Code system
printf "\n${DIM}Registering marketplace...${RESET}\n"
if ! claude plugin marketplace add "$REPO" 2>&1; then
  printf "\n${RED}Failed to register marketplace. Check network and try again.${RESET}\n"
  exit 1
fi
printf "  ${GREEN}✓${RESET} Marketplace registered\n"

printf "\n${DIM}Installing plugin...${RESET}\n"
if ! claude plugin install kiln 2>&1; then
  printf "\n${RED}Failed to install plugin. Run 'claude plugin install kiln' manually.${RESET}\n"
  exit 1
fi
printf "  ${GREEN}✓${RESET} Plugin installed\n"

printf "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "${TERRACOTTA} Installed.${RESET}\n\n"
printf "  ${DIM}Launch:${RESET}    claude then ${TERRACOTTA}/kiln-fire${RESET}\n"
printf "  ${DIM}Diagnose:${RESET}  claude then ${TERRACOTTA}/kiln-doctor${RESET}\n"
printf "  ${DIM}Update:${RESET}    ${DIM}claude plugin update kiln${RESET}\n"
printf "  ${DIM}Remove:${RESET}    ${DIM}claude plugin uninstall kiln${RESET}\n"
printf "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
