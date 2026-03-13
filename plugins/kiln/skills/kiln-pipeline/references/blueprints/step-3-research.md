# Blueprint: research

## Meta
- **Team name**: research
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/docs/research/{slug}.md (per topic), .kiln/docs/research.md (synthesis)
- **Inputs from previous steps**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md (from Brainstorm), .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (from Onboarding, brownfield only)
- **Workflow**: three-phase (mi6 bootstraps, requests field agents, validates + synthesizes)

## Agent Roster

| Name | Role | Phase | Model |
|------|------|-------|-------|
| mi6 | Boss + active firewall. Identifies topics, requests field agents, validates findings (confidence ≥0.7, ≥3 sources, quotes present), selective routing, synthesis. | A→B | opus |
| thoth | Persistent mind. Archivist — owns all writes to .kiln/archive/. Fire-and-forget. | A | haiku |
| (dynamic) | Field agents. Team members (not subagents). 2-5 agents from naming pool. Investigate assigned topics, report structured findings via SendMessage. | C | sonnet |

## Three-Phase Spawn

**Phase A**: mi6 + thoth bootstrap in parallel → mi6 reads VISION.md + identifies topics → thoth ensures archive structure → both signal READY.

**Phase B/C merged**: mi6 requests field agents via REQUEST_WORKERS → engine spawns on team → mi6 dispatches individual assignments → field agents report findings → mi6 validates, routes, synthesizes.

For dependent topics: mi6 validates prerequisite topic before dispatching the dependent one.

## Communication Model

```
MI6     → team-lead     (READY: topic count + key areas)
MI6     → team-lead     (REQUEST_WORKERS: field agent list)
MI6     → field agents   (individual topic assignments via SendMessage)
Agents  → MI6            (MISSION_COMPLETE: findings per topic)
MI6     → agents         (REVISION_NEEDED: if finding fails validation)
MI6     → agents         (selective routing: validated findings relevant to other topics)
MI6     → team-lead      (RESEARCH_COMPLETE: topic count + key findings)
MI6     → thoth          (ARCHIVE: scout-assignments.md — fire-and-forget)
```

MI6 determines agent count dynamically: min(topic_count, 5), minimum 2. Agent naming from pool (sherlock, watson, poirot, columbo, scully, mulder, bourne, tintin, monk, clouseau, gadget, wick). 7th agent must be "bond".
