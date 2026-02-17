#!/usr/bin/env bats
# Tests for hooks/scripts/on-task-completed.sh

setup() {
  export TEST_DIR="$(mktemp -d)"
  mkdir -p "$TEST_DIR/.kiln"
  export HOOK="$(pwd)/hooks/scripts/on-task-completed.sh"
  export FIXTURES_DIR="$BATS_TEST_DIRNAME/fixtures"
  unset KILN_TEAMS_ACTIVE
  unset KILN_WORKTREE_ROOT
}

teardown() {
  rm -rf "$TEST_DIR"
}

# Helper: run hook in test dir
run_hook() {
  cd "$TEST_DIR" && sh "$HOOK"
}

# Helper: create git repo with one modified tracked file
init_repo_with_project_change() {
  cd "$TEST_DIR" || return 1
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  printf 'base\n' > tracked.txt
  git add tracked.txt
  git commit -qm "init"
  printf 'changed\n' >> tracked.txt
}

@test "skips when KILN_TEAMS_ACTIVE is set" {
  export KILN_TEAMS_ACTIVE=1
  run run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ] || [[ "$output" == *"skipped"* ]]
}

@test "skips when no .kiln directory" {
  rm -rf "$TEST_DIR/.kiln"
  run run_hook
  [ "$status" -eq 0 ]
}

@test "skips when no config.json" {
  init_repo_with_project_change
  run run_hook
  [ "$status" -eq 0 ]
}

@test "skips when testRunner is null" {
  init_repo_with_project_change
  cp "$FIXTURES_DIR/config_null_runner.json" "$TEST_DIR/.kiln/config.json"
  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"No test runner"* ]]
}

@test "skips when testRunner missing from config" {
  init_repo_with_project_change
  cp "$FIXTURES_DIR/config_no_tooling.json" "$TEST_DIR/.kiln/config.json"
  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"No test runner"* ]]
}

@test "debounce: skips when last run < 10 seconds ago" {
  init_repo_with_project_change
  cp "$FIXTURES_DIR/config_with_runner.json" "$TEST_DIR/.kiln/config.json"
  printf '{"last_run_epoch":%s,"last_diff_hash":""}\n' "$(date +%s)" > "$TEST_DIR/.kiln/mini-verify-cache.json"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"debounced"* ]]
}

@test "debounce: runs when last run > 10 seconds ago" {
  init_repo_with_project_change
  cp "$FIXTURES_DIR/config_with_runner.json" "$TEST_DIR/.kiln/config.json"
  printf '{"last_run_epoch":%s,"last_diff_hash":""}\n' "$(( $(date +%s) - 30 ))" > "$TEST_DIR/.kiln/mini-verify-cache.json"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *"debounced"* ]]
}

@test "extracts testRunner from config via node" {
  init_repo_with_project_change
  cp "$FIXTURES_DIR/config_with_runner.json" "$TEST_DIR/.kiln/config.json"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *"No test runner"* ]]
  [[ "$output" == *"Mini-verify"* || "$output" == *"test command 'npm' not found"* ]]
}

@test "handles cross-env prefix correctly" {
  init_repo_with_project_change
  cp "$FIXTURES_DIR/config_cross_env.json" "$TEST_DIR/.kiln/config.json"

  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *"unrecognized test runner"* ]]
}

@test "writes mini-verify-result.json on completion" {
  init_repo_with_project_change
  cat > "$TEST_DIR/.kiln/config.json" <<'JSON'
{
  "tooling": {
    "testRunner": "node --version"
  }
}
JSON

  run run_hook
  [ "$status" -eq 0 ]
  [ -f "$TEST_DIR/.kiln/mini-verify-result.json" ]
  run cat "$TEST_DIR/.kiln/mini-verify-result.json"
  [[ "$output" == *"\"status\":\"pass\""* ]]
}
