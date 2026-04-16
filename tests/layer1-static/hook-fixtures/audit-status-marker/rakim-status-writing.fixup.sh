#!/bin/bash
# Overwrite codebase-state.md with status:writing (invalid — should be complete)
cat > "$1/.kiln/docs/codebase-state.md" <<'EOF'
<!-- status: writing -->
# Codebase State
EOF
