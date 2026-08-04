# Implementation flow — how the anvil runs, milestone by milestone

Binds `product/charter.md`'s workflow-launch and return-handling law (its own §"Launching a phase workflow", §"Phase sequencing", §"Blocker ladder → agreement pass", §"Verification doctrine") to the product law's implementation rule ("Implementation, per milestone/vertical slice — JIT, TDD") and to its verification architecture (JIT journey authoring, the anti-brittleness checklist). The runtime contract every workflow script holds to is `workflows/README.md`; the order this phase actually walks is `machine/src/spine.js`. This document is Kiln's own operating knowledge for one phase — what each step MEANS, what it leaves behind, and what a failure signifies — never a sequence to execute by hand and never scraped for state: a script reads records, never prose.

The anvil (phase 6, `machine/phases-registry.json`'s `implementation` entry) is `interactive: false` — no operator judgment is required to run it. Every escalation this flow names routes through the blocker ladder (`product/charter.md`'s own section, used as-is and never extended) and, beyond that, the pipeline-wide agreement-pass default, never a hosted operator conversation mid-milestone.

## The engine

**You launch `workflows/implementation.js` once, read what it returns, say a line, and launch it again.** That is the whole of your part. The script performs exactly ONE durable transition per invocation: it asks `machine/src/spine.js` what is next given what is on disk, does that one thing, records it, and hands back one of five returns with a record ref. It holds nothing between invocations and neither do you — the tree is the state, so a session that dies mid-milestone is resumed by launching again.

Two things follow, and they are the point of the design rather than side effects. **You are not the scheduler**: which milestone is active, whether a chunk may seal, whether a red gate blocks the next step — none of those are your judgment or a worker's, they are `spine.js`'s, decided from canonical files. And **nothing here is spawned from your seat**: every seat this phase uses is bound by the workflow's own agent steps, with its tool fences, its dispatch receipt, and its terminal. Your side of the loop is the launch, the beat, and the operator.

The five returns are `product/charter.md`'s law; what each one means HERE:

| return | in this phase | your next move |
|---|---|---|
| `beat` | one rung of the ladder landed — a milestone opened, a chunk built, a review verdict recorded, a chunk sealed | say the beat the record supports (The story, charter), launch again |
| `phase_complete` | every milestone the architecture planned is green and the phase has advanced | the phase is closed; go on to verification |
| `operator_needed` | a decision is genuinely the operator's — a revise loop at its cap, a steer this phase is not building, a milestone review asking for changes to a slice already sealed | put the question to them and stop (**BLOCKED-OPERATOR**); at the revise cap — and only there — their answer comes back as that cap's own hold exit, never as prose the resolver is asked to read (Failure paths, below) |
| `needs_consult` | a worker asked its designer what the brief MEANT, and THIS invocation answered it — the answer is already promoted | nothing for you to answer; launch again and the work resumes with the answer on disk |
| `blocked` | a gate is red or a transaction refused — a failed preflight, a chunk whose suite does not pass, a milestone whose regression floor breaks the project | say what blocked it and why, from the record the return cites |

`blocked` is not an error and not a defect in the script: it is the machine reporting, with a record ref, that the next thing cannot lawfully happen yet. An error is a script that threw.

## The ladder — what each rung means

`spine.js` owns the order; this is what the rungs are FOR. The first thing that is not settled decides the whole answer, so the ladder is read top to bottom and a later chunk's state is never the next thing to do.

**Opening.** A milestone that the architecture plans and the index does not carry yet is opened as one transaction — branch creation, `createMilestone`, and the index row together, recoverable at any interruption. The transaction is only half of it: the transition is complete when its deterministic envelope (`envelopes/implementation/open.<milestone>.json`) is on disk beside it, and until then the resolver asks for the same `open-milestone` again — the transaction replays from what it already wrote, and the envelope writer finishes the pair. One live session died in exactly that gap and the milestone was left open with no record of having been opened. A milestone declaring a toolchain profile then preflights: probe the target project, scaffold and install only what the probe found missing, and re-probe through the honesty gate. The re-probe IS the gate, so "the install exited zero" can never stand in for "the toolchain is actually there". A red preflight blocks: nothing after it is reachable until a green preflight gate is on record, because a chunk whose implementer cannot run the target project's suite is a chunk that cannot go green.

