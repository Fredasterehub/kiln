# Vision

<!-- This template defines the canonical structure for .kiln/VISION.md.
     The brainstormer agent uses these sections to produce a complete vision document.
     Remove all HTML comments when filling in the template. -->

## Problem Statement

<!-- What problem does this project solve? Who experiences it? Why do existing
     solutions fall short?

     Guidelines:
     - Be specific — cite real pain points, not abstract complaints
     - Name the affected users or roles
     - Reference concrete existing solutions and their shortcomings
     - Avoid solution-thinking in this section — focus only on the problem -->

{{problem_statement}}

## Solution Overview

<!-- High-level description of what we're building. How does it address the
     problem? What is the core value proposition?

     Guidelines:
     - 2-3 paragraphs maximum
     - Describe the approach, not the implementation details
     - Explain why this approach addresses the stated pain points
     - Mention key differentiators from existing solutions -->

{{solution_overview}}

## User Personas

<!-- Who are the primary users? What are their goals, constraints, and
     technical context?

     Guidelines:
     - 1-3 personas
     - Each persona should include: name/role, goals, pain points, technical proficiency
     - Personas should be distinct — avoid overlapping profiles
     - Ground personas in realistic scenarios, not hypothetical extremes -->

{{user_personas}}

## Success Criteria

<!-- Measurable outcomes that define "done".

     Guidelines:
     - Use concrete metrics where possible (e.g., "API response time < 200ms"
       not "fast API")
     - Each criterion should be independently verifiable
     - Include both functional criteria (features work) and quality criteria
       (performance, reliability, usability)
     - Avoid vague qualifiers: "improved", "better", "enhanced" -->

{{success_criteria}}

## Constraints and Non-Goals

<!-- Technical constraints (platform, language, performance requirements).
     Explicit non-goals: things we are NOT building.

     Guidelines:
     - Non-goals are as important as goals — they prevent scope creep
     - Be specific about what's excluded and why
     - Include hard technical constraints (runtime, language, compatibility)
     - Include organizational constraints (timeline, team size, budget)
     - Each non-goal should explain the reasoning behind exclusion -->

{{constraints_and_non_goals}}

## Key Decisions

<!-- Decisions made during brainstorming that constrain implementation.

     Guidelines:
     - Each decision should include: the decision, alternatives considered,
       and rationale
     - Format as decision records (Decision / Alternatives / Rationale)
     - Only include decisions that materially affect implementation
     - Avoid recording obvious or trivial choices -->

{{key_decisions}}

## Open Questions

<!-- Unresolved questions that can be answered during implementation.

     Guidelines:
     - Only include genuine unknowns, not things that should have been decided
     - Each question should note when it needs to be resolved (which phase/track)
     - Distinguish between blocking questions (must resolve before planning)
       and deferred questions (can resolve during implementation)
     - Remove questions as they are answered during execution -->

{{open_questions}}
