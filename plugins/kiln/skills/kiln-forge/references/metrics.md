# Metrics — Definitions and Thresholds

What we measure in smoke tests, how, and what GREEN/YELLOW/RED means.

## Core Metrics

### Duration

**What**: Wall-clock time from pipeline launch to final signal (or timeout).
**Source**: Timestamps on first and last stream-json events.
**Unit**: Minutes.

| Scenario | GREEN | YELLOW | RED |
|----------|-------|--------|-----|
| S1 (Research) | ≤10 min | 10-15 min | >15 min or timeout |
| S5 (Build) | ≤20 min | 20-30 min | >30 min or timeout |
| S6 (Full) | ≤60 min | 60-90 min | >90 min or timeout |

### Agents Spawned

**What**: Total agent spawn count (Agent tool_use events in stream-json).
**Source**: Count of `tool_use` events where `name == "Agent"`.
**Unit**: Count.

Expected ranges per scenario:
- S1: 3-7 (mi6 + 2-5 field agents)
- S5: 5-7 (rakim, sentinel, krs-one, codex, sphinx + possible re-spawns)
- S6: 15-30 (all steps 3-7)

No fixed threshold — track for trend analysis.

### Tool Calls

**What**: Total tool call count across all agents.
**Source**: Count of all `tool_use` events in stream-json.
**Unit**: Count.

No fixed threshold — track for trend analysis. Significant increase (>30% vs baseline) signals context burn or inefficiency.

### Token Usage

**What**: Total input + output tokens consumed.
**Source**: `result` events in stream-json with `usage` field.
**Unit**: Thousands (K).

No fixed threshold — track for trend analysis.

### Hook Violations

**What**: Number of times enforce-pipeline.sh blocked a tool call (exit 2).
**Source**: Count of hook block messages in stream output.
**Unit**: Count.

| GREEN | YELLOW | RED |
|-------|--------|-----|
| 0 | 1-2 | ≥3 |

Any hook violation means an agent tried something it shouldn't. 0 is the target.

### Correction Cycles

**What**: Number of Validate → Build correction loops.
**Source**: STATE.md `correction_cycle` value at end of run.
**Unit**: Count.

| GREEN | YELLOW | RED |
|-------|--------|-----|
| 0 | 1 | ≥2 |

### Prompt Skeleton Compliance

**What**: How many of the 6 skeleton sections appear in codex prompts.
**Source**: Parse codex prompt file(s) from the workspace for section headers: Commands, Architecture, Context, Task, Patterns & Pitfalls, Acceptance Criteria.
**Unit**: Count out of 6.

| GREEN | YELLOW | RED |
|-------|--------|-----|
| ≥5/6 | 4/6 | ≤3/6 |

### Artifact Completeness

**What**: How many expected artifacts exist at end of run.
**Source**: Check files listed in scenario's `expect.json`.
**Unit**: Fraction (found/expected).

| GREEN | YELLOW | RED |
|-------|--------|-----|
| 100% | ≥80% | <80% |

### Delegation Compliance

**What**: Whether delegation agents (codex, sun-tzu, krs-one) ever used Write/Edit.
**Source**: Scan stream-json for tool_use events from these agents with `name in [Write, Edit]`.
**Unit**: Boolean.

| GREEN | RED |
|-------|-----|
| No violations | Any violation |

## Derived Metrics

### Efficiency Ratio
`tokens_used / tool_calls` — rough measure of how much context per action. Lower is generally better (less context burn). Track trend only.

### Build Velocity
`milestones_complete / duration_minutes` — milestones per minute during build step. Only meaningful for S5 and S6.

## Baseline Management

- Each scenario has one active baseline (marked `"baseline": true` in run-history.json)
- New baselines set manually via w4-track workflow
- Comparison: delta percentage per metric, flag >10% regression
- First passing run becomes the initial baseline
