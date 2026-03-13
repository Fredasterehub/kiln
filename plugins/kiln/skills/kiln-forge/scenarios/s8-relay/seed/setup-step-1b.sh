#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE="${1:?Usage: setup-step-1b.sh <workspace_dir>}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-/DEV/kilntop/plugin}"
PIPELINE_ROOT="$PLUGIN_ROOT/skills/kiln-pipeline"
RUN_DATE="$(date +%Y-%m-%d)"
RUN_TS="$(date +%Y-%m-%dT%H:%M:%S)"

mkdir -p "$WORKSPACE"
mkdir -p "$WORKSPACE/.kiln/docs/research" \
         "$WORKSPACE/.kiln/plans" \
         "$WORKSPACE/.kiln/archive" \
         "$WORKSPACE/.kiln/validation" \
         "$WORKSPACE/.kiln/tmp"

cp -R "$SCENARIO_DIR/seed/golden/brownfield-codebase/." "$WORKSPACE/"

cat > "$WORKSPACE/.kiln/STATE.md" <<STATE
# Kiln Pipeline State

## Project
- **name**: TodoApp
- **path**: $WORKSPACE
- **type**: existing web app
- **description**: Simple todo list app with localStorage persistence — pre-existing codebase to scan.

## Stack
- **language**: HTML / CSS / JavaScript (vanilla)
- **framework**: none
- **package_manager**: none
- **build_tools**: none — static files
- **testing**: none

## Pipeline
- **skill**: $PIPELINE_ROOT/SKILL.md
- **roster**: $PIPELINE_ROOT/references/blueprints/step-1-onboarding.md
- **stage**: onboarding
- **build_iteration**: 0
- **correction_cycle**: 0
- **milestone_count**: 0
- **milestones_complete**: 0
- **run_id**: kiln-test-s8-step-1b
- **started**: $RUN_DATE
- **updated**: $RUN_TS

## Flags
- **greenfield**: false
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
git commit -q --allow-empty -m "Seed state: S8 Relay step 1b (brownfield onboarding)"

echo "S8 workspace ready at: $WORKSPACE"
echo "Step: 1b | Stage: onboarding (brownfield) | Run: kiln-test-s8-step-1b"
