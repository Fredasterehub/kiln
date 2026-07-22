# The carrier law

Kiln's organs — the conductor skill, the kernel workflow, the six cards, the Da Vinci
facilitator — each run in a separate context and share nothing but what they hand across a
seam. This is the consolidated register of those seams: what crosses, in what shape, and
where each seam lives in the source. The code is the law; this file names it and must not
drift from it.

Two rules hold at every hop, and they are why the handoff stays honest as the pipeline grows:

- **The kernel is content-blind.** It branches on closed machine facts and routes paths; it
  never parses prose (`workflows/kernel.js`, `meta.description`). A prose bug can never
  mis-schedule a run.
- **Reuse over invention.** No hop mints a new carrier file when a durable artifact already
  carries the meaning. Fewer registers, fewer ways to drift.

## The two carrier registers

Two things flow organ→organ, and confusing them is how a handoff rots. Keep them separate:

**The kernel envelope** — the `facts` block plus one narration beat: a status, a handful of
artifact pointers, a self-attestation flag, and the `narration_beat`, a string that may run
from a single line to a full display frame. In practice the machine facts stay small, but that
smallness is design intent, not an enforced property — `STAGE_RESULT` sets no `maxLength` on
the strings and no `maxItems` on `pointers`, and `meter` is an unrestricted object. The kernel
reads the `facts` and nothing else to decide what happens next. Small machine surface by design
— the fewer closed facts it branches on, the fewer ways a handoff can drift.

**The Kiln Compact** — the named semantic-handoff anchor: the prose context that flows
organ→organ so a later organ understands what an earlier one *meant*. The design target is a
bounded ~1–2k-token view, but that bound is intent, not an enforced property — the live
carriers below are unbounded (`.kiln/LAW.md` grows with the criteria, `.kiln/decisions.md` is
append-only) and no projection summarizes them yet. The Compact is **not a new file** — it is
the register already carried by the durable semantic artifacts:

- `.kiln/docs/project-brief.md` — the onboarding brief (purpose, users, deliverable,
  constraints, non-goals): the confirmed problem framing the LAW stage plans against, written
  by the earliest producer on either path (onboarding on direct, the vision compiler on brainstorm).
- `.kiln/docs/vision.md` — the confirmed intent (compiled from the sealed brainstorm ledger).
- `.kiln/LAW.md` — the ratified architecture: acceptance criteria, slice plan, expected
  outcomes.
- `.kiln/decisions.md` — the ADRs (append-only; superseded entries are never deleted).
- `.kiln/docs/feasibility.md` — the ratified feasibility read, written by the research sweep
  (`workflows/research-sweep.js`) only when the Gauge research dial is on AND a second family
  ratified a qualifying feasibility candidate. CONDITIONAL: a stand-down or
  no-qualifying-question run has none, so the LAW card weighs it as advisory evidence when
  present and never requires it.

The Compact is distinct from `.kiln/STATE.md`, the *machine* resume register of closed facts
the kernel owns (hop 5), and distinct from the kernel envelope above. The project brief is now
a live carrier (above); a later feasibility digest — or a future projection over these
artifacts — will manage the bounded semantic view the target describes. The conditional
feasibility read is now a live carrier too (above), the research sweep's ratified output. Even so, the Compact must never become
an append-only event ledger: it is meaning-at-rest, not a running log.

## The canonical envelope (hop 3)

The stage-worker→kernel return is one schema, `STAGE_RESULT`, defined in `workflows/kernel.js`:

```
{ facts: { status, pointers, schema_valid, gate_verdict?, meter? }, narration_beat }
```

The kernel branches ONLY on `facts` — the machine face of the envelope:

- `facts.status` — success is exactly `'ok'`; any other string is an honest failure the run
  holds on.
- `facts.pointers` — the artifact paths the stage wrote; the kernel folds them into its route
  set.
- `facts.schema_valid` — the stage's self-attestation that its declared outputs are
  well-formed. It is carried but never checked: the kernel branches on it nowhere, so today it
  is effectively reserved alongside `gate_verdict` and `meter`.
- `facts.gate_verdict`, `facts.meter` — reserved-optional: the extensibility seam later waves
  ride, unpopulated now.
