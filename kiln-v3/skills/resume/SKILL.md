---
name: resume
description: Resume an active Kiln v3 run with strict coordinator delegation, stage reconciliation, and Stage 5 backfill gating.
---

# Kiln v3 Resume

Use this as `/kiln-v3:resume`.

## Procedure

1. Read `.kiln/config.json` + `.kiln/STATE.md` + current phase/test artifacts.
2. Reconcile before routing:
- if implementation completed but Stage 5 result missing, route to testing first
- if correction loop is open, route to Stage 4 correction path
- never clear unresolved gates silently
3. Spawn `kiln3-orchestrator` via Task tool with `resume-mode` instructions.
4. Orchestrator must route to the correct stage coordinator based on canonical state.

## Hard Rules

- Read `.kiln/STATE.md` and reconcile before routing.
- If implementation exists without Stage 5 verification, run Stage 5 first.
- Delegate to stage coordinators; never execute stage internals at top level.
- Top-level session must not handcraft phase plans, reviews, or fixes.
- If a coordinator spawn fails, retry spawn or escalate; never continue inline.
