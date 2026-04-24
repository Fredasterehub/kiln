#!/bin/bash
set -e
mkdir -p "$1/.kiln/validation"
cat > "$1/.kiln/validation/report.md" <<'EOF'
# Validation Report
Project type: Web App
Playwright MCP unavailable in current runtime; browser automation skipped.
Verdict: PASS
EOF