- `narration_beat` — the human surface. The kernel fills its own closed slots and emits it; it
  never reads it as logic. `STAGE_RESULT` constrains it only as a string, so it ranges from a
  single line to a full multi-block frame (validate and report compose titled, evidenced frames
  with quote feet).

`status`, `pointers`, and `schema_valid` are required; the two reserved fields are optional.
All six cards return exactly this shape — see the `## Return` section of `cards/law.md`,
`cards/build.md`, `cards/validate.md`, `cards/report.md`, `cards/brainstorm.md`, and
`cards/onboarding.md` (the two compiler cards return it as conductor-side producers, off the
kernel spine).

## The seven carrier hops

Each hop, mapped to its real seam by file and structure name:

1. **orchestrator→worker** — the kiln-fire conductor (`skills/kiln-fire/SKILL.md`) launches the
   kernel through the Workflow tool, always by path (`workflows/kernel.js`), with a
   self-contained args object `{stage, projectDir, idea, detail, plugin}`. The args are the
   whole launch contract; nothing else crosses.

2. **worker→orchestrator** — the kernel returns `{status, beat, pointers}` to the conductor
   (the `done`/`stop` returns in `workflows/kernel.js`). In ordinary return handling the
   conductor emits `beat` verbatim and reads no plugin or artifact file to make routine
   decisions; the one exception is the single `.kiln/STATE.md` read at resume (hop 5).

3. **worker→kernel** — the `STAGE_RESULT` envelope above. The cards produce it; the kernel
   consumes `facts` and carries `narration_beat`.

4. **stage→stage** — full filesystem artifacts under `.kiln/`. The kernel routes the paths it
   owns through its path map `P` (`workflows/kernel.js`), but `P` does not mediate the whole
   seam: each stage's CARD names its own inputs directly and reads them from disk. The LAW card
   reads `.kiln/docs/project-brief.md` (its durable context input, present on both paths),
   `.kiln/docs/vision.md` when the brainstorm path produced it, and `.kiln/docs/feasibility.md`
   when the research sweep ratified one (advisory, never required); build, validate, and report read `.kiln/LAW.md` and the other
   prior-stage artifacts named in their cards (`.kiln/decisions.md`, `.kiln/validate.md`), none
   of which `P` enumerates.

5. **resume** — the one-page `.kiln/STATE.md`, written by the `stateDoc` writer in
   `workflows/kernel.js`: `stage`, `active_slice`, `next_action`, `density`, `pointers`,
   `seals`, `updated_at`. Closed facts the kernel owns; the conductor reads it exactly once, at
   resume.

6. **repair** — the review JSON at `.kiln/gate-review.json` (schema `scripts/review-schema.json`):
   `review_id`, `law_hash`, `findings[]` (each with a `criterion` and a finding `id`),
   `blockers[]`, `verdict`; plus the repair-delta pointer at `.kiln/repair-delta.md`. The
   `reviewLoop` in `workflows/kernel.js` carries this across gate → repair → recheck. It runs
   for exactly two seams — LAW ratification and build-slice repair; validate and report have no
   review loop (report gates only on the report file existing).

7. **facilitator→orchestrator** — Da Vinci (`agents/da-vinci.md`) seals the append-only
   `.kiln/brainstorm-ledger.jsonl`, then sends the conductor a single `BRAINSTORM_COMPLETE`
   envelope: the sealed-ledger pointer, the entry count, and the user-authored essence — never
   the dialogue. On that envelope the conductor launches the compiler, which writes
   `.kiln/docs/vision.md`, `.kiln/docs/project-brief.md`, and `.kiln/posture.json` from the
   ledger alone and returns the canonical `STAGE_RESULT`
   envelope (hop 3) — `skills/kiln-fire/SKILL.md` and `cards/brainstorm.md` agree on that one
   shape; the conductor speaks its `narration_beat` and advances to the law stage only once
   `facts.status` is `'ok'`. One completion fact and one beat cross; the chat scroll never does.
   The direct path (`/kiln-fire <idea>`) has a mirror producer with no facilitator hop: the
   onboarding compiler (`cards/onboarding.md`) writes `.kiln/docs/project-brief.md` and
   `.kiln/posture.json` from the idea alone and returns the same `STAGE_RESULT` envelope before
   the law launch. One producer per path; the LAW input gate verifies the brief and posture on
   closed machine facts before planning either way.
