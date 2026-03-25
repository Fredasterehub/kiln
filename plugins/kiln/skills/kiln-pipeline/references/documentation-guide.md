# Documentation Guide

On-demand reference for thoth. Read this on the first documentation task in a build. Covers project-facing docs — internal pipeline artifacts (iter-log, archive) are separate.

## README Format

A good README answers three questions in order: what is this, how do I run it, how is it structured.

**Include:**
- Project name and one-sentence description
- Prerequisites (runtime, tools, env vars)
- Setup and run commands (copy-paste ready)
- Project structure (top-level directories, what lives where)
- Test command

**Skip:**
- Badges (unless the project already has CI)
- Contributing guidelines (premature for a build output)
- License (operator adds this post-build)
- Architecture deep-dives (that's architecture.md)

## CHANGELOG Format

One entry per milestone. Not per iteration — iterations are internal bookkeeping.

```
## [Milestone N] — {milestone name}
- {What was built — user-visible features or capabilities}
- {Key technical decisions that affect future work}
- {Test coverage summary: N tests, all passing}
```

No iteration numbers, no agent names, no internal pipeline details. The audience is a developer reading the project six months later.

## Milestone Summary Format

Written to `.kiln/docs/milestones/milestone-N.md` at each milestone boundary.

**Include:**
- Milestone name and scope (from master-plan.md)
- What was built (deliverables, not process)
- Key decisions made during implementation
- Test results (count, pass/fail, coverage if available)
- Known limitations or deferred items

**Skip:**
- Iteration-by-iteration play-by-play
- Agent names or pipeline internals
- Rejected approaches (unless the rejection is architecturally significant)

## Conditional Files

Create these only when the project surface demands them:

| File | When |
|------|------|
| `api.md` | Project exposes an API (REST, GraphQL, CLI commands) |
| `deployment.md` | Project has deployment steps beyond "npm start" or equivalent |

Don't create empty placeholder files. If the project doesn't have an API, there's no api.md.

## Style

- Write for a developer who has never seen this project.
- Prefer concrete examples over abstract descriptions.
- Keep sentences short. One idea per paragraph.
- Use code blocks for commands, file paths, and config snippets.
- No marketing language. No superlatives. Just facts.
