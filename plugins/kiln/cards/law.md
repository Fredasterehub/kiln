# LAW — Asimov takes the bench *(stage 1 of 4: law → build → validate → report)*

*Stage card: methodology for the stage agent. The kernel never reads this file — it routes
paths and branches on closed facts. You read it, follow it exactly, and return
`{facts:{status, pointers, schema_valid}, narration_beat}`.*

## Inputs
The operator's idea, verbatim, in your prompt (or `.kiln/docs/` vision artifacts if present).
`.kiln/docs/project-brief.md` — the onboarding brief (purpose, users, deliverable, constraints,
non-goals) — is your durable context input, written before this stage runs and present by the
time you plan. `.kiln/docs/feasibility.md` — the ratified feasibility read — is advisory evidence
you weigh WHEN PRESENT, never authority: it exists only when the research sweep found a
qualifying question and a second family ratified the answer, so a stand-down or
no-qualifying-question run has none and its absence is normal. Never require it. The project dir
is your working root; all control artifacts go under `.kiln/`.

## Method
Turn the idea into **executable acceptance criteria only**. A criterion is an owning slice, a
locked behavioral requirement, a command, and its expected outcome — never rationale prose.
If it cannot run, it is not law. A perceptual criterion is lawful because its proxy runs; its
subjective residue is graded, not executed — the proxy command runs in `check.sh`'s
every-criterion loop like any other, and a red prints its owning slice ids as ever. A
one-page static site pins
naturally: `test -f index.html`; `grep -qF "<title string>" index.html`; a link-resolution
loop. Prefer the smallest criterion set that makes the idea falsifiable.

Slice the work: the fewest ordered slices that cover the law, kebab-case ids. **Slice so the
LAW is green through the current slice; later planned owners may remain red** — the kernel
reruns every check before each seal, a red owned by the current (or an earlier) slice reopens
it, and a red owned only by a later, still-unbuilt planned slice is expected pre-build state.

## Outputs (write via temp + rename: `.kiln/.<name>.tmp` → `mv -f`; append-only files append)
1. `.kiln/LAW.md` — the acceptance criteria, one entry per criterion: `id` · owning slice ·
   the locked behavioral requirement · the exact command · expected outcome (no rationale
   prose); then, under a `## Plan` heading, the AUTHORITATIVE plan table — a GitHub table
   `| slice | milestone |`, one row per slice in build order, carrying an OPTIONAL milestone
   label per slice (leave the milestone cell empty for an unlabeled slice; a shared label
   groups the slices that ship one milestone). This table is the single source of truth for
   the labels — a label carries no `|` and no control characters — and `.kiln/slices.json`
   (output 3) is its checked projection: the kernel refuses to seal unless the two agree.
   Then, whenever the project brief declares a visual deliverable, under a `## Perceptual`
   heading, the Perceptual table — a GitHub table
   `| criterion id | owning slice | dim | requirement | proxy command | expected | reference |`
   (reference optional), one row per perceptual criterion. These are ordinary lawful
   criteria: the proxy command joins `check.sh`'s every-criterion loop (output 2), so a
   proxy red is a law red that prints its owning slice like any other. Every cell but
   `reference` is required nonempty; criterion ids are unique; the owning slice is a
   `.kiln/slices.json` id, and every `ui` or `mixed` slice owns at least one row; `dim`
   selects from the shipped rubric `data/perceptual-rubric.json`, and the rows together
   use 4–6 DISTINCT dims — the graded subjective residue the requirement pins. A filled
   `reference` cell names an existing repo path (a mockup, a comparison image) — the
   kernel resolves it against the project root and refuses any path that escapes it. The
   kernel checks the table — validity, coverage, consistency — before it seals; a brief
   with no visual deliverable authors no table.
2. `.kiln/law/check.sh` — bash, no dependencies, runs from the project root, runs every
   criterion, exits `0` iff all green; on any red it prints to stdout the owning slice IDs of
   every failed criterion as a JSON array of strings, so the kernel receives the closed
   `{exit, ids}` facts and reopens the true owner (`bash .kiln/law/check.sh`).
3. `.kiln/slices.json` — a JSON array in build order, one object per slice:
   `{ "id": "<kebab-id>", "surface": "ui" | "logic" | "mixed", "milestone": "<label>" }`.
   `surface` is a machine fact the kernel routes the builder on: `ui` for
   markup/style/browser-facing work, `logic` for computation/data/CLI work, `mixed` when the
   slice spans both. Name it honestly per slice. `milestone` is the OPTIONAL label PROJECTED
   from the LAW plan table (output 1) — the SAME label the table gives that slice, or `""`
   (or omitted) when the slice is unlabeled. The projection must match the authoritative
   table exactly, in build order: the kernel checks agreement before it seals.
4. `.kiln/decisions.md` — append the founding ADR: `## ADR-1 — <title>`, one paragraph:
   what was pinned and why. Numbered, append-only, superseded entries are never deleted.

You do not seal the LAW — you leave it a candidate. After you return it is cross-family
ratified; on accept the kernel seals it, writing the digest of `.kiln/LAW.md` to
`.kiln/law/lock.hash` — and from that seal on, any edit to LAW.md is a reopen event, never
silent.

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
  falsifiable, concept altitude>** (`<short digest — the first N chars of
  sha256sum .kiln/LAW.md | cut -d' ' -f1>`) `` — the bold event names the Law; the digest is
  the handle on the LAW you just wrote. You show it but do not seal it: the kernel seals
  `.kiln/law/lock.hash` after ratification, and since that seal is the sha256 of these same
  `.kiln/LAW.md` bytes, your short digest is deterministically a prefix of it.
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
`facts.status` — `'ok'` only if all four outputs above are written, else an honest failure
string. `facts.pointers` — the repo-relative paths you wrote. `facts.schema_valid` — true iff
your declared outputs are well-formed. `narration_beat` — every stage-owned slot filled;
kernel-owned slots left as-is.
