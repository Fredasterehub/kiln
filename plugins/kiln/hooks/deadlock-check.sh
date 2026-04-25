#!/bin/bash
# deadlock-check.sh — Detection rule + side effects for the watchdog loop
#
# Called every 60s by watchdog-loop.sh. Reads .kiln/tmp/activity.json,
# applies the 3-part deadlock rule (§5.3 P2), and either nudges the
# engine or escalates to .kiln/DEADLOCK.flag after three failed
# nudges. On escalation the script returns 1 so the caller breaks its
# loop — watchdog-loop.sh treats exit 1 as "stop" and exit 0 as
# "continue".
#
# Deadlock rule (all three required):
#   now - last_activity_ts  > 300  (5 min idle)
#   AND now - last_nudge_ts     > 600  (10 min debounce so three-nudge
#                                       escalation isn't a 3-minute burst)
#   AND pipeline_phase NOT IN { idle, awaiting_user, complete }
#
# We used to require empty active_teammates as a 4th condition, but
# that conflated dormant-waiting-for-message with exited and produced
# false-positives once A.1 kept dormant teammates in active_teammates
# — idle > 300s + phase filter is now the load-bearing signal.
#
# Fail-open posture: missing activity.json, missing STATE.md, stage
# complete, or any jq parse failure all route to exit 0. The watchdog
# exists to catch silent stalls — it must never manufacture one, and
# a transient file-read glitch must not trigger a false nudge.
#
# activity.json mutations go through the same flock + write-temp-then-
# rename pattern as activity-update.sh so a concurrent hook fire
# during the same tick can't lose the nudge_count / last_nudge_ts
# update. The entire side-effect section (stale-epoch re-check +
# pending-nudge / flag write + counter bump) runs inside a single
# flock critical section so no activity-update fire can slip between
# our validation and our write. Counter bumps are inlined, not
# delegated to a helper that opens its own lock — nesting flocks on
# the same FD in the same process deadlocks.
#
# Counter bumps and the exit-1 stop signal are gated on durable write
# success: a failed pending-nudge write does NOT burn a nudge slot,
# and a failed DEADLOCK.flag write does NOT stop the watchdog
# (without the flag there's no durable escalation record for
# SessionStart recovery, so we keep the watchdog alive to retry next
# tick).

. "$(dirname "$0")/_kiln-lib.sh"

# _kiln_pipeline_active honours a pre-set KILN_ROOT in env, which the
# detached watchdog-loop propagates to skip a second _kiln_find_root
# walk from an unknown CWD. Falls back to walking if the env is empty
# (direct invocation, tests).
_kiln_pipeline_active || exit 0
ROOT="$KILN_ROOT"
STATE="$ROOT/.kiln/STATE.md"

TMP_DIR="$ROOT/.kiln/tmp"
ACTIVITY="$TMP_DIR/activity.json"
LOCK="$TMP_DIR/activity.lock"
PENDING="$TMP_DIR/pending-nudge.json"
FLAG="$ROOT/.kiln/DEADLOCK.flag"

[[ -f "$ACTIVITY" ]] || exit 0

NOW=$(date +%s)

