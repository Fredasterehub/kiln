# Kiln 4

Kiln 4 compiles a way of working into one Claude Code plugin: a persistent-mind team in [Herdr](https://herdr.dev) panes, one tab per phase, that takes a brief from the operator through research, plan, build + review, verify and deploy. A thin layer over Herdr, Claude Code, Codex CLI and the Antigravity CLI; no Teams, no Workflows, no machinery of its own.

Principles, in the operator's words: *the owner answers, the file remembers* (owner-driven development); bosses and managers do as little as possible; fresh bounded workers in visible panes; every packet readable by the operator; a guard that refuses normal work is a defect.

- `docs/SPEC.md` — the agreed design for v0 (source of truth while v0 is built).
- `docs/fred-protocol.md` — the operator's own statement of how the team works.
- `docs/handoffs.md` — per-phase hand-off table: artifact, producing seat, accepting seat, completion evidence.
- `docs/seat.schema.json` — the `seat.json` the launcher writes for every seat; hooks and the team tool read their identity from it.
- `routing.toml` — model lanes per role; v0 ships `balanced` plus the `bosses` override.

Status: v0 under construction on branch `v4` (orphan). Previous Kiln (v3.2.2) lives on `main` until v4 is released.
