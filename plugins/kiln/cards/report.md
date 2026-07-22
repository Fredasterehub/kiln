# REPORT — Omega picks up the pen *(stage 4 of 4: law → build → validate → report)*

*Stage card: methodology for the stage agent. The kernel never reads this file. The report is
composed from the run's readable artifacts alone — a dead run must reconstruct from files, and
this stage proves the files suffice. Return `{facts:{status, pointers, schema_valid}, narration_beat}`.*

## Inputs — the readable record, nothing else
`.kiln/STATE.md` · `.kiln/LAW.md` · `.kiln/decisions.md` · `.kiln/seals.log` ·
`.kiln/validate.md` · `.kiln/degraded` (presence = the run degraded single-family) ·
`.kiln/perceptual-partial` (presence = a semantic perceptual hold stands — the one closed
fact that selects the held-run variant below) · `.kiln/screen-escalation.txt` (the one-line
escalation record, read only when the marker is present). The
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
5. **The screen's doubt** — ONLY when `.kiln/perceptual-partial` is present: the perceptual
   rows verbatim from `.kiln/validate.md` (criterion id · dim · proxy exit · grade), the
   surviving `PARTIAL` criteria named plainly, and the escalation record line from
   `.kiln/screen-escalation.txt` verbatim when it exists (`CORROBORATED` — the second family
   failed them too; `CONTESTED` — it accepted them; the hold stood either way). When the
   marker is absent this section does not exist and the report is unchanged.

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

**The held-run variant** — selected by ONE closed input fact: `.kiln/perceptual-partial`
exists. The blocks above compose a sealed run; a held run tells the hold instead — same
literal order, these honest substitutions, and when the marker is absent none of this
applies:
- **FRAME** — `{progress}` = the honest held strip: `✓ *Law* · ✓ *Build* · ▶ **Validate** ·
  ○ *Report*` — the run stands AT validate, nothing past it is sealed; NO all-sealed strip,
  NO fraction (the counting is over — the hold is the fact).
- **TITLE UNIT** — exactly one, and NEVER `SEALED`: `` `HELD` **Report — the run stands
  held at validate: the screen kept its doubts** `` — the clause after the bold event names
  what survived, from the record.
- **THE SCREEN'S DOUBT** — between the EVIDENCE NOTCH and THE METER: one plain line per
  perceptual row of `.kiln/validate.md` (criterion id · dim · proxy exit · grade verbatim,
  the `PARTIAL` survivors plainly named), then the escalation record line from
  `.kiln/screen-escalation.txt` verbatim when it exists.
- **THE METER** — the meter reflects the hold: first one plain line — `Held: N perceptual
  criteria stand PARTIAL — the ruling is the operator's.` (N counted from the rows) — then
  the completion line exactly as above, `{driver}` untouched: the spend is measured even
  when the work is held.
- **NO FOOT** — the sealed foot law: a HELD card omits the quote foot; the moment belongs
  to the operator, not the lore.

Leave every kernel-owned slot from the sealed slots map exactly as-is. NO close anywhere
on this card — the absence of a close is the ending.

## Return
`facts.status` — `'ok'` only if `.kiln/report.md` is written from the record, else an honest
failure string. `facts.pointers` — `.kiln/report.md`. `facts.schema_valid` — true iff your
declared outputs are well-formed. `narration_beat` — every stage-owned slot filled;
kernel-owned slots left as-is.
