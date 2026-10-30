"""Receipt reader adapted from Kiln 4 lib/ledger.py; Lite writes only here."""
from datetime import datetime, timezone
import fcntl
import json
import sys


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
                print(f"kl: skipping ledger line {number}: {error}", file=sys.stderr)
            else:
                on_error(number, error)
    return rows


def render(rows):
    start = next((r for r in rows if r["kind"] == "start"), {})
    calls = [r for r in rows if r["kind"] == "call"]
    answered = {r.get("question") for r in rows if r["kind"] == "answer"}
    sections = {
        "Run": [f'{start.get("project", "")} / {start.get("slug", "")}'],
        "Phase": [next((r["phase"] for r in reversed(rows) if "phase" in r), "started")],
        "Accepted": [r.get("artifact", "") for r in rows if r["kind"] == "accept"],
        "Live runners": [f'{r.get("runner")} {r.get("agent_id")} {r.get("time")} '
                         f'last call: {calls[-1]["n"] if calls else "none"}'
                         for r in rows if r["kind"] == "dispatch"],
        "Unfinished calls": [f'{r["n"]} {r["role"]}: {r["status"]} {r["result"]}'
                             for r in calls if r["status"] != "done"],
        "Questions": [r.get("text", "") for r in rows
                      if r["kind"] == "question" and r.get("id") not in answered]
                     + [f'{r.get("headline", "question")} ({r["result"]})'
                        for r in calls if r["status"] == "question"],
        "Answers": [r.get("text", "") for r in rows if r["kind"] == "answer"],
        "Milestones done": [f'{r.get("milestone", "")} {r.get("artifact", "")}'.strip()
                            for r in rows if r["kind"] == "accept" and r.get("artifact_kind") == "milestone"],
        "Next action": ["Inspect unfinished calls." if calls and calls[-1]["status"] != "done"
                        else "Dispatch the next worker."],
    }
    lines = []
    for title, items in sections.items():
        lines.append(f"## {title}")
        # Keep the generated view bounded; the ledger retains every receipt.
        lines.extend(str(item).replace("\n", " ") for item in items[-4:])
        if len(items) > 4:
            lines.append(f"({len(items) - 4} earlier entries in ledger.jsonl)")
    return "\n".join(lines) + "\n"


def append(home, kind, **fields):
    with (home / "ledger.jsonl").open("a") as target:
        fcntl.flock(target, fcntl.LOCK_EX)
        row = dict(time=datetime.now(timezone.utc).isoformat(), kind=kind, **fields)
        target.write(json.dumps(row, ensure_ascii=False) + "\n")
        target.flush()
        temporary = home / ".run.md.tmp"
        temporary.write_text(render(records(home)), encoding="utf-8")
        temporary.replace(home / "run.md")
    return row
