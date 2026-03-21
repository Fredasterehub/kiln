#!/bin/bash
# release.sh — Bump version, commit, push v9, mirror to master
# Usage: ./release.sh 0.99.0
# Usage: ./release.sh 0.99.0 "short description"
set -euo pipefail

VERSION="${1:?Usage: ./release.sh <version> [description]}"
DESC="${2:-}"

# Validate version format (exactly X.Y.Z)
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: Invalid version format '$VERSION'. Expected: X.Y.Z (e.g., 0.99.0)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "v9" ]]; then
  echo "ERROR: Must release from v9 branch (currently on $CURRENT_BRANCH)" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is dirty. Commit or stash first." >&2
  exit 1
fi

echo "=== Releasing Kiln v${VERSION} ==="
echo ""

# 1. Bump all version files
./bump-version.sh "$VERSION"

# 2. Commit on v9
git add plugins/kiln/.claude-plugin/plugin.json \
       .claude-plugin/marketplace.json \
       plugins/kiln/skills/kiln-pipeline/SKILL.md

COMMIT_MSG="chore: bump version to ${VERSION}"
if [[ -n "$DESC" ]]; then
  COMMIT_MSG="release: v${VERSION} — ${DESC}"
fi
git commit -m "${COMMIT_MSG}"

# 3. Push v9
git push origin v9

# 4. Mirror v9 to master (fast-forward only)
if ! git push origin v9:master; then
  echo "" >&2
  echo "ERROR: Cannot fast-forward master to v9." >&2
  echo "master has diverged. Manual fix required:" >&2
  echo "  git push origin v9:master --force-with-lease" >&2
  exit 1
fi

echo ""
echo "=== Released Kiln v${VERSION} ==="
echo "  v9: pushed"
echo "  master: mirrored (fast-forward)"
echo ""
echo "Users will see the update on next session start."
