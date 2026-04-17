#!/bin/bash
# spawn-watchdog.sh — SessionStart hook for Kiln deadlock watchdog
#
# Spawns a detached bash loop that polls .kiln/tmp/activity.json every
# 60s for pipeline stalls. The loop survives the parent claude process
# via `nohup + disown` — confirmed in the P2 spike (120s continuous
# execution post-parent-exit on Linux). Mac/WSL detached-child survival
# is inferred; the .kiln/DEADLOCK.flag + persisted activity.json
# fallback posture (plan §5.3 P2) handles platforms that kill detached
# children on session exit.
#
# Gated on an active Kiln pipeline so non-Kiln sessions never spawn a
# watchdog. Stale-PID cleanup prevents zombie watchdogs accumulating
# across session-resume boundaries (observed in the P2 spike — a second
# SessionStart with a stale PID file must kill the old loop before
# writing the new PID).
#
# Fail-open everywhere: a missing watchdog-loop.sh, a failed mkdir, a
# write error on the PID file — all route to exit 0 rather than
# failing the session start. The watchdog is a recovery mechanism; its
# own absence must never be the thing that stalls the pipeline.

INPUT=$(cat)

_find_root() {
  local d="$PWD"
  while [[ "$d" != "/" ]]; do
    [[ -d "$d/.kiln" ]] && echo "$d" && return 0
    d=$(dirname "$d")
  done
  return 1
}

ROOT=$(_find_root)
[[ -n "$ROOT" ]] || exit 0

_STATE="$ROOT/.kiln/STATE.md"
[[ -f "$_STATE" ]] || exit 0

_STAGE=$(grep -oP '(?<=\*\*stage\*\*: )\S+' "$_STATE" 2>/dev/null || true)
[[ -n "$_STAGE" ]] || exit 0
[[ "$_STAGE" != "complete" ]] || exit 0

TMP_DIR="$ROOT/.kiln/tmp"
mkdir -p "$TMP_DIR" 2>/dev/null || exit 0
PID_FILE="$TMP_DIR/watchdog.pid"

# Stale-PID cleanup, with a recycled-PID guard. The pid file persists
# across session boundaries (it lives in .kiln/tmp/, not /tmp/), so a
# new SessionStart can inherit a stale PID from a crashed or resumed
# session. `kill -0` confirms the slot is still allocated, but that
# slot could have been rolled over to an unrelated process — verify
# /proc/$PID/cmdline names watchdog-loop before killing. /proc is
# Linux-only; on Mac/WSL/BSD without procfs, skip the kill. A
# surviving stale watchdog exits on its own (pipeline-complete or
# 3-nudge escalation), so a missed kill degrades gracefully. Remove
# the pid file regardless — a dangling pointer to a dead or
# unverifiable PID is worse than no pointer at all.
if [[ -f "$PID_FILE" ]]; then
  STALE_PID=$(cat "$PID_FILE" 2>/dev/null)
  if [[ -n "$STALE_PID" && -r "/proc/$STALE_PID/cmdline" ]]; then
    if grep -q "watchdog-loop" "/proc/$STALE_PID/cmdline" 2>/dev/null; then
      kill "$STALE_PID" 2>/dev/null
    fi
  fi
  rm -f "$PID_FILE" 2>/dev/null
fi

# Resolve watchdog-loop.sh via the hook's own directory so plugin
# relocation (CLAUDE_PLUGIN_ROOT may vary across installs) doesn't
# break the spawn. realpath canonicalises symlinks — important when
# the plugin lives behind a symlinked ~/.claude/plugins entry or a
# marketplace-managed cache path — and falls back to the pure-bash
# `cd + pwd` idiom on systems without it. If the loop script is
# missing (partial deployment), exit silently; the watchdog is absent
# for this session but nothing downstream breaks.
HOOK_DIR=$(realpath "$(dirname "$0")" 2>/dev/null || (cd "$(dirname "$0")" && pwd))
LOOP="$HOOK_DIR/watchdog-loop.sh"
[[ -x "$LOOP" || -f "$LOOP" ]] || exit 0

# Detached spawn. `nohup` decouples from SIGHUP, `&` backgrounds, and
# `disown` removes the job from the shell's job table so the parent
# shell won't wait for it on exit. ROOT is exported so the loop can
# re-derive paths without another _find_root walk from an unknown CWD.
(
  export KILN_ROOT="$ROOT"
  nohup bash "$LOOP" > /dev/null 2>&1 &
  echo "$!" > "$PID_FILE"
  disown
) 2>/dev/null

exit 0
