---
name: reset
description: Safely pause and checkpoint Kiln v3 state for a clean session restart without deleting project artifacts.
---

# Kiln v3 Reset

Use this as `/kiln-v3:reset`.

- Flush current state to `.kiln/STATE.md`.
- Set status to paused with handoff context.
- Do not delete project artifacts.
