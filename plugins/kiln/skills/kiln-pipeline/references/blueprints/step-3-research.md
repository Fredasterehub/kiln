# Blueprint: research

## Meta
- **Team name**: research
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/docs/research/{slug}.md (per topic), .kiln/docs/research.md (synthesis)
- **Inputs from previous steps**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md (from Brainstorm), .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (from Onboarding, brownfield only)
- **Workflow**: single-phase (mi6 + thoth bootstrap in parallel, mi6 requests field agents when ready, validates + synthesizes)

## Agent Roster

| Name | Agent Type | Role | Phase | Model |
|------|------------|------|-------|-------|
| mi6 | alpha-team-deploy | Boss + active firewall. Identifies topics, requests field agents, validates findings (confidence ≥0.7, ≥3 sources, quotes present), selective routing, synthesis. | A | opus |
| thoth | lore-keepah | Persistent mind. Archivist — owns all writes to .kiln/archive/. Fire-and-forget. | A | sonnet |
| (dynamic) | unit-deployed | Field agents. Team members (not subagents). 2-5 agents from naming pool. Investigate assigned topics, report structured findings via SendMessage. | A (on request) | sonnet |

## Single-Phase Spawn

**Phase A**: mi6 + thoth spawn together and bootstrap in parallel → mi6 reads VISION.md, identifies topics, determines agent count, sends REQUEST_WORKERS when ready → thoth ensures archive structure and signals READY independently → engine spawns field agents on the research team → mi6 dispatches individual assignments → field agents report findings → mi6 validates, routes, synthesizes.

For dependent topics: mi6 validates prerequisite topic before dispatching the dependent one.

## Signal Vocabulary

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| `READY: {summary}` | MI6 → engine | No | Bootstrap complete; includes topic list and planned agent count |
| `READY: {summary}` | Thoth → engine | No | Archive structure confirmed; independent of MI6 |
| `REQUEST_WORKERS: {list}` | MI6 → engine | No | Requests 2-5 field agents; min(topic_count, 5), minimum 2 |
| `MISSION_COMPLETE: {findings}` | Field agent → MI6 | No | Structured findings: confidence score, sources, quotes |
| `REVISION_NEEDED: {reason}` | MI6 → Field agent | No | Finding failed validation (confidence <0.7, <3 sources, or missing quotes) |
| `RESEARCH_COMPLETE: {N} topics` | MI6 → engine | No (terminal) | Step done; includes key findings summary |
| `ARCHIVE: {paths}` | MI6 → Thoth | No (fire-and-forget) | scout-assignments.md and research artifacts |

## Communication Model

```
--- Phase A (bootstrap, parallel) ---
MI6     → engine        (READY: topic list + agent count)
Thoth   → engine        (READY: archive structure confirmed)

--- Phase A continued (workers requested by MI6) ---
MI6     → engine        (REQUEST_WORKERS: field-agent × N)
MI6     → Agent-1       (topic assignment with acceptance criteria)
MI6     → Agent-2       (topic assignment with acceptance criteria)
...

--- Field agents report ---
Agents  → MI6           (MISSION_COMPLETE: structured findings)
MI6     → Agents        (REVISION_NEEDED: if validation fails — agent revises and resubmits)
MI6     → Agents        (selective routing: validated findings useful to dependent topics)

--- Fire-and-forget archival ---
MI6     → Thoth         (ARCHIVE: scout-assignments.md — fire-and-forget)

--- Terminal ---
MI6     → engine        (RESEARCH_COMPLETE: N topics + key findings)
```

MI6 validates each finding before routing or synthesizing. Dependent topics are dispatched only after their prerequisite topic passes validation.
