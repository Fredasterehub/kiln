# Artifact Flow

What each step reads and produces. Files live in `.kiln/` under the project working directory.

## Step 1: Onboarding
- **Reads**: (none — first step)
- **Produces**: .kiln/STATE.md, MEMORY.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (brownfield only)

## Step 2: Brainstorm
- **Reads**: .kiln/STATE.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md
- **Produces**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md

## Step 3: Research
- **Reads**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md
- **Produces**: .kiln/docs/research/{slug}.md (per topic), .kiln/docs/research.md (synthesis)

## Step 4: Architecture
- **Reads**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md, .kiln/docs/research.md, .kiln/docs/research/{slug}.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md
- **Produces**: .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md (updated), .kiln/plans/claude_plan.md, .kiln/plans/codex_plan.md, .kiln/plans/debate_resolution.md, .kiln/plans/plan_validation.md, .kiln/master-plan.md, .kiln/architecture-handoff.md

## Step 5: Build (per iteration)
- **Reads**: .kiln/master-plan.md, .kiln/architecture-handoff.md, .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md, .kiln/docs/patterns.md, .kiln/docs/pitfalls.md, .kiln/docs/codebase-state.md, .kiln/validation/report.md (if correction cycle)
- **Produces**: Source code (in project), .kiln/docs/codebase-state.md (updated), .kiln/docs/patterns.md (updated), .kiln/docs/pitfalls.md (updated), .kiln/docs/decisions.md (updated)

## Step 6: Validate
- **Reads**: .kiln/master-plan.md, .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/codebase-state.md, built source code
- **Produces**: .kiln/validation/report.md

## Step 7: Report
- **Reads**: All .kiln/ artifacts
- **Produces**: .kiln/REPORT.md
