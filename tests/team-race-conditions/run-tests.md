# Race Condition Test Runner — Conductor Guide

This is the instruction manual for the conductor (your Claude Code session). The conductor is stateless — all state lives on disk. You can crash, resume in a new session, and pick up exactly where you left off.

## Quick Start

```bash
cd /home/user/kiln/tests/team-race-conditions

# First time only:
./run-batch.sh init

# Every session (including first):
./run-batch.sh resume       # register session, print state
./run-batch.sh next         # writes queue.json with next batch
# Execute tests from queue.json (see below)
./run-batch.sh dropout      # SPRT elimination check
./run-batch.sh status       # progress overview
```

## The Conductor Loop

This is your entire job. Repeat until `next` returns empty.

### Step 1: Read the queue
```bash
./run-batch.sh next --count 3
```
This writes `queue.json` to the run directory. Read it. It contains 3 test definitions.

### Step 2: Execute each test

For each test in `queue.json`, in sequence (or up to 3 in parallel):

```
a. Read test config from queue.json (protocol, topology, size, workers, team_name)
b. ./run-batch.sh lock {test_id}
c. TeamCreate(team_name="{team_name}")
d. Spawn agents per protocol (see Protocol Spawn Sequences below)
e. Wait for TEST_COMPLETE signal or 120s timeout
f. Collect timing data from agent messages
g. Write result: ./run-batch.sh result {test_id} '{json}'
h. TeamDelete("{team_name}")
i. ./run-batch.sh unlock {test_id}
```

### Step 3: Check for dropouts
```bash
./run-batch.sh dropout
```
Prints any protocols eliminated by SPRT rules. Eliminated protocols won't appear in future `next` calls.

### Step 4: Next batch or advance
```bash
./run-batch.sh next         # more tests in current stage?
# If empty:
./run-batch.sh advance      # move to next stage
./run-batch.sh next         # first batch of new stage
```

### Step 5: End of session
When context is getting large (~40 tests executed), end gracefully:
```bash
./run-batch.sh status       # verify no locks remain
```
Next session starts with `resume` + `recover` + `next`. Zero state lost.

## Protocol Spawn Sequences

Each protocol has a different spawn pattern. Read the protocol file from `queue.json.tests[].protocol_file` for full rules. Summary:

### naive, fan-out-in
```
TeamCreate → spawn all workers (background, haiku) → spawn boss (background, haiku)
→ SendMessage WORKERS_SPAWNED to boss immediately
→ wait for TEST_COMPLETE
```

### ack-required
```
TeamCreate → spawn all workers (background, haiku)
→ workers self-announce READY to boss
→ spawn boss (background, haiku) — waits for READY signals before dispatching
→ wait for TEST_COMPLETE
```

### phased-strict
```
TeamCreate → spawn boss (background, haiku)
→ boss sends REQUEST_WORKERS → conductor spawns workers
→ SendMessage WORKERS_SPAWNED to boss
→ wait for TEST_COMPLETE
```

### heartbeat
```
TeamCreate → spawn all agents (background, haiku)
→ SendMessage WORKERS_SPAWNED to boss
→ monitor HEARTBEAT messages from agents
→ nudge any agent missing heartbeat >20s
→ wait for TEST_COMPLETE
```

### retry-on-idle
```
TeamCreate → spawn all agents (background, haiku)
→ SendMessage WORKERS_SPAWNED to boss
→ every 15s: read agent JSONL logs, re-send last message to idle agents
→ wait for TEST_COMPLETE
```

### redundant-send
```
TeamCreate → spawn all agents (background, haiku)
→ SendMessage WORKERS_SPAWNED to boss (send TWICE, same content)
→ wait for TEST_COMPLETE
```

### watchdog
```
TeamCreate → spawn watchdog (background, haiku) → spawn workers (background, haiku)
→ spawn boss (background, haiku)
→ SendMessage WORKERS_SPAWNED to boss
→ watchdog monitors independently via log files
→ wait for TEST_COMPLETE
```