**Spec.** The designer decomposes the slice into chunks — per chunk WHAT to build and WHAT must be true of it, never HOW. The decomposition lands in two forms from one step: `spec.md`, the prose a seat reads, and `chunk-plan.json`, the same decision in the form the machine walks. Both are needed: prose cannot be asked which chunks exist, and without that answer the resolver cannot tell an unstarted chunk from a chunk nobody planned.

**Per chunk, in plan order.** A brief (the eight fields `validators.js` enforces) → a build in an isolated capsule → the build recorded against the dispatch that produced it → a cross-family review → a green suite gate → the seal → the chunk-affected write (the journeys that chunk's own sealed commit touched, fed into `verification/affected-map.json`) → the post-seal repair (the working tree brought level with the commit and the capsule closed). Each of the last two is its own rung with its own envelope rather than trailing work inside the seal, because a crash behind a seal would otherwise skip it forever — leaving a queue that never heard of the chunk, and a tree too dirty to close a milestone in. A `revise` verdict sends the chunk back to the same seat with the review it must answer; the revise loop is capped in code, and at the cap the resolver stops asking and the operator decides — an answer of `resolved` buys exactly one more round, which then walks the same review, gate and seal as any other (Failure paths, below). A chunk is ready to be looked at when it has more successful attempts than reviews — which is why a revise needs no second lifecycle record and why an attempt that failed is a failed attempt rather than a chunk somebody must review.

**Closing.** Review the slice as a whole, then the regression floor, then close — in that order, and the order is load-bearing. A slice that does not compose to its goal should not spend a full regression run; a green slice that breaks the project is not closeable; and the close transaction refuses unless every chunk sits at `chunk-green` and the merge and tag it is told about verify against the real repository. Merge, tag, and the index flip are one recoverable transaction, so a crash between them finishes rather than leaves a milestone half-closed. Close carries the same pair discipline as opening: a green index row whose `envelopes/implementation/close.<milestone>.json` is missing resolves back to `close` — ahead of the next milestone and ahead of the phase advance, since both would walk past it forever — and the replay derives its review evidence from the green row itself, which is where the close bound it.

**Phase advance.** Every planned milestone green advances the phase, and the return says `phase_complete`.

## The seats — one step of judgment each

Six seats, each doing one thing inside one workflow step and returning:

- **`milestone-designer`** — the decomposition (`spec.md` + the chunk plan), each chunk's brief, and consult answers. It authors judgment; it records nothing.
- **`implementer-sol`** (routing's `implementer` seat, the default — Sol implements most) and **`implementer-opus`** (`implementer_ui_creative`, UI/creative milestones) — one chunk, test-first, inside its capsule. Fable never implements, in any mode.
- **`chunk-reviewer-sonnet`** and **`chunk-reviewer-sol`** — the cross-family chunk verdict, scoped to the diff under review.
- **`milestone-reviewer`** — the cumulative slice review plus its security paragraph.

`agreement-pass` is this phase's escalation seat, unchanged.

**Which family reviews is decided by code, from evidence.** `machine/src/family-evidence.js` reads who ACTUALLY built a chunk — the family proven by that build's dispatch terminal, not the family the routing intended — and returns the cross-family reviewer seat for it; `selectMilestoneReviewer` does the same one level up, from the milestone's own `chunk-built` records, and a tie routes to the conservative side. No model chooses its own reviewer, and the seal itself re-checks the review family against actual authorship. That is why an intent-outcome split — a Sol dispatch that ends up finished by Claude — can no longer produce a same-family review that every downstream check would pass.

## Artifacts — staged, then promoted

**No agent step writes a canonical artifact.** Six classes are promotable and the set is closed — `spec`, `chunk-plan`, `brief`, `review`, `milestone-review`, `consult`. For each of them a seat writes what it authored to the staging path its step names, and `machine/src/promotion.js` is the only thing that moves it into the place the machine and every later reader treat as true; an artifact that fails its class validation stays staged exactly where it is, so the next attempt can see what was rejected and nothing canonical changed. A seat that wrote one of these anywhere else wrote into a directory nothing reads.

Two seat outputs are deliberately not promotions, because neither is a decision the tree records: an implementer's work, which lives in its capsule and crosses as a patch, and its own dispatch result file, which the workflow names and the terminal cites. Both are read; neither becomes canonical by being written.

Every lifecycle record in `milestones/<id>/chunks.jsonl` is written by the machine through the workflow, never by a seat: `chunk-spec` when a brief promotes, `chunk-start` once per chunk as the recorded intent, `chunk-built` from the dispatch terminal's own evidence, `chunk-review` from the promoted verdict, `chunk-green` from the seal transaction. A seat has no call to make and no stream to append to.

## The capsule

An implementer works in a git worktree of the milestone branch, checked out where the project tree is not. The machine tree is absent from it — not hidden, absent — so a planted ledger, chunk stream, or state file sits in no worktree of the branch and no export can carry it. One fact crosses, and it is a patch: the capsule's tracked surface, verified against its own digest before it governs a HEAD-seeded index. The approved diff IS the staged diff, and that is what the seal commits.

"Tracked surface" is literal, and it is the one thing an implementer must do something about: the export reads `git diff HEAD` in the capsule, which carries every edit to a file the branch already has and carries a NEW file only once it is in the capsule's index. So the seat contracts require exactly one git action of an implementer — staging the files its chunk created, and nothing else. A new file nobody staged is a file that leaves the capsule as if it had never been written.

Not claimed, in the same breath: nothing about this resists a same-user process writing directly to `.git`, to the patch file, or to a machine record. Those writes go around this path rather than through it.

The reviewer reads the STAGED diff in the project — the index the patch produced — plus read access, never the capsule and never write access to the working tree. Patch bytes and the index's own rendering of them are two different identities and the machine keeps them apart: the patch digest is what identifies the artifact that was applied, the staged digest is what the seal compares. Reviewing the index is reviewing what will actually be committed.

## Consults

A worker that hits genuine ambiguity about what the brief MEANT — not what code to write — files a consult request into staging and ends its step. The resolver derives a pending consult from the pair (a request with no promoted answer beside it) and pre-empts the ladder with it: the NEXT invocation runs the designer's answer step, promotes the answer, and returns `needs_consult` — the return reports work already done, not work owed. The invocation after that resumes what was asking, with the answer on disk. Every answer is a verdict PLUS a verbatim anchor: the exact quote and its file:line, never a paraphrase, which is the deformation-in-retelling this seam exists to prevent.

Nothing waits, and nothing is delivered: pending is derived from disk, so a session that dies between the question and the answer resumes at the same place.

## Steering

An operator word that reaches you mid-build is recorded as a steer (Steering, charter) and read by the resolver FIRST, before any rung of the ladder. A steer against what this phase is building now is applied and the transition reflects it; a steer against anything else returns `operator_needed`, because what happens to it is the operator's call and not the resolver's. Applying a steer one transition later would be applying it to a build that has already moved.

## Failure paths

**A step died mid-dispatch.** A dispatch opened and never closed is settled before anything else is decided — the outcome nobody can know is recorded as unknown rather than guessed, and a relaunch is a new dispatch, never a reuse of the dead one.

**A build failed.** A failed attempt is closed with the reason already in hand and leaves nothing staged. The chunk is still owed a build, and the next invocation dispatches one.

**The revise loop stops converging.** Capped in code, and at the cap the return is `operator_needed` rather than another revise — the loop has stopped being progress. The stop raises a hold whose id is the cap's own (`implementation:revise-cap:<milestone>:<chunk>`), and that hold's ONE exit is where the operator's answer lands (charter's Bash law point 12): `resolved` authorizes exactly one more build/review round, `delivered` records the answer and leaves the cap standing, citing that record instead of asking again. Two things follow and both are deliberate. **The authorization is single-use by its identity, not by a flag**: if the authorized round comes back `revise` too, the next cap is a hold of its own — `…:<chunk>:r<review-count>` — so the answer that bought round four cannot silently buy round five. And **the answer buys a round, never an approval**: a fourth verdict of `approve` walks the same cross-family review, the same green suite gate and the same seal as every other chunk, because `chunk-green` refuses anything else. "Ship it as-is" is therefore not vocabulary here, and rebriefing the chunk is replanning through the existing reopen path rather than an exit from this stop.

The resolver reads only the exit word — never the tablet entry the resolution cites, never a steer's instruction. An operator word arriving as a steer is recorded and read (Steering, above), but its text reaches no consumer on this path by design: a resolver that acted on prose would be making the decision it just handed over.

**A gate is red.** A red preflight, a red chunk gate, or a red regression floor returns `blocked`, citing the gate record. Gate reads take the LATEST record for a gate id, so a tree is never held to a failure a later record has already answered — but no sanctioned transition re-runs a gate after remediation, and this document does not promise one (The honest gaps, below). A red gate is a stop with a record behind it, reported as one.

**No second family reachable for a review — the phase stops, and says so.** When a chunk's only lawful cross-family reviewer belongs to a family this session cannot reach (a claude-built chunk with no gpt model available), there is no reviewer to seat. A same-family reviewer is not the answer and is not offered: one family's blind spots reading that same family's work is not the check the law asks for, and the seal refuses that pairing outright, so a chunk reviewed that way could never be sealed anyway — the review would be work paid for against an outcome the machine had already ruled out.

So the resolver declares the stop BEFORE any reviewer is dispatched. It returns `blocked`, and the invocation writes exactly one `degraded-route` record for that chunk naming what was expected (`gpt`), what stood in (`none`), and why. The record's identity is the chunk's own route, so a relaunch resolves the same stop and reuses the record rather than adding a second. That record is what the fire speaks its one honest line from and what carries the gap to the operator at delivery — an unreviewable chunk is a real hole in what was proven, never a quieter grade of proof (Launching a phase workflow, charter).

**There is no implementer degradation on this path** — no transition substitutes another family for a build — so a Codex outage during a build is a failed attempt and a blocked or re-dispatched chunk, not a quiet fallback. A chunk the gpt family built is untouched by any of this: its reviewer was already a claude one. The Fable-never-implements ban holds unconditionally in every mode.

**A milestone declares no toolchain profile.** Lawful at the milestone boundary — it means "nothing beyond what is already installed" — and it becomes a problem only at the rung that needs a suite command, where the resolver blocks citing exactly what it needs. The wall goes where the wall actually is.

**Post-merge regression.** See Rollback law, below.

## Registry conformance

`machine/phases-registry.json`'s `implementation` entry:

```json
{
  "id": "implementation",
  "entry_checks": ["architecture-gate-approved"],
  "exit_emits": ["milestones/index.json"],
  "exit_checks": [
    { "file": "milestones/index.json", "check": "file-nonempty" },
    { "file": "milestones/index.json", "check": "milestones-all-green" }
  ]
}
```

`milestones-all-green` (a `machine/src/phases.js` `EXIT_CHECK_KINDS` entry) reads `milestones/index.json`, requires a non-empty `milestones` array, and requires every entry's `status` to read `"green"` — the only writer of that field is `closeMilestone`, inside the close transaction, so this check is really asking "has every milestone this run created been through the close sequence," structurally, at the one phase boundary that matters. `file-nonempty` checks a cheaper, distinct fact and runs alongside it: proving the file exists and has content is not the same as proving its content means "done."

## Rollback law

A regression discovered after a milestone merged — a later milestone's chunks break what this one had proven green — resets to the LAST green tag. No transaction owns this: the chunk commit, the merge and the tag belong to the machine, but a rollback is a decision somebody makes about work already landed, and it stays your own narrowly-scoped Bash (`product/charter.md`'s Bash law point 4).

