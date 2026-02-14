# T02 Core Foundation — Plan

## Task Graph

```
T02-T01 (kiln-core skill)
   |
   +---> T02-T02 (config.json template)   [depends on T02-T01]
   |
   +---> T02-T03 (STATE.md template)       [depends on T02-T01]
   |
   +---> T02-T04 (vision-sections template) [depends on T02-T01]
```

T02-T01 (kiln-core) must come first because it defines the canonical directory structure, output formats, and contracts that the templates must conform to. T02-T02, T02-T03, and T02-T04 are independent of each other and can execute in parallel once kiln-core establishes the contracts.

## Wave Execution

| Wave | Tasks | Description |
|------|-------|-------------|
| 1 | T02-T01 | Write kiln-core skill (the constitution) |
| 2 | T02-T02, T02-T03, T02-T04 | Write template files (parallel) |

## Verification Plan

After all tasks complete, run:
1. `test -f skills/kiln-core/kiln-core.md` — kiln-core exists
2. `node -e "JSON.parse(require('fs').readFileSync('templates/config.json.tmpl', 'utf8'))"` — config template is valid JSON
3. `test -f templates/STATE.md.tmpl` — STATE template exists
4. `test -f templates/vision-sections.md` — vision-sections template exists
5. Grep kiln-core for required sections: model routing, context budget, error escalation, sentinel format, output contracts

## Task Packets

- `TASKS/T02-T01.md` — Write kiln-core skill
- `TASKS/T02-T02.md` — Write config.json template
- `TASKS/T02-T03.md` — Write STATE.md template
- `TASKS/T02-T04.md` — Write vision-sections template
