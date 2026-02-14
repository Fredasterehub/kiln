# T03 Init + Orchestrator — Plan

## Task Graph

```
T03-T01 (orchestrator agent)
   |
   +---> T03-T02 (kiln-init skill)    [depends on T03-T01]
   |
   +---> T03-T03 (kiln-status skill)  [depends on T03-T01]
   |
   +---> T03-T04 (kiln-quick skill)   [depends on T03-T01]
```

T03-T01 (orchestrator) must come first because it defines the stage transition logic, subagent spawning patterns, and overall pipeline flow that the slash command skills reference. T03-T02, T03-T03, and T03-T04 are independent of each other and can execute in parallel.

## Wave Execution

| Wave | Tasks | Description |
|------|-------|-------------|
| 1 | T03-T01 | Write orchestrator agent |
| 2 | T03-T02, T03-T03, T03-T04 | Write slash command skills (parallel) |

## Verification Plan

After all tasks complete:
1. `test -f agents/kiln-orchestrator.md` — orchestrator exists
2. `test -f skills/kiln-init/kiln-init.md` — init skill exists
3. `test -f skills/kiln-status/kiln-status.md` — status skill exists
4. `test -f skills/kiln-quick/kiln-quick.md` — quick skill exists
5. Grep each file for YAML frontmatter (`---` block with `name:` and `description:`)
6. Grep each file for `kiln-core` reference
7. Grep orchestrator for all stage names: plan, validate, execute, e2e, review, reconcile
8. Grep kiln-init for project type detection: greenfield, brownfield, returning
9. Grep kiln-init for tooling detection commands

## Task Packets

- `TASKS/T03-T01.md` — Write orchestrator agent
- `TASKS/T03-T02.md` — Write /kiln:init skill
- `TASKS/T03-T03.md` — Write /kiln:status skill
- `TASKS/T03-T04.md` — Write /kiln:quick skill
