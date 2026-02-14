# PLAN — T07: Verification + Review

## Overview

Build 2 agents, 3 skills that form the verification and review layer of the kiln pipeline. This track covers: E2E test generation/execution, comprehensive code review, adaptive verification, and the main track loop entry point.

## Task Graph

```
T07-T01 (kiln-e2e-verifier agent)
    └─> T07-T02 (kiln-e2e skill) [T01 references T02 for patterns]
T07-T03 (kiln-reviewer agent) [independent of T01/T02]
T07-T04 (kiln-verify skill) [independent]
T07-T05 (kiln-track skill) [references all T07 agents/skills]
```

## Execution Order

### Wave 1 (parallel)
- **T07-T01**: Write `agents/kiln-e2e-verifier.md`
- **T07-T03**: Write `agents/kiln-reviewer.md`
- **T07-T04**: Write `skills/kiln-verify/kiln-verify.md`

### Wave 2 (depends on T01)
- **T07-T02**: Write `skills/kiln-e2e/kiln-e2e.md` (references E2E verifier patterns)

### Wave 3 (depends on all above)
- **T07-T05**: Write `skills/kiln-track/kiln-track.md` (references all T07 agents and skills)

## Task Summary

| Task | File | Action | ~Lines | Dependencies |
|------|------|--------|--------|-------------|
| T07-T01 | `agents/kiln-e2e-verifier.md` | add | ~350 | kiln-core, kiln-execute |
| T07-T02 | `skills/kiln-e2e/kiln-e2e.md` | add | ~300 | T07-T01, kiln-core |
| T07-T03 | `agents/kiln-reviewer.md` | add | ~350 | kiln-core, kiln-plan |
| T07-T04 | `skills/kiln-verify/kiln-verify.md` | add | ~250 | kiln-core |
| T07-T05 | `skills/kiln-track/kiln-track.md` | add | ~300 | T07-T01 through T07-T04, kiln-orchestrator |

## Acceptance Criteria Mapping

| AC | Task(s) | Verification |
|----|---------|-------------|
| AC-01 | T07-T01, T07-T02 | LLM: E2E generates user journey tests |
| AC-02 | T07-T02 | LLM: Covers web-ui, api-server, cli-tool, library |
| AC-03 | T07-T03 | LLM: Reviewer checks all 7 dimensions |
| AC-04 | T07-T04 | LLM: Stub detection checklist is comprehensive |
| AC-05 | T07-T01, T07-T03 | LLM: Failure categorization present |
| AC-06 | All | DET: Files exist with YAML frontmatter |
| AC-07 | T07-T05 | LLM: Track auto-advances through all stages |
| AC-08 | T07-T03 | LLM: Corrections include file:line |
