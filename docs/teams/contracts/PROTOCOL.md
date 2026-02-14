# Teams Protocol (v2)

This workflow uses **structured Markdown code fences** ("sentinels") to make outputs parseable and auditable.

## Sentinel Format

All structured output MUST be emitted as:

```text
```teams:TYPE
key: value
nested:
  - item
```
```

Rules:
- YAML only.
- No prose inside the fence.
- Emit at most one sentinel per message unless explicitly asked.

## Types

- `TRACK`: track selection, base commit, overall status
- `SPEC`: acceptance criteria and constraints
- `PLAN`: task graph + packet paths
- `TASK`: a single task packet summary (optional; packets live as files)
- `IMPLEMENT`: implementation report (files changed, verify output)
- `VERDICT`: QA verdict (pass/fail + evidence)
- `CONDUCTOR`: boundary/drift/stuck decision
- `DOCSYNC`: doc reconciliation proposal status
- `INTEGRATE`: integrator report
- `DIAGNOSTIC`: troubleshooting output

## PLAN Schema (Minimum)

```text
```teams:PLAN
track_id: <track_id>
base_commit: <sha>
tasks:
  - id: <track_id>-T01
    title: "<short title>"
    depends_on: []
    packet_path: tracks/<track_id>/TASKS/<track_id>-T01.md
  - id: <track_id>-T02
    title: "<short title>"
    depends_on: [<track_id>-T01]
    packet_path: tracks/<track_id>/TASKS/<track_id>-T02.md
```
```

## CONDUCTOR Schema (Minimum)

```text
```teams:CONDUCTOR
track_id: <track_id>
decision: CONTINUE|ADAPT|REPLAN|ESCALATE
because:
  - "<short reason>"
recommended_changes: []
risks_if_ignored: []
```
```

