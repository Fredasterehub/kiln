# Kill Streak Sequence

40 kill-streak names cycling per build milestone. Each name earns its position in a narrative arc from first spark to legend. A run's ladder position climbs with both build iterations and validation correction cycles — so a run that fights through corrections actually climbs the ladder.

Select by ladder position:

- `ladder_position = max(build_iteration + correction_cycle, 1)`
- `kill_streak_index = (ladder_position - 1) % 40`

Read `build_iteration` from STATE.md's `- **build_iteration**: N` bullet and `correction_cycle` from its `- **correction_cycle**: N` bullet. A missing, `pending`, or non-integer field reads as `0` — a fresh STATE (both `0`, or unwritten) fails soft to `ladder_position = 1` (`first-blood`, Chapter I), never a crash.

Past position 40 the sequence wraps back to `first-blood` (#1) and the arc begins again — exactly what the formula yields.

`kiln-state killstreak --build-iteration <n> --correction-cycle <n>` applies exactly this arithmetic over this ladder and emits the name — this doc explains it, the CLI executes it.

## Chapter I — Ignition (1-5)

| # | Name | Source |
|---|------|--------|
| 1 | first-blood | Dota 2 |
| 2 | spark-of-life | WoW |
| 3 | signal-fire | LOTR |
| 4 | multipass | Fifth Element |
| 5 | killing-spree | Dota 2 |

## Chapter II — Momentum (6-11)

| # | Name | Source |
|---|------|--------|
| 6 | combo-breaker | Killer Instinct |
| 7 | mithril-weave | LOTR |
| 8 | braindance | Cyberpunk 2077 |
| 9 | the-forge-hums | Kiln |
| 10 | ultra-combo | Killer Instinct |
| 11 | rampage | Dota 2 |

## Chapter III — The Crucible (12-18)

| # | Name | Source |
|---|------|--------|
| 12 | c-c-c-combo | Killer Instinct |
| 13 | dominating | Dota 2 |
| 14 | helms-deep | LOTR |
| 15 | sandevistan | Cyberpunk 2077 |
| 16 | anduril-reforged | LOTR |
| 17 | trial-by-fire | Kiln |
| 18 | high-ground | Star Wars |

## Chapter IV — Mastery (19-26)

| # | Name | Source |
|---|------|--------|
| 19 | godlike | Dota 2 |
| 20 | leeloo-dallas | Fifth Element |
| 21 | chrome-plated | Cyberpunk 2077 |
| 22 | eye-of-sauron | LOTR |
| 23 | one-more-pull | WoW |
| 24 | masterwork | Medieval guild |
| 25 | wicked-sick | Dota 2 |
| 26 | beyond-godlike | Dota 2 |

## Chapter V — Transcendence (27-33)

| # | Name | Source |
|---|------|--------|
| 27 | divine-rapier | Dota 2 |
| 28 | the-one-ring | LOTR |
| 29 | netrunner | Cyberpunk 2077 |
| 30 | frostmourne | WoW / Warcraft III |
| 31 | supreme-being | Fifth Element |
| 32 | night-city-legend | Cyberpunk 2077 |
| 33 | aegis-immortal | Dota 2 |

## Chapter VI — Myth (34-38)

| # | Name | Source |
|---|------|--------|
| 34 | valinor | LOTR |
| 35 | fifth-element | Fifth Element |
| 36 | chosen-undead | Dark Souls |
| 37 | quintessence | Alchemy / French |
| 38 | kiln-of-the-first | Dark Souls |

## Chapter VII — Overtime (39-40)

| # | Name | Source |
|---|------|--------|
| 39 | il-n-en-reste | French |
| 40 | gg-wp | Universal gaming |
