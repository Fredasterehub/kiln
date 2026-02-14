# SPEC — T08: Reconcile + Utilities

## Goal

Build the reconciliation skill for living doc updates, the researcher agent for fast retrieval, the /kiln:roadmap slash command for phase generation, and the final integration E2E logic.

## Acceptance Criteria

- AC-01 (LLM): Reconcile skill updates living docs (TECH_STACK, PATTERNS, DECISIONS, PITFALLS)
- AC-02 (LLM): Living doc updates replace outdated entries (budget-capped ~3000 words each)
- AC-03 (LLM): Researcher agent provides fast retrieval with structured output format
- AC-04 (LLM): /kiln:roadmap generates dynamic phase count from VISION.md
- AC-05 (LLM): Roadmap is lightweight on purpose (titles + 1-2 sentences, no implementation details)
- AC-06 (DET): All files exist with required YAML frontmatter
- AC-07 (LLM): Final integration E2E generates cross-cutting user journey tests

## Deliverables

| File | Type | Description |
|------|------|-------------|
| `skills/kiln-reconcile/kiln-reconcile.md` | Skill | Living doc update protocol |
| `agents/kiln-researcher.md` | Agent | Haiku-based fast retrieval |
| `skills/kiln-roadmap/kiln-roadmap.md` | Skill | Phase generation from VISION.md |
| (embedded in kiln-track or orchestrator) | Logic | Final integration E2E protocol |

## Verification Commands

```bash
test -f skills/kiln-reconcile/kiln-reconcile.md
test -f agents/kiln-researcher.md
test -f skills/kiln-roadmap/kiln-roadmap.md
grep -q "^---" skills/kiln-reconcile/kiln-reconcile.md
grep -q "^---" agents/kiln-researcher.md
grep -q "^---" skills/kiln-roadmap/kiln-roadmap.md
```
