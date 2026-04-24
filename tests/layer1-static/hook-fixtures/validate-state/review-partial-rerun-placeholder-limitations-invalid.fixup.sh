#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-8"
cat > "$1/.kiln/archive/milestone-1/chunk-8/review.md" <<'EOF'
verdict: PARTIAL_PASS_STATIC_ONLY
observed_head_sha: abc123
test_requirements: pytest auth behavior
tdd_evidence_path: .kiln/archive/milestone-1/chunk-8/tdd-evidence.md
builder_reported_commands: pytest tests/test_auth.py
builder_reported_results: passed
reviewer_reran_commands: ["pytest tests/test_auth.py"]
reviewer_rerun_results: pytest tests/test_auth.py passed, but integration coverage was not rerun
independent_verification_status: partial
limitations: N/A
EOF
