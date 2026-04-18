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

# 3. SKILL.md frontmatter
sed "s/^version: .*/version: $VERSION/" "$ROOT/plugins/kiln/skills/kiln-pipeline/SKILL.md" > /tmp/kiln_skill.md \
  && mv /tmp/kiln_skill.md "$ROOT/plugins/kiln/skills/kiln-pipeline/SKILL.md"

echo "Bumped to $VERSION in:"
echo "  plugins/kiln/.claude-plugin/plugin.json"
echo "  .claude-plugin/marketplace.json"
echo "  plugins/kiln/skills/kiln-pipeline/SKILL.md"
