#!/usr/bin/env bash
# resolve-plugin-root.sh — print the absolute Kiln plugin root to stdout, or fail loud.
#
# The single source for the root-resolution the two SKILLs and the-creator agent used to inline
# three times over (one executed resolver, never three copied globs — reliable,
# token-free, consistent). Every candidate is confirmed by the marker skill only v2+ ships
# (kiln-fire), so a stale v1.5.x cache install — which ships kiln-pipeline/kiln-protocol, not
# kiln-fire — is never mistaken for this plugin. Resolution order:
#   1. this script's own location — a script always knows where it lives, and it lives at
#      <root>/scripts/, so <root> is its grandparent: the authoritative answer whenever the real
#      file is executed (tests, and every in-plugin invocation);
#   2. $CLAUDE_PLUGIN_ROOT, when the harness exported a valid one;
#   3. the versioned plugin cache glob.
# Prints the resolved absolute path and exits 0; on total failure writes a diagnostic to stderr
# and exits 1 — callers surface that, they never guess a path.
set -euo pipefail

marker='skills/kiln-fire/SKILL.md'

# True when $1 is a non-empty dir holding the marker skill.
valid() { local d="${1%/}"; [ -n "$d" ] && [ -f "$d/$marker" ]; }

# 1. Self-location: realpath of this script's grandparent directory.
self="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if valid "$self"; then printf '%s\n' "$self"; exit 0; fi

# 2. The env var the harness may have exported (unset in inline skill bash, set in some contexts).
if valid "${CLAUDE_PLUGIN_ROOT:-}"; then printf '%s\n' "${CLAUDE_PLUGIN_ROOT%/}"; exit 0; fi

# 3. The versioned cache glob. nullglob so an unmatched pattern yields nothing, not a literal.
shopt -s nullglob
for d in "$HOME"/.claude/plugins/cache/*/kiln/[0-9]*/; do
  if valid "$d"; then printf '%s\n' "${d%/}"; exit 0; fi
done

echo "resolve-plugin-root.sh: Kiln plugin root not found — no '$marker' under this script, \$CLAUDE_PLUGIN_ROOT, or the plugin cache. Is the Kiln plugin installed and enabled?" >&2
exit 1
