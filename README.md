# Kiln 4

Kiln 4 compiles a way of working into one Claude Code plugin: a persistent-mind team in [Herdr](https://herdr.dev) panes, one tab per phase, that takes a brief from the operator through research, plan, build + review, verify and deploy. A thin layer over Herdr, Claude Code, Codex CLI and the Antigravity CLI; no Teams, no Workflows, no machinery of its own.

Principles, in the operator's words: *the owner answers, the file remembers* (owner-driven development); bosses and managers do as little as possible; fresh bounded workers in visible panes; every packet readable by the operator; a guard that refuses normal work is a defect.

- `docs/SPEC.md` — the agreed design for v0 (source of truth while v0 is built).
- `docs/fred-protocol.md` — the operator's own statement of how the team works.
- [plugin hand-off table](plugins/kiln/handoffs.md) — per-phase hand-off table: artifact, producing seat, accepting seat, completion evidence.
- Plugin config: [seat schema](plugins/kiln/config/seat.schema.json) defines seat identity; [routing](plugins/kiln/config/routing.toml) defines the balanced lane and bosses override.

Status: v0 under construction on branch `v4` (orphan). Previous Kiln (v3.2.2) lives on `main` until v4 is released.

Start a team from the operator's unsandboxed shell:

```sh
plugins/kiln/bin/kiln start --team /path/to/team --project /path/to/repo --workspace "My team" --lane claude-lean --bosses claude --names boss=Oracle,orchestrator=Robin
```

Add `--dry-run` to inspect the plan without writes or Herdr calls. The three
bridge seats (boss, orchestrator, Gravedigah) share `team/bridge`; the orchestrator opens each phase tab and its manager when first needed and never closes them. [Family contracts and phase-launch shape](docs/families.md) describe
routing, role-card defaults, and trust behavior.
