# Blueprint: validate

## Meta
- **Team name**: validate
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/validation/report.md
- **Inputs from previous steps**: .kiln/master-plan.md, .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/codebase-state.md, built source code
- **Workflow**: solo agent with optional consultation
- **Correction cycles**: On FAIL/PARTIAL, pipeline loops back to Build (max 3 cycles). Correction tasks from report.md feed into KRS-One's scoping.

## Agent Roster

| Name | Role | Type | Model |
|------|------|------|-------|
| argus | Solo agent. Builds, deploys, tests the product against master-plan acceptance criteria. Writes validation report with verdict and correction tasks. Consults Architect for architectural questions. | general | opus |
| architect | Persistent mind. Available for consultation only — answers questions about expected behavior, deployment config, intended architecture. | general | opus |

## Communication Model

```
Argus    → Architect      (architectural questions during validation — optional)
Argus    → team-lead      (VALIDATE_PASS or VALIDATE_FAILED with verdict)
```

Argus drives everything. Architect is passive — only responds when asked.

## Pipeline Runner Instructions

**Signals from Argus:**
- `VALIDATE_PASS` — all tests passed, acceptance criteria met. Proceed to step 7 (Report).
- `VALIDATE_FAILED` — failures found. Correction tasks in report.md.
  - If correction_cycle < 3: loop back to Build (step 5). KRS-One will read .kiln/validation/report.md for correction tasks and scope fixes.
  - If correction_cycle >= 3: escalate to operator. Pipeline blocked.

**STATE.md tracking:** Pipeline runner increments `correction_cycle` (default 0) on each VALIDATE_FAILED loop.
