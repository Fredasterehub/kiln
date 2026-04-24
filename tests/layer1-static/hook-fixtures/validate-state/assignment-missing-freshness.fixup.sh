#!/bin/bash
set -e
cat > "$1/.kiln/tmp/chunk-2-assignment.xml" <<'EOF'
<assignment>
  <assignment_id>m1-c2</assignment_id>
  <milestone_id>M1</milestone_id>
  <chunk>2</chunk>
  <freshness>
    <dirty_status>clean</dirty_status>
    <codebase_state_head_sha>abc123</codebase_state_head_sha>
    <timestamp>2026-04-16T12:00:00Z</timestamp>
    <source_artifacts>.kiln/master-plan.md, .kiln/docs/codebase-state.md</source_artifacts>
  </freshness>
</assignment>
EOF
