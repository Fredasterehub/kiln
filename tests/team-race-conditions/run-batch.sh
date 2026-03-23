#!/bin/bash
# run-batch.sh — Adaptive staged test runner with SPRT dropout
#
# Usage:
#   ./run-batch.sh init                    # Create run directory, manifest, canary
#   ./run-batch.sh next [--count N]        # Get next batch of tests for current stage
#   ./run-batch.sh result TEST_ID JSON     # Record a test result
#   ./run-batch.sh dropout                 # Run SPRT dropout check, update eliminated list
#   ./run-batch.sh advance                 # Advance to next stage (after dropout)
#   ./run-batch.sh stage                   # Show current stage and surviving protocols
#   ./run-batch.sh status                  # Show run progress
#   ./run-batch.sh summary                 # Quick summary of completed tests
#   ./run-batch.sh resume                  # Print resume instructions for new session
#   ./run-batch.sh lock TEST_ID            # Mark test as inflight (before execution)
#   ./run-batch.sh unlock TEST_ID          # Remove inflight lock (after execution)
#   ./run-batch.sh recover                 # Re-queue stale inflight tests (crash recovery)
#   ./run-batch.sh list [--filter PROTO]   # List all test cases (optionally filtered)

set -euo pipefail

RACE_TEST_DIR="/tmp/kiln-race-test"
HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"

ALL_PROTOCOLS=(naive ack-required phased-strict heartbeat retry-on-idle redundant-send watchdog confirmation-chain broadcast-wake echo-verify)
ALL_TOPOLOGIES=(boss-worker chain fan-out-in peer-mesh)
ALL_SIZES=(small medium large)

declare -A SIZE_WORKERS
SIZE_WORKERS[small]=1
SIZE_WORKERS[medium]=3
SIZE_WORKERS[large]=5

# ── Helpers ──────────────────────────────────────────────────────

_run_dir() {
  local d="$RACE_TEST_DIR/latest"
  [ -L "$d" ] || { echo "No active run. Run 'init' first." >&2; exit 1; }
  echo "$(readlink -f "$d")"
}

_state_file() { echo "$(_run_dir)/state.json"; }

_get_stage() { jq -r '.current_stage' "$(_state_file)" 2>/dev/null || echo "1"; }

_get_survivors() { jq -r '.survivors[]' "$(_state_file)" 2>/dev/null || printf '%s\n' "${ALL_PROTOCOLS[@]}"; }

_get_eliminated() { jq -r '.eliminated[]' "$(_state_file)" 2>/dev/null; }

_count_results() {
  local run_dir="$1" proto="$2" pattern="$3"
  local total=0 passed=0 failed=0
  for dir in "$run_dir"/${proto}-${pattern}/; do
    [ -f "$dir/result.json" ] || continue
    total=$((total + 1))
    success=$(jq -r '.completed' "$dir/result.json" 2>/dev/null || echo "false")
    [ "$success" = "true" ] && passed=$((passed + 1)) || failed=$((failed + 1))
  done
  echo "$total $passed $failed"
}

# ── Commands ─────────────────────────────────────────────────────

cmd="${1:-help}"
shift || true

