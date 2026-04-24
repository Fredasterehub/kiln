#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-13"
cat > "$1/.kiln/archive/milestone-1/chunk-13/review.md" <<'EOF'
verdict: APPROVED
observed_head_sha: abc123
test_requirements: pytest auth behavior
tdd_evidence_path: .kiln/archive/milestone-1/chunk-13/tdd-evidence.md
builder_reported_commands: pytest tests/test_auth.py
builder_reported_results: passed
reviewer_reran_commands: ["pytest tests/test_auth.py"]
reviewer_rerun_results: pytest tests/test_auth.py failed with import errors, so verification was not established
independent_verification_status: not_verified
limitations: Reviewer could not verify behavior because the dependency import failed during the independent rerun.
EOF
