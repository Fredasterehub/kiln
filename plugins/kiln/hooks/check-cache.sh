#!/bin/bash
set -euo pipefail

# --- Guard: need CLAUDE_PLUGIN_ROOT to compare versions ---
ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[[ -n "$ROOT" ]] || exit 0

# --- Guard: marketplace clone must exist and be a valid git repo ---
MKT="$HOME/.claude/plugins/marketplaces/kiln"
[[ -d "$MKT/.git" ]] || exit 0
git -C "$MKT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# --- Guard: marketplace clone must have an origin remote ---
git -C "$MKT" remote get-url origin >/dev/null 2>&1 || exit 0

# --- Portable lock (mkdir-based, POSIX atomic) ---
LOCK_DIR="${TMPDIR:-/tmp}/kiln-mkt-sync.$(id -u).lock"
cleanup() { rm -rf -- "$LOCK_DIR" 2>/dev/null; }

if mkdir -- "$LOCK_DIR" 2>/dev/null; then
  trap cleanup EXIT INT TERM
  echo "$$" > "$LOCK_DIR/pid"
elif [ -f "$LOCK_DIR/pid" ]; then
  OLD_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null) || OLD_PID=""
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    exit 0
  fi
  rm -rf -- "$LOCK_DIR" 2>/dev/null
  if mkdir -- "$LOCK_DIR" 2>/dev/null; then
    trap cleanup EXIT INT TERM
    echo "$$" > "$LOCK_DIR/pid"
  else
    exit 0
  fi
else
  rm -rf -- "$LOCK_DIR" 2>/dev/null
  if mkdir -- "$LOCK_DIR" 2>/dev/null; then
    trap cleanup EXIT INT TERM
    echo "$$" > "$LOCK_DIR/pid"
  else
    exit 0
  fi
fi

# --- Best-effort fetch (non-interactive, fail-open) ---
export GIT_TERMINAL_PROMPT=0
if git -C "$MKT" fetch --quiet origin 2>/dev/null; then
  # Refresh origin/HEAD to track remote default branch changes
  git -C "$MKT" remote set-head origin -a >/dev/null 2>&1 || true

  # Resolve remote default branch dynamically
  REMOTE_REF=""
  # 1. Try origin/HEAD (now refreshed by set-head)
  REMOTE_REF=$(git -C "$MKT" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null) || REMOTE_REF=""
  # 2. Fallback: try common default branch names
  if [[ -z "$REMOTE_REF" ]]; then
    for candidate in refs/remotes/origin/master refs/remotes/origin/main; do
      if git -C "$MKT" rev-parse --verify "$candidate" >/dev/null 2>&1; then
        REMOTE_REF="$candidate"
        break
      fi
    done
  fi
  # 3. Last resort: first available remote branch (exclude exact HEAD symref)
  if [[ -z "$REMOTE_REF" ]]; then
    REMOTE_REF=$(git -C "$MKT" for-each-ref --format='%(refname)' refs/remotes/origin/ 2>/dev/null | grep -vx 'refs/remotes/origin/HEAD' | head -1) || REMOTE_REF=""
  fi
  # 4. Give up if no ref found
  [[ -n "$REMOTE_REF" ]] || exit 0

  LOCAL=$(git -C "$MKT" rev-parse HEAD 2>/dev/null) || LOCAL=""
  REMOTE=$(git -C "$MKT" rev-parse "$REMOTE_REF" 2>/dev/null) || REMOTE=""

  if [[ -n "$REMOTE" && -n "$LOCAL" && "$LOCAL" != "$REMOTE" ]]; then
    git -C "$MKT" reset --hard "$REMOTE_REF" --quiet 2>/dev/null || true
    git -C "$MKT" clean -fd --quiet 2>/dev/null || true
  fi
fi

# --- Compare marketplace version vs installed version ---
MKT_VER=""
MKT_RAW=$(grep -o '"version": "[^"]*"' "$MKT/.claude-plugin/marketplace.json" 2>/dev/null | head -1 | grep -o '"[^"]*"$' | tr -d '"') || MKT_RAW=""
[[ "$MKT_RAW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && MKT_VER="$MKT_RAW"

INST_VER=$(basename "$ROOT")
[[ "$INST_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 0

if [[ -n "$MKT_VER" && "$MKT_VER" != "$INST_VER" ]]; then
  echo "Kiln v${MKT_VER} available (installed: v${INST_VER}). Run: claude plugin update kiln@kiln"
fi

exit 0
