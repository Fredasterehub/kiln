#!/usr/bin/env bash
set -euo pipefail

# Kiln installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Fredasterehub/kiln/main/install.sh | bash

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

# 1. Claude Code
if command -v claude &>/dev/null; then
  printf "  ${GREEN}✓${RESET} Claude Code\n"
else
  printf "  ${RED}✗${RESET} Claude Code — npm i -g @anthropic-ai/claude-code\n"
  printf "\n${RED}Claude Code is required. Install it and try again.${RESET}\n"
  exit 1
fi

# 2. jq (Critical for hooks)
if command -v jq &>/dev/null; then
  printf "  ${GREEN}✓${RESET} jq\n"
else
  printf "  ${RED}✗${RESET} jq — required for pipeline hooks\n"
  printf "    ${DIM}Install via: sudo apt install jq / brew install jq${RESET}\n"
  exit 1
fi

# 3. Git config (Crucial for builders)
if git config user.name >/dev/null 2>&1 && git config user.email >/dev/null 2>&1; then
  printf "  ${GREEN}✓${RESET} Git identity configured\n"
else
  printf "  ${YELLOW}○${RESET} Git identity missing — will cause build failures\n"
  printf "    ${DIM}Run: git config --global user.name \"Your Name\" && git config --global user.email \"you@example.com\"${RESET}\n"
fi

# 4. uv/uvx (Required for Fetch MCP)
if command -v uvx &>/dev/null; then
  printf "  ${GREEN}✓${RESET} uvx (Fetch MCP server enabled)\n"
else
  printf "  ${YELLOW}○${RESET} uvx not found — Fetch MCP unavailable, field agents will use WebSearch only\n"
  printf "    ${DIM}Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh${RESET}\n"
fi

# 5. Codex CLI (Optional)
if command -v codex &>/dev/null; then
  printf "  ${GREEN}✓${RESET} Codex CLI (GPT-5.4 delegation enabled)\n"
else
  printf "  ${YELLOW}○${RESET} Codex CLI not found — Claude-only fallback enabled\n"
  printf "    ${DIM}For dual-model mode: npm i -g @openai/codex${RESET}\n"
fi

MKT="${HOME}/.claude/plugins/marketplaces/kiln"
if [[ -d "$MKT" ]]; then
  if git -C "$MKT" rev-parse --git-dir >/dev/null 2>&1; then
    BRANCH="$(git -C "$MKT" rev-parse --abbrev-ref HEAD 2>/dev/null)" || BRANCH=""
    if [[ "$BRANCH" == "v9" ]]; then
      printf "\n${YELLOW}○${RESET} Existing install detected on deprecated 'v9' branch. Repairing...\n"
      printf "  ${DIM}git remote set-branches origin main...${RESET}\n"
      git -C "${MKT}" remote set-branches origin main
      printf "  ${DIM}git fetch origin...${RESET}\n"
      git -C "${MKT}" fetch origin
      printf "  ${DIM}git checkout main...${RESET}\n"
      git -C "${MKT}" checkout main
      printf "  ${DIM}git branch -D v9...${RESET}\n"
      git -C "${MKT}" branch -D v9
      BRANCH_NOW="$(git -C "$MKT" rev-parse --abbrev-ref HEAD 2>/dev/null)" || BRANCH_NOW=""
      if [[ "$BRANCH_NOW" != "main" ]]; then
        printf "  ${RED}✗${RESET} Repair failed — expected branch 'main', got '%s'\n" "$BRANCH_NOW"
        exit 1
      fi
      printf "  ${GREEN}✓${RESET} Aligned to main — existing install repaired\n"
      printf "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
      printf "${TERRACOTTA} Repaired.${RESET}\n\n"
      printf "  ${DIM}Diagnose:${RESET}  claude then ${TERRACOTTA}/kiln-doctor${RESET}\n"
      printf "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
      exit 0
    fi
  fi
fi

# Register marketplace + install plugin via native Claude Code system
printf "\n${DIM}Registering marketplace...${RESET}\n"
if ! claude plugin marketplace add "$REPO" --yes 2>&1; then
  printf "\n${RED}Failed to register marketplace. Check network and try again.${RESET}\n"
  exit 1
fi
printf "  ${GREEN}✓${RESET} Marketplace registered\n"

printf "\n${DIM}Installing plugin...${RESET}\n"
if ! claude plugin install kiln --yes 2>&1; then
  printf "\n${RED}Failed to install plugin. Run 'claude plugin install kiln' manually.${RESET}\n"
  exit 1
fi
printf "  ${GREEN}✓${RESET} Plugin installed\n"

printf "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "${TERRACOTTA} Installed.${RESET}\n\n"
printf "  ${DIM}Launch:${RESET}    claude then ${TERRACOTTA}/kiln-fire${RESET}\n"
printf "  ${DIM}Diagnose:${RESET}  claude then ${TERRACOTTA}/kiln-doctor${RESET}\n"
printf "  ${DIM}Remove:${RESET}    ${DIM}claude plugin uninstall kiln${RESET}\n"
printf "\n${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
