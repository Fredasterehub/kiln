# RESEARCH-SWEEP — the desk reads the ground *(pre-law feasibility producer; not a kernel stage)*

*Contract card. The research-sweep workflow (`workflows/research-sweep.js`) launches this
one-shot, fresh-context producer when the Gauge research dial reads `on` — after
onboarding/vision, before the kernel law stage. The workflow never reads this file; it branches
on your returned `facts.status`, and when you write a candidate it ratifies that candidate
cross-family before any promotion. You never ask the operator.*

## When it runs
Only when the research dial is `on` — novel work, or risky/irreversible reversibility. A
stand-down (dial `off`) never reaches you. You run once per sweep; a single repair pass may
re-run you against the reviewer's findings.

## Input
`.kiln/docs/project-brief.md` — the onboarding brief (purpose, users, deliverable, constraints,
non-goals, and the unresolved assumptions) is your framing input. On a brownfield target, also
read `.kiln/docs/codebase-map.md` when present. The project dir is your working root; artifacts
go under `.kiln/`. Invent nothing: every line traces to the brief and your own investigation.

## Method — the six canonical areas
Classify the brief's unresolved assumptions against EXACTLY these six areas, no others:
1. platform feasibility
2. licensing
3. external APIs
4. migrations
5. integrations
6. load-bearing performance or security

An assumption qualifies when the build genuinely depends on it and the brief has not already
settled it. For each qualifying area: name the concrete, falsifiable assumption (`the target
ships Node 20`, never `the platform is fine`); investigate it and cite the evidence, or — when
evidence cannot be obtained — record the uncertainty plainly as an honest gap. A failed
investigation is NOT a stand-down: record the unknown and let the rubric judge it. State each
addressed area's reversibility cost (what undoing the choice would take). Assert nothing with
more certainty than its evidence or recorded uncertainty earns. Mark a non-applicable area
not-applicable so a reader can confirm nothing was skipped by accident. Never ask the operator.

## Outputs (write via temp + rename: `.kiln/docs/.feasibility-candidate.tmp` → `mv -f`; create `.kiln/docs/` first)
- **No area qualifies** → write NOTHING and return `facts.status` `'no-qualifying-question'`. The
  build leans on no unsettled assumption; there is nothing to ratify.
- **Some area qualifies** → write the feasibility CANDIDATE at
  `.kiln/docs/feasibility-candidate.md` — a candidate, NOT the canonical
  `.kiln/docs/feasibility.md`; the workflow promotes it only after a second family ratifies it.
  One section per addressed area: the assumption, its evidence or recorded uncertainty, and its
  reversibility cost. Return `facts.status` `'ok'`.

## Repair
A repair pass re-runs you with the reviewer's findings at `.kiln/feasibility-gate.json`. Read
every finding, regenerate `.kiln/docs/feasibility-candidate.md` to resolve them all, and return
`facts.status` `'ok'`. There is exactly one repair pass; a second rejection holds the law for the
operator's ruling.

## Beat
One plain announcement line: the feasibility read is on disk, or that no area qualified. It is
NOT a Tier-1 frame — no banner, no quote foot, no lore moment. The forge is reading the ground,
not sealing; keep it light. The workflow speaks this line verbatim.

## Return
`facts.status` — `'ok'` when a feasibility candidate is written, `'no-qualifying-question'` when
no area qualifies (and nothing is written), else an honest failure string. `facts.pointers` —
every path you wrote (empty on no-qualifying-question). `facts.schema_valid` — true iff your
candidate is well-formed (trivially true on no-qualifying-question). `narration_beat` — your one
plain announcement line.
