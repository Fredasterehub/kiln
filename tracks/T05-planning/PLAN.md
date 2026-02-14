# T05 Planning Pipeline — Plan

## Task Graph

```
T05-T01 (kiln-plan skill — format spec)
   |
   +---> T05-T02 (planner agent)          [depends on T05-T01]
   |
   +---> T05-T03 (codex-planner agent)    [depends on T05-T01]
   |
   +---> T05-T04 (synthesizer agent)      [depends on T05-T01]
   |
   +---> T05-T05 (validator agent)        [depends on T05-T01]
```

T05-T01 (kiln-plan skill) must come first because it defines the task packet format, wave grouping rules, and 7-dimension validation criteria that all four agents must follow. The four agents are independent of each other — they reference the skill but don't reference each other — and can execute in parallel.

## Wave Execution

| Wave | Tasks | Description |
|------|-------|-------------|
| 1 | T05-T01 | Write kiln-plan skill (format spec + validation criteria) |
| 2 | T05-T02, T05-T03, T05-T04, T05-T05 | Write all 4 agents (parallel) |

## Verification Plan

After all tasks complete:
1. `test -f skills/kiln-plan/kiln-plan.md` — skill exists
2. `test -f agents/kiln-planner.md` — planner exists
3. `test -f agents/kiln-codex-planner.md` — codex-planner exists
4. `test -f agents/kiln-synthesizer.md` — synthesizer exists
5. `test -f agents/kiln-validator.md` — validator exists
6. Grep all files for YAML frontmatter (`name:`)
7. Grep all files for `kiln-core` reference
8. Grep validator for all 7 dimension names
9. Grep codex-planner for `codex` CLI invocation
10. Grep skill for `task packet` format definition

## Task Packets

- `TASKS/T05-T01.md` — Write kiln-plan skill
- `TASKS/T05-T02.md` — Write planner agent
- `TASKS/T05-T03.md` — Write codex-planner agent
- `TASKS/T05-T04.md` — Write synthesizer agent
- `TASKS/T05-T05.md` — Write validator agent
