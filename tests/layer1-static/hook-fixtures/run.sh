#!/bin/bash
# hook-fixtures/run.sh — run all hook fixture pairs.
#
# Each fixture is a pair in a per-hook subdirectory:
#   {name}.json         stdin to the hook (tool_input JSON)
#   {name}.expected     assertion block with sections:
#
#     === STDOUT ===
#     {exact match, trimmed}
#     === STDERR ===
#     {substring match — each non-empty line must appear in stderr}
#     === EXIT ===
#     {exit code}
#     === CONTEXT ===
#     {optional — "no-pipeline" | "mock-pipeline" (default)}
#
# Runner behavior:
#   - Creates an isolated temp dir with a mock Kiln pipeline (.kiln/STATE.md
#     + seed docs), runs the hook with PWD=tempdir.
#   - `CONTEXT: no-pipeline` variant runs with an empty tempdir (no .kiln/).
#
# Usage:
#   ./run.sh                    # all hooks
#   ./run.sh enforce-pipeline   # single hook dir

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"

SCRIPTS_DIR="$REPO_ROOT/plugins/kiln/skills/kiln-pipeline/scripts"
HOOKS_DIR="$REPO_ROOT/plugins/kiln/hooks"

declare -A HOOK_SCRIPT
HOOK_SCRIPT["audit-milestone"]="$SCRIPTS_DIR/audit-milestone.sh"
HOOK_SCRIPT["audit-bash"]="$SCRIPTS_DIR/audit-bash.sh"
HOOK_SCRIPT["audit-status-marker"]="$SCRIPTS_DIR/audit-status-marker.sh"
HOOK_SCRIPT["enforce-pipeline"]="$SCRIPTS_DIR/enforce-pipeline.sh"
HOOK_SCRIPT["stop-guard"]="$HOOKS_DIR/stop-guard.sh"
HOOK_SCRIPT["subagent-start-ack"]="$HOOKS_DIR/subagent-start-ack.sh"

# Set up mock pipeline — a fake project with .kiln/ so hooks' context gate passes.
setup_mock_pipeline() {
  local dir="$1"
  mkdir -p "$dir/.kiln/docs" "$dir/.kiln/validation" "$dir/.kiln/tmp" "$dir/.kiln/archive"
  cat > "$dir/.kiln/STATE.md" <<'STATE_EOF'
# Kiln State

## Pipeline
- **skill**: /DEV/kiln/plugins/kiln/skills/kiln-pipeline/SKILL.md
- **roster**: /DEV/kiln/plugins/kiln/skills/kiln-pipeline/references/blueprints/step-5-build.md
- **stage**: build
- **team_iteration**: 1
- **chunk_count**: 3
- **correction_cycle**: 0
- **milestone_count**: 2
- **milestones_complete**: 0
- **plugin_version**: 1.3.0
- **run_id**: kiln-test01
- **started**: 2026-04-16
- **updated**: 2026-04-16T12:00:00Z

## Project
- **Name**: Test Project
- **Type**: greenfield
- **Path**: PWDSUB

## Flags
- **greenfield**: true
- **codex_available**: true
- **arch_review**: auto-proceed
STATE_EOF
  sed -i "s|PWDSUB|$dir|" "$dir/.kiln/STATE.md"

  # seed PM-owned files with the correct status marker
  printf '<!-- status: complete -->\n# Codebase State\n\n## TL;DR\nTest fixture.\n' > "$dir/.kiln/docs/codebase-state.md"
  printf '<!-- status: complete -->\n# Patterns\n\n## TL;DR\nTest fixture.\n' > "$dir/.kiln/docs/patterns.md"
  printf '<!-- status: complete -->\n# Architecture\n' > "$dir/.kiln/docs/architecture.md"

  # seed iter-log with a happy milestone-complete entry
  cat > "$dir/.kiln/docs/iter-log.md" <<'ITER_EOF'
## Iteration 1 — 2026-04-16T11:00:00Z
milestone: M1
head_sha: abc1234
scope: D1, D2
result: continue

## Iteration 2 — 2026-04-16T11:30:00Z
milestone: M1
head_sha: def5678
scope: D3
result: milestone_complete, qa: PASS
ITER_EOF

  # minimal master-plan so agents that read it don't crash
  printf '# Master Plan\n\n### Milestone: M1\nDeliverables.\n' > "$dir/.kiln/master-plan.md"
}

parse_section() {
  # $1=file $2=section_name → prints section content
  awk -v sec="$2" '
    $0 == "=== " sec " ===" { flag = 1; next }
    /^=== / { flag = 0 }
    flag { print }
  ' "$1"
}

