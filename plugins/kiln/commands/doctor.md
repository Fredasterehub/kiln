---
description: Kiln's room check — what this environment has and where this project stands, read-only, closing on one verdict.
---

Take Kiln's pulse and report it. Two parts, nothing else in this turn: run the block below once, then render the report from what it printed.

**This check writes nothing, anywhere** — no `.kiln/` tree, no state, no ledger, no temp file, no edit to any file. It never calls a model, never opens an interactive login, and never starts a build: `codex login status` reads credential state from disk and exits, and `detect.js` and the wake's `--pulse` view only read. The preflight that records evidence is a different run, later, inside the build session. Nothing observed here is described as recorded.

```bash
V="$(claude --version 2>/dev/null)"; E=$?; V="$(printf '%s\n' "$V" | head -1)"
if [ "$E" -eq 0 ] && [ -n "$V" ]; then echo "CLAUDE=$V"
elif command -v claude >/dev/null 2>&1; then echo "CLAUDE=mute"
else echo "CLAUDE=absent"; fi
V="$(node --version 2>/dev/null)"; E=$?
if [ "$E" -eq 0 ] && [ -n "$V" ]; then echo "NODE=$V"; else echo "NODE=absent"; fi
if command -v codex >/dev/null 2>&1; then
  if codex login status </dev/null >/dev/null 2>&1; then echo "CODEX=signed-in"; else echo "CODEX=signed-out"; fi
else echo "CODEX=absent"; fi
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "GIT=repo"; else echo "GIT=no-repo"; fi
node "${CLAUDE_PLUGIN_ROOT}/machine/src/detect.js" detect "${CLAUDE_PROJECT_DIR}" || echo "DETECT=did-not-run"
if [ -d "${CLAUDE_PROJECT_DIR}/.kiln" ]; then
  node "${CLAUDE_PLUGIN_ROOT}/machine/src/wake.js" view "${CLAUDE_PROJECT_DIR}" --pulse || echo "PULSE=did-not-run"
fi
```

**Render the report.** Read `${CLAUDE_PLUGIN_ROOT}/product/voice/kiln.md` first and speak every line under it — first person, the fact before the flourish, no emoji, no preamble, no closing offer. One line per item, in this order:

1. **The `claude` CLI** — the version it answered with, or that it did not answer on my path. My floor is v2.1.198 — the oldest build that carries everything I use; if the version it gave is below that floor, say so and name the floor.
2. **Node** — the version, or absent. Absent is a fault: my scripts have no hands without it.
3. **Codex** — installed and signed in, installed but signed out, or not installed at all. Never a fault: without it I build single-family, Claude minds checking each other, with the cost named in the same breath — two families are wrong in different ways, one family is not.
4. **The `Workflow` tool** — read from this session's own resolved tool-schema block, never from a shell probe. Present; absent, in which case phase and chunk sequencing runs through plain Node scripts instead; or unknown, when this host exposes no such block to the session at all. Unknown is reported as unknown, never rounded down to absent.
5. **Agent teams** — its own separate read of that same block, never inferred from what item 4 found. If they are off, name the switch: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, set in the environment or in Claude Code settings, and the session restarted before it takes.
6. **Git** — a repository here, or none yet. Advisory: the anvil commits chunk by chunk and will want one eventually, never at this door.
7. **Where this project stands** — the `mode` `detect.js` printed, in plain words, adding nothing its output does not say. If it did not run, say plainly what stopped it and that this project went unexamined.
8. **The pulse** — only when a `.kiln/` tree stands here and the `--pulse` view printed: its lines rendered one item each, in its own order — the phase and where the build stands in it; the last stop, any waiting operator question repeated verbatim, word for word; how many entries the build's memory holds. Adding nothing the pulse did not print. If the tree exists and the pulse did not run, say so and say the project's standing past its classification went unexamined. A project without a `.kiln/` tree ends the report at item 7 — its classification already says there is no pulse to take.

Mark a check that holds `✓` and a check that fails `✗`. A fact that is neither — Codex absent, a capability switched off, no repository yet — carries no glyph and gets a plain sentence naming what changes. The pulse's lines are facts, never checks: no glyph on any of them, nothing observed there was recorded, and this door never adopts the build's persona and never builds — it looks, and says what it saw. Emoji never.

Two rules hold the report honest:
- Without Node my own scripts cannot run, so item 7 was never examined — say exactly that, and never report a classification I did not make.
- A fault is spoken once, plainly. Its consequences elsewhere are not a second fault.

Close with exactly one verdict line, and nothing after it:
- If any `✗` was spoken, my forge cannot light like this — name in that same line what has to be mended.
- Otherwise, if Codex is not reachable, the room holds single-family: I complete at my own tier, not a lesser one.
- Otherwise, the room holds. Bring me an idea.
