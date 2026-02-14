# T04 Brainstorming Pipeline — Plan

## Task Graph

```
T04-T01 (brainstormer agent)
   |
   +---> T04-T02 (brainstorm technique skill) [depends on T04-T01]
   |
   +---> T04-T03 (/kiln:brainstorm entry point) [depends on T04-T01]
```

T04-T01 (brainstormer agent) must come first because it defines the 3-phase flow, the Codex CLI invocation for challenge pass, and the synthesis logic that the skill and entry point reference. T04-T02 (technique library) and T04-T03 (slash command entry point) are independent and can execute in parallel.

## Wave Execution

| Wave | Tasks | Description |
|------|-------|-------------|
| 1 | T04-T01 | Write brainstormer agent (3-phase flow + challenge/synthesis) |
| 2 | T04-T02, T04-T03 | Write technique skill + slash command entry point (parallel) |

## Verification Plan

After all tasks complete:
1. `test -f agents/kiln-brainstormer.md` — agent exists
2. `test -f skills/kiln-brainstorm/kiln-brainstorm.md` — skill exists
3. Grep agent for: `Phase A`, `Phase B`, `Phase C` — all 3 phases defined
4. Grep agent for: `codex` — Codex CLI invocation present
5. Grep agent for: `claude-only` — fallback path defined
6. Grep skill for: `SCAMPER`, `First Principles`, `Reverse Brainstorming` — techniques present
7. Grep skill for: `anti-clustering` — rotation protocol present
8. Grep skill for YAML frontmatter: `name:`, `user_invocable:` — correct frontmatter

## Task Packets

- `TASKS/T04-T01.md` — Write brainstormer agent
- `TASKS/T04-T02.md` — Write brainstorm technique skill
- `TASKS/T04-T03.md` — Write /kiln:brainstorm entry point (embedded in skill file)
