# Protocol: Broadcast Wake

**ID**: `broadcast-wake`
**Description**: Send a WAKE broadcast to all agents before dispatching real work. Ensures everyone is listening.

## Rules

### Boss Behavior
1. Bootstrap → receive WORKERS_SPAWNED
2. Send WAKE to EACH worker individually:
   ```
   WAKE: test_id={id}, boss={name}, ts={epoch_ms}. Reply AWAKE to confirm.
   ```
3. Wait for AWAKE from each worker (track count)
4. Once all AWAKE received → dispatch real assignments
5. Wait for TASK_COMPLETE replies → TEST_COMPLETE

### Worker Behavior
1. Bootstrap → STOP and wait
2. On WAKE → reply AWAKE immediately:
   ```
   AWAKE: agent={name}, ts={epoch_ms}, wake_latency_ms={delta}
   ```
3. STOP and wait for real assignment
4. On assignment → do work → reply to boss
5. STOP after reply

### Conductor Behavior
1. Create team → spawn all agents (background)
2. WORKERS_SPAWNED to boss
3. No active monitoring — WAKE/AWAKE handles readiness
4. Wait for TEST_COMPLETE

## Expected Failure Modes
- Extra round-trip before real work begins
- If worker not ready for WAKE, same problem as naive (but one message earlier)
- AWAKE confirms agent is alive at that moment, but could go idle before assignment arrives
- Moderate overhead (N extra messages for wake, N for awake)

## Message Format
- `WAKE: test_id={id}, boss={name}, ts={epoch_ms}`
- `AWAKE: agent={name}, ts={epoch_ms}, wake_latency_ms={delta}`
- Standard assignment/reply after wake phase
