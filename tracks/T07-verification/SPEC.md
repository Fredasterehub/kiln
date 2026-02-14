# SPEC — T07: Verification + Review

## Goal

Build the E2E verifier and reviewer agents, plus verification and E2E skills with adaptive tooling detection and stub detection. Also build the `/kiln:track` slash command that auto-advances through the full track loop.

## Acceptance Criteria

- AC-01 (LLM): E2E verifier generates user journey tests (not unit tests) per project type
- AC-02 (LLM): E2E verifier handles web-ui (Playwright), api-server (HTTP), cli-tool (subprocess), library (import)
- AC-03 (LLM): Reviewer checks correctness, completeness, security, integration, stub detection, quality
- AC-04 (LLM): Stub detection covers: null-returning components, hardcoded API responses, no-op form handlers, unhandled fetch responses
- AC-05 (LLM): Failure categorization (code bug, integration gap, missing functionality, config issue)
- AC-06 (DET): All 5 files exist with required YAML frontmatter
- AC-07 (LLM): /kiln:track auto-advances through plan → validate → execute → e2e → review → reconcile
- AC-08 (LLM): Reviewer correction tasks include file:line specificity

## Deliverables

| File | Type | Description |
|------|------|-------------|
| `agents/kiln-e2e-verifier.md` | Agent | Sonnet-based E2E test generation + execution |
| `skills/kiln-e2e/kiln-e2e.md` | Skill | Test generation patterns per project type |
| `agents/kiln-reviewer.md` | Agent | Opus-based comprehensive quality gate |
| `skills/kiln-verify/kiln-verify.md` | Skill | Adaptive verification protocol + stub detection |
| `skills/kiln-track/kiln-track.md` | Skill | Main work loop (/kiln:track slash command) |

## Verification Commands

```bash
test -f agents/kiln-e2e-verifier.md
test -f skills/kiln-e2e/kiln-e2e.md
test -f agents/kiln-reviewer.md
test -f skills/kiln-verify/kiln-verify.md
test -f skills/kiln-track/kiln-track.md
grep -q "^---" agents/kiln-e2e-verifier.md
grep -q "^---" agents/kiln-reviewer.md
grep -q "^---" skills/kiln-e2e/kiln-e2e.md
grep -q "^---" skills/kiln-verify/kiln-verify.md
grep -q "^---" skills/kiln-track/kiln-track.md
```
