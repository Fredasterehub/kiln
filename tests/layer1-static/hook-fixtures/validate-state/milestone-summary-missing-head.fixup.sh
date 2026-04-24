#!/bin/bash
set -e
mkdir -p "$1/.kiln/docs/milestones"
cat > "$1/.kiln/docs/milestones/milestone-1.md" <<'EOF'
# Milestone 1

milestone_id: M1
timestamp: 2026-04-16T12:00:00Z
EOF