### confirmation-chain
```
TeamCreate → spawn worker-1 (background, haiku) → wait for READY
→ on READY: spawn worker-2 → wait for READY
→ ... repeat for all workers
→ spawn boss last with confirmed-ready list in runtime prompt
→ wait for TEST_COMPLETE
```

### broadcast-wake
```
TeamCreate → spawn all agents (background, haiku)
→ SendMessage WORKERS_SPAWNED to boss
→ boss sends WAKE to each worker, collects AWAKE replies
→ then dispatches real work
→ wait for TEST_COMPLETE
```

### echo-verify
```
TeamCreate → spawn all agents (background, haiku)
→ SendMessage WORKERS_SPAWNED to boss
→ boss sends assignment with echo_hash per worker
→ waits for ECHO response, retries on 15s timeout
→ wait for TEST_COMPLETE
```

## Runtime Prompt Templates

### Boss
```
You are "test-boss" on team "{team_name}". Working dir: {cwd}.

PROTOCOL: {protocol}
Read your protocol file at: {protocol_file}
TOPOLOGY: {topology}
WORKERS: {workers}
TEST_ID: {test_id}
LOG_DIR: {log_dir}

Your task: dispatch work to your workers per the protocol, collect replies,
then signal TEST_COMPLETE to team-lead. Log ALL timing to {log_dir}/test-boss.jsonl.

Worker assignment: "Read /tmp/kiln-race-test/canary.txt, reply with contents + timing metadata."
```

### Worker
```
You are "{worker_name}" on team "{team_name}". Working dir: {cwd}.

PROTOCOL: {protocol}
Read your protocol file at: {protocol_file}
TEST_ID: {test_id}
LOG_DIR: {log_dir}
BOSS_NAME: test-boss

Wait for assignment from test-boss. Do the assigned work. Reply with timing metadata.
Log ALL events to {log_dir}/{worker_name}.jsonl.
```

### Watchdog (watchdog protocol only)
```
You are "watchdog" on team "{team_name}". Working dir: {cwd}.

MONITORED_AGENTS: {all_agent_names}
BOSS_NAME: test-boss
TEST_ID: {test_id}
LOG_DIR: {log_dir}
IDLE_THRESHOLD_MS: 20000

Monitor agents by reading their JSONL logs. Nudge idle ones via SendMessage.
Log checks to {log_dir}/watchdog.jsonl.
```

## Result JSON Format

When a test completes (or times out), record via:
```bash
./run-batch.sh result "{test_id}" '{"test_id":"...","protocol":"...","topology":"...","size":"...","completed":true/false,"wall_time_ms":N,"message_count":N,"retry_count":N,"idle_events":N,"failure_mode":null/"idle_death"/"message_lost"/"spawn_race"/"timeout"/"session_crash"}'
```

## Adaptive Staging

| Stage | What | Tests per cell | SPRT Dropouts |
|-------|------|---------------|---------------|
| 1. Screening | 10 protocols × boss-worker × small | 20 | ≥4/5, ≥6/10, ≥7/15, ≥8/20 |
| 2. Topology | survivors × 4 topos × small | 20 | ≥5/10, ≥7/20 per topology |
| 3. Scale | survivors × boss-worker × 3 sizes | 30 | ≥6/15, ≥9/30 per size |
| 4. Deep | top 2 × full matrix | 30 | none (final validation) |

The `dropout` command runs SPRT checks automatically. The `advance` command handles stage transitions including auto-ranking to top 2 for Stage 4.

## Context Management

- **Never carry state in your message history.** Read from disk.
- **After each test, write result immediately.** Don't batch.
- **After ~40 tests, end session.** Run `status`, then new session picks up via `resume`.
- **If you crash, next session runs `recover`** to handle inflight tests.

The disk is the source of truth. Your context window is disposable.