run_one() {
  local json="$1"
  local expected="${json%.json}.expected"
  local name=$(basename "${json%.json}")
  local dir_name=$(basename "$(dirname "$json")")
  local script="${HOOK_SCRIPT[$dir_name]:-}"

  if [[ -z "$script" || ! -f "$script" ]]; then
    echo "    ? $name — script not mapped (skip)"
    SKIP=$((SKIP+1))
    return
  fi

  if [[ ! -f "$expected" ]]; then
    echo "    ? $name — .expected missing (skip)"
    SKIP=$((SKIP+1))
    return
  fi

  # Set up isolated tempdir
  local tmpdir
  tmpdir=$(mktemp -d -t kiln-fixture-XXXXXX)
  trap "rm -rf $tmpdir" RETURN

  local ctx
  ctx=$(parse_section "$expected" "CONTEXT" | tr -d '[:space:]')
  [[ -z "$ctx" ]] && ctx="mock-pipeline"

  case "$ctx" in
    mock-pipeline)
      setup_mock_pipeline "$tmpdir"
      ;;
    no-pipeline)
      : # empty tempdir
      ;;
    *)
      echo "    ? $name — unknown CONTEXT '$ctx' (skip)"
      SKIP=$((SKIP+1))
      return
      ;;
  esac

  # Apply per-fixture modifications if present
  local fixup="${json%.json}.fixup.sh"
  if [[ -f "$fixup" ]]; then
    bash "$fixup" "$tmpdir" >/dev/null 2>&1 || true
  fi

  # Run hook
  local actual_stdout actual_exit actual_stderr
  pushd "$tmpdir" >/dev/null
  actual_stdout="$(cat "$json" | bash "$script" 2>/tmp/kiln_fixture_stderr_$$)"
  actual_exit=$?
  popd >/dev/null
  actual_stderr="$(cat /tmp/kiln_fixture_stderr_$$)"
  rm -f /tmp/kiln_fixture_stderr_$$

  # Parse expected
  local exp_stdout exp_stdout_contains exp_stderr exp_exit
  exp_stdout=$(parse_section "$expected" "STDOUT")
  exp_stdout_contains=$(parse_section "$expected" "STDOUT_CONTAINS")
  exp_stderr=$(parse_section "$expected" "STDERR")
  exp_exit=$(parse_section "$expected" "EXIT" | head -1 | tr -d '[:space:]')

  local ok=1
  local reasons=()

  if [[ -n "$exp_exit" && "$exp_exit" != "$actual_exit" ]]; then
    ok=0
    reasons+=("exit: got $actual_exit, expected $exp_exit")
  fi

  # Trim trailing whitespace for stdout exact comparison
  local exp_stdout_t actual_stdout_t
  exp_stdout_t=$(printf '%s' "$exp_stdout" | sed -e 's/[[:space:]]*$//')
  actual_stdout_t=$(printf '%s' "$actual_stdout" | sed -e 's/[[:space:]]*$//')

  if [[ -n "$exp_stdout_t" ]]; then
    if [[ "$actual_stdout_t" != "$exp_stdout_t" ]]; then
      ok=0
      reasons+=("stdout differs")
    fi
  fi

  # STDOUT_CONTAINS — each non-empty expected line must appear in actual stdout
  while IFS= read -r expected_line; do
    [[ -z "$expected_line" ]] && continue
    if [[ "$actual_stdout" != *"$expected_line"* ]]; then
      ok=0
      reasons+=("stdout missing: $expected_line")
    fi
  done <<< "$exp_stdout_contains"

  while IFS= read -r expected_line; do
    [[ -z "$expected_line" ]] && continue
    if [[ "$actual_stderr" != *"$expected_line"* ]]; then
      ok=0
      reasons+=("stderr missing: $expected_line")
    fi
  done <<< "$exp_stderr"

  if [[ $ok -eq 1 ]]; then
    echo "    ✓ $name"
    PASS=$((PASS+1))
  else
    echo "    ✗ $name"
    for r in "${reasons[@]}"; do
      echo "       → $r"
    done
    if [[ -n "$actual_stdout" ]]; then
      echo "       actual stdout: $(echo "$actual_stdout" | head -2 | sed 's/^/         /')"
    fi
    if [[ -n "$actual_stderr" ]]; then
      echo "       actual stderr: $(echo "$actual_stderr" | head -2 | sed 's/^/         /')"
    fi
    echo "       actual exit:   $actual_exit"
    FAIL=$((FAIL+1))
    FAILED_NAMES+=("$dir_name/$name")
  fi
}

run_dir() {
  local dir="$1"
  local fixture_dir="$HERE/$dir"
  [[ -d "$fixture_dir" ]] || return 0
  shopt -s nullglob
  local jsons=("$fixture_dir"/*.json)
  shopt -u nullglob
  if [[ ${#jsons[@]} -eq 0 ]]; then
    return 0
  fi
  echo "  $dir/"
  for json in "${jsons[@]}"; do
    run_one "$json"
  done
}

PASS=0
FAIL=0
SKIP=0
FAILED_NAMES=()

if [[ $# -gt 0 ]]; then
  run_dir "$1"
else
  for dir in "${!HOOK_SCRIPT[@]}"; do
    run_dir "$dir"
  done
fi

echo ""
echo "Hook fixtures: $PASS passed, $FAIL failed, $SKIP skipped"

if [[ $FAIL -gt 0 ]]; then
  echo "Failed:"
  for n in "${FAILED_NAMES[@]}"; do
    echo "  $n"
  done
  exit 1
fi
exit 0
