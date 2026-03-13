# Smoke Test Scenarios

Pre-seeded workspaces for testing specific pipeline segments. Most scenarios start at Step 3+, but S8 adds headless overrides so it can isolate all seven steps.

## Available Scenarios

| ID | Name | Starts At | Tests | Timeout |
|----|------|-----------|-------|---------|
| S1 | Research Only | Step 3 | MI6, field agents, synthesis | 10 min |
| S5 | Build Cycle | Step 5 | KRS-One, codex, sphinx, rakim, sentinel, hooks | 20 min |
| S6 | Full Autonomous | Step 3 | Steps 3-7 end to end | 60 min |
| S8 | Step-Isolated Relay | Step 1 | All 7 steps, each in its own seeded workspace | 25 min |

## Seed Data Source

All scenarios use artifacts from `/DEV/finalkiln/.kiln/` — the cleanest completed run (ST10: 4 milestones, 0 corrections).

## Usage

### Manual setup + run

```bash
# 1. Set up workspace
WORKSPACE=$(mktemp -d /tmp/kiln-test-XXXXXX)
bash scenarios/s5-build-cycle/seed/setup.sh "$WORKSPACE"

# 2. Run pipeline
cd "$WORKSPACE"
claude -p "Resume the Kiln pipeline from current state." \
  --output-format stream-json \
  --plugin-dir /DEV/kilntop/plugin \
  --dangerously-skip-permissions \
  2>&1 | tee /tmp/kiln-test-output.jsonl

# 3. Check results against expect.json
```

### Via kiln-forge w3-test workflow

Tell kiln-forge: "Run the S5 build cycle scenario"

### Via TUI (when available)

```bash
kiln-test run --scenario S5
```

## Scenario Structure

```
scenarios/{id}/
├── seed/
│   └── setup.sh       # Creates workspace with seeded .kiln/ directory
├── prompt.md           # Input prompt for the pipeline
└── expect.json         # Expected artifacts, compliance checks, metric targets
```

S8 expands this with `seed/golden/`, per-step setup wrappers, per-step prompts, and a `run-relay.sh` orchestrator.

## Adding New Scenarios

1. Create directory: `scenarios/{id}/`
2. Write `seed/setup.sh` — copies appropriate artifacts from source, writes STATE.md
3. Write `prompt.md` — usually "Resume the Kiln pipeline from current state."
4. Write `expect.json` — define artifact checks, compliance rules, metric targets
5. Update this README
