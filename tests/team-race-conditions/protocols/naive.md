# Protocol: Naive (Fire-and-Forget)

**ID**: `naive`
**Description**: Baseline worst-case protocol. No confirmations, no retries, no health checks.

## Rules

### Boss Behavior
1. Spawn complete → immediately dispatch to ALL workers in rapid succession
2. No waiting between dispatches
3. No ACK expected from workers before sending next
4. After all dispatches, wait for replies with simple counter
5. No retry on timeout — just log failure after 60s

### Worker Behavior
1. Bootstrap → immediately STOP and wait (no READY signal)
2. On assignment: process immediately, reply immediately
3. No ACK, no echo, no heartbeat
4. Single reply, then STOP

### Conductor Behavior
1. Create team → spawn all agents simultaneously
2. Send WORKERS_SPAWNED to boss immediately after spawn calls return
3. No health monitoring
4. Wait for TEST_COMPLETE or timeout

## Expected Failure Modes
- Workers may not be ready when boss dispatches (spawn race)
- Boss may go idle if WORKERS_SPAWNED arrives after it already processed all other messages
- No recovery from lost messages
- High idle event rate expected

## Message Format
Standard (no extra fields). No dedup ID, no ACK flag, no sequence number.
