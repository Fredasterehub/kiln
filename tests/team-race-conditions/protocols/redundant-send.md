# Protocol: Redundant Send

**ID**: `redundant-send`
**Description**: Every critical message sent twice with deduplication. Trades bandwidth for reliability.

## Rules

### Boss Behavior
1. Bootstrap → dispatch to all workers
2. For EACH dispatch, send the SAME message TWICE with same msg_id:
   ```
   SendMessage(recipient: worker, content: "ASSIGNMENT: msg_id={uuid}, attempt=1, ...")
   SendMessage(recipient: worker, content: "ASSIGNMENT: msg_id={uuid}, attempt=2, ...")
   ```
3. Wait for replies (only count unique msg_ids)
4. On all unique replies → TEST_COMPLETE

### Worker Behavior
1. Bootstrap → STOP and wait
2. Maintain seen_ids set (in memory/variable)
3. On assignment:
   - If msg_id already seen → send short ACK, skip work
   - If new → do work → reply with msg_id → add to seen_ids
4. Reply also sent twice (redundant)

### Conductor Behavior
1. Create team → spawn all → WORKERS_SPAWNED (sent twice) to boss
2. No active monitoring — redundancy is the mitigation
3. Wait for TEST_COMPLETE

## Expected Failure Modes
- 2x message volume
- Dedup logic must be bulletproof or double-processing occurs
- But: single message loss doesn't kill the test
- Effective against sporadic delivery failures

## Message Format
All messages include:
- `msg_id`: UUID (same for both copies)
- `attempt`: 1 or 2
- Recipients dedup on msg_id
