# Duo Pool — Worker Naming Rotation

This reference defines the legal builder+reviewer pairs krs-one selects from when emitting `CYCLE_WORKERS` during Step 5 (Build). Consumer: the boss on spawn, running at xhigh — it reads this file with literal precision, so every duo_id, name, and type below must match the strings the engine and boss agree on at spawn time.

## Selection Rules

Krs-one picks a pool per cycle using this decision tree:

1. UI/visual work → `ui` pool
2. `codex_available=true` → `default` pool
3. Otherwise → `fallback` pool

Within the chosen pool, the boss picks a duo via timestamp-seeded rotation. The engine then spawns both agents using the boss-selected names and the types listed in the pool table.

**Name vs type — the subtle bit.** The spawn `name` (e.g. `tintin`) is who the agent IS this cycle and is the only address SendMessage routes on. The `subagent_type` (e.g. `dial-a-coder`) is the `.md` template the spawn loads behavior from. They are not interchangeable: routing by type, or using a type where a name is expected, produces silent delivery failures that surface only as deadlock.

## Pool Table

| Pool | Duo ID | Builder Name | Reviewer Name | Builder Type | Reviewer Type |
|---|---|---|---|---|---|
| `default` | `codex-sphinx` | `codex` | `sphinx` | `dial-a-coder` | `critical-thinker` |
| `default` | `tintin-milou` | `tintin` | `milou` | `dial-a-coder` | `critical-thinker` |
| `default` | `mario-luigi` | `mario` | `luigi` | `dial-a-coder` | `critical-thinker` |
| `default` | `lucky-luke` | `lucky` | `luke` | `dial-a-coder` | `critical-thinker` |
| `fallback` | `kaneda-tetsuo` | `kaneda` | `tetsuo` | `backup-coder` | `critical-thinker` |
| `fallback` | `athos-porthos` | `athos` | `porthos` | `backup-coder` | `critical-thinker` |
| `ui` | `clair-obscur` | `clair` | `obscur` | `la-peintresse` | `the-curator` |
| `ui` | `yin-yang` | `yin` | `yang` | `la-peintresse` | `the-curator` |

The `duo_id` is the builder and reviewer spawn names hyphenated — it identifies the pairing for rotation bookkeeping, not for routing.

## CYCLE_WORKERS Scenario Mapping

`CYCLE_WORKERS: scenario={pool}` carries the pool label; the engine resolves it to types via this lookup at spawn time:

| Scenario | Builder Type | Reviewer Type |
|---|---|---|
| `default` | `dial-a-coder` | `critical-thinker` |
| `fallback` | `backup-coder` | `critical-thinker` |
| `ui` | `la-peintresse` | `the-curator` |

This table and the Pool Table are not redundant — the Pool Table is the per-duo source of truth the boss rotates through; the Scenario Mapping is the pool→type lookup the engine reads to spawn, once the boss has committed to a duo.
