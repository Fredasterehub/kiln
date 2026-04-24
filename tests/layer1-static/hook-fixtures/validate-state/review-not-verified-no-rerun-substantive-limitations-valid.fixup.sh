#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-11"
cat > "$1/.kiln/archive/milestone-1/chunk-11/review.md" <<'EOF'
verdict: NOT_VERIFIED_DEGRADED
observed_head_sha: abc123
test_requirements: pytest auth behavior
tdd_evidence_path: .kiln/archive/milestone-1/chunk-11/tdd-evidence.md
builder_reported_commands: pytest tests/test_auth.py
builder_reported_results: passed
reviewer_reran_commands: []
reviewer_rerun_results: not independently rerun: reviewer environment lacked dependencies needed to execute the requested command
independent_verification_status: not_verified
limitations: Reviewer could not verify behavior because the required dependency service was unavailable in the review environment.
EOF
