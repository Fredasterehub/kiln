# BRAINSTORM — Da Vinci takes the window *(conductor-side; not a kernel stage)*

*Contract card. The kernel's spine is law → build → validate → report; brainstorm never
enters it. When the kernel receives no idea it returns the closed status `needs-brainstorm`
with its beat, and everything below happens on the conductor's side of the seam. The kernel
never reads this file.*

## When it runs
Bare `/kiln-fire` in a fresh directory — the sealed conductor spawns Da Vinci DIRECTLY on
that invocation. The kernel's `needs-brainstorm` return exists only as the fallback for an
idea-less kernel launch; it is never the normal entry. Direct invocations (`/kiln-fire
<idea>`) never come here.

## The spawn
The conductor spawns `agents/da-vinci.md` as an interactive teammate with one line: the
absolute project path. Da Vinci converses with the user in his own window; the driver stays
silent until his single completion signal. The real boundary: no dialogue and no ledger
content ever crosses to the driver — nothing except the user-authored essence riding inside
the single completion envelope.

## The ledger
`.kiln/brainstorm-ledger.jsonl` — append-only, authorship-tagged, injection-safe appends,
sealed by a terminal `session_complete` event (the full event vocabulary and idioms live in
the agent file). The sealed ledger is a permanent run artifact — the sole source every
vision compile reads — and it never gets rewritten.

## The hand-off (executes in the conductor — see its post-signal paragraph; this card holds the contract)
On the `BRAINSTORM_COMPLETE` envelope the conductor runs TWO launches, in order:
1. **The compiler** — a one-shot, fresh-context agent. Its only CONTENT input is the sealed
   ledger path (its context never saw the conversation — that is the whole point); its launch
   also carries the mechanical run context (the project dir = its cwd, and the plugin root)
   for the deterministic preflight below. It verifies the last ledger line is `session_complete`
   (else returns a non-`'ok'` `facts.status`, honestly),
   compiles the confirmed intents, user-tagged ideas, and clarifications into
   `.kiln/docs/vision.md` — inventing nothing; every line traces to a ledger event — written
   via temp + rename. In the SAME leg (no new call — you are the earliest producer on this
   path) it also writes `.kiln/docs/project-brief.md` (the light brief: purpose, users,
   deliverable, constraints, non-goals, visual-artifact presence, unresolved assumptions) and
   `.kiln/posture.json` (EXACTLY `{scope, novelty, reversibility}` over the frozen enums — the
   observable Gauge reading), both traced to the sealed ledger + essence, both temp + rename.
   Before authoring, it runs the same bounded deterministic preflight as the direct path —
   `bash "<plugin-root>/scripts/detect-brownfield.sh" .` (never its own read of the tree) — and
   on a `brownfield` token touches the closed-fact marker `.kiln/brownfield` and authors a
   BOUNDED `.kiln/docs/codebase-map.md` (entry points, runtime/package facts, test commands,
   major boundaries, integration seams, risky hotspots; every line traceable, not a full
   inventory); on `greenfield`, neither.
   Returns the standard envelope (defined in `## Return` below); its `narration_beat` is one
   voiced line announcing the vision is on disk, closed by a quote foot composed per the
   display encoding (`data/voice.json` → `panel.blocks.foot`, CAL 17) — a light rule
   (`grammar["rule.light"]`), a blank line, then one credited verified quote from
   `data/lore-quotes.json` → `moments["vision-compiled"]`: the entry's `text` with any
   embedded backticks DROPPED, the WHOLE quote wrapped in one code span (nested spans
   break), the FULL `source` string plain, no invented epithets, never a quote already used
   this run.
2. **The kernel** — `{stage: "law", projectDir, idea: <the essence>}`. The essence is the
   user-authored seed; the vision doc carries the completeness (the sealed law card already
   reads `.kiln/docs/` vision artifacts when present). The essence alone never carries the
   hand-off: law launches only after the compiler returns `facts.status` `'ok'`.

## Abandoned sessions — the restart rule
If the user abandons Da Vinci, no signal fires and the ledger stays unsealed. An unsealed
ledger with no `.kiln/STATE.md` beside it is NOT a resumable run — there is no run yet. The
next bare `/kiln-fire` starts a fresh brainstorm: Da Vinci, at spawn, renames the unsealed
ledger to `.kiln/brainstorm-ledger.abandoned-<utc>.jsonl` (preserved forever, never resumed,
never compiled) and begins a new one. No silent resume, no ambiguity.

## Honest bounds
Da Vinci claims no machinery: no banners, no status symbols, no pipeline talk — his window is
a sketchbook.

## Return
The compiler leg returns the standard envelope (the kernel launch above returns nothing).
`facts.status` — `'ok'` only if the ledger's last line is `session_complete` and all three of
`.kiln/docs/vision.md`, `.kiln/docs/project-brief.md`, and `.kiln/posture.json` are compiled
and written (and, on a brownfield target, `.kiln/brownfield` plus a nonempty
`.kiln/docs/codebase-map.md`), else an honest failure string. `facts.pointers` — every compiled
path (`.kiln/docs/vision.md`, `.kiln/docs/project-brief.md`, `.kiln/posture.json`, and any
brownfield map). `facts.schema_valid` — true iff every output is well-formed (the posture
exactly the three enum fields, any codebase map nonempty). `narration_beat` — the one voiced
line announcing the vision is on disk, composed with its quote foot per the compiler spec above.
