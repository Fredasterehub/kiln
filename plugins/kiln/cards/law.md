# LAW — Asimov takes the bench *(stage 1 of 4: law → build → validate → report)*

*Stage card: methodology for the stage agent. The kernel never reads this file — it routes
paths and branches on closed facts. You read it, follow it exactly, and return `{ok, beat,
pointers}`.*

## Inputs
The operator's idea, verbatim, in your prompt (or `.kiln/docs/` vision artifacts if present).
The project dir is your working root; all control artifacts go under `.kiln/`.

## Method
Turn the idea into **executable acceptance criteria only**. A criterion is an owning slice, a
locked behavioral requirement, a command, and its expected outcome — never rationale prose.
If it cannot run, it is not law. A one-page static site pins
naturally: `test -f index.html`; `grep -qF "<title string>" index.html`; a link-resolution
loop. Prefer the smallest criterion set that makes the idea falsifiable.

Slice the work: the fewest ordered slices that cover the law, kebab-case ids. **Slice so the
full LAW is green after every slice** — the kernel reruns every check before each seal and a
red reopens the slice; never leave a criterion red at a slice boundary.

## Outputs (write via temp + rename: `.kiln/.<name>.tmp` → `mv -f`; append-only files append)
1. `.kiln/LAW.md` — one entry per criterion: `id` · owning slice · the locked behavioral
   requirement · the exact command · expected outcome. No rationale prose.
2. `.kiln/law/check.sh` — bash, no dependencies, runs from the project root, runs every
   criterion, exits `0` iff all green; on any red it prints to stdout the owning slice IDs of
   every failed criterion as a JSON array of strings, so the kernel receives the closed
   `{exit, ids}` facts and reopens the true owner (`bash .kiln/law/check.sh`).
3. `.kiln/law/lock.hash` — the lock: the digest alone, extracted —
   `sha256sum .kiln/LAW.md | cut -d' ' -f1` (raw `sha256sum` output carries the filename and
   fails the request parser). After this write, LAW.md is locked — any edit is a reopen
   event, never silent.
4. `.kiln/slices.json` — a JSON array of the slice-id strings, in build order.
5. `.kiln/decisions.md` — append the founding ADR: `## ADR-1 — <title>`, one paragraph:
   what was pinned and why. Numbered, append-only, superseded entries are never deleted.

## Beat (fill every stage-owned slot; leave every kernel-owned slot from the sealed
`data/voice.json` slots map unfilled)
Scene-setter line first, banner second, never repeating each other. Use
`data/voice.json` → `beats["stage.law"]` for the closing line ("Locked before build begins.").
Banner: `grammar["banner.stage"]` — fill your stage-owned slots: `{progress}` =
`▶ **Law** · ○ *Build* · ○ *Validate* · ○ *Report*`, `{quote}`/`{source}` = one credited
quote from `data/lore.json` → `transitions.architecture_complete`; leave `{STAGE}` `{i}`
`{n}` and every other kernel-owned slot as-is. One transition, one banner.

## Return
`ok` — true only if all five outputs above are written. `beat` — every stage-owned slot
filled; kernel-owned slots left as-is. `pointers` — the repo-relative paths you wrote.
