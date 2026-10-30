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


RUNNER_PHASES = {"algalon": "research", "pluribus": "plan", "chunk-norris": "build",
                 "anatomist": "verify", "giant": "deploy"}
ROLE_PHASES = {"researcher": "research", "researcher_gpt": "research", "researcher_claude": "research",
               "architect": "plan", "fresh_builder_read": "plan", "conceptual": "plan",
               "implementer": "build", "reviewer": "build", "review_of_gpt": "build", "review_of_claude": "build",
               "operational": "build", "verifier": "verify", "verifier_gpt": "verify", "verifier_claude": "verify",
               "mechanical": "deploy"}


def live_runners(rows):
    live = {}
    for i, row in enumerate(rows):
        if row["kind"] == "dispatch":
            name = row.get("runner", "").removeprefix("kiln-lite:")
            phase = row.get("phase") or RUNNER_PHASES.get(name, name)
            live[row.get("runner")] = (i, row, phase)
        elif row["kind"] == "accept":
            phase = row.get("phase") or row.get("artifact_kind")
            live = {name: value for name, value in live.items()
                    if value[2] != ("build" if phase == "milestone" else phase)}
    return live


def inferred_runner(rows, role):
    phase = ROLE_PHASES.get(role.split('.')[0])
    candidates = [value for value in live_runners(rows).values() if phase is None or value[2] == phase]
    return max(candidates, default=(0, {}, None), key=lambda value: value[0])[1].get("runner")


def render(rows):
    start = next((r for r in rows if r["kind"] == "start"), {})
    calls = [r for r in rows if r["kind"] == "call"]
    completed = {r["n"] for r in calls}
    pending = [r for r in rows if r["kind"] == "call_start" and r["n"] not in completed]
    now = datetime.now(timezone.utc)
    unfinished = [r for i, r in enumerate(calls) if r["status"] != "done"
                  and not any(c["status"] == "done" and
                              ((c.get("resume") and c.get("resume") in (r.get("ids") or {}).values())
                               or (r["status"] in ("failed", "rejected") and c.get("role") == r.get("role")))
                              for c in calls[i+1:])]
    live = live_runners(rows)
    accepted = next((r.get("artifact_kind", r.get("phase")) for r in reversed(rows) if r["kind"] == "accept"), None)
    phase = {"brief": "research", "research": "plan", "plan": "build", "milestone": "build",
             "build": "verify", "verify": "deploy", "deploy": "done"}.get(accepted, "brief")
    answered = {r.get("question") for r in rows if r["kind"] == "answer"}
    sections = {
        "Run": [f'{start.get("project", "")} / {start.get("slug", "")}'],
        "Phase": [phase],
        "Accepted": [r.get("artifact", "") for r in rows if r["kind"] == "accept"],
        "Live runners": [f'{r.get("runner")} {runner_phase} {r.get("agent_id")} since {r.get("time")} '
                         f'last call: {next((c["n"] for c in reversed(rows[i+1:]) if c["kind"] == "call" and c.get("runner") == r.get("runner")), "none")}'
                         for i, r, runner_phase in live.values()],
        "Unfinished calls": [f'{r["n"]} {r["role"]}: {r["status"]} {r["result"]}'
                             for r in unfinished],
        "Questions": [f'{r.get("id")}: {r.get("text", "")}' for r in rows
                      if r["kind"] == "question" and r.get("id") not in answered]
                     + [f'{r.get("headline", "question")} ({r["result"]})'
                        for r in unfinished if r["status"] == "question"],
        "Answers": [f'{r.get("question")}: {r.get("text", "")}' for r in rows if r["kind"] == "answer"],
        "Milestones done": [f'{r.get("milestone", "")} {r.get("artifact", "")}'.strip()
                            for r in rows if r["kind"] == "accept" and r.get("artifact_kind") == "milestone"],
        "Next action": ["Answer the open question." if any(r["kind"] == "question" and r.get("id") not in answered for r in rows)
                        else "Inspect unfinished calls." if unfinished or pending
                        else "Dispatch the next worker."],
    }
    lines = []
    for title, items in sections.items():
        lines.append(f"## {title}")
        # Keep the generated view bounded; the ledger retains every receipt.
        lines.extend(str(item).replace("\n", " ") for item in items[-4:])
        if len(items) > 4:
            lines.append(f"({len(items) - 4} earlier entries in ledger.jsonl)")
        if title == "Unfinished calls":
            for row in pending:
                age = max(0, (now - datetime.fromisoformat(row["time"])).total_seconds() / 60)
                lines.append(f'{row["n"]} {row["role"]} {row["model"]}: unfinished, age {age:.1f} minutes')
    return "\n".join(lines) + "\n"


def append(home, kind, **fields):
    with (home / "ledger.jsonl").open("a") as target:
        fcntl.flock(target, fcntl.LOCK_EX)
        if kind == "question":
            fields["id"] = "q" + str(1 + sum(r["kind"] == "question" for r in records(home)))
        row = dict(time=datetime.now(timezone.utc).isoformat(), kind=kind, **fields)
        target.write(json.dumps(row, ensure_ascii=False) + "\n")
        target.flush()
        temporary = home / ".run.md.tmp"
        temporary.write_text(render(records(home)), encoding="utf-8")
        temporary.replace(home / "run.md")
    return row
