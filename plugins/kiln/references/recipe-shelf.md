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

## ratify-artifact — status: SHIPPED (W1)

Not a standalone workflow file: the reusable "grade a readable artifact against a rubric" path
is the `kiln-review ratify <repo> <request.json> <gate.json>` verb in `scripts/kiln-review`,
plus the kernel LAW-stage call that ratifies the LAW before it locks. The verb is
artifact-agnostic — its first consumer is the LAW, and research-sweep reuses the same verb to
ratify its feasibility candidate against a different rubric. No second review family is minted.

## screening-room — status: deferred (W8)

The eighth-wave recipe, named here so the shelf reads complete. No file or verb ships for it
until W8; the shelf marking it deferred is the truthful record that it is not yet reachable.