# Pull everything we need in a single jq pass so a partially-malformed
# activity.json triggers one fail-open branch instead of several
# inconsistent reads. `// ""` on the timestamp fields produces an
# empty string when the value is missing or null, which preserves
# TSV column alignment (unlike `| numbers`, which drops the field
# entirely when the value isn't a number and left-shifts every
# subsequent column into the wrong shell variable — NUDGE_COUNT
# would land in LAST_TS, PHASE in LAST_NUDGE, etc., and the regex
# guards would then validate the wrong fields). The downstream
# `=~ ^[0-9]+$` check rejects empty strings and exits fail-open —
# same guard behaviour without the column-collapse footgun. `// 0`
# stays on nudge_count, active-teammates count, and epoch because 0
# is the semantically-correct default for those (no nudges yet / no
# teammates tracked / unseeded epoch), not a false-positive trigger
# like the `now - 0 ≈ 50-year idle` problem on timestamps. epoch is
# captured for the stale-read guard that runs after rule evaluation
# but before side effects.
READ=$(jq -r '[
  (.last_activity_ts // ""),
  (.last_nudge_ts // ""),
  (.nudge_count // 0),
  (.pipeline_phase // ""),
  ((.active_teammates // {}) | length),
  (.last_activity_source // "unknown"),
  (.epoch // 0)
] | @tsv' "$ACTIVITY" 2>/dev/null) || exit 0
[[ -n "$READ" ]] || exit 0

IFS=$'\t' read -r LAST_TS LAST_NUDGE NUDGE_COUNT PHASE ACTIVE_COUNT LAST_SRC INITIAL_EPOCH <<< "$READ"

[[ "$LAST_TS" =~ ^[0-9]+$ ]] || exit 0
[[ "$LAST_NUDGE" =~ ^[0-9]+$ ]] || exit 0
[[ "$NUDGE_COUNT" =~ ^[0-9]+$ ]] || exit 0
[[ "$ACTIVE_COUNT" =~ ^[0-9]+$ ]] || exit 0
[[ "$INITIAL_EPOCH" =~ ^[0-9]+$ ]] || exit 0

IDLE_SEC=$(( NOW - LAST_TS ))
SINCE_NUDGE=$(( NOW - LAST_NUDGE ))

# Phase exclusion list: stages where silence is expected (idle =
# pipeline not yet started; awaiting_user = paused on input;
# complete = finished). Any other stage means real work should be
# happening and a 5-min silence is a stall.
case "$PHASE" in
  idle|awaiting_user|complete) exit 0 ;;
esac

[[ "$IDLE_SEC" -gt 300 ]] || exit 0
[[ "$SINCE_NUDGE" -gt 600 ]] || exit 0

NUDGE_N=$(( NUDGE_COUNT + 1 ))

# Everything below runs under the activity.lock. The outer conditions
# were evaluated against an unlocked snapshot; a concurrent
# activity-update fire between snapshot and now would have bumped
# `epoch`. Re-reading epoch INSIDE the lock is the definitive race
# guard — any update that slips between our snapshot and this point
# will have completed its own locked write, so the epoch we see here
# is either our original (safe to proceed) or a new value (abort).
#
# Counter bumps are inlined here rather than calling a helper that
# opens its own flock — nesting flocks on the same FD from the same
# process deadlocks.
#
# Counter bumps and the exit-1 that stops the watchdog are BOTH gated
# on the durable write succeeding. If pending-nudge.json fails to
# write, nudge_count must NOT increment (we haven't actually
# delivered a nudge — incrementing would waste a slot). If
# DEADLOCK.flag fails to write, the watchdog must keep running and
# retry next tick, because exiting without the flag leaves no durable
# escalation record for SessionStart recovery to pick up. STATE.md
# appends are best-effort but use read-modify-write + rename so a
# reader (or a concurrent writer) never sees a torn file — a
# disk-full on the log still doesn't invalidate the nudge or flag.
(
  flock -x 9

  CURRENT_EPOCH=$(jq -r '.epoch // 0' "$ACTIVITY" 2>/dev/null)
  [[ "$CURRENT_EPOCH" =~ ^[0-9]+$ ]] || exit 0
  [[ "$CURRENT_EPOCH" == "$INITIAL_EPOCH" ]] || exit 0

  ACTIVE_LIST=$(jq -r '(.active_teammates // {}) | keys | if length == 0 then "none" else join(", ") end' "$ACTIVITY" 2>/dev/null || echo "unknown")

  # Advancing epoch alongside the counter update closes the remaining
  # duplicate-nudge window: a subsequent deadlock-check invocation
  # (concurrent race after we release the lock, or the next loop tick
  # if no hook has touched activity.json in between) would otherwise
  # see the original epoch, pass the CURRENT_EPOCH == INITIAL_EPOCH
  # guard, and emit a second Nudge #N with the same number. Bumping
  # epoch here makes the guard definitive.
  #
  # Read is gated: a failed cat must NOT fall back to `{}` because
  # that would build a minimal object containing only our three new
  # fields and then mv it over a real activity.json — destroying
  # active_teammates, pipeline_phase, last_activity_source, and
  # every other field maintained by activity-update.sh. On any read
  # or write failure `_bump` returns 1; the caller records no
  # acknowledgment, epoch stays stale, and the next tick re-evaluates
  # against the unchanged snapshot. A duplicate nudge on the retry is
  # an acceptable worst case — strictly better than losing the state
  # file or stalling the watchdog.
  _bump() {
    local TMP="$ACTIVITY.$$.tmp"
    local EXISTING
    EXISTING=$(cat "$ACTIVITY" 2>/dev/null) || return 1
    [[ -n "$EXISTING" ]] || return 1
    echo "$EXISTING" | jq --arg n "$NUDGE_N" --arg ts "$NOW" \
      '(.nudge_count = ($n | tonumber))
       | (.last_nudge_ts = ($ts | tonumber))
       | (.epoch = ((.epoch // 0) + 1))' \
      > "$TMP" 2>/dev/null \
      && mv "$TMP" "$ACTIVITY" \
      || { rm -f "$TMP"; return 1; }
  }

  # Threshold: NUDGE_N -le 3 delivers nudges 1, 2, 3 — escalation
  # fires at NUDGE_N=4 (i.e. nudge_count was already 3, meaning all
  # three permitted nudges have been delivered). Earlier revisions
  # escalated at NUDGE_N=3 which cut the engine one nudge short of
  # the spec's "3 failed nudges → escalate" rule.
  if [[ "$NUDGE_N" -le 3 ]]; then
    MSG="KILN DEADLOCK WATCHDOG: idle_seconds=${IDLE_SEC}; last_activity_source=${LAST_SRC}; active_teammates=${ACTIVE_LIST}. Nudge #${NUDGE_N}. Action steps: Check inbox first. If empty and you expect a reply, check disk archives: .kiln/archive/milestone-{N}/chunk-{M}/review.md and .kiln/tmp/review.md. If still nothing, SendMessage to the teammate who owes a reply, or advance the pipeline stage."
    PENDING_TMP="$PENDING.$$.tmp"
    NUDGE_WRITTEN=0
    jq -n --arg ac "$MSG" --arg ts "$NOW" --arg n "$NUDGE_N" \
      '{additionalContext: $ac, timestamp: ($ts | tonumber), nudge_n: ($n | tonumber)}' \
      > "$PENDING_TMP" 2>/dev/null \
      && mv "$PENDING_TMP" "$PENDING" \
      && NUDGE_WRITTEN=1 \
      || rm -f "$PENDING_TMP"

    # Atomic append to STATE.md via read-modify-write + rename. `>>`
    # is per-write atomic for small buffers on local filesystems but
    # offers no guarantee once another writer (operator edit,
    # parallel hook) is in the picture — temp+rename gives readers a
    # consistent snapshot and closes the interleave window without
    # needing a STATE.md-specific lock.
    #
    # The read is gated: if `cat "$STATE"` fails (transient
    # permissions, race, disk error) we skip the append entirely
    # rather than write a temp file containing only the new warning
    # and mv'ing it over the good original — that would be the
    # opposite of best-effort (it would destroy the pipeline log to
    # add a single line to it). Skipping is the correct posture; the
    # nudge itself was still delivered via pending-nudge.json.
    STATE_TMP="$STATE.$$.tmp"
    if EXISTING_STATE=$(cat "$STATE" 2>/dev/null); then
      {
        echo "$EXISTING_STATE"
        echo ""
        echo "> [!WARNING] KILN DEADLOCK — idle_seconds=${IDLE_SEC}; last_activity_source=${LAST_SRC}; active_teammates=${ACTIVE_LIST}. Nudge #${NUDGE_N}. Action steps: Check inbox first. If empty and you expect a reply, check disk archives: .kiln/archive/milestone-{N}/chunk-{M}/review.md and .kiln/tmp/review.md. If still nothing, SendMessage to the teammate who owes a reply, or advance the pipeline stage."
      } > "$STATE_TMP" 2>/dev/null \
        && mv "$STATE_TMP" "$STATE" \
        || rm -f "$STATE_TMP"
    else
      rm -f "$STATE_TMP" 2>/dev/null
    fi

    # Best-effort acknowledgment: if _bump fails, epoch stays at
    # INITIAL_EPOCH and the next tick re-evaluates. A duplicate nudge
    # is an acceptable fallback versus leaving the state file
    # destroyed or the watchdog stalled.
    if [[ "$NUDGE_WRITTEN" -eq 1 ]]; then
      _bump
    fi
    exit 0
  fi

  # Escalation path — all three permitted nudges have been delivered
  # without recovery (nudge_count was 3 on entry, NUDGE_N=4). Write
  # DEADLOCK.flag (persists across sessions so the next SessionStart
  # can run recovery), append a final escalation block, bump
  # counters, and signal stop via exit 1 — all three gated on the
  # flag landing durably so a failed write keeps the watchdog alive
  # to retry next tick.
  FLAG_TMP="$FLAG.$$.tmp"
  FLAG_WRITTEN=0
  jq -n --arg ts "$NOW" --arg n "$NUDGE_N" --arg src "$LAST_SRC" \
    '{timestamp: ($ts | tonumber), nudge_count: ($n | tonumber), last_activity_source: $src}' \
    > "$FLAG_TMP" 2>/dev/null \
    && mv "$FLAG_TMP" "$FLAG" \
    && FLAG_WRITTEN=1 \
    || rm -f "$FLAG_TMP"

  STATE_TMP="$STATE.$$.tmp"
  if EXISTING_STATE=$(cat "$STATE" 2>/dev/null); then
    {
      echo "$EXISTING_STATE"
      echo ""
      echo "> [!CAUTION] KILN DEADLOCK ESCALATION — 3 nudges delivered without recovery. Writing .kiln/DEADLOCK.flag. Watchdog exiting. Operator intervention or SessionStart recovery required."
    } > "$STATE_TMP" 2>/dev/null \
      && mv "$STATE_TMP" "$STATE" \
      || rm -f "$STATE_TMP"
  else
    rm -f "$STATE_TMP" 2>/dev/null
  fi

  # Same best-effort posture as the nudge path — _bump failure after
  # a successful flag write leaves epoch stale but the durable flag
  # is what SessionStart recovery depends on, and exit 1 still fires
  # as long as the flag landed. The next tick (if the watchdog keeps
  # running past the exit decision) would re-evaluate cleanly.
  if [[ "$FLAG_WRITTEN" -eq 1 ]]; then
    _bump
    exit 1
  fi
  exit 0
) 9>"$LOCK"

# Propagate the subshell's exit code so watchdog-loop.sh sees exit 1
# when (and only when) escalation completed with a durable flag.
exit $?
