#!/bin/bash
set -euo pipefail

# Read the expected version from the plugin manifest
EXPECTED=$(cat "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null | grep -o '"version": "[^"]*"' | grep -o '[0-9.]*')

if [[ -z "$EXPECTED" ]]; then
  exit 0  # Can't determine version, skip silently
fi

# Find what's actually cached
CACHE_BASE="$HOME/.claude/plugins/cache/kiln/kiln"
if [[ ! -d "$CACHE_BASE" ]]; then
  exit 0  # No cache dir, fresh install, skip
fi

CACHED=$(ls "$CACHE_BASE" 2>/dev/null | head -1)

if [[ -z "$CACHED" ]]; then
  exit 0  # Empty cache dir, skip
fi

# Compare
if [[ "$CACHED" != "$EXPECTED" ]]; then
  # Stale cache detected — clear it
  rm -rf "$HOME/.claude/plugins/cache/kiln/"
  echo "Kiln cache refreshed: was v${CACHED}, now v${EXPECTED}. Run 'plugin update kiln' to complete the update."
fi

exit 0
