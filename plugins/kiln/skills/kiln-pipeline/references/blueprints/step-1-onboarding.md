# Blueprint: onboarding

## Meta
- **Team name**: onboarding
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/STATE.md, MEMORY.md (Kiln Pipeline section), .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (brownfield only)
- **Inputs from previous steps**: none (first step)
- **Workflow**: sequential (solo boss, conditional agent spawn)

## Agent Roster

| Name | Role | Type |
|------|------|------|
| alpha | Boss. Greets operator, gathers project info, detects brownfield/greenfield, creates .kiln/ structure, writes STATE.md and MEMORY.md. Spawns mnemosyne if brownfield. | (boss) |
| mnemosyne | Codebase mapper. Spawns 5 mapper scouts internally via Agent tool (atlas, nexus, spine, signal, bedrock) to parallelize exploration. Synthesizes findings into .kiln/docs/. Brownfield only. | general |

## Communication Model

```
Alpha      → Mnemosyne    (spawn via Agent tool, brownfield only)
Mnemosyne  → Alpha        (MAPPING_COMPLETE with file counts and tooling summary)
Alpha      → team-lead    (onboarding complete with project metadata)
```

Alpha drives. Mnemosyne is conditional — only spawned for brownfield projects.
