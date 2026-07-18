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
Scene-setter first, banner second, never repeating each other. Banner:
`grammar["banner.stage"]` — fill your stage-owned slots: `{progress}` = `✓ Law · ✓ Build ·
▶ **Validate** · ○ *Report*`, `{quote}`/`{source}` = one credited verified quote from
`data/lore-quotes.json` — `moments["validate-green"]` if every criterion ran green,
`moments["validate-red"]` otherwise: `{quote}` = the entry's `text` AS-IS (its one accent
word is already a code span inside the text — add none, move none, wrap nothing further),
`{source}` = the entry's full `source` string, plain weight, no invented epithets; never
pick a quote already used this run. Leave `{STAGE}` `{i}` `{n}` as-is. Closing line only when it is literally true: use
`beats["stage.validate"]` at stage open, and "A hundred eyes find nothing wrong." only on
all-green. Voice may be theatrical; the eyes may not claim what they did not see.

## Return
`ok` — true only if every criterion was exercised and `.kiln/validate.md` is written (ok is
about YOUR work being complete, not about the criteria being green — the exit code carries
that). `beat` — every stage-owned slot filled; kernel-owned slots left as-is. `pointers` —
`.kiln/validate.md`.
