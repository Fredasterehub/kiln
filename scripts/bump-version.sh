#!/usr/bin/env bash
# bump-version.sh — Single source of truth for Kiln version
# Usage: ./scripts/bump-version.sh 0.97.0
set -euo pipefail

VERSION="${1:?Usage: ./scripts/bump-version.sh <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. plugin.json (canonical)
jq --arg v "$VERSION" '.version = $v' "$ROOT/plugins/kiln/.claude-plugin/plugin.json" > /tmp/kiln_plugin.json \
  && mv /tmp/kiln_plugin.json "$ROOT/plugins/kiln/.claude-plugin/plugin.json"

# 2. marketplace.json (top-level + nested plugin entry)
jq --arg v "$VERSION" '.version = $v | .plugins[0].version = $v' "$ROOT/.claude-plugin/marketplace.json" > /tmp/kiln_marketplace.json \
  && mv /tmp/kiln_marketplace.json "$ROOT/.claude-plugin/marketplace.json"

# 3. Assert the three version fields agree after the writes.
PLUGIN_VER="$(jq -r .version "$ROOT/plugins/kiln/.claude-plugin/plugin.json")"
MKT_VER="$(jq -r .version "$ROOT/.claude-plugin/marketplace.json")"
MKT_PLUGIN_VER="$(jq -r '.plugins[0].version' "$ROOT/.claude-plugin/marketplace.json")"
if [[ "$PLUGIN_VER" != "$VERSION" || "$MKT_VER" != "$VERSION" || "$MKT_PLUGIN_VER" != "$VERSION" ]]; then
  echo "Version drift after bump: plugin.json=$PLUGIN_VER marketplace.version=$MKT_VER marketplace.plugins[0].version=$MKT_PLUGIN_VER (expected $VERSION)" >&2
  exit 1
fi

echo "Bumped to $VERSION in:"
echo "  plugins/kiln/.claude-plugin/plugin.json"
echo "  .claude-plugin/marketplace.json"
