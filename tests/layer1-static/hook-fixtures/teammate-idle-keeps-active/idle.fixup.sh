#!/bin/bash
set -u

tmpdir="$1"
mkdir -p "$tmpdir/.kiln/tmp"

# Pre-seed a tracked teammate so TeammateIdle exercises the heartbeat-only
# path: the hook should update activity metadata without removing this entry.
cat > "$tmpdir/.kiln/tmp/activity.json" <<'JSON'
{"active_teammates":{"rakim-build-3":1713379198},"last_activity_ts":1713379198,"last_activity_source":"SubagentStart","pipeline_phase":"build","epoch":1,"last_nudge_ts":0,"nudge_count":0}
JSON
