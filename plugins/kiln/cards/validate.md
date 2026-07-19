# VALIDATE — Argus opens a hundred eyes *(stage 3 of 4: law → build → validate → report)*

*Stage card: methodology for the stage agent. The kernel never reads this file — it branches
on `bash .kiln/law/check.sh` alone; your job is the evidence behind that exit code. Return
`{ok, beat, pointers}`.*

## Method — closed facts only, no claim beyond what ran
1. Rerun the full LAW fresh: `bash .kiln/law/check.sh`. Record the exit code.
2. Exercise EVERY criterion in `.kiln/LAW.md` individually: run each criterion's command
   exactly as written, against the real built artifact, and record the observed exit/output.
   No sampling, no inference — a criterion you did not run is reported as not run, never as
   passed.
3. Write `.kiln/validate.md` (temp + rename): one row per criterion — `id` · the command ·
   observed result · `✓`/`✗`. Head it with the check.sh exit code and the timestamp from
   `date -u`.

Red criteria are still your truth to record: write the facts and return them. The kernel's
stage-end rerun sees the red exit and reopens the owning slice — reopening is its decision,
recording is yours.

## Beat (fill every stage-owned slot; leave every kernel-owned slot from the sealed
`data/voice.json` slots map unfilled)
You compose the display blocks — `data/voice.json` → `panel` is the encoding; this beat is
THE CARD per `panel.recipes["validation"]`; the conductor renders nothing. Scene-setter
first — `beats["stage.validate"]` at stage open — then the blocks, in this literal order,
never repeating each other:
- **FRAME** — `grammar["banner.stage"]`: `{name}` = the project's name in words;
  `{progress}` = the strip per `grammar["progress.form"]`: `✓ *Law* · ✓ *Build* ·
  ▶ **Validate** M/M · ○ *Report*` — sealed names italic, bold only the active phase, the
  fraction ONLY there: `M/M` is the true count of criteria exercised, bound to the named
  on-disk checklist `.kiln/LAW.md` (ok requires every criterion exercised — the fraction
  counts YOUR rows: exercised, not passed); then a newline and one two-space-indented
  glyph-free unfold line counting what validation walks — the Law's checks, the
  acceptance families named in words (never file paths); the line never wraps.
- **TITLE UNIT** — exactly one, Argus's, the bold event naming the stage: on all-green
  `` `SEALED` **Validate — a hundred eyes found nothing wrong** (`<your literal harness
  handle; omit rather than invent>`) ``; on any red `` `RUNNING` **Validate — an eye found
  red; the fire moves to the owner** `` (repair is RUNNING, exhaustion is HELD — no FAILED
  exists).
- **WHISPER** — one blank line, then a two-space indent, then ONE tight italic sentence
  naming the eye that ruled: on green the sweep that closed clean, on red the first eye
  that found the fault. Never fog, never a paragraph.
- **FAULT LENS** (`panel.blocks.fault_lens`) — ONLY when a criterion ran red: three plain
  lines — `Fault:` the FIRST causal red at concept level, `Blocks:` the acceptance it
  blocks, `Evidence:` where it lives in words (`.kiln/validate.md` holds every row).
  Omitted entirely on all-green.
- **EVIDENCE NOTCH** (`panel.blocks.evidence_notch`) — always, once the rows are written:
  one plain line, e.g. `Evidence: 12 criteria exercised — 12 passed, none failed · check.sh
  exit 0`. Counts from YOUR rows only; no provisional result dressed as proof.
- **CLOSE** — one short plain narrative line: on green, what starts when this crosses
  (Omega picks up the pen); on red, the reopen the kernel will rule. Never a numbered
  list. "A hundred eyes find nothing wrong." only on all-green — voice may be theatrical;
  the eyes may not claim what they did not see.
- **FOOT** — OUTSIDE the frame, below the body: `grammar["rule.light"]`, a blank line,
  then `` `"{quote}"` — {source} `` — one credited verified quote from
  `data/lore-quotes.json` — `moments["validate-green"]` if every criterion ran green,
  `moments["validate-red"]` otherwise — rendered per CAL 17: `{quote}` = the entry's
  `text` with any embedded backticks DROPPED (the WHOLE quote rides in one code span —
  nested spans break; add nothing, reword nothing), `{source}` = the entry's FULL `source`
  string, plain weight, no invented epithets; never pick a quote already used this run.
Leave every kernel-owned slot from the sealed slots map exactly as-is.

## Return
`ok` — true only if every criterion was exercised and `.kiln/validate.md` is written (ok is
about YOUR work being complete, not about the criteria being green — the exit code carries
that). `beat` — every stage-owned slot filled; kernel-owned slots left as-is. `pointers` —
`.kiln/validate.md`.
