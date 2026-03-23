# Conductor Protocol — File-Based Handoff

Every conductor session is stateless. All state lives on disk. A session can crash at any point and the next session picks up exactly where it left off.

## State Files

All state under `/tmp/kiln-race-test/latest/`:

```
state.json              ← global run state (stage, survivors, eliminated)
stages.json             ← stage definitions (immutable after init)
queue.json              ← current batch queue (what to run next)
active/                 ← currently executing tests (inflight tracking)
  {test_id}.lock        ← lock file with PID + timestamp
{proto}-{topo}-{size}/  ← cell directories
  run-001.json          ← individual test results
  run-002.json
  ...
```

## Conductor Lifecycle

### 1. Boot (every session start)
```bash
./run-batch.sh resume     # Prints state, increments session counter
./run-batch.sh next       # Generates queue.json with next batch
```
The conductor reads `queue.json` — this is its ONLY input. It does NOT need to remember anything from prior sessions.

### 2. Execute (per test in queue)
```
For each test in queue.json:
  a. Write {test_id}.lock to active/       ← marks inflight
  b. TeamCreate
  c. Spawn agents per protocol
  d. Wait for TEST_COMPLETE or timeout
  e. Write result to {cell_dir}/run-NNN.json
  f. Remove {test_id}.lock from active/    ← marks complete
  g. Run: ./run-batch.sh result {id} {json}
```

### 3. Between batches
```bash
./run-batch.sh dropout    # SPRT check — may eliminate protocols
./run-batch.sh next       # Generates next queue.json
```
If `next` returns empty → stage complete → `./run-batch.sh advance`

### 4. Crash recovery
On boot, check `active/` for stale locks (timestamp > 5 min old). These are tests that were inflight when the prior session died. Re-queue them:
```bash
./run-batch.sh recover    # Moves stale locks back to queue
```

## Queue Format (`queue.json`)

```json
{
  "generated": "2026-03-23T...",
  "stage": 1,
  "batch_number": 4,
  "tests": [
    {
      "test_id": "naive-boss-worker-small/run-010",
      "cell_id": "naive-boss-worker-small",
      "protocol": "naive",
      "topology": "boss-worker",
      "size": "small",
      "worker_count": 1,
      "workers": "worker-1",
      "protocol_file": "/home/user/kiln/tests/team-race-conditions/protocols/naive.md",
      "team_name": "race-naive-bw-s-010"
    }
  ]
}
```

The conductor reads this file, iterates through `tests`, and executes each one. It does NOT generate test parameters itself — `run-batch.sh next` does that.

## Result Format (`run-NNN.json`)

```json
{
  "test_id": "naive-boss-worker-small/run-010",
  "protocol": "naive",
  "topology": "boss-worker",
  "size": "small",
  "completed": true,
  "wall_time_ms": 34521,
  "message_count": 4,
  "retry_count": 0,
  "idle_events": 0,
  "failure_mode": null,
  "started": "2026-03-23T14:32:01Z",
  "finished": "2026-03-23T14:32:36Z",
  "agent_results": {
    "test-boss": {
      "spawned_at_ms": 1711200721000,
      "first_action_ms": 1711200724200,
      "bootstrap_ms": 3200,
      "dispatch_time_ms": 1450,
      "total_time_ms": 33100
    },
    "worker-1": {
      "spawned_at_ms": 1711200721500,
      "first_action_ms": 1711200725100,
      "delivery_latency_ms": 2300,
      "work_time_ms": 890,
      "total_time_ms": 28400
    }
  }
}
```

## Lock Format (`active/{test_id}.lock`)

```json
{
  "test_id": "naive-boss-worker-small/run-010",
  "session": 2,
  "pid": 12345,
  "started": "2026-03-23T14:32:01Z",
  "team_name": "race-naive-bw-s-010"
}
```

## Conductor Rules

1. **Read queue.json, execute tests, write results. Nothing else.**
2. **Never carry test state in context.** If you need to know something, read it from disk.
3. **Log to disk, not to context.** All timing data goes to JSONL files, not to your message history.
4. **After each test completes, immediately write result.json.** Don't batch results.
5. **Between batches, run `dropout` before `next`.** This ensures eliminated protocols aren't queued.
6. **If a test times out (120s), write a failure result and move on.** Don't retry inline.
7. **If context is getting large (~40 tests), end session gracefully.** Run `status` to save progress, then next session picks up via `resume`.
8. **Maximum 3 concurrent teams.** Don't exceed this to avoid rate limits.

## Session Handoff Checklist

When ending a session:
```bash
./run-batch.sh status     # Verify all inflight tests completed
./run-batch.sh dropout    # Run final SPRT check
./run-batch.sh stage      # Print state for operator awareness
```

When starting next session:
```bash
./run-batch.sh recover    # Handle any crashed tests
./run-batch.sh resume     # Register session, print state
./run-batch.sh next       # Get next batch
```

The operator never needs to remember anything between sessions. The disk state is the single source of truth.
