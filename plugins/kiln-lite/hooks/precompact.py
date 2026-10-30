#!/usr/bin/env python3
"""Record a compaction receipt without blocking the session or printing output."""
from contextlib import redirect_stderr
import io
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    try:
        # Ledger recovery warnings must not surface during compaction either.
        with redirect_stderr(io.StringIO()):
            from lib.core import find_home
            from lib.ledger import append
            # The session's own directory names the run; an inherited pointer must not.
            os.environ.pop('KILN_LITE_RUN', None)
            event = json.load(sys.stdin)
            if not isinstance(event, dict):
                return 0
            home = find_home(cwd=event.get('cwd'))
            append(home, 'compact', trigger=event.get('trigger'), session_id=event.get('session_id'))
    except Exception:  # a receipt is never worth disturbing a compaction
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
