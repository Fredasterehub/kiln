#!/bin/bash
# layer1-static/run.sh — static lint + hook fixtures.
set -e
cd "$(dirname "$0")"

FAIL=0

echo "── Layer 1 — Static lint ─────────────────"
python3 lint/consistency.py || FAIL=1
python3 lint/agents.py || FAIL=1
python3 lint/skills.py || FAIL=1
python3 lint/orphans.py --warn-only || FAIL=1

echo ""
echo "── Layer 1 — Hook fixtures ───────────────"
bash hook-fixtures/run.sh || FAIL=1

echo ""
bash doctor-agent-teams/run.sh || FAIL=1

echo ""
bash state-mutation/run.sh || FAIL=1

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "Layer 1: PASS"
else
  echo "Layer 1: FAIL"
  exit 1
fi
