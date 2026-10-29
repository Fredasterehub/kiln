#!/bin/sh
[ -n "$KILN_SEAT" ] && [ -f "$KILN_SEAT" ] || exit 0
exec python3 -B "$(dirname "$0")/lib/core.py" stop
