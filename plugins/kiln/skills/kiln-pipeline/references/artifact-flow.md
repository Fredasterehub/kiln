# Artifact Flow

Per-step catalog of what each of the 7 pipeline steps reads, produces, and archives. Consulted on demand by every agent that writes to `.kiln/` — bosses confirming scope before dispatch, persistent minds (rakim, sentinel, thoth) tracking state and routing ARCHIVE requests, and workers that need to know where their output lands. Effort tier is the consumer's — this file is a reference, not a prompt.

> **Archive writer**: All files under `.kiln/archive/` are written exclusively by **thoth** (archivist agent). Other agents stage files in `.kiln/tmp/` and send ARCHIVE messages to thoth. Routing every archive write through a single agent keeps the archive layout stable and auditable — parallel writers would race on directory layout and diverge over time.

Files live in `.kiln/` under the project working directory. Paths, filenames, and conditional markers below are the contract — consumers read them literally.

## Step 1: Onboarding
- **Reads**: (none — first step)
- **Produces**: .kiln/STATE.md, .kiln/resume.md, MEMORY.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (brownfield only)

## Step 2: Brainstorm
- **Reads**: .kiln/STATE.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md
- **Produces**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md

## Step 3: Research
- **Reads**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md
- **Produces**: .kiln/docs/research/{slug}.md (per topic), .kiln/docs/research.md (synthesis)
- **Archives**: .kiln/archive/step-3-research/scout-assignments.md (MI6's dispatched assignments)

## Step 4: Architecture
- **Reads**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md, .kiln/docs/research.md, .kiln/docs/research/{slug}.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md
- **Produces**: .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md (updated), .kiln/plans/plan-a.md, .kiln/plans/plan-b.md (self-anonymised slot files — planners write directly, no post-hoc sed), .kiln/plans/plan_validation.md, .kiln/master-plan.md, .kiln/architecture-handoff.md, .kiln/design/tokens.json (conditional — only if VISION.md has Visual Direction), .kiln/design/tokens.css (conditional), .kiln/design/creative-direction.md (conditional)
- **Archives**: .kiln/archive/step-4-architecture/plan-prompt.md (sun-tzu's Codex prompt), .kiln/archive/step-4-architecture/codex-output.log (Codex stdout/stderr), .kiln/archive/step-4-architecture/codex-plan-output.md (Codex's plan), .kiln/archive/step-4-architecture/claude-plan.md (confucius's plan), .kiln/archive/step-4-architecture/debate-resolution.md (plato's structured comparison via thoth), .kiln/archive/step-4-architecture/master-plan.md (plato's synthesis via thoth)

## Step 5: Build (per chunk)
- **Reads**: .kiln/master-plan.md, .kiln/architecture-handoff.md, .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md, .kiln/docs/patterns.md, .kiln/docs/pitfalls.md, .kiln/docs/codebase-state.md, .kiln/validation/report.md (if correction cycle)
- **Produces**: Source code (in project), .kiln/docs/codebase-state.md (updated), .kiln/docs/patterns.md (updated), .kiln/docs/pitfalls.md (updated), .kiln/docs/decisions.md (updated)
- **Canonical archives** (per chunk): .kiln/archive/milestone-{milestone_id}/chunk-{chunk_id}/assignment.xml (KRS-One's scoped assignment with freshness fields), .kiln/archive/milestone-{milestone_id}/chunk-{chunk_id}/tdd-evidence.md (builder's RED/GREEN/REFACTOR evidence or no-test waiver), .kiln/archive/milestone-{milestone_id}/chunk-{chunk_id}/review.md (reviewer's verdict with independent verification fields), .kiln/archive/milestone-{milestone_id}/chunk-{chunk_id}/fix-{N}-review.md (reviewer re-review after fix N)
- **Legacy/auxiliary archives**: .kiln/archive/step-5-build/chunk-{chunk_id}/prompt.md (builder's Codex prompt, codex-type only), .kiln/archive/step-5-build/chunk-{chunk_id}/codex-output.log (Codex stdout/stderr, codex-type only), .kiln/archive/step-5-build/chunk-{chunk_id}/implementation-summary.md, .kiln/archive/step-5-build/chunk-{chunk_id}/fix-{N}-prompt.md, .kiln/archive/step-5-build/chunk-{chunk_id}/fix-{N}-codex-output.log, .kiln/archive/step-5-build/chunk-{chunk_id}/chunk-{chunk_id}-summary.md, .kiln/archive/step-5-build/chunk-{chunk_id}/qa-{milestone}.md
- **Final archive gate**: Before `BUILD_COMPLETE`, thoth must answer `FINAL_ARCHIVE_CHECK` with `ARCHIVE_READY`. Missing milestone summaries, missing chunk assignment/TDD/review evidence, pending critical tmp artifacts, or uncaptured known limitations block final close-out.

## Step 6: Validate
- **Reads**: .kiln/master-plan.md, .kiln/docs/architecture.md, .kiln/docs/decisions.md, .kiln/docs/tech-stack.md, .kiln/docs/codebase-state.md, built source code
- **Produces**: .kiln/validation/architecture-check.md (zoxea), .kiln/validation/report.md (argus), .kiln/validation/design-review.md (hephaestus, conditional — only when .kiln/design/ exists), .kiln/validation/screenshots/ (argus/hephaestus, web apps only)
- **Archives**: .kiln/archive/step-6-validate/ (linked from .kiln/validation/report.md)

## Step 7: Report
- **Reads**: All .kiln/ artifacts
- **Produces**: .kiln/REPORT.md
