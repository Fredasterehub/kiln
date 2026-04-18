# Blueprint: report

The engine reads this blueprint at step spawn to launch omega as a solo agent with no phases and no teammates. Omega is the step boss and the only worker at once, and consults this blueprint inside the conversation for the terminal signal it must emit. Reference posture — the shared contract between the spawning engine and the step boss.

## Meta
- **Team name**: report
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/REPORT.md
- **Inputs from previous steps**: All .kiln/ artifacts (STATE.md, MEMORY.md, master-plan.md, docs/*, validation/report.md, validation/architecture-check.md)
- **Workflow**: solo agent (inline — no team needed)

## Agent Roster

| Name | Agent Type | Role | Type | Model |
|------|------------|------|------|-------|
| omega | the-end-of-the-beginning | Solo agent. Reads all pipeline artifacts and compiles the final project report. The last word. | general | opus |

## Signal Vocabulary

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| `REPORT_COMPLETE` | Omega → engine | No (terminal) | Step done; pipeline stage advances to complete |

No internal signals. Omega is a solo agent — no teammates, no consultation.

## Communication Model

```
--- Solo execution (no phases, no teammates) ---
Omega reads all .kiln/ artifacts autonomously
Omega writes .kiln/REPORT.md

--- Terminal ---
Omega  → engine  (REPORT_COMPLETE)
```

Omega has no peers to message. All work is read-then-write: consume every artifact from STATE.md through validation/report.md, then produce one consolidated REPORT.md.
