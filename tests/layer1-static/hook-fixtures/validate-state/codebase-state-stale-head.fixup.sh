#!/bin/bash
set -e
cat > "$1/.kiln/docs/codebase-state.md" <<'EOF'
<!-- status: complete -->
# Codebase State

head_sha: stale-head
last_update_summary: stale fixture
changed_files: none
known_constraints: none
open_risks: none
next_boss_consult_notes: none

## TL;DR
Stale fixture.
EOF
