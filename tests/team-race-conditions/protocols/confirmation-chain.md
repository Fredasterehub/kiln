# Protocol: Confirmation Chain

**ID**: `confirmation-chain`
**Description**: Fully serial spawn. Each agent confirms READY before the next is spawned. Maximum safety, minimum parallelism.

## Rules

### Boss Behavior
1. Spawned LAST (after all workers confirm READY)
2. Receives list of confirmed-ready workers in runtime prompt
3. Dispatches to all workers (they're guaranteed alive)
4. Wait for replies → TEST_COMPLETE

### Worker Behavior
1. Bootstrap → send READY to team-lead with timestamp
2. Wait for assignment from boss
3. On assignment → do work → reply
4. STOP after reply

### Conductor Behavior
1. Create team
2. Spawn worker 1 → wait for READY
3. On READY → spawn worker 2 → wait for READY
4. ... repeat for all workers
5. After ALL workers confirmed READY → spawn boss with full ready-list
6. WORKERS_SPAWNED to boss (redundant but consistent)
7. Wait for TEST_COMPLETE

## Expected Failure Modes
- SLOW — fully serial spawn, O(n) spawn time
- If any worker fails to READY, entire chain blocks
- Timeout per worker: 30s, then skip and log failure
- But: zero spawn races — every agent confirmed alive before next
- Boss guaranteed to find all workers ready

## Message Format
- `READY: agent={name}, ts={epoch_ms}` (from each worker)
- Standard assignment/reply after boss dispatches
