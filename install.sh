#!/usr/bin/env bash
set -e

REPO="https://github.com/Fredasterehub/kiln.git"
BRANCH="v4"
PLUGIN_DIR="$HOME/.claude/plugins/kiln"
TMP_DIR=$(mktemp -d)

echo ""
echo "  🔥 Kiln — Installing..."
echo ""

# Clean previous install
if [ -d "$PLUGIN_DIR" ]; then
  echo "  Updating existing installation..."
  rm -rf "$PLUGIN_DIR"
fi

# Clone to temp
git clone --depth 1 --branch "$BRANCH" "$REPO" "$TMP_DIR/kiln" 2>/dev/null

# Create plugins directory if needed
mkdir -p "$HOME/.claude/plugins"

# Copy only plugin files (no .git, no README, no docs)
mkdir -p "$PLUGIN_DIR"
cp -r "$TMP_DIR/kiln/.claude-plugin" "$PLUGIN_DIR/"
cp -r "$TMP_DIR/kiln/agents" "$PLUGIN_DIR/"
cp -r "$TMP_DIR/kiln/commands" "$PLUGIN_DIR/"
cp -r "$TMP_DIR/kiln/skills" "$PLUGIN_DIR/"

# Cleanup
rm -rf "$TMP_DIR"

echo "  ✓ Installed to $PLUGIN_DIR"
echo ""
echo "  Next: open Claude Code and type /kiln-fire"
echo "  Run with: claude --dangerously-skip-permissions"
echo ""
