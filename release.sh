#!/bin/bash
# release.sh — Bump version, commit, merge to master, push
# Usage: ./release.sh 0.97.0
# Usage: ./release.sh 0.97.0 "short description of what changed"
set -euo pipefail

VERSION="${1:?Usage: ./release.sh <version> [description]}"
DESC="${2:-}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

CURRENT_BRANCH=$(git branch --show-current)

# Safety checks
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is dirty. Commit or stash first." >&2
  exit 1
fi

echo "=== Releasing Kiln v${VERSION} ==="
echo ""

# 1. Bump all version files
./bump-version.sh "$VERSION"

# 2. Commit on current branch
git add plugins/kiln/.claude-plugin/plugin.json \
       .claude-plugin/marketplace.json \
       plugins/kiln/skills/kiln-pipeline/SKILL.md

COMMIT_MSG="chore: bump version to ${VERSION}"
if [[ -n "$DESC" ]]; then
  COMMIT_MSG="release: v${VERSION} — ${DESC}"
fi

git commit -m "${COMMIT_MSG}"

# 3. Push current branch
git push origin "$CURRENT_BRANCH"

# 4. Merge to master and push
git checkout master
git pull origin master
git merge "$CURRENT_BRANCH" -m "merge: ${CURRENT_BRANCH} → master for v${VERSION} release"
git push origin master

# 5. Switch back
git checkout "$CURRENT_BRANCH"

echo ""
echo "=== Released Kiln v${VERSION} ==="
echo "  ${CURRENT_BRANCH}: pushed"
echo "  master: merged and pushed"
echo ""
echo "Users need to run:"
echo "  claude plugin marketplace remove kiln"
echo "  claude plugin marketplace add Fredasterehub/kiln"
echo "  claude plugin update kiln@kiln"
echo ""
echo "Until Claude Code fixes marketplace cache refresh,"
echo "users may need to nuke their cache:"
echo "  rm -rf ~/.claude/plugins/marketplaces/kiln ~/.claude/plugins/cache/kiln"
echo "  claude plugin marketplace add Fredasterehub/kiln"
echo "  claude plugin install kiln"
