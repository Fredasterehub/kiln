#!/bin/bash
# S6: Full Autonomous — seed setup
# Copies Steps 1-2 artifacts from finalkiln, sets STATE.md to stage: research
# Same seed as S1 but with 60 min timeout — runs Steps 3-7 end to end
#
# Usage: ./setup.sh <workspace_dir>

set -euo pipefail

WORKSPACE="${1:?Usage: ./setup.sh <workspace_dir>}"
SOURCE="/DEV/finalkiln/.kiln"

if [[ ! -d "$SOURCE" ]]; then
  echo "ERROR: Seed source not found at $SOURCE" >&2
  exit 1
fi

# Create directory structure
mkdir -p "$WORKSPACE/.kiln/docs/research" "$WORKSPACE/.kiln/plans" "$WORKSPACE/.kiln/archive" "$WORKSPACE/.kiln/archive/step-3-research" "$WORKSPACE/.kiln/archive/step-4-architecture" "$WORKSPACE/.kiln/archive/step-5-build" "$WORKSPACE/.kiln/archive/step-6-validate" "$WORKSPACE/.kiln/validation" "$WORKSPACE/.kiln/tmp"

# Copy Steps 1-2 artifacts
cp "$SOURCE/docs/VISION.md" "$WORKSPACE/.kiln/docs/"
cp "$SOURCE/docs/vision-notes.md" "$WORKSPACE/.kiln/docs/"
cp "$SOURCE/docs/vision-priorities.md" "$WORKSPACE/.kiln/docs/"
cp "$SOURCE/docs/codebase-snapshot.md" "$WORKSPACE/.kiln/docs/"
cp "$SOURCE/docs/decisions.md" "$WORKSPACE/.kiln/docs/"

# Write STATE.md for research stage
cat > "$WORKSPACE/.kiln/STATE.md" <<'STATE'
# Kiln Pipeline State

## Project
- **name**: Linkah
- **path**: WORKSPACE_PLACEHOLDER
- **type**: single-page web app
- **description**: Personal link dashboard — paste URLs, auto-fetch title + favicon, tag links, filter by tag, localStorage persistence.

## Stack
- **language**: HTML / CSS / JavaScript (vanilla)
- **framework**: none
- **package_manager**: none
- **build_tools**: none — static files
- **testing**: none specified

## Pipeline
- **skill**: PLUGIN_ROOT_PLACEHOLDER/skills/kiln-pipeline/SKILL.md
- **roster**: PLUGIN_ROOT_PLACEHOLDER/skills/kiln-pipeline/references/blueprints/step-3-research.md
- **stage**: research
- **build_iteration**: 0
- **correction_cycle**: 0
- **milestone_count**: 0
- **milestones_complete**: 0
- **run_id**: kiln-test-s6
- **started**: 2026-03-12
- **updated**: 2026-03-12T00:00:00

## Flags
- **greenfield**: true
STATE

# Replace placeholders
sed -i "s|WORKSPACE_PLACEHOLDER|$WORKSPACE|g" "$WORKSPACE/.kiln/STATE.md"
sed -i "s|PLUGIN_ROOT_PLACEHOLDER|${CLAUDE_PLUGIN_ROOT:-/DEV/kilntop/plugin}|g" "$WORKSPACE/.kiln/STATE.md"

# Create banner symlinks
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-/DEV/kilntop/plugin}"
KB_PATH="$PLUGIN_ROOT/skills/kiln-pipeline/scripts/kb.sh"
for dir in omega brainstorm deploy solid magic pass alpha; do
  mkdir -p "$WORKSPACE/$dir"
done
ln -sf "$KB_PATH" "$WORKSPACE/omega/alpha"
ln -sf "$KB_PATH" "$WORKSPACE/brainstorm/crunch"
ln -sf "$KB_PATH" "$WORKSPACE/deploy/spies"
ln -sf "$KB_PATH" "$WORKSPACE/solid/foundation"
ln -sf "$KB_PATH" "$WORKSPACE/magic/happens"
ln -sf "$KB_PATH" "$WORKSPACE/pass/ordontpass"
ln -sf "$KB_PATH" "$WORKSPACE/alpha/omega"

# Git init
cd "$WORKSPACE"
git init -q
git add -A
git commit -q -m "Seed state: S6 Full Autonomous (Steps 1-2 complete)"

echo "S6 workspace ready at: $WORKSPACE"
echo "Stage: research | Full E2E run | Run: kiln-test-s6"
