# SPEC — T09: Hooks + Installer

## Goal

Build the lifecycle hooks (state rehydration on session start, mini-verify gate on task completion) and the full interactive installer that copies the kiln package into a user's project, merging with existing Claude Code configurations.

## Acceptance Criteria

- AC-01 (DET): `shellcheck hooks/scripts/*.sh` passes
- AC-02 (DET): `node bin/install.js --help` shows usage
- AC-03 (DET): Installer copies agents/, skills/, hooks/ to correct .claude/ destinations in a temp dir
- AC-04 (DET): Installer creates .kiln/ directory structure
- AC-05 (LLM): on-session-start rehydrates state from STATE.md correctly
- AC-06 (LLM): on-task-completed runs mini-verify gate
- AC-07 (DET): hooks.json is valid JSON and references existing scripts
- AC-08 (DET): Zero runtime dependencies (only Node.js built-ins)

## Deliverables

| File | Type | Description |
|------|------|-------------|
| `hooks/hooks.json` | Config | Hook registration for Claude Code |
| `hooks/scripts/on-session-start.sh` | Script | State rehydration from STATE.md |
| `hooks/scripts/on-task-completed.sh` | Script | Mini-verify gate after task completion |
| `bin/install.js` | Script | Full interactive installer (replaces stub) |

## Verification Commands

```bash
shellcheck hooks/scripts/on-session-start.sh
shellcheck hooks/scripts/on-task-completed.sh
node bin/install.js --help
python3 -c "import json; json.load(open('hooks/hooks.json'))"
```
