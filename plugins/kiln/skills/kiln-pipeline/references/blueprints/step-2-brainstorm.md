# Blueprint: brainstorm

## Meta
- **Team name**: brainstorm
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md
- **Inputs from previous steps**: .kiln/STATE.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (all from Onboarding, brownfield files optional)
- **Workflow**: two-phase (persistent mind bootstraps, boss facilitates)

## Agent Roster

| Name | Agent Type | Role | Phase | Model |
|------|------------|------|-------|-------|
| asimov | the-foundation | Persistent mind. Foundation curator. Bootstraps from onboarding artifacts, signals READY with context summary. Accumulates VISION_UPDATEs from da-vinci. Serializes files on command. | A | opus |
| da-vinci | the-creator | Boss + facilitator. Greets operator, runs brainstorm. Sends VISION_UPDATEs to asimov. Never generates ideas — every idea comes from the operator. | B (INTERACTIVE) | opus |

## Three-Phase Spawn

**Phase A**: asimov bootstraps → reads onboarding artifacts → READY signal with context summary (tech stack, decisions, risks for brownfield; "Clean slate" for greenfield).

**Phase B**: da-vinci spawns (INTERACTIVE, foreground). Receives asimov's READY summary — enters the conversation already knowing the project shape. No Phase C — just two agents.

## Signal Vocabulary

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| `READY: {summary}` | Asimov → engine | No | Bootstrap complete; includes tech stack, decisions, risks (brownfield) or "Clean slate" (greenfield) |
| `VISION_UPDATE: {section}` | Da Vinci → Asimov | No (fire-and-forget) | One per approved brainstorm section; asimov accumulates, da-vinci never waits for ack |
| `SERIALIZE_AND_SHUTDOWN` | Da Vinci → Asimov | Yes (waits for SERIALIZATION_COMPLETE) | Triggers asimov to write VISION.md, vision-notes.md, vision-priorities.md |
| `SERIALIZATION_COMPLETE` | Asimov → Da Vinci | — (reply to above) | Confirms all three files written to disk |
| `BRAINSTORM_COMPLETE` | Da Vinci → engine | No (terminal) | Step done; advances stage to research |

## Communication Model

```
--- Phase A (bootstrap) ---
Asimov      → engine       (READY: onboarding context summary)

--- Phase B (boss, INTERACTIVE — no Phase C) ---
Da Vinci  → Asimov         (VISION_UPDATE: one per approved section — fire-and-forget)
...
Da Vinci  → Asimov         (SERIALIZE_AND_SHUTDOWN — blocking, waits for reply)
Asimov      → Da Vinci     (SERIALIZATION_COMPLETE: files written)

--- Terminal ---
Da Vinci  → engine       (BRAINSTORM_COMPLETE)
```

Asimov bootstraps autonomously on spawn. Da Vinci accumulates operator-approved ideas across the full conversation, fires VISION_UPDATEs throughout, then triggers serialization when the session is done.
