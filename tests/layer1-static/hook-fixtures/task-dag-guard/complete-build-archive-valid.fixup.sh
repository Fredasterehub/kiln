#!/bin/bash
set -e
head=$(git -C "$1" rev-parse HEAD)
mkdir -p "$1/.kiln/archive/step-5-build" "$1/.kiln/archive/milestone-M1/chunk-1"
printf '<assignment/>\n' > "$1/.kiln/archive/milestone-M1/chunk-1/assignment.xml"
cat > "$1/.kiln/archive/step-5-build/final-archive-readiness.md" <<EOF
archive_ready: true
run_id: kiln-test01
build_id: final
milestone_id: final
head_sha: ${head}
timestamp: 2026-04-16T12:00:00Z
source_archive_paths_checked: .kiln/archive/milestone-M1/chunk-1/assignment.xml
EOF
