#!/bin/bash
# layer2-replay/run.sh — replay scenarios against the mock engine.
set -e
cd "$(dirname "$0")"

FAIL=0
COUNT=0

echo "── Layer 2 — Replay scenarios ────────────"

for scenario in scenarios/*.yaml; do
  [[ -f "$scenario" ]] || continue
  COUNT=$((COUNT + 1))
  if python3 replay.py --scenario "$scenario"; then
    :
  else
    FAIL=1
  fi
done

echo ""
if [[ $COUNT -eq 0 ]]; then
  echo "Layer 2: no scenarios found (expected during bootstrap)"
elif [[ $FAIL -eq 0 ]]; then
  echo "Layer 2: PASS ($COUNT scenarios)"
else
  echo "Layer 2: FAIL"
  exit 1
fi
