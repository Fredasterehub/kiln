---
name: start
description: Entry point for Kiln v3 runs. Initializes new runs and routes to resume when active state already exists.
---

# Kiln v3 Start

Use this as `/kiln-v3:start`.

## Procedure

1. Read `.kiln/config.json` and `.kiln/STATE.md` (if present).
2. If `.kiln/STATE.md` exists and run is active (`status != complete`):
- stop fresh-start flow
- switch to `/kiln-v3:resume`
3. For a fresh run:
- initialize `.kiln` state artifacts
- spawn `kiln3-orchestrator` via Task tool
- pass project path + `.kiln` paths + autonomy config
4. Wait for orchestrator signals; top-level session stays dispatcher-only.

## Hard Rules

- If `.kiln/STATE.md` exists and run is active (`status != complete`), route to `/kiln-v3:resume`.
- For fresh runs, initialize state and delegate stage work to coordinators.
- Top-level session must not execute stage internals.
- Top-level session must use Task tool for orchestration delegation.
- If delegation fails, retry delegation or escalate; never absorb stage execution into top-level context.
