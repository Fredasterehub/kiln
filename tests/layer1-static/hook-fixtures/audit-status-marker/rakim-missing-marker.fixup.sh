#!/bin/bash
# Overwrite codebase-state.md without the status marker
cat > "$1/.kiln/docs/codebase-state.md" <<'EOF'
# Codebase State

## TL;DR
Bootstrapping
EOF
