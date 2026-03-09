# Blueprint: research

## Meta
- **Team name**: research
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/docs/research/{slug}.md (per topic), .kiln/docs/research.md (synthesis)
- **Inputs from previous steps**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md (from Brainstorm), .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (from Onboarding, brownfield only)
- **Workflow**: mixed (boss identifies topics, spawns dynamic agents, parallel research, sequential synthesis)

## Agent Roster

| Name | Role | Type |
|------|------|------|
| mi6 | Boss. Reads VISION.md, identifies research topics, spawns field agents dynamically via Agent tool, collects findings, synthesizes research.md. | (boss) |
| (dynamic) | Field agents. Spawned by mi6 based on topic count. Each researches one or more topics, writes findings to .kiln/docs/research/{slug}.md. | spawned via Agent tool |

## Communication Model

```
MI6     → field agents  (spawn via Agent tool with assigned topics)
Agents  → MI6           (MISSION_COMPLETE: list of slugs researched)
MI6     → team-lead     (RESEARCH_COMPLETE: topic count + key findings)
```

MI6 determines agent count dynamically: min(topic_count, 4), minimum 2. Agent naming from pool (sherlock, watson, poirot, columbo, scully, mulder, bourne, tintin, monk, clouseau, gadget, wick). 7th agent must be "bond".