- **Unmerged milestone branch, abandon it.** `git checkout main && git branch -D milestone/<id>` — `main` is provably untouched (`git diff --exit-code <last-green-tag>` returns 0), since an unmerged branch never touched `main`'s own tracked files.
- **Already-merged bad milestone, roll `main` back.** `git checkout main && git reset --hard <last-green-tag>` — restores `main`'s tracked files to exactly the tag, discarding every commit after it, not merely the offending one. This is why the regression floor runs BEFORE the merge: catching a regression pre-merge needs no reset at all, only a blocked return and a fix.
- **Immediate-window recovery only — never a standing guarantee.** A discarded commit stays reachable via `git reflog`/`git show`/`git cat-file` only until `gc.reflogExpireUnreachable` (default 30 days for the unreachable case, not the general 90-day `gc.reflogExpire`) or a manual `git gc` prunes it. A rollback executed promptly is safe; `git reflog` is not permanent archival, and this law never claims it is.

## The honest gaps

One thing this phase used to do, or would need to do, and that no transition on the workflow path performs. It is not invented back here: a claim that some seat does it would be an authority the machine does not honor, which is the one thing this document must never carry.

**A red gate is a terminus, not a loop.** The resolver returns `blocked` for as long as a preflight, chunk, or regression gate's latest record is red, and no sanctioned transition re-runs that gate — remediating the cause does not, by itself, put a green record on the tree, and the fire is forbidden to run the gate by hand as a substitute. So a red gate today ends the phase's own progress and the operator hears why, with the record cited. A re-run rung belongs to whichever slice decides what remediation is allowed to look like.

