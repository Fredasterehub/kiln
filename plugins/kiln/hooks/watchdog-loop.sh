#!/bin/bash
# watchdog-loop.sh — Detached loop body for the Kiln deadlock watchdog
#
# Spawned by spawn-watchdog.sh via `nohup + disown` and runs as a
# background process for the lifetime of a Kiln pipeline. Every 60s it
# delegates the actual detection + side effects to deadlock-check.sh
# and breaks out only when deadlock-check signals escalation complete
# (exit 1) — at which point the watchdog voluntarily exits so the
# orphaned loop doesn't keep polling a pipeline that already handed
# off to .kiln/DEADLOCK.flag recovery.
#
# Output is fully silent: spawn-watchdog.sh redirects both streams to
# /dev/null so any stray stdout/stderr here is dropped. Keeping the
# loop body tiny (just sleep + bash + break) makes the script easy to
# reason about and matches the spike's reference implementation.
#
# KILN_ROOT is exported by spawn-watchdog.sh so the loop can avoid a
# second _find_root walk from an unknown CWD. If the env is missing
# (e.g. the script is invoked directly for testing), fall back to
# _find_root; if that also fails, exit cleanly rather than running a
# watchdog with no anchor.
#
# No `set -e` — a transient deadlock-check failure (jq glitch, temp
# fs hiccup, exec error) must not kill the watchdog. Only the explicit
# escalation exit code (1 — "three nudges failed, .kiln/DEADLOCK.flag
# written") stops the loop. Any other non-zero (OS error, signal, jq
# crash) is treated as transient and the loop continues.

_find_root() {
  local d="$PWD"
  while [[ "$d" != "/" ]]; do
    [[ -d "$d/.kiln" ]] && echo "$d" && return 0
    d=$(dirname "$d")
  done
  return 1
}

[[ -n "$KILN_ROOT" ]] || KILN_ROOT=$(_find_root)
[[ -n "$KILN_ROOT" ]] || exit 0
export KILN_ROOT

HOOK_DIR=$(realpath "$(dirname "$0")" 2>/dev/null || (cd "$(dirname "$0")" && pwd))
CHECK="$HOOK_DIR/deadlock-check.sh"
[[ -f "$CHECK" ]] || exit 0

while true; do
  sleep 60
  bash "$CHECK"
  RC=$?
  [[ "$RC" -eq 1 ]] && break
done

exit 0
