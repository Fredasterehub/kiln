# T01 Scaffolding — Plan

## Task Graph

```
T01-T01 (package.json)
   |
   +---> T01-T02 (directory skeleton) [depends on T01-T01]
   |
   +---> T01-T03 (stub installer)     [depends on T01-T01]
```

T01-T01 has no dependencies and must complete first (package.json defines the project root context). T01-T02 and T01-T03 are independent of each other and can execute in parallel (Wave 2) after T01-T01 completes.

## Wave Execution

| Wave | Tasks | Description |
|------|-------|-------------|
| 1 | T01-T01 | Create package.json |
| 2 | T01-T02, T01-T03 | Create directory skeleton + stub installer (parallel) |

## Verification Plan

After all tasks complete, run:
1. `node -e "require('./package.json')"` — validates JSON syntax
2. `ls -d agents/ skills/kiln-core/ skills/kiln-brainstorm/ skills/kiln-plan/ skills/kiln-execute/ skills/kiln-verify/ skills/kiln-e2e/ skills/kiln-reconcile/ hooks/scripts/ bin/ templates/` — all directories exist
3. `node bin/install.js --help` — exits 0, prints usage
4. `npm pack --dry-run` — succeeds, lists expected files

## Task Packets

- `TASKS/T01-T01.md` — Create package.json
- `TASKS/T01-T02.md` — Create directory skeleton
- `TASKS/T01-T03.md` — Create stub installer
