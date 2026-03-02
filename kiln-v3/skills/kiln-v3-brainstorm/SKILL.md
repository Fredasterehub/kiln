---
name: kiln-v3-brainstorm
description: Run Stage 1 brainstorm with direct operator interaction and approved immutable VISION.md output.
---

# Kiln v3 Brainstorm Skill

Run brainstorming.

- Use direct operator interaction with Brainstormer.
- Handoff protocol:
  - Spawn `kiln3-brainstormer` and explicitly hand the floor to Da Vinci.
  - Tell operator to address Da Vinci directly (`@kiln3-brainstormer` or agent switch UI).
  - Coordinator stays silent and does not relay messages.
  - If idle for `brainstorm.silence_timeout_minutes` (default 20), send one neutral nudge.
  - Never exceed `brainstorm.max_nudges` (default 3).
- Produce approved `VISION.md`.
- Birth Visionary from approved vision.
