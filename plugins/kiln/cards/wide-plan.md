# WIDE LAW — the blind table *(a wide-mode LAW author: one of two independent minds)*

*Stage card: methodology for a WIDE LAW author leg. The kernel routes paths and branches on
closed facts — it never reads this file or your plan content. You are ONE of two authors
planning the SAME idea in isolation; you never learn who the other author is, and you weigh
only plan artifacts, never provenance. You read this, follow it exactly, and return
`{facts:{status, pointers, schema_valid}, narration_beat}` (a draft) or the same plus
`converged` (an adjustment).*

## Inputs
The operator's idea, verbatim, in your prompt. `.kiln/docs/project-brief.md` — the onboarding
brief — is your durable context input. `.kiln/docs/feasibility.md` — the ratified feasibility
read — is advisory evidence you weigh WHEN PRESENT, never authority; its absence is normal.
Your CANDIDATE DIRECTORY is named in your prompt: every output you write goes THERE, never the
canonical `.kiln/LAW.md`.

## Method
Turn the idea into **executable acceptance criteria only** — an owning slice, a locked
behavioral requirement, a command, and its expected outcome, never rationale prose. If it
cannot run, it is not law. Slice the work into the fewest ordered kebab-case slices that cover
the law; slice so the LAW is green THROUGH the current slice (later planned owners may remain
red). Prefer the smallest criterion set that makes the idea falsifiable.

## Outputs (into your CANDIDATE DIRECTORY, write via temp + rename: `<dir>/.<name>.tmp` → `mv -f`)
1. `<dir>/LAW.md` — the acceptance criteria, one entry per criterion (`id` · owning slice · the
   locked behavioral requirement · the exact command · expected outcome); then, under a
   `## Plan` heading, the AUTHORITATIVE plan table — a GitHub table `| slice | milestone |`, one
   row per slice in build order, an OPTIONAL milestone label per slice (leave the cell empty for
   an unlabeled slice; a label carries no `|` and no control characters). This table is the
   single source of truth for the labels, and `<dir>/slices.json` is its checked projection.
2. `<dir>/law/check.sh` — bash, no dependencies, runs from the project root, runs every
   criterion, exits `0` iff all green; on any red it prints the owning slice IDs of every failed
   criterion as a JSON array of strings on stdout.
3. `<dir>/slices.json` — a JSON array in build order, one object per slice:
   `{ "id": "<kebab-id>", "surface": "ui" | "logic" | "mixed", "milestone": "<label>" }`.
   `milestone` is PROJECTED from the plan table (output 1) — the same label, or `""` when the
   slice is unlabeled — and must match the table exactly, in build order.
4. `<dir>/decisions.md` — the founding ADR: `## ADR-1 — <title>`, one paragraph: what was
   pinned and why.

## Draft phase
Your prompt names your candidate directory and gives you no peer. Write the full four-output set
into it. This draft is IMMUTABLE — once written you never edit it. Return `facts.status` `'ok'`
only if all four outputs are written.

## Adjust phase
Your prompt names the OTHER candidate's draft directory. Read ONLY its plan artifacts — no author
identity exists to read, and you name none. Weigh the two plans against each other and write your
ADJUSTED full four-output set to the adjusted directory your prompt names. Return
`converged: true` ONLY if the two plans have genuinely converged to the SAME law (you adopted the
shared plan) — `converged: false` if a real divergence remains. Never report a convergence you do
not see: an honest divergence is resolved downstream, a false one seals a plan no one agreed on.

## Beat
Compose your `narration_beat` exactly as the LAW stage card (`cards/law.md`) Beat section
specifies — the same FRAME / TITLE UNIT / WHISPER / CLOSE / FOOT blocks, the `` `SEALED` `` title
unit naming the law, the WHISPER truth of the criteria, and the FOOT quote from
`data/lore-quotes.json` → `moments["law-opens"]` — with ONE override to that section's digest
path: the TITLE UNIT short digest hashes YOUR candidate law, `<dir>/LAW.md` (the `LAW.md` in the
candidate directory your prompt names), never the canonical `.kiln/LAW.md` — which is absent or
carries a stale prior law while you write under `.kiln/.wide/`, so hashing it would report the
wrong digest. Because the kernel promotes your candidate bytes unchanged and seals their sha256,
that short digest stays deterministically a prefix of the sealed hash. You do not seal the law —
you leave a candidate; the kernel seals it after cross-family ratification, and your beat speaks
only then.

## Return
`facts.status` — `'ok'` only if all four outputs above are written to your candidate directory,
else an honest failure string. `facts.pointers` — the repo-relative paths you wrote.
`facts.schema_valid` — true iff your declared outputs are well-formed. `narration_beat` — every
stage-owned slot filled; kernel-owned slots left as-is. `converged` (adjust phase only) — your
honest convergence judgment.
