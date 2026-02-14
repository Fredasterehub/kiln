# PLAN — T10: Integration Test

## Overview

Create the capstone integration test that validates the complete kiln package: installation into a temp project, file placement verification, cross-reference validation, and npm packaging. Also create the package README.

## Task Graph

```
T10-T01 (integration test script) [independent]
T10-T02 (cross-reference validation) [independent]
T10-T03 (package validation + README) [independent]
```

## Execution Order

### Wave 1 (all parallel — independent)
- **T10-T01**: Write `tests/integration.sh`
- **T10-T02**: Write cross-reference validation (embedded in integration.sh or separate)
- **T10-T03**: Write package validation + `README.md`

## Task Summary

| Task | File | Action | ~Lines | Dependencies |
|------|------|--------|--------|-------------|
| T10-T01 | `tests/integration.sh` | add | ~150 | All T01-T09 complete |
| T10-T02 | `tests/integration.sh` (section) or `tests/validate-refs.sh` | add | ~100 | All agents/skills exist |
| T10-T03 | `README.md` + package.json verification | add | ~100 | package.json finalized |

## Acceptance Criteria Mapping

| AC | Task(s) | Verification |
|----|---------|-------------|
| AC-01 | T10-T01 | DET: install into temp dir succeeds |
| AC-02 | T10-T01 | DET: all agent files present |
| AC-03 | T10-T01 | DET: all skill dirs present |
| AC-04 | T10-T01 | DET: hooks.json valid |
| AC-05 | T10-T01 | DET: .kiln/ created |
| AC-06 | T10-T02 | LLM+DET: cross-refs resolve |
| AC-07 | T10-T03 | DET: npm pack/publish succeeds |
| AC-08 | T10-T03 | DET: no dev files in package |
