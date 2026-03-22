# Protocol: Retry on Idle

**ID**: `retry-on-idle`
**Description**: Conductor monitors for idle agents and re-sends the last message to wake them up.

## Rules

### Boss Behavior
1. Bootstrap → dispatch to all workers
2. Log every send with timestamp to log file
3. Wait for replies with counter
4. If conductor sends RE_DISPATCH, re-process (idempotent — check if already handled via msg_id)
5. On all replies → TEST_COMPLETE

### Worker Behavior
1. Bootstrap → STOP and wait
2. On assignment → do work → reply
3. On duplicate assignment (same msg_id) → send ACK only, don't redo work
4. Log all received messages for dedup tracking

### Conductor Behavior
1. Create team → spawn all agents → WORKERS_SPAWNED to boss
2. Monitor: every 15s, check each agent's log file for last event
3. If any agent's last event > 30s ago AND test not complete:
   - Re-send last known message to that agent
   - Log: `{"event":"retry","target":"<agent>","reason":"idle_detected"}`
4. Max 3 retries per agent
5. Wait for TEST_COMPLETE or timeout

## Expected Failure Modes
- Retry may arrive when agent is actually working (long tool call)
- Duplicate processing if dedup not working
- But: recovers from most idle scenarios
- Conductor overhead reading log files

## Message Format
All messages include:
- `msg_id`: UUID for dedup
- Workers track seen msg_ids and skip duplicates
