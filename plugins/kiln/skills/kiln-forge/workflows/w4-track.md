# W4: Track — Metrics and History

View test run history, metrics trends, and baseline comparisons.

## Data Source

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/data/run-history.json` for all test run data.

## Workflow

### Intent: Show History

Display recent runs in a table:

```
Recent Runs (last 10):
| # | Date       | Scenario | Result  | Duration | Artifacts | Compliance |
|---|------------|----------|---------|----------|-----------|------------|
| 1 | 2026-03-12 | S5       | PASS    | 14m 32s  | 8/8       | 3/3        |
| 2 | 2026-03-11 | S5       | FAIL    | 22m 10s  | 6/8       | 2/3        |
| 3 | 2026-03-10 | S1       | PASS    | 8m 15s   | 4/4       | 2/2        |
```

### Intent: Show Metrics

Display metrics for a specific scenario across runs:

```
Scenario S5 — Trend (last 5 runs):
| Metric          | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Trend |
|-----------------|-------|-------|-------|-------|-------|-------|
| duration (min)  | 22.1  | 18.5  | 16.2  | 14.5  | 14.5  | ↓     |
| agents_spawned  | 7     | 7     | 7     | 7     | 7     | =     |
| tool_calls      | 180   | 156   | 148   | 142   | 130   | ↓     |
| tokens (K)      | 340   | 310   | 295   | 284   | 270   | ↓     |
| hook_violations | 2     | 1     | 0     | 0     | 0     | ↓     |
```

Trend symbols: `↓` improving, `↑` regressing, `=` stable (±5%).

### Intent: Baseline Comparison

Compare a specific run against the established baseline:

1. Read baseline from `run-history.json` entries where `"baseline": true`
2. Calculate delta for each metric
3. Flag regressions (metric worse than baseline by >10%)

```
Baseline Comparison — Run #5 vs Baseline:
| Metric          | Baseline | Current | Delta    | Status |
|-----------------|----------|---------|----------|--------|
| duration (min)  | 16.0     | 14.5    | -1.5     | GREEN  |
| tool_calls      | 150      | 130     | -20      | GREEN  |
| tokens (K)      | 300      | 270     | -30      | GREEN  |
| hook_violations | 0        | 0       | 0        | GREEN  |
| prompt_skeleton | 4/6      | 5/6     | +1       | GREEN  |
```

### Intent: Set Baseline

Mark a specific run as the baseline for its scenario:
1. Set `"baseline": true` on the run entry
2. Clear `"baseline"` from any previous baseline for that scenario
3. Confirm to user

## Threshold Definitions

Reference `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/references/metrics.md` for GREEN/YELLOW/RED thresholds per metric.
