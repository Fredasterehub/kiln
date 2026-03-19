# Blueprint: architecture

## Meta
- **Team name**: architecture
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md, .kiln/plans/claude_plan.md, .kiln/plans/codex_plan.md, .kiln/plans/plan_validation.md, .kiln/master-plan.md, .kiln/architecture-handoff.md, .kiln/design/tokens.json (conditional — only if VISION.md has Visual Direction), .kiln/design/tokens.css (conditional), .kiln/design/creative-direction.md (conditional)
- **Inputs from previous steps**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md, .kiln/docs/research.md, .kiln/docs/research/{slug}.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (brownfield)
- **Workflow**: three-phase (persistent mind bootstraps, boss orchestrates, planners+synthesizer+validator as waves)

## Agent Roster

| Name | Role | Phase | Model |
|------|------|-------|-------|
| numerobis | Persistent mind. Technical authority. Bootstraps from research + onboarding, writes architecture docs, consultation hub. | A | opus |
| thoth | Persistent mind. Archivist — owns all writes to .kiln/archive/. Fire-and-forget. | A | haiku |
| aristotle | Boss. Orchestrates dual plan, synthesis, validation, operator review. | B (INTERACTIVE) | opus |
| confucius | Claude-side planner. Reads architecture docs, consults numerobis, writes claude_plan.md. Conditionally generates design artifacts when VISION.md contains Visual Direction (section 12). | C (wave 1) | opus |
| sun-tzu | Codex-side planner. Delegates to GPT-5.4 via Codex CLI, writes codex_plan.md. | C (wave 1) | sonnet |
| miyamoto | Claude-side sonnet planner. Writes plans directly. Used when codex_available=false. | C (wave 1, conditional) | sonnet |
| plato | Synthesizer. Structured comparison + synthesis, writes master-plan.md directly. | C (wave 2) | opus |
| athena | Validator. Validates master-plan.md on 5 dimensions. PASS or FAIL. | C (wave 3) | opus |

## Three-Phase Spawn

**Phase A**: numerobis + thoth bootstrap in parallel → numerobis reads research + writes architecture docs → thoth ensures archive structure → both signal READY.

**Phase B**: aristotle spawns (INTERACTIVE). Receives numerobis's READY summary. Orchestrates the dependency chain by requesting agents in waves.

**Phase C waves** (aristotle requests via REQUEST_WORKERS):
- Wave 1: confucius + sun-tzu (codex_available=true) OR confucius + miyamoto (codex_available=false)
- Wave 2: plato (synthesis after both plans ready)
- Wave 3: athena (validation after synthesis)

Validation may loop: athena FAIL → plato revises → athena re-validates (max 2 rounds).

## Communication Model

```
Numerobis  → team-lead     (READY: architecture summary)
Aristotle  → team-lead     (REQUEST_WORKERS: confucius, sun-tzu)
Aristotle  → confucius     (assignment + numerobis summary)
Aristotle  → sun-tzu       (assignment + numerobis summary)
Aristotle  → miyamoto      (assignment + numerobis summary)
Confucius  → numerobis     (technical consultation — optional)
Sun-Tzu    → numerobis     (technical consultation — optional)
Miyamoto   → numerobis     (technical consultation — optional)
Confucius  → Aristotle     (PLAN_READY)
Sun-Tzu    → Aristotle     (PLAN_READY)
Miyamoto   → Aristotle     (PLAN_READY)
Aristotle  → team-lead     (REQUEST_WORKERS: plato)
Aristotle  → Plato         (synthesis assignment)
Plato      → numerobis     (technical consultation — optional)
Plato      → Aristotle     (SYNTHESIS_COMPLETE)
Aristotle  → team-lead     (REQUEST_WORKERS: athena)
Aristotle  → Athena        (validation assignment)
Athena     → numerobis     (technical consultation — optional)
Athena     → Aristotle     (VALIDATION_PASS or VALIDATION_FAIL)
Aristotle  → Numerobis     (UPDATE_FROM_MASTER_PLAN)
Numerobis  → Aristotle     (DOCS_UPDATED)
Aristotle  → team-lead     (ARCHITECTURE_COMPLETE or PLAN_BLOCKED)
Sun-Tzu    → thoth          (ARCHIVE: plan-prompt.md, codex-output.log, codex-plan-output.md — fire-and-forget)
Miyamoto   → thoth          (ARCHIVE: miyamoto_plan.md — fire-and-forget)
Plato      → thoth          (ARCHIVE: claude-plan.md, master-plan.md, debate-resolution.md — fire-and-forget)
```

Numerobis is the consultation hub — planners/synthesizer/validator message her directly for technical questions. Aristotle doesn't relay.
