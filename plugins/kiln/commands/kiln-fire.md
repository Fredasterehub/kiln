---
description: Launch or resume the Kiln software-creation pipeline.
argument-hint: "[optional: a one-line description of what to build]"
---

The operator has invoked Kiln. Act as the pipeline conductor.

**Bootstrap (do this first, before anything else):** the Skill-tool launch does not inject the
skill body and `${CLAUDE_PLUGIN_ROOT}` is not expanded here, so resolve the plugin root yourself and
read your own instructions. Run exactly this, then read the SKILL.md it points to and follow it:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$PLUGIN_ROOT/skills/kiln-fire/SKILL.md" ]; then
  # Several versions can be cached at once — pick the NEWEST valid candidate, never the first glob
  # match (the lexically OLDEST): collect dirs with the marker, version-sort on the version basename.
  PLUGIN_ROOT="$(for d in "$HOME"/.claude/plugins/cache/*/kiln/[0-9]*/; do
    [ -f "$d/skills/kiln-fire/SKILL.md" ] && printf '%s\n' "${d%/}"
  done | awk -F/ '{print $NF "\t" $0}' | sort -k1,1V | tail -1 | cut -f2)"
fi
echo "$PLUGIN_ROOT/skills/kiln-fire/SKILL.md"
```

Read that `SKILL.md`, treat `$PLUGIN_ROOT` as the value of every `${CLAUDE_PLUGIN_ROOT}` reference in
it, and run the conductor state machine. Do **not** `find /` for plugin files. If the resolver prints
an empty root, tell the operator the Kiln plugin is not installed/enabled and stop.

If the operator passed any text after the command, treat it as their initial intent for the
project and carry it into onboarding: $ARGUMENTS
