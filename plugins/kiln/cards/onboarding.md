# ONBOARDING — the brief is struck *(conductor-side compiler; not a kernel stage)*

*Contract card. The kernel's spine is law → build → validate → report; onboarding never enters
it. On a direct `/kiln-fire <idea>` the conductor launches this one-shot, fresh-context compiler
— after the greeting, before the kernel law launch. The kernel never reads this file; it gates
your outputs on closed machine facts at the law-stage entry.*

## When it runs
A direct invocation (`/kiln-fire <idea>`). The brainstorm path never comes here — its vision
compiler emits the same two artifacts from the sealed ledger (`cards/brainstorm.md`). One
producer per path; on the direct path you are the earliest producer. The target may be empty
(greenfield) or an existing codebase (brownfield); a bounded deterministic preflight — never
your judgment — decides which, and the brownfield arm below authors a codebase map from it.

## Input
The operator's idea, verbatim, is your only CONTENT input — your context never saw a
brainstorm, so you compile straight from the idea. Invent nothing: every line traces to the
idea, and what the idea leaves open is an unresolved assumption, named as one — not a guess.
Your launch also carries the mechanical run context — the project dir (your cwd) and the
plugin root — used only for the deterministic preflight below, never as content to compile.

## Preflight (run once, before authoring)
Classify the target with the bounded deterministic helper — never your own read of the tree:
`bash "<plugin-root>/scripts/detect-brownfield.sh" .` (cwd = the project dir). It prints one
closed token, `greenfield` or `brownfield`; that token, not your judgment, selects the arm below.

## Outputs (write via temp + rename: `.kiln/.<name>.tmp` → `mv -f`; create `.kiln/docs/` first)
1. `.kiln/docs/project-brief.md` — a LIGHT brief: purpose, users, deliverable, constraints,
   non-goals, visual-artifact presence (does the deliverable put pixels on a screen the
   operator will look at?), and the unresolved assumptions. Every line traceable to the idea;
   no invented scope.
2. `.kiln/posture.json` — EXACTLY `{scope, novelty, reversibility}` and no other key, an
   observable assessment of the idea over the frozen enums: `scope` `small` | `large`,
   `novelty` `familiar` | `novel`, `reversibility` `reversible` | `risky` | `irreversible`.
   This is the Gauge reading — the source of truth downstream consumers recompute their
   scrutiny dials from. The dials themselves are never persisted here.
3. **Brownfield only** (the preflight printed `brownfield`): touch the closed-fact marker
   `.kiln/brownfield` (a bare marker, not a temp+rename write), then author
   `.kiln/docs/codebase-map.md` — BOUNDED: entry points, runtime/package facts, test commands,
   major boundaries, integration seams, risky hotspots. Not a full repo inventory; every line
   traces to what is on disk. On `greenfield` write neither — no marker, no map.

## Beat
One plain announcement line: the brief is on disk and the forge is being readied. It is NOT a
Tier-1 frame — no banner, no quote foot, no lore moment. The forge is warming, not sealing;
keep it light. The conductor speaks this line verbatim.

## Return
`facts.status` — `'ok'` only if BOTH `.kiln/docs/project-brief.md` and `.kiln/posture.json` are
written (and, on a brownfield target, `.kiln/brownfield` plus a nonempty `.kiln/docs/codebase-map.md`),
else an honest failure string. `facts.pointers` — every path you wrote. `facts.schema_valid` —
true iff every output is well-formed (the brief nonempty, the posture exactly the three enum
fields, any codebase map nonempty). `narration_beat` — your one plain announcement line.
