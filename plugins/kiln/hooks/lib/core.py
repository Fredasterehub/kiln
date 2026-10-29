"""Kiln hook policy. See docs/hooks.md for the small on-disk interfaces."""
import fcntl
import importlib
import json
import os
from pathlib import Path
import re
import shlex
import sys
import time
import uuid

PERSISTENT = {"director", "super", "manager", "helper", "chunkmaster"}
BOSSES = {"director", "super", "manager", "chunkmaster"}
SENTENCE = "this is enough; read rules, ledger and panes only where an item points you"


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def ledger(home):
    # Same lock as team: a partially appended row is never interpreted.
    with (home / "ledger.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_SH)
        path = home / "ledger.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def receipt(home, seat):
    return set(read_json(home / "inbox" / f'{seat["address"]}.json', {"read": []})["read"])


def unread(home, seat, rows):
    marked = receipt(home, seat)
    return [r for r in rows if r["to"] == seat["address"] and r["id"] not in marked]


def pending(home, seat, rows):
    completed = {r["cites"] for r in rows if r["kind"] in ("done", "answer")}
    marked = receipt(home, seat)
    inherited = set(seat.get("pending", []))
    return sorted((inherited | {r["id"] for r in rows if r["kind"] == "request"
                   and r["to"] == seat["address"] and r["id"] in marked}) - completed)


def armed(home, worker):
    path = home / "waits" / f"{worker}.pid"
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


def finished(row):
    if not row.get("path"):
        return False
    path = Path(row["path"])
    candidates = [path / "status.txt"] if path.is_dir() else [path, path.parent / "status.txt"]
    for candidate in candidates:
        if candidate.is_file():
            lines = candidate.read_text().splitlines()
            last = next((line.strip() for line in reversed(lines) if line.strip()), "")
            if re.match(r"^(?:\d{2}:\d{2}\s+)?done:(?:\s|$)", last):
                return True
    return False


def stop(home, seat, payload):
    if payload.get("stop_hook_active"):
        return None
    rows = ledger(home)
    reasons = []
    new = unread(home, seat, rows)
    if new:
        reasons.append("Unread rows " + ", ".join(r["id"] for r in new) + "; run: team inbox --mark")
    for worker in seat.get("workers", []):
        if not armed(home, worker):
            command = f"herdr agent wait {shlex.quote(worker)} --timeout 30000"
            marker = shlex.quote(str(home / "waits" / f"{worker}.pid"))
            # The Claude native tool must finish its Bash call with '&'.
            command = (f"mkdir -p {shlex.quote(str(home / 'waits'))}; "
                       f"{command} & wait_pid=$!; echo \"$wait_pid\" > {marker}; wait \"$wait_pid\"")
            if seat["family"] == "claude":
                command = f"( {command} ) &"
            reasons.append(f"Worker {worker} has no armed wait; run: {command}")
    marked = receipt(home, seat)
    done = {r["cites"] for r in rows if r["kind"] == "done"}
    for row in rows:
        if (row["kind"] == "request" and row["to"] == seat["address"]
                and row["id"] in marked and row["id"] not in done and finished(row)):
            args = ["team", "send", "--from", seat["address"], "--to", row["from"],
                    "--kind", "done", "--task", row["task"], "--cites", row["id"],
                    "--headline", "Completed", "--path", row["path"]]
            reasons.append(f'Finished request {row["id"]} has no done; run: {shlex.join(args)}')
    rotation = home / "rotations" / f'{seat["address"]}.json'
    state = read_json(rotation, {})
    if state.get("pane") == seat["pane"] and state.get("acked") is False:
        reasons.append(f'Rotation {state["id"]} awaits replacement ack; run: cat {shlex.quote(str(rotation))}')
    return "\n".join(reasons) or None


def start(home, seat):
    parts = []
    for key in ("card", "handoff"):
        path = Path(seat[key]) if seat.get(key) else None
        if path and path.is_file():
            parts.append(path.read_text())
    parts.append("Pending requests: " + (", ".join(pending(home, seat, ledger(home))) or "none"))
    parts.append(SENTENCE)
    return "\n\n".join(parts)


def fence(seat, payload, adapter):
    tool, data = payload["tool_name"], payload["tool_input"]
    cwd = Path(payload.get("cwd", seat["root"]))
    roots = [Path(p).resolve() for p in [seat["root"], *seat.get("extra_roots", [])]]
    for value in adapter.paths(tool, data):
        path = (cwd / value).resolve()
        if not any(path.is_relative_to(root) for root in roots):
            return f"path {value} is outside root + extra_roots; use a declared writable path"
    if tool != "Bash" or seat["role"] not in BOSSES:
        return None
    # Recognize only literal Herdr command shapes; no shell execution or poll-loop heuristics.
    command = data["command"]
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|()\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    words = list(lexer)
    def boundary(word):
        return bool(word) and all(c in ";&|()\n" for c in word)
    for index, word in enumerate(words):
        if Path(word).name != "herdr" or (index and not boundary(words[index - 1])):
            continue
        end = next((i for i in range(index + 1, len(words)) if boundary(words[i])), len(words))
        tail = words[index + 1:end]
        if tail[:2] in (["agent", "wait"], ["pane", "wait-output"]):
            if not any(w == "--timeout" or w.startswith("--timeout=") for w in tail[2:]):
                return "Herdr waits require --timeout; add --timeout 30000"
            if tail[:2] == ["agent", "wait"] and seat["family"] == "claude" and not command.rstrip().endswith("&"):
                return "Claude Herdr agent waits must end in &; run the wait in the background"
        if tail[:2] in (["agent", "prompt"], ["pane", "send-text"], ["pane", "send-keys"]):
            target = tail[2] if len(tail) > 2 else ""
            workers = set(seat.get("workers", [])) - {"director", seat["pane"]}
            # Agent addresses are canonical; pane targets are resolved from those workers' seats.
            home = Path(os.environ["KILN_HOME"])
            panes = {read_json(home / "seats" / f"{w}.json", {}).get("pane") for w in workers}
            director = read_json(home / "seats/director.json", {}).get("pane")
            allowed = workers - {director} if tail[0] == "agent" else panes - {director, None}
            if target not in allowed:
                return f"target {target} is outside my workers; use a worker target (never the director's pane)"
    return None


def listen(home, seat):
    """Proven asyncRewake pattern: unread check, sleep, exit 2. Never consumes rows."""
    directory = home / "listeners"
    directory.mkdir(exist_ok=True)
    marker = directory / f'{seat["address"]}.json'
    token = uuid.uuid4().hex
    # Serialize listener generations. Old generations retire without killing any process.
    with (directory / f'{seat["address"]}.lock').open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker.write_text(json.dumps({"pane": seat["pane"], "token": token}))
    deadline = time.monotonic() + 280
    while time.monotonic() < deadline:
        if read_json(Path(os.environ["KILN_SEAT"]), {}).get("pane") != seat["pane"]:
            return 0
        if read_json(marker, {}).get("token") != token:
            return 0
        rows = unread(home, seat, ledger(home))
        if rows:
            print("Unread rows " + ", ".join(r["id"] for r in rows) + "; run: team inbox --mark", file=sys.stderr)
            return 2
        time.sleep(0.25)
    return 0


def main():
    event = sys.argv[1]
    home = None
    outcome = "allow"
    try:
        seat = read_json(Path(os.environ["KILN_SEAT"]), {})
        if not os.environ.get("HERDR_PANE_ID") or seat.get("pane") != os.environ["HERDR_PANE_ID"]:
            return 0
        home = Path(os.environ["KILN_HOME"])
        payload = json.load(sys.stdin)
        family = seat["family"]
        if family not in ("claude", "codex"):
            return 0
        adapter = importlib.import_module(family)
        output = None
        if event in ("stop", "start", "listen") and seat["role"] not in PERSISTENT:
            return 0
        if event == "stop":
            reason = stop(home, seat, payload)
            if reason:
                outcome, output = "refuse", adapter.stop(reason)
        elif event == "start":
            output = adapter.start(start(home, seat))
        elif event == "fence":
            reason = fence(seat, payload, adapter)
            if reason:
                outcome, output = "deny", adapter.deny(reason, payload["tool_name"])
        elif event == "listen" and family == "claude":
            result = listen(home, seat)
            outcome = "wake" if result else "retire"
            return result
        if output is not None:
            print(json.dumps(output))
    except Exception as error:
        outcome = f"error {type(error).__name__}: {error}"
        # A broken seat is still logged when KILN_HOME is available; mismatched panes are not seats.
        if home is None and os.environ.get("KILN_HOME"):
            home = Path(os.environ["KILN_HOME"])
    finally:
        if home is not None:
            try:
                with (home / "hooks.log").open("a") as stream:
                    stream.write(json.dumps({"event": event, "outcome": outcome}) + "\n")
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
