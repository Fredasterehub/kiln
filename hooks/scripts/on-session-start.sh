#!/bin/sh
# kiln on-session-start hook
# Rehydrates state from .kiln/STATE.md for session continuity

if [ ! -d ".kiln" ]; then
  echo "Kiln not initialized. Run /kiln:init to get started."
  exit 0
fi

state_file=".kiln/STATE.md"
if [ ! -f "$state_file" ]; then
  echo "Kiln state missing. Run /kiln:init to reinitialize."
  exit 0
fi

get_field() {
  sed -n "s/^- \\*\\*$1:\\*\\* *//p" "$state_file" | head -n 1
}

phase_line=$(get_field "Phase")
current_phase=$(printf '%s\n' "$phase_line" | sed -n 's/^\([0-9][0-9]*\).*/\1/p')
current_step=$(get_field "Current Step")
step_status=$(get_field "Step Status")
step_started=$(get_field "Started")
last_activity=$(get_field "Last Activity")
next_expected=$(get_field "Next Expected Action")
mini_retries=$(get_field "Mini-verify retries (current task)")
e2e_cycles=$(get_field "E2E correction cycles (current track)")
review_cycles=$(get_field "Code review correction cycles (current track)")

total_phases=$(awk -F'|' '/^\|[[:space:]]*[0-9]+[[:space:]]*\|/ {n++} END {print n+0}' "$state_file")
complete_phases=$(awk -F'|' '/^\|[[:space:]]*[0-9]+[[:space:]]*\|/ {s=$4; gsub(/\*/,"",s); gsub(/^[[:space:]]+|[[:space:]]+$/,"",s); s=tolower(s); if (s=="complete" || s=="done") c++} END {print c+0}' "$state_file")

malformed=0
[ -z "$current_step" ] && malformed=1
[ -z "$step_status" ] && malformed=1

step_status_lc=$(printf '%s\n' "$step_status" | tr '[:upper:]' '[:lower:]' | tr -d '*')
case "$step_status_lc" in
  failed|halted) overall_status="halted" ;;
  complete)
    if [ "$total_phases" -gt 0 ] && [ "$complete_phases" -eq "$total_phases" ]; then
      overall_status="complete"
    else
      overall_status="in-progress"
    fi
    ;;
  *) overall_status="in-progress" ;;
esac

interrupted=0
if [ "$step_status_lc" = "in-progress" ]; then
  now_epoch=$(date +%s 2>/dev/null)
  ts="${last_activity:-$step_started}"
  ts_epoch=$(date -d "$ts" +%s 2>/dev/null)
  if [ -z "$ts_epoch" ]; then
    ts_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null)
  fi
  case "$now_epoch:$ts_epoch" in
    :*|*:) ;;
    *[!0-9:]* ) ;;
    *)
      if [ $((now_epoch - ts_epoch)) -gt 1800 ]; then
        interrupted=1
      fi
      ;;
  esac
fi

echo "[kiln] Session state rehydrated"
if [ -n "$current_phase" ] && [ "$total_phases" -gt 0 ]; then
  echo "Project: phase $current_phase of $total_phases"
else
  echo "Project: phase unknown"
fi
echo "Current step: ${current_step:-unknown}"
echo "Status: $overall_status"
if [ "$interrupted" -eq 1 ]; then
  echo "Warning: Previous session was interrupted during phase ${current_phase:-unknown} at ${current_step:-unknown} step."
  echo "Run /kiln:track to resume from the current step."
fi

# First-run hint: show bypass-permissions tip on fresh installs
first_run=0
if [ "$next_expected" = "Run /kiln:fire" ] && [ "$step_status_lc" = "pending" ]; then
  first_run=1
fi
if [ -n "$mini_retries$e2e_cycles$review_cycles" ]; then
  echo "Correction cycles: mini-verify ${mini_retries:-unknown}; e2e ${e2e_cycles:-unknown}; review ${review_cycles:-unknown}"
fi
case "$overall_status" in
  complete) echo "Next action: Project complete. See .kiln/FINAL_REPORT.md" ;;
  halted) echo "Next action: Project halted at ${current_step:-unknown}. See .kiln/tracks/phase-${current_phase:-N}/ for details. Operator action needed." ;;
  *)
    if [ -n "$next_expected" ]; then
      echo "Next action: $next_expected"
    else
      echo "Next action: Resume with /kiln:track"
    fi
    if [ "$first_run" -eq 1 ]; then
      echo ""
      echo "Tip: For the best experience, run Claude Code with:"
      echo "  claude --dangerously-bypass-permissions"
    fi
    ;;
esac

if [ "$malformed" -eq 1 ]; then
  echo "Warning: STATE.md may be corrupted. Check .kiln/STATE.md manually."
fi

exit 0
