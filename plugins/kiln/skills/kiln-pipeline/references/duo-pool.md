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

## Naming Flexibility

Bosses MAY use boss-extension names (e.g. `nib-forty-eight` = `nib` + `epoch_seconds % 100`) when extra cross-cycle audit clarity is wanted in the archive. Engine validation is type-based — `subagent_type` is whitelisted in `_kiln-agents.sh`, the spawn name is not — so a boss-extension is silently accepted at spawn and routes correctly as long as the same name is used in every subsequent `SendMessage` for that cycle. A name change mid-cycle silently fails to deliver, which is the same failure mode that makes name binding the #1 deadlock cause; boss-extensions don't loosen that constraint, they just rename the binding.

Recommendation: prefer the canonical pool names (`Builder Name` / `Reviewer Name` columns above) for grep-ability across the archive. An operator searching post-run for `tintin` finds every cycle that used the canonical name; the same search misses cycles that wrote `tintin-forty-eight` instead, which is exactly the post-mortem cost the extension was meant to reduce. The `duo_id` stays canonical (e.g., `tintin-milou`) regardless of boss-extension naming because it identifies the pairing for rotation bookkeeping, not for routing.
