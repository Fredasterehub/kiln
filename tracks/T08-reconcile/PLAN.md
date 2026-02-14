# PLAN — T08: Reconcile + Utilities

## Overview

Build 1 agent, 2 skills, and 1 logic enhancement that form the reconciliation, research, roadmap, and final integration layer of the kiln pipeline. This track provides the documentation maintenance, information retrieval, phase generation, and project completion capabilities.

## Task Graph

```
T08-T01 (kiln-reconcile skill) [independent]
T08-T02 (kiln-researcher agent) [independent]
T08-T03 (kiln-roadmap skill) [independent]
T08-T04 (final integration E2E) [depends on T07-T05 kiln-track skill existing]
```

## Execution Order

### Wave 1 (parallel — all independent)
- **T08-T01**: Write `skills/kiln-reconcile/kiln-reconcile.md`
- **T08-T02**: Write `agents/kiln-researcher.md`
- **T08-T03**: Write `skills/kiln-roadmap/kiln-roadmap.md`

### Wave 2 (depends on T07-T05)
- **T08-T04**: Write final integration E2E logic (enhances kiln-track skill or orchestrator)

## Task Summary

| Task | File | Action | ~Lines | Dependencies |
|------|------|--------|--------|-------------|
| T08-T01 | `skills/kiln-reconcile/kiln-reconcile.md` | add | ~300 | kiln-core |
| T08-T02 | `agents/kiln-researcher.md` | add | ~200 | kiln-core |
| T08-T03 | `skills/kiln-roadmap/kiln-roadmap.md` | add | ~200 | kiln-core, templates/vision-sections.md |
| T08-T04 | `skills/kiln-track/kiln-track.md` or `agents/kiln-orchestrator.md` | modify | ~100 | T07-T05, T08-T01 |

## Acceptance Criteria Mapping

| AC | Task(s) | Verification |
|----|---------|-------------|
| AC-01 | T08-T01 | LLM: Updates all 4 living docs |
| AC-02 | T08-T01 | LLM: Budget enforcement, replace not append |
| AC-03 | T08-T02 | LLM: Structured output format |
| AC-04 | T08-T03 | LLM: Dynamic phase count |
| AC-05 | T08-T03 | LLM: Lightweight format |
| AC-06 | All | DET: Files exist with frontmatter |
| AC-07 | T08-T04 | LLM: Cross-cutting user journey tests |