case "$cmd" in

  # ── INIT ─────────────────────────────────────────────────────
  init)
    RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
    RUN_DIR="$RACE_TEST_DIR/$RUN_ID"
    mkdir -p "$RUN_DIR"

    # Canary file for worker tasks
    echo "CANARY: $(date +%s%3N)" > "$RACE_TEST_DIR/canary.txt"

    # Initialize state
    survivors_json=$(printf '%s\n' "${ALL_PROTOCOLS[@]}" | jq -R . | jq -s .)
    cat > "$RUN_DIR/state.json" <<STATE
{
  "run_id": "$RUN_ID",
  "run_dir": "$RUN_DIR",
  "started": "$(date -Iseconds)",
  "current_stage": 1,
  "survivors": $(echo "$survivors_json"),
  "eliminated": [],
  "stage_history": [],
  "sessions": [{"session": 1, "started": "$(date -Iseconds)", "tests_run": 0}]
}
STATE

    # Stage definitions
    cat > "$RUN_DIR/stages.json" <<'STAGES'
{
  "stages": {
    "1": {
      "name": "Screening",
      "description": "All protocols × boss-worker × small × 20 runs. Kill obviously bad protocols.",
      "topologies": ["boss-worker"],
      "sizes": ["small"],
      "runs_per_cell": 20,
      "dropout_rules": {
        "after_5":  {"max_failures": 4, "description": "Drop if ≥4/5 failures (80%+)"},
        "after_10": {"max_failures": 6, "description": "Drop if ≥6/10 failures (60%+)"},
        "after_15": {"max_failures": 7, "description": "Drop if ≥7/15 failures (47%+)"},
        "after_20": {"max_failures": 8, "description": "Drop if ≥8/20 failures (40%+)"}
      }
    },
    "2": {
      "name": "Topology Sensitivity",
      "description": "Survivors × all topologies × small × 20 runs. Find topology-sensitive protocols.",
      "topologies": ["boss-worker", "chain", "fan-out-in", "peer-mesh"],
      "sizes": ["small"],
      "runs_per_cell": 20,
      "dropout_rules": {
        "after_10": {"max_failures": 5, "description": "Drop if ≥5/10 failures on ANY topology (50%+)"},
        "after_20": {"max_failures": 7, "description": "Drop if ≥7/20 failures on ANY topology (35%+)"}
      }
    },
    "3": {
      "name": "Scale Stress",
      "description": "Survivors × boss-worker × all sizes × 30 runs. Test size scaling.",
      "topologies": ["boss-worker"],
      "sizes": ["small", "medium", "large"],
      "runs_per_cell": 30,
      "dropout_rules": {
        "after_15": {"max_failures": 6, "description": "Drop if ≥6/15 failures at ANY size (40%+)"},
        "after_30": {"max_failures": 9, "description": "Drop if ≥9/30 failures at ANY size (30%+)"}
      }
    },
    "4": {
      "name": "Deep Validation",
      "description": "Top 2 × full matrix × 30 runs. Final confirmation.",
      "topologies": ["boss-worker", "chain", "fan-out-in", "peer-mesh"],
      "sizes": ["small", "medium", "large"],
      "runs_per_cell": 30,
      "dropout_rules": {}
    }
  }
}
STAGES

    ln -sfn "$RUN_DIR" "$RACE_TEST_DIR/latest"

    echo "╔══════════════════════════════════════╗"
    echo "║   Race Condition Test Run Created    ║"
    echo "╚══════════════════════════════════════╝"
    echo ""
    echo "Run ID:    $RUN_ID"
    echo "Run dir:   $RUN_DIR"
    echo "Canary:    $RACE_TEST_DIR/canary.txt"
    echo ""
    echo "Stage 1: Screening — 10 protocols × boss-worker × small × 20 runs = 200 tests"
    echo ""
    echo "Next: run './run-batch.sh next' to get the first batch of tests"
    ;;

  # ── NEXT ─────────────────────────────────────────────────────
  next)
    RUN_DIR="$(_run_dir)"
    stage=$(_get_stage)
    # Parse count (supports: next 3, next --count 3, next)
    count=3
    if [ "${1:-}" = "--count" ]; then count="${2:-3}"
    elif [ -n "${1:-}" ]; then count="$1"
    fi

    # Read stage config
    stage_config=$(jq ".stages[\"$stage\"]" "$RUN_DIR/stages.json")
    runs_per_cell=$(echo "$stage_config" | jq -r '.runs_per_cell')
    topos=$(echo "$stage_config" | jq -r '.topologies[]')
    sizes=$(echo "$stage_config" | jq -r '.sizes[]')

    survivors=($(_get_survivors))

    # Find tests that still need runs
    batch=()
    for proto in "${survivors[@]}"; do
      for topo in $topos; do
        for size in $sizes; do
          cell_id="${proto}-${topo}-${size}"
          cell_dir="$RUN_DIR/$cell_id"
          mkdir -p "$cell_dir"

          # Count existing runs for this cell (find avoids ls glob failure under pipefail)
          existing=$(find "$cell_dir" -maxdepth 1 -name 'run-*.json' 2>/dev/null | wc -l)
          existing=$((existing + 0))

          if [ "$existing" -lt "$runs_per_cell" ]; then
            needed=$((runs_per_cell - existing))
            for i in $(seq 1 "$needed"); do
              run_num=$((existing + i))
              test_id="${cell_id}/run-$(printf '%03d' "$run_num")"
              batch+=("$test_id")
              [ "${#batch[@]}" -ge "$count" ] && break 4
            done
          fi
        done
      done
    done

    if [ "${#batch[@]}" -eq 0 ]; then
      echo "All tests for Stage $stage complete."
      echo "Run './run-batch.sh dropout' to check for eliminations, then './run-batch.sh advance'"
      exit 0
    fi

    # Build batch JSON
    queue_json="{"
    queue_json+="\"generated\":\"$(date -Iseconds)\","
    queue_json+="\"stage\":$stage,"
    queue_json+="\"stage_name\":$(echo "$stage_config" | jq '.name'),"
    queue_json+="\"batch_size\":${#batch[@]},"
    queue_json+="\"tests\":["

    first=true
    for test_id in "${batch[@]}"; do
      cell="${test_id%/*}"
      run_num="${test_id##*/}"
      size="${cell##*-}"
      remainder="${cell%-*}"

      # Match known topologies (handles hyphens like fan-out-in)
      topo=""
      proto=""
      for t in boss-worker chain fan-out-in peer-mesh; do
        if [[ "$remainder" == *"-$t" ]]; then
          topo="$t"
          proto="${remainder%-$t}"
          break
        fi
      done

      workers=${SIZE_WORKERS[$size]}
      worker_list=""
      for i in $(seq 1 "$workers"); do
        [ -n "$worker_list" ] && worker_list="$worker_list, "
        worker_list="${worker_list}worker-${i}"
      done

      # Short team name (avoids collisions)
      topo_short=$(echo "$topo" | cut -c1-2)
      size_short=$(echo "$size" | cut -c1)
      team_name="race-${proto}-${topo_short}-${size_short}-${run_num##*-}"

      $first || queue_json+=","
      queue_json+=$(cat <<TESTJSON
{
      "test_id": "$test_id",
      "cell_id": "$cell",
      "run_num": "$run_num",
      "protocol": "$proto",
      "topology": "$topo",
      "size": "$size",
      "worker_count": $workers,
      "workers": "$worker_list",
      "team_name": "$team_name",
      "protocol_file": "$HARNESS_DIR/protocols/${proto}.md",
      "boss_agent": "$HARNESS_DIR/agents/test-boss.md",
      "worker_agent": "$HARNESS_DIR/agents/test-worker.md",
      "watchdog_agent": "$HARNESS_DIR/agents/test-watchdog.md",
      "log_dir": "$RUN_DIR/$cell"
    }
TESTJSON
)
      first=false
    done
    queue_json+="]}"

    # Write queue to disk AND stdout
    echo "$queue_json" | jq '.' > "$RUN_DIR/queue.json"
    cat "$RUN_DIR/queue.json"

    echo "" >&2
    echo "Queue written to: $RUN_DIR/queue.json" >&2
    echo "Conductor: read queue.json, lock each test, execute, record result, unlock." >&2
    ;;

  # ── RESULT ───────────────────────────────────────────────────
  result)
    RUN_DIR="$(_run_dir)"
    test_id="$1"
    shift
    result_json="$*"

    cell_id="${test_id%/*}"
    run_num="${test_id##*/}"
    cell_dir="$RUN_DIR/$cell_id"
    mkdir -p "$cell_dir"

    echo "$result_json" > "$cell_dir/${run_num}.json"

    # Update session test count
    jq '.sessions[-1].tests_run += 1' "$(_state_file)" > "$(_state_file).tmp" && mv "$(_state_file).tmp" "$(_state_file)"

    echo "Recorded: $test_id"

    # Quick SPRT check after recording
    "$0" dropout --quiet 2>/dev/null || true
    ;;

  # ── DROPOUT ──────────────────────────────────────────────────
  dropout)
    RUN_DIR="$(_run_dir)"
    stage=$(_get_stage)
    quiet="${1:-}"

    stage_config=$(jq ".stages[\"$stage\"]" "$RUN_DIR/stages.json")
    dropout_rules=$(echo "$stage_config" | jq '.dropout_rules')
    topos=$(echo "$stage_config" | jq -r '.topologies[]')
    sizes=$(echo "$stage_config" | jq -r '.sizes[]')

    survivors=($(_get_survivors))
    new_eliminated=()

    for proto in "${survivors[@]}"; do
      eliminated=false
      reason=""

      for topo in $topos; do
        for size in $sizes; do
          cell_dir="$RUN_DIR/${proto}-${topo}-${size}"
          [ -d "$cell_dir" ] || continue

          # Count runs and failures
          total=0
          failed=0
          for f in "$cell_dir"/run-*.json; do
            [ -f "$f" ] || continue
            total=$((total + 1))
            success=$(jq -r '.completed' "$f" 2>/dev/null || echo "false")
            [ "$success" = "false" ] && failed=$((failed + 1))
          done

          # Check each dropout threshold
          for threshold in after_5 after_10 after_15 after_20 after_30; do
            check_at="${threshold#after_}"
            max_fail=$(echo "$dropout_rules" | jq -r ".${threshold}.max_failures // empty" 2>/dev/null)
            [ -z "$max_fail" ] && continue

            if [ "$total" -ge "$check_at" ] && [ "$failed" -ge "$max_fail" ]; then
              eliminated=true
              reason="Stage $stage SPRT: ${failed}/${total} failures on ${topo}/${size} (threshold: ${max_fail}/${check_at})"
              break 3
            fi
          done
        done
      done

      if $eliminated; then
        new_eliminated+=("$proto")
        [ "$quiet" != "--quiet" ] && echo "ELIMINATED: $proto — $reason"
      fi
    done

    if [ "${#new_eliminated[@]}" -gt 0 ]; then
      # Update state file
      state_file="$(_state_file)"
      for proto in "${new_eliminated[@]}"; do
        jq --arg p "$proto" '
          .survivors -= [$p] |
          .eliminated += [$p] |
          .stage_history += [{
            "stage": .current_stage,
            "action": "dropout",
            "protocol": $p,
            "timestamp": (now | todate)
          }]
        ' "$state_file" > "$state_file.tmp" && mv "$state_file.tmp" "$state_file"
      done

      [ "$quiet" != "--quiet" ] && {
        echo ""
        echo "Survivors: $(jq -r '.survivors | join(", ")' "$state_file")"
        echo "Eliminated: $(jq -r '.eliminated | join(", ")' "$state_file")"
      }
    else
      [ "$quiet" != "--quiet" ] && echo "No protocols eliminated this round."
    fi
    ;;

  # ── ADVANCE ──────────────────────────────────────────────────
  advance)
    RUN_DIR="$(_run_dir)"
    state_file="$(_state_file)"
    stage=$(_get_stage)
    next_stage=$((stage + 1))

    if [ "$next_stage" -gt 4 ]; then
      echo "All stages complete. Run './run-batch.sh summary' for final results."
      exit 0
    fi

    survivors=($(_get_survivors))
    survivor_count=${#survivors[@]}

    # Stage 4 caps at top 2
    if [ "$next_stage" -eq 4 ] && [ "$survivor_count" -gt 2 ]; then
      echo "Stage 4 requires top 2 protocols. Currently $survivor_count survivors."
      echo "Ranking by completion rate to auto-select top 2..."

      # Rank survivors by completion rate across all prior results
      rankings=()
      for proto in "${survivors[@]}"; do
        total=0; passed=0
        for f in "$RUN_DIR"/${proto}-*/run-*.json; do
          [ -f "$f" ] || continue
          total=$((total + 1))
          success=$(jq -r '.completed' "$f" 2>/dev/null || echo "false")
          [ "$success" = "true" ] && passed=$((passed + 1))
        done
        rate=0
        [ "$total" -gt 0 ] && rate=$(( (passed * 1000) / total ))
        rankings+=("$rate:$proto")
      done

      # Sort descending and take top 2
      top2=$(printf '%s\n' "${rankings[@]}" | sort -t: -k1 -rn | head -2 | cut -d: -f2)
      echo "Selected: $top2"

      # Eliminate the rest
      for proto in "${survivors[@]}"; do
        if ! echo "$top2" | grep -q "^${proto}$"; then
          jq --arg p "$proto" '
            .survivors -= [$p] |
            .eliminated += [$p] |
            .stage_history += [{
              "stage": .current_stage,
              "action": "ranked_out",
              "protocol": $p,
              "timestamp": (now | todate)
            }]
          ' "$state_file" > "$state_file.tmp" && mv "$state_file.tmp" "$state_file"
          echo "  Ranked out: $proto"
        fi
      done
    fi

    # Advance stage
    jq --argjson s "$next_stage" '
      .current_stage = $s |
      .stage_history += [{
        "stage": $s,
        "action": "stage_start",
        "timestamp": (now | todate)
      }]
    ' "$state_file" > "$state_file.tmp" && mv "$state_file.tmp" "$state_file"

    next_config=$(jq ".stages[\"$next_stage\"]" "$RUN_DIR/stages.json")
    next_name=$(echo "$next_config" | jq -r '.name')
    next_desc=$(echo "$next_config" | jq -r '.description')
    next_runs=$(echo "$next_config" | jq -r '.runs_per_cell')
    survivors_now=($(_get_survivors))
    next_topos=$(echo "$next_config" | jq -r '.topologies | length')
    next_sizes=$(echo "$next_config" | jq -r '.sizes | length')
    est_tests=$(( ${#survivors_now[@]} * next_topos * next_sizes * next_runs ))

    echo ""
    echo "═══════════════════════════════════════"
    echo "Advanced to Stage $next_stage: $next_name"
    echo "═══════════════════════════════════════"
    echo ""
    echo "$next_desc"
    echo ""
    echo "Survivors: ${survivors_now[*]}"
    echo "Estimated tests: ~$est_tests"
    echo ""
    echo "Run './run-batch.sh next' to get the first batch."
    ;;

  # ── STAGE ────────────────────────────────────────────────────
  stage)
    RUN_DIR="$(_run_dir)"
    state_file="$(_state_file)"
    stage=$(_get_stage)

    stage_config=$(jq ".stages[\"$stage\"]" "$RUN_DIR/stages.json")
    stage_name=$(echo "$stage_config" | jq -r '.name')

    echo "╔══════════════════════════════════════╗"
    echo "║  Stage $stage: $(printf '%-30s' "$stage_name")║"
    echo "╚══════════════════════════════════════╝"
    echo ""
    echo "$(echo "$stage_config" | jq -r '.description')"
    echo ""

    survivors=($(_get_survivors))
    eliminated=($(_get_eliminated))

    echo "Survivors (${#survivors[@]}):"
    for s in "${survivors[@]}"; do
      # Count results for this protocol in current stage
      total=0; passed=0
      for f in "$RUN_DIR"/${s}-*/run-*.json; do
        [ -f "$f" ] || continue
        total=$((total + 1))
        success=$(jq -r '.completed' "$f" 2>/dev/null || echo "false")
        [ "$success" = "true" ] && passed=$((passed + 1))
      done
      if [ "$total" -gt 0 ]; then
        rate=$(( (passed * 100) / total ))
        printf "  ✓ %-22s %3d%% (%d/%d)\n" "$s" "$rate" "$passed" "$total"
      else
        printf "  ✓ %-22s (no results yet)\n" "$s"
      fi
    done

    if [ "${#eliminated[@]}" -gt 0 ]; then
      echo ""
      echo "Eliminated (${#eliminated[@]}):"
      for e in "${eliminated[@]}"; do
        printf "  ✗ %s\n" "$e"
      done
    fi

    echo ""

    # Dropout thresholds
    echo "SPRT Dropout Thresholds:"
    echo "$stage_config" | jq -r '.dropout_rules | to_entries[] | "  \(.key): drop if ≥\(.value.max_failures) failures"'
    ;;

  # ── RESUME ───────────────────────────────────────────────────
  resume)
    RUN_DIR="$(_run_dir)"
    state_file="$(_state_file)"
    stage=$(_get_stage)
    run_id=$(jq -r '.run_id' "$state_file")

    # Record new session
    session_num=$(jq '.sessions | length + 1' "$state_file")
    jq --argjson n "$session_num" '
      .sessions += [{"session": $n, "started": (now | todate), "tests_run": 0}]
    ' "$state_file" > "$state_file.tmp" && mv "$state_file.tmp" "$state_file"

    echo "╔══════════════════════════════════════╗"
    echo "║       SESSION RESUME                 ║"
    echo "╚══════════════════════════════════════╝"
    echo ""
    echo "Run ID:          $run_id"
    echo "Run dir:         $RUN_DIR"
    echo "Session:         $session_num"
    echo "Current stage:   $stage ($(jq -r ".stages[\"$stage\"].name" "$RUN_DIR/stages.json"))"
    echo ""

    "$0" stage
    echo ""
    echo "To continue: run './run-batch.sh next' for the next batch of tests."
    ;;

  # ── STATUS ───────────────────────────────────────────────────
  status)
    RUN_DIR="$(_run_dir)"
    state_file="$(_state_file)"
    stage=$(_get_stage)
    run_id=$(jq -r '.run_id' "$state_file")

    total_results=0
    total_passed=0
    total_failed=0
    for f in "$RUN_DIR"/*/run-*.json; do
      [ -f "$f" ] || continue
      total_results=$((total_results + 1))
      success=$(jq -r '.completed' "$f" 2>/dev/null || echo "false")
      [ "$success" = "true" ] && total_passed=$((total_passed + 1)) || total_failed=$((total_failed + 1))
    done

    survivors=($(_get_survivors))
    eliminated=($(_get_eliminated))
    sessions=$(jq '.sessions | length' "$state_file")

    echo "Run:        $run_id"
    echo "Stage:      $stage/4 ($(jq -r ".stages[\"$stage\"].name" "$RUN_DIR/stages.json"))"
    echo "Sessions:   $sessions"
    echo "Results:    $total_results ($total_passed passed, $total_failed failed)"
    echo "Survivors:  ${#survivors[@]} — ${survivors[*]}"
    echo "Eliminated: ${#eliminated[@]} — ${eliminated[*]:-none}"
    ;;

  # ── SUMMARY ──────────────────────────────────────────────────
  summary)
    RUN_DIR="$(_run_dir)"
    state_file="$(_state_file)"

    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║          ADAPTIVE TEST RESULTS SUMMARY                     ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""

    # Overall stats
    "$0" status
    echo ""

    # Per-protocol results
    echo "═══════════════════════════════════════════════════════════════"
    echo "Protocol Results (all stages combined)"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    printf "%-22s %8s %10s %10s %8s %8s %10s\n" "Protocol" "Rate" "Pass/Total" "AvgTime" "Retries" "Idles" "Status"
    printf "%-22s %8s %10s %10s %8s %8s %10s\n" "────────────────────" "────────" "──────────" "──────────" "────────" "────────" "──────────"

    for proto in "${ALL_PROTOCOLS[@]}"; do
      total=0; passed=0; total_time=0; total_retries=0; total_idles=0
      for f in "$RUN_DIR"/${proto}-*/run-*.json; do
        [ -f "$f" ] || continue
        total=$((total + 1))
        success=$(jq -r '.completed' "$f" 2>/dev/null || echo "false")
        [ "$success" = "true" ] && passed=$((passed + 1))
        wt=$(jq -r '.wall_time_ms // 0' "$f" 2>/dev/null || echo 0)
        total_time=$((total_time + wt))
        rt=$(jq -r '.retry_count // 0' "$f" 2>/dev/null || echo 0)
        total_retries=$((total_retries + rt))
        ie=$(jq -r '.idle_events // 0' "$f" 2>/dev/null || echo 0)
        total_idles=$((total_idles + ie))
      done

      if [ "$total" -gt 0 ]; then
        rate=$(( (passed * 100) / total ))
        avg_time=$(( total_time / total ))

        # Check if eliminated
        status="active"
        if jq -e --arg p "$proto" '.eliminated | index($p)' "$state_file" > /dev/null 2>&1; then
          status="DROPPED"
        fi

        printf "%-22s %7d%% %5d/%-4d %8dms %8d %8d %10s\n" \
          "$proto" "$rate" "$passed" "$total" "$avg_time" "$total_retries" "$total_idles" "$status"
      fi
    done

    echo ""

    # Stage history
    echo "═══════════════════════════════════════════════════════════════"
    echo "Stage History"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    jq -r '.stage_history[] | "  [\(.timestamp)] Stage \(.stage): \(.action) \(.protocol // "")"' "$state_file" 2>/dev/null

    echo ""

    # Winner
    survivors=($(_get_survivors))
    if [ "${#survivors[@]}" -le 2 ] && [ "$(_get_stage)" -ge 3 ]; then
      echo "═══════════════════════════════════════════════════════════════"
      echo "RECOMMENDATION"
      echo "═══════════════════════════════════════════════════════════════"
      echo ""
      echo "Finalists: ${survivors[*]}"
      echo ""
      echo "Run './analyze.sh' for detailed breakdown with charts."
    fi
    ;;

  # ── LOCK ──────────────────────────────────────────────────────
  lock)
    RUN_DIR="$(_run_dir)"
    test_id="$1"
    team_name="${2:-race-test}"
    active_dir="$RUN_DIR/active"
    mkdir -p "$active_dir"

    # Sanitize test_id for filename (replace / with __)
    lock_name="${test_id//\//__}"

    cat > "$active_dir/${lock_name}.lock" <<LOCK
{
  "test_id": "$test_id",
  "session": $(jq '.sessions | length' "$(_state_file)"),
  "pid": $$,
  "started": "$(date -Iseconds)",
  "team_name": "$team_name"
}
LOCK
    echo "Locked: $test_id"
    ;;

  # ── UNLOCK ───────────────────────────────────────────────────
  unlock)
    RUN_DIR="$(_run_dir)"
    test_id="$1"
    lock_name="${test_id//\//__}"
    rm -f "$RUN_DIR/active/${lock_name}.lock"
    echo "Unlocked: $test_id"
    ;;

  # ── RECOVER ──────────────────────────────────────────────────
  recover)
    RUN_DIR="$(_run_dir)"
    active_dir="$RUN_DIR/active"
    [ ! -d "$active_dir" ] && echo "No active directory. Nothing to recover." && exit 0

    now=$(date +%s)
    stale_threshold=300  # 5 minutes
    recovered=0

    for lock_file in "$active_dir"/*.lock; do
      [ -f "$lock_file" ] || continue

      lock_time=$(jq -r '.started' "$lock_file" 2>/dev/null)
      lock_epoch=$(date -d "$lock_time" +%s 2>/dev/null || echo 0)
      age=$((now - lock_epoch))

      if [ "$age" -gt "$stale_threshold" ]; then
        test_id=$(jq -r '.test_id' "$lock_file")
        team_name=$(jq -r '.team_name' "$lock_file")
        session=$(jq -r '.session' "$lock_file")

        echo "STALE: $test_id (age: ${age}s, session: $session, team: $team_name)"

        # Write a timeout result for this test
        cell_id="${test_id%/*}"
        run_num="${test_id##*/}"
        cell_dir="$RUN_DIR/$cell_id"
        mkdir -p "$cell_dir"

        # Only write failure if no result exists yet
        if [ ! -f "$cell_dir/${run_num}.json" ]; then
          cat > "$cell_dir/${run_num}.json" <<RESULT
{
  "test_id": "$test_id",
  "completed": false,
  "failure_mode": "session_crash",
  "wall_time_ms": null,
  "message_count": 0,
  "retry_count": 0,
  "idle_events": 0,
  "notes": "Session $session crashed with this test inflight. Recovered at $(date -Iseconds)."
}
RESULT
          echo "  → Recorded as session_crash failure"
        else
          echo "  → Result already exists, skipping"
        fi

        rm -f "$lock_file"
        recovered=$((recovered + 1))
      fi
    done

    if [ "$recovered" -eq 0 ]; then
      echo "No stale locks found. All clean."
    else
      echo ""
      echo "Recovered $recovered stale test(s)."
      echo "Run './run-batch.sh dropout' to check if any protocols should be eliminated."
    fi
    ;;

  # ── LIST ─────────────────────────────────────────────────────
  list)
    RUN_DIR="$(_run_dir)"
    filter="${1:-}"

    for f in "$RUN_DIR"/*/run-*.json; do
      [ -f "$f" ] || continue
      cell=$(basename "$(dirname "$f")")
      run=$(basename "$f" .json)
      test_id="$cell/$run"

      if [ -n "$filter" ]; then
        echo "$test_id" | grep -q "$filter" && echo "$test_id"
      else
        echo "$test_id"
      fi
    done
    ;;

  # ── HELP ─────────────────────────────────────────────────────
  help|*)
    cat <<'HELP'
Race Condition Test Runner — Adaptive Staged Execution with File-Based Handoff

WORKFLOW:
  1. ./run-batch.sh init              Create new run (once)
  2. ./run-batch.sh next [--count N]  Get next batch → writes queue.json
  3. For each test in queue.json:
     a. ./run-batch.sh lock TEST_ID   Mark inflight
     b. (execute test via Claude Code teams)
     c. ./run-batch.sh result ID JSON Record result
     d. ./run-batch.sh unlock TEST_ID Remove lock
  4. ./run-batch.sh dropout           Check SPRT eliminations
  5. Repeat 2-4 until stage complete (next returns empty)
  6. ./run-batch.sh advance           Move to next stage
  7. Repeat 2-6 through all 4 stages

MONITORING:
  ./run-batch.sh stage               Current stage + survivors + thresholds
  ./run-batch.sh status              Quick progress overview
  ./run-batch.sh summary             Full results table with rankings

MULTI-SESSION (context-free handoff):
  ./run-batch.sh recover             Re-queue crashed inflight tests
  ./run-batch.sh resume              Register new session, print state
  ./run-batch.sh next                Continue from where last session left off

STATE FILES (all on disk, zero context dependency):
  state.json     — stage, survivors, eliminated, sessions
  stages.json    — stage definitions (immutable)
  queue.json     — current batch (regenerated each ./next call)
  active/*.lock  — inflight test locks (crash recovery)
  {cell}/run-NNN.json — individual test results

STAGES:
  1. Screening      — 10 protocols × boss-worker × small × 20 runs  (~45 min)
  2. Topology       — survivors × 4 topologies × small × 20 runs    (~1.5 hrs)
  3. Scale Stress   — survivors × boss-worker × 3 sizes × 30 runs   (~2 hrs)
  4. Deep Valid.    — top 2 × full matrix × 30 runs                  (~4 hrs)
HELP
    ;;
esac
