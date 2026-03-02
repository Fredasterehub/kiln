---
name: kiln-v3-implementation
description: Run Stage 4 implementation with JIT phase planning, worker-review loops, and post-merge checkpointing.
---

# Kiln v3 Implementation Skill

Run implementation phase.

- JIT `phase-plan-NN.md` from current codebase and latest constraints.
- Use dependency-aware tasks and direct worker-review loop.
- Checkpoint after phase merge.
- Never run nested `claude` CLI inside Claude Code.
- Use native teammate/subagent spawning only.
- In greenfield, do not spawn Sherlock for Stage 4 indexing.
