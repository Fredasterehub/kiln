#!/usr/bin/env bats
# Tests for hooks/scripts/on-session-start.sh

setup() {
  export TEST_DIR="$(mktemp -d)"
  export HOOK="$(pwd)/hooks/scripts/on-session-start.sh"
  export FIXTURES_DIR="$BATS_TEST_DIRNAME/fixtures"
}

teardown() {
  rm -rf "$TEST_DIR"
}

run_hook() {
  cd "$TEST_DIR" && sh "$HOOK"
}

@test "prints init message when no .kiln directory" {
  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"not initialized"* ]]
}

@test "prints missing state when .kiln exists but no state files" {
  mkdir -p "$TEST_DIR/.kiln"
  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"state missing"* ]]
}

@test "reads state.json when present" {
  mkdir -p "$TEST_DIR/.kiln"
  cp "$FIXTURES_DIR/state.json_fresh.json" "$TEST_DIR/.kiln/state.json"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"Phase 1 of 3"* ]]
  [[ "$output" == *"Next: Run /kiln:fire"* ]]
}

@test "reports halted status from state.json" {
  mkdir -p "$TEST_DIR/.kiln"
  cp "$FIXTURES_DIR/state.json_halted.json" "$TEST_DIR/.kiln/state.json"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"halted"* ]]
  [[ "$output" == *"Operator action needed"* ]]
}

@test "falls back to STATE.md when state.json missing" {
  mkdir -p "$TEST_DIR/.kiln"
  cp "$FIXTURES_DIR/STATE_inprogress.md" "$TEST_DIR/.kiln/STATE.md"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"execute"* ]]
}

@test "warns on malformed state - missing fields in STATE.md" {
  mkdir -p "$TEST_DIR/.kiln"
  cp "$FIXTURES_DIR/STATE_missing_fields.md" "$TEST_DIR/.kiln/STATE.md"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"corrupted"* || "$output" == *"Warning"* ]]
}

@test "reports paused status" {
  mkdir -p "$TEST_DIR/.kiln"
  cp "$FIXTURES_DIR/state.json_paused.json" "$TEST_DIR/.kiln/state.json"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"Session rehydrated"* ]]
}

@test "tip shown on fresh install pending state" {
  mkdir -p "$TEST_DIR/.kiln"
  cp "$FIXTURES_DIR/state.json_fresh.json" "$TEST_DIR/.kiln/state.json"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"Tip:"* ]]
  [[ "$output" == *"dangerously-skip-permissions"* ]]
}

@test "STATE.md format drift resilience - extra spaces in field values" {
  mkdir -p "$TEST_DIR/.kiln"
  cat > "$TEST_DIR/.kiln/STATE.md" <<'MD'
- **Step Status:**   in-progress  
- **Current Step:**   execute  
MD

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"Status: in-progress"* ]]
}

@test "no .kiln dir exits 0" {
  run run_hook
  [ "$status" -eq 0 ]
}
