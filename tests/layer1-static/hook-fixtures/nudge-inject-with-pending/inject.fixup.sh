#!/bin/bash
TMPDIR="$1"
mkdir -p "$TMPDIR/.kiln/tmp"
cat > "$TMPDIR/.kiln/tmp/pending-nudge.json" <<'EOF'
{"additionalContext": "DEADLOCK WARNING: full team idle for >5min. Pipeline phase: build. Please check teammate status and re-dispatch if needed."}
EOF
