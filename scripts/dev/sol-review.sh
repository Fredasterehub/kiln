#!/usr/bin/env bash
# sol-review.sh — the trusted codex bridge for Kiln dev reviews (dev-protocol piece 3).
# No agent couriers: launch, wait, capture — one process, files as truth.
#
# Usage: sol-review.sh <promptfile> <outprefix>
#          [--schema <schema.json>] [--effort low|medium|high|xhigh] [--resume <thread_id>]
#          [--ephemeral] [--sandbox read-only|workspace-write|danger-full-access]
#          [--web] [--wallclock <seconds>] [--model <id>]
#
# Artifacts: <outprefix>.verdict (final message — THE authoritative channel, codex -o),
#            <outprefix>.events.jsonl (--json stream: thread_id, usage, turn outcome),
#            <outprefix>.stderr.log (progress; never parsed for verdicts).
# Outcome contract (receipts: .kiln-dev/v302/probes/probe-receipts.log, live on codex-cli 0.144.1):
#   exit 0 + verdict non-empty  → VERDICT (parse the file; schema-conforming when --schema given)
#   exit 0 + verdict empty      → SUPPRESSED (model finished, message withheld — resend/resume)
#   exit 1 / verdict absent     → FAILED_TURN (inspect turn.failed in events)
#   exit 124 wrapper timeout    → WALLCLOCK_TIMEOUT (codex has NO wall-clock config of its own)
# Notes from receipts: --ignore-user-config skips config.toml ONLY (hooks.json still parsed — the
# stream may carry item-level type:"error" entries; tolerate them, gate on turn.* events only).
# `exec resume` accepts -m/-c/-o/--json but NOT -s/--sandbox/-C (parse exit 2) — sandbox rides
# round-1 only. Sol-family efforts: low|medium|high|xhigh ("minimal" 400s; "ultra" never existed).
set -u
PROMPT=${1:?usage: sol-review.sh <promptfile> <outprefix> [flags]}; OUT=${2:?outprefix required}; shift 2
EFFORT=high; SCHEMA=""; RESUME=""; EPHEMERAL=0; SANDBOX=read-only; WEB=0; WALL=1800
MODEL=gpt-5.6-sol; FALLBACK=gpt-5.5
while [ $# -gt 0 ]; do case $1 in
  --schema) SCHEMA=$2; shift 2 ;;
  --effort) EFFORT=$2; shift 2 ;;
  --resume) RESUME=$2; shift 2 ;;
  --ephemeral) EPHEMERAL=1; shift ;;
  --sandbox) SANDBOX=$2; shift 2 ;;
  --web) WEB=1; shift ;;
  --wallclock) WALL=$2; shift 2 ;;
  --model) MODEL=$2; shift 2 ;;
  *) echo "sol-review.sh: unknown arg: $1" >&2; exit 2 ;;
esac; done

codex login status >/dev/null 2>&1 || { echo "STATUS:AUTH_MISSING"; exit 3; }

run_codex() { # $1 = model ('' when resuming)
  local args=(-c "model_reasoning_effort=\"$EFFORT\"" --ignore-user-config --skip-git-repo-check --json -o "$OUT.verdict")
  [ -n "$SCHEMA" ] && args+=(--output-schema "$SCHEMA")
  [ "$EPHEMERAL" = 1 ] && args+=(--ephemeral)
  [ "$WEB" = 1 ] && args+=(-c 'tools.web_search=true')
  rm -f "$OUT.verdict"
  if [ -n "$RESUME" ]; then
    timeout "$WALL" codex exec resume "$RESUME" "${args[@]}" - < "$PROMPT" > "$OUT.events.jsonl" 2> "$OUT.stderr.log"
  else
    timeout "$WALL" codex exec -m "$1" --sandbox "$SANDBOX" "${args[@]}" - < "$PROMPT" > "$OUT.events.jsonl" 2> "$OUT.stderr.log"
  fi
}

run_codex "$MODEL"; EXIT=$?
# One fallback rung on a failed turn (never on timeout/suppression), fresh sessions only.
if [ $EXIT -ne 0 ] && [ $EXIT -ne 124 ] && [ -z "$RESUME" ] && grep -q 'model' "$OUT.stderr.log" 2>/dev/null && [ "$MODEL" != "$FALLBACK" ]; then
  run_codex "$FALLBACK"; EXIT=$?; MODEL=$FALLBACK
fi

THREAD=$(grep -m1 '"type":"thread.started"' "$OUT.events.jsonl" 2>/dev/null | sed 's/.*"thread_id":"\([^"]*\)".*/\1/')
USAGE=$(grep -m1 '"type":"turn.completed"' "$OUT.events.jsonl" 2>/dev/null | grep -o '"usage":{[^}]*}' || true)
if   [ $EXIT -eq 0 ] && [ -s "$OUT.verdict" ]; then STATUS=VERDICT
elif [ $EXIT -eq 0 ];                          then STATUS=SUPPRESSED
elif [ $EXIT -eq 124 ];                        then STATUS=WALLCLOCK_TIMEOUT
else                                                STATUS=FAILED_TURN
fi
echo "STATUS:$STATUS MODEL:$MODEL THREAD:${THREAD:-none} EXIT:$EXIT ${USAGE:-} VERDICT_FILE:$OUT.verdict"
[ "$STATUS" = VERDICT ]
