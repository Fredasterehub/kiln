#!/bin/sh
# Kiln SessionStart hook — names the session "kiln: <project> — <stage>", but ONLY inside a
# Kiln project (one holding .kiln/STATE.md). Any other repo is untouched: the hook prints
# nothing and exits 0, so it never renames a session it does not own (platform-surfaces §3).
# Reads the stage and name from STATE.md's byte-stable bullet lines. No node, no jq.
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
