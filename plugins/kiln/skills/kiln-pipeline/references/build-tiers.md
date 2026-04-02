# Build Scenarios

Scenario definitions and cosmetic name pools for Step 5 (Build). krs-one reads this at iteration start to select the builder+reviewer pair and their display name.

## Scenarios

| Scenario | Builder | Reviewer | When |
|----------|---------|----------|------|
| Default | `codex` | `sphinx` | `codex_available=true` and structural work. |
| Fallback | `kaneda` | `sphinx` | `codex_available=false` (structural fallback). |
| UI | `clair` | `obscur` | Components, pages, layouts, design tokens. |

`subagent_type` handles all dispatch logic. The cosmetic name is injected at spawn for character — it never affects routing.

sphinx (opus) is the single structural reviewer for both Default and Fallback scenarios.
obscur (sonnet) reviews UI work only.

## Name Pools

### General Pool (Default + Fallback scenarios)

codex+sphinx, kaneda+tetsuo, daft+punk, tintin+milou, mario+luigi, lucky+luke, asterix+obelix, athos+aramis, porthos+dartagnan

### UI Pool (art/design themed)

clair+obscur, yin+yang, recto+verso, monet+manet

## Selection Formula

```
pool_index = (build_iteration * 7) % pool_size
```

`build_iteration` comes from STATE.md. The prime multiplier (7) jumps pseudo-randomly through the pool so consecutive iterations get different names. Zero extra reads, zero tracking, one line of arithmetic.

## Blacklist

These names are reserved for infrastructure and must never appear in a name pool:

- rakim, sentinel, thoth, krs-one, team-lead

## Dormant Agents

tetsuo, daft, punk are dormant — kept on disk but never dispatched as active workers. They are NOT valid targets for CYCLE_WORKERS scenario routing. Their names remain valid as cosmetic pool entries.

## Notes

- Canonical pairs (codex+sphinx, clair+obscur) appear in the pool as valid cosmetic picks.
- Pool size must not be a multiple of 7. Current pools (9 general, 4 UI) are both coprime with 7.
- If a pool has only one entry, the formula always returns index 0 — that's fine. The name is cosmetic.
