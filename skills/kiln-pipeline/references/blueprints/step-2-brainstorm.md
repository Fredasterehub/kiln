# Blueprint: brainstorm

## Meta
- **Team name**: brainstorm
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md
- **Inputs from previous steps**: .kiln/STATE.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (all from Onboarding, brownfield files optional)
- **Workflow**: mixed (parallel spawn, iterative facilitation, sequential shutdown)

## Agent Roster

| Name | Role | Type |
|------|------|------|
| da-vinci | Boss + facilitator. Greets operator, runs brainstorm through techniques, sends VISION_UPDATEs to visionary for each approved section. Never generates ideas — every idea comes from the operator. | (boss) |
| visionary | Content curator. Bootstraps from onboarding artifacts (transparent to operator), accumulates VISION_UPDATEs, serializes final VISION.md and supporting files on command. | general |

## Communication Model

```
Da Vinci  → Visionary    (VISION_UPDATE: fire-and-forget, one per approved section)
Da Vinci  → Visionary    (SERIALIZE_AND_SHUTDOWN: triggers file write)
Visionary → Da Vinci     (SERIALIZATION_COMPLETE: confirms files written)
Da Vinci  → team-lead    (BRAINSTORM_COMPLETE)
```

Visionary bootstraps autonomously on spawn (Visionary Pattern). Da Vinci never waits for VISION_UPDATE acknowledgment.
