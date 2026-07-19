#!/usr/bin/env bash
# run.sh — the harness entry point. Plain `node --test`, zero dependencies. Two suites, both
# mandatory: the surviving v3 acceptance guards (tests/v3/) and the locked in-package plugin
# floor (plugins/kiln/tests/). Non-zero exit on any failing test in either suite.
# Run standalone from anywhere; resolves the repo root via git.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# The canonical acceptance commands. Older node lines (18/20) scan each directory for *.test.mjs;
# modern lines load the directory as an entry module — each suite's index.js covers that path
# (see their headers).
node --test tests/v3/
node --test plugins/kiln/tests/
