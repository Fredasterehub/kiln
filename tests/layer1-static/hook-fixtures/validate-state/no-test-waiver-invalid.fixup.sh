#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-3"
cat > "$1/.kiln/archive/milestone-1/chunk-3/tdd-evidence.md" <<'EOF'
testable: no
no_test_waiver_reason: N/A
assignment_id: assign-3
milestone_id: M1
chunk_id: 3
current_head_sha_before: abc123
current_head_sha_after: def456
red_command: N/A
red_result_summary: N/A
green_command: N/A
green_result_summary: N/A
refactor_command: N/A
refactor_result_summary: N/A
test_files_added_or_changed: none
production_files_changed: protocol.md
reviewer_reran_commands: N/A - pending reviewer
reviewer_rerun_results: N/A - pending reviewer
limitations: static protocol prose only
EOF
