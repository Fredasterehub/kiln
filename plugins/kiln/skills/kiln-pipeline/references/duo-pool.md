# Duo Pool — Worker Naming Rotation

The duo pool defines the legal builder+reviewer pairs for Build step (Step 5). KRS-One selects a duo from the pool using timestamp-seeded rotation. The engine spawns with the boss-selected names.

## Pool Table

| Pool | Duo ID | Builder Name | Reviewer Name | Builder Type | Reviewer Type |
|---|---|---|---|---|---|
| `default` | `codex-sphinx` | `codex` | `sphinx` | `dial-a-coder` | `critical-drinker` |
| `default` | `tintin-milou` | `tintin` | `milou` | `dial-a-coder` | `critical-drinker` |
| `default` | `mario-luigi` | `mario` | `luigi` | `dial-a-coder` | `critical-drinker` |
| `default` | `lucky-luke` | `lucky` | `luke` | `dial-a-coder` | `critical-drinker` |
| `fallback` | `kaneda-tetsuo` | `kaneda` | `tetsuo` | `backup-coder` | `critical-drinker` |
| `fallback` | `athos-porthos` | `athos` | `porthos` | `backup-coder` | `critical-drinker` |
| `ui` | `clair-obscur` | `clair` | `obscur` | `la-peintresse` | `the-curator` |
| `ui` | `yin-yang` | `yin` | `yang` | `la-peintresse` | `the-curator` |

## Selection Rules

**Pool selection** (KRS-One decision tree):
1. Is this UI/visual work? → `ui` pool
2. Is `codex_available=true`? → `default` pool
3. Else → `fallback` pool

**Duo rotation**: Boss picks the duo using timestamp-seeded rotation within the selected pool. The engine spawns both agents with the boss-selected builder/reviewer names and their respective agent types from this table.

**Name/type separation**: The `name` parameter at spawn (e.g., `tintin`) is who the agent IS this cycle. The `subagent_type` (e.g., `dial-a-coder`) is what .md template it uses. SendMessage always uses spawn names, never agent types.

## CYCLE_WORKERS Scenario Mapping

When KRS-One sends `CYCLE_WORKERS: scenario={pool}`, the engine maps pool to builder+reviewer types:

| Scenario | Builder Type | Reviewer Type |
|---|---|---|
| `default` | `dial-a-coder` | `critical-drinker` |
| `fallback` | `backup-coder` | `critical-drinker` |
| `ui` | `la-peintresse` | `the-curator` |

KRS-One selects the next duo from the pool using timestamp-seeded rotation. The engine spawns both agents with the boss-selected names and their corresponding types from this table.
