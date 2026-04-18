#!/usr/bin/env bash
set -euo pipefail

MKT="$HOME/.claude/plugins/marketplaces/kiln"
YELLOW='\033[33m'
RESET='\033[0m'

[[ -d "$MKT" ]] || exit 0
git -C "$MKT" rev-parse --git-dir >/dev/null 2>&1 || exit 0

BRANCH="$(git -C "$MKT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [[ "$BRANCH" == "v9" ]]; then
  printf '%b' "${YELLOW}⚠ Kiln: plugin installed on deprecated branch 'v9'. Run /kiln-doctor to realign to 'main'.${RESET}\n" >&2
fi

exit 0
