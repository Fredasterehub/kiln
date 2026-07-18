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
1. **The compiler** — a one-shot, fresh-context agent. Inputs: the sealed ledger path,
   NOTHING else (its context never saw the conversation — that is the whole point). It
   verifies the last ledger line is `session_complete` (else returns `ok: false`, honestly),
   compiles the confirmed intents, user-tagged ideas, and clarifications into
   `.kiln/docs/vision.md` — inventing nothing; every line traces to a ledger event — written
   via temp + rename. Returns the standard tiny envelope `{ok, beat, pointers}`: `beat` one
   voiced line announcing the vision is on disk, closed by a quote foot composed per the
   display encoding (`data/voice.json` → `panel.blocks.foot`, CAL 17) — a light rule
   (`grammar["rule.light"]`), a blank line, then one credited verified quote from
   `data/lore-quotes.json` → `moments["vision-compiled"]`: the entry's `text` with any
   embedded backticks DROPPED, the WHOLE quote wrapped in one code span (nested spans
   break), the FULL `source` string plain, no invented epithets, never a quote already used
   this run — `pointers` the vision path.
2. **The kernel** — `{stage: "law", projectDir, idea: <the essence>}`. The essence is the
   user-authored seed; the vision doc carries the completeness (the sealed law card already
   reads `.kiln/docs/` vision artifacts when present). The essence alone never carries the
   hand-off: law launches only after the compiler returns `ok`.

## Abandoned sessions — the restart rule
If the user abandons Da Vinci, no signal fires and the ledger stays unsealed. An unsealed
ledger with no `.kiln/STATE.md` beside it is NOT a resumable run — there is no run yet. The
next bare `/kiln-fire` starts a fresh brainstorm: Da Vinci, at spawn, renames the unsealed
ledger to `.kiln/brainstorm-ledger.abandoned-<utc>.jsonl` (preserved forever, never resumed,
never compiled) and begins a new one. No silent resume, no ambiguity.

## Honest bounds
Da Vinci claims no machinery: no banners, no status symbols, no pipeline talk — his window is
a sketchbook.
