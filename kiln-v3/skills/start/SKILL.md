---
name: start
description: Entry point for Kiln v3 runs. Initializes new runs and routes to resume when active state already exists.
---

# Kiln v3 Start

Use this as `/kiln-v3:start`.

## Rules

- If `.kiln/STATE.md` exists and run is active (`status != complete`), route to `/kiln-v3:resume`.
- For fresh runs, initialize state and delegate stage work to coordinators.
- Top-level session must not execute stage internals.
