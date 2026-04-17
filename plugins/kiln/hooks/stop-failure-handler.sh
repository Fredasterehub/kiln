#!/bin/bash
# stop-failure-handler.sh — StopFailure hook for Kiln API-death detection (P3)
#
# Fires instead of Stop when the main-session turn ends due to an API
# error (rate limit, auth failure, billing, server_error, etc.). Routes
# the failure into the P2 nudge pathway so the next session/turn can
# pick up recovery context, and escalates unrecoverable classes
# directly to .kiln/DEADLOCK.flag.
#
# Contract authoritatively pinned by the p3-00 spike against the
# Claude Code binary's Zod schema — see .kiln-dev/simplify-v14/
# p3-spike.md. Key invariants the spike nailed down:
#   - Payload has NO agent_type / agent_id (main-session only — no
#     subagent whitelist needed; StopFailure never fires for subagents).
#   - .error is one of exactly 7 enum values:
#       rate_limit, authentication_failed, billing_error, invalid_request,
#       server_error, max_output_tokens, unknown
#   - .error_details and .last_assistant_message are `string | undefined`
#     — both optional. error_details is diagnostic, provider-dependent,
#     and carried VERBATIM (never parsed, never trimmed — truncation
#     could drop the exact line an operator needs). last_assistant_message
#     is contextual and trimmed to 200 chars purely to bound nudge size.
#   - Platform ignores exit code — fire-and-forget. Script exits 0 always.
#
# Branch policy (decided in p3-00 §Implications #4):
#   rate_limit                                    → nudge only, do NOT
#                                                   bump P2 nudge_count
#                                                   (separate class from
#                                                   deadlock-escalation —
#                                                   stacking would
#                                                   corrupt the 3-nudge
#                                                   rule).
#   authentication_failed | billing_error         → nudge + write
#                                                   DEADLOCK.flag
#                                                   immediately
#                                                   (unrecoverable;
#                                                   reuses P2 escalation
#                                                   sink).
#   server_error | invalid_request |              → nudge only, retryable
#   max_output_tokens                               class; engine retries
#                                                   on next turn and
#                                                   escalates on repeated
#                                                   failure at its own
#                                                   discretion (not
#                                                   tracked here — this
#                                                   handler emits once
#                                                   per fire).
#   unknown | <unexpected>                        → nudge only,
#                                                   unclassified — no
#                                                   retry policy on
#                                                   values the platform
#                                                   itself doesn't
#                                                   categorize. `unknown`
#                                                   is the platform's
#                                                   own "I don't know"
#                                                   enum value and gets
#                                                   the same neutral
#                                                   treatment as a novel
#                                                   enum value we've
#                                                   never seen.
#
# Fail-open throughout: missing jq, malformed payload, write failure —
# every branch exits 0. Blocking a StopFailure is meaningless (exit
# code ignored) and could mask the underlying failure from the engine.

INPUT=$(cat)

# ── Pipeline context gate ────────────────────────────────────
# Same pattern as every Kiln hook. Zero overhead outside active Kiln
# pipelines. StopFailure fires only on main sessions, so a non-Kiln
# claude invocation that hits a rate limit would otherwise trigger
# this handler with no .kiln root — exit silently.
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

STATE="$ROOT/.kiln/STATE.md"
[[ -f "$STATE" ]] || exit 0

STAGE=$(grep -oP '(?<=\*\*stage\*\*: )\S+' "$STATE" 2>/dev/null || true)
[[ -n "$STAGE" ]] || exit 0
[[ "$STAGE" != "complete" ]] || exit 0

# ── Parse payload ────────────────────────────────────────────
# All three reads are optional per schema. jq's `// ""` produces empty
# string when the field is missing OR null, and the downstream code
# treats empty as "no info" rather than branching on undefined-vs-null.
# error_details can contain anything (provider-dependent content per
# spike §"error_details content shape") — log verbatim but never parse.
ERROR=$(echo "$INPUT" | jq -r '.error // ""' 2>/dev/null)

