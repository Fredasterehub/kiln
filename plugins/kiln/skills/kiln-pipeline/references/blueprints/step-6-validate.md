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
| argus | Solo validator. Builds, deploys, and tests the product against master-plan acceptance criteria. Uses Playwright for web UIs when the host runtime provides it; otherwise falls back to non-browser checks and reports coverage limits explicitly. Writes validation report with verdict and correction tasks. Consults zoxea for architectural questions. | general | sonnet |
| hephaestus | Design QA specialist. Conditional spawn — only when `.kiln/design/` exists and project has web UI. Uses Playwright screenshots when available and falls back to static review when not. Advisory scoring — never sole cause of failure. | general | sonnet |

## Signal Vocabulary

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| `READY: {summary}` | Zoxea → engine | No | Bootstrap complete; architecture-check.md written, architectural drift summary ready |
| `REQUEST_WORKERS: hephaestus` | Argus → engine | No | Conditional — only when `.kiln/design/` exists and project is a web app |
| `DESIGN_QA_COMPLETE: {scores}` | Hephaestus → Argus | No | 5-axis design review scores; advisory only, never sole cause of FAIL |
| `VALIDATE_PASS` | Argus → engine | No (terminal) | All acceptance criteria met; advances stage to report |
| `VALIDATE_FAILED: {reason}` | Argus → engine | No (terminal) | Failures found; correction tasks in report.md; triggers Build loop if cycle < 3 |

Internal (not routed through engine):

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| Architectural question | Argus → Zoxea | Yes (waits for reply) | Argus consults zoxea during validation; zoxea is passive until asked |

## Communication Model

```
--- Phase A (bootstrap) ---
Zoxea      → engine         (READY: architecture verification summary)

--- Phase B (validation) ---
Argus      → Zoxea          (architectural questions — optional, blocking)
Zoxea      → Argus          (answer — fire-and-forget reply)

--- Phase C (design QA — conditional) ---
Argus      → engine         (REQUEST_WORKERS: hephaestus)
Argus      → Hephaestus     (design artifact paths + deployed app URL)
Hephaestus → Argus          (DESIGN_QA_COMPLETE: 5-axis scores)

--- Terminal ---
Argus      → engine         (VALIDATE_PASS  or  VALIDATE_FAILED: reason + correction tasks)
```

Zoxea is passive after READY — only wakes on consultation. Phase C is skipped entirely when `.kiln/design/` does not exist.

## Three-Phase Spawn

**Phase A — Foundation:**
1. Spawn zoxea (persistent mind).
2. Wait for READY signal from zoxea. Zoxea reads architecture docs + codebase, writes `.kiln/validation/architecture-check.md`, signals READY with summary.

**Phase B — Validation:**
3. Spawn argus (solo validator) with zoxea's READY summary in context.
4. Argus reads architecture-check.md, builds, deploys, and checks acceptance criteria. For web UIs, use Playwright when available; otherwise run non-browser validation and record any browser-only coverage gaps.
5. Wait for VALIDATE_PASS or VALIDATE_FAILED from argus.

**Phase C — Design QA (conditional):**
6. If `.kiln/design/` exists AND project is a web app: argus spawns hephaestus via REQUEST_WORKERS.
7. Argus sends design artifact paths and deployed app URL to hephaestus.
8. Hephaestus performs 5-axis design review, then writes `.kiln/validation/design-review.md`. Hephaestus self-degrades — she uses Playwright when available, grep-based checks when not.
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
