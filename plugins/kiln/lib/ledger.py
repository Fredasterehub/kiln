"""Shared Kiln receipt, pending-row, seat and PID-marker contracts; stdlib only."""
import json
import os
import sys
from pathlib import Path


def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def markers(seat):
    return set(read_json(Path(seat["inbox"]), {"read": []})["read"]) if seat["inbox"] else set()


def pending(rows, seat):
    received = markers(seat)
    completed = {r.get("cites") for r in rows if r.get("kind") in ("done", "answer")}
    return [r for r in rows if r.get("to") == seat["address"]
            and r.get("kind") in ("request", "question")
            and r.get("id") in received and r.get("id") not in completed]


def workers(home, seat):
    return [child for path in sorted((home / "seats").glob("*.json"))
            if isinstance(child := read_json(path), dict) and child.get("parent") == seat["address"]]


def live_pid(path, listener=False):
    if not path.exists():
        return False
    try:
        pid = int(path.read_text().strip())
    except (ValueError, FileNotFoundError):
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, OverflowError):
        return False
    except PermissionError:
        pass  # Existing process owned by another uid is still live.
    # kill(0) also succeeds for zombies: those are no longer waiting.
    stat = Path(f"/proc/{pid}/stat")
    try:
        if stat.read_text().rsplit(")", 1)[1].split()[0] == "Z":
            return False
        if listener:
            args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
            return any(Path(os.fsdecode(a)).name == "core.py" and args[i + 1:i + 2] == [b"listen"]
                       for i, a in enumerate(args))
        return True
    except FileNotFoundError:
        return False



def records(home, on_error=None, stream=None):
    """Read complete rows; an optional binary stream starts at its current offset."""
    if stream is None:
        path = home / "ledger.jsonl"
        if not path.exists():
            return []
        with path.open("rb") as source:
            return records(home, on_error, source)
    rows = []
    for number, line in enumerate(stream, 1):
        try:
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError("expected a row object")
            rows.append(row)
        except ValueError as error:
            if on_error is None:
                print(f"team: skipping ledger line {number}: {error}", file=sys.stderr)
            else:
                on_error(number, error)
    return rows
