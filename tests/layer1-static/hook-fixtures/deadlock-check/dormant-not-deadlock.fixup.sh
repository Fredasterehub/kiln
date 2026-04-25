#!/bin/bash
set -u

tmpdir="$1"
mkdir -p "$tmpdir/.kiln/tmp"
now=$(date +%s)

cat > "$tmpdir/.kiln/tmp/activity.json" <<JSON
{"active_teammates":{"rakim-build-3":$now},"last_activity_ts":$now,"last_activity_source":"TeammateIdle","pipeline_phase":"build","epoch":1,"last_nudge_ts":0,"nudge_count":0}
JSON
