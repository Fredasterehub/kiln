#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-6"
cat > "$1/.kiln/archive/milestone-1/chunk-6/review.md" <<'EOF'
verdict: APPROVED
observed_head_sha: abc123
test_requirements: pytest auth behavior
tdd_evidence_path: .kiln/archive/milestone-1/chunk-6/tdd-evidence.md
builder_reported_commands: pytest tests/test_auth.py
builder_reported_results: passed
reviewer_reran_commands: []
reviewer_rerun_results: not independently rerun: local dependency service unavailable in reviewer sandbox
independent_verification_status: partial
limitations: Local dependency service unavailable in reviewer sandbox, so this verdict is partial and not a clean approval.
EOF
