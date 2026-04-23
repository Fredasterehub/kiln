#!/bin/bash
set -u
TMPDIR="$1"
cat > "$TMPDIR/.kiln/tmp/activity.json" <<'EOF'
{
  "last_activity_ts": 1713379200,
  "last_activity_source": "SubagentStop",
  "active_teammates": {},
  "last_nudge_ts": 0,
  "nudge_count": 0,
  "epoch": 2,
  "pipeline_phase": "build"
}
EOF
