"""Shared Kiln receipt, pending-row, seat and PID-marker contracts; stdlib only."""
import json
import os
from pathlib import Path


def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def markers(seat):
    return set(read_json(Path(seat["inbox"]), {"read": []})["read"]) if seat["inbox"] else set()


def pending(rows, seat):
    received = markers(seat)
    completed = {r.get("cites") for r in rows if r["kind"] in ("done", "answer")}
    return [r for r in rows if r["to"] == seat["address"]
            and r["id"] in received and r["id"] not in completed]


def workers(home, seat):
    return [child for path in sorted((home / "seats").glob("*.json"))
            if (child := read_json(path))["parent"] == seat["address"]]


def live_pid(path):
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
    except ProcessLookupError:
        return False
    except PermissionError:
        pass  # Existing process owned by another uid is still live.
    # kill(0) also succeeds for zombies: those are no longer waiting.
    stat = Path(f"/proc/{pid}/stat")
    try:
        return stat.read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except FileNotFoundError:
        return False