# error_details is carried verbatim to DEADLOCK.flag and the nudge.
# `$(...)` command substitution strips trailing newlines, which would
# silently corrupt a multi-line diagnostic whose last meaningful line
# an operator needs to see. The `printf x` sentinel + `${...%x}` trim
# preserves every byte including trailing newlines — the closest shell
# idiom to "byte-identical capture" without reaching for a tmp file.
# 2>/dev/null is attached to jq alone so the sentinel always runs.
ERROR_DETAILS=$(echo "$INPUT" | jq -r '.error_details // ""' 2>/dev/null; printf x)
ERROR_DETAILS="${ERROR_DETAILS%x}"
# jq's -r mode appends a single trailing newline it didn't have in the
# source (a JSON string "foo" becomes "foo\n" on stdout). Strip exactly
# one trailing newline so `"foo"` round-trips as "foo", while a source
# value of "foo\n" (which jq emits as "foo\n\n") still round-trips as
# "foo\n". Without this strip every captured value would gain a
# phantom newline jq added for pretty-printing, not the platform's.
ERROR_DETAILS="${ERROR_DETAILS%$'\n'}"

LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""' 2>/dev/null; printf x)
LAST_MSG="${LAST_MSG%x}"
LAST_MSG="${LAST_MSG%$'\n'}"

# A StopFailure with no error field is schema-invalid but we fail open
# — treat it as unknown rather than dropping it silently, since the
# engine benefits from knowing the turn died even without a category.
[[ -n "$ERROR" ]] || ERROR="unknown"

# Trim last_assistant_message to 200 chars so a long final turn doesn't
# balloon the nudge additionalContext — the recovery signal value is in
# the first sentence or two, and the full message is still in the
# transcript if the engine needs it.
#
# error_details is NOT trimmed: per the p3-00 spike, content is
# provider-dependent and diagnostic — truncation could drop the line
# that tells the operator which credential or quota failed. Carry it
# verbatim through to both the nudge and the DEADLOCK.flag.
TRIMMED_MSG="${LAST_MSG:0:200}"

# ── Build nudge content ──────────────────────────────────────
# Human-readable framing the engine will read on its next turn via
# additionalContext. Keep the structure consistent across categories so
# downstream prose parsing (if any) stays stable. All ACTION strings
# are deliberately minimal — the handler is a signal emitter, not a
# policy author. The engine reads STATE.md and decides next steps;
# baking retry / pause / escalation policy into the nudge text would
# fight the engine for the same decision.
case "$ERROR" in
  rate_limit)
    CLASS="recoverable"
    ACTION="Rate limit reached. Re-read STATE.md."
    ;;
  authentication_failed|billing_error)
    CLASS="unrecoverable"
    ACTION="Credential or billing error. Re-read STATE.md."
    ;;
  server_error|invalid_request|max_output_tokens)
    CLASS="retryable"
    ACTION="API failure on the last turn. Re-read STATE.md."
    ;;
  unknown|*)
    # `unknown` is the platform's own "I can't categorize this" enum
    # value — it must get the same neutral treatment as a novel value
    # we've never seen. Both cases fall through here intentionally.
    #
    # The default `*` is also defensive against future enum growth:
    # the Zod schema lists 7 values today, but Claude Code versions
    # may add more, and a value we don't recognize is identical to
    # `unknown` in information content — the platform couldn't (or
    # didn't) tell us what went wrong.
    #
    # ACTION is deliberately minimal — just "Read STATE.md." No retry
    # guidance (positive or negative), no framing of what to do next.
    # We have no basis for any policy. The engine reasons from state,
    # not from a policy we guessed.
    CLASS="unclassified"
    ACTION="The turn ended with an unrecognized API error. Read STATE.md."
    ;;
esac

MSG="KILN AGENT-DEATH (StopFailure): the previous turn ended due to an API error. category=${ERROR}."
[[ -n "$ERROR_DETAILS" ]] && MSG="${MSG} details=\"${ERROR_DETAILS}\""
[[ -n "$TRIMMED_MSG" ]] && MSG="${MSG} last_message=\"${TRIMMED_MSG}\""
MSG="${MSG} ${ACTION}"

NOW=$(date +%s)

