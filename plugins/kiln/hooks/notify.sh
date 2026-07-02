#!/bin/sh
# Kiln Notification hook — one branded ping at a human-needed moment (or a backgrounded run's
# finish). Side-effect only: it cannot modify or block the notification (platform-surfaces §1.6).
# Zero decision power, no node startup, well under the <50ms budget. Always exits 0. It tolerates
# any payload type — an unrecognized notification just falls through to the default line.
input=$(cat 2>/dev/null)
case "$input" in
  *permission_prompt*) line="the forge holds for your word" ;;
  *) line="the fire banks low, and waits" ;;
esac
# stdout: the sanctioned terminalSequence output field — a bare BEL, written as the JSON escape
# for U+0007. Since 2.1.139 command hooks run with no controlling terminal, so a BEL sent to the
# tty is silent now; Claude Code emits this escape for us through its own terminal write path. It
# is a TOP-LEVEL output field, never nested in hookSpecificOutput. The single backslash is composed
# at runtime (printf collapses the doubled backslash) so the emitted JSON string is exactly valid.
esc=$(printf '\\')
printf '%s%su0007%s\n' '{"terminalSequence":"' "$esc" '"}'
# stderr: the branded line — the human flavor beside the bell, and the log trace.
printf 'kiln · %s\n' "$line" >&2 2>/dev/null
exit 0
