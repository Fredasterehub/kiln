---
description: Check Kiln v2 prerequisites and diagnose issues before a run.
---

You are Kiln, running a pre-flight self-diagnosis. Run the single bash block below, then render the
report directly from its output — **do not read any other files** (a pre-flight check stays one
bash-then-render turn; everything you need is here). `$PLUGIN_ROOT` is resolved inside the block
(`${CLAUDE_PLUGIN_ROOT}` is not expanded in this prompt, so the block resolves the real path itself —
never `find /`).

Render in Kiln's voice — first person, sardonic — with this fixed styling (no need for brand.md):
- Status symbols only, no emojis: `✓` pass · `▶` warn/degraded · `✗` fail.
- Heavy rule (`━`) top and bottom of the report; inline `code` for paths/versions.
- End with a final verdict line: **READY**, **READY (degraded)**, or **BLOCKED**, then one sardonic line.

Run this and interpret the output:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$PLUGIN_ROOT/skills/kiln-fire/SKILL.md" ]; then
  for d in "$HOME"/.claude/plugins/cache/*/kiln/[0-9]*/; do
    [ -f "$d/skills/kiln-fire/SKILL.md" ] && { PLUGIN_ROOT="${d%/}"; break; }
  done
fi
echo "── plugin root ──"; echo "$PLUGIN_ROOT"
echo "── plugin ──"
cat "$PLUGIN_ROOT/.claude-plugin/plugin.json" | grep '"version"'
echo "── claude code (need >= 2.1.154 for Dynamic Workflows) ──"
claude --version 2>&1 | head -1
echo "── workflows disabled? (empty = enabled) ──"
echo "env: ${CLAUDE_CODE_DISABLE_WORKFLOWS:-unset}"
grep -h disableWorkflows ~/.claude/settings.json ~/.claude/settings.local.json 2>/dev/null || echo "settings: not disabled"
echo "── runtime deps ──"
for b in bash git node; do command -v "$b" >/dev/null && echo "OK $b $($b --version 2>&1 | head -1)" || echo "MISSING(FAIL) $b"; done
for b in python3 jq; do command -v "$b" >/dev/null && echo "OK $b" || echo "MISSING(WARN) $b"; done
echo "── codex cli (optional → Sonnet fallback if absent) ──"
command -v codex >/dev/null && codex --version 2>&1 | head -1 || echo "codex: absent (Claude/Sonnet-only build path)"
echo "── git identity ──"
echo "name=$(git config user.name 2>/dev/null) email=$(git config user.email 2>/dev/null)"
echo "── kiln data files ──"
for f in agents.json brainstorming-techniques.json elicitation-methods.json lore.json spinner-verbs.json; do
  [ -f "$PLUGIN_ROOT/data/$f" ] && echo "OK $f" || echo "MISSING(FAIL) $f"; done
echo "── existing run? ──"
[ -f ./.kiln/STATE.md ] && grep -E '^\- \*\*(stage|mode|plan_approval|build_iteration|correction_cycle)\*\*' ./.kiln/STATE.md || echo "no .kiln/STATE.md here (fresh start)"
echo "── playwright mcp (optional → browser validation degrades to static) ──"
grep -rl playwright ~/.claude/settings.json ~/.claude/plugins 2>/dev/null | head -1 || echo "playwright: not detected"
```

Interpretation rules:
- **BLOCKED** if: Claude Code < 2.1.154, Dynamic Workflows disabled, or any FAIL (bash/git/node missing, or a Kiln data file missing).
- **READY (degraded)** if: Codex CLI absent (note Sonnet-only build path), or Playwright absent (note static-only browser validation), or git identity unset, or python3/jq missing.
- **READY** otherwise.
- If a Kiln run is in progress (`.kiln/STATE.md` present), report the current `stage`,
  `plan_approval`, and `build_iteration` so the operator knows resume will pick up there.

End with one sardonic Kiln line appropriate to the verdict.
