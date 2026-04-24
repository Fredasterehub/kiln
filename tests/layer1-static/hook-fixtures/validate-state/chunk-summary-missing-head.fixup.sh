#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-8"
cat > "$1/.kiln/archive/milestone-1/chunk-8/chunk-8-summary.md" <<'EOF'
# Chunk 8 Summary

milestone_id: M1
chunk_id: 8
implemented: summary fixture
EOF