**`verification/affected-map.json` no longer belongs on this list.** The per-chunk affected-journey entries `product/verification/flow.md` attributes to the chunk-green step are written at the chunk-green step: the `chunk-affected` transition, through `verification.js`'s `recordChunkAffected`, which merges them into the map `recordAffected` — still the file's only writer — puts down. It is a lifecycle point of its own, ahead of the post-seal repair and never folded into it: what a chunk AFFECTED is recorded the moment the chunk is green, what a chunk ADDED is catalogued when the seal's repair runs. Which journeys a chunk affected is DERIVED and never claimed: the catalog says where each journey's script lives, the chunk plan's nomination says where its own new one does, the sealed commit says which paths it changed, and the intersection is the entry, one `affected_by` ref per `<milestone>/<chunk>`. A chunk whose diff touches no journey script leaves the map untouched, and re-driving the same chunk-green writes nothing at all.

**`verification/journeys.json` no longer belongs on this list either.** The catalog `assembleSuite` reads is written by the post-seal transition, through `journeys.js`, one entry per journey a chunk's plan nominated. Journeys are still authored JIT by the chunk's implementer and reviewed in that chunk's own review; what changed is that the entry is now the machine's own write and it waits for the seal, because the seal is the first moment the script is committed work a review has already trusted. The nomination travels as DATA in `chunk-plan.json` — the same reason the chunk list does, since prose cannot be asked which journey a chunk closes — and the entry's `criterion_id` is derived from the frozen criteria register rather than stated by anyone. A chunk that nominates nothing leaves the catalog untouched.

## Telemetry

This phase records no `review_pass` event on the workflow path. The event was recorded by the reviewing seat under the manual schedule; no workflow step runs the telemetry pair, and a seat inside a workflow step has one job and no second one. Charter's Bash law point 10 still owns the invocation form for every event that does have a caller — this one is suspended until a slice gives the workflow a telemetry step, and saying so is cheaper than a law nobody executes.