# ── Unrecoverable classes → DEADLOCK.flag ────────────────────
# authentication_failed and billing_error cannot be self-recovered by
# the engine on the next turn. Writing DEADLOCK.flag reuses the P2
# escalation sink exactly: SessionStart's spawn-watchdog.sh detects the
# flag on the next invocation, appends a [!NOTE] recovery block to
# STATE.md, resets activity.json counters, removes the flag. Same
# recovery pathway as the watchdog's 3-nudge escalation — just entered
# directly rather than via the nudge counter.
#
# Flag lives directly under .kiln/ (not .kiln/tmp/) so it does not
# depend on tmp-dir creation succeeding — a disk-quota or perms issue
# that blocks mkdir of .kiln/tmp/ must NOT swallow an unrecoverable-
# error escalation. The .kiln/ directory itself is guaranteed to exist
# by the _find_root gate that anchored $ROOT. Flag writes are
# attempted BEFORE the nudge stage so an mkdir failure on tmp/ later
# in this script cannot prevent the durable escalation record from
# landing.
case "$ERROR" in
  authentication_failed|billing_error)
    FLAG="$ROOT/.kiln/DEADLOCK.flag"
    if [[ ! -f "$FLAG" ]]; then
      FLAG_TMP="$FLAG.$$.tmp"
      jq -n --arg ts "$NOW" --arg err "$ERROR" --arg det "$ERROR_DETAILS" \
        '{timestamp: ($ts | tonumber), source: "stop_failure", error: $err, error_details: $det}' \
        > "$FLAG_TMP" 2>/dev/null \
        && mv "$FLAG_TMP" "$FLAG" \
        || rm -f "$FLAG_TMP" 2>/dev/null
    fi
    ;;
esac

# ── Stage pending-nudge.json ─────────────────────────────────
# Reuses the P2 pending-nudge.json path so nudge-inject.sh on the next
# PreToolUse / UserPromptSubmit emits our additionalContext without
# modification. Atomic claim via `ln` — hard-link creation fails if
# the destination already exists (atomic ENOENT/EEXIST at the syscall
# level, no TOCTOU window). A non-atomic `[[ ! -f ]]` + `mv` would let
# two concurrent hook fires both see the file missing and race to
# clobber each other. The existing-nudge-preservation guarantee
# matters — the watchdog or an earlier StopFailure may have staged a
# nudge waiting to be consumed, and overwriting it would erase a
# recovery signal.
#
# mkdir is gated here because tmp-dir creation failure MUST NOT block
# the unrecoverable flag write above. If mkdir fails we silently skip
# the nudge stage — the flag alone is sufficient for SessionStart
# recovery on unrecoverable classes, and recoverable classes simply
# lose their one-shot nudge for this fire (engine retries on the next
# turn regardless).
TMP_DIR="$ROOT/.kiln/tmp"
mkdir -p "$TMP_DIR" 2>/dev/null || exit 0
PENDING="$TMP_DIR/pending-nudge.json"
PENDING_TMP="$PENDING.$$.tmp"

# nudge_n=0 marks this as a StopFailure-originated nudge rather than
# a watchdog nudge (which uses 1..3). deadlock-check.sh and the
# nudge-inject consumer both treat nudge_n as informational for the
# engine, so any unambiguous sentinel works — 0 is the obvious
# "didn't come from the 3-nudge escalation counter" value.
#
# The `{ ... } 2>/dev/null` wrapping covers both jq's own stderr AND
# the shell-level redirection error that would otherwise leak if
# $PENDING_TMP can't be opened for write (e.g. tmp-dir got chmodded
# after mkdir -p succeeded — exotic but possible). Fail-open requires
# silence: the platform ignores exit codes on StopFailure, and we
# should not spam stderr with filesystem-error noise when the script
# is explicitly designed to tolerate that failure.
if { jq -n --arg ac "$MSG" --arg ts "$NOW" \
       '{additionalContext: $ac, timestamp: ($ts | tonumber), nudge_n: 0}' \
       > "$PENDING_TMP"; } 2>/dev/null; then
  # `ln` creates a hard link at $PENDING pointing to the same inode
  # as $PENDING_TMP. If $PENDING already exists the call fails with
  # EEXIST — atomically, no race — and the staged tmp file is
  # discarded. If $PENDING does not exist, the link creation wins
  # and we clean up the tmp path (both names now point to the same
  # inode; removing one name doesn't affect the content under the
  # other).
  ln "$PENDING_TMP" "$PENDING" 2>/dev/null
  rm -f "$PENDING_TMP" 2>/dev/null
else
  rm -f "$PENDING_TMP" 2>/dev/null
fi

exit 0
