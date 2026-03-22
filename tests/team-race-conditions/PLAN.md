# Race Condition Test Harness — Plan

## Problem Statement

Claude Code's team primitives (TeamCreate, SendMessage, Agent) have timing-sensitive behavior:
1. **SendMessage is fire-and-forget** — no delivery confirmation
2. **Agents wake with one message at a time** — ordering not guaranteed
3. **Agents can go idle** if they process all messages and have nothing left
4. **No built-in heartbeat** — idle agents are invisible to the conductor
5. **REQUEST_WORKERS race** — boss goes idle after requesting workers (Kiln already patches this with WORKERS_SPAWNED confirmation)

## Test Design

### Dimensions (10 protocols × 4 topologies × 3 team sizes = 120 test cases)

**10 Protocols:**
| # | Protocol | Description |
|---|----------|-------------|
| 1 | `naive` | Fire-and-forget. No confirmations. Baseline worst case. |
| 2 | `ack-required` | Every message requires explicit ACK reply before sender continues. |
| 3 | `phased-strict` | Current Kiln approach: strict A→B→C phase ordering, WORKERS_SPAWNED confirmation. |
| 4 | `heartbeat` | Agents send periodic "ALIVE" pings to conductor every N seconds. |
| 5 | `retry-on-idle` | Conductor detects idle (no response in 30s), re-sends last message. |
| 6 | `redundant-send` | Every critical message sent twice with dedup ID. |
| 7 | `watchdog` | Extra supervisor agent monitors all others, nudges idle ones. |
| 8 | `confirmation-chain` | Each agent confirms READY before next is spawned. Fully serial. |
| 9 | `broadcast-wake` | Send broadcast "WAKE" to all agents before dispatching work. |
| 10 | `echo-verify` | Recipient must echo back message hash. Sender retries if no echo in 15s. |

**4 Communication Topologies:**
| Topology | Pattern |
|----------|---------|
| `boss-worker` | Boss dispatches to 1+ workers, workers reply to boss |
| `chain` | A→B→C→...→boss (serial relay) |
| `fan-out-in` | Boss→all workers simultaneously, all reply to boss |
| `peer-mesh` | Every agent messages every other agent (stress test) |

**3 Team Sizes:**
- Small: 2 agents (1 boss + 1 worker)
- Medium: 4 agents (1 boss + 3 workers)
- Large: 6 agents (1 boss + 5 workers)

### What We Measure

Per test case:
- **completion**: did all agents finish their task? (bool)
- **idle_events**: how many times an agent went idle unexpectedly (count)
- **wall_time_ms**: total time from team creation to all-done signal
- **message_count**: total SendMessage calls made
- **retry_count**: messages that needed re-sending
- **message_latency_ms**: time between send and recipient wake-up (avg, p50, p95, p99)
- **agent_idle_time_ms**: total time agents spent idle when they shouldn't have been
- **failure_mode**: categorized failure type if incomplete (idle_death, message_lost, spawn_race, etc.)

### Agent Design (Haiku — Cost Minimization)

All test agents use `model: haiku`. Each agent has a simple, deterministic task:
1. Receive assignment message
2. Do minimal "work" (read a small file, write a timestamp)
3. Reply with result + timing metadata
4. Handle shutdown

Agents log timestamps to `/tmp/kiln-race-test/{test_id}/{agent_name}.jsonl` for post-hoc analysis.

### File Structure

```
tests/team-race-conditions/
├── PLAN.md                          # This file
├── run-tests.md                     # Skill: orchestrates all 120 test cases
├── protocols/                       # Protocol definitions (instructions per protocol)
│   ├── naive.md
│   ├── ack-required.md
│   ├── phased-strict.md
│   ├── heartbeat.md
│   ├── retry-on-idle.md
│   ├── redundant-send.md
│   ├── watchdog.md
│   ├── confirmation-chain.md
│   ├── broadcast-wake.md
│   └── echo-verify.md
├── agents/                          # Haiku test agent definitions
│   ├── test-boss.md                 # Boss agent (dispatches work)
│   ├── test-worker.md               # Worker agent (receives + executes)
│   └── test-watchdog.md             # Watchdog agent (monitors others)
├── topologies/                      # Topology configs
│   ├── boss-worker.json
│   ├── chain.json
│   ├── fan-out-in.json
│   └── peer-mesh.json
├── analyze.sh                       # Parse results, generate summary table
└── results/                         # Test output (gitignored)
    └── .gitkeep
```

### Execution Strategy

Run in batches of 5 concurrent teams to avoid overwhelming the platform:
- Batch 1: tests 1-5 (parallel)
- Batch 2: tests 6-10 (parallel)
- ... (24 batches total)

Each test has a 120-second timeout. Failed tests are retried once.

Total estimated cost: ~120 tests × ~6 Haiku agents avg × ~2K tokens each = ~1.4M Haiku tokens ≈ $0.35

### Expected Outcomes

1. **Quantified failure rates** per protocol under each topology
2. **Ranked protocols** by reliability (completion rate) and efficiency (wall time, message overhead)
3. **Identified failure modes** with reproduction steps
4. **Recommended protocol** for Kiln v7 team communication
5. **Platform feedback** — specific bugs/limitations to report to Anthropic
