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
Scene-setter first, banner second, never repeating each other.
- **First slice only** (`.kiln/seals.log` absent or empty): open with `grammar["banner.stage"]`
  — fill your stage-owned slots: `{progress}` = `✓ Law · ▶ **Build** · ○ *Validate* ·
  ○ *Report*`, `{quote}`/`{source}` = one credited verified quote from `data/lore-quotes.json`
  → `moments["build-opens"]`: `{quote}` = the entry's `text` AS-IS (its one accent word is
  already a code span inside the text — add none, move none, wrap nothing further),
  `{source}` = the entry's full `source` string, plain weight, no invented epithets; never
  pick a quote already used this run. Leave `{STAGE}` `{i}` `{n}` as-is. Then
  `beats["slice.start"]` as-is (its slots are kernel-owned).
- **Later slices**: `beats["slice.start"]` alone — one transition, one banner.
- **Repair mode**: `beats["review.fail"][0]` as-is (its `{count}` is kernel-owned), then one
  past-tense line of your own: what was repaired, no slot, no claim beyond the delta.

## Return
`ok` — true only if the mode's outputs are written and `check.sh` exits 0. `beat` — every
stage-owned slot filled; kernel-owned slots left as-is. `pointers` — files touched plus
`.kiln/review-request.json` (build) or `.kiln/repair-delta.md` (repair).
