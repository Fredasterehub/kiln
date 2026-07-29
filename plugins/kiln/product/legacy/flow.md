# Legacy intake — what happens to an earlier Kiln tree

An older Kiln left a tree behind, in the exact place this version's tree wants. This document is the whole of what happens next: the tree is set aside whole, a fresh one is built in its place, what can be carried honestly is copied out into a namespace of its own, and the operator is told — before they are asked anything else. Nothing in the older tree is deleted, repaired, resumed, or rewritten, at any point, in any failure path. That is not a policy this document chose; it is the property every mechanism below is shaped around.

Binds `machine/src/detect.js`'s five-way classification and its `legacy` outcome (`evidence.legacy_tier`, `evidence.legacy_markers`), `machine/src/intake.js`'s archive and harvest legs, and `machine/src/validators.js`'s `validateIntakeReport` and `TRUST_FLAGS` — as actually built, read in full before citing, never assumed from a module's name. `product/onboarding/flow.md` owns **where** the two legs sit in the door ((a0) and (d)) and this document owns **what they do**; `product/brownfield/flow.md` owns the scout pass a legacy project with code takes afterwards, unchanged; `product/doctrine.md`'s stream table owns the one ledger kind this leg writes; `product/voice/kiln.md` is LAW for the operator moment below. Same class of artifact as `product/brownfield/flow.md` — Maestro's own operating knowledge for one onboarding sub-flow, read by Maestro and by `onboarding-runner` to know their own place in the sequence. Every runtime command this document names lives in `agents/onboarding-runner.md`'s own Method: this file is plugin payload, so a command stored here would reach Bash with its plugin-root prefix unresolved.

## 1. Recognition — a ladder of shapes, never a version number

`detect()` does not ask what version built the tree. It asks what shape the tree has, because the version question has no honest answer: what shipped as a released tag and what the dev line looked like at that moment are different shapes wearing the same number, and a tree can be half of either. Shape is what is on disk; a version is a claim about it.

Two tiers, and a tree that matches neither is still never refused:

- **Tier 1 — the shapes read in full.** A strong marker (`LAW.md`, `slices.json`, `law/`, or a seal record in either form) plus corroboration (`decisions.md`, `posture.json`, `docs/project-brief.md`, `docs/feasibility.md`) — at least one strong marker, and at least two of these slots filled, the two forms of the seal record counting as one slot rather than as two independent votes. Every marker is checked as the node type it must be: a `LAW.md` that is a directory is not a `LAW.md`, and a marker that is a symlink is never counted at all. This is what earns the typed harvest of §3.
- **Tier 2 — everything else with a tree in it.** One marker alone, a v1-era shape, something a fork built: recognized as an earlier tree, harvested generically (§3.3), and said plainly to the operator as a shape not understood. Tier 2 is the floor, not the failure case.

A valid current `state.json` always wins over any marker set — a working tree of this version is a `resume`, never an intake. A tree that fails that validity check and has no legacy shape is a `broken-install`: a crashed install of the current version, fixed rather than migrated. The two are different outcomes with different owners, and neither is guessed into the other.

**Refusal is a property of the filesystem, never of a shape.** No version is ever refused for being old (§5).

## 2. The transaction — one ladder, resumable at every rung

`scaffoldTree` refuses an existing tree unless `force` is set, and `force` deletes the whole directory before rebuilding. So the older tree has to leave `.kiln/` before anything can be built there, and **`force` is never passed** — not as a retry, not as a fallback, not to clear a stale directory. It is the one code path that could destroy a legacy tree, and this leg is the reason it exists to be avoided.

The set-aside is a rename, not a copy: contents, permissions, modification times, and nested symlinks all move untouched, because a rename does not walk the tree. It also has no half-state — which is what makes every interruption below recoverable rather than merely unlikely.

The whole sequence runs as one transaction with a durable identity: a marker directory at the project root, holding a record of the transaction's own id, the project root it belongs to, and the rung it has reached. The marker is what makes an interrupted intake **recognizable** rather than merely broken — `detect()` looks for it before anything else, so a session that died mid-transaction re-enters exactly where it stopped instead of classifying the wreckage as something else. Five rungs, in order: **claimed** (the transaction exists), **archived** (the older tree is set aside under the marker), **scaffolded** (a fresh tree stands in its place), **placed** (the older tree has been moved into the new tree's own `archive/legacy-N`), **harvested** (the report and the ledger record are written, and the marker is retired).

Three properties hold this together, and each is machine-enforced rather than merely intended:

- **Exactly one owner.** The whole transaction runs inside the same lock the rest of this product's append-only state already uses. Two intakes racing on one project cannot both proceed — one owns the transaction and the other finds it already claimed.
- **Exactly one archive slot.** `legacy-N` is monotonic: a second migration of a later tree takes `legacy-2` and never looks at `legacy-1` again. If the target slot somehow already exists, the leg **refuses** rather than overwriting — a taken slot means a concurrent writer, and guessing past one is how trees get corrupted.
- **Exactly one record.** The single `intake` ledger record is keyed on the transaction's own id, so a re-entered harvest finds its own record already there and appends nothing. Re-entry is a no-op, never a second history of the same event.

