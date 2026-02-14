# T06 Execution Pipeline — Plan

## Task Graph

```
T06-T01 (kiln-execute skill — sharpening protocol, mini-verify, constraints)
   |
   +---> T06-T02 (sharpener agent)    [depends on T06-T01]
   |
   +---> T06-T03 (executor agent)     [depends on T06-T01]
```

T06-T01 (kiln-execute skill) must come first because it defines the sharpening protocol, prompt template, implementation constraints, mini-verify procedure, and retry logic that both agents reference. T06-T02 and T06-T03 are independent and can execute in parallel.

## Wave Execution

| Wave | Tasks | Description |
|------|-------|-------------|
| 1 | T06-T01 | Write kiln-execute skill (protocols + mini-verify) |
| 2 | T06-T02, T06-T03 | Write sharpener + executor agents (parallel) |

## Verification Plan

After all tasks complete:
1. `test -f skills/kiln-execute/kiln-execute.md` — skill exists
2. `test -f agents/kiln-sharpener.md` — sharpener exists
3. `test -f agents/kiln-executor.md` — executor exists
4. Grep sharpener for `codex` — Codex CLI invocation present
5. Grep executor for `gpt-5.3-codex` and `--full-auto` — correct flags
6. Grep skill for `mini-verify` — protocol present
7. Grep skill for `config.json` — tooling detection referenced
8. Grep sharpener for `claude-only` — fallback defined
9. Grep skill for `retry` — retry logic present

## Task Packets

- `TASKS/T06-T01.md` — Write kiln-execute skill
- `TASKS/T06-T02.md` — Write sharpener agent
- `TASKS/T06-T03.md` — Write executor agent
