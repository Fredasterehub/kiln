# Claude Teams Workflow (v2 Kit)

This folder is a from-scratch, portable workflow kit optimized for **Claude Code Agent Teams** with optional **Codex CLI/MCP** augmentation.

Design goal: a workflow professionals trust because it is **auditable**, **repeatable**, and **quality-gated**.

## What This Kit Optimizes For

- **Claude Code native UX**: Claude Code Tasks are the scheduler; teammates have strict roles.
- **High output quality**: deterministic verification first; LLM judgment second.
- **Adaptive direction**: a Conductor role performs drift + boundary decisions (continue/adapt/replan/escalate).
- **Structured ideation**: BMAD-style brainstorming artifacts drive planning.
- **Atomic execution**: GSD-style task packets keep diffs small and reversible.

## Install (Copy-Only)

1. Copy `v2/agents/` into your repo at `.claude/agents/`
2. Paste `v2/CLAUDE_SNIPPET.md` into your repo `CLAUDE.md`
3. Copy `v2/templates/` into your repo at `templates/teams/`
4. Create `tracks/` at repo root for durable track artifacts

Optional:
- Add `v2/GITIGNORE_SNIPPET.txt` entries to your `.gitignore`

## Operator Flow (Human as Lead)

1. Create a Claude Code Agent Team with roles from `v2/CLAUDE_SNIPPET.md`.
2. Choose a `track_id` (example: `2026-02-14-auth-refresh`).
3. Run Brainstormer (human-in-loop) to produce track seed docs under `tracks/<track_id>/`.
4. Run Dual Planning (Claude Planner + Codex Planner) and synthesize into `tracks/<track_id>/PLAN.md`.
5. Generate **task packets** (`tracks/<track_id>/TASKS/*.md`), then convert each packet into a Claude Code Task description.
6. Execute tasks sequentially: Coder implements, QA verifies, Conductor arbitrates drift/boundaries, Integrator resolves cross-task friction.

## Artifacts (Durable vs Runtime)

- Durable (commit to git): `tracks/<track_id>/**`
- Runtime (never commit): `.teams/` (verification logs, reconciliation triggers, snapshots)

## Notes

- This kit intentionally avoids hardcoding any absolute paths.
- Model IDs and Codex invocation method (CLI vs MCP) are configured by convention in your repo `CLAUDE.md`.

