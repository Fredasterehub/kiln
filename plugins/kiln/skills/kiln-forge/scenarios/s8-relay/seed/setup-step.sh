#!/bin/bash
# S8: Step-Isolated Relay seed setup
# Usage: ./setup-step.sh <step_number> <workspace_dir>

set -euo pipefail

STEP="${1:?Usage: ./setup-step.sh <step_number> <workspace_dir>}"
WORKSPACE="${2:?Usage: ./setup-step.sh <step_number> <workspace_dir>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GOLDEN_ROOT="$SCENARIO_DIR/seed/golden"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-/DEV/kilntop/plugin}"
PIPELINE_ROOT="$PLUGIN_ROOT/skills/kiln-pipeline"
RUN_DATE="$(date +%Y-%m-%d)"
RUN_TS="$(date +%Y-%m-%dT%H:%M:%S)"

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

if [ -e "$WORKSPACE" ] && [ -n "$(find "$WORKSPACE" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  echo "Workspace must be empty: $WORKSPACE" >&2
  exit 1
fi

seed_source=""
stage=""
roster=""
build_iteration=0
correction_cycle=0
milestone_count=0
milestones_complete=0

case "$STEP" in
  1)
    stage="onboarding"
    roster="$PIPELINE_ROOT/references/blueprints/step-1-onboarding.md"
    ;;
  2)
    stage="brainstorm"
    roster="$PIPELINE_ROOT/references/blueprints/step-2-brainstorm.md"
    seed_source="$GOLDEN_ROOT/after-step-1"
    ;;
  3)
    stage="research"
    roster="$PIPELINE_ROOT/references/blueprints/step-3-research.md"
    seed_source="$GOLDEN_ROOT/after-step-2"
    ;;
  4)
    stage="architecture"
    roster="$PIPELINE_ROOT/references/blueprints/step-4-architecture.md"
    seed_source="$GOLDEN_ROOT/after-step-3"
    ;;
  5)
    stage="build"
    roster="$PIPELINE_ROOT/references/blueprints/step-5-build.md"
    seed_source="$GOLDEN_ROOT/after-step-4"
    milestone_count=1
    ;;
  6)
    stage="validate"
    roster="$PIPELINE_ROOT/references/blueprints/step-6-validate.md"
    seed_source="$GOLDEN_ROOT/after-step-5"
    build_iteration=1
    milestone_count=1
    milestones_complete=1
    ;;
  7)
    stage="report"
    roster="$PIPELINE_ROOT/references/blueprints/step-7-report.md"
    seed_source="$GOLDEN_ROOT/after-step-6"
    build_iteration=1
    milestone_count=1
    milestones_complete=1
    ;;
  *)
    echo "Unsupported step: $STEP" >&2
    exit 1
    ;;
esac

mkdir -p "$WORKSPACE"
mkdir -p "$WORKSPACE/.kiln/docs/research" \
         "$WORKSPACE/.kiln/plans" \
         "$WORKSPACE/.kiln/archive" \
         "$WORKSPACE/.kiln/archive/step-3-research" \
         "$WORKSPACE/.kiln/archive/step-4-architecture" \
         "$WORKSPACE/.kiln/archive/step-5-build" \
         "$WORKSPACE/.kiln/archive/step-6-validate" \
         "$WORKSPACE/.kiln/validation" \
         "$WORKSPACE/.kiln/tmp"

if [ -n "$seed_source" ]; then
  cp -R "$seed_source/." "$WORKSPACE/"
fi

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
- **skill**: $PIPELINE_ROOT/SKILL.md
- **roster**: $roster
- **stage**: $stage
- **build_iteration**: $build_iteration
- **correction_cycle**: $correction_cycle
- **milestone_count**: $milestone_count
- **milestones_complete**: $milestones_complete
- **run_id**: kiln-test-s8-step-$STEP
- **started**: $RUN_DATE
- **updated**: $RUN_TS

## Flags
- **greenfield**: true
- **has_local_studio**: false
STATE

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

cd "$WORKSPACE"
git init -q
git config user.name >/dev/null 2>&1 || git config user.name "Kiln Baseline"
git config user.email >/dev/null 2>&1 || git config user.email "kiln-baseline@example.invalid"
git add -A
git commit -q --allow-empty -m "Seed state: S8 Relay step $STEP ($stage)"

echo "S8 workspace ready at: $WORKSPACE"
echo "Step: $STEP | Stage: $stage | Run: kiln-test-s8-step-$STEP"
