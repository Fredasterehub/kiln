# _kiln-lib.sh — shared utilities for Kiln hook scripts.
#
# Sourced (not executed) by every Kiln hook that needs to locate the
# pipeline root, parse STATE.md stage, strip the kiln: agent prefix, or
# run the composite "is the pipeline actually active" gate. Pure
# utility: no state mutations, no side effects on source, and every
# function returns via exit status rather than calling exit — callers
# own their own fail-open / fail-closed posture.
#
# Output contract for _kiln_pipeline_active:
#   On success (returns 0), exports two variables to the caller's shell:
#     KILN_ROOT   absolute path of the project root containing .kiln/
#     KILN_STAGE  value of the **stage** field from .kiln/STATE.md
#   On failure (returns 1), KILN_ROOT and KILN_STAGE are undefined —
#   callers should not read them. A pre-existing KILN_ROOT in the
#   environment (set by spawn-watchdog.sh for the detached loop, or by
#   a test harness) is honoured: the function trusts it and skips the
#   cwd walk, which is the whole reason spawn-watchdog exports it.
#
# Not intended to be chmod +x'd; invoke via `. path/to/_kiln-lib.sh`.

_kiln_find_root() {
  # Walk upward from PWD until a directory containing .kiln/ is found.
  # Prints that directory and returns 0 on match; returns 1 with no
  # output on miss. Matches the pre-v1.5.3 _find_root semantics the 15
  # copies of this helper shared.
  local d="$PWD"
  while [[ "$d" != "/" ]]; do
    [[ -d "$d/.kiln" ]] && echo "$d" && return 0
    d=$(dirname "$d")
  done
  return 1
}

_kiln_get_stage() {
  # Extracts the **stage** field from the STATE.md at $1. Prints the
  # value and returns 0 on success; returns 1 with no output if the
  # file is missing or the field is absent/empty. The grep pattern is
  # pinned to the markdown-bullet shape `- **stage**: <value>` the
  # pipeline uses — the pre-Wave-3 plain `stage:` pattern is
  # deliberately unsupported (regression-locked by state-mutation
  # test_pre_wave3_pattern_would_noop).
  local state="$1"
  [[ -f "$state" ]] || return 1
  local stage
  stage=$(grep -oP '(?<=\*\*stage\*\*: )\S+' "$state" 2>/dev/null || true)
  [[ -n "$stage" ]] || return 1
  echo "$stage"
  return 0
}

_kiln_pipeline_active() {
  # Composite gate the 14 Kiln hook scripts all open with: returns 0
  # when a Kiln pipeline is actually running (root present, STATE.md
  # present, stage non-empty, stage != complete), returns 1 otherwise.
  # Sets KILN_ROOT + KILN_STAGE on success so callers that need them
  # don't pay the walk/grep twice.
  #
  # Honours a pre-set KILN_ROOT in the environment: watchdog-loop.sh
  # and deadlock-check.sh inherit it from spawn-watchdog.sh to skip
  # the _kiln_find_root walk. The STATE.md + stage checks still run
  # against that root, so a stale export from a non-Kiln shell can't
  # fake the gate.
  if [[ -z "${KILN_ROOT:-}" ]]; then
    KILN_ROOT=$(_kiln_find_root) || return 1
  fi
  [[ -n "$KILN_ROOT" ]] || return 1
  KILN_STAGE=$(_kiln_get_stage "$KILN_ROOT/.kiln/STATE.md") || return 1
  [[ "$KILN_STAGE" != "complete" ]] || return 1
  return 0
}

_kiln_strip_prefix() {
  # Strips the "kiln:" prefix the engine wraps around agent_type in
  # some payloads. Inline form `${name#kiln:}` is equivalent and
  # slightly cheaper (no subshell) — this helper exists for callers
  # that want the operation to be self-documenting at the call site.
  echo "${1#kiln:}"
}
