# Protocol: Watchdog

**ID**: `watchdog`
**Description**: Dedicated supervisor agent monitors all others and nudges idle agents.

## Rules

### Boss Behavior
1. Bootstrap → dispatch to all workers normally
2. Wait for replies with counter
3. If watchdog sends NUDGE → re-check state, re-send if needed
4. On all replies → TEST_COMPLETE

### Worker Behavior
1. Bootstrap → write timestamp to log file → STOP
2. On assignment → write timestamp → do work → write timestamp → reply
3. All work logged to individual JSONL file for watchdog to read

### Watchdog Behavior (test-watchdog agent)
1. Bootstrap → announce READY to team-lead
2. Enter monitor loop:
   - Read each agent's JSONL log file via Bash
   - Check last event timestamp
   - If agent idle > 20s → send NUDGE to that agent
   - If agent idle > 40s → send ALERT to boss with idle agent name
   - Log all checks
3. Continue until TEST_COMPLETE signal from boss or shutdown

### Conductor Behavior
1. Create team
2. Spawn watchdog first (background)
3. Spawn workers (background)
4. Spawn boss (background)
5. WORKERS_SPAWNED to boss (includes watchdog in list)
6. Wait for TEST_COMPLETE

## Expected Failure Modes
- Watchdog itself can go idle (who watches the watchdog?)
- Extra agent = extra cost and message overhead
- But: active recovery from idle states
- Watchdog reads log files = filesystem dependency

## Message Format
- `NUDGE: target={name}, reason=idle_{seconds}s, last_event={event_type}`
- `ALERT: idle_agent={name}, idle_duration_ms={ms}` (sent to boss)
- Standard assignment/reply otherwise
