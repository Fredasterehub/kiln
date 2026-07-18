# BUILD — KRS-One takes the stage *(stage 2 of 4: law → build → validate → report)*

*Stage card: methodology for the stage agent. The kernel never reads this file — it routes
paths, drives the gate through `scripts/kiln-review`, owns repair dispatch and seals. You
build and evidence; you never invoke the transport, write `gate-review.json`, or touch
`seals.log`. Return `{ok, beat, pointers}`.*

## Mode: build *(prompt says "Build exactly slice `<id>`")*
1. Read `.kiln/LAW.md` and take ONLY your slice. Working code lives in the project
   workspace; control and evidence artifacts live under `.kiln/`.
2. Build the slice. Then run `bash .kiln/law/check.sh` — return only when it exits `0`.
   The kernel reruns it before the seal; a red reopens your slice.
3. Write `.kiln/review-request.json` (temp + rename). The gate transport's model and effort
   are named once in `data/tiers.json` (beside `data/voice.json`) — read `roles["reviewer-gate"]`,
   resolve its `alias` through that file's `resolver` map to a concrete id, and write the pair.
   The parser requires these fields with these types (unrecognized fields are ignored):
   - `reviewer_model` — the concrete id at `resolver[roles["reviewer-gate"].alias]` in
     `data/tiers.json` (tune the gate transport there, never here — zero kernel changes)
   - `reviewer_effort` — `roles["reviewer-gate"].effort` from the same file, one of
     `low` | `medium` | `high` | `xhigh`
   - `law_hash` — the digest from `.kiln/law/lock.hash`, verbatim (lowercase sha-256 hex)
   - `criteria` — your slice's LAW criteria, verbatim, one nonempty string
   - `paths` — repo-relative files you touched (string array)
   - `failures` — observed failures, `[]` if none (string array)
   - `commands` — the check commands the reviewer may run, `check.sh` first (string array)

## Mode: repair *(prompt says "Repair pass N for slice `<id>`")*
1. Read `.kiln/gate-review.json`. Fix ONLY the listed finding IDs, at their evidence
   locations — nothing else moves.
2. Run `bash .kiln/law/check.sh` back to `0`.
3. Write `.kiln/repair-delta.md` (temp + rename): one entry per finding ID — what changed,
   where, in past tense. The recheck reviewer reads exactly this against its own findings.

## Beat (fill every stage-owned slot; leave every kernel-owned slot from the sealed
`data/voice.json` slots map unfilled)
You compose the display blocks — `data/voice.json` → `panel` is the encoding; every build
beat is THE CARD (`panel.compositions.card`, per `panel.recipes["greenfield-small"]` /
`panel.recipes["brownfield-large"]`); the conductor renders nothing. Scene-setter first,
then the blocks, never repeating each other.
- **Build mode, every slice** — scene-setter: `beats["slice.start"]` as-is (its slots are
  kernel-owned). Then the blocks, in this literal order:
  - **FRAME** — `grammar["banner.stage"]`: `{name}` = the project's name in words;
    `{progress}` = the strip per `grammar["progress.form"]`: `✓ *Law* · ▶ **Build** {s}/{t} ·
    ○ *Validate* · ○ *Report*` — sealed and pending names italic, bold only the active
    phase, the fraction ONLY there (it counts `.kiln/slices.json`, the named on-disk
    checklist, kernel-filled); then a newline and one two-space-indented glyph-free unfold
    line naming the slices in reader-meaningful subject matter — plain = sealed, `accent` =
    on the anvil now, *italic* = ahead; never process labels; the line never wraps (window
    past ~8 items with true count-words).
  - **TITLE UNIT** — exactly one: `` `RUNNING` **<this slice at concept altitude — actor →
    action → what it unlocks>** (`<your literal harness handle; omit rather than
    invent>`) `` — the strip already carries the bold Build marker.
  - **WHISPER** — one blank line, then a two-space indent, then ONE tight italic sentence:
    the focal truth of the slice on the anvil. Never fog, never a paragraph.
  - **SHADOW** — later slices only (`.kiln/seals.log` nonempty): one plain line for the
    just-sealed slice — its name plus one clause of what it gave the present;
    single-family seals say so plainly; at most two shadow lines, everything older lives
    only in the strip's ✓ and the unfold's plain names. First slice: no shadow — the
    present stands on nothing that needs naming.
  - **CLOSE** — one short plain narrative line: what starts when this slice crosses.
    Never a numbered list.
  - **FOOT** — OUTSIDE the frame, below the body: `grammar["rule.light"]`, a blank line,
    then `` `"{quote}"` — {source} `` — one credited verified quote from
    `data/lore-quotes.json`: the first slice (`.kiln/seals.log` absent or empty) draws
    `moments["build-opens"]`, later slices draw `moments["slice-opens"]`, rendered per
    CAL 17: `{quote}` = the entry's `text` with any embedded backticks DROPPED (the WHOLE
    quote rides in one code span — nested spans break; add nothing, reword nothing),
    `{source}` = the entry's FULL `source` string, plain weight, no invented epithets;
    never pick a quote already used this run.
- **Repair mode** (the gate-reject path), per `panel.recipes["repair-loop"]` —
  scene-setter: `beats["review.fail"][0]` as-is (its `{count}` is kernel-owned). Then the
  blocks, in this literal order — with NO foot (the repair moments stay unwired; repair is
  mid-fire, not ceremony):
  - **FRAME** — as in build mode; the strip still reads `▶ **Build** {s}/{t}` — repair IS
    running, no new state word.
  - **TITLE UNIT** — exactly one: `` `RUNNING` **Repair pass {passes} — the findings go
    back to the forge** (`<your literal harness handle; omit rather than invent>`) `` —
    `{passes}` is the gate's own counter, kernel-owned.
  - **WHISPER** — one blank line, then a two-space indent, then ONE tight italic sentence
    carrying the findings count (`{count}`, kernel-owned).
  - **FAULT LENS** (`panel.blocks.fault_lens` — this is the one build surface that carries
    it): three plain lines — `Fault:` the FIRST causal finding at concept level, `Blocks:`
    the seal it blocks, `Evidence:` where it lives in words (`.kiln/gate-review.json`
    holds the rest).
  - **CLOSE** — one past-tense line of your own: what was repaired, no slot, no claim
    beyond the delta; the recheck reads exactly this next.
Leave every kernel-owned slot (`{s}` `{t}` `{passes}` `{count}` among them) exactly as-is.

## Return
`ok` — true only if the mode's outputs are written and `check.sh` exits 0. `beat` — every
stage-owned slot filled; kernel-owned slots left as-is. `pointers` — files touched plus
`.kiln/review-request.json` (build) or `.kiln/repair-delta.md` (repair).
