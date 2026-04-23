#!/bin/bash
set -u
TMPDIR="$1"
cat > "$TMPDIR/.kiln/tmp/activity.json" <<'EOF'
{
  "last_activity_ts": 1713379200,
  "last_activity_source": "SubagentStart",
  "active_teammates": {
    "rakim-build-3": 1713379200
  },
  "last_nudge_ts": 0,
  "nudge_count": 0,
  "epoch": 1,
  "pipeline_phase": "build"
}
EOF
