#!/bin/bash
# run-batch.sh — Generate test case manifest and manage results
#
# Usage:
#   ./run-batch.sh init                  # Create run directory, manifest, canary
#   ./run-batch.sh list [--filter PROTO] # List test cases (optionally filtered)
#   ./run-batch.sh result TEST_ID JSON   # Record a test result
#   ./run-batch.sh status                # Show run progress
#   ./run-batch.sh summary               # Quick summary of completed tests

set -euo pipefail

RACE_TEST_DIR="/tmp/kiln-race-test"

PROTOCOLS=(naive ack-required phased-strict heartbeat retry-on-idle redundant-send watchdog confirmation-chain broadcast-wake echo-verify)
TOPOLOGIES=(boss-worker chain fan-out-in peer-mesh)
SIZES=(small medium large)

# Worker counts per size
declare -A SIZE_WORKERS
SIZE_WORKERS[small]=1
SIZE_WORKERS[medium]=3
SIZE_WORKERS[large]=5

cmd="${1:-help}"
shift || true

case "$cmd" in
  init)
    RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
    RUN_DIR="$RACE_TEST_DIR/$RUN_ID"
    mkdir -p "$RUN_DIR"

    # Create canary file
    echo "CANARY: $(date +%s%3N)" > "$RACE_TEST_DIR/canary.txt"

    # Generate manifest
    total=0
    tests_json="["
    for proto in "${PROTOCOLS[@]}"; do
      for topo in "${TOPOLOGIES[@]}"; do
        for size in "${SIZES[@]}"; do
          test_id="${proto}-${topo}-${size}"
          workers=${SIZE_WORKERS[$size]}
          worker_list=""
          for i in $(seq 1 "$workers"); do
            [ -n "$worker_list" ] && worker_list="$worker_list,"
            worker_list="${worker_list}worker-${i}"
          done

          [ "$total" -gt 0 ] && tests_json="$tests_json,"
          tests_json="$tests_json{\"test_id\":\"$test_id\",\"protocol\":\"$proto\",\"topology\":\"$topo\",\"size\":\"$size\",\"worker_count\":$workers,\"workers\":\"$worker_list\"}"

          mkdir -p "$RUN_DIR/$test_id"
          total=$((total + 1))
        done
      done
    done
    tests_json="$tests_json]"

    cat > "$RUN_DIR/manifest.json" <<MANIFEST
{
  "run_id": "$RUN_ID",
  "run_dir": "$RUN_DIR",
  "started": "$(date -Iseconds)",
  "total_tests": $total,
  "tests": $tests_json
}
MANIFEST

    # Symlink latest
    ln -sfn "$RUN_DIR" "$RACE_TEST_DIR/latest"

    echo "Initialized: $RUN_DIR"
    echo "Total test cases: $total"
    echo "Canary file: $RACE_TEST_DIR/canary.txt"
    echo ""
    echo "Run dir symlinked to: $RACE_TEST_DIR/latest"
    ;;

  list)
    RUN_DIR="$RACE_TEST_DIR/latest"
    [ ! -f "$RUN_DIR/manifest.json" ] && echo "No active run. Run 'init' first." && exit 1

    filter="${1:-}"
    if [ -n "$filter" ]; then
      jq -r ".tests[] | select(.protocol == \"$filter\" or .topology == \"$filter\" or .size == \"$filter\") | .test_id" "$RUN_DIR/manifest.json"
    else
      jq -r '.tests[].test_id' "$RUN_DIR/manifest.json"
    fi
    ;;

  result)
    RUN_DIR="$RACE_TEST_DIR/latest"
    test_id="$1"
    shift
    result_json="$*"

    echo "$result_json" > "$RUN_DIR/$test_id/result.json"
    echo "Recorded result for $test_id"
    ;;

  status)
    RUN_DIR="$RACE_TEST_DIR/latest"
    [ ! -f "$RUN_DIR/manifest.json" ] && echo "No active run." && exit 1

    total=$(jq '.total_tests' "$RUN_DIR/manifest.json")
    completed=0
    failed=0
    for dir in "$RUN_DIR"/*/; do
      [ -f "$dir/result.json" ] && {
        completed=$((completed + 1))
        success=$(jq -r '.completed' "$dir/result.json" 2>/dev/null || echo "false")
        [ "$success" = "false" ] && failed=$((failed + 1))
      }
    done

    passed=$((completed - failed))
    pending=$((total - completed))

    echo "Run: $(basename "$RUN_DIR")"
    echo "Total:     $total"
    echo "Completed: $completed ($passed passed, $failed failed)"
    echo "Pending:   $pending"
    echo ""
    echo "Progress: $(( (completed * 100) / total ))%"
    ;;

  summary)
    RUN_DIR="$RACE_TEST_DIR/latest"
    [ ! -f "$RUN_DIR/manifest.json" ] && echo "No active run." && exit 1

    echo "=== Quick Summary ==="
    echo ""

    # Per-protocol completion rate
    echo "Protocol Completion Rates:"
    echo "─────────────────────────"
    for proto in "${PROTOCOLS[@]}"; do
      total=0
      passed=0
      for dir in "$RUN_DIR"/${proto}-*/; do
        [ -f "$dir/result.json" ] && {
          total=$((total + 1))
          success=$(jq -r '.completed' "$dir/result.json" 2>/dev/null || echo "false")
          [ "$success" = "true" ] && passed=$((passed + 1))
        }
      done
      if [ "$total" -gt 0 ]; then
        rate=$(( (passed * 100) / total ))
        printf "  %-20s %3d%% (%d/%d)\n" "$proto" "$rate" "$passed" "$total"
      fi
    done

    echo ""
    echo "Topology Completion Rates:"
    echo "──────────────────────────"
    for topo in "${TOPOLOGIES[@]}"; do
      total=0
      passed=0
      for dir in "$RUN_DIR"/*-${topo}-*/; do
        [ -f "$dir/result.json" ] && {
          total=$((total + 1))
          success=$(jq -r '.completed' "$dir/result.json" 2>/dev/null || echo "false")
          [ "$success" = "true" ] && passed=$((passed + 1))
        }
      done
      if [ "$total" -gt 0 ]; then
        rate=$(( (passed * 100) / total ))
        printf "  %-20s %3d%% (%d/%d)\n" "$topo" "$rate" "$passed" "$total"
      fi
    done
    ;;

  help|*)
    echo "Usage: $0 {init|list|result|status|summary}"
    echo ""
    echo "  init              Create new test run directory and manifest"
    echo "  list [FILTER]     List test case IDs (filter by protocol/topology/size)"
    echo "  result ID JSON    Record result for a test case"
    echo "  status            Show run progress"
    echo "  summary           Quick summary of completed results"
    ;;
esac
