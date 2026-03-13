# W3: Test — Run Smoke Test Scenario

Launch a smoke test scenario against the Kiln pipeline. Scenarios use pre-seeded .kiln/ artifacts to skip interactive steps and test specific pipeline segments.

## Prerequisites

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/references/metrics.md` for metric definitions and thresholds.

## Available Scenarios

| ID | Name | Tests | Timeout | Seed State |
|----|------|-------|---------|------------|
| S1 | Research Only | MI6 + field agents, progressive synthesis | 10 min | Steps 1-2 complete |
| S5 | Build Cycle | KRS-One, codex, sphinx, rakim, sentinel, hooks | 20 min | Steps 1-4 complete |
| S6 | Full Autonomous | Steps 3-7 end to end | 60 min | Steps 1-2 complete |

## Workflow

### Step 1: Select Scenario

If the user specified a scenario (S1/S5/S6), use it. Otherwise, list available scenarios and ask.

Read the scenario directory:
```
${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/scenarios/{scenario_id}/
├── seed/          # Pre-seeded .kiln/ directory
├── prompt.md      # What to tell the pipeline
└── expect.json    # Artifact checks and metric targets
```

### Step 2: Prepare Workspace

1. Create a temporary workspace:
   ```bash
   WORKSPACE=$(mktemp -d /tmp/kiln-test-XXXXXX)
   ```

2. Copy seed data:
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/scenarios/{scenario_id}/seed/.kiln "$WORKSPACE/"
   ```

3. Initialize git repo:
   ```bash
   cd "$WORKSPACE" && git init && git add -A && git commit -m "Seed state for scenario {scenario_id}"
   ```

### Step 3: Launch Test

**Option A — TUI runner** (when kiln-test binary is available):
```bash
kiln-test run --scenario {scenario_id} --workspace "$WORKSPACE"
```

**Option B — Manual `claude -p` fallback**:
```bash
PROMPT=$(cat ${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/scenarios/{scenario_id}/prompt.md)
cd "$WORKSPACE"
timeout {timeout_seconds} claude -p "$PROMPT" \
  --output-format stream-json \
  --plugin-dir ${CLAUDE_PLUGIN_ROOT}/.. \
  --dangerously-skip-permissions \
  2>&1 | tee /tmp/kiln-test-output.jsonl
```

Record start time. The output is a stream of JSON events.

### Step 4: Collect Results

After the run completes (or times out):

1. **Check artifacts** — verify expected files from `expect.json`:
   ```json
   {
     "artifacts": [
       {"path": ".kiln/docs/research.md", "exists": true, "min_lines": 10},
       {"path": ".kiln/docs/codebase-state.md", "exists": true, "header": "<!-- status: complete -->"}
     ]
   }
   ```

2. **Parse metrics** from stream-json output (if available):
   - Total duration
   - Agent spawn count
   - Tool call count
   - Token usage (from result events)
   - Error/retry count

3. **Check compliance** from `expect.json`:
   ```json
   {
     "compliance": [
       {"name": "prompt_skeleton", "check": "codex prompt has ≥4/6 skeleton sections", "target": true},
       {"name": "hook_violations", "check": "zero hook blocks in output", "target": 0},
       {"name": "delegation", "check": "codex never used Write/Edit", "target": true}
     ]
   }
   ```

### Step 5: Report Results

Display results table:
```
╔══════════════════════════════════════════════╗
║  KILN FORGE — Scenario {id} Results          ║
╚══════════════════════════════════════════════╝

Duration: 14m 32s (target: ≤20m)
Artifacts: 8/8 present
Compliance: 3/3 passed

Metrics:
  agents_spawned .......... 7
  tool_calls .............. 142
  tokens_used ............. 284,000
  hook_violations ......... 0
  correction_cycles ....... 0
  prompt_skeleton ......... 5/6

Baseline comparison:
  duration ................ -2m 10s (↓ faster)
  tool_calls .............. +12 (↑ more)
  tokens .................. -31,000 (↓ less)
```

### Step 6: Record

Append to `run-history.json`:
```json
{
  "timestamp": "{ISO 8601}",
  "scenario": "{scenario_id}",
  "duration_seconds": 872,
  "result": "pass|fail|timeout",
  "artifacts_found": 8,
  "artifacts_expected": 8,
  "compliance_passed": 3,
  "compliance_total": 3,
  "metrics": { ... },
  "workspace": "{path}",
  "notes": ""
}
```

### Step 7: Cleanup

Ask the user if they want to keep the workspace for inspection or clean it up:
```bash
rm -rf "$WORKSPACE"
```
