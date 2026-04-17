#!/bin/bash
# state-mutation/run.sh — verify Wave 3 (C10) STATE.md sed patterns
# actually mutate the real markdown-bullet field format used by the
# pipeline. Pre-Wave-3 patterns targeted plain `field: N` and silently
# no-oped against `- **field**: N`, so counters never advanced.
#
# This test reconstructs the bossman chunk_count increment and the
# engine milestone-transition reset against the same mock STATE.md the
# hook fixtures use, and asserts the values actually change.

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"

PASS=0
FAIL=0
FAILED=()

mktempdir() {
  mktemp -d -t kiln-state-mutation-XXXXXX
}

seed_state() {
  # $1 = dir, $2 = team_iteration value, $3 = chunk_count value
  cat > "$1/.kiln/STATE.md" <<EOF
# Kiln State

## Pipeline
- **skill**: ${REPO_ROOT}/plugins/kiln/skills/kiln-pipeline/SKILL.md
- **roster**: ${REPO_ROOT}/plugins/kiln/skills/kiln-pipeline/references/blueprints/step-5-build.md
- **stage**: build
- **team_iteration**: $2
- **chunk_count**: $3
- **correction_cycle**: 0
- **milestone_count**: 2
- **milestones_complete**: 0
- **plugin_version**: 1.3.0
- **run_id**: kiln-test-sed
- **started**: 2026-04-17
- **updated**: 2026-04-17T00:00:00Z

## Project
- **Name**: Test Project
- **Type**: greenfield
- **Path**: $1

## Flags
- **greenfield**: true
- **codex_available**: true
- **arch_review**: auto-proceed
EOF
}

check_field() {
  # $1 = file, $2 = field name, $3 = expected value
  local got
  got=$(grep -oP "(?<=\*\*$2\*\*:\s)[0-9]+" "$1" | head -1)
  if [[ "$got" != "$3" ]]; then
    echo "       field $2: got '$got', expected '$3'"
    return 1
  fi
  return 0
}

test_bossman_chunk_increment() {
  local name="bossman-chunk-increment"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln"
  seed_state "$tmp" 2 3
  (
    cd "$tmp" || exit 1
    CHUNK=$(grep -oP '(?<=\*\*chunk_count\*\*:\s)[0-9]+' .kiln/STATE.md | head -1)
    CHUNK=$((CHUNK + 1))
    sed -i -E "s/(\*\*chunk_count\*\*:[[:space:]]*)[0-9]+/\1${CHUNK}/" .kiln/STATE.md
  )
  local ok=1
  check_field "$tmp/.kiln/STATE.md" "chunk_count" "4" || ok=0
  check_field "$tmp/.kiln/STATE.md" "team_iteration" "2" || ok=0  # unchanged
  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

test_milestone_transition_reset() {
  local name="milestone-transition-team-iter-bump-and-chunk-reset"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln"
  seed_state "$tmp" 2 7
  (
    cd "$tmp" || exit 1
    CURRENT_TEAM_ITER=$(grep -oP '(?<=\*\*team_iteration\*\*:\s)[0-9]+' .kiln/STATE.md | head -1)
    NEW_TEAM_ITER=$((CURRENT_TEAM_ITER + 1))
    sed -i -E "s/(\*\*team_iteration\*\*:[[:space:]]*)[0-9]+/\1${NEW_TEAM_ITER}/" .kiln/STATE.md
    sed -i -E "s/(\*\*chunk_count\*\*:[[:space:]]*)[0-9]+/\10/" .kiln/STATE.md
  )
  local ok=1
  check_field "$tmp/.kiln/STATE.md" "team_iteration" "3" || ok=0
  check_field "$tmp/.kiln/STATE.md" "chunk_count" "0" || ok=0
  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

test_pre_wave3_pattern_would_noop() {
  # Regression lock: the retired pre-Wave-3 sed shape targeting
  # plain `chunk_count:` MUST silently no-op against markdown-bullet
  # state. If someone reintroduces that pattern, this test catches it.
  local name="pre-wave3-plain-pattern-noops-as-expected"
  local tmp
  tmp=$(mktempdir)
  mkdir -p "$tmp/.kiln"
  seed_state "$tmp" 1 5
  (
    cd "$tmp" || exit 1
    # Legacy (broken) sed — does not account for markdown bullet wrapping
    sed -i "s/chunk_count: [0-9]*/chunk_count: 99/" .kiln/STATE.md
  )
  local ok=1
  check_field "$tmp/.kiln/STATE.md" "chunk_count" "5" || ok=0
  if (( ok == 1 )); then
    echo "    ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "    ✗ $name"
    echo "       Pre-Wave-3 pattern unexpectedly mutated — the bullet shape may have changed."
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
  rm -rf "$tmp"
}

echo "── State-mutation tests ─────────────────"
echo "  chunk_count / team_iteration sed patterns"
test_bossman_chunk_increment
test_milestone_transition_reset
test_pre_wave3_pattern_would_noop
echo ""
echo "State-mutation: ${PASS} passed, ${FAIL} failed"
if (( FAIL > 0 )); then
  echo "Failed:"
  for n in "${FAILED[@]}"; do
    echo "  $n"
  done
  exit 1
fi
exit 0
