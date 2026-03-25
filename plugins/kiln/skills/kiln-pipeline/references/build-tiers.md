# Build Tiers

Tier definitions and cosmetic name pools for Step 5 (Build). krs-one reads this at iteration start to select the builder+reviewer pair and their display name.

## Tiers

| Tier | Builder | Reviewer | When |
|------|---------|----------|------|
| Codex | `codex` | `sphinx` | Default. GPT-5.4 implements via CLI. |
| Sonnet | `kaneda` | `tetsuo` | Fallback when Codex CLI unavailable. |
| UI | `clair` | `obscur` | Components, pages, layouts, design tokens. |

`subagent_type` handles all dispatch logic. The cosmetic name is injected at spawn for character — it never affects routing.

Opus tier (daft+punk) removed: never used in 22 smoke tests. Agent files kept on disk for future reactivation.

## Name Pools

### General Pool (Codex + Sonnet tiers)

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

## Notes

- Canonical pairs (codex+sphinx, kaneda+tetsuo, clair+obscur) are valid pool entries — they're just another cosmetic pick when the formula lands on them.
- Pool size must not be a multiple of 7 (the multiplier). Any multiple (7, 14, 21, ...) causes some names to never be reached. Current pools (9 general, 4 UI) are both coprime with 7.
- If a pool has only one entry, the formula always returns index 0 — that's fine. The name is cosmetic.
