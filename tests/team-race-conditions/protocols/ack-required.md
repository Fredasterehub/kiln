# Protocol: ACK Required

**ID**: `ack-required`
**Description**: Every message requires explicit acknowledgment. Sender blocks until ACK received.

## Rules

### Boss Behavior
1. Dispatch to worker 1 → STOP and wait for ACK
2. On ACK from worker 1 → dispatch to worker 2 → STOP and wait
3. Continue until all workers assigned
4. Then wait for TASK_COMPLETE replies (same counter pattern)
5. On each TASK_COMPLETE, send ACK back to worker
6. Timeout: if no ACK in 30s, re-send the dispatch once

### Worker Behavior
1. Bootstrap → send READY to boss → STOP
2. On assignment: immediately send ACK to boss
   ```
   ACK: msg_id={msg_id}, received_at={epoch_ms}
   ```
3. Then do work
4. Send TASK_COMPLETE to boss → STOP and wait for ACK
5. On ACK received → done, wait for shutdown

### Conductor Behavior
1. Create team → spawn workers first (background) → wait 2s → spawn boss
2. No WORKERS_SPAWNED message — workers self-announce via READY
3. Boss waits for all READY signals before dispatching

## Expected Failure Modes
- Slower throughput (serial dispatch)
- But much higher reliability — every message confirmed
- Potential deadlock if ACK is lost (mitigated by 30s timeout + retry)
- Higher message count (2x baseline)

## Message Format
All messages include:
- `msg_id`: UUID for dedup/tracking
- `ack_required: true` flag
- ACK messages: `ACK: msg_id={original_msg_id}, received_at={epoch_ms}`
