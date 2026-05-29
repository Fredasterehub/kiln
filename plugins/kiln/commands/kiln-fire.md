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
  for d in "$HOME"/.claude/plugins/cache/*/kiln/[0-9]*/; do
    [ -f "$d/skills/kiln-fire/SKILL.md" ] && { PLUGIN_ROOT="${d%/}"; break; }
  done
fi
echo "$PLUGIN_ROOT/skills/kiln-fire/SKILL.md"
```

Read that `SKILL.md`, treat `$PLUGIN_ROOT` as the value of every `${CLAUDE_PLUGIN_ROOT}` reference in
it, and run the conductor state machine. Do **not** `find /` for plugin files. If the resolver prints
an empty root, tell the operator the Kiln plugin is not installed/enabled and stop.

If the operator passed any text after the command, treat it as their initial intent for the
project and carry it into onboarding: $ARGUMENTS
