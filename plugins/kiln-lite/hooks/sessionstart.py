#!/usr/bin/env python3
"""Restore the active run's generated status at startup, resume or compaction."""
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.core import find_home


def main():
    event = json.load(sys.stdin)
    mode = event.get('permission_mode')
    context = (f'Kiln-Lite needs bypassPermissions; this session is in {mode}: '
               'stop before kl start and tell the operator.\n') if mode and mode != 'bypassPermissions' else ''
    try:
        home = find_home(cwd=event.get('cwd'))
    except ValueError:
        home = None
    if home is not None:
        status = subprocess.run([str(Path(__file__).resolve().parents[1] / 'bin/kl'),
                                 'status', '--run', str(home)], capture_output=True, text=True)
        if status.returncode == 0:
            context += status.stdout
    if context:
        print(json.dumps({'hookSpecificOutput': {'hookEventName': 'SessionStart',
                                                'additionalContext': context}}))


if __name__ == '__main__':
    main()
