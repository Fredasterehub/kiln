#!/bin/sh
# Kiln Notification hook — one branded ping at a human-needed moment.
# Side-effect only: it cannot modify or block the notification (platform-surfaces §1.6).
# Zero decision power, no node startup, well under the <50ms budget. Always exits 0.
input=$(cat 2>/dev/null)
case "$input" in
  *permission_prompt*) line="the forge holds for your word" ;;
  *) line="the fire banks low, and waits" ;;
esac
# The bell is the reliable ping; the branded line is the flavor beside it.
printf '\a' >&2 2>/dev/null
printf 'kiln · %s\n' "$line" >&2 2>/dev/null
exit 0
