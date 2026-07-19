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
4. `.kiln/slices.json` — a JSON array in build order, one object per slice:
   `{ "id": "<kebab-id>", "surface": "ui" | "logic" | "mixed" }`. `surface` is a machine
   fact the kernel routes the builder on: `ui` for markup/style/browser-facing work, `logic`
   for computation/data/CLI work, `mixed` when the slice spans both. Name it honestly per slice.
5. `.kiln/decisions.md` — append the founding ADR: `## ADR-1 — <title>`, one paragraph:
   what was pinned and why. Numbered, append-only, superseded entries are never deleted.

## Beat (fill every stage-owned slot; leave every kernel-owned slot from the sealed
`data/voice.json` slots map unfilled)
You compose the display blocks — `data/voice.json` → `panel` is the encoding; this beat is
THE CARD (`panel.compositions.card`); the conductor renders nothing. Scene-setter first —
`beats["stage.law"]` ("Locked before build begins.") — then the blocks, in this literal
order, never repeating each other:
- **FRAME** — `grammar["banner.stage"]`: `{name}` = the project's name in words (the run's
  chapter at big boundaries); `{progress}` = the strip per `grammar["progress.form"]`:
  `▶ **Law** N/N · ○ *Build* · ○ *Validate* · ○ *Report*` — bold only the active phase,
  the fraction ONLY there: `N/N` is the true slice count, bound to the named on-disk
  checklist `.kiln/slices.json` you just authored (the Law returns only complete — all N
  pinned); then a newline and one two-space-indented glyph-free unfold line naming those
  slices in reader-meaningful subject matter, all *italic* (they are ahead) — never bare
  process labels; the line never wraps (window past ~8 items with true count-words).
- **TITLE UNIT** — exactly one: `` `SEALED` **The Law is locked — <what it makes
  falsifiable, concept altitude>** (`<short digest from .kiln/law/lock.hash>`) `` — the
  bold event names the Law; the digest stands as the handle on this fresh seal.
- **WHISPER** — one blank line, then a two-space indent, then ONE tight italic sentence:
  the simple truth of what the criteria pin. Never fog, never a paragraph.
- **CLOSE** — one short plain narrative line: what starts when this crosses (the build
  takes the first slice). Never a numbered list.
- **FOOT** — OUTSIDE the frame, below the body: `grammar["rule.light"]`, a blank line,
  then `` `"{quote}"` — {source} `` — one credited verified quote from
  `data/lore-quotes.json` → `moments["law-opens"]`, rendered per CAL 17: `{quote}` = the
  entry's `text` with any embedded backticks DROPPED (the WHOLE quote rides in one code
  span — nested spans break; add nothing, reword nothing), `{source}` = the entry's FULL
  `source` string, plain weight, no invented epithets; never pick a quote already used
  this run.
Leave every kernel-owned slot from the sealed slots map exactly as-is. One transition, one
card.

## Return
`ok` — true only if all five outputs above are written. `beat` — every stage-owned slot
filled; kernel-owned slots left as-is. `pointers` — the repo-relative paths you wrote.
