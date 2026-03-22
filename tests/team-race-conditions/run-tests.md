# Race Condition Test Runner

This document is the orchestrator for the race condition test harness. It defines the full test matrix, execution logic, and result collection.

## Test Matrix

**120 test cases** = 10 protocols × 4 topologies × 3 sizes

### Protocols
1. `naive` — fire-and-forget, no confirmations
2. `ack-required` — explicit ACK on every message
3. `phased-strict` — current Kiln v6 three-phase ordering
4. `heartbeat` — periodic ALIVE pings
5. `retry-on-idle` — conductor re-sends on idle detection
6. `redundant-send` — every message sent twice with dedup
7. `watchdog` — dedicated supervisor agent
8. `confirmation-chain` — fully serial spawn with READY gates
9. `broadcast-wake` — WAKE/AWAKE handshake before dispatch
10. `echo-verify` — echo hash verification per message

### Topologies
1. `boss-worker` — standard hub-and-spoke
2. `chain` — serial relay A→B→C→boss
3. `fan-out-in` — rapid-fire dispatch, concurrent replies
4. `peer-mesh` — every agent messages every other (O(N²))

### Sizes
1. `small` — 2 agents (1 boss + 1 worker)
2. `medium` — 4 agents (1 boss + 3 workers)
3. `large` — 6 agents (1 boss + 5 workers)

## Execution Plan

### Phase 1: Setup (1 turn)
```bash
# Create results directory and log structure
export RACE_TEST_DIR="/tmp/kiln-race-test"
export RACE_TEST_RUN="run-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RACE_TEST_DIR/$RACE_TEST_RUN"

# Generate test manifest
cat <<'EOF' > "$RACE_TEST_DIR/$RACE_TEST_RUN/manifest.json"
{
  "run_id": "<run_id>",
  "started": "<iso_date>",
  "protocols": ["naive","ack-required","phased-strict","heartbeat","retry-on-idle","redundant-send","watchdog","confirmation-chain","broadcast-wake","echo-verify"],
  "topologies": ["boss-worker","chain","fan-out-in","peer-mesh"],
  "sizes": ["small","medium","large"],
  "total_tests": 120,
  "batch_size": 5,
  "timeout_per_test_s": 120
}
EOF
```

### Phase 2: Execute Tests (batches of 5)

For each batch of 5 test cases, run them as parallel Agent spawns:

```
For test_case in batch:
  test_id = "{protocol}-{topology}-{size}-{run_number}"
  log_dir = "$RACE_TEST_DIR/$RACE_TEST_RUN/{test_id}"

  1. mkdir -p {log_dir}
  2. TeamCreate(team_name="race-test-{test_id}")
  3. Write test config to {log_dir}/config.json
  4. Execute protocol-specific spawn sequence (see below)
  5. Wait for TEST_COMPLETE or timeout (120s)
  6. Collect results from {log_dir}/*.jsonl
  7. TeamDelete("race-test-{test_id}")
  8. Write {log_dir}/result.json
```

### Protocol-Specific Spawn Sequences

#### naive, fan-out-in
```
TeamCreate → spawn all workers (background, haiku) → spawn boss (background, haiku)
→ immediately send WORKERS_SPAWNED to boss
→ wait for TEST_COMPLETE
```

#### ack-required
```
TeamCreate → spawn all workers (background, haiku) → wait 2s
→ spawn boss (background, haiku)
→ boss waits for READY from each worker before dispatching
→ wait for TEST_COMPLETE
```

#### phased-strict
```
TeamCreate → spawn boss (background, haiku)
→ boss sends REQUEST_WORKERS → conductor spawns workers
→ send WORKERS_SPAWNED to boss
→ wait for TEST_COMPLETE
```

#### heartbeat
```
TeamCreate → spawn all agents (background, haiku)
→ WORKERS_SPAWNED to boss
→ monitor heartbeats, nudge idle agents
→ wait for TEST_COMPLETE
```

#### retry-on-idle
```
TeamCreate → spawn all agents (background, haiku)
→ WORKERS_SPAWNED to boss
→ every 15s: check logs, re-send to idle agents
→ wait for TEST_COMPLETE
```

#### redundant-send
```
TeamCreate → spawn all agents (background, haiku)
→ WORKERS_SPAWNED sent TWICE to boss
→ wait for TEST_COMPLETE
```

