#!/bin/bash
# analyze.sh — Parse race condition test results and generate reports
#
# Usage:
#   ./analyze.sh                    # Full analysis of latest run
#   ./analyze.sh /path/to/run       # Analyze specific run
#   ./analyze.sh --protocol naive   # Filter by protocol
#   ./analyze.sh --json             # Output raw JSON instead of tables

set -euo pipefail

RACE_TEST_DIR="/tmp/kiln-race-test"
RUN_DIR="${1:-$RACE_TEST_DIR/latest}"
OUTPUT_JSON=false
FILTER_PROTO=""
FILTER_TOPO=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) OUTPUT_JSON=true; shift ;;
    --protocol) FILTER_PROTO="$2"; shift 2 ;;
    --topology) FILTER_TOPO="$2"; shift 2 ;;
    *) RUN_DIR="$1"; shift ;;
  esac
done

[ ! -f "$RUN_DIR/manifest.json" ] && echo "Error: No manifest at $RUN_DIR" && exit 1

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          RACE CONDITION TEST ANALYSIS REPORT                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Run: $(jq -r '.run_id' "$RUN_DIR/manifest.json")"
echo "Started: $(jq -r '.started' "$RUN_DIR/manifest.json")"
echo ""

# ── Collect all results ──────────────────────────────────────────
results_file=$(mktemp)
echo "[" > "$results_file"
first=true
for dir in "$RUN_DIR"/*/; do
  [ -f "$dir/result.json" ] || continue
  $first || echo "," >> "$results_file"
  cat "$dir/result.json" >> "$results_file"
  first=false
done
echo "]" >> "$results_file"

total=$(jq 'length' "$results_file")
echo "Total results collected: $total"
echo ""

# ── 1. Protocol Ranking ─────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "1. PROTOCOL RANKING (by completion rate, then avg wall time)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
printf "%-22s %8s %10s %10s %8s %8s\n" "Protocol" "Success%" "AvgTime" "P95Time" "Retries" "Idles"
printf "%-22s %8s %10s %10s %8s %8s\n" "────────────────────" "────────" "──────────" "──────────" "────────" "────────"

jq -r '
  group_by(.protocol) |
  map({
    protocol: .[0].protocol,
    total: length,
    completed: [.[] | select(.completed == true)] | length,
    avg_wall_ms: ([.[] | .wall_time_ms // 0] | add / length | floor),
    p95_wall_ms: (sort_by(.wall_time_ms) | .[((length * 0.95) | floor)].wall_time_ms // 0),
    total_retries: ([.[] | .retry_count // 0] | add),
    total_idles: ([.[] | .idle_events // 0] | add)
  }) |
  sort_by(- (.completed / .total), .avg_wall_ms) |
  .[] |
  "\(.protocol)\t\((.completed * 100 / .total | floor))%\t\(.avg_wall_ms)ms\t\(.p95_wall_ms)ms\t\(.total_retries)\t\(.total_idles)"
' "$results_file" | while IFS=$'\t' read -r proto rate avg p95 retries idles; do
  printf "%-22s %8s %10s %10s %8s %8s\n" "$proto" "$rate" "$avg" "$p95" "$retries" "$idles"
done

echo ""

# ── 2. Failure Mode Breakdown ────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "2. FAILURE MODE BREAKDOWN"
echo "═══════════════════════════════════════════════════════════════"
echo ""
printf "%-22s %8s %12s %12s %12s %12s\n" "Protocol" "Fails" "idle_death" "msg_lost" "spawn_race" "timeout"
printf "%-22s %8s %12s %12s %12s %12s\n" "────────────────────" "────────" "────────────" "────────────" "────────────" "────────────"

jq -r '
  group_by(.protocol) |
  map({
    protocol: .[0].protocol,
    failures: [.[] | select(.completed == false)],
    idle_death: [.[] | select(.failure_mode == "idle_death")] | length,
    msg_lost: [.[] | select(.failure_mode == "message_lost")] | length,
    spawn_race: [.[] | select(.failure_mode == "spawn_race")] | length,
    timeout: [.[] | select(.failure_mode == "timeout")] | length
  }) |
  .[] |
  "\(.protocol)\t\(.failures | length)\t\(.idle_death)\t\(.msg_lost)\t\(.spawn_race)\t\(.timeout)"
' "$results_file" | while IFS=$'\t' read -r proto fails idle msg spawn tout; do
  printf "%-22s %8s %12s %12s %12s %12s\n" "$proto" "$fails" "$idle" "$msg" "$spawn" "$tout"
done

echo ""

# ── 3. Topology Impact ───────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "3. TOPOLOGY IMPACT MATRIX (completion rate per protocol×topology)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
printf "%-22s %14s %14s %14s %14s\n" "Protocol" "boss-worker" "chain" "fan-out-in" "peer-mesh"
printf "%-22s %14s %14s %14s %14s\n" "────────────────────" "──────────────" "──────────────" "──────────────" "──────────────"

jq -r '
  group_by(.protocol) |
  map({
    protocol: .[0].protocol,
    topologies: (group_by(.topology) | map({
      topology: .[0].topology,
      rate: (([.[] | select(.completed == true)] | length) * 100 / length | floor)
    }) | from_entries)
  }) | .[] |
  "\(.protocol)\t\(.topologies["boss-worker"] // "—")%\t\(.topologies["chain"] // "—")%\t\(.topologies["fan-out-in"] // "—")%\t\(.topologies["peer-mesh"] // "—")%"
' "$results_file" 2>/dev/null | while IFS=$'\t' read -r proto bw ch fo pm; do
  printf "%-22s %14s %14s %14s %14s\n" "$proto" "$bw" "$ch" "$fo" "$pm"
done

echo ""

# ── 4. Size Scaling ──────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "4. SIZE SCALING (completion rate per protocol×size)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
printf "%-22s %10s %10s %10s\n" "Protocol" "Small(2)" "Medium(4)" "Large(6)"
printf "%-22s %10s %10s %10s\n" "────────────────────" "──────────" "──────────" "──────────"

jq -r '
  group_by(.protocol) |
  map({
    protocol: .[0].protocol,
    sizes: (group_by(.size) | map({
      size: .[0].size,
      rate: (([.[] | select(.completed == true)] | length) * 100 / length | floor)
    }) | from_entries)
  }) | .[] |
  "\(.protocol)\t\(.sizes["small"] // "—")%\t\(.sizes["medium"] // "—")%\t\(.sizes["large"] // "—")%"
' "$results_file" 2>/dev/null | while IFS=$'\t' read -r proto sm md lg; do
  printf "%-22s %10s %10s %10s\n" "$proto" "$sm" "$md" "$lg"
done

echo ""

# ── 5. Message Efficiency ────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "5. MESSAGE EFFICIENCY (avg messages per successful test)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
printf "%-22s %12s %12s %12s\n" "Protocol" "AvgMsgs" "AvgRetries" "Overhead%"
printf "%-22s %12s %12s %12s\n" "────────────────────" "────────────" "────────────" "────────────"

jq -r '
  group_by(.protocol) |
  map({
    protocol: .[0].protocol,
    successful: [.[] | select(.completed == true)],
  }) |
  map(select(.successful | length > 0)) |
  map({
    protocol: .protocol,
    avg_msgs: ([.successful[] | .message_count // 0] | add / length | floor),
    avg_retries: ([.successful[] | .retry_count // 0] | add / length * 10 | floor / 10),
    overhead: (
      ([.successful[] | .retry_count // 0] | add) * 100 /
      (([.successful[] | .message_count // 1] | add) | if . == 0 then 1 else . end) | floor
    )
  }) |
  sort_by(.avg_msgs) |
  .[] |
  "\(.protocol)\t\(.avg_msgs)\t\(.avg_retries)\t\(.overhead)%"
' "$results_file" 2>/dev/null | while IFS=$'\t' read -r proto msgs retries overhead; do
  printf "%-22s %12s %12s %12s\n" "$proto" "$msgs" "$retries" "$overhead"
done

echo ""

# ── 6. Recommendations ───────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "6. RECOMMENDATIONS"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Find best protocol by completion rate
best=$(jq -r '
  group_by(.protocol) |
  map({
    protocol: .[0].protocol,
    rate: (([.[] | select(.completed == true)] | length) * 100 / length),
    avg_wall: ([.[] | .wall_time_ms // 0] | add / length)
  }) |
  sort_by(-.rate, .avg_wall) |
  .[0].protocol
' "$results_file" 2>/dev/null || echo "insufficient data")

echo "Best protocol by completion rate: $best"
echo ""

# Find worst failure mode
worst_mode=$(jq -r '
  [.[] | select(.completed == false) | .failure_mode // "unknown"] |
  group_by(.) |
  map({mode: .[0], count: length}) |
  sort_by(-.count) |
  .[0] // {mode: "none", count: 0} |
  "\(.mode) (\(.count) occurrences)"
' "$results_file" 2>/dev/null || echo "insufficient data")

echo "Most common failure mode: $worst_mode"
echo ""
echo "See individual test logs at: $RUN_DIR/<test_id>/"

# Cleanup
rm -f "$results_file"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                     END OF REPORT"
echo "═══════════════════════════════════════════════════════════════"
