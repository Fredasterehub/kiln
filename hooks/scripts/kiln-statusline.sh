#!/bin/sh
# kiln status line — Claude Code statusLine hook
# Reads stdin JSON from Claude Code, displays context usage + kiln state + lore quote.
# POSIX sh. Requires: jq

# ── helpers (inlined from barista/utils) ─────────────────────────────────────

progress_bar() {
  _pct=$1
  _w=${2:-10}
  _filled_c="${3:-█}"
  _empty_c="${4:-░}"

  if [ "$_pct" -lt 0 ] 2>/dev/null; then _pct=0; fi
  if [ "$_pct" -gt 100 ] 2>/dev/null; then _pct=100; fi

  _filled=$((_pct * _w / 100))
  _empty=$((_w - _filled))
  _bar=""
  _i=0
  while [ $_i -lt $_filled ]; do _bar="${_bar}${_filled_c}"; _i=$((_i + 1)); done
  _i=0
  while [ $_i -lt $_empty ]; do _bar="${_bar}${_empty_c}"; _i=$((_i + 1)); done
  printf '%s' "$_bar"
}

format_number() {
  _n=$1
  if [ "$_n" -ge 1000000 ] 2>/dev/null; then
    printf '%dM' "$((_n / 1000000))"
  elif [ "$_n" -ge 1000 ] 2>/dev/null; then
    printf '%dk' "$((_n / 1000))"
  else
    printf '%d' "$_n"
  fi
}

# ── ANSI color codes ──────────────────────────────────────────────────────────
# Brand: 38;5;173  Quote: 38;5;222  Divider: 38;5;179
C_RESET='\033[0m'
C_GREEN='\033[32m'
C_YELLOW='\033[33m'
C_ORANGE='\033[38;5;208m'
C_BRAND='\033[38;5;173m'
C_QUOTE='\033[38;5;222m'
C_DIM='\033[2m'
# Blinking red (used at 80%+)
C_BLINK_RED='\033[5;31m'

# ── Read stdin JSON ───────────────────────────────────────────────────────────
input=$(cat)

model=$(printf '%s' "$input" | jq -r '.model.display_name // ""' 2>/dev/null)
ctx_size=$(printf '%s' "$input" | jq -r '.context_window.context_window_size // 0' 2>/dev/null)
usage=$(printf '%s' "$input" | jq -r '.context_window.current_usage // empty' 2>/dev/null)

