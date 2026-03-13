# Blueprint: report

## Meta
- **Team name**: report
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/REPORT.md
- **Inputs from previous steps**: All .kiln/ artifacts (STATE.md, MEMORY.md, master-plan.md, docs/*, validation/report.md, validation/architecture-check.md)
- **Workflow**: solo agent (inline — no team needed)

## Agent Roster

| Name | Role | Type | Model |
|------|------|------|-------|
| omega | Solo agent. Reads all pipeline artifacts and compiles the final project report. The last word. | general | opus |
