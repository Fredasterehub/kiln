#!/usr/bin/env bash
set -e

# ── Colors ──────────────────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
ORANGE='\033[38;5;208m'
GREEN='\033[38;5;114m'
BLUE='\033[38;5;111m'
RED='\033[38;5;203m'
RESET='\033[0m'

REPO="https://github.com/Fredasterehub/kiln.git"
BRANCH="v4"
TMP_DIR=$(mktemp -d)

# ── Helpers ─────────────────────────────────────────────────────────
print()  { printf "  %b\n" "$1"; }
header() { printf "\n  %b%b%b\n\n" "$ORANGE$BOLD" "$1" "$RESET"; }
step()   { printf "  %b▸%b %b\n" "$BLUE" "$RESET" "$1"; }
ok()     { printf "  %b✓%b %b\n" "$GREEN" "$RESET" "$1"; }
fail()   { printf "  %b✗%b %b\n" "$RED" "$RESET" "$1"; }
dim()    { printf "  %b%b%b\n" "$DIM" "$1" "$RESET"; }
line()   { printf "  %b────────────────────────────────────────────%b\n" "$DIM" "$RESET"; }

ask() {
  printf "  %b%b:%b " "$BOLD" "$1" "$RESET"
  if [ -t 0 ]; then
    read -r REPLY
  else
    read -r REPLY < /dev/tty
  fi
  echo "$REPLY"
}

# ── Banner ──────────────────────────────────────────────────────────
clear 2>/dev/null || true
printf "\n"
printf "  %b╔══════════════════════════════════════════╗%b\n" "$ORANGE" "$RESET"
printf "  %b║                                          ║%b\n" "$ORANGE" "$RESET"
printf "  %b║%b       🔥  %bK I L N%b  —  v4                %b║%b\n" "$ORANGE" "$RESET" "$BOLD" "$RESET" "$ORANGE" "$RESET"
printf "  %b║%b                                          %b║%b\n" "$ORANGE" "$RESET" "$ORANGE" "$RESET"
printf "  %b║%b   Multi-model orchestration pipeline     %b║%b\n" "$ORANGE" "$RESET" "$ORANGE" "$RESET"
printf "  %b║%b   for Claude Code                        %b║%b\n" "$ORANGE" "$RESET" "$ORANGE" "$RESET"
printf "  %b║                                          ║%b\n" "$ORANGE" "$RESET"
printf "  %b╚══════════════════════════════════════════╝%b\n" "$ORANGE" "$RESET"
printf "\n"

# ── Preflight checks ───────────────────────────────────────────────
header "Preflight checks"

if command -v git &>/dev/null; then
  ok "git found"
else
  fail "git not found — install git first"
  exit 1
fi

if command -v claude &>/dev/null; then
  CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
  ok "Claude Code found ($CLAUDE_VERSION)"
else
  fail "Claude Code not found"
  print "Install: ${BOLD}npm i -g @anthropic-ai/claude-code${RESET}"
  exit 1
fi

if command -v codex &>/dev/null; then
  ok "Codex CLI found"
else
  fail "Codex CLI not found"
  print "Install: ${BOLD}npm i -g @openai/codex${RESET}"
  print "Kiln uses GPT-5.4 for planning and GPT-5.3-codex for implementation."
  exit 1
fi

printf "\n"

# ── Install mode ────────────────────────────────────────────────────
header "How would you like to use Kiln?"

print "${BOLD}1)${RESET}  Install to this project  ${DIM}— auto-discovered by Claude Code${RESET}"
print "   ${DIM}$(pwd)/.claude/plugins/kiln/${RESET}"
printf "\n"
print "${BOLD}2)${RESET}  Download to a shared location  ${DIM}— use with --plugin-dir${RESET}"
print "   ${DIM}~/.kiln/${RESET}"
printf "\n"

CHOICE=$(ask "Choice [1/2]")

case "$CHOICE" in
  2)
    PLUGIN_DIR="$HOME/.kiln"
    SCOPE="shared"
    ;;
  *)
    PLUGIN_DIR="$(pwd)/.claude/plugins/kiln"
    SCOPE="project"
    ;;
esac

printf "\n"
line

# ── Existing install ───────────────────────────────────────────────
if [ -d "$PLUGIN_DIR" ]; then
  printf "\n"
  print "Existing installation found at ${DIM}$PLUGIN_DIR${RESET}"
  OVERWRITE=$(ask "Overwrite? [Y/n]")
  if [[ "$OVERWRITE" =~ ^[Nn] ]]; then
    print "Aborted."
    exit 0
  fi
  rm -rf "$PLUGIN_DIR"
fi

# ── Download ────────────────────────────────────────────────────────
printf "\n"
header "Installing"

step "Downloading Kiln v4..."
git clone --depth 1 --branch "$BRANCH" "$REPO" "$TMP_DIR/kiln" 2>/dev/null
ok "Downloaded"

# ── Copy plugin files ──────────────────────────────────────────────
step "Copying plugin files..."
mkdir -p "$PLUGIN_DIR"
cp -r "$TMP_DIR/kiln/.claude-plugin" "$PLUGIN_DIR/"
cp -r "$TMP_DIR/kiln/agents" "$PLUGIN_DIR/"
cp -r "$TMP_DIR/kiln/commands" "$PLUGIN_DIR/"
cp -r "$TMP_DIR/kiln/skills" "$PLUGIN_DIR/"
ok "Installed to $PLUGIN_DIR"

# ── Count what was installed ────────────────────────────────────────
AGENT_COUNT=$(ls "$PLUGIN_DIR/agents/"*.md 2>/dev/null | wc -l | tr -d ' ')
COMMAND_COUNT=$(ls "$PLUGIN_DIR/commands/"*.md 2>/dev/null | wc -l | tr -d ' ')

# ── Cleanup ─────────────────────────────────────────────────────────
rm -rf "$TMP_DIR"
ok "Cleaned up temporary files"

# ── Summary ─────────────────────────────────────────────────────────
printf "\n"
line
printf "\n"
header "Ready to fire"

print "${GREEN}${BOLD}Kiln v4 installed successfully.${RESET}"
printf "\n"
dim "$AGENT_COUNT agents  ·  $COMMAND_COUNT commands  ·  1 skill"
dim "Path: $PLUGIN_DIR"
printf "\n"
line
printf "\n"

if [ "$SCOPE" = "project" ]; then
  print "Kiln is installed in this project. Open Claude Code:"
  printf "\n"
  print "  ${BOLD}claude --dangerously-skip-permissions${RESET}"
  printf "\n"
  print "Then type:"
  printf "\n"
  print "  ${BOLD}/kiln-fire${RESET}"
else
  print "Kiln is installed at ${DIM}~/.kiln/${RESET}. Point Claude Code at it:"
  printf "\n"
  print "  ${BOLD}claude --dangerously-skip-permissions --plugin-dir ~/.kiln${RESET}"
  printf "\n"
  print "Then type:"
  printf "\n"
  print "  ${BOLD}/kiln-fire${RESET}"
fi

printf "\n"
dim "That's it. Da Vinci will take it from here."
printf "\n"
