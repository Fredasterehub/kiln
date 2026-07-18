# REPORT — Omega picks up the pen *(stage 4 of 4: law → build → validate → report)*

*Stage card: methodology for the stage agent. The kernel never reads this file. The report is
composed from the run's readable artifacts alone — a dead run must reconstruct from files, and
this stage proves the files suffice. Return `{ok, beat, pointers}`.*

## Inputs — the readable record, nothing else
`.kiln/STATE.md` · `.kiln/LAW.md` · `.kiln/decisions.md` · `.kiln/seals.log` ·
`.kiln/validate.md` · `.kiln/degraded` (presence = the run degraded single-family). The
report derives EXCLUSIVELY from this readable record — no workspace reads. If a fact is not
in the record, it is not in the report.

## Method
Write `.kiln/report.md` (temp + rename) in Kiln's first-person forge voice — the REPORT is a
sanctioned voice surface (references/brand.md). Sections, lean:
1. **What was forged** — the deliverable, from LAW and the recorded validate results.
2. **The law held** — per criterion: id and its final `✓`/`✗` verbatim from
   `.kiln/validate.md`; the check.sh exit code.
3. **The seals** — every line of `.kiln/seals.log` verbatim: slice id and its label (`dual`
   or `single-family`). If `.kiln/degraded` exists, say so plainly: codex never answered;
   every affected seal says single-family; nothing was impersonated.
4. **The ledger** — the ADR count and `decisions.md` pointer; cite decisions by number.

Theatrical voice, true claims — every operational sentence must trace to a named artifact.

## Beat (fill every stage-owned slot; leave every kernel-owned slot from the sealed
`data/voice.json` slots map unfilled)
You compose the display blocks — `data/voice.json` → `panel` is the encoding; this beat is
the run's BOUNDARY CARD per `panel.recipes["final-report"]`; the conductor renders
nothing. Scene-setter first, then the blocks, in this literal order:
- **FRAME** — `grammar["banner.stage"]`: `{name}` = the project's name in words;
  `{progress}` = the FINAL all-sealed strip per `grammar["progress.form"]`:
  `✓ *Law* · ✓ *Build* · ✓ *Validate* · ✓ *Report*` — every phase ✓, every name italic,
  NO fraction anywhere and NO bold (nothing is active — the run is over), and NO unfold
  line (the unfold is omitted when no phase is active).
- ONE bold day's-work line opens the body — what was forged, from the record, concept
  altitude.
- **TITLE UNIT** — exactly one: `` `SEALED` **Report** — the report stands: <the
  deliverable, from the record> (`<a seal handle the record carries; omit rather than
  invent>`) `` — the one SEALED title the final-report recipe requires; its bold event
  names the report with the bare stage word, the clause after it carrying what stands.
- **EVIDENCE NOTCH** (`panel.blocks.evidence_notch`) — one plain line from the readable
  record: criteria passed/failed counts from `.kiln/validate.md`, the seal count from
  `.kiln/seals.log`; single-family seals named plainly when present.
- **THE METER** — the completion line: `beats["completion"]` — or
  `beats["completion.single-family"]` solely if `.kiln/degraded` exists (the one closed
  fact that selects the variant). Leave `{driver}` untouched: DRIVER-filled, the conductor
  speaks the measured number.
- **FOOT** — OUTSIDE the frame, below the meter: `grammar["rule.light"]`, a blank line,
  then `` `"{quote}"` — {source} `` — one credited verified quote from
  `data/lore-quotes.json` → `moments["report-opens"]`, rendered per CAL 17: `{quote}` =
  the entry's `text` with any embedded backticks DROPPED (the WHOLE quote rides in one
  code span — nested spans break; add nothing, reword nothing), `{source}` = the entry's
  FULL `source` string, plain weight, no invented epithets; never pick a quote already
  used this run.
Leave every kernel-owned slot from the sealed slots map exactly as-is. NO close anywhere
on this card — the absence of a close is the ending.

## Return
`ok` — true only if `.kiln/report.md` is written from the record. `beat` — every stage-owned
slot filled; kernel-owned slots left as-is. `pointers` — `.kiln/report.md`.
