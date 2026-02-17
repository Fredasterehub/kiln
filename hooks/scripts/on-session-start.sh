#!/bin/sh
# kiln on-session-start hook
# Rehydrates state from .kiln/state.json (canonical) or .kiln/STATE.md (fallback)

if [ ! -d ".kiln" ]; then
  echo "Kiln not initialized. Run /kiln:init to get started."
  exit 0
fi

state_json=".kiln/state.json"
state_md=".kiln/STATE.md"

if [ ! -f "$state_json" ] && [ ! -f "$state_md" ]; then
  echo "Kiln state missing. Run /kiln:init to reinitialize."
  exit 0
fi

if [ -f "$state_json" ] && command -v node >/dev/null 2>&1; then
  # Read from machine-readable state.json
  eval "$(node -e "
    try {
      const s = JSON.parse(require('fs').readFileSync('$state_json', 'utf8'));
      const lines = [
        'current_phase=' + JSON.stringify(String(s.currentPhase || '')),
        'total_phases=' + JSON.stringify(String(s.totalPhases || 0)),
        'complete_phases=' + JSON.stringify(String(s.completePhases || 0)),
        'current_step=' + JSON.stringify(s.currentStep || ''),
        'step_status=' + JSON.stringify(s.stepStatus || ''),
        'last_activity=' + JSON.stringify(s.lastActivity || ''),
        'next_expected=' + JSON.stringify(s.nextExpectedAction || ''),
        'mini_retries=' + JSON.stringify(String(s.miniVerifyRetries || '')),
        'e2e_cycles=' + JSON.stringify(String(s.e2eCycles || '')),
        'review_cycles=' + JSON.stringify(String(s.reviewCycles || ''))
      ];
      process.stdout.write(lines.join('\n'));
    } catch (e) { process.stdout.write('state_parse_error=1'); }
  " 2>/dev/null)"
  malformed=0
  [ -z "$current_step" ] && malformed=1
  [ -z "$step_status" ] && malformed=1
else
  # Fallback: parse STATE.md with sed (legacy path)
  if [ ! -f "$state_md" ]; then
    echo "Kiln state missing. Run /kiln:init to reinitialize."
    exit 0
  fi

  get_field() {
    sed -n "s/^- \\*\\*$1:\\*\\* *//p" "$state_md" | head -n 1
  }

  phase_line=$(get_field "Phase")
  current_phase=$(printf '%s\n' "$phase_line" | sed -n 's/^\([0-9][0-9]*\).*/\1/p')
  current_step=$(get_field "Current Step")
  step_status=$(get_field "Step Status")
  last_activity=$(get_field "Last Activity")
  next_expected=$(get_field "Next Expected Action")
  mini_retries=$(get_field "Mini-verify retries (current task)")
  e2e_cycles=$(get_field "E2E correction cycles (current track)")
  review_cycles=$(get_field "Code review correction cycles (current track)")
  total_phases=$(awk -F'|' '/^\|[[:space:]]*[0-9]+[[:space:]]*\|/ {n++} END {print n+0}' "$state_md")
  complete_phases=$(awk -F'|' '/^\|[[:space:]]*[0-9]+[[:space:]]*\|/ {s=$4; gsub(/\*/,"",s); gsub(/^[[:space:]]+|[[:space:]]+$/,"",s); s=tolower(s); if (s=="complete" || s=="done") c++} END {print c+0}' "$state_md")
  malformed=0
  [ -z "$current_step" ] && malformed=1
  [ -z "$step_status" ] && malformed=1
fi

step_status_lc=$(printf '%s\n' "$step_status" | tr '[:upper:]' '[:lower:]' | tr -d '*')
case "$step_status_lc" in
  failed|halted) overall_status="halted" ;;
  complete)
    if [ "${total_phases:-0}" -gt 0 ] && [ "${complete_phases:-0}" -eq "${total_phases:-0}" ]; then
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
  ts="${last_activity:-}"
  if [ -n "$ts" ] && command -v node >/dev/null 2>&1; then
    ts_epoch=$(node -e "try{process.stdout.write(String(Math.floor(new Date('$ts').getTime()/1000)))}catch(e){process.stdout.write('0')}" 2>/dev/null || echo 0)
  else
    ts_epoch=$(date -d "$ts" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null || echo 0)
  fi
  if [ -n "$now_epoch" ] && [ -n "$ts_epoch" ] && [ "$ts_epoch" -gt 0 ] 2>/dev/null; then
    elapsed=$((now_epoch - ts_epoch))
    [ "$elapsed" -gt 1800 ] && interrupted=1
  fi
fi

echo "[kiln] Session state rehydrated"
if [ -n "$current_phase" ] && [ "${total_phases:-0}" -gt 0 ]; then
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
    first_run=0
    [ "$next_expected" = "Run /kiln:fire" ] && [ "$step_status_lc" = "pending" ] && first_run=1
    if [ "$first_run" -eq 1 ]; then
      echo ""
      echo "Tip: For the best experience, run Claude Code with:"
      echo "  claude --dangerously-skip-permissions"
    fi
    ;;
esac

if [ "$malformed" -eq 1 ]; then
  echo "Warning: State may be corrupted. Check .kiln/state.json or .kiln/STATE.md manually."
fi

exit 0
