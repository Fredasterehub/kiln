---
name: resume
description: Resume an active Kiln v3 run with strict coordinator delegation, stage reconciliation, and Stage 5 backfill gating.
---

# Kiln v3 Resume

Use this as `/kiln-v3:resume`.

## Rules

- Read `.kiln/STATE.md` and reconcile before routing.
- If implementation exists without Stage 5 verification, run Stage 5 first.
- Delegate to stage coordinators; never execute stage internals at top level.