#### watchdog
```
TeamCreate → spawn watchdog (background, haiku) → spawn workers (background, haiku)
→ spawn boss (background, haiku)
→ WORKERS_SPAWNED to boss
→ watchdog monitors independently
→ wait for TEST_COMPLETE
```

#### confirmation-chain
```
TeamCreate → spawn worker-1 (background, haiku) → wait for READY
→ spawn worker-2 → wait for READY → ... → spawn boss last
→ boss gets confirmed-ready list in runtime prompt
→ wait for TEST_COMPLETE
```

#### broadcast-wake
```
TeamCreate → spawn all agents (background, haiku)
→ WORKERS_SPAWNED to boss
→ boss sends WAKE to each worker, waits for AWAKE
→ then dispatches real work
→ wait for TEST_COMPLETE
```

#### echo-verify
```
TeamCreate → spawn all agents (background, haiku)
→ WORKERS_SPAWNED to boss
→ boss sends with echo_hash, waits for ECHO per worker
→ retries on timeout
→ wait for TEST_COMPLETE
```

### Phase 3: Collect Results

After each test, write `{log_dir}/result.json`:
```json
{
  "test_id": "naive-boss-worker-small-001",
  "protocol": "naive",
  "topology": "boss-worker",
  "size": "small",
  "completed": true,
  "wall_time_ms": 15234,
  "agent_count": 2,
  "message_count": 4,
  "retry_count": 0,
  "idle_events": 0,
  "failure_mode": null,
  "agent_results": {
    "test-boss": { "bootstrap_ms": 1200, "dispatch_time_ms": 340, "total_time_ms": 14800 },
    "worker-1": { "bootstrap_ms": 980, "delivery_latency_ms": 2100, "work_time_ms": 450 }
  }
}
```

### Phase 4: Analyze

Run `analyze.sh` to generate:
1. **Protocol ranking table** — sorted by completion rate, then by avg wall time
2. **Failure mode breakdown** — which protocols suffer which failure modes
3. **Topology impact matrix** — how topology affects each protocol's reliability
4. **Size scaling analysis** — how reliability degrades as team size grows
5. **Recommended protocol** — best balance of reliability and performance

## Runtime Prompt Templates

### Boss Runtime Prompt
```
You are "{boss_name}" on team "race-test-{test_id}".
Working dir: {working_dir}

PROTOCOL: {protocol_id}
Read your protocol file at: {protocol_path}
TOPOLOGY: {topology_id}
WORKERS: {worker_list}
TEST_ID: {test_id}
LOG_DIR: {log_dir}

Your task: dispatch work to your workers per the protocol, collect replies,
report TEST_COMPLETE to team-lead. Log ALL timing data to your JSONL file.

Assignment for workers: "Read the file at /tmp/kiln-race-test/canary.txt
and reply with its contents plus your timing metadata."
```

### Worker Runtime Prompt
```
You are "{worker_name}" on team "race-test-{test_id}".
Working dir: {working_dir}

PROTOCOL: {protocol_id}
Read your protocol file at: {protocol_path}
TEST_ID: {test_id}
LOG_DIR: {log_dir}
BOSS_NAME: {boss_name}

Read team-protocol-test.md at: {test_protocol_path}
Wait for assignment. Log ALL timing data to {log_dir}/{test_id}/{your_name}.jsonl.
```

### Watchdog Runtime Prompt (watchdog protocol only)
```
You are "watchdog" on team "race-test-{test_id}".
Working dir: {working_dir}

MONITORED_AGENTS: {all_agent_names}
BOSS_NAME: {boss_name}
TEST_ID: {test_id}
LOG_DIR: {log_dir}
CHECK_INTERVAL_MS: 10000
IDLE_THRESHOLD_MS: 20000

Monitor all agents by reading their JSONL logs. Nudge any that go idle.
```

## Canary File

Before tests begin, create a simple canary file that workers "process":
```bash
echo "CANARY: $(date +%s%3N)" > /tmp/kiln-race-test/canary.txt
```

This gives workers a trivial, deterministic task (read file, reply with contents) so we isolate communication timing from actual work complexity.

## Priority Order

If running subset (cost/time constraints), prioritize:
1. All 10 protocols × boss-worker × small (10 tests) — baseline comparison
2. Top 3 protocols × all topologies × small (12 tests) — topology sensitivity
3. Top 3 protocols × boss-worker × all sizes (9 tests) — scaling behavior
4. Full matrix for top 2 protocols (24 tests) — deep dive

Minimum viable test: 10 tests (step 1 only). Full suite: 120 tests.
