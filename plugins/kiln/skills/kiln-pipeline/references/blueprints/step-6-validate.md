# Blueprint: validate

## Meta
- **Team name**: validate
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/validation/report.md, .kiln/validation/design-review.md (conditional — when .kiln/design/ exists)
- **Inputs from previous steps**: .kiln/master-plan.md, .kiln/docs/architecture.md, .kiln/docs/decisions.md, .kiln/docs/tech-stack.md, .kiln/docs/codebase-state.md, .kiln/docs/deployment.md (optional), built source code
- **Workflow**: two-phase spawn (persistent mind + solo validator), optional Phase C (design QA)
- **Correction cycles**: On FAIL/PARTIAL, pipeline loops back to Build (max 3 cycles). Correction tasks from report.md feed into KRS-One's scoping.

## Agent Roster

| Name | Role | Type | Model |
|------|------|------|-------|
| zoxea | Persistent mind. Reads architecture docs + ADRs + codebase, compares implementation against architectural intent, writes architecture-check.md. Available for consultation. | general | sonnet |
| argus | Solo validator. Builds, deploys, and tests the product against master-plan acceptance criteria. Functional validation with Playwright for web UIs. Writes validation report with verdict and correction tasks. Consults zoxea for architectural questions. | general | sonnet |
| hephaestus | Design QA specialist. Conditional spawn — only when `.kiln/design/` exists and project has web UI. 5-axis design review using Playwright screenshots. Advisory scoring — never sole cause of failure. | general | sonnet |

## Communication Model

```
zoxea       → team-lead      (READY signal with architecture verification summary)
argus       → zoxea          (architectural questions during validation — optional)
argus       → team-lead      (REQUEST_WORKERS: hephaestus — conditional, when .kiln/design/ exists)
argus       → hephaestus     (design artifact paths + deployed app URL)
hephaestus  → argus          (DESIGN_QA_COMPLETE with design score)
argus       → team-lead      (VALIDATE_PASS or VALIDATE_FAILED with verdict)
```

Zoxea bootstraps and waits. Argus drives validation. Zoxea is passive after READY — only responds when asked.

## Three-Phase Spawn

**Phase A — Foundation:**
1. Spawn zoxea (persistent mind).
2. Wait for READY signal from zoxea. Zoxea reads architecture docs + codebase, writes `.kiln/validation/architecture-check.md`, signals READY with summary.

**Phase B — Validation:**
3. Spawn argus (solo validator) with zoxea's READY summary in context.
4. Argus reads architecture-check.md, builds, deploys, runs functional validation (Playwright for web UIs), checks acceptance criteria.
5. Wait for VALIDATE_PASS or VALIDATE_FAILED from argus.

**Phase C — Design QA (conditional):**
6. If `.kiln/design/` exists AND project is a web app: argus spawns hephaestus via REQUEST_WORKERS.
7. Argus sends design artifact paths and deployed app URL to hephaestus.
8. Hephaestus performs 5-axis design review, writes `.kiln/validation/design-review.md`.
9. Hephaestus signals DESIGN_QA_COMPLETE with scores. Argus integrates into report.

If `.kiln/design/` does not exist, Phase C is skipped entirely.

## Pipeline Runner Instructions

**Signals from Argus:**
- `VALIDATE_PASS` — all tests passed, acceptance criteria met. Proceed to step 7 (Report).
- `VALIDATE_FAILED` — failures found. Correction tasks in report.md.
  - If correction_cycle < 3: loop back to Build (step 5). KRS-One will read .kiln/validation/report.md for correction tasks and scope fixes.
  - If correction_cycle >= 3: escalate to operator. Pipeline blocked.

**STATE.md tracking:** Pipeline runner increments `correction_cycle` (default 0) on each VALIDATE_FAILED loop.

## Design Score in Verdict

When Phase C runs, argus includes a "Design Quality" section in the validation report with hephaestus's 5-axis scores and overall design score. Design score is advisory:
- Score >= 3.0/5.0: no impact on verdict
- Score 2.0-2.9: noted in warnings, can contribute to PARTIAL (but not sole cause)
- Score < 2.0: strong warning, recommend design iteration
Design score NEVER causes FAIL verdict on its own.
