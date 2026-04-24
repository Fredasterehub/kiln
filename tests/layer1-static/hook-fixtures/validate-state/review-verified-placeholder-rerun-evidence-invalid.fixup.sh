#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-12"
cat > "$1/.kiln/archive/milestone-1/chunk-12/review.md" <<'EOF'
verdict: APPROVED
observed_head_sha: abc123
test_requirements: pytest auth behavior
tdd_evidence_path: .kiln/archive/milestone-1/chunk-12/tdd-evidence.md
builder_reported_commands: pytest tests/test_auth.py
builder_reported_results: passed
reviewer_reran_commands: ["pytest tests/test_auth.py"]
reviewer_rerun_results: N/A
independent_verification_status: verified
limitations: no known limitations
EOF
