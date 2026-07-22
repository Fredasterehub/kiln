# The recipe shelf

Kiln runs a fixed shelf of three recipes — no more, no fewer, and no runtime registry that
grows one. This file is the shelf-of-record: the three named below are the whole shelf, and no
recipe the conductor launches is absent from it. The kernel it launches the same way
(`workflows/kernel.js`) is the pipeline core the recipes run beside, not a shelf recipe itself.

Recipes launch **by path**. The Claude Code plugin manifest has no `workflows` key — an
unknown key there is inert, so a workflow is never reached by manifest registration. Instead
the conductor hands the launcher an explicit path, exactly the way it launches
`workflows/kernel.js`. The path is the registration; this doc is how the shelf stays
discoverable without one.

## research-sweep — status: SHIPPED (W4)

A thin, fixed-purpose `workflows/research-sweep.js` beside the kernel, launched by path by the
conductor between the onboarding/vision ok-gate and the kernel-law launch. It reads the posture
dial, and when research is on it runs a producer over the six canonical areas, ratifies any
feasibility candidate against `data/feasibility-rubric.json`, and promotes only an accepted
result to `.kiln/docs/feasibility.md`. No other outcome leaves a canonical read behind: stood-down
and no-qualifying proceed straight to the law with none, while a rejected or held reviewer holds
the law. The workflow
lands in W4 (slice S2), reusing the W1 ratify verb unchanged; no second review family is minted.

The same recipe carries one closed second MODE (W4 slice S3): `mode: "probe"`. During a brainstorm
Da Vinci sends the conductor at most one nonterminal `PROBE_REQUEST` (ledger path + seq IDs only);
the conductor launches this workflow in probe mode, off Da Vinci's window, and it reads just those
ledger turns and writes a compact digest under `.kiln/docs/`, returning a single pointer for the
conductor's `PROBE_RESULT`. Probe mode bypasses the posture dial and the ratify loop — there is no
posture or law during a brainstorm; it is a light digest, not a ratified feasibility. The message
CONTRACT and the workflow's probe branch are unit-tested, but true off-window fresh-context
isolation and bidirectional teammate messaging are runtime capabilities the static harness cannot
prove (a canonical open question); verifying live probe isolation defers to the operator's live
brainstorm smoke.

## ratify-artifact — status: SHIPPED (W1)

Not a standalone workflow file: the reusable "grade a readable artifact against a rubric" path
is the `kiln-review ratify <repo> <request.json> <gate.json>` verb in `scripts/kiln-review`,
plus the kernel LAW-stage call that ratifies the LAW before it locks. The verb is
artifact-agnostic — its first consumer is the LAW, and research-sweep reuses the same verb to
ratify its feasibility candidate against a different rubric. No second review family is minted.

## screening-room — status: SHIPPED (W8)

Not a standalone workflow file: the perceptual evidence-and-grading path is the capture
recipe at `references/screening-room.md` (evidence generations under `.kiln/evidence/`,
manifest-last, no-install), the shipped instrument `data/perceptual-rubric.json`, and the
`kiln-review screen` / `screen-recheck` verbs in `scripts/kiln-review` — the
ratify-artifact precedent: the verb is the recipe. The validate card executes the capture
as part of its act, and the verbs grade the CURRENT generation's bounded pixels against
the LAW's Perceptual table over the review transport and schema unchanged. No second
review family is minted.
