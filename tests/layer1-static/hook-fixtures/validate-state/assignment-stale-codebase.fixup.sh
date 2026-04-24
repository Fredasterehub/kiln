#!/bin/bash
set -e
head=$(git -C "$1" rev-parse HEAD)
cat > "$1/.kiln/tmp/chunk-1-assignment.xml" <<EOF
<assignment>
  <assignment_id>m1-c1</assignment_id>
  <milestone_id>M1</milestone_id>
  <chunk>1</chunk>
  <freshness>
    <head_sha>${head}</head_sha>
    <dirty_status>clean</dirty_status>
    <codebase_state_head_sha>stale-head</codebase_state_head_sha>
    <timestamp>2026-04-16T12:00:00Z</timestamp>
    <source_artifacts>.kiln/master-plan.md, .kiln/docs/codebase-state.md</source_artifacts>
  </freshness>
</assignment>
EOF
