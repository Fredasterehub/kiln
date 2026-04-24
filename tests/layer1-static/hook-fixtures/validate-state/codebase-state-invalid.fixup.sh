#!/bin/bash
set -e
mkdir -p "$1/.kiln/docs"
cat > "$1/.kiln/docs/codebase-state.md" <<'EOF'
<!-- status: complete -->
# Codebase State

## TL;DR
Missing freshness schema fields.
EOF
