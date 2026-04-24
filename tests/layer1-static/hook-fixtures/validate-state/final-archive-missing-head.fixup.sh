#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/step-5-build" "$1/.kiln/archive/milestone-M1/chunk-1"
printf 'reviewed\n' > "$1/.kiln/archive/milestone-M1/chunk-1/review.md"
cat > "$1/.kiln/archive/step-5-build/final-archive-readiness.md" <<'EOF'
archive_ready: true
run_id: kiln-test01
build_id: final
milestone_id: final
timestamp: 2026-04-16T12:00:00Z
source_archive_paths_checked: .kiln/archive/milestone-M1/chunk-1/review.md
EOF
