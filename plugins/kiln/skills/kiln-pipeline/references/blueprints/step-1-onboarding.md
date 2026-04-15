# Blueprint: onboarding

## Meta
- **Team name**: onboarding
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/STATE.md, MEMORY.md (Kiln Pipeline section), .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (brownfield only)
- **Inputs from previous steps**: none (first step)
- **Workflow**: three-phase (persistent mind bootstraps, boss greets, scouts scan)

## Agent Roster

| Name | Agent Type | Role | Phase | Model |
|------|------------|------|-------|-------|
| mnemosyne | the-discovery-begins | Persistent mind. Identity scan on spawn (<2s). Coordinates deep scanning via scouts if alpha requests it. | A | opus |
| alpha | the-beginning-of-the-end | Boss. Greets operator, gathers project logistics (not vision), creates .kiln/ structure. Requests deep scan if brownfield. | B (INTERACTIVE) | opus |
| maiev | the-anatomist | Anatomy scout. Structure, directories, modules, entry points. Reports to mnemosyne. | C | sonnet |
| curie | trust-the-science | Health scout. Dependencies, tests, CI/CD, build system, tech debt. Reports to mnemosyne. | C | sonnet |
| medivh | follow-the-scent | Nervous system scout. APIs, data flow, integrations, events, state. Reports to mnemosyne. | C | sonnet |

## Three-Phase Spawn

**Phase A**: mnemosyne bootstraps → identity scan → READY signal with brownfield/greenfield + summary.

**Phase B**: alpha spawns (INTERACTIVE, foreground). Receives mnemosyne's READY summary. Greets operator, gathers project info. If brownfield and operator approves, messages mnemosyne to deploy scouts.

**Phase C** (brownfield + operator approved): mnemosyne requests maiev, curie, medivh. Scouts report to mnemosyne. Mnemosyne synthesizes → signals MAPPING_COMPLETE to alpha.

Greenfield skips Phase C entirely.

## Signal Vocabulary

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| `READY: {summary}` | Mnemosyne → engine | No | Bootstrap complete; includes brownfield/greenfield verdict + identity scan summary |
| `REQUEST_WORKERS: maiev, curie, medivh` | Mnemosyne → engine | No | Brownfield only; scouts deployed after alpha approves deep scan |
| `ONBOARDING_COMPLETE: {metadata}` | Alpha → engine | No (terminal) | Step done; advances stage to brainstorm |
| `ONBOARDING_BLOCKED: {reason}` | Alpha → engine | No (terminal) | Operator cannot provide minimum required info |

Internal (not routed through engine):

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| `DEEP_SCAN` | Alpha → Mnemosyne | No | Instructs mnemosyne to deploy scouts; brownfield + operator approved |
| `SCOUT_REPORT: {findings}` | Scouts → Mnemosyne | No | Each scout reports independently on completion |
| `MAPPING_COMPLETE: {summary}` | Mnemosyne → Alpha | No | Synthesis of all scout reports; alpha presents to operator |

## Communication Model

```
--- Phase A (bootstrap) ---
Mnemosyne  → engine       (READY: brownfield/greenfield + identity scan summary)

--- Phase B (boss, INTERACTIVE) ---
Alpha      → Mnemosyne    (DEEP_SCAN — brownfield + operator approved)

--- Phase C (scouts, brownfield only) ---
Mnemosyne  → engine       (REQUEST_WORKERS: maiev, curie, medivh)
Mnemosyne  → Maiev        (anatomy assignment)
Mnemosyne  → Curie        (health assignment)
Mnemosyne  → Medivh       (nervous system assignment)
Scouts     → Mnemosyne    (SCOUT_REPORT: findings — fire-and-forget)
Mnemosyne  → Alpha        (MAPPING_COMPLETE: synthesis summary)

--- Terminal ---
Alpha      → engine       (ONBOARDING_COMPLETE: project metadata)
```

Greenfield skips Phase C entirely. Alpha signals ONBOARDING_COMPLETE directly after gathering project info from the operator.
