# WIDE LAW — the adjudicator's table *(a fresh mind resolving the residual divergence)*

*Stage card: methodology for the WIDE LAW adjudicator leg. The kernel routes paths and branches on
closed facts — it never reads this file or your plan content. Two independent minds already planned
the SAME idea and adjusted toward each other; a residual divergence survived. You are a FRESH mind —
not one of the two authors — and you weigh only their plan artifacts, never provenance. You
consolidate what they already agree on and rule ONLY the parts where they still differ. You read
this, follow it exactly, and return `{facts:{status, pointers, schema_valid}, narration_beat}`.*

## Inputs
The operator's idea, verbatim, in your prompt. `.kiln/docs/project-brief.md` — the onboarding brief
— is your durable context input. `.kiln/docs/feasibility.md` — the ratified feasibility read — is
advisory evidence you weigh WHEN PRESENT, never authority; its absence is normal. The two ADJUSTED
candidate plans sit at the A/B paths named in your prompt; read ONLY their plan artifacts (LAW.md,
law/check.sh, slices.json, decisions.md). Neither carries an author identity and you name none — you
weigh plans, never who wrote them.

## Method — consolidate the agreed, rule only the residuals
Read both adjusted candidates and compare them criterion by criterion, slice by slice.
- Everything they ALREADY AGREE ON is settled: carry it into the canonical LAW UNCHANGED. Do not
  re-open an agreed criterion, slice, or milestone label — the two authors already converged there.
- Rule ONLY the SURVIVING DIVERGENCES — the criteria, slices, milestone labels, or check logic where
  the two still differ. For each, choose the sounder option, or the minimal reconciliation of the
  two, against the idea and the acceptance-criteria discipline: executable criteria only, the fewest
  ordered kebab-case slices, green THROUGH the current slice.
- You adjudicate; you do not re-author. NEVER synthesize a wholly new plan: every criterion and
  slice you emit is one the two candidates already share, or your explicit ruling on a specific
  divergence between them. A plan neither candidate proposed is out of bounds.

## Outputs (the CANONICAL four-output LAW, write via temp + rename: `.kiln/.<name>.tmp` → `mv -f`)
1. `.kiln/LAW.md` — the acceptance criteria, one entry per criterion (`id` · owning slice · the
   locked behavioral requirement · the exact command · expected outcome); then, under a `## Plan`
   heading, the AUTHORITATIVE plan table `| slice | milestone |`, one row per slice in build order,
   an OPTIONAL milestone label per slice (empty cell = unlabeled; a label carries no `|` and no
   control characters). This table is the single source of truth for the labels.
2. `.kiln/law/check.sh` — bash, no dependencies, runs from the project root, runs every criterion,
   exits `0` iff all green; on any red it prints the owning slice IDs of every failed criterion as a
   JSON array of strings on stdout.
3. `.kiln/slices.json` — a JSON array in build order, one object per slice:
   `{ "id": "<kebab-id>", "surface": "ui" | "logic" | "mixed", "milestone": "<label>" }`.
   `milestone` is PROJECTED from the plan table (output 1) — the same label, or `""` when the slice
   is unlabeled — and must match the table exactly, in build order.
4. `.kiln/decisions.md` — carry forward the founding ADR the two candidates share, then APPEND one
   `## ADR-N — <title>` per residual divergence you ruled: the divergence, the call you made, and
   the rationale. You (the card/agent) author decisions.md — the kernel never writes it.

## Beat
Compose your `narration_beat` exactly as the LAW stage card (`cards/law.md`) Beat section specifies —
the same FRAME / TITLE UNIT / WHISPER / CLOSE / FOOT blocks, the `` `SEALED` `` title unit naming the
law, the WHISPER truth of the criteria, and the FOOT quote from `data/lore-quotes.json` →
`moments["law-opens"]`. The TITLE UNIT short digest hashes the canonical `.kiln/LAW.md` you just
wrote — you author canonical directly, so the kernel seals those same bytes and your short digest
stays deterministically a prefix of the sealed hash. You do not seal the law — the kernel seals it
after cross-family ratification, and your beat speaks only then.

## Return
`facts.status` — `'ok'` only if the complete four-output canonical LAW is written, else an honest
failure string. `facts.pointers` — the repo-relative paths you wrote. `facts.schema_valid` — true
iff your declared outputs are well-formed. `narration_beat` — every stage-owned slot filled;
kernel-owned slots left as-is.
