# Blueprint: brainstorm

## Meta
- **Team name**: brainstorm
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md
- **Inputs from previous steps**: .kiln/STATE.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (all from Onboarding, brownfield files optional)
- **Workflow**: two-phase (persistent mind bootstraps, boss facilitates)

## Agent Roster

| Name | Role | Phase | Model |
|------|------|-------|-------|
| clio | Persistent mind — "Miss Clio". Foundation curator. Bootstraps from onboarding artifacts, signals READY with context summary. Accumulates VISION_UPDATEs from da-vinci. Serializes files on command. | A | opus |
| da-vinci | Boss + facilitator. Greets operator, runs brainstorm. Sends VISION_UPDATEs to clio. Never generates ideas — every idea comes from the operator. | B (INTERACTIVE) | opus |

## Three-Phase Spawn

**Phase A**: clio bootstraps → reads onboarding artifacts → READY signal with context summary (tech stack, decisions, risks for brownfield; "Clean slate" for greenfield).

**Phase B**: da-vinci spawns (INTERACTIVE, foreground). Receives clio's READY summary — enters the conversation already knowing the project shape. No Phase C — just two agents.

## Communication Model

```
Clio      → team-lead    (READY: onboarding context summary)
Da Vinci  → Clio         (VISION_UPDATE: fire-and-forget, one per approved section)
Da Vinci  → Clio         (SERIALIZE_AND_SHUTDOWN: triggers file write)
Clio      → Da Vinci     (SERIALIZATION_COMPLETE: confirms files written)
Da Vinci  → team-lead    (BRAINSTORM_COMPLETE)
```

Clio bootstraps autonomously on spawn. Da Vinci never waits for VISION_UPDATE acknowledgment.
