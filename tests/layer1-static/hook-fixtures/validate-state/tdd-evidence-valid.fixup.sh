#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-2"
cat > "$1/.kiln/archive/milestone-1/chunk-2/tdd-evidence.md" <<'EOF'
testable: yes
assignment_id: assign-1
milestone_id: M1
chunk_id: 2
current_head_sha_before: abc123
current_head_sha_after: def456
red_command: pytest tests/test_auth.py
red_result_summary: failed as expected on missing middleware
green_command: pytest tests/test_auth.py
green_result_summary: passed
refactor_command: pytest tests/test_auth.py
refactor_result_summary: passed
test_files_added_or_changed: tests/test_auth.py
production_files_changed: src/auth.py
reviewer_reran_commands: pytest tests/test_auth.py
reviewer_rerun_results: passed
limitations: none
EOF
