#!/bin/bash
set -e
mkdir -p "$1/.kiln/tmp"
printf 'verdict: APPROVED\nobserved_head_sha: abc123\nbuilder_reported_evidence: tests pass\nreviewer_reran_commands: pytest\nreviewer_rerun_results: pass\nnot_verified_or_limitations: none\n' > "$1/.kiln/tmp/review.md"
