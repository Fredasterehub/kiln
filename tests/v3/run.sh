#!/usr/bin/env bash
# run.sh — the v3 harness entry point (BLUEPRINT §13). Plain `node --test`, zero dependencies.
# Non-zero exit on any failing test. Run standalone from anywhere; resolves the repo root via git.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# The canonical acceptance command. Older node lines (18/20) scan the directory for *.test.mjs;
# modern lines load it as an entry module — tests/v3/index.js covers that path (see its header).
node --test tests/v3/
