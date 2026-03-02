# Kiln v3 Claude Plugin

Kiln v3 is now structured as a native Claude Code plugin (no custom installer required):

- Native team lifecycle orchestration
- Persistent minds with strict file ownership
- Dynamic research staffing (1-5 researchers)
- Dual-planner architecture synthesis
- JIT phase planning during implementation
- Milestone testing with automatic Stage 4 fix-loop re-entry

## Validate Plugin Manifest

```bash
claude plugin validate /DEV/kiln3codex/kiln-v3
```

## Run Locally (Session-Only)

```bash
claude --plugin-dir /DEV/kiln3codex/kiln-v3
```

Then use:

- `/kiln-v3:start`
- `/kiln-v3:resume`
- `/kiln-v3:status`
- `/kiln-v3:reset`
- `/kiln-v3:kiln-v3-core`
- `/kiln-v3:kiln-v3-init`
- `/kiln-v3:kiln-v3-mapping`
- `/kiln-v3:kiln-v3-brainstorm`
- `/kiln-v3:kiln-v3-research`
- `/kiln-v3:kiln-v3-architecture`
- `/kiln-v3:kiln-v3-implementation`
- `/kiln-v3:kiln-v3-testing`
- `/kiln-v3:kiln-v3-deployment`
- `/kiln-v3:kiln-v3-presentation`

## Native Plugin Layout

- `.claude-plugin/plugin.json`
- `agents/*.md`
- `commands/*.md`
- `skills/kiln-v3-core/SKILL.md`
- `templates/*.md`
- `settings.json`

## v3 Decisions Implemented

- Stage 2 researcher count is dynamic by scope score
- Stage 3 Visionary reads `vision-notes.md`
- Checkpoints occur after Stage 4 implementation merges
- Tester generates own milestone test plan
- Bug fixes reuse Stage 4 team (no separate bug-fix team)
- Stage 1 brainstorm is direct operator <-> Da Vinci with silent coordinator watchdog

## Brainstorm Timeout Tuning

Defaults are in [`assets/data/default-config.json`](/DEV/kiln3codex/kiln-v3/assets/data/default-config.json):

- `brainstorm.silence_timeout_minutes`: `20`
- `brainstorm.nudge_interval_minutes`: `20`
- `brainstorm.max_nudges`: `3`
