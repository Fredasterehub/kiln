# Protocol: Heartbeat

**ID**: `heartbeat`
**Description**: Agents send periodic ALIVE pings. Conductor detects dead agents and can intervene.

## Rules

### Boss Behavior
1. Bootstrap → begin dispatch
2. After dispatching all workers, enter heartbeat loop:
   - Every 10s, send HEARTBEAT to team-lead: `HEARTBEAT: boss={name}, ts={epoch_ms}, pending_replies={count}`
   - Process any incoming reply, decrement counter
   - If counter == 0 → TEST_COMPLETE
3. Timeout: if self idle >30s with no incoming message, send self-nudge via HEARTBEAT

### Worker Behavior
1. Bootstrap → send ALIVE to team-lead
2. On assignment → send HEARTBEAT before starting work
3. Do work
4. Send TASK_COMPLETE to boss
5. Send final HEARTBEAT to team-lead
6. STOP

### Conductor Behavior
1. Create team → spawn all agents
2. Track HEARTBEAT messages per agent
3. If any agent missing heartbeat for >20s:
   - Send nudge: `NUDGE: {agent}, reason=heartbeat_timeout`
4. If agent missing for >45s: log as idle_death
5. WORKERS_SPAWNED to boss after all spawned

## Expected Failure Modes
- Heartbeat adds message overhead
- Conductor becomes bottleneck processing heartbeats
- But: dead agents detected quickly
- False positives if agent is legitimately working (long tool call)

## Message Format
- `HEARTBEAT: agent={name}, ts={epoch_ms}, state={bootstrapping|working|idle|done}, context={details}`
- `ALIVE: agent={name}, ts={epoch_ms}` (initial announcement)
- `NUDGE: target={name}, reason={reason}`
