#!/bin/sh
# Kiln SessionStart hook — names the session "kiln: <project> — <stage>", but ONLY inside a
# Kiln project (one holding .kiln/STATE.md) AND only when it would not overwrite a title the
# operator set by hand. Any other repo is untouched: the hook prints nothing and exits 0, so it
# never renames a session it does not own. Reads the stage and name from
# STATE.md's byte-stable bullet lines. No node, no jq.

# The current binary hands SessionStart the existing title in the `session_title` input field
# (the hooks reference documents exactly this guard). If the operator set one — non-empty and not
# our own "kiln:" prefix — we bow out silently rather than clobber it. Our own "kiln:" title is
# ours to refresh; an absent title means we may name the session.
input=$(cat 2>/dev/null)
title=$(printf '%s' "$input" | sed -n 's/.*"session_title"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
case "$title" in
  '') : ;;        # no operator title — ours may name the session
  kiln:*) : ;;    # our own title — refreshing it to the live stage is fine
  *) exit 0 ;;    # an operator-set title — never clobber
esac

root="${CLAUDE_PROJECT_DIR:-$PWD}"
state="$root/.kiln/STATE.md"
[ -f "$state" ] || exit 0

# Strip any " and \ AND all control characters (tab included) so no STATE.md value can break
# the emitted JSON — a raw control char inside a JSON string literal is a parse error.
stage=$(sed -n 's/^- \*\*stage\*\*:[[:space:]]*\(.*\)$/\1/p' "$state" | head -n1 | tr -d '"\\' | tr -d '\000-\037\177')
project=$(sed -n 's/^- \*\*project_name\*\*:[[:space:]]*\(.*\)$/\1/p' "$state" | head -n1 | tr -d '"\\' | tr -d '\000-\037\177')
[ -n "$stage" ] || exit 0
[ -n "$project" ] || project="a project"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","sessionTitle":"kiln: %s — %s"}}\n' "$project" "$stage"
exit 0