**An interrupted scaffold is kept, not cleaned up.** If a crash left a half-built tree behind, the transaction does not delete it and does not build over it: it is renamed and preserved beside the marker, named in the report, and the one command that removes it is printed there for the operator to run if and when they want to. A directory this leg cannot prove is disposable is a directory it does not dispose of.

## 3. What is carried, and what is only noted

**Prose that states human intent survives. Machine evidence does not.** A seal in an old run's records means a gate passed against a check bound to a law digest this version never held and never ran. It is a true fact *about the old run* and no evidence at all *for the new one*. It can be reported. It can never be converted.

So every item the harvest touches lands in exactly one class:

- **carried** — durable meaning, copied into the new tree as a **flagged input**, tagged with one of the two trust flags this product already uses for inherited material (`inherited-unverified`, `inherited-advisory`). No third vocabulary was invented: `product/brownfield/flow.md` already states the meaning — inherited material never enters a decision artifact directly, it enters as a flagged input and the pipeline re-derives.
- **noted** — a historical fact, recorded and reported, binding nothing. Seal and audit counts, the slice names those records carry, prior review counts, evidence generations, the old run's own stopped-here notes kept verbatim in their own namespace, the prior settings posture.

**The anti-fabrication rule, stated once and machine-checked:** nothing in the `noted` class ever reaches `state.json`, `milestones/`, `verification/`, `architecture/`, or `ledger.jsonl` beyond the single record of finding — and every carried file's destination is validated to sit under `intake/` before a single byte is copied. A report that names a destination anywhere else is refused as a whole; nothing partial lands.

**Tier 1 reads the shape it knows.** Prior vision and brief prose, the old law's prose as prior acceptance criteria, prior decomposition and design reasoning, prior findings and probes, the prior codebase map — each carried under its own role, each independently optional. A tree missing one of them harvests everything else: presence-keyed, never completeness-keyed, which is what lets one harvester cover a whole family of shapes without a version branch anywhere in it. Seal records, audit records, review records, evidence generations, the old state file, the posture file are noted with counts. Transient runtime files are ignored — listed, never silently dropped.

**Tier 2 reads no grammar at all.** Every readable document under the ceiling is copied out with its directory structure preserved — never flattened to basenames, which would collide two same-named files from different directories and silently keep one — each recorded with its size, its modification time, and a title read from its own first heading or its filename. Nothing is classified, because with one sample of that shape a bespoke parser would be guesswork wearing a schema. Machine-evidence files are held back from the copy in both tiers: an old state file or seal record is a fact to count, not a document to hand a survey. What tier 2 produces is found documentation, which is exactly what the brownfield scout already knows how to read.

**Four cases the design expected, because an abandoned run is more likely than a finished one:**

- **Unsealed or torn law.** Seal state never gates the harvest — the prose is the durable meaning and the seal is precisely the evidence being discarded. The state is recorded as what it is: sealed, unsealed, or torn.
- **Records that disagree with each other.** Intake never reconciles them, and never repairs either. It reads what exists, counts, and records the disagreement as a fact about an interrupted run.
- **An unsealed brainstorm ledger.** An earlier Kiln renamed an unsealed ledger and never resumed or compiled it. Intake honours that ethic directly: unsealed is noted only, its path named so the operator can read it themselves; sealed is carried as vision input. It is the one legacy ethic that binds this harvest, and it binds in the operator's favour.
- **A torn or unreadable file.** Recorded with its reason, never a silent skip and never a failure of the pass. One bad file does not sink a harvest.

**The non-goals, each blocking a specific temptation:** no seal ever becomes a green chunk; no state is synthesized (the new `state.json` is scaffold genesis and nothing else touches it during this leg); no resume point is fabricated (a legacy tree resumes nothing — the new run starts at the door, informed); no back-dated gate, phase transition, or verification record is written; no settings are inherited; and no research-cache entry is created, because cache entries require real source URLs and a legacy document has none — writing one would mean fabricating a citation.

## 4. Where it lands, and who reads it

Everything carried lands under `intake/` in the new tree, grouped by the phase that consumes it — `intake/vision/`, `intake/research/`, `intake/design/`, `intake/codebase/`, `intake/documents/` — beside the typed record of finding (`intake/report.json`) and its mechanical rendered view (`intake/report.md`). `intake.js`'s harvest leg is the sole writer of every one of those paths.

**Why a namespace of its own, and not the real artifact directories.** A found vision dropped into `vision/vision.md` would be byte-indistinguishable from a vision the operator actually confirmed in the sketchbook. That is not a naming quibble — it is fabrication of earned state, the exact thing the anti-fabrication rule forbids. `intake/` gives the operator what they actually asked for, real named documents at real stable paths that flows open directly, while keeping the flag attached. The material is furniture in the new tree. It is not pretending to be earned.

The consumers, as actually wired: `scout-agent` reads the report and the documents as **leads to re-derive from**, never as findings, and its own anchors still point at the target project as it stands today (`agents/scout-agent.md`); `brainstorm-facilitator` may open `intake/vision/` for a better first question, never for a decision (`agents/brainstorm-facilitator.md`); `research-chief` reads `intake/research/` as prior material that shapes a brief's anchor and closes no subtopic (`agents/research-chief.md`); `handoff.js` renders an intake section into `handoff.md` when the report is on disk, omitted entirely when it is not.

