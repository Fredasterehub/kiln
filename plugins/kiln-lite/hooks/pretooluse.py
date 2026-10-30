#!/usr/bin/env python3
"""Prevent session and runner editor tools from writing product code."""
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.core import find_home


def main():
    event = json.load(sys.stdin)
    if event.get('tool_name') not in ('Write', 'Edit', 'NotebookEdit'):
        return
    try:
        home = find_home(cwd=event.get('cwd'))
    except ValueError:
        return
    tool_input = event.get('tool_input', {})
    target = tool_input.get('file_path') or tool_input.get('notebook_path')
    if target and Path(target).is_absolute() and Path(target).resolve().is_relative_to((home / 'wt').resolve()):
        print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse',
            'permissionDecision': 'deny',
            'permissionDecisionReason': 'product code is written by implementer workers; dispatch one'}}))


if __name__ == '__main__':
    main()
