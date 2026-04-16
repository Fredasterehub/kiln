#!/bin/bash
# tests/run-all.sh — entrypoint for the full Kiln test harness.
#
# Layered testing pyramid:
#   Layer 1 (static + hook fixtures): ~2s, no LLM, catches ~80% of audit findings
#   Layer 2 (replay): ~30s, no LLM, catches routing/sequencing bugs
#   Smoke (kilndev, elsewhere):    ~37 min, LLMs — behavioral oracle only
#
# Usage: bash tests/run-all.sh

set -e
cd "$(dirname "$0")"

echo "╔══════════════════════════════════════════╗"
echo "║ Kiln test harness — Layers 1 + 2         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

bash layer1-static/run.sh
echo ""
bash layer2-replay/run.sh
echo ""

echo "═══════════════════════════════════════════"
echo "All layers passed — ready to smoke kilndev."
echo "═══════════════════════════════════════════"
