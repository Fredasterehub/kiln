#!/bin/bash
# Overwrite iter-log with an entry that has result: milestone_complete but no qa: PASS
cat > "$1/.kiln/docs/iter-log.md" <<'EOF'
## Iteration 1 — 2026-04-16T11:00:00Z
milestone: M1
head_sha: abc1234
scope: D1, D2
result: continue

## Iteration 2 — 2026-04-16T11:30:00Z
milestone: M1
head_sha: def5678
scope: D3
result: milestone_complete
EOF