# ── Context bar ───────────────────────────────────────────────────────────────
ctx_line=""
if [ -n "$usage" ] && [ "${ctx_size:-0}" -gt 0 ] 2>/dev/null; then
  in_tok=$(printf '%s' "$input" | jq -r '.context_window.current_usage.input_tokens // 0' 2>/dev/null)
  cc_tok=$(printf '%s' "$input" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0' 2>/dev/null)
  cr_tok=$(printf '%s' "$input" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0' 2>/dev/null)
  out_tok=$(printf '%s' "$input" | jq -r '.context_window.current_usage.output_tokens // 0' 2>/dev/null)

  current_tokens=$((in_tok + cc_tok + cr_tok + out_tok))
  ctx_pct=$((current_tokens * 100 / ctx_size))

  # Tokens until 80% compaction threshold
  compact_at=$((ctx_size * 80 / 100))
  until_compact=$((compact_at - current_tokens))
  [ "$until_compact" -lt 0 ] && until_compact=0
  until_fmt=$(format_number "$until_compact")

  bar=$(progress_bar "$ctx_pct" 10)

  if [ "$ctx_pct" -lt 50 ]; then
    ctx_line=$(printf "${C_GREEN}%s %d%%${C_RESET} ${C_DIM}(%s)${C_RESET}" "$bar" "$ctx_pct" "${until_fmt}→⚡")
  elif [ "$ctx_pct" -lt 65 ]; then
    ctx_line=$(printf "${C_YELLOW}%s %d%%${C_RESET} ${C_DIM}(%s)${C_RESET}" "$bar" "$ctx_pct" "${until_fmt}→⚡")
  elif [ "$ctx_pct" -lt 80 ]; then
    ctx_line=$(printf "${C_ORANGE}%s %d%%${C_RESET} ${C_DIM}(%s)${C_RESET}" "$bar" "$ctx_pct" "${until_fmt}→⚡")
  else
    ctx_line=$(printf "${C_BLINK_RED}💀 %s %d%%${C_RESET}" "$bar" "$ctx_pct")
  fi
fi

# ── Kiln state ────────────────────────────────────────────────────────────────
kiln_line=""
if [ -f ".kiln/state.json" ] && command -v jq >/dev/null 2>&1; then
  cur_phase=$(jq -r '.currentPhase // ""' .kiln/state.json 2>/dev/null)
  tot_phases=$(jq -r '.totalPhases // ""' .kiln/state.json 2>/dev/null)
  cur_step=$(jq -r '.currentStep // ""' .kiln/state.json 2>/dev/null)
  # shellcheck disable=SC2034
  step_status=$(jq -r '.stepStatus // ""' .kiln/state.json 2>/dev/null)
  is_paused=$(jq -r '.paused // false' .kiln/state.json 2>/dev/null)
  # shellcheck disable=SC2034
  active_stage=$(jq -r '.activeStage // ""' .kiln/state.json 2>/dev/null)
  team_name=$(jq -r '.teamName // ""' .kiln/state.json 2>/dev/null)

  # Phase indicator: ► phase 2/5 │ execute
  if [ -n "$cur_phase" ] && [ "${tot_phases:-0}" -gt 0 ] 2>/dev/null; then
    if [ "$is_paused" = "true" ]; then
      phase_sym="⏸"
    else
      phase_sym="►"
    fi
    kiln_line=$(printf "${C_BRAND}%s phase %s/%s${C_RESET}" "$phase_sym" "$cur_phase" "$tot_phases")
    [ -n "$cur_step" ] && kiln_line=$(printf '%s │ %s' "$kiln_line" "$cur_step")

    # Worker counts from teamName field (format: "w1 ✓3 ○2" style)
    # activeStage carries the stage label; teamName carries worker summary when set
    if [ -n "$team_name" ]; then
      kiln_line=$(printf '%s │ %s' "$kiln_line" "$team_name")
    fi
  fi
fi

# ── Lore quote ────────────────────────────────────────────────────────────────
quote_line=""
if [ -f ".kiln/last-quote.json" ] && command -v jq >/dev/null 2>&1; then
  quote_text=$(jq -r '.quote // ""' .kiln/last-quote.json 2>/dev/null)
  quote_by=$(jq -r '.by // ""' .kiln/last-quote.json 2>/dev/null)
  if [ -n "$quote_text" ]; then
    # Truncate to fit: allow ~60 chars for quote
    cols=$(tput cols 2>/dev/null || printf '80')
    max_q=$((cols - 20))
    [ "$max_q" -lt 20 ] && max_q=20
    if [ "${#quote_text}" -gt "$max_q" ]; then
      quote_text=$(printf '%s' "$quote_text" | cut -c1-$((max_q - 3)))
      quote_text="${quote_text}..."
    fi
    quote_line=$(printf "${C_QUOTE}\"%s\"${C_RESET} ${C_DIM}-- %s${C_RESET}" "$quote_text" "$quote_by")
  fi
fi

# ── Assemble output ───────────────────────────────────────────────────────────
# Format: [kiln context-bar │ kiln-state │ quote │ model]
# Falls back to just context-bar and model when no .kiln/

parts=""

if [ -n "$ctx_line" ]; then
  parts="$ctx_line"
fi

if [ -n "$kiln_line" ]; then
  if [ -n "$parts" ]; then
    parts=$(printf '%s │ %s' "$parts" "$kiln_line")
  else
    parts="$kiln_line"
  fi
fi

if [ -n "$quote_line" ]; then
  if [ -n "$parts" ]; then
    parts=$(printf '%s │ %s' "$parts" "$quote_line")
  else
    parts="$quote_line"
  fi
fi

# Always append model in dim
if [ -n "$model" ]; then
  dim_model=$(printf "${C_DIM}%s${C_RESET}" "$model")
  if [ -n "$parts" ]; then
    parts=$(printf '%s │ %s' "$parts" "$dim_model")
  else
    parts="$dim_model"
  fi
fi

printf '%s' "$parts"
