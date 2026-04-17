#!/bin/bash
# check-cache.sh — SessionStart hook: notify when a newer Kiln is available.
#
# Fail-open on every branch: a cache check that stalls or errors must not
# block session startup. Trade-offs against the pre-Wave-4 92-line version:
#   - Lock uses `mkdir` once with a pid file; stale-lock recovery trusts
#     `kill -0` to detect dead owners instead of open-coding a second
#     mkdir attempt.
#   - Remote-ref resolution relies on `origin/HEAD` (kept fresh by
#     `remote set-head`). No per-branch fallback loop — if the remote
#     HEAD can't be resolved, skip silently; update notification is
#     best-effort.
set -euo pipefail

ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[[ -n "$ROOT" ]] || exit 0

MKT="$HOME/.claude/plugins/marketplaces/kiln"
[[ -d "$MKT/.git" ]] || exit 0
git -C "$MKT" remote get-url origin >/dev/null 2>&1 || exit 0

LOCK="${TMPDIR:-/tmp}/kiln-mkt-sync.$(id -u).lock"
if ! mkdir -- "$LOCK" 2>/dev/null; then
  owner=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then exit 0; fi
  rm -rf -- "$LOCK" 2>/dev/null
  mkdir -- "$LOCK" 2>/dev/null || exit 0
fi
trap 'rm -rf -- "$LOCK" 2>/dev/null' EXIT INT TERM
echo "$$" > "$LOCK/pid"

export GIT_TERMINAL_PROMPT=0
git -C "$MKT" fetch --quiet origin 2>/dev/null || exit 0
git -C "$MKT" remote set-head origin -a >/dev/null 2>&1 || true
REF=$(git -C "$MKT" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)
[[ -n "$REF" ]] || exit 0

LOCAL=$(git -C "$MKT" rev-parse HEAD 2>/dev/null || echo "")
REMOTE=$(git -C "$MKT" rev-parse "$REF" 2>/dev/null || echo "")
if [[ -n "$LOCAL" && -n "$REMOTE" && "$LOCAL" != "$REMOTE" ]]; then
  git -C "$MKT" reset --hard "$REF" --quiet 2>/dev/null || true
  git -C "$MKT" clean -fd --quiet 2>/dev/null || true
fi

MKT_VER=$(grep -oE '"version"\s*:\s*"[0-9]+\.[0-9]+\.[0-9]+"' "$MKT/.claude-plugin/marketplace.json" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)
INST_VER=$(basename "$ROOT")
[[ "$INST_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 0

if [[ -n "$MKT_VER" && "$MKT_VER" != "$INST_VER" ]]; then
  echo "Kiln v${MKT_VER} available (installed: v${INST_VER}). Run: claude plugin update kiln@kiln"
fi
