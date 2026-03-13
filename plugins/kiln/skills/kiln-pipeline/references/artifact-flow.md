# Artifact Flow

> **Archive writer**: All files under `.kiln/archive/` are written exclusively by **thoth** (archivist agent). Other agents stage files in `.kiln/tmp/` and send ARCHIVE messages to thoth. No agent writes directly to `.kiln/archive/`.

What each step reads and produces. Files live in `.kiln/` under the project working directory.

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
- **Produces**: .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md (updated), .kiln/plans/claude_plan.md, .kiln/plans/codex_plan.md, .kiln/plans/debate_resolution.md, .kiln/plans/plan_validation.md, .kiln/master-plan.md, .kiln/architecture-handoff.md
- **Archives**: .kiln/archive/step-4-architecture/plan-prompt.md (sun-tzu's GPT-5.4 prompt), .kiln/archive/step-4-architecture/codex-output.log (GPT-5.4 stdout/stderr), .kiln/archive/step-4-architecture/codex-plan-output.md (GPT-5.4's plan), .kiln/archive/step-4-architecture/claude-plan.md (confucius's plan), .kiln/archive/step-4-architecture/debate-resolution.md (plato's structured comparison), .kiln/archive/step-4-architecture/master-plan.md (plato's synthesis)

## Step 5: Build (per iteration)
- **Reads**: .kiln/master-plan.md, .kiln/architecture-handoff.md, .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md, .kiln/docs/patterns.md, .kiln/docs/pitfalls.md, .kiln/docs/codebase-state.md, .kiln/validation/report.md (if correction cycle)
- **Produces**: Source code (in project), .kiln/docs/codebase-state.md (updated), .kiln/docs/patterns.md (updated), .kiln/docs/pitfalls.md (updated), .kiln/docs/decisions.md (updated)
- **Archives** (per iteration): .kiln/archive/step-5-build/iter-{n}/bootstrap-context.md (rakim + sentinel READY summaries), .kiln/archive/step-5-build/iter-{n}/assignment.xml (KRS-One's scoped assignment), .kiln/archive/step-5-build/iter-{n}/prompt.md (Codex's GPT-5.4 prompt), .kiln/archive/step-5-build/iter-{n}/codex-output.log (GPT-5.4 stdout/stderr), .kiln/archive/step-5-build/iter-{n}/review.md (Sphinx's verdict), .kiln/archive/step-5-build/iter-{n}/codebase-state-snapshot.md (rakim's state after update), .kiln/archive/step-5-build/iter-{n}/fix-{N}-prompt.md (fix after rejection N), .kiln/archive/step-5-build/iter-{n}/fix-{N}-codex-output.log (fix N GPT-5.4 output), .kiln/archive/step-5-build/iter-{n}/fix-{N}-review.md (sphinx re-review after fix N), .kiln/archive/step-5-build/iter-{n}/qa-{milestone}.md (KRS-One's QA analysis)

## Step 6: Validate
- **Reads**: .kiln/master-plan.md, .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/codebase-state.md, built source code
- **Produces**: .kiln/validation/report.md
- **Archives**: .kiln/archive/step-6-validate/ (linked from .kiln/validation/report.md)

## Step 7: Report
- **Reads**: All .kiln/ artifacts
- **Produces**: .kiln/REPORT.md
