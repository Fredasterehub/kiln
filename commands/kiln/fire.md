---
name: kiln:fire
description: Light the kiln -- start or resume the full automated pipeline
---

Read and follow the complete instructions in `.claude/skills/kiln-fire/kiln-fire.md`.

This is the primary entry point. It reads `.kiln/STATE.md`, creates a Claude Code Team, and orchestrates the full pipeline automatically -- spawning teammates, auto-advancing stages, and emitting transition messages.

Arguments: $ARGUMENTS
