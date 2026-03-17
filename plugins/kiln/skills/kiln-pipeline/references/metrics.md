# Pipeline Metrics

Kiln collects lightweight metrics at natural pipeline boundaries — no polling, no overhead. All data is computed from existing state files and git history.

## Collection Points

### Alpha (Step 1) — Initialize
Add these fields to `.kiln/STATE.md` under `## Metrics`:
```
## Metrics
- **step_timestamps**: {"onboarding": "{ISO 8601}"}
- **agent_spawns**: 0
- **git_commits_before**: {result of `git rev-list --count HEAD`}
```

### Engine (Step Transitions) — Update
At each step transition, the engine appends the step name and timestamp to `step_timestamps`:
```
- **step_timestamps**: {"onboarding": "...", "brainstorm": "...", "research": "...", ...}
```

### KRS-One (Step 5) — Per-Iteration
KRS-One already updates `build_iteration` in STATE.md. No additional collection needed — iteration count, milestone count, and correction cycles are already tracked.

### Omega (Step 7) — Aggregate
Omega computes final metrics from STATE.md + git log + archive scan and writes `.kiln/METRICS.md`.

## METRICS.md Template

```markdown
# Pipeline Metrics: {project name}

Generated: {ISO 8601}
Run ID: {run_id}

## Timeline
| Step | Started | Duration |
|------|---------|----------|
| Onboarding | {ts} | {duration} |
| Brainstorm | {ts} | {duration} |
| Research | {ts} | {duration} |
| Architecture | {ts} | {duration} |
| Build | {ts} | {duration} |
| Validate | {ts} | {duration} |
| Report | {ts} | {duration} |
| **Total** | | **{total}** |

## Build
- Iterations: {build_iteration}
- Milestones: {milestones_complete}/{milestone_count}
- Correction cycles: {correction_cycle}
- Builder pairs used: {list from archive scan}

## Code Delta
- Commits during pipeline: {git rev-list --count HEAD minus git_commits_before}
- Files changed: {git diff --stat HEAD~N --shortstat}
- Lines added/removed: {from git diff}

## Quality
- Validation verdict: {from validation/report.md}
- Review rejections: {count from archive fix-N files}
- Design score (if UI): {from renoir/hephaestus verdicts}

## Model Usage
- Opus agents spawned: {count}
- Sonnet agents spawned: {count}
- Codex CLI invocations: {count from archive codex-output.log files}
- Estimated cost: ~${estimate based on agent counts × average tokens}
```

## Cost Estimation Heuristic

These are rough estimates based on typical pipeline token usage:

| Agent Type | Avg Input Tokens | Avg Output Tokens | Cost per Spawn |
|-----------|-----------------|-------------------|----------------|
| Opus boss (krs-one, aristotle, mi6) | ~15k | ~5k | ~$0.45 |
| Opus worker (kaneda, picasso, confucius) | ~10k | ~8k | ~$0.42 |
| Opus persistent (rakim, sentinel) | ~8k | ~3k | ~$0.24 |
| Sonnet worker (codex, sphinx, field-agent) | ~8k | ~4k | ~$0.04 |
| Sonnet reviewer (sphinx, renoir) | ~5k | ~2k | ~$0.02 |
| Haiku (thoth) | ~2k | ~1k | ~$0.003 |
| Codex CLI (GPT-5.4) | ~12k | ~6k | ~$0.20 |

Multiply spawns by cost per spawn for a pipeline cost estimate.
