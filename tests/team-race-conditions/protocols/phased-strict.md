# Protocol: Phased Strict (Current Kiln Protocol)

**ID**: `phased-strict`
**Description**: Strict three-phase ordering. Current Kiln v6 approach. Workers only exist after boss requests them.

## Rules

### Boss Behavior
1. Bootstrap → read protocol files → wait for context
2. Send REQUEST_WORKERS to team-lead with worker list
3. Wait for WORKERS_SPAWNED confirmation from conductor
4. On WORKERS_SPAWNED → dispatch assignments one message per worker
5. STOP after dispatch, track reply count
6. Process replies ONE AT A TIME
7. After all replies → signal TEST_COMPLETE to team-lead

### Worker Behavior
1. Bootstrap (spawned by conductor after REQUEST_WORKERS)
2. Wait for assignment from boss — do NOT act until received
3. On assignment → do work → reply to boss
4. STOP after reply

### Conductor Behavior
1. Create team
2. Spawn boss in foreground (no persistent minds in test)
3. On REQUEST_WORKERS → spawn each worker (background)
4. Send WORKERS_SPAWNED to boss with list of spawned workers
5. Wait for TEST_COMPLETE

## Expected Failure Modes
- REQUEST_WORKERS race: boss sends request then goes idle before conductor processes it
- WORKERS_SPAWNED may arrive when boss isn't listening
- Workers spawned but boss already idle — needs conductor nudge
- Moderate reliability — the WORKERS_SPAWNED confirmation helps

## Message Format
Standard Kiln protocol signals:
- `REQUEST_WORKERS: {list}`
- `WORKERS_SPAWNED: {list}. All idle and awaiting assignment.`
- Standard assignment/reply format
