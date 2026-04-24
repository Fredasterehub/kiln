#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-5"
cat > "$1/.kiln/archive/milestone-1/chunk-5/review.md" <<'EOF'
verdict: APPROVED
observed_head_sha: abc123
test_requirements: pytest auth behavior
tdd_evidence_path: .kiln/archive/milestone-1/chunk-5/tdd-evidence.md
builder_reported_commands: pytest tests/test_auth.py
builder_reported_results: passed
reviewer_reran_commands: N/A
reviewer_rerun_results: N/A
independent_verification_status: partial
limitations: N/A
EOF
