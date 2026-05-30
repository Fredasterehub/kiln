# Kiln State

This file is the Kiln control plane — the conductor reads it on every invocation to
resume, and rewrites it on every stage transition. It is the single source of truth;
the operator session holds no durable pipeline state.
Every field below is required and machine-read.
Keep the field names and markdown bullet format unchanged.

## Schema

- **schema_version**: 2
- **stage**: onboarding
- **mode**: interactive
- **plan_approval**: gated
- **testing_rigor**: standard
- **last_completed_stage**: none
- **next_action**: Complete onboarding and write the first durable Kiln artifacts.
- **started_at**: pending
- **updated_at**: pending

## Project

- **project_name**: Example Project
- **project_path**: /absolute/path/to/project
- **project_type**: unknown
- **greenfield**: true

## Execution

- **build_iteration**: 0
- **correction_cycle**: 0
- **milestone_count**: 0
- **milestones_complete**: 0
- **current_milestone**: none
- **validation_routing_target**: build
- **last_approval_checkpoint**: none

## Required Artifacts

- **state_file**: .kiln/STATE.md
- **resume_file**: .kiln/resume.md
- **project_brief_file**: .kiln/docs/project-brief.md
- **vision_file**: .kiln/docs/VISION.md
- **research_file**: .kiln/docs/research.md
- **architecture_file**: .kiln/docs/architecture.md
- **master_plan_file**: .kiln/master-plan.md
- **architecture_handoff_file**: .kiln/architecture-handoff.md
- **build_plan_file**: .kiln/build-plan.md
- **validation_report_file**: .kiln/validation/report.md
- **report_file**: .kiln/REPORT.md

## Supporting Artifacts

- **open_questions_file**: .kiln/docs/open-questions.md
- **decisions_file**: .kiln/docs/decisions.md
- **vision_notes_file**: .kiln/docs/vision-notes.md
- **vision_priorities_file**: .kiln/docs/vision-priorities.md
- **codebase_map_file**: .kiln/docs/codebase-map.md
- **correction_tasks_file**: .kiln/validation/correction-tasks.md
- **runtime_dir**: .kiln/runtime

## Step Timing

- **step_onboarding_started_at**: pending
- **step_onboarding_completed_at**: pending
- **step_brainstorm_started_at**: pending
- **step_brainstorm_completed_at**: pending
- **step_research_started_at**: pending
- **step_research_completed_at**: pending
- **step_architecture_started_at**: pending
- **step_architecture_completed_at**: pending
- **step_build_started_at**: pending
- **step_build_completed_at**: pending
- **step_validate_started_at**: pending
- **step_validate_completed_at**: pending
- **step_report_started_at**: pending
- **step_report_completed_at**: pending
