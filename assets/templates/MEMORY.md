# Kiln Project Memory

## Metadata
project_name: {{PROJECT_NAME}}
project_path: {{PROJECT_PATH}}
date_started: {{DATE}}
last_updated: {{DATE_ISO}}

## Runtime
stage: brainstorm
status: in_progress
planning_sub_stage: null
debate_mode: {{DEBATE_MODE}}
phase_number: null
phase_name: null
phase_total: null

## Handoff
handoff_note: No handoff yet - fresh session.

## Phase Statuses
# Add one line per phase during execution:
# - phase_number: <int> | phase_name: <string> | phase_status: <pending|in_progress|failed|completed>

## Resume Log
- {{DATE_ISO}} Initialized via /kiln:start

# Optional sections — uncomment when the pipeline reaches the relevant stage:
# ## Phase Results
# - Phase 1 (phase name): complete — one-sentence summary
#
# ## Validation
# verdict: pass|fail
# test_count: 0
# report_path: $KILN_DIR/validation/report.md
#
# ## Reset Notes
# what_was_being_worked_on: (filled by /kiln:reset)
# agent_context: No active agents
# operator_note: (filled by /kiln:reset)
# next_action: (filled by /kiln:reset)
