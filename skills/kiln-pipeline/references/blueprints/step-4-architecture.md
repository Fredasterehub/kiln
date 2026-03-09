# Blueprint: architecture

## Meta
- **Team name**: architecture
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md, .kiln/plans/claude_plan.md, .kiln/plans/codex_plan.md, .kiln/plans/debate_resolution.md, .kiln/plans/plan_validation.md, .kiln/master-plan.md, .kiln/architecture-handoff.md
- **Inputs from previous steps**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md, .kiln/docs/research.md, .kiln/docs/research/{slug}.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (brownfield)
- **Workflow**: mixed (sequential dependency chain with one parallel step, consultation hub, validation retry loop)

## Agent Roster

| Name | Role | Type | Model |
|------|------|------|-------|
| aristotle | Boss. Orchestrates the full planning pipeline end-to-end: architect bootstrap, dual plan, debate, synthesis, validation, operator review. | (boss) | opus |
| architect | Persistent mind. Technical authority. Bootstraps from research + onboarding artifacts, writes architecture docs. Available as live consultant — any agent can message her directly for technical questions. | general | opus |
| confucius | Claude-side planner. Reads architecture docs + VISION.md, writes claude_plan.md. Can consult architect directly. | general | opus |
| sun-tzu | Codex-side planner. Thin CLI delegation wrapper — delegates plan creation to GPT-5.4 via Codex CLI. Never writes plan content himself. | general | sonnet |
| socrates | Debater. Reads both plans, identifies disagreements, writes debate_resolution.md. Can consult architect for technical judgment. | general | opus |
| plato | Synthesizer. Thin CLI delegation wrapper — delegates master-plan synthesis to GPT-5.4 via Codex CLI. Never writes plan content himself. | general | sonnet |
| athena | Validator. Validates master-plan.md on 5 dimensions. Binary verdict: PASS or FAIL with specific actionable remediation. | general | opus |

## Communication Model

Standard teamwork pattern with one extension:

- **Primary**: All agents communicate with aristotle (boss) for task assignments and completion signals.
- **Consultation hub**: Any agent can message "architect" directly via SendMessage for technical questions. When consulting architect, the agent sends a question, STOPs, and waits for architect's reply before continuing. Architect replies with reasoning AND updates her files if it's a new decision.
- **Architect never initiates.** She only responds to questions and bootstrap instructions.
