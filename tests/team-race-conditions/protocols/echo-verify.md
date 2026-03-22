# Protocol: Echo Verify

**ID**: `echo-verify`
**Description**: Recipient must echo back a hash of the message content. Sender retries if no echo within 15s. Strongest delivery guarantee.

## Rules

### Boss Behavior
1. Bootstrap → dispatch to workers with echo requirement
2. Each dispatch includes content hash:
   ```
   ASSIGNMENT: msg_id={uuid}, echo_hash={sha256_first8}, task=..., payload=...
   ```
3. After each dispatch, wait for ECHO from that worker (15s timeout)
4. On ECHO with matching hash → assignment confirmed, move to next worker
5. On timeout → re-send same message (max 3 retries)
6. After all echoes received → enter reply-wait phase
7. Collect TASK_COMPLETE replies → TEST_COMPLETE

### Worker Behavior
1. Bootstrap → STOP and wait
2. On assignment:
   - Compute echo hash of received content
   - Send ECHO immediately:
     ```
     ECHO: msg_id={msg_id}, echo_hash={computed_hash}, ts={epoch_ms}
     ```
   - Then do work
   - Send TASK_COMPLETE with result
3. On duplicate (same msg_id, already echoed) → re-send ECHO, skip work

### Conductor Behavior
1. Create team → spawn all → WORKERS_SPAWNED to boss
2. No active monitoring
3. Wait for TEST_COMPLETE

## Expected Failure Modes
- Slowest protocol — serial dispatch with echo round-trip per worker
- 3 retries × 15s timeout = 45s worst case per worker
- But: strongest delivery guarantee
- Hash mismatch = message corruption detected (shouldn't happen but logged)

## Message Format
- `echo_hash`: first 8 chars of SHA-256 of message content (computed via `echo -n "{content}" | sha256sum | cut -c1-8`)
- `ECHO: msg_id={id}, echo_hash={hash}, ts={epoch_ms}`
- Sender verifies echo_hash matches before proceeding