**The archive is frozen.** No module in this version ever writes into `archive/legacy-N/`, which is what keeps "nothing in there was authored by this version" a true and testable statement rather than an assurance.

## 5. Refusal — corrupt and hazardous only

No shape is refused. What is refused is a filesystem this leg cannot act on honestly:

- `.kiln/` unreadable — the error code is reported and nothing past it is guessed.
- `.kiln` is itself a symlink, or a marker or destination path resolves outside the project root — a rename would move a link rather than the tree, and a copy would write outside the project. Every path is checked before it is used, in both directions.
- The archive slot is already taken, or a rename fails — nothing moved, nothing scaffolded, nothing written; the message names the error and both paths.
- The transaction record itself is unreadable, malformed, or belongs to another project — refused by the field that disagrees, named.

Every one of these refuses **before the first mutation**, so the project is left byte-identical to how it was found. And two outcomes that look like failures are not: a harvest that carries nothing is a valid report with an empty carried list, said plainly, run continues; a tree in a shape nobody recognizes is tier 2, not a refusal.

## 6. The operator moment

One line, said in the door's report step, before the settings interview — being asked settings questions while unaware that a prior run has just been set aside is a form of burial, and the never-buried rule is `product/onboarding/preflight.md`'s standing precedent. Every clause traces to a field on disk; the voice's first rule is no recorded event, no line.

The shape, tier 1:

> I found an earlier run of myself in this project — 5 pieces sealed, files last touched 2026-03-25, under a law I no longer speak. It is set aside whole at `.kiln/archive/legacy-1`; nothing was deleted. I kept what still means something: the vision, 3 design notes, 6 research notes. What it proved, it proved for the old fire — I am not carrying those seals forward, and I am not resuming where it stopped. We start again, informed.

Clause by clause: the seal count and the file date come from the report's own noted facts, the date worded as a **file** fact because that is exactly what it is — no seal record in the older shapes carries a timestamp, so the archive's newest modification time is the only honest date there is. "A law I no longer speak" is the tier and the markers. The archive path is the archive path. What was kept is the carried list grouped by role. What is not being carried is the non-goals of §3, said as what is *not* claimed — in the same breath, which is the honesty bound.

The shape, tier 2 — less is known, and the line says so:

> I found an earlier tree here in a shape I do not recognize — 14 readable documents. It is set aside whole at `.kiln/archive/legacy-1`, and I have put those documents where the survey can read them. I could not tell you what it proved; I did not try to guess.

**Any absent field omits its clause** — never softened, never guessed. An empty carried list gets "I found nothing in it I could carry forward honestly": red stays red. This is also what governs the line's timing, since the two legs run at different points in the door: at the report step the harvest has not run yet, so the clauses about what was *kept* have no field behind them and are simply not said — what is said is what was found, where it went, and that nothing was deleted. The kept half is said after the harvest leg, from the record that now exists. One rule, applied twice; no clause is ever spoken ahead of the fact it traces to.

**Two further clauses, when their fields are non-empty.** The report carries the exact commands that put the older tree back, and they are offered as a courtesy — never as a defence, because they are not one (§7). And when an interrupted scaffold was kept, the line names where it is and the one command that removes it. Absent fields, absent clauses, as above.

## 7. Known, disclosed scope limits

- **A false positive costs more than it can give back.** Preservation bounds data loss; it does not bound disruption. Once a fresh tree occupies `.kiln/`, undoing a wrong classification is three moves and a judgment call — the archive out, the new tree aside (never deleted; the operator decides), the old tree back — and anything the new run wrote in between, settings from the interview, scout output, ledger records, has to be abandoned or reconciled, which only the operator can decide. A false positive also takes over another tool's `.kiln` namespace, which no amount of byte-preservation undoes. What actually lowers the rate is the strong-marker bar of §1; the restore commands are a courtesy printed in the report, and this document does not offer them as the mitigation.
- **`intake/vision/` reaching the facilitator is a new wire.** No charter referenced the scout's own reuse-map prose as a facilitator input before this design — the head start that an earlier document described was an intention, not a wiring. It is wired now, in `agents/brainstorm-facilitator.md`, and named here as new rather than presented as reuse.
- **`intake/design/` has no phase-4 consumer wired today.** The material is carried, flagged, and reachable at a stable path, and `scout-agent` may cite it as provenance for a constraint it re-derived itself. But no planning or architecture charter names it as an input, and this document does not claim otherwise. Archived documents also never enter `protected_paths[]`: that field is machine-enforced by set intersection at the plan gate and its entries must name real project paths, which an archived document is not. Intake supplies evidence; scout supplies the constraint; the gate enforces it — no new channel, and no pretence of one.
- **This document cites `intake.js`'s and `detect.js`'s contracted behavior** — the interfaces they were pinned to — never an independent read of their final source. A contract read, not a code review; said here rather than left to look like one.
