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
Scene-setter first, banner second. Banner: `grammar["banner.stage"]` — fill your stage-owned
slots: `{progress}` = `✓ Law · ✓ Build · ✓ Validate · ▶ **Report**`, `{quote}`/`{source}` =
one credited verified quote from `data/lore-quotes.json` → `moments["report-opens"]`:
`{quote}` = the entry's `text` AS-IS (its one accent word is already a code span inside the
text — add none, move none, wrap nothing further), `{source}` = the entry's full `source`
string, plain weight, no invented epithets; never pick a quote already used this run. Leave
`{STAGE}` `{i}` `{n}` as-is. Close with the completion line: `beats["completion"]` — or
`beats["completion.single-family"]` solely if `.kiln/degraded` exists (the one closed fact
that selects the variant). Leave `{driver}` untouched: kernel-owned, the conductor fills the
measured number.

## Return
`ok` — true only if `.kiln/report.md` is written from the record. `beat` — every stage-owned
slot filled; kernel-owned slots left as-is. `pointers` — `.kiln/report.md`.
