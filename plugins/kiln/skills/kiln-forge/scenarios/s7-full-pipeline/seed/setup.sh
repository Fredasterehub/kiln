#!/bin/bash
# S7: Full Pipeline — seed setup
# Creates empty workspace at onboarding stage — tests ALL 7 steps from scratch.
#
# Usage: ./setup.sh <workspace_dir>

set -euo pipefail

WORKSPACE="${1:?Usage: ./setup.sh <workspace_dir>}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-/DEV/kilntop/plugin}"
PIPELINE_ROOT="$PLUGIN_ROOT/skills/kiln-pipeline"

required_files=(
  "$PIPELINE_ROOT/SKILL.md"
  "$PIPELINE_ROOT/references/blueprints/step-1-onboarding.md"
  "$PIPELINE_ROOT/references/blueprints/step-2-brainstorm.md"
  "$PIPELINE_ROOT/references/blueprints/step-3-research.md"
  "$PIPELINE_ROOT/references/blueprints/step-4-architecture.md"
  "$PIPELINE_ROOT/references/blueprints/step-5-build.md"
  "$PIPELINE_ROOT/references/blueprints/step-6-validate.md"
  "$PIPELINE_ROOT/references/blueprints/step-7-report.md"
  "$PIPELINE_ROOT/references/artifact-flow.md"
  "$PIPELINE_ROOT/references/step-definitions.md"
)

for path in "${required_files[@]}"; do
  if [ ! -f "$path" ]; then
    echo "Missing required pipeline file: $path" >&2
    exit 1
  fi
done

# Create directory structure
mkdir -p "$WORKSPACE/.kiln/docs/research" \
         "$WORKSPACE/.kiln/plans" \
         "$WORKSPACE/.kiln/archive" \
         "$WORKSPACE/.kiln/archive/step-3-research" \
         "$WORKSPACE/.kiln/archive/step-4-architecture" \
         "$WORKSPACE/.kiln/archive/step-5-build" \
         "$WORKSPACE/.kiln/archive/step-6-validate" \
         "$WORKSPACE/.kiln/validation" \
         "$WORKSPACE/.kiln/tmp"

# Write STATE.md for onboarding stage (step 1)
cat > "$WORKSPACE/.kiln/STATE.md" <<STATE
# Kiln Pipeline State

## Project
- **name**: Linkah
- **path**: $WORKSPACE
- **type**: single-page web app
- **description**: Personal link dashboard — paste URLs, auto-fetch title + favicon, tag links, filter by tag, localStorage persistence.

## Stack
- **language**: HTML / CSS / JavaScript (vanilla)
- **framework**: none
- **package_manager**: none
- **build_tools**: none — static files
- **testing**: none specified

## Pipeline
- **skill**: $PLUGIN_ROOT/skills/kiln-pipeline/SKILL.md
- **roster**: $PLUGIN_ROOT/skills/kiln-pipeline/references/blueprints/step-1-onboarding.md
- **stage**: onboarding
- **build_iteration**: 0
- **correction_cycle**: 0
- **milestone_count**: 0
- **milestones_complete**: 0
- **run_id**: kiln-test-s7
- **started**: $(date +%Y-%m-%d)
- **updated**: $(date +%Y-%m-%dT%H:%M:%S)

## Flags
- **greenfield**: true
STATE

# Create banner symlinks (skip if kb.sh not present — GitHub version doesn't have it)
KB_PATH="$PIPELINE_ROOT/scripts/kb.sh"
if [ -f "$KB_PATH" ]; then
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
fi

# Git init
cd "$WORKSPACE"
git init -q
git config user.name >/dev/null 2>&1 || git config user.name "Kiln Baseline"
git config user.email >/dev/null 2>&1 || git config user.email "kiln-baseline@example.invalid"
git add -A
git commit -q --allow-empty -m "Seed state: S7 Full Pipeline (onboarding)"

echo "S7 workspace ready at: $WORKSPACE"
echo "Stage: onboarding | Run: kiln-test-s7"
