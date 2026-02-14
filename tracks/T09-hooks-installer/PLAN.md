# PLAN — T09: Hooks + Installer

## Overview

Build 2 shell hook scripts, 1 hook registration file, and 1 full Node.js installer. This track provides the user-facing installation experience and the runtime lifecycle hooks that maintain state continuity across Claude Code sessions.

## Task Graph

```
T09-T01 (hooks.json) [independent]
T09-T02 (on-session-start.sh) [independent]
T09-T03 (on-task-completed.sh) [independent]
T09-T04 (bin/install.js full) [depends on T01 for hook paths, T02/T03 for script existence]
```

## Execution Order

### Wave 1 (parallel — all independent)
- **T09-T01**: Write `hooks/hooks.json`
- **T09-T02**: Write `hooks/scripts/on-session-start.sh`
- **T09-T03**: Write `hooks/scripts/on-task-completed.sh`

### Wave 2 (depends on Wave 1)
- **T09-T04**: Write `bin/install.js` (full implementation, replaces stub)

## Task Summary

| Task | File | Action | ~Lines | Dependencies |
|------|------|--------|--------|-------------|
| T09-T01 | `hooks/hooks.json` | add | ~30 | kiln-core |
| T09-T02 | `hooks/scripts/on-session-start.sh` | add | ~80 | kiln-core, STATE.md format |
| T09-T03 | `hooks/scripts/on-task-completed.sh` | add | ~80 | kiln-core, config.json format |
| T09-T04 | `bin/install.js` | modify (replace stub) | ~300 | T09-T01 through T09-T03 |

## Acceptance Criteria Mapping

| AC | Task(s) | Verification |
|----|---------|-------------|
| AC-01 | T09-T02, T09-T03 | DET: shellcheck passes |
| AC-02 | T09-T04 | DET: --help exits 0 |
| AC-03 | T09-T04 | DET: files in correct destinations |
| AC-04 | T09-T04 | DET: .kiln/ directory created |
| AC-05 | T09-T02 | LLM: state rehydration logic |
| AC-06 | T09-T03 | LLM: mini-verify gate logic |
| AC-07 | T09-T01 | DET: valid JSON, references existing scripts |
| AC-08 | T09-T04 | DET: zero runtime deps |
