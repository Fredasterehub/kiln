---
name: kiln-v3-init
description: Run Stage 0 initialization for Kiln v3. Detect project mode, set autonomy level, and initialize .kiln runtime files.
---

# Kiln v3 Init Skill

Run Stage 0 only.

- Read `.kiln/config.json` and `.kiln/STATE.md` if present.
- Detect `greenfield|brownfield` mode.
- Initialize state files and handoff to mapping or brainstorm.
